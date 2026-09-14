"""Deprecated entry point. The real suite lives in tests/ and runs under pytest.

This file previously rebuilt the QC, depth and gap logic inside the test
itself, so it could pass while production code was wrong (its "large gap"
check only asserted that a depth difference was positive). The replacement
suite calls the production functions in floatchat_core directly.

Kept so that `python run_tests.py` still works. Prefer:

    venv\\Scripts\\python.exe -m pytest
"""

import os
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))

if __name__ == "__main__":
    print(__doc__)
    print(f"Running: {sys.executable} -m pytest  (cwd={REPO_ROOT})\n")
    raise SystemExit(
        subprocess.call([sys.executable, "-m", "pytest"] + sys.argv[1:],
                        cwd=REPO_ROOT)
    )
