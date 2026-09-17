"""Tests for natural-language drafting, using deterministic provider mocks.

These are **contract** tests. Every provider reply is a fixture written here,
so they prove how FloatChat handles a response — not how good any model is.
No live model is called and no accuracy claim can be drawn from them.
"""

import json

import pytest

import main as api_main

from conftest import register_test_account
from fastapi.testclient import TestClient

from floatchat_core.nl_planner import (
    DraftOutcome,
    apply_patch,
    coverage_brief,
    diff_plans,
    draft_plan,
    normalize_context,
)
from floatchat_core.nl_provider import (
    ENV_BASE_URL,
    ENV_MODEL,
    ENV_PROVIDER,
    OpenAICompatibleProvider,
    ProviderError,
    ProviderNotConfigured,
    ProviderSettings,
    ProviderTimeout,
    build_provider,
    provider_status,
    settings_from_env,
)

INDEX = api_main.dataset_index()
EXTENT = INDEX.describe()
REFERENCE = "2025-07-15T00:00:00+00:00"


def settings(**overrides) -> ProviderSettings:
    base = dict(kind="openai_compatible", base_url="http://localhost:11434/v1",
                model="test-model", api_key=None, timeout_s=5.0,
                max_output_tokens=800, max_question_chars=600,
                response_format="json_object")
    base.update(overrides)
    return ProviderSettings(**base)


class MockProvider:
    """Returns a canned object, or raises a canned exception."""

    def __init__(self, reply=None, error=None, **setting_overrides):
        self.settings = settings(**setting_overrides)
        self._reply = reply
        self._error = error
        self.calls = []

    def complete_json(self, system, user, schema=None):
        self.calls.append({"system": system, "user": user, "schema": schema})
        if self._error is not None:
            raise self._error
        return self._reply


def base_context():
    return {
        "schema_version": "1.0",
        "time": {"start": "2024-01-01T00:00:00Z", "end": "2024-01-10T23:59:59Z"},
        "region": {"kind": "named", "name": "argo_cached_subset"},
        "depth": {"mode": "range", "min_m": 0.0, "max_m": 500.0},
        "variables": ["temp"],
    }


def run(reply=None, error=None, question="show temperature at 100 m",
        context=None, **overrides):
    provider = MockProvider(reply=reply, error=error, **overrides)
    from datetime import datetime
    result = draft_plan(
        question=question,
        context=context if context is not None else base_context(),
        index=INDEX,
        provider=provider,
        reference_date=datetime.fromisoformat(REFERENCE),
        revision=7,
    )
    return result, provider


# --------------------------------------------------------------------------
# Valid structured response
# --------------------------------------------------------------------------

def test_a_valid_patch_becomes_a_proposed_draft():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"depth": {"mode": "at_depth", "target_m": 100.0}},
        "assumptions": ["Interpreted '100 m' as an exact depth."],
    })
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert result["proposed_plan"]["depth"] == {"mode": "at_depth",
                                                "target_m": 100.0}
    assert result["normalized_plan"]["depth"]["interpolation_required"] is True
    assert result["assumptions"]


def test_the_response_echoes_the_revision_and_reference_date():
    result, _ = run({"intent": "draft", "plan_patch": {}})
    assert result["revision"] == 7
    assert result["reference_date_utc"] == REFERENCE
    assert result["question"] == "show temperature at 100 m"


def test_drafting_does_not_execute_anything():
    """A proposal must never carry results, and must not touch execution."""
    result, _ = run({"intent": "draft", "plan_patch": {}})
    assert "results" not in result
    assert "executed" not in result
    assert result["proposed_plan"] is not None


def test_the_prompt_carries_no_observations_or_secrets():
    _, provider = run({"intent": "draft", "plan_patch": {}},
                      api_key="super-secret-token")
    sent = provider.calls[0]["system"] + provider.calls[0]["user"]
    assert "super-secret-token" not in sent
    # Coverage is summarised, never enumerated row by row.
    assert "26.5" not in sent
    assert len(sent) < 20000
    payload = json.loads(provider.calls[0]["system"])
    assert "known_float_ids" in payload["coverage"]
    assert "observations" not in payload["coverage"]


def test_the_prompt_tells_the_model_not_to_move_requested_dates():
    _, provider = run({"intent": "draft", "plan_patch": {}})
    rules = json.loads(provider.calls[0]["system"])["hard_rules"]
    assert any("Never move a requested date" in rule for rule in rules)
    assert any("Never state or estimate" in rule for rule in rules)


# --------------------------------------------------------------------------
# Retained context and explicit changes
# --------------------------------------------------------------------------

def test_unmentioned_fields_are_retained_from_the_manual_draft():
    """'temperature at 100 m' keeps the visible region and dates."""
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"depth": {"mode": "at_depth", "target_m": 100.0}},
    })
    proposed = result["proposed_plan"]
    assert proposed["region"] == base_context()["region"]
    assert proposed["time"]["start"] == base_context()["time"]["start"]
    assert "region" in result["retained_fields"]
    assert "time" in result["retained_fields"]


def test_changed_fields_are_reported_with_before_and_after():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"depth": {"mode": "at_depth", "target_m": 100.0}},
    })
    changed = [c for c in result["changes"] if c["origin"] == "changed"]
    assert [c["field"] for c in changed] == ["depth"]
    assert changed[0]["previous"]["max_m"] == 500.0
    assert changed[0]["proposed"]["target_m"] == 100.0


def test_the_change_list_is_computed_not_taken_from_the_model():
    """A model that lies about what it changed does not affect the diff."""
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"variables": ["temp", "psal"]},
        "assumptions": ["I changed nothing at all."],
    })
    changed = {c["field"] for c in result["changes"] if c["origin"] == "changed"}
    assert changed == {"variables"}


def test_a_region_is_not_silently_narrowed():
    result, _ = run({"intent": "draft", "plan_patch": {"variables": ["psal"]}})
    assert result["proposed_plan"]["region"] == base_context()["region"]


def test_qc_policy_is_not_relaxed_by_the_model():
    """qc_policy is not patchable: the request is reported, never applied."""
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"qc_policy": {"accepted_qc_flags": [1, 2, 3],
                                     "data_modes": ["R"]}},
    })
    assert result["outcome"] == DraftOutcome.UNSUPPORTED_REQUEST.value
    # Nothing else changed, so there is nothing to apply.
    assert result["proposed_plan"] is None
    policy = [u for u in result["unsupported"] if u["kind"] == "policy"]
    assert policy
    assert "cannot be changed through a question" in policy[0]["reason"]
    # qc_policy is a schema field, so it is not misreported as unknown.
    assert not any("does not define" in a and "qc_policy" in a
                   for a in result["assumptions"])


def test_a_qc_request_names_the_stored_flags_from_the_data():
    result, _ = run({"intent": "unsupported",
                     "plan_patch": {"qc_policy": {"accepted_qc_flags": [4]}},
                     "unsupported_requests": ["include QC=4 observations"]})
    reason = next(u["reason"] for u in result["unsupported"]
                  if u["kind"] == "policy")
    assert str(sorted(INDEX.all_stored_qc_flags)) in reason
    assert "cannot be reconstructed" in reason


def test_a_policy_request_alongside_a_real_change_keeps_the_change():
    result, _ = run({"intent": "draft",
                     "plan_patch": {"variables": ["temp", "psal"],
                                    "qc_policy": {"accepted_qc_flags": [4]}}})
    assert result["outcome"] == DraftOutcome.UNSUPPORTED_REQUEST.value
    assert result["proposed_plan"]["variables"] == ["temp", "psal"]
    assert result["proposed_plan"]["qc_policy"]["accepted_qc_flags"] == [1]


def test_a_declared_unsupported_request_is_surfaced_not_dropped():
    result, _ = run({"intent": "unsupported", "plan_patch": {},
                     "unsupported_requests": ["include QC=4 observations"]})
    assert result["outcome"] == DraftOutcome.UNSUPPORTED_REQUEST.value
    assert result["proposed_plan"] is None
    assert result["unsupported"][0]["requested"] == "include QC=4 observations"
    assert result["unsupported"][0]["kind"] == "request"


def test_the_prompt_asks_for_every_named_field_and_forbids_policy_changes():
    _, provider = run({"intent": "draft", "plan_patch": {}})
    rules = " ".join(json.loads(provider.calls[0]["system"])["hard_rules"])
    assert "sets both variables and depth" in rules
    assert "cannot be changed through a question" in rules


def test_unknown_patch_fields_are_ignored_and_reported():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"depth": {"mode": "range", "min_m": 0.0, "max_m": 20.0},
                       "sea_state": "choppy", "confidence": 0.93},
    })
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert "confidence" not in json.dumps(result["proposed_plan"])
    noted = " ".join(result["assumptions"])
    assert "sea_state" in noted and "confidence" in noted


def test_with_no_prior_context_every_field_is_a_default():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {
            "time": {"start": "2024-01-01T00:00:00Z",
                     "end": "2024-01-10T23:59:59Z"},
            "region": {"kind": "named", "name": "argo_cached_subset"},
            "depth": {"mode": "range", "min_m": 0.0, "max_m": 100.0},
            "variables": ["temp"],
        },
    }, context={})
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert all(c["origin"] == "default" for c in result["changes"])
    assert result["retained_fields"] == []


# --------------------------------------------------------------------------
# Unknown fields and variables
# --------------------------------------------------------------------------

def test_an_unknown_variable_is_not_coerced_into_a_plan():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"variables": ["conservative_temperature"]},
    })
    assert result["outcome"] != DraftOutcome.PROPOSED_DRAFT.value
    assert result["proposed_plan"] is None
    assert any(e["code"] == "unsupported_enum_value" for e in result["errors"])


def test_an_invented_float_id_fails_schema_validation():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"selection": {"platforms": ["not-a-wmo"],
                                     "profile_ids": []}},
    })
    assert result["proposed_plan"] is None
    assert any(e["code"] == "malformed_identifier" for e in result["errors"])


def test_a_reversed_date_range_is_rejected_not_silently_swapped():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"time": {"start": "2024-06-01T00:00:00Z",
                                "end": "2024-01-01T00:00:00Z"}},
    })
    assert result["proposed_plan"] is None
    assert any(e["code"] == "reversed_date_range" for e in result["errors"])


# --------------------------------------------------------------------------
# Malformed output
# --------------------------------------------------------------------------

@pytest.mark.parametrize("reply", [
    {},
    {"intent": "banana"},
    {"intent": "clarify"},
    {"intent": "clarify", "clarification_question": "   "},
])
def test_malformed_replies_are_reported_as_provider_unavailable(reply):
    result, _ = run(reply)
    assert result["outcome"] == DraftOutcome.PROVIDER_UNAVAILABLE.value
    assert result["proposed_plan"] is None
    assert result["errors"]


def test_a_non_object_plan_patch_does_not_crash():
    result, _ = run({"intent": "draft", "plan_patch": "everything"})
    # Falls back to the caller's own draft, unchanged.
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert result["proposed_plan"]["variables"] == ["temp"]


def test_extracting_json_tolerates_code_fences():
    from floatchat_core.nl_provider import _extract_json

    assert _extract_json('```json\n{"intent": "draft"}\n```') == {"intent": "draft"}
    assert _extract_json('Sure!\n{"intent": "draft"}\n') == {"intent": "draft"}
    with pytest.raises(ProviderError):
        _extract_json("no json here")
    with pytest.raises(ProviderError):
        _extract_json("")
    with pytest.raises(ProviderError):
        _extract_json("[1,2,3]")


# --------------------------------------------------------------------------
# Ambiguity
# --------------------------------------------------------------------------

def test_an_ambiguous_question_asks_for_clarification():
    result, _ = run({
        "intent": "clarify",
        "clarification_question": "Compare the current selection with which "
                                  "period, and over which region?",
    }, question="compare it with last summer")
    assert result["outcome"] == DraftOutcome.CLARIFICATION_NEEDED.value
    assert result["proposed_plan"] is None
    assert "which period" in result["clarification_question"]


def test_clarification_does_not_invent_a_runnable_plan():
    result, _ = run({"intent": "clarify",
                     "clarification_question": "Which region?",
                     "plan_patch": {"variables": ["temp", "psal"]}},
                    question="compare it with last summer")
    assert result["outcome"] == DraftOutcome.CLARIFICATION_NEEDED.value
    assert result["proposed_plan"] is None
    assert result["changes"] == []


# --------------------------------------------------------------------------
# Unsupported analyses
# --------------------------------------------------------------------------

def test_an_unsupported_analysis_is_reported_from_the_registry():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"analyses": ["marine_heatwave_detection"]},
    }, question="detect a marine heatwave here")
    assert result["outcome"] == DraftOutcome.UNSUPPORTED_REQUEST.value
    assert result["unsupported"][0]["requested"] == "marine_heatwave_detection"
    assert "daily SST series" in result["unsupported"][0]["reason"]


def test_an_unsupported_analysis_is_never_swapped_for_a_supported_one():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"analyses": ["anomaly_significance_test"]},
    })
    assert result["outcome"] == DraftOutcome.UNSUPPORTED_REQUEST.value
    assert result["proposed_plan"]["analyses"] == ["anomaly_significance_test"]


def test_capability_truth_comes_from_the_registry_not_the_model():
    """A model claiming an implemented analysis is unsupported is overruled."""
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"analyses": ["depth_profile"]},
        "unsupported_requests": ["depth_profile"],
    })
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert result["unsupported"] == []


def test_an_unsupported_output_is_also_caught():
    result, _ = run({"intent": "draft", "plan_patch": {"outputs": ["globe_webgl"]}})
    assert result["outcome"] == DraftOutcome.UNSUPPORTED_REQUEST.value
    assert result["unsupported"][0]["kind"] == "output"


# --------------------------------------------------------------------------
# Dates and regions outside cached coverage
# --------------------------------------------------------------------------

def test_a_date_outside_coverage_is_kept_not_rewritten():
    """The cached subset is January 2024. A 2019 question stays in 2019."""
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"time": {"start": "2019-06-01T00:00:00Z",
                                "end": "2019-08-31T23:59:59Z"}},
    }, question="temperature in the Arabian Sea in summer 2019")
    assert result["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert result["proposed_plan"]["time"]["start"].startswith("2019-06-01")
    assert "2024-01" not in result["proposed_plan"]["time"]["start"]


def test_a_region_outside_coverage_is_kept_not_rewritten():
    result, _ = run({
        "intent": "draft",
        "plan_patch": {"region": {"kind": "named", "name": "bay_of_bengal"}},
    })
    assert result["proposed_plan"]["region"]["name"] == "bay_of_bengal"


def test_the_proposal_is_validated_honestly_by_the_ordinary_validator():
    """A proposal outside coverage validates to no-data, not to an error."""
    from floatchat_core.plan import QueryPlanRequest
    from floatchat_core.plan_validation import validate_plan

    result, _ = run({
        "intent": "draft",
        "plan_patch": {"time": {"start": "2019-06-01T00:00:00Z",
                                "end": "2019-08-31T23:59:59Z"}},
    })
    plan = QueryPlanRequest.model_validate(result["proposed_plan"])
    validation = validate_plan(plan, INDEX)
    assert validation["outcome"] == "valid_no_data"
    assert validation["errors"] == []


# --------------------------------------------------------------------------
# Provider unavailability
# --------------------------------------------------------------------------

def test_a_timeout_is_reported_distinctly():
    result, _ = run(error=ProviderTimeout("did not respond within 5s"))
    assert result["outcome"] == DraftOutcome.PROVIDER_UNAVAILABLE.value
    assert result["errors"][0]["code"] == "provider_timeout"


def test_a_provider_error_is_reported_distinctly():
    result, _ = run(error=ProviderError("HTTP 500"))
    assert result["errors"][0]["code"] == "provider_error"


def test_a_missing_provider_is_reported_without_calling_anything():
    from datetime import datetime

    result = draft_plan("anything", base_context(), INDEX, provider=None,
                        reference_date=datetime.fromisoformat(REFERENCE))
    assert result["outcome"] == DraftOutcome.PROVIDER_UNAVAILABLE.value
    assert result["errors"][0]["code"] == "provider_not_configured"
    assert "Manual query building is unaffected" in result["provider_message"]


def test_an_overlong_question_is_refused_before_the_provider_is_called():
    result, provider = run({"intent": "draft"}, question="x" * 5000,
                           max_question_chars=100)
    assert result["errors"][0]["code"] == "question_too_long"
    assert provider.calls == []


# --------------------------------------------------------------------------
# Provider configuration
# --------------------------------------------------------------------------

def test_no_configuration_means_the_feature_is_off():
    assert settings_from_env({}) is None
    status = provider_status({})
    assert status["configured"] is False
    assert "not configured" in status["message"]


def test_a_half_configured_provider_fails_loudly():
    with pytest.raises(ProviderError) as exc:
        settings_from_env({ENV_PROVIDER: "openai_compatible"})
    assert ENV_BASE_URL in str(exc.value)


def test_an_unknown_provider_kind_is_refused():
    with pytest.raises(ProviderError):
        settings_from_env({ENV_PROVIDER: "some_vendor"})


def test_a_complete_configuration_is_accepted():
    resolved = settings_from_env({
        ENV_PROVIDER: "openai_compatible",
        ENV_BASE_URL: "http://localhost:11434/v1/",
        ENV_MODEL: "llama3",
    })
    assert resolved.base_url == "http://localhost:11434/v1"
    assert resolved.model == "llama3"


def test_status_never_reveals_the_key():
    described = settings(api_key="sk-secret-value").describe()
    assert "sk-secret-value" not in json.dumps(described)
    assert described["credential_configured"] is True


def test_build_provider_raises_when_unconfigured(monkeypatch):
    for name in (ENV_PROVIDER, ENV_BASE_URL, ENV_MODEL):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ProviderNotConfigured):
        build_provider()


# --------------------------------------------------------------------------
# The HTTP adapter itself, against a fake session
# --------------------------------------------------------------------------

class FakeResponse:
    def __init__(self, status_code=200, payload=None, text_body=None):
        self.status_code = status_code
        self._payload = payload
        self._text = text_body

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class FakeSession:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.requests = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.requests.append({"url": url, "json": json, "headers": headers,
                              "timeout": timeout})
        if self.error:
            raise self.error
        return self.response


def completion(content):
    return {"choices": [{"message": {"content": content}}]}


def test_the_adapter_posts_a_bounded_chat_completion():
    session = FakeSession(FakeResponse(200, completion('{"intent":"draft"}')))
    provider = OpenAICompatibleProvider(settings(api_key="k"), session=session)
    assert provider.complete_json("sys", "usr") == {"intent": "draft"}

    sent = session.requests[0]
    assert sent["url"] == "http://localhost:11434/v1/chat/completions"
    assert sent["timeout"] == 5.0
    assert sent["json"]["max_tokens"] == 800
    assert sent["json"]["temperature"] == 0
    assert sent["json"]["response_format"] == {"type": "json_object"}
    assert sent["headers"]["Authorization"] == "Bearer k"


def test_the_adapter_omits_authorization_when_no_key_is_set():
    session = FakeSession(FakeResponse(200, completion('{"intent":"draft"}')))
    OpenAICompatibleProvider(settings(), session=session).complete_json("s", "u")
    assert "Authorization" not in session.requests[0]["headers"]


def test_the_adapter_sends_a_json_schema_when_configured():
    session = FakeSession(FakeResponse(200, completion('{"intent":"draft"}')))
    provider = OpenAICompatibleProvider(
        settings(response_format="json_schema"), session=session)
    provider.complete_json("s", "u", {"type": "object"})
    assert session.requests[0]["json"]["response_format"]["type"] == "json_schema"


@pytest.mark.parametrize("status", [400, 401, 429, 500])
def test_adapter_http_errors_become_provider_errors(status):
    session = FakeSession(FakeResponse(status, {}))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderError):
        provider.complete_json("s", "u")


@pytest.mark.parametrize("status", [408, 504])
def test_adapter_gateway_timeouts_become_timeouts(status):
    session = FakeSession(FakeResponse(status, {}))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderTimeout):
        provider.complete_json("s", "u")


def test_a_google_style_error_body_is_surfaced_and_scrubbed():
    """Gemini returns a list of {"error": {...}}; keep status and message."""
    key = "AIzaSyEXAMPLEexampleEXAMPLE123456"
    body = [{"error": {"code": 400, "status": "INVALID_ARGUMENT",
                       "message": f"API key not valid: {key}"}}]
    session = FakeSession(FakeResponse(400, body))
    provider = OpenAICompatibleProvider(settings(api_key=key), session=session)
    with pytest.raises(ProviderError) as exc:
        provider.complete_json("s", "u")
    text = str(exc.value)
    assert "HTTP 400" in text and "INVALID_ARGUMENT" in text
    assert "API key not valid" in text
    assert key not in text and "[redacted]" in text


def test_an_openai_style_error_body_is_surfaced():
    body = {"error": {"type": "invalid_request_error",
                      "message": "Unknown parameter: response_format"}}
    session = FakeSession(FakeResponse(400, body))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderError) as exc:
        provider.complete_json("s", "u")
    assert "invalid_request_error" in str(exc.value)
    assert "response_format" in str(exc.value)


def test_bearer_tokens_and_google_key_shapes_are_always_scrubbed():
    """Even a key that is not the configured one never passes through."""
    body = {"error": {"message": "Bearer abc.def.ghi rejected; "
                                 "saw AIzaOTHERkeyOTHERkeyOTHER99"}}
    session = FakeSession(FakeResponse(401, body))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderError) as exc:
        provider.complete_json("s", "u")
    text = str(exc.value)
    assert "abc.def.ghi" not in text and "AIzaOTHER" not in text


def test_a_non_json_error_body_falls_back_to_the_status_only():
    session = FakeSession(FakeResponse(400, None))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderError) as exc:
        provider.complete_json("s", "u")
    assert str(exc.value) == "The natural-language service returned HTTP 400."


def test_a_long_error_detail_is_capped():
    from floatchat_core.nl_provider import MAX_ERROR_DETAIL_CHARS

    session = FakeSession(FakeResponse(400, {"error": {"message": "x" * 5000}}))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderError) as exc:
        provider.complete_json("s", "u")
    assert len(str(exc.value)) < MAX_ERROR_DETAIL_CHARS + 80


def test_a_transport_timeout_becomes_a_provider_timeout():
    class ReadTimeout(Exception):
        pass

    session = FakeSession(error=ReadTimeout("too slow"))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderTimeout):
        provider.complete_json("s", "u")


def test_an_unexpected_response_shape_is_an_error():
    session = FakeSession(FakeResponse(200, {"nope": True}))
    provider = OpenAICompatibleProvider(settings(), session=session)
    with pytest.raises(ProviderError):
        provider.complete_json("s", "u")


# --------------------------------------------------------------------------
# Helper units
# --------------------------------------------------------------------------

def test_apply_patch_keeps_unmentioned_context_fields():
    merged, touched, ignored = apply_patch(
        base_context(), {"variables": ["psal"], "bogus": 1})
    assert merged["region"] == base_context()["region"]
    assert merged["variables"] == ["psal"]
    assert touched == ["variables"]
    assert ignored == ["bogus"]


def test_apply_patch_ignores_explicit_nulls():
    merged, touched, _ = apply_patch(base_context(), {"region": None})
    assert merged["region"] == base_context()["region"]
    assert touched == []


def test_normalize_context_returns_none_for_an_invalid_draft():
    assert normalize_context(None) is None
    assert normalize_context({"variables": ["nope"]}) is None
    assert normalize_context(base_context()) is not None


def test_diff_reports_nothing_when_nothing_moved():
    normalized = normalize_context(base_context())
    changes = diff_plans(normalized, normalized, [])
    assert [c for c in changes if c.origin == "changed"] == []


def test_coverage_brief_carries_extents_not_rows():
    brief = coverage_brief(INDEX)
    assert brief["profile_count"] == EXTENT["profile_count"]
    assert brief["time_range_utc"] == [EXTENT["time_min"], EXTENT["time_max"]]
    assert "Never move a requested date" in brief["note"]
    assert "observations" not in brief


# --------------------------------------------------------------------------
# Endpoint behaviour
# --------------------------------------------------------------------------

client = TestClient(api_main.app)

# Drafting is the one route that spends money per call, so the deployed
# application requires an account for it. These tests exercise the route's own
# behaviour, so they sign in once with a throwaway account and present the
# session's CSRF token. The access boundary itself is tested in test_auth.py.
_DRAFT_ACCOUNT = register_test_account(client)


def draft_post(**kwargs):
    """POST /api/plan/draft as the signed-in test account."""
    headers = dict(kwargs.pop("headers", {}))
    headers["X-CSRF-Token"] = _DRAFT_ACCOUNT["csrf"]
    return client.post("/api/plan/draft", headers=headers, **kwargs)


def test_endpoint_reports_unconfigured_state_without_a_provider():
    response = draft_post(json={"question": "temperature at 100 m",
                               "revision": 4})
    body = response.json()
    assert response.status_code == 503
    assert body["outcome"] == DraftOutcome.PROVIDER_UNAVAILABLE.value
    assert body["errors"][0]["code"] == "provider_not_configured"
    assert body["revision"] == 4


def test_nl_status_endpoint_never_returns_a_credential_value():
    """Env var *names* are public documentation; values must never appear."""
    body = client.get("/api/plan/nl_status").json()
    assert body["configured"] is False
    # The names are listed on purpose, so the operator knows what to set.
    assert "FLOATCHAT_NL_API_KEY" in body["env_vars"]
    # No value is carried for any of them.
    assert "api_key" not in body
    assert not any(isinstance(v, str) and v.startswith("sk-")
                   for v in body.values())


def test_a_configured_status_reports_presence_without_the_value():
    described = settings(api_key="sk-live-do-not-leak").describe()
    serialised = json.dumps(described)
    assert "sk-live-do-not-leak" not in serialised
    assert described["credential_configured"] is True


def test_manual_endpoints_are_unaffected_by_the_missing_provider():
    assert client.get("/api/coverage").status_code == 200
    assert client.get("/api/floats").status_code == 200
    assert client.post("/api/plan/validate", json=base_context()).status_code == 200
    assert client.post("/api/plan/execute", json=base_context()).status_code == 200


def test_endpoint_rejects_a_missing_question():
    assert draft_post(json={}).status_code == 400
    assert draft_post(json={"question": "   "}).status_code == 400


def test_endpoint_rejects_an_invalid_reference_date():
    response = draft_post(json={"question": "x",
                               "reference_date": "yesterday"})
    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "invalid_reference_date"


def test_endpoint_rejects_an_oversized_body():
    response = draft_post(content=b"{" + b"x" * 40000,
                          headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_endpoint_rejects_a_malformed_body():
    response = draft_post(content="{bad",
                          headers={"Content-Type": "application/json"})
    assert response.status_code == 400


def test_endpoint_uses_an_injected_provider(monkeypatch):
    """Wire a mock through the real router to prove the seam works."""
    from fastapi import FastAPI
    from api.plan_routes import build_plan_router

    provider = MockProvider({
        "intent": "draft",
        "plan_patch": {"depth": {"mode": "at_depth", "target_m": 100.0}},
    })
    app = FastAPI()
    app.include_router(build_plan_router(
        api_main.dataset_index,
        nl_provider_factory=lambda: provider,
        nl_status=lambda: {"configured": True, "kind": "openai_compatible"},
    ))
    local = TestClient(app)

    assert local.get("/api/plan/nl_status").json()["configured"] is True
    body = local.post("/api/plan/draft", json={
        "question": "show temperature at 100 m",
        "context": base_context(),
        "revision": 2,
    }).json()
    assert body["outcome"] == DraftOutcome.PROPOSED_DRAFT.value
    assert body["proposed_plan"]["depth"]["target_m"] == 100.0
    assert body["revision"] == 2
