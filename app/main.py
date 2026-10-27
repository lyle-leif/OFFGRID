"""OFFGRID: offline emergency map + local AI assistant.

Run:  .venv\\Scripts\\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
"""

import asyncio
import functools
import mimetypes
import os
import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import config
from app.routes import assistant, directions, locations, reports, setup
from app.services import llm
from app.services.locations import LocationStore
from app.services.normalize import Normalizer, build_lexicon
from app.services.reports import Limiter, ReportStore
from app.services import intents
from app.services.retrieval import STOPWORDS, SYNONYM_WORDS, Retriever, load_chunks
from app.services.routing import Router

# File types the installable phone app needs that Python doesn't know by default.
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/x-protobuf", ".pbf")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@functools.cache
def _load_router() -> Router | None:
    # Loading and indexing ~50k junctions takes about a second, so do it once per process.
    return Router.load(config.ROADS_FILE) if config.ROADS_FILE.exists() else None


def app_lexicon(chunks, locations, router) -> dict:
    """The spelling dictionary (tools/build_phone_pack.py exports the same one to phones)."""
    places = [loc.name for loc in locations.all()] + [loc.address or "" for loc in locations.all()]
    if router is not None:
        places += sorted({e.name for e in router.edges if e.name})
    return build_lexicon(chunks, intents.PATTERNS, SYNONYM_WORDS, STOPWORDS, places)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.locations = LocationStore(config.LOCATIONS_FILE)
    app.state.retriever = Retriever(load_chunks(config.GUIDES_DIR))
    # Directions are optional: without data/roads.json.gz the rest of the app still works.
    app.state.router = _load_router()
    app.state.normalizer = Normalizer(app_lexicon(app.state.retriever.chunks, app.state.locations, app.state.router))
    app.state.reports = ReportStore(config.REPORTS_DB)
    app.state.report_limits = {"device": Limiter(10, 3600), "ip": Limiter(30, 3600)}
    app.state.pin_failures = Limiter(5, 600)
    app.state.responder_pin = config.RESPONDER_PIN or f"{secrets.randbelow(10**6):06d}"
    if not config.RESPONDER_PIN:
        logging.getLogger("offgrid").info("responder PIN for this session: %s", app.state.responder_pin)
    logging.getLogger("offgrid").info(
        "loaded %d locations, %d guide chunks, roads=%s; model=%s",
        len(app.state.locations.all()), len(app.state.retriever.chunks),
        f"{len(app.state.router.nodes)} junctions" if app.state.router else "missing", config.MODEL,
    )
    warm = asyncio.create_task(llm.warm_up())
    yield
    warm.cancel()
    app.state.reports.close()


app = FastAPI(title="OFFGRID", lifespan=lifespan)
app.include_router(locations.router)
app.include_router(assistant.router)
app.include_router(directions.router)
app.include_router(reports.router)
app.include_router(setup.router)

# Hub setup port (start_hub.bat sets BB_LAN_SETUP=1 on the plain-http port 8080): other
# devices may only reach the setup page and the certificate there. They use the app over
# https (port 8443), which phones need for the offline copy and GPS. The laptop itself
# (loopback) gets the full app on this port.
if os.getenv("BB_LAN_SETUP") == "1":
    SETUP_PATHS = {"/setup", "/offgrid-ca.crt"}

    @app.middleware("http")
    async def lan_setup_only(request: Request, call_next):
        client = request.client.host if request.client else ""
        if client not in ("127.0.0.1", "::1", "localhost") and request.url.path not in SETUP_PATHS:
            return RedirectResponse("/setup")
        return await call_next(request)


@app.get("/api/health")
async def health(request: Request):
    return {
        "backend": "ok",
        "locations": len(request.app.state.locations.all()),
        "guide_chunks": len(request.app.state.retriever.chunks),
        "reports": len(request.app.state.reports.active()),
        **(await llm.health()),
    }


@app.get("/api/hotlines")
def hotlines(request: Request):
    """Sections of data/guides/hotlines.md, for the Hotlines tab."""
    return [
        {"title": c.title, "text": c.text, "chunk_id": c.chunk_id, **c.trust()}
        for c in request.app.state.retriever.chunks
        if c.doc == "hotlines.md"
    ]


# Mounted last so /api/* routes win.
app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")
