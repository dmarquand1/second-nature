// Tiny wrappers around fetch() for the backend JSON API, plus shared helpers.
const api = {
  async request(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : res.statusText);
    return data;
  },
  get: (url) => api.request("GET", url),
  post: (url, body) => api.request("POST", url, body ?? {}),
  del: (url) => api.request("DELETE", url),
};

// Call at the top of a view; the returned function says whether we're still on that page.
function stillHere() {
  const token = window.routeToken;
  return () => token === window.routeToken;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function taxonLabel(t) {
  return t.common_name
    ? `<span class="common">${esc(t.common_name)}</span> <i class="sci">${esc(t.name)}</i>`
    : `<i class="sci">${esc(t.name)}</i>`;
}

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 4000);
}

function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Autocomplete box: calls `search(q)` and `onPick(item)`; `render(item)` returns HTML.
function autocomplete(input, list, search, render, onPick) {
  input.addEventListener("input", debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { list.innerHTML = ""; return; }
    try {
      const items = await search(q);
      list.innerHTML = items.map((it, i) => `<li data-i="${i}">${render(it)}</li>`).join("");
      list.querySelectorAll("li").forEach((li) =>
        li.addEventListener("click", () => { onPick(items[+li.dataset.i]); list.innerHTML = ""; }));
    } catch (e) { toast(e.message, true); }
  }, 350));
}

// Dates and times
function formatDate(s) {
  const d = new Date(s + "T12:00:00");
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function relativeTime(unixSeconds) {
  const s = unixSeconds - Date.now() / 1000;
  if (s < 90) return "in about a minute";
  if (s < 3600) return `in ${Math.round(s / 60)} minutes`;
  if (s < 20 * 3600) return `in ${Math.round(s / 3600)} hours`;
  const days = Math.round(s / 86400);
  return days <= 1 ? "tomorrow" : `in ${days} days`;
}

// Background jobs (building decks): poll until finished, calling onUpdate(job) each time.
async function pollJob(jobId, onUpdate, isAlive = () => true) {
  while (isAlive()) {
    let job;
    try { job = await api.get(`/api/jobs/${jobId}`); } catch (e) { return null; }
    onUpdate(job);
    if (!["queued", "running"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

function progressBar(done, total) {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return `<span class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></span>`;
}

// What happened in a "build" job: added, not found, guesses to check.
function jobResultHtml(job) {
  if (!job) return "";
  if (["queued", "running"].includes(job.status)) {
    return `<div class="job running">${esc(job.message || "Finding species…")} ${progressBar(job.done, job.total)}
      <span class="muted small">${job.done} of ${job.total || "?"} · you can start studying already</span></div>`;
  }
  if (job.status === "failed" || job.status === "interrupted") {
    return `<div class="job bad">Finding species ${job.status === "failed" ? "failed" : "was interrupted (the app was stopped)"}.
      ${esc(job.message || "")} You can add the rest from <b>Edit</b>.</div>`;
  }
  const r = job.result || {};
  const parts = [`<b>${r.added ?? 0}</b> species added.`];
  if (r.not_found?.length) parts.push(`<details><summary>${r.not_found.length} not found on iNaturalist</summary><p class="small">${r.not_found.map(esc).join(", ")}</p></details>`);
  if (r.guessed?.length) parts.push(`<details><summary>${r.guessed.length} matched by best guess (check these)</summary><ul class="small">${r.guessed.map((g) =>
    `<li>“${esc(g.input)}” → ${taxonLabel({ name: g.name, common_name: g.common_name })}</li>`).join("")}</ul></details>`);
  if (r.not_species?.length) parts.push(`<details><summary>${r.not_species.length} skipped (not a species)</summary><p class="small">${r.not_species.map(esc).join(", ")}</p></details>`);
  return `<div class="job ok">${parts.join(" ")}</div>`;
}

// Read a .txt or .csv file the user picked; resolves with its text.
function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}
