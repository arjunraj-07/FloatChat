'use client';

/**
 * Filters bound to the single editable draft.
 *
 * Every control edits the same `DraftForm`; there is no parallel filter state.
 * Text inputs keep whatever the user typed, including empty, so a field can be
 * cleared and retyped without the form substituting a default mid-edit.
 *
 * Only implemented analyses and outputs are offered as controls. If the draft
 * already contains an unavailable one - for example from an accepted
 * natural-language proposal - it is listed so it can be removed, rather than
 * hidden from the user.
 */

import {
  type Analysis,
  type CapabilityReport,
  type DataMode,
  type NamedRegion,
  type Output,
  type Variable,
  ANALYSES,
  DATA_MODES,
  NAMED_REGIONS,
  OUTPUTS,
} from '@/lib/planContract.ts';
import { type DraftForm, type FormIssue, DATE_SEMANTICS } from '@/lib/draftPlan.ts';
import type { ViewMode } from '@/lib/explorerModel.ts';
import Term from './Term';

interface Props {
  form: DraftForm;
  issues: FormIssue[];
  capabilities: CapabilityReport | null;
  mode: ViewMode;
  onChange: (changes: Partial<DraftForm>) => void;
}

const LABEL = 'mb-1 block text-xs font-semibold text-[var(--muted)]';
const INPUT = 'field-input min-h-[36px] py-1.5 text-sm';
const SECTION = 'space-y-2';
const HEADING = 'text-sm font-semibold text-[var(--ink)]';
const INVALID = 'border-[var(--coral)] bg-[#f6e6e0]';
const ISSUE = 'mt-1 text-xs text-[var(--coral)]';
const HINT = 'tiny';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function pretty(name: string): string {
  return name.replace(/_/g, ' ');
}

export default function QueryBuilder({ form, issues, capabilities, mode, onChange }: Props) {
  const issueFor = (field: string) => issues.find((i) => i.field === field);

  const field = (
    key: keyof DraftForm,
    issueField: string,
    label: string,
    value: string,
    placeholder = '',
  ) => {
    const issue = issueFor(issueField);
    const id = `field-${key}`;
    return (
      <div>
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        <input
          id={id}
          data-testid={id}
          className={`${INPUT} ${issue ? INVALID : ''}`}
          value={value}
          placeholder={placeholder}
          aria-invalid={issue ? true : undefined}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<DraftForm>)}
        />
        {issue && <p className={ISSUE}>{issue.message}</p>}
      </div>
    );
  };

  const implemented = (kind: 'analyses' | 'outputs', name: string) => {
    if (!capabilities) return true;
    const entry = (capabilities[kind] as Record<string, { implemented: boolean }>)[name];
    return entry ? entry.implemented : false;
  };
  const unavailableInDraft = [
    ...form.analyses.filter((a) => !implemented('analyses', a)).map((a) => ({ kind: 'analyses' as const, name: a })),
    ...form.outputs.filter((o) => !implemented('outputs', o)).map((o) => ({ kind: 'outputs' as const, name: o })),
  ];

  return (
    <div className="space-y-5">
      {unavailableInDraft.length > 0 && (
        <div className="rounded-md border border-[#cdc4e0] bg-[#e7e3f0] p-3 text-sm text-[#3d3357]">
          <p className="font-semibold">Not available in this version</p>
          <p className="text-xs">Your draft asks for these. Remove them to run the query.</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {unavailableInDraft.map(({ kind, name }) => (
              <li key={`${kind}-${name}`}>
                <button
                  type="button"
                  className="rounded-full border border-[#b9addb] bg-[var(--surface)] px-2.5 py-0.5 text-xs hover:bg-[#ddd6ec]"
                  onClick={() =>
                    kind === 'analyses'
                      ? onChange({ analyses: form.analyses.filter((a) => a !== name) })
                      : onChange({ outputs: form.outputs.filter((o) => o !== name) })
                  }
                >
                  Remove {pretty(name)} ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className={SECTION}>
        <h3 className={HEADING}>Region</h3>
        <div className="flex gap-4 text-sm">
          {(['named', 'bbox'] as const).map((kind) => (
            <label key={kind} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="region-kind"
                checked={form.regionKind === kind}
                onChange={() => onChange({ regionKind: kind })}
              />
              {kind === 'named' ? 'Named area' : 'Box (degrees)'}
            </label>
          ))}
        </div>
        {form.regionKind === 'named' ? (
          <select
            aria-label="Named area"
            className={INPUT}
            value={form.namedRegion}
            onChange={(e) => onChange({ namedRegion: e.target.value as NamedRegion })}
          >
            {NAMED_REGIONS.map((name) => (
              <option key={name} value={name}>
                {pretty(name)}
              </option>
            ))}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {field('west', 'region.west', 'West (°E)', form.west)}
            {field('east', 'region.east', 'East (°E)', form.east)}
            {field('south', 'region.south', 'South (°N)', form.south)}
            {field('north', 'region.north', 'North (°N)', form.north)}
          </div>
        )}
        <p className={HINT}>
          The region filters individual <Term term="profile" mode={mode}>profile</Term>{' '}
          positions; it is not an area survey.
        </p>
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>Dates</h3>
        <div className="grid grid-cols-2 gap-2">
          {field('startDate', 'time.start', 'From', form.startDate, 'YYYY-MM-DD')}
          {field('endDate', 'time.end', 'Through', form.endDate, 'YYYY-MM-DD')}
        </div>
        <p className={HINT}>
          {mode === 'scientific' ? DATE_SEMANTICS : 'Both dates are included, in UTC.'}
        </p>
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>
          <Term term="depth" mode={mode}>Depth</Term>
        </h3>
        <div className="flex gap-4 text-sm">
          {(['range', 'at_depth'] as const).map((depthMode) => (
            <label key={depthMode} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="depth-mode"
                checked={form.depthMode === depthMode}
                onChange={() => onChange({ depthMode })}
              />
              {depthMode === 'range' ? 'Range' : 'Exact depth'}
            </label>
          ))}
        </div>
        {form.depthMode === 'range' ? (
          <div className="grid grid-cols-2 gap-2">
            {field('depthMin', 'depth.min_m', 'Shallowest (m)', form.depthMin)}
            {field('depthMax', 'depth.max_m', 'Deepest (m)', form.depthMax)}
          </div>
        ) : (
          <>
            {field('depthTarget', 'depth.target_m', 'Target depth (m)', form.depthTarget)}
            <p className="text-xs text-[var(--ochre)]">
              Values at an exact depth are <Term term="derived" mode={mode}>derived</Term>{' '}
              from the nearest measured levels and labelled as such.
            </p>
          </>
        )}
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>Variables</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          {([['temp', 'Temperature', 'temperature'], ['psal', 'Salinity', 'salinity']] as const).map(
            ([value, label, term]) => (
              <label key={value} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  data-testid={`variable-${value}`}
                  checked={form.variables.includes(value as Variable)}
                  onChange={() => onChange({ variables: toggle(form.variables, value as Variable) })}
                />
                <Term term={term} mode={mode}>
                  {mode === 'scientific' ? `${label} (${value.toUpperCase()})` : label}
                </Term>
              </label>
            ),
          )}
        </div>
        {issueFor('variables') && (
          <p className={ISSUE}>{issueFor('variables')!.message}</p>
        )}
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>
          <Term term="float" mode={mode}>Floats</Term> and profiles{' '}
          <span className="font-normal text-[var(--muted)]">(optional)</span>
        </h3>
        {field('platforms', 'selection.platforms', 'Float numbers (WMO)', form.platforms, 'e.g. 6903060')}
        {field('profileIds', 'selection.profile_ids', 'Profile IDs', form.profileIds, 'e.g. 6903060_485_A')}
      </section>

      <details className="rounded-md border border-[var(--divider)] bg-[var(--surface-quiet)] p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
          Advanced: analyses, outputs and quality policy
        </summary>
        <div className="mt-3 space-y-4">
          <div>
            <p className={LABEL}>Analyses</p>
            <div className="flex flex-col gap-1.5 text-sm">
              {ANALYSES.filter((name) => implemented('analyses', name)).map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-1.5" title={capabilities?.analyses[name as Analysis]?.description}>
                  <input
                    type="checkbox"
                    checked={form.analyses.includes(name)}
                    onChange={() => onChange({ analyses: toggle(form.analyses, name) })}
                  />
                  {pretty(name)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className={LABEL}>Outputs</p>
            <div className="flex flex-col gap-1.5 text-sm">
              {OUTPUTS.filter((name) => implemented('outputs', name)).map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-1.5" title={capabilities?.outputs[name as Output]?.description}>
                  <input
                    type="checkbox"
                    checked={form.outputs.includes(name)}
                    onChange={() => onChange({ outputs: toggle(form.outputs, name) })}
                  />
                  {pretty(name)}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className={LABEL}>
              <Term term="qc" mode={mode}>Quality</Term> and{' '}
              <Term term="dataMode" mode={mode}>data mode</Term> policy
            </p>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.qcPolicyExplicit}
                onChange={(e) => onChange({ qcPolicyExplicit: e.target.checked })}
              />
              Set explicitly
            </label>
            {form.qcPolicyExplicit ? (
              <>
                {field('acceptedQcFlags', 'qc_policy.accepted_qc_flags', 'Accepted QC flags', form.acceptedQcFlags, 'e.g. 1')}
                <div className="flex gap-4 text-sm">
                  {DATA_MODES.map((dataMode) => (
                    <label key={dataMode} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={form.dataModes.includes(dataMode as DataMode)}
                        onChange={() => onChange({ dataModes: toggle(form.dataModes, dataMode as DataMode) })}
                      />
                      {dataMode}
                    </label>
                  ))}
                </div>
                {issueFor('qc_policy.data_modes') && (
                  <p className={ISSUE}>{issueFor('qc_policy.data_modes')!.message}</p>
                )}
              </>
            ) : (
              <p className={HINT}>
                Not set: the server applies its default and reports it in the understanding panel.
              </p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
