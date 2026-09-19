'use client';

/**
 * About: what this is, what the floats measure, where the data came from, and
 * what it can and cannot do.
 *
 * Short paragraphs in ordinary words first. Processing, quality control and
 * the glossary sit in expandable sections, so the page can be read in a
 * minute or studied in ten. Counts and dates always come from the backend's
 * coverage report, never from remembered numbers.
 *
 * The three kinds of value - measured, derived and long-term reference - are
 * kept apart here as everywhere else.
 */

import type { CapabilityReport, PlanExecutionResponse } from '@/lib/planContract.ts';
import {
  type CoverageInfo,
  type GlossaryTerm,
  type ViewMode,
  GLOSSARY,
  describeExclusions,
  formatUtc,
} from '@/lib/explorerModel.ts';
import CapabilityList from './CapabilityStatus';
import WorkspaceHeader from './WorkspaceHeader';

interface Props {
  coverage: CoverageInfo | null;
  capabilities: CapabilityReport | null;
  response: PlanExecutionResponse | null;
  mode: ViewMode;
}

const DETAILS = 'card overflow-hidden';
const SUMMARY = 'cursor-pointer select-none px-5 py-3.5 text-sm font-semibold text-[var(--ink)]';
const BODY = 'space-y-2 px-5 pb-5 text-sm leading-relaxed text-[var(--muted)]';
const PROSE = 'space-y-2 text-sm leading-relaxed text-[var(--muted)]';

const TERM_NAMES: Record<GlossaryTerm, string> = {
  float: 'Float',
  profile: 'Profile',
  depth: 'Depth',
  temperature: 'Temperature',
  salinity: 'Salinity',
  qc: 'Quality control (QC)',
  dataMode: 'Data mode',
  derived: 'Derived value',
  climatology: 'Climatology',
  coverage: 'Coverage',
};

const CONTENTS: { id: string; label: string }[] = [
  { id: 'about-section-source', label: 'Source and refresh' },
  { id: 'about-section-limitations', label: 'What it cannot do' },
  { id: 'about-section-missing', label: 'Missing data and why' },
  { id: 'about-section-qc', label: 'Processing and quality control' },
  { id: 'about-section-variables', label: 'Variables and units' },
  { id: 'about-section-capabilities', label: 'What works now' },
  { id: 'about-section-glossary', label: 'Glossary' },
];

export default function AboutData({ coverage, capabilities, response, mode }: Props) {
  const box = coverage?.bounding_box;
  const sourceLabel = coverage?.label
    ? coverage.label[0].toUpperCase() + coverage.label.slice(1)
    : 'Cached historical observations';
  const policy = coverage?.provenance?.policy;
  const salinityExclusions = describeExclusions(coverage?.exclusions?.psal_masked ?? {});
  const snapshot = coverage?.snapshot ?? null;
  const retrieved = [
    ...new Set(
      (response?.results?.profiles ?? []).map((p) => p.retrieved_at).filter((v): v is string => Boolean(v)),
    ),
  ];

  return (
    <div data-testid="ws-about" className="workspace mx-auto w-full max-w-[1280px] px-5 py-8 lg:px-8">
      <WorkspaceHeader
        eyebrow="About"
        title="About FloatChat"
        description="What this shows, where it came from, and how to read it."
        headingId="heading-about"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0 space-y-4">
          {/* The four things a newcomer needs, in plain words ------------- */}
          <section data-testid="about-what" aria-labelledby="about-what-heading" className="card p-5">
            <h2 id="about-what-heading" className="text-base font-semibold text-[var(--ink)]">
              What FloatChat does
            </h2>
            <div className={`${PROSE} mt-2`}>
              <p>
                FloatChat lets you look at real ocean measurements. You choose an area, some dates and a
                depth range, and it shows the matching measurements on a map and as a chart of values
                against depth.
              </p>
              <p>
                Everything you see is a stored measurement or a value calculated from stored measurements.
                Nothing is invented to fill a gap: if there is no measurement, the gap stays a gap and the
                page says so.
              </p>
            </div>
          </section>

          <section data-testid="about-floats" aria-labelledby="about-floats-heading" className="card p-5">
            <h2 id="about-floats-heading" className="text-base font-semibold text-[var(--ink)]">
              What Argo floats measure
            </h2>
            <div className={`${PROSE} mt-2`}>
              <p>
                An Argo float is a drifting instrument, roughly the size of a person, that sinks to about
                2,000 m, drifts for days, then rises to the surface. On the way up it records{' '}
                <strong className="text-[var(--ink)]">temperature</strong> and{' '}
                <strong className="text-[var(--ink)]">salinity</strong> (how salty the water is) at many
                depths. At the surface it sends those readings by satellite and sinks again.
              </p>
              <p>
                One of those rises is called a <strong className="text-[var(--ink)]">profile</strong>: a
                single column of readings at one place and time. Floats drift with the current, so their
                positions are wherever the ocean carried them — they are not a planned survey.
              </p>
            </div>
          </section>

          <section data-testid="about-source" aria-labelledby="about-source-heading" className="card p-5">
            <h2 id="about-source-heading" className="text-base font-semibold text-[var(--ink)]">
              Where this data comes from
            </h2>
            <div className={`${PROSE} mt-2`}>
              {snapshot?.is_fallback && (
                <p data-testid="about-fallback" className="text-[var(--ochre)]">
                  Showing the original January 2024 extract. {snapshot.reason ?? ''} Recent observations
                  will appear once a refresh succeeds.
                </p>
              )}
              <p>
                {sourceLabel} from{' '}
                {coverage?.provenance?.dataset_id ?? coverage?.dataset ?? 'the Argo data system'}, downloaded
                once and stored on this server. Nothing is fetched live while you browse, so the same query
                always returns the same answer.
              </p>
              {coverage && box ? (
                <ul data-testid="about-coverage" className="space-y-1.5">
                  <li>
                    <strong className="text-[var(--ink)]">
                      {coverage.distinct_profiles} profiles from {coverage.distinct_floats} floats
                    </strong>
                    , {coverage.observation_count.toLocaleString('en')} measured levels.
                  </li>
                  <li>
                    Measured between{' '}
                    <span className="mono whitespace-nowrap">{formatUtc(coverage.date_range[0], false)}</span> and{' '}
                    <span className="mono whitespace-nowrap">{formatUtc(coverage.date_range[1], false)}</span> (UTC).
                  </li>
                  <li>
                    Between {box.south.toFixed(2)}–{box.north.toFixed(2)}° N and {box.west.toFixed(2)}–
                    {box.east.toFixed(2)}° E, down to {Math.round(coverage.depth_range_m[1])} m.
                  </li>
                  {coverage.provenance?.processed_at && (
                    <li>
                      Prepared for this server on {formatUtc(coverage.provenance.processed_at)} — a processing
                      date, not a measurement date.
                    </li>
                  )}
                  {retrieved.length > 0 && (
                    <li>Retrieved from the source: {retrieved.map((value) => formatUtc(value)).join(', ')}.</li>
                  )}
                </ul>
              ) : (
                <p>Loading what is available…</p>
              )}
            </div>
          </section>

          <section data-testid="about-kinds" aria-labelledby="about-kinds-heading" className="card p-5">
            <h2 id="about-kinds-heading" className="text-base font-semibold text-[var(--ink)]">
              Three kinds of number
            </h2>
            <ul className={`${PROSE} mt-2 space-y-1.5`}>
              <li>
                <span className="font-semibold text-[var(--ink)]">Measurements</span> — values a float
                actually recorded at a depth.
              </li>
              <li>
                <span className="font-semibold text-[var(--ink)]">Derived values</span> — calculated for an
                exact depth from the two nearest measurements, drawn as open diamonds. Useful, but not
                measurements.
              </li>
              <li>
                <span className="font-semibold text-[var(--ink)]">Reference averages</span> — a long-term
                monthly average from climatology (WOA23, 1991–2020), used only for comparison. A difference
                from it is a difference, not proof that anything is unusual.
              </li>
            </ul>
          </section>

          {/* Detail, for those who want it ------------------------------- */}
          <details id="about-section-source" data-testid="about-source-detail" className={DETAILS}>
            <summary className={SUMMARY}>Source and refresh</summary>
            <div className={BODY}>
              <p>
                Measurements come from the Argo global data system through Ifremer&apos;s ERDDAP server.
                They are downloaded once into a snapshot and served from it, so browsing never fetches
                anything and the same query always returns the same answer. This is a bounded extract,
                not a live feed: &ldquo;recent&rdquo; refers to when the floats took the measurements, not
                to when they were downloaded.
              </p>
              {snapshot ? (
                <ul className="space-y-1.5">
                  <li>
                    Snapshot <span className="mono">{snapshot.snapshot_id}</span>
                    {snapshot.is_fallback ? ' (the original January 2024 extract)' : ''}.
                  </li>
                  {snapshot.requested_region && (
                    <li>
                      Searched {snapshot.requested_region.south}–{snapshot.requested_region.north}° N,{' '}
                      {snapshot.requested_region.west}–{snapshot.requested_region.east}° E.
                    </li>
                  )}
                  {snapshot.requested_window_utc && (
                    <li>
                      Requested observations from {formatUtc(snapshot.requested_window_utc[0], false)} to{' '}
                      {formatUtc(snapshot.requested_window_utc[1], false)} (UTC).
                    </li>
                  )}
                  {snapshot.retrieved_at && <li>Downloaded {formatUtc(snapshot.retrieved_at)}.</li>}
                  {snapshot.truncated && (
                    <li className="text-[var(--ochre)]">
                      This extract was capped at {snapshot.max_rows?.toLocaleString('en')} rows, so it is
                      not complete coverage of the region and window.
                    </li>
                  )}
                </ul>
              ) : (
                <p>Snapshot details are not recorded for this dataset.</p>
              )}
              <p>
                It is refreshed by running{' '}
                <span className="mono">scriptsefresh_argo.ps1</span>, which downloads the last 30 UTC
                days, checks the result and only then serves it. A failed download changes nothing: the
                dataset already loaded keeps working.
              </p>
            </div>
          </details>

          <details id="about-section-limitations" data-testid="about-limitations" className={DETAILS} open>
            <summary className={SUMMARY}>What it cannot do</summary>
            <ul className="list-disc space-y-1.5 pb-5 pl-10 pr-5 text-sm text-[var(--muted)]">
              <li>
                It holds one cached regional subset
                {coverage
                  ? ` (${coverage.distinct_profiles} profiles, ${formatUtc(coverage.date_range[0], false)} to ${formatUtc(
                      coverage.date_range[1],
                      false,
                    )})`
                  : ''}
                . Other regions and dates return nothing rather than an estimate.
              </li>
              <li>
                The globe and the depth scene give context, not coverage: they show where floats surfaced,
                never an ocean-wide field or a float&apos;s path. Depth is drawn exaggerated, and the labels
                give the actual metres.
              </li>
              <li>
                Comparisons with climatology use cached reference columns only. A difference from a
                long-term average is not an anomaly test, and never a marine-heatwave claim. Heatwave
                detection, significance tests and forecasting are not available.
              </li>
              <li>
                The assistant proposes query settings and explains results. Its wording has not been
                evaluated against a real model, so review what it proposes. It never calculates a value:
                every number is computed here and inserted by the server, and a claim outside a fixed set
                of approved sentences is rejected rather than shown. With no model available, the same
                sentences are built without one and labelled a data summary.
              </li>
              <li>
                Accounts sign you in and nothing more. No query, conversation or comparison is saved to an
                account: that state lives in this browser tab and is gone when it closes. There is no email
                verification, password recovery or third-party sign-in on this deployment.
              </li>
              <li>Compare works within one result; comparing periods or regions is not available.</li>
            </ul>
          </details>

          <details id="about-section-missing" data-testid="about-missing" className={DETAILS}>
            <summary className={SUMMARY}>Missing data and why</summary>
            <div className={BODY}>
              <p>
                Temperature is kept even when salinity is missing, so many levels have temperature only
                {coverage?.temperature_only_observations !== undefined
                  ? ` (${coverage.temperature_only_observations.toLocaleString('en')} of ${coverage.observation_count.toLocaleString('en')})`
                  : ''}
                .
              </p>
              {salinityExclusions && <p>Salinity in the cached data: {salinityExclusions}.</p>}
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <span className="font-semibold text-[var(--ink)]">No value in the source file</span>: the
                  float&apos;s file has no value for that level — for example, no corrected salinity yet.
                  This is not a quality-control failure.
                </li>
                <li>
                  <span className="font-semibold text-[var(--ink)]">Failed quality control</span>: a value
                  exists, but its flag is not &ldquo;good&rdquo;.
                </li>
                <li>
                  <span className="font-semibold text-[var(--ink)]">Unreadable quality flag</span>: the flag
                  could not be read, so the value is not used.
                </li>
                <li>
                  <span className="font-semibold text-[var(--ink)]">Reason not recorded</span>: the cached
                  tables do not say why; this is stated rather than guessed.
                </li>
              </ul>
            </div>
          </details>

          <details id="about-section-qc" data-testid="about-qc" className={DETAILS}>
            <summary className={SUMMARY}>Processing and quality control</summary>
            <div className={BODY}>
              <p>
                Every measurement arrives with a quality flag. Only levels flagged &ldquo;good&rdquo; are
                used here. Floats report in three modes: real-time values as sent with their own flags, and
                adjusted or delayed-mode values that have been corrected, with the flags for those
                corrections. This server uses the corrected value whenever one exists.
              </p>
              <p>
                Depth is not measured directly. Floats record pressure, which is converted to metres using
                the standard relationship for the float&apos;s latitude.
              </p>
              {mode === 'scientific' && policy && (
                <ul className="mono space-y-0.5 text-xs">
                  {Object.entries(policy).map(([key, value]) => (
                    <li key={key}>
                      {key}: {Array.isArray(value) ? value.join(', ') : String(value)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <details id="about-section-variables" data-testid="about-variables" className={DETAILS}>
            <summary className={SUMMARY}>Variables and units</summary>
            <ul className="list-disc space-y-1.5 pb-5 pl-10 pr-5 text-sm text-[var(--muted)]">
              <li>
                Temperature: in-situ temperature (Argo TEMP), °C on the ITS-90 scale. Not Conservative
                Temperature.
              </li>
              <li>
                Salinity: practical salinity (Argo PSAL) on the PSS-78 scale, which has no unit. Not
                Absolute Salinity.
              </li>
              <li>Depth: metres below the surface, derived from pressure and latitude.</li>
            </ul>
          </details>

          <details id="about-section-capabilities" data-testid="about-capabilities" className={DETAILS}>
            <summary className={SUMMARY}>What works now</summary>
            <div className="px-5 pb-5">
              <CapabilityList capabilities={capabilities} mode={mode} />
            </div>
          </details>

          <details id="about-section-glossary" data-testid="about-glossary" className={DETAILS}>
            <summary className={SUMMARY}>
              Glossary ({mode === 'scientific' ? 'scientific' : 'plain-language'} definitions)
            </summary>
            <dl className="definition-list px-5 pb-5 text-sm">
              {(Object.keys(GLOSSARY) as GlossaryTerm[]).map((term) => (
                <div key={term}>
                  <dt className="font-semibold text-[var(--ink)]">{TERM_NAMES[term]}</dt>
                  <dd className="text-[var(--muted)]">{GLOSSARY[term][mode]}</dd>
                </div>
              ))}
            </dl>
          </details>

          {mode === 'scientific' && coverage?.provenance && (
            <details data-testid="about-provenance" className={DETAILS}>
              <summary className={SUMMARY}>Provenance</summary>
              <div className="mono break-all px-5 pb-5 text-xs text-[var(--muted)]">
                {coverage.provenance.source_url && <p>{coverage.provenance.source_url}</p>}
                {coverage.provenance.raw_file_checksum && <p>{coverage.provenance.raw_file_checksum}</p>}
              </div>
            </details>
          )}
        </div>

        <nav aria-label="On this page" className="about-contents hidden h-fit lg:sticky lg:top-6 lg:block">
          <span className="card-kicker">On this page</span>
          <ul className="space-y-2">
            {CONTENTS.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={() => {
                    // Open a collapsed section when its entry is chosen.
                    const element = document.getElementById(item.id);
                    if (element instanceof HTMLDetailsElement) element.open = true;
                  }}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
