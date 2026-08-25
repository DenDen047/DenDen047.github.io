/* =========================================================================
   WALLED WOLVES ― 壁の中の街をつくる
   外壁に囲まれた城塞都市。中央が広場、そのまわりに住民の家が環状に並び、
   さらに外側に井戸・鍛冶場・物見櫓といった仕事場が置かれる。
   ========================================================================= */

/* ---------- 乱数（種つき） ---------- */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const rrange = (rng, a, b) => a + rng() * (b - a);

/* ---------- 家の外装バリエーション ---------- */
const HOUSE_SKINS = [
  { wall: '#c8b49a', roof: '#8a4638', trim: '#6a5240' },
  { wall: '#b8a894', roof: '#4a5a6a', trim: '#5c5040' },
  { wall: '#d0bfa4', roof: '#6a4a3a', trim: '#7a6248' },
  { wall: '#bca88e', roof: '#3f5a4a', trim: '#5a4c3a' },
  { wall: '#c6b096', roof: '#7a5a2c', trim: '#6c563e' },
  { wall: '#b4a08a', roof: '#5a4060', trim: '#584838' },
];

/* 仕事場の見た目定義（chore id と対応） */
const STATION_DEFS = {
  well:   { label: '井戸',   w: 74, h: 74, solid: true,  kind: 'well' },
  oven:   { label: 'パン窯', w: 92, h: 72, solid: true,  kind: 'oven' },
  forge:  { label: '鍛冶場', w: 100, h: 78, solid: true, kind: 'forge' },
  field:  { label: '畑',     w: 150, h: 100, solid: false, kind: 'field' },
  watch:  { label: '物見櫓', w: 84, h: 84, solid: true,  kind: 'watch' },
  store:  { label: '倉庫',   w: 108, h: 84, solid: true, kind: 'store' },
  canal:  { label: '水路',   w: 160, h: 56, solid: false, kind: 'canal' },
  bell:   { label: '鐘楼',   w: 88, h: 88, solid: true,  kind: 'bell' },
  gate:   { label: '大門',   w: 130, h: 70, solid: true, kind: 'gate' },
  shrine: { label: '祠',     w: 70, h: 66, solid: true,  kind: 'shrine' },
};

/* =========================================================================
   街の生成
   ========================================================================= */
function buildTown(n, seed) {
  const rng = makeRng(seed);

  // 家を環状に並べるための楕円半径。軒数が増えるほど街が広がる
  const need = n * 178;
  const ry = Math.max(215, Math.min(470, need / 7.16));
  const rx = ry * 1.30;

  const margin = 350;
  const W = Math.round((rx + margin) * 2);
  const H = Math.round((ry + margin) * 2);
  const cx = W / 2, cy = H / 2;

  const wallT = 64;           // 外壁の厚み
  const town = {
    w: W, h: H, cx, cy, wallT,
    rx, ry,
    houses: [], stations: [], props: [], lamps: [], solids: [],
    plaza: { x: cx, y: cy, rx: rx - 130, ry: ry - 110 },
  };

  /* ---- 外壁（内側4辺を厚い当たり判定にする） ---- */
  town.solids.push({ x: 0,          y: 0,          w: W,     h: wallT, kind: 'wall' });
  town.solids.push({ x: 0,          y: H - wallT, w: W,     h: wallT, kind: 'wall' });
  town.solids.push({ x: 0,          y: 0,          w: wallT, h: H,     kind: 'wall' });
  town.solids.push({ x: W - wallT,  y: 0,          w: wallT, h: H,     kind: 'wall' });

  /* ---- 家 ---- */
  const HW = 116, HH = 98, DOOR = 34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.14;
    const hx = cx + Math.cos(a) * rx;
    const hy = cy + Math.sin(a) * ry;

    // 玄関は広場（中心）を向く
    const dx = cx - hx, dy = cy - hy;
    const dir = Math.abs(dx) * (ry / rx) > Math.abs(dy)
      ? (dx > 0 ? 'E' : 'W')
      : (dy > 0 ? 'S' : 'N');

    const skin = HOUSE_SKINS[i % HOUSE_SKINS.length];
    const h = {
      idx: i,
      x: Math.round(hx - HW / 2), y: Math.round(hy - HH / 2),
      w: HW, h: HH,
      cx: Math.round(hx), cy: Math.round(hy),
      dir, skin, ownerIdx: i,
      no: i + 1,
      // 家具（家の内側の相対位置）
      bed:   { x: 0, y: 0, w: 40, h: 30 },
      chest: { x: 0, y: 0, w: 30, h: 24 },
      table: { x: 0, y: 0, w: 28, h: 24 },
    };
    layoutInterior(h, DOOR);
    town.houses.push(h);
    pushHouseWalls(town, h, DOOR);
  }

  /* ---- 仕事場 ---- */
  // 鐘楼は広場のど真ん中、井戸はその脇。残りは家の外側の環に配る
  addStation(town, 'bell',  cx, cy - 20);
  addStation(town, 'well',  cx - 150, cy + 60);
  addStation(town, 'shrine', cx + 160, cy + 66);

  const outer = ['oven', 'forge', 'field', 'watch', 'store', 'canal', 'gate'];
  const orx = rx + 190, ory = ry + 178;
  outer.forEach((key, k) => {
    // 大門は必ず南の外壁ぎわ
    if (key === 'gate') {
      addStation(town, key, cx, H - wallT - 74);
      return;
    }
    const a = (k / (outer.length - 1)) * Math.PI * 2 - Math.PI / 2 + 0.5;
    const sx = clampIn(cx + Math.cos(a) * orx, wallT + 90, W - wallT - 90);
    const sy = clampIn(cy + Math.sin(a) * ory, wallT + 80, H - wallT - 160);
    addStation(town, key, sx, sy);
  });

  /* ---- 街灯（夜の明かり） ---- */
  const lampN = Math.max(8, Math.round(n * 0.9));
  for (let i = 0; i < lampN; i++) {
    const a = (i / lampN) * Math.PI * 2 + 0.3;
    const lrx = rx - 118, lry = ry - 96;
    town.lamps.push({
      x: cx + Math.cos(a) * lrx,
      y: cy + Math.sin(a) * lry,
      r: 126, phase: rng() * 6.28,
    });
  }
  town.lamps.push({ x: cx, y: cy + 62, r: 168, phase: 1.1 });

  /* ---- 装飾（木・樽・荷車・敷石） ---- */
  const decoKinds = ['tree', 'tree', 'tree', 'barrel', 'cart', 'crate', 'bush', 'bush'];
  let guard = 0;
  while (town.props.length < 26 + n && guard++ < 900) {
    const px = rrange(rng, wallT + 60, W - wallT - 60);
    const py = rrange(rng, wallT + 60, H - wallT - 60);
    if (inEllipse(px, py, cx, cy, town.plaza.rx - 40, town.plaza.ry - 40)) continue;
    if (nearAnything(town, px, py, 66)) continue;
    const kind = pick(rng, decoKinds);
    const p = { kind, x: px, y: py, s: rrange(rng, 0.85, 1.25), rot: rng() * 6.28 };
    town.props.push(p);
    if (kind === 'cart') {
      town.solids.push({ x: px - 20, y: py - 10, w: 40, h: 20, kind: 'prop' });
    }
  }

  return town;
}

function clampIn(v, a, b) { return Math.max(a, Math.min(b, v)); }
function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function nearAnything(town, x, y, pad) {
  for (const h of town.houses) {
    if (x > h.x - pad && x < h.x + h.w + pad && y > h.y - pad && y < h.y + h.h + pad) return true;
  }
  for (const s of town.stations) {
    if (x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad) return true;
  }
  for (const p of town.props) {
    if (Math.abs(p.x - x) < pad && Math.abs(p.y - y) < pad) return true;
  }
  return false;
}

function addStation(town, key, cx, cy) {
  const d = STATION_DEFS[key];
  const s = {
    key, kind: d.kind, label: d.label,
    x: Math.round(cx - d.w / 2), y: Math.round(cy - d.h / 2),
    w: d.w, h: d.h,
    cx: Math.round(cx), cy: Math.round(cy),
    solid: d.solid,
  };
  town.stations.push(s);
  if (d.solid) town.solids.push({ x: s.x, y: s.y + s.h * 0.35, w: s.w, h: s.h * 0.65, kind: 'station' });
}

/* 家の四方の壁を当たり判定に登録する。玄関のある辺だけ開口を空ける */
function pushHouseWalls(town, h, door) {
  const T = 10;
  const seg = (x, y, w, hh) => town.solids.push({ x, y, w, h: hh, kind: 'house', house: h.idx });
  const { x, y, w, h: hh, dir } = h;

  const openStart = (len) => (len - door) / 2;

  if (dir === 'N') {
    const o = openStart(w);
    seg(x, y, o, T); seg(x + o + door, y, w - o - door, T);
    h.door = { x: x + w / 2, y: y + T / 2, dir };
  } else seg(x, y, w, T);

  if (dir === 'S') {
    const o = openStart(w);
    seg(x, y + hh - T, o, T); seg(x + o + door, y + hh - T, w - o - door, T);
    h.door = { x: x + w / 2, y: y + hh - T / 2, dir };
  } else seg(x, y + hh - T, w, T);

  if (dir === 'W') {
    const o = openStart(hh);
    seg(x, y, T, o); seg(x, y + o + door, T, hh - o - door);
    h.door = { x: x + T / 2, y: y + hh / 2, dir };
  } else seg(x, y, T, hh);

  if (dir === 'E') {
    const o = openStart(hh);
    seg(x + w - T, y, T, o); seg(x + w - T, y + o + door, T, hh - o - door);
    h.door = { x: x + w - T / 2, y: y + hh / 2, dir };
  } else seg(x + w - T, y, T, hh);

  // 玄関の手前（外側）の立ち位置。騎士はここに立つ
  const off = 34;
  h.porch = {
    x: h.door.x + (dir === 'E' ? off : dir === 'W' ? -off : 0),
    y: h.door.y + (dir === 'S' ? off : dir === 'N' ? -off : 0),
  };
}

/* ベッド・物置・机を家の中に置く。玄関の向きで配置を変える */
function layoutInterior(h, door) {
  const T = 12;
  const ix = h.x + T, iy = h.y + T, iw = h.w - T * 2, ih = h.h - T * 2;
  const d = h.dir;

  // 玄関の反対側の奥にベッド
  if (d === 'S')      { h.bed.x = ix + 6;            h.bed.y = iy + 4; }
  else if (d === 'N') { h.bed.x = ix + 6;            h.bed.y = iy + ih - h.bed.h - 4; }
  else if (d === 'E') { h.bed.x = ix + 4;            h.bed.y = iy + 6; }
  else                { h.bed.x = ix + iw - h.bed.w - 4; h.bed.y = iy + 6; }

  // 物置は空いている角
  h.chest.x = ix + iw - h.chest.w - 5;
  h.chest.y = iy + ih - h.chest.h - 5;
  if (d === 'N') h.chest.y = iy + 5;
  if (d === 'W') h.chest.x = ix + 5;

  // 机は残りの隅
  h.table.x = ix + iw - h.table.w - 6;
  h.table.y = iy + 6;
  if (d === 'N') { h.table.y = iy + ih - h.table.h - 6; }
  if (d === 'E') { h.table.x = ix + 6; h.table.y = iy + ih - h.table.h - 6; }

  h.bedC   = { x: h.bed.x + h.bed.w / 2,     y: h.bed.y + h.bed.h / 2 };
  h.chestC = { x: h.chest.x + h.chest.w / 2, y: h.chest.y + h.chest.h / 2 };
  h.center = { x: h.x + h.w / 2, y: h.y + h.h / 2 };
}

/* 点が家の内側にあるか */
function insideHouse(h, x, y) {
  return x > h.x + 8 && x < h.x + h.w - 8 && y > h.y + 8 && y < h.y + h.h - 8;
}
