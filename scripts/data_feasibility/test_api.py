"""Deprecated entry point. Endpoint tests live in tests/test_api_endpoints.py.

This file previously hardcoded absolute Windows paths, launched a uvicorn
subprocess and asserted mostly on response shape - a "Comparison unavailable"
reply still counted as a passing WOA test. The replacement exercises the real
app in-process with Starlette's TestClient, computes expected counts from the
data, and distinguishes a successful comparison from an unavailable one.

Kept so that `python test_api.py` still works. Prefer:

    venv\\Scripts\\python.exe -m pytest tests/test_api_endpoints.py
"""

import os
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))

if __name__ == "__main__":
    print(__doc__)
    raise SystemExit(
        subprocess.call(
            [sys.executable, "-m", "pytest", "tests/test_api_endpoints.py", "-v"],
            cwd=REPO_ROOT,
        )
    )
