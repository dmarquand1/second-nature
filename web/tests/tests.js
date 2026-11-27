// Tests for the website version. Open /play/tests.html in a browser to run them
// (see docs/11-testing.md); tests/test_web.py runs the same page automatically.
const T = (() => {
  const list = [];
  const test = (name, fn) => list.push({ name, fn });
  // Live checks talk to the real iNaturalist (open tests.html?live to run them).
  test.live = (name, fn) => list.push({ name, fn, live: true });
  function eq(a, b, msg = "") {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) throw new Error(`${msg} expected ${jb}, got ${ja}`);
  }
  function ok(v, msg = "expected true") { if (!v) throw new Error(msg); }
  function near(a, b, tol = 1e-4, msg = "") { if (Math.abs(a - b) > tol) throw new Error(`${msg} expected ${b}, got ${a}`); }
  async function throws(p, re) {
    try { await p; } catch (e) { if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`); return e; }
    throw new Error("expected an error");
  }
  function seeded(seed) {   // mulberry32
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  async function run(filter, live = false) {
    const out = document.getElementById("results");
    const res = { done: false, passed: 0, failed: 0, failures: [] };
    window.testResults = res;
    await IQ.ready;
    for (const t of list.filter((t) => !!t.live === live && (!filter || t.name.includes(filter)))) {
      await IQ.jobs.waitIdle();
      await IQ.store.wipe();
      if (!live) { FakeInat.reset(); IQ.inat.setMinInterval(0); }
      IQ.util.random = seeded(42);
      IQ.settings.set("openLicenceOnly", true);
      IQ.settings.set("requests", null);
      const li = document.createElement("li");
      try {
        await t.fn();
        await IQ.jobs.waitIdle();
        res.passed++; li.className = "pass"; li.textContent = "✓ " + t.name;
      } catch (e) {
        res.failed++; res.failures.push(`${t.name}: ${e.message}`); li.className = "fail";
        li.textContent = `✗ ${t.name}: ${e.message}`; console.error(t.name, e);
      }
      out.appendChild(li);
    }
    res.done = true;
    document.getElementById("summary").textContent =
      `${res.passed} passed, ${res.failed} failed` + (res.failed ? "" : " 🎉");
    document.getElementById("summary").className = res.failed ? "fail" : "pass";
    return res;
  }
  return { test, eq, ok, near, throws, run };
})();
const { test, eq, ok, near, throws } = T;
const api2 = (m, u, b) => IQ.router.handle(m, u, b);

async function listDeck(names = ["Turdus merula", "Song Thrush", "Redwing"], extra = {}) {
  const d = await api2("POST", "/api/decks", { name: "T", source_type: "list", species: names, ...extra });
  await IQ.jobs.waitIdle();
  return api2("GET", `/api/decks/${d.id}`);
}

// ---- FSRS (same numbers as the Python version) ------------------------------
test("FSRS matches the Python version", () => {
  // Made with app/fsrs.py: [rating, seconds since previous, state, stability, difficulty, due, scheduled_days, lapses]
  const expected = [[3, 0, 2, 3.173, 5.282434, 1700259200, 3, 0], [3, 259200, 2, 10.738926, 5.272968, 1701209600, 11, 0],
    [1, 864000, 3, 2.146381, 6.790568, 1701123800, 0, 1], [3, 600, 2, 3.021613, 6.774164, 1701383000, 3, 1],
    [4, 172800, 2, 14.566187, 6.236798, 1702592600, 15, 1], [2, 2592000, 2, 25.516724, 6.830774, 1706135000, 26, 1]];
  let c = IQ.fsrs.newCard(), t = 1700000000;
  for (const [r, dt, state, s, d, due, sched, lapses] of expected) {
    t += dt; c = IQ.scheduler.fsrs.review(c, r, t);
    eq(c.state, state, "state"); near(c.stability, s, 1e-5, "stability"); near(c.difficulty, d, 1e-5, "difficulty");
    near(c.due, due, 1e-3, "due"); eq(c.scheduled_days, sched, "interval"); eq(c.lapses, lapses, "lapses");
  }
});

test("new card: Again and Hard are learning steps (1 and 5 min)", () => {
  const f = IQ.scheduler.fsrs;
  eq(f.review(IQ.fsrs.newCard(), 1, 1000).due, 1060);
  eq(f.review(IQ.fsrs.newCard(), 2, 1000).due, 1300);
  eq(f.review(IQ.fsrs.newCard(), 1, 1000).state, IQ.fsrs.LEARNING);
});

test("suggested ratings and interval labels", () => {
  const S = IQ.scheduler;
  eq([S.ratingFromAnswer(false, 1000), S.ratingFromAnswer(true, 2000), S.ratingFromAnswer(true, 8000), S.ratingFromAnswer(true, 20000)], [1, 4, 3, 2]);
  eq([30, 90, 150, 5400, 86400 * 2.5, 86400 * 45, 86400 * 400].map(IQ.quiz.fmtSeconds),
     ["1 min", "2 min", "2 min", "2 h", "2 days", "1.5 months", "1.1 years"]);
});

// ---- decks ------------------------------------------------------------------
test("clean pasted names: CSV, header, comments, repeats", () => {
  eq(IQ.decks.cleanNames("﻿name,count\nTurdus merula,3\n# note\n\n\"Song Thrush\";x\nturdus merula\n12345"),
     ["Turdus merula", "Song Thrush", "12345"]);
});

test("list deck: names, common names and ids, with a report", async () => {
  const d = await listDeck(["Turdus merula", "Song Thrush", "6", "Nonexistent bird", "Fieldf"]);
  eq(d.num_cards, 4);
  const r = d.jobs.find((j) => j.kind === "build").result;
  eq(r.added, 4); eq(r.not_found, ["Nonexistent bird"]);
  eq(r.guessed.map((g) => g.input), ["Fieldf"]);
});

test("taxon deck: most-observed species in a genus", async () => {
  const d = await api2("POST", "/api/decks", { name: "Thrushes", source_type: "taxon", taxon_id: FakeInat.GENUS, limit: 30 });
  await IQ.jobs.waitIdle();
  eq((await api2("GET", `/api/decks/${d.id}`)).num_cards, 5);
});

test("deck errors are readable", async () => {
  await throws(api2("POST", "/api/decks", { name: "x", source_type: "list", species: "" }), /at least one species/);
  await throws(api2("GET", "/api/decks/999"), /Deck not found/);
});

test("edit deck: add from search, remove, change settings", async () => {
  const d = await listDeck();
  const r = await api2("POST", `/api/decks/${d.id}/taxa`, { taxon_ids: [6, FakeInat.GENUS] });
  eq(r.added, 1); eq(r.not_species, ["Turdus (genus)"]);
  eq((await api2("POST", `/api/decks/${d.id}/remove`, { taxon_ids: [1] })).removed, 1);
  const e = await api2("PATCH", `/api/decks/${d.id}`, { name: "Renamed", num_choices: 9, new_per_day: 5, place_id: 6857, place_name: "UK" });
  eq([e.name, e.num_choices, e.new_per_day, e.place_id, e.num_cards], ["Renamed", 6, 5, 6857, 3]);
  const add = await api2("POST", `/api/decks/${d.id}/species`, { species: "Fieldfare\nMistle Thrush" });
  await IQ.jobs.waitIdle();
  eq((await api2("GET", `/api/decks/${d.id}`)).num_cards, 5, "after adding names");
  ok(add.job_id);
});

test("deleting a deck deletes its cards and answers", async () => {
  const d = await listDeck();
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: q.choices[0].id });
  await api2("DELETE", `/api/decks/${d.id}`);
  eq([IQ.store.all("decks").length, IQ.store.all("cards").length, IQ.store.all("reviews").length], [0, 0, 0]);
});

// ---- quiz -------------------------------------------------------------------
test("question: 5 choices incl. the answer, photos straight from iNaturalist", async () => {
  const d = await listDeck();
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  eq(q.choices.length, 5);
  const card = IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id);
  ok(q.choices.some((c) => c.id === card.taxon_id), "answer among the choices");
  ok(q.photos[0].url.startsWith("https://inaturalist-open-data.s3.amazonaws.com/") && q.photos[0].url.endsWith("/medium.jpg"), q.photos[0].url);
  ok(q.photos[0].large.endsWith("/large.jpg") && q.photos[0].original.endsWith("/original.jpg"));
  ok(!JSON.stringify(q).includes("/api/img"), "no local photo cache in the website version");
  eq(q.location.lat, 51.75); eq(q.is_new, true);
});

test("look-alikes: a thrush gets other thrushes", async () => {
  const d = await listDeck(["Turdus merula"]);
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  const thrushes = q.choices.filter((c) => c.name.startsWith("Turdus")).length;
  ok(thrushes >= 4, `only ${thrushes} thrushes`);
});

test("answer, change the rating, and the rules for ratings", async () => {
  const d = await listDeck();
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  const card = IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id);
  const r = await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: card.taxon_id, response_ms: 6000 });
  eq([r.correct, r.rating], [true, 3]);
  eq(Object.keys(r.intervals), ["1", "2", "3", "4"]);
  ok(r.observation.photos[0].license_name === "CC BY" && r.observation.photos[0].license_url.includes("/by/4.0/"));
  const again = await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: 999 });
  eq(again.correct, true, "answering twice doesn't count twice");
  eq(IQ.store.all("reviews").length, 1);
  const rr = await api2("POST", `/api/questions/${q.question_id}/rate`, { rating: 2 });
  eq(rr.rating, 2);
  eq(IQ.store.get("cards", card.id).state, IQ.fsrs.LEARNING, "Hard on a new card = 5 min step");

  const q2 = await api2("GET", `/api/decks/${d.id}/next`);
  const wrong = q2.choices.find((c) => c.id !== IQ.store.get("cards", IQ.store.get("questions", q2.question_id).card_id).taxon_id);
  const r2 = await api2("POST", `/api/questions/${q2.question_id}/answer`, { taxon_id: wrong.id });
  eq([r2.correct, r2.rating], [false, 1]);
  await throws(api2("POST", `/api/questions/${q2.question_id}/rate`, { rating: 3 }), /always rated Again/);
});

test("daily new-species limit, then done; practice keeps going", async () => {
  const d = await listDeck(undefined, { new_per_day: 2 });
  for (let i = 0; i < 2; i++) {
    const q = await api2("GET", `/api/decks/${d.id}/next`);
    const card = IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id);
    await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: card.taxon_id, response_ms: 1000 });   // Easy
  }
  const done = await api2("GET", `/api/decks/${d.id}/next`);
  eq(done.done, true); eq(done.counts.new_today, 2);
  const p = await api2("GET", `/api/decks/${d.id}/next?practice=true`);
  ok(p.question_id, "practice question");
});

test("questions prepared ahead are different species", async () => {
  const d = await listDeck();
  const a = await api2("GET", `/api/decks/${d.id}/next`), b = await api2("GET", `/api/decks/${d.id}/next`);
  const card = (q) => IQ.store.get("questions", q.question_id).card_id;
  ok(card(a) !== card(b));
});

// ---- iNaturalist client ----------------------------------------------------
test("warm-up uses batched requests", async () => {
  await listDeck(["1", "2", "3", "4", "5"]);
  const batch = FakeInat.calls("/observations").filter((c) => c.params.taxon_id.includes(","));
  ok(batch.length === 1, "one photo request for 5 species");
  eq(FakeInat.calls(/^\/taxa\/\d+$/).length, 0, "no one-by-one taxon lookups");
  // Fieldfare (5) came back with only 2 photos in the batch, so it was fetched on its own.
  ok(FakeInat.calls("/observations").some((c) => c.params.taxon_id === "5"));
  ok(IQ.store.where("observations", (o) => o.taxon_id === 1).length === 6, "subspecies records matched to the species");
});

test("cache: one request for repeats and for two at once; old copy when offline", async () => {
  const p1 = IQ.inat.taxaByIds([1]), p2 = IQ.inat.taxaByIds([1]);
  await Promise.all([p1, p2]);
  await IQ.inat.taxaByIds([1]);
  eq(FakeInat.calls("/taxa/1").length, 1);
  ok(await IQ.inat.cached("/taxa/1"));
  // Make the cached copy old, then go offline: the old copy is used.
  const key = IQ.inat.cacheKey("/taxa/1", {});
  const row = await IQ.store.cacheGet(key);
  await IQ.store.cachePut(key, row.response, 0);
  FakeInat.state.fail = true;
  eq((await IQ.inat.taxaByIds([1]))[0].id, 1);
  await throws(IQ.inat.taxaByIds([2]), /Could not reach iNaturalist/);
});

test("rate limit: the quiz goes ahead of background work", async () => {
  IQ.inat.setMinInterval(0.03);
  const order = [];
  const bg = [3, 4, 5].map((i) => IQ.inat.get(`/taxa/${i}`, {}, "taxa", { bg: true }).then(() => order.push("bg" + i)));
  const fg = IQ.inat.get("/taxa/6", {}, "taxa").then(() => order.push("fg"));
  await Promise.all([...bg, fg]);
  ok(order.indexOf("fg") <= 1, `order was ${order}`);
});

test("photo licences: only open-licence photos, credited with the photo", async () => {
  const d = await listDeck(["Luscinia megarhynchos"]);
  ok(FakeInat.calls("/observations").every((c) => c.params.photo_license && c.params.photo_license.includes("cc-by")));
  const q = await api2("GET", `/api/decks/${d.id}/next?practice=true`);
  eq(q.photos.length, 1, "the all-rights-reserved photo is left out");
  eq([q.photos[0].attribution, q.photos[0].license_name], ["(c) tester, CC BY", "CC BY"], "credit with the photo");
  ok(!JSON.stringify(q.photos).includes("observations/"), "credit doesn't link to the observation (gives the answer away)");
  IQ.settings.set("openLicenceOnly", false);                  // the website ignores this...
  eq((await api2("GET", `/api/decks/${d.id}/next?practice=true`)).photos.length, 1, "can't be switched off");
  IQ.config.ALLOW_ALL_LICENCES = true;                        // ...unless a test forces it, proving the filter works
  try { eq((await api2("GET", `/api/decks/${d.id}/next?practice=true`)).photos.length, 2); }
  finally { IQ.config.ALLOW_ALL_LICENCES = false; }
});

test("daily request limit: background stops first, studying keeps a reserve", async () => {
  const lim = [IQ.config.DAILY_REQUEST_LIMIT, IQ.config.DAILY_BACKGROUND_LIMIT];
  IQ.config.DAILY_REQUEST_LIMIT = 5; IQ.config.DAILY_BACKGROUND_LIMIT = 3;
  try {
    IQ.settings.set("requests", null);
    for (const i of [1, 2, 3]) await IQ.inat.get(`/taxa/${i}`, {}, "taxa", { bg: true });
    await throws(IQ.inat.get("/taxa/4", {}, "taxa", { bg: true }), /daily limit/);
    await IQ.inat.get("/taxa/4", {}, "taxa");                  // studying still allowed
    await IQ.inat.get("/taxa/5", {}, "taxa");
    await throws(IQ.inat.get("/taxa/6", {}, "taxa"), /today's limit/);
    await IQ.inat.get("/taxa/1", {}, "taxa");                  // cached answers still work
    eq(IQ.inat.requestsToday(), 5);
  } finally { [IQ.config.DAILY_REQUEST_LIMIT, IQ.config.DAILY_BACKGROUND_LIMIT] = lim; IQ.settings.set("requests", null); }
});

test("dead organisms: hidden by default, can be shown", async () => {
  const d = await listDeck(["Turdus merula"]);
  eq(d.hide_dead, true);
  const dead = new Set(IQ.store.where("observations", (o) => o.dead === 1).map((o) => o.id));
  ok(dead.size > 0, "dead annotation read");
  const shown = async (n) => {
    const ids = new Set();
    for (let i = 0; i < n; i++) {
      const q = await api2("GET", `/api/decks/${d.id}/next?practice=true`);
      ids.add(IQ.store.get("questions", q.question_id).observation_id);
    }
    return ids;
  };
  ok(![...(await shown(12))].some((id) => dead.has(id)), "a dead one was shown");
  // Photos saved by version 0.4.0 have no dead flag: they're checked again once.
  await IQ.store.putMany("observations", IQ.store.where("observations", () => true).map((o) => { const c = { ...o }; delete c.dead; return c; }));
  ok(![...(await shown(6))].some((id) => dead.has(id)), "old photos were checked");
  eq(IQ.store.where("observations", (o) => o.dead == null).length, 0);
  eq((await api2("PATCH", `/api/decks/${d.id}`, { hide_dead: false })).hide_dead, false);
  ok([...(await shown(12))].some((id) => dead.has(id)), "dead ones should come round when allowed");
});

test("photo choice: best first, mixed by default, asks iNat for favourites", async () => {
  const d = await listDeck(["Turdus merula"]);
  eq(d.photo_choice, "mixed");
  ok(FakeInat.calls("/observations").every((c) => c.params.order_by === "votes"), "asked for most-favourited first");
  eq(IQ.store.get("observations", 1005).faves, 12);
  await api2("PATCH", `/api/decks/${d.id}`, { photo_choice: "best" });
  const first = await api2("GET", `/api/decks/${d.id}/next?practice=true`);
  eq(IQ.store.get("questions", first.question_id).observation_id, 1005);
  const row = (id, faves) => ({ id, times_shown: 0, faves });
  for (let i = 1; i < 100; i++) {
    const [a, b] = [IQ.quiz.obsKey(row(i, 10), "mixed"), IQ.quiz.obsKey(row(i, 0), "mixed")];
    ok(a[1] < b[1], "favourites tilt mixed");
  }
});

test("wrong answers from: anywhere by default, only this deck, mostly this deck", async () => {
  const ids = async (d) => new Set((await api2("GET", `/api/decks/${d.id}/next?practice=true`)).choices.map((c) => c.id));
  const d = await listDeck();                                         // species 1, 2, 4
  eq(d.answer_source, "anywhere");
  const only = await api2("PATCH", `/api/decks/${d.id}`, { answer_source: "deck" });
  eq(only.answer_source, "deck");
  for (let i = 0; i < 4; i++) eq([...(await ids(d))].sort(), [1, 2, 4], "only deck species");
  await api2("PATCH", `/api/decks/${d.id}`, { answer_source: "mostly_deck" });
  for (let i = 0; i < 4; i++) {
    const s = await ids(d);
    ok(s.size === 5 && [1, 2, 4].every((x) => s.has(x)), "deck species first, then topped up");
  }
  const big = await listDeck(["Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin"],
                             { answer_source: "mostly_deck" });
  for (let i = 0; i < 4; i++) ok([...(await ids(big))].every((x) => x <= 6), "a big enough deck stays inside");
  const one = await listDeck(["Turdus merula"], { answer_source: "deck" });
  eq((await ids(one)).size, 5, "a one-species deck still gets choices");
  const c = await IQ.distractors.deckCandidates(1, big.id);
  ok(c.get(2).score > c.get(6).score, "close relatives score higher");
});

test("new species order: added, common, rare, relatives, grouped, variety", async () => {
  const all = ["Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin", "Common Nightingale"];
  const d = await listDeck(all);
  eq(d.new_order, "random");
  const order = (o) => IQ.scheduler.orderNew(d.id, IQ.store.where("cards", (c) => c.deck_id === d.id && c.state === 0), o)
    .map((c) => c.taxon_id);
  eq(order("added"), [1, 2, 3, 4, 5, 6, 7]);
  eq(order("common"), [1, 2, 3, 4, 5, 6, 7]);
  eq(order("rare"), [7, 6, 5, 4, 3, 2, 1]);
  eq([...order("random")].sort(), [1, 2, 3, 4, 5, 6, 7]);
  const start = async (tid, difficulty) => {
    const c = IQ.store.where("cards", (c) => c.deck_id === d.id && c.taxon_id === tid)[0];
    await IQ.store.update("cards", c.id, { state: 2, difficulty, due: 9e12 });
  };
  await start(6, 9.5);                  // Robin: hard
  await start(1, 1.5);                  // Blackbird: easy
  eq(order("hard")[0], 7, "the hard Robin's relative first");
  ok([2, 3, 4, 5].includes(order("easy")[0]), "the easy Blackbird's relatives first");
  eq(order("grouped")[0], 7, "finish the genus you've started");
  const p = await api2("PATCH", `/api/decks/${d.id}`, { new_order: "rare" });
  eq(p.new_order, "rare");
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  eq(IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id).taxon_id, 7, "the quiz follows the order");
  // Species saved before 0.4.6 have no count: setting common/rare looks them up.
  for (const t of IQ.store.all("taxa")) await IQ.store.update("taxa", t.id, { obs_count: null });
  await api2("PATCH", `/api/decks/${d.id}`, { new_order: "common" });
  await IQ.jobs.waitIdle();
  eq(IQ.store.get("taxa", 7).obs_count, 1000);
  const v = await listDeck(all);
  for (const tid of [1, 2]) {
    const c = IQ.store.where("cards", (c) => c.deck_id === v.id && c.taxon_id === tid)[0];
    await IQ.store.update("cards", c.id, { state: 2, difficulty: 5, due: 9e12 });
  }
  const vo = IQ.scheduler.orderNew(v.id, IQ.store.where("cards", (c) => c.deck_id === v.id && c.state === 0), "varied");
  eq(vo.slice(0, 2).map((c) => c.taxon_id).sort(), [6, 7], "variety: something different first");
});

test("a new deck is built straight away, even while another deck is warming up", async () => {
  IQ.inat.setMinInterval(0.02);                        // make requests take a little time
  const all = ["Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin", "Common Nightingale"];
  const a = await api2("POST", "/api/decks", { name: "A", source_type: "list", species: all });
  for (let i = 0; i < 500 && !IQ.store.where("jobs", (j) => j.kind === "warmup" && j.status === "running").length; i++) {
    await IQ.util.sleep(10);
  }
  const b = await api2("POST", "/api/decks", { name: "B", source_type: "list", species: ["Redwing"] });
  await IQ.jobs.waitIdle();
  const js = IQ.store.all("jobs").sort((x, y) => x.id - y.id);
  const buildB = js.find((j) => j.kind === "build" && j.deck_id === b.id);
  const warmA = js.filter((j) => j.kind === "warmup" && j.deck_id === a.id);
  ok(warmA[0].result.paused, "A's warm-up paused for B");
  ok(buildB.finished_at <= warmA[warmA.length - 1].finished_at, "B built before A's warm-up finished");
  ok(warmA[warmA.length - 1].status === "done" && !warmA[warmA.length - 1].result.paused, "A's warm-up carried on");
  eq((await api2("GET", `/api/decks/${b.id}`)).num_cards, 1);
});

test("species with no research-grade photos are taken out of the deck", async () => {
  FakeInat.state.noPhotos = new Set([7]);                     // the Nightingale (rarest) has none
  const all = ["Turdus merula", "Song Thrush", "Mistle Thrush", "Redwing", "Fieldfare", "European Robin", "Common Nightingale"];
  const d = await listDeck(all, { new_order: "rare" });
  const after = await api2("GET", `/api/decks/${d.id}`);
  eq(after.num_cards, 6, "taken out by the warm-up");
  eq(after.no_photos.map((t) => t.name), ["Luscinia megarhynchos"]);
  // Found while studying: skipped, taken out, and the next species is shown instead.
  const e = await listDeck(["Turdus merula", "Common Nightingale"], { new_order: "rare" });
  const q = await api2("GET", `/api/decks/${e.id}/next`);
  eq(IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id).taxon_id, 1);
  eq((await api2("GET", `/api/decks/${e.id}`)).num_cards, 1);
  // Network trouble never takes species out.
  FakeInat.state.noPhotos = new Set();
  const f = await listDeck(["Turdus merula", "Song Thrush"]);
  await IQ.store.remove("observations", IQ.store.all("observations").map((o) => o.id));
  await IQ.store.trimCache(0, 0);
  FakeInat.state.fail = true;
  await throws(api2("GET", `/api/decks/${f.id}/next`));
  FakeInat.state.fail = false;
  eq((await api2("GET", `/api/decks/${f.id}`)).num_cards, 2, "nothing taken out when offline");
});

// ---- stats and backup -------------------------------------------------------
test("stats: totals, mix-ups, forecast", async () => {
  const d = await listDeck();
  for (let i = 0; i < 3; i++) {
    const q = await api2("GET", `/api/decks/${d.id}/next?practice=true`);
    const right = IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id).taxon_id;
    const pick = i === 0 ? q.choices.find((c) => c.id !== right).id : right;
    await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: pick, response_ms: 5000 });
  }
  const s = await api2("GET", "/api/stats");
  eq([s.totals.reviews, s.totals.correct, s.totals.streak, s.totals.today_reviews], [3, 2, 1, 3]);
  eq(s.confusions.length, 1); eq(s.daily.length, 30); eq(s.forecast.length, 14);
  eq(s.per_deck[0].reviews, 3);
  eq(s.states.new + s.states.learning + s.states.young + s.states.mature, 3);
});

test("backup and restore", async () => {
  const d = await listDeck();
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: q.choices[0].id });
  const backup = JSON.parse(JSON.stringify(IQ.store.exportData()));
  ok(!backup.tables.observations && !backup.tables.jobs, "photo lists and jobs aren't in the backup");
  await IQ.store.wipe();
  eq(IQ.store.all("decks").length, 0);
  await IQ.store.importData(backup);
  eq([IQ.store.all("decks").length, IQ.store.all("cards").length, IQ.store.all("reviews").length], [1, 3, 1]);
  eq(IQ.store.all("reviews")[0].question_id, null);
  const q2 = await api2("GET", `/api/decks/${d.id}/next`);        // studying carries on after restoring
  ok(q2.question_id && !q2.done);
  await throws(IQ.store.importData({ hello: 1 }), /isn't an Second Nature backup/);
});

test("lightweight: saved iNaturalist answers keep only what the app uses", async () => {
  const d = await listDeck();
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  const call = FakeInat.calls("/observations")[0];
  const row = await IQ.store.cacheGet(IQ.inat.cacheKey("/observations", call.params));
  ok(row, "observations answer is cached");
  const o = row.response.results[0];
  ok(!o.identifications && !o.uri, "bulky fields dropped");
  ok(o.photos.length <= IQ.config.PHOTOS_KEPT_PER_OBSERVATION && o.photos[0].url && o.photos[0].license_code, "photos kept");
  ok(o.annotations && o.faves_count !== undefined && o.user.login === "tester", "fields the app needs kept");
  const stored = IQ.store.all("observations")[0];
  ok(!("uri" in stored) && !("obs_taxon_id" in stored) && !("fetched_at" in stored), "stored photo lists are slim");
  const card = IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id);
  const r = await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: card.taxon_id });
  ok(r.observation.uri.endsWith(`/observations/${r.observation.id}`), "link to the observation still works");
  const rev = IQ.store.all("reviews")[0];
  ok(!("choices" in rev) && !("card_after" in rev), "answers don't keep extra copies");
  // Search-as-you-type isn't saved at all.
  await IQ.inat.autocompleteTaxa("Turdus");
  ok(!(await IQ.inat.cached("/taxa/autocomplete", { q: "Turdus", per_page: 10, is_active: "true" })), "autocomplete not cached");
});

test("lightweight: old saved answers are trimmed, newest kept", async () => {
  const now = Date.now() / 1000;
  for (let i = 0; i < 5; i++) await IQ.store.cachePut(`k${i}`, { i }, now - (4 - i) * 60);
  await IQ.store.cachePut("ancient", { old: true }, now - 30 * 86400);
  await IQ.store.trimCache(14, 3);
  eq(await IQ.store.cacheCount(), 3);
  ok(!(await IQ.store.cacheGet("ancient")) && !(await IQ.store.cacheGet("k0")), "oldest deleted");
  ok(await IQ.store.cacheGet("k4"), "newest kept");
});

test("lightweight: tidying up keeps every bit of progress", async () => {
  const d = await listDeck();
  for (let i = 0; i < 6; i++) {
    const q = await api2("GET", `/api/decks/${d.id}/next?practice=true`);
    await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: q.choices[i % 2].id });
  }
  // An answer saved by an older version, with the extra copies it used to keep.
  const first = IQ.store.all("reviews")[0];
  await IQ.store.put("reviews", { ...first, choices: [1, 2, 3], card_after: { ...first.card_before } });
  for (const q of IQ.store.all("questions")) await IQ.store.update("questions", q.id, { created_at: 0 });
  const before = [IQ.store.all("decks").length, IQ.store.all("cards").length, IQ.store.all("reviews").length];
  const stats = JSON.stringify(await api2("GET", "/api/stats"));
  const cards = JSON.stringify(IQ.store.all("cards"));
  const done = await IQ.store.compact(2);
  ok(done.questions === 5 && IQ.store.all("questions").length === 1, "old questions tidied (latest kept)");
  eq([IQ.store.all("decks").length, IQ.store.all("cards").length, IQ.store.all("reviews").length], before, "progress kept");
  eq(JSON.stringify(IQ.store.all("cards")), cards, "species progress unchanged");
  eq(JSON.stringify(await api2("GET", "/api/stats")), stats, "statistics unchanged");
  ok(IQ.store.all("reviews").every((r) => !("choices" in r) && !("card_after" in r)), "extra copies dropped");
  const latest = new Map();
  for (const r of IQ.store.all("reviews")) if (!latest.has(r.card_id) || r.id > latest.get(r.card_id).id) latest.set(r.card_id, r);
  ok([...latest.values()].every((r) => "stability" in r.card_before), "latest answer per species keeps what rating needs");
  // Studying carries on, and the latest answer's rating can still be changed.
  const q = await api2("GET", `/api/decks/${d.id}/next?practice=true`);
  const card = IQ.store.get("cards", IQ.store.get("questions", q.question_id).card_id);
  await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: card.taxon_id });
  eq((await api2("POST", `/api/questions/${q.question_id}/rate`, { rating: 4 })).rating, 4);
});

test("free up space: deletes saved iNaturalist results, keeps progress", async () => {
  const d = await listDeck();
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  await api2("POST", `/api/questions/${q.question_id}/answer`, { taxon_id: q.choices[0].id });
  ok((await IQ.store.cacheCount()) > 0 && IQ.store.all("observations").length > 0);
  const before = [IQ.store.all("decks").length, IQ.store.all("cards").length, IQ.store.all("reviews").length];
  await IQ.store.freeUpSpace();
  eq([await IQ.store.cacheCount(), IQ.store.all("observations").length], [0, 0]);
  eq([IQ.store.all("decks").length, IQ.store.all("cards").length, IQ.store.all("reviews").length], before, "progress kept");
  const q2 = await api2("GET", `/api/decks/${d.id}/next`);           // studying carries on
  ok(q2.question_id && q2.photos.length);
});

test("unknown address gives a clear error", async () => {
  await throws(api2("GET", "/api/nope"), /Not found/);
});

// ---- live checks against the real iNaturalist (tests.html?live) --------------
test.live("iNaturalist answers this browser directly (search)", async () => {
  const r = await IQ.inat.autocompleteTaxa("Turdus merula");
  ok(r.some((t) => t.name === "Turdus merula"), "Turdus merula not found");
});

test.live("open-licence photos come from the open-data server", async () => {
  const [t] = (await IQ.inat.searchTaxa("Turdus merula", "species")).filter((x) => x.name === "Turdus merula");
  const obs = await IQ.inat.observations(t.id, null, 20);
  ok(obs.length >= 5, `only ${obs.length} observations`);
  const photos = obs.flatMap((o) => o.photos);
  ok(photos.some((p) => IQ.config.OPEN_LICENCES.includes(p.license_code)), "no open-licence photos");
  ok(photos.some((p) => p.url.includes("inaturalist-open-data")), "photos not on the open-data server");
  ok(obs.every((o) => Array.isArray(o.annotations)), "observations don't include annotations (needed to hide dead ones)");
  ok(obs.every((o, i) => i === 0 || (obs[i - 1].faves_count ?? 0) >= (o.faves_count ?? 0)), "not sorted by favourites");
  ok((obs[0].faves_count ?? 0) > 0, "the top observation should have favourites");
});

test.live("look-alike lookups work", async () => {
  const [t] = (await IQ.inat.searchTaxa("Turdus merula", "species")).filter((x) => x.name === "Turdus merula");
  ok((await IQ.inat.similarSpecies(t.id)).length > 0, "no similar species");
  ok((await IQ.inat.speciesCounts({ taxon_id: t.id, per_page: 5 })).length > 0, "no species counts");
});

test.live("a real deck gives a real question", async () => {
  const d = await listDeck(["Turdus merula", "Erithacus rubecula"]);
  eq(d.num_cards, 2);
  const q = await api2("GET", `/api/decks/${d.id}/next`);
  ok(q.photos.length > 0 && q.choices.length === 5, "question incomplete");
  await new Promise((resolve, reject) => {
    const im = new Image(); im.onload = resolve; im.onerror = () => reject(new Error("photo didn't load")); im.src = q.photos[0].url;
  });
});
