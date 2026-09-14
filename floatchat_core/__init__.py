"""Deterministic scientific core for FloatChat.

Every numerical result presented by the API comes from this package. The LLM
layer interprets questions and explains results; it never produces values.

This package is imported by both the ingestion script
(scripts/data_feasibility/process_argo_data.py) and the FastAPI service
(api/main.py) so that the behaviour under test is the behaviour in production.
"""

from .plan import (
    PLAN_SCHEMA_VERSION,
    Analysis,
    DataMode,
    DepthMode,
    NamedRegion,
    Outcome,
    Output,
    QueryPlanRequest,
    Variable,
    capability_report,
    normalize_plan,
)
from .plan_validation import DatasetIndex, status_for_outcome, validate_plan
from .qc import (
    ARGO_VARIABLE_DEFINITIONS,
    SUPPORTED_DATA_MODES,
    FieldSelection,
    UnsupportedDataModeError,
    depth_from_pressure,
    normalize_qc,
    select_field,
    source_field_for_mode,
)
from .woa import (
    DepthMatch,
    WOA_PRODUCT,
    json_safe,
    match_value_at_depth,
    matchable_reference_depths,
)

__all__ = [
    "PLAN_SCHEMA_VERSION",
    "Analysis",
    "DataMode",
    "DatasetIndex",
    "DepthMode",
    "NamedRegion",
    "Outcome",
    "Output",
    "QueryPlanRequest",
    "Variable",
    "capability_report",
    "normalize_plan",
    "status_for_outcome",
    "validate_plan",
    "ARGO_VARIABLE_DEFINITIONS",
    "SUPPORTED_DATA_MODES",
    "FieldSelection",
    "UnsupportedDataModeError",
    "depth_from_pressure",
    "normalize_qc",
    "select_field",
    "source_field_for_mode",
    "DepthMatch",
    "WOA_PRODUCT",
    "json_safe",
    "match_value_at_depth",
    "matchable_reference_depths",
]
