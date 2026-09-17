"""Which dataset is served, and what must be true before one is activated.

The rule these defend: a refresh that fails, downloads half a file, or produces
something that does not validate must leave the dataset that was already
working in place. Activation is the last step, never the first.

No network. The refresh's own retrieval is exercised separately, once, against
the real source; everything here is deterministic.
"""

import json
import os

import pandas as pd
import pytest

import main as api_main
from floatchat_core import snapshots

REFRESH = pytest.importorskip("refresh_recent")


def _write_snapshot(directory, files=snapshots.REQUIRED_FILES):
    os.makedirs(directory, exist_ok=True)
    for name in files:
        with open(os.path.join(directory, name), "w", encoding="utf-8") as fh:
            fh.write("{}")
    return directory


# --------------------------------------------------------------------------
# Choosing what to serve
# --------------------------------------------------------------------------

def test_without_a_refresh_the_original_extract_is_served(tmp_path, monkeypatch):
    monkeypatch.delenv("FLOATCHAT_DATASET_DIR", raising=False)
    active = snapshots.resolve(str(tmp_path))
    assert active.is_fallback is True
    assert "No refreshed snapshot" in active.reason
    assert active.directory.endswith(os.path.join("data", "processed"))


def test_a_complete_snapshot_is_served_once_activated(tmp_path, monkeypatch):
    monkeypatch.delenv("FLOATCHAT_DATASET_DIR", raising=False)
    _write_snapshot(os.path.join(snapshots.snapshots_dir(str(tmp_path)), "argo-recent-x"))
    snapshots.write_active_id(str(tmp_path), "argo-recent-x")

    active = snapshots.resolve(str(tmp_path))
    assert active.is_fallback is False
    assert active.snapshot_id == "argo-recent-x"
    assert active.reason is None


def test_an_incomplete_snapshot_is_never_activated(tmp_path):
    """A half-written refresh must not become the served dataset."""
    _write_snapshot(
        os.path.join(snapshots.snapshots_dir(str(tmp_path)), "half"),
        files=("argo_profiles.parquet",),
    )
    with pytest.raises(ValueError, match="incomplete"):
        snapshots.write_active_id(str(tmp_path), "half")


def test_a_pointer_to_a_broken_snapshot_falls_back(tmp_path, monkeypatch):
    """Files disappearing after activation must not take the app down."""
    monkeypatch.delenv("FLOATCHAT_DATASET_DIR", raising=False)
    directory = os.path.join(snapshots.snapshots_dir(str(tmp_path)), "argo-recent-y")
    _write_snapshot(directory)
    snapshots.write_active_id(str(tmp_path), "argo-recent-y")
    os.remove(os.path.join(directory, "argo_observations.parquet"))

    active = snapshots.resolve(str(tmp_path))
    assert active.is_fallback is True
    assert "argo-recent-y" in active.reason


def test_a_malformed_pointer_falls_back_rather_than_raising(tmp_path, monkeypatch):
    monkeypatch.delenv("FLOATCHAT_DATASET_DIR", raising=False)
    os.makedirs(snapshots.snapshots_dir(str(tmp_path)), exist_ok=True)
    with open(os.path.join(snapshots.snapshots_dir(str(tmp_path)), "active.json"),
              "w", encoding="utf-8") as fh:
        fh.write("{not json")
    assert snapshots.resolve(str(tmp_path)).is_fallback is True


# --------------------------------------------------------------------------
# What a snapshot must satisfy to be activated
# --------------------------------------------------------------------------

def _frames(**overrides):
    obs = pd.DataFrame({
        "profile_id": ["a_1_A", "a_1_A"],
        "depth": [10.0, 20.0],
        "temp": [20.0, 19.0],
        "psal": [35.0, None],
    })
    prof = pd.DataFrame({"profile_id": ["a_1_A"]})
    return overrides.get("obs", obs), overrides.get("prof", prof)


def test_a_valid_snapshot_reports_no_problems():
    obs, prof = _frames()
    assert REFRESH.validate(obs, prof, 500) == []


def test_an_empty_extract_is_refused():
    assert REFRESH.validate(pd.DataFrame(), pd.DataFrame(), 500)


def test_duplicate_profile_identities_are_refused():
    """Navigation, comparison and gradients all select by profile id."""
    obs, _ = _frames()
    prof = pd.DataFrame({"profile_id": ["a_1_A", "a_1_A"]})
    assert any("not unique" in p for p in REFRESH.validate(obs, prof, 500))


def test_a_level_without_a_depth_is_refused():
    obs, prof = _frames()
    obs.loc[0, "depth"] = None
    assert any("no depth" in p for p in REFRESH.validate(obs, prof, 500))


def test_a_depth_far_outside_the_request_is_refused():
    obs, prof = _frames()
    obs.loc[1, "depth"] = 5000.0
    assert any("outside the requested range" in p for p in REFRESH.validate(obs, prof, 500))


def test_an_observation_without_its_profile_is_refused():
    obs, prof = _frames()
    obs.loc[1, "profile_id"] = "ghost_9_A"
    assert any("unknown profile" in p for p in REFRESH.validate(obs, prof, 500))


def test_missing_salinity_does_not_invalidate_a_level():
    """Temperature-only levels are kept, never filled."""
    obs, prof = _frames()
    assert obs["psal"].isna().sum() == 1
    assert REFRESH.validate(obs, prof, 500) == []


# --------------------------------------------------------------------------
# The served dataset and its description are the same snapshot
# --------------------------------------------------------------------------

def test_coverage_describes_the_tables_that_are_actually_loaded():
    coverage = api_main.get_coverage()
    assert coverage["distinct_profiles"] == int(api_main.df_prof["profile_id"].nunique())
    assert coverage["distinct_floats"] == int(api_main.df_prof["platform"].nunique())
    assert coverage["observation_count"] == int(len(api_main.df_obs))


def test_coverage_names_the_snapshot_it_came_from():
    snapshot = api_main.get_coverage()["snapshot"]
    assert snapshot["snapshot_id"] == api_main.ACTIVE_SNAPSHOT.snapshot_id
    assert snapshot["is_fallback"] == api_main.ACTIVE_SNAPSHOT.is_fallback


def test_the_fallback_is_labelled_as_historical_and_recent_data_is_not():
    coverage = api_main.get_coverage()
    if api_main.ACTIVE_SNAPSHOT.is_fallback:
        assert "historical" in coverage["label"]
        assert coverage["snapshot"]["reason"]
    else:
        assert "recent" in coverage["label"]


def test_the_observed_extent_lies_inside_the_search_region():
    coverage = api_main.get_coverage()
    box, region = coverage["bounding_box"], coverage["search_region"]
    if not region:
        pytest.skip("no search region recorded for this snapshot")
    assert region["west"] <= box["west"] and box["east"] <= region["east"]
    assert region["south"] <= box["south"] and box["north"] <= region["north"]


def test_profile_identities_are_unique_in_the_served_dataset():
    assert api_main.df_prof["profile_id"].is_unique


def test_every_observation_belongs_to_a_served_profile():
    assert api_main.df_obs["profile_id"].isin(set(api_main.df_prof["profile_id"])).all()


def test_a_truncated_extract_says_so():
    """A capped download must never read as complete regional coverage."""
    snapshot = api_main.get_coverage()["snapshot"]
    assert "truncated" in snapshot
    if snapshot["truncated"]:
        assert snapshot["max_rows"]


def test_the_refresh_url_is_bounded_in_time_region_and_depth():
    from datetime import datetime, timedelta, timezone

    end = datetime(2026, 9, 17, tzinfo=timezone.utc)
    url = REFRESH.build_url(
        end - timedelta(days=30), end,
        {"west": 60, "east": 65, "south": 15, "north": 20}, 500,
    )
    assert "time>=2026-08-18T00:00:00Z" in url and "time<=2026-09-17T00:00:00Z" in url
    assert "longitude>=60" in url and "latitude<=20" in url
    assert "pres<=500" in url
    # Everything the QC policy needs, so no variable is silently dropped.
    for field in ("temp_qc", "psal_adjusted", "data_mode", "pres_adjusted_qc"):
        assert field in url


def test_processing_report_records_the_provenance_a_refresh_must_keep():
    report = api_main.PROCESSING_REPORT or {}
    provenance = report.get("provenance", {})
    for key in ("dataset_id", "source_url", "raw_file_checksum", "processed_at"):
        assert provenance.get(key), f"{key} missing from provenance"
