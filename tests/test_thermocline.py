"""The thermocline estimate: what it will say, and what it refuses to say.

Every fixture here is a synthetic profile, labelled as such. They exist to pin
behaviour that real data cannot be relied on to contain - a tie, a warming-only
column, a gap wider than policy. Real-profile agreement is checked separately,
against recorded endpoint values.

Series are built through the real gradient engine, so QC handling, the
maximum-gap policy and depth conversion are the ones the application uses.
"""

import pytest

from floatchat_core.gradients import profile_gradients
from floatchat_core.thermocline import (
    MIN_GRADIENT_C_PER_M,
    estimate,
)


def series(depths, temps, **kwargs):
    return profile_gradients(depths, temps, "temp", profile_id="synthetic", **kwargs)


def est(depths, temps, analysed=None, **kwargs):
    return estimate(series(depths, temps, **kwargs), analysed_range_m=analysed)


# --- a clear transition, checked by hand --------------------------------------

SHARP_DEPTHS = [0, 10, 20, 30, 40, 50, 60]
#: Mixed layer at 25 C, a sharp drop between 30 and 40 m, then near-uniform.
SHARP_TEMPS = [25.0, 24.95, 24.9, 24.85, 20.85, 20.8, 20.75]


def test_a_clear_cooling_transition_is_estimated_where_hand_calculation_says():
    result = est(SHARP_DEPTHS, SHARP_TEMPS)
    assert result["status"] == "estimated", result["reason"]
    candidate = result["candidate"]
    # (20.85 - 24.85) / (40 - 30) = -0.4 C/m, midpoint 35 m.
    assert candidate["gradient_c_per_m"] == pytest.approx(-0.4)
    assert candidate["estimated_depth_m"] == pytest.approx(35.0)
    assert candidate["supporting_interval"]["upper"] == {"depth_m": 30, "value": 24.85}
    assert candidate["supporting_interval"]["lower"] == {"depth_m": 40, "value": 20.85}
    assert candidate["temperature_drop_c"] == pytest.approx(4.0)


def test_the_estimated_depth_is_labelled_derived_and_the_endpoints_measured():
    candidate = est(SHARP_DEPTHS, SHARP_TEMPS)["candidate"]
    assert candidate["estimated_depth_is_derived"] is True
    assert candidate["supporting_interval"]["measured"] is True
    assert "not a measurement" in candidate["midpoint_note"]
    assert "top and bottom" in candidate["midpoint_note"]


def test_the_method_and_its_thresholds_travel_with_the_result():
    result = est(SHARP_DEPTHS, SHARP_TEMPS)
    assert result["method_version"]
    assert result["policy"]["min_gradient_c_per_m"] == MIN_GRADIENT_C_PER_M
    assert "application policy" in result["policy"]["note"]


def test_the_cited_criterion_is_reported_without_claiming_it_validates_ours():
    """The >0.2 C/m criterion is real; its applicability here is not claimed.

    Romero et al. (2023), Section 1, attribute a thermocline standard of
    >0.2 C/m to Jiang et al. (2017), who filter a per-point gradient strength
    computed by their own method. We threshold a first difference between two
    adjacent accepted levels. The note must cite the first without asserting
    the second follows from it.
    """
    note = est(SHARP_DEPTHS, SHARP_TEMPS)["policy"]["note"]
    # The citation is present and correctly attributed.
    assert "Jiang et al. (2017)" in note
    assert "Romero et al. (2023)" in note
    # Ours is a policy that coincides with it, not a standard we meet.
    assert "application policy" in note
    # The transfer is explicitly unvalidated.
    assert "has not been validated for this estimator or this dataset" in note
    # The three quantities stay apart.
    assert "local interval gradient" in note
    assert "temperature difference used to define a mixed-layer depth" in note


#: Wordings that would assert scientific validation this project has not done.
#: Checked against the note and every refusal reason, so no phrasing of a
#: policy can claim more support than exists.
UNSUPPORTED_VALIDATION_CLAIMS = (
    "validated against",
    "scientifically validated",
    "peer-reviewed threshold",
    "internationally accepted",
    "universally accepted",
    "universal standard",
    "industry standard",
    "meets the scientific standard",
    "proven",
    "verified by",
    "in accordance with the standard",
    "as required by",
)


def _every_reason_text():
    """The note plus a reason from each terminal status."""
    texts = [est(SHARP_DEPTHS, SHARP_TEMPS)["policy"]["note"]]
    for depths, temps in (
        (SHARP_DEPTHS, SHARP_TEMPS),                                      # estimated
        ([0, 10, 20], [25.0, 21.0, 20.0]),                                # insufficient
        (list(range(0, 70, 10)), [20.0] * 7),                             # uniform
        (list(range(0, 110, 10)), [25.0 - 0.01 * i for i in range(11)]),  # weak
        (list(range(0, 70, 10)), [10.0 + 0.5 * i for i in range(7)]),     # warming
        ([0, 10, 20, 30, 40, 50, 60], [20.0, 20.0, 20.0, 16.0, 20.0, 20.0, 20.0]),
    ):
        texts.append(est(depths, temps)["reason"])
    texts.append(estimate(None)["reason"])
    return texts


@pytest.mark.parametrize("claim", UNSUPPORTED_VALIDATION_CLAIMS)
def test_no_wording_claims_a_scientific_validation_we_have_not_done(claim):
    for text in _every_reason_text():
        assert claim not in text.lower(), f"{claim!r} in {text[:80]!r}"


def test_a_policy_is_never_called_a_standard_we_satisfy():
    """Citing a standard is allowed; claiming to meet one is not."""
    for text in _every_reason_text():
        lowered = text.lower()
        for phrase in ("meets the", "satisfies the", "conforms to"):
            assert phrase not in lowered, text[:80]


def test_a_weak_profile_is_refused_against_our_threshold_not_a_standard():
    depths = list(range(0, 110, 10))
    temps = [25.0 - 0.01 * i for i in range(len(depths))]
    reason = est(depths, temps)["reason"]
    assert "this prototype's application policy" in reason


# --- profiles with no qualifying candidate ------------------------------------

def test_a_uniform_profile_has_no_candidate():
    result = est(list(range(0, 70, 10)), [20.0] * 7)
    assert result["status"] == "no_qualifying_candidate"
    assert "cools with depth" in result["reason"]


def test_a_uniformly_sloping_profile_is_not_a_transition_layer():
    """Every interval identical: a slope, not a layer."""
    depths = list(range(0, 110, 10))
    temps = [25.0 - 3.0 * i for i in range(len(depths))]  # 0.3 C/m throughout
    result = est(depths, temps)
    assert result["status"] == "no_qualifying_candidate"
    assert "uniform slope" in result["reason"]


def test_weak_cooling_below_the_standard_is_refused():
    depths = list(range(0, 110, 10))
    temps = [25.0 - 0.01 * i for i in range(len(depths))]
    result = est(depths, temps)
    assert result["status"] == "no_qualifying_candidate"
    assert "below this prototype's application policy of 0.2" in result["reason"]


def test_a_warming_only_profile_is_refused_and_the_limitation_explained():
    """An inversion is real structure this cooling-only method cannot name."""
    depths = list(range(0, 70, 10))
    temps = [10.0 + 0.5 * i for i in range(len(depths))]
    result = est(depths, temps)
    assert result["status"] == "no_qualifying_candidate"
    assert "inversion" in result["reason"]
    assert result["candidate"] is None


def test_a_mixed_inversion_never_reports_the_warming_interval():
    """A sharp warming step must not be mislabelled by an absolute gradient."""
    depths = [0, 10, 20, 30, 40, 50]
    temps = [20.0, 19.95, 19.9, 25.0, 24.95, 24.9]
    result = est(depths, temps)
    if result["status"] in ("estimated", "ambiguous"):
        assert result["candidate"]["gradient_c_per_m"] < 0
    else:
        assert result["status"] == "no_qualifying_candidate"


def test_an_isolated_sharp_interval_is_treated_as_local_structure():
    depths = [0, 10, 20, 30, 40, 50, 60]
    temps = [20.0, 20.0, 20.0, 16.0, 20.0, 20.0, 20.0]
    result = est(depths, temps)
    assert result["status"] == "no_qualifying_candidate"
    assert "stands alone" in result["reason"]


# --- competing structure ------------------------------------------------------

def test_two_equally_strong_transitions_are_reported_as_ambiguous():
    depths = [0, 10, 20, 30, 40, 50, 60, 70]
    temps = [25.0, 21.0, 20.9, 20.8, 20.7, 16.7, 16.6, 16.5]
    result = est(depths, temps)
    assert result["status"] == "ambiguous"
    assert result["competing_candidates"]
    assert "not decided" in result["reason"]


def test_a_tie_resolves_to_the_shallower_interval_deterministically():
    depths = [0, 10, 20, 30, 40, 50, 60, 70]
    temps = [25.0, 21.0, 20.9, 20.8, 20.7, 16.7, 16.6, 16.5]
    first = est(depths, temps)["candidate"]["estimated_depth_m"]
    second = est(depths, temps)["candidate"]["estimated_depth_m"]
    assert first == second == pytest.approx(5.0)


# --- thin or damaged evidence -------------------------------------------------

def test_too_few_levels_is_insufficient_evidence_not_an_absent_thermocline():
    result = est([0, 10, 20], [25.0, 21.0, 20.0])
    assert result["status"] == "insufficient_evidence"
    assert "not evidence that no thermocline exists here" in result["reason"]


def test_insufficient_evidence_and_no_candidate_do_not_read_alike():
    """Two different statements: cannot judge, versus judged and nothing met it."""
    thin = est([0, 10, 20], [25.0, 21.0, 20.0])
    judged = est(list(range(0, 70, 10)), [20.0] * 7)
    assert thin["status"] == "insufficient_evidence"
    assert judged["status"] == "no_qualifying_candidate"
    assert thin["reason"] != judged["reason"]
    assert "Too few accepted levels" in thin["reason"]


@pytest.mark.parametrize("depths,temps", [
    (list(range(0, 70, 10)), [20.0] * 7),                                   # uniform
    (list(range(0, 110, 10)), [25.0 - 0.01 * i for i in range(11)]),        # weak
    (list(range(0, 70, 10)), [10.0 + 0.5 * i for i in range(7)]),           # warming
])
def test_every_refusal_says_it_is_about_the_method_not_the_ocean(depths, temps):
    result = est(depths, temps)
    assert result["status"] == "no_qualifying_candidate"
    assert "not evidence that no thermocline exists here" in result["reason"]


def test_rejected_levels_are_not_bridged():
    """A None level is a break; the estimate must not span it."""
    depths = [0, 10, 20, 30, 40, 50, 60]
    temps = [25.0, 24.95, None, 24.85, 20.85, 20.8, 20.75]
    result = est(depths, temps)
    if result["candidate"]:
        upper = result["candidate"]["supporting_interval"]["upper"]["depth_m"]
        lower = result["candidate"]["supporting_interval"]["lower"]["depth_m"]
        assert not (upper <= 20 <= lower and lower - upper > 10)


def test_a_gap_wider_than_policy_cannot_support_an_estimate():
    depths = [0, 10, 20, 400, 410, 420, 430]
    temps = [25.0, 24.95, 24.9, 5.0, 4.95, 4.9, 4.85]
    result = est(depths, temps, max_gap_m=50.0)
    assert result["status"] in ("insufficient_evidence", "no_qualifying_candidate")
    if result["candidate"]:
        interval = result["candidate"]["supporting_interval"]
        span = interval["lower"]["depth_m"] - interval["upper"]["depth_m"]
        assert span <= 50.0


def test_duplicate_and_near_identical_depths_do_not_produce_infinities():
    depths = [0, 10, 10, 10.0000001, 20, 30, 40]
    temps = [25.0, 24.9, 24.9, 24.9, 20.9, 20.8, 20.7]
    result = est(depths, temps)
    if result["candidate"]:
        gradient = result["candidate"]["gradient_c_per_m"]
        assert gradient == gradient and abs(gradient) != float("inf")


def test_non_finite_values_are_refused_rather_than_propagated():
    depths = [0, 10, 20, 30, 40, 50]
    temps = [25.0, float("nan"), 24.9, 20.9, 20.8, 20.7]
    result = est(depths, temps)
    if result["candidate"]:
        assert result["candidate"]["gradient_c_per_m"] == result["candidate"]["gradient_c_per_m"]


def test_levels_given_out_of_order_give_the_same_answer():
    ordered = est(SHARP_DEPTHS, SHARP_TEMPS)
    pairs = sorted(zip(SHARP_DEPTHS, SHARP_TEMPS), key=lambda p: -p[0])
    shuffled = est([d for d, _ in pairs], [t for _, t in pairs])
    assert shuffled["status"] == ordered["status"]
    assert (shuffled["candidate"]["estimated_depth_m"]
            == pytest.approx(ordered["candidate"]["estimated_depth_m"]))


# --- range and applicability --------------------------------------------------

def test_the_analysed_range_is_reported_and_never_implied_to_be_the_profile():
    result = est(SHARP_DEPTHS, SHARP_TEMPS, analysed=[0.0, 60.0])
    assert result["analysed_depth_range_m"] == [0.0, 60.0]
    assert "only the depth range this query analysed" in result["range_note"]


def test_a_candidate_touching_the_edge_of_the_range_says_so():
    depths = [0, 10, 20, 30, 40, 50]
    temps = [25.0, 24.95, 24.9, 24.85, 24.8, 20.8]
    result = est(depths, temps, analysed=[0.0, 50.0])
    if result["candidate"]:
        assert result["candidate"]["at_analysed_boundary"]
        assert "continue beyond" in result["candidate"]["at_analysed_boundary"]


def test_a_clipped_range_does_not_claim_the_whole_profile():
    result = est(SHARP_DEPTHS, SHARP_TEMPS, analysed=[0.0, 60.0])
    assert result["analysed_depth_range_m"][1] == 60.0


def test_without_temperature_the_analysis_is_not_applicable():
    result = estimate(None)
    assert result["status"] == "not_applicable"
    assert "no thermocline estimate is possible" in result["reason"]


def test_a_salinity_series_is_refused_rather_than_misread():
    salinity = profile_gradients([0, 10, 20, 30], [35.0, 35.1, 35.2, 35.3], "psal")
    assert estimate(salinity)["status"] == "not_applicable"


def test_missing_salinity_never_blocks_a_temperature_estimate():
    result = est(SHARP_DEPTHS, SHARP_TEMPS)
    assert result["status"] == "estimated"
