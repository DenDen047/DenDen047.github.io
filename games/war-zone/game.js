/* WARZONE 2D ― 戦場
 * 見下ろし型(トップダウン)の2D戦争シューター + ライトRPG。
 * ソロ戦(CPU)と、PeerJS による P2P オンライン対戦(ホスト権威)に対応。
 * ゲーム状態はフレーム毎に破壊的更新する(ゲームループの定石)。CLAUDE.md の不変則は
 * UI/データ層の話で、ここではパフォーマンス優先のミュータブル更新を採用する。
 */
(function () {
  "use strict";

  // ============================================================
  //  定数
  // ============================================================
  const WORLD_W = 2600, WORLD_H = 1800;
  const TEAM_COUNT = 4;           // 4軍による多国籍戦
  const TEAM_SIZE = 4;            // 1チームあたりの人数
  const BASE_MAX_HP = 2400;
  const BASE_CORE_R = 72;
  const WIN_REWARD = 300;
  const RESPAWN_MS = 3200;
  const SOLDIER_R = 14;
  const DOG_R = 11;
  const DOG_RESPAWN_MS = 7000;
  const TANK_R = 34;
  const TANK_RESPAWN_MS = 9000;
  // 固定式の重機関銃座。中立で、先に取り付いた者が使える。
  const TURRET_R = 22;
  const TURRET_RESPAWN_MS = 20000;
  const TURRET_MOUNT_R = 62;
  const TURRET_DAMAGE_TAKEN = 0.5;   // 防盾のぶん射手の被弾を軽減
  const TURRET_GUN = { interval: 95, dmg: 21, speed: 1500, range: 900, spread: 0.03 };
  const GRENADE_FUSE_MS = 1500;
  const GRENADE_RADIUS = 145;
  const MINE_ARM_MS = 1100;       // 設置してから作動するまで(自爆防止)
  const MINE_TRIGGER_R = 30;      // 踏んだ判定の半径
  const MINE_BLAST_R = 140;
  const MINE_DAMAGE = 155;
  const MINE_SPOT_R = 95;         // 敵がこの距離まで近づくと見える
  const MINE_PLACE_COOLDOWN = 600;
  const WIRE_R = 52;              // 有刺鉄線の効果半径
  const WIRE_DPS = 14;            // 中にいる敵への毎秒ダメージ
  const WIRE_SLOW = 0.42;         // 中にいる敵の移動速度倍率
  const WIRE_PLACE_COOLDOWN = 900;
  const AUTO_HEAL_DELAY_MS = 5000;
  const AUTO_HEAL_PER_SEC = 5;
  const MEDKIT_HEAL = 45;
  const BASE_HEAL_PER_SEC = 12;
  const BASE_REPAIR_PER_SEC = 7;
  const PLAYER_VISION_R = 350;
  const TANK_VISION_R = 465;
  const DAY_LENGTH_MS = 150000;   // 1日 = 2分30秒
  const NIGHT_VISION_MUL = 0.55;  // 真夜中の視界倍率
  const DAY_VISION_MUL = 1.15;    // 真昼の視界倍率
  const MAX_BULLETS = 600;
  const MAX_PARTICLES = 800;
  const SNAP_HZ = 20;             // ホストの状態送信レート
  const INPUT_HZ = 30;            // クライアントの入力送信レート
  const MATCH_COUNTDOWN_SECONDS = 3;

  // 4軍の見た目と既定名。配列の添字がそのままチーム番号。
  const TEAM_DEFS = [
    {
      key: "blue", name: "ブルー・フェニックス軍", short: "ブルー軍",
      uniform: "#2f5fa6", accent: "#7fb0ff", flag: "#4ea3ff", text: "#bfe4ff",
      baseFill: "rgba(55,115,155,0.22)", baseStroke: "rgba(105,190,235,0.62)",
      coreDark: "#385b64", coreLight: "#527c82",
      dogHarness: "#4f9ed7", dogFur: "#554536", dogBar: "#55c879",
      tankBody: "#365c66", tankLight: "#588a91", tankBar: "#65c2d0",
    },
    {
      key: "red", name: "レッド・コブラ軍", short: "レッド軍",
      uniform: "#9e3528", accent: "#ff8a6a", flag: "#ff5a4e", text: "#ffd0c8",
      baseFill: "rgba(150,65,48,0.22)", baseStroke: "rgba(245,110,82,0.62)",
      coreDark: "#70423a", coreLight: "#925648",
      dogHarness: "#d85445", dogFur: "#49362f", dogBar: "#ee6a55",
      tankBody: "#713e35", tankLight: "#9a5b48", tankBar: "#ef745e",
    },
    {
      key: "green", name: "グリーン・ジャッカル軍", short: "グリーン軍",
      uniform: "#2f7a45", accent: "#7fe6a4", flag: "#46d36a", text: "#c8ffdb",
      baseFill: "rgba(48,125,72,0.22)", baseStroke: "rgba(96,225,140,0.62)",
      coreDark: "#2f5c40", coreLight: "#417f57",
      dogHarness: "#48b96e", dogFur: "#3d4a33", dogBar: "#5fd189",
      tankBody: "#32603f", tankLight: "#4f8a5d", tankBar: "#62d08a",
    },
    {
      key: "violet", name: "バイオレット・ライノ軍", short: "バイオレット軍",
      uniform: "#6a3f9e", accent: "#c79cff", flag: "#a76bff", text: "#e6d5ff",
      baseFill: "rgba(103,63,158,0.22)", baseStroke: "rgba(183,138,255,0.62)",
      coreDark: "#4a3568", coreLight: "#6a4d90",
      dogHarness: "#9a6ce0", dogFur: "#453a4d", dogBar: "#b78cf0",
      tankBody: "#553a76", tankLight: "#7a5aa0", tankBar: "#b48cef",
    },
  ];
  // 自分だけは金色でハイライトする(チーム色とは別枠)。
  const YOU_UNIFORM = "#7a6420", YOU_ACCENT = "#ffd23f";

  const TEAMS = TEAM_DEFS.map((_, i) => i);
  const teamDef = (team) => TEAM_DEFS[team] || TEAM_DEFS[0];

  const BOT_NAMES = [
    "Cobra", "Viper", "Ghost", "Hawk", "Raptor", "Bishop", "Reaper", "Onyx",
    "Falcon", "Wolf", "Striker", "Ranger", "Nomad", "Echo", "Zero", "Blaze",
    "Saber", "Frost", "Joker", "Maverick", "Titan", "Specter", "Diesel", "Kilo",
  ];

  const SHOP_ITEMS = [
    { key: "health", icon: "❤", name: "強化体力", desc: "最大HP +10", max: 5, baseCost: 120, step: 80 },
    { key: "armor", icon: "🦺", name: "強化装甲", desc: "鎧耐久 +15", max: 5, baseCost: 120, step: 85 },
    { key: "shield", icon: "🛡", name: "強化シールド", desc: "盾耐久 +20", max: 5, baseCost: 130, step: 90 },
    { key: "damage", icon: "🎯", name: "武器改修", desc: "武器ダメージ +5%", max: 5, baseCost: 180, step: 110 },
    { key: "grenade", icon: "💣", name: "弾薬ポーチ", desc: "グレネード所持数 +1", max: 3, baseCost: 220, step: 160 },
    { key: "mine", icon: "🧨", name: "地雷ポーチ", desc: "地雷の所持数 +1", max: 3, baseCost: 240, step: 170 },
  ];

  const WEAPONS = [
    { key: "pistol",  name: "ハンドガン",       dmg: 22, interval: 230, mag: 12, reload: 900,  spread: 0.045, pellets: 1, auto: false, speed: 1000, range: 560,  len: 13, kick: 2.2, snd: "pistol" },
    { key: "smg",     name: "サブマシンガン",   dmg: 13, interval: 72,  mag: 30, reload: 1450, spread: 0.105, pellets: 1, auto: true,  speed: 1050, range: 520,  len: 12, kick: 1.4, snd: "smg" },
    { key: "rifle",   name: "アサルトライフル", dmg: 26, interval: 128, mag: 30, reload: 1650, spread: 0.05,  pellets: 1, auto: true,  speed: 1320, range: 780,  len: 18, kick: 2.0, snd: "rifle" },
    { key: "shotgun", name: "ショットガン",     dmg: 11, interval: 680, mag: 6,  reload: 2150, spread: 0.34,  pellets: 8, auto: false, speed: 940,  range: 360,  len: 16, kick: 5.5, snd: "shotgun" },
    { key: "sniper",  name: "スナイパー",       dmg: 96, interval: 1120, mag: 5, reload: 2350, spread: 0.006, pellets: 1, auto: false, speed: 2200, range: 1250, len: 26, kick: 6.0, pierce: 2, snd: "sniper" },
    // ここから近接武器。arc = 攻撃が届く左右の角度、style = 見た目。
    { key: "knife",   name: "コンバットナイフ", dmg: 58, interval: 430, mag: 1, reload: 0, spread: 0, pellets: 1, auto: false, speed: 0, range: 68, len: 15, kick: 3.0, melee: true, arc: 0.82, style: "knife",   snd: "melee" },
    { key: "bayonet", name: "銃剣",             dmg: 42, interval: 290, mag: 1, reload: 0, spread: 0, pellets: 1, auto: true,  speed: 0, range: 96, len: 24, kick: 2.2, melee: true, arc: 0.48, style: "bayonet", snd: "melee" },
    { key: "hatchet", name: "戦斧",             dmg: 80, interval: 660, mag: 1, reload: 0, spread: 0, pellets: 1, auto: false, speed: 0, range: 64, len: 17, kick: 4.4, melee: true, arc: 1.05, style: "hatchet", snd: "melee" },
    { key: "shovel",  name: "軍用シャベル",     dmg: 98, interval: 900, mag: 1, reload: 0, spread: 0, pellets: 1, auto: false, speed: 0, range: 80, len: 19, kick: 5.6, melee: true, arc: 1.35, style: "shovel",  snd: "melee" },
    { key: "katana",  name: "打刀",             dmg: 86, interval: 470, mag: 1, reload: 0, spread: 0, pellets: 1, auto: false, speed: 0, range: 106, len: 30, kick: 3.8, melee: true, arc: 1.2, style: "katana", snd: "melee" },
    // ロケットランチャー: 弾速が遅く避けられるが、着弾すると戦車・基地に大ダメージ
    { key: "rocket",  name: "ロケットランチャー", dmg: 130, interval: 1800, mag: 1, reload: 2600, spread: 0.02, pellets: 1, auto: false, speed: 640, range: 920, len: 34, kick: 7.0, rocket: true, snd: "sniper" },
    // 時の剣: 「時の森」の岩から抜いた者だけが持てる。拾えず、買えず、失われない。
    { key: "timesword", name: "時の剣", dmg: 132, interval: 520, mag: 1, reload: 0, spread: 0, pellets: 1, auto: false, speed: 0, range: 132, len: 34, kick: 4.2, melee: true, arc: 1.5, style: "timesword", snd: "melee" },
  ];
  const WKEY = {}; WEAPONS.forEach((w, i) => (WKEY[w.key] = i));

  // ============================================================
  //  キャラクター(兵科)
  //  倍率はすべて基準値に対する掛け算。1 = 標準。
  // ============================================================
  const CLASSES = [
    {
      key: "soldier", name: "兵士", icon: "🎖️",
      desc: "アサルトライフル・ハンドガン・銃剣。撃ち合いに強い標準型。",
      hpBonus: 0, speedMul: 1, gunMul: 1, meleeMul: 1,
      grenades: 3, mines: 2, wires: 0,
      parryWindowMul: 1, parryCooldownMul: 1,
      mineArmMul: 1, mineBlastMul: 1, mineStealthMul: 1, seesEnemyMines: false,
      weapons: ["rifle", "pistol", "bayonet"],
    },
    {
      key: "samurai", name: "侍", icon: "⚔️",
      desc: "打刀・戦斧・ナイフの近接専用。銃は持てないが体力と足が速い。打刀は足を止めて斬ると全方位攻撃になり、振っている間は銃弾を弾き返す。",
      hpBonus: 30, speedMul: 1.18, gunMul: 0.72, meleeMul: 1.12,
      grenades: 2, mines: 1, wires: 0,
      parryWindowMul: 1.7, parryCooldownMul: 0.6,
      mineArmMul: 1, mineBlastMul: 1, mineStealthMul: 1, seesEnemyMines: false,
      weapons: ["katana", "hatchet", "knife"],
    },
    {
      key: "trapper", name: "罠師", icon: "🪤",
      desc: "サブマシンガン・ショットガン・シャベル。地雷5個は敵から見えにくく、有刺鉄線(Cキー)も張れる。体力は低め。",
      hpBonus: -12, speedMul: 0.97, gunMul: 0.92, meleeMul: 0.9,
      grenades: 2, mines: 5, wires: 3,
      parryWindowMul: 1, parryCooldownMul: 1,
      mineArmMul: 0.55, mineBlastMul: 1.25, mineStealthMul: 0.5, seesEnemyMines: true,
      weapons: ["smg", "shotgun", "shovel"],
    },
    {
      key: "heavy", name: "重火器兵", icon: "🚀",
      desc: "ロケットランチャー・スナイパー・ハンドガン。戦車と基地に滅法強いが、足が遅く接近戦は苦手。",
      hpBonus: 10, speedMul: 0.86, gunMul: 1, meleeMul: 0.7,
      grenades: 3, mines: 1, wires: 0,
      parryWindowMul: 0.8, parryCooldownMul: 1.2,
      mineArmMul: 1, mineBlastMul: 1, mineStealthMul: 1, seesEnemyMines: false,
      weapons: ["rocket", "sniper", "pistol"],
    },
  ];
  const CLASS_BY_KEY = {};
  CLASSES.forEach((c) => (CLASS_BY_KEY[c.key] = c));
  const classDef = (key) => CLASS_BY_KEY[key] || CLASSES[0];

  // ============================================================
  //  スキン (自分の見た目だけを変える。性能はいっさい変わらない)
  //  style を持つものは、色に加えて専用の描き込みが乗る。
  // ============================================================
  const SKINS = [
    { key: "standard", name: "標準装備", icon: "🎖",
      desc: "見慣れた金色のマーキング。",
      uniform: YOU_UNIFORM, accent: YOU_ACCENT },
    { key: "woodland", name: "森林迷彩", icon: "🌿",
      desc: "深緑の斑を散らしたウッドランド迷彩。草むらになじむ。",
      uniform: "#3e4d2a", accent: "#7e9b4a", style: "camo" },
    { key: "desert", name: "砂漠迷彩", icon: "🏜",
      desc: "砂色の斑を散らしたデザート迷彩。乾いた戦場向け。",
      uniform: "#8a7647", accent: "#d8c48a", style: "camo" },
    { key: "crimson", name: "紅蓮", icon: "🔥",
      desc: "尖った胸甲と肩当てを付けた深紅の重装。",
      uniform: "#3a1414", accent: "#c8392c", style: "plated" },
    { key: "hologram", name: "ホログラム兵", icon: "👻",
      desc: "実体を持たない投影体。六角形のワイヤーフレームで、脚の代わりに光の裾が広がる。",
      uniform: "#1c5f7a", accent: "#8fe9ff", style: "hologram", alpha: 0.62, glow: "#7fe6ff" },
    { key: "neon", name: "ネオングリッド", icon: "🌃",
      desc: "角ばった装甲の輪郭とコアだけが発光する、サイバー仕様の体。",
      uniform: "#16162a", accent: "#ff4fd8", style: "neon", glow: "#ff4fd8" },
    { key: "chrome", name: "クロムメック", icon: "🤖",
      desc: "箱型シャーシに肩アーマーを載せた重機械。頭のバイザーが一文字に光る。",
      uniform: "#8d949c", accent: "#e4ecf4", style: "mech", glow: "#bfe8ff" },
    { key: "voxel", name: "ボクセル", icon: "🟪",
      desc: "電脳空間から来たブロック体。胴も頭も脚も四角い塊でできている。",
      uniform: "#3b2a63", accent: "#a98bff", style: "voxel" },
  ];
  const SKIN_BY_KEY = {};
  SKINS.forEach((s) => (SKIN_BY_KEY[s.key] = s));
  const activeSkin = () => SKIN_BY_KEY[playerSkin] || SKINS[0];

  // ============================================================
  //  ステージ
  // ============================================================
  // fixedLight: 明るさを固定するステージだけが持つ (null = 昼夜サイクルどおり)。
  // phase: HUD の時間帯表示を固定するステージだけが持つ。
  // monochrome: 地形・障害物・的を白と灰色だけで描くステージ。
  const STAGES = [
    {
      key: "training", name: "練習場", icon: "🎯",
      desc: "はじめての人はここから。撃ち返してこない的を相手に、操作を1つずつ順番に練習できる。",
      bgm: "bgm-battle", creature: false, training: true, fixedLight: 1,
      phase: { key: "noon", label: "🎯 練習場", note: "敵は撃ってこない" },
      monochrome: true, backdrop: "#6f6f6f",
      ground: ["#b8b8b8", "#c2c2c2", "#adadad"],
    },
    {
      key: "field", name: "標準戦場", icon: "🏙",
      desc: "建物と瓦礫が点在する見通しの良い戦場。時間帯が朝から夜へ移り変わる。",
      bgm: "bgm-battle", creature: false, training: false, fixedLight: null,
      ground: ["#3c4d28", "#41522b", "#374524"],
    },
    {
      key: "timeforest", name: "時の森", icon: "⌛",
      desc: "薄明かりの森。中央の岩に刺さった剣を5秒かけて抜くと、その剣の持ち主に近づいた銃弾は時が止まったように遅くなる。",
      bgm: "bgm-darkforest", creature: false, training: false, fixedLight: 0.56,
      phase: { key: "dusk", label: "⌛ 時の森", note: "中央の岩に剣がある" },
      sword: true,
      ground: ["#2a2f3f", "#303648", "#252a38"],
    },
    {
      key: "darkforest", name: "暗黒の森", icon: "🌲",
      desc: "夜が明けない密林。見通しは最悪で、何かが棲んでいる。走ると気づかれる。",
      bgm: "bgm-darkforest", creature: true, training: false, fixedLight: 0.1,
      phase: { key: "night", label: "🌲 暗黒の森", note: "何かが見ている" },
      ground: ["#1b2416", "#1f291a", "#161e12"],
    },
  ];
  const STAGE_BY_KEY = {};
  STAGES.forEach((s) => (STAGE_BY_KEY[s.key] = s));
  const stageDef = () => STAGE_BY_KEY[G && G.stage ? G.stage : playerStage] || STAGE_BY_KEY.field;
  const stageIsTraining = (key) => !!(STAGE_BY_KEY[key] && STAGE_BY_KEY[key].training);
  const isTraining = () => !!stageDef().training;
  const isMonochrome = () => !!stageDef().monochrome;
  const hasSword = () => !!stageDef().sword;

  const DIFF = {
    easy:   { aimErr: 0.17, react: 430, fireChance: 0.68, hpMul: 0.85, dmgMul: 0.85, sniperChance: 0.05 },
    normal: { aimErr: 0.09, react: 280, fireChance: 0.85, hpMul: 1.0,  dmgMul: 1.0,  sniperChance: 0.12 },
    hard:   { aimErr: 0.045, react: 170, fireChance: 0.95, hpMul: 1.18, dmgMul: 1.15, sniperChance: 0.2 },
  };

  // ============================================================
  //  ユーティリティ
  // ============================================================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const now = () => performance.now();
  const angLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  // 4隅に1つずつ。heading はマップ中央を向く方向。
  const BASE_SPOTS = [
    { x: 220, y: WORLD_H - 220, heading: -Math.PI / 4 },        // 左下
    { x: WORLD_W - 220, y: 220, heading: Math.PI * 3 / 4 },     // 右上
    { x: 220, y: 220, heading: Math.PI / 4 },                   // 左上
    { x: WORLD_W - 220, y: WORLD_H - 220, heading: -Math.PI * 3 / 4 }, // 右下
  ];

  // hidden = 存在しない扱いの基地。練習場では自分の基地だけを置く。
  // ステージは引数で受け取る (emptyState から呼ばれる時点では G がまだ前の試合のもの)。
  function makeBases(training) {
    return TEAMS.map((team) => ({
      kind: "base", team,
      hidden: !!training && team !== playerTeam,
      x: BASE_SPOTS[team].x, y: BASE_SPOTS[team].y, r: 185, heading: BASE_SPOTS[team].heading,
      hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, hitFlash: 0,
    }));
  }

  // 基地が健在な軍だけが復活でき、勝利できる。
  function teamAlive(team) {
    const base = G.bases[team];
    return !!base && base.hp > 0;
  }

  // 敵チーム(= 自分以外)の、まだ健在な基地のうち一番近いもの。
  function nearestEnemyBase(x, y, team) {
    let best = null, bestD = Infinity;
    for (const base of G.bases) {
      if (base.team === team || base.hp <= 0 || base.hidden) continue;
      const d = dist2(x, y, base.x, base.y);
      if (d < bestD) { bestD = d; best = base; }
    }
    return best;
  }

  // ============================================================
  //  DOM
  // ============================================================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mini = document.getElementById("minimap");
  const mctx = mini.getContext("2d");
  const el = {
    teamBoard: document.getElementById("team-board"),
    scoreGoal: document.getElementById("score-goal"),
    daytime: document.getElementById("daytime"),
    hpFill: document.getElementById("hp-fill"),
    hpText: document.getElementById("hp-text"),
    recovery: document.getElementById("recovery-text"),
    lvText: document.getElementById("lv-text"),
    xpFill: document.getElementById("xp-fill"),
    wName: document.getElementById("weapon-name"),
    ammo: document.getElementById("ammo-text"),
    grenade: document.getElementById("grenade-text"),
    armorFill: document.getElementById("armor-fill"),
    armorText: document.getElementById("armor-text"),
    shieldFill: document.getElementById("shield-fill"),
    shieldText: document.getElementById("shield-text"),
    shieldState: document.getElementById("shield-state"),
    vehicleHint: document.getElementById("vehicle-hint"),
    trainingPanel: document.getElementById("training-panel"),
    tpProgress: document.getElementById("tp-progress"),
    tpSteps: document.getElementById("tp-steps"),
    tpSkip: document.getElementById("tp-skip"),
    medals: document.getElementById("medals"),
    medalGrid: document.getElementById("medal-grid"),
    medalCount: document.getElementById("medal-count"),
    medalTotal: document.getElementById("medal-total"),
    medalToast: document.getElementById("medal-toast"),
    killfeed: document.getElementById("killfeed"),
    levelup: document.getElementById("levelup"),
    menu: document.getElementById("menu"),
    menuMain: document.getElementById("menu-main"),
    menuOnline: document.getElementById("menu-online"),
    menuHint: document.getElementById("menu-hint"),
    pause: document.getElementById("pause"),
    eliminated: document.getElementById("eliminated"),
    eliminatedDetail: document.getElementById("eliminated-detail"),
    help: document.getElementById("help"),
    result: document.getElementById("result"),
    resultTitle: document.getElementById("result-title"),
    resultStats: document.getElementById("result-stats"),
    rewardSummary: document.getElementById("reward-summary"),
    shopItems: document.getElementById("shop-items"),
    shopMoney: document.getElementById("shop-money"),
    shopMessage: document.getElementById("shop-message"),
    menuMoney: document.getElementById("menu-money"),
    nameInput: document.getElementById("name-input"),
    armyInput: document.getElementById("army-input"),
    netStatus: document.getElementById("net-status"),
    joinCode: document.getElementById("join-code"),
    onlineActions: document.getElementById("online-actions"),
    roomLobby: document.getElementById("room-lobby"),
    roomCode: document.getElementById("room-code"),
    lobbyStatus: document.getElementById("lobby-status"),
    lobbyRoster: document.getElementById("lobby-roster"),
    lobbyStart: document.getElementById("btn-lobby-start"),
    teamSeg: document.getElementById("team-seg"),
    classSeg: document.getElementById("class-seg"),
    skinSeg: document.getElementById("skin-seg"),
    stageSeg: document.getElementById("stage-seg"),
    touch: document.getElementById("touch"),
    btnMute: document.getElementById("btn-mute"),
  };

  // ============================================================
  //  オーディオ (WebAudio)
  // ============================================================
  const Audio = (() => {
    let actx = null, muted = false, master = null;
    function ensure() {
      if (actx) return;
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        master = actx.createGain();
        master.gain.value = 0.5;
        master.connect(actx.destination);
      } catch (e) { actx = null; }
    }
    function noise(dur) {
      const n = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, n, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      return src;
    }
    function shot(kind) {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const g = actx.createGain();
      g.connect(master);
      const lp = actx.createBiquadFilter();
      lp.type = "lowpass";
      const src = noise(0.16);
      src.connect(lp); lp.connect(g);
      let vol = 0.5, cut = 2200, dur = 0.1;
      if (kind === "pistol") { vol = 0.42; cut = 1800; dur = 0.09; }
      else if (kind === "smg") { vol = 0.3; cut = 2600; dur = 0.06; }
      else if (kind === "rifle") { vol = 0.45; cut = 2400; dur = 0.09; }
      else if (kind === "shotgun") { vol = 0.6; cut = 1400; dur = 0.18; }
      else if (kind === "sniper") { vol = 0.7; cut = 1100; dur = 0.22; }
      lp.frequency.setValueAtTime(cut, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.3), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.start(t); src.stop(t + dur + 0.02);
    }
    function boom() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const g = actx.createGain(); g.connect(master);
      const lp = actx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(80, t + 0.5);
      const src = noise(0.6); src.connect(lp); lp.connect(g);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      src.start(t); src.stop(t + 0.6);
    }
    function hurt() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
    }
    function levelup() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const s = t + i * 0.07;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.22, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
        o.connect(g); g.connect(master); o.start(s); o.stop(s + 0.2);
      });
    }
    function heal() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      [660, 880].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine"; o.frequency.value = f;
        const s = t + i * 0.08;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.16, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
        o.connect(g); g.connect(master); o.start(s); o.stop(s + 0.18);
      });
    }
    function melee() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const src = noise(0.1), hp = actx.createBiquadFilter(), g = actx.createGain();
      hp.type = "highpass"; hp.frequency.value = 700;
      src.connect(hp); hp.connect(g); g.connect(master);
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.start(t); src.stop(t + 0.1);
    }
    function footstep(strength) {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(82, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
      g.gain.setValueAtTime(0.08 * clamp(strength, 0.25, 1), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.11);
    }
    function parry() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(720, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.13);
      g.gain.setValueAtTime(0.24, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
    }
    // クリーチャーの唸り声。低い唸りに軋むような倍音を重ねる。
    function roar() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const g = actx.createGain(); g.connect(master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55, t + 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
      const lp = actx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 1.1);
      lp.connect(g);
      // 唸りの基音
      const o = actx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(72, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 1.1);
      o.connect(lp);
      // 軋み
      const o2 = actx.createOscillator();
      o2.type = "square";
      o2.frequency.setValueAtTime(131, t);
      o2.frequency.exponentialRampToValueAtTime(47, t + 0.9);
      const g2 = actx.createGain(); g2.gain.value = 0.22;
      o2.connect(g2); g2.connect(lp);
      // 息づかい
      const src = noise(1.2), hp = actx.createBiquadFilter();
      hp.type = "bandpass"; hp.frequency.value = 420; hp.Q.value = 0.7;
      const g3 = actx.createGain(); g3.gain.value = 0.3;
      src.connect(hp); hp.connect(g3); g3.connect(lp);
      o.start(t); o.stop(t + 1.2);
      o2.start(t); o2.stop(t + 1.0);
      src.start(t); src.stop(t + 1.2);
    }

    // ---- BGM ----
    // 効果音より控えめの音量で流す。OGG が使えるブラウザなら継ぎ目なくループする
    // (MP3 はエンコーダの余白ぶん、ループ点にごく短い間が入る)。
    const BGM_VOLUME = 0.34;
    let bgmBuffer = null, bgmSource = null, bgmGain = null;
    let bgmLoading = false, bgmWanted = false;
    let bgmStartedAt = 0, bgmOffset = 0;

    let bgmTrack = "bgm-battle";
    function bgmUrl() {
      const probe = document.createElement("audio");
      const ext = probe.canPlayType && probe.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
      return `audio/${bgmTrack}.${ext}`;
    }

    function loadBgm() {
      if (bgmBuffer || bgmLoading || !actx) return;
      bgmLoading = true;
      fetch(bgmUrl())
        .then((res) => res.arrayBuffer())
        .then((data) => actx.decodeAudioData(data))
        .then((buf) => {
          bgmBuffer = buf;
          bgmLoading = false;
          if (bgmWanted) playBgm();
        })
        .catch(() => { bgmLoading = false; });   // 音楽が無くてもゲームは続行する
    }

    function playBgm() {
      if (!actx || !bgmBuffer || bgmSource) return;
      bgmGain = actx.createGain();
      bgmGain.gain.value = muted ? 0 : BGM_VOLUME;
      bgmGain.connect(master);
      bgmSource = actx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      bgmSource.connect(bgmGain);
      bgmSource.start(0, bgmOffset % bgmBuffer.duration);
      bgmStartedAt = actx.currentTime;
    }

    // 再生位置を覚えたまま止める。再開時に続きから鳴らすため。
    function haltBgm(keepPosition) {
      if (bgmSource) {
        if (keepPosition && bgmBuffer) {
          bgmOffset = (bgmOffset + (actx.currentTime - bgmStartedAt)) % bgmBuffer.duration;
        }
        try { bgmSource.stop(); } catch (e) {}
        try { bgmSource.disconnect(); } catch (e) {}
      }
      bgmSource = null;
      bgmGain = null;
      if (!keepPosition) bgmOffset = 0;
    }

    return {
      unlock() {
        ensure();
        if (actx && actx.state === "suspended") actx.resume();
        // 曲はステージが決まってから読む(暗黒の森は別の曲)
      },
      shot, boom, hurt, levelup, heal, melee, footstep, parry, roar,
      startBgm(track) {
        if (track && track !== bgmTrack) {
          // ステージが変わったら曲も差し替える
          bgmTrack = track;
          haltBgm(false);
          bgmBuffer = null;
        }
        bgmWanted = true;
        ensure();
        if (actx && actx.state === "suspended") actx.resume();
        if (!bgmBuffer) { loadBgm(); return; }
        playBgm();
      },
      stopBgm() { bgmWanted = false; haltBgm(false); },
      pauseBgm() { if (bgmWanted) haltBgm(true); },
      resumeBgm() { if (bgmWanted) playBgm(); },
      toggle() {
        muted = !muted;
        if (bgmGain) bgmGain.gain.value = muted ? 0 : BGM_VOLUME;
        return muted;
      },
      get muted() { return muted; },
    };
  })();

  // ============================================================
  //  入力
  // ============================================================
  const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add("touch-ui");
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, over: false };
  const stickMove = { x: 0, y: 0, active: false };
  const stickAim = { x: 0, y: 0, active: false };
  let touchShield = false;
  let touchInteract = false;   // 「戦車」ボタンを押しっぱなしにしているか

  window.addEventListener("keydown", (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === "r" || e.key === "R") localInput.reloadEdge = true;
    if (!e.repeat && (e.key === "g" || e.key === "G")) localInput.grenadeEdge = true;
    if (!e.repeat && (e.key === "e" || e.key === "E")) localInput.interactEdge = true;
    if (!e.repeat && (e.key === "f" || e.key === "F")) localInput.mineEdge = true;
    if (!e.repeat && (e.key === "c" || e.key === "C")) localInput.wireEdge = true;
    if (!e.repeat && (e.key === "q" || e.key === "Q")) localInput.parryEdge = true;
    // 数字キーは「所持している武器の何番目か」。全武器の通し番号ではない。
    if (e.key >= "1" && e.key <= "9") {
      const me = localSoldier();
      const slot = parseInt(e.key, 10) - 1;
      if (me && me.loadout && slot < me.loadout.length) localInput.weaponWanted = me.loadout[slot];
    }
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.over = true;
  });
  canvas.addEventListener("mouseleave", () => (mouse.over = false));
  canvas.addEventListener("mousedown", (e) => { if (e.button === 0) { mouse.down = true; Audio.unlock(); } });
  window.addEventListener("mouseup", (e) => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    if (!G || !G.running) return;
    e.preventDefault();
    const next = cycleWeapon(localSoldier(), e.deltaY > 0 ? 1 : -1);
    if (next != null) localInput.weaponWanted = next;
  }, { passive: false });

  // タッチ用スティック
  function bindStick(elm, target) {
    const knob = elm.querySelector(".knob");
    let id = null, cx = 0, cy = 0;
    const R = 52;
    function set(dx, dy) {
      const m = Math.hypot(dx, dy);
      const k = m > R ? R / m : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      target.x = clamp(dx / R, -1, 1);
      target.y = clamp(dy / R, -1, 1);
      target.active = true;
    }
    function reset() {
      knob.style.transform = "translate(0,0)";
      target.x = 0; target.y = 0; target.active = false; id = null;
    }
    elm.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      Audio.unlock();
      id = e.pointerId;
      const r = elm.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      elm.setPointerCapture(id);
      set(e.clientX - cx, e.clientY - cy);
    });
    elm.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      set(e.clientX - cx, e.clientY - cy);
    });
    const up = (e) => { if (e.pointerId === id) reset(); };
    elm.addEventListener("pointerup", up);
    elm.addEventListener("pointercancel", up);
  }
  bindStick(document.getElementById("stick-move"), stickMove);
  bindStick(document.getElementById("stick-aim"), stickAim);
  document.getElementById("t-reload").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.reloadEdge = true; });
  document.getElementById("t-grenade").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.grenadeEdge = true; });
  document.getElementById("t-mine").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.mineEdge = true; });
  const wireBtn = document.getElementById("t-wire");
  wireBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.wireEdge = true; });
  const tankBtn = document.getElementById("t-tank");
  tankBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    localInput.interactEdge = true;
    touchInteract = true;
    try { tankBtn.setPointerCapture(e.pointerId); } catch (err) {}
  });
  const releaseTouchInteract = () => { touchInteract = false; };
  tankBtn.addEventListener("pointerup", releaseTouchInteract);
  tankBtn.addEventListener("pointercancel", releaseTouchInteract);
  const touchShieldBtn = document.getElementById("t-shield");
  touchShieldBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!touchShield) localInput.parryEdge = true;
    touchShield = true; touchShieldBtn.classList.add("active");
    try { touchShieldBtn.setPointerCapture(e.pointerId); } catch (err) {}
  });
  const releaseTouchShield = () => { touchShield = false; touchShieldBtn.classList.remove("active"); };
  touchShieldBtn.addEventListener("pointerup", releaseTouchShield);
  touchShieldBtn.addEventListener("pointercancel", releaseTouchShield);
  document.getElementById("t-swap").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const next = cycleWeapon(localSoldier(), 1);
    if (next != null) localInput.weaponWanted = next;
  });

  // ローカルプレイヤーの入力(SP=自分のsoldierに適用 / client=送信)
  const localInput = {
    mvx: 0, mvy: 0, aimx: 1, aimy: 0, shoot: false, dash: false,
    reloadEdge: false, grenadeEdge: false, interactEdge: false, parryEdge: false, mineEdge: false, wireEdge: false,
    weaponWanted: -1, aimAngle: 0, shield: false,
  };

  function gatherLocalInput() {
    let mvx = 0, mvy = 0;
    if (keys["w"] || keys["arrowup"]) mvy -= 1;
    if (keys["s"] || keys["arrowdown"]) mvy += 1;
    if (keys["a"] || keys["arrowleft"]) mvx -= 1;
    if (keys["d"] || keys["arrowright"]) mvx += 1;
    if (stickMove.active) { mvx = stickMove.x; mvy = stickMove.y; }
    const mm = Math.hypot(mvx, mvy);
    if (mm > 1) { mvx /= mm; mvy /= mm; }
    localInput.mvx = mvx; localInput.mvy = mvy;
    localInput.dash = !!keys["shift"] || (stickMove.active && mm > 0.92);
    localInput.shield = !!keys["q"] || touchShield;
    // 岩から剣を抜くときのように、押し続けているかどうかが要る操作もある
    localInput.interactHold = !!keys["e"] || touchInteract;

    let shoot = false;
    const me = localSoldier();
    if (stickAim.active) {
      const am = Math.hypot(stickAim.x, stickAim.y);
      if (am > 0.25) {
        localInput.aimAngle = assistAim(me, Math.atan2(stickAim.y, stickAim.x));
        shoot = true;
      }
      // デッドゾーン内はスティックを倒し切っていないだけ → 直前の向きを保つ
    } else if (!isTouch && me && mouse.over) {
      const sx = me.x - camX, sy = me.y - camY;
      localInput.aimAngle = Math.atan2(mouse.y - sy, mouse.x - sx);
      shoot = mouse.down;
    } else if (!isTouch && me && mm > 0.05) {
      // PCでマウスが画面外のときのフォールバック: 移動方向を向く
      localInput.aimAngle = Math.atan2(mvy, mvx);
    }
    // タッチ操作では上のどれにも当たらない = 最後に向いた方向をそのまま維持する
    localInput.aimx = Math.cos(localInput.aimAngle);
    localInput.aimy = Math.sin(localInput.aimAngle);
    localInput.shoot = shoot;
  }

  // タッチ操作の照準補助。狙った方向のすぐ近くに敵が居れば少しだけ吸い付く。
  const AIM_ASSIST_CONE = 0.30;   // 約17°以内
  const AIM_ASSIST_PULL = 0.55;   // どれだけ引き寄せるか
  function assistAim(me, angle) {
    if (!isTouch || !me || me.dead) return angle;
    const range = me.vehicleId >= 0 ? 900 : WEAPONS[me.weapon].range;
    let bestAngle = null, bestGap = AIM_ASSIST_CONE;
    const consider = (e, radius) => {
      const d2 = dist2(me.x, me.y, e.x, e.y);
      if (d2 > (range + radius) ** 2) return;
      if (!lineClear(me.x, me.y, e.x, e.y)) return;
      const a = Math.atan2(e.y - me.y, e.x - me.x);
      const gap = angleGap(angle, a);
      if (gap < bestGap) { bestGap = gap; bestAngle = a; }
    };
    for (const e of G.soldiers) {
      if (e.dead || e.vehicleId >= 0 || e.team === me.team) continue;
      consider(e, SOLDIER_R);
    }
    for (const e of G.tanks) {
      if (e.dead || e.team === me.team) continue;
      consider(e, TANK_R);
    }
    return bestAngle == null ? angle : angLerp(angle, bestAngle, AIM_ASSIST_PULL);
  }

  // ============================================================
  //  ゲーム状態
  // ============================================================
  let G = null;
  let camX = 0, camY = 0;
  let shake = 0;
  let mode = "sp";          // 'sp' | 'host' | 'client'
  let difficulty = "normal";
  let playerName = "Soldier";
  let playerTeam = 0;
  let playerClass = "soldier";
  let playerSkin = "standard";
  let playerStage = "field";
  let armyName = TEAM_DEFS[0].name;
  let matchPaused = false;
  // 自軍が全滅したときの「観戦するか、やめるか」の状態
  let eliminationPrompted = false;
  let spectating = false;
  let spectateTargetId = -1;
  let spectateSwitchAt = 0;
  let pauseStartedAt = 0;
  let helpOrigin = "menu";
  let money = 0;
  let shopLevels = Object.fromEntries(SHOP_ITEMS.map((item) => [item.key, 0]));

  function emptyState() {
    return {
      soldiers: [],
      dogs: [],
      beasts: [],
      swordRock: null,
      bullets: [],
      grenades: [],
      mines: [],
      wires: [],
      tanks: [],
      turrets: [],
      particles: [],
      pickups: [],
      obstacles: [],
      bases: makeBases(stageIsTraining(playerStage)),
      score: TEAMS.map(() => 0),
      goal: BASE_MAX_HP,
      running: false,
      over: false,
      localId: 0,
      nextId: 1,
      killfeed: [],
      soundPings: [],
      clock: DAY_START_CLOCK,
      dropAt: 0,
      stage: playerStage,
      creature: null,
      armyNames: TEAM_DEFS.map((def, team) => (team === playerTeam ? armyName : def.name)),
      rewardClaimed: false,
    };
  }

  function localSoldier() {
    if (!G) return null;
    return G.soldiers.find((s) => s.id === G.localId) || null;
  }

  // 自分の所属チーム。まだ兵士が居ない(ロビー等)なら選択中のチーム。
  function localTeam() {
    const me = localSoldier();
    return me ? me.team : playerTeam;
  }

  // ============================================================
  //  昼夜サイクル
  //  clock は経過ミリ秒。0 = 真夜中、DAY_LENGTH_MS/2 = 真昼。
  //  試合は朝(明るくなる途中)から始まる。
  // ============================================================
  const DAY_START_CLOCK = DAY_LENGTH_MS * 0.28;

  // 0 = 真夜中, 1 = 真昼
  function daylight() {
    const fixed = stageDef().fixedLight;
    // 暗黒の森・練習場は時間が進んでも明るさが変わらない
    if (fixed != null) return fixed;
    const p = ((G ? G.clock : DAY_START_CLOCK) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
  }

  // 明るくなっている途中か(= 朝側)
  function daylightRising() {
    const p = ((G ? G.clock : DAY_START_CLOCK) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    return Math.sin(p * Math.PI * 2) > 0;
  }

  // 視界にかかる倍率。夜は狭く、昼は広い。
  function daylightVisionMul() {
    return NIGHT_VISION_MUL + daylight() * (DAY_VISION_MUL - NIGHT_VISION_MUL);
  }

  function dayPhase() {
    const fixed = stageDef().phase;
    if (fixed) return fixed;
    const light = daylight();
    if (light >= 0.78) return { key: "noon", label: "☀ 昼", note: "視界が最も広い" };
    if (light >= 0.34) return daylightRising()
      ? { key: "morning", label: "🌅 朝", note: "戦場全体が見渡せる" }
      : { key: "dusk", label: "🌇 夕方", note: "視界が狭まっていく" };
    return { key: "night", label: "🌙 夜", note: "視界が狭い・奇襲のチャンス" };
  }

  let lastPhaseKey = "";
  function updateDayCycle(dt) {
    G.clock = (G.clock + dt * 1000) % DAY_LENGTH_MS;
    const phase = dayPhase();
    if (phase.key !== lastPhaseKey) {
      if (lastPhaseKey) banner(`${phase.label}　${phase.note}`);
      lastPhaseKey = phase.key;
    }
  }

  // ============================================================
  //  ミッションと実績(メダル)
  //  ミッションを達成するとメダルを1枚もらえ、メニューの実績画面に貯まっていく。
  //  練習場での戦果は数えない(いくらでも稼げてしまうため)。訓練のメダルだけ別枠。
  // ============================================================
  const ACHIEVEMENTS = [
    { id: "training-clear", icon: "🎓", name: "訓練修了", inTraining: true,
      mission: "練習場の練習メニューをすべてクリアする",
      test: (c) => !!c.run.trainedAll },
    { id: "first-match", icon: "🥉", name: "初出撃",
      mission: "試合を最後まで戦う",
      test: (c) => c.life.matches >= 1 },
    { id: "first-win", icon: "🎖", name: "初勝利",
      mission: "試合に勝つ",
      test: (c) => c.life.wins >= 1 },
    { id: "base-breaker", icon: "💥", name: "城落とし",
      mission: "敵の基地を破壊する",
      test: (c) => c.life.basesDestroyed >= 1 },
    { id: "parry-master", icon: "🛡", name: "白刃取り",
      mission: "1試合でパリィを3回成功させる",
      test: (c) => c.run.parries >= 3 },
    { id: "blademaster", icon: "🗡", name: "剣客",
      mission: "1試合で近接武器で10体倒す",
      test: (c) => c.run.meleeKills >= 10 },
    { id: "demolition", icon: "🧨", name: "爆破工作",
      mission: "1試合でグレネードや地雷で5体倒す",
      test: (c) => c.run.blastKills >= 5 },
    { id: "rampage", icon: "🏅", name: "二十撃破",
      mission: "1試合で20体倒す",
      test: (c) => c.run.kills >= 20 },
    { id: "veteran", icon: "⭐", name: "歴戦",
      mission: "1試合でレベル8まで上げる",
      test: (c) => !!c.me && c.me.level >= 8 },
    { id: "tank-hunter", icon: "🚀", name: "鉄馬砕き",
      mission: "戦車を通算3両破壊する",
      test: (c) => c.life.tankKills >= 3 },
    { id: "flawless", icon: "👑", name: "無傷の凱旋",
      mission: "1度も倒されずに勝利する",
      test: (c) => c.run.won && c.run.deaths === 0 },
    { id: "forest-survivor", icon: "🌲", name: "森を出た者",
      mission: "暗黒の森で勝利する",
      test: (c) => (c.life.winStages.darkforest || 0) >= 1 },
    { id: "sword-pull", icon: "⚔", name: "選ばれし者",
      mission: "時の森で岩から剣を抜く",
      test: (c) => c.life.swordPulls >= 1 },
    { id: "beast-slayer", icon: "🐉", name: "魔物狩り",
      mission: "魔物を通算5体倒す",
      test: (c) => c.life.beastKills >= 5 },
    { id: "all-class", icon: "🏆", name: "皆伝",
      mission: "4つの兵科すべてで勝利する",
      test: (c) => CLASSES.every((cl) => (c.life.winClasses[cl.key] || 0) >= 1) },
  ];

  let medals = {};       // 実績id → 獲得日
  let lifeStats = null;  // ずっと貯まる通算成績
  let runStats = null;   // 今の試合だけの成績

  function emptyLifeStats() {
    return {
      matches: 0, wins: 0, kills: 0, tankKills: 0, basesDestroyed: 0,
      beastKills: 0, swordPulls: 0, winClasses: {}, winStages: {},
    };
  }

  function emptyRunStats() {
    return {
      kills: 0, meleeKills: 0, blastKills: 0, deaths: 0, basesDestroyed: 0,
      parries: 0, tankKills: 0, beastKills: 0, swordPulls: 0,
      trainedAll: false, won: false, committed: false,
    };
  }

  function noteStat(key, amount) {
    if (!runStats || isTraining()) return;
    runStats[key] = (runStats[key] || 0) + (amount == null ? 1 : amount);
  }

  // 試合が終わった(またはメニューへ戻った)ときに、その試合の成績を通算へ足す。
  function commitRun(won) {
    if (!runStats || runStats.committed) return;
    runStats.committed = true;
    if (isTraining()) return;   // 練習場は成績に数えない
    runStats.won = !!won;
    lifeStats.matches++;
    lifeStats.kills += runStats.kills;
    lifeStats.tankKills += runStats.tankKills;
    lifeStats.basesDestroyed += runStats.basesDestroyed;
    lifeStats.beastKills += runStats.beastKills;
    lifeStats.swordPulls += runStats.swordPulls;
    if (won) {
      lifeStats.wins++;
      lifeStats.winClasses[playerClass] = (lifeStats.winClasses[playerClass] || 0) + 1;
      const stage = G && G.stage ? G.stage : playerStage;
      lifeStats.winStages[stage] = (lifeStats.winStages[stage] || 0) + 1;
    }
    saveProgress();
    checkAchievements();
  }

  function checkAchievements() {
    if (!runStats || !lifeStats) return;
    const training = isTraining();
    const context = { run: runStats, life: lifeStats, me: localSoldier() };
    let earned = false;
    for (const a of ACHIEVEMENTS) {
      if (medals[a.id]) continue;
      // 練習場では訓練のメダルだけ、通常のステージではそれ以外だけを判定する
      if (training !== !!a.inTraining) continue;
      let ok = false;
      try { ok = !!a.test(context); } catch (e) { ok = false; }
      if (!ok) continue;
      medals[a.id] = new Date().toISOString().slice(0, 10);
      queueMedalToast(a);
      earned = true;
    }
    if (earned) saveProgress();
  }

  const medalQueue = [];
  let medalToastTimer = null;

  function queueMedalToast(a) {
    medalQueue.push(a);
    if (!medalToastTimer) showNextMedalToast();
  }

  function showNextMedalToast() {
    const a = medalQueue.shift();
    if (!a) { medalToastTimer = null; el.medalToast.classList.add("hidden"); return; }
    el.medalToast.innerHTML =
      `<span class="mt-icon">${a.icon}</span>` +
      `<span class="mt-text"><b>実績獲得</b>${esc(a.name)}<i>${esc(a.mission)}</i></span>`;
    el.medalToast.classList.remove("hidden");
    Audio.levelup();
    medalToastTimer = setTimeout(showNextMedalToast, 2800);
  }

  function renderMedals() {
    const got = ACHIEVEMENTS.filter((a) => medals[a.id]).length;
    el.medalCount.textContent = got;
    el.medalTotal.textContent = ACHIEVEMENTS.length;
    el.medalGrid.innerHTML = ACHIEVEMENTS.map((a) => {
      const day = medals[a.id];
      return `<article class="medal${day ? " got" : ""}">` +
        `<span class="medal-icon">${day ? a.icon : "🔒"}</span>` +
        `<span class="medal-info"><b>${esc(a.name)}</b><span>${esc(a.mission)}</span>` +
        `<em>${day ? `獲得 ${esc(day)}` : "未獲得"}</em></span></article>`;
    }).join("");
  }

  function openMedals() {
    renderMedals();
    el.medals.classList.remove("hidden");
  }

  function sanitizeShopLevels(value) {
    const levels = {};
    for (const item of SHOP_ITEMS) {
      const raw = value && Number(value[item.key]);
      levels[item.key] = Number.isFinite(raw) ? clamp(Math.floor(raw), 0, item.max) : 0;
    }
    return levels;
  }

  function loadProgress() {
    const savedMoney = Number(localStorage.getItem("wz-money"));
    money = Number.isFinite(savedMoney) ? Math.max(0, Math.floor(savedMoney)) : 0;
    try {
      shopLevels = sanitizeShopLevels(JSON.parse(localStorage.getItem("wz-shop") || "{}"));
    } catch (e) {
      shopLevels = sanitizeShopLevels({});
    }
    try {
      medals = JSON.parse(localStorage.getItem("wz-medals") || "{}") || {};
    } catch (e) {
      medals = {};
    }
    try {
      lifeStats = Object.assign(emptyLifeStats(), JSON.parse(localStorage.getItem("wz-stats") || "{}"));
    } catch (e) {
      lifeStats = emptyLifeStats();
    }
    if (!lifeStats.winClasses) lifeStats.winClasses = {};
    if (!lifeStats.winStages) lifeStats.winStages = {};
  }

  function saveProgress() {
    localStorage.setItem("wz-money", String(money));
    localStorage.setItem("wz-shop", JSON.stringify(shopLevels));
    localStorage.setItem("wz-medals", JSON.stringify(medals));
    localStorage.setItem("wz-stats", JSON.stringify(lifeStats));
    if (el.menuMoney) el.menuMoney.textContent = money;
  }

  function applyShopUpgrades(s, levels) {
    if (!s || s.shopApplied) return;
    const lv = sanitizeShopLevels(levels);
    s.maxHp += lv.health * 10;
    s.hp = s.maxHp;
    s.maxArmor += lv.armor * 15;
    s.armor = s.maxArmor;
    s.maxShield += lv.shield * 20;
    s.shield = s.maxShield;
    s.dmgMul *= 1 + lv.damage * 0.05;
    // 兵科で決まった所持数を土台にして、ショップ強化を上乗せする
    s.maxGrenades = (s.maxGrenades == null ? 3 : s.maxGrenades) + lv.grenade;
    s.grenades = s.maxGrenades;
    s.maxMines = (s.maxMines == null ? 2 : s.maxMines) + lv.mine;
    s.mines = s.maxMines;
    s.shopApplied = true;
  }

  function shopCost(item, level) {
    return item.baseCost + item.step * level;
  }

  function renderShop(message = "", isError = false) {
    el.shopMoney.textContent = money;
    if (el.menuMoney) el.menuMoney.textContent = money;
    el.shopItems.innerHTML = SHOP_ITEMS.map((item) => {
      const level = shopLevels[item.key] || 0;
      const maxed = level >= item.max;
      const cost = maxed ? 0 : shopCost(item, level);
      return `<article class="shop-item"><span class="shop-icon">${item.icon}</span>` +
        `<span class="shop-info"><b>${esc(item.name)} Lv.${level}/${item.max}</b><span>${esc(item.desc)}</span></span>` +
        `<button class="shop-buy" data-shop-buy="${item.key}"${maxed ? " disabled" : ""}>${maxed ? "強化済" : `${cost} G`}</button></article>`;
    }).join("");
    el.shopMessage.textContent = message;
    el.shopMessage.classList.toggle("err", isError);
  }

  function buyShopItem(key) {
    const item = SHOP_ITEMS.find((entry) => entry.key === key);
    if (!item) return;
    const level = shopLevels[item.key] || 0;
    if (level >= item.max) {
      renderShop("この装備は最大まで強化済みです。", true);
      return;
    }
    const cost = shopCost(item, level);
    if (money < cost) {
      renderShop(`所持金が足りません（あと ${cost - money} G）。`, true);
      return;
    }
    money -= cost;
    shopLevels[item.key] = level + 1;
    saveProgress();
    renderShop(`${item.name}をLv.${level + 1}へ強化しました。`);
  }

  // ---- 障害物の種類 ----
  // solid: 通り抜けられない / opaque: 視線を遮る / stopsBullets: 弾を止める
  // 茂みだけは「通れるが見通せない」= 隠れられる場所として特別扱いする。
  const OBSTACLE_KINDS = {
    wall:     { solid: true,  opaque: true,  stopsBullets: true },
    ruin:     { solid: true,  opaque: true,  stopsBullets: true },
    crate:    { solid: true,  opaque: true,  stopsBullets: true },
    sandbag:  { solid: true,  opaque: true,  stopsBullets: true },
    rock:     { solid: true,  opaque: true,  stopsBullets: true },
    wreck:    { solid: true,  opaque: true,  stopsBullets: true },
    tree:     { solid: true,  opaque: true,  stopsBullets: true },
    tires:    { solid: true,  opaque: true,  stopsBullets: true },
    hedgehog: { solid: true,  opaque: false, stopsBullets: false },
    bush:     { solid: false, opaque: true,  stopsBullets: false },
    barrel:   { solid: true,  opaque: false, stopsBullets: true },
  };
  const isSolid = (o) => OBSTACLE_KINDS[o.type] ? OBSTACLE_KINDS[o.type].solid : true;
  const isOpaque = (o) => OBSTACLE_KINDS[o.type] ? OBSTACLE_KINDS[o.type].opaque : true;
  const stopsBullets = (o) => OBSTACLE_KINDS[o.type] ? OBSTACLE_KINDS[o.type].stopsBullets : true;

  // ---- マップ生成 ----
  function genMap() {
    const key = stageDef().key;
    if (key === "darkforest") return genForestMap(0);
    if (key === "timeforest") return genForestMap(SWORD_CLEARING_R);
    if (key === "training") return genTrainingMap();
    return genFieldMap();
  }

  // ---- 練習場のレイアウト ----
  // どのチームを選んでも同じ練習ができるよう、マップ中央から放射状に組む。
  // 中心に的、その外に射撃位置の土嚢、さらに外に銃座と遮蔽ゾーン。
  const TRAINING_CENTER = { x: WORLD_W / 2, y: WORLD_H / 2 };
  const TRAINING_TARGET_R = 90;    // 静止標的を並べる半径
  const TRAINING_MOVER_R = 185;    // 動く標的が周回する半径
  const TRAINING_BARREL_R = 235;   // 爆発ドラム缶
  const TRAINING_LINE_R = 300;     // 射撃位置(土嚢)
  const TRAINING_TURRET_R = 405;   // 機関銃座

  // 中心から radius だけ離れた円周上の位置。a は中心から外を向く角度。
  function ringPos(radius, index, count, offset) {
    const a = (offset || 0) + (index / count) * Math.PI * 2;
    return {
      x: TRAINING_CENTER.x + Math.cos(a) * radius,
      y: TRAINING_CENTER.y + Math.sin(a) * radius,
      a,
    };
  }

  function genTrainingMap() {
    const obs = [];
    const wt = 26;
    obs.push({ x: 0, y: 0, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: WORLD_H - wt, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });
    obs.push({ x: WORLD_W - wt, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });

    // 射撃位置の土嚢。どの方向から来ても正面に遮蔽がある。間は通り抜けられる。
    for (let i = 0; i < 8; i++) {
      const p = ringPos(TRAINING_LINE_R, i, 8, Math.PI / 8);
      // 円周に沿って寝かせる(半径が縦向きなら横長、横向きなら縦長)
      const flat = Math.abs(Math.cos(p.a)) < 0.5;
      const w = flat ? 112 : 32, h = flat ? 32 : 112;
      obs.push({ x: p.x - w / 2, y: p.y - h / 2, w, h, type: "sandbag", hp: Infinity, seed: (i + 1) / 9 });
    }

    // 爆発ドラム缶(撃つと爆発する練習用)
    for (let i = 0; i < 6; i++) {
      const p = ringPos(TRAINING_BARREL_R, i, 6, Math.PI / 6);
      obs.push({ x: p.x - 15, y: p.y - 15, w: 30, h: 30, type: "barrel", hp: 30, r: 16 });
    }

    // 遮蔽ゾーン。隠れる練習用に、コンテナ・崩れ壁・茂みを混ぜて並べる。
    const coverKinds = ["crate", "ruin", "bush", "tires", "crate", "bush", "hedgehog", "ruin", "bush", "crate", "wreck", "bush"];
    for (let i = 0; i < coverKinds.length; i++) {
      const t = coverKinds[i];
      const p = ringPos(640 + (i % 3) * 90, i, coverKinds.length, 0.26);
      let w, h;
      if (t === "bush") { w = 104; h = 88; }
      else if (t === "ruin") { w = 150; h = 34; }
      else if (t === "wreck") { w = 88; h = 46; }
      else if (t === "tires") { w = h = 46; }
      else if (t === "hedgehog") { w = h = 48; }
      else { w = h = 56; }
      obs.push({ x: p.x - w / 2, y: p.y - h / 2, w, h, type: t, hp: Infinity, seed: (i + 3) / 15 });
    }
    return obs;
  }

  // 暗黒の森 / 時の森: 木と茂みで埋め尽くし、見通しを極端に悪くする。
  // 遮蔽が多いぶん、音を立てるとクリーチャーに位置がバレる。
  // clearing に半径を渡すと、マップ中央をその半径だけ空き地にする(時の森の岩場)。
  function genForestMap(clearing) {
    const clearR2 = clearing ? clearing * clearing : 0;
    const inClearing = (x, y, w, h) =>
      clearR2 > 0 && dist2(x + w / 2, y + h / 2, WORLD_W / 2, WORLD_H / 2) < clearR2;
    const obs = [];
    const wt = 26;
    obs.push({ x: 0, y: 0, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: WORLD_H - wt, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });
    obs.push({ x: WORLD_W - wt, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });

    // 廃墟(数は少なめ)
    for (let i = 0; i < 7; i++) {
      const w = rand(90, 170), h = rand(24, 38);
      const vertical = Math.random() < 0.5;
      const rw = vertical ? h : w, rh = vertical ? w : h;
      const x = rand(200, WORLD_W - 200 - rw);
      const y = rand(200, WORLD_H - 200 - rh);
      if (BASE_SPOTS.some((spot) => dist2(x + rw / 2, y + rh / 2, spot.x, spot.y) < 300 ** 2)) continue;
      if (inClearing(x, y, rw, rh)) continue;
      obs.push({ x, y, w: rw, h: rh, type: "ruin", hp: Infinity, seed: Math.random() });
    }

    // 木は通れないので、必ず人もクリーチャーも抜けられる隙間を空けて植える。
    // (隙間を確保しないと木が固まって通行不能な壁ができてしまう)
    const LANE = 46;
    const solids = obs.slice();
    const farFromBase = (x, y, w, h, pad) =>
      !G.bases.some((base) => dist2(x + w / 2, y + h / 2, base.x, base.y) < (base.r + pad) ** 2);
    for (let i = 0; i < 620; i++) {
      const t = Math.random() < 0.78 ? "tree" : "rock";
      const w = t === "tree" ? rand(44, 76) : rand(34, 58);
      const h = t === "tree" ? w : rand(34, 58);
      const x = rand(90, WORLD_W - 90 - w);
      const y = rand(90, WORLD_H - 90 - h);
      if (!farFromBase(x, y, w, h, 60) || inClearing(x, y, w, h)) continue;
      // 既存の固い障害物から LANE ぶん離れていなければ諦める
      const blocked = solids.some((o) =>
        x - LANE < o.x + o.w && x + w + LANE > o.x && y - LANE < o.y + o.h && y + h + LANE > o.y);
      if (blocked) continue;
      const tree = { x, y, w, h, type: t, hp: Infinity, seed: Math.random() };
      obs.push(tree);
      solids.push(tree);
    }

    // 茂みは通り抜けられるので、視界を潰すために好きなだけ重ねて置く
    for (let i = 0; i < 190; i++) {
      const w = rand(64, 124), h = rand(58, 106);
      const x = rand(70, WORLD_W - 70 - w);
      const y = rand(70, WORLD_H - 70 - h);
      if (!farFromBase(x, y, w, h, 30) || inClearing(x, y, w, h)) continue;
      obs.push({ x, y, w, h, type: "bush", hp: Infinity, seed: Math.random() });
    }
    return obs;
  }

  function genFieldMap() {
    const obs = [];
    // 外周の壁
    const wt = 26;
    obs.push({ x: 0, y: 0, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: WORLD_H - wt, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });
    obs.push({ x: WORLD_W - wt, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });

    // 中央〜全体に建物ブロック / 土嚢 / コンテナ
    const blocks = 13;
    for (let i = 0; i < blocks; i++) {
      const w = rand(80, 240), h = rand(70, 200);
      const x = rand(160, WORLD_W - 160 - w);
      const y = rand(160, WORLD_H - 160 - h);
      // 4隅のスポーン地点を塞がない
      if (BASE_SPOTS.some((spot) => dist2(x + w / 2, y + h / 2, spot.x, spot.y) < 330 ** 2)) continue;
      obs.push({ x, y, w, h, type: "wall", hp: Infinity });
    }
    // 崩れた壁(見た目違いの遮蔽)
    for (let i = 0; i < 6; i++) {
      const w = rand(90, 190), h = rand(24, 40);
      const vertical = Math.random() < 0.5;
      const rw = vertical ? h : w, rh = vertical ? w : h;
      const x = rand(180, WORLD_W - 180 - rw);
      const y = rand(180, WORLD_H - 180 - rh);
      if (BASE_SPOTS.some((spot) => dist2(x + rw / 2, y + rh / 2, spot.x, spot.y) < 300 ** 2)) continue;
      obs.push({ x, y, w: rw, h: rh, type: "ruin", hp: Infinity, seed: Math.random() });
    }

    // 散在カバー。茂みは通り抜けられるが視線を遮る = 隠れ場所。
    const coverTypes = ["crate", "crate", "sandbag", "rock", "tree", "tree", "bush", "bush", "wreck", "tires", "hedgehog"];
    const covers = 46;
    for (let i = 0; i < covers; i++) {
      const t = pick(coverTypes);
      let w, h;
      if (t === "sandbag") { w = rand(70, 120); h = rand(26, 36); }
      else if (t === "bush") { w = rand(58, 104); h = rand(50, 88); }
      else if (t === "wreck") { w = rand(74, 96); h = rand(40, 50); }
      else if (t === "tree") { w = h = rand(46, 68); }
      else if (t === "tires") { w = h = rand(38, 52); }
      else if (t === "hedgehog") { w = h = rand(40, 54); }
      else { w = rand(34, 60); h = rand(34, 60); }
      const x = rand(120, WORLD_W - 120 - w);
      const y = rand(120, WORLD_H - 120 - h);
      if (G.bases.some((base) => dist2(x + w / 2, y + h / 2, base.x, base.y) < (base.r + 55) ** 2)) continue;
      obs.push({ x, y, w, h, type: t, hp: Infinity, seed: Math.random() });
    }
    // 爆発バレル
    for (let i = 0; i < 9; i++) {
      const x = rand(200, WORLD_W - 220), y = rand(200, WORLD_H - 220);
      if (G.bases.some((base) => dist2(x, y, base.x, base.y) < (base.r + 60) ** 2)) continue;
      obs.push({ x, y, w: 30, h: 30, type: "barrel", hp: 30, r: 16 });
    }
    return obs;
  }

  function teamSpawn(team) {
    const base = G && G.bases ? G.bases[team] : makeBases()[team];
    const a = base.heading + rand(-0.85, 0.85), d = rand(55, 135);
    return {
      x: clamp(base.x + Math.cos(a) * d, 55, WORLD_W - 55),
      y: clamp(base.y + Math.sin(a) * d, 55, WORLD_H - 55),
    };
  }

  // 兵科の能力値を反映する。ショップ強化より先に呼ぶこと。
  function applyClass(s, key) {
    const c = classDef(key);
    s.classKey = c.key;
    s.maxHp = Math.max(40, s.maxHp + c.hpBonus);
    s.hp = s.maxHp;
    s.speed *= c.speedMul;
    s.gunMul = c.gunMul;
    s.meleeMul = c.meleeMul;
    s.maxGrenades = c.grenades;
    s.grenades = c.grenades;
    s.maxMines = c.mines;
    s.mines = c.mines;
    s.maxWires = c.wires;
    s.wires = c.wires;
    s.parryWindowMul = c.parryWindowMul;
    s.parryCooldownMul = c.parryCooldownMul;
    s.mineArmMul = c.mineArmMul;
    s.mineBlastMul = c.mineBlastMul;
    s.mineStealthMul = c.mineStealthMul;
    s.seesEnemyMines = c.seesEnemyMines;
    // 兵科ごとに持てる武器は限定。数字キーはこの並び順に対応する。
    s.loadout = c.weapons.map((key) => WKEY[key]).filter((i) => i != null);
    s.weapon = s.loadout[0];
    s.ammo = WEAPONS[s.weapon].mag;
  }

  // 装備している武器の中で next 方向へ1つずらす
  function cycleWeapon(s, dir) {
    if (!s || !s.loadout || s.loadout.length < 2) return null;
    const cur = s.loadout.indexOf(s.weapon);
    const next = ((cur < 0 ? 0 : cur) + dir + s.loadout.length) % s.loadout.length;
    return s.loadout[next];
  }

  function makeSoldier(opt) {
    const team = opt.team;
    const sp = teamSpawn(team);
    return {
      id: opt.id,
      team,
      name: opt.name,
      classKey: "soldier",
      gunMul: 1, meleeMul: 1,
      parryWindowMul: 1, parryCooldownMul: 1,
      mineArmMul: 1, mineBlastMul: 1, mineStealthMul: 1, seesEnemyMines: false,
      wires: 0, maxWires: 0, lastWire: -99999,
      isHuman: !!opt.isHuman,
      controller: opt.controller || "cpu", // 'cpu' | 'local' | peerId
      x: sp.x, y: sp.y, vx: 0, vy: 0,
      angle: BASE_SPOTS[team].heading,
      aimAngle: 0,
      hp: 100, maxHp: 100, dead: false, respawnAt: 0,
      lastDamagedAt: -99999,
      armor: 100, maxArmor: 100, shield: 160, maxShield: 160, shieldRaised: false,
      parryUntil: 0, parryCooldownUntil: 0, stunnedUntil: 0,
      level: 1, xp: 0, dmgMul: 1,
      speed: opt.isHuman ? 188 : rand(150, 172),
      weapon: opt.weapon != null ? opt.weapon : WKEY.rifle,
      ammo: WEAPONS[opt.weapon != null ? opt.weapon : WKEY.rifle].mag,
      reloading: false, reloadUntil: 0, lastShot: 0,
      kills: 0, deaths: 0,
      grenades: 3, maxGrenades: 3, lastGrenade: -99999, vehicleId: -1, turretId: -1,
      dropUntil: 0, sweepAt: 0,
      mines: 2, maxMines: 2, lastMine: -99999,
      lastBaseSupplyAt: -99999,
      lastFootstepAt: -99999, noiseRadius: 0, heardUntil: 0,
      hitFlash: 0, recoil: 0, legPhase: Math.random() * 6.28, moving: false, muzzle: 0,
      ai: { think: 0, targetId: -1, strafe: 1, strafeUntil: 0, lastSeen: 0, lostAt: 0, wx: sp.x, wy: sp.y, fireUntil: 0 },
      // ネット補間用
      rx: sp.x, ry: sp.y,
    };
  }

  function spawnTeams() {
    const D = DIFF[difficulty];
    let id = G.nextId;
    // ローカルプレイヤーは選択したチームへ
    const me = makeSoldier({ id: id++, team: playerTeam, name: playerName || "あなた", isHuman: true, controller: "local" });
    applyClass(me, playerClass);
    applyShopUpgrades(me, shopLevels);
    G.localId = me.id;
    G.soldiers.push(me);
    // タッチ操作は照準を保持するので、開始時から敵陣を向かせておく
    localInput.aimAngle = me.angle;
    G.nextId = id;
    // 練習場は敵兵を出さない。代わりに撃ち返してこない的を並べる。
    if (isTraining()) { spawnTrainingDummies(); return; }
    const used = new Set([me.name]);
    function botName() { let n; do { n = pick(BOT_NAMES); } while (used.has(n) && used.size < BOT_NAMES.length); used.add(n); return n; }
    for (const team of TEAMS) {
      // プレイヤーが埋めた1枠ぶんだけ自軍のボットを減らす
      const count = team === playerTeam ? TEAM_SIZE - 1 : TEAM_SIZE;
      // 自軍のボットだけ僅かに弱くして、プレイヤーの見せ場を残す
      const friendly = team === playerTeam;
      for (let i = 0; i < count; i++) {
        const b = makeSoldier({ id: id++, team, name: botName() });
        b.maxHp = Math.round(100 * D.hpMul * (friendly ? 0.95 : 1));
        b.hp = b.maxHp;
        b.dmgMul = D.dmgMul * (friendly ? 0.9 : 1);
        // ボットにも兵科をばらけさせる
        const roll = Math.random();
        applyClass(b, roll < 0.22 ? "samurai" : roll < 0.40 ? "trapper" : roll < 0.56 ? "heavy" : "soldier");
        // 装備の中からランダムに1つ選んで持たせる
        b.weapon = pick(b.loadout);
        b.ammo = WEAPONS[b.weapon].mag;
        G.soldiers.push(b);
      }
    }
    G.nextId = id;
  }

  // ============================================================
  //  練習用の的 (練習場)
  //  撃ち返してこない。壊しても数秒で立て直る。
  // ============================================================
  const DUMMY_HP = 70;
  const DUMMY_RESPAWN_MS = 2200;

  // 的は「自分の1つ隣の軍」に所属させる。既存の敵味方判定をそのまま使えるため。
  function trainingDummyTeam() {
    return (playerTeam + 1) % TEAM_COUNT;
  }

  function makeDummy(id, opt) {
    const s = makeSoldier({ id, team: trainingDummyTeam(), name: opt.name });
    s.dummy = true;
    s.maxHp = DUMMY_HP; s.hp = DUMMY_HP;
    s.armor = 0; s.maxArmor = 0; s.shield = 0; s.maxShield = 0;
    s.grenades = 0; s.maxGrenades = 0; s.mines = 0; s.maxMines = 0; s.wires = 0; s.maxWires = 0;
    s.speed = 0;
    s.x = opt.x; s.y = opt.y; s.rx = opt.x; s.ry = opt.y;
    s.postX = opt.x; s.postY = opt.y;
    s.angle = opt.angle; s.aimAngle = opt.angle;
    s.orbit = opt.orbit || null;
    return s;
  }

  function dummyPost(s) {
    if (!s.orbit) return { x: s.postX, y: s.postY };
    return {
      x: TRAINING_CENTER.x + Math.cos(s.orbit.a) * s.orbit.r,
      y: TRAINING_CENTER.y + Math.sin(s.orbit.a) * s.orbit.r,
    };
  }

  function spawnTrainingDummies() {
    let id = G.nextId;
    const statics = 8;
    for (let i = 0; i < statics; i++) {
      const p = ringPos(TRAINING_TARGET_R, i, statics, 0);
      G.soldiers.push(makeDummy(id++, { name: `的 ${i + 1}`, x: p.x, y: p.y, angle: p.a }));
    }
    // 動く的。狙いを先読みする練習用に、中心のまわりをゆっくり周回する。
    const movers = 3;
    for (let i = 0; i < movers; i++) {
      const p = ringPos(TRAINING_MOVER_R, i, movers, Math.PI / 6);
      G.soldiers.push(makeDummy(id++, {
        name: `動く的 ${i + 1}`, x: p.x, y: p.y, angle: p.a,
        orbit: { r: TRAINING_MOVER_R, a: p.a, speed: i % 2 ? -0.28 : 0.28 },
      }));
    }
    G.nextId = id;
  }

  // 的は攻撃しない。動く的だけが中心のまわりを回る。
  function updateDummy(s, dt) {
    if (!s.orbit) { s.moving = false; s.noiseRadius = 0; return; }
    s.orbit.a += s.orbit.speed * dt;
    const spot = dummyPost(s);
    s.angle = s.orbit.a + (s.orbit.speed >= 0 ? Math.PI / 2 : -Math.PI / 2);
    s.aimAngle = s.angle;
    s.moving = true;
    s.noiseRadius = 0;
    s.legPhase += dt * 12;
    resolveMovement(s, spot.x, spot.y);
  }

  function spawnDogs() {
    const dogNames = ["Rex", "Fang", "Bruno", "Kaiser"];
    // 練習場では自分の軍の犬だけを連れて出る
    const teams = isTraining() ? [playerTeam] : TEAMS;
    G.dogs = teams.map((team, id) => {
      const handler = G.soldiers.find((s) => s.team === team && s.id === G.localId) ||
        G.soldiers.find((s) => s.team === team);
      let x = handler ? handler.x + rand(-45, 45) : teamSpawn(team).x;
      let y = handler ? handler.y + rand(-45, 45) : teamSpawn(team).y;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!G.obstacles.some((o) => isSolid(o) && circleRect(x, y, DOG_R + 3, o.x, o.y, o.w, o.h))) break;
        const sp = teamSpawn(team); x = sp.x; y = sp.y;
      }
      return {
        kind: "dog", id, team, name: dogNames[id] || `K9-${id}`, handlerId: handler ? handler.id : -1,
        x, y, rx: x, ry: y, spawnX: x, spawnY: y, angle: BASE_SPOTS[team].heading,
        hp: 90, maxHp: 90, dead: false, respawnAt: 0, speed: 242,
        damage: 30, lastAttack: -99999, biteAt: 0, kills: 0, stunnedUntil: 0,
      };
    });
  }

  function findTankSpawn(team) {
    const spot = BASE_SPOTS[team];
    // 練習場の無人戦車は動かないので、兵士の湧き位置(基地の正面)を塞がない真横に駐める。
    // 重なった状態で湧くと、戦車に押し戻されて兵士が動けなくなる。
    if (isTraining()) {
      const a = spot.heading + Math.PI / 2;
      const side = { x: spot.x + Math.cos(a) * 150, y: spot.y + Math.sin(a) * 150 };
      if (!G.obstacles.some((o) => isSolid(o) && circleRect(side.x, side.y, TANK_R + 8, o.x, o.y, o.w, o.h))) return side;
    }
    // 基地からマップ中央寄りに少しずらした位置を基準にする
    const home = { x: spot.x + Math.cos(spot.heading) * 55, y: spot.y + Math.sin(spot.heading) * 55 };
    for (let i = 0; i < 50; i++) {
      const x = clamp(home.x + rand(-150, 150), 70, WORLD_W - 70);
      const y = clamp(home.y + rand(-150, 150), 70, WORLD_H - 70);
      if (!G.obstacles.some((o) => isSolid(o) && circleRect(x, y, TANK_R + 8, o.x, o.y, o.w, o.h))) return { x, y };
    }
    return home;
  }

  function spawnTanks() {
    // 練習場では自分の軍の戦車だけを置く
    const teams = isTraining() ? [playerTeam] : TEAMS;
    G.tanks = teams.map((team, id) => {
      const sp = findTankSpawn(team);
      const heading = BASE_SPOTS[team].heading;
      return {
        kind: "tank", id, team, name: `${teamDef(team).name}の戦車`,
        x: sp.x, y: sp.y, rx: sp.x, ry: sp.y, spawnX: sp.x, spawnY: sp.y,
        angle: heading, turretAngle: heading,
        hp: 420, maxHp: 420, dead: false, respawnAt: 0, driverId: -1,
        speed: 105, lastShot: -99999, muzzle: 0, kills: 0, weapon: 0,
        ai: { think: 0, targetId: -1 },
      };
    });
  }

  // ============================================================
  //  時の森: 岩に刺さった剣と、森に棲む魔物
  //  剣は5秒かけて抜く。抜いた者の近くに飛んできた銃弾は極端に遅くなる。
  //  魔物は銃でも倒せるが硬い。時の剣で叩けば一撃で倒せる。
  // ============================================================
  const SWORD_CLEARING_R = 300;    // 岩場として木を生やさない半径
  const SWORD_ROCK_R = 46;
  const SWORD_REACH = 78;          // 抜きにかかれる距離
  const SWORD_PULL_MS = 5000;
  const TIME_FIELD_R = 260;        // 銃弾が遅くなる範囲
  const TIME_SLOW_MUL = 0.16;      // その中での弾速

  const BEAST_R = 22;
  const BEAST_HP = 620;            // 銃だと時間がかかる硬さ
  const BEAST_SPEED = 108;
  const BEAST_SIGHT = 360;
  const BEAST_DAMAGE = 18;
  const BEAST_ATTACK_MS = 1100;
  const BEAST_RESPAWN_MS = 14000;
  const BEAST_COUNT = 6;

  function spawnSwordRock() {
    if (!hasSword()) { G.swordRock = null; return; }
    G.swordRock = {
      x: WORLD_W / 2, y: WORLD_H / 2,
      pulled: false, holderId: -1, pullerId: -1, progress: 0, hitFlash: 0,
    };
  }

  function swordHolder() {
    const rock = G.swordRock;
    if (!rock || !rock.pulled || rock.holderId < 0) return null;
    const s = G.soldiers.find((x) => x.id === rock.holderId && !x.dead);
    return s || null;
  }

  // 剣を抜く。E を押し続けている間だけ進み、離すと巻き戻る。
  function updateSwordRock(dt) {
    const rock = G.swordRock;
    if (!rock) return;
    if (rock.hitFlash > 0) rock.hitFlash = Math.max(0, rock.hitFlash - dt * 4);
    if (rock.pulled) return;
    const me = localSoldier();
    const pulling = !!me && !me.dead && me.vehicleId < 0 && me.turretId < 0 && !isDropping(me) &&
      localInput.interactHold && dist2(me.x, me.y, rock.x, rock.y) < (SWORD_ROCK_R + SWORD_REACH) ** 2;
    if (pulling) {
      rock.pullerId = me.id;
      rock.progress = Math.min(SWORD_PULL_MS, rock.progress + dt * 1000);
      if (rock.progress % 400 < dt * 1000) {
        addParticle(rock.x + rand(-18, 18), rock.y - 26 + rand(-10, 10), {
          kind: "spark", vx: rand(-40, 40), vy: rand(-90, -20), life: 340, size: 2.6,
        });
      }
      if (rock.progress >= SWORD_PULL_MS) grantSword(me);
    } else if (rock.progress > 0) {
      rock.progress = Math.max(0, rock.progress - dt * 1600);
      if (rock.progress === 0) rock.pullerId = -1;
    }
  }

  function grantSword(s) {
    const rock = G.swordRock;
    rock.pulled = true;
    rock.holderId = s.id;
    rock.progress = SWORD_PULL_MS;
    const idx = WKEY.timesword;
    if (s.loadout.indexOf(idx) < 0) s.loadout.push(idx);
    s.weapon = idx;
    s.ammo = 1;
    s.reloading = false;
    Audio.levelup();
    shake = Math.min(16, shake + 10);
    if (s.id === G.localId) noteStat("swordPulls");
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      addParticle(rock.x, rock.y, { kind: "spark", vx: Math.cos(a) * rand(60, 260), vy: Math.sin(a) * rand(60, 260), life: rand(400, 800), size: rand(2, 4) });
    }
    banner(s.id === G.localId ? "時の剣を抜いた！　近づく銃弾が遅くなる" : `${s.name} が時の剣を抜いた`);
  }

  function spawnBeasts() {
    G.beasts = [];
    if (!hasSword()) return;
    for (let id = 0; id < BEAST_COUNT; id++) {
      let spot = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        const x = rand(340, WORLD_W - 340), y = rand(300, WORLD_H - 300);
        if (BASE_SPOTS.some((b) => dist2(x, y, b.x, b.y) < 620 ** 2)) continue;
        if (dist2(x, y, WORLD_W / 2, WORLD_H / 2) < 360 ** 2) continue;
        if (G.obstacles.some((o) => isSolid(o) && circleRect(x, y, BEAST_R + 6, o.x, o.y, o.w, o.h))) continue;
        spot = { x, y };
        break;
      }
      if (!spot) continue;
      G.beasts.push({
        kind: "beast", id, team: -1, name: `魔物${id + 1}`,
        x: spot.x, y: spot.y, homeX: spot.x, homeY: spot.y,
        hp: BEAST_HP, maxHp: BEAST_HP, dead: false, respawnAt: 0,
        angle: rand(0, Math.PI * 2), targetId: -1, lastAttack: -99999,
        wx: spot.x, wy: spot.y, roamUntil: 0, hitFlash: 0, limbPhase: Math.random() * 6.28,
      });
    }
  }

  function updateBeasts(dt, t) {
    for (const beast of G.beasts) {
      if (beast.dead) {
        if (t >= beast.respawnAt) respawnBeast(beast);
        continue;
      }
      if (beast.hitFlash > 0) beast.hitFlash = Math.max(0, beast.hitFlash - dt * 4);
      // 一番近い兵士を追う。壁の裏までは見えない。
      let prey = null, best = BEAST_SIGHT ** 2;
      for (const s of G.soldiers) {
        if (s.dead || s.vehicleId >= 0 || isDropping(s)) continue;
        const d2v = dist2(beast.x, beast.y, s.x, s.y);
        if (d2v < best && lineClear(beast.x, beast.y, s.x, s.y)) { best = d2v; prey = s; }
      }
      let speed = BEAST_SPEED;
      if (prey) {
        beast.targetId = prey.id;
        beast.wx = prey.x; beast.wy = prey.y;
        if (dist2(beast.x, beast.y, prey.x, prey.y) < (BEAST_R + SOLDIER_R + 4) ** 2) {
          if (t - beast.lastAttack >= BEAST_ATTACK_MS) {
            beast.lastAttack = t;
            const a = Math.atan2(prey.y - beast.y, prey.x - beast.x);
            damageSoldier(prey, BEAST_DAMAGE, null, { x: beast.x, y: beast.y, type: "melee" });
            addParticle(prey.x, prey.y, { kind: "bite", life: 180, size: 20, a });
          }
          speed = 0;
        }
      } else {
        beast.targetId = -1;
        speed = BEAST_SPEED * 0.45;
        if (t > beast.roamUntil) {
          beast.roamUntil = t + rand(2200, 4600);
          beast.wx = clamp(beast.homeX + rand(-260, 260), 120, WORLD_W - 120);
          beast.wy = clamp(beast.homeY + rand(-260, 260), 120, WORLD_H - 120);
        }
      }
      const dx = beast.wx - beast.x, dy = beast.wy - beast.y;
      const d = Math.hypot(dx, dy) || 1;
      beast.limbPhase += dt * (prey ? 11 : 4);
      if (speed > 0 && d > 8) {
        beast.angle = angLerp(beast.angle, Math.atan2(dy, dx), clamp(dt * 6, 0, 1));
        const ox = beast.x, oy = beast.y;
        moveBeast(beast, beast.x + Math.cos(beast.angle) * speed * dt, beast.y + Math.sin(beast.angle) * speed * dt);
        // 木に引っかかったら横滑りで回り込む
        if (beast.x === ox && beast.y === oy) {
          moveBeast(beast, beast.x - Math.sin(beast.angle) * speed * dt, beast.y + Math.cos(beast.angle) * speed * dt);
        }
      }
    }
  }

  function moveBeast(beast, nx, ny) {
    let x = clamp(nx, BEAST_R, WORLD_W - BEAST_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(x, beast.y, BEAST_R, o.x, o.y, o.w, o.h))) x = beast.x;
    let y = clamp(ny, BEAST_R, WORLD_H - BEAST_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(x, y, BEAST_R, o.x, o.y, o.w, o.h))) y = beast.y;
    beast.x = x; beast.y = y;
  }

  function respawnBeast(beast) {
    beast.x = beast.homeX; beast.y = beast.homeY;
    beast.hp = beast.maxHp; beast.dead = false;
    beast.targetId = -1; beast.lastAttack = -99999; beast.hitFlash = 0;
  }

  // 爆風のなかにいる魔物へまとめてダメージ。中心から遠いほど減衰する。
  function damageBeastsInBlast(x, y, radius, dmg, attacker) {
    for (const beast of G.beasts) {
      if (beast.dead) continue;
      const d = Math.sqrt(dist2(beast.x, beast.y, x, y));
      if (d < radius + BEAST_R) damageBeast(beast, dmg * (1 - clamp(d / (radius + BEAST_R), 0, 0.7)), attacker, false);
    }
  }

  // slay を true にすると体力にかかわらず一撃で倒す(時の剣)
  function damageBeast(beast, dmg, attacker, slay) {
    if (beast.dead) return;
    beast.hp -= slay ? beast.maxHp : dmg;
    beast.hitFlash = 1;
    if (beast.hp > 0) return;
    beast.dead = true;
    beast.hp = 0;
    beast.respawnAt = now() + BEAST_RESPAWN_MS;
    Audio.boom();
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      addParticle(beast.x, beast.y, { kind: "dust", vx: Math.cos(a) * rand(50, 230), vy: Math.sin(a) * rand(50, 230), life: rand(350, 700), size: rand(2.5, 5) });
    }
    addParticle(beast.x, beast.y, { kind: "stain", life: 8000, size: 22 });
    if (attacker && !attacker.kind) {
      gainXp(attacker, 3);
      addKillfeed(attacker, { name: beast.name, team: -1 });
      if (attacker.id === G.localId) noteStat("beastKills");
    }
  }

  // ============================================================
  //  降下演出 (試合開始)
  //  輸送機から飛び降り、パラシュートで着地するまでの数秒間。
  //  降下中は攻撃も被弾もせず、流されるように少しだけ動ける。
  //  オンラインは開始タイミングがずれるので、ソロ戦だけで行う。
  // ============================================================
  const DROP_MS = 2600;
  const DROP_HEIGHT = 330;     // 見た目の高度(ピクセル)
  const DROP_DRIFT_MUL = 0.45; // 降下中の移動速度
  const PLANE_MS = 3600;
  const PLANE_ALT = 430;

  const isDropping = (s) => now() < (s.dropUntil || 0);

  // 残り時間から見た目の高度を出す。落ち始めは速く、着地間際はゆっくり。
  function dropAltitude(s) {
    const left = (s.dropUntil || 0) - now();
    if (left <= 0) return 0;
    const p = clamp(left / DROP_MS, 0, 1);
    return DROP_HEIGHT * p * p;
  }

  function beginDrop() {
    if (mode !== "sp") { G.dropAt = 0; return; }
    G.dropAt = now();
    for (const s of G.soldiers) {
      if (s.dummy) continue;
      s.dropUntil = G.dropAt + DROP_MS;
    }
  }

  // 着地した瞬間に土煙を上げて、降下状態を終わらせる
  function updateDrops(t) {
    for (const s of G.soldiers) {
      if (!s.dropUntil || t < s.dropUntil) continue;
      s.dropUntil = 0;
      for (let i = 0; i < 9; i++) {
        addParticle(s.x, s.y, { kind: "dust", vx: rand(-80, 80), vy: rand(-80, 80), life: rand(250, 520), size: rand(2, 4.5) });
      }
    }
  }

  // ============================================================
  //  クリーチャー (暗黒の森)
  //  ステージに1体だけ。倒せない代わりに、走らなければ気づかれない。
  //  触れられたら即死。
  // ============================================================
  const CREATURE_R = 20;
  const CREATURE_HEAR_R = 560;       // 走る足音に気づく距離
  const CREATURE_SHOT_HEAR_R = 780;  // 銃声に気づく距離
  const CREATURE_SIGHT_R = 260;      // 歩いていても至近距離なら見つかる
  const CREATURE_HUNT_SPEED = 232;
  const CREATURE_ROAM_SPEED = 62;
  const CREATURE_LOSE_MS = 6000;     // 手がかりが無くなってから諦めるまで

  function spawnCreature() {
    if (!stageDef().creature) { G.creature = null; return; }
    // 最初はマップ中央付近、どの基地からも離れた場所に潜ませる
    let spot = { x: WORLD_W / 2, y: WORLD_H / 2 };
    for (let i = 0; i < 120; i++) {
      const x = rand(500, WORLD_W - 500), y = rand(400, WORLD_H - 400);
      if (BASE_SPOTS.some((b) => dist2(x, y, b.x, b.y) < 700 ** 2)) continue;
      if (G.obstacles.some((o) => isSolid(o) && circleRect(x, y, CREATURE_R + 6, o.x, o.y, o.w, o.h))) continue;
      spot = { x, y };
      break;
    }
    G.creature = {
      kind: "creature", x: spot.x, y: spot.y, rx: spot.x, ry: spot.y,
      angle: rand(0, Math.PI * 2), targetId: -1, lastHeardAt: -99999,
      wx: spot.x, wy: spot.y, roamUntil: 0, lastRoarAt: -99999,
      limbPhase: 0, hunting: false, lungeAt: 0,
    };
  }

  // 物音を立てた相手を探す。走る足音・銃声・至近距離の目視。
  function creatureFindPrey(cr, t) {
    let best = null, bestScore = Infinity;
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0) continue;
      const d2 = dist2(cr.x, cr.y, s.x, s.y);
      // 走っている(足音が大きい)相手が最優先
      const running = s.moving && (s.noiseRadius || 0) > 500;
      const heardRun = running && d2 < CREATURE_HEAR_R ** 2;
      const heardShot = t - (s.lastShot || -99999) < 900 && d2 < CREATURE_SHOT_HEAR_R ** 2 && !WEAPONS[s.weapon].melee;
      const seen = d2 < CREATURE_SIGHT_R ** 2 && lineClear(cr.x, cr.y, s.x, s.y);
      if (!heardRun && !heardShot && !seen) continue;
      // 近いほど、そして走っている相手ほど狙われやすい
      const score = d2 * (heardRun ? 0.5 : 1);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function updateCreature(dt, t) {
    const cr = G.creature;
    if (!cr) return;
    cr.limbPhase += dt * (cr.hunting ? 15 : 4);

    const prey = creatureFindPrey(cr, t);
    if (prey) {
      cr.targetId = prey.id;
      cr.lastHeardAt = t;
      cr.wx = prey.x; cr.wy = prey.y;
      if (!cr.hunting) {
        cr.hunting = true;
        cr.lastRoarAt = t;
        Audio.roar();
        if (prey.id === G.localId) banner("何かがこちらに気づいた……！");
      }
    } else if (cr.hunting && t - cr.lastHeardAt > CREATURE_LOSE_MS) {
      cr.hunting = false;
      cr.targetId = -1;
    }

    let speed = CREATURE_ROAM_SPEED;
    if (cr.hunting) {
      speed = CREATURE_HUNT_SPEED;
      const tgt = G.soldiers.find((s) => s.id === cr.targetId && !s.dead);
      // 見えているなら現在地へ、見失っていたら最後の物音のほうへ
      if (tgt && (dist2(cr.x, cr.y, tgt.x, tgt.y) < CREATURE_SIGHT_R ** 2 || t - cr.lastHeardAt < 700)) {
        cr.wx = tgt.x; cr.wy = tgt.y;
      }
    } else if (t > cr.roamUntil) {
      // 当てもなくうろつく
      cr.roamUntil = t + rand(2500, 5000);
      cr.wx = clamp(cr.x + rand(-420, 420), 120, WORLD_W - 120);
      cr.wy = clamp(cr.y + rand(-420, 420), 120, WORLD_H - 120);
    }

    const dx = cr.wx - cr.x, dy = cr.wy - cr.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 6) {
      const desired = Math.atan2(dy, dx);
      cr.angle = angLerp(cr.angle, desired, clamp(dt * (cr.hunting ? 7 : 3), 0, 1));
      const ox = cr.x, oy = cr.y;
      moveCreature(cr, cr.x + Math.cos(cr.angle) * speed * dt, cr.y + Math.sin(cr.angle) * speed * dt);
      // 木に引っかかったら横滑りして回り込む
      if (cr.x === ox && cr.y === oy) {
        moveCreature(cr, cr.x - Math.sin(cr.angle) * speed * dt, cr.y + Math.cos(cr.angle) * speed * dt);
      }
    }

    // 接触したものは一撃で死ぬ。チームは問わない。
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0) continue;
      if (dist2(cr.x, cr.y, s.x, s.y) > (CREATURE_R + SOLDIER_R) ** 2) continue;
      cr.lungeAt = t;
      if (s.id === G.localId) { shake = Math.min(22, shake + 16); Audio.roar(); }
      s.killedByCreature = true;
      damageSoldier(s, 99999, null, { x: cr.x, y: cr.y, type: "creature", bypassEquipment: true });
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        addParticle(s.x, s.y, { kind: "blood", vx: Math.cos(a) * rand(60, 300), vy: Math.sin(a) * rand(60, 300), life: rand(400, 900), size: rand(2, 5) });
      }
    }
    for (const dog of G.dogs) {
      if (dog.dead) continue;
      if (dist2(cr.x, cr.y, dog.x, dog.y) > (CREATURE_R + DOG_R) ** 2) continue;
      cr.lungeAt = t;
      destroyDog(dog, null);
    }
  }

  function moveCreature(cr, nx, ny) {
    let x = cr.x, y = cr.y;
    let tx = clamp(nx, CREATURE_R, WORLD_W - CREATURE_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(tx, y, CREATURE_R, o.x, o.y, o.w, o.h))) tx = x;
    x = tx;
    let ty = clamp(ny, CREATURE_R, WORLD_H - CREATURE_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(x, ty, CREATURE_R, o.x, o.y, o.w, o.h))) ty = y;
    cr.x = x; cr.y = ty;
  }

  // 練習場: 射撃場を囲むように、中央を向いた銃座を3つ据える。
  function spawnTrainingTurrets() {
    for (let i = 0; i < 3; i++) {
      const p = ringPos(TRAINING_TURRET_R, i, 3, Math.PI / 3);
      G.turrets.push({
        kind: "turret", id: i, x: p.x, y: p.y, angle: p.a + Math.PI,
        hp: 260, maxHp: 260, dead: false, respawnAt: 0,
        gunnerId: -1, team: -1, lastShot: -99999, muzzle: 0, hitFlash: 0,
      });
    }
  }

  // 中立の機関銃座をマップ中央寄りに散らす。基地のすぐ前には置かない。
  function spawnTurrets() {
    G.turrets = [];
    if (isTraining()) { spawnTrainingTurrets(); return; }
    const count = 8;
    for (let id = 0; id < count; id++) {
      let placed = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        const x = rand(320, WORLD_W - 320), y = rand(280, WORLD_H - 280);
        if (G.bases.some((base) => dist2(x, y, base.x, base.y) < (base.r + 130) ** 2)) continue;
        if (G.obstacles.some((o) => isSolid(o) && circleRect(x, y, TURRET_R + 12, o.x, o.y, o.w, o.h))) continue;
        if (G.turrets.some((tr) => dist2(x, y, tr.x, tr.y) < 420 ** 2)) continue;
        placed = { x, y };
        break;
      }
      if (!placed) continue;
      // 初期の向きはマップ中央へ
      const angle = Math.atan2(WORLD_H / 2 - placed.y, WORLD_W / 2 - placed.x);
      G.turrets.push({
        kind: "turret", id, x: placed.x, y: placed.y, angle,
        hp: 260, maxHp: 260, dead: false, respawnAt: 0,
        gunnerId: -1, team: -1, lastShot: -99999, muzzle: 0, hitFlash: 0,
      });
    }
  }

  function spawnMedkits() {
    G.pickups = [];
    const kinds = [
      "medkit", "medkit", "medkit", "medkit", "medkit", "medkit", "medkit", "medkit",
      "armor", "armor", "armor", "armor", "armor", "armor",
      "shield", "shield", "shield", "shield",
    ];
    for (let id = 0; id < kinds.length; id++) {
      let placed = null;
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = rand(90, WORLD_W - 90), y = rand(90, WORLD_H - 90);
        const blocked = G.obstacles.some((o) => isSolid(o) && circleRect(x, y, 18, o.x, o.y, o.w, o.h)) ||
          G.tanks.some((tank) => dist2(x, y, tank.x, tank.y) < (TANK_R + 28) ** 2);
        const crowded = G.pickups.some((p) => dist2(x, y, p.x, p.y) < 130 ** 2);
        if (!blocked && !crowded) { placed = { x, y }; break; }
      }
      if (!placed) continue;
      G.pickups.push({ id, kind: kinds[id], x: placed.x, y: placed.y, active: true, respawnAt: 0, phase: Math.random() * Math.PI * 2 });
    }
  }

  // ============================================================
  //  当たり判定
  // ============================================================
  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function resolveMovement(s, nx, ny) {
    // 軸分離で押し戻し
    let x = s.x, y = s.y;
    // X
    let tx = nx;
    for (const o of G.obstacles) {
      if (isSolid(o) && circleRect(tx, y, SOLDIER_R, o.x, o.y, o.w, o.h)) { tx = x; break; }
    }
    for (const tank of G.tanks) {
      if (!tank.dead && tank.id !== s.vehicleId && dist2(tx, y, tank.x, tank.y) < (TANK_R + SOLDIER_R) ** 2) { tx = x; break; }
    }
    x = tx;
    let ty = ny;
    for (const o of G.obstacles) {
      if (isSolid(o) && circleRect(x, ty, SOLDIER_R, o.x, o.y, o.w, o.h)) { ty = y; break; }
    }
    for (const tank of G.tanks) {
      if (!tank.dead && tank.id !== s.vehicleId && dist2(x, ty, tank.x, tank.y) < (TANK_R + SOLDIER_R) ** 2) { ty = y; break; }
    }
    y = ty;
    s.x = clamp(x, SOLDIER_R, WORLD_W - SOLDIER_R);
    s.y = clamp(y, SOLDIER_R, WORLD_H - SOLDIER_R);
  }

  function resolveTankMovement(tank, nx, ny) {
    let x = tank.x, y = tank.y;
    let tx = clamp(nx, TANK_R, WORLD_W - TANK_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(tx, y, TANK_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((o) => o !== tank && !o.dead && dist2(tx, y, o.x, o.y) < (TANK_R * 2 + 4) ** 2)) tx = x;
    x = tx;
    let ty = clamp(ny, TANK_R, WORLD_H - TANK_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(x, ty, TANK_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((o) => o !== tank && !o.dead && dist2(x, ty, o.x, o.y) < (TANK_R * 2 + 4) ** 2)) ty = y;
    tank.x = x; tank.y = ty;
  }

  function resolveDogMovement(dog, nx, ny) {
    let x = dog.x, y = dog.y;
    let tx = clamp(nx, DOG_R, WORLD_W - DOG_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(tx, y, DOG_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((tank) => !tank.dead && dist2(tx, y, tank.x, tank.y) < (TANK_R + DOG_R) ** 2)) tx = x;
    x = tx;
    let ty = clamp(ny, DOG_R, WORLD_H - DOG_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(x, ty, DOG_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((tank) => !tank.dead && dist2(x, ty, tank.x, tank.y) < (TANK_R + DOG_R) ** 2)) ty = y;
    dog.x = x; dog.y = ty;
  }

  // 視線が遮蔽物で遮られていないか
  function lineClear(ax, ay, bx, by) {
    for (const o of G.obstacles) {
      if (!isOpaque(o)) continue;
      if (segRect(ax, ay, bx, by, o.x, o.y, o.w, o.h)) return false;
    }
    return true;
  }
  function segRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    // いずれかの辺と交差 or 始点が内部
    if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return true;
    return (
      segSeg(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
      segSeg(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) ||
      segSeg(x1, y1, x2, y2, rx + rw, ry + rh, rx, ry + rh) ||
      segSeg(x1, y1, x2, y2, rx, ry + rh, rx, ry)
    );
  }
  function segSeg(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (d === 0) return false;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  // ============================================================
  //  射撃 / ダメージ
  // ============================================================
  function tryShoot(s, t) {
    if (s.dead || s.reloading || s.shieldRaised || t < s.stunnedUntil) return;
    const w = WEAPONS[s.weapon];
    if (t - s.lastShot < w.interval) return;
    if (w.melee) { tryMelee(s, t, w); return; }
    if (s.ammo <= 0) { startReload(s, t); return; }
    s.lastShot = t;
    s.ammo--;
    s.recoil = Math.min(8, s.recoil + w.kick);
    s.muzzle = t;
    const mx = s.x + Math.cos(s.aimAngle) * (SOLDIER_R + 14);
    const my = s.y + Math.sin(s.aimAngle) * (SOLDIER_R + 14);
    for (let p = 0; p < w.pellets; p++) {
      const a = s.aimAngle + (Math.random() - 0.5) * w.spread * 2;
      if (G.bullets.length < MAX_BULLETS) {
        G.bullets.push({
          // ロケット弾は戦車砲と同じ「着弾して爆発する」弾種として扱う
          kind: w.rocket ? "shell" : "bullet",
          rocket: !!w.rocket,
          x: mx, y: my,
          vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
          dmg: w.dmg * s.dmgMul * (s.gunMul || 1), team: s.team, owner: s.id,
          range: w.range, traveled: 0, pierce: w.pierce || 0,
          col: w.key === "sniper" ? "#bfe6ff" : "#ffe49a",
          len: w.len,
        });
      }
    }
    // マズルフラッシュ & 薬莢
    addParticle(mx, my, { kind: "flash", life: 60, size: w.key === "shotgun" ? 16 : 11, a: s.aimAngle });
    const ca = s.aimAngle + Math.PI / 2 + rand(-0.3, 0.3);
    addParticle(s.x, s.y, { kind: "casing", vx: Math.cos(ca) * rand(40, 90), vy: Math.sin(ca) * rand(40, 90), life: 600, size: 2.2 });
    shake = Math.min(9, shake + (s.id === G.localId ? w.kick * 0.5 : 0));
    if (s.id === G.localId || dist2(s.x, s.y, camX + viewW() / 2, camY + viewH() / 2) < 700 * 700) Audio.shot(w.snd);
  }

  // 刀は足を止めて斬ると全方位の範囲攻撃(円月斬り)、走りながらだと通常の単体攻撃。
  // まとめて当たるぶん、範囲攻撃は1体あたりの威力を落としてある。
  const KATANA_SWEEP_RANGE_MUL = 1.35;
  const KATANA_SWEEP_DMG_MUL = 0.72;
  const SWEEP_GUARD_MS = 230;   // 薙ぎ払い中に銃弾を弾ける時間

  // 足を止めた薙ぎ払いの最中か。この間は刀が銃弾を弾く。
  const isSweeping = (s) => !!s.sweepAt && now() - s.sweepAt < SWEEP_GUARD_MS;

  function tryMelee(s, t, w) {
    s.lastShot = t;
    s.muzzle = t;
    s.recoil = Math.min(8, s.recoil + w.kick);
    const sweep = w.key === "katana" && !s.moving;
    s.sweepAt = sweep ? t : 0;   // 描画で刀を一回転させるかの判定に使う
    const arc = w.arc || 0.82;
    const range = sweep ? w.range * KATANA_SWEEP_RANGE_MUL : w.range;
    const dmg = w.dmg * s.dmgMul * (s.meleeMul || 1) * (sweep ? KATANA_SWEEP_DMG_MUL : 1);

    // 届く相手を集める。範囲攻撃は向きを問わず全方位。
    const hits = [];
    const consider = (target, reach) => {
      const d2v = dist2(s.x, s.y, target.x, target.y);
      if (d2v > (range + reach) ** 2 || !lineClear(s.x, s.y, target.x, target.y)) return;
      if (!sweep) {
        const a = Math.atan2(target.y - s.y, target.x - s.x);
        const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (gap >= arc) return;
      }
      hits.push({ target, d2v });
    };
    for (const enemy of G.soldiers) {
      if (!enemy.dead && enemy.vehicleId < 0 && enemy.team !== s.team) consider(enemy, 0);
    }
    for (const dog of G.dogs) {
      if (!dog.dead && dog.team !== s.team) consider(dog, 0);
    }
    for (const tank of G.tanks) {
      if (!tank.dead && tank.team !== s.team) consider(tank, TANK_R);
    }
    for (const beast of G.beasts) {
      if (!beast.dead) consider(beast, BEAST_R - SOLDIER_R);
    }
    for (const enemyBase of G.bases) {
      if (enemyBase.team !== s.team && enemyBase.hp > 0 && !enemyBase.hidden) consider(enemyBase, BASE_CORE_R);
    }
    // 範囲攻撃は届いた全員、通常攻撃は一番近い1体だけ
    let targets = [];
    if (sweep) {
      targets = hits.map((h) => h.target);
    } else if (hits.length) {
      let best = hits[0];
      for (const h of hits) if (h.d2v < best.d2v) best = h;
      targets = [best.target];
    }

    const sx = s.x + Math.cos(s.aimAngle) * 28, sy = s.y + Math.sin(s.aimAngle) * 28;
    if (sweep) addParticle(s.x, s.y, { kind: "slash", life: 210, size: range * 0.92, a: s.aimAngle, arc: Math.PI });
    else addParticle(sx, sy, { kind: "slash", life: 150, size: w.range * 0.44, a: s.aimAngle, arc });

    for (const target of targets) {
      if (target.kind === "base") {
        damageBase(target, dmg * 0.75, s, s.team);
        addParticle(sx, sy, { kind: "spark", vx: rand(-70, 70), vy: rand(-70, 70), life: 180, size: 3 });
      } else if (target.kind === "tank") {
        damageTank(target, 16 * s.dmgMul * (s.meleeMul || 1), s);
        addParticle(target.x, target.y, { kind: "spark", vx: rand(-70, 70), vy: rand(-70, 70), life: 180, size: 3 });
      } else if (target.kind === "dog") {
        damageDog(target, dmg, s);
        addParticle(target.x, target.y, { kind: "dust", vx: rand(-80, 80), vy: rand(-80, 80), life: 300, size: 3 });
      } else if (target.kind === "beast") {
        // 時の剣で叩けば一撃。ほかの近接武器は普通のダメージ。
        damageBeast(target, dmg, s, w.key === "timesword");
        addParticle(target.x, target.y, { kind: "spark", vx: rand(-90, 90), vy: rand(-90, 90), life: 220, size: 3.4 });
      } else {
        const result = damageSoldier(target, dmg, s, { x: s.x, y: s.y, type: "melee" });
        if (result !== "parried") {
          for (let i = 0; i < 6; i++) {
            addParticle(target.x, target.y, { kind: "blood", vx: rand(-110, 110), vy: rand(-110, 110), life: rand(220, 420), size: rand(1.5, 3.5) });
          }
        }
      }
    }
    if (s.id === G.localId || dist2(s.x, s.y, camX + viewW() / 2, camY + viewH() / 2) < 550 ** 2) Audio.melee();
  }

  // 戦車の武器。0 = 120mm主砲(爆発・対戦車)、1 = 同軸機関銃(連射・対歩兵)
  const TANK_WEAPONS = [
    { name: "120mm主砲", interval: 1450, dmg: 125, speed: 720, range: 900, spread: 0, shell: true, flash: 20, snd: "sniper" },
    { name: "同軸機関銃", interval: 85, dmg: 16, speed: 1250, range: 720, spread: 0.055, shell: false, flash: 10, snd: "smg" },
  ];

  function tryTankShoot(tank, t) {
    if (tank.dead) return;
    const w = TANK_WEAPONS[tank.weapon || 0];
    if (t - tank.lastShot < w.interval) return;
    tank.lastShot = t;
    tank.muzzle = t;
    const a = tank.turretAngle + (Math.random() - 0.5) * w.spread * 2;
    const mx = tank.x + Math.cos(a) * 48;
    const my = tank.y + Math.sin(a) * 48;
    const driver = G.soldiers.find((s) => s.id === tank.driverId) || null;
    G.bullets.push({
      kind: w.shell ? "shell" : "bullet", x: mx, y: my,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      dmg: w.dmg, team: tank.team, owner: driver ? driver.id : -1, tankOwner: tank.id,
      range: w.range, traveled: 0, pierce: 0, col: w.shell ? "#ffcf62" : "#ffe49a", len: w.shell ? 12 : 15,
    });
    addParticle(mx, my, { kind: "flash", life: w.shell ? 100 : 55, size: w.flash, a });
    if (driver && driver.id === G.localId) shake = Math.min(14, shake + (w.shell ? 8 : 1.2));
    if (dist2(tank.x, tank.y, camX + viewW() / 2, camY + viewH() / 2) < 850 * 850) Audio.shot(w.snd);
  }

  function tryThrowGrenade(s, t, angle) {
    if (s.dead || s.vehicleId >= 0 || s.shieldRaised || t < s.stunnedUntil || s.grenades <= 0 || t - s.lastGrenade < 650) return;
    s.grenades--;
    s.lastGrenade = t;
    const a = angle == null ? s.aimAngle : angle;
    G.grenades.push({
      x: s.x + Math.cos(a) * 20, y: s.y + Math.sin(a) * 20,
      vx: Math.cos(a) * 410, vy: Math.sin(a) * 410,
      team: s.team, owner: s.id, fuseAt: t + GRENADE_FUSE_MS,
      bornAt: t, rotation: 0,
    });
  }

  // 地雷は自分の足元に置く。設置後しばらくは作動しないので踏み逃げできる。
  function tryPlaceMine(s, t) {
    if (s.dead || s.vehicleId >= 0 || s.mines <= 0 || t - s.lastMine < MINE_PLACE_COOLDOWN) return;
    s.mines--;
    s.lastMine = t;
    G.mines.push({
      id: G.nextId++, x: s.x, y: s.y, team: s.team, owner: s.id,
      armAt: t + MINE_ARM_MS * (s.mineArmMul || 1), placedAt: t,
      blastMul: s.mineBlastMul || 1, stealthMul: s.mineStealthMul || 1,
    });
    for (let i = 0; i < 5; i++) {
      addParticle(s.x + rand(-8, 8), s.y + rand(-8, 8), {
        kind: "dust", vx: rand(-25, 25), vy: rand(-25, 25), life: rand(250, 420), size: rand(2, 4),
      });
    }
    if (s.id === G.localId) banner(`地雷を設置（残り ${s.mines}）`);
  }

  function explodeMine(m) {
    Audio.boom();
    const radius = MINE_BLAST_R * (m.blastMul || 1);
    createExplosionFx(m.x, m.y, 34);
    const attacker = G.soldiers.find((s) => s.id === m.owner) || null;
    if (dist2(m.x, m.y, camX + viewW() / 2, camY + viewH() / 2) < 900 ** 2) shake = Math.min(16, shake + 9);
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || s.team === m.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, m.x, m.y));
      if (d < radius) damageSoldier(s, MINE_DAMAGE * (1 - d / radius * 0.7), attacker, { x: m.x, y: m.y, type: "explosion" });
    }
    for (const dog of G.dogs) {
      if (dog.dead || dog.team === m.team) continue;
      const d = Math.sqrt(dist2(dog.x, dog.y, m.x, m.y));
      if (d < radius) damageDog(dog, MINE_DAMAGE * (1 - d / radius * 0.7), attacker);
    }
    for (const tank of G.tanks) {
      if (tank.dead || tank.team === m.team) continue;
      const d = Math.sqrt(dist2(tank.x, tank.y, m.x, m.y));
      // 地雷は対戦車兵器。車両には減衰なしで効く。
      if (d < radius + TANK_R) damageTank(tank, MINE_DAMAGE * 1.3, attacker);
    }
    damageBeastsInBlast(m.x, m.y, radius, MINE_DAMAGE, attacker);
    for (const o of G.obstacles) {
      if (o.type === "barrel" && dist2(o.x + o.w / 2, o.y + o.h / 2, m.x, m.y) < radius ** 2) o.hp = 0;
    }
  }

  // ---- 有刺鉄線 (罠師専用) ----
  // 踏んだ敵の足を止め、じわじわ削る。壊れないが数に限りがある。
  function tryPlaceWire(s, t) {
    if (s.dead || s.vehicleId >= 0 || (s.wires || 0) <= 0 || t - s.lastWire < WIRE_PLACE_COOLDOWN) return;
    s.wires--;
    s.lastWire = t;
    G.wires.push({ id: G.nextId++, x: s.x, y: s.y, team: s.team, owner: s.id, seed: Math.random() });
    if (s.id === G.localId) banner(`有刺鉄線を張った（残り ${s.wires}）`);
  }

  function updateWires(dt, t) {
    for (const s of G.soldiers) {
      s.snared = false;
      if (s.dead || s.vehicleId >= 0) continue;
      for (const wire of G.wires) {
        if (wire.team === s.team) continue;
        if (dist2(s.x, s.y, wire.x, wire.y) > WIRE_R ** 2) continue;
        s.snared = true;
        const owner = G.soldiers.find((o) => o.id === wire.owner) || null;
        damageSoldier(s, WIRE_DPS * dt, owner, { x: wire.x, y: wire.y, type: "explosion", bypassEquipment: true });
        break;
      }
    }
  }

  function updateMines(t) {
    for (let i = G.mines.length - 1; i >= 0; i--) {
      const m = G.mines[i];
      if (t < m.armAt) continue;
      let triggered = false;
      for (const s of G.soldiers) {
        if (s.dead || s.vehicleId >= 0 || s.team === m.team) continue;
        if (dist2(s.x, s.y, m.x, m.y) < MINE_TRIGGER_R ** 2) { triggered = true; break; }
      }
      if (!triggered) {
        for (const tank of G.tanks) {
          if (tank.dead || tank.team === m.team) continue;
          if (dist2(tank.x, tank.y, m.x, m.y) < (MINE_TRIGGER_R + TANK_R) ** 2) { triggered = true; break; }
        }
      }
      if (!triggered) {
        for (const dog of G.dogs) {
          if (dog.dead || dog.team === m.team) continue;
          if (dist2(dog.x, dog.y, m.x, m.y) < (MINE_TRIGGER_R + DOG_R) ** 2) { triggered = true; break; }
        }
      }
      if (triggered) {
        explodeMine(m);
        G.mines.splice(i, 1);
      }
    }
  }

  function startReload(s, t) {
    if (s.reloading || s.shieldRaised || t < s.stunnedUntil) return;
    const w = WEAPONS[s.weapon];
    if (w.melee) return;
    if (s.ammo >= w.mag) return;
    s.reloading = true;
    s.reloadUntil = t + w.reload;
  }

  function performParry(target, attacker, hit) {
    target.parryUntil = 0;
    target.parryCooldownUntil = Math.max(target.parryCooldownUntil, now() + 850 * (target.parryCooldownMul || 1));
    const px = target.x + Math.cos(target.aimAngle) * 22;
    const py = target.y + Math.sin(target.aimAngle) * 22;
    addParticle(px, py, { kind: "parry", life: 260, size: 27, a: target.aimAngle });
    Audio.parry();
    if (target.id === G.localId) { shake = Math.min(11, shake + 5); banner("PARRY!  攻撃を弾き返した"); noteStat("parries"); }
    if (hit.type === "melee" && attacker && attacker.kind !== "tank") {
      attacker.stunnedUntil = now() + 650;
      addParticle(attacker.x, attacker.y - 18, { kind: "stun", life: 650, size: 12, a: 0 });
      const a = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      if (attacker.kind === "dog") {
        resolveDogMovement(attacker, attacker.x + Math.cos(a) * 34, attacker.y + Math.sin(a) * 34);
        attacker.moving = false;
      } else {
        resolveMovement(attacker, attacker.x + Math.cos(a) * 28, attacker.y + Math.sin(a) * 28);
        attacker.shieldRaised = false;
        attacker.recoil = Math.max(attacker.recoil, 6);
      }
    }
  }

  let lastSweepGuardAudioAt = 0;

  function damageSoldier(target, dmg, attacker, hit) {
    if (target.dead) return;
    if (isDropping(target)) return "blocked";   // 降下中は無敵
    if (!hit) hit = attacker ? { x: attacker.x, y: attacker.y, type: "bullet" } : null;
    // 足を止めて刀を振り回している間は、飛んできた銃弾を刀で弾き返す
    if (hit && hit.type === "bullet" && isSweeping(target)) {
      const a = Math.atan2(target.y - hit.y, target.x - hit.x);
      addParticle(target.x - Math.cos(a) * 16, target.y - Math.sin(a) * 16, { kind: "parry", life: 200, size: 22, a });
      if (now() - lastSweepGuardAudioAt > 90) { lastSweepGuardAudioAt = now(); Audio.parry(); }
      return "parried";
    }
    if (hit && !hit.bypassEquipment) {
      if (target.shieldRaised && target.shield > 0) {
        const incoming = Math.atan2(hit.y - target.y, hit.x - target.x);
        const gap = Math.abs(((incoming - target.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (gap < 1.05) {
          if (target.parryUntil > 0 && now() <= target.parryUntil) {
            performParry(target, attacker, hit);
            return "parried";
          }
          const rate = hit.type === "explosion" ? 0.55 : hit.type === "melee" ? 0.78 : 0.9;
          const blocked = Math.min(target.shield, dmg * rate);
          target.shield -= blocked; dmg -= blocked;
          addParticle(target.x + Math.cos(target.aimAngle) * 20, target.y + Math.sin(target.aimAngle) * 20, {
            kind: "shieldHit", life: 190, size: 20, a: target.aimAngle,
          });
          if (target.shield <= 0) { target.shield = 0; target.shieldRaised = false; }
        }
      }
      if (target.armor > 0 && dmg > 0) {
        const rate = hit.type === "explosion" ? 0.34 : hit.type === "melee" ? 0.24 : 0.46;
        const absorbed = Math.min(target.armor, dmg * rate);
        target.armor -= absorbed; dmg -= absorbed;
        if (absorbed > 0) addParticle(target.x, target.y, { kind: "armorHit", life: 160, size: 15, a: 0 });
      }
    }
    // 銃座の防盾に守られている射手は被弾が軽い
    if (target.turretId >= 0) dmg *= TURRET_DAMAGE_TAKEN;
    if (dmg <= 0.01) { target.hitFlash = Math.max(target.hitFlash, 0.25); return "blocked"; }
    // 実績の集計で「何で倒したか」を見るために覚えておく
    target.lastHitType = hit && hit.type ? hit.type : "bullet";
    target.hp -= dmg;
    target.lastDamagedAt = now();
    target.hitFlash = 1;
    if (target.id === G.localId) { Audio.hurt(); shake = Math.min(12, shake + 3); }
    if (target.hp <= 0) killSoldier(target, attacker);
    return "hit";
  }

  function damageTank(target, dmg, attacker) {
    if (target.dead || (attacker && attacker.team === target.team)) return;
    target.hp -= dmg;
    if (target.hp <= 0) destroyTank(target, attacker);
  }

  function damageDog(target, dmg, attacker) {
    if (target.dead || (attacker && attacker.team === target.team)) return;
    target.hp -= dmg;
    target.hitFlash = 1;
    if (target.hp <= 0) destroyDog(target, attacker);
  }

  function damageBase(base, dmg, attacker, sourceTeam) {
    if (!base || G.over || base.hp <= 0 || base.hidden) return;
    const team = sourceTeam == null && attacker ? attacker.team : sourceTeam;
    if (!(team >= 0 && team < TEAM_COUNT)) return;
    if (team === base.team) return;
    base.hp = Math.max(0, base.hp - Math.max(0, dmg));
    base.hitFlash = 1;
    addParticle(base.x + rand(-42, 42), base.y + rand(-35, 35), {
      kind: "spark", vx: rand(-110, 110), vy: rand(-130, 40), life: rand(180, 360), size: rand(2, 5),
    });
    const stamp = now();
    if (base.team === localTeam() && stamp - (base.lastWarningAt || -99999) > 2200) {
      base.lastWarningAt = stamp;
      banner("警告：味方基地が攻撃されています！");
    }
    if (base.hp <= 0) destroyBase(base, team);
  }

  // 基地陥落 = その軍はもう復活できない。生き残りが倒されたら完全に脱落。
  function destroyBase(base, killerTeam) {
    if (G.over || base.destroyed) return;
    base.hp = 0;
    base.destroyed = true;
    Audio.boom();
    shake = Math.min(24, shake + 18);
    createExplosionFx(base.x, base.y, 70);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      createExplosionFx(base.x + Math.cos(a) * 55, base.y + Math.sin(a) * 42, 18);
    }
    if (killerTeam === localTeam()) noteStat("basesDestroyed");
    const survivors = G.soldiers.filter((s) => s.team === base.team && !s.dead).length;
    if (base.team === localTeam()) banner("味方基地が陥落！　もう復活できません。生き残れ！");
    else banner(`${G.armyNames[base.team]}の基地が陥落！　残存兵 ${survivors} 名`);
    checkVictory();
  }

  // 生き残っているのが1軍だけになったら決着。
  // 「参戦中」= 基地が健在(復活できる) or 兵士がまだ生きている。
  function teamInPlay(team) {
    if (teamAlive(team)) return true;
    return G.soldiers.some((s) => s.team === team && !s.dead);
  }

  function checkVictory() {
    // 練習場に勝敗は無い
    if (G.over || isTraining()) return;
    const inPlay = TEAMS.filter(teamInPlay);
    if (inPlay.length === 1) {
      endMatch(inPlay[0]);
    } else if (inPlay.length === 0) {
      // 相打ちで全滅した場合は撃破数が最も多い軍の勝ちとする
      let best = 0;
      for (const team of TEAMS) if (G.score[team] > G.score[best]) best = team;
      endMatch(best);
    }
  }

  function destroyDog(dog, attacker) {
    if (dog.dead) return;
    dog.dead = true; dog.hp = 0; dog.respawnAt = now() + DOG_RESPAWN_MS;
    for (let i = 0; i < 10; i++) {
      addParticle(dog.x, dog.y, { kind: "dust", vx: rand(-90, 90), vy: rand(-90, 90), life: rand(300, 650), size: rand(2, 5) });
    }
    if (attacker && attacker.team !== dog.team) {
      if (!attacker.kind) gainXp(attacker, 1);
      addKillfeed(attacker, { name: `軍用犬 ${dog.name}`, team: dog.team });
    }
  }

  function destroyTank(tank, attacker) {
    if (tank.dead) return;
    tank.dead = true;
    tank.hp = 0;
    tank.respawnAt = now() + TANK_RESPAWN_MS;
    Audio.boom();
    shake = Math.min(18, shake + 12);
    createExplosionFx(tank.x, tank.y, 38);
    addParticle(tank.x, tank.y, { kind: "stain", life: 12000, size: 34 });
    const driver = G.soldiers.find((s) => s.id === tank.driverId);
    tank.driverId = -1;
    if (driver) {
      driver.vehicleId = -1;
      driver.x = tank.x; driver.y = tank.y;
      damageSoldier(driver, driver.maxHp * 2, attacker, { bypassEquipment: true });
    }
    if (attacker && attacker.team !== tank.team) {
      if (attacker.kind !== "tank") gainXp(attacker, 2);
      addKillfeed(attacker, { name: tank.name, team: tank.team });
      if (attacker.id === G.localId && !attacker.kind) noteStat("tankKills");
    }
  }

  function killSoldier(target, attacker) {
    target.dead = true;
    target.hp = 0;
    target.deaths++;
    target.respawnAt = now() + (target.dummy ? DUMMY_RESPAWN_MS : RESPAWN_MS);
    if (target.dummy) {
      // 的は生き物ではないので血は出ない。光の柱で上へ転送されて消える。
      warpOutDummy(target);
    } else {
      // 血しぶき
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(30, 220);
        addParticle(target.x, target.y, { kind: "blood", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(400, 900), size: rand(2, 5) });
      }
      addParticle(target.x, target.y, { kind: "stain", life: 9000, size: rand(16, 24) });
    }
    if (target.id === G.localId) noteStat("deaths");
    if (attacker && attacker.team !== target.team && (attacker.kind || attacker.id !== target.id)) {
      attacker.kills++;
      G.score[attacker.team]++;
      if (!attacker.kind) gainXp(attacker, target.isHuman ? 2 : 1);
      addKillfeed(attacker, target);
      // 実績用: 自分が倒した分だけ、倒し方ごとに数える
      if (!attacker.kind && attacker.id === G.localId) {
        noteStat("kills");
        if (target.lastHitType === "melee") noteStat("meleeKills");
        else if (target.lastHitType === "explosion") noteStat("blastKills");
      }
    } else if (target.killedByCreature) {
      target.killedByCreature = false;
      addKillfeed({ name: "??????", team: -1 }, target);
    } else {
      addKillfeed(null, target);
    }
    // 基地を失った軍の兵士が倒されたら、その軍は脱落したかもしれない
    if (!teamAlive(target.team)) {
      if (!teamInPlay(target.team)) banner(`${G.armyNames[target.team]} 全滅！`);
      checkVictory();
    }
  }

  // 的の転送演出。青い光の柱が立ち、盤面が上へ吸い上げられて消える。
  const WARP_RISE = 150;          // 盤面が上へ運ばれる距離
  const WARP_MS = 620;
  const WARP_RGB = "86,168,255";       // 柱の色
  const WARP_CORE_RGB = "186,230,255"; // 芯と光の粒(白に近い水色)

  function warpOutDummy(target) {
    addParticle(target.x, target.y, { kind: "warpBeam", life: WARP_MS, size: DUMMY_R + 6 });
    addParticle(target.x, target.y, { kind: "warpDisc", life: WARP_MS, size: DUMMY_R });
    for (let i = 0; i < 3; i++) {
      addParticle(target.x, target.y, { kind: "warpRing", life: WARP_MS * 0.7, size: DUMMY_R, a: i * 0.22 });
    }
    for (let i = 0; i < 14; i++) {
      addParticle(target.x + rand(-DUMMY_R, DUMMY_R), target.y + rand(-DUMMY_R, DUMMY_R), {
        kind: "warpMote", life: rand(WARP_MS * 0.5, WARP_MS), size: rand(1.5, 3.4), a: rand(60, 190),
      });
    }
  }

  function gainXp(s, amount) {
    s.xp += amount;
    let need = s.level * 3;
    while (s.xp >= need && s.level < 20) {
      s.xp -= need;
      s.level++;
      s.maxHp += 12;
      s.hp = s.maxHp;
      s.armor = s.maxArmor;
      s.shield = s.maxShield;
      s.dmgMul += 0.07;
      s.speed += 2;
      need = s.level * 3;
      if (s.id === G.localId) {
        Audio.levelup();
        showLevelup(s.level);
      }
    }
  }

  function respawn(s) {
    const sp = s.dummy ? dummyPost(s) : teamSpawn(s.team);
    // 転送されて消えた的は、同じ光の柱で戻ってくる
    if (s.dummy) {
      addParticle(sp.x, sp.y, { kind: "warpBeam", life: 380, size: DUMMY_R + 6 });
      addParticle(sp.x, sp.y, { kind: "warpRing", life: 380, size: DUMMY_R, a: 0 });
    }
    s.x = sp.x; s.y = sp.y; s.rx = sp.x; s.ry = sp.y;
    s.hp = s.maxHp; s.dead = false; s.vx = 0; s.vy = 0;
    s.lastDamagedAt = -99999;
    s.armor = s.maxArmor; s.shield = s.maxShield; s.shieldRaised = false;
    s.parryUntil = 0; s.parryCooldownUntil = 0; s.stunnedUntil = 0;
    s.ammo = WEAPONS[s.weapon].mag; s.reloading = false;
    s.grenades = s.maxGrenades || 3; s.vehicleId = -1; s.turretId = -1;
    s.mines = s.maxMines || 2;
    s.wires = s.maxWires || 0;
    s.snared = false;
    s.ai.targetId = -1; s.ai.think = 0;
  }

  function respawnTank(tank) {
    tank.x = tank.spawnX; tank.y = tank.spawnY; tank.rx = tank.x; tank.ry = tank.y;
    tank.hp = tank.maxHp; tank.dead = false; tank.driverId = -1;
    tank.angle = BASE_SPOTS[tank.team].heading;
    tank.turretAngle = tank.angle; tank.ai.targetId = -1; tank.ai.think = 0;
  }

  function respawnDog(dog) {
    const base = G.bases[dog.team];
    dog.x = base.x + Math.cos(base.heading) * 75;
    dog.y = base.y + Math.sin(base.heading) * 75;
    dog.rx = dog.x; dog.ry = dog.y; dog.hp = dog.maxHp; dog.dead = false;
    dog.angle = base.heading; dog.lastAttack = -99999; dog.hitFlash = 0;
    dog.stunnedUntil = 0;
  }

  function addKillfeed(killer, victim) {
    G.killfeed.push({ killer: killer ? killer.name : null, killerTeam: killer ? killer.team : -1, victim: victim.name, victimTeam: victim.team, t: now() });
    if (G.killfeed.length > 6) G.killfeed.shift();
  }

  function explodeBarrel(o) {
    Audio.boom();
    shake = Math.min(16, shake + 10);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(60, 360);
      addParticle(o.x + o.w / 2, o.y + o.h / 2, { kind: i % 3 === 0 ? "spark" : "smoke", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(300, 900), size: rand(4, 12) });
    }
    addParticle(o.x + o.w / 2, o.y + o.h / 2, { kind: "boom", life: 260, size: 8 });
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, R = 120;
    for (const s of G.soldiers) {
      if (s.dead) continue;
      const dd = Math.sqrt(dist2(s.x, s.y, cx, cy));
      if (dd < R) damageSoldier(s, (1 - dd / R) * 90, null, { x: cx, y: cy, type: "explosion" });
    }
    // 連鎖
    for (const o2 of G.obstacles) {
      if (o2.type === "barrel" && o2.hp > 0 && o2 !== o) {
        if (dist2(o2.x, o2.y, cx, cy) < R * R) o2.hp = 0.0001;
      }
    }
  }

  function createExplosionFx(x, y, amount) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(70, 390);
      addParticle(x, y, {
        kind: i % 4 === 0 ? "spark" : "smoke",
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(320, 1000), size: rand(4, 13),
      });
    }
    addParticle(x, y, { kind: "boom", life: 280, size: 8 });
  }

  function projectileAttacker(b) {
    if (b.owner >= 0) return G.soldiers.find((s) => s.id === b.owner) || null;
    if (b.tankOwner != null) return G.tanks.find((tank) => tank.id === b.tankOwner) || null;
    return null;
  }

  function explodeProjectile(b) {
    Audio.boom();
    createExplosionFx(b.x, b.y, 28);
    const attacker = projectileAttacker(b);
    const radius = 118;
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || s.team === b.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, b.x, b.y));
      if (d < radius) damageSoldier(s, b.dmg * (1 - d / radius * 0.62), attacker, { x: b.x, y: b.y, type: "explosion" });
    }
    for (const dog of G.dogs) {
      if (dog.dead || dog.team === b.team) continue;
      const d = Math.sqrt(dist2(dog.x, dog.y, b.x, b.y));
      if (d < radius) damageDog(dog, b.dmg * (1 - d / radius * 0.62), attacker);
    }
    for (const tank of G.tanks) {
      if (tank.dead || tank.team === b.team) continue;
      const d = Math.sqrt(dist2(tank.x, tank.y, b.x, b.y));
      if (d < radius + TANK_R) damageTank(tank, b.dmg * 0.85 * (1 - clamp(d / (radius + TANK_R), 0, 0.8)), attacker);
    }
    for (const turret of G.turrets) {
      if (turret.dead || (turret.team >= 0 && turret.team === b.team)) continue;
      const d = Math.sqrt(dist2(turret.x, turret.y, b.x, b.y));
      if (d < radius + TURRET_R) damageTurret(turret, b.dmg * 0.7 * (1 - clamp(d / (radius + TURRET_R), 0, 0.8)), attacker);
    }
    for (const base of G.bases) {
      if (base.team === b.team || base.hp <= 0) continue;
      const d = Math.sqrt(dist2(base.x, base.y, b.x, b.y));
      if (d < radius + BASE_CORE_R) {
        damageBase(base, b.dmg * 0.9 * (1 - clamp(d / (radius + BASE_CORE_R), 0, 0.78)), attacker, b.team);
      }
    }
    damageBeastsInBlast(b.x, b.y, radius, b.dmg, attacker);
    for (const o of G.obstacles) {
      if (o.type === "barrel" && dist2(o.x + o.w / 2, o.y + o.h / 2, b.x, b.y) < radius * radius) o.hp = 0;
    }
  }

  function explodeGrenade(g) {
    Audio.boom();
    shake = Math.min(15, shake + 7);
    createExplosionFx(g.x, g.y, 32);
    const attacker = G.soldiers.find((s) => s.id === g.owner) || null;
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || s.team === g.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, g.x, g.y));
      if (d < GRENADE_RADIUS) damageSoldier(s, 130 * (1 - d / GRENADE_RADIUS * 0.72), attacker, { x: g.x, y: g.y, type: "explosion" });
    }
    for (const dog of G.dogs) {
      if (dog.dead || dog.team === g.team) continue;
      const d = Math.sqrt(dist2(dog.x, dog.y, g.x, g.y));
      if (d < GRENADE_RADIUS) damageDog(dog, 130 * (1 - d / GRENADE_RADIUS * 0.72), attacker);
    }
    for (const tank of G.tanks) {
      if (tank.dead || tank.team === g.team) continue;
      const d = Math.sqrt(dist2(tank.x, tank.y, g.x, g.y));
      if (d < GRENADE_RADIUS + TANK_R) damageTank(tank, 95 * (1 - clamp(d / (GRENADE_RADIUS + TANK_R), 0, 0.8)), attacker);
    }
    for (const turret of G.turrets) {
      if (turret.dead || (turret.team >= 0 && turret.team === g.team)) continue;
      const d = Math.sqrt(dist2(turret.x, turret.y, g.x, g.y));
      if (d < GRENADE_RADIUS + TURRET_R) damageTurret(turret, 85 * (1 - clamp(d / (GRENADE_RADIUS + TURRET_R), 0, 0.8)), attacker);
    }
    for (const base of G.bases) {
      if (base.team === g.team || base.hp <= 0) continue;
      const d = Math.sqrt(dist2(base.x, base.y, g.x, g.y));
      if (d < GRENADE_RADIUS + BASE_CORE_R) {
        damageBase(base, 115 * (1 - clamp(d / (GRENADE_RADIUS + BASE_CORE_R), 0, 0.78)), attacker, g.team);
      }
    }
    damageBeastsInBlast(g.x, g.y, GRENADE_RADIUS, 130, attacker);
    for (const o of G.obstacles) {
      if (o.type === "barrel" && dist2(o.x + o.w / 2, o.y + o.h / 2, g.x, g.y) < GRENADE_RADIUS ** 2) o.hp = 0;
    }
  }

  function updateGrenades(dt, t) {
    for (let i = G.grenades.length - 1; i >= 0; i--) {
      const g = G.grenades[i];
      if (t >= g.fuseAt) {
        explodeGrenade(g);
        G.grenades.splice(i, 1);
        continue;
      }
      const ox = g.x, oy = g.y;
      g.x += g.vx * dt;
      if (G.obstacles.some((o) => isSolid(o) && circleRect(g.x, g.y, 5, o.x, o.y, o.w, o.h))) { g.x = ox; g.vx *= -0.5; }
      g.y += g.vy * dt;
      if (G.obstacles.some((o) => isSolid(o) && circleRect(g.x, g.y, 5, o.x, o.y, o.w, o.h))) { g.y = oy; g.vy *= -0.5; }
      const drag = Math.pow(0.2, dt);
      g.vx *= drag; g.vy *= drag; g.rotation += Math.hypot(g.vx, g.vy) * dt * 0.08;
    }
  }

  function updateHealthRecovery(dt, t) {
    for (const s of G.soldiers) {
      if (s.dead || s.hp >= s.maxHp || t - s.lastDamagedAt < AUTO_HEAL_DELAY_MS) continue;
      s.hp = Math.min(s.maxHp, s.hp + AUTO_HEAL_PER_SEC * dt);
    }
  }

  function updateMedkits(t) {
    for (const kit of G.pickups) {
      if (!kit.active) {
        if (t >= kit.respawnAt) kit.active = true;
        else continue;
      }
      for (const s of G.soldiers) {
        if (s.dead || s.vehicleId >= 0) continue;
        const needed = kit.kind === "medkit" ? s.maxHp - s.hp : kit.kind === "armor" ? s.maxArmor - s.armor : s.maxShield - s.shield;
        if (needed < 1) continue;
        if (dist2(s.x, s.y, kit.x, kit.y) > 28 ** 2) continue;
        const amount = Math.min(kit.kind === "medkit" ? MEDKIT_HEAL : kit.kind === "armor" ? 55 : 80, needed);
        if (kit.kind === "medkit") s.hp += amount;
        else if (kit.kind === "armor") s.armor += amount;
        else s.shield += amount;
        kit.active = false;
        kit.respawnAt = t + (kit.kind === "medkit" ? 15000 : 18000);
        for (let i = 0; i < 9; i++) {
          addParticle(kit.x + rand(-10, 10), kit.y + rand(-8, 8), {
            kind: kit.kind === "medkit" ? "heal" : "equip", vx: rand(-18, 18), vy: rand(-55, -20),
            life: rand(450, 850), size: rand(3, 6), a: kit.kind === "armor" ? 0 : 1,
          });
        }
        if (s.id === G.localId) {
          Audio.heal();
          const label = kit.kind === "medkit" ? `救急キット +${Math.ceil(amount)} HP` : kit.kind === "armor" ? `防弾鎧 +${Math.ceil(amount)}` : `盾耐久 +${Math.ceil(amount)}`;
          banner(label);
        }
        break;
      }
    }
  }

  // ============================================================
  //  パーティクル
  // ============================================================
  const WARP_KINDS = { warpBeam: 1, warpDisc: 1, warpRing: 1, warpMote: 1 };

  function addParticle(x, y, opt) {
    if (G.particles.length >= MAX_PARTICLES && opt.kind !== "boom") return;
    G.particles.push({
      x, y, vx: opt.vx || 0, vy: opt.vy || 0,
      life: opt.life, maxLife: opt.life, size: opt.size || 3,
      kind: opt.kind, a: opt.a || 0, arc: opt.arc,
    });
  }

  function updateParticles(dt) {
    const ps = G.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt * 1000;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      // 転送エフェクトは経過時間だけで形を決めるので、速度も摩擦もかけない
      if (p.kind === "stain" || p.kind === "flash" || p.kind === "boom" || WARP_KINDS[p.kind]) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const fr = p.kind === "casing" ? 0.86 : 0.9;
      p.vx *= Math.pow(fr, dt * 60); p.vy *= Math.pow(fr, dt * 60);
    }
  }

  // ============================================================
  //  索敵 (AI が敵に気づく条件)
  //  ・壁の裏にいれば見つからない (視線が通っていることが必須)
  //  ・正面の視野角の外にいれば見つからない
  //  ・ただし至近距離だけは向きに関係なく気づく (真横をすり抜けられないように)
  // ============================================================
  const AI_SIGHT_R = 470;       // 昼夜倍率をかける前の索敵距離
  const AI_FOV = 1.15;          // 正面から左右 ±約66°
  const AI_AWARE_R = 105;       // この距離まで近づくと向き無関係で気づく

  function angleGap(from, to) {
    return Math.abs(((to - from + Math.PI) % (Math.PI * 2)) - Math.PI);
  }

  // 目視。fov に null を渡すと全方位(軍用犬など)。
  function canSee(watcher, target, sightR, fov) {
    const d2 = dist2(watcher.x, watcher.y, target.x, target.y);
    if (d2 > sightR * sightR) return false;
    if (!lineClear(watcher.x, watcher.y, target.x, target.y)) return false;
    if (d2 < AI_AWARE_R * AI_AWARE_R) return true;
    if (fov == null) return true;
    const a = Math.atan2(target.y - watcher.y, target.x - watcher.x);
    return angleGap(watcher.aimAngle == null ? watcher.angle : watcher.aimAngle, a) < fov;
  }

  // 足音。向きは問わないが、壁が音を遮る。
  function canHear(watcher, target, bonus) {
    if (!target.moving) return false;
    const r = (target.noiseRadius || 390) + (bonus || 0);
    const d2 = dist2(watcher.x, watcher.y, target.x, target.y);
    if (d2 > r * r) return false;
    return lineClear(watcher.x, watcher.y, target.x, target.y);
  }

  // ============================================================
  //  AI
  // ============================================================
  function updateAI(s, t, dt) {
    const a = s.ai;
    const D = DIFF[difficulty];

    // 銃座に取り付いている間は撃つだけ。敵を見失って少し経ったら離れる。
    if (s.turretId >= 0) {
      const turret = G.turrets.find((x) => x.id === s.turretId && !x.dead);
      if (!turret) { s.turretId = -1; }
      else {
        const target = a.targetId >= 0 ? G.soldiers.find((x) => x.id === a.targetId && !x.dead) : null;
        if (target && canSee(s, target, TURRET_GUN.range, null)) {
          a.lastSeen = t;
          const aim = Math.atan2(target.y - s.y, target.x - s.x);
          turret.angle = angLerp(turret.angle, aim, clamp(dt * 7, 0, 1));
          s.aimAngle = turret.angle;
          if (angleGap(turret.angle, aim) < 0.12 && Math.random() < D.fireChance) tryTurretShoot(turret, t);
          return;
        }
        // 索敵しなおす
        if (t > a.think) {
          a.think = t + rand(150, 300);
          let best = -1, bestD = Infinity;
          for (const e of G.soldiers) {
            if (e.dead || e.team === s.team) continue;
            const d2 = dist2(s.x, s.y, e.x, e.y);
            if (d2 < bestD && canSee(s, e, TURRET_GUN.range, null)) { bestD = d2; best = e.id; }
          }
          if (best >= 0) { a.targetId = best; a.lastSeen = t; }
        }
        if (t - a.lastSeen > 5000) { dismountTurret(s); a.targetId = -1; }
        return;
      }
    }
    if (t > a.think) {
      a.think = t + rand(120, 240);
      // 壁の裏 or 視野角の外なら気づかれない。足音も壁で遮られる。
      const sight = AI_SIGHT_R * daylightVisionMul();
      let best = -1, bestD = Infinity;
      for (const e of G.soldiers) {
        if (e.dead || e.team === s.team) continue;
        const d2 = dist2(s.x, s.y, e.x, e.y);
        if (d2 >= bestD) continue;
        if (canSee(s, e, sight, AI_FOV) || canHear(s, e)) { bestD = d2; best = e.id; }
      }
      if (best >= 0) { a.targetId = best; a.lastSeen = t; }
      else if (t - a.lastSeen > 1400) a.targetId = -1;

      // ターゲット無し → 一番近い敵基地へ進軍
      if (a.targetId < 0) {
        const objective = nearestEnemyBase(s.x, s.y, s.team);
        if (objective) {
          a.wx = objective.x + rand(-45, 45);
          a.wy = objective.y + rand(-45, 45);
        }
      }
      if (t > a.strafeUntil) { a.strafe = Math.random() < 0.5 ? 1 : -1; a.strafeUntil = t + rand(500, 1100); }
    }

    const w = WEAPONS[s.weapon];
    const soldierTarget = a.targetId >= 0 ? G.soldiers.find((x) => x.id === a.targetId) : null;
    const baseTarget = nearestEnemyBase(s.x, s.y, s.team);
    const target = soldierTarget && !soldierTarget.dead ? soldierTarget : baseTarget;
    const targetIsBase = !!target && target.kind === "base";
    let mvx = 0, mvy = 0;
    let desiredAim = s.aimAngle;

    if (target) {
      const dx = target.x - s.x, dy = target.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      desiredAim = Math.atan2(dy, dx);
      const pref = targetIsBase ? Math.max(BASE_CORE_R + 38, w.range * 0.62) : w.range * 0.62;
      // 距離維持 + ストレイフ
      let radial = 0;
      if (d > pref * 1.15) radial = 1;
      else if (!targetIsBase && d < pref * 0.6) radial = -1;
      const perpx = -dy / d, perpy = dx / d;
      const strafePower = targetIsBase ? 0.18 : 0.8;
      mvx = (dx / d) * radial + perpx * a.strafe * strafePower;
      mvy = (dy / d) * radial + perpy * a.strafe * strafePower;
      // 射撃判定
      const vis = lineClear(s.x, s.y, target.x, target.y);
      const wantsShield = !targetIsBase && s.shield > 0 && vis && d < 430 && t >= s.stunnedUntil && (Math.floor(t / 950) % 4 === 0);
      if (wantsShield && !s.shieldRaised && t >= s.parryCooldownUntil) {
        s.parryUntil = t + 220; s.parryCooldownUntil = t + 1000;
      }
      s.shieldRaised = wantsShield;
      const aimGap = Math.abs(((desiredAim - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (vis && d < w.range + (targetIsBase ? BASE_CORE_R : 0) && aimGap < 0.22 && Math.random() < D.fireChance) {
        // エイムにブレを加える
        const err = (Math.random() - 0.5) * D.aimErr * 2;
        const sav = s.aimAngle;
        s.aimAngle = desiredAim + err;
        tryShoot(s, t);
        s.aimAngle = sav;
      }
      if (vis && d > 130 && d < 430 + (targetIsBase ? BASE_CORE_R : 0) && s.grenades > 0 && t - s.lastGrenade > 6500 && Math.random() < 0.008) {
        tryThrowGrenade(s, t, desiredAim);
      }
      if (s.ammo <= 0) startReload(s, t);
      // 近くに空いている銃座があれば取り付いて撃つ
      if (s.vehicleId < 0 && !targetIsBase && t - (a.turretTry || 0) > 2500) {
        a.turretTry = t;
        for (const turret of G.turrets) {
          if (turret.dead || turret.gunnerId >= 0) continue;
          if (dist2(s.x, s.y, turret.x, turret.y) > 130 ** 2) continue;
          turret.gunnerId = s.id; turret.team = s.team; s.turretId = turret.id;
          s.x = turret.x - Math.cos(turret.angle) * 16;
          s.y = turret.y - Math.sin(turret.angle) * 16;
          a.lastSeen = t;
          return;
        }
      }
    } else {
      s.shieldRaised = false;
      const dx = a.wx - s.x, dy = a.wy - s.y;
      const d = Math.hypot(dx, dy) || 1;
      mvx = dx / d; mvy = dy / d;
      if (d < 60) { mvx = 0; mvy = 0; }
      if (Math.hypot(mvx, mvy) > 0.05) desiredAim = Math.atan2(mvy, mvx);
      // 敵が見えていないときだけ、進路に地雷を仕掛ける
      if (s.mines > 0 && t - s.lastMine > 9000 && Math.random() < 0.004) tryPlaceMine(s, t);
    }

    // 障害物回避(前方に壁があれば横へ)
    const probe = 40;
    const px = s.x + mvx * probe, py = s.y + mvy * probe;
    for (const o of G.obstacles) {
      if (isSolid(o) && circleRect(px, py, SOLDIER_R + 4, o.x, o.y, o.w, o.h)) {
        const tmp = mvx; mvx = -mvy * a.strafe; mvy = tmp * a.strafe;
        break;
      }
    }

    s.aimAngle = angLerp(s.aimAngle, desiredAim, clamp(dt * 9, 0, 1));
    applyMove(s, mvx, mvy, dt, false);
  }

  function applyMove(s, mvx, mvy, dt, dash) {
    if (now() < s.stunnedUntil) { s.moving = false; s.noiseRadius = 0; return; }
    const m = Math.hypot(mvx, mvy);
    s.moving = m > 0.05;
    s.noiseRadius = s.moving ? (dash ? 680 : 430) : 0;
    if (m > 1) { mvx /= m; mvy /= m; }
    const sp = s.speed * (dash ? 1.55 : 1) * (s.shieldRaised ? 0.62 : 1) * (s.snared ? WIRE_SLOW : 1);
    const nx = s.x + mvx * sp * dt;
    const ny = s.y + mvy * sp * dt;
    resolveMovement(s, nx, ny);
    if (s.moving) s.legPhase += dt * 12;
  }

  // ---- 機関銃座 ----
  function tryTurretShoot(turret, t) {
    if (turret.dead || t - turret.lastShot < TURRET_GUN.interval) return;
    turret.lastShot = t;
    turret.muzzle = t;
    const a = turret.angle + (Math.random() - 0.5) * TURRET_GUN.spread * 2;
    const mx = turret.x + Math.cos(a) * 34;
    const my = turret.y + Math.sin(a) * 34;
    G.bullets.push({
      kind: "bullet", x: mx, y: my,
      vx: Math.cos(a) * TURRET_GUN.speed, vy: Math.sin(a) * TURRET_GUN.speed,
      dmg: TURRET_GUN.dmg, team: turret.team, owner: turret.gunnerId,
      range: TURRET_GUN.range, traveled: 0, pierce: 0, col: "#ffe0a0", len: 18,
    });
    addParticle(mx, my, { kind: "flash", life: 55, size: 12, a });
    if (turret.gunnerId === G.localId) shake = Math.min(9, shake + 1.1);
    if (dist2(turret.x, turret.y, camX + viewW() / 2, camY + viewH() / 2) < 700 ** 2) Audio.shot("rifle");
  }

  function dismountTurret(s) {
    const turret = G.turrets.find((x) => x.id === s.turretId);
    if (turret) { turret.gunnerId = -1; turret.team = -1; }
    s.turretId = -1;
  }

  function damageTurret(turret, dmg, attacker) {
    if (turret.dead) return;
    // 味方が使っている銃座は撃てない
    if (attacker && turret.team >= 0 && attacker.team === turret.team) return;
    turret.hp -= dmg;
    turret.hitFlash = 1;
    if (turret.hp <= 0) destroyTurret(turret, attacker);
  }

  function destroyTurret(turret, attacker) {
    if (turret.dead) return;
    turret.dead = true;
    turret.hp = 0;
    turret.respawnAt = now() + TURRET_RESPAWN_MS;
    Audio.boom();
    createExplosionFx(turret.x, turret.y, 22);
    const gunner = G.soldiers.find((s) => s.id === turret.gunnerId);
    turret.gunnerId = -1;
    turret.team = -1;
    if (gunner) {
      gunner.turretId = -1;
      damageSoldier(gunner, 55, attacker, { x: turret.x, y: turret.y, type: "explosion" });
    }
  }

  function updateTurrets(dt, t) {
    for (const turret of G.turrets) {
      if (turret.hitFlash > 0) turret.hitFlash = Math.max(0, turret.hitFlash - dt * 4);
      if (turret.dead) {
        if (t >= turret.respawnAt) {
          turret.dead = false; turret.hp = turret.maxHp; turret.gunnerId = -1; turret.team = -1;
        }
        continue;
      }
      // 射手が死んだ / 離れたら銃座を解放する
      const gunner = G.soldiers.find((s) => s.id === turret.gunnerId);
      if (turret.gunnerId >= 0 && (!gunner || gunner.dead || gunner.turretId !== turret.id)) {
        if (gunner) gunner.turretId = -1;
        turret.gunnerId = -1;
        turret.team = -1;
      }
    }
  }

  // E キーは戦車と銃座の両方に使う。近いほうへ乗り降りする。
  function enterOrExitTank(s) {
    if (s.turretId >= 0) { dismountTurret(s); return; }
    if (s.vehicleId < 0) {
      let nearestTurret = null, bestTurret = TURRET_MOUNT_R * TURRET_MOUNT_R;
      for (const turret of G.turrets) {
        if (turret.dead || turret.gunnerId >= 0) continue;
        const d = dist2(s.x, s.y, turret.x, turret.y);
        if (d < bestTurret) { bestTurret = d; nearestTurret = turret; }
      }
      // 戦車が同じくらい近ければ戦車を優先する
      const nearTank = G.tanks.some((tank) => !tank.dead && tank.team === s.team && tank.driverId < 0 && dist2(s.x, s.y, tank.x, tank.y) < 78 * 78);
      if (nearestTurret && !nearTank) {
        nearestTurret.gunnerId = s.id;
        nearestTurret.team = s.team;
        s.turretId = nearestTurret.id;
        s.x = nearestTurret.x - Math.cos(nearestTurret.angle) * 16;
        s.y = nearestTurret.y - Math.sin(nearestTurret.angle) * 16;
        s.moving = false;
        return;
      }
    }
    if (s.vehicleId >= 0) {
      const tank = G.tanks.find((x) => x.id === s.vehicleId);
      if (tank) {
        tank.driverId = -1;
        const candidates = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
        let placed = false;
        for (const offset of candidates) {
          const a = tank.angle + offset;
          const x = tank.x + Math.cos(a) * (TANK_R + SOLDIER_R + 8);
          const y = tank.y + Math.sin(a) * (TANK_R + SOLDIER_R + 8);
          const blocked = G.obstacles.some((o) => isSolid(o) && circleRect(x, y, SOLDIER_R, o.x, o.y, o.w, o.h)) ||
            G.tanks.some((o) => o !== tank && !o.dead && dist2(x, y, o.x, o.y) < (TANK_R + SOLDIER_R) ** 2);
          if (!blocked) { s.x = x; s.y = y; placed = true; break; }
        }
        if (!placed) { s.x = tank.x; s.y = tank.y; }
      }
      s.vehicleId = -1;
      return;
    }
    let nearest = null, best = 78 * 78;
    for (const tank of G.tanks) {
      if (tank.dead || tank.team !== s.team || tank.driverId >= 0) continue;
      const d = dist2(s.x, s.y, tank.x, tank.y);
      if (d < best) { best = d; nearest = tank; }
    }
    if (nearest) {
      nearest.driverId = s.id;
      s.vehicleId = nearest.id;
      s.x = nearest.x; s.y = nearest.y; s.moving = false;
    }
  }

  function applyTankInput(tank, s, inp, t) {
    s.shieldRaised = false;
    // 乗車中の武器切替は主砲 / 機関銃の2択
    if (inp.weaponWanted != null && inp.weaponWanted >= 0) {
      tank.weapon = tank.weapon ? 0 : 1;
    }
    tank.turretAngle = inp.aimAngle != null ? inp.aimAngle : tank.turretAngle;
    const m = Math.hypot(inp.mvx, inp.mvy);
    if (m > 0.05) {
      const moveAngle = Math.atan2(inp.mvy, inp.mvx);
      tank.angle = angLerp(tank.angle, moveAngle, clamp(dtGlobal * 4.5, 0, 1));
      resolveTankMovement(tank, tank.x + inp.mvx * tank.speed * dtGlobal, tank.y + inp.mvy * tank.speed * dtGlobal);
    }
    if (inp.shoot) tryTankShoot(tank, t);
    inp.reloadEdge = false;
    inp.grenadeEdge = false;
    inp.mineEdge = false;
    inp.wireEdge = false;
    inp.parryEdge = false;
    inp.weaponWanted = -1;
    s.x = tank.x; s.y = tank.y; s.aimAngle = tank.turretAngle; s.moving = m > 0.05;
  }

  function updateTanks(dt, t) {
    for (const tank of G.tanks) {
      if (tank.dead) {
        if (t >= tank.respawnAt && teamAlive(tank.team)) respawnTank(tank);
        continue;
      }
      const driver = G.soldiers.find((s) => s.id === tank.driverId && !s.dead);
      if (driver) {
        driver.x = tank.x; driver.y = tank.y; driver.aimAngle = tank.turretAngle;
        continue;
      }
      if (tank.driverId >= 0) tank.driverId = -1;
      // 練習場では無人の戦車は動かない。的を勝手に壊さず、基地の前で乗り手を待つ。
      if (isTraining()) continue;

      let target = nearestEnemyBase(tank.x, tank.y, tank.team);
      let best = target ? dist2(tank.x, tank.y, target.x, target.y) : Infinity;
      // 兵士・犬は視線が通っているときだけ捕捉する(壁の裏は狙われない)
      const tankSight = 880 * daylightVisionMul();
      for (const s of G.soldiers) {
        if (s.dead || s.vehicleId >= 0 || s.team === tank.team) continue;
        const d = dist2(tank.x, tank.y, s.x, s.y);
        if (d < best && canSee(tank, s, tankSight, null)) { best = d; target = s; }
      }
      for (const dog of G.dogs) {
        if (dog.dead || dog.team === tank.team) continue;
        const d = dist2(tank.x, tank.y, dog.x, dog.y);
        if (d < best && canSee(tank, dog, tankSight, null)) { best = d; target = dog; }
      }
      for (const other of G.tanks) {
        if (other.dead || other.team === tank.team) continue;
        const d = dist2(tank.x, tank.y, other.x, other.y);
        if (d < best) { best = d; target = other; }
      }
      if (!target) continue;
      const dx = target.x - tank.x, dy = target.y - tank.y;
      const d = Math.hypot(dx, dy) || 1;
      const aim = Math.atan2(dy, dx);
      tank.turretAngle = angLerp(tank.turretAngle, aim, clamp(dt * 2.7, 0, 1));
      if (d > (target.kind === "base" ? 420 : 360)) {
        tank.angle = angLerp(tank.angle, aim, clamp(dt * 2.2, 0, 1));
        resolveTankMovement(tank, tank.x + Math.cos(tank.angle) * tank.speed * 0.7 * dt, tank.y + Math.sin(tank.angle) * tank.speed * 0.7 * dt);
      }
      // 相手が装甲なら主砲、生身の歩兵や犬なら機関銃に持ち替える
      const armored = target.kind === "tank" || target.kind === "base";
      tank.weapon = armored ? 0 : 1;
      const aimGap = Math.abs(((aim - tank.turretAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      const gapNeeded = tank.weapon === 0 ? 0.09 : 0.2;
      if (d < 880 + (target.kind === "base" ? BASE_CORE_R : 0) && aimGap < gapNeeded && lineClear(tank.x, tank.y, target.x, target.y)) tryTankShoot(tank, t);
    }
  }

  function updateDogs(dt, t) {
    for (const dog of G.dogs) {
      if (dog.dead) {
        if (t >= dog.respawnAt && teamAlive(dog.team)) respawnDog(dog);
        continue;
      }
      if (dog.hitFlash > 0) dog.hitFlash = Math.max(0, dog.hitFlash - dt * 5);
      if (t < dog.stunnedUntil) { dog.moving = false; continue; }
      let handler = G.soldiers.find((s) => s.id === dog.handlerId && !s.dead);
      if (!handler) {
        handler = G.soldiers.find((s) => s.team === dog.team && !s.dead) || null;
        if (handler) dog.handlerId = handler.id;
      }

      // 犬は全方位を見る(視野角の制限なし)が、壁の裏までは分からない
      const dogSight = 430 * daylightVisionMul();
      let target = null, best = Infinity;
      for (const enemy of G.soldiers) {
        // 練習用の的は犬に襲わせない(プレイヤーの練習を邪魔しないため)
        if (enemy.dead || enemy.dummy || enemy.vehicleId >= 0 || enemy.team === dog.team) continue;
        const d2v = dist2(dog.x, dog.y, enemy.x, enemy.y);
        if (d2v >= best) continue;
        if (canSee(dog, enemy, dogSight, null) || canHear(dog, enemy, 130)) { best = d2v; target = enemy; }
      }
      for (const enemyDog of G.dogs) {
        if (enemyDog === dog || enemyDog.dead || enemyDog.team === dog.team) continue;
        const d2v = dist2(dog.x, dog.y, enemyDog.x, enemyDog.y);
        if (d2v < best && canSee(dog, enemyDog, 330 * daylightVisionMul(), null)) { best = d2v; target = enemyDog; }
      }
      if (!target) {
        const enemyBase = nearestEnemyBase(dog.x, dog.y, dog.team);
        if (enemyBase &&
            (dist2(dog.x, dog.y, enemyBase.x, enemyBase.y) < 390 ** 2 ||
             (handler && dist2(handler.x, handler.y, enemyBase.x, enemyBase.y) < 430 ** 2))) {
          target = enemyBase;
        }
      }

      let dx = 0, dy = 0, desired = dog.angle;
      if (target) {
        dx = target.x - dog.x; dy = target.y - dog.y;
        const d = Math.hypot(dx, dy) || 1;
        desired = Math.atan2(dy, dx);
        const targetR = target.kind === "base" ? BASE_CORE_R : target.kind === "dog" ? DOG_R : SOLDIER_R;
        if (d > DOG_R + targetR + 7) { dx /= d; dy /= d; }
        else {
          dx = 0; dy = 0;
          if (t - dog.lastAttack >= 650) {
            dog.lastAttack = t; dog.biteAt = t;
            if (target.kind === "base") {
              damageBase(target, dog.damage * 0.55, dog, dog.team);
              addParticle(target.x + rand(-35, 35), target.y + rand(-30, 30), { kind: "spark", life: 170, size: 3, a: desired });
            } else if (target.kind === "dog") {
              damageDog(target, dog.damage, dog);
              addParticle(target.x, target.y, { kind: "bite", life: 170, size: 18, a: desired });
            } else {
              const result = damageSoldier(target, dog.damage, dog, { x: dog.x, y: dog.y, type: "melee" });
              if (result !== "parried") addParticle(target.x, target.y, { kind: "bite", life: 170, size: 18, a: desired });
            }
          }
        }
      } else if (handler) {
        dx = handler.x - dog.x; dy = handler.y - dog.y;
        const d = Math.hypot(dx, dy) || 1;
        desired = Math.atan2(dy, dx);
        if (d > 72) { dx /= d; dy /= d; } else { dx = 0; dy = 0; }
      }

      dog.angle = angLerp(dog.angle, desired, clamp(dt * 9, 0, 1));
      dog.moving = Math.hypot(dx, dy) > 0.05;
      if (dog.moving) {
        const ox = dog.x, oy = dog.y;
        resolveDogMovement(dog, dog.x + dx * dog.speed * dt, dog.y + dy * dog.speed * dt);
        if (dog.x === ox && dog.y === oy) {
          resolveDogMovement(dog, dog.x - dy * dog.speed * dt, dog.y + dx * dog.speed * dt);
        }
      }
    }
  }

  // 陥落した基地は補給・回復の機能を失う
  function inFriendlyBase(entity) {
    const base = G.bases[entity.team];
    return !!base && base.hp > 0 && dist2(entity.x, entity.y, base.x, base.y) < base.r ** 2;
  }

  function updateBases(dt, t) {
    for (const base of G.bases) {
      if (base.hitFlash > 0) base.hitFlash = Math.max(0, base.hitFlash - dt * 4.5);
    }
    for (const s of G.soldiers) {
      if (s.dead || !inFriendlyBase(s)) continue;
      if (s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + BASE_HEAL_PER_SEC * dt);
      if (s.armor < s.maxArmor) s.armor = Math.min(s.maxArmor, s.armor + 18 * dt);
      if (s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + 24 * dt);
      const w = WEAPONS[s.weapon];
      const maxGrenades = s.maxGrenades || 3;
      const maxMines = s.maxMines || 2;
      const maxWires = s.maxWires || 0;
      const needsSupply = (!w.melee && s.ammo < w.mag) || s.grenades < maxGrenades || s.mines < maxMines || s.wires < maxWires;
      if (needsSupply && t - s.lastBaseSupplyAt >= 3000) {
        if (!w.melee) s.ammo = w.mag;
        s.grenades = maxGrenades; s.mines = maxMines; s.wires = maxWires; s.reloading = false; s.lastBaseSupplyAt = t;
        if (s.id === G.localId) { Audio.heal(); banner("基地で弾薬・グレネード・地雷を補給"); }
      }
    }
    for (const dog of G.dogs) {
      if (!dog.dead && inFriendlyBase(dog) && dog.hp < dog.maxHp) dog.hp = Math.min(dog.maxHp, dog.hp + BASE_HEAL_PER_SEC * dt);
    }
    for (const tank of G.tanks) {
      if (!tank.dead && inFriendlyBase(tank) && tank.hp < tank.maxHp) tank.hp = Math.min(tank.maxHp, tank.hp + BASE_REPAIR_PER_SEC * dt);
    }
  }

  let lastFootstepAudioAt = 0;
  function updateFootsteps(dt, t) {
    for (let i = G.soundPings.length - 1; i >= 0; i--) {
      const ping = G.soundPings[i];
      ping.life -= dt * 1000;
      if (ping.life <= 0) G.soundPings.splice(i, 1);
    }
    const me = localSoldier();
    if (!me || me.dead) return;
    for (const enemy of G.soldiers) {
      if (enemy.dead || enemy.dummy || enemy.vehicleId >= 0 || enemy.team === me.team || !enemy.moving) continue;
      if (isDropping(enemy)) continue;
      const loud = enemy.noiseRadius || 430;
      const interval = loud > 500 ? 280 : 440;
      if (t - (enemy.lastFootstepAt || -99999) < interval) continue;
      enemy.lastFootstepAt = t;
      const d2v = dist2(me.x, me.y, enemy.x, enemy.y);
      if (d2v > loud ** 2) continue;
      enemy.heardUntil = t + 1050;
      G.soundPings.push({ x: enemy.x, y: enemy.y, team: enemy.team, life: 1050, maxLife: 1050, loud });
      if (G.soundPings.length > 20) G.soundPings.shift();
      if (t - lastFootstepAudioAt > 170) {
        lastFootstepAudioAt = t;
        Audio.footstep(1 - Math.sqrt(d2v) / loud * 0.7);
      }
    }
  }

  // ============================================================
  //  シミュレーション (host / sp)
  // ============================================================
  function simulate(dt, t) {
    updateDayCycle(dt);
    // ローカルプレイヤー入力反映
    const me = localSoldier();
    if (me && !me.dead) {
      applyLocalToSoldier(me, localInput, t);
    }
    // 各クライアントの入力反映 (host)
    if (mode === "host") {
      for (const s of G.soldiers) {
        if (s.controller && s.controller !== "cpu" && s.controller !== "local" && !s.dead) {
          const inp = Net.clientInputs[s.controller];
          if (inp) applyLocalToSoldier(s, inp, t);
        }
      }
    }
    updateDrops(t);
    // AI
    for (const s of G.soldiers) {
      if (s.dead) continue;
      if (s.dummy) { updateDummy(s, dt); continue; }
      if (isDropping(s)) { s.moving = false; s.noiseRadius = 0; continue; }
      const human = s.controller === "local" || (s.controller && s.controller !== "cpu");
      if (!human) updateAI(s, t, dt);
    }
    updateTanks(dt, t);
    updateTurrets(dt, t);
    updateCreature(dt, t);
    updateBeasts(dt, t);
    updateSwordRock(dt);
    updateDogs(dt, t);
    updateFootsteps(dt, t);
    // リロード完了
    for (const s of G.soldiers) {
      if (s.reloading && t >= s.reloadUntil) {
        s.reloading = false;
        s.ammo = WEAPONS[s.weapon].mag;
      }
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 4);
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 26);
      // 基地を失った軍は復活できない(サバイバル形式)。的だけは基地と無関係に立て直る。
      if (s.dead && t >= s.respawnAt && (s.dummy || teamAlive(s.team))) respawn(s);
    }
    // 弾
    updateBullets(dt);
    updateGrenades(dt, t);
    updateMines(t);
    updateWires(dt, t);
    updateHealthRecovery(dt, t);
    updateMedkits(t);
    updateBases(dt, t);
    // バレル爆発処理
    for (let i = G.obstacles.length - 1; i >= 0; i--) {
      const o = G.obstacles[i];
      if (o.type === "barrel" && o.hp <= 0) {
        explodeBarrel(o);
        G.obstacles.splice(i, 1);
      }
    }
    updateParticles(dt);
    updateTraining(dt, t);
    // 実績の判定は毎フレームやる必要がないので、少し間引く
    if (t - lastAchievementCheck > 600) { lastAchievementCheck = t; checkAchievements(); }
  }

  let lastAchievementCheck = 0;

  // 銃座に取り付いている間は動けない。照準と射撃だけ。
  function applyTurretInput(turret, s, inp, t) {
    turret.angle = inp.aimAngle != null ? inp.aimAngle : turret.angle;
    s.aimAngle = turret.angle;
    s.x = turret.x - Math.cos(turret.angle) * 16;
    s.y = turret.y - Math.sin(turret.angle) * 16;
    s.moving = false;
    s.shieldRaised = false;
    if (inp.shoot) tryTurretShoot(turret, t);
    inp.reloadEdge = false;
    inp.grenadeEdge = false;
    inp.parryEdge = false;
    inp.mineEdge = false;
    inp.wireEdge = false;
    inp.weaponWanted = -1;
  }

  function applyLocalToSoldier(s, inp, t) {
    // 降下中は攻撃も乗り込みもできない。傘で流されるぶんだけ動かせる。
    if (isDropping(s)) {
      s.aimAngle = inp.aimAngle != null ? inp.aimAngle : s.aimAngle;
      applyMove(s, inp.mvx * DROP_DRIFT_MUL, inp.mvy * DROP_DRIFT_MUL, dtGlobal, false);
      s.noiseRadius = 0;
      s.shieldRaised = false;
      inp.reloadEdge = false; inp.grenadeEdge = false; inp.interactEdge = false;
      inp.parryEdge = false; inp.mineEdge = false; inp.wireEdge = false;
      inp.weaponWanted = -1;
      return;
    }
    if (inp.interactEdge) { enterOrExitTank(s); inp.interactEdge = false; }
    if (s.turretId >= 0) {
      const turret = G.turrets.find((x) => x.id === s.turretId && !x.dead);
      if (turret) { applyTurretInput(turret, s, inp, t); return; }
      s.turretId = -1;
    }
    if (s.vehicleId >= 0) {
      const tank = G.tanks.find((x) => x.id === s.vehicleId && !x.dead);
      if (tank) { applyTankInput(tank, s, inp, t); return; }
      s.vehicleId = -1;
    }
    if (inp.parryEdge) {
      if (s.shield > 0 && t >= s.parryCooldownUntil && t >= s.stunnedUntil) {
        s.parryUntil = t + 240 * (s.parryWindowMul || 1);
        s.parryCooldownUntil = t + 950 * (s.parryCooldownMul || 1);
      }
      inp.parryEdge = false;
    }
    s.shieldRaised = !!inp.shield && s.shield > 0 && t >= s.stunnedUntil;
    if (s.shieldRaised) s.reloading = false;
    // 武器変更
    if (inp.weaponWanted != null && inp.weaponWanted >= 0 && inp.weaponWanted !== s.weapon) {
      // 兵科の装備に無い武器は選べない
      if (s.loadout && s.loadout.indexOf(inp.weaponWanted) >= 0) {
        const oldWeapon = WEAPONS[s.weapon];
        s.weapon = inp.weaponWanted;
        const newWeapon = WEAPONS[s.weapon];
        if (newWeapon.melee) s.ammo = 1;
        else if (oldWeapon.melee) s.ammo = newWeapon.mag;
        else s.ammo = Math.min(s.ammo, newWeapon.mag);
        if (s.ammo <= 0) s.ammo = WEAPONS[s.weapon].mag;
        s.reloading = false;
      }
      inp.weaponWanted = -1;
    }
    s.aimAngle = inp.aimAngle != null ? inp.aimAngle : Math.atan2(inp.aimy, inp.aimx);
    if (inp.reloadEdge) { startReload(s, t); inp.reloadEdge = false; }
    if (inp.grenadeEdge) { tryThrowGrenade(s, t); inp.grenadeEdge = false; }
    if (inp.mineEdge) { tryPlaceMine(s, t); inp.mineEdge = false; }
    if (inp.wireEdge) { tryPlaceWire(s, t); inp.wireEdge = false; }
    if (inp.shoot) tryShoot(s, t);
    applyMove(s, inp.mvx, inp.mvy, dtGlobal, inp.dash && !s.shieldRaised);
  }

  let dtGlobal = 0;

  function updateBullets(dt) {
    const bs = G.bullets;
    // 時の剣の持ち主のまわりでは、飛んできた弾が時間を止めたように遅くなる
    const holder = swordHolder();
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      let speedMul = 1;
      if (holder && b.owner !== holder.id && dist2(b.x, b.y, holder.x, holder.y) < TIME_FIELD_R ** 2) {
        speedMul = TIME_SLOW_MUL;
        b.slowed = true;
      } else {
        b.slowed = false;
      }
      const stepX = b.vx * dt * speedMul, stepY = b.vy * dt * speedMul;
      b.x += stepX; b.y += stepY;
      b.traveled += Math.hypot(stepX, stepY);
      let dead = false;
      if (b.traveled > b.range || b.x < 0 || b.y < 0 || b.x > WORLD_W || b.y > WORLD_H) {
        if (b.kind === "shell" && b.x >= 0 && b.y >= 0 && b.x <= WORLD_W && b.y <= WORLD_H) explodeProjectile(b);
        dead = true;
      }
      if (!dead) {
        // 障害物 (茂みや対戦車バリケードは弾が抜ける)
        for (const o of G.obstacles) {
          if (!stopsBullets(o)) continue;
          if (b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y && b.y <= o.y + o.h) {
            if (o.type === "barrel") { o.hp -= b.dmg; }
            if (b.kind === "shell") explodeProjectile(b);
            else addParticle(b.x, b.y, { kind: "spark", vx: -b.vx * 0.05 + rand(-30, 30), vy: -b.vy * 0.05 + rand(-30, 30), life: 160, size: 2.4 });
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 敵基地の司令区画
        for (const base of G.bases) {
          if (base.team === b.team || base.hp <= 0) continue;
          if (dist2(b.x, b.y, base.x, base.y) < BASE_CORE_R ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageBase(base, b.dmg * 0.72, attacker, b.team);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-90, 90), vy: rand(-90, 90), life: 220, size: 3.2 });
            }
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        // 戦車
        for (const tank of G.tanks) {
          if (tank.dead || tank.team === b.team) continue;
          if (dist2(b.x, b.y, tank.x, tank.y) < (TANK_R + 4) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageTank(tank, b.dmg * 0.55, attacker);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-80, 80), vy: rand(-80, 80), life: 220, size: 3.2 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 機関銃座 (中立のものは誰の弾でも当たる)
        for (const turret of G.turrets) {
          if (turret.dead || (turret.team >= 0 && turret.team === b.team)) continue;
          if (dist2(b.x, b.y, turret.x, turret.y) < (TURRET_R + 3) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageTurret(turret, b.dmg * 0.8, attacker);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-80, 80), vy: rand(-80, 80), life: 200, size: 3 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 軍用犬
        for (const dog of G.dogs) {
          if (dog.dead || dog.team === b.team) continue;
          if (dist2(b.x, b.y, dog.x, dog.y) < (DOG_R + 3) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageDog(dog, b.dmg, attacker);
              addParticle(b.x, b.y, { kind: "dust", vx: rand(-80, 80), vy: rand(-80, 80), life: 230, size: 3 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 魔物 (時の森)。銃も効くが硬いので、削り切るには撃ち込む必要がある。
        for (const beast of G.beasts) {
          if (beast.dead) continue;
          if (dist2(b.x, b.y, beast.x, beast.y) < (BEAST_R + 3) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageBeast(beast, b.dmg, attacker, false);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-80, 80), vy: rand(-80, 80), life: 220, size: 3 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 兵士
        for (const s of G.soldiers) {
          if (s.dead || s.vehicleId >= 0 || s.team === b.team || s.id === b.owner) continue;
          if (dist2(b.x, b.y, s.x, s.y) < (SOLDIER_R + 2) * (SOLDIER_R + 2)) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") {
              explodeProjectile(b);
            } else {
              const result = damageSoldier(s, b.dmg, attacker, { x: b.x - b.vx * 0.04, y: b.y - b.vy * 0.04, type: "bullet" });
              if (result === "parried") {
                b.vx *= -1; b.vy *= -1; b.team = s.team; b.owner = s.id; b.tankOwner = null;
                b.dmg *= 0.85; b.pierce = 0; b.traveled = 0; b.range = Math.min(b.range, 760);
                b.x += b.vx * 0.018; b.y += b.vy * 0.018;
              } else {
                for (let k = 0; k < 5; k++) {
                  const a = Math.atan2(b.vy, b.vx) + rand(-0.7, 0.7);
                  addParticle(b.x, b.y, { kind: "blood", vx: Math.cos(a) * rand(40, 160), vy: Math.sin(a) * rand(40, 160), life: rand(250, 550), size: rand(1.5, 3.5) });
                }
                if (b.pierce > 0) { b.pierce--; b.dmg *= 0.7; }
                else { dead = true; }
              }
            }
            if (b.kind === "shell") dead = true;
            break;
          }
        }
      }
      if (dead) bs.splice(i, 1);
    }
  }

  // ============================================================
  //  レンダリング
  // ============================================================
  let dpr = 1;
  function viewW() { return canvas.clientWidth; }
  function viewH() { return canvas.clientHeight; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  window.addEventListener("resize", resize);

  // 観戦中は生き残っている誰かを追う。数秒ごとに切り替えて戦況が見えるようにする。
  function spectateTarget() {
    const t = now();
    let target = G.soldiers.find((s) => s.id === spectateTargetId && !s.dead);
    if (!target || t > spectateSwitchAt) {
      const alive = G.soldiers.filter((s) => !s.dead);
      if (alive.length) {
        // 撃破数が多い兵士ほど戦況の中心にいる
        const lead = alive.reduce((a, b) => (b.kills > a.kills ? b : a), alive[0]);
        target = lead;
        spectateTargetId = lead.id;
        spectateSwitchAt = t + 4000;
      }
    }
    return target;
  }

  function updateCamera() {
    const me = spectating ? spectateTarget() : localSoldier();
    let tx, ty;
    if (me) { tx = me.x - viewW() / 2; ty = me.y - viewH() / 2; }
    else { tx = WORLD_W / 2 - viewW() / 2; ty = WORLD_H / 2 - viewH() / 2; }
    camX = clamp(tx, 0, Math.max(0, WORLD_W - viewW()));
    camY = clamp(ty, 0, Math.max(0, WORLD_H - viewH()));
  }

  function render() {
    const vw = viewW(), vh = viewH();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 背景
    ctx.fillStyle = stageDef().backdrop || "#3a4a26";
    ctx.fillRect(0, 0, vw, vh);

    let sx = 0, sy = 0;
    if (shake > 0.2) { sx = rand(-shake, shake); sy = rand(-shake, shake); }
    ctx.save();
    ctx.translate(-camX + sx, -camY + sy);

    drawGround(vw, vh);
    drawBases();
    // 影 → 車両 → 兵士 → 投擲物/弾 → パーティクル
    drawStains();
    drawObstaclesBack();
    drawTimeField();
    drawSwordRock();
    drawWires();
    drawMines();
    drawPickups();
    for (const turret of G.turrets) if (!turret.dead && isEntityVisible(turret)) drawTurretShadow(turret);
    for (const tank of G.tanks) if (!tank.dead && isEntityVisible(tank)) drawTankShadow(tank);
    for (const dog of G.dogs) if (!dog.dead && isEntityVisible(dog)) drawDogShadow(dog);
    for (const s of G.soldiers) if (!s.dead && s.vehicleId < 0 && isEntityVisible(s)) drawSoldierShadow(s);
    drawParticlesUnder();
    for (const turret of G.turrets) if (!turret.dead && isEntityVisible(turret)) drawTurret(turret);
    for (const tank of G.tanks) if (!tank.dead && isEntityVisible(tank)) drawTank(tank);
    for (const dog of G.dogs) if (!dog.dead && isEntityVisible(dog)) drawDog(dog);
    for (const beast of G.beasts) if (!beast.dead && isEntityVisible(beast)) drawBeast(beast);
    for (const s of G.soldiers) if (!s.dead && s.vehicleId < 0 && isEntityVisible(s)) (s.dummy ? drawDummy(s) : drawSoldier(s));
    if (G.creature && creatureVisible()) drawCreature(G.creature);
    drawObstaclesOver();
    drawParachutes();
    drawGrenades();
    drawBullets();
    drawParticlesOver();
    drawFootstepPings();
    drawNameTags();
    drawDropPlanes();

    ctx.restore();

    if (shake > 0) shake = Math.max(0, shake - 0.6);
    drawNightTint(vw, vh);
    drawHuntedWarning(vw, vh);
    drawVisionMask(vw, vh);
    drawFootstepIndicators(vw, vh);
    drawMinimap();
    updateHUD();
  }

  function drawGround(vw, vh) {
    // タイル状の地面テクスチャ(カメラ範囲のみ)
    const TS = 64;
    const x0 = Math.floor(camX / TS) * TS, y0 = Math.floor(camY / TS) * TS;
    for (let x = x0; x < camX + vw + TS; x += TS) {
      for (let y = y0; y < camY + vh + TS; y += TS) {
        const k = ((x / TS) * 7 + (y / TS) * 13) % 5;
        const pal = stageDef().ground;
        ctx.fillStyle = k < 2 ? pal[0] : k < 4 ? pal[1] : pal[2];
        ctx.fillRect(x, y, TS, TS);
      }
    }
    // 4隅のスポーンゾーンをチーム色で薄く塗る(白と灰色だけのステージでは白)
    const mono = isMonochrome();
    for (const base of G.bases) {
      if (base.hidden) continue;
      const def = teamDef(base.team);
      const alpha = base.hp > 0 ? 0.06 : 0.02;
      ctx.fillStyle = mono ? `rgba(255,255,255,${alpha * 2})` : hexToRgba(def.flag, alpha);
      ctx.fillRect(base.x - 200, base.y - 190, 400, 380);
    }
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function drawBases() {
    for (const base of G.bases) {
      if (base.hidden) continue;
      const def = teamDef(base.team);
      const fallen = base.hp <= 0;
      ctx.save();
      ctx.globalAlpha = fallen ? 0.45 : 1;
      ctx.translate(base.x, base.y);
      ctx.fillStyle = def.baseFill;
      ctx.strokeStyle = def.baseStroke;
      ctx.lineWidth = 4; ctx.setLineDash([15, 10]);
      ctx.beginPath(); ctx.arc(0, 0, base.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      // 司令区画と補給パッド
      ctx.rotate(base.heading);
      ctx.fillStyle = base.hitFlash > 0 ? "#fff0bd" : fallen ? "#3a3a33" : def.coreDark;
      ctx.fillRect(-72, -48, 110, 96);
      ctx.fillStyle = base.hitFlash > 0 ? "#ffc26f" : fallen ? "#54544a" : def.coreLight;
      ctx.beginPath(); ctx.moveTo(-78, -53); ctx.lineTo(44, -53); ctx.lineTo(58, 0); ctx.lineTo(44, 53); ctx.lineTo(-78, 53); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = "rgba(15,20,14,0.7)"; ctx.fillRect(-58, -19, 34, 38);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = fallen ? 0.55 : 1;
      // 軍旗(陥落時は半旗)
      const flagTop = fallen ? base.y - 48 : base.y - 88;
      ctx.strokeStyle = "#d5d2b0"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(base.x + 55, base.y - 18); ctx.lineTo(base.x + 55, base.y - 88); ctx.stroke();
      ctx.fillStyle = fallen ? "#5d5d52" : def.flag;
      ctx.beginPath(); ctx.moveTo(base.x + 57, flagTop + 2); ctx.lineTo(base.x + 112, flagTop + 15); ctx.lineTo(base.x + 57, flagTop + 32); ctx.closePath(); ctx.fill();
      ctx.font = "bold 14px -apple-system, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.75)";
      const label = fallen ? `${G.armyNames[base.team]} 基地 陥落` : `${G.armyNames[base.team]} 基地`;
      ctx.strokeText(label, base.x, base.y + base.r - 18);
      ctx.fillStyle = fallen ? "#b6b6a8" : def.text;
      ctx.fillText(label, base.x, base.y + base.r - 18);
      const bw = 164, bh = 9, by = base.y + base.r - 4;
      const ratio = clamp(base.hp / base.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.72)"; ctx.fillRect(base.x - bw / 2 - 2, by - 2, bw + 4, bh + 4);
      ctx.fillStyle = def.flag; ctx.fillRect(base.x - bw / 2, by, bw * ratio, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.strokeRect(base.x - bw / 2, by, bw, bh);
      ctx.font = "bold 9px -apple-system, sans-serif"; ctx.fillStyle = "#fff";
      ctx.fillText(`${Math.ceil(base.hp)} / ${base.maxHp}`, base.x, by + 5);
      ctx.restore();
    }
  }

  // 朝のあいだは夜明けの光で戦場全体が見渡せる。視界制限が完全に外れる。
  function fullVisionNow() {
    return dayPhase().key === "morning";
  }

  function currentVisionRadius() {
    if (fullVisionNow()) return WORLD_W + WORLD_H;
    const me = localSoldier();
    const shortSide = Math.min(viewW(), viewH());
    // 画面サイズで頭打ちにしたうえで、時間帯の倍率をかける
    const base = me && me.vehicleId >= 0
      ? Math.min(TANK_VISION_R, Math.max(300, shortSide * 0.78))
      : Math.min(PLAYER_VISION_R, Math.max(210, shortSide * 0.6));
    return base * daylightVisionMul();
  }

  function isEntityVisible(entity) {
    if (spectating) return true;   // 観戦中は全部見える
    if (entity.dummy) return true; // 練習用の的は敵ではないので常に見える
    if (fullVisionNow()) return true;
    const me = localSoldier();
    if (!me || entity.team === me.team) return true;
    const bonus = entity.kind === "tank" ? 65 : 0;
    const r = currentVisionRadius() + bonus;
    return dist2(me.x, me.y, entity.x, entity.y) < r ** 2 && lineClear(me.x, me.y, entity.x, entity.y);
  }

  // クリーチャーは視界の中にいるときだけ描く。姿が見えないほうが怖い。
  function creatureVisible() {
    const cr = G.creature;
    if (!cr) return false;
    if (spectating) return true;
    const me = localSoldier();
    if (!me) return false;
    const r = currentVisionRadius() + 40;
    return dist2(me.x, me.y, cr.x, cr.y) < r * r && lineClear(me.x, me.y, cr.x, cr.y);
  }

  function drawStains() {
    for (const p of G.particles) {
      if (p.kind !== "stain") continue;
      const a = clamp(p.life / p.maxLife, 0, 1) * 0.5;
      ctx.fillStyle = isMonochrome() ? `rgba(118,118,118,${a})` : `rgba(110,12,12,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.283);
      ctx.fill();
    }
  }

  // 木と茂みは兵士より手前に描く。茂みに入った兵士が隠れて見えるようにするため。
  const OVERHEAD_TYPES = { tree: 1, bush: 1 };

  function drawObstaclesBack() {
    for (const o of G.obstacles) {
      if (!OVERHEAD_TYPES[o.type]) drawObstacle(o);
    }
  }

  function drawObstaclesOver() {
    for (const o of G.obstacles) {
      if (OVERHEAD_TYPES[o.type]) drawObstacle(o);
    }
  }

  function drawPickups() {
    const t = now() * 0.003;
    for (const kit of G.pickups) {
      if (!kit.active) continue;
      const bob = Math.sin(t + kit.phase) * 2;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(kit.x + 2, kit.y + 8, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(kit.x, kit.y + bob);
      if (kit.kind === "medkit") {
        ctx.fillStyle = "#d9ead9"; ctx.strokeStyle = "#2b6638"; ctx.lineWidth = 2;
        ctx.fillRect(-14, -11, 28, 22); ctx.strokeRect(-14, -11, 28, 22);
        ctx.fillStyle = "#39a957"; ctx.fillRect(-3, -8, 6, 16); ctx.fillRect(-8, -3, 16, 6);
      } else if (kit.kind === "armor") {
        ctx.fillStyle = "#376fa6"; ctx.strokeStyle = "#a8d4ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-3, -8); ctx.lineTo(3, -8); ctx.lineTo(12, -12);
        ctx.lineTo(14, 9); ctx.lineTo(5, 13); ctx.lineTo(-5, 13); ctx.lineTo(-14, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(-2, -7, 4, 17);
      } else {
        ctx.fillStyle = "#45bfc4"; ctx.strokeStyle = "#c9fff8"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(13, -8); ctx.lineTo(10, 8); ctx.quadraticCurveTo(0, 17, -10, 8); ctx.lineTo(-13, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillRect(-2, -9, 4, 17);
      }
      ctx.restore();
    }
  }

  // 白と灰色だけのステージ用に、色を明るさだけの灰色へ置き換える。
  // ctx.filter でのグレースケール化は毎フレーム重すぎたので、色を先に変換して使う。
  const grayCache = new Map();
  function toGray(color) {
    const hit = grayCache.get(color);
    if (hit) return hit;
    let r = 0, g = 0, b = 0, a = 1;
    if (color[0] === "#") {
      const hex = color.slice(1);
      const n = parseInt(hex.slice(0, 6), 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
      if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
    } else {
      const parts = (color.match(/[\d.]+/g) || []).map(Number);
      r = parts[0] || 0; g = parts[1] || 0; b = parts[2] || 0;
      if (parts.length > 3) a = parts[3];
    }
    const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const out = `rgba(${l},${l},${l},${a})`;
    grayCache.set(color, out);
    return out;
  }
  const keepColor = (c) => c;

  function drawObstacle(o) {
    // C() を通した色だけが、白と灰色だけのステージで灰色に置き換わる
    const C = isMonochrome() ? toGray : keepColor;
    if (o.type === "wall") {
      ctx.fillStyle = C("#4a4640");
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(o.x, o.y + o.h - 6, o.w, 6);
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    } else if (o.type === "crate") {
      ctx.fillStyle = C("#8a5a2b"); ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = C("#5e3c1c"); ctx.lineWidth = 3;
      ctx.strokeRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4);
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y + o.h);
      ctx.moveTo(o.x + o.w, o.y); ctx.lineTo(o.x, o.y + o.h); ctx.stroke();
    } else if (o.type === "sandbag") {
      const n = Math.max(2, Math.round(o.w / 24));
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = C(i % 2 ? "#7a754d" : "#67623f");
        ctx.beginPath();
        ctx.ellipse(o.x + (i + 0.5) * (o.w / n), o.y + o.h / 2, o.w / n / 2 + 1, o.h / 2, 0, 0, 6.283);
        ctx.fill();
      }
    } else if (o.type === "rock") {
      ctx.fillStyle = C("#6b6f72");
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h * 0.62, o.w / 2.4, o.h / 3, 0, 0, 6.283);
      ctx.fill();
    } else if (o.type === "barrel") {
      ctx.fillStyle = C("#b03a2e");
      ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, (o.r || 15), 0, 6.283); ctx.fill();
      ctx.strokeStyle = C("#2c2c2c"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, (o.r || 15) - 4, 0, 6.283); ctx.stroke();
      ctx.fillStyle = C("#ffd23f"); ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("⚠", o.x + o.w / 2, o.y + o.h / 2 + 1);
    } else if (o.type === "ruin") {
      // 崩れかけたコンクリート壁。上辺をギザギザにして瓦礫感を出す。
      const seg = Math.max(3, Math.round(o.w / 18));
      ctx.fillStyle = C("#5d5951");
      for (let i = 0; i < seg; i++) {
        const sw = o.w / seg;
        const drop = ((Math.sin((o.seed || 0) * 40 + i * 2.3) + 1) / 2) * o.h * 0.4;
        ctx.fillRect(o.x + i * sw, o.y + drop, sw + 0.5, o.h - drop);
      }
      ctx.fillStyle = "rgba(0,0,0,0.24)"; ctx.fillRect(o.x, o.y + o.h - 5, o.w, 5);
      ctx.strokeStyle = "rgba(30,28,25,0.5)"; ctx.lineWidth = 1;
      ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    } else if (o.type === "tree") {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath(); ctx.ellipse(cx + 4, cy + 6, r, r * 0.82, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = C("#5a4029");
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.28, 0, 6.283); ctx.fill();
      // 葉は3枚重ねて厚みを出す
      const leaves = ["#2f5127", "#3a6330", "#46753a"];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = C(leaves[i]);
        ctx.beginPath();
        ctx.arc(cx - i * 2, cy - i * 3, r * (1 - i * 0.18), 0, 6.283);
        ctx.fill();
      }
    } else if (o.type === "bush") {
      // 通り抜けられるが視線は通らない = 伏兵に使える
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const blobs = 5;
      for (let i = 0; i < blobs; i++) {
        const a = i * Math.PI * 2 / blobs + (o.seed || 0) * 6;
        ctx.fillStyle = C(i % 2 ? "rgba(52,92,44,0.86)" : "rgba(63,108,52,0.86)");
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * o.w * 0.2, cy + Math.sin(a) * o.h * 0.2, o.w * 0.34, o.h * 0.34, a, 0, 6.283);
        ctx.fill();
      }
      ctx.fillStyle = C("rgba(126,176,102,0.35)");
      ctx.beginPath(); ctx.ellipse(cx - o.w * 0.1, cy - o.h * 0.12, o.w * 0.2, o.h * 0.16, 0, 0, 6.283); ctx.fill();
    } else if (o.type === "wreck") {
      // 焼け落ちた車両
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(((o.seed || 0) - 0.5) * 0.7);
      ctx.fillStyle = C("#3b3630");
      ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
      ctx.fillStyle = C("#57504533"); ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h * 0.3);
      ctx.fillStyle = C("#26221e");
      ctx.fillRect(-o.w * 0.18, -o.h * 0.34, o.w * 0.4, o.h * 0.68);
      ctx.fillStyle = C("#6b4a2c");
      ctx.fillRect(-o.w / 2 + 3, -o.h / 2 - 3, o.w * 0.3, 4);
      ctx.fillStyle = C("#181513");
      ctx.beginPath(); ctx.arc(-o.w * 0.28, -o.h / 2, 6, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(o.w * 0.3, o.h / 2, 6, 0, 6.283); ctx.fill();
      ctx.restore();
    } else if (o.type === "tires") {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      for (let i = 2; i >= 0; i--) {
        const r = o.w / 2 - i * 3;
        ctx.fillStyle = C(i === 0 ? "#33322f" : "#232220");
        ctx.beginPath(); ctx.arc(cx - i * 2, cy - i * 3, r, 0, 6.283); ctx.fill();
        ctx.fillStyle = C("#4a4844");
        ctx.beginPath(); ctx.arc(cx - i * 2, cy - i * 3, r * 0.42, 0, 6.283); ctx.fill();
      }
    } else if (o.type === "hedgehog") {
      // 対戦車バリケード。歩兵も車両も通れないが、弾と視線は抜ける。
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
      ctx.strokeStyle = C("#7d8288"); ctx.lineWidth = 5; ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3 + (o.seed || 0);
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.strokeStyle = C("#4c5054"); ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3 + (o.seed || 0);
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
    }
  }

  function teamColors(s) {
    // 自分だけはチーム色ではなく、選んだスキンの色で描く
    if (s.id === G.localId) {
      const skin = activeSkin();
      return { u: skin.uniform, a: skin.accent };
    }
    const def = teamDef(s.team);
    return { u: def.uniform, a: def.accent };
  }

  function drawSoldierShadow(s) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(s.x + 3, s.y + 5, SOLDIER_R + 3, SOLDIER_R - 1, 0, 0, 6.283);
    ctx.fill();
  }

  function drawDogShadow(dog) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(dog.x + 3, dog.y + 5, 18, 9, dog.angle, 0, Math.PI * 2); ctx.fill();
  }

  function drawDog(dog) {
    const harness = teamDef(dog.team).dogHarness;
    const fur = teamDef(dog.team).dogFur;
    const bite = now() - dog.biteAt < 170;
    ctx.save();
    ctx.translate(dog.x, dog.y); ctx.rotate(dog.angle);
    // 尾と脚
    ctx.strokeStyle = fur; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(-24, -8, -27, -2); ctx.stroke();
    ctx.fillStyle = "#302a25";
    const stride = dog.moving ? Math.sin(now() * 0.018) * 4 : 0;
    ctx.fillRect(-9 + stride, -10, 5, 9); ctx.fillRect(5 - stride, -10, 5, 9);
    ctx.fillRect(-9 - stride, 2, 5, 9); ctx.fillRect(5 + stride, 2, 5, 9);
    // 胴体とハーネス
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(-1, 0, 17, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = harness; ctx.fillRect(-5, -10, 8, 20);
    ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("K9", -1, 0);
    // 頭・耳・口
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(15, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2c2420";
    ctx.beginPath(); ctx.moveTo(10, -6); ctx.lineTo(8, -15); ctx.lineTo(17, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(8, 15); ctx.lineTo(17, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = bite ? "#d9d7c8" : "#241d19";
    ctx.beginPath(); ctx.ellipse(23, 0, bite ? 8 : 5, bite ? 5 : 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e8d7b9"; ctx.beginPath(); ctx.arc(17, -3, 1.4, 0, Math.PI * 2); ctx.fill();
    if (dog.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${dog.hitFlash * 0.65})`;
      ctx.beginPath(); ctx.ellipse(0, 0, 23, 14, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 痩せた長身の影。顔は無く、光る眼だけがこちらを向く。
  function drawCreature(cr) {
    const t = now();
    const hunting = cr.hunting;
    const lunging = t - cr.lungeAt < 220;
    ctx.save();
    ctx.translate(cr.x, cr.y);
    // 足元に溜まる闇
    const shadow = ctx.createRadialGradient(0, 0, 4, 0, 0, 62);
    shadow.addColorStop(0, "rgba(0,0,0,0.72)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(cr.angle);
    // 長い四肢。狩り中は激しく波打つ。
    const reach = hunting ? 40 : 31;
    ctx.strokeStyle = hunting ? "#c9c4bb" : "#8e8a83";
    ctx.lineWidth = 3.4; ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const base = (i < 2 ? -1 : 1) * (0.75 + (i % 2) * 0.55);
      const sway = Math.sin(cr.limbPhase + i * 1.7) * (hunting ? 0.5 : 0.22);
      const a = base + sway;
      const elbowX = Math.cos(a) * reach * 0.55, elbowY = Math.sin(a) * reach * 0.55;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(elbowX, elbowY, Math.cos(a - 0.5) * reach, Math.sin(a - 0.5) * reach);
      ctx.stroke();
    }
    // 胴体: 縦に引き伸ばした細身
    ctx.fillStyle = hunting ? "#ded8cd" : "#a8a49b";
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(20,18,22,0.5)";
    ctx.beginPath(); ctx.ellipse(-3, 0, 6, 13, 0, 0, Math.PI * 2); ctx.fill();
    // 頭部: のっぺりした楕円、口は裂けたときだけ見える
    ctx.fillStyle = hunting ? "#efe9dd" : "#b8b4aa";
    ctx.beginPath(); ctx.ellipse(7, 0, 9.5, 8, 0, 0, Math.PI * 2); ctx.fill();
    if (lunging) {
      ctx.fillStyle = "#2a0a0c";
      ctx.beginPath(); ctx.ellipse(12, 0, 6, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(9, i * 2.1); ctx.lineTo(17, i * 2.4); ctx.stroke();
      }
    }
    // 光る眼
    const glow = hunting ? "rgba(255,52,40," : "rgba(226,196,120,";
    const pulse = 0.65 + Math.sin(t * 0.006) * 0.25;
    ctx.shadowColor = hunting ? "#ff3428" : "#e2c478";
    ctx.shadowBlur = hunting ? 16 : 8;
    ctx.fillStyle = glow + pulse + ")";
    ctx.beginPath(); ctx.arc(11, -3.4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(11, 3.4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawTurretShadow(turret) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(turret.x + 3, turret.y + 5, TURRET_R + 2, TURRET_R - 4, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawTurret(turret) {
    // 誰も乗っていない銃座は灰色、取り付かれたらその軍の色になる
    const held = turret.team >= 0;
    const accent = held ? teamDef(turret.team).flag : "#8e9384";
    ctx.save();
    ctx.translate(turret.x, turret.y);
    // 土嚢の陣地
    ctx.fillStyle = "#6f6a44";
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI * 2 / 6;
      ctx.fillStyle = i % 2 ? "#7a754d" : "#67623f";
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * (TURRET_R - 2), Math.sin(a) * (TURRET_R - 2), 9, 6, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#3f4438";
    ctx.beginPath(); ctx.arc(0, 0, TURRET_R - 8, 0, Math.PI * 2); ctx.fill();
    // 銃身と防盾は照準方向へ回る
    ctx.rotate(turret.angle);
    ctx.fillStyle = "#2a2c26";
    ctx.fillRect(6, -3.5, 34, 7);
    ctx.fillStyle = accent;
    ctx.fillRect(2, -13, 8, 26);              // 防盾
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(4, -4, 4, 8);                // 覗き窓
    ctx.fillStyle = "#3a3d34";
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    if (now() - turret.muzzle < 55) {
      ctx.fillStyle = "rgba(255,220,120,0.95)";
      ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(54, -7); ctx.lineTo(61, 0); ctx.lineTo(54, 7); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (turret.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${turret.hitFlash * 0.5})`;
      ctx.beginPath(); ctx.arc(turret.x, turret.y, TURRET_R, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTankShadow(tank) {
    ctx.save();
    ctx.translate(tank.x + 5, tank.y + 8);
    ctx.rotate(tank.angle);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fillRect(-37, -27, 74, 54);
    ctx.restore();
  }

  function drawTank(tank) {
    const body = teamDef(tank.team).tankBody;
    const light = teamDef(tank.team).tankLight;
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);
    // キャタピラ
    ctx.fillStyle = "#242720";
    ctx.fillRect(-38, -29, 76, 14);
    ctx.fillRect(-38, 15, 76, 14);
    ctx.strokeStyle = "#55594b"; ctx.lineWidth = 2;
    for (let x = -31; x <= 31; x += 14) {
      ctx.beginPath(); ctx.moveTo(x, -28); ctx.lineTo(x, -16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, 28); ctx.stroke();
    }
    // 車体
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-31, -20); ctx.lineTo(25, -20); ctx.lineTo(35, -12);
    ctx.lineTo(35, 12); ctx.lineTo(25, 20); ctx.lineTo(-31, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = light; ctx.fillRect(-25, -15, 28, 30);
    ctx.restore();

    // 砲塔は照準方向へ独立回転
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.turretAngle);
    ctx.fillStyle = "#262820";
    ctx.fillRect(4, -5, 51, 10);
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(1, 0, 22, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(1, 0, 12, 0, Math.PI * 2); ctx.fill();
    if (now() - tank.muzzle < 90) {
      ctx.fillStyle = "rgba(255,220,120,0.96)";
      ctx.beginPath(); ctx.moveTo(53, 0); ctx.lineTo(70, -9); ctx.lineTo(79, 0); ctx.lineTo(70, 9); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // 近接武器の見た目。原点は握り手、+X が刃先の向き。
  function drawMeleeWeapon(style) {
    if (style === "bayonet") {
      // 銃身に着剣した細身の刺突武器
      ctx.fillStyle = "#23231f"; ctx.fillRect(-2, -2.5, 20, 5);
      ctx.fillStyle = "#e6ecee";
      ctx.beginPath(); ctx.moveTo(18, -3); ctx.lineTo(36, 0); ctx.lineTo(18, 3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8b9599"; ctx.lineWidth = 1; ctx.stroke();
    } else if (style === "hatchet") {
      // 短い柄 + 扇形の斧刃
      ctx.fillStyle = "#6b4423"; ctx.fillRect(-2, -2.5, 17, 5);
      ctx.fillStyle = "#cfd7da";
      ctx.beginPath(); ctx.moveTo(13, -3); ctx.lineTo(22, -11); ctx.lineTo(27, -1); ctx.lineTo(21, 6); ctx.lineTo(13, 3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#7d868a"; ctx.lineWidth = 1; ctx.stroke();
    } else if (style === "shovel") {
      // 長い柄 + 四角い匙。一番リーチが長く、振りも大きい。
      ctx.fillStyle = "#5d4a2e"; ctx.fillRect(-2, -3, 24, 6);
      ctx.fillStyle = "#9aa3a6";
      ctx.beginPath(); ctx.moveTo(21, -9); ctx.lineTo(34, -8); ctx.lineTo(36, 0); ctx.lineTo(34, 8); ctx.lineTo(21, 9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#6d7679"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(24, -5, 8, 10);
    } else if (style === "katana") {
      // 長い柄 + 反りのある刀身
      ctx.fillStyle = "#2b2b33"; ctx.fillRect(-4, -2.5, 12, 5);
      ctx.fillStyle = "#c9a227"; ctx.fillRect(7, -5, 3, 10);   // 鍔
      ctx.strokeStyle = "#eef3f6"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(10, 1); ctx.quadraticCurveTo(28, -1, 42, -7); ctx.stroke();
      ctx.strokeStyle = "#9fb0b8"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(10, 1); ctx.quadraticCurveTo(28, -1, 42, -7); ctx.stroke();
    } else if (style === "timesword") {
      // 時の剣: 鍛えたものではなく、森が育てた聖剣。
      // 節くれだった枝の柄、葉の鍔、樹液が固まった琥珀色の刃。
      const t = now();
      const breathe = 0.72 + 0.28 * Math.sin(t / 620);
      // 柄 (曲がった枝)
      ctx.strokeStyle = "#5f4a2c"; ctx.lineWidth = 6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-7, 2); ctx.quadraticCurveTo(0, -1, 8, 0); ctx.stroke();
      ctx.strokeStyle = "#7d6238"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-6, 1); ctx.quadraticCurveTo(0, -2, 7, -1); ctx.stroke();
      // 柄尻の木の実
      ctx.fillStyle = "#8a5a2b";
      ctx.beginPath(); ctx.arc(-9, 2, 3.2, 0, 6.283); ctx.fill();
      // 鍔のかわりに広がる二枚の葉
      ctx.fillStyle = "#4f7f3a";
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.quadraticCurveTo(14, -13, 3, -11); ctx.quadraticCurveTo(6, -4, 8, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.quadraticCurveTo(14, 13, 3, 11); ctx.quadraticCurveTo(6, 4, 8, 0); ctx.fill();
      ctx.strokeStyle = "#7fb45c"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(7, -1); ctx.lineTo(11, -8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, 1); ctx.lineTo(11, 8); ctx.stroke();
      // 刃: 木の葉のように膨らんで先が尖る。中は透けた琥珀色。
      ctx.save();
      ctx.shadowColor = `rgba(226,255,190,${breathe})`;
      ctx.shadowBlur = 12;
      ctx.fillStyle = "rgba(232,246,196,0.92)";
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.quadraticCurveTo(24, -8, 44, 0);
      ctx.quadraticCurveTo(24, 8, 10, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // 葉脈のような筋
      ctx.strokeStyle = `rgba(126,178,92,${0.55 + breathe * 0.35})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(43, 0); ctx.stroke();
      ctx.lineWidth = 0.9;
      for (let i = 0; i < 4; i++) {
        const x = 15 + i * 7;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 5, -3.4 + i * 0.4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 5, 3.4 - i * 0.4); ctx.stroke();
      }
      // 刃に沿って漂う光の粒
      ctx.fillStyle = `rgba(255,255,225,${breathe})`;
      for (let i = 0; i < 3; i++) {
        const p = ((t / 1400 + i * 0.33) % 1);
        ctx.beginPath(); ctx.arc(12 + p * 30, Math.sin(p * 6.283 + i) * 3.5, 1.5, 0, 6.283); ctx.fill();
      }
    } else {
      // knife
      ctx.fillStyle = "#5b3a22"; ctx.fillRect(-2, -3, 9, 6);
      ctx.fillStyle = "#dfe5e7";
      ctx.beginPath(); ctx.moveTo(7, -4); ctx.lineTo(25, 0); ctx.lineTo(7, 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#727b7e"; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function drawSoldier(s) {
    const c = teamColors(s);
    const a = s.aimAngle;
    // スキンの半透明・発光は ctx の状態なので、末尾の restore() でまとめて元に戻る
    const skin = s.id === G.localId ? activeSkin() : null;
    ctx.save();
    if (skin && skin.alpha) ctx.globalAlpha = skin.alpha;
    if (skin && skin.glow) { ctx.shadowColor = skin.glow; ctx.shadowBlur = 11; }
    // 降下中は高度のぶんだけ上へずらして描く(影は地面に残る)
    ctx.translate(s.x, s.y - dropAltitude(s));
    const style = skin ? skin.style : null;
    // 脚 (歩行)
    const legSwing = s.moving ? Math.sin(s.legPhase) * 5 : 0;
    ctx.save();
    ctx.rotate(a);
    drawSkinLegs(style, skin, c, legSwing);
    ctx.restore();
    // 胴 (照準方向に回転)
    ctx.rotate(a);
    const recoilBack = s.recoil * 0.6;
    drawSkinTorso(style, skin, s, c, recoilBack);
    // 防弾鎧プレート (ホログラムとボクセルは体の作りが違うので付けない)
    if (s.armor > 0 && style !== "hologram" && style !== "voxel") {
      const ar = clamp(s.armor / s.maxArmor, 0, 1);
      ctx.fillStyle = `rgba(126,165,194,${0.35 + ar * 0.45})`;
      ctx.fillRect(-10 - recoilBack, -12, 13, 8); ctx.fillRect(-10 - recoilBack, 4, 13, 8);
      ctx.strokeStyle = "rgba(220,238,248,0.42)"; ctx.lineWidth = 1; ctx.strokeRect(-10 - recoilBack, -12, 13, 24);
    }
    // 武器
    const w = WEAPONS[s.weapon];
    if (s.shieldRaised && s.shield > 0) {
      const sr = clamp(s.shield / s.maxShield, 0, 1);
      const parrying = s.parryUntil > 0 && now() <= s.parryUntil;
      ctx.fillStyle = parrying ? "rgba(255,226,112,0.94)" : `rgba(58,139,154,${0.72 + sr * 0.18})`;
      ctx.strokeStyle = parrying ? "#fff8bd" : "#b8f3ed"; ctx.lineWidth = parrying ? 5 : 2.5;
      ctx.beginPath(); ctx.moveTo(16, -19); ctx.quadraticCurveTo(28, -16, 29, 0); ctx.quadraticCurveTo(28, 16, 16, 19);
      ctx.lineTo(12, 12); ctx.lineTo(12, -12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(220,255,250,0.42)"; ctx.fillRect(17, -11, 7, 8);
      ctx.fillStyle = "#caa06b"; ctx.beginPath(); ctx.arc(12, -8, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, 8, 3.4, 0, Math.PI * 2); ctx.fill();
    } else if (w.melee) {
      const attackAge = now() - s.muzzle;
      // 振りかぶり → 振り抜きを1回のスイングで表現。武器が重いほど大きく振る。
      // 刀の範囲攻撃だけは、全方位に届くことが分かるよう1回転させる。
      const sweeping = !!s.sweepAt && s.sweepAt === s.muzzle;
      const swingSpan = sweeping ? Math.PI * 2
        : w.style === "shovel" ? 2.5 : w.style === "hatchet" ? 2.1 : w.style === "katana" ? 2.3 : w.style === "bayonet" ? 0.5 : 1.9;
      const swingMs = w.style === "bayonet" ? 110 : sweeping ? 230 : 180;
      const swing = attackAge < swingMs ? -swingSpan / 2 + (attackAge / swingMs) * swingSpan : 0;
      // 銃剣だけは振らずに前へ突き出す
      const thrust = w.style === "bayonet" && attackAge < swingMs ? 10 * (1 - attackAge / swingMs) : 0;
      ctx.save();
      ctx.translate(SOLDIER_R - 4 - recoilBack + thrust, 0); ctx.rotate(swing);
      drawMeleeWeapon(w.style);
      ctx.fillStyle = "#caa06b"; ctx.beginPath(); ctx.arc(1, 1, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = "#23231f";
      ctx.fillRect(SOLDIER_R - 4 - recoilBack, -3, w.len, 5);
      if (w.key === "sniper") ctx.fillRect(SOLDIER_R + 2 - recoilBack, -5, 8, 3);
      // 手
      ctx.fillStyle = "#caa06b";
      ctx.beginPath(); ctx.arc(SOLDIER_R - 2 - recoilBack, 2, 3.4, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(SOLDIER_R + w.len * 0.55 - recoilBack, 1, 3.2, 0, 6.283); ctx.fill();
    }
    // 頭(ヘルメット)
    drawSkinHead(style, skin, c);
    // マズルフラッシュ
    if (!s.shieldRaised && !w.melee && now() - s.muzzle < 55) {
      const ml = SOLDIER_R + w.len - recoilBack;
      ctx.fillStyle = "rgba(255,220,120,0.95)";
      ctx.beginPath();
      ctx.moveTo(ml, 0);
      ctx.lineTo(ml + 13, -6);
      ctx.lineTo(ml + 20, 0);
      ctx.lineTo(ml + 13, 6);
      ctx.closePath(); ctx.fill();
    }
    // 被弾フラッシュ
    if (s.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${s.hitFlash * 0.6})`;
      ctx.beginPath(); ctx.arc(0, 0, SOLDIER_R + 2, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  // 練習用の的。台に的の輪を描いた板。兵士とはひと目で見分けられるようにする。
  const DUMMY_R = SOLDIER_R + 2;

  function drawDummy(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    // 支柱
    ctx.fillStyle = "#6a5636";
    ctx.save();
    ctx.rotate(s.angle);
    ctx.fillRect(-SOLDIER_R - 4, -5, 12, 10);
    ctx.restore();
    drawDummyFace(DUMMY_R, 1);
    // 動く的は回っている向きが分かるように矢印を足す
    if (s.orbit) {
      ctx.save();
      ctx.rotate(s.angle);
      ctx.fillStyle = "rgba(30,26,18,0.75)";
      ctx.beginPath();
      ctx.moveTo(DUMMY_R - 3, 0); ctx.lineTo(DUMMY_R - 11, -5); ctx.lineTo(DUMMY_R - 11, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (s.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${s.hitFlash * 0.6})`;
      ctx.beginPath(); ctx.arc(0, 0, DUMMY_R + 2, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  // 的の盤面。転送エフェクトでも同じ絵を使うので切り出してある。
  // 地形は白と灰色でも、的だけは紅白のままにして狙う場所が一目で分かるようにする。
  function drawDummyFace(r, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#e4dcc2";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "#8b7448"; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = "#c8483c";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#e4dcc2";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.46, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#c8483c";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 岩に刺さった時の剣。抜かれるまで中央に立っている。
  function drawSwordRock() {
    const rock = G.swordRock;
    if (!rock) return;
    const t = now();
    // 岩
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(rock.x + 5, rock.y + 12, SWORD_ROCK_R, SWORD_ROCK_R * 0.5, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#5a5f6b";
    ctx.beginPath();
    ctx.moveTo(rock.x - SWORD_ROCK_R, rock.y + 14);
    ctx.lineTo(rock.x - SWORD_ROCK_R * 0.62, rock.y - SWORD_ROCK_R * 0.6);
    ctx.lineTo(rock.x + SWORD_ROCK_R * 0.2, rock.y - SWORD_ROCK_R * 0.78);
    ctx.lineTo(rock.x + SWORD_ROCK_R * 0.86, rock.y - SWORD_ROCK_R * 0.2);
    ctx.lineTo(rock.x + SWORD_ROCK_R, rock.y + 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#6f7684";
    ctx.beginPath();
    ctx.moveTo(rock.x - SWORD_ROCK_R * 0.62, rock.y - SWORD_ROCK_R * 0.6);
    ctx.lineTo(rock.x + SWORD_ROCK_R * 0.2, rock.y - SWORD_ROCK_R * 0.78);
    ctx.lineTo(rock.x + SWORD_ROCK_R * 0.1, rock.y - 2);
    ctx.lineTo(rock.x - SWORD_ROCK_R * 0.5, rock.y - 6);
    ctx.closePath(); ctx.fill();
    // 岩を覆う苔
    ctx.fillStyle = "rgba(96,142,86,0.5)";
    ctx.beginPath(); ctx.ellipse(rock.x - 16, rock.y + 4, 15, 7, -0.3, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(rock.x + 20, rock.y + 8, 11, 5, 0.4, 0, 6.283); ctx.fill();

    if (!rock.pulled) {
      // 抜かれるまでは剣が生えたまま。手をかけていると光が強まる。
      const p = rock.progress / SWORD_PULL_MS;
      const glow = 0.45 + 0.25 * Math.sin(t / 320) + p * 0.5;
      ctx.save();
      ctx.translate(rock.x, rock.y - 18 - p * 12);
      ctx.rotate(-Math.PI / 2);
      ctx.shadowColor = "rgba(214,255,190,0.95)";
      ctx.shadowBlur = 14 + p * 22;
      ctx.globalAlpha = clamp(glow, 0, 1);
      drawMeleeWeapon("timesword");
      ctx.restore();
      // 進み具合のリング
      if (rock.progress > 0) {
        ctx.strokeStyle = "rgba(226,255,196,0.9)"; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(rock.x, rock.y + 6, SWORD_ROCK_R + 16, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // 抜けたあとの割れ目
      ctx.strokeStyle = "rgba(20,24,20,0.8)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(rock.x - 3, rock.y - 20); ctx.lineTo(rock.x + 2, rock.y + 2); ctx.stroke();
    }
  }

  // 時の剣の持ち主のまわりに広がる、弾が遅くなる領域
  function drawTimeField() {
    const holder = swordHolder();
    if (!holder) return;
    const t = now();
    const pulse = 0.5 + 0.5 * Math.sin(t / 700);
    ctx.save();
    ctx.strokeStyle = `rgba(198,246,176,${0.16 + pulse * 0.12})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(holder.x, holder.y, TIME_FIELD_R, 0, 6.283); ctx.stroke();
    ctx.fillStyle = `rgba(150,220,150,${0.05 + pulse * 0.03})`;
    ctx.beginPath(); ctx.arc(holder.x, holder.y, TIME_FIELD_R, 0, 6.283); ctx.fill();
    // 内側にゆっくり回る目盛り
    ctx.strokeStyle = `rgba(214,255,196,${0.2 + pulse * 0.1})`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 12; i++) {
      const a = t / 3600 + i * Math.PI / 6;
      const r0 = TIME_FIELD_R - 16, r1 = TIME_FIELD_R - 4;
      ctx.beginPath();
      ctx.moveTo(holder.x + Math.cos(a) * r0, holder.y + Math.sin(a) * r0);
      ctx.lineTo(holder.x + Math.cos(a) * r1, holder.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 魔物。硬い森の主。時の剣なら一撃で倒せる。
  function drawBeast(beast) {
    const swing = Math.sin(beast.limbPhase) * 4;
    ctx.save();
    ctx.translate(beast.x, beast.y);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath(); ctx.ellipse(3, 7, BEAST_R * 0.95, BEAST_R * 0.5, 0, 0, 6.283); ctx.fill();
    ctx.rotate(beast.angle);
    // 四肢
    ctx.strokeStyle = "#2c2418"; ctx.lineWidth = 5; ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-4, side * 8);
      ctx.lineTo(10, side * (14 + swing * side * 0.6));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-12, side * 8);
      ctx.lineTo(-20, side * (15 - swing * side * 0.6));
      ctx.stroke();
    }
    // 胴。苔むした岩のような背中。
    ctx.fillStyle = "#3d4a33";
    ctx.beginPath(); ctx.ellipse(-2, 0, BEAST_R, BEAST_R * 0.82, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#556b45";
    ctx.beginPath(); ctx.ellipse(-6, -4, BEAST_R * 0.6, BEAST_R * 0.45, -0.3, 0, 6.283); ctx.fill();
    // 背中の棘
    ctx.fillStyle = "#232a1d";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-4 + i * 8, -BEAST_R * 0.7);
      ctx.lineTo(-1 + i * 8, -BEAST_R * 1.15);
      ctx.lineTo(2 + i * 8, -BEAST_R * 0.7);
      ctx.closePath(); ctx.fill();
    }
    // 頭と光る眼
    ctx.fillStyle = "#2f3a28";
    ctx.beginPath(); ctx.ellipse(BEAST_R * 0.72, 0, 9, 8, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#ffd05a";
    ctx.beginPath(); ctx.arc(BEAST_R * 0.9, -4, 2.6, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(BEAST_R * 0.9, 4, 2.6, 0, 6.283); ctx.fill();
    if (beast.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${beast.hitFlash * 0.55})`;
      ctx.beginPath(); ctx.ellipse(-2, 0, BEAST_R + 2, BEAST_R * 0.9, 0, 0, 6.283); ctx.fill();
    }
    ctx.restore();
    // 体力バー
    const bw = 46, ratio = clamp(beast.hp / beast.maxHp, 0, 1);
    const by = beast.y - BEAST_R - 14;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(beast.x - bw / 2 - 1, by, bw + 2, 6);
    ctx.fillStyle = "#c56a3a"; ctx.fillRect(beast.x - bw / 2, by + 1, bw * ratio, 4);
  }

  // パラシュート。兵士より手前・輸送機より奥に描く。
  function drawParachutes() {
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || !isDropping(s) || !isEntityVisible(s)) continue;
      const alt = dropAltitude(s);
      const def = teamDef(s.team);
      const canopy = s.id === G.localId ? activeSkin().accent : def.flag;
      const cx = s.x, cy = s.y - alt - 30;
      // 傘の張り綱
      ctx.strokeStyle = "rgba(240,240,230,0.75)"; ctx.lineWidth = 1.2;
      for (const dx of [-20, -7, 7, 20]) {
        ctx.beginPath(); ctx.moveTo(cx + dx, cy + 6); ctx.lineTo(s.x, s.y - alt - 4); ctx.stroke();
      }
      // 傘体。左右で明暗を分けて膨らみを出す。
      ctx.fillStyle = canopy;
      ctx.beginPath(); ctx.ellipse(cx, cy, 30, 17, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath(); ctx.ellipse(cx + 9, cy, 21, 17, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, 30, 17, 0, Math.PI, 0); ctx.stroke();
    }
  }

  // 輸送機。開始直後に基地の上空を通り過ぎる。
  function drawDropPlanes() {
    if (!G.dropAt) return;
    const age = now() - G.dropAt;
    if (age > PLANE_MS) return;
    const p = age / PLANE_MS;
    const fade = clamp((1 - p) * 2.2, 0, 1);
    for (const base of G.bases) {
      if (base.hidden) continue;
      const h = BASE_SPOTS[base.team].heading;
      const travel = (p - 0.32) * 1600;
      const px = base.x + Math.cos(h) * travel;
      const py = base.y + Math.sin(h) * travel;
      // 地面に落ちる影
      ctx.fillStyle = `rgba(0,0,0,${0.16 * fade})`;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(h);
      ctx.beginPath(); ctx.ellipse(0, 0, 46, 13, 0, 0, 6.283); ctx.fill();
      ctx.restore();
      // 機体
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(px, py - PLANE_ALT); ctx.rotate(h);
      ctx.fillStyle = "#4b5252";
      ctx.beginPath();
      ctx.moveTo(46, 0); ctx.lineTo(14, -11); ctx.lineTo(-40, -9);
      ctx.lineTo(-46, 0); ctx.lineTo(-40, 9); ctx.lineTo(14, 11);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#39403f";
      ctx.fillRect(-10, -44, 16, 88);          // 主翼
      ctx.fillRect(-40, -22, 10, 44);          // 尾翼
      ctx.fillStyle = "#9fd4e8";
      ctx.beginPath(); ctx.ellipse(32, 0, 8, 6, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#2a2f2e";
      ctx.beginPath(); ctx.arc(-2, -30, 5, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(-2, 30, 5, 0, 6.283); ctx.fill();
      ctx.restore();
    }
  }

  // ---- スキンごとの体つき ----
  // 原点は兵士の中心、+X が照準の向き。style を持つスキンは輪郭から作り替える。

  function drawSkinLegs(style, skin, c, legSwing) {
    if (style === "hologram") {
      // 脚は無く、投影機のように光の裾が広がる
      ctx.fillStyle = "rgba(140,233,255,0.22)";
      ctx.beginPath();
      ctx.moveTo(-3, -7); ctx.lineTo(-3, 7);
      ctx.lineTo(-16, 13); ctx.lineTo(-16, -13);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(160,240,255,0.5)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(-15, 0, 4, 13, 0, 0, 6.283); ctx.stroke();
      return;
    }
    if (style === "mech") {
      // 太い脚部とつま先の装甲
      ctx.fillStyle = "#5b6068";
      ctx.fillRect(-7, -13 - legSwing * 0.3, 13, 8);
      ctx.fillRect(-7, 5 + legSwing * 0.3, 13, 8);
      ctx.fillStyle = "#8f979f";
      ctx.fillRect(3, -13 - legSwing * 0.3, 4, 8);
      ctx.fillRect(3, 5 + legSwing * 0.3, 4, 8);
      return;
    }
    if (style === "voxel") {
      // 脚もブロック
      ctx.fillStyle = "#2b1f4a";
      ctx.fillRect(-6, -12 - legSwing * 0.3, 6, 6);
      ctx.fillRect(-6, 6 + legSwing * 0.3, 6, 6);
      ctx.fillStyle = "#4a3780";
      ctx.fillRect(0, -12 - legSwing * 0.3, 6, 6);
      ctx.fillRect(0, 6 + legSwing * 0.3, 6, 6);
      return;
    }
    if (style === "neon") {
      // 細い発光バー
      ctx.fillStyle = skin.accent;
      ctx.fillRect(-5, -12 - legSwing * 0.3, 11, 3);
      ctx.fillRect(-5, 9 + legSwing * 0.3, 11, 3);
      return;
    }
    ctx.fillStyle = "#2a2a22";
    ctx.fillRect(-4, -10 - legSwing * 0.3, 9, 6);
    ctx.fillRect(-4, 4 + legSwing * 0.3, 9, 6);
  }

  function drawSkinTorso(style, skin, s, c, back) {
    const t = now();
    if (style === "hologram") {
      // 実体を持たない六角形のワイヤーフレーム。走査線が下から上へ流れる。
      const pts = [[10, -7], [3, -14], [-9, -12], [-12, 0], [-9, 12], [3, 14], [10, 7]];
      ctx.beginPath();
      ctx.moveTo(pts[0][0] - back, pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0] - back, p[1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(90,190,225,0.35)"; ctx.fill();
      ctx.strokeStyle = "rgba(180,248,255,0.95)"; ctx.lineWidth = 1.7; ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "rgba(200,250,255,0.55)"; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = ((t / 900 + i * 0.2) % 1) * 30 - 15;
        ctx.beginPath(); ctx.moveTo(-16 - back, y); ctx.lineTo(12 - back, y); ctx.stroke();
      }
      ctx.restore();
      // ときどき像がずれるグリッチ
      if (Math.floor(t / 140) % 17 === 0) {
        ctx.fillStyle = "rgba(200,250,255,0.35)";
        ctx.fillRect(-14 - back, -4, 26, 5);
      }
      return;
    }
    if (style === "neon") {
      // 角ばった装甲。輪郭とコアだけが強く光る。
      const pts = [[12, -6], [5, -14], [-10, -11], [-13, 0], [-10, 11], [5, 14], [12, 6]];
      ctx.beginPath();
      ctx.moveTo(pts[0][0] - back, pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0] - back, p[1]);
      ctx.closePath();
      ctx.fillStyle = c.u; ctx.fill();
      ctx.strokeStyle = skin.accent; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = "#4ff0ff"; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-11 - back, -6); ctx.lineTo(9 - back, -6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-11 - back, 6); ctx.lineTo(9 - back, 6); ctx.stroke();
      const pulse = 0.55 + 0.45 * Math.sin(t / 260);
      ctx.fillStyle = `rgba(255,120,230,${pulse})`;
      ctx.beginPath(); ctx.arc(-2 - back, 0, 4, 0, 6.283); ctx.fill();
      return;
    }
    if (style === "mech") {
      // 箱型のシャーシに肩アーマーを載せた重機械
      ctx.fillStyle = "#727a83";
      ctx.fillRect(-12 - back, -12, 23, 24);
      ctx.fillStyle = "#a7b1ba";
      ctx.fillRect(-12 - back, -12, 23, 5);
      ctx.fillStyle = "#4e555c";
      ctx.fillRect(-12 - back, 7, 23, 5);
      // 肩アーマー
      ctx.fillStyle = "#8d959d";
      ctx.fillRect(-6 - back, -18, 12, 7);
      ctx.fillRect(-6 - back, 11, 12, 7);
      ctx.strokeStyle = "#3c4248"; ctx.lineWidth = 1.4;
      ctx.strokeRect(-12 - back, -12, 23, 24);
      // 胸部ハッチと動力炉の光
      ctx.fillStyle = "#333a40";
      ctx.fillRect(-3 - back, -6, 10, 12);
      ctx.fillStyle = "#9ce6ff";
      ctx.fillRect(-1 - back, -4, 6, 8);
      return;
    }
    if (style === "voxel") {
      // 3×3のブロックで胴を組む。色を市松に散らして粗いドット感を出す。
      const shades = ["#4a3780", "#5c46a0", "#3b2a63"];
      for (let ix = 0; ix < 3; ix++) {
        for (let iy = 0; iy < 3; iy++) {
          ctx.fillStyle = shades[(ix + iy) % 3];
          ctx.fillRect(-13 - back + ix * 9, -13 + iy * 9, 9, 9);
        }
      }
      ctx.fillStyle = skin.accent;
      ctx.fillRect(-4 - back, -4, 9, 9);
      ctx.strokeStyle = "rgba(215,200,255,0.7)"; ctx.lineWidth = 1;
      ctx.strokeRect(-13 - back, -13, 27, 27);
      return;
    }
    // 標準・迷彩系: 従来のシルエットに、スキンごとの模様を足す
    ctx.fillStyle = c.u;
    ctx.beginPath();
    ctx.ellipse(-back, 0, SOLDIER_R - 1, SOLDIER_R + 1, 0, 0, 6.283);
    ctx.fill();
    if (style === "camo") {
      // 迷彩の斑。位置は固定なので毎フレーム同じ模様になる。
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(-back, 0, SOLDIER_R - 1, SOLDIER_R + 1, 0, 0, 6.283);
      ctx.clip();
      ctx.fillStyle = skin.accent;
      const blobs = [[-7, -8, 7, 5], [2, -3, 6, 4], [-5, 5, 8, 6], [5, 8, 5, 4]];
      for (const b of blobs) {
        ctx.beginPath();
        ctx.ellipse(b[0] - back, b[1], b[2] / 2, b[3] / 2, 0.5, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    } else if (style === "plated") {
      // 尖った胸甲と肩当て
      ctx.fillStyle = skin.accent;
      ctx.beginPath();
      ctx.moveTo(11 - back, 0); ctx.lineTo(1 - back, -11); ctx.lineTo(-7 - back, -6);
      ctx.lineTo(-7 - back, 6); ctx.lineTo(1 - back, 11);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(-9 - back, -16, 8, 6);
      ctx.fillRect(-9 - back, 10, 8, 6);
    }
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-back - 2, -SOLDIER_R, 4, SOLDIER_R * 2);
  }

  function drawSkinHead(style, skin, c) {
    if (style === "hologram") {
      // 頭は菱形のワイヤーフレーム
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(0, -7); ctx.lineTo(-8, 0); ctx.lineTo(0, 7);
      ctx.closePath();
      ctx.fillStyle = "rgba(120,215,245,0.5)"; ctx.fill();
      ctx.strokeStyle = "rgba(200,250,255,0.95)"; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }
    if (style === "neon") {
      ctx.beginPath();
      ctx.moveTo(8, -4); ctx.lineTo(2, -8); ctx.lineTo(-7, -5);
      ctx.lineTo(-7, 5); ctx.lineTo(2, 8); ctx.lineTo(8, 4);
      ctx.closePath();
      ctx.fillStyle = "#0e0e1c"; ctx.fill();
      ctx.strokeStyle = skin.accent; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = "#4ff0ff";
      ctx.fillRect(2, -4, 5, 8);
      return;
    }
    if (style === "mech") {
      // 箱の頭に一文字のバイザー
      ctx.fillStyle = "#b6bec6";
      ctx.fillRect(-7, -7, 15, 14);
      ctx.fillStyle = "#7d858d";
      ctx.fillRect(-7, -7, 15, 4);
      ctx.strokeStyle = "#3c4248"; ctx.lineWidth = 1.2;
      ctx.strokeRect(-7, -7, 15, 14);
      ctx.fillStyle = "#151b21";
      ctx.fillRect(2, -5, 6, 10);
      ctx.fillStyle = "#9ce6ff";
      ctx.fillRect(3.4, -3.6, 3, 7.2);
      return;
    }
    if (style === "voxel") {
      ctx.fillStyle = skin.accent;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillRect(-7, -7, 14, 5);
      ctx.fillStyle = "#1c1430";
      ctx.fillRect(1, -4, 6, 3);
      ctx.fillRect(1, 1, 6, 3);
      return;
    }
    ctx.fillStyle = c.a;
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.arc(2, 0, 8.5, -0.9, 0.9); ctx.fill();
  }

  function drawBullets() {
    ctx.lineCap = "round";
    for (const b of G.bullets) {
      if (b.kind === "shell") {
        ctx.fillStyle = "#ffb83e";
        ctx.strokeStyle = "rgba(255,238,170,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        continue;
      }
      const m = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / m, uy = b.vy / m;
      // 時が遅くなっている弾は、尾を縮めて緑がかった残光をまとう
      const len = b.slowed ? b.len * 0.35 : b.len;
      ctx.strokeStyle = b.slowed ? "#cdf3a8" : b.col;
      ctx.lineWidth = b.slowed ? 3.2 : 2.4;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * len, b.y - uy * len);
      ctx.stroke();
      if (b.slowed) {
        ctx.fillStyle = "rgba(205,243,168,0.28)";
        ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, 6.283); ctx.fill();
      }
    }
  }

  // 有刺鉄線。地雷と違って隠せないので、敵味方どちらからも見える。
  function drawWires() {
    const mine = localTeam();
    for (const wire of G.wires) {
      const def = teamDef(wire.team);
      const friendly = wire.team === mine;
      ctx.save();
      ctx.translate(wire.x, wire.y);
      ctx.fillStyle = friendly ? hexToRgba(def.flag, 0.1) : "rgba(255,90,78,0.12)";
      ctx.beginPath(); ctx.arc(0, 0, WIRE_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = friendly ? hexToRgba(def.flag, 0.45) : "rgba(255,120,100,0.5)";
      ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(0, 0, WIRE_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 絡まった針金を数本描く
      ctx.strokeStyle = "#9aa0a4"; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4 + (wire.seed || 0) * 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * WIRE_R * 0.85, -Math.sin(a) * WIRE_R * 0.85);
        ctx.quadraticCurveTo(Math.sin(a) * 14, -Math.cos(a) * 14, Math.cos(a) * WIRE_R * 0.85, Math.sin(a) * WIRE_R * 0.85);
        ctx.stroke();
      }
      // トゲ
      ctx.strokeStyle = "#d8dee2"; ctx.lineWidth = 1.4;
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI * 2 / 12 + (wire.seed || 0);
        const r = WIRE_R * 0.55;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r - 3, Math.sin(a) * r - 3);
        ctx.lineTo(Math.cos(a) * r + 3, Math.sin(a) * r + 3);
        ctx.moveTo(Math.cos(a) * r + 3, Math.sin(a) * r - 3);
        ctx.lineTo(Math.cos(a) * r - 3, Math.sin(a) * r + 3);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 味方の地雷は常に見える。敵の地雷は踏む寸前まで見えない。
  function drawMines() {
    const t = now();
    const me = localSoldier();
    const mine = localTeam();
    for (const m of G.mines) {
      const friendly = m.team === mine;
      let alpha = 1;
      if (!friendly) {
        if (!me) continue;
        // 罠師は罠の扱いに長けているので、敵の地雷も見抜ける
        const spot = me.seesEnemyMines ? currentVisionRadius() : MINE_SPOT_R * (m.stealthMul || 1);
        const d = Math.sqrt(dist2(me.x, me.y, m.x, m.y));
        if (d > spot || !lineClear(me.x, me.y, m.x, m.y)) continue;
        alpha = clamp(1 - (d - spot * 0.55) / (spot * 0.45), 0.25, 1);
      }
      const armed = t >= m.armAt;
      const def = teamDef(m.team);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath(); ctx.ellipse(m.x + 2, m.y + 3, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      // 本体
      ctx.fillStyle = armed ? "#4a4b40" : "#5d5e50";
      ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = friendly ? def.flag : "#ff6b52"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, Math.PI * 2); ctx.stroke();
      // 中央のランプ: 作動後は点滅する
      const blink = armed ? (Math.floor(t / 380) % 2 === 0 ? 1 : 0.28) : 0.5;
      ctx.fillStyle = armed ? `rgba(255,90,70,${blink})` : "rgba(220,220,150,0.7)";
      ctx.beginPath(); ctx.arc(m.x, m.y, 3.4, 0, Math.PI * 2); ctx.fill();
      // 味方には作動範囲を薄く見せる
      if (friendly) {
        ctx.strokeStyle = hexToRgba(def.flag, 0.2); ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(m.x, m.y, MINE_TRIGGER_R, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  function drawGrenades() {
    const t = now();
    for (const g of G.grenades) {
      const progress = clamp((t - g.bornAt) / GRENADE_FUSE_MS, 0, 1);
      const lift = Math.sin(progress * Math.PI) * 18;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(g.x + 2, g.y + 3, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(g.x, g.y - lift); ctx.rotate(g.rotation);
      ctx.fillStyle = Math.floor((g.fuseAt - t) / 140) % 2 === 0 ? "#d9e56a" : "#3e4b2e";
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b7a159"; ctx.fillRect(-2, -9, 4, 5);
      ctx.restore();
    }
  }

  function drawParticlesUnder() {
    for (const p of G.particles) {
      if (p.kind === "casing") {
        ctx.fillStyle = "#d8b24a";
        ctx.fillRect(p.x - 1, p.y - 1, 2.4, 2.4);
      } else if (p.kind === "warpRing") {
        // 足元から広がる転送リング。a は輪ごとの時間差。
        const prog = clamp(1 - p.life / p.maxLife - p.a, 0, 1);
        if (prog <= 0) continue;
        ctx.strokeStyle = `rgba(${WARP_RGB},${(1 - prog) * 0.9})`;
        ctx.lineWidth = 3 * (1 - prog) + 1;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size + prog * 58, (p.size + prog * 58) * 0.42, 0, 0, 6.283);
        ctx.stroke();
      }
    }
  }

  // 的が上へ転送されて消える演出。柱・盤面・光の粒の3層で描く。
  function drawWarpParticle(p) {
    const prog = clamp(1 - p.life / p.maxLife, 0, 1);
    if (p.kind === "warpBeam") {
      // 上へ伸びる光の柱。終わりぎわに細くすぼまって消える。
      const fade = 1 - prog;
      const halfW = p.size * (prog < 0.25 ? prog / 0.25 : Math.max(0.12, 1 - (prog - 0.25) * 1.15));
      const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y - WARP_RISE - 60);
      grad.addColorStop(0, `rgba(${WARP_CORE_RGB},${0.85 * fade})`);
      grad.addColorStop(0.55, `rgba(${WARP_RGB},${0.4 * fade})`);
      grad.addColorStop(1, `rgba(${WARP_RGB},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(p.x - halfW, p.y - WARP_RISE - 60, halfW * 2, WARP_RISE + 60);
      // 走査線
      ctx.strokeStyle = `rgba(${WARP_CORE_RGB},${0.6 * fade})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const y = p.y - ((prog * 1.6 + i * 0.25) % 1) * (WARP_RISE + 40);
        ctx.beginPath(); ctx.moveTo(p.x - halfW, y); ctx.lineTo(p.x + halfW, y); ctx.stroke();
      }
    } else if (p.kind === "warpDisc") {
      // 盤面そのものが吸い上げられていく
      const ease = prog * prog;
      ctx.save();
      ctx.translate(p.x, p.y - ease * WARP_RISE);
      ctx.scale(1, Math.max(0.06, 1 - prog * 0.95));
      drawDummyFace(p.size, Math.max(0, 1 - prog * 1.25));
      ctx.restore();
    } else if (p.kind === "warpMote") {
      // a は粒ごとの上昇速度
      ctx.fillStyle = `rgba(${WARP_CORE_RGB},${(1 - prog) * 0.95})`;
      const y = p.y - prog * p.a;
      ctx.fillRect(p.x - p.size / 2, y - p.size / 2, p.size, p.size * 2.2);
    }
  }

  function drawParticlesOver() {
    for (const p of G.particles) {
      const lr = clamp(p.life / p.maxLife, 0, 1);
      if (WARP_KINDS[p.kind]) {
        drawWarpParticle(p);
      } else if (p.kind === "blood") {
        // 白と灰色だけのステージでは血の色を使わず、砕けた破片として描く
        ctx.fillStyle = isMonochrome() ? `rgba(238,238,238,${lr})` : `rgba(150,15,15,${lr})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
      } else if (p.kind === "spark") {
        ctx.fillStyle = `rgba(255,${180 + Math.random() * 60 | 0},80,${lr})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === "smoke") {
        ctx.fillStyle = `rgba(60,60,60,${lr * 0.5})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - lr), 0, 6.283); ctx.fill();
      } else if (p.kind === "flash") {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = `rgba(255,225,140,${lr})`;
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 6.283); ctx.fill();
        ctx.restore();
      } else if (p.kind === "boom") {
        ctx.fillStyle = `rgba(255,${(120 + lr * 120) | 0},40,${lr})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, (1 - lr) * 110 + 10, 0, 6.283); ctx.fill();
      } else if (p.kind === "slash") {
        const half = p.arc || 0.95;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(235,245,255,${lr})`; ctx.lineWidth = 4 * lr + 1;
        ctx.beginPath(); ctx.arc(0, 0, p.size, -half, half); ctx.stroke();
        ctx.restore();
      } else if (p.kind === "heal") {
        ctx.fillStyle = `rgba(115,245,145,${lr})`;
        ctx.fillRect(p.x - 1.5, p.y - p.size / 2, 3, p.size);
        ctx.fillRect(p.x - p.size / 2, p.y - 1.5, p.size, 3);
      } else if (p.kind === "dust") {
        ctx.fillStyle = `rgba(145,120,88,${lr * 0.7})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.5 - lr * 0.4), 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "bite") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(255,235,205,${lr})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, p.size, -0.7, 0.7); ctx.stroke(); ctx.restore();
      } else if (p.kind === "shieldHit") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(145,255,246,${lr})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1.35 - lr * 0.35), -1.05, 1.05); ctx.stroke(); ctx.restore();
      } else if (p.kind === "armorHit") {
        ctx.strokeStyle = `rgba(145,195,235,${lr})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x - p.size * lr, p.y); ctx.lineTo(p.x + p.size * lr, p.y); ctx.stroke();
      } else if (p.kind === "equip") {
        ctx.fillStyle = p.a > 0.5 ? `rgba(105,245,235,${lr})` : `rgba(105,175,245,${lr})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === "parry") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(255,241,145,${lr})`; ctx.lineWidth = 6 * lr + 1;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1.7 - lr * 0.7), -1.2, 1.2); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,220,${lr})`;
        for (let i = -1; i <= 1; i++) ctx.fillRect(8 + (1 - lr) * 18, i * 10 - 2, 10, 4);
        ctx.restore();
      } else if (p.kind === "stun") {
        ctx.fillStyle = `rgba(255,225,90,${lr})`;
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3 + (1 - lr) * 4;
          ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * p.size, p.y + Math.sin(a) * 4, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  function drawFootstepPings() {
    for (const ping of G.soundPings) {
      const lr = clamp(ping.life / ping.maxLife, 0, 1);
      const radius = 12 + (1 - lr) * 54;
      ctx.strokeStyle = `rgba(255,184,74,${lr * 0.9})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ping.x, ping.y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,210,120,${lr})`;
      ctx.beginPath(); ctx.ellipse(ping.x - 4, ping.y - 2, 3, 6, -0.35, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ping.x + 5, ping.y + 3, 3, 6, -0.35, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 時間帯に応じた色かぶり。夜は青く暗く、朝夕はオレンジ寄り。
  function drawNightTint(vw, vh) {
    const light = daylight();
    const dark = 1 - light;
    if (dark < 0.02) return;
    ctx.save();
    ctx.fillStyle = `rgba(10,18,48,${dark * 0.52})`;
    ctx.fillRect(0, 0, vw, vh);
    // 日の出・日の入りの時間帯だけ暖色をひとさじ
    const warm = Math.max(0, 1 - Math.abs(light - 0.45) * 4);
    if (warm > 0.01) {
      ctx.fillStyle = `rgba(255,132,54,${warm * 0.14})`;
      ctx.fillRect(0, 0, vw, vh);
    }
    ctx.restore();
  }

  // 追われている間は画面の縁が脈打つ。姿が見えなくても危険が分かるように。
  function drawHuntedWarning(vw, vh) {
    const cr = G.creature;
    if (!cr || !cr.hunting) return;
    const me = localSoldier();
    if (!me || me.dead || cr.targetId !== me.id) return;
    const d = Math.sqrt(dist2(me.x, me.y, cr.x, cr.y));
    const closeness = clamp(1 - d / 700, 0, 1);
    const pulse = 0.35 + Math.sin(now() * 0.009) * 0.2;
    const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.22, vw / 2, vh / 2, Math.max(vw, vh) * 0.62);
    g.addColorStop(0, "rgba(120,0,0,0)");
    g.addColorStop(1, `rgba(120,0,0,${(0.25 + closeness * 0.45) * pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }

  function drawVisionMask(vw, vh) {
    if (spectating) return;        // 観戦中は視界制限なし
    if (fullVisionNow()) return;   // 朝は戦場全体が見える
    const me = localSoldier();
    if (!me) return;
    const px = me.x - camX, py = me.y - camY;
    // 倒れて復活も見込めない間は、選択待ちのあいだも少し広く見せる
    const eliminatedView = me.dead && !teamAlive(me.team);
    const radius = eliminatedView ? currentVisionRadius() * 1.7 : me.dead ? 115 : currentVisionRadius();
    ctx.save();
    ctx.fillStyle = "rgba(3,6,2,0.83)";
    ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.arc(px, py, radius, 0, Math.PI * 2, true); ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(3,6,2,0.32)"; ctx.lineWidth = 76;
    ctx.beginPath(); ctx.arc(px, py, Math.max(30, radius - 38), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawFootstepIndicators(vw, vh) {
    const me = localSoldier();
    if (!me || me.dead) return;
    const px = me.x - camX, py = me.y - camY;
    const sight = currentVisionRadius();
    for (const ping of G.soundPings) {
      const dx = ping.x - me.x, dy = ping.y - me.y, d = Math.hypot(dx, dy) || 1;
      if (d < sight * 0.82) continue;
      const r = Math.min(sight - 28, Math.min(vw, vh) * 0.42);
      const x = clamp(px + dx / d * r, 24, vw - 24);
      const y = clamp(py + dy / d * r, 50, vh - 24);
      const lr = clamp(ping.life / ping.maxLife, 0, 1);
      ctx.fillStyle = `rgba(255,171,55,${0.45 + lr * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#241704"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", x, y + 1);
    }
  }

  function drawNameTags() {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const mine = localTeam();
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || !isEntityVisible(s)) continue;
      const def = teamDef(s.team);
      // 降下中は本体が上にずれているので、名札も持ち上げる(傘に重ならない高さへ)
      const alt = dropAltitude(s);
      const tx = s.x, ty = s.y - alt - (alt > 0 ? 58 : SOLDIER_R + 16);
      // HPバー: 味方は緑、それ以外はその軍の色
      const bw = 38, bh = 4;
      const ratio = clamp(s.hp / s.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, bh + 2);
      ctx.fillStyle = s.dummy ? "#d9c98f" : s.team === mine ? "#46d36a" : def.flag;
      ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, bh);
      // 名前 + Lv (味方には◆を付けて見分けやすく)
      ctx.font = "bold 12px -apple-system, sans-serif";
      const mark = s.id === G.localId ? "▼ " : s.team === mine ? "◆ " : "";
      const cls = classDef(s.classKey);
      const label = s.dummy ? s.name
        : mark + (cls.key === "soldier" ? "" : cls.icon + " ") + s.name + " Lv" + s.level;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = s.dummy ? "#e6dcbb" : s.id === G.localId ? YOU_ACCENT : def.text;
      ctx.fillText(label, tx, ty);
    }
    for (const dog of G.dogs) {
      if (dog.dead || !isEntityVisible(dog)) continue;
      const def = teamDef(dog.team);
      const tx = dog.x, ty = dog.y - DOG_R - 14;
      const bw = 31, ratio = clamp(dog.hp / dog.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.58)"; ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, 6);
      ctx.fillStyle = def.dogBar; ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, 4);
      ctx.font = "bold 10px -apple-system, sans-serif";
      const label = `K9 ${dog.name}`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = def.text; ctx.fillText(label, tx, ty);
    }
    for (const tank of G.tanks) {
      if (tank.dead || !isEntityVisible(tank)) continue;
      const def = teamDef(tank.team);
      const driver = G.soldiers.find((s) => s.id === tank.driverId);
      const tx = tank.x, ty = tank.y - TANK_R - 18;
      const bw = 58, ratio = clamp(tank.hp / tank.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, 7);
      ctx.fillStyle = def.tankBar; ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, 5);
      ctx.font = "bold 12px -apple-system, sans-serif";
      const label = driver ? `▣ ${driver.name}の戦車` : `▣ ${tank.name}`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.82)"; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = def.text; ctx.fillText(label, tx, ty);
    }
  }

  function drawMinimap() {
    const mw = mini.width, mh = mini.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "rgba(20,26,14,0.85)";
    mctx.fillRect(0, 0, mw, mh);
    const sx = mw / WORLD_W, sy = mh / WORLD_H;
    for (const base of G.bases) {
      if (base.hidden) continue;
      const def = teamDef(base.team);
      mctx.strokeStyle = hexToRgba(def.flag, base.hp > 0 ? 0.85 : 0.3);
      mctx.lineWidth = 1.5; mctx.strokeRect(base.x * sx - 5, base.y * sy - 5, 10, 10);
      if (base.hp <= 0) {
        // 陥落した基地には×印
        mctx.beginPath();
        mctx.moveTo(base.x * sx - 5, base.y * sy - 5); mctx.lineTo(base.x * sx + 5, base.y * sy + 5);
        mctx.moveTo(base.x * sx + 5, base.y * sy - 5); mctx.lineTo(base.x * sx - 5, base.y * sy + 5);
        mctx.stroke();
      }
    }
    // 障害物
    for (const o of G.obstacles) {
      if (o.type === "wall" || o.type === "ruin") {
        mctx.fillStyle = "rgba(255,255,255,0.22)";
        mctx.fillRect(o.x * sx, o.y * sy, Math.max(1, o.w * sx), Math.max(1, o.h * sy));
      } else if (o.type === "bush" || o.type === "tree") {
        mctx.fillStyle = "rgba(110,190,110,0.24)";
        mctx.fillRect(o.x * sx, o.y * sy, Math.max(1, o.w * sx), Math.max(1, o.h * sy));
      }
    }
    for (const kit of G.pickups) {
      if (!kit.active) continue;
      mctx.fillStyle = kit.kind === "medkit" ? "#62df7a" : kit.kind === "armor" ? "#65aaf0" : "#74e9e2";
      mctx.fillRect(kit.x * sx - 1, kit.y * sy - 1, 2, 2);
    }
    // 兵士
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || !isEntityVisible(s)) continue;
      mctx.fillStyle = s.id === G.localId ? YOU_ACCENT : s.dummy ? "#d9c98f" : teamDef(s.team).flag;
      const r = s.id === G.localId ? 3 : 2;
      mctx.beginPath(); mctx.arc(s.x * sx, s.y * sy, r, 0, 6.283); mctx.fill();
    }
    for (const dog of G.dogs) {
      if (dog.dead || !isEntityVisible(dog)) continue;
      mctx.fillStyle = teamDef(dog.team).dogBar;
      mctx.beginPath(); mctx.arc(dog.x * sx, dog.y * sy, 1.7, 0, Math.PI * 2); mctx.fill();
    }
    for (const tank of G.tanks) {
      if (tank.dead || !isEntityVisible(tank)) continue;
      mctx.fillStyle = tank.driverId === G.localId ? YOU_ACCENT : teamDef(tank.team).tankBar;
      mctx.fillRect(tank.x * sx - 3, tank.y * sy - 3, 6, 6);
    }
    for (const beast of G.beasts) {
      if (beast.dead) continue;
      mctx.fillStyle = "rgba(197,106,58,0.9)";
      mctx.beginPath(); mctx.arc(beast.x * sx, beast.y * sy, 2.4, 0, Math.PI * 2); mctx.fill();
    }
    if (G.swordRock && !G.swordRock.pulled) {
      // 剣のある岩は、どこからでも分かるように印を出す
      mctx.strokeStyle = "#e2ffc4"; mctx.lineWidth = 1.5;
      const rx = G.swordRock.x * sx, ry = G.swordRock.y * sy;
      mctx.beginPath(); mctx.moveTo(rx, ry - 5); mctx.lineTo(rx, ry + 5); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(rx - 4, ry - 1); mctx.lineTo(rx + 4, ry - 1); mctx.stroke();
    }
    const cr = G.creature;
    if (cr && (spectating || cr.hunting)) {
      mctx.fillStyle = "rgba(255,60,45,0.9)";
      mctx.beginPath(); mctx.arc(cr.x * sx, cr.y * sy, 3, 0, Math.PI * 2); mctx.fill();
    }
    // 銃座は常に位置が分かる(マップ上の固定設備なので)
    for (const turret of G.turrets) {
      if (turret.dead) continue;
      mctx.strokeStyle = turret.gunnerId === G.localId ? YOU_ACCENT
        : turret.team >= 0 ? teamDef(turret.team).flag : "rgba(220,220,200,0.55)";
      mctx.lineWidth = 1.5;
      mctx.beginPath(); mctx.arc(turret.x * sx, turret.y * sy, 2.6, 0, Math.PI * 2); mctx.stroke();
    }
    mctx.strokeStyle = "#ffb84a"; mctx.lineWidth = 1;
    for (const ping of G.soundPings) {
      const r = 1 + (1 - ping.life / ping.maxLife) * 4;
      mctx.beginPath(); mctx.arc(ping.x * sx, ping.y * sy, r, 0, Math.PI * 2); mctx.stroke();
    }
  }

  // ============================================================
  //  HUD
  // ============================================================
  // 4軍スコアボード。DOMは1度だけ組み立て、以降は数値だけ書き換える。
  let teamCards = null;
  function buildTeamBoard() {
    el.teamBoard.innerHTML = "";
    teamCards = TEAMS.map((team) => {
      const def = teamDef(team);
      const card = document.createElement("div");
      card.className = "team-card";
      card.style.setProperty("--team", def.flag);
      card.innerHTML =
        `<span class="tc-name"></span>` +
        `<span class="tc-kills"><b></b><i>撃破</i></span>` +
        `<span class="tc-base"><span class="tc-base-fill"></span></span>` +
        `<span class="tc-basehp"></span>`;
      el.teamBoard.appendChild(card);
      return {
        card,
        name: card.querySelector(".tc-name"),
        kills: card.querySelector(".tc-kills b"),
        fill: card.querySelector(".tc-base-fill"),
        hp: card.querySelector(".tc-basehp"),
      };
    });
  }

  function updateTeamBoard() {
    if (!teamCards) buildTeamBoard();
    const mine = localTeam();
    for (const team of TEAMS) {
      const c = teamCards[team];
      const base = G.bases[team];
      // 練習場には他の軍がいないのでカードごと隠す
      const absent = !!(base && base.hidden);
      c.card.classList.toggle("hidden", absent);
      if (absent) continue;
      const fallen = !base || base.hp <= 0;
      // 既定名のままなら短縮名を出す(狭いHUDで省略されないように)
      const def = teamDef(team);
      c.name.textContent = G.armyNames[team] === def.name ? def.short : G.armyNames[team];
      c.kills.textContent = G.score[team];
      c.fill.style.transform = `scaleX(${base ? clamp(base.hp / base.maxHp, 0, 1) : 0})`;
      c.hp.textContent = fallen ? "陥落" : Math.ceil(base.hp);
      c.card.classList.toggle("mine", team === mine);
      c.card.classList.toggle("fallen", fallen);
    }
  }

  let lastFeedKey = "";
  function updateHUD() {
    const me = localSoldier();
    updateTeamBoard();
    const phase = dayPhase();
    el.daytime.textContent = phase.label;
    el.daytime.className = "daytime " + phase.key;
    document.body.classList.toggle("spectating", spectating);
    if (spectating) {
      const watched = G.soldiers.find((s) => s.id === spectateTargetId);
      el.vehicleHint.textContent = watched
        ? `👁 観戦中：${watched.name}（${G.armyNames[watched.team]}）`
        : "👁 観戦中";
      el.vehicleHint.classList.remove("hidden");
    }
    // 観戦中は自分の装備欄を更新しない(キルフィードは下で更新する)
    if (me && !spectating) {
      const tank = me.vehicleId >= 0 ? G.tanks.find((x) => x.id === me.vehicleId && !x.dead) : null;
      const active = tank || me;
      const ratio = clamp(active.hp / active.maxHp, 0, 1);
      el.hpFill.style.width = (ratio * 100) + "%";
      el.hpFill.style.background = ratio > 0.5 ? "linear-gradient(90deg,#46d36a,#8cf06a)" : ratio > 0.25 ? "linear-gradient(90deg,#e3b341,#f0d36a)" : "linear-gradient(90deg,#e3413f,#ff7a6a)";
      const canRespawn = teamAlive(me.team);
      el.hpText.textContent = me.dead ? (canRespawn ? "復活中" : "戦死") : Math.max(0, Math.ceil(active.hp));
      const armorRatio = clamp((me.armor || 0) / (me.maxArmor || 100), 0, 1);
      const shieldRatio = clamp((me.shield || 0) / (me.maxShield || 160), 0, 1);
      el.armorFill.style.transform = `scaleX(${armorRatio})`;
      el.shieldFill.style.transform = `scaleX(${shieldRatio})`;
      el.armorText.textContent = Math.ceil(me.armor || 0);
      el.shieldText.textContent = Math.ceil(me.shield || 0);
      if (me.dead) el.shieldState.textContent = "装備を再支給中";
      else if (tank) el.shieldState.textContent = "装備は車内に保管";
      else if (me.shield <= 0) el.shieldState.textContent = "盾破損・基地で修理";
      else if (me.parryUntil > 0 && now() <= me.parryUntil) el.shieldState.textContent = "PARRY受付中！";
      else if (me.shieldRaised) el.shieldState.textContent = "盾展開中・正面防御";
      else if (now() < me.parryCooldownUntil) el.shieldState.textContent = `パリィ再使用 ${((me.parryCooldownUntil - now()) / 1000).toFixed(1)}秒`;
      else el.shieldState.textContent = isTouch ? "「盾」を攻撃直前に押してパリィ" : "Qを攻撃直前に押してパリィ";
      el.shieldState.classList.toggle("raised", !!me.shieldRaised || (me.parryUntil > 0 && now() <= me.parryUntil));
      const sinceHit = now() - (me.lastDamagedAt == null ? -99999 : me.lastDamagedAt);
      if (me.dead) {
        el.recovery.textContent = canRespawn ? "" : "基地を失ったため復活できません（観戦中）";
        el.recovery.classList.toggle("waiting", !canRespawn);
      } else if (!canRespawn) {
        el.recovery.textContent = "基地陥落・次に倒れたら脱落";
        el.recovery.classList.add("waiting");
      } else if (tank) {
        el.recovery.textContent = "戦車装甲";
        el.recovery.classList.remove("waiting");
      } else if (inFriendlyBase(me) && me.hp < me.maxHp - 0.05) {
        el.recovery.textContent = `基地で回復中 +${BASE_HEAL_PER_SEC}/秒`;
        el.recovery.classList.remove("waiting");
      } else if (me.hp >= me.maxHp - 0.05) {
        el.recovery.textContent = inFriendlyBase(me) ? "基地：弾薬・グレネード補給" : "体力最大";
        el.recovery.classList.remove("waiting");
      } else if (sinceHit < AUTO_HEAL_DELAY_MS) {
        el.recovery.textContent = `自動回復まで ${Math.ceil((AUTO_HEAL_DELAY_MS - sinceHit) / 1000)}秒`;
        el.recovery.classList.add("waiting");
      } else {
        el.recovery.textContent = `自動回復中 +${AUTO_HEAL_PER_SEC}/秒`;
        el.recovery.classList.remove("waiting");
      }
      el.lvText.textContent = me.level;
      el.xpFill.style.width = clamp(me.xp / (me.level * 3), 0, 1) * 100 + "%";
      const turret = me.turretId >= 0 ? G.turrets.find((x) => x.id === me.turretId && !x.dead) : null;
      if (tank) {
        const tw = TANK_WEAPONS[tank.weapon || 0];
        const ready = now() - tank.lastShot >= tw.interval;
        el.wName.textContent = `戦車・${tw.name}`;
        el.ammo.textContent = ready ? "READY" : "装填中";
        el.ammo.classList.toggle("low", !ready);
        el.grenade.textContent = isTouch ? "「武器」で主砲 / 機関銃を切替" : "数字キー・ホイールで主砲 / 機関銃";
      } else if (turret) {
        el.wName.textContent = "機関銃座・重機関銃";
        el.ammo.textContent = "∞";
        el.ammo.classList.remove("low");
        el.grenade.textContent = `銃座 耐久 ${Math.ceil(turret.hp)} / ${turret.maxHp}`;
      } else {
        const w = WEAPONS[me.weapon];
        const slot = me.loadout ? me.loadout.indexOf(me.weapon) : -1;
        el.wName.textContent = slot >= 0 ? `${slot + 1}. ${w.name}` : w.name;
        el.ammo.textContent = w.melee ? "近接 / ∞" : (me.reloading ? "リロード" : me.ammo) + " / " + w.mag;
        el.ammo.classList.toggle("low", !w.melee && !me.reloading && me.ammo <= Math.ceil(w.mag * 0.25));
        const hasWires = (me.maxWires || 0) > 0;
        const wireText = hasWires ? `　🪤 ${me.wires == null ? 0 : me.wires}` : "";
        el.grenade.textContent = `💣 ${me.grenades == null ? 0 : me.grenades}　🧨 ${me.mines == null ? 0 : me.mines}${wireText}`;
        // 鉄線ボタンは罠師のときだけ出す
        wireBtn.classList.toggle("hidden", !hasWires);
      }

      let hint = "";
      const rock = G.swordRock;
      if (!me.dead && rock && !rock.pulled && me.vehicleId < 0 && me.turretId < 0 &&
          dist2(me.x, me.y, rock.x, rock.y) < (SWORD_ROCK_R + SWORD_REACH) ** 2) {
        const left = Math.max(0, (SWORD_PULL_MS - rock.progress) / 1000);
        hint = rock.progress > 0
          ? `剣を抜いている… あと ${left.toFixed(1)} 秒`
          : (isTouch ? "「戦車」を押し続けて剣を抜く" : "E を押し続けて剣を抜く");
      } else if (!me.dead && tank) hint = isTouch ? "「戦車」で降りる" : "E：戦車から降りる";
      else if (!me.dead && me.turretId >= 0) hint = isTouch ? "「戦車」で銃座から離れる" : "E：銃座から離れる";
      else if (!me.dead) {
        const nearby = G.tanks.some((x) => !x.dead && x.team === me.team && x.driverId < 0 && dist2(me.x, me.y, x.x, x.y) < 78 ** 2);
        const nearTurret = G.turrets.some((x) => !x.dead && x.gunnerId < 0 && dist2(me.x, me.y, x.x, x.y) < TURRET_MOUNT_R ** 2);
        if (nearby) hint = isTouch ? "「戦車」で乗り込む" : "E：戦車に乗る";
        else if (nearTurret) hint = isTouch ? "「戦車」で銃座に取り付く" : "E：機関銃座に取り付く";
      }
      el.vehicleHint.textContent = hint;
      el.vehicleHint.classList.toggle("hidden", !hint);
    } else if (!spectating) {
      el.vehicleHint.classList.add("hidden");
    }
    // キルフィード
    const feedKey = G.killfeed.map((f) => `${f.t}:${f.killer || ""}:${f.victim}`).join("|");
    if (feedKey !== lastFeedKey) {
      lastFeedKey = feedKey;
      el.killfeed.innerHTML = "";
      for (const f of G.killfeed) {
        const div = document.createElement("div");
        div.className = "kf-item";
        const kc = f.killerTeam >= 0 ? teamDef(f.killerTeam).text : "#cfd3c2";
        const vc = f.victimTeam >= 0 ? teamDef(f.victimTeam).text : "#cfd3c2";
        if (f.killer) {
          div.innerHTML = `<span class="kf-killer" style="color:${kc}">${esc(f.killer)}</span> ▸ <span class="kf-victim" style="color:${vc}">${esc(f.victim)}</span>`;
        } else {
          div.innerHTML = `<span class="kf-victim" style="color:${vc}">${esc(f.victim)}</span> 戦死`;
        }
        el.killfeed.appendChild(div);
      }
    }
  }
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function showLevelup(lv) {
    el.levelup.textContent = "LEVEL UP!  Lv" + lv;
    el.levelup.classList.remove("hidden");
    el.levelup.style.animation = "none";
    void el.levelup.offsetWidth;
    el.levelup.style.animation = "";
    clearTimeout(showLevelup._t);
    showLevelup._t = setTimeout(() => el.levelup.classList.add("hidden"), 1400);
  }

  // ============================================================
  //  チュートリアル (練習場)
  //  1項目ずつ案内し、実際にその操作をしたら次へ進む。
  //  判定は毎フレームの状態監視だけで行い、戦闘処理には手を入れない。
  // ============================================================
  const TRAINING_STEPS = [
    {
      key: "move", label: "歩いて動いてみる",
      hint: "W A S D キーで前後左右に動きます。",
      hintTouch: "画面左下のスティックを指で倒すと動きます。",
      reset: (c) => { c.movedFor = 0; },
      done: (c) => c.movedFor > 0.8,
    },
    {
      key: "aim", label: "向きを変える",
      hint: "マウスを動かすと、その方向を向きます。",
      hintTouch: "画面右下のスティックを倒した方向を向きます。",
      reset: (c) => { c.turned = 0; },
      done: (c) => c.turned > 1.8,
    },
    {
      key: "attack", label: "マップ中央の的まで行って攻撃する",
      hint: "的は右上のミニマップの真ん中に集まっています。マウスの左ボタンを押している間、撃ち続けます。",
      hintTouch: "的は右上のミニマップの真ん中に集まっています。右下のスティックを倒している間、自動で撃ちます。",
      reset: (c) => { c.attacked = false; },
      done: (c) => c.attacked,
    },
    {
      key: "hit", label: "的に当てる",
      hint: "遠いと当たりません。近づいてから撃つと当てやすいです。",
      reset: (c) => { c.hitTarget = false; },
      done: (c) => c.hitTarget,
    },
    {
      key: "kill", label: "的を1つ壊す",
      hint: "壊れた的は数秒で立て直ります。何度でも練習できます。",
      reset: (c, me) => { c.killsAtStart = me.kills; },
      done: (c, me) => me.kills > c.killsAtStart,
    },
    {
      key: "reload", label: "弾を入れかえる（リロード）",
      hint: "R キーでリロードします。撃ち切ったときも自動で始まります。",
      hintTouch: "右下の「リロード」ボタンを押します。",
      applies: (me) => me.loadout.some((i) => !WEAPONS[i].melee),
      reset: (c) => { c.reloaded = false; },
      done: (c) => c.reloaded,
    },
    {
      key: "swap", label: "武器を持ちかえる",
      hint: "1〜3 キー、またはマウスホイールで切り替えます。",
      hintTouch: "右下の「武器」ボタンで切り替えます。",
      applies: (me) => me.loadout.length > 1,
      reset: (c) => { c.swapped = false; },
      done: (c) => c.swapped,
    },
    {
      key: "dash", label: "ダッシュで走る",
      hint: "Shift を押しながら動くと速く走れます。そのぶん足音は大きくなります。",
      hintTouch: "スティックをいっぱいまで倒すと走ります。足音は大きくなります。",
      reset: (c) => { c.dashedFor = 0; },
      done: (c) => c.dashedFor > 0.5,
    },
    {
      key: "grenade", label: "グレネードを投げる",
      hint: "G キーで、向いている方向へ投げます。自分も巻きこまれるので離れて投げましょう。",
      hintTouch: "「💣 投げる」ボタンで投げます。自分も巻きこまれるので離れて投げましょう。",
      applies: (me) => (me.maxGrenades || 0) > 0,
      reset: (c) => { c.threwGrenade = false; },
      done: (c) => c.threwGrenade,
    },
    {
      key: "mine", label: "地雷を置く",
      hint: "F キーで足元に置きます。約1秒後に作動するので、置いたらすぐ離れましょう。",
      hintTouch: "「🧨 地雷」ボタンで足元に置きます。置いたらすぐ離れましょう。",
      applies: (me) => (me.maxMines || 0) > 0,
      reset: (c) => { c.placedMine = false; },
      done: (c) => c.placedMine,
    },
    {
      key: "wire", label: "有刺鉄線を張る",
      hint: "C キーで張ります。踏んだ敵の足が止まり、じわじわ体力が減ります。",
      hintTouch: "「🪤 鉄線」ボタンで張ります。踏んだ敵の足が止まります。",
      applies: (me) => (me.maxWires || 0) > 0,
      reset: (c) => { c.placedWire = false; },
      done: (c) => c.placedWire,
    },
    {
      key: "shield", label: "盾を構える",
      hint: "Q を押すとパリィ、押しっぱなしで防御します。",
      hintTouch: "「🛡 盾」を押すとパリィ、押しっぱなしで防御します。",
      reset: (c) => { c.usedShield = false; },
      done: (c) => c.usedShield,
    },
    {
      key: "turret", label: "機関銃座に取り付く",
      hint: "射撃場のまわりに3つあります。近づいて E キーです。",
      hintTouch: "射撃場のまわりに3つあります。近づいて「戦車」ボタンです。",
      done: (c, me) => me.turretId >= 0,
    },
    {
      key: "tank", label: "戦車に乗る",
      hint: "自分の基地のそばにあります。近づいて E キーです。",
      hintTouch: "自分の基地のそばにあります。近づいて「戦車」ボタンです。",
      done: (c, me) => me.vehicleId >= 0,
    },
    {
      key: "base", label: "自分の基地に戻る",
      hint: "基地の円の中に入ると、体力・弾薬・グレネードが回復します。",
      done: (c, me) => inFriendlyBase(me),
    },
  ];

  let training = null;

  // 試合の開始時に、実績の集計と練習メニューをまとめて初期化する
  function beginMatchTracking() {
    runStats = emptyRunStats();
    resetTraining();
  }

  function resetTraining() {
    training = isTraining() ? {
      idx: 0, armed: false, done: false, skip: false,
      movedFor: 0, turned: 0, dashedFor: 0, killsAtStart: 0,
      attacked: false, hitTarget: false, reloaded: false, swapped: false,
      threwGrenade: false, placedMine: false, placedWire: false, usedShield: false,
      lastAim: null, lastShot: null, lastWeapon: null,
      lastGrenades: null, lastMines: null, lastWires: null, dummyHp: null,
    } : null;
    renderTrainingPanel();
  }

  // 兵科によって出番のない項目(侍のリロード等)は最初から数えない
  function trainingApplicable(me) {
    return TRAINING_STEPS.filter((step) => !step.applies || !me || step.applies(me));
  }

  function trackTrainingInput(me, dt, t) {
    const c = training;
    if (me.moving) c.movedFor += dt;
    if (c.lastAim != null) {
      c.turned += Math.abs(((me.aimAngle - c.lastAim + Math.PI) % (Math.PI * 2)) - Math.PI);
    }
    c.lastAim = me.aimAngle;
    if (localInput.dash && me.moving) c.dashedFor += dt;
    if (c.lastShot != null && me.lastShot !== c.lastShot) c.attacked = true;
    c.lastShot = me.lastShot;
    if (me.reloading) c.reloaded = true;
    if (c.lastWeapon != null && me.weapon !== c.lastWeapon) c.swapped = true;
    c.lastWeapon = me.weapon;
    if (c.lastGrenades != null && me.grenades < c.lastGrenades) c.threwGrenade = true;
    c.lastGrenades = me.grenades;
    if (c.lastMines != null && me.mines < c.lastMines) c.placedMine = true;
    c.lastMines = me.mines;
    if (c.lastWires != null && me.wires < c.lastWires) c.placedWire = true;
    c.lastWires = me.wires;
    if (me.shieldRaised || (me.parryUntil > 0 && t <= me.parryUntil)) c.usedShield = true;
    // 的の合計体力が減っていたら、どれかに当たったということ
    let hp = 0;
    for (const s of G.soldiers) if (s.dummy && !s.dead) hp += s.hp;
    if (c.dummyHp != null && hp < c.dummyHp - 0.5) c.hitTarget = true;
    c.dummyHp = hp;
  }

  function updateTraining(dt, t) {
    if (!training || training.done) return;
    const me = localSoldier();
    if (!me || me.dead) return;
    trackTrainingInput(me, dt, t);
    // 上限を付けて回す(判定が一気に通っても1フレームで暴走させない)
    for (let guard = 0; guard <= TRAINING_STEPS.length; guard++) {
      const step = TRAINING_STEPS[training.idx];
      if (!step) { finishTraining(); return; }
      if (step.applies && !step.applies(me)) { training.idx++; training.armed = false; continue; }
      // 案内を出したフレームでは判定しない(前の操作で即クリアさせないため)
      if (!training.armed) {
        training.armed = true;
        if (step.reset) step.reset(training, me);
        renderTrainingPanel();
        return;
      }
      if (!training.skip && !step.done(training, me)) return;
      training.skip = false;
      training.idx++;
      training.armed = false;
      if (training.idx < TRAINING_STEPS.length) Audio.heal();
    }
  }

  function finishTraining() {
    if (!training || training.done) return;
    training.done = true;
    banner("練習メニュー修了！　このまま好きなだけ練習できます");
    renderTrainingPanel();
    if (runStats) runStats.trainedAll = true;
    checkAchievements();
  }

  function renderTrainingPanel() {
    if (!training || !isTraining()) { el.trainingPanel.classList.add("hidden"); return; }
    el.trainingPanel.classList.remove("hidden");
    const me = localSoldier();
    const list = trainingApplicable(me);
    const step = TRAINING_STEPS[training.idx] || null;
    const cleared = training.done || !step ? list.length : Math.max(0, list.indexOf(step));
    el.tpProgress.textContent = `${cleared} / ${list.length}`;
    if (training.done || !step) {
      el.tpSteps.innerHTML =
        `<li class="tp-cur clear">🎖 ぜんぶクリア！</li>` +
        `<li class="tp-hint">このまま自由に練習できます。メニューから本番のステージへどうぞ。</li>`;
      el.tpSkip.classList.add("hidden");
      return;
    }
    const rows = [
      `<li class="tp-cur">▶ ${esc(step.label)}</li>`,
      `<li class="tp-hint">${esc(isTouch && step.hintTouch ? step.hintTouch : step.hint)}</li>`,
    ];
    for (let i = cleared + 1; i < Math.min(cleared + 3, list.length); i++) {
      rows.push(`<li class="tp-next">○ ${esc(list[i].label)}</li>`);
    }
    el.tpSteps.innerHTML = rows.join("");
    el.tpSkip.classList.remove("hidden");
  }

  // ============================================================
  //  ゲームループ
  // ============================================================
  let lastT = 0, snapAcc = 0, inputAcc = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastT) lastT = ts;
    let dt = (ts - lastT) / 1000;
    lastT = ts;
    if (dt > 0.05) dt = 0.05;
    dtGlobal = dt;

    if (G && G.running) {
      const t = now();
      gatherLocalInput();

      if (mode === "client") {
        // 入力送信のみ。状態は受信を反映
        inputAcc += dt;
        if (inputAcc >= 1 / INPUT_HZ) {
          inputAcc = 0;
          Net.sendInput(localInput);
          localInput.reloadEdge = false; localInput.grenadeEdge = false; localInput.interactEdge = false; localInput.parryEdge = false; localInput.mineEdge = false; localInput.wireEdge = false;
          localInput.weaponWanted = -1;
        }
        interpClient(dt);
      } else {
        simulate(dt, t);
        if (mode === "host") {
          snapAcc += dt;
          if (snapAcc >= 1 / SNAP_HZ) { snapAcc = 0; Net.broadcastSnapshot(); }
        }
      }
      checkElimination();
      updateCamera();
      render();
    }
  }
  requestAnimationFrame(loop);

  // クライアント: 受信状態へ滑らかに補間
  function interpClient(dt) {
    for (const s of G.soldiers) {
      s.x = lerp(s.x, s.rx, clamp(dt * 14, 0, 1));
      s.y = lerp(s.y, s.ry, clamp(dt * 14, 0, 1));
      if (s.moving) s.legPhase += dt * 12;
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 4);
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 26);
    }
    for (const tank of G.tanks) {
      tank.x = lerp(tank.x, tank.rx, clamp(dt * 11, 0, 1));
      tank.y = lerp(tank.y, tank.ry, clamp(dt * 11, 0, 1));
    }
    for (const dog of G.dogs) {
      dog.x = lerp(dog.x, dog.rx, clamp(dt * 14, 0, 1));
      dog.y = lerp(dog.y, dog.ry, clamp(dt * 14, 0, 1));
    }
    // 弾はローカルで前進(見た目)
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.traveled += Math.hypot(b.vx, b.vy) * dt;
      if (b.traveled > b.range) G.bullets.splice(i, 1);
    }
    for (const g of G.grenades) {
      g.x += g.vx * dt; g.y += g.vy * dt;
      g.rotation += Math.hypot(g.vx, g.vy) * dt * 0.08;
    }
    if (G.creature) G.creature.limbPhase += dt * (G.creature.hunting ? 15 : 4);
    updateFootsteps(dt, now());
    updateParticles(dt);
  }

  // ============================================================
  //  マッチ制御
  // ============================================================
  function startSoloMatch() {
    mode = "sp";
    G = emptyState();
    G.obstacles = genMap();
    G.goal = BASE_MAX_HP;
    spawnTeams();
    spawnDogs();
    spawnTanks();
    spawnTurrets();
    spawnCreature();
    spawnSwordRock();
    spawnBeasts();
    spawnMedkits();
    el.scoreGoal.textContent = isTraining() ? "練習メニューを順番にこなそう" : "他3軍の基地をすべて破壊";
    resize();
    hideOverlays();
    beginMatchTracking();
    beginDrop();
    G.running = true;
    G.over = false;
    Audio.startBgm(stageDef().bgm);
    if (G.dropAt) banner("降下開始！　着地したら戦闘開始だ");
  }

  function endMatch(winnerTeam) {
    if (G.over) return;
    G.over = true;
    G.running = false;
    showMatchResult(winnerTeam);
    if (mode === "host") Net.broadcastEnd(winnerTeam);
  }

  function showMatchResult(winnerTeam) {
    const me = localSoldier();
    const win = !!me && winnerTeam === me.team;
    commitRun(win);
    let reward = 0;
    if (!G.rewardClaimed) {
      G.rewardClaimed = true;
      if (win) {
        reward = WIN_REWARD;
        money += reward;
        saveProgress();
      }
    }
    el.resultTitle.textContent = win ? "勝利！ 🎖" : "敗北…";
    el.resultTitle.style.color = win ? "#8cf06a" : "#ff7a6a";
    el.rewardSummary.textContent = win ? `勝利報酬 +${reward || WIN_REWARD} G` : `勝利すると ${WIN_REWARD} G 獲得できます`;
    el.rewardSummary.classList.toggle("win", win);

    // 4軍の順位表: 基地が健在な軍が上、あとは撃破数順。
    const standings = TEAMS.map((team) => ({
      team,
      alive: G.bases[team] && G.bases[team].hp > 0,
      kills: G.score[team],
    })).sort((a, b) => (b.team === winnerTeam) - (a.team === winnerTeam) || b.alive - a.alive || b.kills - a.kills);

    const mine = localTeam();
    const table = standings.map((row, i) => {
      const def = teamDef(row.team);
      const tags = [row.team === winnerTeam ? "🎖 勝利" : row.alive ? "基地健在" : "基地陥落"];
      if (row.team === mine) tags.push("あなたの軍");
      return `<div class="row standing${row.team === mine ? " mine" : ""}">` +
        `<span><i class="dot" style="background:${def.flag}"></i>${i + 1}. ${esc(G.armyNames[row.team])}` +
        `<em>${tags.join(" / ")}</em></span><b>${row.kills} 撃破</b></div>`;
    }).join("");

    const personal = [
      ["あなたのキル", me ? me.kills : 0],
      ["あなたのデス", me ? me.deaths : 0],
      ["最終レベル", me ? me.level : 1],
    ].map(r => `<div class="row"><span>${r[0]}</span><b>${esc(String(r[1]))}</b></div>`).join("");
    el.resultStats.innerHTML = table + `<div class="result-divider"></div>` + personal;
    renderShop();
    el.eliminated.classList.add("hidden");
    el.trainingPanel.classList.add("hidden");
    Audio.stopBgm();
    el.touch.classList.add("hidden");
    el.result.classList.remove("hidden");
  }

  function hideOverlays() {
    el.menu.classList.add("hidden");
    el.pause.classList.add("hidden");
    el.help.classList.add("hidden");
    el.result.classList.add("hidden");
    el.eliminated.classList.add("hidden");
    eliminationPrompted = false;
    spectating = false;
    spectateTargetId = -1;
    matchPaused = false;
    pauseStartedAt = 0;
    helpOrigin = "menu";
    if (isTouch) el.touch.classList.remove("hidden");
  }

  function isMatchActive() {
    return !!(G && !G.over && (G.running || matchPaused));
  }

  // 自軍が全滅したら一度だけ「観戦する / やめる」を聞く。
  // 試合は止めない(オンラインでは他のプレイヤーが戦い続けているため)。
  function checkElimination() {
    if (!G || G.over || isTraining() || eliminationPrompted || spectating) return;
    const me = localSoldier();
    if (!me || !me.dead) return;
    const team = me.team;
    if (teamAlive(team)) return;
    if (G.soldiers.some((s) => s.team === team && !s.dead)) return;
    eliminationPrompted = true;
    const rivals = TEAMS.filter((t) => t !== team && teamInPlay(t)).map((t) => G.armyNames[t]);
    el.eliminatedDetail.textContent =
      `基地を失い、生き残りも倒されました。もう復活はできません。残っているのは ${rivals.join(" と ")} です。`;
    el.touch.classList.add("hidden");
    el.eliminated.classList.remove("hidden");
  }

  function startSpectating() {
    spectating = true;
    spectateTargetId = -1;
    spectateSwitchAt = 0;
    el.eliminated.classList.add("hidden");
    banner("観戦モード：決着まで戦況を見届けます");
  }

  function clearGameInput() {
    for (const key of Object.keys(keys)) keys[key] = false;
    mouse.down = false;
    stickMove.x = 0; stickMove.y = 0; stickMove.active = false;
    stickAim.x = 0; stickAim.y = 0; stickAim.active = false;
    document.querySelectorAll(".stick .knob").forEach((knob) => { knob.style.transform = "translate(0,0)"; });
    releaseTouchShield();
    touchInteract = false;
    localInput.interactHold = false;
    localInput.mvx = 0; localInput.mvy = 0; localInput.shoot = false; localInput.dash = false;
    localInput.reloadEdge = false; localInput.grenadeEdge = false; localInput.interactEdge = false; localInput.parryEdge = false; localInput.mineEdge = false; localInput.wireEdge = false;
    localInput.weaponWanted = -1; localInput.shield = false;
  }

  // performance.now() を基準にした期限も、停止時間ぶん後ろへずらす。
  function shiftGameTimers(delta) {
    if (!G || delta <= 0) return;
    const shift = (obj, fields) => {
      if (!obj) return;
      for (const field of fields) {
        if (Number.isFinite(obj[field])) obj[field] += delta;
      }
    };

    for (const s of G.soldiers) {
      shift(s, ["respawnAt", "lastDamagedAt", "parryUntil", "parryCooldownUntil", "stunnedUntil", "reloadUntil", "lastShot", "lastGrenade", "lastMine", "lastBaseSupplyAt", "lastFootstepAt", "heardUntil", "muzzle", "dropUntil", "sweepAt"]);
      shift(s.ai, ["think", "strafeUntil", "lastSeen", "lostAt", "fireUntil"]);
    }
    if (G.dropAt) G.dropAt += delta;
    for (const dog of G.dogs) shift(dog, ["respawnAt", "lastAttack", "biteAt", "stunnedUntil"]);
    for (const beast of G.beasts) shift(beast, ["respawnAt", "lastAttack", "roamUntil"]);
    if (G.creature) shift(G.creature, ["lastHeardAt", "roamUntil", "lastRoarAt", "lungeAt"]);
    for (const turret of G.turrets) shift(turret, ["respawnAt", "lastShot", "muzzle"]);
    for (const tank of G.tanks) {
      shift(tank, ["respawnAt", "lastShot", "muzzle"]);
      shift(tank.ai, ["think"]);
    }
    for (const grenade of G.grenades) shift(grenade, ["fuseAt", "bornAt"]);
    for (const m of G.mines) shift(m, ["armAt", "placedAt"]);
    for (const pickup of G.pickups) shift(pickup, ["respawnAt"]);
    for (const base of G.bases) shift(base, ["lastWarningAt"]);
    for (const item of G.killfeed) shift(item, ["t"]);
  }

  function applyPausedState(paused) {
    if (!G || G.over) return false;
    paused = !!paused;
    if (matchPaused === paused) {
      G.running = !paused;
      return false;
    }

    const stamp = now();
    if (paused) {
      pauseStartedAt = stamp;
      clearGameInput();
      G.running = false;
      Audio.pauseBgm();
    } else {
      shiftGameTimers(Math.max(0, stamp - pauseStartedAt));
      pauseStartedAt = 0;
      G.running = true;
      Audio.resumeBgm();
    }
    matchPaused = paused;
    return true;
  }

  function setMatchPaused(paused, sync = true) {
    const changed = applyPausedState(paused);
    if (changed && sync) Net.setPause(!!paused);
    return changed;
  }

  function restoreTouchControls() {
    if (isTouch && el.menu.classList.contains("hidden") && el.help.classList.contains("hidden") &&
        el.pause.classList.contains("hidden") && el.result.classList.contains("hidden") &&
        el.eliminated.classList.contains("hidden") && !spectating) {
      el.touch.classList.remove("hidden");
    }
  }

  function openPauseMenu() {
    if (!isMatchActive()) return;
    setMatchPaused(true);
    el.pause.classList.remove("hidden");
    el.touch.classList.add("hidden");
  }

  function resumeMatch() {
    if (!G || G.over) return;
    el.pause.classList.add("hidden");
    setMatchPaused(false);
    restoreTouchControls();
  }

  function openHelp(origin) {
    helpOrigin = origin;
    if (origin === "game" && isMatchActive()) setMatchPaused(true);
    el.help.classList.remove("hidden");
    el.touch.classList.add("hidden");
  }

  function closeHelp() {
    const origin = helpOrigin;
    el.help.classList.add("hidden");
    helpOrigin = "menu";
    if (origin === "game") {
      el.pause.classList.add("hidden");
      setMatchPaused(false);
    }
    restoreTouchControls();
  }

  function applyNetworkPause(paused) {
    if (!G || G.over) return;
    applyPausedState(paused);
    if (paused) {
      if (el.help.classList.contains("hidden") && el.menu.classList.contains("hidden") && el.result.classList.contains("hidden")) {
        el.pause.classList.remove("hidden");
      }
      el.touch.classList.add("hidden");
    } else {
      el.pause.classList.add("hidden");
      restoreTouchControls();
    }
  }

  // ============================================================
  //  ネットコード (PeerJS, ホスト権威)
  // ============================================================
  const Net = (() => {
    let peer = null, conns = [], hostConn = null;
    const clientInputs = {}; // peerId -> input
    let roomCode = "";
    let pauseOwner = null;
    let lobbyOpen = false;
    let countdownTimer = null;
    let joinRejected = false;

    function loadPeerJS() {
      return new Promise((resolve, reject) => {
        if (window.Peer) return resolve();
        const s = document.createElement("script");
        s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("PeerJS の読み込みに失敗しました(オフライン?)"));
        document.head.appendChild(s);
        setTimeout(() => { if (!window.Peer) reject(new Error("接続がタイムアウトしました")); }, 9000);
      });
    }

    function genCode() {
      const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let r = ""; for (let i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)];
      return r;
    }

    async function host() {
      netMsg("PeerJS を読み込み中…");
      await loadPeerJS();
      roomCode = genCode();
      peer = new window.Peer("wz-" + roomCode, { debug: 0 });
      peer.on("open", () => {
        mode = "host";
        prepareHostLobby();
      });
      peer.on("connection", (conn) => onClientConnect(conn));
      peer.on("error", (e) => netMsg("エラー: " + e.type, true));
    }

    function prepareHostLobby() {
      G = emptyState();
      G.obstacles = genMap();
      G.goal = BASE_MAX_HP;
      spawnTeams();
      spawnDogs();
      spawnTanks();
      spawnTurrets();
      spawnCreature();
      spawnSwordRock();
      spawnBeasts();
      spawnMedkits();
      el.scoreGoal.textContent = "他3軍の基地をすべて破壊";
      resize();
      G.running = false; G.over = false;
      lobbyOpen = true;
      showLobby(roomCode, `あなたは ${G.armyNames[playerTeam]}。コードを共有して仲間を集めよう。`);
      broadcastLobby();
    }

    function showLobby(code, status, counting = false) {
      el.onlineActions.classList.add("hidden");
      el.roomLobby.classList.remove("hidden");
      el.roomLobby.classList.toggle("counting", counting);
      el.roomCode.textContent = code || "----";
      el.lobbyStatus.textContent = status;
      netMsg("");
    }

    function resetLobbyView() {
      el.onlineActions.classList.remove("hidden");
      el.roomLobby.classList.add("hidden");
      el.roomLobby.classList.remove("counting");
      el.roomCode.textContent = "----";
      el.lobbyStatus.textContent = "参加者を待っています…";
      el.lobbyRoster.innerHTML = "";
      el.lobbyStart.classList.add("hidden");
      el.lobbyStart.disabled = false;
    }

    // ロビーの参加者一覧(チーム別)。ホストが作り、そのままクライアントへ送る。
    function buildRoster() {
      if (!G) return [];
      return G.soldiers
        .filter((s) => s.controller !== "cpu")
        .map((s) => ({ n: s.name, tm: s.team }));
    }

    function renderRoster(roster, armyNames) {
      const byTeam = TEAMS.map(() => []);
      for (const p of roster || []) {
        if (p.tm >= 0 && p.tm < TEAM_COUNT) byTeam[p.tm].push(p.n);
      }
      el.lobbyRoster.innerHTML = TEAMS.map((team) => {
        const def = teamDef(team);
        const members = byTeam[team];
        const names = members.length ? members.map((n) => esc(n)).join("、") : "CPUのみ";
        const title = (armyNames && armyNames[team]) || def.name;
        return `<div class="roster-row${members.length ? "" : " empty"}">` +
          `<i class="dot" style="background:${def.flag}"></i>` +
          `<b>${esc(title)}</b><span>${names}</span></div>`;
      }).join("");
    }

    function broadcastLobby() {
      const roster = buildRoster();
      renderRoster(roster, G.armyNames);
      const ready = conns.length > 0;
      el.lobbyStart.classList.toggle("hidden", mode !== "host");
      el.lobbyStart.disabled = !ready || !!countdownTimer;
      el.lobbyStart.textContent = ready ? "全員そろった → 開始" : "参加者を待っています…";
      for (const c of conns) {
        try { c.send({ t: "lobby", roster, names: G.armyNames }); } catch (e) {}
      }
    }

    function sendInit(conn) {
      const slot = G.soldiers.find((s) => s.controller === conn.peer);
      const obstacles = G.obstacles.map((o) => ({
        ...o,
        hp: Number.isFinite(o.hp) ? o.hp : null,
      }));
      conn.send({
        t: "init", obstacles, goal: G.goal, slotId: slot ? slot.id : -1, stage: G.stage,
        armyNames: G.armyNames, you: { team: slot ? slot.team : 1 }, paused: matchPaused,
      });
    }

    function announceCountdown(remaining) {
      const status = `ゲーム開始まで ${remaining} 秒`;
      showLobby(roomCode, status, true);
      for (const c of conns) {
        try { c.send({ t: "countdown", n: remaining }); } catch (e) {}
      }
    }

    // 開始はホストの合図で。チーム編成が済むまで待てるようにするため。
    function beginCountdown() {
      if (!lobbyOpen || countdownTimer || conns.length === 0) return;
      let remaining = MATCH_COUNTDOWN_SECONDS;
      announceCountdown(remaining);
      broadcastLobby();
      countdownTimer = setInterval(() => {
        remaining--;
        if (remaining > 0) announceCountdown(remaining);
        else startHostMatch();
      }, 1000);
    }

    function cancelCountdown() {
      clearInterval(countdownTimer);
      countdownTimer = null;
      if (lobbyOpen) {
        showLobby(roomCode, `あなたは ${G.armyNames[playerTeam]}。コードを共有して仲間を集めよう。`);
        broadcastLobby();
      }
    }

    function startHostMatch() {
      if (!lobbyOpen || conns.length === 0) {
        cancelCountdown();
        return;
      }
      clearInterval(countdownTimer);
      countdownTimer = null;
      lobbyOpen = false;

      // 初期状態をここまで送らず、ホストと参加者の戦闘時間を同じにする。
      for (const c of conns) {
        try { sendInit(c); } catch (e) {}
      }
      hideOverlays();
      beginMatchTracking();
      G.running = true; G.over = false;
      Audio.startBgm(stageDef().bgm);
      showRoomBanner();
    }

    function onClientConnect(conn) {
      conn.on("open", () => {
        if (!lobbyOpen || (G && G.running)) {
          try { conn.send({ t: "reject", reason: "このルームのゲームは開始済みです" }); } catch (e) {}
          setTimeout(() => conn.close(), 250);
          return;
        }
        conns.push(conn);
        // 枠の割り当ては hello(希望チームを含む)を受け取ってから行う。
      });
      conn.on("data", (d) => {
        if (d.t === "hello") {
          if (G.soldiers.some((x) => x.controller === conn.peer)) return; // 二重hello
          const slot = pickSlotForClient(d.team);
          if (!slot) {
            conns = conns.filter((c) => c !== conn);
            try { conn.send({ t: "reject", reason: "このルームは満員です" }); } catch (e) {}
            setTimeout(() => conn.close(), 250);
            return;
          }
          slot.controller = conn.peer;
          slot.isHuman = true;
          slot.name = d.name ? String(d.name).slice(0, 12) : "Player";
          // 参加者が選んだキャラクターを反映してから強化を乗せる
          applyClass(slot, d.cls || "soldier");
          slot.shopApplied = false;
          applyShopUpgrades(slot, d.upgrades || {});
          clientInputs[conn.peer] = {
            mvx: 0, mvy: 0, aimAngle: 0, shoot: false, dash: false,
            weaponWanted: -1, reloadEdge: false, grenadeEdge: false, interactEdge: false, parryEdge: false, mineEdge: false, wireEdge: false, shield: false,
          };
          // その軍の名前がまだ既定のままなら、最初に入った人の軍名を採用する。
          if (d.army && G.armyNames[slot.team] === TEAM_DEFS[slot.team].name) {
            G.armyNames[slot.team] = String(d.army).slice(0, 16);
          }
          try { conn.send({ t: "slot", team: slot.team, name: G.armyNames[slot.team] }); } catch (e) {}
          broadcastLobby();
        } else if (d.t === "input") {
          clientInputs[conn.peer] = d.i;
        } else if (d.t === "pause") {
          pauseOwner = d.p ? conn.peer : null;
          applyNetworkPause(!!d.p);
          broadcastPause(!!d.p);
        }
      });
      conn.on("close", () => onClientGone(conn));
      conn.on("error", () => onClientGone(conn));
    }

    function onClientGone(conn) {
      conns = conns.filter((c) => c !== conn);
      const s = G && G.soldiers.find((x) => x.controller === conn.peer);
      if (s) { s.controller = "cpu"; s.isHuman = false; s.name = pick(BOT_NAMES); }
      delete clientInputs[conn.peer];
      if (pauseOwner === conn.peer) {
        pauseOwner = null;
        applyNetworkPause(false);
        broadcastPause(false);
      }
      if (lobbyOpen) {
        if (conns.length === 0) cancelCountdown();
        else broadcastLobby();
      }
    }

    // 希望チームを最優先。埋まっていたら人間が少ない軍へ回す。
    function pickSlotForClient(preferred) {
      const humans = TEAMS.map(() => 0);
      for (const s of G.soldiers) if (s.controller !== "cpu") humans[s.team]++;
      const order = TEAMS.slice().sort((a, b) => humans[a] - humans[b]);
      if (preferred >= 0 && preferred < TEAM_COUNT) order.unshift(preferred);
      for (const team of order) {
        const slot = G.soldiers.find((s) => s.team === team && s.controller === "cpu");
        if (slot) return slot;
      }
      return null;
    }

    async function join(code) {
      netMsg("PeerJS を読み込み中…");
      await loadPeerJS();
      mode = "client";
      roomCode = code.toUpperCase();
      joinRejected = false;
      peer = new window.Peer({ debug: 0 });
      peer.on("open", () => {
        netMsg("ホストへ接続中…");
        hostConn = peer.connect("wz-" + roomCode, { reliable: false });
        hostConn.on("open", () => {
          showLobby(roomCode, "接続しました。ホストの開始を待っています…");
          hostConn.send({ t: "hello", name: playerName, army: armyName, team: playerTeam, cls: playerClass, upgrades: shopLevels });
        });
        hostConn.on("data", (d) => onHostData(d));
        hostConn.on("close", () => { if (!joinRejected) netMsg("ホストとの接続が切れました", true); });
        hostConn.on("error", () => netMsg("接続エラー", true));
        setTimeout(() => {
          if (!joinRejected && (!hostConn || hostConn.open !== true)) netMsg("ホストが見つかりません。コードを確認してください", true);
        }, 8000);
      });
      peer.on("error", (e) => netMsg("ルームが見つかりません (" + e.type + ")", true));
    }

    function onHostData(d) {
      if (d.t === "init") {
        G = emptyState();
        if (d.stage) { G.stage = d.stage; playerStage = d.stage; }
        G.obstacles = d.obstacles.map((o) => ({ ...o, hp: o.hp == null ? Infinity : o.hp }));
        G.goal = d.goal;
        G.localId = d.slotId;
        G.armyNames = d.armyNames || G.armyNames;
        if (d.you && d.you.team != null) playerTeam = d.you.team;
        localInput.aimAngle = BASE_SPOTS[playerTeam].heading;
        el.scoreGoal.textContent = "他3軍の基地をすべて破壊";
        resize();
        hideOverlays();
        beginMatchTracking();
        G.running = true; G.over = false;
        Audio.startBgm(stageDef().bgm);
        if (d.paused) applyNetworkPause(true);
      } else if (d.t === "slot") {
        // ホストが決めた所属チーム。希望が通らなかった場合もここで分かる。
        playerTeam = d.team;
        showLobby(roomCode, `あなたは ${d.name || teamDef(d.team).name}。ホストの開始を待っています…`);
      } else if (d.t === "lobby") {
        renderRoster(d.roster, d.names);
      } else if (d.t === "countdown") {
        showLobby(roomCode, `ゲーム開始まで ${d.n} 秒`, true);
      } else if (d.t === "reject") {
        joinRejected = true;
        showLobby(roomCode, d.reason || "このルームには参加できません");
        netMsg(d.reason || "このルームには参加できません", true);
      } else if (d.t === "snap") {
        applySnapshot(d);
      } else if (d.t === "pause") {
        applyNetworkPause(!!d.p);
      } else if (d.t === "end") {
        clientEnd(d.w);
      }
    }

    function applySnapshot(d) {
      if (!G) return;
      G.score = d.sc;
      if (d.an) G.armyNames = d.an;
      if (d.ck != null) G.clock = d.ck;
      for (const nb of (d.bs || [])) {
        const base = G.bases[nb.tm];
        if (!base) continue;
        base.hp = nb.hp; base.maxHp = nb.mh || BASE_MAX_HP; base.hitFlash = nb.hf || 0;
      }
      // 兵士
      const seen = new Set();
      for (const ns of d.s) {
        seen.add(ns.id);
        let s = G.soldiers.find((x) => x.id === ns.id);
        if (!s) {
          s = { id: ns.id, legPhase: 0, muzzle: 0, hitFlash: 0, recoil: 0, lastFootstepAt: -99999, heardUntil: 0 };
          G.soldiers.push(s);
        }
        s.team = ns.tm; s.name = ns.n; s.level = ns.lv;
        s.hp = ns.hp; s.maxHp = ns.mh; s.dead = ns.d ? true : false;
        s.weapon = ns.w; s.aimAngle = ns.a;
        s.xp = ns.xp; s.ammo = ns.am; s.reloading = ns.rl ? true : false;
        s.grenades = ns.gr; s.maxGrenades = ns.mg || 3; s.vehicleId = ns.v == null ? -1 : ns.v; s.turretId = ns.tr == null ? -1 : ns.tr;
        s.mines = ns.mn == null ? 0 : ns.mn; s.maxMines = ns.mm || 2;
        s.wires = ns.wi || 0; s.maxWires = ns.mw || 0;
        s.classKey = ns.cl || "soldier";
        s.seesEnemyMines = classDef(s.classKey).seesEnemyMines;
        s.armor = ns.ar; s.maxArmor = ns.ma; s.shield = ns.sh; s.maxShield = ns.ms; s.shieldRaised = !!ns.sr;
        s.parryUntil = now() + (ns.pr || 0); s.parryCooldownUntil = now() + (ns.pc || 0); s.stunnedUntil = now() + (ns.st || 0);
        s.lastDamagedAt = now() - (AUTO_HEAL_DELAY_MS - (ns.rh || 0));
        s.kills = ns.ki || 0; s.deaths = ns.de || 0;
        s.moving = ns.mv ? true : false; s.noiseRadius = ns.nr || 0;
        if (ns.fl) s.muzzle = now();
        s.rx = ns.x; s.ry = ns.y;
        if (s.x == null) { s.x = ns.x; s.y = ns.y; }
      }
      G.soldiers = G.soldiers.filter((s) => seen.has(s.id));
      // 軍用犬
      const dogSeen = new Set();
      for (const nd of (d.dg || [])) {
        dogSeen.add(nd.id);
        let dog = G.dogs.find((x) => x.id === nd.id);
        if (!dog) {
          dog = { kind: "dog", id: nd.id, x: nd.x, y: nd.y, rx: nd.x, ry: nd.y, biteAt: 0, hitFlash: 0 };
          G.dogs.push(dog);
        }
        dog.team = nd.tm; dog.name = nd.n; dog.hp = nd.hp; dog.maxHp = nd.mh;
        dog.dead = !!nd.d; dog.angle = nd.a; dog.moving = !!nd.mv; dog.rx = nd.x; dog.ry = nd.y;
        if (nd.bt) dog.biteAt = now();
      }
      G.dogs = G.dogs.filter((dog) => dogSeen.has(dog.id));
      // 戦車
      const tankSeen = new Set();
      for (const nt of (d.tn || [])) {
        tankSeen.add(nt.id);
        let tank = G.tanks.find((x) => x.id === nt.id);
        if (!tank) {
          tank = { kind: "tank", id: nt.id, x: nt.x, y: nt.y, rx: nt.x, ry: nt.y, kills: 0 };
          G.tanks.push(tank);
        }
        tank.team = nt.tm; tank.name = nt.n; tank.hp = nt.hp; tank.maxHp = nt.mh;
        tank.dead = !!nt.d; tank.angle = nt.a; tank.turretAngle = nt.ta; tank.driverId = nt.dr;
        tank.rx = nt.x; tank.ry = nt.y;
        tank.lastShot = now() - (1450 - (nt.cd || 0));
        if (nt.fl) tank.muzzle = now();
      }
      G.tanks = G.tanks.filter((tank) => tankSeen.has(tank.id));
      // 弾(置き換え)
      G.bullets = d.b.map((b) => ({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, range: 9999, traveled: 0,
        kind: b.sh ? "shell" : "bullet", col: b.sn ? "#bfe6ff" : "#ffe49a", len: b.sn ? 24 : 16,
      }));
      const nt = now();
      G.grenades = (d.g || []).map((g) => ({
        x: g.x, y: g.y, vx: g.vx, vy: g.vy, rotation: g.ro,
        fuseAt: nt + g.rem, bornAt: nt - g.age,
      }));
      const turretSeen = new Set();
      for (const nt2 of (d.tu || [])) {
        turretSeen.add(nt2.id);
        let turret = G.turrets.find((x) => x.id === nt2.id);
        if (!turret) {
          turret = { kind: "turret", id: nt2.id, x: nt2.x, y: nt2.y, muzzle: 0, hitFlash: 0 };
          G.turrets.push(turret);
        }
        turret.x = nt2.x; turret.y = nt2.y; turret.angle = nt2.a;
        turret.team = nt2.tm; turret.hp = nt2.hp; turret.maxHp = nt2.mh;
        turret.dead = !!nt2.d; turret.gunnerId = nt2.gn;
        if (nt2.fl) turret.muzzle = now();
      }
      G.turrets = G.turrets.filter((turret) => turretSeen.has(turret.id));
      G.mines = (d.mn || []).map((m) => ({
        id: m.id, team: m.tm, x: m.x, y: m.y, armAt: nt + (m.ar || 0), owner: -1, stealthMul: m.sm || 1,
      }));
      if (d.cre) {
        if (!G.creature) G.creature = { kind: "creature", limbPhase: 0, lungeAt: 0, lastRoarAt: 0 };
        const cr2 = G.creature;
        const wasHunting = cr2.hunting;
        cr2.x = d.cre.x; cr2.y = d.cre.y; cr2.angle = d.cre.a;
        cr2.hunting = !!d.cre.h; cr2.targetId = d.cre.tg;
        if (d.cre.lg) cr2.lungeAt = now();
        if (!wasHunting && cr2.hunting) Audio.roar();
      } else {
        G.creature = null;
      }
      G.wires = (d.wr || []).map((wire) => ({
        id: wire.id, team: wire.tm, x: wire.x, y: wire.y, owner: -1, seed: wire.sd || 0,
      }));
      G.pickups = (d.p || []).map((p) => ({
        id: p.id, kind: p.k || "medkit", x: p.x, y: p.y, active: !!p.ac,
        respawnAt: nt + (p.rem || 0), phase: p.id * 1.7,
      }));
      // キルフィード
      if (d.kf) {
        G.killfeed = d.kf;
      }
    }

    function clientEnd(w) {
      if (!G || G.over) return;
      G.over = true; G.running = false;
      showMatchResult(w);
    }

    function broadcastSnapshot() {
      if (conns.length === 0) return;
      const stamp = now();
      const s = G.soldiers.map((o) => ({
        id: o.id, tm: o.team, n: o.name, lv: o.level,
        x: Math.round(o.x), y: Math.round(o.y), a: +o.aimAngle.toFixed(2),
        hp: Math.round(o.hp), mh: o.maxHp, d: o.dead ? 1 : 0, w: o.weapon,
        xp: o.xp, am: o.ammo, rl: o.reloading ? 1 : 0, gr: o.grenades, mg: o.maxGrenades || 3, v: o.vehicleId, tr: o.turretId,
        mn: o.mines, mm: o.maxMines || 2, wi: o.wires || 0, mw: o.maxWires || 0, cl: o.classKey,
        ar: Math.round(o.armor), ma: o.maxArmor, sh: Math.round(o.shield), ms: o.maxShield, sr: o.shieldRaised ? 1 : 0,
        pr: Math.max(0, o.parryUntil - stamp), pc: Math.max(0, o.parryCooldownUntil - stamp), st: Math.max(0, o.stunnedUntil - stamp),
        rh: Math.max(0, AUTO_HEAL_DELAY_MS - (stamp - o.lastDamagedAt)),
        ki: o.kills, de: o.deaths, mv: o.moving ? 1 : 0, nr: o.noiseRadius || 0,
        fl: (stamp - o.muzzle < (WEAPONS[o.weapon].melee ? 190 : 60)) ? 1 : 0,
      }));
      const dg = G.dogs.map((dog) => ({
        id: dog.id, tm: dog.team, n: dog.name, x: Math.round(dog.x), y: Math.round(dog.y),
        a: +dog.angle.toFixed(2), hp: Math.round(dog.hp), mh: dog.maxHp, d: dog.dead ? 1 : 0,
        mv: dog.moving ? 1 : 0, bt: stamp - dog.biteAt < 180 ? 1 : 0,
      }));
      const tn = G.tanks.map((tank) => ({
        id: tank.id, tm: tank.team, n: tank.name, x: Math.round(tank.x), y: Math.round(tank.y),
        a: +tank.angle.toFixed(2), ta: +tank.turretAngle.toFixed(2), hp: Math.round(tank.hp), mh: tank.maxHp,
        d: tank.dead ? 1 : 0, dr: tank.driverId, cd: Math.max(0, 1450 - (stamp - tank.lastShot)), fl: stamp - tank.muzzle < 90 ? 1 : 0,
      }));
      const b = G.bullets.map((x) => ({
        x: Math.round(x.x), y: Math.round(x.y), vx: Math.round(x.vx), vy: Math.round(x.vy),
        sn: x.len > 20 ? 1 : 0, sh: x.kind === "shell" ? 1 : 0,
      }));
      const g = G.grenades.map((x) => ({
        x: Math.round(x.x), y: Math.round(x.y), vx: Math.round(x.vx), vy: Math.round(x.vy), ro: +x.rotation.toFixed(2),
        rem: Math.max(0, x.fuseAt - stamp), age: Math.max(0, stamp - x.bornAt),
      }));
      const p = G.pickups.map((kit) => ({
        id: kit.id, k: kit.kind, x: Math.round(kit.x), y: Math.round(kit.y), ac: kit.active ? 1 : 0,
        rem: kit.active ? 0 : Math.max(0, kit.respawnAt - stamp),
      }));
      const mn = G.mines.map((m) => ({
        id: m.id, tm: m.team, x: Math.round(m.x), y: Math.round(m.y),
        ar: Math.max(0, m.armAt - stamp), sm: m.stealthMul || 1,
      }));
      const tu = G.turrets.map((turret) => ({
        id: turret.id, x: Math.round(turret.x), y: Math.round(turret.y), a: +turret.angle.toFixed(2),
        tm: turret.team, hp: Math.round(turret.hp), mh: turret.maxHp, d: turret.dead ? 1 : 0,
        gn: turret.gunnerId, fl: stamp - turret.muzzle < 55 ? 1 : 0,
      }));
      const cre = G.creature ? {
        x: Math.round(G.creature.x), y: Math.round(G.creature.y),
        a: +G.creature.angle.toFixed(2), h: G.creature.hunting ? 1 : 0,
        tg: G.creature.targetId, lg: stamp - G.creature.lungeAt < 220 ? 1 : 0,
      } : null;
      const wr = G.wires.map((wire) => ({
        id: wire.id, tm: wire.team, x: Math.round(wire.x), y: Math.round(wire.y), sd: +(wire.seed || 0).toFixed(2),
      }));
      const bs = G.bases.map((base) => ({ tm: base.team, hp: Math.round(base.hp), mh: base.maxHp, hf: +base.hitFlash.toFixed(2) }));
      const payload = { t: "snap", sc: G.score, an: G.armyNames, ck: Math.round(G.clock), bs, s, dg, tn, tu, b, g, p, mn, wr, cre, kf: G.killfeed };
      for (const c of conns) { try { c.send(payload); } catch (e) {} }
    }

    function broadcastEnd(w) {
      for (const c of conns) { try { c.send({ t: "end", w }); } catch (e) {} }
    }

    function broadcastPause(paused) {
      for (const c of conns) { try { c.send({ t: "pause", p: paused ? 1 : 0 }); } catch (e) {} }
    }

    function setPause(paused) {
      if (mode === "host") {
        pauseOwner = paused ? "host" : null;
        broadcastPause(paused);
      } else if (mode === "client" && hostConn && hostConn.open === true) {
        try { hostConn.send({ t: "pause", p: paused ? 1 : 0 }); } catch (e) {}
      }
    }

    function sendInput(inp) {
      if (!hostConn || hostConn.open !== true) return;
      try {
        hostConn.send({
          t: "input",
          i: {
            mvx: inp.mvx, mvy: inp.mvy, aimAngle: inp.aimAngle, shoot: inp.shoot, dash: inp.dash,
            weaponWanted: inp.weaponWanted, reloadEdge: inp.reloadEdge,
            grenadeEdge: inp.grenadeEdge, interactEdge: inp.interactEdge, mineEdge: inp.mineEdge, wireEdge: inp.wireEdge,
            parryEdge: inp.parryEdge, shield: inp.shield,
          },
        });
      } catch (e) {}
    }

    function showRoomBanner() {
      const humanCount = G ? G.soldiers.filter((s) => s.controller !== "cpu").length : 1;
      el.menuHint && (el.menuHint.textContent = "");
      // 画面内バナー(キルフィードの下に流用)
      banner(`ルームコード: ${roomCode}　参加者 ${humanCount}人　(共有して対戦)`);
    }

    function shutdown() {
      clearInterval(countdownTimer);
      countdownTimer = null;
      lobbyOpen = false;
      try { conns.forEach((c) => c.close()); } catch (e) {}
      try { hostConn && hostConn.close(); } catch (e) {}
      try { peer && peer.destroy(); } catch (e) {}
      peer = null; conns = []; hostConn = null;
      roomCode = "";
      pauseOwner = null;
      joinRejected = false;
      resetLobbyView();
    }

    return {
      host, join, broadcastSnapshot, broadcastEnd, sendInput, setPause, shutdown,
      startFromLobby: beginCountdown, clientInputs, get code() { return roomCode; },
    };
  })();

  let bannerTimer = null;
  function banner(text) {
    let b = document.getElementById("net-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "net-banner";
      b.style.cssText = "position:absolute;top:120px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);color:#ffd23f;font-weight:800;font-size:13px;padding:6px 14px;border-radius:8px;z-index:8;pointer-events:none;";
      document.getElementById("stage-wrap").appendChild(b);
    }
    b.textContent = text;
    b.style.display = "block";
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.style.display = "none"; }, 6000);
  }

  function netMsg(text, err, ok) {
    el.netStatus.textContent = text;
    el.netStatus.className = "net-status" + (err ? " err" : ok ? " ok" : "");
  }

  // ============================================================
  //  メニュー / UI 配線
  // ============================================================
  function setupMenu() {
    loadProgress();
    el.menuMoney.textContent = money;

    // 名前の保存
    const saved = localStorage.getItem("wz-name");
    if (saved) el.nameInput.value = saved;
    playerName = el.nameInput.value.trim() || "Soldier";
    el.nameInput.addEventListener("input", () => {
      playerName = el.nameInput.value.trim() || "Soldier";
      localStorage.setItem("wz-name", playerName);
    });

    // 所属チーム(ソロ戦・オンラインとも共通)
    const savedTeam = Number(localStorage.getItem("wz-team"));
    playerTeam = Number.isFinite(savedTeam) ? clamp(Math.floor(savedTeam), 0, TEAM_COUNT - 1) : 0;
    el.teamSeg.innerHTML = TEAMS.map((team) => {
      const def = teamDef(team);
      return `<button data-team="${team}" style="--team:${def.flag}"><i class="dot"></i>${esc(def.name)}</button>`;
    }).join("");
    function syncTeamButtons() {
      el.teamSeg.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", Number(b.dataset.team) === playerTeam);
      });
    }
    el.teamSeg.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-team]");
      if (!b) return;
      playerTeam = Number(b.dataset.team);
      localStorage.setItem("wz-team", String(playerTeam));
      syncTeamButtons();
      // 軍名を未設定のまま切り替えたら、その軍の既定名に追随させる
      if (!localStorage.getItem("wz-army")) {
        armyName = teamDef(playerTeam).name;
        el.armyInput.value = armyName;
      }
    });
    syncTeamButtons();

    // ステージ
    const savedStage = localStorage.getItem("wz-stage");
    playerStage = STAGE_BY_KEY[savedStage] ? savedStage : "field";
    el.stageSeg.innerHTML = STAGES.map((st) =>
      `<button data-stage="${st.key}"><span class="class-head">${st.icon} ${esc(st.name)}</span>` +
      `<span class="class-desc">${esc(st.desc)}</span></button>`).join("");
    function syncStageButtons() {
      el.stageSeg.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", b.dataset.stage === playerStage);
      });
    }
    // 練習場は1人用なので、選んでいる間はオンライン対戦を伏せる
    const onlineBtn = document.getElementById("btn-online");
    function syncOnlineAvailability() {
      const solo = stageIsTraining(playerStage);
      onlineBtn.disabled = solo;
      onlineBtn.textContent = solo ? "オンライン対戦（練習場では使えません）" : "オンライン対戦";
    }
    el.stageSeg.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-stage]");
      if (!b) return;
      playerStage = b.dataset.stage;
      localStorage.setItem("wz-stage", playerStage);
      syncStageButtons();
      syncOnlineAvailability();
    });
    syncStageButtons();
    syncOnlineAvailability();

    // キャラクター(兵科)
    const savedClass = localStorage.getItem("wz-class");
    playerClass = CLASS_BY_KEY[savedClass] ? savedClass : "soldier";
    el.classSeg.innerHTML = CLASSES.map((c) =>
      `<button data-class="${c.key}"><span class="class-head">${c.icon} ${esc(c.name)}</span>` +
      `<span class="class-desc">${esc(c.desc)}</span></button>`).join("");
    function syncClassButtons() {
      el.classSeg.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", b.dataset.class === playerClass);
      });
    }
    el.classSeg.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-class]");
      if (!b) return;
      playerClass = b.dataset.class;
      localStorage.setItem("wz-class", playerClass);
      syncClassButtons();
    });
    syncClassButtons();

    // スキン(見た目だけ)
    const savedSkin = localStorage.getItem("wz-skin");
    playerSkin = SKIN_BY_KEY[savedSkin] ? savedSkin : "standard";
    el.skinSeg.innerHTML = SKINS.map((sk) =>
      `<button data-skin="${sk.key}" style="--skin:${sk.accent};--skin-body:${sk.uniform}">` +
      `<span class="skin-chip"></span>` +
      `<span class="skin-body"><span class="class-head">${sk.icon} ${esc(sk.name)}</span>` +
      `<span class="class-desc">${esc(sk.desc)}</span></span></button>`).join("");
    function syncSkinButtons() {
      el.skinSeg.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", b.dataset.skin === playerSkin);
      });
    }
    el.skinSeg.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-skin]");
      if (!b) return;
      playerSkin = b.dataset.skin;
      localStorage.setItem("wz-skin", playerSkin);
      syncSkinButtons();
    });
    syncSkinButtons();

    const savedArmy = localStorage.getItem("wz-army");
    if (savedArmy) el.armyInput.value = savedArmy;
    else el.armyInput.value = teamDef(playerTeam).name;
    armyName = el.armyInput.value.trim() || teamDef(playerTeam).name;
    el.armyInput.addEventListener("input", () => {
      armyName = el.armyInput.value.trim() || teamDef(playerTeam).name;
      localStorage.setItem("wz-army", armyName);
    });

    // 難易度
    document.querySelectorAll("#diff-seg button").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#diff-seg button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        difficulty = b.dataset.diff;
      });
    });

    document.getElementById("btn-solo").addEventListener("click", () => { Audio.unlock(); Net.shutdown(); startSoloMatch(); });
    document.getElementById("btn-online").addEventListener("click", () => {
      el.menuMain.classList.add("hidden");
      el.menuOnline.classList.remove("hidden");
      netMsg("");
    });
    document.getElementById("btn-back").addEventListener("click", () => {
      Net.shutdown();
      el.menuOnline.classList.add("hidden");
      el.menuMain.classList.remove("hidden");
    });
    document.getElementById("btn-host").addEventListener("click", async () => {
      Audio.unlock();
      try { await Net.host(); } catch (e) { netMsg(e.message, true); }
    });
    el.lobbyStart.addEventListener("click", () => {
      el.lobbyStart.disabled = true;
      Net.startFromLobby();
    });
    document.getElementById("btn-join").addEventListener("click", async () => {
      Audio.unlock();
      const code = (el.joinCode.value || "").trim();
      if (code.length < 3) { netMsg("ルームコードを入力してください", true); return; }
      try { await Net.join(code); } catch (e) { netMsg(e.message, true); }
    });

    // 操作方法 (対戦中に開いた場合はゲームを停止)
    // 実績(メダル)
    document.getElementById("btn-medals").addEventListener("click", openMedals);
    document.getElementById("btn-medals-close").addEventListener("click", () => el.medals.classList.add("hidden"));
    document.getElementById("btn-result-medals").addEventListener("click", openMedals);

    document.getElementById("btn-controls").addEventListener("click", () => openHelp("menu"));
    document.getElementById("btn-help").addEventListener("click", () => openHelp(isMatchActive() ? "game" : "menu"));
    document.getElementById("btn-help-close").addEventListener("click", closeHelp);

    // 一時停止 / メニュー / 結果
    document.getElementById("btn-menu").addEventListener("click", openPauseMenu);
    document.getElementById("btn-resume").addEventListener("click", resumeMatch);
    document.getElementById("btn-pause-help").addEventListener("click", () => openHelp("pause"));
    document.getElementById("btn-pause-quit").addEventListener("click", () => {
      setMatchPaused(false);
      openMenu();
    });
    document.getElementById("btn-again").addEventListener("click", () => {
      if (mode === "client") { openMenu(); return; }
      Net.shutdown();
      startSoloMatch();
    });
    document.getElementById("btn-tomenu").addEventListener("click", openMenu);
    document.getElementById("btn-spectate").addEventListener("click", startSpectating);
    document.getElementById("btn-give-up").addEventListener("click", openMenu);
    // どうしてもできない項目は飛ばせるようにしておく
    el.tpSkip.addEventListener("click", () => { if (training && !training.done) training.skip = true; });
    el.shopItems.addEventListener("click", (e) => {
      const button = e.target.closest && e.target.closest("[data-shop-buy]");
      if (button && !button.disabled) buyShopItem(button.dataset.shopBuy);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.repeat) return;
      if (!el.medals.classList.contains("hidden")) el.medals.classList.add("hidden");
      else if (!el.help.classList.contains("hidden")) closeHelp();
      else if (!el.pause.classList.contains("hidden")) resumeMatch();
      else if (isMatchActive()) openPauseMenu();
      else return;
      e.preventDefault();
    });

    // ミュート
    el.btnMute.addEventListener("click", () => {
      const m = Audio.toggle();
      el.btnMute.textContent = m ? "🔇" : "🔊";
    });

    el.menuHint.textContent = isTouch
      ? "スマホ: 左で移動・右で照準＆射撃・専用ボタンでグレネード/戦車"
      : "PC: WASDで移動・マウスで射撃・Gでグレネード・Eで戦車";
  }

  function openMenu() {
    // 途中でやめた試合も、そこまでの戦果は実績に反映する
    commitRun(false);
    if (G) { G.running = false; }
    Audio.stopBgm();
    matchPaused = false;
    pauseStartedAt = 0;
    helpOrigin = "menu";
    clearGameInput();
    Net.shutdown();
    el.result.classList.add("hidden");
    el.pause.classList.add("hidden");
    el.help.classList.add("hidden");
    el.eliminated.classList.add("hidden");
    eliminationPrompted = false;
    spectating = false;
    el.touch.classList.add("hidden");
    el.menuOnline.classList.add("hidden");
    el.menuMain.classList.remove("hidden");
    el.menu.classList.remove("hidden");
    el.vehicleHint.classList.add("hidden");
    el.trainingPanel.classList.add("hidden");
    el.medals.classList.add("hidden");
    const b = document.getElementById("net-banner"); if (b) b.style.display = "none";
  }

  // 起動
  resize();
  setupMenu();
})();
