// =====================================================================
// Mini Terraria — tile-based sandbox
//   - Tile world (2D array of block IDs)
//   - Camera-following AABB physics shared by player / enemies / items
//   - Left click: mine block OR attack enemy under cursor
//   - Right click (or Shift+Left): place selected block
//   - Hotbar (1-5) for blocks; Inventory (E) for items (heart / coin)
//   - Slime enemies wander and chase; drop hearts/coins on death
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
const coinText  = document.getElementById("coin-text");
const heartText = document.getElementById("heart-text");

// ----- World constants ------------------------------------------------
const TILE   = 24;                          // px per tile
const W_TILE = 200;                         // world width  (tiles)
const H_TILE = 80;                          // world height (tiles)
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// Block definitions: id -> { name, color, solid, hardness, drops }
// "drops" is the item key returned to the player when the block is broken.
const BLOCKS = {
  0: { name: "Air",       color: null,      solid: false, hardness: 0,   drops: null },
  1: { name: "Grass",     color: "#5cb04a", solid: true,  hardness: 0.3, drops: 1 },
  2: { name: "Dirt",      color: "#8b5a2b", solid: true,  hardness: 0.3, drops: 2 },
  3: { name: "Stone",     color: "#7a7a7a", solid: true,  hardness: 0.8, drops: 3 },
  4: { name: "Wood",      color: "#a06a3a", solid: true,  hardness: 0.5, drops: 4 },
  5: { name: "Leaf",      color: "#3a8a3a", solid: false, hardness: 0.1, drops: 5 },
  6: { name: "Workbench", color: "#c08a5a", solid: true,  hardness: 0.4, drops: 6 },
};

// Hotbar: slots 1..6, fixed block id per slot. Slot 0 reserved (unused sentinel).
const hotbar = [
  { id: 0, count: Infinity },
  { id: 1, count: 0 },
  { id: 2, count: 0 },
  { id: 3, count: 0 },
  { id: 4, count: 0 },
  { id: 5, count: 0 },
  { id: 6, count: 0 },
];
const HOTBAR_LAST = 6;
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
  iframe: 0,                      // seconds of invulnerability after hit
  attackCD: 0,                    // seconds until next melee swing
  spawnX: 0, spawnY: 0,           // respawn point set on world reset
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
  if (e.code >= "Digit1" && e.code <= "Digit6") {
    selectedSlot = parseInt(e.code.replace("Digit", ""), 10);
    renderHotbar();
  }
  if (e.code === "KeyQ") cycleWeapon();
  if (e.code === "KeyC") { craftingOpen = !craftingOpen; inventoryOpen = false; }
  if (e.code === "KeyM") { muted = !muted; flash(muted ? "Muted" : "Unmuted"); }
  if (e.code === "KeyR") { resetWorld(); }
  if (e.code === "KeyE") { inventoryOpen = !inventoryOpen; }
  if (e.code === "KeyH") { useHeart(); }
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
  // Crafting / inventory overlays consume clicks first.
  if (craftingOpen) { craftingHitTest(mouseX, mouseY); return; }
  if (inventoryOpen) { inventoryHitTest(mouseX, mouseY); return; }
  if (e.button === 0) {
    // Shift+Left or Cmd+Left places (Mac-trackpad friendly alternative to right-click).
    if (e.shiftKey || e.metaKey) placing = true;
    else mining = true;
  }
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
  jump:   () => beep(540, 0.10, "square",   0.06, +120),
  land:   () => beep(160, 0.08, "sine",     0.08, -40),
  mine:   () => beep(220 + Math.random() * 80, 0.06, "square", 0.05, -60),
  place:  () => beep(380, 0.05, "triangle", 0.07, +60),
  break:  () => beep(120, 0.12, "sawtooth", 0.10, -60),
  hurt:   () => beep(180, 0.15, "square",   0.12, -100),
  hit:    () => beep(420, 0.06, "square",   0.08, -200),
  pickup: () => beep(880, 0.08, "triangle", 0.08, +200),
  heal:   () => beep(660, 0.18, "sine",     0.10, +220),
};

// ----- Inventory (non-block items) ------------------------------------
const inventory = { heart: 0, coin: 0 };
let inventoryOpen = false;

const ITEM_DEF = {
  heart: { color: "#ff5577", label: "Heart", glyph: "♥" },
  coin:  { color: "#ffd86b", label: "Coin",  glyph: "$" },
};

function collectItem(type) {
  inventory[type] = (inventory[type] || 0) + 1;
  SFX.pickup();
}

function useHeart() {
  if (inventory.heart <= 0 || player.hp >= player.hpMax) return;
  inventory.heart -= 1;
  player.hp = Math.min(player.hpMax, player.hp + 25);
  SFX.heal();
  flash("+25 HP", 600);
}

// ----- Weapons & ammo -------------------------------------------------
// Weapons are *owned* (0 or 1 of each, persisting after craft) and the player
// has one *active* weapon at a time. Ammo (arrows) is consumed on use.
const weapons = { sword: 0, bow: 0, boomerang: 0 };
const ammo    = { arrow: 0 };

const WEAPON_DEF = {
  sword:     { label: "Wood Sword",     color: "#d8d8e0", cooldown: 0.35, dmg: 22, range: TILE * 1.6 },
  bow:       { label: "Wood Bow",       color: "#a06a3a", cooldown: 0.55, dmg: 18 },
  boomerang: { label: "Wood Boomerang", color: "#c8a060", cooldown: 0.8,  dmg: 16 },
};
const WEAPON_ORDER = [null, "sword", "bow", "boomerang"];
let activeWeapon = null;            // null | "sword" | "bow" | "boomerang"
let swingTimer   = 0;               // sword swing animation timer (seconds remaining)
let swingDir     = 1;               // facing for the swing (-1 left, +1 right)
let boomerangOut = false;           // a thrown boomerang exists in `projectiles`

function cycleWeapon() {
  // Skip weapons the player hasn't crafted yet.
  const owned = WEAPON_ORDER.filter(w => w === null || weapons[w] > 0);
  const i = owned.indexOf(activeWeapon);
  activeWeapon = owned[(i + 1) % owned.length];
  flash(activeWeapon ? "Equip: " + WEAPON_DEF[activeWeapon].label : "Unequipped", 700);
}

// ----- Crafting -------------------------------------------------------
// Each recipe: { id, label, station: "hand"|"workbench", needs: {key:count}, gives: fn(state) }
// Material keys can be hotbar block ids ("b1".."b6") or item keys ("arrow", etc).
const RECIPES = [
  { id: "workbench", label: "Workbench (x1)", station: "hand",
    needs: { b4: 10 }, gives: () => { hotbar[6].count += 1; } },
  { id: "sword",     label: "Wood Sword",     station: "workbench",
    needs: { b4: 7 },  gives: () => { weapons.sword = 1; if (!activeWeapon) activeWeapon = "sword"; } },
  { id: "bow",       label: "Wood Bow",       station: "workbench",
    needs: { b4: 10 }, gives: () => { weapons.bow = 1; } },
  { id: "boomerang", label: "Wood Boomerang", station: "workbench",
    needs: { b4: 8 },  gives: () => { weapons.boomerang = 1; } },
  { id: "arrows",    label: "Wood Arrows (x10)", station: "workbench",
    needs: { b4: 1, b3: 1 }, gives: () => { ammo.arrow += 10; } },
];
let craftingOpen = false;

function nearWorkbench() {
  const r = 6; // tiles
  const pcx = (player.x + player.w / 2) / TILE;
  const pcy = (player.y + player.h / 2) / TILE;
  const x0 = Math.max(0, Math.floor(pcx - r));
  const x1 = Math.min(W_TILE - 1, Math.floor(pcx + r));
  const y0 = Math.max(0, Math.floor(pcy - r));
  const y1 = Math.min(H_TILE - 1, Math.floor(pcy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (getTile(x, y) === 6) return true;
  return false;
}

function getMaterial(key) {
  if (key.startsWith("b")) return hotbar[parseInt(key.slice(1), 10)].count;
  return (key in inventory) ? inventory[key] : (key in ammo) ? ammo[key] : 0;
}
function spendMaterial(key, n) {
  if (key.startsWith("b")) hotbar[parseInt(key.slice(1), 10)].count -= n;
  else if (key in inventory) inventory[key] -= n;
  else if (key in ammo)     ammo[key] -= n;
}
function canCraft(r) {
  if (r.station === "workbench" && !nearWorkbench()) return false;
  for (const k in r.needs) if (getMaterial(k) < r.needs[k]) return false;
  return true;
}
function doCraft(r) {
  if (!canCraft(r)) { SFX.hurt(); return; }
  for (const k in r.needs) spendMaterial(k, r.needs[k]);
  r.gives();
  SFX.place();
  flash("Crafted: " + r.label, 900);
  renderHotbar();
}

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
  for (let i = 1; i <= HOTBAR_LAST; i++) {
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
  player.spawnX = player.x;
  player.spawnY = player.y;
  player.vx = player.vy = 0;
  player.hp = player.hpMax;
  player.iframe = 1.0;

  // Clear transient entities.
  enemies.length = 0;
  items.length = 0;
  projectiles.length = 0;
  enemySpawnTimer = 5;
  boomerangOut = false;

  // Light starter inventory; Terraria-style progression means you craft the rest.
  hotbar[1].count = 0;
  hotbar[2].count = 16;  // some dirt to build with
  hotbar[3].count = 0;
  hotbar[4].count = 12;  // enough wood for a Workbench (10) + a sword/bow later
  hotbar[5].count = 0;
  hotbar[6].count = 0;
  inventory.heart = 0;
  inventory.coin  = 0;
  weapons.sword = weapons.bow = weapons.boomerang = 0;
  ammo.arrow    = 0;
  activeWeapon  = null;
  renderHotbar();
  flash("World generated — press C to craft", 1400);
}

// ----- Physics --------------------------------------------------------
// Generic single-axis AABB vs tilemap resolver, used by player / enemies / items.
// `ent` requires { x, y, w, h, vx, vy, onGround? }. Mutates ent in place.
// `opts.onLand(ent)` fires when a falling entity hits ground this step.
// Returns true if movement was blocked on this axis.
function moveEntityAxis(ent, dx, dy, opts) {
  ent.x += dx;
  ent.y += dy;
  const tx0 = Math.floor(ent.x / TILE);
  const tx1 = Math.floor((ent.x + ent.w - 0.001) / TILE);
  const ty0 = Math.floor(ent.y / TILE);
  const ty1 = Math.floor((ent.y + ent.h - 0.001) / TILE);
  let hit = false;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!isSolid(tx, ty)) continue;
      hit = true;
      const bx = tx * TILE, by = ty * TILE;
      if (dx > 0) ent.x = bx - ent.w;
      else if (dx < 0) ent.x = bx + TILE;
      if (dy > 0) {
        ent.y = by - ent.h;
        if (opts && opts.onLand && !ent.onGround && ent.vy > 200) opts.onLand(ent);
        ent.vy = 0;
        ent.onGround = true;
      } else if (dy < 0) {
        ent.y = by + TILE;
        ent.vy = 0;
      }
    }
  }
  return hit;
}

function moveAxis(dx, dy) {
  moveEntityAxis(player, dx, dy, {
    onLand: () => {
      SFX.land();
      spawnLandPuff(player.x + player.w / 2, player.y + player.h);
    },
  });
}

function entitiesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
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

  // Timers.
  if (player.iframe   > 0) player.iframe   -= dt;
  if (player.attackCD > 0) player.attackCD -= dt;
  if (swingTimer      > 0) swingTimer      -= dt;

  // Death / respawn.
  if (player.hp <= 0) {
    flash("You died — respawning", 1500);
    player.hp = player.hpMax;
    player.x = player.spawnX;
    player.y = player.spawnY;
    player.vx = player.vy = 0;
    player.iframe = 1.5;
    enemies.length = 0;
  }
}

function damagePlayer(amount, knockX) {
  if (player.iframe > 0) return;
  player.hp -= amount;
  player.iframe = 0.9;
  player.vy = -260;
  player.vx = knockX;
  SFX.hurt();
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
  // If a weapon is equipped, left-click uses the weapon instead of mining.
  if (activeWeapon) { useActiveWeapon(camX, camY); mineTarget = null; mineProgress = 0; return; }

  // Priority 1: an enemy under the cursor & within reach → attack instead of mine.
  const wx = mouseX + camX, wy = mouseY + camY;
  const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
  if (Math.hypot(wx - pcx, wy - pcy) <= player.reach * TILE) {
    for (const e of enemies) {
      if (wx >= e.x && wx <= e.x + e.w && wy >= e.y && wy <= e.y + e.h) {
        if (player.attackCD <= 0) {
          e.hp -= 15;
          e.vx += Math.sign(e.x + e.w / 2 - pcx) * 220;
          e.vy = -180;
          e.flash = 0.15;
          player.attackCD = 0.25;
          SFX.hit();
          spawnBreakParticles(Math.floor((e.x + e.w / 2) / TILE),
                              Math.floor((e.y + e.h / 2) / TILE),
                              "#9be37a");
        }
        mineTarget = null; mineProgress = 0;
        return;
      }
    }
  }

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
    // Stone has a chance to drop a coin entity.
    if (id === 3 && Math.random() < 0.15) {
      spawnItem(t.tx * TILE + TILE / 2, t.ty * TILE + TILE / 2, "coin");
    }
    mineTarget = null; mineProgress = 0;
  }
}

// ----- Items (collectible entities) ----------------------------------
const items = [];
const ITEM_SIZE = 12;

function spawnItem(wx, wy, type) {
  items.push({
    x: wx - ITEM_SIZE / 2,
    y: wy - ITEM_SIZE / 2,
    w: ITEM_SIZE, h: ITEM_SIZE,
    vx: (Math.random() - 0.5) * 160,
    vy: -180,
    type,
    age: 0,
    life: 20,
  });
}

function updateItems(dt) {
  const pcx = player.x + player.w / 2;
  const pcy = player.y + player.h / 2;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.age += dt;
    if (it.age > it.life) { items.splice(i, 1); continue; }

    // Magnet toward player when close (and not too fresh, so drops settle first).
    const dx = pcx - (it.x + it.w / 2);
    const dy = pcy - (it.y + it.h / 2);
    const d  = Math.hypot(dx, dy);
    if (it.age > 0.4 && d < TILE * 3) {
      const k = 800 / Math.max(d, 8);
      it.vx += dx / d * k * dt;
      it.vy += dy / d * k * dt;
    } else {
      it.vy += GRAVITY * dt;
      if (it.vy > 600) it.vy = 600;
      it.vx *= Math.pow(0.5, dt); // air drag
    }

    moveEntityAxis(it, it.vx * dt, 0);
    moveEntityAxis(it, 0, it.vy * dt);

    if (entitiesOverlap(it, player)) {
      collectItem(it.type);
      items.splice(i, 1);
    }
  }
}

function drawItems(camX, camY) {
  for (const it of items) {
    const def = ITEM_DEF[it.type];
    const x = it.x - camX, y = it.y - camY;
    // Bob slightly with age for "shiny" feel.
    const bob = Math.sin(it.age * 6) * 1.5;
    ctx.fillStyle = def.color;
    ctx.fillRect(x, y + bob, it.w, it.h);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(x + 2, y + 2 + bob, 3, 3);
  }
}

// ----- Enemies (slimes) ----------------------------------------------
const enemies = [];
const MAX_ENEMIES = 4;
let enemySpawnTimer = 3;

function spawnEnemy() {
  // Pick a column near the player but offscreen, find its surface, drop a slime there.
  const pcx = (player.x + player.w / 2) / TILE;
  for (let tries = 0; tries < 20; tries++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const tx = Math.floor(pcx + side * (18 + Math.random() * 8));
    if (tx < 2 || tx >= W_TILE - 2) continue;
    let ty = 0;
    while (ty < H_TILE && !isSolid(tx, ty)) ty++;
    if (ty >= H_TILE) continue;
    enemies.push({
      x: tx * TILE + 2, y: ty * TILE - TILE * 1.1,
      w: TILE * 0.95, h: TILE * 1.05,
      vx: 0, vy: 0,
      onGround: false,
      hp: 30, hpMax: 30,
      jumpCD: 0,
      flash: 0,
      contactCD: 0,
    });
    return;
  }
}

function updateEnemies(dt) {
  enemySpawnTimer -= dt;
  if (enemySpawnTimer <= 0 && enemies.length < MAX_ENEMIES) {
    spawnEnemy();
    enemySpawnTimer = 4 + Math.random() * 3;
  }

  const pcx = player.x + player.w / 2;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.flash > 0)    e.flash    -= dt;
    if (e.jumpCD > 0)   e.jumpCD   -= dt;
    if (e.contactCD > 0) e.contactCD -= dt;

    // Simple AI: walk toward the player; jump when blocked by a wall or near a small gap.
    const dir = Math.sign(pcx - (e.x + e.w / 2));
    e.vx = dir * 70;
    e.vy += GRAVITY * dt;
    if (e.vy > 1200) e.vy = 1200;

    const wasGround = e.onGround;
    e.onGround = false;
    const blockedX = moveEntityAxis(e, e.vx * dt, 0);
    moveEntityAxis(e, 0, e.vy * dt);

    if (blockedX && wasGround && e.jumpCD <= 0) {
      e.vy = -380;
      e.jumpCD = 0.6;
    }

    // Contact damage.
    if (entitiesOverlap(e, player) && e.contactCD <= 0) {
      damagePlayer(10, -dir * 280);
      e.contactCD = 0.6;
    }

    // Death.
    if (e.hp <= 0) {
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      spawnBreakParticles(Math.floor(cx / TILE), Math.floor(cy / TILE), "#5cb04a");
      if (Math.random() < 0.6) spawnItem(cx, cy, "heart");
      else                     spawnItem(cx, cy, "coin");
      SFX.break();
      enemies.splice(i, 1);
    }
  }
}

// ----- Weapons in action ---------------------------------------------
const projectiles = []; // { x,y,vx,vy,type,life,age,dmg,owner }

function useActiveWeapon(camX, camY) {
  if (player.attackCD > 0) return;
  const def = WEAPON_DEF[activeWeapon];
  const wx = mouseX + camX, wy = mouseY + camY;
  const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
  const dx = wx - pcx, dy = wy - pcy;
  const dlen = Math.max(1, Math.hypot(dx, dy));
  const dirX = dx / dlen, dirY = dy / dlen;

  if (activeWeapon === "sword") {
    swingTimer = 0.18;
    swingDir   = dirX >= 0 ? 1 : -1;
    player.attackCD = def.cooldown;
    // Apply damage immediately to enemies inside the swing arc.
    for (const e of enemies) {
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      const edx = ecx - pcx,     edy = ecy - pcy;
      const ed  = Math.hypot(edx, edy);
      if (ed > def.range) continue;
      // Same side as swing direction & not too far above/below.
      if (Math.sign(edx) !== swingDir && ed > TILE * 0.4) continue;
      e.hp -= def.dmg;
      e.vx += swingDir * 260;
      e.vy = -200;
      e.flash = 0.15;
    }
    SFX.hit();
    return;
  }

  if (activeWeapon === "bow") {
    if (ammo.arrow <= 0) { flash("Out of arrows!", 700); player.attackCD = 0.3; return; }
    ammo.arrow -= 1;
    const speed = 520;
    projectiles.push({
      x: pcx, y: pcy,
      vx: dirX * speed, vy: dirY * speed,
      type: "arrow", age: 0, life: 3.0,
      dmg: def.dmg,
      owner: "player",
    });
    player.attackCD = def.cooldown;
    SFX.place(); // bowstring twang
    return;
  }

  if (activeWeapon === "boomerang") {
    if (boomerangOut) return; // only one at a time
    const speed = 360;
    projectiles.push({
      x: pcx, y: pcy,
      vx: dirX * speed, vy: dirY * speed,
      type: "boomerang", age: 0, life: 4.0,
      dmg: def.dmg,
      owner: "player",
      returning: false,
      hits: new Set(),    // enemy ids already damaged this throw
    });
    boomerangOut = true;
    player.attackCD = def.cooldown;
    SFX.jump();
    return;
  }
}

function updateProjectiles(dt) {
  const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.age += dt;
    let dead = p.age > p.life;

    if (p.type === "arrow") {
      p.vy += GRAVITY * 0.45 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Tile collision: simple point-vs-tile.
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      if (isSolid(tx, ty)) dead = true;
      // Enemy hit.
      for (const e of enemies) {
        if (p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h) {
          e.hp -= p.dmg;
          e.vx += Math.sign(p.vx) * 200;
          e.flash = 0.15;
          SFX.hit();
          dead = true;
          break;
        }
      }
      if (p.x < 0 || p.x > W_TILE * TILE || p.y > H_TILE * TILE) dead = true;
    } else if (p.type === "boomerang") {
      // Returning behaviour: switch to homing after 0.6s.
      if (p.age > 0.6) p.returning = true;
      if (p.returning) {
        const dx = pcx - p.x, dy = pcy - p.y;
        const d  = Math.max(1, Math.hypot(dx, dy));
        const accel = 1400;
        p.vx += (dx / d) * accel * dt;
        p.vy += (dy / d) * accel * dt;
        const sp = Math.hypot(p.vx, p.vy);
        const cap = 520;
        if (sp > cap) { p.vx *= cap / sp; p.vy *= cap / sp; }
        if (d < 18) { dead = true; boomerangOut = false; }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Damage enemies on contact (each enemy once per throw).
      for (let ei = 0; ei < enemies.length; ei++) {
        const e = enemies[ei];
        if (p.hits.has(ei)) continue;
        if (p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h) {
          e.hp -= p.dmg;
          e.flash = 0.15;
          p.hits.add(ei);
          SFX.hit();
        }
      }
    }

    if (dead) {
      if (p.type === "boomerang") boomerangOut = false;
      projectiles.splice(i, 1);
    }
  }
}

function drawProjectiles(camX, camY) {
  for (const p of projectiles) {
    const x = p.x - camX, y = p.y - camY;
    if (p.type === "arrow") {
      // Draw an oriented stick.
      const ang = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = "#dcd0a0";
      ctx.fillRect(-10, -1, 16, 2);
      ctx.fillStyle = "#c0c0c0";
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(4, -3); ctx.lineTo(4, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (p.type === "boomerang") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.age * 25);
      ctx.fillStyle = "#c8a060";
      ctx.fillRect(-7, -2, 14, 4);
      ctx.fillRect(-2, -7, 4, 14);
      ctx.restore();
    }
  }
}

function drawSwordSwing(camX, camY) {
  if (swingTimer <= 0) return;
  const t = swingTimer / 0.18; // 1 → 0
  const pcx = player.x + player.w / 2 - camX;
  const pcy = player.y + player.h / 2 - camY;
  ctx.save();
  ctx.translate(pcx, pcy);
  ctx.rotate(swingDir > 0 ? -t * Math.PI * 0.7 + 0.2 : t * Math.PI * 0.7 - Math.PI - 0.2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(0, -3, WEAPON_DEF.sword.range, 6);
  ctx.fillStyle = "#aaa";
  ctx.fillRect(0, -5, 4, 10);
  ctx.restore();
}

function drawEnemies(camX, camY) {
  for (const e of enemies) {
    const x = e.x - camX, y = e.y - camY;
    const wob = Math.sin(performance.now() * 0.006 + e.x) * 1.5;
    // Body — squish-ish slime
    ctx.fillStyle = e.flash > 0 ? "#ffffff" : "#5cb04a";
    ctx.fillRect(x, y + wob, e.w, e.h);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(x, y + e.h - 4 + wob, e.w, 4);
    // Eyes
    ctx.fillStyle = "#222";
    ctx.fillRect(x + 5, y + 8 + wob, 3, 3);
    ctx.fillRect(x + e.w - 8, y + 8 + wob, 3, 3);
    // HP bar (only while damaged)
    if (e.hp < e.hpMax) {
      const w = e.w;
      ctx.fillStyle = "#222";
      ctx.fillRect(x, y - 6, w, 3);
      ctx.fillStyle = "#ff6b6b";
      ctx.fillRect(x, y - 6, w * (e.hp / e.hpMax), 3);
    }
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
      // Workbench: paint a darker top stripe + legs to look like a table.
      if (id === 6) {
        ctx.fillStyle = "#7a4a22";
        ctx.fillRect(x, y, TILE, 5);
        ctx.fillRect(x + 3, y + TILE - 6, 3, 6);
        ctx.fillRect(x + TILE - 6, y + TILE - 6, 3, 6);
      }
    }
  }
}

function drawPlayer(camX, camY) {
  const x = player.x - camX, y = player.y - camY;
  // Blink while invulnerable.
  if (player.iframe > 0 && Math.floor(player.iframe * 20) % 2 === 0) return;
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

function drawCraftingOverlay() {
  if (!craftingOpen) return;
  const pw = 460, ph = 60 + RECIPES.length * 42 + 32;
  const px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
  ctx.fillStyle = "rgba(20,20,40,0.94)";
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = "#ffd86b";
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd86b";
  ctx.font = "bold 18px -apple-system, sans-serif";
  ctx.fillText("Crafting", px + pw / 2, py + 26);
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillStyle = nearWorkbench() ? "#8efa8e" : "#aaa";
  ctx.fillText(nearWorkbench() ? "● Near a Workbench" : "○ Not near a Workbench (hand-only recipes)",
               px + pw / 2, py + 44);

  ctx.textAlign = "left";
  RECIPES.forEach((r, i) => {
    const ry = py + 60 + i * 42;
    const ok = canCraft(r);
    ctx.fillStyle = ok ? "#2c4030" : "#2b2b46";
    ctx.fillRect(px + 12, ry, pw - 24, 36);
    ctx.strokeStyle = ok ? "#8efa8e" : "#555";
    ctx.strokeRect(px + 12, ry, pw - 24, 36);

    ctx.fillStyle = "#eee";
    ctx.font = "bold 13px -apple-system, sans-serif";
    ctx.fillText(r.label, px + 22, ry + 16);

    ctx.font = "11px -apple-system, sans-serif";
    ctx.fillStyle = "#bbb";
    const reqs = Object.entries(r.needs)
      .map(([k, v]) => `${matLabel(k)} x${v} (${getMaterial(k)})`)
      .join("  ·  ");
    ctx.fillText(reqs + "   [" + r.station + "]", px + 22, ry + 30);

    ctx.fillStyle = ok ? "#8efa8e" : "#777";
    ctx.font = "bold 12px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(ok ? "[ click to craft ]" : "[ unavailable ]", px + pw - 24, ry + 22);
    ctx.textAlign = "left";
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "#aaa";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillText("Press C to close", px + pw / 2, py + ph - 12);
  ctx.textAlign = "start";
}

function matLabel(k) {
  if (k.startsWith("b")) return BLOCKS[parseInt(k.slice(1), 10)].name;
  return k[0].toUpperCase() + k.slice(1);
}

function craftingHitTest(mx, my) {
  if (!craftingOpen) return false;
  const pw = 460, ph = 60 + RECIPES.length * 42 + 32;
  const px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
  for (let i = 0; i < RECIPES.length; i++) {
    const ry = py + 60 + i * 42;
    if (mx >= px + 12 && mx <= px + pw - 12 && my >= ry && my <= ry + 36) {
      doCraft(RECIPES[i]);
      return true;
    }
  }
  return false;
}

// Build the slot layout dynamically so weapons/ammo share the grid with items.
function inventorySlots() {
  return [
    { key: "heart",     kind: "item",   label: "Heart",     color: "#ff5577", count: inventory.heart },
    { key: "coin",      kind: "item",   label: "Coin",      color: "#ffd86b", count: inventory.coin },
    { key: "sword",     kind: "weapon", label: "Sword",     color: "#d8d8e0", count: weapons.sword },
    { key: "bow",       kind: "weapon", label: "Bow",       color: "#a06a3a", count: weapons.bow },
    { key: "boomerang", kind: "weapon", label: "Boomerang", color: "#c8a060", count: weapons.boomerang },
    { key: "arrow",     kind: "ammo",   label: "Arrow",     color: "#dcd0a0", count: ammo.arrow },
  ];
}

function drawInventoryOverlay() {
  if (!inventoryOpen) return;
  const slots = inventorySlots();
  const slotSize = 56, gap = 12, cols = 6;
  const pw = cols * slotSize + (cols + 1) * gap + 16;
  const ph = 230;
  const px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
  ctx.fillStyle = "rgba(20,20,40,0.94)";
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = "#ffd86b";
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);

  ctx.fillStyle = "#ffd86b";
  ctx.font = "bold 18px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Inventory", px + pw / 2, py + 26);
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillStyle = "#aaa";
  ctx.fillText("H = use Heart  /  Click weapon to equip  /  Q = cycle weapon  /  C = crafting",
               px + pw / 2, py + ph - 36);
  ctx.fillStyle = "#ffd86b";
  ctx.fillText("Active weapon: " + (activeWeapon ? WEAPON_DEF[activeWeapon].label : "—"),
               px + pw / 2, py + ph - 16);

  const sx0 = px + gap + 8, sy = py + 60;
  slots.forEach((s, i) => {
    const sx = sx0 + i * (slotSize + gap);
    const equipped = (s.kind === "weapon" && activeWeapon === s.key);
    ctx.fillStyle = equipped ? "#3a3a5a" : "#2b2b46";
    ctx.fillRect(sx, sy, slotSize, slotSize);
    ctx.strokeStyle = equipped ? "#ffd86b" : "#555";
    ctx.strokeRect(sx, sy, slotSize, slotSize);
    if (s.count > 0 || s.kind === "item") {
      ctx.fillStyle = s.color;
      ctx.fillRect(sx + 16, sy + 16, 24, 24);
    }
    ctx.fillStyle = "#eee";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.fillText(s.label, sx + slotSize / 2, sy + slotSize + 12);
    ctx.fillStyle = s.count > 0 ? "#ffd86b" : "#666";
    ctx.font = "bold 12px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("x" + s.count, sx + slotSize - 4, sy + slotSize - 4);
    ctx.textAlign = "center";
  });
  ctx.textAlign = "start";
}

function inventoryHitTest(mx, my) {
  if (!inventoryOpen) return false;
  const slots = inventorySlots();
  const slotSize = 56, gap = 12, cols = 6;
  const pw = cols * slotSize + (cols + 1) * gap + 16;
  const ph = 230;
  const px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
  const sx0 = px + gap + 8, sy = py + 60;
  for (let i = 0; i < slots.length; i++) {
    const sx = sx0 + i * (slotSize + gap);
    if (mx >= sx && mx <= sx + slotSize && my >= sy && my <= sy + slotSize) {
      const s = slots[i];
      if (s.kind === "weapon" && s.count > 0) {
        activeWeapon = (activeWeapon === s.key) ? null : s.key;
        flash(activeWeapon ? "Equip: " + WEAPON_DEF[activeWeapon].label : "Unequipped", 700);
      } else if (s.key === "heart") {
        useHeart();
      }
      return true;
    }
  }
  return false;
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
  coinText.textContent  = inventory.coin;
  heartText.textContent = inventory.heart;
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

  updateItems(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateParticles(dt);

  // Sky gradient: lighter at top, fading toward horizon.
  const grd = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grd.addColorStop(0, "#6cbcf7");
  grd.addColorStop(1, "#c8e8ff");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawWorld(camX, camY);
  drawItems(camX, camY);
  drawProjectiles(camX, camY);
  drawEnemies(camX, camY);
  drawParticles(camX, camY);
  drawPlayer(camX, camY);
  drawSwordSwing(camX, camY);
  drawTargetReticle(camX, camY);
  drawInventoryOverlay();
  drawCraftingOverlay();

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
  const set  = (x, y, id) => { world[y * W + x] = id; };
  const get  = (x, y)     => world[y * W + x];

  // 1) Multi-octave sine height map → rolling hills, occasional cliffs.
  const base = Math.floor(H * 0.42);
  const heights = new Array(W);
  for (let x = 0; x < W; x++) {
    const h = Math.sin(x * 0.07) * 4
            + Math.sin(x * 0.21) * 2
            + Math.sin(x * 0.55) * 1;
    heights[x] = Math.max(4, Math.min(H - 8, Math.floor(base + h)));
  }

  // 2) Fill grass / dirt / stone in vertical bands.
  for (let x = 0; x < W; x++) {
    const sy = heights[x];
    set(x, sy, 1);                                   // grass top
    for (let y = sy + 1; y < sy + 5 && y < H; y++) set(x, y, 2); // dirt layer
    for (let y = sy + 5; y < H; y++)                set(x, y, 3); // stone below
  }

  // 3) Caves: cheap noise (two sine fields combined) carves stone away.
  for (let x = 2; x < W - 2; x++) {
    for (let y = heights[x] + 6; y < H - 2; y++) {
      const n = Math.sin(x * 0.13 + y * 0.27)
              + Math.sin(x * 0.31 - y * 0.17) * 0.8
              + Math.sin((x + y) * 0.07)      * 0.5;
      if (n > 1.15) set(x, y, 0);
    }
  }

  // 4) Trees: place a wooden trunk + leaf canopy on a fraction of grass tiles.
  for (let x = 3; x < W - 3; x++) {
    if (get(x, heights[x]) !== 1) continue;          // top must still be grass
    if (Math.random() > 0.07) continue;
    const trunk = 3 + ((Math.random() * 3) | 0);
    const topY  = heights[x] - trunk;
    for (let i = 1; i <= trunk; i++) set(x, heights[x] - i, 4);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 0; dy++) {
        if (Math.abs(dx) === 2 && dy === 0) continue; // rounded corners
        const lx = x + dx, ly = topY + dy;
        if (lx >= 0 && lx < W && ly >= 0 && get(lx, ly) === 0) set(lx, ly, 5);
      }
    }
  }
}

// ----- Boot -----------------------------------------------------------
resetWorld();
renderHotbar();
requestAnimationFrame(frame);
