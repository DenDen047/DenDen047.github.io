/* =========================================================================
   マルの伝説 ― ゲーム本体
   部屋の組み立て・当たり判定・画面切りかえ・勇者の操作・会話・アイテム入手・仕掛け
   ========================================================================= */

const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const DIR_NAMES = ['up', 'down', 'left', 'right'];
const DIR_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const SIDE_VEC = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const DOOR_CELLS = { n: [[7, 0], [8, 0]], s: [[7, 10], [8, 10]], w: [[0, 5]], e: [[15, 5]] };
const DOOR_CHAR = { locked: 'L', boss: 'K', shut: 'Z', bomb: 'x' };

const SWING_DUR = 0.22;     // 剣をふる時間
const SPIN_DUR = 0.42;      // 回転斬りの時間
const CHARGE_FULL = 0.8;    // 回転斬りに必要なため時間
const WALK_SPEED = 100;

const pxOf = (c) => (c + 0.5) * TS;   // タイル座標 → 中心のpx

function newSave() {
  return {
    maxHp: 6, hp: 6,                  // ライフは半ハート単位（6 = ハート3つ）
    gems: 0, bombs: 0, maxBombs: 0,
    items: { sword: false, boomerang: false, bombbag: false },
    bItem: null, orbs: 0,
    keys: {}, bigkey: {}, flags: {},
    cp: { area: 'ow', room: '1,2', x: 8 * TS, y: 8.5 * TS, dir: 'up' },   // やられたときの再開地点
    ret: null,                        // 洞窟や神殿を出たときに戻る地上の位置
    time: 0, deaths: 0,
  };
}

function makePlayer(x, y, dir) {
  return {
    x, y, hw: 9, hh: 9, dir: dir || 'down',
    state: 'walk',          // walk | swing | charge | spin
    swingT: 0, charge: 0, hitSet: null, angle: 0, prevAngle: 0,
    inv: 0, kbx: 0, kby: 0, kbT: 0,
    walk: 0, moving: false, pushT: 0, bumpMsgT: 0,
    deadT: 0,
  };
}

/** 点 (px, py) と線分の距離。 */
function segDist(px, py, x0, y0, x1, y1) {
  const vx = x1 - x0, vy = y1 - y0;
  const L = vx * vx + vy * vy || 1;
  const k = clamp(((px - x0) * vx + (py - y0) * vy) / L, 0, 1);
  return Math.hypot(px - (x0 + vx * k), py - (y0 + vy * k));
}

function dirToward(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

function edgeId(key, side) {
  let [x, y] = key.split(',').map(Number);
  if (side === 's') { y += 1; side = 'n'; }
  if (side === 'e') { x += 1; side = 'w'; }
  return `${x},${y}${side}`;
}

function sideOfCell(c, r) {
  if (r === 0) return 'n';
  if (r === ROWS - 1) return 's';
  if (c === 0) return 'w';
  return 'e';
}

const Game = {
  S: null,
  areaId: 'ow', roomKey: '1,2', room: null,
  player: null,
  enemies: [], projs: [], pickups: [], fx: [], npcs: [], shop: [],
  mode: 'title',          // title | play | scroll | warp | dialog | itemget | dead | ending
  trans: null, dialog: null, itemget: null, toastMsg: null,
  cleared: new Set(),     // この神殿に入ってから全滅させた部屋
  arrive: [],             // 画面切りかえが終わってから実行すること
  roomHadEnemies: false,
  t: 0, shake: 0, hitStop: 0,
  hooks: {},              // main から: save / gameover / ending

  /* ===================== 開始・再開 ===================== */
  newGame() {
    this.S = newSave();
    this.areaId = null;
    this.spawnAt(this.S.cp);
    this.say(TEXT.story);
  },

  loadGame(data) {
    this.S = Object.assign(newSave(), data);
    this.S.hp = Math.max(this.S.hp, Math.min(this.S.maxHp, 6));
    this.areaId = null;
    this.spawnAt(this.S.cp);
  },

  /** ゲームオーバーから続ける。 */
  respawn() {
    this.S.hp = Math.min(this.S.maxHp, 6);
    this.areaId = null;
    this.spawnAt(this.S.cp);
  },

  /** タイトル画面の背景用に、はじまりの草原を置いておく。 */
  titleScene() {
    this.mode = 'title';
    this.S = newSave();
    this.areaId = null;
    this.player = makePlayer(8 * TS, 7.5 * TS, 'down');
    this.enterArea('ow', '1,2');
    this.enemies = [];
  },

  spawnAt(cp) {
    this.player = makePlayer(cp.x, cp.y, cp.dir || 'down');
    this.mode = 'play';
    this.trans = null;
    this.dialog = null;
    this.itemget = null;
    this.enterArea(cp.area, cp.room);
    this.runArrive();
  },

  save() {
    // タイトル画面の背景用の仮データは保存しない（本物のセーブを上書きしてしまう）
    if (this.mode === 'title') return;
    if (this.hooks.save) this.hooks.save(this.S);
  },

  flag(k) { return !!this.S.flags[k]; },
  setFlag(k) { this.S.flags[k] = 1; },
  evKey() { return `ev:${this.areaId}:${this.roomKey}`; },
  dropKey() { return `drop:${this.areaId}:${this.roomKey}`; },
  gateOpen() { return this.S.orbs >= 2; },

  /* ===================== 部屋の組み立て ===================== */
  /** 扉の種類。自分で書いていなければ隣の部屋の反対側を見る。 */
  doorType(areaId, key, side) {
    const rooms = AREAS[areaId].rooms;
    const def = rooms[key];
    if (def.doors && def.doors[side]) return def.doors[side];
    const [x, y] = key.split(',').map(Number);
    const [dx, dy] = SIDE_VEC[side];
    const nb = rooms[`${x + dx},${y + dy}`];
    const t = nb && nb.doors && nb.doors[OPP[side]];
    return t && t !== 'exit' ? t : null;
  },

  buildRoom(areaId, key) {
    const area = AREAS[areaId];
    const def = area.rooms[key];
    let grid;
    if (area.kind === 'field') {
      grid = def.map.map((s) => s.split(''));
      if (this.flag(`bomb:${areaId}:${key}`)) grid = grid.map((row) => row.map((ch) => (ch === 'X' ? 'C' : ch)));
    } else {
      const wall = area.kind === 'cave' ? 'w' : '#';
      grid = [];
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
          const edge = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1;
          row.push(edge ? wall : def.map[r - 1][c - 1]);
        }
        grid.push(row);
      }
      if (area.kind === 'cave') {
        grid[ROWS - 1][7] = 'e';
        grid[ROWS - 1][8] = 'e';
      } else {
        for (const side of ['n', 's', 'e', 'w']) {
          const type = this.doorType(areaId, key, side);
          if (!type) continue;
          let ch = 'd';
          if (DOOR_CHAR[type] && !this.flag(`door:${areaId}:${edgeId(key, side)}`)) ch = DOOR_CHAR[type];
          for (const [c, r] of DOOR_CELLS[side]) grid[r][c] = ch;
        }
      }
    }
    const evDone = this.flag(`ev:${areaId}:${key}`);
    if (evDone) grid = grid.map((row) => row.map((ch) => (ch === 'P' ? 'b' : ch)));
    (def.chests || []).forEach((ch, i) => {
      if (ch.hidden && !evDone) return;
      grid[ch.r][ch.c] = this.flag(`chest:${areaId}:${key}:${i}`) ? 'j' : 'h';
    });
    return { areaId, key, area, def, grid, kind: area.kind, theme: area.theme || area.kind, evDone };
  },

  enterArea(areaId, key) {
    if (areaId !== this.areaId) this.cleared = new Set();
    this.areaId = areaId;
    this.roomKey = key;
    this.room = this.buildRoom(areaId, key);
    this.enterRoom();
  },

  /** 部屋に入ったときに敵・人・品物を置く。 */
  enterRoom() {
    const { def, area } = this.room;
    const S = this.S;
    this.enemies = [];
    this.projs = [];
    this.pickups = [];
    this.fx = [];
    this.npcs = [];
    this.shop = [];
    this.arrive = [];
    S.flags[`v:${this.areaId}:${this.roomKey}`] = 1;

    (def.npcs || []).forEach((n) => this.npcs.push(Object.assign({}, n, { x: pxOf(n.c), y: pxOf(n.r), anim: Math.random() * 6 })));
    (def.shop || []).forEach((s, i) => {
      this.shop.push(Object.assign({}, s, { i, x: pxOf(s.c), y: pxOf(s.r), sold: s.once && this.flag(`shop:${this.areaId}:${i}`) }));
    });
    (def.items || []).forEach((it, i) => {
      const fk = `item:${this.areaId}:${this.roomKey}:${i}`;
      if (!it.every && this.flag(fk)) return;
      this.addPickup(it.t, pxOf(it.c), pxOf(it.r), { flag: it.every ? null : fk, stay: true });
    });
    const ev = def.event;
    if (ev && ev.drop && this.flag(this.evKey()) && !this.flag(this.dropKey())) {
      this.addPickup(ev.drop.t, pxOf(ev.drop.c), pxOf(ev.drop.r), { flag: this.dropKey(), stay: true });
    }

    let music = area.bgm;
    if (def.boss) {
      if (!this.flag(`boss:${this.areaId}`)) {
        const b = makeEnemy(def.boss, RW / 2, RH / 2 - 24, 0);
        this.enemies.push(b);
        this.seal();
        music = 'boss';
        if (def.boss === 'mao') this.arrive.push(() => this.say(TEXT.mao_intro));
      } else {
        this.spawnBossRewards(false);
        music = null;
      }
    } else if (def.enemies && !this.cleared.has(this.roomKey)) {
      def.enemies.forEach(([type, c, r]) => this.enemies.push(makeEnemy(type, pxOf(c), pxOf(r), 0.3 + Math.random() * 0.4)));
    }
    this.roomHadEnemies = this.enemies.length > 0;
    Sound.bgm(music);

    // 洞窟の住人は、まだ渡す物があるときだけ話しかけてくる
    const host = this.npcs[0];
    if (host && host.t !== 'fairy') {
      const hasGift = host.gift && !this.flag(`gift:${this.areaId}`);
      if (def.shop || hasGift || this.pickups.some((p) => p.flag)) this.arrive.push(() => this.talk(host));
    }
    if (this.areaId === 'ow' && this.roomKey === '1,0' && this.gateOpen() && !this.flag('gate')) {
      this.setFlag('gate');
      this.arrive.push(() => { Sound.play('secret'); this.say(TEXT.gate_open); });
    }
    this.save();
  },

  runArrive() {
    const list = this.arrive;
    this.arrive = [];
    list.forEach((fn) => fn());
  },

  /** ボス戦のあいだ扉を閉める。 */
  seal() {
    this.room.sealed = [];
    for (const side of ['n', 's', 'e', 'w']) {
      for (const [c, r] of DOOR_CELLS[side]) {
        const ch = this.room.grid[r][c];
        if (ch === 'd') { this.room.sealed.push([c, r]); this.room.grid[r][c] = 'Z'; }
      }
    }
  },

  unseal() {
    (this.room.sealed || []).forEach(([c, r]) => { this.room.grid[r][c] = 'd'; });
    this.room.sealed = [];
    Sound.play('door');
  },

  /* ===================== 当たり判定 ===================== */
  tileAt(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
    return this.room.grid[r][c];
  },

  isSolidTile(ch, who) {
    if (ch == null) return true;
    const info = TILE_INFO[ch];
    if (!info) return false;
    if (who === 'player') return ch === 'G' ? !this.gateOpen() : !!info.solid;
    if (who === 'fly' || who === 'proj') return !!info.solid && !info.low;
    return !!info.solid || !!info.door;
  },

  solidAt(px, py, who) {
    const c = Math.floor(px / TS), r = Math.floor(py / TS);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return who !== 'player';
    return this.isSolidTile(this.room.grid[r][c], who);
  },

  boxSolid(x, y, hw, hh, who) {
    const x0 = x - hw, x1 = x + hw - 0.01, y0 = y - hh, y1 = y + hh - 0.01;
    const nx = Math.ceil((x1 - x0) / 16), ny = Math.ceil((y1 - y0) / 16);
    for (let i = 0; i <= nx; i++) {
      const px = x0 + ((x1 - x0) * i) / nx;
      if (this.solidAt(px, y0, who) || this.solidAt(px, y1, who)) return true;
    }
    for (let j = 1; j < ny; j++) {
      const py = y0 + ((y1 - y0) * j) / ny;
      if (this.solidAt(x0, py, who) || this.solidAt(x1, py, who)) return true;
    }
    if (who === 'player') {
      for (const n of this.npcs) if (!n.float && Math.abs(n.x - x) < hw + 10 && Math.abs(n.y - y) < hh + 10) return true;
      for (const s of this.shop) if (Math.abs(s.x - x) < hw + 9 && Math.abs(s.y - y) < hh + 9) return true;
    }
    return false;
  },

  /** 壁に沿ってすべりながら動く。どの軸でぶつかったかを返す。 */
  moveBox(e, dx, dy, who) {
    const res = { x: false, y: false };
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
    const sx = dx / steps, sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx) {
        if (!this.boxSolid(e.x + sx, e.y, e.hw, e.hh, who)) e.x += sx;
        else { res.x = true; if (who === 'player' && !dy) this.nudge(e, 'y', sx); }
      }
      if (sy) {
        if (!this.boxSolid(e.x, e.y + sy, e.hw, e.hh, who)) e.y += sy;
        else { res.y = true; if (who === 'player' && !dx) this.nudge(e, 'x', sy); }
      }
    }
    return res;
  },

  /** 角が少しだけ引っかかっているなら、通れる側へ寄せる（扉や細道に入りやすくする）。 */
  nudge(e, axis, push) {
    const amt = Math.abs(push);
    for (let o = 1; o <= 12; o++) {
      for (const s of [-1, 1]) {
        const ox = axis === 'x' ? s * o : 0, oy = axis === 'y' ? s * o : 0;
        const tx = e.x + ox + (axis === 'y' ? push : 0);
        const ty = e.y + oy + (axis === 'x' ? push : 0);
        if (!this.boxSolid(tx, ty, e.hw, e.hh, 'player') && !this.boxSolid(e.x + ox, e.y + oy, e.hw, e.hh, 'player')) {
          if (axis === 'x') e.x += s * Math.min(amt, o);
          else e.y += s * Math.min(amt, o);
          return;
        }
      }
    }
  },

  /* ===================== 毎フレームの更新 ===================== */
  update(dt) {
    this.t += dt;
    if (this.toastMsg) { this.toastMsg.t -= dt; if (this.toastMsg.t <= 0) this.toastMsg = null; }
    this.shake = Math.max(0, this.shake - dt);
    switch (this.mode) {
      case 'play':
        if (this.hitStop > 0) { this.hitStop -= dt; break; }
        this.S.time += dt;
        this.updatePlay(dt);
        break;
      case 'title': this.updateFx(dt); break;
      case 'scroll': this.updateScroll(dt); break;
      case 'warp': this.updateWarp(dt); break;
      case 'dialog': this.updateDialog(dt); this.updateFx(dt); break;
      case 'itemget': this.updateItemget(dt); this.updateFx(dt); break;
      case 'dead': this.updateDead(dt); break;
      default: break;
    }
  },

  updatePlay(dt) {
    if (Input.pressed('swap')) this.swapItem();
    this.updatePlayer(dt);
    if (this.mode !== 'play') return;
    this.enemies.forEach((e) => updateEnemy(e, dt));
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.updateProjs(dt);
    this.updatePickups(dt);
    this.updateFx(dt);
    this.npcs.forEach((n) => { n.anim += dt; });
    this.checkClear();
  },

  /* ===================== 勇者 ===================== */
  updatePlayer(dt) {
    const p = this.player, S = this.S;
    p.inv = Math.max(0, p.inv - dt);
    p.bumpMsgT = Math.max(0, p.bumpMsgT - dt);

    if (p.kbT > 0) {
      p.kbT -= dt;
      this.moveBox(p, p.kbx * dt, p.kby * dt, 'player');
      p.moving = false;
      return;
    }

    if (p.state === 'swing') {
      p.swingT += dt;
      const base = DIR_ANGLE[p.dir];
      const k = Math.min(1, p.swingT / SWING_DUR);
      p.prevAngle = p.angle;
      p.angle = base - 1.6 + 2.5 * (1 - Math.pow(1 - k, 2));
      this.swordSweep(p.prevAngle, p.angle, 30, 1);
      if (k >= 1) {
        if (Input.held('a')) { p.state = 'charge'; p.charge = 0; }
        else p.state = 'walk';
      }
      return;
    }

    if (p.state === 'spin') {
      p.swingT += dt;
      const base = DIR_ANGLE[p.dir];
      const k = Math.min(1, p.swingT / SPIN_DUR);
      p.prevAngle = p.angle;
      p.angle = base + Math.PI * 2 * k;
      this.swordSweep(p.prevAngle, p.angle, 36, 2);
      if (k >= 1) p.state = 'walk';
      return;
    }

    // 歩く（ため中はゆっくり、向きは変えない）
    const ax = Input.axis();
    const charging = p.state === 'charge';
    const speed = charging ? 60 : WALK_SPEED;
    p.moving = !!(ax.x || ax.y);
    if (p.moving) {
      if (!charging) {
        const cur = DIRS[p.dir];
        const keepCur = (cur.x && Math.sign(ax.x) === cur.x && Math.abs(ax.x) > 0.3) || (cur.y && Math.sign(ax.y) === cur.y && Math.abs(ax.y) > 0.3);
        if (!keepCur) {
          if (Math.abs(ax.x) > Math.abs(ax.y)) p.dir = ax.x > 0 ? 'right' : 'left';
          else p.dir = ax.y > 0 ? 'down' : 'up';
        }
      }
      p.walk += dt * 10;
      const hit = this.moveBox(p, ax.x * speed * dt, ax.y * speed * dt, 'player');
      this.handlePush(p, ax, hit, dt);
    } else {
      p.pushT = 0;
    }

    if (charging) {
      const before = p.charge;
      p.charge += dt;
      if (before < CHARGE_FULL && p.charge >= CHARGE_FULL) Sound.play('charged');
      if (!Input.held('a')) {
        if (p.charge >= CHARGE_FULL) {
          p.state = 'spin';
          p.swingT = 0;
          p.angle = DIR_ANGLE[p.dir];
          p.hitSet = new Set();
          Sound.play('spin');
        } else p.state = 'walk';
        p.charge = 0;
      }
    } else {
      if (Input.pressed('a')) {
        if (!this.tryInteract() && S.items.sword) this.startSwing();
      } else if (Input.pressed('b')) {
        this.useItem();
      }
    }

    this.checkWarp();
    if (this.mode === 'play') this.checkEdges();
  },

  startSwing() {
    const p = this.player, S = this.S;
    p.state = 'swing';
    p.swingT = 0;
    p.hitSet = new Set();
    p.angle = DIR_ANGLE[p.dir] - 1.6;
    Sound.play('swing');
    if (S.hp >= S.maxHp && !this.projs.some((q) => q.t === 'beam')) {
      const d = DIRS[p.dir];
      this.projs.push({ t: 'beam', x: p.x + d.x * 16, y: p.y + d.y * 16 - 2, vx: d.x * 330, vy: d.y * 330, dir: p.dir, r: 7, life: 1.4 });
      Sound.play('beam');
    }
  },

  /** 剣の刃（中心から r1 まで）を角度 a0→a1 で掃き、当たった物を処理する。 */
  swordSweep(a0, a1, r1, dmg) {
    const p = this.player;
    const ox = p.x, oy = p.y - 2;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const a = lerp(a0, a1, i / steps);
      const cx = Math.cos(a), cy = Math.sin(a);
      const x0 = ox + cx * 8, y0 = oy + cy * 8, x1 = ox + cx * r1, y1 = oy + cy * r1;
      for (const e of this.enemies) {
        if (p.hitSet.has(e)) continue;
        const parts = enemyParts(e);
        if (parts.some((pt) => segDist(pt.x, pt.y, x0, y0, x1, y1) < pt.r + 2)) {
          p.hitSet.add(e);
          this.hitEnemy(e, dmg, ox, oy, 'sword');
        }
      }
      for (const q of this.projs) {
        if (q.dead || segDist(q.x, q.y, x0, y0, x1, y1) > q.r + 4) continue;
        if (q.t === 'rock') { q.dead = true; this.burst(q.x, q.y, '#ddd', 5); Sound.play('clink'); }
        else if (q.t === 'morb' && q.owner === 'enemy') this.reflectOrb(q);
      }
      for (const [tx, ty] of [[x1, y1], [lerp(x0, x1, 0.55), lerp(y0, y1, 0.55)]]) {
        const c = Math.floor(tx / TS), r = Math.floor(ty / TS);
        const ch = this.tileAt(c, r);
        if (ch === 'B') this.cutBush(c, r);
        else if (ch === 'o') this.hitSwitch(c, r);
      }
    }
  },

  cutBush(c, r) {
    this.room.grid[r][c] = '.';
    Sound.play('cut');
    for (let i = 0; i < 8; i++) {
      this.fx.push({ t: 'p', x: pxOf(c) + rand(-8, 8), y: pxOf(r) + rand(-8, 8), vx: rand(-70, 70), vy: rand(-90, 10), g: 220, life: 0.5, max: 0.5, r: rand(2, 3.5), color: i % 2 ? '#5cbf55' : '#3f9c3f' });
    }
    if (Math.random() < 0.3) this.rollDrop(pxOf(c), pxOf(r));
  },

  hitSwitch(c, r) {
    if (this.flag(this.evKey())) return;
    Sound.play('switch');
    this.burst(pxOf(c), pxOf(r), '#7fe3ff', 10);
    this.triggerEvent('switch');
  },

  /** 押しても動かない方向に歩き続けたら、ブロックを押す・鍵を開ける。 */
  handlePush(p, ax, hit, dt) {
    const pure = (Math.abs(ax.x) > 0.7 && Math.abs(ax.y) < 0.3) || (Math.abs(ax.y) > 0.7 && Math.abs(ax.x) < 0.3);
    const d = DIRS[p.dir];
    const blocked = (d.x && hit.x) || (d.y && hit.y);
    if (!pure || !blocked) { p.pushT = 0; return; }
    p.pushT += dt;
    const c = Math.floor((p.x + d.x * (p.hw + 4)) / TS);
    const r = Math.floor((p.y + d.y * (p.hh + 4)) / TS);
    const ch = this.tileAt(c, r);
    const S = this.S;
    if (ch === 'P' && p.pushT > 0.35) {
      this.pushBlock(c, r, d);
      p.pushT = 0;
    } else if ((ch === 'L' || ch === 'K') && p.pushT > 0.12) {
      const side = sideOfCell(c, r);
      if (ch === 'L' && (S.keys[this.areaId] || 0) > 0) {
        S.keys[this.areaId]--;
        this.openDoor(side, 'unlock');
      } else if (ch === 'K' && S.bigkey[this.areaId]) {
        this.openDoor(side, 'unlock');
      } else if (p.bumpMsgT <= 0) {
        this.toast(ch === 'K' ? 'ボスの鍵が ひつようだ。' : '鍵が かかっている。');
        p.bumpMsgT = 2;
      }
      p.pushT = 0;
    }
  },

  pushBlock(c, r, d) {
    const dc = c + d.x, dr = r + d.y;
    const dest = this.tileAt(dc, dr);
    if (dest !== '.' && dest !== ',') return;
    const g = this.room.grid;
    g[r][c] = '_';
    g[dr][dc] = '_';
    Sound.play('push');
    this.fx.push({
      t: 'block', x: pxOf(c), y: pxOf(r), x0: pxOf(c), y0: pxOf(r), x1: pxOf(dc), y1: pxOf(dr), life: 0.35, max: 0.35,
      done: () => { g[r][c] = '.'; g[dr][dc] = 'b'; this.triggerEvent('block'); },
    });
  },

  /** 扉を開ける（鍵・爆弾・シャッター）。両側の部屋で開いたままになる。 */
  openDoor(side, how) {
    this.setFlag(`door:${this.areaId}:${edgeId(this.roomKey, side)}`);
    for (const [c, r] of DOOR_CELLS[side]) {
      this.room.grid[r][c] = 'd';
      this.burst(pxOf(c), pxOf(r), how === 'bomb' ? '#c9a27a' : '#ffe08a', 6);
    }
    Sound.play(how === 'unlock' ? 'unlock' : 'door');
    if (how === 'bomb') Sound.play('secret');
    this.save();
  },

  /** 目の前の人・宝箱・看板を調べる。何かあれば true。 */
  tryInteract() {
    const p = this.player;
    const d = DIRS[p.dir];
    const fx = p.x + d.x * 20, fy = p.y + d.y * 20;
    for (const n of this.npcs) {
      if (dist(n.x, n.y, fx, fy) < (n.reach || 28)) { this.talk(n); return true; }
    }
    for (const s of this.shop) {
      if (dist(s.x, s.y, fx, fy) < 24) { this.buy(s); return true; }
    }
    const c = Math.floor(fx / TS), r = Math.floor(fy / TS);
    const ch = this.tileAt(c, r);
    if (ch === 's') {
      const lines = (this.room.def.signs || {})[`${c},${r}`];
      if (lines) { this.say(lines); return true; }
    } else if (ch === 'h') {
      this.openChest(c, r);
      return true;
    } else if (ch === 'G' && !this.gateOpen()) {
      this.say([TEXT.gate_closed[0] + `\n（宝珠 ${this.S.orbs} / 2）`]);
      return true;
    }
    return false;
  },

  talk(n) {
    const S = this.S;
    switch (n.talk) {
      case 'oldman':
        this.say(S.items.sword ? TEXT.oldman : TEXT.oldman_intro);
        break;
      case 'merchant':
        this.say(TEXT.merchant);
        break;
      case 'heartcave':
        this.say(this.pickups.some((pk) => pk.t === 'heartc') ? TEXT.heartcave : TEXT.heartcave_after);
        break;
      case 'gemcave':
        if (this.flag(`gift:${this.areaId}`)) this.say(TEXT.gemcave_after);
        else this.say(TEXT.gemcave, () => { this.setFlag(`gift:${this.areaId}`); this.itemGet('gems100'); });
        break;
      case 'fairy':
        this.say(TEXT.fairy, () => {
          S.hp = S.maxHp;
          Sound.play('heal');
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            this.fx.push({ t: 'p', x: this.player.x, y: this.player.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70 - 30, g: 0, life: 0.8, max: 0.8, r: 2.5, color: i % 2 ? '#ff9fd2' : '#fff6a8' });
          }
          this.save();
        });
        break;
      default: break;
    }
  },

  buy(s) {
    const S = this.S;
    if (s.sold) { this.say(TEXT.sold_out); return; }
    if (s.need && !S.items[s.need]) { this.say(TEXT.no_bag); return; }
    if (s.item === 'potion' && S.hp >= S.maxHp) { this.say(TEXT.full_hp); return; }
    if (s.item === 'bombs' && S.bombs >= S.maxBombs) { this.say(TEXT.bombs_full); return; }
    if (S.gems < s.price) { Sound.play('error'); this.say(TEXT.no_gems); return; }
    S.gems -= s.price;
    if (s.item === 'potion') {
      S.hp = S.maxHp;
      Sound.play('heal');
      this.toast('ライフが 回復した！');
    } else if (s.item === 'bombs') {
      S.bombs = Math.min(S.maxBombs, S.bombs + 4);
      Sound.play('buy');
      this.toast('爆弾を 4こ 買った。');
    } else if (s.item === 'heartc') {
      s.sold = true;
      this.setFlag(`shop:${this.areaId}:${s.i}`);
      this.itemGet('heartc');
    }
    this.save();
  },

  openChest(c, r) {
    const chests = this.room.def.chests || [];
    const i = chests.findIndex((ch) => ch.c === c && ch.r === r);
    if (i < 0) return;
    this.setFlag(`chest:${this.areaId}:${this.roomKey}:${i}`);
    this.room.grid[r][c] = 'j';
    Sound.play('door');
    this.itemGet(chests[i].item);
  },

  ownedB() {
    const l = [];
    if (this.S.items.boomerang) l.push('boomerang');
    if (this.S.items.bombbag) l.push('bombs');
    return l;
  },

  swapItem() {
    const l = this.ownedB();
    if (l.length < 2) return;
    this.S.bItem = l[(l.indexOf(this.S.bItem) + 1) % l.length];
    Sound.play('text');
    this.toast(this.S.bItem === 'bombs' ? '爆弾に 持ちかえた' : 'ブーメランに 持ちかえた');
  },

  useItem() {
    const p = this.player, S = this.S;
    if (S.bItem === 'boomerang') {
      if (this.projs.some((q) => q.t === 'boomer')) return;
      const ax = Input.axis();
      let vx = ax.x, vy = ax.y;
      if (!vx && !vy) { vx = DIRS[p.dir].x; vy = DIRS[p.dir].y; }
      const m = Math.hypot(vx, vy) || 1;
      this.projs.push({ t: 'boomer', x: p.x, y: p.y - 2, vx: (vx / m) * 330, vy: (vy / m) * 330, phase: 'out', life: 0.5, r: 7, spin: 0, carry: [], hitSet: new Set() });
      Sound.play('boomer');
    } else if (S.bItem === 'bombs') {
      if (S.bombs <= 0) { Sound.play('error'); this.toast('爆弾が ない！'); return; }
      if (this.projs.filter((q) => q.t === 'bomb').length >= 2) return;
      const d = DIRS[p.dir];
      let bx = p.x + d.x * 20, by = p.y + d.y * 20;
      if (this.solidAt(bx, by, 'proj')) { bx = p.x; by = p.y; }
      S.bombs--;
      this.projs.push({ t: 'bomb', x: bx, y: by, fuse: 1.5, r: 9 });
      Sound.play('bomb');
    }
  },

  /* ===================== 敵とのやりとり ===================== */
  hurtPlayer(dmg, sx, sy) {
    const p = this.player, S = this.S;
    if (p.inv > 0 || this.mode !== 'play') return;
    S.hp = Math.max(0, S.hp - dmg);
    p.inv = 1.0;
    const a = Math.atan2(p.y - sy, p.x - sx);
    p.kbx = Math.cos(a) * 260;
    p.kby = Math.sin(a) * 260;
    p.kbT = 0.13;
    if (p.state !== 'walk') { p.state = 'walk'; p.charge = 0; }
    Sound.play('hurt');
    this.shake = Math.max(this.shake, 0.15);
    if (S.hp <= 0) {
      this.mode = 'dead';
      p.deadT = 0;
      S.deaths++;
      Sound.bgm(null);
      Sound.play('die');
    }
  },

  /** 敵にダメージを与える。盾ではじかれたら 'block'。 */
  hitEnemy(e, dmg, sx, sy, src) {
    if (e.dead || e.inv > 0 || e.spawnT > 0 || e.intangible || e.dying != null) return false;
    if (e.shield && !(e.stun > 0) && src !== 'bomb') {
      const f = DIRS[e.dir];
      const vx = sx - e.x, vy = sy - e.y;
      const m = Math.hypot(vx, vy) || 1;
      if ((vx * f.x + vy * f.y) / m > 0.4) {
        Sound.play('clink');
        this.burst(e.x + f.x * 12, e.y + f.y * 12, '#fff3b0', 5);
        e.inv = 0.15;
        if (src === 'sword') {
          const p = this.player;
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          p.kbx = Math.cos(a) * 200; p.kby = Math.sin(a) * 200; p.kbT = 0.08;
        }
        return 'block';
      }
    }
    if (src === 'boomer') {
      if (e.boss) { Sound.play('clink'); return false; }
      if (e.ai !== 'bat') {
        e.stun = 2.4;
        Sound.play('clink');
        this.burst(e.x, e.y - 10, '#9fe8ff', 5);
        return true;
      }
    }
    if (e.boss && bossGuard(e, src)) {
      Sound.play('clink');
      this.burst(e.x, e.y, '#fff3b0', 6);
      e.inv = 0.2;
      return false;
    }
    e.hp -= dmg;
    e.inv = e.hitInv || 0.28;
    e.flash = 0.22;
    if (!e.boss) {
      const a = Math.atan2(e.y - sy, e.x - sx);
      e.kbx = Math.cos(a) * 280;
      e.kby = Math.sin(a) * 280;
      e.kbT = 0.12;
    }
    Sound.play(e.boss ? 'bosshit' : 'hit');
    this.hitStop = 0.04;
    this.burst(e.x, e.y, '#ffffff', 6);
    if (e.hp <= 0) this.killEnemy(e);
    return true;
  },

  killEnemy(e) {
    if (e.boss) {
      if (e.type === 'mao') this.say(TEXT.mao_end);
      e.dying = e.type === 'mao' ? 2.2 : 1.6;
      e.intangible = true;
      this.enemies.forEach((m) => { if (m !== e && !m.dead) { m.dead = true; this.poof(m.x, m.y); } });
      this.projs.forEach((q) => { if (q.t === 'morb' || q.t === 'fire' || q.t === 'rock') q.dead = true; });
      Sound.bgm(null);
      Sound.play('bossdie');
      return;
    }
    e.dead = true;
    this.poof(e.x, e.y);
    Sound.play('kill');
    if (!e.noDrop) this.rollDrop(e.x, e.y);
  },

  /** ボスが消えたあと: 扉を開け、ハートのうつわと宝珠を出す。 */
  finishBoss(e) {
    e.dead = true;
    this.setFlag(`boss:${this.areaId}`);
    for (let i = 0; i < 4; i++) this.poof(e.x + rand(-30, 30), e.y + rand(-30, 30));
    this.unseal();
    Sound.play('secret');
    this.spawnBossRewards(true);
    this.save();
  },

  spawnBossRewards(pop) {
    const a = this.areaId;
    if (a !== 'd3' && !this.flag(`item:${a}:bosshc`)) {
      this.addPickup('heartc', RW / 2 - 56, RH / 2 + 10, { flag: `item:${a}:bosshc`, stay: true, pop });
    }
    if (!this.flag(`item:${a}:orb`)) {
      this.addPickup('orb', a === 'd3' ? RW / 2 : RW / 2 + 56, RH / 2 + 10, { flag: `item:${a}:orb`, stay: true, pop });
    }
  },

  checkClear() {
    if (!this.roomHadEnemies || this.enemies.length) return;
    this.roomHadEnemies = false;
    if (this.room.kind === 'dungeon') this.cleared.add(this.roomKey);
    this.triggerEvent('clear');
  },

  triggerEvent(kind) {
    const ev = this.room.def.event;
    if (!ev || ev.on !== kind || this.flag(this.evKey())) return;
    this.setFlag(this.evKey());
    Sound.play('secret');
    if (ev.open) {
      for (const side of ['n', 's', 'e', 'w']) {
        if (this.doorType(this.areaId, this.roomKey, side) === 'shut') this.openDoor(side, 'shut');
      }
    }
    if (ev.chest) {
      (this.room.def.chests || []).forEach((ch) => {
        if (!ch.hidden) return;
        this.room.grid[ch.r][ch.c] = 'h';
        this.poof(pxOf(ch.c), pxOf(ch.r));
      });
    }
    if (ev.drop) {
      const pk = this.addPickup(ev.drop.t, pxOf(ev.drop.c), pxOf(ev.drop.r), { flag: this.dropKey(), stay: true, pop: true });
      this.poof(pk.x, pk.y);
    }
    this.save();
  },

  explode(x, y) {
    Sound.play('boom');
    this.shake = Math.max(this.shake, 0.35);
    this.fx.push({ t: 'boom', x, y, life: 0.45, max: 0.45 });
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, 160);
      this.fx.push({ t: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0, life: 0.5, max: 0.5, r: rand(3, 6), color: i % 3 ? '#ffb347' : '#fff1a8' });
    }
    for (const e of this.enemies) {
      if (enemyParts(e).some((pt) => dist(pt.x, pt.y, x, y) < 44 + pt.r * 0.5)) this.hitEnemy(e, 2, x, y, 'bomb');
    }
    const p = this.player;
    if (dist(p.x, p.y, x, y) < 38) this.hurtPlayer(2, x, y);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (dist(pxOf(c), pxOf(r), x, y) > 50) continue;
        const ch = this.room.grid[r][c];
        if (ch === 'X') {
          this.setFlag(`bomb:${this.areaId}:${this.roomKey}`);
          this.room.grid[r][c] = 'C';
          Sound.play('secret');
          this.save();
        } else if (ch === 'x') {
          this.openDoor(sideOfCell(c, r), 'bomb');
        } else if (ch === 'B') {
          this.cutBush(c, r);
        }
      }
    }
  },

  reflectOrb(q) {
    const boss = this.enemies.find((e) => e.type === 'mao');
    q.owner = 'player';
    q.speed *= 1.12;
    const tx = boss ? boss.x : q.x, ty = boss ? boss.y : q.y - 100;
    const a = Math.atan2(ty - q.y, tx - q.x);
    q.vx = Math.cos(a) * q.speed;
    q.vy = Math.sin(a) * q.speed;
    Sound.play('clink');
    Sound.play('beam');
    this.burst(q.x, q.y, '#c9a8ff', 8);
  },

  /* ===================== 飛び道具 ===================== */
  updateProjs(dt) {
    const p = this.player;
    for (const q of this.projs) {
      if (q.dead) continue;
      switch (q.t) {
        case 'rock':
        case 'fire': {
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.spin = (q.spin || 0) + dt * 12;
          if (this.solidAt(q.x, q.y, 'proj')) { q.dead = true; this.burst(q.x, q.y, q.t === 'fire' ? '#ff8a3c' : '#bbb', 4); break; }
          if (dist(q.x, q.y, p.x, p.y) < q.r + 9) { this.hurtPlayer(q.t === 'fire' ? 2 : 1, q.x - q.vx * 0.05, q.y - q.vy * 0.05); q.dead = true; }
          break;
        }
        case 'beam': {
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.life -= dt;
          let hit = false;
          for (const e of this.enemies) {
            if (enemyParts(e).some((pt) => dist(pt.x, pt.y, q.x, q.y) < pt.r + q.r)) {
              if (this.hitEnemy(e, 1, q.x - q.vx * 0.1, q.y - q.vy * 0.1, 'beam')) hit = true;
              else if (!e.spawnT && !e.intangible) hit = true;
              if (hit) break;
            }
          }
          if (hit || q.life <= 0 || this.solidAt(q.x, q.y, 'proj')) {
            q.dead = true;
            for (let i = 0; i < 4; i++) {
              const a = Math.PI / 4 + (i * Math.PI) / 2;
              this.fx.push({ t: 'p', x: q.x, y: q.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, g: 0, life: 0.25, max: 0.25, r: 3, color: '#bff4ff' });
            }
          }
          break;
        }
        case 'boomer': this.updateBoomer(q, dt); break;
        case 'bomb': {
          q.fuse -= dt;
          if (q.fuse <= 0) { q.dead = true; this.explode(q.x, q.y); }
          break;
        }
        case 'morb': this.updateOrb(q, dt); break;
        default: break;
      }
    }
    this.projs = this.projs.filter((q) => !q.dead);
  },

  updateBoomer(q, dt) {
    const p = this.player;
    q.spin += dt * 22;
    if (Math.floor(q.spin / 6) !== Math.floor((q.spin - dt * 22) / 6)) Sound.play('boomer');
    if (q.phase === 'out') {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      let back = q.life <= 0 || this.solidAt(q.x, q.y, 'proj');
      const c = Math.floor(q.x / TS), r = Math.floor(q.y / TS);
      if (this.tileAt(c, r) === 'o') { this.hitSwitch(c, r); back = true; }
      for (const e of this.enemies) {
        if (q.hitSet.has(e)) continue;
        if (enemyParts(e).some((pt) => dist(pt.x, pt.y, q.x, q.y) < pt.r + q.r)) {
          q.hitSet.add(e);
          if (this.hitEnemy(e, 1, q.x - q.vx * 0.1, q.y - q.vy * 0.1, 'boomer') !== false) back = true;
        }
      }
      if (back) q.phase = 'back';
    } else {
      const a = Math.atan2(p.y - 2 - q.y, p.x - q.x);
      q.x += Math.cos(a) * 360 * dt;
      q.y += Math.sin(a) * 360 * dt;
      if (dist(q.x, q.y, p.x, p.y) < 14) {
        q.dead = true;
        q.carry.forEach((pk) => { pk.carried = false; pk.x = p.x; pk.y = p.y; });
        return;
      }
    }
    for (const pk of this.pickups) {
      if (!pk.carried && dist(pk.x, pk.y, q.x, q.y) < 16) { pk.carried = true; q.carry.push(pk); q.phase = 'back'; }
    }
    q.carry.forEach((pk) => { pk.x = q.x; pk.y = q.y; });
  },

  updateOrb(q, dt) {
    const p = this.player;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.spin = (q.spin || 0) + dt * 8;
    if (q.x < 16 || q.y < 16 || q.x > RW - 16 || q.y > RH - 16) { q.dead = true; this.burst(q.x, q.y, '#c9a8ff', 6); return; }
    if (q.owner === 'enemy') {
      if (dist(q.x, q.y, p.x, p.y) < q.r + 9) { this.hurtPlayer(2, q.x - q.vx * 0.05, q.y - q.vy * 0.05); q.dead = true; }
      return;
    }
    const boss = this.enemies.find((e) => e.type === 'mao');
    if (boss && !boss.intangible && dist(q.x, q.y, boss.x, boss.y - 6) < q.r + boss.r) maoCatch(boss, q);
  },

  /* ===================== 落とし物 ===================== */
  addPickup(t, x, y, opts = {}) {
    const pk = { t, x, y, flag: opts.flag || null, life: opts.stay ? Infinity : 9, z: opts.pop ? 18 : 0, vz: opts.pop ? 80 : 0, carried: false, anim: Math.random() * 6 };
    this.pickups.push(pk);
    return pk;
  },

  rollDrop(x, y) {
    const S = this.S;
    const r = Math.random();
    const heartChance = S.hp <= 2 ? 0.35 : S.hp < S.maxHp ? 0.18 : 0.06;
    if (r < heartChance) this.addPickup('heart', x, y, { pop: true });
    else if (r < heartChance + 0.3) this.addPickup('gem', x, y, { pop: true });
    else if (r < heartChance + 0.38) this.addPickup('gem5', x, y, { pop: true });
    else if (r < heartChance + 0.48 && S.items.bombbag && S.bombs < S.maxBombs) this.addPickup('bombs', x, y, { pop: true });
  },

  updatePickups(dt) {
    const p = this.player, S = this.S;
    for (const pk of this.pickups) {
      pk.anim += dt;
      if (pk.vz || pk.z > 0) {
        pk.vz -= 300 * dt;
        pk.z = Math.max(0, pk.z + pk.vz * dt);
        if (pk.z === 0) pk.vz = 0;
      }
      if (pk.carried) continue;
      pk.life -= dt;
      if (pk.life <= 0) { pk.gone = true; continue; }
      if (pk.z < 6 && dist(pk.x, pk.y, p.x, p.y) < 17) {
        if (pk.t === 'bombs' && !S.items.bombbag) continue;
        pk.gone = true;
        if (pk.flag) this.setFlag(pk.flag);
        this.collect(pk);
        if (this.mode !== 'play') break;
      }
    }
    this.pickups = this.pickups.filter((pk) => !pk.gone);
  },

  collect(pk) {
    const S = this.S;
    switch (pk.t) {
      case 'gem': S.gems = Math.min(999, S.gems + 1); Sound.play('gem'); break;
      case 'gem5': S.gems = Math.min(999, S.gems + 5); Sound.play('gem'); break;
      case 'heart': S.hp = Math.min(S.maxHp, S.hp + 2); Sound.play('heart'); break;
      case 'bombs': S.bombs = Math.min(S.maxBombs, S.bombs + 4); Sound.play('gem'); break;
      case 'key':
        S.keys[this.areaId] = (S.keys[this.areaId] || 0) + 1;
        Sound.play('key');
        this.toast('小さな鍵を 手に入れた');
        this.save();
        break;
      case 'orb': this.itemGet('orb', () => this.afterOrb()); break;
      default: this.itemGet(pk.t); break;
    }
  },

  afterOrb() {
    if (this.areaId === 'd3') {
      this.mode = 'ending';
      Sound.bgm('ending');
      if (this.hooks.ending) this.hooks.ending();
      return;
    }
    this.S.cp = this.S.ret;
    Sound.play('warp');
    this.warpTo(this.S.ret);
  },

  /* ===================== アイテム入手 ===================== */
  itemGet(item, after) {
    const S = this.S;
    switch (item) {
      case 'sword': S.items.sword = true; break;
      case 'boomerang': S.items.boomerang = true; if (!S.bItem) S.bItem = 'boomerang'; break;
      case 'bombbag': S.items.bombbag = true; S.maxBombs = 8; S.bombs = 8; if (!S.bItem) S.bItem = 'bombs'; break;
      case 'heartc': S.maxHp += 2; S.hp = S.maxHp; break;
      case 'key': S.keys[this.areaId] = (S.keys[this.areaId] || 0) + 1; break;
      case 'bigkey': S.bigkey[this.areaId] = true; break;
      case 'orb': S.orbs++; break;
      case 'gems100': S.gems = Math.min(999, S.gems + 100); break;
      default: break;
    }
    const p = this.player;
    p.state = 'walk';
    p.charge = 0;
    p.dir = 'down';
    this.projs = this.projs.filter((q) => q.t !== 'boomer');
    this.itemget = { item, t: 0, after };
    this.mode = 'itemget';
    Sound.play('fanfare');
    this.save();
  },

  itemText(item) {
    const lines = ITEMS[item].get.slice();
    if (item === 'orb') {
      const n = this.S.orbs;
      if (n === 1) lines.push('あと一つ、神殿の宝珠を\n取りもどそう。');
      else if (n === 2) lines.push('二つの宝珠が そろった！\n中央平原の北、魔王の城へ 向かおう。');
      else lines.push('三つの宝珠が そろった！');
    }
    return lines;
  },

  updateItemget(dt) {
    const ig = this.itemget;
    ig.t += dt;
    if (ig.t > 0.9 && !ig.talked) {
      ig.talked = true;
      this.say(this.itemText(ig.item), () => {
        this.itemget = null;
        if (ig.after) ig.after();
      });
    }
  },

  /* ===================== 会話 ===================== */
  fmtKeys(s) {
    const t = Input.isTouch;
    return s.replace(/\{A\}/g, t ? 'A' : 'Z').replace(/\{B\}/g, t ? 'B' : 'X').replace(/\{S\}/g, t ? '⇆' : 'C');
  },

  say(pages, onDone) {
    this.dialog = { pages: pages.map((s) => this.fmtKeys(s)), i: 0, shown: 0, onDone };
    this.mode = 'dialog';
    Input.swallow();
  },

  updateDialog(dt) {
    const d = this.dialog;
    const page = d.pages[d.i];
    const before = Math.floor(d.shown);
    d.shown = Math.min(page.length, d.shown + dt * 42);
    if (Math.floor(d.shown) !== before && Math.floor(d.shown) % 3 === 0) Sound.play('text');
    if (Input.pressed('a') || Input.pressed('b')) {
      if (d.shown < page.length) d.shown = page.length;
      else if (d.i < d.pages.length - 1) { d.i++; d.shown = 0; }
      else {
        this.dialog = null;
        this.mode = 'play';
        Input.swallow();
        if (d.onDone) d.onDone();
      }
    }
  },

  toast(text) {
    this.toastMsg = { text, t: 2.2 };
  },

  /* ===================== 画面の切りかえ ===================== */
  checkEdges() {
    const p = this.player;
    let side = null;
    if (p.x < 0) side = 'w';
    else if (p.x > RW) side = 'e';
    else if (p.y < 0) side = 'n';
    else if (p.y > RH) side = 's';
    if (!side) return;
    const area = this.room.area;
    if (area.kind === 'cave' || (area.kind === 'dungeon' && side === 's' && this.room.def.doors && this.room.def.doors.s === 'exit')) {
      this.exitArea();
      return;
    }
    const [x, y] = this.roomKey.split(',').map(Number);
    const [dx, dy] = SIDE_VEC[side];
    const nk = `${x + dx},${y + dy}`;
    if (!area.rooms[nk]) {
      p.x = clamp(p.x, 1, RW - 1);
      p.y = clamp(p.y, 1, RH - 1);
      return;
    }
    this.startScroll(side, nk);
  },

  startScroll(side, nk) {
    const p = this.player;
    const [dx, dy] = SIDE_VEC[side];
    const next = this.buildRoom(this.areaId, nk);
    const inset = this.room.kind === 'dungeon' ? 46 : 20;
    const to = {
      x: dx === 1 ? inset : dx === -1 ? RW - inset : p.x,
      y: dy === 1 ? inset : dy === -1 ? RH - inset : p.y,
    };
    this.projs = [];
    this.trans = { kind: 'scroll', side, dx, dy, t: 0, dur: 0.62, from: this.room, to: next, pFrom: { x: p.x, y: p.y }, pTo: to };
    this.mode = 'scroll';
    p.state = 'walk';
    p.charge = 0;
  },

  updateScroll(dt) {
    const tr = this.trans;
    const p = this.player;
    tr.t += dt;
    p.walk += dt * 10;
    p.moving = true;
    if (tr.t >= tr.dur) {
      this.room = tr.to;
      this.roomKey = tr.to.key;
      p.x = tr.pTo.x;
      p.y = tr.pTo.y;
      this.trans = null;
      this.mode = 'play';
      this.enterRoom();
      this.runArrive();
    }
  },

  checkWarp() {
    if (this.room.kind !== 'field') return;
    const p = this.player;
    const c = Math.floor(p.x / TS), r = Math.floor(p.y / TS);
    const ch = this.tileAt(c, r);
    if (!(ch === 'C' || ch === 'D' || (ch === 'G' && this.gateOpen()))) return;
    const dest = (this.room.def.warps || {})[ch];
    if (!dest) return;
    this.S.ret = { area: 'ow', room: this.roomKey, x: pxOf(c), y: (r + 1) * TS + 16, dir: 'down' };
    const A = AREAS[dest];
    const cp = { area: dest, room: A.start || '0,0', x: RW / 2, y: RH - 46, dir: 'up' };
    if (A.kind === 'dungeon') this.S.cp = cp;
    Sound.play('stairs');
    this.warpTo(cp);
  },

  exitArea() {
    const ret = this.S.ret || { area: 'ow', room: '1,2', x: 8 * TS, y: 8.5 * TS, dir: 'down' };
    if (this.room.kind === 'dungeon') this.S.cp = ret;
    Sound.play('stairs');
    this.warpTo(ret);
  },

  warpTo(dest) {
    this.trans = { kind: 'warp', t: 0, dur: 0.7, dest, switched: false };
    this.mode = 'warp';
    this.player.state = 'walk';
    this.player.charge = 0;
    this.projs = [];
  },

  updateWarp(dt) {
    const tr = this.trans;
    tr.t += dt;
    if (!tr.switched && tr.t >= tr.dur / 2) {
      tr.switched = true;
      const p = this.player;
      const d = tr.dest;
      p.x = d.x;
      p.y = d.y;
      p.dir = d.dir || 'down';
      p.kbT = 0;
      this.enterArea(d.area, d.room);
    }
    if (tr.t >= tr.dur) {
      this.trans = null;
      this.mode = 'play';
      this.runArrive();
    }
  },

  updateDead(dt) {
    const p = this.player;
    p.deadT += dt;
    this.updateFx(dt);
    if (p.deadT > 1.8 && !p.reported) {
      p.reported = true;
      this.save();
      if (this.hooks.gameover) this.hooks.gameover();
    }
  },

  /* ===================== 演出 ===================== */
  poof(x, y) {
    this.fx.push({ t: 'poof', x, y, life: 0.4, max: 0.4 });
  },

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(50, 140);
      this.fx.push({ t: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0, life: 0.3, max: 0.3, r: rand(1.5, 3), color });
    }
  },

  updateFx(dt) {
    for (const f of this.fx) {
      f.life -= dt;
      if (f.t === 'p') {
        f.vy += (f.g || 0) * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
      } else if (f.t === 'block') {
        const k = 1 - Math.max(0, f.life) / f.max;
        f.x = lerp(f.x0, f.x1, k);
        f.y = lerp(f.y0, f.y1, k);
        if (f.life <= 0 && f.done) { f.done(); f.done = null; }
      }
    }
    this.fx = this.fx.filter((f) => f.life > 0);
  },
};
