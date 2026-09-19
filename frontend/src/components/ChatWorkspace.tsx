'use client';

/**
 * The assistant, as a conversation.
 *
 * A scrollable thread with a composer at the bottom. What the assistant can do
 * is unchanged: it proposes query settings through the existing planner, and
 * explains results the backend has already computed. It never produces a
 * measurement, and every model call is an explicit action - sending a message,
 * or asking for an explanation.
 *
 * A proposal appears as a compact card in the thread with one Apply action;
 * applying fills the filters, and the results follow from them. An explanation
 * appears as an assistant message with its evidence behind a disclosure.
 *
 * The conversation lives in this browser tab only. It is not saved to an
 * account, and the thread says so rather than implying otherwise.
 */

import { useEffect, useRef } from 'react';

import type { NlStatus } from '@/lib/planContract.ts';
import { type ChatMessage, STARTER_QUESTIONS, getProposalStatus } from '@/lib/chat.ts';
import type { ViewMode } from '@/lib/explorerModel.ts';
import type { SessionState } from '@/lib/querySession.ts';
import ExplanationPanel from './ExplanationPanel';
import ProposalCard from './ProposalCard';

interface Props {
  /** Drafting and explaining call a paid model, so both need an account. */
  authenticated: boolean;
  onSignIn: () => void;
  nlStatus: NlStatus | null;
  mode: ViewMode;
  messages: ChatMessage[];
  /** The half-typed message. Held by the explorer, not here, so an unfinished
   * question survives switching sections like the conversation does. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** The full session state to check validation and execution accurately. */
  session: SessionState;
  /** True when results are on screen and can be explained. */
  canExplain: boolean;
  onSend: (question: string) => void;
  onExplain: () => void;
  onApply: (messageId: string) => void;
  onDiscard: (messageId: string) => void;
  onAdjustFilters: () => void;
}

export default function ChatWorkspace(props: Props) {
  const draft = props.draft;
  const setDraft = props.onDraftChange;
  const threadEnd = useRef<HTMLDivElement>(null);
  const configured = props.nlStatus?.configured === true;
  const limit = props.nlStatus?.max_question_chars ?? 600;
  const tooLong = draft.length > limit;
  const busy = props.messages.some((m) => m.kind === 'pending');
  const canSend = configured && !busy && draft.trim().length > 0 && !tooLong;

  // Follow the conversation as it grows, without moving the whole page.
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [props.messages.length]);

  if (!props.authenticated) {
    return (
      <div data-testid="ws-assistant" className="mx-auto flex h-full w-full max-w-[760px] flex-col px-5 py-8">
        <section data-testid="assistant-requires-account" className="card p-6">
          <h2 className="text-base font-semibold text-[var(--ink)]">Sign in to use the AI Assistant</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Asking a question and explaining results both send a request to a language model, which costs
            money per request. Everything else — the map, the measurements and Compare — works without an
            account.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" data-testid="assistant-sign-in" onClick={props.onSignIn} className="button button-primary">
              Sign in
            </button>
            <button type="button" data-testid="assistant-use-filters" onClick={props.onAdjustFilters} className="button button-outline">
              Use the filters instead
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div data-testid="ws-assistant" className="mx-auto flex h-full w-full max-w-[760px] flex-col px-4 py-4">
      <h1 id="heading-assistant" tabIndex={-1} className="sr-only">
        Assistant
      </h1>

      {/* Conversation ---------------------------------------------------- */}
      <div
        data-testid="chat-thread"
        role="log"
        aria-label="Conversation with the assistant"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2"
      >
        {props.messages.length === 0 && (
          <div data-testid="chat-empty" className="space-y-3 py-6">
            <p className="text-sm text-[var(--muted)]">
              Ask for the measurements you want, and I will propose query settings for you to apply. I do
              not calculate values — every number comes from the stored measurements.
            </p>
            <div>
              <span className="card-kicker">Try one of these</span>
              <ul className="example-list mt-1 border-t border-[var(--divider)]">
                {STARTER_QUESTIONS.map((question, index) => (
                  <li key={question}>
                    <button
                      type="button"
                      data-testid={`example-${index}`}
                      disabled={!configured}
                      onClick={() => setDraft(question)}
                      className="disabled:opacity-50"
                    >
                      <span className="mono text-[11px] text-[var(--muted)]">{String(index + 1).padStart(2, '0')}</span>
                      <span className="text-sm">{question}</span>
                      <span aria-hidden className="text-[var(--teal)]">→</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {props.messages.map((message) => {
          if (message.role === 'user') {
            return (
              <div key={message.id} data-testid="chat-user" className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--mineral)] px-3.5 py-2 text-sm text-[var(--teal-deep)]">
                  {message.text}
                </p>
              </div>
            );
          }

          if (message.kind === 'pending') {
            return (
              <div key={message.id} data-testid="chat-pending" role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[var(--teal)]" />
                {message.text ?? 'Working…'}
              </div>
            );
          }

          if (message.kind === 'error') {
            return (
              <p key={message.id} data-testid="chat-error" className="text-sm text-[var(--coral)]">
                {message.text}
              </p>
            );
          }

          if (message.kind === 'proposal' && message.proposal) {
            const hasValidationError =
              props.session.validationError !== null ||
              (props.session.validation?.revision === message.appliedRevision &&
                props.session.validation?.value.outcome !== 'valid' &&
                props.session.validation?.value.outcome !== 'valid_partial_coverage');
            const hasExecutionError =
              props.session.executionError !== null ||
              (props.session.execution?.revision === message.appliedRevision &&
                !props.session.execution?.value.executed);
            
            const status = getProposalStatus(
              message,
              props.session.revision,
              props.session.executing,
              hasExecutionError,
              props.session.validating,
              hasValidationError,
              props.session.execution?.revision
            );

            return (
              <div key={message.id} data-testid="chat-proposal">
                <ProposalCard
                  proposal={message.proposal}
                  status={status}
                  draftError={null}
                  mode={props.mode}
                  onAccept={() => props.onApply(message.id)}
                  onDismiss={() => props.onDiscard(message.id)}
                />
              </div>
            );
          }

          if (message.kind === 'explanation' && message.explanation) {
            // explanation describes the execution it was generated for
            const describesCurrentExecution =
              props.session.execution?.revision === message.executionRevision;
            
            return (
              <div key={message.id} data-testid="chat-explanation">
                <ExplanationPanel
                  explanation={message.explanation}
                  describesCurrentExecution={describesCurrentExecution}
                  mode={props.mode}
                />
              </div>
            );
          }

          return (
            <p key={message.id} data-testid="chat-assistant" className="max-w-[85%] text-sm text-[var(--ink)]">
              {message.text}
            </p>
          );
        })}
        <div ref={threadEnd} />
      </div>

      {/* Composer -------------------------------------------------------- */}
      <form
        className="shrink-0 space-y-2 border-t border-[var(--divider)] pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSend) return;
          props.onSend(draft.trim());
          setDraft('');
        }}
      >
        <div className="flex items-end gap-2">
          <label htmlFor="ask-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="ask-input"
            data-testid="ask-input"
            rows={1}
            value={draft}
            disabled={!configured}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (canSend) {
                  props.onSend(draft.trim());
                  setDraft('');
                }
              }
            }}
            placeholder={
              configured
                ? 'Ask for the data you want…'
                : 'The assistant is not configured on this server. The filters still work.'
            }
            className="field-input max-h-32 min-h-[42px] min-w-0 flex-1 resize-y py-2 disabled:bg-[var(--surface-quiet)]"
          />
          <button
            type="submit"
            data-testid="ask-button"
            disabled={!canSend}
            className="button button-primary shrink-0"
          >
            Send
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="explain-run"
            disabled={!props.canExplain || busy}
            onClick={props.onExplain}
            title={props.canExplain ? undefined : 'Show some results first'}
            className="button button-outline button-small"
          >
            Explain these results
          </button>
          {tooLong && (
            <span className="text-xs text-[var(--coral)]">
              {draft.length}/{limit} characters — shorten it to send.
            </span>
          )}
          <span data-testid="chat-persistence" className="tiny ml-auto">
            This conversation stays in this tab; it is not saved to your account.
          </span>
        </div>
      </form>
    </div>
  );
}
