// =============================================================================
// cpi-adopt.js — CPI Adopt tab renderer
// =============================================================================

var _cpiChart1 = null;
var _cpiChart2 = null;
var _cpiChart2b = null;
var _cpiChart3 = null;
var _cpiChart4 = null;
var _cpiChart5 = null;
var _cpiChart6 = null;
var _cpiChart7 = null;
var _cpiChart5Log = false;

function renderCPIAdopt(data) {
  var el = document.getElementById("tab-cpi-adopt");
  if (!el) return;

  function norm(x) {
    if (x === null || x === undefined) return "";
    return String(x).replace(/\u00A0/g, " ").trim().toUpperCase();
  }

  function fmtCurrency(v) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    return "$" + Math.round(v).toLocaleString();
  }

  function fmtPct(v) {
    if (!v || isNaN(v)) return "0.0%";
    return (v * 100).toFixed(1) + "%";
  }

  var PORTFOLIO_ORDER = ["Networking", "Security", "Cloud + AI Infrastructure", "Collaboration"];

  // Collect unique portfolios & offers
  var portfolioSet = new Set();
  data.forEach(function (r) { if (norm(r["Maximum Incentive Deal Flag"]) === "YES" && r["Deal CPI Portfolio"]) portfolioSet.add(r["Deal CPI Portfolio"]); });
  var portfolios = Array.from(portfolioSet).sort(function (a, b) {
    var ai = PORTFOLIO_ORDER.indexOf(a), bi = PORTFOLIO_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  var offersByPortfolio = {};
  portfolios.forEach(function (p) { offersByPortfolio[p] = new Set(); });
  data.forEach(function (r) {
    if (norm(r["Maximum Incentive Deal Flag"]) === "YES" && r["Deal CPI Portfolio"] && r["Track"]) {
      if (offersByPortfolio[r["Deal CPI Portfolio"]]) offersByPortfolio[r["Deal CPI Portfolio"]].add(r["Track"]);
    }
  });

  // ── Build HTML ─────────────────────────────────────────────────────────────
  var html = '<div class="slicer-row mb-3">';
  html += '<div class="d-flex flex-column"><label for="cpi-portfolio">Portfolio</label>';
  html += '<select id="cpi-portfolio" class="form-select form-select-sm" style="min-width:220px"><option value="">All Portfolios</option>';
  portfolios.forEach(function (p) { html += '<option value="' + p.replace(/"/g,"&quot;") + '">' + p + '</option>'; });
  html += '</select></div>';

  html += '<div class="d-flex flex-column"><label for="cpi-offer">Offer</label>';
  html += '<select id="cpi-offer" class="form-select form-select-sm" style="min-width:220px"><option value="">All Offers</option>';
  var allOffers = new Set();
  portfolios.forEach(function (p) { offersByPortfolio[p].forEach(function (o) { allOffers.add(o); }); });
  Array.from(allOffers).sort().forEach(function (o) { html += '<option value="' + o.replace(/"/g,"&quot;") + '">' + o + '</option>'; });
  html += '</select></div>';
  html += '</div>';

  html += '<div class="row g-4 mb-4">';

  // ── Stat charts row: Eligible-only pie | Eligible+Expired pie | Earned by Portfolio
  html += '<div class="col-12 col-lg-4">';
  html += '<div class="card shadow-sm h-100"><div class="card-header fw-semibold d-flex align-items-center justify-content-between flex-wrap gap-1"><span>Incentives <i class="bi bi-info-circle text-muted ms-1" style="font-size:0.75rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="top" title="Breakdown of incentives."></i></span><div class="btn-group btn-group-sm" id="cpi-incentive-mode"><button type="button" class="btn btn-outline-primary active" data-mode="eligible">Eligible</button><button type="button" class="btn btn-outline-primary" data-mode="eligible-expired">Eligible &amp; Expired</button></div></div><div class="card-body">';
  html += '<div class="chart-container" style="min-height:220px;height:220px"><canvas id="cpi-chart2b"></canvas></div>';
  html += '<div id="cpi-ratio-incentive" class="text-center mt-2"></div>';
  html += '</div></div></div>';

  html += '<div class="col-12 col-lg-4">';
  html += '<div class="card shadow-sm h-100"><div class="card-header fw-semibold d-flex justify-content-between align-items-center"><span>Current Potential Incentives <i class="bi bi-info-circle text-muted ms-1" style="font-size:0.75rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="top" title="Remaining potential incentives for opted-in Eligible deals, per portfolio."></i></span><span id="cpi-chart7-total" class="fw-normal text-muted"></span></div><div class="card-body">';
  html += '<div class="chart-container" style="min-height:220px;height:220px"><canvas id="cpi-chart7"></canvas></div>';
  html += '</div></div></div>';

  html += '<div class="col-12 col-lg-4">';
  html += '<div class="card shadow-sm h-100"><div class="card-header fw-semibold d-flex justify-content-between align-items-center"><span>Total Estimated Earned Incentives <i class="bi bi-info-circle text-muted ms-1" style="font-size:0.75rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="top" title="Total estimated earned incentives per portfolio (all-time, not filtered by FY)."></i></span><span id="cpi-chart6-total" class="fw-normal text-muted"></span></div><div class="card-body">';
  html += '<div class="chart-container" style="min-height:220px;height:220px"><canvas id="cpi-chart6"></canvas></div>';
  html += '</div></div></div>';

  html += '</div>'; // stat charts row

  // ── Monthly charts group with shared FY toggle
  html += '<div class="card shadow-sm mb-2">';
  html += '<div class="card-header fw-semibold d-flex align-items-center justify-content-between flex-wrap gap-2">';
  html += '<span>Monthly Trends <small class="fw-normal">for Opted-in UCs</small></span>';
  html += '<div class="d-flex align-items-center gap-2">';
  html += '<div class="btn-group btn-group-sm" id="cpi-fy-toggle" role="group"></div>';
  html += '<div class="form-check form-switch mb-0 ms-2"><input class="form-check-input" type="checkbox" id="cpi-log-toggle"><label class="form-check-label small" for="cpi-log-toggle">Log scale</label></div>';
  html += '</div></div>';
  html += '<div class="card-body">';
  html += '<div class="row g-4">';

  html += '<div class="col-12 col-lg-4">';
  html += '<div class="fw-semibold small mb-2">Opt-in <i class="bi bi-info-circle text-muted" style="font-size:0.75rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="top" title="Number of opt-ins during the selected fiscal year."></i></div>';
  html += '<div class="chart-container" style="min-height:260px;height:260px"><canvas id="cpi-chart3"></canvas></div>';
  html += '</div>';

  html += '<div class="col-12 col-lg-4">';
  html += '<div class="fw-semibold small mb-2">Use Case Progression <i class="bi bi-info-circle text-muted" style="font-size:0.75rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="top" title="Number of UCs that have progressed during the selected fiscal year. No double-count within a month."></i></div>';
  html += '<div class="chart-container" style="min-height:260px;height:260px"><canvas id="cpi-chart4"></canvas></div>';
  html += '</div>';

  html += '<div class="col-12 col-lg-4">';
  html += '<div class="fw-semibold small mb-2 d-flex justify-content-between align-items-center">';
  html += '<span>Estimated Earned Incentives <i class="bi bi-info-circle text-muted" style="font-size:0.75rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="top" title="Amount of estimated earned incentives during the selected fiscal year."></i></span>';
  html += '<span id="cpi-chart5-total" class="text-muted fw-normal"></span>';
  html += '</div>';
  html += '<div class="chart-container" style="min-height:260px;height:260px"><canvas id="cpi-chart5"></canvas></div>';
  html += '</div>';

  html += '</div>'; // inner row
  html += '</div></div>'; // card-body + card

  el.innerHTML = html;

  // Initialise tooltips
  el.querySelectorAll("[data-bs-toggle='tooltip']").forEach(function (t) { new bootstrap.Tooltip(t, { html: false }); });

  // ── Compute available FY years from data date fields
  // FY N = Aug (N-1) → Jul N.  e.g. FY26 = Aug 2025 → Jul 2026
  var DATE_FIELDS_FOR_FY = [
    "Adopt Rebate Start Date",
    "Stage Completion Date(onboard)",
    "Stage Completion Date(Use)",
    "Stage Completion Date(Engage)",
    "Stage Completion Date(Adopt)"
  ];
  var fyYears = new Set();
  data.forEach(function (r) {
    DATE_FIELDS_FOR_FY.forEach(function (f) {
      var d = new Date(r[f]);
      if (isNaN(d.getTime())) return;
      // FY year: if month >= July (7), FY = year+1, else FY = year
      var fy = d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear();
      fyYears.add(fy);
    });
  });
  var fyList = Array.from(fyYears).sort(function (a, b) { return a - b; }); // ascending (oldest left, newest right)

  // Determine current FY
  var _now = new Date();
  var _currentFY = _now.getMonth() >= 7 ? _now.getFullYear() + 1 : _now.getFullYear();
  var _selectedFY = fyList.indexOf(_currentFY) !== -1 ? _currentFY : (fyList[0] || _currentFY);

  // Build FY toggle buttons
  var fyToggleEl = document.getElementById("cpi-fy-toggle");
  fyList.forEach(function (fy) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-primary" + (fy === _selectedFY ? " active" : "");
    btn.textContent = "FY" + String(fy).slice(-2);
    btn.dataset.fy = fy;
    fyToggleEl.appendChild(btn);
  });

  fyToggleEl.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-fy]");
    if (!btn) return;
    _selectedFY = parseInt(btn.dataset.fy, 10);
    fyToggleEl.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", parseInt(b.dataset.fy, 10) === _selectedFY); });
    if (window.APP_FILTER_STATE && window.APP_FILTER_STATE.cpiAdopt) window.APP_FILTER_STATE.cpiAdopt.selectedFY = _selectedFY;
    buildMonthlyCharts(document.getElementById("cpi-portfolio").value, document.getElementById("cpi-offer").value);
  });

  // Portfolio change → refresh offer list
  document.getElementById("cpi-portfolio").addEventListener("change", function () {
    var pf = this.value;
    var offerSel = document.getElementById("cpi-offer");
    offerSel.innerHTML = '<option value="">All Offers</option>';
    var ofrs = pf ? Array.from(offersByPortfolio[pf] || []).sort() : Array.from(allOffers).sort();
    ofrs.forEach(function (o) { offerSel.innerHTML += '<option value="' + o.replace(/"/g,"&quot;") + '">' + o + '</option>'; });
    buildCharts(pf, "");
  });

  document.getElementById("cpi-offer").addEventListener("change", function () {
    buildCharts(document.getElementById("cpi-portfolio").value, this.value);
  });

  document.getElementById("cpi-log-toggle").addEventListener("change", function () {
    _cpiChart5Log = this.checked;
    if (window.APP_FILTER_STATE && window.APP_FILTER_STATE.cpiAdopt) window.APP_FILTER_STATE.cpiAdopt.logScale = _cpiChart5Log;
    buildMonthlyCharts(document.getElementById("cpi-portfolio").value, document.getElementById("cpi-offer").value);
  });

  // Restore persisted filter state
  var _cpiSaved = window.APP_FILTER_STATE && window.APP_FILTER_STATE.cpiAdopt;
  if (_cpiSaved) {
    var _cpiPfEl = document.getElementById("cpi-portfolio");
    var _cpiOfEl = document.getElementById("cpi-offer");
    if (_cpiSaved.portfolio && _cpiPfEl) {
      _cpiPfEl.value = _cpiSaved.portfolio;
      _cpiOfEl.innerHTML = '<option value="">All Offers</option>';
      Array.from(offersByPortfolio[_cpiSaved.portfolio] || []).sort().forEach(function(o){
        _cpiOfEl.innerHTML += '<option value="'+o.replace(/"/g,'&quot;')+'">'+o+'</option>';
      });
    }
    if (_cpiSaved.offer && _cpiOfEl) _cpiOfEl.value = _cpiSaved.offer;
    if (_cpiSaved.selectedFY && fyList.indexOf(_cpiSaved.selectedFY) !== -1) {
      _selectedFY = _cpiSaved.selectedFY;
      fyToggleEl.querySelectorAll("button").forEach(function(b){ b.classList.toggle("active", parseInt(b.dataset.fy,10) === _selectedFY); });
    }
    if (_cpiSaved.logScale) {
      _cpiChart5Log = true;
      var _logEl = document.getElementById("cpi-log-toggle");
      if (_logEl) _logEl.checked = true;
    }
  }

  buildCharts(
    (document.getElementById("cpi-portfolio") || {value:""}).value,
    (document.getElementById("cpi-offer")     || {value:""}).value
  );

  function buildCharts(portfolioFilter, offerFilter) {
    if (window.APP_FILTER_STATE) {
      var _prevIncentiveMode = window.APP_FILTER_STATE.cpiAdopt && window.APP_FILTER_STATE.cpiAdopt.incentiveMode;
      window.APP_FILTER_STATE.cpiAdopt = { portfolio: portfolioFilter, offer: offerFilter, selectedFY: _selectedFY, logScale: _cpiChart5Log, incentiveMode: _prevIncentiveMode || "eligible" };
    }
    buildStatCharts(portfolioFilter, offerFilter);
    buildMonthlyCharts(portfolioFilter, offerFilter);
  }

  function buildStatCharts(portfolioFilter, offerFilter) {
    // Filter: MaxFlag=Yes, apply portfolio+offer filters
    var subset = data.filter(function (r) {
      if (norm(r["Maximum Incentive Deal Flag"]) !== "YES") return false;
      if (portfolioFilter && r["Deal CPI Portfolio"] !== portfolioFilter) return false;
      if (offerFilter     && r["Track"] !== offerFilter)                   return false;
      return true;
    });

    // Compute measures
    var eligTotalMax    = 0; // Revised Max for eligible deals
    var totalMax        = 0; // Revised Max for eligible+expired deals
    var eligEarned      = 0; // Estimated Earned for opted-in eligible
    var eligMissed      = 0; // Missed for opted-in eligible
    var eligPotential   = 0; // Potential Incentives for opted-in eligible
    var eligNotOptedMax = 0; // Revised Max for not-opted-in eligible
    var allEarned       = 0; // Estimated Earned for opted-in eligible+expired
    var allMissed       = 0; // Missed for opted-in eligible+expired
    var allPotential    = 0; // Potential Incentives for opted-in eligible+expired
    var allNotOptedMax  = 0; // Revised Max for not-opted-in eligible+expired
    var allExpired      = 0; // Revised Max - Earned for opted-in expired (no potential)
    var eligOptedMax    = 0; // Revised Max for opted-in eligible (for ratio)
    var allOptedMax     = 0; // Revised Max for opted-in eligible+expired (for ratio)

    subset.forEach(function (r) {
      var maxIncentive = parseFloat(r["Revised Maximum Incentive Amount"]) || 0;
      var isEligible   = norm(r["Stage"]) === "ELIGIBLE";
      var isExpired    = norm(r["Stage"]) === "EXPIRED";
      var isOptedIn    = norm(r["Adopt Rebate Opt-In Status"]) === "OPTED IN";

      if (isEligible) eligTotalMax += maxIncentive;
      if (isEligible || isExpired) totalMax += maxIncentive;

      if (isEligible) {
        if (isOptedIn) {
          eligOptedMax  += maxIncentive;
          eligEarned    += parseFloat(r["Estimated Earned Incentives"]) || 0;
          eligMissed    += parseFloat(r["Missed Incentives"]) || 0;
          eligPotential += parseFloat(r["Potential Incentives"]) || 0;
        } else {
          eligNotOptedMax += maxIncentive;
        }
      }
      if (isEligible || isExpired) {
        if (isOptedIn) {
          allOptedMax  += maxIncentive;
          allEarned    += parseFloat(r["Estimated Earned Incentives"]) || 0;
          allMissed    += parseFloat(r["Missed Incentives"]) || 0;
          allPotential += parseFloat(r["Potential Incentives"]) || 0;
          if (isExpired) {
            allExpired += Math.max(0, maxIncentive - (parseFloat(r["Estimated Earned Incentives"]) || 0));
          }
        } else {
          allNotOptedMax += maxIncentive;
        }
      }
    });

    // ── Chart 2b: Pie — breakdown using Potential Incentives field, with toggle
    var _incentiveMode = (_cpiSaved && _cpiSaved.incentiveMode) ? _cpiSaved.incentiveMode : "eligible";
    var _incentiveDatasets = {
      "eligible": {
        data:   [eligEarned, eligPotential, eligNotOptedMax, eligMissed],
        labels: ["Earned", "Potential", "Not opted-in", "Missed"],
        colors: ["#107C10", "#00BCF2", "#D0D0D0", "#D13438"],
        optedInSlices: 2,
        total: eligTotalMax, optedMax: eligOptedMax
      },
      "eligible-expired": {
        data:   [allEarned, allPotential, allExpired, allNotOptedMax, allMissed],
        labels: ["Earned", "Potential", "Expired", "Not opted-in", "Missed"],
        colors: ["#107C10", "#00BCF2", "#FF8C00", "#D0D0D0", "#D13438"],
        optedInSlices: 3,
        total: totalMax, optedMax: allOptedMax
      }
    };

    function renderIncentiveRatio(mode) {
      var ds = _incentiveDatasets[mode];
      var pct = ds.total > 0 ? Math.round(ds.optedMax / ds.total * 100) : 0;
      document.getElementById("cpi-ratio-incentive").innerHTML =
        '<span style="font-size:1rem;font-weight:600;color:#00BCF2">' + pct + '% opted-in</span>' +
        '<span class="text-muted small ms-2">(' + fmtCurrency(ds.optedMax) + ' / ' + fmtCurrency(ds.total) + ')</span>';
    }

    if (_cpiChart2b) { _cpiChart2b.destroy(); _cpiChart2b = null; }
    if (_cpiChart2)  { _cpiChart2.destroy();  _cpiChart2  = null; }
    var ctx2b = document.getElementById("cpi-chart2b").getContext("2d");
    var _currentIncentiveTotal = eligTotalMax;

    var optedInArcPlugin = {
      id: "optedInArc",
      afterDatasetsDraw: function (chart) {
        var meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || meta.data.length < 2) return;
        var arc0 = meta.data[0];
        var lastOptedInIdx = chart.data._optedInSlices - 1;
        var arcLast = meta.data[lastOptedInIdx];
        if (!arc0 || !arcLast) return;
        if ((arc0.circumference || 0) <= 0) return;
        var c = chart.ctx;
        var outerR = arc0.outerRadius + 6;
        var cx = arc0.x, cy = arc0.y;
        var startAngle = arc0.startAngle;
        var endAngle   = arcLast.endAngle;
        c.save();
        c.beginPath();
        c.arc(cx, cy, outerR, startAngle, endAngle);
        c.strokeStyle = "#555";
        c.lineWidth = 2.5;
        c.stroke();
        var drawTick = function (angle) {
          c.beginPath();
          c.moveTo(cx + Math.cos(angle) * (outerR - 3), cy + Math.sin(angle) * (outerR - 3));
          c.lineTo(cx + Math.cos(angle) * (outerR + 3), cy + Math.sin(angle) * (outerR + 3));
          c.stroke();
        };
        drawTick(startAngle);
        drawTick(endAngle);
        // leader line from arc quarter point → 3 o'clock position
        var quarterAngle = startAngle + (endAngle - startAngle) * 0.25;
        var lx1 = cx + Math.cos(quarterAngle) * outerR;
        var ly1 = cy + Math.sin(quarterAngle) * outerR;
        var rightX = cx + arc0.outerRadius + 10;
        var rightY = cy; // 3 o'clock
        c.beginPath();
        c.moveTo(lx1, ly1);
        c.lineTo(rightX, rightY);
        c.strokeStyle = "#888";
        c.lineWidth = 1;
        c.stroke();
        c.fillStyle = "#555";
        c.font = "bold 9px sans-serif";
        c.textAlign = "left";
        c.textBaseline = "middle";
        c.fillText("Opted-in", rightX + 4, rightY);
        c.restore();
      }
    };

    _cpiChart2b = new Chart(ctx2b, {
      type: "doughnut",
      data: {
        labels: _incentiveDatasets[_incentiveMode].labels.slice(),
        _optedInSlices: _incentiveDatasets[_incentiveMode].optedInSlices,
        datasets: [{
          data: _incentiveDatasets[_incentiveMode].data.slice(),
          backgroundColor: _incentiveDatasets[_incentiveMode].colors.slice(),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 10, right: 28, bottom: 0, left: 28 } },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.raw;
                var pct = _currentIncentiveTotal > 0 ? " (" + Math.round(v / _currentIncentiveTotal * 100) + "%)" : "";
                var fmt = Math.abs(v) >= 1000000 ? "$"+(v/1000000).toFixed(2)+"M"
                        : Math.abs(v) >= 1000    ? "$"+(v/1000).toFixed(1)+"K"
                        : "$"+Math.round(v).toLocaleString();
                return ctx.label + ": " + fmt + pct;
              }
            }
          }
        }
      },
      plugins: [optedInArcPlugin]
    });
    renderIncentiveRatio(_incentiveMode);

    // Apply active button state for restored mode
    var incentiveModeEl = document.getElementById("cpi-incentive-mode");
    if (incentiveModeEl) {
      incentiveModeEl.querySelectorAll("button").forEach(function(b){ b.classList.toggle("active", b.dataset.mode === _incentiveMode); });
      incentiveModeEl.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-mode]");
        if (!btn) return;
        _incentiveMode = btn.dataset.mode;
        if (window.APP_FILTER_STATE && window.APP_FILTER_STATE.cpiAdopt) window.APP_FILTER_STATE.cpiAdopt.incentiveMode = _incentiveMode;
        incentiveModeEl.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b.dataset.mode === _incentiveMode); });
        var ds = _incentiveDatasets[_incentiveMode];
        _currentIncentiveTotal = ds.total;
        _cpiChart2b.data.labels = ds.labels.slice();
        _cpiChart2b.data._optedInSlices = ds.optedInSlices;
        _cpiChart2b.data.datasets[0].data = ds.data.slice();
        _cpiChart2b.data.datasets[0].backgroundColor = ds.colors.slice();
        _cpiChart2b.update();
        renderIncentiveRatio(_incentiveMode);
      });
    }

    // ── Chart 6: Total Earned by Portfolio (all-time, not FY-filtered)
    var PORTFOLIO_COLORS = {
      "Networking":               "#00BCF2",
      "Security":                 "#E55400",
      "Cloud + AI Infrastructure":"#6BB700",
      "Collaboration":            "#7B3F91"
    };
    var EARN_STAGES = [
      { flagField: "Stage Completion Flag(onboard)", dateField: "Stage Completion Date(onboard)", amtField: "Estimated Incentive Amount(Onboard)" },
      { flagField: "Stage Completion Flag(Use)",     dateField: "Stage Completion Date(Use)",     amtField: "Estimated Incentive Amount(Use)"     },
      { flagField: "Stage Completion Flag(Engage)",  dateField: "Stage Completion Date(Engage)",  amtField: "Estimated Incentive Amount(Engage)"  },
      { flagField: "Stage Completion Flag(Adopt)",   dateField: "Stage Completion Date(Adopt)",   amtField: "Estimated Incentive Amount(Adopt)"   }
    ];
    var allEarnByPortfolio = {};
    var allEarnPortfolios = portfolioFilter ? [portfolioFilter] : portfolios;
    allEarnPortfolios.forEach(function (p) { allEarnByPortfolio[p] = 0; });
    subset.forEach(function (r) {
      if (!r["Earned?"]) return;
      var p = r["Deal CPI Portfolio"];
      if (!p || allEarnByPortfolio[p] === undefined) return;
      var lciStart = new Date(r["Adopt Rebate Start Date"]);
      var expiry   = new Date(r["Deal Incentive Expiry Date"]);
      if (isNaN(lciStart.getTime()) || isNaN(expiry.getTime())) return;
      EARN_STAGES.forEach(function (s) {
        if (norm(r[s.flagField]) !== "YES") return;
        var d = new Date(r[s.dateField]);
        if (isNaN(d.getTime()) || d < lciStart || d > expiry) return;
        allEarnByPortfolio[p] += parseFloat(r[s.amtField]) || 0;
      });
    });
    var chart6Portfolios = allEarnPortfolios.filter(function (p) { return allEarnByPortfolio[p] > 0; });
    chart6Portfolios.sort(function (a, b) { return allEarnByPortfolio[b] - allEarnByPortfolio[a]; });
    var chart6GrandTotal = chart6Portfolios.reduce(function (s, p) { return s + allEarnByPortfolio[p]; }, 0);
    var chart6TotalFmt = Math.abs(chart6GrandTotal) >= 1000000 ? "$"+(chart6GrandTotal/1000000).toFixed(2)+"M"
                       : Math.abs(chart6GrandTotal) >= 1000    ? "$"+(chart6GrandTotal/1000).toFixed(1)+"K"
                       : "$"+Math.round(chart6GrandTotal).toLocaleString();
    var t6El = document.getElementById("cpi-chart6-total");
    if (t6El) { t6El.textContent = "Total: " + chart6TotalFmt; t6El.style.fontSize = "1rem"; t6El.style.fontWeight = "600"; t6El.style.color = "#555"; }
    var chart6Colors = chart6Portfolios.map(function (p, idx) {
      var fallback = ["#00BCF2","#E55400","#6BB700","#7B3F91","#FF8C00","#005B99"];
      return PORTFOLIO_COLORS[p] || fallback[idx % fallback.length];
    });
    if (_cpiChart6) { _cpiChart6.destroy(); _cpiChart6 = null; }
    var ctx6 = document.getElementById("cpi-chart6").getContext("2d");
    _cpiChart6 = new Chart(ctx6, {
      type: "bar",
      data: {
        labels: chart6Portfolios,
        datasets: [{
          label: "Earned",
          data: chart6Portfolios.map(function (p) { return allEarnByPortfolio[p]; }),
          backgroundColor: chart6Colors
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: function (v) {
              if (Math.abs(v) >= 1000000) return "$"+(v/1000000).toFixed(1)+"M";
              if (Math.abs(v) >= 1000)    return "$"+(v/1000).toFixed(0)+"K";
              return "$"+Math.round(v).toLocaleString();
            }}
          },
          y: { grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.raw;
                var fmt = Math.abs(v) >= 1000000 ? "$"+(v/1000000).toFixed(2)+"M"
                        : Math.abs(v) >= 1000    ? "$"+(v/1000).toFixed(1)+"K"
                        : "$"+Math.round(v).toLocaleString();
                return "Earned: " + fmt;
              }
            }
          }
        }
      }
    });

    // ── Chart 7: Potential Incentives by Portfolio (from Potential Incentives field, eligible opted-in)
    var potByPortfolio = {};
    var potPortfolios = portfolioFilter ? [portfolioFilter] : portfolios;
    potPortfolios.forEach(function (p) { potByPortfolio[p] = 0; });
    subset.forEach(function (r) {
      var isEligible = norm(r["Stage"]) === "ELIGIBLE";
      var isOptedIn  = norm(r["Adopt Rebate Opt-In Status"]) === "OPTED IN";
      if (!isEligible || !isOptedIn) return;
      var p = r["Deal CPI Portfolio"];
      if (!p || potByPortfolio[p] === undefined) return;
      potByPortfolio[p] += parseFloat(r["Potential Incentives"]) || 0;
    });
    var chart7Portfolios = potPortfolios.filter(function (p) { return potByPortfolio[p] > 0; });
    chart7Portfolios.sort(function (a, b) { return potByPortfolio[b] - potByPortfolio[a]; });
    var chart7GrandTotal = chart7Portfolios.reduce(function (s, p) { return s + potByPortfolio[p]; }, 0);
    var chart7TotalFmt = Math.abs(chart7GrandTotal) >= 1000000 ? "$"+(chart7GrandTotal/1000000).toFixed(2)+"M"
                       : Math.abs(chart7GrandTotal) >= 1000    ? "$"+(chart7GrandTotal/1000).toFixed(1)+"K"
                       : "$"+Math.round(chart7GrandTotal).toLocaleString();
    var t7El = document.getElementById("cpi-chart7-total");
    if (t7El) { t7El.textContent = "Total: " + chart7TotalFmt; t7El.style.fontSize = "1rem"; t7El.style.fontWeight = "600"; t7El.style.color = "#555"; }
    var chart7Colors = chart7Portfolios.map(function (p, idx) {
      var fallback = ["#00BCF2","#E55400","#6BB700","#7B3F91","#FF8C00","#005B99"];
      return PORTFOLIO_COLORS[p] || fallback[idx % fallback.length];
    });
    if (_cpiChart7) { _cpiChart7.destroy(); _cpiChart7 = null; }
    var ctx7 = document.getElementById("cpi-chart7").getContext("2d");
    _cpiChart7 = new Chart(ctx7, {
      type: "bar",
      data: {
        labels: chart7Portfolios,
        datasets: [{
          label: "Potential",
          data: chart7Portfolios.map(function (p) { return potByPortfolio[p]; }),
          backgroundColor: chart7Colors
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: function (v) {
              if (Math.abs(v) >= 1000000) return "$"+(v/1000000).toFixed(1)+"M";
              if (Math.abs(v) >= 1000)    return "$"+(v/1000).toFixed(0)+"K";
              return "$"+Math.round(v).toLocaleString();
            }}
          },
          y: { grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.raw;
                var fmt = Math.abs(v) >= 1000000 ? "$"+(v/1000000).toFixed(2)+"M"
                        : Math.abs(v) >= 1000    ? "$"+(v/1000).toFixed(1)+"K"
                        : "$"+Math.round(v).toLocaleString();
                return "Potential: " + fmt;
              }
            }
          }
        }
      }
    });
  }  // end buildStatCharts

  function buildMonthlyCharts(portfolioFilter, offerFilter) {
    var subset = data.filter(function (r) {
      if (norm(r["Maximum Incentive Deal Flag"]) !== "YES") return false;
      if (portfolioFilter && r["Deal CPI Portfolio"] !== portfolioFilter) return false;
      if (offerFilter     && r["Track"] !== offerFilter)                   return false;
      return true;
    });

    // ── Chart 3: Opt-in trend — deals opted-in per month, per portfolio
    var PORTFOLIO_COLORS = {
      "Networking":               "#00BCF2",
      "Security":                 "#E55400",
      "Cloud + AI Infrastructure":"#6BB700",
      "Collaboration":            "#7B3F91"
    };

    // Build 12 month buckets for the selected FY (Aug → Jul)
    // FY N: months Aug(N-1), Sep(N-1), ..., Jul(N)
    var fyStartYear = _selectedFY - 1; // Aug of this year starts the FY
    var monthLabels = [];
    var monthStarts = [];
    for (var mi = 0; mi < 12; mi++) {
      var mDate = new Date(fyStartYear, 7 + mi, 1); // month 7 = August; JS Date handles overflow into next year
      monthLabels.push(mDate.toLocaleString("default", { month: "short" }) + " '" + String(mDate.getFullYear()).slice(-2));
      monthStarts.push(mDate);
    }

    // Deals: MaxFlag=YES, Stage ELIGIBLE or EXPIRED, opted-in, apply offer filter
    var trendPortfolios = portfolioFilter ? [portfolioFilter] : portfolios;
    var trendCounts = {};
    trendPortfolios.forEach(function (p) { trendCounts[p] = new Array(12).fill(0); });

    data.forEach(function (r) {
      if (norm(r["Maximum Incentive Deal Flag"]) !== "YES") return;
      if (offerFilter && r["Track"] !== offerFilter) return;
      var st = norm(r["Stage"]);
      if (st !== "ELIGIBLE" && st !== "EXPIRED") return;
      if (norm(r["Adopt Rebate Opt-In Status"]) !== "OPTED IN") return;
      var p = r["Deal CPI Portfolio"];
      if (!p || !trendCounts[p]) return;
      var d = new Date(r["Adopt Rebate Start Date"]);
      if (isNaN(d.getTime())) return;
      for (var i = 0; i < 12; i++) {
        var start = monthStarts[i];
        var end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        if (d >= start && d < end) { trendCounts[p][i]++; break; }
      }
    });

    var trendDatasets = trendPortfolios.map(function (p, idx) {
      var fallbackColors = ["#00BCF2","#E55400","#6BB700","#7B3F91","#FF8C00","#005B99"];
      var color = PORTFOLIO_COLORS[p] || fallbackColors[idx % fallbackColors.length];
      return {
        label: p,
        data: trendCounts[p],
        borderColor: color,
        backgroundColor: color,
        tension: 0.35,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    });

    if (_cpiChart3) { _cpiChart3.destroy(); _cpiChart3 = null; }
    var ctx3 = document.getElementById("cpi-chart3").getContext("2d");
    _cpiChart3 = new Chart(ctx3, {
      type: "line",
      data: { labels: monthLabels, datasets: trendDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: "# Deals Opted-in" }
          }
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ": " + ctx.raw + " deal" + (ctx.raw !== 1 ? "s" : "");
              }
            }
          }
        }
      }
    });

    // ── Chart 4: Progression trend — unique deals that progressed per month, per portfolio
    // A deal is counted in month M if any of its stage completion dates falls in month M.
    // Each deal counted at most once per month regardless of how many stages it completed.
    var STAGE_DATE_FIELDS = [
      "Stage Completion Date (Purchase)",
      "Stage Completion Date(onboard)",
      "Stage Completion Date (Implement)",
      "Stage Completion Date(Use)",
      "Stage Completion Date(Engage)",
      "Stage Completion Date(Adopt)"
    ];

    var progCounts = {};
    trendPortfolios.forEach(function (p) { progCounts[p] = new Array(12).fill(0); });

    data.forEach(function (r) {
      if (norm(r["Maximum Incentive Deal Flag"]) !== "YES") return;
      if (offerFilter && r["Track"] !== offerFilter) return;
      var st = norm(r["Stage"]);
      if (st !== "ELIGIBLE" && st !== "EXPIRED") return;
      if (norm(r["Adopt Rebate Opt-In Status"]) !== "OPTED IN") return;
      var p = r["Deal CPI Portfolio"];
      if (!p || !progCounts[p]) return;

      // Collect all valid stage completion dates for this deal
      var completionDates = [];
      STAGE_DATE_FIELDS.forEach(function (f) {
        var d = new Date(r[f]);
        if (!isNaN(d.getTime())) completionDates.push(d);
      });
      if (completionDates.length === 0) return;

      // For each month bucket, count this deal at most once if any completion date falls in it
      for (var i = 0; i < 12; i++) {
        var start = monthStarts[i];
        var end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        var progressed = completionDates.some(function (d) { return d >= start && d < end; });
        if (progressed) progCounts[p][i]++;
      }
    });

    var progDatasets = trendPortfolios.map(function (p, idx) {
      var fallbackColors = ["#00BCF2","#E55400","#6BB700","#7B3F91","#FF8C00","#005B99"];
      var color = PORTFOLIO_COLORS[p] || fallbackColors[idx % fallbackColors.length];
      return {
        label: p,
        data: progCounts[p],
        borderColor: color,
        backgroundColor: color,
        tension: 0.35,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    });

    if (_cpiChart4) { _cpiChart4.destroy(); _cpiChart4 = null; }
    var ctx4 = document.getElementById("cpi-chart4").getContext("2d");
    _cpiChart4 = new Chart(ctx4, {
      type: "line",
      data: { labels: monthLabels, datasets: progDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: "# Deals Progressed" }
          }
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ": " + ctx.raw + " deal" + (ctx.raw !== 1 ? "s" : "");
              }
            }
          }
        }
      }
    });

    // ── Chart 5: Monthly Estimated Earned Incentives (Portfolio)
    // Mirror the exact per-stage conditions used in transform.js step 13:
    //   Stage Completion Flag = YES, completionDate >= lciStart, completionDate <= expiry
    var EARN_STAGES = [
      { flagField: "Stage Completion Flag(onboard)", dateField: "Stage Completion Date(onboard)", amtField: "Estimated Incentive Amount(Onboard)" },
      { flagField: "Stage Completion Flag(Use)",     dateField: "Stage Completion Date(Use)",     amtField: "Estimated Incentive Amount(Use)"     },
      { flagField: "Stage Completion Flag(Engage)",  dateField: "Stage Completion Date(Engage)",  amtField: "Estimated Incentive Amount(Engage)"  },
      { flagField: "Stage Completion Flag(Adopt)",   dateField: "Stage Completion Date(Adopt)",   amtField: "Estimated Incentive Amount(Adopt)"   }
    ];

    // Use the same portfolio list as Charts 3 & 4
    var earnPortfolios = portfolioFilter ? [portfolioFilter] : trendPortfolios;

    // earnedByPortfolio[portfolio][monthIndex] = total earned amount
    var earnedByPortfolio = {};
    earnPortfolios.forEach(function (p) { earnedByPortfolio[p] = new Array(12).fill(0); });

    subset.forEach(function (r) {
      if (!r["Earned?"]) return;
      var p = r["Deal CPI Portfolio"];
      if (!p || !earnedByPortfolio[p]) return;
      var lciStart = new Date(r["Adopt Rebate Start Date"]);
      var expiry   = new Date(r["Deal Incentive Expiry Date"]);
      if (isNaN(lciStart.getTime()) || isNaN(expiry.getTime())) return;
      EARN_STAGES.forEach(function (s) {
        if (norm(r[s.flagField]) !== "YES") return;
        var d = new Date(r[s.dateField]);
        if (isNaN(d.getTime())) return;
        if (d < lciStart || d > expiry) return;
        var amt = parseFloat(r[s.amtField]) || 0;
        if (amt === 0) return;
        for (var i = 0; i < 12; i++) {
          var start = monthStarts[i];
          var end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
          if (d >= start && d < end) { earnedByPortfolio[p][i] += amt; break; }
        }
      });
    });

    var earnFallbackColors = ["#00BCF2","#E55400","#6BB700","#7B3F91","#FF8C00","#005B99"];
    var earnDatasets = earnPortfolios.map(function (p, idx) {
      var color = PORTFOLIO_COLORS[p] || earnFallbackColors[idx % earnFallbackColors.length];
      return {
        label: p,
        data: earnedByPortfolio[p],
        backgroundColor: color
      };
    });

    // Compute grand total across all portfolios and months
    var earnTotal = 0;
    earnPortfolios.forEach(function (p) {
      earnedByPortfolio[p].forEach(function (v) { earnTotal += v; });
    });
    var earnTotalFmt = Math.abs(earnTotal) >= 1000000 ? "$" + (earnTotal / 1000000).toFixed(2) + "M"
                     : Math.abs(earnTotal) >= 1000    ? "$" + (earnTotal / 1000).toFixed(1) + "K"
                     : "$" + Math.round(earnTotal).toLocaleString();
    var totalEl = document.getElementById("cpi-chart5-total");
    if (totalEl) { totalEl.textContent = "Total: " + earnTotalFmt; totalEl.style.fontSize = "1rem"; totalEl.style.fontWeight = "600"; totalEl.style.color = "#555"; }

    if (_cpiChart5) { _cpiChart5.destroy(); _cpiChart5 = null; }
    var ctx5 = document.getElementById("cpi-chart5").getContext("2d");
    _cpiChart5 = new Chart(ctx5, {
      type: "bar",
      data: { labels: monthLabels, datasets: earnDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { display: false }
          },
          y: {
            stacked: true,
            type: _cpiChart5Log ? "logarithmic" : "linear",
            beginAtZero: true,
            ticks: {
              callback: function (v) {
                if (Math.abs(v) >= 1000000) return "$" + (v / 1000000).toFixed(1) + "M";
                if (Math.abs(v) >= 1000)    return "$" + (v / 1000).toFixed(0) + "K";
                return "$" + Math.round(v).toLocaleString();
              }
            },
            title: { display: true, text: "Estimated Earned ($)" }
          }
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.raw;
                var fmt = Math.abs(v) >= 1000000 ? "$"+(v/1000000).toFixed(2)+"M"
                        : Math.abs(v) >= 1000    ? "$"+(v/1000).toFixed(1)+"K"
                        : "$"+Math.round(v).toLocaleString();
                return ctx.dataset.label + ": " + fmt;
              }
            }
          }
        }
      }
    });
  }
}

window.renderCPIAdopt = renderCPIAdopt;
