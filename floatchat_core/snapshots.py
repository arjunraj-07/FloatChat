"""Which processed dataset the API is serving, and why.

A refresh writes a new snapshot into its own directory and only then points
`active.json` at it. Nothing else moves: the original January 2024 extract stays
where it has always been and is the fallback, so a failed or half-finished
download leaves a working dataset in place rather than a broken one.

Resolution order:

1. ``FLOATCHAT_DATASET_DIR`` - an explicit directory, used by tests.
2. the snapshot named by ``snapshots/active.json``, if it is complete.
3. the original extract in ``data/processed`` - the fallback.

A snapshot is complete only when all three files exist. A directory holding a
half-written refresh is therefore never activated by accident, and the reason
for falling back is reported rather than guessed at.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional

#: Every snapshot carries these three files; anything less is incomplete.
REQUIRED_FILES = (
    "argo_profiles.parquet",
    "argo_observations.parquet",
    "processing_report.json",
)


@dataclass(frozen=True)
class ActiveSnapshot:
    """The directory being served, and how it was chosen."""

    directory: str
    snapshot_id: str
    #: True when the original 2024 extract is being served.
    is_fallback: bool
    #: Why the fallback was used, when it was.
    reason: Optional[str] = None

    def describe(self) -> dict:
        return {
            "snapshot_id": self.snapshot_id,
            "is_fallback": self.is_fallback,
            "reason": self.reason,
        }


def snapshots_dir(base_dir: str) -> str:
    return os.path.join(base_dir, "scripts", "data_feasibility", "data", "snapshots")


def fallback_dir(base_dir: str) -> str:
    return os.path.join(base_dir, "scripts", "data_feasibility", "data", "processed")


def is_complete(directory: str) -> bool:
    return all(os.path.exists(os.path.join(directory, name)) for name in REQUIRED_FILES)


def read_active_id(base_dir: str) -> Optional[str]:
    path = os.path.join(snapshots_dir(base_dir), "active.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            value = json.load(fh).get("active_id")
    except (OSError, json.JSONDecodeError, AttributeError):
        return None
    return value if isinstance(value, str) and value else None


def write_active_id(base_dir: str, snapshot_id: str) -> str:
    """Point at a snapshot. Refuses to activate an incomplete one."""
    directory = os.path.join(snapshots_dir(base_dir), snapshot_id)
    if not is_complete(directory):
        raise ValueError(f"snapshot {snapshot_id} is incomplete; not activating")
    os.makedirs(snapshots_dir(base_dir), exist_ok=True)
    path = os.path.join(snapshots_dir(base_dir), "active.json")
    # Written whole to a temporary file and moved into place, so a crash
    # mid-write cannot leave a pointer that parses but names nothing.
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"active_id": snapshot_id}, fh, indent=2)
    os.replace(tmp, path)
    return path


def resolve(base_dir: str) -> ActiveSnapshot:
    """The dataset directory to serve, with the reason behind the choice."""
    override = os.environ.get("FLOATCHAT_DATASET_DIR")
    if override:
        return ActiveSnapshot(
            directory=override,
            snapshot_id=os.path.basename(override.rstrip(os.sep)) or "override",
            is_fallback=False,
        )

    original = fallback_dir(base_dir)
    active_id = read_active_id(base_dir)
    if active_id is None:
        return ActiveSnapshot(
            directory=original,
            snapshot_id="argo-2024-01-regional",
            is_fallback=True,
            reason="No refreshed snapshot has been activated.",
        )

    candidate = os.path.join(snapshots_dir(base_dir), active_id)
    if not is_complete(candidate):
        return ActiveSnapshot(
            directory=original,
            snapshot_id="argo-2024-01-regional",
            is_fallback=True,
            reason=(
                f"The active snapshot {active_id} is missing files, so the "
                "original January 2024 extract is being served."
            ),
        )

    return ActiveSnapshot(directory=candidate, snapshot_id=active_id, is_fallback=False)
