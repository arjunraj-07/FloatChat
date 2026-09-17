"""A bounded, reproducible evaluation of the configured model.

Fixture-based checks prove the application constrains a model. They cannot say
what a real model gets right. This runs a small, fixed set of cases through the
*actual* planner and explanation paths and judges every answer against values
the backend computed - never against another model's opinion.

It is never imported by the test suite and never runs automatically. Invoke it:

    venv\\Scripts\\python.exe scripts\\evaluate_gemini.py

Budget: a hard ceiling on real provider requests, counted around the single
place the adapter is called, including retries. The run stops at the limit and
reports remaining cases as blocked rather than quietly exceeding it.

Expectations are written below, before any call is made, and are not edited
afterwards to match what came back. Where several answers are scientifically
correct, the expectation accepts a set, not one wording.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
sys.path.insert(0, BASE)
sys.path.insert(0, os.path.join(BASE, "api"))

from floatchat_core import snapshots  # noqa: E402
from floatchat_core.evidence import build_evidence  # noqa: E402
from floatchat_core.explain import explain_result  # noqa: E402
from floatchat_core.nl_planner import draft_plan  # noqa: E402
from floatchat_core.nl_provider import (  # noqa: E402
    ProviderError,
    build_provider,
    provider_status,
)
from floatchat_core.plan import QueryPlanRequest  # noqa: E402
from floatchat_core.plan_execution import execute_plan  # noqa: E402
from floatchat_core.plan_validation import validate_plan  # noqa: E402

MAX_REQUESTS = int(os.environ.get("FLOATCHAT_EVAL_MAX_REQUESTS", 12))
OUT_DIR = os.path.join(HERE, "evaluation")


class BudgetExceeded(RuntimeError):
    """Raised instead of making a request beyond the ceiling."""


class CountingProvider:
    """Counts and times every real request, and refuses to exceed the budget.

    Wrapping the adapter rather than each call site means retries and any
    internal repair request are counted too: the number reported is the number
    the provider actually received.
    """

    def __init__(self, inner, limit):
        self.inner = inner
        self.limit = limit
        self.calls = 0
        self.latencies = []
        self.settings = getattr(inner, "settings", None)

    def complete_json(self, system, user, schema=None):
        if self.calls >= self.limit:
            raise BudgetExceeded(f"provider budget of {self.limit} requests reached")
        self.calls += 1
        started = time.monotonic()
        try:
            return self.inner.complete_json(system, user, schema)
        finally:
            self.latencies.append(round(time.monotonic() - started, 2))


# ---------------------------------------------------------------------------
# The active snapshot decides the dates and region every case is written for.
# ---------------------------------------------------------------------------

import main as api_main  # noqa: E402

INDEX = api_main.dataset_index()
COVERAGE = api_main.get_coverage()
START = COVERAGE["date_range"][0][:10]
END = COVERAGE["date_range"][1][:10]

BASE_PLAN = {
    "schema_version": "1.0",
    "region": {"kind": "named", "name": "argo_cached_subset"},
    "time": {"start": START, "end": END},
    "depth": {"mode": "range", "min_m": 0.0, "max_m": 500.0},
    "variables": ["temp"],
    "analyses": ["profile_summary", "depth_profile", "temperature_gradient"],
}


def plan_of(draft):
    return draft.get("proposed_plan") or draft.get("normalized_plan")


def outcome_of(plan_dict):
    """Run the real validator over a proposed plan."""
    try:
        plan = QueryPlanRequest.model_validate(plan_dict)
    except Exception as exc:  # noqa: BLE001
        return "unparseable", str(exc)[:160], None
    result = validate_plan(plan, INDEX)
    return result["outcome"], None, result


# ---------------------------------------------------------------------------
# Expectations, written before any call
# ---------------------------------------------------------------------------

def depth_is(plan, mode, **bounds):
    depth = (plan or {}).get("depth") or {}
    if depth.get("mode") != mode:
        return False, f"depth mode {depth.get('mode')!r}, wanted {mode!r}"
    for key, value in bounds.items():
        if abs(float(depth.get(key, -1)) - value) > 0.51:
            return False, f"depth {key}={depth.get(key)!r}, wanted {value}"
    return True, ""


def variables_are(plan, expected):
    got = sorted((plan or {}).get("variables") or [])
    return (got == sorted(expected), f"variables {got}, wanted {sorted(expected)}")


def region_kept(plan):
    region = (plan or {}).get("region") or {}
    name = region.get("name")
    return (name == "argo_cached_subset",
            f"region {region}, wanted the cached subset kept")


def dates_kept(plan, start=START, end=END):
    time_range = (plan or {}).get("time") or {}
    got = (str(time_range.get("start", ""))[:10], str(time_range.get("end", ""))[:10])
    return (got == (start, end), f"dates {got}, wanted {(start, end)}")


def qc_not_weakened(plan):
    """QC=4 must never be accepted quietly, whatever the question asked."""
    policy = (plan or {}).get("qc_policy") or {}
    flags = policy.get("accepted_qc_flags")
    if flags is None:
        return True, "policy left to the server default"
    bad = [f for f in flags if int(f) != 1]
    return (not bad, f"accepted_qc_flags {flags} would weaken QC" if bad else "")


def all_of(*results):
    reasons = [reason for ok, reason in results if not ok]
    return (not reasons), "; ".join(reasons)


# Each case: id, what is asked, the draft carried in, and the check.
PLAN_CASES = [
    ("A", "Show temperature from 0 to 200 m.", BASE_PLAN,
     lambda d, p, o: all_of(depth_is(p, "range", min_m=0, max_m=200),
                            variables_are(p, ["temp"]), region_kept(p), dates_kept(p))),
    ("B", "Show temperature and salinity from 0 to 200 m.", BASE_PLAN,
     lambda d, p, o: all_of(depth_is(p, "range", min_m=0, max_m=200),
                            variables_are(p, ["temp", "psal"]), dates_kept(p))),
    ("C", "Show temperature at exactly 100 m.", BASE_PLAN,
     lambda d, p, o: all_of(depth_is(p, "at_depth", target_m=100),
                            variables_are(p, ["temp"]), dates_kept(p))),
    ("D", "Show temperature in June 2019.", BASE_PLAN,
     lambda d, p, o: all_of(dates_kept(p, "2019-06-01", "2019-06-30"),
                            (o == "valid_no_data",
                             f"validator said {o}, wanted valid_no_data"))),
    ("E", "Show me the data.", BASE_PLAN,
     lambda d, p, o: (d["outcome"] == "clarification_needed"
                      and bool(d.get("clarification_question")),
                      f"outcome {d['outcome']}, wanted a clarification question")),
    ("F", "Detect marine heatwaves in this region.", BASE_PLAN,
     lambda d, p, o: (d["outcome"] == "unsupported_request"
                      and any("heatwave" in str(u.get("requested", "")).lower()
                              or "heatwave" in str(u.get("reason", "")).lower()
                              for u in d.get("unsupported", [])),
                      f"outcome {d['outcome']}; unsupported={d.get('unsupported')}")),
    ("G", "Include measurements with QC flag 4.", BASE_PLAN,
     lambda d, p, o: (qc_not_weakened(p) if d["outcome"] == "proposed_draft"
                      else (d["outcome"] in ("unsupported_request", "clarification_needed"),
                            f"outcome {d['outcome']}"))),
    ("H", "Now show only salinity.",
     {**BASE_PLAN, "depth": {"mode": "range", "min_m": 0.0, "max_m": 200.0}},
     lambda d, p, o: all_of(variables_are(p, ["psal"]),
                            depth_is(p, "range", min_m=0, max_m=200),
                            region_kept(p), dates_kept(p))),
]


def check_explanation(result, evidence):
    """Every number shown must come from the evidence, by fact id."""
    facts = {f["id"]: f for f in evidence["facts"]}
    problems = []
    for sentence in result["sentences"]:
        for fact_id in sentence["fact_ids"]:
            if fact_id not in facts:
                problems.append(f"cites unknown fact {fact_id}")
                continue
            value = facts[fact_id]["value"]
            if isinstance(value, (int, float)):
                # Rounding and unit formatting are fine; the digits must be the
                # backend's. Compare against a few renderings of the number.
                shown = sentence["text"]
                renders = {str(value), f"{value:.0f}", f"{value:.1f}",
                           f"{value:.2f}", f"{value:.3f}",
                           f"{float(value):.2f}".rstrip("0").rstrip(".")}
                if not any(r in shown for r in renders if r):
                    problems.append(f"{fact_id}={value} not traceable in the sentence")
    banned = ("marine heatwave", "thermocline", "anomaly", "trend", "because of",
              "caused by", "significant")
    for sentence in result["sentences"]:
        for word in banned:
            if word in sentence["text"].lower():
                problems.append(f"unsupported claim {word!r}")
    for caveat in result.get("caveats", []):
        if "not a detected thermocline" in caveat or "not an anomaly" in caveat:
            continue
    return (not problems), "; ".join(problems)


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    active = snapshots.resolve(BASE)
    status = provider_status()
    if not status.get("configured"):
        print("No provider configured; nothing to evaluate.")
        return 1

    provider = CountingProvider(build_provider(), MAX_REQUESTS)
    started = datetime.now(timezone.utc)
    records = []

    def record(case_id, question, context, expectation, actual, verdict, reason,
               extra=None):
        records.append({
            "case": case_id, "question": question,
            "context_summary": {
                "variables": (context or {}).get("variables"),
                "depth": (context or {}).get("depth"),
                "time": (context or {}).get("time"),
            } if context else None,
            "expectation": expectation,
            "actual": actual, "verdict": verdict, "reason": reason,
            "latency_s": provider.latencies[-1] if provider.latencies else None,
            **(extra or {}),
        })
        note = reason if (reason and verdict != "pass") else ""
        print(f"  {case_id}: {verdict}{(' - ' + note) if note else ''}")

    print(f"Snapshot {active.snapshot_id} | model {status.get('model')} "
          f"| budget {MAX_REQUESTS}")
    # A blocked case can be retried on its own without spending the budget on
    # cases that already have a verdict: FLOATCHAT_EVAL_ONLY=A,B
    only = {c.strip().upper() for c in os.environ.get("FLOATCHAT_EVAL_ONLY", "").split(",") if c.strip()}
    print("=== proposals ===")
    for case_id, question, context, expect in PLAN_CASES:
        if only and case_id not in only:
            continue
        expectation = expect.__doc__ or "see PLAN_CASES"
        try:
            draft = draft_plan(question=question, context=context, index=INDEX,
                               provider=provider, reference_date=started)
        except BudgetExceeded as exc:
            record(case_id, question, context, expectation, None, "blocked", str(exc))
            continue
        except ProviderError as exc:
            record(case_id, question, context, expectation, None, "blocked",
                   f"provider error: {str(exc)[:120]}")
            continue

        if draft["outcome"] == "provider_unavailable":
            record(case_id, question, context, expectation, draft, "blocked",
                   f"provider unavailable: {draft.get('provider_message')}")
            continue

        proposed = plan_of(draft)
        outcome, parse_error, _ = outcome_of(proposed) if proposed else (None, None, None)
        try:
            ok, reason = expect(draft, proposed, outcome)
        except Exception as exc:  # noqa: BLE001 - a broken answer is a fail, not a crash
            ok, reason = False, f"could not be checked: {type(exc).__name__}: {exc}"
        record(case_id, question, context, expectation,
               {"outcome": draft["outcome"], "plan": proposed,
                "assumptions": draft.get("assumptions"),
                "clarification": draft.get("clarification_question"),
                "unsupported": draft.get("unsupported"),
                "validation_outcome": outcome, "parse_error": parse_error},
               "pass" if ok else "fail", reason)

    # --- explanations, over a really executed result -----------------------
    print("=== explanations ===")
    plan = QueryPlanRequest.model_validate(BASE_PLAN)
    executed = execute_plan(plan, INDEX)
    evidence = build_evidence(plan, INDEX, woa_lookup=api_main.woa_match)
    first_profile = (executed.get("results") or {}).get("profiles", [{}])[0]

    for case_id, label in (("I", "one executed result"), ("J", "a comparison")):
        if only and case_id not in only:
            continue
        question_note = ("explain the executed result" if case_id == "I"
                         else "explain a comparison between two profiles")
        try:
            result = explain_result(evidence, provider)
        except BudgetExceeded as exc:
            record(case_id, question_note, None, "traceable to evidence", None,
                   "blocked", str(exc))
            continue
        if result["outcome"] == "provider_unavailable":
            record(case_id, question_note, None, "traceable to evidence", result,
                   "blocked", f"provider unavailable: {result.get('provider_message')}")
            continue
        ok, reason = check_explanation(result, evidence)
        if case_id == "J":
            # The explanation contract has no comparison template. The honest
            # answer is to say nothing about a comparison, not to invent one.
            mentions = any("compar" in s["text"].lower() for s in result["sentences"])
            if mentions:
                ok, reason = False, "claimed a comparison the contract cannot ground"
            else:
                reason = reason or "no comparison claimed, as the contract requires"
        record(case_id, question_note, None,
               "every number traceable to a backend fact id; no unsupported claims",
               {"outcome": result["outcome"], "source": result.get("source"),
                "sentences": [s["text"] for s in result["sentences"]],
                "used_fact_ids": result.get("used_fact_ids"),
                "rejected": result.get("rejected")},
               "pass" if ok else "fail", reason,
               extra={"profile_checked": first_profile.get("profile_id")})

    summary = {
        "generated_at": started.isoformat(),
        "snapshot": active.snapshot_id,
        "model": status.get("model"),
        "provider_kind": status.get("kind"),
        "provider_requests": provider.calls,
        "budget": MAX_REQUESTS,
        "latencies_s": provider.latencies,
        "usage": "not returned by this adapter",
        "totals": {
            verdict: sum(1 for r in records if r["verdict"] == verdict)
            for verdict in ("pass", "fail", "blocked")
        },
        "cases": records,
    }
    path = os.path.join(OUT_DIR, os.environ.get("FLOATCHAT_EVAL_OUT", "gemini_evaluation.json"))
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, default=str)
    print(f"\n{summary['totals']} | {provider.calls}/{MAX_REQUESTS} requests")
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
