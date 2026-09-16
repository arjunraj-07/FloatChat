"""Grounded explanations: the facts, the controls on them, and the route.

Three things are being defended here.

1. **Every number is the server's.** The evidence is recomputed from the plan
   and the loaded dataset, so a client cannot assert a measurement, and a model
   cannot state a value - it may only name a fact the server already computed.
2. **Unsupported claims do not survive.** An unknown template, an unknown fact,
   a fact in the wrong slot, two variables in one sentence, or a forbidden
   claim each lose the sentence or the whole answer.
3. **A fallback is never dressed up as a model reply.** Provider failures come
   back labelled as a data summary, never as ``explained``.

Every provider here is a fixture. No request leaves the process.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main as api_main
from floatchat_core import explain
from floatchat_core.evidence import (
    build_evidence,
    dataset_version,
    plan_fingerprint,
)
from floatchat_core.nl_provider import (
    ProviderError,
    ProviderNotConfigured,
    ProviderTimeout,
)
from floatchat_core.plan import QueryPlanRequest
from plan_routes import build_plan_router

INDEX = api_main.dataset_index()

PLAN_BODY = {
    "schema_version": "1.0",
    "region": {"kind": "named", "name": "argo_cached_subset"},
    "depth": {"mode": "range", "min_m": 0.0, "max_m": 500.0},
    "time": {"start": "2024-01-01", "end": "2024-01-09"},
    "variables": ["temp", "psal"],
    "analyses": ["temperature_gradient", "salinity_gradient"],
}

PLAN = QueryPlanRequest.model_validate(PLAN_BODY)


@pytest.fixture(scope="module")
def evidence():
    return build_evidence(PLAN, INDEX)


class FixtureProvider:
    """Returns one canned reply and counts calls; never contacts a service."""

    def __init__(self, reply=None, raises=None):
        self.reply = reply
        self.raises = raises
        self.calls = 0

    def complete_json(self, system, user, schema=None):
        self.calls += 1
        if self.raises is not None:
            raise self.raises
        return self.reply


SCOPE = {"template": "scope.profiles",
         "facts": ["profiles.count", "profiles.float_count",
                   "time.observed_start", "time.observed_end"]}


def facts_by_id(evidence):
    return {fact["id"]: fact for fact in evidence["facts"]}


# --------------------------------------------------------------------------
# The facts themselves
# --------------------------------------------------------------------------

def test_the_evidence_is_small_enough_to_send_to_a_model(evidence):
    """The execution response is about 3.24 MB; this must not be."""
    assert len(json.dumps(evidence)) < 64 * 1024


def test_the_evidence_carries_no_observation_arrays(evidence):
    """A fact is a labelled scalar. Rows of measurements do not belong here."""
    for fact in evidence["facts"]:
        assert not isinstance(fact["value"], (list, dict)), fact["id"]


def test_counts_match_what_the_validator_found(evidence):
    """The headline counts are the server's own, not a caller's."""
    from floatchat_core.plan_validation import validate_plan

    matching = validate_plan(PLAN, INDEX)["matching"]
    by_id = facts_by_id(evidence)
    assert by_id["profiles.count"]["value"] == matching["profiles"]
    assert by_id["profiles.float_count"]["value"] == matching["floats"]
    assert by_id["observations.count"]["value"] == matching["observations"]


def test_measured_and_derived_facts_are_distinguished(evidence):
    """A computed gradient must never read as an observation."""
    by_id = facts_by_id(evidence)
    assert by_id["gradient.temp.strongest_cooling.value"]["kind"] == "derived"
    assert by_id["variable.temp.depth_max_m"]["kind"] == "measured"


def test_every_value_bearing_fact_declares_its_units(evidence):
    """Unit-free numbers are how wrong claims get made."""
    needs_units = ("depth_m", "value_min", "value_max", "strongest_cooling.value")
    for fact in evidence["facts"]:
        if fact["id"].endswith(needs_units):
            assert fact["units"], fact["id"]


def test_fact_ids_are_unique_and_stable(evidence):
    ids = [fact["id"] for fact in evidence["facts"]]
    assert len(ids) == len(set(ids))
    assert evidence["fact_ids"] == ids


def test_a_variable_with_no_usable_values_is_reported_not_hidden(evidence):
    """Salinity fails QC on most levels here; that must be visible."""
    by_id = facts_by_id(evidence)
    assert by_id["variable.psal.excluded_observations"]["value"] > 0
    assert by_id["variable.psal.profiles_with_values"]["value"] < \
        by_id["profiles.count"]["value"]


def test_missing_climatology_is_stated_rather_than_left_blank():
    """With no lookup, the absence is said out loud."""
    offline = build_evidence(PLAN, INDEX, woa_lookup=None)
    assert not [f for f in offline["facts"] if f["id"].startswith("woa.")]
    assert any("climatology" in note for note in offline["notes"])


def test_a_failing_climatology_lookup_is_unavailable_not_fatal():
    """A lookup that raises must not take the explanation down with it."""
    def broken(profile_id):
        raise RuntimeError("reference retrieval failed")

    result = build_evidence(PLAN, INDEX, woa_lookup=broken)
    assert not [f for f in result["facts"] if f["id"].startswith("woa.")]
    assert any("climatology" in note for note in result["notes"])


def test_a_climatology_comparison_is_reported_when_one_is_justified():
    """A stubbed successful match reaches the facts with its baseline."""
    def lookup(profile_id):
        return {"status": "Success", "difference": 0.5,
                "comparison_depth": 100.0, "baseline_period": "1991-2020"}

    by_id = facts_by_id(build_evidence(PLAN, INDEX, woa_lookup=lookup))
    assert by_id["woa.difference"]["value"] == 0.5
    assert by_id["woa.difference"]["kind"] == "reference"
    assert by_id["woa.baseline_period"]["value"] == "1991-2020"


def test_the_fingerprint_changes_with_the_plan_and_the_version_does_not():
    """One identifies the result; the other identifies the data."""
    other = QueryPlanRequest.model_validate({**PLAN_BODY, "variables": ["temp"]})
    assert plan_fingerprint(PLAN) != plan_fingerprint(other)
    assert dataset_version(INDEX) == dataset_version(INDEX)


# --------------------------------------------------------------------------
# What a model is allowed to do with them
# --------------------------------------------------------------------------

def test_values_are_inserted_by_the_server_not_by_the_model(evidence):
    """The model names facts; the numbers come from the evidence."""
    provider = FixtureProvider({
        "selections": [SCOPE],
        # A number the model tried to state. It must not appear.
        "text": "This result covers 9999 profiles.",
    })
    result = explain.explain_result(evidence, provider)
    rendered = result["sentences"][0]["text"]
    profiles = facts_by_id(evidence)["profiles.count"]["value"]
    assert f"{profiles} profiles" in rendered
    assert "9999" not in rendered


def test_an_unknown_template_is_rejected(evidence):
    provider = FixtureProvider({"selections": [
        {"template": "ocean.is_warming", "facts": []}, SCOPE]})
    result = explain.explain_result(evidence, provider)
    assert [r["reason"] for r in result["rejected"]] == ["unknown_template"]
    assert len(result["sentences"]) == 1


def test_an_unknown_fact_reference_is_rejected(evidence):
    provider = FixtureProvider({"selections": [
        {"template": "scope.locations", "facts": ["region.invented_count"]},
        SCOPE]})
    result = explain.explain_result(evidence, provider)
    assert result["rejected"][0]["reason"] == "unknown_fact"


def test_a_fact_cannot_fill_a_slot_meant_for_another_quantity(evidence):
    """A depth in a value slot would render a plausible, false sentence."""
    provider = FixtureProvider({"selections": [
        {"template": "variable.range",
         "facts": ["variable.temp.depth_min_m", "variable.temp.value_max"]},
        SCOPE]})
    result = explain.explain_result(evidence, provider)
    assert result["rejected"][0]["reason"] == "fact_does_not_fit_slot"


def test_one_sentence_cannot_describe_two_variables(evidence):
    """Mixing temperature and salinity would misattribute a value."""
    provider = FixtureProvider({"selections": [
        {"template": "variable.range",
         "facts": ["variable.temp.value_min", "variable.psal.value_max"]},
        SCOPE]})
    result = explain.explain_result(evidence, provider)
    assert result["rejected"][0]["reason"] == "mixed_variables"


@pytest.mark.parametrize("claim", [
    "This confirms a marine heatwave in the region.",
    "A thermocline was detected at 75 m.",
    "Conditions were normal across the ocean.",
])
def test_a_forbidden_claim_discards_the_whole_answer(evidence, claim):
    """The prose is never shown, so the answer it came with is not trusted."""
    provider = FixtureProvider({"selections": [SCOPE], "note": claim})
    result = explain.explain_result(evidence, provider)
    assert result["outcome"] == explain.ExplainOutcome.PROVIDER_UNAVAILABLE.value
    assert result["source"] == "data_summary"
    assert claim not in json.dumps(result)


def test_the_steepest_interval_is_never_called_a_thermocline(evidence):
    """The caveat travels with the sentence, not in a footnote elsewhere."""
    provider = FixtureProvider({"selections": [
        {"template": "gradient.cooling",
         "facts": ["gradient.temp.strongest_cooling.value",
                   "gradient.temp.strongest_cooling.upper_depth_m",
                   "gradient.temp.strongest_cooling.lower_depth_m"]}]})
    result = explain.explain_result(evidence, provider)
    text = result["sentences"][0]["text"].lower()
    assert "thermocline" not in text and "mixed-layer" not in text
    assert any("not a detected thermocline" in c for c in result["caveats"])


def test_a_few_profiles_are_never_described_as_the_ocean(evidence):
    """The scope sentence says what it covers and carries its own limit."""
    provider = FixtureProvider({"selections": [SCOPE]})
    result = explain.explain_result(evidence, provider)
    assert any("not a survey" in c for c in result["caveats"])


def test_selections_referencing_only_absent_facts_explain_nothing(evidence):
    """With no climatology available, the comparison sentence is unsupported."""
    provider = FixtureProvider({"selections": [
        {"template": "woa.difference",
         "facts": ["woa.difference", "woa.comparison_depth_m",
                   "woa.baseline_period"]}]})
    result = explain.explain_result(evidence, provider)
    assert result["outcome"] == \
        explain.ExplainOutcome.INSUFFICIENT_EVIDENCE.value
    assert not result["sentences"]


def test_evidence_without_facts_explains_nothing(evidence):
    result = explain.explain_result(
        {"facts": [], "dataset_version": "v", "plan_fingerprint": "f"},
        FixtureProvider({"selections": [SCOPE]}))
    assert result["outcome"] == \
        explain.ExplainOutcome.INSUFFICIENT_EVIDENCE.value


def test_the_number_of_sentences_is_bounded(evidence):
    provider = FixtureProvider({"selections": [SCOPE] * 20})
    result = explain.explain_result(evidence, provider)
    assert len(result["sentences"]) <= explain.MAX_SENTENCES


# --------------------------------------------------------------------------
# Provider failures
# --------------------------------------------------------------------------

@pytest.mark.parametrize("failure", [
    ProviderNotConfigured("No provider is configured."),
    ProviderTimeout("The service did not respond in time."),
    ProviderError("The service refused the request."),
    None,  # no provider at all
])
def test_a_provider_failure_gives_a_labelled_data_summary(evidence, failure):
    """Useful, deterministic, and never marked as a model answer."""
    provider = None if failure is None else FixtureProvider(raises=failure)
    result = explain.explain_result(evidence, provider)
    assert result["outcome"] == explain.ExplainOutcome.PROVIDER_UNAVAILABLE.value
    assert result["source"] == "data_summary"
    assert result["sentences"], "the summary should still say something"
    assert result["provider_message"]


def test_the_data_summary_uses_the_same_server_values(evidence):
    """The fallback is the same facts, not a second calculation."""
    summary = explain.data_summary(evidence)
    profiles = facts_by_id(evidence)["profiles.count"]["value"]
    assert f"{profiles} profiles" in summary["sentences"][0]["text"]


def test_a_malformed_provider_reply_does_not_crash(evidence):
    for reply in [None, [], "text", {"selections": "not a list"}, {}]:
        result = explain.explain_result(evidence, FixtureProvider(reply))
        assert result["outcome"] != explain.ExplainOutcome.EXPLAINED.value


def test_no_credential_ever_reaches_the_response(evidence):
    """Provider messages are shown to users, so they must stay clean."""
    provider = FixtureProvider(
        raises=ProviderError("request failed for key AIzaSyEXAMPLEKEY123"))
    result = explain.explain_result(evidence, provider)
    assert "AIzaSy" not in json.dumps(result)


# --------------------------------------------------------------------------
# The route
# --------------------------------------------------------------------------

def make_client(provider=None, woa_lookup=None):
    app = FastAPI()
    app.include_router(build_plan_router(
        lambda: INDEX,
        nl_provider_factory=(lambda: provider) if provider else None,
        woa_lookup=woa_lookup))
    return TestClient(app)


def test_the_route_explains_an_executed_plan():
    provider = FixtureProvider({"selections": [SCOPE]})
    response = make_client(provider).post("/api/plan/explain",
                                          json={"plan": PLAN_BODY})
    body = response.json()
    assert response.status_code == 200
    assert body["outcome"] == explain.ExplainOutcome.EXPLAINED.value
    assert provider.calls == 1
    assert body["sentences"]


def test_the_route_returns_the_evidence_for_inspection():
    """"View evidence" must not need a second request."""
    provider = FixtureProvider({"selections": [SCOPE]})
    body = make_client(provider).post("/api/plan/explain",
                                      json={"plan": PLAN_BODY}).json()
    assert body["evidence"]["facts"]
    used = set(body["used_fact_ids"])
    assert used <= set(body["evidence"]["fact_ids"])


def test_the_route_binds_the_answer_to_the_data_and_the_plan():
    provider = FixtureProvider({"selections": [SCOPE]})
    body = make_client(provider).post("/api/plan/explain",
                                      json={"plan": PLAN_BODY}).json()
    assert body["dataset_version"] == dataset_version(INDEX)
    assert body["plan_fingerprint"] == plan_fingerprint(PLAN)


def test_a_stale_dataset_version_is_refused_not_explained():
    """Explaining this would describe data the caller never saw."""
    provider = FixtureProvider({"selections": [SCOPE]})
    response = make_client(provider).post("/api/plan/explain", json={
        "plan": PLAN_BODY, "dataset_version": "sha256:something-else"})
    body = response.json()
    assert response.status_code == 409
    assert body["outcome"] == explain.ExplainOutcome.DATASET_MISMATCH.value
    assert provider.calls == 0, "a mismatch must not reach the provider"


def test_a_matching_dataset_version_is_accepted():
    provider = FixtureProvider({"selections": [SCOPE]})
    response = make_client(provider).post("/api/plan/explain", json={
        "plan": PLAN_BODY, "dataset_version": dataset_version(INDEX)})
    assert response.status_code == 200


def test_the_route_never_trusts_client_supplied_measurements():
    """Numbers sent alongside the plan are ignored entirely."""
    provider = FixtureProvider({"selections": [SCOPE]})
    body = make_client(provider).post("/api/plan/explain", json={
        "plan": PLAN_BODY,
        "facts": [{"id": "profiles.count", "value": 9999, "units": None,
                   "kind": "count", "label": "profiles returned"}],
        "results": {"profiles": 9999},
    }).json()
    profiles = facts_by_id(body["evidence"])["profiles.count"]["value"]
    assert profiles != 9999
    assert "9999" not in body["sentences"][0]["text"]


def test_a_missing_plan_is_a_clear_error():
    response = make_client().post("/api/plan/explain", json={})
    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "missing_plan"


def test_an_unparseable_plan_is_reported_not_explained():
    response = make_client().post("/api/plan/explain",
                                  json={"plan": {"schema_version": "1.0"}})
    assert response.status_code == 422
    assert response.json()["errors"]


def test_a_malformed_body_is_a_clear_error():
    response = make_client().post("/api/plan/explain", content=b"{not json",
                                  headers={"content-type": "application/json"})
    assert response.status_code == 400


def test_an_oversized_body_is_refused():
    response = make_client().post("/api/plan/explain", json={
        "plan": PLAN_BODY, "padding": "x" * (33 * 1024)})
    assert response.status_code == 413


def test_the_route_falls_back_without_a_provider():
    """No provider configured: a data summary, plainly labelled."""
    response = make_client().post("/api/plan/explain", json={"plan": PLAN_BODY})
    body = response.json()
    assert response.status_code == 200
    assert body["outcome"] == explain.ExplainOutcome.PROVIDER_UNAVAILABLE.value
    assert body["source"] == "data_summary"


def test_explaining_requires_an_account_in_the_deployed_application():
    """Enforced by the backend, not by a frontend route guard."""
    response = TestClient(api_main.app).post("/api/plan/explain",
                                             json={"plan": PLAN_BODY})
    assert response.status_code in (401, 403)


def test_the_normalized_plan_is_not_itself_a_request_plan():
    """Why the client must send the plan it submitted, not the one returned.

    The executed plan carries normalization fields (``time.inclusive`` among
    them) that the request schema refuses. Explaining therefore uses the
    request-shaped plan snapshotted when the query ran. This is pinned because
    sending the wrong one fails only in a real browser: every offline test
    would still pass while each actual click returned 422.
    """
    from floatchat_core.plan_execution import execute_plan

    normalized = execute_plan(PLAN, INDEX).get("plan")
    assert normalized, "execution should report the plan it applied"

    provider = FixtureProvider({"selections": [SCOPE]})
    response = make_client(provider).post("/api/plan/explain",
                                          json={"plan": normalized})
    assert response.status_code == 422
    assert provider.calls == 0, "an unparseable plan must not reach a provider"


def test_the_submitted_plan_identifies_the_same_result():
    """The request-shaped plan fingerprints to the result it produced."""
    provider = FixtureProvider({"selections": [SCOPE]})
    body = make_client(provider).post("/api/plan/explain",
                                      json={"plan": PLAN_BODY}).json()
    assert body["plan_fingerprint"] == plan_fingerprint(PLAN)


def test_explaining_does_not_execute_anything_else():
    """The explanation route must not alter drafts, QC or charts."""
    provider = FixtureProvider({"selections": [SCOPE]})
    body = make_client(provider).post("/api/plan/explain",
                                      json={"plan": PLAN_BODY}).json()
    assert "normalized_plan" not in body
    assert "observations" not in json.dumps(body["sentences"])
