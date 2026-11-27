// One deck: its species, with add/remove.
async function DeckDetailView(deckId) {
  const app = document.getElementById("app");
  app.innerHTML = "Loading…";
  let d;
  try { d = await api.get(`/api/decks/${deckId}`); } catch (e) { app.innerHTML = ""; toast(e.message, true); return; }
  app.innerHTML = `
    <div class="row between">
      <div><h1>${esc(d.name)}</h1><p class="muted">${d.num_cards} species · ${esc(sourceLabel(d))} · ${d.num_choices} choices per question</p></div>
      <a class="btn primary big" href="#/quiz/${d.id}">Study this deck</a>
    </div>
    <details class="card">
      <summary>Add species</summary>
      <textarea id="add-species" rows="4" placeholder="One name per line"></textarea>
      <button class="btn" id="add-btn">Add</button>
    </details>
    <div class="grid species">
      ${d.cards.map((c) => `
        <div class="card sp">
          ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}
          <div>${taxonLabel(c)}</div>
          <div class="muted small">${c.seen ? `${c.right}/${c.seen} correct` : "not seen yet"}</div>
          <div class="row small">
            <a href="https://www.inaturalist.org/taxa/${c.taxon_id}" target="_blank" rel="noopener">iNat</a>
            <a href="#" data-rm="${c.taxon_id}">remove</a>
          </div>
        </div>`).join("")}
    </div>`;
  app.querySelectorAll("[data-rm]").forEach((a) => a.addEventListener("click", async (e) => {
    e.preventDefault();
    await api.del(`/api/decks/${deckId}/species/${a.dataset.rm}`);
    DeckDetailView(deckId);
  }));
  document.getElementById("add-btn").addEventListener("click", async () => {
    const names = document.getElementById("add-species").value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    toast(`Looking up ${names.length} names…`);
    try {
      const r = await api.post(`/api/decks/${deckId}/species`, { species: names });
      toast(`Added ${r.added}.` + (r.unmatched.length ? ` Not found: ${r.unmatched.join(", ")}` : ""), !!r.unmatched.length);
      DeckDetailView(deckId);
    } catch (e) { toast(e.message, true); }
  });
}
