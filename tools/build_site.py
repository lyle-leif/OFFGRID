"""Build the OFFGRID website (GitHub Pages): the app in its no-hub "website mode".

    python tools/build_site.py [--out _site]

Copies app/static as it is and marks index.html as the website version
(<meta name="offgrid-mode" content="site">, read by app/static/mode.js): no hub calls, no AI
summaries, no shared reports; answers, places and directions come from the phone engine,
exactly as on a phone whose hub is off. Python standard library only, so it runs in GitHub
Actions with nothing to install (.github/workflows/pages.yml). Nothing here costs money.

Online reports: when cloud/site.json has the address of the online-reports Worker (cloud/,
set by tools/cloud_admin.mjs setup), or --cloud gives one, index.html also gets
<meta name="offgrid-cloud" content="<address>"> and the website shares reports through it.

The data pack must be current: run tools/build_phone_pack.py after any data or app change
and commit app/static/pack/ before publishing.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"
SITE_META = '<meta name="offgrid-mode" content="site">'
# The pack files the website reads instead of the hub's /api (see tools/build_phone_pack.py).
NEEDED = ["pack/version.json", "pack/guides.json", "pack/lexicon.json", "pack/roads.bin", "pack/roads-meta.json",
          "pack/locations.json", "pack/hotlines.json", "map/area.pmtiles", "privacy.html"]
MAX_FILE = 100 * 1000 * 1000  # GitHub's per-file limit
CLOUD_FILE = ROOT / "cloud" / "site.json"


def cloud_url() -> str:
    """The online-reports address from cloud/site.json, or "" when it isn't set up."""
    try:
        return json.loads(CLOUD_FILE.read_text(encoding="utf-8")).get("url", "")
    except FileNotFoundError:
        return ""


def build(out: Path, cloud: str | None = None) -> dict:
    cloud = cloud_url() if cloud is None else cloud
    if cloud and not re.fullmatch(r"https?://[A-Za-z0-9.:-]+/", cloud):
        raise SystemExit(f"The online-reports address must look like https://name.example.workers.dev/ (got {cloud!r})")
    missing = [f for f in NEEDED if not (STATIC / f).is_file()]
    if missing:
        raise SystemExit(f"Missing {', '.join(missing)}: run tools/build_phone_pack.py first.")
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC, out)

    index = out / "index.html"
    html = index.read_text(encoding="utf-8")
    if SITE_META not in html:
        meta = SITE_META + (f'\n  <meta name="offgrid-cloud" content="{cloud}">' if cloud else "")
        html = html.replace("</head>", f"  {meta}\n</head>", 1)
    index.write_text(html, encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")  # publish every file as it is

    files = [f for f in out.rglob("*") if f.is_file()]
    too_big = [f.relative_to(out).as_posix() for f in files if f.stat().st_size > MAX_FILE]
    if too_big:
        raise SystemExit(f"Over GitHub's 100 MB file limit: {', '.join(too_big)}")
    version = json.loads((out / "pack" / "version.json").read_text(encoding="utf-8"))
    return {"pack": version["pack"], "files": len(files), "mb": round(sum(f.stat().st_size for f in files) / 1e6, 1),
            "cloud": cloud}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(ROOT / "_site"), help="output folder (default: _site)")
    ap.add_argument("--cloud", default=None, help="online-reports address (default: cloud/site.json; '' for none)")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    info = build(out, a.cloud)
    print(f"Website built in {out}: pack {info['pack']}, {info['files']} files, {info['mb']} MB, "
          f"online reports: {info['cloud'] or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
