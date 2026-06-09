// xlsx-worker.js — runs XLSX parsing in a separate thread with its own memory
importScripts('https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js');

var KNOWN_COLUMNS = [
  "Deal WS-ID", "Partner Name", "CR Party Name", "Track", "Sub-Track",
  "Stage", "CR Party ID", "BE GEO ID", "Program Type", "Booking Date",
  "Incentive Level", "Adopt Rebate Opt-In Status", "Deal Incentive Expiry Date"
];

function findHeaderRowIndex(rows2d) {
  var bestIdx = 0, bestScore = 0;
  for (var i = 0; i < Math.min(rows2d.length, 20); i++) {
    var row = rows2d[i];
    if (!row) continue;
    var score = 0;
    for (var j = 0; j < row.length; j++) {
      if (row[j] && KNOWN_COLUMNS.indexOf(String(row[j]).trim()) !== -1) score++;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
    if (score >= 3) break;
  }
  return bestIdx;
}

self.onmessage = function (e) {
  try {
    self.postMessage({ type: 'progress', msg: 'Parsing Excel file…' });

    var wb = XLSX.read(e.data, {
      type: 'array',
      cellDates: false,
      cellHTML: false,
      cellStyles: false,
      cellFormula: false,
      dense: true
    });

    // Find the best sheet
    var sheetName = null;
    var headerIdx = 0;

    for (var si = 0; si < wb.SheetNames.length; si++) {
      var name = wb.SheetNames[si];
      var sheet = wb.Sheets[name];
      if (!sheet || !sheet['!ref']) continue;

      var preview = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, sheetRows: 15 });
      if (!preview || preview.length === 0) continue;

      var hi = findHeaderRowIndex(preview);
      var row = preview[hi] || [];
      var score = 0;
      for (var ci = 0; ci < row.length; ci++) {
        if (row[ci] && KNOWN_COLUMNS.indexOf(String(row[ci]).trim()) !== -1) score++;
      }
      if (score > 0) { sheetName = name; headerIdx = hi; break; }
    }

    if (!sheetName) {
      // fallback: first non-empty sheet
      for (var si2 = 0; si2 < wb.SheetNames.length; si2++) {
        var s = wb.Sheets[wb.SheetNames[si2]];
        if (s && s['!ref']) { sheetName = wb.SheetNames[si2]; break; }
      }
    }

    if (!sheetName) {
      self.postMessage({ type: 'error', msg: 'No readable sheets found. Sheets: ' + wb.SheetNames.join(', ') });
      return;
    }

    self.postMessage({ type: 'progress', msg: 'Converting to CSV…' });

    var csvString = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { defval: '' });

    if (headerIdx > 0) {
      var lines = csvString.split('\n');
      csvString = lines.slice(headerIdx).join('\n');
    }

    // Transfer the string back to the main thread
    self.postMessage({ type: 'done', csv: csvString, sheetName: sheetName, headerIdx: headerIdx });

  } catch (err) {
    self.postMessage({ type: 'error', msg: err.message });
  }
};
