# OFFGRID — project handoff (read this first)

**Goal:** an AI product that stays genuinely useful when the cloud disappears. OFFGRID (formerly "Brownout Brain") is an offline emergency map and assistant for **all of Batangas, Philippines**. It was built for a hackathon and is now a product.

**Main user:** residents on **low-end Android phones** (target Android 8, 2 GB RAM, about 60 MB free) during brownouts or disasters. The laptop is an optional **hub**; phones must work on their own.

Project folder: `C:\Users\Lyle Daniel\OneDrive\Desktop\brownout-brain` (the folder name is unchanged; the product name is OFFGRID).

## How to run
- **Laptop only:** `start.bat` serves http://127.0.0.1:8000. You can also run `.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.
- **Hub for phones:** `start_hub.bat`. It serves https on 8443 for phones, plus the setup page and the laptop's own app on http 8080 (`BB_LAN_SETUP=1`). Phones open `http://<laptop-ip>:8080/setup`.
- **Tests:** `.venv\Scripts\python -m pytest -q`. There are 451 tests; they also run the Node parity tests. `tests/conftest.py` gives every test its own empty reports database.
  - **Question bank:** `tests/question_bank.json`, 220 questions in 57 groups, written clean, in Filipino/Taglish, and with typos and text-speak. `tests/test_question_bank.py` checks them on the hub; `tests/js/parity.test.mjs` checks the same bank on the phone engine. **Add new question types here first.**
  - **Readable report:** `.venv\Scripts\python tools\check_questions.py` writes `docs/question_report.md` (no server needed). Add `--ai --sample 40` to include real AI summaries (Ollama must be running).
- **End to end (hub loss):** `node tools/e2e_offline.mjs` runs headless Edge with a throwaway profile.
  - With https: `NODE_EXTRA_CA_CERTS=certs/offgrid-ca.crt node tools/e2e_offline.mjs --https 127.0.0.1`
  - It passes 15/15 (including situation reports: sync, offline answer, offline queue, send on reconnect). It uses a throwaway reports database.
- **Preview server for testing:** `.claude/launch.json` has `offgrid-test` on port 8010 with a scratch reports DB and PIN `424242`.
- **Measuring answers:** `.venv\Scripts\python tools\measure_answers.py --rounds 2`, with the server running.
- **Debug:** open the app with `?debug` to get `window.__map` in the console.

## Environment
- Windows 11, Intel i5-12450HX, RTX 3050 6 GB, **8 GB RAM**. Python 3.14.3 in `.venv`, Node 24, Ollama 0.40 with `qwen2.5:3b`.
- Git's openssl is at `C:/Program Files/Git/usr/bin/openssl.exe`. Edge is at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
- **Gotchas**
  - **Shell escaping:** bash heredocs and `python -c` mangle `\b`, `\n` and `\a` in edited source, which caused bugs several times. For non-trivial edits, write a Python script file with the Write tool and run it, or use the Edit tool.
  - **Service workers in the browser pane:** on `localhost` the pane *does* register `sw.js`, and it then serves the cached page. After code changes, unregister it and clear caches in the pane (or test with `tools/e2e_offline.mjs`).
  - **The browser pane pauses `requestAnimationFrame` when hidden.** Don't rely on rAF for logic.
  - **Windows Firewall must allow Python on Private networks** before phones can reach the hub on the LAN IP. This was still pending when this file was written.
  - **iPhone home-screen app strip:** with `black-translucent` + `viewport-fit=cover`, iOS reports the height as screen minus status bar, leaving an empty strip at the bottom. The inline script in `index.html` sets `--app-h` to the full screen height (only when `navigator.standalone`), and `styles.css` sizes `html, body` with it. It compares against `documentElement.clientHeight` (the box `100%` uses; `innerHeight` can already read full) and re-checks after load and on resize.
  - **Phone diagnostics:** tap the "Saved on this phone" line at the bottom of the panel (sheet at least half open) to show the running copy's pack id (and the hub's if newer), home-screen app or browser, screen/window/page heights, `--app-h` and safe areas. Ask for a screenshot of it in phone bug reports.
  - **Updates:** inside the app, `fetch(..., { cache: "no-store" })` still goes through the service worker. `sw.js` fetches `pack/version.json` network-first, so phones notice a new pack. Install re-downloads only changed files (ETag → 304), and `app.js` reloads on `controllerchange` (or offers "Tap to restart" if the user is busy). A phone on an older copy needs two opens near the hub.
  - **Overpass API is often busy (504).** `tools/overpass.py` retries with a mirror.

## Architecture (key files)
- **Backend (FastAPI)**
  - `app/main.py`: app, router cached via `functools.cache`, LAN setup guard, MIME types.
  - `app/config.py`: retrieval thresholds `TOP_K=4`, `THRESHOLD=2.4`, `MIN_TERMS=2`, `STRONG_SCORE=6.0`, `RELATIVE_SCORE=0.5`.
  - `app/routes/assistant.py`: the `/api/assistant/ask` NDJSON stream. The order of checks:
    0. **spelling fixes** (`services/normalize.py`): "neerest hospitl" becomes "nearest hospital", "pano" becomes "paano", "brgy" becomes "barangay". Everything below sees the fixed question; the AI sees both forms.
    1. location intents (`services/intents.py` → `routes/place_answers.py`), answered from data and never by the AI
    2. **current-conditions questions** (`intents.report_query` → `services/report_answers.py`): answered from situation reports with trust labels, never by the AI. Advice questions ("is it safe to walk through floodwater?") stay with the guides.
    3. direction questions → router
    4. guide search with the "not covered" gate
    5. **guide passages first, then the AI summary** (Ollama), checked by `services/verify.py`. Every number, phone and proper name in the summary must be in the sources, or the summary is dropped.
       - The AI sees only the sections shown on screen (top 2, plus 911 for hotline answers). Sources list the same sections.
       - A summary citing a section it wasn't shown is dropped, and "no information provided" counts as a refusal. The 3B model sometimes did both on Filipino questions.
       - For the AI, English questions are the most reliable; Filipino ones get correct guide text, but the summary is hidden more often.
    - Battery saver: the request sets `use_ai=false`.
    - If the AI is down, the answer is the guide text only.
  - `app/services/retrieval.py`: BM25 (rank_bm25) plus synonyms, including Filipino; the gate needs at least 40% of concepts for long questions.
    - Synonyms are written as plain words in `SYNONYM_WORDS`; `SYNONYMS` is the stemmed copy used for lookups. Before this fix, keys ending in "s" (e.g. "lumikas") silently never matched.
  - `app/services/normalize.py`: deterministic spelling fixer, with no model and no download.
    - Steps: clean-up, then `ALIASES`/`PHRASES` for text-speak, then fuzzy correction (1 edit, or 2 for words of 8+ letters, same first letter) against a dictionary of guide words, regex keywords (`intents.PATTERNS`) and synonym words.
    - Never corrected: place and road names, stopwords, `EXTRA_KNOWN` everyday words, a known word plus -s/-ed/-ing, and words under 4 letters.
    - `app.main.app_lexicon` builds the dictionary; the phone gets the same one as `pack/lexicon.json`.
  - `app/services/intents.py` also holds the directions and follow-up patterns (`DIRECTIONS`, `FOLLOW_UP`) and `PATTERNS`, the list of every pattern.
  - `app/services/routing.py`: A* router that snaps to the nearest point on a road (not a junction), walk and drive modes, oneway rules, steps with bearings over 20 m.
  - `app/routes/directions.py` (`/api/route`): `plan_route` plans the normal route; if it uses a reported flooded/blocked road it plans around them (`avoided_reports`), or keeps it and flags `through_reports` when there is no way around. `avoid_reports=false` turns this off.
  - **Situation reports:** `app/services/reports.py` (`ReportStore`, SQLite at `data/reports.db` or `BB_REPORTS_DB`; trust labels, expiry, votes, in-memory rate limits) and `app/routes/reports.py` (`/api/reports`: list, post, vote, responder verify/remove).
    - Responder PIN: `BB_RESPONDER_PIN`, or a random 6-digit PIN printed in the hub console at startup.
    - Stored per report: kind, point, snapped road edge id and name, times, vote counts. Device ids are stored only as salted hashes, and IPs are never stored.
  - Also: `app/routes/setup.py` (phone setup page and CA download), `app/services/llm.py` (Ollama).
- **Frontend (vanilla JS + MapLibre 5.6 + PMTiles)** in `app/static/`
  - `map.js`: light and dark Apple-style styles, WebGL pins, bounds locked to the data, plus a rotation-safe min zoom.
    - Apple-style compass that shows only while the map is rotated.
    - "Show my location" control; `zoomTo` after a GPS fix.
    - Camera moves are padded (`setViewPadding`) so targets aren't hidden under the panel.
    - **`fitBounds` adds the map's own padding** (left there by `easeTo`/`flyTo` with `padding`) to the padding it's given, and silently does nothing if the sum doesn't fit. `padBy` passes only what's missing. Before this fix, Directions on a phone never zoomed to the route.
  - **Layout (UI refresh):** the map is always full screen.
    - Laptop: the panel is a floating card that collapses to an icon rail.
    - Phone (≤ 820 px): the panel is a bottom sheet (`sheet.js`: peek, half and full; drag or tap the handle). It **always opens at peek** (heights aren't saved); testing tools choose another start with `localStorage` `bb.sheet.start`.
    - **Launch screen:** `#splash` in `index.html` (the tern on `#2b2b2b`, the icon's colour, styled inline so it paints on the first frame). `app.js` `hideSplash()` fades it out on `map.js` `onReady` (first `idle`, or 1.5 s after load), on map failure, or after 5 s at most.
    - Logo: the tern, inline SVG in `index.html`, with colours from CSS variables so it follows light and dark mode. `icons/logo.svg` is the dark version.
    - Tagline: "Ready beyond the grid".
  - `app.js`: UI wiring, theme, panel and legend toggles, heading cone, battery saver, service worker registration.
  - `chat.js`: talks to the hub; **falls back to the phone engine** if the hub is unreachable (6 s timeout).
  - `directions.js`: Directions card and GPS tracking (accuracy filter, progress, reroute after 2 off-route fixes, arrival); "Avoid reported roads" toggle, reroutes when road reports change.
  - `reports.js`: Reports tab, posting (kind → tap map), outbox in localStorage (`bb.reports.outbox`, sent when the hub answers), cached copy (`bb.reports.cache`), confirm/dispute, responder mode. `report-kinds.js` holds labels, colours and lifetimes.
  - `icons.js` (facility pins, and report markers: rounded squares, so they are never mistaken for places), `ui-icons.js` (line icons, no emoji).
  - `sw.js`: service worker; precaches about 46 MB including the 32 MB `map/area.pmtiles` and serves byte ranges from the cache. Registered as `/sw.js?v=<pack id>`. **New static files must be added to `PRECACHE`.**
  - `manifest.webmanifest` and `icons/*.png`.
- **Phone engine** in `app/static/offline/` (a port of the hub logic, kept in step by parity tests)
  - `search.js` uses the exact BM25 weights exported from the hub.
  - `intents.js` and `answers.js` handle location and guide answers; `reports.js` answers from the phone's saved copy of the reports (and says how old it is).
  - `normalize.js` is the phone's copy of the spelling fixer; parity tests check it word for word against the hub on every question in the bank.
  - `router.js` routes on typed arrays from `pack/roads.bin`. Edge ids match the hub's, so road reports' `edge_id` works on the phone too.
  - `brain.js` loads everything lazily.
- **Data**
  - `data/locations.json`: 1,758 OSM facilities, all of Batangas. Fields include `also` (secondary roles, e.g. Batangas Medical Center is an evacuation center *also* a hospital) and `osm_url`.
  - `data/guides/*.md`: 6 guides, each `##` section is a citable chunk.
    - `hotlines.md` holds official numbers (national, Batangas PDRRMO, Batangas City, Lipa).
    - The PAGASA wind signal section was verified. The other guides are drafts that still need checking against NDRRMC, DOH and Red Cross material.
  - `data/roads.json.gz`: 158k junctions, 19,325 km of road.
  - `data/suggested_questions.md`: the question bank.
- **Map:** `app/static/map/area.pmtiles` (z0–15, 32 MB, Protomaps build 2026-10-08), bbox lng 120.55–121.50, lat 13.45–14.20. Keep `BOUNDS` in `map.js` and `BBOX` in `tools/overpass.py` in sync.
- **Tools** in `tools/`
  - Data imports: `import_osm.py` (facilities), `import_roads.py` (roads).
  - `make_style.mjs`: map styles; the light and dark palettes live here. Needs `npm install @protomaps/basemaps@5.7.2` in a temp folder.
  - `build_phone_pack.py`: run after **any data or app code change**. It writes `app/static/pack/`; the pack id hashes the data and every app file, so phones re-save their offline copy.
  - `make_parity_fixtures.py`: run after answer-logic changes. It writes `tests/fixtures/*.json`.
  - `screenshots.mjs`: retakes the README screenshots (`docs/screenshots/*.png`: laptop dark and light, 7 phone shots including hub-off and `/setup`) from the real app in headless Edge, with the internet blocked. It prints a check per shot. It needs Ollama, and about 1 GB of free RAM (it starts its own server on 8766).
  - `make_icons.mjs`: renders the home-screen icons from the tern in `icons/logo.svg` with headless Edge: `apple-touch-icon.png` (180, iPhone), `icon-192/512.png`, and `icon-maskable-512.png` (tern inside Android's safe zone). Full-bleed `#2b2b2b` tiles, no transparency. iPhones keep the icon from when the app was added; to see a new one, delete it from the home screen and add it again.
  - Also: `make_certs.py`, `measure_answers.py`, `check_questions.py`, `e2e_offline.mjs`.
- **README.md:** the user-facing guide (features, screenshots, step-by-step setup for laptop, Android and iPhone, troubleshooting, developers, data and sources). Keep it in step when setup steps or features change.
- `sw.js` lets navigations to `/setup` and `/offgrid-ca.crt` through to the hub (before, it served the saved app for every page).

## Decisions already made (don't re-ask)
- **Demo:** a 1-minute live demo run-sheet exists (shared doc, offline copy `docs/demo_runsheet.md`). Before presenting run `tools/demo_check.py` (checks hub, phone address and certificate, warms and times the local AI). Open the laptop app with `?demo` so reports sync every 3 s instead of 15. Otherwise, focus on building the app.
- **Demo video:** `docs/demo_video.mp4` (55 s, 1080p, narrated), built from real app footage by `tools/demo_video/`. To rebuild: `powershell -File tools/demo_video/narrate.ps1 <out>`, then `node tools/demo_video/record.mjs <out>` (Ollama running), then `node tools/demo_video/compose.mjs <out>`. Captions and narration live in `tools/demo_video/script.json`; the typos in the typed questions are deliberate and captioned.
- **Map look:** Apple Maps–style palette (dark: royal-blue water, teal land, lavender roads, white labels; light: "Soft Sage", low-glare grey-green land, dusty-blue water, off-white roads, amber highways). **Keep Noto Sans fonts.**
- **Pins and legend:** teardrop pins with white discs and icons; dark legend card, collapsible.
- **Evacuation centers:** only "confirmed" ones, meaning OSM objects tagged `evacuation_center=yes`. Facility types are as imported (no drinking-water points exist in OSM for this area).
- **Directions:** computed in code, never by the AI. Routes steer around reported flooded/blocked roads, and every route warns that reports can be missing or wrong and it doesn't know about other floods or closures.
- **Phase 1 (done):** guide text first, AI summary checked by code, battery saver.
- **Phase 2 (done):**
  - phones install a PWA from the hub after **trusting the hub CA once**
  - directions work **on the phone** with no hub
  - target **Android 8, 2 GB RAM**
- **Phase 3 (done): local situation reports on the hub.**
  - Kinds: road flooded or blocked (2 h), evacuation center full or open (6 h), drinking water (6 h), power out (6 h), medical need (2 h). A confirm restarts the clock, capped at 3 lifetimes.
  - **Anyone can post.** Labels: "unverified", "confirmed" (2+ confirms) or "verified by a responder" (hub PIN). Hidden when disputes ≥ confirms + 2. No free-text notes (no personal data, nothing to moderate).
  - Rate limits: 10 reports per phone and 30 per IP per hour; 5 wrong PINs lock that IP out for 10 min.
  - Phones send `age_s` for reports queued offline, because phone clocks can't be trusted.
  - Reports are shared only through the hub; phones can't exchange them directly.

## Open items / known issues
1. **Windows Firewall** permission for Python on Private networks is needed for LAN phone access. It was not yet verified on the LAN IP; https on 127.0.0.1 was verified.
2. **No real Android phone has been tested yet.** Run `start_hub.bat`, set up a phone, turn the laptop off, and confirm everything still works.
3. **Stray file to delete by hand:** `C:\LYLEDA~1\placeholder.txt` (created by mistake; a safety check blocked deleting it).
4. **The side panel collapse/re-open** may not resize the map in a visible window; this is unverified.
4b. **UI refresh is not fully finished:**
    - The phone sheet's mouse/touch drag fix is untested on a real phone.
    - The old panel overflow is fixed by the floating card layout.
4c. **Question understanding limits:**
    - Typos that change the first letter, or that need more edits than allowed, aren't fixed. The answer is then "not covered" (safe).
    - Questions that mix topics may show a related section first ("is the water safe to drink after a flood" can show "After the typhoon", which also covers drinking water).
5. **The heading cone** (device compass on the blue dot) is untested on a real phone.
6. **Battery drain per answer isn't measured.** Unplug the laptop and run `measure_answers.py`.
7. **Content gaps:** earthquake and Taal Volcano guides (PHIVOLCS), the official LGU evacuation list, and hotlines for towns other than Batangas City and Lipa.
8. **Not chosen yet (from the product discussion):** reading official SMS bulletins, a measured model upgrade, voice, and a family preparedness profile.
