"""Tests for data-mode selection, QC normalisation and depth conversion.

These call the production functions in :mod:`floatchat_core.qc` directly. No
filtering logic is reimplemented here.
"""

import numpy as np
import pytest

from floatchat_core.qc import (
    UnsupportedDataModeError,
    depth_from_pressure,
    normalize_qc,
    select_field,
    source_field_for_mode,
)


def level(**overrides):
    """A single Argo level carrying both raw and adjusted branches."""
    record = {
        "pres": 10.0, "pres_qc": 1,
        "pres_adjusted": 10.2, "pres_adjusted_qc": 1, "pres_adjusted_error": 2.4,
        "temp": 26.0, "temp_qc": 1,
        "temp_adjusted": 26.5, "temp_adjusted_qc": 1, "temp_adjusted_error": 0.002,
        "psal": 35.0, "psal_qc": 1,
        "psal_adjusted": 35.4, "psal_adjusted_qc": 1, "psal_adjusted_error": 0.01,
    }
    record.update(overrides)
    return record


# --------------------------------------------------------------------------
# R / A / D value and QC pairing
# --------------------------------------------------------------------------

def test_mode_r_selects_raw_value_and_raw_qc():
    sel = select_field(level(), "temp", "R")
    assert sel.usable
    assert sel.value == 26.0
    assert sel.source_field == "raw"
    assert sel.value_name == "temp"
    assert sel.qc_name == "temp_qc"


@pytest.mark.parametrize("mode", ["A", "D"])
def test_modes_a_and_d_select_adjusted_value_and_adjusted_qc(mode):
    sel = select_field(level(), "temp", mode)
    assert sel.usable
    assert sel.value == 26.5
    assert sel.source_field == "adjusted"
    assert sel.value_name == "temp_adjusted"
    assert sel.qc_name == "temp_adjusted_qc"
    assert sel.error == pytest.approx(0.002)


def test_raw_qc_is_ignored_in_adjusted_mode():
    """A bad raw flag must not reject a good adjusted value, and vice versa."""
    sel = select_field(level(temp_qc=4), "temp", "D")
    assert sel.usable and sel.value == 26.5

    sel = select_field(level(temp_adjusted_qc=4), "temp", "R")
    assert sel.usable and sel.value == 26.0


def test_adjusted_qc_rejects_adjusted_value():
    sel = select_field(level(temp_adjusted_qc=4), "temp", "D")
    assert not sel.usable
    assert sel.status == "qc_rejected"
    assert sel.value is None
    assert "temp_adjusted_qc=4" in sel.reason


# --------------------------------------------------------------------------
# Missing adjusted data and unsupported modes
# --------------------------------------------------------------------------

def test_missing_adjusted_value_is_not_silently_filled_from_raw():
    sel = select_field(level(temp_adjusted=np.nan), "temp", "D")
    assert not sel.usable
    assert sel.status == "missing_value"
    assert sel.value is None


def test_absent_adjusted_column_raises_rather_than_falling_back():
    record = level()
    del record["temp_adjusted"]
    with pytest.raises(KeyError):
        select_field(record, "temp", "D")


@pytest.mark.parametrize("mode", ["", " ", "X", "r ", None, np.nan, "RA", 1])
def test_unsupported_modes_are_rejected_explicitly(mode):
    if mode == "r ":
        # Whitespace and case are normalised; this one is supported.
        assert source_field_for_mode(mode) == "raw"
        return
    with pytest.raises(UnsupportedDataModeError):
        source_field_for_mode(mode)


def test_supported_modes_map_to_the_right_branch():
    assert source_field_for_mode("R") == "raw"
    assert source_field_for_mode("A") == "adjusted"
    assert source_field_for_mode("D") == "adjusted"
    assert source_field_for_mode(b"D") == "adjusted"


# --------------------------------------------------------------------------
# Temperature-only records
# --------------------------------------------------------------------------

def test_temperature_is_retained_when_salinity_is_missing():
    record = level(psal=np.nan, psal_qc=np.nan)
    temp = select_field(record, "temp", "R")
    psal = select_field(record, "psal", "R")
    assert temp.usable and temp.value == 26.0
    assert not psal.usable
    assert psal.status == "missing_value"
    assert psal.value is None


def test_temperature_is_retained_when_salinity_fails_qc():
    record = level(psal_qc=4)
    temp = select_field(record, "temp", "R")
    psal = select_field(record, "psal", "R")
    assert temp.usable
    assert psal.status == "qc_rejected"
    assert psal.reason is not None


# --------------------------------------------------------------------------
# QC encoding normalisation
# --------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    (1, 1), (1.0, 1), ("1", 1), (" 1 ", 1), (b"1", 1), (np.int8(1), 1),
    (np.float64(1.0), 1), ("4", 4), (9, 9), (0, 0),
])
def test_valid_qc_encodings_normalise(raw, expected):
    assert normalize_qc(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "   ", None, np.nan, float("inf"), float("-inf"),
    "X", b"", b"\xff", 1.5, "1.5", "one", True, False,
])
def test_malformed_qc_encodings_are_refused(raw):
    assert normalize_qc(raw) is None


def test_malformed_qc_does_not_pass_as_good():
    sel = select_field(level(temp_qc="X"), "temp", "R")
    assert not sel.usable
    assert sel.status == "qc_malformed"
    assert sel.value is None


@pytest.mark.parametrize("flag", [0, 2, 3, 4, 5, 8, 9])
def test_only_qc_flag_1_is_accepted(flag):
    sel = select_field(level(temp_qc=flag), "temp", "R")
    assert not sel.usable
    assert sel.status == "qc_rejected"


# --------------------------------------------------------------------------
# Depth conversion, checked against an independent formula
# --------------------------------------------------------------------------

def unesco_depth(pressure, latitude):
    """UNESCO (1983) Fofonoff & Millard depth-from-pressure equation.

    An implementation independent of TEOS-10, used here so the depth check is
    not simply gsw asserted against itself.
    """
    x = np.sin(np.deg2rad(latitude)) ** 2
    g = 9.780318 * (1.0 + (5.2788e-3 + 2.36e-5 * x) * x) + 1.092e-6 * pressure
    return ((((-1.82e-15 * pressure + 2.279e-10) * pressure - 2.2512e-5)
             * pressure + 9.72659) * pressure) / g


@pytest.mark.parametrize("pressure,latitude", [
    (10.0, 0.0), (100.0, 15.5), (500.0, 15.5),
    (1000.0, 30.0), (2000.0, 60.0), (500.0, -45.0),
])
def test_depth_matches_independent_unesco_formula(pressure, latitude):
    assert depth_from_pressure(pressure, latitude) == pytest.approx(
        unesco_depth(pressure, latitude), abs=0.01
    )


def test_depth_reference_value_at_1000_dbar_30n():
    """1000 dbar at 30 degrees N is ~990.81 m (TEOS-10 / UNESCO agree)."""
    assert depth_from_pressure(1000.0, 30.0) == pytest.approx(990.81, abs=0.01)


def test_depth_is_positive_down_and_monotonic():
    pressures = np.array([1.0, 10.0, 100.0, 500.0])
    depths = depth_from_pressure(pressures, 15.5)
    assert (depths > 0).all()
    assert (np.diff(depths) > 0).all()


def test_depth_varies_with_latitude_as_gravity_does():
    """Higher latitude means stronger gravity, so less depth per dbar."""
    assert depth_from_pressure(500.0, 60.0) < depth_from_pressure(500.0, 0.0)
