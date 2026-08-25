/* =========================================================================
   MECH RAIDERS ― データ定義
   機体 / 武器 / コア（特性）/ 敵 / ボス / セクター
   ========================================================================= */
'use strict';

/* ---------- 属性と装甲の相性 ----------
   縦: 弾の属性 / 横: 相手の装甲種別
   1.0 が等倍。0.7 以下は「不利」、1.25 以上は「有効」として表示する。      */
const ELEMENTS = {
  KIN: { id: 'KIN', name: '実弾',     color: '#ffd88a', icon: '◈' },
  THR: { id: 'THR', name: '熱',       color: '#ff9a5c', icon: '▲' },
  ENE: { id: 'ENE', name: 'エネルギー', color: '#7cf3ff', icon: '✦' },
  EMP: { id: 'EMP', name: '電磁',     color: '#c58cff', icon: '⚡' },
};

const ARMORS = {
  FRAME:  { id: 'FRAME',  name: '素体' },
  ARMOR:  { id: 'ARMOR',  name: '重装甲' },
  SHIELD: { id: 'SHIELD', name: 'シールド' },
  COMP:   { id: 'COMP',   name: '複合装甲' },
};

const AFFINITY = {
  KIN: { FRAME: 1.25, ARMOR: 0.75, SHIELD: 0.70, COMP: 1.00 },
  THR: { FRAME: 1.00, ARMOR: 1.35, SHIELD: 0.85, COMP: 0.90 },
  ENE: { FRAME: 0.90, ARMOR: 1.00, SHIELD: 1.10, COMP: 1.35 },
  EMP: { FRAME: 0.85, ARMOR: 0.90, SHIELD: 1.50, COMP: 1.00 },
};

function affinityOf(el, armor) {
  const row = AFFINITY[el];
  if (!row) return 1;
  return row[armor] != null ? row[armor] : 1;
}

/* ---------- レアリティ ---------- */
const RARITY = {
  N:   { id: 'N',   name: 'N',   color: '#8ea3b8', weight: 55, scrap: 40 },
  R:   { id: 'R',   name: 'R',   color: '#5fd0ff', weight: 30, scrap: 90 },
  SR:  { id: 'SR',  name: 'SR',  color: '#c58cff', weight: 12, scrap: 220 },
  SSR: { id: 'SSR', name: 'SSR', color: '#ffcf4a', weight: 3,  scrap: 600 },
};

/* =========================================================================
   機体（フレーム）
   hp/armorRed(被ダメ軽減)/speed/rollCd/hardpoint 数/必殺技/固有特性
   ========================================================================= */
const FRAMES = [
  {
    id: 'vanguard', name: 'RX-01 ヴァンガード', rarity: 'N', cls: '汎用',
    hp: 180, dr: 0.00, speed: 168, rollCd: 0.90, sp: 100,
    body: '#5b7fa8', trim: '#9fd4ff', accent: '#ffd166',
    special: 'burst_cannon',
    trait: 'tune_up',
    desc: '訓練校の標準機。癖がなく、どの武装でも扱える。整備性がよく再装填が早い。',
  },
  {
    id: 'bulwark', name: 'HG-22 ブルワーク', rarity: 'R', cls: '重装',
    hp: 290, dr: 0.20, speed: 132, rollCd: 1.25, sp: 110,
    body: '#6d6a5a', trim: '#c9c0a0', accent: '#ff7a3c',
    special: 'shield_burst',
    trait: 'reactive_plate',
    desc: '前線維持用の重装機。鈍いが硬い。増加装甲が衝撃を殺す。',
  },
  {
    id: 'sparrow', name: 'SV-07 スパロー', rarity: 'R', cls: '軽量',
    hp: 138, dr: -0.05, speed: 214, rollCd: 0.52, sp: 90,
    body: '#3f8f7a', trim: '#8effd2', accent: '#ffe98a',
    special: 'blade_rush',
    trait: 'inertia_cancel',
    desc: '偵察改造の軽量機。装甲を削って推力に回してある。回避で生き延びる機体。',
  },
  {
    id: 'artillery', name: 'AT-13 アーティラリー', rarity: 'SR', cls: '砲撃',
    hp: 205, dr: 0.05, speed: 142, rollCd: 1.05, sp: 120,
    body: '#7a6b8f', trim: '#d3bcff', accent: '#ffb04a',
    special: 'orbital',
    trait: 'fire_control',
    desc: '長射程支援機。射撃管制が優秀で、ロックした遠距離目標への火力が跳ね上がる。',
  },
  {
    id: 'tesla', name: 'EL-30 テスラ', rarity: 'SR', cls: '電磁',
    hp: 190, dr: 0.05, speed: 162, rollCd: 0.85, sp: 100,
    body: '#3a5f96', trim: '#9ad4ff', accent: '#c58cff',
    special: 'emp_nova',
    trait: 'charged_hull',
    desc: '電磁兵装の試験機。被弾のたびに外殻が放電し、寄ってきた敵を焼く。',
  },
  {
    id: 'inferno', name: 'BL-44 インフェルノ', rarity: 'SR', cls: '制圧',
    hp: 226, dr: 0.10, speed: 150, rollCd: 0.95, sp: 100,
    body: '#8f4436', trim: '#ffb08a', accent: '#ff5a2a',
    special: 'inferno_field',
    trait: 'overheat',
    desc: '焼却用に改造された制圧機。装甲が焼ける温度域でいちばん速く撃つ。',
  },
  {
    id: 'wraith', name: 'XN-88 レイス', rarity: 'SSR', cls: '隠密',
    hp: 162, dr: 0.00, speed: 196, rollCd: 0.60, sp: 90,
    body: '#2f3550', trim: '#8f9fd8', accent: '#5fffe0',
    special: 'phantom',
    trait: 'optic_camo',
    desc: '光学迷彩を積んだ試作隠密機。撃たれずにいる間だけ、異常な火力を出す。',
  },
  {
    id: 'titan', name: 'OM-99 タイタン', rarity: 'SSR', cls: '決戦',
    hp: 318, dr: 0.18, speed: 148, rollCd: 1.00, sp: 130,
    body: '#5a5f6e', trim: '#e6e9f2', accent: '#ffd23f',
    special: 'full_salvo',
    trait: 'self_repair',
    desc: '旧軍の決戦機。全ハードポイントを同時に開く「全弾発射」を持つ。',
  },
];

/* 必殺技の表示情報 */
const SPECIALS = {
  burst_cannon:  { name: 'バーストキャノン', line: '前方へ高出力弾を三連射。壁ごと薙ぐ。' },
  shield_burst:  { name: 'ブレイクシールド', line: '障壁を展開し、解除時に周囲を爆散させる。' },
  blade_rush:    { name: 'ブレードラッシュ', line: '高速で four 回斬り抜ける。無敵。' },
  orbital:       { name: '軌道砲撃',        line: '照準点へ多段の砲弾を落とす。' },
  emp_nova:      { name: 'EMPノヴァ',       line: '周囲へ電磁波。麻痺と連鎖電撃。' },
  inferno_field: { name: '焼却領域',        line: '足元に炎の海を作る。継続的に焼く。' },
  phantom:       { name: '幻影分身',        line: '分身二体が同じ武装で同時射撃する。' },
  full_salvo:    { name: '全弾発射',        line: '全ハードポイント斉射＋ミサイル雨。' },
};
SPECIALS.blade_rush.line = '高速で四回斬り抜ける。その間は無敵。';

/* =========================================================================
   特性（機体固有 + コア由来）
   hook で効果の適用箇所を示す。実処理は field.js 側。
   ========================================================================= */
const TRAITS = {
  tune_up:        { name: '整備完備',   line: '再装填 −18%' },
  reactive_plate: { name: '反応装甲',   line: '被ダメージ −12%（重装機の軽減に加算）' },
  inertia_cancel: { name: '慣性キャンセル', line: 'ローリングの再使用 −35%・回避距離 +15%' },
  fire_control:   { name: '火力管制',   line: '300px より遠い敵へのダメージ +25%' },
  charged_hull:   { name: '帯電装甲',   line: '被弾時、周囲へ電撃（電磁 18）' },
  overheat:       { name: '過熱',       line: 'HP 50% 以下で発射速度 +35%' },
  optic_camo:     { name: '光学迷彩',   line: '3 秒被弾しないとダメージ +45%・敵に見つかりにくい' },
  self_repair:    { name: '自己修復',   line: '毎秒 最大HP の 0.8% を回復' },

  vampiric:   { name: '吸血回路',   line: '与ダメージの 9% を回復' },
  twin_link:  { name: '二連装',     line: '弾数 +1・威力 −16%' },
  piercing:   { name: '貫通弾',     line: '弾が敵を 1 体貫通する' },
  ricochet:   { name: '跳弾',       line: '弾が壁で 1 回跳ね返る' },
  ext_mag:    { name: '弾倉拡張',   line: '装弾数 +50%' },
  coolant:    { name: '冷却強化',   line: '再装填 −30%' },
  overdrive:  { name: '過負荷',     line: '必殺ゲージの上昇 +55%' },
  detonator:  { name: '爆導索',     line: '敵撃破時に小爆発（熱 45）' },
  hardened:   { name: '硬化装甲',   line: '最大HP +25%' },
  thrust_wave:{ name: '緊急噴射',   line: 'ローリング中、通過した敵を吹き飛ばす' },
  seeker:     { name: '標的追尾',   line: '弾がロック目標へ緩く誘導する' },
  adrenaline: { name: '危機加速',   line: 'HP 30% 以下で速度 +30%・無敵時間 +60%' },
  scavenger:  { name: '回収機構',   line: '取得スクラップ +30%' },
  lastditch:  { name: '最終防壁',   line: '致命傷を 1 回だけ HP1 で耐える（1 出撃 1 回）' },
};

/* =========================================================================
   コア（OSチップ）: 特性を 1〜2 個持つ
   ========================================================================= */
const CORES = [
  { id: 'core_std',  name: 'STD 標準コア',   rarity: 'N',  traits: ['ext_mag'],                 desc: '量産型の管制チップ。弾倉制御だけは優秀。' },
  { id: 'core_cool', name: 'CL 冷却コア',    rarity: 'N',  traits: ['coolant'],                 desc: '排熱を最優先に組んである。' },
  { id: 'core_scav', name: 'SC 回収コア',    rarity: 'N',  traits: ['scavenger'],               desc: '残骸の選別が速い。戦果の実入りが増える。' },
  { id: 'core_pier', name: 'PR 貫通コア',    rarity: 'R',  traits: ['piercing'],                desc: '弾芯の硬度を上げる。' },
  { id: 'core_ric',  name: 'RC 跳弾コア',    rarity: 'R',  traits: ['ricochet'],                desc: '入射角を読み、壁を使わせる。' },
  { id: 'core_hard', name: 'HD 硬化コア',    rarity: 'R',  traits: ['hardened'],                desc: '外殻の分子配列を締める。' },
  { id: 'core_vamp', name: 'VP 吸血コア',    rarity: 'SR', traits: ['vampiric'],                desc: '敵の熱量を自機の修復に回す禁じ手。' },
  { id: 'core_twin', name: 'TW 二連装コア',  rarity: 'SR', traits: ['twin_link'],               desc: '一射で二発。反動は撃つ側が持つ。' },
  { id: 'core_over', name: 'OD 過負荷コア',  rarity: 'SR', traits: ['overdrive', 'detonator'],  desc: '炉心を回しきる。必殺の回転が速い。' },
  { id: 'core_seek', name: 'SK 追尾コア',    rarity: 'SR', traits: ['seeker'],                  desc: '弾に目をつける。' },
  { id: 'core_adr',  name: 'AD 危機コア',    rarity: 'SSR',traits: ['adrenaline', 'thrust_wave'], desc: '死にかけるほど動きが冴える。設計者は行方不明。' },
  { id: 'core_omni', name: 'OM 総合コア',    rarity: 'SSR',traits: ['lastditch', 'vampiric', 'coolant'], desc: '旧軍の最上位管制系。三つの機能を同時に回す。' },
];

/* =========================================================================
   武器
   kind: gun / shotgun / beam / lob / homing / melee / flame / chain
   dmg: 1 発（beam/flame は 1tick）/ rpm: 毎分発射数 / mag: 装弾数
   ========================================================================= */
const WEAPONS = [
  /* --- N --- */
  { id: 'ar12', name: 'AR-12 ライフル', rarity: 'N', kind: 'gun', el: 'KIN',
    dmg: 9, rpm: 460, mag: 30, reload: 1.5, spread: 2.6, bspeed: 640, range: 540, bsize: 3,
    desc: '訓練校からの相棒。数字は地味だが弾が素直に飛ぶ。' },
  { id: 'vp9', name: 'VP-9 マシンピストル', rarity: 'N', kind: 'gun', el: 'KIN',
    dmg: 5.4, rpm: 880, mag: 42, reload: 1.4, spread: 7.5, bspeed: 560, range: 400, bsize: 2.4,
    desc: '近距離をばらまくための小口径。' },
  { id: 'db8', name: 'DB-8 ショットガン', rarity: 'N', kind: 'shotgun', el: 'KIN',
    dmg: 6.5, pellets: 8, rpm: 95, mag: 6, reload: 2.1, spread: 12, bspeed: 520, range: 280, bsize: 2.8,
    desc: '至近距離でだけ意味を持つ。踏み込む勇気が要る。' },

  /* --- R --- */
  { id: 'lr70', name: 'LR-70 スナイパー', rarity: 'R', kind: 'gun', el: 'KIN',
    dmg: 60, rpm: 55, mag: 5, reload: 2.3, spread: 0.4, bspeed: 1500, range: 1000, bsize: 4, pierce: 1,
    desc: '一発の重さで押す。外すと長い沈黙が来る。' },
  { id: 'hv40', name: 'HV-40 ヘヴィMG', rarity: 'R', kind: 'gun', el: 'KIN',
    dmg: 8, rpm: 680, mag: 80, reload: 3.0, spread: 6, bspeed: 600, range: 480, bsize: 3,
    desc: '弾倉が深い。撃ち続けることが仕事。' },
  { id: 'gl4', name: 'GL-4 グレネード', rarity: 'R', kind: 'lob', el: 'THR',
    dmg: 42, splash: 92, rpm: 75, mag: 4, reload: 2.0, spread: 1.5, bspeed: 430, range: 520, bsize: 5,
    desc: '壁の裏へ放り込める。味方の位置は自分で見ること。' },
  { id: 'bz9', name: 'BZ-9 バズーカ', rarity: 'R', kind: 'gun', el: 'KIN',
    dmg: 58, splash: 84, rpm: 60, mag: 3, reload: 2.4, spread: 1.2, bspeed: 480, range: 620, bsize: 6,
    desc: '装甲板を面で剥がす。反動で足が止まる。' },
  { id: 'pl2', name: 'PL-2 レーザー', rarity: 'R', kind: 'beam', el: 'ENE',
    dmg: 3.4, rpm: 900, mag: 120, reload: 1.8, spread: 0, range: 460, beamw: 3,
    desc: '細い連続光。当て続けるほど溶ける。' },

  /* --- SR --- */
  { id: 'rgx', name: 'レールガン X', rarity: 'SR', kind: 'gun', el: 'ENE',
    dmg: 86, rpm: 42, mag: 4, reload: 2.6, spread: 0.2, bspeed: 1800, range: 1100, bsize: 4.5, pierce: 99, charge: 0.55,
    desc: '溜めてから一直線。並んだ敵はまとめて串刺しになる。' },
  { id: 'pc7', name: 'PC-7 プラズマ砲', rarity: 'SR', kind: 'gun', el: 'ENE',
    dmg: 34, splash: 62, rpm: 135, mag: 12, reload: 2.0, spread: 2, bspeed: 430, range: 560, bsize: 7,
    desc: '遅い光球。着弾で複合装甲を内側から抜く。' },
  { id: 'ms6', name: 'MS-6 追尾ミサイル', rarity: 'SR', kind: 'homing', el: 'KIN',
    dmg: 24, splash: 58, rpm: 240, mag: 12, reload: 2.4, spread: 9, bspeed: 300, range: 700, bsize: 4, turn: 3.4,
    desc: '曲がって追う。遮蔽の裏へ逃げた相手にも届く。' },
  { id: 'ft3', name: 'FT-3 火炎放射器', rarity: 'SR', kind: 'flame', el: 'THR',
    dmg: 3.2, rpm: 900, mag: 160, reload: 2.2, spread: 13, bspeed: 330, range: 210, bsize: 7, burn: 6,
    desc: '重装甲を炙り続けるための兵装。延焼が残る。' },
  { id: 'ta5', name: 'TA-5 テスラアーク', rarity: 'SR', kind: 'chain', el: 'EMP',
    dmg: 13, rpm: 260, mag: 40, reload: 2.0, range: 300, chain: 3, chainRange: 190,
    desc: '最初の一体から次へ、次へと飛ぶ。シールドには特効。' },

  /* --- SSR --- */
  { id: 'og12', name: 'OG-12 オービタルガトリング', rarity: 'SSR', kind: 'gun', el: 'KIN',
    dmg: 11, rpm: 1150, mag: 220, reload: 4.0, spread: 5.5, bspeed: 700, range: 560, bsize: 3.2, spinup: 0.45,
    desc: '回り切るまで少し待つ。回れば風景ごと削る。' },
  { id: 'jb0', name: 'JB-0 ジャベリンビーム', rarity: 'SSR', kind: 'beam', el: 'ENE',
    dmg: 9.5, rpm: 900, mag: 140, reload: 2.6, spread: 0, range: 720, beamw: 7, pierce: 99,
    desc: '太い一条。射線上のすべてを貫く。' },
  { id: 'hv0', name: 'HV-0 ハイヴスウォーム', rarity: 'SSR', kind: 'homing', el: 'KIN',
    dmg: 13, splash: 40, rpm: 420, mag: 36, reload: 3.0, spread: 26, bspeed: 260, range: 680, bsize: 3, turn: 5.0, volley: 3,
    desc: '小型弾を面で放つ。逃げ場が消える。' },
  { id: 'zb1', name: '零式ブレード', rarity: 'SSR', kind: 'melee', el: 'THR',
    dmg: 78, rpm: 130, mag: 0, reload: 0, range: 96, arc: 105, lunge: 190,
    desc: '踏み込んで薙ぐ。当たれば装甲の意味がなくなる。' },
];

/* =========================================================================
   敵アーキタイプ
   ========================================================================= */
const ENEMIES = {
  scout: {
    id: 'scout', name: '偵察機 WSP', armor: 'FRAME', hp: 46, speed: 168, radius: 15,
    body: '#7d8a5c', trim: '#c8dd8a', ai: 'rusher',
    sight: 460, hearing: 300, atkRange: 190, dps: { dmg: 4.0, rpm: 420, el: 'KIN', bspeed: 520, spread: 6 },
    scrap: 12, spGain: 5,
  },
  gunner: {
    id: 'gunner', name: '射撃機 GNR', armor: 'FRAME', hp: 74, speed: 118, radius: 17,
    body: '#6b7690', trim: '#b9c8e8', ai: 'strafer',
    sight: 520, hearing: 340, atkRange: 380, keep: 300, dps: { dmg: 7.2, rpm: 300, burst: 3, el: 'KIN', bspeed: 560, spread: 3.4 },
    scrap: 18, spGain: 7,
  },
  shielder: {
    id: 'shielder', name: '盾機 BWK', armor: 'SHIELD', hp: 170, speed: 82, radius: 21,
    body: '#8a7a52', trim: '#e2d29a', ai: 'advance', frontShield: 0.22,
    sight: 440, hearing: 300, atkRange: 240, dps: { dmg: 5.6, pellets: 5, rpm: 80, el: 'KIN', bspeed: 460, spread: 11 },
    scrap: 30, spGain: 12,
  },
  mortar: {
    id: 'mortar', name: '砲兵機 MTR', armor: 'ARMOR', hp: 110, speed: 70, radius: 20,
    body: '#7a5f4a', trim: '#d8b48a', ai: 'artillery',
    sight: 700, hearing: 400, atkRange: 640, keep: 520, lob: { dmg: 27.2, splash: 96, rpm: 34, el: 'THR', flight: 1.35 },
    scrap: 28, spGain: 12,
  },
  drone: {
    id: 'drone', name: '随伴ドローン', armor: 'FRAME', hp: 24, speed: 205, radius: 10,
    body: '#5c8a8a', trim: '#a8f0f0', ai: 'swarm', flying: true,
    sight: 520, hearing: 460, atkRange: 210, dps: { dmg: 3.2, rpm: 300, el: 'ENE', bspeed: 520, spread: 5 },
    scrap: 7, spGain: 3,
  },
  sniper: {
    id: 'sniper', name: '狙撃機 LNC', armor: 'FRAME', hp: 62, speed: 96, radius: 16,
    body: '#5a5a76', trim: '#b6a8e0', ai: 'sniper',
    sight: 900, hearing: 300, atkRange: 820, keep: 640, laser: { dmg: 32.0, charge: 1.4, el: 'ENE' },
    scrap: 26, spGain: 11,
  },
  mender: {
    id: 'mender', name: '修復機 MND', armor: 'COMP', hp: 90, speed: 122, radius: 17,
    body: '#4a7a5c', trim: '#9fe8b8', ai: 'mender',
    sight: 520, hearing: 380, atkRange: 260, heal: { amount: 16, rate: 1.4, range: 230 },
    dps: { dmg: 4.0, rpm: 200, el: 'ENE', bspeed: 480, spread: 5 },
    scrap: 32, spGain: 14,
  },
  bomber: {
    id: 'bomber', name: '自爆機 KMZ', armor: 'FRAME', hp: 40, speed: 190, radius: 15,
    body: '#8a4a4a', trim: '#ffb0a0', ai: 'bomber',
    sight: 520, hearing: 520, atkRange: 46, boom: { dmg: 41.6, splash: 118, el: 'THR' },
    scrap: 16, spGain: 8,
  },
  heavy: {
    id: 'heavy', name: '重装機 GRD', armor: 'ARMOR', hp: 240, speed: 92, radius: 24,
    body: '#6f6f6f', trim: '#c8c8c8', ai: 'strafer',
    sight: 520, hearing: 340, atkRange: 340, keep: 240, dps: { dmg: 9.6, rpm: 380, el: 'KIN', bspeed: 580, spread: 5.5 },
    scrap: 44, spGain: 18,
  },
  arcbot: {
    id: 'arcbot', name: '電磁機 ARC', armor: 'COMP', hp: 96, speed: 138, radius: 18,
    body: '#4a5a96', trim: '#a8c0ff', ai: 'strafer',
    sight: 500, hearing: 340, atkRange: 280, keep: 210, dps: { dmg: 11.2, rpm: 150, el: 'EMP', bspeed: 460, spread: 2, stun: 0.35 },
    scrap: 34, spGain: 14,
  },
};

/* =========================================================================
   ボス
   phases: HP 割合ごとの攻撃パターン
   ========================================================================= */
const BOSSES = {
  goliath: {
    id: 'goliath', name: 'GX‑01 ゴライアス', title: '固定砲台型', armor: 'ARMOR',
    hp: 2600, speed: 52, radius: 62, body: '#7a6a52', trim: '#ffd08a', scrap: 520, sight: 900,
    parts: [
      { id: 'legL', name: '左脚部', hp: 460, ox: -46, oy: 40, r: 20 },
      { id: 'legR', name: '右脚部', hp: 460, ox: 46, oy: 40, r: 20 },
    ],
    intro: '港湾の主砲を背負った鈍重な巨体。脚部を潰せば動きが止まる。',
    patterns: [
      { id: 'gatling', w: 3 }, { id: 'missile_rain', w: 2 }, { id: 'shockwave', w: 1 },
    ],
  },
  vesper: {
    id: 'vesper', name: 'AV‑07 ヴェスパー', title: '空戦型', armor: 'FRAME',
    hp: 2400, speed: 190, radius: 42, body: '#4a6a8a', trim: '#a8e8ff', scrap: 560, sight: 1000, flying: true,
    intro: '高度を取って旋回する空戦機。着地の瞬間だけが狙い目。',
    patterns: [
      { id: 'laser_sweep', w: 3 }, { id: 'drone_split', w: 2 }, { id: 'strafe_run', w: 3 },
    ],
  },
  chimera: {
    id: 'chimera', name: 'DH‑12 キマイラ', title: '双頭砲塔型', armor: 'COMP',
    hp: 3200, speed: 86, radius: 56, body: '#6a4a7a', trim: '#e0b8ff', scrap: 700, sight: 900,
    parts: [
      { id: 'turL', name: '左砲塔', hp: 600, ox: -52, oy: -26, r: 22 },
      { id: 'turR', name: '右砲塔', hp: 600, ox: 52, oy: -26, r: 22 },
    ],
    intro: '二基の砲塔が別々に動く。片方を落とすともう片方が荒れる。',
    patterns: [
      { id: 'twin_beam', w: 3 }, { id: 'spread_hell', w: 2 }, { id: 'charge_slam', w: 2 },
    ],
  },
  nova: {
    id: 'nova', name: 'EX‑00 ノヴァ', title: '実験機', armor: 'SHIELD',
    hp: 3400, speed: 158, radius: 44, body: '#3a4a7a', trim: '#9ad4ff', scrap: 820, sight: 1000,
    intro: '座標を跳ぶ試作機。EMP場を張り、こちらの再装填を殺しにくる。',
    patterns: [
      { id: 'warp_dash', w: 3 }, { id: 'ring_barrage', w: 3 }, { id: 'emp_field', w: 2 },
    ],
  },
  omega: {
    id: 'omega', name: 'ΩL レギオン', title: '最終決戦機', armor: 'ARMOR',
    hp: 5200, speed: 120, radius: 72, body: '#5a3a3a', trim: '#ffcf4a', scrap: 1600, sight: 1200,
    parts: [
      { id: 'podL', name: '左ポッド', hp: 760, ox: -64, oy: -8, r: 26 },
      { id: 'podR', name: '右ポッド', hp: 760, ox: 64, oy: -8, r: 26 },
    ],
    intro: '旧軍が最後に置いていった指揮機。三段構えで戦域を焼く。',
    patterns: [
      { id: 'orbital_strike', w: 3 }, { id: 'summon', w: 2 }, { id: 'mirror', w: 2 },
      { id: 'ring_barrage', w: 2 }, { id: 'gatling', w: 2 },
    ],
  },
};

/* =========================================================================
   セクター（ステージ）
   目標は 2〜3 種を組み合わせる。最後にボスゲートが開く。
   ========================================================================= */
const SECTORS = [
  {
    id: 's1', no: 1, name: '廃棄港湾', sub: 'SCRAP HARBOR', lv: 1,
    size: 2400, theme: 'harbor', tickets: 3, scrapBonus: 120,
    pool: [['scout', 5], ['gunner', 4], ['drone', 3]],
    count: 16, objectives: ['kill_all'],
    boss: null,
    brief: '放棄されたコンテナ港。旧軍の残置機が徘徊している。まずは全機撃破。',
  },
  {
    id: 's2', no: 2, name: '砂塵基地', sub: 'DUST BASE', lv: 2,
    size: 2800, theme: 'desert', tickets: 4, scrapBonus: 200,
    pool: [['scout', 4], ['gunner', 5], ['shielder', 3], ['mortar', 2], ['drone', 3]],
    count: 20, objectives: ['towers', 'kill_all'], towers: 3,
    boss: 'goliath',
    brief: '通信塔 3 基を潰してから、港湾の主砲を背負った巨体を落とす。',
  },
  {
    id: 's3', no: 3, name: '断層渓谷', sub: 'RIFT CANYON', lv: 3,
    size: 3000, theme: 'canyon', tickets: 4, scrapBonus: 260,
    pool: [['gunner', 4], ['sniper', 3], ['bomber', 4], ['shielder', 3], ['mender', 2], ['drone', 4]],
    count: 22, objectives: ['crates', 'kill_all'], crates: 3,
    boss: 'vesper',
    brief: '狙撃機が高所を取っている。補給コンテナ 3 基を確保して空戦機を迎え撃つ。',
  },
  {
    id: 's4', no: 4, name: '凍結工廠', sub: 'FROZEN FOUNDRY', lv: 4,
    size: 3200, theme: 'foundry', tickets: 5, scrapBonus: 340,
    pool: [['heavy', 4], ['shielder', 4], ['mortar', 3], ['mender', 3], ['gunner', 4], ['arcbot', 3]],
    count: 24, objectives: ['commander', 'kill_all'],
    boss: 'chimera',
    brief: '停止した工廠に重装機が詰まっている。指揮官機を落とすと隔壁が開く。',
  },
  {
    id: 's5', no: 5, name: '電磁都市', sub: 'STATIC CITY', lv: 5,
    size: 3400, theme: 'city', tickets: 5, scrapBonus: 420,
    pool: [['arcbot', 5], ['sniper', 4], ['drone', 6], ['heavy', 3], ['mender', 3], ['bomber', 4]],
    count: 26, objectives: ['towers', 'kill_all'], towers: 4,
    boss: 'nova',
    brief: '街ごと電磁場に沈んでいる。中継塔 4 基を落とせば試作機が出てくる。',
  },
  {
    id: 's6', no: 6, name: '軌道昇降機', sub: 'ORBITAL LIFT', lv: 6,
    size: 3600, theme: 'orbital', tickets: 8, scrapBonus: 700,
    pool: [['heavy', 5], ['arcbot', 5], ['sniper', 4], ['mender', 4], ['shielder', 4], ['mortar', 4], ['bomber', 4]],
    count: 30, objectives: ['commander', 'crates', 'kill_all'], crates: 2,
    boss: 'omega',
    brief: '軌道へ伸びる昇降機の基部。旧軍の指揮機がここで待っている。',
  },
];

/* ---------- 目標のラベル ---------- */
const OBJ_LABEL = {
  kill_all:  (s, t) => `敵性機体を撃破 ${s}/${t}`,
  towers:    (s, t) => `通信塔を破壊 ${s}/${t}`,
  crates:    (s, t) => `補給コンテナを確保 ${s}/${t}`,
  commander: (s, t) => `指揮官機を撃破 ${s}/${t}`,
  boss:      (s, t) => `敵ボス機を撃破 ${s}/${t}`,
};

/* ---------- 検索ヘルパ ---------- */
const byId = (arr, id) => arr.find((x) => x.id === id) || null;
const getFrame  = (id) => byId(FRAMES, id);
const getWeapon = (id) => byId(WEAPONS, id);
const getCore   = (id) => byId(CORES, id);
const getSector = (id) => byId(SECTORS, id);

window.MRData = {
  ELEMENTS, ARMORS, AFFINITY, affinityOf, RARITY,
  FRAMES, SPECIALS, TRAITS, CORES, WEAPONS, ENEMIES, BOSSES, SECTORS, OBJ_LABEL,
  getFrame, getWeapon, getCore, getSector,
};
