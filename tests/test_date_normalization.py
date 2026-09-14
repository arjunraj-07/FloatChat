"""Date normalization: UTC days, inclusive ranges, explicit time zones.

Found during the Gemini evaluation (2026-09-14) and fixed on 2026-09-15:

* a date-only end now covers the whole final UTC day, as the planner prompt
  and the frontend's date fields already promised;
* a timestamp the model proposes without a time zone is rejected with a
  recoverable message instead of being read in an assumed zone;
* every proposed time is returned with an explicit UTC offset.

Plans sent directly to the API keep the documented rule that a naive value
means UTC; the time-zone requirement applies to model-generated timestamps.
Every model reply here is a fixture; no provider is called.
"""

from datetime import datetime

import main as api_main
from floatchat_core.nl_planner import (
    DraftOutcome,
    build_system_prompt,
    draft_plan,
)
from floatchat_core.nl_provider import ProviderSettings
from floatchat_core.plan import QueryPlanRequest, normalize_plan
from floatchat_core.plan_validation import validate_plan

INDEX = api_main.dataset_index()

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


class FixtureProvider:
    """Returns one canned reply and counts calls; never contacts a service."""

    def __init__(self, reply):
        self.settings = ProviderSettings(
            kind="openai_compatible", base_url="http://localhost:11434/v1",
            model="fixture", api_key=None, timeout_s=5.0,
            max_output_tokens=800, max_question_chars=600,
            response_format="json_object")
        self.reply = reply
        self.calls = 0

    def complete_json(self, system, user, schema=None):
        self.calls += 1
        return self.reply


def propose(time_patch):
    provider = FixtureProvider({"intent": "draft",
                                "plan_patch": {"time": time_patch}})
    result = draft_plan(
        question="Show temperature in June 2019",
        context={**BASE, "time": {"start": "2024-01-01T00:00:00Z",
                                  "end": "2024-01-10T23:59:59.999Z"}},
        index=INDEX,
        provider=provider,
        reference_date=datetime.fromisoformat("2026-09-15T00:00:00+00:00"),
        revision=3,
    )
    assert provider.calls == 1
    return result


# --------------------------------------------------------------------------
# The schema
# --------------------------------------------------------------------------

def test_a_date_only_end_covers_the_whole_final_day():
    """Formerly a strict expected failure: the end parsed to 00:00."""
    assert normalized_time("2019-06-01", "2019-06-30")["end"] == \
        "2019-06-30T23:59:59.999999Z"


def test_a_single_date_only_day_selects_the_observations_on_that_day():
    """With a 00:00 end, start == end selected nothing. The cached data has
    profiles on 2024-01-09, so a one-day range must find them."""
    plan = QueryPlanRequest.model_validate({
        **BASE, "depth": {"mode": "range", "min_m": 0.0, "max_m": 2000.0},
        "time": {"start": "2024-01-09", "end": "2024-01-09"}})
    assert validate_plan(plan, INDEX)["outcome"] != "valid_no_data"


def test_a_date_only_start_is_the_first_instant_of_that_day():
    assert normalized_time("2019-06-01", "2019-06-30")["start"] == \
        "2019-06-01T00:00:00Z"


def test_naive_timestamps_sent_directly_are_treated_as_utc():
    """The documented API rule for plans a client writes itself."""
    time_range = normalized_time("2019-06-01T00:00:00", "2019-06-30T23:59:59")
    assert time_range == {"start": "2019-06-01T00:00:00Z",
                          "end": "2019-06-30T23:59:59Z", "inclusive": True}


def test_explicit_utc_timestamps_are_kept_exactly():
    time_range = normalized_time("2019-06-01T00:00:00.000Z",
                                 "2019-06-30T23:59:59.999Z")
    assert time_range["start"] == "2019-06-01T00:00:00Z"
    assert time_range["end"] == "2019-06-30T23:59:59.999000Z"


def test_an_offset_is_converted_across_the_date_boundary():
    """In UTC+05:30 the last instant of 30 June UTC falls on 1 July."""
    time_range = normalized_time("2019-06-01T05:30:00+05:30",
                                 "2019-07-01T05:29:59.999+05:30")
    assert time_range["start"] == "2019-06-01T00:00:00Z"
    assert time_range["end"] == "2019-06-30T23:59:59.999000Z"


# --------------------------------------------------------------------------
# The planner prompt
# --------------------------------------------------------------------------

def test_the_planner_prompt_promises_end_of_day_for_a_date_only_end():
    prompt = build_system_prompt(INDEX)
    assert "a date-only end means the end" in prompt


def test_the_planner_prompt_requires_an_explicit_offset():
    prompt = build_system_prompt(INDEX)
    assert "a timestamp without an offset is rejected" in prompt


# --------------------------------------------------------------------------
# Model-generated timestamps
# --------------------------------------------------------------------------

def test_naive_model_timestamps_are_rejected_with_a_recoverable_message():
    """Exactly what Gemini returned for 'June 2019' on 2026-09-14."""
    result = propose({"start": "2019-06-01T00:00:00",
                      "end": "2019-06-30T23:59:59"})
    assert result["outcome"] == DraftOutcome.PROVIDER_UNAVAILABLE.value
    assert result["proposed_plan"] is None
    assert result["normalized_plan"] is None
    assert [(e["code"], e["field"]) for e in result["errors"]] == [
        ("timestamp_timezone_missing", "time.start"),
        ("timestamp_timezone_missing", "time.end"),
    ]
    assert "time zone" in result["provider_message"]
    assert "filters" in result["provider_message"]
    assert result["revision"] == 3


def test_one_naive_edge_is_enough_to_reject_the_proposal():
    result = propose({"start": "2019-06-01T00:00:00Z",
                      "end": "2019-06-30T23:59:59"})
    assert result["proposed_plan"] is None
    assert [e["field"] for e in result["errors"]] == ["time.end"]


def test_the_rejection_reaches_the_client_as_a_readable_reply():
    """Through the real route: one fixture call, and a body the frontend
    renders as a message while leaving the filters unchanged."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from plan_routes import build_plan_router

    provider = FixtureProvider({"intent": "draft", "plan_patch": {
        "time": {"start": "2019-06-01T00:00:00", "end": "2019-06-30T23:59:59"}}})
    app = FastAPI()
    app.include_router(build_plan_router(lambda: INDEX,
                                         nl_provider_factory=lambda: provider))
    response = TestClient(app).post("/api/plan/draft", json={
        "question": "Show temperature in June 2019", "revision": 5})
    body = response.json()
    assert response.status_code == 503
    assert provider.calls == 1
    assert body["proposed_plan"] is None
    assert {e["code"] for e in body["errors"]} == {"timestamp_timezone_missing"}
    assert body["revision"] == 5


def test_date_only_model_dates_become_the_full_utc_days():
    result = propose({"start": "2019-06-01", "end": "2019-06-30"})
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert result["proposed_plan"]["time"] == {
        "start": "2019-06-01T00:00:00Z", "end": "2019-06-30T23:59:59.999999Z"}


def test_offset_model_timestamps_are_proposed_in_explicit_utc():
    result = propose({"start": "2019-06-01T05:30:00+05:30",
                      "end": "2019-07-01T05:29:59.999+05:30"})
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert result["proposed_plan"]["time"] == {
        "start": "2019-06-01T00:00:00Z", "end": "2019-06-30T23:59:59.999000Z"}
