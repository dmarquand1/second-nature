// Background jobs (building decks, warming up photos), like app/jobs.py.
// One job runs at a time; its iNaturalist requests use background priority,
// so the question you're looking at always goes first.
// Jobs only run while the page is open. If you close the tab, the job is
// marked "interrupted" next time and you can add the rest from Edit.
IQ.jobs = (() => {
  const S = IQ.store, U = IQ.util;
  const handlers = {};
  const queue = [];
  let running = false;
  let idleWaiters = [];

  const handler = (kind, fn) => { handlers[kind] = fn; };

  async function markInterrupted() {
    for (const j of S.where("jobs", (j) => j.status === "queued" || j.status === "running")) {
      await S.update("jobs", j.id, { status: "interrupted", finished_at: U.now() });
    }
  }

  async function submit(kind, deckId, params = {}, dedupe = false) {
    if (dedupe) {
      const j = S.where("jobs", (j) => j.kind === kind && j.deck_id === deckId && ["queued", "running"].includes(j.status))[0];
      if (j) return j.id;
    }
    const job = await S.insert("jobs", { kind, deck_id: deckId, status: "queued", params, done: 0, total: null,
                                         message: null, result: null, created_at: U.now(), finished_at: null });
    queue.push(job.id);
    run();
    return job.id;
  }

  async function run() {
    if (running) return;
    running = true;
    while (queue.length) {
      const id = queue.shift();
      const job = S.get("jobs", id);
      if (!job || job.status !== "queued") continue;
      const fn = handlers[job.kind];
      if (!fn) { await S.update("jobs", id, { status: "failed", message: `Unknown job kind ${job.kind}` }); continue; }
      await S.update("jobs", id, { status: "running" });
      let lastWrite = 0;
      const progress = (done, total, message, force) => {
        // Progress shows instantly (it's in memory); saved to storage at most twice a second.
        const r = S.get("jobs", id);
        r.done = done;
        if (total != null) r.total = total;
        if (message != null) r.message = message;
        if (force || Date.now() - lastWrite > 500) { lastWrite = Date.now(); S.put("jobs", r); }
      };
      try {
        const result = await fn(id, job.deck_id, job.params || {}, progress, { bg: true });
        await S.update("jobs", id, { status: "done", result: result || {}, finished_at: U.now() });
      } catch (e) {
        console.error(e);
        await S.update("jobs", id, { status: "failed", message: String(e.message || e).slice(0, 500), finished_at: U.now() });
      }
    }
    running = false;
    idleWaiters.forEach((r) => r());
    idleWaiters = [];
  }

  const get = (id) => S.get("jobs", id);

  function deckJobs(deckId) {
    const js = S.where("jobs", (j) => j.deck_id === deckId);
    const builds = js.filter((j) => j.kind === "build");
    const lastBuild = builds.length ? Math.max(...builds.map((j) => j.id)) : null;
    return js.filter((j) => ["queued", "running"].includes(j.status) || j.id === lastBuild).sort((a, b) => a.id - b.id);
  }

  // Resolves when no job is queued or running (used by tests).
  const waitIdle = () => (running || queue.length ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve());

  return { handler, submit, get, deckJobs, waitIdle, markInterrupted };
})();
