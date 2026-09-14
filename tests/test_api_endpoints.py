"""Endpoint tests against the real FastAPI application and the real dataset.

The app is exercised in-process through Starlette's TestClient, so there are
no hardcoded paths and no server subprocess. Counts are computed from the
processed tables at assertion time rather than hardcoded, and the reference
climatology is stubbed so the suite runs offline.
"""

import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import main as api_main

client = TestClient(api_main.app)

OBS = api_main.df_obs
PROF = api_main.df_prof


def strict_json(response):
    """Parse a response, refusing the non-standard NaN/Infinity tokens."""
    def reject(token):
        raise AssertionError(f"response contained non-JSON literal {token!r}")
    return json.loads(response.text, parse_constant=reject)


# --------------------------------------------------------------------------
# Dynamic counts
# --------------------------------------------------------------------------

def test_health_reports_the_loaded_dataset():
    body = strict_json(client.get("/api/health"))
    assert body["status"] == "ok"
    assert body["observations"] == len(OBS)
    assert body["woa_network_enabled"] is False


def test_coverage_counts_are_computed_from_the_data():
    body = strict_json(client.get("/api/coverage"))
    assert body["distinct_floats"] == PROF["platform"].nunique()
    assert body["distinct_profiles"] == PROF["profile_id"].nunique()
    assert body["observation_count"] == len(OBS)
    assert body["temperature_only_observations"] == int(OBS["psal"].isna().sum())


def test_coverage_bounding_box_and_dates_match_the_data():
    body = strict_json(client.get("/api/coverage"))
    box = body["bounding_box"]
    assert box["south"] == pytest.approx(PROF["latitude"].min())
    assert box["north"] == pytest.approx(PROF["latitude"].max())
    assert box["west"] == pytest.approx(PROF["longitude"].min())
    assert box["east"] == pytest.approx(PROF["longitude"].max())
    assert pd.to_datetime(body["date_range"][0]) == PROF["time"].min()
    assert pd.to_datetime(body["date_range"][1]) == PROF["time"].max()


def test_coverage_exposes_provenance_and_exclusions():
    body = strict_json(client.get("/api/coverage"))
    assert body["provenance"]["source_url"].startswith("https://erddap")
    assert body["provenance"]["raw_file_checksum"].startswith("sha256:")
    masked = body["exclusions"]["psal_masked"]
    # Every level without salinity carries a recorded reason.
    assert sum(masked.values()) == int(OBS["psal"].isna().sum())


def test_coverage_preserves_argo_variable_definitions():
    body = strict_json(client.get("/api/coverage"))
    definitions = body["variable_definitions"]
    assert definitions["temp"]["argo_name"] == "TEMP"
    assert "in-situ" in definitions["temp"]["long_name"].lower()
    assert definitions["psal"]["argo_name"] == "PSAL"
    assert "Practical" in definitions["psal"]["long_name"]


# --------------------------------------------------------------------------
# Float and profile selection
# --------------------------------------------------------------------------

def test_floats_endpoint_returns_every_float_and_profile_once():
    floats = strict_json(client.get("/api/floats"))
    assert len(floats) == PROF["platform"].nunique()
    ids = [p["profile_id"] for f in floats for p in f["profiles"]]
    assert len(ids) == len(set(ids)) == PROF["profile_id"].nunique()
    assert set(ids) == set(PROF["profile_id"])


def test_each_float_groups_only_its_own_profiles():
    floats = strict_json(client.get("/api/floats"))
    for entry in floats:
        expected = set(PROF.loc[PROF["platform"] == entry["platform"],
                                "profile_id"])
        assert {p["profile_id"] for p in entry["profiles"]} == expected
        assert entry["profile_count"] == len(expected)


def test_profiles_within_a_float_are_ordered_in_time():
    floats = strict_json(client.get("/api/floats"))
    for entry in floats:
        times = [p["time"] for p in entry["profiles"]]
        assert times == sorted(times)


def test_profile_returns_the_requested_profile_only():
    profile_id = PROF["profile_id"].iloc[0]
    body = strict_json(client.get(f"/api/profiles/{profile_id}"))
    expected = OBS[OBS["profile_id"] == profile_id]
    assert body["profile_id"] == profile_id
    assert len(body["observations"]) == len(expected)


def test_unknown_profile_is_404():
    assert client.get("/api/profiles/does_not_exist").status_code == 404
    assert client.get("/api/woa_match/does_not_exist").status_code == 404


@pytest.mark.parametrize("profile_id", list(PROF["profile_id"]))
def test_every_profile_is_retrievable_and_internally_consistent(profile_id):
    body = strict_json(client.get(f"/api/profiles/{profile_id}"))
    obs = body["observations"]
    depths = [o["depth"] for o in obs]

    assert depths == sorted(depths), "levels must be ordered by depth"
    assert all(d > 0 for d in depths), "depth must be positive down"
    assert all(o["temp"] is not None for o in obs)
    assert all(o["temp_qc"] == 1 and o["pres_qc"] == 1 for o in obs)
    assert body["data_mode"] in ("R", "A", "D")

    expected_source = "raw" if body["data_mode"] == "R" else "adjusted"
    assert all(o["source_field"] == expected_source for o in obs)

    salinity_levels = sum(1 for o in obs if o["psal"] is not None)
    assert body["qc"]["salinity_levels"] == salinity_levels
    assert body["qc"]["salinity_excluded_levels"] == len(obs) - salinity_levels
    assert body["qc"]["level_count"] == len(obs)


def test_temperature_only_levels_are_null_salinity_with_a_reason():
    """A temperature-only level must not be presented as valid salinity."""
    counts = OBS.groupby("profile_id")["psal"].apply(lambda s: s.isna().sum())
    profile_id = counts.idxmax()
    assert counts.max() > 0, "dataset should contain temperature-only levels"

    body = strict_json(client.get(f"/api/profiles/{profile_id}"))
    gaps = [o for o in body["observations"] if o["psal"] is None]
    assert gaps
    for level in gaps:
        assert level["temp"] is not None
        assert level["psal_qc"] is None
        assert level["psal_status"] in ("missing_value", "qc_rejected",
                                        "qc_malformed")
        assert level["psal_exclusion_reason"]


def test_no_response_contains_a_bare_nan_token():
    for path in ["/api/coverage", "/api/floats"]:
        strict_json(client.get(path))
    for profile_id in PROF["profile_id"]:
        strict_json(client.get(f"/api/profiles/{profile_id}"))
        strict_json(client.get(f"/api/woa_match/{profile_id}"))


# --------------------------------------------------------------------------
# Reference comparison, stubbed so it runs offline
# --------------------------------------------------------------------------

REFERENCE_DEPTHS = [0.0, 5.0, 10.0, 20.0, 30.0, 50.0, 100.0, 200.0, 500.0]


def stub_column(values, monkeypatch, **overrides):
    payload = {
        "variable": "temp", "woa_variable": "t_an", "month": 1,
        "grid_lat": 15.5, "grid_lon": 61.5,
        "depths": list(REFERENCE_DEPTHS), "values": list(values),
        "units": "degree_Celsius", "product": "World Ocean Atlas 2023",
        "product_code": "decav91C0", "period": "1991-2020",
        "resolution_deg": 1.0, "source_url": "stub://woa23",
        "retrieved_at": "2024-01-01T00:00:00+00:00", "origin": "test stub",
    }
    payload.update(overrides)
    monkeypatch.setattr(api_main, "_cached_reference_column",
                        lambda *a, **k: (payload, None))
    return payload


def shallowest_profile():
    return PROF.loc[PROF["depth_min"].idxmin(), "profile_id"]


def test_comparison_is_unavailable_when_the_reference_cannot_be_retrieved(monkeypatch):
    """Offline and uncached: a reason, not a fabricated value."""
    # Hermetic: the local reference cache may hold real WOA columns written by a
    # running backend, so "missing" is stubbed rather than assumed.
    monkeypatch.setattr(api_main, "_cached_reference_column",
                        lambda *a, **k: (None, "reference column is not cached and "
                                                "remote retrieval is disabled"))
    body = strict_json(client.get(f"/api/woa_match/{shallowest_profile()}"))
    assert body["status"] == "Comparison unavailable"
    assert "not cached" in body["reason"]
    assert "argo_interpolated_value" not in body


def test_successful_comparison_reports_a_verifiable_difference(monkeypatch):
    profile_id = shallowest_profile()
    stub_column([26.0] * len(REFERENCE_DEPTHS), monkeypatch)
    body = strict_json(client.get(f"/api/woa_match/{profile_id}"))

    assert body["status"] == "Success"
    assert body["difference"] == pytest.approx(
        body["argo_interpolated_value"] - body["woa_reference_value"]
    )
    assert body["woa_reference_value"] == 26.0
    assert body["match_method"] in ("exact", "linear_interpolation")
    assert body["baseline_period"] == "1991-2020"

    # The matched depth must lie inside the profile's own depth range.
    observed = OBS[OBS["profile_id"] == profile_id]
    assert observed["depth"].min() <= body["comparison_depth"] \
        <= observed["depth"].max()


def test_comparison_response_keys_used_by_the_explorer_are_preserved(monkeypatch):
    stub_column([26.0] * len(REFERENCE_DEPTHS), monkeypatch)
    body = strict_json(client.get(f"/api/woa_match/{shallowest_profile()}"))
    for key in ("status", "argo_interpolated_value", "woa_reference_value",
                "difference", "comparison_depth", "baseline_period", "method"):
        assert key in body
    assert set(body["spatial_offset"]) == {"lat", "lon"}


def test_reference_depths_below_the_profile_are_never_extrapolated(monkeypatch):
    profile_id = shallowest_profile()
    stub_column([26.0] * len(REFERENCE_DEPTHS), monkeypatch)
    body = strict_json(client.get(f"/api/woa_match/{profile_id}"))
    observed = OBS[OBS["profile_id"] == profile_id]
    lo, hi = observed["depth"].min(), observed["depth"].max()
    for match in body["matches"]:
        assert lo - 0.05 <= match["comparison_depth"] <= hi + 0.05
    # 0 m is shallower than any Argo level in this dataset, so it must not
    # appear as a match.
    assert 0.0 not in [m["comparison_depth"] for m in body["matches"]]


def test_a_missing_reference_cell_is_rejected_not_emitted_as_nan(monkeypatch):
    """A land/no-data cell must produce a reason, never a NaN difference."""
    stub_column([float("nan")] * len(REFERENCE_DEPTHS), monkeypatch)
    body = strict_json(client.get(f"/api/woa_match/{shallowest_profile()}"))
    assert body["status"] == "Comparison unavailable"
    assert body["rejected_depths"]
    assert all("no value at this depth" in r["reason"]
               for r in body["rejected_depths"])


def test_partially_missing_reference_column_skips_only_the_empty_depths(monkeypatch):
    values = [26.0] * len(REFERENCE_DEPTHS)
    values[REFERENCE_DEPTHS.index(10.0)] = float("nan")
    stub_column(values, monkeypatch)
    body = strict_json(client.get(f"/api/woa_match/{shallowest_profile()}"))
    assert body["status"] == "Success"
    assert 10.0 not in [m["comparison_depth"] for m in body["matches"]]
    assert 10.0 in [r["depth"] for r in body["rejected_depths"]]


def test_narrow_gap_limit_makes_the_comparison_unavailable(monkeypatch):
    """With a 0.01 m gap limit nothing can be interpolated honestly."""
    stub_column([26.0] * len(REFERENCE_DEPTHS), monkeypatch)
    monkeypatch.setattr(api_main, "MAX_GAP_M", 0.01)
    body = strict_json(client.get(f"/api/woa_match/{shallowest_profile()}"))
    if body["status"] == "Success":
        # Only exact observed-level hits may survive a zero gap allowance.
        assert all(m["match_method"] == "exact" for m in body["matches"])
    else:
        assert "gap" in body["reason"]


def test_comparison_states_its_limitations(monkeypatch):
    stub_column([26.0] * len(REFERENCE_DEPTHS), monkeypatch)
    body = strict_json(client.get(f"/api/woa_match/{shallowest_profile()}"))
    joined = " ".join(body["limitations"]).lower()
    assert "nearest grid cell" in joined
    assert "not a statistical anomaly" in joined
    assert "marine heatwave" in joined


def test_reference_variable_is_not_relabelled(monkeypatch):
    stub_column([26.0] * len(REFERENCE_DEPTHS), monkeypatch)
    body = strict_json(client.get(f"/api/woa_match/{shallowest_profile()}"))
    assert body["reference"]["definition"] == "in-situ temperature"
    assert "TEMP" in body["reference"]["compatible_with"]


def test_unsupported_comparison_variable_is_rejected():
    response = client.get(
        f"/api/woa_match/{shallowest_profile()}?variable=conservative_temperature"
    )
    assert response.status_code == 400
