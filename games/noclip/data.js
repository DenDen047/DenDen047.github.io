/* =========================================================================
   NOCLIP ― データ定義
   スキン・ツルハシ・ステージ・実体・エモートの静的テーブル。
   描画側は「見た目パラメータ」だけを読み、当たり判定側は数値だけを読む。
   ========================================================================= */

/* ---------- レアリティ ---------- */
const RARITY = {
  common: { label: 'コモン',     color: '#9aa7b6' },
  rare:   { label: 'レア',       color: '#4fb2ff' },
  epic:   { label: 'エピック',   color: '#b07cff' },
  legend: { label: 'レジェンド', color: '#ffce4a' },
  event:  { label: '限定',       color: '#ff8a1e' },
};

/* =========================================================================
   ツルハシ
   power   : 壊せる硬さ（1回の振りで削るタイル HP）
   cd      : 振りの間隔 [ms]
   reach   : 届く距離 [px]（タイル = 40px）
   dmg     : 実体へのダメージ
   noise   : 振ったときの音の届く半径 [タイル]
   ========================================================================= */
const PICKS = {
  pick_std: {
    name: '作業用ツルハシ', power: 1, cd: 520, reach: 46, dmg: 22, noise: 9,
    head: '#b9c2cc', headDark: '#6f7883', haft: '#7a5a34',
    trail: 'rgba(200,220,255,0.55)', spark: '#dfe8f5',
    note: 'どこにでもある鉄のツルハシ。可もなく不可もなく。',
  },
  pick_heavy: {
    name: '補修用スレッジピック', power: 2, cd: 780, reach: 52, dmg: 38, noise: 13,
    head: '#e0a349', headDark: '#8a5f22', haft: '#4d4438',
    trail: 'rgba(255,190,90,0.55)', spark: '#ffd08a',
    note: '重い。ひと振りで壁を二枚ぶん削るが、音も倍。',
  },
  pick_light: {
    name: '軽量ピック', power: 1, cd: 320, reach: 42, dmg: 14, noise: 6,
    head: '#cfe6d6', headDark: '#78998a', haft: '#c9b98f',
    trail: 'rgba(190,255,220,0.5)', spark: '#dbfff0',
    note: '配達人の道具。速く、そして静か。',
  },
  pick_lamp: {
    name: '燭台ピック', power: 1, cd: 520, reach: 46, dmg: 20, noise: 9,
    head: '#e8d79a', headDark: '#8d7a3e', haft: '#3a2a20',
    trail: 'rgba(255,236,170,0.6)', spark: '#fff0b8',
    lightRange: 110, lightFov: 0.22,
    note: '柄の先に灯が入っている。光が遠くまで届く。',
  },
  pick_bone: {
    name: '骨のピック', power: 1, cd: 480, reach: 50, dmg: 46, noise: 10,
    head: '#e9e3d2', headDark: '#8f8878', haft: '#6b6154',
    trail: 'rgba(255,240,220,0.5)', spark: '#fff6e6',
    note: '壁にはあまり効かない。生きているものにはよく効く。',
  },
  pick_silent: {
    name: '静寂のピック', power: 2, cd: 560, reach: 46, dmg: 26, noise: 1,
    head: '#3f4650', headDark: '#20242b', haft: '#191c22',
    trail: 'rgba(120,140,170,0.35)', spark: '#8fa2bd',
    note: 'これで壁を割っても、ほとんど音がしない。',
  },
  pick_jack: {
    name: 'ジャック・オ・ピック', power: 3, cd: 420, reach: 56, dmg: 55, noise: 7,
    head: '#ff8a1e', headDark: '#a3480a', haft: '#2a1436',
    trail: 'rgba(125,255,74,0.6)', spark: '#7dff4a',
    ember: true, fear: { radius: 5.2, time: 1.6 },
    note: 'ひと振りごとに緑の煙が噴く。煙を浴びた実体はしばらく怯む。',
  },
};

/* =========================================================================
   スキン
   look : 手続き描画のためのパラメータ（render.js が読む）
   perk : ゲーム側の補正
   ========================================================================= */
const SKINS = [
  {
    id: 'surveyor', name: '調査員', rarity: 'common', pick: 'pick_std',
    desc: '最初にここへ落ちた者。作業着とヘルメット、そして支給品のツルハシだけ。',
    perkText: '補正なし',
    unlock: { type: 'default' },
    look: {
      coat: '#40628f', coatDark: '#2a4363', trim: '#d7b45a',
      skin: '#e8bd96', head: 'human', eye: '#1c1c22', eyeGlow: null,
      hat: 'helmet', hatColor: '#dcb63a', hatDark: '#8f7418', smoke: null,
    },
  },
  {
    id: 'maintenance', name: '保守作業員', rarity: 'common', pick: 'pick_heavy',
    desc: '照明を替えて回っていた男。誰に頼まれたのかは、もう思い出せない。',
    perkText: '最大 HP +20',
    perk: { hp: 20 },
    unlock: { type: 'stage', stage: 'lv1' },
    look: {
      coat: '#c8791f', coatDark: '#8a4d0d', trim: '#f0e2c0',
      skin: '#d8a97e', head: 'human', eye: '#221c16', eyeGlow: null,
      hat: 'helmet', hatColor: '#f2f2ee', hatDark: '#a8a8a0', smoke: null,
    },
  },
  {
    id: 'courier', name: 'アーモンド配達人', rarity: 'rare', pick: 'pick_light',
    desc: '水を運んでいた。中身が何だったのかは、飲んだ本人にも分からない。',
    perkText: 'スタミナ回復 +60% ／ 移動 +6%',
    perk: { stamRegen: 1.6, speed: 1.06 },
    unlock: { type: 'stage', stage: 'lv2' },
    look: {
      coat: '#cfc3a0', coatDark: '#8e8464', trim: '#5c8f6a',
      skin: '#e0b892', head: 'human', eye: '#2a2a30', eyeGlow: null,
      hat: 'hood', hatColor: '#b7ab88', hatDark: '#6e6650', smoke: null,
    },
  },
  {
    id: 'host', name: '館の主', rarity: 'epic', pick: 'pick_lamp',
    desc: '霧見邸の主人。館ごと壁の裏へ入り込み、いまも客を待っている。',
    perkText: '懐中電灯の消費 -35%',
    perk: { batDrain: 0.65 },
    unlock: { type: 'stage', stage: 'manor' },
    look: {
      coat: '#5f2436', coatDark: '#3a1220', trim: '#d8c98a',
      skin: '#dcc3ad', head: 'human', eye: '#241016', eyeGlow: null,
      hat: 'top', hatColor: '#241018', hatDark: '#140a0e', smoke: null,
    },
  },
  {
    id: 'hollowed', name: '抜け殻', rarity: 'epic', pick: 'pick_bone',
    desc: '納骨堂で見つかった。体はあるが、名前を書く欄がどこにもない。',
    perkText: '移動 +14% ／ 最大 HP -20',
    perk: { speed: 1.14, hp: -20 },
    unlock: { type: 'stage', stage: 'crypt' },
    look: {
      coat: '#3a4046', coatDark: '#22262b', trim: '#7d8892',
      skin: '#cfd3cd', head: 'human', eye: '#0a0a0c', eyeGlow: null,
      hat: 'none', hatColor: '#000', hatDark: '#000', smoke: null,
    },
  },
  {
    id: 'silentone', name: '無音のもの', rarity: 'legend', pick: 'pick_silent',
    desc: '終端で崩れた天井の下から歩いて出てきた。足音がまったくしない。',
    perkText: '足音・ダッシュ音が消える',
    perk: { silentSteps: true },
    unlock: { type: 'stage', stage: 'end' },
    look: {
      coat: '#161a20', coatDark: '#0b0d11', trim: '#39414d',
      skin: '#20242b', head: 'blank', eye: '#5f6b7d', eyeGlow: '#5f6b7d',
      hat: 'none', hatColor: '#000', hatDark: '#000', smoke: null,
    },
  },
  {
    id: 'jack', name: 'ジャック・オ・ランタン', rarity: 'event', pick: 'pick_jack',
    desc: '十月の終わりにだけ壁の内側から出てくる。カボチャの口から緑の煙をこぼしながら、魔女の帽子を目深にかぶっている。',
    perkText: '緑の煙で実体が怯む ／ 受けるダメージ -15%',
    perk: { dmgTaken: 0.85 },
    unlock: { type: 'event', event: 'halloween', text: 'ハロウィン期間（10/25〜11/1）にログインすると入手' },
    look: {
      coat: '#2a1436', coatDark: '#160a1e', trim: '#ff8a1e',
      skin: '#ff8a1e', head: 'pumpkin', eye: '#7dff4a', eyeGlow: '#7dff4a',
      hat: 'witch', hatColor: '#2a1436', hatDark: '#160a1e', hatBand: '#7dff4a',
      smoke: '#7dff4a',
    },
  },
];

const SKIN_BY_ID = Object.fromEntries(SKINS.map(s => [s.id, s]));

/* =========================================================================
   実体（バックルームズのエンティティ）
   ========================================================================= */
const ENTS = {
  smiler: {
    name: 'スマイラー', hp: 70, dmg: 14, speed: 62, radius: 15,
    sense: { sight: 12, hear: 14 },
    body: '#0d0f12', glow: '#f5f2d8',
    behavior: 'lurk',   // 光を当てているあいだだけ実体化して殴れる
    note: '暗闇に笑顔だけが浮かぶ。光の中では動きが鈍る。',
  },
  hound: {
    name: 'ハウンド', hp: 90, dmg: 20, speed: 108, radius: 16,
    sense: { sight: 6, hear: 22 },
    body: '#4a2a22', glow: '#ff6a4a',
    behavior: 'hunt',   // 光を無視して音で追う。速い
    note: '目が退化している。音だけを頼りに、まっすぐ走ってくる。',
  },
  crawler: {
    name: 'クラウラー', hp: 45, dmg: 10, speed: 74, radius: 12,
    sense: { sight: 0, hear: 17 },
    body: '#6b6350', glow: '#c9bd8e',
    behavior: 'hunt',
    note: '床を這う。目は無い。',
  },
  partygoer: {
    name: 'パーティーゴア', hp: 28, dmg: 8, speed: 92, radius: 11,
    sense: { sight: 10, hear: 12 },
    body: '#8c2f52', glow: '#ff8fb4',
    behavior: 'swarm',  // 群れる。低 HP で逃げる
    note: '数で来る。一匹ずつは弱い。',
  },
  skinstealer: {
    name: 'スキンステイラー', hp: 140, dmg: 26, speed: 76, radius: 17,
    sense: { sight: 14, hear: 16 },
    body: '#cbb6a2', glow: '#ffe3c9',
    behavior: 'mimic',  // プレイヤーのスキンの色を真似る
    note: 'あなたの服の色を真似る。近づくまで見分けがつかない。',
  },
  silence: {
    name: '無音のもの', hp: 99999, dmg: 42, speed: 58, radius: 30,
    sense: { sight: 40, hear: 40 },
    body: '#0a0c10', glow: '#7f8ea6',
    behavior: 'boss',
    note: '殴っても効かない。支柱を折って天井を落とすしかない。',
  },
};

/* =========================================================================
   ステージ
   ========================================================================= */
const STAGES = [
  {
    id: 'lv0', no: 'LEVEL 0', name: '無限の黄色い部屋',
    kind: 'backrooms', size: 50, keys: 3, seed: 1077,
    tag: '導入', diff: 1, timeGoal: 150,
    blurb: '濡れた壁紙と、ひとつも消えない蛍光灯。仕切りは薄く、たいてい掘れる。',
    pal: {
      floor: '#8d7b3b', floor2: '#7f6e33', wall: '#dcc76c', wallTop: '#f4e7ae',
      crack: '#a98f40', ink: '#3f3512', fog: '#0e0c05',
    },
    lamps: { grid: 6, flicker: 0.35, color: '#fff6c8' },
    ents: [['smiler', 5]],
  },
  {
    id: 'lv1', no: 'LEVEL 1', name: '終わりのない駐車場',
    kind: 'backrooms', size: 58, keys: 4, seed: 2231,
    tag: '広い', diff: 2, timeGoal: 210,
    blurb: '柱と白線だけが続く。遠くで何かが走る音がするが、姿は見えない。',
    pal: {
      floor: '#32353a', floor2: '#2c2f34', wall: '#757a83', wallTop: '#9ba1ac',
      crack: '#4f535b', ink: '#191c22', fog: '#07080a',
    },
    lamps: { grid: 8, flicker: 0.55, color: '#cfe4ff' },
    ents: [['smiler', 3], ['hound', 3]],
  },
  {
    id: 'lv2', no: 'LEVEL 2', name: '配管地獄',
    kind: 'pipes', size: 55, keys: 4, seed: 3319,
    tag: '狭路', diff: 3, timeGoal: 230,
    blurb: '肩幅の通路が延々と折れ曲がる。行き止まりの壁は、たいてい薄い。',
    pal: {
      floor: '#3d3024', floor2: '#36291e', wall: '#7d5c3c', wallTop: '#a37f56',
      crack: '#5d4529', ink: '#17110b', fog: '#0a0705',
    },
    lamps: { grid: 10, flicker: 0.8, color: '#ffb46a' },
    ents: [['crawler', 4], ['partygoer', 5]],
  },
  {
    id: 'manor', no: 'MANOR', name: '霧見邸',
    kind: 'manor', size: 56, keys: 4, seed: 4417,
    tag: '洋館', diff: 4, timeGoal: 250,
    blurb: '壁紙も家具も揃っている。ただし扉のほとんどに鍵が掛かっている。',
    pal: {
      floor: '#352723', floor2: '#2e211d', wall: '#734f42', wallTop: '#9a6e5d',
      crack: '#553a30', ink: '#160f0d', fog: '#080605',
    },
    lamps: { grid: 11, flicker: 0.5, color: '#ffcf8a' },
    ents: [['skinstealer', 3], ['smiler', 4], ['partygoer', 4]],
  },
  {
    id: 'crypt', no: 'BASEMENT', name: '納骨堂',
    kind: 'crypt', size: 58, keys: 5, seed: 5507,
    tag: '掘削', diff: 5, timeGoal: 280,
    blurb: '石を積んだだけの壁が多い。掘れる場所は多いが、掘る音も反響する。',
    pal: {
      floor: '#2e2e35', floor2: '#27272e', wall: '#666472', wallTop: '#8a8898',
      crack: '#4a4854', ink: '#131318', fog: '#050508',
    },
    lamps: { grid: 13, flicker: 0.9, color: '#a9c8ff' },
    ents: [['hound', 4], ['crawler', 5], ['skinstealer', 2]],
  },
  {
    id: 'end', no: 'LEVEL !', name: '終端',
    kind: 'boss', size: 44, keys: 0, pillars: 4, seed: 6607,
    tag: 'ボス', diff: 6, timeGoal: 200,
    blurb: '天井を支えているのは四本の柱だけ。折れば、あれの上に落ちる。',
    pal: {
      floor: '#26202c', floor2: '#201a26', wall: '#4b3f56', wallTop: '#6b5a78',
      crack: '#3a3044', ink: '#100c15', fog: '#030204',
    },
    lamps: { grid: 12, flicker: 0.95, color: '#b08aff' },
    ents: [['partygoer', 6], ['hound', 2]],
  },
];

const STAGE_BY_ID = Object.fromEntries(STAGES.map(s => [s.id, s]));

/* =========================================================================
   エモート
   noise : 音の届く半径 [タイル]。口笛がいちばん遠い＝おとりに使える
   ========================================================================= */
const EMOTES = [
  { id: 'hello',   emoji: '👋', label: 'あいさつ',   noise: 6,  sound: 'chirp'  },
  { id: 'whistle', emoji: '🎵', label: '口笛',       noise: 26, sound: 'whistle' },
  { id: 'scream',  emoji: '😱', label: '悲鳴',       noise: 20, sound: 'scream' },
  { id: 'laugh',   emoji: '😂', label: '笑い',       noise: 14, sound: 'laugh'  },
  { id: 'heart',   emoji: '❤️', label: 'ありがとう', noise: 3,  sound: 'chime'  },
  { id: 'skull',   emoji: '💀', label: 'だめだ',     noise: 5,  sound: 'rattle' },
  { id: 'pumpkin', emoji: '🎃', label: 'ハロウィン', noise: 9,  sound: 'spooky' },
  { id: 'ok',      emoji: '👍', label: 'よし',       noise: 4,  sound: 'pop'    },
];

/* =========================================================================
   タイル
   ========================================================================= */
const T = {
  VOID: 0, FLOOR: 1, WALL: 2, CRACK: 3, DOOR: 4, OPEN: 5,
  EXIT: 6, PILLAR: 7, RUBBLE: 8, DECO: 9,
};
const TILE = 40;                                  // 1 タイルの辺 [px]
const SOLID = new Set([T.WALL, T.CRACK, T.DOOR, T.PILLAR, T.DECO]);
const BREAKABLE = { [T.CRACK]: 3, [T.DOOR]: 5, [T.PILLAR]: 8 };
const OPAQUE = new Set([T.WALL, T.CRACK, T.DOOR, T.PILLAR, T.DECO]);
