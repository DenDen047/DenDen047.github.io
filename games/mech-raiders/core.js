/* =========================================================================
   MECH RAIDERS ― 共通基盤
   数学 / 乱数 / 入力 / 音 / セーブ / パーティクル / カメラ
   ========================================================================= */
'use strict';

/* ------------------------------ 数学 ------------------------------ */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function angApproach(cur, target, maxStep) { const d = angDiff(cur, target); return cur + clamp(d, -maxStep, maxStep); }
const deg = (d) => (d * Math.PI) / 180;

/* ------------------------------ 乱数 ------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class RNG {
  constructor(seed) { this.next = mulberry32(seed); }
  f(a = 1, b) { const r = this.next(); return b === undefined ? r * a : a + r * (b - a); }
  i(a, b) { return Math.floor(this.f(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
}
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ------------------------------ 幾何 ------------------------------ */
function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  return dist2(cx, cy, nx, ny) < r * r;
}
/* 線分と矩形の交差（レーザー・視線判定用） */
function segRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return 0;
  const rx2 = rx + rw, ry2 = ry + rh;
  let tmin = 0, tmax = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (let i = 0; i < 2; i++) {
    const p = i === 0 ? dx : dy;
    const o = i === 0 ? x1 : y1;
    const lo = i === 0 ? rx : ry;
    const hi = i === 0 ? rx2 : ry2;
    if (Math.abs(p) < 1e-8) { if (o < lo || o > hi) return -1; continue; }
    let t1 = (lo - o) / p, t2 = (hi - o) / p;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
/* 線分と円の交差（最短の t、無ければ -1） */
function segCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return dist2(x1, y1, cx, cy) <= r * r ? 0 : -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

/* ------------------------------ 入力 ------------------------------ */
/* P1: WASD 移動 / マウス照準・左クリック射撃 / Space ローリング / Q 必殺 / E 武器切替 / Tab ロック切替
   P2: ↑↓←→ 移動 / RShift・「.」射撃 / 「/」ローリング / 「,」必殺 / M 武器切替 / N ロック切替 */
const KEYMAP = {
  1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    fire: ['Space_never'], roll: ['Space'], special: ['KeyQ'], swap: ['KeyE'], lock: ['Tab'],
  },
  2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    fire: ['ShiftRight', 'Period'], roll: ['Slash', 'ControlRight'], special: ['Comma'], swap: ['KeyM'], lock: ['KeyN'],
  },
};

class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();     // このフレームで押された
    this.mouse = { x: 0, y: 0, down: false, moved: false, downEdge: false };
    this.canvas = canvas;
    this._bind();
  }
  _bind() {
    const blocked = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Comma', 'Period', 'Quote']);
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (blocked.has(e.code)) e.preventDefault(); return; }
      if (blocked.has(e.code)) e.preventDefault();
      this.keys.add(e.code); this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    const cv = this.canvas;
    if (cv) {
      cv.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect();
        this.mouse.x = ((e.clientX - r.left) / r.width) * cv.width;
        this.mouse.y = ((e.clientY - r.top) / r.height) * cv.height;
        this.mouse.moved = true;
      });
      cv.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouse.down = true; this.mouse.downEdge = true; } });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  anyDown(list) { for (const c of list) if (this.keys.has(c)) return true; return false; }
  anyHit(list) { for (const c of list) if (this.pressed.has(c)) return true; return false; }
  /* プレイヤー別の入力を読む */
  read(pid) {
    const m = KEYMAP[pid];
    const ax = (this.anyDown(m.right) ? 1 : 0) - (this.anyDown(m.left) ? 1 : 0);
    const ay = (this.anyDown(m.down) ? 1 : 0) - (this.anyDown(m.up) ? 1 : 0);
    const out = {
      mx: ax, my: ay,
      fire: pid === 1 ? this.mouse.down : this.anyDown(m.fire),
      roll: this.anyHit(m.roll),
      special: this.anyHit(m.special),
      swap: this.anyHit(m.swap),
      lock: this.anyHit(m.lock),
    };
    if (ax || ay) { const n = Math.hypot(ax, ay); out.mx = ax / n; out.my = ay / n; }
    return out;
  }
  endFrame() { this.pressed.clear(); this.mouse.moved = false; this.mouse.downEdge = false; }
}

/* ------------------------------ 音 ------------------------------ */
/* master → (sfx | bgm) の 2 系統。設定は localStorage に別枠で持つ。 */
const SET_KEY = 'mech-raiders-settings-v1';
const defaultSettings = () => ({ master: 0.7, sfx: 0.9, bgm: 0.5, muted: false, bgmOn: true });

class Audio2 {
  constructor() {
    this.ctx = null; this.master = null; this.sfxBus = null; this.bgmBus = null;
    this.last = {};
    this.set = Object.assign(defaultSettings(), readSettings());
    this.bgm = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); this.syncBgm(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.bgmBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.bgmBus.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.bgm = new Bgm(this.ctx, this.bgmBus);
    this.applyVolumes();
    this.syncBgm();
  }
  applyVolumes() {
    if (!this.master) return;
    const s = this.set;
    this.master.gain.value = s.muted ? 0 : clamp(s.master, 0, 1) * 0.55;
    this.sfxBus.gain.value = clamp(s.sfx, 0, 1);
    this.bgmBus.gain.value = clamp(s.bgm, 0, 1) * 0.55;
  }
  syncBgm() {
    if (!this.bgm) return;
    if (this.set.bgmOn && !this.set.muted) this.bgm.start(); else this.bgm.stop();
  }
  update(patch) {
    Object.assign(this.set, patch);
    writeSettings(this.set);
    this.applyVolumes();
    this.syncBgm();
  }
  setMuted(m) { this.update({ muted: !!m }); }
  get muted() { return this.set.muted; }
  setScene(name) { if (this.bgm) this.bgm.setScene(name); }

  throttle(key, ms) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return false;
    this.last[key] = now; return true;
  }
  tone({ f = 440, f2 = null, t = 0.1, type = 'square', vol = 0.3, delay = 0 }) {
    if (!this.ctx || this.set.muted) return;
    const c = this.ctx, now = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, now);
    if (f2 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + t);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.connect(g); g.connect(this.sfxBus); o.start(now); o.stop(now + t + 0.02);
  }
  noise({ t = 0.2, vol = 0.3, lp = 1400, hp = 0, delay = 0 }) {
    if (!this.ctx || this.set.muted) return;
    const c = this.ctx, now = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * t));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    let node = src;
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; node.connect(fl); node = fl; }
    if (hp) { const fh = c.createBiquadFilter(); fh.type = 'highpass'; fh.frequency.value = hp; node.connect(fh); node = fh; }
    const g = c.createGain(); g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    node.connect(g); g.connect(this.sfxBus); src.start(now);
  }
  sfx(name, arg) {
    if (!this.ctx || this.set.muted) return;
    switch (name) {
      case 'shot':      if (this.throttle('shot', 28)) { this.noise({ t: 0.06, vol: 0.18, lp: 2600, hp: 500 }); this.tone({ f: 320, f2: 120, t: 0.05, type: 'square', vol: 0.10 }); } break;
      case 'shotBig':   this.noise({ t: 0.18, vol: 0.3, lp: 1200 }); this.tone({ f: 150, f2: 50, t: 0.16, type: 'sawtooth', vol: 0.2 }); break;
      case 'beam':      if (this.throttle('beam', 90)) this.tone({ f: 900, f2: 1200, t: 0.12, type: 'sawtooth', vol: 0.07 }); break;
      case 'hit':       if (this.throttle('hit', 30)) this.tone({ f: 700, f2: 300, t: 0.045, type: 'square', vol: 0.10 }); break;
      case 'hurt':      this.noise({ t: 0.16, vol: 0.3, lp: 900 }); this.tone({ f: 160, f2: 70, t: 0.16, type: 'sawtooth', vol: 0.16 }); break;
      case 'explode':   this.noise({ t: 0.5, vol: 0.42, lp: 900 }); this.tone({ f: 90, f2: 32, t: 0.4, type: 'sine', vol: 0.3 }); break;
      case 'boom':      this.noise({ t: 0.85, vol: 0.5, lp: 700 }); this.tone({ f: 70, f2: 24, t: 0.7, type: 'sine', vol: 0.34 }); break;
      case 'roll':      this.noise({ t: 0.16, vol: 0.16, lp: 2400, hp: 700 }); break;
      case 'reload':    this.tone({ f: 240, t: 0.05, type: 'square', vol: 0.12 }); this.tone({ f: 420, t: 0.06, type: 'square', vol: 0.12, delay: 0.14 }); break;
      case 'special':   this.tone({ f: 200, f2: 900, t: 0.35, type: 'sawtooth', vol: 0.26 }); this.noise({ t: 0.4, vol: 0.22, lp: 2200 }); break;
      case 'lock':      this.tone({ f: 1200, t: 0.04, type: 'square', vol: 0.10 }); break;
      case 'alert':     this.tone({ f: 880, t: 0.08, type: 'square', vol: 0.14 }); this.tone({ f: 660, t: 0.1, type: 'square', vol: 0.13, delay: 0.1 }); break;
      case 'pickup':    this.tone({ f: 620, f2: 1100, t: 0.12, type: 'triangle', vol: 0.18 }); break;
      case 'ui':        this.tone({ f: 520, t: 0.04, type: 'square', vol: 0.1 }); break;
      case 'uiBig':     this.tone({ f: 300, f2: 700, t: 0.16, type: 'triangle', vol: 0.18 }); break;
      case 'gacha':     this.tone({ f: 300, f2: 1400, t: 0.7, type: 'sawtooth', vol: 0.2 }); break;
      case 'reveal': {
        const r = arg || 'N';
        const base = r === 'SSR' ? 520 : r === 'SR' ? 440 : r === 'R' ? 380 : 320;
        [0, 0.09, 0.18].forEach((d, i) => this.tone({ f: base * (1 + i * 0.28), t: 0.22, type: 'triangle', vol: 0.2, delay: d }));
        if (r === 'SSR') this.noise({ t: 0.6, vol: 0.2, lp: 5200, hp: 1800, delay: 0.1 });
        break;
      }
      case 'win':  [0, 0.13, 0.26, 0.42].forEach((d, i) => this.tone({ f: [392, 523, 659, 784][i], t: 0.3, type: 'triangle', vol: 0.2, delay: d })); break;
      case 'lose': [0, 0.16, 0.34].forEach((d, i) => this.tone({ f: [330, 260, 180][i], t: 0.4, type: 'sawtooth', vol: 0.2, delay: d })); break;
      default: break;
    }
  }
}

/* ---------- BGM（音源ファイルを持たず、その場で鳴らす） ---------- */
/* Am - F - C - G を 4 小節で回す。場面で音数と速さを変える。 */
const BGM_CHORDS = [
  { root: 55.00, notes: [220.00, 261.63, 329.63] },   // Am
  { root: 43.65, notes: [174.61, 220.00, 261.63] },   // F
  { root: 65.41, notes: [196.00, 261.63, 329.63] },   // C
  { root: 49.00, notes: [196.00, 246.94, 293.66] },   // G
];

class Bgm {
  constructor(ctx, bus) {
    this.ctx = ctx; this.bus = bus;
    this.playing = false; this.timer = null;
    this.step = 0; this.nextT = 0;
    this.bpm = 96; this.scene = 'menu';
  }
  setScene(s) {
    if (this.scene === s) return;
    this.scene = s;
    this.bpm = s === 'battle' ? 124 : s === 'boss' ? 138 : 96;
  }
  start() {
    if (this.playing) return;
    this.playing = true;
    this.nextT = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer); this.timer = null;
  }
  schedule() {
    if (!this.playing) return;
    const spb = 60 / this.bpm / 4;                 // 16 分音符ひとつ分
    while (this.nextT < this.ctx.currentTime + 0.22) {
      this.playStep(this.step, this.nextT, spb);
      this.step = (this.step + 1) % 64;
      this.nextT += spb;
    }
  }
  v(f, type, t0, dur, vol, f2) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.bus);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  hit(t0, dur, vol, lp, hp) {
    const c = this.ctx;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    let n = src;
    const f1 = c.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = lp; n.connect(f1); n = f1;
    if (hp) { const f2 = c.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = hp; n.connect(f2); n = f2; }
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    n.connect(g); g.connect(this.bus);
    src.start(t0);
  }
  playStep(s, t, spb) {
    const bar = Math.floor(s / 16);
    const b = s % 16;
    const ch = BGM_CHORDS[bar % 4];
    const heavy = this.scene !== 'menu';
    const boss = this.scene === 'boss';

    /* ベース */
    if (b % 4 === 0 || (heavy && b % 8 === 6)) {
      this.v(ch.root, 'sawtooth', t, spb * 3.2, 0.16, ch.root * 0.995);
    }
    /* 和音のパッド（小節頭） */
    if (b === 0) {
      ch.notes.forEach((n, i) => this.v(n / 2, 'triangle', t, spb * 14, 0.045 + i * 0.004));
    }
    /* アルペジオ */
    if (heavy ? b % 2 === 0 : b % 4 === 2) {
      const n = ch.notes[(Math.floor(s / 2) + bar) % ch.notes.length];
      this.v(n * (boss ? 2 : 1), 'square', t, spb * 1.4, boss ? 0.045 : 0.032);
    }
    /* キック */
    if (b === 0 || b === 8 || (heavy && b === 11)) {
      this.v(120, 'sine', t, 0.16, 0.30, 40);
      this.hit(t, 0.05, 0.12, 500);
    }
    /* スネア */
    if (b === 4 || b === 12) this.hit(t, 0.14, heavy ? 0.16 : 0.10, 3200, 700);
    /* ハイハット */
    if (heavy ? b % 2 === 0 : b % 4 === 0) this.hit(t, 0.035, 0.05, 9000, 5000);
    /* ボス戦だけ低音のうねりを足す */
    if (boss && b === 0) this.v(ch.root / 2, 'sawtooth', t, spb * 15, 0.09, ch.root / 2 * 1.01);
  }
}

function readSettings() {
  try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch (e) { return {}; }
}
function writeSettings(s) {
  try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) { /* 保存できなくても続行 */ }
}

/* ------------------------------ セーブ ------------------------------ */
/* スロット 3 枠。設定（音量など）はスロットとは別枠で保存する。 */
const SLOT_PREFIX = 'mech-raiders-slot-';
const LEGACY_KEY = 'mech-raiders-save-v1';
const SLOT_COUNT = 3;

function defaultSave() {
  return {
    scrap: 400,
    tickets: 6,
    /* 所持品: id -> { lv, lb(限界突破), n(所持数) } */
    frames:  { vanguard: { lv: 1, lb: 0, n: 1 }, jackal: { lv: 1, lb: 0, n: 1 }, gtitan: { lv: 1, lb: 0, n: 1 } },
    weapons: { ar12: { lv: 1, lb: 0, n: 1 }, db8: { lv: 1, lb: 0, n: 1 } },
    cores:   { core_std: { lv: 1, lb: 0, n: 1 } },
    loadout: { 1: { frame: 'vanguard', main: 'ar12', sub: 'db8', core: 'core_std' },
               2: { frame: 'gtitan', main: 'ar12', sub: 'db8', core: 'core_std' } },
    cleared: {},        // sectorId -> { best: 秒, rank: 'S' }
    pity: 0,            // SSR 天井カウンタ
    totalKills: 0,
    seen: {},           // 図鑑
    playtime: 0,        // 秒
    created: 0,
    updated: 0,
  };
}

/* 壊れた保存でも遊べる状態に整える */
function normalize(d) {
  const base = defaultSave();
  d = Object.assign({}, base, d || {});
  d.frames = Object.assign({}, base.frames, d.frames);
  d.weapons = Object.assign({}, base.weapons, d.weapons);
  d.cores = Object.assign({}, base.cores, d.cores);
  if (!d.loadout) d.loadout = base.loadout;
  for (const pid of [1, 2]) {
    if (!d.loadout[pid]) d.loadout[pid] = Object.assign({}, base.loadout[pid]);
    if (!d.frames[d.loadout[pid].frame]) d.loadout[pid].frame = 'vanguard';
  }
  return d;
}

const Save = {
  data: null,
  slot: 1,
  /* スロットの概要（一覧表示用）。存在しなければ null */
  peek(i) {
    try {
      const raw = localStorage.getItem(SLOT_PREFIX + i);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const cleared = d.cleared ? Object.keys(d.cleared).length : 0;
      return { cleared, scrap: d.scrap || 0, tickets: d.tickets || 0,
               kills: d.totalKills || 0, playtime: d.playtime || 0, updated: d.updated || 0 };
    } catch (e) { return null; }
  },
  list() {
    const out = [];
    for (let i = 1; i <= SLOT_COUNT; i++) out.push({ i, info: this.peek(i) });
    return out;
  },
  /* 旧形式のセーブがあれば空きスロット 1 に引き継ぐ */
  migrate() {
    try {
      const old = localStorage.getItem(LEGACY_KEY);
      if (!old) return;
      if (!localStorage.getItem(SLOT_PREFIX + 1)) {
        const d = normalize(JSON.parse(old));
        d.updated = Date.now();
        localStorage.setItem(SLOT_PREFIX + 1, JSON.stringify(d));
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) { /* 引き継げなくても新規で始められる */ }
  },
  open(i) {
    this.slot = i;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SLOT_PREFIX + i)); } catch (e) { d = null; }
    this.data = normalize(d);
    if (!this.data.created) this.data.created = Date.now();
    return this.data;
  },
  create(i) {
    this.slot = i;
    this.data = normalize(null);
    this.data.created = Date.now();
    this.save();
    return this.data;
  },
  erase(i) { try { localStorage.removeItem(SLOT_PREFIX + i); } catch (e) { /* noop */ } },
  save() {
    if (!this.data) return;
    this.data.updated = Date.now();
    try { localStorage.setItem(SLOT_PREFIX + this.slot, JSON.stringify(this.data)); } catch (e) { /* 容量超過は黙って諦める */ }
  },
};

/* ------------------------------ パーティクル ------------------------------ */
class Particles {
  constructor(max = 1400) { this.list = []; this.max = max; }
  clear() { this.list.length = 0; }
  add(p) { if (this.list.length < this.max) this.list.push(p); }
  spark(x, y, n, color, spd = 200, life = 0.4, size = 2) {
    for (let i = 0; i < n; i++) {
      const a = rnd(TAU), s = rnd(spd * 0.3, spd);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * 0.5, life), max: life, color, size: rnd(size * 0.6, size), drag: 3, kind: 'spark' });
    }
  }
  dirSpark(x, y, ang, n, color, spd = 260, spread = 0.9, life = 0.3, size = 2) {
    for (let i = 0; i < n; i++) {
      const a = ang + rnd(-spread, spread), s = rnd(spd * 0.3, spd);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * 0.5, life), max: life, color, size: rnd(size * 0.6, size), drag: 4, kind: 'spark' });
    }
  }
  smoke(x, y, n, color = 'rgba(140,140,150,', spd = 40, life = 1.0, size = 8) {
    for (let i = 0; i < n; i++) {
      const a = rnd(TAU), s = rnd(spd);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 12, life: rnd(life * 0.6, life), max: life, color, size: rnd(size * 0.6, size), grow: 22, drag: 1.2, kind: 'smoke' });
    }
  }
  ring(x, y, color, r0 = 8, r1 = 90, life = 0.35, w = 4) {
    this.add({ x, y, life, max: life, color, r0, r1, w, kind: 'ring' });
  }
  shard(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = rnd(TAU), s = rnd(90, 320);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.5, 1.1), max: 1.1, color, size: rnd(2, 5), drag: 2.2, rot: rnd(TAU), vr: rnd(-9, 9), kind: 'shard' });
    }
  }
  explosion(x, y, r, colorA = '#ffd166', colorB = '#ff6a2a') {
    this.ring(x, y, '#fff2c8', r * 0.2, r * 1.15, 0.3, 5);
    this.spark(x, y, Math.min(34, 12 + r / 4), colorA, r * 4, 0.5, 3.2);
    this.spark(x, y, Math.min(24, 8 + r / 6), colorB, r * 2.6, 0.7, 4.2);
    this.smoke(x, y, Math.min(18, 6 + r / 8), 'rgba(60,58,62,', 46, 1.4, r * 0.28);
  }
  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) { l.splice(i, 1); continue; }
      if (p.kind === 'ring') continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      if (p.grow) p.size += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
  }
  draw(ctx) {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const t = p.life / p.max;
      if (p.kind === 'ring') {
        const r = lerp(p.r0, p.r1, 1 - t);
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.strokeStyle = p.color; ctx.lineWidth = p.w * t;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = clamp(t * 0.45, 0, 1);
        ctx.fillStyle = typeof p.color === 'string' && p.color.startsWith('rgba') ? p.color + clamp(t * 0.5, 0, 1) + ')' : p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      } else if (p.kind === 'shard') {
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size * 0.5, -p.size * 0.22, p.size, p.size * 0.44);
        ctx.restore();
      } else {
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------ 浮動テキスト ------------------------------ */
class FloatText {
  constructor() { this.list = []; }
  clear() { this.list.length = 0; }
  add(x, y, text, color = '#fff', size = 13, life = 0.85, vy = -46) {
    if (this.list.length > 90) this.list.shift();
    this.list.push({ x: x + rnd(-6, 6), y, text, color, size, life, max: life, vy });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.life -= dt; f.y += f.vy * dt; f.vy *= Math.max(0, 1 - 1.6 * dt);
      if (f.life <= 0) this.list.splice(i, 1);
    }
  }
  draw(ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.list) {
      const t = clamp(f.life / f.max, 0, 1);
      ctx.globalAlpha = t;
      ctx.font = `700 ${f.size}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
}

/* ------------------------------ カメラ ------------------------------ */
class Camera {
  constructor() { this.x = 0; this.y = 0; this.shake = 0; this.ox = 0; this.oy = 0; this.zoom = 1; }
  addShake(v) { this.shake = Math.min(26, this.shake + v); }
  follow(tx, ty, vw, vh, worldW, worldH, dt, snap = false) {
    const k = snap ? 1 : 1 - Math.pow(0.0018, dt);
    this.x = lerp(this.x, tx - vw / 2, k);
    this.y = lerp(this.y, ty - vh / 2, k);
    this.x = clamp(this.x, 0, Math.max(0, worldW - vw));
    this.y = clamp(this.y, 0, Math.max(0, worldH - vh));
    if (this.shake > 0.1) {
      this.ox = rnd(-this.shake, this.shake); this.oy = rnd(-this.shake, this.shake);
      this.shake *= Math.pow(0.0016, dt);
    } else { this.shake = 0; this.ox = 0; this.oy = 0; }
  }
}

/* ------------------------------ 小物 ------------------------------ */
function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
}
function el(id) { return document.getElementById(id); }
function show(node) { if (node) node.classList.remove('hidden'); }
function hide(node) { if (node) node.classList.add('hidden'); }
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

window.MRCore = {
  TAU, clamp, lerp, dist, dist2, angTo, angDiff, angApproach, deg,
  RNG, rnd, rndi, pick, mulberry32,
  circleRect, segRect, segCircle,
  Input, KEYMAP, Audio2, Bgm, defaultSettings, readSettings, writeSettings,
  Save, defaultSave, SLOT_COUNT, Particles, FloatText, Camera,
  fmtTime, el, show, hide, roundRect,
};
