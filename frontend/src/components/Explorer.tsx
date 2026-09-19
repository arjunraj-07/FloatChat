'use client';

/**
 * FloatChat's shell: shared state above four workspaces.
 *
 * Map Explorer, AI Assistant, Compare and About Data are views over one set
 * of state kept here: the query session (draft, validation, execution and
 * displayed results; see `querySession.ts`), the question and proposal, the
 * selected profile, the time navigator, Compare choices and the
 * Student/Scientific preference. Switching sections therefore never loses or
 * resets any of them, and navigating alone never calls the model or runs a
 * query. Map Explorer stays mounted while hidden, so the map keeps its view;
 * the other sections render when opened.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

import {
  type CapabilityReport,
  type NlStatus,
  type Variable,
  draftPlanFromQuestion,
  executePlan,
  explainResult,
  fetchCapabilities,
  fetchNlStatus,
  validatePlan,
} from '@/lib/planContract.ts';
import { type DraftForm, createDefaultForm } from '@/lib/draftPlan.ts';
import {
  type ChatMessage,
  appendMessage,
  dropMessage,
  markApplied,
  messageId,
  resolvePending,
} from '@/lib/chat.ts';
import {
  canExecute,
  createSession,
  currentValidation,
  displayedResults,
  executionBlockedReason,
  sessionReducer,
} from '@/lib/querySession.ts';
import {
  type CompareSelection,
  type CoverageInfo,
  type ViewMode,
  type WoaMatchResponse,
  comparisonAtTime,
  defaultFormFor,
  groupByFloat,
} from '@/lib/explorerModel.ts';
import { activeAtTime, formatStepTime } from '@/lib/timeNavigator.ts';
import {
  DEFAULT_SECTION,
  type MapView,
  type SectionId,
  pausesPlayback,
} from '@/lib/navigation.ts';
import {
  type SessionState,
  defaultViewForRole,
  fetchSession,
  signOut,
} from '@/lib/auth.ts';

import AboutData from './AboutData';
import AuthScreen from './AuthScreen';
import ChatWorkspace from './ChatWorkspace';
import type { MapProfile } from './Map';
import NavBar from './NavBar';
import { useTimeNavigator } from './useTimeNavigator';

const MapExplorer = dynamic(() => import('./MapExplorer'), { ssr: false });
const CompareWorkspace = dynamic(() => import('./CompareWorkspace'), { ssr: false });
// The introduction draws with WebGL, so it is client-only like the 3D views.
const IntroScene = dynamic(() => import('./IntroScene'), { ssr: false });

const API_BASE = 'http://localhost:8000/api';
const VALIDATE_DEBOUNCE_MS = 400;
/** Remembers that this browser has already seen the introduction. */
const INTRO_SEEN_KEY = 'floatchat.intro.seen';

interface OverviewFloat {
  platform: string;
  profiles: { profile_id: string; latitude: number; longitude: number; time: string; data_mode: string }[];
}

export default function Explorer() {
  const [coverage, setCoverage] = useState<CoverageInfo | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(null);
  const [nlStatus, setNlStatus] = useState<NlStatus | null>(null);
  const [overview, setOverview] = useState<MapProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [woaMatch, setWoaMatch] = useState<{ profileId: string; result: WoaMatchResponse } | null>(null);
  const [mode, setMode] = useState<ViewMode>('student');
  // The assistant conversation. It lives here, so switching sections keeps it,
  // and it lives *only* here: nothing is written to an account, and the
  // composer says so rather than implying a saved history.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // The composer's half-typed text lives here too: the assistant section
  // unmounts when another is shown, and an unfinished question should survive
  // that exactly as the conversation does.
  const [chatDraft, setChatDraft] = useState('');
  const messageSeq = useRef(0);
  const nextMessageId = () => messageId(++messageSeq.current);
  const [compareSelection, setCompareSelection] = useState<CompareSelection>({ a: null, b: null });
  const [compareVariable, setCompareVariable] = useState<Variable>('temp');
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Map Explorer's visualization; display state only, like the section.
  const [mapView, setMapView] = useState<MapView>('regional');
  const [depthVariable, setDepthVariable] = useState<Variable>('temp');
  // The introduction is an overlay above the workspace, which stays mounted
  // underneath. It starts closed so the server and client agree, then opens on
  // a first visit; `?intro=0` skips it and `?intro=1` always plays it.
  const [showIntro, setShowIntro] = useState(false);
  // Account state. `session` is null until the server has been asked, so the
  // app never flashes a sign-in screen at someone who is already signed in.
  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  // Chose to explore without an account. Public exploration is a first-class
  // path, not a degraded one: everything except the AI Assistant works.
  const [publicMode, setPublicMode] = useState(false);

  const [state, dispatch] = useReducer(sessionReducer, createDefaultForm(), createSession);

  const validation = currentValidation(state);
  const shown = displayedResults(state);
  const blockedReason = executionBlockedReason(state);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('intro');
    let play: boolean;
    if (requested === '0' || requested === '1') {
      play = requested === '1';
    } else {
      let seen = false;
      try {
        seen = Boolean(window.localStorage.getItem(INTRO_SEEN_KEY));
      } catch {
        // Storage can be unavailable; then the introduction simply plays.
      }
      play = !seen;
    }
    // The decision reads the URL and localStorage, which do not exist while
    // the page is rendered on the server, so it is made once here on mount
    // rather than in the initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (play) setShowIntro(true);
  }, []);

  const dismissIntro = () => {
    setShowIntro(false);
    try {
      window.localStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      // Not remembering it is harmless.
    }
  };

  // Session restoration. The session itself is an HttpOnly cookie the browser
  // holds; this only asks the server who that cookie belongs to.
  useEffect(() => {
    let cancelled = false;
    fetchSession().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSession(result.session);
        if (result.session.authenticated && result.session.user) {
          // The role chooses the opening presentation, and nothing else.
          setMode(defaultViewForRole(result.session.user.role));
        }
      }
      setSessionChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const account = session?.authenticated ? session.user : null;

  const onAuthenticated = (next: SessionState) => {
    setSession(next);
    setPublicMode(false);
    if (next.user) setMode(defaultViewForRole(next.user.role));
    // Both roles land in Map Explorer; the role decides the presentation.
    setSection('map');
    focusHeading.current = true;
  };

  const onSignOut = () => {
    signOut().then((result) => {
      if (result.ok) setSession(result.session);
      else setSession(null);
      setPublicMode(false);
    });
  };

  // Reference data, fetched once. Counts and extents always come from here.
  useEffect(() => {
    fetch(`${API_BASE}/coverage`)
      .then((r) => r.json())
      .then(setCoverage)
      .catch(() => setCoverage(null));
    fetch(`${API_BASE}/floats`)
      .then((r) => r.json())
      .then((floats: OverviewFloat[]) =>
        setOverview(floats.flatMap((f) => f.profiles.map((p) => ({ ...p, platform: f.platform })))),
      )
      .catch(() => setOverview([]));
    fetchCapabilities(API_BASE).then(setCapabilities).catch(() => setCapabilities(null));
    fetchNlStatus(API_BASE).then(setNlStatus).catch(() => setNlStatus(null));
  }, []);

  // Debounced validation; stale replies are dropped by the reducer.
  const planJson = state.plan ? JSON.stringify(state.plan) : null;
  useEffect(() => {
    if (!planJson) return;
    const revision = state.revision;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      dispatch({ type: 'validation:start', revision });
      validatePlan(JSON.parse(planJson), API_BASE, controller.signal)
        .then((result) => dispatch({ type: 'validation:result', revision, result }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          dispatch({
            type: 'validation:error',
            revision,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [planJson, state.revision]);

  const onFormChange = (changes: Partial<DraftForm>) =>
    dispatch({ type: 'edit', form: { ...state.form, ...changes } });

  // The first screen shows results without being asked for them. The opening
  // query is derived from the coverage the backend reports, so it always
  // describes the data actually loaded rather than remembered numbers. It is
  // applied once; every later change is the user's.
  //
  // A different dataset makes everything on screen incompatible - profile ids,
  // selections, and any proposal written against the old coverage - so those
  // are cleared rather than reinterpreted, and the default is derived again
  // from the new coverage. Nothing is applied or asked on the user's behalf:
  // clearing a proposal is not accepting it, and no model is called.
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!coverage) return;
    const snapshot = coverage.snapshot?.snapshot_id ?? 'unknown';
    const previous = appliedFor.current;
    if (previous === snapshot) return;
    appliedFor.current = snapshot;
    if (previous !== null) {
      setSelectedProfileId(null);
      setCompareSelection({ a: null, b: null });
      setMessages([]);
      setChatDraft('');
      dispatch({ type: 'explain:clear' });
    }
    // The edit advances the revision, so validation and the automatic run
    // follow from it exactly as any other filter change would.
    dispatch({ type: 'edit', form: defaultFormFor(state.form, coverage) });
    // `state.form` is read once per dataset, behind the ref above; re-running
    // on every form edit would undo the user's own filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage]);

  // Sending a message is the explicit model call. The proposal it returns is
  // tagged with the revision it was made for and never applied on its own; a
  // reply is written back over its own pending message, so an answer that
  // arrives late cannot appear under a question it never saw.
  const draftingRef = useRef(false);
  const send = (question: string) => {
    const text = question.trim();
    if (!text || draftingRef.current) return;
    const revision = state.revision;
    const userId = nextMessageId();
    const pendingId = nextMessageId();
    setMessages((current) =>
      appendMessage(appendMessage(current, { id: userId, role: 'user', kind: 'text', text }), {
        id: pendingId,
        role: 'assistant',
        kind: 'pending',
        text: 'Reading your question…',
      }),
    );
    draftingRef.current = true;
    dispatch({ type: 'draft:start', revision });
    draftPlanFromQuestion(text, state.plan, revision, API_BASE)
      .then((response) => {
        dispatch({ type: 'draft:result', revision, response });
        setMessages((current) =>
          resolvePending(current, pendingId, {
            role: 'assistant',
            kind: 'proposal',
            revision,
            proposal: response,
          }),
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: 'draft:error', revision, message });
        setMessages((current) =>
          resolvePending(current, pendingId, {
            role: 'assistant',
            kind: 'error',
            text: `Could not reach the drafting service: ${message}. The filters are unchanged.`,
          }),
        );
      })
      .finally(() => {
        draftingRef.current = false;
      });
  };

  /** Applying is the explicit step; the results then follow from the filters. */
  const applyProposal = (id: string) => {
    const message = messages.find((m) => m.id === id);
    if (!message || message.appliedRevision !== undefined) return;
    const plan = message.proposal?.proposed_plan;
    if (!plan) return;
    const action = { type: 'draft:apply' as const, plan };
    const nextState = sessionReducer(state, action);
    dispatch(action);
    setMessages((current) => markApplied(current, id, nextState.revision));
  };

  const discardProposal = (id: string) => setMessages((current) => dropMessage(current, id));

  const response = shown?.response ?? null;
  const results = response?.executed ? response.results : null;

  // Time navigation is display state over this executed result: it filters
  // what is shown, and never edits the draft or runs a query.
  const time = useTimeNavigator(response?.executed ? response : null, setSelectedProfileId);
  const visibleProfiles = time.visible;

  // Selection is resolved at render time against the profiles visible at the
  // selected time, so neither a new result nor a time step leaves a dangling
  // selection.
  const resultIds = results ? results.profiles.map((p) => p.profile_id) : [];
  const orderedIds = groupByFloat(visibleProfiles).flatMap((g) => g.profiles.map((p) => p.profile_id));
  const activeProfileId = activeAtTime(selectedProfileId, orderedIds, time.step);
  const comparison = comparisonAtTime(compareSelection, resultIds, orderedIds, activeProfileId);

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    fetch(`${API_BASE}/woa_match/${activeProfileId}`)
      .then((r) => r.json())
      .then((data: WoaMatchResponse) => {
        if (!cancelled) setWoaMatch({ profileId: activeProfileId, result: data });
      })
      .catch(() => {
        if (!cancelled) setWoaMatch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId]);
  const woa = woaMatch && woaMatch.profileId === activeProfileId ? woaMatch.result : null;

  // Navigation ---------------------------------------------------------------
  const focusHeading = useRef(false);
  const navigate = (next: SectionId) => {
    // Playback belongs to Map Explorer; leaving pauses it at the current time.
    if (pausesPlayback(section, next) && time.playing) time.command({ type: 'pause' });
    focusHeading.current = next !== section;
    setSection(next);
  };
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    // Move focus to the new section's heading. Compare and Map Explorer load
    // on first use, so the heading may appear a few frames later.
    let frame = 0;
    let attempts = 0;
    const focus = () => {
      const heading = document.getElementById(`heading-${section}`);
      if (heading) heading.focus();
      else if (attempts++ < 90) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [section]);

  // Explicit execution. From the assistant, a successful run opens the map.
  const executingRef = useRef(false);
  const run = (origin: SectionId) => {
    if (!canExecute(state) || !state.plan || executingRef.current) return;
    const revision = state.revision;
    executingRef.current = true;
    dispatch({ type: 'execution:start', revision });
    executePlan(state.plan, API_BASE)
      .then((result) => {
        dispatch({ type: 'execution:result', revision, response: result });
        if (origin !== 'map' && result.executed) {
          focusHeading.current = true;
          setSection('map');
        }
      })
      .catch((error: unknown) =>
        dispatch({
          type: 'execution:error',
          revision,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => {
        executingRef.current = false;
      });
  };

  // Results follow the filters, so there is no button to press. A draft runs
  // when - and only when - it has validated for the current revision and can
  // run. The ref makes that at most one request per revision, so a rapid burst
  // of edits produces one run of the last one; the reducer drops replies for
  // revisions that have been superseded. Selecting a marker, moving the globe
  // and changing section do not touch the revision, so none of them re-runs.
  const autoRequested = useRef<number | null>(null);
  useEffect(() => {
    if (!canExecute(state)) return;
    if (state.execution?.revision === state.revision) return;
    if (autoRequested.current === state.revision) return;
    autoRequested.current = state.revision;
    run('map');
    // `run` is rebuilt every render; the guard above is the real one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.revision, state.validating, state.executing, validation]);

  // Explaining the displayed results. Always explicit, never automatic, and
  // always about one executed result: the request carries the plan the server
  // ran and the version of the data it ran against, so a reply that arrives
  // after different results are shown is discarded by the reducer.
  const explainingRef = useRef(false);
  const explain = () => {
    const executed = state.execution;
    if (!executed || !executed.value.executed || explainingRef.current) return;
    // The plan as submitted, snapshotted when these results arrived. The
    // normalized plan in the response is not a valid request.
    const executedPlan = state.executedPlan?.value;
    if (!executedPlan) return;
    const revision = executed.revision;
    const datasetVersion = executed.value.dataset?.raw_file_checksum ?? null;
    explainingRef.current = true;
    dispatch({ type: 'explain:start', revision });
    const pendingId = nextMessageId();
    setMessages((current) =>
      appendMessage(current, {
        id: pendingId,
        role: 'assistant',
        kind: 'pending',
        text: 'Reading these measurements…',
        executionRevision: revision,
      }),
    );
    explainResult(executedPlan, datasetVersion, mode, API_BASE)
      .then((response) => {
        // The reducer still sees this, so its binding to one executed result
        // - and its dropping of superseded replies - keeps working.
        dispatch({ type: 'explain:result', revision, response });
        setMessages((current) =>
          resolvePending(current, pendingId, {
            role: 'assistant',
            kind: 'explanation',
            explanation: response,
            executionRevision: revision,
          }),
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: 'explain:error', revision, message });
        setMessages((current) =>
          resolvePending(current, pendingId, {
            role: 'assistant',
            kind: 'error',
            text: `Could not explain these results: ${message}`,
            executionRevision: revision,
          }),
        );
      })
      .finally(() => {
        explainingRef.current = false;
      });
  };

  const timeRestricted = time.steps.length > 0 && time.index < time.steps.length - 1;
  const throughLabel = time.step ? formatStepTime(time.step.instant) : null;

  // The sign-in screen is shown once the server has answered and nobody is
  // signed in, unless public exploration was chosen.
  const showAuth = sessionChecked && !account && !publicMode;
  if (showAuth) {
    return (
      <AuthScreen
        onAuthenticated={onAuthenticated}
        onContinuePublic={() => setPublicMode(true)}
        unavailable={session?.unavailable ?? null}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--page)] text-[var(--ink)]">
      {showIntro && (
        <IntroScene
          markers={overview}
          searchRegion={coverage?.search_region ?? null}
          onSkip={dismissIntro}
          onOpenAssistant={() => {
            dismissIntro();
            navigate('assistant');
          }}
        />
      )}

      <NavBar
        section={section}
        onNavigate={navigate}
        mode={mode}
        onModeChange={setMode}
        onOpenIntro={() => setShowIntro(true)}
        account={account}
        onSignOut={onSignOut}
        onSignIn={() => setPublicMode(false)}
      />

      <div className="relative min-h-0 flex-1" inert={showIntro}>
        {/* Explore scrolls as one page: the map fills the first screen and
            the measurements follow underneath it. */}
        <div hidden={section !== 'map'} className="h-full overflow-y-auto">
          <MapExplorer
            mode={mode}
            coverage={coverage}
            capabilities={capabilities}
            session={state}
            validation={validation}
            blockedReason={blockedReason}
            response={response}
            stale={Boolean(shown?.stale)}
            overview={overview}
            time={time}
            visibleProfiles={visibleProfiles}
            throughLabel={throughLabel}
            activeProfileId={activeProfileId}
            onSelectProfile={setSelectedProfileId}
            woa={woa}
            drawerOpen={drawerOpen}
            onDrawerOpenChange={setDrawerOpen}
            mapView={mapView}
            onMapViewChange={setMapView}
            depthVariable={depthVariable}
            onDepthVariableChange={setDepthVariable}
            onFormChange={onFormChange}
            onOpenAssistant={() => navigate('assistant')}
          />
        </div>

        {section === 'assistant' && (
          // The thread scrolls inside this pane so the composer stays put;
          // that is one deliberate scroller, not a pane fighting the page.
          <div className="h-full overflow-hidden">
            <ChatWorkspace
              authenticated={Boolean(account)}
              onSignIn={() => setPublicMode(false)}
              nlStatus={nlStatus}
              mode={mode}
              messages={messages}
              session={state}
              draft={chatDraft}
              onDraftChange={setChatDraft}
              canExplain={Boolean(state.execution?.value.executed && state.executedPlan)}
              onSend={send}
              onExplain={explain}
              onApply={applyProposal}
              onDiscard={discardProposal}
              onAdjustFilters={() => {
                setDrawerOpen(true);
                navigate('map');
              }}
            />
          </div>
        )}

        {section === 'compare' && (
          <div className="h-full overflow-y-auto">
            <CompareWorkspace
              response={response}
              mode={mode}
              visibleProfiles={visibleProfiles}
              compare={comparison.selection}
              compareHidden={comparison.hidden}
              // A side shown as unavailable keeps its stored choice, so it
              // returns when the time includes it again.
              onCompareChange={(next) =>
                setCompareSelection((previous) => ({ a: next.a ?? previous.a, b: next.b ?? previous.b }))
              }
              compareVariable={compareVariable}
              onCompareVariableChange={setCompareVariable}
              timeRestricted={timeRestricted}
              throughLabel={throughLabel}
              totalCount={time.total}
              onViewAllTimes={() => time.command({ type: 'go', index: time.steps.length - 1 }, { select: false })}
              onOpenMap={() => navigate('map')}
            />
          </div>
        )}

        {section === 'about' && (
          <div className="h-full overflow-y-auto">
            <AboutData coverage={coverage} capabilities={capabilities} response={response} mode={mode} />
          </div>
        )}
      </div>
    </div>
  );
}
