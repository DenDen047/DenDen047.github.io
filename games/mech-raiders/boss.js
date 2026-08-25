/* =========================================================================
   MECH RAIDERS ― ボスの行動パターン
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData, F = window.MRField, B = window.MRBattle;
const { TAU, clamp, lerp, dist, dist2, angTo, angDiff, angApproach, deg, rnd, pick } = C;
const { Enemy, pointBlocked, hasLOS, collideWalls } = F;
const Field = B.Field;

function nearestPlayer(field, b) {
  let best = null, bd = Infinity;
  for (const p of field.players) {
    if (p.dead) continue;
    let d = dist2(b.x, b.y, p.x, p.y);
    if (p.down) d *= 4;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/* パターン本体。返り値は使わない。pat.t が dur を超えたら終了 */
const PAT = {
  /* 扇状に弾をなぎ払う */
  gatling(f, b, dt, pat, t) {
    if (!pat.init) { pat.init = 1; pat.base = b.aim - deg(45); pat.dir = Math.random() < 0.5 ? 1 : -1; pat.acc = 0; }
    const sweep = deg(90) * (t / pat.dur);
    const a = pat.base + (pat.dir > 0 ? sweep : deg(90) - sweep);
    pat.acc += dt;
    if (pat.acc >= 0.055) {
      pat.acc = 0;
      f.spawnBullet({ x: b.x + Math.cos(a) * (b.r + 8), y: b.y + Math.sin(a) * (b.r + 8), ang: a + rnd(-0.05, 0.05),
        speed: 560, dmg: 11 * b.dmgMul, el: 'KIN', team: 'foe', owner: b, size: 4, range: 900, color: '#ffd88a' });
      f.parts.dirSpark(b.x + Math.cos(a) * (b.r + 8), b.y + Math.sin(a) * (b.r + 8), a, 2, '#ffe9b0', 200, 0.4, 0.14, 2);
      f.audio.sfx('shot');
    }
    b.aim = angApproach(b.aim, a, dt * 2);
  },

  /* 追尾ミサイルの雨 */
  missile_rain(f, b, dt, pat, t) {
    pat.acc = (pat.acc || 0) + dt;
    if (pat.acc >= 0.14 && t < pat.dur * 0.8) {
      pat.acc = 0;
      const tgt = nearestPlayer(f, b);
      const a = rnd(TAU);
      f.spawnBullet({ x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, ang: a, speed: 250,
        dmg: 20 * b.dmgMul, el: 'KIN', team: 'foe', owner: b, size: 4, range: 1400, splash: 62,
        homing: tgt, turn: 2.6, color: '#ff9a5c' });
      f.audio.sfx('shot');
    }
  },

  /* 地を這う衝撃波 */
  shockwave(f, b, dt, pat, t) {
    if (!pat.init) { pat.init = 1; pat.r = 0; pat.hit = new Set(); f.audio.sfx('boom'); f.cam.addShake(12); }
    pat.r += dt * 520;
    f.parts.add({ x: b.x, y: b.y, life: 0.14, max: 0.14, color: 'rgba(255,180,90,0.8)', r0: pat.r * 0.92, r1: pat.r, w: 10, kind: 'ring' });
    for (const p of f.players) {
      if (p.dead || p.down || pat.hit.has(p)) continue;
      const d = dist(b.x, b.y, p.x, p.y);
      if (d <= pat.r && d >= pat.r - 60) { pat.hit.add(p); f.hurtPlayer(p, 34 * b.dmgMul, 'KIN', b); }
    }
  },

  /* 回転レーザー */
  laser_sweep(f, b, dt, pat, t) {
    if (!pat.init) { pat.init = 1; pat.a = b.aim; pat.dir = Math.random() < 0.5 ? 1 : -1; }
    const warm = 0.7;
    if (t < warm) {
      const ex = b.x + Math.cos(pat.a) * 900, ey = b.y + Math.sin(pat.a) * 900;
      f.beams.push({ x1: b.x, y1: b.y, x2: ex, y2: ey, w: 1.5, color: 'rgba(255,90,110,0.55)' });
      return;
    }
    pat.a += dt * 1.5 * pat.dir;
    const hit = f.rayHit(b.x, b.y, pat.a, 900, 'foe', 99);
    f.beams.push({ x1: b.x, y1: b.y, x2: hit.x, y2: hit.y, w: 9, color: '#ff5a6a' });
    for (const p of hit.targets) f.hurtPlayer(p, 60 * b.dmgMul * dt, 'ENE', b);
    if (Math.random() < dt * 30) f.parts.dirSpark(hit.x, hit.y, pat.a + Math.PI, 1, '#ff9a9a', 200, 1, 0.3, 2);
    f.audio.sfx('beam');
  },

  /* 随伴ドローンを切り離す */
  drone_split(f, b, dt, pat, t) {
    if (pat.init) return;
    pat.init = 1;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const x = b.x + Math.cos(a) * (b.r + 30), y = b.y + Math.sin(a) * (b.r + 30);
      if (pointBlocked(f.world, x, y, 12)) continue;
      const d = new Enemy(D.ENEMIES.drone, x, y, b.dmgMul, false);
      d.state = 'engage'; d.canSee = true;
      f.enemies.push(d);
      f.parts.ring(x, y, '#8ff0f0', 6, 46, 0.4, 3);
    }
    f.audio.sfx('alert');
  },

  /* 突っ切りながら側面へ撃つ */
  strafe_run(f, b, dt, pat, t) {
    if (!pat.init) {
      pat.init = 1;
      const tgt = nearestPlayer(f, b);
      pat.a = tgt ? angTo(b.x, b.y, tgt.x, tgt.y) : b.aim;
      pat.side = Math.random() < 0.5 ? 1 : -1;
    }
    b.vx = lerp(b.vx, Math.cos(pat.a) * b.speed * 2.3, 1 - Math.pow(0.02, dt));
    b.vy = lerp(b.vy, Math.sin(pat.a) * b.speed * 2.3, 1 - Math.pow(0.02, dt));
    pat.acc = (pat.acc || 0) + dt;
    if (pat.acc >= 0.1) {
      pat.acc = 0;
      const tgt = nearestPlayer(f, b);
      const a = tgt ? angTo(b.x, b.y, tgt.x, tgt.y) + rnd(-0.14, 0.14) : pat.a;
      f.spawnBullet({ x: b.x, y: b.y, ang: a, speed: 640, dmg: 13 * b.dmgMul, el: 'ENE', team: 'foe',
        owner: b, size: 4, range: 800, color: '#7cf3ff' });
      f.audio.sfx('shot');
    }
  },

  /* 二基の砲塔から同時ビーム */
  twin_beam(f, b, dt, pat, t) {
    const tgt = nearestPlayer(f, b);
    if (!tgt) return;
    const live = b.parts.filter((p) => p.alive);
    const srcs = live.length ? live.map((p) => ({ x: p.wx, y: p.wy })) : [{ x: b.x, y: b.y }];
    const warm = 0.8;
    for (const s of srcs) {
      const a = angTo(s.x, s.y, tgt.x, tgt.y);
      if (t < warm) {
        f.beams.push({ x1: s.x, y1: s.y, x2: s.x + Math.cos(a) * 800, y2: s.y + Math.sin(a) * 800, w: 1.5, color: 'rgba(224,184,255,0.5)' });
        continue;
      }
      const hit = f.rayHit(s.x, s.y, a, 800, 'foe', 99);
      f.beams.push({ x1: s.x, y1: s.y, x2: hit.x, y2: hit.y, w: 7, color: '#e0b8ff' });
      for (const p of hit.targets) f.hurtPlayer(p, 44 * b.dmgMul * dt, 'ENE', b);
    }
    if (t >= warm) f.audio.sfx('beam');
  },

  /* 全方位へ弾幕を撒く */
  spread_hell(f, b, dt, pat, t) {
    pat.acc = (pat.acc || 0) + dt;
    pat.ring = pat.ring || 0;
    if (pat.acc >= 0.34) {
      pat.acc = 0; pat.ring++;
      const n = 18, off = pat.ring * 0.16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + off;
        f.spawnBullet({ x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, ang: a, speed: 300,
          dmg: 15 * b.dmgMul, el: 'THR', team: 'foe', owner: b, size: 5, range: 1000, color: '#ff9a5c' });
      }
      f.audio.sfx('shotBig');
      f.cam.addShake(4);
    }
  },

  /* 予備動作 → 体当たり */
  charge_slam(f, b, dt, pat, t) {
    const warm = 0.9;
    const tgt = nearestPlayer(f, b);
    if (t < warm) {
      if (tgt) b.aim = angApproach(b.aim, angTo(b.x, b.y, tgt.x, tgt.y), dt * 3);
      b.vx *= 0.86; b.vy *= 0.86;
      if (Math.random() < dt * 26) f.parts.dirSpark(b.x - Math.cos(b.aim) * b.r, b.y - Math.sin(b.aim) * b.r, b.aim + Math.PI, 2, '#ffcf4a', 220, 0.7, 0.3, 3);
      const ex = b.x + Math.cos(b.aim) * 520, ey = b.y + Math.sin(b.aim) * 520;
      f.beams.push({ x1: b.x, y1: b.y, x2: ex, y2: ey, w: 2, color: 'rgba(255,160,90,0.4)' });
      return;
    }
    if (!pat.launched) { pat.launched = 1; f.audio.sfx('boom'); f.cam.addShake(10); }
    b.vx = lerp(b.vx, Math.cos(b.aim) * b.speed * 4.2, 1 - Math.pow(0.02, dt));
    b.vy = lerp(b.vy, Math.sin(b.aim) * b.speed * 4.2, 1 - Math.pow(0.02, dt));
    for (const p of f.players) {
      if (p.dead || p.down || p.iframe > 0 || p.rollT > 0) continue;
      if (dist(b.x, b.y, p.x, p.y) < b.r + p.r + 6) {
        f.hurtPlayer(p, 46 * b.dmgMul, 'KIN', b);
        const a = angTo(b.x, b.y, p.x, p.y);
        p.vx += Math.cos(a) * 620; p.vy += Math.sin(a) * 620;
      }
    }
  },

  /* 座標を跳んで詰める */
  warp_dash(f, b, dt, pat, t) {
    const tgt = nearestPlayer(f, b);
    if (!pat.init) {
      pat.init = 1; pat.step = 0;
      f.parts.ring(b.x, b.y, '#9ad4ff', 10, 90, 0.4, 5);
    }
    const period = 0.62;
    const step = Math.floor(t / period);
    if (step > pat.step - 1 && step < 3 && tgt) {
      pat.step = step + 1;
      f.parts.explosion(b.x, b.y, 60, '#9ad4ff', '#5f8fff');
      const a = rnd(TAU), r = rnd(150, 240);
      let nx = clamp(tgt.x + Math.cos(a) * r, 80, f.world.w - 80);
      let ny = clamp(tgt.y + Math.sin(a) * r, 80, f.world.h - 80);
      if (pointBlocked(f.world, nx, ny, b.r + 6)) { nx = tgt.x; ny = tgt.y - 200; }
      b.x = nx; b.y = ny; b.vx = 0; b.vy = 0;
      b.aim = angTo(b.x, b.y, tgt.x, tgt.y);
      f.parts.ring(b.x, b.y, '#9ad4ff', 10, 110, 0.5, 6);
      f.audio.sfx('special');
      for (let i = 0; i < 9; i++) {
        const aa = b.aim + (i - 4) * 0.12;
        f.spawnBullet({ x: b.x, y: b.y, ang: aa, speed: 460, dmg: 14 * b.dmgMul, el: 'ENE', team: 'foe',
          owner: b, size: 4, range: 700, color: '#9ad4ff' });
      }
    }
  },

  /* 回転しながらの環状弾幕 */
  ring_barrage(f, b, dt, pat, t) {
    pat.acc = (pat.acc || 0) + dt;
    pat.phase = (pat.phase || 0) + dt * 1.5;
    if (pat.acc >= 0.11) {
      pat.acc = 0;
      for (let k = 0; k < 3; k++) {
        const a = pat.phase + (k / 3) * TAU;
        f.spawnBullet({ x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, ang: a, speed: 340,
          dmg: 12 * b.dmgMul, el: 'EMP', team: 'foe', owner: b, size: 4.5, range: 1000, color: '#c58cff' });
      }
      f.audio.sfx('shot');
    }
  },

  /* EMP 場を広げる */
  emp_field(f, b, dt, pat, t) {
    if (!pat.init) {
      pat.init = 1;
      f.addHazard({ kind: 'emp', x: b.x, y: b.y, r: 260, dps: 22 * b.dmgMul, el: 'EMP', team: 'foe', owner: b, life: 5, slow: true });
      f.parts.ring(b.x, b.y, '#c58cff', 20, 260, 0.7, 8);
      f.audio.sfx('special');
    }
  },

  /* 着弾点を示してから軌道砲 */
  orbital_strike(f, b, dt, pat, t) {
    pat.acc = (pat.acc || 0) + dt;
    if (pat.acc >= 0.28 && t < pat.dur * 0.75) {
      pat.acc = 0;
      const tgt = nearestPlayer(f, b);
      if (!tgt) return;
      const a = rnd(TAU), r = Math.sqrt(Math.random()) * 190;
      f.dropMarker(tgt.x + Math.cos(a) * r, tgt.y + Math.sin(a) * r, 104, 44 * b.dmgMul, 'ENE', 'foe', 1.15, b);
    }
  },

  /* 増援を呼ぶ */
  summon(f, b, dt, pat, t) {
    if (pat.init) return;
    pat.init = 1;
    const kinds = ['gunner', 'bomber', 'arcbot', 'shielder'];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + rnd(0.2);
      const x = clamp(b.x + Math.cos(a) * 150, 70, f.world.w - 70);
      const y = clamp(b.y + Math.sin(a) * 150, 70, f.world.h - 70);
      if (pointBlocked(f.world, x, y, 24)) continue;
      const e = new Enemy(D.ENEMIES[kinds[i % kinds.length]], x, y, b.dmgMul, false);
      e.state = 'engage'; e.canSee = true;
      f.enemies.push(e);
      f.parts.ring(x, y, '#ffcf4a', 8, 60, 0.5, 4);
    }
    f.audio.sfx('alert');
  },

  /* 鏡像を出す（見た目だけ・当たると痛い突進体） */
  mirror(f, b, dt, pat, t) {
    if (!pat.init) {
      pat.init = 1;
      for (let i = 0; i < 2; i++) {
        const a = b.aim + (i === 0 ? 1 : -1) * 1.2;
        const x = clamp(b.x + Math.cos(a) * 160, 70, f.world.w - 70);
        const y = clamp(b.y + Math.sin(a) * 160, 70, f.world.h - 70);
        const e = new Enemy(D.ENEMIES.bomber, x, y, b.dmgMul * 1.6, false);
        e.state = 'engage'; e.canSee = true; e.mirror = true;
        f.enemies.push(e);
        f.parts.ring(x, y, '#ff8a8a', 8, 70, 0.5, 4);
      }
      f.audio.sfx('special');
    }
  },
};

const PAT_DUR = {
  gatling: 1.8, missile_rain: 2.0, shockwave: 1.0, laser_sweep: 2.6, drone_split: 0.4,
  strafe_run: 1.5, twin_beam: 2.2, spread_hell: 2.0, charge_slam: 1.9, warp_dash: 2.0,
  ring_barrage: 2.2, emp_field: 0.4, orbital_strike: 2.4, summon: 0.4, mirror: 0.4,
};

Object.assign(Field.prototype, {

updateBoss(b, dt) {
  b.entered += dt;
  b.hitFlash = Math.max(0, b.hitFlash - dt * 4);
  b.stun = Math.max(0, b.stun - dt);

  /* 降着演出 */
  if (b.entered < 1.1) {
    const k = b.entered / 1.1;
    b.dropY = (1 - k) * -260;
    if (Math.random() < dt * 20) this.parts.spark(b.x + rnd(-b.r, b.r), b.y + rnd(-b.r, b.r), 1, '#ffcf4a', 200, 0.5, 3);
    return;
  }
  b.dropY = 0;

  const tgt = nearestPlayer(this, b);
  b.target = tgt;

  /* フェーズ移行 */
  const ratio = b.hp / b.maxHp;
  const wantPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
  if (wantPhase > b.phase) {
    b.phase = wantPhase;
    b.pat = null; b.cool = 0.9;
    this.cam.addShake(16);
    this.parts.ring(b.x, b.y, '#ff6a4a', 20, 300, 0.8, 9);
    this.audio.sfx('alert');
    this.setToast(`${b.def.name} ― 第${b.phase}形態`, 2.4);
    for (const p of b.parts) if (p.alive) p.hp *= 0.9;
  }

  if (b.stun > 0) { b.vx *= 0.9; b.vy *= 0.9; }
  else if (b.pat) {
    b.pat.t += dt;
    const fn = PAT[b.pat.id];
    if (fn) fn(this, b, dt, b.pat, b.pat.t);
    if (b.pat.t >= b.pat.dur) {
      b.pat = null;
      b.cool = Math.max(0.35, (1.5 - b.phase * 0.24) * rnd(0.8, 1.2));
    }
  } else {
    /* 待機中は間合いを取り直す */
    b.cool -= dt;
    if (tgt) {
      const d = dist(b.x, b.y, tgt.x, tgt.y);
      const keep = b.def.flying ? 300 : 240;
      const a = angTo(b.x, b.y, tgt.x, tgt.y);
      const dir = d > keep + 70 ? a : d < keep - 70 ? a + Math.PI : a + Math.PI / 2;
      b.vx = lerp(b.vx, Math.cos(dir) * b.speed, 1 - Math.pow(0.02, dt));
      b.vy = lerp(b.vy, Math.sin(dir) * b.speed, 1 - Math.pow(0.02, dt));
      b.aim = angApproach(b.aim, a, dt * 2.4);
    }
    if (b.cool <= 0) this.pickPattern(b);
  }

  b.ang = angApproach(b.ang, b.aim, dt * 2.6);
  b.walkPhase += dt * Math.hypot(b.vx, b.vy) * 0.05;
  b.x += b.vx * dt; b.y += b.vy * dt;
  b.vx *= Math.max(0, 1 - 1.4 * dt); b.vy *= Math.max(0, 1 - 1.4 * dt);
  if (!b.flying) collideWalls(this.world, b);
  else {
    b.x = clamp(b.x, b.r, this.world.w - b.r);
    b.y = clamp(b.y, b.r, this.world.h - b.r);
  }
  const cs = Math.cos(b.ang), sn = Math.sin(b.ang);
  for (const p of b.parts) {
    p.ang = b.ang;
    p.wx = b.x + p.ox * cs - p.oy * sn;
    p.wy = b.y + p.ox * sn + p.oy * cs;
  }
},

pickPattern(b) {
  const list = b.def.patterns || [{ id: 'gatling', w: 1 }];
  /* 砲塔が全部壊れていたらビーム系は出さない */
  const usable = list.filter((p) => !(p.id === 'twin_beam' && b.parts.length && b.partsAlive === 0));
  const pool = usable.length ? usable : list;
  let total = 0;
  for (const p of pool) total += p.w;
  let r = Math.random() * total, chosen = pool[0];
  for (const p of pool) { r -= p.w; if (r <= 0) { chosen = p; break; } }
  b.pat = { id: chosen.id, t: 0, dur: (PAT_DUR[chosen.id] || 1.5) * (b.phase >= 3 ? 1.15 : 1) };
  b.patName = chosen.id;
},

});
})();
