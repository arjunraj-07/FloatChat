/**
 * The assistant conversation's ordering rules.
 *
 * What matters here is that a reply lands where its question was asked. A
 * pending message reserves the place; the answer replaces it. If that place is
 * gone - the thread was cleared while the request was in flight - the answer is
 * dropped rather than appended under whatever question now sits last, where it
 * would appear to answer something it never saw.
 *
 * Run with Node's built-in test runner:  npm run test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ChatMessage,
  appendMessage,
  dropMessage,
  getProposalStatus,
  hasPending,
  markApplied,
  messageId,
  resolvePending,
} from '../src/lib/chat.ts';
import { createDefaultForm, formToPlan } from '../src/lib/draftPlan.ts';
import { createSession, sessionReducer } from '../src/lib/querySession.ts';

function thread(): ChatMessage[] {
  return [
    { id: 'm1', role: 'user', kind: 'text', text: 'Show temperature at 100 m.' },
    { id: 'm2', role: 'assistant', kind: 'pending', text: 'Reading your question…' },
  ];
}

describe('message ids', () => {
  it('are distinct per position', () => {
    assert.notEqual(messageId(1), messageId(2));
  });
});

describe('a reply to a pending message', () => {
  it('replaces the pending message in place, keeping the order', () => {
    const next = resolvePending(thread(), 'm2', {
      role: 'assistant',
      kind: 'text',
      text: 'Here is a proposal.',
    });
    assert.equal(next.length, 2);
    assert.equal(next[1].kind, 'text');
    assert.equal(next[1].id, 'm2');
    assert.equal(next[0].text, 'Show temperature at 100 m.');
  });

  it('is dropped when its place is gone, rather than answering a later question', () => {
    const cleared: ChatMessage[] = [
      { id: 'm9', role: 'user', kind: 'text', text: 'A different question.' },
    ];
    const next = resolvePending(cleared, 'm2', {
      role: 'assistant',
      kind: 'text',
      text: 'An answer to something else.',
    });
    assert.deepEqual(next, cleared);
    assert.equal(next.length, 1);
  });

  it('leaves other messages untouched', () => {
    const messages = appendMessage(thread(), {
      id: 'm3',
      role: 'user',
      kind: 'text',
      text: 'And salinity?',
    });
    const next = resolvePending(messages, 'm2', { role: 'assistant', kind: 'text', text: 'Done.' });
    assert.equal(next[2].text, 'And salinity?');
  });
});

describe('a request in flight', () => {
  it('is visible while pending and not afterwards', () => {
    const messages = thread();
    assert.equal(hasPending(messages), true);
    const done = resolvePending(messages, 'm2', { role: 'assistant', kind: 'text', text: 'Done.' });
    assert.equal(hasPending(done), false);
  });
});

describe('applying a proposal from the conversation', () => {
  const atDepth = formToPlan({ ...createDefaultForm(), depthMode: 'at_depth', depthTarget: '100' }).plan!;

  it('fills the filters and advances the draft, without executing anything itself', () => {
    const state = createSession(createDefaultForm());
    const next = sessionReducer(state, { type: 'draft:apply', plan: atDepth });
    assert.equal(next.revision, state.revision + 1);
    assert.equal(next.acceptedRevision, next.revision);
    assert.equal(next.plan?.depth.mode, 'at_depth');
    // Applying edits the draft. Running it is the automatic step that follows
    // from validation, and is never part of applying.
    assert.equal(next.execution, null);
  });

  it('takes the plan it is given, so a thread can hold several proposals', () => {
    // The reason this action exists: with one shared proposal slot, applying
    // an older card in the conversation would apply the newest reply instead.
    const state = createSession(createDefaultForm());
    const shallower = formToPlan({ ...createDefaultForm(), depthMax: '250' }).plan!;
    const afterFirst = sessionReducer(state, { type: 'draft:apply', plan: atDepth });
    const afterSecond = sessionReducer(afterFirst, { type: 'draft:apply', plan: shallower });
    assert.equal(afterSecond.plan?.depth.mode, 'range');
    assert.equal(afterSecond.revision, state.revision + 2);
  });
});

describe('proposals in the thread', () => {
  const proposals: ChatMessage[] = [
    { id: 'p1', role: 'assistant', kind: 'proposal', revision: 4 },
    { id: 'p2', role: 'assistant', kind: 'proposal', revision: 7 },
  ];

  it('marks only the one applied', () => {
    const next = markApplied(proposals, 'p2', 8);
    assert.equal(next[0].appliedRevision, undefined);
    assert.equal(next[1].appliedRevision, 8);
  });

  it('discards only the one dismissed', () => {
    const next = dropMessage(proposals, 'p1');
    assert.deepEqual(next.map((m) => m.id), ['p2']);
  });

  it('labels a proposal made for an earlier draft as stale', () => {
    assert.equal(getProposalStatus(proposals[0], 7, false, false, false, false, undefined), 'stale_unapplied');
    assert.equal(getProposalStatus(proposals[1], 7, false, false, false, false, undefined), 'awaiting_apply');
  });

  it('never calls a plain message stale', () => {
    const text: ChatMessage = { id: 't1', role: 'assistant', kind: 'text', text: 'Hello.' };
    assert.equal(getProposalStatus(text, 99, false, false, false, false, undefined), 'awaiting_apply');
  });
});

describe('getProposalStatus', () => {
  it('identifies unapplied stale proposals', () => {
    const msg: ChatMessage = { id: 'p1', role: 'assistant', kind: 'proposal', revision: 4 };
    assert.equal(getProposalStatus(msg, 7, false, false, false, false, undefined), 'stale_unapplied');
  });

  it('identifies unapplied valid proposals', () => {
    const msg: ChatMessage = { id: 'p1', role: 'assistant', kind: 'proposal', revision: 7 };
    assert.equal(getProposalStatus(msg, 7, false, false, false, false, undefined), 'awaiting_apply');
  });

  it('identifies applied proposals that are loading validation', () => {
    const msg: ChatMessage = { id: 'p1', role: 'assistant', kind: 'proposal', revision: 7, appliedRevision: 8 };
    assert.equal(getProposalStatus(msg, 8, false, false, true, false, undefined), 'applied_loading');
  });

  it('identifies applied proposals that failed validation', () => {
    const msg: ChatMessage = { id: 'p1', role: 'assistant', kind: 'proposal', revision: 7, appliedRevision: 8 };
    assert.equal(getProposalStatus(msg, 8, false, false, false, true, undefined), 'applied_failed');
  });

  it('identifies applied proposals that failed execution', () => {
    const msg: ChatMessage = { id: 'p1', role: 'assistant', kind: 'proposal', revision: 7, appliedRevision: 8 };
    assert.equal(getProposalStatus(msg, 8, false, true, false, false, undefined), 'applied_failed');
  });

  it('identifies applied proposals that are displayed', () => {
    const msg: ChatMessage = { id: 'p1', role: 'assistant', kind: 'proposal', revision: 7, appliedRevision: 8 };
    assert.equal(getProposalStatus(msg, 8, false, false, false, false, 8), 'applied_displayed');
  });

  it('identifies applied proposals that are stale because of a newer execution', () => {
    const msg: ChatMessage = { id: 'p1', role: 'assistant', kind: 'proposal', revision: 7, appliedRevision: 8 };
    assert.equal(getProposalStatus(msg, 9, false, false, false, false, 9), 'previously_applied');
  });
});


