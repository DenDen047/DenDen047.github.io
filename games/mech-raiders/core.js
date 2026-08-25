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
class Audio2 {
  constructor() { this.ctx = null; this.muted = false; this.master = null; this.last = {}; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.32; }
  /* 同種の音が同フレームに殺到するのを間引く */
  throttle(key, ms) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return false;
    this.last[key] = now; return true;
  }
  tone({ f = 440, f2 = null, t = 0.1, type = 'square', vol = 0.3, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, now = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, now);
    if (f2 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + t);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.connect(g); g.connect(this.master); o.start(now); o.stop(now + t + 0.02);
  }
  noise({ t = 0.2, vol = 0.3, lp = 1400, hp = 0, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, now = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * t));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    let node = src;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    const g = c.createGain(); g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    node.connect(g); g.connect(this.master); src.start(now);
  }
  /* ---- 効果音 ---- */
  sfx(name, arg) {
    if (!this.ctx || this.muted) return;
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

/* ------------------------------ セーブ ------------------------------ */
const SAVE_KEY = 'mech-raiders-save-v1';

function defaultSave() {
  return {
    scrap: 400,
    tickets: 6,
    /* 所持品: id -> { lv, lb(限界突破), n(所持数) } */
    frames:  { vanguard: { lv: 1, lb: 0, n: 1 } },
    weapons: { ar12: { lv: 1, lb: 0, n: 1 }, db8: { lv: 1, lb: 0, n: 1 } },
    cores:   { core_std: { lv: 1, lb: 0, n: 1 } },
    loadout: { 1: { frame: 'vanguard', main: 'ar12', sub: 'db8', core: 'core_std' },
               2: { frame: 'vanguard', main: 'ar12', sub: 'db8', core: 'core_std' } },
    cleared: {},        // sectorId -> { best: 秒, rank: 'S' }
    pity: 0,            // SSR 天井カウンタ
    totalKills: 0,
    seen: {},           // 図鑑
    muted: false,
  };
}

const Save = {
  data: null,
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.data = raw ? Object.assign(defaultSave(), JSON.parse(raw)) : defaultSave();
    } catch (e) { this.data = defaultSave(); }
    /* 壊れた保存に備えて最低限の初期装備を保証する */
    const d = this.data;
    if (!d.frames || !d.frames.vanguard) d.frames = Object.assign({ vanguard: { lv: 1, lb: 0, n: 1 } }, d.frames);
    if (!d.weapons || !d.weapons.ar12) d.weapons = Object.assign({ ar12: { lv: 1, lb: 0, n: 1 } }, d.weapons);
    if (!d.cores || !d.cores.core_std) d.cores = Object.assign({ core_std: { lv: 1, lb: 0, n: 1 } }, d.cores);
    if (!d.loadout) d.loadout = defaultSave().loadout;
    for (const pid of [1, 2]) if (!d.loadout[pid]) d.loadout[pid] = Object.assign({}, defaultSave().loadout[1]);
    return d;
  },
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* 容量超過などは黙って諦める */ } },
  reset() { this.data = defaultSave(); this.save(); return this.data; },
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
  Input, KEYMAP, Audio2, Save, defaultSave, Particles, FloatText, Camera,
  fmtTime, el, show, hide, roundRect,
};
