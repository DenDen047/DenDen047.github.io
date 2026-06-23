// =============================================================
// Mini Smash Bros — character select + 4 chars + 4 way attacks
// =============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- ステージ定数 ---
const STAGE_W = 800;
const STAGE_H = 600;
const GRAVITY = 0.6;

// --- ステージ定義 ---
// 各ステージは複数のプラットフォーム + 背景色 + 専用 BGM を持つ。
// melody/bass は MIDI ノート (null = 休符)。bpm はループの速度。
const STAGES = [
  {
    id: 'plain', name: '草原',
    bg: { sky: '#5a8a5a', platTop: '#3a5a3a', platShadow: '#1a2a1a' },
    platforms: [
      { x: 150, y: 460, w: 500, h: 20 },
    ],
    bgm: {
      bpm: 130,
      melody: [60, null, 64, null, 67, null, 64, null, 65, null, 64, null, 60, null, null, null,
               60, null, 64, null, 67, null, 72, null, 71, null, 67, null, 64, null, null, null],
      bass:   [36, 36, 43, 43, 41, 41, 36, 36, 38, 38, 43, 43, 41, 41, 36, 36],
    },
  },
  {
    id: 'sky', name: '空中庭園',
    bg: { sky: '#a0c8e0', platTop: '#5a7090', platShadow: '#2a3a50' },
    platforms: [
      { x: 200, y: 490, w: 400, h: 18 },
      { x: 80,  y: 360, w: 130, h: 14 },
      { x: 590, y: 360, w: 130, h: 14 },
      { x: 330, y: 230, w: 140, h: 14 },
    ],
    bgm: {
      bpm: 110,
      melody: [76, 79, 81, 84, 81, 79, 76, null, 74, 77, 81, 84, 81, 77, 74, null,
               72, 76, 79, 84, 79, 76, 72, null, 76, 79, 81, 84, 81, 79, 76, null],
      bass:   [48, null, 48, null, 50, null, 50, null, 47, null, 47, null, 48, null, 48, null],
    },
  },
  {
    id: 'lava', name: '溶岩洞窟',
    bg: { sky: '#3a1010', platTop: '#aa4020', platShadow: '#5a1010' },
    platforms: [
      { x: 60,  y: 470, w: 260, h: 20 },
      { x: 480, y: 470, w: 260, h: 20 },
      { x: 350, y: 350, w: 100, h: 14 },
    ],
    bgm: {
      bpm: 140,
      melody: [60, null, 60, 63, 65, null, 60, 63, 67, null, 67, 65, 63, null, 60, null,
               60, null, 60, 63, 65, null, 67, 70, 72, null, 70, 67, 63, null, 60, null],
      bass:   [36, 36, null, 36, 39, 39, null, 39, 41, 41, null, 41, 36, 36, 36, 36],
      melodyType: 'sawtooth',
    },
  },
  {
    id: 'ice', name: '氷の城',
    bg: { sky: '#c0e0ec', platTop: '#80a8c8', platShadow: '#3a5a78' },
    platforms: [
      { x: 150, y: 500, w: 500, h: 18 },
      { x: 80,  y: 380, w: 140, h: 14 },
      { x: 580, y: 380, w: 140, h: 14 },
    ],
    bgm: {
      bpm: 95,
      melody: [72, null, null, 76, null, null, 79, null, 84, null, null, 79, null, 76, null, null,
               72, null, null, 75, null, null, 79, null, 82, null, null, 79, null, 75, null, null],
      bass:   [48, null, null, null, 50, null, null, null, 47, null, null, null, 48, null, null, null],
    },
  },
  {
    id: 'temple', name: '古代神殿',
    bg: { sky: '#5a4030', platTop: '#a08050', platShadow: '#503020' },
    platforms: [
      { x: 100, y: 510, w: 600, h: 18 },
      { x: 220, y: 410, w: 360, h: 14 },
      { x: 320, y: 310, w: 160, h: 14 },
    ],
    bgm: {
      bpm: 100,
      melody: [62, null, 65, null, 67, null, 65, 62, 60, null, 62, null, 65, null, null, null,
               67, null, 70, null, 67, null, 65, 62, 60, null, 62, null, 65, null, null, null],
      bass:   [38, null, null, 38, 36, null, null, 36, 41, null, null, 41, 38, null, null, 38],
    },
  },
  // --- 動的ステージ ---
  {
    id: 'moving', name: '動く足場',
    dynamic: true,
    bg: { sky: '#1a1a3a', platTop: '#bbbbcc', platShadow: '#5a5a7a' },
    platforms: [
      { x: 250, y: 520, w: 300, h: 18 },
      { x: 60,  y: 380, w: 130, h: 14, motion: { type: 'horizontal', amp: 80, speed: 0.024, phase: 0 } },
      { x: 610, y: 380, w: 130, h: 14, motion: { type: 'horizontal', amp: 80, speed: 0.024, phase: Math.PI } },
      { x: 340, y: 250, w: 120, h: 14, motion: { type: 'vertical',   amp: 60, speed: 0.018, phase: 0 } },
    ],
    bgm: {
      bpm: 124,
      melody: [69, null, 72, null, 74, null, 72, 69, 67, null, 69, null, 72, null, null, null,
               74, null, 76, null, 79, null, 76, 74, 72, null, 69, null, 67, null, null, null],
      bass:   [45, null, 48, null, 50, null, 48, null, 43, null, 47, null, 48, null, 45, null],
    },
    update: applyPlatformMotion,
  },
  {
    id: 'crumble', name: '崩れる神殿',
    dynamic: true,
    bg: { sky: '#2a2030', platTop: '#a08070', platShadow: '#604030' },
    platforms: [
      { x: 280, y: 530, w: 240, h: 18 },                                           // 中央安全地帯
      { x: 80,  y: 420, w: 130, h: 14, crumble: { delay: 50, respawn: 160 } },
      { x: 590, y: 420, w: 130, h: 14, crumble: { delay: 50, respawn: 160 } },
      { x: 220, y: 320, w: 130, h: 14, crumble: { delay: 40, respawn: 180 } },
      { x: 450, y: 320, w: 130, h: 14, crumble: { delay: 40, respawn: 180 } },
      { x: 340, y: 220, w: 120, h: 14, crumble: { delay: 30, respawn: 220 } },
    ],
    bgm: {
      bpm: 120,
      melody: [60, 63, 65, 63, 60, null, 63, 65, 67, null, 65, 63, 60, null, null, null,
               60, 63, 65, 67, 70, null, 67, 65, 63, null, 60, 58, 60, null, null, null],
      bass:   [36, 36, null, 38, 39, 39, null, 41, 36, 36, null, 38, 39, 39, null, null],
      melodyType: 'sawtooth',
    },
  },
  {
    id: 'volcano', name: '火山',
    dynamic: true,
    bg: { sky: '#4a1818', platTop: '#7a3020', platShadow: '#3a1010' },
    platforms: [
      { x: 80,  y: 510, w: 240, h: 18 },
      { x: 480, y: 510, w: 240, h: 18 },
      { x: 350, y: 380, w: 100, h: 14 },
    ],
    bgm: {
      bpm: 150,
      melody: [60, null, 60, 63, 65, null, 60, 63, 67, null, 67, 65, 63, null, 60, null,
               60, null, 60, 63, 65, null, 67, 70, 72, null, 70, 67, 65, 63, 60, null],
      bass:   [36, 36, 38, 38, 39, 39, 41, 41, 36, 36, 38, 38, 39, 39, 36, 36],
      melodyType: 'sawtooth',
    },
    update: spawnLavaBubbles,
  },
];
// 各プラットフォームの original 値を保持 (resetStage 用)
for (const stage of STAGES) {
  for (const plat of stage.platforms) {
    plat._origX = plat.x;
    plat._origY = plat.y;
  }
}
let currentStage = STAGES[0];
let stageFrame = 0;

// 動く足場: sin波で位置を周期的に動かし、deltaX/deltaY を Player.collision で参照
function applyPlatformMotion(stage, frame) {
  for (const plat of stage.platforms) {
    if (!plat.motion) continue;
    if (plat._baseX === undefined) {
      plat._baseX = plat._origX;
      plat._baseY = plat._origY;
    }
    const m = plat.motion;
    const prevX = plat.x, prevY = plat.y;
    if (m.type === 'horizontal') {
      plat.x = plat._baseX + Math.sin(frame * m.speed + m.phase) * m.amp;
    } else if (m.type === 'vertical') {
      plat.y = plat._baseY + Math.sin(frame * m.speed + m.phase) * m.amp;
    }
    plat.deltaX = plat.x - prevX;
    plat.deltaY = plat.y - prevY;
  }
}

// 火山: 一定間隔で下から溶岩弾が吹き上がる
function spawnLavaBubbles(stage, frame) {
  if (frame > 60 && frame % 110 === 0) {
    const x = 80 + Math.random() * (STAGE_W - 160);
    hazards.push(new Hazard({
      x, y: STAGE_H + 30,
      vx: (Math.random() - 0.5) * 3,
      vy: -13 - Math.random() * 3,
      type: 'lava', damage: 14, life: 240, gravity: 0.28,
    }));
    // 噴出位置の警告フラッシュ
    addParticle({
      x: x + 12, y: STAGE_H - 10,
      vx: 0, vy: 0, life: 18, maxLife: 18,
      size: 36, color: '#ff4020', shape: 'flash', gravity: 0,
    });
    sfx.fireball();
  }
}

// ステージリセット: 動的状態をすべて初期化
function resetStage(stage) {
  for (const plat of stage.platforms) {
    plat.x = plat._origX;
    plat.y = plat._origY;
    plat._state = 'solid';
    plat._timer = 0;
    plat.deltaX = 0;
    plat.deltaY = 0;
  }
}

// 崩れる足場の状態機械: cracking → gone → solid を毎フレーム進める
function tickPlatformStates(stage) {
  for (const plat of stage.platforms) {
    if (!plat.crumble || !plat._state || plat._state === 'solid') continue;
    plat._timer--;
    if (plat._timer > 0) continue;
    if (plat._state === 'cracking') {
      plat._state = 'gone';
      plat._timer = plat.crumble.respawn;
      // 崩壊の破片
      for (let i = 0; i < 14; i++) {
        addParticle({
          x: plat.x + Math.random() * plat.w,
          y: plat.y + plat.h / 2,
          vx: (Math.random() - 0.5) * 5,
          vy: -2 + Math.random() * 2,
          life: 36, maxLife: 36,
          size: 4 + Math.random() * 3,
          color: stage.bg.platShadow,
          shape: 'rect', gravity: 0.32,
        });
      }
    } else if (plat._state === 'gone') {
      plat._state = 'solid';
      addParticle({
        x: plat.x + plat.w / 2, y: plat.y + plat.h / 2,
        vx: 0, vy: 0, life: 20, maxLife: 20,
        size: plat.w / 2, color: '#fff', shape: 'flash', gravity: 0,
      });
    }
  }
}
const FRICTION = 0.85;
const AIR_FRICTION = 0.96;
const MOVE_ACCEL = 0.9;

// ジャストガード・カウンター (全キャラ共通)
const COUNTER_WINDOW = 8;     // 防御開始から受付となるフレーム数
const COUNTER_MULT = 1.4;     // 受けた攻撃の何倍を反撃ダメージにするか
const COUNTER_MIN_DMG = 10;   // 反撃ダメージの最低値
const COUNTER_HITSTOP = 8;    // カウンター成功時の停止フレーム (演出)
let hitstop = 0;              // > 0 の間はゲーム進行を停止 (フリーズ演出)

// =============================================================
// 入力管理
// =============================================================
const keys = {};
let muted = false;
let gameState = 'select'; // 'select' | 'stage_select' | 'playing' | 'gameover'

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'r') { startSelect(); }
  if (k === 'm') {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.18;
  }
  resumeAudio();
  if (['arrowup','arrowdown','arrowleft','arrowright',' ','/'].includes(k)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// =============================================================
// 効果音 (Web Audio API)
// =============================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audio = null;
let masterGain = null;
function resumeAudio() {
  if (!audio) {
    audio = new AudioCtx();
    masterGain = audio.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(audio.destination);
  }
  if (audio.state === 'suspended') audio.resume();
}
function blip({ type='square', freq=440, freqEnd, duration=0.08, volume=1 }) {
  if (!audio) return;
  const t0 = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}
function noiseBurst({ duration=0.15, volume=1, lowpass=1200 }) {
  if (!audio) return;
  const t0 = audio.currentTime;
  const buf = audio.createBuffer(1, audio.sampleRate * duration, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = lowpass;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  src.connect(filter).connect(gain).connect(masterGain);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}
// =============================================================
// BGM (Web Audio で軽量にシーケンス再生)
// =============================================================
function noteToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
let bgmTimer = null;
let bgmStep = 0;
let currentBGM = null;
function startBGM(bgm) {
  stopBGM();
  if (!bgm) return;
  currentBGM = bgm;
  bgmStep = 0;
  const stepMs = 60000 / bgm.bpm / 2; // 8分音符
  bgmTimer = setInterval(() => {
    if (!audio || audio.state !== 'running' || !currentBGM) return;
    const m = currentBGM.melody;
    if (m && m.length) {
      const noteM = m[bgmStep % m.length];
      if (noteM != null) {
        blip({
          type: currentBGM.melodyType || 'square',
          freq: noteToFreq(noteM),
          duration: 0.18,
          volume: 0.08,
        });
      }
    }
    const b = currentBGM.bass;
    if (b && b.length) {
      const noteB = b[bgmStep % b.length];
      if (noteB != null) {
        blip({
          type: currentBGM.bassType || 'triangle',
          freq: noteToFreq(noteB),
          duration: 0.25,
          volume: 0.10,
        });
      }
    }
    bgmStep++;
  }, stepMs);
}
function stopBGM() {
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  currentBGM = null;
}

const sfx = {
  jump:        () => blip({ type: 'square', freq: 480, freqEnd: 820, duration: 0.09, volume: 0.5 }),
  weakHit:     () => { blip({ type: 'square', freq: 320, freqEnd: 120, duration: 0.08, volume: 0.6 });
                       noiseBurst({ duration: 0.06, volume: 0.4, lowpass: 1800 }); },
  strongHit:   () => { blip({ type: 'sawtooth', freq: 220, freqEnd: 70, duration: 0.18, volume: 0.7 });
                       noiseBurst({ duration: 0.18, volume: 0.7, lowpass: 900 }); },
  upHit:       () => blip({ type: 'square', freq: 660, freqEnd: 1320, duration: 0.12, volume: 0.55 }),
  downHit:     () => blip({ type: 'sawtooth', freq: 200, freqEnd: 60, duration: 0.18, volume: 0.6 }),
  swing:       () => blip({ type: 'triangle', freq: 800, freqEnd: 400, duration: 0.06, volume: 0.25 }),
  shieldHit:   () => blip({ type: 'square', freq: 1100, freqEnd: 700, duration: 0.08, volume: 0.4 }),
  counter:     () => { blip({ type: 'square', freq: 1700, freqEnd: 2500, duration: 0.05, volume: 0.5 });
                       blip({ type: 'triangle', freq: 880, freqEnd: 1760, duration: 0.14, volume: 0.4 }); },
  shieldBreak: () => { blip({ type: 'sawtooth', freq: 900, freqEnd: 80, duration: 0.4, volume: 0.6 });
                       noiseBurst({ duration: 0.4, volume: 0.6, lowpass: 2200 }); },
  ko:          () => { blip({ type: 'square', freq: 880, freqEnd: 110, duration: 0.5, volume: 0.7 });
                       noiseBurst({ duration: 0.4, volume: 0.5, lowpass: 1500 }); },
  cursor:      () => blip({ type: 'square', freq: 600, duration: 0.04, volume: 0.3 }),
  confirm:     () => { [600, 900].forEach((f,i) => setTimeout(() => blip({ type:'square', freq:f, duration:0.08, volume:0.4 }), i*60)); },
  win:         () => { [523, 659, 784, 1047].forEach((f, i) =>
                       setTimeout(() => blip({ type: 'square', freq: f, duration: 0.18, volume: 0.5 }), i * 130)); },
  shuriken:    () => blip({ type: 'triangle', freq: 1300, freqEnd: 1900, duration: 0.06, volume: 0.3 }),
  fireball:    () => { blip({ type: 'sawtooth', freq: 220, freqEnd: 90, duration: 0.28, volume: 0.5 });
                       noiseBurst({ duration: 0.25, volume: 0.4, lowpass: 700 }); },
  laser:       () => blip({ type: 'square', freq: 1400, freqEnd: 600, duration: 0.12, volume: 0.4 }),
};

// =============================================================
// ノックバック計算
// =============================================================
function calculateKnockback(damage, attackPower) {
  const magnitude = 4 + (damage / 12 + damage * attackPower / 60) * 1.3;
  const capped = Math.min(magnitude, 22);
  return { x: capped * 0.85, y: capped * 0.65 };
}

// =============================================================
// キャラクター描画 (Canvas プリミティブで合成)
// 各関数: draw(ctx, x, y, w, h, facing, tint)
// =============================================================
function drawKnight(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // 脚 (前後にスライド)
  ctx.fillStyle = '#7a8395';
  ctx.fillRect(x + 6 + legShift,    y + h - 8, 10, 8);
  ctx.fillRect(x + w - 16 - legShift, y + h - 8, 10, 8);
  // 鎧 (上下bob)
  ctx.fillStyle = '#bcc3d4';
  ctx.fillRect(x + 4, y + 18 + bob, w - 8, h - 26);
  // 胸当て (チームカラー)
  ctx.fillStyle = tint;
  ctx.fillRect(x + 8, y + 22 + bob, w - 16, 16);
  // 兜
  ctx.fillStyle = '#9aa3b5';
  ctx.fillRect(x + 8, y + 4 + bob, w - 16, 16);
  // バイザースリット
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(x + 10, y + 12 + bob, w - 20, 3);
  // 飾り羽
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(x + w/2 - 2, y - 6 + bob, 4, 8);
  // 剣 (持つ手は腕と一緒に振れる)
  ctx.fillStyle = '#dfe6f0';
  const sx = facing === 1 ? x + w + armShift : x - 4 - armShift;
  ctx.fillRect(sx, y + 30 + bob, 4, 18);
  ctx.fillStyle = '#daa520';
  ctx.fillRect(sx - 2, y + 28 + bob, 8, 3);
}
function drawNinja(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  const t = performance.now() / 100;
  const scarfWave = Math.sin(t) * 2 + (state.walking ? Math.sin(state.walking ? state.legShift * 2 : 0) * 2 : 0);
  // 脚 (色濃いめ・スライド)
  ctx.fillStyle = '#0f0f18';
  ctx.fillRect(x + 6 + legShift, y + h - 10, 10, 10);
  ctx.fillRect(x + w - 16 - legShift, y + h - 10, 10, 10);
  // 装束 (bob)
  ctx.fillStyle = '#1f1f2c';
  ctx.fillRect(x + 4, y + 4 + bob, w - 8, h - 14);
  // 鉢巻き
  ctx.fillStyle = tint;
  ctx.fillRect(x + 4, y + 10 + bob, w - 8, 4);
  // 帯
  ctx.fillStyle = tint;
  ctx.fillRect(x + 4, y + h - 22 + bob, w - 8, 4);
  // 目
  ctx.fillStyle = '#fff';
  const eyeX = facing === 1 ? x + w - 14 : x + 6;
  ctx.fillRect(eyeX, y + 18 + bob, 8, 3);
  // たなびくマフラー (歩行/常時に揺れる)
  ctx.fillStyle = tint;
  const scX = facing === 1 ? x - 8 : x + w;
  ctx.fillRect(scX, y + 16 + bob + scarfWave, 10, 4);
  ctx.fillRect(scX + (facing === 1 ? -4 : 4), y + 22 + bob + scarfWave * 0.6, 8, 3);
  // クナイ (腕と一緒に振れる)
  ctx.fillStyle = '#bbb';
  const kx = facing === 1 ? x + w + armShift : x - 6 - armShift;
  ctx.fillRect(kx, y + 32 + bob, 6, 3);
}
function drawRobot(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // メカ脚 (高さも変化させてピストン感)
  ctx.fillStyle = '#445566';
  const lH1 = 8 - Math.max(0, legShift);
  const lH2 = 8 + Math.min(0, legShift);
  ctx.fillRect(x + 4 + legShift, y + h - lH1, 12, lH1);
  ctx.fillRect(x + w - 16 - legShift, y + h - 8 + (legShift > 0 ? 0 : -legShift), 12, lH2 > 0 ? lH2 : 8);
  // 胴体
  ctx.fillStyle = '#7a93b2';
  ctx.fillRect(x + 4, y + 18 + bob, w - 8, h - 26);
  // チェストパネル
  ctx.fillStyle = tint;
  ctx.fillRect(x + 10, y + 24 + bob, w - 20, 14);
  // 頭
  ctx.fillStyle = '#a9b8cc';
  ctx.fillRect(x + 8, y + 4 + bob, w - 16, 16);
  // モノアイ (歩行中はスキャン)
  ctx.fillStyle = '#ff3b3b';
  const scan = state.walking ? Math.sin(performance.now() / 100) * 3 : 0;
  const eyeX = facing === 1 ? x + w - 14 + scan : x + 6 + scan;
  ctx.fillRect(eyeX, y + 10 + bob, 8, 5);
  // アンテナ (歩行で揺れる)
  ctx.fillStyle = '#bbb';
  ctx.fillRect(x + w/2 - 1 + armShift * 0.4, y - 4 + bob, 2, 6);
  ctx.fillStyle = '#ffd86b';
  ctx.fillRect(x + w/2 - 2 + armShift * 0.6, y - 8 + bob, 4, 4);
  // ボルト
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 6, y + 22 + bob, 2, 2);
  ctx.fillRect(x + w - 8, y + 22 + bob, 2, 2);
}
function drawWizard(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // ローブ (台形 — 歩行時に裾が左右に揺れる)
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.moveTo(x + 2 + legShift * 0.7, y + h);
  ctx.lineTo(x + w - 2 + legShift * 0.7, y + h);
  ctx.lineTo(x + w - 8, y + 22 + bob);
  ctx.lineTo(x + 8, y + 22 + bob);
  ctx.closePath();
  ctx.fill();
  // ローブの裾の縁取り (アクセント)
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(x + 2 + legShift * 0.7, y + h - 3, w - 4, 3);
  // 顔
  ctx.fillStyle = '#f5deb3';
  ctx.fillRect(x + 10, y + 14 + bob, w - 20, 10);
  // 髭 (bob時に揺れる)
  ctx.fillStyle = '#eeeeee';
  ctx.fillRect(x + 10, y + 22 + bob, w - 20, 8);
  ctx.fillRect(x + 12, y + 28 + bob, w - 24, 3);
  // 三角帽子 (歩行時に少し傾く)
  const hatTilt = state.walking ? Math.sin(state.legShift || 0) * 1.5 : 0;
  ctx.fillStyle = '#1a1a3a';
  ctx.beginPath();
  ctx.moveTo(x + w/2 + hatTilt * 2, y - 10 + bob);
  ctx.lineTo(x + 4, y + 14 + bob);
  ctx.lineTo(x + w - 4, y + 14 + bob);
  ctx.closePath();
  ctx.fill();
  // 帽子の星
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(x + w/2 - 2 + hatTilt, y + 2 + bob, 4, 4);
  // 目
  ctx.fillStyle = '#000';
  const eyeOffset = facing === 1 ? 2 : -2;
  ctx.fillRect(x + 14 + eyeOffset, y + 17 + bob, 3, 3);
  ctx.fillRect(x + w - 17 + eyeOffset, y + 17 + bob, 3, 3);
  // 杖 (腕の振りに同期)
  ctx.fillStyle = '#7a4a1e';
  const wx = facing === 1 ? x + w + armShift : x - 8 - armShift;
  ctx.fillRect(wx, y + 28 + bob, 8, 3);
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(wx + (facing === 1 ? 6 : -2), y + 24 + bob, 4, 4);
  ctx.fillRect(wx + (facing === 1 ? 4 : 0), y + 26 + bob, 8, 4);
}

function drawSumo(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  // 太い脚
  ctx.fillStyle = '#f5d0a0';
  ctx.fillRect(x + 2 + legShift,    y + h - 14, 14, 14);
  ctx.fillRect(x + w - 16 - legShift, y + h - 14, 14, 14);
  // まわし
  ctx.fillStyle = tint;
  ctx.fillRect(x + 2, y + h - 22, w - 4, 8);
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(x + 2, y + h - 16, w - 4, 2);
  // 巨体 (楕円)
  ctx.fillStyle = '#f5d0a0';
  ctx.beginPath();
  ctx.ellipse(x + w/2, y + h/2 + bob - 4, w/2, (h - 18)/2, 0, 0, Math.PI * 2);
  ctx.fill();
  // 頭
  ctx.fillRect(x + 10, y + 4 + bob, w - 20, 14);
  // 髷
  ctx.fillStyle = '#1a0a0a';
  ctx.fillRect(x + w/2 - 4, y + bob, 8, 6);
  ctx.fillRect(x + w/2 - 2, y - 4 + bob, 4, 6);
  // 鋭い目
  ctx.fillStyle = '#000';
  const eo = facing === 1 ? 1 : -1;
  ctx.fillRect(x + 14 + eo, y + 10 + bob, 3, 2);
  ctx.fillRect(x + w - 17 + eo, y + 10 + bob, 3, 2);
  // 口
  ctx.fillStyle = '#440';
  ctx.fillRect(x + 16, y + 15 + bob, w - 32, 2);
}

function drawPirate(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // 脚 (ブーツ)
  ctx.fillStyle = '#3a2a18';
  ctx.fillRect(x + 6 + legShift, y + h - 10, 10, 10);
  ctx.fillRect(x + w - 16 - legShift, y + h - 10, 10, 10);
  // シャツ
  ctx.fillStyle = '#dcdcd0';
  ctx.fillRect(x + 4, y + 22 + bob, w - 8, h - 32);
  // サッシュ (チームカラー)
  ctx.fillStyle = tint;
  ctx.fillRect(x + 4, y + 28 + bob, w - 8, 6);
  // バックル
  ctx.fillStyle = '#daa520';
  ctx.fillRect(x + w/2 - 3, y + 28 + bob, 6, 6);
  // 顔
  ctx.fillStyle = '#f5d0a0';
  ctx.fillRect(x + 10, y + 8 + bob, w - 20, 14);
  // ひげ
  ctx.fillStyle = '#1a0a0a';
  ctx.fillRect(x + 10, y + 18 + bob, w - 20, 4);
  // 目+眼帯
  ctx.fillStyle = '#000';
  if (facing === 1) {
    ctx.fillRect(x + w - 17, y + 13 + bob, 3, 3);
    ctx.fillRect(x + 12, y + 12 + bob, 7, 5);
  } else {
    ctx.fillRect(x + 14, y + 13 + bob, 3, 3);
    ctx.fillRect(x + w - 19, y + 12 + bob, 7, 5);
  }
  // 三角帽 (海賊)
  ctx.fillStyle = '#1a1a2a';
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 8 + bob);
  ctx.lineTo(x + w - 2, y + 8 + bob);
  ctx.lineTo(x + w - 8, y + 2 + bob);
  ctx.lineTo(x + w/2, y - 4 + bob);
  ctx.lineTo(x + 8, y + 2 + bob);
  ctx.closePath();
  ctx.fill();
  // どくろ
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + w/2 - 2, y + 2 + bob, 4, 4);
  // フリントロック銃
  const px = facing === 1 ? x + w + armShift : x - 12 - armShift;
  ctx.fillStyle = '#3a2a18';
  ctx.fillRect(px, y + 32 + bob, 12, 3);
  ctx.fillStyle = '#444';
  ctx.fillRect(px + (facing === 1 ? 8 : 0), y + 30 + bob, 4, 6);
}

function drawDragon(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  // 尻尾
  ctx.fillStyle = tint;
  const tx = facing === 1 ? x - 10 : x + w;
  ctx.fillRect(tx, y + h - 18 + bob, 10, 5);
  ctx.fillRect(tx + (facing === 1 ? -5 : 5), y + h - 22 + bob, 7, 5);
  // 翼 (背面)
  ctx.fillStyle = '#1a2a1a';
  if (facing === 1) {
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 20 + bob);
    ctx.lineTo(x - 6, y + 8 + bob);
    ctx.lineTo(x - 4, y + 32 + bob);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + w - 6, y + 20 + bob);
    ctx.lineTo(x + w + 6, y + 8 + bob);
    ctx.lineTo(x + w + 4, y + 32 + bob);
    ctx.closePath();
    ctx.fill();
  }
  // 鋭い脚
  ctx.fillStyle = '#2a4a3a';
  ctx.fillRect(x + 4 + legShift, y + h - 8, 12, 8);
  ctx.fillRect(x + w - 16 - legShift, y + h - 8, 12, 8);
  // 鱗の体
  ctx.fillStyle = tint;
  ctx.fillRect(x + 4, y + 18 + bob, w - 8, h - 26);
  // 腹 (黄色)
  ctx.fillStyle = '#f5d860';
  ctx.fillRect(x + 12, y + 24 + bob, w - 24, h - 36);
  // 頭 + 鼻先
  ctx.fillStyle = tint;
  ctx.fillRect(x + 6, y + 4 + bob, w - 12, 14);
  const snX = facing === 1 ? x + w - 4 : x - 6;
  ctx.fillRect(snX, y + 10 + bob, 10, 8);
  // 角
  ctx.fillStyle = '#dccc60';
  ctx.fillRect(x + 8, y - 2 + bob, 3, 6);
  ctx.fillRect(x + w - 11, y - 2 + bob, 3, 6);
  // 目
  ctx.fillStyle = '#ff3030';
  const eyeX = facing === 1 ? x + w - 14 : x + 6;
  ctx.fillRect(eyeX, y + 8 + bob, 4, 4);
}

function drawAlien(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // 脚 (細い)
  ctx.fillStyle = '#7c5b50';
  ctx.fillRect(x + 12 + legShift, y + h - 10, 5, 10);
  ctx.fillRect(x + w - 17 - legShift, y + h - 10, 5, 10);
  // 細身の体
  ctx.fillStyle = tint;
  ctx.fillRect(x + 12, y + 32 + bob, w - 24, h - 42);
  // 巨大な頭 (楕円)
  ctx.fillStyle = '#9bc99b';
  ctx.beginPath();
  ctx.ellipse(x + w/2, y + 18 + bob, w/2 - 2, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  // 大きな目
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x + w/2 - 7, y + 18 + bob, 5, 8, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w/2 + 7, y + 18 + bob, 5, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // 目のハイライト
  ctx.fillStyle = '#80ffff';
  ctx.fillRect(x + w/2 - 9, y + 13 + bob, 2, 3);
  ctx.fillRect(x + w/2 + 5, y + 13 + bob, 2, 3);
  // 触角
  const wob = Math.sin(performance.now() / 200) * 2;
  ctx.strokeStyle = '#9bc99b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w/2 - 5, y + 4 + bob);
  ctx.lineTo(x + w/2 - 8 + wob, y - 9 + bob);
  ctx.moveTo(x + w/2 + 5, y + 4 + bob);
  ctx.lineTo(x + w/2 + 8 - wob, y - 9 + bob);
  ctx.stroke();
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(x + w/2 - 8 + wob, y - 9 + bob, 3, 0, Math.PI * 2);
  ctx.arc(x + w/2 + 8 - wob, y - 9 + bob, 3, 0, Math.PI * 2);
  ctx.fill();
  // 腕
  ctx.fillStyle = '#9bc99b';
  const aX = facing === 1 ? x + w - 10 + armShift : x + 5 - armShift;
  ctx.fillRect(aX, y + 32 + bob, 5, 10);
}

function drawBoxer(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // 太もも (肌色)
  ctx.fillStyle = '#f5d0a0';
  ctx.fillRect(x + 6 + legShift, y + h - 18, 10, 8);
  ctx.fillRect(x + w - 16 - legShift, y + h - 18, 10, 8);
  // ハイソックス (白)
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 6 + legShift, y + h - 10, 10, 7);
  ctx.fillRect(x + w - 16 - legShift, y + h - 10, 10, 7);
  // ボクシングシューズ (黒)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 4 + legShift, y + h - 4, 12, 4);
  ctx.fillRect(x + w - 18 - legShift, y + h - 4, 12, 4);
  // ショーツ (チームカラー)
  ctx.fillStyle = tint;
  ctx.fillRect(x + 4, y + h - 28, w - 8, 12);
  // ベルト
  ctx.fillStyle = '#daa520';
  ctx.fillRect(x + 4, y + h - 29, w - 8, 2);
  // タンクトップ (白)
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 8, y + 22 + bob, w - 16, h - 50);
  // 肩のストラップ
  ctx.fillStyle = tint;
  ctx.fillRect(x + 8, y + 20 + bob, 4, 6);
  ctx.fillRect(x + w - 12, y + 20 + bob, 4, 6);
  // 顔
  ctx.fillStyle = '#f5d0a0';
  ctx.fillRect(x + 10, y + 8 + bob, w - 20, 14);
  // ヘッドギア (チームカラー)
  ctx.fillStyle = tint;
  ctx.fillRect(x + 8, y + 4 + bob, w - 16, 8);
  ctx.fillRect(x + 6, y + 10 + bob, 4, 8);
  ctx.fillRect(x + w - 10, y + 10 + bob, 4, 8);
  // 目
  ctx.fillStyle = '#000';
  const eo = facing === 1 ? 1 : -1;
  ctx.fillRect(x + 14 + eo, y + 14 + bob, 2, 3);
  ctx.fillRect(x + w - 16 + eo, y + 14 + bob, 2, 3);
  // マウスピース
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 14, y + 19 + bob, w - 28, 2);
  // ボクシンググローブ (両手・前後にスウィング)
  ctx.fillStyle = '#c0392b';
  const gx1 = facing === 1 ? x + w - 6 + armShift * 1.5 : x - 6 - armShift * 1.5;
  const gx2 = facing === 1 ? x - 4 - armShift * 0.5 : x + w - 6 + armShift * 0.5;
  ctx.fillRect(gx1, y + 28 + bob, 12, 12);
  ctx.fillRect(gx2, y + 32 + bob, 10, 10);
  // グローブの白ライン (手首)
  ctx.fillStyle = '#fff';
  ctx.fillRect(gx1, y + 32 + bob, 12, 2);
  ctx.fillRect(gx2, y + 35 + bob, 10, 2);
}

function drawIceMage(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // ローブ (台形・歩行で揺れる)
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.moveTo(x + 2 + legShift * 0.7, y + h);
  ctx.lineTo(x + w - 2 + legShift * 0.7, y + h);
  ctx.lineTo(x + w - 8, y + 22 + bob);
  ctx.lineTo(x + 8, y + 22 + bob);
  ctx.closePath();
  ctx.fill();
  // 雪の結晶模様 (胸)
  ctx.fillStyle = '#cdf4ff';
  ctx.fillRect(x + w/2 - 1, y + 30 + bob, 2, 8);
  ctx.fillRect(x + w/2 - 4, y + 33 + bob, 8, 2);
  // 裾の縁取り
  ctx.fillStyle = '#80ddff';
  ctx.fillRect(x + 2 + legShift * 0.7, y + h - 3, w - 4, 3);
  // 顔
  ctx.fillStyle = '#e0d8d0';
  ctx.fillRect(x + 10, y + 14 + bob, w - 20, 10);
  // 白い髭
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 10, y + 22 + bob, w - 20, 6);
  ctx.fillRect(x + 13, y + 27 + bob, w - 26, 3);
  // 三角帽子 (青)
  const hatTilt = state.walking ? Math.sin(state.legShift || 0) * 1.5 : 0;
  ctx.fillStyle = '#16456a';
  ctx.beginPath();
  ctx.moveTo(x + w/2 + hatTilt * 2, y - 12 + bob);
  ctx.lineTo(x + 4, y + 14 + bob);
  ctx.lineTo(x + w - 4, y + 14 + bob);
  ctx.closePath();
  ctx.fill();
  // 帽子の雪結晶
  ctx.fillStyle = '#cdf4ff';
  ctx.fillRect(x + w/2 - 1 + hatTilt, y + 2 + bob, 2, 4);
  ctx.fillRect(x + w/2 - 3 + hatTilt, y + 3 + bob, 6, 2);
  // 目 (深い青)
  ctx.fillStyle = '#1f1f5a';
  const eyeOffset = facing === 1 ? 2 : -2;
  ctx.fillRect(x + 14 + eyeOffset, y + 17 + bob, 3, 3);
  ctx.fillRect(x + w - 17 + eyeOffset, y + 17 + bob, 3, 3);
  // 杖
  ctx.fillStyle = '#7a4a1e';
  const wx = facing === 1 ? x + w + armShift : x - 8 - armShift;
  ctx.fillRect(wx, y + 28 + bob, 8, 3);
  // 氷クリスタル (菱形)
  ctx.fillStyle = '#80ddff';
  const cxIce = wx + 4;
  const cyIce = y + 28 + bob;
  ctx.beginPath();
  ctx.moveTo(cxIce, cyIce - 6);
  ctx.lineTo(cxIce + 5, cyIce);
  ctx.lineTo(cxIce, cyIce + 6);
  ctx.lineTo(cxIce - 5, cyIce);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(cxIce - 1, cyIce - 3, 2, 2);
}

function drawVampire(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // マント (背景・台形)
  ctx.fillStyle = '#1a0a14';
  ctx.beginPath();
  ctx.moveTo(x + w/2 - 12, y + 12 + bob);
  ctx.lineTo(x + w/2 + 12, y + 12 + bob);
  ctx.lineTo(x + w + 4, y + h - 4);
  ctx.lineTo(x - 4, y + h - 4);
  ctx.closePath();
  ctx.fill();
  // マントの裏地 (チームカラー)
  ctx.fillStyle = tint;
  ctx.fillRect(x - 4, y + h - 8, w + 8, 4);
  // 脚 (黒ズボン)
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x + 8 + legShift, y + h - 10, 8, 10);
  ctx.fillRect(x + w - 16 - legShift, y + h - 10, 8, 10);
  // タキシード胴体
  ctx.fillStyle = '#1a1a26';
  ctx.fillRect(x + 6, y + 22 + bob, w - 12, h - 32);
  // 白シャツ (中央)
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(x + w/2 - 4, y + 22 + bob, 8, h - 32);
  // 蝶ネクタイ (チームカラー)
  ctx.fillStyle = tint;
  ctx.fillRect(x + w/2 - 6, y + 24 + bob, 12, 4);
  // 顔 (蒼白)
  ctx.fillStyle = '#e8d8e0';
  ctx.fillRect(x + 10, y + 6 + bob, w - 20, 16);
  // 髪 (黒・撫で付け)
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x + 8, y + 4 + bob, w - 16, 6);
  // V字の生え際
  ctx.fillRect(x + w/2 - 1, y + 8 + bob, 2, 4);
  // 立ち襟 (マントの首元・三角形)
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 22 + bob);
  ctx.lineTo(x + 14, y + 12 + bob);
  ctx.lineTo(x + 14, y + 22 + bob);
  ctx.closePath();
  ctx.moveTo(x + w - 8, y + 22 + bob);
  ctx.lineTo(x + w - 14, y + 12 + bob);
  ctx.lineTo(x + w - 14, y + 22 + bob);
  ctx.closePath();
  ctx.fill();
  // 目 (赤く光る)
  ctx.fillStyle = '#ff3030';
  const evo = facing === 1 ? 1 : -1;
  ctx.fillRect(x + 14 + evo, y + 13 + bob, 3, 3);
  ctx.fillRect(x + w - 17 + evo, y + 13 + bob, 3, 3);
  // 牙
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + w/2 - 4, y + 19 + bob, 2, 3);
  ctx.fillRect(x + w/2 + 2, y + 19 + bob, 2, 3);
  // 手 (前に出る)
  ctx.fillStyle = '#e8d8e0';
  const hx = facing === 1 ? x + w - 4 + armShift : x - 4 - armShift;
  ctx.fillRect(hx, y + 30 + bob, 6, 8);
}

function drawSamurai(ctx, x, y, w, h, facing, tint, state = {}) {
  const bob = state.bob || 0;
  const legShift = state.legShift || 0;
  const armShift = state.armShift || 0;
  // 袴 (台形)
  ctx.fillStyle = '#2a3040';
  ctx.beginPath();
  ctx.moveTo(x + 2 + legShift * 0.6, y + h);
  ctx.lineTo(x + w - 2 + legShift * 0.6, y + h);
  ctx.lineTo(x + w - 6, y + h - 22);
  ctx.lineTo(x + 6, y + h - 22);
  ctx.closePath();
  ctx.fill();
  // 袴の中央縦線
  ctx.fillStyle = '#1a2030';
  ctx.fillRect(x + w/2 - 1, y + h - 22, 2, 22);
  // 着物 (上半身・チームカラー)
  ctx.fillStyle = tint;
  ctx.fillRect(x + 6, y + 20 + bob, w - 12, h - 42);
  // 帯 (金)
  ctx.fillStyle = '#daa520';
  ctx.fillRect(x + 6, y + h - 26, w - 12, 4);
  // 着物の合わせ (白の三角)
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(x + w/2, y + 20 + bob);
  ctx.lineTo(x + w/2 + 6, y + h - 26);
  ctx.lineTo(x + w/2 - 6, y + h - 26);
  ctx.closePath();
  ctx.fill();
  // 顔
  ctx.fillStyle = '#f5d0a0';
  ctx.fillRect(x + 10, y + 8 + bob, w - 20, 14);
  // 髪 (黒)
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(x + 8, y + 4 + bob, w - 16, 6);
  // ちょんまげ
  ctx.fillRect(x + w/2 - 3, y + bob, 6, 5);
  ctx.fillRect(x + w/2 - 1, y - 4 + bob, 2, 5);
  // 鋭い目
  ctx.fillStyle = '#000';
  const sao = facing === 1 ? 1 : -1;
  ctx.fillRect(x + 13 + sao, y + 14 + bob, 4, 2);
  ctx.fillRect(x + w - 17 + sao, y + 14 + bob, 4, 2);
  // 口
  ctx.fillStyle = '#440';
  ctx.fillRect(x + 16, y + 19 + bob, w - 32, 2);
  // 刀 (帯に差してある — 振りに同期)
  ctx.fillStyle = '#dfe6f0';
  const sx = facing === 1 ? x + w + armShift : x - 18 - armShift;
  ctx.fillRect(sx, y + 30 + bob, 18, 3);
  // 鍔 (黒)
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(sx + (facing === 1 ? -3 : 18), y + 28 + bob, 4, 7);
  // 柄 (赤)
  ctx.fillStyle = '#aa2030';
  ctx.fillRect(sx + (facing === 1 ? -10 : 17), y + 30 + bob, 7, 3);
}

// =============================================================
// キャラクター定義 (パラメータ + 描画関数)
// =============================================================
const CHARACTERS = [
  { id: 'knight', name: '騎士',   speed: 5.0, jump: 12.0, weight: 1.30, atkMul: 1.10, draw: drawKnight,
    desc: '重装・耐怯アーマー',
    ranged: null,
    special: { armor: 0.65 },
    super: '剣の旋風 (前方広範囲・無敵)' },
  { id: 'ninja',  name: '忍者',   speed: 6.5, jump: 14.0, weight: 0.85, atkMul: 0.90, draw: drawNinja,
    desc: '俊足・空中2段ジャンプ',
    ranged: { type: 'shuriken', count: 3, damage: 4, speed: 9, cooldown: 38, spread: 0.18, life: 80 },
    special: { airJumps: 1 },
    super: '影分身連撃 (多段ヒット)' },
  { id: 'robot',  name: 'ロボ',   speed: 5.2, jump: 12.5, weight: 1.15, atkMul: 1.00, draw: drawRobot,
    desc: '自己修復 (常時回復)',
    ranged: { type: 'laser', count: 1, damage: 8, speed: 12, cooldown: 50, spread: 0, life: 70 },
    special: { repair: { interval: 90, amount: 1.0 } },
    super: 'ホーミングミサイル × 5' },
  { id: 'wizard', name: '魔導士', speed: 4.8, jump: 13.5, weight: 0.95, atkMul: 1.15, draw: drawWizard,
    desc: '火球3ヒットで即時射出',
    ranged: { type: 'fireball', count: 1, damage: 14, speed: 5, cooldown: 75, spread: 0, homing: 0.13, life: 110 },
    special: { mana: { hitsForFree: 3 } },
    super: '隕石召喚 (相手頭上に落下)' },
  { id: 'sumo',   name: '力士',   speed: 3.8, jump: 10.5, weight: 1.55, atkMul: 1.20, draw: drawSumo,
    desc: '80%超で怒り (攻+0.3)',
    ranged: null,
    special: { rage: { threshold: 80, atkBonus: 0.3 } },
    super: '土俵入り (場全体の衝撃波)' },
  { id: 'pirate', name: '海賊',   speed: 5.5, jump: 12.5, weight: 1.05, atkMul: 1.00, draw: drawPirate,
    desc: '銃命中で速射 (CD半減)',
    ranged: { type: 'bullet', count: 1, damage: 16, speed: 14, cooldown: 90, spread: 0, life: 70 },
    special: { quickReload: 0.5 },
    super: '大砲発射 (巨大砲弾)' },
  { id: 'dragon', name: 'ドラゴン', speed: 4.5, jump: 11.0, weight: 1.25, atkMul: 1.15, draw: drawDragon,
    desc: '近距離火炎・空中滑空',
    ranged: { type: 'flame', count: 5, damage: 4, speed: 8, cooldown: 55, spread: 0.30, life: 18 },
    special: { glide: 0.4 },
    super: '業火のブレス (連続炎)' },
  { id: 'alien',  name: '宇宙人', speed: 5.8, jump: 15.0, weight: 0.75, atkMul: 0.95, draw: drawAlien,
    desc: '空中3段・蛇行プラズマ',
    ranged: { type: 'plasma', count: 1, damage: 7, speed: 5, cooldown: 45, spread: 0, life: 100, wave: { freq: 0.22, amp: 2.5 } },
    special: { airJumps: 2 },
    super: 'UFO召喚 (上空から雨レーザー)' },
  { id: 'boxer',   name: 'ボクサー', speed: 5.6, jump: 11.5, weight: 1.10, atkMul: 1.10, draw: drawBoxer,
    desc: '連打でCD加速 (コンボ)',
    ranged: null,
    special: { combo: { window: 45, cdReduce: 4, max: 16 } },
    super: 'コーナーラッシュ (連打)' },
  { id: 'icemage', name: '氷使い', speed: 4.6, jump: 12.0, weight: 0.92, atkMul: 1.05, draw: drawIceMage,
    desc: '氷弾で凍結 (相手鈍化)',
    ranged: { type: 'ice', count: 1, damage: 12, speed: 5, cooldown: 60, spread: 0, life: 100 },
    special: { freeze: 60 },
    super: '大吹雪 (氷弾6連扇)' },
  { id: 'vampire', name: '吸血鬼', speed: 5.5, jump: 13.5, weight: 0.95, atkMul: 1.00, draw: drawVampire,
    desc: '10ヒットで吸血回復',
    ranged: { type: 'bat', count: 3, damage: 5, speed: 7, cooldown: 50, spread: 0.25, life: 90, homing: 0.05 },
    special: { drain: { hits: 10, heal: 25 } },
    super: '黒の宴 (吸血広範囲)' },
  { id: 'samurai', name: '侍', speed: 5.5, jump: 12.5, weight: 1.05, atkMul: 1.20, draw: drawSamurai,
    desc: '盾中に攻撃で居合反撃',
    ranged: { type: 'slash', count: 1, damage: 11, speed: 12, cooldown: 55, spread: 0, life: 36 },
    special: { iaiCounter: { damage: 16, speed: 16, cooldown: 35 } },
    super: '一閃 (高速貫通斬)' },
];

// =============================================================
// プレイヤー
// =============================================================
class Player {
  constructor(spawnX, controls, label, character, tint) {
    this.spawnX = spawnX;
    this.controls = controls;
    this.label = label;
    this.character = character;
    this.tint = tint;
    this.w = 40;
    this.h = 60;
    this.stocks = 3;
    this.respawn(true);
  }
  respawn(initial = false) {
    this.x = this.spawnX;
    this.y = 100;
    this.vx = 0; this.vy = 0;
    this.facing = this.spawnX < STAGE_W / 2 ? 1 : -1;
    this.onGround = false;
    this.attackCooldown = 0;
    this.hitstun = 0;
    this.attackBox = null;
    this.damage = 0;
    this.shielding = false;
    this.shieldHP = 100;
    this.shieldBroken = 0;
    this.counterWindow = 0;    // ジャストガード受付の残りフレーム
    this.invincible = initial ? 0 : 60;
    this.animPhase = 0;
    // 特殊能力の状態 (キャラ依存)
    const sp = this.character.special || {};
    this.airJumpsLeft = sp.airJumps || 0;
    this.prevJumpKey = false;
    this.prevAttackKey = false;
    this.slowFrames = 0;       // 凍結 (氷使いから受ける)
    this.lastHitFrame = -999;  // ボクサーのコンボ判定
    this.comboCD = 0;          // コンボによる CD 軽減
    this.repairTick = 0;       // ロボの自己修復タイマー
    this.manaCharge = 0;       // 魔導士のマナ充填カウンタ
    this.drainHits = 0;        // 吸血鬼のヒット蓄積
    this.frame = 0;            // 経過フレーム (コンボ判定用)
    if (initial) this.hitCount = 0; // 必殺ゲージ。死亡しても引き継ぐ
  }
  computeAnimState() {
    const walking = this.onGround && Math.abs(this.vx) > 0.5;
    const airborne = !this.onGround;
    const phase = this.animPhase;
    return {
      walking,
      airborne,
      // 縦バウンド (歩行時に体が上下)
      bob: walking ? Math.abs(Math.sin(phase * 2)) * -2 : 0,
      // 脚オフセット (片脚前/後 ±3px)
      legShift: walking ? Math.sin(phase) * 3 : 0,
      // 腕の振り (脚と逆位相)
      armShift: walking ? -Math.sin(phase) * 3 : 0,
      // 着地直後/シールド時は静止
      shielding: this.shielding,
      hitstun: this.hitstun,
      attacking: !!this.attackBox,
    };
  }
  update(opponent) {
    const c = this.controls;
    this.frame++;
    const canControl = this.hitstun <= 0 && this.shieldBroken <= 0;
    const sp = this.character.special || {};
    // 凍結中は移動上限を半減 (氷使いの freeze)
    const slowMul = this.slowFrames > 0 ? 0.5 : 1;
    const MAX_RUN = this.character.speed * slowMul;
    const JUMP_POWER = this.character.jump;

    // 防御判定 (接地中、攻撃クールダウン外、シールド HP あり)
    const wasShielding = this.shielding;
    this.shielding = canControl && this.onGround
      && keys[c.shield] && this.attackCooldown <= 0 && this.shieldHP > 0;
    if (this.shielding && !wasShielding) {
      spawnShieldRipple(this);
      this.counterWindow = COUNTER_WINDOW;  // 防御開始 → カウンター受付開始
    } else if (this.counterWindow > 0) {
      this.counterWindow--;
    }
    if (!this.shielding) this.counterWindow = 0;

    // 居合カウンター (侍): 防御中に攻撃ボタンの立ち上がりで瞬時の斬撃波
    const attackEdge = (keys[c.attack] || keys[c.strong]) && !this.prevAttackKey;
    if (this.shielding && sp.iaiCounter && attackEdge && this.attackCooldown <= 0) {
      this.releaseIaiCounter(sp.iaiCounter);
    }
    this.prevAttackKey = keys[c.attack] || keys[c.strong];

    if (canControl && !this.shielding) {
      if (keys[c.left])  { this.vx -= MOVE_ACCEL * slowMul; this.facing = -1; }
      if (keys[c.right]) { this.vx += MOVE_ACCEL * slowMul; this.facing = 1; }
      // 必殺技 (相手に5回当てたら発動可)
      if (keys[c.super] && this.hitCount >= 5 && this.attackCooldown <= 0) {
        this.useSuper();
      }
      // ジャンプ (エッジ検出 + 多段ジャンプ)
      const jumpPressed = keys[c.jump] && !this.prevJumpKey;
      if (jumpPressed) {
        if (this.onGround) {
          this.vy = -JUMP_POWER;
          this.onGround = false;
          sfx.jump();
        } else if (this.airJumpsLeft > 0) {
          this.vy = -JUMP_POWER * 0.9;
          this.airJumpsLeft--;
          sfx.jump();
          // 二段/三段ジャンプの足元リング
          addParticle({
            x: this.x + this.w/2, y: this.y + this.h,
            vx: 0, vy: 0, life: 14, maxLife: 14,
            size: this.w, color: this.tint, shape: 'ring', gravity: 0,
          });
        }
      }
      // 高速落下
      if (keys[c.down] && !this.onGround && this.vy > -2) {
        this.vy += 0.6;
      }
      // 攻撃 (方向判定: 上→上攻撃, 下→下攻撃, それ以外→横)
      const wantStrong = keys[c.strong];
      const wantLight  = keys[c.attack];
      const wantRanged = keys[c.ranged] && this.character.ranged;
      if (wantRanged && this.attackCooldown <= 0) {
        this.fireRanged();
      } else if ((wantStrong || wantLight) && this.attackCooldown <= 0) {
        let dir = 'side';
        if (keys[c.up]) dir = 'up';
        else if (keys[c.down]) dir = 'down';
        this.startAttack(wantStrong, dir);
        sfx.swing();
        this.syncAttackBox();
        if (dir === 'up' || dir === 'down') {
          spawnDirectionalSlash(this, this.attackBox, dir);
        } else {
          spawnSlash(this, this.attackBox);
        }
      }
    }

    // シールド消費/回復
    if (this.shielding) {
      this.shieldHP = Math.max(0, this.shieldHP - 0.4);
      if (this.shieldHP <= 0) {
        this.shieldBroken = 120;
        this.shielding = false;
      }
    } else if (this.shieldHP < 100) {
      this.shieldHP = Math.min(100, this.shieldHP + 0.25);
    }
    if (this.shieldBroken > 0) this.shieldBroken--;

    // ジャンプキーの立ち上がり検出用 (canControl 外でも prevJumpKey は更新)
    this.prevJumpKey = keys[c.jump];

    // 物理 (ドラゴンの滑空: 空中でジャンプ押下 + 落下中なら重力減衰)
    let g = GRAVITY;
    if (sp.glide && !this.onGround && this.vy > 0 && keys[c.jump]) {
      g *= sp.glide;
      if (this.frame % 4 === 0) {
        addParticle({
          x: this.x + this.w/2 + (Math.random() - 0.5) * 24,
          y: this.y + this.h - 4,
          vx: 0, vy: -1, life: 18, maxLife: 18, size: 3,
          color: this.tint, shape: 'rect', gravity: -0.05,
        });
      }
    }
    this.vy += g;
    this.vx *= this.onGround ? FRICTION : AIR_FRICTION;
    this.vx = Math.max(-15, Math.min(15, this.vx));
    if (canControl) this.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, this.vx));
    this.x += this.vx;
    this.y += this.vy;

    // 足場 (複数プラットフォーム対応: 上から落ちてくる時のみ着地)
    let landed = false;
    let landedPlat = null;
    for (const plat of currentStage.platforms) {
      if (plat._state === 'gone') continue; // 崩れた状態はすり抜ける
      const wasAbove = (this.y + this.h - this.vy) <= plat.y;
      const overlapX = this.x + this.w > plat.x && this.x < plat.x + plat.w;
      if (overlapX && wasAbove && this.y + this.h >= plat.y && this.vy >= 0) {
        this.y = plat.y - this.h;
        this.vy = 0;
        if (!this.onGround) this.airJumpsLeft = sp.airJumps || 0;
        this.onGround = true;
        landed = true;
        landedPlat = plat;
        // 崩れる足場のトリガ
        if (plat.crumble && (plat._state || 'solid') === 'solid') {
          plat._state = 'cracking';
          plat._timer = plat.crumble.delay;
        }
        break;
      }
    }
    if (landed && landedPlat.deltaX) this.x += landedPlat.deltaX;
    if (!landed) this.onGround = false;

    // タイマー
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.hitstun > 0) this.hitstun--;
    if (this.invincible > 0) this.invincible--;
    if (this.slowFrames > 0) this.slowFrames--;

    // ロボの自己修復 (ヒットスタン外 + ダメージあり時のみカウント)
    if (sp.repair && this.hitstun <= 0 && this.damage > 0) {
      this.repairTick++;
      if (this.repairTick >= sp.repair.interval) {
        this.repairTick = 0;
        this.damage = Math.max(0, this.damage - sp.repair.amount);
        addParticle({
          x: this.x + this.w/2 + (Math.random() - 0.5) * 12,
          y: this.y - 2, vx: 0, vy: -1, life: 22, maxLife: 22,
          size: 6, color: '#80ff80', shape: 'flash', gravity: -0.05,
        });
      }
    }

    // 歩行アニメ位相: 接地中の移動量に応じて進める
    if (this.onGround && Math.abs(this.vx) > 0.5) {
      this.animPhase += Math.abs(this.vx) * 0.18;
    } else if (!this.onGround) {
      // 空中はリセットしない (再着地時の連続性のため微減衰)
      this.animPhase *= 0.97;
    } else {
      this.animPhase *= 0.7;
    }

    // 攻撃判定
    if (this.attackBox) {
      this.syncAttackBox();
      this.attackBox.life--;
      if (this.attackBox.rehit > 0) this.attackBox.rehit--;
      const canHit = this.attackBox.multihit
        ? this.attackBox.rehit <= 0
        : !this.attackBox.hit;
      if (canHit && hitTest(this.attackBox, opponent) && opponent.invincible <= 0) {
        const a = this.attackBox;
        const hx = opponent.x + opponent.w / 2;
        const hy = opponent.y + opponent.h / 2;
        if (opponent.shielding && opponent.counterWindow > 0) {
          // ジャストガード成立 → 攻撃を打ち消して反撃
          opponent.performCounter(this, a.damage);
          this.attackBox = null;
        } else if (opponent.shielding) {
          opponent.shieldHP = Math.max(0, opponent.shieldHP - a.damage * 1.5);
          this.vx = -this.facing * 4;
          sfx.shieldHit();
          spawnShieldRipple(opponent);
          shake(2, 6);
          if (opponent.shieldHP <= 0) {
            opponent.shieldBroken = 120;
            opponent.shielding = false;
            opponent.vy = -8;
            sfx.shieldBreak();
            spawnShieldBreak(opponent);
            shake(8, 24);
          }
        } else {
          opponent.takeHit(this);
          this.hitCount = Math.min(5, (this.hitCount || 0) + 1);
          if (a.lifesteal) {
            this.damage = Math.max(0, this.damage - a.lifesteal);
          }
          this.onAttackHit('melee');
          if (a.dir === 'up') sfx.upHit();
          else if (a.dir === 'down' || a.dir === 'spike' || a.dir === 'sweep') sfx.downHit();
          else if (a.strong) sfx.strongHit();
          else sfx.weakHit();
          spawnHitSpark(hx, hy, a.strong, a.dir);
          shake(a.strong ? 7 : 2, a.strong ? 18 : 6);
        }
        if (this.attackBox) { // カウンターで消えていなければヒット消費を記録
          if (this.attackBox.multihit) this.attackBox.rehit = 8;
          else this.attackBox.hit = true;
        }
      }
      if (this.attackBox && this.attackBox.life <= 0) this.attackBox = null;
    }

    // 場外 KO
    if (this.x < -150 || this.x > STAGE_W + 150 ||
        this.y > STAGE_H + 150 || this.y < -300) {
      this.stocks--;
      sfx.ko();
      // 画面端方向に派手に
      const cx = Math.max(0, Math.min(STAGE_W, this.x + this.w / 2));
      const cy = Math.max(0, Math.min(STAGE_H, this.y + this.h / 2));
      spawnKO({ x: cx - this.w / 2, y: cy - this.h / 2, w: this.w, h: this.h });
      shake(12, 26);
      if (this.stocks > 0) this.respawn(false);
    }
  }
  startAttack(strong, dir) {
    const sp = this.character.special || {};
    // 力士の怒り: 自ダメージが閾値を超えると攻撃力 +bonus
    let atk = this.character.atkMul;
    if (sp.rage && this.damage >= sp.rage.threshold) atk += sp.rage.atkBonus;
    // ボクサーのコンボ加速: 直近 window 内のヒット数だけ次の CD を短縮
    let cdBonus = 0;
    if (sp.combo && (this.frame - this.lastHitFrame) <= sp.combo.window) {
      cdBonus = Math.min(sp.combo.max, this.comboCD);
    } else if (sp.combo) {
      this.comboCD = 0;
    }
    let box;
    if (dir === 'up') {
      box = {
        offsetX: -4, offsetY: -28,
        w: this.w + 8, h: 32,
        damage: (strong ? 18 : 8) * atk,
        kbBonus: strong ? 1.5 : 1.0,
        life: strong ? 12 : 9,
        dir: 'up',
        strong,
      };
      this.attackCooldown = Math.max(6, (strong ? 42 : 22) - cdBonus);
    } else if (dir === 'down') {
      box = {
        offsetX: -8, offsetY: this.h - 4,
        w: this.w + 16, h: 26,
        damage: (strong ? 16 : 9) * atk,
        kbBonus: strong ? 1.4 : 1.0,
        life: strong ? 12 : 9,
        dir: this.onGround ? 'sweep' : 'spike', // 空中の下攻撃 = メテオ
        strong,
      };
      this.attackCooldown = Math.max(6, (strong ? 42 : 22) - cdBonus);
    } else {
      box = {
        offsetX: this.facing === 1 ? this.w - 4 : (strong ? -52 : -34),
        offsetY: strong ? 6 : 12,
        w: strong ? 56 : 34,
        h: strong ? 46 : 34,
        damage: (strong ? 22 : 9) * atk,
        kbBonus: strong ? 1.6 : 1.0,
        life: strong ? 14 : 10,
        dir: 'side',
        strong,
      };
      this.attackCooldown = Math.max(6, (strong ? 45 : 22) - cdBonus);
      if (strong) this.vx -= this.facing * 1.5;
    }
    this.attackBox = box;
  }
  syncAttackBox() {
    if (!this.attackBox) return;
    this.attackBox.x = this.x + this.attackBox.offsetX;
    this.attackBox.y = this.y + this.attackBox.offsetY;
  }
  useSuper() {
    const handler = SUPER_HANDLERS[this.character.id];
    if (!handler) return;
    this.hitCount = 0; // ゲージ消費 → 次の発動には再び 5 ヒット必要
    handler(this);
    // 発動エフェクト
    addParticle({
      x: this.x + this.w/2, y: this.y + this.h/2,
      vx: 0, vy: 0, life: 30, maxLife: 30,
      size: 100, color: '#ffd86b', shape: 'flash', gravity: 0,
    });
    addParticle({
      x: this.x + this.w/2, y: this.y + this.h/2,
      vx: 0, vy: 0, life: 24, maxLife: 24,
      size: 30, color: this.tint, shape: 'ring', gravity: 0,
    });
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      addParticle({
        x: this.x + this.w/2, y: this.y + this.h/2,
        vx: Math.cos(ang) * 5, vy: Math.sin(ang) * 5,
        life: 30, maxLife: 30, size: 4,
        color: '#fff', shape: 'streak', gravity: 0,
      });
    }
    shake(10, 26);
  }
  fireRanged() {
    const r = this.character.ranged;
    if (!r) return;
    this.attackCooldown = r.cooldown;
    const baseX = this.x + (this.facing === 1 ? this.w + 2 : -10);
    const baseY = this.y + this.h / 2 - 4;
    for (let i = 0; i < r.count; i++) {
      const t = r.count > 1 ? (i / (r.count - 1)) - 0.5 : 0;
      // flame は毎発ランダムに散らす (火炎放射感)
      const jitter = r.type === 'flame' ? (Math.random() - 0.5) * r.spread : 0;
      const angle = t * r.spread * 2 + jitter;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const vx = cosA * r.speed * this.facing;
      const vy = sinA * r.speed;
      projectiles.push(new Projectile({
        owner: this,
        x: baseX + (Math.random() - 0.5) * 4,
        y: baseY + (Math.random() - 0.5) * 4,
        vx, vy,
        type: r.type,
        damage: r.damage,
        life: r.life,
        homing: r.homing || 0,
        wave: r.wave || null,
        lifesteal: r.lifesteal || 0,
      }));
    }
    this.vx -= this.facing * (r.type === 'fireball' || r.type === 'bullet' ? 2 : 0.6);
    if (r.type === 'fireball' || r.type === 'flame') sfx.fireball();
    else if (r.type === 'laser' || r.type === 'plasma') sfx.laser();
    else if (r.type === 'bullet') sfx.strongHit();
    else sfx.shuriken();
    addParticle({
      x: baseX, y: baseY + 4,
      vx: 0, vy: 0,
      life: 10, maxLife: 10,
      size: r.type === 'fireball' || r.type === 'bullet' ? 28 : 18,
      color: r.type === 'fireball' || r.type === 'flame' ? '#ffaa30'
           : r.type === 'laser' || r.type === 'plasma' ? '#80ffff'
           : '#fff',
      shape: 'flash',
      gravity: 0,
    });
  }
  // 攻撃ヒット成立時に呼ぶ。type = 'melee' | projectile.type
  onAttackHit(type) {
    const sp = this.character.special || {};
    // ボクサー: 直近ヒットからの間隔で comboCD を蓄積し、次の startAttack で消費
    if (sp.combo) {
      if ((this.frame - this.lastHitFrame) <= sp.combo.window) {
        this.comboCD = Math.min(sp.combo.max, this.comboCD + sp.combo.cdReduce);
      } else {
        this.comboCD = sp.combo.cdReduce;
      }
      this.lastHitFrame = this.frame;
    }
    // 吸血鬼: 規定ヒット数で自ダメージを heal 分回復
    if (sp.drain) {
      this.drainHits++;
      if (this.drainHits >= sp.drain.hits) {
        this.drainHits = 0;
        this.damage = Math.max(0, this.damage - sp.drain.heal);
        addParticle({
          x: this.x + this.w/2, y: this.y + this.h/2,
          vx: 0, vy: 0, life: 36, maxLife: 36, size: 80,
          color: '#aa2050', shape: 'flash', gravity: 0,
        });
        addParticle({
          x: this.x + this.w/2, y: this.y - 4,
          vx: 0, vy: 0, life: 30, maxLife: 30, size: 40,
          color: '#ff5060', shape: 'ring', gravity: 0,
        });
      }
    }
    // 海賊: 銃命中で攻撃 CD 半減
    if (sp.quickReload && type === 'bullet') {
      this.attackCooldown = Math.floor(this.attackCooldown * sp.quickReload);
      addParticle({
        x: this.x + (this.facing === 1 ? this.w + 4 : -4),
        y: this.y + 30, vx: 0, vy: 0, life: 12, maxLife: 12,
        size: 14, color: '#ffd86b', shape: 'flash', gravity: 0,
      });
    }
    // 魔導士: 火球を当てるとカウントし、規定回数で次の射出が即時
    if (sp.mana && type === 'fireball') {
      this.manaCharge++;
      if (this.manaCharge >= sp.mana.hitsForFree) {
        this.manaCharge = 0;
        this.attackCooldown = 0;
        addParticle({
          x: this.x + this.w/2, y: this.y + 12,
          vx: 0, vy: -2, life: 24, maxLife: 24, size: 20,
          color: '#ffd86b', shape: 'flash', gravity: -0.05,
        });
      }
    }
  }
  // ジャストガード成功時のカウンター: 被弾を無効化し相手へ反撃 (全キャラ共通)
  performCounter(attacker, incomingDamage) {
    this.counterWindow = 0; // 1 回限り
    const dmg = Math.max(COUNTER_MIN_DMG, incomingDamage * COUNTER_MULT);
    // 相手を自分から遠ざける向き (相手が左にいれば左へ吹き飛ばす)
    const dir = (attacker.x + attacker.w / 2) < (this.x + this.w / 2) ? -1 : 1;
    attacker.takeHit({
      attackBox: { damage: dmg, dir: 'side', kbBonus: 1.6, strong: true },
      facing: dir,
    });
    // 報酬: シールド小回復・必殺ゲージ加算・短い無敵 (多段ヒットの連続被弾防止)
    this.shieldHP = Math.min(100, this.shieldHP + 12);
    this.hitCount = Math.min(5, (this.hitCount || 0) + 1);
    this.invincible = Math.max(this.invincible, 16);
    this.facing = -dir; // 相手の方を向く
    // 演出
    hitstop = Math.max(hitstop, COUNTER_HITSTOP);
    spawnCounterFlash(this);
    sfx.counter();
    shake(9, 22);
  }
  // 居合カウンター (侍の special active)
  releaseIaiCounter(cfg) {
    projectiles.push(new Projectile({
      owner: this,
      x: this.x + (this.facing === 1 ? this.w : -36),
      y: this.y + 22,
      vx: cfg.speed * this.facing, vy: 0,
      type: 'slash',
      damage: cfg.damage,
      life: 28,
      knockbackBonus: 1.0,
    }));
    this.attackCooldown = cfg.cooldown;
    this.shielding = false; // カウンターでシールドを解除
    sfx.swing();
    addParticle({
      x: this.x + (this.facing === 1 ? this.w + 8 : -8),
      y: this.y + 24, vx: 0, vy: 0,
      life: 16, maxLife: 16, size: 24,
      color: '#fff', shape: 'flash', gravity: 0,
    });
  }
  takeHit(attacker) {
    const a = attacker.attackBox;
    const power = a.damage;
    const bonus = a.kbBonus || 1.0;
    const weight = this.character.weight;
    this.damage += power;
    const kb = calculateKnockback(this.damage, power);
    let vx, vy;
    if (a.dir === 'up') {
      vx = attacker.facing * kb.x * 0.3 * bonus / weight;
      vy = -kb.y * 1.7 * bonus / weight;
    } else if (a.dir === 'spike') {
      vx = attacker.facing * kb.x * 0.3 * bonus / weight;
      vy = kb.y * 1.5 * bonus / weight; // 下方向に叩き落とす
    } else if (a.dir === 'sweep') {
      vx = attacker.facing * kb.x * 1.3 * bonus / weight;
      vy = -kb.y * 0.4 * bonus / weight;
    } else {
      vx = attacker.facing * kb.x * bonus / weight;
      vy = -kb.y * bonus / weight;
    }
    this.vx = vx;
    this.vy = vy;
    let stun = 12 + Math.floor(this.damage / 20) + (a.strong ? 8 : 0);
    // 騎士のアーマー: ヒットスタン軽減
    const sp = this.character.special || {};
    if (sp.armor) stun = Math.floor(stun * sp.armor);
    this.hitstun = stun;
  }
  draw() {
    const flicker = this.invincible > 0 && Math.floor(this.invincible / 4) % 2;
    if (flicker) ctx.globalAlpha = 0.4;
    const state = this.computeAnimState();
    this.character.draw(ctx, this.x, this.y, this.w, this.h, this.facing, this.tint, state);
    ctx.globalAlpha = 1;
    // 凍結中の冷気オーラ (氷使いから減速を受けている時)
    if (this.slowFrames > 0) {
      ctx.fillStyle = `rgba(128,221,255,${0.18 + Math.sin(this.frame * 0.3) * 0.06})`;
      ctx.fillRect(this.x - 3, this.y - 3, this.w + 6, this.h + 6);
    }
    // 力士の怒りオーラ (rage 閾値を超えている時)
    const sp = this.character.special || {};
    if (sp.rage && this.damage >= sp.rage.threshold) {
      const pulse = 0.3 + Math.sin(this.frame * 0.2) * 0.15;
      ctx.strokeStyle = `rgba(255,80,40,${pulse})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(this.x - 4, this.y - 4, this.w + 8, this.h + 8);
    }
    // 攻撃判定
    if (this.attackBox) {
      const a = this.attackBox;
      ctx.fillStyle = a.strong ? 'rgba(255,80,60,0.7)'
                  : a.dir === 'up'    ? 'rgba(140,255,140,0.7)'
                  : a.dir === 'spike' ? 'rgba(180,80,255,0.75)'
                  : a.dir === 'sweep' ? 'rgba(255,200,80,0.7)'
                  : 'rgba(255,230,0,0.7)';
      ctx.fillRect(a.x, a.y, a.w, a.h);
    }
    // シールド (バブル + シマー)
    if (this.shielding) {
      const cx = this.x + this.w/2;
      const cy = this.y + this.h/2;
      const r = (this.w + 18) * (0.6 + this.shieldHP / 250);
      const pulse = 1 + Math.sin(performance.now() / 90) * 0.04;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * pulse);
      grad.addColorStop(0, `rgba(180,240,255,${0.45 + this.shieldHP / 500})`);
      grad.addColorStop(0.7, `rgba(120,200,255,${0.30 + this.shieldHP / 500})`);
      grad.addColorStop(1, 'rgba(80,160,240,0.05)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220,250,255,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // ハイライト
      ctx.beginPath();
      ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();
      // カウンター受付中は金色のリングを重ねて可視化
      if (this.counterWindow > 0) {
        ctx.strokeStyle = `rgba(255,216,107,${0.5 + 0.5 * (this.counterWindow / COUNTER_WINDOW)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r * pulse + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.shieldBroken > 0) {
      ctx.fillStyle = 'rgba(255,255,100,0.9)';
      ctx.font = '20px sans-serif';
      ctx.fillText('★', this.x + 4, this.y - 4);
      ctx.fillText('★', this.x + this.w - 18, this.y - 4);
    }
  }
}
function hitTest(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

// =============================================================
// 必殺技ハンドラ (キャラ別)
// =============================================================
const SUPER_HANDLERS = {
  knight: (p) => {
    // 剣の旋風: 大きな前方ヒットボックス + 短時間無敵
    p.invincible = Math.max(p.invincible, 35);
    p.attackBox = {
      offsetX: p.facing === 1 ? -10 : -90,
      offsetY: -8,
      w: 110, h: 80,
      damage: 20 * p.character.atkMul,
      kbBonus: 1.8, life: 24,
      hit: false, rehit: 0, multihit: true,
      dir: 'side', strong: true,
    };
    p.attackCooldown = 60;
    sfx.strongHit();
  },
  ninja: (p) => {
    // 影分身連撃: 多段ヒットの大きな前方ボックス + 前方瞬間移動
    p.x += p.facing * 30;
    p.invincible = Math.max(p.invincible, 20);
    p.attackBox = {
      offsetX: p.facing === 1 ? p.w : -90,
      offsetY: 0,
      w: 90, h: 60,
      damage: 4 * p.character.atkMul,
      kbBonus: 0.7, life: 36,
      hit: false, rehit: 0, multihit: true,
      dir: 'side', strong: false,
    };
    p.attackCooldown = 50;
    sfx.shuriken();
    // 残像エフェクト
    for (let i = 0; i < 5; i++) {
      addParticle({
        x: p.x - p.facing * i * 12, y: p.y + p.h/2,
        vx: 0, vy: 0,
        life: 14, maxLife: 14,
        size: 30, color: p.tint,
        shape: 'flash', gravity: 0,
      });
    }
  },
  robot: (p) => {
    // ホーミングミサイル × 5
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (gameState !== 'playing' || p.stocks <= 0) return;
        const ang = (i / 5 - 0.5) * 0.5;
        projectiles.push(new Projectile({
          owner: p,
          x: p.x + (p.facing === 1 ? p.w : -10),
          y: p.y + 20,
          vx: Math.cos(ang) * 5 * p.facing,
          vy: Math.sin(ang) * 5 - 1.5,
          type: 'missile',
          damage: 8,
          life: 110,
          homing: 0.22,
          knockbackBonus: 0.9,
        }));
        sfx.laser();
      }, i * 90);
    }
  },
  wizard: (p) => {
    // 隕石: 相手の上空から落下
    const opp = (p === p1) ? p2 : p1;
    const tx = Math.max(80, Math.min(STAGE_W - 80, opp.x + opp.w / 2 - 30));
    projectiles.push(new Projectile({
      owner: p,
      x: tx, y: -80,
      vx: 0, vy: 3,
      type: 'meteor',
      damage: 24,
      life: 280,
      knockbackBonus: 1.6,
      strong: true,
    }));
    sfx.fireball();
  },
  sumo: (p) => {
    // 土俵入り: 大ジャンプ → 落下 → 着地時に画面全体の衝撃波
    p.vy = -20;
    p.invincible = Math.max(p.invincible, 30);
    setTimeout(() => {
      if (gameState !== 'playing' || p.stocks <= 0) return;
      p.vy = 32;
    }, 320);
    setTimeout(() => {
      if (gameState !== 'playing' || p.stocks <= 0) return;
      shake(18, 40);
      sfx.ko();
      // 場全体に当たる超広範囲ボックス
      p.attackBox = {
        offsetX: -200, offsetY: 30,
        w: 440, h: 28,
        damage: 18 * p.character.atkMul,
        kbBonus: 1.4, life: 14,
        hit: false, rehit: 0, multihit: false,
        dir: 'up', strong: true,
      };
      p.attackCooldown = 50;
      // 砂煙
      for (let i = 0; i < 50; i++) {
        const a = Math.random() * Math.PI - Math.PI;
        addParticle({
          x: p.x + p.w/2, y: p.y + p.h - 4,
          vx: Math.cos(a) * (3 + Math.random() * 6),
          vy: Math.sin(a) * 2 - Math.random() * 3,
          life: 36, maxLife: 36, size: 5 + Math.random() * 3,
          color: i % 2 ? '#daa520' : '#fff',
          shape: 'rect', gravity: 0.32,
        });
      }
    }, 700);
  },
  pirate: (p) => {
    // 大砲: 巨大砲弾を射出
    projectiles.push(new Projectile({
      owner: p,
      x: p.x + (p.facing === 1 ? p.w : -40),
      y: p.y + 18,
      vx: 7 * p.facing, vy: 0,
      type: 'cannonball',
      damage: 26,
      life: 140,
      knockbackBonus: 1.7,
      strong: true,
    }));
    p.vx -= p.facing * 6; // 大反動
    sfx.fireball();
    // マズルフラッシュ
    addParticle({
      x: p.x + (p.facing === 1 ? p.w + 10 : -10),
      y: p.y + 20, vx: 0, vy: 0,
      life: 18, maxLife: 18, size: 50,
      color: '#ffd86b', shape: 'flash', gravity: 0,
    });
  },
  dragon: (p) => {
    // 業火のブレス: 連続炎を吐き続ける
    let count = 0;
    const interval = setInterval(() => {
      if (count++ >= 12 || gameState !== 'playing' || p.stocks <= 0) {
        clearInterval(interval);
        return;
      }
      for (let i = 0; i < 4; i++) {
        const ang = (Math.random() - 0.5) * 0.4;
        const speed = 8 + Math.random() * 3;
        projectiles.push(new Projectile({
          owner: p,
          x: p.x + (p.facing === 1 ? p.w : -10),
          y: p.y + 16 + (Math.random() - 0.5) * 10,
          vx: Math.cos(ang) * speed * p.facing,
          vy: Math.sin(ang) * speed,
          type: 'flame',
          damage: 5,
          life: 22,
          knockbackBonus: 0.7,
        }));
      }
      if (count % 3 === 0) sfx.fireball();
    }, 60);
  },
  alien: (p) => {
    // UFO: 上空から雨レーザー
    for (let i = 0; i < 7; i++) {
      setTimeout(() => {
        if (gameState !== 'playing' || p.stocks <= 0) return;
        const x = 100 + Math.random() * (STAGE_W - 200);
        projectiles.push(new Projectile({
          owner: p,
          x, y: -60,
          vx: 0, vy: 13,
          type: 'plasma',
          damage: 9,
          life: 70,
          knockbackBonus: 0.9,
        }));
        // 警告マーカー
        addParticle({
          x: x + 11, y: 30,
          vx: 0, vy: 0, life: 14, maxLife: 14,
          size: 30, color: '#a040ff', shape: 'flash', gravity: 0,
        });
        sfx.laser();
      }, i * 110);
    }
  },
  boxer: (p) => {
    // コーナーラッシュ: 前方ダッシュ + 多段ヒット連打
    p.x += p.facing * 24;
    p.invincible = Math.max(p.invincible, 30);
    p.attackBox = {
      offsetX: p.facing === 1 ? p.w - 4 : -66,
      offsetY: 8,
      w: 70, h: 50,
      damage: 5 * p.character.atkMul,
      kbBonus: 0.6, life: 40,
      hit: false, rehit: 0, multihit: true,
      dir: 'side', strong: false,
    };
    p.attackCooldown = 60;
    sfx.weakHit();
    // 拳の残像 (赤いリング連打)
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        if (gameState !== 'playing' || p.stocks <= 0) return;
        addParticle({
          x: p.x + (p.facing === 1 ? p.w + 20 : -20),
          y: p.y + 32,
          vx: 0, vy: 0, life: 12, maxLife: 12, size: 24,
          color: '#ff7733', shape: 'ring', gravity: 0,
        });
        if (i % 2 === 0) sfx.weakHit();
      }, i * 50);
    }
  },
  icemage: (p) => {
    // 大吹雪: 6連扇状の氷弾
    for (let i = 0; i < 6; i++) {
      const t = (i / 5) - 0.5;
      const ang = t * 0.7;
      const speed = 6;
      projectiles.push(new Projectile({
        owner: p,
        x: p.x + (p.facing === 1 ? p.w : -10),
        y: p.y + 20 + t * 12,
        vx: Math.cos(ang) * speed * p.facing,
        vy: Math.sin(ang) * speed,
        type: 'ice',
        damage: 10,
        life: 100,
        knockbackBonus: 1.0,
      }));
    }
    sfx.shuriken();
    // 雪の結晶パーティクル
    for (let i = 0; i < 24; i++) {
      addParticle({
        x: p.x + p.w/2, y: p.y + p.h/2,
        vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
        life: 36, maxLife: 36, size: 4 + Math.random() * 3,
        color: '#cdf4ff', shape: 'rect', gravity: 0.05,
      });
    }
  },
  vampire: (p) => {
    // 黒の宴: 大型吸血ヒットボックス (周囲広範囲・多段ヒット・自ダメージ吸収)
    p.invincible = Math.max(p.invincible, 30);
    p.attackBox = {
      offsetX: -50, offsetY: -20,
      w: p.w + 100, h: p.h + 40,
      damage: 4 * p.character.atkMul,
      kbBonus: 0.5, life: 50,
      hit: false, rehit: 0, multihit: true,
      dir: 'side', strong: false,
      lifesteal: 4,
    };
    p.attackCooldown = 70;
    sfx.shieldBreak();
    // 黒い渦 + 中央フラッシュ
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      addParticle({
        x: p.x + p.w/2, y: p.y + p.h/2,
        vx: Math.cos(ang) * 4, vy: Math.sin(ang) * 4,
        life: 36, maxLife: 36, size: 6,
        color: '#aa2050', shape: 'streak', gravity: 0,
      });
    }
    addParticle({
      x: p.x + p.w/2, y: p.y + p.h/2,
      vx: 0, vy: 0, life: 50, maxLife: 50, size: 100,
      color: '#aa2050', shape: 'flash', gravity: 0,
    });
  },
  samurai: (p) => {
    // 一閃: 高速・大型の貫通斬撃波
    projectiles.push(new Projectile({
      owner: p,
      x: p.x + (p.facing === 1 ? p.w : -64),
      y: p.y + 18,
      vx: 14 * p.facing, vy: 0,
      type: 'sword_wave',
      damage: 24,
      life: 80,
      knockbackBonus: 1.6,
      strong: true,
    }));
    p.invincible = Math.max(p.invincible, 20);
    sfx.strongHit();
    // 縦の閃光
    for (let i = 0; i < 4; i++) {
      addParticle({
        x: p.x + (p.facing === 1 ? p.w + 5 : -5),
        y: p.y + 5 + i * 14,
        vx: 0, vy: 0, life: 18, maxLife: 18, size: 30,
        color: '#fff', shape: 'flash', gravity: 0,
      });
    }
  },
};

// =============================================================
// 飛び道具 (Projectile)
// =============================================================
const projectiles = [];

class Projectile {
  constructor({ owner, x, y, vx, vy, type, damage, life = 90, homing = 0, wave = null, knockbackBonus = 0.7, strong = false, lifesteal = 0 }) {
    this.owner = owner;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.baseVy = vy;
    this.type = type;
    this.damage = damage;
    this.life = life;
    this.homing = homing;
    this.wave = wave;
    this.t = 0;
    this.knockbackBonus = knockbackBonus;
    this.strong = strong;
    this.lifesteal = lifesteal;
    this.alive = true;
    this.rot = 0;
    if (type === 'laser')          { this.w = 28; this.h = 6; }
    else if (type === 'fireball')  { this.w = 22; this.h = 22; }
    else if (type === 'flame')     { this.w = 18; this.h = 18; }
    else if (type === 'plasma')    { this.w = 22; this.h = 22; }
    else if (type === 'bullet')    { this.w = 12; this.h = 4; }
    else if (type === 'missile')   { this.w = 16; this.h = 6; }
    else if (type === 'meteor')    { this.w = 60; this.h = 60; }
    else if (type === 'cannonball'){ this.w = 32; this.h = 32; }
    else if (type === 'ice')       { this.w = 18; this.h = 18; }
    else if (type === 'bat')       { this.w = 18; this.h = 12; }
    else if (type === 'slash')     { this.w = 36; this.h = 14; }
    else if (type === 'sword_wave'){ this.w = 64; this.h = 20; }
    else                           { this.w = 14; this.h = 14; }
  }
  update(opponent) {
    this.t++;
    if (this.homing > 0) {
      const tx = opponent.x + opponent.w / 2;
      const ty = opponent.y + opponent.h / 2;
      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      const dx = tx - cx, dy = ty - cy;
      const len = Math.hypot(dx, dy) || 1;
      this.vx += (dx / len) * this.homing;
      this.vy += (dy / len) * this.homing;
      const sp = Math.hypot(this.vx, this.vy);
      const maxSp = this.type === 'missile' ? 9 : 7;
      if (sp > maxSp) { this.vx *= maxSp / sp; this.vy *= maxSp / sp; }
    }
    if (this.wave) {
      this.vy = this.baseVy + Math.sin(this.t * this.wave.freq) * this.wave.amp;
    }
    if (this.type === 'meteor' || this.type === 'cannonball') {
      this.vy += 0.18; // 重力
    }
    this.x += this.vx;
    this.y += this.vy;
    this.rot += 0.35;
    this.life--;

    // 軌跡パーティクル
    if ((this.type === 'fireball' || this.type === 'flame' || this.type === 'meteor') && Math.random() < 0.7) {
      addParticle({
        x: this.x + this.w / 2 + (Math.random() - 0.5) * 6,
        y: this.y + this.h / 2 + (Math.random() - 0.5) * 6,
        vx: -this.vx * 0.1, vy: -this.vy * 0.1 + 0.5,
        life: 16, maxLife: 16, size: 4 + Math.random() * 3,
        color: Math.random() < 0.5 ? '#ffaa30' : '#ff5020',
        shape: 'rect', gravity: -0.05,
      });
    } else if (this.type === 'laser' && Math.random() < 0.5) {
      addParticle({
        x: this.x + this.w / 2, y: this.y + this.h / 2,
        vx: 0, vy: 0, life: 6, maxLife: 6, size: 8,
        color: '#80ffff', shape: 'flash', gravity: 0,
      });
    } else if (this.type === 'plasma' && Math.random() < 0.5) {
      addParticle({
        x: this.x + this.w / 2, y: this.y + this.h / 2,
        vx: 0, vy: 0, life: 12, maxLife: 12, size: 10,
        color: '#a040ff', shape: 'flash', gravity: 0,
      });
    } else if (this.type === 'missile' && Math.random() < 0.6) {
      addParticle({
        x: this.x + this.w / 2 - this.vx * 0.5, y: this.y + this.h / 2 - this.vy * 0.5,
        vx: 0, vy: 0, life: 14, maxLife: 14, size: 5,
        color: '#cccccc', shape: 'rect', gravity: 0.05,
      });
    } else if (this.type === 'ice' && Math.random() < 0.5) {
      addParticle({
        x: this.x + this.w / 2 + (Math.random() - 0.5) * 6,
        y: this.y + this.h / 2 + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5,
        life: 18, maxLife: 18, size: 3 + Math.random() * 2,
        color: '#cdf4ff', shape: 'rect', gravity: 0.1,
      });
    } else if (this.type === 'slash' && Math.random() < 0.7) {
      addParticle({
        x: this.x + this.w / 2, y: this.y + this.h / 2,
        vx: 0, vy: 0, life: 8, maxLife: 8, size: 10,
        color: '#80ddff', shape: 'flash', gravity: 0,
      });
    } else if (this.type === 'sword_wave' && Math.random() < 0.9) {
      addParticle({
        x: this.x + this.w / 2 + (Math.random() - 0.5) * 12,
        y: this.y + this.h / 2 + (Math.random() - 0.5) * 12,
        vx: 0, vy: 0, life: 14, maxLife: 14, size: 12,
        color: Math.random() < 0.5 ? '#ffe070' : '#fff', shape: 'flash', gravity: 0,
      });
    }

    if (this.x < -50 || this.x > STAGE_W + 50 ||
        this.y > STAGE_H + 50 || this.y < -200 || this.life <= 0) {
      this.alive = false;
      return;
    }

    if (opponent.invincible <= 0 && hitTest(this, opponent)) {
      const cx = opponent.x + opponent.w / 2;
      const cy = opponent.y + opponent.h / 2;
      if (opponent.shielding && opponent.counterWindow > 0 && this.owner) {
        // ジャストガードで飛び道具を打ち消し、撃った相手へ反撃
        opponent.performCounter(this.owner, this.damage);
      } else if (opponent.shielding) {
        opponent.shieldHP = Math.max(0, opponent.shieldHP - this.damage * 1.5);
        sfx.shieldHit();
        spawnShieldRipple(opponent);
        if (opponent.shieldHP <= 0) {
          opponent.shieldBroken = 120;
          opponent.shielding = false;
          opponent.vy = -8;
          sfx.shieldBreak();
          spawnShieldBreak(opponent);
          shake(8, 24);
        }
      } else {
        const fakeAtk = {
          attackBox: { damage: this.damage, dir: 'side', kbBonus: this.knockbackBonus, strong: this.strong },
          facing: this.vx >= 0 ? 1 : -1,
        };
        opponent.takeHit(fakeAtk);
        if (this.owner) {
          this.owner.hitCount = Math.min(5, (this.owner.hitCount || 0) + 1);
          this.owner.onAttackHit(this.type);
          // 氷使いの freeze: ice 系の弾が当たったら相手に減速付与
          const ownerSp = this.owner.character.special || {};
          if (ownerSp.freeze && this.type === 'ice') {
            opponent.slowFrames = Math.max(opponent.slowFrames, ownerSp.freeze);
            addParticle({
              x: opponent.x + opponent.w/2, y: opponent.y + opponent.h/2,
              vx: 0, vy: 0, life: 30, maxLife: 30, size: 60,
              color: '#80ddff', shape: 'flash', gravity: 0,
            });
          }
        }
        if (this.lifesteal && this.owner) {
          this.owner.damage = Math.max(0, this.owner.damage - this.lifesteal);
        }
        const big = this.type === 'fireball' || this.type === 'meteor' || this.type === 'cannonball'
                 || this.type === 'sword_wave' || this.type === 'ice';
        spawnHitSpark(cx, cy, big, 'side');
        if (big) sfx.strongHit();
        else sfx.weakHit();
        shake(big ? 8 : 2, big ? 16 : 8);
      }
      this.alive = false;
    }
  }
  draw() {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (this.type === 'shuriken') {
      ctx.rotate(this.rot);
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(-7, -2, 14, 4);
      ctx.fillRect(-2, -7, 4, 14);
      ctx.fillStyle = '#ffd86b';
      ctx.fillRect(-2, -2, 4, 4);
    } else if (this.type === 'fireball') {
      const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, this.w);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.35, '#ffd060');
      grad.addColorStop(0.75, '#ff5020');
      grad.addColorStop(1, 'rgba(255,40,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'laser') {
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.fillStyle = 'rgba(120,255,255,0.35)';
      ctx.fillRect(-this.w / 2 - 4, -this.h, this.w + 8, this.h * 2);
      ctx.fillStyle = '#80ffff';
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-this.w / 2, -this.h / 4, this.w, this.h / 2);
    } else if (this.type === 'flame') {
      const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, this.w);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.3, '#ffe060');
      grad.addColorStop(0.7, '#ff5020');
      grad.addColorStop(1, 'rgba(120,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 1.4 * (this.life / 18 + 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'plasma') {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.w);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.4, '#80ffe0');
      grad.addColorStop(0.8, '#a040ff');
      grad.addColorStop(1, 'rgba(60,0,120,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'bullet') {
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.fillStyle = '#444';
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      ctx.fillStyle = '#ffd86b';
      ctx.fillRect(this.w / 2 - 2, -this.h / 2, 2, this.h);
    } else if (this.type === 'missile') {
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.fillStyle = '#bbb';
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(this.w / 2 - 4, -this.h / 2, 4, this.h);
      ctx.fillStyle = '#ffd86b';
      ctx.beginPath();
      ctx.moveTo(this.w / 2, 0);
      ctx.lineTo(this.w / 2 + 4, -this.h);
      ctx.lineTo(this.w / 2 + 4, this.h);
      ctx.closePath();
      ctx.fill();
    } else if (this.type === 'meteor') {
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, this.w);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#ffe080');
      grad.addColorStop(0.7, '#ff4020');
      grad.addColorStop(1, 'rgba(80,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2);
      ctx.fill();
      // 核
      ctx.fillStyle = '#1a0500';
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'cannonball') {
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#555';
      ctx.beginPath();
      ctx.arc(-4, -4, this.w / 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'ice') {
      // 氷の結晶 (淡い光 + 十字 + 斜め)
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.w);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.5, '#cdf4ff');
      grad.addColorStop(1, 'rgba(80,180,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#80ddff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-this.w/2, 0); ctx.lineTo(this.w/2, 0);
      ctx.moveTo(0, -this.w/2); ctx.lineTo(0, this.w/2);
      ctx.moveTo(-this.w/3, -this.w/3); ctx.lineTo(this.w/3, this.w/3);
      ctx.moveTo(-this.w/3, this.w/3); ctx.lineTo(this.w/3, -this.w/3);
      ctx.stroke();
    } else if (this.type === 'bat') {
      // 蝙蝠 (羽ばたき)
      const flap = Math.sin(this.t * 0.5) * 4;
      ctx.fillStyle = '#1a0a14';
      ctx.fillRect(-3, -3, 6, 6);
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(-10, -3 - flap);
      ctx.lineTo(-7, 3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.lineTo(10, -3 - flap);
      ctx.lineTo(7, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff3030';
      ctx.fillRect(-2, -2, 1, 1);
      ctx.fillRect(1, -2, 1, 1);
    } else if (this.type === 'slash') {
      // 斬撃波 (細い三日月)
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.fillStyle = 'rgba(128,221,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w/2 + 4, this.h/2 + 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w/2, this.h/2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#80ddff';
      ctx.fillRect(-this.w/2, -2, this.w, 4);
    } else if (this.type === 'sword_wave') {
      // 一閃 (大型斬撃波)
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.fillStyle = 'rgba(255,224,112,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w/2 + 8, this.h/2 + 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe070';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w/2, this.h/2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-this.w/2, -3, this.w, 6);
    }
    ctx.restore();
  }
}

// =============================================================
// ハザード (オーナーレス・両プレイヤーに当たる動的ステージ要素)
// =============================================================
const hazards = [];

class Hazard {
  constructor({ x, y, vx, vy, type, damage, life, gravity = 0.22 }) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.type = type;
    this.damage = damage;
    this.life = life;
    this.gravity = gravity;
    this.alive = true;
    this.t = 0;
    if (type === 'lava')      { this.w = 26; this.h = 26; }
    else                       { this.w = 20; this.h = 20; }
  }
  update(p1, p2) {
    this.t++;
    this.vy += this.gravity;
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    // 軌跡パーティクル
    if (this.type === 'lava' && Math.random() < 0.6) {
      addParticle({
        x: this.x + this.w/2 + (Math.random() - 0.5) * 6,
        y: this.y + this.h/2,
        vx: (Math.random() - 0.5) * 1, vy: -1,
        life: 18, maxLife: 18, size: 4,
        color: Math.random() < 0.5 ? '#ff5020' : '#ffaa30',
        shape: 'rect', gravity: -0.05,
      });
    }
    // 両プレイヤーに当たり判定
    for (const p of [p1, p2]) {
      if (!this.alive || p.invincible > 0 || !hitTest(this, p)) continue;
      if (p.shielding) {
        p.shieldHP = Math.max(0, p.shieldHP - this.damage * 1.5);
        sfx.shieldHit();
        spawnShieldRipple(p);
        if (p.shieldHP <= 0) {
          p.shieldBroken = 120; p.shielding = false; p.vy = -8;
          sfx.shieldBreak(); spawnShieldBreak(p); shake(8, 24);
        }
      } else {
        const fakeAtk = {
          attackBox: { damage: this.damage, dir: 'side', kbBonus: 1.0, strong: true },
          facing: this.vx >= 0 ? 1 : -1,
        };
        p.takeHit(fakeAtk);
        spawnHitSpark(p.x + p.w/2, p.y + p.h/2, true, 'side');
        sfx.strongHit();
        shake(8, 18);
      }
      this.alive = false;
    }
    if (this.x < -60 || this.x > STAGE_W + 60 ||
        this.y > STAGE_H + 100 || this.life <= 0) {
      this.alive = false;
    }
  }
  draw() {
    ctx.save();
    ctx.translate(this.x + this.w/2, this.y + this.h/2);
    if (this.type === 'lava') {
      const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, this.w);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.3, '#ffd060');
      grad.addColorStop(0.7, '#ff4020');
      grad.addColorStop(1, 'rgba(80,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.w/1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a0500';
      ctx.beginPath();
      ctx.arc(0, 0, this.w/5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// =============================================================
// パーティクル / エフェクト
// =============================================================
const particles = [];
let shakeX = 0, shakeY = 0, shakeLife = 0;

function shake(power, life = 12) {
  if (power > shakeX) shakeX = power;
  if (life > shakeLife) shakeLife = life;
}

function addParticle(p) {
  particles.push(Object.assign({
    x: 0, y: 0, vx: 0, vy: 0,
    life: 20, maxLife: 20,
    size: 4, color: '#fff', shape: 'rect', gravity: 0.15,
    rot: 0, vrot: 0,
  }, p));
}

// 攻撃時の "斬撃アーク"
function spawnSlash(player, box) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const color = box.strong ? '#ffe070' : '#ffffff';
  const radius = Math.max(box.w, box.h) * 0.7;
  for (let i = 0; i < (box.strong ? 14 : 8); i++) {
    const t = (i / (box.strong ? 14 : 8)) - 0.5;
    const angle = t * Math.PI * 0.7;
    const dirX = player.facing * Math.cos(angle);
    const dirY = Math.sin(angle);
    addParticle({
      x: cx + dirX * radius * 0.3,
      y: cy + dirY * radius * 0.3,
      vx: dirX * (box.strong ? 7 : 5),
      vy: dirY * (box.strong ? 5 : 3) - 1,
      life: box.strong ? 16 : 10,
      maxLife: box.strong ? 16 : 10,
      size: box.strong ? 5 : 3,
      color,
      shape: 'streak',
      gravity: 0,
    });
  }
}

// 上/下攻撃の方向別エフェクト
function spawnDirectionalSlash(player, box, dir) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const isUp = dir === 'up';
  const color = isUp ? '#a0ffa0' : '#e0a0ff';
  for (let i = 0; i < 12; i++) {
    const ang = -Math.PI / 2 + (i / 12 - 0.5) * Math.PI * 0.9 + (isUp ? 0 : Math.PI);
    const speed = box.strong ? 6 : 4;
    addParticle({
      x: cx, y: cy,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 14, maxLife: 14,
      size: box.strong ? 5 : 4,
      color,
      shape: 'streak',
      gravity: 0,
    });
  }
}

// ヒット時の火花 + 衝撃マーク
function spawnHitSpark(x, y, strong, dir) {
  // 中央フラッシュ
  addParticle({
    x, y, vx: 0, vy: 0,
    life: strong ? 14 : 8, maxLife: strong ? 14 : 8,
    size: strong ? 38 : 24,
    color: strong ? '#fff' : '#fffbe0',
    shape: 'flash',
    gravity: 0,
  });
  // 火花
  const count = strong ? 18 : 10;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2;
    const speed = (strong ? 6 : 3.5) + Math.random() * 2;
    addParticle({
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: strong ? 22 : 14,
      maxLife: strong ? 22 : 14,
      size: 3 + Math.random() * 2,
      color: strong ? '#ff7733' : '#ffe070',
      shape: 'rect',
      gravity: 0.25,
    });
  }
  // 強攻撃: 衝撃波リング
  if (strong) {
    addParticle({
      x, y, vx: 0, vy: 0,
      life: 18, maxLife: 18,
      size: 10,
      color: '#fff',
      shape: 'ring',
      gravity: 0,
    });
  }
  // 上下攻撃のカラー追加
  if (dir === 'up') {
    addParticle({ x, y, vx: 0, vy: -2, life: 18, maxLife: 18, size: 28, color: '#a0ffa0', shape: 'flash' });
  } else if (dir === 'spike' || dir === 'sweep') {
    addParticle({ x, y, vx: 0, vy: 1, life: 18, maxLife: 18, size: 28, color: '#e0a0ff', shape: 'flash' });
  }
}

// シールドガード時のリップル
function spawnShieldRipple(player) {
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  addParticle({
    x: cx, y: cy, vx: 0, vy: 0,
    life: 18, maxLife: 18,
    size: player.w,
    color: '#a0e8ff',
    shape: 'ring',
    gravity: 0,
  });
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    addParticle({
      x: cx + Math.cos(ang) * player.w * 0.6,
      y: cy + Math.sin(ang) * player.w * 0.6,
      vx: Math.cos(ang) * 3,
      vy: Math.sin(ang) * 3,
      life: 14, maxLife: 14,
      size: 3,
      color: '#cdf4ff',
      shape: 'rect',
      gravity: 0,
    });
  }
}

// ジャストガード成功時の閃光 (金 + 白)
function spawnCounterFlash(player) {
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  addParticle({
    x: cx, y: cy, vx: 0, vy: 0, life: 20, maxLife: 20,
    size: player.w * 2.2, color: '#fff', shape: 'flash', gravity: 0,
  });
  addParticle({
    x: cx, y: cy, vx: 0, vy: 0, life: 26, maxLife: 26,
    size: player.w * 1.5, color: '#ffd86b', shape: 'ring', gravity: 0,
  });
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2;
    const speed = 4 + Math.random() * 4;
    addParticle({
      x: cx, y: cy,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      life: 22, maxLife: 22, size: 4,
      color: i % 2 ? '#fff' : '#ffd86b', shape: 'rect', gravity: 0.05,
    });
  }
}

// シールドブレイクの破片散らし
function spawnShieldBreak(player) {
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  for (let i = 0; i < 24; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 5;
    addParticle({
      x: cx, y: cy,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 2,
      life: 40, maxLife: 40,
      size: 4 + Math.random() * 3,
      color: '#a0e8ff',
      shape: 'shard',
      gravity: 0.35,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.4,
    });
  }
  addParticle({
    x: cx, y: cy, vx: 0, vy: 0,
    life: 22, maxLife: 22, size: 50, color: '#ffffff', shape: 'flash', gravity: 0,
  });
}

// KO時の爆発 (player風オブジェクト or {x,y,w,h})
function spawnKO(target) {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  for (let i = 0; i < 40; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 8;
    addParticle({
      x: cx, y: cy,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 50, maxLife: 50,
      size: 4 + Math.random() * 4,
      color: i % 3 === 0 ? '#fff' : (i % 3 === 1 ? '#ffd86b' : '#ff6b6b'),
      shape: 'rect',
      gravity: 0.2,
    });
  }
  addParticle({ x: cx, y: cy, vx: 0, vy: 0, life: 26, maxLife: 26, size: 80, color: '#fff', shape: 'flash' });
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.rot += p.vrot;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
  if (shakeLife > 0) { shakeLife--; shakeX *= 0.85; }
  else shakeX = 0;
}

function drawParticles() {
  for (const p of particles) {
    const t = p.life / p.maxLife; // 1 → 0
    ctx.save();
    ctx.globalAlpha = Math.max(0, t);
    if (p.shape === 'flash') {
      // 中心に向けて減衰する円
      const r = p.size * (1 - t * 0.4);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 'ring') {
      const r = p.size * (1.5 - t);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * t + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.shape === 'streak') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 1.5, p.y - p.vy * 1.5);
      ctx.stroke();
    } else if (p.shape === 'shard') {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
}

// =============================================================
// ステージ
// =============================================================
function drawStage() {
  const bg = currentStage.bg;
  // 背景の塗り
  ctx.fillStyle = bg.sky;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  // プラットフォーム
  for (const plat of currentStage.platforms) {
    if (plat._state === 'gone') continue;
    let drawX = plat.x;
    let drawY = plat.y;
    let alpha = 1;
    if (plat._state === 'cracking') {
      drawX += (Math.random() - 0.5) * 4;
      drawY += (Math.random() - 0.5) * 2;
      alpha = 0.6 + Math.sin(plat._timer * 0.4) * 0.3;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = bg.platTop;
    ctx.fillRect(drawX, drawY, plat.w, plat.h);
    ctx.fillStyle = bg.platShadow;
    ctx.fillRect(drawX, drawY + plat.h, plat.w, 4);
    // 崩壊間際の亀裂
    if (plat._state === 'cracking') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(drawX + plat.w * 0.3, drawY + 2, 2, plat.h - 4);
      ctx.fillRect(drawX + plat.w * 0.6, drawY + 4, 2, plat.h - 6);
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = '#ff333322';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, STAGE_W, STAGE_H);
}

// =============================================================
// キャラクター選択画面
// =============================================================
const SELECT_CTRL = {
  p1: { left:'a', right:'d', up:'w', down:'s', confirm:'f', cancel:'q' },
  p2: { left:'arrowleft', right:'arrowright', up:'arrowup', down:'arrowdown', confirm:'/', cancel:'enter' },
};
const SELECT_COLS = 4;
let p1Char = 0, p2Char = 1;
let p1Confirmed = false, p2Confirmed = false;
let cd1 = 0, cd2 = 0;

function startSelect() {
  gameState = 'select';
  p1Char = 0; p2Char = 1;
  p1Confirmed = false; p2Confirmed = false;
  cd1 = 0; cd2 = 0;
  projectiles.length = 0;
  hazards.length = 0;
  particles.length = 0;
  document.getElementById('message').textContent = '';
  resetHUD();
  stopBGM();
  setTouchVisible(false);
}

function navigatePlayer(playerNum) {
  const ctrl = playerNum === 1 ? SELECT_CTRL.p1 : SELECT_CTRL.p2;
  let char = playerNum === 1 ? p1Char : p2Char;
  let confirmed = playerNum === 1 ? p1Confirmed : p2Confirmed;
  let cd = playerNum === 1 ? cd1 : cd2;
  const cols = SELECT_COLS;
  const total = CHARACTERS.length;
  const rows = Math.ceil(total / cols);

  if (cd <= 0) {
    if (!confirmed) {
      let col = char % cols;
      let row = Math.floor(char / cols);
      if (keys[ctrl.left])       { col = (col + cols - 1) % cols; cd = 12; sfx.cursor(); }
      else if (keys[ctrl.right]) { col = (col + 1) % cols; cd = 12; sfx.cursor(); }
      else if (keys[ctrl.up])    { row = (row + rows - 1) % rows; cd = 12; sfx.cursor(); }
      else if (keys[ctrl.down])  { row = (row + 1) % rows; cd = 12; sfx.cursor(); }
      else if (keys[ctrl.confirm]) { confirmed = true; cd = 20; sfx.confirm(); }
      char = Math.min(total - 1, row * cols + col);
    } else {
      if (keys[ctrl.cancel]) { confirmed = false; cd = 18; sfx.cursor(); }
    }
  }
  cd--;

  if (playerNum === 1) { p1Char = char; p1Confirmed = confirmed; cd1 = cd; }
  else                 { p2Char = char; p2Confirmed = confirmed; cd2 = cd; }
}

function updateSelect() { /* タップ駆動 (handleSelectTap) */ }

// =============================================================
// ステージ選択画面 (両プレイヤー操作可・先に決定したほうで開始)
// =============================================================
let stageSelectIdx = 0;
let stageSelectCD = 0;

function startStageSelect() {
  gameState = 'stage_select';
  stageSelectIdx = 0;
  stageSelectCD = 12;
  stopBGM();
  setTouchVisible(false);
}

const STAGE_SELECT_COLS = 4;

function updateStageSelect() { /* タップ駆動 (handleStageTap) */ }

function drawStageSelect() {
  ctx.fillStyle = '#11121a';
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px -apple-system, "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('STAGE SELECT', STAGE_W/2, 28);

  const total = STAGES.length;
  const cols = STAGE_SELECT_COLS;
  const rows = Math.ceil(total / cols);
  const slotW = 180, slotH = 195, gap = 6;
  const totalW = slotW * cols + gap * (cols - 1);
  const totalH = slotH * rows + gap * (rows - 1);
  const startX = (STAGE_W - totalW) / 2;
  const startY = 46;

  // プレビュースケール (800x600 → 156x80)
  const pvW = 156, pvH = 80;
  const sx2px = pvW / STAGE_W;
  const sy2py = pvH / STAGE_H;

  stageCells = [];
  STAGES.forEach((stage, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const sx = startX + col * (slotW + gap);
    const sy = startY + row * (slotH + gap);
    stageCells.push({ x: sx, y: sy, w: slotW, h: slotH, idx: i });
    // パネル
    ctx.fillStyle = '#22243a';
    ctx.fillRect(sx, sy, slotW, slotH);
    ctx.strokeStyle = '#333a55';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, slotW, slotH);
    // プレビュー
    const pvX = sx + (slotW - pvW) / 2;
    const pvY = sy + 10;
    ctx.fillStyle = stage.bg.sky;
    ctx.fillRect(pvX, pvY, pvW, pvH);
    for (const plat of stage.platforms) {
      ctx.fillStyle = stage.bg.platTop;
      ctx.fillRect(
        pvX + plat._origX * sx2px,
        pvY + plat._origY * sy2py,
        plat.w * sx2px,
        Math.max(2, plat.h * sy2py),
      );
    }
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(pvX, pvY, pvW, pvH);
    // 名前 (動的バッジ付)
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(stage.name, sx + slotW/2, sy + 110);
    if (stage.dynamic) {
      ctx.fillStyle = '#ff8060';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('▶ DYNAMIC', sx + slotW/2, sy + 125);
    }
    // 情報
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#aab';
    ctx.fillText(`プラットフォーム: ${stage.platforms.length}`, sx + slotW/2, sy + 145);
    ctx.fillStyle = '#dc8';
    ctx.fillText(`♪ BPM: ${stage.bgm.bpm}`, sx + slotW/2, sy + 162);
    // 動的ステージの説明
    if (stage.dynamic) {
      ctx.fillStyle = '#fcc';
      ctx.font = '10px sans-serif';
      const hint = stage.id === 'moving' ? '足場が動く'
                 : stage.id === 'crumble' ? '踏むと崩れる'
                 : stage.id === 'volcano' ? '溶岩が噴出'
                 : '';
      ctx.fillText(hint, sx + slotW/2, sy + 180);
    }
  });

  const ctrlY = startY + totalH + 26;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#ffd86b';
  ctx.textAlign = 'center';
  ctx.fillText('▶ ステージをタップしてバトル開始', STAGE_W/2, ctrlY);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#e74c3c';
  ctx.fillText(`YOU: ${CHARACTERS[p1Char].name}`, STAGE_W/2 - 110, ctrlY + 26);
  ctx.fillStyle = '#eee';
  ctx.fillText('vs', STAGE_W/2, ctrlY + 26);
  ctx.fillStyle = '#3498db';
  ctx.fillText(`CPU: ${CHARACTERS[p2Char].name}`, STAGE_W/2 + 110, ctrlY + 26);
}

function drawSelect() {
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 24px -apple-system, "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CHARACTER SELECT', STAGE_W/2, 28);

  const cols = SELECT_COLS;
  const rows = Math.ceil(CHARACTERS.length / cols);
  const slotW = 180, slotH = 140, gap = 6;
  const totalW = slotW * cols;
  const totalH = slotH * rows + gap * (rows - 1);
  const startX = (STAGE_W - totalW) / 2;
  const startY = 46;

  selCells = [];
  CHARACTERS.forEach((char, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const sx = startX + col * slotW + 4;
    const sy = startY + row * (slotH + gap);
    const innerW = slotW - 8;
    selCells.push({ x: sx, y: sy, w: innerW, h: slotH, idx: i });
    // パネル
    ctx.fillStyle = i === p1Char ? '#2c3358' : '#22243a';
    ctx.fillRect(sx, sy, innerW, slotH);
    ctx.strokeStyle = '#333a55';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, innerW, slotH);
    // プレビュー
    char.draw(ctx, sx + innerW/2 - 20, sy + 10, 40, 60, 1, '#888aa0');
    // 名前
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(char.name, sx + innerW/2, sy + 84);
    // ステータス
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#aab';
    ctx.fillText(`SPD ${char.speed.toFixed(1)}  JMP ${char.jump.toFixed(1)}`, sx + innerW/2, sy + 98);
    ctx.fillText(`重 ${char.weight.toFixed(2)}  攻 ×${char.atkMul.toFixed(2)}`, sx + innerW/2, sy + 110);
    ctx.fillStyle = '#7c9';
    ctx.fillText(char.desc, sx + innerW/2, sy + 122);
    ctx.fillStyle = '#dc8';
    ctx.font = '10px sans-serif';
    ctx.fillText('必殺: ' + char.super, sx + innerW/2, sy + 134);
  });

  // 選択中キャラのハイライト枠 (YOU)
  const selCol = p1Char % cols, selRow = Math.floor(p1Char / cols);
  drawCursor(startX + selCol * slotW + 4, startY + selRow * (slotH + gap),
             slotW - 8, slotH, '#ffd86b', false, 'YOU', -3);

  // 決定ボタン
  const ctrlY = startY + totalH + 14;
  const bw = 320, bh = 48, bx = (STAGE_W - bw) / 2, by = ctrlY;
  selDecideBtn = { x: bx, y: by, w: bw, h: bh };
  ctx.fillStyle = '#ffb84d';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`▶ ${CHARACTERS[p1Char].name} でCPUと対戦`, STAGE_W/2, by + bh/2);
  ctx.textBaseline = 'alphabetic';

  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#aab';
  ctx.fillText('キャラをタップで選択 → ボタンで決定 (CPUはランダム)', STAGE_W/2, by + bh + 22);
}

function drawCursor(x, y, w, h, color, confirmed, label, offset) {
  ctx.strokeStyle = color;
  ctx.lineWidth = confirmed ? 5 : 3;
  ctx.strokeRect(x + offset, y + offset, w - offset * 2, h - offset * 2);
  ctx.fillStyle = color;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label + (confirmed ? ' READY!' : ''), x + 8 + offset, y + 16 + offset);
}

// =============================================================
// ゲーム本体
// =============================================================
let p1, p2, winnerLabel = '';

// =============================================================
// モバイル基盤: 仮想キー入力 + タッチ操作 + CPU AI + レスポンシブ
// -------------------------------------------------------------
// Player.update は keys[controls.xxx] を読むだけなので、各プレイヤーに
// 専用の「仮想キー名」を割り当て、タッチ/AI からその仮想キーを keys{} に
// 書き込むことで Player 本体を無改造のまま流用する。
// =============================================================
const P1_CONTROLS = { left:'p1l', right:'p1r', up:'p1u', down:'p1d', jump:'p1j',
                      attack:'p1a', strong:'p1s', shield:'p1sh', ranged:'p1rg', super:'p1sp' };
const P2_CONTROLS = { left:'p2l', right:'p2r', up:'p2u', down:'p2d', jump:'p2j',
                      attack:'p2a', strong:'p2s', shield:'p2sh', ranged:'p2rg', super:'p2sp' };

// --- タッチボタンの押下状態 ---
const touchBtn = { left:false, right:false, jump:false, attack:false, special:false };
let p1AtkHold = 0;   // 攻撃ボタンの連続押下フレーム数 (タップ=弱 / 長押し=強)

// --- 人間プレイヤー(P1)の入力を毎フレームまとめる ---
// シンプル4系統 (移動 / ジャンプ / 攻撃 / 必殺) を、内部の
// 弱・強・遠距離・上攻撃・下攻撃へ距離と状況で自動変換する。
function updateHumanInput() {
  if (!p1 || !p2) return;
  const C = P1_CONTROLS, me = p1, foe = p2;
  // 移動・ジャンプ・必殺 (タッチ + デスクトップ確認用キーボードを OR)
  keys[C.left]  = !!(touchBtn.left  || keys['a'] || keys['arrowleft']);
  keys[C.right] = !!(touchBtn.right || keys['d'] || keys['arrowright']);
  keys[C.jump]  = !!(touchBtn.jump  || keys['w'] || keys['arrowup'] || keys[' ']);
  keys[C.super] = !!(touchBtn.special || keys['b']);
  // 攻撃系は毎フレーム一旦リセット (シールドは simple モードでは未使用)
  keys[C.attack] = false; keys[C.strong] = false; keys[C.ranged] = false;
  keys[C.up] = false; keys[C.down] = false; keys[C.shield] = false;

  const atkHeld = touchBtn.attack || keys['f'] || keys['g'];
  if (atkHeld) {
    p1AtkHold++;
    const meCx = me.x + me.w/2, foeCx = foe.x + foe.w/2;
    const adx = Math.abs(foeCx - meCx);
    const dy = (foe.y + foe.h/2) - (me.y + me.h/2);
    // 攻撃中で移動入力がなければ相手を向く (攻撃を当てやすく)
    if (!keys[C.left] && !keys[C.right]) me.facing = (foeCx - meCx) >= 0 ? 1 : -1;
    if (adx > 95 && me.character.ranged) {
      keys[C.ranged] = true;                       // 遠ければ飛び道具
    } else {
      if (!me.onGround && dy > 40) keys[C.down] = true;   // 空中で相手が下 → メテオ
      else if (dy < -40) keys[C.up] = true;               // 相手が上 → 上攻撃
      if (p1AtkHold > 16) keys[C.strong] = true;          // 長押し → 強
      else keys[C.attack] = true;                          // タップ → 弱
    }
  } else {
    p1AtkHold = 0;
  }
}

// --- CPU (P2) ---
const ai = { jumpCD:0, actCD:0 };
function rnd(n){ return Math.floor(Math.random() * n); }
function clearP2Keys(){ for (const k in P2_CONTROLS) keys[P2_CONTROLS[k]] = false; }
function tickAI(){ if (ai.jumpCD > 0) ai.jumpCD--; if (ai.actCD > 0) ai.actCD--; }
function updateCPU(me, foe) {
  const P2 = P2_CONTROLS;
  clearP2Keys();
  if (!me || !foe || me.stocks <= 0 || foe.stocks <= 0) { tickAI(); return; }
  if (me.hitstun > 0 || me.shieldBroken > 0) { tickAI(); return; }
  const meCx = me.x + me.w/2, foeCx = foe.x + foe.w/2;
  const dx = foeCx - meCx, adx = Math.abs(dx);
  const dy = (foe.y + foe.h/2) - (me.y + me.h/2);
  const dir = dx >= 0 ? 1 : -1;
  if (adx < 150) me.facing = dir;
  const offSide = me.x < 50 || me.x > STAGE_W - 50 - me.w;
  const hasRanged = !!me.character.ranged;

  // 1) 場外なら復帰最優先
  if (offSide && !me.onGround) {
    keys[ me.x < STAGE_W/2 ? P2.right : P2.left ] = true;
    if (me.vy > 1 && ai.jumpCD <= 0) { keys[P2.jump] = true; ai.jumpCD = 20; }
    tickAI(); return;
  }
  // 2) 攻撃判断
  let attacked = false;
  if (ai.actCD <= 0) {
    if (adx < 82 && Math.abs(dy) < 72) {
      if (dy < -36) keys[P2.up] = true;
      else if (!me.onGround && dy > 36) keys[P2.down] = true;
      if (me.hitCount >= 5 && Math.random() < 0.7) keys[P2.super] = true;
      else if (foe.damage > 85 && Math.random() < 0.55) keys[P2.strong] = true;
      else keys[P2.attack] = true;
      ai.actCD = 16 + rnd(12); attacked = true;
    } else if (hasRanged && adx > 110 && adx < 440 && Math.abs(dy) < 150) {
      keys[P2.ranged] = true; ai.actCD = 12 + rnd(10); attacked = true;
    }
  }
  // 3) 間合い調整 (攻撃していないフレームのみ)
  if (!attacked) {
    const desired = hasRanged ? 210 : 60;
    if (adx > desired) keys[ dir > 0 ? P2.right : P2.left ] = true;
    else if (adx < 42) keys[ dir > 0 ? P2.left : P2.right ] = true;
  }
  // 4) 相手が上にいれば追従ジャンプ + たまに小ジャンプ
  if (me.onGround && ai.jumpCD <= 0) {
    if (foe.y < me.y - 55 && Math.random() < 0.08) { keys[P2.jump] = true; ai.jumpCD = 26; }
    else if (Math.random() < 0.012) { keys[P2.jump] = true; ai.jumpCD = 45; }
  }
  tickAI();
}

// =============================================================
// レスポンシブ表示 + タッチ UI 配線
// =============================================================
const stageWrap = document.getElementById('stage-wrap');
const touchEl = document.getElementById('touch');
function fitCanvas() {
  const topbar = document.getElementById('topbar');
  const availW = window.innerWidth;
  const availH = window.innerHeight - (topbar ? topbar.offsetHeight : 0) - 4;
  const scale = Math.min(availW / STAGE_W, availH / STAGE_H);
  const w = Math.max(1, Math.floor(STAGE_W * scale));
  const h = Math.max(1, Math.floor(STAGE_H * scale));
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  if (stageWrap) { stageWrap.style.width = w + 'px'; stageWrap.style.height = h + 'px'; }
}
window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 250));
function setTouchVisible(v) { if (touchEl) touchEl.style.display = v ? 'block' : 'none'; }

// タッチボタン (マルチタッチ対応の pointer イベント)
function bindButton(el, name) {
  if (!el) return;
  const on = e => { e.preventDefault(); touchBtn[name] = true; resumeAudio(); };
  const off = e => { e.preventDefault(); touchBtn[name] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
document.querySelectorAll('.tbtn').forEach(el => bindButton(el, el.dataset.btn));

const btnReset = document.getElementById('btn-reset');
const btnMute = document.getElementById('btn-mute');
if (btnReset) btnReset.addEventListener('click', () => startSelect());
if (btnMute) btnMute.addEventListener('click', () => {
  muted = !muted;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.18;
  btnMute.textContent = muted ? '🔇' : '🔊';
});

const helpEl = document.getElementById('help');
const btnHelp = document.getElementById('btn-help');
const btnHelpClose = document.getElementById('btn-help-close');
if (btnHelp) btnHelp.addEventListener('click', () => helpEl && helpEl.classList.remove('hidden'));
if (btnHelpClose) btnHelpClose.addEventListener('click', () => helpEl && helpEl.classList.add('hidden'));
if (helpEl) helpEl.addEventListener('click', e => { if (e.target === helpEl) helpEl.classList.add('hidden'); });

// --- canvas タップ (選択画面 / 決着画面) ---
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * STAGE_W,
    y: (e.clientY - r.top) / r.height * STAGE_H,
  };
}
function inRect(p, r) { return !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
let selCells = [], selDecideBtn = null, stageCells = [];
let cpuChar = 1;
function handleSelectTap(p) {
  for (const c of selCells) if (inRect(p, c)) { p1Char = c.idx; sfx.cursor(); return; }
  if (inRect(p, selDecideBtn)) {
    do { cpuChar = rnd(CHARACTERS.length); } while (cpuChar === p1Char);
    p2Char = cpuChar;
    sfx.confirm();
    startStageSelect();
  }
}
function handleStageTap(p) {
  for (const c of stageCells) if (inRect(p, c)) { currentStage = STAGES[c.idx]; sfx.confirm(); startGame(); return; }
}
canvas.addEventListener('pointerdown', e => {
  resumeAudio();
  const p = canvasPoint(e);
  if (gameState === 'select') handleSelectTap(p);
  else if (gameState === 'stage_select') handleStageTap(p);
  else if (gameState === 'gameover') startSelect();
});
fitCanvas();
setTouchVisible(false);

function startGame() {
  p1 = new Player(250, P1_CONTROLS, 'YOU', CHARACTERS[p1Char], '#e74c3c');
  p2 = new Player(550, P2_CONTROLS, 'CPU', CHARACTERS[p2Char], '#3498db');
  projectiles.length = 0;
  hazards.length = 0;
  hitstop = 0;
  resetStage(currentStage);
  stageFrame = 0;
  gameState = 'playing';
  winnerLabel = '';
  document.getElementById('message').textContent = '';
  startBGM(currentStage.bgm);
  setTouchVisible(true);
  fitCanvas();
}

function resetHUD() {
  document.querySelector('#p1-info .damage').textContent = '0%';
  document.querySelector('#p2-info .damage').textContent = '0%';
  document.querySelector('#p1-info .stocks').textContent = '♥♥♥';
  document.querySelector('#p2-info .stocks').textContent = '♥♥♥';
  document.querySelector('#p1-info .shield-fill').style.width = '100%';
  document.querySelector('#p2-info .shield-fill').style.width = '100%';
  document.querySelector('#p1-info .super-fill').style.width = '0%';
  document.querySelector('#p2-info .super-fill').style.width = '0%';
  document.querySelector('#p1-info .super-count').textContent = '0/5';
  document.querySelector('#p2-info .super-count').textContent = '0/5';
  document.querySelector('#p1-info .name').textContent = 'YOU';
  document.querySelector('#p2-info .name').textContent = 'CPU';
}
function updateHUD() {
  document.querySelector('#p1-info .name').textContent = 'YOU / ' + p1.character.name;
  document.querySelector('#p2-info .name').textContent = 'CPU / ' + p2.character.name;
  document.querySelector('#p1-info .damage').textContent = Math.floor(p1.damage) + '%';
  document.querySelector('#p2-info .damage').textContent = Math.floor(p2.damage) + '%';
  document.querySelector('#p1-info .stocks').textContent = '♥'.repeat(Math.max(0, p1.stocks));
  document.querySelector('#p2-info .stocks').textContent = '♥'.repeat(Math.max(0, p2.stocks));
  document.querySelector('#p1-info .shield-fill').style.width = p1.shieldHP + '%';
  document.querySelector('#p2-info .shield-fill').style.width = p2.shieldHP + '%';
  // 必殺技ゲージ (相手に当てたヒット数 / 5)
  const p1Super = Math.min(100, ((p1.hitCount || 0) / 5) * 100);
  const p2Super = Math.min(100, ((p2.hitCount || 0) / 5) * 100);
  const p1SF = document.querySelector('#p1-info .super-fill');
  const p2SF = document.querySelector('#p2-info .super-fill');
  p1SF.style.width = p1Super + '%';
  p2SF.style.width = p2Super + '%';
  p1SF.classList.toggle('ready', (p1.hitCount || 0) >= 5);
  p2SF.classList.toggle('ready', (p2.hitCount || 0) >= 5);
  document.querySelector('#p1-info .super-count').textContent = Math.min(5, p1.hitCount || 0) + '/5';
  document.querySelector('#p2-info .super-count').textContent = Math.min(5, p2.hitCount || 0) + '/5';
}

function loop() {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);

  if (gameState === 'select') {
    updateSelect();
    drawSelect();
  } else if (gameState === 'stage_select') {
    updateStageSelect();
    drawStageSelect();
  } else {
    // 画面シェイク
    const sx = (Math.random() - 0.5) * shakeX * 2;
    const sy = (Math.random() - 0.5) * shakeX * 2;
    ctx.save();
    ctx.translate(sx, sy);

    drawStage();
    if (gameState === 'playing' && hitstop > 0) {
      // カウンター成功などのフリーズ演出中は進行を止める (描画は継続)
      hitstop--;
    } else if (gameState === 'playing') {
      // ステージの動的更新 (動く足場・ハザード生成・崩壊タイマー)
      stageFrame++;
      if (currentStage.update) currentStage.update(currentStage, stageFrame);
      tickPlatformStates(currentStage);

      updateHumanInput();   // タッチ/キーボード → P1 仮想キー
      updateCPU(p2, p1);    // CPU AI → P2 仮想キー
      p1.update(p2);
      p2.update(p1);
      // 飛び道具更新
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        const target = proj.owner === p1 ? p2 : p1;
        proj.update(target);
        if (!proj.alive) projectiles.splice(i, 1);
      }
      // ハザード更新
      for (let i = hazards.length - 1; i >= 0; i--) {
        hazards[i].update(p1, p2);
        if (!hazards[i].alive) hazards.splice(i, 1);
      }
      if (p1.stocks <= 0 || p2.stocks <= 0) {
        gameState = 'gameover';
        winnerLabel = p1.stocks <= 0 ? 'CPU (' + p2.character.name + ') WIN!'
                                     : 'YOU (' + p1.character.name + ') WIN!';
        document.getElementById('message').textContent = winnerLabel + '   タップで再選択';
        stopBGM();
        sfx.win();
        setTouchVisible(false);
      }
    }
    p1.draw();
    p2.draw();
    projectiles.forEach(p => p.draw());
    hazards.forEach(h => h.draw());
    updateParticles();
    drawParticles();
    updateHUD();

    ctx.restore();
  }
  requestAnimationFrame(loop);
}

startSelect();
loop();
