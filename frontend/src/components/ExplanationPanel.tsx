'use client';

/**
 * A short explanation of the results on screen, with its evidence.
 *
 * Two distinctions are kept visible, because collapsing either would mislead:
 *
 *  1. **Explanation or data summary.** A model may choose which approved
 *     sentences to use; when no model is available the backend builds the same
 *     sentences itself. The second is labelled "Data summary" and never
 *     presented as though a model had answered.
 *  2. **Measured or computed.** Every fact carries its own kind, so a derived
 *     value is never read as an observation.
 *
 * No value here is calculated in the browser. Each number was computed by the
 * backend and is shown with the units it was given.
 */

import type { EvidenceFact, PlanExplanationResponse } from '@/lib/planContract.ts';
import type { ViewMode } from '@/lib/explorerModel.ts';

/** Plain words for the fact kinds the backend uses. */
const KIND_WORDS: Record<string, string> = {
  measured: 'measured',
  derived: 'computed',
  reference: 'reference',
  count: 'count',
  extent: 'range',
  status: 'detail',
};

function factValue(fact: EvidenceFact, mode: ViewMode): string {
  let value = fact.value;
  if (value === null) return '—';
  
  if (mode === 'student' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    value = value.substring(0, 10);
  }
  
  const displayValue = String(value);
  if (!fact.units) return displayValue;
  return fact.units === 'UTC' ? `${displayValue} UTC` : `${displayValue} ${fact.units}`;
}

/** The short half of a `sha256:…` identifier, enough to compare by eye. */
function shortId(value: string | null): string | null {
  if (!value) return null;
  const digest = value.startsWith('sha256:') ? value.slice(7) : value;
  return digest.slice(0, 12);
}

interface Props {
  explanation: PlanExplanationResponse;
  /** True if this explanation describes the results currently on screen. */
  describesCurrentExecution: boolean;
  mode: ViewMode;
}

export default function ExplanationPanel({ explanation, describesCurrentExecution, mode }: Props) {
  const { outcome, sentences, caveats, source } = explanation;
  const isSummary = source === 'data_summary';
  const evidence = explanation.evidence ?? null;
  const used = new Set(explanation.used_fact_ids);
  // Only the facts this explanation actually stands on, so "View evidence"
  // shows what was used rather than everything that was available.
  const cited = (evidence?.facts ?? []).filter((fact) => used.has(fact.id));
  const limitations = evidence?.limitations ?? explanation.limitations;
  const notes = evidence?.notes ?? [];
  const dataVersion = shortId(explanation.dataset_version);
  const resultId = shortId(explanation.plan_fingerprint);

  return (
    <section data-testid="explain-panel" className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--divider)] bg-[var(--surface-quiet)] px-5 py-3">
        <span data-testid="explain-source" className={`chip ${isSummary ? 'chip-ochre' : 'chip-teal'}`}>
          {isSummary ? 'Data summary' : 'Explanation'}
        </span>
        {!describesCurrentExecution && (
          <span data-testid="explain-stale" className="chip chip-ochre">
            Describes an earlier result, not the one shown below
          </span>
        )}
      </div>

      <div className="space-y-3 p-5">
        {explanation.provider_message && (
          <p data-testid="explain-message" className="text-sm text-[var(--muted)]">
            {explanation.provider_message}
          </p>
        )}

        {outcome === 'dataset_mismatch' && (
          <p className="text-sm text-[var(--ochre)]">
            Run the query again to explain the current data.
          </p>
        )}

        {sentences.length > 0 && (
          <ul data-testid="explain-sentences" className="space-y-1.5 text-sm text-[var(--ink)]">
            {sentences.map((sentence) => (
              <li key={`${sentence.template}:${sentence.variable ?? ''}`}>{sentence.text}</li>
            ))}
          </ul>
        )}

        {sentences.length === 0 && outcome === 'insufficient_evidence' && (
          <p data-testid="explain-insufficient" className="text-sm text-[var(--ink)]">
            These results do not carry enough information to explain.
          </p>
        )}

        {caveats.length > 0 && (
          <ul data-testid="explain-caveats" className="space-y-1 tiny">
            {caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        )}

        {(cited.length > 0 || limitations.length > 0) && (
          <details data-testid="explain-evidence">
            <summary data-testid="explain-evidence-toggle" className="cursor-pointer select-none text-sm font-medium text-[var(--teal-deep)]">
              {mode === 'student' ? 'Scientific details' : 'View evidence'}
            </summary>

            {cited.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[var(--muted)]">
                      <th className="py-1 pr-3 font-medium">Measurement</th>
                      <th className="py-1 pr-3 font-medium">Value</th>
                      <th className="py-1 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cited.map((fact) => (
                      <tr key={fact.id} data-testid="explain-fact" className="border-t border-[var(--divider)]">
                        <td className="py-1 pr-3">{fact.label}</td>
                        <td className="mono py-1 pr-3 tabular-nums">{factValue(fact, mode)}</td>
                        <td className="py-1 text-[var(--muted)]">{KIND_WORDS[fact.kind] ?? fact.kind}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {limitations.length > 0 && (
              <ul data-testid="explain-limitations" className="mt-3 space-y-1 tiny">
                {limitations.map((limitation, index) => (
                  <li key={limitation.code ?? index}>{limitation.message}</li>
                ))}
              </ul>
            )}

            {notes.length > 0 && (
              <ul className="mt-2 space-y-1 tiny">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            {(dataVersion || resultId) && (
              <p className="mono mt-3 text-[11px] text-[var(--muted)]">
                {dataVersion && <>data {dataVersion}</>}
                {dataVersion && resultId && ' · '}
                {resultId && <>result {resultId}</>}
              </p>
            )}
          </details>
        )}

        <p className="tiny">
          {isSummary
            ? 'Built directly from these measurements. No model was involved.'
            : 'Wording chosen by a model from a fixed set of sentences; every value was computed here from these measurements.'}
        </p>
      </div>
    </section>
  );
}
