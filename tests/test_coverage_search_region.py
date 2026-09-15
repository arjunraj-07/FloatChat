"""The cached search region is reported apart from the observed extent.

The globe outlines the region the cached subset was extracted for; it must
not be mistaken for the extent of recorded profiles, or for an area sampled
throughout.
"""

from fastapi.testclient import TestClient

import main as api_main


def test_coverage_reports_the_search_region_apart_from_the_observed_extent():
    body = TestClient(api_main.app).get("/api/coverage").json()
    region = body["search_region"]
    assert (region["west"], region["east"], region["south"], region["north"]) == (60.0, 65.0, 15.0, 20.0)
    assert "extraction URL" in region["source"]
    box = body["bounding_box"]
    # Recorded profile locations lie inside the region without filling it.
    assert region["west"] <= box["west"] and box["east"] <= region["east"]
    assert region["south"] <= box["south"] and box["north"] <= region["north"]
    assert box["east"] - box["west"] < region["east"] - region["west"]
