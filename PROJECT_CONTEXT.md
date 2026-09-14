# FloatChat — Project Context

Living handover document. Statements here are marked **Verified** (checked by a
command in this repository) or **Unverified** (reported, not yet confirmed).
Do not promote an Unverified item without running the check.

Last updated: 2026-09-14.

---

## 1. Product objective

FloatChat lets users explore real Argo ocean observations through
natural-language questions, editable scientific filters and linked
visualizations, across four dimensions: **longitude, latitude, depth, time**.

Intended full product:

- Natural-language query planning with an editable AI Understanding Preview.
- Manual region, date, depth, variable and analysis filters.
- Float locations, profile histories, time navigation.
- Temperature and salinity depth profiles.
- Thermocline and salinity-gradient analysis.
- Statistical anomalies against documented reference data.
- Surface marine-heatwave detection linked to Argo subsurface observations.
- Visible QC, source provenance, assumptions and data coverage.

Roadmap modes: Dive Mode, Float Detective, Compare Mode, Ocean Story,
Why Is This Unusual, Student/Scientific explanation modes.

A true-globe/WebGL experience remains a product requirement. **The current
Leaflet map is an accepted interim component and must be preserved.**

---

## 2. Stack and entry points (Verified)

| Layer | Technology | Entry point |
|---|---|---|
| Ingestion | Python 3.11, xarray, gsw, pandas | `scripts/data_feasibility/process_argo_data.py` |
| Scientific core | Pure Python + numpy | `floatchat_core/` |
| API | FastAPI + uvicorn | `api/main.py` |
| Frontend | Next.js 16.3.5, React 19, TypeScript, React-Leaflet, Plotly | `frontend/src/components/Explorer.tsx` |
| Tests | pytest | `tests/` |

`floatchat_core/` holds every scientific decision. `api/main.py` selects rows
and shapes responses; it contains no scientific logic. The ingestion script and
the API import the **same** functions, so the test suite exercises production
behaviour rather than a copy of it.

### Repository layout note (Verified)

`frontend/` is a **git submodule** pointing at
`https://github.com/arjunraj-07/frontend.git` (branch `master`). It was
previously a bare gitlink with no `.gitmodules`, so a normal clone produced an
empty directory. The nested repository and its history were left untouched;
only the parent's representation of it was corrected.

Clone with:

```bash
git clone --recurse-submodules https://github.com/arjunraj-07/FloatChat
```

`venv/` is no longer tracked (it previously contributed 14,459 tracked files).
The local environment on disk was not modified.

---

## 3. Verified dataset coverage

Computed from `scripts/data_feasibility/data/processed/` on 2026-09-14, not
copied from a previous report:

| Quantity | Value |
|---|---|
| Distinct floats | **6** |
| Distinct profiles | **11** |
| Observations retained | **3,382** (of 3,382 input rows) |
| Time range | 2024-01-01 00:50:30 → 2024-01-09 08:52:30 UTC |
| Latitude | 15.519 – 19.248 °N |
| Longitude | 61.256 – 64.446 °E (Arabian Sea) |
| Depth | 1.15 – 496.37 m |
| Profiles by data mode | D = 8, R = 3 |
| Temperature-only observations | **2,692** (2,658 salinity missing + 34 salinity QC-rejected) |
| Observations with salinity | 690 |

Source: ERDDAP Ifremer `ArgoFloats` tabledap subset, cached at
`scripts/data_feasibility/data/raw/argo_test_subset_full.nc`
(sha256 `93b7d36e848435de…`, recorded in `processing_report.json`).

Reprocessing is **offline** — the download is skipped when the raw file is
present. The rewrite was verified to reproduce every previously existing
column bit-identically; only additive columns were introduced.

---

## 4. Scientific policies (implemented and tested)

1. **Deterministic numbers.** All values come from `floatchat_core`. No LLM
   produces a number. (No LLM integration exists yet.)
2. **Mode-consistent selection.** `R` → raw value with *raw* QC. `A`/`D` →
   adjusted value with *adjusted* QC. Any other mode raises
   `UnsupportedDataModeError`; it is never coerced to raw. A missing adjusted
   value is never backfilled from the raw field.
3. **QC.** Only flag `1` is accepted. Encodings `b'1'`, `'1'`, `' 1 '`, `1`,
   `1.0`, `np.int8(1)` normalise; `''`, `'X'`, `1.5`, `NaN`, `inf`, booleans
   are refused rather than coerced.
4. **Temperature retained without salinity.** A level failing salinity QC keeps
   its temperature and carries `psal_status` plus `psal_exclusion_reason`.
   Excluded levels are emitted as `null`, never as continuous data; the chart
   uses `connectgaps: false`.
5. **Variable definitions preserved.** `TEMP` is in-situ temperature (ITS-90),
   `PSAL` is Practical Salinity (PSS-78). No conversion to Conservative
   Temperature or Absolute Salinity anywhere.
6. **Depth** is `-gsw.z_from_p(pressure, latitude)`, positive down. Verified
   against the independent UNESCO (1983) Fofonoff & Millard equation —
   agreement better than 0.01 m over 0–2000 dbar.
7. **Reference matching.** WOA23 `decav91C0`, 1991–2020, 1.00°, monthly,
   `t_an`/`s_an`. The month comes from the observation. Reference depths come
   from the file's own `depth` coordinate — the previously hardcoded candidate
   list was removed.
8. **No extrapolation.** A target outside the observed range is unavailable.
   An **exact** observed-level match is used directly and is *not* subjected to
   the bracket gap test. Otherwise interpolation happens only between two valid
   bracketing levels at most 20 m apart. Levels with missing values are dropped
   *before* bracketing, so a salinity gap widens the effective gap rather than
   being silently bridged. Unmatchable targets return a structured unavailable
   result with a reason.
9. **Limitations are stated in the response.** Every comparison carries: the
   nearest-grid-cell caveat, "a difference is not a statistical anomaly", and
   "a positive difference does not establish a marine heatwave".
10. **Provenance preserved.** WMO platform, cycle, direction, time, data mode,
    selected source variable names, QC flags, dataset id, source URL, raw-file
    checksum, retrieval timestamp, library versions and policy settings.
11. **Marine heatwaves are not implemented.** A daily-mean seasonal cycle
    cannot supply a historical 90th-percentile threshold. Not attempted.
12. **An OPeNDAP outage is a retrieval failure, not a mandate to download the
    global archive.** Retrieval is bounded and per-water-column.

---

## 5. Implemented and working (Verified)

- Offline reprocessing of the cached Argo subset with persisted QC,
  provenance and exclusion counts (`processing_report.json`).
- API: `/api/health`, `/api/coverage`, `/api/floats`, `/api/profiles/{id}`,
  `/api/woa_match/{id}`. All existing response keys used by the Explorer were
  preserved; new fields are additive.
- Explorer: Leaflet map, float/profile selection, Plotly temperature and
  salinity depth profiles with reversed depth axis and broken lines at gaps,
  evidence panel now showing fields used, QC counts, excluded salinity levels,
  retrieval provenance and variable definitions.
- 127 offline pytest tests covering the policies in §4.

## 6. Known limitations

- **WOA reference values are not currently available.** NCEI
  (`www.ncei.noaa.gov`) returned HTTP 503 / read timeouts on both its THREDDS
  OPeNDAP endpoint and its direct file path on 2026-09-14, while the host root
  responded 200 — a server-side outage. The cache under `data/reference/woa23/`
  is therefore empty and `/api/woa_match/` correctly reports
  `Comparison unavailable`. Retry with
  `python scripts/data_feasibility/build_woa_cache.py`. The success path is
  covered by tests using a stubbed reference column; it has **not** been
  confirmed against live WOA data.
- **Unverified:** the cached Jan–Jun 2024 regional SST series
  (`sst_daily.parquet`, 182 records per `provenance.json`) was not re-checked
  in this milestone. Nothing consumes it yet.
- Historical SST baseline retrieval remains blocked; marine-heatwave detection
  is not available.
- Browser verification was **not** performed — no browser tooling was available
  in this session. Build, type-check and API behaviour were verified instead.
- 15 pre-existing `@typescript-eslint/no-explicit-any` lint errors in
  `Explorer.tsx`, `Map.tsx`, `ProfileChart.tsx`. None were introduced by this
  milestone; typed API response models are deferred to the next one.
- Only the shallowest matchable reference depth populates the legacy scalar
  response fields; the full set is in `matches[]`.
- No natural-language layer, no LLM provider integration, no query planning.

---

## 7. Commands actually executed and their outcomes

```bash
# Offline reprocessing — 3,382 observations, 11 profiles, 0 exclusions
venv/Scripts/python.exe scripts/data_feasibility/process_argo_data.py

# Full offline test suite — 127 passed
venv/Scripts/python.exe -m pytest

# Bounded WOA cache build — 6 cells attempted, 6 failed (NCEI 503 outage)
venv/Scripts/python.exe scripts/data_feasibility/build_woa_cache.py --variables temp

# Frontend — exit 0
cd frontend && npx tsc --noEmit
cd frontend && npm run build

# Frontend lint — exit 1, 15 pre-existing `any` errors, none newly introduced
cd frontend && npm run lint

# Live server check (offline mode) — all endpoints correct, no NaN tokens
FLOATCHAT_WOA_ALLOW_NETWORK=0 venv/Scripts/python.exe -m uvicorn main:app --port 8011
```

Environment variables: `FLOATCHAT_WOA_ALLOW_NETWORK` (`0` disables remote
reference reads), `FLOATCHAT_WOA_TIMEOUT_S`, `FLOATCHAT_MAX_GAP_M`.

---

## 8. Next milestone

Add natural-language planning and the editable **AI Understanding Preview** on
top of the working explorer. The required flow is:

> question + manual context → **typed plan** → backend validation → existing
> deterministic operations → structured results

- Manual filter edits must update the *same* plan object and re-trigger
  validation — not bypass it.
- Unsupported analyses must produce explicit errors, never a silent fallback.
- The LLM interprets and explains; it never computes a number.
- **The LLM provider is configurable and is not being changed.** API keys must
  never appear in frontend code; all provider calls go through the backend.

Suggested first step: define the typed plan schema (Pydantic on the backend,
a matching TypeScript type on the frontend) and a `POST /api/plan/validate`
endpoint that validates a plan against the verified dataset coverage in §3 and
returns structured errors. That endpoint can be built and tested before any
provider integration exists.
