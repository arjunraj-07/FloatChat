"""Build the processed Argo profile/observation tables from the cached subset.

Selection and QC policy live in :mod:`floatchat_core.qc`; this script only
orchestrates reading, per-level selection and writing. That is deliberate: the
test suite exercises the same functions the API uses, not a copy of them.

Running this script does not re-download anything when
``data/raw/argo_test_subset_full.nc`` is already present, so reprocessing is
fully offline and reproducible.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import certifi
import gsw  # noqa: F401 - imported for the version record below
import numpy as np
import pandas as pd
import requests
import xarray as xr

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))

from floatchat_core.qc import (  # noqa: E402
    ARGO_VARIABLE_DEFINITIONS,
    UnsupportedDataModeError,
    depth_from_pressure,
    normalize_qc,
    select_field,
    source_field_for_mode,
)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(OUT_DIR, "data", "raw")
PROC_DIR = os.path.join(OUT_DIR, "data", "processed")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PROC_DIR, exist_ok=True)

DATASET_ID = "erddap.ifremer.fr/ArgoFloats"
SOURCE_URL = (
    "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.nc?"
    "cycle_number,data_mode,direction,latitude,longitude,platform_number,"
    "pres,pres_qc,pres_adjusted,pres_adjusted_qc,pres_adjusted_error,"
    "temp,temp_qc,temp_adjusted,temp_adjusted_qc,temp_adjusted_error,"
    "psal,psal_qc,psal_adjusted,psal_adjusted_qc,psal_adjusted_error,"
    "time,time_qc&"
    "longitude>=60&longitude<=65&latitude>=15&latitude<=20&"
    "pres>=0&pres<=500&time>=1704067200.0&time<=1704844800.0"
)
RAW_FILE = os.path.join(DATA_DIR, "argo_test_subset_full.nc")

BYTE_COLUMNS = ("data_mode", "direction", "platform_number")
QC_COLUMNS = (
    "pres_qc", "pres_adjusted_qc", "temp_qc", "temp_adjusted_qc",
    "psal_qc", "psal_adjusted_qc",
)


def _decode(value):
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace").strip()
    if value is None:
        return ""
    return str(value).strip()


def file_checksum(path, algorithm="sha256"):
    digest = hashlib.new(algorithm)
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return f"{algorithm}:{digest.hexdigest()}"


def download_if_missing():
    if os.path.exists(RAW_FILE):
        print(f"Using cached raw subset: {RAW_FILE}")
        return True
    print("=== Downloading ERDDAP subset (not cached) ===")
    try:
        response = requests.get(SOURCE_URL, verify=certifi.where(), timeout=120)
        response.raise_for_status()
        with open(RAW_FILE, "wb") as fh:
            fh.write(response.content)
        print("Downloaded Argo subset.")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to download Argo subset: {exc}")
        return False


def process():
    if not download_if_missing():
        return None

    print("=== Processing dataset ===")
    with xr.open_dataset(RAW_FILE) as ds:
        df = ds.to_dataframe().reset_index()
        raw_history = str(ds.attrs.get("history", "")).strip()
        raw_title = str(ds.attrs.get("title", "")).strip()

    for col in BYTE_COLUMNS:
        if col in df.columns:
            df[col] = df[col].apply(_decode)
    df["data_mode"] = df["data_mode"].replace(["", "nan", "None"], np.nan)
    for col in QC_COLUMNS:
        if col in df.columns:
            df[col] = df[col].apply(normalize_qc)

    provenance = {
        "dataset_id": DATASET_ID,
        "source_url": SOURCE_URL,
        "raw_file": os.path.basename(RAW_FILE),
        "raw_file_checksum": file_checksum(RAW_FILE),
        "raw_file_history": raw_history,
        "raw_file_title": raw_title,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "processing_script": os.path.basename(__file__),
        "library_versions": {
            "gsw": gsw.__version__,
            "xarray": xr.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
        "policy": {
            "accepted_qc_flags": [1],
            "mode_selection": "R -> raw value + raw QC; A/D -> adjusted value + adjusted QC",
            "depth": "-gsw.z_from_p(pressure, latitude), positive down",
            "salinity": "temperature retained when salinity is missing or fails QC",
        },
        "variable_definitions": ARGO_VARIABLE_DEFINITIONS,
    }

    records = []
    exclusions = {
        "unsupported_mode": 0,
        "missing_required_field": 0,
        "pres_missing_value": 0,
        "pres_qc_rejected": 0,
        "pres_qc_malformed": 0,
        "temp_missing_value": 0,
        "temp_qc_rejected": 0,
        "temp_qc_malformed": 0,
    }
    # Salinity exclusions do not drop the level; they are counted separately so
    # a temperature-only level is never presented as a complete observation.
    psal_masked = {"missing_value": 0, "qc_rejected": 0, "qc_malformed": 0}
    unsupported_modes_seen = {}

    for _, row in df.iterrows():
        record = row.to_dict()
        try:
            branch = source_field_for_mode(record.get("data_mode"))
        except UnsupportedDataModeError:
            exclusions["unsupported_mode"] += 1
            key = _decode(record.get("data_mode")) or "<missing>"
            unsupported_modes_seen[key] = unsupported_modes_seen.get(key, 0) + 1
            continue

        try:
            pres = select_field(record, "pres", record["data_mode"])
            temp = select_field(record, "temp", record["data_mode"])
            psal = select_field(record, "psal", record["data_mode"])
        except KeyError:
            exclusions["missing_required_field"] += 1
            continue

        if not pres.usable:
            exclusions[f"pres_{pres.status}"] += 1
            continue
        if not temp.usable:
            exclusions[f"temp_{temp.status}"] += 1
            continue
        if not psal.usable:
            psal_masked[psal.status] = psal_masked.get(psal.status, 0) + 1

        try:
            cycle = int(float(record["cycle_number"]))
        except (TypeError, ValueError):
            exclusions["missing_required_field"] += 1
            continue

        platform = _decode(record["platform_number"])
        direction = _decode(record["direction"])
        records.append({
            "profile_id": f"{platform}_{cycle}_{direction}",
            "platform": platform,
            "cycle": cycle,
            "direction": direction,
            "data_mode": _decode(record["data_mode"]).upper(),
            "time": record["time"],
            "latitude": float(record["latitude"]),
            "longitude": float(record["longitude"]),
            "pres": pres.value,
            "pres_qc": pres.qc,
            "depth": float(depth_from_pressure(pres.value, record["latitude"])),
            "temp": temp.value,
            "temp_qc": temp.qc,
            "temp_error": temp.error,
            "psal": psal.value,
            "psal_qc": psal.qc if psal.usable else None,
            "psal_error": psal.error if psal.usable else None,
            "psal_status": psal.status,
            "psal_exclusion_reason": psal.reason,
            "source_field": branch,
            "pres_source_variable": pres.value_name,
            "temp_source_variable": temp.value_name,
            "psal_source_variable": psal.value_name,
        })

    exclusions["psal_masked"] = psal_masked
    exclusions["unsupported_modes_seen"] = unsupported_modes_seen

    df_obs = pd.DataFrame(records)
    print(f"Total input rows: {len(df)}")
    print(f"Retained observations: {len(df_obs)}")
    print(f"Exclusions: {json.dumps(exclusions, indent=2)}")
    if df_obs.empty:
        print("No observations retained; nothing written.")
        return None

    for col in ("pres_qc", "temp_qc", "psal_qc"):
        df_obs[col] = df_obs[col].astype("Int8")

    df_obs["dataset_id"] = DATASET_ID
    df_obs["source_url"] = SOURCE_URL
    df_obs["retrieved_at"] = provenance["processed_at"]

    df_obs = df_obs.sort_values(["profile_id", "depth"]).reset_index(drop=True)
    df_obs.to_parquet(os.path.join(PROC_DIR, "argo_observations.parquet"))

    grouped = df_obs.groupby("profile_id", as_index=False)
    df_prof = grouped.agg(
        platform=("platform", "first"),
        cycle=("cycle", "first"),
        direction=("direction", "first"),
        data_mode=("data_mode", "first"),
        time=("time", "first"),
        latitude=("latitude", "first"),
        longitude=("longitude", "first"),
        depth_min=("depth", "min"),
        depth_max=("depth", "max"),
        obs_count=("depth", "count"),
        temp_count=("temp", "count"),
        psal_count=("psal", "count"),
        source_field=("source_field", "first"),
    )
    df_prof["psal_excluded_count"] = df_prof["obs_count"] - df_prof["psal_count"]
    df_prof["dataset_id"] = DATASET_ID
    df_prof["source_url"] = SOURCE_URL
    df_prof["retrieved_at"] = provenance["processed_at"]
    df_prof.to_parquet(os.path.join(PROC_DIR, "argo_profiles.parquet"))

    summary = {
        "provenance": provenance,
        "counts": {
            "input_rows": int(len(df)),
            "retained_observations": int(len(df_obs)),
            "distinct_floats": int(df_prof["platform"].nunique()),
            "distinct_profiles": int(df_prof["profile_id"].nunique()),
            "temperature_only_observations":
                int(df_obs["psal"].isna().sum()),
            "observations_with_salinity": int(df_obs["psal"].notna().sum()),
        },
        "exclusions": exclusions,
        "coverage": {
            "time_start": str(df_obs["time"].min()),
            "time_end": str(df_obs["time"].max()),
            "latitude": [float(df_obs["latitude"].min()),
                         float(df_obs["latitude"].max())],
            "longitude": [float(df_obs["longitude"].min()),
                          float(df_obs["longitude"].max())],
            "depth_m": [float(df_obs["depth"].min()),
                        float(df_obs["depth"].max())],
        },
    }
    report_path = os.path.join(PROC_DIR, "processing_report.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, sort_keys=True)

    print(f"Saved {len(df_prof)} profiles and {len(df_obs)} observations.")
    print(f"Wrote {report_path}")
    return summary


if __name__ == "__main__":
    process()
