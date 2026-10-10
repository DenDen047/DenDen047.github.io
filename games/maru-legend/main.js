/* =========================================================================
   マルの伝説 ― 起動・画面遷移・メニュー
   ========================================================================= */

const R = { canvas: null, ctx: null, scale: 1, dpr: 1 };

const Main = {
  screen: 'title',      // title | howto | play | pause | over | ending
  last: 0,
  sel: 0,               // キーボードで選んでいるボタン
  newArmed: false,      // セーブがあるときの「はじめから」確認

  init() {
    R.canvas = $('game');
    R.ctx = R.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));

    const prefs = Save.prefs();
    Sound.setMuted(!!prefs.muted);

    Input.init();
    Input.onKey = (a) => this.onSysKey(a);

    Game.hooks = {
      save: (S) => Save.write(S),
      gameover: () => this.show('over'),
      ending: () => this.showEnding(),
    };

    this.bindUI();
    Game.titleScene();
    this.show('title');
    Render.draw(R.ctx);
    requestAnimationFrame((t) => { this.last = t; this.loop(t); });
  },

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    const portraitTouch = Input.isTouch && H > W;
    const availH = portraitTouch ? H - 210 : H - 16;
    const scale = Math.max(0.3, Math.min((W - 8) / VIEW_W, availH / VIEW_H));
    R.dpr = dpr;
    R.scale = scale;
    R.canvas.style.width = `${Math.round(VIEW_W * scale)}px`;
    R.canvas.style.height = `${Math.round(VIEW_H * scale)}px`;
    R.canvas.width = Math.round(VIEW_W * scale * dpr);
    R.canvas.height = Math.round(VIEW_H * scale * dpr);
    R.ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    $('stage-wrap').classList.toggle('top', portraitTouch);
    Render.draw(R.ctx);
  },

  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (this.screen === 'play' || this.screen === 'title') {
      Game.update(dt);
    }
    if (this.screen !== 'play') this.menuKeys();
    Render.draw(R.ctx);
    Input.endFrame();
    requestAnimationFrame((tt) => this.loop(tt));
  },

  /* ---------- 画面遷移 ---------- */
  show(name) {
    ['title', 'howto', 'pause', 'over', 'ending'].forEach((s) => {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    });
    this.screen = name;
    $('touch').classList.toggle('hidden', !(Input.isTouch && name === 'play'));
    if (name === 'title') this.refreshTitle();
    if (name === 'pause') this.refreshPause();
    this.sel = 0;
    this.markSel();
    Input.swallow();
  },

  refreshTitle() {
    const has = !!Save.load();
    $('btn-continue').disabled = !has;
    $('btn-continue').classList.toggle('hidden', !has);
    this.newArmed = false;
    $('btn-new').textContent = 'はじめから';
    $('btn-new').classList.remove('warn');
    $('title-hint').textContent = Input.isTouch ? 'タップでえらぶ' : 'Z / Enter で決定　↑↓ でえらぶ';
  },

  visibleButtons() {
    const scr = $('screen-' + this.screen);
    if (!scr) return [];
    return $$('button', scr).filter((b) => !b.disabled && !b.classList.contains('hidden') && b.offsetParent !== null && !b.classList.contains('inv-item'));
  },

  markSel() {
    const list = this.visibleButtons();
    list.forEach((b, i) => b.classList.toggle('sel', i === this.sel && !Input.isTouch));
  },

  /** メニュー画面をキーボードだけで操作する。 */
  menuKeys() {
    const list = this.visibleButtons();
    if (!list.length) return;
    if (Input.pressed('up')) { this.sel = (this.sel + list.length - 1) % list.length; this.markSel(); Sound.play('text'); }
    if (Input.pressed('down')) { this.sel = (this.sel + 1) % list.length; this.markSel(); Sound.play('text'); }
    if (this.screen === 'pause' && Input.pressed('swap')) { Game.swapItem(); this.refreshPause(); }
    if (Input.pressed('a')) { const b = list[this.sel]; if (b) b.click(); }
  },

  onSysKey(a) {
    if (a === 'mute') { this.toggleMute(); return; }
    if (a !== 'menu') return;
    if (this.screen === 'play') {
      if (Game.mode === 'play' || Game.mode === 'dialog') this.show('pause');
    } else if (this.screen === 'pause') {
      this.resume();
    } else if (this.screen === 'howto') {
      this.show('title');
    } else {
      const b = this.visibleButtons()[this.sel];
      if (b) b.click();
    }
  },

  toggleMute() {
    Sound.unlock();
    Sound.setMuted(!Sound.muted);
    const p = Save.prefs();
    p.muted = Sound.muted;
    Save.setPrefs(p);
    $('btn-mute').textContent = Sound.muted ? '音: オフ' : '音: オン';
  },

  resume() {
    this.show('play');
  },

  /* ---------- ボタン ---------- */
  bindUI() {
    $('btn-continue').addEventListener('click', () => {
      const data = Save.load();
      if (!data) return;
      Sound.unlock();
      Game.loadGame(data);
      this.show('play');
    });
    $('btn-new').addEventListener('click', () => {
      Sound.unlock();
      if (Save.load() && !this.newArmed) {
        this.newArmed = true;
        $('btn-new').textContent = 'セーブを消して はじめから？';
        $('btn-new').classList.add('warn');
        return;
      }
      Save.clear();
      Game.newGame();
      this.show('play');
    });
    $('btn-howto').addEventListener('click', () => this.show('howto'));
    $('btn-howto-back').addEventListener('click', () => this.show('title'));
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-mute').addEventListener('click', () => this.toggleMute());
    $('btn-quit').addEventListener('click', () => {
      Game.save();
      Game.titleScene();
      this.show('title');
    });
    $('btn-retry').addEventListener('click', () => {
      Game.respawn();
      this.show('play');
    });
    $('btn-over-title').addEventListener('click', () => {
      Game.titleScene();
      this.show('title');
    });
    $('btn-ending-title').addEventListener('click', () => {
      Game.titleScene();
      this.show('title');
    });
  },

  /* ---------- メニュー（道具と地図） ---------- */
  refreshPause() {
    const S = Game.S;
    $('btn-mute').textContent = Sound.muted ? '音: オフ' : '音: オン';
    $('inv-bkey').textContent = Input.isTouch ? 'B' : 'X';
    const row = $('inv-row');
    row.innerHTML = '';
    const slots = [
      { id: 'sword', name: '剣', have: S.items.sword, fixed: true },
      { id: 'boomerang', name: 'ブーメラン', have: S.items.boomerang },
      { id: 'bombs', name: `爆弾 ${S.items.bombbag ? S.bombs + '/' + S.maxBombs : ''}`, have: S.items.bombbag },
    ];
    slots.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'inv-item' + (s.have ? '' : ' none') + (s.fixed ? ' fixed' : '') + (S.bItem === s.id ? ' on' : '');
      const cv = document.createElement('canvas');
      cv.width = 80;
      cv.height = 80;
      const c = cv.getContext('2d');
      c.scale(2, 2);
      if (s.have) Render.itemIcon(c, s.id, 20, 20, 1.3);
      b.appendChild(cv);
      const label = document.createElement('span');
      label.textContent = s.have ? s.name : '？？？';
      b.appendChild(label);
      if (s.have && !s.fixed) {
        b.addEventListener('click', () => { S.bItem = s.id; Sound.play('text'); this.refreshPause(); });
      }
      row.appendChild(b);
    });

    const inDungeon = Game.room && Game.room.kind === 'dungeon';
    const areaId = inDungeon ? Game.areaId : 'ow';
    $('map-title').textContent = inDungeon ? `地図 ― ${AREAS[areaId].name}` : '地図 ― マルランド';
    this.drawMap($('map'), areaId);

    const keys = inDungeon ? `　鍵 <b>${S.keys[areaId] || 0}</b>${S.bigkey[areaId] ? '＋ボスの鍵' : ''}` : '';
    $('pause-stats').innerHTML = `<span>宝珠 <b>${S.orbs}/3</b></span><span>ジェム <b>${S.gems}</b></span><span>時間 <b>${fmtTime(S.time)}</b>${keys}</span>`;
  },

  drawMap(cv, areaId) {
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    const A = AREAS[areaId];
    const S = Game.S;
    const aspect = A.kind === 'field' ? ROWS / COLS : 0.75;   // 1部屋の縦横比
    const cw = Math.min((W - 20) / A.w, (H - 20) / (A.h * aspect), A.kind === 'field' ? 999 : 90);
    const chh = cw * aspect;
    const ox = (W - cw * A.w) / 2, oy = (H - chh * A.h) / 2;
    const cur = Game.room.kind === 'cave' ? (S.ret ? S.ret.room : '1,2') : Game.roomKey;
    for (const key of Object.keys(A.rooms)) {
      const [x, y] = key.split(',').map(Number);
      const seen = S.flags[`v:${areaId}:${key}`];
      c.fillStyle = seen ? (A.kind === 'field' ? '#3f7a3a' : '#5a5a86') : '#26263a';
      c.fillRect(ox + x * cw + 2, oy + y * chh + 2, cw - 4, chh - 4);
      if (seen && A.kind === 'field') {
        c.fillStyle = '#d9f0d0';
        c.font = `bold 17px ${FONT}`;
        c.textAlign = 'center';
        c.fillText(A.rooms[key].name, ox + x * cw + cw / 2, oy + y * chh + chh / 2 + 4);
      }
      if (A.kind === 'dungeon' && A.rooms[key].boss && seen) {
        c.fillStyle = '#ff5a6e';
        c.beginPath(); c.arc(ox + x * cw + cw / 2, oy + y * chh + chh / 2, 9, 0, Math.PI * 2); c.fill();
      }
      if (key === cur) {
        c.strokeStyle = '#ffd24a';
        c.lineWidth = 5;
        c.strokeRect(ox + x * cw + 2, oy + y * chh + 2, cw - 4, chh - 4);
      }
    }
  },

  showEnding() {
    const S = Game.S;
    S.cleared = true;
    Save.write(S);
    $('ending-stats').innerHTML = [
      ['プレイ時間', fmtTime(S.time)],
      ['やられた回数', `${S.deaths}`],
      ['ハート', `${S.maxHp / 2}`],
      ['ジェム', `${S.gems}`],
    ].map(([k, v]) => `<div class="rrow"><span>${k}</span><b>${v}</b></div>`).join('');
    setTimeout(() => this.show('ending'), 600);
  },
};

window.addEventListener('load', () => Main.init());
