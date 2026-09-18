"""A bounded, per-profile thermocline estimate from temperature gradients.

Method, and why this one
------------------------

NOAA describes the thermocline as "the transition layer between warmer mixed
water at the ocean's surface and cooler deep water below", in which temperature
"decreases rapidly" with depth
(https://oceanservice.noaa.gov/facts/thermocline.html).

Romero et al. (2023), *Improving the thermocline calculation over the global
ocean*, Ocean Sci. 19, 887-901, https://doi.org/10.5194/os-19-887-2023, record
that "the thermocline depth is often defined as the depth of the maximum
vertical temperature gradient", attributing that formulation to Fiedler (2010).
Their Section 1 also surveys methods for locating the maximum thermocline
depth, including "using a matrix to calculate the temperature gradient strength
of each point and filtering those points that meet the thermocline standard
(>0.2 °C m⁻¹) (Jiang et al., 2017)".

This module implements the *maximum-gradient* definition only, over the
intervals the existing gradient engine already accepted. It deliberately does
**not** implement the sigmoid/N²_T method Romero et al. propose: that fits a
function over the full water column to about 2 km and uses density and
conservative temperature. This deployment holds a 0-500 m extract with sparse
salinity, so that method's assumptions are not met here. Saying so is part of
the result.

What is returned, and what it is not
------------------------------------

The candidate is the strongest *eligible cooling* interval. Its endpoint depths
and temperatures are recorded measurements. The representative depth is the
interval **midpoint**, which is an estimate, not a measurement, and is labelled
so. The endpoints are not called the thermocline's top and bottom: a first
difference between two levels locates where the profile steepens, not the
boundaries of a layer.

Thresholds, and what the cited criterion does and does not license
-----------------------------------------------------------------

A published **>0.2 °C m⁻¹** thermocline criterion does exist, and our value
coincides with it. Romero et al. (2023), Section 1, attribute it to Jiang et
al. (2017), who compute "the temperature gradient strength of each point"
with a matrix method and filter the points that meet that standard.

*Audit history, kept because both errors are instructive.* This file first
called 0.2 a published standard and left it there, which overstated the
support. It was then "corrected" to say no such criterion exists anywhere in
the paper - that was **wrong**: it rested on two summarised readings that
both missed the sentence quoted above, rather than on the primary text. The
sentence is in Section 1. Trusting a summary over the source is what produced
the second error.

What the citation does **not** establish is applicability here. Jiang et al.
threshold a gradient-strength field computed per point by their own method at
their own vertical resolution. This module thresholds something narrower: the
**first difference between two adjacent accepted Argo levels**, whose
magnitude depends on that profile's sampling spacing. Whether 0.2 °C m⁻¹
transfers to that quantity has **not** been established, by us or by anyone
cited. So the number stays an **application policy** of this prototype - a
policy that happens to coincide with a published figure, which is weaker than
a policy derived from one.

Three quantities are easy to conflate, so they are kept apart here:

* a **temperature difference** (°C) between a level and a reference level -
  for example the 0.2 °C from 10 m that de Boyer Montégut et al. (2004) use
  for mixed-layer depth. Numerically 0.2, dimensionally not a gradient, and a
  different question. It is not the source of our threshold;
* a **local interval gradient** (°C m⁻¹), the first difference between two
  adjacent accepted levels - what this module thresholds;
* a **layer-average gradient** (°C m⁻¹), a temperature drop divided by the
  thickness of an identified layer - the usual sense of "thermocline
  strength". It needs layer boundaries, which this module does not determine.

Every other number here - support, prominence, contiguity, ambiguity - has no
cited source at all and is likewise an application policy, chosen to refuse
thin evidence rather than to flatter this snapshot, and reported with every
result. **None of them, including the 0.2, has been validated for this
estimator or this dataset.**

Only cooling with depth is considered. Temperature inversions - warming with
depth, common beneath barrier layers and at high latitudes - are real structure,
but an absolute gradient would let a warming interval be reported as a
thermocline. Those profiles are reported as having no qualifying candidate,
with the reason given.
"""

from __future__ import annotations

from statistics import median
from typing import Optional

METHOD = "strongest-eligible-cooling-interval"
METHOD_VERSION = "1.0"

#: An application policy of this prototype that coincides with the >0.2 °C m⁻¹
#: thermocline standard Romero et al. (2023) attribute to Jiang et al. (2017).
#: They filter a per-point gradient-strength field computed by their own
#: method; we apply it to the first difference between two adjacent accepted
#: levels, and that transfer is unvalidated (see the module docstring).
MIN_GRADIENT_C_PER_M = 0.2

#: Application thresholds for this prototype, on the same footing as the one
#: above.
MIN_ACCEPTED_SAMPLES = 5
MIN_ELIGIBLE_INTERVALS = 3
#: The candidate must stand out from the profile's ordinary cooling, or a
#: uniformly sloping profile would always yield a "thermocline".
MIN_PROMINENCE_RATIO = 2.0
#: A single sharp interval with no cooling either side is treated as local
#: structure, not a transition layer.
MIN_CONTIGUOUS_COOLING = 2
#: A rival within this fraction of the best magnitude makes the answer
#: ambiguous rather than decisive.
AMBIGUITY_RATIO = 0.9

POLICY_NOTE = (
    "The minimum gradient of 0.2 degrees Celsius per metre is an application "
    "policy of this prototype. It coincides with the thermocline standard of "
    "greater than 0.2 degrees Celsius per metre that Romero et al. (2023) "
    "attribute to Jiang et al. (2017), who filter a per-point gradient "
    "strength computed by their own method. Here it is applied to the first "
    "difference between two adjacent accepted levels, a local interval "
    "gradient whose magnitude depends on sampling spacing, and that transfer "
    "has not been validated for this estimator or this dataset. It is not the "
    "0.2 degrees Celsius temperature difference used to define a mixed-layer "
    "depth, which is a different quantity. The support, prominence, "
    "contiguity and ambiguity settings have no cited source and are "
    "application policies too. The definition of thermocline depth as the "
    "depth of the maximum vertical temperature gradient is taken from the "
    "literature (Fiedler 2010, as recorded by Romero et al. 2023)."
)


MIDPOINT_NOTE = (
    "The estimated depth is the midpoint of the supporting interval. It is a "
    "derived value, not a measurement, and the interval endpoints are not the "
    "top and bottom of the thermocline."
)

RANGE_NOTE = (
    "The estimate describes only the depth range this query analysed. A "
    "structure outside that range cannot be seen here."
)

#: Appended to every refusal, so no phrasing of it can be read as proof that
#: the ocean has no thermocline here.
NOT_ABSENCE = (
    " This is a statement about this method and this depth range; it is not "
    "evidence that no thermocline exists here."
)

def _refusal(text: str) -> str:
    """A refusal reason, always carrying the not-absence disclaimer."""
    return text.rstrip() + NOT_ABSENCE


STATUS_REASONS = {
    "not_applicable": "Temperature was not analysed, so no thermocline estimate is possible.",
    # Distinct from ``no_qualifying_candidate``: there, the evidence was
    # enough to judge and nothing met the criteria. Both carry the
    # not-absence disclaimer, because neither is evidence about the ocean.
    "insufficient_evidence": _refusal(
        "Too few accepted levels or eligible intervals in the analysed range to "
        "judge whether a transition layer is present."
    ),
    "no_qualifying_candidate": (
        "Eligible intervals exist, but none met this method's criteria. That is "
        "a statement about this method and this depth range, not evidence that "
        "the ocean has no thermocline here."
    ),
}


def _cooling(intervals) -> list:
    return [i for i in intervals
            if i.get("variable") == "temp" and isinstance(i.get("gradient"), (int, float))
            and i["gradient"] < 0]


def _contiguous_run(cooling_sorted, index) -> int:
    """How many cooling intervals sit consecutively around ``index``.

    Consecutive means the intervals touch: one's lower endpoint is the next
    one's upper endpoint. Nothing is bridged across a break.
    """
    run = 1
    for step in (-1, 1):
        position = index + step
        anchor = cooling_sorted[index]
        while 0 <= position < len(cooling_sorted):
            candidate = cooling_sorted[position]
            previous = cooling_sorted[position - step]
            if step == 1:
                touches = abs(candidate["upper"]["depth_m"] - previous["lower"]["depth_m"]) < 1e-9
            else:
                touches = abs(candidate["lower"]["depth_m"] - previous["upper"]["depth_m"]) < 1e-9
            if not touches:
                break
            run += 1
            position += step
        del anchor
    return run


def estimate(series: Optional[dict], *, analysed_range_m=None) -> dict:
    """A thermocline estimate for one profile's temperature gradients.

    ``series`` is the temperature entry of a gradient report. Everything here
    reads intervals that engine already accepted, so QC, raw/adjusted
    selection, depth conversion and the maximum-gap policy are inherited rather
    than re-implemented.
    """
    base = {
        "method": METHOD,
        "method_version": METHOD_VERSION,
        "policy": {
            "min_gradient_c_per_m": MIN_GRADIENT_C_PER_M,
            "min_accepted_samples": MIN_ACCEPTED_SAMPLES,
            "min_eligible_intervals": MIN_ELIGIBLE_INTERVALS,
            "min_prominence_ratio": MIN_PROMINENCE_RATIO,
            "min_contiguous_cooling": MIN_CONTIGUOUS_COOLING,
            "ambiguity_ratio": AMBIGUITY_RATIO,
            "note": POLICY_NOTE,
        },
        "analysed_depth_range_m": list(analysed_range_m) if analysed_range_m else None,
        "range_note": RANGE_NOTE,
        "candidate": None,
        "derived": True,
    }

    if not series or series.get("variable") != "temp":
        return {**base, "status": "not_applicable",
                "reason": STATUS_REASONS["not_applicable"]}

    intervals = series.get("intervals") or []
    accepted = int(series.get("accepted_sample_count") or 0)
    if accepted < MIN_ACCEPTED_SAMPLES or len(intervals) < MIN_ELIGIBLE_INTERVALS:
        return {**base, "status": "insufficient_evidence",
                "reason": STATUS_REASONS["insufficient_evidence"],
                "accepted_sample_count": accepted,
                "eligible_interval_count": len(intervals)}

    cooling = _cooling(intervals)
    if not cooling:
        return {**base, "status": "no_qualifying_candidate",
                "reason": _refusal(
                    "No interval cools with depth in the analysed range. A "
                    "profile that warms with depth may hold a real inversion, "
                    "which this cooling-only method does not describe."
                ),
                "eligible_interval_count": len(intervals)}

    cooling_sorted = sorted(cooling, key=lambda i: i["upper"]["depth_m"])
    magnitudes = [abs(i["gradient"]) for i in cooling_sorted]
    strongest = max(magnitudes)
    # Ties and near-ties resolve to the shallower interval, so the answer is
    # deterministic for the same input.
    best_index = min(
        (i for i, m in enumerate(magnitudes) if m == strongest),
        key=lambda i: cooling_sorted[i]["upper"]["depth_m"],
    )
    best = cooling_sorted[best_index]

    if strongest < MIN_GRADIENT_C_PER_M:
        return {**base, "status": "no_qualifying_candidate",
                "reason": _refusal(
                    f"The strongest cooling is {strongest:.3f} degrees Celsius "
                    f"per metre, below this prototype's application policy "
                    f"of {MIN_GRADIENT_C_PER_M}, so the profile varies too "
                    "weakly to call a transition layer."
                ),
                "strongest_cooling_c_per_m": -strongest,
                "eligible_interval_count": len(intervals)}

    others = [m for index, m in enumerate(magnitudes) if index != best_index]
    typical = median(others) if others else 0.0
    if typical > 0 and strongest < typical * MIN_PROMINENCE_RATIO:
        return {**base, "status": "no_qualifying_candidate",
                "reason": _refusal(
                    "The steepest interval is not distinct enough from the rest "
                    "of the profile, which is closer to a uniform slope than to "
                    "a transition layer."
                ),
                "strongest_cooling_c_per_m": -strongest,
                "typical_cooling_c_per_m": -typical,
                "eligible_interval_count": len(intervals)}

    run = _contiguous_run(cooling_sorted, best_index)
    if run < MIN_CONTIGUOUS_COOLING:
        return {**base, "status": "no_qualifying_candidate",
                "reason": _refusal(
                    "The steepest interval stands alone, with no adjoining "
                    "cooling level, so it reads as local structure rather than "
                    "a transition layer."
                ),
                "strongest_cooling_c_per_m": -strongest,
                "contiguous_cooling_intervals": run,
                "eligible_interval_count": len(intervals)}

    rivals = [
        {"upper_depth_m": i["upper"]["depth_m"], "lower_depth_m": i["lower"]["depth_m"],
         "gradient_c_per_m": i["gradient"]}
        for index, i in enumerate(cooling_sorted)
        if index != best_index and abs(i["gradient"]) >= strongest * AMBIGUITY_RATIO
    ]

    upper, lower = best["upper"], best["lower"]
    midpoint = (upper["depth_m"] + lower["depth_m"]) / 2.0
    at_boundary = None
    if analysed_range_m:
        low, high = float(analysed_range_m[0]), float(analysed_range_m[1])
        if abs(upper["depth_m"] - low) < 1e-9 or abs(lower["depth_m"] - high) < 1e-9:
            at_boundary = (
                "The supporting interval touches the edge of the analysed "
                "range, so the structure may continue beyond it."
            )

    candidate = {
        "estimated_depth_m": midpoint,
        "estimated_depth_is_derived": True,
        "midpoint_note": MIDPOINT_NOTE,
        "gradient_c_per_m": best["gradient"],
        "units": best.get("units"),
        "value_units": best.get("value_units"),
        "supporting_interval": {
            "upper": {"depth_m": upper["depth_m"], "value": upper["value"]},
            "lower": {"depth_m": lower["depth_m"], "value": lower["value"]},
            "measured": True,
        },
        "temperature_drop_c": upper["value"] - lower["value"],
        "contiguous_cooling_intervals": run,
        "prominence_ratio": (strongest / typical) if typical > 0 else None,
        "at_analysed_boundary": at_boundary,
    }

    status = "ambiguous" if rivals else "estimated"
    reason = (
        "Another interval is nearly as steep, so the depth of the strongest "
        "cooling is not decided by this method."
        if rivals else
        "The strongest eligible cooling interval met every criterion of this "
        "method within the analysed range."
    )
    return {**base, "status": status, "reason": reason, "candidate": candidate,
            "competing_candidates": rivals,
            "eligible_interval_count": len(intervals),
            "accepted_sample_count": accepted}
