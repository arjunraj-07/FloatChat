/**
 * Pure presentation logic for the explorer: grouping profiles by float,
 * previous/next navigation, two-profile comparison selection, per-variable
 * availability, the "use cached data" draft, and display formatting.
 *
 * Nothing here calculates science. Values come from the executed response
 * unchanged; this module only selects, orders and labels them, so it can be
 * unit-tested without a browser.
 */

import type {
  ExecutedObservation,
  ExecutedProfile,
  Variable,
} from './planContract.ts';
import type { DraftForm } from './draftPlan.ts';

export type ViewMode = 'student' | 'scientific';

/** What /api/coverage reports; counts are always read from here, never assumed. */
export interface CoverageInfo {
  dataset: string;
  distinct_floats: number;
  distinct_profiles: number;
  observation_count: number;
  date_range: [string, string];
  bounding_box: { west: number; east: number; south: number; north: number };
  /** The area the cached subset was extracted for; not an area sampled throughout. */
  search_region?: { west: number; east: number; south: number; north: number; source?: string } | null;
  depth_range_m: [number, number];
  variable_definitions?: Record<string, { argo_name: string; long_name: string; units?: string }>;
  label?: string;
  /** Which processed extract every number here came from. `is_fallback` means
   * the original January 2024 extract is being served because no refreshed
   * snapshot is active, or the active one was unusable. */
  snapshot?: {
    snapshot_id: string;
    is_fallback: boolean;
    reason?: string | null;
    requested_window_utc?: [string, string] | null;
    requested_region?: { west: number; east: number; south: number; north: number } | null;
    retrieved_at?: string | null;
    truncated?: boolean;
    max_rows?: number | null;
  } | null;
  temperature_only_observations?: number;
  /** Profiles per Argo data mode (R, A, D). */
  data_modes?: Record<string, number>;
  /** Exclusion counts from processing; `psal_masked` by reason. */
  exclusions?: { psal_masked?: Record<string, number> } & Record<string, unknown>;
  provenance?: {
    dataset_id?: string | null;
    source_url?: string | null;
    raw_file_checksum?: string | null;
    processed_at?: string | null;
    policy?: Record<string, unknown>;
  };
}

/** /api/woa_match/{profile_id}: a difference from climatology, or why not. */
export interface WoaMatchResponse {
  status: string;
  reason?: string;
  comparison_depth?: number;
  argo_interpolated_value?: number;
  woa_reference_value?: number;
  difference?: number;
  baseline_period?: string;
  month?: number;
  method?: string;
  match_method?: string;
  bracketing_depths?: [number, number];
  gap_m?: number;
  spatial_offset?: { lat: number; lon: number };
  reference?: Record<string, string | number | null>;
  limitations?: string[];
}

// ---------------------------------------------------------------------------
// Time and place formatting
// ---------------------------------------------------------------------------

/**
 * Parse a backend timestamp as UTC.
 *
 * The observation tables store naive timestamps that mean UTC. `new Date()`
 * would read a naive string as browser-local time, so an offset is added when
 * none is present. Display only - this does not alter any plan value.
 */
export function utcDate(iso: string): Date {
  const hasOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasOffset ? iso : `${iso}Z`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "2024-01-05 04:46 UTC", or "2024-01-05" when `withTime` is false. */
export function formatUtc(iso: string, withTime = true): string {
  const d = utcDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` : day;
}

/** "15.52° N, 61.58° E" with hemisphere letters rather than signs. */
export function formatPosition(latitude: number, longitude: number, digits = 2): string {
  const lat = `${Math.abs(latitude).toFixed(digits)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(digits)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

// ---------------------------------------------------------------------------
// Floats and profile navigation
// ---------------------------------------------------------------------------

export interface FloatGroup {
  platform: string;
  /** This float's profiles in the executed result, oldest first. */
  profiles: ExecutedProfile[];
}

/** Order by observation time; profile id breaks ties so order is stable. */
export function byObservationTime(
  a: { time: string; profile_id: string },
  b: { time: string; profile_id: string },
): number {
  const delta = utcDate(a.time).getTime() - utcDate(b.time).getTime();
  return delta !== 0 ? delta : a.profile_id.localeCompare(b.profile_id);
}

/** Profiles grouped by float, floats by WMO number, profiles by time. */
export function groupByFloat(profiles: ExecutedProfile[]): FloatGroup[] {
  const groups: Record<string, ExecutedProfile[]> = {};
  for (const profile of profiles) {
    (groups[profile.platform] ??= []).push(profile);
  }
  return Object.keys(groups)
    .sort()
    .map((platform) => ({
      platform,
      profiles: [...groups[platform]].sort(byObservationTime),
    }));
}

export interface FloatPosition {
  group: FloatGroup;
  /** Zero-based position of the active profile within its float. */
  index: number;
  count: number;
  previousId: string | null;
  nextId: string | null;
}

/**
 * Where the active profile sits among its own float's profiles in this
 * result. Navigation never leaves the float and never reaches profiles that
 * the executed query did not return.
 */
export function floatPosition(
  profiles: ExecutedProfile[],
  activeId: string | null,
): FloatPosition | null {
  if (!activeId) return null;
  const active = profiles.find((p) => p.profile_id === activeId);
  if (!active) return null;
  const group = groupByFloat(profiles).find((g) => g.platform === active.platform)!;
  const index = group.profiles.findIndex((p) => p.profile_id === activeId);
  return {
    group,
    index,
    count: group.profiles.length,
    previousId: index > 0 ? group.profiles[index - 1].profile_id : null,
    nextId: index < group.profiles.length - 1 ? group.profiles[index + 1].profile_id : null,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface CompareSelection {
  a: string | null;
  b: string | null;
}

type ProfileNaming = Pick<
  ExecutedProfile,
  'profile_id' | 'platform' | 'cycle' | 'direction' | 'time' | 'latitude' | 'longitude'
>;

/**
 * A compact name that tells profiles apart at a glance:
 * "Float 2902201 · cycle 287 · 2024-01-05 12:13 UTC". Float first, so what
 * survives a narrow control is still the most distinguishing part.
 */
export function profileLabel(profile: ProfileNaming): string {
  const direction = profile.direction === 'D' ? ' (descending)' : '';
  return `Float ${profile.platform} · cycle ${profile.cycle}${direction} · ${formatUtc(profile.time)}`;
}

/** The full identity, for tooltips and screen readers. */
export function profileIdentity(profile: ProfileNaming): string {
  const direction =
    profile.direction === 'A' ? ', ascending' : profile.direction === 'D' ? ', descending' : '';
  return (
    `Profile ${profile.profile_id}: float ${profile.platform}, cycle ${profile.cycle}${direction}, ` +
    `${formatUtc(profile.time)}, ${formatPosition(profile.latitude, profile.longitude)}`
  );
}

/**
 * Resolve a comparison selection against the profiles actually present.
 *
 * A selection that no longer exists in the executed result is reset rather
 * than kept, and the two sides are never the same profile. `preferredA` (the
 * profile open in the explorer) seeds side A when the user has not chosen.
 */
export function resolveComparison(
  selection: CompareSelection,
  orderedIds: string[],
  preferredA: string | null,
): CompareSelection {
  return comparisonAtTime(selection, orderedIds, orderedIds, preferredA).selection;
}

export interface HiddenComparison {
  side: 'a' | 'b';
  profileId: string;
}

/**
 * The comparison as it can be shown when only `visibleIds` of the result's
 * `resultIds` are on screen (for example, at an earlier navigator time).
 *
 * A chosen profile that is still visible is kept. One that is in the result
 * but not visible is shown as cleared and reported in `hidden` - never
 * replaced by another profile - and returns once it is visible again. Only a
 * side never chosen, or chosen in an earlier result, is filled from the
 * visible profiles, preferring the open profile for side A.
 */
export function comparisonAtTime(
  selection: CompareSelection,
  resultIds: string[],
  visibleIds: string[],
  preferredA: string | null,
): { selection: CompareSelection; hidden: HiddenComparison[] } {
  const hidden: HiddenComparison[] = [];
  const status = (id: string | null) =>
    id === null ? 'unset' : visibleIds.includes(id) ? 'visible' : resultIds.includes(id) ? 'hidden' : 'unset';
  const statusA = status(selection.a);
  const statusB = status(selection.b);
  if (statusA === 'hidden') hidden.push({ side: 'a', profileId: selection.a! });
  if (statusB === 'hidden') hidden.push({ side: 'b', profileId: selection.b! });

  let a = statusA === 'visible' ? selection.a : null;
  let b = statusB === 'visible' && selection.b !== a ? selection.b : null;
  if (statusA === 'unset') {
    a = [preferredA, ...visibleIds].find((id) => id !== null && visibleIds.includes(id) && id !== b) ?? null;
  }
  if (statusB !== 'hidden' && b === null) {
    b = visibleIds.find((id) => id !== a) ?? null;
  }
  return { selection: { a, b }, hidden };
}

export interface ProfileSeries {
  profileId: string;
  /** Observed levels, shallow to deep. */
  depths: number[];
  /** `null` where the level has no valid value. Never filled or smoothed. */
  values: (number | null)[];
  validCount: number;
  levelCount: number;
}

/** One variable of one profile, straight from the executed observations. */
export function profileSeries(
  observations: ExecutedObservation[],
  profileId: string,
  variable: Variable,
): ProfileSeries {
  const levels = observations
    .filter((o) => o.profile_id === profileId)
    .sort((x, y) => x.depth - y.depth);
  const values = levels.map((o) => {
    const value = o[variable];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
  return {
    profileId,
    depths: levels.map((o) => o.depth),
    values,
    validCount: values.filter((v) => v !== null).length,
    levelCount: levels.length,
  };
}

// ---------------------------------------------------------------------------
// Variable availability
// ---------------------------------------------------------------------------

export type Availability =
  | { state: 'available'; valid: number; excluded: number }
  | { state: 'none'; excluded: number; reasons: Record<string, number> }
  | { state: 'not_requested' };

/** Whether a variable has usable values in this profile of this result. */
export function variableAvailability(
  profile: ExecutedProfile,
  variable: Variable,
  requested: Variable[],
): Availability {
  if (!requested.includes(variable)) return { state: 'not_requested' };
  const summary = profile.variables[variable];
  if (!summary) return { state: 'none', excluded: 0, reasons: {} };
  if (summary.valid_levels > 0) {
    return { state: 'available', valid: summary.valid_levels, excluded: summary.excluded_levels };
  }
  return {
    state: 'none',
    excluded: summary.excluded_levels,
    reasons: summary.exclusions ?? {},
  };
}

/**
 * The stored exclusion statuses, in words. Each keeps its own meaning: a level
 * with no value in the source file is not a quality-control failure, and
 * levels the cached data records no reason for are said to be unrecorded
 * rather than assigned one.
 */
const EXCLUSION_WORDS: Record<string, string> = {
  missing_value: 'had no value in the source file',
  qc_rejected: 'failed quality control',
  qc_malformed: 'had an unreadable quality flag',
};

function levels(count: number): string {
  return `${count} ${count === 1 ? 'level' : 'levels'}`;
}

/**
 * "2 levels had no value in the source file, 1 level failed quality control".
 * Pass `excluded` to account for levels whose reason was not recorded.
 */
export function describeExclusions(reasons: Record<string, number>, excluded?: number): string {
  const entries = Object.entries(reasons).filter(([, count]) => count > 0);
  const parts = entries.map(
    ([code, count]) => `${levels(count)} ${EXCLUSION_WORDS[code] ?? `excluded (${code.replace(/_/g, ' ')})`}`,
  );
  const explained = entries.reduce((sum, [, count]) => sum + count, 0);
  if (excluded !== undefined && excluded > explained) {
    parts.push(`${levels(excluded - explained)} excluded for a reason the cached data does not record`);
  }
  return parts.join(', ');
}

/** The stored reason one level has no valid value, in words. */
export function exclusionReason(code: string | null | undefined): string {
  switch (code) {
    case 'missing_value':
      return 'no value in the source file';
    case 'qc_rejected':
      return 'failed quality control';
    case 'qc_malformed':
      return 'unreadable quality flag';
    default:
      return 'reason not recorded in the cached data';
  }
}

/** Why a requested variable has nothing to plot in one profile. */
export function unavailableReason(info: Availability): string {
  if (info.state !== 'none') return '';
  return info.excluded > 0
    ? describeExclusions(info.reasons, info.excluded)
    : 'no levels of this profile are in the result';
}

// ---------------------------------------------------------------------------
// "Use cached data"
// ---------------------------------------------------------------------------

export interface CoverageMetadata {
  date_range: [string, string];
  bounding_box: { west: number; east: number; south: number; north: number };
  depth_range_m: [number, number];
}

function roundOut(value: number, direction: 'down' | 'up'): number {
  const scaled = value * 100;
  return (direction === 'down' ? Math.floor(scaled) : Math.ceil(scaled)) / 100;
}

/**
 * A draft that covers the cached observations, built from the coverage the
 * backend reports - not from remembered numbers.
 *
 * The box is rounded outward to 0.01° so no sampled position falls outside
 * it. Dates are the first and last observation days in UTC; the end date
 * means "through that day". Depth starts at 0 m, which selects recorded
 * levels and does not request extrapolation. The QC settings the user already
 * chose are kept. This only fills the draft: validation runs as for any edit,
 * and nothing executes until the user presses Run.
 */
export function cachedDataForm(base: DraftForm, coverage: CoverageMetadata): DraftForm {
  const box = coverage.bounding_box;
  return {
    ...base,
    regionKind: 'bbox',
    west: String(roundOut(box.west, 'down')),
    east: String(roundOut(box.east, 'up')),
    south: String(roundOut(box.south, 'down')),
    north: String(roundOut(box.north, 'up')),
    startDate: formatUtc(coverage.date_range[0], false),
    endDate: formatUtc(coverage.date_range[1], false),
    depthMode: 'range',
    depthMin: '0',
    depthMax: String(Math.ceil(coverage.depth_range_m[1])),
    variables: ['temp', 'psal'],
    platforms: '',
    profileIds: '',
    analyses: ['profile_summary', 'depth_profile', 'temperature_gradient', 'salinity_gradient',
      'thermocline_estimation'],
    outputs: ['float_map', 'depth_profile_chart', 'evidence_panel'],
  };
}

/**
 * The query shown on arrival, derived from the dataset the backend reports.
 *
 * The same derivation as a cached-data draft - the box rounded outward, the
 * first and last observed days, depth from zero - but with the lighter
 * analysis set. This one runs automatically on every load, and the full
 * request (both variables with both gradient analyses) returns about 3.24 MB;
 * salinity and its gradient stay one filter change away.
 */
export function defaultFormFor(base: DraftForm, coverage: CoverageMetadata): DraftForm {
  return {
    ...cachedDataForm(base, coverage),
    // Keep the readable name for the cached region rather than the box of
    // degrees a cached-data draft fills in. The bounds and the identifier
    // behind it are identical; only what the summary line reads changes, and
    // the opening screen should say "Arabian Sea sample", not coordinates.
    regionKind: 'named',
    variables: ['temp'],
    analyses: ['profile_summary', 'depth_profile', 'temperature_gradient',
      'thermocline_estimation'],
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export type GlossaryTerm =
  | 'float'
  | 'profile'
  | 'depth'
  | 'temperature'
  | 'salinity'
  | 'qc'
  | 'dataMode'
  | 'derived'
  | 'climatology'
  | 'coverage';

/** Static explanations. No model is involved in producing these. */
export const GLOSSARY: Record<GlossaryTerm, { student: string; scientific: string }> = {
  float: {
    student: 'A robotic instrument that drifts with the ocean and dives to measure the water.',
    scientific: 'An Argo profiling float, identified by its WMO platform number.',
  },
  profile: {
    student: 'One dive of a float: measurements from near the surface down through the water.',
    scientific: 'One Argo cycle; identified here as WMO_cycle_direction (A = ascending).',
  },
  depth: {
    student: 'How far below the sea surface, in metres. Deeper is lower on the charts.',
    scientific: 'Positive-down depth from pressure via -gsw.z_from_p(pressure, latitude).',
  },
  temperature: {
    student: 'How warm the water is, in degrees Celsius.',
    scientific: 'Argo TEMP: in-situ temperature, ITS-90 scale (°C). Not Conservative Temperature.',
  },
  salinity: {
    student: 'How salty the water is. It has no unit; typical ocean values are about 35.',
    scientific: 'Argo PSAL: Practical Salinity, PSS-78 (dimensionless). Not Absolute Salinity.',
  },
  qc: {
    student: 'Quality checks. Only measurements that passed are shown.',
    scientific: 'Only levels whose selected QC flag is 1 (good) are retained.',
  },
  dataMode: {
    student: 'Whether the numbers are fresh from the float or checked and corrected by experts.',
    scientific: 'R = raw values with raw QC; A/D = adjusted values with adjusted QC.',
  },
  derived: {
    student: 'Estimated between two real measurements. Not measured itself.',
    scientific: 'Linear interpolation between bracketing observed levels (max gap 20 m); never extrapolated.',
  },
  climatology: {
    student: 'The long-term average for this month and place, used as a reference.',
    scientific: 'WOA23 decav91C0, 1991-2020 monthly objectively analysed mean, 1.00° grid.',
  },
  coverage: {
    student: 'Where and when the saved data actually has measurements.',
    scientific: 'Extent of discrete sampled profile positions; not a continuous footprint.',
  },
};

/** Short headings for validator warning codes; the full message stays below. */
export const WARNING_TITLES: Record<string, string> = {
  partial_time_coverage: 'Dates extend beyond the cached data',
  partial_depth_coverage: 'Depth range extends beyond the cached data',
  outside_configured_search_region: 'Region extends beyond the cached extraction area',
  spatial_sampling_is_pointwise: 'Data comes from individual float positions',
  sparse_vertical_sampling: 'Measurements are at separate depths',
  variable_partial: 'Some levels lack this variable',
  variable_unavailable: 'A requested variable has no valid values',
  qc_metadata_incomplete: 'Quality flags not kept for excluded levels',
  default_policy_applied: 'Default quality policy applied',
  data_mode_absent: 'A requested data mode is not in the cached data',
  interpolation_not_possible: 'Exact depth not reachable in some profiles',
  reference_data_uncached: 'Climatology reference not cached',
  no_matching_observations: 'No observations match',
};
