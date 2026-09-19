/**
 * Draft, validation, execution and displayed results as one state machine.
 *
 * Four things are tracked separately and never conflated:
 *
 *   1. the current draft (`form`, `plan`, `revision`)
 *   2. the latest validation, tagged with the revision it was asked about
 *   3. the last execution, tagged the same way
 *   4. what is on screen, which is whatever the last execution returned
 *
 * Every edit increments `revision`, which invalidates the previous validation
 * by construction: `currentValidation` only returns a result whose revision
 * still matches. Late replies for superseded revisions are dropped, so a slow
 * response cannot overwrite a newer one.
 *
 * Results keep the plan the server executed, so charts are always labelled by
 * what produced them and never by a draft that has since been edited.
 */

import {
  type PlanDraftResponse,
  type PlanExecutionResponse,
  type PlanExplanationResponse,
  type PlanValidationResponse,
  type QueryPlanRequest,
  isExecutable,
} from './planContract.ts';
import {
  type DraftForm,
  type FormIssue,
  applyPlanToForm,
  formToPlan,
} from './draftPlan.ts';

export interface RevisionTagged<T> {
  revision: number;
  value: T;
}

export interface SessionState {
  revision: number;
  form: DraftForm;
  plan: QueryPlanRequest | null;
  formIssues: FormIssue[];
  validation: RevisionTagged<PlanValidationResponse> | null;
  validating: boolean;
  validationError: string | null;
  execution: RevisionTagged<PlanExecutionResponse> | null;
  executing: boolean;
  executionError: string | null;
  /** The plan that produced `execution`, in the shape it was submitted.
   *
   * Snapshotted because the draft may be edited afterwards, and because the
   * *normalized* plan the server returns is not a valid request: it carries
   * normalization fields the request schema refuses. Anything asking the
   * backend about these results must send this. */
  executedPlan: RevisionTagged<QueryPlanRequest> | null;
  /** An explanation of the displayed results, tagged with the revision of the
   * execution it describes — not the draft. An explanation belongs to one
   * executed result, so when a new result arrives the old explanation is
   * dropped rather than left to look as though it described the new one. */
  explanation: RevisionTagged<PlanExplanationResponse> | null;
  explaining: boolean;
  explanationError: string | null;
  /** A natural-language proposal, tagged with the draft revision it was asked
   * about. It is never applied automatically — the user accepts it explicitly,
   * so a reply that arrives after further manual editing cannot overwrite that
   * newer work. */
  proposal: RevisionTagged<PlanDraftResponse> | null;
  drafting: boolean;
  draftError: string | null;
  /** The draft revision produced by accepting a proposal, so an accepted
   * proposal can be told apart from later manual edits. */
  acceptedRevision: number | null;
}

export type SessionAction =
  | { type: 'edit'; form: DraftForm }
  | { type: 'validation:start'; revision: number }
  | { type: 'validation:result'; revision: number; result: PlanValidationResponse }
  | { type: 'validation:error'; revision: number; message: string }
  | { type: 'execution:start'; revision: number }
  | { type: 'execution:result'; revision: number; response: PlanExecutionResponse }
  | { type: 'execution:error'; revision: number; message: string }
  | { type: 'explain:start'; revision: number }
  | { type: 'explain:result'; revision: number; response: PlanExplanationResponse }
  | { type: 'explain:error'; revision: number; message: string }
  | { type: 'explain:clear' }
  | { type: 'draft:start'; revision: number }
  | { type: 'draft:result'; revision: number; response: PlanDraftResponse }
  | { type: 'draft:error'; revision: number; message: string }
  | { type: 'draft:accept' }
  | { type: 'draft:apply'; plan: QueryPlanRequest }
  | { type: 'draft:dismiss' };

export function createSession(form: DraftForm): SessionState {
  const { plan, issues } = formToPlan(form);
  return {
    revision: 1,
    form,
    plan,
    formIssues: issues,
    validation: null,
    validating: false,
    validationError: null,
    execution: null,
    executing: false,
    executionError: null,
    executedPlan: null,
    explanation: null,
    explaining: false,
    explanationError: null,
    proposal: null,
    drafting: false,
    draftError: null,
    acceptedRevision: null,
  };
}

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case 'edit': {
      const { plan, issues } = formToPlan(action.form);
      // The revision advances, so any validation in flight for the old
      // revision becomes stale and its reply will be ignored on arrival.
      return {
        ...state,
        revision: state.revision + 1,
        form: action.form,
        plan,
        formIssues: issues,
        validationError: null,
      };
    }

    case 'validation:start':
      if (action.revision !== state.revision) return state;
      return { ...state, validating: true, validationError: null };

    case 'validation:result':
      if (action.revision !== state.revision) return state; // stale reply
      return {
        ...state,
        validating: false,
        validationError: null,
        validation: { revision: action.revision, value: action.result },
      };

    case 'validation:error':
      if (action.revision !== state.revision) return state;
      return { ...state, validating: false, validationError: action.message };

    case 'execution:start':
      // Guards against a double click launching two identical runs.
      if (state.executing) return state;
      if (action.revision !== state.revision) return state;
      return { ...state, executing: true, executionError: null };

    case 'execution:result':
      if (action.revision !== state.revision) {
        // A reply for a superseded draft. The result is discarded - it
        // describes filters nobody is looking at - but the request has ended,
        // so the screen must stop saying it is loading. Leaving `executing`
        // set here strands it: nothing else clears it, `canExecute` stays
        // false, and automatic results never run again.
        return { ...state, executing: false };
      }
      return {
        ...state,
        executing: false,
        executionError: null,
        execution: { revision: action.revision, value: action.response },
        // This reply matched the current revision, so `state.plan` is still
        // exactly what was executed: a later edit would have advanced the
        // revision and this reply would have been dropped above.
        executedPlan: state.plan ? { revision: action.revision, value: state.plan } : null,
        // These are different results, so any explanation of the previous
        // ones is discarded rather than left standing beside them.
        explanation: null,
        explaining: false,
        explanationError: null,
      };

    case 'execution:error':
      // Same for a failure: the request is over either way.
      if (action.revision !== state.revision) return { ...state, executing: false };
      return { ...state, executing: false, executionError: action.message };

    case 'explain:start':
      // Explaining is always an explicit action, and never two at once.
      if (state.explaining) return state;
      if (!state.execution || state.execution.revision !== action.revision) return state;
      return { ...state, explaining: true, explanationError: null };

    case 'explain:result':
      // Tagged with the execution it described. If a different result has been
      // displayed since, this reply is about results nobody is looking at, so
      // it is dropped rather than shown against the new ones.
      if (!state.execution || state.execution.revision !== action.revision) return state;
      return {
        ...state,
        explaining: false,
        explanationError: null,
        explanation: { revision: action.revision, value: action.response },
      };

    case 'explain:error':
      if (!state.execution || state.execution.revision !== action.revision) return state;
      return { ...state, explaining: false, explanationError: action.message };

    case 'explain:clear':
      return { ...state, explanation: null, explanationError: null };

    case 'draft:start':
      if (state.drafting) return state;
      return { ...state, drafting: true, draftError: null };

    case 'draft:result':
      // Stored with the revision it described, whatever the current revision
      // is. A proposal is never applied on arrival, so a late reply cannot
      // clobber manual edits made while it was in flight; it is offered
      // separately and labelled as based on an earlier draft.
      return {
        ...state,
        drafting: false,
        draftError: null,
        proposal: { revision: action.revision, value: action.response },
      };

    case 'draft:error':
      return { ...state, drafting: false, draftError: action.message };

    case 'draft:accept': {
      const proposed = state.proposal?.value.proposed_plan;
      if (!proposed) return state;
      // Accepting is an ordinary edit: the revision advances and the proposal
      // flows through the same validation as any manual change.
      const form = applyPlanToForm(state.form, proposed);
      const { plan, issues } = formToPlan(form);
      return {
        ...state,
        revision: state.revision + 1,
        form,
        plan,
        formIssues: issues,
        validationError: null,
        proposal: null,
        acceptedRevision: state.revision + 1,
      };
    }

    case 'draft:apply': {
      // Applying a proposal that arrived in the conversation. The plan is
      // passed in rather than read from one shared slot, so a thread can hold
      // several proposals without the newest deciding what the others mean.
      // Otherwise this is an ordinary edit: the revision advances and it
      // validates like any manual change, which is what then runs it.
      const form = applyPlanToForm(state.form, action.plan);
      const { plan, issues } = formToPlan(form);
      return {
        ...state,
        revision: state.revision + 1,
        form,
        plan,
        formIssues: issues,
        validationError: null,
        acceptedRevision: state.revision + 1,
      };
    }

    case 'draft:dismiss':
      return { ...state, proposal: null, draftError: null };

    default:
      return state;
  }
}

/** The validation for the draft as it stands now, or null if it is outdated. */
export function currentValidation(
  state: SessionState,
): PlanValidationResponse | null {
  if (!state.validation) return null;
  return state.validation.revision === state.revision
    ? state.validation.value
    : null;
}

/**
 * Whether Run may fire.
 *
 * Requires a validation *for the current revision* — `isExecutable` alone is
 * not enough, because it cannot tell which draft a result described.
 */
export function canExecute(state: SessionState): boolean {
  if (state.executing || state.validating) return false;
  if (state.formIssues.length > 0 || !state.plan) return false;
  const validation = currentValidation(state);
  return validation !== null && isExecutable(validation);
}

/** Why Run is unavailable, for a tooltip or inline note. */
export function executionBlockedReason(state: SessionState): string | null {
  if (canExecute(state)) return null;
  if (state.executing) return 'A run is already in progress.';
  if (state.formIssues.length > 0 || !state.plan) {
    return 'Complete the highlighted fields before running.';
  }
  if (state.validating) return 'Checking the draft…';
  const validation = currentValidation(state);
  if (!validation) return 'The draft changed. Waiting for a fresh check…';
  switch (validation.outcome) {
    case 'invalid':
      return 'The draft has errors that must be fixed before it can run.';
    case 'unsupported':
      return 'The draft requests something this build does not implement.';
    case 'valid_no_data':
      return 'Nothing in the dataset matches this draft, so there is nothing to run.';
    default:
      return 'The draft cannot be run yet.';
  }
}

/**
 * True when a proposal describes a draft the user has since edited.
 *
 * The proposal is still offered — it is not silently thrown away — but it must
 * be labelled, because accepting it will overwrite the newer manual work.
 */
export function proposalIsStale(state: SessionState): boolean {
  return state.proposal !== null && state.proposal.revision !== state.revision;
}

/** A proposal can only be accepted when it actually carries a plan. */
export function canAcceptProposal(state: SessionState): boolean {
  return Boolean(state.proposal?.value.proposed_plan);
}

/** True when displayed results came from a draft that has since been edited. */
export function resultsAreStale(state: SessionState): boolean {
  return state.execution !== null && state.execution.revision !== state.revision;
}

/**
 * The explanation of the results currently on screen, or null.
 *
 * Null once a different result has been executed: an explanation describes one
 * specific set of measurements, and showing it beside any others would
 * misrepresent what it was built from.
 */
export function currentExplanation(
  state: SessionState,
): PlanExplanationResponse | null {
  if (!state.explanation || !state.execution) return null;
  return state.explanation.revision === state.execution.revision
    ? state.explanation.value
    : null;
}

/** The results on screen, if any, together with whether they are current. */
export function displayedResults(state: SessionState): {
  response: PlanExecutionResponse;
  stale: boolean;
} | null {
  if (!state.execution) return null;
  return {
    response: state.execution.value,
    stale: state.execution.revision !== state.revision,
  };
}
