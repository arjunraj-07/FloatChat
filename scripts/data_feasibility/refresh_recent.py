"""Retrieve a recent Argo extract and stage it as a new snapshot.

What this does, in order: download the requested window into a *staging*
directory, process it with the same QC policy the January 2024 extract used,
validate the result, and only then point `active.json` at it. A failed or
partial download therefore leaves the previously working dataset serving.

"Recent" here means recent **observation** dates. Nothing streams: this is a
bounded extract, downloaded once, and the interface says so.

The original extract in ``data/processed`` is never written to.

Run it through the documented launcher::

    powershell -ExecutionPolicy Bypass -File scripts\\refresh_argo.ps1

Environment (all optional):

``FLOATCHAT_REFRESH_DAYS``      window in UTC days, default 30
``FLOATCHAT_REFRESH_WEST/EAST/SOUTH/NORTH``  search box, default 60/65/15/20
``FLOATCHAT_REFRESH_MAX_DEPTH_M``  pressure ceiling, default 500
``FLOATCHAT_REFRESH_MAX_ROWS``  processing cap, default 400000
``FLOATCHAT_REFRESH_TIMEOUT_S`` per attempt, default 600
``FLOATCHAT_REFRESH_RETRIES``   attempts, default 3
"""

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import certifi
import numpy as np
import pandas as pd
import requests
import xarray as xr

HERE = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, BASE_DIR)
sys.path.insert(0, HERE)

from floatchat_core import snapshots  # noqa: E402
from floatchat_core.qc import ARGO_VARIABLE_DEFINITIONS, normalize_qc  # noqa: E402
import process_argo_data as base  # noqa: E402

DATASET_ID = "erddap.ifremer.fr/ArgoFloats"
VARIABLES = (
    "cycle_number,data_mode,direction,latitude,longitude,platform_number,"
    "pres,pres_qc,pres_adjusted,pres_adjusted_qc,pres_adjusted_error,"
    "temp,temp_qc,temp_adjusted,temp_adjusted_qc,temp_adjusted_error,"
    "psal,psal_qc,psal_adjusted,psal_adjusted_qc,psal_adjusted_error,"
    "time,time_qc"
)


def _env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return float(default)


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return int(default)


def build_url(start, end, box, max_depth_m):
    """The ERDDAP query for one bounded window. Times are ISO-8601 UTC."""
    stamp = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    return (
        f"https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.nc?{VARIABLES}"
        f"&longitude>={box['west']}&longitude<={box['east']}"
        f"&latitude>={box['south']}&latitude<={box['north']}"
        f"&pres>=0&pres<={max_depth_m}"
        f"&time>={stamp(start)}&time<={stamp(end)}"
    )


def download(url, destination, timeout_s, retries):
    """Fetch with bounded timeouts and retries. Never partially writes."""
    last = None
    for attempt in range(1, retries + 1):
        try:
            print(f"  attempt {attempt}/{retries} (timeout {timeout_s:.0f}s)")
            response = requests.get(url, verify=certifi.where(), timeout=timeout_s)
            response.raise_for_status()
            if not response.content:
                raise ValueError("the source returned an empty body")
            tmp = destination + ".part"
            with open(tmp, "wb") as fh:
                fh.write(response.content)
            os.replace(tmp, destination)
            return True, None
        except Exception as exc:  # noqa: BLE001 - every failure keeps the old data
            last = f"{type(exc).__name__}: {exc}"
            print(f"  failed: {last}")
            if attempt < retries:
                time.sleep(2 * attempt)
    return False, last


def checksum(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def refresh():
    days = _env_int("FLOATCHAT_REFRESH_DAYS", 30)
    box = {
        "west": _env_float("FLOATCHAT_REFRESH_WEST", 60),
        "east": _env_float("FLOATCHAT_REFRESH_EAST", 65),
        "south": _env_float("FLOATCHAT_REFRESH_SOUTH", 15),
        "north": _env_float("FLOATCHAT_REFRESH_NORTH", 20),
    }
    max_depth_m = _env_float("FLOATCHAT_REFRESH_MAX_DEPTH_M", 500)
    max_rows = _env_int("FLOATCHAT_REFRESH_MAX_ROWS", 400000)
    timeout_s = _env_float("FLOATCHAT_REFRESH_TIMEOUT_S", 600)
    retries = _env_int("FLOATCHAT_REFRESH_RETRIES", 3)

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    url = build_url(start, end, box, max_depth_m)

    snapshot_id = "argo-recent-" + end.strftime("%Y%m%dT%H%M%SZ")
    staging = os.path.join(snapshots.snapshots_dir(BASE_DIR), snapshot_id)
    os.makedirs(os.path.join(staging, "raw"), exist_ok=True)
    raw_file = os.path.join(staging, "raw", "argo_recent.nc")

    print(f"=== Refreshing: last {days} UTC days ===")
    print(f"  region  : {box['west']}-{box['east']}E, {box['south']}-{box['north']}N")
    print(f"  staging : {staging}")
    ok, error = download(url, raw_file, timeout_s, retries)
    if not ok:
        print("Refresh failed; the current dataset is unchanged.")
        print(f"  reason: {error}")
        return None

    with xr.open_dataset(raw_file) as ds:
        df = ds.to_dataframe().reset_index()
        raw_history = str(ds.attrs.get("history", "")).strip()
        raw_title = str(ds.attrs.get("title", "")).strip()

    input_rows = int(len(df))
    truncated = False
    if input_rows > max_rows:
        # Recorded, never silent: a capped extract must not be presented as
        # complete coverage of the region and window.
        df = df.iloc[:max_rows].copy()
        truncated = True
        print(f"  truncated {input_rows} -> {max_rows} rows (FLOATCHAT_REFRESH_MAX_ROWS)")

    for col in base.BYTE_COLUMNS:
        if col in df.columns:
            df[col] = df[col].apply(base._decode)
    df["data_mode"] = df["data_mode"].replace(["", "nan", "None"], np.nan)
    for col in base.QC_COLUMNS:
        if col in df.columns:
            df[col] = df[col].apply(normalize_qc)

    records, exclusions, _ = base.records_from_frame(df)
    if not records:
        print("No observations passed QC; snapshot not activated.")
        return None

    df_obs = pd.DataFrame(records)
    for col in ("pres_qc", "temp_qc", "psal_qc"):
        df_obs[col] = df_obs[col].astype("Int8")

    retrieved_at = datetime.now(timezone.utc).isoformat()
    df_obs["dataset_id"] = DATASET_ID
    df_obs["source_url"] = url
    df_obs["retrieved_at"] = retrieved_at
    df_obs = df_obs.sort_values(["profile_id", "depth"]).reset_index(drop=True)

    grouped = df_obs.groupby("profile_id", as_index=False)
    df_prof = grouped.agg(
        platform=("platform", "first"), cycle=("cycle", "first"),
        direction=("direction", "first"), data_mode=("data_mode", "first"),
        time=("time", "first"), latitude=("latitude", "first"),
        longitude=("longitude", "first"), depth_min=("depth", "min"),
        depth_max=("depth", "max"), obs_count=("depth", "count"),
        temp_count=("temp", "count"), psal_count=("psal", "count"),
        source_field=("source_field", "first"),
    )
    df_prof["psal_excluded_count"] = df_prof["obs_count"] - df_prof["psal_count"]
    df_prof["dataset_id"] = DATASET_ID
    df_prof["source_url"] = url
    df_prof["retrieved_at"] = retrieved_at

    problems = validate(df_obs, df_prof, max_depth_m)
    if problems:
        print("Snapshot rejected; the current dataset is unchanged:")
        for problem in problems:
            print(f"  - {problem}")
        return None

    report = {
        "provenance": {
            "dataset_id": DATASET_ID,
            "source_url": url,
            "raw_file": os.path.relpath(raw_file, staging),
            "raw_file_checksum": checksum(raw_file),
            "raw_file_history": raw_history,
            "raw_file_title": raw_title,
            "processed_at": retrieved_at,
            "retrieved_at": retrieved_at,
            "processing_script": os.path.basename(__file__),
            "snapshot_id": snapshot_id,
            "requested_window_utc": [start.isoformat(), end.isoformat()],
            "requested_region": box,
            "requested_max_depth_m": max_depth_m,
            "policy": {
                "accepted_qc_flags": [1],
                "mode_selection": "R -> raw value + raw QC; A/D -> adjusted value + adjusted QC",
                "depth": "-gsw.z_from_p(pressure, latitude), positive down",
                "salinity": "temperature retained when salinity is missing or fails QC",
                "max_rows": max_rows,
                "truncated": truncated,
            },
            "variable_definitions": ARGO_VARIABLE_DEFINITIONS,
        },
        "counts": {
            "input_rows": input_rows,
            "retained_observations": int(len(df_obs)),
            "distinct_floats": int(df_prof["platform"].nunique()),
            "distinct_profiles": int(df_prof["profile_id"].nunique()),
            "temperature_only_observations": int(df_obs["psal"].isna().sum()),
            "observations_with_salinity": int(df_obs["psal"].notna().sum()),
        },
        "exclusions": exclusions,
        "coverage": {
            "time_start": str(df_obs["time"].min()),
            "time_end": str(df_obs["time"].max()),
            "latitude": [float(df_obs["latitude"].min()), float(df_obs["latitude"].max())],
            "longitude": [float(df_obs["longitude"].min()), float(df_obs["longitude"].max())],
            "depth_m": [float(df_obs["depth"].min()), float(df_obs["depth"].max())],
        },
    }

    # Written last: the snapshot is only complete, and so only activatable,
    # once all three files are on disk.
    df_obs.to_parquet(os.path.join(staging, "argo_observations.parquet"))
    df_prof.to_parquet(os.path.join(staging, "argo_profiles.parquet"))
    with open(os.path.join(staging, "processing_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, sort_keys=True, default=str)

    snapshots.write_active_id(BASE_DIR, snapshot_id)
    counts = report["counts"]
    print(f"Activated {snapshot_id}")
    print(f"  {counts['distinct_profiles']} profiles from {counts['distinct_floats']} floats")
    print(f"  observations {report['coverage']['time_start']} .. {report['coverage']['time_end']}")
    return report


def validate(df_obs, df_prof, max_depth_m):
    """Reasons this snapshot must not be activated. Empty means it may be."""
    problems = []
    if df_obs.empty or df_prof.empty:
        problems.append("no profiles or observations were retained")
        return problems
    if df_prof["profile_id"].duplicated().any():
        problems.append("profile identities are not unique")
    if df_obs["depth"].isna().any():
        problems.append("a level has no depth")
    if float(df_obs["depth"].max()) > max_depth_m * 1.2:
        problems.append("a depth lies far outside the requested range")
    if not df_obs["profile_id"].isin(set(df_prof["profile_id"])).all():
        problems.append("an observation references an unknown profile")
    return problems


if __name__ == "__main__":
    sys.exit(0 if refresh() else 1)
