"""Thin async client for the local Ollama runtime."""

import json
from collections.abc import AsyncIterator

import httpx

from app import config


class LLMError(Exception):
    """Raised with a message that is safe to show in the UI."""


def _timeout() -> httpx.Timeout:
    return httpx.Timeout(connect=3.0, read=120.0, write=10.0, pool=5.0)


async def chat_stream(messages: list[dict]) -> AsyncIterator[str]:
    payload = {
        "model": config.MODEL,
        "messages": messages,
        "stream": True,
        "keep_alive": config.KEEP_ALIVE,
        "options": {"num_ctx": config.NUM_CTX, "temperature": 0.2},
    }
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            async with client.stream("POST", f"{config.OLLAMA_URL}/api/chat", json=payload) as r:
                if r.status_code == 404:
                    raise LLMError(f"Model '{config.MODEL}' is not installed. Run: ollama pull {config.MODEL}")
                if r.status_code != 200:
                    body = (await r.aread()).decode(errors="replace")[:200]
                    raise LLMError(f"Local model returned an error ({r.status_code}): {body}")
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    if data.get("error"):
                        raise LLMError(f"Local model error: {data['error']}")
                    piece = data.get("message", {}).get("content", "")
                    if piece:
                        yield piece
                    if data.get("done"):
                        return
    except httpx.ConnectError as e:
        raise LLMError("Cannot reach the local model runtime. Is Ollama running?") from e
    except httpx.TimeoutException as e:
        raise LLMError("The local model took too long to respond.") from e


async def health() -> dict:
    """Ollama reachability, whether the model is installed, and whether it is loaded in memory."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
            tags = (await client.get(f"{config.OLLAMA_URL}/api/tags")).json()
            ps = (await client.get(f"{config.OLLAMA_URL}/api/ps")).json()
    except (httpx.HTTPError, ValueError):
        return {"ollama": "down", "model": config.MODEL, "model_installed": False, "model_loaded": False}
    names = {m.get("name") for m in tags.get("models", [])}
    loaded = {m.get("name") for m in ps.get("models", [])}
    return {
        "ollama": "ok",
        "model": config.MODEL,
        "model_installed": config.MODEL in names,
        "model_loaded": config.MODEL in loaded,
    }


async def warm_up() -> None:
    """Load the model into memory so the first real question is not a cold start."""
    payload = {"model": config.MODEL, "keep_alive": config.KEEP_ALIVE}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=3.0, read=180.0, write=10.0, pool=5.0)) as client:
            await client.post(f"{config.OLLAMA_URL}/api/generate", json=payload)
    except httpx.HTTPError:
        pass  # health endpoint will report the problem
