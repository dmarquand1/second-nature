// Home page: list of decks.
async function DecksView() {
  const app = document.getElementById("app");
  app.innerHTML = `<h1>Your decks</h1><div id="deck-list" class="grid">Loading…</div>`;
  const here = stillHere();
  let decks;
  try { decks = await api.get("/api/decks"); } catch (e) { toast(e.message, true); return; }
  if (!here()) return;
  const list = document.getElementById("deck-list");
  if (!decks.length) {
    list.innerHTML = `<div class="empty">No decks yet. <a href="#/new" class="btn primary">Create your first deck</a>
      <p class="small"><a href="#" id="start-tour">New here? Take the quick tour</a></p></div>`;
    document.getElementById("start-tour").onclick = (e) => { e.preventDefault(); Tutorial.start(); };
    if (typeof Tutorial !== "undefined") Tutorial.maybeStart(false);
    return;
  }
  list.innerHTML = decks.map((d) => `
    <div class="card deck">
      <h2>${esc(d.name)}</h2>
      <p class="muted">${d.num_cards} species · ${esc(sourceLabel(d))}${d.building ? ` · <span class="pill">finding species…</span>` : ""}</p>
      <p class="queue-line"><span class="pill due">${d.queue.due} due</span> <span class="pill new">${d.queue.new_available} new</span></p>
      <p class="muted">${d.num_reviews ? `${d.num_reviews} answers · ${Math.round(d.accuracy * 100)}% correct` : "Not studied yet"}</p>
      <div class="row">
        <a class="btn primary" href="#/quiz/${d.id}">${d.queue.due + d.queue.new_available ? "Study" : "Practice"}</a>
        <a class="btn" href="#/deck/${d.id}">Species</a>
        <a class="btn" href="#/deck/${d.id}/edit">Edit</a>
      </div>
    </div>`).join("");
}

function sourceLabel(d) {
  const p = d.source_params || {};
  if (d.source_type === "list") return "from a species list";
  if (d.source_type === "taxon") return `top species in ${p.taxon_name || "taxon " + p.taxon_id}` + (d.place_name ? ` in ${d.place_name}` : "");
  if (d.source_type === "place") return `common ${p.taxon_name ? p.taxon_name + " " : "species "}in ${d.place_name || "a place"}`;
  return d.source_type;
}
