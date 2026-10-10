// Map-pin icons: a colored teardrop with a white disc and a glyph in the pin's color.
// Used for the map markers (as MapLibre images) and for the legend, filters and list (as <img>).

// Glyphs are drawn in a 24x24 box. "C" is replaced with the pin color, "W" with white.
const GLYPHS = {
  evacuation_center: `
    <path fill="C" d="M12 3.2 2.6 11.4c-.5.4-.2 1.1.4 1.1H5V20c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-7.5h2c.6 0 .9-.7.4-1.1z"/>
    <path fill="W" d="M10 21v-4.2a2 2 0 0 1 4 0V21z"/>`,
  hospital: `
    <path fill="C" d="M9.5 3h5c.6 0 1 .4 1 1v4.5H20c.6 0 1 .4 1 1v5c0 .6-.4 1-1 1h-4.5V20c0 .6-.4 1-1 1h-5c-.6 0-1-.4-1-1v-4.5H4c-.6 0-1-.4-1-1v-5c0-.6.4-1 1-1h4.5V4c0-.6.4-1 1-1z"/>`,
  health_center: `
    <path fill="C" d="M9 4h6c.6 0 1 .4 1 1v2h4c.6 0 1 .4 1 1v11c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V8c0-.6.4-1 1-1h4V5c0-.6.4-1 1-1zm1 3h4V6h-4z"/>
    <path fill="W" d="M11 10h2v2.5h2.5v2H13V17h-2v-2.5H8.5v-2H11z"/>`,
  rescue: `
    <path fill="C" d="M7 18v-5a5 5 0 0 1 10 0v5z"/>
    <rect fill="C" x="5" y="18.5" width="14" height="2.5" rx="1"/>
    <path fill="C" d="M11 2h2v3h-2zM3.3 6.7l1.4-1.4 2.1 2.1-1.4 1.4zm15.9-1.4 1.4 1.4-2.1 2.1-1.4-1.4z"/>
    <path fill="W" d="M10 13.2a2 2 0 0 1 2-2v1.6a.5.5 0 0 0-.4.4z"/>`,
  fire_station: `
    <path fill="C" d="M12.3 2.2c.9 3.6 5.7 5.6 5.7 11.3a6 6 0 0 1-12 0c0-2.9 1.6-4.8 3-6 .1 2 .9 3.4 2.3 4.1-.6-3.7-.3-6.8 1-9.4z"/>
    <path fill="W" d="M12 20a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.3-2.4 2-3.6.6 1.3 3.2 2 3.2 3.6A2.6 2.6 0 0 1 12 20z"/>`,
  police: `
    <path fill="C" d="M12 2.2 20 5v6.2c0 5-3.4 9.3-8 10.6-4.6-1.3-8-5.6-8-10.6V5z"/>
    <path fill="W" d="m12 7.2 1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4z"/>`,
  pharmacy: `
    <g transform="rotate(-45 12 12)">
      <rect fill="C" x="4" y="8.5" width="16" height="7" rx="3.5"/>
      <path fill="W" d="M12 10h4.5a2 2 0 0 1 0 4H12z"/>
    </g>`,
  town_hall: `
    <path fill="C" d="M12 2.5 2.5 7.2V9h19V7.2z"/>
    <path fill="C" d="M4.5 10.2h2.6v7.3H4.5zm4.2 0h2.6v7.3H8.7zm4 0h2.6v7.3h-2.6zm4.2 0h2.6v7.3h-2.6zM2.5 18.6h19V21h-19z"/>`,
  barangay_hall: `
    <path fill="C" d="M5 2.5h2V21H5z"/>
    <path fill="C" d="M8 3.5h11.5l-2.8 4 2.8 4H8z"/>
    <rect fill="C" x="3" y="19.5" width="6" height="2" rx=".8"/>`,
  market: `
    <path fill="none" stroke="C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
          d="M2.5 4h2.6l2.3 10.3c.1.6.7 1 1.3 1h8.8c.6 0 1.1-.4 1.3-1L20.5 8H6.2"/>
    <circle fill="C" cx="9.5" cy="19.3" r="1.7"/><circle fill="C" cx="17" cy="19.3" r="1.7"/>`,
  drinking_water: `
    <path fill="C" d="M12 2.5c-3.5 5-6.5 8.2-6.5 12a6.5 6.5 0 0 0 13 0c0-3.8-3-7-6.5-12z"/>
    <path fill="W" d="M9 14.5a.9.9 0 0 1 1.8 0 2.2 2.2 0 0 0 2.2 2.2.9.9 0 0 1 0 1.8 4 4 0 0 1-4-4z"/>`,
  relief_point: `
    <path fill="C" d="M12 2.5 21 6.8v10.4L12 21.5 3 17.2V6.8z"/>
    <path fill="W" d="M12 11.2 4.9 7.8 12 4.4l7.1 3.4zM11.2 12.6v7.1l-6.6-3.2V9.4z" opacity=".55"/>`,
};

const GENERIC = `<circle fill="C" cx="12" cy="12" r="5"/>`;

// Pin geometry (viewBox 40 x 56): teardrop with its tip at (20, 51), a soft shadow under the tip.
export const PIN_W = 40;
export const PIN_H = 56;

export function pinSVG(type, color, disc = "#f8fafc") {
  const glyph = (GLYPHS[type] ?? GENERIC).replaceAll('"C"', `"${color}"`).replaceAll('"W"', `"${disc}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">
  <ellipse cx="20" cy="52" rx="8" ry="2.6" fill="${color}" opacity="0.3"/>
  <path fill="${color}" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.9"
        d="M20 51.2C17.8 47.6 3 33.4 3 20a17 17 0 0 1 34 0c0 13.4-14.8 27.6-17 31.2z"/>
  <circle cx="20" cy="20" r="12" fill="${disc}"/>
  <g transform="translate(11.6 11.6) scale(0.7)">${glyph}</g>
</svg>`;
}

export function pinDataURL(type, color, disc) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSVG(type, color, disc))}`;
}

// An <img> of the pin, for the legend, filter chips and list rows.
export function pinImg(type, color, height = 22) {
  const img = document.createElement("img");
  img.src = pinDataURL(type, color);
  img.alt = "";
  img.className = "pin-icon";
  img.height = height;
  img.width = Math.round((height * PIN_W) / PIN_H);
  return img;
}

// ---- situation report markers ----
// A rounded square with a pointer: a different shape from facility pins, so a report
// ("road flooded here") is never mistaken for a place. White glyph on the kind's colour.
const REPORT_GLYPHS = {
  road_flooded: `<path fill="none" stroke="W" stroke-width="2.2" stroke-linecap="round"
    d="M3 8.5c1.8 0 1.8-1.5 3.6-1.5s1.8 1.5 3.6 1.5 1.8-1.5 3.6-1.5 1.8 1.5 3.6 1.5 1.8-1.5 3.6-1.5M3 13.5c1.8 0 1.8-1.5 3.6-1.5s1.8 1.5 3.6 1.5 1.8-1.5 3.6-1.5 1.8 1.5 3.6 1.5 1.8-1.5 3.6-1.5M3 18.5c1.8 0 1.8-1.5 3.6-1.5s1.8 1.5 3.6 1.5 1.8-1.5 3.6-1.5 1.8 1.5 3.6 1.5 1.8-1.5 3.6-1.5"/>`,
  road_blocked: `<rect fill="W" x="2.5" y="7" width="19" height="6" rx="1.2"/>
    <path fill="C" d="M6 7h3l-3.5 6h-3zM12 7h3l-3.5 6h-3zM18 7h3l-3.5 6h-3z"/>
    <path fill="W" d="M5 13h2.2v7H5zm11.8 0H19v7h-2.2z"/>`,
  center_full: `<path fill="W" d="M12 3 2.8 11h2.4v9.5h13.6V11h2.4z"/>
    <circle fill="C" cx="8.8" cy="14" r="1.6"/><circle fill="C" cx="12" cy="14" r="1.6"/><circle fill="C" cx="15.2" cy="14" r="1.6"/>
    <path fill="C" d="M7 17.3h10v1.7H7z"/>`,
  center_open: `<path fill="W" d="M12 3 2.8 11h2.4v9.5h13.6V11h2.4z"/>
    <path fill="none" stroke="C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m8.6 14.6 2.4 2.4 4.6-4.6"/>`,
  water_available: `<path fill="W" d="M12 2.5c-3.5 5-6.5 8.2-6.5 12a6.5 6.5 0 0 0 13 0c0-3.8-3-7-6.5-12z"/>`,
  power_out: `<path fill="W" d="M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6z"/>
    <path fill="none" stroke="C" stroke-width="3.6" stroke-linecap="round" d="M4 4l16 16"/>
    <path fill="none" stroke="W" stroke-width="1.8" stroke-linecap="round" d="M4 4l16 16"/>`,
  medical_need: `<path fill="W" d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z"/>`,
};

export const REPORT_W = 36;
export const REPORT_H = 44;

export function reportSVG(kind, color) {
  const glyph = (REPORT_GLYPHS[kind] ?? GENERIC).replaceAll('"C"', `"${color}"`).replaceAll('"W"', '"#ffffff"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_W}" height="${REPORT_H}" viewBox="0 0 ${REPORT_W} ${REPORT_H}">
  <ellipse cx="18" cy="41.5" rx="6" ry="2" fill="${color}" opacity="0.3"/>
  <path fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"
        d="M9 2h18a7 7 0 0 1 7 7v16a7 7 0 0 1-7 7h-5l-4 8-4-8H9a7 7 0 0 1-7-7V9a7 7 0 0 1 7-7z"/>
  <g transform="translate(7 6) scale(0.92)">${glyph}</g>
</svg>`;
}

function reportDataURL(kind, color) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(reportSVG(kind, color))}`;
}

export function reportImg(kind, color, height = 26) {
  const img = document.createElement("img");
  img.src = reportDataURL(kind, color);
  img.alt = "";
  img.className = "pin-icon";
  img.height = height;
  img.width = Math.round((height * REPORT_W) / REPORT_H);
  return img;
}

export function loadReportImage(kind, color, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image(REPORT_W * scale, REPORT_H * scale);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = reportDataURL(kind, color);
  });
}

// Rasterize the pin at `scale`x for crisp MapLibre icons. (MapLibre draws an <img> scaled
// to its width/height attributes, so the SVG renders sharp at 2x.)
export function loadPinImage(type, color, scale = 2, disc) {
  return new Promise((resolve, reject) => {
    const img = new Image(PIN_W * scale, PIN_H * scale);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = pinDataURL(type, color, disc);
  });
}
