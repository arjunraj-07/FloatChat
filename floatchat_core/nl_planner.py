"""Turn a question into a *proposed* query draft. Nothing is executed here.

The model's only job is to map a question onto the existing
:class:`~floatchat_core.plan.QueryPlanRequest` vocabulary. It receives the
schema, the capability registry and a short coverage summary — never
observation arrays, NetCDF bytes, credentials or row-level data — and returns a
small JSON *patch*, not a finished plan.

Everything that matters is then decided in deterministic code:

* The patch is applied onto the caller's existing draft, so manual settings
  survive unless the question changed them.
* Capability support is judged by the registry, not by the model's opinion.
* The difference between the prior draft and the proposal is computed here, so
  the change list cannot be a model's inaccurate self-description.
* The result is validated by the ordinary validator, so coverage is reported
  honestly and a requested date or region is never rewritten to wherever the
  cached observations happen to be.

The planner never narrates results, invents observations, anomaly magnitudes,
heatwave events, thermocline depths or confidence values.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import ValidationError

from .plan import (
    ANALYSIS_CAPABILITIES,
    NAMED_REGION_BOUNDS,
    OUTPUT_CAPABILITIES,
    PLAN_SCHEMA_VERSION,
    Analysis,
    DataMode,
    DepthMode,
    NamedRegion,
    Output,
    QueryPlanRequest,
    Variable,
    normalize_plan,
    pydantic_errors_to_issues,
)
from .nl_provider import (
    JsonCompletionProvider,
    ProviderError,
    ProviderNotConfigured,
    ProviderTimeout,
)
from .woa import json_safe


class DraftOutcome(str, Enum):
    """Distinct answers a drafting attempt can produce."""

    #: A complete, schema-valid plan is proposed for the user to edit and run.
    PROPOSED_DRAFT = "proposed_draft"
    #: The question is under-specified; a question is returned instead.
    CLARIFICATION_NEEDED = "clarification_needed"
    #: The question asks for something this build does not implement.
    UNSUPPORTED_REQUEST = "unsupported_request"
    #: No provider configured, a timeout, or an unusable response.
    PROVIDER_UNAVAILABLE = "provider_unavailable"


#: Fields the model may set. Anything else it returns is ignored and reported.
PATCH_FIELDS = ("time", "region", "depth", "variables", "analyses",
                "outputs", "selection")

#: Plan sections the schema defines but a question may not change.
POLICY_FIELDS = ("qc_policy",)

MAX_ASSUMPTIONS = 8
MAX_CLARIFICATION_CHARS = 400


@dataclass(frozen=True)
class FieldChange:
    """One deterministic difference between the prior draft and the proposal."""

    field: str
    previous: Any
    proposed: Any
    #: ``changed`` the question moved it; ``retained`` it came from the draft
    #: the user already had; ``default`` no prior value existed.
    origin: str

    def as_dict(self) -> dict:
        return {"field": self.field, "previous": self.previous,
                "proposed": self.proposed, "origin": self.origin}


def coverage_brief(index) -> dict:
    """The minimum the model needs to reason about availability.

    Counts and extents only. No observation arrays, no per-profile rows beyond
    the identifiers a user could legitimately name.
    """
    described = index.describe()
    return {
        "note": (
            "This is the cached subset this deployment holds. It is NOT a "
            "constraint on what the user may ask for. Never move a requested "
            "date or region to fit it; propose what was asked and let "
            "validation report availability."
        ),
        "time_range_utc": [described["time_min"], described["time_max"]],
        "latitude_range": [described["latitude_min"], described["latitude_max"]],
        "longitude_range": [described["longitude_min"], described["longitude_max"]],
        "depth_range_m": [described["depth_min_m"], described["depth_max_m"]],
        "profile_count": described["profile_count"],
        "float_count": described["float_count"],
        "data_modes_present": described["data_modes_present"],
        "known_float_ids": sorted(index.platforms),
    }


def _capability_brief() -> dict:
    return {
        "implemented_analyses": [a.value for a in Analysis
                                 if ANALYSIS_CAPABILITIES[a].implemented],
        "unimplemented_analyses": {
            a.value: ANALYSIS_CAPABILITIES[a].unavailable_reason
            for a in Analysis if not ANALYSIS_CAPABILITIES[a].implemented
        },
        "implemented_outputs": [o.value for o in Output
                                if OUTPUT_CAPABILITIES[o].implemented],
        "unimplemented_outputs": {
            o.value: OUTPUT_CAPABILITIES[o].unavailable_reason
            for o in Output if not OUTPUT_CAPABILITIES[o].implemented
        },
    }


PATCH_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["intent"],
    "properties": {
        "intent": {"type": "string",
                   "enum": ["draft", "clarify", "unsupported"]},
        "clarification_question": {"type": ["string", "null"]},
        "unsupported_requests": {
            "type": "array",
            "items": {"type": "string"},
        },
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "plan_patch": {"type": "object"},
    },
}


def build_system_prompt(index) -> str:
    """Instructions and vocabulary. Deterministic, so it caches well."""
    return json.dumps({
        "role": (
            "You map an ocean-data question onto a fixed query schema. You are "
            "a query planner, not an analyst."
        ),
        "hard_rules": [
            "Return ONLY a JSON object matching the response contract.",
            "Never state or estimate any measured value, anomaly, temperature, "
            "heatwave, thermocline depth, confidence or conclusion. You do not "
            "have the data and no numbers you produce would be real.",
            "Never invent float or profile identifiers. Use only ids listed in "
            "known_float_ids, and only if the user names one.",
            "Only set a field the question actually determines. Omit every "
            "other field so the user's existing settings are kept.",
            "A question that names a variable determines variables, and one "
            "that names a depth determines depth. Set every field the question "
            "names: 'temperature at 100 m' sets both variables and depth.",
            "The QC and data-mode policy cannot be changed through a question. "
            "If the user asks to include other QC flags or data modes, use "
            "intent 'unsupported' and name that request in "
            "unsupported_requests.",
            "Never move a requested date or region to where cached data "
            "happens to exist. Propose what was asked.",
            "If the question is ambiguous about time, region or comparison, "
            "use intent 'clarify' rather than guessing a complete plan.",
            "If the question needs an analysis listed as unimplemented, use "
            "intent 'unsupported' and name it. Never substitute a different "
            "analysis for an unsupported one.",
            "Resolve relative dates against reference_date_utc, which is "
            "supplied with every request.",
        ],
        "response_contract": {
            "intent": "draft | clarify | unsupported",
            "clarification_question": "string, required when intent=clarify",
            "unsupported_requests": "array of strings naming what is unsupported",
            "assumptions": "array of short strings; state any choice you made",
            "plan_patch": {
                "time": {"start": "YYYY-MM-DD, or ISO-8601 with an explicit "
                                  "offset such as Z",
                         "end": "YYYY-MM-DD, or ISO-8601 with an explicit "
                                "offset such as Z"},
                "region": "either {kind:'named',name:...} or "
                          "{kind:'bbox',west,east,south,north}",
                "depth": "either {mode:'range',min_m,max_m} or "
                         "{mode:'at_depth',target_m}",
                "variables": "subset of ['temp','psal']",
                "analyses": "subset of the analysis vocabulary",
                "outputs": "subset of the output vocabulary",
                "selection": {"platforms": "[]", "profile_ids": "[]"},
            },
        },
        "vocabulary": {
            "variables": {v.value: v.value for v in Variable},
            "data_modes": [m.value for m in DataMode],
            "depth_modes": [m.value for m in DepthMode],
            "named_regions": {r.value: NAMED_REGION_BOUNDS[r]
                              for r in NamedRegion},
            "analyses": [a.value for a in Analysis],
            "outputs": [o.value for o in Output],
        },
        "capabilities": _capability_brief(),
        "conventions": {
            "coordinates": "decimal degrees; west<east, south<north; an "
                           "antimeridian-crossing box is not supported",
            "depth": "metres, positive down",
            "time": "UTC. Give a date only (YYYY-MM-DD) or a timestamp with "
                    "an explicit offset such as 2019-06-30T23:59:59Z; a "
                    "timestamp without an offset is rejected. Ranges "
                    "inclusive; a date-only end means the end of that day",
            "variables": "temp is in-situ temperature (Argo TEMP); psal is "
                         "practical salinity (Argo PSAL)",
        },
        "coverage": coverage_brief(index),
    }, sort_keys=True, indent=None)


def build_user_prompt(question: str, context: Optional[dict],
                      reference_date: str) -> str:
    return json.dumps({
        "question": question,
        "reference_date_utc": reference_date,
        "current_draft": context or None,
        "reminder": (
            "Omit any plan_patch field the question does not determine; the "
            "current_draft value will be kept for it."
        ),
    }, sort_keys=True, default=str)


def _clean_strings(values: Any, limit: int) -> list:
    if not isinstance(values, list):
        return []
    out = []
    for value in values[:limit]:
        if isinstance(value, str) and value.strip():
            out.append(value.strip()[:300])
    return out


def apply_patch(context: Optional[dict], patch: dict) -> tuple[dict, list, list]:
    """Merge a patch onto the caller's draft.

    Returns ``(plan_dict, touched_fields, ignored_fields)``. A field the model
    omitted keeps whatever the caller already had, which is what stops a
    question about depth from quietly resetting the region.
    """
    base: dict = {"schema_version": PLAN_SCHEMA_VERSION}
    if isinstance(context, dict):
        for key, value in context.items():
            if key in PATCH_FIELDS or key == "qc_policy":
                base[key] = value

    touched, ignored = [], []
    if isinstance(patch, dict):
        for key, value in patch.items():
            if key not in PATCH_FIELDS:
                ignored.append(key)
                continue
            if value is None:
                continue
            base[key] = value
            touched.append(key)
    return base, sorted(touched), sorted(ignored)


def normalize_context(context: Optional[dict]) -> Optional[dict]:
    """Canonical form of the caller's existing draft, if it is a valid plan.

    Returns ``None`` when there was no prior draft or it does not validate, in
    which case every proposed field is reported as a default rather than as a
    change from something.
    """
    if not isinstance(context, dict):
        return None
    candidate = dict(context)
    candidate.setdefault("schema_version", PLAN_SCHEMA_VERSION)
    try:
        return normalize_plan(QueryPlanRequest.model_validate(candidate))
    except ValidationError:
        return None


def diff_plans(previous: Optional[dict], proposed: dict,
               touched: list) -> list[FieldChange]:
    """Field-by-field difference, computed here rather than described by a model.

    ``previous`` and ``proposed`` are normalized plans, so the comparison is
    between canonical forms and not between raw request spellings.
    """
    changes: list[FieldChange] = []
    fields = ("time", "region", "depth", "variables", "qc_policy", "selection",
              "analyses", "outputs")
    for field in fields:
        new_value = proposed.get(field)
        old_value = (previous or {}).get(field)
        if previous is None:
            origin = "default"
        elif old_value == new_value:
            origin = "retained"
        else:
            origin = "changed"
        if origin == "changed" or (origin == "default" and new_value is not None):
            changes.append(FieldChange(field, old_value, new_value, origin))
        elif origin == "retained" and field in touched:
            # The model restated a value identical to what was already there.
            changes.append(FieldChange(field, old_value, new_value, "retained"))
    return changes


def retained_fields(previous: Optional[dict], proposed: dict) -> list:
    """Fields carried over unchanged from the caller's draft."""
    if not previous:
        return []
    return sorted(
        field for field in ("time", "region", "depth", "variables",
                            "qc_policy", "selection", "analyses", "outputs")
        if previous.get(field) == proposed.get(field)
    )


def _unsupported_from_registry(plan: QueryPlanRequest) -> list:
    """Capability judgement, made from the registry rather than the model."""
    problems = []
    for analysis in plan.analyses:
        capability = ANALYSIS_CAPABILITIES[analysis]
        if not capability.implemented:
            problems.append({
                "requested": analysis.value,
                "kind": "analysis",
                "reason": capability.unavailable_reason,
            })
    for output in plan.outputs:
        capability = OUTPUT_CAPABILITIES[output]
        if not capability.implemented:
            problems.append({
                "requested": output.value,
                "kind": "output",
                "reason": capability.unavailable_reason,
            })
    return problems


def _policy_change_requests(fields: list, stored_flags: set) -> list:
    """A policy change the model attempted, reported rather than applied."""
    return [{
        "requested": f"change {field}",
        "kind": "policy",
        "reason": (
            "The QC and data-mode policy cannot be changed through a question; "
            "it stays as set in the query controls. The processed tables also "
            f"retain only levels with QC flags {sorted(stored_flags)}, so other "
            "flags (for example QC=4) could not be served even if set manually: "
            "excluded levels were dropped at ingestion and cannot be "
            "reconstructed from the stored data."
        ),
    } for field in fields]


def _declared_unsupported(declared: Any, already: list) -> list:
    """Unsupported requests the model named that the registry did not.

    A declaration naming an *implemented* analysis or output is overruled: the
    registry, not the model, decides support. Anything else - a request the
    schema cannot express at all - is surfaced, so it is never silently
    dropped from the reply.
    """
    implemented = {a.value for a in Analysis
                   if ANALYSIS_CAPABILITIES[a].implemented}
    implemented |= {o.value for o in Output
                    if OUTPUT_CAPABILITIES[o].implemented}
    seen = {item["requested"] for item in already}
    surfaced = []
    for text in _clean_strings(declared, 5):
        key = text.strip().lower().replace(" ", "_")
        if key in implemented or text in seen or key in seen:
            continue
        seen.add(text)
        surfaced.append({
            "requested": text,
            "kind": "request",
            "reason": ("The planner reported that this part of the question "
                       "cannot be expressed as a supported query."),
        })
    return surfaced


def _timestamps_without_timezone(patch: dict) -> list:
    """Model-proposed times that name no time zone.

    A naive timestamp is ambiguous: the backend would read it as UTC and a
    browser as local time, so it is reported rather than resolved either way.
    A date alone is not ambiguous, because dates are UTC days by convention.
    Values that do not parse are left to the schema, which reports them.
    """
    time_patch = patch.get("time")
    if not isinstance(time_patch, dict):
        return []
    issues = []
    for edge in ("start", "end"):
        value = time_patch.get(edge)
        if not isinstance(value, str):
            continue
        text = value.strip()
        if "T" not in text.upper() and ":" not in text:
            continue
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            issues.append({
                "code": "timestamp_timezone_missing",
                "field": f"time.{edge}",
                "message": (
                    f"The proposed {edge} time {text[:40]!r} has no time zone, "
                    "so it could mean different instants. It was not applied. "
                    "Ask again, or set the dates in the filters (dates are UTC "
                    "days)."),
            })
    return issues


def _envelope(outcome: DraftOutcome, **extra) -> dict:
    payload = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "outcome": outcome.value,
        "proposed_plan": None,
        "normalized_plan": None,
        "changes": [],
        "retained_fields": [],
        "assumptions": [],
        "clarification_question": None,
        "unsupported": [],
        "errors": [],
        "provider_message": None,
        "reference_date_utc": None,
        "revision": None,
        "question": None,
    }
    payload.update(extra)
    return json_safe(payload)


def draft_plan(question: str, context: Optional[dict], index,
               provider: Optional[JsonCompletionProvider],
               reference_date: Optional[datetime] = None,
               revision: Optional[int] = None) -> dict:
    """Propose an editable draft for ``question``. Never executes anything."""
    reference = (reference_date or datetime.now(timezone.utc))
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    reference_iso = reference.astimezone(timezone.utc).isoformat()

    common = {"reference_date_utc": reference_iso, "revision": revision,
              "question": question}

    if provider is None:
        return _envelope(
            DraftOutcome.PROVIDER_UNAVAILABLE,
            provider_message=(
                "Natural-language service not configured. Manual query "
                "building is unaffected."
            ),
            errors=[{"code": "provider_not_configured",
                     "field": None,
                     "message": "No natural-language provider is configured."}],
            **common,
        )

    limit = provider.settings.max_question_chars
    if len(question) > limit:
        return _envelope(
            DraftOutcome.PROVIDER_UNAVAILABLE,
            provider_message=(
                f"The question is {len(question)} characters; the configured "
                f"limit is {limit}."
            ),
            errors=[{"code": "question_too_long", "field": "question",
                     "message": f"Maximum question length is {limit} characters."}],
            **common,
        )

    try:
        raw = provider.complete_json(
            build_system_prompt(index),
            build_user_prompt(question, context, reference_iso),
            PATCH_JSON_SCHEMA,
        )
    except ProviderNotConfigured as exc:
        return _envelope(DraftOutcome.PROVIDER_UNAVAILABLE,
                         provider_message=str(exc),
                         errors=[{"code": "provider_not_configured",
                                  "field": None, "message": str(exc)}],
                         **common)
    except ProviderTimeout as exc:
        return _envelope(DraftOutcome.PROVIDER_UNAVAILABLE,
                         provider_message=str(exc),
                         errors=[{"code": "provider_timeout", "field": None,
                                  "message": str(exc)}],
                         **common)
    except ProviderError as exc:
        return _envelope(DraftOutcome.PROVIDER_UNAVAILABLE,
                         provider_message=str(exc),
                         errors=[{"code": "provider_error", "field": None,
                                  "message": str(exc)}],
                         **common)

    intent = raw.get("intent")
    assumptions = _clean_strings(raw.get("assumptions"), MAX_ASSUMPTIONS)

    if intent == "clarify":
        question_text = raw.get("clarification_question")
        if not isinstance(question_text, str) or not question_text.strip():
            return _envelope(
                DraftOutcome.PROVIDER_UNAVAILABLE,
                provider_message="The service asked for clarification without "
                                 "saying what was unclear.",
                errors=[{"code": "malformed_response",
                         "field": "clarification_question",
                         "message": "intent 'clarify' requires a question."}],
                **common)
        return _envelope(
            DraftOutcome.CLARIFICATION_NEEDED,
            clarification_question=question_text.strip()[:MAX_CLARIFICATION_CHARS],
            assumptions=assumptions,
            unsupported=[{"requested": item, "kind": "unknown", "reason": None}
                         for item in _clean_strings(
                             raw.get("unsupported_requests"), 5)],
            **common)

    if intent not in ("draft", "unsupported"):
        return _envelope(
            DraftOutcome.PROVIDER_UNAVAILABLE,
            provider_message="The service returned an unrecognised intent.",
            errors=[{"code": "malformed_response", "field": "intent",
                     "message": f"Unrecognised intent {intent!r}."}],
            **common)

    patch = raw.get("plan_patch")
    if not isinstance(patch, dict):
        patch = {}

    time_issues = _timestamps_without_timezone(patch)
    if time_issues:
        # Never guess which zone was meant. Nothing is applied, and the
        # caller's draft stays as it was.
        return _envelope(
            DraftOutcome.PROVIDER_UNAVAILABLE,
            provider_message=(
                "The service proposed a time without a time zone, so the "
                "draft was not applied. Ask again, or set the dates in the "
                "filters."),
            errors=time_issues,
            assumptions=assumptions,
            **common)

    merged, touched, ignored = apply_patch(context, patch)

    try:
        plan = QueryPlanRequest.model_validate(merged)
    except ValidationError as exc:
        issues = [issue.model_dump() for issue in pydantic_errors_to_issues(exc)]
        declared = _clean_strings(raw.get("unsupported_requests"), 5)
        # A proposal that does not fit the schema is reported as such; it is
        # never coerced into something runnable.
        return _envelope(
            DraftOutcome.UNSUPPORTED_REQUEST if intent == "unsupported"
            else DraftOutcome.PROVIDER_UNAVAILABLE,
            provider_message=(
                "The service proposed a draft that does not fit the query "
                "schema."),
            errors=issues,
            assumptions=assumptions,
            unsupported=[{"requested": item, "kind": "unknown", "reason": None}
                         for item in declared],
            **common)

    normalized = normalize_plan(plan)
    unsupported = _unsupported_from_registry(plan)
    # Compare canonical form against canonical form, so a difference in how a
    # value was spelled in the request is not reported as a change.
    previous_normalized = normalize_context(context)
    changes = diff_plans(previous_normalized, normalized, touched)

    # A policy field the model tried to set is not an unknown field: the
    # schema defines it, but a question may not change it. It is reported as
    # an unsupported request rather than folded into the ignored-field note.
    policy_fields = [field for field in ignored if field in POLICY_FIELDS]
    ignored = [field for field in ignored if field not in POLICY_FIELDS]
    unsupported.extend(_policy_change_requests(policy_fields,
                                               index.all_stored_qc_flags))
    unsupported.extend(_declared_unsupported(raw.get("unsupported_requests"),
                                             unsupported))

    if ignored:
        assumptions.append(
            "Ignored field(s) the schema does not define: " + ", ".join(ignored)
        )

    outcome = (DraftOutcome.UNSUPPORTED_REQUEST if unsupported
               else DraftOutcome.PROPOSED_DRAFT)

    # When the reply's only content is something unsupported there is nothing
    # to apply; offering the unchanged draft would imply the request had been
    # handled.
    has_changes = any(change.origin != "retained" for change in changes)
    offer_plan = outcome is DraftOutcome.PROPOSED_DRAFT or has_changes

    proposed = plan.model_dump(mode="json", exclude_none=True)
    # Every proposed time carries an explicit UTC offset, so no client has to
    # guess which zone a value meant.
    proposed["time"] = {"start": normalized["time"]["start"],
                        "end": normalized["time"]["end"]}

    return _envelope(
        outcome,
        proposed_plan=proposed if offer_plan else None,
        normalized_plan=normalized if offer_plan else None,
        changes=[change.as_dict() for change in changes],
        retained_fields=retained_fields(previous_normalized, normalized),
        assumptions=assumptions,
        unsupported=unsupported,
        **common)
