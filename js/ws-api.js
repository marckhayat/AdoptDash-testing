// =============================================================================
// ws-api.js — WorkSpan API loader (routes through local proxy for CORS)
// =============================================================================

var WS_API = "https://api.workspan.com";
var WS_PROXY = "http://localhost:8765"; // local proxy started by Start Proxy script

// ── Data cleaning helpers (mirrors Python script) ──────────────────────────

function wsCleanHtml(text) {
  if (typeof text !== "string" || !text) return text;
  text = text.replace(/&emsp;?|&nbsp;?/gi, " ");
  // Unescape up to 3 times for nested encoding
  for (var i = 0; i < 3; i++) {
    text = text.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
               .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  }
  text = text.replace(/<(p|br|div|li|tr)[^>]*>/gi, " ");
  text = text.replace(/<[^>]+>/g, "");
  // sanitizeValue handles the rest (spaces, control chars, smart quotes, zero-width, BOM)
  return sanitizeValue(text);
}

function wsCleanColumnNames(row) {
  var out = {};
  Object.keys(row).forEach(function(k) {
    var newKey = k;
    if (k.toLowerCase().endsWith(".value")) newKey = k.slice(0, -6);
    else if (k.toLowerCase().endsWith(".currency")) newKey = k.slice(0, -9) + " (Currency)";
    // avoid overwrite
    if (!(newKey in out)) out[newKey] = row[k];
  });
  return out;
}

function wsUnwrapLists(row) {
  var out = {};
  Object.keys(row).forEach(function(k) {
    var v = row[k];
    if (Array.isArray(v)) {
      v = v.map(String).join(" ");
    } else if (typeof v === "string" && (v.indexOf("[") !== -1 || v.indexOf("'") !== -1)) {
      v = v.replace(/[\[\]'"]/g, "");
    }
    out[k] = v;
  });
  return out;
}

// Flatten one level of nested objects (mirrors pd.json_normalize max_level=1)
function wsNormalizeRow(raw) {
  var flat = {};
  Object.keys(raw).forEach(function(k) {
    var v = raw[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.keys(v).forEach(function(sub) {
        flat[k + "." + sub] = v[sub];
      });
    } else {
      flat[k] = v;
    }
  });
  return flat;
}

function wsCleanRows(rows) {
  return rows.map(function(raw) {
    var r = wsNormalizeRow(raw);
    r = wsCleanColumnNames(r);
    r = wsUnwrapLists(r);
    // Clean HTML from every string value
    Object.keys(r).forEach(function(k) {
      if (typeof r[k] === "string") r[k] = wsCleanHtml(r[k]);
    });
    // Drop internal columns
    delete r["linked_object_id"];
    delete r["object_id"];
    return r;
  });
}

// ── API calls (routed through local proxy) ─────────────────────────────────

function wsProxyUrl(path) {
  return WS_PROXY + path;
}

function wsAuthenticate(clientId, clientSecret) {
  return fetch(wsProxyUrl("/oauth/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ws-env": "app.workspan.com" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret })
  }).then(function(r) {
    if (!r.ok) throw new Error("Auth failed: HTTP " + r.status);
    return r.json();
  }).then(function(data) {
    if (!data.access_token) throw new Error("Auth failed: no token in response");
    return data.token_type + " " + data.access_token;
  });
}

function wsPrepareExport(reportId, authHeader) {
  return fetch(wsProxyUrl("/report/v1/view/" + reportId + "/prepare_export"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ws-env": "app.workspan.com", "Authorization": authHeader },
    body: JSON.stringify({ expiryHours: 1 })
  }).then(function(r) {
    if (!r.ok) throw new Error("prepare_export failed: HTTP " + r.status);
    return r.json();
  }).then(function(data) {
    if (!data.viewId) throw new Error("prepare_export: no viewId returned");
    return data.viewId;
  });
}

function wsPollStatus(viewId, authHeader, onStatus) {
  return new Promise(function(resolve, reject) {
    var deadline = Date.now() + 15 * 60 * 1000;
    function poll() {
      fetch(wsProxyUrl("/report/v1/view/" + viewId + "/status"), {
        headers: { "x-ws-env": "app.workspan.com", "Authorization": authHeader }
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          var status = data.viewStatus;
          if (onStatus) onStatus(status);
          if (status === "PENDING" || status === "RUNNING") {
            if (Date.now() > deadline) { reject(new Error("Timed out waiting for report.")); return; }
            setTimeout(poll, 8000);
          } else if (status === "SUCCESS") {
            resolve(viewId);
          } else {
            reject(new Error("Report view failed with status: " + status));
          }
        }).catch(reject);
    }
    setTimeout(poll, 5000);
  });
}

function wsFetchAllPages(viewId, authHeader, onProgress) {
  var allRows = [];
  function fetchPage(page) {
    return fetch(wsProxyUrl("/report/v1/view/" + viewId + "/data"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ws-env": "app.workspan.com", "Authorization": authHeader },
      body: JSON.stringify({ page: { number: page, size: 10000 } })
    }).then(function(r) {
      if (!r.ok) throw new Error("data fetch failed: HTTP " + r.status);
      return r.json();
    }).then(function(data) {
      allRows = allRows.concat(data.results || []);
      if (onProgress) onProgress(allRows.length);
      if (data.endOfList) return allRows;
      return fetchPage(page + 1);
    });
  }
  return fetchPage(0);
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Load a WorkSpan report via API.
 * @param {object} opts - { reportId, clientId, clientSecret, onStatus }
 * @returns Promise<Array> cleaned rows ready for transformData()
 */
function wsLoadReport(opts) {
  var auth;
  opts.onStatus("Authenticating…");
  return wsAuthenticate(opts.clientId, opts.clientSecret)
    .then(function(token) {
      auth = token;
      opts.onStatus("Preparing report export…");
      return wsPrepareExport(opts.reportId, auth);
    })
    .then(function(viewId) {
      opts.onStatus("Waiting for server to build report…");
      return wsPollStatus(viewId, auth, function(s) {
        opts.onStatus("Server status: " + s + "…");
      });
    })
    .then(function(viewId) {
      opts.onStatus("Downloading data…");
      return wsFetchAllPages(viewId, auth, function(count) {
        opts.onStatus("Downloaded " + count.toLocaleString() + " rows…");
      });
    })
    .then(function(rawRows) {
      opts.onStatus("Cleaning data…");
      return wsCleanRows(rawRows);
    });
}
