"""Validation of a typed query plan against the data that is actually loaded.

This module decides runtime availability. It reads the observation and profile
tables handed to it, never a documentation file, and it never executes the
plan, retrieves external data or calls a model.

Outcome precedence, highest first:

1. ``invalid``   - schema or semantic violation, or a dangling float/profile
   reference, or a QC policy the stored tables cannot satisfy.
2. ``unsupported`` - well formed, but names an analysis or output with no
   production implementation.
3. ``valid_no_data`` - supported, but nothing matches.
4. ``valid_partial_coverage`` - supported, something matches, but not the whole
   requested extent or not every requested variable.
5. ``valid``.

A plan is never silently altered. Requested bounds, variables, dates and region
are preserved exactly in the normalized plan; what the data can and cannot
supply is reported separately under ``coverage``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np
import pandas as pd

from .plan import (
    ANALYSIS_CAPABILITIES,
    OUTPUT_CAPABILITIES,
    PLAN_SCHEMA_VERSION,
    Analysis,
    DepthMode,
    Issue,
    Outcome,
    QueryPlanRequest,
    Variable,
    normalize_plan,
    to_utc,
)
from .woa import DEFAULT_MAX_GAP_M, json_safe, match_value_at_depth, read_cached_column

#: Warnings that demote a fully valid plan to partial coverage.
#:
#: ``data_mode_absent`` is deliberately excluded. The default policy accepts all
#: three Argo modes, so the absence of one is not a shortfall against what was
#: asked for; if every requested mode were absent nothing would match and the
#: outcome would be ``valid_no_data`` on its own.
PARTIAL_WARNING_CODES = frozenset({
    "partial_time_coverage",
    "partial_depth_coverage",
    "partial_region_coverage",
    "variable_unavailable",
    "variable_partial",
    "interpolation_not_possible",
    "reference_data_uncached",
})


@dataclass
class DatasetIndex:
    """A view over the loaded tables, plus the identity of that data.

    Every availability decision is derived from these frames at call time, so
    reprocessing the archive changes validation results without any code or
    documentation edit.
    """

    observations: pd.DataFrame
    profiles: pd.DataFrame
    identity: dict = field(default_factory=dict)

    @property
    def platforms(self) -> set:
        return set(self.profiles["platform"].astype(str))

    @property
    def profile_ids(self) -> set:
        return set(self.profiles["profile_id"].astype(str))

    @property
    def stored_data_modes(self) -> set:
        return set(self.profiles["data_mode"].astype(str))

    def stored_qc_flags(self, variable: str) -> set:
        """QC flags actually present for a variable in the stored tables."""
        column = f"{variable}_qc"
        if column not in self.observations.columns:
            return set()
        values = self.observations[column].dropna()
        return {int(v) for v in values.unique()}

    @property
    def all_stored_qc_flags(self) -> set:
        flags: set = set()
        for variable in ("pres", "temp", "psal"):
            flags |= self.stored_qc_flags(variable)
        return flags

    def describe(self) -> dict:
        obs = self.observations
        payload = {
            "observation_count": int(len(obs)),
            "profile_count": int(self.profiles["profile_id"].nunique()),
            "float_count": int(self.profiles["platform"].nunique()),
            "time_min": _iso(obs["time"].min()),
            "time_max": _iso(obs["time"].max()),
            "latitude_min": float(obs["latitude"].min()),
            "latitude_max": float(obs["latitude"].max()),
            "longitude_min": float(obs["longitude"].min()),
            "longitude_max": float(obs["longitude"].max()),
            "depth_min_m": float(obs["depth"].min()),
            "depth_max_m": float(obs["depth"].max()),
            "data_modes_present": sorted(self.stored_data_modes),
            "qc_flags_present": sorted(self.all_stored_qc_flags),
        }
        payload.update(self.identity)
        return payload


def _iso(value) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).isoformat()


def _issue(code: str, message: str, field_path: Optional[str] = None) -> Issue:
    return Issue(code=code, field=field_path, message=message)


# --------------------------------------------------------------------------
# Individual checks
# --------------------------------------------------------------------------

def check_capabilities(plan: QueryPlanRequest) -> list[Issue]:
    """Analyses and outputs that are declared but have no implementation."""
    issues: list[Issue] = []
    for index, analysis in enumerate(plan.analyses):
        capability = ANALYSIS_CAPABILITIES[analysis]
        if not capability.implemented:
            issues.append(_issue(
                "unsupported_analysis",
                f"Analysis '{analysis.value}' is not implemented. "
                f"{capability.unavailable_reason}",
                f"analyses.{index}",
            ))
    for index, output in enumerate(plan.outputs):
        capability = OUTPUT_CAPABILITIES[output]
        if not capability.implemented:
            issues.append(_issue(
                "unsupported_output",
                f"Output '{output.value}' is not implemented. "
                f"{capability.unavailable_reason}",
                f"outputs.{index}",
            ))
    return issues


def check_qc_policy(plan: QueryPlanRequest, index: DatasetIndex) -> list[Issue]:
    """Reject a QC policy the stored tables cannot honour.

    The processed tables are pre-filtered: only levels whose selected QC flag
    was 1 were retained, and excluded raw observations are not recoverable from
    them. Accepting a request for other flags would silently return QC=1 data
    under a different label.
    """
    issues: list[Issue] = []
    stored = index.all_stored_qc_flags
    requested = set(plan.qc_policy.accepted_qc_flags)
    unsatisfiable = requested - stored
    if unsatisfiable:
        issues.append(_issue(
            "qc_policy_not_applicable",
            "The processed tables retain only observations whose selected QC "
            f"flag is in {sorted(stored)}. Flags {sorted(unsatisfiable)} cannot "
            "be served: the excluded levels were dropped during ingestion and "
            "cannot be reconstructed from the stored data. Reprocess from the "
            "raw subset with a different policy to serve them.",
            "qc_policy.accepted_qc_flags",
        ))
    return issues


def check_selection(plan: QueryPlanRequest, index: DatasetIndex) -> list[Issue]:
    """Dangling or mutually inconsistent float/profile references."""
    issues: list[Issue] = []
    known_platforms = index.platforms
    known_profiles = index.profile_ids

    for position, platform in enumerate(plan.selection.platforms):
        if platform not in known_platforms:
            issues.append(_issue(
                "unknown_platform",
                f"Float '{platform}' is not present in the validated dataset.",
                f"selection.platforms.{position}",
            ))
    for position, profile_id in enumerate(plan.selection.profile_ids):
        if profile_id not in known_profiles:
            issues.append(_issue(
                "unknown_profile",
                f"Profile '{profile_id}' is not present in the validated "
                "dataset.",
                f"selection.profile_ids.{position}",
            ))

    if plan.selection.platforms and plan.selection.profile_ids:
        requested_platforms = set(plan.selection.platforms)
        for position, profile_id in enumerate(plan.selection.profile_ids):
            if profile_id not in known_profiles:
                continue
            owner = str(index.profiles.loc[
                index.profiles["profile_id"] == profile_id, "platform"
            ].iloc[0])
            if owner not in requested_platforms:
                issues.append(_issue(
                    "profile_platform_mismatch",
                    f"Profile '{profile_id}' belongs to float '{owner}', which "
                    f"is not among the requested floats "
                    f"{sorted(requested_platforms)}.",
                    f"selection.profile_ids.{position}",
                ))
    return issues


def apply_filters(plan: QueryPlanRequest, index: DatasetIndex) -> pd.DataFrame:
    """Observations matching the plan's constraints.

    For ``at_depth`` the depth constraint is deliberately **not** applied:
    reaching an exact depth needs the bracketing levels above and below it, so
    the whole profile stays in scope and matchability is assessed separately.
    """
    obs = index.observations
    mask = pd.Series(True, index=obs.index)

    start = pd.Timestamp(to_utc(plan.time.start))
    end = pd.Timestamp(to_utc(plan.time.end))
    mask &= (obs["time"] >= start) & (obs["time"] <= end)

    bounds = plan.region.bounds()
    mask &= (obs["latitude"] >= bounds["south"]) & (obs["latitude"] <= bounds["north"])
    mask &= (obs["longitude"] >= bounds["west"]) & (obs["longitude"] <= bounds["east"])

    modes = {m.value for m in plan.qc_policy.data_modes}
    mask &= obs["data_mode"].astype(str).isin(modes)

    if plan.selection.platforms:
        mask &= obs["platform"].astype(str).isin(set(plan.selection.platforms))
    if plan.selection.profile_ids:
        mask &= obs["profile_id"].astype(str).isin(set(plan.selection.profile_ids))

    if plan.depth.mode is DepthMode.RANGE:
        mask &= (obs["depth"] >= plan.depth.min_m) & (obs["depth"] <= plan.depth.max_m)

    return obs[mask]


def _vertical_sampling(matched: pd.DataFrame) -> dict:
    """Spacing between observed levels, per profile.

    Reported so that a depth range is never read as continuous coverage.
    """
    gaps: list[float] = []
    for _, group in matched.groupby("profile_id"):
        depths = np.sort(group["depth"].to_numpy(dtype=float))
        if depths.size >= 2:
            gaps.extend(np.diff(depths).tolist())
    if not gaps:
        return {"max_level_gap_m": None, "median_level_spacing_m": None,
                "level_pair_count": 0}
    return {
        "max_level_gap_m": float(np.max(gaps)),
        "median_level_spacing_m": float(np.median(gaps)),
        "level_pair_count": int(len(gaps)),
    }


def _variable_coverage(matched: pd.DataFrame, variable: Variable) -> dict:
    """Per-variable availability within the matched observations."""
    name = variable.value
    valid = matched[matched[name].notna()] if not matched.empty else matched
    summary: dict[str, Any] = {
        "variable": name,
        "requested": True,
        "valid_observations": int(len(valid)),
        "total_matched_observations": int(len(matched)),
        "profiles_with_values": int(valid["profile_id"].nunique()) if len(valid) else 0,
        "depth_min_m": float(valid["depth"].min()) if len(valid) else None,
        "depth_max_m": float(valid["depth"].max()) if len(valid) else None,
        "value_min": float(valid[name].min()) if len(valid) else None,
        "value_max": float(valid[name].max()) if len(valid) else None,
    }

    status_column = f"{name}_status"
    if status_column in matched.columns and not matched.empty:
        counts = matched[status_column].value_counts().to_dict()
        summary["exclusions"] = {str(k): int(v) for k, v in counts.items()
                                 if str(k) != "ok"}
    else:
        summary["exclusions"] = {}

    summary["excluded_observations"] = int(len(matched) - len(valid))
    return summary


def _at_depth_matchability(plan: QueryPlanRequest, matched: pd.DataFrame,
                           variable: Variable, max_gap_m: float) -> dict:
    """Whether each profile can supply the exact requested depth.

    Uses the production matcher, so the no-extrapolation and maximum-gap rules
    are exactly those the explorer applies.
    """
    target = float(plan.depth.target_m)
    name = variable.value
    exact = interpolated = 0
    unmatchable: dict[str, int] = {}

    for _, group in matched.groupby("profile_id"):
        result = match_value_at_depth(
            group["depth"].to_numpy(dtype=float),
            group[name].to_numpy(dtype=float),
            target,
            max_gap_m=max_gap_m,
        )
        if not result.available:
            key = _reason_key(result.reason)
            unmatchable[key] = unmatchable.get(key, 0) + 1
        elif result.method == "exact":
            exact += 1
        else:
            interpolated += 1

    return {
        "target_m": target,
        "max_gap_m": max_gap_m,
        "profiles_exact": exact,
        "profiles_interpolated": interpolated,
        "profiles_matchable": exact + interpolated,
        "profiles_unmatchable": int(sum(unmatchable.values())),
        "unmatchable_reasons": unmatchable,
    }


def _reason_key(reason: Optional[str]) -> str:
    text = (reason or "").lower()
    if "extrapolation is not permitted" in text:
        return "outside_observed_range_no_extrapolation"
    if "exceeding the configured maximum" in text:
        return "gap_exceeds_maximum"
    if "no valid observed levels" in text:
        return "no_valid_levels"
    if "only one valid observed level" in text:
        return "single_valid_level"
    return "other"


def _extent_warnings(plan: QueryPlanRequest, index: DatasetIndex,
                     matched: pd.DataFrame) -> tuple[list[Issue], dict]:
    """Compare the requested extent with what the dataset can ever supply."""
    warnings: list[Issue] = []
    dataset = index.describe()
    obs = index.observations

    requested_start = pd.Timestamp(to_utc(plan.time.start))
    requested_end = pd.Timestamp(to_utc(plan.time.end))
    data_start, data_end = obs["time"].min(), obs["time"].max()
    time_summary = {
        "requested_start": requested_start.isoformat(),
        "requested_end": requested_end.isoformat(),
        "dataset_start": _iso(data_start),
        "dataset_end": _iso(data_end),
        "matched_start": _iso(matched["time"].min()) if len(matched) else None,
        "matched_end": _iso(matched["time"].max()) if len(matched) else None,
    }
    if requested_start < data_start or requested_end > data_end:
        warnings.append(_issue(
            "partial_time_coverage",
            f"The requested window {requested_start.isoformat()} to "
            f"{requested_end.isoformat()} extends beyond the dataset's own "
            f"coverage ({_iso(data_start)} to {_iso(data_end)}). The plan's "
            "dates are preserved; only the overlapping part can return data.",
            "time",
        ))

    bounds = plan.region.bounds()
    region_summary = {
        "requested": bounds,
        "dataset": {
            "west": dataset["longitude_min"], "east": dataset["longitude_max"],
            "south": dataset["latitude_min"], "north": dataset["latitude_max"],
        },
        "matched": {
            "west": float(matched["longitude"].min()),
            "east": float(matched["longitude"].max()),
            "south": float(matched["latitude"].min()),
            "north": float(matched["latitude"].max()),
        } if len(matched) else None,
    }
    if (bounds["west"] < dataset["longitude_min"]
            or bounds["east"] > dataset["longitude_max"]
            or bounds["south"] < dataset["latitude_min"]
            or bounds["north"] > dataset["latitude_max"]):
        warnings.append(_issue(
            "partial_region_coverage",
            "The requested region is larger than the area the dataset covers "
            f"({dataset['longitude_min']:.3f} to {dataset['longitude_max']:.3f} E, "
            f"{dataset['latitude_min']:.3f} to {dataset['latitude_max']:.3f} N). "
            "The requested bounds are preserved; observations exist only "
            "within the covered area, and sparsely within it.",
            "region",
        ))

    depth_summary: dict[str, Any] = {
        "mode": plan.depth.mode.value,
        "dataset_min_m": dataset["depth_min_m"],
        "dataset_max_m": dataset["depth_max_m"],
        "matched_min_m": float(matched["depth"].min()) if len(matched) else None,
        "matched_max_m": float(matched["depth"].max()) if len(matched) else None,
    }
    if plan.depth.mode is DepthMode.RANGE:
        depth_summary["requested_min_m"] = plan.depth.min_m
        depth_summary["requested_max_m"] = plan.depth.max_m
        if (plan.depth.min_m < dataset["depth_min_m"]
                or plan.depth.max_m > dataset["depth_max_m"]):
            warnings.append(_issue(
                "partial_depth_coverage",
                f"The requested depth range {plan.depth.min_m:.2f}-"
                f"{plan.depth.max_m:.2f} m extends beyond the observed range "
                f"{dataset['depth_min_m']:.2f}-{dataset['depth_max_m']:.2f} m. "
                "Observations are selected where they exist; nothing is "
                "extrapolated and the requested range is unchanged.",
                "depth",
            ))
    else:
        depth_summary["requested_target_m"] = plan.depth.target_m

    depth_summary.update(_vertical_sampling(matched))
    return warnings, {"time": time_summary, "region": region_summary,
                      "depth": depth_summary}


def _reference_cache_warning(plan: QueryPlanRequest,
                             matched: pd.DataFrame) -> list[Issue]:
    """Warn when a climatology comparison would need uncached reference data.

    Only the local cache is consulted; this never performs a network read.
    """
    if Analysis.WOA_CLIMATOLOGY_COMPARISON not in plan.analyses or matched.empty:
        return []
    needed = missing = 0
    for _, group in matched.groupby("profile_id"):
        row = group.iloc[0]
        month = int(pd.Timestamp(row["time"]).month)
        for variable in plan.variables:
            needed += 1
            if read_cached_column(variable.value, month,
                                  float(row["latitude"]),
                                  float(row["longitude"])) is None:
                missing += 1
    if not missing:
        return []
    return [_issue(
        "reference_data_uncached",
        f"{missing} of {needed} reference columns needed for "
        "'woa_climatology_comparison' are not in the local cache. The "
        "comparison will report 'Comparison unavailable' for those profiles "
        "until the cache is populated; no value is substituted.",
        "analyses",
    )]


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def validate_plan(plan: QueryPlanRequest, index: DatasetIndex,
                  max_gap_m: float = DEFAULT_MAX_GAP_M) -> dict:
    """Validate ``plan`` against ``index``. Returns a JSON-safe response body.

    The caller supplies the HTTP status; see
    :func:`floatchat_core.plan_validation.status_for_outcome`.
    """
    errors: list[Issue] = []
    warnings: list[Issue] = []

    reference_errors = check_selection(plan, index) + check_qc_policy(plan, index)
    capability_errors = check_capabilities(plan)
    errors.extend(reference_errors)
    errors.extend(capability_errors)

    response: dict[str, Any] = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "outcome": None,
        "normalized_plan": None,
        "errors": [],
        "warnings": [],
        "matching": None,
        "coverage": None,
        "dataset": index.describe(),
    }

    if reference_errors:
        response["outcome"] = Outcome.INVALID.value
        response["errors"] = [e.model_dump() for e in errors]
        return json_safe(response)
    if capability_errors:
        response["outcome"] = Outcome.UNSUPPORTED.value
        response["errors"] = [e.model_dump() for e in errors]
        # The plan itself is well formed, so show what it normalises to.
        response["normalized_plan"] = normalize_plan(plan)
        return json_safe(response)

    matched = apply_filters(plan, index)

    for mode in dict.fromkeys(plan.qc_policy.data_modes):
        if mode.value not in index.stored_data_modes:
            warnings.append(_issue(
                "data_mode_absent",
                f"Data mode '{mode.value}' is supported by the pipeline but no "
                "profile in the validated dataset uses it "
                f"(present: {sorted(index.stored_data_modes)}).",
                "qc_policy.data_modes",
            ))

    extent_warnings, coverage = _extent_warnings(plan, index, matched)
    warnings.extend(extent_warnings)

    variables: dict[str, Any] = {}
    for variable in dict.fromkeys(plan.variables):
        summary = _variable_coverage(matched, variable)
        if plan.depth.mode is DepthMode.AT_DEPTH and not matched.empty:
            matchability = _at_depth_matchability(plan, matched, variable, max_gap_m)
            summary["at_depth"] = matchability
            if matchability["profiles_matchable"] == 0:
                warnings.append(_issue(
                    "interpolation_not_possible",
                    f"No profile can supply {variable.value.upper()} at "
                    f"{plan.depth.target_m:.2f} m without extrapolating or "
                    f"bridging a gap wider than {max_gap_m:.0f} m "
                    f"({matchability['unmatchable_reasons']}).",
                    "depth.target_m",
                ))
            elif matchability["profiles_unmatchable"]:
                warnings.append(_issue(
                    "interpolation_not_possible",
                    f"{matchability['profiles_unmatchable']} profile(s) cannot "
                    f"supply {variable.value.upper()} at "
                    f"{plan.depth.target_m:.2f} m "
                    f"({matchability['unmatchable_reasons']}); "
                    f"{matchability['profiles_matchable']} can.",
                    "depth.target_m",
                ))

        if not matched.empty:
            if summary["valid_observations"] == 0:
                warnings.append(_issue(
                    "variable_unavailable",
                    f"{variable.value.upper()} has no valid values in the "
                    f"{len(matched)} matching observation(s). The variable is "
                    "kept in the plan; results will contain no "
                    f"{variable.value.upper()} data.",
                    f"variables.{variable.value}",
                ))
            elif summary["excluded_observations"] > 0:
                warnings.append(_issue(
                    "variable_partial",
                    f"{variable.value.upper()} is valid on "
                    f"{summary['valid_observations']} of {len(matched)} "
                    f"matching level(s); {summary['excluded_observations']} "
                    f"were excluded ({summary['exclusions']}). Levels without "
                    f"{variable.value.upper()} retain their other variables.",
                    f"variables.{variable.value}",
                ))
        variables[variable.value] = summary

    coverage["variables"] = variables
    warnings.extend(_reference_cache_warning(plan, matched))

    if matched.empty:
        warnings.append(_issue(
            "no_matching_observations",
            "No observation matched the requested constraints. The request is "
            "valid and supported; the dataset simply contains nothing in this "
            "region, window, depth range and data mode.",
            None,
        ))
        outcome = Outcome.VALID_NO_DATA
    else:
        warnings.append(_issue(
            "sparse_vertical_sampling",
            "Observations exist only at discrete sampled levels "
            f"(median spacing {coverage['depth']['median_level_spacing_m']:.2f} m, "
            f"largest gap {coverage['depth']['max_level_gap_m']:.2f} m). "
            "Coverage between levels is not continuous.",
            "depth",
        ))
        partial = any(w.code in PARTIAL_WARNING_CODES for w in warnings)
        outcome = (Outcome.VALID_PARTIAL_COVERAGE if partial else Outcome.VALID)

    response["outcome"] = outcome.value
    response["normalized_plan"] = normalize_plan(plan)
    response["errors"] = []
    response["warnings"] = [w.model_dump() for w in warnings]
    response["coverage"] = coverage
    response["matching"] = {
        "observations": int(len(matched)),
        "profiles": int(matched["profile_id"].nunique()) if len(matched) else 0,
        "floats": int(matched["platform"].nunique()) if len(matched) else 0,
        "platforms": sorted(set(matched["platform"].astype(str))) if len(matched) else [],
        "profile_ids": sorted(set(matched["profile_id"].astype(str))) if len(matched) else [],
    }
    return json_safe(response)


def status_for_outcome(outcome: str) -> int:
    """HTTP status for a validation outcome.

    ``invalid`` is 422: the plan cannot be executed as written. Every other
    outcome is 200, because the request was understood and the body carries a
    complete, actionable validation result - including ``unsupported`` and
    ``valid_no_data``, neither of which is a malformed request.
    """
    return 422 if outcome == Outcome.INVALID.value else 200
