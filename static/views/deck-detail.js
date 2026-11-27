// One deck: progress of finding species, its species (searchable, paged), links to study/edit.
const PAGE_SIZE = 60;

async function DeckDetailView(deckId) {
  const app = document.getElementById("app");
  app.innerHTML = "Loading…";
  let alive = true;
  window.currentCleanup = () => { alive = false; };
  const here = stillHere();
  let d;
  try { d = await api.get(`/api/decks/${deckId}`); } catch (e) { app.innerHTML = ""; toast(e.message, true); return; }
  if (!here()) return;

  const buildJob = d.jobs.filter((j) => j.kind === "build").pop();
  app.innerHTML = `
    <div class="row between">
      <div>
        <h1>${esc(d.name)}</h1>
        ${d.description ? `<p>${esc(d.description)}</p>` : ""}
        <p class="muted">${d.num_cards} species · ${esc(sourceLabel(d))}${d.place_name && d.source_type !== "place" ? ` · photos from ${esc(d.place_name)}` : ""}</p>
        <p class="queue-line"><span class="pill due">${d.queue.due} due</span> <span class="pill new">${d.queue.new_available} new today</span>
          ${d.queue.next_due && !d.queue.due ? `<span class="muted small">next review ${esc(relativeTime(d.queue.next_due))}</span>` : ""}</p>
      </div>
      <div class="row wrap">
        <a class="btn" href="#/deck/${d.id}/edit">Edit deck</a>
        <a class="btn" href="#/stats/${d.id}">Stats</a>
        <a class="btn primary big" href="#/quiz/${d.id}">Study</a>
      </div>
    </div>
    <div id="job-box">${buildJob ? jobResultHtml(buildJob) : ""}</div>
    ${(d.no_photos || []).length ? `<details class="card no-photos" id="no-photos">
      <summary>${d.no_photos.length} species taken out: no research-grade photos on iNaturalist that can be shown</summary>
      <p class="small muted">Usually very rare species, or ones whose photos aren't openly licensed. If that changes,
        add them again from <b>Edit deck</b>.</p>
      <p class="small">${d.no_photos.map((t) => `<a href="https://www.inaturalist.org/taxa/${t.id}" target="_blank" rel="noopener">${esc(t.common_name ? `${t.common_name} (${t.name})` : t.name)}</a>`).join(", ")}</p>
    </details>` : ""}
    <div class="row between wrap list-tools">
      <input id="filter" type="search" placeholder="Search ${d.num_cards} species…" autocomplete="off">
      <select id="sort">
        <option value="name">A–Z</option>
        <option value="worst">Most mistakes first</option>
        <option value="due">Due soonest</option>
        <option value="new">New first</option>
      </select>
    </div>
    <div id="cards" class="grid species"></div>
    <div class="center"><button class="btn hidden" id="more">Show more</button></div>`;

  let shown = PAGE_SIZE;
  const render = () => {
    const q = document.getElementById("filter").value.trim().toLowerCase();
    const sort = document.getElementById("sort").value;
    let list = d.cards.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.common_name || "").toLowerCase().includes(q));
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      worst: (a, b) => (b.seen - b.right) - (a.seen - a.right) || a.name.localeCompare(b.name),
      due: (a, b) => (a.state === 0) - (b.state === 0) || (a.due || 0) - (b.due || 0),
      new: (a, b) => (b.state === 0) - (a.state === 0) || a.name.localeCompare(b.name),
    };
    list = list.slice().sort(sorters[sort]);
    document.getElementById("cards").innerHTML = list.slice(0, shown).map((c) => `
      <div class="card sp">
        ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}
        <div>${taxonLabel(c)}</div>
        <div class="muted small">${c.seen ? `${c.right}/${c.seen} correct · ${esc(dueLabel(c))}` : "new"}</div>
        <div class="small"><a href="https://www.inaturalist.org/taxa/${c.taxon_id}" target="_blank" rel="noopener">iNat page</a></div>
      </div>`).join("") || `<p class="muted">${d.num_cards ? "No species match." : "No species yet."}</p>`;
    document.getElementById("more").classList.toggle("hidden", list.length <= shown);
    document.getElementById("more").textContent = `Show more (${list.length - shown} left)`;
  };
  document.getElementById("filter").addEventListener("input", debounce(() => { shown = PAGE_SIZE; render(); }, 150));
  document.getElementById("sort").addEventListener("change", () => { shown = PAGE_SIZE; render(); });
  document.getElementById("more").addEventListener("click", () => { shown += PAGE_SIZE * 2; render(); });
  render();

  // While species are still being found, show progress and refresh the list now and then.
  if (buildJob && ["queued", "running"].includes(buildJob.status)) {
    let lastRefresh = Date.now();
    const final = await pollJob(buildJob.id, async (job) => {
      document.getElementById("job-box").innerHTML = jobResultHtml(job);
      if (Date.now() - lastRefresh > 8000) {
        lastRefresh = Date.now();
        try { d.cards = (await api.get(`/api/decks/${deckId}`)).cards; if (here()) render(); } catch {}
      }
    }, () => alive);
    if (final && here()) DeckDetailView(deckId);
  }
}

function dueLabel(c) {
  if (c.state === 0 || !c.due) return "new";
  const s = c.due - Date.now() / 1000;
  return s <= 0 ? "due now" : `due ${relativeTime(c.due)}`;
}
