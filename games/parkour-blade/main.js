/* =========================================================================
   PARKOUR BLADE ― 起動・画面遷移・HUD
   ========================================================================= */

const R = { canvas: null, ctx: null, w: 960, h: 600, dpr: 1 };

const Main = {
  screen: 'title',      // title | select | howto | play | result | pause
  idx: 0,               // 遊んでいるステージ番号
  paused: false,
  last: 0,

  init() {
    R.canvas = $('game');
    R.ctx = R.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));

    Save.load();
    Sound.setMuted(!!Save.data.muted);

    Input.init();
    Input.onKey = (a) => this.onSysKey(a);

    Game.hooks = {
      toast: (msg, warn) => this.toast(msg, warn),
      clear: () => this.onClear(),
      died: (kind) => this.onDied(kind),
    };

    this.bindUI();
    this.renderStageList();
    this.updateMuteLabel();

    if (Input.isTouch) $('touch').classList.remove('hidden');

    requestAnimationFrame((t) => { this.last = t; this.loop(t); });
  },

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    R.dpr = dpr; R.w = w; R.h = h;
    R.canvas.width = Math.round(w * dpr);
    R.canvas.height = Math.round(h * dpr);
    R.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  /* ---------- 画面遷移 ---------- */
  show(name) {
    ['title', 'select', 'howto', 'result', 'pause'].forEach((s) => {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    });
    const playing = (name === 'play' || name === 'pause' || name === 'result');
    $('hud').classList.toggle('hidden', name !== 'play');
    $('touch').classList.toggle('hidden', !(Input.isTouch && name === 'play'));
    this.screen = name;
    if (name === 'select') this.renderStageList();
    if (!playing) Sound.setSawLevel(0);
  },

  bindUI() {
    $('btn-start').onclick = () => this.show('select');
    $('btn-howto').onclick = () => this.show('howto');
    $$('[data-back]').forEach((b) => { b.onclick = () => this.show(b.dataset.back); });

    $('btn-mute').onclick = () => {
      Save.data.muted = !Save.data.muted;
      Save.write();
      Sound.unlock();
      Sound.setMuted(Save.data.muted);
      this.updateMuteLabel();
    };
    $('btn-reset').onclick = () => {
      if (!confirm('すべての記録（ベストタイム・ボルト）を消します。よろしいですか？')) return;
      Save.reset();
      this.renderStageList();
    };

    $('btn-next').onclick = () => {
      const next = Math.min(LEVELS.length - 1, this.idx + 1);
      if (next === this.idx && this.idx === LEVELS.length - 1) { this.show('select'); return; }
      this.play(next);
    };
    $('btn-retry').onclick = () => this.play(this.idx);
    $('btn-toselect').onclick = () => this.show('select');

    $('btn-resume').onclick = () => this.resume();
    $('btn-restart').onclick = () => this.play(this.idx);
    $('btn-quit').onclick = () => this.show('select');
  },

  updateMuteLabel() {
    $('btn-mute').textContent = Save.data.muted ? '🔇 音 OFF' : '🔊 音 ON';
  },

  renderStageList() {
    const box = $('stage-list');
    box.innerHTML = '';
    let bolts = 0, total = 0, allCleared = true;
    LEVELS.forEach((lv, i) => {
      const st = Save.stage(lv.id);
      const got = st.bolts.filter(Boolean).length;
      bolts += got;
      if (st.cleared) total += st.bestMs; else allCleared = false;
      const rank = st.cleared ? rankOf(st.bestMs, lv.target) : '';

      const card = document.createElement('button');
      card.className = 'stage-card';
      card.innerHTML =
        `<div class="sc-no">${lv.sub}</div>` +
        `<div class="sc-name">${lv.name}</div>` +
        `<div class="sc-meta">` +
        `<span>${st.cleared ? 'ベスト ' + fmtTime(st.bestMs) : '未クリア'}</span>` +
        `<span class="sc-bolts">⚙ ${got}/3</span>` +
        `</div>` +
        (rank ? `<div class="sc-rank r-${rank}">${rank}</div>` : '');
      card.onclick = () => this.play(i);
      box.appendChild(card);
    });
    $('total-line').textContent =
      `総ボルト ${bolts}/${LEVELS.length * 3}　・　総合タイム ${allCleared ? fmtTime(total) : '--'}`;
  },

  /* ---------- ゲーム開始 ---------- */
  play(i) {
    this.idx = i;
    const lv = LEVELS[i];
    Sound.unlock();
    Game.start(lv);
    this.paused = false;
    this.show('play');
    $('hud-stage').textContent = `${lv.sub} ― ${lv.name}`;
    const st = Save.stage(lv.id);
    $('hud-best').textContent = st.bestMs ? 'ベスト ' + fmtTime(st.bestMs) : 'ベスト --:--.--';
    this.showTip(lv.tip);
  },

  showTip(text) {
    const b = $('tip-banner');
    $('tip-text').textContent = text;
    b.classList.add('show');
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => b.classList.remove('show'), 7000);
  },

  toast(msg, warn) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('warn', !!warn);
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1300);
  },

  flash(cls) {
    const f = $('flash');
    f.classList.remove('on', 'gold');
    void f.offsetWidth;
    f.classList.add('on');
    if (cls) f.classList.add(cls);
    setTimeout(() => f.classList.remove('on'), 40);
  },

  onDied(kind) {
    if (kind === 'blade') this.flash();
    this.toast(kind === 'blade' ? '刃に触れた' : '奈落へ落ちた', true);
  },

  onClear() {
    const lv = LEVELS[this.idx];
    const ms = Game.time;
    const bolts = Game.boltsGot();
    const got = bolts.filter(Boolean).length;
    const prev = Save.stage(lv.id).bestMs;
    const isBest = Save.record(lv.id, ms, bolts, Game.deaths);
    const rank = rankOf(ms, lv.target);

    this.flash('gold');
    setTimeout(() => {
      $('result-rank').textContent = rank;
      $('result-rank').className = 'rank r-' + rank;
      $('result-stage').textContent = `${lv.sub} ― ${lv.name}`;
      $('result-time').textContent = fmtTime(ms);
      $('result-best').textContent = fmtTime(Save.stage(lv.id).bestMs);
      $('result-bolts').textContent = `${got}/3`;
      $('result-deaths').textContent = String(Game.deaths);
      $('result-new').classList.toggle('hidden', !(isBest && prev));
      $('btn-next').textContent = this.idx >= LEVELS.length - 1 ? 'ステージ選択へ' : '次のステージ';
      this.show('result');
    }, 900);
  },

  /* ---------- システムキー ---------- */
  onSysKey(a) {
    if (a === 'mute') {
      Save.data.muted = !Save.data.muted;
      Save.write();
      Sound.setMuted(Save.data.muted);
      this.updateMuteLabel();
      this.toast(Save.data.muted ? '音 OFF' : '音 ON');
      return;
    }
    if (this.screen === 'play' && a === 'restart') { Game.retryFromCheck(); return; }
    if (a === 'pause') {
      if (this.screen === 'play') this.pause();
      else if (this.screen === 'pause') this.resume();
    }
  },

  pause() {
    this.paused = true;
    const lv = LEVELS[this.idx];
    $('pause-stage').textContent = `${lv.sub} ― ${lv.name}`;
    $('screen-pause').classList.remove('hidden');
    $('hud').classList.add('hidden');
    this.screen = 'pause';
    Sound.setSawLevel(0);
  },

  resume() {
    this.paused = false;
    $('screen-pause').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.screen = 'play';
    this.last = performance.now();
  },

  /* ---------- HUD ---------- */
  updateHud() {
    $('hud-time').textContent = fmtTime(Game.time);
    $('hud-deaths').textContent = '💀 ' + Game.deaths;
    const got = Game.bolts.filter((b) => b.got).length;
    $('hud-bolts').textContent = `⚙ ${got}/${Game.bolts.length}`;
    const g = clamp(Game.p.grip / GRIP_MAX, 0, 1);
    const fill = $('grip-fill');
    fill.style.transform = `scaleX(${g})`;
    fill.classList.toggle('low', g < 0.34);
  },

  /* ---------- ループ ---------- */
  loop(t) {
    requestAnimationFrame((n) => this.loop(n));
    let dt = t - this.last;
    this.last = t;
    if (dt > 100) dt = 100;

    if (this.screen === 'play' && !this.paused) {
      Game.update(dt);
      this.updateHud();
    }
    if (this.screen === 'play' || this.screen === 'pause' || this.screen === 'result') {
      Game.render(R.ctx, R.w, R.h);
    } else {
      R.ctx.clearRect(0, 0, R.w, R.h);
    }
    Input.endFrame();
  },
};

window.addEventListener('load', () => Main.init());
