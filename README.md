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

On Windows, `scripts\run_api.ps1` starts the same API with the
natural-language settings applied (Gemini's OpenAI-compatible endpoint). It
stores no secret: the key is inherited from `FLOATCHAT_NL_API_KEY`, and without
it the API still starts and manual query building works.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run_api.ps1
```

Explorer endpoints: `/api/health`, `/api/coverage`, `/api/floats`,
`/api/profiles/{profile_id}`, `/api/woa_match/{profile_id}`.

Query-plan endpoints: `GET /api/plan/capabilities`, `POST /api/plan/validate`,
`POST /api/plan/execute`, `POST /api/plan/draft` and `GET /api/plan/nl_status`. The validator checks a structured exploration
request against the loaded data; it does not execute it, fetch anything or
call a model. Outcomes are `valid`, `valid_partial_coverage`, `valid_no_data`,
`unsupported` (200) and `invalid` (422); a non-JSON body is 400.

`POST /api/plan/execute` takes the same body, revalidates it server-side and
applies it, returning the matching profiles, the selected observations and —
for exact-depth plans — a separate `derived` collection of interpolated values
labelled as computed rather than measured. `invalid` plans are refused with
422 and `unsupported` plans with `executed: false`. See
[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) §5a for the full contract and
`frontend/src/lib/planContract.ts` for the TypeScript types.

```bash
curl -X POST http://localhost:8000/api/plan/validate \
  -H 'Content-Type: application/json' \
  -d '{"schema_version":"1.0",
       "time":{"start":"2024-01-01T00:00:00Z","end":"2024-01-10T00:00:00Z"},
       "region":{"kind":"named","name":"argo_cached_subset"},
       "depth":{"mode":"range","min_m":0,"max_m":200},
       "variables":["temp","psal"]}'
```

### Natural-language drafting (optional, off by default)

Asking a question **proposes** an editable draft; it never runs a query and
never produces a number. FloatChat ships no bundled model vendor — it talks to
any service exposing the OpenAI-compatible `POST {base}/chat/completions` shape,
including self-hosted runtimes such as Ollama, vLLM, llama.cpp and LM Studio.

With nothing configured the feature is simply off: the question box explains
that it is not configured and **manual query building is unaffected**.

| Variable | Meaning |
|---|---|
| `FLOATCHAT_NL_PROVIDER` | `openai_compatible`. Unset disables the feature. |
| `FLOATCHAT_NL_BASE_URL` | Base URL exposing `POST {base}/chat/completions`. |
| `FLOATCHAT_NL_MODEL` | Model name passed through to that service. |
| `FLOATCHAT_NL_API_KEY` | Optional bearer token. **Server-side only.** |
| `FLOATCHAT_NL_TIMEOUT_S` | Request timeout, default `20`. |
| `FLOATCHAT_NL_MAX_OUTPUT_TOKENS` | Output cap, default `1200`. |
| `FLOATCHAT_NL_MAX_QUESTION_CHARS` | Question length cap, default `600`. |
| `FLOATCHAT_NL_RESPONSE_FORMAT` | `json_object` (default), `json_schema`, `none`. Google's Gemini structured-output examples use the `json_schema` form. |

Example, pointing at a local Ollama server:

```bash
export FLOATCHAT_NL_PROVIDER=openai_compatible
export FLOATCHAT_NL_BASE_URL=http://localhost:11434/v1
export FLOATCHAT_NL_MODEL=llama3.1
```

Credentials are read from the server environment, sent only to the configured
service, and never returned to the browser. The model receives the query schema
and a coverage summary — never observations, files or secrets — and returns a
JSON patch that the backend validates. No model-generated code, SQL or URL is
ever executed.

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
npm test           # interaction tests, Node's built-in runner, no extra deps
```

The explorer is driven by one editable draft query. Every control edits the
same plan; each edit is revalidated (debounced, with stale replies discarded)
and **Run** only applies the exact draft that was last validated. Results stay
labelled by the plan that produced them, so an edit never silently relabels an
earlier query's charts.

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
