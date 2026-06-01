// =============================================================================
// main.js — Application entry point
// =============================================================================

// Store file metadata globally so tabs can access it
var APP_DATA = null;
var APP_FILE_META = null;

// Workspan column names used to auto-detect the header row
var KNOWN_COLUMNS = [
  "Deal WS-ID", "Partner Name", "CR Party Name", "Track", "Sub-Track",
  "Stage", "CR Party ID", "BE GEO ID", "Program Type", "Booking Date",
  "Incentive Level", "Adopt Rebate Opt-In Status", "Deal Incentive Expiry Date"
];

document.addEventListener("DOMContentLoaded", init);

function init() {
  // Check IndexedDB for cached datasets and render resume cards if found
  IDB.loadAll().then(function (entries) {
    restoreUploadSection(entries);
  }).catch(function () {
    restoreUploadSection([]);
  });

  document.querySelectorAll('[data-bs-toggle="tab"]').forEach(function (tab) {
    tab.addEventListener("shown.bs.tab", function (e) {
      if (!APP_DATA) return;
      renderActiveTab(e.target.dataset.bsTarget);
    });
  });
}

function showLoader(message) {
  var sec = document.getElementById("upload-section");
  sec.classList.remove("d-none");
  sec.innerHTML =
    '<div class="upload-card mx-auto my-5">' +
    '  <div class="card shadow-sm">' +
    '    <div class="card-body p-5 text-center">' +
    '      <div class="spinner-border text-primary mb-3" style="width:3rem;height:3rem;" role="status"></div>' +
    '      <p class="text-muted mb-0" id="loader-msg">' + (message || "Loading…") + '</p>' +
    '    </div>' +
    '  </div>' +
    '</div>';
}

function updateLoaderMsg(msg) {
  var el = document.getElementById("loader-msg");
  if (el) el.textContent = msg;
}

// Find which row in the 2-D array contains the Workspan column headers.
// Returns the row index, or -1 if nothing plausible is found.
function findHeaderRowIndex(rows2d) {
  var bestIdx = -1;
  var bestScore = 0;
  for (var i = 0; i < Math.min(rows2d.length, 50); i++) {
    var row = rows2d[i];
    if (!row) continue;
    var matchCount = 0;
    for (var j = 0; j < row.length; j++) {
      var cell = row[j];
      if (cell && KNOWN_COLUMNS.indexOf(String(cell).trim()) !== -1) matchCount++;
    }
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestIdx = i;
    }
    if (matchCount >= 3) break;  // good enough, stop early
  }
  // Accept if we found at least 1 known column, otherwise fall back to row 0
  return bestScore >= 1 ? bestIdx : 0;
}

// Convert a 2-D array (header row + data rows) to array-of-objects
function rows2dToObjects(rows2d, headerIdx) {
  var headers = rows2d[headerIdx].map(function (h) { return h === null || h === undefined ? "" : String(h).trim(); });
  var result = [];
  for (var i = headerIdx + 1; i < rows2d.length; i++) {
    var row = rows2d[i];
    if (!row) continue;
    // Skip entirely blank rows
    var hasData = false;
    for (var j = 0; j < row.length; j++) { if (row[j] !== null && row[j] !== undefined && row[j] !== "") { hasData = true; break; } }
    if (!hasData) continue;
    var obj = {};
    for (var k = 0; k < headers.length; k++) {
      if (headers[k]) obj[headers[k]] = row[k] !== undefined ? row[k] : null;
    }
    result.push(obj);
  }
  return result;
}

function handleFileUpload(event) {
  var file = event.target.files[0];
  if (!file) return;

  var ext = file.name.split(".").pop().toLowerCase();
  var sizeMB = file.size / (1024 * 1024);

  // Warn early for large XLSX — don't even attempt, it will crash the browser tab
  if (ext !== "csv" && sizeMB > 20) {
    var msg =
      "This Excel file is " + sizeMB.toFixed(0) + " MB, which is too large to load in the browser.\n\n" +
      "Please export your Workspan report as CSV instead:\n" +
      "  1. In Workspan, run report 19849 (Partners) or 21766 (Distributors)\n" +
      "  2. Click Export → CSV\n" +
      "  3. Upload the .csv file here\n\n" +
      "CSV files of any size work perfectly — there is no size limit.";
    alert(msg);
    // Reset the input so the user can pick again
    event.target.value = "";
    return;
  }

  showLoader("Reading file — this may take a moment for large files…");

  // Store file metadata for display in tabs
  APP_FILE_META = {
    name: file.name,
    lastModified: file.lastModified ? new Date(file.lastModified) : null
  };

  if (ext === "csv") {
    handleCSV(file);
  } else {
    handleXLSX(file);
  }
}


// ── CSV path: PapaParse streams the file — handles millions of rows ──────────
function handleCSV(file) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,  // keep raw strings; transform.js handles types
    worker: false,
    step: null,
    complete: function(results) {
      if (!results.data || results.data.length === 0) {
        restoreUploadSection();
        alert("The CSV file appears to be empty or has no data rows.");
        return;
      }
      updateLoaderMsg("Processing " + results.data.length.toLocaleString() + " rows…");
      setTimeout(function() {
        try {
          APP_DATA = transformData(results.data);
          finishLoad(file.name, APP_DATA.length, false, "ws-" + file.name);
        } catch(err) {
          restoreUploadSection([]);
          console.error(err);
          alert("Error processing data: " + err.message);
        }
      }, 50);
    },
    error: function(err) {
      restoreUploadSection();
      alert("Error reading CSV: " + err.message);
    }
  });
}

// ── XLSX path: runs in a Web Worker to avoid main-thread memory limits ───────
function handleXLSX(file) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var buffer = e.target.result;

    // Try Worker first (better memory headroom, non-blocking)
    var workerSupported = (typeof Worker !== 'undefined');

    if (workerSupported) {
      try {
        // Use a blob worker so it works from file:// protocol
        var workerSrc = 'js/xlsx-worker.js';
        var worker = new Worker(workerSrc);

        worker.onmessage = function (ev) {
          var msg = ev.data;
          if (msg.type === 'progress') {
            updateLoaderMsg(msg.msg);
          } else if (msg.type === 'done') {
            worker.terminate();
            parseCSVAndFinish(msg.csv, file.name, msg.headerIdx > 0);
          } else if (msg.type === 'error') {
            worker.terminate();
            restoreUploadSection();
            alert('Error reading Excel file:\n' + msg.msg);
          }
        };

        worker.onerror = function (err) {
          worker.terminate();
          // Worker failed (e.g. file:// blocked importScripts) — fall back to main thread
          console.warn('Worker failed, falling back to main thread:', err.message);
          handleXLSXMainThread(buffer, file.name);
        };

        // Transfer the buffer to the worker (zero-copy)
        worker.postMessage(buffer, [buffer]);
        return;
      } catch (workerErr) {
        console.warn('Could not start worker, falling back to main thread:', workerErr.message);
      }
    }

    // Fallback: run on main thread
    handleXLSXMainThread(buffer, file.name);
  };
  reader.readAsArrayBuffer(file);
}

// Main-thread XLSX fallback (same logic as worker but synchronous)
function handleXLSXMainThread(buffer, filename) {
  setTimeout(function () {
    try {
      updateLoaderMsg('Parsing Excel file…');
      var wb = XLSX.read(buffer, {
        type: 'array',
        cellDates: false,
        cellHTML: false,
        cellStyles: false,
        cellFormula: false,
        dense: true
      });

      updateLoaderMsg('Detecting data layout…');
      var sheetName = null, headerIdx = 0;

      for (var si = 0; si < wb.SheetNames.length; si++) {
        var candidateSheet = wb.Sheets[wb.SheetNames[si]];
        if (!candidateSheet || !candidateSheet['!ref']) continue;
        var preview = XLSX.utils.sheet_to_json(candidateSheet, { header: 1, defval: null, raw: true, sheetRows: 15 });
        if (!preview || preview.length === 0) continue;
        var hi = findHeaderRowIndex(preview);
        var hrow = preview[hi] || [];
        var score = 0;
        for (var ci = 0; ci < hrow.length; ci++) {
          if (hrow[ci] && KNOWN_COLUMNS.indexOf(String(hrow[ci]).trim()) !== -1) score++;
        }
        if (score > 0) { sheetName = wb.SheetNames[si]; headerIdx = hi; break; }
      }
      if (!sheetName) {
        for (var si2 = 0; si2 < wb.SheetNames.length; si2++) {
          var fs = wb.Sheets[wb.SheetNames[si2]];
          if (fs && fs['!ref']) { sheetName = wb.SheetNames[si2]; break; }
        }
      }
      if (!sheetName) {
        restoreUploadSection();
        alert('No readable sheets found. Sheets: ' + wb.SheetNames.join(', '));
        return;
      }

      updateLoaderMsg('Converting to CSV…');
      var csvString = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { defval: '' });
      if (headerIdx > 0) {
        var lines = csvString.split('\n');
        csvString = lines.slice(headerIdx).join('\n');
      }

      parseCSVAndFinish(csvString, filename, headerIdx > 0);
    } catch (err) {
      restoreUploadSection();
      console.error(err);
      alert('Error reading Excel file: ' + err.message);
    }
  }, 50);
}

// Shared final step: PapaParse the CSV string → transform → display
function parseCSVAndFinish(csvString, filename, headerAutoDetected) {
  if (!csvString || csvString.trim() === '') {
    restoreUploadSection();
    alert('The sheet appears to be empty after reading.');
    return;
  }
  updateLoaderMsg('Parsing rows…');
  Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: function (results) {
      if (!results.data || results.data.length === 0) {
        restoreUploadSection();
        alert('No data rows found.');
        return;
      }
      updateLoaderMsg('Processing ' + results.data.length.toLocaleString() + ' rows…');
      setTimeout(function () {
        try {
          APP_DATA = transformData(results.data);
          finishLoad(filename, APP_DATA.length, headerAutoDetected, "ws-" + filename);
        } catch (err) {
          restoreUploadSection();
          console.error(err);
          alert('Error processing data: ' + err.message);
        }
      }, 50);
    },
    error: function (err) {
      restoreUploadSection();
      alert('Error parsing sheet: ' + err.message);
    }
  });
}

function finishLoad(filename, rowCount, headerAutoDetected, idbType, loadedAt) {
  // Save to IndexedDB (fire-and-forget)
  if (idbType && APP_DATA) {
    IDB.save(idbType, APP_DATA, {
      filename:  filename,
      rowCount:  rowCount,
      loadedAt:  new Date().toISOString()
    }).catch(function (e) { console.warn("IDB save failed:", e); });
  }

  restoreUploadSection([]);  // clear upload section
  document.getElementById("upload-section").classList.add("d-none");
  document.getElementById("main-tab-bar").classList.remove("d-none");
  var sb = document.getElementById("status-bar");
  sb.classList.remove("d-none");
  sb.classList.add("d-flex");
  document.getElementById("status-filename").textContent = filename;
  document.getElementById("status-rows").textContent =
    rowCount.toLocaleString() + " rows" +
    (headerAutoDetected ? " · header auto-detected" : "");
  var dateEl = document.getElementById("status-date");
  dateEl.textContent = "";

  var activeTab = document.querySelector(".nav-link.active[data-bs-target]");
  renderActiveTab(activeTab ? activeTab.dataset.bsTarget : "#tab-overview");
}

function restoreUploadSection(cachedEntries) {
  cachedEntries = cachedEntries || [];
  var sec = document.getElementById("upload-section");
  sec.classList.remove("d-none");

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function resumeCard(entry) {
    var isCpi = entry.type.indexOf("cpi-") === 0;
    var beGeoId = isCpi ? entry.type.replace("cpi-", "") : "";
    var html = '<div class="card border-success mb-2 p-2">';
    html += '<div class="d-flex justify-content-between align-items-start gap-2">';
    html += '<div style="min-width:0">';
    if (isCpi) html += '<div class="fw-semibold small">BE GEO ID: ' + beGeoId + '</div>';
    html += '<div class="text-muted small text-truncate" title="' + entry.meta.filename + '">' + entry.meta.filename + '</div>';
    html += '<div class="text-muted" style="font-size:0.72rem">' + (entry.meta.rowCount||0).toLocaleString() + ' rows &middot; ' + fmtDate(entry.meta.loadedAt) + '</div>';
    html += '</div>';
    html += '<div class="d-flex gap-1 flex-shrink-0">';
    html += '<button class="btn btn-sm btn-success idb-resume-btn py-0" data-idbtype="' + entry.type + '" title="Resume"><i class="bi bi-play-fill"></i></button>';
    html += '<button class="btn btn-sm btn-outline-danger idb-clear-btn py-0" data-idbtype="' + entry.type + '" title="Delete"><i class="bi bi-trash"></i></button>';
    html += '</div></div></div>';
    return html;
  }

  // Split cached entries
  var wsEntries = [];
  var cpiEntries = [];
  cachedEntries.forEach(function (e) {
    if (e.type.indexOf("ws-") === 0) wsEntries.push(e);
    else if (e.type.indexOf("cpi-") === 0) cpiEntries.push(e);
  });

  // ── Compute week options: 2026W11 → current ISO week ──────────────────────
  function getISOWeek(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return { year: d.getUTCFullYear(), week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7) };
  }
  var now = getISOWeek(new Date());
  var weekOptions = "";
  for (var w = 11; w <= now.week; w++) {
    var wLabel = now.year + "W" + (w < 10 ? "0" + w : w);
    var selected = (w === now.week) ? ' selected' : '';
    weekOptions += '<option value="' + wLabel + '"' + selected + '>' + wLabel + '</option>';
  }

  // ── Build two-column layout ────────────────────────────────────────────────
  sec.innerHTML =
    '<div class="container-fluid py-4" style="max-width:1100px">' +
    '<div class="row g-4">' +

    // ── LEFT: Partner column ──────────────────────────────────────────────────
    '<div class="col-12 col-lg-6">' +

    // Partner upload card
    '<div class="card shadow-sm mb-3">' +
    '<div class="card-header fw-semibold" style="font-size:0.9rem"><i class="bi bi-people-fill me-2 text-primary"></i>Partners — Upload Workspan Export</div>' +
    '<div class="card-body p-4 text-center">' +
    '<i class="bi bi-cloud-upload cisco-icon-lg mb-3"></i>' +
    '<p class="text-muted mb-3">Upload your Workspan report export<br/>' +
    '<small><a href="https://app.workspan.com/reports/view/19849" target="_blank" rel="noopener"><strong>Report 19849</strong></a> for Partners &nbsp;|&nbsp; <a href="https://app.workspan.com/reports/view/21766" target="_blank" rel="noopener"><strong>Report 21766</strong></a> for Distributors</small>' +
    '</p>' +
    '<div class="alert alert-warning py-2 px-3 text-start small mb-4" style="max-width:380px;margin:0 auto;">' +
    '<i class="bi bi-exclamation-triangle me-1"></i><strong>For large exports (&gt;20 MB), use CSV.</strong><br/>' +
    'In Workspan: <em>Export → CSV</em>. CSV handles any number of rows.' +
    '</div>' +
    '<label for="file-input" class="btn btn-cisco btn-lg mb-3 px-5"><i class="bi bi-file-earmark-spreadsheet me-2"></i>Choose File (.xlsx or .csv)</label>' +
    '<input type="file" id="file-input" accept=".xlsx,.xls,.csv" class="d-none" />' +
    '<p class="text-muted small mt-2"><i class="bi bi-shield-lock me-1"></i>File processed entirely in your browser — no data sent to any server.</p>' +
    '</div></div>' +

    // Previous partner sessions
    (wsEntries.length > 0 ?
      '<div class="card shadow-sm border-success">' +
      '<div class="card-header bg-success bg-opacity-10 fw-semibold" style="font-size:0.85rem"><i class="bi bi-lightning-charge-fill me-2 text-success"></i>Previous partner sessions</div>' +
      '<div class="card-body p-2">' + wsEntries.map(resumeCard).join("") + '</div>' +
      '</div>'
    : '') +

    '</div>' + // /left col

    // ── RIGHT: Cisco-internal column ──────────────────────────────────────────
    '<div class="col-12 col-lg-6">' +

    // Cisco CPI card
    '<div class="card shadow-sm border-warning mb-3">' +
    '<div class="card-header bg-warning bg-opacity-10 fw-semibold" style="font-size:0.9rem"><i class="bi bi-lock-fill me-2 text-warning"></i>Cisco-internal — CPI Data</div>' +
    '<div class="card-body p-4">' +
    '<p class="text-muted small mb-3">Load a CPI data file from the shared OneDrive folder, filtered to a specific BE GEO ID.</p>' +
    '<div class="mb-3">' +
    '<label class="form-label small fw-semibold mb-1"><i class="bi bi-person-badge-fill me-1"></i>Your Cisco username</label>' +
    '<div class="input-group input-group-sm" style="max-width:320px">' +
    '<input type="text" id="lci-username" class="form-control form-control-sm" placeholder="e.g. jsmith" style="font-family:monospace"/>' +
    '</div>' +
    '<div class="form-text">Your Cisco username (same as your laptop login). Saved per browser.</div>' +
    '<div class="mt-2 collapse" id="lci-path-advanced">' +
    '<label class="form-label small fw-semibold mb-1"><i class="bi bi-folder me-1"></i>Full base path <span class="text-muted fw-normal">(auto-filled, override if needed)</span></label>' +
    '<input type="text" id="lci-basepath" class="form-control form-control-sm" style="font-family:monospace;font-size:0.78rem"/>' +
    '</div>' +
    '<a href="#" class="small" id="lci-toggle-advanced">Advanced: edit full path manually</a>' +
    '</div>' +
    '<div class="row g-2 mb-3">' +
    '<div class="col-auto"><label class="form-label small fw-semibold mb-1">Region</label>' +
    '<select id="lci-region" class="form-select form-select-sm">' +
    '<option value="EMEA">EMEA</option><option value="AMER">AMER</option><option value="APJC">APJC</option><option value="DISTI">DISTI</option>' +
    '</select></div>' +
    '<div class="col-auto"><label class="form-label small fw-semibold mb-1">Week</label>' +
    '<select id="lci-week" class="form-select form-select-sm">' + weekOptions + '</select></div>' +
    '<div class="col-auto"><label class="form-label small fw-semibold mb-1">BE GEO ID</label>' +
    '<input type="number" id="lci-begeoid" class="form-control form-control-sm" placeholder="e.g. 12345" style="width:130px"/></div>' +
    '</div>' +
    '<div id="lci-path-hint" class="alert alert-secondary py-2 px-3 text-start small mb-3 d-none">' +
    '<span id="lci-path-text" style="word-break:break-all;font-family:monospace"></span>' +
    '<button id="lci-copy-btn" class="btn btn-sm btn-outline-secondary ms-2 py-0" title="Copy path"><i class="bi bi-clipboard"></i></button>' +
    '</div>' +
    '<div id="lci-error" class="alert alert-danger py-2 px-3 small mb-3 d-none"></div>' +
    '<button id="lci-load-btn" class="btn btn-warning px-4"><i class="bi bi-folder2-open me-2"></i>Select CPI file…</button>' +
    '<input type="file" id="lci-file-input" accept=".csv" class="d-none" />' +
    '<p class="text-muted small mt-3 mb-0">Navigate to the displayed path and select the file.</p>' +
    '</div></div>' +

    // Previous CPI sessions
    (cpiEntries.length > 0 ?
      '<div class="card shadow-sm border-warning">' +
      '<div class="card-header bg-warning bg-opacity-10 fw-semibold" style="font-size:0.85rem"><i class="bi bi-lightning-charge-fill me-2 text-warning"></i>Previous CPI sessions</div>' +
      '<div class="card-body p-2">' +
      cpiEntries.map(resumeCard).join("") +
      '</div></div>'
    : '') +

    '</div>' + // /right col
    '</div></div>'; // /row /container

  // ── Wire up file inputs ───────────────────────────────────────────────────
  document.getElementById("file-input").addEventListener("change", handleFileUpload);

  // ── Resume / Clear cache buttons ─────────────────────────────────────────
  sec.querySelectorAll(".idb-resume-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var type = this.dataset.idbtype;
      showLoader("Loading from cache…");
      IDB.load(type).then(function (entry) {
        if (!entry || !entry.data) { IDB.loadAll().then(function(e){restoreUploadSection(e);}); alert("Cache not found."); return; }
        APP_DATA = entry.data;
        APP_FILE_META = { name: entry.meta.filename, lastModified: null, cachedAt: entry.meta.loadedAt ? new Date(entry.meta.loadedAt) : null };
        finishLoad(entry.meta.filename, entry.meta.rowCount, false, null, entry.meta.loadedAt);
      }).catch(function (e) { IDB.loadAll().then(function(en){restoreUploadSection(en);}); alert("Error loading cache: " + e); });
    });
  });

  sec.querySelectorAll(".idb-clear-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      IDB.remove(this.dataset.idbtype).then(function () {
        IDB.loadAll().then(function (entries) { restoreUploadSection(entries); });
      });
    });
  });

  // ── CPI path hint ─────────────────────────────────────────────────────────
  var isMac = navigator.platform.indexOf("Mac") !== -1 || navigator.userAgent.indexOf("Mac") !== -1;
  var SEP = isMac ? "/" : "\\";

  function buildBasePath(username) {
    if (!username) return "";
    return isMac
      ? "/Users/" + username + "/Library/CloudStorage/OneDrive-Cisco/Documents - CX Partner Success TEAM/PCSS Team/Dashboards and Reporting Metrics/Adoption Dashboard"
      : "C:\\Users\\" + username + "\\OneDrive - Cisco\\Documents - CX Partner Success TEAM\\PCSS Team\\Dashboards and Reporting Metrics\\Adoption Dashboard";
  }

  // Restore saved username and base path
  var savedUsername = localStorage.getItem("lci-username") || "";
  var savedBase     = localStorage.getItem("lci-basepath") || buildBasePath(savedUsername);
  document.getElementById("lci-username").value  = savedUsername;
  document.getElementById("lci-basepath").value  = savedBase || "";
  if (!savedUsername) document.getElementById("lci-username").classList.add("is-invalid");

  // Toggle advanced path editor
  document.getElementById("lci-toggle-advanced").addEventListener("click", function (e) {
    e.preventDefault();
    var el = document.getElementById("lci-path-advanced");
    var isShown = el.classList.contains("show");
    el.classList.toggle("show", !isShown);
    this.textContent = isShown ? "Advanced: edit full path manually" : "Hide full path";
  });

  // Username input → auto-build base path
  document.getElementById("lci-username").addEventListener("input", function () {
    var u = this.value.trim();
    this.classList.toggle("is-invalid", !u);
    if (u) {
      localStorage.setItem("lci-username", u);
      var built = buildBasePath(u);
      document.getElementById("lci-basepath").value = built;
      localStorage.setItem("lci-basepath", built);
    }
    updateLciHint();
  });

  // Manual path override updates hint live and auto-saves
  document.getElementById("lci-basepath").addEventListener("input", function () {
    localStorage.setItem("lci-basepath", this.value.trim());
    updateLciHint();
  });

  function lciPath() {
    var u    = document.getElementById("lci-username").value.trim();
    var base = (document.getElementById("lci-basepath").value.trim() || buildBasePath(u) || "").replace(/[\\/]+$/, "");
    var region = document.getElementById("lci-region").value;
    var week   = document.getElementById("lci-week").value;
    var folder = "LCI data " + region;
    return base + SEP + folder + SEP + "CPI_data_" + region + "_" + week + ".csv";
  }

  function updateLciHint() {
    var path = lciPath();
    document.getElementById("lci-path-text").textContent = path;
    document.getElementById("lci-path-hint").classList.remove("d-none");
  }

  ["lci-region","lci-week"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", updateLciHint);
  });
  updateLciHint();

  document.getElementById("lci-copy-btn").addEventListener("click", function () {
    var path = lciPath();
    navigator.clipboard.writeText(path).then(function () {
      var btn = document.getElementById("lci-copy-btn");
      btn.innerHTML = '<i class="bi bi-clipboard-check"></i>';
      setTimeout(function () { btn.innerHTML = '<i class="bi bi-clipboard"></i>'; }, 1500);
    });
  });

  // ── Load button: show file picker then process ────────────────────────────
  document.getElementById("lci-load-btn").addEventListener("click", function () {
    var beGeoId = document.getElementById("lci-begeoid").value.trim();
    var errEl = document.getElementById("lci-error");
    errEl.classList.add("d-none");
    if (!beGeoId) {
      errEl.textContent = "Please enter a BE GEO ID before loading.";
      errEl.classList.remove("d-none");
      return;
    }
    document.getElementById("lci-file-input").click();
  });

  document.getElementById("lci-file-input").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var beGeoId  = document.getElementById("lci-begeoid").value.trim();
    var region   = document.getElementById("lci-region").value;
    var week     = document.getElementById("lci-week").value;
    var expected = "CPI_data_" + region + "_" + week + ".csv";
    var errEl    = document.getElementById("lci-error");
    errEl.classList.add("d-none");

    if (file.name !== expected) {
      errEl.innerHTML = '<i class="bi bi-exclamation-triangle me-1"></i>Expected <strong>' + expected + '</strong> but got <strong>' + file.name + '</strong>. Please check your selections.';
      errEl.classList.remove("d-none");
      this.value = "";
      return;
    }

    showLoader("Reading CPI file…");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: false,
      complete: function (results) {
        try {
          if (!results.data || results.data.length === 0) throw new Error("No data found in CSV.");
          updateLoaderMsg("Filtering for BE GEO ID " + beGeoId + "…");
          var filtered = results.data.filter(function (r) {
            return String(r["BE GEO ID"] || "").trim() === beGeoId;
          });
          if (filtered.length === 0) {
            IDB.loadAll().then(function(e){restoreUploadSection(e);});
            alert("No rows found for BE GEO ID " + beGeoId + " in " + file.name + ".\nPlease check the ID and try again.");
            return;
          }
          updateLoaderMsg("Processing " + filtered.length + " rows…");
          APP_DATA = transformData(filtered);
          finishLoad(file.name + " · BE GEO ID " + beGeoId, APP_DATA.length, false, "cpi-" + beGeoId);
        } catch (err) {
          IDB.loadAll().then(function(e){restoreUploadSection(e);});
          console.error(err);
          alert("Error processing CPI file: " + err.message);
        }
      },
      error: function (err) {
        IDB.loadAll().then(function(e){restoreUploadSection(e);});
        alert("Error reading CSV: " + err.message);
      }
    });
  });
}

function renderActiveTab(target) {
  switch (target) {
    case "#tab-overview":  renderOverview(APP_DATA);  break;
    case "#tab-details":   renderDetails(APP_DATA);   break;
    case "#tab-customer":  renderCustomer(APP_DATA);  break;
    case "#tab-pvi":       renderPVI(APP_DATA);       break;
    case "#tab-lifecycle": renderLifecycle(APP_DATA); break;
    case "#tab-cpi-adopt": renderCPIAdopt(APP_DATA);  break;
  }
}

function resetApp() {
  APP_DATA = null;
  APP_FILE_META = null;
  var sb = document.getElementById("status-bar");
  sb.classList.remove("d-flex");
  sb.classList.add("d-none");
  document.getElementById("main-tab-bar").classList.add("d-none");

  // Clear all tab panes
  ["tab-overview","tab-details","tab-customer","tab-pvi","tab-lifecycle","tab-cpi-adopt"].forEach(function (id) {
    var pane = document.getElementById(id);
    if (pane) pane.innerHTML = "";
  });

  // Reload cache entries so resume cards show after reset
  IDB.loadAll().then(function (entries) {
    restoreUploadSection(entries);
  }).catch(function () {
    restoreUploadSection([]);
  });

  // Activate overview tab
  var overviewBtn = document.getElementById("tab-overview-btn");
  if (overviewBtn) {
    var bsTab = new bootstrap.Tab(overviewBtn);
    bsTab.show();
  }
}

window.APP_DATA        = APP_DATA;
window.resetApp        = resetApp;
window.renderActiveTab = renderActiveTab;

// Deep-link to Customer tab with a pre-filtered customer name
window.navigateToCustomer = function (crName) {
  var btn = document.querySelector('[data-bs-target="#tab-customer"]');
  if (!btn) return;
  window._custDeepLink = crName;
  var custPane = document.getElementById("tab-customer");
  if (custPane && custPane.classList.contains("active")) {
    renderCustomer(APP_DATA);
  } else {
    new bootstrap.Tab(btn).show();
  }
};
