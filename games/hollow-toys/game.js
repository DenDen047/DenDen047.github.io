/* HOLLOW TOYS ― 廃墟のおもちゃ工場
 * 見下ろし型の2Dサバイバルホラー。プレイヤーは懐中電灯ひとつで廃工場に潜り、
 * 動き出した玩具から逃げながら3フロアを踏破して「マザー」を停止させる。
 *
 * 描画の核は「壁でさえぎられる光」。プレイヤー位置から壁セグメントへレイを飛ばして
 * 可視ポリゴンを毎フレーム構築し、そのポリゴンで暗闇レイヤーを抜くことで
 * 影が伸びる・角の向こうが見えないという体験を作る。敵は光の中にいる時だけ描画される。
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
      id: 'inspector', name: '三笠 硝子', role: '元検品員', color: '#8ae6b8', accent: '#173a2c',
      tag: '索敵', hp: 110, speed: 166, sprintMul: 1.48,
      battery: 105, batteryMul: 1.0, sanityRes: 0.9,
      lightRange: 400, lightArc: 0.56,
      weapon: { name: '鉄パイプ', dmg: 26, reach: 66, arc: 1.0, cd: 0.40, stun: 0.55, knock: 140 },
      ability: { id: 'memory', name: '工場の記憶', cd: 24, desc: '12秒間、壁越しに敵と目標の位置が透けて見える。' },
      story: 'ここで12年、不良品をはじき続けた。はじいた物の行き先は知らない。',
      trait: '標準的な性能。索敵アビリティで事故を減らせる。',
    },
    {
      id: 'streamer', name: '古賀 ミオ', role: '配信者', color: '#ff8fd0', accent: '#45163a',
      tag: '機動', hp: 88, speed: 190, sprintMul: 1.62,
      battery: 92, batteryMul: 1.12, sanityRes: 1.28,
      lightRange: 372, lightArc: 0.62, hood: 'cat',
      weapon: { name: '一眼カメラ', type: 'camera', dmg: 21, reach: 210, arc: 0.44, cd: 0.62, stun: 1.0, knock: 70 },
      ability: { id: 'flash', name: 'フラッシュ撮影', cd: 15, desc: '前方を白飛びさせる。扇形内の敵に大ダメージとスタン。' },
      story: '「廃工場から生放送」。視聴者は3人。うち2人は知らない誰かだ。',
      trait: '最速・最脆。攻撃はカメラのシャッターで、離れたまま撮って怯ませる。',
    },
    {
      id: 'mechanic', name: '園部 ヨウ', role: '設備整備士', color: '#ffc861', accent: '#4a3512',
      tag: '設営', hp: 118, speed: 158, sprintMul: 1.42,
      battery: 120, batteryMul: 0.94, sanityRes: 0.85,
      lightRange: 412, lightArc: 0.54,
      weapon: { name: 'モンキーレンチ', dmg: 34, reach: 56, arc: 0.95, cd: 0.52, stun: 0.8, knock: 220 },
      ability: { id: 'flare', name: '発煙筒', cd: 18, desc: 'フレアを投げる。着弾点は18秒間光り、敵を寄せつけない。' },
      story: '配電盤の図面は頭に入っている。ただし十年前の版だ。',
      trait: '一撃が重く、作業(目標アイテムの回収)も速い。',
    },
    {
      id: 'artisan', name: '柊 セツ', role: '元玩具職人', color: '#c9a7ff', accent: '#2f2350',
      tag: '搦め手', hp: 100, speed: 160, sprintMul: 1.44,
      battery: 108, batteryMul: 0.98, sanityRes: 0.66,
      lightRange: 396, lightArc: 0.58,
      weapon: { name: '彫刻刀', dmg: 24, reach: 50, arc: 0.9, cd: 0.30, stun: 0.35, knock: 90 },
      ability: { id: 'lullaby', name: '子守唄', cd: 28, desc: '半径260の玩具を6秒眠らせ、最も近い1体を20秒だけ味方にする。' },
      story: 'この子たちに顔を描いたのは私だ。名前もつけた。全部。',
      trait: '正気度に強く、敵を味方に変えられる。純粋な戦闘力は低め。',
    },
  ];

  // ============================================================
  //  休憩室で選ぶ強化
  // ============================================================
  const UPGRADES = [
    { id: 'lens', name: '高出力レンズ', icon: '🔦', desc: 'ライトの射程 +22%' },
    { id: 'cell', name: '大容量セル', icon: '🔋', desc: 'バッテリー最大 +45' },
    { id: 'boots', name: '制振ソール', icon: '👟', desc: '足音 -45% / 移動速度 +8%' },
    { id: 'grip', name: '滑り止めグリップ', icon: '🔧', desc: '近接ダメージ +28%' },
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
  //  敵の定義
  //  sight=視界距離 / hear=聴覚距離 / lightFear=光に対する怯みやすさ
  // ============================================================
  const ENEMY_DEFS = {
    soldier: {
      key: 'soldier', name: 'ブリキ兵長', hp: 78, speed: 64, chaseMul: 1.55, r: 15,
      dmg: 15, reach: 40, atkCd: 1.15, sight: 340, hear: 300, lightFear: 1.0,
      score: 10, desc: 'ぜんまいで歩く。列を組み、規則正しく巡回する。',
    },
    doll: {
      key: 'doll', name: '躄(いざ)り人形', hp: 52, speed: 176, chaseMul: 1.0, r: 13,
      dmg: 18, reach: 34, atkCd: 0.9, sight: 420, hear: 380, lightFear: 0,
      score: 14, desc: '光を当てられている間は動かない。目を離した分だけ近づく。',
    },
    bear: {
      key: 'bear', name: '抱きぐま', hp: 168, speed: 52, chaseMul: 1.9, r: 20,
      dmg: 30, reach: 46, atkCd: 1.8, sight: 300, hear: 340, lightFear: 0.55,
      score: 22, desc: '見つけると突進してくる。抱きしめられたら終わり。',
    },
    jack: {
      key: 'jack', name: 'ジャック', hp: 44, speed: 96, chaseMul: 1.2, r: 14,
      dmg: 26, reach: 44, atkCd: 1.4, sight: 190, hear: 220, lightFear: 0.8,
      score: 16, desc: '箱の中で待つ。近づくまで動かない。',
    },
    marion: {
      key: 'marion', name: '糸繰り', hp: 66, speed: 74, chaseMul: 1.25, r: 15,
      dmg: 12, reach: 300, atkCd: 2.0, sight: 400, hear: 260, lightFear: 1.3,
      score: 20, desc: '天井から部品を投げてくる。近づくと糸を手繰って逃げる。',
    },
  };

  // ============================================================
  //  フロア構成
  // ============================================================
  const FLOORS = [
    {
      n: 1, chapter: 1, mode: 'escape', name: 'B1 組立ライン', code: 'ASSEMBLY',
      goalItem: 'ヒューズ', goalIcon: '🔌', goalCount: 3, grabpack: true,
      goalDesc: '配電盤のヒューズを 3本 と グラップパック を回収し、貨物エレベーターへ通電する。追ってくる「あれ」とは戦えない。逃げろ。',
      exitName: '配電盤', mapW: 60, mapH: 44, rooms: 12,
      mix: { soldier: 0.62, jack: 0.24, doll: 0.14 }, density: 1.0,
      tint: '#0d1418', fog: '#0b1216', stalker: 'warden', stalkSpeed: 76,
      intro: ['正面ゲートは錆びついて開かない。', '搬入口の隙間から、暖かい油の匂いがした。', '― 10年前に止まったはずの工場から。'],
    },
    {
      n: 2, chapter: 2, mode: 'mission', name: '2F 塗装・検品室', code: 'PAINT',
      goalItem: '検品', goalIcon: '📋', goalCount: 0,
      goalDesc: '検品長が3つの「仕事」を言いつけてくる。断れば、こちらが検品される。',
      exitName: '封鎖扉', mapW: 66, mapH: 48, rooms: 14,
      mix: { soldier: 0.40, doll: 0.26, bear: 0.16, marion: 0.10, jack: 0.08 }, density: 1.18,
      tint: '#150f14', fog: '#130c12', stalker: 'inspector', stalkSpeed: 0,
      intro: ['塗装ブースの床は、まだ乾いていない赤で覆われていた。', '検品台には、合格判の押された「なにか」が並んでいる。', '天井から、細い糸が降りてきた。'],
    },
    {
      n: 3, chapter: 3, mode: 'escape', name: '3F 保管庫・焼却炉', code: 'FURNACE',
      goalItem: '鍵', goalIcon: '🗝️', goalCount: 2,
      goalDesc: '保管庫の鍵 2本 を集め、焼却炉ホールの隔壁を開く。今度の追手は、話が通じない。',
      exitName: '隔壁ゲート', mapW: 70, mapH: 50, rooms: 15,
      mix: { soldier: 0.30, doll: 0.28, bear: 0.22, marion: 0.14, jack: 0.06 }, density: 1.34,
      tint: '#180d0c', fog: '#160a09', stalker: 'nemuri', stalkSpeed: 104,
      intro: ['棚には出荷されなかった玩具が、天井まで積み上がっている。', 'どれも、こちらを向いていた。', '奥のいちばん高い棚の上で、紫のなにかが寝返りを打った。'],
    },
  ];

  // ============================================================
  //  各チャプターのボス
  //  hunt = 追い回す(倒せない) / mission = 仕事を言いつけてくる
  // ============================================================
  const CHAPTER_BOSSES = {
    warden: {
      id: 'warden', name: 'ゼンマイ巡査', mode: 'hunt', color: '#d8b04a',
      r: 40, art: 26, dmg: 34, voice: 150, staggerLight: 2.2,
      lines: {
        intro: ['……鍵は、たしかに 閉めた。', 'だれか いるな。', 'ここは わたしの 持ち場だ。'],
        spot: ['みつけた。', 'そこか。', 'いい子は 帰りなさい。'],
        lost: ['……どこへ 行った。', 'かくれんぼは 好きだ。', 'まだ 終わって いない。'],
        goal: ['触るな。', 'それは 工場のものだ。', '歯車が ひとつ 減った。'],
        ready: ['出口へは 行かせない。', 'ここに いなさい。ずっと。'],
        hit: ['まぶしい。', 'やめろ。', 'ぜんまいが 狂う。'],
      },
    },
    inspector: {
      id: 'inspector', name: '検品長 ミス・パペット', mode: 'mission', color: '#8ae6b8',
      r: 34, art: 20, dmg: 26, voice: 260, staggerLight: 0.8,
      lines: {
        intro: ['あら。新入り。', '手が 足りないの。手伝って ちょうだい。', '三つ。三つ だけでいいの。'],
        m0: ['まず、塗装ラインの バルブを 締めて。', '赤が 乾かないのは、あなたのせいじゃ ないけれど。'],
        m1: ['次。不良品を 廃棄して。', '躄り人形。四体。目を 描き損ねた子たち。'],
        m2: ['最後。わたしの 顔を 持ってきて。', '塗装室に 置き忘れたの。顔が ないと、判が 押せない。'],
        done0: ['ひとつ。よくできました。'],
        done1: ['ふたつ。手際が いいのね。'],
        done2: ['みっつ。……ああ、これ。これだわ。'],
        finish: ['合格。あなたは 合格よ。', '封鎖扉を 開けておいたわ。', '上の階には、話の 通じない子が いるけれど。'],
        idle: ['まだ？', '手を 動かして。', '時間は 有限よ。あなたのは、特に。'],
      },
    },
    // 保管庫の主。紫の巨大なぬいぐるみ猫で、赤い眠り煙を吐く。
    nemuri: {
      id: 'nemuri', name: 'ネムリネコ', mode: 'hunt', color: '#a071e8',
      r: 56, art: 28, dmg: 42, voice: 104, staggerLight: 1.1, gas: true,
      lines: {
        intro: ['……ん。おきちゃった。', 'いいこは もう ねる じかん。', 'ねよう。ずっと ねよう。'],
        spot: ['みーつけた。', 'そこ。あったかい におい。', 'にげないで。ねむいだけ でしょう。'],
        lost: ['どこ いった の。', 'かくれても においで わかる。', 'まだ おきてる ね。'],
        goal: ['それ、もっていかないで。', 'かえして。', 'そとに でても、さむいよ。'],
        ready: ['いかないで。', 'ここで ねて。ずっと ずっと。'],
        hit: ['……まぶしい。', 'め が いたい。', 'やめて。'],
      },
    },
  };

  // ============================================================
  //  収集メモ(読むと正気度が回復する)
  // ============================================================
  const NOTES = [
    { t: '作業日誌 4/12', b: '第3ラインの検品率が落ちている。塗装が乾く前に梱包されたぬいぐるみが12体流出。回収指示は出ていない。' },
    { t: '社内通達', b: '「特別素材」の取り扱いについて。梱包は必ず二重に。夜間は絶対に開封しないこと。音がしても開けないこと。' },
    { t: '走り書き', b: '倉庫の人形が並び替わってる。誰かが動かしてるって皆言うけど、鍵は俺しか持ってない。' },
    { t: '検品記録 A-7', b: '不良判定：118体。廃棄処分：0体。備考欄「本人たちが嫌がるため」― 誰が書いた？' },
    { t: '整備メモ', b: 'ベルトコンベアが夜中に単独で動く。ブレーカーを落としても動く。電気じゃないものが動かしてる。' },
    { t: '園部宛の手紙', b: 'ヨウへ。工場のことは忘れなさい。あの日、地下で見たものを誰にも話してはいけません。― 母より' },
    { t: '塗装班の張り紙', b: '目を描くのは最後にすること。目を描いた瞬間から、それは見ている。' },
    { t: '柊の設計図', b: '製品名：MOTHER。全長4.2m。中心部に炉を内蔵。備考「子どもたちを一体ずつ、内側に迎え入れる構造」。' },
    { t: '最後のログ', b: '10:47 全ラインを停止。10:52 全ラインが再起動。操作者なし。11:03 逃げろ' },
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
  let visPoly = [];           // 可視ポリゴン(ワールド座標)
  let visBox = { x0: 0, y0: 0, x1: 0, y1: 0 };

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
    cv.addEventListener('mousedown', (e) => {
      Audio2.unlock();
      if (e.button === 0) mouse.down = true;
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

  /** 移動入力(-1..1)。キーボードとスティックの両対応。 */
  function readMove() {
    let x = 0, y = 0;
    if (keys['a'] || keys['arrowleft']) x -= 1;
    if (keys['d'] || keys['arrowright']) x += 1;
    if (keys['w'] || keys['arrowup']) y -= 1;
    if (keys['s'] || keys['arrowdown']) y += 1;
    if (touch.move.mag > 0.12) { x = touch.move.dx / 56; y = touch.move.dy / 56; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m) };
  }

  /** 照準角。タッチ時は右スティック、なければ進行方向。 */
  function readAim(px, py) {
    if (touch.aim.mag > 0.2) return Math.atan2(touch.aim.dy, touch.aim.dx);
    if (touch.on && touch.move.mag > 0.2) return Math.atan2(touch.move.dy, touch.move.dx);
    const sx = px - cam.x, sy = py - cam.y;
    return Math.atan2(mouse.y - sy, mouse.x - sx);
  }

  const isAttacking = () => mouse.down || touch.attack || keys['j'];
  const isFocusing = () => mouse.rdown || touch.focus || keys['k'];
  const isSprinting = () => keys['shift'] || touch.sprint;
  const isCrouching = () => keys['control'] || keys['c'];

  // ============================================================
  //  マップ生成(BSP で部屋を切り、通路でつなぐ)
  // ============================================================
  const ROOM_KINDS = ['assembly', 'storage', 'paint', 'office', 'locker', 'hall'];

  function makeMap(w, h) {
    return {
      w, h, pxW: w * TILE, pxH: h * TILE,
      cells: new Uint8Array(w * h),   // 0=壁 1=床
      seen: new Uint8Array(w * h),    // ミニマップ用の踏破フラグ
      rooms: [], segs: [], occ: [],
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

  /** 壁と床の境界を線分として抽出し、同一直線上のものをつなぐ。光の遮蔽に使う。 */
  function buildSegments(m) {
    const hRuns = new Map(), vRuns = new Map();
    const push = (map_, key, v) => { let a = map_.get(key); if (!a) { a = []; map_.set(key, a); } a.push(v); };
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (cellAt(m, x, y) === 1) continue;         // 床は対象外
        if (isFloorTile(m, x, y - 1)) push(hRuns, y + ':t', x);
        if (isFloorTile(m, x, y + 1)) push(hRuns, (y + 1) + ':b', x);
        if (isFloorTile(m, x - 1, y)) push(vRuns, x + ':l', y);
        if (isFloorTile(m, x + 1, y)) push(vRuns, (x + 1) + ':r', y);
      }
    }
    const segs = [];
    for (const [key, arr] of hRuns) {
      const yPix = parseInt(key, 10) * TILE;
      arr.sort((a, b) => a - b);
      let s = arr[0], p = arr[0];
      for (let i = 1; i <= arr.length; i++) {
        if (i < arr.length && arr[i] === p + 1) { p = arr[i]; continue; }
        segs.push({ x1: s * TILE, y1: yPix, x2: (p + 1) * TILE, y2: yPix });
        if (i < arr.length) { s = arr[i]; p = arr[i]; }
      }
    }
    for (const [key, arr] of vRuns) {
      const xPix = parseInt(key, 10) * TILE;
      arr.sort((a, b) => a - b);
      let s = arr[0], p = arr[0];
      for (let i = 1; i <= arr.length; i++) {
        if (i < arr.length && arr[i] === p + 1) { p = arr[i]; continue; }
        segs.push({ x1: xPix, y1: s * TILE, x2: xPix, y2: (p + 1) * TILE });
        if (i < arr.length) { s = arr[i]; p = arr[i]; }
      }
    }
    // 各線分にバウンディングを持たせて、後段の絞り込みを速くする
    for (const s of segs) {
      s.minx = Math.min(s.x1, s.x2); s.maxx = Math.max(s.x1, s.x2);
      s.miny = Math.min(s.y1, s.y2); s.maxy = Math.max(s.y1, s.y2);
    }
    m.segs = segs;
  }

  /** 遮蔽物(棚・木箱など)を登録する。線分化は rebuildSegments でまとめて行う。 */
  function addOccluder(m, x, y, w, h) { m.occ.push({ x, y, w, h }); }

  /** 壁 + 遮蔽物から光の遮蔽線分を作り直す。 */
  function rebuildSegments(m) {
    buildSegments(m);
    for (const o of m.occ) {
      const s4 = [
        { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y },
        { x1: o.x + o.w, y1: o.y, x2: o.x + o.w, y2: o.y + o.h },
        { x1: o.x + o.w, y1: o.y + o.h, x2: o.x, y2: o.y + o.h },
        { x1: o.x, y1: o.y + o.h, x2: o.x, y2: o.y },
      ];
      for (const s of s4) {
        s.minx = Math.min(s.x1, s.x2); s.maxx = Math.max(s.x1, s.x2);
        s.miny = Math.min(s.y1, s.y2); s.maxy = Math.max(s.y1, s.y2);
        m.segs.push(s);
      }
    }
  }

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
  //  小物・設備の配置
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

  function furnishRoom(m, room) {
    const rx = room.x * TILE, ry = room.y * TILE, rw = room.w * TILE, rh = room.h * TILE;
    const kind = room.kind;
    // どの部屋にも壊れた蛍光灯が入りうる(生きているものは少ない)
    if (chance(0.42)) addLamp(rx + rw / 2, ry + rh / 2, rnd(150, 240), chance(0.25) ? '#bfe6ff' : '#ffe2a8', rnd(0.2, 0.85));

    if (kind === 'assembly') {
      // ベルトコンベアを縦か横に通す
      const horiz = room.w >= room.h;
      const cx = rx + rw / 2, cy = ry + rh / 2;
      if (horiz) addProp('conveyor', rx + TILE, cy - 26, rw - TILE * 2, 52, { solid: false, horiz: true });
      else addProp('conveyor', cx - 26, ry + TILE, 52, rh - TILE * 2, { solid: false, horiz: false });
      const n = rndInt(2, 4);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 26);
        addProp('bench', p.x - 34, p.y - 20, 68, 40, { occlude: true });
      }
      if (chance(0.6)) { const p = findOpen(m, room, 26); addProp('toybox', p.x - 22, p.y - 22, 44, 44, { occlude: true }); }
    } else if (kind === 'storage') {
      const n = rndInt(3, 6);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 30);
        const vertical = chance(0.5);
        const w = vertical ? 36 : 96, h = vertical ? 96 : 36;
        addProp('shelf', p.x - w / 2, p.y - h / 2, w, h, { occlude: true });
      }
      if (chance(0.7)) { const p = findOpen(m, room, 26); addProp('dollpile', p.x - 30, p.y - 26, 60, 52, { solid: false }); }
    } else if (kind === 'paint') {
      const n = rndInt(2, 5);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 24);
        addProp('barrel', p.x - 18, p.y - 18, 36, 36, { occlude: chance(0.5) });
      }
      for (let i = 0; i < 5; i++) {
        const p = randFloorIn(m, room, 1);
        decals.push({ x: p.x, y: p.y, r: rnd(26, 70), a: rnd(0.18, 0.4), c: chance(0.5) ? '#5a0d12' : '#7a1418', rot: rnd(TAU) });
      }
    } else if (kind === 'office') {
      const n = rndInt(2, 4);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 26);
        addProp('desk', p.x - 40, p.y - 24, 80, 48, { occlude: true });
      }
      if (chance(0.8)) { const p = findOpen(m, room, 22); addProp('cabinet', p.x - 20, p.y - 16, 40, 32, { occlude: true }); }
    } else if (kind === 'locker') {
      const n = rndInt(3, 6);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 24);
        addProp('locker', p.x - 22, p.y - 16, 44, 32, { occlude: true, usable: true, hideSlot: true });
      }
    } else { // hall
      const n = rndInt(1, 3);
      for (let i = 0; i < n; i++) {
        const p = findOpen(m, room, 28);
        addProp('pillar', p.x - 22, p.y - 22, 44, 44, { occlude: true });
      }
      if (chance(0.5)) { const p = findOpen(m, room, 26); addProp('crate', p.x - 24, p.y - 24, 48, 48, { occlude: true }); }
    }
    // 中身の抜けたぬいぐるみ。潜り込んでやり過ごせる。
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
      const room = { x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2), kind: pick(ROOM_KINDS) };
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
    m.rooms = rooms;
    buildSegments(m);

    // --- 配置 ---
    const start = rooms[0];
    start.kind = 'hall';
    for (const r of rooms) furnishRoom(m, r);
    rebuildSegments(m);                   // 遮蔽物を足した後に再構築
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
    m.def = { n: 4, name: '焼却炉ホール', code: 'MOTHER', tint: '#1a0b08', fog: '#170807' };
    m.arena = true;
    map = m;
    enemies = []; items = []; props = []; parts = []; shots = []; decals = []; floats = []; lamps = [];
    stalker = null; gasClouds = [];
    dlg.q.length = 0; dlg.text = ''; dlg.t = 0;
    carveRect(m, 2, 2, 30, 24);
    const room = { x: 2, y: 2, w: 30, h: 24, cx: 17, cy: 14, kind: 'hall' };
    m.rooms = [room];
    buildSegments(m);

    m.spawn = { x: 17 * TILE, y: 24 * TILE };
    // 中央の焼却炉
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
    rebuildSegments(m);
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

  /** レイ(px,py 方向 dx,dy)と線分の交差距離。当たらなければ null。 */
  function rayHit(px, py, dx, dy, s) {
    const sx = s.x2 - s.x1, sy = s.y2 - s.y1;
    const denom = dx * sy - dy * sx;
    if (denom > -1e-9 && denom < 1e-9) return null;
    const qx = s.x1 - px, qy = s.y1 - py;
    const t = (qx * sy - qy * sx) / denom;
    if (t <= 0) return null;
    const u = (qx * dy - qy * dx) / denom;
    if (u < 0 || u > 1) return null;
    return t;
  }

  const _segBuf = [];
  const _angBuf = [];

  /**
   * プレイヤー位置から見える範囲のポリゴンを作る。
   * 近くの壁線分の端点へレイを飛ばし、角の両脇にも微小角ずらしたレイを追加して
   * 影の境界をきれいに出す。返り値は角度順の頂点列。
   */
  function computeVisibility(px, py, R) {
    _segBuf.length = 0;
    const x0 = px - R, x1 = px + R, y0 = py - R, y1 = py + R;
    const all = map.segs;
    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      if (s.maxx < x0 || s.minx > x1 || s.maxy < y0 || s.miny > y1) continue;
      _segBuf.push(s);
    }
    // 視界の外周。レイが必ずどこかで止まるようにする。
    const bx0 = px - R, bx1 = px + R, by0 = py - R, by1 = py + R;
    _segBuf.push(
      { x1: bx0, y1: by0, x2: bx1, y2: by0 },
      { x1: bx1, y1: by0, x2: bx1, y2: by1 },
      { x1: bx1, y1: by1, x2: bx0, y2: by1 },
      { x1: bx0, y1: by1, x2: bx0, y2: by0 }
    );

    _angBuf.length = 0;
    const seen = new Set();
    for (let i = 0; i < _segBuf.length; i++) {
      const s = _segBuf[i];
      for (let e = 0; e < 2; e++) {
        const ex = e ? s.x2 : s.x1, ey = e ? s.y2 : s.y1;
        const key = ((ex | 0) * 8192 + (ey | 0));
        if (seen.has(key)) continue;
        seen.add(key);
        const a = Math.atan2(ey - py, ex - px);
        _angBuf.push(a - LIGHT_RAY_EPS, a, a + LIGHT_RAY_EPS);
      }
    }
    _angBuf.sort((a, b) => a - b);

    const pts = [];
    const n = _segBuf.length;
    for (let k = 0; k < _angBuf.length; k++) {
      const a = _angBuf[k];
      if (k > 0 && a - _angBuf[k - 1] < 1e-6) continue;
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = R;
      for (let i = 0; i < n; i++) {
        const t = rayHit(px, py, dx, dy, _segBuf[i]);
        if (t !== null && t < best) best = t;
      }
      pts.push({ x: px + dx * best, y: py + dy * best, a });
    }
    return pts;
  }

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

  /** 現在プレイヤーの光がその点に届いているか(敵の描画・人形AIに使う)。 */
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
      memoryT: 0, blind: 0, heartT: 0, breathT: 0, whisperT: 0,
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
    if (p.disguise) s *= 0.66;                    // ぬいぐるみの中は動きにくい
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
    const wantSprint = isSprinting() && mv.mag > 0.1 && p.stamina > 2;
    p.sprinting = wantSprint;
    if (wantSprint) p.stamina -= STAMINA_COST * dt;
    else p.stamina += STAMINA_REGEN * dt * (isCrouching() ? 1.5 : 1);
    p.stamina = clamp(p.stamina, 0, 100);

    const spd = playerSpeed(p);
    let mvx = mv.x * spd * dt, mvy = mv.y * spd * dt;
    // 正気度が低いと手元・足元が揺れる(据わった肝で軽減)
    if (p.sanity < 35 && !modLv('nerve')) {
      const sway = (1 - p.sanity / 35) * 0.28;
      const ang = Math.atan2(mvy, mvx) + Math.sin(gameT * 6.1) * sway;
      const mag = Math.hypot(mvx, mvy);
      mvx = Math.cos(ang) * mag; mvy = Math.sin(ang) * mag;
    }
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

    // --- 照準 ---
    p.aim = readAim(p.x, p.y);

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

    // --- ぬいぐるみに化けている間 ---
    if (p.disguise) {
      p.disguiseT += dt;
      // 走ると中身がばれる
      if (p.sprinting) breakDisguise(p, '走ったせいで見破られた');
      else if (wasPressed('x')) breakDisguise(p, 'ぬいぐるみを脱いだ');
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

  /** 腕を痛めていると振りが遅くなる。 */
  function armPenalty(p) { return 1 + (p.limbs.larm + p.limbs.rarm) / 2 * 0.55; }

  function meleeAttack(p) {
    const w = p.char.weapon;
    if (p.disguise) { breakDisguise(p, '手を出したので見破られた'); return; }
    if (w.type === 'camera') { cameraShot(p); return; }
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
      if (pr.type !== 'crate' && pr.type !== 'barrel' && pr.type !== 'toybox') continue;
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
      toast('工場の記憶 ― 12秒間、壁越しに見える');
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
  //  ぬいぐるみへの変装
  //  中身が空になった玩具に潜り込む。歩いている限り、敵は仲間だと思う。
  // ------------------------------------------------------------
  const PLUSH_KINDS = ['bear', 'soldier', 'doll'];

  function wearDisguise(p, pr) {
    p.disguise = { kind: pr.kind };
    p.disguiseT = 0;
    pr.used = true;
    pr.solid = false;
    Audio2.sfx.door();
    toast('ぬいぐるみをかぶった ― 走ると見破られる');
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
    if (p.disguise) breakDisguise(p, 'ぬいぐるみが裂けた');
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

  /** E で調べられる一番近い対象。 */
  function findInteract(p) {
    let best = null, bd = 60 * 60;
    const ITEM_LABEL = {
      note: '📄 メモを読む',
      grabpack: '🧤 グラップパックを装着',
      mask: '🎭「顔」を拾う',
    };
    for (const it of items) {
      if (it.type !== 'goal' && !ITEM_LABEL[it.type]) continue;
      const d = dist2(p.x, p.y, it.x, it.y);
      if (d < bd) {
        bd = d;
        const label = it.type === 'goal' ? map.def.goalIcon + ' ' + map.def.goalItem + 'を回収' : ITEM_LABEL[it.type];
        best = { kind: 'item', ref: it, x: it.x, y: it.y, label };
      }
    }
    for (const pr of props) {
      if (!pr.usable || pr.broken) continue;
      const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
      const d = dist2(p.x, p.y, cx, cy);
      if (d >= bd) continue;
      let label = null;
      if (pr.type === 'plush') label = pr.used ? null : '🧸 ぬいぐるみに潜り込む';
      else if (pr.type === 'locker') label = '🚪 ロッカーに隠れる';
      else if (pr.type === 'exitmachine') {
        if (objectiveComplete()) label = `⚡ ${map.def.exitName}を起動`;
        else if (map.def.mode === 'mission') label = '⚠ 検品長の指示が残っている';
        else if (map.def.grabpack && !p.hasGrab) label = '⚠ グラップパックが要る';
        else label = `⚠ ${map.def.goalItem}があと ${map.def.goalCount - p.goals}`;
      } else if (pr.type === 'breaker') label = pr.on ? '― 通電済み' : '🔌 ブレーカーを上げる';
      else if (pr.type === 'valve') label = pr.turned ? '― 締めた' : '🔧 バルブを締める';
      if (!label) continue;
      bd = d; best = { kind: 'prop', ref: pr, x: cx, y: cy, label };
    }
    // 検品長に「顔」を手渡す
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
        toast('「顔」を拾った ― 検品長へ持っていく');
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
      if (p.disguise) breakDisguise(p, 'ぬいぐるみを脱いだ');
      else wearDisguise(p, pr);
    } else if (pr.type === 'valve') {
      if (!pr.turned) {
        pr.turned = true;
        Audio2.sfx.metal();
        emitNoise(p.x, p.y, 240);
        missionProgress('valve', 1);
      }
    } else if (pr.type === 'locker') {
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
      angle: rnd(TAU), state: kind === 'jack' ? 'hide' : 'patrol',
      home: { x, y }, room: room || null,
      patrol: [], pi: 0, waitT: rnd(0.4, 2.2),
      lastSeen: null, searchT: 0, atkCd: rnd(0.3, 1.2),
      stun: 0, dazzle: 0, dazzleT: 0, charmed: false, charmT: 0,
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
    const e = spawnEnemy(chance(0.5) ? 'doll' : 'soldier', x, y, null);
    e.phantom = true; e.state = 'chase'; e.life = rnd(2.2, 4.5);
    e.hp = e.maxHp = 1;
  }

  function hearNoise(e, x, y) {
    if (e.state === 'chase' || e.state === 'dead') return;
    if (e.kind === 'jack' && e.state === 'hide') return;
    e.lastSeen = { x, y };
    e.state = 'search';
    e.searchT = 5.5;
    e.alert = Math.min(1, e.alert + 0.5);
  }

  /** その敵からプレイヤーが見えているか。ライトを点けていると見つかりやすい。 */
  function canSeePlayer(e) {
    if (player.hiding || player.dead) return false;
    const d = dist(e.x, e.y, player.x, player.y);
    // ぬいぐるみをかぶっていると、ぶつかる距離まで仲間だと思われる
    if (disguised(player) && d > 46) return false;
    let sight = e.def.sight;
    if (player.lightOn && player.battery > 0) {
      sight *= 1.45;
      // 光を敵の方へ向けていると更に目立つ
      if (angDiff(Math.atan2(e.y - player.y, e.x - player.x), player.aim) < player.lightArcNow) sight *= 1.2;
    } else sight *= isCrouching() ? 0.55 : 0.75;
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

    if (e.stun > 0) {
      e.stun -= dt;
      return;
    }

    const dToP = dist(e.x, e.y, player.x, player.y);

    // --- 種類ごとの特殊挙動 ---
    if (e.kind === 'doll') {
      // 光が当たっている間は完全に停止する
      const lit = player.lightOn && player.battery > 0 && dToP < player.lightRangeNow &&
        angDiff(Math.atan2(e.y - player.y, e.x - player.x), player.aim) < player.lightArcNow &&
        losClear(player.x, player.y, e.x, e.y);
      e.frozen = lit || isLampLit(e.x, e.y);
      if (e.frozen) { e.state = 'chase'; return; }
    }
    if (e.kind === 'jack' && e.state === 'hide') {
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
      if (e.state !== 'chase' && e.spotT > (e.kind === 'doll' ? 0 : 0.22)) {
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
      else if (e.kind === 'marion') { updateMarion(e, dt, dToP); }
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

  function updateMarion(e, dt, d) {
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
    if (e.kind === 'doll') missionProgress('cull', 1);
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

  function updateCamera(dt) {
    const lookX = touch.on ? 0 : (mouse.x - VIEW_W / 2) * 0.12;
    const lookY = touch.on ? 0 : (mouse.y - VIEW_H / 2) * 0.12;
    const tx = player.x - VIEW_W / 2 + lookX;
    const ty = player.y - VIEW_H / 2 + lookY;
    cam.x = lerp(cam.x, tx, Math.min(1, dt * 7));
    cam.y = lerp(cam.y, ty, Math.min(1, dt * 7));
    cam.x = clamp(cam.x, 0, Math.max(0, map.pxW - VIEW_W));
    cam.y = clamp(cam.y, 0, Math.max(0, map.pxH - VIEW_H));
    if (cam.shakeT > 0) { cam.shakeT -= dt; cam.shake *= 0.88; } else cam.shake = 0;
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
          const kind = b.phase >= 3 ? pick(['soldier', 'doll', 'bear']) : pick(['soldier', 'doll']);
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
    assembly: '#3a3d43', storage: '#3f382e', paint: '#3b2c34',
    office: '#393c34', locker: '#333840', hall: '#36393e',
  };

  function roomKindAt(tx, ty) {
    for (const r of map.rooms) {
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r.kind;
    }
    return 'hall';
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
        const base = FLOOR_COLORS[roomKindAt(tx, ty)] || '#282a2e';
        g.fillStyle = base;
        g.fillRect(x, y, TILE, TILE);
        // タイルごとのムラ
        const v = brng();
        g.fillStyle = `rgba(0,0,0,${(v * 0.16).toFixed(3)})`;
        g.fillRect(x, y, TILE, TILE);
        if (v > 0.93) {
          g.fillStyle = 'rgba(120,105,80,0.10)';
          g.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        }
        // 目地
        g.strokeStyle = 'rgba(0,0,0,0.32)';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
    }

    // --- 汚れ・オイル染み ---
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
        g.fillStyle = v > 0.5 ? '#3a3730' : '#36332d';
        g.fillRect(x, y, TILE, TILE);
        // ブロック目地
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        g.fillStyle = 'rgba(255,255,255,0.045)';
        g.fillRect(x + 1, y + 1, TILE - 2, 3);
        if (v > 0.82) { // 錆
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
  }

  // ============================================================
  //  描画:ワールド
  // ============================================================
  const camShakeX = () => (cam.shake > 0 ? rnd(-cam.shake, cam.shake) : 0);
  let sx0 = 0, sy0 = 0;   // このフレームのカメラ左上(揺れ込み)

  function drawWorld() {
    // 前フレームの合成モードが漏れると画面が白飛びするので、毎フレーム明示的に戻す
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    sx0 = Math.round(cam.x + camShakeX());
    sy0 = Math.round(cam.y + camShakeX());

    // 焼き込んだ床と壁
    ctx.drawImage(bakeCv, sx0, sy0, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

    // 血痕・染み
    for (const d of decals) {
      const x = d.x - sx0, y = d.y - sy0;
      if (x < -80 || y < -80 || x > VIEW_W + 80 || y > VIEW_H + 80) continue;
      ctx.save();
      ctx.globalAlpha = d.a;
      ctx.translate(x, y); ctx.rotate(d.rot);
      ctx.fillStyle = d.c;
      ctx.beginPath();
      ctx.ellipse(0, 0, d.r, d.r * 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // 設備・小物
    for (const p of props) drawProp(p);

    // 落ちているもの
    for (const it of items) drawItem(it);

    // 倒した敵の残骸
    for (const e of enemies) if (e.dead) drawEnemy(e);

    // 投射物
    for (const s of shots) drawShot(s);

    // 生きている敵
    for (const e of enemies) if (!e.dead) drawEnemy(e);
    if (boss) drawBoss(boss);
    if (stalker) drawStalker();

    // プレイヤー
    if (!player.hiding) drawPlayer(player);
    else drawHidingPlayer(player);
    drawGrab();
    drawGas();

    // 非発光パーティクル
    ctx.save();
    for (const p of parts) {
      if (p.glow) continue;
      const x = p.x - sx0, y = p.y - sy0;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.9;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  設備・小物
  // ------------------------------------------------------------
  function drawProp(p) {
    const x = p.x - sx0, y = p.y - sy0;
    if (x + p.w < -40 || y + p.h < -40 || x > VIEW_W + 40 || y > VIEW_H + 40) return;
    ctx.save();
    switch (p.type) {
      case 'conveyor': {
        ctx.fillStyle = '#1e2024'; ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#3c4048'; ctx.lineWidth = 2; ctx.strokeRect(x + 0.5, y + 0.5, p.w - 1, p.h - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        const off = (gameT * 26) % 22;
        if (p.horiz) for (let i = -22; i < p.w; i += 22) ctx.fillRect(x + i + off, y + 3, 3, p.h - 6);
        else for (let i = -22; i < p.h; i += 22) ctx.fillRect(x + 3, y + i + off, p.w - 6, 3);
        break;
      }
      case 'bench': case 'desk': {
        ctx.fillStyle = p.broken ? '#2a2620' : '#4a3f30';
        ctx.fillRect(x, y, p.w, p.h);
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x, y, p.w, 5);
        ctx.strokeStyle = '#1d1913'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
        break;
      }
      case 'shelf': {
        ctx.fillStyle = '#3b3830'; ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#191713'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        if (p.w > p.h) for (let i = 1; i < 3; i++) ctx.fillRect(x + (p.w / 3) * i, y + 2, 2, p.h - 4);
        else for (let i = 1; i < 3; i++) ctx.fillRect(x + 2, y + (p.h / 3) * i, p.w - 4, 2);
        // 棚に載った玩具
        const n = 3;
        for (let i = 0; i < n; i++) {
          const px = x + 6 + ((p.w - 12) / n) * i + 4, py = y + p.h / 2;
          ctx.fillStyle = ['#8a5a4a', '#6a7a8a', '#8a7a4a'][i % 3];
          ctx.beginPath(); ctx.arc(px, py, 4, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'crate': case 'toybox': {
        ctx.fillStyle = p.broken ? '#241f18' : (p.type === 'toybox' ? '#6a4a7a' : '#6b5236');
        ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#22190f'; ctx.lineWidth = 2.5; ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
        if (!p.broken) {
          ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + p.w - 3, y + p.h - 3);
          ctx.moveTo(x + p.w - 3, y + 3); ctx.lineTo(x + 3, y + p.h - 3); ctx.stroke();
        }
        break;
      }
      case 'barrel': {
        const cx = x + p.w / 2, cy = y + p.h / 2;
        ctx.fillStyle = p.broken ? '#2c2018' : '#7a3a26';
        ctx.beginPath(); ctx.arc(cx, cy, p.w / 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#2a1610'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, p.w / 2 - 5, 0, TAU); ctx.stroke();
        break;
      }
      case 'pillar': {
        ctx.fillStyle = '#3f3c35'; ctx.fillRect(x, y, p.w, p.h);
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + 4, y + 4, p.w - 8, p.h - 8);
        ctx.strokeStyle = '#22201b'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
        break;
      }
      case 'locker': {
        ctx.fillStyle = p.open ? '#1a2a30' : '#33454d';
        ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#17242a'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + p.w / 2 - 1, y + 2, 2, p.h - 4);
        ctx.fillStyle = '#c9b96a';
        ctx.fillRect(x + p.w / 2 - 7, y + p.h / 2 - 1, 4, 3);
        ctx.fillRect(x + p.w / 2 + 3, y + p.h / 2 - 1, 4, 3);
        break;
      }
      case 'cabinet': {
        ctx.fillStyle = '#4a4a44'; ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#232320'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
        break;
      }
      case 'dollpile': {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + p.seedv;
          const px = x + p.w / 2 + Math.cos(a) * p.w * 0.3, py = y + p.h / 2 + Math.sin(a) * p.h * 0.3;
          ctx.fillStyle = ['#b8a898', '#a89080', '#c8b8a8'][i % 3];
          ctx.beginPath(); ctx.arc(px, py, 7, 0, TAU); ctx.fill();
          ctx.fillStyle = '#20181a';
          ctx.fillRect(px - 3, py - 2, 1.6, 1.6); ctx.fillRect(px + 1.5, py - 2, 1.6, 1.6);
        }
        break;
      }
      case 'debris': {
        ctx.fillStyle = 'rgba(90,84,72,0.7)';
        ctx.beginPath();
        ctx.moveTo(x, y + p.h); ctx.lineTo(x + p.w * 0.4, y); ctx.lineTo(x + p.w, y + p.h * 0.7); ctx.closePath();
        ctx.fill();
        break;
      }
      case 'exitmachine': {
        const need = map.def.goalCount - (player ? player.goals : 0);
        ctx.fillStyle = '#2c3540'; ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#5a6a78'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, p.w - 3, p.h - 3);
        // 表示ランプ
        for (let i = 0; i < map.def.goalCount; i++) {
          const on = i < (map.def.goalCount - need);
          ctx.fillStyle = on ? '#6effa0' : '#5a2a2a';
          ctx.beginPath(); ctx.arc(x + 14 + i * 14, y + 12, 4.5, 0, TAU); ctx.fill();
          if (on) { ctx.shadowColor = '#6effa0'; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0; }
        }
        ctx.fillStyle = need <= 0 ? '#7fe0ff' : '#39424c';
        ctx.fillRect(x + 8, y + p.h - 18, p.w - 16, 10);
        break;
      }
      case 'breaker': {
        ctx.fillStyle = '#333b42'; ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#6a7682'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
        ctx.fillStyle = p.on ? '#8ff0b0' : '#7a3a3a';
        ctx.fillRect(x + p.w / 2 - 5, p.on ? y + 6 : y + p.h - 14, 10, 8);
        if (p.on) { ctx.shadowColor = '#8ff0b0'; ctx.shadowBlur = 12; ctx.fillRect(x + p.w / 2 - 5, y + 6, 10, 8); ctx.shadowBlur = 0; }
        break;
      }
      case 'plush': {
        const cx = x + p.w / 2, cy = y + p.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        if (p.used) { ctx.globalAlpha = 0.35; ctx.scale(0.8, 0.55); }
        drawPlushShell(p.kind, 1);
        ctx.restore();
        break;
      }
      case 'valve': {
        const cx = x + p.w / 2, cy = y + p.h / 2;
        ctx.fillStyle = '#4a4038';
        ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.fill();
        ctx.strokeStyle = p.turned ? '#8ff0b0' : '#c86a3a';
        ctx.lineWidth = 3.4;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(p.turned ? 0.8 : 0);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI;
          ctx.beginPath();
          ctx.moveTo(-Math.cos(a) * 13, -Math.sin(a) * 13);
          ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = p.turned ? '#8ff0b0' : '#c86a3a';
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.stroke();
        break;
      }
      case 'furnace': {
        const cx = x + p.w / 2, cy = y + p.h / 2;
        ctx.fillStyle = '#241c18'; ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = '#4a3a30'; ctx.lineWidth = 4; ctx.strokeRect(x + 2, y + 2, p.w - 4, p.h - 4);
        const glow = 0.5 + Math.sin(gameT * 3) * 0.2;
        const gr = ctx.createRadialGradient(cx, cy, 4, cx, cy, p.w * 0.5);
        gr.addColorStop(0, `rgba(255,140,60,${glow})`);
        gr.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = gr; ctx.fillRect(x, y, p.w, p.h);
        break;
      }
      default: {
        ctx.fillStyle = '#3a3730'; ctx.fillRect(x, y, p.w, p.h);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  落ちているアイテム
  // ------------------------------------------------------------
  function drawItem(it) {
    const x = it.x - sx0, y = it.y - sy0;
    if (x < -40 || y < -40 || x > VIEW_W + 40 || y > VIEW_H + 40) return;
    it.t += 0.016;
    const bob = Math.sin(it.t * 2.4) * 3;
    ctx.save();
    ctx.translate(x, y + bob);
    if (it.type === 'battery') {
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-5, -9, 10, 18);
      ctx.fillStyle = '#e8c451'; ctx.fillRect(-5, -9, 10, 6);
      ctx.fillStyle = '#8a8a8a'; ctx.fillRect(-2, -12, 4, 3);
    } else if (it.type === 'bandage') {
      ctx.fillStyle = '#e6e0d0'; ctx.fillRect(-8, -6, 16, 12);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-8, -2, 16, 4);
    } else if (it.type === 'sedative') {
      ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4a7f9e'; ctx.fillRect(-2, -8, 4, 5);
    } else if (it.type === 'note') {
      ctx.fillStyle = '#ded6bd'; ctx.fillRect(-7, -9, 14, 18);
      ctx.strokeStyle = '#9a9078'; ctx.lineWidth = 1; ctx.strokeRect(-7, -9, 14, 18);
      ctx.fillStyle = '#8a8270';
      for (let i = 0; i < 4; i++) ctx.fillRect(-5, -6 + i * 4, 10, 1);
    } else if (it.type === 'goal') {
      ctx.rotate(it.t * 0.6);
      ctx.fillStyle = '#e2b23c'; ctx.fillRect(-9, -9, 18, 18);
      ctx.fillStyle = '#7a5a12'; ctx.fillRect(-5, -5, 10, 10);
    } else if (it.type === 'grabpack') {
      // 背負う本体と、青いゴム手
      ctx.fillStyle = '#1f4356'; ctx.fillRect(-11, -8, 22, 16);
      ctx.strokeStyle = '#0d2836'; ctx.lineWidth = 2; ctx.strokeRect(-11, -8, 22, 16);
      ctx.fillStyle = '#2ea8d8';
      ctx.beginPath(); ctx.arc(-6, 0, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e05a7a';
      ctx.beginPath(); ctx.arc(6, 0, 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#7ce0ff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-11, -10); ctx.lineTo(11, -10); ctx.stroke();
    } else if (it.type === 'mask') {
      ctx.fillStyle = '#f2e6d6';
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 10, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8a8070'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = '#141414';
      ctx.beginPath(); ctx.arc(-3, -2, 1.8, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(3, -2, 1.8, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8a4a5a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 3, 3.4, 0.2, Math.PI - 0.2); ctx.stroke();
    }
    ctx.restore();
    // ほのかな輝き(暗闇でも見つけやすくする)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const big = it.type === 'goal' || it.type === 'grabpack' || it.type === 'mask';
    const col = it.type === 'goal' ? 'rgba(255,190,70,' : it.type === 'grabpack' ? 'rgba(124,224,255,'
      : it.type === 'mask' ? 'rgba(240,230,214,' : it.type === 'note' ? 'rgba(220,210,170,' : 'rgba(120,190,255,';
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 26);
    gr.addColorStop(0, col + (big ? 0.30 : 0.16) + ')');
    gr.addColorStop(1, col + '0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, 26, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawShot(s) {
    const x = s.x - sx0, y = s.y - sy0;
    ctx.save();
    ctx.translate(x, y);
    if (s.kind === 'flare') {
      ctx.fillStyle = '#ff7a3a';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 46);
      gr.addColorStop(0, 'rgba(255,140,60,0.6)'); gr.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 46, 0, TAU); ctx.fill();
    } else {
      ctx.rotate(s.spin);
      ctx.fillStyle = '#b8a88c';
      ctx.fillRect(-6, -3, 12, 6);
      ctx.fillStyle = '#6a5c48'; ctx.fillRect(-6, -3, 12, 2);
    }
    ctx.restore();
  }

  // ============================================================
  //  描画:キャラクター
  // ============================================================
  function shadowUnder(x, y, r, a) {
    ctx.save();
    ctx.globalAlpha = a === undefined ? 0.45 : a;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.42, r * 1.05, r * 0.55, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /**
   * 中身の抜けたぬいぐるみの殻。落ちているときも、かぶっているときも同じ絵を使う。
   * scale=1 で直径およそ 40px。
   */
  function drawPlushShell(kind, scale) {
    ctx.save();
    ctx.scale(scale, scale);
    if (kind === 'bear') {
      ctx.fillStyle = '#6a4a34';
      ctx.beginPath(); ctx.arc(9, -13, 6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(9, 13, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#79573c';
      ctx.beginPath(); ctx.ellipse(-2, 0, 17, 15, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2e2015'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#8d6746';
      ctx.beginPath(); ctx.arc(11, 0, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d8c4a8';
      ctx.beginPath(); ctx.ellipse(16, 0, 4.6, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1410';
      ctx.beginPath(); ctx.arc(19, 0, 2.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(13, -5, 2.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(13, 5, 2.2, 0, TAU); ctx.fill();
    } else if (kind === 'soldier') {
      ctx.fillStyle = '#7a5f3a';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-9, -10, 19, 20, 3) : ctx.rect(-9, -10, 19, 20);
      ctx.fill();
      ctx.strokeStyle = '#2b2015'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#c8a13c'; ctx.fillRect(-3, -8, 2.4, 16);
      ctx.fillStyle = '#d9c3a5';
      ctx.beginPath(); ctx.arc(11, 0, 6.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1e2430';
      ctx.beginPath(); ctx.arc(10, 0, 7, -2.3, 2.3); ctx.fill();
      ctx.fillStyle = '#20242c';
      ctx.fillRect(14, -3.4, 2.4, 2.4); ctx.fillRect(14, 1, 2.4, 2.4);
    } else {
      ctx.fillStyle = '#181418';
      ctx.beginPath(); ctx.ellipse(-4, 0, 13, 11, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8e3b52';
      ctx.beginPath(); ctx.ellipse(-2, 0, 10, 8.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#efe2d6';
      ctx.beginPath(); ctx.arc(8, 0, 7.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.beginPath(); ctx.arc(11, -2.8, 2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(11, 2.8, 2, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#7a3a3a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(13, 0, 2.2, -0.9, 0.9); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(p) {
    const x = p.x - sx0, y = p.y - sy0;
    const c = p.char;
    const crouch = isCrouching() ? 0.86 : 1;
    const bob = Math.sin(p.walk) * 1.6;
    shadowUnder(x, y, 13 * crouch);

    // ぬいぐるみをかぶっている間は、殻だけを描く
    if (p.disguise) {
      ctx.save();
      ctx.translate(x, y + bob * 0.5);
      ctx.rotate(p.aim);
      drawPlushShell(p.disguise.kind, 1.05);
      ctx.restore();
      // 中の人がいる印(自分にだけ見える薄い輪郭)
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(p.aim);

    // 胴体(作業着)
    ctx.fillStyle = '#232529';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12.5 * crouch, 10 * crouch, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    // 背中側の識別色(誰を操作しているか一目で分かるように細い帯で入れる)
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(-5.5 * crouch, 0, 3.4 * crouch, 8.4 * crouch, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.ellipse(1, 0, 7.5 * crouch, 8.6 * crouch, 0, 0, TAU);
    ctx.fill();

    // 腕(懐中電灯を持つ側)
    const swing = p.atkAnim > 0 ? (1 - p.atkAnim / 0.22) : 0;
    ctx.fillStyle = '#2c2f34';
    ctx.fillRect(2, -11, 9, 5);            // 右腕(ライト)
    ctx.fillRect(2, 6, 9, 5);              // 左腕
    // 懐中電灯本体
    ctx.fillStyle = p.lightOn && p.battery > 0 ? '#e6e2d2' : '#6d6a60';
    ctx.fillRect(10, -11.5, 9, 6);
    if (p.lightOn && p.battery > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,240,200,${0.55 * p.flicker})`;
      ctx.beginPath(); ctx.arc(19, -8.5, 4.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // もう片方の手のカメラ(配信者)
    if (c.weapon.type === 'camera') {
      const kick = p.shutter > 0 ? (p.shutter / 0.34) * 2.2 : 0;
      ctx.fillStyle = '#1c1d21';
      ctx.fillRect(9 - kick, 6, 10, 7);
      ctx.fillStyle = '#3a3d44';
      ctx.beginPath(); ctx.arc(17.5 - kick, 9.5, 3.1, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8fd6ff';
      ctx.beginPath(); ctx.arc(17.5 - kick, 9.5, 1.5, 0, TAU); ctx.fill();
      if (p.shutter > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,255,255,${clamp(p.shutter * 2.4, 0, 0.9)})`;
        ctx.beginPath(); ctx.arc(18 - kick, 9.5, 6.5, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    // 頭(上から見下ろすので、後頭部が髪・前が顔)
    ctx.fillStyle = '#e8c9a8';
    ctx.beginPath(); ctx.arc(2, 0, 6.2 * crouch, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#2a2018';
    ctx.beginPath(); ctx.arc(0.6, 0, 6.2 * crouch, 1.4, -1.4); ctx.fill();

    // 猫耳フード(真上から見たときに耳が横へ張り出す)
    if (c.hood === 'cat') drawCatHood(c, crouch);

    // 武器の振り
    if (p.atkAnim > 0 && c.weapon.type !== 'camera') {
      const a0 = -c.weapon.arc + swing * c.weapon.arc * 2;
      ctx.save();
      ctx.rotate(a0);
      ctx.strokeStyle = 'rgba(230,230,220,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(c.weapon.reach * 0.82, 0); ctx.stroke();
      ctx.restore();
      // 軌跡
      ctx.save();
      ctx.globalAlpha = 0.35 * (1 - swing);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, c.weapon.reach * 0.75, -c.weapon.arc, -c.weapon.arc + swing * c.weapon.arc * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // 被弾フラッシュ
    if (p.hurtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(p.hurtFlash * 1.4, 0, 0.5);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff4a4a';
      ctx.beginPath(); ctx.arc(x, y, 17, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  /**
   * 猫耳フード。見下ろし視点なので、後頭部を覆うフードの縁と、
   * 左右へ張り出した三角の耳で「猫っぽさ」を出す。
   */
  function drawCatHood(c, crouch) {
    const k = crouch;
    // フードの縁(顔まわりをぐるりと囲む)
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(1.2, 0, 8.6 * k, 1.02, -1.02);
    ctx.arc(1.2, 0, 6.0 * k, -1.02, 1.02, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.1; ctx.stroke();
    // 後頭部の布
    ctx.fillStyle = c.accent;
    ctx.beginPath(); ctx.arc(-0.6, 0, 7.6 * k, 1.6, -1.6); ctx.fill();
    // 耳(左右)
    for (const s of [-1, 1]) {
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(-1.6, 5.0 * k * s);
      ctx.lineTo(5.2, 6.4 * k * s);
      ctx.lineTo(0.4, 11.8 * k * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      // 耳の内側
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(0.2, 6.2 * k * s);
      ctx.lineTo(3.8, 7.1 * k * s);
      ctx.lineTo(1.2, 9.8 * k * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawHidingPlayer(p) {
    const pr = p.hiding;
    const x = pr.x + pr.w / 2 - sx0, y = pr.y + pr.h / 2 - sy0;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = p.char.color;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  敵
  // ------------------------------------------------------------
  function drawEnemy(e) {
    const x = e.x - sx0, y = e.y - sy0;
    if (x < -70 || y < -70 || x > VIEW_W + 70 || y > VIEW_H + 70) return;

    if (e.dead) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - e.deadT / 14, 0, 1) * 0.8;
      ctx.translate(x, y); ctx.rotate(e.angle + 1.2);
      ctx.fillStyle = '#4a443a';
      ctx.beginPath(); ctx.ellipse(0, 0, e.r * 1.1, e.r * 0.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a2620';
      ctx.fillRect(-e.r * 0.6, -3, e.r * 1.2, 6);
      ctx.restore();
      return;
    }

    ctx.save();
    if (e.phantom) ctx.globalAlpha = clamp(e.life / 2, 0, 1) * 0.55;
    if (e.charmed) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(180,140,255,0.25)';
      ctx.beginPath(); ctx.arc(x, y, e.r + 8, 0, TAU); ctx.fill();
      ctx.restore();
    }
    shadowUnder(x, y, e.r);
    ctx.translate(x, y);
    ctx.rotate(e.angle);

    const flash = e.hitFlash > 0;
    switch (e.kind) {
      case 'soldier': drawSoldier(e, flash); break;
      case 'doll': drawDoll(e, flash); break;
      case 'bear': drawBear(e, flash); break;
      case 'jack': drawJack(e, flash); break;
      case 'marion': drawMarion(e, flash); break;
      default: drawSoldier(e, flash);
    }
    ctx.restore();

    // 体力バー(ダメージを与えた直後だけ)
    if (e.hp < e.maxHp && !e.phantom) {
      const w = 30, h = 3.5;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2, y - e.r - 14, w, h);
      ctx.fillStyle = e.charmed ? '#b78cff' : '#d05050';
      ctx.fillRect(x - w / 2, y - e.r - 14, w * clamp(e.hp / e.maxHp, 0, 1), h);
      ctx.restore();
    }
    // ひるみ・警戒の表示
    if (e.stun > 0) drawStatusIcon(x, y - e.r - 22, '💫');
    else if (e.state === 'search') drawStatusIcon(x, y - e.r - 22, '❓');
    else if (e.state === 'chase' && !e.charmed) drawStatusIcon(x, y - e.r - 22, '❗');
  }

  function drawStatusIcon(x, y, ch) {
    ctx.save();
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.9;
    ctx.fillText(ch, x, y);
    ctx.restore();
  }

  function drawSoldier(e, flash) {
    const step = Math.sin(e.anim * 7) * 2.4;
    // 脚
    ctx.fillStyle = '#2b2f3a';
    ctx.fillRect(-4, -9 + step, 6, 6);
    ctx.fillRect(-4, 3 - step, 6, 6);
    // 胴(ブリキ)
    ctx.fillStyle = flash ? '#ffffff' : '#7a5f3a';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-8, -9, 17, 18, 3) : ctx.rect(-8, -9, 17, 18);
    ctx.fill();
    ctx.strokeStyle = '#2b2015'; ctx.lineWidth = 1.6; ctx.stroke();
    // 胸の飾緒
    ctx.fillStyle = '#c8a13c';
    ctx.fillRect(-2, -7, 2, 14);
    // 背中のぜんまい
    ctx.save();
    ctx.translate(-10, 0); ctx.rotate(e.anim * (e.state === 'chase' ? 8 : 3));
    ctx.strokeStyle = '#b8b0a0'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.stroke();
    ctx.restore();
    // 頭と軍帽
    ctx.fillStyle = flash ? '#fff' : '#d9c3a5';
    ctx.beginPath(); ctx.arc(8, 0, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1e2430';
    ctx.beginPath(); ctx.arc(7, 0, 6.4, -2.3, 2.3); ctx.fill();
    // 目
    ctx.fillStyle = '#ff5a4a';
    ctx.fillRect(11, -3.2, 2.4, 2.2);
    ctx.fillRect(11, 1.0, 2.4, 2.2);
  }

  function drawDoll(e, flash) {
    const crawl = Math.sin(e.anim * (e.frozen ? 0 : 11)) * 3;
    // 髪
    ctx.fillStyle = '#181418';
    ctx.beginPath(); ctx.ellipse(-4, 0, 12, 10, 0, 0, TAU); ctx.fill();
    // 腕(這う)
    ctx.strokeStyle = '#ded2c6'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(2, -5); ctx.lineTo(13, -9 + crawl); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 5); ctx.lineTo(13, 9 - crawl); ctx.stroke();
    // 胴(ワンピース)
    ctx.fillStyle = flash ? '#fff' : '#8e3b52';
    ctx.beginPath(); ctx.ellipse(-3, 0, 9, 7.5, 0, 0, TAU); ctx.fill();
    // 頭
    ctx.fillStyle = flash ? '#fff' : '#efe2d6';
    ctx.beginPath(); ctx.arc(6, 0, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(90,70,70,0.6)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(7, -1); ctx.lineTo(5, 3); ctx.stroke();   // ひび
    // 目
    ctx.fillStyle = e.frozen ? '#2a2a2a' : '#111';
    ctx.beginPath(); ctx.arc(9, -2.6, 1.9, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(9, 2.6, 1.9, 0, TAU); ctx.fill();
    if (!e.frozen) {
      ctx.fillStyle = '#ff3a3a';
      ctx.beginPath(); ctx.arc(9.4, -2.6, 0.9, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(9.4, 2.6, 0.9, 0, TAU); ctx.fill();
    }
    // 口
    ctx.strokeStyle = '#7a3a3a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(11, 0, 2.2, -0.9, 0.9); ctx.stroke();
    if (e.frozen) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(180,220,255,0.10)';
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawBear(e, flash) {
    const breath = 1 + Math.sin(e.anim * 3) * 0.03;
    const wind = e.windup > 0 ? 1 + (0.62 - e.windup) * 0.5 : 1;
    ctx.scale(breath * wind, breath);
    // 耳
    ctx.fillStyle = flash ? '#fff' : '#6a4a34';
    ctx.beginPath(); ctx.arc(9, -13, 6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(9, 13, 6, 0, TAU); ctx.fill();
    // 腕
    ctx.fillStyle = '#5c3f2c';
    ctx.beginPath(); ctx.ellipse(6, -16, 8, 6, 0.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, 16, 8, 6, -0.4, 0, TAU); ctx.fill();
    // 胴
    ctx.fillStyle = flash ? '#fff' : '#79573c';
    ctx.beginPath(); ctx.ellipse(-2, 0, 17, 15, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2e2015'; ctx.lineWidth = 2; ctx.stroke();
    // 破れた腹の縫い目
    ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = -8; i <= 8; i += 4) { ctx.moveTo(-6, i); ctx.lineTo(-1, i + 2); }
    ctx.stroke();
    // 顔
    ctx.fillStyle = flash ? '#fff' : '#8d6746';
    ctx.beginPath(); ctx.arc(12, 0, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d8c4a8';
    ctx.beginPath(); ctx.ellipse(17, 0, 5, 4.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1410';
    ctx.beginPath(); ctx.arc(20, 0, 2.4, 0, TAU); ctx.fill();
    // 片方だけボタンの目
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath(); ctx.arc(14, -5.5, 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(14, -5.5, 1.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(12, 4); ctx.lineTo(17, 7); ctx.stroke();
    if (e.windup > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,70,50,${0.3 + Math.sin(gameT * 30) * 0.2})`;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawJack(e, flash) {
    const hidden = e.state === 'hide';
    // 箱
    ctx.fillStyle = flash ? '#fff' : '#3f5a7a';
    ctx.fillRect(-11, -11, 22, 22);
    ctx.strokeStyle = '#1b2836'; ctx.lineWidth = 2; ctx.strokeRect(-11, -11, 22, 22);
    ctx.fillStyle = '#c9a13c';
    ctx.fillRect(-11, -2, 22, 4);
    if (hidden) {
      // ハンドル
      ctx.strokeStyle = '#c9a13c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(13, 0, 5, -1.4, 1.4); ctx.stroke();
      return;
    }
    // バネ
    const t = Math.sin(e.anim * 12) * 3;
    ctx.strokeStyle = '#b0b0b8'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      ctx.moveTo(6 + i * 3, -4 + (i % 2 ? 4 : -4) + t * 0.3);
      ctx.lineTo(9 + i * 3, 4 + (i % 2 ? -4 : 4) + t * 0.3);
    }
    ctx.stroke();
    // 道化の頭
    ctx.fillStyle = flash ? '#fff' : '#eee2d4';
    ctx.beginPath(); ctx.arc(24 + t, 0, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b83a5a';
    ctx.beginPath(); ctx.arc(30 + t, 0, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(26 + t, -3.4, 1.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(26 + t, 3.4, 1.8, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#7a2030'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(25 + t, 0, 5, -1.1, 1.1); ctx.stroke();
    // 三角帽
    ctx.fillStyle = '#7a3a8a';
    ctx.beginPath(); ctx.moveTo(20 + t, -7); ctx.lineTo(18 + t, -14); ctx.lineTo(26 + t, -7); ctx.closePath(); ctx.fill();
  }

  function drawMarion(e, flash) {
    // 糸
    ctx.strokeStyle = 'rgba(200,200,190,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-4, -8); ctx.lineTo(-16, -30);
    ctx.moveTo(-4, 8); ctx.lineTo(-16, 30);
    ctx.stroke();
    // 手足(棒)
    ctx.strokeStyle = flash ? '#fff' : '#8a7050'; ctx.lineWidth = 3;
    const sw = Math.sin(e.anim * 5) * 4;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(9, -12 + sw); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(9, 12 - sw); ctx.stroke();
    // 胴
    ctx.fillStyle = flash ? '#fff' : '#9a7d55';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.strokeStyle = '#3a2c18'; ctx.lineWidth = 1.4; ctx.strokeRect(-7, -7, 14, 14);
    // 頭
    ctx.fillStyle = flash ? '#fff' : '#c8ab80';
    ctx.beginPath(); ctx.arc(9, 0, 6.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(11, -3, 2, 2.2); ctx.fillRect(11, 1, 2, 2.2);
    ctx.strokeStyle = '#4a3a20'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, 4.4); ctx.lineTo(14, 4.4); ctx.stroke();
  }

  // ------------------------------------------------------------
  //  ボス:マザー
  // ------------------------------------------------------------
  function drawBoss(b) {
    const x = b.x - sx0, y = b.y - sy0;
    if (b.dead && b.deadT > 4) return;
    shadowUnder(x, y, b.r, 0.55);
    ctx.save();
    ctx.translate(x, y);
    if (b.dead) {
      ctx.globalAlpha = clamp(1 - b.deadT / 4, 0, 1);
      ctx.rotate(b.angle + b.deadT * 0.4);
      ctx.scale(1 + b.deadT * 0.05, 1 - b.deadT * 0.08);
    } else ctx.rotate(b.angle);

    const flash = b.hitFlash > 0;
    const breathe = 1 + Math.sin(b.anim * 1.6) * 0.02;
    ctx.scale(breathe, breathe);

    // 腕(4本)
    ctx.strokeStyle = flash ? '#fff' : '#6a5a48';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    const sw = Math.sin(b.anim * 2.2) * 0.25 + (b.sweep > 0 ? (0.95 - b.sweep) * 2.4 : 0);
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.rotate(s * (0.75 + sw * s * 0.4));
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(74, 0); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#59493a';
      ctx.beginPath(); ctx.arc(76, 0, 12, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.rotate(s * 1.9);
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(52, 0); ctx.stroke();
      ctx.restore();
    }

    // 胴体(積み上がった玩具)
    ctx.fillStyle = flash ? '#ffffff' : '#4e4238';
    ctx.beginPath(); ctx.ellipse(0, 0, 46, 40, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#241c16'; ctx.lineWidth = 4; ctx.stroke();
    // 縫い合わされた人形の顔
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + b.anim * 0.12;
      const px = Math.cos(a) * 30, py = Math.sin(a) * 26;
      ctx.fillStyle = '#8d7a66';
      ctx.beginPath(); ctx.arc(px, py, 7.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#140f0c';
      ctx.beginPath(); ctx.arc(px - 2, py - 2, 1.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 2, py - 2, 1.6, 0, TAU); ctx.fill();
    }

    // 炉心
    const open = b.heartOpen > 0;
    ctx.save();
    if (open) {
      const pulse = 0.6 + Math.sin(b.anim * 8) * 0.3;
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
      gr.addColorStop(0, `rgba(255,190,90,${pulse})`);
      gr.addColorStop(0.5, `rgba(255,90,30,${pulse * 0.6})`);
      gr.addColorStop(1, 'rgba(255,40,10,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 42, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffcb6a';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill();
    } else {
      // 閉じた装甲
      ctx.fillStyle = '#2f2a24';
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#584c3e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(255,80,30,0.25)';
      ctx.fillRect(-15, -1.5, 30, 3);
    }
    ctx.restore();

    // 頭
    ctx.fillStyle = flash ? '#fff' : '#e0cfbc';
    ctx.beginPath(); ctx.arc(34, 0, 19, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2b211a'; ctx.lineWidth = 3; ctx.stroke();
    // ひび
    ctx.strokeStyle = 'rgba(80,60,50,0.7)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(28, -16); ctx.lineTo(36, -4); ctx.lineTo(30, 6); ctx.stroke();
    // 目
    ctx.fillStyle = '#120d0a';
    ctx.beginPath(); ctx.arc(40, -7, 5.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(40, 7, 5.4, 0, TAU); ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = b.phase >= 3 ? 'rgba(255,60,40,0.95)' : 'rgba(255,140,60,0.85)';
    ctx.beginPath(); ctx.arc(41.5, -7, 2.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(41.5, 7, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
    // 口
    ctx.strokeStyle = '#4a2a24'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(46, 0, 7, -1.1, 1.1); ctx.stroke();
    ctx.restore();

    // 攻撃の予告(足元の円)
    if (b.slam > 0 && !b.slamHit) {
      ctx.save();
      const k = 1 - b.slam / 0.85;
      ctx.strokeStyle = `rgba(255,90,40,${0.25 + k * 0.55})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 230 * k, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (b.sweep > 0 && !b.sweepHit) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#ff6a3a';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, 150, b.sweepA - 1.1, b.sweepA + 1.1);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ============================================================
  //  描画:ライティング
  // ============================================================
  function polyPath(c, poly) {
    c.beginPath();
    if (!poly.length) return;
    c.moveTo(poly[0].x - sx0, poly[0].y - sy0);
    for (let i = 1; i < poly.length; i++) c.lineTo(poly[i].x - sx0, poly[i].y - sy0);
    c.closePath();
  }

  function eraseRadial(c, x, y, r, a, soft) {
    const gr = c.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(0,0,0,${a})`);
    gr.addColorStop(soft === undefined ? 0.55 : soft, `rgba(0,0,0,${a * 0.62})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  /** 静止した光源用の、粗い(等角)可視ポリゴン。一度だけ計算してキャッシュする。 */
  function computeVisibilityCoarse(px, py, R, rays) {
    const segs = [];
    const x0 = px - R, x1 = px + R, y0 = py - R, y1 = py + R;
    for (const s of map.segs) {
      if (s.maxx < x0 || s.minx > x1 || s.maxy < y0 || s.miny > y1) continue;
      segs.push(s);
    }
    const pts = [];
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU;
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = R;
      for (let k = 0; k < segs.length; k++) {
        const t = rayHit(px, py, dx, dy, segs[k]);
        if (t !== null && t < best) best = t;
      }
      pts.push({ x: px + dx * best, y: py + dy * best });
    }
    return pts;
  }

  function drawLighting() {
    const p = player;
    const px = p.x - sx0, py = p.y - sy0;

    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = (map.def && map.def.fog) || '#06080b';
    lctx.fillRect(0, 0, VIEW_W, VIEW_H);
    lctx.globalCompositeOperation = 'destination-out';

    // --- プレイヤーの光(壁で切られる) ---
    lctx.save();
    polyPath(lctx, visPoly);
    lctx.clip();
    eraseRadial(lctx, px, py, AMBIENT_R * (p.hiding ? 0.5 : 1), 0.9, 0.5);
    if (p.lightOn && p.battery > 0 && !p.hiding) {
      const R = p.lightRangeNow, arc = p.lightArcNow;
      const layers = [[1.32, 0.36], [0.92, 0.46], [0.56, 0.54], [0.28, 0.58]];
      for (const [wMul, a] of layers) {
        lctx.save();
        lctx.beginPath();
        lctx.moveTo(px, py);
        lctx.arc(px, py, R, p.aim - arc * wMul, p.aim + arc * wMul);
        lctx.closePath();
        lctx.clip();
        eraseRadial(lctx, px, py, R, a * p.flicker, 0.62);
        lctx.restore();
      }
    }
    lctx.restore();

    // --- 据え置き照明 ---
    for (const L of lamps) {
      if (!L.on || L.broken) continue;
      const lx = L.x - sx0, ly = L.y - sy0;
      if (lx < -L.r || ly < -L.r || lx > VIEW_W + L.r || ly > VIEW_H + L.r) continue;
      if (!L.poly) L.poly = computeVisibilityCoarse(L.x, L.y, L.r, 44);
      lctx.save();
      polyPath(lctx, L.poly);
      lctx.clip();
      eraseRadial(lctx, lx, ly, L.r, 0.80 * clamp(L.k === undefined ? 1 : L.k, 0, 1), 0.45);
      lctx.restore();
    }

    lctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = DARKNESS;
    ctx.drawImage(lightCv, 0, 0);
    ctx.restore();

    // --- 光そのものの見え方(加算) ---
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (p.lightOn && p.battery > 0 && !p.hiding) {
      const R = p.lightRangeNow, arc = p.lightArcNow;
      ctx.save();
      polyPath(ctx, visPoly); ctx.clip();
      ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, R, p.aim - arc, p.aim + arc); ctx.closePath(); ctx.clip();
      const gr = ctx.createRadialGradient(px, py, 0, px, py, R);
      const beam = (p.focus ? 0.32 : 0.20) * p.flicker;
      gr.addColorStop(0, `rgba(255,238,198,${beam})`);
      gr.addColorStop(0.45, `rgba(255,226,170,${beam * 0.5})`);
      gr.addColorStop(1, 'rgba(255,210,140,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }
    for (const L of lamps) {
      if (!L.on || L.broken) continue;
      const lx = L.x - sx0, ly = L.y - sy0;
      if (lx < -L.r || ly < -L.r || lx > VIEW_W + L.r || ly > VIEW_H + L.r) continue;
      const k = clamp(L.k === undefined ? 1 : L.k, 0, 1);
      const gr = ctx.createRadialGradient(lx, ly, 0, lx, ly, L.r);
      gr.addColorStop(0, hexA(L.color, 0.24 * k));
      gr.addColorStop(1, hexA(L.color, 0));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(lx, ly, L.r, 0, TAU); ctx.fill();
    }
    // 発光パーティクル
    for (const pa of parts) {
      if (!pa.glow) continue;
      ctx.globalAlpha = clamp(pa.life / pa.max, 0, 1);
      ctx.fillStyle = pa.c;
      ctx.beginPath(); ctx.arc(pa.x - sx0, pa.y - sy0, pa.r * 1.6, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /** 暗闇の中で光る目。姿は見えないが、そこに居ることだけが分かる。 */
  function drawEyesInDark() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of enemies) {
      if (e.dead || e.phantom) continue;
      const d = dist(player.x, player.y, e.x, e.y);
      if (d > 420) continue;
      if (litAt(e.x, e.y)) continue;
      if (!losClear(player.x, player.y, e.x, e.y)) continue;
      const a = clamp(1 - d / 420, 0, 1) * 0.85;
      const ex = e.x - sx0, ey = e.y - sy0;
      const dx = Math.cos(e.angle), dy = Math.sin(e.angle);
      const nx = -dy, ny = dx;
      const col = e.charmed ? 'rgba(190,150,255,' : 'rgba(255,70,50,';
      for (const s of [-1, 1]) {
        const gx = ex + dx * e.r * 0.55 + nx * s * 3.2;
        const gy = ey + dy * e.r * 0.55 + ny * s * 3.2;
        const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 7);
        gr.addColorStop(0, col + a + ')');
        gr.addColorStop(1, col + '0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(gx, gy, 7, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 「工場の記憶」発動中の壁透視。 */
  function drawXray() {
    if (player.memoryT <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(gameT * 5) * 0.1;
    for (const e of enemies) {
      if (e.dead || e.phantom) continue;
      const x = e.x - sx0, y = e.y - sy0;
      ctx.strokeStyle = e.charmed ? '#c9a7ff' : '#8ae6b8';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, e.r + 3, 0, TAU); ctx.stroke();
    }
    for (const it of items) {
      if (it.type !== 'goal' && it.type !== 'note') continue;
      const x = it.x - sx0, y = it.y - sy0;
      ctx.strokeStyle = it.type === 'goal' ? '#ffd766' : '#dcd2aa';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 9, y - 9, 18, 18);
    }
    if (map.exit) {
      ctx.strokeStyle = '#8ad4ff'; ctx.lineWidth = 2.5;
      ctx.strokeRect(map.exit.x - sx0 - 20, map.exit.y - sy0 - 16, 40, 32);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  ワールド上のUI(浮かぶ文字・調べるヒント)
  // ------------------------------------------------------------
  /** シャッターを切った瞬間のファインダー枠とストロボ。 */
  function drawShutterFrame(p) {
    const k = clamp(p.shutter / 0.34, 0, 1);
    const cx = p.x + Math.cos(p.atkDir) * 150 - sx0;
    const cy = p.y + Math.sin(p.atkDir) * 150 - sy0;
    const half = lerp(56, 82, k) ;
    ctx.save();
    // ストロボの扇
    ctx.globalCompositeOperation = 'lighter';
    const px = p.x - sx0, py = p.y - sy0;
    const gr = ctx.createRadialGradient(px, py, 0, px, py, 240);
    gr.addColorStop(0, `rgba(255,255,255,${0.30 * k})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 240, p.atkDir - 0.5, p.atkDir + 0.5);
    ctx.closePath();
    ctx.fillStyle = gr;
    ctx.fill();
    // ファインダーの四隅
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * k})`;
    ctx.lineWidth = 2;
    const arm = 20;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + half * sx, y = cy + half * 0.68 * sy;
      ctx.beginPath();
      ctx.moveTo(x - arm * sx, y); ctx.lineTo(x, y); ctx.lineTo(x, y - arm * sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWorldUI() {
    if (player.shutter > 0) drawShutterFrame(player);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    for (const f of floats) {
      ctx.globalAlpha = clamp(f.life / 0.9, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(f.text, f.x - sx0 + 1, f.y - sy0 + 1);
      ctx.fillStyle = f.c;
      ctx.fillText(f.text, f.x - sx0, f.y - sy0);
    }
    ctx.restore();

    // 目標の方向を示す小さな矢印(画面外にあるとき)
    if (map.exit && objectiveComplete()) drawOffscreenMarker(map.exit.x, map.exit.y, '#8ad4ff');
    for (const it of items) {
      if ((it.type === 'goal' || it.type === 'grabpack' || it.type === 'mask') && dist(player.x, player.y, it.x, it.y) < 900) {
        drawOffscreenMarker(it.x, it.y, it.type === 'grabpack' ? '#7ce0ff' : '#ffd766');
      }
    }
    if (stalker) drawOffscreenMarker(stalker.x, stalker.y, stalker.def.color);

    const t = state === 'play' ? findInteract(player) : null;
    const hint = $('interact-hint');
    if (hint) {
      if (t) {
        hint.textContent = (touch.on ? '' : 'E ') + t.label;
        hint.classList.remove('hidden');
        hint.style.left = ((t.x - sx0) / VIEW_W * 100) + '%';
        hint.style.top = ((t.y - sy0 - 36) / VIEW_H * 100) + '%';
      } else hint.classList.add('hidden');
    }
  }

  function drawOffscreenMarker(wx, wy, color) {
    const x = wx - sx0, y = wy - sy0;
    if (x > 30 && x < VIEW_W - 30 && y > 30 && y < VIEW_H - 30) return;
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    const a = Math.atan2(y - cy, x - cx);
    const rx = cx + Math.cos(a) * (VIEW_W / 2 - 34);
    const ry = cy + Math.sin(a) * (VIEW_H / 2 - 34);
    ctx.save();
    ctx.translate(rx, ry); ctx.rotate(a);
    ctx.globalAlpha = 0.55 + Math.sin(gameT * 4) * 0.2;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
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
    // 「工場の記憶」中は敵も見える
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
        <div class="cc-weapon">${c.weapon.type === 'camera' ? '📷' : '🔨'} ${c.weapon.name}</div>
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
        <div><span>破壊した玩具</span><b>${player ? player.killCount : 0}</b></div>
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
      '検品印が、静かに押された。',
      '工場の灯りが、ひとつだけ点いた。',
    ];
    if (box) box.innerHTML = `<p class="over-flavor">${causes[Math.floor(Math.random() * causes.length)]}</p>${statLine()}`;
  }

  function fillWin() {
    const box = $('win-body');
    run.stats.floorName = '焼却炉ホール';
    const allNotes = run.notes.length >= NOTES.length;
    if (box) {
      box.innerHTML = `
        <p class="win-flavor">炉の火が落ちる。積み上がった玩具が、ひとつずつ床にこぼれていく。<br>
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
    HUD['hud-floor'].textContent = (map.def.chapter ? 'CH.' + map.def.chapter + '　' : '') + map.def.name;

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
      // 検品長は動かない。部屋の主として居座る。
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

    if (s.mode === 'mission') { updateInspector(dt); return; }

    if (s.stagger > 0) { s.stagger -= dt; return; }

    const d = dist(s.x, s.y, player.x, player.y);
    // 変装していても、章のボスは近づけば匂いで気づく
    const sightR = disguised(player) ? 130 : 520;
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

    // 眠り煙(ネムリネコ)
    if (s.def.gas) {
      s.gasT -= dt;
      if (s.gasT <= 0) {
        s.gasT = rnd(3.2, 5.4);
        gasClouds.push({ x: s.x, y: s.y, r: 12, max: rnd(90, 140), life: 11, t: 0 });
        Audio2.sfx.whisper();
      }
    }
  }

  /** 検品長。動かず、催促だけしてくる。 */
  function updateInspector(dt) {
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
        const e = spawnEnemy(pick(['soldier', 'doll', 'marion']), p.x, p.y, r);
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

  function drawGas() {
    if (!gasClouds.length) return;
    ctx.save();
    for (const g of gasClouds) {
      const x = g.x - sx0, y = g.y - sy0;
      const a = clamp(g.life / 11, 0, 1) * 0.5;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, g.r);
      gr.addColorStop(0, `rgba(190,40,60,${a * 0.8})`);
      gr.addColorStop(0.6, `rgba(140,50,120,${a * 0.45})`);
      gr.addColorStop(1, 'rgba(90,30,90,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, g.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  チャプターボスの描画
  // ------------------------------------------------------------
  function drawStalker() {
    if (!stalker) return;
    const s = stalker;
    const x = s.x - sx0, y = s.y - sy0;
    if (x < -160 || y < -160 || x > VIEW_W + 160 || y > VIEW_H + 160) return;
    const lit = litAt(s.x, s.y);
    shadowUnder(x, y, s.r, 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(s.angle);
    ctx.scale(s.r / s.def.art, s.r / s.def.art);   // 絵は art の大きさで描いてあるので合わせる
    if (s.def.id === 'warden') drawWarden(s);
    else if (s.def.id === 'inspector') drawInspectorBoss(s);
    else drawNemuri(s);
    ctx.restore();
    // 暗闇でも目だけは光る
    if (!lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const col = s.def.id === 'nemuri' ? 'rgba(255,215,80,' : 'rgba(255,80,50,';
      const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
      const nx = -dy, ny = dx;
      for (const sd of [-1, 1]) {
        const gx = x + dx * s.r * 0.6 + nx * sd * s.r * 0.28;
        const gy = y + dy * s.r * 0.6 + ny * sd * s.r * 0.28;
        const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, 14);
        gr.addColorStop(0, col + '0.95)');
        gr.addColorStop(1, col + '0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(gx, gy, 14, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawWarden(s) {
    const flash = s.hitFlash > 0;
    const step = Math.sin(s.anim * 5) * 4;
    ctx.fillStyle = '#232a36';
    ctx.fillRect(-10, -18 + step, 12, 12);
    ctx.fillRect(-10, 6 - step, 12, 12);
    // 胴
    ctx.fillStyle = flash ? '#fff' : '#8a6a3c';
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 20, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2b2015'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#c8a13c';
    ctx.fillRect(-6, -16, 5, 32);
    // 背中の巨大ぜんまい
    ctx.save();
    ctx.translate(-20, 0); ctx.rotate(s.anim * (s.stagger > 0 ? 0.6 : 3.2));
    ctx.strokeStyle = flash ? '#fff' : '#c0b8a4'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.moveTo(0, -11); ctx.lineTo(0, 11);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.stroke();
    ctx.restore();
    // 頭と軍帽
    ctx.fillStyle = flash ? '#fff' : '#dcc6a6';
    ctx.beginPath(); ctx.arc(15, 0, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b2230';
    ctx.beginPath(); ctx.arc(13, 0, 12.6, -2.3, 2.3); ctx.fill();
    ctx.fillStyle = '#c8a13c';
    ctx.beginPath(); ctx.arc(10, 0, 5, -1.2, 1.2); ctx.fill();
    // 目
    ctx.fillStyle = '#ff5a4a';
    ctx.fillRect(21, -6, 5, 4);
    ctx.fillRect(21, 2, 5, 4);
    // 持っているカンテラ
    ctx.save();
    ctx.translate(10, 20);
    ctx.fillStyle = '#4a4438'; ctx.fillRect(-5, -6, 10, 12);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,180,80,0.6)';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawInspectorBoss(s) {
    const flash = s.hitFlash > 0;
    const sway = Math.sin(s.anim * 1.4) * 3;
    // 天井から降りている糸
    ctx.strokeStyle = 'rgba(210,210,200,0.35)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-6, -10); ctx.lineTo(-26, -60);
    ctx.moveTo(-6, 10); ctx.lineTo(-26, 60);
    ctx.stroke();
    // 細長い腕
    ctx.strokeStyle = flash ? '#fff' : '#9a8f78'; ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(2, -8); ctx.lineTo(26, -30 + sway); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 8); ctx.lineTo(26, 30 - sway); ctx.stroke();
    // 胴(検品着)
    ctx.fillStyle = flash ? '#fff' : '#dfe6df';
    ctx.beginPath(); ctx.ellipse(-6, 0, 17, 15, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2f3a33'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.fillStyle = '#8ae6b8';
    ctx.fillRect(-16, -3, 22, 6);
    // 首
    ctx.strokeStyle = flash ? '#fff' : '#c8bda8'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(14, 0); ctx.stroke();
    // 頭
    ctx.fillStyle = flash ? '#fff' : '#f2e6d6';
    ctx.beginPath(); ctx.arc(22, 0, 12, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2f3a33'; ctx.lineWidth = 2; ctx.stroke();
    // 顔がない(仕事3で取り戻す)
    if (map.missions && map.missions[2] && map.missions[2].done > 0) {
      ctx.fillStyle = '#141414';
      ctx.beginPath(); ctx.arc(26, -4.5, 2.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(26, 4.5, 2.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8a4a5a'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(29, 0, 4.5, -1.0, 1.0); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(120,110,100,0.55)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(17, -8); ctx.lineTo(28, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(28, -7); ctx.lineTo(18, 8); ctx.stroke();
    }
    // 検品判
    ctx.save();
    ctx.translate(26, 30 - sway);
    ctx.fillStyle = '#7a2030';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }

  /** 紫の巨大ぬいぐるみ猫。とがった長い耳と、裂けた笑いが特徴。 */
  function drawNemuri(s) {
    const flash = s.hitFlash > 0;
    const breathe = 1 + Math.sin(s.anim * 2.2) * 0.035;
    ctx.scale(breathe, breathe);
    const body = flash ? '#ffffff' : '#8f63d8';
    const dark = flash ? '#dddddd' : '#6a45a8';

    // 尾
    ctx.strokeStyle = dark; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-26, 0);
    ctx.quadraticCurveTo(-52, Math.sin(s.anim * 2) * 26, -66, Math.sin(s.anim * 2) * 40);
    ctx.stroke();
    // 手足
    ctx.fillStyle = dark;
    for (const sd of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(8, sd * 26, 12, 8, sd * 0.35, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-14, sd * 24, 11, 8, -sd * 0.3, 0, TAU); ctx.fill();
    }
    // 胴
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(-8, 0, 26, 24, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2c1c46'; ctx.lineWidth = 3; ctx.stroke();
    // 腹の明るい面
    ctx.fillStyle = flash ? '#eee' : '#c6a6f2';
    ctx.beginPath(); ctx.ellipse(-4, 0, 15, 15, 0, 0, TAU); ctx.fill();
    // 赤い首輪(名札つき)
    ctx.strokeStyle = '#b4283c'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(-6, 0, 24, -1.15, 1.15); ctx.stroke();
    ctx.fillStyle = '#e8c451';
    ctx.beginPath(); ctx.arc(18, 0, 4.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#7a5a10'; ctx.lineWidth = 1.2; ctx.stroke();

    // 耳(頭から長く伸びるとがった三角)
    for (const sd of [-1, 1]) {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(26, sd * 12);
      ctx.lineTo(48, sd * 34);
      ctx.lineTo(40, sd * 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2c1c46'; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.fillStyle = '#4a2c6a';
      ctx.beginPath();
      ctx.moveTo(30, sd * 13);
      ctx.lineTo(43, sd * 27);
      ctx.lineTo(38, sd * 9);
      ctx.closePath();
      ctx.fill();
    }
    // 頭
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(32, 0, 19, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2c1c46'; ctx.lineWidth = 3; ctx.stroke();
    // 目(細く垂れた三日月)
    for (const sd of [-1, 1]) {
      ctx.save();
      ctx.translate(36, sd * 8.5);
      ctx.rotate(sd * 0.55);
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath(); ctx.ellipse(0, 0, 6.8, 4.2, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a2a08'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#2a1030';
      ctx.beginPath(); ctx.ellipse(1.6, 0, 1.8, 3.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // 裂けた笑い
    ctx.strokeStyle = '#3a0f22'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(41, 0, 11.5, -1.2, 1.2); ctx.stroke();
    ctx.strokeStyle = '#f4e6ff'; ctx.lineWidth = 1.8;
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.46;
      ctx.beginPath();
      ctx.moveTo(41 + Math.cos(a) * 11.5, Math.sin(a) * 11.5);
      ctx.lineTo(41 + Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.stroke();
    }
    // 鼻
    ctx.fillStyle = '#e05a7a';
    ctx.beginPath();
    ctx.moveTo(49, -3); ctx.lineTo(49, 3); ctx.lineTo(53, 0);
    ctx.closePath(); ctx.fill();
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

  function drawGrab() {
    const p = player;
    const g = p.grabHand;
    if (!g) return;
    const hx = g.x - sx0, hy = g.y - sy0;
    const px = p.x - sx0, py = p.y - sy0;
    ctx.save();
    // ワイヤ(たわませる)
    const mx = (px + hx) / 2, my = (py + hy) / 2 + Math.min(24, dist(px, py, hx, hy) * 0.10);
    ctx.strokeStyle = '#7ce0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(mx, my, hx, hy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,220,255,0.35)';
    ctx.lineWidth = 5;
    ctx.stroke();
    // 手
    ctx.translate(hx, hy);
    ctx.rotate(Math.atan2(hy - py, hx - px));
    ctx.fillStyle = '#2ea8d8';
    ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#0e3d52'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.strokeStyle = '#7ce0ff'; ctx.lineWidth = 2.4;
    for (const s of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(4, s * 4);
      ctx.lineTo(11, s * 6.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ============================================================
  //  チャプター2のミッション
  // ============================================================
  function setupMissions() {
    map.missions = [
      { id: 'valve', label: '塗装バルブを 3 箇所 締める', need: 3, done: 0 },
      { id: 'cull', label: '不良品(躄り人形)を 4 体 廃棄する', need: 4, done: 0 },
      { id: 'mask', label: '検品長の「顔」を回収して手渡す', need: 1, done: 0 },
    ];
    map.missionIdx = 0;
    map.missionsDone = false;
    startMission(0);
  }

  function startMission(i) {
    const m = map.missions[i];
    if (!m) return;
    bossSay('m' + i, true);
    if (m.id === 'valve') {
      for (let k = 0; k < m.need; k++) {
        const r = map.rooms[rndInt(1, map.rooms.length - 1)];
        const p = findOpen(map, r, 24);
        addProp('valve', p.x - 18, p.y - 18, 36, 36, { usable: true, occlude: false, turned: false });
      }
    } else if (m.id === 'cull') {
      // 対象が足りなければ足す
      let n = enemies.filter((e) => e.kind === 'doll' && !e.dead).length;
      while (n < m.need + 1) {
        const r = map.rooms[rndInt(1, map.rooms.length - 1)];
        const p = findOpen(map, r, 20);
        if (dist(p.x, p.y, player.x, player.y) > 300) { spawnEnemy('doll', p.x, p.y, r); n++; }
      }
    } else if (m.id === 'mask') {
      const paint = map.rooms.filter((r) => r.kind === 'paint');
      const r = paint.length ? pick(paint) : map.rooms[rndInt(1, map.rooms.length - 1)];
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
  //  オープニング ― 廃工場へ入るまで
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
      'はい、というわけで来ちゃいました、廃工場〜。',
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
      'この門、わたしが塗ったの。緑がよく乗るからって。',
      'みんな、まだ 起きてるの？',
      '今日は、ちゃんと お別れを言いにきたのよ。',
    ],
  };
  const CUT_VOICE = { guard: 128, inspector: 208, streamer: 252, mechanic: 158, artisan: 226 };

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

  /** カット1: 夜の廃工場を見上げる。 */
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
    // 煙突
    ctx.fillStyle = '#111519';
    ctx.fillRect(120, 150, 46, 300);
    ctx.fillRect(112, 142, 62, 16);
    // 本体
    ctx.fillRect(200, 300, 560, 200);
    // のこぎり屋根
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const x = 200 + i * 80;
      ctx.moveTo(x, 300); ctx.lineTo(x + 40, 258); ctx.lineTo(x + 80, 300);
    }
    ctx.fill();
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
    ctx.fillStyle = `rgba(224,196,120,${0.85 * flick})`;
    ctx.font = 'bold 32px "Hiragino Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('玩具製作所', 395, 233);
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
    // 棚とコンベア
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(40, 200, 150, 200);
    ctx.fillRect(770, 190, 160, 220);
    ctx.fillStyle = '#111419';
    ctx.fillRect(220, 356, 520, 26);
    ctx.fillRect(250, 382, 20, 60);
    ctx.fillRect(690, 382, 20, 60);
    // 吊り下がった玩具の影
    for (let i = 0; i < 7; i++) {
      const x = 150 + i * 110;
      ctx.strokeStyle = 'rgba(120,120,110,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, 150 + (i % 3) * 22); ctx.stroke();
      ctx.fillStyle = '#0c0e12';
      ctx.beginPath(); ctx.arc(x, 162 + (i % 3) * 22, 16, 0, TAU); ctx.fill();
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

    // 玩具の影と、順に灯る目
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
    ctx.fillText('廃 墟 の お も ち ゃ 工 場', VIEW_W / 2, VIEW_H / 2 + 28);
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
      ctx.fillText('B1 組立ライン', VIEW_W / 2, VIEW_H / 2 + 104);
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
    startCutscene();     // 工場へ入るまでのムービー。終わると startFloor へ。
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
    cam.x = clamp(player.x - VIEW_W / 2, 0, Math.max(0, map.pxW - VIEW_W));
    cam.y = clamp(player.y - VIEW_H / 2, 0, Math.max(0, map.pxH - VIEW_H));
    visPoly = computeVisibility(player.x, player.y, 460);
    fx.letter = 1;
    showBriefing(map.def);
  }

  /** 目標アイテムを揃えた瞬間、工場が気づく。 */
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
    updateCamera(dt);
    decayFx(dt);
    fx.letter = Math.max(0, fx.letter - dt * 0.9);

    const R = Math.max(AMBIENT_R + 40, player.lightRangeNow) + 60;
    visPoly = computeVisibility(player.x, player.y, Math.min(R, 760));
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

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (state === 'cut') { drawCutscene(); renderDialogue(); return; }
    if (!map || !player || state === 'title' || state === 'select') { drawTitleBackdrop(); return; }
    drawWorld();
    drawLighting();
    drawEyesInDark();
    drawXray();
    drawWorldUI();
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
    on('btn-resume', () => setState('play'));
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
