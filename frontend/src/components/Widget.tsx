'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/chat.ts';
import { SectionId } from '@/lib/navigation.ts';
import type { SessionState } from '@/lib/querySession.ts';

const WIDGET_STORAGE = 'fc-widget-open';

interface Props {
  section: SectionId;
  onNavigate: (section: SectionId) => void;
  messages: ChatMessage[];
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  onApply: (messageId: string) => void;
  onDiscard: (messageId: string) => void;
  session: SessionState;
  hasUnread?: boolean;
  onMarkRead?: () => void;
}

export default function Widget({
  section,
  onNavigate,
  messages,
  draft,
  onDraftChange,
  onSend,
  session,
}: Props) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(WIDGET_STORAGE) === '1';
    } catch {
      return false;
    }
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    try {
      localStorage.setItem(WIDGET_STORAGE, open ? '1' : '0');
    } catch {}
  }, [open]);

  // focus into the panel on open, back to the trigger on close
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else if (wasOpen.current) {
      btnRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, session.executing, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || session.executing || messages.some(m => m.kind === 'pending')) return;
    onSend(draft);
  };

  const openFull = () => {
    setOpen(false);
    onNavigate('assistant');
  };

  if (section === 'assistant') return null;

  return (
    <div className={'fc-widget' + (section === 'map' ? ' on-hero' : '')} ref={rootRef}>
      {open && (
        <div className="fc-widget-panel card dialog elev-md" role="dialog" aria-label="AI Assistant" aria-modal="false">
          <header className="fc-widget-head">
            <div>
              <span className="card-kicker">FloatChat</span>
              <h4 className="dialog-title fc-widget-title">AI Assistant</h4>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="fc-widget-log" ref={logRef} role="log" aria-live="polite">
            {messages.map((m) => (
              <div key={m.id} className={'fc-widget-msg' + (m.role === 'user' ? ' is-user' : '')}>
                {m.role === 'assistant' && m.kind && m.kind !== 'explanation' && (
                  <span className="card-kicker">
                    {{ clarify: 'Clarification', proposal: 'Query proposal', unsupported: 'Unsupported', nodata: 'No data', evidence: 'Evidence' }[m.kind as string] || 'Explanation'}
                  </span>
                )}
                {m.text && <p className="fc-widget-body" dangerouslySetInnerHTML={{ __html: m.text.replace(/\n/g, '<br/>') }} />}
                
                {m.kind === 'proposal' && m.proposal && (
                  <div className="fc-widget-proposal mt-3">
                    <div className="text-sm font-mono">{m.proposal.proposed_plan?.time?.start} - {m.proposal.proposed_plan?.time?.end}</div>
                    <button className="fc-btn fc-btn-primary fc-widget-send mt-2 text-xs py-1" onClick={openFull}>
                      Review in assistant
                    </button>
                  </div>
                )}
                
                {m.kind === 'explanation' && m.explanation && (
                  <div className="fc-widget-proposal mt-3">
                    <button className="fc-btn fc-btn-ghost fc-widget-link text-xs" onClick={openFull}>
                      Read full explanation
                    </button>
                  </div>
                )}
              </div>
            ))}
            {messages.some(m => m.kind === 'pending') && (
              <div className="fc-widget-msg">
                <div className="fc-row fc-gap-2">
                  <span className="fc-spinner" aria-hidden="true"></span>
                  <span className="fc-mono fc-xs fc-muted">
                    Thinking…
                  </span>
                </div>
              </div>
            )}
          </div>

          <form className="field fc-widget-composer" onSubmit={handleSubmit}>
            <label htmlFor="fc-widget-input" className="sr-only">Ask about the available data</label>
            <div className="fc-row fc-gap-2">
              <input
                id="fc-widget-input"
                ref={inputRef}
                className="input"
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                placeholder="Regions, depths, temperature…"
                disabled={messages.some(m => m.kind === 'pending')}
              />
              <button
                type="submit"
                className="btn btn-primary fc-widget-send"
                disabled={session.executing || messages.some(m => m.kind === 'pending')}
                aria-expanded={open}
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}
      
      {!open && (
        <button
          ref={btnRef}
          className="fc-widget-trigger"
          onClick={() => setOpen(true)}
          aria-label="Open AI Assistant"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor">
            <path d="M128,40A96.11,96.11,0,0,0,32,136c0,22.4,12.06,50.7,35.8,84.14A16.32,16.32,0,0,0,81.12,228a16.07,16.07,0,0,0,13.23-6.93C110,197.83,118.88,184,128,184s18,13.84,33.64,37.1a16.14,16.14,0,0,0,26.56-.84C211.94,186.7,224,158.4,224,136A96.11,96.11,0,0,0,128,40Zm0,128c-18.73,0-32.55,16.31-47,33.46C60.84,173.2,52.33,150.31,48,136a80,80,0,1,1,160,0c-4.33,14.31-12.84,37.2-33,65.46C160.55,184.31,146.73,168,128,168Zm32-56a16,16,0,1,1-16-16A16,16,0,0,1,160,112Zm-64,0a16,16,0,1,1-16-16A16,16,0,0,1,96,112Z" />
          </svg>
        </button>
      )}
    </div>
  );
}
