// =============================================================================
// ストリート・ファイト
//   2D 対戦格闘。コマンド入力の必殺技（波動拳/昇龍拳/竜巻旋風脚/スーパー）、
//   弱強パンチ・キック、立ち/しゃがみ/ジャンプ別の通常技、高/中/下段ガード、
//   投げ、ノックダウン、スーパーゲージ、2本先取のラウンド制を 60fps 固定ステップで実装。
//   1P vs CPU（AI）／2P 対戦。バニラ JS + Canvas、ビルド不要。
// =============================================================================

// -------- Canvas / 定数 -----------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;     // 960
const H = canvas.height;    // 540
const GROUND_Y = 472;       // 足が乗るライン
const STAGE_L = 70;         // 中心 x の左端
const STAGE_R = W - 70;     // 中心 x の右端
const DT = 1 / 60;

const GRAVITY = 0.86;       // px/frame^2
const JUMP_V = 15.4;        // ジャンプ初速
const PUSH_HW = 28;         // 押し合いボックスの半幅
const ROUND_TIME = 99;      // ラウンド開始カウント
const ROUNDS_TO_WIN = 2;    // 2本先取

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sign = (v) => (v < 0 ? -1 : 1);
// 乱数は固定シードにせず Math.random でよい（ゲームプレイ用途）。
const rand = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

// -------- 入力レイヤ ---------------------------------------------------------
// rawKeys: 押しっぱなし集合。pressBuffer: 押下エッジを次スナップショットまで保持し、
// 1フレーム以内に押して離す高速タップを取りこぼさない（press は edge で確定）。
const rawKeys = new Set();
const pressBuffer = new Set();

const KEYMAP = {
  1: { left: "a", right: "d", up: "w", down: "s", punch: "f", kick: "g", special: "h" },
  2: { left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown", punch: "k", kick: "l", special: "'" },
};

function normKey(e) {
  let k = e.key.toLowerCase();
  if (k === " ") k = "space";
  return k;
}
window.addEventListener("keydown", (e) => {
  const k = normKey(e);
  // ゲームで使うキーはページスクロール等を抑止
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", "space", ",", "."].includes(k)) e.preventDefault();
  if (!rawKeys.has(k)) {     // オートリピートは無視（押下エッジのみ）
    pressBuffer.add(k);
    handleGlobalKey(k);
  }
  rawKeys.add(k);
});
window.addEventListener("keyup", (e) => rawKeys.delete(normKey(e)));   // pressBuffer は消さない（今フレーム分として消費）
window.addEventListener("blur", () => rawKeys.clear());

// 各固定ステップ頭で「今フレームに押されたキー」を確定（押下バッファを消費）
let pressedThisFrame = new Set();
function snapshotInput() {
  pressedThisFrame = new Set(pressBuffer);
  pressBuffer.clear();
}
const isDown = (k) => rawKeys.has(k);
const isPressed = (k) => pressedThisFrame.has(k);

// -------- ステートとオーバーレイ --------------------------------------------
const screen = { mode: "title" }; // title / charselect / fight / matchover
const messageEl = document.getElementById("message");

function showMessage(main, sub) {
  messageEl.innerHTML = sub ? `${main}<span class="sub">${sub}</span>` : main;
  messageEl.classList.add("show");
}
function hideMessage() { messageEl.classList.remove("show"); }

// -------- オーディオ（簡易シンセ） -------------------------------------------
const audio = { ctx: null, muted: false };
function ac() {
  if (!audio.ctx) {
    try { audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audio.ctx = null; }
  }
  // ユーザー操作後でないと suspended のことがあるので resume を試みる
  if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
  return audio.ctx;
}
function tone(freq, dur, type, vol, slideTo) {
  if (audio.muted) return;
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || "square";
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), c.currentTime + dur);
  g.gain.setValueAtTime((vol || 0.2), c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}
function noise(dur, vol) {
  if (audio.muted) return;
  const c = ac(); if (!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(); s.buffer = buf;
  const g = c.createGain(); g.gain.value = vol || 0.18;
  s.connect(g); g.connect(c.destination); s.start();
}
const sfx = {
  hitL: () => { tone(220, 0.08, "square", 0.22); noise(0.05, 0.12); },
  hitH: () => { tone(140, 0.13, "sawtooth", 0.3, 70); noise(0.08, 0.2); },
  block: () => { noise(0.06, 0.22); tone(520, 0.05, "square", 0.12); },
  whiff: () => { tone(380, 0.06, "sine", 0.06, 240); },
  jump: () => { tone(300, 0.1, "sine", 0.12, 520); },
  fire: () => { tone(180, 0.28, "sawtooth", 0.22, 520); },
  dp: () => { tone(260, 0.3, "square", 0.2, 760); },
  tatsu: () => { tone(420, 0.22, "square", 0.16, 180); },
  throw: () => { tone(160, 0.18, "square", 0.2, 90); noise(0.1, 0.16); },
  ko: () => { tone(90, 0.6, "sawtooth", 0.32, 40); },
  super: () => { tone(200, 0.6, "sawtooth", 0.3, 900); noise(0.3, 0.18); },
  meter: () => { tone(700, 0.06, "sine", 0.1, 1000); },
  ui: () => { tone(620, 0.05, "square", 0.12); },
};

// =============================================================================
// フレームデータ（共有テーブル）
//   hb（ヒットボックス）: x=中心からの前方オフセット, w=幅, y=足元基準の上端(負=上), h=高さ
//   kb（ノックバック）: ヒット時に相手へ与える {x, y}（x は攻撃者の向き基準）
//   guard: "mid"=中段 / "low"=下段(しゃがみG) / "high"=中段だが立ちG限定(ジャンプ攻撃)
// =============================================================================
const MOVES = {
  // ---- 立ち通常技 ----
  stLP: { kind: "normal", startup: 3, active: 3, recovery: 6, dmg: 4, chip: 0, hitstun: 12, blockstun: 8,
          guard: "mid", kb: { x: 3.0, y: 0 }, hb: { x: 18, w: 40, y: -118, h: 26 }, cancel: true, meter: 4 },
  stHP: { kind: "normal", startup: 6, active: 4, recovery: 13, dmg: 11, chip: 1, hitstun: 18, blockstun: 12,
          guard: "mid", kb: { x: 6.5, y: 0 }, hb: { x: 18, w: 58, y: -126, h: 30 }, cancel: true, meter: 8 },
  stLK: { kind: "normal", startup: 5, active: 4, recovery: 9, dmg: 5, chip: 0, hitstun: 13, blockstun: 9,
          guard: "mid", kb: { x: 4.0, y: 0 }, hb: { x: 22, w: 52, y: -82, h: 24 }, cancel: false, meter: 4 },
  stHK: { kind: "normal", startup: 8, active: 5, recovery: 16, dmg: 13, chip: 1, hitstun: 20, blockstun: 13,
          guard: "mid", kb: { x: 8.5, y: -3 }, hb: { x: 24, w: 66, y: -100, h: 34 }, cancel: false, meter: 9, knockdown: false },
  // ---- しゃがみ通常技 ----
  crLP: { kind: "normal", startup: 3, active: 3, recovery: 7, dmg: 4, chip: 0, hitstun: 12, blockstun: 8,
          guard: "mid", hb: { x: 18, w: 42, y: -64, h: 22 }, kb: { x: 3, y: 0 }, cancel: true, meter: 4, crouch: true },
  crHP: { kind: "normal", startup: 6, active: 5, recovery: 18, dmg: 10, chip: 1, hitstun: 16, blockstun: 11,
          guard: "mid", hb: { x: 12, w: 40, y: -132, h: 78 }, kb: { x: 3, y: -11 }, cancel: false, meter: 8, crouch: true, antiair: true },
  crLK: { kind: "normal", startup: 4, active: 3, recovery: 8, dmg: 4, chip: 0, hitstun: 12, blockstun: 8,
          guard: "low", hb: { x: 20, w: 48, y: -30, h: 22 }, kb: { x: 3, y: 0 }, cancel: true, meter: 4, crouch: true },
  crHK: { kind: "normal", startup: 8, active: 5, recovery: 22, dmg: 11, chip: 1, hitstun: 16, blockstun: 12,
          guard: "low", hb: { x: 26, w: 64, y: -24, h: 22 }, kb: { x: 7, y: -10 }, cancel: false, meter: 9, crouch: true, knockdown: true }, // 足払い
  // ---- ジャンプ通常技（中段＝立ちガード限定） ----
  jLP: { kind: "normal", startup: 3, active: 6, recovery: 4, dmg: 5, chip: 0, hitstun: 12, blockstun: 9,
         guard: "high", hb: { x: 14, w: 44, y: -96, h: 40 }, kb: { x: 3, y: 0 }, air: true, meter: 4 },
  jHP: { kind: "normal", startup: 6, active: 6, recovery: 6, dmg: 12, chip: 1, hitstun: 16, blockstun: 12,
         guard: "high", hb: { x: 14, w: 54, y: -100, h: 56 }, kb: { x: 4, y: 0 }, air: true, meter: 8 },
  jLK: { kind: "normal", startup: 4, active: 8, recovery: 4, dmg: 6, chip: 0, hitstun: 12, blockstun: 9,
         guard: "high", hb: { x: 18, w: 50, y: -80, h: 44 }, kb: { x: 3, y: 0 }, air: true, meter: 4 },
  jHK: { kind: "normal", startup: 7, active: 6, recovery: 6, dmg: 13, chip: 1, hitstun: 16, blockstun: 12,
         guard: "high", hb: { x: 20, w: 58, y: -86, h: 52 }, kb: { x: 4, y: 0 }, air: true, meter: 8 },
};

// 必殺技は強さ(L/H)とキャラ補正で挙動を変えるため、起動時に組み立てる。
// -------- キャラクター定義 ---------------------------------------------------
const CHARS = {
  ryu: {
    name: "リュウ", giColor: "#eef1f5", trim: "#c9402f", skin: "#f1c39a", hair: "#2a2118",
    walkF: 3.0, walkB: 2.4, maxHp: 150,
    fireballSpeed: 7.2, fireballDmg: { L: 9, H: 11 }, dpDmg: { L: 11, H: 15 }, tatsuDmg: { L: 8, H: 11 },
    tag: "バランス型・波動拳が強い",
  },
  ken: {
    name: "ケン", giColor: "#f7d34b", trim: "#b23018", skin: "#f3c79c", hair: "#e8b73d",
    walkF: 3.3, walkB: 2.6, maxHp: 150,
    fireballSpeed: 8.0, fireballDmg: { L: 7, H: 9 }, dpDmg: { L: 13, H: 18 }, tatsuDmg: { L: 9, H: 12 },
    tag: "前進速い・昇龍拳が強い", dpMultiHit: true,
  },
  chun: {
    name: "チュン", giColor: "#3a6fd6", trim: "#f3d34b", skin: "#f1c39a", hair: "#3a2a1a",
    walkF: 3.4, walkB: 2.8, maxHp: 140,
    fireballSpeed: 7.6, fireballDmg: { L: 8, H: 10 }, dpDmg: { L: 10, H: 13 }, tatsuDmg: { L: 10, H: 13 },
    tag: "機動力・蹴りが速い", fastKicks: true,
  },
};
const CHAR_IDS = Object.keys(CHARS);

// =============================================================================
// ファイター
// =============================================================================
function makeFighter(charId, side) {
  const c = CHARS[charId];
  return {
    charId, char: c, side,                 // side: "L" or "R"
    x: side === "L" ? 320 : W - 320,
    y: GROUND_Y, vx: 0, vy: 0,
    facing: side === "L" ? 1 : -1,
    grounded: true,
    hp: c.maxHp, maxHp: c.maxHp,
    meter: 0,
    state: "idle", stateFrame: 0,
    move: null, moveFrame: 0, moveHits: [],   // 当てた相手と再ヒット管理
    hitstun: 0, blockstun: 0, invuln: 0,
    crouch: false, blocking: false, blockLow: false,
    airActionUsed: false,
    facingLock: false,
    flash: 0,                                 // 被弾時の白フラッシュ
    roundWins: 0,
    comboHits: 0, comboDmg: 0,
    ai: null,
    // 投げ関連
    throwVictim: null, beingThrown: 0,
  };
}

// 現在の姿勢に応じた被弾ボックス（ワールド座標 AABB）
function hurtbox(f) {
  if (f.state === "knockdown") return { x: f.x - 30, y: GROUND_Y - 28, w: 60, h: 28 };
  if (!f.grounded) return { x: f.x - 24, y: f.y - 128, w: 48, h: 120 };
  if (f.crouch || (f.state === "crouch")) return { x: f.x - 26, y: f.y - 96, w: 52, h: 96 };
  return { x: f.x - 24, y: f.y - 152, w: 48, h: 152 };
}

// 現在の攻撃のヒットボックス（active 中のみ）。なければ null。
function hitbox(f) {
  const m = f.move;
  if (!m || !m.hb) return null;
  if (f.moveFrame < m.startup || f.moveFrame >= m.startup + m.active) return null;
  const hb = m.hb;
  const near = f.x + f.facing * hb.x;
  return {
    x: f.facing > 0 ? near : near - hb.w,
    y: f.y + hb.y,
    w: hb.w, h: hb.h,
  };
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// =============================================================================
// 技の起動
// =============================================================================
function canAct(f) {
  return ["idle", "walk", "crouch", "air"].includes(f.state) &&
    f.hitstun <= 0 && f.blockstun <= 0 && f.beingThrown <= 0;
}

// 2ボタン構成：punch / kick。姿勢ごとに用途のある技を自動選択。
//   立ち=主力、しゃがみP=対空の昇り突き、しゃがみK=足払い(下段)、空中=飛び込み(中段)。
function startNormal(f, button) {
  if (!canAct(f)) return false;
  let key;
  if (!f.grounded) {
    if (f.airActionUsed) return false;
    key = button === "punch" ? "jHP" : "jHK";
    f.airActionUsed = true;
  } else if (f.crouch) {
    key = button === "punch" ? "crHP" : "crHK";
  } else {
    key = button === "punch" ? "stHP" : "stHK";
  }
  enterMove(f, MOVES[key], key);
  return true;
}

// 必殺技を構築して起動（キャラ補正込み）。strength: "L"|"H"
function startSpecial(f, kind, strength) {
  const c = f.char;
  if (kind === "hadoken") {
    const m = { kind: "special", special: "hadoken", startup: 11, active: 1, recovery: 26,
      strength, meterWhiff: 6, noHit: true };
    enterMove(f, m, "hadoken");
    sfx.fire();
    return true;
  }
  if (kind === "shoryuken") {
    const dmg = c.dpDmg[strength];
    const m = { kind: "special", special: "shoryuken", startup: 3, active: 14, recovery: 22,
      strength, dmg, chip: 2, hitstun: 22, blockstun: 14, guard: "mid", knockdown: true,
      kb: { x: 3, y: -13 }, hb: { x: 6, w: 46, y: -150, h: 110 }, meter: 6, invuln: strength === "H" ? 8 : 6,
      multiHit: c.dpMultiHit ? 12 : 0 };
    enterMove(f, m, "shoryuken");
    f.vy = -(strength === "H" ? 15 : 12.5);
    f.vx = f.facing * 3.2;
    f.grounded = false;
    sfx.dp();
    return true;
  }
  if (kind === "tatsu") {
    const dmg = c.tatsuDmg[strength];
    const m = { kind: "special", special: "tatsu", startup: 5, active: 26, recovery: 16,
      strength, dmg, chip: 1, hitstun: 16, blockstun: 12, guard: "mid", knockdown: true,
      kb: { x: 7, y: -6 }, hb: { x: 0, w: 64, y: -110, h: 70 }, meter: 5, multiHit: 8 };
    enterMove(f, m, "tatsu");
    f.vx = f.facing * (strength === "H" ? 6.5 : 5.0);
    if (!f.grounded) { /* 空中竜巻も可 */ } else f.vy = -3;
    sfx.tatsu();
    return true;
  }
  if (kind === "super") {
    if (f.meter < 100) return false;
    f.meter = 0;
    const m = { kind: "special", special: "super", startup: 14, active: 1, recovery: 40, noHit: true };
    enterMove(f, m, "super");
    sfx.super();
    state.freeze = 18; // 演出の一瞬停止
    state.shake = 10;
    return true;
  }
  return false;
}

function startThrow(f) {
  if (!canAct(f) || !f.grounded) return false;
  const opp = other(f);
  const dist = Math.abs(opp.x - f.x);
  const facingRight = (opp.x - f.x) * f.facing > 0;
  if (dist <= 66 && facingRight && opp.grounded && opp.beingThrown <= 0 &&
      !["knockdown"].includes(opp.state)) {
    // 投げ成立（相手が打撃を出してない/出掛かりなら掴める。完全無敵技中は不可）
    if (opp.invuln > 0) { /* 無敵中は投げ抜け扱い */ }
    f.state = "throw"; f.stateFrame = 0; f.facingLock = true; f.vx = 0;
    f.throwVictim = opp;
    opp.beingThrown = 26; opp.state = "thrown"; opp.stateFrame = 0; opp.vx = 0; opp.vy = 0;
    sfx.throw();
    return true;
  }
  // 空振り投げ → パンチに化ける（スカし）
  return startNormal(f, "punch");
}

function enterMove(f, move, name) {
  f.move = move; f.moveName = name; f.moveFrame = 0; f.moveHits = [];
  f.state = "attack"; f.stateFrame = 0; f.facingLock = true;
  f.invuln = Math.max(f.invuln, move.invuln || 0);
  if (move.kind === "normal" && f.grounded && !move.air) f.vx = 0;
}

// =============================================================================
// 必殺技ボタン（コマンド入力なし）。向き入力で技を選ぶ。
//   無=波動拳 / 前=昇龍拳 / 後=竜巻旋風脚 / 下=真空波動拳(ゲージMAX、未満は波動拳)
// =============================================================================
function specialDir(f, km) {
  const fwd = f.facing > 0 ? "right" : "left";
  const back = f.facing > 0 ? "left" : "right";
  if (isDown(km.down)) return "down";
  if (isDown(km[fwd])) return "forward";
  if (isDown(km[back])) return "back";
  return "neutral";
}

function buttonSpecial(f, dir) {
  if (!canAct(f)) return false;
  if (dir === "forward") return startSpecial(f, "shoryuken", "H");
  if (dir === "back") return startSpecial(f, "tatsu", "H");
  if (dir === "down") return f.meter >= 100 ? startSpecial(f, "super", "H") : startSpecial(f, "hadoken", "H");
  return startSpecial(f, "hadoken", "H");
}

// ボタンが押された時：投げ → 必殺技 → 通常技 の優先で起動
function tryAttack(f, km) {
  if (!canAct(f)) return false;   // 硬直/技中はキャンセル不可（出掛かりの上書き防止）
  // 投げ（パンチ+キック 同時押し）
  if ((isPressed(km.punch) && isDown(km.kick)) || (isPressed(km.kick) && isDown(km.punch))) {
    return startThrow(f);
  }
  if (isPressed(km.special)) return buttonSpecial(f, specialDir(f, km));
  if (isPressed(km.punch)) return startNormal(f, "punch");
  if (isPressed(km.kick)) return startNormal(f, "kick");
  return false;
}

// =============================================================================
// 入力処理 → 移動/ガード/ジャンプ/しゃがみ
// =============================================================================
function readHuman(f, playerNum) {
  const km = KEYMAP[playerNum];
  applyGround(f, km);
  tryAttack(f, km);
}

function applyGround(f, km) {
  // 接地でニュートラル系のときだけ歩行/しゃがみ/ガード/ジャンプを反映
  if (!canAct(f)) { f.blocking = false; return; }
  const fwd = f.facing > 0 ? "right" : "left";
  const back = f.facing > 0 ? "left" : "right";
  const holdBack = isDown(km[back]);
  const holdDown = isDown(km.down);

  if (!f.grounded) { f.state = "air"; return; }

  // ジャンプ（上を押した瞬間）
  if (isDown(km.up)) {
    f.grounded = false; f.vy = -JUMP_V; f.airActionUsed = false;
    f.vx = isDown(km[fwd]) ? f.char.walkF * 1.05 * f.facing
         : isDown(km[back]) ? -f.char.walkB * 1.05 * f.facing : 0;
    f.state = "air"; sfx.jump();
    return;
  }

  f.crouch = holdDown;
  // ガード判定：後ろ入れ（相手が攻撃 active のときに有効化されるのは判定側で見る）
  f.blocking = holdBack;
  f.blockLow = holdBack && holdDown;

  if (holdDown) { f.state = "crouch"; f.vx = 0; return; }
  if (isDown(km[fwd])) { f.vx = f.char.walkF * f.facing; f.state = "walk"; }
  else if (isDown(km[back])) { f.vx = -f.char.walkB * f.facing; f.state = "walk"; }
  else { f.vx = 0; f.state = "idle"; }
}

// =============================================================================
// CPU AI
// =============================================================================
// react = 相手の攻撃に気づくまでの反応遅延フレーム（大きいほど鈍い）
// block = 1技につき1回だけ抽選するガード確率 / atkCD = 接近時の最短攻撃間隔(フレーム)
const AI_PRESET = {
  easy:   { react: 14, block: 0.22, aggro: 0.5, antiair: 0.15, special: 0.12, throw: 0.06, atkCD: 30 },
  normal: { react: 10, block: 0.36, aggro: 0.68, antiair: 0.28, special: 0.22, throw: 0.1, atkCD: 24 },
  hard:   { react: 5,  block: 0.70, aggro: 0.9, antiair: 0.62, special: 0.45, throw: 0.24, atkCD: 14 },
};

function initAI(f) {
  f.ai = { t: 0, intent: "approach", lastAttack: 0, aaTried: false, guardFor: null, willGuard: false };
}

function readAI(f) {
  const ai = f.ai, opp = other(f);
  ai.t++;
  // この手番の意思（移動/ジャンプ/ガード）と、必殺技/通常技の起動を決める
  let wantFwd = false, wantBack = false, wantDown = false, wantJump = false;
  const dist = Math.abs(opp.x - f.x);
  const cfg = state.aiCfg;

  if (opp.grounded) ai.aaTried = false;   // 着地で対空抽選フラグをリセット

  // 反応遅延つきの「相手が攻撃中」認識：react フレーム経過後にようやく気づく
  // （＝発生の速い技は反応が間に合わず通る／遅い技は見てから対応できる）
  const threat = opp.move && !opp.move.noHit &&
    opp.moveFrame >= cfg.react &&
    opp.moveFrame < opp.move.startup + opp.move.active + 4;
  // ガードするかは1技につき1回だけ抽選してコミット（毎フレーム抽選＝実質100%ガードを防ぐ）
  if (threat && ai.guardFor !== opp.move) { ai.guardFor = opp.move; ai.willGuard = chance(cfg.block); }
  const reactGuard = threat && ai.willGuard;

  if (canAct(f) && f.grounded) {
    // 対空：1回のジャンプにつき1回だけ抽選（毎フレーム抽選で必中化するのを防ぐ）
    if (!opp.grounded && opp.vy > 1 && dist < 130 && !ai.aaTried && ai.t - ai.lastAttack > 18) {
      ai.aaTried = true;
      if (chance(cfg.antiair)) { doAISpecial(f, "shoryuken", "H"); ai.lastAttack = ai.t; return; }
    }
    // 飛び道具が来ていたらガード or ジャンプ抜け（自分に向かって飛んでくる弾）
    const incoming = state.projectiles.find((p) =>
      p.owner !== f && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 360);
    if (incoming) {
      if (dist > 220 && chance(0.4)) { wantJump = true; wantFwd = true; }
      else { wantBack = true; }
    } else if (dist > 240) {
      // 遠距離：波動拳を撒きつつ基本は前進して間合いを詰める
      if (chance(cfg.special * 0.1) && ai.t - ai.lastAttack > 30) { doAISpecial(f, "hadoken", "H"); ai.lastAttack = ai.t; return; }
      wantFwd = true;
      if (chance(0.01)) wantJump = true;
    } else if (dist > 95) {
      // 中距離：ガードしないなら積極的に前進（時々飛び込み/竜巻）
      if (reactGuard) { wantBack = true; }
      else {
        wantFwd = true;
        if (chance(0.016 * cfg.aggro)) { wantJump = true; ai.intent = "jumpin"; }
        else if (chance(cfg.special * 0.04)) { doAISpecial(f, "tatsu", "L"); ai.lastAttack = ai.t; return; }
      }
    } else {
      // 近距離：打撃 / 投げ / ガード
      if (reactGuard) {
        wantBack = true; if (chance(0.5)) wantDown = true;
      } else if (ai.t - ai.lastAttack > cfg.atkCD) {
        const r = Math.random();
        if (r < cfg.throw) { startThrow(f); ai.lastAttack = ai.t; return; }
        else if (r < cfg.throw + 0.1 && chance(cfg.special * 0.6)) { doAISpecial(f, "shoryuken", "L"); ai.lastAttack = ai.t; return; }
        else { startNormal(f, chance(0.5) ? "kick" : "punch"); ai.lastAttack = ai.t; return; }
      }
    }
  } else if (!f.grounded && !f.airActionUsed && ai.intent === "jumpin") {
    // 飛び込み攻撃
    if (f.vy > -4 && dist < 140 && chance(0.25)) { startNormal(f, chance(0.5) ? "kick" : "punch"); }
  }

  // 決定した意思（want*）を移動/ジャンプ/ガードに反映
  if (wantJump && f.grounded && canAct(f)) {
    f.grounded = false; f.vy = -JUMP_V; f.airActionUsed = false;
    f.vx = wantFwd ? f.char.walkF * 1.05 * f.facing : wantBack ? -f.char.walkB * 1.05 * f.facing : 0;
    f.state = "air"; sfx.jump();
  } else if (f.grounded && canAct(f)) {
    f.crouch = wantDown;
    f.blocking = wantBack;
    f.blockLow = wantBack && wantDown;
    if (wantDown) { f.state = "crouch"; f.vx = 0; }
    else if (wantFwd) { f.vx = f.char.walkF * f.facing; f.state = "walk"; }
    else if (wantBack) { f.vx = -f.char.walkB * f.facing; f.state = "walk"; }
    else { f.vx = 0; f.state = "idle"; }
  }
}

// AI 用：必殺技を直接起動
function doAISpecial(f, kind, strength) { return startSpecial(f, kind, strength); }

// =============================================================================
// 物理・状態更新
// =============================================================================
function other(f) { return state.fighters[0] === f ? state.fighters[1] : state.fighters[0]; }

function updateFighter(f) {
  f.stateFrame++;
  if (f.flash > 0) f.flash--;
  if (f.invuln > 0) f.invuln--;

  // タイマー類
  if (f.hitstun > 0) { f.hitstun--; if (f.hitstun === 0 && f.grounded) endStun(f); }
  if (f.blockstun > 0) { f.blockstun--; if (f.blockstun === 0 && f.grounded) endStun(f); }
  if (f.beingThrown > 0) {
    f.beingThrown--;
    if (f.beingThrown === 0) { f.state = "knockdown"; f.stateFrame = 0; f.knockTimer = 28; f.vx = -f.facing * 4; f.vy = -6; f.grounded = false; }
  }

  // 攻撃の進行
  if (f.state === "attack" && f.move) {
    f.moveFrame++;
    const m = f.move;
    // 波動拳の弾生成（active 入りで一度だけ）
    if (m.special === "hadoken" && f.moveFrame === m.startup) spawnFireball(f, m.strength, false);
    if (m.special === "super" && f.moveFrame === m.startup) spawnFireball(f, "H", true);
    const total = m.startup + m.active + m.recovery;
    if (f.moveFrame >= total) {
      f.move = null; f.facingLock = false;
      f.state = f.grounded ? "idle" : "air";
      f.stateFrame = 0;
    }
  }

  // 投げ演出
  if (f.state === "throw") {
    if (f.stateFrame === 14 && f.throwVictim) {
      const v = f.throwVictim;
      v.state = "knockdown"; v.stateFrame = 0; v.knockTimer = 30;
      v.grounded = false; v.vx = -f.facing * 9; v.vy = -11; v.beingThrown = 0;
      const dmg = 14 + (f.char.name === "ケン" ? 2 : 0);
      damageRaw(v, dmg, f);
      f.throwVictim = null; state.shake = 6;
    }
    if (f.stateFrame >= 24) { f.state = "idle"; f.facingLock = false; }
  }

  // ノックダウン→起き上がり
  if (f.state === "knockdown") {
    if (f.grounded) {
      f.knockTimer--;
      f.vx *= 0.8;
      if (f.knockTimer <= 0) { f.state = "getup"; f.stateFrame = 0; f.invuln = 14; }
    }
  }
  if (f.state === "getup" && f.stateFrame >= 14) { f.state = "idle"; }

  // 重力・移動
  if (!f.grounded) {
    f.vy += GRAVITY;
    f.y += f.vy;
    f.x += f.vx;
    if (f.y >= GROUND_Y) {
      f.y = GROUND_Y; f.vy = 0; f.grounded = true;
      if (f.state === "air") { f.state = "idle"; }
      if (f.state === "attack" && f.move && (f.move.special === "tatsu" || f.move.special === "shoryuken")) {
        // 着地で必殺技の残りをキャンセル
        f.move = null; f.facingLock = false; f.state = "idle";
      }
      if (f.state === "knockdown") { f.vx = 0; f.knockTimer = Math.max(f.knockTimer, 22); }
      f.airActionUsed = false;
      state.shake = Math.max(state.shake, 2);
    }
  } else {
    // 地上水平移動（ヒットバック等の減衰）
    f.x += f.vx;
    if (["hitstun", "blockstun", "knockdown"].includes(f.state) || f.state === "idle" && Math.abs(f.vx) > 0.1) {
      f.vx *= 0.82;
      if (Math.abs(f.vx) < 0.15) f.vx = 0;
    }
  }

  // 向きの更新（自由に動ける時のみ相手の方へ）
  if (!f.facingLock && f.grounded && canAct(f)) {
    const opp = other(f);
    f.facing = opp.x >= f.x ? 1 : -1;
  }

  // ステージ端でクランプ
  f.x = clamp(f.x, STAGE_L, STAGE_R);
}

function endStun(f) {
  f.state = "idle"; f.vx = 0; f.comboHits = 0;
}

// =============================================================================
// 当たり判定・ダメージ
// =============================================================================
function resolveCombat() {
  const [a, b] = state.fighters;
  tryHit(a, b);
  tryHit(b, a);
  resolveProjectiles();
  pushApart(a, b);
}

function tryHit(att, def) {
  const m = att.move;
  if (!m || m.noHit || !m.hb) return;
  const hb = hitbox(att);
  if (!hb) return;

  // 多段技は一定間隔で再ヒット許可
  const last = att.moveHits.length ? att.moveHits[att.moveHits.length - 1] : -999;
  if (m.multiHit) {
    if (att.moveFrame - last < m.multiHit) return;
  } else {
    if (att.moveHits.length) return;
  }

  if (def.invuln > 0) return;
  const hurt = hurtbox(def);
  if (!aabb(hb, hurt)) return;

  att.moveHits.push(att.moveFrame);

  // ガード判定
  const blocked = isBlocking(def, att, m);
  const sparkX = clamp((hb.x + (hb.x + hb.w)) / 2, def.x - 30, def.x + 30);
  const sparkY = hb.y + hb.h / 2;

  if (blocked) {
    def.state = "blockstun"; def.blockstun = m.blockstun; def.stateFrame = 0;
    def.vx = att.facing * 2.6;
    if (m.chip) damageRaw(def, m.chip, att, true);
    def.meter = clamp(def.meter + 2, 0, 100);
    att.meter = clamp(att.meter + 1, 0, 100);
    spawnSpark(sparkX, sparkY, "block");
    sfx.block();
    state.shake = Math.max(state.shake, 2);
  } else {
    const heavy = m.dmg >= 10 || m.special;
    // コンボ補正：連続ヒットでダメージ漸減
    const inCombo = def.hitstun > 0 || def.state === "hitstun";
    if (inCombo) att.comboHits++; else att.comboHits = 1;
    const scale = att.comboHits <= 1 ? 1 : att.comboHits === 2 ? 0.9 : att.comboHits === 3 ? 0.75 : 0.6;
    const dmg = Math.max(1, Math.round(m.dmg * scale));
    damageRaw(def, dmg, att);
    def.meter = clamp(def.meter + 3, 0, 100);
    att.meter = clamp(att.meter + (m.meter || 4), 0, 100);

    const knock = m.knockdown || !def.grounded;
    def.hitstun = m.hitstun;
    def.vx = att.facing * m.kb.x;
    def.vy = m.kb.y || 0;
    if (m.kb.y) { def.grounded = false; }
    if (knock) {
      def.state = "knockdown"; def.knockTimer = 30; def.stateFrame = 0;
      if (def.grounded) { def.vy = -7; def.grounded = false; }
      def.vx = att.facing * Math.max(4, m.kb.x);
    } else {
      def.state = "hitstun"; def.stateFrame = 0;
    }
    def.flash = 4;
    spawnSpark(sparkX, sparkY, heavy ? "heavy" : "light");
    state.shake = Math.max(state.shake, heavy ? 7 : 4);
    if (heavy) state.freeze = Math.max(state.freeze, 3); else state.freeze = Math.max(state.freeze, 2);
    heavy ? sfx.hitH() : sfx.hitL();
  }
  updateComboDisplay(att, def, blocked);
}

// 相手の攻撃 m を正しくガードできているか
function isBlocking(def, att, m) {
  if (!def.blocking || !def.grounded) return false;
  if (!["idle", "walk", "crouch", "blockstun"].includes(def.state)) return false;
  // blocking フラグ自体が「相手と反対方向（後ろ）入れ」を表す（applyGround/readAI で設定）
  if (m.guard === "low" && !def.blockLow) return false;      // 下段はしゃがみガード必須
  if (m.guard === "high" && def.blockLow) return false;      // ジャンプ攻撃(中段)は立ちガード必須
  return true;
}

function damageRaw(f, dmg, by, isChip) {
  f.hp = clamp(f.hp - dmg, 0, f.maxHp);
  if (by && !isChip) { by.comboDmg += dmg; }
  if (f.hp <= 0 && !state.roundEnding) onKO(f, by);
}

let comboTimer = 0;
function updateComboDisplay(att, def, blocked) {
  if (!blocked && att.comboHits >= 2) {
    state.comboBy = att.side;
    state.comboCount = att.comboHits;
    comboTimer = 70;
  }
}

// =============================================================================
// 飛び道具
// =============================================================================
function spawnFireball(owner, strength, isSuper) {
  const c = owner.char;
  const spd = (isSuper ? c.fireballSpeed + 1.5 : c.fireballSpeed) * (strength === "H" ? 1.1 : 0.92);
  state.projectiles.push({
    owner, x: owner.x + owner.facing * 46, y: owner.y - 96,
    vx: owner.facing * spd, facing: owner.facing,
    dmg: isSuper ? 8 : c.fireballDmg[strength], chip: isSuper ? 3 : 2,
    hitstun: isSuper ? 16 : 14, blockstun: 12,
    isSuper, hitsLeft: isSuper ? 4 : 1, hitCD: 0, life: 200,
    r: isSuper ? 30 : 18, color: isSuper ? "#ffd33d" : (owner.charId === "ken" ? "#ff7a2f" : owner.charId === "chun" ? "#7ad0ff" : "#7ab8ff"),
    t: 0,
  });
}

function resolveProjectiles() {
  const ps = state.projectiles;
  for (const p of ps) {
    p.t++;
    p.x += p.vx; p.life--;
    if (p.hitCD > 0) p.hitCD--;
    if (p.x < -40 || p.x > W + 40 || p.life <= 0) p.dead = true;
  }
  // 弾同士の相殺（通常弾。スーパーは貫通）
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (a.dead || b.dead || a.owner === b.owner) continue;
      if (Math.abs(a.x - b.x) < (a.r + b.r) && Math.abs(a.y - b.y) < (a.r + b.r)) {
        if (a.isSuper && !b.isSuper) { b.dead = true; }
        else if (b.isSuper && !a.isSuper) { a.dead = true; }
        else { a.dead = true; b.dead = true; spawnSpark((a.x + b.x) / 2, a.y, "block"); }
      }
    }
  }
  // 命中
  for (const p of ps) {
    if (p.dead || p.hitCD > 0) continue;
    const def = other(p.owner);
    if (def.invuln > 0) continue;
    const hurt = hurtbox(def);
    const pb = { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
    if (!aabb(pb, hurt)) continue;
    const m = { guard: "mid", blockstun: p.blockstun };
    const blocked = isBlocking(def, p.owner, m);
    if (blocked) {
      def.state = "blockstun"; def.blockstun = p.blockstun; def.stateFrame = 0; def.vx = p.facing * 2.2;
      damageRaw(def, p.chip, p.owner, true);
      def.meter = clamp(def.meter + 2, 0, 100);
      spawnSpark(p.x, p.y, "block"); sfx.block();
    } else {
      damageRaw(def, p.dmg, p.owner);
      def.hitstun = p.hitstun; def.state = "hitstun"; def.stateFrame = 0;
      def.vx = p.facing * 6; def.flash = 4;
      def.meter = clamp(def.meter + 3, 0, 100); p.owner.meter = clamp(p.owner.meter + 3, 0, 100);
      spawnSpark(p.x, p.y, p.isSuper ? "heavy" : "light");
      state.shake = Math.max(state.shake, p.isSuper ? 6 : 4);
      p.owner.comboHits = Math.max(1, p.owner.comboHits);
      sfx.hitL();
    }
    p.hitsLeft--; p.hitCD = 8;
    if (p.hitsLeft <= 0) p.dead = true;
  }
  state.projectiles = ps.filter((p) => !p.dead);
}

// 押し合い（重ならないように）
function pushApart(a, b) {
  if (!a.grounded || !b.grounded) return;
  const dx = b.x - a.x;
  const overlap = PUSH_HW * 2 - Math.abs(dx);
  if (overlap > 0) {
    const push = overlap / 2;
    const dir = dx >= 0 ? 1 : -1;
    a.x -= dir * push; b.x += dir * push;
    a.x = clamp(a.x, STAGE_L, STAGE_R);
    b.x = clamp(b.x, STAGE_L, STAGE_R);
    // 片方が壁なら反対側を押し戻す
    if (a.x <= STAGE_L) b.x = clamp(a.x + PUSH_HW * 2, STAGE_L, STAGE_R);
    if (b.x >= STAGE_R) a.x = clamp(b.x - PUSH_HW * 2, STAGE_L, STAGE_R);
  }
}

// =============================================================================
// ヒットスパーク等エフェクト
// =============================================================================
function spawnSpark(x, y, type) {
  state.fx.push({ x, y, type, t: 0, life: type === "heavy" ? 16 : type === "block" ? 10 : 12,
    parts: Array.from({ length: type === "heavy" ? 10 : 6 }, () => ({
      a: rand(0, Math.PI * 2), s: rand(2, type === "heavy" ? 7 : 4),
    })) });
}
function updateFx() {
  for (const e of state.fx) e.t++;
  state.fx = state.fx.filter((e) => e.t < e.life);
}

// =============================================================================
// ラウンド / マッチ管理
// =============================================================================
const state = {
  fighters: [],
  projectiles: [],
  fx: [],
  frame: 0,
  round: 1,
  timer: ROUND_TIME, timerSub: 0,
  roundEnding: false, roundEndTimer: 0,
  matchOver: false, winnerSide: null,
  intro: 0,            // FIGHT! 演出
  shake: 0, freeze: 0,
  paused: false,
  comboBy: null, comboCount: 0,
  is2P: false,
  aiCfg: AI_PRESET.normal, aiLevel: "normal",
  lastTime: performance.now(), acc: 0,
};

function startMatch() {
  state.fighters = [
    makeFighter(state.pick[0], "L"),
    makeFighter(state.pick[1], "R"),
  ];
  state.fighters[0].playerNum = 1;
  if (state.is2P) state.fighters[1].playerNum = 2;
  else { initAI(state.fighters[1]); }
  state.fighters[0].roundWins = 0; state.fighters[1].roundWins = 0;
  state.round = 1; state.matchOver = false; state.winnerSide = null;
  screen.mode = "fight";
  startRound();
}

function startRound() {
  const [a, b] = state.fighters;
  Object.assign(a, { x: 320, y: GROUND_Y, vx: 0, vy: 0, hp: a.maxHp, grounded: true,
    state: "idle", move: null, hitstun: 0, blockstun: 0, invuln: 30, facing: 1, crouch: false,
    blocking: false, comboHits: 0, comboDmg: 0, facingLock: false, beingThrown: 0, knockTimer: 0 });
  Object.assign(b, { x: W - 320, y: GROUND_Y, vx: 0, vy: 0, hp: b.maxHp, grounded: true,
    state: "idle", move: null, hitstun: 0, blockstun: 0, invuln: 30, facing: -1, crouch: false,
    blocking: false, comboHits: 0, comboDmg: 0, facingLock: false, beingThrown: 0, knockTimer: 0 });
  if (b.ai) initAI(b);
  state.projectiles = []; state.fx = [];
  state.timer = ROUND_TIME; state.timerSub = 0;
  state.roundEnding = false; state.roundEndTimer = 0;
  state.intro = 130; state.comboBy = null; comboTimer = 0;
  showMessage(`ROUND ${state.round}`);
}

function onKO(loser, by) {
  if (state.roundEnding) return;
  state.roundEnding = true; state.roundEndTimer = 150;
  const winner = other(loser);
  winner.roundWins++;
  state.shake = 14; state.freeze = 20;
  sfx.ko();
  loser.state = "knockdown"; loser.knockTimer = 200; loser.grounded = false;
  loser.vy = -8; loser.vx = -loser.facing * 5;
  const matchPoint = winner.roundWins >= ROUNDS_TO_WIN;
  showMessage("K.O.", matchPoint ? `${winner.char.name} の勝利！` : `${winner.char.name} がラウンドを取った`);
  if (matchPoint) { state.matchOver = true; state.winnerSide = winner.side; }
}

function onTimeOver() {
  if (state.roundEnding) return;
  state.roundEnding = true; state.roundEndTimer = 150;
  const [a, b] = state.fighters;
  let winner, draw = false;
  if (a.hp > b.hp) winner = a; else if (b.hp > a.hp) winner = b; else draw = true;
  if (draw) {
    showMessage("引き分け", "両者ダウン");
    state.roundEndTimer = 120;
  } else {
    winner.roundWins++;
    const matchPoint = winner.roundWins >= ROUNDS_TO_WIN;
    showMessage("TIME UP", matchPoint ? `${winner.char.name} の勝利！` : `${winner.char.name} がラウンドを取った`);
    if (matchPoint) { state.matchOver = true; state.winnerSide = winner.side; }
  }
  sfx.ko();
}

function advanceRoundEnd() {
  state.roundEndTimer--;
  if (state.roundEndTimer <= 0) {
    hideMessage();
    if (state.matchOver) {
      screen.mode = "matchover";
      const w = state.fighters.find((f) => f.side === state.winnerSide);
      showMessage(`${w.char.name} WINS!`, "R でタイトルへ・Enter でもう一度");
    } else {
      state.round++;
      startRound();
    }
  }
}

// =============================================================================
// メインループ（固定タイムステップ）
// =============================================================================
function tickFight() {
  if (state.paused) return;
  if (state.freeze > 0) { state.freeze--; if (state.shake > 0) state.shake--; return; }
  state.frame++;

  // 入力
  for (const f of state.fighters) {
    if (state.intro > 60) { f.vx = 0; if (f.grounded) f.state = "idle"; continue; } // 演出中は動けない
    if (state.roundEnding) {
      // ラウンド終了中は勝者だけ勝ちポーズ、敗者はダウン継続
      updateFighter(f);
      continue;
    }
    if (f.playerNum) readHuman(f, f.playerNum);
    else if (f.ai) readAI(f);
    updateFighter(f);
  }

  if (!state.roundEnding && state.intro <= 60) resolveCombat();
  else { resolveProjectiles(); }

  updateFx();
  if (comboTimer > 0) comboTimer--;
  if (state.shake > 0) state.shake--;

  // イントロ演出
  if (state.intro > 0) {
    state.intro--;
    if (state.intro === 60) showMessage("FIGHT!");
    if (state.intro === 1) hideMessage();
  }

  // タイマー
  if (!state.roundEnding && state.intro <= 60) {
    state.timerSub++;
    if (state.timerSub >= 60) { state.timerSub = 0; state.timer--; if (state.timer <= 0) { state.timer = 0; onTimeOver(); } }
  }

  if (state.roundEnding) advanceRoundEnd();
}

function loop(now) {
  const dtMs = now - state.lastTime;
  state.lastTime = now;
  state.acc += dtMs;
  // 過大スパイク対策
  if (state.acc > 200) state.acc = 200;
  while (state.acc >= 1000 / 60) {
    snapshotInput();
    if (screen.mode === "fight") tickFight();
    else if (screen.mode === "title") tickTitle();
    else if (screen.mode === "charselect") tickCharSelect();
    else if (screen.mode === "matchover") tickMatchOver();
    state.acc -= 1000 / 60;
  }
  render();
  requestAnimationFrame(loop);
}

// =============================================================================
// メニュー（タイトル / キャラ選択 / マッチ終了）
// =============================================================================
const menu = { titleIndex: 0, diffIndex: 1, p1: 0, p2: 1, p1locked: false, p2locked: false, cursorBlink: 0 };
const DIFFS = ["easy", "normal", "hard"];
const DIFF_LABEL = { easy: "EASY", normal: "NORMAL", hard: "HARD" };

function handleGlobalKey(k) {
  if (k === "m") { audio.muted = !audio.muted; }
  if (screen.mode === "fight") {
    if (k === "p") state.paused = !state.paused;
    if (k === "r") gotoTitle();
  }
  if (screen.mode === "matchover") {
    if (k === "r") gotoTitle();
    if (k === "enter") { resetCharSelect(); screen.mode = "charselect"; hideMessage(); }
  }
}

function gotoTitle() {
  screen.mode = "title"; hideMessage(); state.paused = false;
}

function tickTitle() {
  menu.cursorBlink++;
  // 上下でモード、左右で難易度
  if (isPressed("w") || isPressed("arrowup")) { menu.titleIndex = (menu.titleIndex + 1) % 2; sfx.ui(); }
  if (isPressed("s") || isPressed("arrowdown")) { menu.titleIndex = (menu.titleIndex + 1) % 2; sfx.ui(); }
  if (menu.titleIndex === 0) {
    if (isPressed("a") || isPressed("arrowleft")) { menu.diffIndex = (menu.diffIndex + 2) % 3; sfx.ui(); }
    if (isPressed("d") || isPressed("arrowright")) { menu.diffIndex = (menu.diffIndex + 1) % 3; sfx.ui(); }
  }
  if (confirmPressed()) {
    state.is2P = menu.titleIndex === 1;
    state.aiLevel = DIFFS[menu.diffIndex];
    state.aiCfg = AI_PRESET[state.aiLevel];
    resetCharSelect();
    screen.mode = "charselect"; sfx.ui();
  }
}

function confirmPressed() {
  return isPressed("f") || isPressed("enter") || isPressed("space") || isPressed("k") || isPressed("g") || isPressed("l");
}

function resetCharSelect() {
  menu.p1 = 0; menu.p2 = 1; menu.p1locked = false; menu.p2locked = false;
  hideMessage();
}

function tickCharSelect() {
  menu.cursorBlink++;
  // P1 = WASD + F
  if (!menu.p1locked) {
    if (isPressed("a")) { menu.p1 = (menu.p1 + CHAR_IDS.length - 1) % CHAR_IDS.length; sfx.ui(); }
    if (isPressed("d")) { menu.p1 = (menu.p1 + 1) % CHAR_IDS.length; sfx.ui(); }
    if (isPressed("f") || isPressed("g")) { menu.p1locked = true; sfx.meter(); }
  } else if (isPressed("v") || isPressed("b")) { menu.p1locked = false; sfx.ui(); }

  // P2（2P時のみ手動。1Pなら CPU が選択）
  if (state.is2P) {
    if (!menu.p2locked) {
      if (isPressed("arrowleft")) { menu.p2 = (menu.p2 + CHAR_IDS.length - 1) % CHAR_IDS.length; sfx.ui(); }
      if (isPressed("arrowright")) { menu.p2 = (menu.p2 + 1) % CHAR_IDS.length; sfx.ui(); }
      if (isPressed("k") || isPressed("l")) { menu.p2locked = true; sfx.meter(); }
    } else if (isPressed(",") || isPressed(".")) { menu.p2locked = false; sfx.ui(); }
  } else {
    menu.p2locked = menu.p1locked; // CPU は P1 確定と同時に決定
    if (menu.p1locked) menu.p2 = Math.floor(rand(0, CHAR_IDS.length)); // ランダム（確定済みなら固定）
  }

  if (menu.p1locked && (state.is2P ? menu.p2locked : true)) {
    // CPU 用ランダムを一度だけ確定
    if (!state.is2P && state.pendingCpu == null) state.pendingCpu = menu.p2;
    const cpu = state.is2P ? menu.p2 : (state.pendingCpu ?? menu.p2);
    state.pick = [CHAR_IDS[menu.p1], CHAR_IDS[cpu]];
    state.pendingCpu = null;
    startMatch();
  }
}

function tickMatchOver() {
  // 入力は handleGlobalKey で処理（R/Enter）
}

// =============================================================================
// 描画
// =============================================================================
function render() {
  ctx.save();
  let sx = 0, sy = 0;
  if (state.shake > 0) { sx = rand(-state.shake, state.shake); sy = rand(-state.shake, state.shake) * 0.5; }
  ctx.translate(sx, sy);

  drawBackground();

  if (screen.mode === "title") { drawTitle(); ctx.restore(); return; }
  if (screen.mode === "charselect") { drawCharSelect(); ctx.restore(); return; }

  // 影 → ファイター → 弾 → エフェクト
  for (const f of state.fighters) drawShadow(f);
  // 手前に来るのは後ろ側のファイター。簡易に y で安定。両者地上なので順不同でOK
  for (const f of state.fighters) drawFighter(f);
  for (const p of state.projectiles) drawFireball(p);
  for (const e of state.fx) drawSpark(e);

  ctx.restore();
  drawHUD();
}

function drawBackground() {
  // 空グラデーション
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#3a2a6e");
  g.addColorStop(0.5, "#5a3a7a");
  g.addColorStop(1, "#c97a5a");
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // 遠景の街シルエット
  ctx.fillStyle = "#2a2150";
  for (let i = 0; i < 14; i++) {
    const bw = 70, bx = i * 70 - 10;
    const bh = 120 + ((i * 53) % 140);
    ctx.fillRect(bx, GROUND_Y - 60 - bh, bw - 8, bh);
  }
  // 太陽
  ctx.fillStyle = "#ffd98a";
  ctx.beginPath(); ctx.arc(W * 0.72, 150, 60, 0, Math.PI * 2); ctx.fill();

  // 地面
  ctx.fillStyle = "#6a4a35";
  ctx.fillRect(-20, GROUND_Y - 60, W + 40, H);
  ctx.fillStyle = "#5a3e2c";
  ctx.fillRect(-20, GROUND_Y - 4, W + 40, 8);
  // 床の格子
  ctx.strokeStyle = "#0000001f"; ctx.lineWidth = 2;
  for (let i = -1; i < 24; i++) {
    ctx.beginPath();
    const x = i * 60 + (state.frame * 0 % 60);
    ctx.moveTo(x, GROUND_Y); ctx.lineTo(x - 40, H); ctx.stroke();
  }
}

function drawShadow(f) {
  const sc = f.grounded ? 1 : clamp(1 - (GROUND_Y - f.y) / 320, 0.4, 1);
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(f.x, GROUND_Y + 2, 34 * sc, 9 * sc, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---- ファイター描画：簡易スケルトンをポーズで動かす ----
//   ローカル座標は pelvis を原点に [前方=+x, 下=+y]。
//   足の localY = ph（=pelvis の足元高さ）で足が地面に乗る。空中は f.y が浮くので自動で浮く。
function poseFor(f) {
  const m = f.move, fr = f.moveFrame;
  const crouching = f.state === "crouch" || (m && m.crouch);
  const airborne = !f.grounded;
  let ph, lean = 0;
  const p = {};

  if (crouching) {
    ph = 54;
    p.pelvis = [0, 0]; p.chest = [-2, -30]; p.head = [4, -50];
    p.handF = [16, -26]; p.elbowF = [10, -20];
    p.handB = [-12, -22]; p.elbowB = [-8, -18];
    p.footF = [24, ph]; p.kneeF = [22, ph * 0.55];
    p.footB = [-24, ph]; p.kneeB = [-20, ph * 0.55];
  } else if (airborne) {
    ph = 84;
    p.pelvis = [0, 0]; p.chest = [-2, -40]; p.head = [2, -62];
    p.handF = [16, -36]; p.elbowF = [10, -26];
    p.handB = [-14, -30]; p.elbowB = [-10, -24];
    p.footF = [14, ph - 30]; p.kneeF = [16, ph - 56];   // 膝を抱える
    p.footB = [-12, ph - 26]; p.kneeB = [-10, ph - 52];
  } else {
    ph = 88;
    p.pelvis = [0, 0]; p.chest = [-2, -42]; p.head = [2, -64];
    p.handF = [16, -34]; p.elbowF = [10, -24];
    p.handB = [-14, -28]; p.elbowB = [-10, -22];
    p.footF = [16, ph]; p.kneeF = [12, ph * 0.5];
    p.footB = [-18, ph]; p.kneeB = [-12, ph * 0.5];
    if (f.state === "walk") {
      const sw = Math.sin(state.frame * 0.3) * 7;
      p.footF = [16 + sw, ph]; p.footB = [-18 - sw, ph];
    }
  }

  const st = f.state;
  if (st === "knockdown" && f.grounded) return { fallen: true };
  if (st === "blockstun" || (f.blocking && st !== "attack")) {
    p.handF = [12, -42]; p.elbowF = [4, -32]; lean = -4;
  }
  if (st === "hitstun") { lean = -7; p.handF = [8, -18]; p.handB = [-16, -22]; }

  if (st === "attack" && m) {
    const ext = attackExtend(m, fr);
    if (m.kind === "normal" && m.hb) {
      // ヒットボックス中心を pelvis 基準ローカル座標へ変換し、そこへ手足を伸ばす
      const tx = m.hb.x + m.hb.w * 0.6;
      const ty = (m.hb.y + m.hb.h / 2) + ph;
      if (/K$/.test(f.moveName)) {       // キック（jLK/stHK 等、末尾 K）
        p.footF = [lerp(p.footF[0], tx, ext), lerp(p.footF[1], ty, ext)];
        p.kneeF = [lerp(p.kneeF[0], tx * 0.55, ext), lerp(p.kneeF[1], (ty + ph) * 0.4, ext)];
        lean = 3 * ext;
      } else {                            // パンチ
        p.handF = [lerp(p.handF[0], tx, ext), lerp(p.handF[1], ty, ext)];
        p.elbowF = [lerp(p.elbowF[0], tx * 0.5, ext), lerp(p.elbowF[1], ty + 4, ext)];
        lean = 3 * ext;
      }
    } else if (m.special === "hadoken") {
      const e = clamp(fr / m.startup, 0, 1);
      p.handF = [lerp(2, 30, e), -54]; p.elbowF = [lerp(2, 18, e), -50];
      p.handB = [lerp(-10, 22, e), -50]; p.elbowB = [lerp(-8, 10, e), -48];
      lean = 4;
    } else if (m.special === "shoryuken") {
      p.handF = [10, -96]; p.elbowF = [8, -58]; p.handB = [-12, -30]; lean = 8;
      p.footF = [4, ph - 8]; p.kneeF = [8, ph * 0.5]; p.footB = [-10, ph];
    } else if (m.special === "tatsu") {
      const spin = state.frame * 0.8;
      p.footF = [Math.cos(spin) * 44, ph - 30 + Math.sin(spin) * 16];
      p.footB = [-Math.cos(spin) * 44, ph - 30 - Math.sin(spin) * 16];
      p.kneeF = [Math.cos(spin) * 22, ph - 52]; p.kneeB = [-Math.cos(spin) * 22, ph - 52];
      p.handF = [Math.cos(spin + 1.5) * 32, -50]; p.handB = [-Math.cos(spin + 1.5) * 32, -50];
      p.elbowF = [Math.cos(spin + 1.5) * 16, -48]; p.elbowB = [-Math.cos(spin + 1.5) * 16, -48];
    } else if (m.special === "super") {
      const e = clamp(fr / m.startup, 0, 1);
      p.handF = [lerp(2, 34, e), -58]; p.elbowF = [lerp(2, 20, e), -54];
      p.handB = [lerp(-10, 26, e), -54]; lean = 6;
    }
  }

  // 上半身を前傾（lean だけ前方=+x に倒す）
  for (const k of ["chest", "head", "handF", "handB", "elbowF", "elbowB"]) p[k][0] += lean;

  return { p, ph };
}

function attackExtend(m, fr) {
  if (fr < m.startup) return clamp(fr / Math.max(1, m.startup), 0, 1);
  if (fr < m.startup + m.active) return 1;
  const r = (fr - m.startup - m.active) / Math.max(1, m.recovery);
  return clamp(1 - r, 0, 1);
}

function drawFighter(f) {
  const c = f.char;
  const pose = poseFor(f);
  const px = f.x;
  ctx.save();

  // 倒れ
  if (pose.fallen) {
    ctx.translate(px, f.y);
    ctx.fillStyle = c.giColor;
    ctx.strokeStyle = "#0006"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, -14, 46, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.skin;
    ctx.beginPath(); ctx.arc(-f.facing * 40, -16, 12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }

  const ph = pose.ph;
  const baseY = f.y;            // 足元基準（接地なら GROUND_Y、空中なら現在高さ）
  const pelvisY = baseY - ph;
  const F = f.facing;
  const L = (pt) => [px + F * pt[0], pelvisY + pt[1]];

  const P = pose.p;
  const pelvis = L(P.pelvis), chest = L(P.chest), head = L(P.head);
  const handF = L(P.handF), elbowF = L(P.elbowF);
  const handB = L(P.handB), elbowB = L(P.elbowB);
  const footF = L(P.footF), kneeF = L(P.kneeF);
  const footB = L(P.footB), kneeB = L(P.kneeB);
  const footFp = footF, footBp = footB;

  const tint = f.flash > 0 ? "#ffffff" : null;

  // 後ろ脚
  limb(footBp, kneeB, pelvis, tint || "#2b2b33", 13);
  // 後ろ腕
  limb(handB, elbowB, chest, tint || c.skin, 8, tint || c.giColor);
  // 胴（道着）
  ctx.fillStyle = tint || c.giColor;
  ctx.strokeStyle = "#0004"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(chest[0] - F * 18, chest[1]);
  ctx.lineTo(chest[0] + F * 16, chest[1] + 2);
  ctx.lineTo(pelvis[0] + F * 14, pelvis[1]);
  ctx.lineTo(pelvis[0] - F * 16, pelvis[1]);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // 帯（プレイヤー色）
  ctx.fillStyle = f.side === "L" ? "#3a78ff" : "#ff4a4a";
  ctx.fillRect(pelvis[0] - 17, pelvis[1] - 6, 34, 7);
  // 道着の襟（トリム）
  ctx.strokeStyle = tint || c.trim; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(head[0] - F * 4, head[1] + 10); ctx.lineTo(pelvis[0], pelvis[1] - 4); ctx.stroke();

  // 前脚
  limb(footFp, kneeF, pelvis, tint || "#34343d", 14);
  // 首・頭
  ctx.strokeStyle = tint || c.skin; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(chest[0], chest[1]); ctx.lineTo(head[0], head[1] + 10); ctx.stroke();
  // 髪
  ctx.fillStyle = tint || c.hair;
  ctx.beginPath(); ctx.arc(head[0], head[1], 13, 0, Math.PI * 2); ctx.fill();
  // 顔
  ctx.fillStyle = tint || c.skin;
  ctx.beginPath(); ctx.arc(head[0] + F * 3, head[1] + 2, 10, 0, Math.PI * 2); ctx.fill();
  // ハチマキ
  ctx.fillStyle = tint || c.trim;
  ctx.fillRect(head[0] - 13, head[1] - 6, 26, 5);
  ctx.beginPath();
  ctx.moveTo(head[0] - F * 12, head[1] - 4);
  ctx.lineTo(head[0] - F * 26, head[1] - 2 + Math.sin(state.frame * 0.3) * 4);
  ctx.lineTo(head[0] - F * 24, head[1] + 4 + Math.sin(state.frame * 0.3) * 4);
  ctx.closePath(); ctx.fill();

  // 前腕（最前面）
  limb(handF, elbowF, chest, tint || c.skin, 9, tint || c.giColor);
  // 拳のグローブ感
  ctx.fillStyle = tint || c.trim;
  ctx.beginPath(); ctx.arc(handF[0], handF[1], 6, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// 二関節の手足を描く（先端→中間→根本）。sleeve があれば根本側に袖
function limb(end, mid, root, color, w, sleeve) {
  ctx.lineCap = "round";
  if (sleeve) {
    ctx.strokeStyle = sleeve; ctx.lineWidth = w + 5;
    ctx.beginPath(); ctx.moveTo(root[0], root[1]); ctx.lineTo(mid[0], mid[1]); ctx.stroke();
  }
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(root[0], root[1]); ctx.lineTo(mid[0], mid[1]); ctx.lineTo(end[0], end[1]);
  ctx.stroke();
}

function drawFireball(p) {
  ctx.save();
  const pulse = 1 + Math.sin(p.t * 0.5) * 0.12;
  const grd = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r * pulse);
  grd.addColorStop(0, "#ffffff");
  grd.addColorStop(0.4, p.color);
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2); ctx.fill();
  // 尾
  ctx.fillStyle = p.color + (p.isSuper ? "" : "");
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(p.x - Math.sign(p.vx) * p.r * 0.8, p.y, p.r * 1.1, p.r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSpark(e) {
  const k = e.t / e.life;
  ctx.save();
  ctx.translate(e.x, e.y);
  if (e.type === "block") {
    ctx.strokeStyle = `rgba(150,200,255,${1 - k})`; ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 14 * (1 + k), Math.sin(a) * 14 * (1 + k)); ctx.stroke();
    }
  } else {
    const col = e.type === "heavy" ? "255,210,80" : "255,255,200";
    ctx.fillStyle = `rgba(${col},${1 - k})`;
    ctx.beginPath(); ctx.arc(0, 0, (e.type === "heavy" ? 22 : 13) * (1 - k * 0.4), 0, Math.PI * 2); ctx.fill();
    for (const pt of e.parts) {
      const d = pt.s * e.t;
      ctx.beginPath();
      ctx.arc(Math.cos(pt.a) * d, Math.sin(pt.a) * d, 3 * (1 - k), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// =============================================================================
// HUD（体力ゲージ・タイマー・ラウンド星・ゲージ・コンボ）
// =============================================================================
function drawHUD() {
  const [a, b] = state.fighters;
  // 体力バー
  drawHealthBar(a, 24, true);
  drawHealthBar(b, W - 24 - 360, false);

  // 名前
  ctx.font = "bold 16px sans-serif"; ctx.textBaseline = "top";
  ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  ctx.fillText(a.char.name, 26, 50);
  ctx.textAlign = "right";
  ctx.fillText(b.char.name, W - 26, 50);

  // タイマー
  ctx.textAlign = "center"; ctx.font = "bold 40px monospace";
  ctx.fillStyle = state.timer <= 10 ? "#ff5a5a" : "#fff";
  ctx.fillText(String(state.timer).padStart(2, "0"), W / 2, 22);

  // ラウンド星
  drawRoundPips(a, W / 2 - 44, 18, 1);
  drawRoundPips(b, W / 2 + 44, 18, -1);

  // スーパーゲージ
  drawSuperBar(a, 24, true);
  drawSuperBar(b, W - 24 - 300, false);

  // コンボ表示
  if (comboTimer > 0 && state.comboCount >= 2) {
    const left = state.comboBy === "L";
    ctx.textAlign = left ? "left" : "right";
    ctx.font = "italic bold 30px sans-serif";
    ctx.fillStyle = "#ffd33d";
    const x = left ? 40 : W - 40;
    const y = 130;
    ctx.fillText(`${state.comboCount} HITS`, x, y);
    ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#fff";
    ctx.fillText("コンボ", x, y + 32);
  }

  if (state.paused) {
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 40px sans-serif";
    ctx.fillText("PAUSE", W / 2, H / 2 - 20);
    ctx.font = "16px sans-serif"; ctx.fillText("P で再開", W / 2, H / 2 + 30);
  }
  if (audio.muted) {
    ctx.fillStyle = "#fff8"; ctx.textAlign = "right"; ctx.font = "12px sans-serif";
    ctx.fillText("🔇 MUTE (M)", W - 10, H - 18);
  }
}

function drawHealthBar(f, x, leftToRight) {
  const w = 360, h = 22, y = 24;
  ctx.fillStyle = "#000"; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#3a1414"; ctx.fillRect(x, y, w, h);
  const ratio = clamp(f.hp / f.maxHp, 0, 1);
  const fw = w * ratio;
  const grd = ctx.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, "#ffe27a"); grd.addColorStop(0.5, "#ffb12e"); grd.addColorStop(1, "#e07a1e");
  ctx.fillStyle = grd;
  if (leftToRight) ctx.fillRect(x, y, fw, h);
  else ctx.fillRect(x + (w - fw), y, fw, h);
  // 枠
  ctx.strokeStyle = "#fff8"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
}

function drawSuperBar(f, x, leftToRight) {
  const w = 300, h = 12, y = H - 26;
  ctx.fillStyle = "#000a"; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#10203a"; ctx.fillRect(x, y, w, h);
  const fw = w * clamp(f.meter / 100, 0, 1);
  const full = f.meter >= 100;
  ctx.fillStyle = full ? (Math.floor(state.frame / 4) % 2 ? "#fff" : "#ffd33d") : "#37b6ff";
  if (leftToRight) ctx.fillRect(x, y, fw, h);
  else ctx.fillRect(x + (w - fw), y, fw, h);
  ctx.strokeStyle = "#fff6"; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif";
  ctx.textAlign = leftToRight ? "left" : "right";
  ctx.fillText(full ? "SUPER!" : "SUPER", leftToRight ? x : x + w, y - 14);
}

function drawRoundPips(f, cx, y, dir) {
  for (let i = 0; i < ROUNDS_TO_WIN; i++) {
    const x = cx + dir * i * 22;
    ctx.beginPath(); ctx.arc(x, y + 18, 8, 0, Math.PI * 2);
    ctx.fillStyle = i < f.roundWins ? "#ffd33d" : "#ffffff30";
    ctx.fill();
    ctx.strokeStyle = "#0008"; ctx.lineWidth = 2; ctx.stroke();
  }
}

// ---- タイトル画面 ----
function drawTitle() {
  ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.font = "italic 900 64px sans-serif";
  ctx.fillStyle = "#ffd33d";
  ctx.fillText("STREET FIGHT", W / 2, 90);
  ctx.font = "16px sans-serif"; ctx.fillStyle = "#fff";
  ctx.fillText("ブラウザ対戦格闘", W / 2, 160);

  const items = [
    { label: "1P でたたかう（CPU 対戦）", on: menu.titleIndex === 0 },
    { label: "2P 対戦（同じキーボード）", on: menu.titleIndex === 1 },
  ];
  items.forEach((it, i) => {
    const y = 240 + i * 56;
    ctx.font = it.on ? "bold 26px sans-serif" : "22px sans-serif";
    ctx.fillStyle = it.on ? "#ffd33d" : "#cfd0e0";
    ctx.fillText((it.on ? "▶ " : "　") + it.label, W / 2, y);
  });

  // 難易度（1P時）
  const dy = 360;
  ctx.font = "16px sans-serif"; ctx.fillStyle = menu.titleIndex === 0 ? "#fff" : "#777";
  ctx.fillText("CPU 難易度（← →）: " + DIFF_LABEL[DIFFS[menu.diffIndex]], W / 2, dy);

  ctx.font = "15px sans-serif"; ctx.fillStyle = "#bbb";
  ctx.fillText("↑↓ で選択　/　F・Enter で決定", W / 2, 440);
  if (Math.floor(menu.cursorBlink / 30) % 2 === 0) {
    ctx.fillStyle = "#ffd33d"; ctx.font = "bold 18px sans-serif";
    ctx.fillText("PRESS  F  TO  START", W / 2, 480);
  }
}

// ---- キャラ選択画面 ----
function drawCharSelect() {
  ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.font = "bold 30px sans-serif"; ctx.fillStyle = "#ffd33d";
  ctx.fillText("キャラクター選択", W / 2, 56);

  const n = CHAR_IDS.length;
  const cellW = 180, gap = 30;
  const totalW = n * cellW + (n - 1) * gap;
  const startX = (W - totalW) / 2;
  for (let i = 0; i < n; i++) {
    const c = CHARS[CHAR_IDS[i]];
    const x = startX + i * (cellW + gap), y = 130, h = 220;
    ctx.fillStyle = "#1c1e34"; ctx.fillRect(x, y, cellW, h);
    // ミニ立ち絵
    drawCharPortrait(c, x + cellW / 2, y + 150);
    ctx.fillStyle = "#fff"; ctx.font = "bold 20px sans-serif";
    ctx.fillText(c.name, x + cellW / 2, y + h - 44);
    ctx.fillStyle = "#aab"; ctx.font = "12px sans-serif";
    ctx.fillText(c.tag, x + cellW / 2, y + h - 20);

    // カーソル
    if (i === menu.p1) drawSelCursor(x, y, cellW, h, "#3a78ff", menu.p1locked, "1P");
    if ((state.is2P && i === menu.p2) || (!state.is2P && menu.p1locked && i === (state.pendingCpu ?? menu.p2)))
      drawSelCursor(x, y, cellW, h, "#ff4a4a", state.is2P ? menu.p2locked : true, state.is2P ? "2P" : "CPU");
  }

  ctx.fillStyle = "#ddd"; ctx.font = "15px sans-serif";
  ctx.fillText(state.is2P ? "1P: A/D 選択・F 決定（V で解除）　2P: ←/→ 選択・K 決定（, で解除）"
                          : "1P: A/D 選択・F 決定（V で解除）　CPU は自動選択", W / 2, 410);
  ctx.fillText("R でタイトルへ", W / 2, 440);
}

function drawSelCursor(x, y, w, h, color, locked, label) {
  ctx.strokeStyle = color; ctx.lineWidth = locked ? 6 : 3;
  if (!locked && Math.floor(menu.cursorBlink / 15) % 2) ctx.globalAlpha = 0.4;
  ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(label + (locked ? " ✓" : ""), x + w / 2, y - 22);
}

function drawCharPortrait(c, cx, baseY) {
  ctx.save();
  ctx.translate(cx, baseY);
  // 胴
  ctx.fillStyle = c.giColor;
  ctx.beginPath();
  ctx.moveTo(-22, -70); ctx.lineTo(22, -70); ctx.lineTo(16, 0); ctx.lineTo(-16, 0); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = c.trim; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(0, 0); ctx.stroke();
  // 帯
  ctx.fillStyle = "#333"; ctx.fillRect(-18, -8, 36, 8);
  // 頭
  ctx.fillStyle = c.hair; ctx.beginPath(); ctx.arc(0, -90, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.skin; ctx.beginPath(); ctx.arc(0, -86, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.trim; ctx.fillRect(-18, -94, 36, 6);
  // 腕（構え）
  ctx.strokeStyle = c.skin; ctx.lineWidth = 9; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-18, -64); ctx.lineTo(-34, -40); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(18, -64); ctx.lineTo(34, -50); ctx.stroke();
  ctx.restore();
}

// =============================================================================
// 起動
// =============================================================================
function boot() {
  screen.mode = "title";
  state.lastTime = performance.now();
  // タイトルBGMなどはなし。AudioContext は最初の入力で初期化される。
  requestAnimationFrame(loop);
}
boot();
