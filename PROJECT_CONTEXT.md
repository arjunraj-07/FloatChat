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

## 6. Known limitations

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
- The time navigator (§5f) filters a 2D regional view of one result. There
  is no globe, depth-time view or trajectory interpolation, so the 4D
  requirement is not complete.
- The four sections (§5g) are client-side views on one page. They have no
  URLs of their own, so browser Back does not move between sections, and a
  reload returns to Map Explorer with the draft and results cleared (session
  state is held in memory, as before).

---

## 7. Commands actually executed and their outcomes

```bash
# Offline reprocessing — 3,382 observations, 11 profiles, 0 exclusions
venv/Scripts/python.exe scripts/data_feasibility/process_argo_data.py

# Full offline backend suite — 386 passed (127 -> 227 validator,
# 227 -> 265 execution, 265 -> 361 natural-language drafting,
# 361 -> 370 policy-request handling and scrubbed provider errors,
# 370 -> 374 + 1 xfail date-normalization cases, 383 once fixed,
# 386 with the cache-only launcher tests; nothing regressed)
venv/Scripts/python.exe -m pytest

# Frontend interaction tests — 131 passed, run under three time zones. Uses Node's built-in runner and
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

# Frontend lint — exit 0

# Headless-Chrome UI checks against the running app (88/88; browser zone
# Asia/Kolkata by default, FLOATCHAT_TZ overrides):
#   node frontend/scripts/verify-ui.mjs <screenshot-dir>
# AI drafts in that run are fixture replies served by request
# interception, proven with a probe first; no model is called.
cd frontend && npm run lint

# Live server check (offline mode) — all endpoints correct, no NaN tokens.
# Confirmed over real HTTP that /api/plan/validate returns 200/422/400 as
# documented and that the explorer endpoints are unchanged.
FLOATCHAT_WOA_ALLOW_NETWORK=0 venv/Scripts/python.exe -m uvicorn main:app --port 8011
```

Environment variables: `FLOATCHAT_WOA_ALLOW_NETWORK` (`0` disables remote
reference reads; `scripts/run_api.ps1` sets `0` unless it is already set),
`FLOATCHAT_WOA_TIMEOUT_S`, `FLOATCHAT_MAX_GAP_M`.

---

## 8. Next milestone

Natural-language drafting is **done** (§5c) but inert until a provider is
configured. Sensible next steps, in order:

1. **Configure a provider and evaluate it.** Point `FLOATCHAT_NL_*` at a real
   service and build a genuine evaluation — real calls, human labels — against
   the labelled examples in `tests/test_nl_examples.py`. Today those are
   contract fixtures and say nothing about model quality.
2. **Explain returned results**, once §5c is trusted. The model may describe
   numbers `floatchat_core` computed; it must still never produce one.
3. **Populate the WOA cache** when NCEI recovers, with the manual script.
   Isolate the remote read from the API process before re-enabling it.
4. **Apply the UI/UX reference** when it is provided. The section
   workspaces (§5g) and the time navigator (§5f) are separate components.
   Per-section URLs would make Back and reload behave as users expect.

Standing constraints: the provider stays configurable and backend-only, API
keys never appear in frontend code, and the model never computes, narrates or
estimates a scientific value.
