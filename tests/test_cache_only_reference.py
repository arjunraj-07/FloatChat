"""Cache-only climatology operation for development.

Remote WOA reads were observed to end the API process while NCEI returned
503 pages; the root cause is unconfirmed. The launcher therefore serves cached
reference columns only. These tests pin that default and the cache-miss reply.
Nothing here touches the network.
"""

from pathlib import Path

from fastapi.testclient import TestClient

import floatchat_core.woa as woa
import main as api_main

LAUNCHER = Path(__file__).resolve().parents[1] / "scripts" / "run_api.ps1"


def launcher_code() -> list[str]:
    text = LAUNCHER.read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines()
            if line.strip() and not line.strip().startswith("#")]


def test_the_launcher_defaults_to_cache_only_reference_reads():
    code = launcher_code()
    assert "if ([string]::IsNullOrWhiteSpace($env:FLOATCHAT_WOA_ALLOW_NETWORK)) {" in code
    assert "$env:FLOATCHAT_WOA_ALLOW_NETWORK = '0'" in code


def test_the_launcher_never_builds_the_cache_itself():
    assert not any("build_woa_cache" in line for line in launcher_code())


def test_a_cache_miss_reports_unavailable_without_a_remote_read(monkeypatch):
    def no_remote_read(*args, **kwargs):
        raise AssertionError("a remote WOA read was attempted")

    monkeypatch.setattr(api_main, "WOA_ALLOW_NETWORK", False)
    monkeypatch.setattr(woa, "read_cached_column", lambda *a, **k: None)
    monkeypatch.setattr(woa, "fetch_reference_column", no_remote_read)
    api_main._cached_reference_column.cache_clear()
    try:
        profile_id = str(api_main.dataset_index().profiles["profile_id"].iloc[0])
        body = TestClient(api_main.app).get(f"/api/woa_match/{profile_id}").json()
    finally:
        api_main._cached_reference_column.cache_clear()
    assert body["status"] == "Comparison unavailable"
    assert "remote retrieval is disabled" in body["reason"]
