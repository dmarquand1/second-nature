// Hash router: #/  #/new  #/deck/3  #/quiz/3
const routes = [
  [/^#?\/?$/, () => DecksView()],
  [/^#\/new$/, () => NewDeckView()],
  [/^#\/deck\/(\d+)$/, (m) => DeckDetailView(+m[1])],
  [/^#\/quiz\/(\d+)$/, (m) => QuizView(+m[1])],
];

function route() {
  const app = document.getElementById("app");
  if (window.currentCleanup) { window.currentCleanup(); window.currentCleanup = null; }
  const hash = location.hash || "#/";
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) { app.innerHTML = ""; view(m); return; }
  }
  app.innerHTML = "<p>Page not found.</p>";
}

window.addEventListener("hashchange", route);
route();
