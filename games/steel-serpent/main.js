/* =========================================================================
   STEEL SERPENT ― 進行管理
   画面遷移 / 無線演出 / メインループ / セーブ
   ========================================================================= */

const UI = {
  screen: 'title',
  diffKey: 'normal',
  stageIdx: 0,
  codec: null,
  lastResult: null,
};

/* ===================== 画面切り替え ===================== */
const SCREENS = ['screen-title', 'screen-select', 'screen-help', 'screen-brief', 'screen-pause', 'screen-result', 'screen-over'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  UI.screen = id || 'none';
  const inGame = !id || id === 'screen-pause';
  $('hud').classList.toggle('hidden', !inGame);
  const showTouch = inGame && supportsTouch();
  $('touch').classList.toggle('hidden', !showTouch);
  document.body.classList.toggle('touch-on', showTouch);
}
function supportsTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; }

/* ===================== ミッション ===================== */
function startingWeapons(idx) {
  const base = ['knife', 'm9'];
  if (idx >= 1) base.push('ar', 'tranq');
  if (idx >= 2) base.push('sg', 'sniper');
  return base;
}

function openBrief(idx) {
  UI.stageIdx = idx;
  const lv = STAGE_BUILDERS[idx]();
  $('brief-num').textContent = 'MISSION 0' + lv.num;
  $('brief-title').textContent = lv.name;
  $('brief-text').textContent = lv.brief.text;
  $('brief-obj').innerHTML = lv.brief.obj.map((o) => `<li>${o}</li>`).join('');
  showScreen('screen-brief');
}

function beginStage(idx) {
  GAME.carryWeapons = startingWeapons(idx);
  GAME.startStage(idx, UI.diffKey);
  showScreen(null);
  const openId = 's' + (idx + 1) + '_open';
  if (CODEC[openId]) playCodec(openId);
}

/* ===================== 無線（コーデック） ===================== */
function playCodec(id, onDone) {
  const lines = CODEC[id];
  if (!lines) { onDone && onDone(); return; }
  UI.codec = { lines, i: 0, chars: 0, done: false, onDone, t: 0, speaking: false };
  GAME.paused = true;
  $('codec').classList.remove('hidden');
  Audio.codec();
  renderCodecLine();
}
function renderCodecLine() {
  const c = UI.codec;
  if (!c) return;
  const [who] = c.lines[c.i];
  const sp = CODEC_SPEAKER[who] || { name: who, freq: '140.85' };
  $('codec-speaker').textContent = sp.name;
  $('codec-freq-text').textContent = sp.freq;
  c.chars = 0; c.done = false; c.t = 0;
  $('codec-line').innerHTML = '';
}
function advanceCodec() {
  const c = UI.codec;
  if (!c) return;
  const text = c.lines[c.i][1];
  if (!c.done) { c.chars = text.length; c.done = true; $('codec-line').innerHTML = text; return; }
  c.i++;
  if (c.i >= c.lines.length) { closeCodec(); return; }
  Audio.codec();
  renderCodecLine();
}
function closeCodec() {
  const c = UI.codec;
  UI.codec = null;
  $('codec').classList.add('hidden');
  GAME.paused = false;
  if (c && c.onDone) c.onDone();
}
function updateCodec(dt) {
  const c = UI.codec;
  if (!c) return;
  const raw = c.lines[c.i][1];
  if (!c.done) {
    c.t += dt;
    const target = Math.min(raw.length, Math.floor(c.t * 46));
    if (target > c.chars) {
      c.chars = target;
      /* タグを壊さないように、閉じていない < があれば止める */
      let s = raw.slice(0, c.chars);
      const lt = s.lastIndexOf('<'), gt = s.lastIndexOf('>');
      if (lt > gt) s = s.slice(0, lt);
      $('codec-line').innerHTML = s + '<span style="opacity:.4">_</span>';
      if (c.chars % 3 === 0) Audio.blip();
    }
    if (c.chars >= raw.length) { c.done = true; $('codec-line').innerHTML = raw; }
  }
  drawCodecFaces(dt);
}

/* ---------- 無線の顔グラフィック ---------- */
let codecT = 0;
function drawCodecFaces(dt) {
  codecT += dt;
  const c = UI.codec;
  const who = c ? c.lines[c.i][0] : 'snake';
  const talking = c && !c.done;
  drawFace($('codec-left').getContext('2d'), who === 'snake' ? 'snake' : who, talking && who !== 'snake', who);
  drawFace($('codec-right').getContext('2d'), 'snake', talking && who === 'snake', 'snake');
  drawCodecWave($('codec-wave').getContext('2d'), talking);
  /* 話している側を明るく */
  $('codec-left').style.opacity = who === 'snake' ? 0.42 : 1;
  $('codec-right').style.opacity = who === 'snake' ? 1 : 0.42;
}

function drawFace(ctx, kind, talking, who) {
  const W = 150, H = 150;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#02170c'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2 + 14);
  ctx.scale(1.75, 1.75);
  const G = '#5dff9b', GD = '#1f7d45', GL = '#b6ffcf';
  const mouth = talking ? Math.abs(Math.sin(codecT * 16)) * 3 + 0.6 : 0.8;

  if (kind === 'snake') {
    ctx.fillStyle = GD;                                   /* 首と肩 */
    ctx.fillRect(-16, 12, 32, 14);
    ctx.fillStyle = GD; ctx.beginPath(); ctx.ellipse(0, 4, 8, 10, 0, 0, 7); ctx.fill();
    ctx.fillStyle = G;                                    /* 顔 */
    ctx.beginPath(); ctx.ellipse(0, -3, 11, 13, 0, 0, 7); ctx.fill();
    ctx.fillStyle = GD;                                   /* マレットヘア */
    ctx.beginPath(); ctx.moveTo(-11, -6); ctx.quadraticCurveTo(-18, 0, -15, 12);
    ctx.quadraticCurveTo(-9, 8, -8, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(11, -6); ctx.quadraticCurveTo(17, 0, 14, 11);
    ctx.quadraticCurveTo(9, 7, 8, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b2d1a';                            /* バンダナ */
    ctx.beginPath(); ctx.moveTo(-11.5, -11); ctx.quadraticCurveTo(0, -18, 11.5, -11);
    ctx.lineTo(11.5, -8); ctx.quadraticCurveTo(0, -14.5, -11.5, -8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = GD; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-10, -9); ctx.quadraticCurveTo(-19, -6 + Math.sin(codecT * 3) * 2, -22, 0); ctx.stroke();
    ctx.fillStyle = '#03230f';                            /* 目 */
    ctx.beginPath(); ctx.ellipse(-4.4, -3, 2.6, 1.9, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4.4, -3, 2.6, 1.9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = GL;
    ctx.beginPath(); ctx.arc(-4.2, -3, 1, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(4.6, -3, 1, 0, 7); ctx.fill();
    ctx.strokeStyle = '#03230f'; ctx.lineWidth = 1.3;     /* 眉 */
    ctx.beginPath(); ctx.moveTo(-7.4, -6.4); ctx.lineTo(-1.8, -5.6); ctx.moveTo(7.4, -6.4); ctx.lineTo(1.8, -5.6); ctx.stroke();
    ctx.fillStyle = '#0e4a26';                            /* 無精ひげ */
    ctx.beginPath(); ctx.ellipse(0, 6, 7.6, 4.6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#03230f';                            /* 口 */
    ctx.beginPath(); ctx.ellipse(0, 6, 3.2, mouth, 0, 0, 7); ctx.fill();
  } else if (kind === 'colonel') {
    ctx.fillStyle = GD; ctx.fillRect(-17, 12, 34, 14);
    ctx.fillStyle = '#0b2d1a'; ctx.fillRect(-17, 12, 34, 4);
    ctx.fillStyle = G; ctx.beginPath(); ctx.ellipse(0, -2, 11, 13, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#0b2d1a';                            /* 制帽 */
    ctx.beginPath(); ctx.moveTo(-13, -10); ctx.lineTo(-11, -19); ctx.lineTo(11, -19); ctx.lineTo(13, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#03230f'; ctx.fillRect(-14, -11, 28, 3.4);
    ctx.fillStyle = GD; ctx.beginPath(); ctx.arc(0, -15, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#03230f';                            /* サングラス */
    ctx.fillRect(-9, -6, 7, 4.4); ctx.fillRect(2, -6, 7, 4.4); ctx.fillRect(-2.4, -5, 4.8, 1.4);
    ctx.fillStyle = '#0e4a26';                            /* 口ひげ */
    ctx.fillRect(-6, 2.4, 12, 2.8);
    ctx.fillStyle = '#03230f';
    ctx.beginPath(); ctx.ellipse(0, 7, 3.4, mouth, 0, 0, 7); ctx.fill();
    ctx.fillStyle = GD;                                   /* 頬のしわ */
    ctx.fillRect(-9.5, 0, 1.4, 4); ctx.fillRect(8.1, 0, 1.4, 4);
  } else {
    ctx.fillStyle = GD; ctx.fillRect(-15, 12, 30, 14);
    ctx.fillStyle = G; ctx.beginPath(); ctx.ellipse(0, -2, 10.4, 12.6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = GD;                                   /* 髪 */
    ctx.beginPath(); ctx.moveTo(-11, -4); ctx.quadraticCurveTo(-13, -18, 0, -16);
    ctx.quadraticCurveTo(13, -18, 11, -4); ctx.quadraticCurveTo(9, -12, 0, -11);
    ctx.quadraticCurveTo(-9, -12, -11, -4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-11, 4, 3, 8, 0.2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(11, 4, 3, 8, -0.2, 0, 7); ctx.fill();
    ctx.strokeStyle = '#0b2d1a'; ctx.lineWidth = 2;       /* ヘッドセット */
    ctx.beginPath(); ctx.arc(0, -4, 12.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.fillStyle = '#0b2d1a'; ctx.fillRect(-14.5, -5, 4, 6); ctx.fillRect(10.5, -5, 4, 6);
    ctx.beginPath(); ctx.moveTo(-11, 0); ctx.quadraticCurveTo(-6, 4, -3.5, 5.4); ctx.lineTo(-4, 6.8);
    ctx.quadraticCurveTo(-7, 5.4, -12, 1.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#03230f';
    ctx.beginPath(); ctx.ellipse(-4, -3, 2.4, 2.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, -3, 2.4, 2.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = GL;
    ctx.beginPath(); ctx.arc(-3.4, -3.6, 0.9, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(4.6, -3.6, 0.9, 0, 7); ctx.fill();
    ctx.fillStyle = '#03230f';
    ctx.beginPath(); ctx.ellipse(0, 6, 2.6, mouth, 0, 0, 7); ctx.fill();
  }
  ctx.restore();

  /* CRT の走査線とノイズ */
  ctx.save();
  ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1.4);
  ctx.globalAlpha = 0.06; ctx.fillStyle = '#7dff9b';
  ctx.fillRect(0, (codecT * 60) % H, W, 10);
  ctx.restore();
}

function drawCodecWave(ctx, talking) {
  const W = 120, H = 150;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#2f8f4d'; ctx.lineWidth = 1;
  ctx.strokeRect(4, 34, W - 8, 82);
  ctx.save();
  ctx.beginPath(); ctx.rect(5, 35, W - 10, 80); ctx.clip();
  ctx.strokeStyle = '#7dff9b'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let x = 5; x < W - 5; x += 2) {
    const amp = talking ? 26 : 3;
    const y = 75 + Math.sin(x * 0.16 + codecT * 12) * amp * Math.sin(x * 0.03 + codecT * 3) * (talking ? 1 : 0.5);
    x === 5 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#2f8f4d'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('SIGNAL', W / 2, 26); ctx.fillText(talking ? '● REC' : '○ IDLE', W / 2, 130);
}

/* ===================== 結果 ===================== */
function showResult(r) {
  UI.lastResult = r;
  const s = Save.data;
  s.cleared[r.stage] = true;
  s.unlocked = Math.max(s.unlocked, Math.min(3, r.stage + 2));
  const key = r.stage + '_' + UI.diffKey;
  const order = ['D', 'C', 'B', 'A', 'S'];
  if (!s.ranks[key] || order.indexOf(r.rank) > order.indexOf(s.ranks[key])) s.ranks[key] = r.rank;
  s.diff = UI.diffKey;
  Save.save();

  $('result-head').textContent = 'MISSION COMPLETE';
  $('result-head').className = 'result-head';
  $('result-rank').textContent = r.rank;
  $('result-table').innerHTML = `
    <tr><td>クリア時間</td><td>${fmtTime(r.time)}</td></tr>
    <tr><td>撃破数</td><td>${r.kills}</td></tr>
    <tr class="bonus"><td>静粛制圧（CQC・麻酔）</td><td>${r.stealth}</td></tr>
    <tr class="bonus"><td>パーフェクト回避</td><td>${r.perfect}</td></tr>
    <tr class="bonus"><td>最大ラッシュ連撃</td><td>${r.maxCombo}</td></tr>
    <tr><td>警報を鳴らした回数</td><td>${r.alerts}</td></tr>
    <tr><td>被ダメージ</td><td>${r.dmg}</td></tr>
    <tr><td>難易度</td><td>${DIFF[UI.diffKey].name}</td></tr>
    <tr><td><b>総合スコア</b></td><td><b>${r.score.toLocaleString()}</b></td></tr>`;
  $('btn-result-next').classList.toggle('hidden', r.stage >= STAGE_BUILDERS.length - 1);
  showScreen('screen-result');
}

function showGameOver() {
  const causes = [
    '潜入は失敗に終わった。だが、まだ終わりじゃない。',
    'この作戦に代わりはいない。もう一度だ、スネーク。',
    '……最後に残るのはナイフだと、君は言ったな。',
  ];
  $('over-cause').textContent = pick(causes);
  showScreen('screen-over');
}

/* ===================== ミッション選択 ===================== */
function buildMissionList() {
  const wrap = $('mission-list');
  wrap.innerHTML = '';
  STAGE_INFO.forEach((s, i) => {
    const locked = i + 1 > Save.data.unlocked;
    const rank = Save.data.ranks[i + '_' + UI.diffKey] || '―';
    const el = document.createElement('div');
    el.className = 'mission-card' + (locked ? ' locked' : '');
    el.innerHTML = `
      <div class="mc-num">0${s.num}</div>
      <div class="mc-body"><div class="mc-title">${s.name}</div><div class="mc-desc">${s.desc}</div></div>
      <div class="mc-rank">${locked ? '🔒' : rank}</div>`;
    if (!locked) el.addEventListener('click', () => openBrief(i));
    wrap.appendChild(el);
  });
}

/* ===================== ポーズ ===================== */
function togglePause(force) {
  if (!GAME.running || UI.codec) return;
  const want = force !== undefined ? force : UI.screen !== 'screen-pause';
  if (want) {
    GAME.paused = true;
    const p = GAME.player;
    $('pause-info').innerHTML = `
      STAGE ${GAME.level.num} ― ${GAME.level.name}<br>
      経過 ${fmtTime(GAME.time)}　／　撃破 ${p.stats.kills}　／　静粛 ${p.stats.stealth}<br>
      パーフェクト回避 ${p.stats.perfect}　／　最大連撃 ${p.stats.maxCombo}`;
    showScreen('screen-pause');
  } else {
    GAME.paused = false;
    showScreen(null);
  }
}

/* ===================== 起動 ===================== */
function boot() {
  Save.load();
  UI.diffKey = Save.data.diff || 'normal';
  $$('.diff-btn').forEach((b) => b.classList.toggle('active', b.dataset.diff === UI.diffKey));

  const canvas = $('game');
  GAME.init(canvas);
  Input.init(canvas);

  GAME.onCodecRequest = (id, cb) => playCodec(id, cb);
  GAME.onStageClear = (r) => {
    const endId = 's' + (r.stage + 1) + '_end';
    if (CODEC[endId]) playCodec(endId, () => showResult(r));
    else showResult(r);
  };
  GAME.onGameOverScreen = () => showGameOver();

  /* タイトル */
  $('btn-start').addEventListener('click', () => openBrief(0));
  $('btn-continue').addEventListener('click', () => { buildMissionList(); showScreen('screen-select'); });
  $('btn-select').addEventListener('click', () => { buildMissionList(); showScreen('screen-select'); });
  $('btn-help').addEventListener('click', () => showScreen('screen-help'));
  $('btn-help-back').addEventListener('click', () => showScreen('screen-title'));
  $('btn-select-back').addEventListener('click', () => showScreen('screen-title'));
  $$('.diff-btn').forEach((b) => b.addEventListener('click', () => {
    UI.diffKey = b.dataset.diff;
    $$('.diff-btn').forEach((x) => x.classList.toggle('active', x === b));
    Save.data.diff = UI.diffKey; Save.save();
  }));

  $('btn-brief-go').addEventListener('click', () => { Audio.unlock(); beginStage(UI.stageIdx); });

  /* ポーズ */
  $('btn-resume').addEventListener('click', () => togglePause(false));
  $('btn-retry').addEventListener('click', () => { GAME.paused = false; beginStage(UI.stageIdx); });
  $('btn-quit').addEventListener('click', () => { GAME.running = false; GAME.paused = false; Audio.setMusic(null); showScreen('screen-title'); refreshTitle(); });

  /* 結果 */
  $('btn-result-next').addEventListener('click', () => openBrief(Math.min(STAGE_BUILDERS.length - 1, UI.stageIdx + 1)));
  $('btn-result-retry').addEventListener('click', () => beginStage(UI.stageIdx));
  $('btn-result-title').addEventListener('click', () => { showScreen('screen-title'); refreshTitle(); });

  /* ゲームオーバー */
  $('btn-over-retry').addEventListener('click', () => beginStage(UI.stageIdx));
  $('btn-over-title').addEventListener('click', () => { showScreen('screen-title'); refreshTitle(); });

  /* 無線を送る */
  $('codec').addEventListener('click', () => advanceCodec());
  window.addEventListener('keydown', (e) => {
    if (UI.codec && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF')) { e.preventDefault(); advanceCodec(); return; }
    if ((e.code === 'Escape' || e.code === 'KeyP') && GAME.running) { e.preventDefault(); togglePause(); }
  });

  refreshTitle();
  showScreen('screen-title');
  requestAnimationFrame(frame);
}

function refreshTitle() {
  $('btn-continue').classList.toggle('hidden', !Save.hasProgress());
}

/* ===================== メインループ ===================== */
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;

  if (UI.codec) updateCodec(dt);
  GAME.update(dt);
  if (GAME.level) GAME.draw();
  Input.endFrame();

  requestAnimationFrame(frame);
}

window.addEventListener('DOMContentLoaded', boot);
