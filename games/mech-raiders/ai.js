/* =========================================================================
   MECH RAIDERS ― 敵AI / ボス / 必殺技 / 目標判定
   Field.prototype に足す。
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData, F = window.MRField, B = window.MRBattle;
const { TAU, clamp, lerp, dist, dist2, angTo, angDiff, angApproach, deg,
        rnd, rndi, pick } = C;
const { Enemy, Boss, wallsNear, pointBlocked, hasLOS, collideWalls } = F;
const Field = B.Field;

/* ============================ 共通の移動 ============================ */
/* 進みたい向きに壁があれば、左右に振って通れる向きを探す */
function steer(field, e, desired, speed, dt) {
  const probe = e.r + 30 + speed * 0.16;
  const offs = [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, 2.6, -2.6];
  let chosen = desired;
  for (const o of offs) {
    const a = desired + o;
    const px = e.x + Math.cos(a) * probe, py = e.y + Math.sin(a) * probe;
    if (!pointBlocked(field.world, px, py, e.flying ? 6 : e.r * 0.7)) { chosen = a; break; }
  }
  e.moveDir = chosen;
  e.vx = lerp(e.vx, Math.cos(chosen) * speed, 1 - Math.pow(0.004, dt));
  e.vy = lerp(e.vy, Math.sin(chosen) * speed, 1 - Math.pow(0.004, dt));
  e.walkPhase += dt * Math.hypot(e.vx, e.vy) * 0.055;
}

function nearestPlayer(field, e) {
  let best = null, bd = Infinity;
  for (const p of field.players) {
    if (p.dead) continue;
    let d = dist2(e.x, e.y, p.x, p.y);
    if (p.down) d *= 4;                                 // 倒れている相手は狙いにくい
    if (p.has && p.has('optic_camo') && p.noHitT > 3) d *= 2.2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/* ============================ 敵の更新 ============================ */
Object.assign(Field.prototype, {

updateEnemy(e, dt) {
  e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
  e.stun = Math.max(0, e.stun - dt);
  e.knockT = Math.max(0, (e.knockT || 0) - dt);
  if (e.burn > 0) {
    e.burnT -= dt;
    if (e.burnT <= 0) e.burn = 0;
    else {
      e.hp -= e.burn * dt;
      if (Math.random() < dt * 6) this.parts.add({ x: e.x + rnd(-8, 8), y: e.y + rnd(-8, 8), vx: 0, vy: -30, life: 0.4, max: 0.4, color: '#ff8a3c', size: 3, drag: 1, kind: 'spark' });
      if (e.hp <= 0) { this.killFoe(e, this.players[0]); return; }
    }
  }

  const target = nearestPlayer(this, e);
  e.target = target;

  /* ---- 知覚 ---- */
  if (target) {
    const d = dist(e.x, e.y, target.x, target.y);
    const seeAng = Math.abs(angDiff(e.ang, angTo(e.x, e.y, target.x, target.y)));
    const camo = target.has('optic_camo') && target.noHitT > 3;
    const sight = e.def.sight * (camo ? 0.45 : 1);
    const canSee = d < sight && (seeAng < deg(78) || d < 190) && hasLOS(this.world, e.x, e.y, target.x, target.y, false);
    const heard = d < e.def.hearing && target.muzzle > 0.3;
    if (canSee || heard) {
      if (e.state === 'patrol' || e.state === 'search') {
        if (e.state === 'patrol') { this.audio.sfx('alert'); this.ft.add(e.x, e.y - e.r - 12, '！', '#ff6a6a', 15, 0.9); }
        this.alertNear(e, 420);
      }
      e.state = 'engage';
      e.lastKnown = { x: target.x, y: target.y };
      e.lostT = 0;
      e.canSee = canSee;
    } else if (e.state === 'engage') {
      e.canSee = false;
      e.lostT = (e.lostT || 0) + dt;
      if (e.lostT > 2.6) { e.state = 'search'; e.searchT = 6; }
    }
  }

  if (e.stun > 0) { e.vx *= 0.9; e.vy *= 0.9; e.x += e.vx * dt; e.y += e.vy * dt; collideWalls(this.world, e); return; }
  if (e.knockT > 0) { e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.9; e.vy *= 0.9; collideWalls(this.world, e); return; }

  switch (e.state) {
    case 'patrol': this.aiPatrol(e, dt); break;
    case 'search': this.aiSearch(e, dt); break;
    default: this.aiEngage(e, target, dt); break;
  }

  e.x += e.vx * dt; e.y += e.vy * dt;
  collideWalls(this.world, e);
},

alertNear(e, radius) {
  for (const o of this.enemies) {
    if (o.dead || o === e) continue;
    if (dist2(o.x, o.y, e.x, e.y) > radius * radius) continue;
    if (o.state === 'engage') continue;
    o.state = 'search'; o.searchT = 7;
    o.lastKnown = e.lastKnown ? { x: e.lastKnown.x, y: e.lastKnown.y } : { x: e.x, y: e.y };
  }
},

aiPatrol(e, dt) {
  e.wpT -= dt;
  if (!e.wp || e.wpT <= 0 || dist2(e.x, e.y, e.wp.x, e.wp.y) < 60 * 60) {
    const a = rnd(TAU), r = rnd(160, 420);
    const nx = clamp(e.x + Math.cos(a) * r, 70, this.world.w - 70);
    const ny = clamp(e.y + Math.sin(a) * r, 70, this.world.h - 70);
    e.wp = { x: nx, y: ny }; e.wpT = rnd(3, 6);
  }
  const a = angTo(e.x, e.y, e.wp.x, e.wp.y);
  steer(this, e, a, e.speed * 0.42, dt);
  e.ang = angApproach(e.ang, e.moveDir, dt * 3.2);
  e.aim = e.ang;
},

aiSearch(e, dt) {
  e.searchT -= dt;
  if (e.searchT <= 0 || !e.lastKnown) { e.state = 'patrol'; e.wp = null; return; }
  const d = dist(e.x, e.y, e.lastKnown.x, e.lastKnown.y);
  if (d > 60) {
    const a = angTo(e.x, e.y, e.lastKnown.x, e.lastKnown.y);
    steer(this, e, a, e.speed * 0.8, dt);
    e.ang = angApproach(e.ang, e.moveDir, dt * 5);
  } else {
    e.vx *= 0.9; e.vy *= 0.9;
    e.ang += dt * 1.6;                    // その場で見回す
  }
  e.aim = e.ang;
},

aiEngage(e, t, dt) {
  if (!t) { e.state = 'patrol'; return; }
  const d = dist(e.x, e.y, t.x, t.y);
  const toT = angTo(e.x, e.y, t.x, t.y);
  const def = e.def;
  e.aim = angApproach(e.aim, toT, dt * 5.5);
  e.strafeT -= dt;
  if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rnd(1.1, 2.6); }

  const goTo = (targetDist, spdMul, strafeMul) => {
    let a;
    if (d > targetDist + 40) a = toT;
    else if (d < targetDist - 40) a = toT + Math.PI;
    else a = toT + (Math.PI / 2) * e.strafe;
    if (strafeMul && d <= targetDist + 60 && d >= targetDist - 60) a = toT + (Math.PI / 2) * e.strafe * strafeMul;
    steer(this, e, a, e.speed * (spdMul || 1), dt);
    e.ang = angApproach(e.ang, e.moveDir, dt * 5);
  };

  switch (def.ai) {
    case 'rusher': {
      goTo(def.atkRange * 0.6, 1.0, 1);
      e.ang = angApproach(e.ang, toT, dt * 6);
      if (d < def.atkRange && e.canSee) this.enemyShoot(e, t, dt);
      break;
    }
    case 'strafer': {
      goTo(def.keep || def.atkRange * 0.7, 0.82, 1);
      e.ang = angApproach(e.ang, toT, dt * 5);
      if (d < def.atkRange && e.canSee) this.enemyShoot(e, t, dt);
      break;
    }
    case 'advance': {
      const a = d > def.atkRange * 0.8 ? toT : toT + (Math.PI / 2) * e.strafe * 0.4;
      steer(this, e, a, e.speed * 0.85, dt);
      e.ang = angApproach(e.ang, toT, dt * 3.4);       // 盾は常に正面
      if (d < def.atkRange && e.canSee) this.enemyShoot(e, t, dt);
      break;
    }
    case 'artillery': {
      goTo(def.keep, 0.7, 0.5);
      e.ang = angApproach(e.ang, toT, dt * 3);
      e.fireT -= dt;
      if (e.fireT <= 0 && d < def.atkRange) {
        e.fireT = 60 / def.lob.rpm;
        this.dropMarker(t.x + rnd(-40, 40), t.y + rnd(-40, 40), def.lob.splash, def.lob.dmg * e.dmgMul, def.lob.el, 'foe', def.lob.flight);
        this.parts.dirSpark(e.x + Math.cos(e.aim) * 22, e.y + Math.sin(e.aim) * 22, e.aim, 6, '#ffc46b', 200, 0.8, 0.3, 3);
        this.audio.sfx('shotBig');
      }
      break;
    }
    case 'swarm': {
      /* 周囲を回りながら寄る */
      const orbit = 140;
      const a = d > orbit + 40 ? toT + 0.6 * e.strafe : toT + (Math.PI / 2) * e.strafe;
      steer(this, e, a, e.speed * 0.9, dt);
      e.ang = angApproach(e.ang, toT, dt * 8);
      if (d < def.atkRange && e.canSee) this.enemyShoot(e, t, dt);
      break;
    }
    case 'sniper': {
      goTo(def.keep, 0.6, 0.3);
      e.ang = angApproach(e.ang, toT, dt * 2.4);
      if (e.canSee && d < def.atkRange) {
        e.chargeT += dt;
        e.laserAim = toT;
        if (e.chargeT >= def.laser.charge) {
          e.chargeT = -0.9;
          const hit = this.rayHit(e.x, e.y, toT, def.atkRange, 'foe', 1);
          this.beams.push({ x1: e.x, y1: e.y, x2: hit.x, y2: hit.y, w: 6, color: '#ff5a6a', flash: true });
          for (const p of hit.targets) this.hurtPlayer(p, def.laser.dmg * e.dmgMul, def.laser.el, e);
          this.cam.addShake(5);
          this.audio.sfx('shotBig');
        }
      } else e.chargeT = Math.max(0, e.chargeT - dt * 2);
      break;
    }
    case 'mender': {
      /* 傷ついた味方を探して回復。いなければ距離を取って撃つ */
      let ally = null, ad = Infinity;
      for (const o of this.enemies) {
        if (o.dead || o === e || o.hp >= o.maxHp * 0.92) continue;
        const dd = dist2(e.x, e.y, o.x, o.y);
        if (dd < ad) { ad = dd; ally = o; }
      }
      if (ally) {
        const aa = angTo(e.x, e.y, ally.x, ally.y);
        const ad2 = Math.sqrt(ad);
        steer(this, e, ad2 > def.heal.range * 0.7 ? aa : aa + Math.PI, e.speed * 0.9, dt);
        e.ang = angApproach(e.ang, aa, dt * 5);
        if (ad2 < def.heal.range) {
          e.healT = (e.healT || 0) + dt;
          this.beams.push({ x1: e.x, y1: e.y, x2: ally.x, y2: ally.y, w: 2, color: '#8dffb0', zig: true });
          if (e.healT >= def.heal.rate) {
            e.healT = 0;
            ally.hp = Math.min(ally.maxHp, ally.hp + def.heal.amount * e.dmgMul);
            this.ft.add(ally.x, ally.y - ally.r - 8, `+${Math.round(def.heal.amount * e.dmgMul)}`, '#8dffb0', 12, 0.7);
          }
        }
      } else {
        goTo(300, 0.85, 1);
        if (d < def.atkRange && e.canSee) this.enemyShoot(e, t, dt);
      }
      break;
    }
    case 'bomber': {
      steer(this, e, toT, e.speed * (d < 260 ? 1.25 : 1.0), dt);
      e.ang = angApproach(e.ang, toT, dt * 7);
      if (d < 130) e.fuse = e.fuse < 0 ? 1.1 : e.fuse - dt;
      if (e.fuse >= 0) {
        e.fuse -= dt;
        if (Math.random() < dt * 20) this.parts.spark(e.x, e.y, 1, '#ff5a4a', 90, 0.3, 2);
        if (e.fuse <= 0 || d < def.atkRange) {
          this.explode(e.x, e.y, def.boom.splash, def.boom.dmg * e.dmgMul, def.boom.el, 'foe', e);
          e.hp = 0; this.killFoe(e, null);
        }
      }
      break;
    }
    default: goTo(280, 0.85, 1); break;
  }
},

enemyShoot(e, t, dt) {
  const s = e.def.dps;
  if (!s) return;
  e.fireT -= dt;
  if (s.burst) {
    if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) { e.burstLeft--; e.burstT = 0.09; this.enemyBullet(e, t, s); }
      return;
    }
    if (e.fireT <= 0) { e.fireT = 60 / s.rpm * s.burst + rnd(0.3, 0.9); e.burstLeft = s.burst; e.burstT = 0; }
    return;
  }
  if (e.fireT <= 0) { e.fireT = 60 / s.rpm; this.enemyBullet(e, t, s); }
},

enemyBullet(e, t, s) {
  const n = s.pellets || 1;
  const base = angTo(e.x, e.y, t.x, t.y) + rnd(-deg(1.5), deg(1.5));
  for (let i = 0; i < n; i++) {
    const a = base + rnd(-deg(s.spread || 3), deg(s.spread || 3));
    this.spawnBullet({
      x: e.x + Math.cos(base) * (e.r + 6), y: e.y + Math.sin(base) * (e.r + 6),
      ang: a, speed: s.bspeed || 520, dmg: s.dmg * e.dmgMul, el: s.el, team: 'foe',
      owner: e, size: 3.2, range: (e.def.atkRange || 400) * 1.25, color: D.ELEMENTS[s.el].color,
      stun: s.stun || 0,
    });
  }
  this.parts.dirSpark(e.x + Math.cos(base) * (e.r + 6), e.y + Math.sin(base) * (e.r + 6), base, 3, '#ffd9a0', 180, 0.4, 0.14, 2);
  this.audio.sfx('shot');
},

/* ============================ 着弾マーカー（砲撃） ============================ */
dropMarker(x, y, r, dmg, el, team, delay, owner) {
  this.markers.push({ x, y, r, dmg, el, team, t: delay || 1.2, max: delay || 1.2, owner: owner || null });
},
updateMarkers(dt) {
  for (let i = this.markers.length - 1; i >= 0; i--) {
    const m = this.markers[i];
    m.t -= dt;
    if (m.t <= 0) {
      this.explode(m.x, m.y, m.r, m.dmg, m.el, m.team, m.owner);
      this.markers.splice(i, 1);
    }
  }
},

/* ============================ 継続効果（炎・EMP） ============================ */
addHazard(h) { this.hazards.push(Object.assign({ t: h.life, max: h.life, tick: 0 }, h)); },
updateHazards(dt) {
  for (let i = this.hazards.length - 1; i >= 0; i--) {
    const h = this.hazards[i];
    h.t -= dt;
    if (h.t <= 0) { this.hazards.splice(i, 1); continue; }
    h.tick += dt;
    if (Math.random() < dt * (h.kind === 'fire' ? 26 : 12)) {
      const a = rnd(TAU), rr = Math.sqrt(Math.random()) * h.r;
      this.parts.add({ x: h.x + Math.cos(a) * rr, y: h.y + Math.sin(a) * rr, vx: rnd(-10, 10), vy: rnd(-50, -18),
        life: 0.6, max: 0.6, color: h.kind === 'fire' ? pick(['#ffd166', '#ff8a3c']) : '#c58cff', size: rnd(4, 9), grow: 12, kind: 'smoke' });
    }
    if (h.tick >= 0.25) {
      h.tick = 0;
      const foes = h.team === 'ally' ? this.allFoes() : this.players;
      for (const t of foes) {
        if (!t || t.dead || (h.team === 'foe' && t.down)) continue;
        if (dist(h.x, h.y, t.x, t.y) > h.r + t.r) continue;
        this.applyDamage(t, h.dps * 0.25, h.el, h.owner, { text: Math.random() < 0.3 });
        if (h.slow) t.slow = 0.5;
        if (h.burn) { t.burn = Math.max(t.burn || 0, h.burn); t.burnT = 1.6; }
      }
    }
  }
},

/* ============================ 分身 ============================ */
updatePhantoms(dt) {
  for (let i = this.phantoms.length - 1; i >= 0; i--) {
    const ph = this.phantoms[i];
    ph.t -= dt;
    if (ph.t <= 0 || ph.owner.dead) {
      this.parts.spark(ph.x, ph.y, 12, '#5fffe0', 200, 0.5, 3);
      this.phantoms.splice(i, 1); continue;
    }
    const o = ph.owner;
    const tx = o.x + Math.cos(ph.off) * 62, ty = o.y + Math.sin(ph.off) * 62;
    ph.off += dt * 1.1;
    ph.x = lerp(ph.x, tx, 1 - Math.pow(0.001, dt));
    ph.y = lerp(ph.y, ty, 1 - Math.pow(0.001, dt));
    ph.walkPhase = o.walkPhase;
    let tgt = o.lock && !o.lock.dead ? o.lock : null;
    if (!tgt) { let bd = Infinity; for (const e of this.allFoes()) { const d = dist2(ph.x, ph.y, e.x, e.y); if (d < bd) { bd = d; tgt = e; } } }
    if (!tgt) { ph.ang = o.aim; continue; }
    ph.ang = angApproach(ph.ang, angTo(ph.x, ph.y, tgt.x, tgt.y), dt * 8);
    ph.cool -= dt;
    const w = o.weapon;
    if (ph.cool <= 0 && w && w.kind !== 'melee') {
      ph.cool = Math.max(0.08, 60 / w.rpm);
      this.spawnBullet({
        x: ph.x + Math.cos(ph.ang) * 20, y: ph.y + Math.sin(ph.ang) * 20, ang: ph.ang + rnd(-0.05, 0.05),
        speed: w.bspeed || 600, dmg: w.dmg * 0.6, el: w.el, team: 'ally', owner: o,
        size: w.bsize || 3, range: w.range || 500, splash: (w.splash || 0) * 0.6,
        color: '#5fffe0',
      });
      this.parts.dirSpark(ph.x, ph.y, ph.ang, 2, '#5fffe0', 160, 0.4, 0.14, 2);
    }
  }
},

/* ============================ 必殺技 ============================ */
startSpecial(m) {
  m.sp = 0;
  m.specialState = m.lo.special;
  m.specialT = 0;
  this.audio.sfx('special');
  this.cam.addShake(9);
  this.parts.ring(m.x, m.y, m.lo.frame.accent, 14, 190, 0.55, 7);
  this.ft.add(m.x, m.y - 52, D.SPECIALS[m.lo.special].name, m.lo.frame.accent, 18, 1.6);
  this.slowmo = 0.28;

  switch (m.specialState) {
    case 'shield_burst': m.shieldT = 3.2; break;
    case 'blade_rush': m.rushStep = 0; m.iframe = 2.2; break;
    case 'inferno_field':
      this.addHazard({ kind: 'fire', x: m.x, y: m.y, r: 160, dps: 46, el: 'THR', team: 'ally', owner: m, life: 7, burn: 8 });
      break;
    case 'emp_nova': m.novaR = 0; break;
    case 'phantom':
      for (let i = 0; i < 2; i++) this.phantoms.push({ owner: m, x: m.x, y: m.y, ang: m.aim, off: i * Math.PI, t: 7, cool: 0, walkPhase: 0 });
      break;
    case 'orbital': {
      const cx = m.aimX, cy = m.aimY;
      for (let i = 0; i < 9; i++) {
        const a = rnd(TAU), r = Math.sqrt(Math.random()) * 150;
        this.dropMarker(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 92, 96, 'ENE', 'ally', 0.6 + i * 0.11, m);
      }
      break;
    }
    case 'full_salvo': {
      for (let i = 0; i < 18; i++) {
        const a = m.aim + rnd(-1.1, 1.1);
        const tgt = m.lock && !m.lock.dead ? m.lock : null;
        this.spawnBullet({ x: m.x, y: m.y, ang: a, speed: 260, dmg: 30, el: 'KIN', team: 'ally', owner: m,
          size: 4, range: 900, splash: 58, homing: tgt, turn: 4.2, color: '#ffd166' });
      }
      break;
    }
    default: break;
  }
},

runSpecial(m, dt) {
  m.specialT += dt;
  const t = m.specialT;
  switch (m.specialState) {
    case 'burst_cannon': {
      m.blockFire = true;
      const step = Math.floor(t / 0.16);
      if (step > (m.lastStep || -1) && step < 3) {
        m.lastStep = step;
        this.spawnBullet({ x: m.x + Math.cos(m.aim) * 24, y: m.y + Math.sin(m.aim) * 24, ang: m.aim,
          speed: 900, dmg: 110, el: 'ENE', team: 'ally', owner: m, size: 12, range: 1000,
          pierce: 99, splash: 74, color: '#9fe8ff' });
        this.cam.addShake(7); this.audio.sfx('shotBig');
        this.parts.dirSpark(m.x + Math.cos(m.aim) * 26, m.y + Math.sin(m.aim) * 26, m.aim, 14, '#bfeaff', 340, 0.5, 0.3, 3);
      }
      if (t > 0.62) { m.specialState = null; m.blockFire = false; m.lastStep = -1; }
      break;
    }
    case 'shield_burst': {
      if (Math.random() < dt * 20) this.parts.add({ x: m.x, y: m.y, life: 0.3, max: 0.3, color: 'rgba(255,180,90,0.5)', r0: 30, r1: 40, w: 3, kind: 'ring' });
      if (t >= 3.2) {
        this.explode(m.x, m.y, 210, 140, 'THR', 'ally', m);
        this.cam.addShake(16);
        m.specialState = null;
      }
      break;
    }
    case 'blade_rush': {
      m.blockFire = true;
      m.iframe = Math.max(m.iframe, 0.2);
      const period = 0.30;
      const step = Math.floor(t / period);
      if (step > (m.rushStep || 0) - 1 && step < 4) {
        m.rushStep = step + 1;
        let tgt = null, bd = Infinity;
        for (const e of this.allFoes()) {
          const d = dist2(m.x, m.y, e.x, e.y);
          if (d < bd && d < 560 * 560) { bd = d; tgt = e; }
        }
        const a = tgt ? angTo(m.x, m.y, tgt.x, tgt.y) : m.aim;
        m.vx = Math.cos(a) * 1250; m.vy = Math.sin(a) * 1250;
        m.aim = a; m.ang = a;
        for (const e of this.allFoes()) {
          if (dist(m.x, m.y, e.x, e.y) < 130) this.applyDamage(e, 120, 'THR', m, { text: true, crit: true });
        }
        this.parts.ring(m.x, m.y, '#8effd2', 10, 130, 0.3, 5);
        this.parts.dirSpark(m.x, m.y, a, 16, '#c8ffe8', 400, 0.9, 0.35, 3);
        this.cam.addShake(8); this.audio.sfx('explode'); this.hitStop = 0.04;
      }
      if (t > period * 4 + 0.1) { m.specialState = null; m.blockFire = false; m.rushStep = 0; }
      break;
    }
    case 'emp_nova': {
      m.novaR = t * 620;
      this.parts.add({ x: m.x, y: m.y, life: 0.16, max: 0.16, color: 'rgba(197,140,255,0.85)', r0: m.novaR * 0.9, r1: m.novaR, w: 8, kind: 'ring' });
      for (const e of this.allFoes()) {
        if (e._novaHit) continue;
        const d = dist(m.x, m.y, e.x, e.y);
        if (d <= m.novaR) {
          e._novaHit = true;
          this.applyDamage(e, 78, 'EMP', m, { text: true, stun: 1.4 });
          this.parts.spark(e.x, e.y, 8, '#e0c0ff', 220, 0.4, 2.4);
        }
      }
      if (m.novaR > 340) {
        for (const e of this.enemies) e._novaHit = false;
        if (this.boss) this.boss._novaHit = false;
        for (const o of this.objects) o._novaHit = false;
        this.addHazard({ kind: 'emp', x: m.x, y: m.y, r: 200, dps: 26, el: 'EMP', team: 'ally', owner: m, life: 3.4, slow: true });
        m.specialState = null;
      }
      break;
    }
    case 'inferno_field': if (t > 0.4) m.specialState = null; break;
    case 'phantom': if (t > 0.4) m.specialState = null; break;
    case 'orbital': if (t > 0.6) m.specialState = null; break;
    case 'full_salvo': {
      if (Math.random() < dt * 26) {
        const a = m.aim + rnd(-0.5, 0.5);
        this.spawnBullet({ x: m.x + Math.cos(a) * 22, y: m.y + Math.sin(a) * 22, ang: a, speed: 780,
          dmg: 26, el: 'KIN', team: 'ally', owner: m, size: 4, range: 700, color: '#ffe6a0' });
        this.parts.dirSpark(m.x, m.y, a, 2, '#ffe9b0', 200, 0.4, 0.14, 2);
      }
      if (t > 2.6) m.specialState = null;
      break;
    }
    default: m.specialState = null; break;
  }
},

/* ============================ 目標・オブジェクト ============================ */
updateObjects(dt) {
  for (const o of this.objects) {
    if (o.dead) continue;
    if (o.kind === 'tower') {
      o.ang += dt * 0.9;
      o.hitFlash = Math.max(0, o.hitFlash - dt * 4);
      o.spawnT -= dt;
      if (o.spawnT <= 0) {
        o.spawnT = 11;
        const live = this.enemies.filter((e) => !e.dead).length;
        if (live < 34) {
          const a = rnd(TAU);
          const nx = o.x + Math.cos(a) * 60, ny = o.y + Math.sin(a) * 60;
          if (!pointBlocked(this.world, nx, ny, 16)) {
            const dr = new Enemy(D.ENEMIES.drone, nx, ny, this.lvMul, false);
            dr.state = 'search'; dr.searchT = 8; dr.lastKnown = { x: nx, y: ny };
            const p = nearestPlayer(this, dr);
            if (p) dr.lastKnown = { x: p.x, y: p.y };
            this.enemies.push(dr);
            this.parts.ring(nx, ny, '#8ff0f0', 6, 40, 0.4, 3);
          }
        }
      }
    } else if (o.kind === 'crate') {
      o.ang += dt * 0.4;
      let onIt = false;
      for (const p of this.players) if (!p.dead && !p.down && dist(p.x, p.y, o.x, o.y) < o.r + p.r + 14) onIt = true;
      if (onIt) {
        o.cap += dt;
        this.parts.add({ x: o.x, y: o.y, life: 0.18, max: 0.18, color: 'rgba(140,255,180,0.55)', r0: o.r + 6, r1: o.r + 16, w: 3, kind: 'ring' });
        if (o.cap >= o.need) {
          o.dead = true;
          const ob = this.objectives.find((x) => x.id === 'crates');
          if (ob) { ob.done++; this.setToast(`補給コンテナを確保 ${ob.done}/${ob.need}`, 2.2); }
          this.audio.sfx('pickup');
          this.dropPickup(o.x + 24, o.y, 'repair');
          this.dropPickup(o.x - 24, o.y, 'ammo');
          this.dropScrap(o.x, o.y, 90);
        }
      } else o.cap = Math.max(0, o.cap - dt * 0.7);
    }
  }
},

checkObjectives() {
  if (this.state !== 'play') return;
  const ko = this.objectives.find((o) => o.id === 'kill_all');
  if (ko) ko.done = Math.min(ko.need, (this.roster || this.enemies).filter((e) => e.dead).length);

  const nonBoss = this.objectives.filter((o) => o.id !== 'boss');
  const preDone = nonBoss.every((o) => o.done >= o.need);

  if (this.sector.boss) {
    const bo = this.objectives.find((o) => o.id === 'boss');
    if (preDone && !this.boss && !this.bossSpawned) {
      this.bossSpawned = true;
      this.spawnBoss();
    }
    if (bo && bo.done >= bo.need) this.clear();
  } else if (preDone) this.clear();
},

spawnBoss() {
  const def = D.BOSSES[this.sector.boss];
  const site = this.bossSite;
  const b = new Boss(def, site.x, site.y, 1 + (this.sector.lv - 1) * 0.2);
  this.boss = b;
  this.banner = `${def.name} ― ${def.title}`;
  this.bannerT = 4.0;
  this.setToast(def.intro, 4.5);
  this.audio.sfx('alert');
  this.cam.addShake(14);
  this.parts.ring(site.x, site.y, '#ff6a4a', 20, 320, 0.9, 10);
  this.parts.explosion(site.x, site.y, 180);
},

damageBossPart(b, p, amount, el, src) {
  if (!b || !p.alive) return;
  const aff = D.affinityOf(el, b.armor);
  const dmg = amount * aff * 1.35;                 // 部位は弱点
  p.hp -= dmg;
  b.hitFlash = 1;
  const px = p.wx, py = p.wy;
  this.ft.add(px, py - 10, Math.round(dmg).toString(), '#ffd166', 14, 0.7);
  if (src && src.lo) { src.dmgDealt += dmg; this.gainSp(src, dmg * 0.18); }
  this.applyDamage(b, amount * 0.35, el, src, { text: false });
  if (p.hp <= 0) {
    p.alive = false;
    this.parts.explosion(px, py, 130);
    this.cam.addShake(12);
    this.audio.sfx('boom');
    this.ft.add(px, py - 24, `${p.name} 破壊`, '#ff9a5c', 16, 1.6);
    this.applyDamage(b, b.maxHp * 0.06, 'KIN', src, { text: false });
  }
},

killBoss(b, src) {
  b.dead = true;
  this.slowmo = 1.6;
  this.cam.addShake(24);
  for (let i = 0; i < 14; i++) {
    setTimeout(() => {
      if (!this.parts) return;
      this.parts.explosion(b.x + rnd(-b.r, b.r), b.y + rnd(-b.r, b.r), rnd(60, 150));
    }, i * 110);
  }
  this.audio.sfx('boom');
  const bo = this.objectives.find((o) => o.id === 'boss');
  if (bo) bo.done = 1;
  this.reward.scrap += b.def.scrap;
  this.dropScrap(b.x, b.y, 200);
  if (src && src.lo) src.kills++;
},

/* ============================ 終了処理 ============================ */
clear() {
  if (this.state !== 'play') return;
  this.state = 'clear';
  this.endT = 2.4;
  this.banner = 'MISSION COMPLETE';
  this.bannerT = 3;
  this.audio.sfx('win');
},
fail() {
  if (this.state !== 'play') return;
  this.state = 'fail';
  this.endT = 2.2;
  this.banner = 'MISSION FAILED';
  this.bannerT = 3;
  this.audio.sfx('lose');
},
finish() {
  if (this.finished) return;
  this.finished = true;
  const s = this.sector;
  const par = 90 + s.lv * 45;
  let rank = 'C';
  if (this.state === 'clear') {
    const downs = this.players.reduce((a, p) => a + (p.dead ? 2 : 0), 0);
    const score = par / Math.max(1, this.time) - downs * 0.25;
    rank = score >= 1.35 ? 'S' : score >= 1.0 ? 'A' : score >= 0.7 ? 'B' : 'C';
  }
  const scrap = this.state === 'clear' ? this.reward.scrap + s.scrapBonus : Math.round(this.reward.scrap * 0.4);
  const tickets = this.state === 'clear' ? s.tickets + (rank === 'S' ? 2 : rank === 'A' ? 1 : 0) : 0;
  this.onEnd({
    cleared: this.state === 'clear',
    rank, time: this.time, scrap, tickets,
    kills: this.reward.kills,
    players: this.players.map((p) => ({ pid: p.pid, kills: p.kills, dmg: Math.round(p.dmgDealt), frame: p.lo.frame.name })),
  });
},

});
})();
