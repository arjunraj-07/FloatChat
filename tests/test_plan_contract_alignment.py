"""Keep the frontend contract aligned with the backend schema.

`frontend/src/lib/planContract.ts` hand-mirrors `floatchat_core/plan.py`. That
is the simplest approach that adds no build tooling, but it can drift silently.
These tests read the literal arrays out of the TypeScript file and compare them
with the Python enums, so drift fails the backend suite.

The frontend is a git submodule. If it is not checked out, these tests skip
rather than fail - the backend must remain testable on its own.
"""

import os
import re

import pytest

from floatchat_core.plan import (
    ERROR_CODES,
    PLAN_SCHEMA_VERSION,
    WARNING_CODES,
    Analysis,
    DataMode,
    DepthMode,
    NamedRegion,
    Outcome,
    Output,
    Variable,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT_PATH = os.path.join(
    REPO_ROOT, "frontend", "src", "lib", "planContract.ts"
)

pytestmark = pytest.mark.skipif(
    not os.path.isfile(CONTRACT_PATH),
    reason="frontend submodule is not checked out",
)


def contract_source() -> str:
    with open(CONTRACT_PATH, "r", encoding="utf-8") as handle:
        return handle.read()


def literal_array(name: str) -> list:
    """Members of ``export const <name> = [...] as const;``."""
    source = contract_source()
    match = re.search(
        rf"export const {name} = \[(.*?)\] as const;", source, re.DOTALL
    )
    assert match, f"{name} not found in planContract.ts"
    return re.findall(r"'([^']+)'", match.group(1))


@pytest.mark.parametrize("array_name,enum_type", [
    ("VARIABLES", Variable),
    ("DATA_MODES", DataMode),
    ("DEPTH_MODES", DepthMode),
    ("NAMED_REGIONS", NamedRegion),
    ("ANALYSES", Analysis),
    ("OUTPUTS", Output),
    ("OUTCOMES", Outcome),
])
def test_frontend_enum_matches_backend(array_name, enum_type):
    assert literal_array(array_name) == [member.value for member in enum_type]


def test_frontend_pins_the_same_schema_version():
    match = re.search(
        r"export const PLAN_SCHEMA_VERSION = '([^']+)';", contract_source()
    )
    assert match, "PLAN_SCHEMA_VERSION not found in planContract.ts"
    assert match.group(1) == PLAN_SCHEMA_VERSION


def test_frontend_declares_the_endpoints_it_calls():
    source = contract_source()
    assert "/plan/validate" in source
    assert "/plan/capabilities" in source


def test_no_secret_or_provider_configuration_leaks_into_the_frontend():
    """Provider integration stays backend-only; no key may appear here."""
    source = contract_source().lower()
    for token in ("api_key", "apikey", "secret", "authorization", "bearer",
                  "anthropic", "openai", "sk-"):
        assert token not in source, f"{token!r} must not appear in the contract"


def test_documented_codes_are_disjoint():
    """A code is either an error or a warning, never both."""
    assert not set(ERROR_CODES) & set(WARNING_CODES)
