/* =========================================================================
   MECH RAIDERS ― フィールド（戦闘本体）
   世界生成 / プレイヤー機 / 弾 / ダメージ / 目標 / 敵AI / ボス
   描画は render.js が Field.prototype に足す。
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData;
const { TAU, clamp, lerp, dist, dist2, angTo, angDiff, angApproach, deg,
        RNG, rnd, rndi, pick, circleRect, segRect, segCircle,
        Particles, FloatText, Camera } = C;

/* ============================ 装備の実効値 ============================ */
/* 所持データ（lv / lb）と特性から、実際に使う数値を組み立てる */
function buildLoadout(pid, save) {
  const lo = save.loadout[pid];
  const fRec = save.frames[lo.frame] || { lv: 1, lb: 0 };
  const frame = D.getFrame(lo.frame) || D.FRAMES[0];
  const core = D.getCore(lo.core);
  const cRec = core ? (save.cores[core.id] || { lv: 1, lb: 0 }) : null;

  const traits = new Set();
  if (frame.trait) traits.add(frame.trait);
  if (core) for (const t of core.traits) traits.add(t);

  const fLv = fRec.lv || 1;
  let maxHp = Math.round(frame.hp * (1 + 0.055 * (fLv - 1)));
  if (traits.has('hardened')) maxHp = Math.round(maxHp * 1.25);

  let dr = frame.dr;
  if (traits.has('reactive_plate')) dr += 0.12;
  dr = clamp(dr, -0.2, 0.62);

  let rollCd = frame.rollCd;
  if (traits.has('inertia_cancel')) rollCd *= 0.65;

  const weapons = [];
  for (const slot of ['main', 'sub']) {
    const wid = lo[slot];
    const w = D.getWeapon(wid);
    if (!w) continue;
    const rec = save.weapons[wid] || { lv: 1, lb: 0 };
    weapons.push(makeWeapon(w, rec.lv || 1, traits, frame.dmgMul || 1));
  }
  if (!weapons.length) weapons.push(makeWeapon(D.getWeapon('ar12'), 1, traits, frame.dmgMul || 1));

  return {
    pid, frame, frameLv: fLv, core, coreLv: cRec ? cRec.lv : 1,
    traits, maxHp, dr, rollCd,
    speed: frame.speed * (traits.has('inertia_cancel') ? 1.03 : 1),
    spMax: frame.sp, special: frame.special, weapons,
    dmgMul: frame.dmgMul || 1, shape: frame.shape || 'standard',
  };
}

function makeWeapon(def, lv, traits, dmgMul) {
  const w = Object.assign({}, def);
  w.lv = lv;
  const g = (1 + 0.062 * (lv - 1)) * (dmgMul || 1);   // レベル補正 × 機体の火力補正
  w.dmg = def.dmg * g;
  if (def.splash) w.splash = def.splash * (1 + 0.03 * (lv - 1));
  w.mag = def.mag ? Math.round(def.mag * (traits.has('ext_mag') ? 1.5 : 1)) : 0;
  w.reload = def.reload * (traits.has('coolant') ? 0.7 : 1) * (traits.has('tune_up') ? 0.82 : 1);
  w.pellets = def.pellets || 1;
  if (traits.has('twin_link') && (def.kind === 'gun' || def.kind === 'shotgun' || def.kind === 'homing')) {
    w.pellets += 1; w.dmg *= 0.84; w.spread = (def.spread || 0) + 2.2;
  }
  w.pierce = (def.pierce || 0) + (traits.has('piercing') ? 1 : 0);
  w.bounce = traits.has('ricochet') ? 1 : 0;
  w.homing = def.kind === 'homing' || traits.has('seeker');
  w.turn = def.turn || (traits.has('seeker') ? 1.6 : 0);
  w.ammo = w.mag; w.reloading = 0; w.cool = 0; w.spin = 0; w.chargeT = 0;
  return w;
}

/* ============================ アクタ ============================ */
class Actor {
  constructor(x, y, r) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.r = r;
    this.ang = 0; this.aim = 0; this.dead = false;
    this.hitFlash = 0; this.stun = 0; this.burn = 0; this.burnT = 0; this.slow = 0;
    this.walkPhase = 0;
  }
  get alive() { return !this.dead; }
}

/* ============================ プレイヤー機 ============================ */
class Mech extends Actor {
  constructor(pid, lo, x, y) {
    super(x, y, 19);
    this.pid = pid;
    this.lo = lo;
    this.team = 'ally';
    this.maxHp = lo.maxHp; this.hp = lo.maxHp;
    this.wi = 0;                    // 装備中スロット
    this.sp = 0;                    // 必殺ゲージ
    this.spMax = lo.spMax;
    this.rollT = 0; this.rollCd = 0; this.rollDir = 0; this.iframe = 0;
    this.lock = null; this.lockT = 0;
    this.down = false; this.downT = 0; this.reviveT = 0;
    this.noHitT = 0;                // 光学迷彩用
    this.lastDitch = true;          // 最終防壁の残り
    this.specialT = 0; this.specialState = null;
    this.kills = 0; this.dmgDealt = 0; this.scrapGained = 0;
    this.aim = 0; this.recoil = 0;
    this.shieldT = 0;               // ブレイクシールド展開中
    this.muzzle = 0;
  }
  get weapon() { return this.lo.weapons[this.wi]; }
  get traits() { return this.lo.traits; }
  has(t) { return this.lo.traits.has(t); }
}

/* ============================ 敵 ============================ */
class Enemy extends Actor {
  constructor(def, x, y, lvMul, isCommander) {
    super(x, y, def.radius);
    this.def = def;
    this.team = 'foe';
    this.maxHp = Math.round(def.hp * lvMul * (isCommander ? 3.2 : 1));
    this.hp = this.maxHp;
    this.armor = def.armor;
    this.speed = def.speed * (isCommander ? 0.92 : 1);
    this.state = 'patrol';
    this.wp = null; this.wpT = 0;
    this.lastKnown = null; this.alertT = 0; this.searchT = 0;
    this.fireT = rnd(0.4, 1.6); this.burstLeft = 0; this.burstT = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = rnd(1, 2.4);
    this.chargeT = 0; this.fuse = -1;
    this.commander = !!isCommander;
    this.dmgMul = lvMul;
    this.ang = rnd(TAU); this.aim = this.ang;
    this.flying = !!def.flying;
    this.target = null;
  }
}

/* ============================ ボス ============================ */
class Boss extends Actor {
  constructor(def, x, y, lvMul) {
    super(x, y, def.radius);
    this.def = def; this.team = 'foe'; this.isBoss = true;
    this.maxHp = Math.round(def.hp * lvMul); this.hp = this.maxHp;
    this.armor = def.armor;
    this.speed = def.speed;
    this.phase = 1;
    this.pat = null; this.patT = 0; this.patStep = 0; this.cool = 1.4;
    this.parts = (def.parts || []).map((p) => Object.assign({}, p, { maxHp: p.hp, alive: true, ang: 0, wx: x + p.ox, wy: y + p.oy }));
    this.entered = 0;
    this.dmgMul = lvMul;
    this.flying = !!def.flying;
    this.target = null;
    this.subT = 0;
  }
  get partsAlive() { return this.parts.filter((p) => p.alive).length; }
}

/* ============================ 世界生成 ============================ */
const THEME = {
  harbor:  { floor: '#1b2430', floor2: '#202b39', grid: '#26313f', wall: '#3c4a5c', wallTop: '#4d5f76', accent: '#7fd4ff', deco: 'container' },
  desert:  { floor: '#2b2418', floor2: '#332b1e', wall: '#5c4b34', wallTop: '#74603f', accent: '#ffc46b', deco: 'crate' },
  canyon:  { floor: '#241d22', floor2: '#2b2229', wall: '#4a3a44', wallTop: '#5f4b56', accent: '#ff8ab0', deco: 'rock' },
  foundry: { floor: '#1a2226', floor2: '#20292e', wall: '#3a4a50', wallTop: '#4c5f66', accent: '#8ff0e0', deco: 'pipe' },
  city:    { floor: '#161a26', floor2: '#1c2130', wall: '#333a52', wallTop: '#454e6c', accent: '#a88cff', deco: 'building' },
  orbital: { floor: '#12141c', floor2: '#181b26', wall: '#2e3346', wallTop: '#3e4560', accent: '#ffd166', deco: 'pylon' },
};

function genWorld(sector, rng) {
  const size = sector.size;
  const th = THEME[sector.theme] || THEME.harbor;
  const world = { w: size, h: size, theme: th, themeId: sector.theme, walls: [], decos: [], grid: null };
  const T = 44; // 外壁の厚み
  world.walls.push({ x: 0, y: 0, w: size, h: T, tall: true });
  world.walls.push({ x: 0, y: size - T, w: size, h: T, tall: true });
  world.walls.push({ x: 0, y: 0, w: T, h: size, tall: true });
  world.walls.push({ x: size - T, y: 0, w: T, h: size, tall: true });

  const cell = 220;
  const n = Math.floor(size / cell);
  const gap = 66;                       // 通路として必ず残す隙間
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const cx = gx * cell, cy = gy * cell;
      if (cx < 460 && cy < 460) continue;                 // 出撃地点は空ける
      if (cx > size - 480 && cy > size - 480) continue;    // ボス降着点も空ける
      const roll = rng.f();
      if (roll < 0.30) continue;                           // 何も置かない
      if (roll < 0.74) {
        const w = rng.f(70, cell - gap), h = rng.f(70, cell - gap);
        const x = cx + rng.f(gap * 0.4, cell - w - gap * 0.4);
        const y = cy + rng.f(gap * 0.4, cell - h - gap * 0.4);
        world.walls.push({ x, y, w, h, tall: rng.chance(0.55) });
      } else if (roll < 0.9) {
        // 長い遮蔽（コンテナ列・パイプ）
        const horiz = rng.chance(0.5);
        const L = rng.f(cell * 0.55, cell - gap);
        const w = horiz ? L : rng.f(26, 44);
        const h = horiz ? rng.f(26, 44) : L;
        const x = cx + rng.f(10, Math.max(12, cell - w - 10));
        const y = cy + rng.f(10, Math.max(12, cell - h - 10));
        world.walls.push({ x, y, w, h, tall: false, low: true });
      } else {
        // 小さな塊を数個
        const k = rng.i(2, 3);
        for (let i = 0; i < k; i++) {
          const w = rng.f(38, 72), h = rng.f(38, 72);
          const x = cx + rng.f(10, Math.max(12, cell - w - 10));
          const y = cy + rng.f(10, Math.max(12, cell - h - 10));
          world.walls.push({ x, y, w, h, tall: false });
        }
      }
    }
  }
  // 床の模様
  for (let i = 0; i < 90; i++) {
    world.decos.push({ x: rng.f(T, size - T), y: rng.f(T, size - T), r: rng.f(20, 90), a: rng.f(0.03, 0.09) });
  }
  buildWallGrid(world);
  return world;
}

/* 練習場は手で組んだ射撃レーン付きの閉じた区画にする */
function genArena(sector) {
  const size = sector.size;
  const th = THEME[sector.theme] || THEME.foundry;
  const world = { w: size, h: size, theme: th, themeId: sector.theme, walls: [], decos: [], grid: null };
  const T = 44;
  world.walls.push({ x: 0, y: 0, w: size, h: T, tall: true });
  world.walls.push({ x: 0, y: size - T, w: size, h: T, tall: true });
  world.walls.push({ x: 0, y: 0, w: T, h: size, tall: true });
  world.walls.push({ x: size - T, y: 0, w: T, h: size, tall: true });

  /* 射撃レーンの仕切り（低い遮蔽） */
  for (let i = 0; i < 3; i++) {
    world.walls.push({ x: 620, y: 190 + i * 200, w: 620, h: 26, low: true });
  }
  /* 立ち回り練習用の遮蔽 */
  const blocks = [
    [200, 780, 150, 120], [420, 1020, 110, 200], [760, 900, 220, 90],
    [1060, 1080, 130, 130], [250, 1220, 200, 100], [900, 1280, 260, 90],
    [1300, 780, 110, 260], [620, 1160, 90, 90],
  ];
  for (const [x, y, w, h] of blocks) world.walls.push({ x, y, w, h, tall: (x + y) % 3 === 0 });
  for (let i = 0; i < 40; i++) {
    world.decos.push({ x: 60 + Math.random() * (size - 120), y: 60 + Math.random() * (size - 120), r: 20 + Math.random() * 70, a: 0.04 });
  }
  buildWallGrid(world);
  return world;
}

/* 壁の空間ハッシュ（当たり判定を速くする） */
function buildWallGrid(world) {
  const cs = 200;
  const cols = Math.ceil(world.w / cs), rows = Math.ceil(world.h / cs);
  const cells = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  for (const w of world.walls) {
    const x0 = clamp(Math.floor(w.x / cs), 0, cols - 1);
    const x1 = clamp(Math.floor((w.x + w.w) / cs), 0, cols - 1);
    const y0 = clamp(Math.floor(w.y / cs), 0, rows - 1);
    const y1 = clamp(Math.floor((w.y + w.h) / cs), 0, rows - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * cols + x].push(w);
  }
  world.grid = { cs, cols, rows, cells };
}
function wallsNear(world, x, y, pad = 0) {
  const g = world.grid;
  const x0 = clamp(Math.floor((x - pad) / g.cs), 0, g.cols - 1);
  const x1 = clamp(Math.floor((x + pad) / g.cs), 0, g.cols - 1);
  const y0 = clamp(Math.floor((y - pad) / g.cs), 0, g.rows - 1);
  const y1 = clamp(Math.floor((y + pad) / g.cs), 0, g.rows - 1);
  const out = [];
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const c = g.cells[yy * g.cols + xx];
    for (let i = 0; i < c.length; i++) if (out.indexOf(c[i]) < 0) out.push(c[i]);
  }
  return out;
}
function pointBlocked(world, x, y, pad = 0) {
  const ws = wallsNear(world, x, y, pad + 4);
  for (const w of ws) if (x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad) return true;
  return false;
}
/* 視線が通るか（低い遮蔽は blockLow=false のとき撃ち抜ける） */
function hasLOS(world, x1, y1, x2, y2, blockLow) {
  return losScan(world, x1, y1, x2, y2, blockLow);
}
function losScan(world, x1, y1, x2, y2, blockLow) {
  const g = world.grid, cs = g.cs;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (cs * 0.6)));
  const seen = new Set();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x1 + dx * t, py = y1 + dy * t;
    const gx = clamp(Math.floor(px / cs), 0, g.cols - 1);
    const gy = clamp(Math.floor(py / cs), 0, g.rows - 1);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const kx = gx + ox, ky = gy + oy;
      if (kx < 0 || ky < 0 || kx >= g.cols || ky >= g.rows) continue;
      const key = ky * g.cols + kx;
      if (seen.has(key)) continue;
      seen.add(key);
      const cellArr = g.cells[key];
      for (let i = 0; i < cellArr.length; i++) {
        const w = cellArr[i];
        if (segRect(x1, y1, x2, y2, w.x, w.y, w.w, w.h) >= 0) return false;
      }
    }
  }
  return true;
}

/* 円を壁から押し出す */
function collideWalls(world, a) {
  const ws = wallsNear(world, a.x, a.y, a.r + 8);
  for (const w of ws) {
    if (a.flying && w.low) continue;
    if (!circleRect(a.x, a.y, a.r, w.x, w.y, w.w, w.h)) continue;
    const cx = clamp(a.x, w.x, w.x + w.w);
    const cy = clamp(a.y, w.y, w.y + w.h);
    let dx = a.x - cx, dy = a.y - cy;
    let d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      // 完全に内側 → いちばん近い辺へ押し出す
      const l = a.x - w.x, r = w.x + w.w - a.x, t = a.y - w.y, b = w.y + w.h - a.y;
      const m = Math.min(l, r, t, b);
      if (m === l) a.x = w.x - a.r; else if (m === r) a.x = w.x + w.w + a.r;
      else if (m === t) a.y = w.y - a.r; else a.y = w.y + w.h + a.r;
      a.vx *= 0.2; a.vy *= 0.2;
      continue;
    }
    dx /= d; dy /= d;
    const push = a.r - d;
    a.x += dx * push; a.y += dy * push;
    const dot = a.vx * dx + a.vy * dy;
    if (dot < 0) { a.vx -= dx * dot; a.vy -= dy * dot; }
  }
  a.x = clamp(a.x, a.r, world.w - a.r);
  a.y = clamp(a.y, a.r, world.h - a.r);
}

window.MRField = { buildLoadout, makeWeapon, Actor, Mech, Enemy, Boss,
  genWorld, genArena, wallsNear, pointBlocked, hasLOS, losScan, collideWalls, THEME };
})();
