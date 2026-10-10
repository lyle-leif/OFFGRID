# Brownout Brain — Build Plan (engineering only)

## Context
The user wants the plan cut down to just building the app: no pitch, demo script, submission, or schedule material. The app is an offline-first web app: a local map with facility markers, plus a chat assistant that answers from saved Markdown guides through a local Ollama model and cites its sources. It must run with Wi-Fi off. Target machine: i5-12450HX, RTX 3050 6 GB, 8 GB RAM.


---

## 1. Stack
- **Backend:** Python 3.11+, FastAPI, Uvicorn, `httpx` (Ollama client), `rank_bm25`, `pydantic`
- **LLM:** Ollama at `http://127.0.0.1:11434`, small instruct model (start with `qwen2.5:3b`, fall back to `qwen2.5:1.5b`)
- **Frontend:** plain HTML/CSS/JS. Every library is stored in `app/static/vendor/`; nothing loads from a CDN
- **Map:** MapLibre GL JS + `pmtiles.js` + a `.pmtiles` extract of the area, with **glyphs and sprites stored locally**. Fallback: Leaflet + one PNG via `L.imageOverlay`
- **Data:** `data/locations.json`, `data/guides/*.md`

## 2. File structure
```
brownout-brain/
  app/
    main.py              # FastAPI app, static mount, startup warm-up
    config.py            # paths, OLLAMA_URL, MODEL, THRESHOLD, TOP_K, HOST
    models.py            # pydantic schemas
    routes/locations.py
    routes/assistant.py
    services/locations.py  # load + validate locations.json once at startup
    services/retrieval.py  # chunk guides, BM25 index, search()
    services/llm.py        # Ollama chat (stream), warm-up, health
    static/
      index.html  styles.css  app.js  map.js  chat.js
      vendor/  (maplibre-gl.js/.css, pmtiles.js | leaflet.js/.css)
      map/     (area.pmtiles, style.json, glyphs/, sprites/ | fallback.png)
  data/locations.json
  data/guides/*.md
  tests/test_retrieval.py  test_api.py
  requirements.txt  README.md
```

## 3. Data formats
**locations.json** — array of:
`{id, name, type, address, lat, lng, source, verified_on, is_sample}`

**Guide Markdown:** front matter with `title`, `source`, `retrieved_on`, then `##` sections. Each `##` section is one chunk, and `chunk_id = "<file-stem>#<slug-of-heading>"`.

## 4. API
| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{backend, ollama: ok/down, model, model_loaded}` |
| GET | `/api/locations` | list of records |
| GET | `/api/locations/{id}` | record or 404 |
| POST | `/api/assistant/ask` | NDJSON stream |

**Ask request:** `{question: str (1–500), location_id: str|null}`. An unknown `location_id` returns 404.

**Stream format (NDJSON):**
- `{"type":"token","text":"..."}` repeated
- final event: `{"type":"done","status":"grounded"|"uncertain","sources":[{doc,chunk_id,title,excerpt}],"location_used":id|null}`
- on failure: `{"type":"error","message":"..."}`

## 5. Build steps (in order; each step ends runnable)

**Step 0: Online prep (do this first, while you still have internet)**
Machine check (2026-10-09): Python 3.14.3, Ollama 0.40.2 installed, **no models pulled**, Node 24 available.
- `ollama pull qwen2.5:3b` and `ollama pull qwen2.5:1.5b`.
- Create a venv: `python -m venv .venv`, then `pip install fastapi uvicorn httpx rank_bm25 pydantic pytest`. Confirm wheels install on Python 3.14; if any fail, install Python 3.12 and use that.
- **Pick the area and its bounding box** (bbox). The map extract can't be made without it.
- Download the `pmtiles` CLI (go-pmtiles release) and run the extract.
- Download a Protomaps basemap style plus glyphs and sprites (`protomaps/basemaps-assets`), and save `maplibre-gl` and `pmtiles` JS to `vendor/` at pinned versions. Also save Leaflet and a PNG of the area as the fallback.
- Collect **4–6 guide documents** and convert them to Markdown. The search threshold can't be tuned without real text.

Spec clarifications:
- **Gate rule:** `max_score < THRESHOLD` **and** fewer than 2 distinct query terms matched → "uncertain". If a location is selected, always pass its record, but chunks still have to clear the gate. With no passing chunks, the model answers from the record only, and the prompt says so. There is no attempt to detect "is this a location question."
- **Stream errors:** once streaming has started, the HTTP status is already 200, so failures are sent as an `error` event. Pre-stream validation failures still return 4xx.

**Step 1 — Skeleton**
- FastAPI app; mount `app/static` at `/`; `/api/health` returns a stub.
- `config.py` with env overrides; `HOST=127.0.0.1` by default.

**Step 2 — Locations**
- Load `locations.json` at startup into a dict keyed by id; validate with pydantic; fail loudly on bad data.
- Implement both location routes.
- Seed 8–10 **sample** records (`is_sample: true`) so the frontend can proceed in parallel.

**Step 3 — Retrieval**
- At startup, parse each guide's front matter and split on `##` headings into chunks.
- Tokenize: lowercase, strip punctuation, drop a small stopword list (English + common Filipino words like `ang, ng, sa, mga`).
- Build `BM25Okapi` over the chunk tokens.
- `search(query, k=TOP_K)` returns `[(chunk, score)]`.
- **Uncertainty gate:** if `max_score < THRESHOLD`, the result is "uncertain" and the LLM is not called. Tune `THRESHOLD` using a list of 10 covered and 5 uncovered questions in `tests/`.

**Step 4 — LLM service**
- `chat_stream(messages)` → `httpx.AsyncClient.stream("POST", f"{OLLAMA_URL}/api/chat", json={model, messages, stream: true, keep_alive: "30m", options: {num_ctx: 4096, temperature: 0.2}})`, yielding `message.content` pieces.
- `warm_up()` at startup: a 1-token request with `keep_alive` set, in a background task so startup doesn't block.
- `health()`: `GET /api/tags` and check that the model is present.
- Timeouts: connect 3 s, read 120 s. Turn connection errors into an `error` event.

**Step 5 — Assistant route**
- Validate the request → fetch the location → retrieve → gate → build the prompt → stream NDJSON via `StreamingResponse`.
- **System prompt:** answer only from CONTEXT; cite like `[go-bag#infants]`; if CONTEXT lacks the answer, say it isn't in the saved information; never claim a facility is open, safe, or has capacity; be brief.
- **User message:** `LOCATION:` record (if any), then `CONTEXT:` chunks each labeled with their chunk_id, then `QUESTION:`.
- `sources` lists only the chunks sent to the model.

**Step 6 — Map frontend** (in parallel with steps 3–5)
- Generate the extract: `pmtiles extract <protomaps build url> area.pmtiles --bbox=<minlon,minlat,maxlon,maxlat>` (done once, online).
- Get a Protomaps basemap `style.json`; rewrite its `glyphs`, `sprite`, and source URLs to local paths (`/map/glyphs/{fontstack}/{range}.pbf`, `pmtiles:///map/area.pmtiles`).
- Register the PMTiles protocol, add markers from `/api/locations`, and color them by `type`.
- **Hour-4 rule:** if labels or tiles still fail offline, switch to the Leaflet image fallback.
- OSM attribution is always visible.

**Step 7 — Location panel + chat UI**
- Clicking a marker opens a panel showing only the fields that exist, with a "SAMPLE DATA" badge when `is_sample` is true. "Ask about this place" sets `location_id`.
- Chat: `fetch` + `ReadableStream` reader, parsing NDJSON line by line, appending tokens, then rendering source chips (click to expand the excerpt).
- States: loading spinner, "model offline" banner (from `/api/health`), uncertain answers styled differently, error message plus a retry button.
- Input limited to 500 chars; disabled while streaming.

**Step 8 — Hardening**
- Error paths: Ollama stopped, model missing, empty or oversize question, unknown id, malformed JSON.
- Responsive layout: map on top with chat below on narrow screens; side by side on wide screens.
- Optional LAN mode: `HOST=0.0.0.0` behind an explicit flag; a note in the README to test the Windows hotspot with internet off.

**Step 9 — README**
Setup, `ollama pull`, map extract steps, run command, troubleshooting.

## 6. Tests
- `test_retrieval.py`: chunking yields the expected chunk IDs; covered questions score above `THRESHOLD`; uncovered ones score below.
- `test_api.py` (FastAPI `TestClient`, with the LLM mocked): health, locations list/404, ask → grounded stream with sources, ask → uncertain without calling the LLM (assert the mock wasn't called), Ollama down → error event, validation 422/404.

## 7. Verification (end-to-end, with Wi-Fi off)
1. `uvicorn app.main:app` → `/api/health` shows the model loaded.
2. Open the app; DevTools Network tab shows **only** `127.0.0.1` requests; map tiles and labels render.
3. Click a marker → the panel shows the record and its provenance.
4. Ask a covered question with a location selected → streamed answer with valid chunk citations.
5. Ask an uncovered question → fast "not in saved information" response (check the logs: no Ollama call).
6. Stop Ollama → a clear error in the UI, and the app keeps running.
7. `pytest` passes. Repeat steps 1–6 three times from a fresh launch.
