/* =========================================================================
   STEEL SERPENT ― ワールド
   ステージ構築 / 更新 / 当たり判定の補助 / 警戒システム / 描画
   ========================================================================= */

const GAME = {
  /* 実体 */
  canvas: null, ctx: null, scale: 1, vw: 960, vh: 560,
  level: null, solids: [], ladders: [], props: [], pickups: [], enemies: [], bullets: [], hitboxes: [],
  player: null, boss: null,
  diff: DIFF.normal, diffKey: 'normal',
  stageIdx: 0, carryWeapons: ['knife', 'm9'],

  /* 状態 */
  running: false, paused: false, time: 0, score: 0,
  alertLevel: 0, alertT: 0, reinforcements: 0,
  arenaX0: 0, arenaX1: 4000, arenaList: [], activeArena: null,
  objective: '', toastEl: null, weather: null, windX: 0,
  pendingCodec: null, ended: false,

  /* コールバック（main.js が差し込む） */
  onCodecRequest: null, onStageClear: null, onGameOverScreen: null,

  /* ===================== 初期化 ===================== */
  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.toastEl = $('center-toast');
    window.addEventListener('resize', () => this.resize());
    this.resize();
  },

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wrap = $('stage-wrap');
    const cssW = Math.max(320, wrap.clientWidth), cssH = Math.max(240, wrap.clientHeight);
    /* 横長は高さ基準、縦長は幅基準で仮想解像度を決める（縦持ちでも横が見えるように） */
    let sc;
    if (cssW >= cssH) sc = cssH / (cssW < 760 ? 440 : 560);
    else sc = cssW / 560;
    this.scale = sc;
    this.vh = Math.round(cssH / sc); this.vw = Math.round(cssW / sc);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.pxScale = sc * dpr;
    Cam.w = this.vw; Cam.h = this.vh;
    document.body.classList.toggle('compact', cssW < 720);
  },

  mouseWorld() { return Cam.toWorld(Input.mouse.x / this.scale, Input.mouse.y / this.scale); },

  /* ===================== ステージ開始 ===================== */
  startStage(idx, diffKey) {
    this.stageIdx = idx;
    if (diffKey) { this.diffKey = diffKey; this.diff = DIFF[diffKey]; }
    const lv = STAGE_BUILDERS[idx]();
    this.level = lv;
    this.solids = lv.solids;
    this.ladders = lv.ladders;
    this.props = lv.props.map((p) => new Prop(p.kind, p.x, p.y));
    this.pickups = lv.items.map((i) => new Pickup(i.kind, i.x, i.y))
      .concat(lv.guns.map((g) => new Pickup('gun', g.x, g.y, g.wid)));
    this.bullets = []; this.hitboxes = []; this.enemies = [];
    this.boss = null; this.score = 0; this.time = 0;
    this.alertLevel = 0; this.alertT = 0; this.reinforcements = 0;
    this.ended = false; this.paused = false;
    this.windX = lv.wind || 0;
    FX.clear();
    Screen.vignette = 0; Screen.slow = 1; Screen.slowT = 0; Screen.hitstop = 0; Screen.flashA = 0;

    this.player = new Player(lv.spawn.x, lv.spawn.y);
    for (const e of lv.enemies) this.enemies.push(new Enemy(e.type, e.x, e.y, e.patrol, e.face));

    /* ボスの闘技場を整理 */
    if (lv.arenas) this.arenaList = lv.arenas.map((a) => Object.assign({ done: false, started: false }, a));
    else {
      const ev = lv.events.find((e) => e.kind === 'boss');
      this.arenaList = [{ x0: lv.arena.x0, x1: lv.arena.x1, boss: lv.boss, trigger: ev ? ev.x : lv.arena.x0, pos: lv.bossPos, done: false, started: false }];
    }
    this.activeArena = null;
    this.arenaX0 = 0; this.arenaX1 = lv.w;

    Cam.bounds = { x: 0, y: 0, w: lv.w, h: lv.h };
    Cam.reset(this.player.x, this.player.y - 40);
    Cam.tzoom = 1;

    this.weather = lv.theme === 'ferry' ? 'rain' : (lv.theme === 'base' ? 'snow' : null);
    this.setObjective(lv.brief.obj[0]);
    Audio.setMusic(lv.music);
    this.running = true;
    this.updateHUD();
    $('stage-name').textContent = 'STAGE ' + lv.num + ' ― ' + lv.name;
    $('boss-bar').classList.add('hidden');
  },

  setObjective(t) { this.objective = t; $('objective').textContent = t; },

  /* ===================== 地形ヘルパー ===================== */
  lineOfSight(x1, y1, x2, y2) {
    for (const s of this.solids) {
      if (s.oneway) continue;
      if (segRect(x1, y1, x2, y2, s)) return false;
    }
    return true;
  },
  ladderAt(box) {
    for (const l of this.ladders) if (rectsOverlap(box, l)) return l;
    return null;
  },
  blockedAbove(a) {
    const b = { x: a.x - a.w / 2, y: a.feet - P_H, w: a.w, h: P_H - 4 };
    for (const s of this.solids) { if (s.oneway) continue; if (rectsOverlap(b, s)) return true; }
    return false;
  },
  onOneway(a) {
    const b = { x: a.x - a.w / 2, y: a.feet - 2, w: a.w, h: 8 };
    for (const s of this.solids) if (s.oneway && rectsOverlap(b, s)) return true;
    return false;
  },

  /* ===================== 爆発 ===================== */
  explode(x, y, r, dmg, owner) {
    Audio.explode(); Cam.kick(11); Screen.flash('#ffb87a', 0.34);
    FX.ring(x, y, '#ffd27a', 8, r * 1.5, 0.42, 6);
    FX.spark(x, y, 26, '#ffcf8a', 460, 0.6);
    FX.smoke(x, y, 12, '#5c646a', 90, 26);
    const all = [...this.enemies, this.player];
    for (const a of all) {
      if (!a || a.dead) continue;
      const d = dist(x, y, a.x, a.y);
      if (d > r) continue;
      const k = 1 - d / r;
      if (a === this.player) {
        if (a.iFrames > 0) { a.perfectDodge(null); continue; }
        if (a.rushing) continue;
        a.damage(dmg * k * 0.7, owner, { dir: sign(a.x - x) });
      } else {
        a.damage(dmg * k, owner, { dir: sign(a.x - x), x: a.x, y: a.y });
      }
      a.vx += sign(a.x - x) * 220 * k;
      if (a.vy !== undefined) a.vy -= 180 * k;
    }
    for (const p of this.props) {
      if (p.dead) continue;
      if (dist(x, y, p.x, p.y) < r) p.damage(dmg * 0.8);
    }
  },

  /* ===================== 音・警戒 ===================== */
  makeNoise(x, y, r, loud) {
    for (const e of this.enemies) if (e.hear) e.hear(x, y, r, loud);
    if (loud && this.alertLevel === 0) this.setAlert(1, 8);
  },

  raiseAlert() {
    if (this.alertLevel < 2) {
      this.player.stats.alerts++;
      GAME.toast('ALERT ― 発見された', '#ff4d55');
      Audio.setMusic('tense');
      /* 増援（上限つき） */
      if (this.reinforcements < 4 && !this.activeArena) {
        this.reinforcements += 2;
        const side = this.player.x > this.level.w / 2 ? -1 : 1;
        for (let i = 0; i < 2; i++) {
          this.spawnReinforcement(i === 0 ? 'grunt' : 'smg', this.player.x + side * (520 + i * 90), this.player.y - 30);
        }
      }
    }
    this.setAlert(2, 22);
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead || e.sleeping || e instanceof Boss) continue;
      if (dist(e.x, e.y, p.x, p.y) < 1100) {
        e.lastSeen = { x: p.x, y: p.y };
        if (e.state !== 'combat') { e.state = 'search'; e.searchT = 9; }
      }
    }
  },
  setAlert(level, t) {
    this.alertLevel = Math.max(this.alertLevel, level);
    this.alertT = Math.max(this.alertT, t);
    this.updateAlertBadge();
  },
  updateAlertBadge() {
    const el = $('alert-badge');
    el.className = 'alert-badge ' + ['normal', 'caution', 'alert'][this.alertLevel];
    $('alert-text').textContent = ['NORMAL', 'CAUTION', 'ALERT'][this.alertLevel];
    $('alert-mark').textContent = ['●', '?', '!'][this.alertLevel];
    const max = this.alertLevel === 2 ? 22 : 12;
    $('alert-timer').style.width = (clamp(this.alertT / max, 0, 1) * 100) + '%';
  },

  spawnReinforcement(type, x, y) {
    x = clamp(x, 60, this.level.w - 60);
    const e = new Enemy(type, x, y, null, sign(this.player.x - x) || 1);
    e.state = 'search'; e.searchT = 10; e.lastSeen = { x: this.player.x, y: this.player.y };
    this.enemies.push(e);
    FX.ring(x, y, '#ff4d55', 6, 60, 0.4, 2);
  },

  /* ===================== 対象選択 ===================== */
  nearestEnemy(x, y, range, needLOS) {
    let best = null, bd = range;
    for (const e of this.enemies) {
      if (e.dead || e.sleeping) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bd && (!needLOS || this.lineOfSight(x, y, e.x, e.y))) { bd = d; best = e; }
    }
    return best;
  },
  rushTarget(p, range, exclude) {
    const cands = [];
    for (const e of this.enemies) {
      if (e.dead || e === exclude || e.state === 'intro') continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d <= range) cands.push({ e, d, mark: e.marked > 0 ? 1 : 0 });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => (b.mark - a.mark) || (a.d - b.d));
    return cands[0].e;
  },
  cqcTarget(p) {
    for (const e of this.enemies) {
      if (e.dead || e.noCQC) continue;
      if (Math.abs(e.x - p.x) > 44 || Math.abs(e.y - p.y) > 40) continue;
      const unaware = e.sleeping || e.state === 'patrol' || e.state === 'suspect' || e.state === 'search';
      const behind = sign(p.x - e.x) === -e.face || e.sleeping;
      if (unaware && (behind || e.sleeping)) return e;
    }
    return null;
  },

  onEnemyNeutralized(e, silent) {
    if (!silent) this.makeNoise(e.x, e.y, 240, false);
  },

  /* ===================== ボス ===================== */
  startBoss(arena) {
    arena.started = true;
    this.activeArena = arena;
    this.arenaX0 = arena.x0; this.arenaX1 = arena.x1;
    Cam.bounds = { x: arena.x0, y: 0, w: arena.x1 - arena.x0, h: this.level.h };
    this.boss = new Boss(arena.boss, arena.pos.x, arena.pos.y);
    this.enemies.push(this.boss);
    Audio.setMusic('boss');
    Audio.bossRoar();
    Screen.flash('#fff', 0.4); Cam.kick(10);
    const d = BOSSES[arena.boss];
    $('boss-name-text').textContent = d.name + ' ― ' + d.title;
    $('boss-phase').textContent = 'PHASE 1';
    $('boss-bar').classList.remove('hidden');
    this.toast(d.name + ' 出現', '#ff4d55');
    this.updateBossBar();
  },
  updateBossBar() {
    if (!this.boss) return;
    const k = clamp(this.boss.hp / this.boss.maxHp, 0, 1);
    $('boss-fill').style.width = (k * 100) + '%';
    $('boss-ghost').style.width = (k * 100) + '%';
    $('boss-phase').textContent = 'PHASE ' + this.boss.phase;
  },
  onBossDefeated(b) {
    const arena = this.activeArena;
    if (arena) arena.done = true;
    setTimeout(() => { $('boss-bar').classList.add('hidden'); }, 1200);
    this.toast(b.bd.name + ' 撃破', '#ffd27a');
    const remaining = this.arenaList.some((a) => !a.done);
    setTimeout(() => {
      this.boss = null;
      this.activeArena = null;
      this.arenaX0 = 0; this.arenaX1 = this.level.w;
      Cam.bounds = { x: 0, y: 0, w: this.level.w, h: this.level.h };
      if (remaining) { Audio.setMusic('tense'); this.setObjective('目標：さらに奥へ進め'); }
      else this.finishStage();
    }, 2000);
  },

  finishStage() {
    if (this.ended) return;
    this.ended = true; this.running = false;
    Audio.setMusic(null);
    if (this.onStageClear) this.onStageClear(this.buildResult());
  },

  buildResult() {
    const s = this.player.stats;
    const par = [270, 300, 360][this.stageIdx];
    let val = 100;
    val -= s.alerts * 7;
    val -= s.dmgTaken * 0.22;
    val += s.stealth * 3.5;
    val += s.perfect * 2.2;
    val += s.maxCombo * 1.2;
    val -= Math.max(0, this.time - par) * 0.06;
    val = clamp(val, 0, 120);
    const rank = RANK_TABLE.find((r) => val >= r.min).rank;
    const bonus = Math.round(s.stealth * 200 + s.perfect * 150 + s.maxCombo * 100 + Math.max(0, par - this.time) * 8);
    return {
      stage: this.stageIdx, rank, score: this.score + bonus, bonus,
      time: this.time, kills: s.kills, stealth: s.stealth, perfect: s.perfect,
      maxCombo: s.maxCombo, alerts: s.alerts, dmg: Math.round(s.dmgTaken),
      accuracy: s.shots ? Math.round((s.hits / s.shots) * 100) : 0,
    };
  },

  onPlayerDeath() {
    this.running = false;
    Audio.setMusic(null);
    setTimeout(() => { if (this.onGameOverScreen) this.onGameOverScreen(); }, 1400);
  },

  /* ===================== トースト ===================== */
  toast(text, color) {
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = text;
    el.style.color = color || '#fff';
    el.style.textShadow = '0 0 18px ' + (color || '#fff') + '66, 0 2px 6px #000';
    this.toastEl.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  },

  /* ===================== 更新 ===================== */
  update(dtReal) {
    if (!this.running || this.paused) return;
    if (Screen.hitstop > 0) { Screen.hitstop -= dtReal; FX.update(dtReal * 0.15); return; }

    Screen.update(dtReal);
    Audio.updateMusic(dtReal);

    const p = this.player;
    const slow = Screen.slow * (p && p.rushing ? 0.3 : 1);
    const dt = dtReal * slow;

    if (!p.dead) this.time += dtReal;

    /* 警戒レベルの減衰 */
    if (this.alertT > 0) {
      this.alertT -= dtReal;
      if (this.alertT <= 0) {
        if (this.alertLevel === 2) { this.alertLevel = 1; this.alertT = 12; Audio.caution(); }
        else { this.alertLevel = 0; this.alertT = 0; Audio.setMusic(this.level.music); }
      }
      this.updateAlertBadge();
    }

    /* プレイヤー（ラッシュ中は実時間で動く） */
    p.update(p.rushing ? dtReal : dt);
    p.x = clamp(p.x, this.arenaX0 + p.w / 2, this.arenaX1 - p.w / 2);

    /* 敵 */
    for (const e of this.enemies) e.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.deadT > 14 && e !== this.boss) this.enemies.splice(i, 1);
    }

    /* 弾・近接判定 */
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (this.windX && b.owner === 'player') b.vx += this.windX * dt * 0.4;
      if (!b.update(dt)) this.bullets.splice(i, 1);
    }
    for (let i = this.hitboxes.length - 1; i >= 0; i--) {
      if (!this.hitboxes[i].update(dt)) this.hitboxes.splice(i, 1);
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (!this.pickups[i].update(dt)) this.pickups.splice(i, 1);
    }
    FX.update(dtReal);

    /* イベント */
    this.checkEvents();

    /* カメラ */
    const m = this.mouseWorld();
    const lookX = clamp((Input.usingTouch ? p.face * 90 : (m.x - p.x)) * 0.28, -150, 150);
    const lookY = clamp((Input.usingTouch ? 0 : (m.y - p.y)) * 0.16, -90, 70) - 44;
    Cam.follow(p.x, p.y, lookX, lookY, dtReal);

    if (this.boss) this.updateBossBar();
    this.updateHUD();
  },

  checkEvents() {
    const p = this.player;
    for (const ev of this.level.events) {
      if (ev.done || p.x < ev.x) continue;
      ev.done = true;
      if (ev.kind === 'objective') this.setObjective(ev.val);
      else if (ev.kind === 'codec') { if (this.onCodecRequest) this.onCodecRequest(ev.val); }
      else if (ev.kind === 'tutorial') this.tutorial(ev.val);
    }
    for (const a of this.arenaList) {
      if (a.started || a.done) continue;
      if (p.x >= a.trigger) {
        const codecId = 's' + this.level.num + '_boss' + (this.arenaList.length > 1 ? (this.arenaList.indexOf(a) + 1) : '');
        if (CODEC[codecId] && this.onCodecRequest) this.onCodecRequest(codecId, () => this.startBoss(a));
        else this.startBoss(a);
        break;
      }
    }
  },

  tutorial(kind) {
    if (kind === 'dodge') {
      this.toast('Shift／右クリックでドッジ　―　攻撃をかわすとRUSH', '#cfe9ff');
    }
  },

  /* ===================== HUD ===================== */
  updateHUD() {
    const p = this.player;
    if (!p) return;
    const hpK = clamp(p.hp / p.maxHp, 0, 1);
    $('hp-fill').style.width = (hpK * 100) + '%';
    $('hp-ghost').style.width = (hpK * 100) + '%';
    $('hp-num').textContent = Math.max(0, Math.ceil(p.hp)) + (p.armor > 0 ? '+' + Math.ceil(p.armor) : '');
    $('focus-fill').style.width = (p.focus / p.maxFocus * 100) + '%';
    $('ration-count').textContent = '×' + p.rations;

    const w = p.weapon, a = p.ammo;
    $('weapon-name').textContent = w.name;
    $('ammo-mag').textContent = w.melee ? '∞' : a.mag;
    $('ammo-res').textContent = w.melee ? '' : a.reserve;
    $('weapon-ammo').className = (!w.melee && a.mag === 0) ? 'low' : '';
    $('reload-hint').classList.toggle('hidden', w.melee || a.mag > 0 || a.reserve <= 0);

    const list = $('weapon-list');
    const sig = WEAPON_ORDER.map((id) => (p.weapons[id].owned ? (id === p.cur ? '1' : '0') + p.weapons[id].mag : '')).join('|');
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = WEAPON_ORDER.filter((id) => p.weapons[id].owned).map((id, i) => {
        const n = WEAPON_ORDER.indexOf(id) + 1;
        const cls = 'wl-item' + (id === p.cur ? ' active' : '') + (!WEAPONS[id].melee && p.weapons[id].mag + p.weapons[id].reserve === 0 ? ' empty' : '');
        return `<span class="${cls}">${n} ${WEAPONS[id].short}</span>`;
      }).join('');
    }

    const stocks = $('rush-stocks');
    if (stocks.dataset.n !== String(p.rushStock)) {
      stocks.dataset.n = String(p.rushStock);
      stocks.innerHTML = [0, 1, 2].map((i) => `<div class="rush-pip${i < p.rushStock ? ' on' : ''}"></div>`).join('');
    }
    $('dodge-ring').className = p.dodgeCd <= 0 && p.dodgeT <= 0 ? 'ready' : '';
    $('stat-time').textContent = fmtTime(this.time);
    $('stat-kill').textContent = '撃破 ' + p.stats.kills;
    $('stat-stealth').textContent = '静粛 ' + p.stats.stealth;
    $('box-indicator').classList.toggle('hidden', !p.boxOn);
  },

  /* ===================== 描画 ===================== */
  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.pxScale, 0, 0, this.pxScale, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    if (!this.level) return;

    this.drawBackground(ctx);

    ctx.save();
    Cam.apply(ctx);
    const view = Cam.view();
    const pad = 90;
    const vis = { x: view.x - pad, y: view.y - pad, w: view.w + pad * 2, h: view.h + pad * 2 };

    this.drawDeco(ctx, vis);
    this.drawSolids(ctx, vis);
    for (const l of this.ladders) if (rectsOverlap(l, vis)) this.drawLadder(ctx, l);
    for (const p of this.props) if (!p.dead && rectsOverlap(p.box, vis)) p.draw(ctx);
    for (const e of this.enemies) if (rectsOverlap(e.box, vis)) e.drawVision && e.drawVision(ctx);
    for (const p of this.pickups) if (rectsOverlap(p.box, vis)) p.draw(ctx);
    for (const e of this.enemies) if (e !== this.boss && rectsOverlap(e.box, vis)) e.draw(ctx);
    if (this.boss) this.boss.draw(ctx);
    if (this.player) this.player.draw(ctx);
    for (const b of this.bullets) b.draw(ctx);
    FX.draw(ctx);
    this.drawArenaWalls(ctx, view);
    this.drawWeather(ctx, view);
    ctx.restore();

    this.drawOverlay(ctx);
    Screen.draw(ctx, this.vw, this.vh);
  },

  /* ---------- 背景 ---------- */
  drawBackground(ctx) {
    const th = this.level.theme, t = this.time;
    const W = this.vw, H = this.vh;
    const cam = Cam;
    if (th === 'ferry') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#060c14'); g.addColorStop(0.55, '#0b1723'); g.addColorStop(1, '#101d28');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      /* 月 */
      ctx.save(); ctx.globalAlpha = 0.5;
      const mx = W * 0.78 - cam.x * 0.02, my = H * 0.2;
      const mg = ctx.createRadialGradient(mx, my, 4, mx, my, 90);
      mg.addColorStop(0, 'rgba(200,220,240,.7)'); mg.addColorStop(1, 'rgba(200,220,240,0)');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 90, 0, 7); ctx.fill();
      ctx.fillStyle = '#c9d8e6'; ctx.beginPath(); ctx.arc(mx, my, 16, 0, 7); ctx.fill();
      ctx.restore();
      /* 海 */
      const seaY = H * 0.62;
      ctx.fillStyle = '#0a1620'; ctx.fillRect(0, seaY, W, H - seaY);
      for (let i = 0; i < 5; i++) {
        ctx.save(); ctx.globalAlpha = 0.12 + i * 0.03;
        ctx.strokeStyle = '#4d7f9e'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        const yy = seaY + 14 + i * 22;
        for (let x = 0; x <= W; x += 12) {
          const y = yy + Math.sin((x + cam.x * (0.06 + i * 0.02) + t * (40 + i * 18)) * 0.02) * (3 + i);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.restore();
      }
      /* 遠景の船影 */
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#050a10';
      const ox = -cam.x * 0.06;
      ctx.fillRect(((ox + 300) % (W + 600)) - 300, seaY - 26, 180, 26);
      ctx.fillRect(((ox + 1200) % (W + 600)) - 300, seaY - 16, 120, 16);
      ctx.restore();
    } else if (th === 'plane') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#161a1f'); g.addColorStop(1, '#0c0f13');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      /* 機体のリブ */
      ctx.save(); ctx.strokeStyle = 'rgba(150,170,190,.09)'; ctx.lineWidth = 8;
      for (let i = -1; i < 12; i++) {
        const x = ((i * 160 - cam.x * 0.35) % (W + 320) + W + 320) % (W + 320) - 160;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      ctx.restore();
      /* 窓と雲 */
      ctx.save();
      for (let i = -1; i < 10; i++) {
        const x = ((i * 210 - cam.x * 0.5) % (W + 420) + W + 420) % (W + 420) - 210;
        const y = H * 0.22;
        ctx.fillStyle = '#0e161d'; ctx.beginPath(); ctx.ellipse(x, y, 15, 21, 0, 0, 7); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, 12.5, 18, 0, 0, 7); ctx.clip();
        const sg = ctx.createLinearGradient(0, y - 27, 0, y + 27);
        sg.addColorStop(0, '#2c4a63'); sg.addColorStop(1, '#8fa8b8');
        ctx.fillStyle = sg; ctx.fillRect(x - 22, y - 30, 44, 60);
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        const cx = ((t * 60 + i * 90) % 120) - 40;
        ctx.beginPath(); ctx.ellipse(x + cx, y + 5, 11, 4, 0, 0, 7); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(180,200,215,.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, 14, 20, 0, 0, 7); ctx.stroke();
      }
      ctx.restore();
      /* 非常灯（天井側だけ赤く染める） */
      ctx.save();
      const eg = ctx.createLinearGradient(0, 0, 0, H);
      const ea = 0.16 + Math.sin(t * 2) * 0.05;
      eg.addColorStop(0, 'rgba(255,77,85,' + ea + ')');
      eg.addColorStop(0.55, 'rgba(255,77,85,' + (ea * 0.28) + ')');
      eg.addColorStop(1, 'rgba(255,77,85,0)');
      ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0a1016'); g.addColorStop(0.6, '#101820'); g.addColorStop(1, '#182028');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      /* 山影 */
      ctx.save(); ctx.fillStyle = '#0c141c';
      for (let layer = 0; layer < 2; layer++) {
        const off = -cam.x * (0.05 + layer * 0.05);
        ctx.globalAlpha = 0.7 - layer * 0.25;
        ctx.beginPath(); ctx.moveTo(-100, H);
        for (let x = -100; x <= W + 100; x += 60) {
          const y = H * (0.42 + layer * 0.1) + Math.sin((x - off) * 0.004 + layer) * 60 + Math.sin((x - off) * 0.011) * 26;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W + 100, H); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      if (this.alertLevel === 2) {
        ctx.save(); ctx.globalAlpha = 0.1 + Math.sin(t * 6) * 0.07;
        ctx.fillStyle = '#ff2b36'; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
    }
  },

  /* ---------- 装飾 ---------- */
  drawDeco(ctx, vis) {
    for (const d of this.level.deco) {
      const dw = d.kind === 'wall' ? d.a : 300;
      if (d.x + dw < vis.x - 300 || d.x > vis.x + vis.w + 300) continue;
      ctx.save(); ctx.translate(d.x, d.y);
      switch (d.kind) {
        case 'wall': {
          const g = ctx.createLinearGradient(0, 0, 0, d.b);
          g.addColorStop(0, '#121a20'); g.addColorStop(0.7, '#0d141a'); g.addColorStop(1, '#080d11');
          ctx.fillStyle = g; ctx.fillRect(0, 0, d.a, d.b);
          ctx.strokeStyle = 'rgba(150,180,200,.05)'; ctx.lineWidth = 2;
          for (let x = 0; x < d.a; x += 120) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, d.b); ctx.stroke(); }
          ctx.fillStyle = 'rgba(150,180,200,.05)';
          ctx.fillRect(0, d.b * 0.34, d.a, 6);
          ctx.fillStyle = 'rgba(255,180,60,.07)';
          for (let x = 60; x < d.a; x += 340) ctx.fillRect(x, 20, 44, 8);
          break;
        }
        case 'crane':
          ctx.fillStyle = '#2a3540'; ctx.fillRect(-8, -300, 16, 300);
          ctx.fillRect(-120, -300, 240, 12);
          ctx.strokeStyle = '#1e2831'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(60, -288); ctx.lineTo(60, -180); ctx.stroke();
          ctx.fillStyle = '#3a4650'; ctx.fillRect(44, -180, 32, 26);
          break;
        case 'mast':
          ctx.fillStyle = '#243039'; ctx.fillRect(-6, -420, 12, 420);
          ctx.fillStyle = '#ff4d55'; ctx.beginPath(); ctx.arc(0, -424, 5, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(120,150,170,.35)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, -410); ctx.lineTo(-180, -60); ctx.moveTo(0, -410); ctx.lineTo(180, -60); ctx.stroke();
          break;
        case 'helipad':
          /* 横視点なので、甲板の塗装は思い切り潰して路面に見せる */
          ctx.save(); ctx.translate(0, -4); ctx.scale(1, 0.16);
          ctx.strokeStyle = 'rgba(230,240,245,.3)'; ctx.lineWidth = 34;
          ctx.beginPath(); ctx.arc(0, 0, 300, 0, 7); ctx.stroke();
          ctx.font = '900 300px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(230,240,245,.22)'; ctx.fillText('H', 0, 10);
          ctx.restore();
          for (let i = -3; i <= 3; i++) {
            ctx.fillStyle = i % 2 ? '#ffb43c' : '#7dff9b';
            ctx.globalAlpha = 0.5 + Math.sin(this.time * 3 + i) * 0.4;
            ctx.beginPath(); ctx.arc(i * 92, -10, 4, 0, 7); ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        case 'seats':
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = '#2b3641'; ctx.fillRect(i * 46 - 90, -46, 34, 46);
            ctx.fillStyle = '#39454f'; ctx.fillRect(i * 46 - 90, -46, 34, 10);
          }
          break;
        case 'ramp':
          ctx.fillStyle = 'rgba(120,170,210,.14)';
          ctx.beginPath(); ctx.moveTo(-140, -260); ctx.lineTo(240, -260); ctx.lineTo(240, 0); ctx.lineTo(-140, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(180,210,235,.3)'; ctx.lineWidth = 2;
          for (let i = 0; i < 10; i++) {
            const y = -250 + ((this.time * 260 + i * 30) % 250);
            ctx.globalAlpha = 0.35;
            ctx.beginPath(); ctx.moveTo(-140, y); ctx.lineTo(-40, y + 16); ctx.stroke();
          }
          break;
        case 'tower':
          ctx.fillStyle = '#28323c'; ctx.fillRect(-30, -70, 60, 70);
          ctx.fillStyle = '#1d262e'; ctx.fillRect(-36, -84, 72, 16);
          ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#ffe6a3';
          const a = Math.sin(this.time * 0.6) * 0.7;
          ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(Math.cos(a + 1.2) * 700, Math.sin(a + 1.2) * 700 - 70);
          ctx.lineTo(Math.cos(a + 1.6) * 700, Math.sin(a + 1.6) * 700 - 70); ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        case 'fence':
          ctx.strokeStyle = 'rgba(150,170,185,.35)'; ctx.lineWidth = 1.4;
          for (let i = 0; i < 12; i++) {
            ctx.beginPath(); ctx.moveTo(i * 16 - 90, -70); ctx.lineTo(i * 16 - 74, 0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(i * 16 - 90, 0); ctx.lineTo(i * 16 - 74, -70); ctx.stroke();
          }
          ctx.fillStyle = '#333f4a'; ctx.fillRect(-92, -78, 200, 6);
          break;
        case 'screens':
          ctx.fillStyle = '#161f26'; ctx.fillRect(-118, -178, 300, 76);
          ctx.fillStyle = '#0b1116'; ctx.fillRect(-118, -102, 300, 8);
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = '#05090c'; ctx.fillRect(i * 70 - 108, -170, 58, 44);
            ctx.fillStyle = ['#2f8f4d', '#6ec8ff', '#2f8f4d', '#ffb43c'][i];
            ctx.globalAlpha = 0.32 + Math.sin(this.time * 3 + i) * 0.18;
            ctx.fillRect(i * 70 - 104, -166, 50, 36);
            ctx.globalAlpha = 0.5;
            for (let y = -164; y < -132; y += 6) ctx.fillRect(i * 70 - 100, y, rand(42, 12), 2);
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = '#1d2831'; ctx.fillRect(-10, -94, 24, 94);
          break;
        case 'tank':
          ctx.fillStyle = '#1b2731'; ctx.fillRect(-40, -180, 80, 180);
          ctx.fillStyle = 'rgba(110,200,255,.18)'; ctx.fillRect(-34, -174, 68, 168);
          ctx.strokeStyle = '#3c4b57'; ctx.lineWidth = 3; ctx.strokeRect(-40, -180, 80, 180);
          break;
        case 'pillars':
          for (let i = 0; i < 3; i++) { ctx.fillStyle = '#232d36'; ctx.fillRect(i * 200 - 40, -240, 40, 240); }
          break;
        case 'hangar':
          /* 格納庫：アーチ屋根１枚＋鉄骨の柱と横梁 */
          ctx.strokeStyle = 'rgba(150,175,195,.18)'; ctx.lineWidth = 10;
          ctx.beginPath(); ctx.ellipse(60, 0, 470, 430, 0, Math.PI, 0); ctx.stroke();
          ctx.strokeStyle = 'rgba(150,175,195,.1)'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.ellipse(60, 0, 400, 360, 0, Math.PI, 0); ctx.stroke();
          ctx.fillStyle = 'rgba(120,145,165,.13)';
          for (let i = -2; i <= 3; i++) ctx.fillRect(i * 180 - 20, -330, 14, 330);
          ctx.fillRect(-400, -344, 940, 12);
          ctx.fillStyle = 'rgba(255,180,60,.18)';
          ctx.fillRect(-380, -8, 940, 8);
          for (let i = -3; i <= 4; i++) { ctx.fillStyle = 'rgba(255,180,60,.3)'; ctx.fillRect(i * 120, -20, 46, 6); }
          break;
      }
      ctx.restore();
    }
  },

  /* ---------- 地形 ---------- */
  drawSolids(ctx, vis) {
    for (const s of this.solids) {
      if (!rectsOverlap(s, vis)) continue;
      this.drawSolid(ctx, s);
    }
  },
  drawSolid(ctx, s) {
    const th = this.level.theme;
    if (s.oneway || s.t === 'grate') {
      ctx.fillStyle = '#2b3640'; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = 'rgba(150,175,195,.35)'; ctx.lineWidth = 1;
      for (let x = s.x + 4; x < s.x + s.w; x += 9) { ctx.beginPath(); ctx.moveTo(x, s.y); ctx.lineTo(x, s.y + s.h); ctx.stroke(); }
      ctx.fillStyle = '#404e59'; ctx.fillRect(s.x, s.y, s.w, 3);
      return;
    }
    let base = '#2b3640', top = '#465562', line = 'rgba(0,0,0,.35)';
    if (s.t === 'crate') { base = '#6b5433'; top = '#8a6c42'; }
    else if (s.t === 'deck') { base = '#28323b'; top = '#47586a'; }
    else if (s.t === 'plane') { base = '#333c45'; top = '#59656f'; }
    else if (s.t === 'base') { base = '#252d34'; top = '#3f4a53'; }
    else if (s.t === 'ground') { base = '#1e262c'; top = '#dfe9ef'; }
    ctx.fillStyle = base; ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = top; ctx.fillRect(s.x, s.y, s.w, s.t === 'ground' ? 7 : 4);
    /* 質感 */
    ctx.save();
    ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
    if (s.t === 'crate') {
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.w, s.y + s.h); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(s.x, s.y, s.w, s.h * 0.4);
    } else if (s.t === 'ground') {
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      for (let x = s.x; x < s.x + s.w; x += 40) ctx.fillRect(x, s.y + 7, 22, 3);
    } else {
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      for (let x = s.x + 46; x < s.x + s.w; x += 46) { ctx.beginPath(); ctx.moveTo(x, s.y); ctx.lineTo(x, s.y + s.h); ctx.stroke(); }
      for (let y = s.y + 30; y < s.y + s.h; y += 30) { ctx.beginPath(); ctx.moveTo(s.x, y); ctx.lineTo(s.x + s.w, y); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      for (let x = s.x + 10; x < s.x + s.w; x += 46) for (let y = s.y + 12; y < s.y + s.h; y += 30) { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 7); ctx.fill(); }
    }
    if (s.h > 60) {
      const dg = ctx.createLinearGradient(0, s.y + 6, 0, s.y + s.h);
      dg.addColorStop(0, 'rgba(0,0,0,0)'); dg.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = dg; ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(s.x, s.y + s.h - 10, s.w, 10);
    ctx.restore();
  },
  drawLadder(ctx, l) {
    ctx.save();
    ctx.strokeStyle = '#8d9aa5'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(l.x + 4, l.y); ctx.lineTo(l.x + 4, l.y + l.h);
    ctx.moveTo(l.x + l.w - 4, l.y); ctx.lineTo(l.x + l.w - 4, l.y + l.h); ctx.stroke();
    ctx.lineWidth = 2;
    for (let y = l.y + 8; y < l.y + l.h; y += 16) { ctx.beginPath(); ctx.moveTo(l.x + 3, y); ctx.lineTo(l.x + l.w - 3, y); ctx.stroke(); }
    ctx.restore();
  },

  drawArenaWalls(ctx, view) {
    if (!this.activeArena) return;
    ctx.save();
    for (const x of [this.arenaX0, this.arenaX1]) {
      const g = ctx.createLinearGradient(x, 0, x + (x === this.arenaX0 ? 40 : -40), 0);
      g.addColorStop(0, 'rgba(255,60,70,.28)'); g.addColorStop(1, 'rgba(255,60,70,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x === this.arenaX0 ? x : x - 40, view.y, 40, view.h);
      ctx.strokeStyle = 'rgba(255,90,90,.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, view.y); ctx.lineTo(x, view.y + view.h); ctx.stroke();
    }
    ctx.restore();
  },

  drawWeather(ctx, view) {
    if (this.weather === 'rain') {
      for (let i = 0; i < 4; i++) FX.rain(view.x + rand(view.w), view.y - 20, rand(40, 22));
      if (Math.random() < 0.0025) { Screen.flash('#9fc4e0', 0.32); setTimeout(() => Audio.explode(), 400); }
    } else if (this.weather === 'snow' && this.player && this.player.x < 2130) {
      for (let i = 0; i < 3; i++) {
        FX.add({ k: 'dot', x: view.x + rand(view.w), y: view.y - 10, vx: rand(30, -50), vy: rand(90, 40), g: 0, life: 4, t: 0, c: '#dfe9ef', r: rand(2.2, 0.8) });
      }
    }
    if (this.level.theme === 'plane' && this.player && this.player.x > 5000) {
      ctx.save(); ctx.globalAlpha = 0.16; ctx.strokeStyle = '#cfe4f2'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 16; i++) {
        const y = view.y + ((i * 47 + this.time * 40) % view.h);
        const x = view.x + ((i * 173 - this.time * 900) % view.w + view.w) % view.w;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y + 3); ctx.stroke();
      }
      ctx.restore();
    }
  },

  /* ---------- 画面上の表示 ---------- */
  drawOverlay(ctx) {
    const p = this.player;
    if (!p || p.dead) return;
    if (!Input.usingTouch) {
      const mx = Input.mouse.x / this.scale, my = Input.mouse.y / this.scale;
      ctx.save();
      ctx.translate(mx, my);
      const spread = 6 + (p.weapon.spread || 0) * 260 + p.recoil * 8;
      ctx.strokeStyle = p.rushing ? '#ffb43c' : 'rgba(230,245,255,.85)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * spread, Math.sin(a) * spread);
        ctx.lineTo(Math.cos(a) * (spread + 7), Math.sin(a) * (spread + 7));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(230,245,255,.9)';
      ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, 7); ctx.fill();
      ctx.restore();
    }
    /* 画面外の敵の方向 */
    const view = Cam.view();
    ctx.save();
    for (const e of this.enemies) {
      if (e.dead || e.state !== 'combat') continue;
      if (pointInRect(e.x, e.y, view)) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const a = Math.atan2(dy, dx);
      const r = Math.min(this.vw, this.vh) * 0.38;
      const cx = this.vw / 2 + Math.cos(a) * r, cy = this.vh / 2 + Math.sin(a) * r;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ff4d55';
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
};
