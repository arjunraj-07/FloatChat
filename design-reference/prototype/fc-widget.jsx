/* Floating assistant widget — Phosphor Eye trigger plus a compact chat panel.
   Built from the design-system component classes (.card, .dialog, .field, .input,
   .btn, .btn-primary); the widget root rebinds --color-accent / --color-surface /
   --color-bg to this page's ocean tokens, so no new colour, radius or shadow is
   introduced and the widget still belongs to the screen it floats over. */

const WIDGET_STORAGE = 'fc-widget-open';

function FCWidget() {
  const app = useApp();
  const [msgs, setMsgs] = FCChat.useChat();
  const unread = FCChat.useUnread();
  const [open, setOpen] = React.useState(() => {
    try { return localStorage.getItem(WIDGET_STORAGE) === '1'; } catch (e) { return false; }
  });
  const [input, setInput] = React.useState('');
  const [thinking, setThinking] = React.useState(false);
  const rootRef = React.useRef(null);
  const logRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const wasOpen = React.useRef(open);

  React.useEffect(() => { try { localStorage.setItem(WIDGET_STORAGE, open ? '1' : '0'); } catch (e) {} }, [open]);
  React.useEffect(() => { if (open) FCChat.clearUnread(); }, [open, msgs]);

  // focus into the panel on open, back to the trigger on close
  React.useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) btnRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const away = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  React.useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [msgs, thinking, open]);

  const send = (text) => {
    const t = (text ?? input).trim();
    if (!t) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', body: t }]);
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setMsgs((m) => [...m, { role: 'assistant', ...makeReply(t, app) }]);
      if (!open) FCChat.markUnread();
    }, 780);
  };

  const openFull = () => { setOpen(false); app.go('assistant'); };

  if (app.screen === 'assistant') return null;

  return (
    <div className={'fc-widget' + (app.screen === 'home' ? ' on-hero' : '')} ref={rootRef}>
      {open && (
        <div className="fc-widget-panel card dialog elev-md" role="dialog" aria-label="AI Assistant" aria-modal="false">
          <header className="fc-widget-head">
            <div>
              <span className="card-kicker">FloatChat</span>
              <h4 className="dialog-title fc-widget-title">AI Assistant</h4>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => setOpen(false)} aria-label="Close assistant"><i className="ph ph-x" aria-hidden="true"></i></button>
          </header>

          <div className="fc-widget-log" ref={logRef} role="log" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={'fc-widget-msg' + (m.role === 'user' ? ' is-user' : '')}>
                {m.role === 'assistant' && m.kind && m.kind !== 'explain' && (
                  <span className="card-kicker">{{ clarify: 'Clarification', proposal: 'Query proposal', unsupported: 'Unsupported', nodata: 'No data', evidence: 'Evidence' }[m.kind] || 'Explanation'}</span>
                )}
                <p className="fc-widget-body">{m.body}</p>
                {m.meta && <Mono className="fc-xs fc-muted">{m.meta}</Mono>}
                {m.chips && <div className="fc-row fc-gap-2 fc-wrap fc-mt-2">{m.chips.map((c) => <button key={c} className="fc-chip" onClick={() => send(c)}>{c}</button>)}</div>}
                {m.evidence && <div className="fc-widget-evidence">{m.evidence.map(([k, v]) => <DataRow key={k} k={k} v={v} />)}</div>}
                {m.proposal && (
                  <div className="fc-widget-proposal">
                    <Mono className="fc-xs">{m.proposal.summary}</Mono>
                    <Mono className="fc-xs fc-muted">{m.proposal.count} profiles match</Mono>
                    <button className="btn btn-primary fc-widget-send" onClick={openFull}>Review in assistant</button>
                  </div>
                )}
                {m.actions && <button className="btn btn-ghost fc-widget-link" onClick={openFull}>Open the full assistant</button>}
              </div>
            ))}
            {thinking && <div className="fc-widget-msg"><div className="fc-row fc-gap-2"><span className="fc-spinner" aria-hidden="true"></span><Mono className="fc-xs fc-muted">Reading the loaded profiles…</Mono></div></div>}
          </div>

          <form className="field fc-widget-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label htmlFor="fc-widget-input">Ask about the available data</label>
            <div className="fc-row fc-gap-2">
              <input id="fc-widget-input" ref={inputRef} className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Regions, depths, temperature…" />
              <button type="submit" className="btn btn-primary fc-widget-send" disabled={!input.trim()}>Send</button>
            </div>
          </form>
        </div>
      )}

      <button ref={btnRef} className="btn fc-widget-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'}>
        <i className="ph ph-eye" aria-hidden="true"></i>
        {!open && unread > 0 && <span className="fc-widget-dot" aria-hidden="true"></span>}
      </button>
    </div>
  );
}

Object.assign(window, { FCWidget });
