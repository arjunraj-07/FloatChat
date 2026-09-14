"""Depth matching against a documented reference climatology (WOA23).

Two concerns live here and are deliberately kept apart:

1. Pure, offline, deterministic depth matching
   (:func:`match_value_at_depth`, :func:`matchable_reference_depths`).
   These never touch the network and are what the test suite exercises.

2. Bounded retrieval of WOA reference columns
   (:func:`reference_column`), which reads a local cache first and only then
   attempts a time-limited remote read. Failure is always reported as a
   structured unavailable result; a reference value is never fabricated.

Policy:

* No extrapolation. A target depth outside the observed range is unavailable.
* No silent bridging. Interpolation happens only between two valid observed
  levels separated by at most :data:`DEFAULT_MAX_GAP_M`.
* An exact observed-depth match is used directly and is not subjected to a
  bracket gap test, because no interpolation takes place.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Sequence

import numpy as np

#: World Ocean Atlas 2023, decadal average 1991-2020, 1.00-degree grid.
#: Objectively analysed monthly climatological mean (`t_an`, `s_an`).
WOA_PRODUCT = {
    "name": "World Ocean Atlas 2023",
    "code": "decav91C0",
    "period": "1991-2020",
    "resolution_deg": 1.00,
    "field": "objectively analysed climatological mean",
    "temporal_resolution": "monthly",
    "variables": {
        "temp": {
            "woa_variable": "t_an",
            "units": "degree_Celsius",
            "definition": "in-situ temperature",
            "compatible_with": "Argo TEMP (in-situ, ITS-90)",
        },
        "psal": {
            "woa_variable": "s_an",
            "units": "psu",
            "definition": "Practical Salinity",
            "compatible_with": "Argo PSAL (Practical Salinity, PSS-78)",
        },
    },
    "url_template": (
        "https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa23/DATA/"
        "{dataset}/netcdf/{code}/1.00/woa23_{code}_{prefix}{month:02d}_01.nc"
    ),
}

_WOA_DATASETS = {"temp": ("temperature", "t"), "psal": ("salinity", "s")}

#: Maximum separation between the two observed levels used for interpolation.
#: 20 m is the configured limit for this milestone; wider gaps are reported
#: unavailable rather than bridged.
DEFAULT_MAX_GAP_M = 20.0

#: Tolerance for treating an observed level as an exact match of a reference
#: depth. Argo pressure is reported to ~0.1 dbar (~0.1 m), so 0.05 m is below
#: the resolution of the measurement and cannot mask a real separation.
EXACT_DEPTH_TOLERANCE_M = 0.05

#: Timeout applied to remote reference reads, in seconds. Retrieval is bounded
#: so a slow OPeNDAP server degrades to "unavailable", never to a hung request.
DEFAULT_FETCH_TIMEOUT_S = 20.0

_REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_DIR = _REPO_ROOT / "data" / "reference" / "woa23"


@dataclass(frozen=True)
class DepthMatch:
    """Result of evaluating one target depth against an observed profile."""

    available: bool
    target_depth: float
    value: Optional[float] = None
    method: Optional[str] = None          # "exact" | "linear_interpolation"
    lower_depth: Optional[float] = None
    upper_depth: Optional[float] = None
    gap_m: Optional[float] = None
    n_valid_levels: int = 0
    reason: Optional[str] = None

    def as_dict(self) -> dict:
        return asdict(self)


def _clean_pairs(depths: Sequence[float], values: Sequence[float]):
    """Sorted, finite, de-duplicated (depth, value) pairs.

    Levels whose depth or value is missing are dropped here, which is what
    makes an interpolation across a salinity gap see the *real* separation
    between the surviving levels rather than the nominal sampling interval.
    """
    d = np.asarray(depths, dtype=float)
    v = np.asarray(values, dtype=float)
    if d.shape != v.shape:
        raise ValueError("depths and values must have the same length")
    keep = np.isfinite(d) & np.isfinite(v)
    d, v = d[keep], v[keep]
    if d.size == 0:
        return d, v, 0
    order = np.argsort(d, kind="stable")
    d, v = d[order], v[order]
    unique_d, inverse, counts = np.unique(d, return_inverse=True, return_counts=True)
    collapsed = int((counts > 1).sum())
    if collapsed:
        # Repeated pressure levels occur in some profiles. Average them rather
        # than silently picking one, and report that it happened.
        summed = np.zeros_like(unique_d)
        np.add.at(summed, inverse, v)
        v = summed / counts
        d = unique_d
    return d, v, collapsed


def match_value_at_depth(
    depths: Sequence[float],
    values: Sequence[float],
    target_depth: float,
    max_gap_m: float = DEFAULT_MAX_GAP_M,
    exact_tolerance_m: float = EXACT_DEPTH_TOLERANCE_M,
) -> DepthMatch:
    """Value of an observed profile at ``target_depth``, or a reason it is not.

    Returns an exact match when an observed level sits within
    ``exact_tolerance_m`` of the target, otherwise linearly interpolates
    between the two bracketing valid levels provided their separation does not
    exceed ``max_gap_m``. Never extrapolates.
    """
    if not np.isfinite(target_depth):
        return DepthMatch(False, float("nan"), reason="target depth is not finite")

    d, v, _ = _clean_pairs(depths, values)
    n = int(d.size)
    target = float(target_depth)

    if n == 0:
        return DepthMatch(
            False, target, n_valid_levels=0,
            reason="no valid observed levels for this variable",
        )

    # Exact match first: no interpolation, so no gap test applies.
    nearest = int(np.argmin(np.abs(d - target)))
    if abs(d[nearest] - target) <= exact_tolerance_m:
        return DepthMatch(
            True, target, value=float(v[nearest]), method="exact",
            lower_depth=float(d[nearest]), upper_depth=float(d[nearest]),
            gap_m=0.0, n_valid_levels=n,
        )

    if n == 1:
        return DepthMatch(
            False, target, n_valid_levels=1,
            reason="only one valid observed level; interpolation not possible",
        )
    if target < d[0] or target > d[-1]:
        return DepthMatch(
            False, target, n_valid_levels=n,
            reason=(
                f"target depth {target:.2f} m is outside the observed range "
                f"{d[0]:.2f}-{d[-1]:.2f} m; extrapolation is not permitted"
            ),
        )

    upper_idx = int(np.searchsorted(d, target, side="left"))
    lower_idx = upper_idx - 1
    lower, upper = float(d[lower_idx]), float(d[upper_idx])
    gap = upper - lower
    if gap > max_gap_m:
        return DepthMatch(
            False, target, lower_depth=lower, upper_depth=upper, gap_m=gap,
            n_valid_levels=n,
            reason=(
                f"nearest valid levels are {gap:.2f} m apart, exceeding the "
                f"configured maximum interpolation gap of {max_gap_m:.2f} m"
            ),
        )

    weight = (target - lower) / gap
    value = float(v[lower_idx] + weight * (v[upper_idx] - v[lower_idx]))
    return DepthMatch(
        True, target, value=value, method="linear_interpolation",
        lower_depth=lower, upper_depth=upper, gap_m=gap, n_valid_levels=n,
    )


def matchable_reference_depths(
    depths: Sequence[float],
    values: Sequence[float],
    reference_depths: Sequence[float],
) -> list:
    """Reference depths that lie inside the observed range of valid levels.

    This is a cheap pre-filter only. Each candidate must still pass
    :func:`match_value_at_depth`, which applies the gap rule.
    """
    d, _, _ = _clean_pairs(depths, values)
    if d.size == 0:
        return []
    ref = np.asarray(reference_depths, dtype=float)
    ref = ref[np.isfinite(ref)]
    inside = ref[(ref >= d[0] - EXACT_DEPTH_TOLERANCE_M)
                 & (ref <= d[-1] + EXACT_DEPTH_TOLERANCE_M)]
    return [float(x) for x in inside]


def json_safe(obj: Any) -> Any:
    """Recursively convert a structure into strictly JSON-valid Python.

    NaN and +/-Inf become ``None``. Standard JSON has no literal for them, and
    emitting the non-standard ``NaN`` token breaks both ``requests``' strict
    parser and ``JSON.parse`` in the browser.
    """
    if obj is None:
        return None
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (int, str, bool)):
        return obj
    if isinstance(obj, np.ndarray):
        return [json_safe(x) for x in obj.tolist()]
    if isinstance(obj, dict):
        return {str(k): json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [json_safe(x) for x in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


# --------------------------------------------------------------------------
# Reference retrieval: cache first, bounded network second, never fabricated.
# --------------------------------------------------------------------------

def grid_cell(lat: float, lon: float, resolution_deg: float = 1.00):
    """Centre of the reference grid cell containing ``lat``/``lon``.

    WOA 1.00-degree cells are centred on the half degree, so the centre is
    ``floor(x) + 0.5``. Used only to key the cache; the actual coordinates
    returned to the client come from the reference file itself.
    """
    half = resolution_deg / 2.0
    return (
        math.floor(lat / resolution_deg) * resolution_deg + half,
        math.floor(lon / resolution_deg) * resolution_deg + half,
    )


def cache_path(variable: str, month: int, lat: float, lon: float,
               cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    clat, clon = grid_cell(lat, lon, WOA_PRODUCT["resolution_deg"])
    name = (
        f"{WOA_PRODUCT['code']}_{variable}_m{month:02d}"
        f"_lat{clat:+07.2f}_lon{clon:+08.2f}.json"
    )
    return Path(cache_dir) / name


def read_cached_column(variable: str, month: int, lat: float, lon: float,
                       cache_dir: Path = DEFAULT_CACHE_DIR) -> Optional[dict]:
    """Return a previously verified reference column, or ``None``."""
    path = cache_path(variable, month, lat, lon, cache_dir)
    if not path.is_file():
        return None
    try:
        with path.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    if not payload.get("depths") or not payload.get("values"):
        return None
    payload["origin"] = "local cache"
    payload["cache_file"] = path.name
    return payload


def write_cached_column(payload: dict, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    path = cache_path(payload["variable"], payload["month"],
                      payload["grid_lat"], payload["grid_lon"], cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(json_safe(payload), fh, indent=2, sort_keys=True)
    return path


def fetch_reference_column(
    variable: str,
    month: int,
    lat: float,
    lon: float,
    timeout_s: float = DEFAULT_FETCH_TIMEOUT_S,
) -> dict:
    """Read one WOA depth column over OPeNDAP. Bounded, and may raise.

    Only the single nearest water column is read, not the global file. The
    caller is responsible for turning an exception into a structured
    unavailable result.
    """
    import xarray as xr  # imported lazily: offline tests never reach this

    if variable not in _WOA_DATASETS:
        raise ValueError(f"no WOA mapping for variable {variable!r}")
    if not 1 <= int(month) <= 12:
        raise ValueError(f"month must be 1-12, got {month!r}")
    dataset, prefix = _WOA_DATASETS[variable]
    woa_var = WOA_PRODUCT["variables"][variable]["woa_variable"]
    url = WOA_PRODUCT["url_template"].format(
        dataset=dataset, code=WOA_PRODUCT["code"], prefix=prefix, month=int(month)
    )

    previous = os.environ.get("OPENDAP_TIMEOUT")
    os.environ["OPENDAP_TIMEOUT"] = str(int(timeout_s))
    try:
        with xr.open_dataset(url, engine="netcdf4", decode_times=False) as ds:
            column = ds[woa_var].sel(lat=lat, lon=lon, method="nearest").isel(time=0)
            grid_lat = float(column["lat"].values)
            grid_lon = float(column["lon"].values)
            # Reference depths come from the file's own coordinate, never a
            # hardcoded list.
            depths = [float(x) for x in np.asarray(ds["depth"].values, dtype=float)]
            values = [float(x) for x in np.asarray(column.values, dtype=float)]
            units = str(ds[woa_var].attrs.get("units", ""))
    finally:
        if previous is None:
            os.environ.pop("OPENDAP_TIMEOUT", None)
        else:
            os.environ["OPENDAP_TIMEOUT"] = previous

    return {
        "variable": variable,
        "woa_variable": woa_var,
        "month": int(month),
        "grid_lat": grid_lat,
        "grid_lon": grid_lon,
        "depths": depths,
        "values": values,
        "units": units or WOA_PRODUCT["variables"][variable]["units"],
        "product": WOA_PRODUCT["name"],
        "product_code": WOA_PRODUCT["code"],
        "period": WOA_PRODUCT["period"],
        "resolution_deg": WOA_PRODUCT["resolution_deg"],
        "source_url": url,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "origin": "remote OPeNDAP read",
    }


def reference_column(
    variable: str,
    month: int,
    lat: float,
    lon: float,
    cache_dir: Path = DEFAULT_CACHE_DIR,
    allow_network: bool = True,
    timeout_s: float = DEFAULT_FETCH_TIMEOUT_S,
):
    """``(payload, error)``: a reference column, or a reason there is none.

    Exactly one of the two is ``None``. Cached results are reused; the network
    is consulted only when the cache misses and ``allow_network`` is set.
    """
    cached = read_cached_column(variable, month, lat, lon, cache_dir)
    if cached is not None:
        return cached, None
    if not allow_network:
        return None, (
            "reference column is not cached and remote retrieval is disabled "
            f"(no cached {WOA_PRODUCT['code']} {variable} column for month "
            f"{int(month):02d} near {lat:.2f}, {lon:.2f})"
        )
    try:
        payload = fetch_reference_column(variable, month, lat, lon, timeout_s)
    except Exception as exc:  # noqa: BLE001 - reported, never swallowed
        return None, f"{type(exc).__name__}: {exc}"
    try:
        write_cached_column(payload, cache_dir)
    except OSError:
        pass  # a read-only cache directory must not fail the request
    return payload, None
