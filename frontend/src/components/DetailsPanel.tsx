'use client';

/**
 * Expandable scientific details below the main view: the run, coverage
 * notes, the selected profile's evidence and provenance, derived values and
 * the climatology difference. Material limitations are visible in both views;
 * scientific view adds fields, codes and provenance.
 */

import type { PlanExecutionResponse } from '@/lib/planContract.ts';
import {
  WARNING_TITLES,
  describeExclusions,
  formatUtc,
  type CoverageInfo,
  type ViewMode,
  type WoaMatchResponse,
} from '@/lib/explorerModel.ts';
import Term from './Term';

interface Props {
  response: PlanExecutionResponse;
  activeProfileId: string | null;
  woa: WoaMatchResponse | null;
  coverage: CoverageInfo | null;
  mode: ViewMode;
}

const CARD = 'card overflow-hidden';
const SUMMARY = 'cursor-pointer select-none px-4 py-3 text-sm font-semibold text-[var(--ink)]';

export default function DetailsPanel({ response, activeProfileId, woa, coverage, mode }: Props) {
  const results = response.results;
  const plan = response.plan;
  const profile = results?.profiles.find((p) => p.profile_id === activeProfileId) ?? null;
  const derived = results?.derived.filter((d) => d.profile_id === activeProfileId) ?? [];
  const notes = response.validation.warnings;

  return (
    <section data-testid="details" aria-label="Scientific details" className="space-y-2 pb-2">
      <h2 className="section-label px-1">Scientific details</h2>

      <details className={CARD} open>
        <summary className={SUMMARY}>About this run</summary>
        <div className="space-y-2 px-4 pb-4 text-sm text-[var(--ink)]">
          <p>
            {response.executed_at && <>Run at {formatUtc(response.executed_at)}. </>}
            {results?.profiles.length ?? 0} profiles and {results?.observation_count ?? 0} measurements matched
            {results && results.returned_observation_count !== results.observation_count
              ? ` (${results.returned_observation_count} returned)`
              : ''}
            .
          </p>
          {plan && (
            <p className="text-[var(--muted)]">
              {plan.time.start.slice(0, 10)} → {plan.time.end.slice(0, 10)} · {plan.region.south}–
              {plan.region.north}° N, {plan.region.west}–{plan.region.east}° E ·{' '}
              {plan.depth.mode === 'range'
                ? `${plan.depth.min_m}–${plan.depth.max_m} m`
                : `exactly ${plan.depth.target_m} m (derived)`}{' '}
              · {plan.variables.map((v) => (v === 'temp' ? 'temperature' : 'salinity')).join(', ')}
            </p>
          )}
          {results && results.limitations.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-[var(--ochre)]">
              {results.limitations.map((limitation) => (
                <li key={limitation.code}>{limitation.message}</li>
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <div>
              <p className="font-semibold">Coverage notes</p>
              <ul className="mt-1 space-y-1">
                {notes.map((note, index) => (
                  <li key={`${note.code}-${index}`}>
                    <details>
                      <summary className="cursor-pointer">{WARNING_TITLES[note.code] ?? note.code}</summary>
                      <p className="pl-4 text-xs text-[var(--muted)]">{note.message}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="tiny">
            Marine-heatwave detection, significance testing and forecasting are not available in this
            version. Differences from climatology are not anomaly or heatwave claims.
          </p>
        </div>
      </details>

      {profile && (
        <details className={CARD} open={mode === 'scientific'}>
          <summary className={SUMMARY}>Selected profile: evidence and provenance</summary>
          <dl className="grid gap-x-6 gap-y-1.5 px-4 pb-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="card-kicker mb-0">Profile</dt>
              <dd>
                {profile.profile_id} (float {profile.platform}, cycle {profile.cycle})
              </dd>
            </div>
            <div>
              <dt className="card-kicker mb-0">Observed</dt>
              <dd>{formatUtc(profile.time)}</dd>
            </div>
            <div>
              <dt className="card-kicker mb-0">
                <Term term="dataMode" mode={mode}>Data mode</Term>
              </dt>
              <dd>
                {profile.data_mode} · {profile.source_field} values with {profile.source_field}{' '}
                <Term term="qc" mode={mode}>QC</Term>
              </dd>
            </div>
            <div>
              <dt className="card-kicker mb-0">Levels in this query</dt>
              <dd>
                {profile.levels_in_plan} of {profile.profile_levels_total} in the profile
              </dd>
            </div>
            {Object.entries(profile.variables).map(([name, summary]) => (
              <div key={name}>
                <dt className="card-kicker mb-0">{name === 'temp' ? 'Temperature' : 'Salinity'}</dt>
                <dd>
                  {summary.valid_levels} valid
                  {summary.excluded_levels > 0 &&
                    ` · ${summary.excluded_levels} excluded (${describeExclusions(
                      summary.exclusions ?? {},
                      summary.excluded_levels,
                    )})`}
                </dd>
              </div>
            ))}
            {mode === 'scientific' && coverage?.variable_definitions && (
              <div className="sm:col-span-2">
                <dt className="card-kicker mb-0">Variable definitions</dt>
                <dd>
                  {Object.values(coverage.variable_definitions)
                    .map((d) => `${d.argo_name}: ${d.long_name}`)
                    .join(' · ')}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="card-kicker mb-0">Source</dt>
              <dd className="break-words">
                {profile.dataset_id ?? 'cached dataset'}
                {profile.retrieved_at && ` · retrieved ${formatUtc(profile.retrieved_at)}`}
                {' · '}cached historical observations
                {mode === 'scientific' && response.dataset?.raw_file_checksum && (
                  <span className="mono block text-xs text-[var(--muted)]">
                    {response.dataset.raw_file_checksum}
                  </span>
                )}
                {mode === 'scientific' && profile.source_url && (
                  <span className="block break-all text-xs text-[var(--muted)]">{profile.source_url}</span>
                )}
              </dd>
            </div>
          </dl>
        </details>
      )}

      {derived.length > 0 && (
        <details className={CARD} open>
          <summary className={SUMMARY}>Derived values at an exact depth</summary>
          <div className="px-4 pb-4 text-sm">
            <p className="mb-2 text-[var(--ochre)]">Computed from surrounding measured levels. These are not measurements.</p>
            <ul className="space-y-1">
              {derived.map((d) => (
                <li key={`${d.profile_id}-${d.variable}`}>
                  <strong>{d.variable === 'temp' ? 'Temperature' : 'Salinity'}</strong> at {d.target_depth_m} m:{' '}
                  {d.available ? (
                    <>
                      {d.value?.toFixed(3)}
                      {d.variable === 'temp' ? ' °C' : ''} ·{' '}
                      {d.method === 'exact'
                        ? 'an observed level sits on this depth'
                        : mode === 'scientific'
                          ? `linear interpolation between ${d.bracketing_depths?.[0].toFixed(2)} m and ${d.bracketing_depths?.[1].toFixed(2)} m (gap ${d.gap_m?.toFixed(2)} m)`
                          : 'estimated between the two nearest measurements'}
                    </>
                  ) : (
                    <span className="text-[var(--ochre)]">unavailable: {d.reason}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {profile && (
        <details className={CARD} open={Boolean(woa && woa.status === 'Success')}>
          <summary className={SUMMARY}>
            Difference from <Term term="climatology" mode={mode}>climatology</Term> (WOA23)
          </summary>
          <div className="space-y-1.5 px-4 pb-4 text-sm">
            {!woa && <p className="text-[var(--muted)]">Checking whether a reference is available…</p>}
            {woa && woa.status === 'Success' && (
              <>
                <p>
                  Temperature at {woa.comparison_depth} m ({woa.match_method === 'exact' ? 'measured level' : 'derived'}):{' '}
                  <strong>{woa.argo_interpolated_value?.toFixed(3)} °C</strong>. Monthly mean for{' '}
                  {woa.baseline_period ?? '1991–2020'}: <strong>{woa.woa_reference_value?.toFixed(3)} °C</strong>.
                  Difference: <strong>{(woa.difference ?? 0) > 0 ? '+' : ''}{woa.difference?.toFixed(3)} °C</strong>.
                </p>
                <p className="text-[var(--muted)]">
                  This is a difference from a long-term average. It is not a statistical anomaly test and not a
                  marine-heatwave detection.
                </p>
                {mode === 'scientific' && (
                  <p className="tiny">
                    {woa.method}
                    {woa.spatial_offset &&
                      ` · grid-cell offset ${woa.spatial_offset.lat.toFixed(2)}° lat, ${woa.spatial_offset.lon.toFixed(2)}° lon`}
                    {woa.reference?.origin && ` · reference ${woa.reference.origin}`}
                  </p>
                )}
                {woa.limitations && (
                  <ul className="list-disc pl-5 text-xs text-[var(--muted)]">
                    {woa.limitations.map((limitation, index) => (
                      <li key={index}>{limitation}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {woa && woa.status !== 'Success' && (
              <>
                <p className="text-[var(--ochre)]">Unavailable for this profile{mode === 'scientific' && woa.reason ? `: ${woa.reason}` : '.'}</p>
                <p className="text-[var(--muted)]">
                  No reference value is shown because none could be justified. This does not affect the profile
                  data and is not evidence of anything unusual.
                </p>
              </>
            )}
          </div>
        </details>
      )}

      {mode === 'scientific' && (
        <details className={CARD}>
          <summary className={SUMMARY}>Raw execution response</summary>
          <pre className="mono max-h-96 overflow-auto px-4 pb-4 text-[11px] text-[var(--muted)]">
            {JSON.stringify({ ...response, results: response.results ? { ...response.results, observations: `[${response.results.observations.length} records]` } : null }, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
