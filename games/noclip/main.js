/* =========================================================================
   NOCLIP ― 画面まわり
   タイトル／ステージ選択／スキン／HUD／エモートホイール／タッチ操作。
   ========================================================================= */

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const UI = {
  screen: 'title',
  previewId: 'surveyor',
  previewRaf: 0,
  lastStage: 'lv0',

  init() {
    Save.load();
    R.init($('#game'));
    Input.init($('#game'));

    Game.onEnd = (kind, st) => this.onEnd(kind, st);
    Game.onHud = st => this.hud(st);

    $$('[data-go]').forEach(b => b.addEventListener('click', () => { Audio2.sfx('ui'); this.show(b.dataset.go); }));
    $('#pause-btn').addEventListener('click', () => this.setPause(true));
    $('#resume-btn').addEventListener('click', () => this.setPause(false));
    $('#retry-btn').addEventListener('click', () => { this.setPause(false); this.play(this.lastStage); });
    $('#quit-btn').addEventListener('click', () => { this.setPause(false); Game.stop(); this.show('stage'); });
    $('#res-retry').addEventListener('click', () => this.play(this.lastStage));
    $('#res-quit').addEventListener('click', () => this.show('stage'));
    $('#res-next').addEventListener('click', () => {
      const i = STAGES.findIndex(s => s.id === this.lastStage);
      const nx = STAGES[i + 1];
      if (nx && Save.isUnlocked(nx.id)) { this.play(nx.id); } else { this.show('stage'); }
    });
    $('#equip-btn').addEventListener('click', () => this.equip(this.previewId));
    $('#grant-ok').addEventListener('click', () => { $('#sc-grant').classList.add('hidden'); this.buildSkins(); });
    $('#hw-sim').addEventListener('click', () => this.simulateHalloween());

    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'escape' && Game.running) { this.setPause(!Game.paused); }
      if (k === 'e' && Game.running && !Game.paused) { this.toggleWheel(); }
    });

    window.__flash = () => {
      const f = $('#flash');
      f.classList.add('on');
      setTimeout(() => f.classList.remove('on'), 60);
    };

    this.buildWheel();
    this.buildStages();
    this.buildSkins();
    this.initTouch();
    this.checkHalloween();
    this.show('title');

    // 最初の操作で音を起こす（ブラウザの自動再生制限）
    const wake = () => { Audio2.ensure(); removeEventListener('pointerdown', wake); removeEventListener('keydown', wake); };
    addEventListener('pointerdown', wake); addEventListener('keydown', wake);
  },

  /* ---------- 画面遷移 ---------- */
  show(id) {
    if (id !== 'game' && Game.running) { Game.stop(); }
    this.screen = id;
    $$('.screen').forEach(s => s.classList.add('hidden'));
    $('#hud').classList.toggle('hidden', id !== 'game');
    $('#touch').classList.toggle('hidden', !(id === 'game' && this.touchEnabled));
    $('#emote-wheel').classList.add('hidden');
    Input.wheelOpen = false;

    cancelAnimationFrame(this.previewRaf);
    if (id === 'game') { return; }
    const el = $('#sc-' + id);
    if (el) { el.classList.remove('hidden'); }
    if (id === 'stage') { this.buildStages(); }
    if (id === 'skin') { this.buildSkins(); this.previewLoop(); }
  },

  /* ---------- ステージ選択 ---------- */
  buildStages() {
    const wrap = $('#stage-list');
    wrap.innerHTML = '';
    $('#stage-candy').textContent = Save.data.candy;

    for (const s of STAGES) {
      const unlocked = Save.isUnlocked(s.id);
      const rec = Save.data.cleared[s.id];
      const card = document.createElement('button');
      card.className = 'card' + (unlocked ? '' : ' locked') + (rec ? ' done' : '') + ` k-${s.kind}`;
      card.innerHTML = `
        <div class="card-map"></div>
        <div class="card-no">${s.no}</div>
        <h3>${s.name}</h3>
        <p class="card-blurb">${s.blurb}</p>
        <div class="card-meta">
          <span class="tag">${s.tag}</span>
          <span class="diff">${'●'.repeat(s.diff)}${'○'.repeat(6 - s.diff)}</span>
          <span class="obj">${s.kind === 'boss' ? `🗿 支柱 ${s.pillars}` : `🔑 ${s.keys}`}</span>
        </div>
        <div class="card-foot">${rec ? `最短 ${fmtTime(rec.best)}` : (unlocked ? '未クリア' : `🔒 前のステージをクリアで解放`)}</div>`;
      card.querySelector('.card-map').appendChild(miniMapThumb(s, unlocked));
      if (unlocked) { card.addEventListener('click', () => this.play(s.id)); }
      wrap.appendChild(card);
    }

    const skin = SKIN_BY_ID[Save.data.equipped] || SKINS[0];
    $('#strip-skin').textContent = skin.name;
    $('#strip-pick').textContent = PICKS[skin.pick].name;
    drawPortrait($('#strip-char'), skin, 0);
  },

  play(id) {
    this.lastStage = id;
    $$('.screen').forEach(s => s.classList.add('hidden'));
    $('#hud').classList.remove('hidden');
    $('#touch').classList.toggle('hidden', !this.touchEnabled);
    this.screen = 'game';
    Audio2.ensure();
    R.resize();
    Game.start(id, Save.data.equipped);
  },

  /* ---------- HUD ---------- */
  hud(st) {
    const p = st.p;
    $('#hp-fill').style.width = clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
    $('#hp-txt').textContent = Math.max(0, Math.ceil(p.hp));
    $('#st-fill').style.width = p.stam + '%';
    $('#ba-fill').style.width = p.bat + '%';
    $('#ba-fill').classList.toggle('off', !p.light || p.bat <= 0);
    $('#hud-stage').textContent = `${st.stage.no} ${st.stage.name}`;
    $('#hud-obj').innerHTML = st.stage.kind === 'boss'
      ? `🗿 <b>${st.keysGot}</b>/${st.keysTotal}`
      : `🔑 <b>${st.keysGot}</b>/${st.keysTotal}`;
    $('#hud-time').textContent = fmtTime(st.time);
    $('#hud-candy').textContent = st.candy;

    const sub = $('#subtitle');
    if (st.msgT > 0) { sub.textContent = st.msg; sub.style.opacity = clamp(st.msgT, 0, 1); }
    else { sub.style.opacity = 0; }

    // 近くの実体を赤い縁で知らせる
    let near = Infinity;
    for (const e of st.ents) { if (!e.dead) { near = Math.min(near, Math.hypot(e.x - p.x, e.y - p.y)); } }
    $('#alert-ring').style.opacity = near < 240 ? clamp(1 - near / 240, 0, 1) * 0.7 : 0;

    R.minimap($('#minimap'), st);

    if (this._pickShown !== st.skin.id) {
      this._pickShown = st.skin.id;
      $('#pick-name').textContent = st.pick.name;
      $('#pick-sub').textContent = `威力 ${st.pick.power} ／ 音 ${'▮'.repeat(Math.ceil(st.pick.noise / 3))}`;
      drawPickIcon($('#pick-icon'), st.pick);
    }
  },

  setPause(on) {
    if (!Game.running) { return; }
    Game.paused = on;
    $('#sc-pause').classList.toggle('hidden', !on);
  },

  /* ---------- リザルト ---------- */
  onEnd(kind, st) {
    const clear = kind === 'clear';
    if (clear) {
      Save.recordClear(st.stage.id, st.time);
      Save.data.candy += st.candy;
      Save.save();
    }
    const unlocked = [];
    for (const s of SKINS) {
      if (s.unlock.type === 'stage' && Save.isCleared(s.unlock.stage) && Save.grant(s.id)) { unlocked.push(s); }
    }

    $('#res-title').textContent = clear ? '脱出成功' : '見つかった';
    $('#res-title').className = clear ? 'ok' : 'ng';
    $('#res-sub').textContent = clear
      ? `${st.stage.no} ${st.stage.name}`
      : 'もう一度、別の壁を試そう。';
    $('#res-stats').innerHTML = `
      <li><span>時間</span><b>${fmtTime(st.time)}</b></li>
      <li><span>キャンディ</span><b>🍬 ${st.candy}</b></li>
      <li><span>掘った壁</span><b>${st.broken}</b></li>
      <li><span>${st.stage.kind === 'boss' ? '折った支柱' : '集めた鍵'}</span><b>${st.keysGot}/${st.keysTotal}</b></li>`;

    const un = $('#res-unlock');
    if (unlocked.length) {
      un.classList.remove('hidden');
      un.innerHTML = '<h4>新しいスキン</h4>' + unlocked.map(s =>
        `<div class="un-row"><b style="color:${RARITY[s.rarity].color}">${s.name}</b><span>${PICKS[s.pick].name}</span></div>`).join('');
      Audio2.sfx('grant');
    } else { un.classList.add('hidden'); }

    const i = STAGES.findIndex(s => s.id === st.stage.id);
    const nx = STAGES[i + 1];
    $('#res-next').classList.toggle('hidden', !(clear && nx && Save.isUnlocked(nx.id)));

    $$('.screen').forEach(s => s.classList.add('hidden'));
    $('#hud').classList.add('hidden');
    $('#touch').classList.add('hidden');
    $('#sc-result').classList.remove('hidden');
    this.screen = 'result';
  },

  /* ---------- スキン画面 ---------- */
  buildSkins() {
    const list = $('#skin-list');
    list.innerHTML = '';
    $('#skin-count').textContent = `${Save.data.skins.length}/${SKINS.length}`;

    for (const s of SKINS) {
      const owned = Save.has(s.id);
      const b = document.createElement('button');
      b.className = 'skin-cell' + (owned ? '' : ' locked') + (Save.data.equipped === s.id ? ' equipped' : '');
      b.style.setProperty('--rare', RARITY[s.rarity].color);
      const cv = document.createElement('canvas');
      cv.width = 108; cv.height = 108;
      b.appendChild(cv);
      const cap = document.createElement('span');
      cap.className = 'cell-name';
      cap.textContent = owned ? s.name : '？？？';
      b.appendChild(cap);
      if (!owned) {
        const lk = document.createElement('span'); lk.className = 'cell-lock'; lk.textContent = '🔒';
        b.appendChild(lk);
      }
      if (Save.data.equipped === s.id) {
        const eq = document.createElement('span'); eq.className = 'cell-eq'; eq.textContent = '装備中';
        b.appendChild(eq);
      }
      drawPortrait(cv, s, 0, !owned);
      b.addEventListener('click', () => { Audio2.sfx('ui'); this.previewId = s.id; this.renderPreview(); });
      list.appendChild(b);
    }
    if (!SKIN_BY_ID[this.previewId]) { this.previewId = Save.data.equipped; }
    this.renderPreview();
  },

  renderPreview() {
    const s = SKIN_BY_ID[this.previewId];
    const owned = Save.has(s.id);
    const pick = PICKS[s.pick];
    $('#prev-name').textContent = owned ? s.name : '？？？';
    const r = $('#prev-rarity');
    r.textContent = RARITY[s.rarity].label;
    r.style.color = RARITY[s.rarity].color;
    r.style.borderColor = RARITY[s.rarity].color;
    $('#prev-desc').textContent = owned ? s.desc : 'まだ手に入れていない。';
    $('#prev-pick-name').textContent = owned ? pick.name : '未入手';
    $('#prev-pick-stats').innerHTML = owned ? `
      <li><span>威力</span><b>${'▮'.repeat(pick.power)}${'▯'.repeat(3 - pick.power)}</b></li>
      <li><span>速さ</span><b>${(1000 / pick.cd).toFixed(1)} 回/秒</b></li>
      <li><span>射程</span><b>${pick.reach} px</b></li>
      <li><span>実体ダメージ</span><b>${pick.dmg}</b></li>
      <li><span>出る音</span><b>${pick.noise} タイル</b></li>` : '<li><span>—</span><b>—</b></li>';
    $('#prev-perk').textContent = owned ? `${s.perkText}　／　${pick.note}` : '';

    const lock = $('#prev-lock');
    if (owned) { lock.classList.add('hidden'); }
    else {
      lock.classList.remove('hidden');
      lock.textContent = s.unlock.type === 'event'
        ? `🎃 ${s.unlock.text}`
        : `🔒 「${STAGE_BY_ID[s.unlock.stage].name}」をクリアで解放`;
    }
    const eq = $('#equip-btn');
    eq.disabled = !owned;
    eq.textContent = Save.data.equipped === s.id ? '装備中' : owned ? 'これを装備する' : '未入手';
    drawPickIcon($('#prev-pick-icon'), pick, !owned);
  },

  previewLoop() {
    const cv = $('#prev-char');
    const tick = () => {
      this.previewRaf = requestAnimationFrame(tick);
      if (this.screen !== 'skin') { return; }
      const s = SKIN_BY_ID[this.previewId];
      drawPortrait(cv, s, performance.now() / 1000, !Save.has(s.id), true);
    };
    tick();
  },

  equip(id) {
    if (!Save.has(id)) { return; }
    Save.data.equipped = id; Save.save();
    Audio2.sfx('key');
    this.buildSkins();
    this.toast(`${SKIN_BY_ID[id].name} を装備した`);
  },

  /* ---------- ハロウィン限定 ---------- */
  checkHalloween() {
    const now = new Date();
    if (!isHalloween(now)) { return; }
    const year = now.getFullYear();
    if (Save.data.hwYear === year && Save.has('jack')) { return; }
    if (!Save.grant('jack')) { return; }
    Save.data.hwYear = year; Save.save();
    this.showGrant(SKIN_BY_ID.jack);
  },

  simulateHalloween() {
    Save.data.hwSim = true;
    Save.data.hwYear = 0;
    Save.save();
    if (Save.grant('jack')) {
      Save.data.hwYear = new Date().getFullYear(); Save.save();
      this.showGrant(SKIN_BY_ID.jack);
    } else {
      this.toast('すでに入手済み');
    }
    this.buildSkins();
  },

  showGrant(skin) {
    const el = $('#sc-grant');
    $('#grant-name').textContent = skin.name;
    $('#grant-desc').textContent = `${skin.desc}\n専用武器：${PICKS[skin.pick].name}`;
    el.classList.remove('hidden');
    Audio2.sfx('grant');
    const cv = $('#grant-char');
    const t0 = performance.now();
    const spin = () => {
      if (el.classList.contains('hidden')) { return; }
      requestAnimationFrame(spin);
      drawPortrait(cv, skin, (performance.now() - t0) / 1000, false, true);
    };
    spin();
  },

  toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('on'), 1800);
  },

  /* ---------- エモートホイール ---------- */
  buildWheel() {
    const ring = $('#emote-ring');
    ring.innerHTML = '';
    EMOTES.forEach((em, i) => {
      const a = -Math.PI / 2 + i / EMOTES.length * TAU;
      const b = document.createElement('button');
      b.className = 'emote-btn';
      b.style.left = `calc(50% + ${Math.cos(a) * 96}px)`;
      b.style.top = `calc(50% + ${Math.sin(a) * 96}px)`;
      b.innerHTML = `<span class="em">${em.emoji}</span><span class="lb">${em.label}</span><span class="no">${i + 1}</span>`;
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        Game.emote(em.id);
        this.toggleWheel(false);
      });
      ring.appendChild(b);
    });
    $('#emote-wheel').addEventListener('click', () => this.toggleWheel(false));
  },

  toggleWheel(force) {
    const el = $('#emote-wheel');
    const on = force === undefined ? el.classList.contains('hidden') : force;
    el.classList.toggle('hidden', !on);
    Input.wheelOpen = on;
  },

  /* ---------- タッチ ---------- */
  initTouch() {
    this.touchEnabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (!this.touchEnabled) { return; }
    const stick = $('#stick'), knob = $('#stick-knob');
    let id = null, cx = 0, cy = 0;
    stick.addEventListener('pointerdown', e => {
      id = e.pointerId; stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      Input.stick.active = true;
    });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== id) { return; }
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const m = Math.min(1, Math.hypot(dx, dy) / 46) ;
      const a = Math.atan2(dy, dx);
      Input.stick.x = Math.cos(a) * m; Input.stick.y = Math.sin(a) * m;
      knob.style.transform = `translate(${Math.cos(a) * m * 30}px, ${Math.sin(a) * m * 30}px)`;
    });
    const end = e => {
      if (e.pointerId !== id) { return; }
      id = null; Input.stick.active = false; Input.stick.x = 0; Input.stick.y = 0;
      knob.style.transform = 'translate(0,0)';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    $$('#tbtns .tb').forEach(b => {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (act === 'run') { Input.touchRun = !Input.touchRun; b.classList.toggle('on', Input.touchRun); }
        else if (act === 'light') { Input.keys.f = true; Input._once.f = true; }
        else if (act === 'emote') { this.toggleWheel(); }
        else { Input.touchSwing = true; b.classList.add('on'); }
      });
      b.addEventListener('pointerup', () => { if (act === 'swing') { b.classList.remove('on'); } });
    });
    // タッチでは連打ではなく押しっぱなしで振り続ける
    setInterval(() => {
      const b = document.querySelector('#tbtns .tb-swing');
      if (b && b.classList.contains('on')) { Input.touchSwing = true; }
    }, 60);
  },
};

/* =========================================================================
   小物
   ========================================================================= */
function fmtTime(sec) {
  if (!Number.isFinite(sec)) { return '--:--'; }
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** スキンの立ち絵。ゲーム内と同じ drawCharacter を使う */
function drawPortrait(cv, skin, t, silhouette = false, withPick = false) {
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);

  // 台座
  const g = c.createRadialGradient(W / 2, H * 0.62, 4, W / 2, H * 0.62, W * 0.5);
  g.addColorStop(0, silhouette ? 'rgba(60,60,70,0.35)' : `${RARITY[skin.rarity].color}33`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const s = W / 108 * 2.1;
  const ang = Math.PI / 2 + Math.sin(t * 0.8) * 0.16;      // 手前を向く
  const look = silhouette
    ? { coat: '#23262c', coatDark: '#15171b', trim: '#2e3239', skin: '#23262c', head: 'blank', eye: '#3a3f47', eyeGlow: null, hat: skin.look.hat, hatColor: '#1b1e23', hatDark: '#101216', hatBand: '#2e3239', smoke: null }
    : skin.look;

  c.save();
  c.translate(W / 2, H * 0.56);
  if (withPick) {
    const pick = silhouette ? { head: '#2a2d33', headDark: '#16181c', haft: '#1a1c20', spark: '#333' } : PICKS[skin.pick];
    const pa = -0.72, L = 26 * s * 0.8;
    drawPick(c, pick, -Math.cos(pa) * L * 0.6, -Math.sin(pa) * L * 0.6, s * 0.8, pa, t, -1);
    drawCharacter(c, look, 0, 0, s, ang, t, { walk: 0.35 });
  } else {
    drawCharacter(c, look, 0, 0, s, ang, t, { walk: 0 });
  }
  c.restore();
}

/** ツルハシのアイコン */
function drawPickIcon(cv, pick, silhouette = false) {
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  const s = cv.width / 96 * 1.5;
  c.save();
  c.translate(cv.width * 0.24, cv.height * 0.76);
  drawPick(c, silhouette ? { head: '#2a2d33', headDark: '#16181c', haft: '#1a1c20', spark: '#333' } : pick,
    0, 0, s, -Math.PI / 4, performance.now() / 1000, -1);
  c.restore();
}

/** ステージカードの間取りサムネイル（生成結果をそのまま縮小して見せる） */
const thumbCache = new Map();
function copyCanvas(src) {
  const d = document.createElement('canvas');
  d.width = src.width; d.height = src.height;
  d.getContext('2d').drawImage(src, 0, 0);
  return d;
}
function miniMapThumb(stage, unlocked) {
  const key = stage.id + (unlocked ? '' : '_l');
  if (thumbCache.has(key)) { return copyCanvas(thumbCache.get(key)); }
  const cv = document.createElement('canvas');
  cv.width = 120; cv.height = 74;
  const c = cv.getContext('2d');
  const lay = buildStage(stage);
  const k = Math.min(cv.width / lay.W, cv.height / lay.H);
  const ox = (cv.width - lay.W * k) / 2, oy = (cv.height - lay.H * k) / 2;
  c.fillStyle = stage.pal.fog; c.fillRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < lay.H; y++) {
    for (let x = 0; x < lay.W; x++) {
      const t = lay.tiles[y * lay.W + x];
      let col = null;
      if (t === T.WALL || t === T.DECO) { col = stage.pal.wall; }
      else if (t === T.CRACK) { col = stage.pal.crack; }
      else if (t === T.DOOR) { col = '#8a5a2a'; }
      else if (t === T.PILLAR) { col = '#a07ad8'; }
      else if (t === T.EXIT) { col = '#3ef29a'; }
      else if (passWalk(t)) { col = stage.pal.floor2; }
      if (col) { c.fillStyle = col; c.fillRect(ox + x * k, oy + y * k, k + 0.5, k + 0.5); }
    }
  }
  if (!unlocked) { c.fillStyle = 'rgba(6,6,8,0.78)'; c.fillRect(0, 0, cv.width, cv.height); }
  thumbCache.set(key, cv);
  return copyCanvas(cv);
}

addEventListener('DOMContentLoaded', () => UI.init());
