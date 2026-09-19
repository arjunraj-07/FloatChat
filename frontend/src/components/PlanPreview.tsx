'use client';

/**
 * The understanding preview: what the backend made of the current draft.
 *
 * A plain-language summary first, then counts, then problems and coverage
 * notes with short headings. The effective policy, normalized constraints
 * and the raw validator response sit behind expansion controls.
 */

import {
  type Issue,
  type PlanValidationResponse,
  type QueryPlanRequest,
} from '@/lib/planContract.ts';
import { describePlan } from '@/lib/draftPlan.ts';
import { WARNING_TITLES, type ViewMode } from '@/lib/explorerModel.ts';

interface Props {
  plan: QueryPlanRequest | null;
  validation: PlanValidationResponse | null;
  validating: boolean;
  stale: boolean;
  transportError: string | null;
  mode: ViewMode;
}

const OUTCOME_STYLE: Record<string, { label: string; className: string }> = {
  valid: { label: 'Ready to run', className: 'chip-teal' },
  valid_partial_coverage: { label: 'Ready · partial coverage', className: 'chip-ochre' },
  valid_no_data: { label: 'No matching data', className: 'chip-default' },
  unsupported: { label: 'Not available', className: 'bg-[#e7e3f0] text-[#3d3357]' },
  invalid: { label: 'Cannot run', className: 'bg-[#f6e6e0] text-[#7d3418]' },
};

export function OutcomeBadge({
  validation,
  checking,
}: {
  validation: PlanValidationResponse | null;
  checking: boolean;
}) {
  if (checking || !validation) {
    return <span className="chip chip-default">Checking…</span>;
  }
  const style = OUTCOME_STYLE[validation.outcome] ?? OUTCOME_STYLE.invalid;
  return (
    <span data-testid="outcome-badge" className={`chip whitespace-nowrap ${style.className}`}>
      {style.label}
    </span>
  );
}

function NoteList({ issues, tone, mode }: { issues: Issue[]; tone: 'error' | 'note'; mode: ViewMode }) {
  return (
    <ul className="space-y-1">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>
          <details className="group">
            <summary
              className={`cursor-pointer text-sm ${tone === 'error' ? 'text-[var(--coral)]' : 'text-[var(--ink)]'}`}
            >
              {WARNING_TITLES[issue.code] ?? issue.message.split('. ')[0]}
            </summary>
            <p className={`mt-1 pl-4 text-xs ${tone === 'error' ? 'text-[var(--coral)]' : 'text-[var(--muted)]'}`}>
              {issue.message}
              {mode === 'scientific' && (
                <span className="mono block text-[11px] text-[var(--muted)]">
                  {issue.code}
                  {issue.field ? ` · ${issue.field}` : ''}
                </span>
              )}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}

export default function PlanPreview({ plan, validation, validating, stale, transportError, mode }: Props) {
  if (transportError) {
    return (
      <div className="rounded-md border border-[#e0bcab] bg-[#f6e6e0] p-3 text-sm text-[#7d3418]">
        Could not reach the validator: {transportError}
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="card p-3 text-sm text-[var(--muted)]">
        Complete the highlighted filters to see how they will be understood.
      </div>
    );
  }

  const checking = validating || stale;
  const policy = validation?.effective_policy ?? null;
  const normalized = validation?.normalized_plan ?? null;
  const errors = validation?.errors ?? [];
  const notes = validation?.warnings ?? [];

  return (
    <div data-testid="plan-preview" className="card">
      <div className="card-head py-2.5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Understanding</h2>
        <OutcomeBadge validation={validation} checking={checking} />
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm leading-relaxed text-[var(--ink)]">{describePlan(plan)}</p>

        {checking && <p className="tiny italic">The filters changed; checking again.</p>}

        {validation && !checking && (
          <>
            {validation.matching && (
              <dl className="grid grid-cols-3 gap-2 rounded-md bg-[var(--surface-quiet)] p-3 text-center">
                {([
                  ['floats', validation.matching.floats],
                  ['profiles', validation.matching.profiles],
                  ['measurements', validation.matching.observations],
                ] as const).map(([label, value]) => (
                  <div key={label}>
                    <dt className="card-kicker mb-0">{label}</dt>
                    <dd className="mono text-base font-semibold text-[var(--ink)]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {errors.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-semibold text-[var(--coral)]">Problems to fix before running</p>
                <NoteList issues={errors} tone="error" mode={mode} />
              </div>
            )}

            {notes.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-semibold text-[var(--ink)]">Coverage notes ({notes.length})</p>
                <NoteList issues={notes} tone="note" mode={mode} />
              </div>
            )}

            <details className="rounded-md border border-[var(--divider)] p-2.5">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Validation details</summary>
              <div className="mt-2 space-y-2 text-xs text-[var(--muted)]">
                {policy && (
                  <p>
                    <span className="font-semibold text-[var(--ink)]">Quality policy</span>{' '}
                    ({policy.source === 'default' ? 'server default' : 'as requested'}): QC flags{' '}
                    {policy.accepted_qc_flags.value.join(', ')}; data modes{' '}
                    {policy.data_modes.value.join(', ')}
                    {mode === 'scientific' &&
                      `; present in the data: ${policy.data_modes.present_in_dataset.join(', ')}`}
                    .
                  </p>
                )}
                {normalized && (
                  <p>
                    <span className="font-semibold text-[var(--ink)]">Normalized</span>: {normalized.time.start} →{' '}
                    {normalized.time.end}; {normalized.region.south}–{normalized.region.north}° N,{' '}
                    {normalized.region.west}–{normalized.region.east}° E;{' '}
                    {normalized.depth.mode === 'range'
                      ? `${normalized.depth.min_m}–${normalized.depth.max_m} m`
                      : `exactly ${normalized.depth.target_m} m (interpolation required)`}
                    .
                  </p>
                )}
                {mode === 'scientific' && (
                  <details>
                    <summary className="cursor-pointer text-[var(--teal)]">Raw validator response</summary>
                    <pre className="mono mt-1 max-h-64 overflow-auto rounded bg-[var(--surface-quiet)] p-2 text-[11px]">
                      {JSON.stringify(validation, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
