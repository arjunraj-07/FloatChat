'use client';

/**
 * Explore: the map first, the measurements below it.
 *
 * The map or globe owns the first screen. Everything read from a result -
 * measurements, the chart, scientific details - sits underneath and is reached
 * by scrolling the page normally, so there is one scrollbar rather than
 * several competing panes.
 *
 * Results follow the filters. There is no button that runs a query: a valid
 * draft is executed automatically, and the bar above the map says which state
 * the screen is in - checking, loading, showing, or unable to. Results from a
 * previous selection are labelled as such and never passed off as current.
 *
 * Filters stay in a drawer that starts closed. Selecting a profile changes
 * what the panels below show, and nothing about the page position.
 */

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

import type {
  CapabilityReport,
  ExecutedProfile,
  PlanExecutionResponse,
  PlanValidationResponse,
  Variable,
} from '@/lib/planContract.ts';

import { type DraftForm, describePlan } from '@/lib/draftPlan.ts';
import type { SessionState } from '@/lib/querySession.ts';
import type { CoverageInfo, ViewMode, WoaMatchResponse } from '@/lib/explorerModel.ts';
import type { MapView } from '@/lib/navigation.ts';
import {
  type SelectionSummary,
  changedFrom,
  summarizeNormalized,
  summarizeSelection,
} from '@/lib/selectionSummary.ts';
import DetailsPanel from './DetailsPanel';
import Map, { MARKER_COLORS, type MapProfile } from './Map';
import PlanPreview, { OutcomeBadge } from './PlanPreview';
import ProfilePanel from './ProfilePanel';
import QueryBuilder from './QueryBuilder';
import TimeNavigator from './TimeNavigator';
import type { TimeNavigatorView } from './useTimeNavigator';
import DiveView from './DiveView';

function SceneLoading({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-quiet)] text-sm text-[var(--muted)]">
      <span className="flex items-center gap-2">
        <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[var(--teal)]" />
        {label}
      </span>
    </div>
  );
}

const GlobeView = dynamic(() => import('./GlobeView'), {
  ssr: false,
  loading: () => <SceneLoading label="Loading the globe…" />,
});
const DepthView = dynamic(() => import('./DepthView'), {
  ssr: false,
  loading: () => <SceneLoading label="Loading the depth scene…" />,
});

/** Camera-memory key for the globe before any result exists. */
const OVERVIEW_KEY = {};

interface Props {
  mode: ViewMode;
  coverage: CoverageInfo | null;
  capabilities: CapabilityReport | null;
  session: SessionState;
  validation: PlanValidationResponse | null;
  blockedReason: string | null;
  response: PlanExecutionResponse | null;
  stale: boolean;
  overview: MapProfile[];
  time: TimeNavigatorView;
  visibleProfiles: ExecutedProfile[];
  throughLabel: string | null;
  activeProfileId: string | null;
  onSelectProfile: (profileId: string) => void;
  woa: WoaMatchResponse | null;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  mapView: MapView;
  onMapViewChange: (view: MapView) => void;
  depthVariable: Variable;
  onDepthVariableChange: (variable: Variable) => void;
  onFormChange: (changes: Partial<DraftForm>) => void;
  onOpenAssistant: () => void;
}

const DOT = 'mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle';

export default function MapExplorer({
  mode,
  coverage,
  capabilities,
  session,
  validation,
  blockedReason,
  response,
  stale,
  overview,
  time,
  visibleProfiles,
  throughLabel,
  activeProfileId,
  onSelectProfile,
  woa,
  drawerOpen,
  onDrawerOpenChange,
  mapView,
  onMapViewChange,
  depthVariable,
  onDepthVariableChange,
  onFormChange,
  onOpenAssistant,
}: Props) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // This panel stays mounted while another section is shown, so the choice to
  // explore over time survives navigation without living in the shell.
  const [timeOpen, setTimeOpen] = useState(false);
  const [diveProfileId, setDiveProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (drawerOpen) closeRef.current?.focus();
  }, [drawerOpen]);
  const closeDrawer = () => {
    onDrawerOpenChange(false);
    toggleRef.current?.focus();
  };

  const plan = session.plan;
  const results = response?.executed ? response.results : null;
  const hasProfiles = Boolean(results && results.profiles.length > 0);
  const mapMode: 'overview' | 'results' = results ? 'results' : 'overview';
  const floatCount = results ? new Set(results.profiles.map((p) => p.platform)).size : 0;
  const mapProfiles: MapProfile[] = results ? visibleProfiles : overview;
  const mapBounds: MapProfile[] = results ? results.profiles : overview;
  const requested = (response?.plan?.variables ?? results?.variables ?? []) as Variable[];
  const showDepth = mapView === 'depth' && hasProfiles && results !== null;
  const showGlobe = mapView === 'globe' || (mapView === 'depth' && !showDepth);

  // What is selected now, and which parts of it differ from what is shown.
  const selection = plan ? summarizeSelection(plan) : null;
  const shownSelection = summarizeNormalized(response?.plan);
  const pending = stale ? changedFrom(selection, shownSelection) : [];
  const summaryParts: (keyof SelectionSummary)[] = ['region', 'dates', 'variables', 'depth'];

  /**
   * One state for the whole screen, so loading, an unusable draft, an empty
   * answer and a real result are never confused with one another.
   */
  const status: 'loading' | 'invalid' | 'unavailable' | 'empty' | 'ready' | 'waiting' =
    session.executing
      ? 'loading'
      : session.formIssues.length > 0 ||
          validation?.outcome === 'invalid' ||
          validation?.outcome === 'unsupported'
        ? 'invalid'
        : validation?.outcome === 'valid_no_data'
          ? 'unavailable'
          : response?.executed && !hasProfiles
            ? 'empty'
            : hasProfiles
              ? 'ready'
              : 'waiting';

  const statusChip: Record<typeof status, { text: string; tone: string } | null> = {
    loading: { text: 'Loading results…', tone: 'chip-teal' },
    invalid: { text: 'Filters need fixing', tone: 'chip-ochre' },
    unavailable: { text: 'No data for these filters', tone: 'chip-ochre' },
    empty: { text: 'No measurements match', tone: 'chip-ochre' },
    ready: null,
    waiting: { text: 'Checking…', tone: 'chip-default' },
  };
  const chip = statusChip[status];
  const diveProfile = diveProfileId ? response?.results?.profiles.find(p => p.profile_id === diveProfileId) : null;

  return (
    <div data-testid="ws-map" className="flex flex-col">
      <h1 id="heading-map" tabIndex={-1} className="sr-only">
        Explore
      </h1>

      {/* Selection bar. Sticky, so the filters stay reachable while reading
          the measurements further down the page. */}
      <div className="sticky top-0 z-[1100] flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[rgba(139,203,196,0.15)] bg-[var(--fc-bg)] px-4 py-2">
        <button
          ref={toggleRef}
          type="button"
          data-testid="filters-toggle"
          aria-expanded={drawerOpen}
          aria-controls="filter-drawer"
          onClick={() => (drawerOpen ? closeDrawer() : onDrawerOpenChange(true))}
          className="fc-btn fc-btn-sm"
        >
          {drawerOpen ? 'Close filters' : 'Filters'}
        </button>

        <p
          data-testid="query-summary"
          className="min-w-0 flex-1 basis-48 truncate text-sm text-[var(--fc-fg)]"
          title={plan ? describePlan(plan) : undefined}
        >
          {selection ? (
            summaryParts.map((part, index) => (
              <span key={part}>
                {index > 0 && <span className="text-[var(--fc-muted)]"> · </span>}
                <span
                  data-pending={pending.includes(part) ? 'true' : undefined}
                  className={pending.includes(part) ? 'pending-part text-[var(--fc-teal)]' : undefined}
                >
                  {selection[part]}
                </span>
              </span>
            ))
          ) : (
            <span className="text-[var(--fc-muted)]">Reading the dataset…</span>
          )}
        </p>

        <OutcomeBadge validation={validation} checking={session.validating || (plan !== null && validation === null)} />

        {coverage?.snapshot?.is_fallback && (
          <span data-testid="dataset-fallback" className="fc-badge fc-badge-warn" title={coverage.snapshot.reason ?? undefined}>
            Historical 2024 data
          </span>
        )}

        {chip && (
          <span data-testid="results-status" role="status" className={`fc-badge ${chip.tone === 'chip-teal' ? 'fc-badge-ok' : chip.tone === 'chip-ochre' ? 'fc-badge-warn' : 'fc-badge-default'}`}>
            {chip.text}
          </span>
        )}

        {status === 'invalid' && blockedReason && (
          <span data-testid="blocked-reason" className="hidden text-xs text-[var(--fc-muted)] xl:inline">
            {blockedReason}
          </span>
        )}

        {session.executionError && (
          <p className="w-full text-xs text-[var(--fc-coral)]">Could not load results: {session.executionError}</p>
        )}
        {stale && (
          <p data-testid="stale-results" className="w-full text-xs text-[#d56d50]">
            Filters changed. The results below are from the previous selection.
          </p>
        )}
      </div>

      {/* The map owns the first screen ------------------------------------- */}
      <div className="relative">
        {drawerOpen && (
          <div className="fc-drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) closeDrawer(); }}>
            <aside
              id="filter-drawer"
              data-testid="filter-drawer"
              aria-label="Filters"
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeDrawer();
              }}
              className="fc-drawer"
            >
              <header className="fc-drawer-head">
                <div><span className="fc-kicker">Filters</span><h2 className="fc-panel-title">Narrow the observations</h2></div>
                <button
                  ref={closeRef}
                  type="button"
                  data-testid="filters-close"
                  onClick={closeDrawer}
                  className="fc-icon-btn"
                  aria-label="Close filters"
                >
                  ✕
                </button>
              </header>
              <div className="fc-drawer-body">
                <QueryBuilder
                  form={session.form}
                  issues={session.formIssues}
                  capabilities={capabilities}
                  mode={mode}
                  onChange={onFormChange}
                />
                <PlanPreview
                  plan={plan}
                  validation={validation}
                  validating={session.validating}
                  stale={plan !== null && validation === null}
                  transportError={session.validationError}
                  mode={mode}
                />
              </div>
            </aside>
          </div>
        )}

        <div
          data-testid="map-card"
          className="relative flex h-[calc(100dvh-7rem)] min-h-[420px] flex-col border-b border-[rgba(139,203,196,0.15)] bg-[#050f16]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div role="group" aria-label="Map view" className="segmented">
              {(['regional', 'globe'] as const).map((view) => {
                const active = view === 'regional' ? mapView === 'regional' : mapView !== 'regional';
                return (
                  <button
                    key={view}
                    type="button"
                    data-testid={`mapview-${view}`}
                    aria-pressed={active}
                    onClick={() => onMapViewChange(view)}
                    className={active ? 'fc-seg-btn is-selected' : 'fc-seg-btn'}
                  >
                    {view === 'regional' ? 'Map' : 'Globe'}
                  </button>
                );
              })}
            </div>
            <p data-testid="map-mode" className="tiny text-right">
              {mapMode === 'overview'
                ? `Dataset overview · ${overview.length} cached profiles · not query results`
                : `Query result · ${results?.profiles.length ?? 0} profiles from ${floatCount} floats${
                    showDepth ? ' · depth scene' : ''
                  }`}
            </p>
          </div>
          <div className="relative min-h-0 flex-1">
            <div hidden={mapView !== 'regional'} className="absolute inset-0">
              <Map
                mode={mapMode}
                profiles={mapProfiles}
                boundsProfiles={mapBounds}
                selectedProfileId={mapMode === 'results' ? activeProfileId : null}
                onSelectProfile={(id) => {
                  if (mapMode === 'results') onSelectProfile(id);
                }}
              />
              <div
                data-testid="map-legend"
                className="pointer-events-none absolute bottom-2 left-2 z-[1000] hidden rounded-md border border-[rgba(139,203,196,0.25)] bg-[rgba(7,24,32,0.88)] px-2.5 py-2 text-[11px] leading-snug text-[var(--fc-muted)] shadow sm:block"
              >
                {/* Swatch colours come from MARKER_COLORS, the same constants the
                    markers are drawn with, so the legend cannot describe one
                    palette while the map renders another. */}
                {mapMode === 'overview' ? (
                  <p>
                    <span className={DOT} style={{ backgroundColor: MARKER_COLORS.overview }} />
                    Cached profile position (overview)
                  </p>
                ) : (
                  <>
                    <p><span className={DOT} style={{ backgroundColor: MARKER_COLORS.selected }} />Selected profile</p>
                    <p><span className={DOT} style={{ backgroundColor: MARKER_COLORS.sameFloat }} />Same float, joined in time order</p>
                    <p><span className={DOT} style={{ backgroundColor: MARKER_COLORS.otherFloat }} />Other floats in this result</p>
                  </>
                )}
                {/* Kept to one short line: the map fit reserves a fixed
                    clearance for this box, and a taller legend would cover
                    the markers it is meant to explain. */}
                <p className="mt-0.5">Measured only at these points</p>
              </div>
            </div>
            {showGlobe && (
              <GlobeView
                mode={mapMode}
                profiles={mapProfiles}
                regionProfiles={mapBounds}
                selectedProfileId={mapMode === 'results' ? activeProfileId : null}
                onSelectProfile={onSelectProfile}
                resultKey={results ?? OVERVIEW_KEY}
                canExploreDepths={hasProfiles}
                onExploreDepths={() => onMapViewChange('depth')}
                onUseMap={() => onMapViewChange('regional')}
                searchRegion={coverage?.search_region ?? null}
              />
            )}
            {showDepth && results && (
              <DepthView
                results={results}
                requested={requested}
                visibleProfiles={visibleProfiles}
                totalCount={results.profiles.length}
                throughLabel={throughLabel}
                activeProfileId={activeProfileId}
                onSelectProfile={onSelectProfile}
                variable={depthVariable}
                onVariableChange={onDepthVariableChange}
                resultKey={results}
                onBack={() => onMapViewChange('globe')}
                onUseMap={() => onMapViewChange('regional')}
              />
            )}
          </div>
          {results && (
            <TimeNavigator
              status={results.profiles.length === 0 ? 'no_data' : 'ready'}
              steps={time.steps}
              index={time.index}
              playing={time.playing}
              visibleCount={visibleProfiles.length}
              totalCount={time.total}
              untimedCount={time.untimed.length}
              open={timeOpen}
              onOpenChange={setTimeOpen}
              onCommand={time.command}
            />
          )}
        </div>
      </div>

      {/* Measurements, below the map, in ordinary page flow ----------------- */}
      <div data-testid="measurements" className="mx-auto w-full max-w-[1200px] space-y-4 px-4 py-4">
        {status === 'loading' && !hasProfiles && (
          <div data-testid="results-loading" role="status" className="fc-panel">
            <p className="font-semibold text-[var(--fc-fg)]">Loading results…</p>
            <p className="mt-1 text-[var(--fc-muted)]">Reading the cached measurements for these filters.</p>
          </div>
        )}

        {status === 'invalid' && (
          <div data-testid="results-invalid" className="fc-panel">
            <p className="font-semibold text-[var(--fc-ochre)]">These filters cannot be used yet</p>
            <p className="mt-1 text-[var(--fc-muted)]">
              {blockedReason ?? 'Correct the highlighted fields in Filters.'}
            </p>
          </div>
        )}

        {status === 'unavailable' && (
          <div data-testid="results-unavailable" className="fc-panel">
            <p className="font-semibold text-[var(--fc-fg)]">Nothing in the dataset matches</p>
            <p className="mt-1 text-[var(--fc-muted)]">
              No cached measurement falls inside this region, date range and depth range. Nothing was
              filled in or estimated.
            </p>
          </div>
        )}

        {response && !response.executed && (
          <div className="fc-panel">
            <p className="font-semibold text-[var(--fc-ochre)]">Not run: {response.outcome.replace(/_/g, ' ')}</p>
            <p className="mt-1 text-[var(--fc-muted)]">{response.refusal?.message}</p>
          </div>
        )}

        {status === 'empty' && (
          <div data-testid="no-matching" className="fc-panel">
            <p className="font-semibold text-[var(--fc-fg)]">No measurements match</p>
            <p className="mt-1 text-[var(--fc-muted)]">
              Nothing in the cached data falls inside this region, date range and depth range. Nothing was
              filled in or estimated.
            </p>
            <button type="button" data-testid="open-assistant" onClick={onOpenAssistant} className="fc-btn mt-3 w-max">
              Ask the assistant
            </button>
          </div>
        )}

        {hasProfiles && (
          <>
            <div className="fc-panel flex flex-col overflow-hidden p-0">
              <ProfilePanel
                response={response!}
                activeProfileId={activeProfileId}
                onSelectProfile={onSelectProfile}
                mode={mode}
                woa={woa}
                visibleProfiles={visibleProfiles}
                onDiveIn={setDiveProfileId}
              />
            </div>
            <div className="fc-panel">
              <DetailsPanel
                response={response!}
                activeProfileId={activeProfileId}
                woa={woa}
                coverage={coverage}
                mode={mode}
              />
            </div>
          </>
        )}
      </div>

      {diveProfile && <DiveView p={diveProfile} onClose={() => setDiveProfileId(null)} />}
    </div>
  );
}
