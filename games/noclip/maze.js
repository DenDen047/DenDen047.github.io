/* =========================================================================
   NOCLIP ― ステージ生成
   すべて seed 決定的。同じステージは何度遊んでも同じ間取りになる。

   到達性の保証は 2 段階で考える。
     いま歩ける  : FLOOR / OPEN / EXIT / RUBBLE
     掘れば行ける: 上記 + CRACK / DOOR
   生成の最後に「掘れば行ける」で全域がつながるまで、壁をひび割れに置換する。
   ========================================================================= */

const passWalk = t => t === T.FLOOR || t === T.OPEN || t === T.EXIT || t === T.RUBBLE;
const passMine = t => passWalk(t) || t === T.CRACK || t === T.DOOR;

class Grid {
  constructor(W, H, fill = T.WALL) {
    this.W = W; this.H = H;
    this.t = new Uint8Array(W * H).fill(fill);
    this.hp = new Uint8Array(W * H);
  }
  idx(x, y) { return y * this.W + x; }
  in(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  get(x, y) { return this.in(x, y) ? this.t[y * this.W + x] : T.WALL; }
  set(x, y, v) {
    if (!this.in(x, y)) { return; }
    const i = y * this.W + x;
    this.t[i] = v;
    this.hp[i] = BREAKABLE[v] || 0;
  }
  /** 外周は絶対に掘らせない */
  border() {
    for (let x = 0; x < this.W; x++) { this.set(x, 0, T.WALL); this.set(x, this.H - 1, T.WALL); }
    for (let y = 0; y < this.H; y++) { this.set(0, y, T.WALL); this.set(this.W - 1, y, T.WALL); }
  }
  rect(x0, y0, w, h, v) {
    for (let y = y0; y < y0 + h; y++) { for (let x = x0; x < x0 + w; x++) { this.set(x, y, v); } }
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* ---------- 連結成分（いま歩ける範囲） ---------- */
function walkRegions(g) {
  const lab = new Int32Array(g.W * g.H).fill(-1);
  const list = [];
  for (let y = 1; y < g.H - 1; y++) {
    for (let x = 1; x < g.W - 1; x++) {
      const i = g.idx(x, y);
      if (lab[i] !== -1 || !passWalk(g.t[i])) { continue; }
      const id = list.length, cells = [];
      const q = [i]; lab[i] = id;
      while (q.length) {
        const c = q.pop(); cells.push(c);
        const cx = c % g.W, cy = (c / g.W) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx <= 0 || ny <= 0 || nx >= g.W - 1 || ny >= g.H - 1) { continue; }
          const ni = g.idx(nx, ny);
          if (lab[ni] === -1 && passWalk(g.t[ni])) { lab[ni] = id; q.push(ni); }
        }
      }
      list.push(cells);
    }
  }
  return { lab, list };
}

/**
 * 孤立した部屋をひび割れ壁でつなぐ。
 * 最大の連結成分から 0-1 BFS（床 0、壁 1）を張り、他成分から経路を逆に辿って掘る。
 */
function connectAll(g) {
  for (let pass = 0; pass < 6; pass++) {
    const { lab, list } = walkRegions(g);
    if (list.length <= 1) { return; }
    let main = 0;
    for (let i = 1; i < list.length; i++) { if (list[i].length > list[main].length) { main = i; } }

    const INF = 0x3fffffff;
    const dist = new Int32Array(g.W * g.H).fill(INF);
    const prev = new Int32Array(g.W * g.H).fill(-1);
    const dq = [];
    for (const c of list[main]) { dist[c] = 0; dq.push(c); }
    let head = 0;
    while (head < dq.length) {
      const c = dq[head++];
      const cx = c % g.W, cy = (c / g.W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx <= 0 || ny <= 0 || nx >= g.W - 1 || ny >= g.H - 1) { continue; }
        const ni = g.idx(nx, ny);
        const w = passWalk(g.t[ni]) ? 0 : 1;
        if (dist[c] + w < dist[ni]) {
          dist[ni] = dist[c] + w; prev[ni] = c;
          if (w === 0) { dq.splice(head, 0, ni); } else { dq.push(ni); }
        }
      }
    }

    for (let r = 0; r < list.length; r++) {
      if (r === main) { continue; }
      let best = -1;
      for (const c of list[r]) { if (dist[c] < INF && (best < 0 || dist[c] < dist[best])) { best = c; } }
      if (best < 0) { continue; }
      let c = best;
      while (c !== -1 && dist[c] > 0) {
        if (!passWalk(g.t[c])) { g.set(c % g.W, (c / g.W) | 0, T.CRACK); }
        c = prev[c];
      }
    }
  }
}

/** 出発点から「掘れば行ける」距離。プロップの配置と出口決定に使う */
function mineDistance(g, sx, sy) {
  const d = new Int32Array(g.W * g.H).fill(-1);
  const q = [g.idx(sx, sy)]; d[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const c = q[head++], cx = c % g.W, cy = (c / g.W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx <= 0 || ny <= 0 || nx >= g.W - 1 || ny >= g.H - 1) { continue; }
      const ni = g.idx(nx, ny);
      if (d[ni] === -1 && passMine(g.t[ni])) { d[ni] = d[c] + 1; q.push(ni); }
    }
  }
  return d;
}

/* =========================================================================
   間取りジェネレータ
   ========================================================================= */

/** バックルームズ：開けた空間に薄い仕切りが乱雑に立つ */
function genBackrooms(g, rng, opt = {}) {
  g.rect(1, 1, g.W - 2, g.H - 2, T.FLOOR);
  g.border();

  // 駐車場のような等間隔の柱
  if (opt.pillarGrid) {
    for (let y = 3; y < g.H - 3; y += opt.pillarGrid) {
      for (let x = 3; x < g.W - 3; x += opt.pillarGrid) { g.set(x, y, T.DECO); }
    }
  }

  // 仕切り壁のスタンプ
  const stamps = Math.floor(g.W * g.H / (opt.dense ? 11 : 15));
  for (let i = 0; i < stamps; i++) {
    const x = rngInt(rng, 2, g.W - 3), y = rngInt(rng, 2, g.H - 3);
    const len = rngInt(rng, 2, 9);
    const horiz = rng() < 0.5;
    const crackRun = rng() < 0.28;
    for (let k = 0; k < len; k++) {
      const px = horiz ? x + k : x, py = horiz ? y : y + k;
      if (px >= g.W - 2 || py >= g.H - 2) { break; }
      g.set(px, py, crackRun ? T.CRACK : T.WALL);
    }
  }

  // 密閉された小部屋（ひび割れ壁で囲う＝掘って入る隠し部屋）
  const secrets = [];
  for (let i = 0; i < 5; i++) {
    const w = rngInt(rng, 3, 4), h = rngInt(rng, 3, 4);
    const x = rngInt(rng, 3, g.W - w - 4), y = rngInt(rng, 3, g.H - h - 4);
    g.rect(x - 1, y - 1, w + 2, h + 2, T.CRACK);
    g.rect(x, y, w, h, T.FLOOR);
    secrets.push({ x: x + (w >> 1), y: y + (h >> 1) });
  }
  return { secrets };
}

/** 配管地獄：再帰的バックトラッカで作る一本道の迷路。行き止まりは薄壁で抜ける */
function genPipes(g, rng) {
  g.rect(0, 0, g.W, g.H, T.WALL);
  const cw = (g.W - 1) >> 1, ch = (g.H - 1) >> 1;
  const seen = new Uint8Array(cw * ch);
  const cell = (cx, cy) => ({ x: cx * 2 + 1, y: cy * 2 + 1 });
  const stack = [[rngInt(rng, 0, cw - 1), rngInt(rng, 0, ch - 1)]];
  seen[stack[0][1] * cw + stack[0][0]] = 1;
  { const p = cell(stack[0][0], stack[0][1]); g.set(p.x, p.y, T.FLOOR); }

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const cand = [];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny * cw + nx]) { cand.push([nx, ny, dx, dy]); }
    }
    if (!cand.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = rngPick(rng, cand);
    const a = cell(cx, cy);
    g.set(a.x + dx, a.y + dy, T.FLOOR);
    const b = cell(nx, ny);
    g.set(b.x, b.y, T.FLOOR);
    seen[ny * cw + nx] = 1;
    stack.push([nx, ny]);
  }

  // 壁の一部をひび割れに変えて近道を作る
  for (let y = 2; y < g.H - 2; y++) {
    for (let x = 2; x < g.W - 2; x++) {
      if (g.get(x, y) !== T.WALL) { continue; }
      const open = DIRS.filter(([dx, dy]) => passWalk(g.get(x + dx, y + dy))).length;
      if (open >= 2 && rng() < 0.20) { g.set(x, y, T.CRACK); }
    }
  }
  // ところどころ部屋にして息をつかせる
  for (let i = 0; i < 7; i++) {
    const w = rngInt(rng, 4, 6), h = rngInt(rng, 4, 6);
    const x = rngInt(rng, 2, g.W - w - 3), y = rngInt(rng, 2, g.H - h - 3);
    g.rect(x, y, w, h, T.FLOOR);
  }
  g.border();
  return { secrets: [] };
}

/** 洋館：BSP で部屋を切り、廊下でつなぎ、入口に扉を置く */
function genManor(g, rng) {
  g.rect(0, 0, g.W, g.H, T.WALL);
  const rooms = [];

  (function split(x, y, w, h, depth) {
    const minSide = 9;
    if (depth > 4 || (w < minSide * 2 && h < minSide * 2)) {
      const rw = Math.max(4, w - rngInt(rng, 2, 4));
      const rh = Math.max(4, h - rngInt(rng, 2, 4));
      const rx = x + Math.floor((w - rw) / 2), ry = y + Math.floor((h - rh) / 2);
      g.rect(rx, ry, rw, rh, T.FLOOR);
      rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) });
      return;
    }
    const horiz = (w < h) || (w === h && rng() < 0.5);
    if (horiz) {
      const c = rngInt(rng, Math.floor(h * 0.35), Math.floor(h * 0.65));
      split(x, y, w, c, depth + 1); split(x, y + c, w, h - c, depth + 1);
    } else {
      const c = rngInt(rng, Math.floor(w * 0.35), Math.floor(w * 0.65));
      split(x, y, c, h, depth + 1); split(x + c, y, w - c, h, depth + 1);
    }
  })(1, 1, g.W - 2, g.H - 2, 0);

  // 近い部屋どうしを L 字廊下でつなぐ
  const carveH = (x0, x1, y) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { if (g.get(x, y) === T.WALL) { g.set(x, y, T.FLOOR); } } };
  const carveV = (y0, y1, x) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { if (g.get(x, y) === T.WALL) { g.set(x, y, T.FLOOR); } } };
  for (let i = 1; i < rooms.length; i++) {
    let best = 0, bd = Infinity;
    for (let j = 0; j < i; j++) {
      const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
      if (d < bd) { bd = d; best = j; }
    }
    const a = rooms[i], b = rooms[best];
    if (rng() < 0.5) { carveH(a.cx, b.cx, a.cy); carveV(a.cy, b.cy, b.cx); }
    else { carveV(a.cy, b.cy, a.cx); carveH(a.cx, b.cx, b.cy); }
  }

  // 一マス幅の関所（両隣だけが抜けていて左右は壁）を扉にする。
  // 部屋に接しているものは鍵付き、それ以外は開いたままにする。
  const inRoom = new Uint8Array(g.W * g.H);
  for (const r of rooms) { for (let y = r.y; y < r.y + r.h; y++) { for (let x = r.x; x < r.x + r.w; x++) { inRoom[g.idx(x, y)] = 1; } } }
  const chokes = [];
  for (let y = 2; y < g.H - 2; y++) {
    for (let x = 2; x < g.W - 2; x++) {
      if (g.get(x, y) !== T.FLOOR) { continue; }
      const l = passWalk(g.get(x - 1, y)), r2 = passWalk(g.get(x + 1, y));
      const u = passWalk(g.get(x, y - 1)), d = passWalk(g.get(x, y + 1));
      const vert = u && d && !l && !r2, horiz = l && r2 && !u && !d;
      if (!vert && !horiz) { continue; }
      const touchesRoom = vert
        ? (inRoom[g.idx(x, y - 1)] || inRoom[g.idx(x, y + 1)])
        : (inRoom[g.idx(x - 1, y)] || inRoom[g.idx(x + 1, y)]);
      chokes.push({ x, y, touchesRoom });
    }
  }
  for (const c of chokes) {
    const p = c.touchesRoom ? 0.62 : 0.22;
    g.set(c.x, c.y, rng() < p ? T.DOOR : T.OPEN);
  }

  // 家具（DECO＝壊せない障害物）と、掘り抜ける薄い間仕切り
  for (const r of rooms) {
    const n = rngInt(rng, 0, 3);
    for (let i = 0; i < n; i++) {
      const x = rngInt(rng, r.x + 1, r.x + r.w - 2), y = rngInt(rng, r.y + 1, r.y + r.h - 2);
      g.set(x, y, T.DECO);
    }
  }
  for (let y = 2; y < g.H - 2; y++) {
    for (let x = 2; x < g.W - 2; x++) {
      if (g.get(x, y) !== T.WALL) { continue; }
      const open = DIRS.filter(([dx, dy]) => passWalk(g.get(x + dx, y + dy))).length;
      if (open >= 2 && rng() < 0.22) { g.set(x, y, T.CRACK); }
    }
  }
  g.border();
  return { secrets: rooms.filter(() => rng() < 0.35).map(r => ({ x: r.cx, y: r.cy })) };
}

/** 納骨堂：格子状の石室。仕切りの多くがひび割れ＝掘って進む前提の面 */
function genCrypt(g, rng) {
  g.rect(0, 0, g.W, g.H, T.WALL);
  const step = 7;
  for (let cy = 1; cy + step - 1 < g.H - 1; cy += step) {
    for (let cx = 1; cx + step - 1 < g.W - 1; cx += step) {
      g.rect(cx, cy, step - 1, step - 1, T.FLOOR);
    }
  }
  // 石室のあいだの仕切りを、ひび割れ／開口／壁に割り振る
  for (let y = 1; y < g.H - 1; y++) {
    for (let x = 1; x < g.W - 1; x++) {
      if (g.get(x, y) !== T.WALL) { continue; }
      const open = DIRS.filter(([dx, dy]) => passWalk(g.get(x + dx, y + dy))).length;
      if (open < 2) { continue; }
      const r = rng();
      if (r < 0.30) { g.set(x, y, T.FLOOR); }
      else if (r < 0.72) { g.set(x, y, T.CRACK); }
    }
  }
  // 棺（壊せない置物）
  for (let i = 0; i < g.W; i++) {
    const x = rngInt(rng, 2, g.W - 3), y = rngInt(rng, 2, g.H - 3);
    if (g.get(x, y) === T.FLOOR) { g.set(x, y, T.DECO); }
  }
  g.border();
  return { secrets: [] };
}

/** 終端：四隅の支柱を折るための闘技場 */
function genBoss(g, rng) {
  g.rect(0, 0, g.W, g.H, T.WALL);
  const m = 4;
  g.rect(m, m, g.W - m * 2, g.H - m * 2, T.FLOOR);

  // 遮蔽物
  for (let i = 0; i < 26; i++) {
    const x = rngInt(rng, m + 2, g.W - m - 3), y = rngInt(rng, m + 2, g.H - m - 3);
    const len = rngInt(rng, 2, 4), horiz = rng() < 0.5;
    for (let k = 0; k < len; k++) { g.set(horiz ? x + k : x, horiz ? y : y + k, T.CRACK); }
  }
  // 中央の空間は空けておく
  const c = g.W >> 1;
  g.rect(c - 3, c - 3, 7, 7, T.FLOOR);

  const q = m + 4;
  const pillars = [
    { x: q, y: q }, { x: g.W - 1 - q, y: q },
    { x: q, y: g.H - 1 - q }, { x: g.W - 1 - q, y: g.H - 1 - q },
  ];
  for (const p of pillars) {
    g.rect(p.x - 1, p.y - 1, 3, 3, T.FLOOR);
    g.set(p.x, p.y, T.PILLAR);
  }
  return { secrets: [], pillars };
}

/* =========================================================================
   ステージ組み立て
   ========================================================================= */
function buildStage(stage) {
  const rng = makeRng(stage.seed);
  const S = stage.size;
  const g = new Grid(S, S);
  let meta = { secrets: [] };

  switch (stage.kind) {
    case 'backrooms': meta = genBackrooms(g, rng, { pillarGrid: stage.id === 'lv1' ? 4 : 0, dense: stage.id === 'lv0' }); break;
    case 'pipes':     meta = genPipes(g, rng); break;
    case 'manor':     meta = genManor(g, rng); break;
    case 'crypt':     meta = genCrypt(g, rng); break;
    case 'boss':      meta = genBoss(g, rng); break;
    default:          meta = genBackrooms(g, rng, {}); break;
  }
  g.border();
  connectAll(g);

  // ---- 出発点：左上寄りの歩ける床 ----
  let spawn = null;
  outer:
  for (let r = 2; r < S; r++) {
    for (let y = 1; y <= Math.min(r, S - 2); y++) {
      for (let x = 1; x <= Math.min(r, S - 2); x++) {
        if (passWalk(g.get(x, y))) { spawn = { x, y }; break outer; }
      }
    }
  }
  if (!spawn) { spawn = { x: 2, y: 2 }; g.set(2, 2, T.FLOOR); }

  const dist = mineDistance(g, spawn.x, spawn.y);
  const reach = [];
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = g.idx(x, y);
      if (dist[i] >= 0 && passWalk(g.t[i])) { reach.push({ x, y, d: dist[i] }); }
    }
  }
  reach.sort((a, b) => a.d - b.d);

  // ---- 出口：いちばん遠い床 ----
  const exit = reach[reach.length - 1] || spawn;
  g.set(exit.x, exit.y, T.EXIT);

  // ---- 鍵・宝箱・ランプ ----
  const taken = new Set([g.idx(spawn.x, spawn.y), g.idx(exit.x, exit.y)]);
  const far = reach.slice(Math.floor(reach.length * 0.35));
  const pickSpot = (pool, minSep = 5) => {
    for (let tries = 0; tries < 240; tries++) {
      const c = pool[Math.floor(rng() * pool.length)];
      if (!c) { break; }
      const i = g.idx(c.x, c.y);
      if (taken.has(i)) { continue; }
      let ok = true;
      for (const ti of taken) {
        const tx = ti % S, ty = (ti / S) | 0;
        if (Math.abs(tx - c.x) + Math.abs(ty - c.y) < minSep) { ok = false; break; }
      }
      if (!ok) { continue; }
      taken.add(i); return c;
    }
    return null;
  };

  const keys = [], chests = [];

  // 隠し部屋には必ず宝箱を置く（掘る動機になる）
  for (const s of meta.secrets) {
    if (!passWalk(g.get(s.x, s.y))) { continue; }
    const i = g.idx(s.x, s.y);
    if (taken.has(i)) { continue; }
    taken.add(i);
    chests.push({ x: s.x, y: s.y, hp: 2, open: false, loot: 'big' });
  }

  const nKeyInChest = Math.min(chests.length, Math.floor(stage.keys / 2));
  for (let i = 0; i < nKeyInChest; i++) { chests[i].loot = 'key'; }
  for (let i = 0; i < stage.keys - nKeyInChest; i++) {
    const c = pickSpot(far, 6);
    if (c) { keys.push({ x: c.x, y: c.y, got: false }); }
  }
  const extraChests = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < extraChests; i++) {
    const c = pickSpot(reach, 4);
    if (c) { chests.push({ x: c.x, y: c.y, hp: 2, open: false, loot: rng() < 0.45 ? 'heal' : 'battery' }); }
  }

  const lamps = [];
  if (stage.lamps && stage.lamps.grid > 0) {
    const step = stage.lamps.grid;
    for (let y = 2; y < S - 2; y += step) {
      for (let x = 2; x < S - 2; x += step) {
        let best = null;
        for (let dy = -1; dy <= 1 && !best; dy++) {
          for (let dx = -1; dx <= 1 && !best; dx++) {
            if (passWalk(g.get(x + dx, y + dy))) { best = { x: x + dx, y: y + dy }; }
          }
        }
        if (best) { lamps.push({ x: best.x, y: best.y, ph: rng() * TAU, dead: rng() < 0.12 }); }
      }
    }
  }

  // ---- 実体の湧き位置：出発点から離れた床 ----
  const spawns = [];
  for (const [type, n] of stage.ents) {
    for (let i = 0; i < n; i++) {
      const c = far[Math.floor(rng() * far.length)];
      if (c) { spawns.push({ type, x: c.x, y: c.y }); }
    }
  }

  return {
    W: S, H: S, tiles: g.t, hp: g.hp, grid: g,
    spawn, exit: { x: exit.x, y: exit.y },
    keys, chests, lamps, spawns,
    pillars: meta.pillars || [],
    dist,
  };
}
