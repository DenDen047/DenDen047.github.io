// =============================================================================
// にゃんこウォーズ
//   左 = 自陣 (味方ユニットを召喚)  →   右 = 敵陣
//   お金は時間で自動回復。各カードに個別リチャージあり。
//   ユニットは前進し、射程内に敵が入ったら自動で殴り合う。
// =============================================================================

// -------- Canvas ------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;     // 960
const H = canvas.height;    // 320
const GROUND_Y = 245;       // 地面の上端 y
const ALLY_BASE_X  = 55;
const ENEMY_BASE_X = W - 55;

// -------- ユニット定義 (味方) -----------------------------------------------
// id       : 内部識別
// name     : 表示名
// cost     : 召喚コスト
// recharge : 同じカードを再使用するまで (ms)
// hp/atk   : 体力 / 攻撃力
// range    : 攻撃が届く距離 (px)
// speed    : 移動速度 (px/sec)
// atkInt   : 攻撃間隔 (ms)
// emoji    : 見た目
const UNITS = [
  { id:"cat",      name:"ねこ",         cost:50,  recharge:1500,  hp:80,   atk:8,   range:30,  speed:60,  atkInt:600,  emoji:"🐱" },
  { id:"tank",     name:"戦車ねこ",     cost:200, recharge:8000,  hp:600,  atk:5,   range:30,  speed:30,  atkInt:900,  emoji:"🛡️" },
  { id:"fish",     name:"魚にゃん",     cost:80,  recharge:2500,  hp:90,   atk:18,  range:30,  speed:50,  atkInt:700,  emoji:"🐟" },
  { id:"archer",   name:"弓ねこ",       cost:150, recharge:4000,  hp:60,   atk:14,  range:130, speed:45,  atkInt:1100, emoji:"🏹" },
  { id:"ninja",    name:"にゃんじゃ",   cost:250, recharge:5000,  hp:120,  atk:35,  range:35,  speed:90,  atkInt:500,  emoji:"🥷" },
  { id:"mage",     name:"魔導にゃん",   cost:400, recharge:9000,  hp:90,   atk:60,  range:160, speed:35,  atkInt:1500, emoji:"🔮" },
  { id:"titan",    name:"巨大ねこ",     cost:800, recharge:15000, hp:1400, atk:80,  range:35,  speed:25,  atkInt:1200, emoji:"😼" },
  { id:"rocket",   name:"ロケにゃん",   cost:600, recharge:12000, hp:300,  atk:120, range:210, speed:30,  atkInt:2000, emoji:"🚀" },
  { id:"speed",    name:"電光にゃん",   cost:75,  recharge:1800,  hp:50,   atk:6,   range:30,  speed:140, atkInt:400,  emoji:"⚡" },
  { id:"samurai",  name:"侍にゃんこ",   cost:300, recharge:5500,  hp:280,  atk:45,  range:40,  speed:55,  atkInt:800,  emoji:"⚔️" },
];

// -------- 敵ユニット定義 ----------------------------------------------------
const ENEMIES = [
  { id:"doge", name:"いぬ", hp:60,  atk:10, range:30,  speed:35, atkInt:700,  emoji:"🐶" },
  { id:"pig",  name:"豚",   hp:240, atk:6,  range:30,  speed:25, atkInt:900,  emoji:"🐷" },
  { id:"bird", name:"鳥",   hp:50,  atk:9,  range:80,  speed:55, atkInt:600,  emoji:"🐦" },
  { id:"bear", name:"熊",   hp:700, atk:45, range:35,  speed:30, atkInt:1000, emoji:"🐻" },
];

// -------- ゲーム状態 --------------------------------------------------------
const state = {
  money: 100,
  moneyMax: 999,
  moneyRate: 25,           // per second
  allyBaseHp: 1000,
  allyBaseMax: 1000,
  enemyBaseHp: 2500,
  enemyBaseMax: 2500,
  entities: [],            // すべての戦闘ユニット
  recharges: {},           // unitId -> 残り ms
  enemySpawnTimer: 1500,   // 最初のスポーンまでの猶予
  difficulty: 1,           // 時間で上がる
  paused: false,
  ended: null,             // null | "win" | "lose"
  lastTime: performance.now(),
};

UNITS.forEach(u => state.recharges[u.id] = 0);

// -------- 視覚エフェクト ---------------------------------------------------
// 軽量パーティクル。type に応じた描画と寿命だけ持つ。
state.fx = [];
state.baseFlash = { ally: 0, enemy: 0 };  // 城被弾時の赤フラッシュ残り秒

function spawnFx(fx) { state.fx.push(Object.assign({ age: 0 }, fx)); }

function updateFx(dt) {
  for (const f of state.fx) {
    f.age += dt;
    if (f.vx) f.x += f.vx * dt;
    if (f.vy) f.y += f.vy * dt;
  }
  state.fx = state.fx.filter(f => f.age < f.ttl);
  state.baseFlash.ally  = Math.max(0, state.baseFlash.ally  - dt);
  state.baseFlash.enemy = Math.max(0, state.baseFlash.enemy - dt);
}

function drawFx() {
  for (const f of state.fx) {
    const t = f.age / f.ttl;
    ctx.globalAlpha = Math.max(0, 1 - t);
    if (f.type === "spark") {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 4 + t * 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.type === "damage") {
      ctx.fillStyle = f.color;
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - t * 22);
    } else if (f.type === "poof") {
      ctx.fillStyle = "#bbb";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 10 + t * 14, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.type === "projectile") {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(f.x - f.vx * 0.04, f.y - f.vy * 0.04);
      ctx.lineTo(f.x, f.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// -------- 効果音 (WebAudio で合成) ------------------------------------------
let audioCtx = null;
let muted = false;

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function unlockAudio() {
  const c = getAudio();
  if (c.state === "suspended") c.resume();
}

function blip({ type = "square", freq = 440, freqEnd, dur = 0.1, vol = 0.07, delay = 0 }) {
  if (muted) return;
  const c = getAudio();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

const SFX = {
  spawn:   () => blip({ type: "sine",     freq: 720, freqEnd: 1100, dur: 0.10, vol: 0.06 }),
  hit:     () => blip({ type: "square",   freq: 240, freqEnd: 80,   dur: 0.06, vol: 0.04 }),
  death:   () => blip({ type: "sawtooth", freq: 200, freqEnd: 40,   dur: 0.22, vol: 0.06 }),
  baseHit: () => blip({ type: "triangle", freq: 90,  freqEnd: 45,   dur: 0.20, vol: 0.10 }),
  win:     () => { [523, 659, 784, 1047].forEach((f, i) => blip({ type: "triangle", freq: f, dur: 0.18, vol: 0.08, delay: i * 0.13 })); },
  lose:    () => { [392, 311, 247, 196].forEach((f, i) => blip({ type: "sawtooth", freq: f, dur: 0.25, vol: 0.08, delay: i * 0.18 })); },
};

// -------- ヘルパー: 特殊効果 -----------------------------------------------
// applyHitEffect() から呼べる小道具。シンプルにしてある。
function knockback(target, distance) {
  if (target.isBase) return;
  target.x += target.isAlly ? -distance : distance;
}
function slow(target, factor, ms) {
  if (target.isBase) return;
  target.slowFactor = factor;
  target.slowUntilMs = Math.max(target.slowUntilMs || 0, performance.now() + ms);
}
function stun(target, ms) {
  if (target.isBase) return;
  target.stunUntilMs = Math.max(target.stunUntilMs || 0, performance.now() + ms);
}
function splash(attacker, target, dmg, radius) {
  if (target.isBase) return;
  const opponents = attacker.isAlly
    ? state.entities.filter(e => !e.isAlly)
    : state.entities.filter(e =>  e.isAlly);
  for (const o of opponents) {
    if (o === target || o.hp <= 0) continue;
    if (Math.abs(o.x - target.x) <= radius) o.hp -= dmg;
  }
}

// =============================================================================
// === USER CONTRIBUTION ZONE ==================================================
// 召喚キャラの「個性」をここで定義する。
// この関数は誰かが誰かに攻撃を当てるたびに呼ばれる。
//
// attacker.unitId / defender.unitId を見て、好きな効果を実装してみよう。
//
// 利用できるヘルパー:
//   knockback(target, distance)        — 後退させる
//   slow(target, factor, ms)           — 移動速度低下 (factor=0.5 で半速)
//   stun(target, ms)                   — 行動停止
//   splash(attacker, target, dmg, rad) — 範囲ダメージ
//
// 例:
//   if (attacker.unitId === "samurai" && Math.random() < 0.3) {
//     knockback(defender, 35);
//   }
//   if (attacker.unitId === "mage") {
//     splash(attacker, defender, attacker.atk * 0.5, 50);
//   }
//
// TODO(you): 最低 3 体のキャラに特殊効果を付けてゲームに個性を出してください。
// =============================================================================
function applyHitEffect(attacker, defender) {
  // ← ここに 5〜10 行で書く

}
// =============================================================================

// -------- 召喚 --------------------------------------------------------------
function spawnAlly(unitDef) {
  if (state.ended) return false;
  if (state.money < unitDef.cost) return false;
  if (state.recharges[unitDef.id] > 0) return false;
  state.money -= unitDef.cost;
  state.recharges[unitDef.id] = unitDef.recharge;
  state.entities.push(makeEntity(unitDef, ALLY_BASE_X + 20, true));
  spawnFx({ type: "poof", x: ALLY_BASE_X + 20, y: GROUND_Y - 10, ttl: 0.35 });
  unlockAudio();
  SFX.spawn();
  return true;
}

function spawnEnemy(def) {
  state.entities.push(makeEntity(def, ENEMY_BASE_X - 20, false));
}

function makeEntity(def, x, isAlly) {
  return {
    unitId: def.id,
    name: def.name,
    emoji: def.emoji,
    isAlly,
    x,
    y: GROUND_Y - 8,
    hp: def.hp,
    hpMax: def.hp,
    atk: def.atk,
    range: def.range,
    speed: def.speed,
    atkInt: def.atkInt,
    atkCooldown: 0,
    slowFactor: 1,
    slowUntilMs: 0,
    stunUntilMs: 0,
    // --- 手続き的アニメーション用の状態 ---
    facing: isAlly ? 1 : -1,                              // 進行方向 (右=+1 / 左=-1)
    scale: Math.max(0.8, Math.min(1.7, 0.8 + def.hp / 1600)),  // HP が高いほど大きい
    anim: {
      clock: Math.random() * Math.PI * 2,   // 呼吸などの位相をユニット毎にずらす
      prevX: x,
      gait: Math.random() * Math.PI * 2,    // 歩行サイクルの位相
      walk: 0,                              // 歩いている度合い 0..1
      bob: 0,                               // 胴体の上下動
      squash: 0, squashV: 0,                // squash&stretch のバネ
      lunge: 0,                             // 攻撃時の踏み込み 0..1
      recoil: 0,                            // 被弾でのけぞり (px, 符号付き)
      hitFlash: 0,                          // 被弾時の赤フラッシュ 0..1
      drop: 26, landed: false,             // スポーン落下 (着地で squash)
      tailAngle: 0, tailVel: 0,             // 尻尾の二次運動
    },
  };
}

// -------- 敵ウェーブ --------------------------------------------------------
function tickEnemyWaves(dt) {
  state.difficulty += dt * 0.03;
  state.enemySpawnTimer -= dt * 1000;
  if (state.enemySpawnTimer <= 0) {
    // 難易度に応じて選択肢が増える
    const pool = ENEMIES.slice(0, Math.min(ENEMIES.length, 1 + Math.floor(state.difficulty / 1.5)));
    const def = pool[Math.floor(Math.random() * pool.length)];
    spawnEnemy(def);
    // 次のスポーンまで: 難易度が上がるほど短く
    state.enemySpawnTimer = Math.max(800, 3500 - state.difficulty * 200);
  }
}

// -------- 戦闘ループ --------------------------------------------------------
function stepEntity(e, dt, now) {
  if (e.hp <= 0) return;
  if (now < e.stunUntilMs) return;

  const direction = e.isAlly ? 1 : -1;
  const opponents = state.entities.filter(o => o.isAlly !== e.isAlly && o.hp > 0);

  // 射程内のターゲット (一番前にいる敵を狙う)
  let target = null;
  for (const o of opponents) {
    const d = Math.abs(o.x - e.x);
    if (d <= e.range) {
      if (!target) target = o;
      else if (e.isAlly ? o.x < target.x : o.x > target.x) target = o;
    }
  }
  // 城も射程に入ったら殴る
  if (!target) {
    const baseX = e.isAlly ? ENEMY_BASE_X : ALLY_BASE_X;
    if (Math.abs(baseX - e.x) <= e.range) {
      target = { isBase: true, isAlly: !e.isAlly, x: baseX };
    }
  }

  if (target) {
    e.atkCooldown -= dt * 1000;
    if (e.atkCooldown <= 0) {
      e.atkCooldown = e.atkInt;
      e.anim.lunge = 1;                 // 攻撃モーション (踏み込み)
      // 遠距離ユニットの弾道線 (見た目のみ・ダメージは即時)
      if (e.range > 60 && !target.isBase) {
        const dx = target.x - e.x;
        const dur = 0.12;
        spawnFx({ type: "projectile", x: e.x, y: e.y - 12, vx: dx / dur, vy: 0,
                  color: e.isAlly ? "#ffd86b" : "#ff8b6b", ttl: dur });
      }
      if (target.isBase) {
        if (e.isAlly) state.enemyBaseHp -= e.atk;
        else          state.allyBaseHp  -= e.atk;
        const bx = e.isAlly ? ENEMY_BASE_X : ALLY_BASE_X;
        spawnFx({ type: "spark",  x: bx, y: GROUND_Y - 40, ttl: 0.22 });
        spawnFx({ type: "damage", x: bx, y: GROUND_Y - 55, ttl: 0.6,
                  text: `-${e.atk}`, color: "#ffdd55" });
        state.baseFlash[e.isAlly ? "enemy" : "ally"] = 0.25;
        SFX.baseHit();
      } else {
        target.hp -= e.atk;
        if (target.anim) {               // 被弾リアクション (のけぞり + 潰れ + 赤フラッシュ)
          target.anim.recoil = e.facing * 4;
          target.anim.hitFlash = 1;
          target.anim.squashV -= 8;
        }
        spawnFx({ type: "spark",  x: target.x, y: target.y - 12, ttl: 0.16 });
        spawnFx({ type: "damage", x: target.x, y: target.y - 20, ttl: 0.5,
                  text: `-${e.atk}`, color: e.isAlly ? "#ffdd55" : "#ff8888" });
        SFX.hit();
        if (target.hp <= 0 && !target._deathFx) {
          target._deathFx = true;
          spawnFx({ type: "poof", x: target.x, y: target.y - 10, ttl: 0.4 });
          SFX.death();
        }
        applyHitEffect(e, target);
      }
    }
  } else {
    const slowed = now < e.slowUntilMs ? e.slowFactor : 1;
    e.x += direction * e.speed * slowed * dt;
  }
}

// -------- メインループ ------------------------------------------------------
function update(dt) {
  if (state.paused || state.ended) return;
  const now = performance.now();

  // お金
  state.money = Math.min(state.moneyMax, state.money + state.moneyRate * dt);

  // リチャージ
  for (const id in state.recharges) {
    state.recharges[id] = Math.max(0, state.recharges[id] - dt * 1000);
  }

  // 敵ウェーブ
  tickEnemyWaves(dt);

  // 戦闘
  for (const e of state.entities) stepEntity(e, dt, now);

  // アニメーション更新 (歩行サイクル・スプリング・尻尾の二次運動)
  for (const e of state.entities) updateEntityAnim(e, dt);

  // 死亡除去
  state.entities = state.entities.filter(e => e.hp > 0);

  // エフェクト寿命
  updateFx(dt);

  // 勝敗判定
  if (state.allyBaseHp  <= 0) { state.ended = "lose"; showMessage("やられた…  (R でリスタート)"); SFX.lose(); }
  if (state.enemyBaseHp <= 0) { state.ended = "win";  showMessage("勝利！🏆  (R でリスタート)"); SFX.win(); }
}

// -------- 描画 --------------------------------------------------------------
function draw() {
  ctx.clearRect(0, 0, W, H);

  // 城
  drawBase(ALLY_BASE_X,  "#4fc3f7", state.allyBaseHp,  state.allyBaseMax,  "🏯", true);
  drawBase(ENEMY_BASE_X, "#e74c3c", state.enemyBaseHp, state.enemyBaseMax, "🏰", false);

  // ユニット
  for (const e of state.entities) drawEntity(e);

  // エフェクト (火花・ダメージ数値・煙・弾道線)
  drawFx();

  if (state.paused) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", W/2, H/2);
  }
}

function drawBase(x, color, hp, hpMax, emoji, isAlly) {
  // 城の建物
  ctx.fillStyle = color;
  ctx.fillRect(x - 30, GROUND_Y - 70, 60, 70);
  ctx.fillStyle = "#222";
  ctx.fillRect(x - 8, GROUND_Y - 30, 16, 30);
  // emoji
  ctx.font = "30px serif";
  ctx.textAlign = "center";
  ctx.fillText(emoji, x, GROUND_Y - 35);
  // 被弾フラッシュ
  const flash = isAlly ? state.baseFlash.ally : state.baseFlash.enemy;
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 80, 80, ${Math.min(0.6, flash * 2)})`;
    ctx.fillRect(x - 30, GROUND_Y - 70, 60, 70);
  }
  // HPバー
  const pct = Math.max(0, hp / hpMax);
  ctx.fillStyle = "#000";
  ctx.fillRect(x - 32, GROUND_Y - 80, 64, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x - 32, GROUND_Y - 80, 64 * pct, 6);
}

// =============================================================================
// === 手続き的アニメーション (procedural animation) ===========================
// スプライト画像を一切使わず、コードだけでキャラを動かすデモ。
//   - 2ボーンIK の脚 + 歩行サイクル (移動量で位相を駆動)
//   - 着地 / 被弾の squash & stretch (バネ)
//   - 尻尾の二次運動 (バネ・ダンパ)
// 各ユニットの絵文字は「顔」として胴体の上に乗せ、個性はそのまま残す。
// =============================================================================
const ANIM = {
  gaitPerPx: 0.30,            // 移動量 → 歩行サイクル位相
  strideAmp: 5,              // 足の前後振り幅   (×scale)
  stepLift:  5,              // 足の持ち上げ高さ (×scale)
  bobAmp:    3,              // 胴体の上下動     (×scale ×walk)
  legLen:    7,              // 脚 1 セグメント長 (×scale)
  hipSpread: 3,              // 脚の付け根の左右間隔/2 (×scale)
  bodyW:    17, bodyH: 13,   // 胴体の楕円サイズ
  lungeDist: 6,              // 攻撃時の踏み込み (×scale)
  squashK: 240, squashC: 14, // 着地スプリング (剛性 / 減衰)
  landImpulse: 22,           // 着地時の潰れインパルス
  dropH: 26, dropSpeed: 120, // スポーン落下の高さ / 速度
  tailK: 90, tailC: 9,       // 尻尾スプリング
};

// 2ボーン逆運動学: hip → knee → foot を解く。bendDir で膝の曲がる向きを指定。
function solveIK(hx, hy, fx, fy, l1, l2, bendDir) {
  const ang = Math.atan2(fy - hy, fx - hx);
  let d = Math.hypot(fx - hx, fy - hy);
  d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.01, d));  // 届く範囲にクランプ
  const ex = hx + Math.cos(ang) * d, ey = hy + Math.sin(ang) * d;       // クランプ後の足先
  const ca = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const ka = ang + bendDir * Math.acos(ca);                             // 余弦定理で膝の角度
  return { kx: hx + Math.cos(ka) * l1, ky: hy + Math.sin(ka) * l1, fx: ex, fy: ey };
}

// 毎フレームの状態更新: 位置の変化からアニメーションを駆動する。
function updateEntityAnim(e, dt) {
  const a = e.anim;
  a.clock += dt;
  const moved = e.x - a.prevX;
  a.prevX = e.x;
  const vx = moved / Math.max(dt, 1e-4);

  // 歩いている度合い (0..1) を滑らかに追従
  const targetWalk = Math.min(1, Math.abs(vx) / 40);
  a.walk += (targetWalk - a.walk) * Math.min(1, dt * 12);

  // 歩行サイクルは「移動距離」で進める → 速いユニットほど脚が速く回る
  a.gait += Math.abs(moved) * ANIM.gaitPerPx;

  // 胴体の上下動 (歩行) + 待機時の呼吸
  a.bob = Math.abs(Math.sin(a.gait)) * ANIM.bobAmp * e.scale * a.walk
        + Math.sin(a.clock * 2.2) * 0.6 * e.scale * (1 - a.walk);

  // squash & stretch スプリング (着地・被弾の弾み)
  a.squashV += (-ANIM.squashK * a.squash - ANIM.squashC * a.squashV) * dt;
  a.squash  += a.squashV * dt;

  // 各種インパルスの減衰
  a.lunge    = Math.max(0, a.lunge - dt * 6);
  a.recoil  += (0 - a.recoil) * Math.min(1, dt * 12);
  a.hitFlash = Math.max(0, a.hitFlash - dt * 4);

  // スポーン落下 → 着地した瞬間に squash インパルス
  if (a.drop > 0) {
    a.drop = Math.max(0, a.drop - dt * ANIM.dropSpeed);
    if (a.drop === 0 && !a.landed) { a.landed = true; a.squashV -= ANIM.landImpulse; }
  }

  // 尻尾の二次運動 (速度と歩行で揺れ、バネで遅れて追従)
  const tailTarget = -e.facing * vx * 0.004 - a.walk * Math.sin(a.gait) * 0.25;
  a.tailVel += ((tailTarget - a.tailAngle) * ANIM.tailK - a.tailVel * ANIM.tailC) * dt;
  a.tailAngle += a.tailVel * dt;
}

// =============================================================================
// === AI生成パーツ (カットアウト) を骨格に貼るモード ===========================
// assets/<unitId>/<part>.png を用意して下の ART に登録すると、手続き図形の代わりに
// AI画像をボーンに貼って動かす (= 無料版の Spine / Live2D)。動き (歩行・攻撃・
// squash・被弾) は手続き版とまったく同じ anim 状態から駆動されるので、1キャラ
// 数枚の画像を用意するだけでリッチな見た目になる。
//
// 必須パーツ : body(胴) / head(頭) / leg(脚・左右で使い回す)
// 任意パーツ : arm(前腕。攻撃時に突き出す)
// 画像の向き : 脚と腕は「縦向き・上端が付け根・下端が先端」。頭と胴は正面向き。
//             尻尾・耳・尻尾は body / head の絵に描き込んでおく。背景は透過(PNG)。
// 画像が未登録/未ロードのユニットは自動で手続き描画にフォールバックする。
const ART = {
  // 例) cat: ['body', 'head', 'leg', 'arm'],   ← assets/cat/*.png を置いて有効化
};
const partImg = {};
function loadArt() {
  for (const id in ART) {
    partImg[id] = {};
    for (const name of ART[id]) {
      const im = new Image();
      im.src = `assets/${id}/${name}.png`;
      partImg[id][name] = im;     // complete / naturalWidth で準備判定
    }
  }
}
loadArt();
function readyImg(id, name) {
  const set = partImg[id];
  const im = set && set[name];
  return im && im.complete && im.naturalWidth > 0 ? im : null;
}

function drawTexturedEntity(e) {
  const body = readyImg(e.unitId, "body");
  const head = readyImg(e.unitId, "head");
  const leg  = readyImg(e.unitId, "leg");
  if (!body || !head || !leg) return false;     // 必須パーツが揃わなければ手続き描画へ
  const arm = readyImg(e.unitId, "arm");

  const a = e.anim, f = e.facing, s = e.scale;
  const cx = e.x + f * a.lunge * ANIM.lungeDist * s + a.recoil;
  const groundY = GROUND_Y - a.drop;
  const sy = 1 + a.squash;
  const sx = 1 - a.squash * 0.55 + a.lunge * 0.22;
  const legLen = ANIM.legLen * s;
  const hipY   = groundY - legLen * 1.5 - a.bob;
  const bodyCY = hipY - ANIM.bodyH * 0.4 * s;

  // --- 影 (ワールド座標) ---
  const land = 1 - Math.min(1, a.drop / ANIM.dropH);
  ctx.fillStyle = `rgba(0,0,0,${0.3 * (0.35 + 0.65 * land)})`;
  ctx.beginPath();
  ctx.ellipse(e.x, GROUND_Y, (13 - a.drop * 0.22) * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // 以降ローカル座標: 原点 = cx, +x = 進行方向 (敵は左右反転)
  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(f, 1);

  // 付け根(hx,hy) → 先端(tx,ty) に画像を伸ばして貼る (脚・腕で共通)
  const drawLimb = (img, hx, hy, tx, ty, wpx) => {
    const ang = Math.atan2(ty - hy, tx - hx) - Math.PI / 2;   // 画像は既定で下向き
    const len = Math.max(1, Math.hypot(tx - hx, ty - hy));
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.drawImage(img, -wpx / 2, 0, wpx, len);
    ctx.restore();
  };

  // 歩行サイクルの足先 (手続き版と同じ計算・ローカル座標)
  const footOf = (i) => {
    const ph = a.gait + i * Math.PI;
    const sw = Math.cos(ph);
    const lifted = Math.max(0, Math.sin(ph)) * a.walk;
    const hx = (i === 0 ? -ANIM.hipSpread : ANIM.hipSpread) * s;
    return { hx, fx: hx + ANIM.strideAmp * s * sw * a.walk, fy: groundY - lifted * ANIM.stepLift * s };
  };
  const back = footOf(0), front = footOf(1);

  // レイヤー順: 後ろ脚 → 胴 → 前脚 → 前腕 → 頭
  const th = (ANIM.bodyH + legLen * 0.7) * s * sy;
  const tw = ANIM.bodyW * 1.1 * s * sx;
  const headBottom = bodyCY - th * 0.5 + 2 * s;
  const hw = ANIM.bodyW * 1.15 * s;
  const hh = hw * (head.naturalHeight / head.naturalWidth);

  drawLimb(leg, back.hx, hipY, back.fx, back.fy, 7 * s);
  ctx.drawImage(body, -tw / 2, bodyCY - th * 0.5, tw, th);
  drawLimb(leg, front.hx, hipY, front.fx, front.fy, 7 * s);
  if (arm) {
    const shX = ANIM.hipSpread * 0.6 * s;
    const shY = bodyCY - ANIM.bodyH * 0.15 * s;
    const swing = Math.sin(a.gait) * 0.5 * a.walk + a.lunge * 1.3;   // 歩行で振り + 攻撃で突き
    const ang = Math.PI * 0.5 - swing;
    drawLimb(arm, shX, shY, shX + Math.cos(ang) * 12 * s, shY + Math.sin(ang) * 12 * s, 6 * s);
  }
  ctx.drawImage(head, -hw / 2, headBottom - hh, hw, hh);
  ctx.restore();

  // --- 被弾フラッシュ (ワールド座標) ---
  if (a.hitFlash > 0) {
    ctx.save();
    ctx.globalAlpha = 0.5 * a.hitFlash;
    ctx.fillStyle = "#ff4040";
    ctx.beginPath();
    ctx.ellipse(cx, bodyCY, ANIM.bodyW * 0.6 * s, th * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- HP バー ---
  const pct = Math.max(0, e.hp / e.hpMax);
  const w = 26 * s;
  const hbY = headBottom - hh - 8;
  ctx.fillStyle = "#000";
  ctx.fillRect(cx - w / 2, hbY, w, 4);
  ctx.fillStyle = e.isAlly ? "#80d8ff" : "#ff8b8b";
  ctx.fillRect(cx - w / 2, hbY, w * pct, 4);
  return true;
}

function drawEntity(e) {
  if (drawTexturedEntity(e)) return;            // AI素材があれば貼り付けて終了
  const a = e.anim, f = e.facing, s = e.scale;
  const cx = e.x + f * a.lunge * ANIM.lungeDist * s + a.recoil;
  const groundY = GROUND_Y - a.drop;
  const sy = 1 + a.squash;
  const sx = 1 - a.squash * 0.55 + a.lunge * 0.22;

  // --- にゃんこ大戦争風: 白いタマゴ体 + 短い手足 + 太い輪郭 + ヨタヨタ歩き ---
  const bodyCol = e.isAlly ? "#f7f3e8" : "#ffd2c4";   // 味方=白っぽい / 敵=肌色
  const edgeCol = e.isAlly ? "#473d34" : "#7d4034";   // 太い濃い輪郭
  const bw = 10 * s, bh = 11.5 * s;                   // 胴(タマゴ)の半径
  const legLen = 3.6 * s, legW = 3.2 * s;
  const stride = 3.0 * s, lift = 2.6 * s, spread = 4.2 * s;

  // --- 影 ---
  const land = 1 - Math.min(1, a.drop / ANIM.dropH);
  ctx.fillStyle = `rgba(0,0,0,${0.3 * (0.35 + 0.65 * land)})`;
  ctx.beginPath();
  ctx.ellipse(e.x, GROUND_Y, (12 - a.drop * 0.22) * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  const hipY = groundY - legLen * 1.25 - a.bob;
  const bodyCY = hipY - bh * 0.55;

  // --- 脚 (短いずんぐり・濃い輪郭+白の縁取りカプセル) ---
  ctx.lineCap = "round";
  for (let i = 0; i < 2; i++) {
    const phase = a.gait + i * Math.PI;
    const swing = Math.cos(phase);
    const lifted = Math.max(0, Math.sin(phase)) * a.walk;
    const hipX = cx + f * (i === 0 ? -spread : spread);
    const footX = hipX + f * stride * swing * a.walk;
    const footY = groundY - lifted * lift;
    const leg = solveIK(hipX, hipY, footX, footY, legLen, legLen, -f);
    ctx.strokeStyle = edgeCol; ctx.lineWidth = legW + 2.4;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(leg.kx, leg.ky); ctx.lineTo(leg.fx, leg.fy); ctx.stroke();
    ctx.strokeStyle = bodyCol; ctx.lineWidth = legW;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(leg.kx, leg.ky); ctx.lineTo(leg.fx, leg.fy); ctx.stroke();
    ctx.fillStyle = bodyCol; ctx.strokeStyle = edgeCol; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(leg.fx + f * 1.2 * s, leg.fy, 3.2 * s, 2.3 * s, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  // --- 上半身グループ (ヨタヨタ揺れ + 前傾) ---
  const tilt = f * 0.05 * a.walk + Math.sin(a.gait) * 0.1 * a.walk;
  ctx.save();
  ctx.translate(cx, hipY);
  ctx.rotate(tilt);

  // 腕 (左右の小さなナブ。前腕は攻撃で突き出す)
  for (let i = 0; i < 2; i++) {
    const front = i === 1;
    const shX = (i === 0 ? -1 : 1) * bw * 0.92;
    const shY = -bh * 0.55;
    const sw = Math.sin(a.gait + (front ? 0 : Math.PI)) * 0.25 * a.walk + (front ? a.lunge * 1.3 : 0);
    const ang = Math.PI * 0.5 + (i === 0 ? 0.6 : -0.6) - f * sw;   // 下〜外向き
    const ex = shX + Math.cos(ang) * 5 * s, ey = shY + Math.sin(ang) * 5 * s;
    ctx.strokeStyle = edgeCol; ctx.lineWidth = 3 * s + 2.4;
    ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = bodyCol; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(ex, ey); ctx.stroke();
  }

  // 胴 (タマゴ・squash & stretch)
  ctx.save();
  ctx.translate(0, -bh * 0.55);
  ctx.scale(sx, sy);
  ctx.beginPath();
  ctx.ellipse(0, 0, bw, bh, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyCol; ctx.fill();
  ctx.lineWidth = 2.4; ctx.strokeStyle = edgeCol; ctx.stroke();
  if (a.hitFlash > 0) { ctx.fillStyle = `rgba(255,70,70,${0.6 * a.hitFlash})`; ctx.fill(); }
  ctx.restore();

  // 顔 (絵文字を体に乗せる・進行方向を向く)
  ctx.save();
  ctx.translate(0, -bh * 0.6);
  ctx.scale(f, 1);
  ctx.font = `${Math.round(16 * s)}px serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(e.emoji, 0, 0);
  ctx.restore();

  ctx.restore();  // 上半身グループ終わり

  // --- HP バー ---
  const pct = Math.max(0, e.hp / e.hpMax);
  const w = 24 * s;
  const hbY = bodyCY - bh - 9 * s;
  ctx.fillStyle = "#000";
  ctx.fillRect(cx - w / 2, hbY, w, 4);
  ctx.fillStyle = e.isAlly ? "#80d8ff" : "#ff8b8b";
  ctx.fillRect(cx - w / 2, hbY, w * pct, 4);
}

// -------- UI ---------------------------------------------------------------
const deck = document.getElementById("deck");
const cardEls = UNITS.map((u, i) => {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <span class="hotkey">${(i+1) % 10}</span>
    <span class="emoji">${u.emoji}</span>
    <span class="name">${u.name}</span>
    <span class="cost">💰${u.cost}</span>
    <span class="cooldown"></span>
  `;
  el.addEventListener("click", () => spawnAlly(u));
  deck.appendChild(el);
  return el;
});

function refreshUI() {
  // HUD
  setBar("ally-hp",  state.allyBaseHp,  state.allyBaseMax);
  setBar("enemy-hp", state.enemyBaseHp, state.enemyBaseMax);
  setBar("money",    state.money,       state.moneyMax);
  document.getElementById("ally-hp-text").textContent  = `${Math.max(0, Math.ceil(state.allyBaseHp))} / ${state.allyBaseMax}`;
  document.getElementById("enemy-hp-text").textContent = `${Math.max(0, Math.ceil(state.enemyBaseHp))} / ${state.enemyBaseMax}`;
  document.getElementById("money-text").textContent    = `${Math.floor(state.money)} / ${state.moneyMax}`;

  // カード
  UNITS.forEach((u, i) => {
    const el = cardEls[i];
    const cd = state.recharges[u.id];
    const canBuy = state.money >= u.cost && cd <= 0 && !state.ended;
    el.classList.toggle("disabled", !canBuy);
    el.querySelector(".cost").classList.toggle("unaffordable", state.money < u.cost);
    const pct = cd > 0 ? cd / u.recharge : 0;
    el.querySelector(".cooldown").style.height = `${pct * 100}%`;
  });
}

function setBar(id, val, max) {
  const pct = Math.max(0, Math.min(1, val / max));
  document.getElementById(`${id}-fill`).style.width = `${pct * 100}%`;
}

function showMessage(msg) {
  document.getElementById("message").textContent = msg;
}

// -------- 入力 -------------------------------------------------------------
document.addEventListener("keydown", (ev) => {
  unlockAudio();
  if (ev.key === "m" || ev.key === "M") {
    muted = !muted;
    showMessage(muted ? "🔇 ミュート" : "🔊 サウンド ON");
    setTimeout(() => { if (!state.ended) showMessage(""); }, 1200);
    return;
  }
  if (ev.key === "r" || ev.key === "R") return reset();
  if (ev.key === "p" || ev.key === "P") return (state.paused = !state.paused);
  if (state.ended) return;
  // 1..9 → slot 0..8, 0 → slot 9
  if (/^[0-9]$/.test(ev.key)) {
    const slot = ev.key === "0" ? 9 : parseInt(ev.key, 10) - 1;
    if (UNITS[slot]) spawnAlly(UNITS[slot]);
  }
});

function reset() {
  state.money = 100;
  state.allyBaseHp  = state.allyBaseMax;
  state.enemyBaseHp = state.enemyBaseMax;
  state.entities = [];
  state.fx = [];
  state.baseFlash = { ally: 0, enemy: 0 };
  UNITS.forEach(u => state.recharges[u.id] = 0);
  state.enemySpawnTimer = 1500;
  state.difficulty = 1;
  state.paused = false;
  state.ended = null;
  showMessage("");
}

// -------- ループ -----------------------------------------------------------
function loop(now) {
  const dt = Math.min(0.05, (now - state.lastTime) / 1000);
  state.lastTime = now;
  update(dt);
  draw();
  refreshUI();
  requestAnimationFrame(loop);
}
requestAnimationFrame((t) => { state.lastTime = t; loop(t); });
