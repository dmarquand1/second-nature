// Full-screen photo viewer with zoom and pan.
//   Mouse: wheel to zoom (towards the pointer), drag to pan, double-click to zoom in/reset.
//   Touch: pinch to zoom, drag to pan, double-tap to zoom in/reset.
//   Keys:  + / - zoom, 0 reset, ← → previous/next photo, Esc close.
// When you zoom in past 1.5x the original full-resolution photo is loaded.
const Viewer = (() => {
  let el, img, photos = [], index = 0, scale = 1, x = 0, y = 0, onClose = null;
  const pointers = new Map();
  let pinchStart = null, dragStart = null, lastTap = 0, hiRes = new Set();

  function build() {
    el = document.createElement("div");
    el.className = "viewer hidden";
    el.innerHTML = `
      <div class="viewer-stage"><img alt="Zoomed photo" draggable="false"></div>
      <div class="viewer-bar">
        <button data-act="prev" title="Previous photo (←)">‹</button>
        <span class="viewer-count"></span>
        <button data-act="next" title="Next photo (→)">›</button>
        <span class="viewer-sep"></span>
        <button data-act="out" title="Zoom out (-)">−</button>
        <span class="viewer-zoom">100%</span>
        <button data-act="in" title="Zoom in (+)">+</button>
        <button data-act="reset" title="Reset (0)">Fit</button>
        <button data-act="close" title="Close (Esc)">✕</button>
      </div>`;
    document.body.appendChild(el);
    img = el.querySelector("img");
    el.querySelector(".viewer-bar").addEventListener("click", (e) => {
      const act = e.target.dataset.act;
      if (act === "prev") show(index - 1);
      if (act === "next") show(index + 1);
      if (act === "in") zoomAt(1.5);
      if (act === "out") zoomAt(1 / 1.5);
      if (act === "reset") reset();
      if (act === "close") close();
    });
    const stage = el.querySelector(".viewer-stage");
    stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener("dblclick", (e) => (scale > 1.05 ? reset() : zoomAt(2.5, e.clientX, e.clientY)));
    stage.addEventListener("pointerdown", down);
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("click", (e) => { if (e.target === stage && scale <= 1.01) close(); });
    // Capture phase, so the quiz underneath doesn't also react to these keys.
    window.addEventListener("keydown", key, true);
  }

  function apply() {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    el.querySelector(".viewer-zoom").textContent = `${Math.round(scale * 100)}%`;
    if (scale > 1.5) loadOriginal();
  }

  function loadOriginal() {
    const p = photos[index];
    if (!p.original || hiRes.has(index)) return;
    hiRes.add(index);
    const wanted = index;
    const big = new Image();
    big.onload = () => { if (index === wanted) img.src = p.original; };
    big.src = p.original;
  }

  function zoomAt(factor, cx, cy) {
    const rect = el.querySelector(".viewer-stage").getBoundingClientRect();
    cx = cx ?? rect.left + rect.width / 2;
    cy = cy ?? rect.top + rect.height / 2;
    const next = Math.min(Math.max(scale * factor, 1), 10);
    const f = next / scale;
    // keep the point under the cursor in place
    const ox = cx - (rect.left + rect.width / 2), oy = cy - (rect.top + rect.height / 2);
    x = ox - (ox - x) * f;
    y = oy - (oy - y) * f;
    scale = next;
    if (scale === 1) { x = 0; y = 0; }
    apply();
  }

  function reset() { scale = 1; x = 0; y = 0; apply(); }

  function down(e) {
    e.target.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), scale };
      dragStart = null;
    } else {
      dragStart = { px: e.clientX, py: e.clientY, x, y };
      if (e.pointerType === "touch") {
        const now = Date.now();
        if (now - lastTap < 300) (scale > 1.05 ? reset() : zoomAt(2.5, e.clientX, e.clientY));
        lastTap = now;
      }
    }
  }

  function move(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchStart && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((pinchStart.scale * d / pinchStart.d) / scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (dragStart && scale > 1) {
      x = dragStart.x + e.clientX - dragStart.px;
      y = dragStart.y + e.clientY - dragStart.py;
      apply();
    }
  }

  function up(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) dragStart = null;
  }

  function key(e) {
    if (!isOpen()) return;
    const handled = { Escape: close, ArrowLeft: () => show(index - 1), ArrowRight: () => show(index + 1),
      "+": () => zoomAt(1.5), "=": () => zoomAt(1.5), "-": () => zoomAt(1 / 1.5), "0": reset, z: close, Z: close }[e.key];
    if (handled) { e.preventDefault(); e.stopPropagation(); handled(); }
    else e.stopPropagation();   // don't let number keys answer the quiz behind the viewer
  }

  function show(i) {
    index = (i + photos.length) % photos.length;
    img.src = photos[index].url;
    el.querySelector(".viewer-count").textContent = `${index + 1} / ${photos.length}`;
    el.querySelectorAll("[data-act=prev],[data-act=next]").forEach((b) => (b.style.visibility = photos.length > 1 ? "" : "hidden"));
    reset();
  }

  function open(list, start = 0, closed = null) {
    if (!el) build();
    photos = list; hiRes = new Set(); onClose = closed;
    el.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    show(start);
  }

  function close() {
    el.classList.add("hidden");
    document.body.classList.remove("no-scroll");
    if (onClose) onClose(index);
  }

  const isOpen = () => el && !el.classList.contains("hidden");
  return { open, close, isOpen };
})();
