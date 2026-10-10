"""Phone setup page for the hub: trust the hub's certificate once, then install OFFGRID.

Served over plain http on the hub's setup port (8080), because a phone can't open the
secure address until it trusts the hub. From other devices, that port serves only this page
and the certificate; everything else redirects here (see main.py).
"""

import base64
import hashlib
import html
import os
import re
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response

ROOT = Path(__file__).resolve().parent.parent.parent
CA_CRT = ROOT / "certs" / "offgrid-ca.crt"
HTTPS_PORT = int(os.getenv("BB_HTTPS_PORT", "8443"))

router = APIRouter()


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
        return Response("The hub isn't set up yet. Run start_hub.bat on the laptop.", status_code=404)
    return Response(CA_CRT.read_bytes(), media_type="application/x-x509-ca-cert",
                    headers={"Content-Disposition": 'attachment; filename="offgrid-ca.crt"'})


@router.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request):
    host = (request.headers.get("host") or request.url.hostname or "").split(":")[0]
    app_url = f"https://{host}:{HTTPS_PORT}/"
    fp = ca_fingerprint()
    if fp is None:
        body = "<p class='warn'>The hub isn't set up yet. On the laptop, run <b>start_hub.bat</b>, then reload this page.</p>"
    else:
        short = fp.replace(":", "")[:16]
        body = f"""
<ol class="steps">
  <li><b>Save the hub's certificate</b><br>
    <a class="btn" href="/offgrid-ca.crt" download>Download certificate</a>
    <p class="small">Compare this code with the one on the hub laptop's screen. They must match:<br>
    <code>{html.escape(short[:4])} {html.escape(short[4:8])} {html.escape(short[8:12])} {html.escape(short[12:16])}…</code></p></li>
  <li><b>Install it (Android)</b><br>
    Open <b>Settings → Security</b> (or <b>Security &amp; privacy</b>) → <b>More security settings</b> →
    <b>Encryption &amp; credentials</b> → <b>Install a certificate</b> → <b>CA certificate</b> →
    <b>Install anyway</b>, and choose <b>offgrid-ca.crt</b> from Downloads.
    <p class="small">On Android 8–9: Settings → Security &amp; location → Encryption &amp; credentials →
    Install from storage. Android may ask you to set a screen lock first; that's normal.</p>
    <p class="small"><b>iPhone (Safari)</b>, two steps, both needed:<br>
    1. Settings → <b>Profile Downloaded</b> (or General → VPN &amp; Device Management) → <b>Install</b>.<br>
    2. Settings → General → About → <b>Certificate Trust Settings</b> → turn on <b>OFFGRID Hub</b>.</p></li>
  <li><b>Open OFFGRID</b><br>
    <a class="btn" href="{html.escape(app_url)}">Open {html.escape(app_url)}</a>
    <p class="small"><b>Android (Chrome):</b> menu (⋮) → <b>Install app</b> or <b>Add to Home screen</b>.<br>
    <b>iPhone (Safari):</b> Share button → <b>Add to Home Screen</b> → Add, then open OFFGRID <b>from the new icon</b>.</p>
    <p class="small">Keep it open until it says <b>“Saved on this phone”</b> (about 46 MB, a minute or two on hub Wi-Fi).
    After that OFFGRID works on this phone with no hub and no internet.</p></li>
</ol>
<p class="small">This certificate only works for private network addresses (like 192.168.x.x),
so it can't be used to fake real websites. You can remove it any time in the same Settings screen.</p>"""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OFFGRID setup</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 0; padding: 20px 16px 40px; background: #0b1220; color: #e2e8f0; line-height: 1.5; }}
  main {{ max-width: 560px; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }} .lead {{ color: #94a3b8; margin: 0 0 20px; }}
  .steps {{ padding-left: 22px; }} .steps li {{ margin-bottom: 22px; }}
  .btn {{ display: inline-block; margin: 8px 0; padding: 10px 16px; border-radius: 10px; background: #d9480f;
          color: #fff; text-decoration: none; font-weight: 600; word-break: break-all; }}
  .small {{ font-size: 13.5px; color: #94a3b8; margin: 6px 0 0; }} code {{ font-size: 16px; color: #fff; letter-spacing: .05em; }}
  .warn {{ color: #ffb3b3; }}
</style></head>
<body><main>
<h1>Set up OFFGRID on this phone</h1>
<p class="lead">One time only, while you're on the hub's Wi-Fi. Then OFFGRID keeps working even when the hub
and the internet are gone.</p>
{body}
</main></body></html>"""
