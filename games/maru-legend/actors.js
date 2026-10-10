/* =========================================================================
   マルの伝説 ― 敵とボス
   スライム・オクタ・コウモリ・騎士と、3体のボス（キングスライム・ドドンガ・魔王カクドン）
   ========================================================================= */

/* hp: 体力（剣1回で1減る） r: 当たりの半径 dmg: ぶつかったときのダメージ（半ハート単位） */
const ENEMY_TYPES = {
  slime:     { hp: 1, r: 10, speed: 40, dmg: 1, ai: 'slime', tint: 'green' },
  slime_b:   { hp: 2, r: 10, speed: 54, dmg: 2, ai: 'slime', tint: 'blue' },
  slime_r:   { hp: 3, r: 11, speed: 64, dmg: 2, ai: 'slime', tint: 'red' },
  mini:      { hp: 1, r: 8, speed: 62, dmg: 1, ai: 'slime', tint: 'green', small: true },
  octo:      { hp: 1, r: 10, speed: 52, dmg: 1, ai: 'octo', shots: 1, tint: 'red' },
  octo_b:    { hp: 2, r: 10, speed: 62, dmg: 1, ai: 'octo', shots: 2, tint: 'blue' },
  bat:       { hp: 1, r: 8, speed: 84, dmg: 1, ai: 'bat', fly: true },
  knight:    { hp: 3, r: 11, speed: 46, dmg: 2, ai: 'knight', shield: true, tint: 'blue' },
  knight_r:  { hp: 5, r: 11, speed: 60, dmg: 3, ai: 'knight', shield: true, tint: 'red' },
  kingslime: { hp: 10, r: 34, dmg: 2, ai: 'kingslime', boss: true, hitInv: 0.35, name: 'キングスライム' },
  dodongo:   { hp: 8, r: 20, speed: 36, dmg: 2, ai: 'dodongo', boss: true, hitInv: 0.5, name: 'ドドンガ' },
  mao:       { hp: 8, r: 16, dmg: 2, ai: 'mao', boss: true, hitInv: 0.6, name: '魔王カクドン' },
};

function makeEnemy(type, x, y, spawnT) {
  const d = ENEMY_TYPES[type];
  const half = d.boss ? Math.min(d.r, 26) : d.r * 0.8;
  return Object.assign({}, d, {
    type, x, y, maxHp: d.hp,
    hw: half, hh: half,
    dir: pick(DIR_NAMES), state: 'idle', t: rand(0.3, 1.0),
    inv: 0, stun: 0, flash: 0, kbT: 0, kbx: 0, kby: 0,
    spawnT: spawnT || 0, vx: 0, vy: 0, hop: 0, z: 0, alpha: 1,
    anim: Math.random() * 10,
  }, type === 'mao' ? { state: 'watch', t: 1.4, fireT: 2, rallyNeed: 0 } : {},
     type === 'kingslime' ? { t: 1.2, lands: 0 } : {},
     type === 'dodongo' ? { dir: 'down', t: 1.5, supplyT: 4 } : {});
}

/** 当たり判定に使う円の一覧。ボスは体の丸ごとに判定する。 */
function enemyParts(e) {
  if (e.type === 'dodongo') {
    const d = DIRS[e.dir];
    return [
      { x: e.x, y: e.y, r: 20 },
      { x: e.x + d.x * 22, y: e.y + d.y * 22, r: 14 },
      { x: e.x - d.x * 22, y: e.y - d.y * 22, r: 10 },
    ];
  }
  if (e.type === 'kingslime') return [{ x: e.x, y: e.y - e.z, r: e.r }];
  if (e.type === 'mao') return [{ x: e.x, y: e.y - 6, r: e.r }];
  return [{ x: e.x, y: e.y, r: e.r }];
}

/** ボスにその攻撃が効かないなら true（はじく）。 */
function bossGuard(e, src) {
  if (e.type === 'dodongo' || e.type === 'mao') return !(e.stun > 0);
  return false;
}

function updateEnemy(e, dt) {
  e.anim += dt;
  e.inv = Math.max(0, e.inv - dt);
  e.flash = Math.max(0, e.flash - dt);
  if (e.spawnT > 0) { e.spawnT -= dt; return; }
  if (e.dying != null) {
    e.dying -= dt;
    e.boomT = (e.boomT || 0) - dt;
    if (e.boomT <= 0) {
      e.boomT = 0.17;
      Game.fx.push({ t: 'boom', x: e.x + rand(-e.r, e.r), y: e.y - e.z + rand(-e.r, e.r), life: 0.32, max: 0.32, small: true });
      Sound.play('kill');
    }
    if (e.dying <= 0) Game.finishBoss(e);
    return;
  }
  if (e.kbT > 0) {
    e.kbT -= dt;
    Game.moveBox(e, e.kbx * dt, e.kby * dt, e.fly ? 'fly' : 'walk');
  } else if (e.stun > 0) {
    e.stun -= dt;
  } else {
    AI[e.ai](e, dt);
  }
  if (e.dead || e.intangible || e.stun > 0 || e.airborne) return;
  const p = Game.player;
  for (const pt of enemyParts(e)) {
    if (dist(pt.x, pt.y, p.x, p.y) < pt.r + 8) { Game.hurtPlayer(e.dmg, pt.x, pt.y); break; }
  }
}

function faceVelocity(e) {
  if (Math.abs(e.vx) > Math.abs(e.vy)) e.dir = e.vx > 0 ? 'right' : 'left';
  else if (e.vy) e.dir = e.vy > 0 ? 'down' : 'up';
}

/** 半分は勇者の方へ、半分は気まぐれに向きを決める。 */
function chooseDir(e, towardChance) {
  return Math.random() < towardChance ? dirToward(e, Game.player) : pick(DIR_NAMES);
}

const AI = {
  /* ぴょんぴょん跳ねて近づく */
  slime(e, dt) {
    e.t -= dt;
    if (e.state === 'idle') {
      e.hop = 0;
      if (e.t <= 0) {
        e.state = 'hop';
        e.t = e.hopDur = rand(0.5, 1.0);
        const p = Game.player;
        const a = Math.random() < 0.55 ? Math.atan2(p.y - e.y, p.x - e.x) + rand(-0.5, 0.5) : rand(0, Math.PI * 2);
        e.vx = Math.cos(a) * e.speed;
        e.vy = Math.sin(a) * e.speed;
        faceVelocity(e);
      }
    } else {
      const k = 1 - e.t / e.hopDur;
      e.hop = Math.abs(Math.sin(k * Math.PI * 2)) * 5;
      const hit = Game.moveBox(e, e.vx * dt, e.vy * dt, 'walk');
      if (hit.x) e.vx *= -1;
      if (hit.y) e.vy *= -1;
      if (e.t <= 0) { e.state = 'idle'; e.t = rand(0.3, 0.9); }
    }
  },

  /* 歩いて止まり、向いている方へ石を吐く */
  octo(e, dt) {
    e.t -= dt;
    if (e.state === 'idle' || e.state === 'walk') {
      if (e.state === 'idle') { e.state = 'walk'; e.t = rand(0.6, 1.6); e.dir = chooseDir(e, 0.5); }
      const d = DIRS[e.dir];
      const hit = Game.moveBox(e, d.x * e.speed * dt, d.y * e.speed * dt, 'walk');
      if (hit.x || hit.y) e.dir = pick(DIR_NAMES.filter((n) => n !== e.dir));
      if (e.t <= 0) { e.state = 'aim'; e.t = 0.55; e.shotsLeft = e.shots; }
    } else if (e.state === 'aim' && e.t <= 0) {
      const p = Game.player;
      const d = DIRS[e.dir];
      const aligned = d.x ? Math.abs(p.y - e.y) < 24 && Math.sign(p.x - e.x) === d.x : Math.abs(p.x - e.x) < 24 && Math.sign(p.y - e.y) === d.y;
      if (aligned || Math.random() < 0.6) {
        Game.projs.push({ t: 'rock', x: e.x + d.x * 12, y: e.y + d.y * 12, vx: d.x * 175, vy: d.y * 175, r: 5 });
        Sound.play('rock');
      }
      e.shotsLeft--;
      if (e.shotsLeft > 0) e.t = 0.35;
      else e.state = 'idle';
    }
  },

  /* ひらひら飛びまわり、ときどき休む */
  bat(e, dt) {
    e.t -= dt;
    if (e.state === 'rest') {
      if (e.t <= 0) { e.state = 'fly'; e.t = rand(1.5, 3.5); }
      return;
    }
    if (e.state === 'idle') { e.state = 'fly'; e.t = rand(1.5, 3.5); }
    e.retarget = (e.retarget || 0) - dt;
    if (e.retarget <= 0 || e.tx == null || dist(e.x, e.y, e.tx, e.ty) < 12) {
      const p = Game.player;
      if (Math.random() < 0.5) { e.tx = p.x + rand(-60, 60); e.ty = p.y + rand(-60, 60); }
      else { e.tx = rand(48, RW - 48); e.ty = rand(48, RH - 48); }
      e.retarget = rand(0.6, 1.2);
    }
    const a = Math.atan2(e.ty - e.y, e.tx - e.x);
    e.vx = lerp(e.vx, Math.cos(a) * e.speed, Math.min(1, dt * 3));
    e.vy = lerp(e.vy, Math.sin(a) * e.speed, Math.min(1, dt * 3));
    Game.moveBox(e, e.vx * dt, e.vy * dt, 'fly');
    if (e.t <= 0) { e.state = 'rest'; e.t = rand(0.6, 1.2); e.vx = 0; e.vy = 0; }
  },

  /* 盾を構えて歩く。正面からの剣ははじく */
  knight(e, dt) {
    e.t -= dt;
    const d = DIRS[e.dir];
    const hit = Game.moveBox(e, d.x * e.speed * dt, d.y * e.speed * dt, 'walk');
    if (hit.x || hit.y || e.t <= 0) {
      e.t = rand(0.8, 2.0);
      e.dir = chooseDir(e, 0.6);
    }
  },

  /* 勇者めがけて大ジャンプ。着地の衝撃で小さなスライムを生む */
  kingslime(e, dt) {
    e.t -= dt;
    const fast = e.hp <= 5;
    if (e.state === 'idle') {
      e.z = 0;
      e.airborne = false;
      if (e.t <= 0) {
        const p = Game.player;
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        const len = Math.min(150, dist(e.x, e.y, p.x, p.y));
        e.jx0 = e.x; e.jy0 = e.y;
        e.jx1 = clamp(e.x + Math.cos(a) * len, TS + e.r, RW - TS - e.r);
        e.jy1 = clamp(e.y + Math.sin(a) * len, TS + e.r, RH - TS - e.r);
        e.jt = 0;
        e.jdur = fast ? 0.7 : 0.95;
        e.state = 'jump';
      }
    } else if (e.state === 'jump') {
      e.jt += dt;
      const k = Math.min(1, e.jt / e.jdur);
      e.x = lerp(e.jx0, e.jx1, k);
      e.y = lerp(e.jy0, e.jy1, k);
      e.z = Math.sin(k * Math.PI) * 70;
      e.airborne = e.z > 14;
      e.intangible = e.airborne;
      if (k >= 1) {
        e.z = 0;
        e.airborne = false;
        e.intangible = false;
        e.state = 'idle';
        e.t = fast ? 0.55 : 0.95;
        e.lands++;
        Sound.play('land');
        Game.shake = Math.max(Game.shake, 0.3);
        Game.fx.push({ t: 'ring', x: e.x, y: e.y + 10, life: 0.4, max: 0.4, r0: e.r, r1: e.r + 46 });
        const p = Game.player;
        if (dist(p.x, p.y, e.x, e.y) < e.r + 36) Game.hurtPlayer(1, e.x, e.y);
        const minis = Game.enemies.filter((m) => m.type === 'mini' && !m.dead).length;
        if (e.lands % 2 === 0 && minis < 4) {
          for (const s of [-1, 1]) {
            const m = makeEnemy('mini', clamp(e.x + s * 46, 56, RW - 56), clamp(e.y + 8, 56, RH - 56), 0.25);
            Game.enemies.push(m);
            Game.poof(m.x, m.y);
          }
        }
      }
    }
  },

  /* のしのし歩く。爆弾を飲みこむと お腹の中で爆発して しびれる */
  dodongo(e, dt) {
    e.t -= dt;
    if (e.state === 'gulp') {
      e.vx = 0;
      if (e.t <= 0) {
        Sound.play('boom');
        Game.shake = Math.max(Game.shake, 0.35);
        for (let i = 0; i < 10; i++) {
          const a = rand(0, Math.PI * 2);
          Game.fx.push({ t: 'p', x: e.x, y: e.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, g: 0, life: 0.7, max: 0.7, r: rand(4, 8), color: '#8a8a8a' });
        }
        e.hp -= 2;
        e.flash = 0.3;
        Sound.play('bosshit');
        if (e.hp <= 0) { Game.killEnemy(e); return; }
        e.state = 'walk';
        e.stun = 2.6;
      }
      return;
    }
    const d = DIRS[e.dir];
    const hit = Game.moveBox(e, d.x * e.speed * dt, d.y * e.speed * dt, 'walk');
    if (hit.x || hit.y || e.t <= 0) { e.t = rand(1.2, 2.6); e.dir = chooseDir(e, 0.6); }
    const hx = e.x + d.x * 22, hy = e.y + d.y * 22;
    for (const q of Game.projs) {
      if (q.t === 'bomb' && !q.dead && dist(q.x, q.y, hx, hy) < 24) {
        q.dead = true;
        e.state = 'gulp';
        e.t = 0.9;
        Sound.play('gulp');
        break;
      }
    }
    // 爆弾が尽きたら、部屋のすみに補充してあげる
    e.supplyT -= dt;
    if (e.supplyT <= 0) {
      e.supplyT = 6;
      const S = Game.S;
      const any = Game.pickups.some((pk) => pk.t === 'bombs') || Game.projs.some((q) => q.t === 'bomb');
      if (S.bombs === 0 && !any) {
        const [cx, cy] = pick([[2, 2], [13, 2], [2, 8], [13, 8]]);
        const pk = Game.addPickup('bombs', pxOf(cx), pxOf(cy), { pop: true });
        pk.life = 12;
        Game.poof(pk.x, pk.y);
      }
    }
  },

  /* 消えては現れ、光の玉を撃つ。玉は剣で打ち返せる */
  mao(e, dt) {
    e.t -= dt;
    e.bob = (e.bob || 0) + dt;
    if (e.wasStunned) { e.wasStunned = false; e.state = 'vanish'; }
    const phase2 = e.hp <= 4;
    if (phase2 && !e.summoned) {
      e.summoned = true;
      for (const [cx, cy] of [[3, 3], [12, 3]]) {
        const b = makeEnemy('bat', pxOf(cx), pxOf(cy), 0.3);
        Game.enemies.push(b);
        Game.poof(b.x, b.y);
      }
    }
    switch (e.state) {
      case 'watch': {
        const orbAlive = Game.projs.some((q) => q.t === 'morb');
        if (phase2) {
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = 2.2;
            const p = Game.player;
            const a0 = Math.atan2(p.y - e.y, p.x - e.x);
            for (const off of [-0.32, 0, 0.32]) {
              Game.projs.push({ t: 'fire', x: e.x, y: e.y - 6, vx: Math.cos(a0 + off) * 140, vy: Math.sin(a0 + off) * 140, r: 6 });
            }
            Sound.play('rock');
          }
        }
        if (!orbAlive && e.t <= 0) e.state = 'vanish';
        break;
      }
      case 'vanish':
        e.intangible = true;
        e.alpha -= dt * 2.5;
        if (e.alpha <= 0) {
          e.alpha = 0;
          const p = Game.player;
          let tries = 0;
          do {
            e.x = rand(96, RW - 96);
            e.y = rand(80, RH - 130);
            tries++;
          } while (dist(e.x, e.y, p.x, p.y) < 160 && tries < 20);
          e.state = 'appear';
          Sound.play('warp');
        }
        break;
      case 'appear':
        e.alpha += dt * 2.5;
        if (e.alpha >= 1) { e.alpha = 1; e.intangible = false; e.state = 'cast'; e.t = 0.85; }
        break;
      case 'cast':
        if (e.t <= 0) {
          const p = Game.player;
          const speed = phase2 ? 175 : 150;
          const a = Math.atan2(p.y - (e.y - 6), p.x - e.x);
          e.rallyNeed = randInt(0, phase2 ? 3 : 2);
          Game.projs.push({ t: 'morb', x: e.x + Math.cos(a) * 20, y: e.y - 6 + Math.sin(a) * 20, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, speed, r: 9, owner: 'enemy', rally: 0 });
          Sound.play('beam');
          e.state = 'watch';
          e.t = 1.2;
        }
        break;
      default:
        e.state = 'watch';
        break;
    }
  },
};

/** 打ち返された光の玉が魔王に届いた。まだ打ち返すか、当たってしびれるか。 */
function maoCatch(e, q) {
  if (e.stun > 0) { q.dead = true; return; }
  if (q.rally < e.rallyNeed) {
    q.rally++;
    q.owner = 'enemy';
    q.speed *= 1.08;
    const p = Game.player;
    const a = Math.atan2(p.y - q.y, p.x - q.x);
    q.vx = Math.cos(a) * q.speed;
    q.vy = Math.sin(a) * q.speed;
    Sound.play('clink');
    Game.burst(q.x, q.y, '#c9a8ff', 8);
  } else {
    q.dead = true;
    e.stun = 2.4;
    e.wasStunned = true;
    e.flash = 0.3;
    Sound.play('bosshit');
    Game.shake = Math.max(Game.shake, 0.2);
    Game.burst(e.x, e.y - 6, '#e6d6ff', 14);
  }
}
