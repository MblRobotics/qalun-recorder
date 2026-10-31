// IndexedDB persistence.
//   recordings: metadata of each take (keyPath id, auto-increment)
//   audio:      WAV bytes of each take, keyed by the same id
//   meta:       key/value (profile, progress per reader+mode, last export)
const DB_NAME = 'qalun-recorder';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Runs fn(stores) in one transaction; resolves with fn's value once committed.
function tx(names, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    const stores = Object.fromEntries([].concat(names).map((n) => [n, t.objectStore(n)]));
    const box = {};
    fn(stores, box);
    t.oncomplete = () => resolve(box.value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  }));
}

export const store = {
  // rec: metadata + { wav: ArrayBuffer }. Returns the new id.
  addRecording(rec) {
    const { wav, ...meta } = rec;
    return tx(['recordings', 'audio'], 'readwrite', (s, box) => {
      const r = s.recordings.add(meta);
      r.onsuccess = () => {
        box.value = r.result;
        s.audio.put(wav, r.result);
        // keep id inside the metadata too
        s.recordings.put({ ...meta, id: r.result });
      };
    });
  },
  deleteRecording(id) {
    return tx(['recordings', 'audio'], 'readwrite', (s) => {
      s.recordings.delete(id);
      s.audio.delete(id);
    });
  },
  allRecordings() {
    return tx('recordings', 'readonly', (s, box) => {
      const r = s.recordings.getAll();
      r.onsuccess = () => { box.value = r.result; };
    });
  },
  getAudio(id) {
    return tx('audio', 'readonly', (s, box) => {
      const r = s.audio.get(id);
      r.onsuccess = () => { box.value = r.result; };
    });
  },
  // All recordings with their WAV bytes attached (for export).
  allWithAudio() {
    return tx(['recordings', 'audio'], 'readonly', (s, box) => {
      const r = s.recordings.getAll();
      r.onsuccess = () => {
        const recs = r.result;
        box.value = recs;
        recs.forEach((rec) => {
          const a = s.audio.get(rec.id);
          a.onsuccess = () => { rec.wav = a.result; };
        });
      };
    });
  },
  clearRecordings() {
    return tx(['recordings', 'audio'], 'readwrite', (s) => {
      s.recordings.clear();
      s.audio.clear();
    });
  },
  getMeta(key) {
    return tx('meta', 'readonly', (s, box) => {
      const r = s.meta.get(key);
      r.onsuccess = () => { box.value = r.result; };
    });
  },
  setMeta(key, value) {
    return tx('meta', 'readwrite', (s) => { s.meta.put(value, key); });
  },
  async persist() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (e) { /* ignore */ }
    return false;
  },
};
