"""The website build (tools/build_site.py, GitHub Pages) and the paths it depends on.

The website is served from /OFFGRID/, the hub from /, so the app must never use "/..." paths,
and the website reads the pack's static lists instead of the hub's /api.
"""

import json
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"
sys.path.insert(0, str(ROOT / "tools"))
import build_site  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    async def no_warm_up():
        return None

    monkeypatch.setattr(llm, "warm_up", no_warm_up)
    with TestClient(app) as c:
        yield c


def test_build_marks_the_website_and_keeps_everything(tmp_path):
    out = tmp_path / "site"
    info = build_site.build(out)
    html = (out / "index.html").read_text(encoding="utf-8")
    assert build_site.SITE_META in html and html.index(build_site.SITE_META) < html.index("</head>")
    assert build_site.SITE_META not in (STATIC / "index.html").read_text(encoding="utf-8")  # the hub's copy is untouched
    assert (out / ".nojekyll").exists()
    for f in build_site.NEEDED + ["sw.js", "mode.js", "manifest.webmanifest", "lang/tl.json"]:
        assert (out / f).is_file(), f
    assert info["pack"] == json.loads((STATIC / "pack" / "version.json").read_text())["pack"]


def test_pack_lists_match_the_hub(client):
    """The website's places and hotlines are exactly what the hub serves."""
    assert json.loads((STATIC / "pack" / "locations.json").read_text(encoding="utf-8")) == client.get("/api/locations").json()
    assert json.loads((STATIC / "pack" / "hotlines.json").read_text(encoding="utf-8")) == client.get("/api/hotlines").json()


def test_no_root_paths_in_the_app():
    """A "/pack/..." path works on the hub but breaks under /OFFGRID/ on the website."""
    root_path = re.compile(r"""["'`(]/(api|pack|map|lang|vendor|icons|offline|sw\.js|app\.js|styles\.css|manifest)""")
    files = list(STATIC.glob("*.js")) + list((STATIC / "offline").glob("*.js")) + [
        STATIC / "index.html", STATIC / "privacy.html", STATIC / "manifest.webmanifest"]
    found = [f"{f.relative_to(STATIC)}:{n}: {line.strip()[:80]}"
             for f in files for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1)
             if root_path.search(line) and not line.lstrip().startswith("//")]
    assert found == []


def test_the_worker_saves_every_app_file():
    """sw.js must list every file the app loads, or the website breaks offline."""
    sw = (STATIC / "sw.js").read_text(encoding="utf-8")
    for f in [p.relative_to(STATIC).as_posix() for p in list(STATIC.glob("*.js")) + list((STATIC / "offline").glob("*.js"))
              if p.name != "sw.js"] + ["privacy.html", "lang/en.json", "lang/tl.json", "pack/locations.json", "pack/hotlines.json"]:
        assert f'"{f}"' in sw, f


def test_workflow_stays_free():
    wf = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert set(re.findall(r"runs-on:\s*(\S+)", wf)) == {"ubuntu-latest"}  # standard (free) runners only
    assert not re.search(r"^\s*lfs:\s*true", wf, re.M)  # Git LFS has paid data packs
    assert "python3 tools/build_site.py" in wf
