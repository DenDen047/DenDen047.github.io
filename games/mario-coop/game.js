// =================================================================
// ふたりでマリオっぽい冒険 — 2P co-op side-scrolling platformer
// =================================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;   // 960
const H = canvas.height;  // 480

// --- Tuning (snappy controls) ---
const TILE = 32;
const GRAVITY = 0.55;
const JUMP_V = -12;
const MAX_VX = 4.5;
const GROUND_ACCEL = 1.5;      // 0 → MAX in ~3 frames
const AIR_ACCEL = 0.55;        // smaller, so jumps still commit a direction
const FRICTION = 0.5;          // ground decel when no input (~stop in 5 frames)
const COYOTE_FRAMES = 6;       // can jump shortly after leaving a ledge
const JUMP_BUFFER_FRAMES = 6;  // pressing jump just before landing still triggers
const RESPAWN_INVULN = 90;
const STARTING_LIVES = 3;

// =================================================================
// Level
// =================================================================
const COLS = 120;
const ROWS = 15;
const LEVEL_W = COLS * TILE;
const LEVEL_H = ROWS * TILE;

const T_EMPTY = 0;
const T_BRICK = 1;     // brown brick
const T_STONE = 2;     // gray hard block
const T_QUESTION = 3;  // ? block: gives a coin on head-bump

function buildLevel() {
  const grid = Array.from({ length: ROWS }, () => '.'.repeat(COLS).split(''));
  const set = (r, c, ch) => { if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = ch; };
  const line = (r, c, len, ch) => { for (let i = 0; i < len; i++) set(r, c + i, ch); };

  // Ground spans (cols a..b inclusive). The gaps are pits.
  const groundRanges = [
    [0, 13], [19, 47], [55, 77], [86, 119],
  ];
  for (const [a, b] of groundRanges) {
    for (let r = 11; r < ROWS; r++) line(r, a, b - a + 1, '#');
  }

  // === Section 1: spawn area (0-13) ===
  set(10, 2, '1'); set(10, 4, '2');
  set(7, 7, '?'); set(7, 10, '?'); set(7, 13, '?');
  for (let i = 0; i < 3; i++) set(4, 8 + i, 'C');
  line(8, 9, 3, '=');

  // === Section 2: pit 1 (14-18, 5 wide) — reward coin in the air ===
  set(6, 16, 'C');

  // === Section 3: enemies + step pyramid (19-47) ===
  set(10, 23, 'E'); set(10, 28, 'E');
  set(7, 22, '?'); set(7, 25, '?');
  // Pyramid up at cols 33-37 (5 steps, 5 tiles tall at peak)
  for (let i = 0; i < 5; i++) {
    for (let r = 10 - i; r < 11; r++) set(r, 33 + i, '#');
  }
  // Pyramid down at cols 38-41 (4 steps, mirror)
  for (let i = 0; i < 4; i++) {
    for (let r = 10 - (3 - i); r < 11; r++) set(r, 38 + i, '#');
  }
  // Coins peppered along the climb
  for (let i = 0; i < 5; i++) set(9 - i, 34 + i, 'C');
  for (let i = 0; i < 4; i++) set(6 + i, 39 + i, 'C');
  // Enemy on the high ground past the pyramid
  set(10, 45, 'E');
  // Floating coin row above section 3
  for (let i = 0; i < 4; i++) set(3, 43 + i, 'C');
  // Floating ? blocks for high coins
  line(4, 43, 3, '?');

  // === Section 4: pit 2 with stepping platforms (48-54) ===
  line(8, 49, 2, '=');
  line(7, 52, 2, '=');
  set(6, 53, 'C'); set(5, 53, 'C');
  set(7, 50, 'C');

  // === Section 5: middle ground (55-77) ===
  set(10, 58, 'E'); set(10, 66, 'E'); set(10, 73, 'E');
  set(7, 60, '?'); set(7, 63, '?');
  line(8, 68, 4, '#');
  for (let i = 0; i < 3; i++) set(7, 69 + i, 'C');
  // Speed-bump wall (2-tall) at col 75
  set(10, 75, '#'); set(9, 75, '#');

  // === Section 6: pit 3 with sky path (78-85) ===
  line(7, 78, 2, '=');
  line(7, 82, 2, '=');
  for (let i = 0; i < 4; i++) set(6, 79 + i, 'C');
  set(5, 80, 'C'); set(5, 81, 'C');

  // === Section 7: boss arena (86-119) ===
  // Decorative side pillars
  set(10, 88, '='); set(9, 88, '=');
  set(10, 117, '='); set(9, 117, '=');
  // Combat platforms (give players elevation to drop on the boss)
  line(7, 92, 3, '#');
  line(5, 100, 4, '#');
  line(7, 110, 3, '#');
  // Decorative coins on combat platforms
  for (let i = 0; i < 3; i++) set(6, 92 + i, 'C');
  for (let i = 0; i < 4; i++) set(4, 100 + i, 'C');
  // Boss spawn
  set(10, 104, 'B');
  // Goal flag (only counts once the boss is down)
  set(10, 115, 'G');

  return grid.map(row => row.join(''));
}

// =================================================================
// Parse level → static tile grid + dynamic entity spawns
// =================================================================
const rawLevel = buildLevel();
const tileGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(T_EMPTY));
const coinSpawns = [];
const enemySpawns = [];
const playerSpawns = { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 } };
let bossSpawn = { x: 104 * TILE, y: 9 * TILE };
let goalPos = { x: LEVEL_W - TILE * 4, y: 10 * TILE };

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const ch = rawLevel[r][c];
    const px = c * TILE, py = r * TILE;
    switch (ch) {
      case '#': tileGrid[r][c] = T_BRICK; break;
      case '=': tileGrid[r][c] = T_STONE; break;
      case '?': tileGrid[r][c] = T_QUESTION; break;
      case 'C': coinSpawns.push({ x: px + 8, y: py + 8 }); break;
      case 'E': enemySpawns.push({ x: px + 2, y: py + 4 }); break;
      case '1': playerSpawns[1] = { x: px + 4, y: py + 4 }; break;
      case '2': playerSpawns[2] = { x: px + 4, y: py + 4 }; break;
      case 'B': bossSpawn = { x: px - 12, y: py - 24 }; break;
      case 'G': goalPos = { x: px, y: py }; break;
    }
  }
}

function tileAt(c, r) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return T_EMPTY;
  return tileGrid[r][c];
}
function isSolid(t) { return t === T_BRICK || t === T_STONE || t === T_QUESTION; }

// =================================================================
// Sound — tiny Web Audio synthesizer (no external files)
// =================================================================
const sfx = {
  ctx: null,
  muted: false,
  ensure() {
    if (!this.ctx && !this.muted) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { this.muted = true; }
    }
  },
  blip(freq, dur, type = 'square', vol = 0.08, freqEnd = null) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (freqEnd != null) o.frequency.linearRampToValueAtTime(freqEnd, this.ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur + 0.02);
  },
  jump()      { this.blip(440, 0.12, 'square',   0.07, 900); },
  stomp()     { this.blip(220, 0.10, 'square',   0.11, 80); },
  coin()      { this.blip(988, 0.05, 'square',   0.09);
                setTimeout(() => this.blip(1318, 0.10, 'square', 0.09), 55); },
  bump()      { this.blip(180, 0.06, 'square',   0.08); },
  hurt()      { this.blip(220, 0.30, 'sawtooth', 0.13, 60); },
  bossHit()   { this.blip(140, 0.18, 'sawtooth', 0.16, 50); },
  fire()      { this.blip(700, 0.08, 'triangle', 0.07, 300); },
  bossDie()   {
    [240, 200, 160, 120, 80].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.18, 'sawtooth', 0.18, f * 0.4), i * 90));
  },
  win()       {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.18, 'square', 0.09), i * 95));
  },
  gameover()  {
    [400, 320, 240, 160].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.30, 'sawtooth', 0.12), i * 180));
  },
};
// Start audio on the first key press (browser autoplay policy)
window.addEventListener('keydown', () => sfx.ensure(), { once: true });

// =================================================================
// Entities
// =================================================================
function createPlayer(id, spawn, color, controls) {
  return {
    kind: 'player',
    id, color, controls,
    x: spawn.x, y: spawn.y,
    w: 24, h: 28,
    vx: 0, vy: 0,
    facing: 1,
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    alive: true,
    invuln: RESPAWN_INVULN,
    lives: STARTING_LIVES,
    coins: 0,
    score: 0,
    reachedGoal: false,
  };
}

function createEnemy(spawn) {
  return {
    kind: 'enemy',
    x: spawn.x, y: spawn.y,
    w: 28, h: 28,
    vx: -0.8, vy: 0,
    onGround: false,
    alive: true,
    squashTimer: 0,
  };
}

function createCoin(spawn) {
  return { kind: 'coin', x: spawn.x, y: spawn.y, w: 16, h: 16, collected: false, t: 0 };
}

function createBoss(spawn) {
  return {
    kind: 'boss',
    x: spawn.x, y: spawn.y,
    w: 56, h: 56,
    vx: -0.9, vy: 0,
    onGround: false,
    hp: 4, maxHp: 4,
    alive: true,
    defeated: false,
    invuln: 0,
    flashTimer: 0,
    fireCooldown: 100,
  };
}

let players, enemies, coins, particles, fireballs, boss;
let gameState, frame, message;
let questionBlocksUsed;

function resetGame() {
  players = [
    createPlayer(1, playerSpawns[1], '#e74c3c',
      { left: 'KeyA', right: 'KeyD', jump: 'KeyW' }),
    createPlayer(2, playerSpawns[2], '#4caf50',
      { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp' }),
  ];
  enemies = enemySpawns.map(createEnemy);
  coins = coinSpawns.map(createCoin);
  boss = createBoss(bossSpawn);
  fireballs = [];
  particles = [];
  questionBlocksUsed = new Set();
  gameState = 'playing';
  frame = 0;
  message = '';
}

// =================================================================
// Input
// =================================================================
const keys = new Set();
window.addEventListener('keydown', e => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
  if (e.code === 'KeyR') resetGame();
});
window.addEventListener('keyup', e => keys.delete(e.code));

// =================================================================
// Physics — tile-based AABB
// =================================================================
function moveAndCollide(ent) {
  let bumpedTile = null;

  // ---- X axis ----
  ent.x += ent.vx;
  let l = Math.floor(ent.x / TILE);
  let r = Math.floor((ent.x + ent.w - 1) / TILE);
  let t = Math.floor(ent.y / TILE);
  let b = Math.floor((ent.y + ent.h - 1) / TILE);

  if (ent.vx > 0) {
    for (let ry = t; ry <= b; ry++) {
      if (isSolid(tileAt(r, ry))) {
        ent.x = r * TILE - ent.w;
        ent.vx = ent.bounceOnWall ? -ent.vx : 0;
        break;
      }
    }
  } else if (ent.vx < 0) {
    for (let ry = t; ry <= b; ry++) {
      if (isSolid(tileAt(l, ry))) {
        ent.x = (l + 1) * TILE;
        ent.vx = ent.bounceOnWall ? -ent.vx : 0;
        break;
      }
    }
  }

  // ---- Y axis ----
  ent.y += ent.vy;
  l = Math.floor(ent.x / TILE);
  r = Math.floor((ent.x + ent.w - 1) / TILE);
  t = Math.floor(ent.y / TILE);
  b = Math.floor((ent.y + ent.h - 1) / TILE);
  ent.onGround = false;

  if (ent.vy > 0) {
    for (let cx = l; cx <= r; cx++) {
      if (isSolid(tileAt(cx, b))) {
        ent.y = b * TILE - ent.h;
        ent.vy = 0;
        ent.onGround = true;
        break;
      }
    }
  } else if (ent.vy < 0) {
    for (let cx = l; cx <= r; cx++) {
      if (isSolid(tileAt(cx, t))) {
        ent.y = (t + 1) * TILE;
        ent.vy = 0;
        bumpedTile = { c: cx, r: t };
        break;
      }
    }
  }

  return bumpedTile;
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

// =================================================================
// Player update
// =================================================================
function updatePlayer(p) {
  if (!p.alive) return;
  if (p.invuln > 0) p.invuln--;
  if (p.coyote > 0) p.coyote--;
  if (p.jumpBuffer > 0) p.jumpBuffer--;

  const left  = keys.has(p.controls.left);
  const right = keys.has(p.controls.right);
  const jumpDown = keys.has(p.controls.jump);

  // Edge-detect jump press to set the buffer
  if (jumpDown && !p.jumpHeld) p.jumpBuffer = JUMP_BUFFER_FRAMES;
  p.jumpHeld = jumpDown;

  // Horizontal — snappier on ground, lighter in air
  if (p.onGround) {
    if (left && !right) {
      if (p.vx > 0) p.vx *= 0.4;            // quick direction reversal
      p.vx -= GROUND_ACCEL;
      p.facing = -1;
    } else if (right && !left) {
      if (p.vx < 0) p.vx *= 0.4;
      p.vx += GROUND_ACCEL;
      p.facing = 1;
    } else {
      p.vx *= FRICTION;
      if (Math.abs(p.vx) < 0.15) p.vx = 0;
    }
    p.coyote = COYOTE_FRAMES;
  } else {
    if (left && !right)  { p.vx -= AIR_ACCEL; p.facing = -1; }
    if (right && !left)  { p.vx += AIR_ACCEL; p.facing = 1; }
  }
  if (p.vx >  MAX_VX) p.vx =  MAX_VX;
  if (p.vx < -MAX_VX) p.vx = -MAX_VX;

  // Jump (with coyote + buffer)
  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = JUMP_V;
    p.jumpBuffer = 0;
    p.coyote = 0;
    sfx.jump();
    spawnDust(p.x + p.w / 2, p.y + p.h - 2);
  }
  // Variable height: cut upward velocity when jump released
  if (!jumpDown && p.vy < -4) p.vy = -4;

  p.vy += GRAVITY;
  if (p.vy > 14) p.vy = 14;

  const wasFalling = p.vy > 4 && !p.onGround;
  const bumped = moveAndCollide(p);

  // Landing dust
  if (wasFalling && p.onGround) {
    spawnDust(p.x + p.w / 2, p.y + p.h - 2, 0.7);
  }

  if (bumped) {
    const key = bumped.c + ',' + bumped.r;
    if (tileAt(bumped.c, bumped.r) === T_QUESTION && !questionBlocksUsed.has(key)) {
      questionBlocksUsed.add(key);
      spawnCoinBurst(bumped.c * TILE + TILE / 2, bumped.r * TILE);
      sfx.coin();
      p.coins += 1;
      p.score += 50;
    } else {
      sfx.bump();
    }
  }

  if (p.y > LEVEL_H + 100) loseLife(p);

  // Goal — only counts after the boss is down
  if (boss.defeated &&
      aabb(p, { x: goalPos.x, y: goalPos.y - TILE, w: TILE, h: TILE * 3 })) {
    p.reachedGoal = true;
  }
}

// =================================================================
// Enemy / coin updates
// =================================================================
function updateEnemy(e) {
  if (!e.alive) {
    if (e.squashTimer > 0) e.squashTimer--;
    return;
  }
  e.vy += GRAVITY;
  if (e.vy > 14) e.vy = 14;
  e.bounceOnWall = true;
  moveAndCollide(e);
  e.bounceOnWall = false;
  if (e.y > LEVEL_H + 100) e.alive = false;
}

function updateCoins() {
  for (const c of coins) {
    if (c.collected) continue;
    c.t++;
    for (const p of players) {
      if (p.alive && aabb(p, c)) {
        c.collected = true;
        p.coins += 1;
        p.score += 100;
        sfx.coin();
        spawnSparkles(c.x, c.y);
        break;
      }
    }
  }
}

// =================================================================
// Boss
// =================================================================
function updateBoss(b) {
  if (!b.alive) {
    b.vy += GRAVITY;
    b.y += b.vy;
    b.x += b.vx;
    return;
  }
  if (b.invuln > 0) b.invuln--;
  if (b.flashTimer > 0) b.flashTimer--;

  b.vy += GRAVITY;
  if (b.vy > 14) b.vy = 14;

  b.bounceOnWall = true;
  moveAndCollide(b);
  b.bounceOnWall = false;

  // Constrain to arena (cols 89-117)
  const minX = 89 * TILE;
  const maxX = 117 * TILE - b.w;
  if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx); }
  if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx); }

  // Random small hop
  if (b.onGround && Math.random() < 0.006) b.vy = -8;

  // Fireball spawn
  b.fireCooldown--;
  if (b.fireCooldown <= 0) {
    spawnFireball(b);
    b.fireCooldown = 90 + Math.floor(Math.random() * 60);
  }
}

function spawnFireball(b) {
  const targets = players.filter(p => p.alive);
  if (targets.length === 0) return;
  let target = targets[0];
  for (const p of targets) {
    if (Math.abs(p.x - b.x) < Math.abs(target.x - b.x)) target = p;
  }
  const sign = target.x < b.x ? -1 : 1;
  fireballs.push({
    x: b.x + b.w / 2 - 7, y: b.y + 14,
    w: 14, h: 14,
    vx: sign * 3.2, vy: -4.5,
    life: 200, t: 0,
  });
  sfx.fire();
}

function updateFireballs() {
  for (const f of fireballs) {
    f.t++;
    f.vy += GRAVITY * 0.6;
    if (f.vy > 10) f.vy = 10;
    f.x += f.vx; f.y += f.vy;
    // Bounce on ground
    const cx = Math.floor((f.x + f.w / 2) / TILE);
    const cr = Math.floor((f.y + f.h) / TILE);
    if (isSolid(tileAt(cx, cr))) {
      f.y = cr * TILE - f.h;
      f.vy = -5;
    }
    if (f.t % 2 === 0) {
      particles.push({ kind: 'fire-trail', x: f.x + f.w / 2, y: f.y + f.h / 2, life: 14, t: 0 });
    }
  }
  fireballs = fireballs.filter(f => f.t < f.life && f.y < LEVEL_H);
}

// =================================================================
// Particles
// =================================================================
function spawnCoinBurst(x, y) {
  particles.push({ kind: 'coin-burst', x, y, vy: -6, life: 30, t: 0 });
  spawnSparkles(x - 8, y - 8);
}
function spawnSparkles(x, y) {
  for (let i = 0; i < 5; i++) {
    particles.push({
      kind: 'spark',
      x: x + 8, y: y + 8,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3 - 1,
      life: 22, t: 0,
    });
  }
}
function spawnDust(x, y, scale = 1) {
  const n = Math.floor(4 + 3 * scale);
  for (let i = 0; i < n; i++) {
    particles.push({
      kind: 'dust',
      x, y,
      vx: (Math.random() - 0.5) * 2.6 * scale,
      vy: -Math.random() * 1.5 * scale,
      life: 18 + Math.floor(Math.random() * 6), t: 0,
    });
  }
}
function spawnBossExplosion(b) {
  for (let i = 0; i < 30; i++) {
    particles.push({
      kind: 'spark',
      x: b.x + b.w / 2, y: b.y + b.h / 2,
      vx: (Math.random() - 0.5) * 9,
      vy: (Math.random() - 0.5) * 9 - 2,
      life: 50, t: 0,
    });
  }
  for (let i = 0; i < 12; i++) {
    particles.push({
      kind: 'fire-trail',
      x: b.x + b.w / 2 + (Math.random() - 0.5) * 40,
      y: b.y + b.h / 2 + (Math.random() - 0.5) * 40,
      life: 30, t: 0,
    });
  }
}
function updateParticles() {
  for (const p of particles) {
    p.t++;
    p.x += p.vx || 0;
    p.y += p.vy || 0;
    if (p.vy != null && p.kind !== 'fire-trail') p.vy += 0.18;
  }
  particles = particles.filter(p => p.t < p.life);
}

// =================================================================
// Life / death helpers
// =================================================================
function loseLife(p) {
  if (!p.alive) return;
  p.alive = false;
  p.lives -= 1;
  spawnSparkles(p.x, p.y);
  if (p.lives > 0) setTimeout(() => respawn(p), 600);
}
function respawn(p) {
  // Spawn near the most-progressed alive partner so the camera (which
  // tracks the midpoint of alive players) stays coherent after a death
  // mid-stage. Drop from the top of the level so we don't materialize
  // inside a wall.
  const other = players.find(q => q !== p);
  const home = playerSpawns[p.id];
  let spawnX = home.x;
  let spawnY = home.y;
  if (other && other.alive && other.x > home.x + TILE * 6) {
    spawnX = Math.max(0, Math.min(LEVEL_W - p.w, other.x));
    spawnY = 0;
  }
  p.x = spawnX; p.y = spawnY;
  p.vx = 0; p.vy = 0;
  p.invuln = RESPAWN_INVULN;
  p.alive = true;
}

// =================================================================
// Collision rules
// =================================================================
// Tweakable: enemy collision. Default = stomp from above kills + bounces,
// side hit costs a life.
function handleEnemyHit(player, enemy, hitFromAbove) {
  if (player.invuln > 0) return;
  if (hitFromAbove) {
    enemy.alive = false;
    enemy.squashTimer = 20;
    player.vy = JUMP_V * 0.75;
    player.score += 100;
    sfx.stomp();
    spawnDust(enemy.x + enemy.w / 2, enemy.y + enemy.h - 4);
  } else {
    loseLife(player);
    sfx.hurt();
  }
}

function checkPlayerEnemyCollisions() {
  for (const p of players) {
    if (!p.alive) continue;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (!aabb(p, e)) continue;
      const prevBottom = p.y + p.h - p.vy;
      const hitFromAbove = p.vy > 0 && prevBottom <= e.y + 4;
      handleEnemyHit(p, e, hitFromAbove);
    }
  }
}

function checkBossCollisions() {
  if (!boss.alive) return;
  for (const p of players) {
    if (!p.alive || p.invuln > 0) continue;
    if (!aabb(p, boss)) continue;
    const prevBottom = p.y + p.h - p.vy;
    const hitFromAbove = p.vy > 0 && prevBottom <= boss.y + 8;
    if (hitFromAbove && boss.invuln <= 0) {
      boss.hp--;
      boss.invuln = 40;
      boss.flashTimer = 10;
      p.vy = JUMP_V * 0.95;
      p.score += 300;
      sfx.bossHit();
      spawnSparkles(boss.x + boss.w / 2 - 8, boss.y);
      if (boss.hp <= 0) {
        boss.alive = false;
        boss.defeated = true;
        boss.vy = -10;
        boss.vx = (Math.random() - 0.5) * 3;
        spawnBossExplosion(boss);
        sfx.bossDie();
      }
    } else if (!hitFromAbove) {
      loseLife(p);
      sfx.hurt();
    }
  }
}

function checkFireballCollisions() {
  for (const f of fireballs) {
    for (const p of players) {
      if (!p.alive || p.invuln > 0) continue;
      if (aabb(p, f)) {
        loseLife(p);
        sfx.hurt();
        f.t = f.life;
        break;
      }
    }
  }
}

// =================================================================
// Camera
// =================================================================
let cameraX = 0;
function updateCamera() {
  const alive = players.filter(p => p.alive);
  const ref = alive.length > 0 ? alive : players;
  const midX = ref.reduce((s, p) => s + p.x + p.w / 2, 0) / ref.length;
  let target = midX - W / 2;
  target = Math.max(0, Math.min(LEVEL_W - W, target));
  cameraX += (target - cameraX) * 0.15;
}

// =================================================================
// Rendering
// =================================================================
function drawTile(c, r) {
  const t = tileGrid[r][c];
  if (t === T_EMPTY) return;
  const x = c * TILE - cameraX;
  const y = r * TILE;
  if (x + TILE < 0 || x > W) return;

  if (t === T_BRICK) {
    ctx.fillStyle = '#b1602f';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#8a4520';
    ctx.fillRect(x, y, TILE, 4);
    ctx.fillRect(x, y + TILE / 2, TILE, 2);
    ctx.fillRect(x + TILE / 2 - 1, y, 2, TILE / 2);
    ctx.fillRect(x + TILE / 4 - 1, y + TILE / 2, 2, TILE / 2);
    ctx.fillRect(x + (TILE * 3) / 4 - 1, y + TILE / 2, 2, TILE / 2);
  } else if (t === T_STONE) {
    ctx.fillStyle = '#888';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#555';
    ctx.fillRect(x, y, TILE, 2);
    ctx.fillRect(x, y + TILE - 2, TILE, 2);
    ctx.fillRect(x, y, 2, TILE);
    ctx.fillRect(x + TILE - 2, y, 2, TILE);
  } else if (t === T_QUESTION) {
    const used = questionBlocksUsed.has(c + ',' + r);
    ctx.fillStyle = used ? '#9a6a2a' : '#e8a72a';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = used ? '#6f4a1a' : '#b07814';
    ctx.fillRect(x, y, TILE, 3);
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    ctx.fillRect(x, y, 3, TILE);
    ctx.fillRect(x + TILE - 3, y, 3, TILE);
    if (!used) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x + TILE / 2, y + TILE / 2 + 2);
    }
  }
}

function drawLevel() {
  const firstCol = Math.max(0, Math.floor(cameraX / TILE));
  const lastCol = Math.min(COLS - 1, Math.ceil((cameraX + W) / TILE));
  for (let r = 0; r < ROWS; r++) {
    for (let c = firstCol; c <= lastCol; c++) {
      drawTile(c, r);
    }
  }
}

function drawGoal() {
  const x = goalPos.x - cameraX;
  const y = goalPos.y;
  ctx.fillStyle = '#666';
  ctx.fillRect(x + TILE / 2 - 2, y - TILE * 2, 4, TILE * 4);
  ctx.fillStyle = boss.defeated ? '#ffd86b' : '#7a7a7a';
  ctx.beginPath();
  ctx.moveTo(x + TILE / 2 + 2, y - TILE * 2);
  ctx.lineTo(x + TILE / 2 + 2 + 22, y - TILE * 2 + 8);
  ctx.lineTo(x + TILE / 2 + 2, y - TILE * 2 + 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#444';
  ctx.fillRect(x, y + TILE * 2 - 8, TILE, 8);
}

function drawCoin(c) {
  if (c.collected) return;
  const x = c.x - cameraX, y = c.y;
  if (x < -20 || x > W + 20) return;
  const bob = Math.sin(c.t * 0.15) * 2;
  ctx.fillStyle = '#ffd86b';
  ctx.beginPath();
  ctx.ellipse(x + 8, y + 8 + bob, 6, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b07814';
  ctx.fillRect(x + 7, y + 4 + bob, 2, 8);
}

function drawEnemy(e) {
  const x = e.x - cameraX, y = e.y;
  if (x < -40 || x > W + 40) return;
  if (!e.alive) {
    if (e.squashTimer <= 0) return;
    ctx.fillStyle = '#8a4520';
    ctx.fillRect(x, y + e.h - 8, e.w, 8);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 6, y + e.h - 5, 3, 3);
    ctx.fillRect(x + e.w - 9, y + e.h - 5, 3, 3);
    return;
  }
  ctx.fillStyle = '#8a4520';
  ctx.fillRect(x + 2, y + 8, e.w - 4, e.h - 12);
  ctx.beginPath();
  ctx.arc(x + e.w / 2, y + 10, e.w / 2, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#3a1f10';
  ctx.fillRect(x, y + e.h - 4, 10, 4);
  ctx.fillRect(x + e.w - 10, y + e.h - 4, 10, 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 7, y + 10, 5, 6);
  ctx.fillRect(x + e.w - 12, y + 10, 5, 6);
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 9 + (e.vx < 0 ? -1 : 1), y + 12, 2, 3);
  ctx.fillRect(x + e.w - 10 + (e.vx < 0 ? -1 : 1), y + 12, 2, 3);
}

function drawPlayer(p) {
  if (!p.alive) return;
  if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0) return;
  const x = p.x - cameraX, y = p.y;
  ctx.fillStyle = p.color;
  ctx.fillRect(x, y + 8, p.w, p.h - 8);
  ctx.fillStyle = '#fcd7a8';
  ctx.fillRect(x + 4, y, p.w - 8, 12);
  ctx.fillStyle = p.color;
  ctx.fillRect(x + 4, y, p.w - 8, 5);
  ctx.fillRect(x + (p.facing > 0 ? p.w - 6 : 2), y + 3, 4, 4);
  ctx.fillStyle = '#000';
  ctx.fillRect(x + (p.facing > 0 ? p.w - 10 : 6), y + 6, 2, 3);
  ctx.fillStyle = '#3a1a0c';
  ctx.fillRect(x, y + p.h - 4, 10, 4);
  ctx.fillRect(x + p.w - 10, y + p.h - 4, 10, 4);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P' + p.id, x + p.w / 2, y + p.h - 12);
}

function drawBoss(b) {
  if (!b.alive && b.y > LEVEL_H) return;
  const x = b.x - cameraX, y = b.y;
  if (x + b.w < -50 || x > W + 50) return;
  const flash = b.flashTimer > 0;
  // Body
  ctx.fillStyle = flash ? '#fff' : '#4a1f5a';
  ctx.fillRect(x, y + 12, b.w, b.h - 16);
  // Spikes on top
  ctx.fillStyle = flash ? '#fff' : '#6b2c80';
  ctx.beginPath();
  let sx = x;
  ctx.moveTo(sx, y + 14);
  for (let i = 0; i < 4; i++) {
    ctx.lineTo(sx + 7, y - 2);
    ctx.lineTo(sx + 14, y + 14);
    sx += 14;
  }
  ctx.closePath();
  ctx.fill();
  // Eyes
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 10, y + 22, 10, 12);
  ctx.fillRect(x + b.w - 20, y + 22, 10, 12);
  ctx.fillStyle = '#000';
  const ed = b.vx < 0 ? -2 : 2;
  ctx.fillRect(x + 13 + ed, y + 26, 4, 6);
  ctx.fillRect(x + b.w - 17 + ed, y + 26, 4, 6);
  // Mouth
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 14, y + 40, b.w - 28, 8);
  ctx.fillStyle = '#ff5050';
  ctx.fillRect(x + 14, y + 40, b.w - 28, 2);
  // Fangs
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 18, y + 40, 3, 5);
  ctx.fillRect(x + b.w - 21, y + 40, 3, 5);
  // Feet
  ctx.fillStyle = flash ? '#fff' : '#2a0c34';
  ctx.fillRect(x, y + b.h - 6, 16, 6);
  ctx.fillRect(x + b.w - 16, y + b.h - 6, 16, 6);
  // HP bar
  if (b.alive) {
    const bx = x, by = y - 16;
    ctx.fillStyle = '#222';
    ctx.fillRect(bx - 1, by - 1, b.w + 2, 8);
    ctx.fillStyle = '#444';
    ctx.fillRect(bx, by, b.w, 6);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(bx, by, (b.hp / b.maxHp) * b.w, 6);
  }
}

function drawFireball(f) {
  const x = f.x - cameraX, y = f.y;
  if (x < -20 || x > W + 20) return;
  ctx.fillStyle = '#ff8030';
  ctx.beginPath();
  ctx.arc(x + 7, y + 7, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd86b';
  ctx.beginPath();
  ctx.arc(x + 7, y + 7, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + 6, y + 5, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawParticle(p) {
  const x = p.x - cameraX, y = p.y;
  if (p.kind === 'coin-burst') {
    ctx.fillStyle = '#ffd86b';
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.beginPath();
    ctx.arc(x, y + p.vy * p.t, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (p.kind === 'spark') {
    ctx.fillStyle = '#fff8c0';
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.globalAlpha = 1;
  } else if (p.kind === 'dust') {
    const a = 0.7 * (1 - p.t / p.life);
    ctx.fillStyle = 'rgba(220,200,170,' + a + ')';
    const sz = 6 - p.t * 0.18;
    if (sz > 0) ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
  } else if (p.kind === 'fire-trail') {
    const a = 1 - p.t / p.life;
    ctx.fillStyle = 'rgba(255,140,30,' + (a * 0.8) + ')';
    ctx.beginPath();
    ctx.arc(x, y, 5 + p.t * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,120,' + a + ')';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawClouds() {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 8; i++) {
    const cx = ((i * 280 - cameraX * 0.3) % (LEVEL_W + 300) + LEVEL_W * 2) % (LEVEL_W + 300);
    const cy = 40 + (i % 3) * 32;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.arc(cx + 18, cy + 4, 16, 0, Math.PI * 2);
    ctx.arc(cx - 18, cy + 4, 16, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHUD() {
  document.getElementById('p1-lives').textContent = '♥'.repeat(Math.max(0, players[0].lives));
  document.getElementById('p2-lives').textContent = '♥'.repeat(Math.max(0, players[1].lives));
  document.getElementById('p1-score').textContent = players[0].score;
  document.getElementById('p2-score').textContent = players[1].score;
  document.getElementById('p1-coins').textContent = '🪙 ' + players[0].coins;
  document.getElementById('p2-coins').textContent = '🪙 ' + players[1].coins;
  document.getElementById('message').textContent = message;
}

function render() {
  ctx.clearRect(0, 0, W, H);
  drawClouds();
  drawLevel();
  drawGoal();
  for (const c of coins) drawCoin(c);
  for (const e of enemies) drawEnemy(e);
  drawBoss(boss);
  for (const f of fireballs) drawFireball(f);
  for (const p of particles) drawParticle(p);
  for (const p of players) drawPlayer(p);
}

// =================================================================
// Game state
// =================================================================
function checkGameState() {
  if (gameState !== 'playing') return;

  // Contextual message
  const enteringArena = players.some(p => p.x > 88 * TILE);
  if (!boss.defeated && enteringArena) message = '⚔ ボスを倒せ！ ⚔';
  else if (boss.defeated && !players.some(p => p.reachedGoal)) message = '🏁 旗を目指せ！';
  else if (!enteringArena) message = '';

  if (players.some(p => p.reachedGoal)) {
    gameState = 'won';
    const total = players.reduce((s, p) => s + p.score + p.coins * 50, 0);
    message = `🎉 クリア！ 合計スコア ${total}  ( R でリスタート )`;
    sfx.win();
    return;
  }
  if (players.every(p => p.lives <= 0 && !p.alive)) {
    gameState = 'gameover';
    message = '💀 ゲームオーバー　( R でリスタート )';
    sfx.gameover();
  }
}

// =================================================================
// Main loop
// =================================================================
function tick() {
  if (gameState === 'playing') {
    frame++;
    for (const p of players) updatePlayer(p);
    for (const e of enemies) updateEnemy(e);
    updateBoss(boss);
    updateFireballs();
    updateCoins();
    checkPlayerEnemyCollisions();
    checkBossCollisions();
    checkFireballCollisions();
    updateParticles();
    updateCamera();
    checkGameState();
  }
  render();
  drawHUD();
  requestAnimationFrame(tick);
}

resetGame();
updateCamera();
tick();
