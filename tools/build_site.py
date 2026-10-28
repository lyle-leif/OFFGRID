"""Build the OFFGRID website (GitHub Pages): the app in its no-hub "website mode".

    python tools/build_site.py [--out _site]

Copies app/static as it is and marks index.html as the website version
(<meta name="offgrid-mode" content="site">, read by app/static/mode.js): no hub calls, no AI
summaries, no shared reports; answers, places and directions come from the phone engine,
exactly as on a phone whose hub is off. Python standard library only, so it runs in GitHub
Actions with nothing to install (.github/workflows/pages.yml). Nothing here costs money.

The data pack must be current: run tools/build_phone_pack.py after any data or app change
and commit app/static/pack/ before publishing.
"""

import argparse
import json
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


def build(out: Path) -> dict:
    missing = [f for f in NEEDED if not (STATIC / f).is_file()]
    if missing:
        raise SystemExit(f"Missing {', '.join(missing)}: run tools/build_phone_pack.py first.")
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC, out)

    index = out / "index.html"
    html = index.read_text(encoding="utf-8")
    if SITE_META not in html:
        html = html.replace("</head>", f"  {SITE_META}\n</head>", 1)
    index.write_text(html, encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")  # publish every file as it is

    files = [f for f in out.rglob("*") if f.is_file()]
    too_big = [f.relative_to(out).as_posix() for f in files if f.stat().st_size > MAX_FILE]
    if too_big:
        raise SystemExit(f"Over GitHub's 100 MB file limit: {', '.join(too_big)}")
    version = json.loads((out / "pack" / "version.json").read_text(encoding="utf-8"))
    return {"pack": version["pack"], "files": len(files), "mb": round(sum(f.stat().st_size for f in files) / 1e6, 1)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(ROOT / "_site"), help="output folder (default: _site)")
    out = Path(ap.parse_args().out).resolve()
    info = build(out)
    print(f"Website built in {out}: pack {info['pack']}, {info['files']} files, {info['mb']} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
