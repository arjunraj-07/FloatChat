"""Truncation and the identity of derived results.

The cached subset holds 3,382 levels, far below the 20,000-level response
limit, so truncation cannot be exercised with real data. These tests build a
synthetic :class:`DatasetIndex` large enough to cross the real default, and
separately assert that displayed counts distinguish *total matches* from
*records returned*.
"""

import numpy as np
import pandas as pd
import pytest

import main as api_main
from floatchat_core.plan import QueryPlanRequest
from floatchat_core.plan_execution import (
    DEFAULT_MAX_OBSERVATIONS,
    execute_plan,
)
from floatchat_core.plan_validation import DatasetIndex

OBS = api_main.df_obs
PROF = api_main.df_prof


def plan(**overrides) -> QueryPlanRequest:
    body = {
        "schema_version": "1.0",
        "time": {"start": "2024-01-01T00:00:00Z", "end": "2024-01-10T23:59:59Z"},
        "region": {"kind": "named", "name": "argo_cached_subset"},
        "depth": {"mode": "range", "min_m": 0.0, "max_m": 500.0},
        "variables": ["temp"],
    }
    body.update(overrides)
    return QueryPlanRequest.model_validate(body)


def synthetic_index(levels_per_profile: int, profiles: int) -> DatasetIndex:
    """A dataset large enough to exceed the real truncation limit."""
    rows = []
    for profile in range(profiles):
        platform = f"99000{profile:02d}"
        profile_id = f"{platform}_1_A"
        for level in range(levels_per_profile):
            depth = 1.0 + level * 0.2
            rows.append({
                "profile_id": profile_id,
                "platform": platform,
                "cycle": 1,
                "direction": "A",
                "data_mode": "D",
                "time": pd.Timestamp("2024-01-05T00:00:00"),
                "latitude": 16.0 + profile * 0.01,
                "longitude": 62.0 + profile * 0.01,
                "pres": depth,
                "pres_qc": 1,
                "depth": depth,
                "temp": 26.0 - level * 0.001,
                "temp_qc": 1,
                "temp_error": None,
                "psal": 35.0,
                "psal_qc": 1,
                "psal_error": None,
                "psal_status": "ok",
                "psal_exclusion_reason": None,
                "source_field": "adjusted",
                "dataset_id": "synthetic",
                "source_url": ("https://example.org/ArgoFloats.nc?a"
                               "&longitude>=60&longitude<=65"
                               "&latitude>=15&latitude<=20"),
                "retrieved_at": "2024-01-06T00:00:00+00:00",
            })
    observations = pd.DataFrame(rows)
    profile_rows = (observations.groupby("profile_id", as_index=False)
                    .agg(platform=("platform", "first"),
                         cycle=("cycle", "first"),
                         direction=("direction", "first"),
                         data_mode=("data_mode", "first"),
                         time=("time", "first"),
                         latitude=("latitude", "first"),
                         longitude=("longitude", "first"),
                         depth_min=("depth", "min"),
                         depth_max=("depth", "max"),
                         obs_count=("depth", "count"),
                         temp_count=("temp", "count"),
                         psal_count=("psal", "count"),
                         source_field=("source_field", "first")))
    profile_rows["psal_excluded_count"] = 0
    profile_rows["dataset_id"] = "synthetic"
    profile_rows["source_url"] = observations["source_url"].iloc[0]
    profile_rows["retrieved_at"] = "2024-01-06T00:00:00+00:00"
    return DatasetIndex(observations=observations, profiles=profile_rows,
                        identity={"dataset_id": "synthetic",
                                  "source_url": observations["source_url"].iloc[0]})


# --------------------------------------------------------------------------
# Counts distinguish matches from returned records
# --------------------------------------------------------------------------

def test_untruncated_counts_agree_and_are_flagged_complete():
    index = api_main.dataset_index()
    result = execute_plan(plan(), index)
    results = result["results"]
    assert results["truncated"] is False
    assert results["observation_count"] == len(OBS)
    assert results["returned_observation_count"] == len(OBS)
    assert results["returned_observation_count"] == len(results["observations"])
    assert not [l for l in results["limitations"] if l["code"] == "result_truncated"]


def test_a_small_limit_truncates_explicitly():
    index = api_main.dataset_index()
    result = execute_plan(plan(), index, max_observations=100)
    results = result["results"]

    assert results["truncated"] is True
    # Total matches is unchanged; only the returned records are capped.
    assert results["observation_count"] == len(OBS)
    assert results["returned_observation_count"] == 100
    assert len(results["observations"]) == 100
    codes = [l["code"] for l in results["limitations"]]
    assert "result_truncated" in codes
    message = next(l["message"] for l in results["limitations"]
                   if l["code"] == "result_truncated")
    assert "100" in message and "Narrow the plan" in message


def test_truncation_keeps_the_first_records_by_profile_and_depth():
    index = api_main.dataset_index()
    results = execute_plan(plan(), index, max_observations=50)["results"]
    returned = results["observations"]
    expected = (OBS.sort_values(["profile_id", "depth"]).iloc[:50])
    assert [o["profile_id"] for o in returned] == list(expected["profile_id"])
    assert returned[0]["depth"] == pytest.approx(expected["depth"].iloc[0])


def test_profile_counts_are_unaffected_by_observation_truncation():
    index = api_main.dataset_index()
    results = execute_plan(plan(), index, max_observations=10)["results"]
    # Every matching profile is still listed even though levels were capped.
    assert len(results["profiles"]) == PROF["profile_id"].nunique()
    assert sum(p["levels_in_plan"] for p in results["profiles"]) == len(OBS)


def test_the_validation_count_still_reports_every_match_when_truncated():
    index = api_main.dataset_index()
    result = execute_plan(plan(), index, max_observations=25)
    assert result["validation"]["matching"]["observations"] == len(OBS)
    assert result["results"]["returned_observation_count"] == 25


# --------------------------------------------------------------------------
# The real 20,000-level default, on a synthetic dataset
# --------------------------------------------------------------------------

def test_the_default_limit_truncates_a_dataset_that_exceeds_it():
    assert DEFAULT_MAX_OBSERVATIONS == 20000
    index = synthetic_index(levels_per_profile=2100, profiles=10)  # 21,000
    total = len(index.observations)
    assert total > DEFAULT_MAX_OBSERVATIONS

    results = execute_plan(plan(), index)["results"]
    assert results["truncated"] is True
    assert results["observation_count"] == total
    assert results["returned_observation_count"] == DEFAULT_MAX_OBSERVATIONS
    assert len(results["observations"]) == DEFAULT_MAX_OBSERVATIONS
    assert "result_truncated" in [l["code"] for l in results["limitations"]]


def test_a_dataset_just_under_the_default_is_not_truncated():
    index = synthetic_index(levels_per_profile=1999, profiles=10)  # 19,990
    results = execute_plan(plan(), index)["results"]
    assert results["truncated"] is False
    assert results["returned_observation_count"] == len(index.observations)


def test_a_synthetic_dataset_still_reports_honest_provenance():
    index = synthetic_index(levels_per_profile=10, profiles=2)
    envelope = execute_plan(plan(), index)
    assert envelope["dataset"]["observation_count"] == 20
    assert envelope["dataset"]["dataset_id"] == "synthetic"


# --------------------------------------------------------------------------
# Derived result identity and counting unit
# --------------------------------------------------------------------------

def test_derived_identity_is_documented_in_the_response():
    index = api_main.dataset_index()
    results = execute_plan(
        plan(depth={"mode": "at_depth", "target_m": 100.0},
             variables=["temp", "psal"]), index)["results"]

    identity = results["derived_identity"]
    assert identity["key_fields"] == ["profile_id", "variable", "target_depth_m"]
    assert identity["methods"] == ["exact", "linear_interpolation"]
    assert "not an observation" in identity["note"]


def test_derived_rows_are_unique_per_profile_and_variable():
    index = api_main.dataset_index()
    results = execute_plan(
        plan(depth={"mode": "at_depth", "target_m": 100.0},
             variables=["temp", "psal"]), index)["results"]

    keys = [(d["profile_id"], d["variable"], d["target_depth_m"])
            for d in results["derived"]]
    assert len(keys) == len(set(keys)), "the counting unit must be unique"
    assert results["derived_count"] == len(results["derived"])
    # One row per profile per requested variable.
    assert results["derived_count"] == len(results["profiles"]) * 2


def test_every_derived_row_carries_its_full_identity():
    index = api_main.dataset_index()
    results = execute_plan(
        plan(depth={"mode": "at_depth", "target_m": 100.0}), index)["results"]
    for entry in results["derived"]:
        assert entry["profile_id"]
        assert entry["variable"] in ("temp", "psal")
        assert entry["target_depth_m"] == 100.0
        assert entry["derived"] is True
        if entry["available"]:
            assert entry["method"] in ("exact", "linear_interpolation")
        else:
            assert entry["method"] is None and entry["value"] is None


def test_derived_counts_are_zero_for_a_range_plan():
    index = api_main.dataset_index()
    results = execute_plan(plan(), index)["results"]
    assert results["derived"] == []
    assert results["derived_count"] == 0


def test_derived_rows_are_never_counted_as_observations():
    index = api_main.dataset_index()
    results = execute_plan(
        plan(depth={"mode": "at_depth", "target_m": 100.0}), index)["results"]
    assert results["observation_count"] == len(OBS)
    assert all(o["derived"] is False for o in results["observations"])
    assert results["derived_count"] > 0
