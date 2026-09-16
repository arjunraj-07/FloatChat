"""Apply a validated query plan to the loaded observations.

Execution reuses the *same* selection helper as validation
(:func:`floatchat_core.plan_validation.apply_filters`), so what a preview
counts and what a run returns cannot drift apart. No scientific calculation is
duplicated here or in the frontend: interpolation goes through
:func:`floatchat_core.woa.match_value_at_depth`.

Rules preserved from the rest of the core:

* Only requested variables are returned, so changing the variable list changes
  the records, not merely the counts.
* A level with valid temperature and excluded salinity keeps its temperature
  and carries its own exclusion reason.
* Values produced by interpolating to an exact depth are returned in a separate
  ``derived`` collection, each labelled ``derived: true`` with its method and
  bracketing levels. They are never mixed into ``observations``.
* The executed plan and the dataset identity travel with the results.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import pandas as pd

from .gradients import gradient_report
from .plan import (
    Analysis,
    DepthMode,
    Outcome,
    QueryPlanRequest,
    normalize_plan,
)
from .plan_validation import DatasetIndex, apply_filters, validate_plan
from .woa import DEFAULT_MAX_GAP_M, json_safe, match_value_at_depth

#: Upper bound on rows returned in one execution. The cached subset is far
#: smaller; the guard exists so a larger archive degrades to an explicit
#: truncation notice rather than an unbounded response.
DEFAULT_MAX_OBSERVATIONS = 20000

#: Outcomes that may be executed. ``invalid`` and ``unsupported`` may not.
#: ``valid_no_data`` is executable and returns an explicitly empty result.
EXECUTABLE_OUTCOMES = frozenset({
    Outcome.VALID.value,
    Outcome.VALID_PARTIAL_COVERAGE.value,
    Outcome.VALID_NO_DATA.value,
})


def _cell(value):
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    return value


def _profile_rows(plan: QueryPlanRequest, matched: pd.DataFrame,
                  index: DatasetIndex) -> list:
    """One entry per matching profile, counted within the plan's selection."""
    if matched.empty:
        return []
    wanted = [v.value for v in dict.fromkeys(plan.variables)]
    rows = []
    for profile_id, group in matched.groupby("profile_id", sort=True):
        first = group.iloc[0]
        meta = index.profiles[index.profiles["profile_id"] == profile_id]
        meta_row = meta.iloc[0] if not meta.empty else first
        entry = {
            "profile_id": str(profile_id),
            "platform": str(first["platform"]),
            "cycle": int(first["cycle"]),
            "direction": _cell(first.get("direction")),
            "data_mode": str(first["data_mode"]),
            "source_field": str(first["source_field"]),
            "time": pd.Timestamp(first["time"]).isoformat(),
            "latitude": float(first["latitude"]),
            "longitude": float(first["longitude"]),
            "levels_in_plan": int(len(group)),
            "depth_min_m": float(group["depth"].min()),
            "depth_max_m": float(group["depth"].max()),
            "profile_levels_total": int(_cell(meta_row.get("obs_count")) or len(group)),
            "dataset_id": _cell(first.get("dataset_id")),
            "source_url": _cell(first.get("source_url")),
            "retrieved_at": _cell(first.get("retrieved_at")),
            "variables": {},
        }
        for name in wanted:
            valid = group[name].notna()
            summary = {
                "valid_levels": int(valid.sum()),
                "excluded_levels": int((~valid).sum()),
            }
            status_column = f"{name}_status"
            if status_column in group.columns:
                counts = group.loc[~valid, status_column].value_counts().to_dict()
                summary["exclusions"] = {str(k): int(v) for k, v in counts.items()}
            entry["variables"][name] = summary
        rows.append(entry)
    return rows


def _observation_rows(plan: QueryPlanRequest, matched: pd.DataFrame,
                      limit: int) -> tuple[list, bool]:
    """Matching levels, carrying only the requested variables."""
    if matched.empty:
        return [], False
    wanted = [v.value for v in dict.fromkeys(plan.variables)]
    ordered = matched.sort_values(["profile_id", "depth"])
    truncated = len(ordered) > limit
    if truncated:
        ordered = ordered.iloc[:limit]

    rows = []
    for row in ordered.itertuples():
        record: dict[str, Any] = {
            "profile_id": str(row.profile_id),
            "pres": float(row.pres),
            "pres_qc": _cell(getattr(row, "pres_qc", None)),
            "depth": float(row.depth),
            "source_field": str(row.source_field),
            "derived": False,
        }
        for name in wanted:
            record[name] = _cell(getattr(row, name, None))
            record[f"{name}_qc"] = _cell(getattr(row, f"{name}_qc", None))
            status = _cell(getattr(row, f"{name}_status", None))
            if status is not None:
                record[f"{name}_status"] = status
                record[f"{name}_exclusion_reason"] = _cell(
                    getattr(row, f"{name}_exclusion_reason", None)
                )
        rows.append(record)
    return rows, truncated


def _derived_rows(plan: QueryPlanRequest, matched: pd.DataFrame,
                  max_gap_m: float) -> list:
    """Values interpolated to an exact depth, explicitly labelled as derived.

    These are computed, not measured. They are kept out of ``observations`` so
    a chart cannot present them as sampled levels.
    """
    if plan.depth.mode is not DepthMode.AT_DEPTH or matched.empty:
        return []
    target = float(plan.depth.target_m)
    rows = []
    for profile_id, group in matched.groupby("profile_id", sort=True):
        for variable in dict.fromkeys(plan.variables):
            name = variable.value
            result = match_value_at_depth(
                group["depth"].to_numpy(dtype=float),
                group[name].to_numpy(dtype=float),
                target, max_gap_m=max_gap_m,
            )
            rows.append({
                "profile_id": str(profile_id),
                "variable": name,
                "target_depth_m": target,
                "available": bool(result.available),
                "value": result.value,
                "method": result.method,
                "bracketing_depths": [result.lower_depth, result.upper_depth]
                                     if result.available else None,
                "gap_m": result.gap_m,
                "reason": result.reason,
                "derived": True,
                "derivation": (
                    "Value at an exact depth. 'exact' means an observed level "
                    "sat on the target; 'linear_interpolation' means it was "
                    "computed between two bracketing observed levels. Never "
                    "extrapolated."
                ),
            })
    return rows


#: The variable each gradient analysis describes.
GRADIENT_VARIABLE = {
    Analysis.TEMPERATURE_GRADIENT: "temp",
    Analysis.SALINITY_GRADIENT: "psal",
}


def _gradient_rows(plan: QueryPlanRequest, matched: pd.DataFrame,
                   max_gap_m: float) -> list:
    """Per-profile vertical gradients, for the gradient analyses requested.

    Computed from the levels this plan already selected, so its depth range,
    variables and QC/data-mode policy are respected without a second query
    path. A gradient is always between two *measurements*: values derived at
    an exact depth are never used as endpoints.
    """
    requested = [a for a in dict.fromkeys(plan.analyses)
                 if a in GRADIENT_VARIABLE]
    wanted = {v.value for v in plan.variables}
    names = [GRADIENT_VARIABLE[a] for a in requested
             if GRADIENT_VARIABLE[a] in wanted]
    if not names or matched.empty:
        return []

    rows = []
    for profile_id, group in matched.groupby("profile_id", sort=True):
        ordered = group.sort_values("depth")
        depths = [float(value) for value in ordered["depth"]]
        series = {
            name: [None if pd.isna(value) else float(value)
                   for value in ordered[name]]
            for name in names
        }
        rows.append(gradient_report(depths, series, max_gap_m=max_gap_m,
                                    profile_id=str(profile_id)))
    return rows


def execute_plan(plan: QueryPlanRequest, index: DatasetIndex,
                 max_gap_m: float = DEFAULT_MAX_GAP_M,
                 max_observations: int = DEFAULT_MAX_OBSERVATIONS) -> dict:
    """Revalidate ``plan`` and, if permitted, apply it. JSON-safe result.

    Validation is re-run here rather than trusted from the client, so a plan
    cannot be executed by asserting that it was already approved.
    """
    validation = validate_plan(plan, index, max_gap_m=max_gap_m)
    outcome = validation["outcome"]

    envelope: dict[str, Any] = {
        "schema_version": validation["schema_version"],
        "executed": False,
        "executed_at": None,
        "outcome": outcome,
        "plan": validation.get("normalized_plan") or normalize_plan(plan),
        "validation": validation,
        "dataset": validation["dataset"],
        "results": None,
    }

    if outcome not in EXECUTABLE_OUTCOMES:
        envelope["refusal"] = {
            "code": "not_executable",
            "message": (
                f"A plan with outcome '{outcome}' is not executed. Resolve the "
                "reported errors first."
            ),
        }
        return json_safe(envelope)

    matched = apply_filters(plan, index)
    observations, truncated = _observation_rows(plan, matched, max_observations)
    limitations = []
    if truncated:
        limitations.append({
            "code": "result_truncated",
            "message": (
                f"More than {max_observations} levels matched; the response "
                "carries the first "
                f"{max_observations} ordered by profile and depth. Narrow the "
                "plan for a complete result."
            ),
        })
    if plan.depth.mode is DepthMode.AT_DEPTH:
        limitations.append({
            "code": "derived_values_present",
            "message": (
                "This plan requests an exact depth. Values in 'derived' are "
                "computed from surrounding observed levels and are not "
                "measurements. 'observations' holds the measured levels."
            ),
        })

    derived = _derived_rows(plan, matched, max_gap_m)
    gradients = _gradient_rows(plan, matched, max_gap_m)
    if gradients:
        limitations.append({
            "code": "gradients_are_derived",
            "message": (
                "Gradients and their midpoint depths are derived quantities: "
                "each is a first difference between two adjacent measured "
                "levels, with no smoothing or interpolation. Intervals wider "
                f"than the {max_gap_m:g} m maximum-gap policy, and intervals "
                "touching a level without an accepted value, are reported as "
                "breaks rather than bridged."
            ),
        })
        if plan.depth.mode is DepthMode.AT_DEPTH:
            limitations.append({
                "code": "gradients_use_observed_levels",
                "message": (
                    "Gradients come from the observed levels of each profile. "
                    "A single value derived at an exact depth cannot support "
                    "a gradient, which needs two measurements."
                ),
            })
    envelope["executed"] = True
    envelope["executed_at"] = datetime.now(timezone.utc).isoformat()
    envelope["results"] = {
        "profiles": _profile_rows(plan, matched, index),
        "observations": observations,
        # `observation_count` is how many levels matched the plan;
        # `returned_observation_count` is how many are in this response. They
        # differ only when `truncated` is true.
        "observation_count": int(len(matched)),
        "returned_observation_count": len(observations),
        "derived": derived,
        "derived_count": len(derived),
        "derived_identity": {
            "unit": "one row per (profile_id, variable) at one target depth",
            "key_fields": ["profile_id", "variable", "target_depth_m"],
            "method_field": "method",
            "methods": ["exact", "linear_interpolation"],
            "note": (
                "A derived row is a computed value, not an observation. Rows "
                "are counted per profile per variable; `available` false means "
                "no value could be justified and `value` is null."
            ),
        },
        "gradients": gradients,
        "gradient_count": len(gradients),
        "truncated": truncated,
        "variables": [v.value for v in dict.fromkeys(plan.variables)],
        "limitations": limitations,
    }
    return json_safe(envelope)
