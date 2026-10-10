/* =========================================================================
   マルの伝説 ― コア
   小物・セーブ・入力（キーボード＋タッチ）・効果音とBGM（すべて合成音）
   ========================================================================= */

/* ===================== 小物 ===================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** 秒を 0:00:00 形式にする。 */
function fmtTime(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ===================== セーブデータ ===================== */
const SAVE_KEY = 'maru-legend-v1';
const PREF_KEY = 'maru-legend-prefs';

const Save = {
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const d = raw ? JSON.parse(raw) : null;
      return d && d.flags ? d : null;
    } catch (e) { return null; }
  },
  write(data) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* 保存できなくても遊べる */ }
  },
  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 何もしない */ }
  },
  prefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
  },
  setPrefs(p) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* 何もしない */ }
  },
};

/* ===================== 入力 ===================== */
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', KeyJ: 'a', Space: 'a',
  KeyX: 'b', KeyK: 'b',
  KeyC: 'swap', KeyL: 'swap',
  Enter: 'menu', Escape: 'menu', KeyP: 'menu',
  KeyM: 'mute',
};

const Input = {
  down: {},        // キーボードで押しているもの
  touch: {},       // タッチボタンで押しているもの
  stick: { x: 0, y: 0 },
  prev: {},
  isTouch: false,
  onKey: null,     // メニューや消音など、ゲーム外の操作を main に知らせる

  init() {
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.down[a] = true;
      Sound.unlock();
      if (this.onKey && (a === 'menu' || a === 'mute')) this.onKey(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.down[a] = false;
    });
    window.addEventListener('blur', () => { this.down = {}; this.touch = {}; });

    this.initTouch();
  },

  initTouch() {
    const pad = $('stick');
    const knob = $('stick-knob');
    let padId = null;
    const R = 46;

    const move = (t) => {
      const r = pad.getBoundingClientRect();
      const dx = t.clientX - (r.left + r.width / 2);
      const dy = t.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, m / R);
      this.stick.x = (dx / m) * k;
      this.stick.y = (dy / m) * k;
      knob.style.transform = `translate(${(dx / m) * k * R}px, ${(dy / m) * k * R}px)`;
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
      for (const t of e.changedTouches) {
        if (t.identifier !== padId) continue;
        padId = null;
        this.stick.x = 0;
        this.stick.y = 0;
        knob.style.transform = '';
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    $$('.tb').forEach((b) => {
      const act = b.dataset.act;
      const on = (e) => {
        e.preventDefault();
        this.touch[act] = true;
        b.classList.add('on');
        Sound.unlock();
        if (this.onKey && act === 'menu') this.onKey(act);
      };
      const off = (e) => { e.preventDefault(); this.touch[act] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    });
  },

  /** 進む向き。キーなら8方向、スティックならなめらかに。長さは1以下。 */
  axis() {
    let x = (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
    let y = (this.down.down ? 1 : 0) - (this.down.up ? 1 : 0);
    if (!x && !y && Math.hypot(this.stick.x, this.stick.y) > 0.25) { x = this.stick.x; y = this.stick.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  },

  held(a) { return !!this.down[a] || !!this.touch[a]; },
  pressed(a) { return this.held(a) && !this.prev[a]; },
  released(a) { return !this.held(a) && !!this.prev[a]; },

  /** 1フレームの終わりに押下状態を記録する（pressed / released の判定用）。 */
  endFrame() {
    this.prev = {};
    ['up', 'down', 'left', 'right', 'a', 'b', 'swap'].forEach((a) => { this.prev[a] = this.held(a); });
  },

  /** 画面切りかえ直後に、押しっぱなしのボタンが誤って効かないようにする。 */
  swallow() {
    ['a', 'b', 'swap'].forEach((a) => { this.prev[a] = true; });
  },
};

/* ===================== 音（Web Audio で合成する。音源ファイルは使わない） ===================== */
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteFreq(name) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) return 0;
  const n = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + n;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 'C5:1 r:.5 E5:2' のような楽譜を [{f, d}] にする（d は拍）。 */
function parseSeq(str) {
  return str.split(/\s+/).filter((s) => s && s !== '|').map((tok) => {
    const [n, d] = tok.split(':');
    return { f: n === 'r' ? 0 : noteFreq(n), d: parseFloat(d) };
  });
}

/* BGM はすべてこのゲームのために作った短いループ */
const SONGS = {
  field: {
    bpm: 132, leadType: 'square', bassType: 'triangle', leadVol: 0.06, bassVol: 0.11,
    lead: 'C5:1 E5:1 G5:2 A5:1 G5:1 E5:2 | F5:1 A5:1 C6:2 B5:1 A5:1 G5:2 | E5:1 G5:1 C6:1.5 B5:.5 A5:1 G5:1 F5:1 E5:1 | D5:1 E5:1 F5:1 D5:1 C5:4 | ' +
          'A4:1 C5:1 F5:2 E5:1 D5:1 C5:2 | G4:1 B4:1 D5:2 F5:1 E5:1 D5:2 | C5:1 E5:1 A5:1.5 G5:.5 F5:1 E5:1 D5:1 E5:1 | F5:1 D5:1 B4:1 D5:1 C5:4',
    bass: 'C3:2 G3:2 C3:2 G3:2 | F3:2 C4:2 F3:2 C4:2 | C3:2 G3:2 F3:2 C3:2 | G2:2 G3:2 C3:4 | ' +
          'F2:2 C3:2 F2:2 C3:2 | G2:2 D3:2 G2:2 D3:2 | A2:2 E3:2 F2:2 C3:2 | G2:2 G3:2 C3:4',
  },
  dungeon: {
    bpm: 112, leadType: 'square', bassType: 'triangle', leadVol: 0.05, bassVol: 0.12,
    lead: 'A4:1 r:1 C5:1 r:1 E5:1 D5:1 C5:1 B4:1 | A4:1 r:1 C5:1 r:1 F5:2 E5:2 | D5:1 r:1 F5:1 r:1 A5:1 G5:1 F5:1 E5:1 | D#5:2 E5:2 B4:4',
    bass: 'A2:2 E3:2 A2:2 E3:2 | F2:2 C3:2 F2:2 C3:2 | D3:2 A3:2 D3:2 A3:2 | E3:2 B2:2 E3:2 E2:2',
  },
  castle: {
    bpm: 96, leadType: 'sawtooth', bassType: 'triangle', leadVol: 0.035, bassVol: 0.13,
    lead: 'E4:2 F4:1 E4:1 B4:2 A4:2 | G4:2 F4:1 E4:1 F4:4 | E4:2 F4:1 E4:1 C5:2 B4:2 | A4:1 G4:1 F4:1 G4:1 E4:4',
    bass: 'E2:4 E2:4 | D2:4 D2:4 | C2:4 C2:4 | B1:4 E2:4',
  },
  boss: {
    bpm: 168, leadType: 'square', bassType: 'triangle', leadVol: 0.05, bassVol: 0.12,
    lead: 'E5:.5 G5:.5 B5:.5 G5:.5 A5:.5 G5:.5 F#5:.5 G5:.5 | E5:.5 G5:.5 B5:.5 G5:.5 C6:1 B5:1 | D5:.5 F#5:.5 A5:.5 F#5:.5 G5:.5 F#5:.5 E5:.5 F#5:.5 | D#5:1 F#5:1 B5:2',
    bass: 'E2:.5 E3:.5 E2:.5 E3:.5 E2:.5 E3:.5 E2:.5 E3:.5 | C2:.5 C3:.5 C2:.5 C3:.5 C2:.5 C3:.5 C2:.5 C3:.5 | D2:.5 D3:.5 D2:.5 D3:.5 D2:.5 D3:.5 D2:.5 D3:.5 | B1:.5 B2:.5 B1:.5 B2:.5 B1:.5 B2:.5 B1:.5 B2:.5',
  },
  ending: {
    bpm: 92, leadType: 'triangle', bassType: 'triangle', leadVol: 0.14, bassVol: 0.1,
    lead: 'C5:1 E5:1 G5:2 A5:1 G5:1 E5:2 | F5:1 A5:1 C6:2 B5:1 A5:1 G5:2 | E5:1 G5:1 C6:1.5 B5:.5 A5:1 G5:1 F5:1 E5:1 | D5:1 E5:1 F5:1 D5:1 C5:4',
    bass: 'C3:4 G2:4 | F2:4 G2:4 | A2:4 F2:4 | G2:4 C3:4',
  },
};
Object.values(SONGS).forEach((s) => { s.leadSeq = parseSeq(s.lead); s.bassSeq = parseSeq(s.bass); });

const Sound = {
  ctx: null,
  master: null,
  sfx: null,
  music: null,
  muted: false,
  song: null,
  songName: null,
  timer: null,

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.8;
    this.music.connect(this.master);
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.songName) { const n = this.songName; this.songName = null; this.bgm(n); }
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  },

  /** 単音。slide があれば終わりの周波数へすべらせる。 */
  tone(f, dur, type = 'square', vol = 0.15, slide = 0, delay = 0, out = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.2, freq = 1200, type = 'lowpass', delay = 0, sweep = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  },

  /** 音の並び（周波数・長さ）を順に鳴らす。 */
  arp(freqs, step, type = 'square', vol = 0.12, last = 0) {
    freqs.forEach((f, i) => {
      const d = (i === freqs.length - 1 && last) ? last : step * 1.1;
      this.tone(f, d, type, vol, 0, i * step);
    });
  },

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'swing': this.noise(0.12, 0.18, 2400, 'bandpass', 0, 600); break;
      case 'spin': this.noise(0.35, 0.22, 3000, 'bandpass', 0, 400); this.tone(500, 0.3, 'triangle', 0.08, 1200); break;
      case 'charged': this.tone(1320, 0.08, 'square', 0.06); this.tone(1760, 0.1, 'square', 0.06, 0, 0.06); break;
      case 'beam': this.tone(1400, 0.18, 'square', 0.06, 500); break;
      case 'hit': this.tone(260, 0.08, 'square', 0.14, 120); this.noise(0.06, 0.15, 1800); break;
      case 'kill': this.tone(600, 0.16, 'square', 0.1, 120); this.noise(0.18, 0.12, 900, 'lowpass', 0.02); break;
      case 'clink': this.tone(1900, 0.06, 'square', 0.08); this.tone(2600, 0.08, 'triangle', 0.08, 0, 0.03); break;
      case 'hurt': this.tone(180, 0.22, 'sawtooth', 0.14, 70); break;
      case 'gem': this.tone(1568, 0.06, 'square', 0.07); this.tone(2093, 0.1, 'square', 0.07, 0, 0.05); break;
      case 'heart': this.arp([880, 1109, 1319], 0.05, 'triangle', 0.14); break;
      case 'key': this.arp([1047, 1319, 1568, 2093], 0.05, 'square', 0.06); break;
      case 'secret': this.arp([659, 784, 988, 1319, 1175, 1568], 0.09, 'square', 0.07, 0.4); break;
      case 'fanfare': this.arp([523, 659, 784, 1047], 0.11, 'square', 0.08, 0.5); this.arp([262, 330, 392, 523], 0.11, 'triangle', 0.12, 0.5); break;
      case 'unlock': this.tone(400, 0.06, 'square', 0.1); this.tone(300, 0.12, 'square', 0.1, 0, 0.07); this.noise(0.15, 0.1, 600, 'lowpass', 0.05); break;
      case 'door': this.noise(0.3, 0.14, 300, 'lowpass'); this.tone(90, 0.3, 'triangle', 0.15, 60); break;
      case 'bomb': this.tone(320, 0.06, 'square', 0.08); break;
      case 'boom': this.noise(0.7, 0.45, 900, 'lowpass', 0, 80); this.tone(80, 0.5, 'sine', 0.3, 30); break;
      case 'boomer': this.tone(700, 0.08, 'triangle', 0.05, 900); break;
      case 'text': this.tone(900, 0.025, 'square', 0.03); break;
      case 'push': this.noise(0.25, 0.12, 400, 'lowpass'); break;
      case 'cut': this.noise(0.12, 0.15, 3000, 'highpass'); break;
      case 'switch': this.tone(1200, 0.08, 'square', 0.08); this.tone(1600, 0.16, 'triangle', 0.1, 0, 0.06); break;
      case 'rock': this.tone(500, 0.05, 'square', 0.05, 300); break;
      case 'stairs': this.arp([523, 466, 415, 392, 349], 0.05, 'triangle', 0.1); break;
      case 'buy': this.arp([784, 1047, 1319], 0.06, 'square', 0.07); break;
      case 'error': this.tone(220, 0.12, 'square', 0.08); this.tone(180, 0.18, 'square', 0.08, 0, 0.1); break;
      case 'heal': this.arp([523, 659, 784, 1047, 1319, 1568], 0.06, 'triangle', 0.12); break;
      case 'land': this.noise(0.4, 0.35, 400, 'lowpass', 0, 60); this.tone(70, 0.3, 'sine', 0.25, 40); break;
      case 'bosshit': this.tone(300, 0.15, 'sawtooth', 0.14, 90); this.noise(0.12, 0.16, 1200); break;
      case 'bossdie': this.noise(1.6, 0.4, 1200, 'lowpass', 0, 60); this.arp([392, 330, 262, 196, 131], 0.16, 'sawtooth', 0.08); break;
      case 'gulp': this.tone(200, 0.25, 'triangle', 0.18, 90); break;
      case 'warp': this.tone(300, 0.4, 'triangle', 0.1, 900); break;
      case 'die': this.arp([523, 494, 466, 440, 415, 392, 370, 349], 0.09, 'square', 0.08, 0.4); break;
      case 'low': this.tone(1760, 0.05, 'square', 0.035); break;
      default: break;
    }
  },

  /** BGM を切りかえる。同じ曲なら何もしない。null で止める。 */
  bgm(name) {
    if (name === this.songName) return;
    this.songName = name;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.musicBus) {
      const old = this.musicBus;
      old.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      setTimeout(() => old.disconnect(), 400);
      this.musicBus = null;
    }
    if (!name || !this.ctx) return;
    const def = SONGS[name];
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.music);
    const start = this.ctx.currentTime + 0.08;
    this.song = {
      def,
      tracks: [
        { seq: def.leadSeq, i: 0, t: start, type: def.leadType, vol: def.leadVol },
        { seq: def.bassSeq, i: 0, t: start, type: def.bassType, vol: def.bassVol },
      ],
    };
    const tick = () => this.schedule();
    tick();
    this.timer = setInterval(tick, 50);
  },

  schedule() {
    if (!this.song || !this.ctx) return;
    const beat = 60 / this.song.def.bpm;
    const horizon = this.ctx.currentTime + 0.25;
    for (const tr of this.song.tracks) {
      // タブが裏にあって時間が飛んだら、追いつかせずに今から鳴らしなおす
      if (tr.t < this.ctx.currentTime - 0.5) tr.t = this.ctx.currentTime + 0.05;
      while (tr.t < horizon) {
        const n = tr.seq[tr.i];
        const dur = n.d * beat;
        if (n.f) {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = tr.type;
          o.frequency.setValueAtTime(n.f, tr.t);
          g.gain.setValueAtTime(0.0001, tr.t);
          g.gain.exponentialRampToValueAtTime(tr.vol, tr.t + 0.01);
          g.gain.setValueAtTime(tr.vol, tr.t + dur * 0.7);
          g.gain.exponentialRampToValueAtTime(0.0001, tr.t + dur * 0.95);
          o.connect(g);
          g.connect(this.musicBus);
          o.start(tr.t);
          o.stop(tr.t + dur);
        }
        tr.t += dur;
        tr.i = (tr.i + 1) % tr.seq.length;
      }
    }
  },
};
