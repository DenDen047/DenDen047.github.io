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

function drawEntity(e) {
  // 影
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(e.x, GROUND_Y, 14, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // 本体 (alpha=1 に戻さないとカラー絵文字が薄く描かれる: macOS Chrome/Safari)
  ctx.fillStyle = "#000";
  ctx.font = "26px serif";
  ctx.textAlign = "center";
  ctx.fillText(e.emoji, e.x, e.y);
  // HPバー
  const pct = Math.max(0, e.hp / e.hpMax);
  const w = 28;
  ctx.fillStyle = "#000";
  ctx.fillRect(e.x - w/2, e.y - 28, w, 4);
  ctx.fillStyle = e.isAlly ? "#80d8ff" : "#ff8b8b";
  ctx.fillRect(e.x - w/2, e.y - 28, w * pct, 4);
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
