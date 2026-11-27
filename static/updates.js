// "What's new" page: tells players about new features (local app and website).
//
// Add an entry at the top of UPDATES for each version with something players
// would notice. The "What's new" link shows a dot until the player has seen the
// newest entry (remembered in this browser only).
const UPDATES = [
  {
    version: "0.4.6", date: "27 November 2026", items: [
      "<b>New species order</b>: choose the order new species are introduced in each deck, such as common or rare species first, relatives of the ones you find hardest or know best, one group at a time, or variety first. Find it under <b>Edit</b> on any deck.",
      "This <b>What's new</b> page, so you can see what has changed.",
    ],
  },
  {
    version: "0.4.5", date: "27 November 2026", items: [
      "<b>Wrong answers from</b>: keep the wrong answers to species in your deck (<b>Only this deck</b> or <b>Mostly this deck</b>), or keep the default of lookalikes from anywhere.",
    ],
  },
  {
    version: "0.4.4", date: "27 November 2026", items: [
      "A short <b>welcome tour</b> for new players. See it again from the <b>?</b> help.",
    ],
  },
  {
    version: "0.4.3", date: "27 November 2026", items: [
      "The website saves much less in your browser, and keeps all your progress. <b>Settings → Free up space</b> clears saved photo lists and results whenever you like.",
    ],
  },
  {
    version: "0.4.2", date: "27 November 2026", items: [
      "<b>Which photos</b>: show the photos the iNaturalist community likes most more often, or first.",
    ],
  },
  {
    version: "0.4.1", date: "27 November 2026", items: [
      "Photos of dead organisms are hidden by default. Change it under <b>Edit</b> on any deck.",
    ],
  },
  {
    version: "0.4.0", date: "27 November 2026", items: [
      "Second Nature is on the web: no installing, and your progress is saved in your browser (back it up from <b>Settings</b>).",
    ],
  },
];

const Updates = (() => {
  const KEY = "sn.updatesSeen";
  const latest = () => UPDATES[0].version;
  function seen() { try { return localStorage.getItem(KEY) === latest(); } catch { return true; } }
  function markSeen() { try { localStorage.setItem(KEY, latest()); } catch {} refreshDot(); }
  function refreshDot() {
    const a = document.getElementById("nav-updates");
    if (a) a.classList.toggle("has-news", !seen());
  }
  return { seen, markSeen, refreshDot, KEY };
})();

function UpdatesView() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <h1>What's new</h1>
    ${UPDATES.map((u) => `
      <section class="card update">
        <h2>Version ${esc(u.version)} <span class="muted small">${esc(u.date)}</span></h2>
        <ul>${u.items.map((i) => `<li>${i}</li>`).join("")}</ul>
      </section>`).join("")}`;
  Updates.markSeen();
}
