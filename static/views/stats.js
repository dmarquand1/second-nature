// Stats page: progress, reviews per day, upcoming reviews, species you struggle with, mix-ups.
async function StatsView(deckId) {
  const app = document.getElementById("app");
  app.innerHTML = "Loading…";
  const here = stillHere();
  let s, deckList;
  try {
    [s, deckList] = await Promise.all([api.get(`/api/stats${deckId ? `?deck_id=${deckId}` : ""}`), api.get("/api/decks")]);
  } catch (e) { app.innerHTML = ""; toast(e.message, true); return; }
  if (!here()) return;
  const t = s.totals;
  const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
  const deckName = deckId ? (deckList.find((d) => d.id === deckId) || {}).name : null;
  const st = s.states;
  const stTotal = st.new + st.learning + st.young + st.mature;

  app.innerHTML = `
    <div class="row between wrap">
      <h1>Stats${deckName ? `: ${esc(deckName)}` : ""}</h1>
      <select id="deck-pick">
        <option value="">All decks</option>
        ${deckList.map((d) => `<option value="${d.id}" ${d.id === deckId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}
      </select>
    </div>

    <div class="tiles">
      ${tile("Answers", t.reviews.toLocaleString(), t.today_reviews ? `${t.today_reviews} today` : "none today")}
      ${tile("Accuracy", pct(t.accuracy), t.today_accuracy != null ? `${pct(t.today_accuracy)} today` : "")}
      ${tile("Study streak", `${t.streak} day${t.streak === 1 ? "" : "s"}`, `${t.days_studied} days studied`)}
      ${tile("Known species", (st.young + st.mature).toLocaleString(), `of ${stTotal.toLocaleString()} · ${st.mature} mature`)}
      ${tile("Time answering", `${t.minutes} min`, "")}
    </div>

    <section class="card chart-card">
      <h2>Progress</h2>
      <p class="muted small">How well each species is learned. <b>Young</b>: in review, comes back within 3 weeks. <b>Mature</b>: remembered for 3+ weeks.</p>
      ${segmented([["New", st.new, "s1"], ["Learning", st.learning, "s2"], ["Young", st.young, "s3"], ["Mature", st.mature, "s4"]])}
    </section>

    <div class="two-col">
      <section class="card chart-card">
        <h2>Answers per day</h2>
        <p class="muted small">Last 30 days. Hover a bar for accuracy.</p>
        ${columns(s.daily.map((d) => ({
          label: shortDate(d.date), value: d.reviews,
          tip: `${longDate(d.date)}: ${d.reviews} answers${d.reviews ? `, ${Math.round(100 * d.correct / d.reviews)}% correct` : ""}`,
        })), { every: 7 })}
        <details class="small"><summary>Show as table</summary>${table(["Date", "Answers", "Correct"],
          s.daily.filter((d) => d.reviews).map((d) => [longDate(d.date), d.reviews, d.correct]))}</details>
      </section>
      <section class="card chart-card">
        <h2>Coming up</h2>
        <p class="muted small">Species due for review over the next 2 weeks (today includes overdue).</p>
        ${columns(s.forecast.map((f) => ({
          label: f.day === 0 ? "Today" : shortDate(f.date), value: f.due,
          tip: `${f.day === 0 ? "Today" : longDate(f.date)}: ${f.due} due`,
        })), { every: 2 })}
        <details class="small"><summary>Show as table</summary>${table(["Day", "Due"],
          s.forecast.map((f) => [f.day === 0 ? "Today" : longDate(f.date), f.due]))}</details>
      </section>
    </div>

    <section class="card">
      <h2>Species you struggle with</h2>
      ${s.struggles.length ? `<table class="data">
        <thead><tr><th>Species</th>${deckId ? "" : "<th>Deck</th>"}<th class="num">Correct</th><th class="num">Accuracy</th><th class="num">Forgotten</th><th></th></tr></thead>
        <tbody>${s.struggles.map((r) => `<tr>
          <td>${spCell(r)}</td>
          ${deckId ? "" : `<td class="muted">${esc(r.deck_name)}</td>`}
          <td class="num">${r.right}/${r.seen}</td><td class="num">${pct(r.accuracy)}</td><td class="num">${r.lapses}×</td>
          <td><a href="https://www.inaturalist.org/taxa/${r.id}" target="_blank" rel="noopener">iNat</a></td></tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Nothing yet. Species show up here once you've got them wrong at least once in two or more tries.</p>`}
    </section>

    <section class="card">
      <h2>Species you mix up</h2>
      <p class="muted small">"It was X, you picked Y". These pairs now also turn up more often as wrong-answer options, so you get to practise telling them apart.</p>
      ${s.confusions.length ? `<table class="data">
        <thead><tr><th>It was</th><th>You picked</th><th class="num">Times</th><th></th></tr></thead>
        <tbody>${s.confusions.map((c) => `<tr>
          <td>${spCell(c.answer)}</td>
          <td>${spCell(c.chosen)}</td>
          <td class="num">${c.count}</td>
          <td><a href="https://www.inaturalist.org/taxa/${c.answer.id}" target="_blank" rel="noopener">compare on iNat</a></td></tr>`).join("")}</tbody>
      </table>` : `<p class="muted">No mix-ups yet.</p>`}
    </section>

    ${s.strongest.length ? `<section class="card"><h2>Your strongest species</h2>
      <p class="muted small">Days until FSRS expects your recall to drop to 90%.</p>
      <div class="strong-list">${s.strongest.map((r) => `<span class="chip">${taxonLabel(r)} <span class="muted small">${r.stability_days} d</span></span>`).join("")}</div>
    </section>` : ""}

    ${s.per_deck.length ? `<section class="card"><h2>Decks</h2><table class="data">
      <thead><tr><th>Deck</th><th class="num">Species</th><th class="num">Studied</th><th class="num">Mature</th><th class="num">Due</th><th class="num">Answers</th><th class="num">Accuracy</th></tr></thead>
      <tbody>${s.per_deck.map((d) => `<tr><td><a href="#/stats/${d.id}">${esc(d.name)}</a></td><td class="num">${d.species}</td>
        <td class="num">${d.studied}</td><td class="num">${d.mature}</td><td class="num">${d.due}</td><td class="num">${d.reviews}</td>
        <td class="num">${pct(d.accuracy)}</td></tr>`).join("")}</tbody></table></section>` : ""}
  `;

  document.getElementById("deck-pick").addEventListener("change", (e) => {
    location.hash = e.target.value ? `#/stats/${e.target.value}` : "#/stats";
  });
  attachTooltips(app);
}

function spCell(t) {
  return `<div class="sp-cell">${t.photo_url ? `<img src="${esc(t.photo_url)}" alt="" loading="lazy">` : `<span class="noimg-sm"></span>`}<span>${taxonLabel(t)}</span></div>`;
}

function tile(label, value, sub) {
  return `<div class="tile card"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>
    <div class="tile-sub muted small">${esc(sub || "")}</div></div>`;
}

// One whole split into parts (progress states), with a legend that carries the numbers.
function segmented(parts) {
  const total = parts.reduce((a, p) => a + p[1], 0);
  if (!total) return `<p class="muted">No species yet.</p>`;
  return `<div class="segbar">${parts.filter((p) => p[1]).map(([name, n, cls]) =>
      `<span class="seg ${cls}" style="flex:${n}" data-tip="${esc(name)}: ${n} (${Math.round(100 * n / total)}%)"></span>`).join("")}</div>
    <div class="legend">${parts.map(([name, n, cls]) =>
      `<span><i class="swatch ${cls}"></i>${esc(name)} <b>${n.toLocaleString()}</b></span>`).join("")}</div>`;
}

// Simple column chart in SVG: single series, thin columns, rounded tops, hover tooltips.
function columns(data, { every = 1 } = {}) {
  const W = 600, H = 170, padL = 30, padB = 22, padT = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const band = (W - padL) / data.length;
  const bw = Math.min(24, band - 2);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const r = 4;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    ${ticks.map((v) => `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
    ${data.map((d, i) => {
      const x = padL + i * band + (band - bw) / 2;
      const h = y(0) - y(d.value);
      const rr = Math.min(r, h / 2, bw / 2);
      const path = d.value ? `M${x},${y(0)} V${y(d.value) + rr} Q${x},${y(d.value)} ${x + rr},${y(d.value)}
        H${x + bw - rr} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + rr} V${y(0)} Z` : "";
      return `<g class="col" data-tip="${esc(d.tip)}">
        <rect class="hit" x="${padL + i * band}" y="${padT}" width="${band}" height="${H - padT - padB}"/>
        ${path ? `<path class="bar-mark" d="${path}"/>` : ""}
        ${i % every === 0 || (i === data.length - 1 && i % every >= every / 2) ? `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>` : ""}
      </g>`;
    }).join("")}
    <line class="baseline" x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>
  </svg>`;
}

function niceStep(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
}

function table(headers, rows) {
  if (!rows.length) return `<p class="muted">No data.</p>`;
  return `<table class="data"><thead><tr>${headers.map((h, i) => `<th class="${i ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function attachTooltips(root) {
  let tip = document.getElementById("chart-tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "chart-tip"; tip.className = "chart-tip hidden"; document.body.appendChild(tip); }
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("pointerenter", () => { tip.textContent = el.dataset.tip; tip.classList.remove("hidden"); el.classList.add("hover"); });
    el.addEventListener("pointermove", (e) => { tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 34}px`; });
    el.addEventListener("pointerleave", () => { tip.classList.add("hidden"); el.classList.remove("hover"); });
  });
}

const shortDate = (s) => new Date(s + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
const longDate = (s) => new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
