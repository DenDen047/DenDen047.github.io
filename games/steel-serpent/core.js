/* =========================================================================
   STEEL SERPENT ― コア
   小物 / 入力 / 効果音 / パーティクル / カメラ / 画面効果 / セーブ
   ========================================================================= */

/* ===================== 小物 ===================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
/* 線分と矩形の交差（弾のすり抜け防止・視線判定に使う） */
function segRect(x1, y1, x2, y2, r) {
  if (pointInRect(x1, y1, r) || pointInRect(x2, y2, r)) return true;
  const l = r.x, t = r.y, rr = r.x + r.w, b = r.y + r.h;
  return segSeg(x1, y1, x2, y2, l, t, rr, t) || segSeg(x1, y1, x2, y2, rr, t, rr, b) ||
         segSeg(x1, y1, x2, y2, rr, b, l, b) || segSeg(x1, y1, x2, y2, l, b, l, t);
}
function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => clamp(Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/* ===================== 入力 ===================== */
const Input = {
  keys: Object.create(null),
  just: Object.create(null),
  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, rdown: false, moved: false },
  wheel: 0,
  touch: { active: false, mx: 0, my: 0, btn: Object.create(null), btnJust: Object.create(null) },
  usingTouch: false,

  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true; this.just[e.code] = true;
      Audio.unlock();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.mouse.down = false; });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true; this.usingTouch = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      Audio.unlock();
      if (e.button === 0) { this.mouse.down = true; this.just['Fire'] = true; }
      if (e.button === 2) { this.mouse.rdown = true; this.just['Dodge'] = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rdown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel += sign(e.deltaY); }, { passive: false });

    this.initTouch();
  },

  initTouch() {
    const pad = $('tpad'), knob = $('tpad-knob');
    if (!pad) return;
    let padId = null, cx = 0, cy = 0;
    const startPad = (t) => {
      const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      padId = t.identifier; this.usingTouch = true; this.touch.active = true;
    };
    const movePad = (t) => {
      const dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.min(Math.hypot(dx, dy), 52) || 1;
      const a = Math.atan2(dy, dx);
      this.touch.mx = Math.cos(a) * (d / 52); this.touch.my = Math.sin(a) * (d / 52);
      knob.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px)`;
    };
    const endPad = () => { padId = null; this.touch.mx = 0; this.touch.my = 0; knob.style.transform = ''; };
    pad.addEventListener('touchstart', (e) => { e.preventDefault(); Audio.unlock(); startPad(e.changedTouches[0]); movePad(e.changedTouches[0]); }, { passive: false });
    pad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === padId) movePad(t);
    }, { passive: false });
    const endEv = (e) => { for (const t of e.changedTouches) if (t.identifier === padId) endPad(); };
    pad.addEventListener('touchend', endEv); pad.addEventListener('touchcancel', endEv);

    $$('.tbtn').forEach((b) => {
      const act = b.dataset.act;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault(); Audio.unlock(); this.usingTouch = true; this.touch.active = true;
        this.touch.btn[act] = true; this.touch.btnJust[act] = true;
      }, { passive: false });
      const up = (e) => { e.preventDefault(); this.touch.btn[act] = false; };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    });
  },

  down(...codes) { return codes.some((c) => this.keys[c]); },
  pressed(...codes) { return codes.some((c) => this.just[c]); },
  tDown(a) { return !!this.touch.btn[a]; },
  tPressed(a) { return !!this.touch.btnJust[a]; },
  endFrame() { this.just = Object.create(null); this.touch.btnJust = Object.create(null); this.wheel = 0; },
};

/* ===================== 効果音（WebAudio 合成） ===================== */
const Audio = {
  ctx: null, master: null, musicGain: null, enabled: true, musicTimer: 0, musicStep: 0, musicMode: null,

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.3; this.musicGain.connect(this.master);
  },
  now() { return this.ctx ? this.ctx.currentTime : 0; },

  tone(freq, dur, type = 'sine', vol = 0.3, dest = null, slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now();
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.3, filterFreq = 1200, type = 'lowpass', sweepTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now();
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  },

  shot(kind) {
    switch (kind) {
      case 'silenced': this.noise(0.07, 0.22, 1800, 'bandpass'); this.tone(320, 0.05, 'triangle', 0.1, null, 120); break;
      case 'rifle': this.noise(0.13, 0.4, 2600, 'lowpass', 400); this.tone(150, 0.08, 'square', 0.14, null, 60); break;
      case 'shotgun': this.noise(0.24, 0.5, 1400, 'lowpass', 180); this.tone(90, 0.16, 'sawtooth', 0.2, null, 40); break;
      case 'sniper': this.noise(0.34, 0.5, 3400, 'lowpass', 200); this.tone(210, 0.2, 'square', 0.18, null, 50); break;
      case 'launcher': this.noise(0.3, 0.45, 900, 'lowpass', 120); this.tone(70, 0.3, 'sawtooth', 0.22, null, 30); break;
      case 'tranq': this.noise(0.06, 0.18, 2400, 'bandpass'); this.tone(700, 0.06, 'sine', 0.1, null, 300); break;
      default: this.noise(0.1, 0.3, 2200, 'lowpass', 500);
    }
  },
  slash() { this.noise(0.11, 0.34, 5200, 'bandpass', 1600); this.tone(1400, 0.09, 'triangle', 0.12, null, 420); },
  stab()  { this.noise(0.16, 0.3, 900, 'lowpass', 200); this.tone(200, 0.12, 'sawtooth', 0.14, null, 60); },
  hit()   { this.noise(0.07, 0.26, 700, 'lowpass'); },
  ric()   { this.tone(rand(2600, 1500), 0.11, 'square', 0.09, null, 600); },
  explode() { this.noise(0.65, 0.6, 900, 'lowpass', 60); this.tone(58, 0.6, 'sawtooth', 0.28, null, 24); },
  alert() { this.tone(920, 0.1, 'square', 0.24); setTimeout(() => this.tone(1250, 0.16, 'square', 0.24), 105); },
  caution() { this.tone(620, 0.12, 'square', 0.18); },
  pickup() { this.tone(880, 0.07, 'square', 0.16); setTimeout(() => this.tone(1320, 0.1, 'square', 0.16), 70); },
  codec() { this.tone(1180, 0.05, 'sine', 0.14); setTimeout(() => this.tone(880, 0.05, 'sine', 0.12), 60); },
  blip()  { this.tone(1500, 0.03, 'sine', 0.06); },
  rushStart() {
    this.tone(1600, 0.5, 'sine', 0.2, null, 240);
    this.noise(0.5, 0.24, 3000, 'bandpass', 300);
  },
  rushEnd() { this.tone(240, 0.5, 'sawtooth', 0.2, null, 60); this.noise(0.3, 0.2, 1200, 'lowpass', 200); },
  perfect() { this.tone(1760, 0.1, 'triangle', 0.2); setTimeout(() => this.tone(2640, 0.22, 'triangle', 0.18), 80); },
  dodge() { this.noise(0.16, 0.16, 900, 'bandpass', 2400); },
  jump() { this.noise(0.07, 0.1, 600, 'lowpass'); },
  land() { this.noise(0.1, 0.16, 400, 'lowpass'); },
  reload() { this.noise(0.05, 0.2, 3000, 'bandpass'); setTimeout(() => this.noise(0.06, 0.22, 1600, 'bandpass'), 150); },
  empty() { this.tone(180, 0.05, 'square', 0.1); },
  dead() { this.tone(300, 1.4, 'sawtooth', 0.22, null, 45); },
  bossRoar() { this.tone(120, 1.1, 'sawtooth', 0.3, null, 42); this.noise(1.0, 0.3, 500, 'lowpass', 80); },

  /* 簡易 BGM：ステージごとに脈打つベースとアルペジオ */
  setMusic(mode) { this.musicMode = mode; this.musicStep = 0; this.musicTimer = 0; },
  updateMusic(dt) {
    if (!this.ctx || !this.enabled || !this.musicMode) return;
    const M = {
      calm:  { bpm: 96,  root: 55,  scale: [0, 3, 7, 10], vol: 0.10 },
      tense: { bpm: 124, root: 62,  scale: [0, 1, 5, 8],  vol: 0.13 },
      boss:  { bpm: 152, root: 49,  scale: [0, 3, 5, 6],  vol: 0.16 },
    }[this.musicMode];
    if (!M) return;
    const beat = 60 / M.bpm / 2;
    this.musicTimer += dt;
    while (this.musicTimer >= beat) {
      this.musicTimer -= beat;
      const s = this.musicStep++;
      const f = (n) => 440 * Math.pow(2, (n - 69) / 12);
      if (s % 4 === 0) this.tone(f(M.root), beat * 2.4, 'triangle', M.vol, this.musicGain);
      if (s % 8 === 4) this.tone(f(M.root + 12), beat * 1.2, 'sine', M.vol * 0.6, this.musicGain);
      if (this.musicMode !== 'calm' && s % 2 === 1) {
        this.tone(f(M.root + 24 + M.scale[(s >> 1) % M.scale.length]), beat * 0.7, 'square', M.vol * 0.25, this.musicGain);
      }
      if (this.musicMode === 'boss' && s % 4 === 2) this.noise(0.07, 0.1, 4000, 'highpass');
    }
  },
};

/* ===================== パーティクル ===================== */
const FX = {
  list: [],
  clear() { this.list.length = 0; },
  add(p) { if (this.list.length < 1400) this.list.push(p); return p; },

  spark(x, y, n = 6, color = '#ffd27a', spd = 240, life = 0.35) {
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      this.add({ k: 'dot', x, y, vx: Math.cos(a) * rand(spd, spd * 0.2), vy: Math.sin(a) * rand(spd, spd * 0.2) - 30, g: 420, life, t: 0, c: color, r: rand(2.6, 1) });
    }
  },
  blood(x, y, n = 8, dir = 0) {
    for (let i = 0; i < n; i++) {
      const a = dir + rand(1.4, -1.4);
      this.add({ k: 'dot', x, y, vx: Math.cos(a) * rand(320, 60), vy: Math.sin(a) * rand(200, -120), g: 700, life: rand(0.6, 0.3), t: 0, c: pick(['#c1242f', '#8e1720', '#e04a52']), r: rand(3.2, 1.4) });
    }
  },
  smoke(x, y, n = 4, color = '#8f9aa2', spd = 30, sz = 12) {
    for (let i = 0; i < n; i++) {
      this.add({ k: 'smoke', x: x + rand(8, -8), y: y + rand(8, -8), vx: rand(spd, -spd), vy: rand(-10, -50), g: -12, life: rand(1.1, 0.6), t: 0, c: color, r: rand(sz, sz * 0.5) });
    }
  },
  dust(x, y, n = 5, color = '#6b7780') {
    for (let i = 0; i < n; i++) this.add({ k: 'smoke', x: x + rand(10, -10), y, vx: rand(70, -70), vy: rand(-8, -46), g: 40, life: rand(0.5, 0.25), t: 0, c: color, r: rand(7, 3) });
  },
  shell(x, y, dir) {
    this.add({ k: 'shell', x, y, vx: -dir * rand(130, 50) + rand(30, -30), vy: rand(-180, -260), g: 780, life: 1.1, t: 0, c: '#d3a94a', rot: 0, vr: rand(16, -16) });
  },
  ring(x, y, color = '#ffffff', r0 = 6, r1 = 60, life = 0.3, lw = 3) {
    this.add({ k: 'ring', x, y, r0, r1, life, t: 0, c: color, lw });
  },
  slashArc(x, y, ang, len = 70, color = '#eaffff', life = 0.22) {
    this.add({ k: 'slash', x, y, ang, len, life, t: 0, c: color });
  },
  text(x, y, txt, color = '#fff', size = 16, life = 0.9, vy = -60) {
    this.add({ k: 'text', x, y, vx: 0, vy, g: 60, life, t: 0, c: color, txt, size });
  },
  trail(x, y, color, r = 4, life = 0.25) {
    this.add({ k: 'dot', x, y, vx: 0, vy: 0, g: 0, life, t: 0, c: color, r });
  },
  rain(x, y, len) { this.add({ k: 'rain', x, y, vx: -90, vy: 900, life: 1.2, t: 0, c: '#7fa9c4', len }); },

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.t >= p.life) { this.list.splice(i, 1); continue; }
      if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.g) p.vy += p.g * dt;
      if (p.k === 'shell') p.rot += p.vr * dt;
      if (p.k === 'smoke') { p.r += 18 * dt; p.vx *= 0.97; }
    }
  },

  draw(ctx) {
    for (const p of this.list) {
      const k = 1 - p.t / p.life;
      ctx.save();
      switch (p.k) {
        case 'dot':
          ctx.globalAlpha = k; ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k + 0.4, 0, 7); ctx.fill();
          break;
        case 'smoke':
          ctx.globalAlpha = k * 0.42; ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
          break;
        case 'shell':
          ctx.globalAlpha = k; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.c; ctx.fillRect(-3, -1.4, 6, 2.8);
          break;
        case 'ring':
          ctx.globalAlpha = k * 0.9; ctx.strokeStyle = p.c; ctx.lineWidth = p.lw * k + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, lerp(p.r0, p.r1, 1 - k), 0, 7); ctx.stroke();
          break;
        case 'slash': {
          ctx.globalAlpha = k; ctx.translate(p.x, p.y); ctx.rotate(p.ang);
          const g = ctx.createLinearGradient(-p.len / 2, 0, p.len / 2, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, p.c); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 12 * k + 1; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(-p.len / 2, 0); ctx.lineTo(p.len / 2, 0); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,' + (k * 0.9) + ')'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-p.len / 2, 0); ctx.lineTo(p.len / 2, 0); ctx.stroke();
          break;
        }
        case 'text':
          ctx.globalAlpha = Math.min(1, k * 2.2);
          ctx.font = `900 ${p.size}px "Helvetica Neue", sans-serif`;
          ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.72)';
          ctx.strokeText(p.txt, p.x, p.y); ctx.fillStyle = p.c; ctx.fillText(p.txt, p.x, p.y);
          break;
        case 'rain':
          ctx.globalAlpha = k * 0.45; ctx.strokeStyle = p.c; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * 0.1, p.y + p.len); ctx.stroke();
          break;
      }
      ctx.restore();
    }
  },
};

/* ===================== カメラ ===================== */
const Cam = {
  x: 0, y: 0, tx: 0, ty: 0, shake: 0, shakeX: 0, shakeY: 0, zoom: 1, tzoom: 1,
  w: 960, h: 540, bounds: { x: 0, y: 0, w: 4000, h: 900 },

  reset(x, y) { this.x = this.tx = x; this.y = this.ty = y; this.shake = 0; this.zoom = this.tzoom = 1; },
  follow(px, py, lookX, lookY, dt) {
    this.tx = px + lookX; this.ty = py + lookY;
    const k = 1 - Math.pow(0.001, dt);
    this.x = lerp(this.x, this.tx, k); this.y = lerp(this.y, this.ty, k);
    this.zoom = lerp(this.zoom, this.tzoom, 1 - Math.pow(0.01, dt));
    const vw = this.w / this.zoom, vh = this.h / this.zoom;
    this.x = clamp(this.x, this.bounds.x + vw / 2, Math.max(this.bounds.x + vw / 2, this.bounds.x + this.bounds.w - vw / 2));
    this.y = clamp(this.y, this.bounds.y + vh / 2, Math.max(this.bounds.y + vh / 2, this.bounds.y + this.bounds.h - vh / 2));
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 22);
      this.shakeX = rand(this.shake, -this.shake); this.shakeY = rand(this.shake, -this.shake);
    } else { this.shakeX = this.shakeY = 0; }
  },
  kick(amount) { this.shake = Math.min(26, this.shake + amount); },
  apply(ctx) {
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + this.shakeX, -this.y + this.shakeY);
  },
  toWorld(sx, sy) {
    return {
      x: (sx - this.w / 2) / this.zoom + this.x - this.shakeX,
      y: (sy - this.h / 2) / this.zoom + this.y - this.shakeY,
    };
  },
  view() {
    const vw = this.w / this.zoom, vh = this.h / this.zoom;
    return { x: this.x - vw / 2, y: this.y - vh / 2, w: vw, h: vh };
  },
};

/* ===================== 画面効果 ===================== */
const Screen = {
  flashA: 0, flashC: '#fff', hitstop: 0, slow: 1, slowT: 0, vignette: 0, chroma: 0,
  flash(c = '#fff', a = 0.6) { this.flashC = c; this.flashA = Math.max(this.flashA, a); },
  stop(t) { this.hitstop = Math.max(this.hitstop, t); },
  slowmo(scale, dur) { this.slow = scale; this.slowT = Math.max(this.slowT, dur); },
  update(dt) {
    this.flashA = Math.max(0, this.flashA - dt * 3.2);
    this.chroma = Math.max(0, this.chroma - dt * 4);
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slow = 1; }
  },
  draw(ctx, w, h) {
    if (this.flashA > 0.003) {
      ctx.save(); ctx.globalAlpha = this.flashA; ctx.fillStyle = this.flashC; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
    if (this.vignette > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, h * 0.82);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(90,0,6,${this.vignette})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  },
};

/* ===================== セーブ ===================== */
const SAVE_KEY = 'steel-serpent-save-v1';
const Save = {
  data: { cleared: {}, ranks: {}, diff: 'normal', unlocked: 1 },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* 保存できない環境でも遊べるように無視 */ }
    return this.data;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* noop */ }
  },
  hasProgress() { return this.data.unlocked > 1 || Object.keys(this.data.cleared).length > 0; },
};
