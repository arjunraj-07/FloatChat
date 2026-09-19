/**
 * Presentation helpers for vertical gradients.
 *
 * Selection and wording only: every number here comes from the executed
 * response unchanged. No gradient is computed, rounded into existence or
 * inferred in the browser - `floatchat_core/gradients.py` is the only place
 * that calculates one.
 *
 * The report is looked up **by profile id** from the executed result, so a
 * report can never be rendered under a different profile: there is no separate
 * request that could arrive late and land on the wrong selection.
 */

import type {
  ExecutionResults,
  GradientBreak,
  GradientInterval,
  GradientReport,
  ThermoclineEstimate,
  VariableGradients,
  Variable,
} from './planContract.ts';

export const GRADIENT_SYMBOL: Record<Variable, string> = {
  temp: '°C/m',
  psal: '/m',
};

const VARIABLE_WORD: Record<Variable, string> = {
  temp: 'temperature',
  psal: 'salinity',
};

/**
 * The gradient report for one profile of this result, or null.
 *
 * Returning null covers every honest "nothing to show" case: the analysis was
 * not requested, the result predates it, or this profile has no report.
 */
export function gradientsForProfile(
  results: ExecutionResults | null,
  profileId: string | null,
): GradientReport | null {
  if (!results || !profileId || !results.gradients) return null;
  return results.gradients.find((report) => report.profile_id === profileId) ?? null;
}

/** The thermocline estimate for one profile, or null. Selected by profile id
 * so an estimate can never appear under a different profile. */
export function thermoclineForProfile(
  results: ExecutionResults | null,
  profileId: string | null,
): ThermoclineEstimate | null {
  if (!results || !profileId || !results.thermoclines) return null;
  return results.thermoclines.find((row) => row.profile_id === profileId) ?? null;
}

export function variableGradients(
  report: GradientReport | null,
  variable: Variable,
): VariableGradients | null {
  return report?.variables?.[variable] ?? null;
}

/** "10.0–20.0 m", the two depths the interval actually spans. */
export function intervalDepths(interval: GradientInterval): string {
  return `${interval.upper.depth_m.toFixed(1)}–${interval.lower.depth_m.toFixed(1)} m`;
}

/**
 * A signed gradient with its unit, e.g. "-0.045 °C/m". The sign is kept: it
 * carries the direction of change with depth and must not be dropped.
 */
export function formatGradient(interval: GradientInterval, digits = 4): string {
  const value = interval.gradient;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)} ${GRADIENT_SYMBOL[interval.variable]}`;
}

/** Plain-language direction of change over one interval. */
export function describeChange(interval: GradientInterval): string {
  const word = VARIABLE_WORD[interval.variable];
  const magnitude = Math.abs(interval.delta_value);
  const unit = interval.variable === 'temp' ? ' °C' : '';
  if (interval.delta_value === 0) {
    return `${word} is unchanged between ${intervalDepths(interval)}`;
  }
  const direction = interval.delta_value < 0 ? 'falls' : 'rises';
  return `${word} ${direction} ${magnitude.toFixed(2)}${unit} between ${intervalDepths(interval)}`;
}

/** Why nothing can be shown, in the viewer's words, or null when it can. */
export function unavailableReason(series: VariableGradients | null): string | null {
  if (!series) return 'This result does not include a change-with-depth analysis.';
  if (series.status === 'insufficient_samples') {
    return series.accepted_sample_count === 0
      ? 'No accepted levels for this variable in this profile.'
      : 'Only one accepted level for this variable, and a change needs two.';
  }
  if (series.status === 'no_eligible_intervals') {
    // Distance is only one cause: a rejected level between two good ones, or
    // conflicting duplicates, produce this too. The breaks carry the actual
    // reason, so this must not guess one.
    return 'No pair of adjacent accepted levels could be compared. The skipped intervals below say why.';
  }
  return null;
}

const BREAK_WORD: Record<GradientBreak['reason'], string> = {
  missing_value: 'no accepted value',
  gap_exceeds_policy: 'levels too far apart',
  conflicting_duplicate_depth: 'conflicting values at one depth',
  unusable_depth: 'unusable depth',
};

/** "12 skipped: 10 no accepted value, 2 levels too far apart" — or null. */
export function describeBreaks(series: VariableGradients | null): string | null {
  if (!series || series.breaks.length === 0) return null;
  const counts = new Map<GradientBreak['reason'], number>();
  for (const entry of series.breaks) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([reason, n]) => `${n} ${BREAK_WORD[reason]}`);
  return `${series.breaks.length} interval${series.breaks.length === 1 ? '' : 's'} skipped: ${parts.join(', ')}`;
}

/**
 * The steepest intervals first. A copy: the response order is never mutated.
 * Sorted by magnitude so the largest changes are the ones worth reading.
 */
export function steepestFirst(series: VariableGradients | null, limit = 5): GradientInterval[] {
  if (!series) return [];
  return [...series.intervals]
    .sort((a, b) => Math.abs(b.gradient) - Math.abs(a.gradient))
    .slice(0, limit);
}
