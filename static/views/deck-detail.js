// One deck: its species, with add/remove.
async function DeckDetailView(deckId) {
  const app = document.getElementById("app");
  app.innerHTML = "Loading…";
  let d;
  try { d = await api.get(`/api/decks/${deckId}`); } catch (e) { app.innerHTML = ""; toast(e.message, true); return; }
  app.innerHTML = `
    <div class="row between">
      <div><h1>${esc(d.name)}</h1><p class="muted">${d.num_cards} species · ${esc(sourceLabel(d))}</p>
        <p class="queue-line"><span class="pill due">${d.queue.due} due</span> <span class="pill new">${d.queue.new_available} new today</span>
          ${d.queue.next_due && !d.queue.due ? `<span class="muted small">next review ${esc(relativeTime(d.queue.next_due))}</span>` : ""}</p></div>
      <a class="btn primary big" href="#/quiz/${d.id}">Study this deck</a>
    </div>
    <details class="card">
      <summary>Settings</summary>
      <div class="row wrap settings">
        <label>Name <input id="set-name" value="${esc(d.name)}"></label>
        <label>New species per day <input id="set-new" type="number" min="0" max="500" value="${d.new_per_day}"></label>
        <label>Choices per question
          <select id="set-choices">${[4, 5, 6].map((n) => `<option ${n === d.num_choices ? "selected" : ""}>${n}</option>`).join("")}</select>
        </label>
        <button class="btn" id="save-settings">Save</button>
      </div>
    </details>
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
          <div class="muted small">${c.seen ? `${c.right}/${c.seen} correct · ${esc(dueLabel(c))}` : "new"}</div>
          <div class="row small">
            <a href="https://www.inaturalist.org/taxa/${c.taxon_id}" target="_blank" rel="noopener">iNat</a>
            <a href="#" data-rm="${c.taxon_id}">remove</a>
          </div>
        </div>`).join("")}
    </div>`;
  document.getElementById("save-settings").addEventListener("click", async () => {
    try {
      await api.request("PATCH", `/api/decks/${deckId}`, {
        name: document.getElementById("set-name").value,
        new_per_day: +document.getElementById("set-new").value,
        num_choices: +document.getElementById("set-choices").value,
      });
      toast("Saved.");
      DeckDetailView(deckId);
    } catch (e) { toast(e.message, true); }
  });
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

function dueLabel(c) {
  if (c.state === 0 || !c.due) return "new";
  const s = c.due - Date.now() / 1000;
  return s <= 0 ? "due now" : `due ${relativeTime(c.due)}`;
}
