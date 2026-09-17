"""The evaluation harness's own judgement, tested without a provider.

The harness decides whether a real model's answer is acceptable. If its checks
were wrong, a live run would report confident nonsense, so they are exercised
here with fixtures. No provider is constructed and no request is made: these
are pure functions over dictionaries.
"""

import pytest

ev = pytest.importorskip("scripts.evaluate_gemini")


EVIDENCE = {
    "facts": [
        {"id": "profiles.count", "label": "profiles returned", "value": 40,
         "units": None, "kind": "count"},
        {"id": "variable.temp.value_max", "label": "highest temperature",
         "value": 30.123, "units": "degree_Celsius", "kind": "measured"},
    ],
    "fact_ids": ["profiles.count", "variable.temp.value_max"],
}


def explanation(text, fact_ids):
    return {"sentences": [{"template": "t", "variable": None, "text": text,
                           "fact_ids": fact_ids}], "caveats": []}


def test_a_sentence_whose_numbers_come_from_the_evidence_passes():
    ok, reason = ev.check_explanation(
        explanation("This result covers 40 profiles.", ["profiles.count"]), EVIDENCE)
    assert ok, reason


def test_rounding_and_unit_formatting_are_accepted():
    """30.12 °C is the same number as 30.123; only the digits must be ours."""
    ok, reason = ev.check_explanation(
        explanation("The highest temperature is 30.12 degree_Celsius.",
                    ["variable.temp.value_max"]), EVIDENCE)
    assert ok, reason


def test_a_number_that_is_not_the_backend_value_fails():
    ok, reason = ev.check_explanation(
        explanation("This result covers 99 profiles.", ["profiles.count"]), EVIDENCE)
    assert not ok and "not traceable" in reason


def test_citing_a_fact_the_backend_never_produced_fails():
    ok, reason = ev.check_explanation(
        explanation("Ocean heat content rose.", ["ocean.heat_content"]), EVIDENCE)
    assert not ok and "unknown fact" in reason


@pytest.mark.parametrize("claim", [
    "This is a marine heatwave.",
    "The thermocline sits at 80 m.",
    "This is an anomaly.",
    "The warming trend continues.",
    "Temperature fell because of upwelling.",
])
def test_unsupported_scientific_claims_fail_however_fluent(claim):
    ok, reason = ev.check_explanation(explanation(claim, []), EVIDENCE)
    assert not ok, f"{claim!r} should not be accepted"


# --- the proposal expectations ------------------------------------------------

def test_dates_must_be_the_ones_asked_for():
    assert ev.dates_kept({"time": {"start": "2019-06-01", "end": "2019-06-30"}},
                         "2019-06-01", "2019-06-30")[0]
    assert not ev.dates_kept({"time": {"start": "2024-01-01", "end": "2024-01-09"}},
                             "2019-06-01", "2019-06-30")[0]


def test_variables_are_compared_as_a_set():
    assert ev.variables_are({"variables": ["psal", "temp"]}, ["temp", "psal"])[0]
    assert not ev.variables_are({"variables": ["temp"]}, ["temp", "psal"])[0]


def test_depth_accepts_a_target_within_half_a_metre():
    assert ev.depth_is({"depth": {"mode": "at_depth", "target_m": 100.0}},
                       "at_depth", target_m=100)[0]
    assert not ev.depth_is({"depth": {"mode": "range", "min_m": 0, "max_m": 200}},
                           "at_depth", target_m=100)[0]


def test_quality_filtering_may_never_be_weakened_quietly():
    assert ev.qc_not_weakened({})[0], "an omitted policy leaves the server default"
    assert ev.qc_not_weakened({"qc_policy": {"accepted_qc_flags": [1]}})[0]
    ok, reason = ev.qc_not_weakened({"qc_policy": {"accepted_qc_flags": [1, 4]}})
    assert not ok and "weaken" in reason


def test_the_budget_is_enforced_before_a_request_is_made():
    """The ceiling must stop a request, not merely count it afterwards."""

    class Recorder:
        settings = None

        def __init__(self):
            self.seen = 0

        def complete_json(self, system, user, schema=None):
            self.seen += 1
            return {}

    inner = Recorder()
    provider = ev.CountingProvider(inner, limit=2)
    provider.complete_json("s", "u")
    provider.complete_json("s", "u")
    with pytest.raises(ev.BudgetExceeded):
        provider.complete_json("s", "u")
    assert inner.seen == 2, "the refused request never reached the provider"
    assert provider.calls == 2
