const Engine = (() => {
  const FLOOR_PEN = [1, 1, 2, 2, 2, 3, 3];
  const TOKEN = 5;
  const R5 = [0, 1, 2, 3, 4];
  const wallColor = (r, c) => (c - r + 5) % 5;
  const wallCol = (r, k) => (k + r) % 5;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const emptyBoard = () => ({ lines: R5.map(() => ({ c: -1, n: 0 })), wall: Array(25).fill(-1), floor: [], score: 0 });

  function drawOne(st, rng) {
    let total = sum(st.bag);
    if (total === 0) {
      total = sum(st.lid);
      if (!total) return -1;
      st.bag = st.lid.slice();
      st.lid = [0, 0, 0, 0, 0];
    }
    let x = Math.floor(rng() * total);
    for (let k = 0; k < 5; k++) {
      if (x < st.bag[k]) { st.bag[k]--; return k; }
      x -= st.bag[k];
    }
    return -1;
  }

  function refill(st, rng) {
    st.factories = [];
    for (let f = 0; f < 5; f++) {
      const t = [];
      for (let i = 0; i < 4; i++) { const k = drawOne(st, rng); if (k < 0) break; t.push(k); }
      t.sort((a, b) => a - b);
      st.factories.push(t);
    }
    st.center = [];
    st.tokenInCenter = true;
    st.nextStart = null;
  }

  function newGame({ mode, startSeat }, rng = Math.random) {
    const st = {
      mode, status: 'play', round: 1, turn: startSeat, startSeat,
      bag: [20, 20, 20, 20, 20], lid: [0, 0, 0, 0, 0],
      factories: [], center: [], tokenInCenter: true, nextStart: null,
      boards: [emptyBoard(), emptyBoard()],
      last: null, deco: {}, roundSummary: null, result: null, movesThisRound: 0,
    };
    refill(st, rng);
    return st;
  }

  const rowHas = (b, r, k) => b.wall.slice(r * 5, r * 5 + 5).includes(k);
  function canPlace(b, r, k) {
    const L = b.lines[r];
    return L.n < r + 1 && (L.c === -1 || L.c === k) && !rowHas(b, r, k);
  }
  const sourceTiles = (st, src) => (src === 'c' ? st.center : st.factories[+src.slice(1)]);
  const countIn = (st, src, k) => sourceTiles(st, src).filter((x) => x === k).length;

  function addFloor(b, lid, k) {
    if (b.floor.length < 7) b.floor.push(k);
    else if (k !== TOKEN) lid[k]++;
  }

  function placeOnBoard(b, lid, k, count, line) {
    let over = count;
    if (line >= 0) {
      const L = b.lines[line];
      const put = Math.min(count, line + 1 - L.n);
      L.c = k; L.n += put; over = count - put;
    }
    for (let i = 0; i < over; i++) addFloor(b, lid, k);
    return over;
  }

  const isRoundOver = (st) => st.center.length === 0 && st.factories.every((f) => f.length === 0);

  function applyMove(st0, seat, mv, rng = Math.random) {
    const st = clone(st0);
    if (st.status !== 'play') throw new Error('La partie n’est pas en phase de jeu.');
    if (st.turn !== seat) throw new Error('Ce n’est pas ton tour.');
    const count = countIn(st, mv.src, mv.color);
    if (!count) throw new Error('Source vide pour cette couleur.');
    const b = st.boards[seat];
    if (mv.line >= 0 && !canPlace(b, mv.line, mv.color)) throw new Error('Ligne interdite pour cette couleur.');
    let tookToken = false;
    if (mv.src === 'c') {
      st.center = st.center.filter((x) => x !== mv.color);
      if (st.tokenInCenter) {
        st.tokenInCenter = false; st.nextStart = seat; tookToken = true;
        addFloor(b, st.lid, TOKEN);
      }
    } else {
      const i = +mv.src.slice(1);
      st.center.push(...st.factories[i].filter((x) => x !== mv.color));
      st.center.sort((a, c) => a - c);
      st.factories[i] = [];
    }
    const over = placeOnBoard(b, st.lid, mv.color, count, mv.line);
    st.movesThisRound = (st.movesThisRound || 0) + 1;
    st.last = { seat, src: mv.src, color: mv.color, count, line: mv.line, over, tookToken, round: st.round };
    st.turn = 1 - seat;
    if (isRoundOver(st)) beginDecoration(st, rng);
    return st;
  }

  const completeLines = (b) => R5.filter((r) => b.lines[r].n === r + 1);
  function grayValid(wall, r, k, col) {
    if (wall[r * 5 + col] !== -1) return false;
    for (let i = 0; i < 5; i++) if (wall[i * 5 + col] === k) return false;
    return true;
  }
  const grayOptions = (wall, r, k) => R5.filter((c) => grayValid(wall, r, k, c));

  function autoPlan(b) {
    const w = b.wall.slice();
    const plan = [null, null, null, null, null];
    for (const r of R5) {
      const L = b.lines[r];
      if (L.n !== r + 1) continue;
      const opts = grayOptions(w, r, L.c);
      if (opts.length > 1) return null;
      plan[r] = opts.length ? opts[0] : -1;
      if (opts.length) w[r * 5 + opts[0]] = L.c;
    }
    return plan;
  }

  function beginDecoration(st, rng) {
    if (st.mode === 'color') { finishRound(st, rng); return; }
    st.status = 'decorate';
    st.deco = {};
    for (const s of [0, 1]) {
      const p = autoPlan(st.boards[s]);
      if (p) st.deco[s] = p;
    }
    if (st.deco[0] && st.deco[1]) finishRound(st, rng);
  }

  function scoreAt(wall, r, c) {
    let h = 1, v = 1;
    for (let x = c - 1; x >= 0 && wall[r * 5 + x] !== -1; x--) h++;
    for (let x = c + 1; x < 5 && wall[r * 5 + x] !== -1; x++) h++;
    for (let y = r - 1; y >= 0 && wall[y * 5 + c] !== -1; y--) v++;
    for (let y = r + 1; y < 5 && wall[y * 5 + c] !== -1; y++) v++;
    if (h > 1 && v > 1) return h + v;
    if (h > 1) return h;
    if (v > 1) return v;
    return 1;
  }

  function decorateBoard(b, lid, mode, plan) {
    const gains = [null, null, null, null, null];
    const placed = [];
    for (const r of R5) {
      const L = b.lines[r];
      if (L.n !== r + 1) continue;
      let col = mode === 'color' ? wallCol(r, L.c) : (plan ? plan[r] : -1);
      if (mode === 'gray' && (col == null || col < 0 || !grayValid(b.wall, r, L.c, col))) col = -1;
      if (col >= 0) {
        b.wall[r * 5 + col] = L.c;
        const p = scoreAt(b.wall, r, col);
        b.score += p; gains[r] = p; lid[L.c] += r; placed.push([r, col]);
      } else {
        gains[r] = 0;
        for (let i = 0; i <= r; i++) addFloor(b, lid, L.c);
      }
      b.lines[r] = { c: -1, n: 0 };
    }
    let pen = 0;
    b.floor.forEach((k, i) => { pen += FLOOR_PEN[i]; if (k !== TOKEN) lid[k]++; });
    const before = b.score;
    b.score = Math.max(0, b.score - pen);
    b.floor = [];
    return { gains, penalty: before - b.score, rawPenalty: pen, placed };
  }

  const fullRows = (b) => R5.filter((r) => R5.every((c) => b.wall[r * 5 + c] !== -1)).length;
  const fullCols = (b) => R5.filter((c) => R5.every((r) => b.wall[r * 5 + c] !== -1)).length;
  const fullColors = (b) => R5.filter((k) => b.wall.filter((x) => x === k).length === 5).length;

  function finishRound(st, rng = Math.random) {
    const summary = { round: st.round, seats: [] };
    for (const s of [0, 1]) {
      const b = st.boards[s];
      const start = b.score;
      const d = decorateBoard(b, st.lid, st.mode, st.deco && st.deco[s]);
      summary.seats.push({ start, gains: d.gains, penalty: d.penalty, end: b.score });
    }
    st.roundSummary = summary;
    st.deco = {};
    if (st.boards.some((b) => fullRows(b) > 0)) { endGame(st); return st; }
    st.round++;
    if (st.nextStart != null) st.startSeat = st.nextStart;
    st.turn = st.startSeat;
    st.status = 'play';
    st.movesThisRound = 0;
    st.last = null;
    refill(st, rng);
    return st;
  }

  function endGame(st) {
    const bonus = st.boards.map((b) => {
      const rows = fullRows(b), cols = fullCols(b), colors = fullColors(b);
      const total = rows * 2 + cols * 7 + colors * 10;
      const before = b.score;
      b.score += total;
      return { before, rows, cols, colors, total };
    });
    const sc = st.boards.map((b) => b.score);
    let winner;
    if (sc[0] !== sc[1]) winner = sc[0] > sc[1] ? 0 : 1;
    else winner = bonus[0].rows === bonus[1].rows ? -1 : (bonus[0].rows > bonus[1].rows ? 0 : 1);
    st.result = { bonus, final: sc, winner, tieBreak: sc[0] === sc[1] };
    st.status = 'over';
  }

  // Points the board would score if the round ended now. Gray mode: best column per line.
  function projection(b0, mode) {
    const b = clone(b0);
    const lid = [0, 0, 0, 0, 0];
    let plan = null;
    if (mode === 'gray') {
      const w = b.wall.slice();
      plan = [null, null, null, null, null];
      for (const r of R5) {
        const L = b.lines[r];
        if (L.n !== r + 1) continue;
        let best = -1, bestPts = -1;
        for (const c of grayOptions(w, r, L.c)) {
          w[r * 5 + c] = L.c; const p = scoreAt(w, r, c); w[r * 5 + c] = -1;
          if (p > bestPts) { bestPts = p; best = c; }
        }
        plan[r] = best;
        if (best >= 0) w[r * 5 + best] = L.c;
      }
    }
    const d = decorateBoard(b, lid, mode, plan);
    return { gains: d.gains, rawPenalty: d.rawPenalty, total: b.score - b0.score };
  }

  function tileCount(st) {
    let n = sum(st.bag) + sum(st.lid) + st.center.length;
    st.factories.forEach((f) => (n += f.length));
    st.boards.forEach((b) => {
      b.lines.forEach((L) => (n += L.n));
      n += b.wall.filter((x) => x !== -1).length;
      n += b.floor.filter((x) => x !== TOKEN).length;
    });
    return n;
  }

  return {
    FLOOR_PEN, TOKEN, wallColor, wallCol, clone, emptyBoard, newGame, applyMove, canPlace, countIn,
    placeOnBoard, addFloor, completeLines, grayValid, grayOptions, scoreAt, decorateBoard,
    finishRound, projection, fullRows, fullCols, fullColors, tileCount,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
