/* =========================================================================
   STEEL SERPENT ― データ
   武器 / 敵 / ボス / ステージ地形 / 無線台本
   ========================================================================= */

/* ===================== 難易度 ===================== */
const DIFF = {
  easy:   { name: 'EASY',   dmgIn: 0.6, dmgOut: 1.3, sight: 0.78, enemyRate: 1.35, dodgeWin: 1.35, hp: 130 },
  normal: { name: 'NORMAL', dmgIn: 1.0, dmgOut: 1.0, sight: 1.0,  enemyRate: 1.0,  dodgeWin: 1.0,  hp: 100 },
  hard:   { name: 'HARD',   dmgIn: 1.6, dmgOut: 0.85, sight: 1.22, enemyRate: 0.78, dodgeWin: 0.78, hp: 80 },
};

/* ===================== 武器 =====================
   ラッシュ中に使うのはダガーナイフのみ。銃はすべて通常戦闘用。
   ================================================= */
const WEAPONS = {
  knife: {
    id: 'knife', name: 'ダガーナイフ', short: 'KNIFE', melee: true, silent: true,
    dmg: 34, rate: 0.28, range: 46, mag: Infinity, reserve: Infinity, icon: '🗡',
    desc: 'ラッシュ専用にして万能の相棒。背後からならCQCで一撃。',
  },
  m9: {
    id: 'm9', name: 'サプレッサー付きハンドガン', short: 'M9-SD', sound: 'silenced', silent: true,
    dmg: 24, rate: 0.17, spread: 0.018, speed: 1250, mag: 12, reserve: 96, reload: 1.0, icon: '🔫',
    desc: '発砲音が漏れない。潜入の基本。', kick: 1.6,
  },
  tranq: {
    id: 'tranq', name: '麻酔銃', short: 'TRANQ', sound: 'tranq', silent: true, tranq: true,
    dmg: 8, rate: 0.55, spread: 0.01, speed: 900, mag: 6, reserve: 30, reload: 1.4, icon: '💤',
    desc: '非殺傷。当たった敵は数秒後に昏倒する。頭に当てれば即効。', kick: 1.2,
  },
  ar: {
    id: 'ar', name: 'アサルトライフル', short: 'AR', sound: 'rifle', auto: true,
    dmg: 17, rate: 0.085, spread: 0.05, speed: 1500, mag: 30, reserve: 210, reload: 1.5, icon: '🔩',
    desc: 'フルオート。制圧力は高いが銃声で敵が集まる。', kick: 2.4,
  },
  sg: {
    id: 'sg', name: 'コンバットショットガン', short: 'SG', sound: 'shotgun',
    dmg: 13, pellets: 8, rate: 0.62, spread: 0.16, speed: 1050, range: 420,
    mag: 6, reserve: 42, reload: 2.0, icon: '💥', desc: '至近距離の暴力。ペレット8発。', kick: 7,
  },
  sniper: {
    id: 'sniper', name: '対物狙撃銃', short: 'SNIPE', sound: 'sniper', pierce: 3, zoom: 0.78,
    dmg: 95, rate: 1.1, spread: 0.004, speed: 2600, mag: 5, reserve: 25, reload: 2.2, icon: '🎯',
    desc: '装甲を貫通する。構えるとカメラが引く。', kick: 9,
  },
  rl: {
    id: 'rl', name: 'ロケットランチャー', short: 'RL', sound: 'launcher', rocket: true,
    dmg: 130, splash: 130, rate: 1.4, spread: 0.01, speed: 620, mag: 1, reserve: 6, reload: 2.4, icon: '🚀',
    desc: '兵器を壊すための兵器。自爆に注意。', kick: 11,
  },
};
const WEAPON_ORDER = ['knife', 'm9', 'tranq', 'ar', 'sg', 'sniper', 'rl'];

/* ===================== 敵 ===================== */
const ENEMIES = {
  grunt: {
    name: '警備兵', hp: 62, speed: 82, w: 26, h: 46, color: '#4a5a6b', accent: '#7d8f2f',
    sight: 420, fov: 0.52, gun: { dmg: 11, speed: 620, cd: 1.25, burst: 3, gap: 0.11, spread: 0.06, sound: 'rifle' },
    keepDist: 230, score: 100,
  },
  smg: {
    name: '突撃兵', hp: 54, speed: 128, w: 25, h: 45, color: '#5b4a58', accent: '#c2554a',
    sight: 380, fov: 0.58, gun: { dmg: 7, speed: 560, cd: 0.8, burst: 5, gap: 0.07, spread: 0.11, sound: 'rifle' },
    keepDist: 130, aggressive: true, score: 110,
  },
  shotgunner: {
    name: '散弾兵', hp: 96, speed: 92, w: 30, h: 48, color: '#5a4b3a', accent: '#d08a2c',
    sight: 340, fov: 0.6, gun: { dmg: 9, speed: 520, cd: 1.7, burst: 1, pellets: 6, spread: 0.28, range: 330, sound: 'shotgun' },
    keepDist: 150, aggressive: true, score: 140,
  },
  sniperE: {
    name: '狙撃兵', hp: 46, speed: 54, w: 25, h: 45, color: '#3c4a42', accent: '#63d0a0',
    sight: 800, fov: 0.3, laser: true,
    gun: { dmg: 26, speed: 1500, cd: 2.6, burst: 1, charge: 1.05, spread: 0.005, sound: 'sniper' },
    keepDist: 480, score: 180,
  },
  shield: {
    name: '盾兵', hp: 140, speed: 62, w: 34, h: 50, color: '#46505c', accent: '#9aa7b4',
    sight: 360, fov: 0.55, shield: true,
    gun: { dmg: 9, speed: 560, cd: 1.6, burst: 2, gap: 0.12, spread: 0.07, sound: 'rifle' },
    keepDist: 120, aggressive: true, score: 200,
  },
  dog: {
    name: '軍用犬', hp: 34, speed: 210, w: 38, h: 26, color: '#3a2f28', accent: '#6b5442',
    sight: 470, fov: 0.95, quadruped: true, melee: { dmg: 13, range: 40, cd: 0.85, wind: 0.28 },
    keepDist: 0, aggressive: true, score: 90,
  },
  drone: {
    name: '偵察ドローン', hp: 42, speed: 130, w: 34, h: 22, color: '#33404d', accent: '#6ec8ff',
    sight: 500, fov: 0.85, flying: true, hover: 190,
    gun: { dmg: 8, speed: 620, cd: 1.5, burst: 2, gap: 0.14, spread: 0.05, sound: 'rifle' }, score: 120,
  },
  heavy: {
    name: '重装兵', hp: 210, speed: 52, w: 40, h: 54, color: '#4b4238', accent: '#d94a2c', armor: 0.35,
    sight: 440, fov: 0.5,
    gun: { dmg: 8, speed: 700, cd: 2.4, burst: 10, gap: 0.075, spread: 0.13, sound: 'rifle' },
    keepDist: 260, score: 300,
  },
  jetpack: {
    name: '空挺兵', hp: 88, speed: 150, w: 28, h: 46, color: '#4a4256', accent: '#ffb43c',
    sight: 540, fov: 0.7, flying: true, hover: 230,
    gun: { dmg: 12, speed: 720, cd: 1.5, burst: 3, gap: 0.1, spread: 0.08, sound: 'rifle' }, score: 220,
  },
};

/* ===================== ボス ===================== */
const BOSSES = {
  shark: {
    name: 'シャーク', title: '船を喰う男', hp: 980, w: 54, h: 74, color: '#4d5a4a', accent: '#d8542f',
    music: 'boss', phases: 2, score: 3000,
    intro: ['この船は俺の胃袋だ。', '……骨まで残さねえよ、蛇野郎。'],
  },
  harpy: {
    name: 'ハーピー', title: '高度一万の魔女', hp: 880, w: 30, h: 48, color: '#3f4a5c', accent: '#7de0ff',
    music: 'boss', phases: 2, flying: true, score: 3200,
    intro: ['落ちるのは、あなたのほうよ。', '空はわたしの狩り場なの。'],
  },
  revolver: {
    name: 'レヴォルヴァー', title: '六発の教義', hp: 820, w: 28, h: 50, color: '#4b3f36', accent: '#ffd27a',
    music: 'boss', phases: 2, score: 3600,
    intro: ['六発だ。それ以上は要らん。', '跳ね返る弾を数えられるか、蛇よ。'],
  },
  vulture: {
    name: 'ヴァルチャー', title: '二足歩行戦車', hp: 1900, w: 120, h: 130, color: '#3d4650', accent: '#ff4d55',
    music: 'boss', phases: 3, machine: true, score: 6000,
    intro: ['――起動シークエンス完了。', '照準を確認。排除を開始する。'],
  },
};

/* ===================== 地形ビルダー ===================== */
function L() {
  const lv = { solids: [], ladders: [], props: [], items: [], guns: [], enemies: [], events: [], deco: [] };
  lv.S = (x, y, w, h, t = 'metal') => { lv.solids.push({ x, y, w, h, t }); return lv; };
  lv.OW = (x, y, w) => { lv.solids.push({ x, y, w, h: 14, t: 'grate', oneway: true }); return lv; };
  lv.LAD = (x, y, h) => { lv.ladders.push({ x, y: y - 22, w: 30, h: h + 22 }); return lv; };
  lv.E = (type, x, y, p1, p2, face) => { lv.enemies.push({ type, x, y, patrol: p1 !== undefined ? [p1, p2] : null, face: face || 1 }); return lv; };
  lv.IT = (kind, x, y) => { lv.items.push({ kind, x, y }); return lv; };
  lv.GUN = (wid, x, y) => { lv.guns.push({ wid, x, y }); return lv; };
  lv.PROP = (kind, x, y) => { lv.props.push({ kind, x, y }); return lv; };
  lv.EV = (x, kind, val) => { lv.events.push({ x, kind, val, done: false }); return lv; };
  lv.D = (kind, x, y, a, b) => { lv.deco.push({ kind, x, y, a, b }); return lv; };
  return lv;
}

/* ===================== ステージ1：フェリー ===================== */
function buildStage1() {
  const lv = L();
  const W = 6600, H = 1060;
  const F = 780;                       // 主甲板の高さ

  /* --- 船首の甲板 --- */
  lv.S(-300, F, 3500, 280, 'deck');
  lv.S(-320, 240, 40, 560, 'metal');   // 船首の外壁
  /* コンテナ段 */
  lv.S(520, F - 100, 150, 100, 'crate'); lv.S(675, F - 100, 150, 100, 'crate');
  lv.S(595, F - 200, 150, 100, 'crate');
  lv.S(1420, F - 100, 150, 100, 'crate'); lv.S(1575, F - 200, 150, 100, 'crate');
  lv.OW(1900, F - 190, 340);           // クレーンの足場
  lv.LAD(1880, F - 190, 190);
  lv.D('crane', 2050, F - 190);
  lv.D('mast', 300, F);

  /* --- 一段高い中央甲板 --- */
  lv.S(3200, F - 70, 60, 350, 'metal');
  lv.S(3260, F - 70, 1500, 350, 'deck');
  lv.S(2560, F - 100, 150, 100, 'crate');
  lv.OW(2850, F - 210, 300);
  lv.LAD(2830, F - 210, 210);

  /* --- 上部ブリッジ通路（オプションルート） --- */
  lv.OW(3400, F - 300, 1100);
  lv.LAD(3420, F - 300, 232);
  lv.LAD(4430, F - 300, 232);

  /* --- 船尾側・機関室入口 --- */
  lv.S(4760, F, 1900, 280, 'deck');
  lv.S(4700, F - 70, 60, 80, 'metal');
  lv.S(5050, F - 100, 150, 100, 'crate');
  lv.OW(5350, F - 220, 320);
  lv.LAD(5330, F - 220, 220);

  /* --- ボス戦：ヘリデッキ --- */
  lv.S(6560, 200, 40, 860, 'metal');
  lv.D('helipad', 6000, F);

  /* --- 小物 --- */
  lv.PROP('barrel', 900, F); lv.PROP('barrel', 940, F);
  lv.PROP('barrel', 3600, F - 70); lv.PROP('crate', 2400, F);
  lv.PROP('barrel', 5150, F); lv.PROP('crate', 4900, F);
  lv.IT('ration', 640, F - 210); lv.IT('ammo', 1600, F - 210);
  lv.IT('ration', 3900, F - 310); lv.IT('ammo', 4200, F - 310);
  lv.IT('box', 2600, F - 120); lv.IT('ration', 5400, F - 230);
  lv.IT('ammo', 5000, F); lv.IT('armor', 4460, F - 310);
  lv.GUN('ar', 1250, F); lv.GUN('tranq', 720, F - 210);

  /* --- 敵配置 --- */
  lv.E('grunt', 700, F, 560, 1000, 1);
  lv.E('grunt', 1300, F, 1150, 1700, -1);
  lv.E('smg', 2000, F - 190, 1910, 2220, 1);
  lv.E('grunt', 2500, F, 2350, 2900, -1);
  lv.E('shotgunner', 2950, F, 2900, 3180, 1);
  lv.E('grunt', 3450, F - 70, 3300, 3800, 1);
  lv.E('sniperE', 3900, F - 300, null, null, -1);
  lv.E('smg', 4100, F - 70, 3950, 4500, -1);
  lv.E('grunt', 4400, F - 70, 4250, 4700, 1);
  lv.E('shield', 4900, F, 4820, 5200, 1);
  lv.E('grunt', 5450, F - 220, 5360, 5640, -1);
  lv.E('smg', 5600, F, 5450, 5950, -1);
  lv.E('shotgunner', 5900, F, 5800, 6100, -1);

  /* --- イベント --- */
  lv.EV(240, 'objective', '目標：甲板を突破し、船尾ヘリデッキへ');
  lv.EV(240, 'tutorial', 'dodge');
  lv.EV(2300, 'codec', 's1_mid');
  lv.EV(4750, 'objective', '目標：船尾ヘリデッキの敵指揮官を制圧せよ');
  lv.EV(6050, 'boss', 'shark');

  return Object.assign(lv, {
    id: 'ferry', num: 1, name: 'タンカー強襲', sub: 'ASSAULT ON THE TANKER',
    theme: 'ferry', music: 'calm', w: W, h: H, spawn: { x: 120, y: F - 60 },
    arena: { x0: 5900, x1: 6560 }, boss: 'shark', bossPos: { x: 6350, y: F - 90 },
    unlock: ['ar', 'tranq'],
    brief: {
      text: '北大西洋を航行する大型フェリー〈オルカ〉が武装勢力に乗っ取られた。\n積荷は新型兵器の中核部品。到着前に奪還する。\n\n単独潜入。支援はなし。回収は作戦後だ。',
      obj: ['フェリー〈オルカ〉に潜入する', '甲板から船尾ヘリデッキまで到達する', '船を仕切る指揮官を制圧する'],
    },
  });
}

/* ===================== ステージ2：輸送機 ===================== */
function buildStage2() {
  const lv = L();
  const W = 6200, H = 1000;
  const F = 760;

  /* --- 貨物室（後部） --- */
  lv.S(-300, F, 2600, 240, 'plane');
  lv.S(-320, 200, 40, 600, 'metal');
  lv.S(-300, 300, 2600, 30, 'plane');   // 天井
  lv.S(420, F - 100, 160, 100, 'crate'); lv.S(580, F - 100, 160, 100, 'crate');
  lv.S(500, F - 200, 160, 100, 'crate');
  lv.OW(1000, F - 240, 420);
  lv.LAD(980, F - 240, 240);
  lv.S(1600, F - 100, 170, 100, 'crate');
  lv.OW(1900, F - 250, 340);
  lv.LAD(2200, F - 250, 250);

  /* --- 中部：客席・通路 --- */
  lv.S(2300, F, 1500, 240, 'plane');
  lv.S(2300, 300, 1500, 30, 'plane');
  lv.S(2450, F - 90, 40, 90, 'metal');
  lv.S(2700, F - 90, 40, 90, 'metal');
  lv.OW(2490, F - 90, 220);
  lv.OW(3100, F - 240, 500);
  lv.LAD(3080, F - 240, 240);
  lv.D('seats', 2900, F);
  lv.D('seats', 3400, F);

  /* --- 前部：与圧区画と機首 --- */
  lv.S(3800, F, 1400, 240, 'plane');
  lv.S(3800, 300, 1400, 30, 'plane');
  lv.S(4100, F - 100, 150, 100, 'crate');
  lv.OW(4400, F - 250, 400);
  lv.LAD(4380, F - 250, 250);
  lv.S(5000, F - 70, 60, 310, 'metal');

  /* --- ボス戦：開放された貨物ハッチ（強風） --- */
  lv.S(5060, F, 1140, 240, 'plane');
  lv.S(5060, 260, 900, 30, 'plane');
  lv.S(6160, 200, 40, 860, 'metal');
  lv.D('ramp', 5900, F);

  lv.PROP('crate', 800, F); lv.PROP('barrel', 1300, F); lv.PROP('crate', 2000, F);
  lv.PROP('barrel', 3900, F); lv.PROP('crate', 4600, F);
  lv.IT('ration', 540, F - 230); lv.IT('ammo', 1150, F - 250);
  lv.IT('ammo', 3300, F - 250); lv.IT('ration', 4500, F - 260);
  lv.IT('armor', 2050, F - 260); lv.IT('box', 1700, F - 110);
  lv.IT('ration', 5200, F);
  lv.GUN('sg', 1660, F - 110); lv.GUN('sniper', 3250, F - 250);

  lv.E('grunt', 700, F, 400, 950, 1);
  lv.E('dog', 1100, F, 950, 1500, -1);
  lv.E('smg', 1450, F, 1300, 1800, 1);
  lv.E('grunt', 1950, F - 250, 1910, 2220, 1);
  lv.E('shotgunner', 2150, F, 2050, 2280, -1);
  lv.E('drone', 2600, F - 320, 2400, 3000, 1);
  lv.E('grunt', 2900, F, 2750, 3300, -1);
  lv.E('smg', 3300, F, 3150, 3700, 1);
  lv.E('sniperE', 3350, F - 240, null, null, -1);
  lv.E('shield', 3950, F, 3850, 4200, 1);
  lv.E('drone', 4300, F - 330, 4100, 4700, -1);
  lv.E('grunt', 4550, F - 250, 4420, 4750, -1);
  lv.E('heavy', 4800, F, 4700, 4980, -1);
  lv.E('jetpack', 5300, F - 300, 5150, 5700, -1);
  lv.E('smg', 5400, F, 5200, 5800, -1);

  lv.EV(240, 'objective', '目標：機体後部から機首方向へ制圧しつつ進め');
  lv.EV(2400, 'codec', 's2_mid');
  lv.EV(5100, 'objective', '目標：貨物ハッチの上空戦力を撃墜せよ');
  lv.EV(5750, 'boss', 'harpy');

  return Object.assign(lv, {
    id: 'plane', num: 2, name: '輸送機強襲', sub: 'HIJACK AT 10,000 M',
    theme: 'plane', music: 'tense', w: W, h: H, spawn: { x: 120, y: F - 60 },
    arena: { x0: 5560, x1: 6160 }, boss: 'harpy', bossPos: { x: 5950, y: F - 260 },
    wind: -60,
    unlock: ['sg', 'sniper'],
    brief: {
      text: '奪われた部品は輸送機〈ヴァイパー7〉で敵本国へ運ばれている。\n君は高高度でその機体に取り付いた。もう降りる手段はない。\n\n積荷を押さえ、機を落とすな。落ちるのは君も同じだ。',
      obj: ['貨物室から機首方向へ制圧して進む', '与圧区画の守備隊を排除する', '貨物ハッチの空挺指揮官を撃墜する'],
    },
  });
}

/* ===================== ステージ3：敵ボスの基地 ===================== */
function buildStage3() {
  const lv = L();
  const W = 7600, H = 1120;
  const F = 800;

  /* --- 外周（雪と鉄条網） --- */
  lv.S(-300, F, 2400, 300, 'ground');
  lv.S(-320, 200, 40, 640, 'metal');
  lv.S(600, F - 100, 160, 100, 'crate');
  lv.S(760, F - 100, 160, 100, 'crate');
  lv.OW(1150, F - 230, 380);
  lv.LAD(1130, F - 230, 230);
  lv.D('tower', 1500, F - 230);
  lv.D('fence', 300, F); lv.D('fence', 1800, F);

  /* --- ゲートと壁 --- */
  lv.S(2100, F - 90, 60, 390, 'metal');
  lv.S(2160, F - 90, 1200, 390, 'base');
  lv.S(2160, 300, 1200, 30, 'base');
  lv.S(2500, F - 180, 40, 90, 'metal');
  lv.OW(2540, F - 180, 280);
  lv.S(2900, F - 190, 170, 100, 'crate');

  /* --- 研究区画 --- */
  lv.S(3360, F - 90, 1400, 390, 'base');
  lv.S(3360, 260, 1400, 30, 'base');
  lv.OW(3500, F - 330, 700);
  lv.LAD(3480, F - 330, 240);
  lv.LAD(4180, F - 330, 240);
  lv.D('wall', 2160, 320, 1200, 480);
  lv.D('wall', 3360, 280, 1400, 520);
  lv.D('wall', 4760, 260, 1200, 540);
  lv.D('wall', 5960, 260, 700, 540);
  lv.D('wall', 6660, 200, 980, 600);
  lv.D('screens', 3700, F - 90);
  lv.D('tank', 4300, F - 90);

  /* --- 格納庫前の下層通路 --- */
  lv.S(4760, F, 1200, 300, 'base');
  lv.S(4760, 240, 1200, 30, 'base');
  lv.S(4700, F - 90, 60, 100, 'metal');
  lv.S(5100, F - 100, 160, 100, 'crate');
  lv.OW(5400, F - 260, 420);
  lv.LAD(5380, F - 260, 260);

  /* --- 中ボス：ガンマンの間 --- */
  lv.S(5960, F, 700, 300, 'base');
  lv.S(5960, 240, 700, 30, 'base');
  lv.D('pillars', 6100, F);

  /* --- 最終：格納庫 --- */
  lv.S(6660, F, 980, 300, 'base');
  lv.S(6660, 180, 980, 30, 'base');
  lv.S(7600, 180, 40, 920, 'metal');
  lv.D('hangar', 7000, F);

  lv.PROP('barrel', 1000, F); lv.PROP('crate', 1900, F);
  lv.PROP('barrel', 2700, F - 90); lv.PROP('barrel', 2740, F - 90);
  lv.PROP('crate', 3900, F - 90); lv.PROP('barrel', 5000, F);
  lv.IT('ration', 700, F - 220); lv.IT('ammo', 1300, F - 240);
  lv.IT('armor', 2650, F - 190); lv.IT('ration', 3600, F - 340);
  lv.IT('ammo', 4000, F - 340); lv.IT('box', 3000, F - 200);
  lv.IT('ration', 5500, F - 270); lv.IT('ammo', 5600, F - 270);
  lv.IT('ration', 6300, F); lv.IT('ammo', 6800, F); lv.IT('armor', 6900, F);
  lv.GUN('rl', 4050, F - 340);

  lv.E('grunt', 500, F, 300, 900, 1);
  lv.E('dog', 900, F, 700, 1400, -1);
  lv.E('sniperE', 1400, F - 230, null, null, -1);
  lv.E('grunt', 1700, F, 1550, 2050, -1);
  lv.E('shotgunner', 2300, F - 90, 2200, 2600, 1);
  lv.E('smg', 2700, F - 90, 2550, 3100, -1);
  lv.E('shield', 3150, F - 90, 3050, 3350, 1);
  lv.E('drone', 3600, F - 460, 3400, 4100, 1);
  lv.E('smg', 3700, F - 90, 3550, 4000, 1);
  lv.E('grunt', 3800, F - 330, 3550, 4150, -1);
  lv.E('heavy', 4400, F - 90, 4300, 4700, -1);
  lv.E('grunt', 4900, F, 4800, 5200, 1);
  lv.E('dog', 5200, F, 5050, 5600, -1);
  lv.E('sniperE', 5600, F - 260, null, null, -1);
  lv.E('shield', 5700, F, 5600, 5900, -1);

  lv.EV(240, 'objective', '目標：敵基地の外周を突破し、格納庫へ');
  lv.EV(2200, 'codec', 's3_mid');
  lv.EV(4800, 'objective', '目標：格納庫へ通じる下層を制圧せよ');
  lv.EV(6120, 'boss', 'revolver');
  lv.EV(6820, 'boss', 'vulture');

  return Object.assign(lv, {
    id: 'base', num: 3, name: '敵司令基地', sub: 'INTO THE SERPENT PIT',
    theme: 'base', music: 'tense', w: W, h: H, spawn: { x: 120, y: F - 60 },
    arenas: [
      { x0: 5980, x1: 6640, boss: 'revolver', trigger: 6120, pos: { x: 6480, y: F - 70 } },
      { x0: 6680, x1: 7600, boss: 'vulture', trigger: 6820, pos: { x: 7300, y: F - 150 } },
    ],
    unlock: ['rl'],
    brief: {
      text: '部品の行き先は北の山中に掘られた司令基地。\n中枢には敵が「ヴァルチャー」と呼ぶ機体が眠っている。\n\n外周、研究区画、格納庫。奥へ行くほど、戻る道はなくなる。',
      obj: ['基地外周を突破する', '研究区画を抜けて下層を制圧する', '格納庫の親衛隊長を倒す', '二足歩行戦車〈ヴァルチャー〉を破壊する'],
    },
  });
}

const STAGE_BUILDERS = [buildStage1, buildStage2, buildStage3];
const STAGE_INFO = [
  { num: 1, name: 'タンカー強襲', desc: '北大西洋のフェリーに潜入し、甲板から船尾までを制圧する。' },
  { num: 2, name: '輸送機強襲', desc: '高度一万メートル。輸送機の内部を機首方向へ押し上がる。' },
  { num: 3, name: '敵司令基地', desc: '雪の山中に掘られた司令基地。二人のボスが待つ。' },
];

/* ===================== 無線（コーデック） ===================== */
const CODEC = {
  s1_open: [
    ['colonel', 'スネーク、聞こえるか。フェリー〈オルカ〉の甲板に降りたな。'],
    ['snake', '……ああ。雨と鉄の匂いがする。悪くない。'],
    ['colonel', '積荷は新型兵器の中核部品だ。港に着く前に押さえろ。'],
    ['mia', 'スネーク、こっちミア。潜入のコツ、ひとつだけ言っとくね。'],
    ['mia', '敵の攻撃は避けられる。<b>Shift（または右クリック）でドッジ</b>。転がってる間は無敵。'],
    ['mia', 'で、そのドッジで攻撃をすり抜けた瞬間――<b>パーフェクト回避</b>。時間が伸びて、<b>RUSH</b>がたまる。'],
    ['snake', 'たまったら?'],
    ['mia', '<b>F</b>。ナイフだけ抜いて相手に飛び込む。銃はそのとき使えない。使うのは<b>ダガーナイフだけ</b>よ。'],
    ['snake', '……昔から、最後に残るのはナイフだ。'],
    ['colonel', '幸運を。以上だ。'],
  ],
  s1_mid: [
    ['mia', '船内に近づいてる。銃声は敵を呼ぶよ。'],
    ['mia', '<b>サプレッサー付きハンドガン</b>と<b>麻酔銃</b>は音が漏れない。背後からなら<b>F</b>でCQC、一撃で黙らせられる。'],
    ['snake', '静かにやる。得意だ。'],
  ],
  s1_boss: [
    ['colonel', 'スネーク、ヘリデッキに大型の反応。指揮官だ。'],
    ['snake', '……でかいな。'],
    ['mia', '正面から撃ち合っちゃだめ。突進はドッジで抜けて、ラッシュで削る。'],
  ],
  s1_end: [
    ['colonel', 'よくやった。だが部品は積み替えられた後だった。'],
    ['snake', '……輸送機か。'],
    ['colonel', '高度一万メートル。取り付く算段はこちらでつける。休んでいる暇はないぞ。'],
  ],
  s2_open: [
    ['mia', '機体に取り付いたのね。信じられない。'],
    ['snake', '風が強い。話は手短に頼む。'],
    ['mia', '貨物室から機首方向へ。途中に<b>ショットガン</b>と<b>対物狙撃銃</b>が転がってるはず。'],
    ['colonel', '機を落とすな。落ちるのは君も同じだ。'],
  ],
  s2_mid: [
    ['mia', '与圧区画に入るよ。狭い場所ではショットガンが効く。'],
    ['mia', 'それと、犬は音に敏感。足音でも寄ってくるから、しゃがんで動いて。'],
  ],
  s2_boss: [
    ['colonel', '空挺装備の指揮官だ。コードネーム〈ハーピー〉。'],
    ['snake', '飛んでる相手は撃ちにくい。'],
    ['mia', '降りてきた瞬間が唯一の隙。焦らないで。'],
  ],
  s2_end: [
    ['colonel', '部品は基地へ先に運ばれていた。北の山中だ。'],
    ['snake', '……最後は歩いて行くしかないわけだ。'],
    ['mia', 'スネーク。無茶はしないで。……いつも言ってる気がするけど。'],
  ],
  s3_open: [
    ['colonel', 'ここが終点だ、スネーク。敵司令基地。'],
    ['snake', '中に何がある。'],
    ['colonel', '……〈ヴァルチャー〉。二足歩行の兵器だ。あれを動かされたら、話は終わりだ。'],
    ['mia', '格納庫の手前に<b>ロケットランチャー</b>があるはず。装甲相手にはそれしかない。'],
  ],
  s3_mid: [
    ['mia', '研究区画。上の通路を使えば正面の火線を避けられる。'],
    ['snake', '……上か。悪くない。'],
  ],
  s3_boss1: [
    ['colonel', '親衛隊長だ。跳弾を使う。壁を背にするな。'],
    ['snake', '六発。数えてやる。'],
  ],
  s3_boss2: [
    ['colonel', '起動した……〈ヴァルチャー〉だ!'],
    ['mia', 'コックピットが弱点。踏みつけの後、必ず開く。そこを狙って!'],
    ['snake', '……行くぞ。'],
  ],
  s3_end: [
    ['colonel', '……信号が消えた。やったな、スネーク。'],
    ['snake', '積荷は灰になった。誰の手にも渡らない。'],
    ['mia', '帰ってきて。ちゃんと、生きて。'],
    ['snake', '……ああ。いつも通りだ。'],
    ['colonel', '任務完了。よく生きて帰った。'],
  ],
};

const CODEC_SPEAKER = {
  snake: { name: 'スネーク', freq: '140.85' },
  colonel: { name: '大佐', freq: '140.85' },
  mia: { name: 'ミア', freq: '141.12' },
};

/* ===================== 評価 ===================== */
const RANK_TABLE = [
  { rank: 'S', min: 92 }, { rank: 'A', min: 76 }, { rank: 'B', min: 58 },
  { rank: 'C', min: 38 }, { rank: 'D', min: 0 },
];
