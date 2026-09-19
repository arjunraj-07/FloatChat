/**
 * The editable draft behind the query controls.
 *
 * Controls bind to `DraftForm`, whose numeric and identifier fields are held as
 * **strings**. That is deliberate: a user must be able to clear a box and type
 * without the form immediately substituting a default and fighting the cursor.
 * `formToPlan` converts a complete form into a `QueryPlanRequest`; an
 * incomplete one yields field-associated issues and no plan, so nothing
 * half-typed is ever sent.
 *
 * Only parse-level problems are detected here. Every scientific and semantic
 * judgement — reversed ranges, antimeridian boxes, unresolved float ids,
 * coverage — comes from the backend validator, so there is one authority and
 * no duplicated rules.
 */

import {
  type Analysis,
  type DataMode,
  type NamedRegion,
  type Output,
  type QueryPlanRequest,
  type Variable,
  PLAN_SCHEMA_VERSION,
} from './planContract.ts';

export interface DraftForm {
  regionKind: 'bbox' | 'named';
  namedRegion: NamedRegion;
  west: string;
  east: string;
  south: string;
  north: string;
  startDate: string;
  endDate: string;
  depthMode: 'range' | 'at_depth';
  depthMin: string;
  depthMax: string;
  depthTarget: string;
  variables: Variable[];
  platforms: string;
  profileIds: string;
  analyses: Analysis[];
  outputs: Output[];
  /** When false the plan omits `qc_policy` and the server applies — and
   * reports — its default. */
  qcPolicyExplicit: boolean;
  acceptedQcFlags: string;
  dataModes: DataMode[];
}

export interface FormIssue {
  field: string;
  message: string;
}

/**
 * How a date-only input is widened to an instant.
 *
 * A start date means the first instant of that day. An end date means the
 * **last** instant of that day, so "through 10 January" includes everything
 * measured on 10 January rather than only 00:00. Both ends are inclusive,
 * matching the backend schema. Times are UTC, matching the stored timestamps.
 */
export const DATE_SEMANTICS =
  'Dates are inclusive and interpreted in UTC. A start date begins at 00:00:00 ' +
  'that day; an end date runs to 23:59:59.999 that day, so "through 10 January" ' +
  'includes all of 10 January, not just its first instant. A time, if given, ' +
  'must state its time zone (for example Z for UTC).';

/** What a date field's text means, decided without the browser's time zone. */
export type TimeText =
  | { kind: 'empty' }
  | { kind: 'date'; day: string }
  | { kind: 'instant'; iso: string }
  | { kind: 'no_timezone' }
  | { kind: 'invalid' };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parse date-field text.
 *
 * A bare date is a UTC day. A timestamp must name its zone: `new Date()`
 * would read "2019-06-30T23:59:59" as browser-local time while the backend
 * reads it as UTC, so a naive value is reported, never guessed.
 */
export function parseTimeText(value: string): TimeText {
  const text = value.trim();
  if (!text) return { kind: 'empty' };
  if (DATE_ONLY.test(text)) {
    return Number.isNaN(Date.parse(`${text}T00:00:00Z`))
      ? { kind: 'invalid' }
      : { kind: 'date', day: text };
  }
  const match = TIMESTAMP.exec(text);
  if (!match) return { kind: 'invalid' };
  const [, day, hoursMinutes, seconds = ':00', fraction = '', zone] = match;
  if (!zone) return { kind: 'no_timezone' };
  const offset =
    zone.toUpperCase() === 'Z' ? 'Z' : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  // Date holds milliseconds; finer digits are truncated, never rounded up.
  const parsed = new Date(`${day}T${hoursMinutes}${seconds.slice(0, 3)}${fraction.slice(0, 4)}${offset}`);
  return Number.isNaN(parsed.getTime())
    ? { kind: 'invalid' }
    : { kind: 'instant', iso: parsed.toISOString() };
}

export function startInstant(value: string): string | null {
  const parsed = parseTimeText(value);
  if (parsed.kind === 'date') return `${parsed.day}T00:00:00.000Z`;
  return parsed.kind === 'instant' ? parsed.iso : null;
}

export function endInstant(value: string): string | null {
  const parsed = parseTimeText(value);
  if (parsed.kind === 'date') return `${parsed.day}T23:59:59.999Z`;
  return parsed.kind === 'instant' ? parsed.iso : null;
}

function timeIssue(value: string, field: string, label: string): FormIssue | null {
  switch (parseTimeText(value).kind) {
    case 'empty':
      return { field, message: `${label} is required.` };
    case 'no_timezone':
      return {
        field,
        message:
          `"${value.trim()}" has no time zone, so it could mean different instants. ` +
          'Use a date (YYYY-MM-DD), or add Z for UTC.',
      };
    case 'invalid':
      return { field, message: 'Use a date as YYYY-MM-DD, or a timestamp with its time zone.' };
    default:
      return null;
  }
}

/** Split a free-text identifier list on commas or whitespace. */
export function splitIds(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseNumber(
  raw: string,
  field: string,
  label: string,
  issues: FormIssue[],
): number | null {
  const text = raw.trim();
  if (!text) {
    issues.push({ field, message: `${label} is required.` });
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    issues.push({ field, message: `${label} must be a finite number.` });
    return null;
  }
  return value;
}

export function createDefaultForm(): DraftForm {
  return {
    regionKind: 'named',
    namedRegion: 'argo_cached_subset',
    west: '60',
    east: '65',
    south: '15',
    north: '20',
    startDate: '2024-01-01',
    endDate: '2024-01-10',
    depthMode: 'range',
    depthMin: '0',
    depthMax: '500',
    depthTarget: '100',
    variables: ['temp'],
    platforms: '',
    profileIds: '',
    // The default draft asks for temperature only, so only the temperature
    // gradient is requested; salinity's is added when salinity is. The
    // thermocline estimate reads those same temperature gradients.
    analyses: ['depth_profile', 'temperature_gradient', 'thermocline_estimation'],
    outputs: ['depth_profile_chart', 'float_map'],
    qcPolicyExplicit: false,
    acceptedQcFlags: '1',
    dataModes: ['R', 'A', 'D'],
  };
}

export interface FormConversion {
  plan: QueryPlanRequest | null;
  issues: FormIssue[];
}

/** Build a request from a form, or report why it is not yet complete. */
export function formToPlan(form: DraftForm): FormConversion {
  const issues: FormIssue[] = [];

  const start = startInstant(form.startDate);
  const end = endInstant(form.endDate);
  for (const issue of [
    timeIssue(form.startDate, 'time.start', 'A start date'),
    timeIssue(form.endDate, 'time.end', 'An end date'),
  ]) {
    if (issue) issues.push(issue);
  }

  let region: QueryPlanRequest['region'] | null = null;
  if (form.regionKind === 'named') {
    region = { kind: 'named', name: form.namedRegion };
  } else {
    const west = parseNumber(form.west, 'region.west', 'West longitude', issues);
    const east = parseNumber(form.east, 'region.east', 'East longitude', issues);
    const south = parseNumber(form.south, 'region.south', 'South latitude', issues);
    const north = parseNumber(form.north, 'region.north', 'North latitude', issues);
    if (west !== null && east !== null && south !== null && north !== null) {
      region = { kind: 'bbox', west, east, south, north };
    }
  }

  let depth: QueryPlanRequest['depth'] | null = null;
  if (form.depthMode === 'range') {
    const min = parseNumber(form.depthMin, 'depth.min_m', 'Minimum depth', issues);
    const max = parseNumber(form.depthMax, 'depth.max_m', 'Maximum depth', issues);
    if (min !== null && max !== null) depth = { mode: 'range', min_m: min, max_m: max };
  } else {
    const target = parseNumber(
      form.depthTarget, 'depth.target_m', 'Target depth', issues,
    );
    if (target !== null) depth = { mode: 'at_depth', target_m: target };
  }

  if (form.variables.length === 0) {
    issues.push({
      field: 'variables',
      message: 'Select at least one variable.',
    });
  }

  let qcPolicy: QueryPlanRequest['qc_policy'];
  if (form.qcPolicyExplicit) {
    const flags: number[] = [];
    for (const token of splitIds(form.acceptedQcFlags)) {
      const value = Number(token);
      if (!Number.isFinite(value)) {
        issues.push({
          field: 'qc_policy.accepted_qc_flags',
          message: `"${token}" is not a QC flag number.`,
        });
      } else {
        flags.push(value);
      }
    }
    if (flags.length === 0) {
      issues.push({
        field: 'qc_policy.accepted_qc_flags',
        message: 'List at least one QC flag, or use the default policy.',
      });
    }
    if (form.dataModes.length === 0) {
      issues.push({
        field: 'qc_policy.data_modes',
        message: 'Select at least one data mode, or use the default policy.',
      });
    }
    if (flags.length > 0 && form.dataModes.length > 0) {
      qcPolicy = { accepted_qc_flags: flags, data_modes: form.dataModes };
    }
  }

  if (issues.length > 0 || !region || !depth || !start || !end) {
    return { plan: null, issues };
  }

  const plan: QueryPlanRequest = {
    schema_version: PLAN_SCHEMA_VERSION,
    time: { start, end },
    region,
    depth,
    variables: form.variables,
    analyses: form.analyses,
    outputs: form.outputs,
  };
  const platforms = splitIds(form.platforms);
  const profileIds = splitIds(form.profileIds);
  if (platforms.length > 0 || profileIds.length > 0) {
    plan.selection = { platforms, profile_ids: profileIds };
  }
  if (qcPolicy) plan.qc_policy = qcPolicy;
  return { plan, issues };
}

/** The UTC day of a plan time, whatever offset it was written with. */
function formatDay(value: string): string {
  const parsed = parseTimeText(value);
  return parsed.kind === 'instant' ? parsed.iso.slice(0, 10) : value.slice(0, 10);
}

/**
 * Collapse a proposed instant back to the text the date controls show.
 *
 * The inverse of {@link startInstant} / {@link endInstant}, computed on the
 * UTC instant rather than the text, so an offset such as +05:30 cannot shift
 * the day. An instant on a UTC day boundary becomes a bare date; any other
 * instant is shown in UTC at full precision, so its instant is kept. A
 * timestamp without a time zone is kept verbatim for the form to report; it
 * is never read as local time.
 */
function toDateField(value: string, edge: 'start' | 'end'): string {
  const parsed = parseTimeText(value);
  if (parsed.kind === 'date') return parsed.day;
  if (parsed.kind !== 'instant') return value;
  const day = parsed.iso.slice(0, 10);
  const boundary = edge === 'start' ? startInstant(day) : endInstant(day);
  return boundary === parsed.iso ? day : parsed.iso;
}

function numberField(value: number | undefined, fallback: string): string {
  return value === undefined || value === null ? fallback : String(value);
}

/**
 * Fold a proposed plan into the existing form.
 *
 * Used when the user accepts a natural-language proposal: the result is fed
 * back through the ordinary `edit` action, so the proposal is validated by the
 * same flow as any manual change. Form-only settings the plan does not carry
 * (such as whether the QC policy was made explicit) are preserved.
 */
export function applyPlanToForm(form: DraftForm, plan: QueryPlanRequest): DraftForm {
  const next: DraftForm = { ...form };

  next.startDate = toDateField(plan.time.start, 'start');
  next.endDate = toDateField(plan.time.end, 'end');

  if (plan.region.kind === 'named') {
    next.regionKind = 'named';
    next.namedRegion = plan.region.name;
  } else {
    next.regionKind = 'bbox';
    next.west = String(plan.region.west);
    next.east = String(plan.region.east);
    next.south = String(plan.region.south);
    next.north = String(plan.region.north);
  }

  if (plan.depth.mode === 'range') {
    next.depthMode = 'range';
    next.depthMin = numberField(plan.depth.min_m, form.depthMin);
    next.depthMax = numberField(plan.depth.max_m, form.depthMax);
  } else {
    next.depthMode = 'at_depth';
    next.depthTarget = numberField(plan.depth.target_m, form.depthTarget);
  }

  next.variables = [...plan.variables];
  next.analyses = plan.analyses ? [...plan.analyses] : [];
  next.outputs = plan.outputs ? [...plan.outputs] : [];
  next.platforms = plan.selection ? plan.selection.platforms.join(', ') : '';
  next.profileIds = plan.selection ? plan.selection.profile_ids.join(', ') : '';

  // The planner cannot patch the QC policy, so the user's own setting stands.
  return next;
}

/**
 * A one-line summary for the Map Explorer toolbar, e.g.
 * "Temperature, salinity · 15.51–19.25° N, 61.25–64.45° E · 2024-01-01 → 2024-01-09 · 0–497 m".
 */
export function summarizePlan(plan: QueryPlanRequest): string {
  const variables = plan.variables
    .map((v, index) => {
      const name = v === 'temp' ? 'temperature' : 'salinity';
      return index === 0 ? name[0].toUpperCase() + name.slice(1) : name;
    })
    .join(', ');
  const where =
    plan.region.kind === 'named'
      ? plan.region.name.replace(/_/g, ' ')
      : `${plan.region.south}–${plan.region.north}° N, ${plan.region.west}–${plan.region.east}° E`;
  const depth =
    plan.depth.mode === 'range' ? `${plan.depth.min_m}–${plan.depth.max_m} m` : `at ${plan.depth.target_m} m`;
  return `${variables} · ${where} · ${formatDay(plan.time.start)} → ${formatDay(plan.time.end)} · ${depth}`;
}

/** A one-paragraph reading of the plan, for the understanding preview. */
export function describePlan(plan: QueryPlanRequest): string {
  const where =
    plan.region.kind === 'named'
      ? `the ${plan.region.name.replace(/_/g, ' ')} region`
      : `${plan.region.south}–${plan.region.north}°N, ` +
        `${plan.region.west}–${plan.region.east}°E`;

  const depth =
    plan.depth.mode === 'range'
      ? `between ${plan.depth.min_m} m and ${plan.depth.max_m} m depth`
      : `at exactly ${plan.depth.target_m} m depth (interpolated from the ` +
        `nearest observed levels)`;

  const variables = plan.variables
    .map((v) => (v === 'temp' ? 'temperature' : 'salinity'))
    .join(' and ');

  const selection = plan.selection;
  const floats =
    selection && selection.platforms.length > 0
      ? `, restricted to float${selection.platforms.length > 1 ? 's' : ''} ` +
        selection.platforms.join(', ')
      : '';
  const profiles =
    selection && selection.profile_ids.length > 0
      ? `, restricted to profile${selection.profile_ids.length > 1 ? 's' : ''} ` +
        selection.profile_ids.join(', ')
      : '';

  return (
    `Find ${variables} observations in ${where}, ` +
    `from ${formatDay(plan.time.start)} through ${formatDay(plan.time.end)} ` +
    `inclusive, ${depth}${floats}${profiles}.`
  );
}
