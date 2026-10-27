"""Phone setup page for the hub: trust the hub's certificate once, then install OFFGRID.

Served over plain http on the hub's setup port (8080), because a phone can't open the
secure address until it trusts the hub. From other devices, that port serves only this page
and the certificate; everything else redirects here (see main.py).

In Tagalog or English (setup.* in app/static/lang/<lang>.json): ?lang=tl|en, else the
browser's language. The texts are trusted HTML from those files; values are escaped here.
"""

import base64
import hashlib
import html
import os
import re
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response

from app.services.i18n import LANGS, t

ROOT = Path(__file__).resolve().parent.parent.parent
CA_CRT = ROOT / "certs" / "offgrid-ca.crt"
HTTPS_PORT = int(os.getenv("BB_HTTPS_PORT", "8443"))

router = APIRouter()
LANG_NAMES = {"tl": ("Tagalog", "fil"), "en": ("English", "en")}


def page_lang(request: Request) -> str:
    asked = request.query_params.get("lang")
    if asked in LANGS:
        return asked
    accept = (request.headers.get("accept-language") or "").lower()
    return "tl" if re.search(r"(^|[\s,])(fil|tl)\b", accept) else "en"


def ca_fingerprint() -> str | None:
    """SHA-256 of the CA certificate (DER), as shown on the hub's screen, to compare."""
    if not CA_CRT.exists():
        return None
    pem = CA_CRT.read_text(encoding="ascii")
    der = base64.b64decode("".join(re.findall(r"^[A-Za-z0-9+/=]+$", pem.split("-----BEGIN CERTIFICATE-----")[1]
                                              .split("-----END CERTIFICATE-----")[0], re.MULTILINE)))
    digest = hashlib.sha256(der).hexdigest().upper()
    return ":".join(digest[i:i + 2] for i in range(0, len(digest), 2))


@router.get("/offgrid-ca.crt")
def ca_certificate():
    if not CA_CRT.exists():
        return Response(t("en", "setup.cert_missing"), status_code=404)
    return Response(CA_CRT.read_bytes(), media_type="application/x-x509-ca-cert",
                    headers={"Content-Disposition": 'attachment; filename="offgrid-ca.crt"'})


@router.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request):
    host = (request.headers.get("host") or request.url.hostname or "").split(":")[0]
    app_url = f"https://{host}:{HTTPS_PORT}/"
    lang = page_lang(request)
    fp = ca_fingerprint()
    if fp is None:
        body = f"<p class='warn'>{t(lang, 'setup.not_ready')}</p>"
    else:
        short = fp.replace(":", "")[:16]
        body = f"""
<ol class="steps">
  <li><b>{t(lang, "setup.s1")}</b><br>
    <a class="btn" href="/offgrid-ca.crt" download>{t(lang, "setup.download")}</a>
    <p class="small">{t(lang, "setup.compare")}<br>
    <code>{html.escape(short[:4])} {html.escape(short[4:8])} {html.escape(short[8:12])} {html.escape(short[12:16])}…</code></p></li>
  <li><b>{t(lang, "setup.s2")}</b><br>
    {t(lang, "setup.android")}
    <p class="small">{t(lang, "setup.android8")}</p>
    <p class="small">{t(lang, "setup.iphone")}</p></li>
  <li><b>{t(lang, "setup.s3")}</b><br>
    <a class="btn" href="{html.escape(app_url)}">{t(lang, "setup.open", url=html.escape(app_url))}</a>
    <p class="small">{t(lang, "setup.install")}</p>
    <p class="small">{t(lang, "setup.keep_open")}</p></li>
</ol>
<p class="small">{t(lang, "setup.cert_note")}</p>"""
    switch = " · ".join(
        f"<b>{name}</b>" if code == lang else f'<a href="/setup?lang={code}" hreflang="{tag}">{name}</a>'
        for code, (name, tag) in LANG_NAMES.items())
    return f"""<!doctype html>
<html lang="{LANG_NAMES[lang][1]}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t(lang, "setup.title")}</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 0; padding: 20px 16px 40px; background: #0b1220; color: #e2e8f0; line-height: 1.5; }}
  main {{ max-width: 560px; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }} .lead {{ color: #94a3b8; margin: 0 0 20px; }}
  .steps {{ padding-left: 22px; }} .steps li {{ margin-bottom: 22px; }}
  .btn {{ display: inline-block; margin: 8px 0; padding: 10px 16px; border-radius: 10px; background: #d9480f;
          color: #fff; text-decoration: none; font-weight: 600; word-break: break-all; }}
  .small {{ font-size: 13.5px; color: #94a3b8; margin: 6px 0 0; }} code {{ font-size: 16px; color: #fff; letter-spacing: .05em; }}
  .warn {{ color: #ffb3b3; }}
  .langs {{ margin: 0 0 14px; font-size: 14px; color: #94a3b8; }} .langs a {{ color: #e2e8f0; }}
</style></head>
<body><main>
<p class="langs">{switch}</p>
<h1>{t(lang, "setup.h1")}</h1>
<p class="lead">{t(lang, "setup.lead")}</p>
{body}
</main></body></html>"""
