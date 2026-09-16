"""FloatChat Explorer API.

All numerical results are produced by :mod:`floatchat_core`. This module reads
the processed tables, selects rows and shapes responses; it contains no
scientific logic of its own.
"""

import json
import os
import sys
from functools import lru_cache

import pandas as pd
import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

API_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(API_DIR)
# Both roots are registered so the app imports identically whether it is run as
# `uvicorn main:app` from api/ or imported from the repository root.
for _path in (BASE_DIR, API_DIR):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import auth_store  # noqa: E402
from auth_routes import (  # noqa: E402
    apply_rotated_session,
    build_auth_router,
    require_user,
)
from plan_routes import build_plan_router  # noqa: E402

from floatchat_core.plan_validation import DatasetIndex  # noqa: E402
from floatchat_core.qc import ARGO_VARIABLE_DEFINITIONS  # noqa: E402
from floatchat_core.woa import (  # noqa: E402
    DEFAULT_FETCH_TIMEOUT_S,
    DEFAULT_MAX_GAP_M,
    WOA_PRODUCT,
    json_safe,
    match_value_at_depth,
    matchable_reference_depths,
    reference_column,
)

app = FastAPI(title="FloatChat Explorer API")

#: Browsers refuse a wildcard origin together with credentials, and session
#: cookies are credentials, so the allowed origins are explicit. The frontend
#: dev server runs on http://localhost:3000 and this API on port 8000 of the
#: same host; cookies ignore the port, so they are same-site while the
#: requests are still cross-origin and need CORS. Override for a deployment
#: with FLOATCHAT_ALLOWED_ORIGINS (comma-separated).
DEFAULT_ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "FLOATCHAT_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

# Re-issues a rotated session cookie onto whatever response a route returns.
app.middleware("http")(apply_rotated_session)


# The account database is prepared on import rather than in a startup event:
# the test suites construct TestClient without entering its context manager,
# so startup handlers would never run there. It lives in its own configurable
# file (FLOATCHAT_AUTH_DB) and is git-ignored; the Argo tables and the
# scientific reference caches are never touched by it.
auth_store.init_db()
auth_store.purge_expired()

PROC_DIR = os.path.join(BASE_DIR, "scripts", "data_feasibility", "data", "processed")

df_prof = pd.read_parquet(os.path.join(PROC_DIR, "argo_profiles.parquet"))
df_obs = pd.read_parquet(os.path.join(PROC_DIR, "argo_observations.parquet"))


def _load_processing_report():
    path = os.path.join(PROC_DIR, "processing_report.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


PROCESSING_REPORT = _load_processing_report()

#: Remote reference reads can be disabled entirely, e.g. in CI.
WOA_ALLOW_NETWORK = os.environ.get("FLOATCHAT_WOA_ALLOW_NETWORK", "1") != "0"
WOA_TIMEOUT_S = float(
    os.environ.get("FLOATCHAT_WOA_TIMEOUT_S", DEFAULT_FETCH_TIMEOUT_S)
)
MAX_GAP_M = float(os.environ.get("FLOATCHAT_MAX_GAP_M", DEFAULT_MAX_GAP_M))

def dataset_index() -> DatasetIndex:
    """The loaded tables plus the identity of the processing run behind them.

    Plan validation resolves availability through this, so it reflects the data
    actually in memory rather than any documentation.
    """
    provenance = (PROCESSING_REPORT or {}).get("provenance", {})
    return DatasetIndex(
        observations=df_obs,
        profiles=df_prof,
        identity={
            "dataset_id": provenance.get("dataset_id"),
            "source_url": provenance.get("source_url"),
            "raw_file_checksum": provenance.get("raw_file_checksum"),
            "processed_at": provenance.get("processed_at"),
            "processing_script": provenance.get("processing_script"),
        },
    )


COMPARISON_LIMITATIONS = [
    "The reference climatology is a monthly mean on a "
    f"{WOA_PRODUCT['resolution_deg']:.2f}-degree grid; the comparison cell is "
    "the nearest grid cell, not the exact float position.",
    "A difference from the climatological mean is not a statistical anomaly. "
    "No significance test has been applied.",
    "A positive temperature difference does not establish a marine heatwave; "
    "that requires a daily series and a documented percentile baseline.",
]


def _cell(value):
    """Scalar from a DataFrame cell, with pandas NA mapped to ``None``."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    return value


def _profile_meta(profile_id: str):
    rows = df_prof[df_prof["profile_id"] == profile_id]
    if rows.empty:
        return None
    return rows.iloc[0]


def _profile_observations(profile_id: str) -> pd.DataFrame:
    return df_obs[df_obs["profile_id"] == profile_id].sort_values("depth")


@app.get("/api/health")
def health():
    return json_safe({
        "status": "ok",
        "observations": int(len(df_obs)),
        "profiles": int(df_prof["profile_id"].nunique()),
        "woa_network_enabled": WOA_ALLOW_NETWORK,
    })


@app.get("/api/coverage")
def get_coverage():
    counts = (PROCESSING_REPORT or {}).get("counts", {})
    exclusions = (PROCESSING_REPORT or {}).get("exclusions", {})
    provenance = (PROCESSING_REPORT or {}).get("provenance", {})
    return json_safe({
        "dataset": "ERDDAP GDAC Argo (cached regional subset)",
        "label": "cached historical observations",
        "distinct_floats": int(df_prof["platform"].nunique()),
        "distinct_profiles": int(df_prof["profile_id"].nunique()),
        "observation_count": int(len(df_obs)),
        "temperature_only_observations": int(df_obs["psal"].isna().sum()),
        "date_range": [
            df_prof["time"].min().isoformat(),
            df_prof["time"].max().isoformat(),
        ],
        "bounding_box": {
            "west": float(df_prof["longitude"].min()),
            "east": float(df_prof["longitude"].max()),
            "south": float(df_prof["latitude"].min()),
            "north": float(df_prof["latitude"].max()),
        },
        # The area the cached subset was extracted for - not an area that
        # was sampled throughout. `bounding_box` is the extent of the
        # recorded profile locations inside it.
        "search_region": dataset_index().configured_search_region,
        "depth_range_m": [
            float(df_obs["depth"].min()),
            float(df_obs["depth"].max()),
        ],
        "data_modes": {
            str(k): int(v) for k, v in df_prof["data_mode"].value_counts().items()
        },
        "variable_definitions": ARGO_VARIABLE_DEFINITIONS,
        "provenance": {
            "dataset_id": provenance.get("dataset_id"),
            "source_url": provenance.get("source_url"),
            "raw_file_checksum": provenance.get("raw_file_checksum"),
            "processed_at": provenance.get("processed_at"),
            "policy": provenance.get("policy"),
        },
        "exclusions": exclusions,
        "counts_reported_by_processing": counts,
    })


@app.get("/api/floats")
def get_floats():
    floats = {}
    for _, row in df_prof.iterrows():
        platform = str(row["platform"])
        entry = floats.setdefault(platform, {"platform": platform, "profiles": []})
        entry["profiles"].append({
            "profile_id": row["profile_id"],
            "cycle": int(row["cycle"]),
            "direction": row["direction"],
            "data_mode": row["data_mode"],
            "time": row["time"].isoformat(),
            "latitude": float(row["latitude"]),
            "longitude": float(row["longitude"]),
            "depth_min": _cell(row["depth_min"]),
            "depth_max": _cell(row["depth_max"]),
            "temp_count": int(row["temp_count"]),
            "psal_count": int(row["psal_count"]),
            "psal_excluded_count": int(row["psal_excluded_count"])
            if "psal_excluded_count" in row else None,
            "source_field": _cell(row.get("source_field")),
        })
    for entry in floats.values():
        entry["profiles"].sort(key=lambda p: p["time"])
        entry["profile_count"] = len(entry["profiles"])
    return json_safe(sorted(floats.values(), key=lambda f: f["platform"]))


@app.get("/api/profiles/{profile_id}")
def get_profile(profile_id: str):
    prof_data = _profile_observations(profile_id)
    if prof_data.empty:
        raise HTTPException(status_code=404, detail="Profile not found")
    meta = _profile_meta(profile_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Profile metadata not found")

    observations = []
    for _, row in prof_data.iterrows():
        observations.append({
            "pres": float(row["pres"]),
            "pres_qc": _cell(row.get("pres_qc")),
            "depth": float(row["depth"]),
            "temp": _cell(row["temp"]),
            "temp_qc": _cell(row.get("temp_qc")),
            "psal": _cell(row["psal"]),
            "psal_qc": _cell(row.get("psal_qc")),
            "psal_status": _cell(row.get("psal_status")),
            "psal_exclusion_reason": _cell(row.get("psal_exclusion_reason")),
            "source_field": row["source_field"],
        })

    psal_present = int(prof_data["psal"].notna().sum())
    return json_safe({
        "profile_id": profile_id,
        "platform": str(meta["platform"]),
        "cycle": int(meta["cycle"]),
        "direction": _cell(meta.get("direction")),
        "data_mode": str(meta["data_mode"]),
        "time": meta["time"].isoformat(),
        "latitude": float(meta["latitude"]),
        "longitude": float(meta["longitude"]),
        "observations": observations,
        "qc": {
            "accepted_qc_flags": [1],
            "level_count": int(len(observations)),
            "temperature_levels": int(prof_data["temp"].notna().sum()),
            "salinity_levels": psal_present,
            "salinity_excluded_levels": int(len(observations) - psal_present),
            "source_field": str(meta.get("source_field", "")) or None,
            "note": "Levels without valid salinity retain their temperature "
                    "value and are not continuous salinity observations.",
        },
        "variable_definitions": ARGO_VARIABLE_DEFINITIONS,
        "metadata": {
            "source": "ERDDAP/GDAC",
            "dataset_id": _cell(meta.get("dataset_id")),
            "source_url": _cell(meta.get("source_url")),
            "retrieved_at": _cell(meta.get("retrieved_at")),
            "mhw_detection": "Not yet available",
        },
    })


@lru_cache(maxsize=256)
def _cached_reference_column(variable: str, month: int, lat_key: float,
                             lon_key: float):
    """Process-level memo over the on-disk cache / bounded remote read."""
    return reference_column(
        variable, month, lat_key, lon_key,
        allow_network=WOA_ALLOW_NETWORK, timeout_s=WOA_TIMEOUT_S,
    )


def _unavailable(reason: str, **extra):
    payload = {
        "status": "Comparison unavailable",
        "reason": reason,
        "reference_product": WOA_PRODUCT["name"],
        "baseline_period": WOA_PRODUCT["period"],
        "limitations": COMPARISON_LIMITATIONS,
    }
    payload.update(extra)
    return json_safe(payload)


@app.get("/api/woa_match/{profile_id}")
def woa_match(profile_id: str, variable: str = "temp"):
    if variable not in WOA_PRODUCT["variables"]:
        raise HTTPException(
            status_code=400,
            detail=f"variable must be one of {sorted(WOA_PRODUCT['variables'])}",
        )

    prof_data = _profile_observations(profile_id)
    if prof_data.empty:
        raise HTTPException(status_code=404, detail="Profile not found")

    valid = prof_data.dropna(subset=[variable, "depth"])
    if valid.empty:
        return _unavailable(
            f"no valid {variable.upper()} levels passed QC for this profile"
        )

    latitude = float(valid["latitude"].iloc[0])
    longitude = float(valid["longitude"].iloc[0])
    month = int(pd.to_datetime(valid["time"].iloc[0]).month)

    column, error = _cached_reference_column(variable, month, latitude, longitude)
    if column is None:
        return _unavailable(f"reference retrieval failed: {error}",
                            month=month)

    ref_depths = column["depths"]
    ref_values = column["values"]
    depths = valid["depth"].to_numpy(dtype=float)
    values = valid[variable].to_numpy(dtype=float)

    candidates = matchable_reference_depths(depths, values, ref_depths)
    if not candidates:
        return _unavailable(
            f"no reference depth falls within the observed range "
            f"{depths.min():.2f}-{depths.max():.2f} m; extrapolation is not "
            "permitted",
            month=month,
        )

    matches = []
    rejected = []
    for target in candidates:
        idx = ref_depths.index(target)
        ref_value = ref_values[idx]
        if ref_value is None or not pd.notna(ref_value):
            rejected.append({
                "depth": target,
                "reason": "reference cell has no value at this depth "
                          "(land, or outside the analysed domain)",
            })
            continue
        match = match_value_at_depth(depths, values, target, max_gap_m=MAX_GAP_M)
        if not match.available:
            rejected.append({"depth": target, "reason": match.reason})
            continue
        matches.append({
            "comparison_depth": float(target),
            "observed_value": match.value,
            "reference_value": float(ref_value),
            "difference": float(match.value - float(ref_value)),
            "match_method": match.method,
            "bracketing_depths": [match.lower_depth, match.upper_depth],
            "gap_m": match.gap_m,
        })

    if not matches:
        return _unavailable(
            "no reference depth could be matched without extrapolating or "
            f"bridging a gap wider than {MAX_GAP_M:.0f} m",
            month=month,
            rejected_depths=rejected,
        )

    primary = matches[0]
    method_text = (
        "exact observed level" if primary["match_method"] == "exact"
        else f"linear interpolation between observed levels "
             f"(maximum gap {MAX_GAP_M:.0f} m)"
    )
    return json_safe({
        "status": "Success",
        "variable": variable,
        "units": column.get("units"),
        # Keys below are consumed by the existing Explorer evidence panel.
        "argo_interpolated_value": primary["observed_value"],
        "woa_reference_value": primary["reference_value"],
        "difference": primary["difference"],
        "comparison_depth": primary["comparison_depth"],
        "month": month,
        "baseline_period": column.get("period", WOA_PRODUCT["period"]),
        "method": f"{method_text}; nearest reference grid cell",
        "spatial_offset": {
            "lat": float(column["grid_lat"]) - latitude,
            "lon": float(column["grid_lon"]) - longitude,
        },
        # Additional evidence.
        "match_method": primary["match_method"],
        "bracketing_depths": primary["bracketing_depths"],
        "gap_m": primary["gap_m"],
        "matches": matches,
        "rejected_depths": rejected,
        "reference": {
            "product": column.get("product", WOA_PRODUCT["name"]),
            "product_code": column.get("product_code", WOA_PRODUCT["code"]),
            "variable": column.get("woa_variable"),
            "definition": WOA_PRODUCT["variables"][variable]["definition"],
            "compatible_with": WOA_PRODUCT["variables"][variable]["compatible_with"],
            "resolution_deg": column.get("resolution_deg"),
            "grid_lat": column.get("grid_lat"),
            "grid_lon": column.get("grid_lon"),
            "source_url": column.get("source_url"),
            "retrieved_at": column.get("retrieved_at"),
            "origin": column.get("origin"),
        },
        "limitations": COMPARISON_LIMITATIONS,
    })


app.include_router(build_auth_router())

# Only the drafting route spends money per call, so it is the one endpoint
# that requires an account. Everything else - coverage, floats, profiles,
# climatology, validation and execution - stays public, so manual
# exploration works with no account at all. The dependency is applied here,
# in the deployed application, rather than inside the router, so the
# requirement is enforced by the backend and cannot be bypassed by calling
# the API directly.
app.include_router(build_plan_router(
    dataset_index,
    draft_dependencies=[Depends(require_user)],
))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
