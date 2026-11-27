// Browser storage for the website version (IndexedDB).
//
// Small tables (decks, cards, taxa, observations, questions, reviews, jobs) are
// loaded into memory when the page opens and every change is written straight
// back to IndexedDB. The iNaturalist response cache is read from IndexedDB only
// when needed, and is kept small: only the fields the app uses are saved, old
// answers are dropped, and compact() tidies away anything that isn't progress.
//
// Everything stays in this browser on this computer. Use Backup on the Settings
// page to back it up or move it to another computer.
window.IQ = window.IQ || {};

IQ.store = (() => {
  const DB_NAME = "inat-quiz";
  const DB_VERSION = 3;       // 2 (0.4.3): cache rebuilt with a "fetched_at" index; 3 (0.4.6): cleared to pick up species counts
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
      r.onupgradeneeded = (e) => {
        const d = r.result;
        for (const t of TABLES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: "id" });
        // Before 0.4.3 the cache kept iNaturalist's full (large) answers: start it afresh.
        // 0.4.6 also saves how often each species is observed, so start the cache afresh again.
        if (e.oldVersion < 3 && d.objectStoreNames.contains("cache")) d.deleteObjectStore("cache");
        if (!d.objectStoreNames.contains("cache")) {
          d.createObjectStore("cache", { keyPath: "key" }).createIndex("fetched_at", "fetched_at");
        }
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

  // Delete cached iNat answers older than `days`, and the oldest ones beyond
  // `maxEntries` (they'd be fetched again if ever needed).
  async function trimCache(days, maxEntries = Infinity) {
    const cutoff = Date.now() / 1000 - days * 86400;
    const tx = db.transaction("cache", "readwrite");
    const idx = tx.objectStore("cache").index("fetched_at");
    const total = await req(idx.count());
    let extra = total - maxEntries;
    idx.openCursor().onsuccess = (e) => {                 // oldest first
      const cur = e.target.result;
      if (!cur) return;
      if (cur.value.fetched_at < cutoff || extra > 0) { cur.delete(); extra--; cur.continue(); }
    };
    await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  }
  const cacheCount = async () => req(db.transaction("cache").objectStore("cache").count());

  async function clear(t) {
    const tx = db.transaction(t, "readwrite");
    tx.objectStore(t).clear();
    await new Promise((resolve) => { tx.oncomplete = resolve; });
  }

  // ---- keep the saved data small ----------------------------------------------
  // Tidies away what isn't progress. Runs when the page opens. Keeps every deck,
  // species card and answer (and so every bit of progress and every statistic).
  //   * prepared questions older than a couple of days (except each deck's latest);
  //   * finished background jobs (except the latest of each kind per deck);
  //   * the extra detail on old answers: only each species' latest answer needs
  //     the full before-state (to change its rating), older ones just its state;
  //   * photo lists for species that are no longer in any deck.
  async function compact(questionDays = 2) {
    const now = Date.now() / 1000;
    const newest = (rows, keyFn) => {
      const m = new Map();
      for (const r of rows) { const k = keyFn(r); if (!m.has(k) || r.id > m.get(k)) m.set(k, r.id); }
      return new Set(m.values());
    };
    const keepQ = newest(all("questions"), (q) => q.deck_id);
    const oldQ = where("questions", (q) => !keepQ.has(q.id) && q.created_at < now - questionDays * 86400).map((q) => q.id);
    if (oldQ.length) await remove("questions", oldQ);

    const keepJ = newest(all("jobs"), (j) => `${j.deck_id}:${j.kind}`);
    const oldJ = where("jobs", (j) => !keepJ.has(j.id) && !["queued", "running"].includes(j.status)).map((j) => j.id);
    if (oldJ.length) await remove("jobs", oldJ);

    const latest = newest(all("reviews"), (r) => r.card_id);
    const slimmed = [];
    for (const r of all("reviews")) {
      const extra = r.choices !== undefined || r.card_after !== undefined;
      const fat = !latest.has(r.id) && r.card_before && Object.keys(r.card_before).length > 1;
      if (!extra && !fat) continue;
      const { choices, card_after, ...rest } = r;
      if (fat) rest.card_before = { state: r.card_before.state };
      slimmed.push(rest);
    }
    await putMany("reviews", slimmed);

    const inDeck = new Set(all("cards").map((c) => c.taxon_id));
    const orphans = where("observations", (o) => !inDeck.has(o.taxon_id)).map((o) => o.id);
    if (orphans.length) await remove("observations", orphans);
    return { questions: oldQ.length, jobs: oldJ.length, reviews: slimmed.length, observations: orphans.length };
  }

  // "Free up space": drop everything that can be fetched again from iNaturalist
  // (saved answers and photo lists). Decks, species and answers stay.
  async function freeUpSpace() {
    await clear("cache");
    await clear("observations"); mem.observations.clear();
    await compact(0);
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
      await clear(t);
      if (mem[t]) { mem[t].clear(); nextId[t] = 1; }
    }
  }

  return { open, all, get, where, insert, put, putMany, update, remove, cacheGet, cachePut, trimCache, cacheCount, compact,
           freeUpSpace, usageMb, exportData, importData, wipe };
})();
