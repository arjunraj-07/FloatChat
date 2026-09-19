/**
 * The assistant conversation.
 *
 * A plain list of messages with pure helpers over it, so the ordering rules
 * can be tested without a browser. The conversation lives in the explorer's
 * state, which stays mounted while another section is shown, so switching
 * sections keeps it.
 *
 * It is **not** saved to an account. Nothing here is persisted: the list lives
 * in the browser tab and is gone when it closes, and the interface says so
 * rather than implying a history that does not exist.
 *
 * Every model call is still explicit. Appending a user message does not call
 * anything; the explorer decides what to request, and a reply is matched back
 * to its pending message by id so a late answer cannot land under a newer
 * question.
 */

import type { PlanDraftResponse, PlanExplanationResponse } from './planContract.ts';

export type ChatRole = 'user' | 'assistant';

export type ChatKind =
  /** Plain words from either side. */
  | 'text'
  /** A query the planner proposed, shown as a compact card to apply. */
  | 'proposal'
  /** A grounded explanation of the results on screen, with its evidence. */
  | 'explanation'
  /** A request in flight; replaced in place when the reply arrives. */
  | 'pending'
  /** Something went wrong, said plainly. */
  | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  kind: ChatKind;
  text?: string;
  /** The draft revision a proposal was made for, so staleness is visible. */
  revision?: number;
  proposal?: PlanDraftResponse;
  explanation?: PlanExplanationResponse;
  /** The draft revision that resulted from applying this proposal. */
  appliedRevision?: number;
  /** The execution revision this explanation describes. */
  executionRevision?: number;
}

/** Offered before the first message; they only fill the composer. */
export const STARTER_QUESTIONS = [
  'Show temperature at 100 m.',
  'Show temperature and salinity from 0 to 200 m.',
  'Show salinity between 0 and 50 m.',
];

/** Ids are per-conversation and need only be unique within it. */
export function messageId(seq: number): string {
  return `m${seq}`;
}

export function appendMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return [...messages, message];
}

/**
 * Replace a pending message with its reply.
 *
 * If the pending message is gone - the conversation was cleared while the
 * request was in flight - the reply is dropped rather than appended at the
 * end, where it would answer whatever question now sits above it.
 */
export function resolvePending(
  messages: ChatMessage[],
  pendingId: string,
  reply: Omit<ChatMessage, 'id'>,
): ChatMessage[] {
  const index = messages.findIndex((m) => m.id === pendingId);
  if (index === -1) return messages;
  const next = [...messages];
  next[index] = { ...reply, id: pendingId };
  return next;
}

/** Mark one proposal as applied by recording the revision it produced. */
export function markApplied(messages: ChatMessage[], id: string, revision: number): ChatMessage[] {
  return messages.map((m) => (m.id === id ? { ...m, appliedRevision: revision } : m));
}

/** Remove one message, used when a proposal is discarded. */
export function dropMessage(messages: ChatMessage[], id: string): ChatMessage[] {
  return messages.filter((m) => m.id !== id);
}

/** True while any request is in flight, so the composer can say so. */
export function hasPending(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.kind === 'pending');
}

export type ProposalStatus =
  | 'awaiting_apply'
  | 'applied_loading'
  | 'applied_displayed'
  | 'previously_applied'
  | 'stale_unapplied'
  | 'applied_failed';

/** Compute the exact state of a proposal card against the current session. */
export function getProposalStatus(
  message: ChatMessage,
  currentRevision: number,
  isExecuting: boolean,
  hasExecutionError: boolean,
  isValidating: boolean,
  hasValidationError: boolean,
  displayedExecutionRevision?: number,
): ProposalStatus {
  if (message.appliedRevision !== undefined) {
    if (currentRevision > message.appliedRevision) return 'previously_applied';
    if (hasValidationError || hasExecutionError) return 'applied_failed';
    if (displayedExecutionRevision === message.appliedRevision && !isExecuting && !isValidating) {
      return 'applied_displayed';
    }
    return 'applied_loading';
  }
  if (message.revision !== undefined && message.revision !== currentRevision) {
    return 'stale_unapplied';
  }
  return 'awaiting_apply';
}
