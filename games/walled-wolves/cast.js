/* =========================================================================
   WALLED WOLVES ― 住民名簿と役職の定義
   壁の中の街に暮らす24人。ひとりずつ髪・服・帽子・体格が違い、
   狼に変わったときの毛色も個体ごとに決まっている。
   ========================================================================= */

/* ---------- 役職 ---------- */
const ROLES = {
  wolf: {
    key: 'wolf',
    name: '人狼',
    team: 'wolf',
    icon: '🐺',
    color: '#e0455e',
    card: '牙の札',
    short: '夜、狼に変わって家を襲う',
    desc:
      '夜が更けると獣の姿に変わり、誰かの家に押し入って住人を噛み殺す。' +
      '街が寝静まるまで牙は使えない。昼は住民のふりをして、自分に票が集まらないよう議論を誘導する。' +
      '仲間の狼がいれば夜の街で互いを見分けられる。',
    night: '獲物の家に押し入る',
  },
  seer: {
    key: 'seer',
    name: '占い師',
    team: 'village',
    icon: '🔮',
    color: '#7ad7ff',
    card: '眼の札',
    short: '夜、他人の家を覗いて正体を見る',
    desc:
      '夜のうちに誰かの家へ忍び寄り、窓から中を覗いて正体を見抜く。' +
      '結果は強力だが、名乗り出た瞬間に狼の標的になる。' +
      '外を出歩くぶん、狼と鉢合わせる危険もある。',
    night: '誰かの家を覗く',
  },
  knight: {
    key: 'knight',
    name: '騎士',
    team: 'village',
    icon: '🛡',
    color: '#ffd166',
    card: '盾の札',
    short: '夜、誰かの家の前で見張る',
    desc:
      '夜のあいだ、選んだ家の玄関先に立って見張る。' +
      'その家が襲われたら狼を追い返せる。ただし守れるのは一軒だけ。' +
      '自分の家は空になるので、自分自身は守れない。',
    night: '誰かの家を守る',
  },
  villager: {
    key: 'villager',
    name: '市民',
    team: 'village',
    icon: '🏠',
    color: '#8fe3a8',
    card: '灯の札',
    short: '夜は自分の家で寝るか隠れる',
    desc:
      '特別な力は持たない。昼のうちに街の仕事を片づけ、' +
      '夜は自分の家で眠る。物置に隠れれば牙を一度だけかわせるが、それはゲームを通して一度きり。' +
      '隠れた夜は「何も見ていない」と言うほかなくなる。',
    night: '自分の家で夜を越す',
  },
};

const ROLE_ORDER = ['wolf', 'seer', 'knight', 'villager'];

/* ---------- 性格（AIの振る舞いと口調） ---------- */
const TRAITS = {
  bold:    { name: '直情', talk: 1.25, suspicion: 1.15, follow: 0.75, hide: 0.15 },
  calm:    { name: '沈着', talk: 0.95, suspicion: 0.85, follow: 0.85, hide: 0.45 },
  timid:   { name: '臆病', talk: 0.65, suspicion: 1.05, follow: 1.30, hide: 0.85 },
  logical: { name: '論理', talk: 1.10, suspicion: 0.80, follow: 0.60, hide: 0.40 },
  loud:    { name: '扇動', talk: 1.40, suspicion: 1.30, follow: 0.70, hide: 0.20 },
  quiet:   { name: '寡黙', talk: 0.45, suspicion: 0.95, follow: 1.10, hide: 0.70 },
  kind:    { name: '温厚', talk: 1.00, suspicion: 0.70, follow: 1.05, hide: 0.55 },
  sly:     { name: '狡猾', talk: 1.05, suspicion: 1.00, follow: 0.65, hide: 0.35 },
};

/* ---------- 住民24人 ----------
   build   体格倍率（0.88〜1.14）
   hairStyle  short / long / bun / braid / curly / pony / messy / bald
   outfit  tunic / robe / apron / armor / coat / dress / cloak
   hat     none / cap / hood / helm / bandana / hat / circlet / kerchief
   fur/furDark 狼になったときの毛色
--------------------------------------------------------------------------- */
const CAST = [
  {
    id: 'raul', name: 'ラウル', job: '鍛冶屋', trait: 'bold',
    build: 1.12, skin: '#dfa877', hair: '#33241a', hairStyle: 'short',
    cloth: '#8a4a26', cloth2: '#4a3020', outfit: 'apron', hat: 'bandana',
    accent: '#d8a52c', eye: '#4a2f1c', fur: '#5a4232', furDark: '#31241a',
  },
  {
    id: 'mira', name: 'ミラ', job: 'パン職人', trait: 'kind',
    build: 0.96, skin: '#f0cba4', hair: '#c8853f', hairStyle: 'bun',
    cloth: '#e8ddc8', cloth2: '#9a6a44', outfit: 'apron', hat: 'kerchief',
    accent: '#c94f5e', eye: '#5a4028', fur: '#a4712f', furDark: '#5f3f1c',
  },
  {
    id: 'jonas', name: 'ヨナス', job: '門番', trait: 'calm',
    build: 1.10, skin: '#cf9a6e', hair: '#1f1a16', hairStyle: 'short',
    cloth: '#4a5568', cloth2: '#2c3242', outfit: 'armor', hat: 'helm',
    accent: '#9fb2cc', eye: '#3a3a3a', fur: '#3c3f4a', furDark: '#21242c',
  },
  {
    id: 'elfi', name: 'エルフィ', job: '薬師', trait: 'logical',
    build: 0.92, skin: '#f3d7bb', hair: '#8e6fc0', hairStyle: 'long',
    cloth: '#5d4a8c', cloth2: '#3a2f5c', outfit: 'robe', hat: 'hood',
    accent: '#c3a8ff', eye: '#5b3f8a', fur: '#6a5a8c', furDark: '#3b3155',
  },
  {
    id: 'brant', name: 'ブラント', job: '猟師', trait: 'quiet',
    build: 1.06, skin: '#c98f62', hair: '#4a3a24', hairStyle: 'messy',
    cloth: '#5c6a3a', cloth2: '#3a4224', outfit: 'coat', hat: 'hood',
    accent: '#8a9a54', eye: '#3f3222', fur: '#4e4a2e', furDark: '#2c2a18',
  },
  {
    id: 'nina', name: 'ニーナ', job: '花売り', trait: 'timid',
    build: 0.88, skin: '#f7ddc6', hair: '#e8c05a', hairStyle: 'braid',
    cloth: '#e88aa8', cloth2: '#c05a7a', outfit: 'dress', hat: 'none',
    accent: '#ffe08a', eye: '#6a8a4a', fur: '#c9a45e', furDark: '#7a6030',
  },
  {
    id: 'oskar', name: 'オスカー', job: '書記', trait: 'logical',
    build: 0.98, skin: '#e6c4a2', hair: '#5a5a5a', hairStyle: 'short',
    cloth: '#3a4a5a', cloth2: '#26313c', outfit: 'robe', hat: 'cap',
    accent: '#7aa8c8', eye: '#4a5a6a', fur: '#4a5460', furDark: '#282f38',
  },
  {
    id: 'gerda', name: 'ゲルダ', job: '井戸番', trait: 'loud',
    build: 1.04, skin: '#dcae86', hair: '#8a3a2a', hairStyle: 'curly',
    cloth: '#a85a3a', cloth2: '#6a3a24', outfit: 'tunic', hat: 'kerchief',
    accent: '#e8a05a', eye: '#5a3a24', fur: '#8a4a2c', furDark: '#4e2818',
  },
  {
    id: 'levin', name: 'レヴィン', job: '見習い騎士', trait: 'bold',
    build: 1.00, skin: '#e8bd94', hair: '#d8c08a', hairStyle: 'short',
    cloth: '#6a7a8a', cloth2: '#3a4450', outfit: 'armor', hat: 'none',
    accent: '#e8e0c8', eye: '#4a6a8a', fur: '#8a8470', furDark: '#4e4a3c',
  },
  {
    id: 'sasha', name: 'サーシャ', job: '仕立屋', trait: 'sly',
    build: 0.94, skin: '#efd0b4', hair: '#2a2028', hairStyle: 'pony',
    cloth: '#7a3a5a', cloth2: '#4a2338', outfit: 'dress', hat: 'none',
    accent: '#e8b0c8', eye: '#4a2a3a', fur: '#4a3a44', furDark: '#281e26',
  },
  {
    id: 'tobias', name: 'トビアス', job: '大工', trait: 'calm',
    build: 1.08, skin: '#d4a06e', hair: '#6a4a2a', hairStyle: 'short',
    cloth: '#9a7a4a', cloth2: '#5a4428', outfit: 'apron', hat: 'cap',
    accent: '#c8a86a', eye: '#4a3a22', fur: '#7a5c38', furDark: '#443220',
  },
  {
    id: 'vera', name: 'ヴェラ', job: '灯り守', trait: 'quiet',
    build: 0.95, skin: '#f0d2b8', hair: '#b8b0c8', hairStyle: 'long',
    cloth: '#4a4a6a', cloth2: '#2e2e46', outfit: 'cloak', hat: 'hood',
    accent: '#ffd98a', eye: '#6a6a8a', fur: '#6a687e', furDark: '#3a3848',
  },
  {
    id: 'hugo', name: 'ヒューゴ', job: '肉屋', trait: 'loud',
    build: 1.14, skin: '#d69a6e', hair: '#2a1e18', hairStyle: 'bald',
    cloth: '#b04a4a', cloth2: '#6a2c2c', outfit: 'apron', hat: 'none',
    accent: '#e8d0c0', eye: '#3a2a20', fur: '#6a3232', furDark: '#3c1c1c',
  },
  {
    id: 'lise', name: 'リーゼ', job: '教師', trait: 'kind',
    build: 0.97, skin: '#f3d9c0', hair: '#4a3828', hairStyle: 'bun',
    cloth: '#4a6a5a', cloth2: '#2e4238', outfit: 'dress', hat: 'none',
    accent: '#a8d8c0', eye: '#3a5a4a', fur: '#4a5a4e', furDark: '#28322c',
  },
  {
    id: 'arno', name: 'アルノ', job: '樽職人', trait: 'quiet',
    build: 1.05, skin: '#cf9a72', hair: '#7a6a4a', hairStyle: 'messy',
    cloth: '#7a6a4a', cloth2: '#4a4030', outfit: 'tunic', hat: 'cap',
    accent: '#b09a6a', eye: '#4a4030', fur: '#7a6c4c', furDark: '#443c28',
  },
  {
    id: 'kata', name: 'カタ', job: '荷運び', trait: 'bold',
    build: 1.02, skin: '#c98a5e', hair: '#1e1a1a', hairStyle: 'pony',
    cloth: '#5a7a6a', cloth2: '#38483e', outfit: 'tunic', hat: 'bandana',
    accent: '#e8c07a', eye: '#3a2a22', fur: '#3e4a42', furDark: '#222a25',
  },
  {
    id: 'ferdi', name: 'フェルディ', job: '靴屋', trait: 'timid',
    build: 0.90, skin: '#e6c09a', hair: '#a88a5a', hairStyle: 'short',
    cloth: '#8a7a5a', cloth2: '#5a4c38', outfit: 'coat', hat: 'hat',
    accent: '#c8b088', eye: '#5a4a30', fur: '#8a7a58', furDark: '#4c4230',
  },
  {
    id: 'ilva', name: 'イルヴァ', job: '写本師', trait: 'logical',
    build: 0.93, skin: '#f5dcc4', hair: '#d8d0c0', hairStyle: 'braid',
    cloth: '#6a6a8a', cloth2: '#42425c', outfit: 'robe', hat: 'circlet',
    accent: '#c0c8e8', eye: '#7a7a9a', fur: '#8a8898', furDark: '#4c4a58',
  },
  {
    id: 'dorn', name: 'ドルン', job: '石工', trait: 'calm',
    build: 1.11, skin: '#c08a5e', hair: '#3a3028', hairStyle: 'short',
    cloth: '#7a7a7a', cloth2: '#4a4a4a', outfit: 'apron', hat: 'none',
    accent: '#a8a8a8', eye: '#4a3a2a', fur: '#5e5e5e', furDark: '#343434',
  },
  {
    id: 'rosa', name: 'ローザ', job: '酒場の女将', trait: 'loud',
    build: 1.00, skin: '#eec8a4', hair: '#b04a2a', hairStyle: 'curly',
    cloth: '#c86a4a', cloth2: '#7a3a28', outfit: 'dress', hat: 'kerchief',
    accent: '#ffd07a', eye: '#5a3020', fur: '#a05436', furDark: '#5a2c1c',
  },
  {
    id: 'wilm', name: 'ヴィルム', job: '羊飼い', trait: 'kind',
    build: 0.99, skin: '#dcae82', hair: '#c8b090', hairStyle: 'messy',
    cloth: '#c8c0a8', cloth2: '#7a7460', outfit: 'cloak', hat: 'hood',
    accent: '#9ab080', eye: '#5a5a3a', fur: '#b0a888', furDark: '#605a44',
  },
  {
    id: 'yuli', name: 'ユーリ', job: '見張り番', trait: 'sly',
    build: 1.01, skin: '#d29a70', hair: '#4a2a2a', hairStyle: 'short',
    cloth: '#3a4a3a', cloth2: '#243024', outfit: 'coat', hat: 'cap',
    accent: '#8a9a6a', eye: '#3a2a22', fur: '#3e4a38', furDark: '#222a1e',
  },
  {
    id: 'anka', name: 'アンカ', job: '産婆', trait: 'calm',
    build: 0.96, skin: '#f0d0b0', hair: '#8a8a8a', hairStyle: 'bun',
    cloth: '#8a7a9a', cloth2: '#544a60', outfit: 'robe', hat: 'kerchief',
    accent: '#c8b8d8', eye: '#5a5060', fur: '#7a7288', furDark: '#443e4c',
  },
  {
    id: 'pim', name: 'ピム', job: '見習い薬師', trait: 'timid',
    build: 0.89, skin: '#f7e0c8', hair: '#6ab0a0', hairStyle: 'short',
    cloth: '#4a8a8a', cloth2: '#2e5454', outfit: 'tunic', hat: 'none',
    accent: '#a8e8dc', eye: '#3a6a64', fur: '#4a7a74', furDark: '#284440',
  },
];

/* ---------- 役職配分 ---------- */
function roleSetup(n) {
  let wolves, seers = 1, knights = 1;
  if (n <= 5) wolves = 1;
  else if (n <= 7) wolves = 1;
  else if (n <= 11) wolves = 2;
  else if (n <= 14) wolves = 3;
  else wolves = 4;
  if (n <= 4) { seers = 1; knights = 0; }
  const villagers = n - wolves - seers - knights;
  return { wolf: wolves, seer: seers, knight: knights, villager: villagers };
}

/* ---------- 街の仕事 ---------- */
const CHORES = [
  { id: 'well',   name: '井戸の水を汲む',   icon: '🪣', secs: 3.0 },
  { id: 'oven',   name: 'パン窯に薪をくべる', icon: '🔥', secs: 3.4 },
  { id: 'forge',  name: '鍛冶場の鞴を踏む',  icon: '⚒', secs: 3.8 },
  { id: 'field',  name: '畑の草を抜く',     icon: '🌾', secs: 3.2 },
  { id: 'watch',  name: '物見櫓から外を見る', icon: '🔭', secs: 3.6 },
  { id: 'store',  name: '倉庫の麦を数える',  icon: '📦', secs: 3.0 },
  { id: 'canal',  name: '水路の落ち葉を除く', icon: '🍂', secs: 3.2 },
  { id: 'bell',   name: '鐘楼の綱を張り直す', icon: '🔔', secs: 3.6 },
  { id: 'gate',   name: '門の閂を確かめる',  icon: '🚪', secs: 3.4 },
  { id: 'shrine', name: '祠に灯を供える',    icon: '🕯', secs: 2.8 },
];
