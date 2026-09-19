'use client';

/**
 * Measurements: one profile's values against depth.
 *
 * The controls that choose what you are looking at - which float, which
 * observation, and which variable - sit directly above the chart, in that
 * order. Processing metadata (identifiers, data mode, QC source) is not part
 * of reading a measurement, so it lives in Scientific details below.
 *
 * Limitations stay beside the result they affect: a variable with no accepted
 * values says so where you would look for it, and derived values are named on
 * the chart itself.
 *
 * "Changes with depth" reads the gradient report that travelled with this
 * executed result, selected by profile id, so a report can never appear under
 * a different profile. It starts collapsed.
 */

import { useState } from 'react';

import type { ExecutedProfile, PlanExecutionResponse, Variable } from '@/lib/planContract.ts';
import {
  type ViewMode,
  type WoaMatchResponse,
  floatPosition,
  formatPosition,
  formatUtc,
  groupByFloat,
  unavailableReason,
  variableAvailability,
} from '@/lib/explorerModel.ts';
import {
  describeBreaks,
  describeChange,
  formatGradient,
  gradientsForProfile,
  thermoclineForProfile,
  intervalDepths,
  steepestFirst,
  unavailableReason as gradientUnavailableReason,
  variableGradients,
} from '@/lib/gradientView.ts';
import ProfileChart from './ProfileChart';
import Term from './Term';
import { useElementHeight } from './useElementHeight';

interface Props {
  response: PlanExecutionResponse;
  activeProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
  mode: ViewMode;
  woa: WoaMatchResponse | null;
  /** Returned profiles observed up to the navigator's time. */
  visibleProfiles: ExecutedProfile[];
}

const VARIABLE_LABEL: Record<Variable, string> = { temp: 'Temperature', psal: 'Salinity' };

export default function ProfilePanel({
  response,
  activeProfileId,
  onSelectProfile,
  mode,
  woa,
  visibleProfiles,
}: Props) {
  const [chartBox, chartHeight] = useElementHeight(360);
  const [chosenVariable, setChosenVariable] = useState<Variable>('temp');

  const results = response.results!;
  const requested = (response.plan?.variables ?? results.variables) as Variable[];
  const floats = groupByFloat(visibleProfiles);
  const position = floatPosition(visibleProfiles, activeProfileId);
  const active = visibleProfiles.find((p) => p.profile_id === activeProfileId) ?? null;
  const floatTotal = active ? results.profiles.filter((p) => p.platform === active.platform).length : 0;

  // The chosen tab, falling back when this result does not carry it.
  const variable: Variable = requested.includes(chosenVariable) ? chosenVariable : requested[0] ?? 'temp';

  const availability = active
    ? requested.map((name) => ({ variable: name, info: variableAvailability(active, name, requested) }))
    : [];
  const shownAvailability = availability.find((entry) => entry.variable === variable) ?? null;
  const emptyMessages: Partial<Record<Variable, string>> = {};
  for (const { variable: name, info } of availability) {
    if (info.state === 'none') {
      emptyMessages[name] =
        `No valid ${VARIABLE_LABEL[name].toLowerCase()} in this profile: ${unavailableReason(info)}`;
    }
  }

  const gradients = gradientsForProfile(results, active?.profile_id ?? null);
  // Selected by profile id, so switching profiles can never leave a stale
  // estimate under a different one.
  const thermocline = thermoclineForProfile(results, active?.profile_id ?? null);
  const cooling = gradients?.strongest_cooling ?? null;
  const chartHeightPx = Math.max(240, chartHeight);

  return (
    <section
      data-testid="profile-panel"
      aria-labelledby="profile-heading"
      className="inspector flex h-full min-h-0 flex-col"
    >
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="profile-heading" className="text-sm font-semibold text-[var(--ink)]">
            Measurements
          </h2>
          {position && active && (
            <p data-testid="profile-position" className="tiny">
              {position.index + 1} of {position.count}
              {position.count < floatTotal ? ` shown (${floatTotal} in this result)` : ''}
            </p>
          )}
        </div>

        {/* What you are looking at: float, observation, variable. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="float-select">Float</label>
          <select
            id="float-select"
            data-testid="float-select"
            className="field-input min-h-[34px] w-auto flex-1 py-1 text-sm"
            value={active?.platform ?? ''}
            onChange={(e) => {
              const group = floats.find((g) => g.platform === e.target.value);
              if (group) onSelectProfile(group.profiles[0].profile_id);
            }}
          >
            {floats.map((group) => (
              <option key={group.platform} value={group.platform}>
                Float {group.platform} · {group.profiles.length} profile
                {group.profiles.length === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </div>

        {position && active && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="prev-profile"
                disabled={!position.previousId}
                onClick={() => position.previousId && onSelectProfile(position.previousId)}
                className="button button-outline button-small"
                aria-label="Earlier observation"
              >
                ‹
              </button>
              <label className="sr-only" htmlFor="profile-select">Observation</label>
              <select
                id="profile-select"
                data-testid="profile-select"
                className="field-input min-h-[34px] min-w-0 flex-1 py-1 text-sm"
                value={active.profile_id}
                onChange={(e) => onSelectProfile(e.target.value)}
              >
                {position.group.profiles.map((profile) => (
                  <option key={profile.profile_id} value={profile.profile_id}>
                    {formatUtc(profile.time)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="next-profile"
                disabled={!position.nextId}
                onClick={() => position.nextId && onSelectProfile(position.nextId)}
                className="button button-outline button-small"
                aria-label="Later observation"
              >
                ›
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="tablist" aria-label="Variable" className="segmented">
                {requested.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    data-testid={`variable-tab-${name}`}
                    aria-selected={variable === name}
                    onClick={() => setChosenVariable(name)}
                    className={variable === name ? 'is-selected' : ''}
                  >
                    {VARIABLE_LABEL[name]}
                  </button>
                ))}
              </div>
              <p className="tiny mono">
                {formatPosition(active.latitude, active.longitude)} ·{' '}
                <Term term="depth" mode={mode}>depths</Term> {active.depth_min_m.toFixed(0)}–
                {active.depth_max_m.toFixed(0)} m
              </p>
            </div>

            {/* The limitation that matters for what is on the chart. */}
            {shownAvailability && shownAvailability.info.state !== 'available' && (
              <p
                data-testid={`availability-${variable}`}
                className="rounded-md bg-[#f0e3d9] px-2.5 py-1.5 text-xs text-[var(--ochre)]"
              >
                {shownAvailability.info.state === 'none'
                  ? `No ${VARIABLE_LABEL[variable].toLowerCase()} here: ${unavailableReason(shownAvailability.info)}.`
                  : `${VARIABLE_LABEL[variable]} was not requested in this query.`}
              </p>
            )}
            {shownAvailability && shownAvailability.info.state === 'available' && (
              <p data-testid={`availability-${variable}`} className="tiny">
                {VARIABLE_LABEL[variable]} measured at {shownAvailability.info.valid} depths
                {shownAvailability.info.excluded
                  ? `, ${shownAvailability.info.excluded} without a usable value`
                  : ''}
              </p>
            )}
          </>
        )}
      </div>

      {/* The measurements sit below the map now, in ordinary page flow, so the
          chart has no parent height to fill: it needs its own. Kept as a
          minimum rather than a fixed height, so "Changes with depth" can still
          expand the card instead of being clipped inside it. */}
      <div ref={chartBox} className="min-h-[420px] flex-1 px-1">
        {active && (
          <ProfileChart
            observations={results.observations.filter((o) => o.profile_id === active.profile_id)}
            variables={[variable]}
            derived={results.derived.filter((d) => d.profile_id === active.profile_id)}
            mode={mode}
            height={chartHeightPx}
            emptyMessages={emptyMessages}
            thermocline={variable === 'temp' && thermocline?.candidate ? {
              upperDepth: thermocline.candidate.supporting_interval.upper.depth_m,
              lowerDepth: thermocline.candidate.supporting_interval.lower.depth_m,
              estimatedDepth: thermocline.candidate.estimated_depth_m,
            } : null}
          />
        )}
      </div>

      <div className="space-y-1 border-t border-[var(--divider)] px-4 py-2.5 text-xs text-[var(--muted)]">
        {/* data-profile names the profile this report belongs to, so a check
            can prove it never renders under another. */}
        {active && (
          <details data-testid="depth-change" data-profile={active.profile_id}>
            <summary className="cursor-pointer select-none font-semibold text-[var(--ink)]">
              Changes with depth
            </summary>
            <div className="mt-1.5 space-y-2.5 rounded-md bg-[var(--surface-quiet)] p-2.5">
              {!gradients ? (
                <p data-testid="depth-change-unavailable">
                  This result has no change-with-depth analysis. Add it in Filters and show results again.
                </p>
              ) : (
                <>
                  {requested.map((name) => {
                    const series = variableGradients(gradients, name);
                    const blocked = gradientUnavailableReason(series);
                    return (
                      <div key={name} data-testid={`depth-change-${name}`}>
                        <p className="font-semibold text-[var(--ink)]">{VARIABLE_LABEL[name]}</p>
                        {blocked || !series ? (
                          <p className="mt-0.5">{blocked}</p>
                        ) : (
                          <>
                            {mode === 'student' ? (
                              <ul className="mt-0.5 space-y-0.5">
                                {steepestFirst(series, 3).map((entry, index) => (
                                  <li key={index} className="first-letter:uppercase">
                                    {describeChange(entry)}.
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <ul className="mt-0.5 space-y-1">
                                {steepestFirst(series, 3).map((entry, index) => (
                                  <li key={index}>
                                    <span className="mono text-[var(--ink)]">{formatGradient(entry)}</span>{' '}
                                    over <span className="mono">{intervalDepths(entry)}</span>
                                    <span className="block">
                                      from{' '}
                                      <span className="mono">
                                        {entry.upper.value} at {entry.upper.depth_m.toFixed(2)} m
                                      </span>{' '}
                                      to{' '}
                                      <span className="mono">
                                        {entry.lower.value} at {entry.lower.depth_m.toFixed(2)} m
                                      </span>
                                      ; midpoint{' '}
                                      <span className="mono">{entry.midpoint_depth_m.toFixed(2)} m</span> (derived)
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p className="mt-0.5">
                              {series.interval_count} interval
                              {series.interval_count === 1 ? '' : 's'} from{' '}
                              {series.accepted_sample_count} accepted levels
                              {mode === 'scientific' ? ` · ${series.units}` : ''}
                            </p>
                          </>
                        )}
                        {describeBreaks(series) && (
                          <p data-testid={`depth-change-breaks-${name}`} className="mt-0.5 text-[var(--ochre)]">
                            {describeBreaks(series)}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {cooling ? (
                    <div data-testid="strongest-cooling" className="border-t border-[var(--divider)] pt-2">
                      <p className="font-semibold text-[var(--ink)]">{cooling.label}</p>
                      <p className="mt-0.5">
                        <span className="mono">{intervalDepths(cooling.interval)}</span>
                        {mode === 'scientific' ? (
                          <>
                            {' · '}
                            <span className="mono text-[var(--ink)]">{formatGradient(cooling.interval)}</span>
                          </>
                        ) : (
                          <> — {describeChange(cooling.interval)}</>
                        )}
                      </p>
                      <p className="mt-1 text-[var(--ochre)]">{cooling.caveat}</p>
                    </div>
                  ) : (
                    <p data-testid="strongest-cooling-none" className="border-t border-[var(--divider)] pt-2">
                      {gradients.cooling_note ??
                        'No interval in this profile shows temperature falling with depth.'}
                    </p>
                  )}

                  {mode === 'scientific' && (
                    <p data-testid="depth-change-method" className="border-t border-[var(--divider)] pt-2">
                      {variableGradients(gradients, requested[0])?.method}{' '}
                      {variableGradients(gradients, requested[0])?.max_gap_policy}
                    </p>
                  )}
                </>
              )}
            </div>
          </details>
        )}

        {thermocline && (
          <details data-testid="thermocline" data-profile={active?.profile_id}>
            <summary className="cursor-pointer select-none font-semibold text-[var(--ink)]">
              Thermocline estimate
            </summary>
            <div className="mt-1.5 space-y-2 rounded-md bg-[var(--surface-quiet)] p-2.5">
              {thermocline.candidate ? (
                <>
                  <p data-testid="thermocline-depth">
                    <span className="font-semibold text-[var(--ink)]">
                      Estimated depth {thermocline.candidate.estimated_depth_m.toFixed(1)} m
                    </span>{' '}
                    <span className="text-[var(--ochre)]">(derived, not a measurement)</span>
                    {thermocline.status === 'ambiguous' && (
                      <span className="text-[var(--ochre)]"> · another interval is nearly as steep</span>
                    )}
                  </p>
                  <p data-testid="thermocline-interval">
                    Supported by measured levels{' '}
                    <span className="mono">
                      {thermocline.candidate.supporting_interval.upper.value.toFixed(2)} °C at{' '}
                      {thermocline.candidate.supporting_interval.upper.depth_m.toFixed(1)} m
                    </span>{' '}
                    to{' '}
                    <span className="mono">
                      {thermocline.candidate.supporting_interval.lower.value.toFixed(2)} °C at{' '}
                      {thermocline.candidate.supporting_interval.lower.depth_m.toFixed(1)} m
                    </span>{' '}
                    — a fall of {thermocline.candidate.temperature_drop_c.toFixed(2)} °C, or{' '}
                    <span className="mono">{thermocline.candidate.gradient_c_per_m.toFixed(3)}</span> °C/m.
                  </p>
                  {thermocline.candidate.at_analysed_boundary && (
                    <p className="text-[var(--ochre)]">{thermocline.candidate.at_analysed_boundary}</p>
                  )}
                </>
              ) : (
                <p data-testid="thermocline-unavailable">{thermocline.reason}</p>
              )}
              <details data-testid="thermocline-method">
                <summary className="cursor-pointer select-none">Method and limits</summary>
                <div className="mt-1 space-y-1">
                  <p>
                    The strongest eligible cooling interval between adjacent accepted levels, after
                    NOAA&apos;s description of the thermocline as the layer where temperature falls
                    rapidly with depth, and the definition of its depth as the depth of the maximum
                    vertical temperature gradient (Fiedler, 2010, as recorded by Romero et al., 2023,
                    Ocean Sci. 19, 887–901).
                  </p>
                  {thermocline.candidate && <p>{thermocline.candidate.midpoint_note}</p>}
                  <p>{thermocline.policy.note}</p>
                  <p data-testid="thermocline-unvalidated" className="text-[var(--ochre)]">
                    A gradient measured between two adjacent levels is a local interval gradient:
                    it is not a temperature difference, and not the average gradient across an
                    identified layer, which would need boundaries this method does not determine.
                    The 0.2 &deg;C/m minimum coincides with a published criterion, but applying it to
                    adjacent levels here is unvalidated.
                  </p>
                  <p>{thermocline.range_note}</p>
                  {thermocline.analysed_depth_range_m && (
                    <p className="mono">
                      analysed {thermocline.analysed_depth_range_m[0].toFixed(1)}–
                      {thermocline.analysed_depth_range_m[1].toFixed(1)} m ·{' '}
                      {thermocline.method} v{thermocline.method_version}
                    </p>
                  )}
                  <p>
                    Only cooling with depth is considered. A temperature inversion is real structure
                    this method does not describe.
                  </p>
                </div>
              </details>
            </div>
          </details>
        )}

        {results.derived.some((d) => d.available) && (
          <p className="text-[var(--ochre)]">
            ◇ Open diamonds are <Term term="derived" mode={mode}>derived</Term> values at{' '}
            {results.derived[0].target_depth_m} m, computed from measured levels. They are not measurements.
          </p>
        )}
        {results.truncated && (
          <p className="text-[var(--ochre)]">
            Truncated to {results.returned_observation_count} of {results.observation_count} measurements.
          </p>
        )}
        <p data-testid="woa-summary">
          <Term term="climatology" mode={mode}>Climatology</Term>:{' '}
          {!woa
            ? 'checking…'
            : woa.status === 'Success'
              ? `${(woa.difference ?? 0) > 0 ? '+' : ''}${woa.difference?.toFixed(2)} °C from the ${
                  woa.baseline_period ?? '1991–2020'
                } monthly mean at ${woa.comparison_depth} m. A difference, not an anomaly test.`
              : 'no comparison available for this profile (see Scientific details).'}
        </p>
      </div>
    </section>
  );
}
