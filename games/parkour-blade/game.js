/* =========================================================================
   PARKOUR BLADE ― ゲーム本体
   見下ろし視点に「高さ z」を持たせた 2D パルクール。
   z は影とプレイヤーを結ぶ線で見せる。壁は常に体を止め、空中で触れると掴まる。
   ========================================================================= */

/* ===================== 定数 ===================== */
const TILE = 40;

const PR = 11;          // 体の当たり半径（真上から見た大きさ）
const STAND_H = 24;     // 立ち姿勢の背丈（刃との高さ判定に使う）
const SLIDE_H = 9;      // スライディング中の背丈

const GRAV = 0.62;      // 1フレーム(60fps)あたりの落下加速
const WALK = 3.2;
const SPRINT = 4.7;
const JUMP_VZ = 12.0;   // 頂点 116px / 滞空 39フレーム → ダッシュで奈落3マス（182px）
const KICK_VZ = 14.0;   // 壁キックの滞空 45フレーム
const KICK_SPD = 5.6;
const PAD_VZ = 17.5;    // ジャンプ台。頂点 247px で柵(130px)を越える
const FENCE_H = 150;    // 柵の高さ（通常ジャンプの頂点116pxでは越えられない）

const GRIP_MAX = 100;
const GRIP_HOLD = 0.40;  // 掴まっている間の消費/フレーム
const GRIP_GRAB = 9;     // 掴んだ瞬間の消費
const GRIP_REGEN = 2.2;  // 接地中の回復/フレーム

const EXT = 18;         // 壁の見た目の押し出し量
const VOID_Z = -1e9;    // 奈落（立てる高さが無い）

const BAND = {
  low: [0, 15],         // 低刃：跳び越す
  high: [19, 90],       // 吊り刃：くぐる
  full: [0, 400],       // 大刃：迂回する
};
const BAND_COL = { low: '#ff8a3c', high: '#4be1ff', full: '#ff4d5e' };
const BAND_ZC = { low: 8, high: 46, full: 30 };

const isFloorChar = (c) => c === '.' || c === 'S' || c === 'G' || c === 'C' || c === '^' || c === 'o';
const isWallChar = (c) => c === '#' || c === 'n';

/* ===================== ゲーム ===================== */
const Game = {
  hooks: { toast: () => {}, clear: () => {}, died: () => {} },

  lv: null,
  grid: [],
  W: 0, H: 0,
  saws: [], plats: [], bolts: [], checks: [],
  p: null,
  cam: { x: 0, y: 0 },
  fx: { shake: 0, hitstop: 0 },
  state: 'play',
  time: 0,
  deaths: 0,
  tSec: 0,

  /* ---------- 読み込み ---------- */
  start(lv) {
    this.lv = lv;
    const rows = lv.map;
    this.W = Math.max(...rows.map((r) => r.length));
    this.H = rows.length;
    this.grid = rows.map((r) => (r + ' '.repeat(this.W - r.length)).split(''));

    this.bolts = [];
    this.checks = [];
    this.spawn = { x: TILE * 1.5, y: TILE * 1.5 };
    this.goal = { x: 0, y: 0 };

    for (let ty = 0; ty < this.H; ty++) {
      for (let tx = 0; tx < this.W; tx++) {
        const c = this.grid[ty][tx];
        const wx = tx * TILE + TILE / 2;
        const wy = ty * TILE + TILE / 2;
        if (c === 'S') this.spawn = { x: wx, y: wy };
        else if (c === 'G') this.goal = { x: wx, y: wy };
        else if (c === 'C') this.checks.push({ x: wx, y: wy, on: false });
        else if (c === 'o' || c === 'b') this.bolts.push({ x: wx, y: wy, got: false, air: c === 'b' });
      }
    }

    this.saws = lv.saws.map((s) => {
      const o = {
        t: s.t, band: BAND[s.band] || BAND.full, bandName: s.band,
        col: BAND_COL[s.band] || BAND_COL.full, zc: BAND_ZC[s.band] || 30,
        rr: s.r * TILE, spd: s.spd || 7, ang: rand(Math.PI * 2),
        period: s.period || 3, phase: s.phase || 0,
        px: 0, py: 0,
      };
      if (s.t === 'spin') { o.px = s.x * TILE; o.py = s.y * TILE; }
      if (s.t === 'rail') {
        o.a = { x: s.ax * TILE, y: s.ay * TILE };
        o.b = { x: s.bx * TILE, y: s.by * TILE };
        o.px = o.a.x; o.py = o.a.y;
      }
      if (s.t === 'orbit') {
        o.c = { x: s.cx * TILE, y: s.cy * TILE };
        o.rad = s.rad * TILE;
        o.px = o.c.x + o.rad; o.py = o.c.y;
      }
      return o;
    });

    this.plats = lv.plats.map((q) => ({
      a: { x: q.ax * TILE, y: q.ay * TILE },
      b: { x: q.bx * TILE, y: q.by * TILE },
      w: q.w * TILE, h: q.h * TILE,
      period: q.period || 4, phase: q.phase || 0,
      x: q.ax * TILE, y: q.ay * TILE, dx: 0, dy: 0,
    }));

    this.p = {
      x: this.spawn.x, y: this.spawn.y, z: 0,
      vx: 0, vy: 0, vz: 0,
      face: 0, runPhase: 0,
      onGround: true, coyote: 8, jumpBuf: 0,
      sliding: false, slideT: 0, slideCd: 0, sdx: 1, sdy: 0,
      clinging: false, cn: { x: 0, y: 0 }, clingCd: 0, detachT: 0, kickLock: 0,
      grip: GRIP_MAX, invuln: 40,
      trail: [],
    };

    this.respawn = { x: this.spawn.x, y: this.spawn.y };
    this.cam.x = this.spawn.x;
    this.cam.y = this.spawn.y;
    this.state = 'play';
    this.time = 0;
    this.deaths = 0;
    this.deadT = 0;
    this.tSec = 0;
    this.fx.shake = 0;
    this.fx.hitstop = 0;
    Particles.clear();
    this.updatePlats(0);
    this.updateSaws(0);
  },

  boltsGot() { return this.bolts.map((b) => b.got); },

  /* ---------- 地形の問い合わせ ---------- */
  at(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return ' ';
    return this.grid[ty][tx];
  },

  /** 高さ z のとき (x,y) が壁にめり込むならそのタイルを返す。 */
  hitBox(x, y, z) {
    const x0 = Math.floor((x - PR) / TILE), x1 = Math.floor((x + PR) / TILE);
    const y0 = Math.floor((y - PR) / TILE), y1 = Math.floor((y + PR) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.at(tx, ty);
        if (c === '#' || (c === 'n' && z < FENCE_H)) return { tx, ty, c };
      }
    }
    return null;
  },

  /** 足元の接地面。gz は立てる高さ（床は0、柵の上は FENCE_H、奈落は VOID_Z）。 */
  floorInfo(x, y) {
    for (const q of this.plats) {
      if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) {
        return { floor: true, gz: 0, plat: q, tile: '.' };
      }
    }
    const c = this.at(Math.floor(x / TILE), Math.floor(y / TILE));
    if (isFloorChar(c)) return { floor: true, gz: 0, plat: null, tile: c };
    if (c === 'n') return { floor: true, gz: FENCE_H, plat: null, tile: c };
    return { floor: false, gz: VOID_Z, plat: null, tile: c };
  },

  /* ---------- 更新 ---------- */
  update(dtMs) {
    const dtf = clamp(dtMs / 16.6667, 0, 2.2);

    if (this.fx.hitstop > 0) {
      this.fx.hitstop -= dtf;
      this.fx.shake *= Math.pow(0.9, dtf);
      return;
    }

    if (this.state === 'play') this.time += dtMs;
    this.tSec += dtf / 60;

    this.updatePlats(dtf);
    this.updateSaws(dtf);

    if (this.state === 'play') {
      this.updatePlayer(dtf);
    } else if (this.state === 'dead') {
      this.deadT += dtf;
      if (this.deadT > 46) this.doRespawn();
    } else if (this.state === 'fall') {
      this.deadT += dtf;
      this.p.z -= 6 * dtf;
      this.p.x += this.p.vx * 0.4 * dtf;
      this.p.y += this.p.vy * 0.4 * dtf;
      if (this.deadT > 40) this.doRespawn();
    }

    Particles.update(dtf);
    this.updateCam(dtf);
    this.fx.shake *= Math.pow(0.86, dtf);
    this.updateSawHum();
  },

  updatePlats(dtf) {
    for (const q of this.plats) {
      const u = 0.5 - 0.5 * Math.cos(Math.PI * 2 * (this.tSec / q.period + q.phase));
      const nx = lerp(q.a.x, q.b.x, u);
      const ny = lerp(q.a.y, q.b.y, u);
      q.dx = nx - q.x;
      q.dy = ny - q.y;
      q.x = nx;
      q.y = ny;
    }
  },

  updateSaws(dtf) {
    for (const s of this.saws) {
      s.ang += s.spd * dtf * 0.022;
      if (s.t === 'rail') {
        const u = 0.5 - 0.5 * Math.cos(Math.PI * 2 * (this.tSec / s.period + s.phase));
        s.px = lerp(s.a.x, s.b.x, u);
        s.py = lerp(s.a.y, s.b.y, u);
      } else if (s.t === 'orbit') {
        const a = Math.PI * 2 * (this.tSec / s.period + s.phase);
        s.px = s.c.x + Math.cos(a) * s.rad;
        s.py = s.c.y + Math.sin(a) * s.rad;
      }
    }
  },

  updateSawHum() {
    let near = 1e9;
    for (const s of this.saws) {
      const d = Math.hypot(this.p.x - s.px, this.p.y - s.py) - s.rr;
      if (d < near) near = d;
    }
    Sound.setSawLevel(clamp(1 - near / 380, 0, 1));
  },

  updatePlayer(dtf) {
    const p = this.p;
    const ax = Input.axis();
    const sprint = Input.held('dash');

    p.invuln = Math.max(0, p.invuln - dtf);
    p.clingCd = Math.max(0, p.clingCd - dtf);
    p.kickLock = Math.max(0, p.kickLock - dtf);
    p.slideCd = Math.max(0, p.slideCd - dtf);
    p.jumpBuf = Input.pressed('jump') ? 9 : Math.max(0, p.jumpBuf - dtf);

    if (p.clinging) {
      this.updateCling(dtf, ax);
    } else {
      this.updateFree(dtf, ax, sprint);
    }

    // --- 高さ ---
    p.z += p.vz * dtf;
    if (p.z > 600) { p.z = 600; p.vz = Math.min(p.vz, 0); }

    const fi0 = this.floorInfo(p.x, p.y);
    if (fi0.floor && p.z <= fi0.gz) {
      this.land(fi0);
    } else if (!fi0.floor && p.z <= 0) {
      this.startFall();
      return;
    } else {
      p.onGround = false;
      p.coyote = Math.max(0, p.coyote - dtf);
    }

    // --- 動く足場に運ばれる ---
    if (p.onGround) {
      const fi = this.floorInfo(p.x, p.y);
      if (fi.plat) {
        p.x += fi.plat.dx;
        p.y += fi.plat.dy;
        if (this.hitBox(p.x, p.y, p.z)) { p.x -= fi.plat.dx; p.y -= fi.plat.dy; }
      }
      p.grip = Math.min(GRIP_MAX, p.grip + GRIP_REGEN * dtf);
    }

    // --- 向きと走りの位相 ---
    const spd = Math.hypot(p.vx, p.vy);
    if (p.clinging) p.face = Math.atan2(-p.cn.y, -p.cn.x);
    else if (spd > 0.6) {
      const t = Math.atan2(p.vy, p.vx);
      let d = t - p.face;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.face += d * clamp(0.35 * dtf, 0, 1);
    }
    p.runPhase += spd * 0.12 * dtf;

    // --- 残像（ダッシュ・スライディング中） ---
    if ((sprint && spd > 3.6) || p.sliding) {
      p.trail.push({ x: p.x, y: p.y, z: p.z, a: p.face, life: 12, slide: p.sliding });
      if (p.trail.length > 14) p.trail.shift();
    }
    for (let i = p.trail.length - 1; i >= 0; i--) {
      p.trail[i].life -= dtf;
      if (p.trail[i].life <= 0) p.trail.splice(i, 1);
    }

    this.checkSaws();
    this.checkPickups();
  },

  /** 壁に掴まっている間。 */
  updateCling(dtf, ax) {
    const p = this.p;
    p.vx = 0; p.vy = 0;
    p.vz = Math.max(p.vz - 0.08 * dtf, -1.0);
    p.grip -= GRIP_HOLD * dtf;

    if (Math.random() < 0.16 * dtf) {
      Particles.add({
        x: p.x + p.cn.x * -PR, y: p.y + p.cn.y * -PR, z: p.z,
        vx: rand(0.6, -0.6), vy: rand(0.6, -0.6), vz: rand(0.4, -0.6),
        life: 16, max: 16, size: 1.6, col: '#8fa4bd', grav: 0.05,
      });
    }

    if (p.jumpBuf > 0) { this.wallKick(ax); return; }

    if (p.grip <= 0) {
      p.grip = 0;
      p.clinging = false;
      p.clingCd = 46;
      this.hooks.toast('握力が尽きた', true);
      return;
    }
    // 壁と反対を押し続けると手を離す
    const away = ax.x * p.cn.x + ax.y * p.cn.y;
    if (away > 0.7) {
      p.detachT += dtf;
      if (p.detachT > 9) { p.clinging = false; p.clingCd = 12; p.detachT = 0; }
    } else {
      p.detachT = 0;
    }
  },

  /** 掴まっていないときの移動。 */
  updateFree(dtf, ax, sprint) {
    const p = this.p;

    // スライディング開始
    if (Input.pressed('slide') && p.onGround && !p.sliding && p.slideCd <= 0) {
      const m = Math.hypot(p.vx, p.vy);
      p.sdx = m > 0.5 ? p.vx / m : Math.cos(p.face);
      p.sdy = m > 0.5 ? p.vy / m : Math.sin(p.face);
      p.sliding = true;
      p.slideT = 34;
      Sound.slide();
      Particles.burst(p.x, p.y, 2, 8, { sp: 1.6, vz: 0.8, size: 2.4, col: '#7f8ea3', life: 20, grav: 0.05 });
    }

    if (p.sliding) {
      p.slideT -= dtf;
      const k = clamp(p.slideT / 34, 0, 1);
      const sp = lerp(4.0, 7.0, k);
      p.vx = p.sdx * sp;
      p.vy = p.sdy * sp;
      if (p.slideT <= 0) { p.sliding = false; p.slideCd = 16; }
    } else {
      const tgt = (sprint ? SPRINT : WALK) * ax.m;
      const acc = p.onGround ? 0.30 : (p.kickLock > 0 ? 0.028 : 0.10);
      const k = clamp(acc * dtf, 0, 1);
      p.vx += (ax.x * tgt - p.vx) * k;
      p.vy += (ax.y * tgt - p.vy) * k;
      if (p.onGround && ax.m < 0.05) {
        const f = Math.pow(0.80, dtf);
        p.vx *= f; p.vy *= f;
      }
    }

    // ジャンプ
    if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0)) {
      p.vz = JUMP_VZ;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuf = 0;
      p.sliding = false;
      Sound.jump();
      Particles.burst(p.x, p.y, 1, 7, { sp: 1.5, vz: 0.6, size: 2.6, col: '#6f8296', life: 18, grav: 0.06 });
    }

    if (!p.onGround) p.vz -= GRAV * dtf;

    this.moveAxis(dtf);
  },

  /** 壁との当たりを見ながら x, y を進める。 */
  moveAxis(dtf) {
    const p = this.p;
    const total = Math.max(Math.abs(p.vx), Math.abs(p.vy)) * dtf;
    const steps = Math.max(1, Math.ceil(total / 8));
    const sx = (p.vx * dtf) / steps;
    const sy = (p.vy * dtf) / steps;

    for (let i = 0; i < steps; i++) {
      if (sx !== 0) {
        const nx = p.x + sx;
        const hit = this.hitBox(nx, p.y, p.z);
        if (hit) {
          p.x = sx > 0 ? hit.tx * TILE - PR - 0.01 : (hit.tx + 1) * TILE + PR + 0.01;
          this.tryCling(sx > 0 ? -1 : 1, 0);
          p.vx = 0;
          if (p.clinging) return;
        } else p.x = nx;
      }
      if (sy !== 0) {
        const ny = p.y + sy;
        const hit = this.hitBox(p.x, ny, p.z);
        if (hit) {
          p.y = sy > 0 ? hit.ty * TILE - PR - 0.01 : (hit.ty + 1) * TILE + PR + 0.01;
          this.tryCling(0, sy > 0 ? -1 : 1);
          p.vy = 0;
          if (p.clinging) return;
        } else p.y = ny;
      }
    }
  },

  /** 空中で壁に当たったら掴まる。nx, ny は壁から離れる向き。 */
  tryCling(nx, ny) {
    const p = this.p;
    if (p.clinging || p.onGround || p.z < 6) return;
    if (p.clingCd > 0 || p.grip < 12) return;
    p.clinging = true;
    p.cn = { x: nx, y: ny };
    p.grip = Math.max(0, p.grip - GRIP_GRAB);
    p.vx = 0; p.vy = 0;
    p.vz = 0.4;
    p.sliding = false;
    p.detachT = 0;
    Sound.grab();
    Particles.burst(p.x - nx * PR, p.y - ny * PR, p.z, 6, {
      sp: 1.6, vz: 0.8, size: 2, col: '#b9c9de', life: 16, grav: 0.1,
    });
  },

  /** 壁キック。法線と入力を混ぜた向きへ飛び出す。 */
  wallKick(ax) {
    const p = this.p;
    const n = p.cn;
    let dx = n.x * 0.85 + ax.x * 0.8;
    let dy = n.y * 0.85 + ax.y * 0.8;
    let m = Math.hypot(dx, dy);
    if (m < 0.01) { dx = n.x; dy = n.y; m = 1; }
    dx /= m; dy /= m;
    // 壁側へ蹴り込まないよう、法線成分を最低限確保する
    const d = dx * n.x + dy * n.y;
    if (d < 0.32) {
      dx += n.x * (0.32 - d) * 1.8;
      dy += n.y * (0.32 - d) * 1.8;
      m = Math.hypot(dx, dy);
      dx /= m; dy /= m;
    }
    p.vx = dx * KICK_SPD;
    p.vy = dy * KICK_SPD;
    p.vz = clamp(KICK_VZ - p.z * 0.05, 6.5, KICK_VZ);
    p.clinging = false;
    p.clingCd = 7;
    p.kickLock = 13;
    p.jumpBuf = 0;
    p.grip = Math.max(0, p.grip - 3);
    this.fx.shake = Math.max(this.fx.shake, 3);
    Sound.kick();
    Particles.burst(p.x - n.x * PR, p.y - n.y * PR, p.z, 12, {
      sp: 3.2, vz: 1.4, size: 2.6, col: '#cfe6ff', life: 20, grav: 0.16, glow: 8, shape: 'spark',
    });
  },

  land(fi) {
    const p = this.p;
    const hard = p.vz < -7;
    p.z = fi.gz;
    p.clinging = false;
    if (fi.tile === '^') {
      p.vz = PAD_VZ;
      p.onGround = false;
      Sound.pad();
      this.fx.shake = Math.max(this.fx.shake, 5);
      Particles.burst(p.x, p.y, 2, 16, {
        sp: 2.6, vz: 3.2, size: 3, col: '#ffd166', life: 26, grav: 0.16, glow: 10,
      });
      return;
    }
    if (!p.onGround) {
      Sound.land();
      Particles.burst(p.x, p.y, 1, hard ? 12 : 6, {
        sp: hard ? 2.4 : 1.4, vz: 0.7, size: 2.6, col: '#728398', life: 20, grav: 0.07,
      });
      if (hard) this.fx.shake = Math.max(this.fx.shake, 3);
    }
    p.vz = 0;
    p.onGround = true;
    p.coyote = 8;
  },

  checkSaws() {
    const p = this.p;
    if (p.invuln > 0) return;
    const top = p.z + (p.sliding ? SLIDE_H : STAND_H);
    for (const s of this.saws) {
      if (p.z > s.band[1] || top < s.band[0]) continue;
      const d = Math.hypot(p.x - s.px, p.y - s.py);
      if (d < s.rr + PR * 0.8) { this.kill(s); return; }
    }
  },

  checkPickups() {
    const p = this.p;
    for (const b of this.bolts) {
      if (b.got) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < 26 && p.z < 90) {
        b.got = true;
        Sound.bolt();
        Particles.burst(b.x, b.y, 22, 14, {
          sp: 2.2, vz: 1.6, size: 2.6, col: '#ffd166', life: 26, grav: 0.1, glow: 10,
        });
      }
    }
    for (const c of this.checks) {
      if (c.on) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y) < 30 && p.z < 70) {
        c.on = true;
        this.respawn = { x: c.x, y: c.y };
        Sound.check();
        this.hooks.toast('チェックポイント');
        Particles.burst(c.x, c.y, 8, 18, {
          sp: 2, vz: 2.4, size: 2.6, col: '#3ef29a', life: 30, grav: 0.08, glow: 10,
        });
      }
    }
    if (this.state === 'play' && Math.hypot(p.x - this.goal.x, p.y - this.goal.y) < 30 && p.z < 90) {
      this.state = 'clear';
      Sound.goal();
      Particles.burst(this.goal.x, this.goal.y, 10, 40, {
        sp: 3.4, vz: 3.4, size: 3, col: '#ffd166', life: 46, grav: 0.1, glow: 12,
      });
      this.hooks.clear();
    }
  },

  kill() {
    if (this.state !== 'play') return;
    const p = this.p;
    this.state = 'dead';
    this.deadT = 0;
    this.deaths++;
    this.fx.shake = 16;
    this.fx.hitstop = 7;
    Sound.death();
    Particles.burst(p.x, p.y, p.z + 10, 26, {
      sp: 4.2, vz: 2.6, size: 3.2, col: '#ff4d5e', life: 34, grav: 0.24, glow: 10, shape: 'chip',
    });
    Particles.burst(p.x, p.y, p.z + 10, 16, {
      sp: 5.4, vz: 3, size: 2.2, col: '#ffd7a1', life: 26, grav: 0.2, glow: 12, shape: 'spark',
    });
    this.hooks.died('blade');
  },

  startFall() {
    if (this.state !== 'play') return;
    this.state = 'fall';
    this.deadT = 0;
    this.deaths++;
    this.p.clinging = false;
    Sound.fall();
    this.hooks.died('fall');
  },

  doRespawn() {
    const p = this.p;
    p.x = this.respawn.x;
    p.y = this.respawn.y;
    p.z = 0;
    p.vx = p.vy = p.vz = 0;
    p.onGround = true;
    p.clinging = false;
    p.sliding = false;
    p.slideT = 0;
    p.grip = GRIP_MAX;
    p.invuln = 52;
    p.trail.length = 0;
    this.state = 'play';
    this.cam.x = p.x;
    this.cam.y = p.y;
    Particles.burst(p.x, p.y, 6, 12, {
      sp: 2, vz: 1.4, size: 2.4, col: '#4be1ff', life: 24, grav: 0.08, glow: 8,
    });
  },

  /** R キー：直前のチェックポイントからやり直す。 */
  retryFromCheck() {
    if (this.state === 'clear') return;
    this.deaths++;
    this.doRespawn();
  },

  updateCam(dtf) {
    const p = this.p;
    const tx = p.x + clamp(p.vx * 11, -90, 90);
    const ty = p.y + clamp(p.vy * 11, -70, 70) - p.z * 0.3;
    const k = clamp(0.11 * dtf, 0, 1);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
  },

  /* =======================================================================
     描画
     ======================================================================= */
  render(ctx, cw, ch) {
    const scale = clamp(ch / 700, 0.62, 2.6);
    const vw = cw / scale, vh = ch / scale;
    const worldW = this.W * TILE, worldH = this.H * TILE;

    let cx = worldW <= vw ? worldW / 2 : clamp(this.cam.x, vw / 2, worldW - vw / 2);
    let cy = worldH <= vh ? worldH / 2 : clamp(this.cam.y, vh / 2, worldH - vh / 2);

    const sh = this.fx.shake;
    const shx = sh > 0.2 ? rand(sh, -sh) : 0;
    const shy = sh > 0.2 ? rand(sh, -sh) : 0;

    this.drawAbyss(ctx, cw, ch, cx, cy, scale);

    ctx.save();
    ctx.translate(cw / 2 + shx, ch / 2 + shy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    const x0 = Math.max(0, Math.floor((cx - vw / 2) / TILE) - 1);
    const x1 = Math.min(this.W - 1, Math.ceil((cx + vw / 2) / TILE) + 1);
    const y0 = Math.max(0, Math.floor((cy - vh / 2) / TILE) - 2);
    const y1 = Math.min(this.H - 1, Math.ceil((cy + vh / 2) / TILE) + 2);

    this.drawFloor(ctx, x0, x1, y0, y1);
    this.drawDecals(ctx);
    this.drawShadows(ctx);
    this.drawSorted(ctx, x0, x1, y0, y1);
    Particles.draw(ctx);
    this.drawOverlayPlayer(ctx);

    ctx.restore();
  },

  /** 奈落の背景。カメラに合わせてゆっくり流れる格子を敷く。 */
  drawAbyss(ctx, cw, ch, cx, cy, scale) {
    const g = ctx.createRadialGradient(cw / 2, ch / 2, 40, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    g.addColorStop(0, '#0c1220');
    g.addColorStop(1, '#04060a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(80,120,160,.10)';
    ctx.lineWidth = 1;
    const step = 64 * scale;
    const ox = (-cx * 0.35 * scale) % step;
    const oy = (-cy * 0.35 * scale) % step;
    ctx.beginPath();
    for (let x = ox; x < cw; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, ch); }
    for (let y = oy; y < ch; y += step) { ctx.moveTo(0, y); ctx.lineTo(cw, y); }
    ctx.stroke();
    ctx.restore();
  },

  drawFloor(ctx, x0, x1, y0, y1) {
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.at(tx, ty);
        if (!isFloorChar(c)) continue;
        const X = tx * TILE, Y = ty * TILE;

        ctx.fillStyle = ((tx + ty) & 1) ? '#3b4552' : '#35404d';
        ctx.fillRect(X, Y, TILE, TILE);

        ctx.strokeStyle = 'rgba(10,14,20,.42)';
        ctx.lineWidth = 1;
        ctx.strokeRect(X + 0.5, Y + 0.5, TILE - 1, TILE - 1);

        if ((tx % 3 === 0) && (ty % 3 === 0)) {
          ctx.fillStyle = 'rgba(190,210,235,.20)';
          ctx.fillRect(X + 5, Y + 5, 3, 3);
          ctx.fillRect(X + TILE - 8, Y + TILE - 8, 3, 3);
        }
      }
    }

    // 奈落に面した縁を光らせ、外へ影を落とす
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isFloorChar(this.at(tx, ty))) continue;
        const X = tx * TILE, Y = ty * TILE;
        const N = [[0, -1, 0, 0, TILE, 0], [0, 1, 0, TILE, TILE, 0], [-1, 0, 0, 0, 0, TILE], [1, 0, TILE, 0, 0, TILE]];
        for (const [dx, dy, ex, ey, w, h] of N) {
          const n = this.at(tx + dx, ty + dy);
          if (isFloorChar(n) || isWallChar(n)) continue;
          ctx.fillStyle = 'rgba(140,170,200,.35)';
          ctx.fillRect(X + ex - (dx > 0 ? 2 : 0), Y + ey - (dy > 0 ? 2 : 0), w || 2, h || 2);
          const gx = X + ex + dx * 2, gy = Y + ey + dy * 2;
          const g2 = ctx.createLinearGradient(gx, gy, gx + dx * 12, gy + dy * 12);
          g2.addColorStop(0, 'rgba(0,0,0,.5)');
          g2.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g2;
          if (dx === 0) ctx.fillRect(X, Y + ey + (dy > 0 ? 0 : -12), TILE, 12);
          else ctx.fillRect(X + ex + (dx > 0 ? 0 : -12), Y, 12, TILE);
        }
      }
    }
  },

  /** 床に描く印（刃の通り道・ジャンプ台・チェックポイント・ゴール）。 */
  drawDecals(ctx) {
    // 刃の通り道
    for (const s of this.saws) {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = s.col;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      if (s.t === 'spin') {
        ctx.beginPath();
        ctx.arc(s.px, s.py, s.rr + 4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.t === 'orbit') {
        ctx.beginPath();
        ctx.arc(s.c.x, s.c.y, s.rad, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.10;
        ctx.lineWidth = s.rr * 2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    // ジャンプ台
    for (let ty = 0; ty < this.H; ty++) {
      for (let tx = 0; tx < this.W; tx++) {
        if (this.at(tx, ty) !== '^') continue;
        const X = tx * TILE + TILE / 2, Y = ty * TILE + TILE / 2;
        const pu = 0.5 + 0.5 * Math.sin(this.tSec * 5);
        ctx.save();
        ctx.translate(X, Y);
        ctx.fillStyle = 'rgba(255,209,102,.16)';
        ctx.beginPath(); ctx.arc(0, 0, 18 + pu * 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.55 + pu * 0.45;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(-8, 5 + i * 7);
          ctx.lineTo(0, -2 + i * 7);
          ctx.lineTo(8, 5 + i * 7);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  },

  drawShadows(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    const p = this.p;
    // プレイヤー
    if (this.state !== 'fall') {
      const k = clamp(1 - p.z / 340, 0.32, 1);
      ctx.globalAlpha = 0.42 * k;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, PR * k * (p.sliding ? 1.5 : 1.05), PR * k * 0.72, p.sliding ? p.face : 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 刃
    for (const s of this.saws) {
      const k = clamp(1 - s.zc / 300, 0.4, 1);
      ctx.globalAlpha = 0.3 * k;
      ctx.beginPath();
      ctx.ellipse(s.px, s.py + 3, s.rr * k, s.rr * k * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  /** 壁の行・刃・足場・プレイヤーを手前ほど後に描く。 */
  drawSorted(ctx, x0, x1, y0, y1) {
    const items = [];
    for (let ty = y0; ty <= y1; ty++) {
      let has = false;
      for (let tx = x0; tx <= x1; tx++) if (isWallChar(this.at(tx, ty))) { has = true; break; }
      if (has) items.push({ y: ty * TILE + TILE, k: 'wall', ty });
    }
    for (const s of this.saws) items.push({ y: s.py, k: 'saw', s });
    for (const q of this.plats) items.push({ y: q.y + q.h, k: 'plat', q });
    for (const b of this.bolts) if (!b.got) items.push({ y: b.y, k: 'bolt', b });
    for (const c of this.checks) items.push({ y: c.y, k: 'check', c });
    items.push({ y: this.goal.y, k: 'goal' });
    items.push({ y: this.p.y, k: 'player' });
    items.sort((a, b) => a.y - b.y);

    for (const it of items) {
      if (it.k === 'wall') this.drawWallRow(ctx, it.ty, x0, x1);
      else if (it.k === 'saw') this.drawSaw(ctx, it.s);
      else if (it.k === 'plat') this.drawPlat(ctx, it.q);
      else if (it.k === 'bolt') this.drawBolt(ctx, it.b);
      else if (it.k === 'check') this.drawCheck(ctx, it.c);
      else if (it.k === 'goal') this.drawGoal(ctx);
      else if (it.k === 'player') this.drawPlayer(ctx, false);
    }
  },

  drawWallRow(ctx, ty, x0, x1) {
    for (let tx = x0; tx <= x1; tx++) {
      const c = this.at(tx, ty);
      if (!isWallChar(c)) continue;
      const X = tx * TILE, Y = ty * TILE;
      const fence = c === 'n';
      const ext = fence ? EXT * 1.7 : EXT;
      const south = this.at(tx, ty + 1);

      // 側面
      if (!isWallChar(south)) {
        const g = ctx.createLinearGradient(0, Y + TILE - ext, 0, Y + TILE);
        if (fence) { g.addColorStop(0, '#6a5a1e'); g.addColorStop(1, '#2b2408'); }
        else { g.addColorStop(0, '#48566d'); g.addColorStop(1, '#12171f'); }
        ctx.fillStyle = g;
        ctx.fillRect(X, Y + TILE - ext, TILE, ext);
        if (fence) {
          ctx.save();
          ctx.beginPath(); ctx.rect(X, Y + TILE - ext, TILE, ext); ctx.clip();
          ctx.strokeStyle = 'rgba(255,209,102,.65)';
          ctx.lineWidth = 5;
          for (let i = -ext; i < TILE + ext; i += 14) {
            ctx.beginPath();
            ctx.moveTo(X + i, Y + TILE);
            ctx.lineTo(X + i + ext, Y + TILE - ext);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // 上面
      const ty0 = Y - ext;
      ctx.fillStyle = fence ? '#7d6a26' : (((tx + ty) & 1) ? '#5b6b80' : '#556478');
      ctx.fillRect(X, ty0, TILE, TILE);
      ctx.fillStyle = fence ? 'rgba(255,220,140,.5)' : 'rgba(180,205,235,.45)';
      ctx.fillRect(X, ty0, TILE, 2);

      // 掴める縁（手前側）を示す細い線
      if (!isWallChar(south)) {
        ctx.fillStyle = fence ? 'rgba(255,209,102,.45)' : 'rgba(75,225,255,.42)';
        ctx.fillRect(X, ty0 + TILE - 2, TILE, 2);
      }
      // リベット
      if (!fence && (tx + ty) % 2 === 0) {
        ctx.fillStyle = 'rgba(200,220,245,.13)';
        ctx.fillRect(X + 6, ty0 + 7, 3, 3);
        ctx.fillRect(X + TILE - 9, ty0 + 7, 3, 3);
      }
    }
  },

  drawSaw(ctx, s) {
    const sy = s.py - s.zc * 0.55;

    // 支持アーム（吊り刃・公転刃）
    if (s.t === 'orbit') {
      ctx.save();
      ctx.strokeStyle = 'rgba(160,180,205,.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.c.x, s.c.y - s.zc * 0.55);
      ctx.lineTo(s.px, sy);
      ctx.stroke();
      ctx.fillStyle = '#5a6678';
      ctx.beginPath(); ctx.arc(s.c.x, s.c.y - s.zc * 0.55, 7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (s.zc > 20) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,140,165,.30)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(s.px, s.py);
      ctx.lineTo(s.px, sy);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(s.px, sy);

    // 回転のブレ
    for (let g = 2; g >= 1; g--) {
      ctx.save();
      ctx.rotate(s.ang - Math.sign(s.spd) * g * 0.16);
      ctx.globalAlpha = 0.18;
      this.bladePath(ctx, s.rr);
      ctx.fillStyle = '#8fa1b6';
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(s.ang);
    this.bladePath(ctx, s.rr);
    const g = ctx.createLinearGradient(-s.rr, -s.rr, s.rr, s.rr);
    g.addColorStop(0, '#eef4fb');
    g.addColorStop(0.45, '#9fb0c6');
    g.addColorStop(0.6, '#d8e3ef');
    g.addColorStop(1, '#6d7d92');
    ctx.fillStyle = g;
    ctx.shadowColor = s.col;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 縁の色（刃の種類）
    ctx.strokeStyle = s.col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(0, 0, s.rr * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ハブ
    ctx.fillStyle = '#3b4658';
    ctx.beginPath(); ctx.arc(0, 0, s.rr * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b9aae';
    ctx.beginPath(); ctx.arc(0, 0, s.rr * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6d7d92';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s.rr * 0.32, Math.sin(a) * s.rr * 0.32);
      ctx.lineTo(Math.cos(a) * s.rr * 0.72, Math.sin(a) * s.rr * 0.72);
      ctx.stroke();
    }
    ctx.restore();
  },

  bladePath(ctx, r) {
    const teeth = clamp(Math.round(r / 4.4), 10, 26);
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = ((i + 0.45) / teeth) * Math.PI * 2;
      const a2 = ((i + 1) / teeth) * Math.PI * 2;
      ctx.lineTo(Math.cos(a0) * r * 0.82, Math.sin(a0) * r * 0.82);
      ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      ctx.lineTo(Math.cos(a2) * r * 0.82, Math.sin(a2) * r * 0.82);
    }
    ctx.closePath();
  },

  drawPlat(ctx, q) {
    const ext = 8;
    ctx.save();
    // 側面
    const g = ctx.createLinearGradient(0, q.y + q.h - ext, 0, q.y + q.h);
    g.addColorStop(0, '#4a4270');
    g.addColorStop(1, '#1d1a2e');
    ctx.fillStyle = g;
    ctx.fillRect(q.x, q.y + q.h - ext, q.w, ext);
    // 天板
    ctx.fillStyle = '#3b3557';
    ctx.fillRect(q.x, q.y - ext, q.w, q.h);
    ctx.strokeStyle = 'rgba(157,140,255,.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(q.x + 1, q.y - ext + 1, q.w - 2, q.h - 2);
    // 進行方向の矢印
    const dx = q.b.x - q.a.x, dy = q.b.y - q.a.y;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      const ux = dx / m, uy = dy / m;
      const cxp = q.x + q.w / 2, cyp = q.y - ext + q.h / 2;
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.tSec * 6);
      ctx.strokeStyle = '#c9bcff';
      ctx.lineWidth = 3;
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(cxp - ux * 12 + uy * 8 * i, cyp - uy * 12 - ux * 8 * i);
        ctx.lineTo(cxp + ux * 8, cyp + uy * 8);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  drawBolt(ctx, b) {
    const bob = Math.sin(this.tSec * 3 + b.x * 0.01) * 4;
    const sy = b.y - 20 - bob;
    ctx.save();
    if (b.air) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(b.x, b.y, 12, 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.translate(b.x, sy);
    ctx.rotate(this.tSec * 1.6);
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      const a1 = ((i + 0.5) / 8) * Math.PI * 2;
      ctx.lineTo(Math.cos(a0) * 10, Math.sin(a0) * 10);
      ctx.lineTo(Math.cos(a1) * 7, Math.sin(a1) * 7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3a2f10';
    ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  drawCheck(ctx, c) {
    const col = c.on ? '#3ef29a' : '#5d6b7d';
    ctx.save();
    ctx.globalAlpha = c.on ? 0.28 : 0.14;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 20, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x, c.y - 34);
    ctx.stroke();
    ctx.fillStyle = col;
    if (c.on) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
    const w = 18 + (c.on ? Math.sin(this.tSec * 4) * 2 : 0);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 34);
    ctx.lineTo(c.x + w, c.y - 28);
    ctx.lineTo(c.x, c.y - 22);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  },

  drawGoal(ctx) {
    const g = this.goal;
    const t = this.tSec;
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.08 * Math.sin(t * 4);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // 光の柱
    const lg = ctx.createLinearGradient(0, g.y - 120, 0, g.y);
    lg.addColorStop(0, 'rgba(255,209,102,0)');
    lg.addColorStop(1, 'rgba(255,209,102,.34)');
    ctx.fillStyle = lg;
    ctx.fillRect(g.x - 18, g.y - 120, 36, 120);

    // 旗
    ctx.strokeStyle = '#d9e4f2';
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(g.x - 12, g.y); ctx.lineTo(g.x - 12, g.y - 52); ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const y = g.y - 52 + i * 8;
      const w = 26 + Math.sin(t * 5 + i) * 3;
      ctx.lineTo(g.x - 12 + w, y + 4);
      ctx.lineTo(g.x - 12, y + 8);
    }
    ctx.lineTo(g.x - 12, g.y - 52);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0f16';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL', g.x + 1, g.y - 40);
    ctx.restore();
  },

  /** 壁の陰に隠れたときのために、最後にうっすら重ねる。 */
  drawOverlayPlayer(ctx) {
    const p = this.p;
    const south = this.at(Math.floor(p.x / TILE), Math.floor((p.y + TILE * 0.55) / TILE));
    if (!isWallChar(south)) return;
    ctx.save();
    ctx.globalAlpha = 0.42;
    this.drawPlayer(ctx, true);
    ctx.restore();
  },

  drawPlayer(ctx, ghost) {
    const p = this.p;
    if (this.state === 'dead') return;
    const fall = this.state === 'fall';
    const sc = fall ? clamp(1 + p.z / 260, 0.15, 1) : 1;
    const sy = p.y - p.z * 0.55;

    // 高さを示す線
    if (!ghost && p.z > 6 && !fall) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,190,220,.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, sy + 8);
      ctx.stroke();
      ctx.restore();
    }

    // 残像
    if (!ghost) {
      for (const t of p.trail) {
        ctx.save();
        ctx.globalAlpha = (t.life / 12) * 0.22;
        ctx.translate(t.x, t.y - t.z * 0.55);
        ctx.rotate(t.a);
        ctx.fillStyle = '#4be1ff';
        if (t.slide) ctx.fillRect(-14, -5, 28, 10);
        else ctx.fillRect(-9, -7, 18, 14);
        ctx.restore();
      }
    }

    ctx.save();
    ctx.translate(p.x, sy);
    ctx.scale(sc * 1.18, sc * 1.18);
    ctx.rotate(p.face);
    if (!ghost) { ctx.shadowColor = 'rgba(10,16,24,.9)'; ctx.shadowBlur = 7; }
    if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0) ctx.globalAlpha *= 0.45;

    const swing = Math.sin(p.runPhase) * (p.onGround && !p.sliding ? 4 : 1.6);

    // スカーフ（後ろへなびく）
    ctx.fillStyle = ghost ? '#7ad9ff' : '#e8434f';
    ctx.beginPath();
    ctx.moveTo(-7, -4);
    ctx.quadraticCurveTo(-17 - Math.abs(swing), -7 + swing * 1.5, -25, -1 + swing * 2);
    ctx.quadraticCurveTo(-16, 2 + swing, -7, 4);
    ctx.closePath();
    ctx.fill();

    if (p.sliding) {
      // 滑り込み：体を寝かせる
      ctx.fillStyle = ghost ? '#9fe8ff' : '#e7eef8';
      ctx.beginPath();
      ctx.ellipse(1, 0, 14, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ghost ? '#cdf3ff' : '#f5dcc2';
      ctx.beginPath();
      ctx.arc(12, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b3b50';
      ctx.fillRect(13, -3.4, 3, 6.8);
    } else {
      // 胴（肩幅を持たせる）
      const bg = ctx.createLinearGradient(-9, -9, 6, 9);
      bg.addColorStop(0, ghost ? '#cdf3ff' : '#ffffff');
      bg.addColorStop(1, ghost ? '#7ad9ff' : '#b6c6da');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(-9, -9, 17, 18, 6);
      ctx.fill();
      ctx.fillStyle = ghost ? '#9fe8ff' : '#8a9cb4';
      ctx.fillRect(-9, -1.2, 15, 2.4);

      // 腕（走りに合わせて前後する）
      ctx.fillStyle = ghost ? '#7fd8f2' : '#2f4055';
      ctx.save();
      ctx.translate(0, -10.2 - swing * 0.25);
      ctx.rotate(swing * 0.05);
      ctx.beginPath(); ctx.roundRect(-4, -2.5, 13, 5, 2.5); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(0, 10.2 + swing * 0.25);
      ctx.rotate(-swing * 0.05);
      ctx.beginPath(); ctx.roundRect(-4, -2.5, 13, 5, 2.5); ctx.fill();
      ctx.restore();

      // 頭とゴーグル
      ctx.fillStyle = ghost ? '#e6faff' : '#f5dcc2';
      ctx.beginPath(); ctx.arc(2.5, 0, 6.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ghost ? '#8fdcf5' : '#2b3b50';
      ctx.beginPath(); ctx.arc(2.5, 0, 6.4, Math.PI * 0.62, Math.PI * 1.38); ctx.fill();
      ctx.fillStyle = '#4be1ff';
      ctx.beginPath(); ctx.roundRect(4.6, -4.4, 3.6, 8.8, 1.6); ctx.fill();
    }

    // 掴まっているときの手
    if (p.clinging && !ghost) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(11, -5, 3, 0, Math.PI * 2);
      ctx.arc(11, 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 握力が少ないときの警告リング
    if (!ghost && p.clinging && p.grip < 34) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this.tSec * 18);
      ctx.strokeStyle = '#ff8a3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, sy, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  },
};
