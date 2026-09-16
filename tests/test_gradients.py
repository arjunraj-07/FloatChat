"""Vertical gradients between adjacent observed levels.

The arithmetic is deliberately simple, so these tests are about the *rules*
around it: which pairs are eligible, what happens at a break, and what the
result is careful not to claim. One test reproduces a gradient by hand from
two real cached measurements.
"""

import math

import pytest

from floatchat_core.gradients import (
    COOLING_CAVEAT,
    COOLING_LABEL,
    GRADIENT_UNITS,
    gradient_report,
    profile_gradients,
    strongest_cooling,
)
from floatchat_core.woa import DEFAULT_MAX_GAP_M

import main as api_main


# --------------------------------------------------------------------------
# Known arithmetic
# --------------------------------------------------------------------------

def test_a_known_linear_gradient_is_reproduced_exactly():
    """Temperature falling 0.1 degrees per metre over evenly spaced levels."""
    depths = [10.0, 20.0, 30.0, 40.0]
    values = [25.0, 24.0, 23.0, 22.0]
    report = profile_gradients(depths, values, "temp")

    assert report["status"] == "ok"
    assert report["interval_count"] == 3
    for interval in report["intervals"]:
        assert interval["gradient"] == pytest.approx(-0.1)
        assert interval["delta_depth_m"] == pytest.approx(10.0)
        assert interval["derived"] is True
    assert [i["midpoint_depth_m"] for i in report["intervals"]] == [15.0, 25.0, 35.0]


def test_a_constant_profile_has_zero_gradient_not_a_missing_one():
    report = profile_gradients([5.0, 10.0, 15.0], [20.0, 20.0, 20.0], "temp")
    assert report["interval_count"] == 2
    assert all(i["gradient"] == 0.0 for i in report["intervals"])
    assert report["status"] == "ok"


def test_a_temperature_inversion_gives_a_positive_gradient():
    """Warmer water below colder water. Reported, never corrected."""
    report = profile_gradients([10.0, 20.0], [18.0, 19.5], "temp")
    interval = report["intervals"][0]
    assert interval["gradient"] == pytest.approx(0.15)
    assert interval["delta_value"] == pytest.approx(1.5)
    assert strongest_cooling(report["intervals"]) is None


def test_the_sign_convention_follows_depth_positive_down():
    cooling = profile_gradients([0.0, 10.0], [25.0, 24.0], "temp")
    warming = profile_gradients([0.0, 10.0], [24.0, 25.0], "temp")
    assert cooling["intervals"][0]["gradient"] < 0
    assert warming["intervals"][0]["gradient"] > 0


def test_each_interval_carries_its_two_source_measurements():
    report = profile_gradients([10.0, 20.0], [25.0, 24.0], "temp",
                               profile_id="P1")
    interval = report["intervals"][0]
    assert interval["upper"] == {"depth_m": 10.0, "value": 25.0}
    assert interval["lower"] == {"depth_m": 20.0, "value": 24.0}
    assert interval["profile_id"] == "P1"
    assert interval["units"] == GRADIENT_UNITS["temp"]
    assert "degrees Celsius per metre" in interval["units"]


def test_salinity_units_do_not_invent_a_numerator_unit():
    report = profile_gradients([10.0, 20.0], [35.0, 35.2], "psal")
    assert "PSS-78" in report["units"]
    assert "dimensionless" in report["units"]


# --------------------------------------------------------------------------
# Breaks: nothing is bridged
# --------------------------------------------------------------------------

def test_a_missing_value_breaks_the_series_instead_of_bridging_it():
    depths = [10.0, 20.0, 30.0]
    values = [25.0, None, 23.0]
    report = profile_gradients(depths, values, "temp")

    assert report["interval_count"] == 0
    assert {b["reason"] for b in report["breaks"]} == {"missing_value"}
    # The 10 m and 30 m levels are never joined across the rejected level.
    assert report["status"] == "no_eligible_intervals"


def test_a_gap_wider_than_the_policy_is_a_break():
    span = DEFAULT_MAX_GAP_M + 5.0
    report = profile_gradients([0.0, span], [25.0, 20.0], "temp")
    assert report["interval_count"] == 0
    assert report["breaks"][0]["reason"] == "gap_exceeds_policy"
    assert report["breaks"][0]["max_gap_m"] == DEFAULT_MAX_GAP_M


def test_a_gap_exactly_at_the_policy_limit_is_still_eligible():
    report = profile_gradients([0.0, DEFAULT_MAX_GAP_M], [25.0, 20.0], "temp")
    assert report["interval_count"] == 1


def test_the_gap_policy_is_configurable_and_labelled_as_policy():
    report = profile_gradients([0.0, 30.0], [25.0, 20.0], "temp", max_gap_m=50.0)
    assert report["interval_count"] == 1
    assert report["max_gap_m"] == 50.0
    assert "application policy" in report["max_gap_policy"]


def test_non_finite_values_are_treated_as_missing():
    report = profile_gradients([10.0, 20.0, 30.0],
                               [25.0, float("nan"), 23.0], "temp")
    assert report["interval_count"] == 0
    assert all(b["reason"] == "missing_value" for b in report["breaks"])


def test_a_level_without_a_finite_depth_is_excluded():
    report = profile_gradients([10.0, float("nan"), 20.0],
                               [25.0, 24.0, 23.0], "temp")
    assert any(b["reason"] == "unusable_depth" for b in report["breaks"])
    # The two usable levels still form one interval.
    assert report["interval_count"] == 1


# --------------------------------------------------------------------------
# Duplicates
# --------------------------------------------------------------------------

def test_duplicate_depths_that_agree_are_collapsed():
    report = profile_gradients([10.0, 10.0, 20.0], [25.0, 25.0, 24.0], "temp")
    assert report["interval_count"] == 1
    assert report["intervals"][0]["delta_depth_m"] == pytest.approx(10.0)


def test_conflicting_duplicate_depths_are_excluded_not_averaged():
    """Two different values at one depth give no basis for choosing."""
    report = profile_gradients([10.0, 10.0, 20.0], [25.0, 26.0, 24.0], "temp")
    conflicts = [b for b in report["breaks"]
                 if b["reason"] == "conflicting_duplicate_depth"]
    assert len(conflicts) == 1
    assert conflicts[0]["values"] == [25.0, 26.0]
    # No interval may use 10 m, and nothing was averaged into 25.5.
    assert report["interval_count"] == 0
    assert all(25.5 not in (i["upper"]["value"], i["lower"]["value"])
               for i in report["intervals"])


def test_a_duplicate_depth_where_only_one_row_has_a_value_uses_that_value():
    report = profile_gradients([10.0, 10.0, 20.0], [None, 25.0, 24.0], "temp")
    assert report["interval_count"] == 1
    assert report["intervals"][0]["upper"]["value"] == 25.0


def test_no_division_by_zero_is_possible_from_duplicate_depths():
    report = profile_gradients([10.0, 10.0], [25.0, 25.0], "temp")
    assert report["interval_count"] == 0
    assert all(math.isfinite(i["gradient"]) for i in report["intervals"])


# --------------------------------------------------------------------------
# Insufficient samples
# --------------------------------------------------------------------------

@pytest.mark.parametrize("depths,values", [
    ([], []),
    ([10.0], [25.0]),
    ([10.0, 20.0], [25.0, None]),
    ([10.0, 20.0], [None, None]),
])
def test_fewer_than_two_accepted_samples_cannot_support_a_gradient(depths, values):
    report = profile_gradients(depths, values, "temp")
    assert report["status"] == "insufficient_samples"
    assert report["interval_count"] == 0


def test_mismatched_inputs_are_a_programming_error_not_a_silent_result():
    with pytest.raises(ValueError):
        profile_gradients([10.0, 20.0], [25.0], "temp")


# --------------------------------------------------------------------------
# Independence of the two variables
# --------------------------------------------------------------------------

def test_missing_salinity_does_not_block_temperature():
    depths = [10.0, 20.0, 30.0]
    report = gradient_report(
        depths,
        {"temp": [25.0, 24.0, 23.0], "psal": [None, None, None]},
        profile_id="P1",
    )
    assert report["variables"]["temp"]["interval_count"] == 2
    assert report["variables"]["psal"]["status"] == "insufficient_samples"
    assert report["strongest_cooling"] is not None


def test_a_report_may_carry_temperature_alone():
    report = gradient_report([10.0, 20.0], {"temp": [25.0, 24.0]})
    assert set(report["variables"]) == {"temp"}


# --------------------------------------------------------------------------
# Interpretation, and what it refuses to claim
# --------------------------------------------------------------------------

def test_the_strongest_cooling_interval_is_the_steepest_decrease():
    depths = [0.0, 10.0, 20.0, 30.0]
    values = [25.0, 24.5, 20.0, 19.8]
    report = gradient_report(depths, {"temp": values})
    cooling = report["strongest_cooling"]

    assert cooling["label"] == COOLING_LABEL
    assert cooling["interval"]["upper"]["depth_m"] == 10.0
    assert cooling["interval"]["lower"]["depth_m"] == 20.0
    assert cooling["interval"]["gradient"] == pytest.approx(-0.45)


def test_the_cooling_interval_is_not_called_a_thermocline():
    report = gradient_report([0.0, 10.0], {"temp": [25.0, 24.0]})
    text = (report["strongest_cooling"]["label"] + " "
            + report["strongest_cooling"]["caveat"]).lower()
    assert "thermocline" in text  # only to deny it
    assert "not a detected thermocline" in COOLING_CAVEAT.lower()
    for claim in ("mixed-layer depth", "anomaly", "marine heatwave"):
        assert claim in COOLING_CAVEAT.lower()


def test_the_caveat_names_what_affects_the_answer():
    lowered = COOLING_CAVEAT.lower()
    assert "sampling" in lowered
    assert "noise" in lowered
    assert "depth range" in lowered


def test_no_cooling_interval_is_reported_honestly():
    """A profile that only warms with depth must say so, not go silent."""
    report = gradient_report([0.0, 10.0, 20.0], {"temp": [18.0, 19.0, 20.0]})
    assert report["strongest_cooling"] is None
    assert "No interval" in report["cooling_note"]


def test_ties_resolve_to_the_shallower_interval():
    report = gradient_report([0.0, 10.0, 20.0, 30.0],
                             {"temp": [25.0, 24.0, 24.0, 23.0]})
    assert report["strongest_cooling"]["interval"]["upper"]["depth_m"] == 0.0


# --------------------------------------------------------------------------
# Against the real cached observations
# --------------------------------------------------------------------------

def real_profile_levels():
    """The first cached profile with at least two close temperature levels."""
    obs = api_main.df_obs
    for profile_id, group in obs.groupby("profile_id", sort=True):
        ordered = group.sort_values("depth")
        depths = ordered["depth"].tolist()
        temps = ordered["temp"].tolist()
        for i in range(len(depths) - 1):
            span = depths[i + 1] - depths[i]
            if 0 < span <= DEFAULT_MAX_GAP_M and temps[i] is not None:
                return str(profile_id), depths, temps, i
    raise AssertionError("no eligible adjacent pair in the cached data")


def test_a_real_cached_interval_is_reproducible_by_hand():
    """One gradient, recomputed from its two source measurements."""
    profile_id, depths, temps, index = real_profile_levels()
    report = profile_gradients(depths, temps, "temp", profile_id=profile_id)

    upper_depth, lower_depth = depths[index], depths[index + 1]
    match = next(i for i in report["intervals"]
                 if i["upper"]["depth_m"] == upper_depth
                 and i["lower"]["depth_m"] == lower_depth)

    expected = (temps[index + 1] - temps[index]) / (lower_depth - upper_depth)
    assert match["gradient"] == pytest.approx(expected)
    assert match["upper"]["value"] == temps[index]
    assert match["lower"]["value"] == temps[index + 1]
    assert match["midpoint_depth_m"] == pytest.approx(
        (upper_depth + lower_depth) / 2)


def test_every_real_profile_reports_a_status_and_never_a_nan_gradient():
    obs = api_main.df_obs
    for profile_id, group in obs.groupby("profile_id", sort=True):
        ordered = group.sort_values("depth")
        report = gradient_report(
            [float(d) for d in ordered["depth"]],
            {"temp": [None if v != v else float(v) for v in ordered["temp"]]},
            profile_id=str(profile_id),
        )
        temperature = report["variables"]["temp"]
        assert temperature["status"] in (
            "ok", "no_eligible_intervals", "insufficient_samples")
        for interval in temperature["intervals"]:
            assert math.isfinite(interval["gradient"])
            assert interval["delta_depth_m"] > 0
