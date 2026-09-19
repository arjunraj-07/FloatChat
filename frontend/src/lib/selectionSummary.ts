/**
 * Short, readable descriptions of what a query selects.
 *
 * Display names only. The plan keeps its own identifiers and bounds: the
 * cached extraction is still `argo_cached_subset` with its exact box on the
 * wire, and nothing here is ever sent back to the API. Renaming a region for
 * a reader must never rename it for the backend.
 */

import type {
  NamedRegion,
  NormalizedPlan,
  QueryPlanRequest,
  Variable,
} from './planContract.ts';

/**
 * How each named region is written for people. "Arabian Sea sample" says what
 * the cached extraction actually is - one sample of the Arabian Sea, not the
 * whole sea - without implying coverage it does not have.
 */
export const REGION_LABELS: Record<NamedRegion, string> = {
  arabian_sea: 'Arabian Sea',
  bay_of_bengal: 'Bay of Bengal',
  equatorial_indian_ocean: 'Equatorial Indian Ocean',
  argo_cached_subset: 'Arabian Sea sample',
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** The UTC day of an instant, read from the text so no time zone applies. */
function utcDay(iso: string): { year: string; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { year: match[1], month: Number(match[2]) - 1, day: Number(match[3]) };
}

function writeDay(day: { year: string; month: number; day: number }): string {
  return `${day.day} ${MONTHS[day.month]} ${day.year}`;
}

/** "Arabian Sea sample", or a box written in degrees. */
export function regionLabel(region: QueryPlanRequest['region']): string {
  if (region.kind === 'named') return REGION_LABELS[region.name] ?? region.name;
  const lat = `${region.south}–${region.north}° N`;
  const lon = `${region.west}–${region.east}° E`;
  return `${lat}, ${lon}`;
}

/**
 * "1–9 Jan 2024", collapsing the parts both ends share. Both ends are
 * inclusive, as the schema defines them.
 */
export function datesLabel(time: QueryPlanRequest['time']): string {
  const start = utcDay(time.start);
  const end = utcDay(time.end);
  if (!start || !end) return `${time.start.slice(0, 10)} – ${time.end.slice(0, 10)}`;
  if (start.year === end.year && start.month === end.month) {
    return start.day === end.day
      ? writeDay(start)
      : `${start.day}–${end.day} ${MONTHS[start.month]} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${MONTHS[start.month]} – ${writeDay(end)}`;
  }
  return `${writeDay(start)} – ${writeDay(end)}`;
}

/** "Temperature", or "Temperature and salinity". */
export function variablesLabel(variables: Variable[]): string {
  const names = variables.map((v) => (v === 'temp' ? 'Temperature' : 'Salinity'));
  if (names.length === 0) return 'No variable';
  if (names.length === 1) return names[0];
  return `${names[0]} and ${names.slice(1).join(', ').toLowerCase()}`;
}

/** "0–500 m", or "at 100 m" for an exact-depth request. */
export function depthLabel(depth: QueryPlanRequest['depth']): string {
  return depth.mode === 'range'
    ? `${depth.min_m}–${depth.max_m} m`
    : `at ${depth.target_m} m`;
}

export interface SelectionSummary {
  region: string;
  dates: string;
  variables: string;
  depth: string;
}

/** The compact summary shown above the map. */
export function summarizeSelection(plan: QueryPlanRequest): SelectionSummary {
  return {
    region: regionLabel(plan.region),
    dates: datesLabel(plan.time),
    variables: variablesLabel(plan.variables),
    depth: depthLabel(plan.depth),
  };
}

/**
 * Which parts of the summary differ between the draft and the plan whose
 * results are on screen.
 *
 * Used to mark exactly the changed parts as pending, so a reader is never
 * left guessing whether the summary describes what they are looking at or
 * what they are about to ask for. This is display-level only: whether results
 * are out of date is decided by the query session, not here.
 */
export function changedFrom(
  draft: SelectionSummary | null,
  shown: SelectionSummary | null,
): (keyof SelectionSummary)[] {
  if (!draft || !shown) return [];
  return (Object.keys(draft) as (keyof SelectionSummary)[]).filter(
    (key) => draft[key] !== shown[key],
  );
}

export function changedFields(
  draft: QueryPlanRequest | null,
  shown: QueryPlanRequest | null | undefined,
): (keyof SelectionSummary)[] {
  if (!draft || !shown) return [];
  return changedFrom(summarizeSelection(draft), summarizeSelection(shown));
}

/**
 * The same summary for the normalized plan the server echoes back with a
 * result. Its shape differs from a draft request - a named region also
 * carries its resolved bounds, and depth fields are optional - so it is read
 * here rather than cast at the call site.
 */
export function summarizeNormalized(
  plan: NormalizedPlan | null | undefined,
): SelectionSummary | null {
  if (!plan) return null;
  const region: QueryPlanRequest['region'] =
    plan.region.kind === 'named' && plan.region.name
      ? { kind: 'named', name: plan.region.name }
      : {
          kind: 'bbox',
          west: plan.region.west,
          east: plan.region.east,
          south: plan.region.south,
          north: plan.region.north,
        };
  const depth: QueryPlanRequest['depth'] =
    plan.depth.mode === 'range'
      ? { mode: 'range', min_m: plan.depth.min_m ?? 0, max_m: plan.depth.max_m ?? 0 }
      : { mode: 'at_depth', target_m: plan.depth.target_m ?? 0 };
  return {
    region: regionLabel(region),
    dates: datesLabel(plan.time),
    variables: variablesLabel(plan.variables),
    depth: depthLabel(depth),
  };
}

export function selectionChanged(
  draft: QueryPlanRequest | null,
  shown: QueryPlanRequest | null | undefined,
): boolean {
  return changedFields(draft, shown).length > 0;
}
