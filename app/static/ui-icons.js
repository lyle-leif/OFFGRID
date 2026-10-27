// OFFGRID's UI icon set: simple line icons drawn here (24×24, 2px stroke, currentColor),
// so they look the same on every device, follow the text colour in light and dark mode,
// and need no icon font or download. Replaces the emoji the UI used before.

const SVG_NS = "http://www.w3.org/2000/svg";

// Each icon is a list of [tag, attributes]. Shapes are stroked unless they set fill.
const ICONS = {
  pin: [
    ["path", { d: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" }],
    ["circle", { cx: 12, cy: 10, r: 2.2 }],
  ],
  gps: [
    ["circle", { cx: 12, cy: 12, r: 7 }],
    ["circle", { cx: 12, cy: 12, r: 2.2, fill: "currentColor", stroke: "none" }],
    ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }],
  ],
  moon: [["path", { d: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" }]],
  sun: [
    ["circle", { cx: 12, cy: 12, r: 4 }],
    ["path", { d: "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" }],
  ],
  walk: [
    ["circle", { cx: 13.5, cy: 4.5, r: 1.8, fill: "currentColor", stroke: "none" }],
    ["path", { d: "M12.5 8.5 11 14l3 2.6.9 4.4M11 14l-2 7M12.5 8.5l3 2.8h2.7M12.5 8.5 9.3 10.4 8.5 13" }],
  ],
  car: [
    ["path", { d: "M4 16v-3.6L6.6 7h10.8l2.6 5.4V16M3.5 16h17M6.5 12.4h11" }],
    ["circle", { cx: 7.5, cy: 17, r: 1.6 }],
    ["circle", { cx: 16.5, cy: 17, r: 1.6 }],
  ],
  doc: [["path", { d: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" }]],
  signal: [
    ["circle", { cx: 12, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }],
    ["path", { d: "M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" }],
  ],
  ruler: [["path", { d: "M3 16.5 16.5 3 21 7.5 7.5 21zM7 12.5l2 2M10 9.5l1.5 1.5M13 6.5l2 2" }]],
  check: [
    ["circle", { cx: 12, cy: 12, r: 9 }],
    ["path", { d: "m8 12.4 2.8 2.8L16.2 9.6" }],
  ],
  warning: [
    ["path", { d: "M12 3.5 21.5 20h-19zM12 10v4.5" }],
    ["circle", { cx: 12, cy: 17.4, r: 0.9, fill: "currentColor", stroke: "none" }],
  ],
  close: [["path", { d: "M6 6l12 12M18 6 6 18" }]],
  gear: [
    ["path", { d: "M10.4 5.0L10.7 2.5L13.3 2.5L13.6 5.0L15.8 5.9L17.8 4.3L19.7 6.2L18.1 8.2L19.0 10.4L21.5 10.7L21.5 13.3L19.0 13.6L18.1 15.8L19.7 17.8L17.8 19.7L15.8 18.1L13.6 19.0L13.3 21.5L10.7 21.5L10.4 19.0L8.2 18.1L6.2 19.7L4.3 17.8L5.9 15.8L5.0 13.6L2.5 13.3L2.5 10.7L5.0 10.4L5.9 8.2L4.3 6.2L6.2 4.3L8.2 5.9z" }],
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
  "chevron-left": [["path", { d: "m15 6-6 6 6 6" }]],
  "chevron-right": [["path", { d: "m9 6 6 6-6 6" }]],
  "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
  "chevron-up": [["path", { d: "m6 15 6-6 6 6" }]],
  layers: [["path", { d: "M12 3.5 21 8.5l-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5" }]],
  phone: [["path", { d: "M5.2 3.8h3.6l1.9 4.6-2.4 1.5a10.6 10.6 0 0 0 5.8 5.8l1.5-2.4 4.6 1.9v3.6a1.2 1.2 0 0 1-1.2 1.2A16.4 16.4 0 0 1 4 5a1.2 1.2 0 0 1 1.2-1.2z" }]],
  battery: [
    ["rect", { x: 2.5, y: 7, width: 17, height: 10, rx: 2 }],
    ["path", { d: "M22 10.5v3M6 10v4" }],
  ],
  sparkle: [["path", { d: "M12 3.5 13.8 9.2 19.5 11l-5.7 1.8L12 18.5l-1.8-5.7L4.5 11l5.7-1.8zM19 3v3M17.5 4.5h3" }]],
  chat: [["path", { d: "M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5zM7.5 10h9M7.5 13.5h6" }]],
  list: [
    ["path", { d: "M9 6.5h11M9 12h11M9 17.5h11" }],
    ["circle", { cx: 4.5, cy: 6.5, r: 1.3, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 4.5, cy: 12, r: 1.3, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 4.5, cy: 17.5, r: 1.3, fill: "currentColor", stroke: "none" }],
  ],
  send: [["path", { d: "M12 19.5V5M5.5 11.5 12 5l6.5 6.5" }]],
  search: [
    ["circle", { cx: 10.5, cy: 10.5, r: 6 }],
    ["path", { d: "m15 15 5.5 5.5" }],
  ],
  route: [
    ["circle", { cx: 6, cy: 18, r: 2.2 }],
    ["circle", { cx: 18, cy: 6, r: 2.2 }],
    ["path", { d: "M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" }],
  ],
  flag: [["path", { d: "M5 21V4M5 4h11l-2 4 2 4H5" }]],
  thumbsUp: [["path", { d: "M7 10v10H4V10zM7 10l4-7c1.4 0 2.3 1.1 2 2.5L12.4 9H19a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 20H7" }]],
  thumbsDown: [["path", { d: "M7 14V4H4v10zM7 14l4 7c1.4 0 2.3-1.1 2-2.5l-.6-3.5H19a2 2 0 0 0 2-2.3l-1.3-7A2 2 0 0 0 17.7 4H7" }]],
  panel: [
    ["rect", { x: 3, y: 4.5, width: 18, height: 15, rx: 2.5 }],
    ["path", { d: "M15 4.5v15" }],
  ],
};

export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("ui-icon");
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

// Replace an element's content with an icon followed by a text label.
export function iconLabel(el, name, text, size = 16) {
  const label = document.createElement("span");
  label.textContent = text;
  el.replaceChildren(icon(name, size), label);
  return el;
}

// Fill every <span data-icon="name"> placeholder in the page with its icon.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.querySelector("svg")) continue;
    el.prepend(icon(el.dataset.icon, Number(el.dataset.iconSize) || 16));
  }
}
