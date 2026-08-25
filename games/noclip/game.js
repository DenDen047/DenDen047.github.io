/* =========================================================================
   NOCLIP ― ゲーム本体
   移動・採掘・実体の思考・アイテム・エモート。画面遷移は main.js。
   ========================================================================= */

const P_RADIUS = 13;
const WALK = 152, RUN = 244;
const SWING_DUR = 0.24;

const Game = {
  st: null, running: false, paused: false, last: 0, raf: 0,
  onEnd: null, onHud: null,

  /* ---------- 開始 ---------- */
  start(stageId, skinId) {
    const stage = STAGE_BY_ID[stageId];
    const skin = SKIN_BY_ID[skinId] || SKIN_BY_ID.surveyor;
    const pick = PICKS[skin.pick];
    const perk = skin.perk || {};
    const lay = buildStage(stage);

    const maxHp = 100 + (perk.hp || 0);
    const st = {
      stage, skin, pick, perk,
      look: skin.look,
      W: lay.W, H: lay.H, tiles: lay.tiles, hp: lay.hp,
      seen: new Uint8Array(lay.W * lay.H),
      p: {
        x: lay.spawn.x * TILE + TILE / 2, y: lay.spawn.y * TILE + TILE / 2,
        vx: 0, vy: 0, ang: 0, hp: maxHp, maxHp,
        stam: 100, bat: 100, light: true,
        swingT: 0, swingDur: SWING_DUR, cd: 0, hitDone: true,
        invT: 0, moving: false, dead: false, stepT: 0,
      },
      exit: lay.exit, pillars: lay.pillars,
      keys: lay.keys, chests: lay.chests, lamps: lay.lamps,
      items: [], parts: [], bubbles: [], noiseRings: [], ents: [],
      keysTotal: stage.kind === 'boss' ? (stage.pillars || 4) : stage.keys,
      keysGot: 0,
      pillarsLeft: stage.kind === 'boss' ? (stage.pillars || 4) : 0,
      candy: 0, broken: 0, hits: 0,
      time: 0, shake: 0, aim: null, over: null,
      flow: null, flowT: 0, heartT: 0,
      msg: '', msgT: 0,
    };

    for (const s of lay.spawns) { st.ents.push(makeEnt(s.type, s.x, s.y)); }
    if (stage.kind === 'boss') {
      const c = (lay.W >> 1);
      st.ents.push(makeEnt('silence', c, c));
    }

    this.st = st;
    R.camX = st.p.x; R.camY = st.p.y;
    this.paused = false;
    this.running = true;
    this.last = performance.now();
    Audio2.ambient(true, stage.kind === 'boss' ? 58 : 120);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(ts => this.loop(ts));
    this.say(stage.kind === 'boss' ? '支柱を四本とも折れ。' : '鍵を集めて非常口へ。');
    return st;
  },

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    Audio2.ambient(false);
  },

  say(text, sec = 3.4) { if (this.st) { this.st.msg = text; this.st.msgT = sec; } },

  /* ---------- ループ ---------- */
  loop(ts) {
    if (!this.running) { return; }
    this.raf = requestAnimationFrame(t => this.loop(t));
    const dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    if (!this.paused) { this.update(dt); }
    R.draw(this.st);
    if (this.onHud) { this.onHud(this.st); }
    Input.endFrame();
  },

  /* ---------- 更新 ---------- */
  update(dt) {
    const st = this.st, p = st.p;
    st.time += dt;
    st.shake = Math.max(0, st.shake - dt * 34);
    if (st.msgT > 0) { st.msgT -= dt; }

    if (!p.dead && !st.over) {
      this.control(dt);
      this.mine(dt);
    }
    this.entities(dt);
    this.pickups(dt);
    this.effects(dt);

    // 光と電池
    if (p.light && p.bat > 0) {
      p.bat = Math.max(0, p.bat - dt * 1.0 * (st.perk.batDrain || 1));
      if (p.bat === 0) { this.say('電池が切れた。'); Audio2.sfx('alert'); }
    }

    // 心音（近い実体があるほど速く）
    let near = Infinity;
    for (const e of st.ents) { if (!e.dead) { near = Math.min(near, Math.hypot(e.x - p.x, e.y - p.y)); } }
    if (near < 260 && !p.dead) {
      st.heartT -= dt;
      if (st.heartT <= 0) { Audio2.heart(clamp(1 - near / 260, 0.2, 1)); st.heartT = lerp(0.42, 1.15, near / 260); }
    }

    if (p.hp <= 0 && !p.dead) { this.die(); }
  },

  /* ---------- 操作 ---------- */
  control(dt) {
    const st = this.st, p = st.p;
    const ax = Input.axis();
    const sprintKey = Input.held('shift') || Input.touchRun;
    const wantRun = sprintKey && p.stam > 2 && (ax.x || ax.y);
    const spd = (wantRun ? RUN : WALK) * (st.perk.speed || 1);

    p.moving = !!(ax.x || ax.y);
    p.vx = ax.x * spd; p.vy = ax.y * spd;
    this.move(p, dt, P_RADIUS);

    // 向き（マウス、なければ進行方向）
    if (Input.hasMouse) {
      const w = R.worldFromScreen(Input.mx, Input.my);
      const a = Math.atan2(w.y - p.y, w.x - p.x);
      if (Number.isFinite(a)) { p.ang += angDiff(p.ang, a) * Math.min(1, dt * 22); }
    } else if (p.moving) {
      p.ang += angDiff(p.ang, Math.atan2(ax.y, ax.x)) * Math.min(1, dt * 14);
    }

    // スタミナ
    if (wantRun) { p.stam = Math.max(0, p.stam - dt * 20); }
    else { p.stam = Math.min(100, p.stam + dt * 18 * (st.perk.stamRegen || 1)); }

    // 足音
    if (p.moving) {
      p.stepT -= dt * (wantRun ? 2.6 : 1.6);
      if (p.stepT <= 0) {
        p.stepT = 0.42;
        if (!st.perk.silentSteps) {
          Audio2.sfx('step', wantRun ? 1.4 : 0.8);
          this.noise(p.x, p.y, wantRun ? 6.5 : 2.4, 'rgba(160,180,210,0.7)', false);
        }
      }
    }

    if (Input.pressed('f')) {
      p.light = !p.light; Audio2.sfx('ui');
      this.say(p.light ? 'ライト ON' : 'ライト OFF', 1.2);
    }
    for (let i = 0; i < EMOTES.length; i++) {
      if (Input.pressed(String(i + 1))) { this.emote(EMOTES[i].id); }
    }
  },

  /** 半径 r の円がその位置で壁に噛むか */
  blockedAt(x, y, r) {
    const st = this.st;
    const solidAt = (px, py) => {
      const tx = (px / TILE) | 0, ty = (py / TILE) | 0;
      if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) { return true; }
      return SOLID.has(st.tiles[ty * st.W + tx]);
    };
    return (
      solidAt(x - r, y - r) || solidAt(x + r, y - r) ||
      solidAt(x - r, y + r) || solidAt(x + r, y + r) ||
      solidAt(x, y - r) || solidAt(x, y + r) || solidAt(x - r, y) || solidAt(x + r, y)
    );
  },

  /** 円 vs タイルの押し戻し。X と Y を分けて解く */
  move(o, dt, r) {
    const nx = o.x + o.vx * dt;
    if (!this.blockedAt(nx, o.y, r)) { o.x = nx; }
    const ny = o.y + o.vy * dt;
    if (!this.blockedAt(o.x, ny, r)) { o.y = ny; }
  },

  /* ---------- 採掘・攻撃 ---------- */
  mine(dt) {
    const st = this.st, p = st.p, pick = st.pick;
    p.cd -= dt * 1000;
    if (p.swingT > 0) {
      p.swingT -= dt;
      if (!p.hitDone && p.swingT <= p.swingDur * 0.55) { p.hitDone = true; this.impact(); }
      if (p.swingT <= 0) { p.swingT = 0; }
    }

    // ねらい先の表示
    st.aim = null;
    for (let d = 12; d <= pick.reach + TILE * 0.4; d += 6) {
      const tx = ((p.x + Math.cos(p.ang) * d) / TILE) | 0;
      const ty = ((p.y + Math.sin(p.ang) * d) / TILE) | 0;
      if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) { break; }
      const i = ty * st.W + tx;
      const t = st.tiles[i];
      if (SOLID.has(t)) {
        if (BREAKABLE[t]) { st.aim = { x: tx, y: ty, i, hp: st.hp[i], max: BREAKABLE[t] }; }
        break;
      }
    }
    if (!st.aim) {
      const c = this.chestAhead();
      if (c) { st.aim = { x: c.x, y: c.y, chest: c, hp: c.hp, max: 2 }; }
    }

    const want = Input.held(' ') || Input.down || Input.touchSwing;
    if (want && p.cd <= 0) {
      p.cd = pick.cd; p.swingT = p.swingDur = SWING_DUR * (pick.cd / 520);
      p.hitDone = false;
      p.stam = Math.max(0, p.stam - 8);
      Audio2.sfx('swing', 0.9);
    }
  },

  chestAhead() {
    const st = this.st, p = st.p;
    for (const c of st.chests) {
      if (c.open) { continue; }
      const cx = c.x * TILE + TILE / 2, cy = c.y * TILE + TILE / 2;
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < st.pick.reach + 16 && Math.abs(angDiff(p.ang, Math.atan2(cy - p.y, cx - p.x))) < 1.0) { return c; }
    }
    return null;
  },

  /** 振りの当たり判定 */
  impact() {
    const st = this.st, p = st.p, pick = st.pick;
    const hx = p.x + Math.cos(p.ang) * pick.reach * 0.8;
    const hy = p.y + Math.sin(p.ang) * pick.reach * 0.8;
    let hitSomething = false;

    // 実体
    for (const e of st.ents) {
      if (e.dead) { continue; }
      const d = ENTS[e.type];
      const dd = Math.hypot(e.x - p.x, e.y - p.y);
      if (dd > pick.reach + d.radius) { continue; }
      if (Math.abs(angDiff(p.ang, Math.atan2(e.y - p.y, e.x - p.x))) > 0.95) { continue; }
      let dmg = pick.dmg;
      if (e.type === 'smiler' && e.litT <= 0) { dmg *= 0.2; }         // 光の外では手応えがない
      if (e.type === 'silence') { dmg = 0; }
      e.hp -= dmg; e.hurtT = 0.14; hitSomething = true;
      const kb = e.type === 'silence' ? 0 : 130;
      e.vx += Math.cos(p.ang) * kb; e.vy += Math.sin(p.ang) * kb;
      this.burst(e.x, e.y, d.glow, 8, 'spark');
      Audio2.sfx('hitEnt', 1);
      if (e.hp <= 0) { e.dead = true; this.burst(e.x, e.y, d.body, 18, 'smoke'); st.candy += 3; }
      else if (e.type === 'silence') { this.say('効かない。支柱を折れ。', 2); }
    }

    // 宝箱
    const chest = this.chestAhead();
    if (chest) {
      chest.hp -= pick.power; hitSomething = true;
      this.burst(chest.x * TILE + TILE / 2, chest.y * TILE + TILE / 2, '#c08a30', 10, 'chip');
      if (chest.hp <= 0) { this.openChest(chest); } else { Audio2.sfx('hitWall', 0.9); }
    }

    // タイル（照準と同じ判定を使う。届く先が見えているものだけを削る）
    const at = st.aim && st.aim.i !== undefined ? st.aim : null;
    const tx = at ? at.x : (hx / TILE) | 0, ty = at ? at.y : (hy / TILE) | 0;
    if (tx >= 0 && ty >= 0 && tx < st.W && ty < st.H) {
      const i = ty * st.W + tx;
      const t = st.tiles[i];
      if (BREAKABLE[t]) {
        // hp は Uint8Array なので、引き算で 0 を下回らせると 255 に回り込む
        st.hp[i] = Math.max(0, st.hp[i] - pick.power);
        hitSomething = true;
        st.hits++;
        const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
        if (st.hp[i] === 0) {
          st.tiles[i] = (t === T.CRACK || t === T.PILLAR) ? T.RUBBLE : T.OPEN;
          st.broken++;
          this.burst(cx, cy, st.stage.pal.crack, 24, 'chip');
          this.burst(cx, cy, '#000', 12, 'smoke');
          Audio2.sfx(t === T.DOOR ? 'door' : 'break');
          st.shake = t === T.PILLAR ? 22 : 9;
          if (t === T.PILLAR) { this.pillarDown(); }
        } else {
          this.burst(cx, cy, st.stage.pal.wallTop, 9, 'chip');
          Audio2.sfx('hitWall');
          st.shake = 4;
        }
      } else if (SOLID.has(t)) {
        this.burst(hx, hy, '#cfd6e0', 5, 'spark');
        Audio2.sfx('hitWall', 0.7);
        hitSomething = true;
      }
    }

    // 音とスキン固有の効果
    this.noise(p.x, p.y, pick.noise * (hitSomething ? 1 : 0.6), 'rgba(255,210,120,0.9)', true);
    if (pick.fear) {
      const rad = pick.fear.radius * TILE;
      this.burst(hx, hy, pick.spark, 16, 'smoke', 1.4);
      for (const e of st.ents) {
        if (e.dead || e.type === 'silence') { continue; }
        if (dist2(e.x, e.y, p.x, p.y) < rad * rad) { e.fearT = Math.max(e.fearT, pick.fear.time); }
      }
    }
  },

  pillarDown() {
    const st = this.st;
    st.pillarsLeft--; st.keysGot = st.keysTotal - st.pillarsLeft;
    Audio2.sfx('boom');
    this.say(st.pillarsLeft > 0 ? `支柱 残り ${st.pillarsLeft} 本` : '天井が落ちる。', 3);
    if (st.pillarsLeft <= 0) {
      st.shake = 40;
      setTimeout(() => this.clear(), 900);
    }
  },

  openChest(c) {
    const st = this.st;
    c.open = true; c.hp = 0;
    const px = c.x * TILE + TILE / 2, py = c.y * TILE + TILE / 2;
    Audio2.sfx('chest');
    this.burst(px, py, '#ffd75e', 22, 'spark');
    const drop = (type, n) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, d = 6 + Math.random() * 16;
        st.items.push({ x: px + Math.cos(a) * d, y: py + Math.sin(a) * d, type });
      }
    };
    if (c.loot === 'key') { st.keys.push({ x: c.x, y: c.y, got: false }); drop('candy', 2); this.say('鍵が入っていた。'); }
    else if (c.loot === 'big') { drop('candy', 4); drop('battery', 1); drop('heal', 1); }
    else if (c.loot === 'heal') { drop('heal', 1); drop('candy', 2); }
    else { drop('battery', 1); drop('candy', 2); }
    this.noise(px, py, 7, 'rgba(255,215,94,0.8)', true);
  },

  /* ---------- 音 ---------- */
  noise(x, y, radTiles, color, alert) {
    const st = this.st;
    if (radTiles <= 0.4) { return; }
    st.noiseRings.push({ x, y, r: radTiles * TILE, t: 0, max: 0.7, c: color });
    if (!alert) { return; }
    const r2 = (radTiles * TILE) ** 2;
    for (const e of st.ents) {
      if (e.dead || e.type === 'silence') { continue; }
      const d = ENTS[e.type];
      if (dist2(e.x, e.y, x, y) > r2 * (d.sense.hear / 14)) { continue; }
      e.state = 'search'; e.tx = x; e.ty = y; e.searchT = 6.5;
      if (Math.random() < 0.35) { Audio2.sfx(e.type === 'smiler' ? 'smile' : 'growl', 0.7); }
    }
  },

  /* ---------- エモート ---------- */
  emote(id) {
    const st = this.st;
    if (!st || st.p.dead) { return; }
    const em = EMOTES.find(e => e.id === id);
    if (!em) { return; }
    st.bubbles.push({ emoji: em.emoji, x: st.p.x, y: st.p.y, t: 1.7, max: 1.7 });
    Audio2.emote(em.sound);
    this.noise(st.p.x, st.p.y, em.noise, 'rgba(125,255,74,0.85)', true);
    if (em.id === 'whistle') { this.say('口笛。遠くの何かが振り向いた。', 2.4); }
  },

  /* ---------- 実体 ---------- */
  entities(dt) {
    const st = this.st, p = st.p;

    // 追跡用の距離場（プレイヤー中心）を間引いて再計算
    st.flowT -= dt;
    if (st.flowT <= 0) { st.flowT = 0.35; st.flow = this.buildFlow(); }

    for (const e of st.ents) {
      if (e.dead) { continue; }
      const d = ENTS[e.type];
      e.hurtT = Math.max(0, e.hurtT - dt);
      e.fearT = Math.max(0, e.fearT - dt);
      e.litT = Math.max(0, e.litT - dt);
      e.atkCd = Math.max(0, e.atkCd - dt);
      e.searchT = Math.max(0, (e.searchT || 0) - dt);

      const dx = p.x - e.x, dy = p.y - e.y;
      const dd = Math.hypot(dx, dy);
      e.close = dd < TILE * 4;

      // 光に照らされているか（判定はプレイヤー→実体の向きで行う）
      if (p.light && p.bat > 0 && d.behavior !== 'boss') {
        const fov = 0.62 + (st.pick.lightFov || 0);
        const range = 330 + (st.pick.lightRange || 0);
        const toEnt = Math.atan2(-dy, -dx);
        if (dd < range && Math.abs(angDiff(p.ang, toEnt)) < fov && this.los(e.x, e.y, p.x, p.y)) {
          e.litT = 0.25;
        }
      }

      // 発見
      if (!p.dead && dd < d.sense.sight * TILE && this.los(e.x, e.y, p.x, p.y)) {
        if (e.state !== 'chase') { Audio2.sfx(e.type === 'smiler' ? 'smile' : 'growl', 0.8); }
        e.state = 'chase'; e.searchT = 7;
      } else if (e.state === 'chase' && (dd > d.sense.sight * TILE * 1.7 || e.searchT <= 0)) {
        e.state = 'search'; e.tx = p.x; e.ty = p.y; e.searchT = 5;
      }
      if (p.dead) { e.state = 'idle'; }

      // 速度を決める
      let spd = d.speed;
      if (e.fearT > 0) { spd = -d.speed * 0.75; }                        // 緑の煙で後ずさる
      else if (e.type === 'smiler' && e.litT > 0) { spd *= 0.28; }       // 光の中では鈍る
      else if (e.type === 'partygoer' && e.hp < d.hp * 0.3) { spd = -d.speed; }

      let mx = 0, my = 0;
      if (e.state === 'chase' || e.fearT > 0) {
        const g = this.flowStep(e.x, e.y);
        if (g) { mx = g.x; my = g.y; } else { mx = dx / (dd || 1); my = dy / (dd || 1); }
      } else if (e.state === 'search' && e.searchT > 0) {
        const g = this.greedy(e, e.tx, e.ty);
        mx = g.x; my = g.y;
      } else {
        e.wanderT = (e.wanderT || 0) - dt;
        if (e.wanderT <= 0) { e.wanderT = 1.4 + Math.random() * 2.2; e.wa = Math.random() * TAU; }
        mx = Math.cos(e.wa || 0) * 0.5; my = Math.sin(e.wa || 0) * 0.5;
      }

      e.vx = lerp(e.vx, mx * spd, 0.25) ;
      e.vy = lerp(e.vy, my * spd, 0.25);
      this.move(e, dt, d.radius * 0.75);
      if (mx || my) { e.ang += angDiff(e.ang, Math.atan2(e.vy || my, e.vx || mx)) * Math.min(1, dt * 10); }

      // 接触ダメージ
      if (!p.dead && dd < d.radius + P_RADIUS - 3 && e.atkCd <= 0 && e.fearT <= 0) {
        e.atkCd = 0.85;
        this.hurt(d.dmg, Math.atan2(dy, dx));
      }

      // ボスの沈黙波
      if (e.type === 'silence') {
        e.pulseT = (e.pulseT || 0) - dt;
        if (e.pulseT <= 0) {
          e.pulseT = 5;
          st.noiseRings.push({ x: e.x, y: e.y, r: TILE * 9, t: 0, max: 1.1, c: 'rgba(140,120,200,0.9)' });
          if (dd < TILE * 9) {
            p.bat = Math.max(0, p.bat - 22);
            this.say('電池が吸われる。', 2);
            Audio2.sfx('alert');
          }
        }
      }
    }
  },

  /** awayAng は「実体から見てプレイヤーがいる向き」。その方向へ弾き飛ばす */
  hurt(amount, awayAng) {
    const st = this.st, p = st.p;
    if (p.invT > 0 || p.dead) { return; }
    p.hp -= amount * (st.perk.dmgTaken || 1);
    p.invT = 0.75;
    const kx = p.x + Math.cos(awayAng) * 14, ky = p.y + Math.sin(awayAng) * 14;
    if (!this.blockedAt(kx, p.y, P_RADIUS)) { p.x = kx; }
    if (!this.blockedAt(p.x, ky, P_RADIUS)) { p.y = ky; }
    st.shake = 16;
    Audio2.sfx('hurt');
    this.burst(p.x, p.y, '#ff4a5e', 14, 'spark');
    if (window.__flash) { window.__flash(); }
  },

  /** 追跡用の距離場。歩ける範囲だけを幅優先で塗る */
  buildFlow() {
    const st = this.st;
    const W = st.W, H = st.H;
    const px = clamp((st.p.x / TILE) | 0, 0, W - 1), py = clamp((st.p.y / TILE) | 0, 0, H - 1);
    const f = new Int32Array(W * H).fill(-1);
    const start = py * W + px;
    if (!passWalk(st.tiles[start])) { return null; }
    const q = [start]; f[start] = 0;
    let head = 0, budget = 2600;
    while (head < q.length && budget-- > 0) {
      const c = q[head++], cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { continue; }
        const ni = ny * W + nx;
        if (f[ni] === -1 && passWalk(st.tiles[ni])) { f[ni] = f[c] + 1; q.push(ni); }
      }
    }
    return f;
  },

  /** 距離場を下る方向を返す */
  flowStep(x, y) {
    const st = this.st, f = st.flow;
    if (!f) { return null; }
    const cx = clamp((x / TILE) | 0, 0, st.W - 1), cy = clamp((y / TILE) | 0, 0, st.H - 1);
    const here = f[cy * st.W + cx];
    if (here < 0) { return null; }
    let best = null, bv = here;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= st.W || ny >= st.H) { continue; }
      const v = f[ny * st.W + nx];
      if (v >= 0 && v < bv) { bv = v; best = [dx, dy]; }
    }
    if (!best) { return null; }
    // タイルの中心へ寄せてから隣へ進む
    const tcx = cx * TILE + TILE / 2, tcy = cy * TILE + TILE / 2;
    const ox = (tcx - x) * 0.035, oy = (tcy - y) * 0.035;
    const vx = best[0] + ox * (best[0] ? 0 : 1);
    const vy = best[1] + oy * (best[1] ? 0 : 1);
    const m = Math.hypot(vx, vy) || 1;
    return { x: vx / m, y: vy / m };
  },

  /** 目標に向かって進める方向を貪欲に選ぶ（迷路で詰まらない程度の賢さ） */
  greedy(e, tx, ty) {
    const st = this.st;
    const cx = (e.x / TILE) | 0, cy = (e.y / TILE) | 0;
    let best = null, bd = Infinity;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= st.W || ny >= st.H) { continue; }
      if (!passWalk(st.tiles[ny * st.W + nx])) { continue; }
      const d = dist2(nx * TILE + TILE / 2, ny * TILE + TILE / 2, tx, ty);
      if (d < bd) { bd = d; best = [dx, dy]; }
    }
    if (!best) { return { x: Math.cos(e.ang), y: Math.sin(e.ang) }; }
    return { x: best[0], y: best[1] };
  },

  /** 直線に遮蔽が無いか */
  los(ax, ay, bx, by) {
    const st = this.st;
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.ceil(d / 14);
    for (let i = 1; i < n; i++) {
      const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
      const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
      if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) { return false; }
      if (OPAQUE.has(st.tiles[ty * st.W + tx])) { return false; }
    }
    return true;
  },

  /* ---------- 拾い物・鍵・出口 ---------- */
  pickups(dt) {
    const st = this.st, p = st.p;
    if (p.dead || st.over) { return; }

    for (let i = st.items.length - 1; i >= 0; i--) {
      const it = st.items[i];
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d < 90) { it.x += (p.x - it.x) * dt * 3.4; it.y += (p.y - it.y) * dt * 3.4; }
      if (d < 22) {
        st.items.splice(i, 1);
        Audio2.sfx('pickup');
        if (it.type === 'candy') { st.candy += 1; }
        else if (it.type === 'battery') { p.bat = Math.min(100, p.bat + 40); this.say('電池 +40'); }
        else { p.hp = Math.min(p.maxHp, p.hp + 28); this.say('救急箱 +28'); }
      }
    }

    for (const k of st.keys) {
      if (k.got) { continue; }
      const kx = k.x * TILE + TILE / 2, ky = k.y * TILE + TILE / 2;
      if (dist2(kx, ky, p.x, p.y) < 26 * 26) {
        k.got = true; st.keysGot++;
        Audio2.sfx('key');
        this.burst(kx, ky, '#ffd75e', 20, 'spark');
        this.say(st.keysGot >= st.keysTotal ? '鍵が揃った。非常口へ。' : `鍵 ${st.keysGot}/${st.keysTotal}`);
      }
    }

    if (st.stage.kind !== 'boss' && st.keysGot >= st.keysTotal) {
      const ex = st.exit.x * TILE + TILE / 2, ey = st.exit.y * TILE + TILE / 2;
      if (dist2(ex, ey, p.x, p.y) < 30 * 30) { this.clear(); }
    }
  },

  /* ---------- 粒子・吹き出し ---------- */
  effects(dt) {
    const st = this.st;
    for (let i = st.parts.length - 1; i >= 0; i--) {
      const q = st.parts[i];
      q.t -= dt;
      if (q.t <= 0) { st.parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.94; q.vy *= 0.94;
      if (q.kind === 'smoke') { q.vy -= 8 * dt; }
      q.rot = (q.rot || 0) + (q.spin || 0) * dt;
    }
    for (let i = st.bubbles.length - 1; i >= 0; i--) {
      const b = st.bubbles[i];
      b.t -= dt;
      if (b.t <= 0) { st.bubbles.splice(i, 1); }
    }
    for (let i = st.noiseRings.length - 1; i >= 0; i--) {
      const n = st.noiseRings[i];
      n.t += dt;
      if (n.t >= n.max) { st.noiseRings.splice(i, 1); }
    }
    const p = st.p;
    p.invT = Math.max(0, p.invT - dt);
  },

  burst(x, y, color, n, kind = 'spark', scale = 1) {
    const st = this.st;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = (kind === 'smoke' ? 26 : 90) * (0.4 + Math.random());
      st.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: (kind === 'smoke' ? 4 : 2.2) * scale * (0.6 + Math.random()),
        c: color, kind, t: 0.35 + Math.random() * 0.55, max: 0.9,
        rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 14,
        a: kind === 'smoke' ? 0.5 : 1,
      });
    }
    if (st.parts.length > 420) { st.parts.splice(0, st.parts.length - 420); }
  },

  /* ---------- 決着 ---------- */
  die() {
    const st = this.st;
    st.p.dead = true; st.over = 'dead';
    Audio2.sfx('dead');
    Audio2.ambient(false);
    st.shake = 26;
    setTimeout(() => { this.running = false; if (this.onEnd) { this.onEnd('dead', st); } }, 1200);
  },

  clear() {
    const st = this.st;
    if (st.over) { return; }
    st.over = 'clear';
    Audio2.sfx('clear');
    Audio2.ambient(false);
    setTimeout(() => { this.running = false; if (this.onEnd) { this.onEnd('clear', st); } }, 900);
  },
};

function makeEnt(type, tx, ty) {
  const d = ENTS[type];
  return {
    type, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
    vx: 0, vy: 0, ang: Math.random() * TAU,
    hp: d.hp, state: 'idle', tx: 0, ty: 0, searchT: 0,
    hurtT: 0, fearT: 0, litT: 0, atkCd: 0, dead: false,
    seed: Math.random() * 10, close: false,
  };
}
