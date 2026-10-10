import json
import logging
import re
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app import config
from app.models import AskRequest, Location, Previous, Source
from app.routes import place_answers
from app.routes.reports import active_public
from app.routes.directions import compute_route
from app.services import intents, llm, report_answers
from app.services.verify import unsupported_facts
from app.services.retrieval import Hit

router = APIRouter(prefix="/api/assistant")
PASSAGES_SHOWN = 2  # guide sections shown word-for-word above the AI summary
log = logging.getLogger("offgrid.assistant")

NOT_COVERED = (
    "I can't find this in the saved emergency information on this device, so I can't answer it "
    "reliably. For current conditions or anything urgent, follow official announcements and "
    "local authorities, or call 911."
)

SYSTEM_PROMPT = """You are OFFGRID, an offline emergency information assistant.
Rules:
- Answer ONLY using the LOCATION record and CONTEXT passages provided. Do not use outside knowledge.
- After each fact taken from CONTEXT, cite its id in square brackets, e.g. [go-bag#documents].
- If the provided information does not answer the question, say plainly that it is not in the saved information.
- Never claim a facility is open, safe, has space, or has supplies. Saved records do not show current conditions.
- Never invent names, phone numbers, addresses, routes, or hazard conditions. Only give a phone number that appears in the LOCATION record or CONTEXT.
- When giving phone numbers, copy each number together with its office name exactly as written; do not reformat or regroup them. For emergencies, mention 911 first.
- Be brief and practical: short sentences or a short bulleted list.
- Reply in the same language as the question (English or Filipino)."""


def _event(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")


def _location_block(loc: Location) -> str:
    fields = {
        "name": loc.name,
        "type": loc.type.replace("_", " "),
        "address": loc.address,
        "description": loc.description,
        "coordinates": f"{loc.lat:.5f}, {loc.lng:.5f}",
        "phone": loc.phone,
        "opening_hours": loc.opening_hours,
        "website": loc.website,
        "source": loc.source,
        "verified_on": loc.verified_on,
        "note": (
            "SAMPLE record for testing, not a real facility" if loc.is_sample
            else "Community-mapped record (OpenStreetMap), not an official government list; details may be outdated"
            if loc.osm_url else None
        ),
    }
    return "\n".join(f"{k}: {v}" for k, v in fields.items() if v)


def build_messages(
    question: str, loc: Location | None, hits: list[Hit], previous: Previous | None = None
) -> list[dict]:
    parts = []
    if loc:
        parts.append(f"LOCATION:\n{_location_block(loc)}")
    if hits:
        ctx = "\n\n".join(f"[{h.chunk.chunk_id}] {h.chunk.doc_title} - {h.chunk.title}\n{h.chunk.text}" for h in hits)
        parts.append(f"CONTEXT:\n{ctx}")
    else:
        parts.append("CONTEXT:\n(no saved guide passages matched this question)")
    parts.append(f"QUESTION:\n{question}")
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if previous:
        # Earlier turn, so follow-ups like "what about for elderly people?" make sense.
        messages += [
            {"role": "user", "content": previous.question},
            {"role": "assistant", "content": previous.answer},
        ]
    messages.append({"role": "user", "content": "\n\n".join(parts)})
    return messages


def _sources(hits: list[Hit]) -> list[dict]:
    out = []
    for h in hits:
        text = h.chunk.text
        excerpt = text if len(text) <= 280 else text[:277].rsplit(" ", 1)[0] + "..."
        out.append(Source(doc=h.chunk.doc, chunk_id=h.chunk.chunk_id, title=h.chunk.title, excerpt=excerpt).model_dump())
    return out


def _find_evidence(retriever, question: str, previous: Previous | None) -> list[Hit]:
    def run(q: str) -> list[Hit]:
        return retriever.evidence(
            q, config.TOP_K, config.THRESHOLD, config.MIN_TERMS, config.STRONG_SCORE, config.RELATIVE_SCORE
        )

    hits = run(question)
    # Borrow the previous topic only for a real follow-up: a cue ("what about…", "and for…")
    # or a very short question ("para sa matanda?"). A new, unrelated question that finds
    # nothing must say "not covered", not repeat the last answer.
    short = len(question.split()) <= 4
    if previous and (intents.FOLLOW_UP.search(question) or (not hits and short)):
        # Follow-up ("what about for elderly?"): also search with the previous question's topic.
        seen = {h.chunk.chunk_id for h in hits}
        hits += [h for h in run(f"{previous.question} {question}") if h.chunk.chunk_id not in seen]
        hits = hits[: config.TOP_K]
    return _with_national_hotline(retriever, hits)


NATIONAL_HOTLINE_ID = "hotlines#national-emergency-hotline-911"


def _with_national_hotline(retriever, hits: list[Hit]) -> list[Hit]:
    """Any hotline answer should also be able to mention 911."""
    if not any(h.chunk.doc == "hotlines.md" for h in hits):
        return hits
    if any(h.chunk.chunk_id == NATIONAL_HOTLINE_ID for h in hits):
        return hits
    chunk = next((c for c in retriever.chunks if c.chunk_id == NATIONAL_HOTLINE_ID), None)
    return hits + [Hit(chunk, 0.0, 0)] if chunk else hits


# Phrases small models use when the context does not answer the question.
_REFUSAL = re.compile(
    r"(not (in|included in|found in|part of|covered (in|by)) the (saved|provided|given)"
    r"|(does not|doesn't|do not|don't) (contain|include|mention|provide|cover|have)"
    r"|no (information|details|mention) (about|on|regarding|of|provided|available|given)"
    r"|(is|are) not (mentioned|provided|available|specified)"
    r"|wala(ng)? (sa|impormasyon))",
    re.IGNORECASE,
)


_CITATION = re.compile(r"\[([a-z0-9-]+#[a-z0-9-]+)\]")


def looks_like_refusal(answer: str, valid_ids: set[str]) -> bool:
    """The reply opens by saying the information is missing and cites no real section.
    Answers that cite a guide but mention a gap later still count as answers.
    Citation ids the model invented (not in `valid_ids`) do not count."""
    a = answer.strip()
    if not a:
        return True
    first_sentence = re.split(r"(?<=[.!?])\s", a, maxsplit=1)[0]
    cites_real = any(m in valid_ids for m in _CITATION.findall(a))
    return bool(_REFUSAL.search(first_sentence)) and not cites_real


is_direction_question = intents.is_direction_question


def report_lines(r: dict) -> list[str]:
    """What a route did about reported flooded or blocked roads."""
    out = []
    if n := len(r.get("avoided_reports", [])):
        out.append(f"This route goes around {n} road{'s' if n > 1 else ''} people reported flooded or blocked.")
    if n := len(r.get("through_reports", [])):
        out.append(f"Warning: this route uses {n} road{'s' if n > 1 else ''} people reported flooded or blocked. "
                   "Check before you go.")
    return out


def format_route(r: dict) -> str:
    how = "Walking" if r["mode"] == "walk" else "Driving"
    km = r["distance_m"] / 1000
    lines = [f"{how} route to {r['to_name']}: {km:.1f} km, about {r['duration_min']} min."]
    for i, step in enumerate(r["steps"], 1):
        dist = f" ({step['distance_m']} m)" if step["distance_m"] else ""
        lines.append(f"{i}. {step['instruction']}{dist}")
    lines.append("")
    lines += report_lines(r)
    lines.append(r["warning"])
    return "\n".join(lines)


def directions_stream(body: AskRequest, request: Request, loc: Location | None):
    """Direction questions are answered from the road graph, never by the language model."""
    if not loc or not body.from_pos:
        missing = []
        if not loc:
            missing.append("select the place you want to go to (on the map or in the Facilities list)")
        if not body.from_pos:
            missing.append("set your location with the \"Set my location\" button on the map")
        text = "To get directions, " + " and ".join(missing) + ". Then ask again or press Directions."
        return [_event({"type": "token", "text": text}),
                _event({"type": "done", "status": "needs_input", "sources": [], "location_used": None})]
    try:
        r = compute_route(request, body.from_pos.lat, body.from_pos.lng, loc.id, body.travel_mode)
    except HTTPException as e:
        return [_event({"type": "error", "message": e.detail})]
    return [_event({"type": "token", "text": format_route(r)}),
            _event({"type": "done", "status": "route", "sources": [], "location_used": loc.id, "route": r})]


@router.post("/ask")
async def ask(body: AskRequest, request: Request):
    state = request.app.state
    loc = None
    if body.location_id:
        loc = state.locations.get(body.location_id)
        if loc is None:
            raise HTTPException(404, f"Unknown location_id '{body.location_id}'")

    # Fix typos and text-speak first ("neerest hospitl" -> "nearest hospital"); everything
    # below works on the cleaned-up question. The AI still sees what the person typed too.
    typed = body.question
    norm = state.normalizer.normalize
    body = body.model_copy(update={
        "question": norm(typed),
        "previous": body.previous.model_copy(update={"question": norm(body.previous.question)}) if body.previous else None,
    })
    if body.question != typed.lower().strip():
        log.info("ask normalized %r -> %r", typed[:80], body.question[:80])

    intent = intents.detect(body.question, has_place=loc is not None)
    if intent:
        try:
            text, done = place_answers.answer(intent, request, body, loc)
        except place_answers.NeedsInput as e:
            text, done = str(e), {"status": "needs_input"}
        log.info("ask q=%r intent=%s status=%s", body.question[:80], intent, done["status"])
        events = [
            _event({"type": "token", "text": text}),
            _event({"type": "done", "sources": [], "location_used": None, **done}),
        ]

        async def intent_stream():
            for ev in events:
                yield ev

        return StreamingResponse(intent_stream(), media_type="application/x-ndjson")

    # "Is the road flooded?", "Is the evacuation center full?": answered from situation
    # reports people posted to this hub, with their age and trust label. Never the AI.
    kinds = intents.report_query(body.question, place_is_center=bool(loc and "evacuation_center" in (loc.type, *loc.also)))
    if kinds:
        place = {"id": loc.id, "name": loc.name, "lat": loc.lat, "lng": loc.lng} if loc else None
        pos = (body.from_pos.lat, body.from_pos.lng) if body.from_pos else None
        text, done = report_answers.answer(body.question, kinds, active_public(request), place, pos)
        log.info("ask q=%r reports=%s status=%s n=%d", body.question[:80], kinds, done["status"], len(done["reports"]))
        events = [_event({"type": "token", "text": text}), _event({"type": "done", "sources": [], **done})]

        async def reports_stream():
            for ev in events:
                yield ev

        return StreamingResponse(reports_stream(), media_type="application/x-ndjson")

    if is_direction_question(body.question):
        events = directions_stream(body, request, loc)

        async def route_stream():
            for ev in events:
                yield ev

        return StreamingResponse(route_stream(), media_type="application/x-ndjson")

    hits = _find_evidence(state.retriever, body.question, body.previous)
    log.info("ask q=%r loc=%s followup=%s hits=%s", body.question[:80], body.location_id, bool(body.previous),
             [(h.chunk.chunk_id, round(h.score, 2), h.matched_terms) for h in hits])

    async def gate_stream():
        yield _event({"type": "token", "text": NOT_COVERED})
        yield _event({"type": "done", "status": "uncertain", "sources": [], "location_used": None})

    async def answer_stream():
        """Guide text first (instant, exact, works without the AI), then an optional AI
        summary that is only kept if every checkable detail in it is in the sources."""
        t0 = time.perf_counter()
        timing = {}
        passages = [
            {"doc": h.chunk.doc, "chunk_id": h.chunk.chunk_id, "doc_title": h.chunk.doc_title,
             "title": h.chunk.title, "text": h.chunk.text}
            for h in hits[:PASSAGES_SHOWN]
        ]
        if passages:
            yield _event({"type": "passages", "passages": passages})
        # The AI summarises only what the person can see (plus 911 for hotline answers), so it
        # never builds its answer on a weaker section that isn't on screen.
        shown = hits[:PASSAGES_SHOWN] + [h for h in hits[PASSAGES_SHOWN:] if h.chunk.chunk_id == NATIONAL_HOTLINE_ID]
        done = {
            "type": "done",
            "status": "grounded",
            "sources": _sources(shown),
            "location_used": loc.id if loc else None,
        }

        if not body.use_ai:
            # Battery saver: no model call at all.
            if not passages:  # location-only question: the saved record is the answer
                yield _event({"type": "token", "text": _location_block(loc)})
            log.info("ask answered from guide text only (battery saver)")
            yield _event({**done, "summary": "skipped", "timing": {"total_ms": _ms(t0)}})
            return

        answer = ""
        t_ai = time.perf_counter()
        try:
            asked = typed if typed.lower().strip() == body.question else f"{typed}\n(Spelling corrected: {body.question})"
            async for piece in llm.chat_stream(build_messages(asked, loc, shown, body.previous)):
                answer += piece
                yield _event({"type": "token", "text": piece})
        except llm.LLMError as e:
            if not passages:
                yield _event({"type": "error", "message": str(e)})
                return
            # The guide text already answers the question; the AI is just unavailable.
            log.info("AI unavailable (%s); answered with guide text only", e)
            yield _event({**done, "summary": "unavailable", "summary_error": str(e),
                          "timing": {"total_ms": _ms(t0)}})
            return
        except Exception:
            log.exception("unexpected error while streaming")
            yield _event({"type": "error", "message": "Unexpected server error while generating the answer."})
            return
        timing = {"ai_ms": _ms(t_ai), "total_ms": _ms(t0)}

        if looks_like_refusal(answer, {h.chunk.chunk_id for h in shown}):
            log.info("model said the answer is not in the saved information")
            yield _event({"type": "done", "status": "uncertain", "sources": [], "location_used": None,
                          "summary": "refused", "timing": timing})
            return

        # Every number, phone and name in the summary must be in what the model was shown
        # (guide passages, the place record) or in the user's own question.
        sources_text = [h.chunk.text for h in shown] + [f"{h.chunk.doc_title} {h.chunk.title}" for h in shown]
        if loc:
            sources_text.append(_location_block(loc))
        sources_text += [typed, body.question]
        unsupported = unsupported_facts(answer, sources_text)
        # A citation of a section the AI was not shown means it made the point up (small models
        # sometimes invent "[go-bag#documents]" for text that is in no guide): hide the summary.
        unsupported += sorted(set(_CITATION.findall(answer)) - {h.chunk.chunk_id for h in shown})
        if unsupported:
            log.info("AI summary dropped, unsupported details: %s", unsupported)
            if not passages:
                # Nothing exact to fall back on: say so rather than show unchecked text.
                yield _event({"type": "done", "status": "uncertain", "sources": [], "location_used": None,
                              "summary": "dropped", "unsupported": unsupported, "timing": timing})
                return
            yield _event({**done, "summary": "dropped", "unsupported": unsupported, "timing": timing})
            return
        log.info("AI summary verified in %d ms", timing["ai_ms"])
        yield _event({**done, "summary": "verified", "timing": timing})

    # Deterministic gate: no evidence and no location record -> never call the model.
    stream = answer_stream() if (hits or loc) else gate_stream()
    return StreamingResponse(stream, media_type="application/x-ndjson")


def _ms(t0: float) -> int:
    return round((time.perf_counter() - t0) * 1000)
