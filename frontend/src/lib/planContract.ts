/**
 * Typed contract for POST /api/plan/validate.
 *
 * This mirrors `floatchat_core/plan.py`. The literal arrays below are compared
 * against the Python enums by `tests/test_plan_contract_alignment.py`, so this
 * file cannot drift from the backend without a test failure.
 *
 * Conventions, fixed by the backend schema:
 *  - Coordinates are decimal degrees, WGS84. Latitude [-90, 90],
 *    longitude [-180, 180].
 *  - A bounding box spans south -> north and west -> east travelling eastward.
 *    `south < north` and `west < east` are required; an antimeridian-crossing
 *    box is rejected rather than reinterpreted.
 *  - Depth is metres, positive down.
 *  - Date and depth ranges are inclusive at both ends.
 *  - Times are ISO-8601; naive values are treated as UTC.
 */

import { csrfHeader } from './csrf.ts';
import type { ViewMode } from './explorerModel.ts';

export const PLAN_SCHEMA_VERSION = '1.0';

export const VARIABLES = ['temp', 'psal'] as const;
export type Variable = (typeof VARIABLES)[number];

export const DATA_MODES = ['R', 'A', 'D'] as const;
export type DataMode = (typeof DATA_MODES)[number];

export const DEPTH_MODES = ['range', 'at_depth'] as const;
export type DepthMode = (typeof DEPTH_MODES)[number];

export const NAMED_REGIONS = [
  'arabian_sea',
  'bay_of_bengal',
  'equatorial_indian_ocean',
  'argo_cached_subset',
] as const;
export type NamedRegion = (typeof NAMED_REGIONS)[number];

/**
 * Every analysis the schema accepts. Membership here is NOT a claim that the
 * operator exists: ask /api/plan/capabilities which are implemented, or send
 * the plan and read the `unsupported` outcome.
 */
export const ANALYSES = [
  'profile_summary',
  'depth_profile',
  'woa_climatology_comparison',
  'temperature_gradient',
  'salinity_gradient',
  'thermocline_estimation',
  'marine_heatwave_detection',
  'anomaly_significance_test',
  'forecast',
] as const;
export type Analysis = (typeof ANALYSES)[number];

/** Visualization artefacts. Kept separate from analyses: outputs render, they
 * do not compute. */
export const OUTPUTS = [
  'float_map',
  'depth_profile_chart',
  'coverage_summary',
  'evidence_panel',
  'globe_webgl',
  'time_animation',
  'comparison_view',
  'ocean_story',
] as const;
export type Output = (typeof OUTPUTS)[number];

export const OUTCOMES = [
  'invalid',
  'unsupported',
  'valid_no_data',
  'valid_partial_coverage',
  'valid',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface TimeRange {
  start: string;
  end: string;
}

export type Region =
  | { kind: 'bbox'; west: number; east: number; south: number; north: number }
  | { kind: 'named'; name: NamedRegion };

export type DepthSelection =
  | { mode: 'range'; min_m: number; max_m: number }
  | { mode: 'at_depth'; target_m: number };

export interface Selection {
  platforms: string[];
  profile_ids: string[];
}

export interface QcPolicy {
  accepted_qc_flags: number[];
  data_modes: DataMode[];
}

export interface QueryPlanRequest {
  schema_version: typeof PLAN_SCHEMA_VERSION;
  time: TimeRange;
  region: Region;
  depth: DepthSelection;
  variables: Variable[];
  qc_policy?: QcPolicy;
  selection?: Selection;
  analyses?: Analysis[];
  outputs?: Output[];
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** A structured error or warning. `field` is a dotted JSON path, or null. */
export interface Issue {
  code: string;
  field: string | null;
  message: string;
}

export interface NormalizedPlan {
  schema_version: string;
  time: { start: string; end: string; inclusive: boolean };
  region: {
    kind: 'bbox' | 'named';
    name: NamedRegion | null;
    west: number;
    east: number;
    south: number;
    north: number;
  };
  depth: {
    mode: DepthMode;
    interpolation_required: boolean;
    min_m?: number;
    max_m?: number;
    target_m?: number;
  };
  variables: Variable[];
  qc_policy: { accepted_qc_flags: number[]; data_modes: DataMode[] };
  selection: Selection;
  analyses: Analysis[];
  outputs: Output[];
}

export interface AtDepthCoverage {
  target_m: number;
  max_gap_m: number;
  profiles_exact: number;
  profiles_interpolated: number;
  profiles_matchable: number;
  profiles_unmatchable: number;
  unmatchable_reasons: Record<string, number>;
}

export interface VariableCoverage {
  variable: Variable;
  requested: boolean;
  valid_observations: number;
  total_matched_observations: number;
  profiles_with_values: number;
  depth_min_m: number | null;
  depth_max_m: number | null;
  value_min: number | null;
  value_max: number | null;
  excluded_observations: number;
  exclusions: Record<string, number>;
  at_depth?: AtDepthCoverage;
}

export interface Coverage {
  time: {
    requested_start: string;
    requested_end: string;
    dataset_start: string | null;
    dataset_end: string | null;
    matched_start: string | null;
    matched_end: string | null;
  };
  region: {
    requested: { west: number; east: number; south: number; north: number };
    /** The area the archive was extracted for. Being inside it means data was
     * requested here, not that any exists here. */
    configured_search_region: {
      west: number; east: number; south: number; north: number; source: string;
    } | null;
    /** Bounding box of discrete profile positions — NOT a coverage footprint.
     * A location inside this box is not covered unless a profile was sampled
     * there. */
    observed_sample_bounds: {
      west: number; east: number; south: number; north: number; note: string;
    };
    matched_sample_bounds: {
      west: number; east: number; south: number; north: number;
    } | null;
    sample_locations: { latitude: number; longitude: number }[];
    sampled_location_count: number;
  };
  depth: {
    mode: DepthMode;
    dataset_min_m: number;
    dataset_max_m: number;
    matched_min_m: number | null;
    matched_max_m: number | null;
    requested_min_m?: number;
    requested_max_m?: number;
    requested_target_m?: number;
    max_level_gap_m: number | null;
    median_level_spacing_m: number | null;
    level_pair_count: number;
  };
  variables: Record<string, VariableCoverage>;
}

export interface Matching {
  observations: number;
  profiles: number;
  floats: number;
  platforms: string[];
  profile_ids: string[];
}

/** Identity of the data the plan was validated against. */
export interface DatasetIdentity {
  observation_count: number;
  profile_count: number;
  float_count: number;
  time_min: string | null;
  time_max: string | null;
  latitude_min: number;
  latitude_max: number;
  longitude_min: number;
  longitude_max: number;
  depth_min_m: number;
  depth_max_m: number;
  data_modes_present: DataMode[];
  qc_flags_present: number[];
  dataset_id?: string | null;
  source_url?: string | null;
  raw_file_checksum?: string | null;
  processed_at?: string | null;
  processing_script?: string | null;
}

/** The QC/data-mode policy actually applied, and where each part came from. */
export interface EffectivePolicy {
  source: 'request' | 'default';
  accepted_qc_flags: { value: number[]; source: 'request' | 'default' };
  data_modes: {
    value: DataMode[];
    source: 'request' | 'default';
    present_in_dataset: DataMode[];
    requested_but_absent: DataMode[];
  };
  note: string;
}

export interface PlanValidationResponse {
  schema_version: string;
  outcome: Outcome;
  /** The request exactly as received, echoed back. Non-finite numbers are
   * serialized as null, because JSON has no literal for them. */
  requested: unknown;
  normalized_plan: NormalizedPlan | null;
  errors: Issue[];
  warnings: Issue[];
  matching: Matching | null;
  coverage: Coverage | null;
  effective_policy?: EffectivePolicy | null;
  dataset: DatasetIdentity | null;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** One measured level. `derived` is always false here; computed values live in
 * `ExecutionResults.derived` so they cannot be mistaken for observations. */
export interface ExecutedObservation {
  profile_id: string;
  pres: number;
  pres_qc: number | null;
  depth: number;
  source_field: 'raw' | 'adjusted';
  derived: false;
  temp?: number | null;
  temp_qc?: number | null;
  temp_status?: string | null;
  temp_exclusion_reason?: string | null;
  psal?: number | null;
  psal_qc?: number | null;
  psal_status?: string | null;
  psal_exclusion_reason?: string | null;
}

/** A value at an exact depth. Computed, not measured. */
export interface DerivedValue {
  profile_id: string;
  variable: Variable;
  target_depth_m: number;
  available: boolean;
  value: number | null;
  method: 'exact' | 'linear_interpolation' | null;
  bracketing_depths: [number, number] | null;
  gap_m: number | null;
  reason: string | null;
  derived: true;
  derivation: string;
}

export interface ExecutedProfile {
  profile_id: string;
  platform: string;
  cycle: number;
  direction: string | null;
  data_mode: DataMode;
  source_field: 'raw' | 'adjusted';
  time: string;
  latitude: number;
  longitude: number;
  levels_in_plan: number;
  depth_min_m: number;
  depth_max_m: number;
  profile_levels_total: number;
  dataset_id: string | null;
  source_url: string | null;
  retrieved_at: string | null;
  variables: Record<
    string,
    { valid_levels: number; excluded_levels: number; exclusions?: Record<string, number> }
  >;
}

/**
 * One interval between two adjacent measured levels.
 *
 * Both the gradient and the midpoint depth are derived: the midpoint is the
 * arithmetic centre of two sampled depths, not a depth anything was sampled
 * at. Endpoints are the two source measurements, carried so any interval can
 * be recomputed by hand.
 */
export interface GradientInterval {
  variable: Variable;
  profile_id: string | null;
  upper: { depth_m: number; value: number };
  lower: { depth_m: number; value: number };
  midpoint_depth_m: number;
  delta_depth_m: number;
  delta_value: number;
  gradient: number;
  units: string;
  value_units: string;
  derived: true;
}

/** Why two adjacent levels produced no gradient. A break is never bridged. */
export interface GradientBreak {
  reason:
    | 'missing_value'
    | 'gap_exceeds_policy'
    | 'conflicting_duplicate_depth'
    | 'unusable_depth';
  message: string;
  depth_m?: number | null;
  upper_depth_m?: number;
  lower_depth_m?: number;
  gap_m?: number;
  max_gap_m?: number;
  values?: number[];
}

export type GradientStatus = 'ok' | 'no_eligible_intervals' | 'insufficient_samples';

export interface VariableGradients {
  variable: Variable;
  profile_id: string | null;
  status: GradientStatus;
  intervals: GradientInterval[];
  interval_count: number;
  breaks: GradientBreak[];
  break_count: number;
  accepted_sample_count: number;
  units: string;
  max_gap_m: number;
  /** Stated as an application policy, not an oceanographic threshold. */
  max_gap_policy: string;
  method: string;
  /** Stated once per series: the gradient and midpoint are derived. */
  derivation: string;
  derived: true;
}

/**
 * The steepest fall in temperature with depth in this result. Deliberately
 * not a thermocline, mixed-layer depth, anomaly or heatwave.
 */
export interface StrongestCooling {
  label: string;
  caveat: string;
  interval: GradientInterval;
}

export interface GradientReport {
  profile_id: string | null;
  variables: Partial<Record<Variable, VariableGradients>>;
  strongest_cooling: StrongestCooling | null;
  /** Present when there is no cooling interval, so absence is stated. */
  cooling_note?: string;
  derived: true;
}

/** A per-profile thermocline estimate. The estimated depth is the midpoint of
 * the supporting interval and is derived; the interval endpoints are recorded
 * measurements. Statuses distinguish "not enough evidence to judge" from "no
 * candidate qualified under this method" - neither means the ocean has none. */
export interface ThermoclineEstimate {
  profile_id: string | null;
  status: 'estimated' | 'ambiguous' | 'insufficient_evidence'
        | 'no_qualifying_candidate' | 'not_applicable';
  reason: string;
  method: string;
  method_version: string;
  policy: Record<string, number | string>;
  analysed_depth_range_m: [number, number] | null;
  range_note: string;
  candidate: {
    estimated_depth_m: number;
    estimated_depth_is_derived: boolean;
    midpoint_note: string;
    gradient_c_per_m: number;
    units?: string | null;
    value_units?: string | null;
    supporting_interval: {
      upper: { depth_m: number; value: number };
      lower: { depth_m: number; value: number };
      measured: boolean;
    };
    temperature_drop_c: number;
    contiguous_cooling_intervals: number;
    prominence_ratio: number | null;
    at_analysed_boundary: string | null;
  } | null;
  competing_candidates?: { upper_depth_m: number; lower_depth_m: number; gradient_c_per_m: number }[];
  eligible_interval_count?: number;
  accepted_sample_count?: number;
}

export interface ExecutionResults {
  profiles: ExecutedProfile[];
  observations: ExecutedObservation[];
  observation_count: number;
  returned_observation_count: number;
  derived: DerivedValue[];
  /** One report per returned profile, when a gradient analysis was requested. */
  gradients?: GradientReport[];
  thermoclines?: ThermoclineEstimate[];
  gradient_count?: number;
  truncated: boolean;
  variables: Variable[];
  limitations: { code: string; message: string }[];
}

export interface PlanExecutionResponse {
  schema_version: string;
  executed: boolean;
  executed_at: string | null;
  outcome: Outcome;
  /** The plan the server actually applied. Label results from this, never from
   * the draft the user may have edited since. */
  plan: NormalizedPlan | null;
  validation: PlanValidationResponse;
  dataset: DatasetIdentity | null;
  results: ExecutionResults | null;
  refusal?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Grounded explanations
// ---------------------------------------------------------------------------

export const EXPLAIN_SCHEMA_VERSION = '1.0';

export const EXPLAIN_OUTCOMES = [
  'explained',
  'insufficient_evidence',
  'provider_unavailable',
  'dataset_mismatch',
] as const;
export type ExplainOutcome = (typeof EXPLAIN_OUTCOMES)[number];

/**
 * One fact the backend computed from the executed query.
 *
 * `kind` keeps a derived quantity from reading as an observation, and `units`
 * is carried with the value rather than assumed. Nothing here is computed or
 * edited in the browser.
 */
export interface EvidenceFact {
  id: string;
  label: string;
  value: number | string | boolean | null;
  units: string | null;
  kind: 'measured' | 'derived' | 'reference' | 'count' | 'extent' | 'status';
}

/** The server-verified facts an explanation was built from. */
export interface Evidence {
  schema_version: string;
  dataset_version: string;
  plan_fingerprint: string;
  executed: boolean;
  outcome: Outcome;
  variables: Variable[];
  facts: EvidenceFact[];
  fact_ids: string[];
  sample_locations: Record<string, number>[];
  sample_locations_truncated: boolean;
  platforms: string[];
  limitations: { code: string | null; message: string | null }[];
  notes: string[];
}

/** One rendered sentence, with the facts whose values it carries. */
export interface ExplanationSentence {
  template: string;
  variable: string | null;
  text: string;
  fact_ids: string[];
}

export interface PlanExplanationResponse {
  schema_version: string;
  outcome: ExplainOutcome;
  sentences: ExplanationSentence[];
  caveats: string[];
  limitations: { code: string | null; message: string | null }[];
  used_fact_ids: string[];
  rejected: { reason: string; detail: string | null }[];
  provider_message: string | null;
  dataset_version: string | null;
  plan_fingerprint: string | null;
  /**
   * `model` when a model chose which approved sentences to use; `data_summary`
   * when the backend built them with no model at all. The interface must never
   * present the second as though it were the first.
   */
  source: 'model' | 'data_summary' | null;
  evidence?: Evidence;
  errors?: Issue[];
}

// ---------------------------------------------------------------------------
// Natural-language drafting
// ---------------------------------------------------------------------------

export const DRAFT_OUTCOMES = [
  'proposed_draft',
  'clarification_needed',
  'unsupported_request',
  'provider_unavailable',
] as const;
export type DraftOutcome = (typeof DRAFT_OUTCOMES)[number];

/** One deterministic difference, computed by the backend — never a model's
 * description of its own changes. */
export interface FieldChange {
  field: string;
  previous: unknown;
  proposed: unknown;
  origin: 'changed' | 'retained' | 'default';
}

export interface UnsupportedRequest {
  requested: string;
  kind: string;
  reason: string | null;
}

export interface PlanDraftResponse {
  schema_version: string;
  outcome: DraftOutcome;
  proposed_plan: QueryPlanRequest | null;
  normalized_plan: NormalizedPlan | null;
  changes: FieldChange[];
  retained_fields: string[];
  assumptions: string[];
  clarification_question: string | null;
  unsupported: UnsupportedRequest[];
  errors: Issue[];
  provider_message: string | null;
  reference_date_utc: string | null;
  revision: number | null;
  question: string | null;
}

/** Public provider configuration status. Never carries a credential. */
export interface NlStatus {
  configured: boolean;
  kind?: string;
  model?: string;
  base_url?: string;
  timeout_s?: number;
  max_question_chars?: number;
  credential_configured?: boolean;
  message?: string;
  error?: string | null;
  env_vars?: string[];
}

export interface Capability {
  implemented: boolean;
  description: string;
  provided_by: string | null;
  unavailable_reason: string | null;
}

export interface CapabilityReport {
  schema_version: string;
  analyses: Record<Analysis, Capability>;
  outputs: Record<Output, Capability>;
  variables: Variable[];
  data_modes: DataMode[];
  named_regions: Record<
    NamedRegion,
    { west: number; east: number; south: number; north: number }
  >;
  depth_modes: DepthMode[];
  error_codes: Record<string, string>;
  warning_codes: Record<string, string>;
  dataset: DatasetIdentity;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const API_BASE = 'http://localhost:8000/api';

/**
 * Every call sends cookies, because the API authenticates with an HttpOnly
 * session cookie. The frontend and the API are different origins (ports 3000
 * and 8000), so this also requires the API's explicit CORS allow-list.
 */
const WITH_SESSION = { credentials: 'include' as const };

/**
 * Validate a plan. A 422 is an expected outcome, not a transport failure, so
 * the body is returned for every status the validator produces.
 */
export async function validatePlan(
  plan: QueryPlanRequest,
  apiBase: string = API_BASE,
  signal?: AbortSignal,
): Promise<PlanValidationResponse> {
  const response = await fetch(`${apiBase}/plan/validate`, {
    method: 'POST',
    ...WITH_SESSION,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
    signal,
  });
  return (await response.json()) as PlanValidationResponse;
}

/**
 * Run a plan. The server revalidates it, so a refusal here is authoritative
 * regardless of what the client believed about the draft.
 */
export async function executePlan(
  plan: QueryPlanRequest,
  apiBase: string = API_BASE,
  signal?: AbortSignal,
): Promise<PlanExecutionResponse> {
  const response = await fetch(`${apiBase}/plan/execute`, {
    method: 'POST',
    ...WITH_SESSION,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
    signal,
  });
  return (await response.json()) as PlanExecutionResponse;
}

/**
 * Ask the backend to propose a draft from a question.
 *
 * This only *proposes*. It never runs a query, and the returned plan enters the
 * builder as an ordinary edit that the user can change before running.
 * A 503 (provider unavailable) is an expected outcome, not a transport error,
 * so the body is returned for every status the endpoint produces.
 */
export async function draftPlanFromQuestion(
  question: string,
  context: QueryPlanRequest | null,
  revision: number,
  apiBase: string = API_BASE,
  signal?: AbortSignal,
  referenceDate?: string,
): Promise<PlanDraftResponse> {
  // The only route that requires an account, so the only one that must
  // present the session's CSRF token.
  const response = await fetch(`${apiBase}/plan/draft`, {
    method: 'POST',
    ...WITH_SESSION,
    headers: { 'Content-Type': 'application/json', ...csrfHeader() },
    body: JSON.stringify({
      question,
      context,
      revision,
      reference_date: referenceDate ?? new Date().toISOString(),
    }),
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    // The session is missing or expired. Report it in the shape the assistant
    // already renders, rather than letting an error body reach the reducer.
    return {
      schema_version: PLAN_SCHEMA_VERSION,
      outcome: 'provider_unavailable',
      proposed_plan: null,
      normalized_plan: null,
      changes: [],
      retained_fields: [],
      assumptions: [],
      clarification_question: null,
      unsupported: [],
      errors: [{ code: 'not_signed_in', field: null, message: 'Sign in again to use the AI Assistant.' }],
      provider_message: 'Your session has ended. Sign in again to draft a query.',
      reference_date_utc: null,
      revision,
      question,
    };
  }
  return (await response.json()) as PlanDraftResponse;
}

/**
 * Ask the backend to explain the result on screen.
 *
 * Explicit only: this never runs on its own. The plan and the dataset version
 * say *which* result is being explained; no measurement is sent from here,
 * because the server recomputes every value it will quote.
 *
 * A 409 (the data changed underneath these results) and a provider failure are
 * expected outcomes rather than transport errors, so the body is returned for
 * every status the endpoint produces.
 */
export async function explainResult(
  /**
   * The plan that produced the results being explained, in request shape.
   *
   * Deliberately not a `NormalizedPlan`: the plan returned by execution
   * carries normalization fields the request schema rejects, so sending it
   * would fail validation. Pass the snapshot taken when the query was run.
   */
  plan: QueryPlanRequest,
  datasetVersion: string | null,
  mode: ViewMode,
  apiBase: string = API_BASE,
  signal?: AbortSignal,
): Promise<PlanExplanationResponse> {
  const response = await fetch(`${apiBase}/plan/explain`, {
    method: 'POST',
    ...WITH_SESSION,
    headers: { 'Content-Type': 'application/json', ...csrfHeader() },
    body: JSON.stringify({ plan, dataset_version: datasetVersion, view_mode: mode }),
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    // Report an ended session in the shape the assistant already renders.
    return {
      schema_version: EXPLAIN_SCHEMA_VERSION,
      outcome: 'provider_unavailable',
      sentences: [],
      caveats: [],
      limitations: [],
      used_fact_ids: [],
      rejected: [],
      provider_message: 'Your session has ended. Sign in again to explain these results.',
      dataset_version: null,
      plan_fingerprint: null,
      source: null,
      errors: [{ code: 'not_signed_in', field: null, message: 'Sign in again to explain results.' }],
    };
  }
  return (await response.json()) as PlanExplanationResponse;
}

export async function fetchNlStatus(
  apiBase: string = API_BASE,
): Promise<NlStatus> {
  const response = await fetch(`${apiBase}/plan/nl_status`, WITH_SESSION);
  return (await response.json()) as NlStatus;
}

export async function fetchCapabilities(
  apiBase: string = API_BASE,
): Promise<CapabilityReport> {
  const response = await fetch(`${apiBase}/plan/capabilities`, WITH_SESSION);
  return (await response.json()) as CapabilityReport;
}

/**
 * Whether this validation result permits execution.
 *
 * Necessary but NOT sufficient: it says nothing about *which* draft the result
 * belongs to. A result for a superseded revision can still be "executable" in
 * isolation, so callers must also confirm the result matches the current draft
 * — `canExecute` in `querySession.ts` does both.
 *
 * Partial coverage may execute, with its limitations shown. `unsupported`,
 * `invalid` and `valid_no_data` may not: the first two are refused by the
 * server anyway, and the third has nothing to draw.
 */
export function isExecutable(result: PlanValidationResponse): boolean {
  if (result.outcome !== 'valid' && result.outcome !== 'valid_partial_coverage') {
    return false;
  }
  // Defence in depth: an outcome that permits execution should never carry
  // errors, and must have produced a normalized plan.
  return result.errors.length === 0 && result.normalized_plan !== null;
}
