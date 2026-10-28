// Where the app is served from, and whether it is the hub's app or the website.
//
// The hub serves the app at "/", the GitHub Pages website at "/OFFGRID/", so every app path
// is built from BASE (the folder of index.html), never written as "/...".
// The website (tools/build_site.py adds <meta name="offgrid-mode" content="site">) has no
// hub behind it: no /api, no AI summaries, no shared reports. It runs the phone engine,
// exactly like a phone whose hub is switched off.

export const BASE = new URL(".", document.baseURI).href;
export const SITE = document.querySelector('meta[name="offgrid-mode"]')?.content === "site";

// An app path ("pack/version.json") as a full URL in this copy of the app.
export const url = (path) => BASE + path;
