"""Tests for reference depth matching, the no-extrapolation rule and JSON safety.

All assertions go through :func:`floatchat_core.woa.match_value_at_depth`,
which is the function the API calls.
"""

import json
import math

import numpy as np
import pytest

from floatchat_core.woa import (
    DEFAULT_MAX_GAP_M,
    cache_path,
    grid_cell,
    json_safe,
    match_value_at_depth,
    matchable_reference_depths,
    read_cached_column,
    reference_column,
    write_cached_column,
)

DEPTHS = [5.0, 10.0, 15.0, 20.0, 60.0, 65.0]
TEMPS = [26.0, 25.8, 25.4, 25.0, 20.0, 19.5]


# --------------------------------------------------------------------------
# Exact matches
# --------------------------------------------------------------------------

def test_exact_match_returns_the_observed_value_without_interpolating():
    m = match_value_at_depth(DEPTHS, TEMPS, 15.0)
    assert m.available
    assert m.method == "exact"
    assert m.value == 25.4
    assert m.gap_m == 0.0


def test_exact_match_at_the_shallowest_level_is_not_out_of_bounds():
    """Regression: searchsorted returned 0 here and the match was rejected."""
    m = match_value_at_depth(DEPTHS, TEMPS, 5.0)
    assert m.available
    assert m.method == "exact"
    assert m.value == 26.0


def test_exact_match_at_the_deepest_level_is_accepted():
    m = match_value_at_depth(DEPTHS, TEMPS, 65.0)
    assert m.available
    assert m.method == "exact"
    assert m.value == 19.5


def test_exact_match_is_not_subjected_to_the_gap_rule():
    """60 m sits on a level whose neighbour is 40 m away; it is still exact."""
    m = match_value_at_depth(DEPTHS, TEMPS, 60.0, max_gap_m=5.0)
    assert m.available
    assert m.method == "exact"
    assert m.value == 20.0


def test_near_exact_within_tolerance_is_treated_as_exact():
    m = match_value_at_depth([4.99, 30.0], [26.0, 24.0], 5.0)
    assert m.available and m.method == "exact" and m.value == 26.0


def test_just_outside_tolerance_is_interpolated_not_snapped():
    m = match_value_at_depth([4.0, 10.0], [26.0, 25.0], 5.0)
    assert m.available
    assert m.method == "linear_interpolation"
    assert m.value == pytest.approx(25.8333, abs=1e-3)


# --------------------------------------------------------------------------
# Valid interpolation
# --------------------------------------------------------------------------

def test_linear_interpolation_between_bracketing_levels():
    m = match_value_at_depth(DEPTHS, TEMPS, 12.5)
    assert m.available
    assert m.method == "linear_interpolation"
    assert m.value == pytest.approx(25.6)
    assert (m.lower_depth, m.upper_depth) == (10.0, 15.0)
    assert m.gap_m == 5.0


def test_interpolation_is_exactly_linear():
    m = match_value_at_depth([0.0, 100.0], [30.0, 10.0], 25.0, max_gap_m=100.0)
    assert m.available
    assert m.value == pytest.approx(25.0)


def test_unsorted_input_is_handled():
    m = match_value_at_depth([15.0, 5.0, 10.0], [25.4, 26.0, 25.8], 12.5)
    assert m.available and m.value == pytest.approx(25.6)


def test_duplicate_depths_are_collapsed_not_duplicated():
    m = match_value_at_depth([10.0, 10.0, 20.0], [25.0, 27.0, 20.0], 15.0)
    assert m.available
    # The repeated level averages to 26.0, so the midpoint is 23.0.
    assert m.value == pytest.approx(23.0)


# --------------------------------------------------------------------------
# Large gaps and no extrapolation
# --------------------------------------------------------------------------

def test_gap_wider_than_the_limit_is_refused():
    m = match_value_at_depth(DEPTHS, TEMPS, 40.0, max_gap_m=DEFAULT_MAX_GAP_M)
    assert not m.available
    assert m.value is None
    assert m.gap_m == 40.0
    assert "exceeding the configured maximum" in m.reason


def test_gap_exactly_at_the_limit_is_allowed():
    m = match_value_at_depth([10.0, 30.0], [25.0, 20.0], 20.0, max_gap_m=20.0)
    assert m.available and m.value == pytest.approx(22.5)


def test_gap_one_metre_over_the_limit_is_refused():
    m = match_value_at_depth([10.0, 31.0], [25.0, 20.0], 20.0, max_gap_m=20.0)
    assert not m.available


@pytest.mark.parametrize("target", [0.0, 4.9, 65.1, 500.0])
def test_targets_outside_the_observed_range_are_never_extrapolated(target):
    m = match_value_at_depth(DEPTHS, TEMPS, target)
    assert not m.available
    assert m.value is None
    assert "extrapolation is not permitted" in m.reason


def test_shallow_target_is_refused_even_though_numpy_interp_would_clamp():
    """np.interp would silently return the first value here. We must not."""
    assert np.interp(0.0, DEPTHS, TEMPS) == 26.0
    assert not match_value_at_depth(DEPTHS, TEMPS, 0.0).available


# --------------------------------------------------------------------------
# Missing data
# --------------------------------------------------------------------------

def test_levels_with_missing_values_are_dropped_before_bracketing():
    """A NaN salinity level must not act as a bracket."""
    depths = [10.0, 20.0, 30.0]
    psal = [35.0, float("nan"), 35.4]
    m = match_value_at_depth(depths, psal, 20.0, max_gap_m=DEFAULT_MAX_GAP_M)
    assert m.available
    assert m.method == "linear_interpolation"
    assert (m.lower_depth, m.upper_depth) == (10.0, 30.0)
    assert m.value == pytest.approx(35.2)


def test_a_missing_value_can_open_a_gap_that_then_fails_the_rule():
    depths = [10.0, 20.0, 40.0]
    psal = [35.0, float("nan"), 35.4]
    m = match_value_at_depth(depths, psal, 20.0, max_gap_m=20.0)
    assert not m.available
    assert m.gap_m == 30.0


def test_no_valid_levels_is_reported_not_crashed():
    m = match_value_at_depth([10.0, 20.0], [float("nan")] * 2, 15.0)
    assert not m.available
    assert m.n_valid_levels == 0
    assert "no valid observed levels" in m.reason


def test_single_valid_level_cannot_be_interpolated():
    m = match_value_at_depth([10.0, 20.0], [35.0, float("nan")], 15.0)
    assert not m.available
    assert m.n_valid_levels == 1
    assert "interpolation not possible" in m.reason


def test_non_finite_target_is_refused():
    assert not match_value_at_depth(DEPTHS, TEMPS, float("nan")).available


def test_mismatched_input_lengths_raise():
    with pytest.raises(ValueError):
        match_value_at_depth([1.0, 2.0], [1.0], 1.5)


# --------------------------------------------------------------------------
# Candidate reference depths
# --------------------------------------------------------------------------

def test_candidate_depths_are_limited_to_the_observed_range():
    reference = [0.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0]
    assert matchable_reference_depths(DEPTHS, TEMPS, reference) == [
        5.0, 10.0, 20.0, 50.0
    ]


def test_candidate_depths_use_valid_levels_only():
    depths = [5.0, 50.0, 100.0]
    values = [26.0, float("nan"), 20.0]
    # 100 m is still the deepest valid level, so it remains a candidate.
    assert matchable_reference_depths(depths, values, [0.0, 50.0, 100.0, 150.0]) \
        == [50.0, 100.0]


def test_no_candidates_when_nothing_is_valid():
    assert matchable_reference_depths([1.0], [float("nan")], [0.0, 5.0]) == []


# --------------------------------------------------------------------------
# JSON safety
# --------------------------------------------------------------------------

def test_non_finite_values_become_null():
    payload = json_safe({
        "a": float("nan"), "b": float("inf"), "c": float("-inf"),
        "d": np.float64("nan"), "e": 1.5,
    })
    assert payload == {"a": None, "b": None, "c": None, "d": None, "e": 1.5}
    assert "NaN" not in json.dumps(payload)


def test_json_safe_output_survives_a_strict_parser():
    payload = json_safe({
        "nested": [{"v": np.float32("nan")}, np.array([1.0, np.nan])],
        "int": np.int64(3), "flag": True, "none": None,
    })
    text = json.dumps(payload, allow_nan=False)  # raises if NaN leaked through
    assert json.loads(text)["nested"][1] == [1.0, None]


def test_json_safe_preserves_finite_numbers_exactly():
    assert json_safe(np.float64(25.4)) == 25.4
    assert math.isclose(json_safe({"x": np.float32(1.5)})["x"], 1.5)


# --------------------------------------------------------------------------
# Reference cache behaviour (offline)
# --------------------------------------------------------------------------

def test_grid_cell_centres_on_the_half_degree():
    assert grid_cell(15.52, 61.26) == (15.5, 61.5)
    assert grid_cell(-0.2, -179.9) == (-0.5, -179.5)


def test_cache_round_trip(tmp_path):
    payload = {
        "variable": "temp", "month": 1, "grid_lat": 15.5, "grid_lon": 61.5,
        "depths": [0.0, 5.0, 10.0], "values": [26.0, 25.9, float("nan")],
        "units": "degree_Celsius",
    }
    path = write_cached_column(payload, cache_dir=tmp_path)
    assert path.exists()
    loaded = read_cached_column("temp", 1, 15.52, 61.26, cache_dir=tmp_path)
    assert loaded is not None
    assert loaded["depths"] == [0.0, 5.0, 10.0]
    assert loaded["values"][2] is None  # NaN was stored as null, not "NaN"
    assert loaded["origin"] == "local cache"


def test_cache_lookup_uses_the_grid_cell_not_the_exact_position(tmp_path):
    payload = {
        "variable": "temp", "month": 1, "grid_lat": 15.5, "grid_lon": 61.5,
        "depths": [0.0], "values": [26.0], "units": "degree_Celsius",
    }
    write_cached_column(payload, cache_dir=tmp_path)
    # Any position inside the same 1-degree cell must hit the same file.
    assert read_cached_column("temp", 1, 15.01, 61.99, cache_dir=tmp_path)
    assert read_cached_column("temp", 1, 16.01, 61.5, cache_dir=tmp_path) is None


def test_cache_miss_without_network_returns_a_structured_reason(tmp_path):
    column, error = reference_column(
        "temp", 1, 15.5, 61.5, cache_dir=tmp_path, allow_network=False
    )
    assert column is None
    assert "not cached" in error
    assert "remote retrieval is disabled" in error


def test_corrupt_cache_entry_is_ignored_rather_than_trusted(tmp_path):
    path = cache_path("temp", 1, 15.5, 61.5, cache_dir=tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{not json", encoding="utf-8")
    assert read_cached_column("temp", 1, 15.5, 61.5, cache_dir=tmp_path) is None
