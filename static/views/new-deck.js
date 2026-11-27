// Create a deck from a species list, a taxon, or a place.
function NewDeckView() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <h1>New deck</h1>
    <form id="deck-form" class="card form">
      <label>Deck name <input name="name" required placeholder="e.g. UK thrushes"></label>

      <fieldset class="tabs">
        <legend>Build it from</legend>
        <label><input type="radio" name="source_type" value="list" checked> A species list</label>
        <label><input type="radio" name="source_type" value="taxon"> A group (taxon)</label>
        <label><input type="radio" name="source_type" value="place"> Common species in a place</label>
      </fieldset>

      <div data-for="list">
        <label>Species, one per line (scientific or common names, or iNat taxon ids)
          <textarea name="species" rows="8" placeholder="Turdus merula&#10;Song Thrush&#10;Turdus viscivorus"></textarea>
        </label>
        <label class="file-label">…or load a .txt / .csv file (first column is used)
          <input type="file" id="species-file" accept=".txt,.csv,text/plain,text/csv">
        </label>
        <p class="muted small" id="name-count"></p>
      </div>

      <div data-for="taxon place">
        <label><span data-for="taxon">Group</span><span data-for="place">Only this group (optional)</span>
          <input id="taxon-q" autocomplete="off" placeholder="Search, e.g. Turdus, Fungi, Odonata">
          <ul id="taxon-results" class="ac"></ul>
        </label>
        <div id="taxon-picked" class="picked muted"></div>
      </div>

      <div>
        <label><span data-for="place">Place</span><span data-for="list taxon">Focus on a place (optional, photos and distractors come from here)</span>
          <input id="place-q" autocomplete="off" placeholder="Search, e.g. United Kingdom, Yosemite">
          <ul id="place-results" class="ac"></ul>
        </label>
        <div id="place-picked" class="picked muted"></div>
      </div>

      <div class="row wrap">
        <label data-for="taxon place">Number of species
          <input type="number" name="limit" value="30" min="2" max="5000">
        </label>
        <label>New species per day
          <input type="number" name="new_per_day" value="20" min="0" max="500">
        </label>
        <label>Choices per question
          <select name="num_choices"><option>4</option><option selected>5</option><option>6</option></select>
        </label>
        <label>Which photos
          <select name="photo_choice">
            <option value="mixed" selected>Mixed: well-liked photos more often</option>
            <option value="best">Best first: most-favourited photos first</option>
            <option value="any">Any: favourites make no difference</option>
          </select>
        </label>
        <label>Wrong answers from
          <select name="answer_source">
            <option value="anywhere" selected>Lookalikes from anywhere</option>
            <option value="mostly_deck">Mostly this deck (lookalikes only if it runs short)</option>
            <option value="deck">Only this deck (small decks show fewer choices)</option>
          </select>
        </label>
      </div>
      <label class="check"><input type="checkbox" name="hide_dead" checked>
        Hide photos of dead organisms (observations that iNaturalist users tagged "Dead")</label>

      <button class="btn primary" type="submit">Create deck</button>
      <p id="form-status" class="muted"></p>
    </form>`;

  const form = document.getElementById("deck-form");
  let taxon = null, place = null;

  function showFor() {
    const type = form.source_type.value;
    form.querySelectorAll("[data-for]").forEach((el) => {
      el.style.display = el.dataset.for.split(" ").includes(type) ? "" : "none";
    });
  }
  form.querySelectorAll("[name=source_type]").forEach((r) => r.addEventListener("change", showFor));
  showFor();

  const countNames = () => {
    const n = form.species.value.split("\n").map((x) => x.trim()).filter(Boolean).length;
    document.getElementById("name-count").textContent = n
      ? `${n} names. Looking them up takes about ${n > 60 ? Math.ceil(n / 60) + " min" : n + " s"} in the background (cards appear as they're found).`
      : "";
  };
  form.species.addEventListener("input", countNames);
  document.getElementById("species-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await readTextFile(file);
    form.species.value = (form.species.value.trim() ? form.species.value.trim() + "\n" : "") + text.trim();
    if (!form.name.value) form.name.value = file.name.replace(/\.[^.]+$/, "");
    countNames();
  });

  autocomplete(document.getElementById("taxon-q"), document.getElementById("taxon-results"),
    (q) => api.get(`/api/search/taxa?q=${encodeURIComponent(q)}`),
    (t) => `${t.photo_url ? `<img src="${esc(t.photo_url)}" alt="">` : ""}${taxonLabel(t)} <span class="muted">${esc(t.rank)}</span>`,
    (t) => {
      taxon = t;
      document.getElementById("taxon-q").value = "";
      document.getElementById("taxon-picked").innerHTML = `Chosen: ${taxonLabel(t)} (${esc(t.rank)}) <a href="#" id="clear-taxon">clear</a>`;
      document.getElementById("clear-taxon").onclick = (e) => { e.preventDefault(); taxon = null; document.getElementById("taxon-picked").innerHTML = ""; };
      if (!form.name.value) form.name.value = t.common_name || t.name;
    });

  autocomplete(document.getElementById("place-q"), document.getElementById("place-results"),
    (q) => api.get(`/api/search/places?q=${encodeURIComponent(q)}`),
    (p) => esc(p.name),
    (p) => {
      place = p;
      document.getElementById("place-q").value = "";
      document.getElementById("place-picked").innerHTML = `Chosen: ${esc(p.name)} <a href="#" id="clear-place">clear</a>`;
      document.getElementById("clear-place").onclick = (e) => { e.preventDefault(); place = null; document.getElementById("place-picked").innerHTML = ""; };
    });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = form.source_type.value;
    const body = {
      name: form.name.value,
      source_type: type,
      limit: +form.limit.value,
      num_choices: +form.num_choices.value,
      new_per_day: +form.new_per_day.value,
      hide_dead: form.hide_dead.checked,
      photo_choice: form.photo_choice.value,
      answer_source: form.answer_source.value,
    };
    if (type === "list") body.species = form.species.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (taxon && type !== "list") { body.taxon_id = taxon.id; body.taxon_name = taxon.common_name || taxon.name; }
    if (place) { body.place_id = place.id; body.place_name = place.name; }
    if (type === "taxon" && !taxon) return toast("Pick a group first.", true);
    if (type === "place" && !place) return toast("Pick a place first.", true);
    if (type === "list" && !body.species.length) return toast("Add at least one species.", true);

    const status = document.getElementById("form-status");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    status.textContent = "Creating deck…";
    try {
      const deck = await api.post("/api/decks", body);
      location.hash = `#/deck/${deck.id}`;   // the deck page shows progress while species are found
    } catch (err) {
      toast(err.message, true);
      status.textContent = "";
    } finally { btn.disabled = false; }
  });
}
