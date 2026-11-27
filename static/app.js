// Hash router: #/  #/new  #/deck/3  #/deck/3/edit  #/quiz/3  #/stats  #/stats/3  #/settings
const routes = [
  [/^#?\/?$/, () => DecksView()],
  [/^#\/new$/, () => NewDeckView()],
  [/^#\/deck\/(\d+)$/, (m) => DeckDetailView(+m[1])],
  [/^#\/deck\/(\d+)\/edit$/, (m) => EditDeckView(+m[1])],
  [/^#\/quiz\/(\d+)$/, (m) => QuizView(+m[1])],
  [/^#\/stats(?:\/(\d+))?$/, (m) => StatsView(m[1] ? +m[1] : null)],
  // Website version only (web/index.html loads views/settings.js).
  [/^#\/settings$/, () => (typeof SettingsView === "function" ? SettingsView() : DecksView())],
];

// Each page visit gets a number, so a page whose data arrives after you've
// already moved on doesn't draw over the new page (see stillHere()).
window.routeToken = 0;

function route() {
  window.routeToken++;
  const app = document.getElementById("app");
  if (window.currentCleanup) { window.currentCleanup(); window.currentCleanup = null; }
  const hash = location.hash || "#/";
  document.querySelectorAll(".topbar nav a").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") !== "#" && (hash === a.getAttribute("href") ||
      (a.getAttribute("href") === "#/stats" && hash.startsWith("#/stats")))));
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) { app.innerHTML = ""; view(m); window.scrollTo(0, 0); return; }
  }
  app.innerHTML = "<p>Page not found.</p>";
}

document.getElementById("nav-help").addEventListener("click", (e) => { e.preventDefault(); Shortcuts.toggle(); });
window.addEventListener("hashchange", route);
route();
