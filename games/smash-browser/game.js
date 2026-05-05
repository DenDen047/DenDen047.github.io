// =============================================================
// Mini Smash Bros — character select + 4 chars + 4 way attacks
// =============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- ステージ定数 ---
const STAGE_W = 800;
const STAGE_H = 600;
const PLATFORM = { x: 150, y: 460, w: 500, h: 20 };
const GRAVITY = 0.6;
const FRICTION = 0.85;
const AIR_FRICTION = 0.96;
const MOVE_ACCEL = 0.9;

// =============================================================
// 入力管理
// =============================================================
const keys = {};
let muted = false;
let gameState = 'select'; // 'select' | 'playing' | 'gameover'

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

// =============================================================
// キャラクター定義 (パラメータ + 描画関数)
// =============================================================
const CHARACTERS = [
  { id: 'knight', name: '騎士',   speed: 5.0, jump: 12.0, weight: 1.30, atkMul: 1.10, draw: drawKnight,
    desc: '近接特化・最重量級',
    ranged: null },
  { id: 'ninja',  name: '忍者',   speed: 6.5, jump: 14.0, weight: 0.85, atkMul: 0.90, draw: drawNinja,
    desc: '俊足・手裏剣 3連射',
    ranged: { type: 'shuriken', count: 3, damage: 4, speed: 9, cooldown: 38, spread: 0.18, life: 80 } },
  { id: 'robot',  name: 'ロボ',   speed: 5.2, jump: 12.5, weight: 1.15, atkMul: 1.00, draw: drawRobot,
    desc: 'バランス・レーザー射撃',
    ranged: { type: 'laser', count: 1, damage: 8, speed: 12, cooldown: 50, spread: 0, life: 70 } },
  { id: 'wizard', name: '魔導士', speed: 4.8, jump: 13.5, weight: 0.95, atkMul: 1.15, draw: drawWizard,
    desc: '高威力・誘導火球',
    ranged: { type: 'fireball', count: 1, damage: 14, speed: 5, cooldown: 75, spread: 0, homing: 0.13, life: 110 } },
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
    this.invincible = initial ? 0 : 60;
    this.animPhase = 0;
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
    const canControl = this.hitstun <= 0 && this.shieldBroken <= 0;
    const MAX_RUN = this.character.speed;
    const JUMP_POWER = this.character.jump;

    // 防御判定 (接地中、攻撃クールダウン外、シールド HP あり)
    const wasShielding = this.shielding;
    this.shielding = canControl && this.onGround
      && keys[c.shield] && this.attackCooldown <= 0 && this.shieldHP > 0;
    if (this.shielding && !wasShielding) spawnShieldRipple(this);

    if (canControl && !this.shielding) {
      if (keys[c.left])  { this.vx -= MOVE_ACCEL; this.facing = -1; }
      if (keys[c.right]) { this.vx += MOVE_ACCEL; this.facing = 1; }
      if (keys[c.jump] && this.onGround) {
        this.vy = -JUMP_POWER;
        this.onGround = false;
        sfx.jump();
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

    // 物理
    this.vy += GRAVITY;
    this.vx *= this.onGround ? FRICTION : AIR_FRICTION;
    this.vx = Math.max(-15, Math.min(15, this.vx));
    if (canControl) this.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, this.vx));
    this.x += this.vx;
    this.y += this.vy;

    // 足場
    const wasAbove = (this.y + this.h - this.vy) <= PLATFORM.y;
    const overlapX = this.x + this.w > PLATFORM.x && this.x < PLATFORM.x + PLATFORM.w;
    if (overlapX && wasAbove && this.y + this.h >= PLATFORM.y && this.vy >= 0) {
      this.y = PLATFORM.y - this.h;
      this.vy = 0;
      this.onGround = true;
    } else if (this.y + this.h < PLATFORM.y) {
      this.onGround = false;
    } else if (!overlapX) {
      this.onGround = false;
    }

    // タイマー
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.hitstun > 0) this.hitstun--;
    if (this.invincible > 0) this.invincible--;

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
      if (!this.attackBox.hit && hitTest(this.attackBox, opponent) && opponent.invincible <= 0) {
        const a = this.attackBox;
        const hx = opponent.x + opponent.w / 2;
        const hy = opponent.y + opponent.h / 2;
        if (opponent.shielding) {
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
          if (a.dir === 'up') sfx.upHit();
          else if (a.dir === 'down' || a.dir === 'spike' || a.dir === 'sweep') sfx.downHit();
          else if (a.strong) sfx.strongHit();
          else sfx.weakHit();
          spawnHitSpark(hx, hy, a.strong, a.dir);
          shake(a.strong ? 7 : 2, a.strong ? 18 : 6);
        }
        this.attackBox.hit = true;
      }
      if (this.attackBox.life <= 0) this.attackBox = null;
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
    const atk = this.character.atkMul;
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
      this.attackCooldown = strong ? 42 : 22;
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
      this.attackCooldown = strong ? 42 : 22;
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
      this.attackCooldown = strong ? 45 : 22;
      if (strong) this.vx -= this.facing * 1.5;
    }
    this.attackBox = box;
  }
  syncAttackBox() {
    if (!this.attackBox) return;
    this.attackBox.x = this.x + this.attackBox.offsetX;
    this.attackBox.y = this.y + this.attackBox.offsetY;
  }
  fireRanged() {
    const r = this.character.ranged;
    if (!r) return;
    this.attackCooldown = r.cooldown;
    const baseX = this.x + (this.facing === 1 ? this.w + 2 : -10);
    const baseY = this.y + this.h / 2 - 4;
    for (let i = 0; i < r.count; i++) {
      const t = r.count > 1 ? (i / (r.count - 1)) - 0.5 : 0;
      const angle = t * r.spread * 2;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const vx = cosA * r.speed * this.facing;
      const vy = sinA * r.speed;
      projectiles.push(new Projectile({
        owner: this,
        x: baseX, y: baseY,
        vx, vy,
        type: r.type,
        damage: r.damage,
        life: r.life,
        homing: r.homing || 0,
      }));
    }
    // 反動
    this.vx -= this.facing * (r.type === 'fireball' ? 2 : 0.6);
    // sfx + マズルフラッシュ
    if (r.type === 'fireball') sfx.fireball();
    else if (r.type === 'laser') sfx.laser();
    else sfx.shuriken();
    addParticle({
      x: baseX, y: baseY + 4,
      vx: 0, vy: 0,
      life: 10, maxLife: 10,
      size: r.type === 'fireball' ? 28 : 18,
      color: r.type === 'fireball' ? '#ffaa30' : (r.type === 'laser' ? '#80ffff' : '#fff'),
      shape: 'flash',
      gravity: 0,
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
    this.hitstun = 12 + Math.floor(this.damage / 20) + (a.strong ? 8 : 0);
  }
  draw() {
    const flicker = this.invincible > 0 && Math.floor(this.invincible / 4) % 2;
    if (flicker) ctx.globalAlpha = 0.4;
    const state = this.computeAnimState();
    this.character.draw(ctx, this.x, this.y, this.w, this.h, this.facing, this.tint, state);
    ctx.globalAlpha = 1;
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
// 飛び道具 (Projectile)
// =============================================================
const projectiles = [];

class Projectile {
  constructor({ owner, x, y, vx, vy, type, damage, life = 90, homing = 0 }) {
    this.owner = owner;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.type = type;
    this.damage = damage;
    this.life = life;
    this.homing = homing;
    this.alive = true;
    this.rot = 0;
    if (type === 'laser')         { this.w = 28; this.h = 6; }
    else if (type === 'fireball') { this.w = 22; this.h = 22; }
    else                          { this.w = 14; this.h = 14; } // shuriken
  }
  update(opponent) {
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
      const maxSp = 7;
      if (sp > maxSp) { this.vx *= maxSp / sp; this.vy *= maxSp / sp; }
    }
    this.x += this.vx;
    this.y += this.vy;
    this.rot += 0.35;
    this.life--;

    // 軌跡パーティクル
    if (this.type === 'fireball' && Math.random() < 0.6) {
      addParticle({
        x: this.x + this.w / 2 + (Math.random() - 0.5) * 4,
        y: this.y + this.h / 2 + (Math.random() - 0.5) * 4,
        vx: -this.vx * 0.1, vy: -this.vy * 0.1 + 0.5,
        life: 16, maxLife: 16, size: 4 + Math.random() * 2,
        color: Math.random() < 0.5 ? '#ffaa30' : '#ff6020',
        shape: 'rect', gravity: -0.05,
      });
    } else if (this.type === 'laser' && Math.random() < 0.5) {
      addParticle({
        x: this.x + this.w / 2, y: this.y + this.h / 2,
        vx: 0, vy: 0, life: 6, maxLife: 6, size: 8,
        color: '#80ffff', shape: 'flash', gravity: 0,
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
      if (opponent.shielding) {
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
        // takeHit が期待する形に擬似 attacker を組み立てる
        const fakeAtk = {
          attackBox: { damage: this.damage, dir: 'side', kbBonus: 0.7, strong: false },
          facing: this.vx >= 0 ? 1 : -1,
        };
        opponent.takeHit(fakeAtk);
        spawnHitSpark(cx, cy, this.type === 'fireball', 'side');
        if (this.type === 'fireball') sfx.strongHit();
        else sfx.weakHit();
        shake(this.type === 'fireball' ? 5 : 2, 8);
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
  ctx.fillStyle = '#3a3a5e';
  ctx.fillRect(PLATFORM.x, PLATFORM.y, PLATFORM.w, PLATFORM.h);
  ctx.fillStyle = '#222';
  ctx.fillRect(PLATFORM.x, PLATFORM.y + PLATFORM.h, PLATFORM.w, 4);
  ctx.strokeStyle = '#ff333322';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, STAGE_W, STAGE_H);
}

// =============================================================
// キャラクター選択画面
// =============================================================
const SELECT_CTRL = {
  p1: { left: 'a', right: 'd', confirm: 'f', cancel: 'q' },
  p2: { left: 'arrowleft', right: 'arrowright', confirm: '/', cancel: 'enter' },
};
let p1Char = 0, p2Char = 1;
let p1Confirmed = false, p2Confirmed = false;
let cd1 = 0, cd2 = 0;

function startSelect() {
  gameState = 'select';
  p1Char = 0; p2Char = 1;
  p1Confirmed = false; p2Confirmed = false;
  cd1 = 0; cd2 = 0;
  projectiles.length = 0;
  particles.length = 0;
  document.getElementById('message').textContent = '';
  resetHUD();
}

function navigatePlayer(playerNum) {
  const ctrl = playerNum === 1 ? SELECT_CTRL.p1 : SELECT_CTRL.p2;
  let char = playerNum === 1 ? p1Char : p2Char;
  let confirmed = playerNum === 1 ? p1Confirmed : p2Confirmed;
  let cd = playerNum === 1 ? cd1 : cd2;

  if (cd <= 0) {
    if (!confirmed) {
      if (keys[ctrl.left])  { char = (char + CHARACTERS.length - 1) % CHARACTERS.length; cd = 12; sfx.cursor(); }
      else if (keys[ctrl.right]) { char = (char + 1) % CHARACTERS.length; cd = 12; sfx.cursor(); }
      else if (keys[ctrl.confirm]) { confirmed = true; cd = 20; sfx.confirm(); }
    } else {
      if (keys[ctrl.cancel]) { confirmed = false; cd = 18; sfx.cursor(); }
    }
  }
  cd--;

  if (playerNum === 1) { p1Char = char; p1Confirmed = confirmed; cd1 = cd; }
  else                 { p2Char = char; p2Confirmed = confirmed; cd2 = cd; }
}

function updateSelect() {
  navigatePlayer(1);
  navigatePlayer(2);
  if (p1Confirmed && p2Confirmed) startGame();
}

function drawSelect() {
  // 背景タイトル
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px -apple-system, "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CHARACTER SELECT', STAGE_W/2, 70);

  const slotW = 150, slotH = 200;
  const totalW = slotW * CHARACTERS.length;
  const startX = (STAGE_W - totalW) / 2;
  const slotY = 140;

  CHARACTERS.forEach((char, i) => {
    const sx = startX + i * slotW + 8;
    // パネル
    ctx.fillStyle = '#22243a';
    ctx.fillRect(sx, slotY, slotW - 16, slotH);
    ctx.strokeStyle = '#333a55';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, slotY, slotW - 16, slotH);
    // プレビュー (中立色)
    char.draw(ctx, sx + slotW/2 - 28, slotY + 30, 40, 60, 1, '#888aa0');
    // 名前
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(char.name, sx + (slotW-16)/2, slotY + 120);
    // ステータス
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#aab';
    ctx.fillText(`SPD ${char.speed.toFixed(1)}  JMP ${char.jump.toFixed(1)}`, sx + (slotW-16)/2, slotY + 145);
    ctx.fillText(`重さ ${char.weight.toFixed(2)}  攻撃 ×${char.atkMul.toFixed(2)}`, sx + (slotW-16)/2, slotY + 162);
    ctx.fillStyle = '#7a8';
    ctx.fillText(char.desc, sx + (slotW-16)/2, slotY + 185);
  });

  // カーソル
  drawCursor(startX + p1Char * slotW + 8, slotY, slotW - 16, slotH, '#e74c3c', p1Confirmed, 'P1', -3);
  drawCursor(startX + p2Char * slotW + 8, slotY, slotW - 16, slotH, '#3498db', p2Confirmed, 'P2',  3);

  // 操作説明
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e74c3c';
  ctx.fillText('P1: A / D で選択   F で決定   Q でキャンセル', STAGE_W/2, 410);
  ctx.fillStyle = '#3498db';
  ctx.fillText('P2: ← / → で選択   / で決定   Enter でキャンセル', STAGE_W/2, 432);
  ctx.fillStyle = '#999';
  ctx.fillText('両プレイヤーが「決定」するとバトル開始', STAGE_W/2, 470);
  if (p1Confirmed && !p2Confirmed) {
    ctx.fillStyle = '#ffd86b';
    ctx.fillText('P2 の決定待ち...', STAGE_W/2, 500);
  } else if (!p1Confirmed && p2Confirmed) {
    ctx.fillStyle = '#ffd86b';
    ctx.fillText('P1 の決定待ち...', STAGE_W/2, 500);
  }
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

function startGame() {
  p1 = new Player(250,
    { left:'a', right:'d', up:'w', down:'s', jump:'w', attack:'f', strong:'g', shield:'q', ranged:'h' },
    'P1', CHARACTERS[p1Char], '#e74c3c');
  p2 = new Player(550,
    { left:'arrowleft', right:'arrowright', up:'arrowup', down:'arrowdown',
      jump:'arrowup', attack:'/', strong:'.', shield:'enter', ranged:"'" },
    'P2', CHARACTERS[p2Char], '#3498db');
  projectiles.length = 0;
  gameState = 'playing';
  winnerLabel = '';
  document.getElementById('message').textContent = '';
}

function resetHUD() {
  document.querySelector('#p1-info .damage').textContent = '0%';
  document.querySelector('#p2-info .damage').textContent = '0%';
  document.querySelector('#p1-info .stocks').textContent = '♥♥♥';
  document.querySelector('#p2-info .stocks').textContent = '♥♥♥';
  document.querySelector('#p1-info .shield-fill').style.width = '100%';
  document.querySelector('#p2-info .shield-fill').style.width = '100%';
  document.querySelector('#p1-info .name').textContent = 'P1';
  document.querySelector('#p2-info .name').textContent = 'P2';
}
function updateHUD() {
  document.querySelector('#p1-info .name').textContent = 'P1 / ' + p1.character.name;
  document.querySelector('#p2-info .name').textContent = 'P2 / ' + p2.character.name;
  document.querySelector('#p1-info .damage').textContent = Math.floor(p1.damage) + '%';
  document.querySelector('#p2-info .damage').textContent = Math.floor(p2.damage) + '%';
  document.querySelector('#p1-info .stocks').textContent = '♥'.repeat(Math.max(0, p1.stocks));
  document.querySelector('#p2-info .stocks').textContent = '♥'.repeat(Math.max(0, p2.stocks));
  document.querySelector('#p1-info .shield-fill').style.width = p1.shieldHP + '%';
  document.querySelector('#p2-info .shield-fill').style.width = p2.shieldHP + '%';
}

function loop() {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);

  if (gameState === 'select') {
    updateSelect();
    drawSelect();
  } else {
    // 画面シェイク
    const sx = (Math.random() - 0.5) * shakeX * 2;
    const sy = (Math.random() - 0.5) * shakeX * 2;
    ctx.save();
    ctx.translate(sx, sy);

    drawStage();
    if (gameState === 'playing') {
      p1.update(p2);
      p2.update(p1);
      // 飛び道具更新
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        const target = proj.owner === p1 ? p2 : p1;
        proj.update(target);
        if (!proj.alive) projectiles.splice(i, 1);
      }
      if (p1.stocks <= 0 || p2.stocks <= 0) {
        gameState = 'gameover';
        winnerLabel = p1.stocks <= 0 ? 'P2 (' + p2.character.name + ') WIN!'
                                     : 'P1 (' + p1.character.name + ') WIN!';
        document.getElementById('message').textContent = winnerLabel + '   R キーで再選択';
        sfx.win();
      }
    }
    p1.draw();
    p2.draw();
    projectiles.forEach(p => p.draw());
    updateParticles();
    drawParticles();
    updateHUD();

    ctx.restore();
  }
  requestAnimationFrame(loop);
}

startSelect();
loop();
