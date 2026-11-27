// The quiz screen: photos, map + date, multiple choice, reveal and rating.
//
// Speed: the next AHEAD questions are requested while you look at the current
// one, and their photos are downloaded in the background, so "Next" is instant.
const RATINGS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
const AHEAD = 2;

function QuizView(deckId) {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="row between quiz-head">
      <a href="#/deck/${deckId}" class="muted">← Deck</a>
      <span id="queue" class="muted"></span>
      <span class="row"><span id="score" class="muted">0 / 0 this session</span>
        <button class="btn small-btn" id="help-btn" title="Keyboard shortcuts (?)">?</button></span>
    </div>
    <div id="warmup" class="warmup muted small hidden"></div>
    <div id="quiz" class="quiz"><p class="loading">Fetching a question from iNaturalist…</p></div>`;

  const session = { right: 0, total: 0 };
  let current = null, result = null, startedAt = 0, answered = false, map = null;
  let practice = false, photoIndex = 0, alive = true;
  let ahead = [];   // promises for questions prepared in advance

  const loadQuestion = () => api.get(`/api/decks/${deckId}/next${practice ? "?practice=true" : ""}`);

  function preloadPhotos(q) {
    if (!q || q.done) return;
    q.photos.forEach((p) => { const im = new Image(); im.src = p.url; });
  }

  // Keep AHEAD questions in preparation. Stop at the first "done".
  async function fillAhead() {
    while (alive && ahead.length < AHEAD) {
      const last = ahead[ahead.length - 1];
      if (last && (await last.then((q) => q.done, () => true))) return;
      const p = loadQuestion();
      p.then(preloadPhotos, () => {});
      ahead.push(p);
    }
  }

  async function nextFromQueue() {
    if (!ahead.length) return loadQuestion();
    const p = ahead.shift();
    let q;
    try { q = await p; } catch (e) { return loadQuestion(); }
    // A "done" prepared earlier may be out of date (e.g. you rated something Again since).
    if (q.done) { ahead = []; return loadQuestion(); }
    return q;
  }

  // Show deck warm-up progress (photos and look-alikes being fetched in the background).
  async function watchWarmup() {
    const box = document.getElementById("warmup");
    while (alive) {
      let w;
      try { w = await api.get(`/api/decks/${deckId}/warmup`); } catch { return; }
      if (!w || !["queued", "running"].includes(w.status)) { box.classList.add("hidden"); return; }
      box.classList.remove("hidden");
      box.innerHTML = `Getting the deck ready in the background: ${w.done} of ${w.total || "?"} species
        <span class="bar"><span style="width:${w.total ? (100 * w.done / w.total) : 0}%"></span></span>`;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  function showQueue(c) {
    if (!c) return;
    document.getElementById("queue").innerHTML = practice
      ? `<span class="pill">Practice</span>`
      : `<span class="pill due">${c.due} due</span> <span class="pill new">${c.new_available} new</span>`;
  }

  async function show(promise) {
    const quiz = document.getElementById("quiz");
    quiz.innerHTML = `<p class="loading">Fetching a question from iNaturalist…</p>`;
    let q0;
    try { q0 = await (promise || nextFromQueue()); } catch (e) {
      if (!alive) return;
      if (/no species yet/i.test(e.message) && alive) {
        // The deck is still being built in the background: wait for its first species.
        quiz.innerHTML = `<p class="loading">Finding the first species for this deck on iNaturalist…</p>`;
        setTimeout(() => alive && show(loadQuestion()), 1000);
        return;
      }
      quiz.innerHTML = `<p class="error">${esc(e.message)}</p><button class="btn" id="retry">Try again</button>`;
      document.getElementById("retry").onclick = () => { ahead = []; show(loadQuestion()); };
      return;
    }
    if (!alive) return;
    current = q0;
    showQueue(current.counts);
    if (current.done) return showDone(current.counts);

    answered = false; result = null; photoIndex = 0;
    const q = current;
    const loc = q.location || {};
    quiz.innerHTML = `
      <section class="photos">
        <div class="main-photo" title="Click to zoom (Z)"><img id="main-img" src="${esc(q.photos[0].url)}" alt="Mystery organism">
          <button class="zoom-btn" id="zoom-btn" title="Zoom (Z)">⤢ Zoom</button></div>
        ${q.photos.length > 1 ? `<div class="thumbs">${q.photos.map((p, i) =>
          `<img src="${esc(p.url)}" data-i="${i}" class="${i === 0 ? "active" : ""}" alt="Photo ${i + 1}">`).join("")}</div>` : ""}
      </section>
      <aside class="side">
        <div id="map" class="map"></div>
        <p class="meta">
          ${q.is_new ? `<span class="pill new">New species</span><br>` : ""}
          ${q.observed_on ? `<strong>${esc(formatDate(q.observed_on))}</strong><br>` : ""}
          ${loc.place_guess ? esc(loc.place_guess) : ""}
          ${loc.obscured ? `<br><span class="muted small">Location obscured</span>` : ""}
        </p>
        <div class="choices">
          ${q.choices.map((c, i) => `<button class="choice" data-id="${c.id}"><kbd>${i + 1}</kbd> ${taxonLabel(c)}</button>`).join("")}
        </div>
        <div id="reveal"></div>
      </aside>`;

    quiz.querySelectorAll(".thumbs img").forEach((img) => img.addEventListener("click", () => setPhoto(+img.dataset.i)));
    quiz.querySelector(".main-photo").addEventListener("click", openZoom);
    quiz.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => answer(+b.dataset.id)));
    drawMap(loc);
    showSharp(0);
    startedAt = performance.now();
    fillAhead();
  }

  // Show the medium photo straight away, then swap in the large one once it has loaded.
  function showSharp(i) {
    const q = current, p = q.photos[i];
    const img = document.getElementById("main-img");
    img.src = p.url;
    if (!p.large || p.large === p.url) return;
    const big = new Image();
    big.onload = () => { if (current === q && photoIndex === i) img.src = p.large; };
    big.src = p.large;
  }

  function setPhoto(i) {
    if (!current || current.done) return;
    const n = current.photos.length;
    photoIndex = (i + n) % n;
    showSharp(photoIndex);
    document.querySelectorAll(".thumbs img").forEach((x) => x.classList.toggle("active", +x.dataset.i === photoIndex));
  }

  function openZoom() {
    if (!current || current.done) return;
    Viewer.open(current.photos.map((p) => ({ url: p.large || p.url, original: p.original })), photoIndex, (i) => setPhoto(i));
  }

  function showDone(c) {
    current = null;
    const when = c.next_due ? relativeTime(c.next_due) : null;
    document.getElementById("quiz").innerHTML = `
      <div class="card done">
        <h2>All done for now 🎉</h2>
        <p>${session.total ? `You answered ${session.total} (${session.right} right) this session. ` : ""}
           No species are due${c.new_total ? ` and you've had today's ${c.new_per_day} new ones` : ""}.</p>
        ${when ? `<p class="muted">Next review ${esc(when)}.</p>` : ""}
        <div class="row wrap">
          <button class="btn primary" id="practice-btn">Keep practising</button>
          <a class="btn" href="#/deck/${deckId}">Deck settings</a>
          <a class="btn" href="#/">All decks</a>
        </div>
        <p class="muted small">Practice still updates the schedule. FSRS knows the card wasn't due yet, so early reviews only count a little.</p>
      </div>`;
    document.getElementById("practice-btn").onclick = () => { practice = true; ahead = []; show(loadQuestion()); };
  }

  function drawMap(loc) {
    if (map) { map.remove(); map = null; }
    const el = document.getElementById("map");
    if (loc.lat == null || typeof L === "undefined") { el.innerHTML = `<p class="muted small">No location</p>`; return; }
    map = L.map(el, { zoomControl: true, attributionControl: true }).setView([loc.lat, loc.lng], loc.obscured ? 7 : 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    const radius = loc.obscured ? 15000 : Math.max(loc.accuracy_m || 0, 500);
    L.circle([loc.lat, loc.lng], { radius, color: "#74ac00" }).addTo(map);
    L.circleMarker([loc.lat, loc.lng], { radius: 5, color: "#74ac00", fillOpacity: 1 }).addTo(map);
  }

  async function answer(taxonId) {
    if (answered || !current) return;
    answered = true;
    const ms = Math.round(performance.now() - startedAt);
    try { result = await api.post(`/api/questions/${current.question_id}/answer`, { taxon_id: taxonId, response_ms: ms }); }
    catch (e) { answered = false; toast(e.message, true); return; }
    const r = result;

    session.total++; if (r.correct) session.right++;
    document.getElementById("score").textContent = `${session.right} / ${session.total} this session`;

    document.querySelectorAll(".choice").forEach((b) => {
      const id = +b.dataset.id;
      b.disabled = true;
      if (id === r.answer.id) b.classList.add("right");
      else if (id === taxonId) b.classList.add("wrong");
    });
    const o = r.observation;
    document.getElementById("reveal").innerHTML = `
      <div class="reveal ${r.correct ? "ok" : "bad"}">
        <h3>${r.correct ? "Correct!" : "Not quite."}</h3>
        <p>It's ${taxonLabel(r.answer)}</p>
        <p class="small">
          <a href="${esc(o.uri)}" target="_blank" rel="noopener">View observation on iNaturalist</a> ·
          <a href="${esc(r.answer.url)}" target="_blank" rel="noopener">About this species</a>
          ${r.chosen && !r.correct ? ` · <a href="${esc(r.chosen.url)}" target="_blank" rel="noopener">About ${esc(r.chosen.common_name || r.chosen.name)}</a>` : ""}
        </p>
        <p class="muted small attribution">Photos: ${photoCredits(o)}</p>
        <p class="small muted rate-help">${r.correct ? "How well did you know it? Press Enter to keep the suggested rating." : "Wrong answers are rated Again, so you'll see it again soon."}</p>
        <div class="ratings">
          ${[1, 2, 3, 4].map((n) => `
            <button class="rating r${n} ${n === r.rating ? "suggested" : ""}" data-r="${n}" ${!r.correct && n !== 1 ? "disabled" : ""}>
              <span>${RATINGS[n]} <kbd>${n}</kbd></span>
              <small>${esc(r.intervals[n])}</small>
            </button>`).join("")}
        </div>
      </div>`;
    document.querySelectorAll(".rating").forEach((b) => b.addEventListener("click", () => rateAndNext(+b.dataset.r)));
    document.querySelector(".rating.suggested").focus();
  }

  async function rateAndNext(rating) {
    if (!answered || !result) return;
    const r = result;
    result = null;   // block double presses
    if (rating !== r.rating) {
      if (!r.correct && rating !== 1) { result = r; return; }
      try { await api.post(`/api/questions/${current.question_id}/rate`, { rating }); }
      catch (e) { toast(e.message, true); }
    }
    answered = false; current = null;
    show();
  }

  function onKey(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (current && !current.done && (e.key === "z" || e.key === "Z")) { openZoom(); return; }
    if (current && !current.done && e.key === "ArrowLeft") { setPhoto(photoIndex - 1); return; }
    if (current && !current.done && e.key === "ArrowRight") { setPhoto(photoIndex + 1); return; }
    if (!answered && /^[1-6]$/.test(e.key) && current && !current.done) {
      const c = current.choices[+e.key - 1];
      if (c) answer(c.id);
    } else if (answered && result && /^[1-4]$/.test(e.key)) {
      rateAndNext(+e.key);
    } else if (answered && result && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); rateAndNext(result.rating);
    }
  }
  document.addEventListener("keydown", onKey);
  window.currentCleanup = () => {
    alive = false;
    document.removeEventListener("keydown", onKey);
    if (map) map.remove();
    if (Viewer.isOpen()) Viewer.close();
  };
  document.getElementById("help-btn").onclick = () => Shortcuts.toggle();

  api.post(`/api/decks/${deckId}/warmup`).then(watchWarmup, () => {});
  show(loadQuestion());
}

// "(c) Jane Doe, some rights reserved (CC BY-NC)" with the licence linked, once per photographer/licence.
function photoCredits(o) {
  const seen = new Set();
  return o.photos.filter((p) => {
    const k = (p.attribution || "") + p.license_name;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).map((p) => {
    const lic = p.license_url
      ? `<a href="${esc(p.license_url)}" target="_blank" rel="noopener">${esc(p.license_name)}</a>`
      : esc(p.license_name || "");
    return `${esc(p.attribution || "Unknown photographer")} · ${lic}`;
  }).join("; ") + ` · <a href="${esc(o.uri)}" target="_blank" rel="noopener">source</a>`;
}
