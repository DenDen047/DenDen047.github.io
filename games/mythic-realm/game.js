/* MYTHIC REALM 2D ― 神話の魔境
 * 見下ろし型(トップダウン)の2D剣と魔法のアクション + ライトRPG。
 * 勇者パーティ(プレイヤー + 仲間)が、魔物の軍勢とボスに挑む協力戦。
 * ソロ(CPUの仲間)と、PeerJS による P2P オンライン協力プレイ(ホスト権威)に対応。
 * ゲーム状態はフレーム毎に破壊的更新する(ゲームループの定石)。CLAUDE.md の不変則は
 * UI/データ層の話で、ここではパフォーマンス優先のミュータブル更新を採用する。
 */
(function () {
  "use strict";

  // ============================================================
  //  定数
  // ============================================================
  const WORLD_W = 2600, WORLD_H = 1800;
  // 陣営は2つだけ。0 = 勇者パーティ(プレイヤー側)、1 = 魔物の軍勢。
  const TEAM_COUNT = 2;
  const TEAM_HERO = 0;
  const TEAM_FOE = 1;
  const PARTY_SIZE = 4;           // 勇者パーティの人数(プレイヤーを含む)
  const FOE_LIMIT = 8;            // 同時に存在できる魔物の上限
  const FOE_SPAWN_MS = 4000;      // 門から魔物が湧く間隔
  const ALTAR_MAX_HP = 2600;      // 勇者の祭壇
  const GATE_MAX_HP = 2400;       // 魔界の門
  const BASE_CORE_R = 72;
  const WIN_REWARD = 300;
  const RESPAWN_MS = 3200;
  const UNIT_R = 14;
  const BEAST_R = 11;
  const BEAST_RESPAWN_MS = 7000;
  const GOLEM_R = 34;
  const GOLEM_RESPAWN_MS = 9000;
  // 中立の魔導砲台。先に取り付いた者が使える。
  const BALLISTA_R = 22;
  const BALLISTA_RESPAWN_MS = 20000;
  const BALLISTA_MOUNT_R = 62;
  const BALLISTA_DAMAGE_TAKEN = 0.5;   // 石垣のぶん射手の被弾を軽減
  const BALLISTA_BOW = { interval: 260, dmg: 42, speed: 1500, range: 900, spread: 0.03 };
  const BOMB_FUSE_MS = 1500;
  const BOMB_RADIUS = 145;
  const GLYPH_ARM_MS = 1100;      // 描いてから起動するまで(自爆防止)
  const GLYPH_TRIGGER_R = 30;     // 踏んだ判定の半径
  const GLYPH_BLAST_R = 140;
  const GLYPH_DAMAGE = 155;
  const GLYPH_SPOT_R = 95;        // 敵がこの距離まで近づくと見える
  const GLYPH_PLACE_COOLDOWN = 600;
  const THORN_R = 52;             // 茨の呪縛の効果半径
  const THORN_DPS = 14;           // 中にいる敵への毎秒ダメージ
  const THORN_SLOW = 0.42;        // 中にいる敵の移動速度倍率
  const THORN_PLACE_COOLDOWN = 900;
  const AUTO_HEAL_DELAY_MS = 5000;
  const AUTO_HEAL_PER_SEC = 5;
  const POTION_HEAL = 45;
  const BASE_HEAL_PER_SEC = 12;
  const BASE_REPAIR_PER_SEC = 7;
  const PLAYER_VISION_R = 350;
  const GOLEM_VISION_R = 465;
  const DAY_LENGTH_MS = 150000;   // 1日 = 2分30秒
  const NIGHT_VISION_MUL = 0.55;  // 真夜中の視界倍率
  const DAY_VISION_MUL = 1.15;    // 真昼の視界倍率
  const MAX_PROJECTILES = 600;
  const MAX_PARTICLES = 800;
  const SNAP_HZ = 20;             // ホストの状態送信レート
  const INPUT_HZ = 30;            // クライアントの入力送信レート
  const MATCH_COUNTDOWN_SECONDS = 3;
  const HOLY_VS_UNDEAD = 1.8;     // 聖属性がアンデッドに与える倍率

  // 陣営の見た目と既定名。配列の添字がそのまま陣営番号。
  const TEAM_DEFS = [
    {
      key: "hero", name: "勇者パーティ", short: "勇者",
      uniform: "#3a5f9e", accent: "#a8d4ff", flag: "#4ea3ff", text: "#d2e9ff",
      baseFill: "rgba(80,140,205,0.20)", baseStroke: "rgba(160,220,255,0.62)",
      coreDark: "#3d5f78", coreLight: "#5d88a4",
      beastHarness: "#5fa8d7", beastFur: "#6b5a44", beastBar: "#6fdc93",
      golemBody: "#4b6572", golemLight: "#6f95a4", golemBar: "#6fd0dd",
    },
    {
      key: "foe", name: "魔物の軍勢", short: "魔物",
      uniform: "#632d6b", accent: "#dba0ff", flag: "#b361ff", text: "#eed6ff",
      baseFill: "rgba(110,45,130,0.22)", baseStroke: "rgba(200,130,255,0.62)",
      coreDark: "#3d2450", coreLight: "#5c3874",
      beastHarness: "#a04ad0", beastFur: "#3a3040", beastBar: "#c47cf0",
      golemBody: "#4a3a5e", golemLight: "#6d5686", golemBar: "#c08cf0",
    },
  ];
  // 自分だけは金色でハイライトする(陣営色とは別枠)。
  const YOU_UNIFORM = "#7a6420", YOU_ACCENT = "#ffd23f";

  const TEAMS = TEAM_DEFS.map((_, i) => i);
  const teamDef = (team) => TEAM_DEFS[team] || TEAM_DEFS[0];
  const isFoe = (u) => !!u && u.team === TEAM_FOE;

  const BOT_NAMES = [
    "アルド", "セリカ", "ミラ", "ガルド", "リノ", "テオ", "ユナ", "ヴェル",
    "クレス", "シオン", "ノア", "リグ", "エルナ", "ザイル", "フィナ", "ロウ",
  ];

  const SHOP_ITEMS = [
    { key: "health", icon: "❤", name: "生命の指輪", desc: "最大HP +10", max: 5, baseCost: 120, step: 80 },
    { key: "armor", icon: "🛡", name: "聖銀の鎧", desc: "鎧の耐久 +15", max: 5, baseCost: 120, step: 85 },
    { key: "shield", icon: "💠", name: "魔法の盾", desc: "盾の耐久 +20", max: 5, baseCost: 130, step: 90 },
    { key: "damage", icon: "⚔", name: "武器の研磨", desc: "武器ダメージ +5%", max: 5, baseCost: 180, step: 110 },
    { key: "bomb", icon: "🔥", name: "火炎瓶の袋", desc: "火炎瓶の所持数 +1", max: 3, baseCost: 220, step: 160 },
    { key: "glyph", icon: "🔮", name: "呪印の巻物", desc: "呪印の罠の所持数 +1", max: 3, baseCost: 240, step: 170 },
  ];

  // ============================================================
  //  武器
  //  melee = 振って当てる近接武器 (arc = 届く左右の角度、style = 見た目)
  //  bow   = 矢や斧を飛ばす物理の遠距離武器 (mag = 矢筒の本数)
  //  magic = 魔力を飛ばす魔法 (mag = マナの残り、reload = 詠唱)
  //  blast = 着弾して爆発する / heal = 味方を癒やす / holy = アンデッド特効
  // ============================================================
  const WEAPON_DEFAULTS = {
    dmg: 20, interval: 400, mag: 1, reload: 0, spread: 0, pellets: 1, auto: false,
    speed: 0, range: 90, len: 18, kick: 3, pierce: 0,
    melee: false, arc: 0.9, style: "sword", proj: "arrow", snd: "melee",
    bow: false, magic: false, blast: false, holy: false, heal: 0, slow: 0,
  };
  const WEAPONS = [
    // ---- 近接 ----
    { key: "longsword",  name: "長剣",         dmg: 74,  interval: 430, range: 104, arc: 1.0,  kick: 3.4, style: "longsword",  melee: true },
    { key: "greatsword", name: "大剣",         dmg: 118, interval: 780, range: 120, arc: 1.45, kick: 5.8, style: "greatsword", melee: true },
    { key: "dagger",     name: "短剣",         dmg: 46,  interval: 250, range: 68,  arc: 0.8,  kick: 2.0, style: "dagger",     melee: true },
    { key: "sword",      name: "片手剣",       dmg: 64,  interval: 390, range: 96,  arc: 1.05, kick: 3.0, style: "sword",      melee: true },
    { key: "spear",      name: "槍",           dmg: 72,  interval: 430, range: 138, arc: 0.42, kick: 2.6, style: "spear",      melee: true },
    { key: "whip",       name: "獣の鞭",       dmg: 40,  interval: 300, range: 160, arc: 1.15, kick: 2.0, style: "whip",       melee: true },
    { key: "mace",       name: "聖なる槌",     dmg: 86,  interval: 660, range: 92,  arc: 1.15, kick: 4.6, style: "mace",       melee: true, holy: true },
    { key: "huntknife",  name: "狩猟ナイフ",   dmg: 52,  interval: 300, range: 74,  arc: 0.85, kick: 2.2, style: "dagger",     melee: true },
    // ---- 弓・投擲 ----
    { key: "longbow",  name: "長弓",   dmg: 66, interval: 900, mag: 6,  reload: 1500, spread: 0.012, speed: 1700, range: 1100, len: 26, kick: 4.2, pierce: 1, proj: "arrow", bow: true, snd: "bowheavy" },
    { key: "shortbow", name: "速射弓", dmg: 24, interval: 150, mag: 14, reload: 1150, spread: 0.075, speed: 1250, range: 640,  len: 20, kick: 1.4, auto: true, proj: "arrow", bow: true, snd: "bow" },
    { key: "throwaxe", name: "投げ斧", dmg: 54, interval: 520, mag: 5,  reload: 1400, spread: 0.05,  speed: 820,  range: 470,  len: 16, kick: 3.4, proj: "axe", bow: true, snd: "bow" },
    // ---- 魔法 ----
    { key: "fireball",  name: "火球",     dmg: 104, interval: 1150, mag: 4,  reload: 2000, spread: 0.02, speed: 620,  range: 840, len: 22, kick: 4.0, blast: true, proj: "fire",  magic: true, snd: "blast" },
    { key: "lightning", name: "雷撃",     dmg: 40,  interval: 280,  mag: 10, reload: 1500, spread: 0.03, speed: 2400, range: 940, len: 30, kick: 2.2, pierce: 2, proj: "bolt", magic: true, snd: "cast" },
    { key: "iceshard",  name: "氷の矢",   dmg: 22,  interval: 130,  mag: 18, reload: 1500, spread: 0.09, speed: 1150, range: 560, len: 16, kick: 1.2, auto: true, slow: 0.55, proj: "ice", magic: true, snd: "cast" },
    { key: "holybolt",  name: "聖光",     dmg: 44,  interval: 420,  mag: 10, reload: 1600, spread: 0.02, speed: 1500, range: 800, len: 22, kick: 2.4, holy: true, proj: "holy", magic: true, snd: "holy" },
    { key: "healray",   name: "癒しの光", dmg: 0,   interval: 900,  mag: 8,  reload: 1900, range: 176, arc: 0.9, kick: 1.0, heal: 34, style: "staff", melee: true, magic: true, snd: "holy" },
    // ---- 魔物の武器 ----
    { key: "claw",      name: "爪",       dmg: 26, interval: 620,  range: 62,  arc: 0.9,  kick: 2.4, style: "claw",  melee: true },
    { key: "club",      name: "棍棒",     dmg: 44, interval: 900,  range: 78,  arc: 1.1,  kick: 4.2, style: "club",  melee: true },
    { key: "bonearrow", name: "骨の矢",   dmg: 22, interval: 900,  mag: 4, reload: 1500, spread: 0.06, speed: 1000, range: 660, len: 20, kick: 1.6, proj: "bone", bow: true, snd: "bow" },
    { key: "darkbolt",  name: "闇弾",     dmg: 26, interval: 780,  mag: 6, reload: 1700, spread: 0.05, speed: 780,  range: 620, len: 18, kick: 1.8, proj: "dark", magic: true, snd: "cast" },
    { key: "rockthrow", name: "岩投げ",   dmg: 48, interval: 1500, mag: 3, reload: 2100, spread: 0.05, speed: 640,  range: 620, len: 16, kick: 3.4, proj: "rock", bow: true, snd: "bow" },
    // ---- ボスの武器 ----
    { key: "bossflame", name: "竜炎",     dmg: 120, interval: 1900, mag: 3, reload: 2400, spread: 0.05, speed: 560, range: 900, len: 26, kick: 5.0, blast: true, proj: "fire", magic: true, snd: "blast" },
    { key: "bossclaw",  name: "巨爪",     dmg: 78,  interval: 780,  range: 128, arc: 1.25, kick: 6.0, style: "claw", melee: true },
  ].map((w) => Object.assign({}, WEAPON_DEFAULTS, w));
  const WKEY = {}; WEAPONS.forEach((w, i) => (WKEY[w.key] = i));

  // 弾数表示のラベル。魔法はマナ、弓は矢、近接は無限。
  function ammoLabel(w) {
    return w.magic ? "マナ" : w.bow ? "矢" : "";
  }
  function reloadLabel(w) {
    return w.magic ? "詠唱中" : "矢をつがえ中";
  }

  // ============================================================
  //  職業(クラス)
  //  倍率はすべて基準値に対する掛け算。1 = 標準。
  //  look = 見た目。職業ごとに服・髪・かぶりものを変える。
  // ============================================================
  const CLASS_DEFAULTS = {
    hpBonus: 0, speedMul: 1, meleeMul: 1, rangedMul: 1, magicMul: 1, healMul: 1,
    bombs: 2, glyphs: 1, thorns: 0, pets: 0,
    parryWindowMul: 1, parryCooldownMul: 1,
    glyphArmMul: 1, glyphBlastMul: 1, glyphStealthMul: 1, seesEnemyGlyphs: false,
  };
  const CLASSES = [
    {
      key: "swordsman", name: "剣士", icon: "⚔️",
      desc: "長剣・大剣・短剣。体力がいちばん高く、盾のパリィも得意な前衛。魔法と弓は持てない。",
      hpBonus: 40, speedMul: 1.03, meleeMul: 1.35, rangedMul: 0.8,
      parryWindowMul: 1.7, parryCooldownMul: 0.6,
      weapons: ["longsword", "greatsword", "dagger"],
      look: { robe: "#39569c", trim: "#ffd76a", skin: "#eeba8c", hair: "#3a2a1f", head: "helm", cape: "#c8433c" },
    },
    {
      key: "mage", name: "魔法使い", icon: "🔮",
      desc: "火球・雷撃・氷の矢。魔法の威力が1.35倍で遠くから焼き払える。そのぶん体力は最も低い。",
      hpBonus: -25, speedMul: 0.95, magicMul: 1.35, meleeMul: 0.6, rangedMul: 0.8,
      bombs: 3, glyphs: 2,
      weapons: ["fireball", "lightning", "iceshard"],
      look: { robe: "#4b3a8c", trim: "#9fd0ff", skin: "#f0c69c", hair: "#d9d2c4", head: "hat", cape: "#2f2564" },
    },
    {
      key: "hunter", name: "狩人", icon: "🏹",
      desc: "長弓・速射弓・狩猟ナイフ。弓の威力1.25倍で足も速い。呪印の罠を4つ持ち、茨の呪縛(Cキー)も張れる。",
      hpBonus: -5, speedMul: 1.12, rangedMul: 1.25, meleeMul: 0.9,
      glyphs: 4, thorns: 3,
      glyphArmMul: 0.55, glyphBlastMul: 1.2, glyphStealthMul: 0.5, seesEnemyGlyphs: true,
      weapons: ["longbow", "shortbow", "huntknife"],
      look: { robe: "#3f6b3d", trim: "#d8c07a", skin: "#e8b183", hair: "#6b4626", head: "hood", cape: "#2f4f30" },
    },
    {
      key: "priest", name: "僧侶", icon: "✨",
      desc: "聖光・癒しの光・聖なる槌。癒しの光で味方の傷をふさげる唯一の職業。聖属性はアンデッドに1.8倍。",
      hpBonus: 15, speedMul: 0.97, magicMul: 1.1, healMul: 1.35, meleeMul: 0.95,
      weapons: ["holybolt", "healray", "mace"],
      look: { robe: "#e8e2d0", trim: "#e0b73c", skin: "#f0c49a", hair: "#c9a04a", head: "circlet", cape: "#dcd2b4" },
    },
    {
      key: "adventurer", name: "冒険者", icon: "🗡️",
      desc: "片手剣・速射弓・投げ斧。近接も遠距離もそこそこ扱える万能型。火炎瓶4個と呪印3枚で道具も豊富。",
      hpBonus: 10, speedMul: 1.06, meleeMul: 1.0, rangedMul: 1.0,
      bombs: 4, glyphs: 3,
      weapons: ["sword", "shortbow", "throwaxe"],
      look: { robe: "#8a5a2b", trim: "#e6d08a", skin: "#e9b489", hair: "#4a2f1c", head: "bandana", cape: "#5f7f3a" },
    },
    {
      key: "beastmaster", name: "獣使い", icon: "🐺",
      desc: "槍・鞭・投げ斧。狼を2匹つれて戦う。狼は勝手に敵へ噛みつき、倒されてもしばらくすると戻ってくる。",
      hpBonus: 5, speedMul: 1.08, meleeMul: 1.05, rangedMul: 0.95,
      pets: 2, thorns: 2,
      weapons: ["spear", "whip", "throwaxe"],
      look: { robe: "#6d5230", trim: "#c8b06a", skin: "#dfa877", hair: "#241a12", head: "fur", cape: "#7a6440" },
    },
  ].map((c) => Object.assign({}, CLASS_DEFAULTS, c));
  const CLASS_BY_KEY = {};
  CLASSES.forEach((c) => (CLASS_BY_KEY[c.key] = c));
  const classDef = (key) => CLASS_BY_KEY[key] || CLASSES[0];

  // ============================================================
  //  魔物
  //  tier = 門の体力が減るほど、強い魔物が湧きやすくなる目安。
  // ============================================================
  const FOE_DEFAULTS = { hp: 60, speed: 170, dmgMul: 1, r: 13, tier: 0, undead: false, xp: 1 };
  const FOES = [
    {
      key: "goblin", name: "ゴブリン", hp: 58, speed: 205, dmgMul: 0.85, r: 12, tier: 0, style: "goblin",
      weapons: ["claw"], look: { skin: "#79a353", cloth: "#7a4a2a", eye: "#ffe066" },
    },
    {
      key: "orc", name: "オーク", hp: 165, speed: 148, dmgMul: 1.15, r: 17, tier: 1, xp: 2, style: "orc",
      weapons: ["club"], look: { skin: "#5f7f4c", cloth: "#4a3524", eye: "#ffb14a" },
    },
    {
      key: "skeleton", name: "骸骨の射手", hp: 74, speed: 158, dmgMul: 1, r: 13, tier: 1, undead: true, style: "skeleton",
      weapons: ["bonearrow"], look: { skin: "#e3ded0", cloth: "#5a5348", eye: "#8ff0ff" },
    },
    {
      key: "warlock", name: "闇術師", hp: 96, speed: 142, dmgMul: 1.05, r: 14, tier: 2, xp: 2, undead: true, style: "warlock",
      weapons: ["darkbolt"], look: { skin: "#b9a6c8", cloth: "#3d2450", eye: "#d07cff" },
    },
    {
      key: "gargoyle", name: "石のガーゴイル", hp: 240, speed: 132, dmgMul: 1.2, r: 19, tier: 3, xp: 3, style: "gargoyle",
      weapons: ["rockthrow", "claw"], look: { skin: "#7c7d84", cloth: "#4d4e55", eye: "#ff7a4a" },
    },
  ].map((f) => Object.assign({}, FOE_DEFAULTS, f));
  const FOE_BY_KEY = {};
  FOES.forEach((f) => (FOE_BY_KEY[f.key] = f));
  const foeDef = (key) => FOE_BY_KEY[key] || FOES[0];

  // ============================================================
  //  ボス
  //  門を壊すと奥から現れる。倒せば勝ち。
  // ============================================================
  const BOSSES = {
    drake: {
      key: "drake", name: "炎竜 イグニス", title: "遺跡に眠る古の竜",
      hp: 2400, speed: 112, r: 46, dmgMul: 1, xp: 12, style: "drake",
      weapons: ["bossflame", "bossclaw"],
      look: { scale: "#a8382c", belly: "#e0b063", wing: "#6d1f19", eye: "#ffdc4a" },
    },
    fenrir: {
      key: "fenrir", name: "魔狼王 フェンリル", title: "樹海を統べる白き獣",
      hp: 2000, speed: 196, r: 40, dmgMul: 1.1, xp: 12, style: "fenrir",
      weapons: ["bossclaw"],
      look: { scale: "#cfd4dc", belly: "#8e97a6", wing: "#5d6472", eye: "#7de3ff" },
    },
  };

  // ============================================================
  //  ステージ
  // ============================================================
  // fixedLight: 明るさを固定するステージだけが持つ (null = 昼夜サイクルどおり)。
  // phase: HUD の時間帯表示を固定するステージだけが持つ。
  const STAGES = [
    {
      key: "training", name: "訓練の間", icon: "🎯",
      desc: "はじめての人はここから。反撃してこない木人を相手に、操作を1つずつ順番に練習できる。",
      bgm: "bgm-battle", creature: false, training: true, fixedLight: 1, boss: null,
      phase: { key: "noon", label: "🎯 訓練の間", note: "木人は反撃しない" },
      ground: ["#4c4535", "#544d3c", "#443e31"],
    },
    {
      key: "ruins", name: "古代遺跡", icon: "🏛",
      desc: "崩れた神殿と石柱が並ぶ見通しの良い戦場。時間帯が朝から夜へ移り変わる。奥に炎竜がひそむ。",
      bgm: "bgm-battle", creature: false, training: false, fixedLight: null, boss: "drake",
      ground: ["#4a4636", "#53503c", "#423f31"],
    },
    {
      key: "darkforest", name: "常闇の樹海", icon: "🌲",
      desc: "夜が明けない密林。見通しは最悪で、倒せない何かが徘徊している。走ると気づかれる。",
      bgm: "bgm-darkforest", creature: true, training: false, fixedLight: 0.1, boss: "fenrir",
      phase: { key: "night", label: "🌲 常闇の樹海", note: "何かが見ている" },
      ground: ["#1b2416", "#1f291a", "#161e12"],
    },
  ];
  const STAGE_BY_KEY = {};
  STAGES.forEach((s) => (STAGE_BY_KEY[s.key] = s));
  const stageDef = () => STAGE_BY_KEY[G && G.stage ? G.stage : playerStage] || STAGE_BY_KEY.ruins;
  const stageIsTraining = (key) => !!(STAGE_BY_KEY[key] && STAGE_BY_KEY[key].training);
  const isTraining = () => !!stageDef().training;
  const bossDef = () => BOSSES[stageDef().boss] || null;

  const DIFF = {
    easy:   { aimErr: 0.19, react: 430, fireChance: 0.62, hpMul: 0.80, dmgMul: 0.80, foeMul: 0.7 },
    normal: { aimErr: 0.10, react: 280, fireChance: 0.82, hpMul: 1.00, dmgMul: 1.00, foeMul: 1.0 },
    hard:   { aimErr: 0.05, react: 170, fireChance: 0.94, hpMul: 1.25, dmgMul: 1.20, foeMul: 1.35 },
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
  // 当たり判定に使う半径。ボスや大型の魔物だけ自前の r を持つ。
  const unitR = (u) => u.r || UNIT_R;

  // 勇者の祭壇は左下、魔界の門は右上。heading はマップ中央を向く方向。
  const BASE_SPOTS = [
    { x: 300, y: WORLD_H - 300, heading: -Math.PI / 4, maxHp: ALTAR_MAX_HP, name: "勇者の祭壇" },
    { x: WORLD_W - 300, y: 300, heading: Math.PI * 3 / 4, maxHp: GATE_MAX_HP, name: "魔界の門" },
  ];

  // hidden = 存在しない扱いの拠点。訓練の間では魔界の門を置かない。
  function makeBases(training) {
    return TEAMS.map((team) => {
      const spot = BASE_SPOTS[team];
      return {
        kind: "base", team,
        hidden: !!training && team !== TEAM_HERO,
        name: spot.name,
        x: spot.x, y: spot.y, r: 185, heading: spot.heading,
        hp: spot.maxHp, maxHp: spot.maxHp, hitFlash: 0,
      };
    });
  }

  // 拠点が健在な陣営だけが復活・増援できる。
  function teamAlive(team) {
    const base = G.bases[team];
    return !!base && base.hp > 0;
  }

  // 敵陣営の、まだ健在な拠点のうち一番近いもの。
  function nearestEnemyBase(x, y, team) {
    let best = null, bestD = Infinity;
    for (const base of G.bases) {
      if (base.team === team || base.hp <= 0 || base.hidden) continue;
      const d = dist2(x, y, base.x, base.y);
      if (d < bestD) { bestD = d; best = base; }
    }
    return best;
  }

  // 生きている敵(勇者・魔物・狼)のうち一番近いもの。
  // 壊す拠点が無くなったあとの進路に使う。これが無いと双方が立ち止まって決着しない。
  function nearestEnemyFoe(x, y, team) {
    let best = null, bestD = Infinity;
    for (const u of G.units) {
      if (u.dead || u.team === team || u.dummy) continue;
      const d = dist2(x, y, u.x, u.y);
      if (d < bestD) { bestD = d; best = u; }
    }
    for (const b of G.beasts) {
      if (b.dead || b.team === team) continue;
      const d = dist2(x, y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
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
    bomb: document.getElementById("bomb-text"),
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
    partyInput: document.getElementById("party-input"),
    netStatus: document.getElementById("net-status"),
    joinCode: document.getElementById("join-code"),
    onlineActions: document.getElementById("online-actions"),
    roomLobby: document.getElementById("room-lobby"),
    roomCode: document.getElementById("room-code"),
    lobbyStatus: document.getElementById("lobby-status"),
    lobbyRoster: document.getElementById("lobby-roster"),
    lobbyStart: document.getElementById("btn-lobby-start"),
    classSeg: document.getElementById("class-seg"),
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
    // 弓は弦の弾ける音、魔法は音程が動く「シュイン」という音で鳴らし分ける。
    function shot(kind) {
      if (!actx || muted) return;
      const t = actx.currentTime;
      if (kind === "cast" || kind === "holy" || kind === "blast") {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = kind === "holy" ? "sine" : "triangle";
        const from = kind === "blast" ? 260 : kind === "holy" ? 900 : 620;
        const to = kind === "blast" ? 90 : kind === "holy" ? 1650 : 1500;
        const dur = kind === "blast" ? 0.3 : 0.18;
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(kind === "blast" ? 0.3 : 0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
        // 魔力のざらつきをひとさじ重ねる
        const src = noise(dur), bp = actx.createBiquadFilter(), g2 = actx.createGain();
        bp.type = "bandpass"; bp.frequency.value = kind === "holy" ? 2400 : 1100; bp.Q.value = 1.2;
        g2.gain.setValueAtTime(0.16, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(bp); bp.connect(g2); g2.connect(master);
        src.start(t); src.stop(t + dur + 0.02);
        return;
      }
      // 弓・投擲: 短い弦鳴りと空気を切る音
      const heavy = kind === "bowheavy";
      const dur = heavy ? 0.16 : 0.1;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(heavy ? 320 : 460, t);
      o.frequency.exponentialRampToValueAtTime(heavy ? 110 : 180, t + dur);
      g.gain.setValueAtTime(heavy ? 0.32 : 0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
      const src = noise(dur), hp = actx.createBiquadFilter(), g2 = actx.createGain();
      hp.type = "highpass"; hp.frequency.value = 1800;
      g2.gain.setValueAtTime(heavy ? 0.24 : 0.16, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
      src.connect(hp); hp.connect(g2); g2.connect(master);
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
        // 曲はステージが決まってから読む(常闇の樹海は別の曲)
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

  window.addEventListener("keydown", (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === "r" || e.key === "R") localInput.reloadEdge = true;
    if (!e.repeat && (e.key === "g" || e.key === "G")) localInput.bombEdge = true;
    if (!e.repeat && (e.key === "e" || e.key === "E")) localInput.interactEdge = true;
    if (!e.repeat && (e.key === "f" || e.key === "F")) localInput.glyphEdge = true;
    if (!e.repeat && (e.key === "c" || e.key === "C")) localInput.thornEdge = true;
    if (!e.repeat && (e.key === "q" || e.key === "Q")) localInput.parryEdge = true;
    // 数字キーは「所持している武器の何番目か」。全武器の通し番号ではない。
    if (e.key >= "1" && e.key <= "9") {
      const me = localUnit();
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
    const next = cycleWeapon(localUnit(), e.deltaY > 0 ? 1 : -1);
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
  document.getElementById("t-bomb").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.bombEdge = true; });
  document.getElementById("t-glyph").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.glyphEdge = true; });
  const thornBtn = document.getElementById("t-thorn");
  thornBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.thornEdge = true; });
  document.getElementById("t-golem").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.interactEdge = true; });
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
    const next = cycleWeapon(localUnit(), 1);
    if (next != null) localInput.weaponWanted = next;
  });

  // ローカルプレイヤーの入力(SP=自分のunitに適用 / client=送信)
  const localInput = {
    mvx: 0, mvy: 0, aimx: 1, aimy: 0, shoot: false, dash: false,
    reloadEdge: false, bombEdge: false, interactEdge: false, parryEdge: false, glyphEdge: false, thornEdge: false,
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

    let shoot = false;
    const me = localUnit();
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
    for (const e of G.units) {
      if (e.dead || e.vehicleId >= 0 || e.team === me.team) continue;
      consider(e, UNIT_R);
    }
    for (const e of G.golems) {
      if (e.dead || e.team === me.team) continue;
      consider(e, GOLEM_R);
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
  let playerName = "勇者";
  // プレイヤーは必ず勇者パーティ側。陣営を選ぶ余地はない。
  const playerTeam = TEAM_HERO;
  let playerClass = "swordsman";
  let playerStage = "ruins";
  let partyName = TEAM_DEFS[TEAM_HERO].name;
  let matchPaused = false;
  // パーティが全滅したときの「観戦するか、やめるか」の状態
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
      units: [],
      beasts: [],
      projectiles: [],
      bombs: [],
      glyphs: [],
      thorns: [],
      golems: [],
      ballistas: [],
      particles: [],
      pickups: [],
      obstacles: [],
      bases: makeBases(stageIsTraining(playerStage)),
      score: TEAMS.map(() => 0),
      goal: GATE_MAX_HP,
      running: false,
      over: false,
      localId: 0,
      nextId: 1,
      killfeed: [],
      soundPings: [],
      clock: DAY_START_CLOCK,
      stage: playerStage,
      creature: null,
      partyNames: TEAM_DEFS.map((def, team) => (team === playerTeam ? partyName : def.name)),
      rewardClaimed: false,
      // 魔物の湧きとボスの管理
      nextFoeAt: 0,
      foesSlain: 0,
      boss: null,
      bossSummoned: false,
    };
  }

  function localUnit() {
    if (!G) return null;
    return G.units.find((s) => s.id === G.localId) || null;
  }

  // 自分の所属チーム。まだ勇者が居ない(ロビー等)なら選択中のチーム。
  function localTeam() {
    const me = localUnit();
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
    // 常闇の樹海・訓練の間は時間が進んでも明るさが変わらない
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
      ? { key: "morning", label: "🌅 朝", note: "視界が広がっていく" }
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

  function sanitizeShopLevels(value) {
    const levels = {};
    for (const item of SHOP_ITEMS) {
      const raw = value && Number(value[item.key]);
      levels[item.key] = Number.isFinite(raw) ? clamp(Math.floor(raw), 0, item.max) : 0;
    }
    return levels;
  }

  function loadProgress() {
    const savedMoney = Number(localStorage.getItem("mr-money"));
    money = Number.isFinite(savedMoney) ? Math.max(0, Math.floor(savedMoney)) : 0;
    try {
      shopLevels = sanitizeShopLevels(JSON.parse(localStorage.getItem("mr-shop") || "{}"));
    } catch (e) {
      shopLevels = sanitizeShopLevels({});
    }
  }

  function saveProgress() {
    localStorage.setItem("mr-money", String(money));
    localStorage.setItem("mr-shop", JSON.stringify(shopLevels));
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
    // 職業で決まった所持数を土台にして、ショップ強化を上乗せする
    s.maxBombs = (s.maxBombs == null ? 3 : s.maxBombs) + lv.bomb;
    s.bombs = s.maxBombs;
    s.maxGlyphs = (s.maxGlyphs == null ? 2 : s.maxGlyphs) + lv.glyph;
    s.glyphs = s.maxGlyphs;
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
  // solid: 通り抜けられない / opaque: 視線を遮る / stopsProjectiles: 飛び道具を止める
  // 茂みだけは「通れるが見通せない」= 隠れられる場所として特別扱いする。
  const OBSTACLE_KINDS = {
    wall:     { solid: true,  opaque: true,  stopsProjectiles: true },
    ruin:     { solid: true,  opaque: true,  stopsProjectiles: true },
    crate:    { solid: true,  opaque: true,  stopsProjectiles: true },
    stonepile:  { solid: true,  opaque: true,  stopsProjectiles: true },
    rock:     { solid: true,  opaque: true,  stopsProjectiles: true },
    statue:    { solid: true,  opaque: true,  stopsProjectiles: true },
    column:    { solid: true,  opaque: true,  stopsProjectiles: true },
    tree:     { solid: true,  opaque: true,  stopsProjectiles: true },
    bones:    { solid: true,  opaque: true,  stopsProjectiles: true },
    spikes: { solid: true,  opaque: false, stopsProjectiles: false },
    bush:     { solid: false, opaque: true,  stopsProjectiles: false },
    manajar:   { solid: true,  opaque: false, stopsProjectiles: true },
  };
  const isSolid = (o) => OBSTACLE_KINDS[o.type] ? OBSTACLE_KINDS[o.type].solid : true;
  const isOpaque = (o) => OBSTACLE_KINDS[o.type] ? OBSTACLE_KINDS[o.type].opaque : true;
  const stopsProjectiles = (o) => OBSTACLE_KINDS[o.type] ? OBSTACLE_KINDS[o.type].stopsProjectiles : true;

  // ---- マップ生成 ----
  function genMap() {
    const key = stageDef().key;
    if (key === "darkforest") return genForestMap();
    if (key === "training") return genTrainingMap();
    return genRuinsMap();
  }

  // ---- 訓練の間のレイアウト ----
  // どの職業を選んでも同じ練習ができるよう、マップ中央から放射状に組む。
  // 中心に木人、その外に射手の位置の石積み、さらに外に魔導砲台と遮蔽ゾーン。
  const TRAINING_CENTER = { x: WORLD_W / 2, y: WORLD_H / 2 };
  const TRAINING_TARGET_R = 90;    // 静止標的を並べる半径
  const TRAINING_MOVER_R = 185;    // 動く標的が周回する半径
  const TRAINING_JAR_R = 235;   // 爆発する魔力の壺
  const TRAINING_LINE_R = 300;     // 射手の位置(石積み)
  const TRAINING_BALLISTA_R = 405;   // 魔導砲台

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

    // 射手の位置の石積み。どの方向から来ても正面に遮蔽がある。間は通り抜けられる。
    for (let i = 0; i < 8; i++) {
      const p = ringPos(TRAINING_LINE_R, i, 8, Math.PI / 8);
      // 円周に沿って寝かせる(半径が縦向きなら横長、横向きなら縦長)
      const flat = Math.abs(Math.cos(p.a)) < 0.5;
      const w = flat ? 112 : 32, h = flat ? 32 : 112;
      obs.push({ x: p.x - w / 2, y: p.y - h / 2, w, h, type: "stonepile", hp: Infinity, seed: (i + 1) / 9 });
    }

    // 魔力の壺(当てると爆発する練習用)
    for (let i = 0; i < 6; i++) {
      const p = ringPos(TRAINING_JAR_R, i, 6, Math.PI / 6);
      obs.push({ x: p.x - 15, y: p.y - 15, w: 30, h: 30, type: "manajar", hp: 30, r: 16 });
    }

    // 遮蔽ゾーン。隠れる練習用に、コンテナ・崩れ壁・茂みを混ぜて並べる。
    const coverKinds = ["crate", "ruin", "bush", "bones", "crate", "bush", "spikes", "ruin", "bush", "crate", "statue", "bush"];
    for (let i = 0; i < coverKinds.length; i++) {
      const t = coverKinds[i];
      const p = ringPos(640 + (i % 3) * 90, i, coverKinds.length, 0.26);
      let w, h;
      if (t === "bush") { w = 104; h = 88; }
      else if (t === "ruin") { w = 150; h = 34; }
      else if (t === "statue") { w = 88; h = 46; }
      else if (t === "bones") { w = h = 46; }
      else if (t === "spikes") { w = h = 48; }
      else { w = h = 56; }
      obs.push({ x: p.x - w / 2, y: p.y - h / 2, w, h, type: t, hp: Infinity, seed: (i + 3) / 15 });
    }
    return obs;
  }

  // 常闇の樹海: 木と茂みで埋め尽くし、見通しを極端に悪くする。
  // 遮蔽が多いぶん、音を立てるとクリーチャーに位置がバレる。
  function genForestMap() {
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
      if (!farFromBase(x, y, w, h, 60)) continue;
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
      if (!farFromBase(x, y, w, h, 30)) continue;
      obs.push({ x, y, w, h, type: "bush", hp: Infinity, seed: Math.random() });
    }
    return obs;
  }

  function genRuinsMap() {
    const obs = [];
    // 外周の壁
    const wt = 26;
    obs.push({ x: 0, y: 0, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: WORLD_H - wt, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });
    obs.push({ x: WORLD_W - wt, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });

    // 神殿の外壁ブロック
    const blocks = 13;
    for (let i = 0; i < blocks; i++) {
      const w = rand(80, 240), h = rand(70, 200);
      const x = rand(160, WORLD_W - 160 - w);
      const y = rand(160, WORLD_H - 160 - h);
      // 祭壇と門のまわりは塞がない
      if (BASE_SPOTS.some((spot) => dist2(x + w / 2, y + h / 2, spot.x, spot.y) < 330 ** 2)) continue;
      obs.push({ x, y, w, h, type: "wall", hp: Infinity });
    }
    // 石柱の列。遺跡らしく等間隔に並べる。
    for (let line = 0; line < 4; line++) {
      const vertical = Math.random() < 0.5;
      const count = randInt(4, 7);
      const gap = rand(96, 134);
      const ox = rand(360, WORLD_W - 360), oy = rand(320, WORLD_H - 320);
      for (let i = 0; i < count; i++) {
        const x = ox + (vertical ? 0 : i * gap) - 22;
        const y = oy + (vertical ? i * gap : 0) - 22;
        if (x < 70 || y < 70 || x > WORLD_W - 114 || y > WORLD_H - 114) continue;
        if (BASE_SPOTS.some((spot) => dist2(x + 22, y + 22, spot.x, spot.y) < 300 ** 2)) continue;
        obs.push({ x, y, w: 44, h: 44, type: "column", hp: Infinity, seed: Math.random() });
      }
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
    const coverTypes = ["crate", "crate", "stonepile", "rock", "tree", "tree", "bush", "bush", "statue", "bones", "spikes", "column"];
    const covers = 46;
    for (let i = 0; i < covers; i++) {
      const t = pick(coverTypes);
      let w, h;
      if (t === "stonepile") { w = rand(70, 120); h = rand(26, 36); }
      else if (t === "bush") { w = rand(58, 104); h = rand(50, 88); }
      else if (t === "statue") { w = rand(74, 96); h = rand(40, 50); }
      else if (t === "tree") { w = h = rand(46, 68); }
      else if (t === "bones") { w = h = rand(38, 52); }
      else if (t === "spikes") { w = h = rand(40, 54); }
      else if (t === "column") { w = h = rand(40, 50); }
      else { w = rand(34, 60); h = rand(34, 60); }
      const x = rand(120, WORLD_W - 120 - w);
      const y = rand(120, WORLD_H - 120 - h);
      if (G.bases.some((base) => dist2(x + w / 2, y + h / 2, base.x, base.y) < (base.r + 55) ** 2)) continue;
      obs.push({ x, y, w, h, type: t, hp: Infinity, seed: Math.random() });
    }
    // 爆発する魔力の壺
    for (let i = 0; i < 9; i++) {
      const x = rand(200, WORLD_W - 220), y = rand(200, WORLD_H - 220);
      if (G.bases.some((base) => dist2(x, y, base.x, base.y) < (base.r + 60) ** 2)) continue;
      obs.push({ x, y, w: 30, h: 30, type: "manajar", hp: 30, r: 16 });
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

  // 職業の能力値を反映する。ショップ強化より先に呼ぶこと。
  function applyClass(s, key) {
    const c = classDef(key);
    s.classKey = c.key;
    s.maxHp = Math.max(40, s.maxHp + c.hpBonus);
    s.hp = s.maxHp;
    s.speed *= c.speedMul;
    s.rangedMul = c.rangedMul;
    s.magicMul = c.magicMul;
    s.healMul = c.healMul;
    s.meleeMul = c.meleeMul;
    s.pets = c.pets;
    s.maxBombs = c.bombs;
    s.bombs = c.bombs;
    s.maxGlyphs = c.glyphs;
    s.glyphs = c.glyphs;
    s.maxThorns = c.thorns;
    s.thorns = c.thorns;
    s.parryWindowMul = c.parryWindowMul;
    s.parryCooldownMul = c.parryCooldownMul;
    s.glyphArmMul = c.glyphArmMul;
    s.glyphBlastMul = c.glyphBlastMul;
    s.glyphStealthMul = c.glyphStealthMul;
    s.seesEnemyGlyphs = c.seesEnemyGlyphs;
    // 職業ごとに持てる武器は限定。数字キーはこの並び順に対応する。
    s.loadout = c.weapons.map((key) => WKEY[key]).filter((i) => i != null);
    s.weapon = s.loadout[0];
    s.ammo = WEAPONS[s.weapon].mag;
  }

  // 魔物の種族データを反映する。魔物は鎧も盾も道具も持たない。
  function applyFoe(s, key) {
    const f = foeDef(key);
    const D = DIFF[difficulty];
    s.foeKey = f.key;
    s.classKey = null;
    s.name = f.name;
    s.maxHp = Math.round(f.hp * D.hpMul);
    s.hp = s.maxHp;
    s.speed = f.speed * rand(0.94, 1.06);
    s.r = f.r;
    s.undead = f.undead;
    s.xpValue = f.xp;
    s.dmgMul = f.dmgMul * D.dmgMul;
    s.armor = 0; s.maxArmor = 0; s.shield = 0; s.maxShield = 0;
    s.bombs = 0; s.maxBombs = 0; s.glyphs = 0; s.maxGlyphs = 0; s.thorns = 0; s.maxThorns = 0;
    s.loadout = f.weapons.map((k) => WKEY[k]).filter((i) => i != null);
    s.weapon = s.loadout[0];
    s.ammo = WEAPONS[s.weapon].mag;
  }

  // ボスは門を壊すと現れる、そのステージの主。
  function applyBoss(s, def) {
    const D = DIFF[difficulty];
    s.boss = true;
    s.bossKey = def.key;
    s.classKey = null;
    s.name = def.name;
    s.maxHp = Math.round(def.hp * D.hpMul);
    s.hp = s.maxHp;
    s.speed = def.speed;
    s.r = def.r;
    s.xpValue = def.xp;
    s.dmgMul = def.dmgMul * D.dmgMul;
    s.armor = 0; s.maxArmor = 0; s.shield = 0; s.maxShield = 0;
    s.bombs = 0; s.maxBombs = 0; s.glyphs = 0; s.maxGlyphs = 0; s.thorns = 0; s.maxThorns = 0;
    s.loadout = def.weapons.map((k) => WKEY[k]).filter((i) => i != null);
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

  function makeUnit(opt) {
    const team = opt.team;
    const sp = teamSpawn(team);
    return {
      id: opt.id,
      team,
      name: opt.name,
      classKey: "swordsman",
      foeKey: null, boss: false, undead: false, xpValue: 1, pets: 0,
      rangedMul: 1, magicMul: 1, healMul: 1, meleeMul: 1,
      parryWindowMul: 1, parryCooldownMul: 1,
      glyphArmMul: 1, glyphBlastMul: 1, glyphStealthMul: 1, seesEnemyGlyphs: false,
      thorns: 0, maxThorns: 0, lastThorn: -99999,
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
      weapon: opt.weapon != null ? opt.weapon : WKEY.sword,
      ammo: WEAPONS[opt.weapon != null ? opt.weapon : WKEY.sword].mag,
      reloading: false, reloadUntil: 0, lastShot: 0,
      kills: 0, deaths: 0,
      bombs: 3, maxBombs: 3, lastBomb: -99999, vehicleId: -1, ballistaId: -1,
      glyphs: 2, maxGlyphs: 2, lastGlyph: -99999,
      lastBaseSupplyAt: -99999,
      lastFootstepAt: -99999, noiseRadius: 0, heardUntil: 0,
      hitFlash: 0, recoil: 0, legPhase: Math.random() * 6.28, moving: false, muzzle: 0,
      ai: { think: 0, targetId: -1, strafe: 1, strafeUntil: 0, lastSeen: 0, lostAt: 0, wx: sp.x, wy: sp.y, fireUntil: 0 },
      // ネット補間用
      rx: sp.x, ry: sp.y,
    };
  }

  function spawnTeams() {
    let id = G.nextId;
    const me = makeUnit({ id: id++, team: TEAM_HERO, name: playerName || "あなた", isHuman: true, controller: "local" });
    applyClass(me, playerClass);
    applyShopUpgrades(me, shopLevels);
    G.localId = me.id;
    G.units.push(me);
    // タッチ操作は照準を保持するので、開始時から魔界の門のほうを向かせておく
    localInput.aimAngle = me.angle;
    G.nextId = id;
    // 訓練の間には魔物を出さない。代わりに反撃してこない木人を並べる。
    if (isTraining()) { spawnTrainingDummies(); return; }
    // 仲間はプレイヤーと違う職業を優先して選び、パーティの役割が偏らないようにする
    const used = new Set([me.name]);
    const rest = CLASSES.filter((c) => c.key !== playerClass);
    for (let i = 0; i < PARTY_SIZE - 1; i++) {
      let n; do { n = pick(BOT_NAMES); } while (used.has(n) && used.size < BOT_NAMES.length);
      used.add(n);
      const ally = makeUnit({ id: id++, team: TEAM_HERO, name: n });
      // 仲間はプレイヤーよりわずかに弱くして、活躍の場を残す
      ally.maxHp = 95;
      ally.hp = ally.maxHp;
      ally.dmgMul = 0.9;
      applyClass(ally, rest[i % rest.length].key);
      G.units.push(ally);
    }
    G.nextId = id;
    // 開幕から数体の魔物が門の前に構えている
    const opening = Math.round(4 * DIFF[difficulty].foeMul);
    for (let i = 0; i < opening; i++) spawnFoe();
    G.nextFoeAt = now() + FOE_SPAWN_MS;
  }

  // 門の体力が減るほど強い魔物が湧く。tier の上限を進行度で持ち上げる。
  function pickFoeKey() {
    const gate = G.bases[TEAM_FOE];
    const progress = gate && gate.maxHp ? 1 - clamp(gate.hp / gate.maxHp, 0, 1) : 0;
    const maxTier = progress > 0.75 ? 3 : progress > 0.45 ? 2 : progress > 0.18 ? 1 : 0;
    const pool = FOES.filter((f) => f.tier <= maxTier);
    return pick(pool).key;
  }

  const aliveFoes = () => G.units.filter((s) => s.team === TEAM_FOE && !s.dead).length;

  // 門の周りから魔物を送り出す。門が壊れていればもう湧かない。
  function spawnFoe() {
    const gate = G.bases[TEAM_FOE];
    if (!gate || gate.hp <= 0 || gate.hidden) return null;
    const foe = makeUnit({ id: G.nextId++, team: TEAM_FOE, name: "魔物" });
    applyFoe(foe, pickFoeKey());
    foe.weapon = pick(foe.loadout);
    foe.ammo = WEAPONS[foe.weapon].mag;
    G.units.push(foe);
    for (let i = 0; i < 8; i++) {
      addParticle(foe.x, foe.y, {
        kind: "rune", vx: rand(-40, 40), vy: rand(-70, -10), life: rand(400, 800), size: rand(3, 6),
      });
    }
    return foe;
  }

  function updateFoeSpawns(t) {
    if (isTraining() || G.over) return;
    const gate = G.bases[TEAM_FOE];
    if (!gate || gate.hp <= 0) { summonBoss(); return; }
    if (t < G.nextFoeAt) return;
    const limit = Math.round(FOE_LIMIT * DIFF[difficulty].foeMul);
    G.nextFoeAt = t + FOE_SPAWN_MS;
    if (aliveFoes() >= limit) return;
    spawnFoe();
  }

  // 門が砕けた瞬間、その奥からステージの主が現れる。
  function summonBoss() {
    if (G.bossSummoned || isTraining()) return;
    const def = bossDef();
    G.bossSummoned = true;
    if (!def) return;
    const gate = G.bases[TEAM_FOE];
    const boss = makeUnit({ id: G.nextId++, team: TEAM_FOE, name: def.name });
    applyBoss(boss, def);
    boss.x = gate.x; boss.y = gate.y; boss.rx = boss.x; boss.ry = boss.y;
    boss.angle = gate.heading; boss.aimAngle = gate.heading;
    G.units.push(boss);
    G.boss = boss.id;
    Audio.roar();
    shake = Math.min(24, shake + 16);
    createExplosionFx(boss.x, boss.y, 40);
    banner(`門の奥から ${def.name} が現れた！`);
  }

  const bossUnit = () => (G.boss == null ? null : G.units.find((s) => s.id === G.boss) || null);

  // ============================================================
  //  練習用の木人 (訓練の間)
  //  反撃してこない。壊しても数秒で立て直る。
  // ============================================================
  const DUMMY_HP = 70;
  const DUMMY_RESPAWN_MS = 2200;

  // 的は「自分の1つ隣の陣営」に所属させる。既存の敵味方判定をそのまま使えるため。
  function trainingDummyTeam() {
    return (playerTeam + 1) % TEAM_COUNT;
  }

  function makeDummy(id, opt) {
    const s = makeUnit({ id, team: trainingDummyTeam(), name: opt.name });
    s.dummy = true;
    s.maxHp = DUMMY_HP; s.hp = DUMMY_HP;
    s.armor = 0; s.maxArmor = 0; s.shield = 0; s.maxShield = 0;
    s.bombs = 0; s.maxBombs = 0; s.glyphs = 0; s.maxGlyphs = 0; s.thorns = 0; s.maxThorns = 0;
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
      G.units.push(makeDummy(id++, { name: `木人 ${i + 1}`, x: p.x, y: p.y, angle: p.a }));
    }
    // 動く木人。狙いを先読みする練習用に、中心のまわりをゆっくり周回する。
    const movers = 3;
    for (let i = 0; i < movers; i++) {
      const p = ringPos(TRAINING_MOVER_R, i, movers, Math.PI / 6);
      G.units.push(makeDummy(id++, {
        name: `動く木人 ${i + 1}`, x: p.x, y: p.y, angle: p.a,
        orbit: { r: TRAINING_MOVER_R, a: p.a, speed: i % 2 ? -0.28 : 0.28 },
      }));
    }
    G.nextId = id;
  }

  // 的は攻撃しない。動く木人だけが中心のまわりを回る。
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

  // ---- 使い魔の狼 ----
  // 勇者側は獣使いが連れている相棒。魔物側は主を持たない野良の魔狼。
  const WOLF_NAMES = ["シロ", "クロ", "アオ", "ハイ", "キバ", "ツメ"];

  function makeWolf(id, team, handler) {
    let x, y;
    if (handler) { x = handler.x + rand(-45, 45); y = handler.y + rand(-45, 45); }
    else { const sp = teamSpawn(team); x = sp.x; y = sp.y; }
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!G.obstacles.some((o) => isSolid(o) && circleRect(x, y, BEAST_R + 3, o.x, o.y, o.w, o.h))) break;
      const sp = teamSpawn(team); x = sp.x; y = sp.y;
    }
    const wild = team === TEAM_FOE;
    return {
      kind: "beast", id, team, wild,
      name: wild ? "魔狼" : WOLF_NAMES[id % WOLF_NAMES.length],
      handlerId: handler ? handler.id : -1,
      x, y, rx: x, ry: y, spawnX: x, spawnY: y, angle: BASE_SPOTS[team].heading,
      hp: wild ? 105 : 90, maxHp: wild ? 105 : 90, dead: false, respawnAt: 0,
      speed: wild ? 236 : 248,
      damage: wild ? 26 : 30, lastAttack: -99999, biteAt: 0, kills: 0, stunnedUntil: 0,
    };
  }

  function spawnBeasts() {
    G.beasts = [];
    let id = 0;
    // 獣使いを選んだ人・仲間には、その人数ぶんの狼が付き従う
    for (const s of G.units) {
      const count = s.team === TEAM_HERO ? (s.pets || 0) : 0;
      for (let i = 0; i < count; i++) G.beasts.push(makeWolf(id++, s.team, s));
    }
    if (isTraining()) return;
    // 魔物側の野良魔狼。主を持たず、祭壇めがけて襲ってくる。
    const wilds = Math.round(2 * DIFF[difficulty].foeMul);
    for (let i = 0; i < wilds; i++) G.beasts.push(makeWolf(id++, TEAM_FOE, null));
  }

  function findGolemSpawn(team) {
    const spot = BASE_SPOTS[team];
    // 拠点からマップ中央寄りに少しずらした位置を基準にする
    const home = { x: spot.x + Math.cos(spot.heading) * 55, y: spot.y + Math.sin(spot.heading) * 55 };
    for (let i = 0; i < 50; i++) {
      const x = clamp(home.x + rand(-150, 150), 70, WORLD_W - 70);
      const y = clamp(home.y + rand(-150, 150), 70, WORLD_H - 70);
      if (!G.obstacles.some((o) => isSolid(o) && circleRect(x, y, GOLEM_R + 8, o.x, o.y, o.w, o.h))) return { x, y };
    }
    return home;
  }

  // ゴーレム。勇者側の守護ゴーレムは乗り込んで操れる。魔物側の魔像は自分で暴れる。
  function spawnGolems() {
    // 訓練の間では勇者側のゴーレムだけを置く
    const teams = isTraining() ? [TEAM_HERO] : TEAMS;
    G.golems = teams.map((team, id) => {
      const sp = findGolemSpawn(team);
      const heading = BASE_SPOTS[team].heading;
      return {
        kind: "golem", id, team, name: team === TEAM_HERO ? "守護ゴーレム" : "魔像ゴーレム",
        x: sp.x, y: sp.y, rx: sp.x, ry: sp.y, spawnX: sp.x, spawnY: sp.y,
        angle: heading, cannonAngle: heading,
        hp: 420, maxHp: 420, dead: false, respawnAt: 0, driverId: -1,
        speed: 105, lastShot: -99999, muzzle: 0, kills: 0, weapon: 0,
        ai: { think: 0, targetId: -1 },
      };
    });
  }

  // ============================================================
  //  クリーチャー (常闇の樹海)
  //  ステージに1体だけ。倒せない代わりに、走らなければ気づかれない。
  //  触れられたら即死。
  // ============================================================
  const CREATURE_R = 20;
  const CREATURE_HEAR_R = 560;       // 走る足音に気づく距離
  const CREATURE_SHOT_HEAR_R = 780;  // 攻撃音に気づく距離
  const CREATURE_SIGHT_R = 260;      // 歩いていても至近距離なら見つかる
  const CREATURE_HUNT_SPEED = 232;
  const CREATURE_ROAM_SPEED = 62;
  const CREATURE_LOSE_MS = 6000;     // 手がかりが無くなってから諦めるまで

  function spawnCreature() {
    if (!stageDef().creature) { G.creature = null; return; }
    // 最初はマップ中央付近、どの拠点からも離れた場所に潜ませる
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

  // 物音を立てた相手を探す。走る足音・攻撃音・至近距離の目視。
  function creatureFindPrey(cr, t) {
    let best = null, bestScore = Infinity;
    for (const s of G.units) {
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
      const tgt = G.units.find((s) => s.id === cr.targetId && !s.dead);
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
    for (const s of G.units) {
      if (s.dead || s.vehicleId >= 0) continue;
      if (dist2(cr.x, cr.y, s.x, s.y) > (CREATURE_R + UNIT_R) ** 2) continue;
      cr.lungeAt = t;
      if (s.id === G.localId) { shake = Math.min(22, shake + 16); Audio.roar(); }
      s.killedByCreature = true;
      damageUnit(s, 99999, null, { x: cr.x, y: cr.y, type: "creature", bypassEquipment: true });
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        addParticle(s.x, s.y, { kind: "blood", vx: Math.cos(a) * rand(60, 300), vy: Math.sin(a) * rand(60, 300), life: rand(400, 900), size: rand(2, 5) });
      }
    }
    for (const beast of G.beasts) {
      if (beast.dead) continue;
      if (dist2(cr.x, cr.y, beast.x, beast.y) > (CREATURE_R + BEAST_R) ** 2) continue;
      cr.lungeAt = t;
      destroyBeast(beast, null);
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

  // 訓練の間: 訓練場を囲むように、中央を向いた砲台を3つ据える。
  function spawnTrainingBallistas() {
    for (let i = 0; i < 3; i++) {
      const p = ringPos(TRAINING_BALLISTA_R, i, 3, Math.PI / 3);
      G.ballistas.push({
        kind: "ballista", id: i, x: p.x, y: p.y, angle: p.a + Math.PI,
        hp: 260, maxHp: 260, dead: false, respawnAt: 0,
        gunnerId: -1, team: -1, lastShot: -99999, muzzle: 0, hitFlash: 0,
      });
    }
  }

  // 中立の魔導砲台をマップ中央寄りに散らす。拠点のすぐ前には置かない。
  function spawnBallistas() {
    G.ballistas = [];
    if (isTraining()) { spawnTrainingBallistas(); return; }
    const count = 8;
    for (let id = 0; id < count; id++) {
      let placed = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        const x = rand(320, WORLD_W - 320), y = rand(280, WORLD_H - 280);
        if (G.bases.some((base) => dist2(x, y, base.x, base.y) < (base.r + 130) ** 2)) continue;
        if (G.obstacles.some((o) => isSolid(o) && circleRect(x, y, BALLISTA_R + 12, o.x, o.y, o.w, o.h))) continue;
        if (G.ballistas.some((tr) => dist2(x, y, tr.x, tr.y) < 420 ** 2)) continue;
        placed = { x, y };
        break;
      }
      if (!placed) continue;
      // 初期の向きはマップ中央へ
      const angle = Math.atan2(WORLD_H / 2 - placed.y, WORLD_W / 2 - placed.x);
      G.ballistas.push({
        kind: "ballista", id, x: placed.x, y: placed.y, angle,
        hp: 260, maxHp: 260, dead: false, respawnAt: 0,
        gunnerId: -1, team: -1, lastShot: -99999, muzzle: 0, hitFlash: 0,
      });
    }
  }

  function spawnPickups() {
    G.pickups = [];
    const kinds = [
      "potion", "potion", "potion", "potion", "potion", "potion", "potion", "potion",
      "armor", "armor", "armor", "armor", "armor", "armor",
      "shield", "shield", "shield", "shield",
    ];
    for (let id = 0; id < kinds.length; id++) {
      let placed = null;
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = rand(90, WORLD_W - 90), y = rand(90, WORLD_H - 90);
        const blocked = G.obstacles.some((o) => isSolid(o) && circleRect(x, y, 18, o.x, o.y, o.w, o.h)) ||
          G.golems.some((golem) => dist2(x, y, golem.x, golem.y) < (GOLEM_R + 28) ** 2);
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
      if (isSolid(o) && circleRect(tx, y, UNIT_R, o.x, o.y, o.w, o.h)) { tx = x; break; }
    }
    for (const golem of G.golems) {
      if (!golem.dead && golem.id !== s.vehicleId && dist2(tx, y, golem.x, golem.y) < (GOLEM_R + UNIT_R) ** 2) { tx = x; break; }
    }
    x = tx;
    let ty = ny;
    for (const o of G.obstacles) {
      if (isSolid(o) && circleRect(x, ty, UNIT_R, o.x, o.y, o.w, o.h)) { ty = y; break; }
    }
    for (const golem of G.golems) {
      if (!golem.dead && golem.id !== s.vehicleId && dist2(x, ty, golem.x, golem.y) < (GOLEM_R + UNIT_R) ** 2) { ty = y; break; }
    }
    y = ty;
    s.x = clamp(x, UNIT_R, WORLD_W - UNIT_R);
    s.y = clamp(y, UNIT_R, WORLD_H - UNIT_R);
  }

  function resolveGolemMovement(golem, nx, ny) {
    let x = golem.x, y = golem.y;
    let tx = clamp(nx, GOLEM_R, WORLD_W - GOLEM_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(tx, y, GOLEM_R, o.x, o.y, o.w, o.h)) ||
        G.golems.some((o) => o !== golem && !o.dead && dist2(tx, y, o.x, o.y) < (GOLEM_R * 2 + 4) ** 2)) tx = x;
    x = tx;
    let ty = clamp(ny, GOLEM_R, WORLD_H - GOLEM_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(x, ty, GOLEM_R, o.x, o.y, o.w, o.h)) ||
        G.golems.some((o) => o !== golem && !o.dead && dist2(x, ty, o.x, o.y) < (GOLEM_R * 2 + 4) ** 2)) ty = y;
    golem.x = x; golem.y = ty;
  }

  function resolveBeastMovement(beast, nx, ny) {
    let x = beast.x, y = beast.y;
    let tx = clamp(nx, BEAST_R, WORLD_W - BEAST_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(tx, y, BEAST_R, o.x, o.y, o.w, o.h)) ||
        G.golems.some((golem) => !golem.dead && dist2(tx, y, golem.x, golem.y) < (GOLEM_R + BEAST_R) ** 2)) tx = x;
    x = tx;
    let ty = clamp(ny, BEAST_R, WORLD_H - BEAST_R);
    if (G.obstacles.some((o) => isSolid(o) && circleRect(x, ty, BEAST_R, o.x, o.y, o.w, o.h)) ||
        G.golems.some((golem) => !golem.dead && dist2(x, ty, golem.x, golem.y) < (GOLEM_R + BEAST_R) ** 2)) ty = y;
    beast.x = x; beast.y = ty;
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
  //  攻撃 / ダメージ
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
    const mx = s.x + Math.cos(s.aimAngle) * (unitR(s) + 14);
    const my = s.y + Math.sin(s.aimAngle) * (unitR(s) + 14);
    // 魔法は魔力、弓は腕前で威力が変わる
    const power = w.magic ? (s.magicMul || 1) : (s.rangedMul || 1);
    for (let p = 0; p < w.pellets; p++) {
      const a = s.aimAngle + (Math.random() - 0.5) * w.spread * 2;
      if (G.projectiles.length < MAX_PROJECTILES) {
        G.projectiles.push({
          // 爆発する弾はゴーレムの岩塊砲と同じ「着弾して爆発する」種類として扱う
          kind: w.blast ? "shell" : "projectile",
          blast: !!w.blast,
          x: mx, y: my,
          vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
          dmg: w.dmg * s.dmgMul * power, team: s.team, owner: s.id,
          range: w.range, traveled: 0, pierce: w.pierce || 0,
          proj: w.proj, holy: !!w.holy, slow: w.slow || 0,
          col: PROJECTILE_COLORS[w.proj] || "#ffe49a",
          len: w.len,
        });
      }
    }
    // 詠唱の光 / 弦のはじけ
    addParticle(mx, my, {
      kind: w.magic ? "cast" : "flash", life: w.magic ? 200 : 60,
      size: w.magic ? 13 : 9, a: s.aimAngle,
    });
    shake = Math.min(9, shake + (s.id === G.localId ? w.kick * 0.5 : 0));
    if (s.id === G.localId || dist2(s.x, s.y, camX + viewW() / 2, camY + viewH() / 2) < 700 * 700) Audio.shot(w.snd);
  }

  // 飛び道具の色。proj の種類ごとに固定。
  const PROJECTILE_COLORS = {
    arrow: "#e6d9ae", axe: "#cfd6da", bone: "#e8e2cf", rock: "#a89a86",
    fire: "#ff9b3d", bolt: "#a8e4ff", ice: "#9fe8ff", holy: "#ffef9f", dark: "#c07cff",
  };

  // 癒しの光。前方の扇の中にいる味方(自分も含む)をまとめて回復する。
  function tryHeal(s, t, w) {
    if (s.ammo <= 0) { startReload(s, t); return; }
    s.lastShot = t;
    s.muzzle = t;
    s.ammo--;
    const arc = w.arc;
    const amount = w.heal * (s.healMul || 1);
    let healed = 0;
    for (const ally of G.units) {
      if (ally.dead || ally.team !== s.team || ally.hp >= ally.maxHp) continue;
      const d2v = dist2(s.x, s.y, ally.x, ally.y);
      if (d2v > w.range ** 2) continue;
      if (ally.id !== s.id) {
        const a = Math.atan2(ally.y - s.y, ally.x - s.x);
        if (angleGap(s.aimAngle, a) > arc) continue;
      }
      ally.hp = Math.min(ally.maxHp, ally.hp + amount);
      healed++;
      for (let i = 0; i < 5; i++) {
        addParticle(ally.x + rand(-10, 10), ally.y + rand(-8, 8), {
          kind: "heal", vx: rand(-14, 14), vy: rand(-60, -22), life: rand(420, 760), size: rand(3, 6),
        });
      }
    }
    for (const beast of G.beasts) {
      if (beast.dead || beast.team !== s.team || beast.hp >= beast.maxHp) continue;
      if (dist2(s.x, s.y, beast.x, beast.y) > w.range ** 2) continue;
      beast.hp = Math.min(beast.maxHp, beast.hp + amount);
      healed++;
      addParticle(beast.x, beast.y, { kind: "heal", vx: 0, vy: -40, life: 520, size: 5 });
    }
    const sx = s.x + Math.cos(s.aimAngle) * 24, sy = s.y + Math.sin(s.aimAngle) * 24;
    addParticle(sx, sy, { kind: "holyarc", life: 320, size: w.range * 0.5, a: s.aimAngle, arc });
    if (s.id === G.localId) {
      Audio.heal();
      banner(healed ? `癒しの光　${healed}人を回復` : "癒しの光　届く味方がいない");
    }
  }

  function tryMelee(s, t, w) {
    if (w.heal > 0) { tryHeal(s, t, w); return; }
    s.lastShot = t;
    s.muzzle = t;
    s.recoil = Math.min(8, s.recoil + w.kick);
    const arc = w.arc || 0.82;
    const dmg = w.dmg * s.dmgMul * (s.meleeMul || 1);
    let target = null, best = Infinity;
    for (const enemy of G.units) {
      if (enemy.dead || enemy.vehicleId >= 0 || enemy.team === s.team) continue;
      const d2v = dist2(s.x, s.y, enemy.x, enemy.y);
      if (d2v > (w.range + unitR(enemy)) ** 2 || d2v >= best || !lineClear(s.x, s.y, enemy.x, enemy.y)) continue;
      const a = Math.atan2(enemy.y - s.y, enemy.x - s.x);
      const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gap < arc) { target = enemy; best = d2v; }
    }
    for (const beast of G.beasts) {
      if (beast.dead || beast.team === s.team) continue;
      const d2v = dist2(s.x, s.y, beast.x, beast.y);
      if (d2v > w.range ** 2 || d2v >= best || !lineClear(s.x, s.y, beast.x, beast.y)) continue;
      const a = Math.atan2(beast.y - s.y, beast.x - s.x);
      const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gap < arc) { target = beast; best = d2v; }
    }
    for (const golem of G.golems) {
      if (golem.dead || golem.team === s.team) continue;
      const d2v = dist2(s.x, s.y, golem.x, golem.y);
      if (d2v > (w.range + GOLEM_R) ** 2 || d2v >= best || !lineClear(s.x, s.y, golem.x, golem.y)) continue;
      const a = Math.atan2(golem.y - s.y, golem.x - s.x);
      const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gap < arc) { target = golem; best = d2v; }
    }
    for (const enemyBase of G.bases) {
      if (enemyBase.team === s.team || enemyBase.hp <= 0) continue;
      const d2v = dist2(s.x, s.y, enemyBase.x, enemyBase.y);
      if (d2v >= (w.range + BASE_CORE_R) ** 2 || d2v >= best || !lineClear(s.x, s.y, enemyBase.x, enemyBase.y)) continue;
      const a = Math.atan2(enemyBase.y - s.y, enemyBase.x - s.x);
      const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gap < arc) { target = enemyBase; best = d2v; }
    }
    const sx = s.x + Math.cos(s.aimAngle) * 28, sy = s.y + Math.sin(s.aimAngle) * 28;
    addParticle(sx, sy, { kind: "slash", life: 150, size: w.range * 0.44, a: s.aimAngle, arc });
    if (target) {
      if (target.kind === "base") {
        damageBase(target, dmg * 0.75, s, s.team);
        addParticle(sx, sy, { kind: "spark", vx: rand(-70, 70), vy: rand(-70, 70), life: 180, size: 3 });
      } else if (target.kind === "golem") {
        damageGolem(target, 16 * s.dmgMul * (s.meleeMul || 1), s);
        addParticle(target.x, target.y, { kind: "spark", vx: rand(-70, 70), vy: rand(-70, 70), life: 180, size: 3 });
      } else if (target.kind === "beast") {
        damageBeast(target, dmg, s);
        addParticle(target.x, target.y, { kind: "dust", vx: rand(-80, 80), vy: rand(-80, 80), life: 300, size: 3 });
      } else {
        // 聖属性はアンデッドによく効く
        const holyDmg = w.holy && target.undead ? dmg * HOLY_VS_UNDEAD : dmg;
        const result = damageUnit(target, holyDmg, s, { x: s.x, y: s.y, type: "melee" });
        if (result !== "parried") {
          for (let i = 0; i < 6; i++) {
            addParticle(target.x, target.y, { kind: "blood", vx: rand(-110, 110), vy: rand(-110, 110), life: rand(220, 420), size: rand(1.5, 3.5) });
          }
        }
      }
    }
    if (s.id === G.localId || dist2(s.x, s.y, camX + viewW() / 2, camY + viewH() / 2) < 550 ** 2) Audio.melee();
  }

  // ゴーレムの武器。0 = 岩塊砲(爆発・対ゴーレム)、1 = 魔力連弾(連射・対人)
  const GOLEM_WEAPONS = [
    { name: "岩塊砲", interval: 1450, dmg: 125, speed: 720, range: 900, spread: 0, shell: true, flash: 20, snd: "blast", proj: "rock" },
    { name: "魔力連弾", interval: 130, dmg: 22, speed: 1250, range: 720, spread: 0.055, shell: false, flash: 10, snd: "cast", proj: "bolt" },
  ];

  function tryGolemShoot(golem, t) {
    if (golem.dead) return;
    const w = GOLEM_WEAPONS[golem.weapon || 0];
    if (t - golem.lastShot < w.interval) return;
    golem.lastShot = t;
    golem.muzzle = t;
    const a = golem.cannonAngle + (Math.random() - 0.5) * w.spread * 2;
    const mx = golem.x + Math.cos(a) * 48;
    const my = golem.y + Math.sin(a) * 48;
    const driver = G.units.find((s) => s.id === golem.driverId) || null;
    G.projectiles.push({
      kind: w.shell ? "shell" : "projectile", proj: w.proj, x: mx, y: my,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      dmg: w.dmg, team: golem.team, owner: driver ? driver.id : -1, golemOwner: golem.id,
      range: w.range, traveled: 0, pierce: 0, col: w.shell ? "#c8a06a" : "#a8e4ff", len: w.shell ? 12 : 15,
    });
    addParticle(mx, my, { kind: "flash", life: w.shell ? 100 : 55, size: w.flash, a });
    if (driver && driver.id === G.localId) shake = Math.min(14, shake + (w.shell ? 8 : 1.2));
    if (dist2(golem.x, golem.y, camX + viewW() / 2, camY + viewH() / 2) < 850 * 850) Audio.shot(w.snd);
  }

  function tryThrowBomb(s, t, angle) {
    if (s.dead || s.vehicleId >= 0 || s.shieldRaised || t < s.stunnedUntil || s.bombs <= 0 || t - s.lastBomb < 650) return;
    s.bombs--;
    s.lastBomb = t;
    const a = angle == null ? s.aimAngle : angle;
    G.bombs.push({
      x: s.x + Math.cos(a) * 20, y: s.y + Math.sin(a) * 20,
      vx: Math.cos(a) * 410, vy: Math.sin(a) * 410,
      team: s.team, owner: s.id, fuseAt: t + BOMB_FUSE_MS,
      bornAt: t, rotation: 0,
    });
  }

  // 呪印の罠は自分の足元に描く。描いてしばらくは起動しないので踏み逃げできる。
  function tryPlaceGlyph(s, t) {
    if (s.dead || s.vehicleId >= 0 || s.glyphs <= 0 || t - s.lastGlyph < GLYPH_PLACE_COOLDOWN) return;
    s.glyphs--;
    s.lastGlyph = t;
    G.glyphs.push({
      id: G.nextId++, x: s.x, y: s.y, team: s.team, owner: s.id,
      armAt: t + GLYPH_ARM_MS * (s.glyphArmMul || 1), placedAt: t,
      blastMul: s.glyphBlastMul || 1, stealthMul: s.glyphStealthMul || 1,
    });
    for (let i = 0; i < 5; i++) {
      addParticle(s.x + rand(-8, 8), s.y + rand(-8, 8), {
        kind: "dust", vx: rand(-25, 25), vy: rand(-25, 25), life: rand(250, 420), size: rand(2, 4),
      });
    }
    if (s.id === G.localId) banner(`呪印の罠を描いた（残り ${s.glyphs}）`);
  }

  function explodeGlyph(m) {
    Audio.boom();
    const radius = GLYPH_BLAST_R * (m.blastMul || 1);
    createExplosionFx(m.x, m.y, 34);
    const attacker = G.units.find((s) => s.id === m.owner) || null;
    if (dist2(m.x, m.y, camX + viewW() / 2, camY + viewH() / 2) < 900 ** 2) shake = Math.min(16, shake + 9);
    for (const s of G.units) {
      if (s.dead || s.vehicleId >= 0 || s.team === m.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, m.x, m.y));
      if (d < radius) damageUnit(s, GLYPH_DAMAGE * (1 - d / radius * 0.7), attacker, { x: m.x, y: m.y, type: "explosion" });
    }
    for (const beast of G.beasts) {
      if (beast.dead || beast.team === m.team) continue;
      const d = Math.sqrt(dist2(beast.x, beast.y, m.x, m.y));
      if (d < radius) damageBeast(beast, GLYPH_DAMAGE * (1 - d / radius * 0.7), attacker);
    }
    for (const golem of G.golems) {
      if (golem.dead || golem.team === m.team) continue;
      const d = Math.sqrt(dist2(golem.x, golem.y, m.x, m.y));
      // 呪印の罠は大型にもよく効く。ゴーレムには減衰なしで入る。
      if (d < radius + GOLEM_R) damageGolem(golem, GLYPH_DAMAGE * 1.3, attacker);
    }
    for (const o of G.obstacles) {
      if (o.type === "manajar" && dist2(o.x + o.w / 2, o.y + o.h / 2, m.x, m.y) < radius ** 2) o.hp = 0;
    }
  }

  // ---- 茨の呪縛 (狩人・獣使い専用) ----
  // 踏んだ敵の足を絡めとり、じわじわ削る。消えないが数に限りがある。
  function tryPlaceThorn(s, t) {
    if (s.dead || s.vehicleId >= 0 || (s.thorns || 0) <= 0 || t - s.lastThorn < THORN_PLACE_COOLDOWN) return;
    s.thorns--;
    s.lastThorn = t;
    G.thorns.push({ id: G.nextId++, x: s.x, y: s.y, team: s.team, owner: s.id, seed: Math.random() });
    if (s.id === G.localId) banner(`茨の呪縛を張った（残り ${s.thorns}）`);
  }

  function updateThorns(dt, t) {
    for (const s of G.units) {
      s.snared = false;
      if (s.dead || s.vehicleId >= 0) continue;
      for (const thorn of G.thorns) {
        if (thorn.team === s.team) continue;
        if (dist2(s.x, s.y, thorn.x, thorn.y) > THORN_R ** 2) continue;
        s.snared = true;
        const owner = G.units.find((o) => o.id === thorn.owner) || null;
        damageUnit(s, THORN_DPS * dt, owner, { x: thorn.x, y: thorn.y, type: "explosion", bypassEquipment: true });
        break;
      }
    }
  }

  function updateGlyphs(t) {
    for (let i = G.glyphs.length - 1; i >= 0; i--) {
      const m = G.glyphs[i];
      if (t < m.armAt) continue;
      let triggered = false;
      for (const s of G.units) {
        if (s.dead || s.vehicleId >= 0 || s.team === m.team) continue;
        if (dist2(s.x, s.y, m.x, m.y) < GLYPH_TRIGGER_R ** 2) { triggered = true; break; }
      }
      if (!triggered) {
        for (const golem of G.golems) {
          if (golem.dead || golem.team === m.team) continue;
          if (dist2(golem.x, golem.y, m.x, m.y) < (GLYPH_TRIGGER_R + GOLEM_R) ** 2) { triggered = true; break; }
        }
      }
      if (!triggered) {
        for (const beast of G.beasts) {
          if (beast.dead || beast.team === m.team) continue;
          if (dist2(beast.x, beast.y, m.x, m.y) < (GLYPH_TRIGGER_R + BEAST_R) ** 2) { triggered = true; break; }
        }
      }
      if (triggered) {
        explodeGlyph(m);
        G.glyphs.splice(i, 1);
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
    if (target.id === G.localId) { shake = Math.min(11, shake + 5); banner("PARRY!  攻撃を弾き返した"); }
    if (hit.type === "melee" && attacker && attacker.kind !== "golem") {
      attacker.stunnedUntil = now() + 650;
      addParticle(attacker.x, attacker.y - 18, { kind: "stun", life: 650, size: 12, a: 0 });
      const a = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      if (attacker.kind === "beast") {
        resolveBeastMovement(attacker, attacker.x + Math.cos(a) * 34, attacker.y + Math.sin(a) * 34);
        attacker.moving = false;
      } else {
        resolveMovement(attacker, attacker.x + Math.cos(a) * 28, attacker.y + Math.sin(a) * 28);
        attacker.shieldRaised = false;
        attacker.recoil = Math.max(attacker.recoil, 6);
      }
    }
  }

  function damageUnit(target, dmg, attacker, hit) {
    if (target.dead) return;
    if (!hit) hit = attacker ? { x: attacker.x, y: attacker.y, type: "projectile" } : null;
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
    // 砲台の石垣に守られている射手は被弾が軽い
    if (target.ballistaId >= 0) dmg *= BALLISTA_DAMAGE_TAKEN;
    if (dmg <= 0.01) { target.hitFlash = Math.max(target.hitFlash, 0.25); return "blocked"; }
    target.hp -= dmg;
    target.lastDamagedAt = now();
    target.hitFlash = 1;
    // 氷の魔法は当たった相手の足を鈍らせる
    if (hit && hit.slow) target.chilledUntil = now() + 900;
    if (target.id === G.localId) { Audio.hurt(); shake = Math.min(12, shake + 3); }
    if (target.hp <= 0) killUnit(target, attacker);
    return "hit";
  }

  function damageGolem(target, dmg, attacker) {
    if (target.dead || (attacker && attacker.team === target.team)) return;
    target.hp -= dmg;
    if (target.hp <= 0) destroyGolem(target, attacker);
  }

  function damageBeast(target, dmg, attacker) {
    if (target.dead || (attacker && attacker.team === target.team)) return;
    target.hp -= dmg;
    target.hitFlash = 1;
    if (target.hp <= 0) destroyBeast(target, attacker);
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
      banner("警告：勇者の祭壇が攻撃されています！");
    }
    if (base.hp <= 0) destroyBase(base, team);
  }

  // 祭壇が壊れる = 勇者はもう復活できない。門が壊れる = 魔物の増援が止まり、ボスが現れる。
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
    if (base.team === TEAM_HERO) {
      banner("勇者の祭壇が砕けた！　もう復活できません。生き残れ！");
    } else {
      banner("魔界の門を破壊！　魔物の増援は止まった");
      summonBoss();
    }
    checkVictory();
  }

  // 決着 = 片方の陣営が完全にいなくなったとき。
  // 「参戦中」= 拠点が健在(増援できる) or 生き残りがまだ立っている。
  function teamInPlay(team) {
    if (teamAlive(team)) return true;
    if (G.units.some((s) => s.team === team && !s.dead)) return true;
    return G.beasts.some((b) => b.team === team && !b.dead);
  }

  function checkVictory() {
    // 訓練の間に勝敗は無い
    if (G.over || isTraining()) return;
    // 魔物側は門が壊れたあと、ボスを召喚しきるまで決着を保留する
    if (!G.bossSummoned && !teamAlive(TEAM_FOE)) return;
    const inPlay = TEAMS.filter(teamInPlay);
    if (inPlay.length === 1) {
      endMatch(inPlay[0]);
    } else if (inPlay.length === 0) {
      endMatch(TEAM_FOE);
    }
  }

  function destroyBeast(beast, attacker) {
    if (beast.dead) return;
    beast.dead = true; beast.hp = 0; beast.respawnAt = now() + BEAST_RESPAWN_MS;
    for (let i = 0; i < 10; i++) {
      addParticle(beast.x, beast.y, { kind: "dust", vx: rand(-90, 90), vy: rand(-90, 90), life: rand(300, 650), size: rand(2, 5) });
    }
    if (attacker && attacker.team !== beast.team) {
      if (!attacker.kind) gainXp(attacker, 1);
      addKillfeed(attacker, { name: beast.wild ? "魔狼" : `狼 ${beast.name}`, team: beast.team });
    }
    // 狼は陣営の「生き残り」に数えるので、倒れたら決着判定をやり直す。
    // (最後の1体が狼だったときに、決着がつかないまま止まるのを防ぐ)
    if (!teamAlive(beast.team)) checkVictory();
  }

  function destroyGolem(golem, attacker) {
    if (golem.dead) return;
    golem.dead = true;
    golem.hp = 0;
    golem.respawnAt = now() + GOLEM_RESPAWN_MS;
    Audio.boom();
    shake = Math.min(18, shake + 12);
    createExplosionFx(golem.x, golem.y, 38);
    addParticle(golem.x, golem.y, { kind: "stain", life: 12000, size: 34 });
    const driver = G.units.find((s) => s.id === golem.driverId);
    golem.driverId = -1;
    if (driver) {
      driver.vehicleId = -1;
      driver.x = golem.x; driver.y = golem.y;
      damageUnit(driver, driver.maxHp * 2, attacker, { bypassEquipment: true });
    }
    if (attacker && attacker.team !== golem.team) {
      if (attacker.kind !== "golem") gainXp(attacker, 2);
      addKillfeed(attacker, { name: golem.name, team: golem.team });
    }
  }

  function killUnit(target, attacker) {
    target.dead = true;
    target.hp = 0;
    target.deaths++;
    target.respawnAt = now() + (target.dummy ? DUMMY_RESPAWN_MS : RESPAWN_MS);
    // 血しぶき
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(30, 220);
      addParticle(target.x, target.y, { kind: "blood", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(400, 900), size: rand(2, 5) });
    }
    addParticle(target.x, target.y, { kind: "stain", life: 9000, size: rand(16, 24) });
    if (target.boss) {
      // ボスは派手に散る
      shake = Math.min(26, shake + 20);
      createExplosionFx(target.x, target.y, 60);
      banner(`${target.name} を討ち取った！`);
    }
    if (attacker && attacker.team !== target.team && (attacker.kind || attacker.id !== target.id)) {
      attacker.kills++;
      G.score[attacker.team]++;
      if (!attacker.kind) gainXp(attacker, target.xpValue || (target.isHuman ? 2 : 1));
      addKillfeed(attacker, target);
    } else if (target.killedByCreature) {
      target.killedByCreature = false;
      addKillfeed({ name: "??????", team: -1 }, target);
    } else {
      addKillfeed(null, target);
    }
    if (target.team === TEAM_FOE) G.foesSlain++;
    // 拠点を失った陣営の生き残りが倒されたら、その陣営は消えたかもしれない
    if (!teamAlive(target.team)) {
      if (!teamInPlay(target.team) && target.team === TEAM_HERO) banner("勇者パーティ全滅…");
      checkVictory();
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
    s.x = sp.x; s.y = sp.y; s.rx = sp.x; s.ry = sp.y;
    s.hp = s.maxHp; s.dead = false; s.vx = 0; s.vy = 0;
    s.lastDamagedAt = -99999;
    s.armor = s.maxArmor; s.shield = s.maxShield; s.shieldRaised = false;
    s.parryUntil = 0; s.parryCooldownUntil = 0; s.stunnedUntil = 0;
    s.ammo = WEAPONS[s.weapon].mag; s.reloading = false;
    s.bombs = s.maxBombs || 3; s.vehicleId = -1; s.ballistaId = -1;
    s.glyphs = s.maxGlyphs || 2;
    s.thorns = s.maxThorns || 0;
    s.snared = false;
    s.ai.targetId = -1; s.ai.think = 0;
  }

  function respawnGolem(golem) {
    golem.x = golem.spawnX; golem.y = golem.spawnY; golem.rx = golem.x; golem.ry = golem.y;
    golem.hp = golem.maxHp; golem.dead = false; golem.driverId = -1;
    golem.angle = BASE_SPOTS[golem.team].heading;
    golem.cannonAngle = golem.angle; golem.ai.targetId = -1; golem.ai.think = 0;
  }

  function respawnBeast(beast) {
    const base = G.bases[beast.team];
    beast.x = base.x + Math.cos(base.heading) * 75;
    beast.y = base.y + Math.sin(base.heading) * 75;
    beast.rx = beast.x; beast.ry = beast.y; beast.hp = beast.maxHp; beast.dead = false;
    beast.angle = base.heading; beast.lastAttack = -99999; beast.hitFlash = 0;
    beast.stunnedUntil = 0;
  }

  function addKillfeed(killer, victim) {
    G.killfeed.push({ killer: killer ? killer.name : null, killerTeam: killer ? killer.team : -1, victim: victim.name, victimTeam: victim.team, t: now() });
    if (G.killfeed.length > 6) G.killfeed.shift();
  }

  function explodeManaJar(o) {
    Audio.boom();
    shake = Math.min(16, shake + 10);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(60, 360);
      addParticle(o.x + o.w / 2, o.y + o.h / 2, { kind: i % 3 === 0 ? "spark" : "smoke", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(300, 900), size: rand(4, 12) });
    }
    addParticle(o.x + o.w / 2, o.y + o.h / 2, { kind: "boom", life: 260, size: 8 });
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, R = 120;
    for (const s of G.units) {
      if (s.dead) continue;
      const dd = Math.sqrt(dist2(s.x, s.y, cx, cy));
      if (dd < R) damageUnit(s, (1 - dd / R) * 90, null, { x: cx, y: cy, type: "explosion" });
    }
    // 連鎖
    for (const o2 of G.obstacles) {
      if (o2.type === "manajar" && o2.hp > 0 && o2 !== o) {
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
    if (b.owner >= 0) return G.units.find((s) => s.id === b.owner) || null;
    if (b.golemOwner != null) return G.golems.find((golem) => golem.id === b.golemOwner) || null;
    return null;
  }

  function explodeProjectile(b) {
    Audio.boom();
    createExplosionFx(b.x, b.y, 28);
    const attacker = projectileAttacker(b);
    const radius = 118;
    for (const s of G.units) {
      if (s.dead || s.vehicleId >= 0 || s.team === b.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, b.x, b.y));
      if (d < radius) damageUnit(s, b.dmg * (1 - d / radius * 0.62), attacker, { x: b.x, y: b.y, type: "explosion" });
    }
    for (const beast of G.beasts) {
      if (beast.dead || beast.team === b.team) continue;
      const d = Math.sqrt(dist2(beast.x, beast.y, b.x, b.y));
      if (d < radius) damageBeast(beast, b.dmg * (1 - d / radius * 0.62), attacker);
    }
    for (const golem of G.golems) {
      if (golem.dead || golem.team === b.team) continue;
      const d = Math.sqrt(dist2(golem.x, golem.y, b.x, b.y));
      if (d < radius + GOLEM_R) damageGolem(golem, b.dmg * 0.85 * (1 - clamp(d / (radius + GOLEM_R), 0, 0.8)), attacker);
    }
    for (const ballista of G.ballistas) {
      if (ballista.dead || (ballista.team >= 0 && ballista.team === b.team)) continue;
      const d = Math.sqrt(dist2(ballista.x, ballista.y, b.x, b.y));
      if (d < radius + BALLISTA_R) damageBallista(ballista, b.dmg * 0.7 * (1 - clamp(d / (radius + BALLISTA_R), 0, 0.8)), attacker);
    }
    for (const base of G.bases) {
      if (base.team === b.team || base.hp <= 0) continue;
      const d = Math.sqrt(dist2(base.x, base.y, b.x, b.y));
      if (d < radius + BASE_CORE_R) {
        damageBase(base, b.dmg * 0.9 * (1 - clamp(d / (radius + BASE_CORE_R), 0, 0.78)), attacker, b.team);
      }
    }
    for (const o of G.obstacles) {
      if (o.type === "manajar" && dist2(o.x + o.w / 2, o.y + o.h / 2, b.x, b.y) < radius * radius) o.hp = 0;
    }
  }

  function explodeBomb(g) {
    Audio.boom();
    shake = Math.min(15, shake + 7);
    createExplosionFx(g.x, g.y, 32);
    const attacker = G.units.find((s) => s.id === g.owner) || null;
    for (const s of G.units) {
      if (s.dead || s.vehicleId >= 0 || s.team === g.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, g.x, g.y));
      if (d < BOMB_RADIUS) damageUnit(s, 130 * (1 - d / BOMB_RADIUS * 0.72), attacker, { x: g.x, y: g.y, type: "explosion" });
    }
    for (const beast of G.beasts) {
      if (beast.dead || beast.team === g.team) continue;
      const d = Math.sqrt(dist2(beast.x, beast.y, g.x, g.y));
      if (d < BOMB_RADIUS) damageBeast(beast, 130 * (1 - d / BOMB_RADIUS * 0.72), attacker);
    }
    for (const golem of G.golems) {
      if (golem.dead || golem.team === g.team) continue;
      const d = Math.sqrt(dist2(golem.x, golem.y, g.x, g.y));
      if (d < BOMB_RADIUS + GOLEM_R) damageGolem(golem, 95 * (1 - clamp(d / (BOMB_RADIUS + GOLEM_R), 0, 0.8)), attacker);
    }
    for (const ballista of G.ballistas) {
      if (ballista.dead || (ballista.team >= 0 && ballista.team === g.team)) continue;
      const d = Math.sqrt(dist2(ballista.x, ballista.y, g.x, g.y));
      if (d < BOMB_RADIUS + BALLISTA_R) damageBallista(ballista, 85 * (1 - clamp(d / (BOMB_RADIUS + BALLISTA_R), 0, 0.8)), attacker);
    }
    for (const base of G.bases) {
      if (base.team === g.team || base.hp <= 0) continue;
      const d = Math.sqrt(dist2(base.x, base.y, g.x, g.y));
      if (d < BOMB_RADIUS + BASE_CORE_R) {
        damageBase(base, 115 * (1 - clamp(d / (BOMB_RADIUS + BASE_CORE_R), 0, 0.78)), attacker, g.team);
      }
    }
    for (const o of G.obstacles) {
      if (o.type === "manajar" && dist2(o.x + o.w / 2, o.y + o.h / 2, g.x, g.y) < BOMB_RADIUS ** 2) o.hp = 0;
    }
  }

  function updateBombs(dt, t) {
    for (let i = G.bombs.length - 1; i >= 0; i--) {
      const g = G.bombs[i];
      if (t >= g.fuseAt) {
        explodeBomb(g);
        G.bombs.splice(i, 1);
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
    for (const s of G.units) {
      if (s.dead || s.hp >= s.maxHp || t - s.lastDamagedAt < AUTO_HEAL_DELAY_MS) continue;
      s.hp = Math.min(s.maxHp, s.hp + AUTO_HEAL_PER_SEC * dt);
    }
  }

  function updatePickups(t) {
    for (const kit of G.pickups) {
      if (!kit.active) {
        if (t >= kit.respawnAt) kit.active = true;
        else continue;
      }
      for (const s of G.units) {
        if (s.dead || s.vehicleId >= 0) continue;
        const needed = kit.kind === "potion" ? s.maxHp - s.hp : kit.kind === "armor" ? s.maxArmor - s.armor : s.maxShield - s.shield;
        if (needed < 1) continue;
        if (dist2(s.x, s.y, kit.x, kit.y) > 28 ** 2) continue;
        const amount = Math.min(kit.kind === "potion" ? POTION_HEAL : kit.kind === "armor" ? 55 : 80, needed);
        if (kit.kind === "potion") s.hp += amount;
        else if (kit.kind === "armor") s.armor += amount;
        else s.shield += amount;
        kit.active = false;
        kit.respawnAt = t + (kit.kind === "potion" ? 15000 : 18000);
        for (let i = 0; i < 9; i++) {
          addParticle(kit.x + rand(-10, 10), kit.y + rand(-8, 8), {
            kind: kit.kind === "potion" ? "heal" : "equip", vx: rand(-18, 18), vy: rand(-55, -20),
            life: rand(450, 850), size: rand(3, 6), a: kit.kind === "armor" ? 0 : 1,
          });
        }
        if (s.id === G.localId) {
          Audio.heal();
          const label = kit.kind === "potion" ? `回復薬 +${Math.ceil(amount)} HP` : kit.kind === "armor" ? `聖銀の鎧 +${Math.ceil(amount)}` : `盾耐久 +${Math.ceil(amount)}`;
          banner(label);
        }
        break;
      }
    }
  }

  // ============================================================
  //  パーティクル
  // ============================================================
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
      if (p.kind === "stain" || p.kind === "flash" || p.kind === "boom") continue;
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

  // 目視。fov に null を渡すと全方位(使い魔の狼など)。
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

    // 砲台に取り付いている間は撃つだけ。敵を見失って少し経ったら離れる。
    if (s.ballistaId >= 0) {
      const ballista = G.ballistas.find((x) => x.id === s.ballistaId && !x.dead);
      if (!ballista) { s.ballistaId = -1; }
      else {
        const target = a.targetId >= 0 ? G.units.find((x) => x.id === a.targetId && !x.dead) : null;
        if (target && canSee(s, target, BALLISTA_BOW.range, null)) {
          a.lastSeen = t;
          const aim = Math.atan2(target.y - s.y, target.x - s.x);
          ballista.angle = angLerp(ballista.angle, aim, clamp(dt * 7, 0, 1));
          s.aimAngle = ballista.angle;
          if (angleGap(ballista.angle, aim) < 0.12 && Math.random() < D.fireChance) tryBallistaShoot(ballista, t);
          return;
        }
        // 索敵しなおす
        if (t > a.think) {
          a.think = t + rand(150, 300);
          let best = -1, bestD = Infinity;
          for (const e of G.units) {
            if (e.dead || e.team === s.team) continue;
            const d2 = dist2(s.x, s.y, e.x, e.y);
            if (d2 < bestD && canSee(s, e, BALLISTA_BOW.range, null)) { bestD = d2; best = e.id; }
          }
          if (best >= 0) { a.targetId = best; a.lastSeen = t; }
        }
        if (t - a.lastSeen > 5000) { dismountBallista(s); a.targetId = -1; }
        return;
      }
    }
    if (t > a.think) {
      a.think = t + rand(120, 240);
      // 壁の裏 or 視野角の外なら気づかれない。足音も壁で遮られる。
      const sight = AI_SIGHT_R * daylightVisionMul();
      let best = -1, bestD = Infinity;
      for (const e of G.units) {
        if (e.dead || e.team === s.team) continue;
        const d2 = dist2(s.x, s.y, e.x, e.y);
        if (d2 >= bestD) continue;
        if (canSee(s, e, sight, AI_FOV) || canHear(s, e)) { bestD = d2; best = e.id; }
      }
      if (best >= 0) { a.targetId = best; a.lastSeen = t; }
      else if (t - a.lastSeen > 1400) a.targetId = -1;

      // ターゲット無し → 一番近い敵拠点へ進軍。
      // 拠点がもう無いなら、残った敵を探しに行く(そうしないと双方が立ち止まって決着しない)。
      if (a.targetId < 0) {
        const objective = nearestEnemyBase(s.x, s.y, s.team) || nearestEnemyFoe(s.x, s.y, s.team);
        if (objective) {
          a.wx = objective.x + rand(-45, 45);
          a.wy = objective.y + rand(-45, 45);
        }
      }
      if (t > a.strafeUntil) { a.strafe = Math.random() < 0.5 ? 1 : -1; a.strafeUntil = t + rand(500, 1100); }
    }

    // 僧侶は手負いの仲間を最優先で癒やす。癒し終わったら攻撃用の武器に戻す。
    if (healAllyIfNeeded(s, t, dt)) return;

    const w = WEAPONS[s.weapon];
    const unitTarget = a.targetId >= 0 ? G.units.find((x) => x.id === a.targetId) : null;
    const baseTarget = nearestEnemyBase(s.x, s.y, s.team);
    const target = unitTarget && !unitTarget.dead ? unitTarget : baseTarget;
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
      // 攻撃の判定
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
      if (vis && d > 130 && d < 430 + (targetIsBase ? BASE_CORE_R : 0) && s.bombs > 0 && t - s.lastBomb > 6500 && Math.random() < 0.008) {
        tryThrowBomb(s, t, desiredAim);
      }
      if (s.ammo <= 0) startReload(s, t);
      // 近くに空いている砲台があれば取り付いて撃つ
      if (s.vehicleId < 0 && !targetIsBase && t - (a.ballistaTry || 0) > 2500) {
        a.ballistaTry = t;
        for (const ballista of G.ballistas) {
          if (ballista.dead || ballista.gunnerId >= 0) continue;
          if (dist2(s.x, s.y, ballista.x, ballista.y) > 130 ** 2) continue;
          ballista.gunnerId = s.id; ballista.team = s.team; s.ballistaId = ballista.id;
          s.x = ballista.x - Math.cos(ballista.angle) * 16;
          s.y = ballista.y - Math.sin(ballista.angle) * 16;
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
      // 敵が見えていないときだけ、進路に呪印の罠を仕掛ける
      if (s.glyphs > 0 && t - s.lastGlyph > 9000 && Math.random() < 0.004) tryPlaceGlyph(s, t);
    }

    // 障害物回避(前方に壁があれば横へ)
    const probe = 40;
    const px = s.x + mvx * probe, py = s.y + mvy * probe;
    for (const o of G.obstacles) {
      if (isSolid(o) && circleRect(px, py, UNIT_R + 4, o.x, o.y, o.w, o.h)) {
        const tmp = mvx; mvx = -mvy * a.strafe; mvy = tmp * a.strafe;
        break;
      }
    }

    // 壁の角に引っかかったまま動けなくなることがあるので、
    // 進もうとしているのに進めていない相手は、しばらく真横へ迂回させる。
    if (t > (a.stuckCheckAt || 0)) {
      const moved = a.lastX == null ? 999 : Math.hypot(s.x - a.lastX, s.y - a.lastY);
      if (moved < 6 && Math.hypot(mvx, mvy) > 0.2) {
        a.stuckCount = (a.stuckCount || 0) + 1;
        a.strafe = -a.strafe;
        if (a.stuckCount >= 3) {
          // 横へ逃げても抜けられない袋小路。思い切ってまったく別の方向へ歩かせる。
          const ang = rand(0, Math.PI * 2);
          a.detourX = Math.cos(ang); a.detourY = Math.sin(ang);
          a.detourUntil = t + 1600;
          a.stuckCount = 0;
        } else {
          const m = Math.hypot(mvx, mvy) || 1;
          // 引っかかった瞬間の進行方向の真横を、迂回方向として覚えておく
          a.detourX = -(mvy / m) * a.strafe;
          a.detourY = (mvx / m) * a.strafe;
          a.detourUntil = t + 900;
        }
      } else {
        a.stuckCount = 0;
      }
      a.lastX = s.x; a.lastY = s.y;
      a.stuckCheckAt = t + 700;
    }
    if (t < (a.detourUntil || 0)) { mvx = a.detourX; mvy = a.detourY; }

    s.aimAngle = angLerp(s.aimAngle, desiredAim, clamp(dt * 9, 0, 1));
    applyMove(s, mvx, mvy, dt, false);
  }

  // 癒しの光を持つ仲間(CPU の僧侶)の振る舞い。
  // 体力の減った味方が視界内にいれば、そこへ寄って回復する。true を返したら他の行動はしない。
  const HEAL_SEEK_HP = 0.62;   // これを下回った味方を助けに行く
  function healAllyIfNeeded(s, t, dt) {
    const healSlot = s.loadout ? s.loadout.find((i) => WEAPONS[i].heal > 0) : -1;
    if (healSlot == null || healSlot < 0) return false;
    const healWeapon = WEAPONS[healSlot];
    let patient = null, best = Infinity;
    for (const ally of G.units) {
      if (ally.dead || ally.team !== s.team || ally.hp / ally.maxHp > HEAL_SEEK_HP) continue;
      const d2v = dist2(s.x, s.y, ally.x, ally.y);
      if (d2v < best && d2v < 620 ** 2) { best = d2v; patient = ally; }
    }
    if (!patient) {
      // 手当てが済んだら攻撃用の武器へ戻す
      if (s.weapon === healSlot) { s.weapon = s.loadout[0]; s.ammo = WEAPONS[s.weapon].mag; s.reloading = false; }
      return false;
    }
    if (s.weapon !== healSlot) { s.weapon = healSlot; s.ammo = healWeapon.mag; s.reloading = false; }
    const dx = patient.x - s.x, dy = patient.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    s.shieldRaised = false;
    s.aimAngle = angLerp(s.aimAngle, Math.atan2(dy, dx), clamp(dt * 9, 0, 1));
    if (d > healWeapon.range * 0.7) applyMove(s, dx / d, dy / d, dt, false);
    else { applyMove(s, 0, 0, dt, false); tryShoot(s, t); }
    if (s.ammo <= 0) startReload(s, t);
    return true;
  }

  function applyMove(s, mvx, mvy, dt, dash) {
    if (now() < s.stunnedUntil) { s.moving = false; s.noiseRadius = 0; return; }
    const m = Math.hypot(mvx, mvy);
    s.moving = m > 0.05;
    s.noiseRadius = s.moving ? (dash ? 680 : 430) : 0;
    if (m > 1) { mvx /= m; mvy /= m; }
    const chilled = now() < (s.chilledUntil || 0) ? 0.62 : 1;
    const sp = s.speed * (dash ? 1.55 : 1) * (s.shieldRaised ? 0.62 : 1) * (s.snared ? THORN_SLOW : 1) * chilled;
    const nx = s.x + mvx * sp * dt;
    const ny = s.y + mvy * sp * dt;
    resolveMovement(s, nx, ny);
    if (s.moving) s.legPhase += dt * 12;
  }

  // ---- 魔導砲台 ----
  function tryBallistaShoot(ballista, t) {
    if (ballista.dead || t - ballista.lastShot < BALLISTA_BOW.interval) return;
    ballista.lastShot = t;
    ballista.muzzle = t;
    const a = ballista.angle + (Math.random() - 0.5) * BALLISTA_BOW.spread * 2;
    const mx = ballista.x + Math.cos(a) * 34;
    const my = ballista.y + Math.sin(a) * 34;
    G.projectiles.push({
      kind: "projectile", x: mx, y: my,
      vx: Math.cos(a) * BALLISTA_BOW.speed, vy: Math.sin(a) * BALLISTA_BOW.speed,
      dmg: BALLISTA_BOW.dmg, team: ballista.team, owner: ballista.gunnerId,
      range: BALLISTA_BOW.range, traveled: 0, pierce: 0, proj: "holy", col: PROJECTILE_COLORS.holy, len: 22,
    });
    addParticle(mx, my, { kind: "flash", life: 55, size: 12, a });
    if (ballista.gunnerId === G.localId) shake = Math.min(9, shake + 1.1);
    if (dist2(ballista.x, ballista.y, camX + viewW() / 2, camY + viewH() / 2) < 700 ** 2) Audio.shot("bow");
  }

  function dismountBallista(s) {
    const ballista = G.ballistas.find((x) => x.id === s.ballistaId);
    if (ballista) { ballista.gunnerId = -1; ballista.team = -1; }
    s.ballistaId = -1;
  }

  function damageBallista(ballista, dmg, attacker) {
    if (ballista.dead) return;
    // 味方が使っている砲台は撃てない
    if (attacker && ballista.team >= 0 && attacker.team === ballista.team) return;
    ballista.hp -= dmg;
    ballista.hitFlash = 1;
    if (ballista.hp <= 0) destroyBallista(ballista, attacker);
  }

  function destroyBallista(ballista, attacker) {
    if (ballista.dead) return;
    ballista.dead = true;
    ballista.hp = 0;
    ballista.respawnAt = now() + BALLISTA_RESPAWN_MS;
    Audio.boom();
    createExplosionFx(ballista.x, ballista.y, 22);
    const gunner = G.units.find((s) => s.id === ballista.gunnerId);
    ballista.gunnerId = -1;
    ballista.team = -1;
    if (gunner) {
      gunner.ballistaId = -1;
      damageUnit(gunner, 55, attacker, { x: ballista.x, y: ballista.y, type: "explosion" });
    }
  }

  function updateBallistas(dt, t) {
    for (const ballista of G.ballistas) {
      if (ballista.hitFlash > 0) ballista.hitFlash = Math.max(0, ballista.hitFlash - dt * 4);
      if (ballista.dead) {
        if (t >= ballista.respawnAt) {
          ballista.dead = false; ballista.hp = ballista.maxHp; ballista.gunnerId = -1; ballista.team = -1;
        }
        continue;
      }
      // 射手が死んだ / 離れたら砲台を解放する
      const gunner = G.units.find((s) => s.id === ballista.gunnerId);
      if (ballista.gunnerId >= 0 && (!gunner || gunner.dead || gunner.ballistaId !== ballista.id)) {
        if (gunner) gunner.ballistaId = -1;
        ballista.gunnerId = -1;
        ballista.team = -1;
      }
    }
  }

  // E キーはゴーレムと砲台の両方に使う。近いほうへ乗り降りする。
  function enterOrExitGolem(s) {
    if (s.ballistaId >= 0) { dismountBallista(s); return; }
    if (s.vehicleId < 0) {
      let nearestBallista = null, bestBallista = BALLISTA_MOUNT_R * BALLISTA_MOUNT_R;
      for (const ballista of G.ballistas) {
        if (ballista.dead || ballista.gunnerId >= 0) continue;
        const d = dist2(s.x, s.y, ballista.x, ballista.y);
        if (d < bestBallista) { bestBallista = d; nearestBallista = ballista; }
      }
      // ゴーレムが同じくらい近ければゴーレムを優先する
      const nearGolem = G.golems.some((golem) => !golem.dead && golem.team === s.team && golem.driverId < 0 && dist2(s.x, s.y, golem.x, golem.y) < 78 * 78);
      if (nearestBallista && !nearGolem) {
        nearestBallista.gunnerId = s.id;
        nearestBallista.team = s.team;
        s.ballistaId = nearestBallista.id;
        s.x = nearestBallista.x - Math.cos(nearestBallista.angle) * 16;
        s.y = nearestBallista.y - Math.sin(nearestBallista.angle) * 16;
        s.moving = false;
        return;
      }
    }
    if (s.vehicleId >= 0) {
      const golem = G.golems.find((x) => x.id === s.vehicleId);
      if (golem) {
        golem.driverId = -1;
        const candidates = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
        let placed = false;
        for (const offset of candidates) {
          const a = golem.angle + offset;
          const x = golem.x + Math.cos(a) * (GOLEM_R + UNIT_R + 8);
          const y = golem.y + Math.sin(a) * (GOLEM_R + UNIT_R + 8);
          const blocked = G.obstacles.some((o) => isSolid(o) && circleRect(x, y, UNIT_R, o.x, o.y, o.w, o.h)) ||
            G.golems.some((o) => o !== golem && !o.dead && dist2(x, y, o.x, o.y) < (GOLEM_R + UNIT_R) ** 2);
          if (!blocked) { s.x = x; s.y = y; placed = true; break; }
        }
        if (!placed) { s.x = golem.x; s.y = golem.y; }
      }
      s.vehicleId = -1;
      return;
    }
    let nearest = null, best = 78 * 78;
    for (const golem of G.golems) {
      if (golem.dead || golem.team !== s.team || golem.driverId >= 0) continue;
      const d = dist2(s.x, s.y, golem.x, golem.y);
      if (d < best) { best = d; nearest = golem; }
    }
    if (nearest) {
      nearest.driverId = s.id;
      s.vehicleId = nearest.id;
      s.x = nearest.x; s.y = nearest.y; s.moving = false;
    }
  }

  function applyGolemInput(golem, s, inp, t) {
    s.shieldRaised = false;
    // 乗車中の武器切替は岩塊砲 / 魔力連弾の2択
    if (inp.weaponWanted != null && inp.weaponWanted >= 0) {
      golem.weapon = golem.weapon ? 0 : 1;
    }
    golem.cannonAngle = inp.aimAngle != null ? inp.aimAngle : golem.cannonAngle;
    const m = Math.hypot(inp.mvx, inp.mvy);
    if (m > 0.05) {
      const moveAngle = Math.atan2(inp.mvy, inp.mvx);
      golem.angle = angLerp(golem.angle, moveAngle, clamp(dtGlobal * 4.5, 0, 1));
      resolveGolemMovement(golem, golem.x + inp.mvx * golem.speed * dtGlobal, golem.y + inp.mvy * golem.speed * dtGlobal);
    }
    if (inp.shoot) tryGolemShoot(golem, t);
    inp.reloadEdge = false;
    inp.bombEdge = false;
    inp.glyphEdge = false;
    inp.thornEdge = false;
    inp.parryEdge = false;
    inp.weaponWanted = -1;
    s.x = golem.x; s.y = golem.y; s.aimAngle = golem.cannonAngle; s.moving = m > 0.05;
  }

  function updateGolems(dt, t) {
    for (const golem of G.golems) {
      if (golem.dead) {
        if (t >= golem.respawnAt && teamAlive(golem.team)) respawnGolem(golem);
        continue;
      }
      const driver = G.units.find((s) => s.id === golem.driverId && !s.dead);
      if (driver) {
        driver.x = golem.x; driver.y = golem.y; driver.aimAngle = golem.cannonAngle;
        continue;
      }
      if (golem.driverId >= 0) golem.driverId = -1;
      // 訓練の間では無人のゴーレムは動かない。的を勝手に壊さず、拠点の前で乗り手を待つ。
      if (isTraining()) continue;

      let target = nearestEnemyBase(golem.x, golem.y, golem.team);
      let best = target ? dist2(golem.x, golem.y, target.x, target.y) : Infinity;
      // 勇者・狼は視線が通っているときだけ捕捉する(壁の裏は狙われない)
      const golemSight = 880 * daylightVisionMul();
      for (const s of G.units) {
        if (s.dead || s.vehicleId >= 0 || s.team === golem.team) continue;
        const d = dist2(golem.x, golem.y, s.x, s.y);
        if (d < best && canSee(golem, s, golemSight, null)) { best = d; target = s; }
      }
      for (const beast of G.beasts) {
        if (beast.dead || beast.team === golem.team) continue;
        const d = dist2(golem.x, golem.y, beast.x, beast.y);
        if (d < best && canSee(golem, beast, golemSight, null)) { best = d; target = beast; }
      }
      for (const other of G.golems) {
        if (other.dead || other.team === golem.team) continue;
        const d = dist2(golem.x, golem.y, other.x, other.y);
        if (d < best) { best = d; target = other; }
      }
      if (!target) continue;
      const dx = target.x - golem.x, dy = target.y - golem.y;
      const d = Math.hypot(dx, dy) || 1;
      const aim = Math.atan2(dy, dx);
      golem.cannonAngle = angLerp(golem.cannonAngle, aim, clamp(dt * 2.7, 0, 1));
      if (d > (target.kind === "base" ? 420 : 360)) {
        golem.angle = angLerp(golem.angle, aim, clamp(dt * 2.2, 0, 1));
        resolveGolemMovement(golem, golem.x + Math.cos(golem.angle) * golem.speed * 0.7 * dt, golem.y + Math.sin(golem.angle) * golem.speed * 0.7 * dt);
      }
      // 相手が装甲なら岩塊砲、生身の相手や狼なら魔力連弾に持ち替える
      const armored = target.kind === "golem" || target.kind === "base";
      golem.weapon = armored ? 0 : 1;
      const aimGap = Math.abs(((aim - golem.cannonAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      const gapNeeded = golem.weapon === 0 ? 0.09 : 0.2;
      if (d < 880 + (target.kind === "base" ? BASE_CORE_R : 0) && aimGap < gapNeeded && lineClear(golem.x, golem.y, target.x, target.y)) tryGolemShoot(golem, t);
    }
  }

  function updateBeasts(dt, t) {
    for (const beast of G.beasts) {
      if (beast.dead) {
        if (t >= beast.respawnAt && teamAlive(beast.team)) respawnBeast(beast);
        continue;
      }
      if (beast.hitFlash > 0) beast.hitFlash = Math.max(0, beast.hitFlash - dt * 5);
      if (t < beast.stunnedUntil) { beast.moving = false; continue; }
      // 野良の魔狼に主はいない。勇者側の狼は獣使いに付き従う。
      let handler = beast.wild ? null : G.units.find((s) => s.id === beast.handlerId && !s.dead);
      if (!handler && !beast.wild) {
        handler = G.units.find((s) => s.team === beast.team && !s.dead) || null;
        if (handler) beast.handlerId = handler.id;
      }

      // 狼は全方位を見る(視野角の制限なし)が、壁の裏までは分からない
      const beastSight = 430 * daylightVisionMul();
      let target = null, best = Infinity;
      for (const enemy of G.units) {
        // 訓練の木人は狼に襲わせない(プレイヤーの練習を邪魔しないため)
        if (enemy.dead || enemy.dummy || enemy.vehicleId >= 0 || enemy.team === beast.team) continue;
        const d2v = dist2(beast.x, beast.y, enemy.x, enemy.y);
        if (d2v >= best) continue;
        if (canSee(beast, enemy, beastSight, null) || canHear(beast, enemy, 130)) { best = d2v; target = enemy; }
      }
      for (const enemyBeast of G.beasts) {
        if (enemyBeast === beast || enemyBeast.dead || enemyBeast.team === beast.team) continue;
        const d2v = dist2(beast.x, beast.y, enemyBeast.x, enemyBeast.y);
        if (d2v < best && canSee(beast, enemyBeast, 330 * daylightVisionMul(), null)) { best = d2v; target = enemyBeast; }
      }
      if (!target) {
        const enemyBase = nearestEnemyBase(beast.x, beast.y, beast.team);
        // 野良の魔狼は敵が見えなくても、まっすぐ祭壇を目指す
        if (enemyBase &&
            (beast.wild ||
             dist2(beast.x, beast.y, enemyBase.x, enemyBase.y) < 390 ** 2 ||
             (handler && dist2(handler.x, handler.y, enemyBase.x, enemyBase.y) < 430 ** 2))) {
          target = enemyBase;
        } else if (!enemyBase) {
          // 壊す拠点が無くなったら、残った相手を探しに行く
          target = nearestEnemyFoe(beast.x, beast.y, beast.team);
        }
      }

      let dx = 0, dy = 0, desired = beast.angle;
      if (target) {
        dx = target.x - beast.x; dy = target.y - beast.y;
        const d = Math.hypot(dx, dy) || 1;
        desired = Math.atan2(dy, dx);
        const targetR = target.kind === "base" ? BASE_CORE_R : target.kind === "beast" ? BEAST_R : unitR(target);
        if (d > BEAST_R + targetR + 7) { dx /= d; dy /= d; }
        else {
          dx = 0; dy = 0;
          if (t - beast.lastAttack >= 650) {
            beast.lastAttack = t; beast.biteAt = t;
            if (target.kind === "base") {
              damageBase(target, beast.damage * 0.55, beast, beast.team);
              addParticle(target.x + rand(-35, 35), target.y + rand(-30, 30), { kind: "spark", life: 170, size: 3, a: desired });
            } else if (target.kind === "beast") {
              damageBeast(target, beast.damage, beast);
              addParticle(target.x, target.y, { kind: "bite", life: 170, size: 18, a: desired });
            } else {
              const result = damageUnit(target, beast.damage, beast, { x: beast.x, y: beast.y, type: "melee" });
              if (result !== "parried") addParticle(target.x, target.y, { kind: "bite", life: 170, size: 18, a: desired });
            }
          }
        }
      } else if (handler) {
        dx = handler.x - beast.x; dy = handler.y - beast.y;
        const d = Math.hypot(dx, dy) || 1;
        desired = Math.atan2(dy, dx);
        if (d > 72) { dx /= d; dy /= d; } else { dx = 0; dy = 0; }
      }

      beast.angle = angLerp(beast.angle, desired, clamp(dt * 9, 0, 1));
      beast.moving = Math.hypot(dx, dy) > 0.05;
      if (beast.moving) {
        const ox = beast.x, oy = beast.y;
        resolveBeastMovement(beast, beast.x + dx * beast.speed * dt, beast.y + dy * beast.speed * dt);
        if (beast.x === ox && beast.y === oy) {
          resolveBeastMovement(beast, beast.x - dy * beast.speed * dt, beast.y + dx * beast.speed * dt);
        }
      }
    }
  }

  // 陥落した拠点は補給・回復の機能を失う
  function inFriendlyBase(entity) {
    const base = G.bases[entity.team];
    return !!base && base.hp > 0 && dist2(entity.x, entity.y, base.x, base.y) < base.r ** 2;
  }

  function updateBases(dt, t) {
    for (const base of G.bases) {
      if (base.hitFlash > 0) base.hitFlash = Math.max(0, base.hitFlash - dt * 4.5);
    }
    for (const s of G.units) {
      if (s.dead || !inFriendlyBase(s)) continue;
      if (s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + BASE_HEAL_PER_SEC * dt);
      if (s.armor < s.maxArmor) s.armor = Math.min(s.maxArmor, s.armor + 18 * dt);
      if (s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + 24 * dt);
      const w = WEAPONS[s.weapon];
      const maxBombs = s.maxBombs || 3;
      const maxGlyphs = s.maxGlyphs || 2;
      const maxThorns = s.maxThorns || 0;
      const needsSupply = (!w.melee && s.ammo < w.mag) || s.bombs < maxBombs || s.glyphs < maxGlyphs || s.thorns < maxThorns;
      if (needsSupply && t - s.lastBaseSupplyAt >= 3000) {
        if (!w.melee) s.ammo = w.mag;
        s.bombs = maxBombs; s.glyphs = maxGlyphs; s.thorns = maxThorns; s.reloading = false; s.lastBaseSupplyAt = t;
        if (s.id === G.localId) { Audio.heal(); banner("拠点でマナ・矢・火炎瓶・呪印の罠を補給"); }
      }
    }
    for (const beast of G.beasts) {
      if (!beast.dead && inFriendlyBase(beast) && beast.hp < beast.maxHp) beast.hp = Math.min(beast.maxHp, beast.hp + BASE_HEAL_PER_SEC * dt);
    }
    for (const golem of G.golems) {
      if (!golem.dead && inFriendlyBase(golem) && golem.hp < golem.maxHp) golem.hp = Math.min(golem.maxHp, golem.hp + BASE_REPAIR_PER_SEC * dt);
    }
  }

  let lastFootstepAudioAt = 0;
  function updateFootsteps(dt, t) {
    for (let i = G.soundPings.length - 1; i >= 0; i--) {
      const ping = G.soundPings[i];
      ping.life -= dt * 1000;
      if (ping.life <= 0) G.soundPings.splice(i, 1);
    }
    const me = localUnit();
    if (!me || me.dead) return;
    for (const enemy of G.units) {
      if (enemy.dead || enemy.dummy || enemy.vehicleId >= 0 || enemy.team === me.team || !enemy.moving) continue;
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
    const me = localUnit();
    if (me && !me.dead) {
      applyLocalToUnit(me, localInput, t);
    }
    // 各クライアントの入力反映 (host)
    if (mode === "host") {
      for (const s of G.units) {
        if (s.controller && s.controller !== "cpu" && s.controller !== "local" && !s.dead) {
          const inp = Net.clientInputs[s.controller];
          if (inp) applyLocalToUnit(s, inp, t);
        }
      }
    }
    // AI
    for (const s of G.units) {
      if (s.dead) continue;
      if (s.dummy) { updateDummy(s, dt); continue; }
      const human = s.controller === "local" || (s.controller && s.controller !== "cpu");
      if (!human) updateAI(s, t, dt);
    }
    updateGolems(dt, t);
    updateBallistas(dt, t);
    updateCreature(dt, t);
    updateBeasts(dt, t);
    updateFootsteps(dt, t);
    // 詠唱・矢のつがえ直しの完了
    for (let i = G.units.length - 1; i >= 0; i--) {
      const s = G.units[i];
      if (s.reloading && t >= s.reloadUntil) {
        s.reloading = false;
        s.ammo = WEAPONS[s.weapon].mag;
      }
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 4);
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 26);
      // 倒した魔物は復活せず、少し経つと消える。増援は門から新しく湧く。
      if (s.dead && s.team === TEAM_FOE && !s.dummy) {
        if (t >= s.respawnAt - RESPAWN_MS + 900) G.units.splice(i, 1);
        continue;
      }
      // 祭壇を失った勇者は復活できない(サバイバル形式)。木人だけは無関係に立て直る。
      if (s.dead && t >= s.respawnAt && (s.dummy || teamAlive(s.team))) respawn(s);
    }
    updateFoeSpawns(t);
    // 飛び道具
    updateProjectiles(dt);
    updateBombs(dt, t);
    updateGlyphs(t);
    updateThorns(dt, t);
    updateHealthRecovery(dt, t);
    updatePickups(t);
    updateBases(dt, t);
    // バレル爆発処理
    for (let i = G.obstacles.length - 1; i >= 0; i--) {
      const o = G.obstacles[i];
      if (o.type === "manajar" && o.hp <= 0) {
        explodeManaJar(o);
        G.obstacles.splice(i, 1);
      }
    }
    updateParticles(dt);
    updateTraining(dt, t);
  }

  // 砲台に取り付いている間は動けない。照準と攻撃だけ。
  function applyBallistaInput(ballista, s, inp, t) {
    ballista.angle = inp.aimAngle != null ? inp.aimAngle : ballista.angle;
    s.aimAngle = ballista.angle;
    s.x = ballista.x - Math.cos(ballista.angle) * 16;
    s.y = ballista.y - Math.sin(ballista.angle) * 16;
    s.moving = false;
    s.shieldRaised = false;
    if (inp.shoot) tryBallistaShoot(ballista, t);
    inp.reloadEdge = false;
    inp.bombEdge = false;
    inp.parryEdge = false;
    inp.glyphEdge = false;
    inp.thornEdge = false;
    inp.weaponWanted = -1;
  }

  function applyLocalToUnit(s, inp, t) {
    if (inp.interactEdge) { enterOrExitGolem(s); inp.interactEdge = false; }
    if (s.ballistaId >= 0) {
      const ballista = G.ballistas.find((x) => x.id === s.ballistaId && !x.dead);
      if (ballista) { applyBallistaInput(ballista, s, inp, t); return; }
      s.ballistaId = -1;
    }
    if (s.vehicleId >= 0) {
      const golem = G.golems.find((x) => x.id === s.vehicleId && !x.dead);
      if (golem) { applyGolemInput(golem, s, inp, t); return; }
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
      // 職業の装備に無い武器は選べない
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
    if (inp.bombEdge) { tryThrowBomb(s, t); inp.bombEdge = false; }
    if (inp.glyphEdge) { tryPlaceGlyph(s, t); inp.glyphEdge = false; }
    if (inp.thornEdge) { tryPlaceThorn(s, t); inp.thornEdge = false; }
    if (inp.shoot) tryShoot(s, t);
    applyMove(s, inp.mvx, inp.mvy, dtGlobal, inp.dash && !s.shieldRaised);
  }

  let dtGlobal = 0;

  function updateProjectiles(dt) {
    const bs = G.projectiles;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      const stepX = b.vx * dt, stepY = b.vy * dt;
      b.x += stepX; b.y += stepY;
      b.traveled += Math.hypot(stepX, stepY);
      let dead = false;
      if (b.traveled > b.range || b.x < 0 || b.y < 0 || b.x > WORLD_W || b.y > WORLD_H) {
        if (b.kind === "shell" && b.x >= 0 && b.y >= 0 && b.x <= WORLD_W && b.y <= WORLD_H) explodeProjectile(b);
        dead = true;
      }
      if (!dead) {
        // 障害物 (茂みや骨の柵は飛び道具が抜ける)
        for (const o of G.obstacles) {
          if (!stopsProjectiles(o)) continue;
          if (b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y && b.y <= o.y + o.h) {
            if (o.type === "manajar") { o.hp -= b.dmg; }
            if (b.kind === "shell") explodeProjectile(b);
            else addParticle(b.x, b.y, { kind: "spark", vx: -b.vx * 0.05 + rand(-30, 30), vy: -b.vy * 0.05 + rand(-30, 30), life: 160, size: 2.4 });
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 魔界の門の司令区画
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
        // ゴーレム
        for (const golem of G.golems) {
          if (golem.dead || golem.team === b.team) continue;
          if (dist2(b.x, b.y, golem.x, golem.y) < (GOLEM_R + 4) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageGolem(golem, b.dmg * 0.55, attacker);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-80, 80), vy: rand(-80, 80), life: 220, size: 3.2 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 魔導砲台 (中立のものは誰の攻撃でも当たる)
        for (const ballista of G.ballistas) {
          if (ballista.dead || (ballista.team >= 0 && ballista.team === b.team)) continue;
          if (dist2(b.x, b.y, ballista.x, ballista.y) < (BALLISTA_R + 3) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageBallista(ballista, b.dmg * 0.8, attacker);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-80, 80), vy: rand(-80, 80), life: 200, size: 3 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 使い魔の狼
        for (const beast of G.beasts) {
          if (beast.dead || beast.team === b.team) continue;
          if (dist2(b.x, b.y, beast.x, beast.y) < (BEAST_R + 3) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageBeast(beast, b.dmg, attacker);
              addParticle(b.x, b.y, { kind: "dust", vx: rand(-80, 80), vy: rand(-80, 80), life: 230, size: 3 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 勇者と魔物
        for (const s of G.units) {
          if (s.dead || s.vehicleId >= 0 || s.team === b.team || s.id === b.owner) continue;
          if (dist2(b.x, b.y, s.x, s.y) < (unitR(s) + 2) * (unitR(s) + 2)) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") {
              explodeProjectile(b);
            } else {
              // 聖属性はアンデッドによく効く
              const dmg = b.holy && s.undead ? b.dmg * HOLY_VS_UNDEAD : b.dmg;
              const result = damageUnit(s, dmg, attacker, { x: b.x - b.vx * 0.04, y: b.y - b.vy * 0.04, type: "projectile", slow: b.slow });
              if (result === "parried") {
                b.vx *= -1; b.vy *= -1; b.team = s.team; b.owner = s.id; b.golemOwner = null;
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
    let target = G.units.find((s) => s.id === spectateTargetId && !s.dead);
    if (!target || t > spectateSwitchAt) {
      const alive = G.units.filter((s) => !s.dead);
      if (alive.length) {
        // 討伐数が多い勇者ほど戦況の中心にいる
        const lead = alive.reduce((a, b) => (b.kills > a.kills ? b : a), alive[0]);
        target = lead;
        spectateTargetId = lead.id;
        spectateSwitchAt = t + 4000;
      }
    }
    return target;
  }

  function updateCamera() {
    const me = spectating ? spectateTarget() : localUnit();
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
    ctx.fillStyle = "#3a4a26";
    ctx.fillRect(0, 0, vw, vh);

    let sx = 0, sy = 0;
    if (shake > 0.2) { sx = rand(-shake, shake); sy = rand(-shake, shake); }
    ctx.save();
    ctx.translate(-camX + sx, -camY + sy);

    drawGround(vw, vh);
    drawBases();
    // 影 → ゴーレム → 勇者 → 投擲物/飛び道具 → パーティクル
    drawStains();
    drawObstaclesBack();
    drawThorns();
    drawGlyphs();
    drawPickups();
    for (const ballista of G.ballistas) if (!ballista.dead && isEntityVisible(ballista)) drawBallistaShadow(ballista);
    for (const golem of G.golems) if (!golem.dead && isEntityVisible(golem)) drawGolemShadow(golem);
    for (const beast of G.beasts) if (!beast.dead && isEntityVisible(beast)) drawBeastShadow(beast);
    for (const s of G.units) if (!s.dead && s.vehicleId < 0 && isEntityVisible(s)) drawUnitShadow(s);
    drawParticlesUnder();
    for (const ballista of G.ballistas) if (!ballista.dead && isEntityVisible(ballista)) drawBallista(ballista);
    for (const golem of G.golems) if (!golem.dead && isEntityVisible(golem)) drawGolem(golem);
    for (const beast of G.beasts) if (!beast.dead && isEntityVisible(beast)) drawBeast(beast);
    for (const s of G.units) if (!s.dead && s.vehicleId < 0 && isEntityVisible(s)) (s.dummy ? drawDummy(s) : drawUnit(s));
    if (G.creature && creatureVisible()) drawCreature(G.creature);
    drawObstaclesOver();
    drawBombs();
    drawProjectiles();
    drawParticlesOver();
    drawFootstepPings();
    drawNameTags();

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
    // 4隅のスポーンゾーンをチーム色で薄く塗る
    for (const base of G.bases) {
      if (base.hidden) continue;
      const def = teamDef(base.team);
      ctx.fillStyle = hexToRgba(def.flag, base.hp > 0 ? 0.06 : 0.02);
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
      ctx.rotate(base.heading);
      if (base.team === TEAM_HERO) drawAltarCore(base, def, fallen);
      else drawGateCore(base, def, fallen);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = fallen ? 0.55 : 1;
      ctx.font = "bold 14px -apple-system, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.75)";
      const label = fallen ? `${base.name}　破壊` : base.name;
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

  // 勇者の祭壇。石段の上に光の水晶を据えた復活点。
  function drawAltarCore(base, def, fallen) {
    const t = now();
    ctx.fillStyle = fallen ? "#3f3f38" : "#6d6a58";
    ctx.beginPath(); ctx.ellipse(0, 0, 74, 62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fallen ? "#4c4c43" : "#87836c";
    ctx.beginPath(); ctx.ellipse(0, 0, 56, 46, 0, 0, Math.PI * 2); ctx.fill();
    // 四方の柱
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const px = Math.cos(a) * 52, py = Math.sin(a) * 44;
      ctx.fillStyle = fallen ? "#43433b" : "#a49f83";
      ctx.fillRect(px - 8, py - 22, 16, 40);
      ctx.fillStyle = fallen ? "#35352f" : "#7d7961";
      ctx.fillRect(px - 10, py - 26, 20, 7);
    }
    // 中央の水晶。生きている間はゆっくり明滅する。
    const pulse = fallen ? 0 : 0.55 + Math.sin(t * 0.003) * 0.25;
    if (!fallen) {
      const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 48);
      glow.addColorStop(0, `rgba(150,220,255,${0.5 + pulse * 0.3})`);
      glow.addColorStop(1, "rgba(150,220,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = base.hitFlash > 0 ? "#fff0bd" : fallen ? "#4a4a45" : def.coreLight;
    ctx.beginPath();
    ctx.moveTo(0, -34); ctx.lineTo(17, -4); ctx.lineTo(0, 30); ctx.lineTo(-17, -4);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = fallen ? "rgba(255,255,255,0.12)" : `rgba(210,245,255,${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 3; ctx.stroke();
    if (!fallen) {
      ctx.fillStyle = `rgba(240,252,255,${0.35 + pulse * 0.35})`;
      ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(8, -4); ctx.lineTo(0, 12); ctx.lineTo(-8, -4); ctx.closePath(); ctx.fill();
    }
  }

  // 魔界の門。魔物が湧き出す黒い渦を石のアーチが囲む。
  function drawGateCore(base, def, fallen) {
    const t = now();
    ctx.fillStyle = fallen ? "#332b38" : "#463154";
    ctx.beginPath(); ctx.ellipse(0, 0, 78, 64, 0, 0, Math.PI * 2); ctx.fill();
    // アーチの脚
    ctx.fillStyle = fallen ? "#3b3342" : "#5d4470";
    ctx.fillRect(-14, -66, 26, 132);
    ctx.fillRect(-14, -66, 96, 22);
    ctx.fillRect(-14, 44, 96, 22);
    ctx.fillStyle = fallen ? "#2d2734" : "#725089";
    ctx.fillRect(62, -66, 22, 132);
    // 渦。壊れていなければ回り続ける。
    if (!fallen) {
      const swirl = ctx.createRadialGradient(24, 0, 4, 24, 0, 54);
      swirl.addColorStop(0, "rgba(20,4,30,0.96)");
      swirl.addColorStop(0.55, `rgba(150,70,225,${0.5 + Math.sin(t * 0.004) * 0.14})`);
      swirl.addColorStop(1, "rgba(60,20,90,0)");
      ctx.fillStyle = swirl;
      ctx.beginPath(); ctx.ellipse(24, 0, 54, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(215,150,255,0.6)"; ctx.lineWidth = 2.4;
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.0009 + i / 3) % 1;
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.beginPath(); ctx.ellipse(24, 0, 12 + p * 42, 11 + p * 38, t * 0.001, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "rgba(20,14,26,0.8)";
      ctx.beginPath(); ctx.ellipse(24, 0, 46, 42, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (base.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,240,200,${base.hitFlash * 0.5})`;
      ctx.beginPath(); ctx.ellipse(24, 0, 56, 52, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function currentVisionRadius() {
    const me = localUnit();
    const shortSide = Math.min(viewW(), viewH());
    // 画面サイズで頭打ちにしたうえで、時間帯の倍率をかける
    const base = me && me.vehicleId >= 0
      ? Math.min(GOLEM_VISION_R, Math.max(300, shortSide * 0.78))
      : Math.min(PLAYER_VISION_R, Math.max(210, shortSide * 0.6));
    return base * daylightVisionMul();
  }

  function isEntityVisible(entity) {
    if (spectating) return true;   // 観戦中は全部見える
    if (entity.dummy) return true; // 練習用の的は敵ではないので常に見える
    const me = localUnit();
    if (!me || entity.team === me.team) return true;
    const bonus = entity.kind === "golem" ? 65 : 0;
    const r = currentVisionRadius() + bonus;
    return dist2(me.x, me.y, entity.x, entity.y) < r ** 2 && lineClear(me.x, me.y, entity.x, entity.y);
  }

  // クリーチャーは視界の中にいるときだけ描く。姿が見えないほうが怖い。
  function creatureVisible() {
    const cr = G.creature;
    if (!cr) return false;
    if (spectating) return true;
    const me = localUnit();
    if (!me) return false;
    const r = currentVisionRadius() + 40;
    return dist2(me.x, me.y, cr.x, cr.y) < r * r && lineClear(me.x, me.y, cr.x, cr.y);
  }

  function drawStains() {
    for (const p of G.particles) {
      if (p.kind !== "stain") continue;
      const a = clamp(p.life / p.maxLife, 0, 1) * 0.5;
      ctx.fillStyle = `rgba(110,12,12,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.283);
      ctx.fill();
    }
  }

  // 木と茂みは勇者より手前に描く。茂みに入った勇者が隠れて見えるようにするため。
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
      if (kit.kind === "potion") {
        // 回復薬の小瓶
        ctx.fillStyle = "#c9b184"; ctx.fillRect(-4, -14, 8, 5);
        ctx.fillStyle = "#d9ead9"; ctx.strokeStyle = "#7c8a72"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-4, -9); ctx.lineTo(-9, 2); ctx.quadraticCurveTo(-9, 13, 0, 13);
        ctx.quadraticCurveTo(9, 13, 9, 2); ctx.lineTo(4, -9); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e0454f";
        ctx.beginPath(); ctx.ellipse(0, 5, 7, 6.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-6, -3, 3, 8);
      } else if (kit.kind === "armor") {
        // 聖銀の鎧
        ctx.fillStyle = "#8fa6c4"; ctx.strokeStyle = "#dbe9ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-3, -8); ctx.lineTo(3, -8); ctx.lineTo(12, -12);
        ctx.lineTo(14, 9); ctx.lineTo(5, 13); ctx.lineTo(-5, 13); ctx.lineTo(-14, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e0b73c"; ctx.fillRect(-2, -7, 4, 17);
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(-10, -6, 4, 10);
      } else {
        // 魔法の盾
        ctx.fillStyle = "#4a7fc4"; ctx.strokeStyle = "#cfe8ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(13, -8); ctx.lineTo(10, 8); ctx.quadraticCurveTo(0, 17, -10, 8); ctx.lineTo(-13, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffd76a";
        ctx.beginPath(); ctx.arc(0, -1, 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(-9, -7, 3, 9);
      }
      ctx.restore();
    }
  }

  function drawObstacle(o) {
    if (o.type === "wall") {
      // 石ブロックを積んだ壁
      ctx.fillStyle = "#5b564a";
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "rgba(0,0,0,0.22)"; ctx.lineWidth = 1;
      for (let y = o.y + 16; y < o.y + o.h; y += 16) {
        ctx.beginPath(); ctx.moveTo(o.x, y); ctx.lineTo(o.x + o.w, y); ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.24)";
      ctx.fillRect(o.x, o.y + o.h - 6, o.w, 6);
      ctx.strokeStyle = "rgba(0,0,0,0.32)"; ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    } else if (o.type === "column") {
      // 遺跡の石柱。上から見ると円形で、溝が放射状に見える。
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath(); ctx.ellipse(cx + 4, cy + 5, r, r * 0.92, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#a49c85";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c2b99c";
      ctx.beginPath(); ctx.arc(cx - 1, cy - 2, r * 0.74, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(90,84,68,0.55)"; ctx.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + (o.seed || 0);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.34, cy + Math.sin(a) * r * 0.34);
        ctx.lineTo(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74);
        ctx.stroke();
      }
    } else if (o.type === "crate") {
      ctx.fillStyle = "#8a5a2b"; ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "#5e3c1c"; ctx.lineWidth = 3;
      ctx.strokeRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4);
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y + o.h);
      ctx.moveTo(o.x + o.w, o.y); ctx.lineTo(o.x, o.y + o.h); ctx.stroke();
    } else if (o.type === "stonepile") {
      // 積み上げた石。矢を防ぐ簡易な遮蔽。
      const n = Math.max(2, Math.round(o.w / 24));
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 ? "#847d6a" : "#6d675a";
        ctx.beginPath();
        ctx.ellipse(o.x + (i + 0.5) * (o.w / n), o.y + o.h / 2, o.w / n / 2 + 1, o.h / 2, 0, 0, 6.283);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.09)";
      ctx.fillRect(o.x, o.y, o.w, 3);
    } else if (o.type === "rock") {
      ctx.fillStyle = "#6b6f72";
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h * 0.62, o.w / 2.4, o.h / 3, 0, 0, 6.283);
      ctx.fill();
    } else if (o.type === "manajar") {
      // 魔力の壺。攻撃を当てると割れて爆発する。
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.r || 15;
      const pulse = 0.6 + Math.sin(now() * 0.005 + cx) * 0.25;
      ctx.fillStyle = "#6d4a63";
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.94, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(190,110,255,${pulse})`;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.52, 0, 6.283); ctx.fill();
      ctx.strokeStyle = "#3b2a3a"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, 6.283); ctx.stroke();
      ctx.fillStyle = "#c8a06a"; ctx.fillRect(cx - 5, cy - r - 2, 10, 5);
    } else if (o.type === "ruin") {
      // 崩れかけた石壁。上辺をギザギザにして瓦礫感を出す。
      const seg = Math.max(3, Math.round(o.w / 18));
      ctx.fillStyle = "#6a6455";
      for (let i = 0; i < seg; i++) {
        const sw = o.w / seg;
        const drop = ((Math.sin((o.seed || 0) * 40 + i * 2.3) + 1) / 2) * o.h * 0.4;
        ctx.fillRect(o.x + i * sw, o.y + drop, sw + 0.5, o.h - drop);
      }
      ctx.fillStyle = "rgba(0,0,0,0.24)"; ctx.fillRect(o.x, o.y + o.h - 5, o.w, 5);
      ctx.strokeStyle = "rgba(35,32,26,0.5)"; ctx.lineWidth = 1;
      ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    } else if (o.type === "tree") {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath(); ctx.ellipse(cx + 4, cy + 6, r, r * 0.82, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#5a4029";
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.28, 0, 6.283); ctx.fill();
      // 葉は3枚重ねて厚みを出す
      const leaves = ["#2f5127", "#3a6330", "#46753a"];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = leaves[i];
        ctx.beginPath();
        ctx.arc(cx - i * 2, cy - i * 3, r * (1 - i * 0.18), 0, 6.283);
        ctx.fill();
      }
    } else if (o.type === "bush") {
      // 通り抜けられるが視線は通らない = 待ち伏せに使える
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const blobs = 5;
      for (let i = 0; i < blobs; i++) {
        const a = i * Math.PI * 2 / blobs + (o.seed || 0) * 6;
        ctx.fillStyle = i % 2 ? "rgba(52,92,44,0.86)" : "rgba(63,108,52,0.86)";
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * o.w * 0.2, cy + Math.sin(a) * o.h * 0.2, o.w * 0.34, o.h * 0.34, a, 0, 6.283);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(126,176,102,0.35)";
      ctx.beginPath(); ctx.ellipse(cx - o.w * 0.1, cy - o.h * 0.12, o.w * 0.2, o.h * 0.16, 0, 0, 6.283); ctx.fill();
    } else if (o.type === "statue") {
      // 倒れた石像
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(((o.seed || 0) - 0.5) * 0.7);
      ctx.fillStyle = "#7d7767";
      ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
      ctx.fillStyle = "#948d79";
      ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h * 0.34);
      ctx.fillStyle = "#6b6558";
      ctx.beginPath(); ctx.arc(-o.w * 0.32, 0, o.h * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2c2a24";
      ctx.beginPath(); ctx.arc(-o.w * 0.38, -o.h * 0.1, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-o.w * 0.38, o.h * 0.1, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(40,37,30,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(o.w * 0.1, -o.h / 2); ctx.lineTo(o.w * 0.02, o.h / 2); ctx.stroke();
      ctx.restore();
    } else if (o.type === "bones") {
      // 骨の山
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath(); ctx.ellipse(cx + 3, cy + 4, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ded7c2"; ctx.lineWidth = 5; ctx.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4 + (o.seed || 0) * 3;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r * 0.8, cy - Math.sin(a) * r * 0.6);
        ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = "#efe8d4";
      ctx.beginPath(); ctx.arc(cx, cy - 2, r * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a3730";
      ctx.beginPath(); ctx.arc(cx - r * 0.14, cy - 4, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * 0.14, cy - 4, 2.2, 0, Math.PI * 2); ctx.fill();
    } else if (o.type === "spikes") {
      // 骨の柵。通れないが矢と視線は抜ける。
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
      ctx.strokeStyle = "#cfc7b0"; ctx.lineWidth = 5; ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3 + (o.seed || 0);
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.strokeStyle = "#8a8371"; ctx.lineWidth = 2;
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
    if (s.id === G.localId) return { u: YOU_UNIFORM, a: YOU_ACCENT };
    const def = teamDef(s.team);
    return { u: def.uniform, a: def.accent };
  }

  function drawUnitShadow(s) {
    const r = unitR(s);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(s.x + 3, s.y + 5, r + 3, r - 1, 0, 0, 6.283);
    ctx.fill();
  }

  function drawBeastShadow(beast) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(beast.x + 3, beast.y + 5, 18, 9, beast.angle, 0, Math.PI * 2); ctx.fill();
  }

  // 使い魔の狼。魔物側の魔狼は紫の靄をまとう。
  function drawBeast(beast) {
    const def = teamDef(beast.team);
    const fur = beast.wild ? "#3b3040" : def.beastFur;
    const collar = def.beastHarness;
    const bite = now() - beast.biteAt < 170;
    ctx.save();
    ctx.translate(beast.x, beast.y); ctx.rotate(beast.angle);
    if (beast.wild) {
      const aura = ctx.createRadialGradient(0, 0, 3, 0, 0, 26);
      aura.addColorStop(0, "rgba(160,74,208,0.34)");
      aura.addColorStop(1, "rgba(160,74,208,0)");
      ctx.fillStyle = aura;
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
    }
    // 尾と脚
    ctx.strokeStyle = fur; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(-25, -9, -29, -3); ctx.stroke();
    ctx.fillStyle = "#2a251f";
    const stride = beast.moving ? Math.sin(now() * 0.018) * 4 : 0;
    ctx.fillRect(-9 + stride, -10, 5, 9); ctx.fillRect(5 - stride, -10, 5, 9);
    ctx.fillRect(-9 - stride, 2, 5, 9); ctx.fillRect(5 + stride, 2, 5, 9);
    // 胴体と首輪
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(-1, 0, 17, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath(); ctx.ellipse(-1, -3, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = collar; ctx.fillRect(6, -9, 4, 18);
    // 頭・耳・口
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(15, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = beast.wild ? "#241c2c" : "#2c2420";
    ctx.beginPath(); ctx.moveTo(10, -6); ctx.lineTo(9, -17); ctx.lineTo(18, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(9, 17); ctx.lineTo(18, 8); ctx.closePath(); ctx.fill();
    // 鼻先と牙
    ctx.fillStyle = bite ? "#d9d7c8" : "#241d19";
    ctx.beginPath(); ctx.ellipse(23, 0, bite ? 8 : 5, bite ? 5 : 4, 0, 0, Math.PI * 2); ctx.fill();
    if (bite) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(20, -4); ctx.lineTo(28, -2); ctx.lineTo(20, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(20, 4); ctx.lineTo(28, 2); ctx.lineTo(20, 0); ctx.closePath(); ctx.fill();
    }
    // 目
    ctx.fillStyle = beast.wild ? "#d07cff" : "#ffd76a";
    ctx.beginPath(); ctx.arc(17, -3.4, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(17, 3.4, 1.8, 0, Math.PI * 2); ctx.fill();
    if (beast.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${beast.hitFlash * 0.65})`;
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

  function drawBallistaShadow(ballista) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(ballista.x + 3, ballista.y + 5, BALLISTA_R + 2, BALLISTA_R - 4, 0, 0, Math.PI * 2); ctx.fill();
  }

  // 魔導砲台。石垣に据えられた大弓で、光の矢を放つ。
  function drawBallista(ballista) {
    const held = ballista.team >= 0;
    const accent = held ? teamDef(ballista.team).flag : "#a99f88";
    ctx.save();
    ctx.translate(ballista.x, ballista.y);
    // 石垣の陣地
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI * 2 / 6;
      ctx.fillStyle = i % 2 ? "#847d6a" : "#6d675a";
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * (BALLISTA_R - 2), Math.sin(a) * (BALLISTA_R - 2), 9, 6, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#4a4335";
    ctx.beginPath(); ctx.arc(0, 0, BALLISTA_R - 8, 0, Math.PI * 2); ctx.fill();
    // 弓と架台は照準方向へ回る
    ctx.rotate(ballista.angle);
    ctx.fillStyle = "#6b4a2c";
    ctx.fillRect(-4, -4, 34, 8);
    ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(14, 0, 17, -1.25, 1.25); ctx.stroke();
    ctx.strokeStyle = "rgba(240,240,225,0.75)"; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(14 + Math.cos(-1.25) * 17, Math.sin(-1.25) * 17);
    ctx.lineTo(4, 0);
    ctx.lineTo(14 + Math.cos(1.25) * 17, Math.sin(1.25) * 17);
    ctx.stroke();
    ctx.fillStyle = "#3a3d34";
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    if (now() - ballista.muzzle < 90) {
      ctx.fillStyle = "rgba(180,230,255,0.95)";
      ctx.beginPath(); ctx.moveTo(32, 0); ctx.lineTo(50, -6); ctx.lineTo(58, 0); ctx.lineTo(50, 6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (ballista.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${ballista.hitFlash * 0.5})`;
      ctx.beginPath(); ctx.arc(ballista.x, ballista.y, BALLISTA_R, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawGolemShadow(golem) {
    ctx.save();
    ctx.translate(golem.x + 5, golem.y + 8);
    ctx.rotate(golem.angle);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath(); ctx.ellipse(0, 0, 38, 30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ゴーレム。組み合わさった岩の塊で、継ぎ目から魔力が漏れる。
  function drawGolem(golem) {
    const def = teamDef(golem.team);
    const body = def.golemBody;
    const light = def.golemLight;
    const t = now();
    ctx.save();
    ctx.translate(golem.x, golem.y);
    ctx.rotate(golem.angle);
    // 脚代わりの岩塊
    ctx.fillStyle = "#31343a";
    ctx.beginPath(); ctx.ellipse(-18, -22, 15, 12, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-18, 22, 15, 12, -0.4, 0, Math.PI * 2); ctx.fill();
    // 胴体
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-30, -22); ctx.lineTo(16, -28); ctx.lineTo(32, -12);
    ctx.lineTo(32, 12); ctx.lineTo(16, 28); ctx.lineTo(-30, 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(-18, -15); ctx.lineTo(8, -18); ctx.lineTo(16, 0); ctx.lineTo(8, 18); ctx.lineTo(-18, 15); ctx.closePath(); ctx.fill();
    // 継ぎ目の魔力
    const pulse = 0.4 + Math.sin(t * 0.004) * 0.22;
    ctx.strokeStyle = `rgba(150,220,255,${pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-24, -6); ctx.lineTo(10, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-24, 6); ctx.lineTo(10, 10); ctx.stroke();
    ctx.restore();

    // 腕(砲)は照準方向へ独立して回る
    ctx.save();
    ctx.translate(golem.x, golem.y);
    ctx.rotate(golem.cannonAngle);
    ctx.fillStyle = "#3a3d44";
    ctx.beginPath();
    ctx.moveTo(6, -9); ctx.lineTo(44, -12); ctx.lineTo(50, 0); ctx.lineTo(44, 12); ctx.lineTo(6, 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.arc(4, 0, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(4, 0, 10, 0, Math.PI * 2); ctx.fill();
    // 掌の魔法陣
    ctx.strokeStyle = "rgba(160,225,255,0.75)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(46, 0, 7, 0, Math.PI * 2); ctx.stroke();
    if (now() - golem.muzzle < 110) {
      ctx.fillStyle = "rgba(180,230,255,0.95)";
      ctx.beginPath(); ctx.moveTo(50, 0); ctx.lineTo(68, -10); ctx.lineTo(78, 0); ctx.lineTo(68, 10); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // 近接武器の見た目。原点は握り手、+X が刃先の向き。
  function drawMeleeWeapon(style) {
    if (style === "longsword") {
      ctx.fillStyle = "#3a2a1e"; ctx.fillRect(-5, -2.5, 13, 5);
      ctx.fillStyle = "#d8b64a"; ctx.fillRect(7, -8, 4, 16);       // 鍔
      ctx.fillStyle = "#e9eef2";
      ctx.beginPath(); ctx.moveTo(11, -4); ctx.lineTo(40, -2.4); ctx.lineTo(46, 0); ctx.lineTo(40, 2.4); ctx.lineTo(11, 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8e9aa1"; ctx.lineWidth = 1; ctx.stroke();
    } else if (style === "greatsword") {
      ctx.fillStyle = "#3a2a1e"; ctx.fillRect(-8, -3, 18, 6);
      ctx.fillStyle = "#c48f34"; ctx.fillRect(9, -12, 5, 24);
      ctx.fillStyle = "#dfe6ec";
      ctx.beginPath(); ctx.moveTo(14, -7); ctx.lineTo(48, -5); ctx.lineTo(58, 0); ctx.lineTo(48, 5); ctx.lineTo(14, 7); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#7f8a91"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fillRect(18, -2, 30, 2);
    } else if (style === "sword") {
      ctx.fillStyle = "#4a3520"; ctx.fillRect(-4, -2.5, 11, 5);
      ctx.fillStyle = "#c8a04a"; ctx.fillRect(6, -6, 3.5, 12);
      ctx.fillStyle = "#e4ebf0";
      ctx.beginPath(); ctx.moveTo(9, -3.4); ctx.lineTo(34, -2); ctx.lineTo(39, 0); ctx.lineTo(34, 2); ctx.lineTo(9, 3.4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8e9aa1"; ctx.lineWidth = 1; ctx.stroke();
    } else if (style === "spear") {
      ctx.fillStyle = "#6b4a2c"; ctx.fillRect(-8, -2.5, 48, 5);
      ctx.fillStyle = "#dde4e9";
      ctx.beginPath(); ctx.moveTo(40, -6); ctx.lineTo(60, 0); ctx.lineTo(40, 6); ctx.lineTo(44, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8b969b"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#b0392f"; ctx.fillRect(34, -3.5, 5, 7);
    } else if (style === "whip") {
      // しなる鞭。先端に向かって細くなる。
      ctx.strokeStyle = "#6a4526"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(9, 0); ctx.stroke();
      ctx.strokeStyle = "#4a3520"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.quadraticCurveTo(28, -12, 44, -4); ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(44, -4); ctx.quadraticCurveTo(54, -1); ctx.stroke();
    } else if (style === "mace") {
      ctx.fillStyle = "#6a5230"; ctx.fillRect(-4, -3, 24, 6);
      ctx.fillStyle = "#cdd5da";
      ctx.beginPath(); ctx.arc(28, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#8b959b"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = "#e0b73c";
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(28 + Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.lineTo(28 + Math.cos(a) * 16, Math.sin(a) * 16);
        ctx.lineTo(28 + Math.cos(a + 0.5) * 8, Math.sin(a + 0.5) * 8);
        ctx.closePath(); ctx.fill();
      }
    } else if (style === "staff") {
      // 癒しの杖。先端の宝珠が光る。
      ctx.fillStyle = "#8a6a3a"; ctx.fillRect(-8, -2.5, 38, 5);
      ctx.fillStyle = "#e0b73c";
      ctx.beginPath(); ctx.arc(33, 0, 5, 0, Math.PI * 2); ctx.fill();
      const pulse = 0.5 + Math.sin(now() * 0.006) * 0.3;
      ctx.fillStyle = `rgba(255,246,190,${pulse})`;
      ctx.beginPath(); ctx.arc(33, 0, 9, 0, Math.PI * 2); ctx.fill();
    } else if (style === "claw") {
      // 魔物の爪
      ctx.strokeStyle = "#efe6d2"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * 5);
        ctx.quadraticCurveTo(12, i * 8, 21, i * 6);
        ctx.stroke();
      }
    } else if (style === "club") {
      ctx.fillStyle = "#5b3f24"; ctx.fillRect(-4, -3.5, 20, 7);
      ctx.fillStyle = "#6d4c2b";
      ctx.beginPath(); ctx.ellipse(26, 0, 12, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3d2a17";
      for (let i = 0; i < 3; i++) ctx.fillRect(20 + i * 5, -7 + (i % 2) * 8, 3, 4);
    } else {
      // dagger
      ctx.fillStyle = "#4a3520"; ctx.fillRect(-3, -3, 10, 6);
      ctx.fillStyle = "#c8a04a"; ctx.fillRect(6, -4.5, 2.5, 9);
      ctx.fillStyle = "#e4ebf0";
      ctx.beginPath(); ctx.moveTo(8, -3.4); ctx.lineTo(26, 0); ctx.lineTo(8, 3.4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8e9aa1"; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // 職業ごとのかぶりもの。原点は頭の中心、+X が正面。
  function drawHeadgear(kind, look, accent) {
    if (kind === "helm") {
      // 兜。額当てとスリットが正面に見える。
      ctx.fillStyle = "#b9c2cb";
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8d98a4";
      ctx.beginPath(); ctx.arc(1, 0, 9, -1.1, 1.1); ctx.fill();
      ctx.fillStyle = "#2c3138"; ctx.fillRect(5, -4.5, 4, 9);
      ctx.fillStyle = look.trim; ctx.fillRect(-9, -2, 4, 4);
    } else if (kind === "hat") {
      // とんがり帽子
      ctx.fillStyle = look.hair;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.cape;
      ctx.beginPath(); ctx.ellipse(-1, 0, 13, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.robe;
      ctx.beginPath(); ctx.moveTo(-13, -5); ctx.lineTo(4, -2); ctx.lineTo(4, 2); ctx.lineTo(-13, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = look.trim;
      ctx.beginPath(); ctx.arc(-12, 0, 3, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "hood") {
      // 目深なフード
      ctx.fillStyle = look.robe;
      ctx.beginPath(); ctx.ellipse(-1, 0, 11, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(20,24,18,0.75)";
      ctx.beginPath(); ctx.ellipse(4, 0, 6, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.trim;
      ctx.beginPath(); ctx.arc(-9, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "circlet") {
      // 頭巾と金の輪
      ctx.fillStyle = look.skin;
      ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.hair;
      ctx.beginPath(); ctx.arc(-2, 0, 8.5, 1.1, -1.1); ctx.fill();
      ctx.strokeStyle = look.trim; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, 8, -1.4, 1.4); ctx.stroke();
      ctx.fillStyle = "#fff3b0";
      ctx.beginPath(); ctx.arc(8, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "bandana") {
      ctx.fillStyle = look.skin;
      ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.hair;
      ctx.beginPath(); ctx.arc(-2, 0, 8.5, 1.0, -1.0); ctx.fill();
      ctx.fillStyle = look.trim;
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(7, -5); ctx.lineTo(7, -1); ctx.lineTo(-9, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = look.cape;
      ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(-16, -9); ctx.lineTo(-15, -2); ctx.closePath(); ctx.fill();
    } else {
      // fur: 獣の頭巾。耳が立っている。
      ctx.fillStyle = look.cape;
      ctx.beginPath(); ctx.ellipse(-1, 0, 10.5, 9.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.hair;
      ctx.beginPath(); ctx.moveTo(-3, -8); ctx.lineTo(-8, -16); ctx.lineTo(2, -9); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-3, 8); ctx.lineTo(-8, 16); ctx.lineTo(2, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = look.skin;
      ctx.beginPath(); ctx.arc(4, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(6, -2.4, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, 2.4, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 勇者(職業持ち)の描画。服・マント・かぶりものが職業ごとに変わる。
  function drawHero(s, c) {
    const look = classDef(s.classKey).look;
    const w = WEAPONS[s.weapon];
    const recoilBack = s.recoil * 0.6;
    // マント(体の後ろ側)
    ctx.fillStyle = look.cape;
    ctx.beginPath();
    ctx.moveTo(-6 - recoilBack, -13);
    ctx.quadraticCurveTo(-22 - recoilBack, 0, -6 - recoilBack, 13);
    ctx.closePath(); ctx.fill();
    // 胴体(自分だけ金色に寄せる)
    ctx.fillStyle = s.id === G.localId ? c.u : look.robe;
    ctx.beginPath();
    ctx.ellipse(-recoilBack, 0, UNIT_R - 1, UNIT_R + 1, 0, 0, 6.283);
    ctx.fill();
    // ベルトと縁取り
    ctx.fillStyle = look.trim;
    ctx.fillRect(-recoilBack - 3, -UNIT_R + 2, 5, UNIT_R * 2 - 4);
    // 鎧のプレート
    if (s.armor > 0) {
      const ar = clamp(s.armor / s.maxArmor, 0, 1);
      ctx.fillStyle = `rgba(196,214,232,${0.35 + ar * 0.45})`;
      ctx.fillRect(-10 - recoilBack, -12, 13, 8); ctx.fillRect(-10 - recoilBack, 4, 13, 8);
      ctx.strokeStyle = "rgba(230,244,255,0.42)"; ctx.lineWidth = 1; ctx.strokeRect(-10 - recoilBack, -12, 13, 24);
    }
    drawHeldWeapon(s, w, recoilBack, look);
    // 頭
    drawHeadgear(look.head, look, s.id === G.localId ? YOU_ACCENT : c.a);
  }

  // 手にしている武器と盾。近接は振り、弓は引き、魔法は光の球を掲げる。
  function drawHeldWeapon(s, w, recoilBack, look) {
    const t = now();
    if (s.shieldRaised && s.shield > 0) {
      const sr = clamp(s.shield / s.maxShield, 0, 1);
      const parrying = s.parryUntil > 0 && t <= s.parryUntil;
      ctx.fillStyle = parrying ? "rgba(255,226,112,0.94)" : `rgba(70,127,196,${0.72 + sr * 0.18})`;
      ctx.strokeStyle = parrying ? "#fff8bd" : "#cfe8ff"; ctx.lineWidth = parrying ? 5 : 2.5;
      ctx.beginPath(); ctx.moveTo(16, -19); ctx.quadraticCurveTo(28, -16, 29, 0); ctx.quadraticCurveTo(28, 16, 16, 19);
      ctx.lineTo(12, 12); ctx.lineTo(12, -12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffd76a"; ctx.beginPath(); ctx.arc(21, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look ? look.skin : "#caa06b";
      ctx.beginPath(); ctx.arc(12, -8, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, 8, 3.4, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const skin = look ? look.skin : "#caa06b";
    if (w.melee && w.heal <= 0) {
      const attackAge = t - s.muzzle;
      // 振りかぶり → 振り抜きを1回のスイングで表現。武器が重いほど大きく振る。
      const swingSpan = w.style === "greatsword" ? 2.6 : w.style === "mace" ? 2.2
        : w.style === "longsword" ? 2.2 : w.style === "whip" ? 1.7 : w.style === "spear" ? 0.5 : 1.9;
      const swingMs = w.style === "spear" ? 120 : 190;
      const swing = attackAge < swingMs ? -swingSpan / 2 + (attackAge / swingMs) * swingSpan : 0;
      // 槍だけは振らずに前へ突き出す
      const thrust = w.style === "spear" && attackAge < swingMs ? 14 * (1 - attackAge / swingMs) : 0;
      ctx.save();
      ctx.translate(UNIT_R - 4 - recoilBack + thrust, 0); ctx.rotate(swing);
      drawMeleeWeapon(w.style);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(1, 1, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (w.heal > 0) {
      ctx.save();
      ctx.translate(UNIT_R - 6 - recoilBack, 0);
      drawMeleeWeapon("staff");
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, 2, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (w.magic) {
      // 杖の先に魔力の球。詠唱直後は大きく光る。
      const charge = clamp(1 - (t - s.muzzle) / 260, 0, 1);
      ctx.fillStyle = "#5a4526";
      ctx.fillRect(UNIT_R - 6 - recoilBack, -2.5, w.len + 6, 5);
      const gx = UNIT_R - 6 - recoilBack + w.len + 8;
      ctx.fillStyle = PROJECTILE_COLORS[w.proj] || "#ffe49a";
      ctx.beginPath(); ctx.arc(gx, 0, 4.5 + charge * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.35 + charge * 0.4})`;
      ctx.beginPath(); ctx.arc(gx, 0, 2.4 + charge * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(UNIT_R - 2 - recoilBack, 2, 3.4, 0, 6.283); ctx.fill();
    } else if (w.proj === "axe") {
      // 投げ斧は手に持って構える
      ctx.save();
      ctx.translate(UNIT_R - 2 - recoilBack, 0);
      ctx.fillStyle = "#6b4a2c"; ctx.fillRect(0, -2, 14, 4);
      ctx.fillStyle = "#cfd7da";
      ctx.beginPath(); ctx.moveTo(12, -3); ctx.lineTo(21, -10); ctx.lineTo(26, -1); ctx.lineTo(20, 6); ctx.lineTo(12, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(UNIT_R - 2 - recoilBack, 2, 3.4, 0, 6.283); ctx.fill();
    } else {
      // 弓。射った直後は弦が伸びきる。
      const draw = clamp(1 - (t - s.muzzle) / 220, 0, 1);
      const bx = UNIT_R - 2 - recoilBack;
      const span = w.key === "longbow" ? 20 : 15;
      ctx.strokeStyle = "#6b4a2c"; ctx.lineWidth = 3.4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(bx, 0, span, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = "rgba(245,242,225,0.85)"; ctx.lineWidth = 1.3;
      const pull = -6 - draw * 6;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(-1.25) * span, Math.sin(-1.25) * span);
      ctx.lineTo(bx + pull, 0);
      ctx.lineTo(bx + Math.cos(1.25) * span, Math.sin(1.25) * span);
      ctx.stroke();
      if (draw > 0.05) {
        ctx.strokeStyle = "#e6d9ae"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx + pull, 0); ctx.lineTo(bx + span + 8, 0); ctx.stroke();
      }
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(bx + pull, 0, 3.2, 0, 6.283); ctx.fill();
    }
  }

  // 魔物の描画。種族ごとに輪郭・色・目つきを変える。
  // 小さく表示されても種類が分かるよう、暗い縁取りと「必ず見える武器」で
  // シルエットを立たせる。原点が中心、+X が正面。
  function drawFoeBody(s) {
    const def = s.boss ? BOSSES[s.bossKey] : foeDef(s.foeKey);
    const look = def.look || {};
    const style = def.style;
    const r = unitR(s);
    const t = now();
    const attacking = t - s.muzzle < 220;
    if (style === "drake") { drawDrake(s, look, r, attacking); return; }
    if (style === "fenrir") { drawFenrir(s, look, r, attacking); return; }

    ctx.lineJoin = "round";
    const outline = "rgba(12,10,16,0.85)";

    if (style === "warlock") {
      // 闇術師: 浮遊するローブ。足はなく、闇が渦を巻く。
      const swirl = ctx.createRadialGradient(0, 0, 2, 0, 0, r + 12);
      swirl.addColorStop(0, "rgba(150,70,210,0.55)");
      swirl.addColorStop(1, "rgba(150,70,210,0)");
      ctx.fillStyle = swirl;
      ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, Math.PI * 2); ctx.fill();
      // 後ろへ広がるローブ
      ctx.fillStyle = look.cloth;
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(r * 0.7, 0);
      ctx.quadraticCurveTo(0, -r * 1.05, -r * 1.25, -r * 0.75);
      ctx.quadraticCurveTo(-r * 0.5, 0, -r * 1.25, r * 0.75);
      ctx.quadraticCurveTo(0, r * 1.05, r * 0.7, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // フードの奥は真っ暗
      ctx.fillStyle = "rgba(16,8,26,0.92)";
      ctx.beginPath(); ctx.ellipse(r * 0.22, 0, r * 0.5, r * 0.48, 0, 0, Math.PI * 2); ctx.fill();
      // 光る眼
      ctx.fillStyle = look.eye;
      ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.2, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.35, r * 0.2, 2.3, 0, Math.PI * 2); ctx.fill();
      // 掲げた闇の球
      const orb = 0.55 + Math.sin(t * 0.006) * 0.25 + (attacking ? 0.4 : 0);
      ctx.fillStyle = `rgba(190,110,255,${clamp(orb, 0, 1)})`;
      ctx.beginPath(); ctx.arc(r * 1.15, r * 0.5, 4.4, 0, Math.PI * 2); ctx.fill();
      return;
    }

    if (style === "skeleton") {
      // 骸骨の射手: 骨組みの胴と、常に構えている骨の弓
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.fillStyle = look.cloth;
      ctx.beginPath(); ctx.ellipse(-r * 0.25, 0, r * 0.6, r * 0.82, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // 肋骨
      ctx.strokeStyle = look.skin; ctx.lineWidth = 2.2; ctx.lineCap = "round";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(-r * 0.62, i * r * 0.36); ctx.lineTo(r * 0.12, i * r * 0.36); ctx.stroke();
      }
      // 背骨
      ctx.beginPath(); ctx.moveTo(-r * 0.7, 0); ctx.lineTo(r * 0.2, 0); ctx.stroke();
      // 骨の弓(常時)
      ctx.strokeStyle = "#efe9d6"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(r * 0.95, 0, r * 0.85, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = "rgba(220,215,195,0.8)"; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(r * 0.95 + Math.cos(-1.2) * r * 0.85, Math.sin(-1.2) * r * 0.85);
      ctx.lineTo(r * 0.55, 0);
      ctx.lineTo(r * 0.95 + Math.cos(1.2) * r * 0.85, Math.sin(1.2) * r * 0.85);
      ctx.stroke();
      // 頭蓋骨
      ctx.fillStyle = look.skin;
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#2a2822";
      ctx.beginPath(); ctx.arc(r * 0.68, -r * 0.2, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.68, r * 0.2, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.eye;
      ctx.beginPath(); ctx.arc(r * 0.72, -r * 0.2, 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.72, r * 0.2, 1.1, 0, Math.PI * 2); ctx.fill();
      return;
    }

    if (style === "gargoyle") {
      // 石のガーゴイル: 左右に広げた石の翼が目印
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.fillStyle = look.cloth;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, side * r * 0.35);
        ctx.lineTo(-r * 0.95, side * (r + 12));
        ctx.lineTo(r * 0.35, side * (r * 0.9));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // 胴
      ctx.fillStyle = look.skin;
      ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.78, r * 0.9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.25, r * 0.4, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      // 頭
      ctx.fillStyle = look.skin;
      ctx.beginPath(); ctx.arc(r * 0.6, 0, r * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // 角
      ctx.fillStyle = "#3c3d43";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.5, side * r * 0.3);
        ctx.lineTo(r * 0.95, side * r * 0.85);
        ctx.lineTo(r * 0.8, side * r * 0.2);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = look.eye;
      ctx.beginPath(); ctx.arc(r * 0.82, -r * 0.18, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.82, r * 0.18, 2.3, 0, Math.PI * 2); ctx.fill();
      return;
    }

    // goblin / orc: 緑肌の二足歩行。オークは肩が張り、牙と棍棒で見分ける。
    const burly = style === "orc";
    ctx.strokeStyle = outline; ctx.lineWidth = 2;
    if (burly) {
      // 張った肩
      ctx.fillStyle = look.skin;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(r * 0.05, side * r * 0.72, r * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // 胴(前かがみ)
    ctx.fillStyle = look.cloth;
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, 0, r * (burly ? 0.72 : 0.6), r * (burly ? 0.82 : 0.7), 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // 常に見える武器(手前に置いて輪郭を作る)
    ctx.save();
    ctx.translate(r * 0.75, r * 0.55);
    ctx.rotate(attacking ? -0.5 : 0.35);
    ctx.scale(burly ? 0.85 : 0.7, burly ? 0.85 : 0.7);
    drawMeleeWeapon(burly ? "club" : "claw");
    ctx.restore();
    // 頭
    ctx.fillStyle = look.skin;
    ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(r * 0.55, 0, r * 0.52, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 後ろへ伸びる尖った耳
    ctx.fillStyle = look.skin;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.45, side * r * 0.3);
      ctx.lineTo(r * 0.05, side * (r * 0.95));
      ctx.lineTo(r * 0.55, side * r * 0.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 目
    ctx.fillStyle = "#20180f";
    ctx.beginPath(); ctx.arc(r * 0.78, -r * 0.2, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.78, r * 0.2, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.eye;
    ctx.beginPath(); ctx.arc(r * 0.82, -r * 0.2, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.82, r * 0.2, 1.3, 0, Math.PI * 2); ctx.fill();
    // オークの牙
    if (burly) {
      ctx.fillStyle = "#f4eedc";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.9, side * r * 0.26);
        ctx.lineTo(r * 1.22, side * r * 0.38);
        ctx.lineTo(r * 0.92, side * r * 0.06);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  // ボス: 炎竜。左右に張った翼と長い尾、口元の炎で竜だと分かるようにする。
  function drawDrake(s, look, r, attacking) {
    const t = now();
    const flap = Math.sin(t * 0.004) * 8;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(30,8,6,0.8)"; ctx.lineWidth = 2.5;
    // 尾(体の後ろへ長く伸ばす)
    ctx.strokeStyle = look.scale; ctx.lineWidth = 12; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.quadraticCurveTo(-r - 18, Math.sin(t * 0.003) * 16, -r - 46, Math.sin(t * 0.003) * 34);
    ctx.stroke();
    ctx.strokeStyle = "#6d1f19"; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-r - 40, Math.sin(t * 0.003) * 30);
    ctx.lineTo(-r - 58, Math.sin(t * 0.003) * 40);
    ctx.stroke();
    // 翼(膜を張った扇形)。上下に大きく広げる。
    for (const side of [-1, 1]) {
      const span = r + 26 + flap * side * 0.4;
      ctx.fillStyle = look.wing;
      ctx.strokeStyle = "rgba(30,8,6,0.75)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, side * r * 0.3);
      ctx.quadraticCurveTo(r * 0.4, side * span * 0.7, -r * 0.35, side * span);
      ctx.quadraticCurveTo(-r * 0.9, side * span * 0.65, -r * 0.8, side * r * 0.35);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 翼の骨
      ctx.strokeStyle = "rgba(240,190,120,0.5)"; ctx.lineWidth = 1.6;
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, side * r * 0.32);
        ctx.lineTo(-r * 0.35 + i * r * 0.18, side * span * 0.85);
        ctx.stroke();
      }
    }
    // 胴
    ctx.fillStyle = look.scale;
    ctx.strokeStyle = "rgba(30,8,6,0.8)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(-r * 0.05, 0, r * 0.86, r * 0.62, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = look.belly;
    ctx.beginPath(); ctx.ellipse(r * 0.1, 0, r * 0.42, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    // 背骨の棘(頭から尾へ並べる)
    ctx.fillStyle = "#5e1a14";
    for (let i = 0; i < 4; i++) {
      const bx = r * 0.35 - i * r * 0.38;
      const h = r * (0.34 - i * 0.05);
      ctx.beginPath();
      ctx.moveTo(bx - 5, -r * 0.5);
      ctx.lineTo(bx, -r * 0.5 - h);
      ctx.lineTo(bx + 5, -r * 0.5);
      ctx.closePath(); ctx.fill();
    }
    // 首と頭
    ctx.fillStyle = look.scale;
    ctx.strokeStyle = "rgba(30,8,6,0.8)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(r * 0.78, 0, r * 0.4, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.95, -r * 0.24);
    ctx.lineTo(r * 1.55, -r * 0.12);
    ctx.lineTo(r * 1.55, r * 0.12);
    ctx.lineTo(r * 0.95, r * 0.24);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 角(後ろへ反らせる)
    ctx.fillStyle = "#e8dcc0";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.72, side * r * 0.22);
      ctx.lineTo(r * 0.34, side * r * 0.66);
      ctx.lineTo(r * 0.82, side * r * 0.3);
      ctx.closePath(); ctx.fill();
    }
    // 目
    ctx.fillStyle = "#2a0a08";
    ctx.beginPath(); ctx.arc(r * 0.98, -r * 0.15, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.98, r * 0.15, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.eye;
    ctx.beginPath(); ctx.arc(r * 1.0, -r * 0.15, 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 1.0, r * 0.15, 2.1, 0, Math.PI * 2); ctx.fill();
    // 口元の炎
    const glow = 0.45 + Math.sin(t * 0.008) * 0.2 + (attacking ? 0.35 : 0);
    const fire = ctx.createRadialGradient(r * 1.62, 0, 2, r * 1.62, 0, 16 + (attacking ? 10 : 0));
    fire.addColorStop(0, `rgba(255,240,180,${clamp(glow + 0.3, 0, 1)})`);
    fire.addColorStop(0.5, `rgba(255,140,40,${clamp(glow, 0, 1)})`);
    fire.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = fire;
    ctx.beginPath(); ctx.arc(r * 1.62, 0, 16 + (attacking ? 10 : 0), 0, Math.PI * 2); ctx.fill();
  }

  // ボス: 魔狼王。大型の四足獣。たてがみと長い尾で狼だと分かるようにする。
  function drawFenrir(s, look, r, attacking) {
    const t = now();
    const stride = s.moving ? Math.sin(t * 0.014) * 8 : 0;
    ctx.lineJoin = "round";
    // 冷気の靄
    const aura = ctx.createRadialGradient(0, 0, 6, 0, 0, r + 22);
    aura.addColorStop(0, "rgba(125,227,255,0.26)");
    aura.addColorStop(1, "rgba(125,227,255,0)");
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(0, 0, r + 22, 0, Math.PI * 2); ctx.fill();
    // 尾
    ctx.strokeStyle = look.wing; ctx.lineWidth = 15; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.quadraticCurveTo(-r - 20, -12 + Math.sin(t * 0.004) * 16, -r - 44, -4 + Math.sin(t * 0.004) * 26);
    ctx.stroke();
    ctx.strokeStyle = look.scale; ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.quadraticCurveTo(-r - 20, -12 + Math.sin(t * 0.004) * 16, -r - 40, -4 + Math.sin(t * 0.004) * 24);
    ctx.stroke();
    // 脚(前後2対)
    ctx.strokeStyle = "rgba(20,24,32,0.75)"; ctx.lineWidth = 2;
    ctx.fillStyle = look.wing;
    ctx.fillRect(r * 0.1 + stride, -r * 0.95, 11, 22);
    ctx.fillRect(-r * 0.55 - stride, -r * 0.95, 11, 22);
    ctx.fillRect(r * 0.1 - stride, r * 0.73, 11, 22);
    ctx.fillRect(-r * 0.55 + stride, r * 0.73, 11, 22);
    // 胴
    ctx.fillStyle = look.scale;
    ctx.strokeStyle = "rgba(20,24,32,0.8)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.9, r * 0.58, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = look.belly;
    ctx.beginPath(); ctx.ellipse(-r * 0.05, r * 0.12, r * 0.55, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    // たてがみ(首まわりを一周)
    ctx.fillStyle = look.wing;
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i / 8) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(r * 0.42 + Math.cos(a) * 2, Math.sin(a) * r * 0.5);
      ctx.lineTo(r * 0.42 + Math.cos(a) * 14, Math.sin(a) * r * 0.85);
      ctx.lineTo(r * 0.42 + Math.cos(a) * 2 + 6, Math.sin(a) * r * 0.5 + 4);
      ctx.closePath(); ctx.fill();
    }
    // 頭
    ctx.fillStyle = look.scale;
    ctx.strokeStyle = "rgba(20,24,32,0.8)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(r * 0.8, 0, r * 0.46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 鼻先
    ctx.beginPath();
    ctx.moveTo(r * 1.05, -r * 0.2);
    ctx.lineTo(r * 1.52, -r * 0.06);
    ctx.lineTo(r * 1.52, r * 0.06);
    ctx.lineTo(r * 1.05, r * 0.2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 立った耳
    ctx.fillStyle = look.wing;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.66, side * r * 0.3);
      ctx.lineTo(r * 0.5, side * r * 0.95);
      ctx.lineTo(r * 0.95, side * r * 0.36);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 目
    ctx.fillStyle = "#12181f";
    ctx.beginPath(); ctx.arc(r * 1.0, -r * 0.16, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 1.0, r * 0.16, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.eye;
    ctx.beginPath(); ctx.arc(r * 1.02, -r * 0.16, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 1.02, r * 0.16, 2.2, 0, Math.PI * 2); ctx.fill();
    // 牙(噛みつく瞬間だけ大きく開く)
    if (attacking) {
      ctx.fillStyle = "#fff";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 1.2, side * r * 0.16);
        ctx.lineTo(r * 1.6, side * r * 0.05);
        ctx.lineTo(r * 1.2, side * 0.02);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawUnit(s) {
    const c = teamColors(s);
    const a = s.aimAngle;
    const r = unitR(s);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.team === TEAM_FOE) {
      ctx.rotate(a);
      // 魔物の脚(ボスは自前の脚を持つ)
      if (!s.boss) {
        const legSwing = s.moving ? Math.sin(s.legPhase) * 5 : 0;
        ctx.fillStyle = "#26221c";
        ctx.fillRect(-4, -r + 2 - legSwing * 0.3, 9, 6);
        ctx.fillRect(-4, r - 8 + legSwing * 0.3, 9, 6);
      }
      drawFoeBody(s);
    } else {
      // 脚 (歩行)
      const legSwing = s.moving ? Math.sin(s.legPhase) * 5 : 0;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = "#2a2a22";
      ctx.fillRect(-4, -10 - legSwing * 0.3, 9, 6);
      ctx.fillRect(-4, 4 + legSwing * 0.3, 9, 6);
      ctx.restore();
      ctx.rotate(a);
      drawHero(s, c);
    }
    // 凍結の靄
    if (now() < (s.chilledUntil || 0)) {
      ctx.fillStyle = "rgba(150,225,255,0.28)";
      ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, 6.283); ctx.fill();
    }
    // 被弾フラッシュ
    if (s.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${s.hitFlash * 0.6})`;
      ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  // 訓練用の木人。柱に藁束を巻いた的。勇者や魔物とひと目で見分けられるようにする。
  function drawDummy(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    // 台座
    ctx.fillStyle = "#6a5636";
    ctx.save();
    ctx.rotate(s.angle);
    ctx.fillRect(-UNIT_R - 4, -5, 12, 10);
    ctx.restore();
    const r = UNIT_R + 2;
    // 藁束の胴
    ctx.fillStyle = "#d8bd72";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "#8b7448"; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = "#a8873f"; ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(-r * 0.8, i * 6); ctx.lineTo(r * 0.8, i * 6); ctx.stroke();
    }
    // 的の輪
    ctx.fillStyle = "#c8483c";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#e4dcc2";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#c8483c";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, 6.283); ctx.fill();
    // 動く木人は回っている向きが分かるように矢印を足す
    if (s.orbit) {
      ctx.save();
      ctx.rotate(s.angle);
      ctx.fillStyle = "rgba(30,26,18,0.75)";
      ctx.beginPath(); ctx.moveTo(r - 3, 0); ctx.lineTo(r - 11, -5); ctx.lineTo(r - 11, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (s.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${s.hitFlash * 0.6})`;
      ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  // 飛び道具。矢は羽根つきの線、魔法は光の球で描く。
  function drawProjectiles() {
    const t = now();
    ctx.lineCap = "round";
    for (const b of G.projectiles) {
      const m = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / m, uy = b.vy / m;
      const a = Math.atan2(b.vy, b.vx);
      const proj = b.proj || (b.kind === "shell" ? "fire" : "arrow");
      if (proj === "arrow" || proj === "bone") {
        const len = b.len || 18;
        ctx.strokeStyle = proj === "bone" ? "#e8e2cf" : "#d8c894";
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - ux * len, b.y - uy * len); ctx.stroke();
        // 鏃
        ctx.fillStyle = proj === "bone" ? "#f4f0e2" : "#cfd6da";
        ctx.beginPath();
        ctx.moveTo(b.x + ux * 4, b.y + uy * 4);
        ctx.lineTo(b.x - uy * 3, b.y + ux * 3);
        ctx.lineTo(b.x + uy * 3, b.y - ux * 3);
        ctx.closePath(); ctx.fill();
        // 羽根
        ctx.strokeStyle = "rgba(230,200,140,0.9)"; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(b.x - ux * len, b.y - uy * len);
        ctx.lineTo(b.x - ux * (len - 5) - uy * 4, b.y - uy * (len - 5) + ux * 4);
        ctx.moveTo(b.x - ux * len, b.y - uy * len);
        ctx.lineTo(b.x - ux * (len - 5) + uy * 4, b.y - uy * (len - 5) - ux * 4);
        ctx.stroke();
      } else if (proj === "axe" || proj === "rock") {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(t * 0.02);
        if (proj === "axe") {
          ctx.fillStyle = "#6b4a2c"; ctx.fillRect(-10, -1.8, 20, 3.6);
          ctx.fillStyle = "#cfd6da";
          ctx.beginPath(); ctx.moveTo(6, -3); ctx.lineTo(14, -9); ctx.lineTo(17, 0); ctx.lineTo(13, 7); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill();
        } else {
          ctx.fillStyle = "#8e8375";
          ctx.beginPath(); ctx.ellipse(0, 0, 8, 7, 0.4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.beginPath(); ctx.ellipse(2, 2, 4, 3.4, 0.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      } else if (proj === "bolt") {
        // 雷撃: ぎざぎざの尾を引く
        const len = b.len || 26;
        ctx.strokeStyle = "rgba(190,240,255,0.95)"; ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        for (let i = 1; i <= 3; i++) {
          const d = (len / 3) * i;
          const off = (i % 2 ? 4 : -4);
          ctx.lineTo(b.x - ux * d - uy * off, b.y - uy * d + ux * off);
        }
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.4, 0, Math.PI * 2); ctx.fill();
      } else {
        // 魔力の球(火・氷・聖・闇)。中心が白く、外側に色が滲む。
        const col = PROJECTILE_COLORS[proj] || "#ffe49a";
        const size = b.kind === "shell" ? 8 : 5.5;
        const glow = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, size * 2.6);
        glow.addColorStop(0, "rgba(255,255,255,0.95)");
        glow.addColorStop(0.4, col);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(b.x, b.y, size * 2.6, 0, Math.PI * 2); ctx.fill();
        // 尾
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = col; ctx.lineWidth = size * 0.9;
        ctx.beginPath();
        ctx.moveTo(b.x - ux * size, b.y - uy * size);
        ctx.lineTo(b.x - ux * (size + 14), b.y - uy * (size + 14));
        ctx.stroke();
        ctx.restore();
        void a;
      }
    }
  }

  // 茨の呪縛。隠せないので敵味方どちらからも見える。
  function drawThorns() {
    const myTeam = localTeam();
    for (const thorn of G.thorns) {
      const def = teamDef(thorn.team);
      const friendly = thorn.team === myTeam;
      ctx.save();
      ctx.translate(thorn.x, thorn.y);
      ctx.fillStyle = friendly ? hexToRgba(def.flag, 0.1) : "rgba(180,80,255,0.12)";
      ctx.beginPath(); ctx.arc(0, 0, THORN_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = friendly ? hexToRgba(def.flag, 0.45) : "rgba(200,120,255,0.5)";
      ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(0, 0, THORN_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 絡まった蔓
      ctx.strokeStyle = "#4e6b34"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4 + (thorn.seed || 0) * 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * THORN_R * 0.85, -Math.sin(a) * THORN_R * 0.85);
        ctx.quadraticCurveTo(Math.sin(a) * 16, -Math.cos(a) * 16, Math.cos(a) * THORN_R * 0.85, Math.sin(a) * THORN_R * 0.85);
        ctx.stroke();
      }
      // 棘
      ctx.fillStyle = "#c9d8a4";
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI * 2 / 12 + (thorn.seed || 0);
        const r = THORN_R * 0.55;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * r + Math.cos(a + 1.2) * 7, Math.sin(a) * r + Math.sin(a + 1.2) * 7);
        ctx.lineTo(Math.cos(a) * r + Math.cos(a - 1.2) * 4, Math.sin(a) * r + Math.sin(a - 1.2) * 4);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  // 味方の呪印は常に見える。敵の呪印は踏む寸前まで見えない。
  function drawGlyphs() {
    const t = now();
    const me = localUnit();
    const myTeam = localTeam();
    for (const m of G.glyphs) {
      const friendly = m.team === myTeam;
      let alpha = 1;
      if (!friendly) {
        if (!me) continue;
        // 狩人は罠の扱いに長けているので、敵の呪印も見抜ける
        const spot = me.seesEnemyGlyphs ? currentVisionRadius() : GLYPH_SPOT_R * (m.stealthMul || 1);
        const d = Math.sqrt(dist2(me.x, me.y, m.x, m.y));
        if (d > spot || !lineClear(me.x, me.y, m.x, m.y)) continue;
        alpha = clamp(1 - (d - spot * 0.55) / (spot * 0.45), 0.25, 1);
      }
      const armed = t >= m.armAt;
      const def = teamDef(m.team);
      const col = friendly ? def.flag : "#ff6b52";
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(m.x, m.y);
      // 光る円と回る二重の輪
      const pulse = armed ? (Math.floor(t / 380) % 2 === 0 ? 0.9 : 0.4) : 0.4;
      ctx.fillStyle = hexToRgba(col, 0.14 * pulse + 0.06);
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexToRgba(col, pulse); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.rotate(t * 0.0012);
      ctx.strokeStyle = hexToRgba(col, pulse * 0.8); ctx.lineWidth = 1.6;
      // 六芒星
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = i * Math.PI / 3 + k * Math.PI * 2 / 3;
          const px = Math.cos(a) * 9, py = Math.sin(a) * 9;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = hexToRgba(col, pulse);
      ctx.beginPath(); ctx.arc(0, 0, 2.8, 0, Math.PI * 2); ctx.fill();
      // 味方には作動範囲を薄く見せる
      if (friendly) {
        ctx.strokeStyle = hexToRgba(def.flag, 0.2); ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(0, 0, GLYPH_TRIGGER_R, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  // 火炎瓶。導火の炎が点滅しながら弧を描いて飛ぶ。
  function drawBombs() {
    const t = now();
    for (const g of G.bombs) {
      const progress = clamp((t - g.bornAt) / BOMB_FUSE_MS, 0, 1);
      const lift = Math.sin(progress * Math.PI) * 18;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(g.x + 2, g.y + 3, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(g.x, g.y - lift); ctx.rotate(g.rotation);
      ctx.fillStyle = "#6b4a2c";
      ctx.beginPath();
      ctx.moveTo(-3, -8); ctx.lineTo(3, -8); ctx.lineTo(6, 2);
      ctx.quadraticCurveTo(6, 9, 0, 9); ctx.quadraticCurveTo(-6, 9, -6, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,150,60,0.75)";
      ctx.beginPath(); ctx.ellipse(0, 3, 4, 4.4, 0, 0, Math.PI * 2); ctx.fill();
      // 導火の炎
      const lit = Math.floor((g.fuseAt - t) / 140) % 2 === 0;
      ctx.fillStyle = lit ? "#ffd23f" : "#ff7a3d";
      ctx.beginPath(); ctx.arc(0, -11, lit ? 3.6 : 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawParticlesUnder() {
    for (const p of G.particles) {
      // 門から魔物が湧くときに散る魔力の粒
      if (p.kind === "rune") {
        const lr = clamp(p.life / p.maxLife, 0, 1);
        ctx.fillStyle = `rgba(190,120,255,${lr * 0.8})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
  }

  function drawParticlesOver() {
    for (const p of G.particles) {
      const lr = clamp(p.life / p.maxLife, 0, 1);
      if (p.kind === "blood") {
        ctx.fillStyle = `rgba(150,15,15,${lr})`;
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
      } else if (p.kind === "cast") {
        // 詠唱の光。二重の輪が広がって消える。
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.strokeStyle = `rgba(190,225,255,${lr * 0.9})`; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1.6 - lr), 0, 6.283); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${lr * 0.5})`;
        ctx.beginPath(); ctx.arc(0, 0, p.size * 0.4 * lr, 0, 6.283); ctx.fill();
        ctx.restore();
      } else if (p.kind === "holyarc") {
        // 癒しの光が広がる扇
        const half = p.arc || 0.9;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(255,246,190,${lr * 0.85})`; ctx.lineWidth = 6 * lr + 1;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1.35 - lr * 0.35), -half, half); ctx.stroke();
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
    const me = localUnit();
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
    const me = localUnit();
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
    const me = localUnit();
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
    const myTeam = localTeam();
    for (const s of G.units) {
      if (s.dead || s.vehicleId >= 0 || !isEntityVisible(s)) continue;
      const def = teamDef(s.team);
      // ボスは体が大きいので、名前も少し上に大きく出す
      const tx = s.x, ty = s.y - unitR(s) - (s.boss ? 24 : 16);
      const bw = s.boss ? 110 : 38, bh = s.boss ? 7 : 4;
      const ratio = clamp(s.hp / s.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, bh + 2);
      ctx.fillStyle = s.dummy ? "#d9c98f" : s.boss ? "#ff7a4a" : s.team === myTeam ? "#46d36a" : def.flag;
      ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, bh);
      // 名前 + Lv (味方には◆を付けて見分けやすく)
      ctx.font = `bold ${s.boss ? 15 : 12}px -apple-system, sans-serif`;
      let label;
      if (s.dummy) label = s.name;
      else if (s.boss) label = `👑 ${s.name}`;
      else if (s.team === TEAM_FOE) label = s.name;
      else {
        const mark = s.id === G.localId ? "▼ " : "◆ ";
        label = mark + classDef(s.classKey).icon + " " + s.name + " Lv" + s.level;
      }
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = s.dummy ? "#e6dcbb" : s.boss ? "#ffb08a" : s.id === G.localId ? YOU_ACCENT : def.text;
      ctx.fillText(label, tx, ty);
    }
    for (const beast of G.beasts) {
      if (beast.dead || !isEntityVisible(beast)) continue;
      const def = teamDef(beast.team);
      const tx = beast.x, ty = beast.y - BEAST_R - 14;
      const bw = 31, ratio = clamp(beast.hp / beast.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.58)"; ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, 6);
      ctx.fillStyle = def.beastBar; ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, 4);
      ctx.font = "bold 10px -apple-system, sans-serif";
      const label = beast.wild ? "🐺 魔狼" : `🐺 ${beast.name}`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = def.text; ctx.fillText(label, tx, ty);
    }
    for (const golem of G.golems) {
      if (golem.dead || !isEntityVisible(golem)) continue;
      const def = teamDef(golem.team);
      const driver = G.units.find((s) => s.id === golem.driverId);
      const tx = golem.x, ty = golem.y - GOLEM_R - 18;
      const bw = 58, ratio = clamp(golem.hp / golem.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, 7);
      ctx.fillStyle = def.golemBar; ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, 5);
      ctx.font = "bold 12px -apple-system, sans-serif";
      const label = driver ? `▣ ${driver.name}のゴーレム` : `▣ ${golem.name}`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.82)"; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = def.text; ctx.fillText(label, tx, ty);
    }
  }

  function drawMinimap() {
    const mw = mini.width, mh = mini.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "rgba(18,20,26,0.85)";
    mctx.fillRect(0, 0, mw, mh);
    const sx = mw / WORLD_W, sy = mh / WORLD_H;
    for (const base of G.bases) {
      if (base.hidden) continue;
      const def = teamDef(base.team);
      mctx.strokeStyle = hexToRgba(def.flag, base.hp > 0 ? 0.85 : 0.3);
      mctx.lineWidth = 1.5; mctx.strokeRect(base.x * sx - 5, base.y * sy - 5, 10, 10);
      if (base.hp <= 0) {
        // 壊れた拠点には×印
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
      mctx.fillStyle = kit.kind === "potion" ? "#62df7a" : kit.kind === "armor" ? "#65aaf0" : "#74e9e2";
      mctx.fillRect(kit.x * sx - 1, kit.y * sy - 1, 2, 2);
    }
    // 勇者と魔物
    for (const s of G.units) {
      if (s.dead || s.vehicleId >= 0) continue;
      // ボスだけは見えていなくても位置が分かる(逃げ場を判断できるように)
      if (s.boss) {
        mctx.fillStyle = "#ff7a4a";
        mctx.beginPath(); mctx.arc(s.x * sx, s.y * sy, 4.2, 0, 6.283); mctx.fill();
        continue;
      }
      if (!isEntityVisible(s)) continue;
      mctx.fillStyle = s.id === G.localId ? YOU_ACCENT : s.dummy ? "#d9c98f" : teamDef(s.team).flag;
      const r = s.id === G.localId ? 3 : 2;
      mctx.beginPath(); mctx.arc(s.x * sx, s.y * sy, r, 0, 6.283); mctx.fill();
    }
    for (const beast of G.beasts) {
      if (beast.dead || !isEntityVisible(beast)) continue;
      mctx.fillStyle = teamDef(beast.team).beastBar;
      mctx.beginPath(); mctx.arc(beast.x * sx, beast.y * sy, 1.7, 0, Math.PI * 2); mctx.fill();
    }
    for (const golem of G.golems) {
      if (golem.dead || !isEntityVisible(golem)) continue;
      mctx.fillStyle = golem.driverId === G.localId ? YOU_ACCENT : teamDef(golem.team).golemBar;
      mctx.fillRect(golem.x * sx - 3, golem.y * sy - 3, 6, 6);
    }
    const cr = G.creature;
    if (cr && (spectating || cr.hunting)) {
      mctx.fillStyle = "rgba(255,60,45,0.9)";
      mctx.beginPath(); mctx.arc(cr.x * sx, cr.y * sy, 3, 0, Math.PI * 2); mctx.fill();
    }
    // 魔導砲台は常に位置が分かる(マップ上の固定設備なので)
    for (const ballista of G.ballistas) {
      if (ballista.dead) continue;
      mctx.strokeStyle = ballista.gunnerId === G.localId ? YOU_ACCENT
        : ballista.team >= 0 ? teamDef(ballista.team).flag : "rgba(220,220,200,0.55)";
      mctx.lineWidth = 1.5;
      mctx.beginPath(); mctx.arc(ballista.x * sx, ballista.y * sy, 2.6, 0, Math.PI * 2); mctx.stroke();
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
  // 勇者パーティ / 魔物の軍勢の2枚。DOMは1度だけ組み立て、以降は数値だけ書き換える。
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
        `<span class="tc-kills"><b></b><i>${team === TEAM_HERO ? "討伐" : "残り"}</i></span>` +
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
    for (const team of TEAMS) {
      const c = teamCards[team];
      const base = G.bases[team];
      // 訓練の間に魔界の門はないのでカードごと隠す
      const absent = !!(base && base.hidden);
      c.card.classList.toggle("hidden", absent);
      if (absent) continue;
      const fallen = !base || base.hp <= 0;
      const def = teamDef(team);
      c.name.textContent = team === TEAM_HERO ? G.partyNames[TEAM_HERO] : def.name;
      // 勇者側は倒した魔物の数、魔物側は場にいる数を出す
      c.kills.textContent = team === TEAM_HERO ? G.foesSlain : aliveFoes();
      c.fill.style.transform = `scaleX(${base ? clamp(base.hp / base.maxHp, 0, 1) : 0})`;
      c.hp.textContent = fallen ? "破壊" : Math.ceil(base.hp);
      c.card.classList.toggle("own", team === TEAM_HERO);
      c.card.classList.toggle("fallen", fallen);
    }
  }

  let lastFeedKey = "";
  function updateHUD() {
    const me = localUnit();
    updateTeamBoard();
    const phase = dayPhase();
    el.daytime.textContent = phase.label;
    el.daytime.className = "daytime " + phase.key;
    document.body.classList.toggle("spectating", spectating);
    if (spectating) {
      const watched = G.units.find((s) => s.id === spectateTargetId);
      el.vehicleHint.textContent = watched
        ? `👁 観戦中：${watched.name}（${G.partyNames[watched.team]}）`
        : "👁 観戦中";
      el.vehicleHint.classList.remove("hidden");
    }
    // 観戦中は自分の装備欄を更新しない(キルフィードは下で更新する)
    if (me && !spectating) {
      const golem = me.vehicleId >= 0 ? G.golems.find((x) => x.id === me.vehicleId && !x.dead) : null;
      const active = golem || me;
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
      if (me.dead) el.shieldState.textContent = "祭壇で装備を整え直し中";
      else if (golem) el.shieldState.textContent = "装備はゴーレムの中";
      else if (me.shield <= 0) el.shieldState.textContent = "盾が砕けた・祭壇で修復";
      else if (me.parryUntil > 0 && now() <= me.parryUntil) el.shieldState.textContent = "PARRY受付中！";
      else if (me.shieldRaised) el.shieldState.textContent = "盾展開中・正面防御";
      else if (now() < me.parryCooldownUntil) el.shieldState.textContent = `パリィ再使用 ${((me.parryCooldownUntil - now()) / 1000).toFixed(1)}秒`;
      else el.shieldState.textContent = isTouch ? "「盾」を攻撃直前に押してパリィ" : "Qを攻撃直前に押してパリィ";
      el.shieldState.classList.toggle("raised", !!me.shieldRaised || (me.parryUntil > 0 && now() <= me.parryUntil));
      const sinceHit = now() - (me.lastDamagedAt == null ? -99999 : me.lastDamagedAt);
      if (me.dead) {
        el.recovery.textContent = canRespawn ? "" : "祭壇を失ったため復活できません（観戦中）";
        el.recovery.classList.toggle("waiting", !canRespawn);
      } else if (!canRespawn) {
        el.recovery.textContent = "祭壇が砕けた・次に倒れたら終わり";
        el.recovery.classList.add("waiting");
      } else if (golem) {
        el.recovery.textContent = "ゴーレムの石装甲";
        el.recovery.classList.remove("waiting");
      } else if (inFriendlyBase(me) && me.hp < me.maxHp - 0.05) {
        el.recovery.textContent = `祭壇で回復中 +${BASE_HEAL_PER_SEC}/秒`;
        el.recovery.classList.remove("waiting");
      } else if (me.hp >= me.maxHp - 0.05) {
        el.recovery.textContent = inFriendlyBase(me) ? "祭壇：マナ・矢・道具を補給" : "体力最大";
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
      const ballista = me.ballistaId >= 0 ? G.ballistas.find((x) => x.id === me.ballistaId && !x.dead) : null;
      if (golem) {
        const tw = GOLEM_WEAPONS[golem.weapon || 0];
        const ready = now() - golem.lastShot >= tw.interval;
        el.wName.textContent = `ゴーレム・${tw.name}`;
        el.ammo.textContent = ready ? "READY" : "チャージ中";
        el.ammo.classList.toggle("low", !ready);
        el.bomb.textContent = isTouch ? "「武器」で岩塊砲 / 魔力連弾を切替" : "数字キー・ホイールで岩塊砲 / 魔力連弾";
      } else if (ballista) {
        el.wName.textContent = "魔導砲台・光の矢";
        el.ammo.textContent = "∞";
        el.ammo.classList.remove("low");
        el.bomb.textContent = `砲台 耐久 ${Math.ceil(ballista.hp)} / ${ballista.maxHp}`;
      } else {
        const w = WEAPONS[me.weapon];
        const slot = me.loadout ? me.loadout.indexOf(me.weapon) : -1;
        el.wName.textContent = slot >= 0 ? `${slot + 1}. ${w.name}` : w.name;
        // 魔法はマナ、弓は矢、近接は無限。
        if (w.melee && w.heal <= 0) el.ammo.textContent = "近接 / ∞";
        else el.ammo.textContent = (me.reloading ? reloadLabel(w) : me.ammo) + " / " + w.mag;
        el.ammo.classList.toggle("low", !(w.melee && w.heal <= 0) && !me.reloading && me.ammo <= Math.ceil(w.mag * 0.25));
        const hasThorns = (me.maxThorns || 0) > 0;
        const thornText = hasThorns ? `　🌿 ${me.thorns == null ? 0 : me.thorns}` : "";
        const label = ammoLabel(w);
        const ammoNote = label ? `${label}　` : "";
        el.bomb.textContent = `${ammoNote}🔥 ${me.bombs == null ? 0 : me.bombs}　🔮 ${me.glyphs == null ? 0 : me.glyphs}${thornText}`;
        // 茨ボタンは茨を持つ職業のときだけ出す
        thornBtn.classList.toggle("hidden", !hasThorns);
      }

      let hint = "";
      if (!me.dead && golem) hint = isTouch ? "「ゴーレム」で降りる" : "E：ゴーレムから降りる";
      else if (!me.dead && me.ballistaId >= 0) hint = isTouch ? "「ゴーレム」で砲台から離れる" : "E：魔導砲台から離れる";
      else if (!me.dead) {
        const nearby = G.golems.some((x) => !x.dead && x.team === me.team && x.driverId < 0 && dist2(me.x, me.y, x.x, x.y) < 78 ** 2);
        const nearBallista = G.ballistas.some((x) => !x.dead && x.gunnerId < 0 && dist2(me.x, me.y, x.x, x.y) < BALLISTA_MOUNT_R ** 2);
        if (nearby) hint = isTouch ? "「ゴーレム」に乗り込む" : "E：ゴーレムに乗り込む";
        else if (nearBallista) hint = isTouch ? "「ゴーレム」で砲台に取り付く" : "E：魔導砲台に取り付く";
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
  //  チュートリアル (訓練の間)
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
      key: "attack", label: "マップ中央の木人まで行って攻撃する",
      hint: "木人は右上のミニマップの真ん中に集まっています。マウスの左ボタンを押している間、攻撃し続けます。",
      hintTouch: "木人は右上のミニマップの真ん中に集まっています。右下のスティックを倒している間、自動で攻撃します。",
      reset: (c) => { c.attacked = false; },
      done: (c) => c.attacked,
    },
    {
      key: "hit", label: "木人に当てる",
      hint: "遠いと当たりません。近づいてから攻撃すると当てやすいです。",
      reset: (c) => { c.hitTarget = false; },
      done: (c) => c.hitTarget,
    },
    {
      key: "kill", label: "木人を1つ壊す",
      hint: "壊れた木人は数秒で立て直ります。何度でも練習できます。",
      reset: (c, me) => { c.killsAtStart = me.kills; },
      done: (c, me) => me.kills > c.killsAtStart,
    },
    {
      key: "reload", label: "詠唱しなおす / 矢をつがえる",
      hint: "R キーで詠唱しなおし、または矢をつがえ直します。使い切ったときも自動で始まります。",
      hintTouch: "右下の「整える」ボタンを押します。",
      applies: (me) => me.loadout.some((i) => WEAPONS[i].mag > 1),
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
      key: "bomb", label: "火炎瓶を投げる",
      hint: "G キーで、向いている方向へ投げます。自分も巻きこまれるので離れて投げましょう。",
      hintTouch: "「🔥 火炎」ボタンで投げます。自分も巻きこまれるので離れて投げましょう。",
      applies: (me) => (me.maxBombs || 0) > 0,
      reset: (c) => { c.threwBomb = false; },
      done: (c) => c.threwBomb,
    },
    {
      key: "glyph", label: "呪印の罠を描く",
      hint: "F キーで足元に描きます。約1秒後に起動するので、描いたらすぐ離れましょう。",
      hintTouch: "「🔮 呪印」ボタンで足元に描きます。描いたらすぐ離れましょう。",
      applies: (me) => (me.maxGlyphs || 0) > 0,
      reset: (c) => { c.placedGlyph = false; },
      done: (c) => c.placedGlyph,
    },
    {
      key: "thorn", label: "茨の呪縛を張る",
      hint: "C キーで張ります。踏んだ敵の足が止まり、じわじわ体力が減ります。",
      hintTouch: "「🌿 茨」ボタンで張ります。踏んだ敵の足が止まります。",
      applies: (me) => (me.maxThorns || 0) > 0,
      reset: (c) => { c.placedThorn = false; },
      done: (c) => c.placedThorn,
    },
    {
      key: "shield", label: "盾を構える",
      hint: "Q を押すとパリィ、押しっぱなしで防御します。",
      hintTouch: "「🛡 盾」を押すとパリィ、押しっぱなしで防御します。",
      reset: (c) => { c.usedShield = false; },
      done: (c) => c.usedShield,
    },
    {
      key: "ballista", label: "魔導砲台に取り付く",
      hint: "訓練場のまわりに3つあります。近づいて E キーです。",
      hintTouch: "訓練場のまわりに3つあります。近づいて「ゴーレム」ボタンです。",
      done: (c, me) => me.ballistaId >= 0,
    },
    {
      key: "golem", label: "守護ゴーレムに乗る",
      hint: "勇者の祭壇のそばにあります。近づいて E キーです。",
      hintTouch: "勇者の祭壇のそばにあります。近づいて「ゴーレム」ボタンです。",
      done: (c, me) => me.vehicleId >= 0,
    },
    {
      key: "base", label: "勇者の祭壇に戻る",
      hint: "拠点の円の中に入ると、体力・マナ・矢・火炎瓶が回復します。",
      done: (c, me) => inFriendlyBase(me),
    },
  ];

  let training = null;

  function resetTraining() {
    training = isTraining() ? {
      idx: 0, armed: false, done: false, skip: false,
      movedFor: 0, turned: 0, dashedFor: 0, killsAtStart: 0,
      attacked: false, hitTarget: false, reloaded: false, swapped: false,
      threwBomb: false, placedGlyph: false, placedThorn: false, usedShield: false,
      lastAim: null, lastShot: null, lastWeapon: null,
      lastBombs: null, lastGlyphs: null, lastThorns: null, dummyHp: null,
    } : null;
    renderTrainingPanel();
  }

  // 職業によって出番のない項目(剣士の詠唱等)は最初から数えない
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
    if (c.lastBombs != null && me.bombs < c.lastBombs) c.threwBomb = true;
    c.lastBombs = me.bombs;
    if (c.lastGlyphs != null && me.glyphs < c.lastGlyphs) c.placedGlyph = true;
    c.lastGlyphs = me.glyphs;
    if (c.lastThorns != null && me.thorns < c.lastThorns) c.placedThorn = true;
    c.lastThorns = me.thorns;
    if (me.shieldRaised || (me.parryUntil > 0 && t <= me.parryUntil)) c.usedShield = true;
    // 的の合計体力が減っていたら、どれかに当たったということ
    let hp = 0;
    for (const s of G.units) if (s.dummy && !s.dead) hp += s.hp;
    if (c.dummyHp != null && hp < c.dummyHp - 0.5) c.hitTarget = true;
    c.dummyHp = hp;
  }

  function updateTraining(dt, t) {
    if (!training || training.done) return;
    const me = localUnit();
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
    Audio.levelup();
    banner("練習メニュー修了！　このまま好きなだけ練習できます");
    renderTrainingPanel();
  }

  function renderTrainingPanel() {
    if (!training || !isTraining()) { el.trainingPanel.classList.add("hidden"); return; }
    el.trainingPanel.classList.remove("hidden");
    const me = localUnit();
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
          localInput.reloadEdge = false; localInput.bombEdge = false; localInput.interactEdge = false; localInput.parryEdge = false; localInput.glyphEdge = false; localInput.thornEdge = false;
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
    for (const s of G.units) {
      s.x = lerp(s.x, s.rx, clamp(dt * 14, 0, 1));
      s.y = lerp(s.y, s.ry, clamp(dt * 14, 0, 1));
      if (s.moving) s.legPhase += dt * 12;
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 4);
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 26);
    }
    for (const golem of G.golems) {
      golem.x = lerp(golem.x, golem.rx, clamp(dt * 11, 0, 1));
      golem.y = lerp(golem.y, golem.ry, clamp(dt * 11, 0, 1));
    }
    for (const beast of G.beasts) {
      beast.x = lerp(beast.x, beast.rx, clamp(dt * 14, 0, 1));
      beast.y = lerp(beast.y, beast.ry, clamp(dt * 14, 0, 1));
    }
    // 飛び道具はローカルで前進(見た目)
    for (let i = G.projectiles.length - 1; i >= 0; i--) {
      const b = G.projectiles[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.traveled += Math.hypot(b.vx, b.vy) * dt;
      if (b.traveled > b.range) G.projectiles.splice(i, 1);
    }
    for (const g of G.bombs) {
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
    G.goal = GATE_MAX_HP;
    spawnTeams();
    spawnBeasts();
    spawnGolems();
    spawnBallistas();
    spawnCreature();
    spawnPickups();
    el.scoreGoal.textContent = objectiveText();
    resize();
    hideOverlays();
    resetTraining();
    G.running = true;
    G.over = false;
    Audio.startBgm(stageDef().bgm);
  }

  // HUD 上部の目標表示。進行に合わせて言い換える。
  function objectiveText() {
    if (isTraining()) return "練習メニューを順番にこなそう";
    const boss = bossDef();
    return boss ? `魔界の門を破壊 → ${boss.name} を討伐` : "魔界の門を破壊し、魔物を一掃";
  }

  function endMatch(winnerTeam) {
    if (G.over) return;
    G.over = true;
    G.running = false;
    showMatchResult(winnerTeam);
    if (mode === "host") Net.broadcastEnd(winnerTeam);
  }

  function showMatchResult(winnerTeam) {
    const me = localUnit();
    const win = !!me && winnerTeam === me.team;
    let reward = 0;
    if (!G.rewardClaimed) {
      G.rewardClaimed = true;
      if (win) {
        reward = WIN_REWARD;
        money += reward;
        saveProgress();
      }
    }
    const boss = bossDef();
    el.resultTitle.textContent = win ? "魔境を制覇！ 🏆" : "全滅…";
    el.resultTitle.style.color = win ? "#8cf06a" : "#ff7a6a";
    el.rewardSummary.textContent = win ? `勝利報酬 +${reward || WIN_REWARD} G` : `勝利すると ${WIN_REWARD} G 獲得できます`;
    el.rewardSummary.classList.toggle("win", win);

    const gate = G.bases[TEAM_FOE];
    const bossKilled = G.bossSummoned && !G.units.some((s) => s.boss && !s.dead);
    const table = [
      ["魔界の門", gate && gate.hp > 0 ? `健在 ${Math.ceil(gate.hp)}` : "破壊", gate && gate.hp <= 0],
      [boss ? boss.name : "ボス", !G.bossSummoned ? "未出現" : bossKilled ? "討伐" : "健在", bossKilled],
      ["勇者の祭壇", teamAlive(TEAM_HERO) ? `健在 ${Math.ceil(G.bases[TEAM_HERO].hp)}` : "破壊", teamAlive(TEAM_HERO)],
      ["倒した魔物", `${G.foesSlain} 体`, G.foesSlain > 0],
    ].map(([name, value, good]) =>
      `<div class="row"><span>${esc(name)}</span><b style="color:${good ? "#8cf06a" : "#ff9a8d"}">${esc(value)}</b></div>`
    ).join("");

    const personal = [
      ["あなたの討伐数", me ? me.kills : 0],
      ["あなたの戦闘不能", me ? me.deaths : 0],
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

  // パーティが全滅したら一度だけ「観戦する / やめる」を聞く。
  // 試合は止めない(オンラインでは他のプレイヤーが戦い続けているため)。
  function checkElimination() {
    if (!G || G.over || isTraining() || eliminationPrompted || spectating) return;
    const me = localUnit();
    if (!me || !me.dead) return;
    const team = me.team;
    if (teamAlive(team)) return;
    if (G.units.some((s) => s.team === team && !s.dead)) return;
    eliminationPrompted = true;
    el.eliminatedDetail.textContent =
      "祭壇を失い、仲間も倒れました。もう復活はできません。魔物の軍勢が魔境を覆います。";
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
    localInput.mvx = 0; localInput.mvy = 0; localInput.shoot = false; localInput.dash = false;
    localInput.reloadEdge = false; localInput.bombEdge = false; localInput.interactEdge = false; localInput.parryEdge = false; localInput.glyphEdge = false; localInput.thornEdge = false;
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

    for (const s of G.units) {
      shift(s, ["respawnAt", "lastDamagedAt", "parryUntil", "parryCooldownUntil", "stunnedUntil", "reloadUntil", "lastShot", "lastBomb", "lastGlyph", "lastBaseSupplyAt", "lastFootstepAt", "heardUntil", "muzzle", "chilledUntil", "lastThorn"]);
      shift(s.ai, ["think", "strafeUntil", "lastSeen", "lostAt", "fireUntil", "stuckCheckAt", "detourUntil", "ballistaTry"]);
    }
    for (const beast of G.beasts) shift(beast, ["respawnAt", "lastAttack", "biteAt", "stunnedUntil"]);
    if (G.creature) shift(G.creature, ["lastHeardAt", "roamUntil", "lastRoarAt", "lungeAt"]);
    for (const ballista of G.ballistas) shift(ballista, ["respawnAt", "lastShot", "muzzle"]);
    for (const golem of G.golems) {
      shift(golem, ["respawnAt", "lastShot", "muzzle"]);
      shift(golem.ai, ["think"]);
    }
    for (const bomb of G.bombs) shift(bomb, ["fuseAt", "bornAt"]);
    for (const m of G.glyphs) shift(m, ["armAt", "placedAt"]);
    for (const pickup of G.pickups) shift(pickup, ["respawnAt"]);
    for (const base of G.bases) shift(base, ["lastWarningAt"]);
    for (const item of G.killfeed) shift(item, ["t"]);
    shift(G, ["nextFoeAt"]);
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
      peer = new window.Peer("mr-" + roomCode, { debug: 0 });
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
      G.goal = GATE_MAX_HP;
      spawnTeams();
      spawnBeasts();
      spawnGolems();
      spawnBallistas();
      spawnCreature();
      spawnPickups();
      el.scoreGoal.textContent = objectiveText();
      resize();
      G.running = false; G.over = false;
      lobbyOpen = true;
      showLobby(roomCode, `${G.partyNames[TEAM_HERO]} を結成しました。コードを共有して仲間を集めよう。`);
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
      // パーティの席は PARTY_SIZE 個。人間が座っていない席は CPU の仲間が務める。
      return G.units
        .filter((s) => s.team === TEAM_HERO && !s.dummy)
        .map((s) => ({ n: s.name, c: s.classKey, cpu: s.controller === "cpu" ? 1 : 0 }));
    }

    function renderRoster(roster, partyNames) {
      const def = teamDef(TEAM_HERO);
      const title = (partyNames && partyNames[TEAM_HERO]) || def.name;
      const rows = (roster || []).map((p) => {
        const cls = classDef(p.c);
        return `<div class="roster-row${p.cpu ? " empty" : ""}">` +
          `<i class="dot" style="background:${p.cpu ? "#6f7a66" : def.flag}"></i>` +
          `<b>${cls.icon} ${esc(cls.name)}</b><span>${esc(p.n)}${p.cpu ? "（CPUの仲間）" : ""}</span></div>`;
      });
      el.lobbyRoster.innerHTML =
        `<div class="roster-title">${esc(title)}</div>` + rows.join("");
    }

    function broadcastLobby() {
      const roster = buildRoster();
      renderRoster(roster, G.partyNames);
      const ready = conns.length > 0;
      el.lobbyStart.classList.toggle("hidden", mode !== "host");
      el.lobbyStart.disabled = !ready || !!countdownTimer;
      el.lobbyStart.textContent = ready ? "全員そろった → 開始" : "参加者を待っています…";
      for (const c of conns) {
        try { c.send({ t: "lobby", roster, names: G.partyNames }); } catch (e) {}
      }
    }

    function sendInit(conn) {
      const slot = G.units.find((s) => s.controller === conn.peer);
      const obstacles = G.obstacles.map((o) => ({
        ...o,
        hp: Number.isFinite(o.hp) ? o.hp : null,
      }));
      conn.send({
        t: "init", obstacles, goal: G.goal, slotId: slot ? slot.id : -1, stage: G.stage,
        partyNames: G.partyNames, you: { team: slot ? slot.team : 1 }, paused: matchPaused,
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
        showLobby(roomCode, `${G.partyNames[TEAM_HERO]} を結成しました。コードを共有して仲間を集めよう。`);
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
      resetTraining();
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
        // 枠の割り当ては hello を受け取ってから行う。参加者は必ず勇者パーティに入る。
      });
      conn.on("data", (d) => {
        if (d.t === "hello") {
          if (G.units.some((x) => x.controller === conn.peer)) return; // 二重hello
          const slot = pickSlotForClient();
          if (!slot) {
            conns = conns.filter((c) => c !== conn);
            try { conn.send({ t: "reject", reason: "このパーティは満員です" }); } catch (e) {}
            setTimeout(() => conn.close(), 250);
            return;
          }
          slot.controller = conn.peer;
          slot.isHuman = true;
          slot.name = d.name ? String(d.name).slice(0, 12) : "Player";
          // 参加者が選んだキャラクターを反映してから強化を乗せる
          applyClass(slot, d.cls || "swordsman");
          slot.shopApplied = false;
          applyShopUpgrades(slot, d.upgrades || {});
          clientInputs[conn.peer] = {
            mvx: 0, mvy: 0, aimAngle: 0, shoot: false, dash: false,
            weaponWanted: -1, reloadEdge: false, bombEdge: false, interactEdge: false, parryEdge: false, glyphEdge: false, thornEdge: false, shield: false,
          };
          // パーティ名がまだ既定のままなら、最初に入った人のパーティ名を採用する。
          if (d.party && G.partyNames[TEAM_HERO] === TEAM_DEFS[TEAM_HERO].name) {
            G.partyNames[TEAM_HERO] = String(d.party).slice(0, 16);
          }
          try { conn.send({ t: "slot", team: slot.team, name: G.partyNames[slot.team] }); } catch (e) {}
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
      const s = G && G.units.find((x) => x.controller === conn.peer);
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

    // 参加者は勇者パーティの CPU 枠を1つ置き換える。魔物側には入れない。
    function pickSlotForClient() {
      return G.units.find((s) => s.team === TEAM_HERO && s.controller === "cpu" && !s.dummy) || null;
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
        hostConn = peer.connect("mr-" + roomCode, { reliable: false });
        hostConn.on("open", () => {
          showLobby(roomCode, "接続しました。ホストの開始を待っています…");
          hostConn.send({ t: "hello", name: playerName, party: partyName, cls: playerClass, upgrades: shopLevels });
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
        G.partyNames = d.partyNames || G.partyNames;
        localInput.aimAngle = BASE_SPOTS[TEAM_HERO].heading;
        el.scoreGoal.textContent = objectiveText();
        resize();
        hideOverlays();
        resetTraining();
        G.running = true; G.over = false;
        Audio.startBgm(stageDef().bgm);
        if (d.paused) applyNetworkPause(true);
      } else if (d.t === "slot") {
        // ホストが受け入れたパーティ名。ここで確定する。
        showLobby(roomCode, `${d.name || TEAM_DEFS[TEAM_HERO].name} に加わりました。ホストの開始を待っています…`);
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
      if (d.an) G.partyNames = d.an;
      if (d.ck != null) G.clock = d.ck;
      if (d.fs != null) G.foesSlain = d.fs;
      G.bossSummoned = !!d.bsm;
      G.boss = d.bid != null && d.bid >= 0 ? d.bid : null;
      for (const nb of (d.bs || [])) {
        const base = G.bases[nb.tm];
        if (!base) continue;
        base.hp = nb.hp; base.maxHp = nb.mh || GATE_MAX_HP; base.hitFlash = nb.hf || 0;
      }
      // 勇者
      const seen = new Set();
      for (const ns of d.s) {
        seen.add(ns.id);
        let s = G.units.find((x) => x.id === ns.id);
        if (!s) {
          s = { id: ns.id, legPhase: 0, muzzle: 0, hitFlash: 0, recoil: 0, lastFootstepAt: -99999, heardUntil: 0 };
          G.units.push(s);
        }
        s.team = ns.tm; s.name = ns.n; s.level = ns.lv;
        s.hp = ns.hp; s.maxHp = ns.mh; s.dead = ns.d ? true : false;
        s.weapon = ns.w; s.aimAngle = ns.a;
        s.xp = ns.xp; s.ammo = ns.am; s.reloading = ns.rl ? true : false;
        s.bombs = ns.gr; s.maxBombs = ns.mg || 3; s.vehicleId = ns.v == null ? -1 : ns.v; s.ballistaId = ns.tr == null ? -1 : ns.tr;
        s.glyphs = ns.mn == null ? 0 : ns.mn; s.maxGlyphs = ns.mm || 2;
        s.thorns = ns.wi || 0; s.maxThorns = ns.mw || 0;
        s.classKey = ns.cl || null;
        s.foeKey = ns.fk || null;
        s.bossKey = ns.bk || null;
        s.boss = !!ns.bk;
        s.r = ns.rr || 0;
        s.undead = !!ns.ud;
        s.chilledUntil = now() + (ns.ch || 0);
        s.seesEnemyGlyphs = s.classKey ? classDef(s.classKey).seesEnemyGlyphs : false;
        s.armor = ns.ar; s.maxArmor = ns.ma; s.shield = ns.sh; s.maxShield = ns.ms; s.shieldRaised = !!ns.sr;
        s.parryUntil = now() + (ns.pr || 0); s.parryCooldownUntil = now() + (ns.pc || 0); s.stunnedUntil = now() + (ns.st || 0);
        s.lastDamagedAt = now() - (AUTO_HEAL_DELAY_MS - (ns.rh || 0));
        s.kills = ns.ki || 0; s.deaths = ns.de || 0;
        s.moving = ns.mv ? true : false; s.noiseRadius = ns.nr || 0;
        if (ns.fl) s.muzzle = now();
        s.rx = ns.x; s.ry = ns.y;
        if (s.x == null) { s.x = ns.x; s.y = ns.y; }
      }
      G.units = G.units.filter((s) => seen.has(s.id));
      // 使い魔の狼
      const beastSeen = new Set();
      for (const nd of (d.dg || [])) {
        beastSeen.add(nd.id);
        let beast = G.beasts.find((x) => x.id === nd.id);
        if (!beast) {
          beast = { kind: "beast", id: nd.id, x: nd.x, y: nd.y, rx: nd.x, ry: nd.y, biteAt: 0, hitFlash: 0 };
          G.beasts.push(beast);
        }
        beast.team = nd.tm; beast.name = nd.n; beast.hp = nd.hp; beast.maxHp = nd.mh;
        beast.dead = !!nd.d; beast.angle = nd.a; beast.moving = !!nd.mv; beast.rx = nd.x; beast.ry = nd.y;
        beast.wild = !!nd.wl;
        if (nd.bt) beast.biteAt = now();
      }
      G.beasts = G.beasts.filter((beast) => beastSeen.has(beast.id));
      // ゴーレム
      const golemSeen = new Set();
      for (const nt of (d.tn || [])) {
        golemSeen.add(nt.id);
        let golem = G.golems.find((x) => x.id === nt.id);
        if (!golem) {
          golem = { kind: "golem", id: nt.id, x: nt.x, y: nt.y, rx: nt.x, ry: nt.y, kills: 0 };
          G.golems.push(golem);
        }
        golem.team = nt.tm; golem.name = nt.n; golem.hp = nt.hp; golem.maxHp = nt.mh;
        golem.dead = !!nt.d; golem.angle = nt.a; golem.cannonAngle = nt.ta; golem.driverId = nt.dr;
        golem.rx = nt.x; golem.ry = nt.y;
        golem.lastShot = now() - (1450 - (nt.cd || 0));
        if (nt.fl) golem.muzzle = now();
      }
      G.golems = G.golems.filter((golem) => golemSeen.has(golem.id));
      // 飛び道具(置き換え)
      G.projectiles = d.b.map((b) => ({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, range: 9999, traveled: 0,
        kind: b.sh ? "shell" : "projectile", proj: b.pj || "arrow",
        col: PROJECTILE_COLORS[b.pj] || "#ffe49a", len: b.ln || 18,
      }));
      const nt = now();
      G.bombs = (d.g || []).map((g) => ({
        x: g.x, y: g.y, vx: g.vx, vy: g.vy, rotation: g.ro,
        fuseAt: nt + g.rem, bornAt: nt - g.age,
      }));
      const ballistaSeen = new Set();
      for (const nt2 of (d.tu || [])) {
        ballistaSeen.add(nt2.id);
        let ballista = G.ballistas.find((x) => x.id === nt2.id);
        if (!ballista) {
          ballista = { kind: "ballista", id: nt2.id, x: nt2.x, y: nt2.y, muzzle: 0, hitFlash: 0 };
          G.ballistas.push(ballista);
        }
        ballista.x = nt2.x; ballista.y = nt2.y; ballista.angle = nt2.a;
        ballista.team = nt2.tm; ballista.hp = nt2.hp; ballista.maxHp = nt2.mh;
        ballista.dead = !!nt2.d; ballista.gunnerId = nt2.gn;
        if (nt2.fl) ballista.muzzle = now();
      }
      G.ballistas = G.ballistas.filter((ballista) => ballistaSeen.has(ballista.id));
      G.glyphs = (d.mn || []).map((m) => ({
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
      G.thorns = (d.wr || []).map((thorn) => ({
        id: thorn.id, team: thorn.tm, x: thorn.x, y: thorn.y, owner: -1, seed: thorn.sd || 0,
      }));
      G.pickups = (d.p || []).map((p) => ({
        id: p.id, kind: p.k || "potion", x: p.x, y: p.y, active: !!p.ac,
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
      const s = G.units.map((o) => ({
        id: o.id, tm: o.team, n: o.name, lv: o.level,
        x: Math.round(o.x), y: Math.round(o.y), a: +o.aimAngle.toFixed(2),
        hp: Math.round(o.hp), mh: o.maxHp, d: o.dead ? 1 : 0, w: o.weapon,
        xp: o.xp, am: o.ammo, rl: o.reloading ? 1 : 0, gr: o.bombs, mg: o.maxBombs || 3, v: o.vehicleId, tr: o.ballistaId,
        mn: o.glyphs, mm: o.maxGlyphs || 2, wi: o.thorns || 0, mw: o.maxThorns || 0, cl: o.classKey,
        fk: o.foeKey || null, bk: o.bossKey || null, rr: o.r || 0, ud: o.undead ? 1 : 0,
        ch: Math.max(0, (o.chilledUntil || 0) - stamp),
        ar: Math.round(o.armor), ma: o.maxArmor, sh: Math.round(o.shield), ms: o.maxShield, sr: o.shieldRaised ? 1 : 0,
        pr: Math.max(0, o.parryUntil - stamp), pc: Math.max(0, o.parryCooldownUntil - stamp), st: Math.max(0, o.stunnedUntil - stamp),
        rh: Math.max(0, AUTO_HEAL_DELAY_MS - (stamp - o.lastDamagedAt)),
        ki: o.kills, de: o.deaths, mv: o.moving ? 1 : 0, nr: o.noiseRadius || 0,
        fl: (stamp - o.muzzle < (WEAPONS[o.weapon].melee ? 190 : 60)) ? 1 : 0,
      }));
      const dg = G.beasts.map((beast) => ({
        id: beast.id, tm: beast.team, n: beast.name, x: Math.round(beast.x), y: Math.round(beast.y),
        a: +beast.angle.toFixed(2), hp: Math.round(beast.hp), mh: beast.maxHp, d: beast.dead ? 1 : 0,
        mv: beast.moving ? 1 : 0, bt: stamp - beast.biteAt < 180 ? 1 : 0, wl: beast.wild ? 1 : 0,
      }));
      const tn = G.golems.map((golem) => ({
        id: golem.id, tm: golem.team, n: golem.name, x: Math.round(golem.x), y: Math.round(golem.y),
        a: +golem.angle.toFixed(2), ta: +golem.cannonAngle.toFixed(2), hp: Math.round(golem.hp), mh: golem.maxHp,
        d: golem.dead ? 1 : 0, dr: golem.driverId, cd: Math.max(0, 1450 - (stamp - golem.lastShot)), fl: stamp - golem.muzzle < 90 ? 1 : 0,
      }));
      const b = G.projectiles.map((x) => ({
        x: Math.round(x.x), y: Math.round(x.y), vx: Math.round(x.vx), vy: Math.round(x.vy),
        pj: x.proj || "arrow", ln: x.len || 18, sh: x.kind === "shell" ? 1 : 0,
      }));
      const g = G.bombs.map((x) => ({
        x: Math.round(x.x), y: Math.round(x.y), vx: Math.round(x.vx), vy: Math.round(x.vy), ro: +x.rotation.toFixed(2),
        rem: Math.max(0, x.fuseAt - stamp), age: Math.max(0, stamp - x.bornAt),
      }));
      const p = G.pickups.map((kit) => ({
        id: kit.id, k: kit.kind, x: Math.round(kit.x), y: Math.round(kit.y), ac: kit.active ? 1 : 0,
        rem: kit.active ? 0 : Math.max(0, kit.respawnAt - stamp),
      }));
      const mn = G.glyphs.map((m) => ({
        id: m.id, tm: m.team, x: Math.round(m.x), y: Math.round(m.y),
        ar: Math.max(0, m.armAt - stamp), sm: m.stealthMul || 1,
      }));
      const tu = G.ballistas.map((ballista) => ({
        id: ballista.id, x: Math.round(ballista.x), y: Math.round(ballista.y), a: +ballista.angle.toFixed(2),
        tm: ballista.team, hp: Math.round(ballista.hp), mh: ballista.maxHp, d: ballista.dead ? 1 : 0,
        gn: ballista.gunnerId, fl: stamp - ballista.muzzle < 55 ? 1 : 0,
      }));
      const cre = G.creature ? {
        x: Math.round(G.creature.x), y: Math.round(G.creature.y),
        a: +G.creature.angle.toFixed(2), h: G.creature.hunting ? 1 : 0,
        tg: G.creature.targetId, lg: stamp - G.creature.lungeAt < 220 ? 1 : 0,
      } : null;
      const wr = G.thorns.map((thorn) => ({
        id: thorn.id, tm: thorn.team, x: Math.round(thorn.x), y: Math.round(thorn.y), sd: +(thorn.seed || 0).toFixed(2),
      }));
      const bs = G.bases.map((base) => ({ tm: base.team, hp: Math.round(base.hp), mh: base.maxHp, hf: +base.hitFlash.toFixed(2) }));
      const payload = { t: "snap", sc: G.score, an: G.partyNames, ck: Math.round(G.clock),
        fs: G.foesSlain, bsm: G.bossSummoned ? 1 : 0, bid: G.boss == null ? -1 : G.boss,
        bs, s, dg, tn, tu, b, g, p, mn, wr, cre, kf: G.killfeed };
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
            bombEdge: inp.bombEdge, interactEdge: inp.interactEdge, glyphEdge: inp.glyphEdge, thornEdge: inp.thornEdge,
            parryEdge: inp.parryEdge, shield: inp.shield,
          },
        });
      } catch (e) {}
    }

    function showRoomBanner() {
      const humanCount = G ? G.units.filter((s) => s.controller !== "cpu").length : 1;
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
    const saved = localStorage.getItem("mr-name");
    if (saved) el.nameInput.value = saved;
    playerName = el.nameInput.value.trim() || "勇者";
    el.nameInput.addEventListener("input", () => {
      playerName = el.nameInput.value.trim() || "勇者";
      localStorage.setItem("mr-name", playerName);
    });

    // ステージ
    const savedStage = localStorage.getItem("mr-stage");
    playerStage = STAGE_BY_KEY[savedStage] ? savedStage : "ruins";
    el.stageSeg.innerHTML = STAGES.map((st) =>
      `<button data-stage="${st.key}"><span class="class-head">${st.icon} ${esc(st.name)}</span>` +
      `<span class="class-desc">${esc(st.desc)}</span></button>`).join("");
    function syncStageButtons() {
      el.stageSeg.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", b.dataset.stage === playerStage);
      });
    }
    // 訓練の間は1人用なので、選んでいる間はオンライン対戦を伏せる
    const onlineBtn = document.getElementById("btn-online");
    function syncOnlineAvailability() {
      const solo = stageIsTraining(playerStage);
      onlineBtn.disabled = solo;
      onlineBtn.textContent = solo ? "オンライン協力（訓練の間では使えません）" : "オンライン協力プレイ";
    }
    el.stageSeg.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-stage]");
      if (!b) return;
      playerStage = b.dataset.stage;
      localStorage.setItem("mr-stage", playerStage);
      syncStageButtons();
      syncOnlineAvailability();
    });
    syncStageButtons();
    syncOnlineAvailability();

    // キャラクター(職業)
    const savedClass = localStorage.getItem("mr-class");
    playerClass = CLASS_BY_KEY[savedClass] ? savedClass : "swordsman";
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
      localStorage.setItem("mr-class", playerClass);
      syncClassButtons();
    });
    syncClassButtons();

    const savedParty = localStorage.getItem("mr-party");
    if (savedParty) el.partyInput.value = savedParty;
    else el.partyInput.value = TEAM_DEFS[TEAM_HERO].name;
    partyName = el.partyInput.value.trim() || TEAM_DEFS[TEAM_HERO].name;
    el.partyInput.addEventListener("input", () => {
      partyName = el.partyInput.value.trim() || TEAM_DEFS[TEAM_HERO].name;
      localStorage.setItem("mr-party", partyName);
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
      if (!el.help.classList.contains("hidden")) closeHelp();
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
      ? "スマホ: 左で移動・右で照準＆攻撃・専用ボタンで火炎瓶/呪印/ゴーレム"
      : "PC: WASDで移動・マウスで攻撃・Gで火炎瓶・Fで呪印・Eでゴーレム";
  }

  function openMenu() {
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
    const b = document.getElementById("net-banner"); if (b) b.style.display = "none";
  }

  // 起動
  resize();
  setupMenu();
})();
