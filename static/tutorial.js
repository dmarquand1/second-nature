// A short welcome tour for new players (shared by the local app and the website).
//
// It opens by itself on the Decks page when there are no decks yet and the player
// hasn't finished or skipped it before. It can be skipped at any point (Skip button,
// Esc, or clicking outside it), and opened again from the "?" help or Settings.
// Whether it has been seen is remembered in this browser only (localStorage).
const Tutorial = (() => {
  const KEY = "sn.tutorialSeen";
  const website = () => typeof IQ !== "undefined" && !!IQ.router;

  const STEPS = () => [
    {
      title: "Welcome to Second Nature",
      body: `<p>Learn to identify species until it's second nature, with quick-fire quizzes on real photos from
        <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>.</p>
        <p>This quick tour takes about a minute. You can skip it at any point.</p>`,
    },
    {
      title: "1. Make a deck",
      body: `<p>A deck is the set of species you want to learn. Make one in three ways:</p>
        <ul><li><b>A species list</b>: type or paste names (common or scientific).</li>
        <li><b>A group</b>: the most-seen species in a group, such as thrushes or fungi.</li>
        <li><b>A place</b>: the common species where you live or are visiting.</li></ul>
        <p>Adding a place also means photos and wrong answers come from that area.</p>`,
    },
    {
      title: "2. Name the species",
      body: `<p>Each question shows photos of a real observation, with a map of where it was seen.
        Pick the right name from the choices. The wrong answers are lookalikes, so you learn the real differences.</p>
        <p>Press <kbd>Z</kbd> or click a photo to zoom in. Keys <kbd>1</kbd>–<kbd>6</kbd> pick an answer.</p>`,
    },
    {
      title: "3. It remembers for you",
      body: `<p>After each answer, say how well you knew it: <b>Again</b>, <b>Hard</b>, <b>Good</b> or <b>Easy</b>.
        A rating is suggested for you; press <kbd>Enter</kbd> to keep it.</p>
        <p>Species you find hard come back soon. Ones you know well come back after longer and longer gaps.
        This is called spaced repetition, and it's the quickest way to make names stick.</p>`,
    },
    {
      title: "4. A little every day",
      body: `<p>Each deck shows how many species are <span class="pill due">due</span> for review and how many are
        <span class="pill new">new</span> today. A few minutes a day works better than one long session.</p>
        <p>When nothing is due, <b>Practice</b> lets you keep going anyway. <b>Stats</b> shows your progress and the
        species you mix up most.</p>`,
    },
    {
      title: "5. Your progress",
      body: website()
        ? `<p>There's no account. Your progress is saved <b>in this browser on this device only</b>.</p>
          <p>Use <b>Settings → Download backup</b> now and then, to keep a copy or move to another device.</p>`
        : `<p>Your progress is saved on this computer, in the app's <code>data</code> folder.</p>`,
      last: true,
    },
  ];

  let el = null, step = 0, steps = [];

  function seen() { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }
  function markSeen() { try { localStorage.setItem(KEY, "1"); } catch {} }
  const isOpen = () => !!el;

  function render() {
    const s = steps[step];
    el.querySelector(".tour-body").innerHTML = `<h2 id="tour-title">${s.title}</h2>${s.body}`;
    el.querySelector(".tour-dots").innerHTML = steps.map((_, i) =>
      `<span class="tour-dot${i === step ? " on" : ""}"></span>`).join("");
    el.querySelector("[data-back]").classList.toggle("hidden", step === 0);
    el.querySelector("[data-skip]").classList.toggle("hidden", !!s.last);
    el.querySelector("[data-next]").textContent = step === 0 ? "Show me" : s.last ? "Make my first deck" : "Next";
    el.querySelector("[data-done]").classList.toggle("hidden", !s.last);
    el.querySelector("[data-next]").focus();
  }

  function close(goNew = false) {
    if (!el) return;
    markSeen();
    el.remove(); el = null;
    window.removeEventListener("keydown", onKey, true);
    if (goNew) location.hash = "#/new";
  }

  function onKey(e) {
    if (!el) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); if (step > 0) { step--; render(); } }
    else if (e.key === "?") { e.stopPropagation(); }              // don't open the shortcuts behind the tour
  }

  function next() {
    if (steps[step].last) return close(true);
    step++; render();
  }

  function start() {
    if (el) return;
    steps = STEPS(); step = 0;
    el = document.createElement("div");
    el.className = "modal tour";
    el.innerHTML = `<div class="card modal-box tour-box" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div class="tour-body"></div>
        <div class="tour-dots" aria-hidden="true"></div>
        <div class="row between tour-buttons">
          <button class="btn link" data-skip>Skip tutorial</button>
          <div class="row">
            <button class="btn" data-back>Back</button>
            <button class="btn" data-done>Close</button>
            <button class="btn primary" data-next>Next</button>
          </div>
        </div>
      </div>`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (e.target === el || (b && (b.dataset.skip !== undefined || b.dataset.done !== undefined))) close();
      else if (b && b.dataset.back !== undefined) { step--; render(); }
      else if (b && b.dataset.next !== undefined) next();
    });
    window.addEventListener("keydown", onKey, true);
    document.body.appendChild(el);
    render();
  }

  // Called by the Decks page: open the tour for someone with no decks who hasn't seen it.
  function maybeStart(hasDecks) { if (!hasDecks && !seen()) start(); }

  return { start, maybeStart, close, isOpen, seen, KEY };
})();
