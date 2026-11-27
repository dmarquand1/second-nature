// Edit a deck: details and settings, add species (search, paste, file), remove species, delete.
async function EditDeckView(deckId) {
  const app = document.getElementById("app");
  app.innerHTML = "Loading…";
  let alive = true;
  window.currentCleanup = () => { alive = false; };
  const here = stillHere();
  let d;
  try { d = await api.get(`/api/decks/${deckId}`); } catch (e) { app.innerHTML = ""; toast(e.message, true); return; }
  if (!here()) return;
  let place = d.place_id ? { id: d.place_id, name: d.place_name } : null;
  const selected = new Set();

  app.innerHTML = `
    <p><a href="#/deck/${d.id}" class="muted">← Back to deck</a></p>
    <h1>Edit “${esc(d.name)}”</h1>

    <section class="card form edit-section">
      <h2>Details</h2>
      <label>Name <input id="e-name" value="${esc(d.name)}"></label>
      <label>Description (optional) <input id="e-desc" value="${esc(d.description || "")}" placeholder="e.g. Thrushes for the spring survey"></label>
      <div class="row wrap">
        <label>New species per day <input id="e-new" type="number" min="0" max="500" value="${d.new_per_day}"></label>
        <label>Choices per question
          <select id="e-choices">${[4, 5, 6].map((n) => `<option ${n === d.num_choices ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Which photos
          <select id="e-photos">${[["mixed", "Mixed: well-liked photos more often"], ["best", "Best first: most-favourited photos first"],
            ["any", "Any: favourites make no difference"]].map(([v, t]) =>
            `<option value="${v}" ${(d.photo_choice || "mixed") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="e-hide-dead" ${d.hide_dead === 0 || d.hide_dead === false ? "" : "checked"}>
        Hide photos of dead organisms (observations that iNaturalist users tagged "Dead")</label>
      <div>
        <label>Focus place (photos and look-alikes come from here)
          <input id="place-q" autocomplete="off" placeholder="Search a place, or leave empty for worldwide">
          <ul id="place-results" class="ac"></ul>
        </label>
        <div id="place-picked" class="picked muted"></div>
      </div>
      <div><button class="btn primary" id="save">Save details</button></div>
    </section>

    <section class="card form edit-section">
      <h2>Add species</h2>
      <label>Search iNaturalist (click a result to add it)
        <input id="taxon-q" autocomplete="off" placeholder="e.g. Fieldfare, Turdus pilaris">
        <ul id="taxon-results" class="ac"></ul>
      </label>
      <label>…or paste names, one per line
        <textarea id="paste" rows="5" placeholder="Turdus pilaris&#10;Redwing"></textarea>
      </label>
      <label class="file-label">…or load a .txt / .csv file
        <input type="file" id="file" accept=".txt,.csv,text/plain,text/csv"></label>
      <div><button class="btn" id="add-names">Add these names</button></div>
      <div id="job-box"></div>
    </section>

    <section class="card edit-section">
      <div class="row between wrap">
        <h2>Species (<span id="count">${d.num_cards}</span>)</h2>
        <div class="row wrap">
          <input id="filter" type="search" placeholder="Filter…" autocomplete="off">
          <button class="btn" id="select-all">Select all shown</button>
          <button class="btn" id="select-none">Clear selection</button>
          <button class="btn danger" id="remove" disabled>Remove selected</button>
        </div>
      </div>
      <p class="muted small">Removing a species also removes its review history in this deck.</p>
      <div id="rows" class="edit-rows"></div>
      <div class="center"><button class="btn hidden" id="more">Show more</button></div>
    </section>

    <section class="card edit-section danger-zone">
      <h2>Delete deck</h2>
      <p class="muted">Deletes the deck and all its review history. Can't be undone.</p>
      <button class="btn danger" id="delete">Delete this deck</button>
    </section>`;

  // ---- details
  const showPlace = () => {
    document.getElementById("place-picked").innerHTML = place
      ? `Focus: <b>${esc(place.name)}</b> <a href="#" id="clear-place">clear (use worldwide)</a>` : "Worldwide";
    const c = document.getElementById("clear-place");
    if (c) c.onclick = (e) => { e.preventDefault(); place = null; showPlace(); };
  };
  showPlace();
  autocomplete(document.getElementById("place-q"), document.getElementById("place-results"),
    (q) => api.get(`/api/search/places?q=${encodeURIComponent(q)}`), (p) => esc(p.name),
    (p) => { place = p; document.getElementById("place-q").value = ""; showPlace(); });
  document.getElementById("save").onclick = async () => {
    const body = {
      name: document.getElementById("e-name").value,
      description: document.getElementById("e-desc").value,
      new_per_day: +document.getElementById("e-new").value,
      num_choices: +document.getElementById("e-choices").value,
      hide_dead: document.getElementById("e-hide-dead").checked,
      photo_choice: document.getElementById("e-photos").value,
    };
    if (place && place.id !== d.place_id) Object.assign(body, { place_id: place.id, place_name: place.name });
    if (!place && d.place_id) body.clear_place = true;
    try { d = { ...d, ...(await api.request("PATCH", `/api/decks/${deckId}`, body)) }; toast("Saved."); }
    catch (e) { toast(e.message, true); }
  };

  // ---- adding
  const reload = async () => {
    const fresh = await api.get(`/api/decks/${deckId}`);
    if (!here()) return;
    d.cards = fresh.cards;
    document.getElementById("count").textContent = fresh.num_cards;
    renderRows();
  };
  autocomplete(document.getElementById("taxon-q"), document.getElementById("taxon-results"),
    (q) => api.get(`/api/search/taxa?q=${encodeURIComponent(q)}`),
    (t) => `${t.photo_url ? `<img src="${esc(t.photo_url)}" alt="">` : ""}${taxonLabel(t)} <span class="muted">${esc(t.rank)}</span>`,
    async (t) => {
      if (t.rank !== "species") return toast(`${t.name} is a ${t.rank}, not a species. Pick a species, or build a deck from this group on New deck.`, true);
      try {
        const r = await api.post(`/api/decks/${deckId}/taxa`, { taxon_ids: [t.id] });
        toast(r.added ? `Added ${t.common_name || t.name}.` : `${t.common_name || t.name} is already in this deck.`);
        document.getElementById("taxon-q").value = "";
        reload();
      } catch (e) { toast(e.message, true); }
    });
  document.getElementById("file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await readTextFile(f);
    const box = document.getElementById("paste");
    box.value = (box.value.trim() ? box.value.trim() + "\n" : "") + text.trim();
  });
  document.getElementById("add-names").onclick = async () => {
    const text = document.getElementById("paste").value;
    if (!text.trim()) return toast("Paste some names or load a file first.", true);
    try {
      const r = await api.post(`/api/decks/${deckId}/species`, { species: text });
      document.getElementById("paste").value = "";
      let last = 0;
      await pollJob(r.job_id, (job) => {
        document.getElementById("job-box").innerHTML = jobResultHtml(job);
        if (job.done - last >= 20) { last = job.done; reload(); }
      }, () => alive);
      if (alive) reload();
    } catch (e) { toast(e.message, true); }
  };

  // ---- removing
  let shown = 100;
  function renderRows() {
    const q = document.getElementById("filter").value.trim().toLowerCase();
    const list = d.cards.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.common_name || "").toLowerCase().includes(q));
    document.getElementById("rows").innerHTML = list.slice(0, shown).map((c) => `
      <label class="edit-row">
        <input type="checkbox" data-id="${c.taxon_id}" ${selected.has(c.taxon_id) ? "checked" : ""}>
        ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="" loading="lazy">` : `<span class="noimg-sm"></span>`}
        <span>${taxonLabel(c)}</span>
        <span class="muted small">${c.seen ? `${c.right}/${c.seen} correct` : "new"}</span>
      </label>`).join("") || `<p class="muted">No species.</p>`;
    document.getElementById("more").classList.toggle("hidden", list.length <= shown);
    document.getElementById("rows").querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
      cb.checked ? selected.add(+cb.dataset.id) : selected.delete(+cb.dataset.id);
      updateRemove();
    }));
    return list;
  }
  function updateRemove() {
    const b = document.getElementById("remove");
    b.disabled = !selected.size;
    b.textContent = selected.size ? `Remove ${selected.size} selected` : "Remove selected";
  }
  document.getElementById("filter").addEventListener("input", debounce(() => { shown = 100; renderRows(); }, 150));
  document.getElementById("more").onclick = () => { shown += 200; renderRows(); };
  document.getElementById("select-all").onclick = () => {
    const q = document.getElementById("filter").value.trim().toLowerCase();
    d.cards.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.common_name || "").toLowerCase().includes(q))
      .forEach((c) => selected.add(c.taxon_id));
    renderRows(); updateRemove();
  };
  document.getElementById("select-none").onclick = () => { selected.clear(); renderRows(); updateRemove(); };
  document.getElementById("remove").onclick = async () => {
    if (!confirm(`Remove ${selected.size} species from this deck?`)) return;
    try {
      const r = await api.post(`/api/decks/${deckId}/remove`, { taxon_ids: [...selected] });
      toast(`Removed ${r.removed}.`);
      selected.clear(); updateRemove(); reload();
    } catch (e) { toast(e.message, true); }
  };
  renderRows();

  document.getElementById("delete").onclick = async () => {
    if (!confirm(`Delete “${d.name}” and all its history?`)) return;
    await api.del(`/api/decks/${deckId}`);
    location.hash = "#/";
  };
}
