"""Tests for POST /api/plan/execute and the revised validator semantics.

Execution must return the records the plan selects, not merely counts that
agree with a preview. Expected values are recomputed from the loaded tables.
"""

import json

import pandas as pd
import pytest

import main as api_main
from fastapi.testclient import TestClient

client = TestClient(api_main.app)

OBS = api_main.df_obs
PROF = api_main.df_prof


def strict_json(response):
    def reject(token):
        raise AssertionError(f"response contained non-JSON literal {token!r}")
    return json.loads(response.text, parse_constant=reject)


def base_plan(**overrides):
    plan = {
        "schema_version": "1.0",
        "time": {"start": "2024-01-01T00:00:00Z", "end": "2024-01-10T23:59:59Z"},
        "region": {"kind": "named", "name": "argo_cached_subset"},
        "depth": {"mode": "range", "min_m": 0.0, "max_m": 500.0},
        "variables": ["temp"],
    }
    plan.update(overrides)
    return plan


def execute(plan):
    return client.post("/api/plan/execute", json=plan)


def validate(plan):
    return client.post("/api/plan/validate", json=plan)


def codes(body, key="warnings"):
    return [item["code"] for item in body.get(key) or []]


# --------------------------------------------------------------------------
# Execution gating
# --------------------------------------------------------------------------

def test_a_valid_plan_executes():
    response = execute(base_plan())
    body = strict_json(response)
    assert response.status_code == 200
    assert body["executed"] is True
    assert body["executed_at"]
    assert body["results"]["observation_count"] == len(OBS)


def test_an_invalid_plan_is_not_executed():
    response = execute(base_plan(
        selection={"platforms": ["9999999"], "profile_ids": []}))
    body = strict_json(response)
    assert response.status_code == 422
    assert body["executed"] is False
    assert body["results"] is None
    assert body["outcome"] == "invalid"


def test_an_unsupported_plan_is_not_executed():
    body = strict_json(execute(base_plan(analyses=["marine_heatwave_detection"])))
    assert body["executed"] is False
    assert body["results"] is None
    assert body["refusal"]["code"] == "not_executable"


def test_a_schema_violation_is_not_executed():
    response = execute(base_plan(variables=["conservative_temperature"]))
    assert response.status_code == 422
    assert strict_json(response)["executed"] is False


def test_execution_revalidates_rather_than_trusting_the_caller():
    """A plan cannot be run by asserting it was already approved."""
    body = strict_json(execute(base_plan()))
    assert body["validation"]["outcome"] == body["outcome"]
    assert body["validation"]["matching"]["observations"] == \
        body["results"]["observation_count"]


def test_no_data_executes_and_returns_an_explicitly_empty_result():
    body = strict_json(execute(base_plan(
        region={"kind": "named", "name": "bay_of_bengal"})))
    assert body["executed"] is True
    assert body["outcome"] == "valid_no_data"
    assert body["results"]["profiles"] == []
    assert body["results"]["observation_count"] == 0


def test_partial_coverage_executes_with_visible_limitations():
    body = strict_json(execute(base_plan(
        depth={"mode": "range", "min_m": 0.0, "max_m": 2000.0})))
    assert body["executed"] is True
    assert body["outcome"] == "valid_partial_coverage"
    assert "partial_depth_coverage" in codes(body["validation"])


# --------------------------------------------------------------------------
# Filters change the returned records, not only the counts
# --------------------------------------------------------------------------

def test_depth_range_restricts_the_returned_observations():
    body = strict_json(execute(base_plan(
        depth={"mode": "range", "min_m": 0.0, "max_m": 50.0})))
    expected = OBS[(OBS["depth"] >= 0.0) & (OBS["depth"] <= 50.0)]
    observations = body["results"]["observations"]
    assert len(observations) == len(expected)
    assert all(0.0 <= o["depth"] <= 50.0 for o in observations)
    assert max(o["depth"] for o in observations) < 50.0


def test_time_window_restricts_the_returned_profiles():
    body = strict_json(execute(base_plan(
        time={"start": "2024-01-01T00:00:00Z", "end": "2024-01-02T00:00:00Z"})))
    expected = OBS[(OBS["time"] >= pd.Timestamp("2024-01-01"))
                   & (OBS["time"] <= pd.Timestamp("2024-01-02"))]
    assert body["results"]["observation_count"] == len(expected)
    returned = {p["profile_id"] for p in body["results"]["profiles"]}
    assert returned == set(expected["profile_id"])


def test_float_selection_restricts_the_returned_records():
    platform = str(PROF["platform"].iloc[0])
    body = strict_json(execute(base_plan(
        selection={"platforms": [platform], "profile_ids": []})))
    assert {p["platform"] for p in body["results"]["profiles"]} == {platform}
    assert all(o["profile_id"].startswith(platform)
               for o in body["results"]["observations"])


def test_profile_selection_returns_exactly_that_profile():
    profile_id = str(PROF["profile_id"].iloc[0])
    body = strict_json(execute(base_plan(
        selection={"platforms": [], "profile_ids": [profile_id]})))
    assert [p["profile_id"] for p in body["results"]["profiles"]] == [profile_id]
    expected = int((OBS["profile_id"] == profile_id).sum())
    assert body["results"]["observation_count"] == expected


def test_region_restricts_the_returned_records():
    """A box covering only the southern floats excludes the northern ones."""
    body = strict_json(execute(base_plan(
        region={"kind": "bbox", "west": 60.0, "east": 65.0,
                "south": 15.0, "north": 16.5})))
    expected = OBS[(OBS["latitude"] >= 15.0) & (OBS["latitude"] <= 16.5)]
    assert body["results"]["observation_count"] == len(expected)
    assert 0 < len(expected) < len(OBS), "this test needs a proper subset"
    assert all(p["latitude"] <= 16.5 for p in body["results"]["profiles"])


def test_requested_variables_change_the_returned_fields():
    temp_only = strict_json(execute(base_plan(variables=["temp"])))
    both = strict_json(execute(base_plan(variables=["temp", "psal"])))
    assert "psal" not in temp_only["results"]["observations"][0]
    assert "psal" in both["results"]["observations"][0]
    assert temp_only["results"]["variables"] == ["temp"]
    assert both["results"]["variables"] == ["temp", "psal"]


def test_execution_counts_agree_with_the_preview():
    for plan in [base_plan(),
                 base_plan(depth={"mode": "range", "min_m": 0.0, "max_m": 50.0}),
                 base_plan(variables=["temp", "psal"])]:
        preview = strict_json(validate(plan))
        run = strict_json(execute(plan))
        assert preview["matching"]["observations"] == \
            run["results"]["observation_count"]
        assert preview["matching"]["profiles"] == len(run["results"]["profiles"])


# --------------------------------------------------------------------------
# Temperature-only support and QC evidence
# --------------------------------------------------------------------------

def test_temperature_only_levels_survive_execution():
    body = strict_json(execute(base_plan(variables=["temp", "psal"])))
    gaps = [o for o in body["results"]["observations"] if o["psal"] is None]
    assert gaps
    for level in gaps:
        assert level["temp"] is not None
        assert level["psal_qc"] is None
        assert level["psal_status"] in ("missing_value", "qc_rejected",
                                        "qc_malformed")
        assert level["psal_exclusion_reason"]


def test_a_float_with_no_valid_salinity_still_executes():
    psal_by_float = OBS.groupby("platform")["psal"].apply(lambda s: s.notna().sum())
    empty = [p for p, n in psal_by_float.items() if n == 0]
    assert empty
    body = strict_json(execute(base_plan(
        variables=["temp", "psal"],
        selection={"platforms": [str(empty[0])], "profile_ids": []})))
    assert body["executed"] is True
    assert body["results"]["observation_count"] > 0
    profile = body["results"]["profiles"][0]
    assert profile["variables"]["temp"]["valid_levels"] > 0
    assert profile["variables"]["psal"]["valid_levels"] == 0


def test_raw_adjusted_origin_and_qc_travel_with_observations():
    body = strict_json(execute(base_plan()))
    for observation in body["results"]["observations"][:50]:
        assert observation["source_field"] in ("raw", "adjusted")
        assert observation["temp_qc"] == 1
        assert observation["pres_qc"] == 1


def test_profiles_carry_provenance_and_mode():
    body = strict_json(execute(base_plan()))
    for profile in body["results"]["profiles"]:
        assert profile["data_mode"] in ("R", "A", "D")
        expected = "raw" if profile["data_mode"] == "R" else "adjusted"
        assert profile["source_field"] == expected
        assert profile["dataset_id"]
        assert profile["retrieved_at"]


def test_executed_plan_and_dataset_identity_are_returned():
    body = strict_json(execute(base_plan()))
    assert body["plan"]["schema_version"] == "1.0"
    assert body["plan"]["variables"] == ["temp"]
    assert body["dataset"]["raw_file_checksum"].startswith("sha256:")
    assert body["dataset"]["observation_count"] == len(OBS)


# --------------------------------------------------------------------------
# Exact depth: derived values are labelled, never disguised
# --------------------------------------------------------------------------

def test_derived_values_are_separate_from_observations():
    body = strict_json(execute(base_plan(
        depth={"mode": "at_depth", "target_m": 25.0})))
    results = body["results"]
    assert results["derived"]
    assert all(o["derived"] is False for o in results["observations"])
    assert all(d["derived"] is True for d in results["derived"])
    assert "derived_values_present" in [l["code"] for l in results["limitations"]]


def test_derived_values_carry_their_method_and_brackets():
    body = strict_json(execute(base_plan(
        depth={"mode": "at_depth", "target_m": 25.0})))
    for entry in body["results"]["derived"]:
        assert entry["variable"] == "temp"
        assert entry["target_depth_m"] == 25.0
        if entry["available"]:
            assert entry["method"] in ("exact", "linear_interpolation")
            assert entry["value"] is not None
            assert len(entry["bracketing_depths"]) == 2
        else:
            assert entry["value"] is None
            assert entry["reason"]


def test_derived_values_match_the_production_matcher():
    from floatchat_core.woa import DEFAULT_MAX_GAP_M, match_value_at_depth

    target = 25.0
    body = strict_json(execute(base_plan(
        depth={"mode": "at_depth", "target_m": target})))
    by_profile = {d["profile_id"]: d for d in body["results"]["derived"]}
    for profile_id, group in OBS.groupby("profile_id"):
        expected = match_value_at_depth(
            group["depth"].to_numpy(dtype=float),
            group["temp"].to_numpy(dtype=float),
            target, max_gap_m=DEFAULT_MAX_GAP_M)
        entry = by_profile[str(profile_id)]
        assert entry["available"] == expected.available
        if expected.available:
            assert entry["value"] == pytest.approx(expected.value)


def test_no_extrapolation_when_the_target_is_above_every_level():
    body = strict_json(execute(base_plan(
        depth={"mode": "at_depth", "target_m": 0.0})))
    assert body["executed"] is True
    assert all(d["available"] is False for d in body["results"]["derived"])
    assert all(d["value"] is None for d in body["results"]["derived"])


def test_at_depth_keeps_the_measured_levels_available_for_charting():
    body = strict_json(execute(base_plan(
        depth={"mode": "at_depth", "target_m": 25.0})))
    assert body["results"]["observation_count"] == len(OBS)


# --------------------------------------------------------------------------
# Revised semantics: effective policy
# --------------------------------------------------------------------------

def test_an_omitted_policy_reports_the_effective_default():
    body = strict_json(validate(base_plan()))
    policy = body["effective_policy"]
    assert policy["source"] == "default"
    assert policy["accepted_qc_flags"]["source"] == "default"
    assert policy["data_modes"]["source"] == "default"
    assert policy["data_modes"]["value"] == ["R", "A", "D"]
    assert policy["data_modes"]["present_in_dataset"] == \
        sorted(set(PROF["data_mode"].astype(str)))
    assert "default_policy_applied" in codes(body)
    # A mode missing only because of the default is not reported as a
    # shortfall against something the caller asked for.
    assert "data_mode_absent" not in codes(body)


def test_an_explicitly_requested_absent_mode_is_an_explicit_limitation():
    present = set(PROF["data_mode"].astype(str))
    assert "A" not in present
    body = strict_json(validate(base_plan(
        qc_policy={"accepted_qc_flags": [1], "data_modes": ["A"]})))
    assert body["effective_policy"]["source"] == "request"
    assert "data_mode_absent" in codes(body)
    assert "default_policy_applied" not in codes(body)
    assert body["outcome"] == "valid_no_data"


def test_an_explicit_policy_is_reported_as_coming_from_the_request():
    body = strict_json(validate(base_plan(
        qc_policy={"accepted_qc_flags": [1], "data_modes": ["R", "D"]})))
    policy = body["effective_policy"]
    assert policy["source"] == "request"
    assert policy["data_modes"]["value"] == ["R", "D"]
    assert policy["data_modes"]["requested_but_absent"] == []


def test_missing_qc_metadata_is_stated_rather_than_assumed_compliant():
    """Salinity flags are cleared on excluded levels, so compliance is unknown."""
    body = strict_json(validate(base_plan(variables=["temp", "psal"])))
    assert "qc_metadata_incomplete" in codes(body)
    message = [w["message"] for w in body["warnings"]
               if w["code"] == "qc_metadata_incomplete"][0]
    assert str(int(OBS["psal_qc"].isna().sum())) in message


def test_temperature_alone_has_complete_qc_metadata():
    body = strict_json(validate(base_plan(variables=["temp"])))
    assert "qc_metadata_incomplete" not in codes(body)


# --------------------------------------------------------------------------
# Revised semantics: spatial coverage messaging
# --------------------------------------------------------------------------

def test_region_distinguishes_search_area_from_sampled_points():
    body = strict_json(validate(base_plan()))
    region = body["coverage"]["region"]
    assert region["configured_search_region"]["west"] == 60.0
    assert region["configured_search_region"]["east"] == 65.0
    assert region["configured_search_region"]["south"] == 15.0
    assert region["configured_search_region"]["north"] == 20.0
    # The observed box is narrower than the configured search box, and is
    # labelled as a box of points rather than a covered area.
    assert region["observed_sample_bounds"]["west"] > 60.0
    assert "not covered unless a profile was actually sampled" in \
        region["observed_sample_bounds"]["note"]


def test_sample_locations_are_reported_as_discrete_points():
    body = strict_json(validate(base_plan()))
    region = body["coverage"]["region"]
    assert region["sampled_location_count"] == len(region["sample_locations"])
    assert region["sampled_location_count"] == \
        len(OBS[["latitude", "longitude"]].round(5).drop_duplicates())
    assert "spatial_sampling_is_pointwise" in codes(body)


def test_a_region_beyond_the_extraction_box_is_flagged_as_never_retrieved():
    body = strict_json(validate(base_plan(
        region={"kind": "named", "name": "arabian_sea"})))
    assert "outside_configured_search_region" in codes(body)
    message = [w["message"] for w in body["warnings"]
               if w["code"] == "outside_configured_search_region"][0]
    assert "no information about the ocean" in message.lower() or \
        "carries no information" in message.lower()


def test_a_region_inside_the_extraction_box_is_not_flagged_as_outside():
    body = strict_json(validate(base_plan()))
    assert "outside_configured_search_region" not in codes(body)


def test_search_region_is_parsed_from_recorded_provenance():
    from floatchat_core.plan_validation import parse_search_region

    assert parse_search_region(None) is None
    assert parse_search_region("https://example.org/x.nc?novars") is None
    parsed = parse_search_region(
        "https://e/ArgoFloats.nc?a,b&longitude>=10&longitude<=20"
        "&latitude>=-5&latitude<=5&pres>=0&pres<=500")
    assert parsed == {"west": 10.0, "east": 20.0, "south": -5.0, "north": 5.0,
                      "source": "parsed from the recorded extraction URL"}


# --------------------------------------------------------------------------
# Existing explorer endpoints are unaffected
# --------------------------------------------------------------------------

def test_profile_and_woa_endpoints_still_respond():
    profile_id = str(PROF["profile_id"].iloc[0])
    assert client.get(f"/api/profiles/{profile_id}").status_code == 200
    assert client.get(f"/api/woa_match/{profile_id}").status_code == 200
    assert client.get("/api/coverage").status_code == 200
    assert client.get("/api/floats").status_code == 200


def test_missing_reference_data_does_not_block_execution(monkeypatch):
    """With no reference available, profile exploration must still work."""
    # Hermetic: the local reference cache may hold real WOA columns written by a
    # running backend, so "missing" is stubbed rather than assumed.
    monkeypatch.setattr(api_main, "_cached_reference_column",
                        lambda *a, **k: (None, "reference column is not cached and "
                                                "remote retrieval is disabled"))
    monkeypatch.setattr("floatchat_core.plan_validation.read_cached_column",
                        lambda *a, **k: None)
    woa = strict_json(client.get(
        f"/api/woa_match/{str(PROF['profile_id'].iloc[0])}"))
    assert woa["status"] == "Comparison unavailable"

    body = strict_json(execute(base_plan(
        analyses=["woa_climatology_comparison", "depth_profile"])))
    assert body["executed"] is True
    assert body["results"]["observation_count"] > 0
    assert "reference_data_uncached" in codes(body["validation"])


def test_every_execution_response_is_json_safe():
    for plan in [base_plan(),
                 base_plan(variables=["temp", "psal"]),
                 base_plan(depth={"mode": "at_depth", "target_m": 0.0}),
                 base_plan(region={"kind": "named", "name": "bay_of_bengal"}),
                 base_plan(analyses=["forecast"])]:
        parsed = strict_json(execute(plan))
        json.dumps(parsed, allow_nan=False)


def test_malformed_execution_body_is_a_400():
    response = client.post("/api/plan/execute", content="{bad",
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 400
    assert strict_json(response)["errors"][0]["code"] == "malformed_json"
