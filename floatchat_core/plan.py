"""Typed query-plan schema for FloatChat.

A *plan* is a structured exploration request: where, when, how deep, which
variables, under which QC policy, and which analyses and outputs are wanted.
This module defines the request and response contract and the registry of
capabilities that actually exist in production. It performs **no** data access
and executes nothing.

Conventions fixed here and relied on by the frontend contract:

* Coordinates are decimal degrees, WGS84. Latitude in [-90, 90], longitude in
  [-180, 180].
* A bounding box is given as ``west``, ``east``, ``south``, ``north``. The box
  spans latitudes ``south`` -> ``north`` and longitudes ``west`` -> ``east``
  travelling **eastward**. ``south < north`` and ``west < east`` are required.
* Antimeridian-crossing boxes (``west > east``) are **not supported** in this
  schema version and are rejected explicitly, because the request is ambiguous
  between "crosses 180 degrees" and "the bounds were reversed", and the cached
  dataset does not span the antimeridian. See :data:`ERROR_CODES`.
* Depth is metres, positive down, consistent with the observation tables.
* Times are ISO-8601. A timezone-aware value is converted to UTC; a naive value
  is interpreted as UTC, matching the stored observation timestamps. A
  date-only end means the last instant of that UTC day. Timestamps proposed by
  the natural-language planner must carry an explicit offset instead (see
  :mod:`floatchat_core.nl_planner`).
* The date range and the depth range are **inclusive** at both ends.

Nothing here consults PROJECT_CONTEXT.md. Runtime availability is decided by
:mod:`floatchat_core.plan_validation` against the loaded tables.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

#: Version of the plan request/response contract. The frontend pins this.
PLAN_SCHEMA_VERSION = "1.0"

# Argo WMO platform numbers are 5-7 digits. Profile identifiers are built by
# the ingestion script as "<platform>_<cycle>_<direction>".
PLATFORM_PATTERN = r"^\d{5,7}$"
PROFILE_ID_PATTERN = r"^\d{5,7}_\d{1,4}_[AD]$"

PlatformId = Annotated[str, Field(pattern=PLATFORM_PATTERN)]
ProfileId = Annotated[str, Field(pattern=PROFILE_ID_PATTERN)]
Latitude = Annotated[float, Field(ge=-90.0, le=90.0)]
Longitude = Annotated[float, Field(ge=-180.0, le=180.0)]
DepthMetres = Annotated[float, Field(ge=0.0, le=11000.0)]


class Variable(str, Enum):
    """Observed variables the pipeline stores. Names follow Argo."""

    TEMP = "temp"
    PSAL = "psal"


class DataMode(str, Enum):
    R = "R"
    A = "A"
    D = "D"


class DepthMode(str, Enum):
    #: Select observations already recorded inside a depth window. This never
    #: interpolates, and a window starting at 0 m does not request
    #: extrapolation - it simply has no observations above the shallowest level.
    RANGE = "range"
    #: Interpolate each profile to one exact depth. Subject to the
    #: no-extrapolation and maximum-gap rules in floatchat_core.woa.
    AT_DEPTH = "at_depth"


class RegionKind(str, Enum):
    BBOX = "bbox"
    NAMED = "named"


class NamedRegion(str, Enum):
    """Registered named regions. Unknown names are rejected, not guessed."""

    ARABIAN_SEA = "arabian_sea"
    BAY_OF_BENGAL = "bay_of_bengal"
    EQUATORIAL_INDIAN_OCEAN = "equatorial_indian_ocean"
    ARGO_CACHED_SUBSET = "argo_cached_subset"


#: Documented bounds for each named region, in the bbox convention above.
NAMED_REGION_BOUNDS = {
    NamedRegion.ARABIAN_SEA: dict(west=50.0, east=75.0, south=5.0, north=25.0),
    NamedRegion.BAY_OF_BENGAL: dict(west=78.0, east=100.0, south=5.0, north=24.0),
    NamedRegion.EQUATORIAL_INDIAN_OCEAN: dict(
        west=40.0, east=100.0, south=-10.0, north=10.0
    ),
    # The exact extraction box of the cached ERDDAP subset.
    NamedRegion.ARGO_CACHED_SUBSET: dict(
        west=60.0, east=65.0, south=15.0, north=20.0
    ),
}


class Analysis(str, Enum):
    """Scientific operations a plan may request.

    Roadmap operators are listed so a request naming one gets a precise
    "not implemented" answer instead of an opaque schema error. Membership in
    this enum is **not** a claim that the operator exists; see
    :data:`ANALYSIS_CAPABILITIES`.
    """

    PROFILE_SUMMARY = "profile_summary"
    DEPTH_PROFILE = "depth_profile"
    WOA_CLIMATOLOGY_COMPARISON = "woa_climatology_comparison"
    TEMPERATURE_GRADIENT = "temperature_gradient"
    SALINITY_GRADIENT = "salinity_gradient"
    # Declared, not implemented.
    THERMOCLINE_ESTIMATION = "thermocline_estimation"
    MARINE_HEATWAVE_DETECTION = "marine_heatwave_detection"
    ANOMALY_SIGNIFICANCE_TEST = "anomaly_significance_test"
    FORECAST = "forecast"


class Output(str, Enum):
    """Visualization or presentation artefacts a plan may request.

    Kept separate from :class:`Analysis`: an output renders results, it does
    not compute them.
    """

    FLOAT_MAP = "float_map"
    DEPTH_PROFILE_CHART = "depth_profile_chart"
    COVERAGE_SUMMARY = "coverage_summary"
    EVIDENCE_PANEL = "evidence_panel"
    # Declared, not implemented.
    GLOBE_WEBGL = "globe_webgl"
    TIME_ANIMATION = "time_animation"
    COMPARISON_VIEW = "comparison_view"
    OCEAN_STORY = "ocean_story"


class Capability(BaseModel):
    """Whether a declared operator or output has a production implementation."""

    model_config = ConfigDict(extra="forbid")

    implemented: bool
    description: str
    #: Where the implementation lives, when there is one.
    provided_by: Optional[str] = None
    #: Why it is unavailable, when it is not implemented.
    unavailable_reason: Optional[str] = None


ANALYSIS_CAPABILITIES: dict[Analysis, Capability] = {
    Analysis.PROFILE_SUMMARY: Capability(
        implemented=True,
        description="Per-profile metadata, level counts and QC exclusions.",
        provided_by="GET /api/profiles/{profile_id}",
    ),
    Analysis.DEPTH_PROFILE: Capability(
        implemented=True,
        description="Temperature and salinity against depth for a profile.",
        provided_by="GET /api/profiles/{profile_id}",
    ),
    Analysis.WOA_CLIMATOLOGY_COMPARISON: Capability(
        implemented=True,
        description=(
            "Difference against the WOA23 decav91C0 1991-2020 monthly mean at "
            "matchable reference depths."
        ),
        provided_by="GET /api/woa_match/{profile_id}",
    ),
    Analysis.TEMPERATURE_GRADIENT: Capability(
        implemented=True,
        description=(
            "Vertical temperature gradient between adjacent accepted levels of "
            "one profile, with the strongest cooling interval identified."
        ),
        provided_by="floatchat_core.gradients.gradient_report",
    ),
    Analysis.SALINITY_GRADIENT: Capability(
        implemented=True,
        description=(
            "Vertical practical-salinity gradient between adjacent accepted "
            "levels of one profile. Salinity is absent from most cached "
            "levels, so many intervals are reported as breaks rather than "
            "bridged."
        ),
        provided_by="floatchat_core.gradients.gradient_report",
    ),
    Analysis.THERMOCLINE_ESTIMATION: Capability(
        implemented=True,
        description=(
            "Per-profile thermocline estimate: the strongest eligible cooling "
            "interval in the analysed depth range, with the interval midpoint "
            "as an estimated depth. Requires temperature."
        ),
        provided_by="floatchat_core.thermocline.estimate",
    ),
    Analysis.MARINE_HEATWAVE_DETECTION: Capability(
        implemented=False,
        description="Surface marine-heatwave events linked to subsurface Argo.",
        unavailable_reason=(
            "Requires a daily SST series and a documented historical "
            "90th-percentile baseline. Neither is available; a daily mean "
            "seasonal cycle cannot supply a percentile threshold."
        ),
    ),
    Analysis.ANOMALY_SIGNIFICANCE_TEST: Capability(
        implemented=False,
        description="Statistical significance of a difference from a baseline.",
        unavailable_reason=(
            "No production implementation exists. A difference from a "
            "climatological mean is not a significance test."
        ),
    ),
    Analysis.FORECAST: Capability(
        implemented=False,
        description="Prediction of future ocean state.",
        unavailable_reason="Out of scope; no forecasting model exists.",
    ),
}

OUTPUT_CAPABILITIES: dict[Output, Capability] = {
    Output.FLOAT_MAP: Capability(
        implemented=True,
        description="Interim Leaflet map of float and profile positions.",
        provided_by="frontend/src/components/Map.tsx",
    ),
    Output.DEPTH_PROFILE_CHART: Capability(
        implemented=True,
        description="Plotly depth profile with reversed depth axis.",
        provided_by="frontend/src/components/ProfileChart.tsx",
    ),
    Output.COVERAGE_SUMMARY: Capability(
        implemented=True,
        description="Dataset coverage, counts and provenance.",
        provided_by="GET /api/coverage",
    ),
    Output.EVIDENCE_PANEL: Capability(
        implemented=True,
        description="QC, provenance, exclusions and stated limitations.",
        provided_by="frontend/src/components/Explorer.tsx",
    ),
    Output.GLOBE_WEBGL: Capability(
        implemented=False,
        description="True-globe WebGL view.",
        unavailable_reason=(
            "Product requirement, not yet built. The Leaflet map is the "
            "accepted interim component."
        ),
    ),
    Output.TIME_ANIMATION: Capability(
        implemented=False,
        description="Animated time navigation across profiles.",
        unavailable_reason="No production implementation exists.",
    ),
    Output.COMPARISON_VIEW: Capability(
        implemented=False,
        description="Compare periods, regions or depths side by side.",
        unavailable_reason="Compare Mode is not implemented.",
    ),
    Output.OCEAN_STORY: Capability(
        implemented=False,
        description="Narrative summary of computed temporal results.",
        unavailable_reason="Ocean Story is not implemented.",
    ),
}


class Outcome(str, Enum):
    """The five validation outcomes, kept distinct on purpose."""

    #: Schema or semantic violation. The plan cannot be executed as written.
    INVALID = "invalid"
    #: Well formed, but names an operator or output with no implementation.
    UNSUPPORTED = "unsupported"
    #: Well formed and supported, but nothing in the dataset matches.
    VALID_NO_DATA = "valid_no_data"
    #: Well formed, supported, matching data exists but not for the whole
    #: requested extent or not for every requested variable.
    VALID_PARTIAL_COVERAGE = "valid_partial_coverage"
    #: Well formed, supported, and fully covered by matching data.
    VALID = "valid"


#: Stable machine-readable error codes. Clients switch on these, not messages.
ERROR_CODES = {
    # Request-level
    "malformed_json": "The request body is not valid JSON.",
    "body_not_object": "The request body must be a JSON object.",
    "schema_violation": "A field failed schema validation.",
    "unknown_field": "The request contains a field not defined in this schema.",
    "unsupported_enum_value": "A field holds a value outside its allowed set.",
    "unsupported_schema_version": "schema_version is not supported.",
    # Semantic
    "reversed_date_range": "start is later than end.",
    "reversed_depth_range": "min_m is greater than max_m.",
    "invalid_bounding_box": "south is not less than north.",
    "antimeridian_not_supported": (
        "west is greater than or equal to east. An antimeridian-crossing box "
        "is not supported in this schema version; split the request into two "
        "boxes that each stay within [-180, 180] travelling eastward."
    ),
    "non_finite_number": "A numeric field is NaN or infinite.",
    "malformed_identifier": "A float or profile identifier is malformed.",
    "depth_mode_mismatch": "The depth fields do not match the selected mode.",
    "empty_variable_list": "At least one variable must be requested.",
    # Reference integrity
    "unknown_platform": (
        "A requested float could not be resolved in the loaded dataset."
    ),
    "unknown_profile": (
        "A requested profile could not be resolved in the loaded dataset."
    ),
    "profile_platform_mismatch": (
        "A requested profile does not belong to any requested float."
    ),
    # Capability
    "unsupported_analysis": "The requested analysis has no implementation.",
    "unsupported_output": "The requested output has no implementation.",
    "qc_policy_not_applicable": (
        "The requested QC or data-mode policy cannot be applied to the stored "
        "data."
    ),
}

#: Warning codes. Warnings never change a plan; they describe its coverage.
WARNING_CODES = {
    "partial_time_coverage": "Matching data covers only part of the date range.",
    "partial_depth_coverage": "Matching data covers only part of the depth range.",
    "outside_configured_search_region": (
        "Part of the requested region lies outside the area the archive was "
        "extracted for, so no data was ever retrieved there."
    ),
    "spatial_sampling_is_pointwise": (
        "Matching data comes from discrete profile positions, not an area "
        "survey. A bounding box of sample points is not a coverage footprint."
    ),
    "default_policy_applied": (
        "No qc_policy was supplied; the effective default is reported."
    ),
    "qc_metadata_incomplete": (
        "Some stored levels carry no QC flag for a requested variable, so "
        "compliance cannot be evidenced for them either way."
    ),
    "variable_unavailable": "A requested variable has no valid values.",
    "variable_partial": "A requested variable is valid on only some levels.",
    "sparse_vertical_sampling": "Observed levels are discrete, not continuous.",
    "data_mode_absent": "A requested data mode is not present in the dataset.",
    "reference_data_uncached": "A requested analysis needs uncached reference data.",
    "no_matching_observations": "No observation matched the requested constraints.",
    "interpolation_not_possible": (
        "The requested exact depth cannot be reached in some profiles without "
        "extrapolating or bridging an oversized gap."
    ),
}


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------

class StrictModel(BaseModel):
    """Base: unknown fields are rejected and NaN/Infinity are never accepted."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class TimeRange(StrictModel):
    start: datetime
    end: datetime

    @field_validator("end", mode="before")
    @classmethod
    def _date_only_end_is_end_of_day(cls, value):
        """A date-only end covers that whole UTC day, so "through 30 June"
        includes 30 June rather than stopping at its first instant."""
        if isinstance(value, str) and _DATE_ONLY.match(value.strip()):
            return f"{value.strip()}T23:59:59.999999+00:00"
        return value

    @model_validator(mode="after")
    def _check_order(self):
        if to_utc(self.start) > to_utc(self.end):
            raise ValueError(
                "start must not be later than end "
                f"(start={self.start.isoformat()}, end={self.end.isoformat()})"
            )
        return self


class Region(StrictModel):
    """Either an explicit bounding box or a registered named region."""

    kind: RegionKind
    west: Optional[Longitude] = None
    east: Optional[Longitude] = None
    south: Optional[Latitude] = None
    north: Optional[Latitude] = None
    name: Optional[NamedRegion] = None

    @model_validator(mode="after")
    def _check_shape(self):
        bbox_fields = (self.west, self.east, self.south, self.north)
        if self.kind is RegionKind.BBOX:
            if self.name is not None:
                raise ValueError("name must be omitted when kind is 'bbox'")
            if any(v is None for v in bbox_fields):
                raise ValueError(
                    "kind 'bbox' requires west, east, south and north"
                )
            if self.south >= self.north:
                raise ValueError(
                    f"south ({self.south}) must be less than north ({self.north})"
                )
            if self.west >= self.east:
                raise ValueError(ERROR_CODES["antimeridian_not_supported"])
        else:
            if self.name is None:
                raise ValueError("kind 'named' requires name")
            if any(v is not None for v in bbox_fields):
                raise ValueError(
                    "west, east, south and north must be omitted when kind is "
                    "'named'"
                )
        return self

    def bounds(self) -> dict:
        """Resolved bounding box. Named regions expand to documented bounds."""
        if self.kind is RegionKind.NAMED:
            return dict(NAMED_REGION_BOUNDS[self.name])
        return dict(west=self.west, east=self.east,
                    south=self.south, north=self.north)


class DepthSelection(StrictModel):
    """A depth window, or one exact depth to interpolate to.

    ``range`` selects observations already recorded between ``min_m`` and
    ``max_m`` inclusive. It never interpolates and never extrapolates; a window
    beginning at 0 m is ordinary, not a request for extrapolation.

    ``at_depth`` asks for a value at ``target_m`` in each profile, which
    requires an exact observed level or interpolation between two bracketing
    levels.
    """

    mode: DepthMode = DepthMode.RANGE
    min_m: Optional[DepthMetres] = None
    max_m: Optional[DepthMetres] = None
    target_m: Optional[DepthMetres] = None

    @model_validator(mode="after")
    def _check_shape(self):
        if self.mode is DepthMode.RANGE:
            if self.target_m is not None:
                raise ValueError("target_m is only valid when mode is 'at_depth'")
            if self.min_m is None or self.max_m is None:
                raise ValueError("mode 'range' requires min_m and max_m")
            if self.min_m > self.max_m:
                raise ValueError(
                    f"min_m ({self.min_m}) must not be greater than max_m "
                    f"({self.max_m})"
                )
        else:
            if self.min_m is not None or self.max_m is not None:
                raise ValueError(
                    "min_m and max_m are only valid when mode is 'range'"
                )
            if self.target_m is None:
                raise ValueError("mode 'at_depth' requires target_m")
        return self


class Selection(StrictModel):
    """Optional restriction to particular floats and/or profiles."""

    platforms: list[PlatformId] = Field(default_factory=list)
    profile_ids: list[ProfileId] = Field(default_factory=list)


class QcPolicy(StrictModel):
    """The QC and data-mode policy the caller wants applied.

    ``accepted_qc_flags`` is stated explicitly rather than assumed, so a
    request that the stored tables cannot satisfy is rejected instead of being
    silently reinterpreted.
    """

    accepted_qc_flags: list[Annotated[int, Field(ge=0, le=9)]] = Field(
        default_factory=lambda: [1]
    )
    data_modes: list[DataMode] = Field(
        default_factory=lambda: [DataMode.R, DataMode.A, DataMode.D]
    )

    @model_validator(mode="after")
    def _check_non_empty(self):
        if not self.accepted_qc_flags:
            raise ValueError("accepted_qc_flags must not be empty")
        if not self.data_modes:
            raise ValueError("data_modes must not be empty")
        return self


class QueryPlanRequest(StrictModel):
    """A complete, structured exploration request."""

    schema_version: Literal["1.0"]
    time: TimeRange
    region: Region
    depth: DepthSelection
    variables: list[Variable] = Field(min_length=1)
    qc_policy: QcPolicy = Field(default_factory=QcPolicy)
    selection: Selection = Field(default_factory=Selection)
    analyses: list[Analysis] = Field(default_factory=list)
    outputs: list[Output] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Response models
# --------------------------------------------------------------------------

class Issue(BaseModel):
    """A structured error or warning. ``field`` is a dotted JSON path."""

    model_config = ConfigDict(extra="forbid")

    code: str
    field: Optional[str] = None
    message: str


def to_utc(value: datetime) -> datetime:
    """Naive values are treated as UTC; aware values are converted to UTC.

    The result is naive UTC so it can be compared with the stored
    ``datetime64[ns]`` observation timestamps.
    """
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def normalize_plan(plan: QueryPlanRequest) -> dict:
    """Canonical form of a valid plan.

    The requested bounds are preserved exactly. Named regions are expanded to
    their documented bounds and times are normalised to UTC, but nothing is
    clipped to what the dataset happens to contain - coverage is reported
    separately.
    """
    region = plan.region.bounds()
    region["kind"] = plan.region.kind.value
    region["name"] = plan.region.name.value if plan.region.name else None

    depth: dict[str, Any] = {"mode": plan.depth.mode.value}
    if plan.depth.mode is DepthMode.RANGE:
        depth["min_m"] = plan.depth.min_m
        depth["max_m"] = plan.depth.max_m
        depth["interpolation_required"] = False
    else:
        depth["target_m"] = plan.depth.target_m
        depth["interpolation_required"] = True

    return {
        "schema_version": plan.schema_version,
        "time": {
            "start": to_utc(plan.time.start).isoformat() + "Z",
            "end": to_utc(plan.time.end).isoformat() + "Z",
            "inclusive": True,
        },
        "region": region,
        "depth": depth,
        "variables": [v.value for v in dict.fromkeys(plan.variables)],
        "qc_policy": {
            "accepted_qc_flags": sorted(set(plan.qc_policy.accepted_qc_flags)),
            "data_modes": [m.value for m in dict.fromkeys(plan.qc_policy.data_modes)],
        },
        "selection": {
            "platforms": list(dict.fromkeys(plan.selection.platforms)),
            "profile_ids": list(dict.fromkeys(plan.selection.profile_ids)),
        },
        "analyses": [a.value for a in dict.fromkeys(plan.analyses)],
        "outputs": [o.value for o in dict.fromkeys(plan.outputs)],
    }


def capability_report() -> dict:
    """Declared analyses and outputs with their implementation status."""
    return {
        "schema_version": PLAN_SCHEMA_VERSION,
        "analyses": {
            a.value: ANALYSIS_CAPABILITIES[a].model_dump() for a in Analysis
        },
        "outputs": {
            o.value: OUTPUT_CAPABILITIES[o].model_dump() for o in Output
        },
        "variables": [v.value for v in Variable],
        "data_modes": [m.value for m in DataMode],
        "named_regions": {
            r.value: NAMED_REGION_BOUNDS[r] for r in NamedRegion
        },
        "depth_modes": [m.value for m in DepthMode],
        "error_codes": dict(ERROR_CODES),
        "warning_codes": dict(WARNING_CODES),
    }


def pydantic_errors_to_issues(exc) -> list[Issue]:
    """Convert a :class:`pydantic.ValidationError` into structured issues."""
    issues: list[Issue] = []
    for err in exc.errors():
        location = ".".join(str(part) for part in err["loc"]) or None
        err_type = err.get("type", "")
        if err_type == "extra_forbidden":
            code = "unknown_field"
        elif err_type in ("finite_number", "float_parsing") and \
                "finite" in err.get("msg", "").lower():
            code = "non_finite_number"
        elif err_type == "string_pattern_mismatch":
            code = "malformed_identifier"
        elif location == "schema_version":
            code = "unsupported_schema_version"
        elif err_type in ("enum", "literal_error"):
            code = "unsupported_enum_value"
        else:
            code = _semantic_code(err.get("msg", "")) or "schema_violation"
        issues.append(Issue(code=code, field=location, message=err.get("msg", "")))
    return issues


def _semantic_code(message: str) -> Optional[str]:
    """Map a model_validator message onto a specific error code."""
    text = message.lower()
    if "antimeridian" in text:
        return "antimeridian_not_supported"
    if "start must not be later than end" in text:
        return "reversed_date_range"
    if "must not be greater than max_m" in text:
        return "reversed_depth_range"
    if "must be less than north" in text:
        return "invalid_bounding_box"
    if "nan" in text or "infinit" in text:
        return "non_finite_number"
    if re.search(r"mode '(range|at_depth)' requires|only valid when mode", text):
        return "depth_mode_mismatch"
    return None
