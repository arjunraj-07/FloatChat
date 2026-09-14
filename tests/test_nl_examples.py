"""A small labelled set of question -> expected-handling examples.

**These are contract examples, not a model evaluation.** Each case pairs a
question with a *fixture* provider reply and asserts how FloatChat handles that
reply. No model is called, so nothing here says anything about how well any
model would actually answer these questions. A live evaluation would be a
separate exercise with real provider calls and human labelling.

The value of the set is regression cover for the handling rules: what is
retained, what is reported as changed, what must not be rewritten, and which
outcome each shape of question produces.
"""

from datetime import datetime

import pytest

import main as api_main
from floatchat_core.nl_planner import DraftOutcome, draft_plan
from floatchat_core.nl_provider import ProviderSettings

INDEX = api_main.dataset_index()
#: Fixed so "last summer" style cases resolve deterministically.
REFERENCE_DATE = datetime.fromisoformat("2025-07-15T00:00:00+00:00")

VISIBLE_CONTEXT = {
    "schema_version": "1.0",
    "time": {"start": "2024-01-01T00:00:00Z", "end": "2024-01-10T23:59:59Z"},
    "region": {"kind": "named", "name": "argo_cached_subset"},
    "depth": {"mode": "range", "min_m": 0.0, "max_m": 500.0},
    "variables": ["temp"],
}


class FixtureProvider:
    def __init__(self, reply):
        self.settings = ProviderSettings(
            kind="openai_compatible", base_url="http://fixture", model="fixture",
            api_key=None, timeout_s=5.0, max_output_tokens=800,
            max_question_chars=600, response_format="json_object")
        self._reply = reply

    def complete_json(self, system, user, schema=None):
        return self._reply


# label, question, fixture provider reply, expected outcome
EXAMPLES = [
    (
        "depth-only question keeps the visible region and dates",
        "show temperature at 100 m",
        {"intent": "draft",
         "plan_patch": {"depth": {"mode": "at_depth", "target_m": 100.0}},
         "assumptions": ["Read '100 m' as a single exact depth."]},
        DraftOutcome.PROPOSED_DRAFT,
    ),
    (
        "adding salinity changes only the variable list",
        "include salinity too",
        {"intent": "draft", "plan_patch": {"variables": ["temp", "psal"]}},
        DraftOutcome.PROPOSED_DRAFT,
    ),
    (
        "a named region swaps the region and nothing else",
        "same thing but in the Bay of Bengal",
        {"intent": "draft",
         "plan_patch": {"region": {"kind": "named", "name": "bay_of_bengal"}}},
        DraftOutcome.PROPOSED_DRAFT,
    ),
    (
        "an unresolved comparison asks for clarification",
        "compare it with last summer",
        {"intent": "clarify",
         "clarification_question": "Which period should 'last summer' mean, "
                                   "and should the comparison use the same "
                                   "region and depth?"},
        DraftOutcome.CLARIFICATION_NEEDED,
    ),
    (
        "a vague question asks for clarification rather than guessing",
        "what is going on in the ocean",
        {"intent": "clarify",
         "clarification_question": "Which region, dates and variable would "
                                   "you like to look at?"},
        DraftOutcome.CLARIFICATION_NEEDED,
    ),
    (
        "marine heatwave detection is reported unavailable",
        "detect a marine heatwave here",
        {"intent": "unsupported",
         "plan_patch": {"analyses": ["marine_heatwave_detection"]},
         "unsupported_requests": ["marine_heatwave_detection"]},
        DraftOutcome.UNSUPPORTED_REQUEST,
    ),
    (
        "thermocline estimation is reported unavailable",
        "how deep is the thermocline",
        {"intent": "unsupported",
         "plan_patch": {"analyses": ["thermocline_estimation"]}},
        DraftOutcome.UNSUPPORTED_REQUEST,
    ),
    (
        "a year outside cached coverage is kept as asked",
        "temperature in the Arabian Sea during summer 2019",
        {"intent": "draft",
         "plan_patch": {"time": {"start": "2019-06-01T00:00:00Z",
                                 "end": "2019-08-31T23:59:59Z"},
                        "region": {"kind": "named", "name": "arabian_sea"}}},
        DraftOutcome.PROPOSED_DRAFT,
    ),
    (
        "a relative date resolves against the supplied reference date",
        "the last 30 days",
        {"intent": "draft",
         "plan_patch": {"time": {"start": "2025-06-15T00:00:00Z",
                                 "end": "2025-07-15T23:59:59Z"}},
         "assumptions": ["Resolved 'the last 30 days' against 2025-07-15."]},
        DraftOutcome.PROPOSED_DRAFT,
    ),
    (
        "a named float restricts the selection",
        "just float 2902201",
        {"intent": "draft",
         "plan_patch": {"selection": {"platforms": ["2902201"],
                                      "profile_ids": []}}},
        DraftOutcome.PROPOSED_DRAFT,
    ),
    (
        "a shallow band narrows only the depth range",
        "only the top 50 metres",
        {"intent": "draft",
         "plan_patch": {"depth": {"mode": "range", "min_m": 0.0, "max_m": 50.0}}},
        DraftOutcome.PROPOSED_DRAFT,
    ),
    (
        "an unknown variable is refused rather than mapped to a near match",
        "show conservative temperature",
        {"intent": "draft",
         "plan_patch": {"variables": ["conservative_temperature"]}},
        DraftOutcome.PROVIDER_UNAVAILABLE,
    ),
]


@pytest.mark.parametrize(
    "label,question,reply,expected",
    EXAMPLES,
    ids=[example[0] for example in EXAMPLES],
)
def test_example_outcome(label, question, reply, expected):
    result = draft_plan(question, VISIBLE_CONTEXT, INDEX,
                        FixtureProvider(reply), reference_date=REFERENCE_DATE)
    assert result["outcome"] == expected.value, label


def draft_for(question):
    reply = next(r for _, q, r, _ in EXAMPLES if q == question)
    return draft_plan(question, VISIBLE_CONTEXT, INDEX, FixtureProvider(reply),
                      reference_date=REFERENCE_DATE)


def test_depth_question_retains_region_and_dates_and_says_so():
    result = draft_for("show temperature at 100 m")
    assert result["proposed_plan"]["region"] == VISIBLE_CONTEXT["region"]
    assert result["proposed_plan"]["time"] == VISIBLE_CONTEXT["time"]
    assert {"region", "time", "variables"} <= set(result["retained_fields"])
    assert [c["field"] for c in result["changes"] if c["origin"] == "changed"] \
        == ["depth"]


def test_summer_2019_is_not_rewritten_to_january_2024():
    result = draft_for("temperature in the Arabian Sea during summer 2019")
    assert result["proposed_plan"]["time"]["start"].startswith("2019-06-01")
    assert result["proposed_plan"]["time"]["end"].startswith("2019-08-31")
    assert result["proposed_plan"]["region"]["name"] == "arabian_sea"


def test_relative_dates_resolve_against_the_stated_reference_date():
    result = draft_for("the last 30 days")
    assert result["reference_date_utc"] == REFERENCE_DATE.isoformat()
    assert result["proposed_plan"]["time"]["start"].startswith("2025-06-15")
    assert any("2025-07-15" in a for a in result["assumptions"])


def test_marine_heatwave_names_the_missing_capability():
    result = draft_for("detect a marine heatwave here")
    reasons = " ".join(item["reason"] or "" for item in result["unsupported"])
    assert "daily SST series" in reasons
    assert "90th-percentile" in reasons


def test_clarification_examples_never_produce_a_runnable_plan():
    for _, question, reply, expected in EXAMPLES:
        if expected is not DraftOutcome.CLARIFICATION_NEEDED:
            continue
        result = draft_plan(question, VISIBLE_CONTEXT, INDEX,
                            FixtureProvider(reply),
                            reference_date=REFERENCE_DATE)
        assert result["proposed_plan"] is None
        assert result["clarification_question"]


def test_no_example_response_contains_a_measured_value():
    """The planner must never narrate numbers; assert none leak through."""
    import json
    import re

    for _, question, reply, _ in EXAMPLES:
        result = draft_plan(question, VISIBLE_CONTEXT, INDEX,
                            FixtureProvider(reply),
                            reference_date=REFERENCE_DATE)
        prose = " ".join([
            result.get("clarification_question") or "",
            " ".join(result.get("assumptions") or []),
            " ".join(item.get("reason") or "" for item in result["unsupported"]),
        ])
        # No degree symbols, no PSU, no "anomaly of N"
        assert "°C" not in prose and "psu" not in prose.lower()
        assert not re.search(r"\b\d+(\.\d+)?\s*(degrees|°)", prose)
        assert "results" not in json.dumps(result)
