// "?" shows the keyboard shortcuts.
const Shortcuts = (() => {
  let el;
  const LIST = [
    ["Quiz", [["1 – 6", "Choose an answer"], ["Z", "Zoom into the photo"], ["← →", "Previous / next photo"]]],
    ["After answering", [["Enter or Space", "Accept the suggested rating, next question"],
      ["1 2 3 4", "Rate Again / Hard / Good / Easy, next question"]]],
    ["Photo viewer", [["Scroll or pinch", "Zoom"], ["Drag", "Move around"], ["Double-click", "Zoom in / fit"],
      ["+ − 0", "Zoom in / out / fit"], ["Esc", "Close"]]],
    ["Anywhere", [["?", "Show or hide this help"], ["G then D", "Go to decks"], ["G then S", "Go to stats"]]],
  ];
  function toggle() {
    if (!el) {
      el = document.createElement("div");
      el.className = "modal hidden";
      el.innerHTML = `<div class="card modal-box"><div class="row between"><h2>Keyboard shortcuts</h2>
        <div class="row"><button class="btn" data-tour>Show the tour</button><button class="btn" data-close>Close</button></div></div>
        ${LIST.map(([h, rows]) => `<h3>${h}</h3><table class="keys">${rows.map(([k, d]) =>
          `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("")}</table>`).join("")}</div>`;
      el.addEventListener("click", (e) => {
        if (e.target.dataset.tour !== undefined) { toggle(); Tutorial.start(); return; }
        if (e.target === el || e.target.dataset.close !== undefined) toggle();
      });
      document.body.appendChild(el);
    }
    el.classList.toggle("hidden");
  }
  let lastG = 0;
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || (typeof Viewer !== "undefined" && Viewer.isOpen())) return;
    if (typeof Tutorial !== "undefined" && Tutorial.isOpen()) return;
    if (e.key === "?") { e.preventDefault(); toggle(); return; }
    if (e.key === "Escape" && el && !el.classList.contains("hidden")) { toggle(); return; }
    if (e.key === "g") { lastG = Date.now(); return; }
    if (Date.now() - lastG < 1000) {
      if (e.key === "d") location.hash = "#/";
      if (e.key === "s") location.hash = "#/stats";
      lastG = 0;
    }
  });
  return { toggle };
})();
