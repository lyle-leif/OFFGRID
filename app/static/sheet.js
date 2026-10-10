// Phone bottom sheet: the side panel slides up from the bottom of a full-screen map.
// Three heights: "peek" (handle + tabs), "half" and "full". Drag the handle or the tab bar;
// a quick flick goes to the next height in that direction. Heights are set in CSS
// (a transition on `height`), so the panel content is always laid out for what is visible
// and the chat box never ends up below the screen.

const PEEK_PX = 112; // keep in step with --sheet-peek in styles.css
const ORDER = ["peek", "half", "full"];
const FLICK = 0.5; // px per ms
const TAP_PX = 6; // a smaller move is a tap, not a drag

export function createSheet({ el, container, dragAreas, onChange }) {
  // The app always opens with the sheet down (the map first). Testing tools can pick another
  // start with localStorage "bb.sheet.start"; the old saved height ("bb.sheet") is dropped.
  let state = "peek";
  try {
    localStorage.removeItem("bb.sheet");
    const start = localStorage.getItem("bb.sheet.start");
    if (ORDER.includes(start)) state = start;
  } catch { /* no storage */ }
  // No height animation for the first layout: the sheet is simply there when the app shows.
  el.classList.add("dragging");
  setTimeout(() => { if (!drag) el.classList.remove("dragging"); }, 100);

  const heights = () => {
    const h = container.clientHeight || window.innerHeight;
    return { peek: PEEK_PX, half: Math.round(h * 0.5), full: h - 8 };
  };

  function apply() {
    const px = heights()[state];
    el.style.setProperty("--sheet-h", `${px}px`);
    el.classList.toggle("peek", state === "peek");
    onChange?.(state, px);
  }

  function set(next) {
    if (!ORDER.includes(next)) return;
    state = next;
    apply();
  }

  // ---- dragging ----
  let drag = null; // { y0, h0, t, lastY, lastT, moved }
  function down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { y0: e.clientY, h0: el.getBoundingClientRect().height, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false, target: e.currentTarget, id: e.pointerId };
    // Follow the pointer anywhere on the page, not only over the handle.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) < TAP_PX) return;
      drag.moved = true;
      el.classList.add("dragging");
      window.getSelection?.().removeAllRanges(); // a mouse drag would otherwise select text
      el.classList.remove("peek");
    }
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.v = (e.clientY - drag.lastY) / dt; // + is downward
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    const hs = heights();
    const h = Math.min(hs.full, Math.max(hs.peek, drag.h0 - dy));
    el.style.setProperty("--sheet-h", `${h}px`);
  }
  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (!d.moved) return; // a tap: let the click through (tabs, handle)
    el.classList.remove("dragging");
    const h = el.getBoundingClientRect().height;
    const hs = heights();
    let next;
    if (Math.abs(d.v) > FLICK) {
      // Flick: one step in the direction of the swipe.
      const i = ORDER.indexOf(nearest(h, hs));
      const cur = ORDER.indexOf(state);
      next = ORDER[Math.max(0, Math.min(2, d.v < 0 ? Math.max(i, cur + 1) : Math.min(i, cur - 1)))];
    } else {
      next = nearest(h, hs);
    }
    // Swallow the click that follows a drag that started on a tab.
    const block = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    d.target.addEventListener("click", block, { capture: true, once: true });
    setTimeout(() => d.target.removeEventListener("click", block, { capture: true }), 0);
    set(next);
  }
  const nearest = (h, hs) => ORDER.reduce((a, b) => (Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a));

  for (const area of dragAreas) area.addEventListener("pointerdown", down);
  // Tapping the handle cycles peek -> half -> full -> peek; keyboard too.
  const handle = dragAreas[0];
  handle.addEventListener("click", () => set(ORDER[(ORDER.indexOf(state) + 1) % 3]));
  handle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(ORDER[(ORDER.indexOf(state) + 1) % 3]); }
    if (e.key === "ArrowUp") set(ORDER[Math.min(2, ORDER.indexOf(state) + 1)]);
    if (e.key === "ArrowDown") set(ORDER[Math.max(0, ORDER.indexOf(state) - 1)]);
  });
  window.addEventListener("resize", () => apply());

  return {
    set,
    get: () => state,
    apply,
    // Show at least `min` (e.g. "half"), never shrink.
    atLeast(min) { if (ORDER.indexOf(state) < ORDER.indexOf(min)) set(min); },
  };
}
