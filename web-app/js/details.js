// =============================================================================
// details.js — Details tab renderer
// =============================================================================

function renderDetails(data) {
  var el = document.getElementById("tab-details");
  if (!el) return;

  function norm(x) {
    if (x === null || x === undefined) return "";
    return String(x).replace(/\u00A0/g, " ").trim().toUpperCase();
  }

  function escHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function fmtCurrency(v) {
    if (v === null || v === undefined || isNaN(v) || v === 0) return "-";
    return "$" + Math.round(v).toLocaleString();
  }

  function fmtDate(v) {
    if (!v) return "";
    var d = (v instanceof Date) ? v : (typeof v === "number" ? new Date(Math.round((v-25569)*86400*1000)) : new Date(v));
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString(window.APP_LOCALE);
  }

  function toDate(x) {
    if (!x) return null;
    if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
    if (typeof x === "number" && x > 1000) { var d=new Date(Math.round((x-25569)*86400*1000)); return isNaN(d.getTime())?null:d; }
    if (typeof x === "string") { var d2=new Date(x); return isNaN(d2.getTime())?null:d2; }
    return null;
  }

  function epochDay(d) { return Math.floor(d.getTime() / 86400000); }

  // ── Active filters state
  var filters = {
    stage: [],
    optIn: [],
    portfolio: "",
    offer: "",
    expires: [],
    ea: [],
    risk: [],
    newEligible: false,
    expiresSoon: false,
    bkFrom: "", bkTo: "",
    rsFrom: "", rsTo: "",
    expFrom: "", expTo: ""
  };

  var PAGE_SIZE = 50;
  var currentPage = 1;
  var filteredData = [];
  var sortField = "CR Party Name";
  var sortDir   = "asc";
  var currentStageOrder = ["Purchase","Onboard","Implement","Use","Engage","Adopt","Completed"];
  var showCompletionDates = false;
  var showDealDetails = false;
  var ucMissedPreset = false;

  // Restore sort state from saved session (filter DOM restored later, after DOM is built)
  var _detSaved = window.APP_FILTER_STATE && window.APP_FILTER_STATE.details;
  var _hadDeepLink = !!window._detDeepLink;
  if (_detSaved) {
    if (_detSaved.sortField) sortField = _detSaved.sortField;
    if (_detSaved.sortDir)   sortDir   = _detSaved.sortDir;
    if (_detSaved.showCompletionDates) showCompletionDates = true;
    if (_detSaved.showDealDetails)     showDealDetails     = true;
  }

  // ── Summary dedup measures
  function calcSummary(rows) {
    var customers = new Set();
    var offersMap = new Set();
    var ucMap     = new Set();
    rows.forEach(function (r) {
      customers.add(r["CR Party ID"]);
      offersMap.add(r["CRPartyID-Offer"]);
      ucMap.add(String(r["CR Party ID"] || "") + "|" + String(r["Track"] || "") + "|" + String(r["Sub-Track"] || ""));
    });

    function dedupeMax(field) {
      var map = {};
      rows.forEach(function (r) {
        var k = r["CRPartyID-Offer"] || "";
        var v = r[field] || 0;
        if (map[k] === undefined || v > map[k]) map[k] = v;
      });
      var total = 0;
      Object.keys(map).forEach(function (k) { total += map[k]; });
      return total;
    }

    return {
      customers: customers.size,
      useCases:  ucMap.size,
      missed:    dedupeMax("Missed Incentives"),
      potential: dedupeMax("Potential Incentives"),
      earned:    dedupeMax("Estimated Earned Incentives")
    };
  }

  // ── Unique filter values
  function uniqueVals(field) {
    var s = new Set();
    data.forEach(function (r) { if (r[field] !== null && r[field] !== undefined && r[field] !== "") s.add(String(r[field])); });
    return Array.from(s).sort();
  }

  var portfolioOrder = ["Networking", "Security", "Cloud", "Cloud + AI Infrastructure", "Collaboration"];
  var stages     = uniqueVals("Stage");
  var optIns     = uniqueVals("Adopt Rebate Opt-In Status");
  var portfolios = uniqueVals("Deal CPI Portfolio").sort(function (a, b) {
    var ai = portfolioOrder.indexOf(a), bi = portfolioOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  var offerList  = uniqueVals("Track");
  var ucList     = uniqueVals("Sub-Track");
  var eaOpts     = uniqueVals("EA Flag");

  // Precompute date bounds for sliders
  function getDateBounds(field) {
    var mn = null, mx = null;
    data.forEach(function(r) { var d = toDate(r[field]); if (d) { if (!mn||d<mn) mn=d; if (!mx||d>mx) mx=d; } });
    return { min: mn, max: mx };
  }
  var dateBounds = {
    bk:  getDateBounds("Booking Date"),
    rs:  getDateBounds("Adopt Rebate Start Date"),
    exp: getDateBounds("Deal Incentive Expiry Date"),
    ea:  (function() {
      var EARN_COLS = ["Stage Completion Date(onboard)", "Stage Completion Date(Use)", "Stage Completion Date(Engage)", "Stage Completion Date(Adopt)"];
      var mn = null, mx = null;
      data.forEach(function(r) {
        var optInDate = toDate(r["Adopt Rebate Start Date"]);
        EARN_COLS.forEach(function(c) {
          var d = toDate(r[c]);
          if (d && (!optInDate || d >= optInDate)) {
            if (!mn || d < mn) mn = d;
            if (!mx || d > mx) mx = d;
          }
        });
      });
      return { min: mn, max: mx };
    })()
  };

  // ── Build initial HTML
  var html = '<div class="d-flex gap-3" id="det-layout">';

  function tip(text) {
    return ' <i class="bi bi-info-circle text-muted" style="font-size:0.72rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="right" title="' + text.replace(/"/g, "&quot;") + '"></i>';
  }

  // Sidebar filters
  html += '<div class="filter-sidebar flex-shrink-0" id="det-filter-sidebar">';
  html += '<div class="d-flex align-items-center justify-content-between mb-2">';
  html += '<div class="fw-bold" style="font-size:0.8rem;color:var(--cisco-dark)"><i class="bi bi-funnel me-1"></i><span id="det-filter-label">Filters</span></div>';
  html += '<span id="det-filter-toggle" class="text-muted" title="Collapse filters"><i class="bi bi-chevron-left"></i></span>';
  html += '</div>';
  html += '<div id="det-filter-body">';
  var has2TPartner = data.some(function (r) { return r["2T Partner Name"] && String(r["2T Partner Name"]).trim() !== ""; });
  if (has2TPartner) {
    html += '<div class="filter-group"><div class="position-relative"><input type="text" id="filter-2tpartner" class="form-control form-control-sm pe-4" placeholder="&#128269; 2T Partner Name..." /><button id="det-2tpartner-clear" type="button" class="btn btn-link p-0 position-absolute top-50 end-0 translate-middle-y me-2 d-none" style="font-size:0.8rem;color:#999;line-height:1" tabindex="-1"><i class="bi bi-x-lg"></i></button></div></div>';
  }
  html += '<div class="filter-group"><div class="position-relative"><input type="text" id="filter-crparty" class="form-control form-control-sm pe-4" placeholder="&#128269; Customer or WS-Deal ID..." /><button id="det-crparty-clear" type="button" class="btn btn-link p-0 position-absolute top-50 end-0 translate-middle-y me-2 d-none" style="font-size:0.8rem;color:#999;line-height:1" tabindex="-1"><i class="bi bi-x-lg"></i></button></div></div>';

  // Quick-toggle filters
  html += '<div class="filter-group">';
  html += '<div class="form-check form-check-sm"><input class="form-check-input" type="checkbox" id="filter-new-eligible"><label class="form-check-label" for="filter-new-eligible">New Eligible' + tip("UCs eligible for opt-in, booked within the past 30 days.") + '</label></div>';
  html += '<div class="form-check form-check-sm"><input class="form-check-input" type="checkbox" id="filter-expires-soon"><label class="form-check-label" for="filter-expires-soon">Expires Soon (&lt;1M)' + tip("Deals where the incentive expires in less than 1 month.") + '</label></div>';
  html += '<div class="form-check form-check-sm"><input class="form-check-input" type="checkbox" id="filter-earned"><label class="form-check-label" for="filter-earned">Earned' + tip("Deals where incentives have been earned.") + '</label></div>';
  html += '<div class="form-check form-check-sm"><input class="form-check-input" type="checkbox" id="filter-ea"><label class="form-check-label" for="filter-ea">EA' + tip("EA deals.") + '</label></div>';
  html += '<div class="form-check form-check-sm"><input class="form-check-input" type="checkbox" id="filter-aap"><label class="form-check-label" for="filter-aap">AAP' + tip("Completed the Adoption Accountability Plan.") + '</label></div>';
  html += '<div class="d-flex gap-2 align-items-center mt-1 mb-0" style="font-size:0.78rem"><span class="text-muted">Offer opted-in:' + tip("Any UC opted-in within this offer.") + '</span>';
  html += '<div class="form-check form-check-sm mb-0"><input class="form-check-input" type="checkbox" id="filter-offer-optedin-y" value="Y"><label class="form-check-label" for="filter-offer-optedin-y">Y</label></div>';
  html += '<div class="form-check form-check-sm mb-0"><input class="form-check-input" type="checkbox" id="filter-offer-optedin-n" value="N"><label class="form-check-label" for="filter-offer-optedin-n">N</label></div>';
  html += '</div>';
  html += makeCheckboxGroup("PVI" + tip("UCs included in the PVI Engagement score calculations."), "filter-pvi", ["Eligible", "Onboard", "Adopt"]);
  html += '</div>';

  html += makeCheckboxGroup("Stage", "filter-stage", stages, {
    "Eligible":     "Can earn incentives on this deal.",
    "Expired":      "The incentive has reached the expiry date.",
    "Not Eligible": "Not eligible for incentives (e.g. all stages completed, another UC opted-in in same offer)."
  }, function(o) { return '<span class="stage-badge stage-' + escHtml(o) + '">' + escHtml(o) + '</span>'; });
  html += '<div class="filter-group"><label class="group-label">Current Stage</label>' + makeStageRangeSlider("det-cs", currentStageOrder) + '</div>';
  html += makeCheckboxGroup("Opt-In Status", "filter-optin", optIns, {
    "OPTED IN":  "Deal has been selected for CPI.",
    "OPTED OUT": "Deal has been de-selected.",
    "PENDING":   "Opt-in is possible."
  });
  html += '<div class="filter-group"><label class="group-label">Portfolio' + tip("The technology portfolio that encompasses offers and UCs.") + '</label>' + makeDropdown("filter-portfolio", portfolios) + '</div>';
  html += '<div class="filter-group"><label class="group-label">Offer' + tip("The main solution that was sold to the customer.") + '</label>' + makeDropdown("filter-offer", offerList) + '</div>';
  html += '<div class="filter-group"><label class="group-label">Use Case</label>' + makeDropdown("filter-uc", ucList) + '</div>';

  // Date filters
  html += '<div class="filter-group"><label class="group-label">Booking Date</label>'          + makeDateSlider("det-bk",  dateBounds.bk)  + '</div>';
  html += '<div class="filter-group"><label class="group-label">Opt-in Date</label>'            + makeDateSlider("det-rs",  dateBounds.rs)  + '</div>';
  html += '<div class="filter-group"><label class="group-label">Incentive Expiry Date</label>'  + makeDateSlider("det-exp", dateBounds.exp) + '</div>';
  html += '<div class="filter-group"><label class="group-label">Earn Date</label>'              + makeDateSlider("det-ea",  dateBounds.ea)  + '</div>';

  html += '<button class="btn btn-sm btn-outline-secondary w-100 mt-2" id="det-clear-btn"><i class="bi bi-x-circle me-1"></i>Clear filters</button>';
  html += '</div>'; // /det-filter-body
  html += '</div>'; // /sidebar

  // Main content
  html += '<div class="flex-grow-1 min-width-0">';
  html += '<div class="d-flex gap-2 flex-wrap mb-3" id="det-summary"></div>';
  html += '<div id="det-table-area"></div>';
  html += '<div id="det-pagination" class="mt-2"></div>';
  html += '</div>';
  html += '</div>'; // /d-flex

  el.innerHTML = html;

  // ── Collapsible filter sidebar
  var filterToggle = document.getElementById("det-filter-toggle");
  var filterBody   = document.getElementById("det-filter-body");
  var filterSidebar = document.getElementById("det-filter-sidebar");
  filterToggle.addEventListener("click", function () {
    var isCollapsed = filterBody.classList.toggle("d-none");
    filterToggle.classList.toggle("collapsed", isCollapsed);
    filterSidebar.style.minWidth = isCollapsed ? "0" : "";
    document.getElementById("det-filter-label").classList.toggle("d-none", isCollapsed);
    if (window.APP_FILTER_STATE && window.APP_FILTER_STATE.details) {
      window.APP_FILTER_STATE.details.filterCollapsed = isCollapsed;
    }
  });

  // Initialise Bootstrap tooltips on info icons
  el.querySelectorAll("[data-bs-toggle='tooltip']").forEach(function (el2) {
    new bootstrap.Tooltip(el2, { html: false });
  });

  // ── Slider display updater(defined here so it's available to all wiring below)
  var _sliderLastMoved = {}; // tracks "from" or "to" per prefix
  if (!window._sliderUserSet) window._sliderUserSet = {};

  function updateSliderDisplay(prefix) {
    var fromEl  = document.getElementById(prefix + "-from");
    var toEl    = document.getElementById(prefix + "-to");
    var fillEl  = document.getElementById(prefix + "-fill");
    var fromLbl = document.getElementById(prefix + "-from-lbl");
    var toLbl   = document.getElementById(prefix + "-to-lbl");
    if (!fromEl || !toEl) return;
    var fromVal = parseInt(fromEl.value), toVal = parseInt(toEl.value);
    var min = parseInt(fromEl.min),       max  = parseInt(fromEl.max);
    if (fillEl && max > min) {
      fillEl.style.left  = ((fromVal - min) / (max - min) * 100) + "%";
      fillEl.style.right = ((max - toVal)   / (max - min) * 100) + "%";
    }
    // When thumbs overlap, raise the last-moved thumb so it stays grabbable
    if (fromVal === toVal) {
      var last = _sliderLastMoved[prefix] || "from";
      fromEl.style.zIndex = (last === "from") ? "5" : "";
      toEl.style.zIndex   = (last === "to")   ? "5" : "";
    } else {
      fromEl.style.zIndex = "";
      toEl.style.zIndex   = "";
    }
    if (fromLbl) fromLbl.textContent = new Date(fromVal * 86400000).toLocaleDateString(window.APP_LOCALE);
    if (toLbl)   toLbl.textContent   = new Date(toVal   * 86400000).toLocaleDateString(window.APP_LOCALE);
  }

  // Wire up filters
  el.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
    cb.addEventListener("change", function () { currentPage = 1; applyFiltersAndRender(); });
  });
  if (document.getElementById("filter-2tpartner")) {
    document.getElementById("filter-2tpartner").addEventListener("input", function () {
      document.getElementById("det-2tpartner-clear").classList.toggle("d-none", this.value === "");
      currentPage = 1; applyFiltersAndRender();
    });
    document.getElementById("det-2tpartner-clear").addEventListener("click", function () {
      var inp = document.getElementById("filter-2tpartner");
      inp.value = "";
      this.classList.add("d-none");
      inp.focus();
      currentPage = 1; applyFiltersAndRender();
    });
  }
  document.getElementById("filter-crparty").addEventListener("input", function () {
    document.getElementById("det-crparty-clear").classList.toggle("d-none", this.value === "");
    currentPage = 1; applyFiltersAndRender();
  });
  document.getElementById("det-crparty-clear").addEventListener("click", function () {
    var inp = document.getElementById("filter-crparty");
    inp.value = "";
    this.classList.add("d-none");
    inp.focus();
    currentPage = 1; applyFiltersAndRender();
  });
  function refreshUcDropdown() {
    var pf = document.getElementById("filter-portfolio").value;
    var of = document.getElementById("filter-offer").value;
    var ucSel = document.getElementById("filter-uc");
    var prevUc = ucSel.value;
    var filteredUcs = ucList.filter(function (u) {
      return data.some(function (r) {
        if (pf && String(r["Deal CPI Portfolio"] || "") !== pf) return false;
        if (of && String(r["Track"] || "") !== of) return false;
        return String(r["Sub-Track"] || "") === u;
      });
    });
    ucSel.innerHTML = '<option value="">All</option>';
    filteredUcs.forEach(function (u) {
      ucSel.innerHTML += '<option value="' + u.replace(/"/g, "&quot;") + '"' + (u === prevUc ? ' selected' : '') + '>' + u + '</option>';
    });
    if (prevUc && filteredUcs.indexOf(prevUc) === -1) ucSel.value = "";
  }

  document.getElementById("filter-portfolio").addEventListener("change", function () {
    var pf = this.value;
    var offerSel = document.getElementById("filter-offer");
    var prevOffer = offerSel.value;
    var filteredOffers = pf
      ? Array.from(new Set(data.filter(function(r){ return String(r["Deal CPI Portfolio"]||"") === pf; }).map(function(r){ return String(r["Track"]||""); }).filter(Boolean))).sort()
      : offerList;
    offerSel.innerHTML = '<option value="">All</option>';
    filteredOffers.forEach(function (o) {
      offerSel.innerHTML += '<option value="' + o.replace(/"/g, "&quot;") + '"' + (o === prevOffer ? ' selected' : '') + '>' + o + '</option>';
    });
    if (pf && prevOffer && filteredOffers.indexOf(prevOffer) === -1) offerSel.value = "";
    refreshUcDropdown();
    currentPage = 1; applyFiltersAndRender();
  });
  document.getElementById("filter-offer").addEventListener("change", function () { refreshUcDropdown(); currentPage = 1; applyFiltersAndRender(); });
  document.getElementById("filter-uc").addEventListener("change", function () { currentPage = 1; applyFiltersAndRender(); });
  ["det-bk","det-rs","det-ea","det-exp"].forEach(function (prefix) {
    ["from","to"].forEach(function (side) {
      var el2 = document.getElementById(prefix + "-" + side);
      if (!el2) return;
      el2.addEventListener("input", function () {
        delete this.dataset.intendedValue;
        _sliderLastMoved[prefix] = side;
        window._sliderUserSet[prefix] = true;
        var fromEl = document.getElementById(prefix + "-from");
        var toEl   = document.getElementById(prefix + "-to");
        if (fromEl && toEl && parseInt(fromEl.value) > parseInt(toEl.value)) {
          if (side === "from") fromEl.value = toEl.value;
          else toEl.value = fromEl.value;
        }
        updateSliderDisplay(prefix);
        currentPage = 1;
        applyFiltersAndRender();
      });
    });
    updateSliderDisplay(prefix);
  });

  function updateStageSliderDisplay() {
    var fromEl  = document.getElementById("det-cs-from");
    var toEl    = document.getElementById("det-cs-to");
    var fillEl  = document.getElementById("det-cs-fill");
    var fromLbl = document.getElementById("det-cs-from-lbl");
    var toLbl   = document.getElementById("det-cs-to-lbl");
    if (!fromEl || !toEl) return;
    var fromVal = parseInt(fromEl.value), toVal = parseInt(toEl.value);
    var min = parseInt(fromEl.min),       max  = parseInt(fromEl.max);
    if (fillEl && max > min) {
      fillEl.style.left  = ((fromVal - min) / (max - min) * 100) + "%";
      fillEl.style.right = ((max - toVal)   / (max - min) * 100) + "%";
    }
    if (fromVal === toVal) {
      var last = _sliderLastMoved["det-cs"] || "from";
      fromEl.style.zIndex = (last === "from") ? "5" : "";
      toEl.style.zIndex   = (last === "to")   ? "5" : "";
    } else {
      fromEl.style.zIndex = "";
      toEl.style.zIndex   = "";
    }
    if (fromLbl) fromLbl.innerHTML = stageBadgeHtml(currentStageOrder[fromVal] || "");
    if (toLbl)   toLbl.innerHTML   = stageBadgeHtml(currentStageOrder[toVal]   || "");
  }

  ["det-cs-from", "det-cs-to"].forEach(function (csId) {
    var csEl = document.getElementById(csId);
    if (!csEl) return;
    csEl.addEventListener("input", function () {
      var side   = csId === "det-cs-from" ? "from" : "to";
      _sliderLastMoved["det-cs"] = side;
      var fromEl = document.getElementById("det-cs-from");
      var toEl   = document.getElementById("det-cs-to");
      if (fromEl && toEl && parseInt(fromEl.value) > parseInt(toEl.value)) {
        if (csId === "det-cs-from") fromEl.value = toEl.value;
        else toEl.value = fromEl.value;
      }
      updateStageSliderDisplay();
      currentPage = 1;
      applyFiltersAndRender();
    });
  });
  updateStageSliderDisplay();

  document.getElementById("det-clear-btn").addEventListener("click", function () {
    window._sliderUserSet = {};
    _sliderLastMoved = {};
    if (document.getElementById("filter-2tpartner")) document.getElementById("filter-2tpartner").value = "";
    document.getElementById("filter-crparty").value = "";
    el.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
    document.getElementById("filter-portfolio").value = "";
    document.getElementById("filter-offer").value = "";
    document.getElementById("filter-uc").value = "";
    refreshUcDropdown();
    ["det-bk","det-rs","det-ea","det-exp"].forEach(function (prefix) {
      var fromEl = document.getElementById(prefix + "-from");
      var toEl   = document.getElementById(prefix + "-to");
      if (fromEl) fromEl.value = fromEl.min;
      if (toEl)   toEl.value   = toEl.max;
      updateSliderDisplay(prefix);
    });
    var csFrom = document.getElementById("det-cs-from");
    var csTo   = document.getElementById("det-cs-to");
    if (csFrom) csFrom.value = csFrom.min;
    if (csTo)   csTo.value   = csTo.max;
    updateStageSliderDisplay();
    currentPage = 1;
    applyFiltersAndRender();
  });

  // Apply deep-link preset if navigated from another tab
  if (window._detDeepLink) {
    var dl = window._detDeepLink;
    if (dl.checkboxIds) { dl.checkboxIds.forEach(function(id) { var cb = document.getElementById(id); if (cb) cb.checked = true; }); }
    if (dl.stage)         { dl.stage.forEach(function(s) { document.querySelectorAll('#filter-stage input[type=checkbox]').forEach(function(cb) { if (cb.value.toUpperCase() === s.toUpperCase()) cb.checked = true; }); }); }
    if (dl.ucMissed)      { ucMissedPreset = true; }
    if (dl.optIn)         { dl.optIn.forEach(function(s) { document.querySelectorAll('#filter-optin input[type=checkbox]').forEach(function(cb) { if (cb.value.toUpperCase() === s.toUpperCase()) cb.checked = true; }); }); }
    if (dl.offerOptedInN) { var _cbn = document.getElementById("filter-offer-optedin-n"); if (_cbn) _cbn.checked = true; }
    if (dl.csFrom !== undefined || dl.csTo !== undefined) {
      var _csFrom = document.getElementById("det-cs-from");
      var _csTo   = document.getElementById("det-cs-to");
      if (_csFrom && dl.csFrom !== undefined) _csFrom.value = dl.csFrom;
      if (_csTo   && dl.csTo   !== undefined) _csTo.value   = dl.csTo;
      updateStageSliderDisplay();
    }
    if (dl.bkFrom !== undefined || dl.bkTo !== undefined) {
      var _bkFrom = document.getElementById("det-bk-from");
      var _bkTo   = document.getElementById("det-bk-to");
      if (_bkFrom && dl.bkFrom !== undefined) _bkFrom.value = dl.bkFrom;
      if (_bkTo   && dl.bkTo   !== undefined) _bkTo.value   = dl.bkTo;
      window._sliderUserSet["det-bk"] = true;
      updateSliderDisplay("det-bk");
    }
    if (dl.rsFrom !== undefined || dl.rsTo !== undefined) {
      var _rsFrom = document.getElementById("det-rs-from");
      var _rsTo   = document.getElementById("det-rs-to");
      if (_rsFrom && dl.rsFrom !== undefined) _rsFrom.value = dl.rsFrom;
      if (_rsTo   && dl.rsTo   !== undefined) _rsTo.value   = dl.rsTo;
      window._sliderUserSet["det-rs"] = true;
      updateSliderDisplay("det-rs");
    }
    if (dl.eaFrom !== undefined || dl.eaTo !== undefined) {
      var _eaFrom = document.getElementById("det-ea-from");
      var _eaTo   = document.getElementById("det-ea-to");
      if (_eaFrom && dl.eaFrom !== undefined) { _eaFrom.value = dl.eaFrom; _eaFrom.dataset.intendedValue = dl.eaFrom; }
      if (_eaTo   && dl.eaTo   !== undefined) { _eaTo.value   = dl.eaTo;   _eaTo.dataset.intendedValue   = dl.eaTo; }
      window._sliderUserSet["det-ea"] = true;
      updateSliderDisplay("det-ea");
    }
    if (dl.expFrom !== undefined || dl.expTo !== undefined) {
      var _expFrom = document.getElementById("det-exp-from");
      var _expTo   = document.getElementById("det-exp-to");
      if (_expFrom && dl.expFrom !== undefined) _expFrom.value = dl.expFrom;
      if (_expTo   && dl.expTo   !== undefined) _expTo.value   = dl.expTo;
      window._sliderUserSet["det-exp"] = true;
      updateSliderDisplay("det-exp");
    }
    window._detDeepLink = null;
  }

  // Restore persisted filter state if no deep-link was applied
  if (_detSaved && !_hadDeepLink) {
    _restoreDetailsState(_detSaved);
    ["det-bk","det-rs","det-ea","det-exp"].forEach(updateSliderDisplay);
    updateStageSliderDisplay();
  }

  applyFiltersAndRender();

  function _restoreDetailsState(st) {
    // Text inputs
    var crEl = document.getElementById("filter-crparty");
    if (crEl && st.crParty) {
      crEl.value = st.crParty;
      var crClr = document.getElementById("det-crparty-clear");
      if (crClr) crClr.classList.remove("d-none");
    }
    var ttEl = document.getElementById("filter-2tpartner");
    if (ttEl && st.twoTPartner) {
      ttEl.value = st.twoTPartner;
      var ttClr = document.getElementById("det-2tpartner-clear");
      if (ttClr) ttClr.classList.remove("d-none");
    }
    // Portfolio → repopulate offer list → set offer → set UC → refreshUcDropdown
    var pfEl = document.getElementById("filter-portfolio");
    if (pfEl && st.portfolio) {
      pfEl.value = st.portfolio;
      var offerSel2 = document.getElementById("filter-offer");
      if (offerSel2) {
        var filteredOffers2 = Array.from(new Set(data.filter(function(r){ return String(r["Deal CPI Portfolio"]||"") === st.portfolio; }).map(function(r){ return String(r["Track"]||""); }).filter(Boolean))).sort();
        offerSel2.innerHTML = '<option value="">All</option>';
        filteredOffers2.forEach(function(o){ offerSel2.innerHTML += '<option value="'+o.replace(/"/g,'&quot;')+'">'+o+'</option>'; });
      }
    }
    var ofEl = document.getElementById("filter-offer");
    var ucEl2 = document.getElementById("filter-uc");
    if (ofEl  && st.offer) ofEl.value  = st.offer;
    if (ucEl2 && st.uc)    ucEl2.value = st.uc;
    refreshUcDropdown();
    // Stage checkboxes
    if (st.stageChecked && st.stageChecked.length) {
      document.querySelectorAll('#filter-stage input[type=checkbox]').forEach(function(cb){ cb.checked = st.stageChecked.indexOf(cb.value) !== -1; });
    }
    // Opt-In checkboxes
    if (st.optInChecked && st.optInChecked.length) {
      document.querySelectorAll('#filter-optin input[type=checkbox]').forEach(function(cb){ cb.checked = st.optInChecked.indexOf(cb.value) !== -1; });
    }
    // Boolean checkboxes
    var _boolMap = { offerOptedInY:"filter-offer-optedin-y", offerOptedInN:"filter-offer-optedin-n",
      pviEligible:"filter-pvi-Eligible", pviOnboard:"filter-pvi-Onboard", pviAdopt:"filter-pvi-Adopt",
      newEligible:"filter-new-eligible", expiresSoon:"filter-expires-soon",
      earned:"filter-earned", ea:"filter-ea", aap:"filter-aap" };
    Object.keys(_boolMap).forEach(function(key) {
      var cbEl = document.getElementById(_boolMap[key]);
      if (cbEl && st[key]) cbEl.checked = true;
    });
    // Sliders
    [["det-bk-from","bkFrom"],["det-bk-to","bkTo"],["det-rs-from","rsFrom"],["det-rs-to","rsTo"],
     ["det-ea-from","eaFrom"],["det-ea-to","eaTo"],
     ["det-exp-from","expFrom"],["det-exp-to","expTo"],["det-cs-from","csFrom"],["det-cs-to","csTo"]
    ].forEach(function(p) {
      var slEl = document.getElementById(p[0]);
      if (slEl && st[p[1]] !== null && st[p[1]] !== undefined && st[p[1]] !== "") slEl.value = st[p[1]];
    });
    if (st.ucMissedPreset) ucMissedPreset = true;
    if (st.sliderUserSet) window._sliderUserSet = JSON.parse(JSON.stringify(st.sliderUserSet));
    // Restore filter pane collapsed state
    if (st.filterCollapsed) {
      filterBody.classList.add("d-none");
      filterToggle.classList.add("collapsed");
      filterSidebar.style.minWidth = "0";
      document.getElementById("det-filter-label").classList.add("d-none");
    }
  }

  function applyFiltersAndRender() {
    // Persist current filter state so it survives tab switching
    if (window.APP_FILTER_STATE) {
      window.APP_FILTER_STATE.details = {
        sortField:     sortField,
        sortDir:       sortDir,
        showCompletionDates: showCompletionDates,
        showDealDetails:     showDealDetails,
        ucMissedPreset: ucMissedPreset,
        crParty:       (document.getElementById("filter-crparty")    || {value:""}).value,
        twoTPartner:   (document.getElementById("filter-2tpartner")  || {value:""}).value,
        portfolio:     (document.getElementById("filter-portfolio")  || {value:""}).value,
        offer:         (document.getElementById("filter-offer")      || {value:""}).value,
        uc:            (document.getElementById("filter-uc")         || {value:""}).value,
        stageChecked:  getChecked("filter-stage"),
        optInChecked:  getChecked("filter-optin"),
        offerOptedInY: !!(document.getElementById("filter-offer-optedin-y") || {}).checked,
        offerOptedInN: !!(document.getElementById("filter-offer-optedin-n") || {}).checked,
        pviEligible:   !!(document.getElementById("filter-pvi-Eligible")    || {}).checked,
        pviOnboard:    !!(document.getElementById("filter-pvi-Onboard")     || {}).checked,
        pviAdopt:      !!(document.getElementById("filter-pvi-Adopt")       || {}).checked,
        newEligible:   !!(document.getElementById("filter-new-eligible")    || {}).checked,
        expiresSoon:   !!(document.getElementById("filter-expires-soon")    || {}).checked,
        earned:        !!(document.getElementById("filter-earned")          || {}).checked,
        ea:            !!(document.getElementById("filter-ea")              || {}).checked,
        aap:           !!(document.getElementById("filter-aap")             || {}).checked,
        bkFrom:        window._sliderUserSet["det-bk"]  ? (document.getElementById("det-bk-from")  || {value:null}).value : null,
        bkTo:          window._sliderUserSet["det-bk"]  ? (document.getElementById("det-bk-to")    || {value:null}).value : null,
        rsFrom:        window._sliderUserSet["det-rs"]  ? (document.getElementById("det-rs-from")  || {value:null}).value : null,
        rsTo:          window._sliderUserSet["det-rs"]  ? (document.getElementById("det-rs-to")    || {value:null}).value : null,
        eaFrom:        window._sliderUserSet["det-ea"]  ? (document.getElementById("det-ea-from")  || {value:null}).value : null,
        eaTo:          window._sliderUserSet["det-ea"]  ? (document.getElementById("det-ea-to")    || {value:null}).value : null,
        expFrom:       window._sliderUserSet["det-exp"] ? (document.getElementById("det-exp-from") || {value:null}).value : null,
        expTo:         window._sliderUserSet["det-exp"] ? (document.getElementById("det-exp-to")   || {value:null}).value : null,
        csFrom:        (document.getElementById("det-cs-from")  || {value:null}).value,
        csTo:          (document.getElementById("det-cs-to")    || {value:null}).value,
        sliderUserSet: window._sliderUserSet ? JSON.parse(JSON.stringify(window._sliderUserSet)) : {},
        filterCollapsed: filterBody ? filterBody.classList.contains("d-none") : false
      };
    }
    var twoTVal          = document.getElementById("filter-2tpartner") ? document.getElementById("filter-2tpartner").value.trim().toLowerCase() : "";
    var crPartyVal       = document.getElementById("filter-crparty").value.trim().toLowerCase();
    var stageChecked     = getChecked("filter-stage");
    var optInChecked     = getChecked("filter-optin");
    var portfolioVal     = document.getElementById("filter-portfolio").value;
    var offerVal         = document.getElementById("filter-offer").value;
    var ucVal            = document.getElementById("filter-uc").value;
    var offerOptedIn     = document.getElementById("filter-offer-optedin-y") ? document.getElementById("filter-offer-optedin-y").checked : false;
    var offerNotOptedIn  = document.getElementById("filter-offer-optedin-n") ? document.getElementById("filter-offer-optedin-n").checked : false;
    var pviEligible      = document.getElementById("filter-pvi-Eligible") && document.getElementById("filter-pvi-Eligible").checked;
    var pviOnboard       = document.getElementById("filter-pvi-Onboard")  && document.getElementById("filter-pvi-Onboard").checked;
    var pviAdopt         = document.getElementById("filter-pvi-Adopt")    && document.getElementById("filter-pvi-Adopt").checked;
    var ucMissed         = ucMissedPreset;
    var newEligible      = document.getElementById("filter-new-eligible").checked;
    var expiresSoon      = document.getElementById("filter-expires-soon").checked;
    var earnedChecked    = document.getElementById("filter-earned").checked;
    var eaChecked        = document.getElementById("filter-ea").checked;
    var aapChecked       = document.getElementById("filter-aap").checked;
    var bkFrom  = document.getElementById("det-bk-from");
    var bkTo    = document.getElementById("det-bk-to");
    var rsFrom  = document.getElementById("det-rs-from");
    var rsTo    = document.getElementById("det-rs-to");
    var eaFrom  = document.getElementById("det-ea-from");
    var eaTo    = document.getElementById("det-ea-to");
    var expFrom = document.getElementById("det-exp-from");
    var expTo   = document.getElementById("det-exp-to");
    function sliderVal(el) { return el ? new Date(parseInt(el.value) * 86400000) : null; }
    function atMin(el)     { return !el || parseInt(el.value) === parseInt(el.min); }
    function atMax(el)     { return !el || parseInt(el.value) === parseInt(el.max); }
    var bkFromDate  = atMin(bkFrom)  ? null : sliderVal(bkFrom);
    var bkToDate    = atMax(bkTo)    ? null : sliderVal(bkTo);
    var rsFromDate  = atMin(rsFrom)  ? null : sliderVal(rsFrom);
    var rsToDate    = atMax(rsTo)    ? null : sliderVal(rsTo);
    var eaFromDate  = atMin(eaFrom)  ? null : sliderVal(eaFrom);
    var eaToDate    = atMax(eaTo)    ? null : sliderVal(eaTo);
    var eaActive    = eaFrom && eaTo && !(parseInt(eaFrom.value) === parseInt(eaFrom.min) && parseInt(eaTo.value) === parseInt(eaTo.max));
    if (eaActive) {
      eaFromDate = (eaFrom && eaFrom.dataset.intendedValue !== undefined) ? new Date(parseInt(eaFrom.dataset.intendedValue) * 86400000) : sliderVal(eaFrom);
      eaToDate   = (eaTo   && eaTo.dataset.intendedValue   !== undefined) ? new Date(parseInt(eaTo.dataset.intendedValue)   * 86400000) : sliderVal(eaTo);
    }
    var expFromDate = atMin(expFrom) ? null : sliderVal(expFrom);
    var expToDate   = atMax(expTo)   ? null : sliderVal(expTo);
    var csFromEl  = document.getElementById("det-cs-from");
    var csToEl    = document.getElementById("det-cs-to");
    var csFromIdx = csFromEl ? parseInt(csFromEl.value) : 0;
    var csToIdx   = csToEl   ? parseInt(csToEl.value)   : currentStageOrder.length - 1;
    var csActive  = csFromEl && csToEl && !(parseInt(csFromEl.value) === parseInt(csFromEl.min) && parseInt(csToEl.value) === parseInt(csToEl.max));

    filteredData = data.filter(function (r) {
      if (twoTVal    && String(r["2T Partner Name"] || "").toLowerCase().indexOf(twoTVal) === -1)   return false;
      if (crPartyVal && String(r["CR Party Name"] || "").toLowerCase().indexOf(crPartyVal) === -1
                     && String(r["Deal WS-ID"] || "").toLowerCase().indexOf(crPartyVal) === -1
                     && String(r["CR Party ID"] || "").toLowerCase().indexOf(crPartyVal) === -1
                     && String(r["CX Customer BU ID"] || "").toLowerCase().indexOf(crPartyVal) === -1) return false;
      if (stageChecked.length  && stageChecked.indexOf(String(r["Stage"] || "")) === -1)                      return false;
      if (csActive) { var _si = currentStageOrder.indexOf(String(r["Current stage"] || "")); if (_si === -1 || _si < csFromIdx || _si > csToIdx) return false; }
      if (optInChecked.length  && optInChecked.indexOf(String(r["Adopt Rebate Opt-In Status"] || "")) === -1) return false;
      if (portfolioVal         && String(r["Deal CPI Portfolio"] || "") !== portfolioVal)                     return false;
      if (offerVal             && String(r["Track"] || "") !== offerVal)                                      return false;
      if (ucVal                && String(r["Sub-Track"] || "") !== ucVal)                                     return false;
      if (offerOptedIn && !offerNotOptedIn && r["Offer opted-in?"] !== true)  return false;
      if (offerNotOptedIn && !offerOptedIn && r["Offer opted-in?"] === true)   return false;
      if (pviEligible      && !r["PVI Eligible"])   return false;
      if (pviOnboard       && !r["PVI Onboard"])    return false;
      if (pviAdopt         && !r["PVI Adopt"])      return false;
      if (ucMissed         && !r["UC progressed and missed w/o opt-in"]) return false;
      if (newEligible      && !r["New eligible"])                                                         return false;
      if (expiresSoon) {
        var _expD = toDate(r["Deal Incentive Expiry Date"]);
        var _expMidnight = _expD ? new Date(_expD.getFullYear(), _expD.getMonth(), _expD.getDate()) : null;
        var _today = new Date(); _today.setHours(0,0,0,0);
        var _in30 = new Date(_today.getTime() + 30 * 86400000);
        if (!_expMidnight || _expMidnight < _today || _expMidnight >= _in30) return false;
        if ((r["Stage"] || "").toUpperCase() !== "ELIGIBLE") return false;
      }
      if (earnedChecked    && r["Earned?"] !== true)                                                        return false;
      if (eaChecked        && String(r["EA Flag"] || "") !== "Yes")                                         return false;
      if (aapChecked       && String(r["AAP Flag"] || "") !== "Yes")                                        return false;

      if (bkFromDate || bkToDate) {
        var d = toDate(r["Booking Date"]);
        if (d) {
          if (bkFromDate && d < bkFromDate) return false;
          if (bkToDate   && d > bkToDate)   return false;
        }
      }
      if (rsFromDate || rsToDate) {
        var d2 = toDate(r["Adopt Rebate Start Date"]);
        if (!d2) return false;
        if (rsFromDate && d2 < rsFromDate) return false;
        if (rsToDate   && d2 > rsToDate)   return false;
      }
      if (eaActive) {
        var EARN_COLS2 = ["Stage Completion Date(onboard)", "Stage Completion Date(Use)", "Stage Completion Date(Engage)", "Stage Completion Date(Adopt)"];
        var _optInDate = toDate(r["Adopt Rebate Start Date"]);
        var hasEarnDate = EARN_COLS2.some(function(c) {
          var d4 = toDate(r[c]);
          if (!d4) return false;
          if (_optInDate && d4 < _optInDate) return false;
          if (eaFromDate && d4 < eaFromDate) return false;
          if (eaToDate   && d4 > eaToDate)   return false;
          return true;
        });
        if (!hasEarnDate) return false;
      }
      if (expFromDate || expToDate) {
        var d3 = toDate(r["Deal Incentive Expiry Date"]);
        if (d3) {
          if (expFromDate && d3 < expFromDate) return false;
          if (expToDate   && d3 > expToDate)   return false;
        }
      }
      return true;
    });

    updateDateSliderBounds();
    applySort();

    renderSummary(filteredData);
    renderTable();
  }

  function updateDateSliderBounds() {
    var EARN_COLS3 = ["Stage Completion Date(onboard)", "Stage Completion Date(Use)", "Stage Completion Date(Engage)", "Stage Completion Date(Adopt)"];
    var sliderDefs = [
      { prefix: "det-bk",  get: function(r) { return [toDate(r["Booking Date"])]; } },
      { prefix: "det-rs",  get: function(r) { return [toDate(r["Adopt Rebate Start Date"])]; } },
      { prefix: "det-ea",  get: function(r) {
        var optIn = toDate(r["Adopt Rebate Start Date"]);
        return EARN_COLS3.map(function(c) { var d = toDate(r[c]); return (d && (!optIn || d >= optIn)) ? d : null; });
      }},
      { prefix: "det-exp", get: function(r) { return [toDate(r["Deal Incentive Expiry Date"])]; } }
    ];
    sliderDefs.forEach(function(def) {
      var fromEl = document.getElementById(def.prefix + "-from");
      var toEl   = document.getElementById(def.prefix + "-to");
      if (!fromEl || !toEl) return;
      // Skip if user has manually set this slider
      if (window._sliderUserSet[def.prefix]) return;
      var mn = null, mx = null;
      filteredData.forEach(function(r) {
        def.get(r).forEach(function(d) {
          if (d) { if (!mn || d < mn) mn = d; if (!mx || d > mx) mx = d; }
        });
      });
      if (!mn || !mx) return;
      var newMin = epochDay(mn), newMax = epochDay(mx);
      fromEl.min = newMin; fromEl.max = newMax;
      toEl.min   = newMin; toEl.max   = newMax;
      fromEl.value = newMin;
      toEl.value   = newMax;
      updateSliderDisplay(def.prefix);
    });
  }

  function applySort() {
    var numericFields = { "Potential Incentives": true, "Missed Incentives": true, "Estimated Earned Incentives": true, "Days in stage": true, "Booking Amount - Net to Cisco": true };
    var dateFields    = { "Deal Incentive Expiry Date": true, "Booking Date": true, "Adopt Rebate Start Date": true };
    filteredData.sort(function (a, b) {
      var av = a[sortField], bv = b[sortField];
      if (sortField === "Current stage") {
        var ai = currentStageOrder.indexOf(av || ""), bi = currentStageOrder.indexOf(bv || "");
        if (ai === -1) ai = currentStageOrder.length;
        if (bi === -1) bi = currentStageOrder.length;
        return sortDir === "asc" ? ai - bi : bi - ai;
      } else if (numericFields[sortField]) {
        av = av || 0; bv = bv || 0;
        return sortDir === "asc" ? av - bv : bv - av;
      } else if (dateFields[sortField]) {
        var ad = toDate(av), bd = toDate(bv);
        if (!ad && !bd) return 0;
        if (!ad) return sortDir === "asc" ? 1 : -1;
        if (!bd) return sortDir === "asc" ? -1 : 1;
        return sortDir === "asc" ? ad - bd : bd - ad;
      } else {
        av = String(av || "").toLowerCase(); bv = String(bv || "").toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
    });
  }

  function renderSummary(rows) {
    var s = calcSummary(rows);
    var html = "";
    html += metricCard(s.customers,          "Customers");
    html += metricCard(s.useCases,           "Use Cases");
    html += metricCard("$" + Math.round(s.missed).toLocaleString(),    "Total Missed");
    html += metricCard("$" + Math.round(s.potential).toLocaleString(), "Total Potential");
    html += metricCard("$" + Math.round(s.earned).toLocaleString(),    "Total Estimated Earned");
    html += '<div class="d-flex align-items-center ms-auto">' +
      '<button id="det-export-btn" class="btn btn-sm btn-outline-success" style="font-size:0.82rem;white-space:nowrap">' +
      '<i class="bi bi-file-earmark-excel me-1"></i>Export to Excel</button></div>';
    document.getElementById("det-summary").innerHTML = html;
    document.getElementById("det-export-btn").addEventListener("click", function () {
      exportDetailsToXlsx(rows);
    });
  }

  function metricCard(value, label) {
    return '<div class="metric-card flex-fill"><div class="metric-value">' + value + '</div><div class="metric-label">' + label + '</div></div>';
  }

  function renderTable() {
    var today = new Date();
    var in90  = new Date(today.getTime() + 90 * 86400000);

    var start = (currentPage - 1) * PAGE_SIZE;
    var pageRows = filteredData.slice(start, start + PAGE_SIZE);
    var totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

    var has2TPartner = data.some(function (r) { return r["2T Partner Name"] && String(r["2T Partner Name"]).trim() !== ""; });

    var cols = [
      ...(has2TPartner ? [{ label: "2T Partner Name", field: "2T Partner Name" }] : []),
      { label: "CR Party Name",              field: "CR Party Name",                style: "min-width:180px" },
      { label: "Use Case",                   field: "Sub-Track",                    style: "min-width:160px" },
      { label: "Current Stage",              field: "Current stage",                isCurrentStage: true },
      ...(showCompletionDates ? [
        { label: "Onboard<br>Completion",    field: "Stage Completion Date(onboard)", isDate: true, isEarnDate: true },
        { label: "Use<br>Completion",        field: "Stage Completion Date(Use)",     isDate: true, isEarnDate: true },
        { label: "Engage<br>Completion",     field: "Stage Completion Date(Engage)",  isDate: true, isEarnDate: true },
        { label: "Adopt<br>Completion",      field: "Stage Completion Date(Adopt)",   isDate: true, isEarnDate: true },
        { label: "Stages Completed<br>Before Opt-in", field: "_missedStages" },
      ] : []),
      { label: "Days in Stage",              field: "Days in stage" },
      { label: "Stage Progress",             field: "Current Stage Progress" },
      { label: "Pending Tasks",              field: "Current stage pending tasks",  style: "max-width:80px" },
      { label: "Booking Date",               field: "Booking Date",                 isDate: true, isBookingDate: true },
      ...(showDealDetails ? [
        { label: "Deal ID",                  field: "Deal ID" },
        { label: "Net Booking",              field: "Booking Amount - Net to Cisco", isCurrency: true },
      ] : []),
      { label: "Opt-in Date",                field: "Adopt Rebate Start Date",      isDate: true },
      { label: "Expiry Date",                field: "Deal Incentive Expiry Date",   isDate: true, isExpiry: true },
      { label: "Missed Incentives",          field: "Missed Incentives",            isCurrency: true },
      { label: "Potential Incentives",       field: "Potential Incentives",         isCurrency: true },
      { label: "Estimated<br>Earned Incentives", field: "Estimated Earned Incentives", isCurrency: true, style: "min-width:90px;max-width:110px" },
      { label: "Deal WS-ID",                 field: "Deal WS-ID",                   style: "min-width:140px", isWsId: true },
      { label: "Status",                     field: "_status",                      isStatus: true }
    ];

    var sortableCols = {
      "2T Partner Name": true,
      "CR Party Name": true,
      "Potential Incentives": true,
      "Missed Incentives": true,
      "Estimated Earned Incentives": true,
      "Booking Amount - Net to Cisco": true,
      "Days in stage": true,
      "Current stage": true,
      "Booking Date": true,
      "Adopt Rebate Start Date": true,
      "Deal Incentive Expiry Date": true
    };
    var thead = "<thead><tr>" + cols.map(function (c) {
      var styleAttr = c.style ? 'style="' + c.style + (sortableCols[c.field] ? ";cursor:pointer;user-select:none" : "") + '"' : '';
      if (c.isCurrentStage) {
        var sortIcon = sortField === c.field ? (sortDir === "asc" ? " ▲" : " ▼") : " ⇅";
        var toggleIcon = showCompletionDates ? "bi-dash-circle" : "bi-plus-circle";
        var toggleTitle = showCompletionDates ? "Hide completion dates" : "Show completion dates";
        return '<th style="cursor:pointer;user-select:none;white-space:nowrap" data-sortfield="' + c.field + '">' +
          c.label + '<span style="font-size:0.7rem;opacity:0.7">' + sortIcon + '</span>' +
          ' <i class="bi ' + toggleIcon + '" id="det-completion-toggle" title="' + toggleTitle + '" style="font-size:0.8rem;opacity:0.7;cursor:pointer;vertical-align:middle" onclick="event.stopPropagation()"></i></th>';
      }
      if (c.isBookingDate) {
        var bdSortIcon    = sortField === c.field ? (sortDir === "asc" ? " ▲" : " ▼") : " ⇅";
        var bdToggleIcon  = showDealDetails ? "bi-dash-circle" : "bi-plus-circle";
        var bdToggleTitle = showDealDetails ? "Hide Deal ID & Net Booking" : "Show Deal ID & Net Booking";
        return '<th style="white-space:nowrap;cursor:pointer;user-select:none" data-sortfield="' + c.field + '">' +
          c.label + '<span style="font-size:0.7rem;opacity:0.7">' + bdSortIcon + '</span>' +
          ' <i class="bi ' + bdToggleIcon + '" id="det-dealdetails-toggle" title="' + bdToggleTitle + '" style="font-size:0.8rem;opacity:0.7;cursor:pointer;vertical-align:middle" onclick="event.stopPropagation()"></i></th>';
      }
      if (sortableCols[c.field]) {
        var icon = sortField === c.field ? (sortDir === "asc" ? " ▲" : " ▼") : " ⇅";
        if (!styleAttr) styleAttr = 'style="cursor:pointer;user-select:none"';
        return '<th ' + styleAttr + ' data-sortfield="' + c.field + '">' + c.label + '<span style="font-size:0.7rem;opacity:0.7">' + icon + '</span></th>';
      }
      return '<th' + (styleAttr ? ' ' + styleAttr : '') + '>' + c.label + '</th>';
    }).join("") + "</tr></thead>";

    var stageRisk= { Purchase:"risk-high", Onboard:"risk-high", Implement:"risk-medium", Use:"risk-medium", Engage:"risk-low", Adopt:"risk-low", Completed:"risk-low" };

    var tbody = "<tbody>";
    if (pageRows.length === 0) {
      tbody += '<tr><td colspan="' + cols.length + '" class="text-center text-muted py-4">No data matching current filters.</td></tr>';
    } else {
      pageRows.forEach(function (r) {
        var expiryObj = toDate(r["Deal Incentive Expiry Date"]);
        var isExpiredRow = expiryObj && expiryObj < today;
        var riskClass = stageRisk[r["Current stage"]] || "";
        tbody += '<tr class="' + riskClass + '">';
        cols.forEach(function (c) {
          var val = r[c.field];
          var cell = "";
          if (c.isCurrency) {
            cell = fmtCurrency(val);
          } else if (c.isExpiry) {
            var dObj = toDate(val);
            var cellStyle = "";
            if (isExpiredRow) {
              cellStyle = ' style="background:#f0f0f0;color:#999"';
            } else if (dObj) {
              var daysUntil = Math.round((dObj - today) / 86400000);
              if (daysUntil > 180)     cellStyle = ' style="background:#dff6dd"';
              else if (daysUntil > 90) cellStyle = ' style="background:#fff4ce"';
              else if (daysUntil >= 0) cellStyle = ' style="background:#ffe6e6"';
            }
            tbody += '<td' + cellStyle + '>' + fmtDate(val) + '</td>';
            return;
          } else if (c.isDate) {
            cell = '<td>' + fmtDate(val) + '</td>';
            tbody += cell;
            return;
          } else if (c.field === "CR Party Name") {
            var crNameEsc = escHtml(String(r["CR Party Name"] || ""));
            var crId  = escHtml(String(r["CR Party ID"] || ""));
            var buId  = escHtml(String(r["CX Customer BU ID"] || ""));
            var subIds = [crId ? "CR: " + crId : "", buId ? "BU: " + buId : ""].filter(Boolean).join(" &middot; ");
            cell = crNameEsc + (subIds ? '<div style="font-size:0.72rem;color:#888;margin-top:1px">' + subIds + '</div>' : '');
          } else if (c.isWsId) {
            var wsid = val ? String(val) : "";
            cell = wsid ? '<a href="https://app.workspan.com/wsid/' + escHtml(wsid) + '" target="_blank" rel="noopener">' + escHtml(wsid) + '</a>' : '';
          } else if (c.isStatus) {
            var icons = [];
            if (norm(r["Adopt Rebate Opt-In Status"]) === "OPTED IN")
              icons.push('<i class="bi bi-hand-thumbs-up-fill" style="color:#0070d2" title="Opted In"></i>');
            var stg2 = norm(r["Stage"]);
            if (r["Earned?"] === true)
              icons.push('<i class="bi bi-currency-dollar fw-bold" style="color:#000" title="Earned"></i>');
            if      (stg2 === "ELIGIBLE") icons.push('<i class="bi bi-check-circle-fill" style="color:#107C10" title="Eligible"></i>');
            else if (stg2 === "EXPIRED")  icons.push('<i class="bi bi-clock" style="color:#888" title="Expired"></i>');
            else if (r["Earned?"] !== true) icons.push('<i class="bi bi-x-circle-fill" style="color:#D13438" title="Not Eligible"></i>');
            cell = '<span style="white-space:nowrap">' + icons.join(" ") + '</span>';
          } else if (c.field === "Current stage") {
            cell = '<span class="stage-badge stage-' + escHtml(val) + '">' + escHtml(val) + '</span>';
          } else if (c.field === "Days in stage") {
            var days = val !== null && val !== undefined ? parseInt(val) : null;
            var dayColor = days === null ? "" : days > 180 ? "color:#D13438" : days > 90 ? "color:#FF8C00" : "color:#107C10";
            tbody += '<td style="font-weight:600;' + dayColor + '">' + (days !== null ? days : "-") + '</td>';
            return;
          } else if (c.field === "Current Stage Progress") {
            var parts = val ? String(val).split("/") : [];
            var x = parseInt(parts[0]), y = parseInt(parts[1]);
            if (!isNaN(x) && !isNaN(y) && y > 0) {
              var pct = Math.round((x / y) * 100);
              cell = '<div style="min-width:80px">' +
                '<div class="progress" style="height:8px;margin-bottom:2px">' +
                '<div class="progress-bar" style="width:' + pct + '%;background:var(--cisco-blue)"></div>' +
                '</div>' +
                '<span style="font-size:0.75rem">' + x + '/' + y + '</span>' +
                '</div>';
            } else {
              cell = "";
            }
          } else if (c.field === "Sub-Track") {
            var PORTFOLIO_ABBR = { "NETWORKING": "NET", "SECURITY": "SEC", "CLOUD + AI INFRASTRUCTURE": "CAI", "COLLABORATION": "COL" };
            var pf2 = String(r["Deal CPI Portfolio"] || "").trim();
            var pfAbbr = PORTFOLIO_ABBR[pf2.toUpperCase()] || pf2;
            var offer2 = String(r["Track"] || "").trim();
            var subLine = [pfAbbr, offer2].filter(Boolean).join(" - ");
            var ucName2 = escHtml(val);
            var ucUrl2 = val ? UC_GUIDE_MAP[String(val).trim()] : null;
            var ucLink = ucUrl2 ? '<a href="' + ucUrl2 + '" target="_blank" rel="noopener">' + ucName2 + '</a>' : ucName2;
            cell = ucLink + (subLine ? '<div style="font-size:0.72rem;color:#888;margin-top:1px">' + escHtml(subLine) + '</div>' : '');
          } else if (c.field === "_missedStages") {
            var optInDate = toDate(r["Adopt Rebate Start Date"]);
            var msParts = [];
            [{ name: "Onboard", f: "Stage Completion Date(onboard)" },
             { name: "Use",     f: "Stage Completion Date(Use)" },
             { name: "Engage",  f: "Stage Completion Date(Engage)" },
             { name: "Adopt",   f: "Stage Completion Date(Adopt)" }].forEach(function (s) {
              var cd = toDate(r[s.f]);
              if (cd && optInDate && cd < optInDate) msParts.push(s.name);
            });
            if (msParts.length === 0) {
              tbody += '<td class="text-muted">N/A</td>';
            } else {
              tbody += '<td><span class="text-danger fw-semibold">' + msParts.join(", ") + '</span></td>';
            }
            return;
          } else {
            cell = escHtml(val);
          }
          tbody += '<td>' + cell + '</td>';
        });
        tbody += "</tr>";
      });
    }
    tbody += "</tbody>";

    var tableHtml = '<div class="table-wrapper"><table class="table table-sm table-bordered mb-0">' + thead + tbody + '</table></div>';
    document.getElementById("det-table-area").innerHTML = tableHtml;

    // Deal details toggle
    var dealToggleEl = document.getElementById("det-dealdetails-toggle");
    if (dealToggleEl) {
      dealToggleEl.addEventListener("click", function () {
        showDealDetails = !showDealDetails;
        applyFiltersAndRender();
      });
    }

    // Completion dates toggle
    var toggleEl = document.getElementById("det-completion-toggle");
    if (toggleEl) {
      toggleEl.addEventListener("click", function () {
        showCompletionDates = !showCompletionDates;
        applyFiltersAndRender();
      });
    }

    // Sort on header click
    document.getElementById("det-table-area").querySelectorAll("th[data-sortfield]").forEach(function (th) {
      th.addEventListener("click", function () {
        var field = th.dataset.sortfield;
        if (sortField === field) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortField = field;
          var descByDefault = { "Potential Incentives": true, "Missed Incentives": true, "Estimated Earned Incentives": true };
          sortDir = descByDefault[field] ? "desc" : "asc";
        }
        currentPage = 1;
        applySort();
        renderTable();
      });
    });

    // Pagination
    var pgHtml = '<nav><ul class="pagination pagination-sm mb-0">';
    pgHtml += '<li class="page-item' + (currentPage===1?" disabled":"") + '"><a class="page-link" href="#" data-page="' + (currentPage-1) + '">&laquo;</a></li>';
    var startP = Math.max(1, currentPage - 2);
    var endP   = Math.min(totalPages, currentPage + 2);
    if (startP > 1)          pgHtml += '<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>' + (startP > 2 ? '<li class="page-item disabled"><span class="page-link">…</span></li>' : '');
    for (var p = startP; p <= endP; p++) {
      pgHtml += '<li class="page-item' + (p===currentPage?" active":"") + '"><a class="page-link" href="#" data-page="' + p + '">' + p + '</a></li>';
    }
    if (endP < totalPages)   pgHtml += (endP < totalPages - 1 ? '<li class="page-item disabled"><span class="page-link">…</span></li>' : '') + '<li class="page-item"><a class="page-link" href="#" data-page="' + totalPages + '">' + totalPages + '</a></li>';
    pgHtml += '<li class="page-item' + (currentPage===totalPages||totalPages===0?" disabled":"") + '"><a class="page-link" href="#" data-page="' + (currentPage+1) + '">&raquo;</a></li>';
    pgHtml += '</ul></nav>';
    pgHtml += '<small class="text-muted ms-2">' + filteredData.length + ' rows</small>';
    document.getElementById("det-pagination").innerHTML = pgHtml;

    document.getElementById("det-pagination").querySelectorAll("a.page-link").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var p = parseInt(a.dataset.page);
        if (p >= 1 && p <= totalPages) { currentPage = p; renderTable(); }
      });
    });
  }

  function getChecked(groupId) {
    var result = [];
    var container = document.getElementById(groupId);
    if (!container) return result;
    container.querySelectorAll('input[type=checkbox]:checked').forEach(function (cb) { result.push(cb.value); });
    return result;
  }

  function makeCheckboxGroup(label, id, options, optionTips, labelHtmlFn) {
    var html = '<div class="filter-group"><label class="group-label">' + label + '</label><div id="' + id + '">';
    options.forEach(function (o) {
      var safeid = id + '-' + escHtml(o).replace(/\s+/g,"-");
      var tipText = optionTips && (optionTips[o] || optionTips[o.toUpperCase()] || optionTips[o.toLowerCase()]);
      var tipHtml = tipText
        ? ' <i class="bi bi-info-circle text-muted" style="font-size:0.72rem;cursor:default" data-bs-toggle="tooltip" data-bs-placement="right" title="' + tipText.replace(/"/g,"&quot;") + '"></i>'
        : '';
      var labelContent = labelHtmlFn ? labelHtmlFn(o) : escHtml(o);
      html += '<div class="form-check form-check-sm"><input class="form-check-input" type="checkbox" value="' + escHtml(o) + '" id="' + safeid + '">' +
              '<label class="form-check-label" for="' + safeid + '">' + labelContent + tipHtml + '</label></div>';
    });
    html += "</div></div>";
    return html;
  }

  function makeDropdown(id, options) {
    var html = '<select id="' + id + '" class="form-select form-select-sm"><option value="">All</option>';
    options.forEach(function (o) { html += '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>'; });
    return html + "</select>";
  }

  function makeDateSlider(prefix, bounds) {
    if (!bounds || !bounds.min || !bounds.max) {
      return '<div class="text-muted small fst-italic">No date data</div>';
    }
    var minDay = epochDay(bounds.min), maxDay = epochDay(bounds.max);
    return '<div class="date-slider-group">' +
      '<div class="slider-val-display">' +
      '<span id="' + prefix + '-from-lbl">' + bounds.min.toLocaleDateString(window.APP_LOCALE) + '</span>' +
      '<span id="' + prefix + '-to-lbl">'   + bounds.max.toLocaleDateString(window.APP_LOCALE) + '</span>' +
      '</div>' +
      '<div class="dual-range-wrap">' +
      '<div class="dual-range-track"></div>' +
      '<div class="dual-range-fill" id="' + prefix + '-fill"></div>' +
      '<input type="range" class="range-from" id="' + prefix + '-from" min="' + minDay + '" max="' + maxDay + '" value="' + minDay + '" step="1">' +
      '<input type="range" class="range-to"   id="' + prefix + '-to"   min="' + minDay + '" max="' + maxDay + '" value="' + maxDay + '" step="1">' +
      '</div></div>';
  }

  function stageBadgeHtml(name) {
    return '<span class="stage-badge stage-' + escHtml(name) + '">' + escHtml(name) + '</span>';
  }

  function makeStageRangeSlider(prefix, options) {
    var maxIdx = Math.max(0, options.length - 1);
    return '<div class="date-slider-group">' +
      '<div class="slider-val-display">' +
      '<span id="' + prefix + '-from-lbl">' + stageBadgeHtml(options[0] || "") + '</span>' +
      '<span id="' + prefix + '-to-lbl">'   + stageBadgeHtml(options[maxIdx] || "") + '</span>' +
      '</div>' +
      '<div class="dual-range-wrap">' +
      '<div class="dual-range-track"></div>' +
      '<div class="dual-range-fill" id="' + prefix + '-fill"></div>' +
      '<input type="range" class="range-from" id="' + prefix + '-from" min="0" max="' + maxIdx + '" value="0"       step="1">' +
      '<input type="range" class="range-to"   id="' + prefix + '-to"   min="0" max="' + maxIdx + '" value="' + maxIdx + '" step="1">' +
      '</div></div>';
  }

  // ── Export Details to XLSX ──────────────────────────────────────────────────
  function exportDetailsToXlsx(rows) {
    var btn = document.getElementById("det-export-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Exporting…'; }

    setTimeout(function () {
      try {
        var XLS = (typeof XLSXStyle !== "undefined") ? XLSXStyle : XLSX;
        var s = calcSummary(rows);

        // Collect active filter labels
        var activeFilters = [];
        var crVal = document.getElementById("filter-crparty") ? document.getElementById("filter-crparty").value.trim() : "";
        if (crVal) activeFilters.push("Customer/Deal: " + crVal);
        var ttVal = document.getElementById("filter-2tpartner") ? document.getElementById("filter-2tpartner").value.trim() : "";
        if (ttVal) activeFilters.push("2T Partner: " + ttVal);
        var pfVal = document.getElementById("filter-portfolio") ? document.getElementById("filter-portfolio").value : "";
        if (pfVal) activeFilters.push("Portfolio: " + pfVal);
        var ofVal = document.getElementById("filter-offer") ? document.getElementById("filter-offer").value : "";
        if (ofVal) activeFilters.push("Offer: " + ofVal);
        var ucVal2 = document.getElementById("filter-uc") ? document.getElementById("filter-uc").value : "";
        if (ucVal2) activeFilters.push("Use Case: " + ucVal2);
        getChecked("filter-stage").forEach(function(v) { activeFilters.push("Stage: " + v); });
        getChecked("filter-optin").forEach(function(v) { activeFilters.push("Opt-In: " + v); });
        if (document.getElementById("filter-new-eligible") && document.getElementById("filter-new-eligible").checked) activeFilters.push("New Eligible");
        if (document.getElementById("filter-expires-soon") && document.getElementById("filter-expires-soon").checked) activeFilters.push("Expires Soon (<1M)");
        if (document.getElementById("filter-earned")       && document.getElementById("filter-earned").checked)       activeFilters.push("Earned");
        if (document.getElementById("filter-ea")           && document.getElementById("filter-ea").checked)           activeFilters.push("EA");
        if (document.getElementById("filter-aap")          && document.getElementById("filter-aap").checked)          activeFilters.push("AAP");

        // Build sheet rows array
        var sheetData = [];

        // Summary block (rows 0-2)
        sheetData.push(["Customers", s.customers,   "", "Total Missed",           "$" + Math.round(s.missed).toLocaleString()]);
        sheetData.push(["Use Cases", s.useCases,     "", "Total Potential",        "$" + Math.round(s.potential).toLocaleString()]);
        sheetData.push(["",          "",              "", "Total Estimated Earned", "$" + Math.round(s.earned).toLocaleString()]);

        // Active filters — label in row 3, values in row 4, blank in row 5
        sheetData.push(["Active Filters"]);
        sheetData.push([activeFilters.length > 0 ? activeFilters.join("  |  ") : "None"]);
        sheetData.push([]);

        // Column definitions
        var has2T = data.some(function(r){ return r["2T Partner Name"] && String(r["2T Partner Name"]).trim() !== ""; });
        var colDefs = [
          ...(has2T ? [{ label:"2T Partner Name", field:"2T Partner Name" }] : []),
          { label:"CR Party Name",           field:"CR Party Name" },
          { label:"CR Party ID",             field:"CR Party ID" },
          { label:"CX Customer BU ID",       field:"CX Customer BU ID" },
          { label:"Portfolio",               field:"Deal CPI Portfolio" },
          { label:"Offer",                   field:"Track" },
          { label:"Use Case",                field:"Sub-Track" },
          { label:"Current Stage",           field:"Current stage" },
          { label:"Days in Stage",           field:"Days in stage" },
          { label:"Stage Progress",          field:"Current Stage Progress" },
          { label:"Pending Tasks",           field:"Current stage pending tasks" },
          { label:"Deal WS-ID",              field:"Deal WS-ID" },
          { label:"Deal ID",                 field:"Deal ID" },
          { label:"Net Booking",             field:"Booking Amount - Net to Cisco", isCurrency:true },
          { label:"Booking Date",            field:"Booking Date",                isDate:true },
          { label:"Opt-in Date",             field:"Adopt Rebate Start Date",     isDate:true },
          { label:"Expiry Date",             field:"Deal Incentive Expiry Date",  isDate:true },
          { label:"Onboard Completion",      field:"Stage Completion Date(onboard)", isDate:true },
          { label:"Use Completion",          field:"Stage Completion Date(Use)",     isDate:true },
          { label:"Engage Completion",       field:"Stage Completion Date(Engage)",  isDate:true },
          { label:"Adopt Completion",        field:"Stage Completion Date(Adopt)",   isDate:true },
          { label:"Stages Completed Before Opt-in", field:"_missedStages" },
          { label:"Missed Incentives",       field:"Missed Incentives",           isCurrency:true },
          { label:"Potential Incentives",    field:"Potential Incentives",        isCurrency:true },
          { label:"Est. Earned Incentives",  field:"Estimated Earned Incentives", isCurrency:true },
          { label:"Opt-In Status",           field:"Adopt Rebate Opt-In Status" },
          { label:"Stage",                   field:"Stage" },
          { label:"Earned?",                 field:"Earned?" }
        ];

        var headerRow = colDefs.map(function(c){ return c.label; });
        sheetData.push(headerRow);
        var headerRowIdx = sheetData.length - 1;

        rows.forEach(function(r) {
          var row = colDefs.map(function(c) {
            var v = r[c.field];
            if (c.isCurrency) return (v === null || v === undefined || isNaN(v)) ? 0 : Math.round(v);
            if (c.isDate) return fmtDate(v);
            if (c.field === "Earned?") return v === true ? "Yes" : "No";
            if (c.field === "_missedStages") {
              var optInDate = toDate(r["Adopt Rebate Start Date"]);
              var msParts = [];
              [{ name: "Onboard", f: "Stage Completion Date(onboard)" },
               { name: "Use",     f: "Stage Completion Date(Use)" },
               { name: "Engage",  f: "Stage Completion Date(Engage)" },
               { name: "Adopt",   f: "Stage Completion Date(Adopt)" }].forEach(function (s) {
                var cd = toDate(r[s.f]);
                if (cd && optInDate && cd < optInDate) msParts.push(s.name);
              });
              return msParts.length ? msParts.join(", ") : "N/A";
            }
            return (v === null || v === undefined) ? "" : String(v);
          });
          sheetData.push(row);
        });

        var wb = XLS.utils.book_new();
        var ws = XLS.utils.aoa_to_sheet(sheetData);

        // Column widths
        ws["!cols"] = colDefs.map(function(c) {
          if (c.isCurrency) return { wch: 22 };
          if (c.field === "CR Party Name" || c.field === "2T Partner Name") return { wch: 35 };
          if (c.field === "Deal WS-ID" || c.field === "Track") return { wch: 22 };
          if (c.field === "_missedStages") return { wch: 30 };
          return { wch: 16 };
        });

        // Summary label/value styles
        var summaryLabelStyle = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "E8F0FD" }, patternType: "solid" } };
        var summaryValStyle   = { font: { sz: 10 }, alignment: { horizontal: "right" } };
        [[0,0],[0,3],[1,0],[1,3],[2,3]].forEach(function(rc) {
          var addr = XLS.utils.encode_cell({ r: rc[0], c: rc[1] });
          if (ws[addr]) ws[addr].s = summaryLabelStyle;
        });
        [[0,1],[0,4],[1,1],[1,4],[2,4]].forEach(function(rc) {
          var addr = XLS.utils.encode_cell({ r: rc[0], c: rc[1] });
          if (ws[addr]) ws[addr].s = summaryValStyle;
        });
        var filterLabelAddr = XLS.utils.encode_cell({ r: 3, c: 0 });
        if (ws[filterLabelAddr]) ws[filterLabelAddr].s = summaryLabelStyle;
        var filterAddr = XLS.utils.encode_cell({ r: 4, c: 0 });
        if (ws[filterAddr]) ws[filterAddr].s = { font: { italic: true, sz: 9, color: { rgb: "666666" } } };

        // Header row style
        var hdrFont = { bold: true, color: { rgb: "FFFFFF" }, sz: 10 };
        var hdrFill = { fgColor: { rgb: "1B5FAD" }, patternType: "solid" };
        headerRow.forEach(function(lbl, ci) {
          var addr = XLS.utils.encode_cell({ r: headerRowIdx, c: ci });
          if (!ws[addr]) ws[addr] = { v: lbl, t: "s" };
          ws[addr].s = { font: hdrFont, fill: hdrFill, alignment: { horizontal: "center", wrapText: true } };
        });

        // Data rows — alternate shading + currency number format
        rows.forEach(function(_, ri) {
          var wsRow = headerRowIdx + 1 + ri;
          var fillColor = ri % 2 === 0 ? "FFFFFF" : "F5F8FF";
          colDefs.forEach(function(c, ci) {
            var addr = XLS.utils.encode_cell({ r: wsRow, c: ci });
            if (!ws[addr]) ws[addr] = { v: "", t: "s" };
            ws[addr].s = { fill: { fgColor: { rgb: fillColor }, patternType: "solid" }, font: { sz: 9 } };
            if (c.isCurrency && ws[addr].t === "n") {
              ws[addr].z = '"$"#,##0';
              ws[addr].s.alignment = { horizontal: "right" };
            }
          });
        });

        // Row heights
        ws["!rows"] = sheetData.map(function(_, ri) {
          return ri === headerRowIdx ? { hpt: 30 } : { hpt: 18 };
        });

        // Filename
        var beGeoStr = Array.from(new Set(data.map(function(r){ return String(r["BE GEO ID"]||""); }).filter(Boolean))).join("-") || "export";
        var dateStr = new Date().toLocaleDateString(window.APP_LOCALE, { year:"numeric", month:"2-digit", day:"2-digit" })
          .replace(/\//g,"-").replace(/\./g,"-");
        XLS.utils.book_append_sheet(wb, ws, "Details");
        XLS.writeFile(wb, "AdoptDash_Details_" + beGeoStr + "_" + dateStr + ".xlsx");
      } catch(err) {
        alert("Export failed: " + err.message);
        console.error(err);
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-file-earmark-excel me-1"></i>Export to Excel'; }
      }
    }, 50);
  }
}

window.renderDetails = renderDetails;
