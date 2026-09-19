"""HTTP surface for query-plan validation.

Kept separate from api/main.py so the explorer endpoints stay small. This
module owns request parsing and status codes only; the contract lives in
:mod:`floatchat_core.plan` and every decision in
:mod:`floatchat_core.plan_validation`.

Status codes:

``400`` the body is not JSON, or not a JSON object.
``422`` ``outcome: "invalid"`` - schema or semantic violation, a dangling
        float/profile reference, or an inapplicable QC policy.
``200`` every other outcome (``unsupported``, ``valid_no_data``,
        ``valid_partial_coverage``, ``valid``). The request was understood and
        the body carries a complete validation result.

Every response carries ``schema_version``, ``outcome``, ``requested`` and
``dataset``, and is passed through ``json_safe`` before serialization.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from floatchat_core.plan import (
    PLAN_SCHEMA_VERSION,
    Outcome,
    QueryPlanRequest,
    capability_report,
    pydantic_errors_to_issues,
)
from floatchat_core.evidence import build_evidence, dataset_version
from floatchat_core.explain import (
    EXPLAIN_SCHEMA_VERSION,
    ExplainOutcome,
    explain_result,
)
from floatchat_core.nl_planner import DraftOutcome, draft_plan
from floatchat_core.nl_provider import (
    ProviderError,
    ProviderNotConfigured,
    build_provider,
    provider_status,
)
from floatchat_core.plan_execution import execute_plan
from floatchat_core.plan_validation import (
    DatasetIndex,
    status_for_outcome,
    validate_plan,
)
from floatchat_core.woa import json_safe


def _envelope(outcome: str, requested, errors=None, **extra) -> dict:
    payload = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "outcome": outcome,
        "requested": requested,
        "normalized_plan": None,
        "errors": errors or [],
        "warnings": [],
        "matching": None,
        "coverage": None,
        "dataset": None,
    }
    payload.update(extra)
    return json_safe(payload)


#: Bounds on the drafting request body itself, independent of the provider.
MAX_DRAFT_BODY_BYTES = 32 * 1024

#: An explanation request carries a plan and a dataset version, never
#: measurements, so it has no reason to be large.
MAX_EXPLAIN_BODY_BYTES = 32 * 1024


def build_plan_router(
    index_provider: Callable[[], DatasetIndex],
    nl_provider_factory: Callable[[], object] | None = None,
    nl_status: Callable[[], dict] | None = None,
    draft_dependencies: list | None = None,
    explain_dependencies: list | None = None,
    woa_lookup: Callable[[str], dict] | None = None,
) -> APIRouter:
    """Router exposing plan validation over ``index_provider()``.

    The provider is called per request so validation always reflects the
    currently loaded tables rather than a snapshot taken at import time.

    ``draft_dependencies`` and ``explain_dependencies`` are applied to
    ``/api/plan/draft`` and ``/api/plan/explain`` respectively - the two
    routes that can spend money per call. The deployed application passes an
    authentication dependency to each; leaving them empty keeps those routes
    open, which is how the isolated router tests exercise drafting and
    explaining without standing up an account store. Every other route is
    public either way.

    ``woa_lookup`` is injected rather than imported so this module keeps no
    dependency on the climatology endpoints. Without it, evidence simply
    carries no comparison facts and says so, which is what the isolated
    router tests rely on to stay offline.
    """
    router = APIRouter()

    @router.get("/api/plan/capabilities")
    def plan_capabilities():
        """Declared analyses, outputs, enums and codes with support status.

        The frontend reads this to build the plan editor without hardcoding a
        second copy of the registry.
        """
        report = capability_report()
        report["dataset"] = index_provider().describe()
        return JSONResponse(status_code=200, content=json_safe(report))

    async def _parse_plan(request: Request):
        """``(plan, body, error)`` where ``error`` is ``(status, payload)``.

        The payload is a plain dict so each route can shape it - the execute
        route adds ``executed: false`` so a caller can always read that field,
        including when the body never parsed.
        """
        try:
            body = await request.json()
        except Exception:
            return None, None, (400, _envelope(
                Outcome.INVALID.value, None,
                [{"code": "malformed_json", "field": None,
                  "message": "The request body is not valid JSON."}],
            ))

        if not isinstance(body, dict):
            return None, body, (400, _envelope(
                Outcome.INVALID.value, json_safe(body),
                [{"code": "body_not_object", "field": None,
                  "message": "The request body must be a JSON object."}],
            ))

        try:
            plan = QueryPlanRequest.model_validate(body)
        except ValidationError as exc:
            issues = [issue.model_dump() for issue in
                      pydantic_errors_to_issues(exc)]
            return None, body, (422, _envelope(
                Outcome.INVALID.value, json_safe(body), issues,
                dataset=json_safe(index_provider().describe()),
            ))

        return plan, body, None

    @router.post("/api/plan/validate")
    async def plan_validate(request: Request):
        """Validate a query plan. Never executes it and never calls a model."""
        plan, body, error = await _parse_plan(request)
        if error is not None:
            status, payload = error
            return JSONResponse(status_code=status, content=payload)

        result = validate_plan(plan, index_provider())
        result["requested"] = json_safe(body)
        return JSONResponse(status_code=status_for_outcome(result["outcome"]),
                            content=result)

    @router.get("/api/plan/nl_status")
    def nl_configuration_status():
        """Whether natural-language drafting is available. Never returns a key."""
        status = (nl_status or provider_status)()
        return JSONResponse(status_code=200, content=json_safe(status))

    @router.post("/api/plan/draft", dependencies=draft_dependencies or [])
    async def plan_draft(request: Request):
        """Propose an editable draft from a question. Never executes anything.

        The proposal is returned for the user to inspect and edit; running it
        is a separate, explicit action against /api/plan/execute.
        """
        body = await request.body()
        if len(body) > MAX_DRAFT_BODY_BYTES:
            return JSONResponse(status_code=413, content=json_safe({
                "schema_version": PLAN_SCHEMA_VERSION,
                "outcome": DraftOutcome.PROVIDER_UNAVAILABLE.value,
                "errors": [{"code": "request_too_large", "field": None,
                            "message": f"The request body exceeds "
                                       f"{MAX_DRAFT_BODY_BYTES} bytes."}],
                "provider_message": "Request too large.",
            }))

        try:
            payload = json.loads(body) if body else None
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            return JSONResponse(status_code=400, content=json_safe({
                "schema_version": PLAN_SCHEMA_VERSION,
                "outcome": DraftOutcome.PROVIDER_UNAVAILABLE.value,
                "errors": [{"code": "malformed_json", "field": None,
                            "message": "The request body must be a JSON object."}],
                "provider_message": "Malformed request body.",
            }))

        question = payload.get("question")
        if not isinstance(question, str) or not question.strip():
            return JSONResponse(status_code=400, content=json_safe({
                "schema_version": PLAN_SCHEMA_VERSION,
                "outcome": DraftOutcome.PROVIDER_UNAVAILABLE.value,
                "errors": [{"code": "missing_question", "field": "question",
                            "message": "A non-empty question is required."}],
                "provider_message": "No question supplied.",
            }))

        reference_date = None
        raw_reference = payload.get("reference_date")
        if isinstance(raw_reference, str) and raw_reference.strip():
            try:
                reference_date = datetime.fromisoformat(
                    raw_reference.replace("Z", "+00:00"))
            except ValueError:
                return JSONResponse(status_code=400, content=json_safe({
                    "schema_version": PLAN_SCHEMA_VERSION,
                    "outcome": DraftOutcome.PROVIDER_UNAVAILABLE.value,
                    "errors": [{"code": "invalid_reference_date",
                                "field": "reference_date",
                                "message": "reference_date must be ISO-8601."}],
                    "provider_message": "Invalid reference date.",
                }))

        try:
            provider = (nl_provider_factory or build_provider)()
        except (ProviderNotConfigured, ProviderError):
            provider = None

        context = payload.get("context")
        revision = payload.get("revision")
        result = draft_plan(
            question=question.strip(),
            context=context if isinstance(context, dict) else None,
            index=index_provider(),
            provider=provider,
            reference_date=reference_date,
            revision=revision if isinstance(revision, int) else None,
        )
        status = (503 if result["outcome"] ==
                  DraftOutcome.PROVIDER_UNAVAILABLE.value else 200)
        return JSONResponse(status_code=status, content=result)

    @router.post("/api/plan/explain", dependencies=explain_dependencies or [])
    async def plan_explain(request: Request):
        """Explain an executed result from facts this server recomputes.

        The caller sends the plan it ran and the dataset version it ran
        against - never measurements. The plan is revalidated and re-executed
        here, and every number in the answer comes from that recomputation, so
        a client cannot assert a value into an explanation.

        The explanation is bound to the dataset version and the plan
        fingerprint it was built from. A caller whose dataset no longer matches
        this server's gets ``409 dataset_mismatch`` rather than an answer about
        different data.

        A provider failure returns ``200`` carrying a deterministic data
        summary, labelled ``source: "data_summary"`` with the reason in
        ``provider_message``. It is a usable answer, so 503 would misdescribe
        it - but it is never marked ``explained``, so it cannot be presented
        as a successful model reply.
        """
        body = await request.body()
        if len(body) > MAX_EXPLAIN_BODY_BYTES:
            return JSONResponse(status_code=413, content=json_safe({
                "schema_version": EXPLAIN_SCHEMA_VERSION,
                "outcome": ExplainOutcome.PROVIDER_UNAVAILABLE.value,
                "errors": [{"code": "request_too_large", "field": None,
                            "message": f"The request body exceeds "
                                       f"{MAX_EXPLAIN_BODY_BYTES} bytes."}],
                "provider_message": "Request too large.",
            }))

        try:
            payload = json.loads(body) if body else None
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            return JSONResponse(status_code=400, content=json_safe({
                "schema_version": EXPLAIN_SCHEMA_VERSION,
                "outcome": ExplainOutcome.PROVIDER_UNAVAILABLE.value,
                "errors": [{"code": "malformed_json", "field": None,
                            "message": "The request body must be a JSON object."}],
                "provider_message": "Malformed request body.",
            }))

        raw_plan = payload.get("plan")
        if not isinstance(raw_plan, dict):
            return JSONResponse(status_code=400, content=json_safe({
                "schema_version": EXPLAIN_SCHEMA_VERSION,
                "outcome": ExplainOutcome.PROVIDER_UNAVAILABLE.value,
                "errors": [{"code": "missing_plan", "field": "plan",
                            "message": "The executed plan is required."}],
                "provider_message": "No plan supplied.",
            }))

        try:
            plan = QueryPlanRequest.model_validate(raw_plan)
        except ValidationError as exc:
            issues = [issue.model_dump() for issue in
                      pydantic_errors_to_issues(exc)]
            return JSONResponse(status_code=422, content=json_safe({
                "schema_version": EXPLAIN_SCHEMA_VERSION,
                "outcome": ExplainOutcome.PROVIDER_UNAVAILABLE.value,
                "errors": issues,
                "provider_message": "The plan did not parse, so nothing was "
                                    "explained.",
            }))

        index = index_provider()
        current_version = dataset_version(index)
        claimed = payload.get("dataset_version")
        if isinstance(claimed, str) and claimed and claimed != current_version:
            # Explaining this would describe data the caller never saw.
            return JSONResponse(status_code=409, content=json_safe({
                "schema_version": EXPLAIN_SCHEMA_VERSION,
                "outcome": ExplainOutcome.DATASET_MISMATCH.value,
                "dataset_version": current_version,
                "requested_dataset_version": claimed,
                "errors": [{"code": "dataset_mismatch", "field": "dataset_version",
                            "message": "These results came from a different "
                                       "version of the data. Run the query "
                                       "again before asking for an explanation."}],
                "provider_message": "The data changed since these results were "
                                    "produced.",
            }))

        evidence = build_evidence(plan, index, woa_lookup=woa_lookup)

        try:
            provider = (nl_provider_factory or build_provider)()
        except (ProviderNotConfigured, ProviderError):
            provider = None

        mode = payload.get("view_mode", "student") if isinstance(payload.get("view_mode"), str) else "student"
        result = explain_result(evidence, provider, mode=mode)
        # The evidence travels with the answer so "View evidence" needs no
        # second request, and so every referenced fact can be checked.
        result["evidence"] = evidence
        return JSONResponse(status_code=200, content=json_safe(result))

    @router.post("/api/plan/execute")
    async def plan_execute(request: Request):
        """Revalidate a plan and apply it to the loaded observations.

        The plan is validated again server-side; a client cannot execute one by
        claiming it was already approved. ``invalid`` plans are 422 and
        ``unsupported`` plans are refused with ``executed: false``. Selection
        reuses the same helper the validator counts with, so the records
        returned match the preview.
        """
        plan, body, error = await _parse_plan(request)
        if error is not None:
            status, payload = error
            payload = {**payload, "executed": False, "executed_at": None,
                       "results": None, "plan": None,
                       "refusal": {"code": "not_executable",
                                   "message": "The plan did not parse, so it "
                                              "was not executed."}}
            return JSONResponse(status_code=status, content=json_safe(payload))

        result = execute_plan(plan, index_provider())
        result["requested"] = json_safe(body)
        status = 422 if result["outcome"] == Outcome.INVALID.value else 200
        return JSONResponse(status_code=status, content=result)

    return router
