import pytest

from app import config


@pytest.fixture(autouse=True)
def reports_db(tmp_path, monkeypatch):
    """Every test gets its own empty reports database, never data/reports.db."""
    path = tmp_path / "reports.db"
    monkeypatch.setattr(config, "REPORTS_DB", path)
    return path
