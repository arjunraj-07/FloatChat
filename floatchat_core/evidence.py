"""A compact, server-verified set of facts about one executed query.

Everything here is recomputed from the executed plan and the loaded dataset.
Nothing a browser sends is treated as a measurement: the client supplies the
plan and a dataset fingerprint, and this module derives every number again
through the same validator, executor and gradient code the user's results came
from. If the two disagree, the mismatch is reported rather than papered over.

Why it exists: an explanation must be built on facts that can be checked, and
the full execution response is roughly 3.24 MB. This produces a few kilobytes
of labelled, identified facts instead - counts, extents, units and status -
with no observation arrays and no per-interval gradient lists.

Each fact carries:

``id``      a stable identifier an explanation may reference, e.g.
            ``variable.temp.depth_max_m``. Identifiers never change meaning.
``value``   the number or string the backend computed.
``units``   the unit, or ``None`` where the quantity is dimensionless.
``kind``    ``measured``, ``derived``, ``reference``, ``count``, ``extent``
            or ``status`` - so a computed value is never read as an
            observation.
``label``   a short human phrase, used when a template renders the fact.

The vocabulary is deliberately small. A fact that is not present cannot be
referenced, and an explanation referencing an unknown id is rejected.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Callable, Optional

from .plan import QueryPlanRequest, normalize_plan
from .plan_execution import execute_plan
from .plan_validation import DatasetIndex, validate_plan
from .woa import DEFAULT_MAX_GAP_M, json_safe

#: Sampled positions are listed, not summarised away, but a long list adds
#: nothing an explanation can use.
MAX_SAMPLE_LOCATIONS = 12
MAX_PLATFORMS = 12

VARIABLE_WORDS = {"temp": "temperature", "psal": "salinity"}
VALUE_UNITS = {"temp": "degree_Celsius", "psal": "PSS-78 (dimensionless)"}


def dataset_version(index: DatasetIndex) -> str:
    """A stable identifier for the data a result was computed from.

    The processing checksum when one is recorded, otherwise a digest of the
    dataset's own description. Explanations are bound to this, so a result
    computed from different data can never be explained by an older answer.
    """
    described = index.describe()
    checksum = described.get("raw_file_checksum")
    if isinstance(checksum, str) and checksum:
        return checksum
    seed = json.dumps(
        {k: described.get(k) for k in
         ("dataset_id", "processed_at", "observation_count", "profile_count")},
        sort_keys=True, default=str)
    return "sha256:" + hashlib.sha256(seed.encode("utf-8")).hexdigest()


def plan_fingerprint(plan: QueryPlanRequest) -> str:
    """A digest of the normalized plan, identifying one executed result."""
    canonical = json.dumps(json_safe(normalize_plan(plan)), sort_keys=True,
                           default=str)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _fact(facts: list, id_: str, label: str, value: Any, units: Optional[str],
          kind: str) -> None:
    """Record one fact, skipping anything the backend could not compute."""
    if value is None:
        return
    facts.append({"id": id_, "label": label, "value": value, "units": units,
                  "kind": kind})


def _time_and_region(facts: list, coverage: dict, matching: dict) -> None:
    time = coverage.get("time") or {}
    _fact(facts, "time.observed_start", "first observation",
          time.get("matched_start"), "UTC", "extent")
    _fact(facts, "time.observed_end", "last observation",
          time.get("matched_end"), "UTC", "extent")

    region = coverage.get("region") or {}
    _fact(facts, "region.sampled_location_count", "distinct sampled positions",
          region.get("sampled_location_count"), None, "count")
    bounds = region.get("matched_sample_bounds")
    if isinstance(bounds, dict):
        _fact(facts, "region.south", "southernmost sampled latitude",
              bounds.get("south"), "degrees_north", "extent")
        _fact(facts, "region.north", "northernmost sampled latitude",
              bounds.get("north"), "degrees_north", "extent")
        _fact(facts, "region.west", "westernmost sampled longitude",
              bounds.get("west"), "degrees_east", "extent")
        _fact(facts, "region.east", "easternmost sampled longitude",
              bounds.get("east"), "degrees_east", "extent")

    _fact(facts, "profiles.count", "profiles returned",
          matching.get("profiles"), None, "count")
    _fact(facts, "profiles.float_count", "floats represented",
          matching.get("floats"), None, "count")
    _fact(facts, "observations.count", "measured levels",
          matching.get("observations"), None, "count")

    depth = coverage.get("depth") or {}
    _fact(facts, "depth.max_level_gap_m", "largest gap between levels",
          depth.get("max_level_gap_m"), "m", "extent")
    _fact(facts, "depth.median_level_spacing_m", "typical spacing between levels",
          depth.get("median_level_spacing_m"), "m", "extent")


def _variables(facts: list, coverage: dict) -> None:
    for name, summary in (coverage.get("variables") or {}).items():
        word = VARIABLE_WORDS.get(name, name)
        units = VALUE_UNITS.get(name)
        _fact(facts, f"variable.{name}.valid_observations",
              f"{word} values kept", summary.get("valid_observations"),
              None, "count")
        _fact(facts, f"variable.{name}.excluded_observations",
              f"{word} levels without a usable value",
              summary.get("excluded_observations"), None, "count")
        _fact(facts, f"variable.{name}.profiles_with_values",
              f"profiles carrying {word}", summary.get("profiles_with_values"),
              None, "count")
        _fact(facts, f"variable.{name}.depth_min_m",
              f"shallowest {word} measurement", summary.get("depth_min_m"),
              "m", "measured")
        _fact(facts, f"variable.{name}.depth_max_m",
              f"deepest {word} measurement", summary.get("depth_max_m"),
              "m", "measured")
        _fact(facts, f"variable.{name}.value_min", f"lowest {word} value",
              summary.get("value_min"), units, "measured")
        _fact(facts, f"variable.{name}.value_max", f"highest {word} value",
              summary.get("value_max"), units, "measured")


def _derived(facts: list, results: dict) -> None:
    derived = results.get("derived") or []
    if not derived:
        return

    target_depth = None
    for row in derived:
        if "target_depth_m" in row:
            target_depth = row["target_depth_m"]
            break

    if target_depth is not None:
        _fact(facts, "derived.target_depth_m", "the exact depth requested",
              target_depth, "m", "derived")

    available = [row for row in derived if row.get("available")]
    if available:
        _fact(facts, "derived.count", "values computed at an exact depth",
              len(available), None, "derived")

    values_by_var: dict[str, list[float]] = {}
    unavailable_by_var: dict[str, int] = {}
    
    for row in derived:
        var = row.get("variable")
        if not var: continue
        if row.get("available"):
            values_by_var.setdefault(var, []).append(row["value"])
        else:
            unavailable_by_var[var] = unavailable_by_var.get(var, 0) + 1
            
    for var, values in values_by_var.items():
        if values:
            mean = sum(values) / len(values)
            _fact(facts, f"derived.{var}.value_mean", f"mean estimated {VARIABLE_WORDS.get(var, var)}",
                  mean, VALUE_UNITS.get(var), "derived")
            _fact(facts, f"derived.{var}.count", f"profiles with an estimate",
                  len(values), "profiles")
    for var, count in unavailable_by_var.items():
        if count > 0:
            _fact(facts, f"derived.{var}.unavailable", f"profiles where {VARIABLE_WORDS.get(var, var)} could not be interpolated",
                  count, None, "count")


def _gradients(facts: list, results: dict) -> None:
    """Per-profile gradient findings, summarised across the result."""
    reports = results.get("gradients") or []
    if not reports:
        return
    totals: dict[str, int] = {}
    for report in reports:
        for name, series in (report.get("variables") or {}).items():
            totals[name] = totals.get(name, 0) + int(series.get("interval_count") or 0)
    for name, count in totals.items():
        _fact(facts, f"gradient.{name}.interval_count",
              f"{VARIABLE_WORDS.get(name, name)} intervals compared", count,
              None, "derived")

    # The single steepest cooling interval across the returned profiles.
    steepest = None
    for report in reports:
        cooling = report.get("strongest_cooling")
        if not cooling:
            continue
        value = cooling["interval"]["gradient"]
        if steepest is None or value < steepest["interval"]["gradient"]:
            steepest = cooling
    if steepest is None:
        return
    interval = steepest["interval"]
    _fact(facts, "gradient.temp.strongest_cooling.value",
          "steepest fall in temperature with depth", interval.get("gradient"),
          interval.get("units"), "derived")
    _fact(facts, "gradient.temp.strongest_cooling.upper_depth_m",
          "top of that interval", interval["upper"]["depth_m"], "m", "measured")
    _fact(facts, "gradient.temp.strongest_cooling.lower_depth_m",
          "bottom of that interval", interval["lower"]["depth_m"], "m", "measured")
    _fact(facts, "gradient.temp.strongest_cooling.profile_id",
          "profile it was found in", interval.get("profile_id"), None, "status")


def _woa(facts: list, results: dict,
         woa_lookup: Optional[Callable[[str], dict]]) -> list:
    """Climatology comparisons, only where one could actually be justified."""
    notes: list[str] = []
    if woa_lookup is None:
        # Say so rather than returning silently: an explanation that simply
        # omits the comparison would let its absence read as agreement.
        notes.append(
            "No climatology comparison was available for this result, so none "
            "is reported.")
        return notes
    profiles = [row["profile_id"] for row in (results.get("profiles") or [])]
    compared = 0
    first: Optional[dict] = None
    for profile_id in profiles[:MAX_PLATFORMS]:
        try:
            match = woa_lookup(profile_id)
        except Exception:  # noqa: BLE001 - a lookup failure is "unavailable"
            continue
        if not isinstance(match, dict) or match.get("status") != "Success":
            continue
        compared += 1
        if first is None:
            first = match
    if compared == 0:
        notes.append(
            "No climatology comparison could be justified for the profiles in "
            "this result, so none is reported.")
        return notes
    _fact(facts, "woa.compared_profile_count",
          "profiles with a climatology comparison", compared, None, "count")
    _fact(facts, "woa.difference", "difference from the monthly mean",
          first.get("difference"), "degree_Celsius", "reference")
    _fact(facts, "woa.comparison_depth_m", "depth of that comparison",
          first.get("comparison_depth"), "m", "reference")
    _fact(facts, "woa.baseline_period", "climatology baseline",
          first.get("baseline_period"), None, "status")
    return notes


def build_evidence(plan: QueryPlanRequest, index: DatasetIndex, *,
                   max_gap_m: float = DEFAULT_MAX_GAP_M,
                   woa_lookup: Optional[Callable[[str], dict]] = None) -> dict:
    """Recompute one executed query and describe it as checkable facts.

    The plan is revalidated and re-executed here, so the evidence reflects the
    server's own calculations rather than anything a caller asserted.
    """
    validation = validate_plan(plan, index, max_gap_m=max_gap_m)
    executed = execute_plan(plan, index, max_gap_m=max_gap_m)
    results = executed.get("results") or {}

    facts: list[dict] = []
    coverage = validation.get("coverage") or {}
    matching = validation.get("matching") or {}
    _time_and_region(facts, coverage, matching)
    _variables(facts, coverage)
    _derived(facts, results)
    _gradients(facts, results)
    notes = _woa(facts, results, woa_lookup)

    limitations = [
        {"code": item.get("code"), "message": item.get("message")}
        for item in (results.get("limitations") or [])
    ]
    for warning in validation.get("warnings") or []:
        limitations.append({"code": warning.get("code"),
                            "message": warning.get("message")})

    region = coverage.get("region") or {}
    locations = (region.get("sample_locations") or [])[:MAX_SAMPLE_LOCATIONS]

    return json_safe({
        "schema_version": "1.0",
        "dataset_version": dataset_version(index),
        "plan_fingerprint": plan_fingerprint(plan),
        "executed": bool(executed.get("executed")),
        "outcome": executed.get("outcome"),
        "variables": list(results.get("variables") or []),
        "facts": facts,
        "fact_ids": [fact["id"] for fact in facts],
        "sample_locations": locations,
        "sample_locations_truncated": len(region.get("sample_locations") or []) > len(locations),
        "platforms": (matching.get("platforms") or [])[:MAX_PLATFORMS],
        "limitations": limitations,
        "notes": notes,
    })
