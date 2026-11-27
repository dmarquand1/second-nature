// Browser storage for the website version (IndexedDB).
//
// Small tables (decks, cards, taxa, observations, questions, reviews, jobs) are
// loaded into memory when the page opens and every change is written straight
// back to IndexedDB. The iNaturalist response cache can be big, so it's read
// from IndexedDB only when needed.
//
// Everything stays in this browser on this computer. Use Backup on the Settings
// page to back it up or move it to another computer.
window.IQ = window.IQ || {};

IQ.store = (() => {
  const DB_NAME = "inat-quiz";
  const DB_VERSION = 1;
  const TABLES = ["taxa", "decks", "cards", "observations", "questions", "reviews", "jobs"];
  const AUTO = new Set(["decks", "cards", "questions", "reviews", "jobs"]);   // ids we make up ourselves
  let db = null;
  const mem = {};      // table -> Map(id -> record)
  const nextId = {};

  function req(r) {
    return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  }

  async function open() {
    if (db) return;
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(IQ.config.DB_NAME || DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const t of TABLES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: "id" });
        if (!d.objectStoreNames.contains("cache")) d.createObjectStore("cache", { keyPath: "key" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    for (const t of TABLES) {
      const rows = await req(db.transaction(t).objectStore(t).getAll());
      mem[t] = new Map(rows.map((r) => [r.id, r]));
      nextId[t] = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    }
  }

  function write(table, rec) {
    const tx = db.transaction(table, "readwrite");
    tx.objectStore(table).put(rec);
    return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }

  // ---- tables -------------------------------------------------------------
  const all = (t) => [...mem[t].values()];
  const get = (t, id) => mem[t].get(id) || null;
  const where = (t, fn) => all(t).filter(fn);

  async function insert(t, rec) {
    const r = { ...rec };
    if (AUTO.has(t) && r.id == null) r.id = nextId[t]++;
    mem[t].set(r.id, r);
    await write(t, r);
    return r;
  }

  async function put(t, rec) {          // insert or replace by id
    mem[t].set(rec.id, rec);
    if (AUTO.has(t)) nextId[t] = Math.max(nextId[t], rec.id + 1);
    await write(t, rec);
    return rec;
  }

  async function putMany(t, recs) {     // many at once, in one storage transaction
    if (!recs.length) return;
    const tx = db.transaction(t, "readwrite");
    for (const rec of recs) {
      mem[t].set(rec.id, rec);
      if (AUTO.has(t)) nextId[t] = Math.max(nextId[t], rec.id + 1);
      tx.objectStore(t).put(rec);
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }

  async function update(t, id, fields) {
    const r = mem[t].get(id);
    if (!r) return null;
    Object.assign(r, fields);
    await write(t, r);
    return r;
  }

  async function remove(t, ids) {
    ids = [].concat(ids);
    const tx = db.transaction(t, "readwrite");
    for (const id of ids) { mem[t].delete(id); tx.objectStore(t).delete(id); }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }

  // ---- iNat response cache ------------------------------------------------
  async function cacheGet(key) {
    return (await req(db.transaction("cache").objectStore("cache").get(key))) || null;
  }
  async function cachePut(key, response, fetchedAt = Date.now() / 1000) {
    const tx = db.transaction("cache", "readwrite");
    tx.objectStore("cache").put({ key, response, fetched_at: fetchedAt });
    await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  }

  // Delete cached iNat answers older than `days` (they'd be re-fetched anyway).
  async function trimCache(days) {
    const cutoff = Date.now() / 1000 - days * 86400;
    const tx = db.transaction("cache", "readwrite");
    const st = tx.objectStore("cache");
    st.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      if (cur.value.fetched_at < cutoff) cur.delete();
      cur.continue();
    };
    await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  }

  // How much this browser is storing, in MB (where the browser can tell us).
  async function usageMb() {
    try { const e = await navigator.storage.estimate(); return Math.round((e.usage || 0) / 1e5) / 10; }
    catch { return null; }
  }

  // ---- backup ---------------------------------------------------------------
  // Your decks, species and answers. Photos lists and prepared questions are left
  // out (they're fetched again when needed), which keeps the file small.
  const BACKUP_TABLES = ["taxa", "decks", "cards", "reviews"];
  function exportData() {
    const out = { app: "inat-quiz", version: 1, exported_at: new Date().toISOString(), tables: {} };
    for (const t of BACKUP_TABLES) out.tables[t] = all(t);
    return out;
  }

  async function importData(data) {
    if (!data || data.app !== "inat-quiz" || !data.tables) throw new Error("That file isn't an Second Nature backup.");
    await wipe(false);
    for (const t of BACKUP_TABLES) {
      const rows = (data.tables[t] || []).map((r) => (t === "reviews" ? { ...r, question_id: null } : r));
      const tx = db.transaction(t, "readwrite");
      for (const r of rows) {
        mem[t].set(r.id, r);
        if (AUTO.has(t)) nextId[t] = Math.max(nextId[t], r.id + 1);
        tx.objectStore(t).put(r);
      }
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    }
  }

  // Delete everything (withCache=false keeps the iNaturalist answers, which aren't personal).
  async function wipe(withCache = true) {
    for (const t of withCache ? [...TABLES, "cache"] : TABLES) {
      const tx = db.transaction(t, "readwrite");
      tx.objectStore(t).clear();
      await new Promise((resolve) => { tx.oncomplete = resolve; });
      if (mem[t]) { mem[t].clear(); nextId[t] = 1; }
    }
  }

  return { open, all, get, where, insert, put, putMany, update, remove, cacheGet, cachePut, trimCache, usageMb, exportData, importData, wipe };
})();
