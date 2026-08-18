/* HOLLOW TOYS ― 一人称視点版
 * 見下ろし型だった「閉店したピザ店の夜」を、そのまま一人称に組み替えたもの。
 * 世界の作り・敵の思考・章立ては 2D 版と同じで、目だけがプレイヤーの高さに降りている。
 *
 * 描画は列ごとのレイキャスト。画面の横幅ぶんだけレイを飛ばしてタイル格子を辿り、
 * ぶつかった壁を縦帯として書き、その上下に天井と床を投影する。什器は直方体として
 * 同じレイに交差させ、生き物は板(ビルボード)で立てて、列ごとの距離で隠面を消す。
 *
 * 懐中電灯は必ず視線と同じ方向を向く。つまり明るさは「距離 × 画面中央からの角度」で
 * 決まり、列ごとに角度の減衰を一度求めておけば、あとは距離だけで足りる。
 * 角の向こうが見えないという 2D 版の肝は、一人称では壁そのものが担う。
 *
 * ゲームループ内の状態はパフォーマンス優先で破壊的に更新する(ゲームループの定石)。
 */
(function () {
  "use strict";

  // ============================================================
  //  定数
  // ============================================================
  const VIEW_W = 960, VIEW_H = 600;   // 内部解像度(CSSで拡大表示)
  const TILE = 40;                    // 1マスのピクセル数
  const PLAYER_R = 13;

  // --- 光 ---
  const LIGHT_RAY_EPS = 0.00035;      // 角の裏へ回り込ませるための角度オフセット
  const DARKNESS = 0.955;             // 暗闇レイヤーの濃さ(1.0で完全な闇)
  const AMBIENT_R = 78;               // 消灯していても足元だけは見える半径
  const FOCUS_ARC_MUL = 0.42;         // 集束時の光の広がり倍率
  const FOCUS_RANGE_MUL = 1.55;       // 集束時の射程倍率

  // --- リソース消費 ---
  const BATTERY_DRAIN = 1.45;         // %/秒 通常点灯
  const BATTERY_FOCUS_DRAIN = 6.4;    // %/秒 集束照射
  const BATTERY_LOW = 22;             // これを下回るとちらつく
  const SANITY_DARK = 3.2;            // %/秒 暗闇に居るときの正気度低下
  const SANITY_LIT = -3.1;            // %/秒 明かりの中での回復(負値=回復)
  const SANITY_SEEN = 3.4;            // %/秒 敵に追われているときの追加低下
  const STAMINA_COST = 22;            // %/秒 走行
  const STAMINA_REGEN = 16;           // %/秒 回復

  // --- 物音(敵の聴覚に拾われる量) ---
  const NOISE_CROUCH = 30;
  const NOISE_WALK = 120;
  const NOISE_SPRINT = 300;
  const NOISE_MELEE = 340;
  const NOISE_HURT = 380;

  const MAX_PARTICLES = 900;
  const MAX_DECALS = 260;

  // ============================================================
  //  難易度
  // ============================================================
  const DIFFS = {
    easy: { key: 'easy', label: 'やさしい', sub: '雰囲気を味わう', dmg: 0.62, ehp: 0.82, count: 0.78, sanity: 0.6, battery: 0.72, supply: 1.35 },
    normal: { key: 'normal', label: 'ふつう', sub: '想定された恐怖', dmg: 1.0, ehp: 1.0, count: 1.0, sanity: 1.0, battery: 1.0, supply: 1.0 },
    nightmare: { key: 'nightmare', label: '悪夢', sub: '電池は足りない', dmg: 1.55, ehp: 1.3, count: 1.34, sanity: 1.45, battery: 1.32, supply: 0.72 },
  };

  // ============================================================
  //  操作キャラクター
  //  speed は px/秒。lightRange/lightArc が懐中電灯の性能。
  //  suit を持つキャラクターは着ぐるみ姿で、殴る代わりに「威嚇」で相手を追い払う。
  // ============================================================
  const CHARS = [
    {
      id: 'guard', name: '高槻 剛', role: '警備員', color: '#78b4ff', accent: '#1d3350',
      tag: '耐久', hp: 150, speed: 148, sprintMul: 1.40,
      battery: 135, batteryMul: 0.88, sanityRes: 0.72,
      lightRange: 430, lightArc: 0.50,
      weapon: { name: '特殊警棒', dmg: 30, reach: 60, arc: 1.15, cd: 0.46, stun: 1.1, knock: 190 },
      ability: { id: 'beacon', name: '保安灯', cd: 26, desc: '半径220を閃光で焼き、視界内の敵を4秒スタン。正気度も回復する。' },
      story: '夜間巡回中に無線が切れた。持ち場を離れるわけにはいかない。',
      trait: 'HP・バッテリーともに最大級。ただし足は重い。',
    },
    {
      id: 'inspector', name: '三笠 硝子', role: '元ホールスタッフ', color: '#8ae6b8', accent: '#173a2c',
      tag: '索敵', hp: 110, speed: 166, sprintMul: 1.48,
      battery: 105, batteryMul: 1.0, sanityRes: 0.9,
      lightRange: 400, lightArc: 0.56,
      weapon: { name: '鉄パイプ', dmg: 26, reach: 66, arc: 1.0, cd: 0.40, stun: 0.55, knock: 140 },
      ability: { id: 'memory', name: '店の記憶', cd: 24, desc: '12秒間、壁越しに敵と目標の位置が透けて見える。' },
      story: 'ここで12年、誕生日会の風船をふくらませ続けた。消えた子の名前も、まだ言える。',
      trait: '標準的な性能。索敵アビリティで事故を減らせる。',
    },
    {
      id: 'streamer', name: '古賀 ミオ', role: '配信者', color: '#ff8fd0', accent: '#45163a',
      tag: '機動', hp: 88, speed: 190, sprintMul: 1.62,
      battery: 92, batteryMul: 1.12, sanityRes: 1.28,
      lightRange: 372, lightArc: 0.62, hood: 'cat',
      weapon: { name: '一眼カメラ', type: 'camera', dmg: 21, reach: 210, arc: 0.44, cd: 0.62, stun: 1.0, knock: 70 },
      ability: { id: 'flash', name: 'フラッシュ撮影', cd: 15, desc: '前方を白飛びさせる。扇形内の敵に大ダメージとスタン。' },
      story: '「閉店したピザ屋から生放送」。同時接続は3人。うち2人は知らない誰かだ。',
      trait: '最速・最脆。攻撃はカメラのシャッターで、離れたまま撮って怯ませる。',
    },
    {
      id: 'mechanic', name: '園部 ヨウ', role: '設備整備士', color: '#ffc861', accent: '#4a3512',
      tag: '設営', hp: 118, speed: 158, sprintMul: 1.42,
      battery: 120, batteryMul: 0.94, sanityRes: 0.85,
      lightRange: 412, lightArc: 0.54,
      weapon: { name: 'モンキーレンチ', dmg: 34, reach: 56, arc: 0.95, cd: 0.52, stun: 0.8, knock: 220 },
      ability: { id: 'flare', name: '発煙筒', cd: 18, desc: 'フレアを投げる。着弾点は18秒間光り、敵を寄せつけない。' },
      story: '配電盤はB1。図面は頭に入っている。ただし十年前の版だ。',
      trait: '一撃が重く、作業(目標アイテムの回収)も速い。',
    },
    {
      id: 'artisan', name: '柊 セツ', role: '元アニマトロニクス技師', color: '#c9a7ff', accent: '#2f2350',
      tag: '搦め手', hp: 100, speed: 160, sprintMul: 1.44,
      battery: 108, batteryMul: 0.98, sanityRes: 0.66,
      lightRange: 396, lightArc: 0.58,
      weapon: { name: '彫刻刀', dmg: 24, reach: 50, arc: 0.9, cd: 0.30, stun: 0.35, knock: 90 },
      ability: { id: 'lullaby', name: '子守唄', cd: 28, desc: '半径260の個体を6秒眠らせ、最も近い1体を20秒だけ味方にする。' },
      story: 'この子たちに目を入れたのは私だ。名前もつけた。全部。',
      trait: '正気度に強く、敵を味方に変えられる。純粋な戦闘力は低め。',
    },
    // --- 着ぐるみ勢。相手をクリックして威嚇し、逃げ出させる ---
    {
      id: 'springtrap', name: 'スプリングトラップ', role: '黄うさぎの着ぐるみ', color: '#c4c04e', accent: '#3f4118',
      tag: '威嚇', hp: 118, speed: 156, sprintMul: 1.38,
      battery: 112, batteryMul: 0.95, sanityRes: 0.55,
      lightRange: 388, lightArc: 0.56, suit: 'springtrap', suitStealth: 0.60,
      weapon: { name: 'うさぎの威嚇', type: 'scare', dmg: 8, reach: 260, arc: 0.62, cd: 0.68, stun: 0, knock: 120, flee: 5.5, targets: 3 },
      ability: { id: 'stagefright', name: 'ステージ・フライト', cd: 22, desc: '半径340の個体をいっせいに9秒間、逃走させる。' },
      story: 'バックステージの奥で干からびていた黄色いうさぎ。留め具を外したとき、内側はまだ湿っていた。',
      trait: '殴らない。相手をクリックして威嚇し、追い払う。一度に3体まで効く。着ぐるみなので見つかりにくい。',
    },
    {
      id: 'goldbear', name: 'ゴールドベア', role: '金のクマの着ぐるみ', color: '#e6c249', accent: '#4a3708',
      tag: '畏怖', hp: 134, speed: 146, sprintMul: 1.32,
      battery: 124, batteryMul: 0.90, sanityRes: 0.50,
      lightRange: 404, lightArc: 0.52, suit: 'goldbear', suitStealth: 0.52,
      weapon: { name: '金のクマの凝視', type: 'scare', dmg: 13, reach: 340, arc: 0.34, cd: 0.92, stun: 0, knock: 70, flee: 10.0, targets: 1 },
      ability: { id: 'goldenhour', name: '黄金の刻', cd: 26, desc: '12秒間、正面の視界に入った個体が片端から逃げ出す。' },
      story: '初代マスコット。どの誕生日写真も真ん中にいる。中に誰が入っていたかは、誰も憶えていない。',
      trait: '一点を睨む威嚇。効くのは1体だけだが、逃げている時間がとても長い。',
    },
  ];

  /** 着ぐるみキャラクターか。 */
  const isSuit = (c) => !!(c && c.suit);

  // ============================================================
  //  休憩室で選ぶ強化
  // ============================================================
  const UPGRADES = [
    { id: 'lens', name: '高出力レンズ', icon: '🔦', desc: 'ライトの射程 +22%' },
    { id: 'cell', name: '大容量セル', icon: '🔋', desc: 'バッテリー最大 +45' },
    { id: 'boots', name: '制振ソール', icon: '👟', desc: '足音 -45% / 移動速度 +8%' },
    { id: 'grip', name: '滑り止めグリップ', icon: '🔧', desc: '近接ダメージ +28% / 威嚇の持続 +25%' },
    { id: 'kit', name: '救急キット', icon: '🩹', desc: '包帯の回復量 +70% / 所持上限 +2' },
    { id: 'pill', name: '鎮静剤', icon: '💊', desc: '正気度の低下 -35%' },
    { id: 'capacitor', name: '予備コンデンサ', icon: '⚡', desc: 'アビリティの再使用 -30%' },
    { id: 'armor', name: '作業用プロテクタ', icon: '🦺', desc: '最大HP +40 / 被ダメージ -10%' },
    { id: 'mirror', name: '集光ミラー', icon: '🪞', desc: '集束光のひるみ時間 +70%' },
    { id: 'scav', name: '漁り屋', icon: '🎒', desc: '床の補給品が +55%' },
    { id: 'edge', name: '研磨', icon: '🗡️', desc: '攻撃速度 +18%' },
    { id: 'nerve', name: '据わった肝', icon: '🫀', desc: '正気度が低くても手元が狂わない / 最大SAN +15' },
  ];

  // ============================================================
  //  敵 ― 店のアニマトロニクス
  //  sight=視界距離 / hear=聴覚距離 / lightFear=光に対する怯みやすさ
  // ============================================================
  const ENEMY_DEFS = {
    endo: {
      key: 'endo', name: 'エンドスケルトン', hp: 78, speed: 66, chaseMul: 1.55, r: 15,
      dmg: 15, reach: 40, atkCd: 1.15, sight: 340, hear: 300, lightFear: 1.0,
      score: 10, desc: '外皮のない骨組みだけの機体。サーボを鳴らしながら店内を巡回する。',
    },
    fox: {
      key: 'fox', name: '海賊ギツネ ラスティ', hp: 58, speed: 182, chaseMul: 1.0, r: 14,
      dmg: 18, reach: 34, atkCd: 0.9, sight: 420, hear: 380, lightFear: 0,
      score: 14, desc: '光を当てている間は止まる。目を離した分だけ、走って詰めてくる。',
    },
    bear: {
      key: 'bear', name: '司会グマ ブルーノ', hp: 168, speed: 54, chaseMul: 1.9, r: 20,
      dmg: 30, reach: 46, atkCd: 1.8, sight: 300, hear: 340, lightFear: 0.55,
      score: 22, desc: 'ステージの主役。見つけると助走をつけて突進してくる。',
    },
    puppet: {
      key: 'puppet', name: 'オルゴールの人形', hp: 46, speed: 98, chaseMul: 1.2, r: 14,
      dmg: 26, reach: 44, atkCd: 1.4, sight: 190, hear: 220, lightFear: 0.8,
      score: 16, desc: 'オルゴール箱の中で待っている。ぜんまいの届かない距離まで近づくと飛び出す。',
    },
    chick: {
      key: 'chick', name: '厨房ヒヨコ コッコ', hp: 66, speed: 76, chaseMul: 1.25, r: 15,
      dmg: 12, reach: 300, atkCd: 2.0, sight: 400, hear: 260, lightFear: 1.3,
      score: 20, desc: '皿とカップケーキを投げてくる。近づかれると厨房の側へ下がる。',
    },
  };

  // ============================================================
  //  フロア構成 ― 閉店した「ハロウベアーズ・ピザ」の各階
  //  kinds はそのフロアに出る部屋の種類。
  // ============================================================
  const FLOORS = [
    {
      n: 1, chapter: 1, mode: 'escape', name: '1F ダイニングホール', code: 'DINER',
      goalItem: 'ヒューズ', goalIcon: '🔌', goalCount: 3, grabpack: true,
      goalDesc: '配電盤のヒューズを 3本 と グラップパック を回収し、非常口のシャッターへ通電する。夜警のベアとは戦えない。逃げろ。',
      exitName: '配電盤', mapW: 62, mapH: 46, rooms: 14,
      kinds: ['stage', 'dining', 'dining', 'cove', 'arcade', 'kitchen', 'restroom', 'office', 'locker', 'storage', 'hall'],
      mix: { endo: 0.60, puppet: 0.22, fox: 0.18 }, density: 1.0,
      tint: '#0d1418', fog: '#0b1216', stalker: 'nightbear', stalkSpeed: 76,
      intro: ['正面の回転扉はチェーンで縛られていた。', '搬入口の隙間から、焦げたチーズの匂いがした。', '― 十年前に閉店したはずの店から。'],
    },
    {
      n: 2, chapter: 2, mode: 'mission', name: '2F パーティルーム', code: 'PARTY',
      goalItem: '仕事', goalIcon: '📋', goalCount: 0,
      goalDesc: 'プライズ係のマリオネットが3つの「仕事」を言いつけてくる。断れば、こちらが景品になる。',
      exitName: '封鎖扉', mapW: 68, mapH: 50, rooms: 16,
      kinds: ['party', 'party', 'prize', 'ballpit', 'arcade', 'dining', 'restroom', 'office', 'storage', 'locker', 'hall'],
      mix: { endo: 0.38, fox: 0.24, bear: 0.16, chick: 0.12, puppet: 0.10 }, density: 1.18,
      tint: '#150f14', fog: '#130c12', stalker: 'marionette', stalkSpeed: 0,
      intro: ['パーティルームの床は、乾かないままの赤で覆われていた。', 'テーブルには十年前のろうそくが、まだ立っている。', 'プライズコーナーの箱が、ゆっくりと鳴りはじめた。'],
    },
    {
      n: 3, chapter: 3, mode: 'escape', name: 'B1 パーツ&サービス', code: 'PARTS',
      goalItem: '鍵', goalIcon: '🗝️', goalCount: 2,
      goalDesc: '保管庫の鍵 2本 を集め、ボイラー室の隔壁を開く。今度の追手は、話が通じない。',
      exitName: '隔壁ゲート', mapW: 72, mapH: 52, rooms: 17,
      kinds: ['parts', 'parts', 'backstage', 'storage', 'utility', 'locker', 'office', 'restroom', 'hall', 'ballpit'],
      mix: { endo: 0.30, fox: 0.26, bear: 0.22, chick: 0.14, puppet: 0.08 }, density: 1.34,
      tint: '#180d0c', fog: '#160a09', stalker: 'mangled', stalkSpeed: 104,
      intro: ['棚には出荷されなかった予備の頭が、天井まで積み上がっている。', 'どれも、こちらを向いていた。', 'いちばん高い棚の上で、ばらばらの何かが寝返りを打った。'],
    },
  ];

  // ============================================================
  //  各チャプターのボス
  //  hunt = 追い回す(倒せない) / mission = 仕事を言いつけてくる
  // ============================================================
  const CHAPTER_BOSSES = {
    nightbear: {
      id: 'nightbear', name: '夜警のベア', mode: 'hunt', color: '#d8b04a',
      r: 40, art: 26, dmg: 34, voice: 150, staggerLight: 2.2,
      lines: {
        intro: ['……本日は 閉店 しました。', 'おきゃくさま は、もう いない はず。', 'ここは わたしの 持ち場 だ。'],
        spot: ['みつけた。', 'そこ か。', 'いい子は もう 帰る 時間 だ。'],
        lost: ['……どこへ 行った。', 'かくれんぼ は 好きだ。', 'まだ 終わって いない。'],
        goal: ['さわるな。', 'それは 店の もの だ。', 'ヒューズ が ひとつ 減った。'],
        ready: ['出口へは 行かせない。', 'ここに いなさい。ずっと。'],
        hit: ['まぶしい。', 'やめろ。', 'サーボ が 狂う。'],
      },
    },
    marionette: {
      id: 'marionette', name: 'プライズ係 マリオネット', mode: 'mission', color: '#8ae6b8',
      r: 34, art: 20, dmg: 26, voice: 260, staggerLight: 0.8,
      lines: {
        intro: ['あら。新しい バイトの 子。', '手が 足りないの。手伝って ちょうだい。', '三つ。三つ だけで いいの。'],
        m0: ['まず、オルゴールの ぜんまいを 巻いて。', '止まると、箱が 開いてしまうの。'],
        m1: ['次。壊れた 個体を 廃棄して。', '海賊ギツネ。四体。目を 入れ損ねた 子たち。'],
        m2: ['最後。わたしの 顔を 持ってきて。', 'パーティルームに 置き忘れたの。顔が ないと、笑えない。'],
        done0: ['ひとつ。よく できました。'],
        done1: ['ふたつ。手際が いいのね。'],
        done2: ['みっつ。……ああ、これ。これだわ。'],
        finish: ['合格。あなたは 合格よ。', '封鎖扉を 開けておいたわ。', '下の階には、話の 通じない 子が いるけれど。'],
        idle: ['まだ？', '手を 動かして。', '営業時間は 有限よ。あなたのは、特に。'],
      },
    },
    // 地下の主。ばらばらに解体されたまま繋ぎ直された個体で、赤い静電ガスを吐く。
    mangled: {
      id: 'mangled', name: 'マングルド', mode: 'hunt', color: '#d8bcd0',
      r: 56, art: 28, dmg: 42, voice: 104, staggerLight: 1.1, gas: true,
      lines: {
        intro: ['……ザッ。おきちゃ った。', 'いいこ は もう ねる じかん。', 'ねよう。ずっと ねよう。'],
        spot: ['みー つけ た。', 'そこ。あったかい におい。', 'にげ ない で。ねむい だけ でしょう。'],
        lost: ['どこ いっ た の。', 'かくれ ても におい で わかる。', 'まだ おき てる ね。'],
        goal: ['それ、もって いかない で。', 'かえし て。', 'そと に でても、さむい よ。'],
        ready: ['いか ない で。', 'ここ で ねて。ずっと ずっと。'],
        hit: ['……まぶ しい。', 'め が いた い。', 'やめ て。'],
      },
    },
  };

  // ============================================================
  //  収集メモ(読むと正気度が回復する)
  // ============================================================
  const NOTES = [
    { t: '来店アンケート(クレヨン)', b: 'たのしかったところ：ステージ。こわかったところ：うらのへや。あそんでくれたひと：きいろいくま。' },
    { t: '落とし物台帳', b: '5/14 赤い運動靴（片方）。5/18 誕生日の王冠。6/02 上着。― どれも、取りに戻った子はいない。' },
    { t: '従業員マニュアル 第4章', b: '着ぐるみは絶対に一人で着用しないこと。スプリング錠は湿気で外れる。中に人がいる状態で外れた場合、救助は間に合わない。' },
    { t: '新聞の切り抜き', b: '「ピザ店で児童5名が行方不明」。店内に争った形跡はなし。当日の記録映像は、ついに提出されなかった。' },
    { t: 'パーティ予約表', b: '7/3 ゆうた(6さい)。7/3 みお(5さい)。7/3 けんと(7さい)。全員のキャンセル欄に、同じ筆跡で「済」とある。' },
    { t: 'プライズ係の走り書き', b: 'オルゴールのぜんまいを切らすな。切れると箱が開く。開いたら走れ。それだけしか書いていない。' },
    { t: '整備日誌', b: '個体4号、夜間に単独で起動。ブレーカーを落としても歩いた。電気じゃないものが動かしている。' },
    { t: '設計図(走り書き入り)', b: '製品名：MOTHER。全長4.2m。中心部に炉を内蔵。備考「子どもたちを一体ずつ、内側に迎え入れる構造」。' },
    { t: '最後の監視ログ', b: '22:47 全個体をスリープ。22:52 全個体が再起動。操作者なし。23:03 にげ' },
  ];

  // ============================================================
  //  数学ユーティリティ
  // ============================================================
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
  const normAng = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const angDiff = (a, b) => Math.abs(normAng(a - b));
  const now = () => performance.now();

  /** 決定的な擬似乱数(mulberry32)。マップ生成の再現に使う。 */
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = makeRng(1);
  const rnd = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
  const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const chance = (p) => rng() < p;

  // ============================================================
  //  効果音・環境音(すべて WebAudio で合成。音声ファイルを持たない)
  // ============================================================
  const Audio2 = (function () {
    let ac = null, master = null, ambBus = null, sfxBus = null;
    let muted = false, started = false;
    let noiseBuf = null;
    let amb = null;          // 環境音ノードの束
    let tension = 0;         // 0..1 追跡されている度合い
    let nextCreak = 0, nextBox = 0;

    function ensure() {
      if (ac) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
      ambBus = ac.createGain(); ambBus.gain.value = 1.0; ambBus.connect(master);
      sfxBus = ac.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(master);
      // ホワイトノイズ源(使い回す)
      const len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return ac;
    }

    function t0() { return ac.currentTime; }

    /** 単純なオシレータ1発。 */
    function tone(o) {
      if (!ensure() || muted) return;
      const t = t0() + (o.delay || 0);
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + o.dur);
      const peak = (o.g === undefined ? 0.2 : o.g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (o.atk || 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      let node = osc;
      if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
      node.connect(g); g.connect(sfxBus);
      osc.start(t); osc.stop(t + o.dur + 0.05);
    }

    /** ノイズバースト(足音・衝撃・ノイズ演出)。 */
    function noise(o) {
      if (!ensure() || muted) return;
      const t = t0() + (o.delay || 0);
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = o.filter || 'bandpass';
      f.frequency.setValueAtTime(o.f, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
      f.Q.value = o.q === undefined ? 1.2 : o.q;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g === undefined ? 0.2 : o.g), t + (o.atk || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(f); f.connect(g); g.connect(sfxBus);
      src.start(t); src.stop(t + o.dur + 0.05);
    }

    // ---- 環境音(常時鳴らしっぱなしのドローン) ----
    function startAmbience() {
      if (!ensure() || amb) return;
      const mk = (type, f, gain, lp) => {
        const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
        const g = ac.createGain(); g.gain.value = gain;
        const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp;
        o.connect(fl); fl.connect(g); g.connect(ambBus); o.start();
        return { o, g, fl };
      };
      const a = mk('sawtooth', 41.2, 0.055, 150);
      const b = mk('sine', 62.0, 0.04, 220);
      const c = mk('triangle', 82.5, 0.018, 300);
      // 空調のような広がりノイズ
      const ns = ac.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
      const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 420; nf.Q.value = 0.6;
      const ng = ac.createGain(); ng.gain.value = 0.017;
      ns.connect(nf); nf.connect(ng); ng.connect(ambBus); ns.start();
      // ゆっくり揺れる LFO でフィルタを動かし、生きている感じを出す
      const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
      const lg = ac.createGain(); lg.gain.value = 60;
      lfo.connect(lg); lg.connect(b.fl.frequency); lfo.start();
      // 緊張時に足すパルス低音
      const pulse = ac.createOscillator(); pulse.type = 'sine'; pulse.frequency.value = 33;
      const pg = ac.createGain(); pg.gain.value = 0.0001;
      pulse.connect(pg); pg.connect(ambBus); pulse.start();
      amb = { a, b, c, ng, pulse, pg };
    }

    function stopAmbience() {
      if (!amb) return;
      try {
        [amb.a.o, amb.b.o, amb.c.o, amb.pulse].forEach((o) => { try { o.stop(); } catch (e) { /* 既に停止 */ } });
      } catch (e) { /* noop */ }
      amb = null;
    }

    /** 緊張度を渡すと環境音の厚みが変わる。 */
    function setTension(v) {
      tension = clamp(v, 0, 1);
      if (!amb || !ac) return;
      const t = t0();
      amb.pg.gain.setTargetAtTime(0.0001 + tension * 0.09, t, 0.35);
      amb.a.g.gain.setTargetAtTime(0.055 + tension * 0.05, t, 0.5);
      amb.pulse.frequency.setTargetAtTime(33 + tension * 22, t, 0.6);
    }

    /** 定期的に鳴る軋み・水滴・オルゴール。 */
    function ambientTick(tMs) {
      if (!ac || muted) return;
      if (tMs > nextCreak) {
        nextCreak = tMs + rnd(4200, 11000);
        if (chance(0.5)) noise({ f: rnd(220, 900), f2: rnd(90, 240), dur: rnd(0.5, 1.4), g: 0.05, q: 6 });
        else tone({ f: rnd(120, 300), f2: rnd(60, 150), dur: rnd(0.6, 1.6), g: 0.035, type: 'triangle' });
      }
      if (tMs > nextBox) {
        nextBox = tMs + rnd(16000, 34000);
        musicBox();
      }
    }

    /** 遠くで鳴るオルゴール。ホラーの定番。 */
    function musicBox() {
      if (!ensure() || muted) return;
      const scale = [523.25, 587.33, 622.25, 698.46, 783.99, 830.61, 932.33];
      let d = 0;
      for (let i = 0; i < 7; i++) {
        const f = scale[rndInt(0, scale.length - 1)];
        tone({ f, dur: 0.85, g: 0.035, type: 'sine', delay: d, atk: 0.004 });
        tone({ f: f * 2.01, dur: 0.5, g: 0.012, type: 'sine', delay: d, atk: 0.004 });
        d += rnd(0.28, 0.52);
      }
    }

    const S = {
      step: (run) => noise({ f: run ? 780 : 520, f2: 180, dur: 0.09, g: run ? 0.10 : 0.055, q: 1.0 }),
      swing: () => noise({ f: 1600, f2: 400, dur: 0.16, g: 0.14, q: 0.7 }),
      hit: () => { noise({ f: 900, f2: 130, dur: 0.2, g: 0.28, q: 0.8 }); tone({ f: 180, f2: 60, dur: 0.18, g: 0.2, type: 'square' }); },
      metal: () => { tone({ f: 1400, f2: 500, dur: 0.3, g: 0.13, type: 'square' }); noise({ f: 3000, f2: 900, dur: 0.25, g: 0.1, q: 3 }); },
      hurt: () => { tone({ f: 320, f2: 90, dur: 0.4, g: 0.3, type: 'sawtooth', lp: 900 }); noise({ f: 500, f2: 120, dur: 0.35, g: 0.16 }); },
      die: () => { tone({ f: 220, f2: 40, dur: 1.6, g: 0.34, type: 'sawtooth', lp: 700 }); noise({ f: 300, f2: 60, dur: 1.4, g: 0.2 }); },
      pickup: () => { tone({ f: 880, dur: 0.09, g: 0.14, type: 'triangle' }); tone({ f: 1320, dur: 0.12, g: 0.11, type: 'triangle', delay: 0.07 }); },
      heal: () => { tone({ f: 520, f2: 780, dur: 0.35, g: 0.13, type: 'sine' }); },
      click: () => noise({ f: 2200, f2: 900, dur: 0.05, g: 0.09, q: 2 }),
      lightOn: () => { noise({ f: 3400, f2: 1200, dur: 0.07, g: 0.12, q: 2 }); tone({ f: 1500, dur: 0.05, g: 0.05, type: 'square' }); },
      lightOff: () => { noise({ f: 1200, f2: 400, dur: 0.07, g: 0.1, q: 2 }); },
      lowBattery: () => { tone({ f: 1100, f2: 700, dur: 0.12, g: 0.07, type: 'square' }); },
      flash: () => { noise({ f: 6000, f2: 400, dur: 0.5, g: 0.3, q: 0.4, filter: 'lowpass' }); tone({ f: 2400, f2: 300, dur: 0.4, g: 0.12, type: 'sine' }); },
      // 一眼レフのシャッター。ミラーの跳ね上がり → 幕の走行 → ストロボのチャージ音。
      shutter: () => {
        noise({ f: 5200, f2: 1400, dur: 0.045, g: 0.24, q: 1.1 });
        noise({ f: 2400, f2: 700, dur: 0.075, g: 0.18, q: 1.4, delay: 0.05 });
        tone({ f: 1900, f2: 900, dur: 0.05, g: 0.07, type: 'square', delay: 0.01 });
        tone({ f: 3200, f2: 5200, dur: 0.5, g: 0.025, type: 'sine', delay: 0.12 });
      },
      stinger: () => {
        noise({ f: 8000, f2: 200, dur: 0.9, g: 0.36, q: 0.3, filter: 'lowpass' });
        tone({ f: 1200, f2: 55, dur: 1.0, g: 0.3, type: 'sawtooth', lp: 1800 });
        tone({ f: 1207, f2: 58, dur: 1.0, g: 0.28, type: 'sawtooth', lp: 1800 });
      },
      growl: () => { tone({ f: 110, f2: 48, dur: 0.9, g: 0.22, type: 'sawtooth', lp: 420 }); noise({ f: 260, f2: 90, dur: 0.8, g: 0.1, q: 2 }); },
      spring: () => { tone({ f: 300, f2: 1800, dur: 0.28, g: 0.2, type: 'square', lp: 2600 }); },
      heartbeat: () => { tone({ f: 62, f2: 40, dur: 0.16, g: 0.3, type: 'sine' }); tone({ f: 58, f2: 36, dur: 0.2, g: 0.22, type: 'sine', delay: 0.19 }); },
      door: () => { noise({ f: 300, f2: 90, dur: 1.1, g: 0.13, q: 5 }); },
      power: () => {
        tone({ f: 60, f2: 240, dur: 1.2, g: 0.2, type: 'sawtooth', lp: 900 });
        noise({ f: 400, f2: 3000, dur: 1.0, g: 0.12, q: 1 });
      },
      elevator: () => { tone({ f: 90, f2: 130, dur: 2.2, g: 0.18, type: 'square', lp: 400 }); },
      explode: () => { noise({ f: 1200, f2: 60, dur: 0.9, g: 0.34, q: 0.4, filter: 'lowpass' }); tone({ f: 160, f2: 30, dur: 0.8, g: 0.28, type: 'sawtooth', lp: 500 }); },
      throw: () => noise({ f: 900, f2: 2200, dur: 0.16, g: 0.09, q: 1 }),
      roar: () => {
        tone({ f: 90, f2: 32, dur: 2.4, g: 0.36, type: 'sawtooth', lp: 500 });
        tone({ f: 134, f2: 47, dur: 2.2, g: 0.22, type: 'square', lp: 700 });
        noise({ f: 500, f2: 80, dur: 2.4, g: 0.2, q: 1.5 });
      },
      whisper: () => noise({ f: rnd(900, 2600), f2: rnd(300, 700), dur: rnd(0.4, 1.0), g: 0.05, q: 8 }),
      // ボスの声。短い音を並べて「喋っている」ように聞かせる。
      voice: (base, len) => {
        const n = Math.max(3, Math.min(10, Math.round((len || 8) / 2)));
        for (let i = 0; i < n; i++) {
          const f = (base || 160) * (0.86 + ((i * 37) % 11) / 24);
          tone({ f, f2: f * 0.82, dur: 0.085, g: 0.075, type: 'square', lp: 1100, delay: i * 0.085 });
          tone({ f: f * 0.5, dur: 0.09, g: 0.05, type: 'sawtooth', lp: 600, delay: i * 0.085 });
        }
      },
      musicBox,
    };

    return {
      unlock() { ensure(); if (ac && ac.state === 'suspended') ac.resume(); started = true; },
      get started() { return started; },
      startAmbience, stopAmbience, setTension, ambientTick,
      toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.9; return muted; },
      get muted() { return muted; },
      sfx: S,
    };
  })();

  // ============================================================
  //  キャンバスとグローバル状態
  // ============================================================
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  // 暗闇レイヤー(可視ポリゴンで穴を開ける)
  const lightCv = document.createElement('canvas');
  lightCv.width = VIEW_W; lightCv.height = VIEW_H;
  const lctx = lightCv.getContext('2d');
  // 静的な床・壁を焼き込むタイルバッファ(マップ全体)
  let bakeCv = null, bctx = null;

  const miniCv = document.getElementById('minimap');
  const mctx = miniCv ? miniCv.getContext('2d') : null;

  let state = 'title';        // title | select | cut | briefing | play | paused | safe | note | dead | win
  let lastT = 0, gameT = 0;   // gameT はプレイ中のみ進む秒
  let frame = 0;
  let fpsSmooth = 60;

  const cam = { x: 0, y: 0, shake: 0, shakeT: 0 };
  const fx = {
    flash: 0,          // 白フラッシュ
    hurt: 0,           // 赤ビネット
    chroma: 0,         // 色ずれ
    stinger: 0,        // ジャンプスケア演出
    blind: 0,          // 閃光による白飛び
    letter: 0,         // シネマ用レターボックス
  };

  let map = null;             // 現在のフロア
  let player = null;
  let enemies = [], items = [], props = [], parts = [], shots = [], decals = [], floats = [], lamps = [];
  let boss = null;
  let mapOpen = false;        // Tab で開く全体マップ

  const run = {
    charId: 'guard', diff: 'normal', floorIdx: 0,
    mods: {}, notes: [], stats: null, seed: 1,
  };

  const HUD = {};             // DOM 参照をまとめる
  function $(id) { return document.getElementById(id); }

  // ============================================================
  //  入力
  // ============================================================
  const keys = Object.create(null);
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, wx: 0, wy: 0, down: false, rdown: false };
  const touch = {
    on: false,
    move: { id: null, bx: 0, by: 0, dx: 0, dy: 0, mag: 0 },
    aim: { id: null, bx: 0, by: 0, dx: 0, dy: 0, mag: 0 },
    attack: false, focus: false, sprint: false, hold: false,
  };
  const pressed = Object.create(null);   // 単発判定用(このフレームで押された)

  function keyDown(e) {
    const k = e.key.toLowerCase();
    if (!keys[k]) pressed[k] = true;
    keys[k] = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    Audio2.unlock();
  }
  function keyUp(e) { keys[e.key.toLowerCase()] = false; }

  function wasPressed(k) { return !!pressed[k]; }
  function clearPressed() { for (const k in pressed) delete pressed[k]; }

  /** 画面座標 → キャンバス内部座標 */
  function toCanvas(clientX, clientY) {
    const r = cv.getBoundingClientRect();
    return { x: (clientX - r.left) * (VIEW_W / r.width), y: (clientY - r.top) * (VIEW_H / r.height) };
  }

  function bindInput() {
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

    cv.addEventListener('mousemove', (e) => {
      const p = toCanvas(e.clientX, e.clientY);
      mouse.x = p.x; mouse.y = p.y;
    });
    // ポインタをロックして、マウスの移動量そのもので視点を回す
    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === cv;
      document.body.classList.toggle('locked', pointerLocked);
      // Esc でロックが外れたときは、そのまま一時停止にする
      if (!pointerLocked && state === 'play') setState('paused');
    });
    document.addEventListener('mousemove', (e) => {
      if (!pointerLocked) return;
      lookYaw += e.movementX * MOUSE_SENS;
      lookPitch = clamp(lookPitch - e.movementY * MOUSE_SENS * 0.9, -0.5, 0.5);
    });
    cv.addEventListener('mousedown', (e) => {
      Audio2.unlock();
      if (e.button === 0) { mouse.down = true; if (state === 'play') requestLook(); }
      if (e.button === 2) mouse.rdown = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) mouse.down = false;
      if (e.button === 2) mouse.rdown = false;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- タッチ(スマホ) ---
    const stickMove = $('stick-move'), stickAim = $('stick-aim');
    function stickStart(st, el, t) {
      const r = el.getBoundingClientRect();
      st.id = t.identifier; st.bx = r.left + r.width / 2; st.by = r.top + r.height / 2;
      stickMoveTo(st, t);
    }
    function stickMoveTo(st, t) {
      const dx = t.clientX - st.bx, dy = t.clientY - st.by;
      const m = Math.hypot(dx, dy), max = 56;
      const k = m > max ? max / m : 1;
      st.dx = dx * k; st.dy = dy * k; st.mag = Math.min(1, m / max);
    }
    function stickEnd(st) { st.id = null; st.dx = 0; st.dy = 0; st.mag = 0; }

    function onTouchStart(e) {
      Audio2.unlock();
      touch.on = true;
      for (const t of e.changedTouches) {
        const half = window.innerWidth / 2;
        if (t.clientX < half && touch.move.id === null) stickStart(touch.move, stickMove, t);
        else if (t.clientX >= half && touch.aim.id === null) stickStart(touch.aim, stickAim, t);
      }
    }
    function onTouchMove(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === touch.move.id) stickMoveTo(touch.move, t);
        else if (t.identifier === touch.aim.id) stickMoveTo(touch.aim, t);
      }
      e.preventDefault();
    }
    function onTouchEnd(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === touch.move.id) stickEnd(touch.move);
        else if (t.identifier === touch.aim.id) stickEnd(touch.aim);
      }
    }
    const tl = $('touch');
    if (tl) {
      tl.addEventListener('touchstart', onTouchStart, { passive: false });
      tl.addEventListener('touchmove', onTouchMove, { passive: false });
      tl.addEventListener('touchend', onTouchEnd);
      tl.addEventListener('touchcancel', onTouchEnd);
    }
    const holdBtn = (id, set) => {
      const el = $(id); if (!el) return;
      el.addEventListener('touchstart', (e) => { set(true); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      el.addEventListener('touchend', (e) => { set(false); e.preventDefault(); e.stopPropagation(); });
      el.addEventListener('touchcancel', () => set(false));
    };
    const tapBtn = (id, fn) => {
      const el = $(id); if (!el) return;
      el.addEventListener('touchstart', (e) => { fn(); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      el.addEventListener('click', (e) => { fn(); e.preventDefault(); });
    };
    holdBtn('t-attack', (v) => { touch.attack = v; });
    holdBtn('t-focus', (v) => { touch.focus = v; });
    holdBtn('t-sprint', (v) => { touch.sprint = v; });
    holdBtn('t-breath', (v) => { touch.hold = v; });
    tapBtn('t-use', () => { pressed['e'] = true; });
    tapBtn('t-ability', () => { pressed['q'] = true; });
    tapBtn('t-light', () => { pressed['f'] = true; });
    tapBtn('t-heal', () => { pressed['r'] = true; });
    tapBtn('t-grab', () => { pressed['g'] = true; });
    tapBtn('t-map', () => { pressed['tab'] = true; });
    tapBtn('t-crouch', () => { keys['control'] = !keys['control']; });

    // スマホ判定でタッチUIを出す
    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) {
      touch.on = true;
      if (tl) tl.classList.remove('hidden');
      document.body.classList.add('is-touch');
    }
  }

  /**
   * 移動入力。一人称なので前後(fwd)と左右への踏み出し(str)を返す。
   * 矢印キーの左右はその場での旋回にあてる(下の updateLook)。
   */
  function readMove() {
    let fwd = 0, str = 0;
    if (keys['w'] || keys['arrowup']) fwd += 1;
    if (keys['s'] || keys['arrowdown']) fwd -= 1;
    if (keys['a']) str -= 1;
    if (keys['d']) str += 1;
    if (touch.move.mag > 0.12) { str = touch.move.dx / 56; fwd = -touch.move.dy / 56; }
    const m = Math.hypot(fwd, str);
    if (m > 1) { fwd /= m; str /= m; }
    return { fwd, str, mag: Math.min(1, m) };
  }

  // --- 視点 ---
  const MOUSE_SENS = 0.0024;
  const TURN_SPEED = 2.5;             // キーボードでの旋回(rad/秒)
  let lookYaw = 0, lookPitch = 0;
  let pointerLocked = false;

  /** 視線を1フレーム進める。マウス・キー・タッチのどれからでも回せる。 */
  function updateLook(dt) {
    if (keys['arrowleft']) lookYaw -= TURN_SPEED * dt;
    if (keys['arrowright']) lookYaw += TURN_SPEED * dt;
    if (touch.aim.mag > 0.14) {
      lookYaw += (touch.aim.dx / 56) * 2.9 * dt;
      lookPitch = clamp(lookPitch - (touch.aim.dy / 56) * 1.4 * dt, -0.5, 0.5);
    } else if (!pointerLocked && !touch.on) {
      // ポインタロックを使わない場合は、画面の端へマウスを寄せると振り向く
      const dx = (mouse.x - VIEW_W / 2) / (VIEW_W / 2);
      if (Math.abs(dx) > 0.14) lookYaw += Math.sign(dx) * (Math.abs(dx) - 0.14) * 3.4 * dt;
      lookPitch = clamp(-(mouse.y - VIEW_H / 2) / (VIEW_H / 2) * 0.34, -0.5, 0.5);
    }
    lookYaw = normAng(lookYaw);
    if (player) player.aim = lookYaw;
    fpc.pitch = lookPitch;
  }

  /** 照準角 = 視線の向き。懐中電灯も得物も、見ている方へ向く。 */
  function readAim() { return lookYaw; }

  function requestLook() {
    if (touch.on || pointerLocked) return;
    if (cv.requestPointerLock) { try { cv.requestPointerLock(); } catch (err) { /* 使えない環境では端寄せで回す */ } }
  }

  const isAttacking = () => mouse.down || touch.attack || keys['j'];
  const isFocusing = () => mouse.rdown || touch.focus || keys['k'];
  const isSprinting = () => keys['shift'] || touch.sprint;
  const isCrouching = () => keys['control'] || keys['c'];

  // ============================================================
  //  マップ生成(BSP で部屋を切り、通路でつなぐ)
  // ============================================================
  // 部屋の種類。フロア定義の kinds で出現する組み合わせが変わる。
  const ROOM_KINDS = ['stage', 'dining', 'cove', 'arcade', 'kitchen', 'restroom', 'party',
    'prize', 'ballpit', 'parts', 'backstage', 'utility', 'storage', 'office', 'locker', 'hall'];
  // フロアごとに 1 部屋だけ必ず置く「看板の部屋」。
  const SIGNATURE_ROOMS = { DINER: ['stage', 'cove', 'kitchen'], PARTY: ['prize', 'ballpit', 'party'], PARTS: ['parts', 'backstage', 'utility'] };
  const ROOM_LABELS = {
    stage: 'ショーステージ', dining: 'ダイニング', cove: '海賊の入り江', arcade: 'ゲームコーナー',
    kitchen: '厨房', restroom: 'トイレ', party: 'パーティルーム', prize: 'プライズコーナー',
    ballpit: 'ボールピット', parts: 'パーツ&サービス', backstage: 'バックステージ',
    utility: '機械室', storage: '倉庫', office: '事務室', locker: 'ロッカー室', hall: '廊下',
  };

  function makeMap(w, h) {
    return {
      w, h, pxW: w * TILE, pxH: h * TILE,
      cells: new Uint8Array(w * h),   // 0=壁 1=床
      seen: new Uint8Array(w * h),    // ミニマップ用の踏破フラグ
      rooms: [], occ: [],
      spawn: { x: 0, y: 0 }, exit: null, def: null, arena: false,
    };
  }
  const idx = (m, x, y) => y * m.w + x;
  const cellAt = (m, x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h) ? 0 : m.cells[y * m.w + x];
  const isFloorTile = (m, x, y) => cellAt(m, x, y) === 1;

  /** ワールド座標が壁の中か。 */
  function isSolidPx(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return !isFloorTile(map, tx, ty);
  }

  function carveRect(m, x, y, w, h) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        if (i > 0 && j > 0 && i < m.w - 1 && j < m.h - 1) m.cells[idx(m, i, j)] = 1;
      }
    }
  }
  function carveCorridor(m, ax, ay, bx, by, wide) {
    const half = wide ? 1 : 0;
    if (chance(0.5)) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carveRect(m, x, ay - half, 1, 1 + half * 2);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carveRect(m, bx - half, y, 1 + half * 2, 1);
    } else {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carveRect(m, ax - half, y, 1 + half * 2, 1);
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carveRect(m, x, by - half, 1, 1 + half * 2);
    }
  }

  /** 空間を再帰的に分割して部屋の枠を得る。 */
  function bspSplit(node, depth, out, minSize) {
    if (depth <= 0 || (node.w < minSize * 2 && node.h < minSize * 2)) { out.push(node); return; }
    const horizontal = node.w < node.h ? true : (node.h < node.w ? false : chance(0.5));
    if (horizontal) {
      if (node.h < minSize * 2) { out.push(node); return; }
      const cut = rndInt(minSize, node.h - minSize);
      bspSplit({ x: node.x, y: node.y, w: node.w, h: cut }, depth - 1, out, minSize);
      bspSplit({ x: node.x, y: node.y + cut, w: node.w, h: node.h - cut }, depth - 1, out, minSize);
    } else {
      if (node.w < minSize * 2) { out.push(node); return; }
      const cut = rndInt(minSize, node.w - minSize);
      bspSplit({ x: node.x, y: node.y, w: cut, h: node.h }, depth - 1, out, minSize);
      bspSplit({ x: node.x + cut, y: node.y, w: node.w - cut, h: node.h }, depth - 1, out, minSize);
    }
  }

  /** 視線をさえぎる什器(棚・木箱など)を登録する。 */
  function addOccluder(m, x, y, w, h) { m.occ.push({ x, y, w, h }); }

  /** 部屋の中でランダムな床タイルを返す(足りない場合は中心)。 */
  function randFloorIn(m, room, margin = 1) {
    for (let k = 0; k < 40; k++) {
      const x = rndInt(room.x + margin, room.x + room.w - 1 - margin);
      const y = rndInt(room.y + margin, room.y + room.h - 1 - margin);
      if (isFloorTile(m, x, y)) return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
    }
    return { x: (room.x + room.w / 2) * TILE, y: (room.y + room.h / 2) * TILE };
  }

  function overlapsProp(px, py, r) {
    for (const p of props) {
      if (!p.solid) continue;
      if (px + r > p.x && px - r < p.x + p.w && py + r > p.y && py - r < p.y + p.h) return true;
    }
    return false;
  }

  /** 何も置かれていない安全な床座標を探す。 */
  function findOpen(m, room, r = 18, tries = 30) {
    for (let k = 0; k < tries; k++) {
      const p = randFloorIn(m, room, 1);
      if (!overlapsProp(p.x, p.y, r) && !isSolidPx(p.x, p.y)) return p;
    }
    return randFloorIn(m, room, 1);
  }

  // ------------------------------------------------------------
  //  設備・小物を置く
  // ------------------------------------------------------------
  function addProp(type, x, y, w, h, opt) {
    const p = Object.assign({ type, x, y, w, h, solid: true, hp: 0, seedv: rnd(1000) }, opt || {});
    props.push(p);
    if (p.occlude) addOccluder(map, x, y, w, h);
    return p;
  }
  function addLamp(x, y, r, color, flicker) {
    lamps.push({ x, y, r, color: color || '#ffe9b0', flicker: flicker === undefined ? 0.35 : flicker, on: true, t: rnd(10), broken: false });
  }

  // ------------------------------------------------------------
  //  子どもがいた痕跡
  //  どの部屋にも少しずつ落ちている。読み物ではなく、風景として置く。
  // ------------------------------------------------------------
  const CHILD_JUNK = ['partyhat', 'juicecup', 'lostshoe', 'drawing', 'crayon', 'teddy', 'balloon'];

  /** 落とし物・落書きをまき散らす。heavy な部屋ほど濃く残っている。 */
  function addChildTraces(m, room, n, opt) {
    const o = opt || {};
    for (let i = 0; i < n; i++) {
      const p = findOpen(m, room, 14, 12);
      const type = pick(o.only || CHILD_JUNK);
      if (type === 'balloon') addProp('balloon', p.x - 11, p.y - 11, 22, 22, { solid: false, hue: pick(['#d84a4a', '#4a86d8', '#e0c24a', '#63c46a']) });
      else if (type === 'drawing') addProp('drawing', p.x - 13, p.y - 10, 26, 20, { solid: false, motif: rndInt(0, 3) });
      else if (type === 'lostshoe') addProp('lostshoe', p.x - 11, p.y - 7, 22, 14, { solid: false, hue: pick(['#c04a3a', '#4a5ac0', '#d8d4c6']) });
      else if (type === 'teddy') addProp('teddy', p.x - 11, p.y - 11, 22, 22, { solid: false, hue: pick(['#8a6a4a', '#b08a5a', '#6a5a7a']) });
      else if (type === 'crayon') addProp('crayon', p.x - 8, p.y - 5, 16, 10, { solid: false, hue: pick(['#d84a4a', '#4a86d8', '#e0c24a', '#63c46a', '#a06ad0']) });
      else if (type === 'juicecup') addProp('juicecup', p.x - 8, p.y - 8, 16, 16, { solid: false, hue: pick(['#d8604a', '#e0a83a', '#7ac06a']) });
      else addProp('partyhat', p.x - 9, p.y - 11, 18, 22, { solid: false, hue: pick(['#d84a7a', '#4a86d8', '#e0c24a', '#63c46a']) });
    }
    // 小さな手形・足跡
    for (let i = 0; i < (o.prints === undefined ? 2 : o.prints); i++) {
      const p = randFloorIn(m, room, 1);
      decals.push({ x: p.x, y: p.y, r: 9, a: rnd(0.16, 0.32), c: chance(0.6) ? '#5a1c1c' : '#3a2a18', rot: rnd(TAU), kind: chance(0.5) ? 'hand' : 'foot' });
    }
  }

  /** 部屋の四辺のうちランダムな1辺に沿った座標(壁ぎわの什器用)。 */
  function wallPoint(room, k) {
    const rx = room.x * TILE, ry = room.y * TILE, rw = room.w * TILE, rh = room.h * TILE;
    switch (rndInt(0, 3)) {
      case 0: return { x: rnd(rx + k, rx + rw - k), y: ry + k, side: 'top' };
      case 1: return { x: rx + rw - k, y: rnd(ry + k, ry + rh - k), side: 'right' };
      case 2: return { x: rnd(rx + k, rx + rw - k), y: ry + rh - k, side: 'bottom' };
      default: return { x: rx + k, y: rnd(ry + k, ry + rh - k), side: 'left' };
    }
  }

  /**
   * 壁ぎわの置き場所。通路の出入口はふさがない(ふさぐと部屋に入れなくなる)。
   * 何度か試して見つからなければ、部屋の中の空いている床に逃がす。
   */
  function alongWall(room, inset) {
    const k = inset === undefined ? 30 : inset;
    for (let t = 0; t < 24; t++) {
      const p = wallPoint(room, k);
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      if (!isFloorTile(map, tx, ty)) continue;
      const ox = p.side === 'left' ? tx - 1 : p.side === 'right' ? tx + 1 : tx;
      const oy = p.side === 'top' ? ty - 1 : p.side === 'bottom' ? ty + 1 : ty;
      if (isFloorTile(map, ox, oy)) continue;      // ここは通路の口
      if (overlapsProp(p.x, p.y, 24)) continue;
      return p;
    }
    const f = findOpen(map, room, 24);
    return { x: f.x, y: f.y, side: 'top' };
  }

  // ------------------------------------------------------------
  //  小物・設備の配置
  // ------------------------------------------------------------
  function furnishRoom(m, room) {
    const rx = room.x * TILE, ry = room.y * TILE, rw = room.w * TILE, rh = room.h * TILE;
    const cx = rx + rw / 2, cy = ry + rh / 2;
    const kind = room.kind;
    const horiz = room.w >= room.h;

    if (kind === 'stage') {
      // 一段高いショーステージ。奥に星柄の緞帳。
      const sw = Math.min(rw - TILE * 2, 300), sh = Math.min(rh - TILE * 2, 190);
      addProp('stagefloor', cx - sw / 2, cy - sh / 2, sw, sh, { solid: false });
      addProp('curtain', cx - sw / 2 - 14, cy - sh / 2 - 16, sw + 28, 26, { occlude: true, hue: '#5a2060' });
      for (let i = 0; i < 3; i++) addProp('micstand', cx - 80 + i * 80 - 7, cy - 6, 14, 14, { solid: false });
      addProp('speaker', rx + 26, cy - 24, 30, 48, { occlude: true });
      addProp('speaker', rx + rw - 56, cy - 24, 30, 48, { occlude: true });
      addLamp(cx - 70, cy - 40, 210, '#ff7a8a', 0.5);
      addLamp(cx + 70, cy - 40, 210, '#7aa8ff', 0.5);
      addChildTraces(m, room, 4, { prints: 4 });
    } else if (kind === 'dining') {
      // 白黒チェックの床に、丸テーブルと子ども椅子。
      const n = rndInt(3, 5);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 34);
        addProp('partytable', p.x - 30, p.y - 30, 60, 60, { occlude: true, seedv: rnd(1000) });
        const seats = rndInt(2, 4);
        for (let k = 0; k < seats; k++) {
          const a = rnd(TAU);
          addProp('chair', p.x + Math.cos(a) * 44 - 10, p.y + Math.sin(a) * 44 - 10, 20, 20, { solid: false, hue: pick(['#c0433a', '#3a6ac0', '#c9a33a']) });
        }
      }
      if (chance(0.7)) { const w = alongWall(room, 34); addProp('standee', w.x - 18, w.y - 18, 36, 36, { occlude: true, who: pick(['bear', 'bunny', 'chick', 'fox']) }); }
      addLamp(cx, cy, rnd(180, 250), '#ffe2a8', rnd(0.3, 0.8));
      addChildTraces(m, room, 5, { prints: 3 });
    } else if (kind === 'cove') {
      // 海賊の入り江。閉じたカーテンの奥に、そいつはいる。
      addProp('curtain', cx - 90, cy - 60, 180, 26, { occlude: true, hue: '#6a2040' });
      addProp('pirateship', cx - 54, cy - 16, 108, 60, { occlude: true });
      addProp('standee', rx + 30, cy - 18, 36, 36, { occlude: true, who: 'fox' });
      addProp('sign', cx - 26, cy - 74, 52, 24, { solid: false, text: 'OUT OF ORDER' });
      addLamp(cx, cy, 160, '#c86a3a', 0.75);
      addChildTraces(m, room, 3, { prints: 2 });
    } else if (kind === 'arcade') {
      const n = rndInt(3, 6);
      for (let i = 0; i < n; i++) {
        const w = alongWall(room, 32);
        addProp('arcade', w.x - 20, w.y - 16, 40, 32, { occlude: true, hue: pick(['#3a6ad0', '#d03a6a', '#3ad08a']), seedv: rnd(1000) });
      }
      if (chance(0.6)) { const p = findOpen(m, room, 30); addProp('skeeball', p.x - 22, p.y - 46, 44, 92, { occlude: true }); }
      if (chance(0.5)) { const p = findOpen(m, room, 22); addProp('ticketbin', p.x - 18, p.y - 14, 36, 28, { occlude: false }); }
      addLamp(cx, cy, 170, '#8ad4ff', 0.65);
      addChildTraces(m, room, 3, { only: ['juicecup', 'partyhat', 'drawing'], prints: 2 });
    } else if (kind === 'kitchen') {
      addProp('counter', rx + TILE, cy - 20, rw - TILE * 2, 40, { occlude: true, hue: '#7a8088' });
      const n = rndInt(1, 2);
      for (let i = 0; i < n; i++) { const w = alongWall(room, 34); addProp('oven', w.x - 24, w.y - 20, 48, 40, { occlude: true }); }
      if (chance(0.8)) { const w = alongWall(room, 30); addProp('pizzarack', w.x - 26, w.y - 16, 52, 32, { occlude: true }); }
      if (chance(0.7)) { const w = alongWall(room, 26); addProp('sink', w.x - 22, w.y - 14, 44, 28, { occlude: false }); }
      addLamp(cx, cy, 200, '#bfe6ff', rnd(0.4, 0.9));
      for (let i = 0; i < 3; i++) { const p = randFloorIn(m, room, 1); decals.push({ x: p.x, y: p.y, r: rnd(20, 46), a: rnd(0.16, 0.3), c: '#4a2a12', rot: rnd(TAU) }); }
      addChildTraces(m, room, 1, { only: ['drawing'], prints: 0 });
    } else if (kind === 'restroom') {
      const n = rndInt(2, 4);
      for (let i = 0; i < n; i++) {
        const w = alongWall(room, 28);
        addProp('stall', w.x - 22, w.y - 20, 44, 40, { occlude: true, usable: true, hideSlot: true, open: false });
      }
      for (let i = 0; i < 2; i++) { const w = alongWall(room, 24); addProp('sink', w.x - 20, w.y - 13, 40, 26, { occlude: false }); }
      addLamp(cx, cy, 140, '#cfe4ff', rnd(0.5, 0.95));
      addChildTraces(m, room, 2, { only: ['drawing', 'crayon', 'lostshoe'], prints: 4 });
    } else if (kind === 'party') {
      // 誕生日会の部屋。ろうそくは立ったまま、十年ぶん短くなっていない。
      if (horiz) addProp('partytable', cx - (rw - TILE * 3) / 2, cy - 26, rw - TILE * 3, 52, { occlude: true, long: true });
      else addProp('partytable', cx - 26, cy - (rh - TILE * 3) / 2, 52, rh - TILE * 3, { occlude: true, long: true });
      addProp('cake', cx - 18, cy - 18, 36, 36, { solid: false, candles: rndInt(4, 7) });
      const seats = rndInt(4, 7);
      for (let i = 0; i < seats; i++) {
        const p = findOpen(m, room, 18);
        addProp('chair', p.x - 10, p.y - 10, 20, 20, { solid: false, hue: pick(['#c0433a', '#3a6ac0', '#c9a33a']) });
      }
      if (chance(0.8)) { const p = findOpen(m, room, 20); addProp('giftbox', p.x - 17, p.y - 17, 34, 34, { occlude: true, hue: pick(['#c0433a', '#3a6ac0', '#63a04a']) }); }
      addLamp(cx, cy, rnd(160, 220), '#ffd0a8', rnd(0.3, 0.8));
      addChildTraces(m, room, 7, { prints: 5 });
    } else if (kind === 'prize') {
      addProp('prizecounter', cx - (horiz ? 70 : 24), cy - (horiz ? 24 : 70), horiz ? 140 : 48, horiz ? 48 : 140, { occlude: true });
      const n = rndInt(2, 4);
      for (let i = 0; i < n; i++) {
        const w = alongWall(room, 32);
        addProp('plushshelf', w.x - 34, w.y - 18, 68, 36, { occlude: true, seedv: rnd(1000) });
      }
      addProp('musicbox', cx - 20 + rnd(-60, 60), cy - 20 + rnd(-60, 60), 40, 40, { occlude: false });
      if (chance(0.6)) { const p = findOpen(m, room, 20); addProp('ticketbin', p.x - 18, p.y - 14, 36, 28, {}); }
      addLamp(cx, cy, 190, '#ffb0e0', 0.45);
      addChildTraces(m, room, 4, { prints: 3 });
    } else if (kind === 'ballpit') {
      const bw = Math.min(rw - TILE * 2, 260), bh = Math.min(rh - TILE * 2, 200);
      addProp('ballpit', cx - bw / 2, cy - bh / 2, bw, bh, { solid: false, seedv: rnd(1000) });
      addProp('slide', cx - bw / 2 - 30, cy - 40, 40, 80, { occlude: true });
      addLamp(cx, cy, 180, '#a8e0ff', 0.4);
      addChildTraces(m, room, 5, { prints: 6 });
    } else if (kind === 'parts') {
      // パーツ&サービス。空の着ぐるみと、外された頭。
      const n = rndInt(2, 3);
      for (let i = 0; i < n; i++) { const p = findOpen(m, room, 30); addProp('workbench', p.x - 38, p.y - 22, 76, 44, { occlude: true }); }
      for (let i = 0; i < rndInt(1, 3); i++) { const w = alongWall(room, 32); addProp('suitrack', w.x - 30, w.y - 16, 60, 32, { occlude: true, seedv: rnd(1000) }); }
      if (chance(0.8)) { const w = alongWall(room, 32); addProp('headshelf', w.x - 32, w.y - 16, 64, 32, { occlude: true, seedv: rnd(1000) }); }
      if (chance(0.7)) { const p = findOpen(m, room, 24); addProp('endoparts', p.x - 26, p.y - 20, 52, 40, { solid: false, seedv: rnd(1000) }); }
      addLamp(cx, cy, 150, '#cfe0ff', rnd(0.5, 0.95));
      addChildTraces(m, room, 1, { only: ['lostshoe', 'drawing'], prints: 1 });
    } else if (kind === 'backstage') {
      for (let i = 0; i < rndInt(2, 4); i++) { const w = alongWall(room, 32); addProp('headshelf', w.x - 32, w.y - 16, 64, 32, { occlude: true, seedv: rnd(1000) }); }
      if (chance(0.8)) { const w = alongWall(room, 32); addProp('suitrack', w.x - 30, w.y - 16, 60, 32, { occlude: true, seedv: rnd(1000) }); }
      if (chance(0.6)) { const p = findOpen(m, room, 26); addProp('workbench', p.x - 38, p.y - 22, 76, 44, { occlude: true }); }
      addLamp(cx, cy, 120, '#9fb0c8', 0.9);
      addChildTraces(m, room, 1, { only: ['drawing', 'lostshoe'], prints: 2 });
    } else if (kind === 'utility') {
      addProp('boiler', cx - 30, cy - 30, 60, 60, { occlude: true });
      for (let i = 0; i < rndInt(2, 4); i++) { const p = findOpen(m, room, 24); addProp('barrel', p.x - 18, p.y - 18, 36, 36, { occlude: chance(0.5) }); }
      if (chance(0.7)) { const w = alongWall(room, 24); addProp('vent', w.x - 20, w.y - 14, 40, 28, { solid: false }); }
      addLamp(cx, cy, 130, '#ffb070', 0.8);
    } else if (kind === 'storage') {
      const n = rndInt(3, 6);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 30);
        const vertical = chance(0.5);
        const w = vertical ? 36 : 96, h = vertical ? 96 : 36;
        addProp('shelf', p.x - w / 2, p.y - h / 2, w, h, { occlude: true });
      }
      if (chance(0.7)) { const p = findOpen(m, room, 26); addProp('headpile', p.x - 30, p.y - 26, 60, 52, { solid: false }); }
      if (chance(0.5)) { const p = findOpen(m, room, 26); addProp('crate', p.x - 24, p.y - 24, 48, 48, { occlude: true }); }
      addChildTraces(m, room, 2, { only: ['lostshoe', 'teddy', 'drawing'], prints: 1 });
    } else if (kind === 'office') {
      const n = rndInt(1, 3);
      for (let i = 0; i < n; i++) { const p = findOpen(m, room, 26); addProp('desk', p.x - 40, p.y - 24, 80, 48, { occlude: true }); }
      if (chance(0.85)) { const w = alongWall(room, 30); addProp('monitors', w.x - 30, w.y - 18, 60, 36, { occlude: true, seedv: rnd(1000) }); }
      if (chance(0.7)) { const p = findOpen(m, room, 20); addProp('fan', p.x - 14, p.y - 14, 28, 28, { solid: false }); }
      if (chance(0.8)) { const w = alongWall(room, 26); addProp('poster', w.x - 20, w.y - 14, 40, 28, { solid: false, kind: chance(0.5) ? 'missing' : 'rule' }); }
      if (chance(0.6)) { const p = findOpen(m, room, 22); addProp('cabinet', p.x - 20, p.y - 16, 40, 32, { occlude: true }); }
      addLamp(cx, cy, 150, '#bfe6ff', rnd(0.4, 0.9));
    } else if (kind === 'locker') {
      const n = rndInt(3, 6);
      for (let i = 0; i < n; i++) {
        const w = alongWall(room, 26);
        addProp('locker', w.x - 22, w.y - 16, 44, 32, { occlude: true, usable: true, hideSlot: true });
      }
      addChildTraces(m, room, 1, { only: ['lostshoe', 'partyhat'], prints: 1 });
    } else { // hall ― 廊下。ポスターと通気口、そして壁ぎわの落書き。
      if (chance(0.7)) { const w = alongWall(room, 26); addProp('poster', w.x - 20, w.y - 14, 40, 28, { solid: false, kind: pick(['missing', 'show', 'rule']) }); }
      if (chance(0.55)) { const w = alongWall(room, 24); addProp('vent', w.x - 20, w.y - 14, 40, 28, { solid: false }); }
      if (chance(0.5)) { const w = alongWall(room, 30); addProp('standee', w.x - 18, w.y - 18, 36, 36, { occlude: true, who: pick(['bear', 'bunny', 'chick', 'fox']) }); }
      if (chance(0.45)) { const p = findOpen(m, room, 28); addProp('pillar', p.x - 22, p.y - 22, 44, 44, { occlude: true }); }
      addChildTraces(m, room, 3, { prints: 3 });
    }

    // どの部屋にも切れかけの蛍光灯が入りうる
    if (chance(0.32)) addLamp(rx + rnd(TILE, rw - TILE), ry + rnd(TILE, rh - TILE), rnd(140, 220), chance(0.3) ? '#bfe6ff' : '#ffe2a8', rnd(0.25, 0.9));

    // 中身の抜けた着ぐるみ。潜り込んでやり過ごせる。
    if (chance(0.55)) {
      const p = findOpen(m, room, 22);
      addProp('plush', p.x - 20, p.y - 20, 40, 40, { usable: true, kind: pick(PLUSH_KINDS), used: false });
    }
    // 散らばった破片
    for (let i = 0; i < rndInt(1, 4); i++) {
      const p = randFloorIn(m, room, 1);
      addProp('debris', p.x - 10, p.y - 8, 20, 16, { solid: false });
    }
  }

  // ------------------------------------------------------------
  //  フロアを1枚まるごと生成
  // ------------------------------------------------------------
  function genFloor(fi) {
    const def = FLOORS[fi];
    rng = makeRng(run.seed + fi * 7919);
    const m = makeMap(def.mapW, def.mapH);
    m.def = def;
    map = m;
    enemies = []; items = []; props = []; parts = []; shots = []; decals = []; floats = []; lamps = [];
    boss = null; stalker = null; gasClouds = [];
    dlg.q.length = 0; dlg.text = ''; dlg.t = 0;

    // --- BSP で部屋を作る ---
    const leaves = [];
    bspSplit({ x: 1, y: 1, w: m.w - 2, h: m.h - 2 }, 5, leaves, 9);
    const rooms = [];
    for (const lf of leaves) {
      if (rooms.length >= def.rooms + 4) break;
      const w = Math.max(5, Math.min(lf.w - 2, rndInt(6, Math.max(7, lf.w - 2))));
      const h = Math.max(5, Math.min(lf.h - 2, rndInt(5, Math.max(6, lf.h - 2))));
      const x = lf.x + rndInt(1, Math.max(1, lf.w - w - 1));
      const y = lf.y + rndInt(1, Math.max(1, lf.h - h - 1));
      const room = { x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2), kind: pick(def.kinds || ROOM_KINDS) };
      rooms.push(room);
      carveRect(m, x, y, w, h);
    }
    // --- 通路でつなぐ(隣り合う順にたどり、いくつか環状も作る) ---
    rooms.sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy));
    for (let i = 1; i < rooms.length; i++) {
      carveCorridor(m, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy, chance(0.45));
    }
    for (let i = 0; i < Math.floor(rooms.length / 3); i++) {
      const a = rooms[rndInt(0, rooms.length - 1)], b = rooms[rndInt(0, rooms.length - 1)];
      if (a !== b) carveCorridor(m, a.cx, a.cy, b.cx, b.cy, false);
    }
    // 看板の部屋を必ず1つずつ確保する(開始部屋は除く)
    const sig = SIGNATURE_ROOMS[def.code] || [];
    for (let i = 0; i < sig.length && i + 1 < rooms.length; i++) rooms[1 + i].kind = sig[i];
    m.rooms = rooms;

    // --- 配置 ---
    const start = rooms[0];
    start.kind = 'hall';
    for (const r of rooms) furnishRoom(m, r);
    // 開始位置は設備を置き終えてから決める(棚の中に湧かないように)
    m.spawn = findOpen(m, start, 24, 60);

    // 開始部屋は明るくして、最初の数秒だけ安全にする
    addLamp(m.spawn.x, m.spawn.y, 260, '#ffeec2', 0.12);

    // --- 目標アイテム ---
    const far = rooms.slice(1).sort((a, b) =>
      dist2(b.cx * TILE, b.cy * TILE, m.spawn.x, m.spawn.y) - dist2(a.cx * TILE, a.cy * TILE, m.spawn.x, m.spawn.y));
    const goalRooms = far.slice(0, Math.max(def.goalCount, 3));
    for (let i = 0; i < def.goalCount; i++) {
      const r = goalRooms[i % goalRooms.length];
      const p = findOpen(m, r, 20);
      items.push({ type: 'goal', x: p.x, y: p.y, t: rnd(10), taken: false });
    }
    // --- 脱出装置(配電盤・発電機・隔壁) ---
    const exitRoom = rooms[Math.floor(rooms.length / 2)] || rooms[1] || start;
    const ep = findOpen(m, exitRoom, 34);
    m.exit = { x: ep.x, y: ep.y, room: exitRoom, active: false, progress: 0 };
    addProp('exitmachine', ep.x - 34, ep.y - 26, 68, 52, { occlude: true, usable: true });
    addLamp(ep.x, ep.y, 150, '#8ad4ff', 0.55);

    // --- 補給品 ---
    const supply = DIFFS[run.diff].supply * (run.mods.scav ? 1.55 : 1);
    const nBat = Math.round((7 + fi * 2) * supply), nBand = Math.round(3.5 * supply), nSed = Math.round(1.8 * supply);
    for (let i = 0; i < nBat; i++) { const r = pick(rooms); const p = findOpen(m, r, 16); items.push({ type: 'battery', x: p.x, y: p.y, t: rnd(10) }); }
    for (let i = 0; i < nBand; i++) { const r = pick(rooms); const p = findOpen(m, r, 16); items.push({ type: 'bandage', x: p.x, y: p.y, t: rnd(10) }); }
    for (let i = 0; i < nSed; i++) { const r = pick(rooms); const p = findOpen(m, r, 16); items.push({ type: 'sedative', x: p.x, y: p.y, t: rnd(10) }); }

    // --- メモ(フロアごとに3枚) ---
    for (let i = 0; i < 3; i++) {
      const noteId = fi * 3 + i;
      if (noteId >= NOTES.length) break;
      const r = pick(rooms);
      const p = findOpen(m, r, 14);
      items.push({ type: 'note', x: p.x, y: p.y, t: rnd(10), noteId });
    }

    // --- 敵 ---
    const area = rooms.length;
    const count = Math.round(area * 0.85 * def.density * DIFFS[run.diff].count);
    const mixKeys = Object.keys(def.mix);
    for (let i = 0; i < count; i++) {
      const r = rooms[rndInt(1, rooms.length - 1)];
      if (dist2(r.cx * TILE, r.cy * TILE, m.spawn.x, m.spawn.y) < 460 * 460) continue;
      const p = findOpen(m, r, 20);
      // 混合比に従って種類を決める
      let acc = 0, roll = rng(), kind = mixKeys[0];
      for (const k of mixKeys) { acc += def.mix[k]; if (roll <= acc) { kind = k; break; } }
      spawnEnemy(kind, p.x, p.y, r);
    }

    // --- グラップパック(チャプター1) ---
    if (def.grabpack) {
      const gr = far[Math.min(far.length - 1, 1)] || exitRoom;
      const gp = findOpen(m, gr, 22);
      items.push({ type: 'grabpack', x: gp.x, y: gp.y, t: rnd(10) });
      addLamp(gp.x, gp.y, 130, '#7ce0ff', 0.5);
    }

    // 探索済みフラグを初期化
    m.seen.fill(0);
    bakeFloor();
    // --- チャプターのボス ---
    if (def.stalker) spawnStalker(def.stalker);
    if (def.mode === 'mission') setupMissions();
    return m;
  }

  // ------------------------------------------------------------
  //  ボスアリーナ(手組み)
  // ------------------------------------------------------------
  function genArena() {
    rng = makeRng(run.seed + 4242);
    const m = makeMap(34, 28);
    m.def = { n: 4, name: 'B2 ボイラー室', code: 'MOTHER', tint: '#1a0b08', fog: '#170807' };
    m.arena = true;
    map = m;
    enemies = []; items = []; props = []; parts = []; shots = []; decals = []; floats = []; lamps = [];
    stalker = null; gasClouds = [];
    dlg.q.length = 0; dlg.text = ''; dlg.t = 0;
    carveRect(m, 2, 2, 30, 24);
    const room = { x: 2, y: 2, w: 30, h: 24, cx: 17, cy: 14, kind: 'utility' };
    m.rooms = [room];

    m.spawn = { x: 17 * TILE, y: 24 * TILE };
    // 中央のボイラー炉
    addProp('furnace', 15 * TILE, 9 * TILE, 4 * TILE, 4 * TILE, { occlude: true });
    // 四隅の柱
    const pil = [[6, 6], [26, 6], [6, 21], [26, 21]];
    for (const [px, py] of pil) addProp('pillar', px * TILE - 22, py * TILE - 22, 44, 44, { occlude: true });
    // 壁際の4つのブレーカー
    const brk = [[4, 4], [29, 4], [4, 24], [29, 24]];
    m.breakers = [];
    for (let i = 0; i < 4; i++) {
      const [bx, by] = brk[i];
      const p = addProp('breaker', bx * TILE - 18, by * TILE - 14, 36, 28, { usable: true, on: false, id: i });
      m.breakers.push(p);
    }
    addLamp(17 * TILE, 11 * TILE, 220, '#ff8a4a', 0.7);
    for (let i = 0; i < 3; i++) { const p = findOpen(m, room, 18); items.push({ type: 'battery', x: p.x, y: p.y, t: rnd(10) }); }
    for (let i = 0; i < 2; i++) { const p = findOpen(m, room, 18); items.push({ type: 'bandage', x: p.x, y: p.y, t: rnd(10) }); }
    m.seen.fill(1);
    bakeFloor();
    return m;
  }

  // ============================================================
  //  可視性(レイキャスト)と当たり判定
  // ============================================================

  /** a から b まで壁や遮蔽物にさえぎられずに見通せるか。 */
  function losClear(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const steps = Math.ceil(d / 11);
    const ux = dx / steps, uy = dy / steps;
    let x = ax, y = ay;
    for (let i = 1; i < steps; i++) {
      x += ux; y += uy;
      if (isSolidPx(x, y)) return false;
    }
    // 遮蔽物(棚など)。線分のバウンディングで絞ってから矩形と判定する。
    const minx = Math.min(ax, bx), maxx = Math.max(ax, bx);
    const miny = Math.min(ay, by), maxy = Math.max(ay, by);
    const occ = map.occ;
    for (let i = 0; i < occ.length; i++) {
      const o = occ[i];
      if (o.x > maxx || o.x + o.w < minx || o.y > maxy || o.y + o.h < miny) continue;
      if (segIntersectsBox(ax, ay, bx, by, o)) return false;
    }
    return true;
  }

  function segIntersectsBox(ax, ay, bx, by, o) {
    // 端点が中にある
    if (ax >= o.x && ax <= o.x + o.w && ay >= o.y && ay <= o.y + o.h) return true;
    if (bx >= o.x && bx <= o.x + o.w && by >= o.y && by <= o.y + o.h) return true;
    // スラブ法
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - o.x, o.x + o.w - ax, ay - o.y, o.y + o.h - ay];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; continue; }
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  }

  /** 円の移動。軸ごとに分けて壁と固形プロップに押し戻す。 */
  function moveEnt(e, dx, dy, r) {
    // 既に何かにめり込んでいる場合は素通りさせる(はまり込み防止)
    const stuck = blockedAt(e.x, e.y, r);
    const trySlide = (nx, ny) => {
      if (!stuck && blockedAt(nx, ny, r)) return false;
      e.x = nx; e.y = ny; return true;
    };
    if (dx !== 0) trySlide(e.x + dx, e.y);
    if (dy !== 0) trySlide(e.x, e.y + dy);
  }

  function blockedAt(x, y, r) {
    // タイル(円の四隅+中心を見る)
    if (isSolidPx(x - r, y - r) || isSolidPx(x + r, y - r) ||
      isSolidPx(x - r, y + r) || isSolidPx(x + r, y + r) ||
      isSolidPx(x, y - r) || isSolidPx(x, y + r) || isSolidPx(x - r, y) || isSolidPx(x + r, y)) return true;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!p.solid) continue;
      if (x + r > p.x && x - r < p.x + p.w && y + r > p.y && y - r < p.y + p.h) return true;
    }
    return false;
  }

  /** 現在プレイヤーの光がその点に届いているか(敵の描画・キツネのAIに使う)。 */
  function litAt(x, y) {
    if (!player) return false;
    const d = dist(player.x, player.y, x, y);
    if (d < AMBIENT_R * 0.9) return losClear(player.x, player.y, x, y);
    if (!player.lightOn || player.battery <= 0) return isLampLit(x, y);
    const range = player.lightRangeNow;
    if (d > range) return isLampLit(x, y);
    const a = Math.atan2(y - player.y, x - player.x);
    if (angDiff(a, player.aim) > player.lightArcNow) return isLampLit(x, y);
    return losClear(player.x, player.y, x, y) || isLampLit(x, y);
  }

  /** 据え置きの照明(蛍光灯・フレア)の光が届いているか。 */
  function isLampLit(x, y) {
    for (let i = 0; i < lamps.length; i++) {
      const L = lamps[i];
      if (!L.on || L.broken) continue;
      if (dist2(L.x, L.y, x, y) < L.r * L.r * 0.62) {
        if (losClear(L.x, L.y, x, y)) return true;
      }
    }
    return false;
  }

  /** ミニマップ用に、現在見えているタイルを踏破済みにする。 */
  function markSeen(px, py, R) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    const rt = Math.ceil(R / TILE);
    for (let y = ty - rt; y <= ty + rt; y++) {
      for (let x = tx - rt; x <= tx + rt; x++) {
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
        if (dist2(cx, cy, px, py) > R * R) continue;
        map.seen[idx(map, x, y)] = 1;
      }
    }
  }

  // ============================================================
  //  プレイヤー
  // ============================================================
  const modLv = (id) => run.mods[id] || 0;

  function makePlayer(charId) {
    const c = CHARS.find((x) => x.id === charId) || CHARS[0];
    const maxHp = c.hp + 40 * modLv('armor');
    const maxBattery = c.battery + 45 * modLv('cell');
    const maxSanity = 100 + 15 * modLv('nerve');
    return {
      char: c, x: 0, y: 0, r: PLAYER_R, aim: 0, vx: 0, vy: 0,
      hp: maxHp, maxHp, sanity: maxSanity, maxSanity,
      battery: maxBattery, maxBattery, stamina: 100,
      lightOn: true, focus: false, flicker: 1, lightRangeNow: c.lightRange, lightArcNow: c.lightArc,
      bandages: 2 + 2 * modLv('kit'), sedatives: 1, goals: 0,
      atkCd: 0, atkAnim: 0, atkDir: 0, abilityCd: 0, abilityT: 0, shutter: 0,
      hiding: null, hideT: 0, sprintLock: 0,
      hasGrab: false, grabCd: 0, grabHand: null, hasMask: false, gasT: 0,
      // 被弾部位。0=無傷 1=完全に潰れている
      limbs: { head: 0, torso: 0, larm: 0, rarm: 0, lleg: 0, rleg: 0 },
      // 呼吸。phase は肺の伸縮、oxygen は息を止めていられる残量
      breath: 0, breathRate: 1, oxygen: 100, holding: false, gaspT: 0,
      disguise: null, disguiseT: 0,
      walk: 0, stepT: 0, invuln: 0, dead: false,
      memoryT: 0, blind: 0, heartT: 0, breathT: 0, whisperT: 0, auraT: 0,
      hurtFlash: 0, lastSafeT: 0, killCount: 0, noteCount: 0,
    };
  }

  function playerSpeed(p) {
    let s = p.char.speed * (1 + 0.08 * modLv('boots'));
    if (isCrouching()) s *= 0.52;
    else if (p.sprinting) s *= p.char.sprintMul;
    if (p.sanity < 25) s *= 0.94;                 // 恐怖で脚がすくむ
    if (p.hp < p.maxHp * 0.25) s *= 0.9;
    if (p.gasT > 0) s *= 0.68;                    // 眠り煙の中
    if (p.disguise) s *= 0.66;                    // 着ぐるみの中は動きにくい
    const legs = (p.limbs.lleg + p.limbs.rleg) / 2;
    if (legs > 0.35) s *= 1 - Math.min(0.3, (legs - 0.35) * 0.5);
    return s;
  }

  /** どの部位に当たったかを決める。頭は当たりにくい。 */
  function assignLimbDamage(p, amount) {
    const parts2 = ['torso', 'torso', 'torso', 'larm', 'rarm', 'lleg', 'rleg', 'head'];
    const k = parts2[rndInt(0, parts2.length - 1)];
    p.limbs[k] = clamp(p.limbs[k] + amount / p.maxHp * 2.2, 0, 1);
    return k;
  }
  const LIMB_JP = { head: '頭部', torso: '胴体', larm: '左腕', rarm: '右腕', lleg: '左脚', rleg: '右脚' };

  /** いちばん傷んでいる部位を返す。 */
  function worstLimb(p) {
    let k = 'torso', v = -1;
    for (const n in p.limbs) if (p.limbs[n] > v) { v = p.limbs[n]; k = n; }
    return v > 0.02 ? k : null;
  }

  // ------------------------------------------------------------
  //  呼吸
  //  走る・怖い・傷が深いほど息が上がり、その音で見つかる。
  //  V を押している間は息を止められるが、酸素が尽きると大きく喘ぐ。
  // ------------------------------------------------------------
  function updateBreath(p, dt) {
    const near = nearestEnemyDist();
    let rate = 0.85;
    if (p.sprinting) rate += 0.95;
    else if (isCrouching()) rate -= 0.2;
    rate += clamp((100 - p.stamina) / 100, 0, 1) * 0.7;
    rate += clamp((60 - p.sanity) / 60, 0, 1) * 0.8;
    rate += clamp(1 - p.hp / p.maxHp, 0, 1) * 0.5;
    if (near < 220) rate += 0.6;
    if (p.gaspT > 0) { rate += 1.6; p.gaspT -= dt; }

    p.holding = !p.dead && (keys['v'] || touch.hold) && p.oxygen > 0;
    if (p.holding) {
      p.oxygen = Math.max(0, p.oxygen - (16 + rate * 5) * dt);
      p.breathRate = lerp(p.breathRate, 0.06, dt * 6);
      if (p.oxygen <= 0) {
        // 我慢しきれずに喘ぐ
        p.holding = false;
        p.gaspT = 2.4;
        p.sanity = Math.max(0, p.sanity - 6);
        Audio2.sfx.hurt();
        emitNoise(p.x, p.y, 320);
        toast('息が続かない');
      }
    } else {
      p.oxygen = Math.min(100, p.oxygen + 13 * dt);
      p.breathRate = lerp(p.breathRate, rate, dt * 3);
    }

    const before = p.breath;
    p.breath += p.breathRate * dt * 1.5;
    // 1呼吸ごとに音が出る。息を止めていれば鳴らない。
    if (Math.floor(p.breath) !== Math.floor(before) && !p.holding) {
      const lvl = 18 + p.breathRate * 26;
      if (near < 260) emitNoise(p.x, p.y, lvl);
    }
  }

  function emitNoise(x, y, level) {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead || e.charmed) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < level * (e.def.hear / 300)) hearNoise(e, x, y);
    }
  }

  function updatePlayer(dt) {
    const p = player;
    const D = DIFFS[run.diff];

    if (p.invuln > 0) p.invuln -= dt;
    if (p.blind > 0) p.blind -= dt;
    if (p.memoryT > 0) p.memoryT -= dt;
    if (p.abilityCd > 0) p.abilityCd -= dt;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.atkAnim > 0) p.atkAnim -= dt;
    if (p.shutter > 0) p.shutter -= dt;
    if (p.hurtFlash > 0) p.hurtFlash -= dt;

    // --- ロッカーに隠れている間 ---
    if (p.hiding) {
      p.hideT += dt;
      p.sanity -= 1.4 * dt * D.sanity;
      updateBreath(p, dt);
      if (wasPressed('e') && p.hideT > 0.4) { p.hiding.open = false; p.hiding = null; Audio2.sfx.door(); }
      clampVitals(p);
      return;
    }

    // --- 移動 ---
    const mv = readMove();
    const wantSprint = isSprinting() && mv.fwd > 0.1 && p.stamina > 2;
    p.sprinting = wantSprint;
    if (wantSprint) p.stamina -= STAMINA_COST * dt;
    else p.stamina += STAMINA_REGEN * dt * (isCrouching() ? 1.5 : 1);
    p.stamina = clamp(p.stamina, 0, 100);

    const spd = playerSpeed(p);
    // 前後と左右を、いま向いている方向に合わせて世界の座標へ直す
    const ca = Math.cos(p.aim), sa = Math.sin(p.aim);
    let mvx = (ca * mv.fwd - sa * mv.str) * spd * dt;
    let mvy = (sa * mv.fwd + ca * mv.str) * spd * dt;
    // 正気度が低いと足元が揺れる(据わった肝で軽減)
    if (p.sanity < 35 && !modLv('nerve') && (mvx || mvy)) {
      const sway = (1 - p.sanity / 35) * 0.28;
      const ang = Math.atan2(mvy, mvx) + Math.sin(gameT * 6.1) * sway;
      const mag = Math.hypot(mvx, mvy);
      mvx = Math.cos(ang) * mag; mvy = Math.sin(ang) * mag;
    }
    p.vx = mvx; p.vy = mvy;
    moveEnt(p, mvx, mvy, p.r);

    // --- 足音 ---
    if (mv.mag > 0.1) {
      p.walk += dt * (p.sprinting ? 13 : isCrouching() ? 5 : 8.5);
      p.stepT -= dt;
      if (p.stepT <= 0) {
        p.stepT = p.sprinting ? 0.28 : isCrouching() ? 0.62 : 0.42;
        Audio2.sfx.step(p.sprinting);
        const base = p.sprinting ? NOISE_SPRINT : isCrouching() ? NOISE_CROUCH : NOISE_WALK;
        emitNoise(p.x, p.y, base * (1 - 0.45 * modLv('boots')));
      }
    }

    // --- 照準(視線と同じ) ---
    p.aim = readAim();

    // --- 懐中電灯 ---
    if (wasPressed('f')) {
      p.lightOn = !p.lightOn;
      p.lightOn ? Audio2.sfx.lightOn() : Audio2.sfx.lightOff();
    }
    p.focus = p.lightOn && p.battery > 0 && isFocusing();
    if (p.lightOn && p.battery > 0) {
      const drain = (p.focus ? BATTERY_FOCUS_DRAIN : BATTERY_DRAIN) * p.char.batteryMul * D.battery;
      p.battery -= drain * dt;
      if (p.battery <= 0) { p.battery = 0; p.lightOn = false; Audio2.sfx.lightOff(); toast('バッテリーが切れた'); }
    }
    // 残量が少ないとちらつく
    if (p.lightOn && p.battery < BATTERY_LOW) {
      const f = p.battery / BATTERY_LOW;
      p.flicker = (Math.sin(gameT * 21) * 0.5 + 0.5) < (1 - f) * 0.45 ? rnd(0.05, 0.35) : 1;
      if (p.flicker < 1 && chance(0.04)) Audio2.sfx.lowBattery();
    } else p.flicker = lerp(p.flicker, 1, dt * 8);

    const lensMul = 1 + 0.22 * modLv('lens');
    p.lightRangeNow = p.lightOn ? p.char.lightRange * lensMul * (p.focus ? FOCUS_RANGE_MUL : 1) * (0.55 + 0.45 * p.flicker) : 0;
    p.lightArcNow = p.char.lightArc * (p.focus ? FOCUS_ARC_MUL : 1);

    // --- 正気度 ---
    const inLight = p.lightOn && p.battery > 0;
    const standingInLamp = isLampLit(p.x, p.y);
    let san = 0;
    if (standingInLamp) san = SANITY_LIT * 1.4;
    else if (inLight) san = SANITY_LIT * 0.55;
    else san = SANITY_DARK;
    // 追われていると加速度的に削れる
    let chased = 0;
    for (const e of enemies) if (!e.dead && !e.charmed && e.state === 'chase') chased++;
    if (chased > 0) san += SANITY_SEEN * Math.min(3, chased) * 0.6;
    san *= p.char.sanityRes * D.sanity * (1 - 0.35 * modLv('pill')) * (1 + p.limbs.head * 0.4);
    p.sanity = clamp(p.sanity - san * dt, 0, p.maxSanity);   // san が負なら回復

    // 正気度による演出と実害
    fx.chroma = lerp(fx.chroma, clamp((45 - p.sanity) / 45, 0, 1), dt * 2);
    // 正気度がゼロでも体力は削らない。代わりに幻覚と囁きが濃くなり、視界が歪む。
    if (p.sanity <= 0) {
      if (chance(dt * 1.3)) Audio2.sfx.whisper();
      if (chance(dt * 0.55)) spawnPhantom();
    }
    p.whisperT -= dt;
    if (p.sanity < 45 && p.whisperT <= 0) {
      p.whisperT = rnd(2.4, 6.5) * (p.sanity / 45 + 0.25);
      Audio2.sfx.whisper();
      if (p.sanity < 30 && chance(0.55)) spawnPhantom();
    }
    // 心音(敵が近いほど速い)
    const nearest = nearestEnemyDist();
    p.heartT -= dt;
    if (p.heartT <= 0 && (nearest < 320 || p.hp < p.maxHp * 0.3)) {
      const rate = clamp(nearest / 320, 0.2, 1);
      p.heartT = 0.45 + rate * 0.85;
      Audio2.sfx.heartbeat();
    }
    Audio2.setTension(clamp((chased > 0 ? 0.75 : 0) + (nearest < 260 ? 0.35 : 0) + (1 - p.sanity / 100) * 0.3, 0, 1));

    // --- 攻撃 ---
    if (isAttacking() && p.atkCd <= 0) meleeAttack(p);

    // --- アビリティ ---
    if (wasPressed('q') && p.abilityCd <= 0) useAbility(p);

    // --- グラップパック ---
    if (p.gasT > 0) p.gasT -= dt;
    if (wasPressed(' ') || wasPressed('g')) fireGrab(p);
    updateGrab(dt);

    // --- 呼吸 ---
    updateBreath(p, dt);

    // --- 空の着ぐるみに化けている間 ---
    if (p.disguise) {
      p.disguiseT += dt;
      // 走ると中身がばれる
      if (p.sprinting) breakDisguise(p, '走ったせいで見破られた');
      else if (wasPressed('x')) breakDisguise(p, '着ぐるみを脱いだ');
    }

    // --- 回復 ---
    if (wasPressed('r')) useBandage(p);
    if (wasPressed('t')) useSedative(p);

    // --- 拾う / 使う ---
    autoPickup(p);
    const target = findInteract(p);
    if (target && wasPressed('e')) doInteract(p, target);

    // --- 集束光で敵をひるませる ---
    if (p.focus) applyFocusLight(p, dt);

    // --- 黄金の刻(ゴールドベア) ---
    if (p.auraT > 0) { p.auraT -= dt; applyGoldenHour(p); }

    clampVitals(p);
    if (p.hp <= 0 && !p.dead) killPlayer();
  }

  function clampVitals(p) {
    p.hp = clamp(p.hp, 0, p.maxHp);
    p.battery = clamp(p.battery, 0, p.maxBattery);
    p.sanity = clamp(p.sanity, 0, p.maxSanity);
  }

  function nearestEnemyDist() {
    let best = 9999;
    for (const e of enemies) {
      if (e.dead || e.charmed) continue;
      const d = dist(player.x, player.y, e.x, e.y);
      if (d < best) best = d;
    }
    if (boss && !boss.dead) best = Math.min(best, dist(player.x, player.y, boss.x, boss.y));
    return best;
  }

  // ------------------------------------------------------------
  //  近接攻撃
  // ------------------------------------------------------------
  /**
   * カメラのシャッター(配信者専用)。
   * 遠くまで届くが扇は狭く、連射も利かない。閃光なので暗闇の相手ほどよく効く。
   */
  function cameraShot(p) {
    const w = p.char.weapon;
    p.atkCd = w.cd * (1 - 0.18 * modLv('edge')) * armPenalty(p);
    p.atkAnim = 0.18;
    p.atkDir = p.aim;
    p.shutter = 0.34;
    Audio2.sfx.shutter();
    emitNoise(p.x, p.y, 230);
    fx.flash = Math.max(fx.flash, 0.22);
    // ストロボが一瞬だけ前方を照らす
    addLamp(p.x + Math.cos(p.aim) * 70, p.y + Math.sin(p.aim) * 70, 300, '#ffffff', 0);
    lamps[lamps.length - 1].life = 0.24;

    const dmg = w.dmg * (1 + 0.28 * modLv('grip'));
    const list = enemies.slice();
    if (boss && !boss.dead) list.push(boss);
    let hit = 0;
    for (const e of list) {
      if (e.dead || e.charmed) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > w.reach + e.r) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      if (angDiff(a, p.aim) > w.arc) continue;
      if (!losClear(p.x, p.y, e.x, e.y)) continue;
      const falloff = 1 - clamp(d / (w.reach * 2.4), 0, 0.42);   // 遠いほど減衰
      hurtEnemy(e, dmg * falloff, a, w.knock, w.stun);
      burst(e.x, e.y, 5, '#fff6d8', 90, 0.3);
      hit++;
    }
    if (hit) { Audio2.sfx.hit(); shake(4, 0.1); }
  }

  // 威嚇はマザーに対してだけ、殴打に見合うだけのダメージに読み替える(逃げない相手なので)
  const SCARE_BOSS_MUL = 4.2;

  /**
   * 威嚇(着ぐるみ勢の攻撃)。
   * 相手に向かってクリックすると、扇の中の個体が近い順に「逃走」状態になる。
   * 殴り倒すのではなく、こちらから遠ざける。倒す手段を持たない代わりに、道を空けさせる。
   */
  function scareAttack(p) {
    const w = p.char.weapon;
    if (p.disguise) { breakDisguise(p, '着ぐるみの上からは威嚇できない'); return; }
    p.atkCd = w.cd * (1 - 0.18 * modLv('edge')) * armPenalty(p);
    p.atkAnim = 0.34;
    p.atkDir = p.aim;
    Audio2.sfx.roar();
    emitNoise(p.x, p.y, 220);
    shake(4, 0.12);
    burst(p.x + Math.cos(p.aim) * 26, p.y + Math.sin(p.aim) * 26, 6, p.char.color, 120, 0.3);

    const dur = (w.flee || 5) * (1 + 0.25 * modLv('grip'));
    const cand = [];
    for (const e of enemies) {
      if (e.dead || e.charmed || e.phantom) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > w.reach + e.r) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      if (angDiff(a, p.aim) > w.arc) continue;
      if (!losClear(p.x, p.y, e.x, e.y)) continue;
      cand.push({ e, d, a });
    }
    cand.sort((u, v) => u.d - v.d);
    const n = Math.min(w.targets || 1, cand.length);
    for (let i = 0; i < n; i++) {
      const c = cand[i];
      if (w.dmg) hurtEnemy(c.e, w.dmg * (1 + 0.28 * modLv('grip')), c.a, w.knock, 0);
      if (!c.e.dead) scareEnemy(c.e, dur, p);
    }
    // 章のボスは逃げないが、一瞬だけ足が止まる
    if (stalker && stalker.mode !== 'mission') {
      const d = dist(p.x, p.y, stalker.x, stalker.y);
      if (d < w.reach + stalker.r && angDiff(Math.atan2(stalker.y - p.y, stalker.x - p.x), p.aim) < w.arc
        && losClear(p.x, p.y, stalker.x, stalker.y)) {
        stalker.stagger = Math.max(stalker.stagger, 0.8);
        burst(stalker.x, stalker.y, 10, '#cfe4ff', 140, 0.4);
      }
    }
    // マザーは逃げない。ただし「顔」を向けられると大きく怯む。
    if (boss && !boss.dead && dist(p.x, p.y, boss.x, boss.y) < w.reach + boss.r
      && angDiff(Math.atan2(boss.y - p.y, boss.x - p.x), p.aim) < w.arc + 0.25
      && losClear(p.x, p.y, boss.x, boss.y)) {
      hurtEnemy(boss, w.dmg * SCARE_BOSS_MUL * (1 + 0.28 * modLv('grip')), p.aim, 0, 0);
      burst(boss.x, boss.y, 10, '#ffe6a0', 150, 0.4);
    }
    if (n === 0) addFloat('……', p.x, p.y - 30, '#8a8a92');
    else Audio2.sfx.spring();
  }

  /** その個体を dur 秒だけ逃走させる。 */
  function scareEnemy(e, dur, from) {
    e.fleeT = Math.max(e.fleeT || 0, dur);
    e.stun = 0;
    e.frozen = false;
    e.windup = 0; e.dashT = 0;
    e.state = 'flee';
    e.lastSeen = null;
    addFloat('逃走', e.x, e.y - e.r - 12, '#9fe0ff');
    burst(e.x, e.y, 8, '#cfe4ff', 130, 0.4);
    if (from) e.fleeAng = Math.atan2(e.y - from.y, e.x - from.x);
    // 着ぐるみ勢は個体を壊せない。仕事の最中に追い払えば「廃棄」と同じ扱いにする。
    if (isSuit(player.char) && e.kind === 'fox' && !e.culled) {
      const m = currentMission();
      if (m && m.id === 'cull') { e.culled = true; missionProgress('cull', 1); }
    }
  }

  /** 腕を痛めていると振りが遅くなる。 */
  function armPenalty(p) { return 1 + (p.limbs.larm + p.limbs.rarm) / 2 * 0.55; }

  function meleeAttack(p) {
    const w = p.char.weapon;
    if (p.disguise) { breakDisguise(p, '手を出したので見破られた'); return; }
    if (w.type === 'camera') { cameraShot(p); return; }
    if (w.type === 'scare') { scareAttack(p); return; }
    p.atkCd = w.cd * (1 - 0.18 * modLv('edge')) * armPenalty(p);
    p.atkAnim = 0.22;
    p.atkDir = p.aim;
    Audio2.sfx.swing();
    emitNoise(p.x, p.y, NOISE_MELEE);
    const dmg = w.dmg * (1 + 0.28 * modLv('grip'));
    let hitAny = false;
    const list = enemies.slice();
    if (boss && !boss.dead) list.push(boss);
    for (const e of list) {
      if (e.dead || e.charmed) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > w.reach + e.r) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      if (angDiff(a, p.aim) > w.arc) continue;
      hurtEnemy(e, dmg, a, w.knock, w.stun);
      hitAny = true;
    }
    // 木箱・樽を壊す
    for (const pr of props) {
      if (!pr.solid || pr.broken) continue;
      if (pr.type !== 'crate' && pr.type !== 'barrel' && pr.type !== 'giftbox') continue;
      const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
      if (dist(p.x, p.y, cx, cy) > w.reach + 24) continue;
      if (angDiff(Math.atan2(cy - p.y, cx - p.x), p.aim) > w.arc) continue;
      breakProp(pr);
      hitAny = true;
    }
    if (hitAny) { Audio2.sfx.hit(); shake(5, 0.12); }
    // 空振りの残響
    burst(p.x + Math.cos(p.aim) * 34, p.y + Math.sin(p.aim) * 34, 4, '#8f8f8f', 60, 0.25);
  }

  function breakProp(pr) {
    pr.broken = true; pr.solid = false;
    Audio2.sfx.metal();
    burst(pr.x + pr.w / 2, pr.y + pr.h / 2, 16, pr.type === 'barrel' ? '#c04a2a' : '#a8814e', 180, 0.6);
    // 中身
    if (chance(0.45)) items.push({ type: chance(0.6) ? 'battery' : 'bandage', x: pr.x + pr.w / 2, y: pr.y + pr.h / 2, t: 0 });
  }

  // ------------------------------------------------------------
  //  集束光(右クリック長押し)
  // ------------------------------------------------------------
  function applyFocusLight(p, dt) {
    const mul = 1 + 0.7 * modLv('mirror');
    const list = enemies.slice();
    if (boss && !boss.dead) list.push(boss);
    for (const e of list) {
      if (e.dead || e.charmed) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > p.lightRangeNow) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      if (angDiff(a, p.aim) > p.lightArcNow * 1.15) continue;
      if (!losClear(p.x, p.y, e.x, e.y)) continue;
      const fear = e.isBoss ? 0.5 : e.def.lightFear;
      if (fear <= 0) continue;
      e.dazzle = (e.dazzle || 0) + dt * fear * 1.5;
      e.dazzleT = 0.3;
      if (e.dazzle > 1.0) {
        e.dazzle = 0;
        stunEnemy(e, (e.isBoss ? 1.6 : 2.2) * mul);
        burst(e.x, e.y, 10, '#fff3c4', 120, 0.35);
      }
    }
  }

  /** 黄金の刻。正面の扇に入った個体を、片端から逃走させ続ける。 */
  function applyGoldenHour(p) {
    for (const e of enemies) {
      if (e.dead || e.charmed || e.phantom) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > 430) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      if (angDiff(a, p.aim) > 0.95) continue;
      if (!losClear(p.x, p.y, e.x, e.y)) continue;
      if ((e.fleeT || 0) < 2.6) scareEnemy(e, 2.8, p);
    }
  }

  // ------------------------------------------------------------
  //  アビリティ
  // ------------------------------------------------------------
  function useAbility(p) {
    const ab = p.char.ability;
    p.abilityCd = ab.cd * (1 - 0.3 * modLv('capacitor'));
    if (ab.id === 'beacon') {
      Audio2.sfx.flash(); fx.flash = 0.9; shake(8, 0.3);
      addLamp(p.x, p.y, 240, '#fff0c0', 0.1);
      lamps[lamps.length - 1].life = 6;
      for (const e of enemies) {
        if (e.dead || e.charmed) continue;
        if (dist(p.x, p.y, e.x, e.y) < 240) { stunEnemy(e, 4.0); hurtEnemy(e, 12, 0, 60, 0); }
      }
      p.sanity = Math.min(p.maxSanity, p.sanity + 18);
      toast('保安灯 展開');
    } else if (ab.id === 'memory') {
      p.memoryT = 12; Audio2.sfx.power();
      toast('店の記憶 ― 12秒間、壁越しに見える');
    } else if (ab.id === 'flash') {
      Audio2.sfx.flash(); fx.flash = 1.0; shake(10, 0.3);
      for (const e of enemies) {
        if (e.dead || e.charmed) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d > 420) continue;
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        if (angDiff(a, p.aim) > 0.95) continue;
        if (!losClear(p.x, p.y, e.x, e.y)) continue;
        hurtEnemy(e, 64, a, 260, 0); stunEnemy(e, 3.0);
      }
      if (boss && !boss.dead && dist(p.x, p.y, boss.x, boss.y) < 420) { hurtEnemy(boss, 30, p.aim, 0, 0); stunEnemy(boss, 1.2); }
      p.sanity = Math.min(p.maxSanity, p.sanity + 8);
      toast('フラッシュ撮影');
    } else if (ab.id === 'flare') {
      const fx2 = p.x + Math.cos(p.aim) * 190, fy2 = p.y + Math.sin(p.aim) * 190;
      shots.push({ kind: 'flare', x: p.x, y: p.y, tx: fx2, ty: fy2, t: 0, dur: 0.5, from: 'player' });
      Audio2.sfx.throw();
      toast('発煙筒 投擲');
    } else if (ab.id === 'stagefright') {
      // うさぎの咆哮。半径内の全個体がいっせいに逃げ出す。
      Audio2.sfx.roar(); Audio2.sfx.stinger();
      fx.flash = 0.35; shake(12, 0.35);
      let n = 0;
      for (const e of enemies) {
        if (e.dead || e.charmed || e.phantom) continue;
        if (dist(p.x, p.y, e.x, e.y) > 340) continue;
        scareEnemy(e, 9, p); n++;
      }
      if (stalker && stalker.mode !== 'mission') stalker.stagger = Math.max(stalker.stagger, 1.4);
      p.sanity = Math.min(p.maxSanity, p.sanity + 8);
      toast(n ? `ステージ・フライト ― ${n}体が散った` : 'ステージ・フライト ― 誰もいない');
    } else if (ab.id === 'goldenhour') {
      // 12秒間、正面を見るだけで相手が逃げていく。
      p.auraT = 12;
      Audio2.sfx.roar();
      fx.flash = 0.25;
      addLamp(p.x, p.y, 200, '#ffe08a', 0.2);
      lamps[lamps.length - 1].life = 12;
      toast('黄金の刻 ― 12秒間、目が合った個体は逃げる');
    } else if (ab.id === 'lullaby') {
      Audio2.sfx.musicBox();
      fx.flash = 0.25;
      let best = null, bd = 1e9;
      for (const e of enemies) {
        if (e.dead) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d > 260) continue;
        stunEnemy(e, 6.0);
        if (d < bd && !e.charmed) { bd = d; best = e; }
      }
      if (best) {
        best.charmed = true; best.charmT = 20; best.stun = 0;
        best.hp = best.maxHp;
        toast(best.def.name + ' が味方になった');
      } else toast('子守唄 ― 誰も聞いていない');
      p.sanity = Math.min(p.maxSanity, p.sanity + 10);
    }
  }

  function useBandage(p) {
    if (p.bandages <= 0) { toast('包帯がない'); return; }
    const w = worstLimb(p);
    if (p.hp >= p.maxHp && !w) return;
    p.bandages--;
    p.hp = Math.min(p.maxHp, p.hp + 34 * (1 + 0.7 * modLv('kit')));
    // いちばん傷んだ部位を手当てする
    if (w) {
      p.limbs[w] = Math.max(0, p.limbs[w] - 0.55 * (1 + 0.4 * modLv('kit')));
      addFloat(LIMB_JP[w] + ' 手当', p.x, p.y - 34, '#7fe08a');
    }
    Audio2.sfx.heal();
    addFloat('+HP', p.x, p.y - 20, '#7fe08a');
  }
  function useSedative(p) {
    if (p.sedatives <= 0) { toast('鎮静剤がない'); return; }
    p.sedatives--;
    p.sanity = Math.min(p.maxSanity, p.sanity + 55);
    Audio2.sfx.heal();
    addFloat('+SAN', p.x, p.y - 20, '#9fd8ff');
  }

  // ------------------------------------------------------------
  //  空の着ぐるみへの変装
  //  中身が抜けた予備の着ぐるみに潜り込む。歩いている限り、敵は仲間だと思う。
  // ------------------------------------------------------------
  const PLUSH_KINDS = ['bear', 'bunny', 'chick'];

  function wearDisguise(p, pr) {
    p.disguise = { kind: pr.kind };
    p.disguiseT = 0;
    pr.used = true;
    pr.solid = false;
    Audio2.sfx.door();
    toast('着ぐるみをかぶった ― 走ると見破られる');
    // 追っていた敵が見失う
    for (const e of enemies) if (e.state === 'chase') { e.state = 'search'; e.searchT = 3; }
  }

  function breakDisguise(p, msg) {
    if (!p.disguise) return;
    p.disguise = null;
    Audio2.sfx.metal();
    burst(p.x, p.y, 12, '#c8b49a', 140, 0.5);
    emitNoise(p.x, p.y, 280);
    if (msg) toast(msg);
  }

  /** 変装が通用している状態か。 */
  function disguised(p) {
    return !!p.disguise && !p.sprinting;
  }

  // ------------------------------------------------------------
  //  被弾・死亡
  // ------------------------------------------------------------
  function hurtPlayer(dmg, sx, sy) {
    const p = player;
    if (p.invuln > 0 || p.dead || p.hiding) return;
    if (p.disguise) breakDisguise(p, '着ぐるみが裂けた');
    const d = dmg * DIFFS[run.diff].dmg * (1 - 0.1 * modLv('armor'));
    p.hp -= d;
    const limb = assignLimbDamage(p, d);
    addFloat(LIMB_JP[limb], p.x + rnd(-10, 10), p.y - 30, '#ff8a80');
    p.gaspT = Math.max(p.gaspT, 1.6);
    p.invuln = 0.55;
    p.hurtFlash = 0.35;
    p.sanity -= 6;
    fx.hurt = Math.min(1, fx.hurt + 0.6);
    shake(11, 0.3);
    Audio2.sfx.hurt();
    emitNoise(p.x, p.y, NOISE_HURT);
    const a = Math.atan2(p.y - sy, p.x - sx);
    moveEnt(p, Math.cos(a) * 16, Math.sin(a) * 16, p.r);
    burst(p.x, p.y, 8, '#b3252b', 130, 0.4);
    decals.push({ x: p.x, y: p.y, r: rnd(14, 26), a: 0.35, c: '#5a0d12', rot: rnd(TAU) });
    if (p.hp <= 0) killPlayer();
  }

  function killPlayer() {
    const p = player;
    if (p.dead) return;
    p.dead = true; p.hp = 0;
    Audio2.sfx.die(); Audio2.sfx.stinger();
    fx.stinger = 1;
    shake(20, 0.8);
    setState('dead');
  }

  // ------------------------------------------------------------
  //  拾得・調べる
  // ------------------------------------------------------------
  function autoPickup(p) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'goal' || it.type === 'note') continue;
      if (dist2(p.x, p.y, it.x, it.y) > 26 * 26) continue;
      if (it.type === 'battery') {
        if (p.battery >= p.maxBattery) continue;
        p.battery = Math.min(p.maxBattery, p.battery + 48);
        addFloat('電池 +48', it.x, it.y - 14, '#ffd766');
      } else if (it.type === 'bandage') {
        const cap = 4 + 2 * modLv('kit');
        if (p.bandages >= cap) continue;
        p.bandages++; addFloat('包帯', it.x, it.y - 14, '#7fe08a');
      } else if (it.type === 'sedative') {
        if (p.sedatives >= 3) continue;
        p.sedatives++; addFloat('鎮静剤', it.x, it.y - 14, '#9fd8ff');
      }
      Audio2.sfx.pickup();
      items.splice(i, 1);
    }
  }

  /**
   * E で調べられる対象。
   * 一人称では距離だけだと背後の物を拾ってしまうので、視線から外れるほど遠く扱う。
   */
  function interactScore(p, x, y) {
    const d2v = dist2(p.x, p.y, x, y);
    const off = angDiff(Math.atan2(y - p.y, x - p.x), p.aim);
    return d2v * (1 + Math.min(2.4, off * 1.5));
  }

  function findInteract(p) {
    let best = null, bd = 78 * 78;
    const ITEM_LABEL = {
      note: '📄 メモを読む',
      grabpack: '🧤 グラップパックを装着',
      mask: '🎭「顔」を拾う',
    };
    for (const it of items) {
      if (it.type !== 'goal' && !ITEM_LABEL[it.type]) continue;
      const d = interactScore(p, it.x, it.y);
      if (d < bd) {
        bd = d;
        const label = it.type === 'goal' ? map.def.goalIcon + ' ' + map.def.goalItem + 'を回収' : ITEM_LABEL[it.type];
        best = { kind: 'item', ref: it, x: it.x, y: it.y, label };
      }
    }
    for (const pr of props) {
      if (!pr.usable || pr.broken) continue;
      const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
      const d = interactScore(p, cx, cy);
      if (d >= bd) continue;
      let label = null;
      if (pr.type === 'plush') label = pr.used ? null : '🧸 空の着ぐるみに潜り込む';
      else if (pr.type === 'locker') label = '🚪 ロッカーに隠れる';
      else if (pr.type === 'stall') label = '🚪 個室に隠れる';
      else if (pr.type === 'exitmachine') {
        if (objectiveComplete()) label = `⚡ ${map.def.exitName}を起動`;
        else if (map.def.mode === 'mission') label = '⚠ マリオネットの指示が残っている';
        else if (map.def.grabpack && !p.hasGrab) label = '⚠ グラップパックが要る';
        else label = `⚠ ${map.def.goalItem}があと ${map.def.goalCount - p.goals}`;
      } else if (pr.type === 'breaker') label = pr.on ? '― 通電済み' : '🔌 ブレーカーを上げる';
      else if (pr.type === 'windbox') label = pr.turned ? '― 巻いた' : '🎵 オルゴールのぜんまいを巻く';
      if (!label) continue;
      bd = d; best = { kind: 'prop', ref: pr, x: cx, y: cy, label };
    }
    // マリオネットに「顔」を手渡す
    if (stalker && stalker.mode === 'mission' && p.hasMask) {
      const d = dist2(p.x, p.y, stalker.x, stalker.y);
      if (d < Math.max(bd, 80 * 80)) {
        best = { kind: 'stalker', ref: stalker, x: stalker.x, y: stalker.y, label: '🎭「顔」を手渡す' };
      }
    }
    return best;
  }

  function doInteract(p, target) {
    if (target.kind === 'stalker') {
      p.hasMask = false;
      Audio2.sfx.pickup();
      missionProgress('mask', 1);
      return;
    }
    if (target.kind === 'item') {
      const it = target.ref;
      if (it.type === 'grabpack') {
        p.hasGrab = true;
        items.splice(items.indexOf(it), 1);
        Audio2.sfx.power();
        fx.flash = 0.3;
        toast('グラップパック装着 ― Space で撃つ');
        addFloat('GRAB PACK', it.x, it.y - 18, '#7ce0ff');
        if (stalker) bossSay('goal');
        return;
      }
      if (it.type === 'mask') {
        p.hasMask = true;
        items.splice(items.indexOf(it), 1);
        Audio2.sfx.pickup();
        toast('「顔」を拾った ― マリオネットへ持っていく');
        return;
      }
      if (it.type === 'note') {
        p.noteCount++;
        run.notes.push(it.noteId);
        p.sanity = Math.min(p.maxSanity, p.sanity + 10);
        items.splice(items.indexOf(it), 1);
        Audio2.sfx.pickup();
        openNote(it.noteId);
      } else if (it.type === 'goal') {
        p.goals++;
        items.splice(items.indexOf(it), 1);
        Audio2.sfx.power();
        addFloat(map.def.goalItem + ' 回収', it.x, it.y - 16, '#ffd766');
        toast(`${map.def.goalItem} ${p.goals} / ${map.def.goalCount}`);
        emitNoise(p.x, p.y, 260);
        if (stalker) bossSay('goal');
        if (objectiveComplete()) {
          toast(`${map.def.exitName} が使えるようになった`);
          onGoalComplete();
        }
      }
      return;
    }
    const pr = target.ref;
    if (pr.type === 'plush') {
      if (p.disguise) breakDisguise(p, '着ぐるみを脱いだ');
      else wearDisguise(p, pr);
    } else if (pr.type === 'windbox') {
      if (!pr.turned) {
        pr.turned = true;
        Audio2.sfx.metal();
        emitNoise(p.x, p.y, 240);
        missionProgress('windbox', 1);
      }
    } else if (pr.type === 'locker' || pr.type === 'stall') {
      p.hiding = pr; p.hideT = 0; pr.open = true;
      p.x = pr.x + pr.w / 2; p.y = pr.y + pr.h / 2 + 6;
      Audio2.sfx.door();
      for (const e of enemies) if (e.target === 'player' && e.state === 'chase') { e.state = 'search'; e.searchT = 4; }
    } else if (pr.type === 'exitmachine') {
      if (objectiveComplete()) activateExit();
      else toast('まだ条件が揃っていない');
    } else if (pr.type === 'breaker') {
      if (!pr.on) { pr.on = true; Audio2.sfx.power(); onBreaker(pr); }
    }
  }

  // ============================================================
  //  敵
  // ============================================================
  function spawnEnemy(kind, x, y, room) {
    const def = ENEMY_DEFS[kind];
    const D = DIFFS[run.diff];
    const maxHp = Math.round(def.hp * D.ehp);
    const e = {
      def, kind, x, y, r: def.r, hp: maxHp, maxHp,
      angle: rnd(TAU), state: kind === 'puppet' ? 'hide' : 'patrol',
      home: { x, y }, room: room || null,
      patrol: [], pi: 0, waitT: rnd(0.4, 2.2),
      lastSeen: null, searchT: 0, atkCd: rnd(0.3, 1.2),
      stun: 0, dazzle: 0, dazzleT: 0, charmed: false, charmT: 0, fleeT: 0,
      hitFlash: 0, anim: rnd(10), dead: false, deadT: 0,
      spotT: 0, alert: 0, windup: 0, dashT: 0, dashA: 0,
      phantom: false, isBoss: false,
    };
    if (room) {
      for (let i = 0; i < 3; i++) {
        const p = randFloorIn(map, room, 1);
        e.patrol.push(p);
      }
    }
    enemies.push(e);
    return e;
  }

  /** 幻覚。触れず、光を当てると消える。 */
  function spawnPhantom() {
    const a = rnd(TAU), d = rnd(180, 330);
    const x = player.x + Math.cos(a) * d, y = player.y + Math.sin(a) * d;
    if (isSolidPx(x, y)) return;
    const e = spawnEnemy(chance(0.5) ? 'fox' : 'endo', x, y, null);
    e.phantom = true; e.state = 'chase'; e.life = rnd(2.2, 4.5);
    e.hp = e.maxHp = 1;
  }

  function hearNoise(e, x, y) {
    if (e.state === 'chase' || e.state === 'dead') return;
    if (e.kind === 'puppet' && e.state === 'hide') return;
    e.lastSeen = { x, y };
    e.state = 'search';
    e.searchT = 5.5;
    e.alert = Math.min(1, e.alert + 0.5);
  }

  /** その敵からプレイヤーが見えているか。ライトを点けていると見つかりやすい。 */
  function canSeePlayer(e) {
    if (player.hiding || player.dead) return false;
    const d = dist(e.x, e.y, player.x, player.y);
    // 着ぐるみをかぶっていると、ぶつかる距離まで仲間だと思われる
    if (disguised(player) && d > 46) return false;
    let sight = e.def.sight;
    if (player.lightOn && player.battery > 0) {
      sight *= 1.45;
      // 光を敵の方へ向けていると更に目立つ
      if (angDiff(Math.atan2(e.y - player.y, e.x - player.x), player.aim) < player.lightArcNow) sight *= 1.2;
    } else sight *= isCrouching() ? 0.55 : 0.75;
    // 着ぐるみ姿は、遠目には仲間に見える
    if (player.char.suitStealth) sight *= player.char.suitStealth;
    if (d > sight) return false;
    return losClear(e.x, e.y, player.x, player.y);
  }

  /** 目標方向へ歩く。壁にぶつかったら角度をずらして回り込む。 */
  function stepToward(e, tx, ty, speed, dt) {
    const base = Math.atan2(ty - e.y, tx - e.x);
    const tries = [0, 0.4, -0.4, 0.9, -0.9, 1.5, -1.5, 2.3, -2.3];
    const stuck = blockedAt(e.x, e.y, e.r);
    for (const off of tries) {
      const a = base + off;
      const nx = e.x + Math.cos(a) * speed * dt, ny = e.y + Math.sin(a) * speed * dt;
      if (stuck || !blockedAt(nx, ny, e.r)) {
        e.x = nx; e.y = ny;
        e.angle = lerp2Angle(e.angle, a, dt * 8);
        return true;
      }
    }
    return false;
  }
  function lerp2Angle(a, b, t) { return a + normAng(b - a) * clamp(t, 0, 1); }

  function updateEnemy(e, dt) {
    if (e.dead) { e.deadT += dt; return; }
    e.anim += dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.dazzleT > 0) { e.dazzleT -= dt; if (e.dazzleT <= 0) e.dazzle = Math.max(0, e.dazzle - dt); }
    if (e.alert > 0) e.alert = Math.max(0, e.alert - dt * 0.25);

    // 幻覚は寿命で消える。光を当てても消える。
    if (e.phantom) {
      e.life -= dt;
      if (litAt(e.x, e.y) && dist(e.x, e.y, player.x, player.y) < 260) e.life -= dt * 4;
      if (e.life <= 0) { e.dead = true; e.deadT = 9; burst(e.x, e.y, 8, '#5a4b6e', 60, 0.5); return; }
      stepToward(e, player.x, player.y, e.def.speed * 0.7, dt);
      return;
    }

    if (e.charmed) { updateCharmed(e, dt); return; }

    // --- 威嚇されている間はこちらに背を向けて走り続ける ---
    if (e.fleeT > 0) {
      e.fleeT -= dt;
      e.state = 'flee';
      const away = Math.atan2(e.y - player.y, e.x - player.x);
      const spd = e.def.speed * 1.55;
      const tx = e.x + Math.cos(away) * 300, ty = e.y + Math.sin(away) * 300;
      if (!stepToward(e, tx, ty, spd, dt)) {
        // 壁で詰まったら、壁沿いに逃げ道を探す
        const side = (Math.floor(e.anim * 0.7) % 2) ? 1.5 : -1.5;
        stepToward(e, e.x + Math.cos(away + side) * 240, e.y + Math.sin(away + side) * 240, spd * 0.85, dt);
      }
      e.angle = lerp2Angle(e.angle, away, dt * 7);
      if (e.fleeT <= 0) { e.state = 'search'; e.searchT = 2.5; e.lastSeen = null; }
      return;
    }

    if (e.stun > 0) {
      e.stun -= dt;
      return;
    }

    const dToP = dist(e.x, e.y, player.x, player.y);

    // --- 種類ごとの特殊挙動 ---
    if (e.kind === 'fox') {
      // 光が当たっている間は完全に停止する
      const lit = player.lightOn && player.battery > 0 && dToP < player.lightRangeNow &&
        angDiff(Math.atan2(e.y - player.y, e.x - player.x), player.aim) < player.lightArcNow &&
        losClear(player.x, player.y, e.x, e.y);
      e.frozen = lit || isLampLit(e.x, e.y);
      if (e.frozen) { e.state = 'chase'; return; }
    }
    if (e.kind === 'puppet' && e.state === 'hide') {
      if (dToP < 150 && losClear(e.x, e.y, player.x, player.y)) {
        e.state = 'chase'; e.lastSeen = { x: player.x, y: player.y };
        Audio2.sfx.spring(); Audio2.sfx.stinger();
        fx.stinger = Math.max(fx.stinger, 0.85); shake(12, 0.35);
        player.sanity -= 10;
        burst(e.x, e.y, 14, '#e8d24a', 160, 0.5);
      }
      return;
    }

    // --- 知覚 ---
    if (canSeePlayer(e)) {
      e.lastSeen = { x: player.x, y: player.y };
      e.spotT += dt;
      if (e.state !== 'chase' && e.spotT > (e.kind === 'fox' ? 0 : 0.22)) {
        e.state = 'chase';
        if (chance(0.35)) Audio2.sfx.growl();
      }
      e.searchT = 6;
    } else {
      e.spotT = Math.max(0, e.spotT - dt);
      if (e.state === 'chase') { e.state = 'search'; e.searchT = 5; }
    }

    // --- 状態ごとの行動 ---
    if (e.state === 'chase') {
      const spd = e.def.speed * e.def.chaseMul;
      if (e.kind === 'bear') { updateBear(e, dt, dToP); }
      else if (e.kind === 'chick') { updateChick(e, dt, dToP); }
      else {
        const t = e.lastSeen || player;
        if (dToP <= e.def.reach + e.r) enemyAttack(e, dt);
        else stepToward(e, t.x, t.y, spd, dt);
      }
    } else if (e.state === 'search') {
      e.searchT -= dt;
      if (e.searchT <= 0 || !e.lastSeen) { e.state = 'patrol'; e.lastSeen = null; }
      else {
        const t = e.lastSeen;
        if (dist(e.x, e.y, t.x, t.y) < 30) { e.lastSeen = { x: t.x + rnd(-120, 120), y: t.y + rnd(-120, 120) }; }
        stepToward(e, t.x, t.y, e.def.speed * 1.1, dt);
      }
    } else { // patrol
      if (e.patrol.length === 0) { e.angle += Math.sin(e.anim * 0.6) * dt; }
      else {
        e.waitT -= dt;
        if (e.waitT > 0) { e.angle += Math.sin(e.anim * 1.3) * dt * 0.8; }
        else {
          const t = e.patrol[e.pi];
          if (dist(e.x, e.y, t.x, t.y) < 26) { e.pi = (e.pi + 1) % e.patrol.length; e.waitT = rnd(0.6, 2.6); }
          else if (!stepToward(e, t.x, t.y, e.def.speed, dt)) { e.pi = (e.pi + 1) % e.patrol.length; }
        }
      }
    }
    if (e.atkCd > 0) e.atkCd -= dt;
  }

  function updateBear(e, dt, d) {
    if (e.dashT > 0) {
      e.dashT -= dt;
      const nx = e.x + Math.cos(e.dashA) * 430 * dt, ny = e.y + Math.sin(e.dashA) * 430 * dt;
      if (blockedAt(nx, ny, e.r)) { e.dashT = 0; e.stun = 0.9; Audio2.sfx.metal(); shake(7, 0.2); }
      else { e.x = nx; e.y = ny; }
      if (d < e.r + 26) { hurtPlayer(e.def.dmg, e.x, e.y); e.dashT = 0; e.stun = 0.7; }
      return;
    }
    if (e.windup > 0) {
      e.windup -= dt;
      e.angle = lerp2Angle(e.angle, Math.atan2(player.y - e.y, player.x - e.x), dt * 6);
      if (e.windup <= 0) { e.dashT = 0.62; e.dashA = e.angle; Audio2.sfx.growl(); }
      return;
    }
    if (d < 300 && d > 70 && e.atkCd <= 0) { e.windup = 0.62; e.atkCd = 3.0; return; }
    if (d <= e.def.reach + e.r) enemyAttack(e, dt);
    else stepToward(e, player.x, player.y, e.def.speed * e.def.chaseMul, dt);
  }

  function updateChick(e, dt, d) {
    const want = 230;
    if (d < want - 60) stepToward(e, e.x * 2 - player.x, e.y * 2 - player.y, e.def.speed * 1.3, dt);
    else if (d > want + 90) stepToward(e, player.x, player.y, e.def.speed, dt);
    else e.angle = lerp2Angle(e.angle, Math.atan2(player.y - e.y, player.x - e.x), dt * 5);
    if (e.atkCd <= 0 && d < e.def.reach && losClear(e.x, e.y, player.x, player.y)) {
      e.atkCd = e.def.atkCd;
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      shots.push({ kind: 'part', x: e.x, y: e.y, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, life: 2.4, dmg: e.def.dmg, from: 'enemy', spin: rnd(TAU) });
      Audio2.sfx.throw();
    }
  }

  function updateCharmed(e, dt) {
    e.charmT -= dt;
    if (e.charmT <= 0) { e.charmed = false; return; }
    if (e.stun > 0) { e.stun -= dt; return; }
    let best = null, bd = 1e9;
    for (const o of enemies) {
      if (o === e || o.dead || o.charmed || o.phantom) continue;
      const d = dist(e.x, e.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (boss && !boss.dead && dist(e.x, e.y, boss.x, boss.y) < bd) { best = boss; bd = dist(e.x, e.y, boss.x, boss.y); }
    if (!best || bd > 520) { stepToward(e, player.x, player.y, e.def.speed, dt); return; }
    if (bd <= e.def.reach + e.r + best.r) {
      if (e.atkCd <= 0) { e.atkCd = e.def.atkCd; hurtEnemy(best, e.def.dmg * 1.4, Math.atan2(best.y - e.y, best.x - e.x), 80, 0.2); Audio2.sfx.hit(); }
    } else stepToward(e, best.x, best.y, e.def.speed * e.def.chaseMul, dt);
    if (e.atkCd > 0) e.atkCd -= dt;
  }

  function enemyAttack(e, dt) {
    e.angle = lerp2Angle(e.angle, Math.atan2(player.y - e.y, player.x - e.x), dt * 7);
    if (e.atkCd > 0) return;
    e.atkCd = e.def.atkCd;
    e.swing = 0.25;
    hurtPlayer(e.def.dmg, e.x, e.y);
    Audio2.sfx.hit();
  }

  function stunEnemy(e, t) {
    e.stun = Math.max(e.stun || 0, t);
    if (e.isBoss) e.stunned = true;
    addFloat('ひるみ', e.x, e.y - e.r - 12, '#ffe27a');
  }

  function hurtEnemy(e, dmg, ang, knock, stun) {
    if (e.dead) return;
    if (e.phantom) { e.life = 0; return; }
    if (e.isBoss) { dmg *= bossDamageMul(); knock = 0; }   // 装甲。炉心が開いている間だけ通る
    e.hp -= dmg;
    e.hitFlash = 0.16;
    if (!e.charmed) { e.lastSeen = { x: player.x, y: player.y }; if (e.state !== 'chase') { e.state = 'chase'; } }
    if (knock) {
      const nx = e.x + Math.cos(ang) * knock * 0.045, ny = e.y + Math.sin(ang) * knock * 0.045;
      if (!blockedAt(nx, ny, e.r)) { e.x = nx; e.y = ny; }
    }
    if (stun) e.stun = Math.max(e.stun || 0, stun);
    burst(e.x, e.y, 7, e.isBoss ? '#ff9c5a' : '#c9c2b0', 150, 0.35);
    addFloat(Math.round(dmg), e.x + rnd(-8, 8), e.y - e.r - 6, '#ffffff');
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true; e.deadT = 0;
    if (e.isBoss) { onBossDead(); return; }
    player.killCount++;
    if (e.kind === 'fox') missionProgress('cull', 1);
    Audio2.sfx.metal();
    burst(e.x, e.y, 20, '#d9cfb6', 220, 0.7);
    decals.push({ x: e.x, y: e.y, r: rnd(20, 34), a: 0.3, c: '#2b2018', rot: rnd(TAU) });
    // たまに補給品を落とす
    if (chance(0.24)) items.push({ type: chance(0.55) ? 'battery' : 'bandage', x: e.x, y: e.y, t: 0 });
    player.sanity = Math.min(player.maxSanity, player.sanity + 2.5);
  }

  // ============================================================
  //  パーティクル・投射物・演出
  // ============================================================
  function burst(x, y, n, color, speed, life) {
    for (let i = 0; i < n; i++) {
      if (parts.length >= MAX_PARTICLES) break;
      const a = rnd(TAU), s = rnd(speed * 0.25, speed);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * 0.5, life), max: life, c: color, r: rnd(1.4, 3.2), g: 0 });
    }
  }
  function dust(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      if (parts.length >= MAX_PARTICLES) break;
      parts.push({ x: x + rnd(-14, 14), y: y + rnd(-14, 14), vx: rnd(-8, 8), vy: rnd(-14, -2), life: rnd(1.2, 3), max: 3, c: color, r: rnd(0.6, 1.6), g: -2 });
    }
  }
  function addFloat(text, x, y, color) {
    floats.push({ text: String(text), x, y, life: 0.9, c: color || '#fff' });
  }
  function shake(mag, t) { cam.shake = Math.max(cam.shake, mag); cam.shakeT = Math.max(cam.shakeT, t); }

  let toastText = '', toastT = 0;
  function toast(msg) { toastText = msg; toastT = 3.2; }

  function updateParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.vy += (p.g || 0) * dt;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dt; f.y -= 28 * dt;
      if (f.life <= 0) floats.splice(i, 1);
    }
    if (decals.length > MAX_DECALS) decals.splice(0, decals.length - MAX_DECALS);
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (s.kind === 'flare') {
        s.t += dt;
        const k = clamp(s.t / s.dur, 0, 1);
        s.x = lerp(s.x, s.tx, 0.18);
        s.y = lerp(s.y, s.ty, 0.18);
        if (k >= 1) {
          addLamp(s.tx, s.ty, 260, '#ff7a3a', 0.55);
          const L = lamps[lamps.length - 1];
          L.life = 18; L.repel = true;
          Audio2.sfx.power();
          shots.splice(i, 1);
        }
        continue;
      }
      s.life -= dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.spin += dt * 9;
      if (s.life <= 0 || isSolidPx(s.x, s.y)) {
        burst(s.x, s.y, 6, '#a89b82', 110, 0.3);
        shots.splice(i, 1); continue;
      }
      if (s.from === 'enemy' && dist2(s.x, s.y, player.x, player.y) < 20 * 20) {
        hurtPlayer(s.dmg, s.x, s.y);
        shots.splice(i, 1);
      }
    }
  }

  function updateLamps(dt) {
    for (let i = lamps.length - 1; i >= 0; i--) {
      const L = lamps[i];
      L.t += dt;
      if (L.life !== undefined) {
        L.life -= dt;
        if (L.life <= 0) { lamps.splice(i, 1); continue; }
      }
      // ちらつき
      L.k = 1 - L.flicker * Math.max(0, Math.sin(L.t * (2.1 + L.flicker * 9) + Math.sin(L.t * 3.3) * 2)) * rnd(0.5, 1);
      if (L.flicker > 0.6 && chance(dt * 0.6)) L.k *= 0.15;
      // フレアは敵を遠ざける
      if (L.repel) {
        for (const e of enemies) {
          if (e.dead || e.charmed) continue;
          const d = dist(L.x, L.y, e.x, e.y);
          if (d < L.r * 0.6) {
            const a = Math.atan2(e.y - L.y, e.x - L.x);
            const nx = e.x + Math.cos(a) * 80 * dt, ny = e.y + Math.sin(a) * 80 * dt;
            if (!blockedAt(nx, ny, e.r)) { e.x = nx; e.y = ny; }
          }
        }
      }
    }
  }

  function decayFx(dt) {
    fx.flash = Math.max(0, fx.flash - dt * 2.4);
    fx.hurt = Math.max(0, fx.hurt - dt * 1.6);
    fx.stinger = Math.max(0, fx.stinger - dt * 1.1);
    fx.blind = Math.max(0, fx.blind - dt * 1.5);
    if (toastT > 0) toastT -= dt;
  }

  // ============================================================
  //  ボス:マザー
  // ============================================================
  const BOSS_DEF = { name: 'マザー', reach: 78, dmg: 32, sight: 9999, hear: 9999, lightFear: 0.4, speed: 58, atkCd: 2.2, r: 54 };

  function spawnBoss() {
    const D = DIFFS[run.diff];
    boss = {
      isBoss: true, def: BOSS_DEF, kind: 'mother',
      x: 17 * TILE, y: 8 * TILE, r: BOSS_DEF.r,
      maxHp: Math.round(2600 * D.ehp), hp: Math.round(2600 * D.ehp),
      angle: Math.PI / 2, phase: 1, state: 'idle', t: 1.5, atkCd: 3.0,
      heartOpen: 0, dazzle: 0, dazzleT: 0, stun: 0, hitFlash: 0,
      anim: 0, dead: false, deadT: 0, spawnCd: 10, charmed: false, phantom: false,
      sweep: 0, sweepA: 0, slam: 0, chargeT: 0, chargeA: 0, roarT: 0, breakerReset: 0,
    };
    Audio2.sfx.roar();
    shake(18, 1.2);
    fx.letter = 1;
  }

  function onBreaker(pr) {
    if (!map.arena || !boss) return;
    addFloat('通電', pr.x + pr.w / 2, pr.y - 6, '#8ad4ff');
    const on = map.breakers.filter((b) => b.on).length;
    toast(`ブレーカー ${on} / 4`);
    if (on >= 4) {
      // 全点灯 → マザーの装甲が開く
      boss.heartOpen = 9.5;
      boss.stun = 1.6;
      Audio2.sfx.power(); Audio2.sfx.roar();
      fx.flash = 0.8; shake(16, 0.6);
      for (const L of lamps) { L.on = true; L.broken = false; }
      for (const b of map.breakers) b.blaze = 6;
      toast('装甲が開いた ― 炉心を叩け');
    }
  }

  function updateBoss(dt) {
    const b = boss;
    if (!b || b.dead) { if (b) b.deadT += dt; return; }
    b.anim += dt;
    if (b.hitFlash > 0) b.hitFlash -= dt;
    if (b.heartOpen > 0) b.heartOpen -= dt;
    if (b.atkCd > 0) b.atkCd -= dt;
    if (b.spawnCd > 0) b.spawnCd -= dt;
    if (b.dazzleT > 0) b.dazzleT -= dt;
    if (b.stun > 0) { b.stun -= dt; b.hitFlash = Math.max(b.hitFlash, 0.05); return; }

    const d = dist(b.x, b.y, player.x, player.y);
    const aToP = Math.atan2(player.y - b.y, player.x - b.x);

    // --- 段階移行 ---
    const ratio = b.hp / b.maxHp;
    if (b.phase === 1 && ratio < 0.66) enterPhase(2);
    else if (b.phase === 2 && ratio < 0.33) enterPhase(3);

    // --- 攻撃の実行中 ---
    if (b.sweep > 0) {
      b.sweep -= dt;
      if (b.sweep <= 0.35 && !b.sweepHit) {
        b.sweepHit = true;
        if (d < 150 && angDiff(aToP, b.sweepA) < 1.1) hurtPlayer(BOSS_DEF.dmg, b.x, b.y);
        burstArc(b.x, b.y, b.sweepA, 150, '#ff9a5a');
        Audio2.sfx.explode(); shake(10, 0.3);
      }
      return;
    }
    if (b.slam > 0) {
      b.slam -= dt;
      if (b.slam <= 0.3 && !b.slamHit) {
        b.slamHit = true;
        const R = 230;
        if (d < R) hurtPlayer(BOSS_DEF.dmg * 1.15, b.x, b.y);
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * TAU;
          parts.push({ x: b.x + Math.cos(a) * 40, y: b.y + Math.sin(a) * 40, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, life: 0.7, max: 0.7, c: '#ffb066', r: 3.4, g: 0 });
        }
        Audio2.sfx.explode(); shake(16, 0.5);
        // 天井から部品が降る
        for (let i = 0; i < 6; i++) {
          const a = rnd(TAU), rr = rnd(80, 260);
          shots.push({ kind: 'part', x: b.x + Math.cos(a) * rr, y: b.y + Math.sin(a) * rr - 200, vx: 0, vy: 300, life: 0.9, dmg: 12, from: 'enemy', spin: rnd(TAU) });
        }
      }
      return;
    }
    if (b.chargeT > 0) {
      b.chargeT -= dt;
      const nx = b.x + Math.cos(b.chargeA) * 420 * dt, ny = b.y + Math.sin(b.chargeA) * 420 * dt;
      if (blockedAt(nx, ny, b.r)) { b.chargeT = 0; b.stun = 2.2; Audio2.sfx.explode(); shake(20, 0.6); fx.flash = 0.4; }
      else { b.x = nx; b.y = ny; }
      if (d < b.r + 30) { hurtPlayer(BOSS_DEF.dmg * 1.3, b.x, b.y); b.chargeT = 0; b.stun = 1.2; }
      return;
    }
    if (b.roarT > 0) {
      b.roarT -= dt;
      if (b.roarT <= 0) {
        for (let i = 0; i < (b.phase >= 3 ? 5 : 3); i++) {
          const a = rnd(TAU), rr = rnd(140, 300);
          const x = b.x + Math.cos(a) * rr, y = b.y + Math.sin(a) * rr;
          if (isSolidPx(x, y)) continue;
          const kind = b.phase >= 3 ? pick(['endo', 'fox', 'bear']) : pick(['endo', 'fox']);
          const e = spawnEnemy(kind, x, y, null);
          e.state = 'chase'; e.lastSeen = { x: player.x, y: player.y };
          burst(x, y, 10, '#ff8a4a', 140, 0.4);
        }
      }
      return;
    }

    // --- 通常時 ---
    b.angle = lerp2Angle(b.angle, aToP, dt * 1.8);
    const spd = BOSS_DEF.speed * (b.phase === 3 ? 1.45 : b.phase === 2 ? 1.18 : 1);
    if (d > 110) stepToward(b, player.x, player.y, spd, dt);

    if (b.atkCd <= 0) {
      if (d < 150) { b.sweep = 0.95; b.sweepA = aToP; b.sweepHit = false; b.atkCd = BOSS_DEF.atkCd; Audio2.sfx.growl(); }
      else if (d < 300 && chance(0.5)) { b.slam = 0.85; b.slamHit = false; b.atkCd = BOSS_DEF.atkCd + 0.8; Audio2.sfx.growl(); }
      else if (b.phase >= 3 && d < 620) { b.chargeT = 0.9; b.chargeA = aToP; b.atkCd = 3.4; Audio2.sfx.roar(); }
    }
    if (b.spawnCd <= 0) {
      b.spawnCd = b.phase >= 3 ? 11 : b.phase === 2 ? 14 : 18;
      b.roarT = 0.8;
      Audio2.sfx.roar(); shake(8, 0.4);
      toast('マザーが子どもを呼んでいる');
    }
  }

  function enterPhase(n) {
    const b = boss;
    b.phase = n;
    b.stun = 1.2;
    Audio2.sfx.roar(); shake(22, 1.0); fx.flash = 0.5;
    // ブレーカーを落とされる
    const on = map.breakers.filter((x) => x.on);
    const kill = Math.min(on.length, n === 2 ? 2 : on.length);
    for (let i = 0; i < kill; i++) on[i].on = false;
    if (n === 3) {
      for (const L of lamps) if (!L.repel) L.broken = true;
      toast('第3段階 ― 照明が全て落ちた');
    } else {
      toast('第2段階 ― ブレーカーが落とされた');
    }
    b.heartOpen = 0;
  }

  function burstArc(x, y, ang, r, color) {
    for (let i = 0; i < 26; i++) {
      const a = ang + rnd(-1.0, 1.0);
      const s = rnd(160, 380);
      parts.push({ x: x + Math.cos(a) * 40, y: y + Math.sin(a) * 40, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.25, 0.55), max: 0.55, c: color, r: rnd(2, 4), g: 0 });
    }
  }

  /** ボスへのダメージは装甲で減衰する。炉心が開いている間だけ通る。 */
  function bossDamageMul() {
    return boss && boss.heartOpen > 0 ? 1.0 : 0.16;
  }

  function onBossDead() {
    boss.dead = true; boss.deadT = 0;
    Audio2.sfx.roar(); Audio2.sfx.explode();
    fx.flash = 1; shake(26, 1.6); fx.letter = 1;
    for (let i = 0; i < 60; i++) {
      const a = rnd(TAU), s = rnd(60, 420);
      parts.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.6, 1.8), max: 1.8, c: pick(['#ffb066', '#ff6a3a', '#ffe6b0']), r: rnd(2, 5), g: 40 });
    }
    for (const e of enemies) if (!e.dead) killEnemy(e);
    setTimeout(() => { if (state === 'play') setState('win'); }, 2600);
  }

  // ============================================================
  //  静的タイルの焼き込み(床・壁は毎フレーム描き直さない)
  // ============================================================
  const FLOOR_COLORS = {
    stage: '#2f2334', dining: '#43464c', cove: '#2c2438', arcade: '#2b2f3a',
    kitchen: '#3d3f3a', restroom: '#363c42', party: '#46414c', prize: '#372c40',
    ballpit: '#2f3844', parts: '#3a3630', backstage: '#2e2b28', utility: '#332e2a',
    storage: '#3f382e', office: '#393c34', locker: '#333840', hall: '#3a3c42',
  };
  // 白黒チェックの床を敷く部屋(店の表側)
  const CHECKER_KINDS = { dining: 1, party: 1, stage: 1, prize: 1, hall: 1 };

  function roomKindAt(tx, ty) {
    for (const r of map.rooms) {
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r.kind;
    }
    return 'hall';
  }

  /**
   * 子どもの落書き。床にクレヨンで描かれた棒人間とアニマトロニクス。
   * 線を少しよろけさせて、手描きに見せる。
   */
  const CRAYON = ['#c2443c', '#3f6ec2', '#c9a52e', '#4f9c4a', '#8f57b8', '#c25a9c'];
  function bakeScrawl(g, x, y, brng, scale) {
    const s = scale || 1;
    g.save();
    g.translate(x, y);
    g.rotate((brng() - 0.5) * 1.2);
    g.scale(s, s);
    g.globalAlpha = 0.34 + brng() * 0.22;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const wob = () => (brng() - 0.5) * 2.2;
    const motif = Math.floor(brng() * 4);
    if (motif === 0) {
      // 棒人間の家族。手をつないでいる。
      const n = 2 + Math.floor(brng() * 3);
      for (let i = 0; i < n; i++) {
        g.strokeStyle = CRAYON[Math.floor(brng() * CRAYON.length)];
        g.lineWidth = 1.6;
        const px = -((n - 1) * 11) / 2 + i * 11;
        g.beginPath(); g.arc(px + wob(), -10 + wob(), 3.4, 0, TAU); g.stroke();
        g.beginPath();
        g.moveTo(px, -6); g.lineTo(px + wob(), 5);
        g.moveTo(px - 5 + wob(), -1); g.lineTo(px + 5 + wob(), -1);
        g.moveTo(px, 5); g.lineTo(px - 4 + wob(), 12);
        g.moveTo(px, 5); g.lineTo(px + 4 + wob(), 12);
        g.stroke();
      }
    } else if (motif === 1) {
      // 耳のある大きいの と、小さい棒人間
      g.strokeStyle = CRAYON[Math.floor(brng() * CRAYON.length)];
      g.lineWidth = 1.9;
      g.beginPath(); g.arc(-6, -6, 8, 0, TAU); g.stroke();
      g.beginPath(); g.arc(-11, -13, 3, 0, TAU); g.arc(-1, -13, 3, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(-6, 2); g.lineTo(-6 + wob(), 14); g.moveTo(-13, 6); g.lineTo(1 + wob(), 6); g.stroke();
      g.beginPath(); g.arc(-9, -7, 1.1, 0, TAU); g.arc(-3, -7, 1.1, 0, TAU); g.stroke();
      g.strokeStyle = CRAYON[Math.floor(brng() * CRAYON.length)];
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(11, -3, 3, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(11, 0); g.lineTo(11 + wob(), 9); g.moveTo(7, 4); g.lineTo(15, 4); g.stroke();
    } else if (motif === 2) {
      // ケーキとろうそく
      g.strokeStyle = CRAYON[Math.floor(brng() * CRAYON.length)];
      g.lineWidth = 1.8;
      g.strokeRect(-12, -2, 24, 12);
      g.beginPath();
      for (let i = 0; i < 4; i++) { g.moveTo(-8 + i * 5.4, -2); g.lineTo(-8 + i * 5.4 + wob(), -11); }
      g.stroke();
      g.strokeStyle = '#c9a52e';
      g.beginPath();
      for (let i = 0; i < 4; i++) g.arc(-8 + i * 5.4, -13, 1.6, 0, TAU);
      g.stroke();
    } else {
      // ぐちゃぐちゃの渦。名前らしきものが添えてある。
      g.strokeStyle = CRAYON[Math.floor(brng() * CRAYON.length)];
      g.lineWidth = 1.7;
      g.beginPath();
      for (let i = 0; i < 34; i++) {
        const a = i * 0.55, r = i * 0.55;
        const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.7;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }

  function bakeFloor() {
    bakeCv = document.createElement('canvas');
    bakeCv.width = map.pxW; bakeCv.height = map.pxH;
    bctx = bakeCv.getContext('2d');
    const g = bctx;
    const brng = makeRng(run.seed * 31 + map.w * 7 + map.h);

    g.fillStyle = '#07080a';
    g.fillRect(0, 0, map.pxW, map.pxH);

    // --- 床 ---
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!isFloorTile(map, tx, ty)) continue;
        const x = tx * TILE, y = ty * TILE;
        const kind = roomKindAt(tx, ty);
        let base = FLOOR_COLORS[kind] || '#3a3c42';
        // 店の表側は白黒チェックのタイル(ダイナーの顔)
        if (CHECKER_KINDS[kind]) base = ((tx + ty) & 1) ? '#4e5158' : '#22242a';
        g.fillStyle = base;
        g.fillRect(x, y, TILE, TILE);
        // タイルごとのムラ
        const v = brng();
        g.fillStyle = `rgba(0,0,0,${(v * 0.2).toFixed(3)})`;
        g.fillRect(x, y, TILE, TILE);
        if (v > 0.93) {
          g.fillStyle = 'rgba(120,105,80,0.10)';
          g.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        }
        // 入り江は星柄のカーペット
        if (kind === 'cove' && v > 0.55) {
          g.fillStyle = 'rgba(200,170,90,0.10)';
          g.beginPath();
          const sx2 = x + TILE / 2, sy2 = y + TILE / 2;
          for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (i / 5) * TAU;
            const a2 = a + TAU / 10;
            i ? g.lineTo(sx2 + Math.cos(a) * 7, sy2 + Math.sin(a) * 7) : g.moveTo(sx2 + Math.cos(a) * 7, sy2 + Math.sin(a) * 7);
            g.lineTo(sx2 + Math.cos(a2) * 3, sy2 + Math.sin(a2) * 3);
          }
          g.closePath(); g.fill();
        }
        // ゲームコーナーはネオンのグリッド
        if (kind === 'arcade') {
          g.strokeStyle = 'rgba(90,170,220,0.10)';
          g.lineWidth = 1;
          g.strokeRect(x + 6.5, y + 6.5, TILE - 13, TILE - 13);
        }
        // 目地
        g.strokeStyle = 'rgba(0,0,0,0.32)';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
    }

    // --- 汚れ・油染み ---
    for (let i = 0; i < map.w * map.h * 0.03; i++) {
      const tx = Math.floor(brng() * map.w), ty = Math.floor(brng() * map.h);
      if (!isFloorTile(map, tx, ty)) continue;
      const x = tx * TILE + brng() * TILE, y = ty * TILE + brng() * TILE;
      const r = 14 + brng() * 46;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = brng() > 0.7;
      gr.addColorStop(0, dark ? 'rgba(10,8,6,0.42)' : 'rgba(60,45,28,0.22)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }

    // --- 壁 ---
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (isFloorTile(map, tx, ty)) continue;
        const nearFloor = isFloorTile(map, tx - 1, ty) || isFloorTile(map, tx + 1, ty) ||
          isFloorTile(map, tx, ty - 1) || isFloorTile(map, tx, ty + 1) ||
          isFloorTile(map, tx - 1, ty - 1) || isFloorTile(map, tx + 1, ty - 1) ||
          isFloorTile(map, tx - 1, ty + 1) || isFloorTile(map, tx + 1, ty + 1);
        if (!nearFloor) continue;
        const x = tx * TILE, y = ty * TILE;
        const v = brng();
        // 隣の部屋に合わせた内装。表側は赤白のストライプ、裏側は塗装された下地。
        const nk = roomKindAt(isFloorTile(map, tx - 1, ty) ? tx - 1 : isFloorTile(map, tx + 1, ty) ? tx + 1 : tx,
          isFloorTile(map, tx, ty - 1) ? ty - 1 : isFloorTile(map, tx, ty + 1) ? ty + 1 : ty);
        const front = CHECKER_KINDS[nk] || nk === 'cove' || nk === 'arcade';
        g.fillStyle = front ? (v > 0.5 ? '#4a3038' : '#452c34') : (v > 0.5 ? '#3a3730' : '#36332d');
        g.fillRect(x, y, TILE, TILE);
        if (front) {
          // 縦のストライプ壁紙
          g.fillStyle = 'rgba(220,190,190,0.055)';
          for (let i = 0; i < TILE; i += 12) g.fillRect(x + i, y, 6, TILE);
          // 腰壁
          g.fillStyle = 'rgba(0,0,0,0.22)';
          g.fillRect(x, y + TILE - 9, TILE, 9);
        }
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        g.fillStyle = 'rgba(255,255,255,0.045)';
        g.fillRect(x + 1, y + 1, TILE - 2, 3);
        if (v > 0.84) { // 錆・染み
          g.fillStyle = 'rgba(120,60,24,0.18)';
          g.fillRect(x + brng() * 20, y + brng() * 20, 8 + brng() * 14, 6 + brng() * 12);
        }
      }
    }

    // --- 床側から見た壁の陰(高さの錯覚) ---
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!isFloorTile(map, tx, ty)) continue;
        const x = tx * TILE, y = ty * TILE;
        if (!isFloorTile(map, tx, ty - 1)) {
          const gr = g.createLinearGradient(0, y, 0, y + 16);
          gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(x, y, TILE, 16);
        }
        if (!isFloorTile(map, tx, ty + 1)) {
          const gr = g.createLinearGradient(0, y + TILE, 0, y + TILE - 10);
          gr.addColorStop(0, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(x, y + TILE - 10, TILE, 10);
        }
        if (!isFloorTile(map, tx - 1, ty)) {
          const gr = g.createLinearGradient(x, 0, x + 12, 0);
          gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(x, y, 12, TILE);
        }
        if (!isFloorTile(map, tx + 1, ty)) {
          const gr = g.createLinearGradient(x + TILE, 0, x + TILE - 12, 0);
          gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(x + TILE - 12, y, 12, TILE);
        }
      }
    }

    // --- 壁ぎわのクレヨン落書き ---
    // 子どもの背丈で届く高さにしか描かれていない、という体で壁の縁に寄せる。
    const SCRAWL_KINDS = { dining: 3, party: 4, ballpit: 3, hall: 2, restroom: 2, arcade: 2, prize: 2, stage: 2, cove: 1, storage: 1, locker: 1 };
    for (const r of map.rooms) {
      const n = SCRAWL_KINDS[r.kind] || 0;
      for (let i = 0; i < n; i++) {
        // 部屋の内周を1マス幅で回る
        let tx, ty;
        if (brng() < 0.5) { tx = r.x + 1 + Math.floor(brng() * Math.max(1, r.w - 2)); ty = brng() < 0.5 ? r.y : r.y + r.h - 1; }
        else { ty = r.y + 1 + Math.floor(brng() * Math.max(1, r.h - 2)); tx = brng() < 0.5 ? r.x : r.x + r.w - 1; }
        if (!isFloorTile(map, tx, ty)) continue;
        bakeScrawl(g, tx * TILE + TILE / 2, ty * TILE + TILE / 2, brng, 0.85 + brng() * 0.5);
      }
    }
  }

  const SUIT_STYLE = {
    bear: { fur: '#6f512f', dark: '#553e29', line: '#2a1d10', muzzle: '#c8ab84', ear: 'round', hat: true },
    bunny: { fur: '#6a4f9c', dark: '#54407c', line: '#241a3a', muzzle: '#cfc0e0', ear: 'long', tie: '#c03a4a' },
    chick: { fur: '#d9b736', dark: '#c9a02a', line: '#6a5210', muzzle: '#e8843a', ear: 'tuft', bib: true },
    springtrap: { fur: '#a8a34a', dark: '#7f7c33', line: '#33320f', muzzle: '#b9b478', ear: 'long', torn: true, tie: '#6a5a2a' },
    goldbear: { fur: '#e0bb42', dark: '#bd9a2c', line: '#4a3708', muzzle: '#f0dcaa', ear: 'round', hat: true, tie: '#3a2f10' },
  };
  // ============================================================
  //  一人称レンダラ ― 設定とバッファ
  //  低解像度のピクセルバッファへレイキャストで壁・床・天井を書き、
  //  そのうえに什器の箱とスプライトを重ねてから、2倍に拡大して表示する。
  // ============================================================
  const RW = 480, RH = 300;               // 3Dバッファの解像度(表示は2倍)
  const RSCALE = VIEW_W / RW;             // 拡大率
  const FOV = 1.16;                       // 水平画角(rad) およそ66度
  const TAN_HALF = Math.tan(FOV / 2);
  const PROJ = (RW / 2) / TAN_HALF;       // 投影距離
  // 1タイル(40px)を約1.5mとして寸法をそろえてある。
  const WALL_H = 68;                      // 天井までの高さ(ワールドpx) 約2.5m
  const ARENA_WALL_H = 120;               // ボイラー室だけは吹き抜け(マザーが4mある)
  const EYE_STAND = 40, EYE_CROUCH = 24;  // 目の高さ
  const FAR = 1150;                       // 描画の打ち切り距離

  const rcCv = document.createElement('canvas');
  rcCv.width = RW; rcCv.height = RH;
  const rcx = rcCv.getContext('2d');
  const rcImg = rcx.createImageData(RW, RH);
  const rcBuf = new Uint32Array(rcImg.data.buffer);

  // 列ごとの情報。スプライトの隠面消去に使う。
  const colDepth = new Float32Array(RW);     // 壁までの垂直距離
  const colPropD = new Float32Array(RW);     // 手前の什器までの垂直距離
  const colPropY = new Float32Array(RW);     // その什器の上端(スクリーンy)
  const colRayX = new Float32Array(RW), colRayY = new Float32Array(RW);
  const colLen = new Float32Array(RW);       // 垂直距離 → 実距離 の係数
  const colCone = new Float32Array(RW);      // 懐中電灯の角度減衰
  const colOff = new Float32Array(RW);       // 視軸からの角度

  for (let x = 0; x < RW; x++) {
    const cx2 = 2 * x / RW - 1;
    colOff[x] = Math.atan(cx2 * TAN_HALF);
    colLen[x] = Math.sqrt(1 + cx2 * cx2 * TAN_HALF * TAN_HALF);
  }

  // このフレームのカメラ
  const fpc = { x: 0, y: 0, yaw: 0, pitch: 0, eye: EYE_STAND, horizon: RH / 2, bob: 0, roll: 0, wallH: WALL_H };

  // ------------------------------------------------------------
  //  テクスチャ ― すべて手続きで描いて Uint32 の配列にする
  // ------------------------------------------------------------
  /** 正方テクスチャを1枚焼く。size は2の冪。 */
  function bakeTex(size, drawFn) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    drawFn(g, size);
    const img = g.getImageData(0, 0, size, size);
    return { w: size, m: size - 1, sh: Math.round(Math.log2(size)), d: new Uint32Array(img.data.buffer) };
  }

  /** テクスチャ用の乱数。焼き直しても同じ模様になるよう種を固定する。 */
  function texRng(seed) { return makeRng(seed); }

  const WALL_TEX = {};     // 壁紙。id → tex
  const CEIL_TEX = {};     // 天井
  const PROP_TEX = {};     // 什器の表面

  /** 表側(客席)の縦ストライプ壁紙。下三分の一は腰壁。 */
  function paintWallFront(g, S) {
    const r = texRng(11);
    g.fillStyle = '#6d3b44'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 16) {
      g.fillStyle = '#7d4750'; g.fillRect(i, 0, 8, S);
    }
    // 色あせと染み
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(20,10,12,${0.05 + r() * 0.14})`;
      g.fillRect(r() * S, r() * S, 3 + r() * 14, 3 + r() * 20);
    }
    // 腰壁
    g.fillStyle = '#3a2a24'; g.fillRect(0, S * 0.66, S, S * 0.34);
    g.fillStyle = '#4a362d'; g.fillRect(0, S * 0.66, S, 3);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, S * 0.66 + 3, S, 2);
    for (let i = 0; i < S; i += 21) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(i, S * 0.7, 1, S * 0.3); }
    // 巾木
    g.fillStyle = '#241a16'; g.fillRect(0, S - 5, S, 5);
  }

  /** 海賊の入り江。板張りの壁。 */
  function paintWallWood(g, S) {
    const r = texRng(23);
    g.fillStyle = '#42301f'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 13) {
      g.fillStyle = r() > 0.5 ? '#4a3624' : '#3a2a1b';
      g.fillRect(i, 0, 12, S);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(i + 12, 0, 1, S);
      // 木目
      g.strokeStyle = 'rgba(20,12,6,0.28)'; g.lineWidth = 1;
      g.beginPath();
      for (let y = 4; y < S; y += 9) { g.moveTo(i + 1, y + r() * 3); g.lineTo(i + 11, y + r() * 3); }
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, S - 6, S, 6);
  }

  /** ゲームコーナー。暗い壁にネオンの帯。 */
  function paintWallArcade(g, S) {
    const r = texRng(37);
    g.fillStyle = '#1d2333'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.03})`;
      g.fillRect(r() * S, r() * S, 2 + r() * 8, 2 + r() * 8);
    }
    g.fillStyle = '#2c6ea8'; g.fillRect(0, S * 0.42, S, 3);
    g.fillStyle = '#8ad4ff'; g.fillRect(0, S * 0.42 + 1, S, 1);
    g.fillStyle = '#a8348a'; g.fillRect(0, S * 0.52, S, 2);
    g.fillStyle = '#151a26'; g.fillRect(0, S * 0.72, S, S * 0.28);
  }

  /** 厨房。白い正方タイル。目地は油で汚れている。 */
  function paintWallTile(g, S) {
    const r = texRng(53);
    g.fillStyle = '#57584f'; g.fillRect(0, 0, S, S);
    const t = 11;
    for (let y = 0; y < S; y += t) {
      for (let x = 0; x < S; x += t) {
        const v = 0.78 + r() * 0.22;
        g.fillStyle = `rgb(${(150 * v) | 0},${(154 * v) | 0},${(144 * v) | 0})`;
        g.fillRect(x + 1, y + 1, t - 2, t - 2);
        if (r() > 0.93) { g.fillStyle = 'rgba(80,50,20,0.35)'; g.fillRect(x + 1, y + 1, t - 2, t - 2); }
      }
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(60,40,16,${0.06 + r() * 0.16})`;
      g.fillRect(r() * S, r() * S, 4 + r() * 18, 4 + r() * 22);
    }
  }

  /** 便所。小さい水色タイル。 */
  function paintWallRestroom(g, S) {
    const r = texRng(61);
    g.fillStyle = '#42505a'; g.fillRect(0, 0, S, S);
    const t = 8;
    for (let y = 0; y < S; y += t) {
      for (let x = 0; x < S; x += t) {
        const v = 0.75 + r() * 0.25;
        g.fillStyle = `rgb(${(118 * v) | 0},${(136 * v) | 0},${(148 * v) | 0})`;
        g.fillRect(x + 1, y + 1, t - 2, t - 2);
      }
    }
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(30,20,12,${0.08 + r() * 0.2})`;
      g.fillRect(r() * S, r() * S, 3 + r() * 12, 6 + r() * 26);
    }
  }

  /** 裏方。塗装されたブロック壁。 */
  function paintWallBack(g, S) {
    const r = texRng(71);
    g.fillStyle = '#4a4740'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      const off = (y / 16) % 2 ? 16 : 0;
      for (let x = -16; x < S; x += 32) {
        const v = 0.85 + r() * 0.2;
        g.fillStyle = `rgb(${(78 * v) | 0},${(75 * v) | 0},${(67 * v) | 0})`;
        g.fillRect(x + off + 1, y + 1, 30, 14);
      }
    }
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(20,16,10,${0.06 + r() * 0.18})`;
      g.fillRect(r() * S, r() * S, 4 + r() * 16, 4 + r() * 18);
    }
  }

  /** 地下。打ちっぱなしのコンクリートと錆の筋。 */
  function paintWallBasement(g, S) {
    const r = texRng(89);
    g.fillStyle = '#3a3630'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const v = r();
      g.fillStyle = `rgba(${v > 0.6 ? 90 : 30},${v > 0.6 ? 84 : 28},${v > 0.6 ? 74 : 24},${0.05 + r() * 0.16})`;
      g.fillRect(r() * S, r() * S, 2 + r() * 12, 2 + r() * 10);
    }
    // 錆の垂れ
    for (let i = 0; i < 5; i++) {
      const x = r() * S;
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, 'rgba(120,58,22,0.42)');
      gr.addColorStop(1, 'rgba(120,58,22,0)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 2 + r() * 4, S);
    }
    // 型枠の目地
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, S * 0.5, S, 2);
  }

  /** 天井。吸音パネルのグリッド。 */
  function paintCeilPanel(g, S) {
    const r = texRng(101);
    g.fillStyle = '#2b2c30'; g.fillRect(0, 0, S, S);
    const t = 16;
    for (let y = 0; y < S; y += t) {
      for (let x = 0; x < S; x += t) {
        const v = 0.82 + r() * 0.3;
        g.fillStyle = `rgb(${(60 * v) | 0},${(60 * v) | 0},${(62 * v) | 0})`;
        g.fillRect(x + 1, y + 1, t - 2, t - 2);
        if (r() > 0.86) { g.fillStyle = 'rgba(70,50,20,0.35)'; g.fillRect(x + 2, y + 2, t - 4, t - 4); }
      }
    }
  }

  /** 地下の天井。配線と梁。 */
  function paintCeilPipes(g, S) {
    const r = texRng(113);
    g.fillStyle = '#22211f'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.025})`;
      g.fillRect(r() * S, r() * S, 3 + r() * 10, 3 + r() * 8);
    }
    g.fillStyle = '#3c3a34'; g.fillRect(0, 12, S, 7);
    g.fillStyle = '#4c4a42'; g.fillRect(0, 12, S, 2);
    g.fillStyle = '#2e2c28'; g.fillRect(0, 40, S, 4);
    g.strokeStyle = '#1a1916'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 30); g.bezierCurveTo(S * 0.3, 34, S * 0.6, 24, S, 32); g.stroke();
  }

  const WALL_PAINTERS = {
    front: paintWallFront, wood: paintWallWood, arcade: paintWallArcade,
    tile: paintWallTile, restroom: paintWallRestroom, back: paintWallBack, basement: paintWallBasement,
  };
  // 部屋の種類 → 壁紙
  const WALL_OF_KIND = {
    stage: 'front', dining: 'front', party: 'front', prize: 'front', hall: 'front',
    cove: 'wood', arcade: 'arcade', kitchen: 'tile', restroom: 'restroom', ballpit: 'arcade',
    parts: 'back', backstage: 'back', storage: 'back', office: 'back', locker: 'back',
    utility: 'basement',
  };
  const CEIL_OF_KIND = {
    utility: 'pipes', parts: 'pipes', backstage: 'pipes', storage: 'pipes', locker: 'pipes',
  };

  // ------------------------------------------------------------
  //  什器のテクスチャ
  // ------------------------------------------------------------
  function paintPropWood(g, S) {
    const r = texRng(211);
    g.fillStyle = '#6a4a2c'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 10) {
      g.fillStyle = r() > 0.5 ? '#75522f' : '#5e4227';
      g.fillRect(0, y, S, 9);
      g.strokeStyle = 'rgba(30,18,8,0.4)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, y + 4 + r() * 3); g.lineTo(S, y + 4 + r() * 3); g.stroke();
    }
  }
  function paintPropMetal(g, S) {
    const r = texRng(223);
    g.fillStyle = '#6e7278'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 4) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
      g.fillRect(i, 0, 2, S);
    }
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(110,54,20,${0.1 + r() * 0.3})`;
      g.fillRect(r() * S, r() * S, 2 + r() * 8, 2 + r() * 10);
    }
  }
  function paintPropLocker(g, S) {
    const r = texRng(227);
    g.fillStyle = '#4d5a5e'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 16) {
      g.fillStyle = '#556367'; g.fillRect(x + 1, 1, 14, S - 2);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + 15, 0, 1, S);
      // 通気スリット
      g.fillStyle = 'rgba(0,0,0,0.5)';
      for (let i = 0; i < 4; i++) g.fillRect(x + 4, 5 + i * 3, 8, 1);
      // 取っ手
      g.fillStyle = '#8d9498'; g.fillRect(x + 11, S * 0.45, 2, 7);
    }
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(110,54,20,${0.1 + r() * 0.25})`; g.fillRect(r() * S, r() * S, 2 + r() * 7, 2 + r() * 9); }
  }
  function paintPropShelf(g, S) {
    const r = texRng(229);
    g.fillStyle = '#2a2622'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      g.fillStyle = '#5a5248'; g.fillRect(0, y, S, 4);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y + 4, S, 2);
      // 棚の中身
      for (let x = 2; x < S; x += 9) {
        if (r() > 0.45) continue;
        g.fillStyle = `hsl(${(r() * 60 + 15) | 0},${(20 + r() * 25) | 0}%,${(24 + r() * 16) | 0}%)`;
        g.fillRect(x, y + 6, 7, 8);
      }
    }
    g.fillStyle = '#4a443c'; g.fillRect(0, 0, 3, S); g.fillRect(S - 3, 0, 3, S);
  }
  function paintPropArcade(g, S) {
    const r = texRng(233);
    g.fillStyle = '#232838'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#11141c'; g.fillRect(4, 6, S - 8, S * 0.42);
    // 画面のノイズ
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(90,180,220,${r() * 0.3})`;
      g.fillRect(4 + r() * (S - 8), 6 + r() * (S * 0.42), 2, 1);
    }
    g.fillStyle = '#3b4258'; g.fillRect(0, S * 0.5, S, 5);
    for (let i = 0; i < 5; i++) { g.fillStyle = ['#d0403a', '#3a6ad0', '#d8b83a'][i % 3]; g.fillRect(8 + i * 9, S * 0.58, 5, 5); }
    g.fillStyle = '#181c26'; g.fillRect(0, S * 0.7, S, S * 0.3);
  }
  function paintPropPlastic(g, S) {
    const r = texRng(239);
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.16})`;
      g.fillRect(r() * S, r() * S, 3 + r() * 10, 3 + r() * 10);
    }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 2, S, 3);
  }
  function paintPropConcrete(g, S) {
    const r = texRng(241);
    g.fillStyle = '#4e4a44'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const v = r() > 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},${r() * 0.06})`;
      g.fillRect(r() * S, r() * S, 2 + r() * 9, 2 + r() * 9);
    }
  }
  function paintPropCurtain(g, S) {
    const r = texRng(251);
    g.fillStyle = '#5a1c46'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 7) {
      const v = 0.6 + Math.abs(Math.sin(x * 0.42)) * 0.6;
      g.fillStyle = `rgba(${(150 * v) | 0},${(40 * v) | 0},${(100 * v) | 0},1)`;
      g.fillRect(x, 0, 6, S);
    }
    for (let i = 0; i < 10; i++) {
      g.fillStyle = 'rgba(230,200,120,0.5)';
      const sx = r() * S, sy = r() * S;
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k / 5) * TAU, a2 = a + TAU / 10;
        k ? g.lineTo(sx + Math.cos(a) * 4, sy + Math.sin(a) * 4) : g.moveTo(sx + Math.cos(a) * 4, sy + Math.sin(a) * 4);
        g.lineTo(sx + Math.cos(a2) * 1.8, sy + Math.sin(a2) * 1.8);
      }
      g.closePath(); g.fill();
    }
  }
  function paintPropSteel(g, S) {
    const r = texRng(257);
    g.fillStyle = '#8e959a'; g.fillRect(0, 0, S, S);
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(255,255,255,0.16)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 16; i++) { g.fillStyle = `rgba(60,60,60,${r() * 0.2})`; g.fillRect(r() * S, r() * S, 2 + r() * 10, 1 + r() * 3); }
  }
  function paintPropBalls(g, S) {
    const r = texRng(263);
    g.fillStyle = '#1b2630'; g.fillRect(0, 0, S, S);
    const cols = ['#d8544a', '#4a86d8', '#e0c24a', '#63c46a', '#d87ac4'];
    for (let i = 0; i < 90; i++) {
      const x = r() * S, y = r() * S, rr = 3 + r() * 2.4;
      g.fillStyle = cols[(r() * cols.length) | 0];
      g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.35, 0, TAU); g.fill();
    }
  }
  function paintPropStage(g, S) {
    const r = texRng(269);
    g.fillStyle = '#2c1c24'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 8) { g.fillStyle = r() > 0.5 ? '#38242e' : '#301e28'; g.fillRect(0, y, S, 7); }
    g.fillStyle = 'rgba(220,180,90,0.14)'; g.fillRect(0, 0, S, 2);
  }
  function paintPropScreen(g, S) {
    const r = texRng(271);
    g.fillStyle = '#20242a'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#0b1014'; g.fillRect(3, 3, S - 6, S - 10);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(120,200,160,${r() * 0.28})`;
      g.fillRect(3 + r() * (S - 6), 3 + r() * (S - 10), 3, 1);
    }
    for (let y = 3; y < S - 7; y += 3) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(3, y, S - 6, 1); }
  }

  const PROP_PAINTERS = {
    wood: paintPropWood, metal: paintPropMetal, locker: paintPropLocker, shelf: paintPropShelf,
    arcade: paintPropArcade, plastic: paintPropPlastic, concrete: paintPropConcrete,
    curtain: paintPropCurtain, steel: paintPropSteel, balls: paintPropBalls,
    stage: paintPropStage, screen: paintPropScreen,
  };

  // ------------------------------------------------------------
  //  什器の立体化テーブル
  //  h=高さ / z=床からの浮き / t=表面テクスチャ / c=色味 / top=天板の色
  //  style: box=箱として立てる / flat=床の模様として無視 / bb=板(ビルボード)
  // ------------------------------------------------------------
  const PROP3D = {
    // --- 客席まわり ---
    partytable: { h: 20, t: 'wood', c: 0xb08a5a, top: 0xd8c8a8, style: 'box' },
    chair: { h: 18, t: 'wood', c: 0x9a7a5a, style: 'box', shrink: 0.6 },
    counter: { h: 26, t: 'steel', c: 0xb0b6bc, top: 0xc8ced4, style: 'box' },
    prizecounter: { h: 26, t: 'wood', c: 0xc09a70, top: 0xe0c8a0, style: 'box' },
    giftbox: { h: 17, t: 'plastic', c: 0xd0d0d0, style: 'box' },
    cake: { h: 12, fill: 0.5, style: 'bb', art: 'cake' },
    micstand: { h: 34, fill: 0.9, style: 'bb', art: 'micstand' },
    speaker: { h: 40, t: 'wood', c: 0x3a3a3e, top: 0x4a4a4e, style: 'box' },
    stagefloor: { h: 8, t: 'stage', c: 0xb09090, top: 0x9a7a86, style: 'box' },
    curtain: { h: 60, t: 'curtain', c: 0xffffff, style: 'box' },
    standee: { h: 44, fill: 0.84, style: 'bb', art: 'standee' },
    sign: { h: 12, fill: 0.18, z: 34, style: 'bb', art: 'sign' },
    // --- 遊具 ---
    arcade: { h: 44, t: 'arcade', c: 0xffffff, top: 0x30364a, style: 'box' },
    skeeball: { h: 26, t: 'wood', c: 0xa08050, top: 0xb89060, style: 'box' },
    ticketbin: { h: 18, t: 'plastic', c: 0x9aa0a6, style: 'box' },
    ballpit: { h: 12, t: 'balls', c: 0xffffff, top: 0xffffff, style: 'box' },
    slide: { h: 40, t: 'plastic', c: 0xd8a050, top: 0xe8b060, style: 'box' },
    pirateship: { h: 40, t: 'wood', c: 0x8a6238, top: 0x9a7040, style: 'box' },
    musicbox: { h: 20, t: 'wood', c: 0x9a7a4a, top: 0xc0a060, style: 'box' },
    plushshelf: { h: 46, t: 'shelf', c: 0xd0b0c0, style: 'box' },
    // --- 厨房・水回り ---
    oven: { h: 24, t: 'steel', c: 0x9aa0a4, top: 0xb0b6ba, style: 'box' },
    pizzarack: { h: 44, t: 'shelf', c: 0xb0b0a8, style: 'box' },
    sink: { h: 22, t: 'steel', c: 0xc0c8cc, top: 0xd8e0e4, style: 'box' },
    stall: { h: 54, t: 'locker', c: 0xa8b4b8, style: 'box' },
    // --- 裏方 ---
    workbench: { h: 24, t: 'wood', c: 0x9a8060, top: 0xb09070, style: 'box' },
    suitrack: { h: 48, t: 'shelf', c: 0xc0a880, style: 'box' },
    headshelf: { h: 46, t: 'shelf', c: 0xb0a090, style: 'box' },
    endoparts: { h: 8, fill: 0.25, style: 'bb', art: 'endoparts' },
    headpile: { h: 26, fill: 0.55, style: 'bb', art: 'headpile' },
    shelf: { h: 56, t: 'shelf', c: 0xffffff, style: 'box' },
    crate: { h: 26, t: 'wood', c: 0xa08050, top: 0xb89060, style: 'box' },
    barrel: { h: 24, t: 'metal', c: 0x8a7060, top: 0x9a8070, style: 'box' },
    boiler: { h: 52, t: 'metal', c: 0x9a8a70, top: 0xa89878, style: 'box' },
    furnace: { h: 64, t: 'metal', c: 0xb08060, top: 0xc09070, style: 'box' },
    pillar: { h: 68, t: 'concrete', c: 0xffffff, style: 'box' },
    desk: { h: 20, t: 'wood', c: 0x9a8a70, top: 0xb0a080, style: 'box' },
    monitors: { h: 30, t: 'screen', c: 0xffffff, top: 0x3a3e44, style: 'box' },
    cabinet: { h: 36, t: 'locker', c: 0xa0a8a0, style: 'box' },
    locker: { h: 50, t: 'locker', c: 0xffffff, style: 'box' },
    fan: { h: 12, fill: 0.47, style: 'bb', art: 'fan' },
    // --- 壁付け ---
    poster: { h: 12, fill: 0.34, z: 32, style: 'bb', art: 'poster' },
    vent: { h: 10, fill: 0.26, z: 38, style: 'bb', art: 'vent' },
    // --- 目標物 ---
    exitmachine: { h: 46, t: 'steel', c: 0x9ac0d8, top: 0xb0d0e8, style: 'box', glow: '#8ad4ff' },
    breaker: { h: 26, z: 24, t: 'steel', c: 0xb0b8b0, style: 'box', glow: '#ffd766' },
    windbox: { h: 20, t: 'wood', c: 0xb09050, top: 0xd0b070, style: 'box', glow: '#c9a7ff' },
    plush: { h: 34, fill: 0.84, style: 'bb', art: 'plush' },
    // --- 子どもの落とし物(床に転がる小物) ---
    balloon: { h: 22, fill: 0.51, z: 2, style: 'bb', art: 'balloon' },
    teddy: { h: 9, fill: 0.33, style: 'bb', art: 'teddy' },
    partyhat: { h: 7, fill: 0.36, style: 'bb', art: 'partyhat' },
    juicecup: { h: 5, fill: 0.28, style: 'bb', art: 'juicecup' },
    lostshoe: { h: 3, fill: 0.13, style: 'bb', art: 'lostshoe' },
    crayon: { h: 2, style: 'flat' },
    drawing: { h: 1, style: 'flat' },
    debris: { h: 4, style: 'flat' },
  };

  // 現在のフロアで使うテクスチャ表(タイルごとの壁紙・天井)
  let wallTexId = null, ceilTexId = null;
  let floorTex = null, floorTexW = 0, floorTexH = 0;
  const TEX_LIST = [];      // id → tex(壁)
  const CEIL_LIST = [];     // id → tex(天井)

  /** フロア生成のあとで、この階に必要なテクスチャを一式そろえる。 */
  function buildFpTextures() {
    // 壁紙・天井は一度焼けば使い回せる
    for (const k in WALL_PAINTERS) if (!WALL_TEX[k]) WALL_TEX[k] = bakeTex(64, WALL_PAINTERS[k]);
    if (!CEIL_TEX.panel) CEIL_TEX.panel = bakeTex(64, paintCeilPanel);
    if (!CEIL_TEX.pipes) CEIL_TEX.pipes = bakeTex(64, paintCeilPipes);
    for (const k in PROP_PAINTERS) if (!PROP_TEX[k]) PROP_TEX[k] = bakeTex(64, PROP_PAINTERS[k]);

    TEX_LIST.length = 0; CEIL_LIST.length = 0;
    const wIndex = {}, cIndex = {};
    const wallId = (name) => {
      if (wIndex[name] === undefined) { wIndex[name] = TEX_LIST.length; TEX_LIST.push(WALL_TEX[name] || WALL_TEX.back); }
      return wIndex[name];
    };
    const ceilId = (name) => {
      if (cIndex[name] === undefined) { cIndex[name] = CEIL_LIST.length; CEIL_LIST.push(CEIL_TEX[name] || CEIL_TEX.panel); }
      return cIndex[name];
    };

    const m = map;
    wallTexId = new Uint8Array(m.w * m.h);
    ceilTexId = new Uint8Array(m.w * m.h);
    const basement = m.arena || (m.def && m.def.code === 'PARTS');
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const i = ty * m.w + tx;
        if (isFloorTile(m, tx, ty)) {
          const kind = roomKindAt(tx, ty);
          ceilTexId[i] = ceilId(CEIL_OF_KIND[kind] || (basement ? 'pipes' : 'panel'));
        } else {
          // 隣接する床の部屋に合わせた壁紙を貼る
          let kind = null;
          if (isFloorTile(m, tx - 1, ty)) kind = roomKindAt(tx - 1, ty);
          else if (isFloorTile(m, tx + 1, ty)) kind = roomKindAt(tx + 1, ty);
          else if (isFloorTile(m, tx, ty - 1)) kind = roomKindAt(tx, ty - 1);
          else if (isFloorTile(m, tx, ty + 1)) kind = roomKindAt(tx, ty + 1);
          let name = WALL_OF_KIND[kind] || 'back';
          if (basement && (name === 'back' || !kind)) name = 'basement';
          wallTexId[i] = wallId(name);
        }
      }
    }

    // 床は焼き込み済みのキャンバスをそのまま texture として読む
    const img = bctx.getImageData(0, 0, map.pxW, map.pxH);
    floorTex = new Uint32Array(img.data.buffer);
    floorTexW = map.pxW; floorTexH = map.pxH;
  }
  // ============================================================
  //  一人称レンダラ ― 壁・床・天井
  //  列ごとに DDA でレイを飛ばして壁を見つけ、その上下に床と天井を投影する。
  //  照らされ方は「距離 × 視軸からの角度」で決まる。懐中電灯は必ず正面を向くので、
  //  列ごとの角度減衰を一度計算すれば、あとは距離だけで足りる。
  // ============================================================
  const AMB_BASE = 0.055;          // 完全な暗闇でも残るわずかな明るさ
  const LAMP_MAX = 5;              // 1フレームで考慮する据え置き照明の数

  const rowDistF = new Float32Array(RH + 1);   // 床用: スクリーンy → 距離
  const rowDistC = new Float32Array(RH + 1);   // 天井用
  const lampBuf = [];

  /** カメラを更新する。歩きに合わせた頭の上下動と、被弾・恐怖による揺さぶり。 */
  function updateFpCamera(dt) {
    const p = player;
    const crouch = isCrouching();
    const targetEye = crouch ? EYE_CROUCH : EYE_STAND;
    fpc.eye = lerp(fpc.eye, targetEye, Math.min(1, dt * 9));
    // 歩行の上下動。走るほど大きく速い。
    const amp = p.sprinting ? 2.6 : crouch ? 0.8 : 1.5;
    fpc.bob = Math.sin(p.walk * 2) * amp * (p.hiding ? 0 : 1);
    fpc.roll = Math.sin(p.walk) * (p.sprinting ? 0.022 : 0.012);
    // 息づかいでもわずかに揺れる
    fpc.bob += Math.sin(p.breath * TAU) * 0.7 * clamp(p.breathRate, 0, 2.4);
    if (cam.shakeT > 0) { cam.shakeT -= dt; cam.shake *= 0.86; } else cam.shake = 0;
    fpc.x = p.x; fpc.y = p.y;
    fpc.yaw = p.aim;
    // 正気度が落ちると水平が保てなくなる
    const mad = clamp((40 - p.sanity) / 40, 0, 1);
    if (mad > 0 && !modLv('nerve')) fpc.roll += Math.sin(gameT * 0.9) * mad * 0.05;
  }

  /** このフレームで効いてくる据え置き照明を近い順に集める。 */
  function collectLamps() {
    lampBuf.length = 0;
    for (let i = 0; i < lamps.length; i++) {
      const L = lamps[i];
      if (!L.on || L.broken) continue;
      const d2v = dist2(L.x, L.y, fpc.x, fpc.y);
      if (d2v > (L.r + 620) * (L.r + 620)) continue;
      L._d2 = d2v;
      lampBuf.push(L);
    }
    lampBuf.sort((a, b) => a._d2 - b._d2);
    if (lampBuf.length > LAMP_MAX) lampBuf.length = LAMP_MAX;
    for (const L of lampBuf) {
      const c = L.rgb || (L.rgb = hexRgb(L.color));
      L._r = c[0] / 255; L._g = c[1] / 255; L._b = c[2] / 255;
      L._i = 0.92 * (L.k === undefined ? 1 : clamp(L.k, 0, 1));
      L._rr = 1 / (L.r * L.r);
    }
  }

  /** #rrggbb と不透明度から rgba() 文字列を作る。 */
  function hexA(hex, a) {
    const h = (hex || '#ffffff').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function hexRgb(hex) {
    const h = (hex || '#ffffff').replace('#', '');
    const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  /**
   * 世界を1フレーム描く。書き込み先は rcBuf (RW×RH の 32bit バッファ)。
   */
  function renderFpWorld() {
    const p = player;
    const m = map;
    const shakeA = cam.shake > 0 ? rnd(-cam.shake, cam.shake) * 0.004 : 0;
    const yaw = fpc.yaw + shakeA;
    const dirX = Math.cos(yaw), dirY = Math.sin(yaw);
    const planeX = -dirY * TAN_HALF, planeY = dirX * TAN_HALF;
    const camX = fpc.x, camY = fpc.y;
    const eye = fpc.eye + fpc.bob;
    const horizon = Math.round(RH / 2 + fpc.pitch * PROJ + (cam.shake > 0 ? rnd(-cam.shake, cam.shake) * 0.5 : 0));
    fpc.horizon = horizon;

    // --- 懐中電灯 ---
    const lightOn = p.lightOn && p.battery > 0 && !p.hiding;
    const range = lightOn ? Math.max(60, p.lightRangeNow) : 0;
    const arc = p.lightArcNow;
    const beamK = lightOn ? 1.55 * p.flicker : 0;
    const invRange = range > 0 ? 1 / range : 0;
    for (let x = 0; x < RW; x++) {
      const a = Math.abs(colOff[x]);
      let k = 0;
      if (lightOn) {
        if (a < arc * 0.55) k = 1;
        else if (a < arc * 1.25) k = 1 - (a - arc * 0.55) / (arc * 0.7);
        if (k < 0) k = 0;
        k *= k * (3 - 2 * k);      // 縁をなめらかに
      }
      colCone[x] = k * beamK;
      const cx2 = 2 * x / RW - 1;
      colRayX[x] = dirX + planeX * cx2;
      colRayY[x] = dirY + planeY * cx2;
    }

    // 行ごとの距離をあらかじめ求めておく
    fpc.wallH = map.arena ? ARENA_WALL_H : WALL_H;
    const wallH = fpc.wallH;
    const ceilH = wallH - eye;
    for (let y = 0; y < RH; y++) {
      const pf = y - horizon;
      rowDistF[y] = pf > 0.5 ? eye * PROJ / pf : 1e9;
      const pc = horizon - y;
      rowDistC[y] = pc > 0.5 ? ceilH * PROJ / pc : 1e9;
    }

    collectLamps();
    const nLamp = lampBuf.length;

    const mw = m.w, mh = m.h, cells = m.cells;
    const ftW = floorTexW, ftH = floorTexH, ftD = floorTex;
    const ambR = 0.30, ambInv = 1 / AMBIENT_R;
    const LMAX = 1.5;                       // 明るさの上限(これ以上は白く飛ぶ)

    for (let x = 0; x < RW; x++) {
      const rayX = colRayX[x], rayY = colRayY[x];
      // --- DDA ---
      let posX = camX / TILE, posY = camY / TILE;
      let mapX = posX | 0, mapY = posY | 0;
      const dDistX = rayX === 0 ? 1e9 : Math.abs(1 / rayX);
      const dDistY = rayY === 0 ? 1e9 : Math.abs(1 / rayY);
      let stepX, stepY, sideDistX, sideDistY;
      if (rayX < 0) { stepX = -1; sideDistX = (posX - mapX) * dDistX; }
      else { stepX = 1; sideDistX = (mapX + 1 - posX) * dDistX; }
      if (rayY < 0) { stepY = -1; sideDistY = (posY - mapY) * dDistY; }
      else { stepY = 1; sideDistY = (mapY + 1 - posY) * dDistY; }
      let side = 0, steps = 0, hit = false;
      while (steps++ < 96) {
        if (sideDistX < sideDistY) { sideDistX += dDistX; mapX += stepX; side = 0; }
        else { sideDistY += dDistY; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= mw || mapY >= mh) { hit = true; break; }
        if (cells[mapY * mw + mapX] === 0) { hit = true; break; }
      }
      let perp = side === 0 ? (sideDistX - dDistX) : (sideDistY - dDistY);
      perp *= TILE;
      if (perp < 1) perp = 1;
      if (!hit) perp = FAR;
      colDepth[x] = perp;
      colPropD[x] = 1e9;
      colPropY[x] = RH;

      const len = colLen[x];
      const cone = colCone[x];

      // --- 壁 ---
      let yTop = horizon + (eye - wallH) * PROJ / perp;
      let yBot = horizon + eye * PROJ / perp;
      const wallTop = yTop, wallBot = yBot;
      let tex = null, texX = 0;
      if (hit && mapX >= 0 && mapY >= 0 && mapX < mw && mapY < mh) {
        tex = TEX_LIST[wallTexId[mapY * mw + mapX]] || TEX_LIST[0];
        let wallHit = side === 0 ? (camY / TILE + (perp / TILE) * rayY) : (camX / TILE + (perp / TILE) * rayX);
        wallHit -= Math.floor(wallHit);
        texX = (wallHit * tex.w) | 0;
        if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = tex.w - texX - 1;
      }

      const dWall = perp * len;
      let wallLight = AMB_BASE + cone * (1 - Math.min(1, dWall * invRange)) * (1 - Math.min(1, dWall * invRange));
      if (dWall < AMBIENT_R) wallLight += (1 - dWall * ambInv) * ambR;
      if (side === 1) wallLight *= 0.74;
      let wallR = wallLight, wallG = wallLight, wallB = wallLight;
      if (nLamp && hit) {
        const hx = camX + rayX * perp, hy = camY + rayY * perp;
        for (let li = 0; li < nLamp; li++) {
          const L = lampBuf[li];
          const dx = hx - L.x, dy = hy - L.y;
          const dd = (dx * dx + dy * dy) * L._rr;
          if (dd >= 1) continue;
          const k = (1 - dd) * (1 - dd) * L._i;
          wallR += k * L._r; wallG += k * L._g; wallB += k * L._b;
        }
        if (wallR > LMAX) wallR = LMAX;
        if (wallG > LMAX) wallG = LMAX;
        if (wallB > LMAX) wallB = LMAX;
      }

      let ys = yTop | 0, ye = yBot | 0;
      if (ys < 0) ys = 0;
      if (ye > RH) ye = RH;
      if (tex && ye > ys) {
        const tw = tex.w, td = tex.d;
        const stepT = tw / (wallBot - wallTop);
        let texPos = (ys - wallTop) * stepT;
        let o = ys * RW + x;
        for (let y = ys; y < ye; y++) {
          let ty = texPos | 0;
          if (ty < 0) ty = 0; else if (ty >= tw) ty = tw - 1;
          texPos += stepT;
          const c = td[(ty << tex.sh) + texX];
          const r0 = c & 255, g0 = (c >> 8) & 255, b0 = (c >> 16) & 255;
          let r1 = r0 * wallR, g1 = g0 * wallG, b1 = b0 * wallB;
          if (r1 > 255) r1 = 255; if (g1 > 255) g1 = 255; if (b1 > 255) b1 = 255;
          rcBuf[o] = 0xff000000 | (b1 << 16) | (g1 << 8) | r1;
          o += RW;
        }
      }

      // --- 床 ---
      let fy0 = yBot | 0; if (fy0 < 0) fy0 = 0;
      let o2 = fy0 * RW + x;
      for (let y = fy0; y < RH; y++) {
        const d = rowDistF[y];
        const wx = camX + rayX * d, wy = camY + rayY * d;
        let c = 0xff0a0a0c;
        const ix = wx | 0, iy = wy | 0;
        if (ix >= 0 && iy >= 0 && ix < ftW && iy < ftH) c = ftD[iy * ftW + ix];
        const de = d * len;
        let lt = AMB_BASE + cone * (1 - Math.min(1, de * invRange)) * (1 - Math.min(1, de * invRange));
        if (de < AMBIENT_R) lt += (1 - de * ambInv) * ambR;
        let lr = lt, lg = lt, lb = lt;
        if (nLamp) {
          for (let li = 0; li < nLamp; li++) {
            const L = lampBuf[li];
            const dx = wx - L.x, dy = wy - L.y;
            const dd = (dx * dx + dy * dy) * L._rr;
            if (dd >= 1) continue;
            const k = (1 - dd) * (1 - dd) * L._i;
            lr += k * L._r; lg += k * L._g; lb += k * L._b;
          }
          if (lr > LMAX) lr = LMAX;
          if (lg > LMAX) lg = LMAX;
          if (lb > LMAX) lb = LMAX;
        }
        let r1 = (c & 255) * lr, g1 = ((c >> 8) & 255) * lg, b1 = ((c >> 16) & 255) * lb;
        if (r1 > 255) r1 = 255; if (g1 > 255) g1 = 255; if (b1 > 255) b1 = 255;
        rcBuf[o2] = 0xff000000 | (b1 << 16) | (g1 << 8) | r1;
        o2 += RW;
      }

      // --- 天井 ---
      let cy1 = yTop | 0; if (cy1 > RH) cy1 = RH;
      let o3 = x;
      for (let y = 0; y < cy1; y++) {
        const d = rowDistC[y];
        const wx = camX + rayX * d, wy = camY + rayY * d;
        const tx2 = wx / TILE | 0, ty2 = wy / TILE | 0;
        let c = 0xff101012;
        if (tx2 >= 0 && ty2 >= 0 && tx2 < mw && ty2 < mh) {
          const ct = CEIL_LIST[ceilTexId[ty2 * mw + tx2]] || CEIL_LIST[0];
          const u = ((wx * 1.6) | 0) & ct.m, v = ((wy * 1.6) | 0) & ct.m;
          c = ct.d[(v << ct.sh) + u];
        }
        const de = d * len;
        let lt = AMB_BASE * 0.7 + cone * (1 - Math.min(1, de * invRange)) * (1 - Math.min(1, de * invRange)) * 0.7;
        let lr = lt, lg = lt, lb = lt;
        if (nLamp) {
          for (let li = 0; li < nLamp; li++) {
            const L = lampBuf[li];
            const dx = wx - L.x, dy = wy - L.y;
            const dd = (dx * dx + dy * dy) * L._rr;
            if (dd >= 1) continue;
            const k = (1 - dd) * (1 - dd) * L._i;
            lr += k * L._r; lg += k * L._g; lb += k * L._b;
          }
          if (lr > LMAX) lr = LMAX;
          if (lg > LMAX) lg = LMAX;
          if (lb > LMAX) lb = LMAX;
        }
        let r1 = (c & 255) * lr, g1 = ((c >> 8) & 255) * lg, b1 = ((c >> 16) & 255) * lb;
        if (r1 > 255) r1 = 255; if (g1 > 255) g1 = 255; if (b1 > 255) b1 = 255;
        rcBuf[o3] = 0xff000000 | (b1 << 16) | (g1 << 8) | r1;
        o3 += RW;
      }
    }

    drawPropBoxes(camX, camY, dirX, dirY, planeX, planeY, eye, horizon);
    rcx.putImageData(rcImg, 0, 0);
  }
  // ============================================================
  //  一人称レンダラ ― 什器(箱)とスプライト
  // ============================================================
  const PROP_UV = 0.9;        // ワールド1px あたりのテクセル数
  const propOrder = [];

  /**
   * 什器を直方体として描く。
   * 列ごとにレイと箱の交差を取り、側面と天板の縦帯を書き込む。
   * 奥から手前へ順に描くので、重なりは自然に解決する。
   */
  function drawPropBoxes(camX, camY, dirX, dirY, planeX, planeY, eye, horizon) {
    propOrder.length = 0;
    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      const def = PROP3D[pr.type];
      if (!def || def.style !== 'box') continue;
      if (pr.broken) continue;
      const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
      const dx = cx - camX, dy = cy - camY;
      const d2v = dx * dx + dy * dy;
      if (d2v > FAR * FAR) continue;
      // 視野の外は捨てる(箱の対角ぶんだけ余裕を持たせる)
      const depth = dx * dirX + dy * dirY;
      const halfDiag = Math.hypot(pr.w, pr.h) * 0.5;
      if (depth < -halfDiag) continue;
      pr._d2 = d2v; pr._def = def;
      propOrder.push(pr);
    }
    propOrder.sort((a, b) => b._d2 - a._d2);

    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const nLamp = lampBuf.length;
    const p = player;
    const lightOn = p.lightOn && p.battery > 0 && !p.hiding;
    const range = lightOn ? Math.max(60, p.lightRangeNow) : 1;
    const invRange = lightOn ? 1 / range : 0;
    const ambInv = 1 / AMBIENT_R;

    for (let pi = 0; pi < propOrder.length; pi++) {
      const pr = propOrder[pi];
      const def = pr._def;
      const shrink = def.shrink || 1;
      const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
      const hw = pr.w * 0.5 * shrink, hh = pr.h * 0.5 * shrink;
      const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
      const zBase = def.z || 0;
      const zTop = zBase + def.h;

      // --- スクリーン上の左右の端 ---
      let sxMin = 1e9, sxMax = -1e9, behind = false;
      for (let k = 0; k < 4; k++) {
        const wx = k & 1 ? x1 : x0, wy = k & 2 ? y1 : y0;
        const rx = wx - camX, ry = wy - camY;
        const ty = invDet * (-planeY * rx + planeX * ry);
        if (ty < 1) { behind = true; continue; }
        const tx = invDet * (dirY * rx - dirX * ry);
        const sx = (RW / 2) * (1 + tx / ty);
        if (sx < sxMin) sxMin = sx;
        if (sx > sxMax) sxMax = sx;
      }
      if (sxMin > 1e8) continue;
      if (behind) { sxMin = 0; sxMax = RW; }
      let cs = Math.floor(sxMin) - 1, ce = Math.ceil(sxMax) + 1;
      if (cs < 0) cs = 0;
      if (ce > RW) ce = RW;
      if (ce <= cs) continue;

      const tex = PROP_TEX[def.t] || PROP_TEX.wood;
      const tw = tex.w, tm = tex.m, tsh = tex.sh, td = tex.d;
      const tint = def.c === undefined ? 0xffffff : def.c;
      const tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;
      const topTint = def.top === undefined ? tint : def.top;
      const pr2 = ((topTint >> 16) & 255) / 255, pg2 = ((topTint >> 8) & 255) / 255, pb2 = (topTint & 255) / 255;
      let emis = 0;
      if (def.glow) {
        const on = pr.on || pr.turned || (pr.type === 'exitmachine' && objectiveComplete());
        emis = (on ? 0.75 : 0.32) * (0.72 + Math.sin(gameT * 3 + pr.x * 0.05) * 0.28);
      }
      const eR = def.glow ? hexRgb(def.glow) : null;

      for (let x = cs; x < ce; x++) {
        const rayX = colRayX[x], rayY = colRayY[x];
        // --- スラブ法で箱との交差を取る ---
        let tmin = 0.4, tmax = colDepth[x], axis = 0;
        if (rayX > 1e-9 || rayX < -1e-9) {
          let ta = (x0 - camX) / rayX, tb2 = (x1 - camX) / rayX;
          if (ta > tb2) { const s = ta; ta = tb2; tb2 = s; }
          if (ta > tmin) { tmin = ta; axis = 0; }
          if (tb2 < tmax) tmax = tb2;
        } else if (camX < x0 || camX > x1) continue;
        if (rayY > 1e-9 || rayY < -1e-9) {
          let ta = (y0 - camY) / rayY, tb2 = (y1 - camY) / rayY;
          if (ta > tb2) { const s = ta; ta = tb2; tb2 = s; }
          if (ta > tmin) { tmin = ta; axis = 1; }
          if (tb2 < tmax) tmax = tb2;
        } else if (camY < y0 || camY > y1) continue;
        if (tmin >= tmax) continue;

        const len = colLen[x];
        const cone = colCone[x];
        const dEnter = tmin, dExit = tmax;

        // --- 面の明るさ ---
        const hx = camX + rayX * dEnter, hy = camY + rayY * dEnter;
        const de = dEnter * len;
        let lt = AMB_BASE + cone * (1 - Math.min(1, de * invRange)) * (1 - Math.min(1, de * invRange));
        if (de < AMBIENT_R) lt += (1 - de * ambInv) * 0.30;
        let lr = lt, lg = lt, lb = lt;
        for (let li = 0; li < nLamp; li++) {
          const L = lampBuf[li];
          const dx = hx - L.x, dy = hy - L.y;
          const dd = (dx * dx + dy * dy) * L._rr;
          if (dd >= 1) continue;
          const k = (1 - dd) * (1 - dd) * L._i;
          lr += k * L._r; lg += k * L._g; lb += k * L._b;
        }
        if (lr > 1.5) lr = 1.5;
        if (lg > 1.5) lg = 1.5;
        if (lb > 1.5) lb = 1.5;
        const face = axis === 1 ? 0.76 : 1.0;
        let sr = lr * tr * face, sg = lg * tg * face, sb = lb * tb * face;
        if (eR) { sr += emis * eR[0] / 255; sg += emis * eR[1] / 255; sb += emis * eR[2] / 255; }

        // --- 側面 ---
        const yTopN = horizon + (eye - zTop) * PROJ / dEnter;
        const yBotN = horizon + (eye - zBase) * PROJ / dEnter;
        const uCoord = axis === 0 ? hy : hx;
        const texX = (((uCoord * PROP_UV) | 0) & tm);
        let ys = yTopN | 0, ye = yBotN | 0;
        if (ys < 0) ys = 0;
        if (ye > RH) ye = RH;
        if (ye > ys) {
          const stepT = tw / (yBotN - yTopN);
          let texPos = (ys - yTopN) * stepT;
          let o = ys * RW + x;
          for (let y = ys; y < ye; y++) {
            let ty2 = texPos | 0;
            if (ty2 < 0) ty2 = 0; else if (ty2 >= tw) ty2 = tw - 1;
            texPos += stepT;
            const c = td[(ty2 << tsh) + texX];
            let r1 = (c & 255) * sr, g1 = ((c >> 8) & 255) * sg, b1 = ((c >> 16) & 255) * sb;
            if (r1 > 255) r1 = 255; if (g1 > 255) g1 = 255; if (b1 > 255) b1 = 255;
            rcBuf[o] = 0xff000000 | (b1 << 16) | (g1 << 8) | r1;
            o += RW;
          }
        }

        // --- 天板(目より低いときだけ見える) ---
        if (zTop < eye) {
          const dz = eye - zTop;
          const yFar = horizon + dz * PROJ / dExit;
          let ts = yFar | 0, te = yTopN | 0;
          if (ts < 0) ts = 0;
          if (te > RH) te = RH;
          if (te > ts) {
            let o = ts * RW + x;
            for (let y = ts; y < te; y++) {
              const d = dz * PROJ / (y - horizon);
              const wx = camX + rayX * d, wy = camY + rayY * d;
              const c = td[((((wy * PROP_UV) | 0) & tm) << tsh) + (((wx * PROP_UV) | 0) & tm)];
              const dd2 = d * len;
              let l2 = AMB_BASE + cone * (1 - Math.min(1, dd2 * invRange)) * (1 - Math.min(1, dd2 * invRange));
              if (dd2 < AMBIENT_R) l2 += (1 - dd2 * ambInv) * 0.30;
              let ar = l2, ag = l2, ab = l2;
              for (let li = 0; li < nLamp; li++) {
                const L = lampBuf[li];
                const dx = wx - L.x, dy = wy - L.y;
                const ddv = (dx * dx + dy * dy) * L._rr;
                if (ddv >= 1) continue;
                const k = (1 - ddv) * (1 - ddv) * L._i;
                ar += k * L._r; ag += k * L._g; ab += k * L._b;
              }
              if (ar > 1.5) ar = 1.5;
              if (ag > 1.5) ag = 1.5;
              if (ab > 1.5) ab = 1.5;
              ar *= pr2 * 1.12; ag *= pg2 * 1.12; ab *= pb2 * 1.12;
              if (eR) { ar += emis * eR[0] / 255; ag += emis * eR[1] / 255; ab += emis * eR[2] / 255; }
              let r1 = (c & 255) * ar, g1 = ((c >> 8) & 255) * ag, b1 = ((c >> 16) & 255) * ab;
              if (r1 > 255) r1 = 255; if (g1 > 255) g1 = 255; if (b1 > 255) b1 = 255;
              rcBuf[o] = 0xff000000 | (b1 << 16) | (g1 << 8) | r1;
              o += RW;
            }
            if (ts < colPropY[x]) colPropY[x] = ts;
          }
        }
        if (ys < colPropY[x]) colPropY[x] = ys;
        if (dEnter < colPropD[x]) colPropD[x] = dEnter;
      }
    }
  }

  // ------------------------------------------------------------
  //  スプライト(ビルボード)
  //  絵は「底辺の中心が原点、縦100・横100の枠」に描く約束にしてある。
  // ------------------------------------------------------------
  const SPR = 200;                     // 下書きキャンバスの一辺
  const sprCv = document.createElement('canvas');
  sprCv.width = SPR; sprCv.height = SPR;
  const sctx = sprCv.getContext('2d');

  /** その地点の明るさ(0..∞)。スプライトの陰影に使う。 */
  function lightAtPoint(wx, wy, depth) {
    const p = player;
    const d = dist(p.x, p.y, wx, wy);
    let l = AMB_BASE;
    if (p.lightOn && p.battery > 0 && !p.hiding) {
      const a = angDiff(Math.atan2(wy - p.y, wx - p.x), p.aim);
      const arc = p.lightArcNow;
      let k = a < arc * 0.55 ? 1 : (a < arc * 1.25 ? 1 - (a - arc * 0.55) / (arc * 0.7) : 0);
      if (k > 0) {
        k = k * k * (3 - 2 * k);
        const f = Math.max(0, 1 - d / Math.max(60, p.lightRangeNow));
        l += k * f * f * 1.55 * p.flicker;
      }
    }
    if (d < AMBIENT_R) l += (1 - d / AMBIENT_R) * 0.30;
    for (let i = 0; i < lampBuf.length; i++) {
      const L = lampBuf[i];
      const dd = dist2(wx, wy, L.x, L.y) * L._rr;
      if (dd < 1) l += (1 - dd) * (1 - dd) * L._i * 0.9;
    }
    return l;
  }

  /**
   * ビルボードを1枚描く。
   * artFn は sctx に対して「底辺中心が原点、100×100 の枠」で絵を描く。
   */
  function drawBillboard(wx, wy, zBase, worldH, artFn, opt) {
    const o = opt || {};
    const rx = wx - fpc.x, ry = wy - fpc.y;
    const dirX = Math.cos(fpc.yaw), dirY = Math.sin(fpc.yaw);
    const planeX = -dirY * TAN_HALF, planeY = dirX * TAN_HALF;
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const ty = invDet * (-planeY * rx + planeX * ry);
    if (ty < 6 || ty > FAR) return;
    const tx = invDet * (dirY * rx - dirX * ry);
    const sxc = (RW / 2) * (1 + tx / ty);
    const hS = worldH * PROJ / ty;
    const wS = hS * (o.aspect || 1);
    if (hS < 1.2) return;
    const yBot = fpc.horizon + (fpc.eye - zBase) * PROJ / ty;
    const yTop = yBot - hS;
    let cs = Math.floor(sxc - wS / 2), ce = Math.ceil(sxc + wS / 2);
    if (ce <= 0 || cs >= RW) return;

    // --- 下書き ---
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, SPR, SPR);
    sctx.save();
    sctx.translate(SPR / 2, SPR);
    sctx.scale(SPR / 100, SPR / 100);
    artFn(sctx);
    sctx.restore();

    // 明るさを焼き込む(絵のある画素だけ暗くする)
    let lit = o.light === undefined ? lightAtPoint(wx, wy, ty) : o.light;
    lit = clamp(lit, 0, 1.12);
    sctx.save();
    sctx.globalCompositeOperation = 'source-atop';
    if (lit < 1) {
      sctx.fillStyle = `rgba(4,4,6,${clamp(1 - lit, 0, 0.985)})`;
      sctx.fillRect(0, 0, SPR, SPR);
    } else if (lit > 1.02) {
      sctx.fillStyle = `rgba(255,246,220,${clamp((lit - 1) * 0.9, 0, 0.11)})`;
      sctx.fillRect(0, 0, SPR, SPR);
    }
    if (o.tint) { sctx.fillStyle = o.tint; sctx.fillRect(0, 0, SPR, SPR); }
    sctx.restore();
    // 目の光など、暗くても光り続けるもの
    if (o.glowFn) {
      sctx.save();
      sctx.translate(SPR / 2, SPR);
      sctx.scale(SPR / 100, SPR / 100);
      sctx.globalCompositeOperation = 'lighter';
      o.glowFn(sctx, lit);
      sctx.restore();
    }

    // --- 列ごとの可視判定をまとめて転送 ---
    const alpha = o.alpha === undefined ? 1 : o.alpha;
    rcx.globalAlpha = alpha;
    if (o.blend) rcx.globalCompositeOperation = o.blend;
    let runStart = -1, runKey = -2, runLim = RH;
    const flush = (end) => {
      if (runStart < 0 || runKey < 0) return;
      rcx.save();
      rcx.beginPath();
      rcx.rect(runStart, 0, end - runStart, Math.min(RH, runLim));
      rcx.clip();
      rcx.drawImage(sprCv, sxc - wS / 2, yTop, wS, hS);
      rcx.restore();
    };
    for (let x = Math.max(0, cs); x <= Math.min(RW, ce); x++) {
      let key = -1, lim = RH;
      if (x < RW) {
        if (o.through || ty < colDepth[x]) {
          key = 9999;
          if (!o.through && ty > colPropD[x]) {
            lim = colPropY[x];
            if (lim <= yTop + 1) key = -1;
            else key = (lim / 5) | 0;
          }
        }
      }
      if (key !== runKey) {
        flush(x);
        runStart = x; runKey = key; runLim = lim;
      }
    }
    flush(Math.min(RW, ce + 1));
    rcx.globalAlpha = 1;
    rcx.globalCompositeOperation = 'source-over';
  }
  // ============================================================
  //  一人称レンダラ ― キャラクターの絵(正面向き)
  //  すべて「底辺の中心が原点、縦100・横100の枠」に描く。
  //  s は横方向のずらし量で、こちらに対する向き(正面=0 / 真横=±1)を表す。
  // ============================================================
  function sLimb(g, x0, y0, x1, y1, w, color) {
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  function sEllipse(g, x, y, rx, ry, color, rot) {
    g.fillStyle = color;
    g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); g.fill();
  }
  /** 光る目。暗闇でも見える。 */
  function sEye(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  function sTeeth(g, x, y, w, h, n, color) {
    g.fillStyle = color;
    const step = w / n;
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.moveTo(x - w / 2 + i * step, y);
      g.lineTo(x - w / 2 + (i + 0.5) * step, y + h);
      g.lineTo(x - w / 2 + (i + 1) * step, y);
      g.closePath(); g.fill();
    }
  }

  // ------------------------------------------------------------
  //  エンドスケルトン ― 外皮のない骨組み
  // ------------------------------------------------------------
  function artEndo(g, o) {
    const t = o.t, s = o.s, sw = Math.sin(t * 6) * (o.moving ? 1 : 0.15);
    const lean = s * 6;
    const M = '#767c85', D = '#4a4f57', L = '#949ba3';
    // 脚
    sLimb(g, -8, -34, -9 + sw * 5, -2, 5, D);
    sLimb(g, 8, -34, 9 - sw * 5, -2, 5, D);
    sEllipse(g, -9 + sw * 5, -2, 6, 3, '#4a4e52');
    sEllipse(g, 9 - sw * 5, -2, 6, 3, '#4a4e52');
    // 骨盤と背骨
    sEllipse(g, lean * 0.4, -38, 10, 6, M);
    sLimb(g, lean * 0.4, -38, lean, -60, 6, M);
    // 肋のような骨組み
    g.strokeStyle = D; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = -44 - i * 5;
      g.beginPath(); g.ellipse(lean * 0.6, y, 11 - i * 0.8, 3, 0, 0, TAU); g.stroke();
    }
    // 腕
    const armSw = o.attack ? -1.2 : sw * 0.7;
    sLimb(g, -12 + lean, -60, -19 + lean, -46 + armSw * 6, 4, M);
    sLimb(g, -19 + lean, -46 + armSw * 6, -22 + lean, -30 + armSw * 10, 3.4, M);
    sLimb(g, 12 + lean, -60, 19 + lean, -46 - armSw * 6, 4, M);
    sLimb(g, 19 + lean, -46 - armSw * 6, 22 + lean, -30 - armSw * 10, 3.4, M);
    // 手(指が3本)
    for (const hx of [-22, 22]) {
      for (let i = -1; i <= 1; i++) sLimb(g, hx + lean, -30, hx + lean + i * 3, -24, 1.6, L);
    }
    // 肩
    sEllipse(g, -12 + lean, -60, 5, 4, L);
    sEllipse(g, 12 + lean, -60, 5, 4, L);
    // 頭
    const hx2 = lean * 1.3, hy = -70;
    sEllipse(g, hx2, hy, 12, 13, M);
    sEllipse(g, hx2, hy + 4, 10, 9, D);      // 顎まわり
    g.fillStyle = L;
    g.beginPath(); g.ellipse(hx2, hy - 6, 12, 8, 0, Math.PI, 0); g.fill();
    // 頭の継ぎ目
    g.strokeStyle = '#33373d'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(hx2 - 12, hy - 4); g.lineTo(hx2 + 12, hy - 4); g.stroke();
    g.beginPath(); g.moveTo(hx2, hy - 19); g.lineTo(hx2, hy - 6); g.stroke();
    // 目
    if (Math.abs(s) < 0.92) {
      sEye(g, hx2 - 4.6 + s * 2, hy - 2, 2.6, '#0b0c0e');
      sEye(g, hx2 + 4.6 + s * 2, hy - 2, 2.6, '#0b0c0e');
      sTeeth(g, hx2 + s * 2, hy + 6, 13, 4, 6, '#d8d2c4');
    }
    // 首のケーブル
    g.strokeStyle = '#3a3d42'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(hx2 - 3, hy + 12); g.bezierCurveTo(hx2 - 6, -62, lean - 4, -60, lean - 2, -58); g.stroke();
  }
  function glowEndo(g, o, lit) {
    if (Math.abs(o.s) > 0.92) return;
    const a = clamp(1.15 - lit, 0.15, 1);
    const hx2 = o.s * 7.8, hy = -70;
    g.fillStyle = `rgba(200,232,255,${a})`;
    g.beginPath(); g.arc(hx2 - 4.6 + o.s * 2, hy - 2, 1.7, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx2 + 4.6 + o.s * 2, hy - 2, 1.7, 0, TAU); g.fill();
  }

  // ------------------------------------------------------------
  //  海賊ギツネ ラスティ ― 破れた外皮から骨組みが覗く
  // ------------------------------------------------------------
  function artFox(g, o) {
    const t = o.t, s = o.s, sw = Math.sin(t * 8) * (o.moving ? 1 : 0.12);
    const lean = s * 7;
    const F = '#b4522c', D = '#8a3a1c', C = '#e0c9a8';
    sLimb(g, -7, -32, -9 + sw * 7, -2, 6, D);
    sLimb(g, 7, -32, 9 - sw * 7, -2, 6, D);
    sEllipse(g, -9 + sw * 7, -2, 7, 3, '#4a2416');
    sEllipse(g, 9 - sw * 7, -2, 7, 3, '#4a2416');
    // 胴
    sEllipse(g, lean * 0.5, -46, 14, 18, F);
    sEllipse(g, lean * 0.5, -40, 9, 11, C);        // 胸元
    // 破れて骨組みが覗く
    g.fillStyle = '#20120c';
    g.beginPath(); g.moveTo(lean - 6, -52); g.lineTo(lean + 3, -56); g.lineTo(lean + 6, -44); g.lineTo(lean - 3, -41); g.closePath(); g.fill();
    g.strokeStyle = '#9aa0a6'; g.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(lean - 5, -51 + i * 3.5); g.lineTo(lean + 5, -49 + i * 3.5); g.stroke(); }
    // 腕(片方はフック)
    const armSw = o.attack ? -1.4 : sw * 0.8;
    sLimb(g, -13 + lean, -56, -21 + lean, -40 + armSw * 8, 5, F);
    sLimb(g, 13 + lean, -56, 21 + lean, -40 - armSw * 8, 5, F);
    g.strokeStyle = '#c8ccd0'; g.lineWidth = 2.4;
    g.beginPath(); g.arc(22 + lean, -34 - armSw * 8, 5, -1.2, 2.4); g.stroke();
    // 頭(細長いマズル)
    const hx = lean * 1.25, hy = -70;
    sEllipse(g, hx, hy, 12, 11, F);
    // 耳
    g.fillStyle = D;
    g.beginPath(); g.moveTo(hx - 11, hy - 6); g.lineTo(hx - 14, hy - 20); g.lineTo(hx - 4, hy - 10); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(hx + 11, hy - 6); g.lineTo(hx + 14, hy - 20); g.lineTo(hx + 4, hy - 10); g.closePath(); g.fill();
    if (Math.abs(s) < 0.92) {
      sEllipse(g, hx + s * 3, hy + 6, 8, 6, C);      // マズル
      sEllipse(g, hx + s * 3, hy + 3, 2.6, 2, '#2a1810');
      sTeeth(g, hx + s * 3, hy + 8, 12, 5, 5, '#efe6d2');
      sEye(g, hx - 4.6 + s * 3, hy - 2, 2.8, '#160a06');
      sEye(g, hx + 4.6 + s * 3, hy - 2, 2.8, '#160a06');
      // 眼帯
      g.strokeStyle = '#1a1a1c'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(hx - 12, hy - 7); g.lineTo(hx + 12, hy - 3); g.stroke();
      g.fillStyle = '#111214';
      g.beginPath(); g.ellipse(hx - 4.6 + s * 3, hy - 2, 4.4, 4, 0, 0, TAU); g.fill();
    }
  }
  function glowFox(g, o, lit) {
    if (Math.abs(o.s) > 0.92) return;
    const a = clamp(1.2 - lit, 0.2, 1);
    const hx = o.s * 8.75;
    g.fillStyle = `rgba(255,190,120,${a})`;
    g.beginPath(); g.arc(hx + 4.6 + o.s * 3, -72, 2, 0, TAU); g.fill();
  }

  // ------------------------------------------------------------
  //  司会グマ ブルーノ ― 大柄でシルクハット
  // ------------------------------------------------------------
  function artBear(g, o) {
    const t = o.t, s = o.s, sw = Math.sin(t * 5) * (o.moving ? 1 : 0.1);
    const lean = s * 7;
    const F = '#6b4a2c', D = '#4f3620', M = '#c2a077';
    sLimb(g, -10, -30, -12 + sw * 6, -2, 9, D);
    sLimb(g, 10, -30, 12 - sw * 6, -2, 9, D);
    sEllipse(g, -12 + sw * 6, -2, 8, 3.4, '#33210f');
    sEllipse(g, 12 - sw * 6, -2, 8, 3.4, '#33210f');
    sEllipse(g, lean * 0.5, -44, 19, 21, F);
    sEllipse(g, lean * 0.5, -38, 12, 13, M);
    // 蝶ネクタイ
    g.fillStyle = '#a02a2a';
    g.beginPath(); g.moveTo(lean - 8, -58); g.lineTo(lean, -54); g.lineTo(lean - 8, -50); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(lean + 8, -58); g.lineTo(lean, -54); g.lineTo(lean + 8, -50); g.closePath(); g.fill();
    const armSw = o.attack ? -1.5 : sw * 0.8;
    sLimb(g, -17 + lean, -56, -26 + lean, -38 + armSw * 9, 7, F);
    sLimb(g, 17 + lean, -56, 26 + lean, -38 - armSw * 9, 7, F);
    sEllipse(g, -27 + lean, -35 + armSw * 9, 5, 5, D);
    sEllipse(g, 27 + lean, -35 - armSw * 9, 5, 5, D);
    // 頭
    const hx = lean * 1.2, hy = -74;
    sEllipse(g, hx - 13, hy - 8, 6, 6, F);       // 耳
    sEllipse(g, hx + 13, hy - 8, 6, 6, F);
    sEllipse(g, hx - 13, hy - 8, 3, 3, D);
    sEllipse(g, hx + 13, hy - 8, 3, 3, D);
    sEllipse(g, hx, hy, 15, 14, F);
    if (Math.abs(s) < 0.92) {
      sEllipse(g, hx + s * 3, hy + 6, 10, 7, M);
      sEllipse(g, hx + s * 3, hy + 2, 3.4, 2.6, '#241608');
      sTeeth(g, hx + s * 3, hy + 8, 15, 5, 6, '#e8dfcb');
      sEye(g, hx - 5.6 + s * 3, hy - 3, 3.2, '#120a04');
      sEye(g, hx + 5.6 + s * 3, hy - 3, 3.2, '#120a04');
    }
    // シルクハット
    g.fillStyle = '#16161a';
    g.fillRect(hx - 13, hy - 17, 26, 3);
    g.fillRect(hx - 9, hy - 30, 18, 14);
    g.fillStyle = '#7a1f28'; g.fillRect(hx - 9, hy - 20, 18, 3);
  }
  function glowBear(g, o, lit) {
    if (Math.abs(o.s) > 0.92) return;
    const a = clamp(1.25 - lit, 0.2, 1);
    const hx = o.s * 8.4;
    g.fillStyle = `rgba(255,225,150,${a})`;
    g.beginPath(); g.arc(hx - 5.6 + o.s * 3, -77, 2.2, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx + 5.6 + o.s * 3, -77, 2.2, 0, TAU); g.fill();
  }

  // ------------------------------------------------------------
  //  オルゴールの人形 ― 細く白い顔、頬に紫の筋
  // ------------------------------------------------------------
  function artPuppet(g, o) {
    const t = o.t, s = o.s;
    const float = Math.sin(t * 2.2) * 3;
    const lean = s * 5;
    const B = '#16161c', W = '#ece7e2';
    g.save();
    g.translate(0, float);
    // 糸のように細い脚
    sLimb(g, -4, -40, -7, -1, 3.4, B);
    sLimb(g, 4, -40, 7, -1, 3.4, B);
    sEllipse(g, -7, -1, 4, 2, '#0c0c10');
    sEllipse(g, 7, -1, 4, 2, '#0c0c10');
    // 胴
    sEllipse(g, lean * 0.4, -52, 9, 16, B);
    // 白い縦の3つのボタン
    for (let i = 0; i < 3; i++) sEllipse(g, lean * 0.4, -60 + i * 7, 1.8, 1.8, W);
    // 長い腕
    const rise = o.attack ? -18 : Math.sin(t * 1.7) * 5;
    sLimb(g, -8 + lean, -62, -20 + lean, -46 + rise, 3, B);
    sLimb(g, -20 + lean, -46 + rise, -25 + lean, -26 + rise, 2.6, B);
    sLimb(g, 8 + lean, -62, 20 + lean, -46 + rise, 3, B);
    sLimb(g, 20 + lean, -46 + rise, 25 + lean, -26 + rise, 2.6, B);
    for (const hx2 of [-25, 25]) {
      for (let i = -1; i <= 1; i++) sLimb(g, hx2 + lean, -26 + rise, hx2 + lean + i * 3.4, -18 + rise, 1.4, W);
    }
    // 頭
    const hx = lean * 1.2, hy = -76;
    sEllipse(g, hx, hy, 11, 13, W);
    if (Math.abs(s) < 0.92) {
      // 黒い眼窩と紫の涙
      sEye(g, hx - 4.4 + s * 2, hy - 2, 3.4, '#0a0a10');
      sEye(g, hx + 4.4 + s * 2, hy - 2, 3.4, '#0a0a10');
      g.strokeStyle = '#7a4fb0'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(hx - 4.4 + s * 2, hy + 2); g.lineTo(hx - 5 + s * 2, hy + 10); g.stroke();
      g.beginPath(); g.moveTo(hx + 4.4 + s * 2, hy + 2); g.lineTo(hx + 5 + s * 2, hy + 10); g.stroke();
      // 赤い頬と笑み
      sEllipse(g, hx - 7 + s * 2, hy + 4, 2.4, 2, '#b0424a');
      sEllipse(g, hx + 7 + s * 2, hy + 4, 2.4, 2, '#b0424a');
      g.strokeStyle = '#8a2a34'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(hx + s * 2, hy + 4, 5, 0.25, Math.PI - 0.25); g.stroke();
    }
    // 糸
    g.strokeStyle = 'rgba(220,220,230,0.28)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(hx - 6, hy - 12); g.lineTo(hx - 9, -100); g.moveTo(hx + 6, hy - 12); g.lineTo(hx + 9, -100); g.stroke();
    g.restore();
  }
  function glowPuppet(g, o, lit) {
    if (Math.abs(o.s) > 0.92) return;
    const a = clamp(1.1 - lit, 0.12, 0.9);
    g.fillStyle = `rgba(180,140,255,${a})`;
    g.beginPath(); g.arc(o.s * 6 - 4.4, -78, 1.8, 0, TAU); g.fill();
    g.beginPath(); g.arc(o.s * 6 + 4.4, -78, 1.8, 0, TAU); g.fill();
  }

  // ------------------------------------------------------------
  //  厨房ヒヨコ コッコ ― 皿を投げてくる
  // ------------------------------------------------------------
  function artChick(g, o) {
    const t = o.t, s = o.s, sw = Math.sin(t * 6) * (o.moving ? 1 : 0.1);
    const lean = s * 6;
    const F = '#d8bc3e', D = '#b0952c', BK = '#e07a2a';
    sLimb(g, -6, -26, -8 + sw * 5, -2, 4, BK);
    sLimb(g, 6, -26, 8 - sw * 5, -2, 4, BK);
    for (const fx2 of [-8 + sw * 5, 8 - sw * 5]) {
      g.strokeStyle = BK; g.lineWidth = 2;
      g.beginPath(); g.moveTo(fx2, -2); g.lineTo(fx2 - 5, 0); g.moveTo(fx2, -2); g.lineTo(fx2 + 5, 0); g.stroke();
    }
    sEllipse(g, lean * 0.5, -44, 17, 20, F);
    // よだれかけ
    g.fillStyle = '#e8e2d0';
    g.beginPath(); g.moveTo(lean - 11, -56); g.lineTo(lean + 11, -56); g.lineTo(lean, -36); g.closePath(); g.fill();
    g.fillStyle = '#c8442c'; g.font = 'bold 7px sans-serif'; g.textAlign = 'center';
    g.fillText('EAT', lean, -47);
    const armSw = o.attack ? -1.6 : sw * 0.6;
    sLimb(g, -15 + lean, -54, -24 + lean, -40 + armSw * 8, 5, D);
    sLimb(g, 15 + lean, -54, 24 + lean, -40 - armSw * 8, 5, D);
    // カップケーキを持っている
    sEllipse(g, 25 + lean, -38 - armSw * 8, 4.4, 3.4, '#c8a070');
    sEllipse(g, 25 + lean, -42 - armSw * 8, 4, 3.4, '#e8b8c8');
    const hx = lean * 1.2, hy = -70;
    sEllipse(g, hx, hy, 13, 12, F);
    // とさか
    g.fillStyle = '#c8452c';
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(hx + i * 5, hy - 12, 4, Math.PI, 0); g.fill(); }
    if (Math.abs(s) < 0.92) {
      g.fillStyle = BK;
      g.beginPath(); g.moveTo(hx - 6 + s * 3, hy + 3); g.lineTo(hx + 6 + s * 3, hy + 3); g.lineTo(hx + s * 3, hy + 11); g.closePath(); g.fill();
      sEye(g, hx - 5 + s * 3, hy - 3, 3, '#1a1206');
      sEye(g, hx + 5 + s * 3, hy - 3, 3, '#1a1206');
    }
  }
  function glowChick(g, o, lit) {
    if (Math.abs(o.s) > 0.92) return;
    const a = clamp(1.15 - lit, 0.15, 0.95);
    g.fillStyle = `rgba(255,200,90,${a})`;
    g.beginPath(); g.arc(o.s * 7.2 - 5, -73, 1.9, 0, TAU); g.fill();
    g.beginPath(); g.arc(o.s * 7.2 + 5, -73, 1.9, 0, TAU); g.fill();
  }

  const ENEMY_ART = { endo: artEndo, fox: artFox, bear: artBear, puppet: artPuppet, chick: artChick };
  const ENEMY_GLOW = { endo: glowEndo, fox: glowFox, bear: glowBear, puppet: glowPuppet, chick: glowChick };
  // 枠の高さ。中の絵が枠の8〜9割を使う前提で、実際の背丈より少し大きく取る。
  const ENEMY_H = { endo: 58, fox: 50, bear: 62, puppet: 54, chick: 50 };

  // ------------------------------------------------------------
  //  夜警のベア ― 倒せない追手。制帽と胸の記章。
  // ------------------------------------------------------------
  function artNightBear(g, o) {
    const t = o.t, s = o.s, sw = Math.sin(t * 3.4);
    const lean = s * 8;
    const FUR = '#c09a3c', D = '#8e6f22', M = '#e8d69a';
    sLimb(g, -12, -30, -15 + sw * 7, -2, 11, D);
    sLimb(g, 12, -30, 15 - sw * 7, -2, 11, D);
    sEllipse(g, -15 + sw * 7, -2, 9, 4, '#4a3a10');
    sEllipse(g, 15 - sw * 7, -2, 9, 4, '#4a3a10');
    sEllipse(g, lean * 0.5, -46, 22, 24, FUR);
    sEllipse(g, lean * 0.5, -40, 14, 15, M);
    // 制服のベスト
    g.fillStyle = '#2c3348';
    g.beginPath(); g.moveTo(lean - 20, -66); g.lineTo(lean - 9, -62); g.lineTo(lean - 11, -36); g.lineTo(lean - 21, -40); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(lean + 20, -66); g.lineTo(lean + 9, -62); g.lineTo(lean + 11, -36); g.lineTo(lean + 21, -40); g.closePath(); g.fill();
    // 記章
    g.fillStyle = '#d8c24a';
    g.beginPath(); g.arc(lean - 15, -58, 3.4, 0, TAU); g.fill();
    const armSw = o.attack ? -1.6 : sw * 0.9;
    sLimb(g, -20 + lean, -60, -30 + lean, -40 + armSw * 10, 8, FUR);
    sLimb(g, 20 + lean, -60, 30 + lean, -40 - armSw * 10, 8, FUR);
    sEllipse(g, -31 + lean, -36 + armSw * 10, 6, 6, D);
    sEllipse(g, 31 + lean, -36 - armSw * 10, 6, 6, D);
    const hx = lean * 1.2, hy = -80;
    sEllipse(g, hx - 15, hy - 8, 7, 7, FUR);
    sEllipse(g, hx + 15, hy - 8, 7, 7, FUR);
    sEllipse(g, hx, hy, 17, 16, FUR);
    if (Math.abs(s) < 0.92) {
      sEllipse(g, hx + s * 3, hy + 7, 11, 8, M);
      sEllipse(g, hx + s * 3, hy + 3, 3.6, 2.8, '#2a1e06');
      sTeeth(g, hx + s * 3, hy + 9, 17, 6, 7, '#efe6cc');
      // 落ちくぼんだ目
      sEye(g, hx - 6 + s * 3, hy - 4, 4.4, '#0a0804');
      sEye(g, hx + 6 + s * 3, hy - 4, 4.4, '#0a0804');
    }
    // 制帽
    g.fillStyle = '#1e2434';
    g.beginPath(); g.ellipse(hx, hy - 15, 15, 6, 0, Math.PI, 0); g.fill();
    g.fillRect(hx - 15, hy - 15, 30, 3);
    g.fillStyle = '#0e1220'; g.fillRect(hx - 16, hy - 13, 32, 3);
  }
  function glowNightBear(g, o, lit) {
    if (Math.abs(o.s) > 0.92) return;
    const a = clamp(1.35 - lit, 0.3, 1);
    const hx = o.s * 9.6;
    g.fillStyle = `rgba(255,240,190,${a})`;
    g.beginPath(); g.arc(hx - 6 + o.s * 3, -84, 2.6, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx + 6 + o.s * 3, -84, 2.6, 0, TAU); g.fill();
  }

  // ------------------------------------------------------------
  //  プライズ係 マリオネット ― 動かず、仕事を言いつける
  // ------------------------------------------------------------
  function artMarionette(g, o) {
    const t = o.t, s = o.s;
    const float = Math.sin(t * 1.4) * 4;
    const B = '#101018', W = '#f0ece6';
    g.save();
    g.translate(0, float);
    // 裾が床に届かない(浮いている)
    g.fillStyle = B;
    g.beginPath();
    g.moveTo(-13, -46); g.lineTo(13, -46);
    g.quadraticCurveTo(18, -14, 0, -6);
    g.quadraticCurveTo(-18, -14, -13, -46);
    g.closePath(); g.fill();
    sEllipse(g, 0, -56, 12, 18, B);
    for (let i = 0; i < 3; i++) sEllipse(g, 0, -66 + i * 8, 2.4, 2.4, W);
    const rise = Math.sin(t * 1.1) * 6;
    sLimb(g, -10, -70, -26, -54 + rise, 3.6, B);
    sLimb(g, -26, -54 + rise, -33, -30 + rise, 3, B);
    sLimb(g, 10, -70, 26, -54 - rise, 3.6, B);
    sLimb(g, 26, -54 - rise, 33, -30 - rise, 3, B);
    for (const [hx2, r2] of [[-33, rise], [33, -rise]]) {
      for (let i = -1; i <= 1; i++) sLimb(g, hx2, -30 + r2, hx2 + i * 4, -20 + r2, 1.6, W);
    }
    const hx = s * 4, hy = -86;
    sEllipse(g, hx, hy, 13, 15, W);
    if (Math.abs(s) < 0.92) {
      sEye(g, hx - 5 + s * 2, hy - 2, 4, '#08080e');
      sEye(g, hx + 5 + s * 2, hy - 2, 4, '#08080e');
      g.strokeStyle = '#6a44a0'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(hx - 5 + s * 2, hy + 3); g.lineTo(hx - 6 + s * 2, hy + 12); g.stroke();
      g.beginPath(); g.moveTo(hx + 5 + s * 2, hy + 3); g.lineTo(hx + 6 + s * 2, hy + 12); g.stroke();
      sEllipse(g, hx - 8 + s * 2, hy + 5, 2.8, 2.2, '#c04a52');
      sEllipse(g, hx + 8 + s * 2, hy + 5, 2.8, 2.2, '#c04a52');
      g.strokeStyle = '#7a2028'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(hx + s * 2, hy + 4, 6, 0.2, Math.PI - 0.2); g.stroke();
    }
    g.strokeStyle = 'rgba(200,210,230,0.22)'; g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(hx - 7, hy - 14); g.lineTo(hx - 12, -100);
    g.moveTo(hx + 7, hy - 14); g.lineTo(hx + 12, -100);
    g.moveTo(-26, -54 + rise); g.lineTo(-30, -100);
    g.moveTo(26, -54 - rise); g.lineTo(30, -100);
    g.stroke();
    g.restore();
  }
  function glowMarionette(g, o, lit) {
    const a = clamp(1.2 - lit, 0.2, 1);
    g.fillStyle = `rgba(140,230,190,${a})`;
    g.beginPath(); g.arc(-5, -88, 2.2, 0, TAU); g.fill();
    g.beginPath(); g.arc(5, -88, 2.2, 0, TAU); g.fill();
  }

  // ------------------------------------------------------------
  //  マングルド ― 解体されたまま繋ぎ直された個体
  // ------------------------------------------------------------
  function artMangled(g, o) {
    const t = o.t, s = o.s;
    const F = '#d8c0cc', D = '#a08894', M = '#8e949c';
    // 蜘蛛のように四方へ伸びた脚
    for (let i = 0; i < 5; i++) {
      const a = -0.4 + i * 0.5 + Math.sin(t * 3 + i) * 0.18;
      const lx = Math.cos(a + Math.PI) * 34, ly = -Math.abs(Math.sin(a)) * 24;
      sLimb(g, 0, -50, lx * 0.6, -46 + ly * 0.5, 4, M);
      sLimb(g, lx * 0.6, -46 + ly * 0.5, lx, -6 + Math.sin(t * 4 + i) * 3, 3.2, M);
    }
    // 中心の胴(ばらばらの外皮)
    sEllipse(g, 0, -52, 17, 14, F);
    g.fillStyle = D;
    g.beginPath(); g.moveTo(-16, -56); g.lineTo(-4, -62); g.lineTo(2, -48); g.lineTo(-12, -44); g.closePath(); g.fill();
    // 露出した配線
    g.strokeStyle = '#c04a4a'; g.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(-8 + i * 5, -50);
      g.bezierCurveTo(-6 + i * 5, -40, 4 + i * 3, -38, 2 + i * 4, -30);
      g.stroke();
    }
    // 頭がふたつ。ひとつは逆さ。
    const hx = s * 8;
    sEllipse(g, hx - 14, -70, 11, 10, F);
    sEllipse(g, hx + 15, -62, 9, 9, D);
    if (Math.abs(s) < 0.95) {
      sEllipse(g, hx - 14, -66, 7, 5, '#e8d8de');
      sTeeth(g, hx - 14, -63, 11, 5, 5, '#efe6d2');
      sEye(g, hx - 17.5, -72, 2.8, '#100a0c');
      sEye(g, hx - 10.5, -72, 2.8, '#100a0c');
      // 逆さの頭
      sEye(g, hx + 12, -59, 2.4, '#100a0c');
      sEye(g, hx + 18, -59, 2.4, '#100a0c');
      sTeeth(g, hx + 15, -66, 9, -4, 4, '#e0d6c4');
    }
    // 天井から垂れたケーブル
    g.strokeStyle = 'rgba(180,160,170,0.35)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-3, -62); g.lineTo(-8, -100); g.moveTo(6, -60); g.lineTo(12, -100); g.stroke();
  }
  function glowMangled(g, o, lit) {
    const a = clamp(1.3 - lit, 0.25, 1);
    const hx = o.s * 8;
    g.fillStyle = `rgba(255,120,110,${a})`;
    g.beginPath(); g.arc(hx - 17.5, -72, 2, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx - 10.5, -72, 2, 0, TAU); g.fill();
    g.fillStyle = `rgba(255,190,120,${a * 0.8})`;
    g.beginPath(); g.arc(hx + 12, -59, 1.7, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx + 18, -59, 1.7, 0, TAU); g.fill();
  }

  const STALKER_ART = { nightbear: artNightBear, marionette: artMarionette, mangled: artMangled };
  const STALKER_GLOW = { nightbear: glowNightBear, marionette: glowMarionette, mangled: glowMangled };
  const STALKER_H = { nightbear: 66, marionette: 66, mangled: 60 };

  // ------------------------------------------------------------
  //  マザー ― 最終ボス。炉を内蔵した4.2mの母体。
  // ------------------------------------------------------------
  function artMother(g, o) {
    const t = o.t, open = o.open, ph = o.phase || 1;
    const F = '#5a4a52', D = '#3e3238', M = '#8e7c86';
    // 下半身(多脚)
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const a = i * 0.42 + Math.sin(t * 2 + i) * 0.12;
      sLimb(g, i * 4, -34, Math.sin(a) * 30, -18, 5, D);
      sLimb(g, Math.sin(a) * 30, -18, Math.sin(a) * 38, -1, 4, D);
    }
    // 胴
    sEllipse(g, 0, -46, 24, 22, F);
    sEllipse(g, 0, -66, 19, 16, F);
    // 開いた装甲と炉心
    if (open > 0) {
      g.save();
      g.translate(0, -50);
      const k = clamp(open, 0, 1);
      g.fillStyle = D;
      g.beginPath(); g.moveTo(-16, -12); g.lineTo(-4 - k * 10, -8); g.lineTo(-4 - k * 10, 10); g.lineTo(-16, 14); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(16, -12); g.lineTo(4 + k * 10, -8); g.lineTo(4 + k * 10, 10); g.lineTo(16, 14); g.closePath(); g.fill();
      const gr = g.createRadialGradient(0, 0, 1, 0, 0, 14);
      gr.addColorStop(0, '#fff0c0');
      gr.addColorStop(0.4, '#ff8a3a');
      gr.addColorStop(1, 'rgba(180,40,20,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, 14, 0, TAU); g.fill();
      g.restore();
    } else {
      g.fillStyle = D;
      g.fillRect(-16, -62, 32, 26);
      g.strokeStyle = '#2a2226'; g.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-16, -60 + i * 7); g.lineTo(16, -60 + i * 7); g.stroke(); }
      // 覗き窓の奥で炉が燻る
      g.fillStyle = `rgba(220,90,30,${0.3 + Math.sin(t * 3) * 0.12})`;
      g.fillRect(-9, -54, 18, 8);
    }
    // 腕
    const rise = Math.sin(t * 1.6) * 8 + (o.sweep ? -20 : 0);
    sLimb(g, -22, -70, -40, -54 + rise, 8, F);
    sLimb(g, -40, -54 + rise, -46, -30 + rise, 6, F);
    sLimb(g, 22, -70, 40, -54 - rise, 8, F);
    sLimb(g, 40, -54 - rise, 46, -30 - rise, 6, F);
    for (const [hx2, r2] of [[-46, rise], [46, -rise]]) {
      for (let i = -1; i <= 1; i++) sLimb(g, hx2, -30 + r2, hx2 + i * 5, -18 + r2, 2.4, M);
    }
    // 頭
    const hy = -84;
    sEllipse(g, 0, hy, 16, 15, F);
    sEllipse(g, 0, hy + 6, 11, 8, M);
    sTeeth(g, 0, hy + 9, 20, 7, 8, '#e8dfcb');
    sEye(g, -6, hy - 3, 4.4, '#0a0608');
    sEye(g, 6, hy - 3, 4.4, '#0a0608');
    // 抱えている小さな手のあと
    if (ph >= 2) {
      g.fillStyle = 'rgba(120,40,40,0.5)';
      for (let i = 0; i < 5; i++) {
        const a = -1.2 + i * 0.5;
        g.beginPath(); g.ellipse(Math.cos(a) * 16, -46 + Math.sin(a) * 12, 3, 4, a, 0, TAU); g.fill();
      }
    }
  }
  function glowMother(g, o, lit) {
    const a = clamp(1.4 - lit, 0.35, 1);
    g.fillStyle = `rgba(255,120,60,${a})`;
    g.beginPath(); g.arc(-6, -87, 3, 0, TAU); g.fill();
    g.beginPath(); g.arc(6, -87, 3, 0, TAU); g.fill();
    if (o.open > 0) {
      const gr = g.createRadialGradient(0, -50, 1, 0, -50, 22);
      gr.addColorStop(0, 'rgba(255,220,150,0.9)');
      gr.addColorStop(1, 'rgba(255,90,30,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, -50, 22, 0, TAU); g.fill();
    }
  }
  // ============================================================
  //  一人称レンダラ ― 小物と拾いものの絵
  // ============================================================
  /** 立て看板。等身大のマスコットが切り抜かれている。 */
  function artStandee(g, o) {
    const who = o.who || 'bear';
    const col = { bear: '#7a5a34', bunny: '#6a4f9c', chick: '#d9b736', fox: '#b4522c' }[who] || '#7a5a34';
    // 台紙
    g.fillStyle = '#d8cdb8';
    g.beginPath();
    g.moveTo(-26, 0); g.lineTo(-22, -84); g.lineTo(22, -84); g.lineTo(26, 0);
    g.closePath(); g.fill();
    g.fillStyle = col;
    sEllipse(g, 0, -42, 15, 20, col);
    sEllipse(g, 0, -68, 12, 12, col);
    if (who === 'bunny') { sEllipse(g, -5, -84, 3.4, 10, col); sEllipse(g, 5, -84, 3.4, 10, col); }
    else if (who === 'fox') { g.beginPath(); g.moveTo(-11, -74); g.lineTo(-13, -86); g.lineTo(-4, -78); g.closePath(); g.fill(); g.beginPath(); g.moveTo(11, -74); g.lineTo(13, -86); g.lineTo(4, -78); g.closePath(); g.fill(); }
    else { sEllipse(g, -10, -77, 5, 5, col); sEllipse(g, 10, -77, 5, 5, col); }
    sEllipse(g, 0, -64, 7, 5, '#e8d8b8');
    sEye(g, -4, -70, 2, '#1a1206');
    sEye(g, 4, -70, 2, '#1a1206');
    sLimb(g, -13, -50, -22, -34, 5, col);
    sLimb(g, 13, -50, 22, -34, 5, col);
    g.fillStyle = '#b0a68e';
    g.font = 'bold 8px sans-serif'; g.textAlign = 'center';
    g.fillText('WELCOME', 0, -12);
    // 立て掛けの脚
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-8, -2); g.lineTo(8, -2); g.stroke();
  }

  /** 中身の抜けた着ぐるみ。潜り込める。 */
  function artPlush(g, o) {
    const st = SUIT_STYLE[o.kind] || SUIT_STYLE.bear;
    g.fillStyle = st.fur;
    sEllipse(g, 0, -34, 22, 26, st.fur);
    sEllipse(g, 0, -66, 17, 16, st.fur);
    if (st.ear === 'long') { sEllipse(g, -7, -84, 5, 13, st.fur); sEllipse(g, 7, -84, 5, 13, st.fur); }
    else if (st.ear === 'tuft') { for (let i = -1; i <= 1; i++) sEllipse(g, i * 6, -80, 4, 5, st.dark); }
    else { sEllipse(g, -13, -76, 7, 7, st.fur); sEllipse(g, 13, -76, 7, 7, st.fur); }
    sEllipse(g, 0, -60, 11, 8, st.muzzle);
    // 目のない眼窩
    g.fillStyle = '#08080a';
    g.beginPath(); g.arc(-6, -68, 4, 0, TAU); g.fill();
    g.beginPath(); g.arc(6, -68, 4, 0, TAU); g.fill();
    if (st.tie) { g.fillStyle = st.tie; g.beginPath(); g.moveTo(-7, -50); g.lineTo(0, -46); g.lineTo(-7, -42); g.closePath(); g.fill(); g.beginPath(); g.moveTo(7, -50); g.lineTo(0, -46); g.lineTo(7, -42); g.closePath(); g.fill(); }
    sLimb(g, -18, -44, -26, -20, 8, st.dark);
    sLimb(g, 18, -44, 26, -20, 8, st.dark);
    // へたり込んだ姿勢
    sEllipse(g, -12, -6, 10, 5, st.dark);
    sEllipse(g, 12, -6, 10, 5, st.dark);
    if (o.used) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-24, -80, 48, 78); }
  }
  function glowPlush(g, o, lit) {
    if (o.used) return;
    const a = clamp(0.9 - lit, 0.05, 0.4);
    g.fillStyle = `rgba(255,220,160,${a})`;
    g.beginPath(); g.arc(-6, -68, 1.4, 0, TAU); g.fill();
    g.beginPath(); g.arc(6, -68, 1.4, 0, TAU); g.fill();
  }

  /** 誕生日のケーキ。ろうそくは十年ぶん短くなっていない。 */
  function artCake(g, o) {
    g.fillStyle = '#c8b48e';
    g.beginPath(); g.ellipse(0, -6, 30, 8, 0, 0, TAU); g.fill();
    g.fillStyle = '#e8dcc0'; g.fillRect(-24, -34, 48, 28);
    g.beginPath(); g.ellipse(0, -34, 24, 7, 0, 0, TAU); g.fill();
    g.fillStyle = '#d86a8a';
    g.beginPath(); g.ellipse(0, -35, 24, 7, 0, 0, TAU); g.fill();
    for (let i = 0; i < (o.candles || 5); i++) {
      const x = -16 + i * (32 / Math.max(1, (o.candles || 5) - 1));
      g.fillStyle = ['#d84a5a', '#4a86d8', '#e0c24a'][i % 3];
      g.fillRect(x - 1.4, -50, 2.8, 15);
    }
  }
  function glowCake(g, o, lit) {
    for (let i = 0; i < (o.candles || 5); i++) {
      const x = -16 + i * (32 / Math.max(1, (o.candles || 5) - 1));
      const f = 1 + Math.sin(gameT * 9 + i * 1.7) * 0.25;
      const gr = g.createRadialGradient(x, -53, 0, x, -53, 7 * f);
      gr.addColorStop(0, 'rgba(255,236,190,0.95)');
      gr.addColorStop(1, 'rgba(255,150,40,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, -53, 7 * f, 0, TAU); g.fill();
    }
  }

  /** 積み上げられた予備の頭。どれもこちらを向いている。 */
  function artHeadPile(g, o) {
    const cols = ['#7a5a34', '#6a4f9c', '#d9b736', '#b4522c'];
    for (let i = 0; i < 6; i++) {
      const x = ((i * 37) % 5 - 2) * 9, y = -6 - ((i / 2) | 0) * 15;
      const c = cols[i % cols.length];
      sEllipse(g, x, y - 8, 10, 9, c);
      sEllipse(g, x, y - 5, 6, 4, '#d8c8a8');
      g.fillStyle = '#08080a';
      g.beginPath(); g.arc(x - 3.4, y - 10, 2.4, 0, TAU); g.fill();
      g.beginPath(); g.arc(x + 3.4, y - 10, 2.4, 0, TAU); g.fill();
    }
  }
  function glowHeadPile(g, o, lit) {
    const a = clamp(0.85 - lit, 0.04, 0.35);
    g.fillStyle = `rgba(255,210,150,${a})`;
    for (let i = 0; i < 6; i++) {
      const x = ((i * 37) % 5 - 2) * 9, y = -6 - ((i / 2) | 0) * 15;
      g.beginPath(); g.arc(x - 3.4, y - 10, 1, 0, TAU); g.fill();
      g.beginPath(); g.arc(x + 3.4, y - 10, 1, 0, TAU); g.fill();
    }
  }

  /** 外された腕や脚。 */
  function artEndoParts(g) {
    const M = '#8e949c', D = '#5d6268';
    sLimb(g, -26, -6, 2, -14, 5, M);
    sLimb(g, 2, -14, 20, -6, 4, D);
    sLimb(g, -14, -3, 12, -3, 4, D);
    sEllipse(g, -26, -6, 5, 4, D);
    sEllipse(g, 22, -18, 8, 7, M);
    g.fillStyle = '#08080a';
    g.beginPath(); g.arc(20, -20, 2, 0, TAU); g.fill();
    g.beginPath(); g.arc(25, -20, 2, 0, TAU); g.fill();
  }

  function artMicStand(g) {
    g.strokeStyle = '#2a2c30'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -2); g.lineTo(0, -76); g.stroke();
    g.fillStyle = '#3a3d42';
    g.beginPath(); g.ellipse(0, -2, 12, 4, 0, 0, TAU); g.fill();
    sEllipse(g, 0, -82, 6, 8, '#4a4e54');
    g.fillStyle = '#6a6e74';
    g.beginPath(); g.arc(0, -84, 5, Math.PI, 0); g.fill();
  }

  function artFan(g, o) {
    g.fillStyle = '#4a4e52';
    g.beginPath(); g.ellipse(0, -3, 14, 4, 0, 0, TAU); g.fill();
    g.strokeStyle = '#5a5e62'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -26); g.stroke();
    g.strokeStyle = '#7a8086'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(0, -34, 13, 0, TAU); g.stroke();
    const a = gameT * 9;
    g.save(); g.translate(0, -34);
    for (let i = 0; i < 3; i++) {
      g.rotate(TAU / 3);
      g.fillStyle = 'rgba(150,158,166,0.55)';
      g.beginPath(); g.ellipse(Math.cos(a) * 5, Math.sin(a) * 5, 10, 4, a, 0, TAU); g.fill();
    }
    g.restore();
  }

  /** 壁のポスター。行方不明の子か、店の掲示。 */
  function artPoster(g, o) {
    g.fillStyle = '#cfc6b0';
    g.fillRect(-22, -34, 44, 34);
    g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(-22, -34, 44, 3);
    if (o.kind === 'missing') {
      g.fillStyle = '#8a2a2a'; g.font = 'bold 8px sans-serif'; g.textAlign = 'center';
      g.fillText('MISSING', 0, -27);
      g.fillStyle = '#6a6258'; g.fillRect(-9, -24, 18, 16);
      g.fillStyle = '#3a352e';
      g.beginPath(); g.arc(0, -18, 5, 0, TAU); g.fill();
      g.fillStyle = '#4a453e'; g.fillRect(-13, -7, 26, 2); g.fillRect(-13, -4, 20, 2);
    } else if (o.kind === 'show') {
      g.fillStyle = '#a04a7a'; g.fillRect(-19, -31, 38, 18);
      g.fillStyle = '#e8d8a8'; g.font = 'bold 7px sans-serif'; g.textAlign = 'center';
      g.fillText('SHOW 7:00', 0, -20);
      g.fillStyle = '#4a453e'; g.fillRect(-15, -9, 30, 2);
    } else {
      g.fillStyle = '#3a352e'; g.font = 'bold 7px sans-serif'; g.textAlign = 'center';
      g.fillText('RULES', 0, -27);
      g.fillStyle = '#5a544a';
      for (let i = 0; i < 4; i++) g.fillRect(-16, -21 + i * 5, 30 - i * 3, 2);
    }
  }

  function artVent(g) {
    g.fillStyle = '#4a4e52'; g.fillRect(-20, -26, 40, 26);
    g.fillStyle = '#2a2e32';
    for (let i = 0; i < 6; i++) g.fillRect(-17, -23 + i * 4, 34, 2);
    g.fillStyle = '#6a6e72';
    for (const [x, y] of [[-17, -23], [17, -23], [-17, -3], [17, -3]]) { g.beginPath(); g.arc(x, y, 1.4, 0, TAU); g.fill(); }
  }

  function artSign(g, o) {
    g.fillStyle = '#1a1c20'; g.fillRect(-24, -18, 48, 18);
    g.fillStyle = '#c8442c'; g.font = 'bold 8px sans-serif'; g.textAlign = 'center';
    g.fillText(o.text || 'OUT OF ORDER', 0, -6);
  }

  function artBalloon(g, o) {
    const sway = Math.sin(gameT * 1.1 + (o.seedv || 0)) * 4;
    g.strokeStyle = 'rgba(220,220,220,0.4)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(sway * 0.5, -14, sway, -28); g.stroke();
    sEllipse(g, sway, -38, 11, 13, o.hue || '#d84a4a');
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.ellipse(sway - 4, -42, 3, 4, -0.5, 0, TAU); g.fill();
  }
  function artTeddy(g, o) {
    const c = o.hue || '#8a6a4a';
    sEllipse(g, 0, -10, 10, 9, c);
    sEllipse(g, 0, -24, 8, 8, c);
    sEllipse(g, -7, -30, 3.4, 3.4, c);
    sEllipse(g, 7, -30, 3.4, 3.4, c);
    sEllipse(g, 0, -22, 4, 3, '#d8c8a8');
    g.fillStyle = '#1a1206';
    g.beginPath(); g.arc(-3, -26, 1.2, 0, TAU); g.fill();
    g.beginPath(); g.arc(3, -26, 1.2, 0, TAU); g.fill();
    sLimb(g, -8, -12, -14, -4, 4, c);
    sLimb(g, 8, -12, 14, -4, 4, c);
  }
  function artPartyHat(g, o) {
    g.fillStyle = o.hue || '#d84a7a';
    g.beginPath(); g.moveTo(0, -32); g.lineTo(-9, -1); g.lineTo(9, -1); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < 3; i++) g.fillRect(-8 + i, -8 - i * 8, 16 - i * 2, 2);
    sEllipse(g, 0, -33, 3, 3, '#f0e0a0');
  }
  function artJuiceCup(g, o) {
    g.fillStyle = '#d8d4cc';
    g.beginPath(); g.moveTo(-7, -1); g.lineTo(-9, -18); g.lineTo(9, -18); g.lineTo(7, -1); g.closePath(); g.fill();
    g.fillStyle = o.hue || '#d8604a';
    g.beginPath(); g.moveTo(-8, -8); g.lineTo(-9, -17); g.lineTo(9, -17); g.lineTo(8, -8); g.closePath(); g.fill();
    g.strokeStyle = '#e05a7a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(3, -17); g.lineTo(6, -28); g.stroke();
  }
  function artLostShoe(g, o) {
    g.fillStyle = o.hue || '#c04a3a';
    g.beginPath();
    g.moveTo(-12, -1); g.lineTo(-11, -9); g.quadraticCurveTo(-2, -13, 6, -9); g.lineTo(12, -6); g.lineTo(12, -1);
    g.closePath(); g.fill();
    g.fillStyle = '#e8e4dc'; g.fillRect(-12, -3, 24, 2.4);
    g.strokeStyle = '#e8e4dc'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-6, -9); g.lineTo(0, -7); g.moveTo(-4, -11); g.lineTo(2, -9); g.stroke();
  }

  const PROP_ART = {
    standee: artStandee, plush: artPlush, cake: artCake, headpile: artHeadPile,
    endoparts: artEndoParts, micstand: artMicStand, fan: artFan, poster: artPoster,
    vent: artVent, sign: artSign, balloon: artBalloon, teddy: artTeddy,
    partyhat: artPartyHat, juicecup: artJuiceCup, lostshoe: artLostShoe,
  };
  const PROP_GLOW = { plush: glowPlush, cake: glowCake, headpile: glowHeadPile };

  // ------------------------------------------------------------
  //  落ちているもの
  // ------------------------------------------------------------
  function artBattery(g) {
    g.fillStyle = '#2a2f36'; g.fillRect(-9, -22, 18, 22);
    g.fillStyle = '#d8a83a'; g.fillRect(-9, -22, 18, 6);
    g.fillStyle = '#8e949c'; g.fillRect(-3, -26, 6, 4);
    g.fillStyle = '#e8e0c8'; g.font = 'bold 7px sans-serif'; g.textAlign = 'center';
    g.fillText('+', 0, -8);
  }
  function artBandage(g) {
    g.fillStyle = '#e8e2d4'; g.fillRect(-11, -16, 22, 16);
    g.fillStyle = '#c8443a'; g.fillRect(-3, -14, 6, 12); g.fillRect(-8, -10, 16, 4);
  }
  function artSedative(g) {
    g.fillStyle = '#cfd8e0'; g.fillRect(-7, -18, 14, 18);
    g.fillStyle = '#7aa8d8'; g.fillRect(-7, -12, 14, 8);
    g.fillStyle = '#e8eef4'; g.fillRect(-5, -22, 10, 4);
  }
  function artNoteItem(g) {
    g.save(); g.rotate(-0.12);
    g.fillStyle = '#ddd4bc'; g.fillRect(-12, -17, 24, 17);
    g.fillStyle = '#8a8272';
    for (let i = 0; i < 4; i++) g.fillRect(-9, -14 + i * 3.4, 18 - (i % 2) * 5, 1.2);
    g.restore();
  }
  function artGoalItem(g, o) {
    if (o.icon === '🗝️') {
      g.strokeStyle = '#d8b84a'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, -20, 5, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(0, -15); g.lineTo(0, -2); g.moveTo(0, -6); g.lineTo(5, -6); g.moveTo(0, -10); g.lineTo(4, -10); g.stroke();
    } else {
      g.fillStyle = '#3a2f22'; g.fillRect(-5, -22, 10, 22);
      g.fillStyle = '#c8b060'; g.fillRect(-6, -24, 12, 4); g.fillRect(-6, -4, 12, 4);
      g.fillStyle = '#e8d8a0'; g.fillRect(-1.4, -20, 2.8, 16);
    }
  }
  function artGrabPack(g) {
    g.fillStyle = '#2a3a44'; g.fillRect(-14, -20, 28, 20);
    g.fillStyle = '#3aa8c8'; g.fillRect(-11, -17, 10, 14);
    g.fillStyle = '#c85a3a'; g.fillRect(1, -17, 10, 14);
    g.strokeStyle = '#7ce0ff'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(0, -10, 15, -0.6, 0.6); g.stroke();
  }
  function artMask(g) {
    g.fillStyle = '#ece7e2';
    g.beginPath(); g.ellipse(0, -14, 11, 14, 0, 0, TAU); g.fill();
    g.fillStyle = '#0a0a10';
    g.beginPath(); g.arc(-4.4, -17, 3.4, 0, TAU); g.fill();
    g.beginPath(); g.arc(4.4, -17, 3.4, 0, TAU); g.fill();
    g.strokeStyle = '#7a4fb0'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-4.4, -13); g.lineTo(-5, -6); g.moveTo(4.4, -13); g.lineTo(5, -6); g.stroke();
  }
  const ITEM_ART = {
    battery: artBattery, bandage: artBandage, sedative: artSedative, note: artNoteItem,
    goal: artGoalItem, grabpack: artGrabPack, mask: artMask,
  };
  const ITEM_H = { battery: 7, bandage: 5, sedative: 6, note: 5, goal: 8, grabpack: 8, mask: 9 };
  const ITEM_COLOR = {
    battery: '#ffd766', bandage: '#7fe08a', sedative: '#9fd8ff', note: '#e0d6b8',
    goal: '#ffd766', grabpack: '#7ce0ff', mask: '#c9a7ff',
  };
  // ============================================================
  //  一人称レンダラ ― 場面の組み立て
  // ============================================================
  /** ワールド座標を低解像度バッファの座標へ落とす。後ろにあるときは null。 */
  function fpProject(wx, wy, wz) {
    const dirX = Math.cos(fpc.yaw), dirY = Math.sin(fpc.yaw);
    const planeX = -dirY * TAN_HALF, planeY = dirX * TAN_HALF;
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const rx = wx - fpc.x, ry = wy - fpc.y;
    const d = invDet * (-planeY * rx + planeX * ry);
    if (d < 1) return null;
    const tx = invDet * (dirY * rx - dirX * ry);
    return { x: (RW / 2) * (1 + tx / d), y: fpc.horizon + (fpc.eye - (wz || 0)) * PROJ / d, d };
  }

  /** そのキャラクターがこちらへ向けている面(0=正面 / ±1=真横)。 */
  function facingOf(e) {
    const toCam = Math.atan2(fpc.y - e.y, fpc.x - e.x);
    return Math.sin(normAng((e.angle === undefined ? 0 : e.angle) - toCam));
  }

  function enemyTint(e) {
    if (e.hitFlash > 0) return `rgba(255,240,230,${clamp(e.hitFlash * 2.4, 0, 0.7)})`;
    if (e.charmed) return 'rgba(140,255,190,0.30)';
    if (e.fleeT > 0) return 'rgba(120,170,255,0.22)';
    if (e.dazzle > 0) return 'rgba(255,250,220,0.30)';
    return null;
  }

  /** 敵・ボス・小物・拾いものをまとめて描く。 */
  function drawFpSprites() {
    const p = player;

    // --- 什器のうち板で表すもの ---
    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      const def = PROP3D[pr.type];
      if (!def || def.style !== 'bb') continue;
      const art = PROP_ART[pr.type];
      if (!art) continue;
      const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
      if (dist2(cx, cy, fpc.x, fpc.y) > 760 * 760) continue;
      const glow = PROP_GLOW[pr.type];
      drawBillboard(cx, cy, def.z || 0, def.h / (def.fill || 0.6), (g) => art(g, pr),
        { glowFn: glow ? (g, lit) => glow(g, pr, lit) : null });
    }

    // --- 落ちているもの ---
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (dist2(it.x, it.y, fpc.x, fpc.y) > 900 * 900) continue;
      const art = ITEM_ART[it.type];
      if (!art) continue;
      const bob = 3 + Math.sin(gameT * 2 + it.t) * 2;
      const col = ITEM_COLOR[it.type] || '#ffd766';
      drawBillboard(it.x, it.y, bob, (ITEM_H[it.type] || 6) * 4.2, (g) => art(g, { icon: map.def.goalIcon }), {
        glowFn: (g) => {
          const gr = g.createRadialGradient(0, -14, 0, 0, -14, 26);
          gr.addColorStop(0, hexA(col, 0.5));
          gr.addColorStop(1, hexA(col, 0));
          g.fillStyle = gr;
          g.beginPath(); g.arc(0, -14, 26, 0, TAU); g.fill();
        },
      });
    }

    // --- 敵 ---
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const art = ENEMY_ART[e.kind];
      if (!art) continue;
      const d = dist(e.x, e.y, fpc.x, fpc.y);
      if (d > 900) continue;
      const lit = lightAtPoint(e.x, e.y, d);
      if (lit < 0.14 && d > 620) continue;          // 遠くの暗がりは目さえ見えない
      const s = facingOf(e);
      const o = {
        t: e.anim, s, moving: e.state === 'chase' || e.state === 'patrol' || e.state === 'search',
        attack: e.windup > 0 || e.atkCd > e.def.atkCd * 0.72,
      };
      const h = ENEMY_H[e.kind] || 62;
      if (e.dead) {
        drawBillboard(e.x, e.y, 0, h * 0.55, (g) => {
          g.save(); g.translate(0, 6); g.scale(1.15, 0.42); art(g, { t: 0, s, moving: false });
          g.restore();
        }, { light: lit, alpha: clamp(1 - e.deadT / 16, 0.15, 1) });
        continue;
      }
      const glow = ENEMY_GLOW[e.kind];
      drawBillboard(e.x, e.y, 0, h, (g) => art(g, o), {
        light: lit,
        tint: enemyTint(e),
        alpha: e.phantom ? 0.42 + Math.sin(gameT * 12) * 0.12 : 1,
        glowFn: glow ? (g, l) => glow(g, o, l) : null,
      });
      // 状態の記号
      if (e.fleeT > 0 || e.stun > 0 || e.state === 'chase') {
        const pt = fpProject(e.x, e.y, h + 16);
        if (pt && pt.d < colDepth[clamp(pt.x | 0, 0, RW - 1)]) {
          rcx.save();
          rcx.globalAlpha = 0.85;
          rcx.font = '10px system-ui, sans-serif';
          rcx.textAlign = 'center';
          rcx.fillText(e.fleeT > 0 ? '💨' : e.stun > 0 ? '💫' : '❗', pt.x, pt.y);
          rcx.restore();
        }
      }
    }

    // --- チャプターのボス ---
    if (stalker) {
      const s2 = stalker;
      const art = STALKER_ART[s2.def.id];
      if (art) {
        const d = dist(s2.x, s2.y, fpc.x, fpc.y);
        const lit = Math.max(lightAtPoint(s2.x, s2.y, d), 0.1);
        const o = { t: s2.anim, s: facingOf(s2), attack: s2.atkCd > 1.2, moving: true };
        const glow = STALKER_GLOW[s2.def.id];
        drawBillboard(s2.x, s2.y, 0, STALKER_H[s2.def.id] || 90, (g) => art(g, o), {
          light: lit,
          tint: s2.hitFlash > 0 ? `rgba(255,250,230,${clamp(s2.hitFlash * 2, 0, 0.6)})` : (s2.dazzle > 0 ? 'rgba(255,250,220,0.32)' : null),
          glowFn: glow ? (g, l) => glow(g, o, l) : null,
        });
      }
    }

    // --- マザー ---
    if (boss) {
      const d = dist(boss.x, boss.y, fpc.x, fpc.y);
      const lit = Math.max(lightAtPoint(boss.x, boss.y, d), 0.16);
      const o = { t: boss.anim, open: boss.heartOpen > 0 ? clamp(boss.heartOpen / 2, 0, 1) : 0, phase: boss.phase, sweep: boss.sweep > 0 };
      drawBillboard(boss.x, boss.y, 0, boss.dead ? 44 : 112, (g) => {
        if (boss.dead) { g.save(); g.translate(0, 8); g.scale(1.3, 0.4); artMother(g, o); g.restore(); }
        else artMother(g, o);
      }, {
        light: lit,
        tint: boss.hitFlash > 0 ? `rgba(255,240,220,${clamp(boss.hitFlash * 2, 0, 0.6)})` : null,
        glowFn: (g, l) => glowMother(g, o, l),
      });
    }

    // --- 眠り煙 ---
    for (let i = 0; i < gasClouds.length; i++) {
      const gc = gasClouds[i];
      drawBillboard(gc.x, gc.y, 8, gc.r * 1.6, (g) => {
        const gr = g.createRadialGradient(0, -34, 2, 0, -34, 46);
        gr.addColorStop(0, 'rgba(220,90,90,0.42)');
        gr.addColorStop(0.6, 'rgba(150,40,50,0.22)');
        gr.addColorStop(1, 'rgba(120,20,30,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, -34, 46, 0, TAU); g.fill();
      }, { alpha: clamp(gc.life / 3, 0, 1) });
    }

    // --- 投射物 ---
    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i];
      if (sh.kind !== 'part') continue;
      drawBillboard(sh.x, sh.y, 26, 16, (g) => {
        g.save(); g.rotate(sh.spin + gameT * 8);
        g.fillStyle = '#c8ccd2';
        g.beginPath(); g.ellipse(0, -8, 8, 3, 0, 0, TAU); g.fill();
        g.restore();
      }, {});
    }

    // --- 粒子 ---
    drawFpParticles();

    // --- グラップパックの鉤 ---
    const gh = player.grabHand;
    if (gh) {
      const pt = fpProject(gh.x, gh.y, 24);
      if (pt) {
        rcx.save();
        rcx.strokeStyle = 'rgba(190,220,240,0.75)';
        rcx.lineWidth = 1.4;
        rcx.beginPath();
        rcx.moveTo(RW * 0.34, RH + 10);
        rcx.quadraticCurveTo((RW * 0.34 + pt.x) / 2, (RH + pt.y) / 2 + 8, pt.x, pt.y);
        rcx.stroke();
        rcx.fillStyle = '#9fe0ff';
        rcx.beginPath(); rcx.arc(pt.x, pt.y, 2.4, 0, TAU); rcx.fill();
        rcx.restore();
      }
    }
  }

  /** 埃・火花。奥行きに合わせて点で置く。 */
  function drawFpParticles() {
    if (!parts.length) return;
    const dirX = Math.cos(fpc.yaw), dirY = Math.sin(fpc.yaw);
    const planeX = -dirY * TAN_HALF, planeY = dirX * TAN_HALF;
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    rcx.save();
    for (let i = 0; i < parts.length; i++) {
      const pa = parts[i];
      const rx = pa.x - fpc.x, ry = pa.y - fpc.y;
      const d = invDet * (-planeY * rx + planeX * ry);
      if (d < 4 || d > 700) continue;
      const tx = invDet * (dirY * rx - dirX * ry);
      const sx = (RW / 2) * (1 + tx / d);
      if (sx < -4 || sx > RW + 4) continue;
      const col = sx < 0 ? 0 : sx >= RW ? RW - 1 : sx | 0;
      if (d > colDepth[col]) continue;
      const z = 18 + (pa.z || 0) + Math.sin(pa.x * 0.05 + gameT) * 4;
      const sy = fpc.horizon + (fpc.eye - z) * PROJ / d;
      const r = Math.max(0.6, (pa.r || 1) * PROJ / d * 0.5);
      rcx.globalAlpha = clamp(pa.life / pa.max, 0, 1) * (pa.glow ? 0.85 : 0.75);
      rcx.globalCompositeOperation = pa.glow ? 'lighter' : 'source-over';
      rcx.fillStyle = pa.c;
      rcx.fillRect(sx - r / 2, sy - r / 2, r, r);
    }
    rcx.globalAlpha = 1;
    rcx.globalCompositeOperation = 'source-over';
    rcx.restore();
  }

  // ------------------------------------------------------------
  //  手元 ― 懐中電灯と得物
  // ------------------------------------------------------------
  let swayX = 0, swayY = 0, lastYaw = 0;

  function updateViewSway(dt) {
    const dy = normAng(fpc.yaw - lastYaw);
    lastYaw = fpc.yaw;
    swayX = lerp(swayX, clamp(-dy * 220, -16, 16), Math.min(1, dt * 8));
    swayY = lerp(swayY, fpc.bob * 1.3, Math.min(1, dt * 10));
  }

  function drawViewModel() {
    const p = player;
    if (p.hiding) return;
    const g = rcx;
    const bx = swayX, by = swayY;
    const suit = isSuit(p.char);
    const st = suit ? (SUIT_STYLE[p.char.suit] || SUIT_STYLE.bear) : null;
    const skin = suit ? st.fur : '#c9a184';
    const skinD = suit ? st.dark : '#a8836a';
    const lightOn = p.lightOn && p.battery > 0;
    const atk = clamp(p.atkAnim / 0.18, 0, 1);
    const swing = atk * atk;

    // --- 左手の懐中電灯 ---
    g.save();
    g.translate(RW * 0.30 + bx * 0.7, RH + 8 + by);
    g.rotate(-0.32 + bx * 0.003);
    // 袖
    g.fillStyle = '#232830';
    g.beginPath();
    g.moveTo(-26, 26); g.lineTo(-20, -18); g.lineTo(22, -18); g.lineTo(30, 26);
    g.closePath(); g.fill();
    g.fillStyle = '#171b21';
    g.fillRect(-21, -20, 42, 7);
    // 筒
    g.fillStyle = '#2a2f36';
    g.beginPath();
    g.moveTo(-12, -18); g.lineTo(-10, -92); g.lineTo(11, -94); g.lineTo(13, -18);
    g.closePath(); g.fill();
    g.fillStyle = '#3a4048';
    g.fillRect(-11, -78, 23, 10);
    g.fillStyle = '#20242a';
    for (let i = 0; i < 5; i++) g.fillRect(-11, -74 + i * 2, 23, 1);
    // ヘッド(反射鏡)
    g.fillStyle = '#454c55';
    g.beginPath();
    g.moveTo(-10, -92); g.lineTo(-16, -114); g.lineTo(17, -117); g.lineTo(11, -94);
    g.closePath(); g.fill();
    g.fillStyle = '#565e68';
    g.beginPath(); g.ellipse(0.5, -115, 16.5, 5.6, 0, 0, TAU); g.fill();
    // レンズ
    const lg = g.createRadialGradient(0.5, -115, 1, 0.5, -115, 15);
    if (lightOn) {
      lg.addColorStop(0, `rgba(255,250,226,${0.72 * p.flicker})`);
      lg.addColorStop(0.6, `rgba(255,214,142,${0.42 * p.flicker})`);
      lg.addColorStop(1, 'rgba(255,190,110,0.05)');
    } else {
      lg.addColorStop(0, 'rgba(126,132,140,0.55)');
      lg.addColorStop(1, 'rgba(46,50,56,0.5)');
    }
    g.fillStyle = lg;
    g.beginPath(); g.ellipse(0.5, -115, 14, 4.6, 0, 0, TAU); g.fill();
    // 握っている手
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(1, -34, 19, 16, -0.12, 0, TAU); g.fill();
    g.fillStyle = skinD;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.ellipse(-11 + i * 8, -46 + Math.abs(i - 1.5) * 2.4, 4.6, 7, 0.08, 0, TAU);
      g.fill();
    }
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(14, -30, 6, 9, 0.5, 0, TAU); g.fill();
    g.restore();

    // 点灯中は筒先のまわりがほんのり明るい
    if (lightOn) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(RW * 0.30 + 36, RH - 108, 2, RW * 0.30 + 36, RH - 108, 74);
      gr.addColorStop(0, `rgba(255,238,196,${0.13 * p.flicker})`);
      gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, RW, RH);
      g.restore();
    }

    // --- 右手の得物 ---
    g.save();
    g.translate(RW * 0.72 + bx * 1.0, RH + 10 + by + swing * 30);
    g.rotate(0.24 - swing * 1.55 + bx * 0.004);
    const id = p.char.id;
    if (suit) {
      // 着ぐるみの手。威嚇のときに大きく振り上がる。
      g.fillStyle = st.dark;
      g.beginPath(); g.ellipse(4, 6, 26, 30, 0.12, 0, TAU); g.fill();
      g.fillStyle = st.fur;
      g.beginPath(); g.ellipse(0, -34, 27, 30, 0.1, 0, TAU); g.fill();
      g.fillStyle = st.muzzle;
      g.beginPath(); g.ellipse(-2, -30, 14, 16, 0, 0, TAU); g.fill();
      g.fillStyle = st.fur;
      for (let i = -1; i <= 2; i++) {
        g.beginPath(); g.ellipse(-16 + i * 11, -62 - Math.abs(i - 0.5) * 4, 6.5, 13, 0.05, 0, TAU); g.fill();
      }
      g.fillStyle = '#e8e2d0';
      for (let i = -1; i <= 2; i++) {
        g.beginPath();
        g.moveTo(-20 + i * 11, -72); g.lineTo(-16 + i * 11, -82); g.lineTo(-12 + i * 11, -72);
        g.closePath(); g.fill();
      }
    } else if (id === 'streamer') {
      // 一眼カメラ。構えるとファインダーが出る。
      g.fillStyle = '#c9a184';
      g.beginPath(); g.ellipse(-34, -6, 15, 14, 0.2, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(30, -6, 15, 14, -0.2, 0, TAU); g.fill();
      g.fillStyle = '#1c1f24'; g.fillRect(-32, -50, 62, 40);
      g.fillStyle = '#2a2f36'; g.fillRect(-12, -62, 26, 14);
      g.fillStyle = '#0d1014';
      g.beginPath(); g.arc(0, -30, 16, 0, TAU); g.fill();
      g.fillStyle = '#20262e';
      g.beginPath(); g.arc(0, -30, 12, 0, TAU); g.fill();
      g.fillStyle = 'rgba(130,200,230,0.35)';
      g.beginPath(); g.arc(-4, -34, 6, 0, TAU); g.fill();
      g.fillStyle = p.atkCd > 0 ? '#c8443a' : '#7ae08a';
      g.fillRect(18, -58, 6, 5);
    } else {
      // 棒状の得物。柄を握った手ごと画面に入れる。
      let barrel = '#2b2f36', L = 96, W = 9, head = null;
      if (id === 'inspector') { barrel = '#7c7468'; L = 104; W = 10; }
      else if (id === 'mechanic') { barrel = '#8c9198'; L = 86; W = 11; head = 'wrench'; }
      else if (id === 'artisan') { barrel = '#c2c8ce'; L = 58; W = 6; head = 'blade'; }
      g.fillStyle = barrel;
      g.beginPath();
      g.moveTo(-W, -26); g.lineTo(-W + 1.5, -26 - L); g.lineTo(W - 1.5, -28 - L); g.lineTo(W, -26);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(-W + 1, -26 - L, 3, L);
      if (head === 'wrench') {
        g.fillStyle = '#9aa0a8';
        g.fillRect(-14, -30 - L, 28, 14);
        g.fillStyle = '#14161a';
        g.fillRect(-6, -30 - L, 12, 9);
      } else if (head === 'blade') {
        g.fillStyle = '#e6ebef';
        g.beginPath(); g.moveTo(-5, -28 - L); g.lineTo(1, -46 - L); g.lineTo(5, -28 - L); g.closePath(); g.fill();
      } else if (id === 'inspector') {
        g.fillStyle = 'rgba(122,62,26,0.45)';
        g.fillRect(-W + 1, -30 - L * 0.55, W * 2 - 2, 18);
      }
      // 柄
      g.fillStyle = '#15171b';
      g.fillRect(-W - 2, -28, W * 2 + 4, 26);
      // 手
      g.fillStyle = skin;
      g.beginPath(); g.ellipse(0, -8, 19, 17, 0, 0, TAU); g.fill();
      g.fillStyle = skinD;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(-12 + i * 8, -20, 4.4, 6.4, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#232830';
      g.beginPath();
      g.moveTo(-24, 30); g.lineTo(-18, 4); g.lineTo(20, 4); g.lineTo(28, 30);
      g.closePath(); g.fill();
    }
    g.restore();

    // --- 集束照射のとき、視界の中心が焼ける ---
    if (p.focus && lightOn) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(RW / 2, RH * 0.5, 4, RW / 2, RH * 0.5, RH * 0.52);
      gr.addColorStop(0, `rgba(255,246,214,${0.17 * p.flicker})`);
      gr.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, RW, RH);
      g.restore();
    }
  }

  // ------------------------------------------------------------
  //  画面の上に重ねるもの(等倍で描く)
  // ------------------------------------------------------------
  function drawFpOverlay() {
    const p = player;
    // --- 照準 ---
    if (!p.hiding && state === 'play') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#e8e4d8';
      ctx.lineWidth = 1.5;
      const cx = VIEW_W / 2, cy = VIEW_H / 2;
      const gap = 5 + (p.atkCd > 0 ? 6 : 0);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * gap, cy + Math.sin(a) * gap);
        ctx.lineTo(cx + Math.cos(a) * (gap + 5), cy + Math.sin(a) * (gap + 5));
        ctx.stroke();
      }
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#e8e4d8';
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
      ctx.restore();
    }

    // --- 浮かぶ文字 ---
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    for (const f of floats) {
      const pt = fpProject(f.x, f.y, 40);
      if (!pt) continue;
      const x = pt.x * RSCALE, y = pt.y * RSCALE;
      ctx.globalAlpha = clamp(f.life / 0.9, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(f.text, x + 1, y + 1);
      ctx.fillStyle = f.c;
      ctx.fillText(f.text, x, y);
    }
    ctx.restore();

    // --- 目標の方角 ---
    if (map.exit && objectiveComplete()) fpMarker(map.exit.x, map.exit.y, '#8ad4ff');
    for (const it of items) {
      if ((it.type === 'goal' || it.type === 'grabpack' || it.type === 'mask') && dist(player.x, player.y, it.x, it.y) < 900) {
        fpMarker(it.x, it.y, it.type === 'grabpack' ? '#7ce0ff' : '#ffd766');
      }
    }
    if (stalker) fpMarker(stalker.x, stalker.y, stalker.def.color);

    // --- 調べるヒント ---
    const t = state === 'play' ? findInteract(player) : null;
    const hint = $('interact-hint');
    if (hint) {
      if (t) {
        hint.textContent = (touch.on ? '' : 'E ') + t.label;
        hint.classList.remove('hidden');
        const pt = fpProject(t.x, t.y, 30);
        const sx = pt && pt.x > 40 && pt.x < RW - 40 ? pt.x / RW * 100 : 50;
        const sy = pt && pt.y > 40 && pt.y < RH - 60 ? pt.y / RH * 100 : 62;
        hint.style.left = sx + '%';
        hint.style.top = sy + '%';
      } else hint.classList.add('hidden');
    }

    // --- カメラのファインダー ---
    if (p.shutter > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(p.shutter / 0.34, 0, 1);
      ctx.strokeStyle = '#e8e4d8';
      ctx.lineWidth = 2;
      const w = VIEW_W * 0.34, h = VIEW_H * 0.3;
      const cx = VIEW_W / 2, cy = VIEW_H / 2;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * w, cy + dy * h - dy * 18);
        ctx.lineTo(cx + dx * w, cy + dy * h);
        ctx.lineTo(cx + dx * w - dx * 18, cy + dy * h);
        ctx.stroke();
      }
      ctx.fillStyle = '#c8443a';
      ctx.beginPath(); ctx.arc(cx + w - 14, cy - h + 14, 4, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // --- 壁越しの索敵(店の記憶) ---
    if (p.memoryT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const e of enemies) {
        if (e.dead) continue;
        const pt = fpProject(e.x, e.y, 0);
        if (!pt) continue;
        const h = (ENEMY_H[e.kind] || 62) * PROJ / pt.d;
        ctx.strokeStyle = '#8ae6b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect((pt.x - h * 0.28) * RSCALE, (pt.y - h) * RSCALE, h * 0.56 * RSCALE, h * RSCALE);
      }
      if (map.exit) {
        const pt = fpProject(map.exit.x, map.exit.y, 20);
        if (pt) {
          ctx.strokeStyle = '#8ad4ff';
          ctx.beginPath();
          ctx.arc(pt.x * RSCALE, pt.y * RSCALE, 14, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // --- ロッカーの中から見た隙間 ---
    if (p.hiding) {
      ctx.save();
      ctx.fillStyle = '#04050700';
      const barH = VIEW_H * 0.2;
      ctx.fillStyle = '#050608';
      ctx.fillRect(0, 0, VIEW_W, barH);
      ctx.fillRect(0, VIEW_H - barH, VIEW_W, barH);
      ctx.fillRect(0, 0, VIEW_W * 0.16, VIEW_H);
      ctx.fillRect(VIEW_W * 0.84, 0, VIEW_W * 0.16, VIEW_H);
      // 通気スリット
      ctx.fillStyle = 'rgba(4,5,8,0.86)';
      for (let y = barH; y < VIEW_H - barH; y += 22) ctx.fillRect(VIEW_W * 0.16, y, VIEW_W * 0.68, 9);
      ctx.restore();
    }
  }

  /**
   * 目標の方角。画面に映っていない間だけ、左右の縁に小さな三角で出す。
   * 真後ろにあるほど薄くなるので、振り向く方向の見当がつく。
   */
  function fpMarker(wx, wy, color) {
    const pt = fpProject(wx, wy, 26);
    if (pt && pt.x > 30 && pt.x < RW - 30) {
      const col = clamp(pt.x | 0, 0, RW - 1);
      if (pt.d < colDepth[col]) return;      // 見えているなら要らない
    }
    const a = normAng(Math.atan2(wy - player.y, wx - player.x) - fpc.yaw);
    const side = a >= 0 ? 1 : -1;
    const x = side > 0 ? VIEW_W - 26 : 26;
    const y = VIEW_H * 0.46 + Math.min(1, Math.abs(a) / Math.PI) * 40;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side > 0 ? 0 : Math.PI);
    ctx.globalAlpha = (0.72 - Math.abs(a) / Math.PI * 0.34) * (0.75 + Math.sin(gameT * 4) * 0.25);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /**
   * 一人称の場面を1フレーム描く。
   * 低解像度で世界を作ってから、まとめて画面いっぱいに引き伸ばす。
   */
  function drawFpScene() {
    renderFpWorld();
    drawFpSprites();
    drawViewModel();
    ctx.imageSmoothingEnabled = false;
    // 正気度が落ちているときは、縦の短冊ごとにずらして視界を波打たせる
    const mad = clamp((38 - player.sanity) / 38, 0, 1) * (modLv('nerve') ? 0.3 : 1);
    if (mad > 0.03) {
      ctx.fillStyle = '#040507';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const N = 30, sw = RW / N;
      for (let i = 0; i < N; i++) {
        const off = (Math.sin(i * 0.52 + gameT * 2.0) * 6 + Math.sin(i * 0.17 - gameT * 1.3) * 4) * mad;
        ctx.drawImage(rcCv, i * sw, 0, sw, RH, i * sw * RSCALE, off * RSCALE, sw * RSCALE, RH * RSCALE);
      }
    } else {
      ctx.drawImage(rcCv, 0, 0, RW, RH, 0, 0, VIEW_W, VIEW_H);
    }
    ctx.imageSmoothingEnabled = true;
    drawFpOverlay();
  }
  // ------------------------------------------------------------
  //  ポストエフェクト
  // ------------------------------------------------------------
  let grainCv = null;
  function makeGrain() {
    grainCv = document.createElement('canvas');
    grainCv.width = 160; grainCv.height = 160;
    const g = grainCv.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 26;
    }
    g.putImageData(img, 0, 0);
  }

  function drawPost() {
    const p = player;
    // 色ずれ(正気度が低いほど強い)
    if (fx.chroma > 0.04) {
      const off = 1 + fx.chroma * 5;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.10 + fx.chroma * 0.14;
      ctx.drawImage(cv, off, 0);
      ctx.drawImage(cv, -off, 0);
      ctx.restore();
    }

    // ビネット
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.28, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${0.55 + fx.chroma * 0.3})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 被弾の赤
    if (fx.hurt > 0.01 || (p && p.hp < p.maxHp * 0.3)) {
      const lowHp = p ? clamp(1 - p.hp / (p.maxHp * 0.3), 0, 1) * (0.20 + Math.sin(gameT * 4) * 0.08) : 0;
      const a = Math.max(fx.hurt * 0.40, lowHp);
      const rg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.78);
      rg.addColorStop(0, 'rgba(120,0,0,0)');
      rg.addColorStop(1, `rgba(150,10,10,${a})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // フィルムグレイン
    if (grainCv) {
      ctx.save();
      ctx.globalAlpha = 0.35 + fx.chroma * 0.3;
      const ox = Math.floor(Math.random() * 160), oy = Math.floor(Math.random() * 160);
      for (let x = -ox; x < VIEW_W; x += 160) for (let y = -oy; y < VIEW_H; y += 160) ctx.drawImage(grainCv, x, y);
      ctx.restore();
    }

    // 走査線
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#000';
    for (let y = 0; y < VIEW_H; y += 3) ctx.fillRect(0, y, VIEW_W, 1);
    ctx.restore();

    // ジャンプスケア
    if (fx.stinger > 0.01) {
      ctx.save();
      ctx.globalAlpha = fx.stinger * 0.35;
      ctx.fillStyle = Math.random() > 0.5 ? '#3a0000' : '#000';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = fx.stinger;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(cv, rnd(-8, 8), rnd(-6, 6));
      ctx.restore();
    }

    // 白フラッシュ
    if (fx.flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = clamp(fx.flash, 0, 1) * 0.9;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    // シネマ用レターボックス
    if (fx.letter > 0.01) {
      const h = 56 * fx.letter;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEW_W, h);
      ctx.fillRect(0, VIEW_H - h, VIEW_W, h);
    }

    // 隠れている間の視界
    if (p && p.hiding) {
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H * 0.34);
      ctx.fillRect(0, VIEW_H * 0.66, VIEW_W, VIEW_H * 0.34);
      ctx.fillRect(0, 0, VIEW_W * 0.12, VIEW_H);
      ctx.fillRect(VIEW_W * 0.88, 0, VIEW_W * 0.12, VIEW_H);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------
  //  全体マップ(Tab)
  //  踏破したところだけが残る。まだ見ていない区画は描かない。
  // ------------------------------------------------------------
  function drawBigMap() {
    const pad = 54;
    ctx.save();
    ctx.fillStyle = 'rgba(4,5,7,0.9)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const sc = Math.min((VIEW_W - pad * 2) / map.w, (VIEW_H - pad * 2 - 26) / map.h);
    const ox = (VIEW_W - map.w * sc) / 2;
    const oy = (VIEW_H - map.h * sc) / 2 + 12;

    // フロア全体の枠(どれだけ未踏か分かるように)
    ctx.strokeStyle = 'rgba(190,170,130,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, map.w * sc, map.h * sc);

    // 踏破済みの床
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (!map.seen[idx(map, x, y)] || !isFloorTile(map, x, y)) continue;
        ctx.fillStyle = 'rgba(146,166,178,0.5)';
        ctx.fillRect(ox + x * sc, oy + y * sc, Math.ceil(sc), Math.ceil(sc));
      }
    }
    // 踏破済みの床に接する壁を縁取り、部屋の形を読み取れるようにする
    ctx.fillStyle = 'rgba(232,163,61,0.30)';
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (isFloorTile(map, x, y) || !map.seen[idx(map, x, y)]) continue;
        ctx.fillRect(ox + x * sc, oy + y * sc, Math.ceil(sc), Math.ceil(sc));
      }
    }

    const mark = (wx, wy, color, label, big) => {
      const mx = ox + (wx / TILE) * sc, my = oy + (wy / TILE) * sc;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, big ? 6 : 4.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
      if (label) {
        ctx.fillStyle = color;
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, mx, my - 9);
      }
    };

    // 目標と脱出装置
    for (const it of items) {
      if (it.type !== 'goal') continue;
      const tx = Math.floor(it.x / TILE), ty = Math.floor(it.y / TILE);
      if (!map.seen[idx(map, tx, ty)] && player.memoryT <= 0) continue;
      mark(it.x, it.y, '#ffd766', map.def.goalItem);
    }
    if (map.exit) {
      const tx = Math.floor(map.exit.x / TILE), ty = Math.floor(map.exit.y / TILE);
      if (map.seen[idx(map, tx, ty)] || player.memoryT > 0) {
        mark(map.exit.x, map.exit.y, player.goals >= map.def.goalCount ? '#7fe0ff' : '#4f7c8c', map.def.exitName, true);
      }
    }
    if (map.breakers) {
      for (const b of map.breakers) mark(b.x + b.w / 2, b.y + b.h / 2, b.on ? '#8ff0b0' : '#a05050', 'BR');
    }
    // 「店の記憶」中は敵も見える
    if (player.memoryT > 0) {
      for (const e of enemies) {
        if (e.dead || e.phantom) continue;
        mark(e.x, e.y, '#ff6a5a', null);
      }
    }
    // 自分
    const mx = ox + (player.x / TILE) * sc, my = oy + (player.y / TILE) * sc;
    ctx.fillStyle = player.char.color;
    ctx.beginPath(); ctx.arc(mx, my, 5.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(player.aim) * 14, my + Math.sin(player.aim) * 14); ctx.stroke();

    // 見出しと凡例
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ece2cc';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText(map.def.name, pad, 34);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#8e887c';
    ctx.fillText('踏破した区画だけが記録される', pad, 50);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8e887c';
    ctx.fillText('Tab で閉じる', VIEW_W - pad, 34);
    ctx.fillStyle = '#ffd766';
    ctx.fillText('● ' + map.def.goalItem + '　', VIEW_W - pad - 90, 50);
    ctx.fillStyle = '#7fe0ff';
    ctx.fillText('● ' + map.def.exitName, VIEW_W - pad, 50);
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  ミニマップ
  // ------------------------------------------------------------
  function drawMinimap() {
    if (!mctx) return;
    const MW = miniCv.width, MH = miniCv.height;
    mctx.clearRect(0, 0, MW, MH);
    const sc = Math.min(MW / map.w, MH / map.h);
    const ox = (MW - map.w * sc) / 2, oy = (MH - map.h * sc) / 2;
    mctx.fillStyle = 'rgba(6,8,10,0.85)';
    mctx.fillRect(0, 0, MW, MH);
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (!map.seen[idx(map, x, y)] || !isFloorTile(map, x, y)) continue;
        mctx.fillStyle = 'rgba(120,140,150,0.42)';
        mctx.fillRect(ox + x * sc, oy + y * sc, Math.ceil(sc), Math.ceil(sc));
      }
    }
    // 目標
    for (const it of items) {
      if (it.type !== 'goal') continue;
      const tx = Math.floor(it.x / TILE), ty = Math.floor(it.y / TILE);
      if (!map.seen[idx(map, tx, ty)] && player.memoryT <= 0) continue;
      mctx.fillStyle = '#ffd766';
      mctx.fillRect(ox + tx * sc - 1, oy + ty * sc - 1, sc + 2, sc + 2);
    }
    if (map.exit) {
      const tx = Math.floor(map.exit.x / TILE), ty = Math.floor(map.exit.y / TILE);
      if (map.seen[idx(map, tx, ty)] || player.memoryT > 0) {
        mctx.fillStyle = player.goals >= map.def.goalCount ? '#7fe0ff' : '#4a6a7a';
        mctx.fillRect(ox + tx * sc - 1, oy + ty * sc - 1, sc + 2, sc + 2);
      }
    }
    if (player.memoryT > 0) {
      mctx.fillStyle = '#ff6a5a';
      for (const e of enemies) {
        if (e.dead || e.phantom) continue;
        mctx.fillRect(ox + (e.x / TILE) * sc - 1, oy + (e.y / TILE) * sc - 1, 2.5, 2.5);
      }
    }
    // プレイヤー
    mctx.fillStyle = player.char.color;
    mctx.beginPath();
    mctx.arc(ox + (player.x / TILE) * sc, oy + (player.y / TILE) * sc, 2.6, 0, TAU);
    mctx.fill();
    mctx.strokeStyle = 'rgba(255,255,255,0.5)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.moveTo(ox + (player.x / TILE) * sc, oy + (player.y / TILE) * sc);
    mctx.lineTo(ox + (player.x / TILE) * sc + Math.cos(player.aim) * 7, oy + (player.y / TILE) * sc + Math.sin(player.aim) * 7);
    mctx.stroke();
  }

  // ============================================================
  //  画面遷移とUI
  // ============================================================
  const SCREENS = ['screen-title', 'screen-select', 'screen-briefing', 'screen-safe', 'screen-note', 'screen-over', 'screen-win', 'screen-help', 'screen-pause'];

  function hideAllScreens() {
    for (const id of SCREENS) { const el = $(id); if (el) el.classList.add('hidden'); }
  }
  function showScreen(id) {
    hideAllScreens();
    const el = $(id);
    if (el) el.classList.remove('hidden');
  }

  function setState(s) {
    state = s;
    if (s !== 'play') setMapOpen(false);
    const hud = $('hud');
    if (hud) hud.classList.toggle('hidden', s !== 'play');
    if (miniCv) miniCv.classList.toggle('hidden', s !== 'play');
    const tl = $('touch');
    if (tl) tl.classList.toggle('hidden', !(s === 'play' && touch.on));
    const tb = $('topbtns');
    if (tb) tb.classList.toggle('hidden', s === 'cut');   // ムービー中は隠す

    if (s === 'play' || s === 'cut') { hideAllScreens(); }
    else if (s === 'title') showScreen('screen-title');
    else if (s === 'select') { showScreen('screen-select'); buildSelect(); }
    else if (s === 'briefing') showScreen('screen-briefing');
    else if (s === 'safe') { showScreen('screen-safe'); buildUpgrades(); }
    else if (s === 'note') showScreen('screen-note');
    else if (s === 'dead') { showScreen('screen-over'); fillOver(); }
    else if (s === 'win') { showScreen('screen-win'); fillWin(); }
    else if (s === 'help') showScreen('screen-help');
    else if (s === 'paused') showScreen('screen-pause');
  }

  // ------------------------------------------------------------
  //  キャラクター選択
  // ------------------------------------------------------------
  /**
   * 着ぐるみキャラクターの立ち絵(正面)。
   * 頭の外装・耳・マズル・目の順に重ね、最後に職種の帯を載せる。
   */
  function drawSuitPortrait(g, c, W, H) {
    const st = SUIT_STYLE[c.suit] || SUIT_STYLE.bear;
    const cx = W / 2, cy = H * 0.58;
    // 肩と胴
    g.fillStyle = st.dark;
    g.beginPath(); g.ellipse(cx, cy + 52, 40, 30, 0, 0, TAU); g.fill();
    g.fillStyle = st.fur;
    g.beginPath(); g.ellipse(cx, cy + 56, 32, 24, 0, 0, TAU); g.fill();
    // 破れ目から覗くフレーム
    if (st.torn) {
      g.strokeStyle = 'rgba(190,198,206,0.75)'; g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 3; i++) { g.moveTo(cx - 16, cy + 44 + i * 7); g.lineTo(cx - 2, cy + 44 + i * 7); }
      g.stroke();
    }
    // 蝶ネクタイ
    if (st.tie) {
      g.fillStyle = st.tie;
      g.beginPath();
      g.moveTo(cx, cy + 36); g.lineTo(cx - 12, cy + 30); g.lineTo(cx - 12, cy + 42); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(cx, cy + 36); g.lineTo(cx + 12, cy + 30); g.lineTo(cx + 12, cy + 42); g.closePath(); g.fill();
    }
    // 耳
    g.fillStyle = st.dark;
    if (st.ear === 'long') {
      for (const sd of [-1, 1]) {
        g.save();
        g.translate(cx + sd * 11, cy - 30); g.rotate(sd * 0.16);
        g.beginPath(); g.ellipse(0, 0, 8, 25, 0, 0, TAU); g.fill();
        g.fillStyle = st.muzzle;
        g.beginPath(); g.ellipse(0, 2, 4, 17, 0, 0, TAU); g.fill();
        g.fillStyle = st.dark;
        g.restore();
      }
    } else {
      g.beginPath(); g.arc(cx - 22, cy - 24, 12, 0, TAU); g.fill();
      g.beginPath(); g.arc(cx + 22, cy - 24, 12, 0, TAU); g.fill();
    }
    // 頭
    g.fillStyle = st.fur;
    g.beginPath(); g.ellipse(cx, cy - 4, 27, 26, 0, 0, TAU); g.fill();
    g.strokeStyle = st.line; g.lineWidth = 2; g.stroke();
    // 裂けた外装から覗くフレーム
    if (st.torn) {
      g.strokeStyle = 'rgba(45,42,14,0.9)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx - 24, cy - 12); g.lineTo(cx - 15, cy - 4); g.lineTo(cx - 21, cy + 6); g.stroke();
      g.strokeStyle = 'rgba(190,198,206,0.8)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx - 22, cy - 8); g.lineTo(cx - 17, cy - 6); g.moveTo(cx - 21, cy - 2); g.lineTo(cx - 16, cy - 1); g.stroke();
      g.strokeStyle = 'rgba(45,42,14,0.7)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx + 14, cy + 2); g.lineTo(cx + 22, cy + 8); g.stroke();
    }
    // シルクハット
    if (st.hat) {
      g.fillStyle = '#15151a';
      g.fillRect(cx - 26, cy - 30, 52, 5);
      g.fillRect(cx - 16, cy - 52, 32, 24);
      g.fillStyle = '#8a2030';
      g.fillRect(cx - 16, cy - 34, 32, 5);
    }
    // マズル
    g.fillStyle = st.muzzle;
    g.beginPath(); g.ellipse(cx, cy + 11, 15, 11, 0, 0, TAU); g.fill();
    g.fillStyle = '#1a1410';
    g.beginPath(); g.ellipse(cx, cy + 5, 5, 3.6, 0, 0, TAU); g.fill();
    // 出っ歯
    g.fillStyle = '#efe8d8';
    if (st.ear === 'long') { g.fillRect(cx - 6.5, cy + 12, 6, 8); g.fillRect(cx + 0.5, cy + 12, 6, 8); }
    else for (let i = -1; i <= 1; i++) g.fillRect(cx + i * 7 - 2.6, cy + 13, 5.2, 6);
    // 目(眼窩の奥から光っている)
    g.fillStyle = '#0d0d10';
    g.beginPath(); g.arc(cx - 11, cy - 8, 8, 0, TAU); g.arc(cx + 11, cy - 8, 8, 0, TAU); g.fill();
    g.fillStyle = '#efe8d8';
    g.beginPath(); g.arc(cx - 11, cy - 8, 5.6, 0, TAU); g.arc(cx + 11, cy - 8, 5.6, 0, TAU); g.fill();
    g.fillStyle = '#101014';
    g.beginPath(); g.arc(cx - 10, cy - 7, 2.6, 0, TAU); g.arc(cx + 12, cy - 7, 2.6, 0, TAU); g.fill();
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = hexA(c.color, 0.9);
    g.beginPath(); g.arc(cx - 10, cy - 7, 1.9, 0, TAU); g.arc(cx + 12, cy - 7, 1.9, 0, TAU); g.fill();
    g.restore();
    // 職種の帯
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, H - 20, W, 20);
    g.fillStyle = c.color;
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(c.role, W / 2, H - 6);
  }

  function drawPortrait(canvas, c) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    // 背景
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#14171c');
    bg.addColorStop(1, c.accent);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // 後光(懐中電灯の光)
    const gr = g.createRadialGradient(W * 0.5, H * 0.42, 4, W * 0.5, H * 0.42, W * 0.6);
    gr.addColorStop(0, hexA(c.color, 0.35));
    gr.addColorStop(1, hexA(c.color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);

    if (isSuit(c)) { drawSuitPortrait(g, c, W, H); return; }

    const cx = W / 2, cy = H * 0.62;
    // 肩
    g.fillStyle = c.accent;
    g.beginPath();
    g.ellipse(cx, cy + 34, 30, 22, 0, 0, TAU);
    g.fill();
    g.fillStyle = c.color;
    g.beginPath();
    g.ellipse(cx, cy + 36, 24, 17, 0, 0, TAU);
    g.fill();
    // 首
    g.fillStyle = '#d8b494';
    g.fillRect(cx - 6, cy + 4, 12, 16);
    // 頭
    g.fillStyle = '#eccdac';
    g.beginPath(); g.ellipse(cx, cy - 8, 17, 20, 0, 0, TAU); g.fill();
    // 髪
    g.fillStyle = '#241b16';
    g.beginPath();
    if (c.id === 'streamer') {
      g.ellipse(cx, cy - 16, 20, 17, 0, Math.PI, TAU); g.fill();
      g.beginPath(); g.ellipse(cx - 16, cy - 2, 6, 16, 0.2, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(cx + 16, cy - 2, 6, 16, -0.2, 0, TAU); g.fill();
      // 猫耳フード
      g.fillStyle = c.color;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + s * 6, cy - 22);
        g.lineTo(cx + s * 21, cy - 34);
        g.lineTo(cx + s * 19, cy - 14);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.beginPath();
        g.moveTo(cx + s * 10, cy - 22);
        g.lineTo(cx + s * 18, cy - 29);
        g.lineTo(cx + s * 17, cy - 18);
        g.closePath(); g.fill();
        g.fillStyle = c.color;
      }
      g.beginPath();
      g.arc(cx, cy - 10, 25, Math.PI * 1.06, Math.PI * 1.94);
      g.arc(cx, cy - 10, 19, Math.PI * 1.94, Math.PI * 1.06, true);
      g.closePath(); g.fill();
      g.fillStyle = '#241b16';
    } else if (c.id === 'inspector') { g.ellipse(cx, cy - 14, 19, 15, 0, Math.PI, TAU); g.fill(); g.beginPath(); g.ellipse(cx, cy + 2, 20, 14, 0, 0, Math.PI); g.fill(); }
    else if (c.id === 'artisan') { g.ellipse(cx, cy - 15, 19, 16, 0, Math.PI, TAU); g.fill(); }
    else { g.ellipse(cx, cy - 17, 18, 13, 0, Math.PI, TAU); g.fill(); }
    // 目
    g.fillStyle = '#1a1410';
    g.beginPath(); g.ellipse(cx - 6.5, cy - 7, 2.6, 3.0, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(cx + 6.5, cy - 7, 2.6, 3.0, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillRect(cx - 7.4, cy - 8.4, 1.4, 1.4);
    g.fillRect(cx + 5.6, cy - 8.4, 1.4, 1.4);
    // 口
    g.strokeStyle = '#9a6a5a'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(cx - 4, cy + 2); g.lineTo(cx + 4, cy + 2); g.stroke();
    // 手に持った懐中電灯
    g.save();
    g.translate(cx + 26, cy + 26); g.rotate(-0.5);
    g.fillStyle = '#d8d4c6'; g.fillRect(-6, -4, 22, 9);
    g.fillStyle = '#8b8880'; g.fillRect(-6, -4, 7, 9);
    g.globalCompositeOperation = 'lighter';
    const lg = g.createRadialGradient(18, 0, 0, 18, 0, 42);
    lg.addColorStop(0, 'rgba(255,240,200,0.7)');
    lg.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(16, 0); g.arc(16, 0, 44, -0.5, 0.5); g.closePath(); g.fill();
    g.restore();
    // もう片方の手のカメラ(配信者)
    if (c.weapon.type === 'camera') {
      g.fillStyle = '#16171a';
      g.fillRect(cx - 40, cy + 20, 24, 16);
      g.fillStyle = '#3a3d44';
      g.beginPath(); g.arc(cx - 28, cy + 28, 6.5, 0, TAU); g.fill();
      g.fillStyle = '#8fd6ff';
      g.beginPath(); g.arc(cx - 28, cy + 28, 3.2, 0, TAU); g.fill();
      g.fillStyle = '#d8d4c6';
      g.fillRect(cx - 36, cy + 16, 7, 5);
    }

    // 職種の帯
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, H - 20, W, 20);
    g.fillStyle = c.color;
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(c.role, W / 2, H - 6);
  }

  let selectedChar = 'guard';
  function buildSelect() {
    const list = $('char-list');
    if (!list || list.dataset.built === '1') { updateSelectUI(); return; }
    list.innerHTML = '';
    for (const c of CHARS) {
      const card = document.createElement('button');
      card.className = 'char-card';
      card.dataset.id = c.id;
      card.innerHTML = `
        <canvas class="portrait" width="132" height="150"></canvas>
        <div class="cc-name">${c.name}</div>
        <div class="cc-tag" style="color:${c.color}">${c.tag}</div>
        <div class="cc-stats">
          <span>HP <b>${c.hp}</b></span><span>速さ <b>${Math.round(c.speed / 1.6)}</b></span><span>電池 <b>${c.battery}</b></span>
        </div>
        <div class="cc-weapon">${c.weapon.type === 'camera' ? '📷' : c.weapon.type === 'scare' ? '👹' : '🔨'} ${c.weapon.name}</div>
        <div class="cc-ability"><b>Q ${c.ability.name}</b><span>${c.ability.desc}</span></div>
        <div class="cc-trait">${c.trait}</div>
        <div class="cc-story">「${c.story}」</div>`;
      card.addEventListener('click', () => { selectedChar = c.id; Audio2.unlock(); Audio2.sfx.click(); updateSelectUI(); });
      list.appendChild(card);
      drawPortrait(card.querySelector('canvas'), c);
    }
    list.dataset.built = '1';

    const dl = $('diff-list');
    if (dl && dl.dataset.built !== '1') {
      dl.innerHTML = '';
      for (const k of ['easy', 'normal', 'nightmare']) {
        const d = DIFFS[k];
        const b = document.createElement('button');
        b.className = 'diff-pill';
        b.dataset.k = k;
        b.innerHTML = `<b>${d.label}</b><span>${d.sub}</span>`;
        b.addEventListener('click', () => { run.diff = k; Audio2.sfx.click(); updateSelectUI(); });
        dl.appendChild(b);
      }
      dl.dataset.built = '1';
    }
    updateSelectUI();
  }

  function updateSelectUI() {
    const list = $('char-list');
    if (list) for (const el of list.children) el.classList.toggle('sel', el.dataset.id === selectedChar);
    const dl = $('diff-list');
    if (dl) for (const el of dl.children) el.classList.toggle('sel', el.dataset.k === run.diff);
  }

  // ------------------------------------------------------------
  //  ブリーフィング
  // ------------------------------------------------------------
  function showBriefing(def) {
    const box = $('brief-body');
    if (box) {
      box.innerHTML = `
        <div class="brief-floor">${def.chapter ? 'CHAPTER ' + def.chapter : 'FINAL CHAPTER'}</div>
        <h2>${def.name}</h2>
        <p class="brief-lines">${(def.intro || []).map((s) => `<span>${s}</span>`).join('')}</p>
        <div class="brief-obj"><b>目標</b>${def.goalDesc || 'マザーを停止させる。'}</div>`;
    }
    setState('briefing');
  }

  // ------------------------------------------------------------
  //  休憩室(強化の選択)
  // ------------------------------------------------------------
  let upgradeChoices = [];
  function buildUpgrades() {
    const list = $('upgrade-list');
    if (!list) return;
    list.innerHTML = '';
    for (const u of upgradeChoices) {
      const card = document.createElement('button');
      card.className = 'up-card';
      const lv = run.mods[u.id] || 0;
      card.innerHTML = `<div class="up-icon">${u.icon}</div><div class="up-name">${u.name}${lv ? ` <em>Lv${lv + 1}</em>` : ''}</div><div class="up-desc">${u.desc}</div>`;
      card.addEventListener('click', () => {
        run.mods[u.id] = (run.mods[u.id] || 0) + 1;
        Audio2.sfx.pickup();
        applyModsToPlayer();
        run.floorIdx++;
        startFloor();
      });
      list.appendChild(card);
    }
    const info = $('safe-info');
    if (info && player) {
      info.innerHTML = `HP <b>${Math.round(player.hp)}/${player.maxHp}</b>　電池 <b>${Math.round(player.battery)}/${player.maxBattery}</b>　正気度 <b>${Math.round(player.sanity)}</b>　包帯 <b>${player.bandages}</b>`;
    }
  }

  function rollUpgrades() {
    const pool = UPGRADES.slice();
    upgradeChoices = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const k = Math.floor(Math.random() * pool.length);
      upgradeChoices.push(pool.splice(k, 1)[0]);
    }
  }

  /** 強化を取った直後に最大値へ反映する。 */
  function applyModsToPlayer() {
    const p = player, c = p.char;
    const newMaxHp = c.hp + 40 * modLv('armor');
    const newMaxBat = c.battery + 45 * modLv('cell');
    const newMaxSan = 100 + 15 * modLv('nerve');
    p.hp += Math.max(0, newMaxHp - p.maxHp);
    p.battery += Math.max(0, newMaxBat - p.maxBattery);
    p.sanity += Math.max(0, newMaxSan - p.maxSanity);
    p.maxHp = newMaxHp; p.maxBattery = newMaxBat; p.maxSanity = newMaxSan;
  }

  // ------------------------------------------------------------
  //  メモ
  // ------------------------------------------------------------
  function openNote(id) {
    const n = NOTES[id];
    if (!n) return;
    const box = $('note-body');
    if (box) box.innerHTML = `<h3>${n.t}</h3><p>${n.b}</p>`;
    setState('note');
  }

  // ------------------------------------------------------------
  //  結果画面
  // ------------------------------------------------------------
  function statLine() {
    const s = run.stats;
    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60);
    return `
      <div class="stat-grid">
        <div><span>到達</span><b>${s.floorName}</b></div>
        <div><span>経過</span><b>${mm}分 ${String(ss).padStart(2, '0')}秒</b></div>
        <div><span>停止させた個体</span><b>${player ? player.killCount : 0}</b></div>
        <div><span>読んだ記録</span><b>${run.notes.length} / ${NOTES.length}</b></div>
        <div><span>難易度</span><b>${DIFFS[run.diff].label}</b></div>
        <div><span>操作</span><b>${player ? player.char.name : '-'}</b></div>
      </div>`;
  }

  function fillOver() {
    const box = $('over-body');
    run.stats.floorName = map.def.name;
    const causes = [
      'ラインは、また一体ぶんの部品を得た。',
      '「おかえりなさい」と、暗闇が言った。',
      '「またのご来店を」の札が、静かに裏返った。',
      '店の灯りが、ひとつだけ点いた。',
    ];
    if (box) box.innerHTML = `<p class="over-flavor">${causes[Math.floor(Math.random() * causes.length)]}</p>${statLine()}`;
  }

  function fillWin() {
    const box = $('win-body');
    run.stats.floorName = 'B2 ボイラー室';
    const allNotes = run.notes.length >= NOTES.length;
    if (box) {
      box.innerHTML = `
        <p class="win-flavor">炉の火が落ちる。積み上がった頭が、ひとつずつ床にこぼれていく。<br>
        非常口の錆びた扉が、外側から開いた。朝だった。</p>
        ${allNotes ? '<p class="win-extra">― すべての記録を読んだあなたは、最後の一枚の筆跡が自分のものだと気づいてしまった。</p>' : ''}
        ${statLine()}`;
    }
  }

  // ------------------------------------------------------------
  //  HUD 更新
  // ------------------------------------------------------------
  let bodyCtx = null, lungCtx = null;

  function cacheHud() {
    ['hud-floor', 'hud-objective', 'hp-fill', 'hp-text', 'san-fill', 'san-text', 'bat-fill', 'bat-text',
      'stam-fill', 'ability-icon', 'ability-name', 'ability-cd', 'inv-bandage', 'inv-sedative',
      'toast', 'goal-count', 'char-chip', 'oxy-fill', 'body-map', 'lung'].forEach((id) => { HUD[id] = $(id); });
    if (HUD['body-map']) bodyCtx = HUD['body-map'].getContext('2d');
    if (HUD['lung']) lungCtx = HUD['lung'].getContext('2d');
  }

  /** 傷の深さを色にする。 */
  function limbColor(v) {
    if (v < 0.02) return '#48544c';
    if (v < 0.35) return '#8a8a3c';
    if (v < 0.7) return '#c07a28';
    return '#c0392b';
  }

  /** 被弾部位を示す人型。どこを痛めているか一目で分かるようにする。 */
  function drawBodyMap(p) {
    if (!bodyCtx) return;
    const g = bodyCtx, W = 56, H = 92;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(190,170,130,0.22)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    const L = p.limbs;
    const part = (color, fn) => { g.fillStyle = color; g.beginPath(); fn(); g.fill(); };
    // 頭
    part(limbColor(L.head), () => g.arc(28, 14, 8.5, 0, TAU));
    // 胴
    part(limbColor(L.torso), () => g.rect(19, 25, 18, 30));
    // 腕(肩でつなげる)
    part(limbColor(L.larm), () => g.rect(12, 27, 7, 26));
    part(limbColor(L.rarm), () => g.rect(37, 27, 7, 26));
    // 脚
    part(limbColor(L.lleg), () => g.rect(19, 57, 8, 28));
    part(limbColor(L.rleg), () => g.rect(29, 57, 8, 28));

    // 深手の部位は点滅させる
    for (const k in L) {
      if (L[k] < 0.7) continue;
      g.globalAlpha = 0.35 + Math.sin(gameT * 7) * 0.25;
      g.fillStyle = '#ff6a5a';
      if (k === 'head') { g.beginPath(); g.arc(28, 14, 9.5, 0, TAU); g.fill(); }
      else if (k === 'torso') g.fillRect(18, 24, 20, 32);
      else if (k === 'larm') g.fillRect(9, 26, 9, 28);
      else if (k === 'rarm') g.fillRect(38, 26, 9, 28);
      else if (k === 'lleg') g.fillRect(18, 56, 10, 30);
      else if (k === 'rleg') g.fillRect(28, 56, 10, 30);
      g.globalAlpha = 1;
    }
  }

  /** 肺。呼吸の速さと深さ、息を止めている状態が見える。 */
  function drawLungs(p) {
    if (!lungCtx) return;
    const g = lungCtx, W = 76, H = 46;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(190,170,130,0.22)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    const amp = 0.5 + 0.5 * Math.sin(p.breath * TAU);
    const openness = p.holding ? 0.12 : 0.35 + amp * 0.65;
    const oxy = p.oxygen / 100;
    const hue = p.holding ? lerp(0, 40, oxy) : 348;
    const sat = p.holding ? 90 : 46;
    const light = p.holding ? lerp(34, 52, oxy) : 40 + openness * 14;

    // 気管
    g.strokeStyle = '#9a8f80';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(W / 2, 5); g.lineTo(W / 2, 16); g.stroke();
    g.beginPath(); g.moveTo(W / 2, 16); g.lineTo(W / 2 - 9, 22); g.moveTo(W / 2, 16); g.lineTo(W / 2 + 9, 22); g.stroke();

    // 左右の肺
    for (const s of [-1, 1]) {
      const w = (9 + openness * 8);
      const h = (12 + openness * 6);
      const cx = W / 2 + s * (11 + openness * 3);
      const cy = 29;
      g.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
      g.beginPath();
      g.moveTo(cx - s * w * 0.2, cy - h);
      g.quadraticCurveTo(cx + s * w, cy - h * 0.5, cx + s * w * 0.9, cy + h * 0.7);
      g.quadraticCurveTo(cx + s * w * 0.2, cy + h, cx - s * w * 0.35, cy + h * 0.55);
      g.quadraticCurveTo(cx - s * w * 0.5, cy - h * 0.4, cx - s * w * 0.2, cy - h);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 1.2;
      g.stroke();
    }

    // 息を止めているあいだの警告
    if (p.holding) {
      g.fillStyle = `rgba(255,90,70,${0.25 + (1 - oxy) * 0.6})`;
      g.fillRect(1, 1, W - 2, H - 2);
      g.fillStyle = '#ffe2c0';
      g.font = 'bold 10px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('息を止めている', W / 2, H - 5);
    } else if (p.breathRate > 2.2) {
      g.fillStyle = 'rgba(255,120,90,0.16)';
      g.fillRect(1, 1, W - 2, H - 2);
    }
  }

  function updateHud() {
    const p = player;
    if (!p || !HUD['hp-fill']) return;
    HUD['hp-fill'].style.width = (p.hp / p.maxHp * 100) + '%';
    HUD['hp-text'].textContent = Math.max(0, Math.round(p.hp));
    HUD['san-fill'].style.width = (p.sanity / p.maxSanity * 100) + '%';
    HUD['san-text'].textContent = Math.round(p.sanity);
    HUD['bat-fill'].style.width = (p.battery / p.maxBattery * 100) + '%';
    HUD['bat-text'].textContent = Math.round(p.battery);
    HUD['stam-fill'].style.width = p.stamina + '%';
    HUD['inv-bandage'].textContent = p.bandages;
    HUD['inv-sedative'].textContent = p.sedatives;
    if (HUD['oxy-fill']) {
      HUD['oxy-fill'].style.width = p.oxygen + '%';
      HUD['oxy-fill'].classList.toggle('low', p.oxygen < 35);
    }
    drawBodyMap(p);
    drawLungs(p);

    const cd = Math.max(0, p.abilityCd);
    HUD['ability-cd'].textContent = cd > 0 ? cd.toFixed(1) : 'READY';
    HUD['ability-cd'].classList.toggle('ready', cd <= 0);
    HUD['ability-name'].textContent = p.char.ability.name;

    const low = p.battery < BATTERY_LOW;
    HUD['bat-fill'].classList.toggle('low', low);
    HUD['hp-fill'].classList.toggle('low', p.hp < p.maxHp * 0.3);
    HUD['san-fill'].classList.toggle('low', p.sanity < 35);

    if (map.arena && boss) {
      HUD['hud-objective'].innerHTML = `マザー <b>${Math.max(0, Math.round(boss.hp / boss.maxHp * 100))}%</b> ／ ブレーカー <b>${map.breakers.filter((b) => b.on).length}/4</b>${boss.heartOpen > 0 ? ' <em class="hot">炉心 露出中</em>' : ''}`;
    } else if (map.def.mode === 'mission') {
      const m = currentMission();
      HUD['hud-objective'].innerHTML = m
        ? `📋 ${m.label} <b>${m.done}/${m.need}</b>`
        : `<b class="hot">${map.def.exitName}へ向かえ</b>`;
    } else {
      const parts2 = [];
      if (map.def.goalCount) parts2.push(`${map.def.goalIcon} ${map.def.goalItem} <b>${p.goals}/${map.def.goalCount}</b>`);
      if (map.def.grabpack) parts2.push(p.hasGrab ? '🧤 <b>装着済</b>' : '🧤 <b>未入手</b>');
      HUD['hud-objective'].innerHTML = objectiveComplete()
        ? `<b class="hot">${map.def.exitName}へ向かえ</b>`
        : parts2.join('　');
    }
    const rk = player ? roomKindAt(Math.floor(player.x / TILE), Math.floor(player.y / TILE)) : null;
    const roomName = rk && ROOM_LABELS[rk] ? '　― ' + ROOM_LABELS[rk] : '';
    HUD['hud-floor'].textContent = (map.def.chapter ? 'CH.' + map.def.chapter + '　' : '') + map.def.name + roomName;

    const t = HUD['toast'];
    if (t) {
      t.textContent = toastText;
      t.classList.toggle('show', toastT > 0);
    }
  }

  // ============================================================
  //  ボスの台詞
  //  1行ずつキューに積み、画面下の字幕として順に出す。
  // ============================================================
  const dlg = { q: [], name: '', text: '', color: '#fff', t: 0 };

  function pushLine(name, text, color, dur, voice) {
    if (dlg.q.length > 6) return;
    dlg.q.push({ name, text, color, voice, dur: dur || Math.max(1.7, text.length * 0.115) });
  }
  /** key の台詞を出す。all=true なら全行、false ならその中の1行。 */
  function bossSay(key, all) {
    if (!stalker) return;
    const lines = stalker.def.lines[key];
    if (!lines || !lines.length) return;
    if (all) for (const t of lines) pushLine(stalker.def.name, t, stalker.def.color);
    else pushLine(stalker.def.name, lines[rndInt(0, lines.length - 1)], stalker.def.color);
  }
  function updateDialogue(dt) {
    if (dlg.t > 0) {
      dlg.t -= dt;
      if (dlg.t <= 0) dlg.text = '';
      return;
    }
    if (dlg.q.length) {
      const l = dlg.q.shift();
      dlg.name = l.name; dlg.text = l.text; dlg.color = l.color; dlg.t = l.dur;
      Audio2.sfx.voice(l.voice || (stalker ? stalker.def.voice : 170), l.text.length);
    }
  }
  function renderDialogue() {
    const el = $('boss-line');
    if (!el) return;
    if (!dlg.text) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.style.borderLeftColor = dlg.color;
    el.innerHTML = `<b style="color:${dlg.color}">${dlg.name}</b><span>${dlg.text}</span>`;
  }

  // ============================================================
  //  チャプターボス(倒せない追手 / 仕事を言いつける監督)
  // ============================================================
  let stalker = null;
  let gasClouds = [];

  function spawnStalker(defId) {
    const def = CHAPTER_BOSSES[defId];
    if (!def) { stalker = null; return; }
    // 開始地点から最も遠い部屋に出す
    let best = map.rooms[map.rooms.length - 1], bd = -1;
    for (const r of map.rooms) {
      const d = dist2(r.cx * TILE, r.cy * TILE, map.spawn.x, map.spawn.y);
      if (d > bd) { bd = d; best = r; }
    }
    const p = findOpen(map, best, 34);
    stalker = {
      def, x: p.x, y: p.y, r: def.r, angle: 0,
      mode: def.mode, state: 'hunt', speed: map.def.stalkSpeed || 70,
      target: { x: p.x, y: p.y }, senseT: 3.0, stagger: 0, atkCd: 0,
      anim: rnd(10), dazzle: 0, hitFlash: 0, lineCd: 6, gasT: 3, seen: false, rage: 0,
    };
    if (def.mode === 'mission') {
      // マリオネットは動かない。プライズコーナーの主として居座る。
      stalker.home = { x: p.x, y: p.y };
      addLamp(p.x, p.y, 210, def.color, 0.4);
    }
    bossSay('intro', true);
  }

  function updateStalker(dt) {
    if (!stalker) return;
    const s = stalker;
    s.anim += dt;
    if (s.hitFlash > 0) s.hitFlash -= dt;
    if (s.atkCd > 0) s.atkCd -= dt;
    if (s.lineCd > 0) s.lineCd -= dt;

    // 集束光を浴びるとひるむ(どのチャプターでも唯一の対抗手段)
    if (player.focus) {
      const d = dist(s.x, s.y, player.x, player.y);
      if (d < player.lightRangeNow && angDiff(Math.atan2(s.y - player.y, s.x - player.x), player.aim) < player.lightArcNow * 1.2
        && losClear(player.x, player.y, s.x, s.y)) {
        s.dazzle += dt * 1.4 * (1 + 0.7 * modLv('mirror'));
        if (s.dazzle > 1) {
          s.dazzle = 0;
          s.stagger = s.def.staggerLight;
          s.hitFlash = 0.3;
          burst(s.x, s.y, 14, '#fff3c4', 150, 0.4);
          if (s.lineCd <= 0) { bossSay('hit'); s.lineCd = 5; }
        }
      }
    }

    if (s.mode === 'mission') { updateMarionette(dt); return; }

    if (s.stagger > 0) { s.stagger -= dt; return; }

    const d = dist(s.x, s.y, player.x, player.y);
    // 変装していても、章のボスは近づけば匂いで気づく
    const sightR = disguised(player) ? 130 : (player.char.suitStealth ? 400 : 520);
    const canSee = d < sightR && losClear(s.x, s.y, player.x, player.y);

    // 定期的に「気配」を掴む。完全には撒けない。
    s.senseT -= dt;
    if (canSee) {
      s.target = { x: player.x, y: player.y };
      if (!s.seen) { s.seen = true; if (s.lineCd <= 0) { bossSay('spot'); s.lineCd = 6; } }
      s.senseT = 2.4;
    } else {
      if (s.seen) { s.seen = false; if (s.lineCd <= 0) { bossSay('lost'); s.lineCd = 8; } }
      if (s.senseT <= 0) {
        s.senseT = rnd(3.4, 6.2);
        // ぼんやりした方向しか分からない
        s.target = { x: player.x + rnd(-220, 220), y: player.y + rnd(-220, 220) };
      }
    }

    // 目標を集めるほど速くなる
    const prog = map.def.goalCount ? player.goals / map.def.goalCount : 0;
    const spd = s.speed * (1 + prog * 0.30 + s.rage * 0.2);
    stepToward(s, s.target.x, s.target.y, spd, dt);

    // 接触
    if (d < s.r + player.r + 4 && s.atkCd <= 0) {
      s.atkCd = 1.6;
      hurtPlayer(s.def.dmg, s.x, s.y);
      Audio2.sfx.roar(); Audio2.sfx.stinger();
      fx.stinger = 1; shake(20, 0.6);
      player.sanity -= 12;
      s.stagger = 0.9;
    }

    // 赤い静電ガス(マングルド)
    if (s.def.gas) {
      s.gasT -= dt;
      if (s.gasT <= 0) {
        s.gasT = rnd(3.2, 5.4);
        gasClouds.push({ x: s.x, y: s.y, r: 12, max: rnd(90, 140), life: 11, t: 0 });
        Audio2.sfx.whisper();
      }
    }
  }

  /** プライズ係のマリオネット。動かず、催促だけしてくる。 */
  function updateMarionette(dt) {
    const s = stalker;
    s.angle = lerp2Angle(s.angle, Math.atan2(player.y - s.y, player.x - s.x), dt * 2);
    if (map.missionsDone) return;
    s.lineCd -= dt * 0;   // lineCd は共通処理で減っている
    s.idleT = (s.idleT || 40) - dt;
    if (s.idleT <= 0) {
      s.idleT = rnd(34, 52);
      bossSay('idle');
      // 催促のたびに手が増える
      const r = pick(map.rooms);
      const p = findOpen(map, r, 20);
      if (dist(p.x, p.y, player.x, player.y) > 260) {
        const e = spawnEnemy(pick(['endo', 'fox', 'chick']), p.x, p.y, r);
        e.state = 'search'; e.lastSeen = { x: player.x, y: player.y }; e.searchT = 10;
      }
    }
  }

  function updateGas(dt) {
    for (let i = gasClouds.length - 1; i >= 0; i--) {
      const g = gasClouds[i];
      g.t += dt; g.life -= dt;
      g.r = lerp(g.r, g.max, dt * 1.2);
      if (g.life <= 0) { gasClouds.splice(i, 1); continue; }
      if (dist2(g.x, g.y, player.x, player.y) < g.r * g.r) {
        player.sanity = Math.max(0, player.sanity - 7 * dt * DIFFS[run.diff].sanity);
        player.gasT = 0.4;
      }
    }
  }

  // ============================================================
  //  グラップパック(チャプター1で手に入る鉤縄グローブ)
  // ============================================================
  const GRAB_SPEED = 1250, GRAB_MAX = 340, GRAB_PULL = 900, GRAB_CD = 1.15;

  function fireGrab(p) {
    if (!p.hasGrab || p.grabCd > 0 || p.grabHand) return;
    p.grabCd = GRAB_CD;
    p.grabHand = { x: p.x, y: p.y, a: p.aim, state: 'out', hit: null, t: 0 };
    Audio2.sfx.throw();
    emitNoise(p.x, p.y, 150);
  }

  function updateGrab(dt) {
    const p = player;
    if (p.grabCd > 0) p.grabCd -= dt;
    const g = p.grabHand;
    if (!g) return;
    g.t += dt;

    if (g.state === 'out') {
      const step = GRAB_SPEED * dt;
      g.x += Math.cos(g.a) * step;
      g.y += Math.sin(g.a) * step;
      // 敵に当たった
      for (const e of enemies) {
        if (e.dead || e.phantom) continue;
        if (dist2(g.x, g.y, e.x, e.y) < (e.r + 12) * (e.r + 12)) {
          g.state = 'reel'; g.hit = e;
          stunEnemy(e, 1.6);
          Audio2.sfx.metal();
          return;
        }
      }
      // 落ちているものに当たった
      for (const it of items) {
        if (dist2(g.x, g.y, it.x, it.y) < 26 * 26) { g.state = 'item'; g.hit = it; Audio2.sfx.click(); return; }
      }
      // 壁・遮蔽物に刺さった
      if (isSolidPx(g.x, g.y) || overlapsProp(g.x, g.y, 6)) {
        g.state = 'anchor';
        Audio2.sfx.metal();
        return;
      }
      if (dist(g.x, g.y, p.x, p.y) > GRAB_MAX) g.state = 'back';
    } else if (g.state === 'reel') {
      const e = g.hit;
      if (!e || e.dead) { g.state = 'back'; return; }
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      const nx = e.x + Math.cos(a) * GRAB_PULL * dt, ny = e.y + Math.sin(a) * GRAB_PULL * dt;
      if (!blockedAt(nx, ny, e.r)) { e.x = nx; e.y = ny; }
      g.x = e.x; g.y = e.y;
      e.stun = Math.max(e.stun, 0.4);
      if (dist(e.x, e.y, p.x, p.y) < 46 || g.t > 1.2) {
        hurtEnemy(e, 14 * (1 + 0.28 * modLv('grip')), Math.atan2(e.y - p.y, e.x - p.x), 0, 1.0);
        g.state = 'back';
      }
    } else if (g.state === 'item') {
      const it = g.hit;
      if (!it || items.indexOf(it) < 0) { g.state = 'back'; return; }
      const a = Math.atan2(p.y - it.y, p.x - it.x);
      it.x += Math.cos(a) * GRAB_PULL * dt;
      it.y += Math.sin(a) * GRAB_PULL * dt;
      g.x = it.x; g.y = it.y;
      if (dist(it.x, it.y, p.x, p.y) < 24 || g.t > 1.4) g.state = 'back';
    } else if (g.state === 'anchor') {
      // 自分を引き寄せる
      const a = Math.atan2(g.y - p.y, g.x - p.x);
      moveEnt(p, Math.cos(a) * GRAB_PULL * 0.78 * dt, Math.sin(a) * GRAB_PULL * 0.78 * dt, p.r);
      dust(p.x, p.y, 1, 'rgba(200,200,190,0.5)');
      if (dist(g.x, g.y, p.x, p.y) < 42 || g.t > 1.3) g.state = 'back';
    } else { // back
      const a = Math.atan2(p.y - g.y, p.x - g.x);
      g.x += Math.cos(a) * GRAB_SPEED * dt;
      g.y += Math.sin(a) * GRAB_SPEED * dt;
      if (dist(g.x, g.y, p.x, p.y) < 22 || g.t > 2.6) p.grabHand = null;
    }
  }
  // ============================================================
  //  チャプター2のミッション
  // ============================================================
  function setupMissions() {
    map.missions = [
      { id: 'windbox', label: 'オルゴールのぜんまいを 3 台 巻き直す', need: 3, done: 0 },
      { id: 'cull', label: `壊れた個体(海賊ギツネ)を 4 体 ${isSuit(player.char) ? '追い払う' : '廃棄する'}`, need: 4, done: 0 },
      { id: 'mask', label: 'マリオネットの「顔」を回収して手渡す', need: 1, done: 0 },
    ];
    map.missionIdx = 0;
    map.missionsDone = false;
    startMission(0);
  }

  function startMission(i) {
    const m = map.missions[i];
    if (!m) return;
    bossSay('m' + i, true);
    if (m.id === 'windbox') {
      for (let k = 0; k < m.need; k++) {
        const r = map.rooms[rndInt(1, map.rooms.length - 1)];
        const p = findOpen(map, r, 24);
        addProp('windbox', p.x - 20, p.y - 20, 40, 40, { usable: true, occlude: false, turned: false });
      }
    } else if (m.id === 'cull') {
      // 対象が足りなければ足す
      let n = enemies.filter((e) => e.kind === 'fox' && !e.dead).length;
      while (n < m.need + 1) {
        const r = map.rooms[rndInt(1, map.rooms.length - 1)];
        const p = findOpen(map, r, 20);
        if (dist(p.x, p.y, player.x, player.y) > 300) { spawnEnemy('fox', p.x, p.y, r); n++; }
      }
    } else if (m.id === 'mask') {
      const party = map.rooms.filter((r) => r.kind === 'party');
      const r = party.length ? pick(party) : map.rooms[rndInt(1, map.rooms.length - 1)];
      const p = findOpen(map, r, 20);
      items.push({ type: 'mask', x: p.x, y: p.y, t: 0 });
    }
    toast('指示: ' + m.label);
  }

  function currentMission() {
    if (!map.missions || map.missionsDone) return null;
    return map.missions[map.missionIdx] || null;
  }

  function missionProgress(id, n) {
    const m = currentMission();
    if (!m || m.id !== id) return;
    m.done = Math.min(m.need, m.done + n);
    addFloat(`${m.done}/${m.need}`, player.x, player.y - 26, '#8ae6b8');
    if (m.done >= m.need) {
      bossSay('done' + map.missionIdx, true);
      Audio2.sfx.power();
      map.missionIdx++;
      if (map.missionIdx >= map.missions.length) {
        map.missionsDone = true;
        bossSay('finish', true);
        fx.flash = 0.4;
        toast('封鎖扉が開いた');
      } else {
        startMission(map.missionIdx);
      }
    }
  }

  /** チャプターの脱出条件を満たしたか。 */
  function objectiveComplete() {
    if (!map || map.arena) return false;
    if (map.def.mode === 'mission') return !!map.missionsDone;
    if (map.def.grabpack && !player.hasGrab) return false;
    return player.goals >= map.def.goalCount;
  }

  // ============================================================
  //  オープニング ― 閉店した店に入るまで
  //  4カットの短いムービー。台詞は選んだキャラクターごとに変わる。
  // ============================================================
  const CUT_SHOTS = [5.6, 5.0, 5.8, 3.8];

  const CUT_LINES = {
    guard: [
      '……無線が切れた。定時連絡も通らない。',
      'この搬入口は、俺が先週この手で施錠した。',
      'なら、中で動いているのは 何だ。',
      '確認する。それが 俺の仕事だ。',
    ],
    inspector: [
      '十二年ぶり。門の錆だけ、あの頃のまま。',
      'わたしがはじいた子たちは、どこへ行ったんだろう。',
      'ずっと、知らないふりをしてきた。',
      '……ごめんね。今日は ちゃんと見るから。',
    ],
    streamer: [
      'はい、というわけで来ちゃいました、廃ピザ屋〜。',
      '同時接続 3人。まあいいや、回そ。',
      '……ねえ待って。電気、ついてない？',
      'これ絶対バズる。行きます。',
    ],
    mechanic: [
      '配電盤はB1。図面は頭に入ってる。十年前の版だけどな。',
      '母さんの手紙は、まだ捨てられずにいる。',
      '「地下で見たものを、誰にも話してはいけません」',
      '何を見たのか、結局 聞けなかった。',
    ],
    artisan: [
      'ただいま。',
      'この看板、わたしが塗ったの。緑がよく乗るからって。',
      'みんな、まだ 起きてるの？',
      '今日は、ちゃんと お別れを言いにきたのよ。',
    ],
    springtrap: [
      'この着ぐるみは、裏の棚に畳んで置いてあった。',
      '袖を通すと、内側の骨がかちりと噛み合う音がした。',
      '……不思議と、怖くない。あいつらと同じ匂いがするからだ。',
      '目を合わせて、追い返してやる。それだけでいい。',
    ],
    goldbear: [
      '初代マスコット。写真のまんなかには、いつもこれがいた。',
      '中に誰が入っていたのか、社員名簿には残っていない。',
      'かぶってみて分かった。視界の穴が、ふたつしかない。',
      'この顔なら、あの子たちも足を止めるだろう。',
    ],
  };
  const CUT_VOICE = { guard: 128, inspector: 208, streamer: 252, mechanic: 158, artisan: 226, springtrap: 112, goldbear: 96 };

  const cut = { t: 0, shot: 0, lines: [], lock: 0 };

  function startCutscene() {
    cut.t = 0; cut.shot = 0; cut.lock = 0.6;
    cut.lines = CUT_LINES[run.charId] || CUT_LINES.guard;
    dlg.q.length = 0; dlg.text = ''; dlg.t = 0;
    fx.letter = 1;
    Audio2.startAmbience();
    Audio2.setTension(0.15);
    setState('cut');
    cutLine(0);
  }

  function cutLine(i) {
    const c = CHARS.find((x) => x.id === run.charId) || CHARS[0];
    const txt = cut.lines[i];
    if (txt) pushLine(c.name, txt, c.color, CUT_SHOTS[i] - 0.9, CUT_VOICE[c.id]);
  }

  function endCutscene() {
    dlg.q.length = 0; dlg.text = ''; dlg.t = 0;
    startFloor();
  }

  function updateCutscene(dt) {
    cut.t += dt;
    if (cut.lock > 0) cut.lock -= dt;
    updateDialogue(dt);
    // どれか押されたら飛ばす
    if (cut.lock <= 0) {
      let any = mouse.down || touch.attack;
      for (const k in pressed) { if (pressed[k]) { any = true; break; } }
      if (any) { endCutscene(); return; }
    }
    if (cut.t >= CUT_SHOTS[cut.shot]) {
      cut.t = 0;
      cut.shot++;
      if (cut.shot >= CUT_SHOTS.length) { endCutscene(); return; }
      cutLine(cut.shot);
      Audio2.setTension(0.15 + cut.shot * 0.2);
    }
  }

  function drawCutscene() {
    const k = clamp(cut.t / CUT_SHOTS[cut.shot], 0, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (cut.shot === 0) cutExterior(k);
    else if (cut.shot === 1) cutGate(k);
    else if (cut.shot === 2) cutInside(k);
    else cutTitle(k);

    // カット間のフェード
    const fade = Math.max(0, 1 - k * 6) * 0.9 + Math.max(0, (k - 0.88) / 0.12) * 0.9;
    if (fade > 0.01) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // レターボックス
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, 52);
    ctx.fillRect(0, VIEW_H - 52, VIEW_W, 52);
    // グレイン
    if (grainCv) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      const ox = Math.floor(Math.random() * 160), oy = Math.floor(Math.random() * 160);
      for (let x = -ox; x < VIEW_W; x += 160) for (let y = -oy; y < VIEW_H; y += 160) ctx.drawImage(grainCv, x, y);
      ctx.restore();
    }
    // スキップ表示
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#cfc7b6';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('クリック / キーで スキップ', VIEW_W - 22, VIEW_H - 20);
    ctx.restore();
  }

  /** 雨の線。どのカットでも上に重ねる。 */
  function cutRain(n, speed) {
    ctx.save();
    ctx.strokeStyle = 'rgba(180,200,220,0.20)';
    ctx.lineWidth = 1;
    const t = now() / 1000;
    for (let i = 0; i < n; i++) {
      const x = ((i * 137.7 + t * 60) % (VIEW_W + 120)) - 60;
      const y = ((i * 91.3 + t * speed) % (VIEW_H + 120)) - 60;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 16);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** カット1: 夜の閉店した店を見上げる。 */
  function cutExterior(k) {
    const pan = k * 46;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#0a1018');
    g.addColorStop(0.55, '#131a22');
    g.addColorStop(1, '#080a0c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // 月
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const mg = ctx.createRadialGradient(760 - pan * 0.3, 130, 4, 760 - pan * 0.3, 130, 160);
    mg.addColorStop(0, 'rgba(220,230,255,0.55)');
    mg.addColorStop(1, 'rgba(160,180,220,0)');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(760 - pan * 0.3, 130, 160, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#c9d4e6';
    ctx.beginPath(); ctx.arc(760 - pan * 0.3, 130, 26, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(-pan, 0);
    // 本体(平屋のファミリーレストラン)
    ctx.fillStyle = '#111519';
    ctx.fillRect(200, 300, 560, 200);
    // 赤白ストライプの日除け
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = (i % 2) ? '#3a1418' : '#20262c';
      ctx.beginPath();
      ctx.moveTo(200 + i * 40, 300); ctx.lineTo(200 + (i + 1) * 40, 300);
      ctx.lineTo(200 + (i + 1) * 40 - 10, 272); ctx.lineTo(200 + i * 40 - 10, 272);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#111519';
    ctx.fillRect(190, 258, 580, 16);
    // 屋上の巨大なクマの立像。首から上だけが残っている。
    ctx.fillStyle = '#171b20';
    ctx.beginPath(); ctx.arc(620, 214, 44, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(588, 176, 18, 0, TAU); ctx.arc(652, 176, 18, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a0c10';
    ctx.beginPath(); ctx.arc(604, 206, 8, 0, TAU); ctx.arc(636, 206, 8, 0, TAU); ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const eg2 = ctx.createRadialGradient(636, 206, 0, 636, 206, 26);
    eg2.addColorStop(0, 'rgba(255,90,60,0.75)');
    eg2.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.fillStyle = eg2;
    ctx.beginPath(); ctx.arc(636, 206, 26, 0, TAU); ctx.fill();
    ctx.restore();
    // 窓(ほとんど割れている。ひとつだけ灯っている)
    for (let i = 0; i < 12; i++) {
      const wx = 224 + (i % 6) * 88, wy = 330 + Math.floor(i / 6) * 74;
      const on = i === 7;
      ctx.fillStyle = on ? 'rgba(255,190,90,0.85)' : 'rgba(30,38,46,0.9)';
      ctx.fillRect(wx, wy, 54, 44);
      if (on) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const wg = ctx.createRadialGradient(wx + 27, wy + 22, 2, wx + 27, wy + 22, 120);
        wg.addColorStop(0, 'rgba(255,180,80,0.45)');
        wg.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = wg;
        ctx.beginPath(); ctx.arc(wx + 27, wy + 22, 120, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(10,12,16,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(wx + 27, wy); ctx.lineTo(wx + 27, wy + 44);
      ctx.moveTo(wx, wy + 22); ctx.lineTo(wx + 54, wy + 22);
      ctx.stroke();
    }
    // 看板
    ctx.fillStyle = '#1b2028';
    ctx.fillRect(300, 190, 190, 62);
    ctx.strokeStyle = '#2e3742'; ctx.lineWidth = 3;
    ctx.strokeRect(300, 190, 190, 62);
    const flick = (Math.sin(now() / 90) > 0.2) ? 1 : 0.25;
    ctx.fillStyle = `rgba(230,120,110,${0.85 * flick})`;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("HOLLOW BEAR'S", 395, 214);
    ctx.fillStyle = `rgba(224,196,120,${0.85 * flick})`;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText('PIZZERIA', 395, 240);
    ctx.restore();

    // 手前のフェンス
    ctx.save();
    ctx.strokeStyle = 'rgba(8,10,12,0.95)';
    ctx.lineWidth = 3;
    for (let x = -20; x < VIEW_W + 40; x += 22) {
      ctx.beginPath(); ctx.moveTo(x, 470); ctx.lineTo(x + 10, VIEW_H); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, 494); ctx.lineTo(VIEW_W, 486); ctx.stroke();
    ctx.restore();
    cutRain(90, 520);
  }

  /** カット2: 搬入口のシャッターと、そこに立つ影。 */
  function cutGate(k) {
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const gap = 26 + k * 34;
    // シャッター
    ctx.save();
    for (let y = 60; y < VIEW_H - gap - 40; y += 16) {
      const shade = 22 + ((y / 16) % 2) * 8;
      ctx.fillStyle = `rgb(${shade + 9},${shade + 4},${shade})`;
      ctx.fillRect(180, y, 600, 14);
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(180, y + 12, 600, 3);
    }
    // 錆
    for (let i = 0; i < 40; i++) {
      const rx = 180 + ((i * 137) % 600), ry = 60 + ((i * 211) % (VIEW_H - gap - 120));
      ctx.fillStyle = `rgba(${110 + (i % 5) * 10},${52 + (i % 3) * 8},22,0.13)`;
      ctx.fillRect(rx, ry, 18 + (i % 4) * 10, 10 + (i % 3) * 8);
    }
    ctx.restore();
    // 枠
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, 180, VIEW_H);
    ctx.fillRect(780, 0, VIEW_W - 780, VIEW_H);
    // 下の隙間からもれる光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createLinearGradient(0, VIEW_H - gap - 40, 0, VIEW_H - gap + 10);
    lg.addColorStop(0, 'rgba(255,180,90,0)');
    lg.addColorStop(1, `rgba(255,170,80,${0.20 + k * 0.25})`);
    ctx.fillStyle = lg;
    ctx.fillRect(180, VIEW_H - gap - 40, 600, 50);
    ctx.restore();

    // 懐中電灯を持った後ろ姿
    const c = CHARS.find((x) => x.id === run.charId) || CHARS[0];
    const px = 480, py = VIEW_H - 66;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createRadialGradient(px + 26, py - 26, 0, px + 26, py - 26, 300);
    beam.addColorStop(0, `rgba(255,240,200,${0.16 + k * 0.12})`);
    beam.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.beginPath();
    ctx.moveTo(px + 26, py - 26);
    ctx.arc(px + 26, py - 26, 320, -1.75, -1.05);
    ctx.closePath();
    ctx.fillStyle = beam;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#05060a';
    ctx.beginPath(); ctx.ellipse(px, py, 30, 44, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py - 50, 20, 0, TAU); ctx.fill();
    ctx.fillStyle = c.color;
    ctx.globalAlpha = 0.28;
    ctx.beginPath(); ctx.ellipse(px, py + 8, 22, 30, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e6e2d2';
    ctx.fillRect(px + 20, py - 34, 16, 8);
    cutRain(60, 480);
  }

  /** カット3: 中へ。暗がりで目がひとつずつ灯る。 */
  function cutInside(k) {
    ctx.fillStyle = '#07080b';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const zoom = 1 + k * 0.12;
    ctx.save();
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-VIEW_W / 2, -VIEW_H / 2);

    // 床
    ctx.fillStyle = '#14171b';
    ctx.fillRect(0, 330, VIEW_W, VIEW_H - 330);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < VIEW_W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 330); ctx.lineTo(x - 60, VIEW_H); ctx.stroke(); }
    // 白黒チェックの床
    for (let ty = 330; ty < VIEW_H; ty += 30) {
      for (let tx = -30; tx < VIEW_W; tx += 60) {
        ctx.fillStyle = 'rgba(255,255,255,0.028)';
        ctx.fillRect(tx + (((ty / 30) | 0) % 2) * 30, ty, 30, 30);
      }
    }
    // ステージと緞帳
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(300, 190, 360, 150);
    ctx.fillStyle = '#16101a';
    for (let i = 0; i < 14; i++) ctx.fillRect(304 + i * 26, 190, 14, 60);
    // 客席の丸テーブル
    ctx.fillStyle = '#111419';
    for (const [tx, ty, r] of [[180, 400, 40], [480, 430, 46], [790, 400, 40]]) {
      ctx.beginPath(); ctx.ellipse(tx, ty, r, r * 0.42, 0, 0, TAU); ctx.fill();
    }
    // 天井から下がった風船の影
    for (let i = 0; i < 7; i++) {
      const x = 150 + i * 110;
      ctx.strokeStyle = 'rgba(120,120,110,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, 150 + (i % 3) * 22); ctx.stroke();
      ctx.fillStyle = '#0c0e12';
      ctx.beginPath(); ctx.ellipse(x, 162 + (i % 3) * 22, 13, 16, 0, 0, TAU); ctx.fill();
    }

    // 走査するライト
    const ang = -0.35 + k * 0.7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bx = VIEW_W / 2, by = VIEW_H + 40;
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, 620);
    bg.addColorStop(0, 'rgba(255,240,200,0.20)');
    bg.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.arc(bx, by, 640, -Math.PI / 2 + ang - 0.22, -Math.PI / 2 + ang + 0.22);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();

    // アニマトロニクスの影と、順に灯る目
    const eyes = [[128, 300, 26], [318, 262, 20], [512, 246, 30], [700, 268, 22], [858, 300, 26], [232, 402, 18], [636, 396, 24]];
    for (let i = 0; i < eyes.length; i++) {
      if (k <= 0.22 + i * 0.09) continue;
      const [ex, ey, r] = eyes[i];
      ctx.fillStyle = '#05060a';
      ctx.beginPath();
      ctx.ellipse(ex, ey + r * 0.9, r * 0.95, r * 1.1, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.62, 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < eyes.length; i++) {
      const on = k > 0.22 + i * 0.09;
      if (!on) continue;
      const a = clamp((k - (0.22 + i * 0.09)) * 6, 0, 1);
      const r = eyes[i][2];
      for (const s of [-1, 1]) {
        const ex = eyes[i][0] + s * r * 0.3, ey = eyes[i][1];
        const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 8);
        eg.addColorStop(0, `rgba(255,90,60,${0.95 * a})`);
        eg.addColorStop(0.35, `rgba(255,60,40,${0.5 * a})`);
        eg.addColorStop(1, 'rgba(255,40,20,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(ex, ey, 8, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    ctx.restore();
  }

  /** カット4: タイトル。 */
  function cutTitle(k) {
    ctx.fillStyle = '#040506';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const a1 = clamp(k * 3, 0, 1) * clamp((1 - k) * 3, 0, 1);
    ctx.save();
    ctx.globalAlpha = a1;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#efe6d2';
    ctx.font = 'bold 66px system-ui, sans-serif';
    ctx.fillText('HOLLOW TOYS', VIEW_W / 2, VIEW_H / 2 - 6);
    ctx.font = '14px "Hiragino Sans", system-ui, sans-serif';
    ctx.fillStyle = '#b9ae97';
    ctx.fillText('閉 店 し た ピ ザ 店 の 夜', VIEW_W / 2, VIEW_H / 2 + 28);
    ctx.restore();
    if (k > 0.55) {
      ctx.save();
      ctx.globalAlpha = clamp((k - 0.55) * 4, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8a6224';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('C H A P T E R   1', VIEW_W / 2, VIEW_H / 2 + 74);
      ctx.fillStyle = '#ece2cc';
      ctx.font = 'bold 22px "Hiragino Sans", system-ui, sans-serif';
      ctx.fillText(FLOORS[0].name, VIEW_W / 2, VIEW_H / 2 + 104);
      ctx.restore();
    }
  }

  // ============================================================
  //  進行(ラン)の制御
  // ============================================================
  const ARENA_INTRO = {
    intro: ['隔壁の向こうは、炉の熱でぬるかった。', '天井まで届く影が、ゆっくりとこちらを向く。', '― 全長 4.2m。製品名 MOTHER。'],
    goalDesc: '四隅のブレーカーを4基すべて上げ、開いた炉心を叩く。',
  };


  function startRun() {
    run.charId = selectedChar;
    run.floorIdx = 0;
    run.mods = {};
    run.notes = [];
    run.seed = (Math.random() * 1e9) | 0;
    run.stats = { time: 0, floorName: '' };
    player = makePlayer(run.charId);
    gameT = 0;
    startCutscene();     // 店に入るまでのムービー。終わると startFloor へ。
  }

  function startFloor() {
    const fi = run.floorIdx;
    if (fi < FLOORS.length) {
      genFloor(fi);
    } else {
      genArena();
      map.def.intro = ARENA_INTRO.intro;
      map.def.goalDesc = ARENA_INTRO.goalDesc;
      map.def.goalCount = 0; map.def.goalItem = '―'; map.def.goalIcon = '';
      spawnBoss();
    }
    player.x = map.spawn.x; player.y = map.spawn.y;
    player.goals = 0;
    player.hiding = null;
    player.hasMask = false; player.grabHand = null; player.grabCd = 0; player.gasT = 0;
    player.invuln = 2.0;
    player.sanity = Math.min(player.maxSanity, player.sanity + 25);
    player.battery = Math.min(player.maxBattery, player.battery + 35);
    player.aim = lookYaw;
    fpc.x = player.x; fpc.y = player.y; fpc.yaw = lookYaw; fpc.bob = 0;
    fpc.eye = isCrouching() ? EYE_CROUCH : EYE_STAND;
    buildFpTextures();
    fx.letter = 1;
    showBriefing(map.def);
  }

  /** 目標アイテムを揃えた瞬間、店が気づく。 */
  function onGoalComplete() {
    Audio2.sfx.roar();
    shake(10, 0.6);
    fx.flash = 0.3;
    for (const e of enemies) {
      if (e.dead) continue;
      e.lastSeen = { x: player.x, y: player.y };
      if (e.state !== 'chase') { e.state = 'search'; e.searchT = 10; }
    }
    // 増援
    const extra = Math.round(3 * DIFFS[run.diff].count);
    for (let i = 0; i < extra; i++) {
      const r = map.rooms[rndInt(0, map.rooms.length - 1)];
      const p = findOpen(map, r, 20);
      if (dist(p.x, p.y, player.x, player.y) < 300) continue;
      const kind = pick(Object.keys(map.def.mix));
      const e = spawnEnemy(kind, p.x, p.y, r);
      e.state = 'search'; e.lastSeen = { x: player.x, y: player.y }; e.searchT = 12;
    }
    // 照明が落ちる
    for (const L of lamps) if (chance(0.5)) L.broken = true;
  }

  function activateExit() {
    if (map.exit.active) return;
    map.exit.active = true;
    Audio2.sfx.elevator(); Audio2.sfx.power();
    fx.flash = 0.55; fx.letter = 1;
    shake(8, 0.6);
    toast(map.def.exitName + ' 起動 ― 上へ');
    player.invuln = 4;
    setTimeout(() => {
      if (state !== 'play') return;
      rollUpgrades();
      setState('safe');
    }, 1500);
  }

  function cleanupEnemies() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead && e.deadT > 16) enemies.splice(i, 1);
    }
  }

  /** 光の筋の中を漂う埃。 */
  function spawnBeamDust(dt) {
    const p = player;
    if (!p.lightOn || p.battery <= 0 || parts.length > MAX_PARTICLES - 40) return;
    if (!chance(dt * 26)) return;
    const d = rnd(40, p.lightRangeNow * 0.85);
    const a = p.aim + rnd(-p.lightArcNow, p.lightArcNow);
    const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    if (isSolidPx(x, y)) return;
    parts.push({
      x, y, vx: rnd(-6, 6), vy: rnd(-10, -2), life: rnd(1.2, 2.6), max: 2.6,
      c: 'rgba(255,240,205,0.55)', r: rnd(0.5, 1.3), g: -1.5, glow: true,
    });
  }

  // ============================================================
  //  更新と描画
  // ============================================================
  function update(dt) {
    updateDialogue(dt);
    updateLook(dt);
    updatePlayer(dt);
    if (player.dead) return;
    for (let i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt);
    if (boss) updateBoss(dt);
    if (stalker) updateStalker(dt);
    updateGas(dt);
    updateShots(dt);
    updateLamps(dt);
    updateParticles(dt);
    spawnBeamDust(dt);
    updateFpCamera(dt);
    updateViewSway(dt);
    decayFx(dt);
    fx.letter = Math.max(0, fx.letter - dt * 0.9);

    const R = Math.max(AMBIENT_R + 40, player.lightRangeNow) + 60;
    markSeen(player.x, player.y, Math.min(R, 340));
    cleanupEnemies();
    Audio2.ambientTick(now());
  }

  function drawTitleBackdrop() {
    const t = now() / 1000;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#0a0c10');
    g.addColorStop(1, '#040507');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // ゆっくり動く探照灯
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const a = Math.sin(t * 0.22) * 0.7 - Math.PI / 2;
    const px = VIEW_W * 0.5, py = VIEW_H * 1.15;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 900, a - 0.16, a + 0.16);
    ctx.closePath();
    const lg = ctx.createRadialGradient(px, py, 0, px, py, 900);
    lg.addColorStop(0, 'rgba(255,230,180,0.16)');
    lg.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.restore();
    // 埃
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) {
      const x = ((i * 137.5 + t * 12) % VIEW_W);
      const y = ((i * 79.3 + Math.sin(t * 0.3 + i) * 40) % VIEW_H);
      ctx.fillStyle = `rgba(255,240,210,${0.05 + (i % 5) * 0.012})`;
      ctx.beginPath(); ctx.arc(x, y, (i % 3) * 0.6 + 0.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (grainCv) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      const ox = Math.floor(Math.random() * 160), oy = Math.floor(Math.random() * 160);
      for (let x = -ox; x < VIEW_W; x += 160) for (let y = -oy; y < VIEW_H; y += 160) ctx.drawImage(grainCv, x, y);
      ctx.restore();
    }
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.25, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  /** 「クリックすると見まわせる」の案内。状態が変わったときだけ触る。 */
  let lockHintShown = null;
  function updateLockHint() {
    const want = state === 'play' && !pointerLocked && !touch.on;
    if (want === lockHintShown) return;
    lockHintShown = want;
    const el = $('lock-hint');
    if (el) el.classList.toggle('hidden', !want);
  }

  function render() {
    updateLockHint();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (state === 'cut') { drawCutscene(); renderDialogue(); return; }
    if (!map || !player || state === 'title' || state === 'select') { drawTitleBackdrop(); return; }
    drawFpScene();
    drawPost();
    if (mapOpen && state === 'play') drawBigMap();
    if (state === 'play') { updateHud(); drawMinimap(); }
    renderDialogue();
  }

  function loop(t) {
    requestAnimationFrame(loop);
    if (!lastT) lastT = t;
    const dt = clamp((t - lastT) / 1000, 0, 0.05);   // 巻き戻り・長時間の休止どちらも潰す
    lastT = t;
    frame++;
    fpsSmooth = fpsSmooth * 0.94 + (1 / Math.max(0.001, dt)) * 0.06;

    if (state !== 'cut') handleGlobalKeys();
    if (state === 'play' && (!player || !map)) state = 'title';   // 念のための保険
    if (state === 'play') {
      gameT += dt;
      if (run.stats) run.stats.time += dt;
      update(dt);
    } else if (state === 'cut') {
      gameT += dt;
      updateCutscene(dt);
    }
    render();
    clearPressed();
  }

  /** 全体マップを開くと HUD と重なるので、開いている間は HUD を伏せる。 */
  function setMapOpen(v) {
    mapOpen = v;
    document.body.classList.toggle('map-open', v);
  }

  /** あそびかたを開く。閉じたときに戻る先を覚えておく。 */
  let helpFrom = 'title';
  function openHelp() {
    if (state !== 'help') helpFrom = (state === 'play' || state === 'paused') ? 'play' : 'title';
    setState('help');
  }

  function handleGlobalKeys() {
    if (wasPressed('tab') && state === 'play') { setMapOpen(!mapOpen); Audio2.sfx.click(); }
    if (wasPressed('escape')) {
      if (mapOpen) { setMapOpen(false); return; }
      if (state === 'play') { setState('paused'); }
      else if (state === 'paused' || state === 'help' || state === 'note') { setState('play'); }
    }
    if (wasPressed('h') && (state === 'play' || state === 'paused')) openHelp();
    if (state === 'note' && (wasPressed('e') || wasPressed(' ') || wasPressed('enter'))) setState('play');
    if (state === 'briefing' && (wasPressed(' ') || wasPressed('enter'))) setState('play');
    if (wasPressed('m')) { const m = Audio2.toggleMute(); const b = $('btn-mute'); if (b) b.textContent = m ? '🔇' : '🔊'; }
  }

  // ============================================================
  //  初期化
  // ============================================================
  function bindButtons() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { Audio2.unlock(); Audio2.sfx.click(); fn(); }); };
    on('btn-start', () => { Audio2.startAmbience(); setState('select'); });
    on('btn-title-help', () => openHelp());
    on('btn-back', () => setState('title'));
    on('btn-go', () => { Audio2.startAmbience(); startRun(); });
    on('btn-brief-go', () => setState('play'));
    on('btn-note-close', () => setState('play'));
    on('btn-help-close', () => setState(helpFrom));
    on('btn-resume', () => { setState('play'); requestLook(); });
    on('btn-quit', () => { Audio2.stopAmbience(); map = null; player = null; setState('title'); });
    on('btn-retry', () => { startRun(); });
    on('btn-change', () => setState('select'));
    on('btn-win-again', () => setState('select'));
    on('btn-help', () => openHelp());
    on('btn-menu', () => {
      if (state === 'play') setState('paused');
      else if (state === 'paused') setState('play');
    });
    const mb = $('btn-mute');
    if (mb) mb.addEventListener('click', () => { Audio2.unlock(); const m = Audio2.toggleMute(); mb.textContent = m ? '🔇' : '🔊'; });
  }

  function init() {
    cacheHud();
    makeGrain();
    bindInput();
    bindButtons();
    setState('title');
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
