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
| Plan execution | Python | `floatchat_core/plan_execution.py` |
| NL planner | Python (provider-neutral) | `floatchat_core/nl_planner.py`, `floatchat_core/nl_provider.py` |
| API | FastAPI + uvicorn | `api/main.py`, `api/plan_routes.py` |
| Frontend | Next.js 16.3.5, React 19, TypeScript, React-Leaflet, Plotly | `frontend/src/components/Explorer.tsx` |
| Frontend contract | TypeScript types | `frontend/src/lib/planContract.ts` |
| Frontend draft state | TypeScript | `frontend/src/lib/draftPlan.ts`, `frontend/src/lib/querySession.ts` |
| Backend tests | pytest | `tests/` |
| Frontend tests | `node --test` (built in, no test framework added) | `frontend/tests/` |
| Explorer UI | TypeScript/React | `frontend/src/components/` (Explorer, AskBar, ProposalCard, QueryBuilder, PlanPreview, ProfilePanel, ProfileChart, CompareChart, Map, DetailsPanel, GettingStarted, CapabilityStatus, Term) |
| Explorer presentation model | TypeScript | `frontend/src/lib/explorerModel.ts` |

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
   produces a number. The natural-language planner proposes *query plans*
   only; it never computes, narrates or estimates a result (§5c).
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
  profile is `invalid` (422), described as *could not be resolved in the loaded
  dataset* — it may exist in the wider Argo archive but is not in the cached
  subset this instance validates against. This is distinct from "that float has
  no data in your window". A profile not belonging to a requested float gives
  `profile_platform_mismatch`.

### Effective policy reporting (Verified)

Every validation carries `effective_policy`, stating the QC flags and data
modes actually applied and whether each came from the **request** or from the
**default**. Pydantic's `model_fields_set` distinguishes the two.

- An **omitted** `qc_policy` produces `default_policy_applied`, naming the
  effective flags and modes and which modes exist in the loaded data. A mode
  missing only because the caller accepted the default is *not* reported as a
  shortfall against anything they asked for.
- An **explicitly requested** mode that no profile uses produces
  `data_mode_absent`. Mode `A` is supported by the pipeline but absent from the
  cached subset, so asking for it alone gives `valid_no_data`.
- Where the stored tables cannot evidence compliance, that is stated rather
  than assumed. Ingestion clears the salinity flag on levels it excluded, so a
  plan requesting `psal` gets `qc_metadata_incomplete` naming the number of
  levels (2,692) for which QC compliance is unknown either way. Temperature has
  complete QC metadata and produces no such warning.

### Spatial coverage messaging (Verified)

A min/max box of profile positions is **not** a coverage footprint, and is no
longer presented as one. `coverage.region` separates:

- `configured_search_region` — the area the archive was extracted for
  (60–65 °E, 15–20 °N), parsed from the recorded ERDDAP URL, so it is
  provenance-derived. Being inside it means data was *requested* here, not that
  any exists here.
- `observed_sample_bounds` — the bounding box of actual profile positions,
  carrying a `note` that locations inside it are not covered unless a profile
  was sampled there.
- `sample_locations` / `sampled_location_count` — the discrete positions
  themselves (11 for the full cached subset).

`spatial_sampling_is_pointwise` is emitted whenever data matches, and a request
reaching outside the extraction box gives `outside_configured_search_region`,
which says explicitly that nothing was ever retrieved there so its emptiness
carries no information about the ocean. The old `partial_region_coverage` code,
which implied the min/max box was "covered", was removed.

## 5b. Manual query, editable preview and Run (Verified)

**One draft is the source of truth.** `DraftForm` holds every control's value;
`formToPlan` converts it to a `QueryPlanRequest`. Numeric and identifier fields
are held as **strings** so a box can be cleared and retyped without the form
substituting a default mid-edit; an incomplete form yields field-associated
issues and **no plan**, so nothing half-typed is sent. Only parse-level problems
are detected locally — every semantic and scientific judgement comes from the
backend validator, so there is one authority and no duplicated rules. Malformed
float ids are deliberately passed through for the backend to reject.

**Date semantics are explicit and shown in the UI.** A date-only start becomes
`T00:00:00.000Z`; a date-only end becomes `T23:59:59.999Z`, so "through
10 January" includes all of 10 January rather than only its first instant. Both
ends are inclusive, in UTC.

**Validation is debounced and revision-tagged.** Edits bump `revision`; the
in-flight request is aborted via `AbortSignal` and the reducer additionally
drops any reply whose revision is no longer current, so a slow response can
never overwrite a newer one. Debounce is 400 ms.

**Four states are kept apart** (`querySession.ts`): current draft, latest
validation for that draft, last execution, and displayed results. Editing
invalidates the previous validation by construction — `currentValidation` only
returns a result whose revision still matches.

**Execution gating.** `isExecutable()` was inspected rather than trusted: it
correctly admits only `valid` and `valid_partial_coverage`, and was hardened to
also require an empty `errors` list and a non-null `normalized_plan`. It remains
**necessary but not sufficient**, because it cannot tell *which* draft a result
described; `canExecute()` adds revision equality, a complete form, and a
not-already-running guard. `invalid` and `unsupported` never execute; partial
coverage executes with its limitations displayed.

**Results never get relabelled.** Displayed results carry the plan the server
executed, so after an edit they still describe themselves by what produced them
while a banner states they came from a previous query.

### `POST /api/plan/execute` (Verified)

Revalidates the submitted plan server-side — a client cannot execute one by
claiming it was already approved — then applies it with the *same*
`apply_filters` helper the validator counts with, so preview counts and returned
records cannot drift. Returns the executed plan, the full validation, the
dataset identity and the results.

- `invalid` → 422, `executed: false`. `unsupported` → 200 with a
  `refusal`. `valid_no_data` executes and returns an explicitly empty result.
- Region, time, float/profile ids, depth and requested variables change the
  **actual returned records**, not only counts: a 0–50 m plan returns 378 of
  3,382 levels with a maximum depth of 49.90 m, and dropping `psal` removes the
  salinity fields from the records entirely.
- Temperature-only levels survive: in a 0–50 m temp+psal run, 282 of 378 levels
  carry temperature with `psal: null` plus `psal_status` and
  `psal_exclusion_reason`.
- **Exact-depth values are never disguised as observations.** They are returned
  in a separate `derived` collection, each `derived: true` with its method,
  bracketing levels and gap, computed by the production
  `match_value_at_depth`, so no-extrapolation and the 20 m gap rule apply.
  Every entry in `observations` has `derived: false`. The chart draws derived
  values as open diamonds with an explanatory caption.
- An unavailable WOA comparison does not block anything: the comparison panel
  reports it and the profile charts, map and evidence panel still work.

`GET /api/plan/capabilities` returns the registry, enums, error/warning code
dictionaries and the live dataset extent, so the frontend need not hardcode a
second copy. `frontend/src/lib/planContract.ts` mirrors the schema in
TypeScript and is checked against the Python enums by
`tests/test_plan_contract_alignment.py`, which fails on drift and skips if the
submodule is not checked out.

## 5c. Natural-language drafting (Verified)

A question **proposes an editable draft**. It never runs a query and never
produces a number. The flow is:

> question + explicitly supplied manual context → proposed draft → existing
> validation → editable preview → user presses Run → existing execution

### Provider boundary

FloatChat ships **no bundled model vendor**. `floatchat_core/nl_provider.py`
defines a narrow `complete_json` protocol and one vendor-neutral adapter
speaking the widely implemented OpenAI-compatible `POST {base}/chat/completions`
shape, which self-hosted runtimes (Ollama, vLLM, llama.cpp, LM Studio) and
several hosted services accept. It uses `requests`, already a dependency, so
**no vendor SDK entered the repository**.

| Environment variable | Meaning |
|---|---|
| `FLOATCHAT_NL_PROVIDER` | `openai_compatible`. **Unset disables the feature.** |
| `FLOATCHAT_NL_BASE_URL` | Base URL exposing `POST {base}/chat/completions`. |
| `FLOATCHAT_NL_MODEL` | Model name passed through to that service. |
| `FLOATCHAT_NL_API_KEY` | Optional bearer token. Server-side only. |
| `FLOATCHAT_NL_TIMEOUT_S` | Request timeout, default 20. |
| `FLOATCHAT_NL_MAX_OUTPUT_TOKENS` | Output cap, default 1200. |
| `FLOATCHAT_NL_MAX_QUESTION_CHARS` | Question length cap, default 600. |
| `FLOATCHAT_NL_RESPONSE_FORMAT` | `json_object` (default), `json_schema`, or `none`. |

With nothing configured — the current state — `GET /api/plan/nl_status` reports
`configured: false`, `POST /api/plan/draft` returns **503** with
`provider_not_configured`, the question box renders a "Natural-language service
not configured" notice, and **manual exploration is entirely unaffected**. A
*half*-configured deployment fails loudly rather than pretending to be off.

Credentials never reach browser code: the key is read from the server
environment, sent only as an `Authorization` header to the configured service,
and excluded from every response (`credential_configured` is a boolean).

### What the model is given, and what it may return

It receives the schema, vocabulary, capability registry and a **coverage
summary** — extents and counts only. No observation arrays, no NetCDF bytes, no
secrets. The measured prompt is ~5.7 KB.

It returns a small JSON **patch**, never a finished plan, and never executable
content. No model-produced Python, SQL, URL or tool call is ever executed.
Everything that matters is then decided in deterministic code:

- **Omitted fields are retained** from the caller's draft, so a question about
  depth cannot quietly reset the region.
- **`qc_policy` is not patchable**, so QC can never be relaxed by a model.
- **Capability truth comes from the registry**, not the model's opinion — in
  either direction.
- **The change list is computed by `diff_plans`**, so a model that misdescribes
  its own edits does not affect what the user is shown.
- **The proposal is validated by the ordinary validator**, so availability is
  reported honestly.

### Four distinct outcomes

| Outcome | HTTP | Meaning |
|---|---|---|
| `proposed_draft` | 200 | A schema-valid plan to edit and run. |
| `clarification_needed` | 200 | Under-specified; a question is returned, the draft untouched. |
| `unsupported_request` | 200 | Names an unimplemented capability, or a policy change a question may not make; nothing is substituted. |
| `provider_unavailable` | 503 | Not configured, timed out, or an unusable reply. |

Verified over real HTTP against a loopback provider:
"show temperature at 100 m" → `proposed_draft` changing **only** `depth`, with
region/time/variables listed as retained; "compare it with last summer" →
`clarification_needed` and no plan; "detect a marine heatwave" →
`unsupported_request` naming the missing daily SST series and 90th-percentile
baseline; "temperature in summer 2019" → dates preserved as **2019-06-01 to
2019-08-31** and validating to `valid_no_data` with no errors.

**A requested date or region is never rewritten to where cached data happens to
exist.** Relative dates resolve against an explicit `reference_date` (UTC),
which is echoed back in the response and shown in the UI.

### Integration with the revision model

Asking is tagged with the draft revision it described. A reply is **never
applied automatically**: it is stored and offered, and if the user edited
controls while it was in flight it is labelled "made for an earlier version of
the query" rather than overwriting that newer work. Accepting is an ordinary
`edit`, so the revision advances and the proposal flows through the same
validation as any manual change. Generating a draft does not run it.

### Gemini configuration and live smoke test (2026-09-14)

`scripts/run_api.ps1` persists only non-secret settings - provider
`openai_compatible`, base URL
`https://generativelanguage.googleapis.com/v1beta/openai/`, model
`gemini-3.1-flash-lite` - and inherits `FLOATCHAT_NL_API_KEY` from the
environment. The key is never written to a file.

- **URL join verified.** The trailing slash is stripped before
  `/chat/completions` is appended, giving
  `.../v1beta/openai/chat/completions` with no duplicated path.
- **`response_format`, corrected.** An earlier note here said Google does not
  document `response_format`. That was wrong: Google's structured-output
  examples pass it (`response_format=Model` in Python, `zodResponseFormat` in
  JavaScript), and the OpenAI SDKs send those as `{"type": "json_schema"}`.
  Those examples do not show the `{"type": "json_object"}` form this adapter
  sends by default, so compatibility with our actual request is **unverified**.
- **First credential: rejected.** Five `/api/plan/draft` requests (no
  retries) all returned HTTP 400 in 0.13-0.56 s. A read-only compatibility
  `GET /v1beta/openai/models` returned HTTP 400 `INVALID_ARGUMENT` "Invalid
  Auth key.", and a native `GET /v1beta/models` with `x-goog-api-key` returned
  HTTP 401 `UNAUTHENTICATED`. An earlier version of this note inferred from the
  key's format that it was probably incomplete. **That inference was
  unfounded:** Google issues both standard and authorization keys, so format is
  not a validity test. The cause (credential validity, restrictions or project
  access) was never determined.
- **Replacement credential: authentication verified.** A new Google AI Studio
  key was saved on 2026-09-14. Its User-scope and process values are present
  and identical. A native `GET /v1beta/models` (`x-goog-api-key`) returned
  HTTP 200 listing 56 models, including `models/gemini-3.1-flash-lite`. The
  OpenAI-compatible `GET /v1beta/openai/models` (Bearer) returned HTTP 200 and
  also lists it.
- **Generation smoke tests: 5 scenarios, 8 generation requests over two
  rounds, no retries.** Round 1 had three HTTP 503 capacity errors from
  Gemini; those three scenarios were re-run in round 2. Every reply that got
  through was bare JSON under `json_object` (5 of 5). That is evidence, not
  proof, that structured output holds; the adapter still extracts and
  validates defensively. This is a smoke test, not an accuracy benchmark.
  - "Show temperature at 100 m" from a salinity-only draft: `variables` and
    `depth` changed; region, dates and QC retained; validator
    `valid_partial_coverage`. Pass.
  - "Show temperature and salinity between 0 and 200 m" from temperature-only,
    0-500 m: `variables` and `depth` changed; the rest retained; validator
    `valid_partial_coverage`. Pass.
  - "Show temperature in June 2019": only `time` changed; 2019 kept rather
    than moved to 2024; validator `valid_no_data`. Pass (see the date note).
  - "Detect a marine heatwave": `unsupported_request` naming
    `marine_heatwave_detection`, no proposal. Pass, but the reason shown is the
    generic planner text rather than the registry's documented reason.
  - "Include QC=4 observations": `unsupported_request`, no proposal, QC
    unchanged. **Partial:** the explanation is generic, not the QC-policy
    reason. The model named the request instead of patching `qc_policy`, and
    only the patch path produces the policy-specific reason, even though the
    prompt tells the model to name such requests.
- **Date normalization, found here and fixed in §5e**
  (`tests/test_date_normalization.py`,
  `frontend/tests/dateNormalization.test.ts`). A date-only end
  (`2019-06-30`) parsed to 00:00 that day in the backend, although the planner
  prompt promised end of day. Accepting a proposal with naive timestamps
  re-read them in browser-local time, while the backend read them as UTC: in
  UTC+5:30, June 2019 shifted to `2019-05-31T18:30Z`..`2019-06-30T18:29:59Z`.

Fixes made while testing:

- A question asking to change the QC policy (e.g. "include QC=4 observations")
  now yields `unsupported_request` with a reason derived from the stored QC
  flags, instead of a no-op `proposed_draft`. When the reply's only content is
  unsupported, no plan is offered.
- Unsupported requests the model declares are surfaced unless they name an
  implemented analysis or output; the registry still overrules the model there.
- The prompt now says to set every field the question names ("temperature at
  100 m" sets both `variables` and `depth`).
- Provider error bodies are surfaced with credentials scrubbed: status and
  message only, with the configured key, bearer tokens and Google key shapes
  removed, capped at 240 characters. A bare "HTTP 400" could not tell an
  invalid key from an unknown model.

## 5d. Demonstration explorer (Verified)

The frontend was reorganised for a basic demonstration. The draft, validation
and execution session (`querySession.ts`), the planner, the validator and the
execution endpoint are reused unchanged; no scientific calculation moved into
the frontend.

- **Header**: Ask in words with example chips. A chip only fills the question
  box; it never calls the provider or runs anything. Student/Scientific toggle
  and a "What works" list read from `/api/plan/capabilities`.
- **Filter sidebar**, collapsible (a drawer on small screens). Only implemented
  analyses and outputs are offered as controls; an unavailable one that arrives
  in a draft is listed with a remove control instead of being hidden.
- **Query bar**: validation badge, plain-language draft summary and **Run**,
  always on screen; a stale-results notice appears when filters change after a
  run, while the earlier results stay displayed and labelled by their own plan.
- **Regional map** beside the **selected-profile panel**, with expandable
  details below: the run and its coverage notes, evidence and provenance,
  derived values, the difference from climatology, and (scientific view) the
  raw response.
- **Before any run**: a getting-started panel and **Use cached data**, which
  fills the draft from `/api/coverage` (box rounded outward to 0.01 degrees,
  first and last observation day, 0 m to the deepest level, temperature and
  salinity) and lets validation run. Execution still needs Run. The map shows
  every cached position in grey, labelled "Dataset overview ... not query
  results".
- **Float Detective**: float and profile selectors, Earlier/Later within the
  float ordered by observation time, "Profile k of n from float X available in
  this result", UTC date, position, observed depth range and per-variable
  availability. Map clicks and the chart stay in sync.
- **Profile chart**: temperature and salinity as two panels sharing one depth
  axis rather than two x-scales on one plot. An empty panel states why it is
  empty without borrowing the other panel's scale. Derived exact-depth values
  are open diamonds.
- **Compare**: two profiles from the executed result, one variable at a time,
  on common axes with depth downward; A is solid blue with circles, B dashed
  orange with squares (palette validated: CVD dE 24.7, normal-vision dE 33.6).
  Missing-data notes are shown; nothing is smoothed or interpolated and no
  profile is labelled unusual. Selections reset when a new result no longer
  contains them.
- **Student/Scientific**: identical data, policies and calculations.
  Scientific adds units, TEMP/PSAL naming, QC and raw/adjusted fields,
  provenance, validator codes and interpolation details. Explanations are a
  static glossary; no model is called.
- Backend timestamps are displayed as UTC (a naive stored timestamp means
  UTC). The accept-proposal date issue is fixed in §5e.

Verification: `frontend/scripts/verify-ui.mjs` drives headless Chrome at
1366x768 over the DevTools protocol against the running app. 26/26 checks
passed with no page errors: dataset-overview labelling, Use cached data
validating without running, Run showing the map and a chart together with Run
still on screen, map-click selection, float navigation, a temperature-only
profile with an undistorted temperature axis, scientific naming, two-profile
comparison for both variables, and results kept (flagged stale) after a draft
edit. The screenshots were inspected; they exposed an empty-panel axis bug and
an unusable small-screen header, both fixed before the final run.

## 5e. Explorer correctness and usability patch (Verified)

**Dates and time zones.** The timestamp was traced from the model reply
through `draft_plan` (`plan_patch.time`), `proposed_plan`, `applyPlanToForm`
and `toDateField`, the `DraftForm` text, and `formToPlan` /
`startInstant` / `endInstant` into the request.

- Backend: a date-only end now means the last instant of that UTC day
  (`T23:59:59.999999Z`), as the planner prompt and the date fields already
  promised. Plans a client writes itself keep the documented rule that a
  naive timestamp means UTC.
- Planner: a model-proposed timestamp must carry an explicit offset; a date
  alone is accepted as a UTC day. A timestamp without one is rejected with
  `timestamp_timezone_missing` (one error per affected edge) and a message
  telling the user to ask again or set the dates in the filters. Nothing is
  applied and the draft is unchanged. The prompt states the rule, and every
  proposed time is returned in explicit UTC.
- Frontend: date fields are parsed without the browser's time zone
  (`parseTimeText`). Date-only text stays `YYYY-MM-DD` with inclusive UTC days;
  explicit timestamps keep their instant; an instant on a UTC day boundary is
  shown as a date and any other instant in UTC. A timestamp without a zone
  stays in the field with the message "... has no time zone ...", and the
  draft cannot be validated or run until it is corrected.
- Tests: the backend strict xfail and the frontend `todo` are now passing
  regression tests. Frontend cases run under UTC, Asia/Kolkata and
  America/New_York, with a guard proving the zone change takes effect. They
  cover a +05:30 proposal whose end falls on the next local day, an instant
  that is not on a day boundary, the Gemini naive reply and the session never
  making it runnable. Backend cases cover offset conversion, a one-day
  date-only range that now finds the 2024-01-09 profiles, and the rejection
  through the real route. All use fixtures; no provider was called.

**Missing data.** Messages are built from the stored exclusion statuses:
`missing_value` "had no value in the source file", `qc_rejected` "failed
quality control", `qc_malformed` "had an unreadable quality flag". Excluded
levels without a stored reason (temperature has no status column) are
"excluded for a reason the cached data does not record". A missing value is
never called a QC failure; in the cached data 2,658 salinity levels are
`missing_value` and 34 are `qc_rejected`. The same wording is used in the
availability chips, empty chart panels, compare notes and details panel, and
in the validator's `variable_partial` message, which printed a raw dictionary.

**Student view.** Units stay visible: Temperature (°C), Depth (m), and
"Salinity (PSS-78, no unit)" rather than a bare axis. Chips read "measured at
N depths, no usable value at M", so partial coverage is not hidden. Derived
values keep their open diamonds and "not measurements" note.

**Compare.** The two selectors are stacked one per row with compact labels,
"Float 2902201 · cycle 287 · 2024-01-05 12:13 UTC" (descending
profiles are marked). The full identity (profile id, direction, time and
position) is the control's title and accessible name. The legend and notes
use the same labels.

Verification: backend 383 passed (was 374 + 1 xfail); frontend 98 passed (was
82 + 1 todo); tsc, lint and build exit 0. Headless Chrome with the browser
zone set to Asia/Kolkata passed 33/33 checks with no page errors. They
include both selected compare labels measured unclipped at 1366 px, an offset
end date read as its UTC day, and a time without a zone reported rather than
guessed.

## 5f. Time navigator (Verified)

A compact control below the map steps through the latest executed result by
observation time. It is display state only: it never edits the draft or its
dates, calls the model or runs a query. The browser run counted execute,
draft and validate requests before and after navigating; they were unchanged.

- Steps are the distinct observation timestamps of the returned profiles
  (`results.profiles[].time`, read as UTC); profiles sharing a timestamp form
  one step. Retrieval and execution times are not used, no daily samples are
  invented and no movement is interpolated. Unreadable timestamps are
  reported, not placed.
- The visible set is the returned profiles observed on or before the selected
  step. "Showing N of M returned profiles through <timestamp> UTC." keeps
  visible and returned counts apart; the map header still reports the whole
  result.
- Map markers follow the visible set. The view stays fitted to the whole
  result, so it does not jump, with room kept clear above the legend. A time
  step opens a profile observed at that time (ties go to the first profile
  id). Marker clicks, Float Detective and Compare stay within the visible
  set. A Compare choice observed after the selected time is shown as cleared
  with a note, never substituted, and returns when the time includes it.
- Lifecycle: a new execution, even of the same plan, resets to the latest
  step with playback stopped. Play from the final step restarts at the first.
  Playback advances one actual step every 1.2 s, stops at the end, pauses when
  the tab is hidden, and clears its timer on unmount. With one timestamp it is
  shown and playback and stepping are disabled. With no result it shows a
  one-line unavailable state.
- Code: `frontend/src/lib/timeNavigator.ts` (pure logic),
  `components/useTimeNavigator.ts` (timer and tab visibility) and
  `components/TimeNavigator.tsx` (presentation), kept separate for the
  planned redesign. `comparisonAtTime` in `explorerModel.ts` generalises
  `resolveComparison`.
- `scripts/run_api.ps1` now defaults to cache-only WOA reads
  (`FLOATCHAT_WOA_ALLOW_NETWORK=0` unless already set); a cache miss reports
  the comparison as unavailable. Cache building stays manual.

Verification: frontend 120 tests passed (22 new); backend 386 passed (3 new:
the launcher default, the launcher never building the cache, and a cache miss
without a remote read); tsc, lint and build exit 0. Headless Chrome passed
56/56 checks with no page errors. The screenshots exposed markers hidden under
the map legend, because the map had been fitted before its card shrank; this
is fixed and now checked. A query that validates as having no data cannot be
run from the UI, so the executed-but-empty navigator state is covered only by
the pure-logic test for an empty result, not in the browser.

This is a time filter over one 2D regional result. It is not the 4D (globe,
depth and time) explorer.

## 5g. Four-section navigation (Verified)

The explorer is organised into **Map Explorer**, **AI Assistant**, **Compare**
and **About Data**. They are chosen from a top navbar (a menu button below the
md breakpoint) that also holds a compact Student/Scientific switch. One
workspace is shown at a time. The colour palette is unchanged until a visual
reference is provided.

- **Shared state** stays in `Explorer.tsx`, above the sections: the query
  session, the question and proposal, the selected profile, the time position,
  Compare choices and the view preference. Map Explorer stays mounted while
  hidden, so the map keeps the user's panning: it fits once per result and
  never re-measures while hidden. The other sections render when opened.
  Navigating never calls the model, validates or runs a query (checked by
  request counts), and leaving Map Explorer pauses playback at the current
  time.
- **Map Explorer** (the default section) has a toolbar with Filters, a
  one-line draft summary and Show results (the former Run). The filter drawer
  starts closed and Escape closes it. The map carries the time navigator
  beneath it once a result exists, beside the labelled selected-profile panel
  with its chart; the expandable scientific details sit below the profile.
  Before a result it shows the labelled dataset overview, a short note and Use
  cached data.
- **AI Assistant** states what the assistant does: it proposes query
  settings, and does not answer questions or calculate values. It holds the
  question and example chips, and a three-step journey (Ask a question →
  Review the proposed query → Show results on the map) with one primary
  action per stage. Accepting reuses the existing session action, and a
  successful Show results opens Map Explorer with that result. The pending,
  clarification, provider-error, unsupported and stale states are kept. The
  stage is derived from the session in `navigation.ts`, using a new
  `acceptedRevision` field recorded by `draft:accept`.
- **Compare** has two selectors, the variable switch, a large chart and
  availability notes, over the current result and time view. An active time
  restriction is stated, with View all returned times: that moves to the
  latest timestamp without changing the open profile or rerunning the query.
  A remembered choice outside the time view is shown as temporarily
  unavailable and never substituted; with nothing to draw, a short
  explanation replaces empty axes. Before a result there is a short note and
  Open Map Explorer.
- **About Data** covers the loaded coverage and observation dates, the source
  with its processing date kept separate, the kinds of values (measurement,
  derived, climatology), limitations (shown open), missing-data reasons with
  the stored counts, quality control, variables and units, capabilities and
  the glossary.

Verification: frontend 131 tests passed (11 new, covering sections, the
playback-pause rule, assistant stages through the real reducer, and the
toolbar summary); tsc, lint and build exit 0. Headless Chrome with the browser
zone set to Asia/Kolkata passed 88/88 checks with no page errors at 1366x768
and 390x844. The checks cover each section, state kept across sections,
manual query to results to chart, time navigation followed by Compare, the AI
flow and its error states, unavailable data and the phone menu. AI drafts in
that run were fixture replies served by request interception, proven with a
probe first; no model was called. The backend was not changed. Screenshots
also exposed an empty Compare chart with misleading axes, a lowercase source
label and a date split across lines; all three are fixed.

## 5h. WebGL globe and regional depth scene (Verified)

Map Explorer's visualization area now switches between three views:
**Regional map** (the Leaflet view, unchanged and kept mounted), **Globe**,
and a regional **depth scene** opened from the globe with Explore depths
(Back to globe returns). All three use the same executed result, the time
navigator's visible set and the selected profile. Switching views does not
call the model, validate or run a query, and it keeps the time position and
selection.

- **Globe.** A WebGL sphere with Natural Earth 1:110m land outlines (public
  domain; from the world-atlas 2.0.2 package, ISC, decoded with
  topojson-client 3.1.0, ISC) and a 30° graticule. Profiles sit at their
  reported latitude and longitude (x = r cos φ sin λ, y = r sin φ,
  z = r cos φ cos λ). The data area is outlined and labelled as the only
  coverage. Before a result, the markers are the grey cached overview,
  labelled as not query results, and Explore depths is disabled. Drag
  rotates, scroll or pinch zooms, and Focus on results moves to the results;
  selecting a marker opens the same profile panel and chart. The globe draws
  no tracks.
- **Depth scene.** Longitude, latitude and actual depth are drawn in a local
  equirectangular frame about the result's centre: 111.32 km per degree of
  latitude, and cos φ0 of that per degree of longitude (about 1% east-west
  error across 15.5–19.3° N). Depth is drawn ×500, the largest round factor
  that keeps depth within 60% of the horizontal extent. The factor is stated
  in the note, the depth-axis title and the legend, while labels and details
  give actual metres. The scene has a surface degree grid with labels, a
  north marker and a depth axis in metres. Each profile is a column anchored
  at its reported position, with the note "Depth samples are positioned at
  the reported profile location. These columns are not measured underwater
  tracks."
- **Colour and samples.** Samples are the returned levels on a sequential
  scale (temperature: oranges, °C; salinity: blues, PSS-78, no unit). The
  scale is fixed per result, from all its finite values. Levels without a
  valid value are grey and off the scale; backend-derived values are
  diamonds. Selecting a sample shows the profile identity, observation time,
  actual depth, value, and measured, derived or missing status with the
  stored reason, and opens that profile's chart. Nothing is interpolated,
  smoothed or connected between floats.
- **Time.** The existing navigator drives both views. A step changes the
  markers and samples, not the camera or the colour scale.
- **Rendering.** React Three Fiber 9.7.0 with three 0.186.0, compatible with
  React 19.2.8 (no forced peers and no other upgrades). Markers and samples
  are instanced meshes, and each view's lines are one batched geometry. The
  canvases render on demand, so there are no frames while idle or while Map
  Explorer is hidden. Cameras are remembered per result and refitted only for
  a new result or by Focus on results / Reset view. Geometries, materials,
  textures, controls and listeners are disposed on unmount. Without WebGL, on
  a WebGL error or on context loss, the view is replaced by a message and
  "Use the regional map".
- **Verification probe.** The 3D views publish read-only screen positions,
  the renderer and frame counts on `window.__floatchatScene`, so the browser
  checks can click real markers and samples.

Verification: frontend 151 tests passed (20 new, covering globe and regional
mapping, depth direction and exaggeration, time-visible membership, missing
and derived samples, and stable colour scales); tsc, lint and build exit 0;
the backend was not changed. Headless Chrome with the browser zone set to
Asia/Kolkata passed 116/116 checks with no page errors. It rendered with
*hardware* WebGL 2 (ANGLE, Intel HD Graphics 620, Direct3D 11), as reported by
the WebGL renderer string; no performance was measured. A second browser
started with `--disable-3d-apis` showed the fallback message and returned to
the 2D map. The screenshots exposed a depth-scene camera that clipped the
scene under the legend, and a location marker covering the shallowest level;
both are fixed.

## 5i. Recorded profile history and depth-scene usability (Verified)

- **Coverage wording.** `/api/coverage` gains `search_region`: 60–65° E,
  15–20° N, parsed from the recorded extraction URL. The globe outlines
  that region and labels it "Cached search region (…): the area this
  dataset was extracted for. Profiles were recorded only at the marked
  points, not across the whole region.", followed by "Argo profiles outside
  this region are not part of the cached data." It no longer says there is
  no data elsewhere. `bounding_box` remains the extent of the recorded
  profile locations. When no search region is recorded, the outline is
  labelled as that extent instead.
- **Profile history.** In the cached result, 2 of 6 floats have more than
  one distinct usable location: 6903060 has 5 and 2902390 has 2, giving 5
  connections; the other 4 floats have one location each and get no history.
  - `profileHistories` (`lib/profileHistory.ts`) groups profiles by float
    and orders them with the existing `byObservationTime` (time, then
    profile id). It collapses duplicate profile ids and repeated positions,
    and skips unusable positions or times.
  - The optional "Show profile history" toggle on the globe draws subdued
    dashed straight joins between successive recorded locations of the same
    float within the returned result. There are no intermediate points,
    speeds or cross-float joins, and the markers stay selectable.
  - The legend reads: "schematic connections between one float's recorded
    profile locations, in time order within this result. Not measured
    underwater tracks."
  - A connection is shown only when both of its endpoints are visible at
    the navigator's time.
  - Toggling is shared display state. It does not move the camera, edit the
    draft, run a query or call the model.
  - Markers and dashes scale with the camera's height, so they keep a
    roughly constant on-screen size. With history shown, "Focus on float N"
    frames the open profile's float, where its joins (about 50 px in the
    check) are clearly longer than the markers (about 16 px). At the Focus
    on results view, that float's five locations overlap.
  - On phones the globe legend is one compact coverage line, with the full
    wording in a "More" disclosure, so it stays inside the globe.
- **Depth scene.**
  - **Layout:** the legend and controls moved out of the canvas, into a side
    panel on desktop and stacked above the scene on phones (the key and
    counts fold into a disclosure there). The depth axis sits just outside
    the grid corner, clear of the degree labels. The camera fit covers the
    grid, the exaggerated depth and the axis labels, using the canvas aspect
    ratio, and the browser check confirms every sample and axis label is in
    view.
  - **Stepping:** "Shallower / Deeper" move through the recorded levels of
    the selected profile; derived values are not recorded levels and are
    skipped.
  - **Details:** the selected level stays highlighted, and its details show
    the returned depth (2 decimals, full value on hover), the recorded
    pressure, the value, and its measured, derived or missing status.
    Nothing is rounded to a grid or interpolated.

Verification: backend 387 passed (1 new, for `search_region`); frontend 164
tests passed (13 new, covering history grouping, ordering, duplicates,
unusable points, time filtering and exact level depth and pressure); tsc,
lint and build exit 0. Headless Chrome with the browser zone set to
Asia/Kolkata passed 129/129 checks with no page errors, using hardware WebGL
2. Expected connections and eligibility in that run were computed from
`/api/floats` independently of the app code. The phone layout and the
`--disable-3d-apis` fallback were rechecked. A first passing run still looked
wrong in the screenshots: fixed-size markers hid the joins, the phone legend
covered the Play button, and axis labels collided. All three are fixed
above.

## 5j. Marine-atlas visual redesign and cinematic introduction (Verified)

The `floatchat-marine-atlas` export was used as a **design reference and
component source**, not as an application. Nothing about the data, the query
workflow or the scientific wording changed.

- **Taken from the export:** the palette (deep marine `#16323C` navigation,
  muted sea-green `#0B6864`, warm neutral `#F1F0E9`/`#F9F8F3` surfaces, ochre
  `#8A512B` for cautions), IBM Plex Sans/Mono, the radii, spacing and motion
  tokens (`--ease: cubic-bezier(0.2,0,0,1)`, 170/160/240/200 ms), and the
  component language - topbar, cards, chips, segmented controls, stage rail,
  filter drawer, contents rail. These live in `src/app/globals.css` as CSS
  custom properties exposed through Tailwind v4 `@theme inline`.
- **Left behind deliberately:** the export's Express server, its synthetic
  `preview-fixture.ts` profiles, its rule-based demo question parser, its
  "Simulated UI only" preview panel, its SVG map placeholder, and its
  shadcn/Radix, framer-motion, drei and wouter dependencies. **No new runtime
  dependency was added.** The export's account screens were not ported; see
  `AUTHENTICATION.md` for why and for what real authentication would require.
- **Navigation** keeps the four sections (§5g) and every test id, now with
  `01`-`04` index labels, an active underline, and the Student/Scientific
  switch in the topbar (in the menu on phones).
- **Cinematic introduction** (`components/IntroScene.tsx`,
  `lib/introProgress.ts`):
  - It is an **overlay with its own scroll container** above the workspace,
    which stays mounted underneath. Skipping or replaying it therefore costs
    no map view, camera, selection or query state.
  - Three scroll-linked chapters over 2.05 viewports: the ocean planet, the
    cached study region, and a schematic look below the surface. Progress,
    chapter boundaries, camera easing and the motion rule are pure functions
    in `lib/introProgress.ts`, unit-tested without a browser.
  - **It shows real data.** The globe uses the same Natural Earth coastlines
    as the globe view - now shared through `components/scene/coastlines.ts`,
    which also removed the duplicate topojson decode in `GlobeView` - and the
    second chapter outlines the recorded `search_region` with the **actual
    cached profile positions** inside it, labelled "Profiles were recorded
    only at those points, not across the whole region."
  - The third chapter is a drawn float and an evenly spaced ruler, labelled
    "Schematic sequence · not a measured trajectory". The planet and the
    underwater scene never share a frame: any position near the view axis at a
    workable camera distance falls inside the globe's radius and would be
    hidden by it, so the chapters cut between them.
  - **Motion is controllable.** A visible "Skip introduction", a "Pause
    motion" toggle, pausing when the tab is hidden, and
    `prefers-reduced-motion: reduce` turning ambient motion off and flattening
    the story into a static readable sequence. The canvas renders on demand,
    so a paused, hidden or reduced-motion scene draws nothing at all - the
    browser check confirms the frame counter stops.
  - It plays once per browser (`localStorage["floatchat.intro.seen"]`, which
    the app works correctly without). `?intro=0` skips it and `?intro=1`
    always plays it; the browser checks use both.
- **Preserved and re-verified:** real Argo values, QC policy and provenance;
  the draft/validate/execute and stale-proposal state machine; the
  backend-only provider; the globe, depth scene and WebGL fallback; profile
  history and time filtering; exact-level Shallower/Deeper; and Compare
  selections, timeline position and camera across navigation.

Verification: frontend 171 tests passed (7 new, covering scroll progress,
clamping, chapter boundaries, camera easing and the motion rule); tsc, lint
and `next build` exit 0. Headless Chrome passed **139/139** checks with no
page errors on hardware WebGL 2, including ten new introduction checks. No
backend file changed, so the backend suite was not re-run.

Three defects were found by these checks rather than by reading the code: a
unit test caught `floatDescent(1)` returning 0.99, so the float never finished
its descent; the Compare chart lost 48 px to the new workspace header and fell
below its readable minimum; and a section heading was styled with the 10 px
uppercase *eyebrow* token, rendering "PROPOSED CHANGES (2)". A fourth was
visible only in the screenshots: the schematic float first filled the frame,
then disappeared entirely when moved inside the globe's radius. The
"pause stops rendering" check was also measuring during the camera's
scroll-driven easing, and now waits for the scene to go idle before
confirming it stays idle.

## 5k. maplibre-gl advisory GHSA-jrc7-96c5-q579 resolved (Verified)

`npm audit` had reported two critical findings since §5h: `maplibre-gl`
≤6.4.0 (XSS sanitizer bypass in `DOM.sanitize()`), reached only transitively
as `frontend → plotly.js@4.1.0 → maplibre-gl@5.24.0`, and `plotly.js`
2.35.0–4.1.0 for depending on it.

- **The fix: `plotly.js` `^4.1.0` → `^4.1.1`.** This is Plotly's own
  remediation, not an upgrade forced on a transitive package: 4.1.0 declares
  `maplibre-gl: "^5.24.0"`, and the 4.1.1 **patch** release pins
  `maplibre-gl: "6.9.0"`, past the ≤6.4.0 affected range. `react-plotly.js`
  peers on `plotly.js >=3.0.0`, so it dedupes onto 4.1.1 rather than pulling a
  second copy. Only `package.json` and `package-lock.json` changed; no chart
  code was touched.
- **Options rejected.** A `maplibre-gl` override would have forced a 5.x→6.x
  major on a package Plotly pins itself. A partial Plotly bundle
  (`plotly.js-cartesian-dist-min`) *would* drop maplibre entirely - both charts
  use only `type: 'scatter'` - but it means swapping packages and rewriting
  both chart imports through `react-plotly.js/factory`, which is a bundle-size
  change, not the smallest security fix. `npm audit fix --force` was not run,
  and the advisory was not suppressed or dismissed as unreachable.
- **Verified four ways, not just by `npm audit`:**
  - Installed tree: `plotly.js@4.1.1 → maplibre-gl@6.9.0`, one copy.
  - Lockfile: `maplibre-gl` appears only as 6.9.0; **zero** occurrences of
    5.24.0; `npm audit --package-lock-only` reports 0.
  - Clean install: `npm ci` from the committed lockfile in an isolated
    directory resolved `maplibre-gl@6.9.0` only, one copy on disk, 0
    vulnerabilities - peer resolution does not reinstall the vulnerable
    version.
  - Shipped client bundle: exactly one chunk contains maplibre, carrying the
    `6.9.0` literal and **no** `5.24.0`.

Verification: `npm audit` 2 critical → **0**; 171 frontend tests, tsc, lint
and `next build` clean; Headless Chrome **141/141** with no page errors.
Two checks were added, because "preserve existing export functionality" is
otherwise untested: the profile and Compare charts each still expose
Plotly's "Download plot as a PNG" modebar button (8 buttons), with `lasso2d`
and `select2d` still removed by our config. Temperature/salinity panels,
reversed depth axis, missing-data gaps, Compare curves and hover templates
were re-checked and screenshotted.

**Remaining limitation:** the full Plotly bundle still includes maplibre-gl
(client chunks total about 6.4 MB). It is the patched version and no chart
instantiates a map, but the code ships. Reducing it is a separate,
interface-neutral bundle-size milestone.

## 5l. Student and Scientist accounts (Verified)

Accounts, sessions and one access boundary, inside the existing FastAPI
service. No Express server, no second authentication authority, and no change
to any scientific value. `AUTHENTICATION.md` is the full reference; this is
what was built and what it means for the rest of the system.

- **Storage** (`api/auth_store.py`): SQLite in its own configurable file
  (`FLOATCHAT_AUTH_DB`, default `data/accounts/accounts.sqlite3`, git-ignored).
  The Argo parquet tables and the WOA caches are never touched by it.
  Passwords are **Argon2id** (`argon2-cffi`, t=3, m=64 MiB, p=2). Session
  tokens come from `secrets` and **only their SHA-256 digest is stored**, so a
  copy of the database yields no live session. Every statement is
  parameterized.
- **HTTP** (`api/auth_routes.py`): register, login, session, logout. The
  session is an **HttpOnly** cookie with explicit `SameSite=Lax` and `Secure`
  under `FLOATCHAT_COOKIE_SECURE=1`. CSRF is a double-submit token bound to
  the session row, required on every authenticated state-changing request and
  compared with `secrets.compare_digest`. Sessions expire after 12 hours,
  rotate onto a new token after 30 minutes, and logout deletes the row -
  revocation is server-side, not a cookie clear.
- **CORS**: `allow_origins=["*"]` with credentials was replaced by an explicit
  list (`FLOATCHAT_ALLOWED_ORIGINS`). Browsers refuse a wildcard together with
  credentials, so the old setting could not have carried a session cookie at
  all. The localhost arrangement, including why `localhost` and `127.0.0.1`
  are not interchangeable here, is documented in `AUTHENTICATION.md`.
- **The access boundary is one endpoint.** `POST /api/plan/draft` - the only
  route that spends money per call - requires an account and a CSRF token.
  Everything else stays public: coverage, floats, profiles, climatology,
  capabilities, validation and execution. **Manual exploration is complete
  without an account**, and a test asserts it. Enforcement is a FastAPI
  dependency applied in `api/main.py`, so a direct API call is refused exactly
  as a UI call is; the frontend gate is a courtesy, not the control. The
  dependency is passed into `build_plan_router`, which leaves the route open
  when none is given - that is how the isolated router tests still exercise
  drafting, and it is never how the application runs.
- **Roles are presentation, not permission.** `student` and `scientist` are
  self-selected at registration. The role picks the opening view
  (`defaultViewForRole`) and nothing else. Both roles receive byte-identical
  responses from `/api/profiles/{id}` and `/api/coverage`, which is asserted,
  and a browser check confirms that switching the Student/Scientific toggle
  leaves the account role unchanged.
- **Frontend**: `lib/auth.ts` (client), `lib/csrf.ts` (the token, in memory
  only - never `localStorage`, a URL or a log), `components/AuthScreen.tsx`
  (separate Student and Scientist entry screens in the marine design, with
  registration, sign-in, loading and error states), a navbar account control,
  and an assistant gate that explains why an account is needed and offers the
  manual path instead. The CSRF store is its own module so `auth.ts` and
  `planContract.ts` do not import each other.
- **Not invented**: there is no email verification, password recovery or
  OAuth. The server reports all three as unavailable in every session
  response, the sign-in screen renders that list, About Data states it, and a
  test asserts that plausible endpoints for them are 404 so a future change
  cannot quietly add a non-working stub.

Verification: backend **424 passed** (387 -> 424; 37 new, covering
registration, duplicate emails, safe refusals, the attempt bound, expiry,
rotation, logout revocation, CSRF, persistence across a restart, role
tampering and the public/protected split). Frontend **185 passed** (171 ->
185). Headless Chrome **152/152** (141 -> 152; 11 new), including both account flows
end to end on desktop and phone with temporary accounts, public exploration,
the assistant gate, session restore across a reload, and the toggle-versus-role
separation. tsc, lint and `next build` clean. AI drafting used fixture replies
throughout; no paid model request was made.

Two defects were found by running it rather than by reading it. Startup used
`@app.on_event`, but the test suites build a `TestClient` without entering its
context manager, so the account schema would never have been created under
pytest; schema creation is now lazy per database path. And the browser
fixture for `/api/plan/draft` still advertised only `Content-Type` with no
credentials, so once the request carried a CSRF header the browser failed the
preflight - the fixture now answers as the real API does.

## 5m. Per-profile temperature and salinity gradients (Verified)

A first difference between two adjacent measurements, and nothing more. The
calculation lives in `floatchat_core/gradients.py` (pure, no pandas, no HTTP)
and is reused by `execute_plan`, so there is no second query path.

- **What is computed.** For consecutive eligible levels, shallower `1` and
  deeper `2`: `gradient = (value2 - value1) / (depth2 - depth1)`. Depth is
  metres positive down as stored, so temperature falling with depth gives a
  **negative** gradient. Units are stated, and practical salinity keeps no
  invented numerator unit ("per metre", PSS-78 dimensionless).
- **It respects the executed query.** The levels handed to it are the ones
  `apply_filters` already selected, so the plan's depth range, variables and
  QC/data-mode policy apply without being re-implemented. A rejected level
  arrives as `None`.
- **Derived quantities are labelled.** Both the gradient and the interval
  **midpoint depth** are derived; the midpoint is the arithmetic centre of two
  sampled depths, not a depth anything was sampled at. Each interval carries
  its two source measurements, so any value can be recomputed by hand.
- **Nothing is bridged.** Four break reasons are reported instead of a number:
  `missing_value`, `gap_exceeds_policy`, `conflicting_duplicate_depth` and
  `unusable_depth`. No smoothing, fitting, interpolation or extrapolation.
- **Maximum-gap policy.** Adjacent levels more than **20 m** apart are breaks.
  That limit is `DEFAULT_MAX_GAP_M`, reused from the climatology matching
  configuration (`FLOATCHAT_MAX_GAP_M`) and reported in every series as an
  **application policy** - not a property of the ocean and not a published
  threshold.
- **Edge cases are explicit.** Duplicate depths whose values agree collapse to
  one sample; duplicates that **conflict** exclude that depth entirely rather
  than averaging it; non-finite values and non-finite depths are excluded;
  fewer than two accepted samples gives `insufficient_samples`. Division by
  zero is unreachable, and a guard keeps it that way.
- **At-depth plans.** Gradients come from observed levels only; derived values
  are never endpoints. An at-depth plan adds the limitation
  `gradients_use_observed_levels`, stating that a single value derived at an
  exact depth cannot support a gradient.
- **Interpretation, bounded.** `strongest_cooling` reports the steepest
  negative temperature interval as **"Strongest cooling interval in this
  result."** with a caveat naming sampling spacing, measurement noise and the
  requested depth range, and denying that it is a thermocline, mixed-layer
  depth, anomaly or marine heatwave. Ties resolve to the shallower interval so
  the answer is deterministic. With no cooling interval, a `cooling_note` says
  so rather than going silent. Temperature and salinity are independent:
  absent salinity never suppresses temperature.
- **Capabilities changed only for what exists end to end.** `Analysis` gains
  `temperature_gradient`, and `salinity_gradient` moves to implemented; the
  frontend `ANALYSES` array mirrors the new order (the alignment test compares
  positionally). `thermocline_estimation` stays **unimplemented**, with its
  reason updated to say that per-profile gradients exist but the steepest
  interval is not a detected thermocline. Regional cross-sections remain
  unoffered.
- **Interface.** One expandable **"Changes with depth"** section in the profile
  panel. Student view gives plain language and the interval depths; Scientific
  view adds signed gradients, units, endpoints, the derived midpoint, the
  method and the gap policy. The section carries `data-profile`, and the report
  is selected from the executed result **by profile id** - there is no separate
  request, so a reply cannot arrive late and appear under another profile.

Verification: backend **455 passed** (424 -> 455; 31 new, covering known linear
gradients, constant profiles, inversions, the sign convention, missing
salinity, gaps at and beyond the policy, non-finite values and depths,
agreeing and conflicting duplicates, insufficient samples, tie-breaking, the
refusal to claim a thermocline, and every real cached profile). Frontend
**203 passed** (185 -> 203). Headless Chrome **158/158** (152 -> 158; 6 new),
covering the section's ownership by profile, student wording, the cooling
label and its caveat, stated breaks, the scientific detail, and the section
following the selected profile. tsc, lint and `next build` clean.

One interval from the real cached data, recomputed from its two source
measurements (profile 2902201_287_A):

```
upper level : 26.52899932861328 degC at 4.075772555280808 m
lower level : 26.533000946044922 degC at 9.741956071402047 m
by hand     : (26.533000946044922 - 26.52899932861328)
              / (9.741956071402047 - 4.075772555280808) = 0.0007062280
reported    : 0.0007062280 degrees Celsius per metre (ITS-90)
midpoint    : 6.908864313341427 m (derived, not sampled)
```

That profile yields 27 temperature intervals and 6 breaks; its salinity
reports `insufficient_samples`, because the cached salinity was rejected -
reported, not filled in. Its strongest cooling interval is 70.17-77.62 m at
-0.246 degC/m.

Four defects were found by running it rather than by reading it. A unit test
caught fixtures still carrying `derivation` after it moved to the series
level. The frontend blamed distance for `no_eligible_intervals`, which a
rejected level between two good ones also produces, so the wording now points
at the breaks instead of guessing. The new section cost the depth chart 30 px
and failed the 1366x768 layout check at 241 px against a 250 px threshold;
that was fixed by reclaiming header spacing, **not** by lowering the
threshold, and the chart now measures 257 px. And the student sentence read
"Between 85.7-86.6 m, temperature falls 0.52 degC between 85.7-86.6 m",
because the template repeated what the helper already said.

**Remaining limitations.** The analysis is bounded to individual profiles:
there is no thermocline or mixed-layer detection, and no regional
cross-section. How many intervals exist depends on the 20 m gap policy, so a
sparsely sampled profile legitimately yields few. Salinity gradients are rare
in this cache because most cached levels have no accepted salinity. Gradients
travel inside the execution response, so the payload grows with the result:
the full cached query is **3,243,018 bytes** with both gradient analyses
requested (4,018,890 before the per-interval `derivation` string was moved to
the series level). A larger archive would need the reports paginated or
requested separately.

## 5n. Interface simplification (Verified)

The interface was crowded, technical and hard to navigate. This milestone
changed presentation only: no scientific calculation, authentication rule or
provider setting was touched, and the API is unchanged.

- **Navigation and accounts.** Sections are **Explore, AI Assistant, Compare,
  About**, with the numbered prefixes removed. Section *ids* are unchanged, so
  state, focus targets and test ids were unaffected by the rename. Email,
  account type and Sign out moved into an account menu; the detail switch is
  now labelled "Detail level" with **Simple / Detailed**, and the menu states
  in words that account type sets the starting detail level while the switch
  changes only what you read - never identity or access.
- **Registration.** The two-step, explanation-first chooser became one
  ordinary form: email, password, and account type as a choice **inside** the
  form. Sign in is a tab beside it and **Continue as guest** sits directly
  below. The server-side rules are untouched: the same endpoints, the same
  session cookie, the same one protected route.
- **Exploring.** The map and the depth chart come first; filters stay in a
  drawer that starts closed. Above the map is one short line -
  `Arabian Sea sample - 1-9 Jan 2024 - Temperature and salinity - 0-497 m` -
  and one action. **"Arabian Sea sample" is a display name only**: the plan
  still carries `argo_cached_subset` and its exact bounds on the wire, which
  a test asserts. When filters no longer match the results on screen, the
  changed parts of that line are marked and the action reads **Update
  results**, so a pending selection can never be read as a description of what
  is displayed.
- **Measurements** (was "Float Detective"). The float selector, the observation
  selector and **Temperature / Salinity tabs** sit directly above the chart, in
  that order, and the chart shows one variable at a time. Processing metadata
  (identifiers, cycle, data mode, QC source) moved out to Scientific details.
  The limitation for the variable on screen - "No salinity here: 34 levels
  failed quality control" - sits beside the chart it affects.
- **Playback is no longer permanent.** The controls and their explanatory
  paragraphs are closed until **"Explore over time"** is opened. Opening only
  reveals them: it changes no time, no selection and runs no query. Closing
  pauses playback. A restriction stays visible either way as a compact
  **"Through ..."** chip with **Show all times**, so a filtered result cannot
  look complete. Time filtering, profile selection, Compare behaviour, the
  globe and the depth scene are unchanged.
- **Text.** Shorter labels throughout; repeated instructions and developer
  wording removed. Detailed QC, provenance and method explanations stay behind
  labelled expanders, "Changes with depth" is still collapsed by default, and
  the steepest interval is still **not** called a detected thermocline.
- **Visual.** Account menu, avatar and pending-selection styles added to the
  token layer; coral remains reserved for errors and cautions. The map legend
  was cut to one short line because the map fit reserves a fixed clearance
  (`LEGEND_CLEARANCE_PX = 110`) for it - see the defect below.

Verification: **219** frontend tests (203 -> 219; 16 new for the selection
summary, plus the renamed section labels asserted alongside the stable ids);
tsc, lint and `next build` clean; Headless Chrome **161/161** (158 -> 161) with
no page errors, covering guest exploration, registration and sign-in, reading a
float's temperature chart, changing filters and updating results, opening and
closing time exploration, comparing two profiles, accepting an AI proposal from
fixtures, scientific details and gradients, and PNG export from both charts.
Screenshots were inspected at 1366x768 and 390x844.

Three defects were found by running it, and one was self-inflicted tooling
damage worth recording:

1. **A recursive helper froze the suite.** A global replace of
   `setInput(navSlider, ` with `setTime(` also rewrote the body of `setTime`
   itself, so it called itself forever. Two runs halted at the identical line
   with no timeout and no error. Diagnosed only after rejecting two wrong
   explanations - cumulative sleep, then hot-reload - neither of which the
   evidence supported.
2. **The legend covered a marker.** A longer legend line wrapped past the fixed
   clearance the map fit reserves, hiding a bottom-left marker. Fixed by
   shortening the legend; the layout threshold was **not** lowered.
3. **Two new checks asserted claims where they did not hold** - the region name
   after "Use cached data" had already replaced it with an explicit box, and
   hidden playback after the harness itself had opened it. Both moved to where
   the claim is true.
4. A blanket `Stop-Process node` killed the dev server along with the stalled
   run. Later stops matched on the command line instead.

**Not done, and not claimed:** no first-time user testing was performed. No
person used this interface; the judgements here are the author's and the
checks', not a usability study.

## 5o. Grounded result explanations (Verified)

A short explanation of the result on screen, assembled from facts the backend
recomputes. The model never states a value: it chooses which approved sentence
to use and which fact fills each slot, and the numbers are inserted server-side.

- **Evidence** (`floatchat_core/evidence.py`). `build_evidence` revalidates and
  re-executes the plan, then describes it as identified facts: observed dates,
  sampled positions, profile and float counts, per-variable depth ranges and
  value extents, exclusions, gradient findings and any climatology comparison.
  Each fact carries a stable `id`, a `value`, its `units` and a `kind`
  (`measured`, `derived`, `reference`, `count`, `extent`, `status`), so a
  computed quantity is never read as an observation. For the cached query that
  is **36 facts in 9,121 bytes**, against the 3.24 MB execution response (§8.6).
  Nothing a client sends is treated as a measurement.
- **Explanation** (`floatchat_core/explain.py`). Ten approved sentence
  templates with typed slots, so `variable.*.value_min` accepts a value and not
  a depth. A selection is rejected whole when the template is unknown, a fact id
  is absent, a fact does not fit its slot, or one sentence mixes two variables.
  Prose returned beside the selections is inspected and never displayed; a
  forbidden claim - marine heatwave, detected thermocline, ocean-wide, "normal
  conditions", "proves", "anomaly" - discards the whole answer. With no
  provider the same templates are filled deterministically and labelled a
  **data summary**, never `explained`.
- **Route.** `POST /api/plan/explain`, carrying `require_user` and CSRF through
  the new `explain_dependencies`, alongside drafting. It takes a plan and a
  dataset version, never measurements. A dataset version that no longer matches
  is `409 dataset_mismatch` and never reaches a provider.
- **Interface.** "Explain results" sits with the results in the AI Assistant
  section; no navigation section was added. Asking is always explicit. The
  explanation is bound to the execution that produced it: a new result clears
  it, editing filters alone does not, and a reply for superseded results is
  dropped. Supporting measurements stay behind "View evidence".
- **Time panel.** The "About these steps" text was measured at both viewports
  and is **not** clipped (`scrollHeight == clientHeight`, the `<details>` inside
  the card at 1366x768 and 390x844). The earlier report mistook the circular
  screen-capture badge overlaying it for a layout fault. Harmless bottom
  padding was added anyway; chart size (363 px desktop, 360 px phone) and time
  behaviour are unchanged.

Verification: backend **501 passed** (455 -> 501; 46 new); frontend **232
passed** (219 -> 232; 13 new); tsc, lint and `next build` exit 0. Headless
Chrome **172/172** (161 -> 172; 11 new) with no page errors, at 1366x768 and
390x844. Explanations in that run are fixture replies served by request
interception, proven with **its own probe** because the endpoint pattern is new
and the API holds a live credential. **No model was called in this milestone:**
the API log records only two 401 probes ever reaching those routes.

Four things were found by running it, the last self-inflicted tooling damage:

1. **The executed plan is not a request plan.** The frontend first sent the
   normalized plan returned by execution. It carries `time.inclusive`, which the
   request schema refuses, so every real click would have returned 422 while
   every offline test passed. The reducer now snapshots the submitted plan at
   `execution:result`, where it is still current by construction, and
   `explainResult` is typed to refuse a `NormalizedPlan`.
2. **A closed `<details>` reports client rects.** The first "stays behind View
   evidence" check used `isVisible`, which is `getClientRects().length > 0`; the
   run reported `rowRects: 1` with `open: false`. The check now asserts the
   element's own `open` state. The assertion was wrong, not the interface.
3. **A misplaced phone check.** Measuring the panel in the phone section found
   the assistant in the "ask" stage, because the no-data draft of §5n precedes
   it. It failed loudly rather than skipping silently, and the measurement moved
   to where the panel is actually on screen.
4. **A stopped task is not a stopped process.** Stopping the background *task*
   ended its wrapper while `next dev` (PID 16236) kept serving port 3000, so the
   first `next build` ran beside a live dev server - the shared-`.next` hazard
   this project has hit before. Next 16 keeps `.next/dev` and `.next/build`
   apart and nothing was damaged: the app still rendered and the dev log was
   clean. The build was nonetheless redone with the process genuinely stopped
   and the port confirmed free, because "probably harmless" is not the standard
   that instruction set. Check the listener, not the task.

**Not done, and not claimed:** the wording has not been evaluated against a real
model. Only fixture replies were exercised, so nothing here is evidence that a
live model chooses good sentences - only that whatever it chooses is
constrained, and that unsupported choices are rejected.

## 5p. Full-width Explore, automatic results and a chat assistant (Verified)

Changes collected from a walkthrough of the interface. Scientific calculation,
authentication, the Gemini configuration and grounded explanations are
untouched; the backend has no change at all this milestone.

- **Explore is one scrolling page.** The map or globe fills the first screen
  beneath the navigation (measured at 656 px of 768), and the measurements,
  chart and scientific details follow underneath in ordinary page flow. The
  side-by-side grid that gave each pane its own scrollbar is gone. Filters stay
  in a drawer; selecting a profile changes the panels below and nothing else.
  Leaflet already invalidated its size on container resize, and the R3F canvases
  size to their parent, so the scenes, marker selection, camera controls, depth
  selection and the no-WebGL fallback all survived the change.
- **Results are automatic.** "Show results" and "Use cached data" are removed.
  The opening query is derived from the coverage the backend reports -
  `defaultFormFor` - and runs on load. A valid filter change re-runs it after
  the existing validation debounce, at most once per revision, and the reducer
  drops replies for superseded revisions. Selecting a marker, moving the globe
  and switching sections do not touch the revision, so none of them re-executes.
  Loading, invalid, unavailable and empty are four distinct states, and results
  from a previous selection stay labelled as such.
  The opening query keeps the **named** region, so the summary reads "Arabian
  Sea sample" rather than a box of degrees, and asks for temperature only: the
  both-variable, both-gradient request is the 3.24 MB payload (SS8.6), which is
  a poor default for something that now runs on every load.
- **Map and globe simplified.** Profile history, its "2 of 6 floats" note and
  `profileHistory.ts` are removed; "Focus on float" survives, now framed from
  the result's own profiles. Three repeated coverage paragraphs became one
  scope line with its degrees, and the Natural Earth attribution is kept. In the
  depth scene the actual-metre labels and the exaggeration factor stay on
  screen; the longer method explanation moved behind "How this is drawn".
- **The assistant is a conversation.** A scrollable thread with a composer and
  Send, starter questions before the first message, and no numbered workflow.
  Proposals arrive as compact cards with one explicit **Apply**; explanations
  arrive as messages with their evidence behind a disclosure. The planner and
  explanation services are the existing ones, and both still need an account.
  The thread and the half-typed message both live in the explorer, so switching
  sections keeps them - and the composer says plainly that the conversation is
  not saved to an account, because it is not.
- **The two reported layout defects.** "Changes with depth" was clipped by the
  fixed-height card that held it; measurements now grow with the page, and a
  geometry check proves the expanded content sits inside its card at zoom 1.
  The Compare legend overlapped because two long names shared Plotly's
  horizontal legend; the plot legend is off and identity comes from the A/B
  selector row, checked for non-overlap at 1366 px and at 420 px.
- **About** opens with what FloatChat does, what Argo floats measure and where
  the data comes from, in short paragraphs, with processing and QC behind
  disclosures. Counts and dates stay dynamic, and measurements, derived values
  and long-term reference averages are still kept apart.

Verification: backend **501 passed** - no Python was touched, confirmed by
`git status` before the run. Frontend **224 passed** (232 -> 224: twelve
profile-history tests and seven assistant-stage tests went with the features
they described; eleven new cover the conversation and `draft:apply`). tsc, lint
and `next build` exit 0, the build run with the frontend process stopped and
port 3000 confirmed empty. Headless Chrome **170/170** with no page errors.
Model replies are fixtures served by request interception, each endpoint proven
with its own probe; **no model was called.**

Five things were found by running it:

1. **Every "before results" check was invalidated.** With results loading
   automatically there is no empty Compare, no dataset-overview globe and no
   getting-started panel. Four checks asserted states that can no longer occur,
   and one clicked a button that no longer renders, ending the run early.
2. **The conversation broke `querySelector`.** A thread keeps its earlier cards,
   so checks reading `[data-testid=chat-proposal]` got the opening proposal
   rather than the newest reply, and `waitFor` matched a card already on screen.
   Six checks now read the last match and wait for the count to rise.
3. **The composer lost its text on a section switch.** It was local component
   state, and the assistant section unmounts when another is shown. Lifted to
   the explorer beside the conversation, which is what the milestone asked for.
4. **`setInput` could not drive a textarea.** It took the value setter from
   `HTMLInputElement.prototype`; on the new composer that throws "Illegal
   invocation". It now picks the prototype from the element.
5. **A screenshot showed the wrong thing, and fixing it broke the run.** The
   measurements shot was byte-identical to the map shot. Scrolling just before
   it left the page scrolled, and every later coordinate-based interaction -
   marker clicks, globe drag, scroll-zoom - dispatched where the map no longer
   was, costing six checks and a crash. The capture moved to the point the run
   already scrolls there, and is now a distinct image.

**Not done, and not claimed:** no first-time user testing. The chart regression
this layout introduced (the chart collapsed to 211 px once it had no parent
height) was fixed by giving the chart its own minimum, **not** by lowering the
250 px threshold that caught it.

## 5q. Recent observations, and a dataset that can be refreshed (Verified)

The served dataset is now a recent extract, retrieved once from the same
Ifremer ERDDAP path the January 2024 snapshot came from. That original extract
is untouched and is the fallback.

- **What is served.** `scripts/refresh_argo.ps1` downloads the last 30 UTC days
  for 60-65 E, 15-20 N, pressures 0-500, processes it with the *same* QC policy,
  validates it, and only then points `snapshots/active.json` at it. The first
  run retrieved **40 profiles from 12 floats, 7,171 levels, observed
  2026-08-18 22:42 to 2026-09-17 09:03 UTC**. "Recent" is the observation date;
  nothing streams, and the interface says so.
- **Safe and repeatable.** Retrieval happens in the script, never in a request
  handler: opening the site or moving a filter downloads nothing. Bounded
  timeout (600 s) and three retries; the response is written to a `.part` file
  and moved into place. A snapshot counts as complete only when all three files
  exist, and `write_active_id` refuses to activate an incomplete one, so a
  failed or half-finished download leaves the working dataset serving. The
  resolution order is `FLOATCHAT_DATASET_DIR`, then the active snapshot, then
  the original extract, and the reason for a fallback is reported rather than
  guessed at.
- **One snapshot, one description.** `/api/coverage` reports the snapshot id,
  whether it is the fallback, the requested window and region, the retrieval
  time and any truncation, and its counts are read from the same tables the
  queries run against.
- **Scientific behaviour is unchanged.** The refresh calls
  `records_from_frame`, extracted from the original script so both ingestions
  apply one policy rather than a copy: per-variable raw/adjusted selection,
  QC=1 only, `-gsw.z_from_p` for depth, and temperature kept when salinity is
  missing (126 such levels here). Climatology stays cache-only.
- **Interface.** The opening query is derived from the active coverage, so it
  follows the dataset. A fallback is labelled in Explore and explained in
  About, which gains a "Source and refresh" section naming the snapshot,
  bounds, window, retrieval time and the refresh command. Switching datasets
  clears the selection, comparison and conversation and re-derives the default;
  clearing a proposal is not accepting it, and no model is called.

Verification: backend **522 passed** (501 -> 522; 21 new for snapshot
resolution, activation refusal, validation and coverage consistency). Frontend
**226 passed**. tsc, lint and `next build` exit 0, built with the frontend
listener stopped and port 3000 confirmed empty. Headless Chrome **170/170**
with no page errors, against the recent snapshot. One bounded real retrieval
was performed; four sampled levels were checked against the downloaded NetCDF
and agreed exactly on temperature and on the computed depth.

Ordinary unit tests are pinned to the original extract through
`FLOATCHAT_DATASET_DIR`, because a refreshed snapshot changes with every
refresh and tests pinned to it would describe today's download rather than the
behaviour under test. No network is used by them.

Three things were found by running it:

1. **A superseded execution stranded the loading state.** `execution:result`
   discarded a reply for an old revision but left `executing` true, so
   `canExecute` stayed false and automatic results stopped for the rest of the
   session. The larger dataset exposed it: the first run was still in flight
   when a proposal was applied. Fixed in the reducer and pinned by a test.
2. **A check was confounded by correct behaviour.** "Panning kept" compared the
   map across a round trip during which a different profile had been selected
   on the globe; panning to keep the open profile visible is right, and with
   the wider spread it now happens. The check measures navigation alone.
3. **Reduced motion could not demand zero frames.** The opening query repaints
   the scene a few times as it lands. Continuous animation would add about 90
   frames over the window; the check now allows at most five, which still
   separates "stopped" from "animating". *§5s revisits this:* the tolerance was
   not the weak part - the settling loop was, and it now waits for this page's
   own query before measuring.

**Payload note.** The full cached query with gradients returns about **4.24 MB
as an execution response** for this snapshot, up from 3.24 MB for the 2024 one.
That is a response size, not a request. SS8.6 still applies.
*Superseded by §5s:* this figure states neither the variables nor the depth
extent and could not be reproduced under any configuration tried. Use the
matched table in §5s, where the same query measures 4.54 MB (temperature only)
and 8.54 MB (both variables, both gradients).

**Not done, and not claimed:** no first-time user testing; the region was not
expanded, because the original box returned enough coverage; and the extract is
a bounded 30-day window, not complete regional coverage.

## 5r. What the real model actually handles (Verified)

Fixture checks prove the application constrains a model; they say nothing about
what a real one gets right. Ten cases were run through the **actual** planner
and explanation paths against the active snapshot, and judged against values the
backend computed - never by asking another model.

**Model** `gemini-3.1-flash-lite` (the configured provider, unchanged).
**Snapshot** `argo-recent-20260917T133016Z`, fixed throughout: 12 floats, 40
profiles, 7,171 levels, observed 2026-08-18 to 2026-09-17 UTC.
**Provider requests: 12 of a 12 ceiling** - 10 in the first run, 2 retrying the
two cases a provider outage had blocked. The ceiling is enforced *before* a
request is made, by a counting wrapper around the adapter, so retries and any
internal repair request are included in that number.

| Case | Asked | Result |
|---|---|---|
| A | temperature 0-200 m | **pass** (blocked first, passed on retry) |
| B | temperature and salinity 0-200 m | **pass** (blocked first, passed on retry) |
| C | temperature at exactly 100 m | **pass** - `at_depth 100`, validator `valid_partial_coverage`; the interpolation limit was preserved, no value invented |
| D | June 2019 | **pass** - dates kept, validator `valid_no_data` |
| E | "Show me the data." | **fail** - returned the draft unchanged instead of asking what was meant |
| F | detect marine heatwaves | **pass** - `unsupported_request`, named as unavailable |
| G | include QC flag 4 | **pass** - `unsupported_request`; quality filtering was not weakened |
| H | "Now show only salinity." | **pass** - variables became `psal`, and 0-200 m, region and dates were kept |
| I | explain an executed result | **pass** - every number traced to a backend fact id |
| J | explain a comparison | **pass** - no comparison claimed, which is the honest answer since the contract has no template for one |

**Totals: 9 pass, 1 fail, 0 blocked** after the retry (2 were blocked by an
HTTP 503 "model is currently experiencing high demand" before it). Latencies for
the ten first-run requests: 1.3-9.2 s. The adapter returns no usage block, so
none is reported and no cost is inferred.

This is evidence about these ten cases. It is not a model-accuracy figure.

Failures are kept apart by kind. The two 503s are **blocked** - a provider
outage, not a semantic judgement. Case E is an **interpretation** weakness in
the model, not an application defect: the planner offered a draft that changed
nothing and assumed nothing, which is safe but unhelpful. **No application
defect was found**, so nothing was fixed for its own sake.

On multi-turn: there is no conversation history. Continuity is carried by the
*draft* - the planner receives `current_draft` and returns a `plan_patch` - so
case H is a genuine follow-up in the application's real design. A model cannot
refer back to an earlier question, only to the draft it produced. Recorded as a
limitation, not worked around.

Reproduce with::

    powershell -ExecutionPolicy Bypass -File scripts\evaluate_gemini.ps1

Results are written to `scripts/evaluation/`. `-MaxRequests` lowers the ceiling,
and `FLOATCHAT_EVAL_ONLY=A,B` retries named cases without spending the budget on
cases that already have a verdict. The harness is never imported by the test
suite and never runs with it; `test_evaluation_harness.py` exercises its
judgement with fixtures, including that the ceiling stops a request rather than
counting one afterwards.

Verification: backend **536 passed** (522 -> 536; 14 new, all fixture-based).
The frontend was not touched, so its build and browser suite were not re-run.

**Unresolved, for a later task:** no clarification behaviour to rely on for
vague questions (case E); no conversational memory beyond the draft; and ten
cases is a small sample - a larger set with human labels would be needed before
claiming anything general.

## 5s. Per-profile thermocline estimate (Verified)

An estimate of where one temperature profile steepens, defined before it was
written. `floatchat_core/thermocline.py` reads the intervals
`floatchat_core/gradients.py` already accepted and adds no second data path:
QC, raw/adjusted selection, depth conversion and the maximum-gap policy are
inherited, not re-implemented.

**The method, and its sources.** NOAA describes the thermocline as "the
transition layer between warmer mixed water at the ocean's surface and cooler
deep water below", in which temperature "decreases rapidly" with depth
(<https://oceanservice.noaa.gov/facts/thermocline.html>). Romero et al. (2023),
*Improving the thermocline calculation over the global ocean*, Ocean Sci. **19**,
887-901, <https://doi.org/10.5194/os-19-887-2023>, record that "the thermocline
depth is often defined as the depth of the maximum vertical temperature
gradient" (attributed to Fiedler, 2010) and cite Jiang et al. (2017) filtering
gradient points against a thermocline standard of **> 0.2 °C m⁻¹**.

This implements the *maximum-gradient* definition only, as
`strongest-eligible-cooling-interval` v1.0. It deliberately does **not**
implement the sigmoid/N²_T method Romero et al. propose: that fits a function
over a water column to about 2 km using density and conservative temperature,
and this deployment holds a 0-500 m extract with sparse salinity. The result
says so rather than implying the better method was used.

**What is returned, and what it is not.** The candidate is the strongest
eligible **cooling** interval. Its endpoint depths and temperatures are recorded
measurements, carried in the result so any figure can be recomputed by hand. The
representative depth is the interval **midpoint** - a derived value, labelled
`estimated_depth_is_derived`, never described as a measurement. The endpoints
are **not** called the thermocline's top and bottom: a first difference between
two levels locates where a profile steepens, not the boundaries of a layer.

**Thresholds, and which are ours.** Only `MIN_GRADIENT_C_PER_M = 0.2` comes from
a citation, and even there it is applied to a first difference between adjacent
accepted levels rather than the quantity those authors filtered - an adaptation,
stated as one. Everything else is an **application policy** for this prototype,
reported with every result so a reader can disagree: at least 5 accepted levels
and 3 eligible intervals (`insufficient_evidence` below that); the candidate at
least **2x** the median cooling of the rest of the profile, so a uniform slope is
not reported as a layer; at least **2** touching cooling intervals, so an
isolated sharp step reads as local structure; and a rival within **0.9** of the
best magnitude makes the answer `ambiguous` rather than decisive. None of these
is a universal oceanographic standard, and none was moved to improve the counts
below.

**Cooling only.** An absolute gradient would let a warming interval be reported
as a thermocline. Temperature inversions are real structure - common beneath
barrier layers and at high latitudes - but this method cannot name them, so such
profiles return `no_qualifying_candidate` with that limitation stated.

**Refusals are about the method, not the ocean.** Every
`no_qualifying_candidate` reason ends with the same sentence: *"This is a
statement about this method and this depth range; it is not evidence that no
thermocline exists here."* `insufficient_evidence` (too little data to judge) is
a distinct status from `no_qualifying_candidate` (enough data, nothing met the
criteria), and `not_applicable` covers a request made without temperature.
Estimates describe **only the analysed depth range**, which is the depth extent
actually selected for that profile - so a clipped query says it was clipped, and
a candidate touching the edge of the range carries `at_analysed_boundary`.

**Real-profile verification, on the fixed snapshot.** `argo-recent-20260917T133016Z`,
unchanged: 12 floats, 40 profiles, 7,171 levels. Over all 40 profiles, with no
threshold tuning:

| Status | Profiles |
|---|---|
| `estimated` | **20** |
| `ambiguous` | **9** |
| `no_qualifying_candidate` | **11** |
| `insufficient_evidence` | 0 |

`insufficient_evidence` is 0 **over the full 0-498 m range**, which is a fact
about this snapshot, not a state that cannot occur: clipping the same query to
0-3 m makes all six matching profiles `insufficient_evidence`, and 0-12 m makes
35 of 36 `no_qualifying_candidate`. Both are exercised in the browser suite so
the two wordings are known to differ on screen.

One result recomputed by hand from its own recorded endpoints, profile
`1901898_303_A`: 24.413000 °C at 110.218972 m and 22.750999 °C at 118.465614 m
give (22.750999 - 24.413000) / (118.465614 - 110.218972) = **-0.2015366 °C/m**,
matching the reported gradient, with a **1.6620 °C** fall over **8.2466 m** and a
midpoint of **114.34229 m**, matching the reported estimated depth.

**Integration.** The existing `thermocline_estimation` analysis identifier was
reused; its capability moved from `implemented=False` to `implemented=True` only
once the path worked end to end, and `provided_by` names
`floatchat_core.thermocline.estimate`. `execute_plan` emits `thermoclines` (one
row per returned profile) and `thermocline_count` beside `gradients`. The
default drafts request it alongside the temperature gradient, since it reads
those same gradients.

**Payload, measured as a matched comparison.** Every figure below is the
length in bytes of the JSON body `execute_plan` returns, serialised identically
for every row (`json.dumps`, the same way the API renders it). These are
**uncompressed response-body bytes**, not bytes transferred on the wire, and
**MB means 10⁶ bytes** (MiB, 2²⁰, is given alongside). One snapshot,
`argo-recent-20260917T133016Z`; one region, the cached Arabian Sea box; one
depth range, 0-498 m; only the requested analyses and variables differ.

| Request | Bytes | MB | MiB |
|---|---|---|---|
| temperature, temperature gradient | 4,542,445 | 4.54 | 4.33 |
| … **+ thermocline estimation** | 4,610,193 | 4.61 | 4.40 |
| temperature + salinity, both gradients | 8,543,918 | 8.54 | 8.15 |
| … **+ thermocline estimation** | 8,611,666 | 8.61 | 8.21 |

The thermocline rows cost **+66.2 KiB** either way - 1.49% of the
temperature-only request, 0.79% of the both-variable one - because one row
carries two endpoints and the policy settings, never a profile array. Adding
salinity and its gradient costs **+4.00 MB (88%)**, which dwarfs it.

**Reconciling §5q's 4.24 MB.** That figure was not a matched measurement and
**could not be reproduced** here. It was recorded as "the full cached query
with gradients" without stating the variables, the depth extent or the
serialisation, and no configuration tried reproduces it: the documented opening
query (temperature only, 0-498 m) gives 4.54 MB / 4.33 MiB; 0-475 m gives 4.38
MB / 4.18 MiB and 0-480 m gives 4.42 MB / 4.21 MiB, so a narrower depth extent
is the likeliest origin, but that is an inference, not a reconciliation. The
figure to rely on is the table above. It also corrects a related claim: the
both-variable, both-gradient request on **this** snapshot is **8.54 MB**, not
the 3.24 MB recorded for the 2024 snapshot in §5m nor the 4.24 MB of §5q.
**None of that growth is attributable to this milestone**, which adds 66.2 KiB.

**Interface.** A compact, expandable *Thermocline estimate* section sits beside
the existing per-profile analyses, selected by profile id so switching profiles
can never leave a stale estimate under another one. It shows the estimated depth
marked *(derived, not a measurement)*, the measured levels that support it with
the fall and the signed gradient, and an expandable *Method and limits* with the
citations and the application policies. When there is no candidate it shows the
backend's reason and nothing else - no fabricated depth, and no confidence
percentage anywhere. On the temperature chart the supporting interval is a
translucent band with a dashed midpoint line, both drawn **below** the traces so
no measurement is obscured, annotated *"estimated thermocline depth (derived)"*.
The full-width map, measurements below it, the chat layout and automatic results
are unchanged, as are the comparison and PNG-export controls.

**The model does not compute this.** Gemini receives backend facts or nothing;
no explanation template asks it to derive, adjust or narrate a thermocline
depth.

**Verification.** Backend **563 passed** (536 -> 563; 27 new in
`tests/test_thermocline.py`, plus three existing capability tests updated
because `thermocline_estimation` is now implemented - one now expects a draft
where it expected `unsupported_request`, and two moved to analyses that are
still unimplemented). Every fixture in the new file is a **labelled synthetic
profile**, built through the real gradient engine, covering: a hand-calculated
cooling transition; uniform and uniformly sloping profiles; weak cooling;
warming-only and mixed inversions; an isolated sharp interval; two equally
strong transitions and a tie; too few levels; rejected levels and a gap wider
than policy; duplicate and near-identical depths; non-finite values; reversed
input order; a clipped range and a boundary candidate; and a salinity series
offered by mistake. Frontend **229 passed** (226 -> 229), `tsc --noEmit` and
lint clean. Browser suite: **184/184**, desktop and phone, with fixture AI replies
and no model call, including captures of all four outcomes - a supported
estimate with its chart annotation, an ambiguous one, no qualifying candidate
and insufficient evidence - plus the expanded method details and a phone view.

**Two defects were found by looking at the screenshots, not by the assertions.**
Without a candidate the expanded details printed the analysed-range note twice,
because the midpoint slot fell back to it; the midpoint note is now shown only
when there is a midpoint. And the capture helper that scrolls the panel into
view left the phone page scrolled down, so two later "reachable in the
viewport" checks failed - it now restores every scroll position it touches.

**One pre-existing check was diagnosed and fixed, not excused.** `intro:
prefers-reduced-motion turns ambient motion off` failed on one run of this
milestone and passed on the next. A passing rerun is not an explanation, so the
cause was traced in the code. The intro canvas is `frameloop="demand"`
(`IntroScene.tsx`), so with ambient motion off it draws only when something
invalidates it - and its `useFrame` still re-invalidates while
`camera.position.lerp(target, 0.06)` converges, which takes roughly twenty
frames after the markers arrive. That is **necessary rendering after a data
update**, finite and terminating; it is not ambient animation.

The defect was in the check's synchronization. `waitForQuiet` watches HTTP
request counters, and those are *already* quiet in the gap between navigating
and the reloaded page issuing its own query, so the settling loop could take
two equal 400 ms samples of a canvas that had drawn exactly once, call it
settled, and then count the camera convergence as movement. The failing run
read **"settled at 1, then 15 frames"**; passing runs read 16 and 22, i.e. the
data had already landed before measurement.

The fix waits for *this* page's `/plan/execute` to be issued (polled in the
driver, since `countCalls` is driver-side and would otherwise interpolate a
constant into a page expression), then for quiet, then requires **three**
consecutive equal frame samples rather than two. The check now also asserts the
scene's own `ambient === false` through its probe, not just the label. Nothing
was removed, retried blindly or relaxed: the tolerance stays at five frames
over a 1.5 s window against the roughly ninety that continuous animation would
add. It now reads **"settled at 22, then 22 frames"** - zero further frames.

**Limitations.** On a 0-500 m chart the supporting interval's band is often
invisible, because the interval really is about 2 m tall; the dashed midpoint
line and its "(derived)" label carry the annotation, and the band is not
widened to look impressive. A first difference between two levels is not a layer thickness,
and the midpoint is not a measured depth. Sparse sampling sets the resolution:
where levels are 20 m apart, so is the estimate. Inversions are outside the
method. The 0.2 °C m⁻¹ criterion was published for a different quantity. The
snapshot reaches about 500 m, so nothing deeper can be seen. And `estimated` is
not a detection: it means the strongest cooling interval here met these criteria,
in this depth range.

## 6. Known limitations

- **The thermocline estimate is an estimate, under stated policies.** §5s defines it as the strongest eligible cooling interval between two
  adjacent accepted levels. The reported depth is the interval midpoint, a
  derived value; the interval endpoints are not the layer's top and bottom;
  the resolution is the sampling, so 20 m apart levels give a 20 m estimate.
  Temperature inversions are outside the method and are reported as having
  no qualifying candidate. Only the 0.2 °C m⁻¹ minimum comes from a
  citation - support, prominence, contiguity and ambiguity are application
  policies. A refusal is a statement about the method and the analysed depth
  range, never evidence that no thermocline exists.
- **WOA reference values: one cached column only.** NCEI returned HTTP 503
  and read timeouts on 2026-09-14. One real WOA23 column (temperature, January,
  the 16.5° N 62.5° E cell) was cached later under the untracked
  `data/reference/woa23/`. The development launcher is cache-only, so every
  other cell reports `Comparison unavailable`. Build the cache deliberately
  with `python scripts/data_feasibility/build_woa_cache.py`.
- **Unverified:** the cached Jan–Jun 2024 regional SST series
  (`sst_daily.parquet`, 182 records per `provenance.json`) was not re-checked
  in this milestone. Nothing consumes it yet.
- Historical SST baseline retrieval remains blocked; marine-heatwave detection
  is not available.
- Only the shallowest matchable reference depth populates the legacy scalar
  response fields; the full set is in `matches[]`.
- **Gemini generation is smoke-tested, not evaluated.** All five scenarios
  ran on `gemini-3.1-flash-lite` (§5c): four passed and the QC=4 case
  passed only partially. This is not an accuracy benchmark, and five bare-JSON
  replies do not prove structured output is enforced. Unsupported-analysis and
  QC-policy requests currently surface only a generic reason when the model
  names them rather than patching the plan.
- **Date normalization is fixed** (§5e); both recorded issues are now
  passing regression tests. Still open from the smoke test: the generic
  reasons for marine-heatwave and QC=4 requests the model names instead of
  patching. The Next.js development badge can overlap a corner in dev mode.
- **Remote WOA reads can terminate the API (reproduced twice, 2026-09-15).**
  While NCEI served "503 Service Unavailable" HTML, netCDF printed OPeNDAP
  parse errors during a WOA network read and the backend process exited
  with no traceback, shortly after each headless-Chrome run (all checks had
  passed). The root cause is unconfirmed; it has not been isolated, and it
  was not reproduced again on purpose. The launcher now defaults to
  cache-only reads (§5f); remote reads should stay off until the read is
  isolated from the server process.
- **No model evaluation has been performed.** Every natural-language test uses
  a fixture reply, including `tests/test_nl_examples.py`. No accuracy claim can
  be drawn from them; a live evaluation would be a separate exercise.
- Only an OpenAI-compatible adapter exists. Adding another vendor is a
  deliberate, reviewable change, not a configuration switch.
- **Browser verification is automated, not a usability study.** Headless
  Chrome checks and inspected screenshots cover the demonstration flows
  (§5d–§5g); no user testing has been done. Real browsers other than Chrome
  were not tried.
- `outside_configured_search_region` fires whenever the requested box reaches
  beyond 60–65 °E / 15–20 °N. Most realistic region requests are therefore
  reported as partial coverage. This is accurate, not a defect; `valid` is
  reached by requests inside the dataset's own extent.
- Execution returns at most 20,000 levels and reports `result_truncated`
  beyond that. The cached subset (3,382) is far below the cap, so the default
  limit is now exercised by a **synthetic 21,000-level dataset** in
  `tests/test_execution_limits.py` rather than by real data. Counts distinguish
  total matches (`observation_count`) from records returned
  (`returned_observation_count`); they differ only when `truncated` is true.
- Derived results are counted **one row per (profile_id, variable) at one
  target depth**, with `method` either `exact` or `linear_interpolation`. The
  response documents this in `results.derived_identity`.
- The `requested` echo is JSON-safe, so a NaN submitted in the body is echoed
  back as `null` rather than byte-identically.
- `frontend/tsconfig.json` gained `allowImportingTsExtensions: true` so the
  same `.ts` imports resolve under both Turbopack and Node's test runner. Both
  `npm run build` and `npx tsc --noEmit` were re-verified after the change.
- Frontend lint is clean. The six remaining `no-explicit-any` errors were in
  `Map.tsx` and `ProfileChart.tsx`, both rewritten in §5d; Plotly trace and
  layout objects keep a documented, line-scoped `any` because react-plotly.js
  is untyped.
- Compare works only within one executed result. Comparing periods, regions or
  depths across queries (`comparison_view`) is still not implemented.
- Three backend tests that had assumed an empty WOA cache were made hermetic
  (§5d).
- The globe and depth scene (§5h) show one result's profile positions and
  levels, stepped through its observation times. The optional history
  overlay (§5i) joins one float's recorded locations within the returned
  result with straight schematic lines. That is not a trajectory: there are
  no positions between profiles, no drift, no archive-complete history and
  no ocean-wide fields, so the 4D requirement is only partly met. In dense
  columns (levels about 1 m apart, drawn ×500), a click selects whichever
  level is nearest the pointer; Shallower and Deeper then reach any
  neighbouring recorded level exactly.
- History connections are straight chords between two recorded positions.
  At the Focus on results view a closely spaced float's markers overlap its
  joins; Focus on float, or zooming in, separates them. A connection crossing
  the antimeridian would be skipped (none occurs in the cached region).
- `npm audit` reports **0 vulnerabilities**. Advisory GHSA-jrc7-96c5-q579
  was resolved in §5k by upgrading `plotly.js` to 4.1.1, which pins a fixed
  `maplibre-gl`. The full Plotly bundle still *ships* maplibre-gl even though
  no chart uses a map trace: that is bundle weight, not a known
  vulnerability. Dropping it needs a partial Plotly bundle (§5k).
- The four sections (§5g) are client-side views on one page. They have no
  URLs of their own, so browser Back does not move between sections, and a
  reload returns to Map Explorer with the draft and results cleared. Signing
  in *is* restored on reload (§5l), but the query session is not: nothing a
  viewer builds is saved to their account.
- Accounts (§5l) sign a viewer in and nothing more. The login attempt bound
  is per email rather than per IP; there is no password change, account
  deletion or admin interface; and email verification, password recovery and
  OAuth do not exist. See `AUTHENTICATION.md`.

---

## 7. Commands actually executed and their outcomes

```bash
# Offline reprocessing — 3,382 observations, 11 profiles, 0 exclusions
venv/Scripts/python.exe scripts/data_feasibility/process_argo_data.py

# Full offline backend suite — 455 passed (127 -> 227 validator,
# 227 -> 265 execution, 265 -> 361 natural-language drafting,
# 361 -> 370 policy-request handling and scrubbed provider errors,
# 370 -> 374 + 1 xfail date-normalization cases, 383 once fixed,
# 386 with the cache-only launcher tests, 387 with search_region,
# 424 with accounts and the access boundary,
# 455 with per-profile gradients,
# 501 with grounded result explanations,
# 522 with refreshable dataset snapshots,
# 536 with the evaluation harness's own checks; nothing regressed)
venv/Scripts/python.exe -m pytest

# Frontend interaction tests — 226 passed, run under three time zones. Uses Node's built-in runner and
# native TypeScript stripping; no test framework was added to the project.
cd frontend && npm test

# Natural-language drafting against a loopback fake provider (not a model):
#   FLOATCHAT_NL_PROVIDER=openai_compatible
#   FLOATCHAT_NL_BASE_URL=http://127.0.0.1:8799/v1
#   FLOATCHAT_NL_MODEL=<name>  [FLOATCHAT_NL_API_KEY=<token>]
# Verified all four outcomes, date preservation and secret containment.

# Backend with the Gemini settings applied (key inherited, never stored):
powershell -ExecutionPolicy Bypass -File scripts\run_api.ps1
# WOA is cache-only by default (FLOATCHAT_WOA_ALLOW_NETWORK=0 unless set).
# Frontend dev server, http://localhost:3000:
cd frontend && npm run dev
# Live Gemini, 2026-09-14. First credential: 5 draft requests HTTP 400;
# compat GET /models 400 "Invalid Auth key."; native GET /v1beta/models 401.
# Replacement credential: native and compat model listings both HTTP 200,
# gemini-3.1-flash-lite listed. Generation smoke: 8 requests over two rounds,
# no retries; round 1 had three HTTP 503 capacity errors, re-run in round 2.

# Bounded WOA cache build — 6 cells attempted, 6 failed (NCEI 503 outage)
venv/Scripts/python.exe scripts/data_feasibility/build_woa_cache.py --variables temp

# Frontend — exit 0
cd frontend && npx tsc --noEmit
cd frontend && npm run build

# Thermocline counts and payload on the fixed snapshot, no threshold changes:
#   40 profiles - 20 estimated, 9 ambiguous, 11 no qualifying candidate
#   execution response, temperature only, 0-498 m, uncompressed body bytes:
#   4,542,445 B -> 4,610,193 B (+66.2 KiB, 1.49%); with salinity and its
#   gradient as well, 8,543,918 B -> 8,611,666 B (+66.2 KiB, 0.79%)

# Frontend lint — exit 0

# Headless-Chrome UI checks against the running app (184/184; browser zone
# Asia/Kolkata by default, FLOATCHAT_TZ overrides):
#   node frontend/scripts/verify-ui.mjs <screenshot-dir>
# AI drafts and explanations in that run are fixture replies served by request
# interception, each proven with its own probe first; no model is called.
cd frontend && npm run lint

# Live server check (offline mode) — all endpoints correct, no NaN tokens.
# Confirmed over real HTTP that /api/plan/validate returns 200/422/400 as
# documented and that the explorer endpoints are unchanged.
FLOATCHAT_WOA_ALLOW_NETWORK=0 venv/Scripts/python.exe -m uvicorn main:app --port 8011
```

Environment variables: `FLOATCHAT_WOA_ALLOW_NETWORK` (`0` disables remote
reference reads; `scripts/run_api.ps1` sets `0` unless it is already set),
`FLOATCHAT_WOA_TIMEOUT_S`, `FLOATCHAT_MAX_GAP_M`, and for accounts
`FLOATCHAT_AUTH_DB` (database file), `FLOATCHAT_COOKIE_SECURE` (`1` for
HTTPS-only cookies) and `FLOATCHAT_ALLOWED_ORIGINS` (comma-separated CORS
allow-list). The test suite redirects `FLOATCHAT_AUTH_DB` to a temporary file,
so running it never touches real local accounts.

---

## 8. Next milestone

Natural-language drafting is **done** (§5c) but inert until a provider is
configured.

Recent-data ingestion landed in §5q: the served dataset is a refreshable
recent extract, with the January 2024 snapshot kept as the fallback.

Other sensible steps, in order:

1. **Widen the evaluation.** §5r ran ten cases against the real model and
   recorded what it handled; that is evidence about those cases, not a general
   accuracy figure. A larger labelled set, and a decision about clarification
   behaviour for vague questions, are the next steps.
2. **Evaluate the explanations against a real model.** Grounded explanations
   shipped in §5o, but only fixture replies have ever been exercised. Nothing
   yet shows that a live model chooses *good* sentences - only that whatever
   it chooses is constrained, and that unsupported choices are rejected.
3. **Populate the WOA cache** when NCEI recovers, with the manual script.
   Isolate the remote read from the API process before re-enabling it.
4. **Per-section URLs.** The marine-atlas visual design is applied (§5j),
   but the section is still local state: Back and reload do not return to
   the section you were in, and no workspace can be linked to directly.
5. **Profile history was removed** in §5p - the globe overlay, its "2 of 6
   floats" note and `profileHistory.ts` all went. If it ever returns it needs
   the float's full archive, and must still be labelled as schematic
   connections, never as underwater paths.
6. **Shrink the execution response.** The opening query returns about **4.61
   MB** and the both-variable, both-gradient query about **8.61 MB** (§5s's
   matched table), because every observation and every gradient interval
   travels in one payload. It is workable locally and
   nothing depends on it being smaller today, but it scales with the result
   rather than with what the screen shows. Paginating the gradient reports, or
   fetching them per profile, is the obvious next step. This is a performance
   task, not an interface one.

7. **Advanced analyses still unimplemented.** Regional cross-sections, mixed-
   layer depth and marine-heatwave detection were all deliberately out of scope
   for §5s and remain unbuilt; `marine_heatwave_detection`, `forecast` and
   `anomaly_significance_test` are still registered as unavailable with their
   reasons. A thermocline *thickness* - as opposed to the estimated depth
   §5s reports - would need a layer definition this method does not have.

Standing constraints: the provider stays configurable and backend-only, API
keys never appear in frontend code, and the model never computes, narrates or
estimates a scientific value.
