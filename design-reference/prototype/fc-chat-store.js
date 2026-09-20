/* Shared assistant transcript. One conversation behind both the full AI Assistant
   screen and the floating widget, so neither surface owns the history. */
(() => {
  const INITIAL = [{ role: 'assistant', kind: 'explain', body: 'Ask about the Argo observations that are loaded — regions, depths, how temperature and salinity change, or how one profile sits against climatology. I will propose a query before changing anything on the map.' }];
  let msgs = INITIAL;
  let unread = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const store = {
    get: () => msgs,
    set(next) { msgs = typeof next === 'function' ? next(msgs) : next; emit(); },
    getUnread: () => unread,
    markUnread() { unread += 1; emit(); },
    clearUnread() { if (unread) { unread = 0; emit(); } },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    useChat() {
      const [, force] = React.useReducer((n) => n + 1, 0);
      React.useEffect(() => store.subscribe(force), []);
      return [msgs, store.set];
    },
    useUnread() {
      const [, force] = React.useReducer((n) => n + 1, 0);
      React.useEffect(() => store.subscribe(force), []);
      return unread;
    },
  };
  window.FCChat = store;
})();
