"""Date-normalization behaviour found during the Gemini evaluation (2026-09-14).

Recorded, not fixed: the evaluation ruled out a date-handling refactor. The
known issue is a strict expected failure, so it turns red as soon as the
behaviour is fixed and the marker must then be removed. The passing cases pin
the current contract the fix must stay consistent with.
"""

import pytest

import main as api_main
from floatchat_core.nl_planner import build_system_prompt
from floatchat_core.plan import QueryPlanRequest, normalize_plan

BASE = {
    "schema_version": "1.0",
    "region": {"kind": "named", "name": "argo_cached_subset"},
    "depth": {"mode": "range", "min_m": 0.0, "max_m": 200.0},
    "variables": ["temp"],
}


def normalized_time(start, end):
    plan = QueryPlanRequest.model_validate({**BASE, "time": {"start": start,
                                                             "end": end}})
    return normalize_plan(plan)["time"]


@pytest.mark.xfail(strict=True, reason=(
    "Known issue: a date-only end ('2019-06-30') parses to 00:00 that day, so "
    "the final day is dropped - while the planner prompt tells the model a "
    "date-only end means the end of that day."))
def test_a_date_only_end_covers_the_whole_final_day():
    time_range = normalized_time("2019-06-01", "2019-06-30")
    assert time_range["end"].startswith("2019-06-30T23:59:59")


def test_the_planner_prompt_promises_end_of_day_for_a_date_only_end():
    """The contract the backend does not yet honour (see the xfail above)."""
    prompt = build_system_prompt(api_main.dataset_index())
    assert "a date-only end means the end" in prompt


def test_a_date_only_start_is_the_first_instant_of_that_day():
    assert normalized_time("2019-06-01", "2019-06-30")["start"] == \
        "2019-06-01T00:00:00Z"


def test_naive_timestamps_are_treated_as_utc_by_the_backend():
    """What Gemini returned for 'June 2019'; the backend reads it as UTC."""
    time_range = normalized_time("2019-06-01T00:00:00", "2019-06-30T23:59:59")
    assert time_range == {"start": "2019-06-01T00:00:00Z",
                          "end": "2019-06-30T23:59:59Z", "inclusive": True}


def test_explicit_utc_timestamps_are_kept_exactly():
    time_range = normalized_time("2019-06-01T00:00:00.000Z",
                                 "2019-06-30T23:59:59.999Z")
    assert time_range["start"] == "2019-06-01T00:00:00Z"
    assert time_range["end"] == "2019-06-30T23:59:59.999000Z"
