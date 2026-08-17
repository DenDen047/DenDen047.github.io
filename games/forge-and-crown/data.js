/* =========================================================================
   FORGE & CROWN ― データ定義
   鉱石 / 鎧のピース / 装飾 / 建物 / 地形 / 階級 / 領地 / 勢力 / 敵
   ========================================================================= */

/* ===================== 鉱石 =====================
   1マスあたりの寄与。def=物理防御 res=魔法防御 wt=重量 hp=耐久
   純度ボーナスは「同じ鉱石が8マス以上」で発動する。            */
const ORES = {
  iron: {
    id: 'iron', name: '鉄', short: '鉄', color: '#8d949c', edge: '#6c727a', tier: 1,
    def: 6.0, res: 1.0, wt: 3.0, hp: 5,
    desc: 'どこでも採れる基本の金属。安いが頼りになる。',
    purity: { name: '鉄壁', desc: '被弾してもけぞりにくい（のけぞり耐性 +60%）' },
    ult: 'whirl',
  },
  steel: {
    id: 'steel', name: '鋼', short: '鋼', color: '#c3ccd6', edge: '#8e98a3', tier: 2,
    def: 9.5, res: 2.0, wt: 3.4, hp: 6,
    desc: '鉄を製錬所で鍛え直した金属。防御の柱になる。',
    purity: { name: '鋼の意志', desc: '物理防御 +12%' },
    ult: 'whirl',
  },
  mithril: {
    id: 'mithril', name: 'ミスリル', short: '銀鋼', color: '#8fe3ff', edge: '#4aa8cc', tier: 3,
    def: 6.5, res: 6.0, wt: 1.1, hp: 4,
    desc: '羽根のように軽い蒼銀。動きを一切殺さない。',
    purity: { name: '銀風', desc: '移動速度 +15%・回避距離 +25%' },
    ult: 'flurry',
  },
  orichal: {
    id: 'orichal', name: 'オリハルコン', short: '神鋼', color: '#ffd76a', edge: '#c99b22', tier: 4,
    def: 7.5, res: 11.0, wt: 2.6, hp: 5,
    desc: '古代神殿の遺産。魔術をはね返す黄金の合金。',
    purity: { name: '神鋼の加護', desc: '魔法ダメージを 25% 軽減' },
    ult: 'holy',
  },
  adamant: {
    id: 'adamant', name: 'アダマント', short: '剛石', color: '#71768f', edge: '#4a4d63', tier: 4,
    def: 15.0, res: 3.0, wt: 6.2, hp: 9,
    desc: '北の凍土でしか採れない超硬金属。ただし重い。',
    purity: { name: '不動', desc: 'ガードが崩れなくなる（ガード削り無効）' },
    ult: 'quake',
  },
  dragon: {
    id: 'dragon', name: '竜鱗', short: '竜鱗', color: '#ff7a4d', edge: '#c04a22', tier: 4,
    def: 8.5, res: 7.5, wt: 2.3, hp: 7,
    desc: '古竜の抜け鱗。熱を喰らい、熱を返す。',
    purity: { name: '竜の血', desc: '被弾時に炎で反撃する' },
    ult: 'flame',
  },
  moon: {
    id: 'moon', name: '月銀', short: '月銀', color: '#e2e8ff', edge: '#9aa4d6', tier: 3,
    def: 5.0, res: 8.5, wt: 1.5, hp: 4,
    desc: '月光を浴びて育つ銀。装者の闘気を静かに満たす。',
    purity: { name: '月光', desc: '闘気ゲージの溜まりが 50% 速い' },
    ult: 'moon',
  },
  void: {
    id: 'void', name: '虚晶', short: '虚晶', color: '#a56bff', edge: '#6b3fb0', tier: 4,
    def: 7.0, res: 5.0, wt: 2.1, hp: 3,
    desc: '沼の底で結晶した虚無。力をくれるが、身を蝕む。',
    purity: { name: '虚無の渇き', desc: '与ダメージ +18%／被ダメージ +10%' },
    ult: 'void',
  },
};
const ORE_IDS = Object.keys(ORES);

/* ===================== 鎧の部位（4×4の行） =====================
   上の行ほど急所に近く、下の行ほど重量が動きに響く。 */
const ARMOR_ROWS = [
  { name: '兜・肩', defMul: 1.00, resMul: 1.10, hpMul: 0.9, wtMul: 0.85, hint: '魔法を弾きやすい' },
  { name: '胸',     defMul: 1.35, resMul: 1.20, hpMul: 1.3, wtMul: 1.00, hint: '急所。守りの要' },
  { name: '胴',     defMul: 1.10, resMul: 1.00, hpMul: 1.1, wtMul: 1.05, hint: '素直に硬さが乗る' },
  { name: '脚',     defMul: 0.80, resMul: 0.85, hpMul: 0.9, wtMul: 1.35, hint: '重いと足が止まる' },
];

/* ===================== ピース形状 ===================== */
const SHAPES = [
  { id: 'p1',  name: '欠片',   cells: [[0, 0]] },
  { id: 'p2',  name: '短板',   cells: [[0, 0], [1, 0]] },
  { id: 'i3',  name: '長板',   cells: [[0, 0], [1, 0], [2, 0]] },
  { id: 'l3',  name: '曲金',   cells: [[0, 0], [1, 0], [0, 1]] },
  { id: 'o4',  name: '角板',   cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: 'i4',  name: '鉄骨',   cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: 'l4',  name: 'L鋼',    cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { id: 'j4',  name: 'J鋼',    cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { id: 't4',  name: 'T鋼',    cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { id: 's4',  name: 'S鋼',    cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { id: 'z4',  name: 'Z鋼',    cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
];
const SHAPE_BY_ID = {};
SHAPES.forEach((s) => { SHAPE_BY_ID[s.id] = s; });

/* ===================== 装飾（最大3つ） ===================== */
const DECORS = {
  lion:   { id: 'lion',   name: '獅子の紋章',   icon: '🦁', desc: '攻撃力 +14%',                  eff: { atk: 0.14 } },
  eagle:  { id: 'eagle',  name: '鷲の羽根飾り', icon: '🪶', desc: '移動速度 +12%',                eff: { spd: 0.12 } },
  saint:  { id: 'saint',  name: '聖印',         icon: '✨', desc: '8秒ごとにHPを少し回復',        eff: { regen: 1 } },
  ruby:   { id: 'ruby',   name: '紅玉',         icon: '🔴', desc: '会心率 +12%（会心は1.8倍）',   eff: { crit: 0.12 } },
  sapph:  { id: 'sapph',  name: '蒼玉',         icon: '🔵', desc: '魔法防御 +25%',                eff: { res: 0.25 } },
  star:   { id: 'star',   name: '星辰の宝珠',   icon: '⭐', desc: '闘気の溜まり +35%',            eff: { rage: 0.35 } },
  chain:  { id: 'chain',  name: '亡霊の鎖',     icon: '⛓️', desc: '与ダメージの10%を吸収',        eff: { drain: 0.10 } },
  thorn:  { id: 'thorn',  name: '棘飾り',       icon: '🌿', desc: '被弾時に反撃ダメージ',         eff: { thorn: 1 } },
  horn:   { id: 'horn',   name: '猛牛の角',     icon: '🐂', desc: 'ダッシュ体当たりが強くなる',   eff: { charge: 1 } },
  banner: { id: 'banner', name: '軍旗',         icon: '🚩', desc: '味方兵の攻撃と体力 +12%',      eff: { ally: 0.12 } },
  gale:   { id: 'gale',   name: '疾風の環',     icon: '🌀', desc: '攻撃の振りが速くなる（+15%）', eff: { haste: 0.15 } },
  aegis:  { id: 'aegis',  name: '守護の盾章',   icon: '🛡️', desc: '物理防御 +18%',               eff: { def: 0.18 } },
};
const DECOR_IDS = Object.keys(DECORS);

/* ===================== 城の地形 ===================== */
const TERRAIN = {
  plain: { id: 'plain', name: '平地', color: '#5f7a45', color2: '#6d8a4e' },
  hill:  { id: 'hill',  name: '丘',   color: '#7b7343', color2: '#8a814c' },
  wood:  { id: 'wood',  name: '森',   color: '#3d5f39', color2: '#476d41' },
  rock:  { id: 'rock',  name: '岩場', color: '#6a6a72', color2: '#77777f' },
  water: { id: 'water', name: '水辺', color: '#2f5f7d', color2: '#376d8e' },
};

/* ===================== 城の建物 =====================
   yield は毎ターンの産出。best/good/bad は地形適性。 */
const BUILDINGS = {
  keep:    { id: 'keep', name: '本丸', icon: '🏰', cost: {}, fixed: true,
             yield: { gold: 15 }, desc: '城の中心。ここから領地を治める。', best: [], good: [], bad: [] },
  farm:    { id: 'farm', name: '農場', icon: '🌾', cost: { wood: 20, gold: 30 },
             yield: { food: 14 }, best: ['plain'], good: ['water'], bad: ['rock'],
             desc: '食料を産む。水車小屋の隣だと収穫が増える。' },
  mill:    { id: 'mill', name: '水車小屋', icon: '💧', cost: { wood: 40, stone: 10, gold: 60 },
             yield: { food: 4 }, best: ['water'], good: ['plain'], bad: ['rock', 'hill'],
             desc: '隣接する農場の食料を +50% する。' },
  lumber:  { id: 'lumber', name: '製材所', icon: '🪵', cost: { gold: 40, stone: 10 },
             yield: { wood: 12 }, best: ['wood'], good: ['hill'], bad: ['water', 'plain'],
             desc: '木材を産む。森に建てると効率がよい。' },
  quarry:  { id: 'quarry', name: '採石場', icon: '🪨', cost: { wood: 30, gold: 50 },
             yield: { stone: 10 }, best: ['rock'], good: ['hill'], bad: ['water', 'plain'],
             desc: '石材を産む。城壁を建てるなら必須。' },
  mine:    { id: 'mine', name: '鉱山', icon: '⛏️', cost: { wood: 50, stone: 20, gold: 80 },
             yield: { ore: 3 }, best: ['rock'], good: ['hill'], bad: ['water', 'plain', 'wood'],
             desc: '領地の鉱脈から鉱石を掘り出す。鍛冶場の隣で +25%。' },
  smelter: { id: 'smelter', name: '製錬所', icon: '🔥', cost: { stone: 60, gold: 120 }, rank: 3,
             yield: {}, best: ['rock', 'hill'], good: ['plain'], bad: ['water'],
             desc: '毎ターン、鉄3を鋼2に鍛え直す。' },
  forge:   { id: 'forge', name: '鍛冶場', icon: '⚒️', cost: { wood: 40, stone: 40, gold: 100 },
             yield: {}, best: ['hill'], good: ['plain', 'rock'], bad: ['water'],
             desc: '鎧を打てるようになる。1つごとに鎧の仕上がり +6%。' },
  market:  { id: 'market', name: '市場', icon: '🏪', cost: { wood: 40, gold: 60 },
             yield: { gold: 22 }, best: ['plain'], good: ['water'], bad: ['rock'],
             desc: '金貨を産む。交易コマンドが使えるようになる。' },
  barracks:{ id: 'barracks', name: '兵舎', icon: '⚔️', cost: { wood: 50, stone: 20, gold: 80 },
             yield: {}, best: ['plain'], good: ['hill'], bad: ['water'],
             desc: '兵の上限 +12。徴兵で集まる数が増える。' },
  yard:    { id: 'yard', name: '訓練場', icon: '🎯', cost: { wood: 30, gold: 50 },
             yield: {}, best: ['plain'], good: ['hill'], bad: ['water', 'wood'],
             desc: '訓練コマンドの練度上昇が大きくなる。' },
  chapel:  { id: 'chapel', name: '礼拝堂', icon: '⛪', cost: { stone: 50, gold: 90 },
             yield: { loyalty: 3 }, best: ['hill'], good: ['plain'], bad: [],
             desc: '民心が毎ターン上がる。建てると装飾「聖印」が手に入る。' },
  mageTower:{ id: 'mageTower', name: '魔法塔', icon: '🔮', cost: { stone: 80, gold: 200 }, rank: 4,
             yield: {}, best: ['rock', 'hill'], good: ['plain'], bad: ['water'],
             desc: '毎ターン月銀1を精製。装飾「星辰の宝珠」が手に入る。' },
  wall:    { id: 'wall', name: '城壁', icon: '🧱', cost: { stone: 25 },
             yield: {}, best: [], good: [], bad: [],
             desc: '防衛力 +6。つながった城壁1枚ごとにさらに +2。' },
  tower:   { id: 'tower', name: '見張り塔', icon: '🗼', cost: { stone: 45, wood: 15, gold: 40 },
             yield: {}, best: ['hill', 'rock'], good: ['plain'], bad: ['water'],
             desc: '防衛力 +14。隣接する城壁を強化する。' },
  well:    { id: 'well', name: '井戸', icon: '🪣', cost: { stone: 20, gold: 20 },
             yield: { food: 3, loyalty: 1 }, best: ['water', 'plain'], good: ['hill'], bad: ['rock'],
             desc: '少しの食料と民心。安く置ける便利な小屋。' },
};
const BUILD_IDS = ['farm', 'mill', 'lumber', 'quarry', 'mine', 'smelter', 'forge', 'market',
                   'barracks', 'yard', 'chapel', 'mageTower', 'wall', 'tower', 'well'];

/** 地形適性の倍率 */
function terrainMul(bid, terr) {
  const b = BUILDINGS[bid];
  if (!b) return 1;
  if (b.best.includes(terr)) return 1.5;
  if (b.good.includes(terr)) return 1.15;
  if (b.bad.includes(terr)) return 0.5;
  return 1;
}

/* ===================== 階級 ===================== */
const RANKS = [
  { n: 1,  name: '従士',     en: 'Levy',             valor: 0,    troops: 0,  decor: 0, pay: 20,  plot: 1,
    unlock: '辺境の砦を任される' },
  { n: 2,  name: '槍持ち',   en: 'Man-at-Arms',      valor: 70,   troops: 2,  decor: 1, pay: 40,  plot: 1,
    unlock: '兵を2人まで率いる／装飾スロット 1' },
  { n: 3,  name: '伍長',     en: 'Corporal',         valor: 200,  troops: 3,  decor: 1, pay: 70,  plot: 2,
    unlock: '城の敷地が 5×5 に拡張／製錬所' },
  { n: 4,  name: '軍曹',     en: 'Sergeant',         valor: 420,  troops: 5,  decor: 2, pay: 110, plot: 2,
    unlock: '装飾スロット 2／魔法塔' },
  { n: 5,  name: '従騎士',   en: 'Squire',           valor: 760,  troops: 6,  decor: 2, pay: 160, plot: 2,
    unlock: '騎乗の許し（移動速度 +8%）' },
  { n: 6,  name: '騎士',     en: 'Knight',           valor: 1250, troops: 8,  decor: 3, pay: 230, plot: 3,
    unlock: '装飾スロット 3／城の敷地が 7×7 に全開放' },
  { n: 7,  name: '隊長',     en: 'Captain',          valor: 1950, troops: 10, decor: 3, pay: 320, plot: 3,
    unlock: '兵の練度上限が上がる' },
  { n: 8,  name: '騎士団長', en: 'Knight-Commander', valor: 2900, troops: 12, decor: 3, pay: 430, plot: 3,
    unlock: '軍旗の使用を許される' },
  { n: 9,  name: '元帥',     en: 'Marshal',          valor: 4200, troops: 14, decor: 3, pay: 560, plot: 3,
    unlock: '全軍の指揮権' },
  { n: 10, name: '大公',     en: 'Archduke',         valor: 6000, troops: 16, decor: 3, pay: 750, plot: 3,
    unlock: '大陸に並ぶ者なし' },
];

/** 階級ごとの支給武器 */
const WEAPONS = [
  { rank: 1,  name: '欠けた短剣',   atk: 15, reach: 34, swing: 0.30 },
  { rank: 2,  name: '兵隊剣',       atk: 20, reach: 36, swing: 0.29 },
  { rank: 3,  name: '長槍',         atk: 26, reach: 48, swing: 0.34 },
  { rank: 4,  name: '鉄の長剣',     atk: 34, reach: 40, swing: 0.28 },
  { rank: 5,  name: '従騎士の剣',   atk: 44, reach: 42, swing: 0.27 },
  { rank: 6,  name: '騎士の大剣',   atk: 56, reach: 48, swing: 0.30 },
  { rank: 7,  name: '隊長の戦斧',   atk: 70, reach: 46, swing: 0.31 },
  { rank: 8,  name: '団長の聖剣',   atk: 86, reach: 50, swing: 0.28 },
  { rank: 9,  name: '元帥の魔剣',   atk: 104, reach: 52, swing: 0.27 },
  { rank: 10, name: '大公の宝剣',   atk: 126, reach: 56, swing: 0.25 },
];

/* ===================== 必殺技（鎧の主要鉱石で決まる） ===================== */
const ULTIMATES = {
  whirl:  { name: '大回転斬り',   icon: '🌪️', color: '#c3ccd6', desc: '周囲をなぎ払う三連の旋風。' },
  flurry: { name: '神速連斬',     icon: '💨', color: '#8fe3ff', desc: '瞬時に敵の間を駆け抜けて斬りつける。' },
  holy:   { name: '聖光の柱',     icon: '🌟', color: '#ffd76a', desc: '天から光の柱を落とし、味方を癒やす。' },
  quake:  { name: '大地割り',     icon: '💥', color: '#71768f', desc: '地面を叩き割り、衝撃波で薙ぎ倒す。' },
  flame:  { name: '竜炎放射',     icon: '🔥', color: '#ff7a4d', desc: '前方に竜の吐息を撒き散らす。' },
  moon:   { name: '月光の刃',     icon: '🌙', color: '#e2e8ff', desc: '月の刃が舞い、自身のHPを回復する。' },
  void:   { name: '虚無爆裂',     icon: '🟣', color: '#a56bff', desc: '影が弾け、巻き込んだ敵の力を吸い取る。' },
};

/* ===================== 勢力 ===================== */
const FACTIONS = {
  player:  { id: 'player',  name: '自由軍',           color: '#4fb3ff', crest: '🛡️' },
  valcrest:{ id: 'valcrest',name: '鉄王国ヴァルクレスト', color: '#e0605a', crest: '👑' },
  greyfell:{ id: 'greyfell',name: '灰狼公国グレイフェル', color: '#9aa4b2', crest: '🐺' },
  obsidia: { id: 'obsidia', name: '黒晶教団オブシディア', color: '#a56bff', crest: '🔮' },
  neutral: { id: 'neutral', name: '独立勢力',          color: '#8b8578', crest: '🏘️' },
};

/* ===================== 領地 =====================
   x,y は地図上の位置（0〜1）。veins は掘れる鉱石。 */
const REGIONS = [
  { id: 'ashford',    name: 'アシュフォード', x: 0.14, y: 0.74, owner: 'player',   troops: 8,  def: 10, terr: 'plain',
    veins: { iron: 3 }, yield: { gold: 20, food: 16, wood: 8, stone: 4 }, desc: '南西の辺境。あなたが守るべき故郷。' },
  { id: 'thornwood',  name: 'ソーンウッド',   x: 0.28, y: 0.86, owner: 'neutral',  troops: 14, def: 12, terr: 'wood',
    veins: { iron: 2 }, yield: { gold: 14, food: 10, wood: 22, stone: 2 }, desc: '野盗の住み着いた深い森。良木が採れる。' },
  { id: 'rivermoss',  name: 'リヴァーモス',   x: 0.29, y: 0.61, owner: 'neutral',  troops: 16, def: 12, terr: 'water',
    veins: { iron: 2 }, yield: { gold: 22, food: 26, wood: 6, stone: 4 }, desc: '川沿いの豊かな穀倉地帯。' },
  { id: 'grimhill',   name: 'グリムヒル',     x: 0.14, y: 0.47, owner: 'greyfell', troops: 22, def: 18, terr: 'hill',
    veins: { iron: 4 }, yield: { gold: 18, food: 8, wood: 6, stone: 14 }, desc: '灰狼の斥候が睨みをきかせる丘陵。' },
  { id: 'irondale',   name: 'アイアンデール', x: 0.31, y: 0.38, owner: 'greyfell', troops: 28, def: 22, terr: 'rock',
    veins: { iron: 8, steel: 2 }, yield: { gold: 26, food: 6, wood: 4, stone: 16 }, desc: '大陸一の鉄鉱山を抱える工業地。' },
  { id: 'stoneguard', name: 'ストーンガード', x: 0.45, y: 0.75, owner: 'neutral',  troops: 20, def: 20, terr: 'rock',
    veins: { iron: 3 }, yield: { gold: 20, food: 8, wood: 4, stone: 26 }, desc: '巨石の切り出しで栄えた要塞都市。' },
  { id: 'whitemere',  name: 'ホワイトミア',   x: 0.45, y: 0.54, owner: 'neutral',  troops: 24, def: 16, terr: 'water',
    veins: { moon: 2 }, yield: { gold: 28, food: 22, wood: 8, stone: 6 }, desc: '澄んだ湖。夜になると月銀が浮かぶという。' },
  { id: 'silvervale', name: 'シルヴァーヴェイル', x: 0.44, y: 0.28, owner: 'greyfell', troops: 32, def: 24, terr: 'hill',
    veins: { mithril: 3, moon: 3 }, yield: { gold: 34, food: 10, wood: 8, stone: 12 }, desc: 'ミスリルと月銀を産む銀の谷。' },
  { id: 'northhold',  name: 'ノースホルド',   x: 0.32, y: 0.14, owner: 'greyfell', troops: 36, def: 30, terr: 'rock',
    veins: { adamant: 3, iron: 3 }, yield: { gold: 22, food: 4, wood: 4, stone: 20 }, desc: '凍てつく北の砦。アダマントの産地。' },
  { id: 'goldcrest',  name: 'ゴールドクレスト', x: 0.58, y: 0.65, owner: 'valcrest', troops: 34, def: 26, terr: 'plain',
    veins: { iron: 2, steel: 2 }, yield: { gold: 55, food: 22, wood: 10, stone: 10 }, desc: '大陸の交易の中心。金貨が唸る商都。' },
  { id: 'duskmarch',  name: 'ダスクマーチ',   x: 0.62, y: 0.86, owner: 'obsidia',  troops: 30, def: 22, terr: 'water',
    veins: { void: 3 }, yield: { gold: 24, food: 10, wood: 12, stone: 6 }, desc: '虚晶の沈む黒い湿地。教団の温床。' },
  { id: 'emberfell',  name: 'エンバーフェル', x: 0.73, y: 0.76, owner: 'obsidia',  troops: 34, def: 26, terr: 'rock',
    veins: { dragon: 2, iron: 4 }, yield: { gold: 26, food: 6, wood: 4, stone: 18 }, desc: '燻る火山地帯。竜鱗が拾える。' },
  { id: 'sunspire',   name: 'サンスパイア',   x: 0.61, y: 0.41, owner: 'valcrest', troops: 40, def: 30, terr: 'hill',
    veins: { orichal: 2, moon: 2 }, yield: { gold: 38, food: 12, wood: 6, stone: 14 }, desc: '古代神殿の尖塔。オリハルコンが眠る。' },
  { id: 'blackfang',  name: 'ブラックファング', x: 0.80, y: 0.55, owner: 'obsidia', troops: 44, def: 34, terr: 'rock',
    veins: { dragon: 4, void: 2 }, yield: { gold: 30, food: 6, wood: 4, stone: 16 }, desc: '古竜の巣。近づく者は帰らない。' },
  { id: 'valcrest',   name: 'ヴァルクレスト城', x: 0.72, y: 0.21, owner: 'valcrest', troops: 52, def: 42, terr: 'plain', capital: true,
    veins: { steel: 4, orichal: 2 }, yield: { gold: 60, food: 24, wood: 12, stone: 20 }, desc: '鉄王国の王城。玉座がここにある。' },
  { id: 'obsidia',    name: 'オブシディア',   x: 0.88, y: 0.36, owner: 'obsidia',  troops: 56, def: 44, terr: 'rock', capital: true,
    veins: { void: 5, orichal: 2 }, yield: { gold: 46, food: 8, wood: 4, stone: 18 }, desc: '黒晶教団の本殿。虚無の門が開く場所。' },
];
const REGION_BY_ID = {};
REGIONS.forEach((r) => { REGION_BY_ID[r.id] = r; });

const ROADS = [
  ['ashford', 'thornwood'], ['ashford', 'rivermoss'], ['ashford', 'grimhill'],
  ['thornwood', 'rivermoss'], ['thornwood', 'stoneguard'],
  ['rivermoss', 'grimhill'], ['rivermoss', 'whitemere'], ['rivermoss', 'stoneguard'],
  ['grimhill', 'irondale'],
  ['irondale', 'whitemere'], ['irondale', 'silvervale'],
  ['stoneguard', 'whitemere'], ['stoneguard', 'goldcrest'], ['stoneguard', 'duskmarch'],
  ['whitemere', 'goldcrest'], ['whitemere', 'sunspire'],
  ['silvervale', 'northhold'], ['silvervale', 'sunspire'], ['silvervale', 'valcrest'],
  ['northhold', 'valcrest'],
  ['goldcrest', 'sunspire'], ['goldcrest', 'duskmarch'], ['goldcrest', 'emberfell'],
  ['duskmarch', 'emberfell'],
  ['emberfell', 'blackfang'],
  ['sunspire', 'blackfang'], ['sunspire', 'valcrest'],
  ['blackfang', 'obsidia'], ['blackfang', 'valcrest'],
  ['valcrest', 'obsidia'],
];
const NEIGHBORS = {};
REGIONS.forEach((r) => { NEIGHBORS[r.id] = []; });
ROADS.forEach(([a, b]) => { NEIGHBORS[a].push(b); NEIGHBORS[b].push(a); });

/* ===================== 敵ユニット ===================== */
const FOES = {
  bandit:  { id: 'bandit',  name: '野盗',       color: '#8b7355', hp: 46,  atk: 8,  def: 4,  spd: 78,  reach: 26, kind: 'melee', valor: 5 },
  spear:   { id: 'spear',   name: '槍兵',       color: '#7e8ba0', hp: 62,  atk: 11, def: 8,  spd: 70,  reach: 46, kind: 'melee', valor: 7 },
  sword:   { id: 'sword',   name: '剣兵',       color: '#a8b0bd', hp: 72,  atk: 13, def: 10, spd: 80,  reach: 30, kind: 'melee', valor: 8 },
  shield:  { id: 'shield',  name: '盾兵',       color: '#6f7a8a', hp: 120, atk: 10, def: 22, spd: 58,  reach: 28, kind: 'melee', valor: 11, guard: 0.45 },
  archer:  { id: 'archer',  name: '弓兵',       color: '#6f8f5a', hp: 48,  atk: 12, def: 5,  spd: 74,  reach: 250, kind: 'ranged', valor: 10 },
  mage:    { id: 'mage',    name: '魔道士',     color: '#9a6bd0', hp: 44,  atk: 20, def: 4,  spd: 62,  reach: 230, kind: 'caster', valor: 14, magic: true },
  wolf:    { id: 'wolf',    name: '戦狼',       color: '#8d9099', hp: 54,  atk: 12, def: 6,  spd: 118, reach: 24, kind: 'melee', valor: 9 },
  beast:   { id: 'beast',   name: '獣人戦士',   color: '#94734a', hp: 105, atk: 18, def: 16, spd: 88,  reach: 34, kind: 'melee', valor: 15 },
  cultist: { id: 'cultist', name: '教団の狂信者', color: '#7d5aa8', hp: 66, atk: 16, def: 10, spd: 84, reach: 28, kind: 'melee', valor: 12 },
  drake:   { id: 'drake',   name: '竜人兵',     color: '#c65a3a', hp: 150, atk: 24, def: 26, spd: 76,  reach: 40, kind: 'melee', valor: 22, magic: true },
  knight:  { id: 'knight',  name: '王国騎士',   color: '#d0a860', hp: 145, atk: 22, def: 28, spd: 72,  reach: 40, kind: 'melee', valor: 20, guard: 0.35 },
};

/** 領地ごとの敵編成テーブル */
const FOE_TABLE = {
  neutral:  ['bandit', 'bandit', 'sword', 'archer', 'spear'],
  greyfell: ['wolf', 'wolf', 'beast', 'spear', 'archer', 'shield'],
  valcrest: ['sword', 'spear', 'shield', 'archer', 'knight', 'mage'],
  obsidia:  ['cultist', 'cultist', 'mage', 'archer', 'drake', 'shield'],
  player:   ['sword', 'spear', 'shield', 'archer'],
};

/** 指揮官 */
const CAPTAINS = {
  neutral:  { name: '野盗の頭目',       color: '#b08a4f', hp: 260, atk: 16, def: 12, spd: 78, reach: 40, valor: 40 },
  greyfell: { name: '灰狼の族長',       color: '#b8c0cc', hp: 460, atk: 24, def: 20, spd: 92, reach: 42, valor: 70 },
  valcrest: { name: '鉄王国の将',       color: '#e8b45a', hp: 600, atk: 28, def: 28, spd: 76, reach: 46, valor: 90 },
  obsidia:  { name: '黒晶の司祭',       color: '#c08cff', hp: 520, atk: 32, def: 20, spd: 72, reach: 210, valor: 95, magic: true, kind: 'caster' },
  player:   { name: '反徒の頭',         color: '#7fb3ff', hp: 380, atk: 20, def: 16, spd: 80, reach: 40, valor: 50 },
};

/* ===================== ターン・季節 ===================== */
const MONTH_NAMES = ['', '睦', '如', '陽', '芽', '花', '碧', '灼', '実', '穂', '紅', '霜', '凍'];
const SEASONS = [
  { id: 'spring', name: '春', months: [3, 4, 5],   food: 1.0,  color: '#8fbf6a', note: '種まきの季節' },
  { id: 'summer', name: '夏', months: [6, 7, 8],   food: 1.1,  color: '#e0c05a', note: '兵を鍛えるによし' },
  { id: 'autumn', name: '秋', months: [9, 10, 11], food: 1.7,  color: '#d98a4a', note: '収穫。食料が大きく増える' },
  { id: 'winter', name: '冬', months: [12, 1, 2],  food: 0.45, color: '#8fb8e0', note: '実りは細り、兵は多く喰う' },
];
function seasonOf(month) { return SEASONS.find((s) => s.months.includes(month)) || SEASONS[0]; }

/* ===================== 出来事 ===================== */
const EVENTS = [
  { id: 'harvest', w: 10, name: '豊作', icon: '🌾', text: '日照りにも霜にも当たらず、畑が実った。食料 +60',
    when: (g) => seasonOf(g.month).id === 'autumn', apply: (g) => { g.res.food += 60; } },
  { id: 'plague', w: 6, name: '流行り病', icon: '🤒', text: '村に熱病が広がった。兵 -3、民心 -6',
    apply: (g) => { g.troops = Math.max(0, g.troops - 3); g.loyalty -= 6; } },
  { id: 'merchant', w: 10, name: '行商人', icon: '🧳', text: '東方の行商人が鉱石を置いていった。鉄 +6、鋼 +2',
    apply: (g) => { g.ores.iron += 6; g.ores.steel += 2; } },
  { id: 'merc', w: 8, name: '傭兵の来訪', icon: '🗡️', text: '食い詰めた傭兵が加わった。兵 +4',
    apply: (g) => { g.troops += 4; } },
  { id: 'tax', w: 8, name: '豊かな年貢', icon: '💰', text: '領民が余剰を納めてきた。金貨 +90',
    apply: (g) => { g.res.gold += 90; } },
  { id: 'storm', w: 7, name: '嵐', icon: '🌧️', text: '嵐が屋根を吹き飛ばした。木材 -20、食料 -25',
    apply: (g) => { g.res.wood = Math.max(0, g.res.wood - 20); g.res.food = Math.max(0, g.res.food - 25); } },
  { id: 'vein', w: 7, name: '新しい鉱脈', icon: '⛰️', text: '坑道の奥で新しい層が見つかった。鉱石をまとめて獲得',
    apply: (g) => { const ids = minableOres(g); ids.forEach((o) => { g.ores[o] += 3; }); if (!ids.length) g.ores.iron += 5; } },
  { id: 'festival', w: 8, name: '収穫祭', icon: '🎪', text: '広場で祭りが開かれた。民心 +12、金貨 -40',
    apply: (g) => { g.loyalty += 12; g.res.gold = Math.max(0, g.res.gold - 40); } },
  { id: 'relic', w: 5, name: '遺物の発掘', icon: '🏺', text: '古い塚から装飾品が出てきた。装飾を1つ獲得',
    apply: (g) => { const d = pick(DECOR_IDS); g.decorStock[d] = (g.decorStock[d] || 0) + 1; } },
  { id: 'desert', w: 6, name: '脱走', icon: '🚶', text: '給金の遅れで兵が逃げた。兵 -4',
    when: (g) => g.loyalty < 45, apply: (g) => { g.troops = Math.max(0, g.troops - 4); } },
  { id: 'smith', w: 6, name: '流れの鍛冶師', icon: '⚒️', text: '腕利きの鍛冶師が立ち寄った。鋼 +5、ミスリル +2',
    apply: (g) => { g.ores.steel += 5; g.ores.mithril += 2; } },
];

/* ===================== あそびかたの下敷き ===================== */
const STARTER_TIP = [
  '① 城で「農場」を建てて食料を確保する',
  '② 「鍛冶場」を建てて鎧を打つ（4×4のパズル）',
  '③ 隣の領地に出陣して、自分の手で敵の指揮官を斬る',
  '④ 戦功が貯まると昇進して、率いる兵が増える',
];
