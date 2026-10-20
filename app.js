/* Faïence à deux — app shell. Depends on engine.js (Engine) and backend.js (Backends). */
const $ = (id) => document.getElementById(id);
const CFG = window.FAIENCE_CONFIG || {};
const BASE_TITLE = 'Faïence à deux';
const ADJ = [['bleue', 'bleues'], ['orange', 'orange'], ['rouge', 'rouges'], ['noire', 'noires'], ['cyan', 'cyan']];
const R5 = [0, 1, 2, 3, 4];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const tile = (k, cls = '') => (k === Engine.TOKEN ? `<span class="tile tok ${cls}">1</span>` : `<span class="tile k${k} ${cls}"></span>`);
const tiles = (n, k) => `${n} tuile${n > 1 ? 's' : ''} ${ADJ[k][n > 1 ? 1 : 0]}`;
const modeName = (m) => (m === 'gray' ? 'mur gris' : 'mur coloré');

function storage(get) {
  return {
    get(k, d) { try { const v = get().getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { get().setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { get().removeItem(k); } catch (e) { /* storage unavailable */ } },
  };
}
const LS = storage(() => localStorage);
const SS = storage(() => sessionStorage);
function rand(n, alpha) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => alpha[x % alpha.length]).join('');
}

/* ---------- Backend selection ---------- */
const cfgOK = (() => {
  const f = CFG.firebase;
  return !!(f && /^https:\/\//.test(f.databaseURL || '') && f.apiKey && !/COLLE-ICI/.test(JSON.stringify(f)));
})();
function pickBackend() {
  if (/[?&]local\b/.test(location.search) || SS.get('faience:local', false)) return Backends.local();
  if (cfgOK && window.firebase) {
    try { return Backends.firebase(CFG.firebase); } catch (e) { console.error(e); }
  }
  return null;
}
let backend = pickBackend();
let conn = true;

/* ---------- Profiles (stored on this phone) ---------- */
let profiles = LS.get('faience:profiles', []);
// In test mode two tabs share this browser, so each tab picks its own profile.
const perTab = () => !!backend && backend.kind === 'local';
let meId = SS.get('faience:me', null) || (perTab() ? null : LS.get('faience:last', null));
if (!profiles.some((p) => p.id === meId)) meId = !perTab() && profiles.length === 1 ? profiles[0].id : null;
const me = () => profiles.find((p) => p.id === meId) || null;
function setMe(id) { meId = id; SS.set('faience:me', id); LS.set('faience:last', id); }
const roomsKey = () => 'faience:rooms:' + meId;
const histKey = () => 'faience:hist:' + meId;
const myRooms = () => LS.get(roomsKey(), []);
function rememberRoom(code) { LS.set(roomsKey(), [{ code, at: Date.now() }, ...myRooms().filter((r) => r.code !== code)].slice(0, 8)); }
function forgetRoom(code) { LS.set(roomsKey(), myRooms().filter((r) => r.code !== code)); delete ui.roomInfo[code]; }

/* ---------- Room state ---------- */
let roomCode = null;
let room;          // undefined while loading, null when the room does not exist
let game = null;   // parsed engine state of room.game
let unwatch = null;
const ui = {
  sel: null, staged: null, plan: null, planKey: null, pending: false, zoom: null, ov: null, confirmAbandon: false,
  newMode: 'color', newStart: 'rand', rematchMode: null, joinCode: '', pname: '', pk: null,
  profileScreen: false, confirmDel: null, roomInfo: {}, seqKey: null, myTurnPrev: false,
};

const players = () => {
  const p = room && room.players;
  if (!p) return [];
  return Array.isArray(p) ? p : [p[0], p[1]];
};
const mySeat = () => players().findIndex((p) => p && p.id === meId);
const nm = (s) => (players()[s] ? players()[s].name : 'en attente');
const em = (s) => (players()[s] ? tile(players()[s].k) : '<span class="tile tok">?</span>');

function resetSel() { ui.sel = null; ui.staged = null; ui.plan = null; ui.zoom = null; }

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  const host = $('stage').hidden ? document.body : $('stage');
  if (t.parentNode !== host) host.appendChild(t);
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3600);
}

/* ---------- Board rendering ---------- */
function boardHTML(b, o) {
  const valid = o.valid || null;
  const lines = R5.map((r) => {
    const L = b.lines[r];
    const G = o.ghostFrom ? o.ghostFrom.lines[r] : null;
    let cells = '';
    for (let i = 0; i <= r; i++) {
      if (i >= r + 1 - L.n) cells += tile(L.c, G && i < r + 1 - G.n ? 'ghost' : '');
      else cells += '<span class="slot"></span>';
    }
    let gain = '';
    const gv = o.gains ? o.gains[r] : null;
    if (gv != null) {
      gain = gv > 0
        ? `<span class="gain" style="--free:${4 - r}">+${gv}</span>`
        : `<span class="gain zero" style="--free:${4 - r}" title="Aucune case libre : ces tuiles iront au plancher">✕</span>`;
    }
    const cls = ['pline'];
    if (valid) cls.push(valid.includes(r) ? 'ok' : 'no');
    if (o.just === r) cls.push('just');
    if (o.cur === r) cls.push('cur');
    if (valid) return `<button class="${cls.join(' ')}" data-act="line" data-line="${r}" ${valid.includes(r) ? '' : 'disabled'} aria-label="Ligne ${r + 1}">${gain}${cells}</button>`;
    return `<div class="${cls.join(' ')}">${gain}${cells}</div>`;
  }).join('');

  const planned = {};
  (o.planCells || []).forEach(([r, c, k]) => (planned[r * 5 + c] = k));
  let wall = '';
  for (let r = 0; r < 5; r++) {
    let row = '';
    for (let c = 0; c < 5; c++) {
      const v = b.wall[r * 5 + c];
      const i = r * 5 + c;
      if (v >= 0) row += tile(v);
      else if (planned[i] != null) row += tile(planned[i], 'ghost');
      else if (o.cand && o.cand.r === r && o.cand.opts.includes(c)) row += `<button class="slot wcell cand" data-act="decocell" data-r="${r}" data-c="${c}" aria-label="Colonne ${c + 1}"></button>`;
      else row += `<span class="slot ${o.mode === 'color' ? 'hint k' + Engine.wallColor(r, c) : ''}"></span>`;
    }
    wall += `<div class="wrow">${row}</div>`;
  }

  const F = b.floor;
  const GF = o.ghostFrom ? o.ghostFrom.floor.length : F.length;
  let floor = '';
  for (let i = 0; i < 7; i++) {
    const inner = i < F.length ? tile(F[i], i >= GF ? 'ghost' : '') : '<span class="slot"></span>';
    floor += `<span class="fslot">${inner}<span>−${Engine.FLOOR_PEN[i]}</span></span>`;
  }
  const fcls = ['floor'];
  if (valid) fcls.push('ok');
  if (o.just === -1) fcls.push('just');
  const floorEl = valid
    ? `<button class="${fcls.join(' ')}" data-act="line" data-line="-1" aria-label="Plancher">${floor}</button>`
    : `<div class="${fcls.join(' ')}">${floor}</div>`;
  return `<div class="board ${o.size || ''}"><div class="bgrid"><div class="plines">${lines}</div><div class="wall">${wall}</div></div>${floorEl}</div>`;
}

function wallOnly(b, mode) {
  let wall = '';
  for (let r = 0; r < 5; r++) {
    let row = '';
    for (let c = 0; c < 5; c++) {
      const v = b.wall[r * 5 + c];
      row += v >= 0 ? tile(v) : `<span class="slot ${mode === 'color' ? 'hint k' + Engine.wallColor(r, c) : ''}"></span>`;
    }
    wall += `<div class="wrow">${row}</div>`;
  }
  return `<div class="board mini"><div class="wall">${wall}</div></div>`;
}

function howHTML() {
  return `<div class="how"><ol>
    <li>Touche une fabrique pour l’agrandir, puis une couleur. Les tuiles du centre se touchent directement.</li>
    <li>Touche une ligne de ton plateau, ou le plancher. Les tuiles apparaissent en pointillés.</li>
    <li><b>Valider</b> envoie le coup. <b>Annuler</b> remet tout en place.</li>
  </ol>
  <p class="muted small">Les nombres verts sur les lignes complètes donnent les points que tu marquerais si la manche s’arrêtait maintenant. L’icône à quatre carrés affiche le plateau de ton adversaire.</p></div>`;
}

/* ---------- Portrait screens ---------- */
function setupHTML() {
  const sdkMissing = cfgOK && !window.firebase;
  return `<div class="hero"><span class="eyebrow">Faïence à deux</span><h1>Configuration requise</h1></div>
  <section class="card"><p>${sdkMissing
    ? 'La configuration Firebase est renseignée, mais la bibliothèque Firebase ne s’est pas chargée. Vérifie ta connexion puis recharge la page.'
    : 'Pour relier vos deux téléphones, ce site a besoin d’une base Firebase gratuite. Renseigne le fichier <b>config.js</b> en suivant le README du dépôt.'}</p>
  <button class="btn" data-act="useLocal">Tester sur cet appareil (deux onglets)</button>
  <p class="small muted">Le mode test garde les parties dans ce navigateur : ouvre deux onglets, un profil par onglet.</p></section>`;
}

function profileHTML() {
  const list = profiles;
  const used = new Set(list.map((p) => p.k));
  if (ui.pk == null) ui.pk = [0, 1, 2, 3, 4].find((k) => !used.has(k)) ?? 0;
  const rows = list.map((p) => {
    if (ui.confirmDel === p.id) {
      return `<div class="prow confirm"><span>Supprimer <b>${esc(p.name)}</b> de ce téléphone, avec son bilan ?</span><div class="row"><button class="btn" data-act="delNo">Non</button><button class="btn danger" data-act="delYes" data-v="${p.id}">Supprimer</button></div></div>`;
    }
    const cur = p.id === meId;
    return `<div class="prow"><button class="pbtn" data-act="useProfile" data-v="${p.id}" aria-pressed="${cur}">${tile(p.k)}<span class="pn">${esc(p.name)}</span>${cur ? '<span class="chip">Actif</span>' : ''}</button><button class="pdel" data-act="delAsk" data-v="${p.id}" aria-label="Supprimer ${esc(p.name)}">✕</button></div>`;
  }).join('');
  const emb = [0, 1, 2, 3, 4].map((k) => `<button data-act="setPk" data-v="${k}" aria-pressed="${ui.pk === k}" aria-label="Emblème ${ADJ[k][0]}">${tile(k)}</button>`).join('');
  return `<div class="hero"><span class="eyebrow">Faïence à deux</span><h1>${list.length ? 'Qui joue sur ce téléphone ?' : 'Crée ton profil'}</h1></div>
  ${list.length ? `<section class="card"><div class="card-h"><h2>Profils</h2>${me() ? '<button class="btn" data-act="profileClose">Retour</button>' : ''}</div><div class="plist">${rows}</div></section>` : ''}
  <section class="card"><h2>${list.length ? 'Nouveau profil' : 'Ton nom et ton emblème'}</h2>
    <div class="field"><label class="eyebrow" for="pname">Nom</label><input class="input" id="pname" maxlength="18" autocomplete="off" placeholder="Ex. Benjamin" value="${esc(ui.pname)}"></div>
    <div class="field"><span class="eyebrow">Emblème</span><div class="emb">${emb}</div></div>
    <button class="btn primary" data-act="createProfile">Créer le profil</button>
    <p class="small muted">Le profil reste sur ce téléphone. Ton adversaire crée le sien sur son téléphone.</p>
  </section>`;
}

function roomsListHTML() {
  const list = myRooms();
  if (!list.length) return '';
  const rows = list.map(({ code }) => {
    const info = ui.roomInfo[code];
    if (!info) { fetchRoomInfo(code); return `<div class="it"><span><b class="mono">${code}</b> · chargement…</span></div>`; }
    if (info.gone) return '';
    const status = {
      waiting: 'en attente d’un adversaire', mine: '<b>à toi de jouer</b>', theirs: `au tour de ${esc(info.opp)}`, over: 'partie terminée', full: 'salon complet',
    }[info.status];
    return `<div class="it"><span><b class="mono">${code}</b>${info.opp && info.status !== 'waiting' ? ` · contre ${esc(info.opp)}` : ''}<br><span class="small muted">${status}</span></span><span class="row tight"><button class="btn small-btn" data-act="resume" data-v="${code}">Reprendre</button><button class="pdel" data-act="forget" data-v="${code}" aria-label="Retirer ${code} de la liste">✕</button></span></div>`;
  }).join('');
  return `<section class="card"><h2>Tes salons</h2><div class="hist">${rows}</div></section>`;
}

function fetchRoomInfo(code) {
  ui.roomInfo[code] = { status: 'loading', loading: true };
  backend.get(code).then((r) => {
    if (!r) { forgetRoom(code); ui.roomInfo[code] = { gone: true }; render(); return; }
    let g = null;
    try { g = JSON.parse(r.game); } catch (e) { /* unreadable */ }
    const P = Array.isArray(r.players) ? r.players : [r.players && r.players[0], r.players && r.players[1]];
    const s = P.findIndex((p) => p && p.id === meId);
    const opp = s >= 0 && P[1 - s] ? P[1 - s].name : (P[0] ? P[0].name : '');
    let status = 'theirs';
    if (!P[1]) status = s === 0 ? 'waiting' : 'full';
    else if (s < 0) status = 'full';
    else if (!g || g.status === 'over') status = 'over';
    else if ((g.status === 'play' && g.turn === s) || (g.status === 'decorate' && !(g.deco && g.deco[s]))) status = 'mine';
    ui.roomInfo[code] = { status, opp };
    render();
  }).catch(() => { ui.roomInfo[code] = { status: 'over', opp: '' }; });
}

function historyHTML() {
  const h = LS.get(histKey(), []);
  if (!h.length) return '';
  const by = {};
  h.forEach((x) => {
    const r = by[x.opp.name] || (by[x.opp.name] = { w: 0, l: 0, t: 0, n: 0, k: x.opp.k });
    r.n++; r[x.res]++;
  });
  const tallies = Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([opp, r]) => `<div class="tally"><div><div class="big">${r.w}</div><div class="small">${esc(me().name)}</div></div><div class="muted small">${r.t ? `${r.t} nul${r.t > 1 ? 's' : ''}` : '–'}</div><div><div class="big">${r.l}</div><div class="small">${esc(opp)}</div></div></div>`).join('');
  const list = h.slice(0, 10).map((x) => {
    const date = new Date(x.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const res = x.res === 't' ? 'Égalité' : x.res === 'w' ? 'Victoire' : 'Défaite';
    return `<div class="it"><span>${date} · contre ${esc(x.opp.name)} · <b>${res}</b></span><span class="num">${x.my} – ${x.their}</span></div>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h2>Bilan de ${esc(me().name)}</h2><span class="muted small">${h.length} partie${h.length > 1 ? 's' : ''}</span></div>${tallies}<div class="hist">${list}</div></section>`;
}

const seg = (key, opts) => `<div class="seg" style="--n:${opts.length}">${opts.map(([v, l]) => `<button data-act="set" data-key="${key}" data-v="${v}" aria-pressed="${ui[key] === v}">${l}</button>`).join('')}</div>`;

function lobbyHTML() {
  const p = me();
  return `<div class="hero"><span class="eyebrow">Faïence à deux</span><h1>Un mur chacun, un seul sac de tuiles.</h1></div>
  <section class="card"><div class="card-h"><div class="whoami">${tile(p.k)}<div><span class="eyebrow">Ton profil</span><h2>${esc(p.name)}</h2></div></div><button class="btn" data-act="profile">Changer</button></div></section>
  <section class="card"><h2>Nouvelle partie</h2>
    <div class="field"><span class="eyebrow">Mur</span>${seg('newMode', [['color', 'Coloré'], ['gray', 'Gris']])}
      <p class="small muted">${ui.newMode === 'gray' ? 'Tu choisis la case de chaque tuile. Une couleur au plus par ligne et par colonne.' : 'Chaque couleur a sa case imprimée sur le mur.'}</p></div>
    <div class="field"><span class="eyebrow">Qui commence</span>${seg('newStart', [['me', 'Moi'], ['them', 'L’autre'], ['rand', 'Au hasard']])}</div>
    <button class="btn primary" data-act="createRoom" ${ui.pending ? 'disabled' : ''}>${ui.pending ? 'Création…' : 'Créer le salon'}</button>
    <p class="small muted">Tu obtiens un code à 5 caractères à donner à ton adversaire.</p>
  </section>
  <section class="card"><h2>Rejoindre une partie</h2>
    <div class="field"><label class="eyebrow" for="jcode">Code du salon</label>
    <div class="joinrow"><input class="input mono code-in" id="jcode" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE" value="${esc(ui.joinCode)}"><button class="btn primary" data-act="join" ${ui.pending ? 'disabled' : ''}>Rejoindre</button></div></div>
  </section>
  ${roomsListHTML()}
  ${historyHTML()}
  <section class="card"><h2>Comment jouer</h2>${howHTML()}<p class="small muted">La partie se joue téléphone à l’horizontale. Si la rotation automatique est bloquée, l’écran se tourne tout seul : tourne ton téléphone vers la gauche.</p></section>
  ${backend.kind === 'local' ? '<p class="small muted center">Mode test : les salons restent dans ce navigateur. <button class="link" data-act="leaveLocal">Quitter le mode test</button></p>' : ''}`;
}

function waitingHTML() {
  const url = location.origin + location.pathname + '#' + roomCode;
  return `<div class="hero"><span class="eyebrow">Salon créé · ${modeName(game.mode)}</span><h1>En attente de ton adversaire</h1></div>
  <section class="card center-card"><span class="eyebrow">Code du salon</span><div class="bigcode mono" aria-label="Code ${roomCode.split('').join(' ')}">${roomCode}</div>
    <div class="row"><button class="btn primary" data-act="share">Partager le lien</button><button class="btn" data-act="copyCode">Copier le code</button></div>
    <p class="small muted sel">${esc(url)}</p></section>
  <section class="card"><p>Sur son téléphone, elle ouvre le site, crée son profil, touche <b>Rejoindre une partie</b> et tape ce code. Avec le lien, elle rejoint directement.</p>
    <p class="small muted">La partie démarre dès qu’elle a rejoint. Tu peux fermer cette page : le salon t’attend dans « Tes salons ».</p>
    <div class="row"><button class="btn" data-act="home">Accueil</button><button class="btn danger" data-act="cancelRoom">Fermer le salon</button></div></section>`;
}

function resultHTML() {
  const d = game;
  const s = Math.max(0, mySeat());
  const o = 1 - s;
  const t = room.tally || {};
  let card;
  if (d.result && d.result.abandoned) {
    card = `<section class="card"><p>${d.result.by === s ? 'Tu as abandonné' : esc(cap(nm(d.result.by))) + ' a abandonné'} la partie en manche ${d.round}.</p></section>`;
  } else {
    const r = d.result;
    const head = r.winner === -1 ? 'Égalité parfaite' : r.winner === s ? 'Tu as gagné' : `${cap(nm(r.winner))} gagne`;
    const tie = r.tieBreak && r.winner !== -1 ? '<p class="small muted">Égalité de points, départagée au nombre de lignes complètes.</p>' : '';
    const B = r.bonus;
    const row = (label, f) => `<tr><td>${label}</td><td>${f(s)}</td><td>${f(o)}</td></tr>`;
    card = `<div class="hero"><span class="eyebrow">Salon ${roomCode} · partie ${d.gameNo || 1} · ${modeName(d.mode)}</span><h1>${esc(head)}</h1><p class="score-line num">${r.final[s]} à ${r.final[o]}</p></div>${tie}
    <section class="card"><div class="walls2"><div>${wallOnly(d.boards[s], d.mode)}<span class="small">${esc(nm(s))}</span></div><div>${wallOnly(d.boards[o], d.mode)}<span class="small">${esc(nm(o))}</span></div></div>
    <table class="sum"><thead><tr><th></th><th>${esc(nm(s))}</th><th>${esc(nm(o))}</th></tr></thead><tbody>
    ${row('Points en jeu', (x) => B[x].before)}
    ${row('Lignes ×2', (x) => '+' + B[x].rows * 2)}
    ${row('Colonnes ×7', (x) => '+' + B[x].cols * 7)}
    ${row('Couleurs ×10', (x) => '+' + B[x].colors * 10)}
    ${row('Total', (x) => r.final[x])}</tbody></table></section>`;
  }
  if (!ui.rematchMode) ui.rematchMode = d.mode;
  const tl = `<div class="tally"><div><div class="big">${t['w' + s] || 0}</div><div class="small">${esc(nm(s))}</div></div><div class="muted small">${t.t ? `${t.t} nul${t.t > 1 ? 's' : ''}` : 'dans ce salon'}</div><div><div class="big">${t['w' + o] || 0}</div><div class="small">${esc(nm(o))}</div></div></div>`;
  const canPlay = mySeat() >= 0;
  return `${card}
  <section class="card">${tl}
    ${canPlay ? `<div class="field"><span class="eyebrow">Revanche</span>${seg('rematchMode', [['color', 'Mur coloré'], ['gray', 'Mur gris']])}</div>
    <button class="btn primary" data-act="rematch" ${ui.pending ? 'disabled' : ''}>Revanche</button>
    <p class="small muted">${esc(cap(nm(1 - (d.firstSeat ?? 0))))} commencera. La revanche démarre aussi chez ton adversaire.</p>` : ''}
    <button class="btn" data-act="home">Accueil</button></section>`;
}

function fullHTML() {
  return `<div class="hero"><span class="eyebrow">Salon ${roomCode}</span><h1>Salon complet</h1></div>
  <section class="card"><p>Deux joueurs ont déjà rejoint ce salon, et ton profil n’en fait pas partie. Si c’est ta partie, choisis le bon profil.</p>
  <div class="row"><button class="btn" data-act="home">Accueil</button><button class="btn" data-act="profile">Changer de profil</button></div></section>`;
}

/* ---------- Game stage (landscape) ---------- */
const OPP_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.6" fill="currentColor"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="8" height="8" rx="1.6" fill="currentColor"/></svg>';

function decoState(d, my) {
  const b = d.boards[my];
  const key = roomCode + ':' + d.gameNo + ':' + d.round + ':' + my;
  if (ui.planKey !== key || !ui.plan) { ui.plan = [undefined, undefined, undefined, undefined, undefined]; ui.planKey = key; }
  const w = b.wall.slice();
  const cells = [], gains = [null, null, null, null, null];
  let cand = null;
  for (const r of R5) {
    const L = b.lines[r];
    if (L.n !== r + 1) continue;
    if (ui.plan[r] === undefined) {
      const opts = Engine.grayOptions(w, r, L.c);
      if (!opts.length) { ui.plan[r] = -1; gains[r] = 0; continue; }
      cand = { r, opts };
      break;
    }
    if (ui.plan[r] >= 0) { w[r * 5 + ui.plan[r]] = L.c; cells.push([r, ui.plan[r], L.c]); gains[r] = Engine.scoreAt(w, r, ui.plan[r]); } else gains[r] = 0;
  }
  return { cand, cells, gains };
}

function myBoardHTML(d, my, active) {
  const b = d.boards[my];
  let view = b, ghostFrom = null, valid = null, gains = null, cand = null, planCells = null, cur = null, proj = '';
  if (d.status === 'play') {
    if (ui.staged) {
      view = Engine.clone(b);
      const lid = [0, 0, 0, 0, 0];
      if (ui.staged.src === 'c' && d.tokenInCenter) Engine.addFloor(view, lid, Engine.TOKEN);
      Engine.placeOnBoard(view, lid, ui.staged.color, Engine.countIn(d, ui.staged.src, ui.staged.color), ui.staged.line);
      ghostFrom = b;
    }
    if (active && ui.sel) valid = R5.filter((r) => Engine.canPlace(b, r, ui.sel.color));
    const p = Engine.projection(view, d.mode);
    gains = p.gains;
    const wallPts = p.gains.reduce((a, v) => a + (v || 0), 0);
    proj = `<div class="proj"><span>Fin de manche : ${d.mode === 'gray' ? 'jusqu’à ' : ''}<b>+${wallPts}</b>${p.rawPenalty ? `, plancher <b>−${p.rawPenalty}</b>` : ''}</span><span>→ <b>${Math.max(0, b.score + p.total)}</b></span></div>`;
  } else if (d.status === 'decorate' && !(d.deco && d.deco[my])) {
    const st = decoState(d, my);
    gains = st.gains; cand = st.cand; planCells = st.cells; cur = st.cand ? st.cand.r : null;
    proj = `<div class="proj"><span>Tuiles posées : <b>+${st.gains.reduce((a, v) => a + (v || 0), 0)}</b></span><span>plancher déduit ensuite</span></div>`;
  }
  return `<section class="gcard plateau" id="myboard"><div class="gh"><span class="eyebrow">Manche ${d.round} · ${modeName(d.mode)}</span><span class="num"><b>${b.score}</b> pts</span></div>${boardHTML(view, { mode: d.mode, ghostFrom, valid, gains, cand, planCells, cur })}${proj}</section>`;
}

function sourcesHTML(d, active) {
  const fabs = d.factories.map((f, i) => {
    const inner = f.map((k) => {
      const sel = ui.sel && ui.sel.src === 'f' + i && ui.sel.color === k;
      const dim = ui.sel && ui.sel.src === 'f' + i && !sel;
      return `<span class="pick ${sel ? 'sel' : ''} ${dim ? 'dim' : ''}">${tile(k)}</span>`;
    }).join('');
    return `<button class="fab" data-act="zoom" data-i="${i}" ${f.length ? '' : 'disabled'} aria-label="Agrandir la fabrique ${i + 1}"><span class="lbl">${i + 1}</span>${inner}</button>`;
  }).join('');
  let centre = '';
  if (d.tokenInCenter) centre += `<span class="pick ${ui.sel && ui.sel.src === 'c' ? 'sel' : ''}">${tile(Engine.TOKEN)}</span>`;
  centre += d.center.map((k) => {
    const sel = ui.sel && ui.sel.src === 'c' && ui.sel.color === k;
    const dim = ui.sel && ui.sel.src === 'c' && !sel;
    return `<button class="pick ${sel ? 'sel' : ''} ${dim ? 'dim' : ''}" data-act="pick" data-src="c" data-k="${k}" ${active ? '' : 'disabled'} aria-label="${ADJ[k][0]} du centre">${tile(k)}</button>`;
  }).join('');
  if (!d.center.length) centre += '<span class="empty">Centre vide</span>';
  return `<div class="fabs">${fabs}</div><div class="centre" aria-label="Centre">${centre}</div>`;
}

function lastStripHTML(d, my) {
  const L = d.last;
  if (!L || L.round !== d.round || d.status !== 'play' || L.seat === my) return '';
  const src = L.src === 'c' ? 'du centre' : `de F${+L.src.slice(1) + 1}`;
  const dest = L.line >= 0 ? `ligne ${L.line + 1}` : 'plancher';
  const extra = (L.over && L.line >= 0 ? ` (+${L.over} plancher)` : '') + (L.tookToken ? ', jeton 1er' : '');
  return `<button class="last" data-act="opp">${tile(L.color)}<span><b>${esc(nm(L.seat))}</b> : ${tiles(L.count, L.color)} ${src} → ${dest}${extra}</span></button>`;
}

function actionHTML(d, s) {
  const opp = nm(1 - s);
  const offline = conn ? '' : '<p class="msg warn">Hors ligne : reconnexion en cours…</p>';
  if (d.status === 'play') {
    if (d.turn !== s) return `${offline}<p class="msg muted">Au tour de ${esc(opp)}.</p>`;
    if (!ui.sel) return `${offline}<p class="msg"><b>À toi.</b> Touche une fabrique ou une tuile du centre.</p>`;
    const n = Engine.countIn(d, ui.sel.src, ui.sel.color);
    if (!ui.staged) return `${offline}<p class="msg">${tiles(n, ui.sel.color)} : touche une ligne ou le plancher.</p><div class="row"><button class="btn" data-act="cancel">Annuler</button></div>`;
    const line = ui.staged.line;
    const room_ = line >= 0 ? line + 1 - d.boards[s].lines[line].n : 0;
    const over = line >= 0 ? Math.max(0, n - room_) : n;
    const dest = line >= 0 ? `ligne ${line + 1}${over ? `, ${over} au plancher` : ''}` : 'plancher';
    return `${offline}<p class="msg">${tiles(n, ui.staged.color)} → ${dest}</p><div class="row"><button class="btn" data-act="cancel">Annuler</button><button class="btn primary" data-act="confirm" ${ui.pending ? 'disabled' : ''}>${ui.pending ? 'Envoi…' : 'Valider'}</button></div>`;
  }
  if (d.status === 'decorate') {
    if (d.deco && d.deco[s]) return `${offline}<p class="msg muted">Mur envoyé. ${esc(cap(opp))} place encore ses tuiles.</p>`;
    const st = decoState(d, s);
    if (st.cand) return `${offline}<p class="msg">Ligne ${st.cand.r + 1} : touche une case encadrée du mur.</p><div class="row"><button class="btn" data-act="decoReset">Recommencer</button></div>`;
    return `${offline}<p class="msg">Placement terminé.</p><div class="row"><button class="btn" data-act="decoReset">Recommencer</button><button class="btn primary" data-act="decoSubmit" ${ui.pending ? 'disabled' : ''}>${ui.pending ? 'Envoi…' : 'Valider le mur'}</button></div>`;
  }
  return '';
}

function zoomOV(d, active) {
  const i = ui.zoom;
  const f = d.factories[i];
  const pick = (k) => {
    const sel = ui.sel && ui.sel.src === 'f' + i && ui.sel.color === k;
    return `<button class="pick ${sel ? 'sel' : ''}" data-act="pick" data-src="f${i}" data-k="${k}" ${active ? '' : 'disabled'} aria-label="${ADJ[k][0]}">${tile(k)}</button>`;
  };
  const counts = [...new Set(f)].map((k) => tiles(f.filter((x) => x === k).length, k)).join(' · ');
  return `<div class="ov zoom" data-act="closeOv"><div class="zcap"><b>Fabrique ${i + 1}</b><span>${active ? 'Touche une couleur pour la prendre' : 'Ce n’est pas ton tour'}</span><span class="small">${counts}</span><span class="zclose">Touche en dehors pour fermer</span></div>
  <div class="zfab" data-act="noop">${f.map(pick).join('')}</div></div>`;
}

function oppOV(d, my) {
  const o = 1 - my;
  const L = d.last;
  const just = L && L.round === d.round && L.seat === o ? L.line : null;
  return `<div class="ov" data-act="closeOv"><div class="ovp plateau oppv" data-act="noop">
    <div class="gh"><span class="whoami sm">${em(o)}<b>${esc(nm(o))}</b></span><span class="num"><b>${d.boards[o].score}</b> pts</span><button class="iconbtn" data-act="closeOv" aria-label="Fermer">×</button></div>
    ${boardHTML(d.boards[o], { mode: d.mode, just, size: 'opp' })}
    ${just != null ? '<p class="small muted">Encadré jaune : son dernier coup.</p>' : ''}</div></div>`;
}

function menuOV(d) {
  const abandon = ui.confirmAbandon
    ? `<p class="small">La partie sera close sans vainqueur. Confirmer ?</p><div class="row"><button class="btn" data-act="abandonNo">Non</button><button class="btn danger" data-act="abandonYes">Abandonner</button></div>`
    : '<button class="btn danger" data-act="abandon">Abandonner la partie</button>';
  return `<div class="ov" data-act="closeOv"><div class="ovp menu" data-act="noop">
    <div class="card-h"><h2>Salon <span class="mono">${roomCode}</span></h2><button class="iconbtn" data-act="closeOv" aria-label="Fermer">×</button></div>
    ${howHTML()}
    <div class="row"><button class="btn" data-act="home">Accueil</button>${''}</div>
    ${abandon}</div></div>`;
}

function summaryOV(d, my) {
  const rs = d.roundSummary;
  const o = 1 - my;
  const col = (s) => ({ wall: rs.seats[s].gains.reduce((a, v) => a + (v || 0), 0), pen: rs.seats[s].penalty, end: rs.seats[s].end });
  const a = col(my), b = col(o);
  return `<div class="ov" data-act="closeSummary"><div class="ovp" data-act="noop">
    <div class="card-h"><h2>Fin de la manche ${rs.round}</h2><button class="iconbtn" data-act="closeSummary" aria-label="Fermer">×</button></div>
    <table class="sum"><thead><tr><th></th><th>${esc(nm(my))}</th><th>${esc(nm(o))}</th></tr></thead><tbody>
    <tr><td>Tuiles posées</td><td>+${a.wall}</td><td>+${b.wall}</td></tr>
    <tr><td>Plancher</td><td>−${a.pen}</td><td>−${b.pen}</td></tr>
    <tr><td>Score</td><td>${a.end}</td><td>${b.end}</td></tr></tbody></table>
    <button class="btn primary" data-act="closeSummary">Manche ${d.round}</button></div></div>`;
}

function stageHTML() {
  const d = game;
  const s = mySeat();
  const o = 1 - s;
  const active = conn && !ui.pending;
  const turn = d.status === 'play' ? d.turn : -1;
  const pill = (x) => `<div class="pill ${turn === x ? 'turn' : ''}">${em(x)}<span class="pn">${esc(nm(x))}</span><b class="num">${d.boards[x].score}</b></div>`;
  const src = d.status === 'play'
    ? sourcesHTML(d, active && d.turn === s)
    : `<div class="decohelp"><h2>Décoration du mur</h2><p class="small">Mur gris : pour chaque ligne complète, de haut en bas, touche la case où poser la tuile. Une couleur ne peut apparaître qu’une fois par ligne et par colonne.</p></div>`;
  let ov = '';
  if (ui.zoom != null && d.status === 'play' && d.factories[ui.zoom] && d.factories[ui.zoom].length) ov = zoomOV(d, active && d.turn === s);
  else if (ui.ov === 'opp') ov = oppOV(d, s);
  else if (ui.ov === 'menu') ov = menuOV(d);
  else if (ui.ov === 'summary' && d.roundSummary) ov = summaryOV(d, s);
  return `<div class="g-left">${myBoardHTML(d, s, active)}</div>
  <div class="g-right">
    <div class="g-top">${pill(s)}<button class="pill-btn" data-act="opp" aria-label="Voir le plateau de ${esc(nm(o))}">${pill(o)}</button>
      <button class="iconbtn" data-act="opp" aria-label="Voir le plateau de ${esc(nm(o))}">${OPP_ICON}</button>
      <button class="iconbtn" data-act="menu" aria-label="Menu">⋯</button></div>
    ${lastStripHTML(d, s)}
    <div class="g-src">${src}</div>
    <div class="g-act">${actionHTML(d, s)}</div>
  </div>${ov}`;
}

/* ---------- Render ---------- */
function screen() {
  if (!backend) return 'setup';
  if (!me() || ui.profileScreen) return 'profile';
  if (!roomCode) return 'lobby';
  if (room === undefined || !game) return 'loading';
  const s = mySeat();
  if (s < 0) return 'full';
  if (!players()[1]) return 'waiting';
  if (game.status === 'over') return 'result';
  return 'game';
}

function render() {
  const ae = document.activeElement;
  const focusId = ae && ae.id && ae.tagName === 'INPUT' ? ae.id : null;
  const caret = focusId ? [ae.selectionStart, ae.selectionEnd] : null;
  draw();
  if (focusId) {
    const el = $(focusId);
    if (el && el !== ae) { el.focus(); try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text field */ } }
  }
}

function draw() {
  const sc = screen();
  const page = $('page'), stage = $('stage');
  const inGame = sc === 'game';
  document.body.classList.toggle('in-game', inGame);
  if (inGame) {
    page.hidden = true;
    if (page.firstChild) page.innerHTML = '';
    stage.hidden = false;
    $('stage-in').innerHTML = stageHTML();
    if ($('toast').parentNode !== stage) stage.appendChild($('toast'));
    layoutStage();
    return;
  }
  stage.hidden = true;
  $('stage-in').innerHTML = '';
  if ($('toast').parentNode !== document.body) document.body.appendChild($('toast'));
  page.hidden = false;
  const html = {
    setup: setupHTML, profile: profileHTML, lobby: lobbyHTML, waiting: waitingHTML, result: resultHTML, full: fullHTML,
    loading: () => '<p class="muted pad">Connexion au salon…</p>',
  }[sc]();
  page.innerHTML = `<main class="wrap">${html}</main>`;
}

// The game is laid out in landscape. When the browser stays in portrait (rotation lock), the stage is
// rotated 90° so the player simply turns the phone to the left.
function layoutStage() {
  const st = $('stage');
  if (st.hidden) return;
  const w = window.innerWidth, h = window.innerHeight;
  const rot = h > w;
  const SW = rot ? h : w, SH = rot ? w : h;
  st.classList.toggle('rot', rot);
  st.style.width = SW + 'px';
  st.style.height = SH + 'px';
  st.style.transform = rot ? `translateX(${w}px) rotate(90deg)` : 'none';
  const cs = getComputedStyle(st);
  const AW = SW - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const AH = SH - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  st.style.setProperty('--AW', AW + 'px');
  st.style.setProperty('--AH', AH + 'px');
}
let layoutTimer = null;
function relayout() { layoutStage(); clearTimeout(layoutTimer); layoutTimer = setTimeout(layoutStage, 250); }
window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', relayout);

/* ---------- Room lifecycle ---------- */
function openRoom(code) {
  closeRoom();
  roomCode = code;
  room = undefined;
  game = null;
  rememberRoom(code);
  resetSel();
  unwatch = backend.watch(code, onRoom, () => toast('Connexion au salon perdue. Recharge la page.'));
  render();
}
function closeRoom() {
  if (unwatch) unwatch();
  unwatch = null; roomCode = null; room = undefined; game = null;
  ui.ov = null; ui.zoom = null; ui.rematchMode = null; ui.confirmAbandon = false; ui.myTurnPrev = false;
  document.title = BASE_TITLE;
}
function goHome() { closeRoom(); ui.roomInfo = {}; render(); window.scrollTo(0, 0); }

function onRoom(r) {
  if (!r) {
    const code = roomCode;
    forgetRoom(code);
    closeRoom();
    toast(`Le salon ${code} n’existe plus.`);
    render();
    return;
  }
  room = r;
  try { game = JSON.parse(r.game); } catch (e) { game = null; }
  if (!game) { render(); return; }
  const key = roomCode + ':' + game.gameNo + ':' + game.seq;
  if (key !== ui.seqKey) { ui.seqKey = key; ui.sel = null; ui.staged = null; ui.zoom = null; ui.confirmAbandon = false; if (ui.ov === 'menu') ui.ov = null; }
  const s = mySeat();
  const rs = game.roundSummary;
  const sumKey = `faience:sum:${roomCode}:${game.gameNo}:${rs && rs.round}`;
  if (s >= 0 && game.status === 'play' && rs && rs.round === game.round - 1 && !SS.get(sumKey, false) && !ui.ov) ui.ov = 'summary';
  if (game.status === 'over') ui.ov = null;
  recordHistory();
  notifyTurn();
  render();
}

function recordHistory() {
  const s = mySeat();
  if (s < 0 || !game || game.status !== 'over' || !game.result || game.result.abandoned) return;
  const key = roomCode + ':' + (game.gameNo || 1);
  const h = LS.get(histKey(), []);
  if (h.some((x) => x.key === key)) return;
  const o = 1 - s, w = game.result.winner;
  const P = players();
  h.unshift({ key, at: game.endedAt || Date.now(), mode: game.mode, opp: { name: P[o].name, k: P[o].k }, my: game.result.final[s], their: game.result.final[o], res: w === -1 ? 't' : w === s ? 'w' : 'l' });
  LS.set(histKey(), h.slice(0, 200));
}

function notifyTurn() {
  const s = mySeat();
  const mine = s >= 0 && !!players()[1] && !!game && ((game.status === 'play' && game.turn === s) || (game.status === 'decorate' && !(game.deco && game.deco[s])));
  if (mine && !ui.myTurnPrev) { try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* unsupported */ } }
  ui.myTurnPrev = mine;
  document.title = mine ? '● À toi · ' + BASE_TITLE : BASE_TITLE;
}

// Runs fn(room, parsedGame) inside a transaction. fn returns the room to write or throws to abort.
async function roomTx(fn) {
  if (ui.pending) return false;
  ui.pending = true;
  render();
  let err = null, res = null;
  try {
    res = await backend.tx(roomCode, (cur) => {
      err = null;
      if (!cur) return cur;
      try { return fn(cur, JSON.parse(cur.game)); } catch (e) { err = e.message || String(e); return undefined; }
    });
  } catch (e) { err = 'Connexion impossible. Vérifie le réseau et réessaie.'; }
  ui.pending = false;
  if (err) toast(err);
  else if (res && res.committed && !res.room) toast('Ce salon n’existe plus.');
  render();
  return !!(res && res.committed && res.room && !err);
}

function writeGame(cur, st, prev) {
  st.seq = (prev.seq || 0) + 1;
  st.gameNo = prev.gameNo || 1;
  st.firstSeat = prev.firstSeat ?? 0;
  if (st.status === 'over' && prev.status !== 'over') {
    st.endedAt = Date.now();
    if (st.result && !st.result.abandoned) {
      const t = Object.assign({ w0: 0, w1: 0, t: 0 }, cur.tally || {});
      if (st.result.winner === -1) t.t += 1; else t['w' + st.result.winner] += 1;
      cur.tally = t;
    }
  }
  cur.game = JSON.stringify(st);
  cur.updatedAt = Date.now();
  return cur;
}

/* ---------- Actions ---------- */
async function createRoom() {
  const p = me();
  const startSeat = ui.newStart === 'me' ? 0 : ui.newStart === 'them' ? 1 : (Math.random() < 0.5 ? 0 : 1);
  const st = Engine.newGame({ mode: ui.newMode, startSeat });
  Object.assign(st, { seq: 1, gameNo: 1, firstSeat: startSeat });
  ui.pending = true;
  render();
  for (let i = 0; i < 5; i++) {
    const code = rand(5, ALPHA);
    let res;
    try {
      res = await backend.tx(code, (cur) => (cur ? undefined : {
        v: 1, code, createdAt: Date.now(), updatedAt: Date.now(),
        players: [{ id: p.id, name: p.name, k: p.k }], game: JSON.stringify(st), tally: { w0: 0, w1: 0, t: 0 },
      }));
    } catch (e) {
      ui.pending = false; toast('Connexion impossible. Vérifie le réseau et réessaie.'); render(); return;
    }
    if (res.committed) { ui.pending = false; openRoom(code); return; }
  }
  ui.pending = false;
  toast('Impossible de créer un salon. Réessaie.');
  render();
}

async function joinRoom(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5 || ![...code].every((c) => ALPHA.includes(c))) { toast('Le code fait 5 caractères, sans I, O, 0 ni 1.'); return; }
  const p = me();
  let err = null, res = null;
  ui.pending = true;
  render();
  try {
    res = await backend.tx(code, (cur) => {
      err = null;
      if (!cur) return cur;
      const P = Array.isArray(cur.players) ? cur.players : [cur.players && cur.players[0], cur.players && cur.players[1]];
      if ((P[0] && P[0].id === p.id) || (P[1] && P[1].id === p.id)) return undefined;
      if (P[1]) { err = 'Ce salon est déjà complet.'; return undefined; }
      cur.players = [P[0], { id: p.id, name: p.name, k: p.k }];
      cur.updatedAt = Date.now();
      return cur;
    });
  } catch (e) { err = 'Connexion impossible. Vérifie le réseau et réessaie.'; }
  ui.pending = false;
  if (err) { toast(err); render(); return; }
  if (!res || !res.room) { toast(`Aucun salon ${code}. Vérifie le code.`); render(); return; }
  ui.joinCode = '';
  openRoom(code);
}

function commitMove() {
  const mv = { ...ui.staged };
  const seq = game.seq;
  const s = mySeat();
  roomTx((cur, g) => {
    if (g.seq !== seq) throw new Error('La partie a changé entre-temps. Rejoue ton coup.');
    return writeGame(cur, Engine.applyMove(g, s, mv), g);
  });
}

const act = {
  noop() {},
  useLocal() {
    SS.set('faience:local', true);
    backend = Backends.local();
    backend.onConn((c) => { conn = c; });
    if (!SS.get('faience:me', null)) meId = null;
    boot2();
  },
  leaveLocal() { SS.del('faience:local'); location.search = ''; location.reload(); },
  setPk(el) { ui.pk = +el.dataset.v; render(); },
  createProfile() {
    const name = ui.pname.trim().replace(/\s+/g, ' ').slice(0, 18);
    if (!name) { toast('Donne un nom au profil.'); if ($('pname')) $('pname').focus(); return; }
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast('Un profil porte déjà ce nom sur ce téléphone.'); return; }
    const p = { id: 'p_' + rand(14, 'abcdefghijklmnopqrstuvwxyz0123456789'), name, k: ui.pk ?? 0, createdAt: Date.now() };
    profiles = [...profiles, p];
    LS.set('faience:profiles', profiles);
    setMe(p.id);
    ui.pname = ''; ui.pk = null; ui.profileScreen = false; ui.roomInfo = {};
    render();
    window.scrollTo(0, 0);
    afterProfile();
  },
  useProfile(el) { setMe(el.dataset.v); ui.profileScreen = false; ui.roomInfo = {}; ui.confirmDel = null; closeRoom(); render(); window.scrollTo(0, 0); afterProfile(); },
  profile() { closeRoom(); ui.profileScreen = true; ui.confirmDel = null; render(); window.scrollTo(0, 0); },
  profileClose() { ui.profileScreen = false; ui.confirmDel = null; render(); },
  delAsk(el) { ui.confirmDel = el.dataset.v; render(); },
  delNo() { ui.confirmDel = null; render(); },
  delYes(el) {
    const id = el.dataset.v;
    profiles = profiles.filter((p) => p.id !== id);
    LS.set('faience:profiles', profiles);
    LS.del('faience:rooms:' + id);
    LS.del('faience:hist:' + id);
    if (meId === id) { meId = null; SS.del('faience:me'); LS.del('faience:last'); }
    ui.confirmDel = null;
    render();
  },
  set(el) { ui[el.dataset.key] = el.dataset.v; render(); },
  createRoom() { if (!ui.pending) createRoom(); },
  join() { if (!ui.pending) joinRoom(ui.joinCode); },
  resume(el) { openRoom(el.dataset.v); window.scrollTo(0, 0); },
  forget(el) { forgetRoom(el.dataset.v); render(); },
  home() { goHome(); },
  async share() {
    const url = location.origin + location.pathname + '#' + roomCode;
    const text = `Rejoins ma partie de Faïence : code ${roomCode}`;
    if (navigator.share) {
      try { await navigator.share({ title: BASE_TITLE, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copy(url, 'Lien copié.');
  },
  copyCode() { copy(roomCode, 'Code copié.'); },
  async cancelRoom() {
    const code = roomCode;
    let res;
    try { res = await backend.tx(code, (cur) => { if (!cur) return cur; const P = Array.isArray(cur.players) ? cur.players : [cur.players[0], cur.players[1]]; return P[1] ? undefined : null; }); } catch (e) { toast('Connexion impossible.'); return; }
    if (res.committed) { forgetRoom(code); goHome(); toast('Salon fermé.'); } else toast('Ton adversaire vient de rejoindre : la partie commence.');
  },
  zoom(el) { ui.zoom = +el.dataset.i; ui.ov = null; render(); },
  pick(el) {
    const src = el.dataset.src, k = +el.dataset.k;
    const fromZoom = ui.zoom != null;
    if (!fromZoom && ui.sel && ui.sel.src === src && ui.sel.color === k) { ui.sel = null; ui.staged = null; } else { ui.sel = { src, color: k }; ui.staged = null; }
    ui.zoom = null;
    render();
  },
  line(el) { if (!ui.sel) return; ui.staged = { ...ui.sel, line: +el.dataset.line }; render(); },
  cancel() { ui.sel = null; ui.staged = null; render(); },
  confirm() { if (ui.staged && !ui.pending) commitMove(); },
  decocell(el) { ui.plan[+el.dataset.r] = +el.dataset.c; render(); },
  decoReset() { ui.plan = null; render(); },
  decoSubmit() {
    const s = mySeat(), round = game.round, gameNo = game.gameNo;
    const plan = (ui.plan || []).map((x) => (x === undefined ? null : x));
    while (plan.length < 5) plan.push(null);
    roomTx((cur, g) => {
      if (g.status !== 'decorate' || g.round !== round || g.gameNo !== gameNo) throw new Error('Cette manche a déjà été décomptée.');
      const st = Engine.clone(g);
      st.deco = st.deco || {};
      st.deco[s] = plan;
      if (st.deco[0] && st.deco[1]) Engine.finishRound(st);
      return writeGame(cur, st, g);
    }).then((ok) => { if (ok) ui.plan = null; });
  },
  opp() { ui.ov = 'opp'; ui.zoom = null; render(); },
  menu() { ui.ov = 'menu'; ui.zoom = null; ui.confirmAbandon = false; render(); },
  closeOv() { ui.ov = null; ui.zoom = null; render(); },
  closeSummary() {
    const rs = game && game.roundSummary;
    if (rs) SS.set(`faience:sum:${roomCode}:${game.gameNo}:${rs.round}`, true);
    ui.ov = null; render();
  },
  abandon() { ui.confirmAbandon = true; render(); },
  abandonNo() { ui.confirmAbandon = false; render(); },
  abandonYes() {
    const s = mySeat();
    ui.ov = null;
    roomTx((cur, g) => {
      if (g.status === 'over') throw new Error('La partie est déjà terminée.');
      const st = Engine.clone(g);
      st.status = 'over';
      st.result = { abandoned: true, by: s };
      return writeGame(cur, st, g);
    });
  },
  rematch() {
    const mode = ui.rematchMode || game.mode;
    roomTx((cur, g) => {
      if (g.status !== 'over') throw new Error('La revanche a déjà commencé.');
      const first = 1 - (g.firstSeat ?? 0);
      const st = Engine.newGame({ mode, startSeat: first });
      Object.assign(st, { seq: 1, gameNo: (g.gameNo || 1) + 1, firstSeat: first });
      cur.game = JSON.stringify(st);
      cur.updatedAt = Date.now();
      return cur;
    }).then(() => { ui.rematchMode = null; });
  },
};

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { toast(text); }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = act[el.dataset.act];
  if (fn) fn(el);
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'pname') ui.pname = t.value;
  if (t.id === 'jcode') {
    const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (v !== t.value) t.value = v;
    ui.joinCode = v;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (ui.zoom != null || ui.ov)) { ui.zoom = null; ui.ov = null; render(); }
  if (e.key === 'Enter' && e.target && e.target.id === 'pname') { e.preventDefault(); act.createProfile(); }
  if (e.key === 'Enter' && e.target && e.target.id === 'jcode') { e.preventDefault(); act.join(); }
});

/* ---------- Boot ---------- */
const hashCode = (() => {
  const m = /^#([A-Za-z0-9]{5})$/.exec(location.hash || '');
  return m ? m[1].toUpperCase() : null;
})();
if (hashCode) {
  ui.joinCode = hashCode;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
}
function afterProfile() {
  if (ui.joinCode && hashCode && ui.joinCode === hashCode && backend) { const c = ui.joinCode; ui.joinCode = ''; joinRoom(c); }
}
function boot2() {
  render();
  if (me()) afterProfile();
}
if (backend) backend.onConn((c) => { const was = conn; conn = c; if (was !== c) render(); });
window.addEventListener('pageshow', () => { if (!roomCode) { ui.roomInfo = {}; render(); } });
boot2();
