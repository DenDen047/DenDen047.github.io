/* =========================================================================
   GACHA STRIKERS ― コア
   セーブ、状態、入力、サウンド、選手の能力計算、似顔絵描画、UIヘルパー
   ========================================================================= */

/* ===================== 小物 ===================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starStr(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => clamp(Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/* ===================== セーブデータ ===================== */
const SAVE_KEY = 'gs-save-v1';

const G = {
  tickets: 0,
  owned: {},            // id -> { lv, exp, breaks, dupes }
  formation: 'f221',
  lineup: [null, null, null, null, null, null],
  cleared: {},          // stageId -> { wins, bestGf, bestGa }
  pulls: 0,
  pity: 0,
  stats: { matches: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, hissatsuGoals: 0 },
  muted: false,
  clubName: 'フロッグジラフ・クラブ',
  gardenPos: null,
};

const Save = {
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) { /* 保存できなくても続行 */ }
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !d.owned) return false;
      Object.assign(G, d);
      // データ定義が更新された場合に備えて、存在しない選手IDを掃除する
      Object.keys(G.owned).forEach((id) => { if (!CHAR_BY_ID[id]) delete G.owned[id]; });
      G.lineup = (G.lineup || []).map((id) => (id && G.owned[id] ? id : null));
      while (G.lineup.length < 6) G.lineup.push(null);
      if (!FORMATION_BY_ID[G.formation]) G.formation = 'f221';
      return true;
    } catch (e) { return false; }
  },
  exists() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
  wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ } },
};

function newGame() {
  G.tickets = 5;
  G.owned = {};
  G.cleared = {};
  G.pulls = 0; G.pity = 0;
  G.stats = { matches: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, hissatsuGoals: 0 };
  G.formation = 'f221';
  G.lineup = [null, null, null, null, null, null];
  G.gardenPos = null;
  STARTER_IDS.forEach((id) => addChar(id));
  autoLineup();
  Save.save();
}

function addChar(id) {
  const c = CHAR_BY_ID[id];
  if (!c) return { isNew: false, broke: false, refund: 0 };
  const rec = G.owned[id];
  if (!rec) {
    G.owned[id] = { lv: 1, exp: 0, breaks: 0, dupes: 0 };
    return { isNew: true, broke: false, refund: 0 };
  }
  rec.dupes++;
  if (rec.breaks < GROWTH.maxBreak) { rec.breaks++; return { isNew: false, broke: true, refund: 0 }; }
  const refund = GACHA.dupeShards[c.rarity] || 1;
  G.tickets += refund;
  return { isNew: false, broke: false, refund };
}

/* ===================== 能力計算 ===================== */
function maxLevel(rec) { return GROWTH.maxLevelBase + rec.breaks * GROWTH.maxLevelPerBreak; }
function expToNext(lv) { return GROWTH.expCurve(lv); }

/** レベル・凸を反映した素の能力 */
function baseStats(rec, char) {
  const m = 1 + (rec.lv - 1) * GROWTH.statPerLevel + rec.breaks * GROWTH.statPerBreak;
  const out = {};
  for (const k in char.base) out[k] = char.base[k] * m;
  return out;
}

const RATING_W = {
  GK: { cat: 0.50, def: 0.25, spd: 0.13, pas: 0.12 },
  DF: { def: 0.45, spd: 0.20, pas: 0.15, dri: 0.10, sho: 0.10 },
  MF: { pas: 0.30, dri: 0.25, spd: 0.20, def: 0.15, sho: 0.10 },
  FW: { sho: 0.40, dri: 0.25, spd: 0.25, pas: 0.10 },
};
function ratingFrom(stats, pos) {
  const w = RATING_W[pos];
  let s = 0;
  for (const k in w) s += (stats[k] || 0) * w[k];
  return Math.round(s);
}
function charRating(rec, char, slotRole) {
  const st = baseStats(rec, char);
  const fit = slotRole ? posFitFactor(char.pos, slotRole) : 1;
  for (const k in st) st[k] *= fit;
  return ratingFrom(st, slotRole || char.pos);
}

/** 編成全体の属性ボーナスを求める */
function chemistryOf(lineup) {
  const count = {};
  lineup.forEach((id) => { if (id && CHAR_BY_ID[id]) { const e = CHAR_BY_ID[id].elem; count[e] = (count[e] || 0) + 1; } });
  const bonus = {};
  const tags = [];
  for (const e in count) {
    const n = count[e];
    let b = 0;
    if (n >= 5) b = 0.12; else if (n >= 3) b = 0.06;
    if (b > 0) { bonus[e] = b; tags.push({ elem: e, n, bonus: b }); }
  }
  return { count, bonus, tags };
}

/** 試合で使う選手データを組み立てる */
function buildSquad() {
  const fm = FORMATION_BY_ID[G.formation];
  const chem = chemistryOf(G.lineup);
  const out = [];
  fm.slots.forEach((slot, i) => {
    const id = G.lineup[i];
    if (!id || !G.owned[id]) { out.push(null); return; }
    const char = CHAR_BY_ID[id];
    const rec = G.owned[id];
    const st = baseStats(rec, char);
    const fit = posFitFactor(char.pos, slot.role);
    const fb = fm.bonus.stats || {};
    const cb = chem.bonus[char.elem] || 0;
    for (const k in st) st[k] = st[k] * fit * (1 + (fb[k] || 0)) * (1 + cb);
    out.push({
      id, char, rec, slot, slotIndex: i, stats: st,
      rating: ratingFrom(st, slot.role),
      hissatsu: char.hissatsu,
    });
  });
  return out;
}

function teamRating() {
  const sq = buildSquad().filter(Boolean);
  if (!sq.length) return 0;
  return Math.round(sq.reduce((s, p) => s + p.rating, 0) / sq.length);
}

function lineupComplete() { return G.lineup.every((id) => id && G.owned[id]); }

/** 空きスロットを所持選手から自動で埋める */
function autoLineup(force) {
  const fm = FORMATION_BY_ID[G.formation];
  if (force) G.lineup = fm.slots.map(() => null);
  while (G.lineup.length < fm.slots.length) G.lineup.push(null);
  G.lineup.length = fm.slots.length;
  const used = new Set(G.lineup.filter(Boolean));
  fm.slots.forEach((slot, i) => {
    if (G.lineup[i] && G.owned[G.lineup[i]]) return;
    let best = null, bestR = -1;
    Object.keys(G.owned).forEach((id) => {
      if (used.has(id)) return;
      const r = charRating(G.owned[id], CHAR_BY_ID[id], slot.role);
      if (r > bestR) { bestR = r; best = id; }
    });
    if (best) { G.lineup[i] = best; used.add(best); }
  });
}

/* ===================== サウンド ===================== */
const Sound = {
  ctx: null, master: null, bgmGain: null, bgmTimer: null, bgmTrack: null, bgmStep: 0,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = G.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.16;
    this.bgmGain.connect(this.master);
  },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) { G.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; },

  tone(freq, dur, type = 'sine', vol = 0.25, when = 0, slideTo = null, dest = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  noise(dur, vol = 0.2, when = 0, filterFreq = 1800, q = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },

  sfx(name) {
    this.init();
    if (!this.ctx) return;
    switch (name) {
      case 'ui': this.tone(760, 0.07, 'triangle', 0.18); break;
      case 'back': this.tone(420, 0.09, 'triangle', 0.16); break;
      case 'kick': this.noise(0.09, 0.3, 0, 900, 0.8); this.tone(180, 0.09, 'square', 0.12, 0, 90); break;
      case 'pass': this.noise(0.06, 0.18, 0, 1400, 1); break;
      case 'shoot': this.noise(0.13, 0.36, 0, 700, 0.7); this.tone(150, 0.14, 'sawtooth', 0.14, 0, 70); break;
      case 'tackle': this.noise(0.14, 0.3, 0, 380, 0.6); break;
      case 'post': this.tone(1200, 0.28, 'sine', 0.24, 0, 700); break;
      case 'save': this.noise(0.12, 0.24, 0, 600, 0.9); this.tone(300, 0.1, 'triangle', 0.12); break;
      case 'whistle':
        this.tone(2050, 0.16, 'square', 0.10); this.tone(2380, 0.16, 'square', 0.08, 0.02);
        this.tone(2050, 0.22, 'square', 0.10, 0.22); break;
      case 'goal':
        [0, 0.09, 0.18, 0.30].forEach((d, i) => this.tone([523, 659, 784, 1047][i], 0.5, 'square', 0.16, d));
        this.noise(1.2, 0.10, 0, 900, 0.5);
        break;
      case 'crowd': this.noise(1.6, 0.13, 0, 700, 0.4); break;
      case 'hissatsu':
        this.tone(120, 0.7, 'sawtooth', 0.2, 0, 900);
        this.noise(0.7, 0.2, 0, 1600, 0.6);
        break;
      case 'clash':
        this.tone(90, 0.6, 'square', 0.22, 0, 40); this.noise(0.5, 0.3, 0, 500, 0.5); break;
      case 'gachaRoll':
        for (let i = 0; i < 10; i++) this.tone(420 + i * 40, 0.07, 'triangle', 0.09, i * 0.07);
        break;
      case 'rare3': this.tone(660, 0.18, 'triangle', 0.2); break;
      case 'rare4': [0, 0.1, 0.2].forEach((d, i) => this.tone([700, 880, 1100][i], 0.25, 'triangle', 0.2, d)); break;
      case 'rare5':
        [0, 0.1, 0.2, 0.32, 0.46].forEach((d, i) => this.tone([784, 988, 1175, 1568, 2093][i], 0.5, 'square', 0.18, d));
        this.noise(1.0, 0.14, 0, 2400, 0.4);
        break;
      case 'levelup': [0, 0.08, 0.16].forEach((d, i) => this.tone([523, 784, 1047][i], 0.3, 'triangle', 0.2, d)); break;
      case 'coin': this.tone(1180, 0.09, 'square', 0.16); this.tone(1560, 0.14, 'square', 0.14, 0.07); break;
      case 'door': this.tone(300, 0.14, 'sine', 0.18, 0, 520); break;
      case 'error': this.tone(220, 0.16, 'square', 0.14, 0, 140); break;
    }
  },

  /* ---- 簡易BGM ---- */
  TRACKS: {
    garden: {
      bpm: 96, wave: 'triangle', bass: 'sine', drums: false,
      chords: [[0, 4, 7], [-3, 0, 4], [-5, -1, 2], [-1, 2, 7]],
      root: 220, arp: [0, 1, 2, 1], vol: 0.13,
    },
    match: {
      bpm: 138, wave: 'square', bass: 'sawtooth', drums: true,
      chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -1, 2]],
      root: 196, arp: [0, 2, 1, 2], vol: 0.10,
    },
  },
  playBgm(name) {
    this.init();
    if (!this.ctx || this.bgmTrack === name) return;
    this.stopBgm();
    this.bgmTrack = name; this.bgmStep = 0;
    const tr = this.TRACKS[name];
    if (!tr) return;
    this.bgmGain.gain.value = tr.vol;
    const beat = 60 / tr.bpm / 2;
    const tick = () => {
      if (this.bgmTrack !== name) return;
      const step = this.bgmStep++;
      const bar = Math.floor(step / 8) % tr.chords.length;
      const ch = tr.chords[bar];
      const semi = ch[tr.arp[step % tr.arp.length] % ch.length];
      const f = tr.root * Math.pow(2, semi / 12) * 2;
      this.tone(f, beat * 1.6, tr.wave, 0.10, 0, null, this.bgmGain);
      if (step % 4 === 0) this.tone(tr.root * Math.pow(2, ch[0] / 12) / 2, beat * 3, tr.bass, 0.16, 0, null, this.bgmGain);
      if (tr.drums) {
        if (step % 4 === 0) this.tone(80, 0.12, 'sine', 0.28, 0, 45, this.bgmGain);
        if (step % 4 === 2) this.noise(0.06, 0.06, 0, 3200, 0.6);
      }
    };
    tick();
    this.bgmTimer = setInterval(tick, beat * 1000);
  },
  stopBgm() { if (this.bgmTimer) clearInterval(this.bgmTimer); this.bgmTimer = null; this.bgmTrack = null; },
};

/* ===================== 入力 ===================== */
const Input = {
  keys: new Set(),
  act: { a: false, b: false, c: false, d: false, e: false, sw: false },
  edge: {},
  stick: { active: false, id: null, x: 0, y: 0, ox: 0, oy: 0 },
  KEYMAP: {
    KeyJ: 'a', KeyK: 'b', KeyL: 'c', Space: 'd', KeyE: 'e', Enter: 'e',
    ShiftLeft: 'sw', ShiftRight: 'sw', KeyZ: 'a', KeyX: 'b', KeyC: 'c', KeyV: 'd',
  },
  init() {
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat) { if (this.KEYMAP[ev.code]) ev.preventDefault(); return; }
      this.keys.add(ev.code);
      const a = this.KEYMAP[ev.code];
      if (a) { this.act[a] = true; this.edge[a] = true; ev.preventDefault(); }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
      if (ev.code === 'Escape') this.edge.menu = true;
      Sound.resume();
    });
    window.addEventListener('keyup', (ev) => {
      this.keys.delete(ev.code);
      const a = this.KEYMAP[ev.code];
      if (a) this.act[a] = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); for (const k in this.act) this.act[k] = false; });
    this.initTouch();
  },
  initTouch() {
    const stick = $('stick');
    const knob = stick.querySelector('.knob');
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    const start = (ev) => {
      const t = ev.changedTouches ? ev.changedTouches[0] : ev;
      const r = stick.getBoundingClientRect();
      this.stick.active = true; this.stick.id = t.identifier != null ? t.identifier : 'mouse';
      this.stick.ox = r.left + r.width / 2; this.stick.oy = r.top + r.height / 2;
      move(ev);
    };
    const move = (ev) => {
      if (!this.stick.active) return;
      let t = ev;
      if (ev.changedTouches) {
        t = Array.from(ev.changedTouches).find((x) => x.identifier === this.stick.id);
        if (!t) return;
      }
      let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
      const max = 50, len = Math.hypot(dx, dy);
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      this.stick.x = dx / max; this.stick.y = dy / max;
      setKnob(dx, dy);
      ev.preventDefault();
    };
    const end = (ev) => {
      if (ev.changedTouches && !Array.from(ev.changedTouches).some((x) => x.identifier === this.stick.id)) return;
      this.stick.active = false; this.stick.x = 0; this.stick.y = 0; setKnob(0, 0);
    };
    stick.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    stick.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);

    const bind = (id, action) => {
      const el = $(id);
      const down = (ev) => { this.act[action] = true; this.edge[action] = true; Sound.resume(); ev.preventDefault(); };
      const up = () => { this.act[action] = false; };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
    };
    bind('t-a', 'a'); bind('t-b', 'b'); bind('t-c', 'c'); bind('t-d', 'd'); bind('t-e', 'e');
  },
  axis() {
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    if (this.stick.active && (Math.abs(this.stick.x) > 0.16 || Math.abs(this.stick.y) > 0.16)) {
      x = this.stick.x; y = this.stick.y;
    }
    return { x, y, len: Math.hypot(x, y) };
  },
  pressed(a) { return !!this.edge[a]; },
  endFrame() { this.edge = {}; },
};

/* ===================== 似顔絵（カード・一覧用） ===================== */
const HAIR = {
  spike(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r * 1.04, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    for (let i = -3; i <= 3; i++) {
      const a = -Math.PI / 2 + i * 0.32;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a - 0.14) * r, y + Math.sin(a - 0.14) * r);
      ctx.lineTo(x + Math.cos(a) * r * 1.62, y + Math.sin(a) * r * 1.62);
      ctx.lineTo(x + Math.cos(a + 0.14) * r, y + Math.sin(a + 0.14) * r);
      ctx.fill();
    }
  },
  short(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y - r * 0.08, r * 1.06, Math.PI * 0.98, Math.PI * 2.02); ctx.fill();
    ctx.fillRect(x - r * 1.06, y - r * 0.16, r * 2.12, r * 0.34);
  },
  long(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 1.1, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r * 1.1, y - r * 0.1); ctx.quadraticCurveTo(x - r * 1.35, y + r * 1.5, x - r * 0.7, y + r * 1.7);
    ctx.lineTo(x - r * 0.55, y); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + r * 1.1, y - r * 0.1); ctx.quadraticCurveTo(x + r * 1.35, y + r * 1.5, x + r * 0.7, y + r * 1.7);
    ctx.lineTo(x + r * 0.55, y); ctx.fill();
  },
  bun(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y - r * 1.05, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - r * 0.02, r * 1.06, Math.PI, Math.PI * 2); ctx.fill();
  },
  mohawk(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r * 1.02, Math.PI * 1.12, Math.PI * 1.88); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.3, y - r * 0.85); ctx.lineTo(x, y - r * 1.85); ctx.lineTo(x + r * 0.3, y - r * 0.85);
    ctx.fill();
  },
  ponytail(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x + r * 0.95, y + r * 0.1, r * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.9, y); ctx.quadraticCurveTo(x + r * 1.7, y + r * 0.9, x + r * 1.15, y + r * 1.5);
    ctx.quadraticCurveTo(x + r * 1.1, y + r * 0.7, x + r * 0.7, y + r * 0.4); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 1.06, Math.PI, Math.PI * 2); ctx.fill();
  },
  curly(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 1.02 + (Math.PI * 0.96 / 8) * i;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, r * 0.38, 0, Math.PI * 2); ctx.fill();
    }
  },
  braid(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 1.08, Math.PI * 0.96, Math.PI * 2.04); ctx.fill();
    [-1, 1].forEach((s) => {
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x + s * r * (1.0 + i * 0.04), y + r * (0.25 + i * 0.4), r * (0.3 - i * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },
  cap(ctx, x, y, r, col, accColor) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r * 1.02, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accColor || '#333';
    ctx.beginPath(); ctx.arc(x, y - r * 0.12, r * 1.1, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + r * 0.9, y - r * 0.1, r * 0.75, r * 0.24, 0, 0, Math.PI * 2); ctx.fill();
  },
  bald(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y + r * 0.1, r * 1.0, Math.PI * 1.18, Math.PI * 1.82); ctx.fill();
  },
};

/**
 * 選手のバストアップを描く。カード・一覧・カットインで共用。
 * mode: 'card' | 'icon'
 */
function drawPortrait(ctx, char, w, h, opts) {
  opts = opts || {};
  const el = ELEMENTS[char.elem];
  const kit = opts.kit || '#e8edf5';
  const kit2 = opts.kit2 || shade(kit, -0.4);

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // 背景
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(el.color, -0.55));
  g.addColorStop(1, '#0a1220');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // 放射光
  ctx.save();
  ctx.globalAlpha = opts.plain ? 0.14 : 0.28;
  ctx.translate(w / 2, h * 0.46);
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI * 2 / 12);
    ctx.fillStyle = rgba(el.glow, 0.5);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w * 0.9, -w * 0.06); ctx.lineTo(w * 0.9, w * 0.06); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(4,8,14,.35)'; ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const headR = Math.min(w, h) * 0.19;
  const headY = h * 0.40;

  // 胴体（ユニフォーム）
  ctx.fillStyle = kit;
  ctx.beginPath();
  ctx.moveTo(cx - headR * 2.3, h + 4);
  ctx.lineTo(cx - headR * 1.7, headY + headR * 1.35);
  ctx.quadraticCurveTo(cx, headY + headR * 0.9, cx + headR * 1.7, headY + headR * 1.35);
  ctx.lineTo(cx + headR * 2.3, h + 4);
  ctx.closePath(); ctx.fill();
  // 襟
  ctx.fillStyle = kit2;
  ctx.beginPath();
  ctx.moveTo(cx - headR * 0.75, headY + headR * 1.05);
  ctx.lineTo(cx, headY + headR * 1.75);
  ctx.lineTo(cx + headR * 0.75, headY + headR * 1.05);
  ctx.closePath(); ctx.fill();
  // 背番号
  ctx.fillStyle = rgba(kit2, 0.85);
  ctx.font = `900 ${headR * 0.95}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(char.no), cx + headR * 1.35, h - headR * 0.75);

  // 首
  ctx.fillStyle = shade(char.look.skin, -0.18);
  ctx.fillRect(cx - headR * 0.34, headY + headR * 0.55, headR * 0.68, headR * 0.8);

  // 顔
  ctx.fillStyle = char.look.skin;
  ctx.beginPath(); ctx.ellipse(cx, headY, headR * 0.88, headR, 0, 0, Math.PI * 2); ctx.fill();
  // 耳
  ctx.beginPath(); ctx.ellipse(cx - headR * 0.88, headY + headR * 0.1, headR * 0.16, headR * 0.24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + headR * 0.88, headY + headR * 0.1, headR * 0.16, headR * 0.24, 0, 0, Math.PI * 2); ctx.fill();

  // 目
  const eyeY = headY + headR * 0.08;
  ctx.fillStyle = '#fff';
  [-1, 1].forEach((s) => {
    ctx.beginPath(); ctx.ellipse(cx + s * headR * 0.36, eyeY, headR * 0.2, headR * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#1b2434';
  [-1, 1].forEach((s) => {
    ctx.beginPath(); ctx.ellipse(cx + s * headR * 0.36, eyeY + headR * 0.01, headR * 0.1, headR * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  });
  // 眉
  ctx.strokeStyle = shade(char.look.hair, -0.25); ctx.lineWidth = Math.max(1.4, headR * 0.09); ctx.lineCap = 'round';
  [-1, 1].forEach((s) => {
    ctx.beginPath();
    ctx.moveTo(cx + s * headR * 0.16, headY - headR * 0.26);
    ctx.lineTo(cx + s * headR * 0.56, headY - headR * 0.18);
    ctx.stroke();
  });
  // 口
  ctx.strokeStyle = shade(char.look.skin, -0.5); ctx.lineWidth = Math.max(1.2, headR * 0.07);
  ctx.beginPath(); ctx.moveTo(cx - headR * 0.16, headY + headR * 0.52);
  ctx.quadraticCurveTo(cx, headY + headR * 0.62, cx + headR * 0.16, headY + headR * 0.52);
  ctx.stroke();

  // 髪
  const fn = HAIR[char.look.style] || HAIR.short;
  fn(ctx, cx, headY - headR * 0.18, headR, char.look.hair, char.look.accColor);

  // アクセサリ
  if (char.look.acc === 'band') {
    ctx.fillStyle = char.look.accColor;
    ctx.fillRect(cx - headR * 0.95, headY - headR * 0.62, headR * 1.9, headR * 0.26);
  } else if (char.look.acc === 'glasses') {
    ctx.strokeStyle = 'rgba(240,250,255,.85)'; ctx.lineWidth = Math.max(1.2, headR * 0.07);
    [-1, 1].forEach((s) => { ctx.beginPath(); ctx.arc(cx + s * headR * 0.36, eyeY, headR * 0.26, 0, Math.PI * 2); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(cx - headR * 0.1, eyeY); ctx.lineTo(cx + headR * 0.1, eyeY); ctx.stroke();
  } else if (char.look.acc === 'scar') {
    ctx.strokeStyle = rgba(char.look.accColor, 0.9); ctx.lineWidth = Math.max(1.2, headR * 0.08);
    ctx.beginPath(); ctx.moveTo(cx + headR * 0.5, headY - headR * 0.4); ctx.lineTo(cx + headR * 0.28, headY + headR * 0.16); ctx.stroke();
  }

  // 属性マーク
  if (!opts.plain) {
    ctx.font = `${Math.max(11, w * 0.11)}px system-ui`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.globalAlpha = 0.95;
    ctx.fillText(el.icon, w - 5, h - 4);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function portraitCanvas(char, w, h, opts) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = '100%'; cv.style.height = '100%';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  drawPortrait(ctx, char, w, h, opts);
  return cv;
}

/* ===================== UI ヘルパー ===================== */
const UI = {
  openPanels: [],
  show(id) {
    const el = $(id);
    if (!el || !el.classList.contains('hidden')) return;
    el.classList.remove('hidden');
    this.openPanels.push(id);
    Sound.sfx('ui');
  },
  hide(id) {
    const el = $(id);
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    this.openPanels = this.openPanels.filter((p) => p !== id);
    Sound.sfx('back');
  },
  isOpen(id) { return !$(id).classList.contains('hidden'); },
  anyOpen() { return this.openPanels.length > 0; },
  hideTop() { if (this.openPanels.length) this.hide(this.openPanels[this.openPanels.length - 1]); },
  /** 画面を切り替えるときに、開きっぱなしのパネルを全部閉じる */
  hideAll() {
    this.openPanels.slice().forEach((id) => $(id).classList.add('hidden'));
    this.openPanels = [];
  },
  toast(msg, kind) {
    const area = $('toast-area');
    const d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    area.appendChild(d);
    setTimeout(() => d.remove(), 2700);
  },
  confirm(text, onYes) {
    $('confirm-text').textContent = text;
    this.show('panel-confirm');
    const yes = $('confirm-yes'), no = $('confirm-no');
    const close = () => { this.hide('panel-confirm'); yes.onclick = null; no.onclick = null; };
    yes.onclick = () => { close(); onYes(); };
    no.onclick = close;
  },
  wipe(cb) {
    const w = $('wipe');
    w.classList.add('on');
    setTimeout(() => { cb(); setTimeout(() => w.classList.remove('on'), 40); }, 290);
  },
};

function updateWallet() {
  const t = $('ticket-count');
  if (t && t.textContent !== String(G.tickets)) {
    t.textContent = G.tickets;
    const chip = $('wallet-ticket');
    chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
  }
  const s = $('squad-count');
  if (s) s.textContent = Object.keys(G.owned).length;
  const gt = $('gacha-tickets'); if (gt) gt.textContent = G.tickets;
  const st = $('stage-tickets'); if (st) st.textContent = G.tickets;
}
