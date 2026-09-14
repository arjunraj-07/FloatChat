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
| Plan contract | Pydantic 2 | `floatchat_core/plan.py`, `floatchat_core/plan_validation.py` |
| API | FastAPI + uvicorn | `api/main.py`, `api/plan_routes.py` |
| Frontend | Next.js 16.3.5, React 19, TypeScript, React-Leaflet, Plotly | `frontend/src/components/Explorer.tsx` |
| Frontend contract | TypeScript types | `frontend/src/lib/planContract.ts` |
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
- Query-plan validation: `POST /api/plan/validate` and
  `GET /api/plan/capabilities` (see §5a).
- 227 offline pytest tests covering the policies in §4 and §5a.

## 5a. Query-plan validator (Verified)

`POST /api/plan/validate` validates a structured exploration request. It does
**not** execute it, retrieve external data or call a model — a test asserts
that validation never performs a remote reference read.

**Plan schema version 1.0.** Request sections: `schema_version`, `time`,
`region`, `depth`, `variables`, `qc_policy`, `selection`, `analyses`,
`outputs`. Unknown fields are rejected (`extra="forbid"`) and NaN/Infinity are
refused (`allow_inf_nan=False`).

Conventions fixed by the schema:

- Coordinates are decimal degrees WGS84; latitude [-90, 90], longitude
  [-180, 180]. A box spans `south`→`north` and `west`→`east` **eastward**;
  `south < north` and `west < east` are required.
- **Antimeridian-crossing boxes are not supported** and are rejected with
  `antimeridian_not_supported`, because `west > east` is ambiguous between
  "crosses 180°" and "bounds reversed". Split into two boxes instead.
- Depth is metres positive down. Date and depth ranges are inclusive.
- Naive times are treated as UTC, matching the stored timestamps.

**Analyses are kept separate from outputs**: an analysis computes, an output
renders. Both enums include roadmap items so a request naming one gets a
precise "not implemented" answer instead of an opaque schema error. Membership
in an enum is never a claim of support; `ANALYSIS_CAPABILITIES` /
`OUTPUT_CAPABILITIES` decide. Currently **not implemented**:
`thermocline_estimation`, `salinity_gradient`, `marine_heatwave_detection`,
`anomaly_significance_test`, `forecast`, `globe_webgl`, `time_animation`,
`comparison_view`, `ocean_story`.

**Five outcomes**, kept distinct:

| Outcome | HTTP | Meaning |
|---|---|---|
| `invalid` | 422 | Schema/semantic violation, dangling float or profile reference, or an inapplicable QC policy. |
| `unsupported` | 200 | Well formed, but names an analysis or output with no implementation. |
| `valid_no_data` | 200 | Supported, but nothing matches. **Not** a malformed request. |
| `valid_partial_coverage` | 200 | Matching data exists, but not for the whole requested extent or every variable. |
| `valid` | 200 | Fully covered. |

A body that is not JSON, or not a JSON object, is `400`. Every response carries
`schema_version`, `outcome`, `requested` (the original echoed back),
`normalized_plan`, `errors`, `warnings`, `matching`, `coverage` and `dataset`,
and passes through `json_safe`.

Validation behaviour that was verified:

- **Availability comes from the loaded tables, not this document.**
  `DatasetIndex` derives platforms, profile ids, stored QC flags, data modes
  and extents from the DataFrames at call time.
- **Actual observations are used, not profile min/max metadata.** A depth
  window counts rows in that window. `coverage.depth` reports
  `median_level_spacing_m` and `max_level_gap_m` and a
  `sparse_vertical_sampling` warning, so a range is never read as continuous.
- **Requested bounds are preserved.** A 0–2000 m request stays 0–2000 m in the
  normalized plan; the shortfall is reported as `partial_depth_coverage`.
- **A requested variable is never dropped.** Salinity with 690 valid of 3,382
  levels yields `variable_partial` with per-status exclusion counts; a float
  with no valid salinity yields `variable_unavailable`. Temperature coverage is
  unaffected.
- **Range versus exact depth are distinguished.** `mode: "range"` starting at
  0 m is ordinary and sets `interpolation_required: false`. `mode: "at_depth"`
  sets it true and evaluates each profile with the production
  `match_value_at_depth`, so the no-extrapolation and 20 m gap rules are
  exactly the explorer's. For `at_depth` the depth filter is deliberately not
  applied, because bracketing levels above and below the target are needed.
- **An inapplicable QC policy is rejected.** The processed tables retain only
  QC=1 levels, so requesting flag 2 returns `qc_policy_not_applicable` rather
  than serving QC=1 data under another label. Mode `A` is supported by the
  pipeline but absent from the cached data, so requesting it returns
  `valid_no_data` with a `data_mode_absent` warning — supported but empty, not
  invalid.
- **Dangling references are errors, not empty results.** An unknown float or
  profile is `invalid`, distinguishing "that float does not exist" from "that
  float has no data in your window". A profile not belonging to a requested
  float gives `profile_platform_mismatch`.

`GET /api/plan/capabilities` returns the registry, enums, error/warning code
dictionaries and the live dataset extent, so the frontend need not hardcode a
second copy. `frontend/src/lib/planContract.ts` mirrors the schema in
TypeScript and is checked against the Python enums by
`tests/test_plan_contract_alignment.py`, which fails on drift and skips if the
submodule is not checked out.

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
- No natural-language layer and no LLM provider integration. The plan validator
  exists but **nothing produces plans yet**: the Explorer UI is not wired to it,
  so `planContract.ts` is currently unused by any component.
- The plan validator does not execute plans. There is no `/api/plan/execute`;
  a `valid` outcome means the request could be run, not that it has been.
- `partial_region_coverage` fires whenever the requested box is larger than the
  observed bounding box. Because the cached subset spans only 61.26–64.45 °E,
  most realistic region requests are reported as partial. This is accurate, not
  a defect, but it means `valid` is reached only by requests inside the
  dataset's own extent.
- The `requested` echo is JSON-safe, so a NaN submitted in the body is echoed
  back as `null` rather than byte-identically.

---

## 7. Commands actually executed and their outcomes

```bash
# Offline reprocessing — 3,382 observations, 11 profiles, 0 exclusions
venv/Scripts/python.exe scripts/data_feasibility/process_argo_data.py

# Full offline test suite — 227 passed (was 127 before the plan validator;
# 89 plan-validation tests + 11 contract-alignment tests were added, and no
# existing test changed or regressed)
venv/Scripts/python.exe -m pytest

# Bounded WOA cache build — 6 cells attempted, 6 failed (NCEI 503 outage)
venv/Scripts/python.exe scripts/data_feasibility/build_woa_cache.py --variables temp

# Frontend — exit 0
cd frontend && npx tsc --noEmit
cd frontend && npm run build

# Frontend lint — exit 1, 15 pre-existing `any` errors, none newly introduced
cd frontend && npm run lint

# Live server check (offline mode) — all endpoints correct, no NaN tokens.
# Confirmed over real HTTP that /api/plan/validate returns 200/422/400 as
# documented and that the explorer endpoints are unchanged.
FLOATCHAT_WOA_ALLOW_NETWORK=0 venv/Scripts/python.exe -m uvicorn main:app --port 8011
```

Environment variables: `FLOATCHAT_WOA_ALLOW_NETWORK` (`0` disables remote
reference reads), `FLOATCHAT_WOA_TIMEOUT_S`, `FLOATCHAT_MAX_GAP_M`.

---

## 8. Next milestone

The typed plan schema and `POST /api/plan/validate` are **done** (§5a). The
target flow remains:

> question + manual context → **typed plan** → backend validation → existing
> deterministic operations → structured results

**Next step: connect the explorer's manual filters and an editable query
preview to the validator.** Concretely:

1. Hold one `QueryPlanRequest` object in `Explorer.tsx` as the single source of
   truth, typed from `planContract.ts`.
2. Render manual controls (dates, region, depth, variables, QC policy, float
   selection) that edit *that same object* — not a parallel filter state.
3. On every edit, call `validatePlan()` and render `errors`, `warnings`,
   `coverage` and `matching` as the editable understanding preview. Manual
   edits must re-trigger validation, never bypass it.
4. Gate execution on `isExecutable()`; show `unsupported` and `valid_no_data`
   as explicit states rather than empty charts.

**Only after that**, add natural-language planning: a backend endpoint that
turns a question into the same `QueryPlanRequest`, which is then validated by
the existing validator before anything runs. The LLM interprets and explains;
it never computes a number and never bypasses validation.

- **The LLM provider is configurable and is not being changed.** All provider
  calls go through the backend; API keys must never appear in frontend code.
  `tests/test_plan_contract_alignment.py` asserts no credential-like token
  appears in the frontend contract.
