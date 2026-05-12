// =====================================================================
// Mini Terraria — tile-based sandbox
//   - Tile world (2D array of block IDs)
//   - Camera-following AABB physics
//   - Left click: mine, Right click: place selected block
//   - Hotbar (1-6) with item counts
//   - Particle effects + WebAudio SFX for mine/place/jump/land
//   - Terrain generation is left to the player (see generateTerrain())
// =====================================================================

// ----- Canvas / DOM ---------------------------------------------------
const canvas = document.getElementById("game");
const ctx    = canvas.getContext("2d");
const hpText = document.getElementById("hp-text");
const hpFill = document.getElementById("hp-fill");
const posText = document.getElementById("pos-text");
const fpsText = document.getElementById("fps-text");
const hotbarEl = document.getElementById("hotbar");
const msgEl    = document.getElementById("message");

// ----- World constants ------------------------------------------------
const TILE   = 24;                          // px per tile
const W_TILE = 200;                         // world width  (tiles)
const H_TILE = 80;                          // world height (tiles)
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// Block definitions: id -> { name, color, solid, hardness, drops }
const BLOCKS = {
  0: { name: "Air",   color: null,      solid: false, hardness: 0,   drops: null },
  1: { name: "Grass", color: "#5cb04a", solid: true,  hardness: 0.3, drops: 1 },
  2: { name: "Dirt",  color: "#8b5a2b", solid: true,  hardness: 0.3, drops: 2 },
  3: { name: "Stone", color: "#7a7a7a", solid: true,  hardness: 0.8, drops: 3 },
  4: { name: "Wood",  color: "#a06a3a", solid: true,  hardness: 0.5, drops: 4 },
  5: { name: "Leaf",  color: "#3a8a3a", solid: false, hardness: 0.1, drops: 5 },
};

// The 6 hotbar slots (block id, count). Slot 0 = "no place" placeholder.
const hotbar = [
  { id: 0, count: Infinity }, // air = stop placing
  { id: 1, count: 0 },
  { id: 2, count: 0 },
  { id: 3, count: 0 },
  { id: 4, count: 0 },
  { id: 5, count: 0 },
];
let selectedSlot = 1;

// ----- World data -----------------------------------------------------
// Stored as a flat Uint8Array of length W_TILE * H_TILE.
const world = new Uint8Array(W_TILE * H_TILE);
const idx   = (x, y) => y * W_TILE + x;
const inBounds = (x, y) => x >= 0 && x < W_TILE && y >= 0 && y < H_TILE;
const getTile  = (x, y) => (inBounds(x, y) ? world[idx(x, y)] : 0);
const setTile  = (x, y, id) => { if (inBounds(x, y)) world[idx(x, y)] = id; };
const isSolid  = (x, y) => BLOCKS[getTile(x, y)].solid;

// ----- Player ---------------------------------------------------------
const player = {
  x: 0, y: 0,                     // top-left world position (px)
  w: TILE * 0.8, h: TILE * 1.8,   // hitbox
  vx: 0, vy: 0,
  onGround: false,
  hp: 100, hpMax: 100,
  reach: 5,                       // tiles
};

const GRAVITY    = 1400;          // px/s^2
const MOVE_SPEED = 220;           // px/s
const JUMP_VEL   = 480;           // px/s

// ----- Input ----------------------------------------------------------
const keys = new Set();
let mouseX = 0, mouseY = 0;
let mining = false, placing = false;

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code >= "Digit1" && e.code <= "Digit5") {
    selectedSlot = parseInt(e.code.replace("Digit", ""), 10);
    renderHotbar();
  }
  if (e.code === "KeyM") { muted = !muted; flash(muted ? "Muted" : "Unmuted"); }
  if (e.code === "KeyR") { resetWorld(); }
  if (e.code === "Space" || e.code === "KeyW") e.preventDefault();
});
window.addEventListener("keyup",   (e) => keys.delete(e.code));

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouseX = e.clientX - r.left;
  mouseY = e.clientY - r.top;
});
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) mining = true;
  if (e.button === 2) placing = true;
});
canvas.addEventListener("mouseup", (e) => {
  if (e.button === 0) mining = false;
  if (e.button === 2) placing = false;
});

// ----- WebAudio SFX ---------------------------------------------------
let audioCtx = null;
let muted = false;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function beep(freq, dur, type = "square", vol = 0.08, slide = 0) {
  if (muted) return;
  ensureAudio();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), audioCtx.currentTime + dur);
  g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + dur);
}
const SFX = {
  jump:  () => beep(540, 0.10, "square",   0.06, +120),
  land:  () => beep(160, 0.08, "sine",     0.08, -40),
  mine:  () => beep(220 + Math.random() * 80, 0.06, "square", 0.05, -60),
  place: () => beep(380, 0.05, "triangle", 0.07, +60),
  break: () => beep(120, 0.12, "sawtooth", 0.10, -60),
  hurt:  () => beep(180, 0.15, "square",   0.12, -100),
};

// ----- Particles ------------------------------------------------------
const particles = [];
function spawnBreakParticles(tx, ty, color) {
  for (let i = 0; i < 10; i++) {
    particles.push({
      x: tx * TILE + TILE / 2 + (Math.random() - 0.5) * TILE,
      y: ty * TILE + TILE / 2 + (Math.random() - 0.5) * TILE,
      vx: (Math.random() - 0.5) * 180,
      vy: -Math.random() * 200 - 40,
      life: 0.5 + Math.random() * 0.3,
      age: 0,
      color,
      size: 3 + Math.random() * 3,
    });
  }
}
function spawnLandPuff(px, py) {
  for (let i = 0; i < 6; i++) {
    particles.push({
      x: px, y: py,
      vx: (Math.random() - 0.5) * 140,
      vy: -Math.random() * 60,
      life: 0.3, age: 0,
      color: "#dcd0a8", size: 2 + Math.random() * 2,
    });
  }
}

// ----- Hotbar UI ------------------------------------------------------
function renderHotbar() {
  hotbarEl.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const slot = hotbar[i];
    const b    = BLOCKS[slot.id];
    const el   = document.createElement("div");
    el.className = "slot" + (i === selectedSlot ? " active" : "");
    el.innerHTML = `
      <span class="hotkey">${i}</span>
      <span class="swatch" style="background:${b.color || "#222"}"></span>
      <span class="name">${b.name}</span>
      <span class="count">${slot.count === Infinity ? "" : slot.count}</span>
    `;
    el.addEventListener("click", () => { selectedSlot = i; renderHotbar(); });
    hotbarEl.appendChild(el);
  }
}

function flash(text, ms = 1200) {
  msgEl.textContent = text;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { msgEl.textContent = ""; }, ms);
}

// ----- World reset & terrain hook ------------------------------------
function resetWorld() {
  world.fill(0);
  generateTerrain(world, W_TILE, H_TILE);

  // Drop the player onto the highest solid column near the centre.
  const cx = (W_TILE / 2) | 0;
  let surfaceY = 0;
  while (surfaceY < H_TILE && !isSolid(cx, surfaceY)) surfaceY++;
  player.x  = cx * TILE + (TILE - player.w) / 2;
  player.y  = surfaceY * TILE - player.h - 1;
  player.vx = player.vy = 0;
  player.hp = player.hpMax;

  // Give the player a starter inventory of dirt so they can build immediately.
  hotbar[2].count = 16;
  renderHotbar();
  flash("World generated", 900);
}

// ----- Physics --------------------------------------------------------
function moveAxis(dx, dy) {
  // Move the player by (dx, dy) and resolve tile collisions on a single axis.
  player.x += dx;
  player.y += dy;

  // Tile range covered by the new AABB.
  const tx0 = Math.floor(player.x / TILE);
  const tx1 = Math.floor((player.x + player.w - 0.001) / TILE);
  const ty0 = Math.floor(player.y / TILE);
  const ty1 = Math.floor((player.y + player.h - 0.001) / TILE);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!isSolid(tx, ty)) continue;
      const bx = tx * TILE, by = ty * TILE;
      if (dx > 0) player.x = bx - player.w;
      else if (dx < 0) player.x = bx + TILE;
      if (dy > 0) {
        player.y  = by - player.h;
        if (!player.onGround && player.vy > 200) {
          SFX.land();
          spawnLandPuff(player.x + player.w / 2, player.y + player.h);
        }
        player.vy = 0;
        player.onGround = true;
      } else if (dy < 0) {
        player.y = by + TILE;
        player.vy = 0;
      }
    }
  }
}

function updatePlayer(dt) {
  // Horizontal input.
  let ax = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft"))  ax -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) ax += 1;
  player.vx = ax * MOVE_SPEED;

  // Jump.
  if ((keys.has("KeyW") || keys.has("Space") || keys.has("ArrowUp")) && player.onGround) {
    player.vy = -JUMP_VEL;
    player.onGround = false;
    SFX.jump();
  }

  // Integrate gravity.
  player.vy += GRAVITY * dt;
  if (player.vy > 1200) player.vy = 1200;

  player.onGround = false;
  moveAxis(player.vx * dt, 0);
  moveAxis(0, player.vy * dt);

  // World bounds.
  if (player.x < 0) player.x = 0;
  if (player.x + player.w > W_TILE * TILE) player.x = W_TILE * TILE - player.w;
  if (player.y > H_TILE * TILE) { player.hp = 0; }
}

// ----- Mining / placing ----------------------------------------------
let mineProgress = 0;     // 0..1 against current target's hardness
let mineTarget   = null;  // {x, y}

function targetTile(camX, camY) {
  const wx = mouseX + camX;
  const wy = mouseY + camY;
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  // Reach check (centre-to-centre).
  const pcx = player.x + player.w / 2;
  const pcy = player.y + player.h / 2;
  const dx = (tx + 0.5) * TILE - pcx;
  const dy = (ty + 0.5) * TILE - pcy;
  if (Math.hypot(dx, dy) > player.reach * TILE) return null;
  return { tx, ty };
}

function tryMine(dt, camX, camY) {
  const t = targetTile(camX, camY);
  if (!t) { mineTarget = null; mineProgress = 0; return; }
  const id = getTile(t.tx, t.ty);
  if (id === 0) { mineTarget = null; mineProgress = 0; return; }
  if (!mineTarget || mineTarget.tx !== t.tx || mineTarget.ty !== t.ty) {
    mineTarget = t; mineProgress = 0;
  }
  mineProgress += dt;
  SFX.mine();
  if (mineProgress >= BLOCKS[id].hardness) {
    // Break the block.
    setTile(t.tx, t.ty, 0);
    spawnBreakParticles(t.tx, t.ty, BLOCKS[id].color);
    SFX.break();
    const dropId = BLOCKS[id].drops;
    if (dropId != null) {
      // Find the matching hotbar slot, or fall back to any.
      const slot = hotbar.find(s => s.id === dropId);
      if (slot && slot.count !== Infinity) slot.count += 1;
      renderHotbar();
    }
    mineTarget = null; mineProgress = 0;
  }
}

function tryPlace(camX, camY) {
  const t = targetTile(camX, camY);
  if (!t) return;
  if (getTile(t.tx, t.ty) !== 0) return;
  const slot = hotbar[selectedSlot];
  if (slot.id === 0 || slot.count <= 0) return;
  // Don't place inside the player.
  const bx = t.tx * TILE, by = t.ty * TILE;
  if (bx < player.x + player.w && bx + TILE > player.x &&
      by < player.y + player.h && by + TILE > player.y) return;
  setTile(t.tx, t.ty, slot.id);
  slot.count -= 1;
  SFX.place();
  renderHotbar();
}

// ----- Render ---------------------------------------------------------
function drawWorld(camX, camY) {
  // Sky gradient is the canvas background; draw a soft underground tint below ground.
  const tx0 = Math.max(0, Math.floor(camX / TILE));
  const tx1 = Math.min(W_TILE - 1, Math.floor((camX + VIEW_W) / TILE));
  const ty0 = Math.max(0, Math.floor(camY / TILE));
  const ty1 = Math.min(H_TILE - 1, Math.floor((camY + VIEW_H) / TILE));

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = world[idx(tx, ty)];
      if (id === 0) continue;
      const b = BLOCKS[id];
      const x = tx * TILE - camX;
      const y = ty * TILE - camY;
      ctx.fillStyle = b.color;
      ctx.fillRect(x, y, TILE, TILE);
      // Cheap shading: darker bottom edge.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(x, y + TILE - 3, TILE, 3);
      ctx.fillRect(x + TILE - 2, y, 2, TILE);
    }
  }
}

function drawPlayer(camX, camY) {
  const x = player.x - camX, y = player.y - camY;
  // Body
  ctx.fillStyle = "#ffcf6b";
  ctx.fillRect(x, y, player.w, player.h);
  // Head
  ctx.fillStyle = "#f7e1c4";
  ctx.fillRect(x + 2, y + 2, player.w - 4, player.w - 4);
  // Eyes
  ctx.fillStyle = "#222";
  ctx.fillRect(x + 4, y + 7, 3, 3);
  ctx.fillRect(x + player.w - 7, y + 7, 3, 3);
}

function drawTargetReticle(camX, camY) {
  const t = targetTile(camX, camY);
  if (!t) return;
  const x = t.tx * TILE - camX, y = t.ty * TILE - camY;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);

  if (mineTarget && mineTarget.tx === t.tx && mineTarget.ty === t.ty) {
    const id = getTile(t.tx, t.ty);
    if (id !== 0) {
      const pct = Math.min(1, mineProgress / BLOCKS[id].hardness);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x, y, TILE * pct, TILE);
    }
  }
}

function drawParticles(camX, camY) {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camX - p.size / 2, p.y - camY - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    p.vy += GRAVITY * 0.6 * dt;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
  }
}

// ----- HUD ------------------------------------------------------------
function updateHUD(fps) {
  hpText.textContent = Math.max(0, Math.round(player.hp));
  hpFill.style.width = (Math.max(0, player.hp) / player.hpMax * 100) + "%";
  posText.textContent = `${Math.floor(player.x / TILE)},${Math.floor(player.y / TILE)}`;
  fpsText.textContent = fps.toFixed(0);
}

// ----- Main loop ------------------------------------------------------
let last = performance.now();
let fpsAvg = 60;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // clamp on tab-switch

  updatePlayer(dt);

  // Camera centred on player, clamped to world.
  let camX = player.x + player.w / 2 - VIEW_W / 2;
  let camY = player.y + player.h / 2 - VIEW_H / 2;
  camX = Math.max(0, Math.min(W_TILE * TILE - VIEW_W, camX));
  camY = Math.max(0, Math.min(H_TILE * TILE - VIEW_H, camY));

  if (mining)  tryMine(dt, camX, camY);  else { mineTarget = null; mineProgress = 0; }
  if (placing) { tryPlace(camX, camY); placing = false; } // single-shot per click

  updateParticles(dt);

  // Sky gradient: lighter at top, fading toward horizon.
  const grd = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grd.addColorStop(0, "#6cbcf7");
  grd.addColorStop(1, "#c8e8ff");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawWorld(camX, camY);
  drawParticles(camX, camY);
  drawPlayer(camX, camY);
  drawTargetReticle(camX, camY);

  fpsAvg = fpsAvg * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  updateHUD(fpsAvg);

  requestAnimationFrame(frame);
}

// ======================================================================
// TODO (player contribution): generateTerrain(world, W, H)
// ======================================================================
//
// You define how the world *feels*. The function receives:
//   world : Uint8Array of length W * H, all zeros (= Air)
//   W, H  : tile dimensions of the world
//
// Block IDs you can write:
//   1 = Grass (green top layer)
//   2 = Dirt
//   3 = Stone
//   4 = Wood
//   5 = Leaf
//
// Helpers available in scope:
//   const set = (x, y, id) => { world[y * W + x] = id; };
//
// Trade-offs to consider:
//   - Flat vs hilly: a simple sine wave gives gentle rolling hills;
//     layered sines (multi-octave) feel more natural and Terraria-ish.
//   - Cave density: subtracting blocks below the surface adds explorability,
//     but too many caves leave the world feeling empty.
//   - Trees: a few wood+leaf clusters on grass tiles add life cheaply.
//
// Write 5-15 lines. The simplest version is a sine-wave height map;
// the most fun version layers multiple frequencies and sprinkles trees.
// ======================================================================
function generateTerrain(world, W, H) {
  const set = (x, y, id) => { world[y * W + x] = id; };

  // TODO: replace this placeholder with your own terrain.
  // Placeholder: a perfectly flat world at y = H/2 so the game still runs.
  const surface = Math.floor(H / 2);
  for (let x = 0; x < W; x++) {
    set(x, surface, 1);
    for (let y = surface + 1; y < H; y++) {
      set(x, y, y < surface + 5 ? 2 : 3);
    }
  }
}

// ----- Boot -----------------------------------------------------------
resetWorld();
renderHotbar();
requestAnimationFrame(frame);
