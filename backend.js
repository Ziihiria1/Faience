// Two interchangeable stores for game rooms.
// Both expose: kind, watch(code, cb, onErr) -> unsubscribe, get(code), tx(code, fn), onConn(cb).
// tx(fn): fn receives the current room (or null) and returns the new room, null to delete,
// or undefined to abort. It may run several times; keep it free of side effects.
const Backends = (() => {
  function firebase_(cfg) {
    const app = firebase.initializeApp(cfg);
    const db = firebase.database(app);
    const ref = (code) => db.ref('rooms/' + code);
    return {
      kind: 'firebase',
      watch(code, cb, onErr) {
        const r = ref(code);
        const h = (s) => cb(s.val());
        r.on('value', h, (e) => onErr && onErr(e));
        return () => r.off('value', h);
      },
      async get(code) { return (await ref(code).get()).val(); },
      async tx(code, fn) {
        const res = await ref(code).transaction((cur) => fn(cur));
        return { committed: res.committed, room: res.snapshot.val() };
      },
      onConn(cb) { db.ref('.info/connected').on('value', (s) => cb(!!s.val())); },
    };
  }

  // Same-browser store: lets two tabs play against each other without any server.
  function local() {
    const PREFIX = 'faience:local:room:';
    const subs = {};
    const read = (c) => { try { const v = localStorage.getItem(PREFIX + c); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
    const emit = (c) => (subs[c] || []).forEach((f) => f(read(c)));
    window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith(PREFIX)) emit(e.key.slice(PREFIX.length)); });
    return {
      kind: 'local',
      watch(code, cb) {
        (subs[code] = subs[code] || []).push(cb);
        setTimeout(() => cb(read(code)), 0);
        return () => { subs[code] = (subs[code] || []).filter((f) => f !== cb); };
      },
      async get(code) { return read(code); },
      async tx(code, fn) {
        const cur = read(code);
        const next = fn(cur);
        if (next === undefined) return { committed: false, room: cur };
        if (next === null) localStorage.removeItem(PREFIX + code);
        else localStorage.setItem(PREFIX + code, JSON.stringify(next));
        setTimeout(() => emit(code), 0);
        return { committed: true, room: next };
      },
      onConn(cb) { cb(true); },
    };
  }
  return { firebase: firebase_, local };
})();
