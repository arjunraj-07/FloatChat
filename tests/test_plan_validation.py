"""Tests for POST /api/plan/validate and the validation code behind it.

These exercise the production validator through the real FastAPI app against
the real processed tables. Expected values are derived from the loaded data at
assertion time, never hardcoded and never read from PROJECT_CONTEXT.md.
"""

import json

import pandas as pd
import pytest

import main as api_main
from floatchat_core.plan import (
    ANALYSIS_CAPABILITIES,
    OUTPUT_CAPABILITIES,
    PLAN_SCHEMA_VERSION,
    Analysis,
    Output,
)

from fastapi.testclient import TestClient

client = TestClient(api_main.app)

OBS = api_main.df_obs
PROF = api_main.df_prof
EXTENT = api_main.dataset_index().describe()


def strict_json(response):
    """Parse a response, refusing the non-standard NaN/Infinity tokens."""
    def reject(token):
        raise AssertionError(f"response contained non-JSON literal {token!r}")
    return json.loads(response.text, parse_constant=reject)


def post(body):
    return client.post("/api/plan/validate", json=body)


def base_plan(**overrides):
    """A plan spanning the whole cached subset, using only supported features."""
    plan = {
        "schema_version": "1.0",
        "time": {"start": "2024-01-01T00:00:00Z", "end": "2024-01-10T00:00:00Z"},
        "region": {"kind": "bbox", "west": 60.0, "east": 65.0,
                   "south": 15.0, "north": 20.0},
        "depth": {"mode": "range", "min_m": 0.0, "max_m": 500.0},
        "variables": ["temp"],
    }
    plan.update(overrides)
    return plan


def exact_extent_plan(**overrides):
    """A plan that exactly matches the dataset's own extent, so nothing is
    outside coverage and the outcome can reach `valid`."""
    plan = base_plan(
        time={"start": EXTENT["time_min"], "end": EXTENT["time_max"]},
        region={"kind": "bbox",
                "west": EXTENT["longitude_min"], "east": EXTENT["longitude_max"],
                "south": EXTENT["latitude_min"], "north": EXTENT["latitude_max"]},
        depth={"mode": "range", "min_m": EXTENT["depth_min_m"],
               "max_m": EXTENT["depth_max_m"]},
    )
    plan.update(overrides)
    return plan


def codes(body, key="errors"):
    return [item["code"] for item in body.get(key) or []]


# --------------------------------------------------------------------------
# A valid temperature request
# --------------------------------------------------------------------------

def test_valid_temperature_request_matches_the_whole_dataset():
    response = post(base_plan())
    body = strict_json(response)
    assert response.status_code == 200
    assert body["outcome"] in ("valid", "valid_partial_coverage")
    assert body["errors"] == []
    assert body["matching"]["floats"] == PROF["platform"].nunique()
    assert body["matching"]["profiles"] == PROF["profile_id"].nunique()
    assert body["matching"]["observations"] == len(OBS)


def test_a_request_inside_the_dataset_extent_is_fully_valid():
    body = strict_json(post(exact_extent_plan()))
    assert body["outcome"] == "valid"
    assert not [c for c in codes(body, "warnings")
                if c.startswith("partial_") or c == "variable_unavailable"]


def test_response_carries_the_full_contract():
    body = strict_json(post(base_plan()))
    for key in ("schema_version", "outcome", "requested", "normalized_plan",
                "errors", "warnings", "matching", "coverage", "dataset"):
        assert key in body, key
    assert body["schema_version"] == PLAN_SCHEMA_VERSION


def test_dataset_identity_comes_from_the_loaded_data():
    body = strict_json(post(base_plan()))
    dataset = body["dataset"]
    assert dataset["observation_count"] == len(OBS)
    assert dataset["profile_count"] == PROF["profile_id"].nunique()
    assert dataset["raw_file_checksum"].startswith("sha256:")
    assert dataset["qc_flags_present"] == sorted(
        {int(v) for v in OBS["temp_qc"].dropna().unique()}
    )


def test_requested_constraints_are_echoed_unchanged():
    plan = base_plan()
    body = strict_json(post(plan))
    assert body["requested"] == plan


def test_normalized_plan_preserves_the_requested_bounds():
    """Coverage is reported separately; the plan itself is never clipped."""
    plan = base_plan(depth={"mode": "range", "min_m": 0.0, "max_m": 2000.0})
    body = strict_json(post(plan))
    normalized = body["normalized_plan"]
    assert normalized["depth"]["min_m"] == 0.0
    assert normalized["depth"]["max_m"] == 2000.0      # not clipped to 496 m
    assert normalized["region"]["west"] == 60.0
    assert normalized["time"]["start"].startswith("2024-01-01")
    assert "partial_depth_coverage" in codes(body, "warnings")


def test_named_region_expands_to_documented_bounds():
    from floatchat_core.plan import NAMED_REGION_BOUNDS, NamedRegion

    body = strict_json(post(base_plan(
        region={"kind": "named", "name": "argo_cached_subset"})))
    expected = NAMED_REGION_BOUNDS[NamedRegion.ARGO_CACHED_SUBSET]
    region = body["normalized_plan"]["region"]
    assert region["name"] == "argo_cached_subset"
    assert {k: region[k] for k in expected} == expected


# --------------------------------------------------------------------------
# Temperature plus partially unavailable salinity
# --------------------------------------------------------------------------

def test_salinity_is_reported_as_partial_and_never_dropped():
    body = strict_json(post(base_plan(variables=["temp", "psal"])))
    assert body["outcome"] == "valid_partial_coverage"
    # The requested variable stays in the plan.
    assert body["normalized_plan"]["variables"] == ["temp", "psal"]
    assert "variable_partial" in codes(body, "warnings")

    psal = body["coverage"]["variables"]["psal"]
    assert psal["valid_observations"] == int(OBS["psal"].notna().sum())
    assert psal["excluded_observations"] == int(OBS["psal"].isna().sum())
    assert psal["exclusions"]["missing_value"] > 0
    assert psal["exclusions"]["qc_rejected"] > 0


def test_temperature_coverage_is_unaffected_by_missing_salinity():
    body = strict_json(post(base_plan(variables=["temp", "psal"])))
    temp = body["coverage"]["variables"]["temp"]
    assert temp["valid_observations"] == int(OBS["temp"].notna().sum())
    assert temp["excluded_observations"] == 0


def test_per_variable_depth_ranges_are_reported_separately():
    body = strict_json(post(base_plan(variables=["temp", "psal"])))
    temp = body["coverage"]["variables"]["temp"]
    psal = body["coverage"]["variables"]["psal"]
    assert temp["depth_min_m"] == pytest.approx(OBS["depth"].min())
    valid_psal = OBS[OBS["psal"].notna()]
    assert psal["depth_min_m"] == pytest.approx(valid_psal["depth"].min())


def test_a_variable_with_no_valid_values_warns_without_removing_it():
    """Restrict to a float whose salinity is entirely excluded."""
    psal_by_float = OBS.groupby("platform")["psal"].apply(lambda s: s.notna().sum())
    empty = [p for p, n in psal_by_float.items() if n == 0]
    assert empty, "dataset should contain a float with no valid salinity"

    body = strict_json(post(base_plan(
        variables=["temp", "psal"],
        selection={"platforms": [str(empty[0])], "profile_ids": []},
    )))
    assert body["outcome"] == "valid_partial_coverage"
    assert "variable_unavailable" in codes(body, "warnings")
    assert "psal" in body["normalized_plan"]["variables"]
    assert body["coverage"]["variables"]["psal"]["valid_observations"] == 0
    assert body["coverage"]["variables"]["temp"]["valid_observations"] > 0


# --------------------------------------------------------------------------
# Unknown variable or analysis
# --------------------------------------------------------------------------

def test_unknown_variable_is_rejected_as_an_enum_violation():
    response = post(base_plan(variables=["conservative_temperature"]))
    body = strict_json(response)
    assert response.status_code == 422
    assert body["outcome"] == "invalid"
    assert "unsupported_enum_value" in codes(body)
    assert body["errors"][0]["field"] == "variables.0"


def test_unknown_analysis_name_is_rejected():
    response = post(base_plan(analyses=["teleport_the_float"]))
    assert response.status_code == 422
    assert "unsupported_enum_value" in codes(strict_json(response))


@pytest.mark.parametrize("analysis", [
    a for a in Analysis if not ANALYSIS_CAPABILITIES[a].implemented
])
def test_declared_but_unimplemented_analyses_are_unsupported(analysis):
    """Appearing on the roadmap is not a reason to accept an operator."""
    response = post(base_plan(analyses=[analysis.value]))
    body = strict_json(response)
    assert response.status_code == 200
    assert body["outcome"] == "unsupported"
    assert "unsupported_analysis" in codes(body)
    assert ANALYSIS_CAPABILITIES[analysis].unavailable_reason in \
        body["errors"][0]["message"]


@pytest.mark.parametrize("output", [
    o for o in Output if not OUTPUT_CAPABILITIES[o].implemented
])
def test_declared_but_unimplemented_outputs_are_unsupported(output):
    body = strict_json(post(base_plan(outputs=[output.value])))
    assert body["outcome"] == "unsupported"
    assert "unsupported_output" in codes(body)


@pytest.mark.parametrize("analysis", [
    a for a in Analysis if ANALYSIS_CAPABILITIES[a].implemented
])
def test_implemented_analyses_are_accepted(analysis):
    body = strict_json(post(base_plan(analyses=[analysis.value])))
    assert body["outcome"] != "unsupported"
    assert "unsupported_analysis" not in codes(body)


def test_analyses_and_outputs_stay_separate():
    """An output name is not accepted in the analyses list, or vice versa."""
    assert post(base_plan(analyses=["float_map"])).status_code == 422
    assert post(base_plan(outputs=["depth_profile"])).status_code == 422


def test_unsupported_still_returns_a_normalized_plan():
    body = strict_json(post(base_plan(analyses=["forecast"])))
    assert body["outcome"] == "unsupported"
    assert body["normalized_plan"] is not None


# --------------------------------------------------------------------------
# Invalid date, depth and coordinate bounds
# --------------------------------------------------------------------------

def test_reversed_dates_are_rejected():
    response = post(base_plan(time={"start": "2024-02-01T00:00:00Z",
                                    "end": "2024-01-01T00:00:00Z"}))
    assert response.status_code == 422
    assert "reversed_date_range" in codes(strict_json(response))


def test_reversed_depth_range_is_rejected():
    response = post(base_plan(depth={"mode": "range",
                                     "min_m": 500.0, "max_m": 10.0}))
    assert response.status_code == 422
    assert "reversed_depth_range" in codes(strict_json(response))


def test_reversed_latitude_bounds_are_rejected():
    response = post(base_plan(region={"kind": "bbox", "west": 60.0, "east": 65.0,
                                      "south": 20.0, "north": 15.0}))
    assert response.status_code == 422
    assert "invalid_bounding_box" in codes(strict_json(response))


def test_antimeridian_crossing_box_is_rejected_not_reinterpreted():
    response = post(base_plan(region={"kind": "bbox", "west": 170.0,
                                      "east": -170.0, "south": -5.0,
                                      "north": 5.0}))
    body = strict_json(response)
    assert response.status_code == 422
    assert "antimeridian_not_supported" in codes(body)
    assert "split the request" in body["errors"][0]["message"]


@pytest.mark.parametrize("region", [
    {"kind": "bbox", "west": -200.0, "east": 65.0, "south": 15.0, "north": 20.0},
    {"kind": "bbox", "west": 60.0, "east": 65.0, "south": -91.0, "north": 20.0},
    {"kind": "bbox", "west": 60.0, "east": 65.0, "south": 15.0, "north": 91.0},
])
def test_out_of_range_coordinates_are_rejected(region):
    assert post(base_plan(region=region)).status_code == 422


def test_unknown_named_region_is_rejected():
    response = post(base_plan(region={"kind": "named", "name": "atlantis"}))
    assert response.status_code == 422
    assert "unsupported_enum_value" in codes(strict_json(response))


def test_bbox_and_named_region_cannot_be_mixed():
    assert post(base_plan(region={
        "kind": "named", "name": "arabian_sea", "west": 60.0})).status_code == 422
    assert post(base_plan(region={"kind": "bbox", "west": 60.0, "east": 65.0,
                                  "south": 15.0, "north": 20.0,
                                  "name": "arabian_sea"})).status_code == 422


def test_unknown_field_is_rejected():
    response = post(base_plan(unexpected_field=1))
    body = strict_json(response)
    assert response.status_code == 422
    assert "unknown_field" in codes(body)
    assert body["errors"][0]["field"] == "unexpected_field"


def test_unknown_nested_field_is_rejected():
    response = post(base_plan(depth={"mode": "range", "min_m": 0.0,
                                     "max_m": 100.0, "units": "fathoms"}))
    assert response.status_code == 422
    assert "unknown_field" in codes(strict_json(response))


def test_wrong_schema_version_is_rejected():
    response = post(base_plan(schema_version="0.9"))
    assert response.status_code == 422
    assert "unsupported_schema_version" in codes(strict_json(response))


def test_missing_required_section_is_rejected():
    plan = base_plan()
    del plan["region"]
    assert post(plan).status_code == 422


def test_empty_variable_list_is_rejected():
    assert post(base_plan(variables=[])).status_code == 422


# --------------------------------------------------------------------------
# Float and profile selection
# --------------------------------------------------------------------------

def test_unknown_float_is_a_dangling_reference_not_an_empty_result():
    response = post(base_plan(selection={"platforms": ["9999999"],
                                         "profile_ids": []}))
    body = strict_json(response)
    assert response.status_code == 422
    assert body["outcome"] == "invalid"
    assert "unknown_platform" in codes(body)


def test_unknown_profile_is_rejected():
    response = post(base_plan(selection={"platforms": [],
                                         "profile_ids": ["9999999_1_A"]}))
    assert response.status_code == 422
    assert "unknown_profile" in codes(strict_json(response))


@pytest.mark.parametrize("identifier", ["abc", "12", "123456789", "", "2902201 "])
def test_malformed_platform_identifiers_are_rejected(identifier):
    response = post(base_plan(selection={"platforms": [identifier],
                                         "profile_ids": []}))
    assert response.status_code == 422
    assert "malformed_identifier" in codes(strict_json(response))


@pytest.mark.parametrize("identifier", ["2902201", "2902201_287", "2902201_287_X"])
def test_malformed_profile_identifiers_are_rejected(identifier):
    response = post(base_plan(selection={"platforms": [],
                                         "profile_ids": [identifier]}))
    assert response.status_code == 422
    assert "malformed_identifier" in codes(strict_json(response))


def test_mismatched_float_and_profile_selection_is_rejected():
    """A profile that does not belong to any requested float."""
    row = PROF.iloc[0]
    other = PROF[PROF["platform"] != row["platform"]].iloc[0]
    response = post(base_plan(selection={
        "platforms": [str(other["platform"])],
        "profile_ids": [str(row["profile_id"])],
    }))
    body = strict_json(response)
    assert response.status_code == 422
    assert "profile_platform_mismatch" in codes(body)
    assert str(row["platform"]) in body["errors"][0]["message"]


def test_consistent_float_and_profile_selection_is_accepted():
    row = PROF.iloc[0]
    body = strict_json(post(base_plan(selection={
        "platforms": [str(row["platform"])],
        "profile_ids": [str(row["profile_id"])],
    })))
    assert body["errors"] == []
    assert body["matching"]["profile_ids"] == [str(row["profile_id"])]
    expected = int((OBS["profile_id"] == row["profile_id"]).sum())
    assert body["matching"]["observations"] == expected


def test_selecting_one_float_restricts_the_match():
    platform = str(PROF["platform"].iloc[0])
    body = strict_json(post(base_plan(
        selection={"platforms": [platform], "profile_ids": []})))
    assert body["matching"]["floats"] == 1
    assert body["matching"]["platforms"] == [platform]
    assert body["matching"]["observations"] == int(
        (OBS["platform"].astype(str) == platform).sum())


# --------------------------------------------------------------------------
# Empty and partial coverage
# --------------------------------------------------------------------------

def test_no_matching_data_is_valid_not_malformed():
    body = strict_json(post(base_plan(
        region={"kind": "named", "name": "bay_of_bengal"})))
    assert body["outcome"] == "valid_no_data"
    assert body["errors"] == []
    assert body["matching"]["observations"] == 0
    assert "no_matching_observations" in codes(body, "warnings")
    assert body["normalized_plan"] is not None


def test_a_window_outside_the_dataset_dates_returns_no_data():
    body = strict_json(post(base_plan(
        time={"start": "2020-01-01T00:00:00Z", "end": "2020-01-05T00:00:00Z"})))
    assert body["outcome"] == "valid_no_data"
    assert body["matching"]["observations"] == 0


def test_a_depth_window_below_the_profiles_returns_no_data():
    body = strict_json(post(base_plan(
        depth={"mode": "range", "min_m": 1000.0, "max_m": 2000.0})))
    assert body["outcome"] == "valid_no_data"
    assert body["matching"]["observations"] == 0


def test_partial_coverage_reports_requested_and_matched_extents():
    body = strict_json(post(base_plan(
        time={"start": "2023-12-01T00:00:00Z", "end": "2024-03-01T00:00:00Z"})))
    assert body["outcome"] == "valid_partial_coverage"
    assert "partial_time_coverage" in codes(body, "warnings")
    time_cov = body["coverage"]["time"]
    assert time_cov["requested_start"].startswith("2023-12-01")
    assert time_cov["matched_start"] == EXTENT["time_min"]
    assert time_cov["dataset_end"] == EXTENT["time_max"]
    # The plan keeps the requested window.
    assert body["normalized_plan"]["time"]["start"].startswith("2023-12-01")


def test_a_narrow_window_selects_only_its_own_observations():
    body = strict_json(post(base_plan(
        time={"start": "2024-01-01T00:00:00Z", "end": "2024-01-02T00:00:00Z"})))
    expected = OBS[(OBS["time"] >= pd.Timestamp("2024-01-01"))
                   & (OBS["time"] <= pd.Timestamp("2024-01-02"))]
    assert body["matching"]["observations"] == len(expected)
    assert body["matching"]["profiles"] == expected["profile_id"].nunique()


def test_depth_window_uses_actual_observations_not_profile_metadata():
    body = strict_json(post(base_plan(
        depth={"mode": "range", "min_m": 0.0, "max_m": 50.0})))
    expected = OBS[(OBS["depth"] >= 0.0) & (OBS["depth"] <= 50.0)]
    assert body["matching"]["observations"] == len(expected)
    assert body["coverage"]["variables"]["temp"]["valid_observations"] == \
        int(expected["temp"].notna().sum())


def test_vertical_sampling_is_reported_so_coverage_is_not_read_as_continuous():
    body = strict_json(post(base_plan()))
    depth = body["coverage"]["depth"]
    assert depth["max_level_gap_m"] > 0
    assert depth["median_level_spacing_m"] > 0
    assert "sparse_vertical_sampling" in codes(body, "warnings")


# --------------------------------------------------------------------------
# Depth range versus interpolation to an exact depth
# --------------------------------------------------------------------------

def test_a_range_starting_at_zero_does_not_request_extrapolation():
    body = strict_json(post(base_plan(
        depth={"mode": "range", "min_m": 0.0, "max_m": 100.0})))
    assert body["normalized_plan"]["depth"]["interpolation_required"] is False
    assert "interpolation_not_possible" not in codes(body, "warnings")
    assert body["matching"]["observations"] > 0


def test_at_depth_marks_interpolation_as_required():
    body = strict_json(post(base_plan(
        depth={"mode": "at_depth", "target_m": 100.0})))
    assert body["normalized_plan"]["depth"]["interpolation_required"] is True
    at_depth = body["coverage"]["variables"]["temp"]["at_depth"]
    assert at_depth["target_m"] == 100.0
    assert at_depth["profiles_matchable"] > 0


def test_at_depth_above_the_shallowest_level_reports_no_extrapolation():
    body = strict_json(post(base_plan(
        depth={"mode": "at_depth", "target_m": 0.0})))
    at_depth = body["coverage"]["variables"]["temp"]["at_depth"]
    assert at_depth["profiles_matchable"] == 0
    assert at_depth["unmatchable_reasons"][
        "outside_observed_range_no_extrapolation"] > 0
    assert "interpolation_not_possible" in codes(body, "warnings")


def test_at_depth_keeps_the_whole_profile_in_scope():
    """Bracketing levels are needed, so the depth filter must not be applied."""
    body = strict_json(post(base_plan(
        depth={"mode": "at_depth", "target_m": 100.0})))
    assert body["matching"]["observations"] == len(OBS)


def test_at_depth_rejects_range_fields():
    assert post(base_plan(depth={"mode": "at_depth", "target_m": 10.0,
                                 "min_m": 0.0})).status_code == 422


def test_range_rejects_a_target_depth():
    response = post(base_plan(depth={"mode": "range", "min_m": 0.0,
                                     "max_m": 10.0, "target_m": 5.0}))
    assert response.status_code == 422
    assert "depth_mode_mismatch" in codes(strict_json(response))


def test_at_depth_matchability_agrees_with_the_production_matcher():
    """Cross-check the reported count against floatchat_core directly."""
    from floatchat_core.woa import DEFAULT_MAX_GAP_M, match_value_at_depth

    target = 100.0
    body = strict_json(post(base_plan(
        depth={"mode": "at_depth", "target_m": target})))
    reported = body["coverage"]["variables"]["temp"]["at_depth"]

    expected = 0
    for _, group in OBS.groupby("profile_id"):
        result = match_value_at_depth(
            group["depth"].to_numpy(dtype=float),
            group["temp"].to_numpy(dtype=float),
            target, max_gap_m=DEFAULT_MAX_GAP_M)
        expected += int(result.available)
    assert reported["profiles_matchable"] == expected


# --------------------------------------------------------------------------
# QC and data-mode policy
# --------------------------------------------------------------------------

def test_a_qc_policy_the_stored_data_cannot_satisfy_is_rejected():
    response = post(base_plan(qc_policy={"accepted_qc_flags": [1, 2],
                                         "data_modes": ["R", "A", "D"]}))
    body = strict_json(response)
    assert response.status_code == 422
    assert "qc_policy_not_applicable" in codes(body)
    assert "cannot be reconstructed" in body["errors"][0]["message"]


def test_the_stored_qc_policy_is_accepted():
    body = strict_json(post(base_plan(
        qc_policy={"accepted_qc_flags": [1], "data_modes": ["R", "A", "D"]})))
    assert body["errors"] == []


def test_an_out_of_range_qc_flag_is_a_schema_violation():
    assert post(base_plan(qc_policy={"accepted_qc_flags": [42],
                                     "data_modes": ["R"]})).status_code == 422


def test_an_unknown_data_mode_is_rejected():
    response = post(base_plan(qc_policy={"accepted_qc_flags": [1],
                                         "data_modes": ["Z"]}))
    assert response.status_code == 422
    assert "unsupported_enum_value" in codes(strict_json(response))


def test_a_supported_mode_absent_from_the_data_is_reported_not_rejected():
    """Mode A is valid in the pipeline but no cached profile uses it."""
    present = set(PROF["data_mode"].astype(str))
    assert "A" not in present, "this test assumes mode A is absent"
    body = strict_json(post(base_plan(
        qc_policy={"accepted_qc_flags": [1], "data_modes": ["A"]})))
    assert body["outcome"] == "valid_no_data"
    assert body["errors"] == []
    assert "data_mode_absent" in codes(body, "warnings")


def test_data_mode_filter_restricts_the_match():
    for mode in sorted(set(PROF["data_mode"].astype(str))):
        body = strict_json(post(base_plan(
            qc_policy={"accepted_qc_flags": [1], "data_modes": [mode]})))
        expected = int((OBS["data_mode"].astype(str) == mode).sum())
        assert body["matching"]["observations"] == expected


# --------------------------------------------------------------------------
# Non-finite input, malformed bodies and JSON safety
# --------------------------------------------------------------------------

def raw_post(text):
    return client.post("/api/plan/validate", content=text,
                       headers={"Content-Type": "application/json"})


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_coordinates_are_rejected(literal):
    text = json.dumps(base_plan()).replace('"west": 60.0', '"west": ' + literal)
    response = raw_post(text)
    body = strict_json(response)
    assert response.status_code == 422
    assert "non_finite_number" in codes(body)


def test_non_finite_depth_is_rejected():
    text = json.dumps(base_plan()).replace('"max_m": 500.0', '"max_m": NaN')
    assert raw_post(text).status_code == 422


def test_a_non_finite_echo_is_serialized_as_null_not_nan():
    text = json.dumps(base_plan()).replace('"west": 60.0', '"west": NaN')
    body = strict_json(raw_post(text))          # would raise on a NaN token
    assert body["requested"]["region"]["west"] is None


def test_malformed_json_is_a_400():
    response = raw_post("{not json")
    body = strict_json(response)
    assert response.status_code == 400
    assert "malformed_json" in codes(body)
    assert body["outcome"] == "invalid"


def test_a_non_object_body_is_a_400():
    response = raw_post("[1, 2, 3]")
    assert response.status_code == 400
    assert "body_not_object" in codes(strict_json(response))


def test_every_response_is_strictly_json_safe():
    bodies = [
        base_plan(),
        base_plan(variables=["temp", "psal"]),
        base_plan(analyses=["marine_heatwave_detection"]),
        base_plan(region={"kind": "named", "name": "bay_of_bengal"}),
        base_plan(depth={"mode": "at_depth", "target_m": 0.0}),
        base_plan(selection={"platforms": ["9999999"], "profile_ids": []}),
        base_plan(qc_policy={"accepted_qc_flags": [3], "data_modes": ["R"]}),
    ]
    for body in bodies:
        parsed = strict_json(post(body))
        json.dumps(parsed, allow_nan=False)     # raises if anything leaked


def test_all_five_outcomes_are_reachable():
    seen = {
        strict_json(post(exact_extent_plan()))["outcome"],
        strict_json(post(base_plan(variables=["temp", "psal"])))["outcome"],
        strict_json(post(base_plan(
            region={"kind": "named", "name": "bay_of_bengal"})))["outcome"],
        strict_json(post(base_plan(analyses=["forecast"])))["outcome"],
        strict_json(post(base_plan(
            selection={"platforms": ["9999999"], "profile_ids": []})))["outcome"],
    }
    assert seen == {"valid", "valid_partial_coverage", "valid_no_data",
                    "unsupported", "invalid"}


# --------------------------------------------------------------------------
# Errors are structured
# --------------------------------------------------------------------------

def test_errors_always_carry_a_code_and_message():
    for body in [base_plan(unexpected_field=1),
                 base_plan(variables=["nope"]),
                 base_plan(selection={"platforms": ["1"], "profile_ids": []})]:
        parsed = strict_json(post(body))
        assert parsed["errors"]
        for error in parsed["errors"]:
            assert error["code"] and isinstance(error["code"], str)
            assert error["message"]
            assert set(error) == {"code", "field", "message"}


def test_every_emitted_code_is_documented():
    from floatchat_core.plan import ERROR_CODES, WARNING_CODES

    bodies = [base_plan(unexpected_field=1),
              base_plan(variables=["temp", "psal"]),
              base_plan(analyses=["forecast"]),
              base_plan(outputs=["globe_webgl"]),
              base_plan(region={"kind": "named", "name": "bay_of_bengal"}),
              base_plan(depth={"mode": "at_depth", "target_m": 0.0}),
              base_plan(qc_policy={"accepted_qc_flags": [2],
                                   "data_modes": ["R"]}),
              base_plan(selection={"platforms": ["9999999"],
                                   "profile_ids": []})]
    for body in bodies:
        parsed = strict_json(post(body))
        for error in parsed["errors"] or []:
            assert error["code"] in ERROR_CODES, error
        for warning in parsed["warnings"] or []:
            assert warning["code"] in WARNING_CODES, warning


# --------------------------------------------------------------------------
# Capability discovery
# --------------------------------------------------------------------------

def test_capabilities_endpoint_matches_the_registry():
    body = strict_json(client.get("/api/plan/capabilities"))
    assert body["schema_version"] == PLAN_SCHEMA_VERSION
    assert set(body["analyses"]) == {a.value for a in Analysis}
    assert set(body["outputs"]) == {o.value for o in Output}
    for analysis in Analysis:
        assert body["analyses"][analysis.value]["implemented"] == \
            ANALYSIS_CAPABILITIES[analysis].implemented


def test_capabilities_report_unimplemented_operators_honestly():
    body = strict_json(client.get("/api/plan/capabilities"))
    # Gradients moved to implemented in 5m; thermocline detection did not.
    for name in ("marine_heatwave_detection", "thermocline_estimation",
                 "forecast", "anomaly_significance_test"):
        assert body["analyses"][name]["implemented"] is False
        assert body["analyses"][name]["unavailable_reason"]


def test_capabilities_include_the_live_dataset_extent():
    body = strict_json(client.get("/api/plan/capabilities"))
    assert body["dataset"]["observation_count"] == len(OBS)


# --------------------------------------------------------------------------
# The validator does not execute anything
# --------------------------------------------------------------------------

def test_validation_never_performs_a_reference_read(monkeypatch):
    """A network read during validation would be a contract violation."""
    def explode(*args, **kwargs):
        raise AssertionError("validation attempted a remote reference read")

    monkeypatch.setattr("floatchat_core.woa.fetch_reference_column", explode)
    # Hermetic: a real cached column must not hide the "uncached" warning.
    monkeypatch.setattr("floatchat_core.plan_validation.read_cached_column",
                        lambda *a, **k: None)
    body = strict_json(post(base_plan(
        analyses=["woa_climatology_comparison"], variables=["temp"])))
    assert body["outcome"] in ("valid", "valid_partial_coverage")
    assert "reference_data_uncached" in codes(body, "warnings")
