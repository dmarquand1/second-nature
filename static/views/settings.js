// Settings page (website version only): backup and restore your progress,
// photo licences, and how much this browser is storing.
async function SettingsView() {
  const app = document.getElementById("app");
  const here = stillHere();
  await IQ.ready;
  if (!here()) return;
  const n = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const summary = [n(IQ.store.all("decks").length, "deck"), n(IQ.store.all("cards").length, "species card"),
                   n(IQ.store.all("reviews").length, "answer")].join(", ");
  app.innerHTML = `
    <h1>Settings</h1>
    <section class="card">
      <h2>Your progress</h2>
      <p>Everything you do here (${summary}) is saved
        <b>in this browser on this computer only</b>. There is no account and nothing is sent anywhere except the
        searches to iNaturalist. Download a backup now and then, and use it to move your progress to another
        computer or browser.</p>
      <div class="row wrap">
        <button class="btn primary" id="backup">Download backup</button>
        <label class="btn">Restore from a backup… <input type="file" id="restore" accept=".json,application/json" hidden></label>
      </div>
      <p class="muted small">Restoring replaces everything in this browser with what's in the file.</p>
      <p class="muted small" id="persist-note">${IQ.persisted
        ? "This browser has agreed to keep your progress permanently (it won't clear it to save space)."
        : "This browser may clear saved data if space runs low or you don't visit for a while (Safari: 7 days), so keep a backup."}</p>
    </section>

    <section class="card">
      <h2>Photos</h2>
      <p class="small">Only photos that their photographers have released under a Creative Commons licence or into
        the public domain are shown. They load straight from iNaturalist (nothing is copied), with the photographer and
        licence under each photo and a link to the original observation after you answer.</p>
    </section>

    <section class="card">
      <h2>Storage</h2>
      <p id="usage" class="muted">Checking…</p>
      <p class="muted small">Requests to iNaturalist from this browser today: ${IQ.inat.requestsToday()}
        (kept under ${IQ.config.DAILY_REQUEST_LIMIT.toLocaleString()} a day, at most one a second).</p>
      <p class="small">To stay light, this site saves only your decks, species and answers, plus a small, short-lived
        copy of recent iNaturalist results so the quiz loads quickly. Old copies are deleted automatically.</p>
      <div class="row wrap">
        <button class="btn" id="free">Free up space (keeps your progress)</button>
        <button class="btn danger" id="wipe">Delete everything in this browser</button>
      </div>
      <p class="muted small">Freeing up space deletes the saved iNaturalist results and photo lists. Your decks, species
        and progress stay. The next few questions may take a moment longer while photos are fetched again.</p>
    </section>

    <section class="card" id="privacy">
      <h2>Privacy</h2>
      <p class="small">This site has no accounts, no cookies, no analytics and no adverts. Your decks and answers
        are stored only in this browser. To work, your browser connects directly to these services, which see your
        IP address like any website you visit:</p>
      <ul class="small">
        <li><b>GitHub Pages</b>, which hosts this site</li>
        <li><b>iNaturalist</b> (api.inaturalist.org): species names and observations you search or study
          (<a href="https://www.inaturalist.org/pages/privacy" target="_blank" rel="noopener">privacy policy</a>)</li>
        <li><b>Amazon Web Services</b>, where iNaturalist keeps its open-licence photos</li>
        <li><b>OpenStreetMap</b>, for the map tiles
          (<a href="https://osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noopener">privacy policy</a>)</li>
        <li><b>cdnjs (Cloudflare)</b>, which serves the map code (Leaflet)</li>
      </ul>
    </section>

    <section class="card">
      <h2>About</h2>
      <p class="muted small">Second Nature ${esc(IQ.VERSION)}, a free, non-commercial personal project. It is not made,
        endorsed or supported by <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>.
        Photos, names and observations come from iNaturalist and its community; each photo belongs to its
        photographer and is used under the licence shown with it. Identifications come from the iNaturalist community
        and are occasionally wrong. Because your browser uses iNaturalist's service directly, their
        <a href="https://www.inaturalist.org/pages/terms" target="_blank" rel="noopener">terms</a> ask that under-13s
        have a parent's permission. Maps &copy;
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.</p>
    </section>`;

  const showUsage = () => IQ.store.usageMb().then((mb) => {
    if (here()) document.getElementById("usage").textContent =
      mb == null ? "This browser doesn't say how much it's storing." : `About ${mb} MB stored by this site in this browser.`;
  });
  showUsage();

  document.getElementById("free").onclick = async () => {
    await IQ.jobs.waitIdle();
    await IQ.store.freeUpSpace();
    toast("Space freed up. Your progress is kept.");
    showUsage();
  };

  document.getElementById("backup").onclick = () => {
    const blob = new Blob([JSON.stringify(IQ.store.exportData())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `second-nature-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Backup downloaded.");
  };

  document.getElementById("restore").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await readTextFile(file));
      if (!confirm("Replace everything in this browser with this backup?")) return;
      await IQ.store.importData(data);
      toast("Backup restored.");
      location.hash = "#/";
    } catch (err) { toast(err instanceof SyntaxError ? "That file isn't an Second Nature backup." : err.message, true); }
  };

  document.getElementById("wipe").onclick = async () => {
    if (!confirm("Delete all decks, progress and saved data in this browser? Download a backup first if you might want it.")) return;
    await IQ.store.wipe();
    toast("Everything deleted.");
    location.hash = "#/";
  };
}
