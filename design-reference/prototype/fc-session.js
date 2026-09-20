/* FloatChat session handoff. Written by Auth.html, read by the app on load.
   Mock only — no backend, no token, no secret. */
(() => {
  const KEY = 'fc-session';
  const store = {
    read() {
      try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    },
    write(session) {
      try { localStorage.setItem(KEY, JSON.stringify(session)); } catch (e) {}
    },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} },
  };
  window.FCSession = store;
})();
