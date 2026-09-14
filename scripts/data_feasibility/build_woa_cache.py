"""Populate the local WOA23 reference cache for the cached Argo subset.

Reads one water column per (variable, month, 1-degree grid cell) actually
needed by the processed profiles - not the global archive. Each successful
read is written to data/reference/woa23/ so the API and the test suite can run
offline afterwards.

Retrieval is bounded and failures are reported per cell; a failure here is a
retrieval problem to be retried, never a reason to fabricate a value.

Usage:
    venv\\Scripts\\python.exe scripts/data_feasibility/build_woa_cache.py
    venv\\Scripts\\python.exe scripts/data_feasibility/build_woa_cache.py --timeout 60
"""

import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))

from floatchat_core.woa import (  # noqa: E402
    DEFAULT_CACHE_DIR,
    DEFAULT_FETCH_TIMEOUT_S,
    grid_cell,
    fetch_reference_column,
    read_cached_column,
    write_cached_column,
)

PROC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "data", "processed")


def required_cells(variables):
    """Distinct (variable, month, cell lat, cell lon) tuples in the dataset."""
    profiles = pd.read_parquet(os.path.join(PROC_DIR, "argo_profiles.parquet"))
    cells = set()
    for _, row in profiles.iterrows():
        month = int(pd.to_datetime(row["time"]).month)
        lat, lon = grid_cell(float(row["latitude"]), float(row["longitude"]))
        for variable in variables:
            cells.add((variable, month, lat, lon))
    return sorted(cells)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variables", nargs="+", default=["temp", "psal"])
    parser.add_argument("--timeout", type=float, default=DEFAULT_FETCH_TIMEOUT_S)
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    parser.add_argument("--refresh", action="store_true",
                        help="re-read cells that are already cached")
    args = parser.parse_args()

    cells = required_cells(args.variables)
    print(f"{len(cells)} reference column(s) required by the processed profiles")

    cached = fetched = failed = 0
    for variable, month, lat, lon in cells:
        label = f"{variable} month={month:02d} cell=({lat:+.1f},{lon:+.1f})"
        if not args.refresh and read_cached_column(
                variable, month, lat, lon, cache_dir=args.cache_dir):
            print(f"  cached   {label}")
            cached += 1
            continue
        try:
            payload = fetch_reference_column(variable, month, lat, lon,
                                             timeout_s=args.timeout)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED   {label}: {type(exc).__name__}: {exc}")
            failed += 1
            continue
        finite = sum(1 for v in payload["values"] if v == v)
        path = write_cached_column(payload, cache_dir=args.cache_dir)
        print(f"  fetched  {label} -> {path.name} "
              f"({finite}/{len(payload['values'])} depths with values)")
        fetched += 1

    print(f"\nAlready cached: {cached}  fetched: {fetched}  failed: {failed}")
    if failed:
        print("Cells that failed remain uncached; the API will report those "
              "comparisons as unavailable until they are retried.")
    return 1 if failed and not (cached or fetched) else 0


if __name__ == "__main__":
    raise SystemExit(main())
