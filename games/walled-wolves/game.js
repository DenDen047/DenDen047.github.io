/* =========================================================================
   WALLED WOLVES ― 本体
   昼は街を歩いて仕事、会議で投票、夜は家に帰って役職の力を使う。
   ========================================================================= */
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const cv = $('game');
const ctx = cv.getContext('2d');

/* =========================================================================
   状態
   ========================================================================= */
const G = {
  cfg: { n: 8, nightLen: 'normal', talk: 'normal' },
  town: null, ground: null,
  actors: [], me: null, rng: Math.random,
  phase: 'title',           // title / day / meeting / vote / night / event / over
  day: 1, timer: 0, t: 0, dt: 0,
  choreTotal: 0, choreDone: 0,
  pressure: {}, publicSeerCall: null, lastAccused: -1,
  bodies: [], usedBell: false,
  meetQueue: [], meetT: 0, meetSpoke: 0, meetReason: '',
  votes: {}, myVote: -1, mySpoke: false,
  nightUsed: false, nightNote: '',
  keys: {}, touch: { on: false, dx: 0, dy: 0 },
  cam: { x: 0, y: 0, z: 1 },
  muted: false,
  actProg: 0, actTarget: null,
  overlay: null,
  running: false,
};

const LEN = { short: { day: 62, night: 44 }, normal: { day: 88, night: 62 }, long: { day: 118, night: 84 } };
const TALK = { fast: 1.9, normal: 2.9, slow: 4.2 };

/* =========================================================================
   画面切り替え
   ========================================================================= */
const SCREENS = ['title', 'setup', 'cards', 'role', 'roster', 'meeting', 'event', 'result', 'howto', 'pause'];
function show(name) {
  for (const s of SCREENS) $('screen-' + s).classList.add('hidden');
  if (name) $('screen-' + name).classList.remove('hidden');
  G.overlay = name;
}
function hideAllScreens() { show(null); }

/* =========================================================================
   音（合成のみ。ファイルは持たない）
   ========================================================================= */
let AC = null;
function beep(freq, dur, type = 'sine', vol = 0.08) {
  if (G.muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) { /* 音が出せない環境でも進行は止めない */ }
}
const SFX = {
  step: () => beep(180 + Math.random() * 40, 0.05, 'square', 0.02),
  work: () => beep(520, 0.09, 'triangle', 0.05),
  done: () => { beep(660, 0.1, 'triangle', 0.06); setTimeout(() => beep(880, 0.14, 'triangle', 0.06), 90); },
  bell: () => { beep(420, 0.6, 'sine', 0.12); setTimeout(() => beep(280, 0.9, 'sine', 0.1), 180); },
  howl: () => { beep(180, 0.5, 'sawtooth', 0.08); setTimeout(() => beep(240, 0.7, 'sawtooth', 0.07), 260); },
  kill: () => beep(90, 0.4, 'sawtooth', 0.12),
  vote: () => beep(330, 0.12, 'square', 0.05),
  win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.22, 'triangle', 0.07), i * 120)); },
  lose: () => { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => beep(f, 0.3, 'sawtooth', 0.07), i * 150)); },
};

/* =========================================================================
   起動
   ========================================================================= */
function init() {
  resize();
  window.addEventListener('resize', resize);
  bindUI();
  bindInput();
  show('title');
  requestAnimationFrame(loop);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(window.innerWidth * dpr);
  cv.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  G.vw = window.innerWidth; G.vh = window.innerHeight;
  if (G.lightC) { G.lightC.width = G.vw; G.lightC.height = G.vh; }
  // キャンバスは寸法を変えると中身が消えるので、その場で描き直す
  if (G.running && (G.phase === 'day' || G.phase === 'night')) render();
}

/* =========================================================================
   UI 結線
   ========================================================================= */
function bindUI() {
  $('btn-start').onclick = () => { show('setup'); refreshSetup(); };
  $('btn-howto').onclick = () => show('howto');
  document.querySelectorAll('[data-back="title"]').forEach(b => b.onclick = () => show('title'));
  $('btn-mute').onclick = () => {
    G.muted = !G.muted;
    $('btn-mute').textContent = G.muted ? '🔇 音 OFF' : '🔊 音 ON';
  };

  // 人数
  const setN = (v) => {
    G.cfg.n = Math.max(5, Math.min(16, v));
    $('cnt-num').textContent = G.cfg.n;
    $('cnt-range').value = G.cfg.n;
    refreshSetup();
  };
  $('cnt-minus').onclick = () => setN(G.cfg.n - 1);
  $('cnt-plus').onclick = () => setN(G.cfg.n + 1);
  $('cnt-range').oninput = (e) => setN(+e.target.value);

  $('seg-len').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('seg-len').querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); G.cfg.nightLen = b.dataset.len;
  });
  $('seg-talk').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('seg-talk').querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); G.cfg.talk = b.dataset.talk;
  });

  $('btn-tocards').onclick = () => openCards();
  $('btn-enter').onclick = () => enterTown();
  $('btn-roster-close').onclick = () => { show(null); };
  $('btn-skip').onclick = () => { submitVote(-1); };
  $('btn-ev-next').onclick = () => afterEvent();
  $('btn-again').onclick = () => { show('setup'); refreshSetup(); };
  $('btn-totitle').onclick = () => show('title');
  $('btn-resume').onclick = () => { show(null); };
  $('btn-quit').onclick = () => { G.running = false; show('title'); $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); };
}

function refreshSetup() {
  const s = roleSetup(G.cfg.n);
  const el = $('role-breakdown');
  el.innerHTML = '';
  for (const k of ROLE_ORDER) {
    if (!s[k]) continue;
    const d = document.createElement('div');
    d.className = 'bd-item';
    d.innerHTML = `<span>${ROLES[k].icon}</span><span>${ROLES[k].name}</span><b style="color:${ROLES[k].color}">${s[k]}</b>`;
    el.appendChild(d);
  }
}

/* =========================================================================
   入力
   ========================================================================= */
function bindInput() {
  window.addEventListener('keydown', (e) => {
    G.keys[e.key.toLowerCase()] = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(e.key.toLowerCase())) e.preventDefault();
    if (G.phase === 'day' || G.phase === 'night') {
      if (e.key === 'Tab') { toggleRoster(); }
      if (e.key === 'Escape') { togglePause(); }
      if (e.key === 'e' || e.key === 'E' || e.key === ' ') { /* 押しっぱなしで処理 */ }
    }
  });
  window.addEventListener('keyup', (e) => { G.keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { G.keys = {}; });

  // タッチパッド
  const pad = $('tpad'), knob = $('tpad-knob');
  let padId = null;
  const padStart = (e) => {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    padId = t.identifier ?? 'mouse';
    G.touch.on = true; padMove(e); e.preventDefault();
  };
  const padMove = (e) => {
    if (!G.touch.on) return;
    const r = pad.getBoundingClientRect();
    const list = e.changedTouches ? Array.from(e.changedTouches) : [e];
    const t = list.find(x => (x.identifier ?? 'mouse') === padId) || list[0];
    let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    G.touch.dx = dx; G.touch.dy = dy;
    knob.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
    e.preventDefault();
  };
  const padEnd = () => {
    G.touch.on = false; G.touch.dx = 0; G.touch.dy = 0;
    knob.style.transform = 'translate(-50%,-50%)';
  };
  pad.addEventListener('touchstart', padStart, { passive: false });
  pad.addEventListener('touchmove', padMove, { passive: false });
  pad.addEventListener('touchend', padEnd);
  pad.addEventListener('touchcancel', padEnd);
  pad.addEventListener('mousedown', padStart);
  window.addEventListener('mousemove', (e) => { if (G.touch.on) padMove(e); });
  window.addEventListener('mouseup', padEnd);

  document.querySelectorAll('.tbtn').forEach(b => {
    const act = b.dataset.act;
    const on = (e) => {
      e.preventDefault();
      if (act === 'use') G.keys['e'] = true;
      if (act === 'list') toggleRoster();
    };
    const off = () => { if (act === 'use') G.keys['e'] = false; };
    b.addEventListener('touchstart', on, { passive: false });
    b.addEventListener('touchend', off);
    b.addEventListener('mousedown', on);
    b.addEventListener('mouseup', off);
  });
}

function toggleRoster() {
  if (G.overlay === 'roster') { show(null); return; }
  if (G.phase !== 'day' && G.phase !== 'night') return;
  buildRoster();
  show('roster');
}
function togglePause() {
  if (G.overlay === 'pause') { show(null); return; }
  if (G.phase !== 'day' && G.phase !== 'night') return;
  $('pause-sub').textContent = `${G.day}日目・${G.phase === 'day' ? '昼' : '夜'}`;
  show('pause');
}

/* =========================================================================
   カードを引く
   ========================================================================= */
function openCards() {
  const n = G.cfg.n;
  const setup = roleSetup(n);
  const deck = [];
  for (const k of ROLE_ORDER) for (let i = 0; i < setup[k]; i++) deck.push(k);
  // シャッフル
  G.rng = makeRng((Date.now() ^ (n * 2654435761)) >>> 0);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(G.rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  G.deck = deck;

  const fan = $('card-fan');
  fan.innerHTML = '';
  const mid = (n - 1) / 2;
  deck.forEach((_, i) => {
    const c = document.createElement('div');
    c.className = 'pcard';
    const rot = (i - mid) * (n > 10 ? 3.4 : 5.2);
    c.style.transform = `rotate(${rot}deg) translateY(${Math.abs(i - mid) * (n > 10 ? 3 : 5)}px)`;
    c.innerHTML = `
      <div class="pcard-inner">
        <div class="pcard-face pcard-back">🜁</div>
        <div class="pcard-face pcard-front"></div>
      </div>`;
    c.onclick = () => pickCard(i, c, rot);
    fan.appendChild(c);
  });
  show('cards');
}

function pickCard(i, el, rot) {
  if (G.picked) return;
  G.picked = true;
  const key = G.deck[i];
  const R = ROLES[key];
  const front = el.querySelector('.pcard-front');
  front.innerHTML = `<div class="pf-icon">${R.icon}</div><div class="pf-name">${R.name}</div><div class="pf-card">${R.card}</div>`;
  el.classList.add('flipped', 'picked');
  el.style.transform = `rotate(${rot}deg) translateY(-40px) scale(1.14)`;
  beep(520, 0.12, 'triangle', 0.06);
  setTimeout(() => beep(key === 'wolf' ? 150 : 760, 0.3, key === 'wolf' ? 'sawtooth' : 'sine', 0.08), 420);

  // 残りのカードを他の住民に配る
  G.myRole = key;
  G.deck.splice(i, 1);
  setTimeout(() => { G.picked = false; buildGame(); showRole(); }, 1250);
}

/* =========================================================================
   ゲームの組み立て
   ========================================================================= */
function buildGame() {
  const n = G.cfg.n;
  G.town = buildTown(n, (Math.random() * 1e9) >>> 0);
  G.ground = bakeGround(G.town);
  G.lightC = document.createElement('canvas');
  G.lightC.width = G.vw; G.lightC.height = G.vh;
  G.lightX = G.lightC.getContext('2d');

  // キャストを抜き出してシャッフル
  const pool = CAST.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(G.rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const looks = pool.slice(0, n);

  G.actors = looks.map((look, i) => makeActor(i, look, G.town.houses[i], false));
  const myIdx = Math.floor(G.rng() * n);
  G.me = G.actors[myIdx];
  G.me.isPlayer = true;

  // 役職を割り振る。自分は引いた札、ほかは残りの札
  G.me.role = G.myRole;
  const rest = G.deck.slice();
  let k = 0;
  for (const a of G.actors) if (a !== G.me) a.role = rest[k++];

  // 仕事を配る（村人陣営のみ実際に進む。狼にも見た目のリストは渡す）
  const per = 3;
  G.choreTotal = 0;
  for (const a of G.actors) {
    const ids = CHORES.slice();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(G.rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    a.chores = ids.slice(0, per).map(c => ({ station: c.id, done: false }));
    if (a.role !== 'wolf') G.choreTotal += per;
  }
  G.choreDone = 0;

  // 初期の疑い
  for (const a of G.actors) {
    for (const o of G.actors) if (o !== a) a.suspicion[o.idx] = G.rng() * 8;
  }

  G.day = 1; G.bodies = []; G.usedBell = false;
  G.pressure = {}; G.publicSeerCall = null; G.lastAccused = -1;
}

function showRole() {
  const R = ROLES[G.myRole];
  $('rc-icon').textContent = R.icon;
  $('rc-name').textContent = R.name;
  $('rc-name').style.color = R.color;
  $('rc-card').textContent = R.card;
  $('rc-desc').textContent = R.desc;
  $('rc-youname').textContent = G.me.look.name;
  $('rc-youjob').textContent = G.me.look.job + '　／　' + TRAITS[G.me.look.trait].name;
  drawAvatarInto($('rc-avatar'), G.me, false, 2.2);

  const mates = $('rc-mates');
  if (G.myRole === 'wolf') {
    const list = G.actors.filter(a => a.role === 'wolf' && a !== G.me);
    if (list.length) {
      mates.classList.remove('hidden');
      const box = $('rc-mates-list');
      box.innerHTML = '';
      for (const m of list) {
        const d = document.createElement('div');
        d.className = 'mate-chip';
        const c = document.createElement('canvas');
        c.width = 68; c.height = 84;
        drawAvatarInto(c, m, true, 1.3);
        d.appendChild(c);
        const s = document.createElement('span');
        s.textContent = m.name;
        d.appendChild(s);
        box.appendChild(d);
      }
    } else {
      mates.classList.remove('hidden');
      $('rc-mates-list').innerHTML = '<span style="font-size:13px;color:#ff97a6">この街に狼はおまえ一匹だ。</span>';
    }
  } else {
    mates.classList.add('hidden');
  }
  show('role');
}

/* 小さなアバターを描く */
function drawAvatarInto(canvas, actor, wolf, scale) {
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.save();
  c.translate(canvas.width / 2, canvas.height * 0.94);
  const p = { x: 0, y: 0, look: actor.look, face: 'S', walkPhase: 0, moving: false, ghost: false };
  if (wolf) drawWolf(c, p, 0, { scale: scale * 0.68 });
  else drawPerson(c, p, 0, { scale });
  c.restore();
}
function makeAvatar(actor, w, h, wolf, scale) {
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const x = c.getContext('2d');
  x.scale(2, 2);
  x.save();
  x.translate(w / 2, h * 0.93);
  const p = { x: 0, y: 0, look: actor.look, face: 'S', walkPhase: 0, moving: false, ghost: !actor.alive };
  if (wolf) drawWolf(x, p, 0, { scale: (scale || 1) * 0.68 });
  else drawPerson(x, p, 0, { scale: scale || 1 });
  x.restore();
  return c;
}

/* =========================================================================
   街に出る
   ========================================================================= */
function enterTown() {
  hideAllScreens();
  $('hud').classList.remove('hidden');
  if ('ontouchstart' in window) $('touch').classList.remove('hidden');
  G.running = true;
  startDay(true);
}

function startDay(first, keepBell) {
  const wasMeeting = !first;
  G.phase = 'day';
  G.timer = LEN[G.cfg.nightLen].day;
  if (!keepBell) G.usedBell = false;
  const town = G.town;
  let seat = 0;
  const seats = G.actors.length;
  for (const a of G.actors) {
    a.wolfForm = false; a.speed = SPEED_WALK;
    a.hiding = false; a.sleeping = false; a.inHouse = null;
    a.path = []; a.job = null; a.pendingJob = null;
    a.saidThisMeeting = false;
    if (!a.alive) continue;
    if (first) {
      // 初日は自分の家の前から歩き出す
      a.x = a.house.porch.x; a.y = a.house.porch.y;
    } else if (wasMeeting) {
      // 会議のあとは広場から散っていく
      const ang = (seat / seats) * Math.PI * 2;
      a.x = town.cx + Math.cos(ang) * town.plaza.rx * 0.5;
      a.y = town.cy + Math.sin(ang) * town.plaza.ry * 0.5;
    }
    seat++;
  }
  banner(`${G.day}日目 ・ 昼`, first ? '壁の中の街に朝が来た' : '広場から、それぞれの持ち場へ');
  updateHUD();
  buildMyChores();
}

function startNight() {
  G.phase = 'night';
  G.timer = LEN[G.cfg.nightLen].night;
  G.nightFull = LEN[G.cfg.nightLen].night;
  G.nightKillDone = false;
  G.huntOpen = false;
  G.nightUsed = false;
  G.nightNote = '';
  for (const a of G.actors) {
    a.inHouse = null;
    nightPlan(a, G);
  }
  const R = ROLES[G.me.role];
  if (G.me.alive) {
    $('night-order').classList.remove('hidden');
    $('night-order').innerHTML = nightOrderText();
    banner('夜', R.night);
  } else {
    $('night-order').classList.add('hidden');
    banner('夜', 'あなたはもう見ているだけだ');
  }
  if (G.me.role === 'wolf' && G.me.alive) SFX.howl();
  updateHUD();
}

function nightOrderText() {
  switch (G.me.role) {
    case 'wolf': return '今夜の狩り　―　<b>誰かの家に入り、寝ている住人に近づいて襲う</b>';
    case 'seer': return '今夜の占い　―　<b>誰かの家の玄関先で「覗く」</b>';
    case 'knight': return '今夜の守り　―　<b>守りたい家の玄関先に立つ</b>';
    default: return '今夜　―　<b>自分の家に帰り、ベッドで寝るか物置に隠れる</b>';
  }
}

/* =========================================================================
   メインループ
   ========================================================================= */
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const now = ts / 1000;
  G.dt = Math.min(0.05, now - last || 0.016);
  last = now;
  G.t = now;

  if (!G.running) return;
  const paused = G.overlay === 'pause' || G.overlay === 'roster';

  if (!paused) {
    if (G.phase === 'day') updateDay();
    else if (G.phase === 'night') updateNight();
    else if (G.phase === 'meeting' || G.phase === 'vote') updateMeeting();
  }
  if (G.phase === 'day' || G.phase === 'night') render();
}

/* ---------- 昼 ---------- */
function updateDay() {
  G.timer -= G.dt;
  playerMove();
  for (const a of G.actors) {
    if (!a.alive || a.isPlayer) continue;
    dayThink(a, G);
    moveActor(a, G.town, G.dt);
    // 経路がぴったり合わなくても、仕事場のそばまで来ていれば手を動かし始める
    if (!a.job) startNearbyChore(a);
  }
  handlePlayerInteract();
  checkBodyDiscovery();
  updateHUD();

  if (G.choreTotal > 0 && G.choreDone >= G.choreTotal) { endGame('village', 'chores'); return; }
  if (G.timer <= 0) startNight();
}

/* ---------- 夜 ---------- */
function updateNight() {
  G.timer -= G.dt;
  // 夜の前半は誰も襲われない。占い師や騎士が持ち場に着くまでの猶予
  const wasOpen = G.huntOpen;
  G.huntOpen = G.timer <= G.nightFull * 0.55;
  if (G.huntOpen && !wasOpen && G.me.alive && G.me.role === 'wolf') {
    toast('街が寝静まった。牙を使える。', 'warn');
    $('night-order').innerHTML = '狩りの時間　―　<b>家に忍び込み、寝ている住人に近づいて襲う</b>';
  }
  playerMove();
  for (const a of G.actors) {
    if (!a.alive || a.isPlayer) continue;
    const had = a.path.length;
    moveActor(a, G.town, G.dt);
    if (had && !a.path.length) nightArrive(a, G);
  }
  runWolfHunt();
  noticeAtNight(G);
  handlePlayerInteract();
  updateHUD();
  if (G.timer <= 0) dawn();
}

/* そばにある仕事場で、自分の受け持ちが残っていれば取りかかる */
function startNearbyChore(a) {
  for (const st of G.town.stations) {
    const reach = Math.max(st.w, st.h) * 0.7 + 26;
    if (Math.hypot(a.x - st.cx, a.y - st.cy) > reach) continue;
    const c = a.chores.find(x => !x.done && x.station === st.key);
    if (!c && a.role !== 'wolf') continue;
    const def = CHORES.find(d => d.id === st.key);
    a.job = { key: st.key, station: st };
    a.jobT = def ? def.secs : 3;
    a.pendingJob = null;
    return;
  }
}

/* 夜が更けてから、狼が一匹だけ牙を使う。
   プレイヤーが狼のときは AI に譲らせ、襲うかどうかを本人に委ねる */
function runWolfHunt() {
  if (!G.huntOpen || G.nightKillDone) return;
  if (G.me.alive && G.me.role === 'wolf') return;
  for (const a of G.actors) {
    if (!a.alive || a.isPlayer || a.role !== 'wolf' || !a.readyHunt || a.hunted) continue;
    a.hunted = true;
    const t = a.nightTarget;
    if (t && t.alive) { resolveAttack(a, t); return; }
  }
}

/* ---------- 移動（プレイヤー） ---------- */
function playerMove() {
  const me = G.me;
  if (!me.alive && !me.ghost) return;
  let dx = 0, dy = 0;
  const k = G.keys;
  if (k['a'] || k['arrowleft']) dx -= 1;
  if (k['d'] || k['arrowright']) dx += 1;
  if (k['w'] || k['arrowup']) dy -= 1;
  if (k['s'] || k['arrowdown']) dy += 1;
  if (G.touch.on) { dx += G.touch.dx; dy += G.touch.dy; }
  const m = Math.hypot(dx, dy);
  if (m > 0.001) {
    dx /= m; dy /= m;
    const sp = (me.wolfForm ? SPEED_WOLF : SPEED_WALK) * (me.ghost ? 1.25 : 1) * G.dt;
    if (me.ghost) { me.x += dx * sp; me.y += dy * sp; }
    else stepWithCollision(me, dx * sp, dy * sp, G.town);
    me.x = Math.max(30, Math.min(G.town.w - 30, me.x));
    me.y = Math.max(30, Math.min(G.town.h - 30, me.y));
    me.moving = true;
    me.walkPhase += G.dt * 11;
    if (Math.abs(dx) > Math.abs(dy)) me.face = dx > 0 ? 'E' : 'W';
    else me.face = dy > 0 ? 'S' : 'N';
    if (me.hiding || me.sleeping) { me.hiding = false; me.sleeping = false; }
  } else {
    me.moving = false;
  }
  // 家に入っているか
  me.inHouse = G.town.houses.find(h => insideHouse(h, me.x, me.y)) || null;
}

/* =========================================================================
   その場で使えること
   ========================================================================= */
function findInteraction() {
  const me = G.me;
  if (!me.alive) return null;
  const near = (x, y, r) => Math.hypot(x - me.x, y - me.y) < r;

  if (G.phase === 'day') {
    // 死体
    for (const b of G.bodies) {
      if (!b.found && near(b.x, b.y, 46)) {
        return { kind: 'body', text: `${b.name}の遺体を調べる`, body: b, instant: true };
      }
    }
    // 鐘楼
    const bell = G.town.stations.find(s => s.kind === 'bell');
    if (bell && near(bell.cx, bell.cy + 20, 62) && !G.usedBell) {
      return { kind: 'bell', text: '鐘を鳴らして全員を呼ぶ', instant: true };
    }
    // 仕事場
    for (const s of G.town.stations) {
      if (s.kind === 'bell') continue;
      if (!near(s.cx, s.cy + s.h * 0.4, Math.max(s.w, s.h) * 0.72 + 18)) continue;
      const def = CHORES.find(c => c.id === s.key);
      if (!def) continue;
      const mine = me.chores.find(c => c.station === s.key);
      if (mine && mine.done) return { kind: 'none', text: `${def.name}（済んだ）`, disabled: true };
      const fake = me.role === 'wolf' || !mine;
      return {
        kind: 'work', station: s, def, fake,
        text: fake ? `${def.name}（ふりをする）` : def.name,
        secs: def.secs,
      };
    }
    return null;
  }

  if (G.phase === 'night') {
    if (G.nightUsed) return null;
    const role = me.role;
    if (role === 'villager') {
      const h = me.house;
      if (insideHouse(h, me.x, me.y)) {
        if (near(h.bedC.x, h.bedC.y, 34)) return { kind: 'sleep', text: 'ベッドで眠る', instant: true };
        if (near(h.chestC.x, h.chestC.y, 30)) return { kind: 'hide', text: '物置に隠れる', instant: true };
      }
      return null;
    }
    if (role === 'seer') {
      for (const h of G.town.houses) {
        if (h === me.house) continue;
        if (near(h.porch.x, h.porch.y, 44)) {
          const o = G.actors.find(a => a.house === h);
          return { kind: 'peek', house: h, text: `${o.name}の家を覗く`, secs: 1.6 };
        }
      }
      return null;
    }
    if (role === 'knight') {
      for (const h of G.town.houses) {
        if (h === me.house) continue;
        if (near(h.porch.x, h.porch.y, 44)) {
          const o = G.actors.find(a => a.house === h);
          return { kind: 'guard', house: h, text: `${o.name}の家を守る`, secs: 1.4 };
        }
      }
      return null;
    }
    if (role === 'wolf') {
      for (const a of G.actors) {
        if (!a.alive || a === me || a.role === 'wolf') continue;
        if (!near(a.x, a.y, 40)) continue;
        if (!G.huntOpen) return { kind: 'none', text: 'まだ人の気配がある。寝静まるまで待て', disabled: true };
        return { kind: 'kill', victim: a, text: `${a.name}に襲いかかる`, secs: 1.1 };
      }
      return null;
    }
  }
  return null;
}

function handlePlayerInteract() {
  const it = findInteraction();
  const pr = $('prompt'), bar = $('act-bar');

  if (!it || it.disabled) {
    pr.classList.toggle('hidden', !it);
    if (it && it.disabled) { $('prompt-text').textContent = it.text; $('prompt-key').textContent = '―'; }
    G.actProg = 0; G.actTarget = null;
    bar.classList.add('hidden');
    return;
  }

  $('prompt-key').textContent = 'E';
  $('prompt-text').textContent = it.text;
  pr.classList.remove('hidden');

  const pressed = G.keys['e'] || G.keys[' '];
  if (!pressed) { G.actProg = 0; G.actTarget = null; bar.classList.add('hidden'); return; }

  if (it.instant) {
    G.keys['e'] = false; G.keys[' '] = false;
    doInteraction(it);
    return;
  }

  // 長押しゲージ
  if (!G.actTarget || G.actTarget !== it.kind + (it.station?.key || it.house?.idx || it.victim?.idx || '')) {
    G.actTarget = it.kind + (it.station?.key || it.house?.idx || it.victim?.idx || '');
    G.actProg = 0;
  }
  G.actProg += G.dt / it.secs;
  bar.classList.remove('hidden');
  $('act-fill').style.width = Math.min(100, G.actProg * 100) + '%';
  $('act-text').textContent = it.text;
  if (Math.random() < 0.2) SFX.work();
  if (G.actProg >= 1) {
    G.actProg = 0; G.actTarget = null;
    bar.classList.add('hidden');
    G.keys['e'] = false; G.keys[' '] = false;
    doInteraction(it);
  }
}

function doInteraction(it) {
  const me = G.me;
  switch (it.kind) {
    case 'work': {
      if (!it.fake) {
        const c = me.chores.find(x => x.station === it.station.key);
        if (c && !c.done) { c.done = true; me.choreDone++; G.choreDone++; SFX.done(); toast(`${it.def.name}　完了`, 'good'); }
      } else {
        toast('仕事をしているように見せた');
      }
      buildMyChores();
      break;
    }
    case 'bell': {
      G.usedBell = true;
      SFX.bell();
      openMeeting('bell', null);
      break;
    }
    case 'body': {
      it.body.found = true;
      SFX.bell();
      openMeeting('body', it.body);
      break;
    }
    case 'sleep': {
      me.sleeping = true; me.hiding = false; G.nightUsed = true;
      G.nightNote = 'ベッドで眠った';
      toast('ベッドに入った。朝まで動かない。');
      $('night-order').innerHTML = '眠っている　―　<b>動くと目が覚める</b>';
      break;
    }
    case 'hide': {
      me.hiding = true; me.sleeping = false; G.nightUsed = true;
      G.nightNote = '物置に隠れた';
      toast('物置に身を潜めた。牙は一度だけかわせる。', 'good');
      $('night-order').innerHTML = '物置に隠れている　―　<b>動くと出てしまう</b>';
      break;
    }
    case 'peek': {
      const o = G.actors.find(a => a.house === it.house);
      G.nightUsed = true;
      me.seerResults[o.idx] = o.role === 'wolf' ? 'wolf' : 'human';
      me.lastPeek = o.idx;
      G.nightNote = `${o.name}を占った`;
      if (o.role === 'wolf') {
        toast(`${o.name}は【人狼】だ`, 'warn');
        flash('red');
        SFX.howl();
      } else {
        toast(`${o.name}は人だ`, 'good');
      }
      $('night-order').innerHTML = `占い終わり　―　<b>${o.name}は ${o.role === 'wolf' ? '人狼' : '人'}</b>`;
      break;
    }
    case 'guard': {
      const o = G.actors.find(a => a.house === it.house);
      G.nightUsed = true;
      me.guarding = it.house;
      me.lastGuard = o.idx;
      G.nightNote = `${o.name}の家を守った`;
      toast(`${o.name}の家を守っている`, 'good');
      $('night-order').innerHTML = `見張り中　―　<b>${o.name}の家</b>`;
      break;
    }
    case 'kill': {
      G.nightUsed = true;
      resolveAttack(me, it.victim);
      break;
    }
    default: break;
  }
}

/* =========================================================================
   襲撃の判定
   ========================================================================= */
function resolveAttack(wolf, victim) {
  G.nightKillDone = true;
  // 騎士が玄関先にいれば追い返される
  const guard = G.actors.find(a =>
    a.alive && a.role === 'knight' && a !== victim &&
    ((a.guarding === victim.house) || (a.nightAction === 'guard' && a.nightTarget === victim)) &&
    Math.hypot(a.x - victim.house.porch.x, a.y - victim.house.porch.y) < 90);
  if (guard) {
    if (wolf.isPlayer) { toast(`${guard.name}が立ちはだかった。逃げるしかない。`, 'warn'); flash('gold'); }
    if (guard.isPlayer) { toast('狼を追い返した！', 'good'); flash('gold'); }
    wolf.blocked = true;
    guard.blockedWolf = wolf.idx;
    guard.suspicion[wolf.idx] = (guard.suspicion[wolf.idx] || 0) + 150;
    if (!wolf.isPlayer) { wolf.path = []; wolf.x = wolf.house.bedC.x; wolf.y = wolf.house.bedC.y; wolf.inHouse = wolf.house; }
    return;
  }
  // 物置に隠れていれば一度だけかわす
  if (victim.hiding && !victim.hidBurned) {
    victim.hidBurned = true;      // 隠れてやり過ごせるのは一度きり
    if (wolf.isPlayer) { toast(`${victim.name}はどこにもいない。物置か……`, 'warn'); }
    if (victim.isPlayer) { toast('すぐ横を、獣が通り過ぎた。もう二度は効かない。', 'warn'); flash('red'); }
    if (!wolf.isPlayer) { wolf.path = []; wolf.x = wolf.house.bedC.x; wolf.y = wolf.house.bedC.y; wolf.inHouse = wolf.house; }
    return;
  }
  killActor(victim, 'night');
  if (wolf.isPlayer) { toast(`${victim.name}を仕留めた`, 'warn'); flash('red'); SFX.kill(); }
  if (!wolf.isPlayer) { wolf.path = []; wolf.x = wolf.house.bedC.x; wolf.y = wolf.house.bedC.y; wolf.inHouse = wolf.house; }
}

function killActor(a, how) {
  a.alive = false;
  a.deathNight = G.day;
  a.path = [];
  handOverChores(a);
  a.bodyX = a.x; a.bodyY = a.y;
  // 追放された者は壁の外へ出されるので、街に遺体は残らない
  if (how === 'night') {
    G.bodies.push({ idx: a.idx, name: a.name, x: a.x, y: a.y, found: false, day: G.day, look: a.look });
  }
  if (!a.isPlayer) buildMyChores();
  if (a.isPlayer) {
    a.ghost = true;
    flash('red');
    SFX.kill();
    banner('殺された', how === 'night' ? '牙は闇の中から来た' : '壁の外へ追われた');
    toast('あなたは死んだ。だが、街の行く末は見届けられる。', 'warn');
  }
}

/* 死んだ者の受け持ちは、残った住民が引き継ぐ。
   でなければ村の仕事はもう終わらず、村人側の勝ち筋がひとつ消えてしまう */
function handOverChores(dead) {
  if (dead.role === 'wolf') return;
  const heirs = G.actors.filter(x => x.alive && x.role !== 'wolf' && x !== dead);
  if (!heirs.length) return;
  const left = dead.chores.filter(c => !c.done);
  left.forEach((c, i) => {
    heirs[i % heirs.length].chores.push({ station: c.station, done: false });
    c.done = true;          // 死者の一覧からは消す（総数は変えない）
  });
}

/* 昼、死体のそばを AI が通ったら見つける */
function checkBodyDiscovery() {
  for (const b of G.bodies) {
    if (b.found) continue;
    for (const a of G.actors) {
      if (!a.alive || a.isPlayer) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 62 && hasLineOfSight(a, { x: b.x, y: b.y }, G.town)) {
        b.found = true;
        b.finder = a.idx;
        openMeeting('body', b);
        return;
      }
    }
  }
}

/* =========================================================================
   夜明け
   ========================================================================= */
function dawn() {
  $('night-order').classList.add('hidden');
  for (const a of G.actors) { a.wolfForm = false; a.speed = SPEED_WALK; a.guarding = null; a.blocked = false; }

  // 夜に占い師が見たものを記録（AI用）
  for (const a of G.actors) {
    if (a.role === 'seer' && a.alive && a.nightTarget) a.lastPeek = a.nightTarget.idx;
    if (a.role === 'knight' && a.alive && a.nightTarget) a.lastGuard = a.nightTarget.idx;
  }

  const w = checkWin();
  if (w) { endGame(w.team, w.why); return; }

  const fresh = G.bodies.filter(b => b.day === G.day && !b.found);
  if (fresh.length) {
    for (const b of fresh) b.found = true;
    G.day++;
    openMeeting('dawn', fresh[0]);
  } else {
    G.day++;
    startDay(false);
    banner('朝', '今夜は誰も死ななかった');
  }
}

/* =========================================================================
   会議
   ========================================================================= */
function openMeeting(reason, body) {
  G.meetFrom = G.phase;        // 'day' なら昼の途中の会議、'night' なら夜明けの会議
  G.phase = 'meeting';
  G.meetReason = reason;
  G.pressure = {};
  G.publicSeerCall = null;
  G.lastAccused = -1;
  G.beastCalled = {};
  G.votes = {}; G.myVote = -1; G.mySpoke = false;
  for (const a of G.actors) a.saidThisMeeting = false;
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');

  const titles = {
    bell: '緊急招集', body: '遺体発見', dawn: '朝の集会',
  };
  $('meet-title').textContent = titles[reason] || '集会';
  let sub = '';
  if (reason === 'bell') sub = `${G.me.name}が鐘を鳴らした。全員が広場に集まる。`;
  else if (reason === 'body') sub = `${body.name}の遺体が見つかった。`;
  else sub = `朝、${body ? body.name + 'が家の中で息絶えているのが見つかった。' : '街に人が集まった。'}`;
  $('meet-sub').textContent = sub;

  $('meet-log').innerHTML = '';
  sysLine(sub);
  if (G.me.alive && G.me.role === 'seer' && G.me.lastPeek !== undefined) {
    const o = G.actors[G.me.lastPeek];
    sysLine(`（昨夜あなたが覗いたのは ${o.name}　―　${G.me.seerResults[o.idx] === 'wolf' ? '人狼' : '人'}）`);
  }

  // 発言順を決める
  const speakers = G.actors.filter(a => a.alive && !a.isPlayer);
  for (let i = speakers.length - 1; i > 0; i--) {
    const j = Math.floor(G.rng() * (i + 1));
    [speakers[i], speakers[j]] = [speakers[j], speakers[i]];
  }
  G.meetQueue = speakers;
  G.meetT = 1.1;
  G.timer = 999;

  buildSeats();
  buildSayOptions();
  $('vote-box').classList.add('hidden');
  $('say-box').classList.remove('hidden');
  $('meet-timer').textContent = '―';
  $('meet-timer').classList.remove('urgent');
  show('meeting');
  SFX.bell();
}

function sysLine(text) {
  const log = $('meet-log');
  const d = document.createElement('div');
  d.className = 'line sys';
  d.innerHTML = `<div class="line-text">${text}</div>`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

function speechLine(actor, text, mine) {
  const log = $('meet-log');
  const d = document.createElement('div');
  d.className = 'line' + (mine ? ' me' : '');
  const av = makeAvatar(actor, 36, 46, false, 0.86);
  d.appendChild(av);
  const b = document.createElement('div');
  b.className = 'line-body';
  b.innerHTML = `<div class="line-name">${actor.name}　<span style="color:#6d6a60">${actor.look.job}</span></div>
                 <div class="line-text">${text}</div>`;
  d.appendChild(b);
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  beep(300 + Math.random() * 120, 0.05, 'square', 0.02);
}

function updateMeeting() {
  if (G.phase === 'meeting') {
    G.meetT -= G.dt;
    if (G.meetT > 0) return;
    if (G.meetQueue.length === 0) { openVote(); return; }

    const a = G.meetQueue.shift();
    highlightSeat(a.idx);
    const sp = makeSpeech(a, G);
    if (sp) {
      speechLine(a, sp.text, false);
      if (sp.target >= 0) {
        G.pressure[sp.target] = (G.pressure[sp.target] || 0) + (sp.kind === 'seer_co' || sp.kind === 'seer_result' ? 26 : sp.kind === 'beast' ? 24 : 12);
        G.lastAccused = sp.target;
        // 周囲の疑いを動かす
        for (const o of G.actors) {
          if (!o.alive || o === a) continue;
          const w = TRAITS[o.look.trait].follow;
          if (sp.kind === 'seer_co' || sp.kind === 'fake_seer') {
            o.suspicion[sp.target] = (o.suspicion[sp.target] || 0) + 40 * w;
            o.trustSeer[a.idx] = (o.trustSeer[a.idx] || 0) + 1;
          } else if (sp.kind === 'seer_result') {
            const r = a.seerResults[sp.target];
            o.suspicion[sp.target] = (o.suspicion[sp.target] || 0) + (r === 'wolf' ? 46 : -34) * w;
          } else if (sp.kind === 'beast') {
            o.suspicion[sp.target] = (o.suspicion[sp.target] || 0) + 58 * w;
          } else {
            o.suspicion[sp.target] = (o.suspicion[sp.target] || 0) + 14 * w;
          }
        }
        // 票をまとめるのは「黒」を出した占いだけ。白判定で吊ってしまわないようにする
        const isBlackCall =
          sp.kind === 'fake_seer' ||
          ((sp.kind === 'seer_co' || sp.kind === 'seer_result') && a.seerResults[sp.target] === 'wolf');
        if (isBlackCall && (a.role === 'seer' || !G.publicSeerCall)) {
          G.publicSeerCall = { by: a.idx, targetIdx: sp.target, wolf: true };
        }
      }
      if (sp.kind === 'seer_co' || sp.kind === 'fake_seer' || sp.kind === 'knight_co') {
        a.claimedRole = sp.kind === 'knight_co' ? 'knight' : 'seer';
        buildSeats();
      }
    }
    G.meetT = TALK[G.cfg.talk] * (0.7 + G.rng() * 0.6);
    updateVoteCounts();
    return;
  }

  // 投票時間
  if (G.phase === 'vote') {
    G.timer -= G.dt;
    const s = Math.max(0, Math.ceil(G.timer));
    $('meet-timer').textContent = s;
    $('meet-timer').classList.toggle('urgent', s <= 10);
    if (G.timer <= 0) { finishVote(); }
  }
}

function highlightSeat(idx) {
  document.querySelectorAll('.seat').forEach(s => s.classList.remove('speaking'));
  const el = document.querySelector(`.seat[data-idx="${idx}"]`);
  if (el) el.classList.add('speaking');
}

function buildSeats() {
  const box = $('meet-seats');
  box.innerHTML = '';
  for (const a of G.actors) {
    const d = document.createElement('div');
    d.className = 'seat' + (a.alive ? '' : ' dead');
    d.dataset.idx = a.idx;
    d.appendChild(makeAvatar(a, 40, 50, false, 0.95));
    const nm = document.createElement('span');
    nm.className = 'sname';
    nm.textContent = a.name + (a === G.me ? '（あなた）' : '');
    if (a === G.me) nm.style.color = 'var(--amber)';
    if (a.claimedRole === 'seer') nm.style.color = '#9fe0ff';
    d.appendChild(nm);
    const vc = document.createElement('span');
    vc.className = 'vcount hidden';
    d.appendChild(vc);
    box.appendChild(d);
  }
}

function updateVoteCounts() {
  const count = {};
  for (const k in G.votes) { const v = G.votes[k]; if (v >= 0) count[v] = (count[v] || 0) + 1; }
  document.querySelectorAll('.seat').forEach(s => {
    const i = +s.dataset.idx;
    const vc = s.querySelector('.vcount');
    if (count[i]) { vc.textContent = count[i]; vc.classList.remove('hidden'); }
    else vc.classList.add('hidden');
  });
}

/* ---------- プレイヤーの発言 ---------- */
function buildSayOptions() {
  const box = $('say-opts');
  box.innerHTML = '';
  if (!G.me.alive) {
    box.innerHTML = '<div class="note">死んだ者に発言権はない。ただ見ていることしかできない。</div>';
    return;
  }
  const others = G.actors.filter(a => a.alive && a !== G.me);
  const opts = [];

  if (G.me.role === 'seer') {
    const known = Object.keys(G.me.seerResults);
    for (const k of known) {
      const o = G.actors[k];
      if (!o.alive) continue;
      const r = G.me.seerResults[k];
      opts.push({
        label: `🔮 占い師だと名乗る　「${o.name}は${r === 'wolf' ? '人狼' : '人'}だった」`,
        text: `私は占い師だ。昨夜${o.name}の家を覗いた。${r === 'wolf' ? 'あれは人狼だ。今日はここに票を集めてくれ。' : 'あれは人だった。白だ。'}`,
        target: +k, kind: r === 'wolf' ? 'seer_co' : 'seer_result', claim: 'seer',
      });
    }
  }
  if (G.me.role === 'knight') {
    const g = G.me.lastGuard !== undefined ? G.actors[G.me.lastGuard] : null;
    opts.push({
      label: '🛡 騎士だと名乗る',
      text: `私は騎士だ。昨夜は${g ? g.name + 'の家' : 'ある家'}の前に立っていた。`,
      target: -1, kind: 'knight_co', claim: 'knight',
    });
  }
  if (G.me.role === 'wolf') {
    const prey = others.filter(o => o.role !== 'wolf');
    if (prey.length) {
      const v = prey[Math.floor(G.rng() * prey.length)];
      opts.push({
        label: `🐺 占い師を騙る　「${v.name}が人狼だ」`,
        text: `私が占い師だ。昨夜見たのは${v.name}―― こいつが人狼だ。`,
        target: v.idx, kind: 'seer_co', claim: 'seer',
      });
    }
  }

  // 名指し
  opts.push({ label: '👉 誰かを名指しする', pickTarget: true, kind: 'accuse' });
  // 目撃
  const seen = Object.keys(G.me.seenOutAtNight || {}).filter(k => G.actors[k].alive);
  if (seen.length) {
    opts.push({ label: '👁 昨夜見たことを話す', pickTarget: true, kind: 'witness', onlySeen: true });
  }
  // 弁明
  const done = G.me.chores.filter(c => c.done);
  const place = done.length ? (CHORES.find(c => c.id === done[done.length - 1].station)?.name || '街の仕事') : '街をぶらついていた';
  opts.push({
    label: '🗣 自分のことを話す',
    text: `私は${done.length ? place + 'をしていた' : place}。それだけだ。`,
    target: -1, kind: 'defend',
  });
  opts.push({ label: '…… 黙っている', text: '……', target: -1, kind: 'silent' });

  for (const o of opts) {
    const b = document.createElement('button');
    b.className = 'say-btn';
    b.textContent = o.label;
    b.disabled = G.mySpoke;
    b.onclick = () => {
      if (G.mySpoke) return;
      if (o.pickTarget) { showTargetPicker(o); return; }
      doSay(o);
    };
    box.appendChild(b);
  }
}

function showTargetPicker(opt) {
  const box = $('say-opts');
  box.innerHTML = '';
  const lbl = document.createElement('div');
  lbl.className = 'note';
  lbl.textContent = opt.kind === 'witness' ? '昨夜、外で見かけたのは誰か' : '誰を名指しするか';
  box.appendChild(lbl);
  let list = G.actors.filter(a => a.alive && a !== G.me);
  if (opt.onlySeen) list = list.filter(a => (G.me.seenOutAtNight || {})[a.idx]);
  for (const o of list) {
    const b = document.createElement('button');
    b.className = 'say-btn';
    b.textContent = `${o.name}（${o.look.job}）`;
    b.onclick = () => {
      const text = opt.kind === 'witness'
        ? `昨夜、${o.name}が外を歩いているのを見た。家にはいなかった。`
        : `${o.name}が怪しい。私は${o.name}を疑っている。`;
      doSay({ text, target: o.idx, kind: opt.kind });
    };
    box.appendChild(b);
  }
  const back = document.createElement('button');
  back.className = 'say-btn';
  back.textContent = '← 戻る';
  back.onclick = () => buildSayOptions();
  box.appendChild(back);
}

function doSay(o) {
  G.mySpoke = true;
  speechLine(G.me, o.text, true);
  if (o.claim) { G.me.claimedRole = o.claim; buildSeats(); }
  if (o.target >= 0) {
    G.pressure[o.target] = (G.pressure[o.target] || 0) + (o.kind === 'seer_co' ? 26 : 12);
    G.lastAccused = o.target;
    for (const a of G.actors) {
      if (!a.alive || a === G.me) continue;
      const w = TRAITS[a.look.trait].follow;
      const amt = o.kind === 'seer_co' ? 44 : o.kind === 'seer_result' ? -30 : o.kind === 'witness' ? 22 : 10;
      a.suspicion[o.target] = (a.suspicion[o.target] || 0) + amt * w;
      if (o.claim === 'seer') a.trustSeer[G.me.idx] = (a.trustSeer[G.me.idx] || 0) + 1;
    }
    if (o.kind === 'seer_co') G.publicSeerCall = { by: G.me.idx, targetIdx: o.target, wolf: true };
  }
  buildSayOptions();
}

/* ---------- 投票 ---------- */
function openVote() {
  G.phase = 'vote';
  G.timer = 26;
  sysLine('── 投票 ──　壁の外へ追放する者を選べ');
  $('say-box').classList.add('hidden');
  $('vote-box').classList.remove('hidden');

  const grid = $('vote-grid');
  grid.innerHTML = '';
  if (!G.me.alive) {
    grid.innerHTML = '<div class="note">あなたは死んでいる。投票はできない。</div>';
  } else {
    for (const a of G.actors) {
      if (!a.alive || a === G.me) continue;
      const b = document.createElement('button');
      b.className = 'vote-btn';
      b.appendChild(makeAvatar(a, 26, 33, false, 0.62));
      const s = document.createElement('span');
      s.textContent = a.name;
      b.appendChild(s);
      b.onclick = () => submitVote(a.idx);
      grid.appendChild(b);
    }
  }

  // AI の投票を時間差で入れる
  const voters = G.actors.filter(a => a.alive && !a.isPlayer);
  voters.forEach((a, i) => {
    setTimeout(() => {
      if (G.phase !== 'vote') return;
      G.votes[a.idx] = castVote(a, G);
      updateVoteCounts();
      SFX.vote();
    }, 900 + i * (1400 / Math.max(1, voters.length)) + Math.random() * 900);
  });
}

function submitVote(idx) {
  if (G.phase !== 'vote') return;
  if (G.me.alive) {
    G.myVote = idx;
    G.votes[G.me.idx] = idx;
    document.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('on'));
    if (idx >= 0) {
      const btns = Array.from(document.querySelectorAll('.vote-btn'));
      const name = G.actors[idx].name;
      const hit = btns.find(b => b.textContent.includes(name));
      if (hit) hit.classList.add('on');
      sysLine(`あなたは ${name} に投票した`);
    } else {
      sysLine('あなたは投票しなかった');
    }
    updateVoteCounts();
    SFX.vote();
  }
  // 全員入っていれば即締める
  const alive = G.actors.filter(a => a.alive);
  if (alive.every(a => G.votes[a.idx] !== undefined)) setTimeout(() => { if (G.phase === 'vote') finishVote(); }, 700);
}

function finishVote() {
  G.phase = 'event';
  // 未投票は棄権
  for (const a of G.actors) if (a.alive && G.votes[a.idx] === undefined) G.votes[a.idx] = -1;

  const count = {};
  for (const k in G.votes) { const v = G.votes[k]; if (v >= 0) count[v] = (count[v] || 0) + 1; }
  let topN = 0;
  for (const k in count) if (count[k] > topN) topN = count[k];
  const leaders = Object.keys(count).filter(k => count[k] === topN).map(Number);

  if (!leaders.length || topN === 0) {
    showEvent({
      title: '票は割れた',
      text: '誰にも票が集まらなかった。今日は誰も壁の外へは出されない。',
      actor: null, verdict: null,
    });
    return;
  }

  // 同数なら藁くじで決める
  const drewLots = leaders.length > 1;
  const top = leaders[Math.floor(G.rng() * leaders.length)];
  const out = G.actors[top];
  killActor(out, 'vote');
  // 追放結果を全員が学習する
  for (const a of G.actors) {
    if (!a.alive) continue;
    if (out.role === 'wolf') {
      // 一緒に吊った人を少し信用する
      for (const k in G.votes) if (G.votes[k] === top) a.suspicion[k] = (a.suspicion[k] || 0) - 22;
    } else {
      for (const k in G.votes) if (G.votes[k] === top) a.suspicion[k] = (a.suspicion[k] || 0) + 14;
    }
  }
  showEvent({
    title: drewLots ? '藁くじ' : '追放',
    text: drewLots
      ? `${topN}票で ${leaders.length} 人が並んだ。藁くじを引かされた ${out.name}（${out.look.job}）が、閉ざされたはずの門から壁の外へ突き出された。`
      : `${topN}票を集めた ${out.name}（${out.look.job}）は、閉ざされたはずの門から壁の外へ突き出された。`,
    actor: out,
    verdict: out.role === 'wolf' ? 'wolf' : 'human',
    verdictText: out.role === 'wolf' ? 'その者は 人狼 だった' : 'その者は 人狼ではなかった',
  });
}

/* =========================================================================
   イベント表示
   ========================================================================= */
function showEvent(o) {
  $('ev-title').textContent = o.title;
  $('ev-text').textContent = o.text;
  const v = $('ev-verdict');
  if (o.verdict) {
    v.className = 'ev-verdict ' + o.verdict;
    v.textContent = o.verdictText;
    v.classList.remove('hidden');
    if (o.verdict === 'wolf') SFX.howl(); else beep(160, 0.5, 'sine', 0.07);
  } else {
    v.classList.add('hidden');
  }
  const c = $('ev-canvas');
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  if (o.actor) {
    x.save();
    x.translate(c.width / 2, c.height * 0.9);
    const p = { x: 0, y: 0, look: o.actor.look, face: 'S', walkPhase: 0, moving: false };
    if (o.verdict === 'wolf') drawWolf(x, p, G.t, { scale: 2.0 });
    else drawPerson(x, p, G.t, { scale: 2.6 });
    x.restore();
  }
  show('event');
}

function afterEvent() {
  const w = checkWin();
  if (w) { endGame(w.team, w.why); return; }
  hideAllScreens();
  $('hud').classList.remove('hidden');
  if ('ontouchstart' in window) $('touch').classList.remove('hidden');
  // 会議のあとは必ず昼に戻る。夜は昼の時間切れでしか来ない
  startDay(false, G.meetFrom === 'day');
}

/* =========================================================================
   勝敗
   ========================================================================= */
function checkWin() {
  const alive = G.actors.filter(a => a.alive);
  const wolves = alive.filter(a => a.role === 'wolf').length;
  const humans = alive.length - wolves;
  if (wolves === 0) return { team: 'village', why: 'wolves' };
  if (wolves >= humans) return { team: 'wolf', why: 'outnumber' };
  return null;
}

function endGame(team, why) {
  G.phase = 'over';
  G.running = false;
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');

  const band = $('res-band');
  band.className = 'res-band ' + (team === 'village' ? 'village' : 'wolf');
  band.textContent = team === 'village' ? '村 の 勝 利' : '狼 の 勝 利';

  const mine = (G.me.role === 'wolf') === (team === 'wolf');
  const texts = {
    wolves: '最後の一匹が壁の外へ引きずり出された。街に朝が戻る。',
    outnumber: '数えられる人の数より、牙の数が多くなった。もう議論は成り立たない。',
    chores: '村の仕事がすべて片づいた。井戸も窯も櫓も、人の手で回っている。獣の居場所はもうない。',
  };
  $('res-text').textContent = (texts[why] || '') + '　' + (mine ? 'あなたの勝ちだ。' : 'あなたの負けだ。');
  if (mine) SFX.win(); else SFX.lose();

  const box = $('res-roles');
  box.innerHTML = '';
  for (const a of G.actors) {
    const d = document.createElement('div');
    d.className = 'res-item' + (a.role === 'wolf' ? ' wolf' : '') + (a.alive ? '' : ' dead');
    d.appendChild(makeAvatar(a, 36, 46, a.role === 'wolf', 0.86));
    const b = document.createElement('div');
    const R = ROLES[a.role];
    b.innerHTML = `<div class="res-nm">${a.name}${a === G.me ? '（あなた）' : ''}</div>
                   <div class="res-rl">${R.icon} ${R.name}${a.alive ? '' : '　✕'}</div>`;
    d.appendChild(b);
    box.appendChild(d);
  }
  show('result');
}

/* =========================================================================
   名簿
   ========================================================================= */
function buildRoster() {
  const box = $('roster-list');
  box.innerHTML = '';
  for (const a of G.actors) {
    const d = document.createElement('div');
    d.className = 'ros-item' + (a.alive ? '' : ' dead');
    const isMate = G.me.role === 'wolf' && a.role === 'wolf';
    d.appendChild(makeAvatar(a, 40, 50, isMate && a !== G.me, 0.95));
    const b = document.createElement('div');
    let tag = '';
    if (a === G.me) tag = '<div class="ros-tag you">あなた</div>';
    else if (isMate) tag = '<div class="ros-tag mate">🐺 仲間</div>';
    else if (!a.alive) tag = '<div class="ros-tag dead">死亡</div>';
    else if (a.claimedRole) tag = `<div class="ros-tag claim">${ROLES[a.claimedRole].name}を名乗った</div>`;
    if (G.me.role === 'seer' && G.me.seerResults[a.idx] !== undefined) {
      tag += `<div class="ros-tag ${G.me.seerResults[a.idx] === 'wolf' ? 'mate' : 'claim'}">占い：${G.me.seerResults[a.idx] === 'wolf' ? '人狼' : '人'}</div>`;
    }
    b.innerHTML = `<div class="ros-name">${a.name}</div><div class="ros-job">${a.look.job}・${TRAITS[a.look.trait].name}</div>${tag}`;
    d.appendChild(b);
    box.appendChild(d);
  }
}

/* =========================================================================
   HUD
   ========================================================================= */
function buildMyChores() {
  const box = $('my-chores');
  box.innerHTML = '';
  if (G.me.role === 'wolf') {
    const d = document.createElement('div');
    d.className = 'chore-item';
    d.innerHTML = '<span>🐺</span><b>仕事はない。だが、ふりはできる。</b>';
    box.appendChild(d);
    return;
  }
  for (const c of G.me.chores) {
    const def = CHORES.find(x => x.id === c.station);
    const d = document.createElement('div');
    d.className = 'chore-item' + (c.done ? ' done' : '');
    d.innerHTML = `<span>${def.icon}</span><b>${def.name}</b>`;
    box.appendChild(d);
  }
}

function updateHUD() {
  const isDay = G.phase === 'day';
  $('hud-phase').textContent = `${G.day}日目・${isDay ? '昼' : '夜'}`;
  $('hud-clock').textContent = `残り ${Math.max(0, Math.ceil(G.timer))}秒`;
  const full = isDay ? LEN[G.cfg.nightLen].day : LEN[G.cfg.nightLen].night;
  $('clock-fill').style.width = Math.max(0, Math.min(100, G.timer / full * 100)) + '%';
  $('clock-fill').classList.toggle('night', !isDay);

  const R = ROLES[G.me.role];
  $('role-icon').textContent = R.icon;
  $('role-name').textContent = R.name + (G.me.alive ? '' : '（死亡）');
  $('role-name').style.color = R.color;
  const alive = G.actors.filter(a => a.alive).length;
  $('hud-alive').textContent = `生存 ${alive}人`;
  $('chore-fill').style.width = (G.choreTotal ? G.choreDone / G.choreTotal * 100 : 0) + '%';
  $('hud-chore').textContent = `${G.choreDone} / ${G.choreTotal}`;
}

let toastT = null;
function toast(text, cls) {
  const box = $('toast');
  const d = document.createElement('div');
  d.className = 'toast-item' + (cls ? ' ' + cls : '');
  d.textContent = text;
  box.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; }, 2600);
  setTimeout(() => d.remove(), 3100);
}

let bannerT = null;
function banner(main, sub) {
  $('banner-main').textContent = main;
  $('banner-sub').textContent = sub || '';
  $('banner').classList.add('on');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => $('banner').classList.remove('on'), 2200);
}

function flash(kind) {
  const f = $('flash');
  f.className = kind === 'gold' ? 'gold' : kind === 'blue' ? 'blue' : '';
  f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 60);
}

/* =========================================================================
   描画
   ========================================================================= */
function render() {
  const town = G.town, me = G.me;
  // カメラ
  const z = Math.max(0.82, Math.min(1.35, Math.min(G.vw, G.vh) / 760));
  G.cam.z = z;
  const halfW = G.vw / (2 * z), halfH = G.vh / (2 * z);
  G.cam.x = Math.max(halfW, Math.min(town.w - halfW, me.x));
  G.cam.y = Math.max(halfH, Math.min(town.h - halfH, me.y));
  if (town.w < halfW * 2) G.cam.x = town.w / 2;
  if (town.h < halfH * 2) G.cam.y = town.h / 2;

  ctx.save();
  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, G.vw, G.vh);
  ctx.translate(G.vw / 2, G.vh / 2);
  ctx.scale(z, z);
  ctx.translate(-G.cam.x, -G.cam.y);

  // 地面
  ctx.drawImage(G.ground, 0, 0);

  const night = G.phase === 'night';

  // 家（プレイヤーがいる家だけ中が見える）
  for (const h of town.houses) {
    const opened = me.inHouse === h;
    drawHouseShell(ctx, h, opened, G.t);
  }

  // 仕事場
  for (const s of town.stations) drawStation(ctx, s, G.t);

  // 遺体
  for (const b of G.bodies) {
    const inH = town.houses.find(h => insideHouse(h, b.x, b.y));
    if (inH && me.inHouse !== inH) continue;
    drawBody(ctx, b);
  }

  // 人・装飾を y 順に
  const drawables = [];
  for (const p of town.props) drawables.push({ y: p.y, f: () => drawProp(ctx, p, G.t) });
  for (const l of town.lamps) drawables.push({ y: l.y, f: () => drawLamp(ctx, l, G.t, night) });
  for (const a of G.actors) {
    if (!a.alive && !a.isPlayer) continue;
    if (a.isPlayer && !a.alive && !a.ghost) continue;
    if (!isVisible(a)) continue;
    drawables.push({ y: a.y, f: () => drawActor(a) });
  }
  drawables.sort((p, q) => p.y - q.y);
  for (const d of drawables) d.f();

  // 夜のうっすらした青
  if (night) {
    ctx.fillStyle = 'rgba(18,30,64,0.34)';
    ctx.fillRect(G.cam.x - halfW, G.cam.y - halfH, halfW * 2, halfH * 2);
  }
  ctx.restore();

  // 光と闇
  if (night) drawNightMask(halfW, halfH);
  else if (G.timer < 18 && G.phase === 'day') {
    // 夕暮れ
    const k = (18 - G.timer) / 18;
    ctx.fillStyle = `rgba(150,70,30,${k * 0.30})`;
    ctx.fillRect(0, 0, G.vw, G.vh);
  }

  drawMinimap();
}

function isVisible(a) {
  const me = G.me;
  if (a === me) return true;
  if (me.ghost) return true;              // 死んだ者は街のすべてを見ている
  const inH = G.town.houses.find(h => insideHouse(h, a.x, a.y));
  if (inH) return me.inHouse === inH;      // 家の中は外からは見えない
  if (me.inHouse) return false;            // 自分が家の中なら外は見えない
  return true;
}

function drawActor(a) {
  const me = G.me;
  const p = {
    x: a.x, y: a.y, look: a.look, face: a.face,
    walkPhase: a.walkPhase, moving: a.moving, ghost: a.ghost && !a.alive,
  };
  // 寝ている・隠れている人は小さく寝そべらせる
  if (a.sleeping || a.hiding) {
    ctx.save();
    ctx.globalAlpha = a.hiding ? 0.5 : 0.9;
    ctx.translate(a.x, a.y);
    ctx.rotate(a.hiding ? 0 : -1.35);
    ctx.translate(-a.x, -a.y);
    drawPerson(ctx, p, G.t, {});
    ctx.restore();
    if (a === me) {
      ctx.font = '600 12px system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = '#cfe0f5';
      ctx.fillText(a.hiding ? '隠れている' : 'zzz…', a.x, a.y - 52);
    }
    return;
  }

  const showWolf = a.wolfForm || (a.isPlayer && a.role === 'wolf' && G.phase === 'night');
  const mate = me.role === 'wolf' && a.role === 'wolf' && a !== me;
  let label = null, lcol = null;
  if (a === me) { label = 'あなた'; lcol = '#ffd07a'; }
  else if (G.phase === 'day' || me.ghost) { label = a.name; }
  else if (mate) { label = a.name + '（仲間）'; lcol = '#ff9aa8'; }
  else if (G.phase === 'night') {
    // 夜は近くにいる者しか名前が分からない
    const d = Math.hypot(a.x - me.x, a.y - me.y);
    if (d < 150) label = a.name;
  }

  if (showWolf) drawWolf(ctx, p, G.t, { label, labelColor: lcol });
  else drawPerson(ctx, p, G.t, { label, labelColor: lcol });

  // 作業中の吹き出し
  if (a.job && !a.isPlayer) {
    const def = CHORES.find(c => c.id === a.job.key);
    ctx.font = '15px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(def ? def.icon : '⚙', a.x, a.y - 52 + Math.sin(G.t * 5) * 2);
  }
}

function drawBody(ctx2, b) {
  ctx2.save();
  ctx2.translate(b.x, b.y);
  ctx2.rotate(1.5);
  const p = { x: 0, y: 0, look: b.look, face: 'S', walkPhase: 0, moving: false };
  ctx2.globalAlpha = 0.9;
  drawPerson(ctx2, p, 0, {});
  ctx2.restore();
  // 血だまり
  ctx2.fillStyle = 'rgba(150,20,32,0.62)';
  ctx2.beginPath();
  ctx2.ellipse(b.x + 4, b.y + 4, 22, 10, 0.3, 0, 6.284);
  ctx2.fill();
  if (!b.found) {
    ctx2.font = '600 12px system-ui'; ctx2.textAlign = 'center';
    ctx2.fillStyle = '#ff9aa8';
    ctx2.fillText('遺体', b.x, b.y - 26);
  }
}

/* 夜の暗さと光の輪 */
function drawNightMask(halfW, halfH) {
  const L = G.lightX, me = G.me;
  if (!L) return;
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.clearRect(0, 0, G.vw, G.vh);
  L.fillStyle = 'rgba(2,4,12,0.945)';
  L.fillRect(0, 0, G.vw, G.vh);

  const z = G.cam.z;
  const toScreen = (x, y) => [(x - G.cam.x) * z + G.vw / 2, (y - G.cam.y) * z + G.vh / 2];

  L.globalCompositeOperation = 'destination-out';
  const punch = (wx, wy, r, strength) => {
    const [sx, sy] = toScreen(wx, wy);
    const R = r * z;
    if (sx < -R || sy < -R || sx > G.vw + R || sy > G.vh + R) return;
    const g = L.createRadialGradient(sx, sy, R * 0.12, sx, sy, R);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.55})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    L.fillStyle = g;
    L.beginPath(); L.arc(sx, sy, R, 0, 6.284); L.fill();
  };

  // 手元の明かり（狼は夜目が利く）
  const myR = me.ghost ? 420 : (me.role === 'wolf' ? 235 : 152);
  punch(me.x, me.y, myR, 1);
  // 街灯
  for (const l of G.town.lamps) punch(l.x, l.y, l.r * (0.92 + Math.sin(G.t * 6 + l.phase) * 0.05), 0.86);
  // 炉と祠
  for (const s of G.town.stations) {
    if (s.kind === 'oven' || s.kind === 'forge') punch(s.cx, s.cy, 112, 0.9);
    if (s.kind === 'shrine' || s.kind === 'bell') punch(s.cx, s.cy, 96, 0.82);
  }
  // 中にいる家の中は明るい
  if (me.inHouse) punch(me.inHouse.center.x, me.inHouse.center.y, 118, 1);

  L.globalCompositeOperation = 'source-over';
  ctx.drawImage(G.lightC, 0, 0);
}

/* ミニマップ */
function drawMinimap() {
  const town = G.town;
  const pad = 12, size = Math.min(150, G.vw * 0.2);
  const sc = size / Math.max(town.w, town.h);
  const w = town.w * sc, h = town.h * sc;
  const ox = G.vw - w - pad, oy = G.vh - h - pad;

  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(10,12,18,0.8)';
  roundRect(ctx, ox - 5, oy - 5, w + 10, h + 10, 7); ctx.fill();
  ctx.strokeStyle = '#2c3040'; ctx.lineWidth = 1; ctx.stroke();

  ctx.fillStyle = '#3a3c48';
  ctx.fillRect(ox, oy, w, h);
  ctx.fillStyle = '#565a68';
  ctx.beginPath();
  ctx.ellipse(ox + town.cx * sc, oy + town.cy * sc, town.plaza.rx * sc, town.plaza.ry * sc, 0, 0, 6.284);
  ctx.fill();
  for (const hs of town.houses) {
    ctx.fillStyle = hs === G.me.house ? '#ffd07a' : '#7a6a58';
    ctx.fillRect(ox + hs.x * sc, oy + hs.y * sc, Math.max(2, hs.w * sc), Math.max(2, hs.h * sc));
  }
  for (const s of town.stations) {
    ctx.fillStyle = '#5a7a8a';
    ctx.fillRect(ox + s.x * sc, oy + s.y * sc, Math.max(2, s.w * sc), Math.max(2, s.h * sc));
  }
  // 自分だけ
  ctx.fillStyle = G.me.role === 'wolf' && G.phase === 'night' ? '#e0455e' : '#ffd07a';
  ctx.beginPath();
  ctx.arc(ox + G.me.x * sc, oy + G.me.y * sc, 3, 0, 6.284);
  ctx.fill();
  ctx.restore();
}

/* ---------- G に外から呼ばれる口 ---------- */
G.resolveAttack = resolveAttack;

init();
})();
