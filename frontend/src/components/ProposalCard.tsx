'use client';

/**
 * A natural-language proposal, shown for review in the AI Assistant.
 *
 * The planner only proposes. Proposed changes are listed separately from the
 * settings it kept; clarification, provider errors, unsupported requests and
 * stale proposals each have their own state. There is one primary action:
 * "Use this draft" when there is a plan, otherwise "Edit the question".
 * Accepting fills the filters as an ordinary edit, and the results follow
 * from them: applying is the explicit step, not a second button.
 */

import type { FieldChange, PlanDraftResponse } from '@/lib/planContract.ts';
import type { ViewMode } from '@/lib/explorerModel.ts';
import type { ProposalStatus } from '@/lib/chat.ts';

interface Props {
  proposal: PlanDraftResponse | null;
  status: ProposalStatus;
  draftError: string | null;
  mode: ViewMode;
  onAccept: () => void;
  onDismiss: () => void;
}

const FIELD_NAMES: Record<string, string> = {
  time: 'Dates',
  region: 'Region',
  depth: 'Depth',
  variables: 'Variables',
  qc_policy: 'Quality policy',
  selection: 'Float selection',
  analyses: 'Analyses',
  outputs: 'Outputs',
};

const VARIABLE_NAMES: Record<string, string> = { temp: 'temperature', psal: 'salinity' };

function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  const record = typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (field === 'depth' && record) {
    return record.mode === 'at_depth'
      ? `exactly ${record.target_m} m`
      : `${record.min_m}–${record.max_m} m`;
  }
  if (field === 'time' && record) {
    return `${String(record.start).slice(0, 10)} → ${String(record.end).slice(0, 10)}`;
  }
  if (field === 'region' && record) {
    if (record.name) return String(record.name).replace(/_/g, ' ');
    return `${record.south}–${record.north}° N, ${record.west}–${record.east}° E`;
  }
  if (field === 'variables' && Array.isArray(value)) {
    return value.map((v) => VARIABLE_NAMES[v] ?? v).join(', ') || '(none)';
  }
  if (Array.isArray(value)) return value.length ? value.join(', ').replace(/_/g, ' ') : '(none)';
  if (record) {
    return Object.entries(record)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' · ');
  }
  return String(value);
}

function ChangeRow({ change, mode }: { change: FieldChange; mode: ViewMode }) {
  const name = mode === 'scientific' ? change.field : FIELD_NAMES[change.field] ?? change.field;
  return (
    <li>
      <span className="text-sm font-semibold text-[var(--ink)]">{name}</span>
      <div className="text-sm text-[var(--muted)]">
        <span className="line-through">{describeValue(change.field, change.previous)}</span>
        {' → '}
        <span className="font-semibold text-[var(--ink)]">{describeValue(change.field, change.proposed)}</span>
      </div>
      <span aria-hidden className="note-symbol justify-self-end">
        ✓
      </span>
    </li>
  );
}

export default function ProposalCard({ proposal, status, draftError, mode, onAccept, onDismiss }: Props) {
  const changed = (proposal?.changes ?? []).filter((c) => c.origin !== 'retained');
  const tone = proposal?.proposed_plan ? 'banner-teal' : 'banner-ochre';

  return (
    <section data-testid="proposal-card" aria-labelledby="proposal-heading" className="card workspace-enter overflow-hidden">
      <div className={`proposal-banner ${tone}`}>
        <span>For review</span>
        <strong id="proposal-heading">Proposed query</strong>
      </div>

      <div className="space-y-4 p-6">
        {draftError && !proposal && (
          <p className="text-sm text-[var(--coral)]">
            Could not reach the drafting service: {draftError}. The filters are unchanged.
          </p>
        )}

        {proposal && (
          <>
            {proposal.question && (
              <p className="text-sm text-[var(--muted)]">
                You asked: <span className="italic">“{proposal.question}”</span>
              </p>
            )}

            {status === 'stale_unapplied' && (
              <p className="rounded-md border border-[#e0c7ad] bg-[#f0e3d9] px-3 py-2 text-sm text-[var(--ochre)]">
                This proposal was made for an earlier version of the filters. You have edited them since; using it
                will replace those edits.
              </p>
            )}

            {proposal.outcome === 'clarification_needed' && (
              <div className="rounded-md bg-[var(--surface-quiet)] px-4 py-3 text-sm">
                <p className="font-semibold">A detail is missing</p>
                <p className="mt-1">{proposal.clarification_question}</p>
                <p className="mt-1 text-[var(--muted)]">Nothing was changed. Refine the question, or use the filters.</p>
              </div>
            )}

            {proposal.outcome === 'provider_unavailable' && (
              <div className="rounded-md bg-[#f6e6e0] px-4 py-3 text-sm text-[#7d3418]">
                <p className="font-semibold">Could not draft a query</p>
                <p className="mt-1">{proposal.provider_message}</p>
                <p className="mt-1">The filters are unchanged and still work.</p>
              </div>
            )}

            {proposal.unsupported.length > 0 && (
              <div className="rounded-md bg-[#e7e3f0] px-4 py-3 text-sm text-[#3d3357]">
                <p className="font-semibold">Not available in this version</p>
                <ul className="mt-1 list-disc pl-5">
                  {proposal.unsupported.map((item) => (
                    <li key={item.requested}>
                      <span className="font-semibold">{item.requested.replace(/_/g, ' ')}</span>
                      {item.reason && <span> — {item.reason}</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Nothing was substituted for it.</p>
              </div>
            )}

            {proposal.proposed_plan && (
              <>
                <div>
                  {/* A heading with a count, not an eyebrow: it stays sentence case. */}
                  <p className="mb-1.5 text-sm font-semibold text-[var(--ink)]">
                    Proposed changes ({changed.length})
                  </p>
                  {changed.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">No filter would change.</p>
                  ) : (
                    <ul className="proposal-rows border-t border-[var(--divider)]">
                      {changed.map((change) => (
                        <ChangeRow key={change.field} change={change} mode={mode} />
                      ))}
                    </ul>
                  )}
                </div>
                {proposal.retained_fields.length > 0 && (
                  <p className="text-sm text-[var(--muted)]">
                    <span className="font-semibold text-[var(--ink)]">Kept from your filters:</span>{' '}
                    {proposal.retained_fields
                      .map((f) => (mode === 'scientific' ? f : FIELD_NAMES[f] ?? f))
                      .join(', ')}
                  </p>
                )}
                {proposal.assumptions.length > 0 && (
                  <div className="text-sm text-[var(--muted)]">
                    <span className="font-semibold text-[var(--ink)]">Assumptions</span>
                    <ul className="list-disc pl-5">
                      {proposal.assumptions.map((assumption, index) => (
                        <li key={index}>{assumption}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {mode === 'scientific' && proposal.reference_date_utc && (
                  <p className="tiny">
                    Relative dates resolved against {proposal.reference_date_utc.slice(0, 10)} (UTC).
                  </p>
                )}
              </>
            )}

            {proposal.errors.length > 0 && (
              <ul className="space-y-1 text-sm text-[var(--coral)]">
                {proposal.errors.map((error, index) => (
                  <li key={index}>
                    {mode === 'scientific' && <span className="mono text-xs">{error.code} · </span>}
                    {error.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="card-foot flex-wrap">
        {status === 'applied_displayed' && (
          <p data-testid="proposal-applied" className="text-sm text-[var(--teal-deep)]">
            ✓ Applied. Showing results below.
          </p>
        )}
        {status === 'previously_applied' && (
          <p data-testid="proposal-applied-past" className="text-sm text-[var(--muted)]">
            ✓ Applied previously. Newer filters are now active.
          </p>
        )}
        {status === 'applied_loading' && (
          <p data-testid="proposal-applied-loading" className="text-sm text-[var(--muted)] animate-pulse">
            Applying…
          </p>
        )}
        {status === 'applied_failed' && (
          <p data-testid="proposal-applied-failed" className="text-sm text-[var(--coral)]">
            Applied, but validation or execution failed.
          </p>
        )}
        {(status === 'awaiting_apply' || status === 'stale_unapplied') && (
          proposal?.proposed_plan ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" data-testid="accept-proposal" onClick={onAccept} className="button button-primary">
                  Apply
                </button>
                <button type="button" data-testid="dismiss-proposal" onClick={onDismiss} className="button button-outline">
                  Discard
                </button>
              </div>
              <p className="tiny">Applying it fills the filters, and the results update from them.</p>
            </>
          ) : (
            <button type="button" data-testid="dismiss-proposal" onClick={onDismiss} className="button button-primary">
              Edit the question
            </button>
          )
        )}
      </div>
    </section>
  );
}
