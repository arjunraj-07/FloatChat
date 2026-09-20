'use client';

/**
 * Compare: two profiles from the latest executed result, one variable, on
 * common axes with depth downward.
 *
 * The time view set in Map Explorer applies here too. It is stated, and View
 * all returned times moves the display to the latest timestamp without
 * changing or rerunning the query. A remembered choice outside the time view
 * is reported as temporarily unavailable - never replaced by another profile
 * - and comes back once it is inside the view again.
 */

import type { ExecutedProfile, PlanExecutionResponse, Variable } from '@/lib/planContract.ts';
import {
  type CompareSelection,
  type HiddenComparison,
  type ViewMode,
  groupByFloat,
  profileIdentity,
  profileLabel,
  profileSeries,
  unavailableReason,
  variableAvailability,
} from '@/lib/explorerModel.ts';
import CompareChart, { COMPARE_STYLE } from './CompareChart';
import WorkspaceHeader from './WorkspaceHeader';
import { useElementHeight } from './useElementHeight';

const VARIABLE_LABEL: Record<Variable, string> = { temp: 'Temperature', psal: 'Salinity' };

interface Props {
  response: PlanExecutionResponse | null;
  mode: ViewMode;
  visibleProfiles: ExecutedProfile[];
  compare: CompareSelection;
  compareHidden: HiddenComparison[];
  onCompareChange: (selection: CompareSelection) => void;
  compareVariable: Variable;
  onCompareVariableChange: (variable: Variable) => void;
  /** The time navigator is not at its latest step. */
  timeRestricted: boolean;
  throughLabel: string | null;
  totalCount: number;
  onViewAllTimes: () => void;
  onOpenMap: () => void;
}

export default function CompareWorkspace({
  response,
  mode,
  visibleProfiles,
  compare,
  compareHidden,
  onCompareChange,
  compareVariable,
  onCompareVariableChange,
  timeRestricted,
  throughLabel,
  totalCount,
  onViewAllTimes,
  onOpenMap,
}: Props) {
  const [chartBox, chartHeight] = useElementHeight(420);
  const results = response?.executed ? response.results : null;

  if (!results || results.profiles.length === 0) {
    return (
      <div data-testid="ws-compare" className="fc-shell mx-auto w-full max-w-[1100px] px-5 py-8 lg:px-8">
        <WorkspaceHeader
          eyebrow="Compare"
          title="Compare two profiles"
          description="Two profiles from one result, on common axes with depth downward."
          headingId="heading-compare"
        />
        <div data-testid="compare-empty" className="fc-panel space-y-4 p-6 mt-6">
          <p className="text-sm text-[var(--fc-muted)]">
            Compare needs results first. Show results in Map Explorer, then choose two of the returned profiles here.
          </p>
          <button type="button" data-testid="compare-open-map" onClick={onOpenMap} className="fc-btn fc-btn-primary">
            Open Map Explorer
          </button>
        </div>
      </div>
    );
  }

  const requested = (response?.plan?.variables ?? results.variables) as Variable[];
  const ordered = groupByFloat(visibleProfiles).flatMap((group) => group.profiles);
  const variable = requested.includes(compareVariable) ? compareVariable : requested[0];
  const profileById = (id: string) => results.profiles.find((p) => p.profile_id === id) ?? null;
  const labelFor = (id: string) => {
    const profile = profileById(id);
    return profile ? profileLabel(profile) : id;
  };
  const side = (id: string | null) => {
    const profile = id ? profileById(id) : null;
    return id
      ? {
          series: profileSeries(results.observations, id, variable),
          label: labelFor(id),
          derived: results.derived.filter((d) => d.profile_id === id),
          reason: profile ? unavailableReason(variableAvailability(profile, variable, requested)) : '',
        }
      : null;
  };
  const a = side(compare.a);
  const b = side(compare.b);
  // Axes with no curve on them read as data; say why there is nothing instead.
  const nothingToDraw = ![a, b].some((s) => s && s.series.validCount > 0);

  // Flows with the page rather than owning its own height, so Compare has one
  // scrollbar instead of an inner pane fighting the page.
  return (
    <div data-testid="ws-compare" className="fc-shell mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-5 py-6 lg:px-8">
      <WorkspaceHeader
        eyebrow="03 / Compare"
        title="Compare two profiles"
        description="From the latest result. Same axes; lines join measured levels only, nothing is smoothed, and no profile is labelled unusual."
        headingId="heading-compare"
      />

      {timeRestricted && (
        <div
          data-testid="compare-time-scope"
          className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--fc-line-2)] bg-[rgba(139,203,196,0.1)] px-4 py-2.5 text-sm text-[var(--fc-teal-bright)]"
        >
          <span>
            Time view: {visibleProfiles.length} of {totalCount} returned profiles, observed through {throughLabel}.
          </span>
          <button
            type="button"
            data-testid="view-all-times"
            onClick={onViewAllTimes}
            className="fc-btn fc-btn-ghost fc-btn-sm ml-auto bg-[var(--fc-panel)]"
          >
            View all returned times
          </button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {(['a', 'b'] as const).map((key) => {
          const selected = compare[key] ? profileById(compare[key]) : null;
          const hidden = compareHidden.some((h) => h.side === key);
          const identity = selected
            ? profileIdentity(selected)
            : hidden
              ? 'temporarily unavailable, observed after the selected time'
              : 'none selected';
          return (
            <div key={key} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block h-0.5 w-6 shrink-0"
                style={{
                  background: COMPARE_STYLE[key].color,
                  borderTop: key === 'b' ? `2px dashed ${COMPARE_STYLE.b.color}` : undefined,
                  height: key === 'b' ? 0 : 2,
                }}
              />
              <span aria-hidden className="w-3 font-semibold">{key.toUpperCase()}</span>
              <select
                data-testid={`compare-${key}`}
                aria-label={`Profile ${key.toUpperCase()}: ${identity}`}
                title={identity}
                className="fc-input min-h-[38px] min-w-0 flex-1 py-1.5 text-sm"
                value={compare[key] ?? ''}
                onChange={(e) => onCompareChange({ ...compare, [key]: e.target.value })}
              >
                {/* An empty side must not display the first option as if chosen. */}
                {!compare[key] && (
                  <option value="" disabled>
                    {hidden ? 'Temporarily unavailable at this time' : 'Choose a profile'}
                  </option>
                )}
                {ordered.map((profile) => (
                  <option
                    key={profile.profile_id}
                    value={profile.profile_id}
                    title={profileIdentity(profile)}
                    disabled={profile.profile_id === compare[key === 'a' ? 'b' : 'a']}
                  >
                    {profileLabel(profile)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Variable to compare" className="fc-segmented">
          {requested.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={variable === name}
              data-testid={`compare-var-${name}`}
              onClick={() => onCompareVariableChange(name)}
              className={variable === name ? 'is-on' : ''}
            >
              {VARIABLE_LABEL[name]}
            </button>
          ))}
        </div>
        {ordered.length < 2 && (
          <p className="text-sm text-[var(--fc-coral)]">
            {results.profiles.length < 2
              ? 'This result has only one profile, so there is nothing to compare.'
              : 'Only one profile is observed up to the selected time. View all returned times to compare.'}
          </p>
        )}
      </div>

      {/* Tall enough that the two curves stay readable once the workspace
          header and selectors have taken their space. */}
      <div ref={chartBox} className="fc-panel min-h-[420px] flex-1 overflow-hidden p-4">
        {nothingToDraw ? (
          <div
            data-testid="compare-chart-empty"
            className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--fc-muted)]"
          >
            <p>
              No curve to draw: neither selection has valid {VARIABLE_LABEL[variable].toLowerCase()} values
              {compareHidden.length > 0 ? ' at the selected time' : ''}. The notes below say why.
            </p>
          </div>
        ) : (
          <CompareChart a={a} b={b} variable={variable} mode={mode} height={Math.max(320, chartHeight - 4)} />
        )}
      </div>

      <div data-testid="compare-notes" className="space-y-1 pb-2 text-sm text-[var(--fc-coral)]">
        {compareHidden.map((hidden) => (
          <p key={`hidden-${hidden.side}`} data-testid={`compare-cleared-${hidden.side}`}>
            {hidden.side.toUpperCase()} is temporarily unavailable: {labelFor(hidden.profileId)} was observed after{' '}
            {throughLabel ?? 'the selected time'}. No other profile was substituted; View all returned times restores
            it.
          </p>
        ))}
        {[a, b].map((s, index) =>
          s && s.series.validCount === 0 ? (
            <p key={index}>
              {index === 0 ? 'A' : 'B'} ({s.label}) has no valid {VARIABLE_LABEL[variable].toLowerCase()} in this
              result{s.reason ? `: ${s.reason}` : ''}. No curve is drawn for it.
            </p>
          ) : null,
        )}
      </div>
    </div>
  );
}
