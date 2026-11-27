// Home page: list of decks.
async function DecksView() {
  const app = document.getElementById("app");
  app.innerHTML = `<h1>Your decks</h1><div id="deck-list" class="grid">Loading…</div>`;
  let decks;
  try { decks = await api.get("/api/decks"); } catch (e) { toast(e.message, true); return; }
  const list = document.getElementById("deck-list");
  if (!decks.length) {
    list.innerHTML = `<div class="empty">No decks yet. <a href="#/new" class="btn">Create your first deck</a></div>`;
    return;
  }
  list.innerHTML = decks.map((d) => `
    <div class="card deck">
      <h2>${esc(d.name)}</h2>
      <p class="muted">${d.num_cards} species · ${esc(sourceLabel(d))}</p>
      <p class="queue-line"><span class="pill due">${d.queue.due} due</span> <span class="pill new">${d.queue.new_available} new</span></p>
      <p class="muted">${d.num_reviews ? `${d.num_reviews} answers · ${Math.round(d.accuracy * 100)}% correct` : "Not studied yet"}</p>
      <div class="row">
        <a class="btn primary" href="#/quiz/${d.id}">${d.queue.due + d.queue.new_available ? "Study" : "Practice"}</a>
        <a class="btn" href="#/deck/${d.id}">Species</a>
        <button class="btn danger" data-del="${d.id}">Delete</button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this deck and its history?")) return;
    await api.del(`/api/decks/${b.dataset.del}`);
    DecksView();
  }));
}

function sourceLabel(d) {
  const p = d.source_params || {};
  if (d.source_type === "list") return "from a species list" + (d.place_name ? `, photos from ${d.place_name}` : "");
  if (d.source_type === "taxon") return `top species in ${p.taxon_name || "taxon " + p.taxon_id}` + (d.place_name ? ` in ${d.place_name}` : "");
  if (d.source_type === "place") return `common ${p.taxon_name ? p.taxon_name + " " : "species "}in ${d.place_name || "a place"}`;
  return d.source_type;
}
