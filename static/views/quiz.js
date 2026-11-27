// The quiz screen: photos, map + date, multiple choice, reveal and rating.
const RATINGS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

function QuizView(deckId) {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="row between quiz-head">
      <a href="#/deck/${deckId}" class="muted">← Deck</a>
      <span id="queue" class="muted"></span>
      <span id="score" class="muted">0 / 0 this session</span>
    </div>
    <div id="quiz" class="quiz"><p class="loading">Fetching a question from iNaturalist…</p></div>`;

  const session = { right: 0, total: 0 };
  let current = null, result = null, startedAt = 0, answered = false, map = null, nextPromise = null;
  let practice = false;

  const loadQuestion = () => api.get(`/api/decks/${deckId}/next${practice ? "?practice=true" : ""}`);

  function showQueue(c) {
    if (!c) return;
    document.getElementById("queue").innerHTML = practice
      ? `<span class="pill">Practice</span>`
      : `<span class="pill due">${c.due} due</span> <span class="pill new">${c.new_available} new</span>`;
  }

  async function show(promise) {
    const quiz = document.getElementById("quiz");
    quiz.innerHTML = `<p class="loading">Fetching a question from iNaturalist…</p>`;
    try { current = await promise; } catch (e) {
      quiz.innerHTML = `<p class="error">${esc(e.message)}</p><button class="btn" id="retry">Try again</button>`;
      document.getElementById("retry").onclick = () => show(loadQuestion());
      return;
    }
    showQueue(current.counts);
    if (current.done) return showDone(current.counts);

    answered = false; result = null;
    const q = current;
    const loc = q.location || {};
    quiz.innerHTML = `
      <section class="photos">
        <div class="main-photo"><img id="main-img" src="${esc(q.photos[0].url)}" alt="Mystery organism"></div>
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

    quiz.querySelectorAll(".thumbs img").forEach((img) => img.addEventListener("click", () => {
      document.getElementById("main-img").src = img.src;
      quiz.querySelectorAll(".thumbs img").forEach((x) => x.classList.toggle("active", x === img));
    }));
    quiz.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => answer(+b.dataset.id)));
    drawMap(loc);
    startedAt = performance.now();
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
    document.getElementById("practice-btn").onclick = () => { practice = true; show(loadQuestion()); };
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

    // Start loading the next question while the answer is shown.
    nextPromise = loadQuestion();
    nextPromise.catch(() => {});

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
        <p class="muted small attribution">${o.photos.map((p) => esc(p.attribution || "")).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("; ")}</p>
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
      nextPromise = null;  // the schedule changed, so fetch a fresh next question
    }
    answered = false; current = null;
    show(nextPromise || loadQuestion());
    nextPromise = null;
  }

  function onKey(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
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
  window.currentCleanup = () => { document.removeEventListener("keydown", onKey); if (map) map.remove(); };

  show(loadQuestion());
}
