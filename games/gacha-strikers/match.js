/* =========================================================================
   GACHA STRIKERS ― 試合エンジン
   ピッチは壁で囲まれたインドアスタジアム形式（ボールは外に出ない）。
   ========================================================================= */

const FIELD = { W: 1700, H: 1020, GOAL_H: 250, GOAL_D: 64, PEN_W: 560, PEN_D: 300 };
const HALF_SECONDS = 90;      // 実時間90秒 = 前半45分
const CROSSBAR = 120;         // ボールのz座標がこれを超えるとゴール上を通過

/* 敵チームの素の能力（power=1.0 が中堅） */
const ENEMY_ARCH = {
  GK: { sho: 16, pas: 56, dri: 34, def: 66, spd: 58, cat: 78 },
  DF: { sho: 44, pas: 60, dri: 46, def: 80, spd: 64, cat: 30 },
  MF: { sho: 62, pas: 76, dri: 70, def: 60, spd: 72, cat: 18 },
  FW: { sho: 80, pas: 58, dri: 76, def: 40, spd: 78, cat: 14 },
};
const ENEMY_HAIR = ['#2b2b33', '#4a3524', '#6b4b2a', '#8d5a3a', '#c9c4d8', '#3a3a4a', '#5c8f3a', '#b2472b'];
const ENEMY_SKIN = ['#f0c49c', '#e5b184', '#d8a274', '#c98d5f', '#a9704a', '#f7d9bd'];
const ENEMY_STYLE = ['short', 'spike', 'mohawk', 'curly', 'bald', 'long', 'bun', 'ponytail'];

function buildEnemySquad(stage) {
  const rnd = mulberry32(stage.id * 7919 + 13);
  const fm = FORMATION_BY_ID[stage.formation];
  const tier = clamp(stage.chapter - 1 + (stage.boss ? 1 : 0), 0, 3);
  const elems = Object.keys(ELEMENTS);
  const maxShooters = stage.diff >= 5 ? 2 : 1;   // 必殺シュート持ちの上限
  let shooters = 0;
  return fm.slots.map((slot, i) => {
    const isAce = (stage.aces || []).includes(i);
    const base = ENEMY_ARCH[slot.role];
    const stats = {};
    for (const k in base) {
      stats[k] = clamp(base[k] * stage.power * (0.94 + rnd() * 0.13) + (isAce ? 9 : 0), 6, 190);
    }
    const elem = isAce ? stage.elem : elems[Math.floor(rnd() * elems.length)];
    let hissatsu = null;
    if (isAce && stage.diff >= 2) {
      let type = slot.role === 'GK' ? 'catch' : slot.role === 'DF' ? 'block' : slot.role === 'FW' ? 'shoot'
        : (rnd() < 0.5 ? 'dribble' : 'shoot');
      if (type === 'shoot') {
        if (shooters >= maxShooters) type = slot.role === 'FW' ? 'dribble' : 'block';
        else shooters++;
      }
      const pool = ENEMY_HISSATSU[type];
      const h = pool[Math.min(pool.length - 1, tier)];
      hissatsu = { name: h.name, type, cost: 45 + tier * 5, power: h.power, fx: h.fx, desc: '' };
    }
    const char = {
      id: `e${stage.id}_${i}`, no: 1 + i * 3 + Math.floor(rnd() * 3), name: stage.roster[i],
      kana: '', rarity: Math.min(5, 2 + tier), elem, pos: slot.role, base: stats, hissatsu,
      look: {
        style: ENEMY_STYLE[Math.floor(rnd() * ENEMY_STYLE.length)],
        hair: ENEMY_HAIR[Math.floor(rnd() * ENEMY_HAIR.length)],
        skin: ENEMY_SKIN[Math.floor(rnd() * ENEMY_SKIN.length)],
        acc: slot.role === 'GK' ? 'glove' : 'none', accColor: ELEMENTS[elem].color,
      },
      bio: '',
    };
    return { name: stage.roster[i], role: slot.role, slot, slotIndex: i, stats, hissatsu, char, elem, isAce,
             rating: ratingFrom(stats, slot.role) };
  });
}

function colorDist(a, b) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
/** ホームと見分けがつかない色なら、相手のユニフォームを差し替える */
function awayKit(homeMain, stageColors) {
  if (colorDist(homeMain, stageColors.main) >= 150) return { main: stageColors.main, sub: stageColors.sub };
  if (colorDist(homeMain, stageColors.sub) >= 150) return { main: stageColors.sub, sub: stageColors.main };
  return { main: '#2f6fd8', sub: '#0e2b52' };
}

/* ===================== 試合本体 ===================== */
const Match = {
  M: null,
  portraitCache: {},

  /* ---------- 準備 ---------- */
  start(stage) {
    const squad = buildSquad().filter(Boolean);
    const enemy = buildEnemySquad(stage);
    const M = {
      stage, half: 1, clock: 0, phase: 'kickoff', phaseT: 0,
      score: { home: 0, away: 0 }, events: [],
      ball: null, players: [], controlled: null, userTeam: 'home',
      camera: { x: FIELD.W / 2, y: FIELD.H / 2, shake: 0 },
      particles: [], trail: [], cutin: null, freeze: 0, slowmo: 0,
      chargeT: 0, switchCd: 0, banner: null, resultShown: false,
      kickoffTeam: 'home', lastScorer: null, superBall: null, replayGuard: 0,
      home: {
        key: 'home', name: G.clubName, short: 'HOME',
        colors: { main: '#ffd23f', sub: '#2a2000' }, isUser: true,
      },
      away: {
        key: 'away', name: stage.name, short: 'AWAY',
        colors: awayKit('#ffd23f', stage.colors), isUser: false,
      },
      difficulty: clamp(0.35 + stage.power * 0.42, 0.3, 1.05),
    };
    this.M = M;

    const fm = FORMATION_BY_ID[G.formation];
    squad.forEach((p) => {
      M.players.push(this.makePlayer({
        team: M.home, char: p.char, name: p.char.name, role: p.slot.role, slot: p.slot,
        stats: p.stats, hissatsu: p.hissatsu, rec: p.rec, id: p.id,
      }));
    });
    enemy.forEach((p) => {
      M.players.push(this.makePlayer({
        team: M.away, char: p.char, name: p.name, role: p.role, slot: p.slot,
        stats: p.stats, hissatsu: p.hissatsu, rec: null, id: p.char.id,
      }));
    });

    M.ball = { x: FIELD.W / 2, y: FIELD.H / 2, z: 0, vx: 0, vy: 0, vz: 0, owner: null, lastTouch: null, cd: 0, spin: 0 };

    $('sb-name-home').textContent = M.home.name;
    $('sb-name-away').textContent = M.away.name;
    $('sb-flag-home').style.background = `linear-gradient(150deg,${M.home.colors.main},${M.home.colors.sub})`;
    $('sb-flag-away').style.background = `linear-gradient(150deg,${M.away.colors.main},${M.away.colors.sub})`;
    $('sb-score-home').textContent = '0';
    $('sb-score-away').textContent = '0';
    $('commentary').innerHTML = '';

    this.buildCrowd();
    this.setupKickoff('home');
    this.say(`${stage.name} との試合開始。`);
    Sound.playBgm('match');
    return M;
  },

  makePlayer(o) {
    const st = o.stats;
    return {
      team: o.team, char: o.char, name: o.name, short: (o.name.split(' ')[0] || o.name),
      role: o.role, slot: o.slot, stats: st, hissatsu: o.hissatsu, rec: o.rec, id: o.id,
      elem: o.char.elem, num: o.char.no,
      x: 0, y: 0, vx: 0, vy: 0, facing: 0, anim: 0,
      sp: 30, stamina: 100, kickCd: 0, tackleCd: 0, stun: 0, dash: false,
      superDribble: 0, hitFlash: 0, dive: 0, decideCd: 0, hissCd: 0, shotCd: 0,
      isGK: o.role === 'GK', goals: 0, actions: 0, tackles: 0, passes: 0,
      holdT: 0,
    };
  },

  /** 攻める方向（+1 なら x が大きい方のゴールを狙う） */
  teamDir(team) {
    const M = this.M;
    const base = team.key === 'home' ? 1 : -1;
    return M.half === 1 ? base : -base;
  },
  attackGoalX(p) { return this.teamDir(p.team) > 0 ? FIELD.W : 0; },
  ownGoalX(p) { return this.teamDir(p.team) > 0 ? 0 : FIELD.W; },
  /** そのゴール（x=0 または x=W）に決めると得点するチーム */
  scoringTeamAt(x) {
    const M = this.M;
    const homeAttacksRight = this.teamDir(M.home) > 0;
    if (x === 0) return homeAttacksRight ? 'away' : 'home';
    return homeAttacksRight ? 'home' : 'away';
  },

  /** 自陣→敵陣の正規化位置から実座標へ */
  formationPos(p) {
    const dir = this.teamDir(p.team);
    const x = dir > 0 ? p.slot.x * FIELD.W : FIELD.W - p.slot.x * FIELD.W;
    const y = p.slot.y * FIELD.H;
    return { x, y };
  },

  setupKickoff(kickTeam) {
    const M = this.M;
    M.kickoffTeam = kickTeam;
    M.players.forEach((p) => {
      const f = this.formationPos(p);
      p.x = f.x; p.y = f.y; p.vx = 0; p.vy = 0;
      p.facing = this.teamDir(p.team) > 0 ? 0 : Math.PI;
      p.stun = 0; p.dive = 0; p.superDribble = 0;
      if (p.team.key !== M.userTeam && p.hissCd <= 0) p.hissCd = rand(38, 16);
      // 自陣側へ引く
      const dir = this.teamDir(p.team);
      p.x = FIELD.W / 2 + (p.x - FIELD.W / 2) * 0.86 - dir * 40;
    });
    // キックオフする側の1人をセンターに
    const taker = M.players.filter((p) => p.team.key === kickTeam && !p.isGK)
      .sort((a, b) => dist2(a.x, a.y, FIELD.W / 2, FIELD.H / 2) - dist2(b.x, b.y, FIELD.W / 2, FIELD.H / 2))[0];
    if (taker) { taker.x = FIELD.W / 2 - this.teamDir(taker.team) * 26; taker.y = FIELD.H / 2; }
    const b = M.ball;
    b.x = FIELD.W / 2; b.y = FIELD.H / 2; b.z = 0; b.vx = b.vy = b.vz = 0; b.owner = null; b.cd = 0;
    M.superBall = null;
    M.phase = 'kickoff'; M.phaseT = 0;
    M.camera.x = FIELD.W / 2; M.camera.y = FIELD.H / 2;
    this.pickControlled(true);
  },

  /* ---------- 操作選手 ---------- */
  pickControlled(force) {
    const M = this.M;
    const mine = M.players.filter((p) => p.team.key === M.userTeam && !p.isGK);
    if (!mine.length) { M.controlled = null; return; }
    const b = M.ball;
    if (b.owner && b.owner.team.key === M.userTeam && !b.owner.isGK) { M.controlled = b.owner; return; }
    if (!force && M.controlled && b.owner && b.owner.team.key === M.userTeam) return;
    let best = null, bd = Infinity;
    mine.forEach((p) => { const d = dist2(p.x, p.y, b.x, b.y); if (d < bd) { bd = d; best = p; } });
    M.controlled = best;
  },
  switchControlled() {
    const M = this.M;
    const mine = M.players.filter((p) => p.team.key === M.userTeam && !p.isGK)
      .sort((a, b) => dist2(a.x, a.y, M.ball.x, M.ball.y) - dist2(b.x, b.y, M.ball.x, M.ball.y));
    if (mine.length < 2) return;
    const i = mine.indexOf(M.controlled);
    M.controlled = mine[(i + 1) % mine.length];
    Sound.sfx('ui');
  },

  /* ---------- 更新 ---------- */
  update(rawDt) {
    const M = this.M;
    if (!M) return;

    // カットイン中は世界を止める
    if (M.cutin) {
      M.cutin.t += rawDt;
      if (M.cutin.t >= M.cutin.dur) { const f = M.cutin.onDone; M.cutin = null; if (f) f(); }
      this.updateCameraFollow(rawDt, true);
      return;
    }
    let dt = Math.min(rawDt, 1 / 30);
    if (M.slowmo > 0) { M.slowmo -= rawDt; dt *= 0.32; }
    const s = dt * 60;

    M.phaseT += dt;
    if (M.camera.shake > 0) M.camera.shake = Math.max(0, M.camera.shake - dt * 34);

    if (M.phase === 'kickoff') {
      if (M.phaseT > 1.1) {
        M.phase = 'play'; M.phaseT = 0;
        Sound.sfx('whistle');
        const taker = M.players.filter((p) => p.team.key === M.kickoffTeam && !p.isGK)
          .sort((a, b) => dist2(a.x, a.y, FIELD.W / 2, FIELD.H / 2) - dist2(b.x, b.y, FIELD.W / 2, FIELD.H / 2))[0];
        if (taker) { M.ball.owner = taker; M.ball.lastTouch = taker; }
        this.pickControlled(true);
      }
    } else if (M.phase === 'goal') {
      if (M.phaseT > 2.8) {
        if (M.clock >= HALF_SECONDS) this.endHalf();
        else this.setupKickoff(M.lastScorer === 'home' ? 'away' : 'home');
      }
    } else if (M.phase === 'play') {
      M.clock += dt;
      if (M.clock >= HALF_SECONDS) { this.endHalf(); }
    }

    if (M.phase === 'play' || M.phase === 'kickoff' || M.phase === 'goal') {
      const live = M.phase === 'play';
      M.players.forEach((p) => this.updatePlayer(p, dt, s, live));
      if (live) this.updateBall(dt, s);
      this.updateParticles(dt);
    }
    this.updateCameraFollow(dt, false);
    this.updateHud();
  },

  updateCameraFollow(dt, frozen) {
    const M = this.M;
    const b = M.ball;
    const tx = b.owner ? b.owner.x : b.x;
    const ty = b.owner ? b.owner.y : b.y;
    const lead = b.owner ? 0 : clamp(b.vx * 10, -150, 150);
    const k = frozen ? 0.04 : 0.09;
    M.camera.x = lerp(M.camera.x, tx + lead, k);
    M.camera.y = lerp(M.camera.y, ty, k);
  },

  /* ---------- 選手 ---------- */
  updatePlayer(p, dt, s, live) {
    const M = this.M;
    p.anim += Math.hypot(p.vx, p.vy) * 0.16 * s;
    p.kickCd = Math.max(0, p.kickCd - dt);
    p.tackleCd = Math.max(0, p.tackleCd - dt);
    p.decideCd = Math.max(0, p.decideCd - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt * 3);
    p.superDribble = Math.max(0, p.superDribble - dt);
    p.dive = Math.max(0, p.dive - dt);
    p.sp = Math.min(100, p.sp + (live ? 4.2 : 2) * dt);
    p.hissCd = Math.max(0, (p.hissCd || 0) - dt);
    p.shotCd = Math.max(0, (p.shotCd || 0) - dt);
    if (p.stun > 0) { p.stun -= dt; p.vx *= 0.86; p.vy *= 0.86; p.x += p.vx * s; p.y += p.vy * s; this.clampPlayer(p); return; }

    let ax = 0, ay = 0, dashing = false;
    const isUser = live && p === M.controlled;

    if (isUser) {
      const a = Input.axis();
      ax = a.x; ay = a.y;
      dashing = Input.act.c && p.stamina > 4;
      this.userActions(p, dt);
    } else if (live) {
      const mv = p.isGK ? this.gkBrain(p, dt) : this.aiBrain(p, dt);
      ax = mv.x; ay = mv.y; dashing = mv.dash;
    } else {
      // キックオフ/ゴール演出中は定位置へ戻る
      const f = this.formationPos(p);
      const d = dist(p.x, p.y, f.x, f.y);
      if (d > 12) { ax = (f.x - p.x) / d * 0.7; ay = (f.y - p.y) / d * 0.7; }
    }

    const staminaK = p.stamina < 22 ? 0.74 : p.stamina < 50 ? 0.9 : 1;
    let maxSp = (2.35 + p.stats.spd / 100 * 2.1) * staminaK;
    if (dashing) { maxSp *= 1.34; p.stamina = Math.max(0, p.stamina - 22 * dt); }
    else p.stamina = Math.min(100, p.stamina + 9 * dt);
    if (p.superDribble > 0) maxSp *= 1.34;
    if (p.isGK) maxSp *= 1.28;
    if (p.dive > 0) maxSp *= 2.1;
    if (M.ball.owner === p) maxSp *= 0.94;

    const len = Math.hypot(ax, ay);
    if (len > 1) { ax /= len; ay /= len; }
    const accel = 0.30 * s;
    p.vx = lerp(p.vx, ax * maxSp, accel);
    p.vy = lerp(p.vy, ay * maxSp, accel);
    if (len > 0.15) p.facing = Math.atan2(p.vy, p.vx);
    p.x += p.vx * s; p.y += p.vy * s;
    this.clampPlayer(p);

    // 走った跡
    if (Math.hypot(p.vx, p.vy) > 3.4 && Math.random() < 0.3) {
      this.spawn(p.x, p.y, { vx: -p.vx * 0.1, vy: -p.vy * 0.1, life: 0.35, size: 3, color: 'rgba(220,235,210,.5)', type: 'dust' });
    }
    if (p.superDribble > 0) {
      const el = ELEMENTS[p.elem];
      this.spawn(p.x, p.y, { vx: rand(1, -1), vy: rand(1, -1), life: 0.4, size: 7, color: el.color, type: 'spark' });
      // 触れた相手を弾き飛ばす
      M.players.forEach((q) => {
        if (q.team === p.team || q.stun > 0) return;
        if (dist2(p.x, p.y, q.x, q.y) < 34 * 34) {
          const a = Math.atan2(q.y - p.y, q.x - p.x);
          q.vx = Math.cos(a) * 9; q.vy = Math.sin(a) * 9; q.stun = 0.55; q.hitFlash = 1;
          M.camera.shake = Math.max(M.camera.shake, 7);
          Sound.sfx('tackle');
        }
      });
    }
  },

  clampPlayer(p) {
    p.x = clamp(p.x, 14, FIELD.W - 14);
    p.y = clamp(p.y, 14, FIELD.H - 14);
  },

  /* ---------- プレイヤー操作 ---------- */
  userActions(p, dt) {
    const M = this.M;
    const b = M.ball;
    const hasBall = b.owner === p;

    if (Input.pressed('sw') && M.switchCd <= 0) { M.switchCd = 0.25; this.switchControlled(); }
    M.switchCd = Math.max(0, M.switchCd - dt);

    if (Input.pressed('d')) this.tryHissatsu(p);

    if (hasBall) {
      if (Input.act.b) { M.chargeT = Math.min(1, M.chargeT + dt / 0.62); }
      else if (M.chargeT > 0) { this.shoot(p, Math.max(0.42, M.chargeT)); M.chargeT = 0; }
      if (Input.pressed('a')) this.pass(p);
    } else {
      M.chargeT = 0;
      if (Input.pressed('b') || Input.pressed('a')) this.tackle(p);
    }
  },

  /* ---------- キック ---------- */
  releaseBall(p) {
    const M = this.M;
    M.ball.owner = null;
    M.ball.lastTouch = p;
    M.ball.cd = 0.06;
    p.kickCd = 0.25;
  },

  pass(p) {
    const M = this.M;
    const b = M.ball;
    const mates = M.players.filter((q) => q.team === p.team && q !== p);
    if (!mates.length) return;
    const dir = this.teamDir(p.team);
    let best = null, bestScore = -Infinity;
    mates.forEach((q) => {
      const d = dist(p.x, p.y, q.x, q.y);
      if (d < 40 || d > 900) return;
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      const align = 1 - Math.abs(angDiff(a, p.facing)) / Math.PI;   // 向いている方向を優先
      const forward = ((q.x - p.x) * dir) / FIELD.W;
      // パスコースに敵がいないか
      let blocked = 0;
      M.players.forEach((o) => {
        if (o.team === p.team) return;
        const t = clamp(((o.x - p.x) * (q.x - p.x) + (o.y - p.y) * (q.y - p.y)) / (d * d), 0, 1);
        const px = p.x + (q.x - p.x) * t, py = p.y + (q.y - p.y) * t;
        if (dist2(o.x, o.y, px, py) < 62 * 62) blocked += 1;
      });
      const score = align * 2.2 + forward * 1.6 - blocked * 1.3 - d / 1400 + (q.isGK ? -1.6 : 0);
      if (score > bestScore) { bestScore = score; best = q; }
    });
    if (!best) return;
    const d = dist(p.x, p.y, best.x, best.y);
    const acc = p.stats.pas / 100;
    const spread = (1 - acc) * 0.14;
    const a = Math.atan2(best.y - p.y, best.x - p.x) + rand(spread, -spread);
    const power = clamp(d / 42, 7, 15) * (0.86 + acc * 0.24);
    b.vx = Math.cos(a) * power; b.vy = Math.sin(a) * power;
    b.vz = d > 420 ? 2.4 : 0.6;
    b.shotPower = 0;
    this.releaseBall(p);
    p.passes++; p.actions++;
    Sound.sfx('pass');
    this.spawn(b.x, b.y, { life: 0.3, size: 12, color: 'rgba(255,255,255,.5)', type: 'ring' });
  },

  shoot(p, charge) {
    const M = this.M;
    const b = M.ball;
    const gx = this.attackGoalX(p);
    const acc = p.stats.sho / 100;
    // 狙う位置。入力で上下に振れる
    let aimY = FIELD.H / 2;
    if (p === M.controlled) {
      const a = Input.axis();
      aimY += a.y * FIELD.GOAL_H * 0.55;
    } else {
      aimY += rand(FIELD.GOAL_H * 0.52, -FIELD.GOAL_H * 0.52);
    }
    const d = dist(p.x, p.y, gx, aimY);
    const missK = (1.12 - acc) * clamp(d / 780, 0.3, 1.5);
    aimY += rand(230, -230) * missK;
    const a = Math.atan2(aimY - b.y, gx - b.x);
    const power = (10 + acc * 7) * (0.55 + charge * 0.55);
    b.vx = Math.cos(a) * power; b.vy = Math.sin(a) * power;
    b.vz = 1.0 + charge * 2.4 + (d > 700 ? 1.4 : 0);
    b.shotPower = 0.55 + acc * 0.95 * charge;
    this.releaseBall(p);
    p.actions++;
    Sound.sfx('shoot');
    M.camera.shake = Math.max(M.camera.shake, 3 + charge * 4);
    for (let i = 0; i < 8; i++) {
      this.spawn(b.x, b.y, { vx: -Math.cos(a) * rand(4, 1), vy: -Math.sin(a) * rand(4, 1), life: 0.4, size: 4, color: '#fff', type: 'spark' });
    }
  },

  tackle(p) {
    const M = this.M;
    if (p.tackleCd > 0) return;
    p.tackleCd = 0.9;
    const b = M.ball;
    const target = b.owner;
    // 近くにボール保持者がいれば奪いにいく
    if (target && target.team !== p.team && dist2(p.x, p.y, target.x, target.y) < 52 * 52) {
      if (target.superDribble > 0) {
        p.stun = 0.5; p.hitFlash = 1;
        Sound.sfx('tackle');
        return;
      }
      // ドリブル側をやや有利にして、細かい奪い合いで試合が止まらないようにする
      const atk = target.stats.dri * (1.0 + Math.random() * 0.55);
      const def = p.stats.def * (0.68 + Math.random() * 0.6);
      if (def > atk) {
        b.owner = p; b.lastTouch = p; b.cd = 0.14;
        p.tackles++; p.actions += 2;
        p.sp = Math.min(100, p.sp + 12);
        target.stun = 0.35; target.hitFlash = 1;
        Sound.sfx('tackle');
        M.camera.shake = Math.max(M.camera.shake, 5);
        this.spawn(p.x, p.y, { life: 0.35, size: 20, color: 'rgba(255,255,255,.6)', type: 'ring' });
        if (p.team.key === M.userTeam) this.say(`${p.short} がボールを奪った！`);
      } else {
        p.stun = 0.28;
        this.spawn(p.x, p.y, { life: 0.3, size: 14, color: 'rgba(255,120,120,.5)', type: 'ring' });
      }
      return;
    }
    // こぼれ球なら突っ込む
    if (!b.owner && dist2(p.x, p.y, b.x, b.y) < 60 * 60 && b.cd <= 0) {
      b.owner = p; b.lastTouch = p; p.actions++;
      Sound.sfx('kick');
    }
  },

  /* ---------- 必殺技 ---------- */
  tryHissatsu(p) {
    const M = this.M;
    const h = p.hissatsu;
    if (!h) { if (p === M.controlled) { Sound.sfx('error'); this.say('この選手は必殺技を持っていない'); } return false; }
    if (p.sp < h.cost) { if (p === M.controlled) { Sound.sfx('error'); this.say(`SPが足りない（${Math.floor(p.sp)} / ${h.cost}）`); } return false; }
    const b = M.ball;
    if (h.type === 'shoot') {
      if (b.owner !== p) { if (p === M.controlled) { Sound.sfx('error'); this.say('ボールを持っているときに使える'); } return false; }
      const d = Math.abs(this.attackGoalX(p) - p.x);
      if (d > 900) { if (p === M.controlled) { Sound.sfx('error'); this.say('ゴールから遠すぎる'); } return false; }
      p.sp -= h.cost;
      this.cutin(p, h, () => this.superShot(p, h));
      return true;
    }
    if (h.type === 'dribble') {
      if (b.owner !== p) { if (p === M.controlled) { Sound.sfx('error'); this.say('ボールを持っているときに使える'); } return false; }
      p.sp -= h.cost;
      this.cutin(p, h, () => {
        p.superDribble = 1.7;
        Sound.sfx('hissatsu');
        M.camera.shake = 8;
      });
      return true;
    }
    if (h.type === 'block') {
      const superNear = M.superBall && dist2(b.x, b.y, p.x, p.y) < 190 * 190 && b.lastTouch && b.lastTouch.team !== p.team;
      const holder = b.owner && b.owner.team !== p.team && dist2(p.x, p.y, b.owner.x, b.owner.y) < 170 * 170 ? b.owner : null;
      const looseNear = !b.owner && dist2(p.x, p.y, b.x, b.y) < 150 * 150;
      if (!superNear && !holder && !looseNear) {
        if (p === M.controlled) { Sound.sfx('error'); this.say('近くに止める相手がいない'); }
        return false;
      }
      p.sp -= h.cost;
      this.cutin(p, h, () => this.superBlock(p, h));
      return true;
    }
    if (h.type === 'catch') {
      if (!p.isGK) {
        if (p === M.controlled) { Sound.sfx('error'); this.say('キャッチ技はGKのときだけ使える'); }
        return false;
      }
      p.sp -= h.cost;
      this.cutin(p, h, () => this.superCatch(p, h));
      return true;
    }
    return false;
  },

  elemFactor(a, b) {
    if (!a || !b) return 1;
    if ((ELEM_BEATS[a] || []).includes(b)) return 1 + ELEM_ADVANTAGE;
    if ((ELEM_BEATS[b] || []).includes(a)) return 1 - ELEM_ADVANTAGE;
    return 1;
  },

  superShot(p, h) {
    const M = this.M;
    const b = M.ball;
    const gx = this.attackGoalX(p);
    let aimY = FIELD.H / 2;
    if (p === M.controlled) aimY += Input.axis().y * FIELD.GOAL_H * 0.4;
    else aimY += rand(FIELD.GOAL_H * 0.3, -FIELD.GOAL_H * 0.3);
    const a = Math.atan2(aimY - b.y, gx - b.x);
    const power = h.power * (1 + p.stats.sho / 400);
    b.vx = Math.cos(a) * (20 + power * 2.6);
    b.vy = Math.sin(a) * (20 + power * 2.6);
    b.vz = 0.9;
    b.shotPower = power;
    M.superBall = { power, elem: p.elem, name: h.name, fx: h.fx, owner: p, dist: 0 };
    this.releaseBall(p);
    p.actions += 3;
    Sound.sfx('hissatsu');
    M.camera.shake = 14; M.slowmo = 0.5;
    this.banner(h.name, `${p.name}`);
    for (let i = 0; i < 26; i++) {
      this.spawn(b.x, b.y, {
        vx: rand(7, -7), vy: rand(7, -7), life: rand(0.7, 0.3), size: rand(9, 3),
        color: ELEMENTS[p.elem].color, type: 'spark',
      });
    }
  },

  superBlock(p, h) {
    const M = this.M;
    const b = M.ball;
    const power = h.power * (1 + p.stats.def / 260);
    Sound.sfx('clash');
    M.camera.shake = 12;
    this.spawn(p.x, p.y, { life: 0.6, size: 90, color: ELEMENTS[p.elem].color, type: 'shock' });
    this.banner(h.name, p.name);

    if (M.superBall && dist2(b.x, b.y, p.x, p.y) < 220 * 220) {
      const sp = M.superBall.power * this.elemFactor(M.superBall.elem, p.elem);
      if (power >= sp) {
        M.superBall = null; b.shotPower = 0;
        b.vx *= -0.18; b.vy *= -0.18; b.vz = 1.5;
        b.owner = null; b.lastTouch = p; b.cd = 0.2;
        this.say(`${p.short} が ${h.name} で必殺シュートを止めた！`);
        this.spawn(b.x, b.y, { life: 0.7, size: 130, color: '#fff', type: 'shock' });
      } else {
        M.superBall.power *= 0.62; b.shotPower *= 0.62;
        b.vx *= 0.78; b.vy *= 0.78;
        p.stun = 0.6; p.hitFlash = 1;
        this.say(`${h.name}、押し負けた！`);
      }
      return;
    }
    // 通常の奪取
    const holder = b.owner;
    if (holder && holder.team !== p.team && dist2(p.x, p.y, holder.x, holder.y) < 190 * 190) {
      b.owner = p; b.lastTouch = p; b.cd = 0.12;
      holder.stun = 0.7; holder.hitFlash = 1; holder.superDribble = 0;
      p.tackles++; p.actions += 2;
      this.say(`${p.short} が ${h.name} で完全に止めた！`);
    } else if (!b.owner && dist2(p.x, p.y, b.x, b.y) < 190 * 190) {
      b.owner = p; b.lastTouch = p; b.cd = 0.12;
    }
    M.players.forEach((q) => {
      if (q.team === p.team) return;
      if (dist2(p.x, p.y, q.x, q.y) < 170 * 170) { q.stun = Math.max(q.stun, 0.4); q.hitFlash = 1; }
    });
  },

  superCatch(gk, h) {
    const M = this.M;
    const b = M.ball;
    const power = h.power * (1 + gk.stats.cat / 240);
    Sound.sfx('clash');
    M.camera.shake = 13;
    this.banner(h.name, gk.name);
    this.spawn(gk.x, gk.y, { life: 0.7, size: 110, color: ELEMENTS[gk.elem].color, type: 'shock' });
    const sb = M.superBall;
    const shotP = sb ? sb.power * this.elemFactor(sb.elem, gk.elem) : (b.shotPower || 0.6);
    if (power >= shotP) {
      b.owner = gk; b.lastTouch = gk; b.vx = b.vy = b.vz = 0; b.z = 0;
      M.superBall = null; b.shotPower = 0;
      gk.holdT = 1.0; gk.actions += 3;
      this.say(`${gk.short} が ${h.name} で受け止めた！`);
      this.spawn(b.x, b.y, { life: 0.8, size: 150, color: '#fff', type: 'shock' });
    } else {
      gk.stun = 0.8; gk.hitFlash = 1;
      if (sb) sb.power *= 0.75;
      b.shotPower *= 0.75;
      b.vx *= 0.9; b.vy *= 0.9;
      this.say(`${h.name} を吹き飛ばした！`);
    }
  },

  /* ---------- カットイン ---------- */
  cutin(p, h, onDone) {
    const M = this.M;
    M.cutin = { p, h, t: 0, dur: 1.15, onDone };
    Sound.sfx('hissatsu');
  },

  /* ---------- ボール ---------- */
  updateBall(dt, s) {
    const M = this.M;
    const b = M.ball;
    b.cd = Math.max(0, b.cd - dt);

    if (b.owner) {
      const o = b.owner;
      if (o.isGK && o.holdT > 0) {
        o.holdT -= dt;
        b.x = o.x + Math.cos(o.facing) * 14; b.y = o.y + Math.sin(o.facing) * 14; b.z = 14;
        if (o.holdT <= 0) this.pass(o);
        return;
      }
      const lead = 17 + Math.hypot(o.vx, o.vy) * 2.6;
      const tx = o.x + Math.cos(o.facing) * lead;
      const ty = o.y + Math.sin(o.facing) * lead;
      b.x = lerp(b.x, tx, 0.42); b.y = lerp(b.y, ty, 0.42);
      b.z = Math.max(0, b.z - 2 * s);
      b.spin += Math.hypot(o.vx, o.vy) * 0.06 * s;
      M.trail.length = 0;
      return;
    }

    b.x += b.vx * s; b.y += b.vy * s;
    b.z += b.vz * s; b.vz -= 0.30 * s;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -0.5) { b.vz = -b.vz * 0.52; Sound.sfx('kick'); }
      else b.vz = 0;
      b.vx *= Math.pow(0.982, s); b.vy *= Math.pow(0.982, s);
    } else {
      b.vx *= Math.pow(0.996, s); b.vy *= Math.pow(0.996, s);
    }
    b.spin += Math.hypot(b.vx, b.vy) * 0.05 * s;

    if (M.superBall) {
      M.superBall.dist += Math.hypot(b.vx, b.vy) * s;
      const el = ELEMENTS[M.superBall.elem];
      for (let i = 0; i < 2; i++) {
        this.spawn(b.x + rand(8, -8), b.y + rand(8, -8), {
          vx: rand(1.5, -1.5), vy: rand(1.5, -1.5), life: rand(0.5, 0.25), size: rand(11, 5),
          color: el.color, type: 'spark',
        });
      }
      if (Math.hypot(b.vx, b.vy) < 5) M.superBall = null;
    }

    // 軌跡
    M.trail.push({ x: b.x, y: b.y, z: b.z });
    if (M.trail.length > 16) M.trail.shift();

    // 壁
    if (b.y < 12) { b.y = 12; b.vy = Math.abs(b.vy) * 0.68; Sound.sfx('kick'); }
    if (b.y > FIELD.H - 12) { b.y = FIELD.H - 12; b.vy = -Math.abs(b.vy) * 0.68; Sound.sfx('kick'); }

    const inMouth = Math.abs(b.y - FIELD.H / 2) < FIELD.GOAL_H / 2;
    if (b.x < 10) {
      if (inMouth && b.z < CROSSBAR) { this.goal(this.scoringTeamAt(0)); return; }
      b.x = 10; b.vx = Math.abs(b.vx) * 0.68;
      if (inMouth) Sound.sfx('post');
    }
    if (b.x > FIELD.W - 10) {
      if (inMouth && b.z < CROSSBAR) { this.goal(this.scoringTeamAt(FIELD.W)); return; }
      b.x = FIELD.W - 10; b.vx = -Math.abs(b.vx) * 0.68;
      if (inMouth) Sound.sfx('post');
    }

    // 保持判定
    if (b.cd <= 0 && b.z < 46) {
      let best = null, bd = Infinity;
      M.players.forEach((p) => {
        if (p.stun > 0 || p.kickCd > 0) return;
        const r = p.isGK ? 30 + p.stats.cat / 100 * 30 + (p.dive > 0 ? 26 : 0) : 20 + p.stats.dri / 100 * 8;
        const d = dist2(p.x, p.y, b.x, b.y);
        if (d < r * r && d < bd) { bd = d; best = p; }
      });
      if (best) this.gainBall(best);
    }
  },

  gainBall(p) {
    const M = this.M;
    const b = M.ball;
    // 必殺シュートは並のキーパーでは掴めない
    if (M.superBall && M.superBall.owner.team !== p.team) {
      if (p.isGK) {
        const gp = (0.55 + p.stats.cat / 100 * 1.6 + (p.dive > 0 ? 0.5 : 0)) * rand(1.15, 0.85);
        if (gp < M.superBall.power) {
          // はじき返すのが精一杯
          p.stun = 0.5; p.hitFlash = 1;
          M.superBall.power *= 0.8;
          b.vx *= 0.86; b.vy *= 0.86;
          Sound.sfx('clash');
          this.spawn(b.x, b.y, { life: 0.5, size: 70, color: '#fff', type: 'shock' });
          return;
        }
      } else {
        p.stun = 0.55; p.hitFlash = 1;
        M.superBall.power *= 0.9;
        b.vx *= 0.94; b.vy *= 0.94;
        this.spawn(b.x, b.y, { life: 0.4, size: 46, color: '#fff', type: 'shock' });
        return;
      }
    }
    // 強いシュートは弾くことがある
    if (!p.isGK && b.shotPower > 1.05 && Math.random() < 0.35) {
      const a = Math.atan2(b.vy, b.vx) + rand(1.2, -1.2);
      b.vx = Math.cos(a) * 6; b.vy = Math.sin(a) * 6; b.cd = 0.18; b.lastTouch = p;
      return;
    }
    if (p.isGK && b.shotPower > 0.9 && Math.random() > p.stats.cat / 130) {
      const a = Math.atan2(b.y - FIELD.H / 2, b.x - this.ownGoalX(p)) + rand(0.5, -0.5);
      b.vx = Math.cos(a) * 8; b.vy = Math.sin(a) * 8; b.cd = 0.25; b.lastTouch = p;
      Sound.sfx('save');
      this.say(`${p.short} がはじき出す！`);
      M.superBall = null;
      return;
    }
    b.owner = p; b.lastTouch = p; b.shotPower = 0;
    M.superBall = null;
    M.trail.length = 0;
    if (p.isGK) {
      p.holdT = 0.85;
      Sound.sfx('save');
      p.actions += 2;
      if (b.shotPower) this.say(`${p.short} がキャッチ！`);
    }
    p.actions++;
    this.pickControlled(false);
  },

  /* ---------- 得点 ---------- */
  goal(teamKey) {
    const M = this.M;
    const b = M.ball;
    const scorer = b.lastTouch;
    const withSuper = !!M.superBall;
    M.score[teamKey]++;
    M.lastScorer = teamKey;
    M.phase = 'goal'; M.phaseT = 0;
    M.superBall = null;
    b.vx = b.vy = 0; b.vz = 0;
    M.camera.shake = 16;
    Sound.sfx('goal'); Sound.sfx('crowd');
    if (scorer) { scorer.goals++; scorer.actions += 5; scorer.sp = Math.min(100, scorer.sp + 30); }
    const min = this.displayMinute();
    M.events.push({ team: teamKey, name: scorer ? scorer.name : '？', minute: min, own: scorer && scorer.team.key !== teamKey, superShot: withSuper });
    if (teamKey === M.userTeam && withSuper) G.stats.hissatsuGoals++;

    const el = $(teamKey === 'home' ? 'sb-score-home' : 'sb-score-away');
    el.textContent = M.score[teamKey];
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');

    this.banner('GOAL!!', scorer ? `${min}' ${scorer.name}` : '');
    this.say(teamKey === M.userTeam ? `ゴーール！ ${scorer ? scorer.name : ''}！` : `失点… ${scorer ? scorer.name : ''} に決められた`);
    for (let i = 0; i < 70; i++) {
      this.spawn(b.x, b.y, {
        vx: rand(9, -9), vy: rand(9, -9), vz: rand(6, 1), life: rand(1.6, 0.7), size: rand(7, 2),
        color: pick(['#ffd23f', '#fff', '#ff7ea8', '#3ddc97', '#35e0ff']), type: 'confetti',
      });
    }
  },

  displayMinute() {
    const M = this.M;
    const base = M.half === 1 ? 0 : 45;
    return Math.min(90, Math.floor(base + (M.clock / HALF_SECONDS) * 45));
  },

  endHalf() {
    const M = this.M;
    Sound.sfx('whistle');
    if (M.half === 1) {
      M.phase = 'half';
      M.half = 2; M.clock = 0;
      Main.showHalftime();
    } else {
      M.phase = 'end';
      Main.finishMatch();
    }
  },

  /* ---------- AI ---------- */
  aiBrain(p, dt) {
    const M = this.M;
    const b = M.ball;
    const dir = this.teamDir(p.team);
    const diff = M.difficulty;
    const out = { x: 0, y: 0, dash: false };

    const seek = (tx, ty, dash) => {
      const d = dist(p.x, p.y, tx, ty);
      if (d < 6) return;
      out.x = (tx - p.x) / d; out.y = (ty - p.y) / d;
      out.dash = !!dash && p.stamina > 25;
    };

    if (b.owner === p) {
      // --- ボール保持 ---
      const gx = this.attackGoalX(p);
      const gd = dist(p.x, p.y, gx, FIELD.H / 2);
      const pressure = M.players.filter((o) => o.team !== p.team && dist2(o.x, o.y, p.x, p.y) < 110 * 110).length;

      if (p.decideCd <= 0) {
        p.decideCd = 0.16 + (1 - diff) * 0.28;
        // 必殺技（連発しないようにクールタイムを持たせる）
        if (p.hissatsu && p.sp >= p.hissatsu.cost && p.hissCd <= 0 && Math.random() < 0.34 * diff) {
          if (p.hissatsu.type === 'shoot' && gd < 620) { p.hissCd = rand(80, 55); this.tryHissatsu(p); return out; }
          if (p.hissatsu.type === 'dribble' && pressure >= 1) { p.hissCd = rand(52, 34); this.tryHissatsu(p); return out; }
        }
        // シュート
        const shootRange = 250 + p.stats.sho * 2.4;
        if (gd < shootRange && Math.abs(p.y - FIELD.H / 2) < 380 && p.shotCd <= 0) {
          if (Math.random() < 0.28 * diff + (gd < 280 ? 0.28 : 0)) {
            p.shotCd = rand(2.0, 1.1);
            this.shoot(p, clamp(gd / shootRange, 0.5, 1));
            return out;
          }
        }
        // パス
        if (pressure >= 1 && Math.random() < 0.45 + 0.35 * diff) { this.pass(p); return out; }
        if (Math.random() < 0.12) { this.pass(p); return out; }
      }
      // ドリブル：ゴール方向へ、目の前の相手を避ける
      let tx = gx, ty = FIELD.H / 2 + (p.y - FIELD.H / 2) * 0.35;
      let near = null, nd = Infinity;
      M.players.forEach((o) => {
        if (o.team === p.team) return;
        const d = dist2(o.x, o.y, p.x, p.y);
        if (d < nd && d < 170 * 170) { nd = d; near = o; }
      });
      if (near) {
        const away = Math.atan2(p.y - near.y, p.x - near.x);
        tx += Math.cos(away) * 170; ty += Math.sin(away) * 190;
      }
      seek(tx, ty, pressure > 0);
      return out;
    }

    const teamHas = b.owner && b.owner.team === p.team;
    const ballOwnedByOpp = b.owner && b.owner.team !== p.team;

    if (teamHas) {
      // --- 攻撃時のサポート：ボールが敵陣に入るほど、役割ごとの最前線まで押し上げる ---
      const f = this.formationPos(p);
      const prog = clamp(((b.x - this.ownGoalX(p)) * dir) / FIELD.W, 0, 1);
      const front = p.role === 'FW' ? 0.94 : p.role === 'MF' ? 0.80 : 0.52;
      const norm = lerp(p.slot.x, front, clamp(prog * 1.15, 0, 1));
      const tx = dir > 0 ? norm * FIELD.W : FIELD.W - norm * FIELD.W;
      const ty = lerp(f.y, b.y, p.role === 'DF' ? 0.16 : 0.34);
      seek(clamp(tx, 60, FIELD.W - 60), clamp(ty, 60, FIELD.H - 60), prog > 0.5 && p.role !== 'DF');
      return out;
    }

    // --- 守備・ルーズボール ---
    const mates = M.players.filter((q) => q.team === p.team && !q.isGK);
    const sorted = mates.slice().sort((a, c) => dist2(a.x, a.y, b.x, b.y) - dist2(c.x, c.y, b.x, b.y));
    const rank = sorted.indexOf(p);
    const chaseN = ballOwnedByOpp ? 2 : 2;

    if (rank < chaseN) {
      // 追う
      const tx = b.x + b.vx * 6, ty = b.y + b.vy * 6;
      seek(tx, ty, true);
      if (ballOwnedByOpp && dist2(p.x, p.y, b.owner.x, b.owner.y) < 46 * 46 && p.tackleCd <= 0) {
        if (Math.random() < 0.22 + diff * 0.4) this.tackle(p);
      }
      if (!b.owner && dist2(p.x, p.y, b.x, b.y) < 40 * 40) this.tackle(p);
      // ブロック技
      if (p.hissatsu && p.hissatsu.type === 'block' && p.sp >= p.hissatsu.cost && p.decideCd <= 0 && p.hissCd <= 0) {
        p.decideCd = 0.4;
        const threat = M.superBall && M.superBall.owner.team !== p.team && dist2(b.x, b.y, p.x, p.y) < 200 * 200;
        if (threat || (ballOwnedByOpp && dist2(p.x, p.y, b.owner.x, b.owner.y) < 130 * 130 && Math.random() < 0.3 * diff)) {
          p.hissCd = rand(60, 40);
          this.tryHissatsu(p);
        }
      }
      return out;
    }

    // 守備時：ボールが自陣に近いほど下がって陣形を作る
    const f = this.formationPos(p);
    const prog = clamp(((b.x - this.ownGoalX(p)) * dir) / FIELD.W, 0, 1);
    const back = p.role === 'DF' ? 0.16 : p.role === 'MF' ? 0.30 : 0.46;
    const norm = lerp(back, Math.max(p.slot.x, back), clamp(prog * 1.2, 0, 1));
    const tx = dir > 0 ? norm * FIELD.W : FIELD.W - norm * FIELD.W;
    const ty = lerp(f.y, b.y, p.role === 'DF' ? 0.42 : 0.3);
    seek(clamp(tx, 50, FIELD.W - 50), clamp(ty, 50, FIELD.H - 50), false);
    return out;
  },

  gkBrain(gk, dt) {
    const M = this.M;
    const b = M.ball;
    const gx = this.ownGoalX(gk);
    const gy = FIELD.H / 2;
    const inward = gx === 0 ? 1 : -1;
    const out = { x: 0, y: 0, dash: false };

    if (b.owner === gk) return out;

    const toGoal = Math.abs(b.x - gx);
    const heading = (gx === 0 ? b.vx < -0.6 : b.vx > 0.6) && !b.owner;

    // 必殺キャッチ
    if (gk.hissatsu && gk.hissatsu.type === 'catch' && gk.sp >= gk.hissatsu.cost && M.superBall
        && M.superBall.owner.team !== gk.team && toGoal < 520 && heading) {
      this.tryHissatsu(gk);
      return out;
    }

    // 角度を消す立ち位置（ボールとゴール中央を結ぶ線上）
    const stand = clamp(46 + (1 - clamp(toGoal / 800, 0, 1)) * 78, 46, 124);
    let tx = gx + inward * stand;
    let ty = gy + (b.y - gy) * (stand / Math.max(toGoal, stand + 1));
    ty = clamp(ty, gy - FIELD.GOAL_H / 2 - 26, gy + FIELD.GOAL_H / 2 + 26);

    if (heading && toGoal < 760) {
      // シュートコースの予測地点へ寄せる
      const t = (tx - b.x) / (b.vx || 0.001);
      const py = b.y + b.vy * clamp(t, 0, 90);
      ty = clamp(py, gy - FIELD.GOAL_H / 2 - 34, gy + FIELD.GOAL_H / 2 + 34);
      if (toGoal < 460 && gk.dive <= 0 && gk.tackleCd <= 0) { gk.dive = 0.45; gk.tackleCd = 0.5; }
    } else if (toGoal < 260 && !b.owner) {
      tx = b.x; ty = b.y;                            // 前に出て処理する
    }

    const d = dist(gk.x, gk.y, tx, ty);
    if (d > 4) { out.x = (tx - gk.x) / d; out.y = (ty - gk.y) / d; }
    out.dash = toGoal < 520;
    return out;
  },

  /* ---------- 演出 ---------- */
  spawn(x, y, o) {
    const M = this.M;
    if (M.particles.length > 620) return;
    M.particles.push({
      x, y, z: o.z || 0, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life || 0.5, max: o.life || 0.5, size: o.size || 4,
      color: o.color || '#fff', type: o.type || 'spark',
    });
  },
  updateParticles(dt) {
    const M = this.M;
    for (let i = M.particles.length - 1; i >= 0; i--) {
      const p = M.particles[i];
      p.life -= dt;
      if (p.life <= 0) { M.particles.splice(i, 1); continue; }
      p.x += p.vx * dt * 60; p.y += p.vy * dt * 60;
      if (p.type === 'confetti') { p.z += p.vz * dt * 60; p.vz -= 0.22 * dt * 60; if (p.z < 0) { p.z = 0; p.vz = 0; p.vx *= 0.9; p.vy *= 0.9; } }
      p.vx *= 0.96; p.vy *= 0.96;
    }
  },
  banner(main, sub) {
    const el = $('event-banner');
    el.innerHTML = `<span class="eb-main">${main}</span>${sub ? `<span class="eb-sub">${sub}</span>` : ''}`;
    el.classList.remove('hidden');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => el.classList.add('hidden'), 1900);
  },
  say(text) {
    const box = $('commentary');
    const d = document.createElement('div');
    d.className = 'cmt'; d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 400); }, 2600);
  },

  updateHud() {
    const M = this.M;
    $('sb-half').textContent = M.half === 1 ? '前半' : '後半';
    $('sb-time').textContent = `${this.displayMinute()}'`;
    const p = M.controlled;
    if (!p) return;
    $('pc-pos').textContent = p.role;
    $('pc-pos').style.background = POSITIONS[p.role].color;
    $('pc-name').textContent = p.name;
    $('pc-elem').textContent = ELEMENTS[p.elem].icon;
    const spFull = p.hissatsu && p.sp >= p.hissatsu.cost;
    $('pc-sp-fill').style.width = `${p.sp}%`;
    $('pc-sp-fill').parentElement.classList.toggle('full', !!spFull);
    $('pc-st-fill').style.width = `${p.stamina}%`;
    const h = $('pc-hissatsu');
    if (p.hissatsu) {
      h.textContent = `${spFull ? '⚡' : '　'}${p.hissatsu.name}（SP${p.hissatsu.cost}）`;
      h.classList.toggle('ready', !!spFull);
    } else { h.textContent = '必殺技なし'; h.classList.remove('ready'); }
  },

  /* =========================================================================
     描画
     ========================================================================= */
  /** ピッチ全体がなるべく収まる倍率。狭い画面では下限で止めてカメラが追う。 */
  viewScale() {
    return clamp(Math.min(R.w / 1560, R.h / 1000), 0.42, 1.0);
  },

  draw(ctx) {
    const M = this.M;
    if (!M) return;
    const scale = this.viewScale();
    const viewW = R.w / scale, viewH = R.h / scale;
    let cx = clamp(M.camera.x, viewW / 2 - 70, FIELD.W - viewW / 2 + 70);
    let cy = clamp(M.camera.y, viewH / 2 - 60, FIELD.H - viewH / 2 + 60);
    if (viewW > FIELD.W + 140) cx = FIELD.W / 2;
    if (viewH > FIELD.H + 120) cy = FIELD.H / 2;
    const sh = M.camera.shake;
    cx += rand(sh, -sh); cy += rand(sh, -sh);
    M.view = { scale, cx, cy };

    ctx.save();
    ctx.translate(R.w / 2, R.h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    this.drawStands(ctx, cx, cy, viewW, viewH);
    this.drawPitch(ctx);
    this.drawGoal(ctx, 0);
    this.drawGoal(ctx, FIELD.W);

    // 影
    M.players.forEach((p) => {
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
    });
    const b = M.ball;
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, 8 + b.z * 0.02, 4 + b.z * 0.012, 0, 0, Math.PI * 2); ctx.fill();

    this.drawParticles(ctx, false);

    // 選手（奥から）
    M.players.slice().sort((a, c) => a.y - c.y).forEach((p) => this.drawPlayer(ctx, p));

    this.drawBall(ctx);
    this.drawParticles(ctx, true);
    this.drawNets(ctx);

    ctx.restore();

    // ゴール時の暗転演出
    if (M.phase === 'goal') {
      const t = clamp(M.phaseT / 0.4, 0, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.28 * t})`;
      ctx.fillRect(0, 0, R.w, R.h);
    }
    if (M.phase === 'kickoff') {
      ctx.save();
      ctx.globalAlpha = clamp(1.1 - M.phaseT, 0, 1);
      ctx.fillStyle = '#fff';
      ctx.font = '900 italic 46px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 18;
      ctx.fillText(M.half === 1 ? 'KICK OFF' : 'SECOND HALF', R.w / 2, R.h * 0.3);
      ctx.restore();
    }
    if (M.cutin) this.drawCutin(ctx);
    if (M.chargeT > 0) this.drawCharge(ctx);
  },

  /** 観客の位置は試合開始時に一度だけ決める（毎フレーム乱数を回さない） */
  buildCrowd() {
    const M = this.M;
    const rnd = mulberry32(4242);
    const bands = [
      { x: -240, y: -260, w: FIELD.W + 480, h: 250 },
      { x: -240, y: FIELD.H + 10, w: FIELD.W + 480, h: 250 },
      { x: -250, y: -260, w: 240, h: FIELD.H + 520 },
      { x: FIELD.W + 10, y: -260, w: 240, h: FIELD.H + 520 },
    ];
    const crowd = [];
    for (let i = 0; i < 950; i++) {
      const bd = bands[Math.floor(rnd() * bands.length)];
      const c = rnd();
      crowd.push({
        x: bd.x + rnd() * bd.w, y: bd.y + rnd() * bd.h, up: i % 2 === 0,
        c: c < 0.42 ? '#2c3d52' : c < 0.7 ? '#3d5570'
          : c < 0.85 ? rgba(M.home.colors.main, 0.75) : rgba(M.away.colors.main, 0.75),
      });
    }
    M.bands = bands; M.crowd = crowd;
  },

  drawStands(ctx, cx, cy, vw, vh) {
    const M = this.M;
    ctx.fillStyle = '#0f1a26';
    ctx.fillRect(cx - vw, cy - vh, vw * 2, vh * 2);
    ctx.save();
    M.bands.forEach((bd) => {
      const g = ctx.createLinearGradient(bd.x, bd.y, bd.x, bd.y + bd.h);
      g.addColorStop(0, '#0a1119'); g.addColorStop(1, '#1a2634');
      ctx.fillStyle = g; ctx.fillRect(bd.x, bd.y, bd.w, bd.h);
    });
    const cheer = M.phase === 'goal' ? Math.sin(M.phaseT * 22) * 3 : 0;
    M.crowd.forEach((p) => {
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y + (p.up ? cheer : -cheer), 5, 5);
    });
    ctx.restore();
    // 広告看板
    ctx.fillStyle = '#16202c';
    ctx.fillRect(-40, -46, FIELD.W + 80, 36);
    ctx.fillRect(-40, FIELD.H + 10, FIELD.W + 80, 36);
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.font = '900 italic 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let x = 120; x < FIELD.W; x += 340) {
      ctx.fillText('GACHA STRIKERS', x, -28);
      ctx.fillText('GACHA STRIKERS', x, FIELD.H + 28);
    }
  },

  drawPitch(ctx) {
    // 芝
    ctx.fillStyle = '#2c7a3c';
    ctx.fillRect(0, 0, FIELD.W, FIELD.H);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.045)';
      ctx.fillRect((FIELD.W / 10) * i, 0, FIELD.W / 10, FIELD.H);
    }
    const g = ctx.createRadialGradient(FIELD.W / 2, FIELD.H / 2, FIELD.H * 0.2, FIELD.W / 2, FIELD.H / 2, FIELD.W * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, FIELD.W, FIELD.H);

    // ライン
    ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, FIELD.W - 20, FIELD.H - 20);
    ctx.beginPath(); ctx.moveTo(FIELD.W / 2, 10); ctx.lineTo(FIELD.W / 2, FIELD.H - 10); ctx.stroke();
    ctx.beginPath(); ctx.arc(FIELD.W / 2, FIELD.H / 2, 130, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.beginPath(); ctx.arc(FIELD.W / 2, FIELD.H / 2, 6, 0, Math.PI * 2); ctx.fill();
    // ペナルティエリア
    [0, 1].forEach((side) => {
      const x = side ? FIELD.W - FIELD.PEN_D : 0;
      ctx.strokeRect(side ? x : 10, (FIELD.H - FIELD.PEN_W) / 2, FIELD.PEN_D - 10, FIELD.PEN_W);
      const gx = side ? FIELD.W - 130 : 10;
      ctx.strokeRect(gx, (FIELD.H - 300) / 2, 120, 300);
      ctx.beginPath();
      ctx.arc(side ? FIELD.W - 190 : 190, FIELD.H / 2, 5, 0, Math.PI * 2); ctx.fill();
    });
    // コーナー
    [[10, 10, 0], [FIELD.W - 10, 10, Math.PI / 2], [FIELD.W - 10, FIELD.H - 10, Math.PI], [10, FIELD.H - 10, -Math.PI / 2]].forEach((c) => {
      ctx.beginPath(); ctx.arc(c[0], c[1], 26, c[2], c[2] + Math.PI / 2); ctx.stroke();
    });
  },

  drawGoal(ctx, x) {
    const M = this.M;
    const top = (FIELD.H - FIELD.GOAL_H) / 2, bot = top + FIELD.GOAL_H;
    const dirOut = x === 0 ? -1 : 1;
    // ゴール内側
    ctx.fillStyle = 'rgba(8,14,22,.5)';
    ctx.fillRect(Math.min(x, x + dirOut * FIELD.GOAL_D), top, FIELD.GOAL_D, FIELD.GOAL_H);
    // ネット
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.2;
    for (let i = 0; i <= FIELD.GOAL_D; i += 11) {
      ctx.beginPath(); ctx.moveTo(x + dirOut * i, top); ctx.lineTo(x + dirOut * i, bot); ctx.stroke();
    }
    for (let y = top; y <= bot; y += 11) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dirOut * FIELD.GOAL_D, y); ctx.stroke();
    }
    // ポスト
    ctx.strokeStyle = '#f4f8ff'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + dirOut * FIELD.GOAL_D, top); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, bot); ctx.lineTo(x + dirOut * FIELD.GOAL_D, bot); ctx.stroke();
    ctx.lineCap = 'butt';
  },

  drawNets() { /* ネットはゴール描画に含む */ },

  drawPlayer(ctx, p) {
    const M = this.M;
    const isCtrl = p === M.controlled;
    const kit = p.team.colors.main, kit2 = p.team.colors.sub;
    const el = ELEMENTS[p.elem];
    const bob = Math.sin(p.anim) * 2.4;
    const spReady = p.hissatsu && p.sp >= p.hissatsu.cost;

    ctx.save();
    ctx.translate(p.x, p.y);

    // 足元マーク
    if (isCtrl) {
      ctx.strokeStyle = 'rgba(255,210,63,.95)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 5, 19, 9, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (M.ball.owner === p) {
      ctx.strokeStyle = p.team.key === M.userTeam ? 'rgba(120,220,255,.6)' : 'rgba(255,120,140,.6)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(0, 5, 17, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (spReady) {
      ctx.strokeStyle = rgba(el.color, 0.55 + Math.sin(M.phaseT * 8 + p.x) * 0.2);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 5, 23, 11, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (p.superDribble > 0) {
      ctx.fillStyle = rgba(el.color, 0.28);
      ctx.beginPath(); ctx.arc(0, -12, 30, 0, Math.PI * 2); ctx.fill();
    }

    if (p.dive > 0) ctx.rotate(Math.sin(p.facing) * 0.5);
    if (p.stun > 0) ctx.rotate(Math.sin(p.stun * 40) * 0.14);

    // 足
    const lo = Math.sin(p.anim) * 5;
    ctx.fillStyle = kit2;
    ctx.fillRect(-6.5, -8 + lo * 0.35, 5, 10);
    ctx.fillRect(1.5, -8 - lo * 0.35, 5, 10);
    ctx.fillStyle = '#141820';
    ctx.fillRect(-7, 0 + lo * 0.35, 6, 3.4);
    ctx.fillRect(1, 0 - lo * 0.35, 6, 3.4);

    // 胴（GKは色違い）
    const shirt = p.isGK ? shade(kit, -0.45) : kit;
    ctx.fillStyle = shirt;
    ctx.beginPath(); ctx.roundRect(-9.5, -24 + bob, 19, 17, 5.5); ctx.fill();
    ctx.fillStyle = rgba(kit2, 0.9);
    ctx.fillRect(-9.5, -16 + bob, 19, 3.5);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.font = '900 8px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.num), 0, -18 + bob);

    // 腕
    ctx.fillStyle = p.char.look.skin;
    ctx.fillRect(-12.5, -23 + bob + lo * 0.3, 3.4, 11);
    ctx.fillRect(9.1, -23 + bob - lo * 0.3, 3.4, 11);

    // 頭
    ctx.fillStyle = p.char.look.skin;
    ctx.beginPath(); ctx.arc(0, -30 + bob, 8.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.char.look.hair;
    ctx.beginPath(); ctx.arc(0, -31.5 + bob, 8.6, Math.PI * 0.04, Math.PI * 0.96, true); ctx.fill();
    const st = p.char.look.style;
    if (st === 'spike' || st === 'mohawk') {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 3.2, -37 + bob); ctx.lineTo(i * 3.2 + 1.7, -43 + bob); ctx.lineTo(i * 3.2 + 3.4, -37 + bob); ctx.fill();
      }
    } else if (st === 'long' || st === 'ponytail' || st === 'braid' || st === 'bun') {
      ctx.beginPath(); ctx.ellipse(0, -27 + bob, 9, 7.5, 0, 0, Math.PI); ctx.fill();
    }
    // 向き
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.arc(Math.cos(p.facing) * 5.6, -30 + bob + Math.sin(p.facing) * 3, 1.9, 0, Math.PI * 2); ctx.fill();

    if (p.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,90,90,${p.hitFlash * 0.5})`;
      ctx.beginPath(); ctx.arc(0, -22 + bob, 20, 0, Math.PI * 2); ctx.fill();
    }

    // 名前
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const label = p.short;
    const tw = ctx.measureText(label).width + 9;
    ctx.fillStyle = p.team.key === M.userTeam ? 'rgba(20,60,110,.72)' : 'rgba(90,20,35,.72)';
    ctx.beginPath(); ctx.roundRect(-tw / 2, -54 + bob, tw, 14, 4); ctx.fill();
    ctx.fillStyle = isCtrl ? '#ffd23f' : 'rgba(235,245,255,.92)';
    ctx.fillText(label, 0, -42 + bob);

    if (isCtrl) {
      ctx.fillStyle = 'rgba(255,210,63,.95)';
      const t = Math.sin(M.phaseT * 6) * 2;
      ctx.beginPath();
      ctx.moveTo(0, -58 + t + bob); ctx.lineTo(-6, -68 + t + bob); ctx.lineTo(6, -68 + t + bob); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },

  drawBall(ctx) {
    const M = this.M;
    const b = M.ball;
    // 軌跡
    if (M.trail.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < M.trail.length; i++) {
        const a = i / M.trail.length;
        ctx.strokeStyle = M.superBall ? rgba(ELEMENTS[M.superBall.elem].color, a * 0.8) : `rgba(255,255,255,${a * 0.28})`;
        ctx.lineWidth = (M.superBall ? 16 : 6) * a;
        ctx.beginPath();
        ctx.moveTo(M.trail[i - 1].x, M.trail[i - 1].y - M.trail[i - 1].z * 0.35);
        ctx.lineTo(M.trail[i].x, M.trail[i].y - M.trail[i].z * 0.35);
        ctx.stroke();
      }
    }
    const bx = b.x, by = b.y - b.z * 0.35;
    if (M.superBall) {
      const el = ELEMENTS[M.superBall.elem];
      const g = ctx.createRadialGradient(bx, by, 2, bx, by, 40);
      g.addColorStop(0, rgba(el.glow, 0.95)); g.addColorStop(0.4, rgba(el.color, 0.7)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, 40, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(b.spin * 0.1);
    ctx.fillStyle = '#fdfdfd';
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b2430';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.arc(Math.cos(a) * 4.6, Math.sin(a) * 4.6, 2.1, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },

  drawParticles(ctx, above) {
    const M = this.M;
    M.particles.forEach((p) => {
      const a = clamp(p.life / p.max, 0, 1);
      const isAbove = p.type === 'confetti' || p.type === 'shock' || p.type === 'spark';
      if (isAbove !== above) return;
      ctx.globalAlpha = a;
      if (p.type === 'ring' || p.type === 'shock') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * a + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.2 - a), 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'confetti') {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y - p.z * 0.4, p.size, p.size * 1.7);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  },

  getPortrait(char) {
    const key = char.id || char.name;
    if (!this.portraitCache[key]) {
      const cv = document.createElement('canvas');
      cv.width = 200; cv.height = 250;
      drawPortrait(cv.getContext('2d'), char, 200, 250, {});
      this.portraitCache[key] = cv;
    }
    return this.portraitCache[key];
  },

  drawCutin(ctx) {
    const M = this.M;
    const c = M.cutin;
    const p = c.p, h = c.h;
    const el = ELEMENTS[p.elem];
    const t = c.t / c.dur;
    const inT = clamp(t / 0.18, 0, 1);
    const outT = clamp((t - 0.82) / 0.18, 0, 1);
    const slide = (1 - easeOut(inT)) * -R.w * 0.8 + easeIn(outT) * R.w * 0.9;

    ctx.save();
    ctx.fillStyle = `rgba(2,4,10,${0.55 * (1 - outT)})`;
    ctx.fillRect(0, 0, R.w, R.h);

    const bandH = Math.min(300, R.h * 0.56);
    const by = R.h / 2 - bandH / 2;
    ctx.save();
    ctx.translate(slide, 0);
    // 斜めの帯
    ctx.beginPath();
    ctx.moveTo(-40, by + 26); ctx.lineTo(R.w + 40, by - 16);
    ctx.lineTo(R.w + 40, by + bandH - 16); ctx.lineTo(-40, by + bandH + 26);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, by, R.w, by + bandH);
    g.addColorStop(0, shade(el.color, -0.55)); g.addColorStop(0.34, shade(el.color, -0.32));
    g.addColorStop(1, '#06090f');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = rgba(el.glow, 0.9); ctx.lineWidth = 3; ctx.stroke();
    ctx.clip();

    // 集中線
    ctx.save();
    ctx.translate(R.w * 0.28, R.h / 2);
    for (let i = 0; i < 26; i++) {
      ctx.rotate(Math.PI * 2 / 26);
      ctx.fillStyle = rgba(el.glow, 0.16);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R.w, -14); ctx.lineTo(R.w, 14); ctx.fill();
    }
    ctx.restore();

    // 立ち絵
    const pw = Math.min(220, R.h * 0.42), ph = pw * 1.25;
    ctx.drawImage(this.getPortrait(p.char), R.w * 0.06, R.h / 2 - ph / 2, pw, ph);
    ctx.strokeStyle = rgba(el.glow, 0.8); ctx.lineWidth = 2;
    ctx.strokeRect(R.w * 0.06, R.h / 2 - ph / 2, pw, ph);

    // 技名
    const tx = R.w * 0.06 + pw + 26;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `900 italic ${Math.min(54, R.w * 0.06)}px system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,.95)'; ctx.shadowBlur = 18;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(4,8,14,.85)';
    ctx.strokeText(h.name, tx, R.h / 2 - 8);
    const grd = ctx.createLinearGradient(tx, 0, tx + 420, 0);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, el.glow);
    ctx.fillStyle = grd;
    ctx.fillText(h.name, tx, R.h / 2 - 8);
    ctx.font = `700 ${Math.min(19, R.w * 0.024)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(240,250,255,.9)';
    ctx.fillText(`${p.name}　/　${HISSATSU_LABEL[h.type]}　${el.icon}${el.name}`, tx, R.h / 2 + 34);
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.restore();
  },

  drawCharge(ctx) {
    const M = this.M;
    const p = M.controlled;
    if (!p || !M.view) return;
    const { scale, cx, cy } = M.view;
    const sx = R.w / 2 + (p.x - cx) * scale;
    const sy = R.h / 2 + (p.y - cy) * scale;
    const w = 54, hgt = 7;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(sx - w / 2, sy - 66, w, hgt);
    const g = ctx.createLinearGradient(sx - w / 2, 0, sx + w / 2, 0);
    g.addColorStop(0, '#3ddc97'); g.addColorStop(0.6, '#ffd23f'); g.addColorStop(1, '#ff5f7e');
    ctx.fillStyle = g;
    ctx.fillRect(sx - w / 2, sy - 66, w * M.chargeT, hgt);
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(sx - w / 2, sy - 66, w, hgt);
  },
};
