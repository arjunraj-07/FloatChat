"""Argo data-mode selection, QC filtering and depth conversion.

Scientific policy implemented here (see PROJECT_CONTEXT.md):

* Mode ``R``  -> raw value with the *raw* QC flag.
* Mode ``A``/``D`` -> adjusted value with the *adjusted* QC flag.
* Any other mode is rejected explicitly; it is never silently coerced to raw.
* Only QC flag 1 (good) is accepted for a value to be used.
* Temperature is retained when salinity is missing or fails QC; the salinity
  level is masked individually and carries its own exclusion reason.

Variable definitions follow the Argo reference tables and are not renamed:
``TEMP`` is in-situ temperature (ITS-90), ``PSAL`` is Practical Salinity
(PSS-78). No conversion to Conservative Temperature or Absolute Salinity is
performed anywhere in this package.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Mapping, Optional, Sequence

import numpy as np

try:  # gsw is required for depth conversion but not for QC helpers
    import gsw
except ImportError:  # pragma: no cover - exercised only when gsw is absent
    gsw = None


#: Argo data modes this project supports, per the Argo user manual.
#: R = real time, A = real time with adjustment, D = delayed mode.
SUPPORTED_DATA_MODES = ("R", "A", "D")

#: QC flags accepted as usable. Argo QC flag 1 = "good data".
ACCEPTED_QC_FLAGS = (1,)

#: Source variable definitions, preserved verbatim for provenance display.
ARGO_VARIABLE_DEFINITIONS = {
    "temp": {
        "argo_name": "TEMP",
        "long_name": "Sea temperature in-situ ITS-90 scale",
        "units": "degree_Celsius",
        "note": "In-situ temperature. Not Conservative Temperature.",
    },
    "psal": {
        "argo_name": "PSAL",
        "long_name": "Practical salinity",
        "units": "psu",
        "note": "Practical Salinity (PSS-78). Not Absolute Salinity.",
    },
    "pres": {
        "argo_name": "PRES",
        "long_name": "Sea water pressure, equals 0 at sea-level",
        "units": "decibar",
        "note": "Depth is derived as -gsw.z_from_p(pres, latitude).",
    },
}

#: Column name pattern for each variable in each selection branch.
_FIELD_NAMES = {
    "raw": {"value": "{v}", "qc": "{v}_qc", "error": None},
    "adjusted": {
        "value": "{v}_adjusted",
        "qc": "{v}_adjusted_qc",
        "error": "{v}_adjusted_error",
    },
}


class UnsupportedDataModeError(ValueError):
    """Raised when a record carries a data mode outside R/A/D."""


@dataclass(frozen=True)
class FieldSelection:
    """The outcome of selecting one variable from one Argo level.

    ``status`` is one of:

    ``ok``               value present and QC accepted
    ``missing_value``    the required source variable is absent (NaN)
    ``qc_rejected``      QC flag parsed but not in :data:`ACCEPTED_QC_FLAGS`
    ``qc_malformed``     QC flag could not be normalised to an integer
    """

    variable: str
    value: Optional[float]
    qc: Optional[int]
    source_field: str
    value_name: str
    qc_name: str
    error: Optional[float]
    status: str
    reason: Optional[str]

    @property
    def usable(self) -> bool:
        return self.status == "ok"

    def as_dict(self) -> dict:
        return asdict(self)


def normalize_qc(val: Any) -> Optional[int]:
    """Normalise an Argo QC flag to an ``int``, or ``None`` if malformed.

    Argo QC flags arrive as single-character bytes (``b'1'``), strings
    (``'1'``, ``' 1 '``), floats (``1.0``) or masked/NaN values depending on
    the reader. All valid encodings are accepted; malformed values such as
    ``''``, ``'X'``, ``1.5`` or non-finite numbers return ``None`` rather than
    being coerced to a usable flag.
    """
    if val is None:
        return None
    if isinstance(val, (bytes, bytearray)):
        try:
            val = val.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if isinstance(val, np.generic):
        val = val.item()
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        try:
            val = float(val)
        except ValueError:
            return None
    if isinstance(val, bool):
        # Guard against bool sneaking through as int; a boolean is not a flag.
        return None
    if isinstance(val, (int, float)):
        if not np.isfinite(val):
            return None
        if float(val) != int(val):
            # 1.5 is not a QC flag; refuse rather than truncate.
            return None
        return int(val)
    return None


def source_field_for_mode(data_mode: Any) -> str:
    """Map an Argo data mode to the field branch it must be read from.

    Raises :class:`UnsupportedDataModeError` for anything outside R/A/D,
    including ``None``, empty strings and NaN.
    """
    if data_mode is None:
        raise UnsupportedDataModeError("data_mode is missing")
    if isinstance(data_mode, (bytes, bytearray)):
        try:
            data_mode = data_mode.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise UnsupportedDataModeError("data_mode is not decodable") from exc
    if isinstance(data_mode, float) and not np.isfinite(data_mode):
        raise UnsupportedDataModeError("data_mode is missing")
    mode = str(data_mode).strip().upper()
    if mode not in SUPPORTED_DATA_MODES:
        raise UnsupportedDataModeError(
            f"unsupported data_mode {data_mode!r}; supported modes are "
            f"{', '.join(SUPPORTED_DATA_MODES)}"
        )
    return "raw" if mode == "R" else "adjusted"


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, (int, float)):
        return not np.isfinite(value)
    return False


def select_field(
    record: Mapping[str, Any],
    variable: str,
    data_mode: Any,
    accepted_qc: Sequence[int] = ACCEPTED_QC_FLAGS,
) -> FieldSelection:
    """Select ``variable`` from ``record`` according to ``data_mode``.

    The value and the QC flag always come from the *same* branch: raw value
    with raw QC, adjusted value with adjusted QC. The returned
    :class:`FieldSelection` records which source variable was read so the
    choice is visible downstream.

    Raises :class:`UnsupportedDataModeError` for unsupported modes, and
    ``KeyError`` when the required source column is absent from the record
    entirely (a schema problem, distinct from a missing measurement).
    """
    branch = source_field_for_mode(data_mode)
    names = _FIELD_NAMES[branch]
    value_name = names["value"].format(v=variable)
    qc_name = names["qc"].format(v=variable)
    error_name = names["error"].format(v=variable) if names["error"] else None

    if value_name not in record:
        raise KeyError(
            f"required field {value_name!r} is not available for data_mode "
            f"{data_mode!r}"
        )
    if qc_name not in record:
        raise KeyError(
            f"required QC field {qc_name!r} is not available for data_mode "
            f"{data_mode!r}"
        )

    raw_value = record[value_name]
    qc = normalize_qc(record[qc_name])
    error = record.get(error_name) if error_name else None
    if _is_missing(error):
        error = None
    else:
        error = float(error)

    def build(value, status, reason):
        return FieldSelection(
            variable=variable,
            value=value,
            qc=qc,
            source_field=branch,
            value_name=value_name,
            qc_name=qc_name,
            error=error,
            status=status,
            reason=reason,
        )

    if _is_missing(raw_value):
        return build(None, "missing_value", f"{value_name} is missing")
    value = float(raw_value)

    if qc is None:
        return build(
            None,
            "qc_malformed",
            f"{qc_name} value {record[qc_name]!r} is not a valid QC flag",
        )
    if qc not in tuple(accepted_qc):
        return build(
            None,
            "qc_rejected",
            f"{qc_name}={qc} not in accepted flags {tuple(accepted_qc)}",
        )
    return build(value, "ok", None)


def depth_from_pressure(pressure, latitude):
    """Positive-down depth in metres from pressure (dbar) and latitude.

    Implemented as ``-gsw.z_from_p(p, lat)`` per TEOS-10. Accepts scalars or
    array-likes and preserves shape.
    """
    if gsw is None:  # pragma: no cover
        raise ImportError("gsw is required for depth conversion")
    return -gsw.z_from_p(pressure, latitude)
