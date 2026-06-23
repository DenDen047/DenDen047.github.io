// =============================================================================
// ラグドール・ランブル
//   Verlet 積分 + 距離拘束で組んだ人型ラグドールを、目標ポーズへ弱く引き寄せる
//   「アクティブ制御」で自立させ、操作可能にした物理格闘アクション。
//   敵ラグドールをパンチ／キックでぶっ飛ばし、ウェーブを生き延びる。
// =============================================================================

// -------- Canvas / 定数 -----------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;      // 960
const H = canvas.height;     // 540
const GROUND_Y = 486;        // 地面（足が乗るライン）
const WALL_PAD = 18;         // 左右の壁

const GRAVITY   = 2100;      // 重力 (px/s^2)
const DT        = 1 / 60;    // 物理固定ステップ
const AIR       = 0.992;     // 空気抵抗（速度の保持率）
const GROUND_FRIC = 0.90;    // 接地時の水平速度の保持率（高め=足が滑り歩ける）
const MAXV      = 42;        // 1ステップあたりの最大移動量（発散防止）
const ITER      = 6;         // 拘束ソルバの反復回数

// 骨盤(pelvis)を原点とした立ちポーズのオフセット（y は下が +）
const POSE = {
  pelvis: { x: 0,   y: 0   },
  chest:  { x: 0,   y: -34 },
  head:   { x: 0,   y: -60 },
  elbowL: { x: -15, y: -18 }, handL: { x: -22, y: 2 },
  elbowR: { x: 15,  y: -18 }, handR: { x: 22,  y: 2 },
  kneeL:  { x: -9,  y: 26  }, footL: { x: -10, y: 52 },
  kneeR:  { x: 9,   y: 26  }, footR: { x: 10,  y: 52 },
};
const BONES = [
  ["head", "chest"], ["chest", "pelvis"],
  ["chest", "elbowL"], ["elbowL", "handL"],
  ["chest", "elbowR"], ["elbowR", "handR"],
  ["pelvis", "kneeL"], ["kneeL", "footL"],
  ["pelvis", "kneeR"], ["kneeR", "footR"],
];

// 制御の強さ（目標ポーズへ毎ステップどれだけ引き寄せるか）
const K_CORE = 0.20;    // 体幹（骨盤・胸・頭）
const K_LIMB = 0.115;   // 手足
const PLAYER_HP = 100;
const GRAB_REACH = 66;  // 掴みが届く前方距離

// 同時にステージへ出せる敵の最大数（超過分はキューで待機し、撃破されると補充）
const MAX_ENEMIES = 3;

// 敵タイプ（ウェーブで強くなる）
const ENEMY_TYPES = [
  { id: "grunt", color: "#e0584f", hpBase: 26, dmg: 6,  reach: 58, atkCD: 1.1, speed: 0.55, scale: 1.0 },
  { id: "brute", color: "#c879ff", hpBase: 48, dmg: 11, reach: 66, atkCD: 1.6, speed: 0.40, scale: 1.22 },
  { id: "swift", color: "#ffae3d", hpBase: 18, dmg: 5,  reach: 54, atkCD: 0.8, speed: 0.85, scale: 0.88 },
];

// 武器タイプ。装備するとパンチが「スイング」になり、リーチ/ダメージ/ノックバックが増す。
// reach は基礎パンチ(70)への加算、dur は耐久（ヒット回数）、len は描画上の長さ。
const WEAPON_TYPES = [
  { id: "bat",   name: "バット",   color: "#d8a866", reach: 26, dmg: 16, kb: 26, dur: 10, len: 30 },
  { id: "pipe",  name: "鉄パイプ", color: "#c2c9d4", reach: 34, dmg: 13, kb: 22, dur: 12, len: 34 },
  { id: "sword", name: "大剣",     color: "#9fe6ff", reach: 32, dmg: 22, kb: 18, dur: 8,  len: 36 },
];
const randWeapon = () => WEAPON_TYPES[Math.floor(Math.random() * WEAPON_TYPES.length)];

// 回復パックの回復量
const HEAL_AMOUNT = 30;

// -------- ゲーム状態 --------------------------------------------------------
const state = {
  fighters: [],
  player: null,
  wave: 0,
  score: 0,
  combo: 0,
  comboTimer: 0,
  spawnQueue: [],     // {type, side, delay}
  items: [],          // ステージ上の拾えるアイテム {kind, wtype, x, y, bob, picked}
  waveBreak: 0,       // ウェーブ間の待ち時間
  shake: 0,
  paused: false,
  muted: false,
  over: false,
  fx: [],
  lastTime: performance.now(),
  acc: 0,
};

// -------- ユーティリティ ----------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
const rand = (a, b) => a + Math.random() * (b - a);

// -------- オーディオ（軽量シンセ） ------------------------------------------
let actx = null;
function audioCtx() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { actx = null; }
  }
  return actx;
}
function beep(freq, dur, type = "square", gain = 0.06) {
  if (state.muted) return;
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
const sfx = {
  punch: () => beep(220, 0.08, "square", 0.05),
  kick:  () => beep(150, 0.14, "sawtooth", 0.06),
  hit:   () => beep(rand(380, 520), 0.10, "triangle", 0.07),
  hurt:  () => beep(110, 0.16, "sawtooth", 0.08),
  jump:  () => beep(440, 0.10, "sine", 0.04),
  grab:  () => beep(330, 0.07, "triangle", 0.05),
  heal:  () => { beep(660, 0.10, "sine", 0.05); setTimeout(() => beep(880, 0.12, "sine", 0.05), 90); },
  wpick: () => { beep(520, 0.08, "square", 0.05); setTimeout(() => beep(700, 0.10, "square", 0.05), 70); },
  wbreak:() => beep(170, 0.16, "square", 0.06),
  ko:    () => beep(80, 0.30, "sawtooth", 0.08),
  wave:  () => { beep(523, 0.12, "square", 0.05); setTimeout(() => beep(784, 0.18, "square", 0.05), 120); },
};

// -------- ファイター生成 ----------------------------------------------------
function makeFighter(x, opts) {
  const scale = opts.scale || 1;
  const pelvisY = GROUND_Y - 52 * scale;
  const points = {};
  for (const k in POSE) {
    const px = x + POSE[k].x * scale;
    const py = pelvisY + POSE[k].y * scale;
    points[k] = { x: px, y: py, px, py };
  }
  const bones = BONES.map(([a, b]) => {
    const dx = points[a].x - points[b].x;
    const dy = points[a].y - points[b].y;
    return { a, b, len: Math.hypot(dx, dy), stiff: 1 };
  });
  return {
    team: opts.team,
    color: opts.color,
    scale,
    points,
    bones,
    hp: opts.hp,
    maxHp: opts.hp,
    dmg: opts.dmg || 0,
    reach: opts.reach || 60,
    atkCD: opts.atkCD || 1,
    speed: opts.speed || 0.5,
    facing: opts.facing || 1,
    alive: true,
    removeT: 0,
    control: 1,        // 制御の有効度（ダウン時に低下、死亡で 0）
    stun: 0,
    grounded: true,
    stepPhase: 0,
    moveDir: 0,
    jumpCD: 0,
    // 攻撃
    punchT: 0, punchArm: "R", attackCD: 0,
    kickT: 0,
    flash: 0,
    // 掴み
    grab: null,        // プレイヤーが掴んでいる相手 {target}
    grabbedBy: null,   // 自分を掴んでいる相手
    // 武器（装備時のみ非 null。{...wtype} のコピーで dur を個体管理）
    weapon: null,
    // 敵 AI
    ai: opts.team === "enemy" ? { mode: "approach", timer: rand(0.2, 0.8) } : null,
  };
}

function spawnPlayer() {
  state.player = makeFighter(W * 0.5, {
    team: "player", color: "#4fc3f7", hp: PLAYER_HP, facing: 1,
  });
  state.fighters.push(state.player);
}

function spawnEnemy(type, side) {
  const x = side < 0 ? WALL_PAD + 40 : W - WALL_PAD - 40;
  const hp = type.hpBase + state.wave * 4;
  const f = makeFighter(x, {
    team: "enemy", color: type.color, hp,
    dmg: type.dmg + Math.floor(state.wave * 0.6),
    reach: type.reach, atkCD: type.atkCD, speed: type.speed, scale: type.scale,
    facing: -side,
  });
  state.fighters.push(f);
}

// -------- 物理: 1点の積分 ---------------------------------------------------
function integrate(p) {
  let vx = (p.x - p.px) * AIR;
  let vy = (p.y - p.py) * AIR;
  vx = clamp(vx, -MAXV, MAXV);
  vy = clamp(vy, -MAXV, MAXV);
  p.px = p.x;
  p.py = p.y;
  p.x += vx;
  p.y += vy + GRAVITY * DT * DT;
}

// 目標位置へ弱く引き寄せる
function pull(p, tx, ty, k) {
  p.x += (tx - p.x) * k;
  p.y += (ty - p.y) * k;
}

// -------- 物理: アクティブ制御（立ち・歩き） --------------------------------
function applyControl(f) {
  if (f.control <= 0) return;
  const p = f.points;
  const c = f.control;
  // 接地時は速度を減衰してバネ制御の振動（その場で跳ね続ける現象）を抑える。
  // 空中・吹き飛び中(control低下)は減衰させず、ジャンプとノックバックを殺さない。
  if (f.grounded) {
    const dx = 0.10 * c, dy = 0.50 * c;   // 縦を強く減衰（跳ね防止）、横は弱く（歩行慣性を残す）
    for (const k in p) {
      const pt = p[k];
      pt.px += (pt.x - pt.px) * dx;
      pt.py += (pt.y - pt.py) * dy;
    }
  }
  const kc = K_CORE * c;
  const kl = K_LIMB * c;
  const s = f.scale;
  const baseX = p.pelvis.x;
  const moving = f.moveDir !== 0;

  // 体幹: 骨盤を立ち高さへ、胸と頭をその上へ
  if (f.grounded) pull(p.pelvis, baseX, GROUND_Y - 52 * s, kc);
  const lean = f.moveDir * 6;           // 進行方向へ少し前傾
  pull(p.chest, baseX + lean, p.pelvis.y - 34 * s, kc);
  pull(p.head,  baseX + lean * 1.3, p.chest.y - 26 * s, kc);

  // 脚: 歩行アニメ（移動中だけ位相を進める）
  const sp = f.stepPhase;
  const swing = moving ? 1 : 0;
  const footBase = f.grounded ? GROUND_Y : p.pelvis.y + 52 * s;
  const lfx = baseX + (-10 + Math.cos(sp) * 9 * swing) * s;
  const rfx = baseX + (10 + Math.cos(sp + Math.PI) * 9 * swing) * s;
  const lLift = f.grounded ? Math.max(0, Math.sin(sp)) * 16 * swing : 0;
  const rLift = f.grounded ? Math.max(0, Math.sin(sp + Math.PI)) * 16 * swing : 0;
  // 足は「縦は強く（接地・ステップ）／横は弱く（滑らせて歩く）」。
  // 横を強く引くと立脚がアンカーになり骨盤を引き戻して歩けなくなる。
  const kFootX = kl * 0.18;
  p.footL.y += (footBase - lLift - p.footL.y) * kl;
  p.footL.x += (lfx - p.footL.x) * kFootX;
  p.footR.y += (footBase - rLift - p.footR.y) * kl;
  p.footR.x += (rfx - p.footR.x) * kFootX;
  // 膝は骨盤と足の中間を前に張り出す（逆関節防止）
  pull(p.kneeL, (p.pelvis.x + lfx) / 2 + f.facing * 4, (p.pelvis.y + footBase) / 2, kl * 0.6);
  pull(p.kneeR, (p.pelvis.x + rfx) / 2 + f.facing * 4, (p.pelvis.y + footBase) / 2, kl * 0.6);

  // 腕: パンチ中でなければ腰横へ（歩行で前後にスイング）
  const armSwing = Math.cos(sp) * 8 * swing;
  if (f.punchT <= 0) {
    pull(p.handL, baseX - 20 * s - armSwing, p.pelvis.y + 2 * s, kl * 0.7);
    pull(p.elbowL, baseX - 16 * s, p.chest.y + 4 * s, kl * 0.7);
    pull(p.handR, baseX + 20 * s + armSwing, p.pelvis.y + 2 * s, kl * 0.7);
    pull(p.elbowR, baseX + 16 * s, p.chest.y + 4 * s, kl * 0.7);
  } else {
    // パンチ: 前方へ腕を伸ばす（強めに引っ張ってキレを出す）
    const ext = (1 - Math.abs(f.punchT - 0.09) / 0.09);  // 0→1→0
    const reach = (24 + 30 * clamp(ext, 0, 1)) * s;
    const arm = f.punchArm;
    const hand = arm === "R" ? p.handR : p.handL;
    const elbow = arm === "R" ? p.elbowR : p.elbowL;
    const idle = arm === "R" ? p.handL : p.handR;
    const idleE = arm === "R" ? p.elbowL : p.elbowR;
    pull(hand, p.chest.x + f.facing * reach, p.chest.y + 2 * s, 0.4);
    pull(elbow, p.chest.x + f.facing * reach * 0.5, p.chest.y - 2 * s, 0.35);
    // 反対の腕はガード
    pull(idle, p.chest.x - f.facing * 8 * s, p.chest.y + 2 * s, kl);
    pull(idleE, p.chest.x - f.facing * 12 * s, p.chest.y, kl);
  }
}

// -------- 物理: 拘束と地面 --------------------------------------------------
function solveBones(f) {
  const p = f.points;
  for (const b of f.bones) {
    const a = p[b.a], c = p[b.b];
    const dx = c.x - a.x, dy = c.y - a.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    const diff = ((d - b.len) / d) * 0.5 * b.stiff;
    const ox = dx * diff, oy = dy * diff;
    a.x += ox; a.y += oy;
    c.x -= ox; c.y -= oy;
  }
}

function collide(f) {
  const p = f.points;
  for (const k in p) {
    const pt = p[k];
    // 地面
    if (pt.y > GROUND_Y) {
      pt.y = GROUND_Y;
      const vx = pt.x - pt.px;
      pt.px = pt.x - vx * GROUND_FRIC;   // 接地摩擦
    }
    // 壁
    if (pt.x < WALL_PAD) { pt.x = WALL_PAD; pt.px = pt.x + (pt.px - pt.x) * 0.5; }
    if (pt.x > W - WALL_PAD) { pt.x = W - WALL_PAD; pt.px = pt.x + (pt.px - pt.x) * 0.5; }
    // 天井
    if (pt.y < 4) { pt.y = 4; }
  }
}

// 同じ高さに重なったファイター同士を軽く押し離す
function separate() {
  const fs = state.fighters;
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i].points.pelvis, b = fs[j].points.pelvis;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dy) > 60) continue;
      const d = Math.abs(dx);
      const minD = 30;
      if (d < minD && d > 0.01) {
        const push = (minD - d) * 0.12 * sign(dx);
        a.x -= push; b.x += push;
      }
    }
  }
}

// -------- 物理ステップ ------------------------------------------------------
function physicsStep() {
  for (const f of state.fighters) for (const k in f.points) integrate(f.points[k]);
  for (const f of state.fighters) applyControl(f);
  for (const f of state.fighters) if (f.grab) holdGrab(f);
  for (let it = 0; it < ITER; it++) {
    for (const f of state.fighters) solveBones(f);
    for (const f of state.fighters) collide(f);
  }
  separate();
  for (const f of state.fighters) {
    f.grounded = f.points.footL.y >= GROUND_Y - 6 || f.points.footR.y >= GROUND_Y - 6;
  }
}

// -------- 衝撃: ファイターへ速度を与える ------------------------------------
function applyImpulse(f, vx, vy, focus) {
  // focus 指定があればその点を強く、全体にも分散
  for (const k in f.points) {
    const w = focus && k === focus ? 1.4 : 0.7;
    f.points[k].x += vx * w;
    f.points[k].y += vy * w;
  }
}

// -------- 攻撃判定（円弧ヒットスキャン） ------------------------------------
function attackHit(attacker, range, vy, dmg, kb, kind) {
  const origin = attacker.points.chest;
  const face = attacker.facing;
  let landed = false;
  for (const t of state.fighters) {
    if (t === attacker || t.team === attacker.team || !t.alive) continue;
    for (const core of ["chest", "pelvis", "head"]) {
      const tp = t.points[core];
      const dx = tp.x - origin.x;
      const dy = tp.y - origin.y;
      if (dx * face < -14) continue;             // 後ろは当たらない
      if (Math.abs(dy) > 48 * attacker.scale) continue;
      if (Math.abs(dx) > range) continue;
      // ヒット
      t.hp -= dmg;
      applyImpulse(t, face * kb, vy, core);
      t.stun = Math.max(t.stun, kind === "kick" ? 0.55 : 0.35);
      t.control = Math.min(t.control, kind === "kick" ? 0.15 : 0.45);
      t.flash = 0.12;
      spawnHitFx(tp.x, tp.y, face, kind);
      state.shake = Math.min(16, state.shake + (kind === "kick" ? 10 : 6));
      sfx.hit();
      if (attacker.team === "player") {
        state.combo++;
        state.comboTimer = 2.2;
        if (t.hp <= 0) onKO(t);
      } else if (t === state.player) {
        sfx.hurt();
      }
      landed = true;
      break;   // 1体につき1ヒット
    }
  }
  return landed;
}

function onKO(t) {
  if (!t.alive) return;
  t.alive = false;
  t.control = 0;            // 完全に脱力（ぐにゃり）
  t.removeT = 2.4;
  for (const b of t.bones) b.stiff = 0.6;
  state.score += 100 + state.wave * 10;
  if (state.combo > 1) state.score += state.combo * 5;
  spawnKoFx(t.points.chest.x, t.points.chest.y, t.color);
  sfx.ko();
  state.shake = Math.min(20, state.shake + 12);
}

// -------- プレイヤー操作 ----------------------------------------------------
function startPunch(f, dir) {
  if (f.attackCD > 0 || !f.alive) return;
  if (dir) f.facing = dir;
  const w = f.weapon;
  if (w) {
    // 武器スイング: 武器を持つ右手を大きく振る
    f.punchArm = "R";
    f.punchT = 0.22;
    f.attackCD = 0.36;
    sfx.kick();
    applyImpulse(f, f.facing * 2.6, 0, "chest");
    const landed = attackHit(f, (70 + w.reach) * f.scale, -5, w.dmg, w.kb, "kick");
    if (landed) consumeWeapon(f);
  } else {
    f.punchArm = f.punchArm === "R" ? "L" : "R";
    f.punchT = 0.18;
    f.attackCD = 0.30;
    sfx.punch();
    // 少し踏み込み
    applyImpulse(f, f.facing * 2.2, 0, "chest");
    attackHit(f, 70 * f.scale, -3, 9, 11, "punch");
  }
}

// 武器を1ヒット消耗し、耐久が尽きたら壊す
function consumeWeapon(f) {
  const w = f.weapon;
  if (!w) return;
  w.dur -= 1;
  if (w.dur <= 0) breakWeapon(f);
}
function breakWeapon(f) {
  if (!f.weapon) return;
  spawnHitFx(f.points.handR.x, f.points.handR.y, f.facing, "punch");
  spawnPickFx(f.points.handR.x, f.points.handR.y - 10, "#888", "壊れた！");
  f.weapon = null;
  sfx.wbreak();
}

function startKick(f, dir) {
  if (f.attackCD > 0 || !f.alive) return;
  f.kickT = 0.26;
  f.attackCD = 0.55;
  if (dir) f.facing = dir;
  sfx.kick();
  applyImpulse(f, f.facing * 3.0, -1, "pelvis");
  attackHit(f, 86 * f.scale, -6, 16, 20, "kick");
}

function jump(f) {
  if (!f.grounded || f.jumpCD > 0 || !f.alive) return;
  for (const k in f.points) f.points[k].y -= 13;   // 上向き速度を付与
  f.jumpCD = 0.4;
  sfx.jump();
}

// 前方リーチ内に倒せる相手がいるか（自動パンチの発火判定。attackHit と同じ形状）
function enemyInReach(f, range) {
  const origin = f.points.chest;
  for (const t of state.fighters) {
    if (t.team === f.team || !t.alive) continue;
    const dx = t.points.chest.x - origin.x;
    const dy = t.points.chest.y - origin.y;
    if (dx * f.facing < -14) continue;            // 後ろは対象外
    if (Math.abs(dy) > 48 * f.scale) continue;
    if (Math.abs(dx) <= range) return true;
  }
  return false;
}

// 掴む / 既に掴んでいれば投げる
function grabOrThrow(f) {
  if (!f.alive) return;
  if (f.grab) { throwGrabbed(f); return; }
  const origin = f.points.chest;
  let best = null, bd = Infinity;
  for (const t of state.fighters) {
    if (t.team === f.team || !t.alive || t.grabbedBy) continue;
    const dx = t.points.chest.x - origin.x;
    const dy = t.points.chest.y - origin.y;
    if (dx * f.facing < -10) continue;            // 前方のみ
    if (Math.abs(dy) > 50 * f.scale) continue;
    const d = Math.abs(dx);
    if (d > GRAB_REACH * f.scale) continue;
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return;
  f.grab = { target: best };
  best.grabbedBy = f;
  best.stun = Math.max(best.stun, 0.2);
  best.control = Math.min(best.control, 0.12);    // ぐにゃりと脱力させる
  if (best.ai) best.ai.mode = "approach";         // 溜め攻撃をキャンセル
  sfx.grab();
}

// 掴んでいる相手を前方へ投げ飛ばす
function throwGrabbed(f) {
  const g = f.grab;
  f.grab = null;
  const t = g && g.target;
  if (!t) return;
  t.grabbedBy = null;
  if (!t.alive) return;
  applyImpulse(t, f.facing * 16, -7, "chest");
  t.stun = 0.5;
  t.control = 0.1;
  t.hp -= 12;
  t.flash = 0.12;
  spawnHitFx(t.points.chest.x, t.points.chest.y, f.facing, "kick");
  state.shake = Math.min(18, state.shake + 10);
  sfx.kick();
  if (f.team === "player") {
    if (t.hp <= 0) onKO(t);
    else { state.combo++; state.comboTimer = 2.2; }
  }
}

// 掴み中: 相手を前方の手元へ毎ステップ引き寄せて保持する
function holdGrab(f) {
  const t = f.grab.target;
  if (!t || !t.alive || t.grabbedBy !== f) {
    if (t) t.grabbedBy = null;
    f.grab = null;
    return;
  }
  const s = f.scale;
  const hx = f.points.chest.x + f.facing * 46 * s;
  const hy = f.points.chest.y + 4 * s;
  pull(t.points.chest, hx, hy, 0.4);
  pull(t.points.pelvis, hx - f.facing * 4, hy + 22 * t.scale, 0.22);
  t.control = Math.min(t.control, 0.12);
  t.stun = Math.max(t.stun, 0.15);                // AI 行動と自走を抑止
  // プレイヤーの手を掴んだ相手へ伸ばす（見た目）
  pull(f.points.handR, hx, hy, 0.5);
  pull(f.points.handL, hx, hy, 0.5);
}

// -------- 入力 --------------------------------------------------------------
const keys = {};
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(k)) e.preventDefault();
  if (e.repeat) return;
  if (k === "p") { togglePause(); return; }
  if (k === "m") { state.muted = !state.muted; return; }
  if (k === "r") { resetGame(); return; }
  const p = state.player;
  if (!p || !p.alive || state.paused || state.over) { keys[k] = true; return; }
  if (k === "arrowup" || k === "w") jump(p);
  if (k === " ") grabOrThrow(p);
  if (k === "j") startPunch(p, p.facing);
  if (k === "k") startKick(p, p.facing);
  keys[k] = true;
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const p = state.player;
  if (!p || !p.alive || state.paused || state.over) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (W / rect.width);
  const dir = sign(mx - p.points.chest.x) || p.facing;
  if (e.button === 2) startKick(p, dir);
  else startPunch(p, dir);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function togglePause() {
  if (state.over) return;
  state.paused = !state.paused;
  showMessage(state.paused ? "一時停止" : "", state.paused ? "P で再開" : "");
}

// -------- ウェーブ管理 ------------------------------------------------------
function startWave(n) {
  state.wave = n;
  const count = 2 + Math.floor(n * 1.5);
  state.spawnQueue = [];
  let delay = 0.3;
  for (let i = 0; i < count; i++) {
    // 序盤は雑魚多め、ウェーブが進むと強敵が混ざる
    let pool = ENEMY_TYPES.slice(0, Math.min(ENEMY_TYPES.length, 1 + Math.floor(n / 2)));
    const type = pool[Math.floor(Math.random() * pool.length)];
    state.spawnQueue.push({ type, side: i % 2 === 0 ? -1 : 1, delay });
    delay += rand(0.5, 1.1);
  }
  spawnStageItems();   // ステージごとに回復パックと武器を供給
  sfx.wave();
  showMessage("WAVE " + n, count + " 体の敵が来るぞ！");
  setTimeout(() => hideMessage(), 1600);
  updateHud();
}

function enemiesRemaining() {
  return state.fighters.some((f) => f.team === "enemy" && f.alive) || state.spawnQueue.length > 0;
}

// -------- アイテム（武器 / 回復） --------------------------------------------
function spawnItem(kind, wtype) {
  state.items.push({
    kind, wtype: wtype || null,
    x: rand(W * 0.22, W * 0.78), y: GROUND_Y - 22,
    bob: rand(0, Math.PI * 2), picked: false,
  });
}

// ステージごとに供給: 回復パックと武器（重複が場に無いときだけ補充）
function spawnStageItems() {
  if (!state.items.some((i) => i.kind === "heart")) spawnItem("heart");
  const hasWeapon = state.player && state.player.weapon;
  if (!hasWeapon && !state.items.some((i) => i.kind === "weapon")) spawnItem("weapon", randWeapon());
}

function pickUpItem(p, it) {
  if (it.kind === "heart") {
    p.hp = Math.min(p.maxHp, p.hp + HEAL_AMOUNT);
    spawnPickFx(it.x, it.y, "#7ff07f", "+" + HEAL_AMOUNT);
    sfx.heal();
  } else if (it.kind === "weapon") {
    p.weapon = { ...it.wtype };   // 個体コピー（耐久を独立管理）
    spawnPickFx(it.x, it.y, it.wtype.color, it.wtype.name);
    sfx.wpick();
  }
}

function updateItems(dt) {
  for (const it of state.items) it.bob += dt * 3;
  const p = state.player;
  if (p && p.alive) {
    const px = p.points.pelvis.x, py = p.points.pelvis.y;
    for (const it of state.items) {
      if (it.picked) continue;
      const iy = it.y - Math.sin(it.bob) * 4;
      if (Math.abs(it.x - px) < 28 && Math.abs(iy - py) < 64) {
        it.picked = true;
        pickUpItem(p, it);
      }
    }
  }
  if (state.items.some((i) => i.picked)) {
    state.items = state.items.filter((i) => !i.picked);
  }
}

// -------- 敵 AI -------------------------------------------------------------
function updateEnemyAI(f, dt) {
  const p = state.player;
  if (!f.alive || !p) { f.moveDir = 0; return; }
  const dx = p.points.chest.x - f.points.chest.x;
  const dist = Math.abs(dx);
  f.facing = sign(dx) || f.facing;
  const ai = f.ai;
  ai.timer -= dt;

  if (f.stun > 0) { f.moveDir = 0; return; }

  if (ai.mode === "approach") {
    if (dist > f.reach * 0.9) {
      f.moveDir = sign(dx);
      // たまにジャンプ（swift）
      if (f.speed > 0.7 && f.grounded && Math.random() < 0.006) jump(f);
    } else {
      f.moveDir = 0;
      if (f.attackCD <= 0 && p.alive) { ai.mode = "windup"; ai.timer = 0.32; f.flash = 0.32; }
    }
  } else if (ai.mode === "windup") {
    f.moveDir = 0;
    if (ai.timer <= 0) {
      // 攻撃発動
      attackHit(f, f.reach, -4, f.dmg, 9, "punch");
      f.punchT = 0.18;
      f.punchArm = Math.random() < 0.5 ? "R" : "L";
      f.attackCD = f.atkCD;
      ai.mode = "approach";
      sfx.punch();
    }
  }
}

// -------- ロジック更新（フレーム毎） ----------------------------------------
function updateLogic(dt) {
  const p = state.player;

  // プレイヤー移動意思
  if (p && p.alive) {
    const left = keys["arrowleft"] || keys["a"];
    const right = keys["arrowright"] || keys["d"];
    p.moveDir = (right ? 1 : 0) - (left ? 1 : 0);
    // 敵がいれば近い敵の方を向く（攻撃の素直さ優先）。移動中は移動方向。
    // 掴み中は手元の相手が最近接になるため、向きを自動反転させない。
    if (p.moveDir !== 0) {
      p.facing = p.moveDir;
    } else if (!p.grab) {
      const e = nearestEnemy(p);
      if (e) p.facing = sign(e.points.chest.x - p.points.chest.x) || p.facing;
    }
    // 歩くだけで攻撃: 移動中、前方リーチ内に敵がいれば自動でパンチ（掴み中は除く）
    if (!p.grab && p.moveDir !== 0 && p.grounded && p.attackCD <= 0 &&
        enemyInReach(p, 70 * p.scale)) {
      startPunch(p, p.facing);
    }
  }

  // 各ファイターのタイマー・AI
  for (const f of state.fighters) {
    if (f.attackCD > 0) f.attackCD -= dt;
    if (f.punchT > 0) f.punchT -= dt;
    if (f.kickT > 0) f.kickT -= dt;
    if (f.jumpCD > 0) f.jumpCD -= dt;
    if (f.flash > 0) f.flash -= dt;
    if (f.stun > 0) { f.stun -= dt; if (f.stun <= 0 && f.alive) f.stun = 0; }
    // 制御の回復（ダウンから立ち直る）
    if (f.alive) {
      const target = f.stun > 0 ? f.control : 1;
      f.control += (target - f.control) * Math.min(1, dt * 3);
      if (f.stun <= 0) f.control = Math.min(1, f.control + dt * 1.5);
    }
    // 歩行位相
    if (f.moveDir !== 0 && f.grounded) f.stepPhase += dt * 12;
    // AI
    if (f.team === "enemy") updateEnemyAI(f, dt);
    // 水平移動: 体全体に速度を与え、最大速度で頭打ちにする（接地時のみ）
    if (f.alive && f.moveDir !== 0 && f.grounded && f.stun <= 0) {
      const cur = f.points.pelvis.x - f.points.pelvis.px;
      const maxSpd = 2.6 + f.speed * 2.2;
      if (Math.abs(cur) < maxSpd) {
        const add = f.moveDir * (0.9 + f.speed * 1.4);
        for (const k in f.points) f.points[k].x += add;
      }
    }
  }

  // 死亡ファイターの撤去
  for (const f of state.fighters) {
    if (!f.alive) { f.removeT -= dt; }
  }
  state.fighters = state.fighters.filter((f) => f.alive || f.removeT > 0 || f === state.player);

  // スポーン処理（ステージ上の生存敵は最大 MAX_ENEMIES 体まで）
  for (const item of state.spawnQueue) item.delay -= dt;
  let aliveEnemies = state.fighters.filter((f) => f.team === "enemy" && f.alive).length;
  while (state.spawnQueue.length && state.spawnQueue[0].delay <= 0 && aliveEnemies < MAX_ENEMIES) {
    const it = state.spawnQueue.shift();
    spawnEnemy(it.type, it.side);
    aliveEnemies++;
  }

  // ウェーブ進行
  if (!state.over) {
    if (!enemiesRemaining() && state.waveBreak <= 0) {
      state.waveBreak = 1.6;
      // クリアボーナス & 少し回復
      if (p && p.alive) {
        p.hp = Math.min(p.maxHp, p.hp + 25);
        state.score += 200;
      }
    }
    if (state.waveBreak > 0) {
      state.waveBreak -= dt;
      if (state.waveBreak <= 0) startWave(state.wave + 1);
    }
  }

  // コンボタイマー
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) state.combo = 0;
  }

  // ゲームオーバー判定
  if (p && p.alive && p.hp <= 0) {
    p.hp = 0;
    onPlayerDeath();
  }

  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 40);

  updateItems(dt);
  updateFx(dt);
  updateHud();
}

function nearestEnemy(p) {
  let best = null, bd = Infinity;
  for (const f of state.fighters) {
    if (f.team !== "enemy" || !f.alive) continue;
    const d = Math.abs(f.points.chest.x - p.points.chest.x);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function onPlayerDeath() {
  const p = state.player;
  if (p.grab) { if (p.grab.target) p.grab.target.grabbedBy = null; p.grab = null; }
  p.alive = false;
  p.control = 0;
  for (const b of p.bones) b.stiff = 0.6;
  state.over = true;
  sfx.ko();
  showMessage("GAME OVER", "WAVE " + state.wave + " / SCORE " + state.score + "　— R でリトライ");
}

// -------- エフェクト --------------------------------------------------------
function spawnHitFx(x, y, dir, kind) {
  const n = kind === "kick" ? 14 : 9;
  for (let i = 0; i < n; i++) {
    const a = rand(-0.9, 0.9) + (dir > 0 ? 0 : Math.PI);
    const sp = rand(80, kind === "kick" ? 360 : 240);
    state.fx.push({
      type: "spark", x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: rand(0.2, 0.45), t: 0, col: kind === "kick" ? "#ffd86b" : "#fff",
    });
  }
  state.fx.push({ type: "ring", x, y, life: 0.22, t: 0, r0: 6, r1: kind === "kick" ? 42 : 30 });
}
function spawnKoFx(x, y, col) {
  for (let i = 0; i < 22; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(60, 300);
    state.fx.push({
      type: "spark", x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
      life: rand(0.4, 0.9), t: 0, col,
    });
  }
  state.fx.push({ type: "text", x, y, text: "K.O.", life: 0.9, t: 0 });
}
// アイテム取得時の小さなはじけ + ラベル
function spawnPickFx(x, y, col, label) {
  for (let i = 0; i < 12; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(60, 190);
    state.fx.push({
      type: "spark", x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      life: rand(0.3, 0.6), t: 0, col,
    });
  }
  state.fx.push({ type: "text", x, y, text: label, life: 0.9, t: 0, col });
}
function updateFx(dt) {
  for (const e of state.fx) {
    e.t += dt;
    if (e.type === "spark") {
      e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 600 * dt;
    }
  }
  state.fx = state.fx.filter((e) => e.t < e.life);
}

// -------- 描画 --------------------------------------------------------------
function line(a, b, w, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawFighter(f) {
  const p = f.points;
  const s = f.scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const dead = !f.alive;
  let body = f.color;
  if (dead) body = "#6b6477";
  if (f.flash > 0) body = "#ffffff";

  // 影
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(p.pelvis.x, GROUND_Y + 6, 26 * s, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 脚
  line(p.pelvis, p.kneeL, 9 * s, body);
  line(p.kneeL, p.footL, 7 * s, body);
  line(p.pelvis, p.kneeR, 9 * s, body);
  line(p.kneeR, p.footR, 7 * s, body);
  // 足先
  ctx.fillStyle = dead ? "#555" : "#2a2a3a";
  for (const fp of [p.footL, p.footR]) {
    ctx.beginPath();
    ctx.ellipse(fp.x + f.facing * 4, fp.y, 7 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 胴
  line(p.pelvis, p.chest, 15 * s, body);

  // 腕
  line(p.chest, p.elbowL, 8 * s, body);
  line(p.elbowL, p.handL, 6 * s, body);
  line(p.chest, p.elbowR, 8 * s, body);
  line(p.elbowR, p.handR, 6 * s, body);
  // 拳
  ctx.fillStyle = body;
  for (const hp of [p.handL, p.handR]) {
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // 装備中の武器（右手に握る）
  if (f.weapon && f.alive) {
    const w = f.weapon;
    const hand = p.handR;
    const swinging = f.punchT > 0;
    const tx = hand.x + f.facing * w.len * s;
    const ty = hand.y + (swinging ? -w.len * 0.35 : w.len * 0.42) * s;
    ctx.lineCap = "round";
    ctx.strokeStyle = w.color;
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  // 頭
  const hr = 13 * s;
  ctx.fillStyle = dead ? "#6b6477" : f.flash > 0 ? "#fff" : f.team === "player" ? "#7fd9ff" : f.color;
  ctx.beginPath();
  ctx.arc(p.head.x, p.head.y, hr, 0, Math.PI * 2);
  ctx.fill();
  // 顔
  ctx.fillStyle = "#1a1a2a";
  const ex = f.facing * 4 * s;
  if (dead) {
    // ×_× の目
    ctx.strokeStyle = "#1a1a2a"; ctx.lineWidth = 2;
    for (const sx of [-4, 5]) {
      ctx.beginPath();
      ctx.moveTo(p.head.x + sx * s - 2, p.head.y - 4); ctx.lineTo(p.head.x + sx * s + 2, p.head.y);
      ctx.moveTo(p.head.x + sx * s + 2, p.head.y - 4); ctx.lineTo(p.head.x + sx * s - 2, p.head.y);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(p.head.x + ex - 3 * s, p.head.y - 2, 1.8 * s, 0, Math.PI * 2);
    ctx.arc(p.head.x + ex + 4 * s, p.head.y - 2, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // 敵の HP バー
  if (f.team === "enemy" && f.alive) {
    const bw = 34 * s, bx = p.head.x - bw / 2, by = p.head.y - hr - 10;
    ctx.fillStyle = "#000a";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
    ctx.fillStyle = "#e0584f";
    ctx.fillRect(bx, by, bw * clamp(f.hp / f.maxHp, 0, 1), 4);
  }
  // ウィンドアップ表示（!）
  if (f.team === "enemy" && f.ai && f.ai.mode === "windup") {
    ctx.fillStyle = "#ffd86b";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("!", p.head.x, p.head.y - hr - 14);
  }
}

function drawFx() {
  for (const e of state.fx) {
    const a = 1 - e.t / e.life;
    if (e.type === "spark") {
      ctx.fillStyle = e.col;
      ctx.globalAlpha = a;
      ctx.fillRect(e.x - 2, e.y - 2, 4, 4);
    } else if (e.type === "ring") {
      const r = e.r0 + (e.r1 - e.r0) * (e.t / e.life);
      ctx.strokeStyle = "#fff";
      ctx.globalAlpha = a * 0.8;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (e.type === "text") {
      ctx.globalAlpha = a;
      ctx.fillStyle = e.col || "#fff";
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(e.text, e.x, e.y - 20 - e.t * 40);
    }
  }
  ctx.globalAlpha = 1;
}

// アイテム（地面の回復パック / 武器）を描く
function drawItems() {
  for (const it of state.items) {
    const y = it.y - Math.sin(it.bob) * 4;
    // 接地の光輪
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.beginPath();
    ctx.ellipse(it.x, GROUND_Y + 4, 16, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (it.kind === "heart") {
      // 回復パック: 緑の角丸 + 白十字
      ctx.fillStyle = "#2fa84f";
      ctx.strokeStyle = "#bfffce";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(it.x - 12, y - 12, 24, 24);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillRect(it.x - 2.5, y - 8, 5, 16);
      ctx.fillRect(it.x - 8, y - 2.5, 16, 5);
    } else {
      // 武器: 斜めに置かれた得物
      const w = it.wtype;
      ctx.lineCap = "round";
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(it.x - 15, y + 9);
      ctx.lineTo(it.x + 15, y - 9);
      ctx.stroke();
      // グリップ
      ctx.strokeStyle = "#3a2a1a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(it.x - 15, y + 9);
      ctx.lineTo(it.x - 7, y + 4);
      ctx.stroke();
      // 名称ラベル
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(w.name, it.x, y - 16);
    }
  }
}

function drawBackground() {
  // 空のグラデーション
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#241b3a");
  g.addColorStop(0.7, "#3a2a52");
  g.addColorStop(1, "#221833");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 遠景の山影
  ctx.fillStyle = "#2a2040";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  for (let x = 0; x <= W; x += 120) {
    ctx.lineTo(x + 60, GROUND_Y - 70 - ((x / 120) % 3) * 26);
    ctx.lineTo(x + 120, GROUND_Y);
  }
  ctx.fill();
  // 地面
  const gg = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  gg.addColorStop(0, "#3b6b3a");
  gg.addColorStop(1, "#22401f");
  ctx.fillStyle = gg;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = "#5a8a4a";
  ctx.fillRect(0, GROUND_Y, W, 4);
}

function render() {
  ctx.save();
  if (state.shake > 0) {
    ctx.translate(rand(-state.shake, state.shake) * 0.4, rand(-state.shake, state.shake) * 0.4);
  }
  drawBackground();
  drawItems();
  // 死体→生存の順で描画（生存が前面）
  const ordered = [...state.fighters].sort((a, b) => (a.alive === b.alive ? 0 : a.alive ? 1 : -1));
  for (const f of ordered) if (f !== state.player) drawFighter(f);
  if (state.player) drawFighter(state.player);
  drawFx();
  ctx.restore();
}

// -------- HUD / メッセージ --------------------------------------------------
const hpFill = document.getElementById("hp-fill");
const hpText = document.getElementById("hp-text");
const waveText = document.getElementById("wave-text");
const scoreText = document.getElementById("score-text");
const comboText = document.getElementById("combo-text");
const weaponText = document.getElementById("weapon-text");
const msgEl = document.getElementById("message");

function updateHud() {
  const p = state.player;
  const hp = p ? Math.max(0, Math.round(p.hp)) : 0;
  const mx = p ? p.maxHp : PLAYER_HP;
  hpFill.style.width = (hp / mx * 100) + "%";
  hpFill.style.background = hp > mx * 0.3
    ? "linear-gradient(90deg, #b6f15a, #5ad65a)"
    : "linear-gradient(90deg, #ff8b3d, #e0584f)";
  hpText.textContent = hp + " / " + mx;
  waveText.textContent = state.wave;
  scoreText.textContent = state.score;
  comboText.textContent = state.combo;
  if (weaponText) {
    weaponText.textContent = p && p.weapon ? p.weapon.name + " ×" + p.weapon.dur : "素手";
  }
}

function showMessage(main, sub) {
  if (!main) { hideMessage(); return; }
  msgEl.innerHTML = main + (sub ? '<span class="sub">' + sub + "</span>" : "");
  msgEl.classList.add("show");
}
function hideMessage() { msgEl.classList.remove("show"); }

// -------- ゲームリセット ----------------------------------------------------
function resetGame() {
  state.fighters = [];
  state.player = null;
  state.wave = 0;
  state.score = 0;
  state.combo = 0;
  state.comboTimer = 0;
  state.spawnQueue = [];
  state.items = [];
  state.waveBreak = 0;
  state.shake = 0;
  state.over = false;
  state.paused = false;
  state.fx = [];
  hideMessage();
  spawnPlayer();
  startWave(1);
}

// -------- メインループ ------------------------------------------------------
function frame(now) {
  let dt = (now - state.lastTime) / 1000;
  state.lastTime = now;
  dt = clamp(dt, 0, 0.05);

  if (!state.paused) {
    updateLogic(dt);
    state.acc += dt;
    let steps = 0;
    while (state.acc >= DT && steps < 5) {
      physicsStep();
      state.acc -= DT;
      steps++;
    }
  }
  render();
  requestAnimationFrame(frame);
}

resetGame();
requestAnimationFrame(frame);
