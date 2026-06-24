// =============================================================================
// idb.js — IndexedDB persistence for APP_DATA
// =============================================================================
// Uses two object stores:
//   "datasets"    — full session data: { type, data (APP_DATA array), meta }
//   "fileHandles" — FileSystemFileHandle references: { type, handle }
//
// Session metadata for the session-list UI is stored in localStorage
// (key: "AdoptDash_sessionMeta") so it is always fast and reliable,
// with no IDB version bumps required.
// =============================================================================

var IDB = (function () {
  var DB_NAME      = "AdoptionDashboard";
  var DB_VERSION   = 4;
  var STORE        = "datasets";
  var HANDLE_STORE = "fileHandles";
  var ANNOT_STORE  = "annotations";
  var _db          = null;

  // ── localStorage-backed session metadata ────────────────────────────────
  var _META_LS_KEY = "AdoptDash_sessionMeta";

  function _lsGetAll() {
    try { return JSON.parse(localStorage.getItem(_META_LS_KEY) || "[]"); } catch (e) { return []; }
  }
  function _lsSet(all) {
    try { localStorage.setItem(_META_LS_KEY, JSON.stringify(all)); } catch (e) { console.warn("Session meta save failed:", e); }
  }
  function _lsSaveMeta(type, meta) {
    var all = _lsGetAll();
    var found = false;
    for (var i = 0; i < all.length; i++) { if (all[i].type === type) { all[i].meta = meta; found = true; break; } }
    if (!found) all.push({ type: type, meta: meta });
    _lsSet(all);
  }
  function _lsRemoveMeta(type) {
    _lsSet(_lsGetAll().filter(function (e) { return e.type !== type; }));
  }
  function _lsClearMeta() {
    try { localStorage.removeItem(_META_LS_KEY); } catch (e) {}
  }

  // ── IndexedDB helpers ────────────────────────────────────────────────────
  function open() {
    return new Promise(function (resolve, reject) {
      if (_db) { resolve(_db); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "type" });
        }
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          db.createObjectStore(HANDLE_STORE, { keyPath: "type" });
        }
        if (!db.objectStoreNames.contains(ANNOT_STORE)) {
          db.createObjectStore(ANNOT_STORE, { keyPath: "wsId" });
        }
      };
      req.onsuccess  = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror    = function (e) { reject(e.target.error); };
    });
  }

  function save(type, data, meta) {
    _lsSaveMeta(type, meta); // always write metadata to localStorage first (synchronous)
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(STORE, "readwrite");
        var store = tx.objectStore(STORE);
        var req   = store.put({ type: type, data: data, meta: meta });
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function load(type) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(STORE, "readonly");
        var store = tx.objectStore(STORE);
        var req   = store.get(type);
        req.onsuccess = function (e) { resolve(e.target.result || null); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function remove(type) {
    _lsRemoveMeta(type);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(STORE, "readwrite");
        var store = tx.objectStore(STORE);
        var req   = store.delete(type);
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function loadAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(STORE, "readonly");
        var store = tx.objectStore(STORE);
        var req   = store.getAll();
        req.onsuccess = function (e) { resolve(e.target.result || []); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  // Returns session metadata for the session-list UI.
  // Reads from localStorage (fast, synchronous). If empty, attempts a one-time
  // migration from IDB so existing sessions survive the transition.
  function loadAllMeta() {
    var lsEntries = _lsGetAll();
    if (lsEntries.length > 0) return Promise.resolve(lsEntries);
    // localStorage empty — try one-time migration from IDB
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(STORE, "readonly");
        var store = tx.objectStore(STORE);
        var req   = store.getAll();
        req.onsuccess = function (e) { resolve(e.target.result || []); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    }).then(function (fullEntries) {
      var metaOnly = fullEntries.map(function (e) { return { type: e.type, meta: e.meta }; });
      if (metaOnly.length > 0) _lsSet(metaOnly);
      return metaOnly;
    }).catch(function () { return []; });
  }

  // Request persistent storage so the browser won't auto-evict IndexedDB data
  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function (granted) {
        if (!granted) console.warn("AdoptDash: persistent storage not granted — browser may evict session data.");
      });
    }
  }

  function clearAll() {
    _lsClearMeta();
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(STORE, "readwrite");
        var store = tx.objectStore(STORE);
        var req   = store.clear();
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function saveHandle(type, handle) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(HANDLE_STORE, "readwrite");
        var store = tx.objectStore(HANDLE_STORE);
        var req   = store.put({ type: type, handle: handle });
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function loadHandle(type) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(HANDLE_STORE, "readonly");
        var store = tx.objectStore(HANDLE_STORE);
        var req   = store.get(type);
        req.onsuccess = function (e) { resolve(e.target.result ? e.target.result.handle : null); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function removeHandle(type) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(HANDLE_STORE, "readwrite");
        var store = tx.objectStore(HANDLE_STORE);
        var req   = store.delete(type);
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function clearAllHandles() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(HANDLE_STORE, "readwrite");
        var store = tx.objectStore(HANDLE_STORE);
        var req   = store.clear();
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function saveAnnotation(wsId, tags, comment, excluded) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(ANNOT_STORE, "readwrite");
        var store = tx.objectStore(ANNOT_STORE);
        var req   = store.put({ wsId: wsId, tags: tags || [], comment: comment || "", excluded: !!excluded });
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function loadAnnotation(wsId) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(ANNOT_STORE, "readonly");
        var store = tx.objectStore(ANNOT_STORE);
        var req   = store.get(wsId);
        req.onsuccess = function (e) { resolve(e.target.result || null); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function removeAnnotation(wsId) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(ANNOT_STORE, "readwrite");
        var store = tx.objectStore(ANNOT_STORE);
        var req   = store.delete(wsId);
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function loadAllAnnotations() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(ANNOT_STORE, "readonly");
        var store = tx.objectStore(ANNOT_STORE);
        var req   = store.getAll();
        req.onsuccess = function (e) { resolve(e.target.result || []); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function clearAllAnnotations() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx    = db.transaction(ANNOT_STORE, "readwrite");
        var store = tx.objectStore(ANNOT_STORE);
        var req   = store.clear();
        req.onsuccess = resolve;
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  return { save: save, load: load, remove: remove, loadAll: loadAll, loadAllMeta: loadAllMeta, clearAll: clearAll, requestPersistence: requestPersistence, saveHandle: saveHandle, loadHandle: loadHandle, removeHandle: removeHandle, clearAllHandles: clearAllHandles, saveAnnotation: saveAnnotation, loadAnnotation: loadAnnotation, removeAnnotation: removeAnnotation, loadAllAnnotations: loadAllAnnotations, clearAllAnnotations: clearAllAnnotations };
})();
