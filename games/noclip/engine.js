/* =========================================================================
   NOCLIP ― エンジン層
   乱数・数学・入力・音・セーブ。ゲームのルールはここには置かない。
   ========================================================================= */

/* ---------- 数学 ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }

/* ---------- 決定的な乱数（ステージ生成用） ---------- */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}
const rngInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const rngPick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* =========================================================================
   入力
   ========================================================================= */
const Input = {
  keys: Object.create(null),
  mx: 0, my: 0, hasMouse: false,   // canvas 内のピクセル座標
  down: false, downEdge: false,
  wheelOpen: false,
  stick: { x: 0, y: 0, active: false },
  touchRun: false, touchSwing: false,
  _once: Object.create(null),

  init(canvas) {
    addEventListener('keydown', e => {
      if (e.repeat) { return; }
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      this._once[k] = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) { e.preventDefault(); }
    });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = Object.create(null); this.down = false; });

    const pos = e => {
      const r = canvas.getBoundingClientRect();
      this.mx = (e.clientX - r.left) * (canvas.width / r.width);
      this.my = (e.clientY - r.top) * (canvas.height / r.height);
      if (e.pointerType !== 'touch') { this.hasMouse = true; }
    };
    canvas.addEventListener('pointermove', pos);
    canvas.addEventListener('pointerdown', e => { pos(e); this.down = true; this.downEdge = true; });
    addEventListener('pointerup', () => { this.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },

  /** 押した瞬間だけ true を返す */
  pressed(k) { if (this._once[k]) { this._once[k] = false; return true; } return false; },
  held(...ks) { return ks.some(k => this.keys[k]); },

  /** 移動入力を -1..1 のベクトルで返す（キーボード優先、無ければタッチ） */
  axis() {
    let x = 0, y = 0;
    if (this.held('a', 'arrowleft')) { x -= 1; }
    if (this.held('d', 'arrowright')) { x += 1; }
    if (this.held('w', 'arrowup')) { y -= 1; }
    if (this.held('s', 'arrowdown')) { y += 1; }
    if (x === 0 && y === 0 && this.stick.active) { x = this.stick.x; y = this.stick.y; }
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  },

  endFrame() { this.downEdge = false; this.touchSwing = false; },
};

/* =========================================================================
   音（すべて WebAudio の合成音。外部ファイルは使わない）
   ========================================================================= */
const Audio2 = {
  ctx: null, master: null, amb: null, ambGain: null, muted: false,

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') { this.ctx.resume(); } return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  },

  /** 汎用のワンショット。type/周波数の推移/包絡を指定する */
  tone({ type = 'sine', f0 = 440, f1 = f0, t = 0.2, gain = 0.2, delay = 0, filter = null, q = 1, det = 0 }) {
    this.ensure(); if (!this.ctx || this.muted) { return; }
    const c = this.ctx, now = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + t);
    if (det) { o.detune.value = det; }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.02, t * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    let node = o;
    if (filter) {
      const bp = c.createBiquadFilter();
      bp.type = filter; bp.frequency.value = f0; bp.Q.value = q;
      node.connect(bp); node = bp;
    }
    node.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + t + 0.05);
  },

  /** ノイズ系（足音・崩落・悲鳴の芯） */
  noise({ t = 0.2, gain = 0.2, f = 900, q = 1, type = 'bandpass', delay = 0, sweep = null }) {
    this.ensure(); if (!this.ctx || this.muted) { return; }
    const c = this.ctx, now = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * t));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { d[i] = (Math.random() * 2 - 1) * (1 - i / len); }
    const src = c.createBufferSource(); src.buffer = buf;
    const bq = c.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q;
    if (sweep) { bq.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), now + t); }
    const g = c.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    src.connect(bq); bq.connect(g); g.connect(this.master);
    src.start(now); src.stop(now + t + 0.02);
  },

  /* ---------- 効果音 ---------- */
  sfx(name, v = 1) {
    switch (name) {
      case 'step':    this.noise({ t: 0.07, gain: 0.05 * v, f: 260, q: 1.6 }); break;
      case 'hitWall': this.tone({ type: 'square', f0: 300, f1: 120, t: 0.09, gain: 0.10 * v });
                      this.noise({ t: 0.12, gain: 0.13 * v, f: 1800, q: 0.7, sweep: 500 }); break;
      case 'break':   this.noise({ t: 0.45, gain: 0.24 * v, f: 900, q: 0.5, sweep: 120 });
                      this.tone({ type: 'triangle', f0: 160, f1: 50, t: 0.4, gain: 0.14 * v }); break;
      case 'chest':   this.tone({ type: 'triangle', f0: 520, f1: 880, t: 0.16, gain: 0.14 });
                      this.tone({ type: 'sine', f0: 880, f1: 1320, t: 0.3, gain: 0.10, delay: 0.1 }); break;
      case 'key':     [880, 1175, 1568].forEach((f, i) => this.tone({ type: 'sine', f0: f, f1: f, t: 0.28, gain: 0.13, delay: i * 0.07 })); break;
      case 'pickup':  this.tone({ type: 'sine', f0: 660, f1: 990, t: 0.14, gain: 0.11 }); break;
      case 'swing':   this.noise({ t: 0.10, gain: 0.06 * v, f: 2600, q: 0.6, sweep: 900 }); break;
      case 'hitEnt':  this.noise({ t: 0.16, gain: 0.16 * v, f: 420, q: 1.2, sweep: 160 });
                      this.tone({ type: 'sawtooth', f0: 190, f1: 70, t: 0.16, gain: 0.09 * v }); break;
      case 'hurt':    this.tone({ type: 'sawtooth', f0: 220, f1: 60, t: 0.34, gain: 0.18 });
                      this.noise({ t: 0.3, gain: 0.14, f: 500, q: 0.8, sweep: 140 }); break;
      case 'growl':   this.tone({ type: 'sawtooth', f0: 90, f1: 55, t: 0.7, gain: 0.09 * v, filter: 'lowpass', q: 3 }); break;
      case 'smile':   this.tone({ type: 'sine', f0: 1500, f1: 380, t: 0.6, gain: 0.07 * v }); break;
      case 'alert':   this.tone({ type: 'square', f0: 660, f1: 330, t: 0.2, gain: 0.10 }); break;
      case 'door':    this.noise({ t: 0.5, gain: 0.16, f: 300, q: 0.6, sweep: 90 }); break;
      case 'clear':   [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', f0: f, f1: f, t: 0.5, gain: 0.14, delay: i * 0.11 })); break;
      case 'dead':    this.tone({ type: 'sawtooth', f0: 300, f1: 40, t: 1.5, gain: 0.2, filter: 'lowpass', q: 2 }); break;
      case 'ui':      this.tone({ type: 'sine', f0: 700, f1: 900, t: 0.06, gain: 0.07 }); break;
      case 'grant':   [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ type: 'triangle', f0: f, f1: f, t: 0.6, gain: 0.13, delay: i * 0.1 })); break;
      case 'boom':    this.noise({ t: 1.4, gain: 0.3, f: 400, q: 0.4, sweep: 50 });
                      this.tone({ type: 'sine', f0: 90, f1: 28, t: 1.4, gain: 0.22 }); break;
      default: break;
    }
  },

  /* ---------- エモート音 ---------- */
  emote(kind) {
    this.ensure(); if (!this.ctx || this.muted) { return; }
    switch (kind) {
      case 'whistle': this.whistle(); break;
      case 'chirp':
        this.tone({ type: 'sine', f0: 700, f1: 1100, t: 0.1, gain: 0.13 });
        this.tone({ type: 'sine', f0: 1100, f1: 900, t: 0.1, gain: 0.11, delay: 0.1 });
        break;
      case 'scream':
        this.tone({ type: 'sawtooth', f0: 620, f1: 900, t: 0.5, gain: 0.13, filter: 'bandpass', q: 4 });
        this.noise({ t: 0.55, gain: 0.12, f: 1400, q: 1.2, sweep: 700 });
        break;
      case 'laugh':
        for (let i = 0; i < 5; i++) {
          this.tone({ type: 'triangle', f0: 380 - i * 24, f1: 300 - i * 24, t: 0.08, gain: 0.11, delay: i * 0.11 });
        }
        break;
      case 'chime':
        [1047, 1319, 1568].forEach((f, i) => this.tone({ type: 'sine', f0: f, f1: f, t: 0.5, gain: 0.10, delay: i * 0.05 }));
        break;
      case 'rattle':
        for (let i = 0; i < 6; i++) { this.noise({ t: 0.05, gain: 0.10, f: 2200 - i * 90, q: 5, delay: i * 0.055 }); }
        break;
      case 'spooky':
        this.tone({ type: 'sine', f0: 180, f1: 120, t: 0.9, gain: 0.13, filter: 'lowpass', q: 3 });
        this.tone({ type: 'sine', f0: 268, f1: 182, t: 0.9, gain: 0.07, delay: 0.06 });
        break;
      case 'pop':
        this.tone({ type: 'sine', f0: 300, f1: 900, t: 0.07, gain: 0.14 });
        break;
      default: break;
    }
  },

  /** 口笛：矩形ではなく細いバンドパスの正弦にビブラートを掛ける */
  whistle() {
    const c = this.ctx, now = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    const g = c.createGain();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 6;

    // 上がって、跳ねて、落ちる 3 音のフレーズ
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(1320, now + 0.18);
    o.frequency.setValueAtTime(1320, now + 0.30);
    o.frequency.exponentialRampToValueAtTime(1760, now + 0.42);
    o.frequency.setValueAtTime(1760, now + 0.52);
    o.frequency.exponentialRampToValueAtTime(1046, now + 0.85);

    // ビブラート
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
    const lg = c.createGain(); lg.gain.value = 26;
    lfo.connect(lg); lg.connect(o.frequency);

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.20, now + 0.05);
    g.gain.setValueAtTime(0.20, now + 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);

    o.connect(bp); bp.connect(g); g.connect(this.master);
    o.start(now); lfo.start(now);
    o.stop(now + 1.0); lfo.stop(now + 1.0);

    // 息の成分をうっすら足すと口笛らしくなる
    this.noise({ t: 0.9, gain: 0.018, f: 2400, q: 2 });
  },

  /* ---------- 環境音（蛍光灯のうなり） ---------- */
  ambient(on, tint = 120) {
    this.ensure(); if (!this.ctx) { return; }
    if (on && !this.amb) {
      const c = this.ctx;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = tint;
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = tint * 2.01;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 2;
      const g = c.createGain(); g.gain.value = 0.0;
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
      o.start(); o2.start();
      g.gain.linearRampToValueAtTime(0.035, c.currentTime + 1.2);
      this.amb = [o, o2]; this.ambGain = g;
    } else if (!on && this.amb) {
      const c = this.ctx;
      this.ambGain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.4);
      const nodes = this.amb;
      setTimeout(() => nodes.forEach(n => { try { n.stop(); } catch (e) { /* 既に停止済み */ } }), 600);
      this.amb = null; this.ambGain = null;
    }
  },

  /** 心音：敵が近いときの緊張 */
  heart(v) {
    this.tone({ type: 'sine', f0: 70, f1: 40, t: 0.14, gain: 0.10 * v });
    this.tone({ type: 'sine', f0: 62, f1: 36, t: 0.13, gain: 0.07 * v, delay: 0.19 });
  },
};

/* =========================================================================
   セーブ（この端末の localStorage だけ）
   ========================================================================= */
const SAVE_KEY = 'noclip.save.v1';
const Save = {
  data: null,

  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { d = null; }
    this.data = Object.assign({
      cleared: {},          // stageId -> { best: sec, runs, deaths }
      skins: ['surveyor'],
      equipped: 'surveyor',
      candy: 0,
      hwYear: 0,            // ハロウィン限定を配った年
      hwSim: false,         // 動作確認用の期間シミュレート
    }, d || {});
    if (!this.data.skins.includes('surveyor')) { this.data.skins.unshift('surveyor'); }
    return this.data;
  },

  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* 容量超過は無視 */ } },

  isCleared(id) { return !!this.data.cleared[id]; },
  has(skinId) { return this.data.skins.includes(skinId); },

  grant(skinId) {
    if (this.has(skinId)) { return false; }
    this.data.skins.push(skinId); this.save(); return true;
  },

  /** ステージが解放済みか。lv0 は常に開いており、以降は 1 つ前のクリアが条件 */
  isUnlocked(id) {
    const i = STAGES.findIndex(s => s.id === id);
    if (i <= 0) { return true; }
    return this.isCleared(STAGES[i - 1].id);
  },

  recordClear(id, sec) {
    const c = this.data.cleared[id] || { best: Infinity, runs: 0 };
    c.runs += 1;
    if (sec < (c.best ?? Infinity)) { c.best = sec; }
    this.data.cleared[id] = c;
    this.save();
  },
};

/* ---------- ハロウィン判定 ---------- */
function isHalloween(d = new Date()) {
  if (Save.data && Save.data.hwSim) { return true; }
  const m = d.getMonth() + 1, day = d.getDate();
  return (m === 10 && day >= 25) || (m === 11 && day === 1);
}
