/* =========================================================================
   FORGE & CROWN ― 戦闘（見下ろし型アクション）
   ========================================================================= */

const Battle = {
  cv: null, ctx: null, w: 0, h: 0, dpr: 1,
  world: { w: 1600, h: 1100 },
  cam: { x: 0, y: 0 },
  player: null, units: [], projs: [], fx: [], parts: [], texts: [],
  keys: {}, stick: { x: 0, y: 0, on: false }, tbtn: {},
  running: false, last: 0, time: 0, shake: 0, hitStop: 0,
  regionId: null, faction: 'neutral', mode: 'attack',
  lo: null, result: null, over: 0,
  ground: 'plain',

  init() {
    this.cv = $('battle');
    this.ctx = this.cv.getContext('2d');
    window.addEventListener('resize', () => { if (this.running) this.resize(); });

    window.addEventListener('keydown', (e) => {
      if (!this.running) return;
      this.keys[e.code] = true;
      if ([ 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight' ].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    this.cv.addEventListener('pointerdown', (e) => { if (this.running) { this.tbtn.atk = true; setTimeout(() => { this.tbtn.atk = false; }, 60); } });

    // タッチ操作
    const stick = $('stick'), knob = stick.querySelector('.knob');
    let sid = null, sc = { x: 0, y: 0 };
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px,${dy}px)`; };
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId; stick.setPointerCapture(sid);
      const r = stick.getBoundingClientRect();
      sc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.stick.on = true;
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      const dx = e.clientX - sc.x, dy = e.clientY - sc.y;
      const m = Math.hypot(dx, dy), lim = 40;
      const k = m > lim ? lim / m : 1;
      setKnob(dx * k, dy * k);
      this.stick.x = clamp(dx / lim, -1, 1);
      this.stick.y = clamp(dy / lim, -1, 1);
    });
    const endStick = (e) => {
      if (e.pointerId !== sid) return;
      sid = null; this.stick.on = false; this.stick.x = 0; this.stick.y = 0; setKnob(0, 0);
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);

    const bind = (id, key, hold) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.tbtn[key] = true; });
      const off = (e) => { e.preventDefault(); if (!hold) return; this.tbtn[key] = false; };
      el.addEventListener('pointerup', (e) => { e.preventDefault(); this.tbtn[key] = false; });
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    bind('t-atk', 'atk'); bind('t-guard', 'guard', true); bind('t-dash', 'dash'); bind('t-ult', 'ult');
  },

  resize() {
    const r = $('screen-battle').getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
    this.cv.style.width = this.w + 'px';
    this.cv.style.height = this.h + 'px';
  },

  /* ---------- 開戦 ---------- */
  start(regionId, mode, invForce) {
    this.regionId = regionId;
    this.mode = mode || 'attack';
    const st = G.regions[regionId];
    const R = REGION_BY_ID[regionId];
    this.faction = mode === 'defend' ? invForce.faction : st.owner;
    this.ground = R.terr;
    this.groundCv = null;
    this.lo = playerLoadout();
    this.units = []; this.projs = []; this.fx = []; this.parts = []; this.texts = [];
    this.time = 0; this.shake = 0; this.hitStop = 0; this.result = null; this.over = 0; this.done = false;
    this.keys = {}; this.tbtn = {};
    this.gainValor = 0; this.kills = 0; this.allyKills = 0;

    const W = this.world.w, H = this.world.h;

    // プレイヤー
    const p = {
      team: 'ally', isPlayer: true, name: G.lord,
      x: W * 0.16, y: H * 0.5, r: 15, face: 0,
      hp: this.lo.maxHp, maxHp: this.lo.maxHp,
      atk: this.lo.atk, def: this.lo.def, res: this.lo.res,
      spd: 158 * this.lo.spdMul, reach: this.lo.reach,
      sta: 100, rage: 0, combo: 0, comboT: 0,
      swing: null, atkCd: 0, guard: false, guardT: 0, dashT: 0, dashCd: 0, stun: 0, inv: 0,
      regenT: 0, hurt: 0, alive: true,
      color: this.lo.armorColor, edge: this.lo.armorEdge,
    };
    this.player = p;
    this.units.push(p);

    // 味方
    const nAlly = Math.min(rankInfo().troops, G.troops);
    const aMul = this.lo.allyMul;
    for (let i = 0; i < nAlly; i++) {
      this.units.push(this.makeUnit({
        team: 'ally', name: '兵',
        hp: (58 + G.drill * 0.9) * aMul, atk: (8 + G.drill * 0.22) * aMul,
        def: 12 + G.drill * 0.3, spd: 92, reach: 30, kind: 'melee',
        color: '#5b86c4', edge: '#33507d',
        x: W * 0.10 + rand(70), y: H * 0.5 + rand(200, -200),
      }));
    }

    // 敵
    const n = mode === 'defend' ? clamp(Math.round(invForce.force * 0.35), 6, 26) : enemyCountFor(regionId);
    const table = FOE_TABLE[this.faction] || FOE_TABLE.neutral;
    const power = 1 + (REGION_BY_ID[regionId].def / 100);
    for (let i = 0; i < n; i++) {
      const f = FOES[table[i % table.length]];
      this.units.push(this.makeUnit({
        team: 'foe', name: f.name, foeId: f.id,
        hp: f.hp * power, atk: f.atk * power, def: f.def * power, spd: f.spd,
        reach: f.reach, kind: f.kind, magic: !!f.magic, guardChance: f.guard || 0,
        color: f.color, edge: shade(f.color, -0.4), valor: f.valor,
        x: W * (0.55 + Math.random() * 0.4), y: H * (0.1 + Math.random() * 0.8),
      }));
    }

    // 指揮官
    const C = CAPTAINS[this.faction];
    const cap = this.makeUnit({
      team: 'foe', name: C.name, isCaptain: true,
      hp: C.hp * power, atk: C.atk * power, def: C.def * power, spd: C.spd,
      reach: C.reach, kind: C.kind || 'melee', magic: !!C.magic,
      color: C.color, edge: shade(C.color, -0.45), valor: C.valor,
      x: W * 0.88, y: H * 0.5, r: 21,
    });
    this.captain = cap;
    this.units.push(cap);

    this.cam.x = p.x - this.w / 2; this.cam.y = p.y - this.h / 2;

    $('screen-battle').classList.remove('hidden');
    $('touch').classList.toggle('hidden', !isTouch());
    $('bh-my-name').textContent = G.lord;
    $('bh-armor').textContent = this.lo.armorName;
    $('bh-weapon').textContent = this.lo.weaponName;
    $('bh-cap-name').textContent = C.name;
    $('bh-obj').textContent = mode === 'defend'
      ? `${REGION_BY_ID[regionId].name} を守り抜け` : `${C.name} を討て`;
    this.resize();
    this.running = true;
    this.last = performance.now();
    this.battleToast(mode === 'defend' ? '迎撃戦　開始！' : '突撃！');
    requestAnimationFrame((t) => this.loop(t));
  },

  makeUnit(o) {
    return Object.assign({
      x: 0, y: 0, r: 14, face: 0, vx: 0, vy: 0,
      hp: 50, maxHp: 50, atk: 10, def: 0, spd: 80, reach: 30,
      kind: 'melee', team: 'foe', alive: true,
      swing: null, atkCd: rand(1.2), stun: 0, guard: false, inv: 0, hurt: 0,
      wander: rand(Math.PI * 2),
    }, o, { maxHp: o.hp });
  },

  quit() {
    this.running = false;
    $('screen-battle').classList.add('hidden');
    $('touch').classList.add('hidden');
  },

  loop(t) {
    if (!this.running) return;
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.15; }
    this.update(dt);
    this.draw();
  },

  /* ---------- 更新 ---------- */
  update(dt) {
    this.time += dt;
    const p = this.player;

    if (p.alive) this.updatePlayer(dt);
    this.units.forEach((u) => { if (!u.isPlayer && u.alive) this.updateAI(u, dt); });
    this.units.forEach((u) => this.moveUnit(u, dt));
    this.updateSwings(dt);
    this.updateProjs(dt);
    this.updateFx(dt);
    this.updateParts(dt);

    // カメラ
    const tx = clamp(p.x - this.w / 2, 0, Math.max(0, this.world.w - this.w));
    const ty = clamp(p.y - this.h / 2, 0, Math.max(0, this.world.h - this.h));
    this.cam.x = lerp(this.cam.x, tx, 1 - Math.pow(0.001, dt));
    this.cam.y = lerp(this.cam.y, ty, 1 - Math.pow(0.001, dt));
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);

    this.refreshHud();

    // 決着
    if (!this.result) {
      if (!this.captain.alive) this.finish(true);
      else if (!p.alive) this.finish(false);
    } else {
      this.over += dt;
      if (this.over > 1.6 && !this.done) {
        this.done = true; this.running = false;
        showBattleResult(this.result);
      }
    }
  },

  updatePlayer(dt) {
    const p = this.player, k = this.keys;
    let ix = 0, iy = 0;
    if (k.KeyA || k.ArrowLeft) ix -= 1;
    if (k.KeyD || k.ArrowRight) ix += 1;
    if (k.KeyW || k.ArrowUp) iy -= 1;
    if (k.KeyS || k.ArrowDown) iy += 1;
    if (this.stick.on) { ix += this.stick.x; iy += this.stick.y; }
    const m = Math.hypot(ix, iy);
    if (m > 1) { ix /= m; iy /= m; }

    p.guard = (k.KeyK || this.tbtn.guard) && p.sta > 2 && !p.swing;
    if (p.guard) { p.guardT += dt; p.sta = Math.max(0, p.sta - 14 * dt); }
    else { p.guardT = 0; p.sta = Math.min(100, p.sta + 24 * dt); }

    if (p.dashT > 0) p.dashT -= dt;
    if (p.dashCd > 0) p.dashCd -= dt;
    if (p.stun > 0) p.stun -= dt;
    if (p.inv > 0) p.inv -= dt;
    if (p.hurt > 0) p.hurt -= dt;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) p.combo = 0; }

    // 自動回復（聖印）
    if (this.lo.regen) {
      p.regenT += dt;
      if (p.regenT >= 8) { p.regenT = 0; this.heal(p, p.maxHp * 0.07); }
    }

    let spd = p.spd * (p.guard ? 0.42 : 1) * (p.stun > 0 ? 0 : 1);
    if (p.swing) spd *= 0.35;
    if (p.dashT > 0) spd *= 3.4;
    p.vx = ix * spd; p.vy = iy * spd;
    if (m > 0.1 && p.dashT <= 0) p.face = Math.atan2(iy, ix);

    // ダッシュ
    if ((k.KeyL || k.ShiftLeft || k.ShiftRight || this.tbtn.dash)
        && p.dashT <= 0 && p.dashCd <= 0 && p.sta >= 25 && p.stun <= 0) {
      p.dashT = 0.16 * this.lo.dodgeMul;
      p.dashCd = 0.5;
      p.sta -= 25; p.inv = 0.24;
      this.tbtn.dash = false;
      Sfx.noise(0.08, 0.05, 900);
      for (let i = 0; i < 8; i++) this.spark(p.x, p.y, '#cfd8e6', 90, 0.3);
      if (this.lo.charge) this.dashHit(p);
    }

    // 攻撃
    if ((k.KeyJ || this.tbtn.atk) && p.atkCd <= 0 && !p.guard && p.stun <= 0) {
      this.tbtn.atk = false;
      p.combo = (p.combo % 3) + 1;
      p.comboT = 0.75;
      const dur = this.lo.swing * (p.combo === 3 ? 1.25 : 1);
      p.swing = { t: 0, dur, arc: p.combo === 3 ? 2.5 : 1.7, hit: new Set(), mul: p.combo === 3 ? 1.6 : 1, big: p.combo === 3 };
      p.atkCd = dur + 0.08;
      Sfx.slash();
    }

    // 必殺技
    if ((k.Space || this.tbtn.ult) && p.rage >= 100 && p.stun <= 0) {
      this.tbtn.ult = false; this.keys.Space = false;
      p.rage = 0;
      this.castUlt();
    }
  },

  dashHit(p) {
    this.units.forEach((u) => {
      if (u.team === 'foe' && u.alive && dist(u.x, u.y, p.x, p.y) < 46) {
        this.damage(u, p.atk * 1.4, p, false, true);
      }
    });
  },

  updateAI(u, dt) {
    if (u.stun > 0) { u.stun -= dt; u.vx = u.vy = 0; return; }
    if (u.atkCd > 0) u.atkCd -= dt;
    if (u.inv > 0) u.inv -= dt;
    if (u.hurt > 0) u.hurt -= dt;

    // 一番近い敵
    let tgt = null, best = 1e9;
    for (const o of this.units) {
      if (!o.alive || o.team === u.team) continue;
      const d = dist(u.x, u.y, o.x, o.y);
      const w = o.isPlayer ? d * 0.7 : d;   // プレイヤーを狙いやすい
      if (w < best) { best = w; tgt = o; }
    }
    if (!tgt) {
      u.wander += dt;
      u.vx = Math.cos(u.wander) * u.spd * 0.3; u.vy = Math.sin(u.wander) * u.spd * 0.3;
      return;
    }
    const d = dist(u.x, u.y, tgt.x, tgt.y);
    const ang = Math.atan2(tgt.y - u.y, tgt.x - u.x);
    u.face = ang;

    const ranged = u.kind === 'ranged' || u.kind === 'caster';
    const want = ranged ? u.reach * 0.6 : u.reach + u.r + tgt.r - 8;

    if (d > want) {
      u.vx = Math.cos(ang) * u.spd; u.vy = Math.sin(ang) * u.spd;
    } else if (ranged && d < want * 0.55) {
      u.vx = -Math.cos(ang) * u.spd * 0.8; u.vy = -Math.sin(ang) * u.spd * 0.8;
    } else {
      const s = Math.sin(this.time * 1.6 + u.wander) * 0.5;
      u.vx = Math.cos(ang + Math.PI / 2) * u.spd * s;
      u.vy = Math.sin(ang + Math.PI / 2) * u.spd * s;
      if (u.atkCd <= 0) {
        if (ranged) {
          this.shoot(u, ang);
          u.atkCd = (u.kind === 'caster' ? 2.2 : 1.5) + rand(0.6);
        } else {
          u.swing = { t: 0, dur: 0.34, arc: 1.5, hit: new Set(), mul: 1 };
          u.atkCd = 1.0 + rand(0.7);
        }
      }
    }
    u.guard = u.guardChance > 0 && u.atkCd > 0.5 && d < 90 && Math.sin(this.time * 2 + u.wander) > 0;
  },

  moveUnit(u, dt) {
    if (!u.alive) return;
    u.x = clamp(u.x + (u.vx || 0) * dt, 24, this.world.w - 24);
    u.y = clamp(u.y + (u.vy || 0) * dt, 24, this.world.h - 24);
    // ゆるい押しのけ
    for (const o of this.units) {
      if (o === u || !o.alive) continue;
      const dx = u.x - o.x, dy = u.y - o.y;
      const dd = Math.hypot(dx, dy), min = u.r + o.r;
      if (dd > 0.01 && dd < min) {
        const push = (min - dd) * 0.5;
        u.x += (dx / dd) * push; u.y += (dy / dd) * push;
      }
    }
  },

  updateSwings(dt) {
    this.units.forEach((u) => {
      if (!u.swing || !u.alive) return;
      const s = u.swing;
      s.t += dt;
      const prog = s.t / s.dur;
      if (prog >= 0.18 && prog <= 0.75) {
        const reach = u.reach + u.r;
        for (const o of this.units) {
          if (!o.alive || o.team === u.team || s.hit.has(o)) continue;
          const d = dist(u.x, u.y, o.x, o.y);
          if (d > reach + o.r) continue;
          const a = Math.atan2(o.y - u.y, o.x - u.x);
          let da = a - u.face;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) > s.arc / 2) continue;
          s.hit.add(o);
          this.damage(o, u.atk * (s.mul || 1), u, false, u.isPlayer);
        }
      }
      if (s.t >= s.dur) u.swing = null;
    });
  },

  shoot(u, ang) {
    const magic = !!u.magic;
    this.projs.push({
      x: u.x + Math.cos(ang) * (u.r + 6), y: u.y + Math.sin(ang) * (u.r + 6),
      vx: Math.cos(ang) * (magic ? 250 : 380), vy: Math.sin(ang) * (magic ? 250 : 380),
      r: magic ? 8 : 4, life: 2.4, owner: u, team: u.team, dmg: u.atk * 1.1, magic,
      color: magic ? '#c08cff' : '#e8dcb8',
    });
    Sfx.tone(magic ? 380 : 700, 0.06, 'triangle', 0.04, magic ? 200 : 1000);
  },

  updateProjs(dt) {
    this.projs = this.projs.filter((p) => {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || p.x < 0 || p.y < 0 || p.x > this.world.w || p.y > this.world.h) return false;
      for (const o of this.units) {
        if (!o.alive || o.team === p.team) continue;
        if (dist(p.x, p.y, o.x, o.y) < o.r + p.r) {
          this.damage(o, p.dmg, p.owner, p.magic, false);
          for (let i = 0; i < 6; i++) this.spark(p.x, p.y, p.color, 120, 0.35);
          return false;
        }
      }
      return true;
    });
  },

  /* ---------- ダメージ ---------- */
  damage(o, raw, from, magic, byPlayer) {
    if (!o.alive || o.inv > 0) return;
    const p = this.player;
    let dmg = raw;
    let crit = false;

    if (byPlayer && Math.random() < this.lo.crit) { dmg *= 1.8; crit = true; }

    if (o.isPlayer) {
      const armor = magic ? this.lo.res : this.lo.def;
      dmg = dmg * 250 / (250 + armor);
      dmg *= this.lo.voidHurt;
      if (o.dashT > 0 || o.inv > 0) dmg *= 0.35;
      if (o.guard) {
        const parry = o.guardT < 0.22;
        if (parry) {
          dmg = 0;
          Sfx.guard();
          this.floatText(o.x, o.y - 26, 'パリィ！', '#ffe9a8');
          if (from) { from.stun = 1.1; this.spark(from.x, from.y, '#fff2b0', 160, 0.5, 10); }
          p.rage = Math.min(100, p.rage + 18 * this.lo.rageMul);
        } else {
          dmg *= 0.28;
          Sfx.guard();
          o.sta = Math.max(0, o.sta - (this.lo.guardBreakImmune ? 4 : 12));
        }
      }
      if (dmg > 0) {
        if (this.lo.fireBack && from) {
          this.damage(from, this.lo.atk * 0.5, o, true, false);
          this.spark(from.x, from.y, '#ff9a4d', 140, 0.4, 8);
        }
        if (this.lo.thorn && from) this.damage(from, raw * 0.35, o, false, false);
        this.shake = Math.max(this.shake, 6);
      }
    } else {
      dmg = dmg * 100 / (100 + (o.def || 0));
      if (o.guard) dmg *= 0.45;
      if (byPlayer) {
        p.rage = Math.min(100, p.rage + dmg * 0.16 * this.lo.rageMul);
        if (this.lo.drain) this.heal(p, dmg * this.lo.drain);
      }
    }

    dmg = Math.max(1, Math.round(dmg));
    o.hp -= dmg;
    o.hurt = 0.18;
    if (o.isPlayer) {
      p.rage = Math.min(100, p.rage + dmg * 0.25 * this.lo.rageMul);
      o.stun = Math.max(o.stun, 0.12 * this.lo.stagger);
    }

    this.floatText(o.x, o.y - o.r - 6, (crit ? '会心 ' : '') + dmg,
      o.isPlayer ? '#ff9a9a' : crit ? '#ffe27a' : '#ffffff', crit);
    for (let i = 0; i < (crit ? 12 : 7); i++) this.spark(o.x, o.y, o.isPlayer ? '#ff8a8a' : '#ffd9a0', 150, 0.35);
    Sfx.hit();
    if (byPlayer) { this.hitStop = crit ? 0.07 : 0.035; this.shake = Math.max(this.shake, crit ? 10 : 5); }

    if (o.hp <= 0) this.kill(o, byPlayer);
  },

  heal(u, amt) {
    if (!u.alive) return;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amt);
    const d = Math.round(u.hp - before);
    if (d > 0) { this.floatText(u.x, u.y - u.r - 10, '+' + d, '#8fe38f'); }
  },

  kill(o, byPlayer) {
    o.alive = false;
    for (let i = 0; i < 18; i++) this.spark(o.x, o.y, o.color, 200, 0.6, 6);
    if (o.team === 'foe') {
      if (byPlayer || o.isCaptain) {
        this.gainValor = (this.gainValor || 0) + (o.valor || 5);
        this.kills = (this.kills || 0) + 1;
      } else {
        this.gainValor = (this.gainValor || 0) + Math.round((o.valor || 5) * 0.4);
        this.allyKills = (this.allyKills || 0) + 1;
      }
      if (o.isCaptain) {
        this.shake = 22;
        Sfx.ult();
        this.battleToast('指揮官を討ち取った！');
      }
    }
    if (o.isPlayer) { this.shake = 20; Sfx.lose(); }
  },

  /* ---------- 必殺技 ---------- */
  castUlt() {
    const p = this.player, type = this.lo.ult, U = ULTIMATES[type];
    Sfx.ult();
    this.shake = 16;
    this.battleToast(`${U.icon} ${U.name}！`);
    p.inv = 0.6;

    if (type === 'whirl') {
      this.fx.push({ type: 'ring', x: p.x, y: p.y, follow: p, t: 0, dur: 0.9, r: 30, r2: 130,
        dmg: p.atk * 2.4, hit: new Set(), color: '#dbe4ef', ticks: 3 });
    } else if (type === 'flurry') {
      const foes = this.units.filter((u) => u.team === 'foe' && u.alive)
        .sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y)).slice(0, 6);
      foes.forEach((f, i) => setTimeout(() => {
        if (!this.running || !f.alive) return;
        p.x = f.x - Math.cos(p.face) * 30; p.y = f.y - Math.sin(p.face) * 30;
        this.damage(f, p.atk * 1.9, p, false, true);
        this.fx.push({ type: 'slashline', x: f.x, y: f.y, t: 0, dur: 0.3, ang: rand(Math.PI * 2), color: '#8fe3ff' });
      }, i * 90));
      p.inv = 0.9;
    } else if (type === 'holy') {
      const foes = this.units.filter((u) => u.team === 'foe' && u.alive)
        .sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y)).slice(0, 4);
      foes.forEach((f) => this.fx.push({ type: 'pillar', x: f.x, y: f.y, t: 0, dur: 0.7, r: 52,
        dmg: p.atk * 2.6, magic: true, hit: new Set(), color: '#ffd76a' }));
      this.units.forEach((u) => { if (u.team === 'ally' && u.alive) this.heal(u, u.maxHp * 0.25); });
    } else if (type === 'quake') {
      this.fx.push({ type: 'wave', x: p.x, y: p.y, t: 0, dur: 0.85, r: 20, r2: 300,
        dmg: p.atk * 2.8, hit: new Set(), color: '#a8adc4', stun: 1.2 });
    } else if (type === 'flame') {
      this.fx.push({ type: 'cone', x: p.x, y: p.y, follow: p, ang: p.face, t: 0, dur: 1.3, r: 240,
        dmg: p.atk * 0.42, magic: true, hit: new Set(), color: '#ff7a4d', repeat: 0.14 });
    } else if (type === 'moon') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.fx.push({ type: 'blade', x: p.x, y: p.y, ang: a, t: 0, dur: 0.9, spd: 300,
          dmg: p.atk * 1.7, hit: new Set(), color: '#e2e8ff' });
      }
      this.heal(p, p.maxHp * 0.28);
    } else if (type === 'void') {
      this.fx.push({ type: 'burst', x: p.x, y: p.y, t: 0, dur: 0.75, r: 30, r2: 200,
        dmg: p.atk * 3.2, hit: new Set(), color: '#a56bff', drain: 0.35 });
    }
  },

  updateFx(dt) {
    const p = this.player;
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      if (f.follow) { f.x = f.follow.x; f.y = f.follow.y; }
      const prog = f.t / f.dur;

      if (f.type === 'ring' || f.type === 'wave' || f.type === 'burst') {
        const r = lerp(f.r, f.r2, easeOutQ(prog));
        this.units.forEach((u) => {
          if (u.team !== 'foe' || !u.alive || f.hit.has(u)) return;
          if (dist(u.x, u.y, f.x, f.y) < r + u.r) {
            f.hit.add(u);
            this.damage(u, f.dmg, p, false, true);
            if (f.stun) u.stun = f.stun;
            if (f.drain) this.heal(p, f.dmg * f.drain);
            const a = Math.atan2(u.y - f.y, u.x - f.x);
            u.x += Math.cos(a) * 40; u.y += Math.sin(a) * 40;
          }
        });
        if (f.type === 'ring' && f.ticks > 1 && prog > 0.5 && !f.re) { f.re = true; f.hit.clear(); }
      } else if (f.type === 'pillar') {
        if (prog > 0.25) {
          this.units.forEach((u) => {
            if (u.team !== 'foe' || !u.alive || f.hit.has(u)) return;
            if (dist(u.x, u.y, f.x, f.y) < f.r + u.r) { f.hit.add(u); this.damage(u, f.dmg, p, true, true); }
          });
        }
      } else if (f.type === 'cone') {
        f.acc = (f.acc || 0) + dt;
        if (f.acc >= f.repeat) {
          f.acc = 0;
          this.units.forEach((u) => {
            if (u.team !== 'foe' || !u.alive) return;
            const d = dist(u.x, u.y, f.x, f.y);
            if (d > f.r) return;
            let da = Math.atan2(u.y - f.y, u.x - f.x) - f.ang;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            if (Math.abs(da) < 0.55) this.damage(u, f.dmg, p, true, false);
          });
        }
        for (let i = 0; i < 3; i++) {
          const a = f.ang + rand(0.5, -0.5);
          const d = rand(f.r);
          this.parts.push({ x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d,
            vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 20, life: 0.4, max: 0.4, r: rand(9, 3), color: pick(['#ff7a4d', '#ffb84d', '#ff4d2d']) });
        }
      } else if (f.type === 'blade') {
        f.x += Math.cos(f.ang) * f.spd * dt;
        f.y += Math.sin(f.ang) * f.spd * dt;
        this.units.forEach((u) => {
          if (u.team !== 'foe' || !u.alive || f.hit.has(u)) return;
          if (dist(u.x, u.y, f.x, f.y) < 22 + u.r) { f.hit.add(u); this.damage(u, f.dmg, p, false, true); }
        });
      }
      return f.t < f.dur;
    });
  },

  spark(x, y, color, spd, life, r) {
    const a = rand(Math.PI * 2);
    const s = rand(spd, spd * 0.3);
    this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, r: r || rand(4, 1.5), color });
  },
  updateParts(dt) {
    this.parts = this.parts.filter((p) => {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life -= dt;
      return p.life > 0;
    });
    this.texts = this.texts.filter((t) => { t.t += dt; t.y -= 34 * dt; return t.t < 0.9; });
  },
  floatText(x, y, txt, color, big) { this.texts.push({ x, y, txt, color, t: 0, big }); },
  battleToast(msg) {
    const el = $('battle-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => el.classList.remove('show'), 1400);
  },

  /* ---------- 決着 ---------- */
  finish(win) {
    this.result = {
      win,
      mode: this.mode,
      regionId: this.regionId,
      valor: Math.round(this.gainValor || 0),
      kills: this.kills || 0,
      allyKills: this.allyKills || 0,
      hpLeft: Math.max(0, Math.round(this.player.hp)),
      maxHp: this.player.maxHp,
      alliesLost: this.units.filter((u) => u.team === 'ally' && !u.isPlayer && !u.alive).length,
      alliesTotal: this.units.filter((u) => u.team === 'ally' && !u.isPlayer).length,
    };
    if (win) Sfx.win(); else Sfx.lose();
    this.battleToast(win ? '勝　利' : '敗　走');
  },

  /* ---------- HUD ---------- */
  refreshHud() {
    const p = this.player;
    $('bh-hp').style.width = clamp(p.hp / p.maxHp, 0, 1) * 100 + '%';
    $('bh-hp-txt').textContent = `${Math.max(0, Math.round(p.hp))} / ${p.maxHp}`;
    $('bh-rage').style.width = clamp(p.rage / 100, 0, 1) * 100 + '%';
    $('bh-sta').style.width = clamp(p.sta / 100, 0, 1) * 100 + '%';
    const c = this.captain;
    $('bh-cap-hp').style.width = clamp(c.hp / c.maxHp, 0, 1) * 100 + '%';
    $('bh-cap-hp-txt').textContent = c.alive ? `${Math.max(0, Math.round(c.hp))}` : '討ち取った';
    const ally = this.units.filter((u) => u.team === 'ally' && u.alive).length;
    const foe = this.units.filter((u) => u.team === 'foe' && u.alive).length;
    $('bh-ally').textContent = `味方 ${ally}`;
    $('bh-foe').textContent = `敵 ${foe}`;
    $('ult-ready').classList.toggle('hidden', p.rage < 100 || !p.alive);
  },

  /* ---------- 描画 ---------- */
  draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);

    const sx = this.shake ? rand(this.shake, -this.shake) : 0;
    const sy = this.shake ? rand(this.shake, -this.shake) : 0;
    c.save();
    c.translate(-this.cam.x + sx, -this.cam.y + sy);

    this.drawGround(c);

    // 影
    this.units.forEach((u) => {
      if (!u.alive) return;
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath(); c.ellipse(u.x, u.y + u.r * 0.8, u.r * 0.9, u.r * 0.35, 0, 0, Math.PI * 2); c.fill();
    });

    // 倒れた兵
    this.units.forEach((u) => { if (!u.alive) this.drawCorpse(c, u); });

    // エフェクト（下敷き）
    this.fx.forEach((f) => this.drawFx(c, f, false));

    // ユニット
    const order = this.units.filter((u) => u.alive).sort((a, b) => a.y - b.y);
    order.forEach((u) => this.drawUnit(c, u));

    // 弾
    this.projs.forEach((p) => {
      c.save();
      c.fillStyle = p.color;
      c.shadowColor = p.color; c.shadowBlur = p.magic ? 14 : 6;
      if (p.magic) { c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); }
      else {
        c.translate(p.x, p.y); c.rotate(Math.atan2(p.vy, p.vx));
        c.fillRect(-9, -1.5, 18, 3);
      }
      c.restore();
    });

    // エフェクト（上）
    this.fx.forEach((f) => this.drawFx(c, f, true));

    // 粒子
    this.parts.forEach((p) => {
      c.globalAlpha = clamp(p.life / p.max, 0, 1);
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    });
    c.globalAlpha = 1;

    // ダメージ数字
    this.texts.forEach((t) => {
      c.globalAlpha = clamp(1 - t.t / 0.9, 0, 1);
      c.font = `bold ${t.big ? 22 : 16}px system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.strokeText(t.txt, t.x, t.y); c.fillStyle = t.color; c.fillText(t.txt, t.x, t.y);
    });
    c.globalAlpha = 1;
    c.restore();

    // 決着の暗転
    if (this.result) {
      c.fillStyle = `rgba(0,0,0,${clamp(this.over / 1.6, 0, 0.6)})`;
      c.fillRect(0, 0, this.w, this.h);
      c.font = 'bold 46px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = this.result.win ? '#ffe9a8' : '#ff9a9a';
      c.globalAlpha = clamp(this.over, 0, 1);
      c.fillText(this.result.win ? '勝　利' : '敗　走', this.w / 2, this.h / 2);
      c.globalAlpha = 1;
    }
  },

  /** 地面は開戦時に1枚だけ描いて使い回す */
  buildGround() {
    const P = {
      plain: { base: '#455e37', dark: '#3a5030', light: '#547040', detail: 'grass' },
      hill:  { base: '#5c5636', dark: '#4e4930', light: '#6d6642', detail: 'rock' },
      wood:  { base: '#2e4629', dark: '#263c23', light: '#385433', detail: 'tree' },
      rock:  { base: '#4b4b53', dark: '#414149', light: '#5a5a63', detail: 'rock' },
      water: { base: '#3a5a68', dark: '#31505d', light: '#456e7d', detail: 'reed' },
    }[this.ground] || { base: '#455e37', dark: '#3a5030', light: '#547040', detail: 'grass' };

    const W = this.world.w, H = this.world.h;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const rng = mulberry32(1234 + this.ground.length * 97);

    c.fillStyle = P.base; c.fillRect(0, 0, W, H);

    // やわらかい色むら
    for (let i = 0; i < 150; i++) {
      const x = rng() * W, y = rng() * H, r = 40 + rng() * 130;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const col = rng() > 0.5 ? P.light : P.dark;
      g.addColorStop(0, rgba(col, 0.20)); g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }

    // 細かい地面の要素
    const n = P.detail === 'tree' ? 150 : 420;
    for (let i = 0; i < n; i++) {
      const x = 20 + rng() * (W - 40), y = 20 + rng() * (H - 40);
      if (P.detail === 'grass' || P.detail === 'reed') {
        c.strokeStyle = rgba(P.light, 0.5 + rng() * 0.3);
        c.lineWidth = 1.4; c.lineCap = 'round';
        const h = P.detail === 'reed' ? 9 + rng() * 8 : 5 + rng() * 5;
        for (let k = -1; k <= 1; k++) {
          c.beginPath(); c.moveTo(x + k * 3, y);
          c.lineTo(x + k * 3 + (rng() - 0.5) * 4, y - h); c.stroke();
        }
      } else if (P.detail === 'rock') {
        c.fillStyle = rgba(rng() > 0.5 ? P.light : P.dark, 0.55);
        c.beginPath();
        c.ellipse(x, y, 3 + rng() * 7, 2 + rng() * 4, rng() * 3, 0, Math.PI * 2);
        c.fill();
      } else {
        // 木
        const r = 12 + rng() * 12;
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.beginPath(); c.ellipse(x + 3, y + r * 0.5, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = P.dark;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = rgba(P.light, 0.75);
        c.beginPath(); c.arc(x - r * 0.25, y - r * 0.3, r * 0.55, 0, Math.PI * 2); c.fill();
      }
    }

    // 戦場の縁
    c.strokeStyle = 'rgba(18,12,7,0.6)'; c.lineWidth = 10;
    c.strokeRect(5, 5, W - 10, H - 10);
    const vg = c.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0.22)'); vg.addColorStop(0.25, 'rgba(0,0,0,0)');
    vg.addColorStop(0.75, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.22)');
    c.fillStyle = vg; c.fillRect(0, 0, W, H);

    this.groundCv = cv;
  },

  drawGround(c) {
    if (!this.groundCv) this.buildGround();
    c.drawImage(this.groundCv, 0, 0);
  },

  drawUnit(c, u) {
    const hurt = u.hurt > 0;
    c.save();
    c.translate(u.x, u.y);

    // 振り
    if (u.swing) {
      const prog = clamp(u.swing.t / u.swing.dur, 0, 1);
      const a0 = u.face - u.swing.arc / 2, a1 = u.face + u.swing.arc / 2;
      const a = lerp(a0, a1, easeOutQ(prog));
      const reach = u.reach + u.r;
      c.save();
      c.globalAlpha = 0.45 * (1 - prog * 0.5);
      c.strokeStyle = u.isPlayer ? '#ffeeb0' : 'rgba(255,255,255,0.7)';
      c.lineWidth = u.swing.big ? 14 : 9;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(0, 0, reach * 0.82, a0, a);
      c.stroke();
      c.restore();
      // 刃
      c.save();
      c.rotate(a);
      c.fillStyle = u.isPlayer ? '#e8eef6' : '#c8ccd4';
      c.fillRect(u.r * 0.6, -2.5, reach * 0.75, 5);
      c.restore();
    } else if (u.kind !== 'caster') {
      // 構えた武器
      c.save();
      c.rotate(u.face + (u.kind === 'ranged' ? -0.9 : 0.55));
      c.strokeStyle = u.isPlayer ? '#dfe7f0' : 'rgba(214,220,230,.7)';
      c.lineWidth = u.isPlayer ? 3.5 : 2.5; c.lineCap = 'round';
      const wl = u.kind === 'ranged' ? 15 : Math.min(34, (u.reach + u.r) * 0.5);
      c.beginPath();
      c.moveTo(u.r * 0.4, 0);
      c.lineTo(u.r * 0.4 + wl, 0);
      c.stroke();
      c.restore();
    }

    // 体
    const bodyC = hurt ? '#ffffff' : u.color;
    c.fillStyle = bodyC;
    c.strokeStyle = u.edge || shade(u.color, -0.4);
    c.lineWidth = 2.5;
    c.beginPath(); c.arc(0, 0, u.r, 0, Math.PI * 2); c.fill(); c.stroke();

    // 胸当てのライン
    c.save();
    c.rotate(u.face);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); c.arc(0, 0, u.r * 0.72, -0.9, 0.9); c.fill();
    // 顔向き
    c.fillStyle = 'rgba(20,16,12,0.8)';
    c.beginPath(); c.arc(u.r * 0.55, 0, u.r * 0.22, 0, Math.PI * 2); c.fill();
    c.restore();

    // ガード
    if (u.guard) {
      c.save();
      c.rotate(u.face);
      c.fillStyle = u.isPlayer ? 'rgba(160,210,255,0.85)' : 'rgba(200,200,210,0.8)';
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2;
      c.beginPath();
      c.ellipse(u.r * 0.9, 0, u.r * 0.42, u.r * 1.05, 0, 0, Math.PI * 2);
      c.fill(); c.stroke();
      c.restore();
    }

    // プレイヤーの縁取り
    if (u.isPlayer) {
      c.strokeStyle = 'rgba(255,233,168,0.9)'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, u.r + 4, 0, Math.PI * 2); c.stroke();
      if (u.dashT > 0) {
        c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3;
        c.beginPath(); c.arc(0, 0, u.r + 9, 0, Math.PI * 2); c.stroke();
      }
    }
    if (u.isCaptain) {
      c.font = '15px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('👑', 0, -u.r - 12);
    }
    if (u.stun > 0) {
      c.font = '13px system-ui'; c.textAlign = 'center';
      c.fillText('💫', 0, -u.r - 22);
    }
    c.restore();

    // HPバー
    if (u.isPlayer || u.isCaptain || u.hp < u.maxHp) {
      const w = u.isCaptain ? 56 : 30, h = 4;
      const x = u.x - w / 2, y = u.y - u.r - 11;
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x - 1, y - 1, w + 2, h + 2);
      c.fillStyle = u.team === 'ally' ? '#6ce07a' : '#e06a6a';
      c.fillRect(x, y, w * clamp(u.hp / u.maxHp, 0, 1), h);
    }
    if (u.isPlayer || u.isCaptain) {
      c.font = 'bold 11px system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.7)';
      c.strokeText(u.name, u.x, u.y - u.r - 15);
      c.fillStyle = u.isPlayer ? '#bfe4ff' : '#ffc9a0';
      c.fillText(u.name, u.x, u.y - u.r - 15);
    }
  },

  drawCorpse(c, u) {
    c.save();
    c.globalAlpha = 0.35;
    c.fillStyle = shade(u.color, -0.35);
    c.beginPath(); c.ellipse(u.x, u.y + 4, u.r * 1.1, u.r * 0.5, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  },

  drawFx(c, f, top) {
    const prog = clamp(f.t / f.dur, 0, 1);
    if (f.type === 'ring' || f.type === 'wave' || f.type === 'burst') {
      if (top) return;
      const r = lerp(f.r, f.r2, easeOutQ(prog));
      c.save();
      c.globalAlpha = (1 - prog) * 0.85;
      c.strokeStyle = f.color; c.lineWidth = f.type === 'burst' ? 18 : 10;
      c.beginPath(); c.arc(f.x, f.y, r, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = (1 - prog) * 0.25;
      c.fillStyle = f.color;
      c.beginPath(); c.arc(f.x, f.y, r, 0, Math.PI * 2); c.fill();
      c.restore();
    } else if (f.type === 'pillar') {
      if (!top) return;
      c.save();
      c.globalAlpha = Math.sin(prog * Math.PI) * 0.9;
      const g = c.createLinearGradient(f.x, f.y - 300, f.x, f.y + 20);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.6, f.color);
      g.addColorStop(1, '#ffffff');
      c.fillStyle = g;
      c.fillRect(f.x - f.r, f.y - 300, f.r * 2, 320);
      c.globalAlpha = Math.sin(prog * Math.PI) * 0.5;
      c.fillStyle = f.color;
      c.beginPath(); c.ellipse(f.x, f.y + 8, f.r * 1.3, f.r * 0.5, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    } else if (f.type === 'cone') {
      if (top) return;
      c.save();
      c.globalAlpha = Math.sin(prog * Math.PI) * 0.55;
      const g = c.createRadialGradient(f.x, f.y, 10, f.x, f.y, f.r);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, f.color); g.addColorStop(1, 'rgba(255,60,20,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(f.x, f.y);
      c.arc(f.x, f.y, f.r, f.ang - 0.55, f.ang + 0.55); c.closePath(); c.fill();
      c.restore();
    } else if (f.type === 'blade') {
      if (top) return;
      c.save();
      c.translate(f.x, f.y); c.rotate(f.ang);
      c.globalAlpha = (1 - prog) * 0.95;
      c.strokeStyle = f.color; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.arc(0, 0, 20, -1.1, 1.1); c.stroke();
      c.restore();
    } else if (f.type === 'slashline') {
      if (!top) return;
      c.save();
      c.translate(f.x, f.y); c.rotate(f.ang);
      c.globalAlpha = 1 - prog;
      c.strokeStyle = f.color; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-40, 0); c.lineTo(40, 0); c.stroke();
      c.restore();
    }
  },
};

function easeOutQ(t) { return 1 - Math.pow(1 - t, 3); }
function isTouch() { return window.matchMedia('(hover: none)').matches || 'ontouchstart' in window; }
