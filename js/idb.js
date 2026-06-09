// =============================================================================
// idb.js — IndexedDB persistence for APP_DATA
// =============================================================================
// Stores up to two named dataset slots: "workspan" and "lci".
// Each entry: { type, data (APP_DATA array), meta: { filename, rowCount, loadedAt, ... } }
// =============================================================================

var IDB = (function () {
  var DB_NAME      = "AdoptionDashboard";
  var DB_VERSION   = 2;
  var STORE        = "datasets";
  var HANDLE_STORE = "fileHandles";
  var _db          = null;

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
      };
      req.onsuccess  = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror    = function (e) { reject(e.target.error); };
    });
  }

  function save(type, data, meta) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(STORE, "readwrite");
        var store = tx.objectStore(STORE);
        var req = store.put({ type: type, data: data, meta: meta });
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

  // Request persistent storage so the browser won't auto-evict IndexedDB data
  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function (granted) {
        if (!granted) console.warn("AdoptDash: persistent storage not granted — browser may evict session data.");
      });
    }
  }

  function clearAll() {
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

  return { save: save, load: load, remove: remove, loadAll: loadAll, clearAll: clearAll, requestPersistence: requestPersistence, saveHandle: saveHandle, loadHandle: loadHandle, removeHandle: removeHandle, clearAllHandles: clearAllHandles };
})();
