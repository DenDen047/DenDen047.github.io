/* =========================================================================
   GACHA STRIKERS ― データ定義
   選手・属性・フォーメーション・ステージ・ガチャ設定をここに集約する。
   バランス調整はこのファイルだけを触れば済むようにしてある。
   ========================================================================= */

/* ---------- 属性 ---------- */
const ELEMENTS = {
  fire:    { id: 'fire',    name: '炎', color: '#ff6a2b', glow: '#ffd08a', icon: '🔥' },
  wind:    { id: 'wind',    name: '風', color: '#3ddc97', glow: '#c6ffe6', icon: '🌪' },
  thunder: { id: 'thunder', name: '雷', color: '#ffd23f', glow: '#fff5c0', icon: '⚡' },
  forest:  { id: 'forest',  name: '森', color: '#7bc043', glow: '#dbffb0', icon: '🌿' },
  light:   { id: 'light',   name: '光', color: '#ffe9a8', glow: '#ffffff', icon: '✨' },
  dark:    { id: 'dark',    name: '闇', color: '#a06bff', glow: '#e2ccff', icon: '🌑' },
};

/* 炎は風を焼き、風は雷を散らし、雷は森を焦がし、森は炎を鎮める。光と闇は互いに強い。 */
const ELEM_BEATS = {
  fire: ['wind'],
  wind: ['thunder'],
  thunder: ['forest'],
  forest: ['fire'],
  light: ['dark'],
  dark: ['light'],
};
const ELEM_ADVANTAGE = 0.18; // 有利なら威力+18%、不利なら-18%

/* ---------- レアリティ ---------- */
const RARITY = {
  2: { star: 2, label: 'N',   color: '#9fb4c7', grad: ['#5b6b7c', '#8fa4b6'], rate: 0.50 },
  3: { star: 3, label: 'R',   color: '#5ec8ff', grad: ['#12507d', '#57b7f0'], rate: 0.35 },
  4: { star: 4, label: 'SR',  color: '#c58bff', grad: ['#4b2585', '#b077f5'], rate: 0.12 },
  5: { star: 5, label: 'SSR', color: '#ffcf4d', grad: ['#8a5a06', '#ffd76a'], rate: 0.03 },
};

/* ---------- ポジション ---------- */
const POSITIONS = {
  GK: { id: 'GK', name: 'GK', full: 'ゴールキーパー', color: '#ffb03a' },
  DF: { id: 'DF', name: 'DF', full: 'ディフェンダー', color: '#4ea3ff' },
  MF: { id: 'MF', name: 'MF', full: 'ミッドフィルダー', color: '#3ddc97' },
  FW: { id: 'FW', name: 'FW', full: 'フォワード',     color: '#ff5f7e' },
};

/* ---------- 選手データ ----------
   base: sho=シュート pas=パス dri=ドリブル def=守備 spd=スピード cat=キャッチ
   hissatsu.type: shoot=必殺シュート / dribble=必殺ドリブル / block=必殺ブロック / catch=必殺キャッチ
   look.style: spike | long | bun | short | mohawk | ponytail | curly | cap | braid | bald
*/
const CHARACTERS = [
  /* ===== ★5 SSR ===== */
  {
    id: 'ryusei', no: 10, name: '獅堂 龍星', kana: 'シドウ リュウセイ', rarity: 5, elem: 'fire', pos: 'FW',
    base: { sho: 95, pas: 68, dri: 90, def: 42, spd: 88, cat: 15 },
    hissatsu: { name: 'バーニングノヴァ', type: 'shoot', cost: 60, power: 2.9, fx: 'flame',
                desc: '空へ跳び上がり、超新星の炎をまとった一撃を叩き込む。' },
    look: { style: 'spike', hair: '#ff4d2b', skin: '#f3c49b', acc: 'band', accColor: '#ffe14d' },
    bio: '雷鳴学園を単騎で沈めた伝説のストライカー。炎は闘志に比例して強くなる。',
  },
  {
    id: 'sae', no: 1, name: '氷室 冴', kana: 'ヒムロ サエ', rarity: 5, elem: 'light', pos: 'GK',
    base: { sho: 20, pas: 70, dri: 45, def: 85, spd: 72, cat: 96 },
    hissatsu: { name: 'セイクリッドゲート', type: 'catch', cost: 55, power: 2.6, fx: 'holy',
                desc: 'ゴール前に光の門を築き、あらゆる砲弾を鎮める。' },
    look: { style: 'long', hair: '#cfe6ff', skin: '#f7d9bd', acc: 'glove', accColor: '#9fd8ff' },
    bio: '「あの門は開かない」。無失点記録は公式戦37試合で止まっていない。',
  },
  {
    id: 'jin', no: 8, name: '雷堂 迅', kana: 'ライドウ ジン', rarity: 5, elem: 'thunder', pos: 'MF',
    base: { sho: 78, pas: 90, dri: 92, def: 62, spd: 95, cat: 18 },
    hissatsu: { name: 'プラズマドライブ', type: 'dribble', cost: 45, power: 2.2, fx: 'bolt',
                desc: '雷そのものになって加速。触れた相手は弾き飛ばされる。' },
    look: { style: 'mohawk', hair: '#ffe14d', skin: '#e8b487', acc: 'none', accColor: '#fff' },
    bio: '中盤を電光で切り裂く司令塔。走行距離もリーグ最長。',
  },
  {
    id: 'rei', no: 11, name: '黒羽 レイ', kana: 'クロバ レイ', rarity: 5, elem: 'dark', pos: 'FW',
    base: { sho: 92, pas: 74, dri: 86, def: 45, spd: 90, cat: 16 },
    hissatsu: { name: 'アビスファング', type: 'shoot', cost: 62, power: 2.8, fx: 'void',
                desc: '深淵の顎がボールごとキーパーを呑み込む。' },
    look: { style: 'long', hair: '#2b1d3a', skin: '#e6bd96', acc: 'scar', accColor: '#a06bff' },
    bio: '無所属の一匹狼。得点した試合は必ずチームが勝つというジンクスを持つ。',
  },
  {
    id: 'iwao', no: 4, name: '大地 巌', kana: 'ダイチ イワオ', rarity: 5, elem: 'forest', pos: 'DF',
    base: { sho: 45, pas: 70, dri: 50, def: 96, spd: 66, cat: 40 },
    hissatsu: { name: 'グランドバスティオン', type: 'block', cost: 50, power: 2.7, fx: 'vine',
                desc: '大地から岩壁を隆起させ、必殺シュートごと押し返す。' },
    look: { style: 'bald', hair: '#4a3524', skin: '#d3a173', acc: 'none', accColor: '#fff' },
    bio: '「ここから先は畑だ、荒らすな」。守備範囲は自陣の全域。',
  },
  {
    id: 'alva', no: 7, name: 'アルヴァ・ソレイユ', kana: 'アルヴァ ソレイユ', rarity: 5, elem: 'wind', pos: 'MF',
    base: { sho: 86, pas: 94, dri: 84, def: 58, spd: 86, cat: 20 },
    hissatsu: { name: 'ゲイルレクイエム', type: 'shoot', cost: 58, power: 2.6, fx: 'gale',
                desc: '暴風の渦をまとった無回転弾。軌道が読めない。' },
    look: { style: 'curly', hair: '#f7f2d6', skin: '#f0c9a3', acc: 'none', accColor: '#fff' },
    bio: '風読みの名手。パス成功率は生涯96%を切ったことがない。',
  },

  /* ===== ★4 SR ===== */
  {
    id: 'hayate', no: 14, name: '疾風 颯', kana: 'ハヤテ ソウ', rarity: 4, elem: 'wind', pos: 'MF',
    base: { sho: 70, pas: 80, dri: 85, def: 55, spd: 90, cat: 15 },
    hissatsu: { name: 'ゲイルステップ', type: 'dribble', cost: 40, power: 1.9, fx: 'gale',
                desc: '突風に乗って相手をすり抜ける高速ステップ。' },
    look: { style: 'short', hair: '#6fe3b8', skin: '#efc49c', acc: 'band', accColor: '#ffffff' },
    bio: '陸上部からの転向組。トップスピードだけならリーグ最速。',
  },
  {
    id: 'enji', no: 9, name: '炎路 炎児', kana: 'エンジ エンジ', rarity: 4, elem: 'fire', pos: 'FW',
    base: { sho: 85, pas: 62, dri: 74, def: 40, spd: 78, cat: 14 },
    hissatsu: { name: 'フレアバレット', type: 'shoot', cost: 52, power: 2.3, fx: 'flame',
                desc: '燃える弾丸のような低い直線シュート。' },
    look: { style: 'spike', hair: '#ff8a3d', skin: '#e5ac7c', acc: 'none', accColor: '#fff' },
    bio: '「点を取る以外の仕事は知らん」と言い切る職人肌の点取り屋。',
  },
  {
    id: 'raiga', no: 5, name: '神成 雷牙', kana: 'カミナリ ライガ', rarity: 4, elem: 'thunder', pos: 'DF',
    base: { sho: 50, pas: 68, dri: 55, def: 86, spd: 74, cat: 35 },
    hissatsu: { name: 'サンダーウォール', type: 'block', cost: 45, power: 2.2, fx: 'bolt',
                desc: '雷の格子を張り、突破を強制的に止める。' },
    look: { style: 'ponytail', hair: '#ffd93b', skin: '#d9a074', acc: 'none', accColor: '#fff' },
    bio: '雷鳴学園の元主将。読みの速さは経験の産物。',
  },
  {
    id: 'itsuki', no: 3, name: '森野 樹', kana: 'モリノ イツキ', rarity: 4, elem: 'forest', pos: 'DF',
    base: { sho: 42, pas: 74, dri: 52, def: 84, spd: 66, cat: 38 },
    hissatsu: { name: 'ルートバインド', type: 'block', cost: 42, power: 2.1, fx: 'vine',
                desc: '足元から根が伸び、ボールごと絡め取る。' },
    look: { style: 'bun', hair: '#3f7a2e', skin: '#eec3a0', acc: 'none', accColor: '#fff' },
    bio: '林業一家の三男。走らず止めるのが信条。',
  },
  {
    id: 'luna', no: 17, name: 'ルナ・ノクターン', kana: 'ルナ ノクターン', rarity: 4, elem: 'dark', pos: 'MF',
    base: { sho: 76, pas: 84, dri: 88, def: 52, spd: 82, cat: 18 },
    hissatsu: { name: 'シャドウミラージュ', type: 'dribble', cost: 44, power: 2.0, fx: 'void',
                desc: '分身を残して消える。相手は影を追いかける。' },
    look: { style: 'long', hair: '#8a6bd6', skin: '#f2d3b6', acc: 'none', accColor: '#fff' },
    bio: '夜の路上で育ったテクニシャン。フェイントの引き出しが無尽蔵。',
  },
  {
    id: 'hikari', no: 18, name: '天海 光', kana: 'アマミ ヒカリ', rarity: 4, elem: 'light', pos: 'FW',
    base: { sho: 84, pas: 70, dri: 76, def: 42, spd: 80, cat: 16 },
    hissatsu: { name: 'ホーリーランス', type: 'shoot', cost: 54, power: 2.4, fx: 'holy',
                desc: '光の槍が壁ごとゴールを貫く。' },
    look: { style: 'short', hair: '#ffe9a8', skin: '#f6d5b8', acc: 'none', accColor: '#fff' },
    bio: '聖レイナ学院のエース。誠実すぎてファウルを一度も犯していない。',
  },
  {
    id: 'gonzalo', no: 19, name: 'ゴンザロ・リオ', kana: 'ゴンザロ リオ', rarity: 4, elem: 'fire', pos: 'FW',
    base: { sho: 82, pas: 66, dri: 86, def: 38, spd: 85, cat: 14 },
    hissatsu: { name: 'サンバブレイズ', type: 'shoot', cost: 50, power: 2.2, fx: 'flame',
                desc: 'リズムを刻みながら回転をかけた炎の巻き弾。' },
    look: { style: 'curly', hair: '#3a2418', skin: '#a9704a', acc: 'none', accColor: '#fff' },
    bio: 'ビーチサッカー出身。狭い場所ほど嬉しそうに笑う。',
  },
  {
    id: 'kou', no: 21, name: '鉄壁 鋼', kana: 'テッペキ コウ', rarity: 4, elem: 'forest', pos: 'GK',
    base: { sho: 18, pas: 60, dri: 38, def: 78, spd: 64, cat: 88 },
    hissatsu: { name: 'アイアングリップ', type: 'catch', cost: 48, power: 2.3, fx: 'vine',
                desc: '鋼の握力でボールを鷲掴みにする。' },
    look: { style: 'short', hair: '#5b5b5b', skin: '#d9a97f', acc: 'glove', accColor: '#7bc043' },
    bio: '掴んだボールは絶対に落とさない。握力120kg。',
  },
  {
    id: 'mizuki', no: 6, name: '水城 瑞希', kana: 'ミズキ ミズキ', rarity: 4, elem: 'wind', pos: 'MF',
    base: { sho: 74, pas: 88, dri: 78, def: 56, spd: 78, cat: 20 },
    hissatsu: { name: 'クレセントゲイル', type: 'shoot', cost: 50, power: 2.2, fx: 'gale',
                desc: '三日月の軌道で曲がりながら落ちる変化球。' },
    look: { style: 'ponytail', hair: '#4fb6d8', skin: '#f4d0ad', acc: 'none', accColor: '#fff' },
    bio: '状況判断の鬼。ボールを持つ前に選択肢を三つ用意している。',
  },
  {
    id: 'viktor', no: 2, name: 'ヴィクトル・ザハロフ', kana: 'ヴィクトル ザハロフ', rarity: 4, elem: 'dark', pos: 'DF',
    base: { sho: 55, pas: 66, dri: 50, def: 88, spd: 70, cat: 36 },
    hissatsu: { name: 'ヴォイドチェイン', type: 'block', cost: 46, power: 2.3, fx: 'void',
                desc: '影の鎖が相手の足を止める。' },
    look: { style: 'short', hair: '#c9c4d8', skin: '#eccfb4', acc: 'scar', accColor: '#a06bff' },
    bio: '極寒の地から来た守備の職人。笑った顔を誰も見たことがない。',
  },

  /* ===== ★3 R ===== */
  {
    id: 'takumi', no: 15, name: '匠 拓海', kana: 'タクミ タクミ', rarity: 3, elem: 'forest', pos: 'MF',
    base: { sho: 58, pas: 72, dri: 64, def: 58, spd: 66, cat: 20 },
    hissatsu: { name: 'リーフステップ', type: 'dribble', cost: 38, power: 1.6, fx: 'vine',
                desc: '木の葉のように揺れて相手をいなす。' },
    look: { style: 'short', hair: '#5c8f3a', skin: '#eec19a', acc: 'none', accColor: '#fff' },
    bio: 'チームの副キャプテン。地味だが一番信頼されている。',
  },
  {
    id: 'sora', no: 23, name: '空野 そら', kana: 'ソラノ ソラ', rarity: 3, elem: 'wind', pos: 'FW',
    base: { sho: 70, pas: 58, dri: 68, def: 38, spd: 74, cat: 14 },
    hissatsu: { name: 'ウィンドショット', type: 'shoot', cost: 42, power: 1.8, fx: 'gale',
                desc: '追い風を味方につけた伸びるシュート。' },
    look: { style: 'bun', hair: '#8fd7ff', skin: '#f4d2b0', acc: 'none', accColor: '#fff' },
    bio: '走るのが好きすぎて前線から戻ってこない。',
  },
  {
    id: 'daigo', no: 22, name: '大護 剛', kana: 'ダイゴ ゴウ', rarity: 3, elem: 'fire', pos: 'DF',
    base: { sho: 44, pas: 58, dri: 46, def: 74, spd: 60, cat: 30 },
    hissatsu: { name: 'ヒートブロック', type: 'block', cost: 38, power: 1.7, fx: 'flame',
                desc: '熱気の壁で突進を受け止める。' },
    look: { style: 'spike', hair: '#b2472b', skin: '#d99f73', acc: 'none', accColor: '#fff' },
    bio: '声出しでチームを温める男。守備範囲は狭いが気持ちは広い。',
  },
  {
    id: 'nao', no: 12, name: '名雲 尚', kana: 'ナグモ ナオ', rarity: 3, elem: 'thunder', pos: 'GK',
    base: { sho: 16, pas: 54, dri: 34, def: 66, spd: 58, cat: 74 },
    hissatsu: { name: 'ボルトキャッチ', type: 'catch', cost: 40, power: 1.8, fx: 'bolt',
                desc: '反射神経を雷速まで引き上げる。' },
    look: { style: 'short', hair: '#e0c352', skin: '#eec19a', acc: 'glove', accColor: '#ffd23f' },
    bio: '控えGKからの叩き上げ。準備だけは誰よりも早い。',
  },
  {
    id: 'leo', no: 24, name: 'レオ・カンポス', kana: 'レオ カンポス', rarity: 3, elem: 'light', pos: 'FW',
    base: { sho: 72, pas: 56, dri: 70, def: 36, spd: 72, cat: 14 },
    hissatsu: { name: 'シャイニングボレー', type: 'shoot', cost: 44, power: 1.9, fx: 'holy',
                desc: '落ちてくるボールを閃光で叩く。' },
    look: { style: 'curly', hair: '#7a4a22', skin: '#c98d5f', acc: 'none', accColor: '#fff' },
    bio: '陽気なムードメーカー。ボレーだけは天才的。',
  },
  {
    id: 'shin', no: 16, name: '真道 信', kana: 'シンドウ シン', rarity: 3, elem: 'thunder', pos: 'MF',
    base: { sho: 62, pas: 70, dri: 66, def: 56, spd: 72, cat: 18 },
    hissatsu: { name: 'スパークダッシュ', type: 'dribble', cost: 36, power: 1.6, fx: 'bolt',
                desc: '一瞬だけ帯電して加速する。' },
    look: { style: 'short', hair: '#3a3a4a', skin: '#f0c49c', acc: 'glasses', accColor: '#ffffff' },
    bio: '分析屋。相手の癖をノート三冊分書き溜めている。',
  },
  {
    id: 'kiri', no: 25, name: '桐生 霧', kana: 'キリュウ キリ', rarity: 3, elem: 'wind', pos: 'DF',
    base: { sho: 40, pas: 62, dri: 48, def: 72, spd: 68, cat: 28 },
    hissatsu: { name: 'ミストガード', type: 'block', cost: 38, power: 1.7, fx: 'gale',
                desc: '霧で視界を奪い、パスコースを消す。' },
    look: { style: 'long', hair: '#b9c9d6', skin: '#f2cfae', acc: 'none', accColor: '#fff' },
    bio: '気配を消すのが上手い。味方も時々見失う。',
  },
  {
    id: 'yuki', no: 26, name: '雪村 由紀', kana: 'ユキムラ ユキ', rarity: 3, elem: 'light', pos: 'MF',
    base: { sho: 60, pas: 74, dri: 62, def: 54, spd: 64, cat: 20 },
    hissatsu: { name: 'ルミナスアロー', type: 'shoot', cost: 42, power: 1.8, fx: 'holy',
                desc: '光の矢が最短距離でゴールを射抜く。' },
    look: { style: 'braid', hair: '#f0e6d2', skin: '#f7d9bd', acc: 'none', accColor: '#fff' },
    bio: '視野の広いレフティ。決定的なパスを黙って出す。',
  },
  {
    id: 'banri', no: 27, name: '万里 大河', kana: 'バンリ タイガ', rarity: 3, elem: 'forest', pos: 'DF',
    base: { sho: 46, pas: 60, dri: 44, def: 76, spd: 58, cat: 32 },
    hissatsu: { name: 'アースウォール', type: 'block', cost: 40, power: 1.8, fx: 'vine',
                desc: '土の壁でシュートコースを塞ぐ。' },
    look: { style: 'mohawk', hair: '#6b4b2a', skin: '#d8a274', acc: 'none', accColor: '#fff' },
    bio: '身体を投げ出すのが仕事。ユニフォームはいつも泥だらけ。',
  },
  {
    id: 'zack', no: 28, name: 'ザック・ムーア', kana: 'ザック ムーア', rarity: 3, elem: 'dark', pos: 'FW',
    base: { sho: 74, pas: 54, dri: 66, def: 38, spd: 70, cat: 14 },
    hissatsu: { name: 'ダークバレット', type: 'shoot', cost: 44, power: 1.9, fx: 'void',
                desc: '影に沈んで見えなくなる弾丸シュート。' },
    look: { style: 'cap', hair: '#20202a', skin: '#8f6244', acc: 'cap', accColor: '#a06bff' },
    bio: '路上育ちの独学ストライカー。決定力に波がある。',
  },
  {
    id: 'hina', no: 29, name: '陽菜 ひな', kana: 'ヒナ ヒナ', rarity: 3, elem: 'fire', pos: 'MF',
    base: { sho: 64, pas: 68, dri: 70, def: 48, spd: 70, cat: 18 },
    hissatsu: { name: 'フレイムステップ', type: 'dribble', cost: 38, power: 1.7, fx: 'flame',
                desc: '足跡が燃える高速ターン。' },
    look: { style: 'ponytail', hair: '#ff9a5c', skin: '#f6d0ae', acc: 'band', accColor: '#ff6a2b' },
    bio: '負けず嫌い。点差が開くほど元気になる。',
  },
  {
    id: 'gou', no: 30, name: '剛田 豪', kana: 'ゴウダ ゴウ', rarity: 3, elem: 'thunder', pos: 'DF',
    base: { sho: 48, pas: 56, dri: 44, def: 78, spd: 56, cat: 30 },
    hissatsu: { name: 'ボルトタックル', type: 'block', cost: 40, power: 1.8, fx: 'bolt',
                desc: '帯電した身体ごとぶつかって奪う。' },
    look: { style: 'bald', hair: '#332a22', skin: '#c98d5f', acc: 'none', accColor: '#fff' },
    bio: '当たり負けしない。相手より先に痛がったことがない。',
  },

  /* ===== ★2 N（初期メンバー） ===== */
  {
    id: 'kenta', no: 31, name: '山田 健太', kana: 'ヤマダ ケンタ', rarity: 2, elem: 'fire', pos: 'MF',
    base: { sho: 48, pas: 56, dri: 50, def: 46, spd: 56, cat: 16 },
    hissatsu: null,
    look: { style: 'short', hair: '#3a2b20', skin: '#f0c49c', acc: 'none', accColor: '#fff' },
    bio: 'クラブの部長。人望だけで庭のみんなをまとめている。',
  },
  {
    id: 'mako', no: 32, name: '白石 真子', kana: 'シライシ マコ', rarity: 2, elem: 'wind', pos: 'DF',
    base: { sho: 32, pas: 50, dri: 38, def: 58, spd: 54, cat: 24 },
    hissatsu: null,
    look: { style: 'bun', hair: '#4a4a55', skin: '#f5d6b8', acc: 'none', accColor: '#fff' },
    bio: '几帳面な守備職人。ラインを1cm単位で揃えたがる。',
  },
  {
    id: 'riku', no: 33, name: '森本 陸', kana: 'モリモト リク', rarity: 2, elem: 'forest', pos: 'FW',
    base: { sho: 56, pas: 44, dri: 52, def: 32, spd: 58, cat: 14 },
    hissatsu: null,
    look: { style: 'spike', hair: '#4f7a35', skin: '#e5b184', acc: 'none', accColor: '#fff' },
    bio: 'とにかく前に走る。戦術理解はこれから。',
  },
  {
    id: 'yui', no: 34, name: '星野 唯', kana: 'ホシノ ユイ', rarity: 2, elem: 'light', pos: 'GK',
    base: { sho: 14, pas: 44, dri: 28, def: 52, spd: 48, cat: 58 },
    hissatsu: null,
    look: { style: 'braid', hair: '#d8c07a', skin: '#f7d9bd', acc: 'glove', accColor: '#ffe9a8' },
    bio: '正GK。怖がりだけど絶対に逃げない。',
  },
  {
    id: 'tomo', no: 35, name: '相川 智', kana: 'アイカワ トモ', rarity: 2, elem: 'thunder', pos: 'MF',
    base: { sho: 46, pas: 54, dri: 52, def: 44, spd: 58, cat: 16 },
    hissatsu: null,
    look: { style: 'short', hair: '#2d3a4a', skin: '#eec19a', acc: 'glasses', accColor: '#fff' },
    bio: 'データ係。誰が何本走ったか全部覚えている。',
  },
  {
    id: 'hachi', no: 36, name: '黒田 八郎', kana: 'クロダ ハチロウ', rarity: 2, elem: 'dark', pos: 'DF',
    base: { sho: 34, pas: 46, dri: 36, def: 60, spd: 50, cat: 24 },
    hissatsu: null,
    look: { style: 'mohawk', hair: '#25202c', skin: '#c98d5f', acc: 'none', accColor: '#fff' },
    bio: '見た目は怖いが動物にはめっぽう好かれる。',
  },
  {
    id: 'mina', no: 37, name: '南 美奈', kana: 'ミナミ ミナ', rarity: 2, elem: 'light', pos: 'FW',
    base: { sho: 54, pas: 48, dri: 54, def: 30, spd: 60, cat: 14 },
    hissatsu: null,
    look: { style: 'ponytail', hair: '#f2c96b', skin: '#f6d0ae', acc: 'none', accColor: '#fff' },
    bio: '陸上部と兼部。スプリントだけは上級生より速い。',
  },
  {
    id: 'goro', no: 38, name: '五十嵐 五郎', kana: 'イガラシ ゴロウ', rarity: 2, elem: 'dark', pos: 'GK',
    base: { sho: 12, pas: 42, dri: 26, def: 54, spd: 46, cat: 56 },
    hissatsu: null,
    look: { style: 'curly', hair: '#3b3b3b', skin: '#d8a274', acc: 'glove', accColor: '#a06bff' },
    bio: '控えGK。ベンチからの指示が的確すぎて監督が気にしている。',
  },
];

const CHAR_BY_ID = {};
CHARACTERS.forEach((c) => { CHAR_BY_ID[c.id] = c; });

/* 初期加入メンバー */
const STARTER_IDS = ['kenta', 'mako', 'riku', 'yui', 'tomo', 'hachi', 'mina', 'goro', 'takumi'];

/* ---------- フォーメーション ----------
   x: 0=自陣ゴール 1=敵ゴール / y: 0=上 1=下
*/
const FORMATIONS = [
  {
    id: 'f221', name: '2-2-1 バランス', desc: '攻守のバランス型。迷ったらこれ。',
    bonus: { label: '全能力 +2%', stats: { sho: 0.02, pas: 0.02, dri: 0.02, def: 0.02, spd: 0.02 } },
    slots: [
      { role: 'GK', x: 0.05, y: 0.50 },
      { role: 'DF', x: 0.24, y: 0.30 }, { role: 'DF', x: 0.24, y: 0.70 },
      { role: 'MF', x: 0.46, y: 0.34 }, { role: 'MF', x: 0.46, y: 0.66 },
      { role: 'FW', x: 0.70, y: 0.50 },
    ],
  },
  {
    id: 'f131', name: '1-3-1 ダイヤモンド', desc: '中盤を厚くして主導権を握る。',
    bonus: { label: 'パス +10%', stats: { pas: 0.10 } },
    slots: [
      { role: 'GK', x: 0.05, y: 0.50 },
      { role: 'DF', x: 0.22, y: 0.50 },
      { role: 'MF', x: 0.44, y: 0.24 }, { role: 'MF', x: 0.40, y: 0.50 }, { role: 'MF', x: 0.44, y: 0.76 },
      { role: 'FW', x: 0.72, y: 0.50 },
    ],
  },
  {
    id: 'f212', name: '2-1-2 ツインタワー', desc: '前線に2枚。裏抜けで殴る。',
    bonus: { label: 'シュート +8%', stats: { sho: 0.08 } },
    slots: [
      { role: 'GK', x: 0.05, y: 0.50 },
      { role: 'DF', x: 0.24, y: 0.32 }, { role: 'DF', x: 0.24, y: 0.68 },
      { role: 'MF', x: 0.46, y: 0.50 },
      { role: 'FW', x: 0.70, y: 0.32 }, { role: 'FW', x: 0.70, y: 0.68 },
    ],
  },
  {
    id: 'f320', name: '3-2-0 鉄壁', desc: '守って守ってカウンター。',
    bonus: { label: '守備 +14% / シュート -5%', stats: { def: 0.14, sho: -0.05 } },
    slots: [
      { role: 'GK', x: 0.05, y: 0.50 },
      { role: 'DF', x: 0.20, y: 0.24 }, { role: 'DF', x: 0.18, y: 0.50 }, { role: 'DF', x: 0.20, y: 0.76 },
      { role: 'MF', x: 0.46, y: 0.34 }, { role: 'MF', x: 0.46, y: 0.66 },
    ],
  },
  {
    id: 'f122', name: '1-2-2 カウンター', desc: '奪って一気に前へ。',
    bonus: { label: 'スピード +8%', stats: { spd: 0.08 } },
    slots: [
      { role: 'GK', x: 0.05, y: 0.50 },
      { role: 'DF', x: 0.22, y: 0.50 },
      { role: 'MF', x: 0.44, y: 0.30 }, { role: 'MF', x: 0.44, y: 0.70 },
      { role: 'FW', x: 0.70, y: 0.34 }, { role: 'FW', x: 0.70, y: 0.66 },
    ],
  },
  {
    id: 'f113', name: '1-1-3 総攻撃', desc: '守備は捨てる。点で殴り勝つ。',
    bonus: { label: 'シュート +14% / 守備 -12%', stats: { sho: 0.14, dri: 0.06, def: -0.12 } },
    slots: [
      { role: 'GK', x: 0.05, y: 0.50 },
      { role: 'DF', x: 0.22, y: 0.50 },
      { role: 'MF', x: 0.44, y: 0.50 },
      { role: 'FW', x: 0.70, y: 0.24 }, { role: 'FW', x: 0.74, y: 0.50 }, { role: 'FW', x: 0.70, y: 0.76 },
    ],
  },
];
const FORMATION_BY_ID = {};
FORMATIONS.forEach((f) => { FORMATION_BY_ID[f.id] = f; });

/* ---------- ステージ ---------- */
const STAGES = [
  /* --- 第1章 ルーキーリーグ --- */
  {
    id: 1, chapter: 1, name: '幼なじみFC', sub: '練習試合', power: 0.52, formation: 'f221',
    colors: { main: '#4a9de0', sub: '#17324f' }, elem: 'wind', tickets: 3, first: 5, diff: 1,
    roster: ['牧野 律', '小島 遥', '大野 剛', '西 千尋', '藤井 蓮', '田村 樹'],
    aces: [5], intro: '毎週やってる練習試合。だけど今日は本気で勝ちに来ている。',
  },
  {
    id: 2, chapter: 1, name: '港町シーガルズ', sub: 'リーグ第2節', power: 0.60, formation: 'f221',
    colors: { main: '#2ec5b6', sub: '#0d4f4a' }, elem: 'wind', tickets: 3, first: 5, diff: 1,
    roster: ['磯部 陽', '灘 佳孝', '汐見 累', '波多 真', '鴎沢 翼', '浜口 潮'],
    aces: [4, 5], intro: '海風の強いホーム。ロングボールが全部伸びてくる。',
  },
  {
    id: 3, chapter: 1, name: '鉄工所アイアンズ', sub: 'リーグ第5節', power: 0.68, formation: 'f320',
    colors: { main: '#8a8f98', sub: '#2b2f35' }, elem: 'forest', tickets: 4, first: 6, diff: 2,
    roster: ['釘宮 亮', '鋼 昌平', '溶田 実', '鉄尾 進', '鍛冶 兼路', '轟 源'],
    aces: [1, 5], intro: '全員が現役の職人。当たりの重さが素人と違う。',
  },
  {
    id: 4, chapter: 1, name: '雷鳴学園サンダーズ', sub: '章ボス', power: 0.80, formation: 'f212',
    colors: { main: '#ffd23f', sub: '#3a2c00' }, elem: 'thunder', tickets: 6, first: 12, diff: 3, boss: true,
    roster: ['天羽 玲', '雷門 轟', '電 颯太', '鳴神 巧', '稲光 迅雷', '閃 秋人'],
    aces: [4, 5], intro: '全国常連の名門。ここを超えないと次の舞台はない。',
  },

  /* --- 第2章 チャレンジャーカップ --- */
  {
    id: 5, chapter: 2, name: '砂漠のサンドスコーピオン', sub: '1回戦', power: 0.88, formation: 'f122',
    colors: { main: '#e0a94a', sub: '#5b3c11' }, elem: 'fire', tickets: 5, first: 8, diff: 3,
    roster: ['乾 一途', '棘田 蓮', '灼 陽介', '熱川 恭介', '砂原 蠍', 'ハリド・ナセル'],
    aces: [4, 5], intro: '灼熱のピッチ。体力を削り切ってから刺しに来る。',
  },
  {
    id: 6, chapter: 2, name: '氷原ブリザードベア', sub: '2回戦', power: 0.96, formation: 'f320',
    colors: { main: '#8fd4ff', sub: '#123a5c' }, elem: 'light', tickets: 5, first: 8, diff: 4,
    roster: ['氷崎 白', 'イーゴリ・ペトロフ', '雪原 剛', '白熊 大地', '凍 悠', '霜月 巧真'],
    aces: [0, 1, 5], intro: '極寒の要塞。1点取るのに全員の力がいる。',
  },
  {
    id: 7, chapter: 2, name: '密林ジャングルファング', sub: '準決勝', power: 1.04, formation: 'f131',
    colors: { main: '#54b74a', sub: '#17401a' }, elem: 'forest', tickets: 6, first: 9, diff: 4,
    roster: ['葉山 陸', '樹海 律', '茂木 蒼', 'ムトゥ・オコンクォ', '猿飛 迅', '蔓谷 牙'],
    aces: [3, 4, 5], intro: '止まらない中盤の圧。囲まれたら終わりだと思え。',
  },
  {
    id: 8, chapter: 2, name: '紅蓮騎士団クリムゾン', sub: '決勝', power: 1.32, formation: 'f212',
    colors: { main: '#e03a4a', sub: '#4a0d16' }, elem: 'fire', tickets: 8, first: 16, diff: 5, boss: true,
    roster: ['烈 大河', '焦土 慎', '灼炎寺 剛', '緋村 昴', '紅蓮 焔王', 'ダンテ・ロッシ'],
    aces: [3, 4, 5], intro: '全員が必殺技持ち。真正面から燃やしに来る。',
  },

  /* --- 第3章 ワールドファイナル --- */
  {
    id: 9, chapter: 3, name: '天空城セレスティア', sub: 'グループ最終戦', power: 1.46, formation: 'f131',
    colors: { main: '#ffe9a8', sub: '#6b5a1e' }, elem: 'light', tickets: 7, first: 10, diff: 5,
    roster: ['白鳥 玲', '光成 詩音', '雲雀 奏', '翔 隼人', 'セラフィナ・ルクス', '天城 聖'],
    aces: [4, 5], intro: '空中戦の申し子たち。落ちてくるボールは全部相手のもの。',
  },
  {
    id: 10, chapter: 3, name: '深淵アビスノワール', sub: '準々決勝', power: 1.62, formation: 'f122',
    colors: { main: '#7a4fd6', sub: '#1c0f38' }, elem: 'dark', tickets: 8, first: 12, diff: 6,
    roster: ['烏丸 灰', '沈 静流', '影原 朔', '闇宮 累', 'ノワール・ヴァン', '夜刀 冥'],
    aces: [2, 4, 5], intro: 'ボールが見えなくなる。視覚より予測で戦え。',
  },
  {
    id: 11, chapter: 3, name: '機械帝国ギアクロス', sub: '準決勝', power: 1.78, formation: 'f320',
    colors: { main: '#5ec8ff', sub: '#0e2a3d' }, elem: 'thunder', tickets: 9, first: 14, diff: 6,
    roster: ['ユニット-07', '鋼鉄 剛', '軸馬 直', '電磁 陣', '歯車 精一', '回路 慧'],
    aces: [0, 1, 4], intro: '一切ミスをしない自動化された守備網。人間の閃きで壊す。',
  },
  {
    id: 12, chapter: 3, name: '神威イレブン', sub: '世界決勝', power: 2.05, formation: 'f212',
    colors: { main: '#ffffff', sub: '#c0392b' }, elem: 'light', tickets: 12, first: 30, diff: 7, boss: true,
    roster: ['氷室 蒼', '大地 磐', '獅堂 龍牙', '雷堂 疾', '神威 天馬', 'アルヴァ・ルーメン'],
    aces: [0, 3, 4, 5], intro: '世界の頂点。ここに立てるのは、ガチャと編成をやり切った者だけ。',
  },
];

/* 敵の必殺技プール（章が上がるほど強いものが割り当てられる） */
const ENEMY_HISSATSU = {
  shoot: [
    { name: 'ワイルドショット', power: 1.35, fx: 'flame' },
    { name: 'ヘヴィキャノン',   power: 1.75, fx: 'bolt' },
    { name: 'タイダルスラッシュ', power: 2.15, fx: 'gale' },
    { name: 'カタストロフィ',   power: 2.55, fx: 'void' },
  ],
  block: [
    { name: 'アイアンフェンス', power: 1.4, fx: 'vine' },
    { name: 'ヘヴィガード',     power: 1.8, fx: 'bolt' },
    { name: 'デッドロック',     power: 2.2, fx: 'void' },
    { name: 'アンブレイカブル', power: 2.6, fx: 'holy' },
  ],
  catch: [
    { name: 'ハードキャッチ',   power: 1.4, fx: 'vine' },
    { name: 'ゼロホールド',     power: 1.8, fx: 'holy' },
    { name: 'ヴォイドグリップ', power: 2.2, fx: 'void' },
    { name: 'ゴッドハンド',     power: 2.7, fx: 'bolt' },
  ],
  dribble: [
    { name: 'ラフステップ',     power: 1.5, fx: 'gale' },
    { name: 'ブラストラン',     power: 1.8, fx: 'flame' },
    { name: 'ゴーストムーブ',   power: 2.1, fx: 'void' },
  ],
};

/* ---------- ガチャ設定 ---------- */
const GACHA = {
  single: { cost: 1,  pulls: 1,  label: '単発' },
  multi:  { cost: 10, pulls: 10, label: '10連', guarantee: 4 }, // ★4以上1体確定
  pity: 30,      // 30連ごとに★5確定
  dupeShards: { 2: 1, 3: 2, 4: 5, 5: 15 }, // 上限突破済みの被りはチケットに還元
};

/* ---------- 育成 ---------- */
const GROWTH = {
  maxLevelBase: 20,        // 凸0のときのレベル上限
  maxLevelPerBreak: 5,     // 凸1つにつき上限+5
  maxBreak: 4,
  statPerLevel: 0.018,     // レベル1つにつき基礎値の+1.8%
  statPerBreak: 0.04,      // 凸1つにつき基礎値の+4%
  expCurve: (lv) => Math.round(30 + lv * 16 + lv * lv * 0.5),
  matchExp: (stage, win) => Math.round((110 + stage.diff * 50) * (win ? 1 : 0.5)),
};

/* ---------- ポジション不一致ペナルティ ---------- */
const POS_PENALTY = {
  // 本職以外に置いたときの能力倍率
  same: 1.0,
  near: 0.92,   // DF↔MF, MF↔FW
  far: 0.80,    // DF↔FW
  gkOut: 0.62,  // GKをフィールドに / フィールド選手をGKに
};

const POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };
function posFitFactor(charPos, slotRole) {
  if (charPos === slotRole) return POS_PENALTY.same;
  if (charPos === 'GK' || slotRole === 'GK') return POS_PENALTY.gkOut;
  const d = Math.abs(POS_ORDER[charPos] - POS_ORDER[slotRole]);
  return d === 1 ? POS_PENALTY.near : POS_PENALTY.far;
}
