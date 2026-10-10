// Generate app/static/map/style.json: the Protomaps "light" basemap tuned for street-level detail.
//
// One-time setup (online), in any folder OUTSIDE the project:
//   npm install @protomaps/basemaps@5.7.2
// Then, from the project root:
//   node tools/make_style.mjs <folder-with-node_modules> app/static/map/style.json light
//   node tools/make_style.mjs <folder-with-node_modules> app/static/map/style-dark.json dark
//
// All URLs stay local (fonts, sprites, tiles), so the map works offline.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [pkgDir = ".", out = "app/static/map/style.json", flavorName = "light"] = process.argv.slice(2);
if (!["light", "dark"].includes(flavorName)) throw new Error("flavor must be light or dark");
const entry = join(resolve(pkgDir), "node_modules", "@protomaps", "basemaps", "dist", "esm", "index.js");
const { layers, namedFlavor } = await import(pathToFileURL(entry).href);

// Colour palettes. Dark follows the Apple Maps dark look (royal-blue water, teal land,
// greener vegetation, slate-blue urban areas, thin lavender roads, white labels with soft
// dark halos); light is its daytime "Soft Sage" counterpart. Only colours change: fonts, sizes, zoom
// rules and layers all come from the stock flavor.
const PALETTE = {
  dark: {
    background: "#2e6b6c", earth: "#2e6b6c", water: "#1f3c8f",
    park_a: "#4f9a67", park_b: "#4f9a67", wood_a: "#4a9463", wood_b: "#4d9765",
    scrub_a: "#39795f", scrub_b: "#39795f", glacier: "#9fb4c8", sand: "#857f5c", beach: "#857f5c",
    hospital: "#4a4560", school: "#3e4a66", industrial: "#404862", pedestrian: "#3a4560",
    aerodrome: "#3a4560", runway: "#5c6290", zoo: "#4f9a67", military: "#3e4a5a", pier: "#3a4560",
    buildings: "#444e66",
    minor_service: "#8e93c4", minor_a: "#a0a5d6", minor_b: "#a0a5d6", other: "#8e93c4",
    link: "#aaaee2", major: "#b4b8ea", highway: "#c8cbf7",
    minor_service_casing: "#285d5f", minor_casing: "#285d5f", link_casing: "#285d5f",
    major_casing_early: "#285d5f", major_casing_late: "#285d5f",
    highway_casing_early: "#285d5f", highway_casing_late: "#285d5f",
    tunnel_other: "#6a6e96", tunnel_minor: "#6a6e96", tunnel_link: "#6a6e96", tunnel_major: "#6a6e96",
    tunnel_highway: "#6a6e96",
    tunnel_other_casing: "#285d5f", tunnel_minor_casing: "#285d5f", tunnel_link_casing: "#285d5f",
    tunnel_major_casing: "#285d5f", tunnel_highway_casing: "#285d5f",
    bridges_other: "#8e93c4", bridges_minor: "#a0a5d6", bridges_link: "#aaaee2", bridges_major: "#b4b8ea",
    bridges_highway: "#a3a7da",
    bridges_other_casing: "#1d4a4c", bridges_minor_casing: "#1d4a4c", bridges_link_casing: "#1d4a4c",
    bridges_major_casing: "#1d4a4c", bridges_highway_casing: "#1d4a4c",
    railway: "#5c6290", boundaries: "#8f93c9",
    roads_label_minor: "#e8ebf8", roads_label_minor_halo: "#1d3040",
    roads_label_major: "#ffffff", roads_label_major_halo: "#1d3040",
    ocean_label: "#a3b8ff",
    subplace_label: "#eef3f8", subplace_label_halo: "#1b2b3a",
    city_label: "#ffffff", city_label_halo: "#1b2b3a",
    state_label: "#c8d0dc", state_label_halo: "#1b2b3a",
    country_label: "#c8d0dc",
    address_label: "#b8bfd6", address_label_halo: "#1d3040",
    pois: {
      blue: "#7fb0ff", green: "#6fd99a", lapis: "#9aa8ff", pink: "#f59ac8",
      red: "#ff8a8a", slategray: "#c3cad8", tangerine: "#ffb066", turquoise: "#5fe0d0",
    },
    landcover: {
      barren: "#7d7a58", farmland: "#3f776a", forest: "#4a9463", glacier: "#9fb4c8",
      grassland: "#357566", scrub: "#39795f", urban_area: "#3a4560",
    },
    buildingOutline: "#525d78",
  },
  // Light is "Soft Sage": low-glare grey-green land, dusty-blue water, off-white roads
  // with grey edges and warm amber highways, so it is easy on the eyes in daylight.
  light: {
    background: "#e6e9e1", earth: "#e6e9e1", water: "#9fc2db",
    park_a: "#cfe0c3", park_b: "#cfe0c3", wood_a: "#bfd7b3", wood_b: "#c6dbba",
    scrub_a: "#d6e3cb", scrub_b: "#d6e3cb", sand: "#ece5c9", beach: "#ece5c9",
    hospital: "#eddcdc", school: "#e6e3d6", industrial: "#dfe0e3", pedestrian: "#e2e4dd",
    zoo: "#cfe0c3",
    buildings: "#d9dbd2",
    minor_service: "#fbfbf7", minor_a: "#fbfbf7", minor_b: "#fbfbf7", other: "#fbfbf7",
    link: "#ffffff", major: "#ffffff", highway: "#f1d38a",
    minor_service_casing: "#c3c7bd", minor_casing: "#c3c7bd", link_casing: "#aeb3a8",
    major_casing_early: "#aeb3a8", major_casing_late: "#aeb3a8",
    highway_casing_early: "#c09a4e", highway_casing_late: "#c09a4e",
    tunnel_other: "#d7dad2", tunnel_minor: "#d7dad2", tunnel_link: "#d7dad2", tunnel_major: "#d7dad2",
    tunnel_highway: "#ecd8a6",
    bridges_other: "#fbfbf7", bridges_minor: "#fbfbf7", bridges_link: "#ffffff", bridges_major: "#ffffff",
    bridges_highway: "#f1d38a",
    bridges_other_casing: "#bcc0b6", bridges_minor_casing: "#bcc0b6", bridges_link_casing: "#bcc0b6",
    bridges_major_casing: "#bcc0b6", bridges_highway_casing: "#d4ae62",
    railway: "#b3b7ae", boundaries: "#a6a9b8",
    roads_label_minor: "#41464a", roads_label_minor_halo: "#f4f5f1",
    roads_label_major: "#2f3438", roads_label_major_halo: "#f4f5f1",
    ocean_label: "#2f5d82",
    subplace_label: "#4d5257", subplace_label_halo: "#f4f5f1",
    city_label: "#22262a", city_label_halo: "#f4f5f1",
    state_label: "#7a7f84", state_label_halo: "#f4f5f1",
    address_label: "#878b8f", address_label_halo: "#f4f5f1",
    landcover: {
      barren: "#e8e2c8", farmland: "#dfe6cc", forest: "#bfd7b3", glacier: "#f2f5f6",
      grassland: "#d6e5c8", scrub: "#d6e3cb", urban_area: "#e2e4dd",
    },
    buildingOutline: "#c4c7bd",
  },
};

const { buildingOutline, ...colors } = PALETTE[flavorName];
const base = namedFlavor(flavorName);
const flavor = {
  ...base,
  ...colors,
  pois: { ...base.pois, ...colors.pois },
  landcover: { ...base.landcover, ...colors.landcover },
};
const all = layers("protomaps", flavor, { lang: "en" });

// Landmarks people navigate by ("near the church"). Facility kinds the app already draws
// itself (hospital, clinic, pharmacy, police, fire station) are deliberately left out.
const EXTRA_POIS = [
  "place_of_worship", "marketplace", "bank", "atm", "fuel", "college", "community_centre",
  "bus_station", "townhall", "school", "university", "supermarket", "library", "post_office",
  "stadium", "ferry_terminal",
];
// Kinds with no icon in the "light" sprite borrow a close one.
const ICON_FOR = {
  station: "train_station", college: "school", marketplace: "supermarket", bus_station: "bus_stop",
  place_of_worship: "townspot", bank: "townspot", atm: "townspot", fuel: "townspot",
  community_centre: "townspot", townhall: "townspot",
};
const DROP_POIS = new Set(["hospital", "clinic", "pharmacy", "police", "fire_station"]);

// Stronger roads: scale the width stops of every road line layer (casings use
// line-gap-width, scaled the same so they stay aligned). Zero stops stay zero, so roads
// still appear at the same zooms.
function scaleStops(expr, factor) {
  if (!Array.isArray(expr) || expr[0] !== "interpolate") return expr;
  const out = expr.slice(0, 3);
  for (let i = 3; i < expr.length; i += 2) out.push(expr[i], typeof expr[i + 1] === "number" ? +(expr[i + 1] * factor).toFixed(2) : expr[i + 1]);
  return out;
}
const ROAD_LABELS = new Set(["roads_labels_minor", "roads_labels_major", "roads_shields", "roads_oneway"]);
function roadFactor(id) {
  if (/highway|major|link/.test(id)) return 1.35;
  if (/minor|other|service|pier/.test(id)) return 1.3;
  return 1; // rail, runways, taxiways keep their width
}
// Clearer labels: a slightly wider, soft halo on place and road names.
const HALO_LAYERS = /^(places_|roads_labels_|water_label|water_waterway_label|earth_label|address_label|pois)/;

const tuned = [];
for (const layer of all) {
  const l = structuredClone(layer);
  if (l.type === "line" && l.id.startsWith("roads_") && !ROAD_LABELS.has(l.id)) {
    const f = roadFactor(l.id);
    if (f !== 1 && l.paint) {
      if (l.paint["line-width"]) l.paint["line-width"] = scaleStops(l.paint["line-width"], f);
      if (l.paint["line-gap-width"]) l.paint["line-gap-width"] = scaleStops(l.paint["line-gap-width"], f);
    }
  }
  if (l.type === "symbol" && HALO_LAYERS.test(l.id) && l.paint && "text-halo-width" in l.paint) {
    l.paint["text-halo-width"] = 1.6;
    l.paint["text-halo-blur"] = 0.4;
  }
  if (l.id === "roads_labels_minor") l.minzoom = 13.5; // street names earlier (was 15)
  if (l.id === "address_label") l.minzoom = 16.5; // house numbers earlier (was 18)
  if (l.id === "pois") {
    const kinds = l.filter[1][2][1]; // ["in", ["get","kind"], ["literal", [...]]]
    const merged = [...new Set([...kinds, ...EXTRA_POIS])].filter((k) => !DROP_POIS.has(k));
    l.filter[1][2][1] = merged;
    l.layout["icon-image"] = ["match", ["get", "kind"], ...Object.entries(ICON_FOR).flat(), ["get", "kind"]];
  }
  if (l.id === "buildings") {
    l.paint["fill-color"] = colors.buildings;
    l.paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 13, 0.4, 16, 0.75];
    tuned.push(l);
    tuned.push({
      id: "buildings_outline",
      type: "line",
      source: "protomaps",
      "source-layer": "buildings",
      minzoom: 15,
      filter: ["in", "kind", "building", "building_part"],
      paint: {
        "line-color": buildingOutline,
        "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.4, 18, 1],
      },
    });
    continue;
  }
  tuned.push(l);
}

const style = {
  version: 8,
  glyphs: "/map/fonts/{fontstack}/{range}.pbf",
  sprite: `/map/sprites/${flavorName}`,
  sources: {
    protomaps: {
      type: "vector",
      url: "pmtiles:///map/area.pmtiles",
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: tuned,
};
writeFileSync(out, JSON.stringify(style, null, 1));
console.log(`Wrote ${out}: ${tuned.length} layers`);
