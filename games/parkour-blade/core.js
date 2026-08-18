/* =========================================================================
   PARKOUR BLADE ― コア
   小物・セーブ・入力（キーボード＋タッチ）・効果音・粒子
   ========================================================================= */

/* ===================== 小物 ===================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** ミリ秒を 00:00.00 形式にする。 */
function fmtTime(ms) {
  if (!ms && ms !== 0) return '--:--.--';
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const c = Math.floor((t % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** 目標タイム（S/A/B の順）と比べてランクを返す。 */
function rankOf(ms, target) {
  if (ms <= target[0]) return 'S';
  if (ms <= target[1]) return 'A';
  if (ms <= target[2]) return 'B';
  return 'C';
}

/* ===================== セーブデータ ===================== */
const SAVE_KEY = 'pb-save-v1';

const Save = {
  data: { stages: {}, muted: false },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.stages) this.data = d;
      }
    } catch (e) { /* 壊れていたら初期値のまま続行 */ }
    LEVELS.forEach((lv) => this.stage(lv.id));
    return this.data;
  },

  write() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* 保存できなくても続行 */ }
  },

  stage(id) {
    let s = this.data.stages[id];
    if (!s) { s = { cleared: false, bestMs: 0, bolts: [false, false, false], deaths: 0 }; this.data.stages[id] = s; }
    if (!Array.isArray(s.bolts)) s.bolts = [false, false, false];
    return s;
  },

  /** クリア結果を記録し、自己ベスト更新なら true を返す。 */
  record(id, ms, bolts, deaths) {
    const s = this.stage(id);
    const isBest = !s.bestMs || ms < s.bestMs;
    s.cleared = true;
    if (isBest) s.bestMs = ms;
    bolts.forEach((got, i) => { if (got) s.bolts[i] = true; });
    s.deaths += deaths;
    this.write();
    return isBest;
  },

  reset() {
    this.data = { stages: {}, muted: this.data.muted };
    LEVELS.forEach((lv) => this.stage(lv.id));
    this.write();
  },
};

/* ===================== 入力 ===================== */
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', KeyZ: 'jump',
  ShiftLeft: 'dash', ShiftRight: 'dash', KeyX: 'dash',
  KeyC: 'slide', KeyK: 'slide',
  KeyR: 'restart',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
};

const Input = {
  down: {},
  prev: {},
  touch: { x: 0, y: 0, jump: false, dash: false, slide: false },
  isTouch: false,
  onKey: null,          // 画面遷移用のコールバック（restart / pause / mute）

  init() {
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.repeat) { e.preventDefault(); return; }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.down[a] = true;
      Sound.unlock();
      if (this.onKey && (a === 'restart' || a === 'pause' || a === 'mute')) this.onKey(a);
    });

    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.down[a] = false;
    });

    window.addEventListener('blur', () => { this.down = {}; });

    this.initTouch();
  },

  initTouch() {
    const pad = $('tpad');
    const knob = $('tpad-knob');
    let padId = null;
    const R = 52;

    const move = (t) => {
      const r = pad.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2);
      let dy = t.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy) || 1;
      const c = Math.min(1, m / R);
      this.touch.x = (dx / m) * c;
      this.touch.y = (dy / m) * c;
      knob.style.transform = `translate(${(dx / m) * c * R}px, ${(dy / m) * c * R}px)`;
    };

    pad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      padId = e.changedTouches[0].identifier;
      move(e.changedTouches[0]);
      Sound.unlock();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (padId === null) return;
      for (const t of e.changedTouches) if (t.identifier === padId) move(t);
    }, { passive: false });

    const end = (e) => {
      if (padId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== padId) continue;
        padId = null;
        this.touch.x = 0;
        this.touch.y = 0;
        knob.style.transform = '';
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    $$('.tbtn').forEach((b) => {
      const act = b.dataset.act;
      const on = (e) => { e.preventDefault(); this.touch[act] = true; b.classList.add('on'); Sound.unlock(); };
      const off = (e) => { e.preventDefault(); this.touch[act] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    });
  },

  /** 進行方向（長さ1以下のベクトル）。 */
  axis() {
    let x = (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
    let y = (this.down.down ? 1 : 0) - (this.down.up ? 1 : 0);
    if (!x && !y) { x = this.touch.x; y = this.touch.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y, m: Math.min(1, m) };
  },

  held(a) { return !!this.down[a] || !!this.touch[a]; },
  pressed(a) { return this.held(a) && !this.prev[a]; },

  endFrame() {
    this.prev = {};
    ['up', 'down', 'left', 'right', 'jump', 'dash', 'slide'].forEach((a) => { this.prev[a] = this.held(a); });
  },
};

/* ===================== 効果音（合成音のみ・音源ファイル不要） ===================== */
const Sound = {
  ctx: null,
  master: null,
  sawGain: null,
  muted: false,

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.buildSawHum();
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },

  /** 刃の唸り。いちばん近い刃との距離で音量と高さが変わる。 */
  buildSawHum() {
    const c = this.ctx;
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    const g = c.createGain();
    const flt = c.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.value = 92;
    osc2.type = 'square';
    osc2.frequency.value = 139;
    flt.type = 'bandpass';
    flt.frequency.value = 780;
    flt.Q.value = 1.6;
    g.gain.value = 0;
    osc.connect(flt); osc2.connect(flt); flt.connect(g); g.connect(this.master);
    osc.start(); osc2.start();
    this.sawGain = g;
    this.sawOsc = osc;
  },

  /** 0（遠い）〜1（すぐ隣）で刃の唸りを更新する。 */
  setSawLevel(v) {
    if (!this.sawGain) return;
    const t = this.ctx.currentTime;
    this.sawGain.gain.setTargetAtTime(clamp(v, 0, 1) * 0.16, t, 0.08);
    this.sawOsc.frequency.setTargetAtTime(78 + v * 46, t, 0.1);
  },

  tone(freq, dur, type = 'square', vol = 0.2, freq2) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.2, freq = 1200, q = 0.8) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const flt = c.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t);
  },

  jump() { this.tone(430, 0.13, 'square', 0.13, 760); this.noise(0.07, 0.06, 2400); },
  land() { this.noise(0.11, 0.13, 420, 1.2); },
  kick() { this.tone(300, 0.16, 'sawtooth', 0.16, 880); this.noise(0.12, 0.14, 1800, 1.4); },
  slide() { this.noise(0.34, 0.1, 900, 0.6); },
  grab() { this.noise(0.08, 0.09, 640, 1.6); },
  bolt() { this.tone(920, 0.09, 'triangle', 0.16); this.tone(1380, 0.11, 'triangle', 0.12); },
  check() { this.tone(660, 0.1, 'triangle', 0.16); setTimeout(() => this.tone(990, 0.18, 'triangle', 0.16), 90); },
  pad() { this.tone(220, 0.22, 'sawtooth', 0.18, 1100); },
  death() { this.noise(0.3, 0.3, 500, 0.5); this.tone(240, 0.42, 'sawtooth', 0.2, 60); },
  fall() { this.tone(500, 0.7, 'sine', 0.16, 70); },
  goal() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.18), i * 95));
  },
};

/* ===================== 粒子 ===================== */
const Particles = {
  list: [],

  clear() { this.list.length = 0; },

  add(p) {
    if (this.list.length > 460) this.list.shift();
    this.list.push(Object.assign({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 30, max: 30, size: 3, col: '#fff', grav: 0.28, drag: 0.94, glow: 0, shape: 'dot',
      rot: 0, vr: 0,
    }, p));
  },

  burst(x, y, z, n, opt) {
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const sp = rand(opt.sp || 3, (opt.sp || 3) * 0.25);
      this.add(Object.assign({}, opt, {
        x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7,
        vz: rand(opt.vz || 2.4, 0.2),
        life: opt.life || randInt(18, 34),
        max: opt.life || 34,
        rot: rand(Math.PI * 2), vr: rand(0.4, -0.4),
      }));
    }
  },

  update(dtf) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.x += p.vx * dtf;
      p.y += p.vy * dtf;
      p.z += p.vz * dtf;
      p.vz -= p.grav * dtf;
      p.vx *= Math.pow(p.drag, dtf);
      p.vy *= Math.pow(p.drag, dtf);
      p.rot += p.vr * dtf;
      if (p.z < 0) { p.z = 0; p.vz *= -0.32; p.vx *= 0.72; p.vy *= 0.72; }
      p.life -= dtf;
      if (p.life <= 0) l.splice(i, 1);
    }
  },

  draw(ctx) {
    for (const p of this.list) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.col;
      if (p.glow) { ctx.shadowColor = p.col; ctx.shadowBlur = p.glow; }
      const sy = p.y - p.z * 0.55;
      if (p.shape === 'spark') {
        ctx.save();
        ctx.translate(p.x, sy);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size * 2, -p.size * 0.35, p.size * 4, p.size * 0.7);
        ctx.restore();
      } else if (p.shape === 'chip') {
        ctx.save();
        ctx.translate(p.x, sy);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, sy, p.size * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  },
};
