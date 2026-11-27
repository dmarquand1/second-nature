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
