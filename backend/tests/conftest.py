"""Test isolation.

Guarantees tests NEVER touch the real dev database and are deterministic
regardless of import order (previously each test module set ATLAS_DATABASE_PATH
at import time, but get_settings() is lru_cached, so whichever module imported
first silently won the DB path for all of them).

Strategy: an autouse fixture points every test at its own fresh temp SQLite DB
and clears the settings cache. Each test uses `with TestClient(app)`, whose
lifespan re-runs initialize_database() against that fresh path — so tests get
full per-test isolation.
"""

import os
import tempfile
from pathlib import Path

import pytest

# Import-time safety net: ensure the very first import of the app already has a
# throwaway DB, before the autouse fixture takes over per test.
os.environ.setdefault(
    "ATLAS_DATABASE_PATH",
    str(Path(tempfile.mkdtemp(prefix="atlas-test-")) / "atlas.sqlite"),
)


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("ATLAS_DATABASE_PATH", str(tmp_path / "atlas-test.sqlite"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
