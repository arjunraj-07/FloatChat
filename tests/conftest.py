import os
import sys

# The core suite must never depend on network access. Tests that genuinely
# need it are marked `network` and re-enable it themselves.
os.environ.setdefault("FLOATCHAT_WOA_ALLOW_NETWORK", "0")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# The API module is imported by path so the tests exercise the deployed module,
# not a copy.
API_DIR = os.path.join(REPO_ROOT, "api")
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)
