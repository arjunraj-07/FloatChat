"""Deterministic scientific core for FloatChat.

Every numerical result presented by the API comes from this package. The LLM
layer interprets questions and explains results; it never produces values.

This package is imported by both the ingestion script
(scripts/data_feasibility/process_argo_data.py) and the FastAPI service
(api/main.py) so that the behaviour under test is the behaviour in production.
"""

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
