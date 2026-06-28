// =============================================================================
// lifecycle.js — Lifecycle tab renderer (stage bar chart)
// =============================================================================

var _lifecycleChart = null;

function renderLifecycle(data) {
  var el = document.getElementById("tab-lifecycle");
  if (!el) return;

  function norm(x) {
    if (x === null || x === undefined) return "";
    return String(x).replace(/\u00A0/g, " ").trim().toUpperCase();
  }

  function toDate(x) {
    if (!x) return null;
    if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
    if (typeof x === "number" && x > 1000) { var d=new Date(Math.round((x-25569)*86400*1000)); return isNaN(d.getTime())?null:d; }
    if (typeof x === "string") { var d2=new Date(x); return isNaN(d2.getTime())?null:d2; }
    return null;
  }

  function fmtCurrency(v) {
    if (Math.abs(v) >= 1000000) return "$" + (v/1000000).toFixed(1) + "M";
    if (Math.abs(v) >= 1000)    return "$" + (v/1000).toFixed(0) + "K";
    return "$" + Math.round(v).toLocaleString();
  }

  var STAGE_ORDER = ["Purchase","Onboard","Implement","Use","Engage","Adopt","Completed"];
  var STAGE_COLORS = {
    Purchase:  "#D13438",
    Onboard:   "#D13438",
    Implement: "#FF8C00",
    Use:       "#FF8C00",
    Engage:    "#107C10",
    Adopt:     "#107C10",
    Completed: "#107C10"
  };

  var PORTFOLIO_ORDER = ["Networking", "Security", "Cloud + AI Infrastructure", "Collaboration"];
  var pSet = new Set(), oSet = new Set();
  data.forEach(function (r) {
    if (r["Deal CPI Portfolio"]) pSet.add(r["Deal CPI Portfolio"]);
    if (r["Track"])              oSet.add(r["Track"]);
  });
  var portfolios = Array.from(pSet).sort(function (a, b) {
    var ai = PORTFOLIO_ORDER.indexOf(a), bi = PORTFOLIO_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  var allOffers  = Array.from(oSet).sort();

  // ── HTML
  var html = '<h5 class="mb-3"><i class="bi bi-bar-chart me-2"></i>Lifecycle</h5>';
  html += '<p class="text-muted small mb-3">Depicts lifecycle progression using the net booking value of eligible SKUs. Only deals booked within the last 18 fiscal months are included. One use case per offer and CR Party ID is selected: preference is given to opted-in use cases, otherwise the highest-incentive use case is chosen.</p>';

  html += '<div class="slicer-row mb-3">';
  html += '<label for="lc-portfolio">Portfolio:</label>';
  html += '<select id="lc-portfolio" class="form-select form-select-sm" style="max-width:240px">';
  html += '<option value="">All Portfolios</option>';
  portfolios.forEach(function (p) { html += '<option value="' + p.replace(/"/g,"&quot;") + '">' + p + '</option>'; });
  html += '</select>';
  html += '<label for="lc-offer">Offer:</label>';
  html += '<select id="lc-offer" class="form-select form-select-sm" style="max-width:240px">';
  html += '<option value="">All Offers</option>';
  allOffers.forEach(function (o) { html += '<option value="' + o.replace(/"/g,"&quot;") + '">' + o + '</option>'; });
  html += '</select>';
  html += '<div class="ms-auto btn-group btn-group-sm" role="group">';
  html += '<button id="lc-btn-column" class="btn btn-cisco" title="Column chart"><i class="bi bi-bar-chart-fill"></i> Columns</button>';
  html += '<button id="lc-btn-waterfall" class="btn btn-outline-secondary" title="Waterfall chart"><i class="bi bi-bar-chart-steps"></i> Waterfall</button>';
  html += '</div>';
  html += '</div>';

  html += '<div style="display:inline-block;width:100%;position:relative">';
  html += '<div class="chart-container" style="max-height:480px;padding-bottom:28px"><canvas id="lc-chart"></canvas>';
  html += '<div style="position:absolute;bottom:0;left:0;right:0;text-align:center"><a href="#" id="lc-deeplink" class="small"><i class="bi bi-box-arrow-up-right me-1"></i>Open in Details tab</a></div>';
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;

  var portfolioSel = document.getElementById("lc-portfolio");
  var offerSel     = document.getElementById("lc-offer");
  var btnColumn    = document.getElementById("lc-btn-column");
  var btnWaterfall = document.getElementById("lc-btn-waterfall");
  var chartMode    = "column"; // default

  function setMode(mode) {
    chartMode = mode;
    if (mode === "column") {
      btnColumn.className    = "btn btn-cisco";
      btnWaterfall.className = "btn btn-outline-secondary";
    } else {
      btnColumn.className    = "btn btn-outline-secondary";
      btnWaterfall.className = "btn btn-cisco";
    }
    buildChart(portfolioSel.value, offerSel.value);
  }

  btnColumn.addEventListener("click",    function () { setMode("column"); });
  btnWaterfall.addEventListener("click", function () { setMode("waterfall"); });

  // When portfolio changes, repopulate offer list to matching offers only
  portfolioSel.addEventListener("change", function () {
    var pVal = this.value;
    var filtered = pVal
      ? Array.from(new Set(data.filter(function(r){ return r["Deal CPI Portfolio"] === pVal; }).map(function(r){ return r["Track"]; }))).sort()
      : allOffers;
    offerSel.innerHTML = '<option value="">All Offers</option>';
    filtered.forEach(function (o) { offerSel.innerHTML += '<option value="' + o.replace(/"/g,"&quot;") + '">' + o + '</option>'; });
    offerSel.value = "";
    buildChart(pVal, "");
  });

  offerSel.addEventListener("change", function () {
    buildChart(portfolioSel.value, this.value);
  });

  // Restore persisted filter state
  var _lcSaved = window.APP_FILTER_STATE && window.APP_FILTER_STATE.lifecycle;
  if (_lcSaved) {
    if (_lcSaved.portfolio) {
      portfolioSel.value = _lcSaved.portfolio;
      var _lcOffers = Array.from(new Set(data.filter(function(r){ return r["Deal CPI Portfolio"] === _lcSaved.portfolio; }).map(function(r){ return r["Track"]; }))).sort();
      offerSel.innerHTML = '<option value="">All Offers</option>';
      _lcOffers.forEach(function(o){ offerSel.innerHTML += '<option value="'+o.replace(/"/g,'&quot;')+'">'+o+'</option>'; });
    }
    if (_lcSaved.offer) offerSel.value = _lcSaved.offer;
    if (_lcSaved.chartMode) {
      chartMode = _lcSaved.chartMode;
      btnColumn.className    = chartMode === "column"    ? "btn btn-cisco" : "btn btn-outline-secondary";
      btnWaterfall.className = chartMode === "waterfall" ? "btn btn-cisco" : "btn btn-outline-secondary";
    }
  }

  buildChart(portfolioSel.value, offerSel.value);

  function buildChart(portfolioFilter, offerFilter) {
    if (window.APP_FILTER_STATE) {
      window.APP_FILTER_STATE.lifecycle = { portfolio: portfolioFilter, offer: offerFilter, chartMode: chartMode };
    }

    // Update deep link
    var dlEl = document.getElementById("lc-deeplink");
    if (dlEl) {
      dlEl.onclick = function(e) {
        e.preventDefault();
        var cutoff = window.get18MonthAgoStart ? window.get18MonthAgoStart() : new Date(new Date().getFullYear(), new Date().getMonth() - 17, 1);
        var preset = {
          stage: ["Eligible"],
          maxIncentive: true,
          bkFrom: Math.floor(cutoff.getTime() / 86400000)
        };
        if (portfolioFilter) preset.portfolio = portfolioFilter;
        if (offerFilter)     preset.offer     = offerFilter;
        if (window.navigateToDetails) window.navigateToDetails(preset);
      };
    }
    var cutoff = window.get18MonthAgoStart ? window.get18MonthAgoStart() : new Date(new Date().getFullYear(), new Date().getMonth() - 17, 1);

    var subset = data.filter(function (r) {
      if (norm(r["Maximum Incentive Deal Flag"]) !== "YES") return false;
      var bd = toDate(r["Booking Date"]);
      if (!bd || bd < cutoff) return false;
      if (portfolioFilter && r["Deal CPI Portfolio"] !== portfolioFilter) return false;
      if (offerFilter     && r["Track"]              !== offerFilter)     return false;
      return true;
    });

    // Deduplicate by Deal WS-ID
    var dealMap = {};
    subset.forEach(function (r) {
      var id  = r["Deal WS-ID"] || (r["CRPartyID-Offer"] + "|" + r["Booking Date"]);
      var amt = parseFloat(r["Booking Amount - Net to Cisco"]) || 0;
      if (!dealMap[id] || amt > dealMap[id].amt) {
        dealMap[id] = { stage: r["Current stage"] || "Purchase", amt: amt };
      }
    });

    // Sum booking per stage
    var stageBook = {};
    STAGE_ORDER.forEach(function (s) { stageBook[s] = 0; });
    Object.keys(dealMap).forEach(function (id) {
      var d = dealMap[id];
      if (stageBook[d.stage] !== undefined) stageBook[d.stage] += d.amt;
    });

    if (_lifecycleChart) { _lifecycleChart.destroy(); _lifecycleChart = null; }
    var ctx = document.getElementById("lc-chart").getContext("2d");

    var chartData, tooltipCb;

    if (chartMode === "waterfall") {
      // Floating bars rising upward: each bar starts at cumulative base, rises by its value
      var cumulative = 0;
      var floatData  = [];
      STAGE_ORDER.forEach(function (stage) {
        var amt = stageBook[stage] || 0;
        floatData.push([cumulative, cumulative + amt]);
        cumulative += amt;
      });
      chartData = {
        labels: STAGE_ORDER,
        datasets: [{
          label: "Booking Amount",
          data: floatData,
          backgroundColor: STAGE_ORDER.map(function (s) { return STAGE_COLORS[s]; }),
          borderRadius: 4
        }]
      };
      tooltipCb = function (ctx) {
        var val = ctx.raw[1] - ctx.raw[0];
        return "$" + Math.round(val).toLocaleString();
      };
    } else {
      chartData = {
        labels: STAGE_ORDER,
        datasets: [{
          label: "Booking Amount",
          data: STAGE_ORDER.map(function (s) { return stageBook[s] || 0; }),
          backgroundColor: STAGE_ORDER.map(function (s) { return STAGE_COLORS[s]; }),
          borderRadius: 4
        }]
      };
      tooltipCb = function (ctx) {
        return "$" + Math.round(ctx.raw).toLocaleString();
      };
    }

    _lifecycleChart = new Chart(ctx, {
      type: "bar",
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          x: { ticks: { font: { size: 11 } } },
          y: {
            beginAtZero: true,
            ticks: { callback: function (v) { return fmtCurrency(v); }, font: { size: 11 } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: tooltipCb } }
        }
      }
    });
  }
}

window.renderLifecycle = renderLifecycle;
