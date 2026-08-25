/* =========================================================================
   MECH RAIDERS ― 戦闘エンジン
   Field クラス（更新側）。描画は render.js が prototype に足す。
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData, F = window.MRField;
const { TAU, clamp, lerp, dist, dist2, angTo, angDiff, angApproach, deg,
        RNG, rnd, rndi, pick, circleRect, segRect, segCircle,
        Particles, FloatText, Camera } = C;
const { buildLoadout, Mech, Enemy, Boss, genWorld, genArena, wallsNear, pointBlocked,
        hasLOS, collideWalls } = F;

/* ============================ Field ============================ */
class Field {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.input = opts.input;
    this.audio = opts.audio;
    this.save = opts.save;
    this.sector = opts.sector;
    this.numPlayers = opts.numPlayers || 1;
    this.demo = !!opts.demo;
    this.onEnd = opts.onEnd || (() => {});
    this.onHud = opts.onHud || (() => {});
    this.rng = new RNG(opts.seed || (Date.now() & 0xffffffff));

    this.parts = new Particles(1600);
    this.ft = new FloatText();
    this.cam = new Camera();
    this.dpr = opts.dpr || 1;
    this.baseZoom = 1.14;
    this.cam.zoom = this.dpr * this.baseZoom;
    this.time = 0;
    this.state = 'play';        // play | clear | fail
    this.endT = 0;
    this.slowmo = 0;
    this.hitStop = 0;

    this.bullets = [];
    this.beams = [];
    this.hazards = [];
    this.markers = [];
    this.pickups = [];
    this.phantoms = [];
    this.enemies = [];
    this.objects = [];          // 通信塔・コンテナ
    this.boss = null;
    this.bossPending = false;
    this.bossSite = null;
    this.toast = null; this.toastT = 0;
    this.banner = null; this.bannerT = 0;

    this.reward = { scrap: 0, tickets: 0, kills: 0 };
    this.build();
  }

  /* ---------------- 構築 ---------------- */
  build() {
    const s = this.sector;
    this.training = !!s.training;
    this.world = this.training ? genArena(s) : genWorld(s, this.rng);
    const W = this.world;

    this.players = [];
    for (let p = 1; p <= this.numPlayers; p++) {
      const lo = buildLoadout(p, this.save);
      const m = new Mech(p, lo, (this.training ? 300 : 250) + (p - 1) * 56, this.training ? 420 : 250);
      this.players.push(m);
    }

    if (this.training) return this.buildTraining();
    if (this.demo) { this.respawnQueue = []; this.trainStats = null; }

    const lvMul = 1 + (s.lv - 1) * 0.28;
    this.lvMul = lvMul;
    const pool = [];
    for (const [id, n] of s.pool) for (let i = 0; i < n; i++) pool.push(id);
    for (let i = 0; i < s.count; i++) {
      const id = pool[i % pool.length];
      const def = D.ENEMIES[id];
      const pos = this.findSpot(760);
      if (!pos) continue;
      this.enemies.push(new Enemy(def, pos.x, pos.y, lvMul, false));
    }
    this.rng.shuffle(this.enemies);

    this.objectives = [];
    for (const o of s.objectives) {
      if (o === 'kill_all') this.objectives.push({ id: 'kill_all', need: this.enemies.length, done: 0 });
      else if (o === 'towers') { this.spawnTowers(s.towers || 3); this.objectives.push({ id: 'towers', need: s.towers || 3, done: 0 }); }
      else if (o === 'crates') { this.spawnCrates(s.crates || 3); this.objectives.push({ id: 'crates', need: s.crates || 3, done: 0 }); }
      else if (o === 'commander') { this.spawnCommander(); this.objectives.push({ id: 'commander', need: 1, done: 0 }); }
    }
    /* kill_all は指揮官・護衛を足したあとの総数で数える */
    const ko = this.objectives.find((x) => x.id === 'kill_all');
    if (ko) ko.need = this.enemies.length;
    if (s.boss) {
      this.objectives.push({ id: 'boss', need: 1, done: 0, locked: true });
      this.bossSite = { x: W.w - 280, y: W.h - 280 };
    }
    if (this.demo) { this.objectives = []; this.banner = null; this.bannerT = 0; this.toastT = 0; }
    else {
      this.banner = `${s.name} ― ${s.sub}`;
      this.bannerT = 3.2;
      this.setToast(s.brief, 5.0);
    }
    this.cam.follow(this.players[0].x, this.players[0].y, this.viewW(), this.viewH(), W.w, W.h, 1, true);
    this.roster = this.enemies.slice();
  }

  /* ---------------- 練習場 ---------------- */
  buildTraining() {
    const s = this.sector, W = this.world;
    this.objectives = [];
    this.trainStats = { dmg: 0, dps: 0, peak: 0, kills: 0, recent: [] };
    this.respawnQueue = [];
    /* 的（装甲 4 種を並べて相性を見る） */
    const armors = ['FRAME', 'ARMOR', 'SHIELD', 'COMP'];
    armors.forEach((armor, i) => {
      this.objects.push({
        kind: 'dummy', x: 640 + i * 200, y: 150, r: 22, armor, team: 'foe',
        hp: 900, maxHp: 900, dead: false, hitFlash: 0, respawn: 0,
        name: D.ARMORS[armor].name,
      });
    });
    /* 動く相手 */
    const kinds = ['scout', 'gunner', 'shielder', 'heavy', 'arcbot', 'mender'];
    kinds.forEach((k, i) => {
      const a = (i / kinds.length) * TAU;
      const x = clamp(W.w * 0.55 + Math.cos(a) * 380, 120, W.w - 120);
      const y = clamp(W.h * 0.66 + Math.sin(a) * 300, 120, W.h - 120);
      const e = new Enemy(D.ENEMIES[k], x, y, 1, false);
      this.enemies.push(e);
    });
    this.roster = this.enemies.slice();
    this.banner = '練習場 ― TRAINING RANGE';
    this.bannerT = 3.0;
    this.setToast(s.brief, 6.0);
    this.cam.follow(this.players[0].x, this.players[0].y, this.viewW(), this.viewH(), W.w, W.h, 1, true);
  }

  viewW() { return this.canvas.width / (this.cam.zoom || 1); }
  viewH() { return this.canvas.height / (this.cam.zoom || 1); }

  findSpot(minDist, tries = 240) {
    const W = this.world;
    for (let i = 0; i < tries; i++) {
      const x = this.rng.f(90, W.w - 90), y = this.rng.f(90, W.h - 90);
      if (pointBlocked(W, x, y, 30)) continue;
      if (dist(x, y, 250, 250) < minDist) continue;
      let ok = true;
      for (const e of this.enemies) if (dist2(x, y, e.x, e.y) < 110 * 110) { ok = false; break; }
      if (!ok) continue;
      return { x, y };
    }
    /* 距離条件を緩めて再挑戦 */
    if (minDist > 300) return this.findSpot(minDist * 0.6, 80);
    return null;
  }

  spawnTowers(n) {
    for (let i = 0; i < n; i++) {
      const pos = this.findSpot(900);
      if (!pos) continue;
      const hp = 360 * this.lvMul;
      this.objects.push({ kind: 'tower', x: pos.x, y: pos.y, r: 26, hp, maxHp: hp,
        armor: 'ARMOR', team: 'foe', spawnT: 8, ang: 0, dead: false, hitFlash: 0 });
    }
  }
  spawnCrates(n) {
    for (let i = 0; i < n; i++) {
      const pos = this.findSpot(800);
      if (!pos) continue;
      this.objects.push({ kind: 'crate', x: pos.x, y: pos.y, r: 24, cap: 0, need: 2.2, dead: false, ang: rnd(TAU), team: 'neutral' });
    }
  }
  spawnCommander() {
    const pos = this.findSpot(1000);
    if (!pos) return;
    const e = new Enemy(D.ENEMIES.heavy, pos.x, pos.y, this.lvMul, true);
    this.enemies.push(e);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU, gx = pos.x + Math.cos(a) * 120, gy = pos.y + Math.sin(a) * 120;
      if (pointBlocked(this.world, gx, gy, 26)) continue;
      const g = new Enemy(D.ENEMIES.gunner, gx, gy, this.lvMul, false);
      g.guardOf = e; this.enemies.push(g);
    }
  }

  setToast(text, t) { this.toast = text; this.toastT = t; }

  /* ================= メインループ ================= */
  update(dtRaw) {
    let dt = Math.min(dtRaw, 1 / 30);
    if (this.hitStop > 0) { this.hitStop -= dtRaw; dt *= 0.06; }
    if (this.slowmo > 0) { this.slowmo -= dtRaw; dt *= 0.34; }
    if (this.state === 'play') this.time += dt;

    this.bannerT -= dtRaw; this.toastT -= dtRaw;
    this.beams.length = 0;

    for (const m of this.players) this.updatePlayer(m, dt);
    this.updateRevive(dt);
    for (const e of this.enemies) if (!e.dead) this.updateEnemy(e, dt);
    if (this.boss && !this.boss.dead) this.updateBoss(this.boss, dt);
    this.updateObjects(dt);
    this.updateBullets(dt);
    this.updateHazards(dt);
    this.updateMarkers(dt);
    this.updatePickups(dt);
    this.updatePhantoms(dt);
    this.separate(dt);

    this.parts.update(dt);
    this.ft.update(dt);

    this.checkObjectives();
    this.updateCamera(dt);

    if (this.state !== 'play') {
      this.endT -= dtRaw;
      if (this.endT <= 0) this.finish();
    }
    this.onHud(this);
  }

  updateCamera(dt) {
    const alive = this.players.filter((p) => !p.dead);
    const list = alive.length ? alive : this.players;
    let cx = 0, cy = 0;
    for (const p of list) { cx += p.x; cy += p.y; }
    cx /= list.length; cy /= list.length;
    let zoom = 1;
    if (list.length > 1) {
      const sep = dist(list[0].x, list[0].y, list[1].x, list[1].y);
      zoom = clamp(1 - (sep - 480) / 2400, 0.62, 1);
    }
    this.cam.zoom = lerp(this.cam.zoom || 1, zoom * this.dpr * this.baseZoom, 1 - Math.pow(0.05, dt));
    this.cam.follow(cx, cy, this.viewW(), this.viewH(), this.world.w, this.world.h, dt);
  }

  /* ================= プレイヤー ================= */
  updatePlayer(m, dt) {
    if (m.dead) return;
    const idle = { mx: 0, my: 0, fire: false, roll: false, special: false, swap: false, lock: false };
    const inp = this.state !== 'play' ? idle : this.demo ? this.botInput(m, dt) : this.input.read(m.pid);

    m.rollCd = Math.max(0, m.rollCd - dt);
    m.iframe = Math.max(0, m.iframe - dt);
    m.hitFlash = Math.max(0, m.hitFlash - dt * 4);
    m.recoil = Math.max(0, m.recoil - dt * 8);
    m.muzzle = Math.max(0, m.muzzle - dt * 12);
    m.stun = Math.max(0, m.stun - dt);
    m.noHitT += dt;
    m.hnrT = Math.max(0, (m.hnrT || 0) - dt);
    m.stillT = Math.hypot(m.vx, m.vy) < 26 ? (m.stillT || 0) + dt : 0;
    if (m.shieldT > 0) m.shieldT -= dt;
    if (m.burn > 0) {
      m.burnT -= dt;
      if (m.burnT <= 0) m.burn = 0; else this.hurtPlayer(m, m.burn * dt, 'THR', null, true);
    }
    if (m.has('self_repair') && m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.008 * dt);

    if (m.down) {
      m.downT -= dt;
      m.vx *= 0.86; m.vy *= 0.86;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (Math.random() < dt * 8) this.parts.smoke(m.x, m.y, 1, 'rgba(90,80,80,', 24, 1.2, 8);
      if (m.downT <= 0) this.killPlayer(m);
      return;
    }

    /* ---- 照準 ---- */
    this.updateLock(m, inp);
    if (m.pid === 1 && !this.demo) {
      const mw = this.screenToWorld(this.input.mouse.x, this.input.mouse.y);
      m.aim = angTo(m.x, m.y, mw.x, mw.y);
      m.aimX = mw.x; m.aimY = mw.y;
    } else if (m.lock && !m.lock.dead) {
      m.aim = angApproach(m.aim, angTo(m.x, m.y, m.lock.x, m.lock.y), dt * 14);
      m.aimX = m.lock.x; m.aimY = m.lock.y;
    } else if (inp.mx || inp.my) {
      m.aim = angApproach(m.aim, Math.atan2(inp.my, inp.mx), dt * 12);
      m.aimX = m.x + Math.cos(m.aim) * 400; m.aimY = m.y + Math.sin(m.aim) * 400;
    } else {
      m.aimX = m.x + Math.cos(m.aim) * 400; m.aimY = m.y + Math.sin(m.aim) * 400;
    }

    /* ---- 移動 ---- */
    let spd = m.lo.speed;
    if (m.has('adrenaline') && m.hp / m.maxHp <= 0.30) spd *= 1.30;
    if (m.specialState === 'overboost') spd *= 1.95;
    if (m.specialState === 'siege') spd *= 0.22;
    if (m.slow > 0) { spd *= 0.55; m.slow -= dt; }
    if (m.stun > 0) spd = 0;

    if (m.rollT > 0) {
      m.rollT -= dt;
      const p = 1 - m.rollT / m.rollDur;
      const boost = (1 - p * p) * m.rollSpeed;
      m.vx = Math.cos(m.rollDir) * boost;
      m.vy = Math.sin(m.rollDir) * boost;
      m.ang = angApproach(m.ang, m.rollDir, dt * 18);
      if (Math.random() < dt * 34) this.parts.dirSpark(m.x, m.y, m.rollDir + Math.PI, 1, m.lo.frame.trim, 140, 0.5, 0.26, 2.2);
      if (m.has('thrust_wave')) {
        for (const e of this.enemies) {
          if (e.dead || e.knockT > 0) continue;
          if (dist2(e.x, e.y, m.x, m.y) < (e.r + m.r + 16) ** 2) {
            const a = angTo(m.x, m.y, e.x, e.y);
            e.vx += Math.cos(a) * 460; e.vy += Math.sin(a) * 460; e.knockT = 0.45;
            this.applyDamage(e, 24, 'THR', m, { text: true });
          }
        }
      }
    } else {
      const tx = inp.mx * spd, ty = inp.my * spd;
      m.vx = lerp(m.vx, tx, 1 - Math.pow(0.0009, dt));
      m.vy = lerp(m.vy, ty, 1 - Math.pow(0.0009, dt));
      if (inp.mx || inp.my) {
        m.moveDir = Math.atan2(inp.my, inp.mx);
        m.ang = angApproach(m.ang, m.moveDir, dt * 11);
        m.walkPhase += dt * Math.hypot(m.vx, m.vy) * 0.055;
      }
    }

    /* ---- Space: 進行方向へローリング ---- */
    if (inp.roll && m.rollT <= 0 && m.rollCd <= 0 && m.stun <= 0) {
      const dir = (inp.mx || inp.my) ? Math.atan2(inp.my, inp.mx) : (m.moveDir != null ? m.moveDir : m.ang);
      m.rollDir = dir;
      m.rollDur = 0.30;
      m.rollT = m.rollDur;
      m.rollSpeed = m.lo.speed * 3.0 * (m.has('inertia_cancel') ? 1.15 : 1);
      m.rollCd = m.lo.rollCd;
      m.iframe = 0.22 * (m.has('adrenaline') && m.hp / m.maxHp <= 0.3 ? 1.6 : 1);
      if (m.has('hit_and_run')) m.hnrT = m.rollDur + 1.2;
      this.audio.sfx('roll');
      this.parts.dirSpark(m.x, m.y, dir + Math.PI, 9, m.lo.frame.trim, 190, 0.7, 0.34, 2.4);
      this.parts.ring(m.x, m.y, 'rgba(180,220,255,0.5)', 8, 42, 0.22, 3);
    }

    m.x += m.vx * dt; m.y += m.vy * dt;
    collideWalls(this.world, m);

    if (inp.swap && m.lo.weapons.length > 1) {
      m.wi = (m.wi + 1) % m.lo.weapons.length;
      this.audio.sfx('reload');
      this.ft.add(m.x, m.y - 34, m.weapon.name, '#9fd4ff', 12, 1.0);
    }

    if (inp.special && m.sp >= m.spMax && !m.specialState) this.startSpecial(m);
    if (m.specialState) this.runSpecial(m, dt);

    this.updateWeapon(m, dt, inp.fire && m.rollT <= 0 && m.stun <= 0 && !m.blockFire);
  }

  /* タイトル背景で流すデモ用の自動操縦 */
  botInput(m, dt) {
    if (!m.bot) m.bot = { strafe: Math.random() < 0.5 ? 1 : -1, swT: 0, rollT: rnd(1, 3), swapT: rnd(8, 16) };
    const bt = m.bot;
    bt.swT -= dt; bt.rollT -= dt; bt.swapT -= dt;
    if (bt.swT <= 0) { bt.strafe *= -1; bt.swT = rnd(1.2, 2.6); }

    let t = m.lock && !m.lock.dead ? m.lock : null;
    if (!t) {
      let bd = Infinity;
      for (const e of this.allFoes()) {
        const d = dist2(m.x, m.y, e.x, e.y);
        if (d < bd) { bd = d; t = e; }
      }
    }
    const out = { mx: 0, my: 0, fire: false, roll: false, special: false, swap: false, lock: false };
    if (!t) {
      /* 相手がいないときは中央へ流す */
      const a = angTo(m.x, m.y, this.world.w / 2, this.world.h / 2);
      out.mx = Math.cos(a); out.my = Math.sin(a);
      return out;
    }
    const d = dist(m.x, m.y, t.x, t.y);
    const toT = angTo(m.x, m.y, t.x, t.y);
    let a;
    if (d > 340) a = toT + 0.25 * bt.strafe;
    else if (d < 170) a = toT + Math.PI + 0.4 * bt.strafe;
    else a = toT + (Math.PI / 2) * bt.strafe;
    /* 壁を避ける */
    for (const off of [0, 0.6, -0.6, 1.3, -1.3, 2.2, -2.2]) {
      const px = m.x + Math.cos(a + off) * 90, py = m.y + Math.sin(a + off) * 90;
      if (!pointBlocked(this.world, px, py, m.r)) { a += off; break; }
    }
    out.mx = Math.cos(a); out.my = Math.sin(a);
    out.fire = d < 540 && hasLOS(this.world, m.x, m.y, t.x, t.y, false);
    if (bt.rollT <= 0) { out.roll = true; bt.rollT = rnd(2.2, 4.5); }
    if (m.sp >= m.spMax && d < 420) out.special = true;
    if (bt.swapT <= 0) { out.swap = true; bt.swapT = rnd(9, 18); }
    return out;
  }

  screenToWorld(sx, sy) {
    const z = this.cam.zoom || 1;
    return { x: this.cam.x + sx / z, y: this.cam.y + sy / z };
  }

  updateLock(m, inp) {
    if (m.lock && (m.lock.dead || dist2(m.x, m.y, m.lock.x, m.lock.y) > 900 * 900)) m.lock = null;
    const cands = this.lockCandidates(m);
    if (inp.lock && cands.length) {
      const i = cands.indexOf(m.lock);
      m.lock = cands[(i + 1) % cands.length];
      this.audio.sfx('lock');
    }
    if ((!m.lock || cands.indexOf(m.lock) < 0) && cands.length) m.lock = cands[0];
  }
  lockCandidates(m) {
    const out = [];
    const add = (e) => {
      if (!e || e.dead) return;
      const d2 = dist2(m.x, m.y, e.x, e.y);
      if (d2 > 820 * 820) return;
      if (!hasLOS(this.world, m.x, m.y, e.x, e.y, false)) return;
      out.push({ e, d: d2 + Math.abs(angDiff(m.aim, angTo(m.x, m.y, e.x, e.y))) * 30000 });
    };
    for (const e of this.enemies) add(e);
    for (const o of this.objects) if (o.kind === 'tower') add(o);
    if (this.boss) add(this.boss);
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.e);
  }

  /* ---------------- 武器 ---------------- */
  updateWeapon(m, dt, firing) {
    const w = m.weapon;
    if (!w) return;
    let rateMul = 1;
    if (m.has('overheat') && m.hp / m.maxHp <= 0.5) rateMul *= 1.35;
    if (m.specialState === 'full_salvo') rateMul *= 1.6;
    if (m.specialState === 'overboost') rateMul *= 1.9;
    if (m.specialState === 'siege') rateMul *= 1.35;
    if (m.has('gun_mount') && (m.stillT || 0) > 0.6) rateMul *= 1.3;

    if (w.reloading > 0) {
      w.reloading -= dt * rateMul;
      if (w.reloading <= 0) { w.ammo = w.mag; this.audio.sfx('reload'); }
      w.spin = Math.max(0, w.spin - dt * 2);
      return;
    }
    w.cool -= dt * rateMul;

    if (w.kind === 'beam') return this.fireBeam(m, w, dt, firing);
    if (w.kind === 'flame') return this.fireFlame(m, w, dt, firing);

    if (w.spinup) {
      w.spin = clamp(w.spin + (firing ? dt : -dt * 1.6) / w.spinup, 0, 1);
      if (firing && w.spin < 1) return;
    }
    if (w.charge) {
      if (firing) {
        w.chargeT = Math.min(w.charge, w.chargeT + dt);
        if (Math.random() < dt * 24) this.parts.dirSpark(m.x + Math.cos(m.aim) * 26, m.y + Math.sin(m.aim) * 26, m.aim, 1, '#7cf3ff', 150, 0.6, 0.22, 2);
        return;
      }
      if (w.chargeT > 0) {
        const full = w.chargeT >= w.charge * 0.9;
        w.chargeT = 0;
        if (full) { if (w.mag > 0 && w.ammo <= 0) { w.reloading = w.reload; return; } this.shoot(m, w); }
        return;
      }
      return;
    }
    if (!firing || w.cool > 0) return;
    if (w.mag > 0 && w.ammo <= 0) { w.reloading = w.reload; return; }
    this.shoot(m, w);
  }

  shoot(m, w) {
    w.cool = 60 / w.rpm;
    if (w.mag > 0 && m.specialState !== 'overboost') w.ammo--;
    m.recoil = 1; m.muzzle = 1;
    const bx = m.x + Math.cos(m.aim) * (m.r + 8);
    const by = m.y + Math.sin(m.aim) * (m.r + 8);

    if (w.kind === 'melee') return this.meleeSwing(m, w);
    if (w.kind === 'chain') return this.chainZap(m, w);

    let spreadMul = 1;
    if (m.specialState === 'siege') spreadMul *= 0.4;
    if (m.has('gun_mount') && (m.stillT || 0) > 0.6) spreadMul *= 0.5;
    const volley = w.volley || 1;
    for (let v = 0; v < volley; v++) {
      for (let i = 0; i < w.pellets; i++) {
        const sp = deg(w.spread || 0) * spreadMul;
        const a = m.aim + rnd(-sp, sp) + (volley > 1 ? rnd(-0.14, 0.14) : 0);
        this.spawnBullet({
          x: bx, y: by, ang: a, speed: w.bspeed * rnd(0.94, 1.06),
          dmg: w.dmg, el: w.el, team: 'ally', owner: m,
          size: w.bsize || 3, range: w.range, pierce: w.pierce, bounce: w.bounce,
          splash: w.splash || 0, homing: w.homing ? (m.lock || null) : null, turn: w.turn,
          lob: w.kind === 'lob', color: D.ELEMENTS[w.el].color,
        });
      }
    }
    this.parts.dirSpark(bx, by, m.aim, w.kind === 'shotgun' ? 11 : 4, '#ffe9b0', 230, 0.4, 0.16, 2.4);
    this.cam.addShake(w.dmg > 40 ? 4 : 1.1);
    this.audio.sfx(w.dmg >= 40 ? 'shotBig' : 'shot');
    if (w.mag > 0 && w.ammo <= 0) w.reloading = w.reload;
  }

  fireBeam(m, w, dt, firing) {
    if (!firing) { w.spin = Math.max(0, w.spin - dt * 3); return; }
    if (w.mag > 0 && w.ammo <= 0) { w.reloading = w.reload; return; }
    if (m.specialState !== 'overboost') w.ammo -= dt * 26;
    const hit = this.rayHit(m.x, m.y, m.aim, w.range, 'ally', w.pierce >= 99 ? 99 : 1);
    this.beams.push({ x1: m.x + Math.cos(m.aim) * (m.r + 4), y1: m.y + Math.sin(m.aim) * (m.r + 4),
      x2: hit.x, y2: hit.y, w: w.beamw || 3, color: D.ELEMENTS[w.el].color });
    for (const t of hit.targets) this.applyDamage(t, w.dmg * dt * 26, w.el, m, { text: Math.random() < 0.2 });
    if (hit.targets.length) this.parts.dirSpark(hit.x, hit.y, m.aim + Math.PI, 2, D.ELEMENTS[w.el].color, 190, 0.9, 0.2, 2);
    m.muzzle = 1;
    this.audio.sfx('beam');
    if (w.ammo <= 0) w.reloading = w.reload;
  }

  fireFlame(m, w, dt, firing) {
    if (!firing) return;
    if (w.mag > 0 && w.ammo <= 0) { w.reloading = w.reload; return; }
    if (m.specialState !== 'overboost') w.ammo -= dt * 34;
    m.muzzle = 1;
    const life = w.range / w.bspeed;
    for (let i = 0; i < 3; i++) {
      const a = m.aim + rnd(-deg(w.spread), deg(w.spread));
      const sp = rnd(w.bspeed * 0.6, w.bspeed);
      this.parts.add({ x: m.x + Math.cos(m.aim) * 22, y: m.y + Math.sin(m.aim) * 22,
        vx: Math.cos(a) * sp + m.vx * 0.4, vy: Math.sin(a) * sp + m.vy * 0.4,
        life, max: life, color: pick(['#ffd166', '#ff8a3c', '#ff5a2a']),
        size: rnd(5, 11), grow: 26, drag: 1.6, kind: 'smoke' });
    }
    for (const t of this.allFoes()) {
      const d = dist(m.x, m.y, t.x, t.y);
      if (d > w.range + t.r) continue;
      if (Math.abs(angDiff(m.aim, angTo(m.x, m.y, t.x, t.y))) > deg(w.spread) + 0.25) continue;
      this.applyDamage(t, w.dmg * dt * 30, w.el, m, { text: Math.random() < 0.14 });
      t.burn = Math.max(t.burn || 0, w.burn); t.burnT = 2.4;
    }
    if (w.ammo <= 0) w.reloading = w.reload;
  }

  meleeSwing(m, w) {
    m.vx += Math.cos(m.aim) * w.lunge; m.vy += Math.sin(m.aim) * w.lunge;
    const half = deg(w.arc) / 2;
    let hitAny = false;
    for (const t of this.allFoes()) {
      const d = dist(m.x, m.y, t.x, t.y);
      if (d > w.range + t.r) continue;
      if (Math.abs(angDiff(m.aim, angTo(m.x, m.y, t.x, t.y))) > half) continue;
      this.applyDamage(t, w.dmg, w.el, m, { text: true, crit: true });
      hitAny = true;
    }
    this.parts.add({ x: m.x, y: m.y, life: 0.22, max: 0.22, color: '#ffb07a', r0: w.range * 0.4, r1: w.range, w: 8, kind: 'ring' });
    this.parts.dirSpark(m.x + Math.cos(m.aim) * 40, m.y + Math.sin(m.aim) * 40, m.aim, 12, '#ffd9a0', 330, 1.0, 0.3, 3);
    if (hitAny) { this.cam.addShake(7); this.hitStop = 0.05; }
    this.audio.sfx(hitAny ? 'explode' : 'roll');
  }

  chainZap(m, w) {
    const hitList = [];
    let from = { x: m.x, y: m.y };
    for (let k = 0; k <= w.chain; k++) {
      let best = null, bd = Infinity;
      const range = k === 0 ? w.range : w.chainRange;
      for (const t of this.allFoes()) {
        if (hitList.indexOf(t) >= 0) continue;
        const d = dist(from.x, from.y, t.x, t.y);
        if (d > range) continue;
        if (k === 0 && Math.abs(angDiff(m.aim, angTo(m.x, m.y, t.x, t.y))) > 0.6) continue;
        if (!hasLOS(this.world, from.x, from.y, t.x, t.y, false)) continue;
        if (d < bd) { bd = d; best = t; }
      }
      if (!best) break;
      this.beams.push({ x1: from.x, y1: from.y, x2: best.x, y2: best.y, w: 3, color: '#c58cff', zig: true });
      this.applyDamage(best, w.dmg * Math.pow(0.82, k), w.el, m, { text: true });
      this.parts.spark(best.x, best.y, 6, '#e0c0ff', 220, 0.35, 2);
      hitList.push(best); from = { x: best.x, y: best.y };
    }
    if (!hitList.length) {
      const ex = m.x + Math.cos(m.aim) * w.range, ey = m.y + Math.sin(m.aim) * w.range;
      this.beams.push({ x1: m.x, y1: m.y, x2: ex, y2: ey, w: 2, color: '#9a7ad0', zig: true });
    }
    this.audio.sfx('beam');
  }

  /* ---------------- 弾 ---------------- */
  spawnBullet(o) {
    const b = {
      x: o.x, y: o.y, vx: Math.cos(o.ang) * o.speed, vy: Math.sin(o.ang) * o.speed,
      ang: o.ang, speed: o.speed, dmg: o.dmg, el: o.el || 'KIN', team: o.team,
      owner: o.owner || null, size: o.size || 3, life: (o.range || 600) / o.speed,
      pierce: o.pierce || 0, bounce: o.bounce || 0, splash: o.splash || 0,
      homing: o.homing || null, turn: o.turn || 0, color: o.color || '#ffd88a',
      hitSet: [], lob: !!o.lob, t: 0, stun: o.stun || 0,
    };
    this.bullets.push(b);
    return b;
  }

  updateBullets(dt) {
    const W = this.world;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.t += dt; b.life -= dt;
      if (b.life <= 0) {
        if (b.splash) this.explode(b.x, b.y, b.splash, b.dmg, b.el, b.team, b.owner);
        this.bullets.splice(i, 1); continue;
      }
      if (b.homing && !b.homing.dead && b.turn) {
        const ta = angTo(b.x, b.y, b.homing.x, b.homing.y);
        b.ang = angApproach(b.ang, ta, b.turn * dt);
        b.vx = Math.cos(b.ang) * b.speed; b.vy = Math.sin(b.ang) * b.speed;
        if (Math.random() < dt * 40) this.parts.add({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.35, max: 0.35, color: 'rgba(180,180,190,', size: 4, grow: 14, kind: 'smoke' });
      }
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;

      let hitWall = null, bestT = 2;
      const span = Math.hypot(nx - b.x, ny - b.y) + 40;
      for (const w of wallsNear(W, (b.x + nx) / 2, (b.y + ny) / 2, span)) {
        if (b.lob && w.low) continue;
        const t = segRect(b.x, b.y, nx, ny, w.x, w.y, w.w, w.h);
        if (t >= 0 && t < bestT) { bestT = t; hitWall = w; }
      }

      const foes = b.team === 'ally' ? this.allFoes() : this.players;
      let hitT = null, hitTT = 2;
      for (const t of foes) {
        if (t.dead || (b.team === 'foe' && t.down)) continue;
        if (b.hitSet.indexOf(t) >= 0) continue;
        if (b.team === 'foe' && (t.iframe > 0 || t.rollT > 0)) continue;
        const tt = segCircle(b.x, b.y, nx, ny, t.x, t.y, t.r + b.size * 0.5);
        if (tt >= 0 && tt < hitTT) { hitTT = tt; hitT = t; }
      }
      if (b.team === 'ally' && this.boss && !this.boss.dead) {
        for (const p of this.boss.parts) {
          if (!p.alive) continue;
          const px = p.wx, py = p.wy;
          if (b.hitSet.indexOf(p) >= 0) continue;
          const tt = segCircle(b.x, b.y, nx, ny, px, py, p.r + b.size * 0.5);
          if (tt >= 0 && tt < hitTT) { hitTT = tt; hitT = { part: p, x: px, y: py, r: p.r }; }
        }
      }

      if (hitT && hitTT <= bestT) {
        const hx = b.x + (nx - b.x) * hitTT, hy = b.y + (ny - b.y) * hitTT;
        if (hitT.part) this.damageBossPart(this.boss, hitT.part, b.dmg, b.el, b.owner);
        else this.applyDamage(hitT, b.dmg, b.el, b.owner, { text: true, stun: b.stun });
        this.parts.dirSpark(hx, hy, b.ang + Math.PI, 5, b.color, 210, 1.0, 0.22, 2.2);
        if (b.splash) { this.explode(hx, hy, b.splash, b.dmg * 0.65, b.el, b.team, b.owner, [hitT.part ? null : hitT]); this.bullets.splice(i, 1); continue; }
        b.hitSet.push(hitT.part ? hitT.part : hitT);
        if (b.pierce > 0) { b.pierce--; b.x = hx; b.y = hy; continue; }
        this.bullets.splice(i, 1); continue;
      }

      if (hitWall) {
        const hx = b.x + (nx - b.x) * bestT, hy = b.y + (ny - b.y) * bestT;
        if (b.splash) { this.explode(hx, hy, b.splash, b.dmg, b.el, b.team, b.owner); this.bullets.splice(i, 1); continue; }
        if (b.bounce > 0) {
          b.bounce--;
          const wl = hitWall;
          const overX = Math.min(Math.abs(hx - wl.x), Math.abs(hx - (wl.x + wl.w)));
          const overY = Math.min(Math.abs(hy - wl.y), Math.abs(hy - (wl.y + wl.h)));
          if (overX < overY) b.vx = -b.vx; else b.vy = -b.vy;
          b.ang = Math.atan2(b.vy, b.vx);
          b.x = hx + Math.cos(b.ang) * 4; b.y = hy + Math.sin(b.ang) * 4;
          this.parts.dirSpark(hx, hy, b.ang, 4, '#ffd9a0', 190, 1.2, 0.2, 2);
          continue;
        }
        this.parts.dirSpark(hx, hy, b.ang + Math.PI, 4, '#c8c8c8', 180, 1.0, 0.18, 2);
        this.bullets.splice(i, 1); continue;
      }
      b.x = nx; b.y = ny;
      if (b.x < 0 || b.y < 0 || b.x > W.w || b.y > W.h) this.bullets.splice(i, 1);
    }
  }

  rayHit(x, y, ang, range, team, maxTargets) {
    const ex = x + Math.cos(ang) * range, ey = y + Math.sin(ang) * range;
    let endT = 1;
    for (const w of wallsNear(this.world, (x + ex) / 2, (y + ey) / 2, range)) {
      if (w.low) continue;
      const t = segRect(x, y, ex, ey, w.x, w.y, w.w, w.h);
      if (t >= 0 && t < endT) endT = t;
    }
    let hx = x + (ex - x) * endT, hy = y + (ey - y) * endT;
    const foes = team === 'ally' ? this.allFoes() : this.players;
    const hits = [];
    for (const t of foes) {
      if (t.dead || t.down) continue;
      const tt = segCircle(x, y, hx, hy, t.x, t.y, t.r);
      if (tt >= 0) hits.push({ t, tt });
    }
    hits.sort((a, b) => a.tt - b.tt);
    const targets = hits.slice(0, maxTargets).map((h) => h.t);
    if (maxTargets < 99 && hits.length) {
      hx = x + (hx - x) * hits[0].tt; hy = y + (hy - y) * hits[0].tt;
    }
    return { x: hx, y: hy, targets };
  }

  explode(x, y, r, dmg, el, team, owner, skip) {
    this.parts.explosion(x, y, r);
    this.cam.addShake(clamp(r / 12, 2, 12));
    this.audio.sfx(r > 110 ? 'boom' : 'explode');
    const foes = team === 'ally' ? this.allFoes() : this.players;
    for (const t of foes) {
      if (!t || t.dead || (team === 'foe' && t.down)) continue;
      if (skip && skip.indexOf(t) >= 0) continue;
      const d = dist(x, y, t.x, t.y);
      if (d > r + t.r) continue;
      this.applyDamage(t, dmg * clamp(1 - (d - t.r) / r, 0.28, 1), el, owner, { text: true });
    }
    if (team === 'ally' && this.boss && !this.boss.dead) {
      for (const p of this.boss.parts) {
        if (!p.alive) continue;
        const px = p.wx, py = p.wy;
        const d = dist(x, y, px, py);
        if (d < r + p.r) this.damageBossPart(this.boss, p, dmg * clamp(1 - d / r, 0.3, 1), el, owner);
      }
    }
  }

  allFoes() {
    const out = [];
    for (const e of this.enemies) if (!e.dead) out.push(e);
    for (const o of this.objects) if ((o.kind === 'tower' || o.kind === 'dummy') && !o.dead) out.push(o);
    if (this.boss && !this.boss.dead && this.boss.entered > 0.4) out.push(this.boss);
    return out;
  }

  /* ---------------- ダメージ ---------------- */
  applyDamage(t, amount, el, src, opt) {
    opt = opt || {};
    if (!t || t.dead) return 0;
    if (t.team === 'ally') { this.hurtPlayer(t, amount, el, src); return amount; }

    const aff = D.affinityOf(el, t.armor || 'FRAME');
    let dmg = amount * aff;

    if (t.def && t.def.frontShield && src) {
      const a = Math.abs(angDiff(t.ang, angTo(t.x, t.y, src.x, src.y)));
      if (a < deg(70)) dmg *= t.def.frontShield;
    }
    if (src && src.lo) {
      if (src.has('fire_control') && dist(src.x, src.y, t.x, t.y) > 300) dmg *= 1.25;
      if (src.has('optic_camo') && src.noHitT >= 3) dmg *= 1.45;
      if (src.specialState === 'siege') dmg *= 1.6;
      if (src.has('hit_and_run') && src.rollT <= 0 && (src.hnrT || 0) > 0) dmg *= 1.40;
      if (src.has('vampiric')) src.hp = Math.min(src.maxHp, src.hp + dmg * 0.09);
      src.dmgDealt += dmg;
      this.gainSp(src, dmg * 0.16);
      if (this.trainStats) {
        this.trainStats.dmg += dmg;
        this.trainStats.recent.push({ t: this.time, d: dmg });
      }
    }

    t.hp -= dmg;
    t.hitFlash = 1;
    if (opt.stun) t.stun = Math.max(t.stun || 0, opt.stun);
    if (src && t.state !== undefined) {
      t.lastKnown = { x: src.x, y: src.y };
      t.target = src.lo ? src : t.target;
      if (t.state === 'patrol' || t.state === 'search') { t.state = 'engage'; this.alertNear(t, 400); }
    }
    if (opt.text) {
      const col = aff >= 1.2 ? '#7dff9a' : aff <= 0.85 ? '#ff8f8f' : '#ffffff';
      this.ft.add(t.x, t.y - t.r - 6, Math.round(dmg).toString(), col, opt.crit ? 17 : dmg > 40 ? 15 : 12, 0.8);
    }
    this.audio.sfx('hit');
    if (t.hp <= 0) this.killFoe(t, src);
    return dmg;
  }

  hurtPlayer(m, amount, el, src, silent) {
    if (m.dead || m.down) return;
    if (m.iframe > 0 || m.rollT > 0) return;
    let dmg = amount * (1 - m.lo.dr);
    if (m.shieldT > 0) dmg *= 0.3;
    if (m.specialState === 'siege') dmg *= 0.5;
    if (dmg <= 0) return;
    m.hp -= dmg;
    m.hitFlash = 1;
    m.noHitT = 0;
    this.gainSp(m, dmg * 0.5);
    if (!silent) {
      this.audio.sfx('hurt');
      this.cam.addShake(clamp(dmg * 0.25, 1.5, 9));
      this.parts.spark(m.x, m.y, 5, '#ff8a5c', 190, 0.4, 2.4);
      this.ft.add(m.x, m.y - 34, `-${Math.round(dmg)}`, '#ff7a7a', 13, 0.7);
    }
    if (m.has('charged_hull')) {
      this.parts.ring(m.x, m.y, 'rgba(197,140,255,0.7)', 10, 130, 0.3, 4);
      for (const t of this.allFoes()) if (dist(m.x, m.y, t.x, t.y) < 130) this.applyDamage(t, 18, 'EMP', m, { text: false });
    }
    if (m.hp <= 0 && (this.training || this.demo)) {
      m.hp = m.maxHp; m.iframe = 2.2;
      for (const w of m.lo.weapons) { w.ammo = w.mag; w.reloading = 0; }
      this.ft.add(m.x, m.y - 44, 'システム復旧', '#8dffb0', 16, 1.6);
      this.parts.ring(m.x, m.y, '#8dffb0', 14, 150, 0.5, 5);
      return;
    }
    if (m.hp <= 0) {
      if (m.has('lastditch') && m.lastDitch) {
        m.lastDitch = false; m.hp = 1; m.iframe = 1.4;
        this.ft.add(m.x, m.y - 42, '最終防壁', '#ffd166', 16, 1.4);
        this.parts.ring(m.x, m.y, '#ffd166', 12, 160, 0.5, 6);
        return;
      }
      this.downPlayer(m);
    }
  }

  gainSp(m, v) {
    if (!m || !m.lo) return;
    m.sp = Math.min(m.spMax, m.sp + v * (m.has('overdrive') ? 1.55 : 1));
  }

  downPlayer(m) {
    m.hp = 0;
    const others = this.players.filter((p) => p !== m && !p.dead && !p.down);
    this.parts.explosion(m.x, m.y, 70);
    this.cam.addShake(12);
    this.audio.sfx('explode');
    if (others.length) {
      m.down = true; m.downT = 16; m.reviveT = 0;
      this.setToast(`P${m.pid} 行動不能 ― 近づいて復旧せよ`, 3);
    } else this.killPlayer(m);
  }
  killPlayer(m) {
    m.dead = true; m.down = false;
    this.parts.explosion(m.x, m.y, 120);
    this.cam.addShake(18);
    this.audio.sfx('boom');
    if (this.players.every((p) => p.dead)) this.fail();
  }

  updateRevive(dt) {
    for (const d of this.players) {
      if (!d.down || d.dead) continue;
      const helper = this.players.find((p) => p !== d && !p.dead && !p.down && dist(p.x, p.y, d.x, d.y) < 72);
      if (helper) {
        d.reviveT += dt;
        this.parts.add({ x: d.x, y: d.y, life: 0.2, max: 0.2, color: 'rgba(140,255,180,0.6)', r0: 20, r1: 34, w: 3, kind: 'ring' });
        if (d.reviveT >= 2.4) {
          d.down = false; d.hp = d.maxHp * 0.5; d.iframe = 1.6; d.reviveT = 0;
          this.audio.sfx('pickup');
          this.ft.add(d.x, d.y - 42, '復旧', '#8dffb0', 16, 1.2);
        }
      } else d.reviveT = Math.max(0, d.reviveT - dt * 0.6);
    }
  }

  killFoe(t, src) {
    t.dead = true;
    if (t.kind === 'dummy') {
      this.parts.explosion(t.x, t.y, 90);
      this.audio.sfx('explode');
      this.ft.add(t.x, t.y - 30, '的 破壊', '#ffcf4a', 15, 1.2);
      t.respawn = 2.5;
      if (this.trainStats) this.trainStats.kills++;
      return;
    }
    if (t.kind === 'tower') {
      this.parts.explosion(t.x, t.y, 150);
      this.parts.shard(t.x, t.y, 14, '#c8d8e8');
      this.cam.addShake(14); this.audio.sfx('boom');
      const o = this.objectives.find((x) => x.id === 'towers');
      if (o) { o.done++; this.setToast(`通信塔を破壊 ${o.done}/${o.need}`, 2.2); }
      this.dropScrap(t.x, t.y, 60);
      return;
    }
    if (t.isBoss) return this.killBoss(t, src);

    this.parts.explosion(t.x, t.y, 26 + t.r * 1.6);
    this.parts.shard(t.x, t.y, 8, t.def.trim);
    this.cam.addShake(t.commander ? 10 : 3);
    this.audio.sfx('explode');
    if (src && src.lo) {
      src.kills++;
      this.gainSp(src, t.def.spGain || 6);
      if (src.has('detonator')) this.explode(t.x, t.y, 96, 45, 'THR', 'ally', src, [t]);
    }
    this.reward.kills++;
    const scrap = Math.round((t.def.scrap || 10) * (t.commander ? 4 : 1) * (1 + (this.sector.lv - 1) * 0.12));
    this.dropScrap(t.x, t.y, scrap);
    if (Math.random() < (t.commander ? 1 : 0.11)) this.dropPickup(t.x, t.y, 'repair');
    if (Math.random() < 0.09) this.dropPickup(t.x, t.y, 'ammo');

    if (this.training || this.demo) {
      this.respawnQueue.push({ id: t.def.id, t: this.demo ? 1.6 : 3.0 });
      if (this.trainStats) this.trainStats.kills++;
    }
    const ko = this.objectives.find((x) => x.id === 'kill_all');
    if (ko) ko.done++;
    if (t.commander) {
      const co = this.objectives.find((x) => x.id === 'commander');
      if (co) { co.done = 1; this.setToast('指揮官機を撃破した', 2.6); }
      this.slowmo = 0.6;
    }
  }

  dropScrap(x, y, amount) {
    const n = clamp(Math.round(amount / 8), 1, 7);
    for (let i = 0; i < n; i++) {
      const a = rnd(TAU), s = rnd(40, 150);
      this.pickups.push({ kind: 'scrap', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, v: Math.max(1, Math.round(amount / n)), r: 7, life: 40 });
    }
  }
  dropPickup(x, y, kind) {
    this.pickups.push({ kind, x, y, vx: rnd(-40, 40), vy: rnd(-40, 40), r: 11, life: 50 });
  }

  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt;
      if (p.life <= 0) { this.pickups.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 4 * dt); p.vy *= Math.max(0, 1 - 4 * dt);
      let near = null, nd = 1e9;
      for (const m of this.players) { if (m.dead || m.down) continue; const d = dist(p.x, p.y, m.x, m.y); if (d < nd) { nd = d; near = m; } }
      if (!near) continue;
      const range = p.kind === 'scrap' ? 140 : 64;
      if (nd < range) {
        const a = angTo(p.x, p.y, near.x, near.y);
        const pull = lerp(560, 140, nd / range);
        p.vx += Math.cos(a) * pull * dt * 6; p.vy += Math.sin(a) * pull * dt * 6;
      }
      if (nd < near.r + p.r) {
        if (p.kind === 'scrap') {
          const gain = Math.round(p.v * (near.has('scavenger') ? 1.3 : 1));
          this.reward.scrap += gain; near.scrapGained += gain;
        } else if (p.kind === 'repair') {
          near.hp = Math.min(near.maxHp, near.hp + near.maxHp * 0.3);
          this.ft.add(near.x, near.y - 38, '+修復', '#8dffb0', 14, 1);
        } else {
          for (const w of near.lo.weapons) { w.ammo = w.mag; w.reloading = 0; }
          this.ft.add(near.x, near.y - 38, '+弾薬', '#9fd4ff', 14, 1);
        }
        this.audio.sfx('pickup');
        this.pickups.splice(i, 1);
      }
    }
  }

  /* 機体同士がめり込まないよう押し合う */
  separate(dt) {
    const all = [];
    for (const p of this.players) if (!p.dead) all.push(p);
    for (const e of this.enemies) if (!e.dead && !e.flying) all.push(e);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const rr = a.r + b.r;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
  }
}

window.MRBattle = { Field };
})();
