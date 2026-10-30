/*
 * Browser persistence so a refresh never loses the quiz.
 *  - The quiz (may contain pasted images → can be MBs) goes in IndexedDB.
 *  - Videos picked in the editor are Blobs kept apart under 'media:<id>' so the
 *    quiz itself stays small; the quiz refers to them as 'idb:<id>'.
 *  - The session (small, saved after every action) goes in localStorage.
 * Every call fails soft: in a private window the app still works, it just
 * won't remember anything.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'thu-thach-tri-thuc';
  const STORE = 'kv';
  const SESSION_KEY = 'tttt.session';
  const PREFS_KEY = 'tttt.prefs';

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function tx(mode, fn) {
    return db().then(
      (d) =>
        new Promise((resolve, reject) => {
          const t = d.transaction(STORE, mode);
          const req = fn(t.objectStore(STORE));
          t.oncomplete = () => resolve(req && req.result);
          t.onerror = () => reject(t.error);
        })
    );
  }

  async function saveQuiz(quiz) {
    try {
      await tx('readwrite', (s) => s.put(quiz, 'quiz'));
      return true;
    } catch (e) {
      console.warn('Không lưu được bộ câu hỏi', e);
      return false;
    }
  }

  async function loadQuiz() {
    try {
      return (await tx('readonly', (s) => s.get('quiz'))) || null;
    } catch (e) {
      return null;
    }
  }

  async function saveMedia(id, blob) {
    try {
      await tx('readwrite', (s) => s.put(blob, 'media:' + id));
      return true;
    } catch (e) {
      console.warn('Không lưu được video', e);
      return false;
    }
  }

  async function loadMedia(id) {
    try {
      return (await tx('readonly', (s) => s.get('media:' + id))) || null;
    } catch (e) {
      return null;
    }
  }

  /** Delete stored videos the quiz no longer refers to. */
  async function pruneMedia(keepIds) {
    try {
      const keys = await tx('readonly', (s) => s.getAllKeys());
      const stale = keys.filter((k) => String(k).startsWith('media:') && !keepIds.has(String(k).slice(6)));
      if (stale.length) await tx('readwrite', (s) => stale.forEach((k) => s.delete(k)));
    } catch (e) {
      /* best effort */
    }
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage blocked or full — keep going */
    }
  }

  root.Store = {
    saveQuiz,
    loadQuiz,
    saveMedia,
    loadMedia,
    pruneMedia,
    loadSession: () => readJson(SESSION_KEY),
    saveSession: (s) => writeJson(SESSION_KEY, s),
    clearSession: () => writeJson(SESSION_KEY, null),
    loadPrefs: () => readJson(PREFS_KEY) || {},
    savePrefs: (p) => writeJson(PREFS_KEY, p),
  };
})(window);
