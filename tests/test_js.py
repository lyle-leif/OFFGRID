"""Run the phone-engine parity tests (Node) as part of pytest."""

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")
def test_phone_engine_matches_hub():
    result = subprocess.run(
        ["node", "--test", "tests/js/parity.test.mjs"], cwd=ROOT, capture_output=True, text=True, timeout=600
    )
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-2000:]
