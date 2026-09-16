"""Vertical gradients between consecutive observed levels of one profile.

Scope, stated plainly because the name invites bigger claims: this computes a
**finite difference between two adjacent measurements** of one profile. It is
not a thermocline detector, not a mixed-layer estimator, not an anomaly test
and not a smoothed derivative. Nothing here fits a curve, interpolates,
extrapolates, or bridges a level that quality control rejected.

For two consecutive eligible levels (shallower ``1``, deeper ``2``):

    gradient = (value2 - value1) / (depth2 - depth1)

Depth is metres, positive down, exactly as stored, so a temperature that falls
with depth gives a **negative** gradient.

Two quantities returned here are derived, never measured, and are labelled as
such: the gradient itself, and the interval midpoint depth, which is an
arithmetic centre between two sampled depths and not a depth anything was
sampled at.

**Maximum-gap policy.** Two measurements far apart in depth still produce an
arithmetic ratio, but it says little about the water between them. Intervals
wider than :data:`DEFAULT_MAX_GAP_M` are therefore reported as breaks instead
of gradients. That limit is an **application policy** reused from the existing
climatology matching configuration (``FLOATCHAT_MAX_GAP_M``), not a property of
the ocean and not a published threshold.

Temperature and salinity are computed independently, so a profile whose
salinity was rejected still yields temperature gradients.
"""

from __future__ import annotations

import math
from typing import Iterable, Optional, Sequence

from .woa import DEFAULT_MAX_GAP_M

#: Units of each gradient. Practical salinity is dimensionless, so its
#: gradient is "per metre" with no numerator unit - stated rather than
#: invented.
GRADIENT_UNITS: dict[str, str] = {
    "temp": "degrees Celsius per metre (ITS-90)",
    "psal": "practical salinity units per metre (PSS-78, dimensionless)",
}

VALUE_UNITS: dict[str, str] = {
    "temp": "degree_Celsius",
    "psal": "PSS-78 (dimensionless)",
}

#: Why a pair of adjacent levels produced no gradient.
BREAK_REASONS: dict[str, str] = {
    "missing_value": (
        "One or both levels have no accepted value for this variable, so the "
        "interval is left open rather than bridged."
    ),
    "gap_exceeds_policy": (
        "The two levels are further apart in depth than the configured "
        "maximum-gap policy allows."
    ),
    "conflicting_duplicate_depth": (
        "Two levels report the same depth with different values for this "
        "variable, so neither can be used as an endpoint."
    ),
    "unusable_depth": "A level has no finite depth.",
}

DERIVATION_NOTE = (
    "Derived quantity: a finite difference between two adjacent measured "
    "levels. The midpoint depth is the arithmetic centre of the two sampled "
    "depths, not a depth that was sampled."
)

COOLING_LABEL = "Strongest cooling interval in this result."

COOLING_CAVEAT = (
    "This is the steepest decrease in temperature with depth among the "
    "intervals in this result. Sampling spacing, measurement noise and the "
    "requested depth range all affect which interval is steepest. It is not a "
    "detected thermocline, mixed-layer depth, anomaly or marine heatwave."
)


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(float(value))


def _collapse_duplicates(
    pairs: list[tuple[float, Optional[float]]],
) -> tuple[list[tuple[float, Optional[float]]], list[dict]]:
    """One sample per depth, with conflicting duplicates excluded.

    A depth carrying several rows is usable only when its accepted values
    agree. Rows without a value do not veto a sibling that has one; two
    different values do, because there is no basis for choosing between them.
    """
    samples: list[tuple[float, Optional[float]]] = []
    breaks: list[dict] = []
    position = 0
    while position < len(pairs):
        depth = pairs[position][0]
        run = [pairs[position]]
        position += 1
        while position < len(pairs) and pairs[position][0] == depth:
            run.append(pairs[position])
            position += 1

        distinct = sorted({float(value) for _, value in run if _finite(value)})
        if len(distinct) > 1:
            breaks.append({
                "reason": "conflicting_duplicate_depth",
                "message": BREAK_REASONS["conflicting_duplicate_depth"],
                "depth_m": depth,
                "values": distinct,
            })
            continue
        samples.append((depth, distinct[0] if distinct else None))
    return samples, breaks


def profile_gradients(
    depths: Sequence[float],
    values: Sequence[Optional[float]],
    variable: str,
    *,
    max_gap_m: float = DEFAULT_MAX_GAP_M,
    profile_id: Optional[str] = None,
) -> dict:
    """Gradients between consecutive eligible levels of one profile.

    ``depths`` and ``values`` are the levels the executed plan already
    selected: its depth range, variables and QC/data-mode policy have been
    applied upstream, so a rejected level arrives here as ``None`` and is
    preserved as a break.
    """
    if len(depths) != len(values):
        raise ValueError("depths and values must be the same length")

    pairs: list[tuple[float, Optional[float]]] = []
    breaks: list[dict] = []
    for depth, value in zip(depths, values):
        if not _finite(depth):
            breaks.append({
                "reason": "unusable_depth",
                "message": BREAK_REASONS["unusable_depth"],
                "depth_m": None,
            })
            continue
        pairs.append((float(depth), float(value) if _finite(value) else None))

    # Sorting is stable, so rows recorded at one depth keep their input order.
    pairs.sort(key=lambda item: item[0])
    samples, duplicate_breaks = _collapse_duplicates(pairs)
    breaks.extend(duplicate_breaks)

    usable = [(depth, value) for depth, value in samples if value is not None]
    intervals: list[dict] = []

    for (upper_depth, upper_value), (lower_depth, lower_value) in zip(
            samples, samples[1:]):
        span = lower_depth - upper_depth
        if upper_value is None or lower_value is None:
            breaks.append({
                "reason": "missing_value",
                "message": BREAK_REASONS["missing_value"],
                "upper_depth_m": upper_depth,
                "lower_depth_m": lower_depth,
            })
            continue
        if span > max_gap_m:
            breaks.append({
                "reason": "gap_exceeds_policy",
                "message": BREAK_REASONS["gap_exceeds_policy"],
                "upper_depth_m": upper_depth,
                "lower_depth_m": lower_depth,
                "gap_m": span,
                "max_gap_m": max_gap_m,
            })
            continue
        if span <= 0:
            # Unreachable after sorting and collapsing; kept so a future change
            # cannot introduce a division by zero silently.
            continue

        delta = lower_value - upper_value
        intervals.append({
            "variable": variable,
            "profile_id": profile_id,
            "upper": {"depth_m": upper_depth, "value": upper_value},
            "lower": {"depth_m": lower_depth, "value": lower_value},
            "midpoint_depth_m": (upper_depth + lower_depth) / 2.0,
            "delta_depth_m": span,
            "delta_value": delta,
            "gradient": delta / span,
            "units": GRADIENT_UNITS[variable],
            "value_units": VALUE_UNITS[variable],
            "derived": True,
        })

    status = "ok"
    if len(usable) < 2:
        status = "insufficient_samples"
    elif not intervals:
        status = "no_eligible_intervals"

    return {
        "variable": variable,
        "profile_id": profile_id,
        "status": status,
        "intervals": intervals,
        "interval_count": len(intervals),
        "breaks": breaks,
        "break_count": len(breaks),
        "accepted_sample_count": len(usable),
        "units": GRADIENT_UNITS[variable],
        "max_gap_m": max_gap_m,
        "max_gap_policy": (
            f"Adjacent levels more than {max_gap_m:g} m apart are reported as "
            "breaks rather than gradients. This is an application policy "
            "reused from the climatology matching limit "
            "(FLOATCHAT_MAX_GAP_M); it is not a published oceanographic "
            "threshold."
        ),
        "derivation": DERIVATION_NOTE,
        "method": (
            "First difference between adjacent accepted levels: "
            "(value_lower - value_upper) / (depth_lower - depth_upper). "
            "Depth is metres positive down, so a value falling with depth "
            "gives a negative gradient. No smoothing, fitting, interpolation "
            "or extrapolation is applied."
        ),
        "derived": True,
    }


def strongest_cooling(intervals: Iterable[dict]) -> Optional[dict]:
    """The steepest decrease in temperature with depth, or ``None``.

    "Cooling" here means only that temperature falls as depth increases over
    one interval. It is deliberately not called a thermocline: see
    :data:`COOLING_CAVEAT`.
    """
    cooling = [interval for interval in intervals
               if interval["variable"] == "temp" and interval["gradient"] < 0]
    if not cooling:
        return None
    # Ties resolve to the shallower interval, so the answer is deterministic.
    best = min(cooling, key=lambda i: (i["gradient"], i["upper"]["depth_m"]))
    return {
        "label": COOLING_LABEL,
        "caveat": COOLING_CAVEAT,
        "interval": best,
    }


def gradient_report(
    depths: Sequence[float],
    values_by_variable: dict[str, Sequence[Optional[float]]],
    *,
    max_gap_m: float = DEFAULT_MAX_GAP_M,
    profile_id: Optional[str] = None,
) -> dict:
    """Per-variable gradients for one profile, plus the cooling interpretation.

    Variables are independent: absent salinity never suppresses temperature.
    """
    variables = {
        name: profile_gradients(depths, series, name, max_gap_m=max_gap_m,
                                profile_id=profile_id)
        for name, series in values_by_variable.items()
    }
    temperature = variables.get("temp")
    cooling = strongest_cooling(temperature["intervals"]) if temperature else None
    report = {
        "profile_id": profile_id,
        "variables": variables,
        "strongest_cooling": cooling,
        "derived": True,
    }
    if temperature is not None and cooling is None:
        report["cooling_note"] = (
            "No interval in this profile shows temperature falling with depth "
            "under the current depth range and gap policy."
        )
    return report
