// OFFGRID service worker: keeps a full copy of the app on the phone so it works with no
// hub and no internet. Registered as /sw.js?v=<pack id>; a new data pack means a new URL,
// so the phone downloads the new copy the next time it reaches the hub.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `offgrid-${VERSION}`;
const RUNTIME = "offgrid-runtime"; // map glyphs fetched later, kept across versions

const FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
// Latin, Latin-1 (ñ), Latin Extended and punctuation (’ “ ” …): what Filipino/English labels use.
const FONT_RANGES = ["0-255", "256-511", "8192-8447"];

const PRECACHE = [
  "/", "/index.html", "/styles.css", "/manifest.webmanifest",
  "/app.js", "/map.js", "/chat.js", "/directions.js", "/icons.js", "/ui-icons.js", "/reports.js", "/report-kinds.js", "/sheet.js",
  "/offline/search.js", "/offline/intents.js", "/offline/router.js", "/offline/answers.js", "/offline/brain.js", "/offline/reports.js", "/offline/normalize.js",
  "/vendor/maplibre-gl.js", "/vendor/maplibre-gl.css", "/vendor/pmtiles.js",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/logo.svg",
  "/map/style.json", "/map/style-dark.json",
  ...["light", "dark"].flatMap((t) => [`/map/sprites/${t}.json`, `/map/sprites/${t}.png`, `/map/sprites/${t}@2x.json`, `/map/sprites/${t}@2x.png`]),
  ...FONTS.flatMap((f) => FONT_RANGES.map((r) => `/map/fonts/${encodeURIComponent(f)}/${r}.pbf`)),
  "/pack/version.json", "/pack/guides.json", "/pack/lexicon.json", "/pack/roads-meta.json", "/pack/roads.bin",
  "/api/locations", "/api/hotlines",
  "/map/area.pmtiles", // the big one (~32 MB) last
];

// Tell open pages how the offline copy is going (shown as "Saving offline copy… 40%").
async function report(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ type: "offline-copy", ...msg });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let done = 0;
    for (const url of PRECACHE) {
      // cache: "reload" so the copy is fresh from the hub, not from the browser's HTTP cache.
      const resp = await fetch(url, { cache: "reload" });
      if (!resp.ok) throw new Error(`could not save ${url}: ${resp.status}`);
      await cache.put(url, resp);
      done += 1;
      await report({ state: "saving", done, total: PRECACHE.length });
    }
    await report({ state: "saved", version: VERSION });
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("offgrid-") && key !== CACHE && key !== RUNTIME) await caches.delete(key);
    }
    await self.clients.claim();
    await report({ state: "ready", version: VERSION });
  })());
});

// Serve a byte range from a cached full file (the map tiles are read in small ranges).
async function rangeResponse(request, cached) {
  const header = request.headers.get("range");
  const match = /bytes=(\d+)-(\d*)/.exec(header || "");
  if (!match) return cached;
  const blob = await cached.blob();
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1;
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${blob.size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

// Live data from the hub when reachable; the saved copy when not.
async function networkFirst(request, timeoutMs = 3000) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline and not saved");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // questions (POST) fall back in the page itself
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Map tiles: always from the saved copy (they never change within a version).
  if (url.pathname === "/map/area.pmtiles") {
    event.respondWith((async () => {
      const cached = await caches.match("/map/area.pmtiles");
      return cached ? rangeResponse(request, cached) : fetch(request);
    })());
    return;
  }
  // Places, hotlines and health: try the hub first, fall back to the saved copy.
  if (url.pathname === "/api/locations" || url.pathname === "/api/hotlines") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/api/")) return; // health etc.: no offline copy (the page handles failure)
  // The hub's setup page and certificate are the hub's own, never the saved app.
  if (url.pathname === "/setup" || url.pathname === "/offgrid-ca.crt") return;
  // Opening the app (also from the home-screen icon): the saved page.
  if (request.mode === "navigate") {
    event.respondWith(caches.match("/").then((c) => c || fetch(request)));
    return;
  }
  // Everything else: saved copy first, then the hub; glyph ranges not saved upfront are kept once fetched.
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: url.pathname.startsWith("/pack/") });
    if (cached) return cached;
    const resp = await fetch(request);
    if (resp.ok && url.pathname.startsWith("/map/fonts/")) (await caches.open(RUNTIME)).put(request, resp.clone());
    return resp;
  })());
});
