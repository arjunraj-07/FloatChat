# FloatChat

Explore real Argo ocean observations through scientific filters and linked
visualizations, across longitude, latitude, depth and time.

See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the product objective, the
scientific policies, verified dataset coverage and current limitations.

## Clone

The frontend is a submodule, so clone recursively:

```bash
git clone --recurse-submodules https://github.com/arjunraj-07/FloatChat
cd FloatChat
```

Already cloned without it:

```bash
git submodule update --init --recursive
```

## Backend

Requires Python 3.11.

```bash
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt   # Windows
# source venv/bin/activate && pip install -r requirements.txt  # POSIX
```

Run the API (serves the processed tables that are committed to the repo):

```bash
cd api
..\venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Endpoints: `/api/health`, `/api/coverage`, `/api/floats`,
`/api/profiles/{profile_id}`, `/api/woa_match/{profile_id}`.

### Optional environment variables

| Variable | Default | Meaning |
|---|---|---|
| `FLOATCHAT_WOA_ALLOW_NETWORK` | `1` | Set to `0` to forbid remote reference reads and serve only the local cache. |
| `FLOATCHAT_WOA_TIMEOUT_S` | `20` | Bound on a single reference read. |
| `FLOATCHAT_MAX_GAP_M` | `20` | Maximum separation between observed levels used for interpolation. |

## Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000, expects the API on port 8000
npm run build
npm run lint
```

## Tests

The suite runs fully offline and calls the production functions directly:

```bash
venv\Scripts\python.exe -m pytest
```

Network-dependent checks are marked `network` and excluded by default. Run them
with `pytest -m network`.

## Data

Processed tables live in `scripts/data_feasibility/data/processed/` and are
committed. Rebuild them from the cached raw subset — this does **not** download
anything when `data/raw/argo_test_subset_full.nc` is present:

```bash
venv\Scripts\python.exe scripts\data_feasibility\process_argo_data.py
```

Populate the local WOA23 reference cache (one water column per grid cell
actually used, not the global archive):

```bash
venv\Scripts\python.exe scripts\data_feasibility\build_woa_cache.py
```

If NCEI is unavailable the script reports each failed cell and the API returns
a structured `Comparison unavailable` result. Reference values are never
fabricated or extrapolated.
