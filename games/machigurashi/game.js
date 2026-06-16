/* まちぐらし ― Lagoon Life (concept prototype)
 * 俯瞰2Dのまったりライフシム。生活・お仕事・お買い物・友達・闘技場・イベント・時間/季節を体感する単体プロトタイプ。
 * 建物に入ると内装シーンに切替。自宅は空き地から自分で建てる。広い近代都市はシードから自動生成。
 * 乗り物(自転車/スクーター/車)、12日ごとのイベント。裏側同期は無し。localStorage に自動セーブ。
 */
(function () {
  "use strict";

  // ============================================================
  //  定数
  // ============================================================
  const TILE = 32;
  const MAP_W = 80, MAP_H = 60;
  const PLAYER_SPEED = 155, PLAYER_HALF = 11, INTERACT_RANGE = 50;
  const TIME_BASE = 1;             // ゲーム内分 / 実秒 (×1: ゲーム1日 = 実24分)
  const SAVE_KEY = "lagoon-life-save-v3";
  const MIN_PER_DAY = 1440, DAYS_PER_MONTH = 30, MONTHS_PER_YEAR = 12;
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const G_GRASS = 0, G_PATH = 1, G_WATER = 2, G_ROAD = 3, G_WALK = 4, G_BRIDGE = 5;

  const EVENTS = [
    { id: "matsuri", name: "お祭り", emoji: "🎆" },
    { id: "sale", name: "大セール", emoji: "🛒" },
    { id: "tournament", name: "闘技大会", emoji: "🏆" },
    { id: "live", name: "音楽フェス", emoji: "🎵" },
  ];

  // ============================================================
  //  DOM
  // ============================================================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const el = {
    date: document.getElementById("date"), clock: document.getElementById("clock"), season: document.getElementById("season"),
    place: document.getElementById("place"), eventBox: document.getElementById("eventBox"), eventName: document.getElementById("eventName"),
    money: document.getElementById("money"), energyFill: document.getElementById("energyFill"),
    prompt: document.getElementById("prompt"), promptText: document.getElementById("promptText"),
    toasts: document.getElementById("toasts"), overlay: document.getElementById("overlay"),
    modalTitle: document.getElementById("modalTitle"), modalBody: document.getElementById("modalBody"), modalButtons: document.getElementById("modalButtons"),
  };

  // ============================================================
  //  汎用ヘルパー
  // ============================================================
  function makeGrid(w, h, v) { const g = []; for (let y = 0; y < h; y++) g.push(new Array(w).fill(v)); return g; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function val(x) { return typeof x === "function" ? x() : x; }
  function lerpColor(a, b, t) {
    t = clamp(t, 0, 1);
    return `${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)}`;
  }
  // シード付き擬似乱数 (mulberry32) — 同じシードなら同じ街が生成される
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function choice(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  function blankScene(id, kind, w, h) {
    return {
      id, kind, w, h, solid: makeGrid(w, h, 0), ground: makeGrid(w, h, G_GRASS),
      trees: [], buildings: [], furniture: [], items: [], npcs: [], interactables: [], portals: [], lights: [], props: [],
      spawn: { x: TILE * 1.5, y: TILE * 1.5 },
    };
  }

  // ============================================================
  //  ゲーム状態
  // ============================================================
  const SHOP_ITEMS = [
    { name: "パン", price: 80, energy: 15, kind: "food" },
    { name: "おにぎり", price: 120, energy: 25, kind: "food" },
    { name: "お弁当", price: 250, energy: 45, kind: "food" },
    { name: "コーヒー", price: 150, energy: 20, kind: "food" },
    { name: "観葉植物", price: 300, kind: "decor" },
    { name: "ランプ", price: 480, kind: "decor" },
    { name: "ぬいぐるみ", price: 600, kind: "decor" },
  ];

  // 無限ワールドのチャンクに置く装飾ビルのパレット
  const CHUNK_BUILDINGS = [
    { style: "flat", wall: "#e7e2d8", colors: ["#6f9bd0", "#4fae8a", "#d08a6f", "#9a8ad0", "#d0b14f"], minW: 3, maxW: 5, minH: 3, maxH: 3, names: ["オフィス", "ショップ", "カフェ", "ベーカリー", "本屋", "花屋", "食堂", "商店"] },
    { style: "tower", wall: "#dfe3ea", colors: ["#9aa0b0", "#8a93b0", "#7f8aa0", "#a0a6b6"], minW: 3, maxW: 4, minH: 4, maxH: 6, names: ["アパート", "タワー", "レジデンス", "シティビル"] },
    { style: "house", wall: "#f0e2c8", colors: ["#cf7a52", "#caa05a", "#7aae8a", "#d98aa0", "#8aa0e0"], minW: 3, maxW: 3, minH: 3, maxH: 3, names: ["住宅", "コテージ", "農家"] },
  ];

  const state = {
    gameMinutes: 6 * 60, scene: "town", player: { x: 0, y: 0, dir: "down" },
    money: 800, energy: 100, inventory: {}, affection: {},
    homeBuilt: false, homeLevel: 1, ridingId: null,
    worldSeed: null, lastEventDay: -1, _savedVehicles: null,
    lastTotalDays: null, lastMonth: null, lastSeason: null, lastYear: null,
    speed: 1, paused: false,
    inBattle: false, battle: null,
  };

  const SCENES = {};
  const townFront = {};
  let scene = null;
  let activeTarget = null;

  // ============================================================
  //  時間・カレンダー・イベント
  // ============================================================
  function calc(minutes) {
    const total = Math.floor(minutes);
    const minutesInDay = ((total % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
    const totalDays = Math.floor(total / MIN_PER_DAY);
    const totalMonths = Math.floor(totalDays / DAYS_PER_MONTH);
    return {
      total, minutesInDay, hour: Math.floor(minutesInDay / 60), min: minutesInDay % 60, totalDays,
      day: (totalDays % DAYS_PER_MONTH) + 1, month: (totalMonths % MONTHS_PER_YEAR) + 1,
      year: Math.floor(totalMonths / MONTHS_PER_YEAR) + 1, weekday: WEEKDAYS[totalDays % 7], season: seasonOf((totalMonths % MONTHS_PER_YEAR) + 1),
    };
  }
  function seasonOf(m) { return m >= 3 && m <= 5 ? "春" : m >= 6 && m <= 8 ? "夏" : m >= 9 && m <= 11 ? "秋" : "冬"; }
  function seasonEmoji(s) { return { "春": "🌸", "夏": "🌻", "秋": "🍁", "冬": "❄️" }[s] || "🍃"; }
  function currentEvent() {
    const c = calc(state.gameMinutes);
    if (c.totalDays > 0 && c.totalDays % 12 === 0) return EVENTS[((c.totalDays / 12) - 1) % EVENTS.length];
    return null;
  }
  function upcomingEvent() {
    const c = calc(state.gameMinutes);
    const next = (Math.floor(c.totalDays / 12) + 1) * 12;
    return { ev: EVENTS[((next / 12) - 1) % EVENTS.length], days: next - c.totalDays };
  }

  function advanceTime(mins) { state.gameMinutes += mins; checkCalendar(); }
  function checkCalendar() {
    const c = calc(state.gameMinutes);
    if (state.lastTotalDays === null) {
      state.lastTotalDays = c.totalDays; state.lastMonth = c.month; state.lastSeason = c.season; state.lastYear = c.year; return;
    }
    if (c.totalDays !== state.lastTotalDays && c.totalDays > 0 && c.totalDays % 12 === 0) {
      const ev = EVENTS[((c.totalDays / 12) - 1) % EVENTS.length];
      toast(`${ev.emoji} 本日「${ev.name}」開催！ 広場へ行こう`);
    }
    if (c.month !== state.lastMonth || c.year !== state.lastYear) toast(`📅 ${c.year}年 ${c.month}月になりました`);
    if (c.season !== state.lastSeason) toast(`${seasonEmoji(c.season)} ${c.season}になりました`);
    state.lastTotalDays = c.totalDays; state.lastMonth = c.month; state.lastSeason = c.season; state.lastYear = c.year;
  }
  function computeNight(minInDay) {
    const h = minInDay / 60;
    if (h >= 19 || h < 5) return 1;
    if (h >= 17 && h < 19) return (h - 17) / 2;
    if (h >= 5 && h < 7) return (7 - h) / 2;
    return 0;
  }
  function dayNightOverlays(minInDay) {
    const nf = computeNight(minInDay), out = [];
    if (nf > 0.001) out.push(`rgba(18,22,58,${(0.5 * nf).toFixed(3)})`);
    const h = minInDay / 60; let warm = 0;
    if (h >= 5 && h < 7) warm = (1 - Math.abs(6 - h)) * 0.28;
    else if (h >= 17 && h < 19) warm = (1 - Math.abs(18 - h)) * 0.28;
    if (warm > 0.001) out.push(`rgba(255,150,70,${warm.toFixed(3)})`);
    return out;
  }

  // ============================================================
  //  シーン構築 — 共通
  // ============================================================
  function addTree(sc, tx, ty) { if (tx < 0 || ty < 0 || tx >= sc.w || ty >= sc.h) return; sc.solid[ty][tx] = 1; sc.trees.push({ tx, ty }); }
  function setGround(sc, tx, ty, g) { if (tx >= 0 && ty >= 0 && tx < sc.w && ty < sc.h && sc.solid[ty][tx] === 0) sc.ground[ty][tx] = g; }
  function fillWater(sc, cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
      if (x >= 0 && y >= 0 && x < sc.w && y < sc.h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) { sc.solid[y][x] = 1; sc.ground[y][x] = G_WATER; }
  }
  function addBuilding(sc, type, name, x, y, w, h, color, wall, style, interiorId) {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++)
      if (tx >= 0 && ty >= 0 && tx < sc.w && ty < sc.h) sc.solid[ty][tx] = 1;
    const doorTx = x + Math.floor(w / 2), doorTy = y + h - 1, frontTy = doorTy + 1;
    if (frontTy < sc.h) { sc.solid[frontTy][doorTx] = 0; sc.ground[frontTy][doorTx] = G_WALK; }
    const b = { type, name, x, y, w, h, color, wall, style, interiorId, door: { tx: doorTx, ty: doorTy }, ix: (doorTx + 0.5) * TILE, iy: (frontTy + 0.5) * TILE };
    sc.buildings.push(b); return b;
  }
  function mkNpc(name, color, tx, ty, lines, vehicle, vColor) {
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    return { name, color, x, y, hx: x, hy: y, lines, vx: 0, vy: 0, timer: 0, vehicle: vehicle || null, vColor: vColor || "#888" };
  }

  // ============================================================
  //  街(town)の生成 — 道路グリッド + 主要施設 + シードによる自動生成
  // ============================================================
  function paintRoads(t) {
    const hRoad = (y, w) => { for (let x = 4; x < t.w - 4; x++) setGround(t, x, y, w ? G_WALK : G_ROAD); };
    hRoad(27, true); hRoad(28); hRoad(29); hRoad(30); hRoad(31, true);   // 大通り
    hRoad(15, true); hRoad(16); hRoad(17); hRoad(18, true);              // 北の道
    hRoad(39, true); hRoad(40); hRoad(41); hRoad(42, true);              // 南の道
    const vRoad = (x) => { for (let y = 15; y <= 42; y++) setGround(t, x, y, G_ROAD); };
    vRoad(22); vRoad(23); vRoad(56); vRoad(57);                          // 縦の通り
  }

  function buildTown(seed) {
    const t = blankScene("town", "town", MAP_W, MAP_H);
    t.infinite = true; t.coreW = MAP_W; t.coreH = MAP_H; t.worldSeed = seed; t.chunks = new Map();
    const rng = makeRng(seed);
    paintRoads(t);

    // 中央のイベント広場 (舗装)
    for (let y = 32; y <= 38; y++) for (let x = 30; x <= 42; x++) setGround(t, x, y, G_WALK);

    // 主要施設 (ドアは南向き、正面は歩道に接する)
    addBuilding(t, "home", "マイホーム", 10, 24, 3, 3, "#cf7a52", "#f0d8b6", "house", "home");
    addBuilding(t, "cafe", "カフェ", 18, 24, 4, 3, "#6f9bd0", "#dce8f5", "flat", "cafe");
    addBuilding(t, "shop", "コンビニ", 27, 24, 4, 3, "#4fae8a", "#dff3ea", "flat", "shop");
    addBuilding(t, "mansion", "マンション", 60, 22, 4, 5, "#9aa0b0", "#cdd3df", "tower", "mansion");
    addBuilding(t, "arena", "バトルアリーナ", 68, 23, 5, 4, "#8a5fae", "#e0d2f0", "flat", "arena");
    addBuilding(t, "house_mio", "ミオの家", 12, 36, 3, 3, "#e08aa0", "#f7dde6", "house", "house_mio");
    addBuilding(t, "house_haru", "ハルの家", 26, 36, 3, 3, "#8aa0e0", "#dde6f7", "house", "house_haru");
    addBuilding(t, "house_sora", "ソラの家", 50, 36, 3, 3, "#7aae8a", "#dff0e6", "house", "house_sora");
    t.buildings.forEach((b) => setGround(t, b.door.tx, b.door.ty + 1, G_WALK));

    // 主要施設のポータル + 自宅の建築アクション
    t.buildings.forEach((b) => {
      townFront[b.interiorId] = { x: b.ix, y: b.iy };
      if (b.type === "home") {
        t.portals.push({ x: b.ix, y: b.iy, to: "home", label: "マイホームに入る 🏠", cond: () => state.homeBuilt });
        t.interactables.push({ x: b.ix, y: b.iy, range: INTERACT_RANGE, label: "家を建てる 🔨", action: confirmBuild, cond: () => !state.homeBuilt });
      } else {
        t.portals.push({ x: b.ix, y: b.iy, to: b.interiorId, label: `${b.name}に入る` });
      }
    });

    // 広場の噴水・掲示板
    t.solid[35][36] = 1; t.props.push({ type: "fountain", tx: 36, ty: 35 });
    t.solid[36][40] = 1; t.props.push({ type: "noticeboard", tx: 40, ty: 36 });
    t.interactables.push({ x: 40.5 * TILE, y: 36.5 * TILE, range: 54, label: () => "📋 掲示板を見る", action: openEventBoard });
    t.eventArea = { x0: 30, y0: 32, x1: 42, y1: 38 };

    // 街灯
    [8, 16, 24, 32, 40, 48, 56, 64, 72].forEach((c) => {
      t.lights.push({ x: (c + 0.5) * TILE, y: 27.5 * TILE });
      t.lights.push({ x: (c + 0.5) * TILE, y: 31.5 * TILE });
    });

    // 友達(徘徊)
    t.npcs.push(mkNpc("ミオ", "#e76f8f", 34, 34, ["やっほー！今日もいい天気だね。", "街、どんどん発展してるね！", "イベントの日は広場が楽しいよ。"]));
    t.npcs.push(mkNpc("ハル", "#6f9be7", 38, 35, ["カフェのコーヒー美味しいよ。", "車で遠くまでドライブするんだ。", "マンションの最上階、憧れるなあ。"], "car", "#e0b341"));
    t.npcs.push(mkNpc("ソラ", "#5fae5a", 33, 36, ["のんびりするのが一番だよ。", "スクーターで街を一周するの好き。", "また話そうね！"], "scooter", "#4f9bd0"));
    t.npcs.push(mkNpc("通行人", "#caa05a", 24, 30, ["こんにちは。", "いい街だね。", "サイクリング日和だ！"], "bike", "#d24b3e"));

    // 乗り物
    t.vehicles = [
      { id: "bike", type: "bike", name: "自転車", emoji: "🚲", color: "#d24b3e", speed: 1.9, x: 14.5 * TILE, y: 27.5 * TILE },
      { id: "scooter", type: "scooter", name: "スクーター", emoji: "🛵", color: "#4f9bd0", speed: 2.7, x: 34.5 * TILE, y: 27.5 * TILE },
      { id: "car", type: "car", name: "車", emoji: "🚗", color: "#e0b341", speed: 3.6, x: 64.5 * TILE, y: 27.5 * TILE },
    ];

    generateDeco(t, rng);
    generateTrees(t, rng);

    t.spawn = { x: 11.5 * TILE, y: 27.5 * TILE };
    return t;
  }

  // 装飾ビルの自動生成 (シード) — 都市の広がりを作る。入れない景観用。
  function generateDeco(t, rng) {
    const palette = [
      { style: "flat", wall: "#e7e2d8", colors: ["#6f9bd0", "#4fae8a", "#d08a6f", "#9a8ad0", "#d0b14f"], minW: 3, maxW: 5, minH: 3, maxH: 3, names: ["オフィス", "ショップ", "ベーカリー", "本屋", "花屋", "クリニック", "ジム", "雑貨店"] },
      { style: "tower", wall: "#dfe3ea", colors: ["#9aa0b0", "#8a93b0", "#7f8aa0", "#a0a6b6"], minW: 3, maxW: 4, minH: 4, maxH: 6, names: ["アパート", "タワー", "レジデンス", "シティビル"] },
      { style: "house", wall: "#f0e2c8", colors: ["#cf7a52", "#caa05a", "#7aae8a", "#d98aa0", "#8aa0e0"], minW: 3, maxW: 3, minH: 3, maxH: 3, names: ["住宅", "コテージ", "アトリエ"] },
    ];
    let placed = 0, tries = 0;
    while (placed < 50 && tries < 1200) {
      tries++;
      const p = choice(rng, palette);
      const w = p.minW + Math.floor(rng() * (p.maxW - p.minW + 1));
      const h = p.minH + Math.floor(rng() * (p.maxH - p.minH + 1));
      const x = 2 + Math.floor(rng() * (t.w - 5 - w));
      const y = 2 + Math.floor(rng() * (t.h - 5 - h));
      if (!canPlaceBuilding(t, x, y, w, h)) continue;
      const b = addBuilding(t, "deco", choice(rng, p.names), x, y, w, h, choice(rng, p.colors), p.wall, p.style, "none");
      b.deco = true; placed++;
    }
  }
  function canPlaceBuilding(t, x, y, w, h) {
    for (let ty = y - 1; ty <= y + h; ty++) for (let tx = x - 1; tx <= x + w; tx++) {
      if (tx < 1 || ty < 1 || tx >= t.w - 1 || ty >= t.h - 1) return false;
      if (t.solid[ty][tx] !== 0) return false;            // 既存の建物/木/水/道路際の物と離す
    }
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++)
      if (t.ground[ty][tx] !== G_GRASS) return false;       // 道路/広場/水の上には建てない
    const fy = y + h, fx = x + Math.floor(w / 2);
    if (fy >= t.h || t.solid[fy][fx] !== 0) return false;
    return true;
  }
  function generateTrees(t, rng) {
    let placed = 0, tries = 0;
    while (placed < 80 && tries < 2000) {
      tries++;
      const x = 2 + Math.floor(rng() * (t.w - 4)), y = 2 + Math.floor(rng() * (t.h - 4));
      if (t.solid[y][x] === 0 && t.ground[y][x] === G_GRASS) { addTree(t, x, y); placed++; }
    }
  }

  // ============================================================
  //  無限ワールド (チャンク方式) — 中心のダウンタウン(core)の外側を
  //  シードから決定的に生成する。同じシードなら同じ世界。
  // ============================================================
  const CHUNK = 16;
  function pmod(a, n) { return ((a % n) + n) % n; }
  function coreContains(gx, gy) { return gx >= 0 && gy >= 0 && gx < scene.coreW && gy < scene.coreH; }
  function isRoadTile(gx, gy) { return pmod(gx, 20) < 2 || pmod(gy, 20) < 2; }     // 無限の道路グリッド
  // 陸/海をシードから滑らかに決める (value noise)。海に島が浮かぶ archipelago。
  const LAND_GRID = 22, LAND_THRESHOLD = 0.46;
  function hash01(seed, i, j) {
    let h = (seed >>> 0) ^ Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function landValue(gx, gy) {
    const fx = gx / LAND_GRID, fy = gy / LAND_GRID, i = Math.floor(fx), j = Math.floor(fy);
    const tx = smooth(fx - i), ty = smooth(fy - j), s = scene.worldSeed;
    const a = hash01(s, i, j) + (hash01(s, i + 1, j) - hash01(s, i, j)) * tx;
    const b = hash01(s, i, j + 1) + (hash01(s, i + 1, j + 1) - hash01(s, i, j + 1)) * tx;
    return a + (b - a) * ty;
  }
  function isLand(gx, gy) {
    if (gx >= -6 && gy >= -6 && gx < scene.coreW + 6 && gy < scene.coreH + 6) return true; // 中心の街+周囲は必ず陸
    return landValue(gx, gy) > LAND_THRESHOLD;
  }
  function townSolidTile(gx, gy) { return coreContains(gx, gy) ? scene.solid[gy][gx] : chunkSolid(gx, gy); }
  function hashChunk(seed, cx, cy) {
    let h = (seed >>> 0) ^ Math.imul(cx | 0, 374761393) ^ Math.imul(cy | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function getChunk(cx, cy) {
    const key = cx + "," + cy;
    let ch = scene.chunks.get(key);
    if (!ch) { ch = generateChunk(cx, cy); scene.chunks.set(key, ch); }
    return ch;
  }
  function generateChunk(cx, cy) {
    const rng = makeRng(hashChunk(scene.worldSeed, cx, cy));
    const ground = makeGrid(CHUNK, CHUNK, G_GRASS), solid = makeGrid(CHUNK, CHUNK, 0);
    const baseX = cx * CHUNK, baseY = cy * CHUNK, trees = [], buildings = [];
    // 陸/海/道路/橋
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const gx = baseX + lx, gy = baseY + ly;
      if (coreContains(gx, gy)) continue;                       // 中心の街は core 側で扱う
      const land = isLand(gx, gy), road = isRoadTile(gx, gy);
      if (road) { ground[ly][lx] = land ? G_ROAD : G_BRIDGE; } // 海をまたぐ道路は橋(歩ける)
      else if (land) { ground[ly][lx] = G_GRASS; }
      else { ground[ly][lx] = G_WATER; solid[ly][lx] = 1; }    // 海(歩けない)
    }
    const tc = 4 + Math.floor(rng() * 14);                                         // 木 (陸の草地のみ)
    for (let i = 0; i < tc; i++) {
      const lx = Math.floor(rng() * CHUNK), ly = Math.floor(rng() * CHUNK), gx = baseX + lx, gy = baseY + ly;
      if (solid[ly][lx] === 0 && ground[ly][lx] === G_GRASS && !coreContains(gx, gy)) { solid[ly][lx] = 1; trees.push({ tx: gx, ty: gy }); }
    }
    let bc = rng() < 0.55 ? 1 : 0; if (rng() < 0.18) bc++;                         // 建物 (陸の草地のみ)
    for (let k = 0; k < bc; k++) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const p = choice(rng, CHUNK_BUILDINGS);
        const w = p.minW + Math.floor(rng() * (p.maxW - p.minW + 1));
        const h = p.minH + Math.floor(rng() * (p.maxH - p.minH + 1));
        const lx = 1 + Math.floor(rng() * (CHUNK - 2 - w)), ly = 1 + Math.floor(rng() * (CHUNK - 2 - h));
        if (!chunkCanPlace(ground, solid, lx, ly, w, h, baseX, baseY)) continue;
        for (let yy = ly; yy < ly + h; yy++) for (let xx = lx; xx < lx + w; xx++) solid[yy][xx] = 1;
        buildings.push({ type: "deco", name: choice(rng, p.names), x: baseX + lx, y: baseY + ly, w, h, color: choice(rng, p.colors), wall: p.wall, style: p.style, deco: true, door: { tx: baseX + lx + Math.floor(w / 2), ty: baseY + ly + h - 1 } });
        break;
      }
    }
    return { ground, solid, trees, buildings };
  }
  function chunkCanPlace(ground, solid, lx, ly, w, h, baseX, baseY) {
    for (let yy = ly - 1; yy <= ly + h; yy++) for (let xx = lx - 1; xx <= lx + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= CHUNK || yy >= CHUNK) return false;
      if (solid[yy][xx] !== 0) return false;
    }
    for (let yy = ly; yy < ly + h; yy++) for (let xx = lx; xx < lx + w; xx++) {
      if (ground[yy][xx] !== G_GRASS || coreContains(baseX + xx, baseY + yy)) return false;
    }
    return true;
  }
  function chunkGround(gx, gy) { return getChunk(Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)).ground[pmod(gy, CHUNK)][pmod(gx, CHUNK)]; }
  function chunkSolid(gx, gy) { return getChunk(Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)).solid[pmod(gy, CHUNK)][pmod(gx, CHUNK)]; }
  function townGround(gx, gy) { return coreContains(gx, gy) ? scene.ground[gy][gx] : chunkGround(gx, gy); }

  // ============================================================
  //  内装シーン
  // ============================================================
  function makeInterior(id, title, w, h, floor, wall, furniture, items, npcsArr) {
    const sc = blankScene(id, "interior", w, h);
    sc.title = title; sc.floor = floor; sc.wall = wall;
    for (let x = 0; x < w; x++) { sc.solid[0][x] = 1; sc.solid[h - 1][x] = 1; }
    for (let y = 0; y < h; y++) { sc.solid[y][0] = 1; sc.solid[y][w - 1] = 1; }
    const cx = Math.floor(w / 2);
    sc.doorTile = { tx: cx, ty: h - 1 };
    (furniture || []).forEach((f) => {
      for (let ty = f.ty; ty < f.ty + f.th; ty++) for (let tx = f.tx; tx < f.tx + f.tw; tx++)
        if (tx >= 0 && ty >= 0 && tx < w && ty < h) sc.solid[ty][tx] = 1;
      sc.furniture.push(f);
    });
    (items || []).forEach((it) => {
      sc.solid[it.ty][it.tx] = 1; sc.items.push(it);
      sc.interactables.push({ x: (it.tx + 0.5) * TILE, y: (it.ty + 0.5) * TILE, range: 52, label: it.label, action: it.action, cond: it.cond });
    });
    (npcsArr || []).forEach((n) => sc.npcs.push({ name: n.name, color: n.color, x: (n.tx + 0.5) * TILE, y: (n.ty + 0.5) * TILE, lines: n.lines, vx: 0, vy: 0, timer: 0, static: true }));
    sc.portals.push({ x: (cx + 0.5) * TILE, y: (h - 0.5) * TILE, range: 60, label: "外に出る 🚪", to: "town", from: id });
    sc.spawn = { x: (cx + 0.5) * TILE, y: (h - 1.5) * TILE };
    return sc;
  }
  function buildHomeInterior(level) {
    if (level >= 2) {
      return makeInterior("home", "自宅 Lv2", 12, 8, "#f0dcb4", "#caa074",
        [{ tx: 4, ty: 3, tw: 3, th: 1, color: "#a9794b" }, { tx: 2, ty: 5, tw: 1, th: 1, color: "#5fae4a" }],
        [{ tx: 2, ty: 2, label: "ベッドで寝る 🛏️", color: "#c98aa0", action: bedSleep },
         { tx: 9, ty: 2, label: "コレクション 🧸", color: "#caa05a", action: showCollection },
         { tx: 9, ty: 5, label: "家を拡張する 🔨", color: "#9aa0b0", action: confirmUpgrade, cond: () => state.homeLevel < 2 }], []);
    }
    return makeInterior("home", "自宅 Lv1", 9, 7, "#f0dcb4", "#caa074",
      [{ tx: 3, ty: 4, tw: 3, th: 1, color: "#a9794b" }],
      [{ tx: 2, ty: 2, label: "ベッドで寝る 🛏️", color: "#c98aa0", action: bedSleep },
       { tx: 6, ty: 2, label: "コレクション 🧸", color: "#caa05a", action: showCollection },
       { tx: 6, ty: 4, label: "家を拡張する 🔨", color: "#9aa0b0", action: confirmUpgrade, cond: () => state.homeLevel < 2 }], []);
  }
  function buildInteriors() {
    SCENES.home = buildHomeInterior(state.homeLevel || 1);
    SCENES.cafe = makeInterior("cafe", "カフェ", 11, 8, "#e9d2b0", "#bfa07a",
      [{ tx: 2, ty: 2, tw: 4, th: 1, color: "#6f4a2c" }, { tx: 2, ty: 5, tw: 1, th: 1, color: "#8a6a47" }, { tx: 8, ty: 5, tw: 1, th: 1, color: "#8a6a47" }],
      [{ tx: 5, ty: 3, label: "はたらく ☕", color: "#caa05a", action: confirmWork }],
      [{ name: "マスター", color: "#b08968", tx: 8, ty: 2, lines: ["いらっしゃい、ゆっくりしてって。", "今日のおすすめはカフェラテだよ。"] }]);
    SCENES.shop = makeInterior("shop", "コンビニ", 11, 8, "#e6ecef", "#9fb0bd",
      [{ tx: 2, ty: 2, tw: 1, th: 3, color: "#7f8a93" }, { tx: 8, ty: 2, tw: 1, th: 3, color: "#7f8a93" }],
      [{ tx: 5, ty: 2, label: "買い物する 🛒", color: "#4fae8a", action: openShop }],
      [{ name: "店員ナギ", color: "#5fae8a", tx: 6, ty: 2, lines: ["ポイントカードはお持ちですか？", "セールの日はお得ですよ！"] }]);
    SCENES.arena = makeInterior("arena", "バトルアリーナ", 12, 9, "#d9cdb0", "#7a6a9a",
      [{ tx: 4, ty: 4, tw: 4, th: 2, color: "#c9b78a" }],
      [{ tx: 6, ty: 2, label: "試合に出る ⚔️", color: "#8a5fae", action: confirmArena }],
      [{ name: "レフェリー", color: "#8a7f9a", tx: 2, ty: 2, lines: ["ルールは紳士的にね。", "大会の日は報酬が2倍だよ！"] }]);
    SCENES.mansion = makeInterior("mansion", "マンション ロビー", 12, 8, "#dfe3e8", "#aab2bd",
      [{ tx: 2, ty: 2, tw: 2, th: 1, color: "#8a93a0" }, { tx: 9, ty: 2, tw: 1, th: 3, color: "#7f8a93" }, { tx: 5, ty: 5, tw: 2, th: 1, color: "#9aa0b0" }],
      [{ tx: 6, ty: 2, label: "空き部屋を見学 🏙️", color: "#6f9bd0", action: () => flavor("モデルルーム 🏙️", "日当たり良好の最上階。広いリビングに大きな窓。<br>「いつかここに住むのも良いかも…」<div class=\"hint\">※ 入居機能は今後追加予定</div>") }],
      [{ name: "管理人", color: "#90969f", tx: 3, ty: 2, lines: ["ようこそマンションへ。", "街もずいぶん発展しましたねえ。"] }]);
    SCENES.house_mio = makeInterior("house_mio", "ミオの家", 9, 7, "#f3dfe6", "#c98aa0",
      [{ tx: 2, ty: 2, tw: 1, th: 2, color: "#d98aa0" }, { tx: 6, ty: 2, tw: 1, th: 1, color: "#5fae4a" }],
      [{ tx: 4, ty: 2, label: "部屋を眺める 👀", color: "#e08aa0", action: () => flavor("ミオの部屋", "花の香りでいっぱい。かわいい小物が並んでいる。") }], []);
    SCENES.house_haru = makeInterior("house_haru", "ハルの家", 9, 7, "#dfe6f3", "#8aa0c9",
      [{ tx: 2, ty: 2, tw: 1, th: 2, color: "#8aa0d9" }, { tx: 6, ty: 2, tw: 1, th: 1, color: "#a9794b" }],
      [{ tx: 4, ty: 2, label: "部屋を眺める 👀", color: "#8aa0e0", action: () => flavor("ハルの部屋", "本とコーヒー器具がきれいに並んでいる。") }], []);
    SCENES.house_sora = makeInterior("house_sora", "ソラの家", 9, 7, "#dfeede", "#7aae8a",
      [{ tx: 2, ty: 2, tw: 1, th: 2, color: "#7aae8a" }, { tx: 6, ty: 2, tw: 1, th: 1, color: "#5fae4a" }],
      [{ tx: 4, ty: 2, label: "部屋を眺める 👀", color: "#7aae8a", action: () => flavor("ソラの部屋", "植物だらけで落ち着く。窓から夜空が見える。") }], []);
  }

  // ============================================================
  //  シーン遷移・乗り物
  // ============================================================
  function enterScene(id, spawn) {
    scene = SCENES[id]; state.scene = id;
    state.player.x = spawn.x; state.player.y = spawn.y;
    activeTarget = null; el.prompt.style.display = "none"; save();
  }
  function usePortal(p) {
    if (p.to === "town") enterScene("town", townFront[p.from] || SCENES.town.spawn);
    else enterScene(p.to, SCENES[p.to].spawn);
  }
  function ridingVehicle() { return SCENES.town && state.ridingId ? SCENES.town.vehicles.find((v) => v.id === state.ridingId) : null; }
  function mountVehicle(v) { state.ridingId = v.id; toast(`${v.emoji} ${v.name}に乗った！`); save(); }
  function dismountVehicle() {
    const v = ridingVehicle();
    if (v) { v.x = state.player.x; v.y = state.player.y; }
    state.ridingId = null; save();
  }

  // ============================================================
  //  アクション
  // ============================================================
  function confirmWork() {
    showModal("カフェのバイト ☕", "所要 <b>4時間</b> ／ 元気 <b>-25</b> ／ おこづかい <b>+¥700</b>", [
      { label: "やめる", cls: "ghost", onClick: closeModal }, { label: "はたらく", cls: "primary", onClick: doWork }]);
  }
  function doWork() {
    if (state.energy < 25) { closeModal(); toast("⚡ つかれて働けない。休もう…"); return; }
    state.energy = Math.max(0, state.energy - 25); state.money += 700; advanceTime(240);
    closeModal(); toast("☕ バイトおつかれさま！ +¥700"); afterAction();
  }
  function priceOf(it) { const ev = currentEvent(); return ev && ev.id === "sale" ? Math.round(it.price * 0.7) : it.price; }
  function openShop() {
    const sale = currentEvent() && currentEvent().id === "sale";
    let body = `<div style="margin-bottom:6px;">所持金 <b>¥${state.money}</b>${sale ? ' <span style="color:#d24b3e;font-weight:800;">本日30%OFF!</span>' : ""}</div>`;
    SHOP_ITEMS.forEach((it) => {
      const meta = it.kind === "food" ? `元気+${it.energy}` : "かざりもの";
      body += `<div class="shopRow"><span>${it.name} <span class="meta">(${meta})</span></span><span><b>¥${priceOf(it)}</b></span></div>`;
    });
    const buttons = SHOP_ITEMS.map((it) => ({ label: `${it.name} ¥${priceOf(it)}`, cls: "ghost", onClick: () => buy(it) }));
    buttons.push({ label: "とじる", cls: "primary", onClick: closeModal });
    showModal("コンビニ 🛒", body, buttons);
  }
  function buy(it) {
    const price = priceOf(it);
    if (state.money < price) { toast("💸 お金が足りない…"); return; }
    state.money -= price;
    if (it.kind === "food") { state.energy = Math.min(100, state.energy + it.energy); toast(`🍙 ${it.name}を食べた！ 元気+${it.energy}`); }
    else { addItem(it.name); toast(`🎁 ${it.name}をコレクションに追加！`); }
    save(); updateHUD(); openShop();
  }
  function confirmArena() {
    const tourney = currentEvent() && currentEvent().id === "tournament";
    showModal("バトルアリーナ ⚔️", `<b>タイミングよく攻撃して相手のHPを削る</b>試合！<br>動くマーカーがゾーンに来た瞬間に <b>スペース / E</b>。<br>中心で <b>PERFECT</b>（大ダメージ）、外すと自分がダメージ。<br><br>参加費 <b>¥100</b> ／ 所要 <b>2時間</b> ／ 元気 <b>-20</b><br>勝てば <b>¥${tourney ? 1000 : 500}</b>${tourney ? " (大会で2倍!)" : ""} ＋ トロフィー！`, [
      { label: "やめる", cls: "ghost", onClick: closeModal }, { label: "試合開始", cls: "primary", onClick: startBattle }]);
  }
  function startBattle() {
    if (state.money < 100) { closeModal(); toast("💸 参加費が足りない…"); return; }
    if (state.energy < 20) { closeModal(); toast("⚡ つかれていて戦えない…"); return; }
    state.money -= 100; closeModal();
    state.inBattle = true; el.prompt.style.display = "none";
    state.battle = { enemyHP: 100, enemyMax: 100, playerHP: 100, playerMax: 100, pos: 0, dir: 1, speed: 0.62, zoneC: 0.5, zoneW: 0.13, perfW: 0.045, cooldown: 0, elapsed: 0, combo: 0, floats: [], over: false, result: null, endTimer: 0 };
    updateHUD();
  }
  function battleUpdate(dt) {
    const b = state.battle; if (!b) { state.inBattle = false; return; }
    if (b.over) { b.endTimer -= dt; if (b.endTimer <= 0) finishBattle(); return; }
    b.elapsed += dt; b.cooldown = Math.max(0, b.cooldown - dt);
    b.pos += b.dir * b.speed * dt;
    if (b.pos > 1) { b.pos = 1; b.dir = -1; } else if (b.pos < 0) { b.pos = 0; b.dir = 1; }
    for (const f of b.floats) { f.y += 42 * dt; f.life -= dt; }
    b.floats = b.floats.filter((f) => f.life > 0);
    if (b.elapsed > 45) endBattle(b.enemyHP <= b.playerHP);   // 長期戦の保険
  }
  function battleHit() {
    const b = state.battle; if (!b || b.over || b.cooldown > 0) return;
    b.cooldown = 0.16;
    const d = Math.abs(b.pos - b.zoneC); let dmg, txt, col;
    if (d <= b.perfW) { dmg = 20; txt = "PERFECT!"; col = "#ffd24b"; }
    else if (d <= b.zoneW) { dmg = 11; txt = "GOOD"; col = "#8fd06f"; }
    else { dmg = 0; txt = "MISS"; col = "#e85b4b"; }
    if (dmg > 0) { b.enemyHP = Math.max(0, b.enemyHP - dmg); b.combo += 1; b.floats.push({ x: b.pos, y: 0, text: `${txt} -${dmg}`, col, life: 0.85 }); }
    else { b.playerHP = Math.max(0, b.playerHP - 9); b.combo = 0; b.floats.push({ x: b.pos, y: 0, text: txt, col, life: 0.85 }); }
    b.zoneC = 0.15 + Math.random() * 0.7;                     // ゾーンを移動、少しずつ速く
    b.speed = Math.min(1.5, b.speed + 0.04);
    if (b.enemyHP <= 0) endBattle(true); else if (b.playerHP <= 0) endBattle(false);
  }
  function endBattle(win) { const b = state.battle; if (!b || b.over) return; b.over = true; b.result = win; b.endTimer = 1.4; }
  function finishBattle() {
    const win = state.battle && state.battle.result;
    state.inBattle = false; state.battle = null;
    state.energy = Math.max(0, state.energy - 20); advanceTime(120);
    if (win) { const reward = currentEvent() && currentEvent().id === "tournament" ? 1000 : 500; state.money += reward; addItem("トロフィー"); toast(`🏆 勝利！ +¥${reward}`); }
    else toast("😣 敗北… またチャレンジ！");
    afterAction();
  }
  function confirmBuild() {
    showModal("あなたの土地 🪧", "ここに自分の家を建てられる。<br>建築費 <b>¥300</b><div class=\"hint\">建てたら中に入って寝たり飾れる。お金を貯めれば拡張も。</div>", [
      { label: "やめる", cls: "ghost", onClick: closeModal }, { label: "家を建てる", cls: "primary", onClick: doBuild }]);
  }
  function doBuild() {
    if (state.money < 300) { closeModal(); toast("💸 お金が足りない…(¥300)"); return; }
    state.money -= 300; state.homeBuilt = true; state.homeLevel = 1; SCENES.home = buildHomeInterior(1);
    closeModal(); toast("🏠 マイホームが完成！ドアから入れるよ"); afterAction();
  }
  function confirmUpgrade() {
    showModal("家を拡張する 🔨", "もっと広い家にリフォーム。<br>費用 <b>¥1500</b>", [
      { label: "やめる", cls: "ghost", onClick: closeModal }, { label: "拡張する", cls: "primary", onClick: doUpgrade }]);
  }
  function doUpgrade() {
    if (state.money < 1500) { closeModal(); toast("💸 お金が足りない…(¥1500)"); return; }
    state.money -= 1500; state.homeLevel = 2; SCENES.home = buildHomeInterior(2);
    if (state.scene === "home") { scene = SCENES.home; state.player.x = scene.spawn.x; state.player.y = scene.spawn.y; }
    closeModal(); toast("🔨 家を拡張した！広くなった〜"); afterAction();
  }
  function bedSleep() {
    showModal("ベッド 🛏️", "寝て翌朝まで休む？ 元気が全回復します。", [
      { label: "やめる", cls: "ghost", onClick: closeModal }, { label: "ねる", cls: "primary", onClick: sleep }]);
  }
  function sleep() {
    const c = calc(state.gameMinutes), dayStart = c.totalDays * MIN_PER_DAY;
    state.gameMinutes = dayStart + (c.minutesInDay < 6 * 60 ? 6 * 60 : MIN_PER_DAY + 6 * 60);
    state.energy = 100; checkCalendar(); closeModal(); toast("🌙 ぐっすり眠った… 元気が回復！"); afterAction();
  }
  function showCollection() {
    const decor = Object.entries(state.inventory);
    const body = decor.length === 0 ? "まだ何も飾っていない。コンビニでかざりものを買おう。" : decor.map(([k, v]) => `・${k} ×${v}`).join("<br>");
    showModal("コレクション 🧸", body, [{ label: "とじる", cls: "primary", onClick: closeModal }]);
  }
  function talk(npc) {
    const line = npc.lines[Math.floor(Math.random() * npc.lines.length)];
    state.affection[npc.name] = (state.affection[npc.name] || 0) + 1;
    let extra = "";
    if (Math.random() < 0.25) { state.money += 50; extra = '<div class="hint">🎁 プレゼントをもらった (+¥50)</div>'; }
    save(); updateHUD();
    showModal(`${npc.name} 💬`, `「${line}」<div class="hint">なかよし度: ${state.affection[npc.name]}</div>${extra}`, [{ label: "またね", cls: "primary", onClick: closeModal }]);
  }
  function flavor(title, text) { showModal(title, text, [{ label: "もどる", cls: "primary", onClick: closeModal }]); }
  function addItem(name) { state.inventory[name] = (state.inventory[name] || 0) + 1; }
  function afterAction() { save(); updateHUD(); }

  // イベント掲示板
  function openEventBoard() {
    const c = calc(state.gameMinutes), ev = currentEvent();
    if (!ev) {
      const u = upcomingEvent();
      flavor("掲示板 📋", `次のイベント:<br><b>${u.ev.emoji} ${u.ev.name}</b><br>あと <b>${u.days}日</b><div class="hint">イベントは12日ごとに開催されます。</div>`);
      return;
    }
    const claimed = state.lastEventDay === c.totalDays;
    const desc = {
      matsuri: "お祭りだ！屋台で遊ぼう。<br>参加で 元気+30 ／ +¥150",
      sale: "本日コンビニ全品 <b>30%OFF</b>！<br>参加で コーヒー1杯ぶんの元気 +15 ／ +¥30",
      tournament: "本日アリーナの勝利報酬が <b>2倍</b>！<br>参加で 応援金 +¥50",
      live: "音楽フェス開催中！<br>参加で 友達みんなと なかよし度+1 ／ +¥120",
    }[ev.id];
    showModal(`${ev.emoji} ${ev.name} 開催中！`, desc + (claimed ? '<div class="hint">今日はもう楽しんだ。また来てね。</div>' : ""),
      claimed ? [{ label: "とじる", cls: "primary", onClick: closeModal }]
        : [{ label: "やめる", cls: "ghost", onClick: closeModal }, { label: "参加する 🎉", cls: "primary", onClick: () => joinEvent(ev) }]);
  }
  function joinEvent(ev) {
    const c = calc(state.gameMinutes);
    if (ev.id === "matsuri") { state.energy = Math.min(100, state.energy + 30); state.money += 150; }
    else if (ev.id === "live") { Object.keys(state.affection).forEach((k) => state.affection[k]++); state.money += 120; }
    else if (ev.id === "sale") { state.energy = Math.min(100, state.energy + 15); state.money += 30; }
    else if (ev.id === "tournament") { state.money += 50; }
    state.lastEventDay = c.totalDays; closeModal(); toast(`${ev.emoji} ${ev.name}を楽しんだ！`); afterAction();
  }

  // ============================================================
  //  インタラクト対象
  // ============================================================
  function currentTargets() {
    const list = [];
    for (const n of scene.npcs) list.push({ x: n.x, y: n.y, range: INTERACT_RANGE, label: `${n.name}と話す`, run: () => talk(n) });
    for (const it of scene.interactables) { if (it.cond && !it.cond()) continue; list.push({ x: it.x, y: it.y, range: it.range || INTERACT_RANGE, label: val(it.label), run: it.action }); }
    for (const p of scene.portals) { if (p.cond && !p.cond()) continue; list.push({ x: p.x, y: p.y, range: p.range || INTERACT_RANGE, label: val(p.label), run: () => usePortal(p) }); }
    if (scene.kind === "town" && scene.vehicles)
      for (const v of scene.vehicles) if (v.id !== state.ridingId) list.push({ x: v.x, y: v.y, range: INTERACT_RANGE, label: `${v.emoji} ${v.name}に乗る`, run: () => mountVehicle(v) });
    return list;
  }
  function findActiveTarget() {
    const p = state.player; let best = null, bd = Infinity;
    for (const t of currentTargets()) { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d <= t.range && d < bd) { bd = d; best = t; } }
    if (!best && state.ridingId && scene.kind === "town") { const v = ridingVehicle(); best = { x: p.x, y: p.y, label: `${v.emoji} 降りる`, run: dismountVehicle }; }
    return best;
  }

  // ============================================================
  //  入力
  // ============================================================
  const keys = {};
  const MOVE_KEYS = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  const INTERACT_KEYS = { KeyE: 1, Space: 1, Enter: 1 };
  window.addEventListener("keydown", (e) => {
    if (MOVE_KEYS[e.code]) { keys[MOVE_KEYS[e.code]] = true; e.preventDefault(); return; }
    if (INTERACT_KEYS[e.code]) { e.preventDefault(); if (state.inBattle) battleHit(); else if (!isModalOpen() && activeTarget) activeTarget.run(); return; }
    if (e.code === "Escape" && state.inBattle) { endBattle(false); return; }
    if (e.code === "Escape" && isModalOpen()) closeModal();
  });
  window.addEventListener("keyup", (e) => { if (MOVE_KEYS[e.code]) keys[MOVE_KEYS[e.code]] = false; });
  document.querySelectorAll(".chip[data-speed]").forEach((chip) => chip.addEventListener("click", () => setSpeed(parseInt(chip.dataset.speed, 10))));
  document.getElementById("helpBtn").addEventListener("click", showHelp);
  document.getElementById("resetBtn").addEventListener("click", () => {
    showModal("リセット", "セーブを消して最初からやり直す？（街も再生成されます）", [
      { label: "やめる", cls: "ghost", onClick: closeModal },
      { label: "リセットする", cls: "primary", onClick: () => { localStorage.removeItem(SAVE_KEY); location.reload(); } }]);
  });
  function setSpeed(s) { state.speed = s; document.querySelectorAll(".chip[data-speed]").forEach((c) => c.classList.toggle("active", parseInt(c.dataset.speed, 10) === s)); }

  // ============================================================
  //  移動・当たり判定
  // ============================================================
  function walkableWorld(px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (scene.infinite) {
      if (tx >= 0 && ty >= 0 && tx < scene.coreW && ty < scene.coreH) return scene.solid[ty][tx] === 0;
      return chunkSolid(tx, ty) === 0;
    }
    if (tx < 0 || ty < 0 || tx >= scene.w || ty >= scene.h) return false;
    return scene.solid[ty][tx] === 0;
  }
  function canStand(cx, cy, half) {
    return walkableWorld(cx - half, cy - half) && walkableWorld(cx + half, cy - half) && walkableWorld(cx - half, cy + half) && walkableWorld(cx + half, cy + half);
  }
  function moveEntity(ent, dx, dy, half) {
    if (dx !== 0 && canStand(ent.x + dx, ent.y, half)) ent.x += dx;
    if (dy !== 0 && canStand(ent.x, ent.y + dy, half)) ent.y += dy;
  }

  // ============================================================
  //  UI: モーダル / トースト / HUD
  // ============================================================
  function isModalOpen() { return el.overlay.style.display === "flex"; }
  function showModal(title, bodyHtml, buttons) {
    el.modalTitle.textContent = title; el.modalBody.innerHTML = bodyHtml; el.modalButtons.innerHTML = "";
    (buttons || []).forEach((b) => {
      const btn = document.createElement("button"); btn.className = "btn " + (b.cls || ""); btn.textContent = b.label;
      btn.addEventListener("click", b.onClick); el.modalButtons.appendChild(btn);
    });
    el.overlay.style.display = "flex"; state.paused = true;
  }
  function closeModal() { el.overlay.style.display = "none"; state.paused = false; }
  el.overlay.addEventListener("click", (e) => { if (e.target === el.overlay) closeModal(); });
  function toast(msg) { const d = document.createElement("div"); d.className = "toast panel"; d.textContent = msg; el.toasts.appendChild(d); setTimeout(() => d.remove(), 2600); }
  function updateHUD() {
    const c = calc(state.gameMinutes);
    el.date.textContent = `${c.year}年 ${c.month}月 ${c.day}日(${c.weekday})`;
    el.clock.textContent = `${pad(c.hour)}:${pad(c.min)}`;
    el.season.textContent = `${seasonEmoji(c.season)} ${c.season}`;
    el.place.textContent = scene.kind === "town" ? `まち (${Math.floor(state.player.x / TILE)}, ${Math.floor(state.player.y / TILE)})` : (scene.title || "");
    el.money.textContent = `¥${state.money}`;
    el.energyFill.style.width = `${state.energy}%`;
    const ev = currentEvent();
    if (ev) { el.eventBox.style.display = "block"; el.eventName.textContent = `${ev.emoji} ${ev.name} 開催中`; }
    else el.eventBox.style.display = "none";
  }
  function showHelp() {
    showModal("まちぐらし ― あそびかた", `
      <b>移動:</b> WASD / 矢印キー　<b>調べる/入る:</b> 近づいて <b>E</b><br><br>
      🔨 空き地で<b>家を建てる</b>（¥300）→ ドアから家の中へ<br>
      🚲🛵🚗 街の<b>乗り物</b>に乗ると速く移動（種類で速さが違う）<br>
      ☕ カフェで働く／🛒 コンビニで買い物／⚔️ アリーナで腕試し<br>
      🏙️ マンション見学／💬 友達と話す<br>
      🎉 <b>12日ごとにイベント</b>開催！広場の<b>掲示板</b>をチェック<br><br>
      <div class="hint">中心の街から外は<b>無限に自動生成</b>。どこまでも歩けます（左上の座標で現在地がわかる／(11,26)あたりが自宅）。同じセーブなら同じ世界。右上「速さ」で早送り。</div>
    `, [{ label: "はじめる", cls: "primary", onClick: closeModal }]);
  }

  // ============================================================
  //  セーブ / ロード
  // ============================================================
  function save() {
    try {
      const veh = SCENES.town && SCENES.town.vehicles ? SCENES.town.vehicles.map((v) => ({ id: v.id, x: v.x, y: v.y })) : null;
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        gameMinutes: state.gameMinutes, scene: state.scene, player: state.player, money: state.money, energy: state.energy,
        inventory: state.inventory, affection: state.affection, homeBuilt: state.homeBuilt, homeLevel: state.homeLevel,
        ridingId: state.ridingId, worldSeed: state.worldSeed, lastEventDay: state.lastEventDay, vehicles: veh,
      }));
    } catch (e) { /* noop */ }
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (typeof s.gameMinutes === "number") state.gameMinutes = s.gameMinutes;
      if (typeof s.scene === "string") state.scene = s.scene;
      if (s.player) state.player = s.player;
      if (typeof s.money === "number") state.money = s.money;
      if (typeof s.energy === "number") state.energy = s.energy;
      if (s.inventory) state.inventory = s.inventory;
      if (s.affection) state.affection = s.affection;
      if (typeof s.homeBuilt === "boolean") state.homeBuilt = s.homeBuilt;
      if (typeof s.homeLevel === "number") state.homeLevel = s.homeLevel;
      if (typeof s.ridingId === "string" || s.ridingId === null) state.ridingId = s.ridingId;
      if (typeof s.worldSeed === "number") state.worldSeed = s.worldSeed;
      if (typeof s.lastEventDay === "number") state.lastEventDay = s.lastEventDay;
      state._savedVehicles = s.vehicles || null;
      return true;
    } catch (e) { return false; }
  }
  function applyVehicleSave() {
    if (!state._savedVehicles || !SCENES.town) return;
    state._savedVehicles.forEach((sv) => { const v = SCENES.town.vehicles.find((x) => x.id === sv.id); if (v) { v.x = sv.x; v.y = sv.y; } });
  }

  // ============================================================
  //  更新
  // ============================================================
  function update(dt) {
    if (state.inBattle) { battleUpdate(dt); updateHUD(); return; }
    if (!state.paused) {
      let dx = 0, dy = 0;
      if (keys.left) dx -= 1; if (keys.right) dx += 1; if (keys.up) dy -= 1; if (keys.down) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy); dx /= len; dy /= len;
        const rv = ridingVehicle();
        const sp = PLAYER_SPEED * (rv && scene.kind === "town" ? rv.speed : 1);
        moveEntity(state.player, dx * sp * dt, dy * sp * dt, PLAYER_HALF);
        state.player.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
      }
      state.gameMinutes += dt * TIME_BASE * state.speed; checkCalendar();
      for (const n of scene.npcs) {
        if (n.static) continue;
        n.timer -= dt;
        if (n.timer <= 0) {
          if (Math.hypot(n.x - n.hx, n.y - n.hy) > 14 * TILE) {       // 遠くに行きすぎたら家の方へ戻る
            const a = Math.atan2(n.hy - n.y, n.hx - n.x); n.vx = Math.cos(a); n.vy = Math.sin(a);
          } else if (Math.random() < 0.4) { n.vx = 0; n.vy = 0; }
          else { const a = Math.random() * Math.PI * 2; n.vx = Math.cos(a); n.vy = Math.sin(a); }
          n.timer = 1 + Math.random() * 2.5;
        }
        const nspeed = n.vehicle ? 115 : 45;                          // 乗り物のNPCは速い
        if (n.vx || n.vy) moveEntity(n, n.vx * nspeed * dt, n.vy * nspeed * dt, 9);
      }
      activeTarget = findActiveTarget();
      if (activeTarget) { el.promptText.textContent = activeTarget.label; el.prompt.style.display = "block"; }
      else el.prompt.style.display = "none";
    }
    updateHUD();
  }

  // ============================================================
  //  描画
  // ============================================================
  const cam = { x: 0, y: 0 };
  function updateCamera() {
    const vw = canvas.width, vh = canvas.height;
    if (scene.infinite) { cam.x = state.player.x - vw / 2; cam.y = state.player.y - vh / 2; return; }
    const ww = scene.w * TILE, wh = scene.h * TILE;
    cam.x = clamp(state.player.x - vw / 2, 0, Math.max(0, ww - vw));
    cam.y = clamp(state.player.y - vh / 2, 0, Math.max(0, wh - vh));
    if (ww < vw) cam.x = (ww - vw) / 2;
    if (wh < vh) cam.y = (wh - vh) / 2;
  }
  function visibleTiles() {
    const x0 = Math.floor(cam.x / TILE), y0 = Math.floor(cam.y / TILE);
    const x1 = Math.ceil((cam.x + canvas.width) / TILE), y1 = Math.ceil((cam.y + canvas.height) / TILE);
    if (scene.infinite) return { x0, y0, x1, y1 };
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(scene.w - 1, x1), y1: Math.min(scene.h - 1, y1) };
  }
  function render() {
    updateCamera(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (scene.kind === "town") renderTown(); else renderInterior();
    if (state.inBattle) drawBattle();
  }

  function renderTown() {
    const c = calc(state.gameMinutes), nf = computeNight(c.minutesInDay), v = visibleTiles(), ev = currentEvent();
    for (let ty = v.y0; ty <= v.y1; ty++) {
      for (let tx = v.x0; tx <= v.x1; tx++) {
        const sx = tx * TILE - cam.x, sy = ty * TILE - cam.y, g = townGround(tx, ty);
        if (g === G_WATER) ctx.fillStyle = "#3a6ea5";
        else if (g === G_BRIDGE) ctx.fillStyle = "#b78a52";
        else if (g === G_ROAD) ctx.fillStyle = "#5b6168";
        else if (g === G_WALK) ctx.fillStyle = "#cfc7b8";
        else if (g === G_PATH) ctx.fillStyle = "#e0c79a";
        else ctx.fillStyle = (pmod(tx, 2) === pmod(ty, 2)) ? "#8fce6f" : "#86c766";
        ctx.fillRect(sx, sy, TILE, TILE);
        if (g === G_WATER) { ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fillRect(sx + 5, sy + 8, 10, 2); ctx.fillRect(sx + 15, sy + 19, 8, 2); }
        else if (g === G_BRIDGE) { ctx.fillStyle = "rgba(90,60,30,0.5)"; ctx.fillRect(sx, sy + 6, TILE, 2); ctx.fillRect(sx, sy + 20, TILE, 2); }
      }
    }
    // 表示範囲のチャンクを収集 (草地以外=coreの外側の建物・木)
    const vis = [];
    for (let ccy = Math.floor(v.y0 / CHUNK); ccy <= Math.floor(v.y1 / CHUNK); ccy++)
      for (let ccx = Math.floor(v.x0 / CHUNK); ccx <= Math.floor(v.x1 / CHUNK); ccx++) vis.push(getChunk(ccx, ccy));
    for (const p of scene.props) drawProp(p, nf);
    for (const b of scene.buildings) (b.type === "home" && !state.homeBuilt) ? drawPlot(b) : drawBuilding(b, nf);
    for (const ch of vis) for (const b of ch.buildings) drawBuilding(b, nf);
    const inView = (tx, ty) => !(tx < v.x0 - 1 || tx > v.x1 + 1 || ty < v.y0 - 1 || ty > v.y1 + 1);
    for (const t of scene.trees) { if (inView(t.tx, t.ty)) drawTree(t.tx * TILE - cam.x, t.ty * TILE - cam.y); }
    for (const ch of vis) for (const t of ch.trees) { if (inView(t.tx, t.ty)) drawTree(t.tx * TILE - cam.x, t.ty * TILE - cam.y); }
    for (const L of scene.lights) drawLight(L, nf);
    if (ev) drawEventDecor(nf);
    if (scene.vehicles) for (const veh of scene.vehicles) if (veh.id !== state.ridingId) drawVehicle(veh.type, veh.x - cam.x, veh.y - cam.y, veh.color);
    drawHighlight(); drawActors();
    for (const o of dayNightOverlays(c.minutesInDay)) { ctx.fillStyle = o; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    drawMinimap();
  }
  function drawMinimap() {
    const R = 26, size = 134, cell = size / (2 * R + 1);
    const ox = canvas.width - size - 14, oy = canvas.height - size - 14;
    const ptx = Math.floor(state.player.x / TILE), pty = Math.floor(state.player.y / TILE);
    ctx.fillStyle = "rgba(40,28,16,0.55)"; roundRect(ox - 4, oy - 4, size + 8, size + 8, 9); ctx.fill();
    ctx.save(); roundRect(ox, oy, size, size, 6); ctx.clip();
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const gx = ptx + dx, gy = pty + dy, g = townGround(gx, gy);
        let col;
        if (g === G_WATER) col = "#3a6ea5";
        else if (g === G_BRIDGE) col = "#b78a52";
        else if (g === G_ROAD) col = "#7c828a";
        else if (g === G_WALK) col = "#cfc7b8";
        else col = townSolidTile(gx, gy) !== 0 ? "#3f6b39" : "#7cc05a";
        ctx.fillStyle = col;
        ctx.fillRect(ox + (dx + R) * cell, oy + (dy + R) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    const hf = townFront.home;                                  // 自宅マーカー
    if (hf) {
      const hx = Math.floor(hf.x / TILE) - ptx, hy = Math.floor(hf.y / TILE) - pty;
      if (Math.abs(hx) <= R && Math.abs(hy) <= R) { ctx.fillStyle = "#ffd24b"; ctx.fillRect(ox + (hx + R) * cell - 1, oy + (hy + R) * cell - 1, cell + 2, cell + 2); }
    }
    ctx.restore();
    ctx.strokeStyle = "#fff6e6"; ctx.lineWidth = 2; roundRect(ox, oy, size, size, 6); ctx.stroke();
    ctx.fillStyle = "#ff5a3c"; ctx.beginPath(); ctx.arc(ox + size / 2, oy + size / 2, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "rgba(255,246,230,0.9)"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("MAP", ox + 5, oy + 12);
  }
  function renderInterior() {
    const v = visibleTiles();
    for (let ty = v.y0; ty <= v.y1; ty++) {
      for (let tx = v.x0; tx <= v.x1; tx++) {
        const sx = tx * TILE - cam.x, sy = ty * TILE - cam.y;
        const wall = tx === 0 || ty === 0 || tx === scene.w - 1 || ty === scene.h - 1;
        if (wall) { ctx.fillStyle = scene.wall; ctx.fillRect(sx, sy, TILE, TILE); if (ty === 0) { ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(sx, sy + TILE - 6, TILE, 6); } }
        else { ctx.fillStyle = scene.floor; ctx.fillRect(sx, sy, TILE, TILE); if ((tx + ty) % 2 === 0) { ctx.fillStyle = "rgba(0,0,0,0.04)"; ctx.fillRect(sx, sy, TILE, TILE); } }
      }
    }
    const d = scene.doorTile, dx = d.tx * TILE - cam.x, dy = d.ty * TILE - cam.y;
    ctx.fillStyle = "#8a5a3b"; ctx.fillRect(dx + 5, dy + 4, TILE - 10, TILE - 4);
    ctx.fillStyle = "#caa05a"; ctx.fillRect(dx + 10, dy + 9, TILE - 20, 4);
    for (const f of scene.furniture) drawFurniture(f);
    for (const it of scene.items) { if (it.cond && !it.cond()) continue; drawItem(it); }
    drawHighlight(); drawActors();
  }

  function drawActors() {
    const chars = scene.npcs.map((n) => ({ x: n.x, y: n.y, color: n.color, name: n.name, vehicle: n.vehicle, vColor: n.vColor }));
    chars.push({ x: state.player.x, y: state.player.y, color: "#ffcf5a", name: "あなた", isPlayer: true, dir: state.player.dir });
    chars.sort((a, b) => a.y - b.y);
    for (const c of chars) {
      let vt = null, vc = null;
      if (c.isPlayer) { const rv = state.ridingId && scene.kind === "town" ? ridingVehicle() : null; if (rv) { vt = rv.type; vc = rv.color; } }
      else if (c.vehicle && scene.kind === "town") { vt = c.vehicle; vc = c.vColor; }
      if (vt) drawVehicle(vt, c.x - cam.x, c.y - cam.y, vc);
      drawCharacter(c, vt ? -5 : 0);
    }
  }
  function drawHighlight() {
    if (!activeTarget || state.paused) return;
    const mx = activeTarget.x - cam.x, my = activeTarget.y - cam.y, bob = Math.sin(state.gameMinutes * 0.6) * 3;
    ctx.fillStyle = "#fff2c4"; ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx, my - 34 + bob); ctx.lineTo(mx - 7, my - 46 + bob); ctx.lineTo(mx + 7, my - 46 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function drawSign(cx, topY, name) {
    ctx.font = "bold 13px sans-serif";
    const tw = ctx.measureText(name).width + 14, sx = cx - tw / 2;
    ctx.fillStyle = "#fff6e6"; ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 2;
    roundRect(sx, topY, tw, 18, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#6b4a2b"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(name, cx, topY + 9);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  function drawWindows(x, y, w, h, cols, rows, nf) {
    const winCol = lerpColor([191, 224, 245], [255, 233, 160], nf), cw = w / cols;
    for (let r = 0; r < rows; r++) for (let ci = 0; ci < cols; ci++) {
      const mw = Math.min(13, cw - 7), mh = 9, wx = x + (ci + 0.5) * cw - mw / 2, wy = y + 6 + r * ((h - 8) / Math.max(1, rows));
      ctx.fillStyle = `rgb(${winCol})`; roundRect(wx, wy, mw, mh, 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  function drawBuilding(b, nf) {
    const px = b.x * TILE - cam.x, py = b.y * TILE - cam.y, w = b.w * TILE, h = b.h * TILE;
    ctx.fillStyle = "rgba(40,28,16,0.18)"; ctx.fillRect(px + 4, py + h - 4, w, 8);
    if (b.style === "house") {
      ctx.fillStyle = b.wall; ctx.fillRect(px, py + h * 0.42, w, h * 0.58);
      ctx.fillStyle = b.color; ctx.fillRect(px - 3, py, w + 6, h * 0.42 + 4);
      ctx.fillStyle = "rgba(0,0,0,0.10)"; ctx.fillRect(px - 3, py + h * 0.42, w + 6, 4);
      drawWindows(px + 4, py + h * 0.42 + 6, w - 8, h * 0.58 - 10, Math.max(1, b.w - 1), 1, nf);
    } else {
      ctx.fillStyle = b.wall; ctx.fillRect(px, py + 8, w, h - 8);
      ctx.fillStyle = b.color; ctx.fillRect(px - 2, py, w + 4, 10);
      drawWindows(px + 4, py + 14, w - 8, h - 20, Math.max(1, b.w - 1), b.style === "tower" ? b.h - 1 : 2, nf);
    }
    const dx = b.door.tx * TILE - cam.x, dy = b.door.ty * TILE - cam.y;
    ctx.fillStyle = "#4a2f1c"; ctx.fillRect(dx + 6, dy + 6, TILE - 12, TILE - 6);
    ctx.fillStyle = "#f2c14e"; ctx.fillRect(dx + TILE - 12, dy + TILE / 2, 3, 3);
    if (!b.deco) drawSign(px + w / 2, py - 14, b.name);
  }
  function drawPlot(b) {
    const px = b.x * TILE - cam.x, py = b.y * TILE - cam.y, w = b.w * TILE, h = b.h * TILE;
    ctx.fillStyle = "rgba(120,90,50,0.12)"; ctx.fillRect(px, py, w, h);
    ctx.strokeStyle = "#b08a5a"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(px + 3, py + 3, w - 6, h - 6); ctx.setLineDash([]);
    const dx = b.door.tx * TILE - cam.x, dy = b.door.ty * TILE - cam.y;
    ctx.fillStyle = "#8a6a47"; ctx.fillRect(dx + TILE / 2 - 2, dy - 6, 4, 22);
    drawSign(px + w / 2, py + h * 0.4, "空き地");
  }
  function drawTree(px, py) {
    ctx.fillStyle = "rgba(40,28,16,0.16)"; ctx.beginPath(); ctx.ellipse(px + TILE / 2, py + TILE - 3, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7a4a28"; ctx.fillRect(px + TILE / 2 - 3, py + TILE - 14, 6, 12);
    ctx.fillStyle = "#4f9e3f"; ctx.beginPath(); ctx.arc(px + TILE / 2, py + 11, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#5fb24c"; ctx.beginPath(); ctx.arc(px + TILE / 2 - 4, py + 8, 8, 0, Math.PI * 2); ctx.fill();
  }
  function drawLight(L, nf) {
    const px = L.x - cam.x, py = L.y - cam.y;
    if (nf > 0.05) {
      const g = ctx.createRadialGradient(px, py - 26, 2, px, py - 26, 48);
      g.addColorStop(0, `rgba(255,225,140,${(0.5 * nf).toFixed(3)})`); g.addColorStop(1, "rgba(255,225,140,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py - 26, 48, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#555a60"; ctx.fillRect(px - 2, py - 30, 4, 30);
    ctx.fillStyle = nf > 0.05 ? "#ffe48c" : "#cdd2d8"; roundRect(px - 6, py - 36, 12, 8, 3); ctx.fill();
  }
  function drawProp(p, nf) {
    const px = p.tx * TILE - cam.x, py = p.ty * TILE - cam.y;
    if (p.type === "fountain") {
      ctx.fillStyle = "#b9b1a0"; roundRect(px - 14, py - 14, TILE + 28, TILE + 28, 10); ctx.fill();
      ctx.fillStyle = "#6fa8d8"; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2 - 2, 4, 0, Math.PI * 2); ctx.fill();
    } else if (p.type === "noticeboard") {
      ctx.fillStyle = "#7a5a3a"; ctx.fillRect(px + 6, py + 10, 4, 20); ctx.fillRect(px + TILE - 10, py + 10, 4, 20);
      ctx.fillStyle = "#caa05a"; roundRect(px - 2, py - 6, TILE + 4, 20, 4); ctx.fill();
      ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff6e6"; ctx.fillRect(px + 4, py - 2, TILE - 8, 11);
    }
  }
  function drawEventDecor(nf) {
    const a = scene.eventArea; if (!a) return;
    const pts = [[a.x0, a.y0], [a.x1, a.y0], [a.x0, a.y1], [a.x1, a.y1], [(a.x0 + a.x1) >> 1, a.y0]];
    for (const [tx, ty] of pts) {
      const px = (tx + 0.5) * TILE - cam.x, py = (ty + 0.5) * TILE - cam.y;
      ctx.fillStyle = "#7a5a3a"; ctx.fillRect(px - 2, py - 30, 4, 30);
      if (nf > 0.05) { ctx.fillStyle = `rgba(255,150,90,${(0.45 * nf).toFixed(3)})`; ctx.beginPath(); ctx.arc(px, py - 34, 16, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#e85b4b"; ctx.beginPath(); ctx.arc(px, py - 34, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd24b"; ctx.fillRect(px - 2, py - 40, 4, 4);
    }
  }
  function drawVehicle(type, px, py, color) {
    if (type === "car") {
      ctx.fillStyle = "rgba(40,28,16,0.22)"; ctx.beginPath(); ctx.ellipse(px, py + 10, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2f2f33"; ctx.fillRect(px - 14, py + 6, 5, 5); ctx.fillRect(px + 9, py + 6, 5, 5); ctx.fillRect(px - 14, py - 9, 5, 5); ctx.fillRect(px + 9, py - 9, 5, 5);
      ctx.fillStyle = color; roundRect(px - 13, py - 8, 26, 18, 6); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.75)"; roundRect(px - 9, py - 5, 18, 6, 2); ctx.fill();
    } else if (type === "scooter") {
      ctx.strokeStyle = "#2f2f33"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px - 9, py + 8, 5, 0, Math.PI * 2); ctx.moveTo(px + 14, py + 8); ctx.arc(px + 9, py + 8, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = color; roundRect(px - 6, py - 4, 14, 10, 4); ctx.fill();
      ctx.strokeStyle = "#444"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px - 6, py + 2); ctx.lineTo(px - 11, py - 6); ctx.stroke();
    } else {
      ctx.strokeStyle = "#2f2f33"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px - 8, py + 8, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px + 8, py + 8, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(px - 8, py + 8); ctx.lineTo(px + 2, py + 8); ctx.lineTo(px - 2, py + 1); ctx.lineTo(px - 8, py + 8);
      ctx.moveTo(px + 2, py + 8); ctx.lineTo(px + 8, py + 8); ctx.moveTo(px - 2, py + 1); ctx.lineTo(px + 5, py + 1); ctx.stroke();
    }
  }
  function drawFurniture(f) {
    const px = f.tx * TILE - cam.x, py = f.ty * TILE - cam.y, w = f.tw * TILE, h = f.th * TILE;
    ctx.fillStyle = f.color; roundRect(px + 3, py + 3, w - 6, h - 6, 5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(px + 5, py + 5, w - 10, 4);
  }
  function drawItem(it) {
    const px = it.tx * TILE - cam.x, py = it.ty * TILE - cam.y;
    ctx.fillStyle = it.color || "#caa05a"; roundRect(px + 5, py + 6, TILE - 10, TILE - 10, 5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(px + 11, py + 12, 2, 0, Math.PI * 2); ctx.fill();
  }
  function drawCharacter(c, yoff) {
    const px = c.x - cam.x, py = c.y - cam.y + (yoff || 0);
    ctx.fillStyle = "rgba(40,28,16,0.22)"; ctx.beginPath(); ctx.ellipse(px, py + 12, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.color; roundRect(px - 9, py - 6, 18, 20, 6); ctx.fill();
    ctx.fillStyle = "#ffe0bd"; ctx.beginPath(); ctx.arc(px, py - 12, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.isPlayer ? "#7a4a28" : "#3c3030"; ctx.beginPath(); ctx.arc(px, py - 14, 8, Math.PI, Math.PI * 2); ctx.fill();
    const dir = c.dir || "down";
    if (dir !== "up") { ctx.fillStyle = "#4a3326"; const ox = dir === "left" ? -3 : dir === "right" ? 3 : 0; ctx.fillRect(px - 3 + ox, py - 13, 2, 2); ctx.fillRect(px + 1 + ox, py - 13, 2, 2); }
    ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    const nw = ctx.measureText(c.name).width + 8;
    ctx.fillStyle = "rgba(255,246,230,0.92)"; roundRect(px - nw / 2, py - 36, nw, 14, 5); ctx.fill();
    ctx.fillStyle = "#6b4a2b"; ctx.fillText(c.name, px, py - 26); ctx.textAlign = "left";
  }
  function drawBar(x, y, w, h, frac, color, label) {
    ctx.fillStyle = "#e7d3ad"; roundRect(x, y, w, h, h / 2); ctx.fill();
    if (frac > 0) { ctx.fillStyle = color; roundRect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2); ctx.fill(); }
    ctx.fillStyle = "#6b4a2b"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left"; ctx.fillText(label, x, y - 3);
    ctx.textAlign = "right"; ctx.fillText(Math.ceil(frac * 100) + "", x + w, y - 3); ctx.textAlign = "left";
  }
  function drawBattle() {
    const b = state.battle; if (!b) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "rgba(20,14,8,0.55)"; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(440, W - 32), px = (W - pw) / 2, ph = 250, py = H / 2 - ph / 2;
    ctx.fillStyle = "#fff6e6"; ctx.strokeStyle = "#6b4a2b"; ctx.lineWidth = 3; roundRect(px, py, pw, ph, 14); ctx.fill(); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillStyle = "#6b4a2b"; ctx.font = "bold 18px sans-serif";
    ctx.fillText("⚔️ バトル！" + (b.combo > 1 ? `  ${b.combo} COMBO` : ""), px + pw / 2, py + 26);
    const ex = px + pw / 2, ey = py + 62;                          // 相手
    ctx.fillStyle = "#8a5fae"; roundRect(ex - 16, ey - 12, 32, 28, 8); ctx.fill();
    ctx.fillStyle = "#ffe0bd"; ctx.beginPath(); ctx.arc(ex, ey - 16, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3c3030"; ctx.beginPath(); ctx.arc(ex, ey - 18, 11, Math.PI, Math.PI * 2); ctx.fill();
    drawBar(px + 40, py + 92, pw - 80, 14, b.enemyHP / b.enemyMax, "#e85b4b", "あいて");
    drawBar(px + 40, py + 120, pw - 80, 14, b.playerHP / b.playerMax, "#5fae4a", "あなた");
    const gx = px + 40, gy = py + 168, gw = pw - 80, gh = 22;       // タイミングゲージ
    ctx.fillStyle = "#e7d3ad"; roundRect(gx, gy, gw, gh, 8); ctx.fill();
    ctx.fillStyle = "rgba(143,208,111,0.65)"; ctx.fillRect(gx + (b.zoneC - b.zoneW) * gw, gy, b.zoneW * 2 * gw, gh);
    ctx.fillStyle = "rgba(255,210,75,0.95)"; ctx.fillRect(gx + (b.zoneC - b.perfW) * gw, gy, b.perfW * 2 * gw, gh);
    const mx = gx + b.pos * gw; ctx.fillStyle = "#3a3a44"; ctx.fillRect(mx - 2, gy - 5, 4, gh + 10);
    ctx.fillStyle = "#8a6a47"; ctx.font = "bold 13px sans-serif";
    ctx.fillText(b.over ? (b.result ? "🏆 勝利！" : "敗北…") : "スペース / E でこうげき！", px + pw / 2, py + ph - 16);
    for (const f of b.floats) { ctx.globalAlpha = clamp(f.life * 1.5, 0, 1); ctx.fillStyle = f.col; ctx.font = "bold 19px sans-serif"; ctx.fillText(f.text, px + pw * f.x, gy - 14 - f.y); ctx.globalAlpha = 1; }
    ctx.textAlign = "left";
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ============================================================
  //  メインループ・初期化
  // ============================================================
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  window.addEventListener("resize", resize);
  let last = performance.now();
  function loop(now) { let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05; update(dt); render(); requestAnimationFrame(loop); }

  // --- 起動 ---
  buildInteriors();
  const hadSave = loadState();
  if (state.worldSeed == null) state.worldSeed = Math.floor(Math.random() * 1e9);
  SCENES.town = buildTown(state.worldSeed);
  applyVehicleSave();
  if (!hadSave || !state.player || (state.player.x === 0 && state.player.y === 0)) { state.player = { x: SCENES.town.spawn.x, y: SCENES.town.spawn.y, dir: "down" }; state.scene = "town"; }
  if (state.homeLevel > 1) SCENES.home = buildHomeInterior(state.homeLevel);
  scene = SCENES[state.scene] || SCENES.town;
  if (scene.id === "home" && !state.homeBuilt) { scene = SCENES.town; state.scene = "town"; }
  if (scene.kind === "town" && !canStand(state.player.x, state.player.y, PLAYER_HALF)) {  // 海/障害物の上に居たら自宅前へ
    state.player.x = SCENES.town.spawn.x; state.player.y = SCENES.town.spawn.y;
  }
  state.inBattle = false; state.battle = null;
  setSpeed(state.speed); resize();
  state.lastTotalDays = null; checkCalendar(); updateHUD();
  if (!hadSave) showHelp();
  requestAnimationFrame(loop);
})();
