/* =========================================================================
   FORGE & CROWN ― コア
   小物 / セーブ / 状態 / 鎧の性能計算 / 内政の計算 / UI・音のヘルパー
   ========================================================================= */

/* ===================== 小物 ===================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => clamp(Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* ===================== 定数 ===================== */
const CN = 7;                 // 城の敷地は 7×7
const KEEP_IDX = 3 * CN + 3;  // 中央が本丸
const SAVE_KEY = 'fc-save-v1';
const ORE_RATE = { 1: 1.0, 2: 0.8, 3: 0.5, 4: 0.32 };

/* ===================== セーブデータ ===================== */
const G = {
  ver: 1,
  lord: 'アルド',
  turn: 1, year: 1, month: 3,
  ap: 3,
  valor: 0, rank: 1,
  res: { gold: 220, food: 150, wood: 70, stone: 50 },
  ores: { iron: 12, steel: 2, mithril: 0, orichal: 0, adamant: 0, dragon: 0, moon: 0, void: 0 },
  troops: 6, drill: 20, loyalty: 60,
  castle: { seed: 12345, terr: [], build: [] },
  armors: [], equipped: null, nextArmorId: 1,
  decorStock: {},
  regions: {},
  stats: { battles: 0, wins: 0, losses: 0, kills: 0, captains: 0, forged: 0, turns: 0 },
  logs: [],
  muted: false,
  won: false,
};

const Save = {
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) { /* 保存できなくても続行 */ } },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !d.castle || !d.regions) return false;
      Object.assign(G, d);
      // データ定義の更新に備えて整合を取る
      ORE_IDS.forEach((o) => { if (typeof G.ores[o] !== 'number') G.ores[o] = 0; });
      REGIONS.forEach((r) => { if (!G.regions[r.id]) G.regions[r.id] = { owner: r.owner, troops: r.troops }; });
      if (G.castle.build.length !== CN * CN) return false;
      if (G.equipped && !G.armors.some((a) => a.id === G.equipped)) G.equipped = null;
      return true;
    } catch (e) { return false; }
  },
  exists() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
  wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ } },
};

function genCastleTerrain(seed) {
  const rng = mulberry32(seed);
  const t = new Array(CN * CN).fill('plain');
  const blob = (type, count) => {
    let x = Math.floor(rng() * CN), y = Math.floor(rng() * CN);
    for (let i = 0; i < count; i++) {
      t[y * CN + x] = type;
      const d = Math.floor(rng() * 4);
      x = clamp(x + [1, -1, 0, 0][d], 0, CN - 1);
      y = clamp(y + [0, 0, 1, -1][d], 0, CN - 1);
    }
  };
  blob('water', 6); blob('rock', 7); blob('wood', 8); blob('hill', 9);
  t[KEEP_IDX] = 'plain';
  return t;
}

function newGame(lordName) {
  G.ver = 1;
  G.lord = (lordName || 'アルド').slice(0, 10) || 'アルド';
  G.turn = 1; G.year = 1; G.month = 3;
  G.ap = 3;
  G.valor = 0; G.rank = 1;
  G.res = { gold: 220, food: 150, wood: 70, stone: 50 };
  G.ores = { iron: 12, steel: 2, mithril: 0, orichal: 0, adamant: 0, dragon: 0, moon: 0, void: 0 };
  G.troops = 6; G.drill = 20; G.loyalty = 60;
  G.castle.seed = randInt(1, 999999);
  G.castle.terr = genCastleTerrain(G.castle.seed);
  G.castle.build = new Array(CN * CN).fill(null);
  G.castle.build[KEEP_IDX] = 'keep';
  G.armors = []; G.equipped = null; G.nextArmorId = 1;
  G.decorStock = { lion: 1 };
  G.regions = {};
  REGIONS.forEach((r) => { G.regions[r.id] = { owner: r.owner, troops: r.troops }; });
  G.stats = { battles: 0, wins: 0, losses: 0, kills: 0, captains: 0, forged: 0, turns: 0 };
  G.logs = [];
  G.won = false;
  pushLog('🏰', `${G.lord} は辺境アシュフォードの砦を任された。`);
  Save.save();
}

function pushLog(icon, text) {
  G.logs.unshift({ icon, text, turn: G.turn });
  if (G.logs.length > 60) G.logs.pop();
}

/* ===================== 階級 ===================== */
function rankInfo(n) { return RANKS[clamp((n || G.rank) - 1, 0, RANKS.length - 1)]; }
function nextRank() { return G.rank < RANKS.length ? RANKS[G.rank] : null; }
function checkPromotion() {
  const ups = [];
  while (G.rank < RANKS.length && G.valor >= RANKS[G.rank].valor) {
    G.rank++;
    ups.push(RANKS[G.rank - 1]);
    pushLog('🎖️', `戦功が認められ、${RANKS[G.rank - 1].name} に昇進した。`);
  }
  return ups;
}
function weaponOf(rank) {
  let w = WEAPONS[0];
  WEAPONS.forEach((x) => { if (x.rank <= (rank || G.rank)) w = x; });
  return w;
}

/* ===================== 領地 ===================== */
function ownedRegions() { return REGIONS.filter((r) => G.regions[r.id].owner === 'player'); }
function regionOwner(id) { return G.regions[id].owner; }
function isFrontier(id) {
  // 自領に隣接する他勢力の領地か
  if (G.regions[id].owner === 'player') return false;
  return NEIGHBORS[id].some((n) => G.regions[n].owner === 'player');
}
function minableOres() {
  const set = {};
  ownedRegions().forEach((r) => { for (const k in r.veins) set[k] = true; });
  return Object.keys(set);
}
function regionIncome() {
  const out = { gold: 0, food: 0, wood: 0, stone: 0 };
  ownedRegions().forEach((r) => { for (const k in r.yield) out[k] += r.yield[k]; });
  return out;
}

/* ===================== 城（内政）の計算 ===================== */
function plotRadius() { return rankInfo().plot; }
function tileUnlocked(i) {
  const x = i % CN, y = (i / CN) | 0;
  return Math.max(Math.abs(x - 3), Math.abs(y - 3)) <= plotRadius();
}
function buildCount(id) { return G.castle.build.filter((b) => b === id).length; }
function neighborsOf(i) {
  const x = i % CN, y = (i / CN) | 0, out = [];
  if (x > 0) out.push(i - 1);
  if (x < CN - 1) out.push(i + 1);
  if (y > 0) out.push(i - CN);
  if (y < CN - 1) out.push(i + CN);
  return out;
}
function hasAdj(i, id) { return neighborsOf(i).some((j) => G.castle.build[j] === id); }

/** 建物1つあたりの実効産出（地形と隣接を反映） */
function tileYield(i) {
  const id = G.castle.build[i];
  if (!id) return null;
  const B = BUILDINGS[id];
  if (!B || !B.yield) return null;
  const m = terrainMul(id, G.castle.terr[i]);
  const out = {};
  for (const k in B.yield) {
    let v = B.yield[k] * m;
    if (id === 'farm' && k === 'food' && hasAdj(i, 'mill')) v *= 1.5;
    if (id === 'mine' && k === 'ore' && hasAdj(i, 'forge')) v *= 1.25;
    out[k] = v;
  }
  return out;
}
function castleYield() {
  const out = { gold: 0, food: 0, wood: 0, stone: 0, loyalty: 0, ore: 0 };
  for (let i = 0; i < CN * CN; i++) {
    const y = tileYield(i);
    if (!y) continue;
    for (const k in y) out[k] = (out[k] || 0) + y[k];
  }
  return out;
}
/** 城の防衛力（防衛戦での自軍補正） */
function castleDefense() {
  let d = 0;
  for (let i = 0; i < CN * CN; i++) {
    const id = G.castle.build[i];
    if (id === 'wall') d += 6 + neighborsOf(i).filter((j) => G.castle.build[j] === 'wall').length * 2
                          + (hasAdj(i, 'tower') ? 4 : 0);
    if (id === 'tower') d += 14;
  }
  return Math.round(d);
}
function troopCap() { return 12 + buildCount('barracks') * 12 + rankInfo().troops * 2; }
function forgeQuality() { return 1 + buildCount('forge') * 0.06; }
function foodUpkeep() {
  const s = seasonOf(G.month);
  return Math.round(G.troops * (s.id === 'winter' ? 3.2 : 2.2));
}
/** 鉱石の毎ターン産出（鉱脈の構成で配分される） */
function oreIncome(points) {
  const veins = {};
  ownedRegions().forEach((r) => { for (const k in r.veins) veins[k] = (veins[k] || 0) + r.veins[k]; });
  const total = Object.values(veins).reduce((a, b) => a + b, 0);
  const out = {};
  if (!total || points <= 0) return out;
  for (const k in veins) out[k] = points * (veins[k] / total) * (ORE_RATE[ORES[k].tier] || 0.4);
  return out;
}

/* ===================== 鎧の性能計算 ===================== */
/** grid: 長さ16の配列（各要素は鉱石ID または null） */
function computeArmor(grid, quality) {
  const q = quality || 1;
  let def = 0, res = 0, hp = 0, wt = 0;
  const counts = {};
  for (let i = 0; i < 16; i++) {
    const o = grid[i];
    if (!o || !ORES[o]) continue;
    const ore = ORES[o], row = ARMOR_ROWS[(i / 4) | 0];
    def += ore.def * row.defMul;
    res += ore.res * row.resMul;
    hp += ore.hp * row.hpMul;
    wt += ore.wt * row.wtMul;
    counts[o] = (counts[o] || 0) + 1;
  }
  const filled = grid.filter((c) => !!c).length;
  const bonuses = [];
  let purity = null, main = null, mainN = 0;
  for (const k in counts) if (counts[k] > mainN) { mainN = counts[k]; main = k; }

  if (filled === 16) {
    def *= 1.12; res *= 1.12; hp *= 1.12;
    bonuses.push({ name: '完品', desc: '隙間なく組み上がった。防御・魔防・耐久 +12%', good: true });
  } else if (filled > 0) {
    const holes = 16 - filled;
    def *= Math.max(0.3, 1 - holes * 0.045);
    hp *= Math.max(0.4, 1 - holes * 0.030);
    bonuses.push({ name: `隙間 ${holes}マス`, desc: `守りに穴がある。防御 -${Math.round(holes * 4.5)}%・耐久 -${Math.round(holes * 3)}%`, bad: true });
  }
  if (main && mainN >= 8) {
    purity = { ore: main, ...ORES[main].purity };
    bonuses.push({ name: `純度：${ORES[main].purity.name}`, desc: ORES[main].purity.desc, good: true, purity: true });
  }
  let sym = filled > 0;
  for (let y = 0; y < 4 && sym; y++) {
    for (let x = 0; x < 2; x++) if (grid[y * 4 + x] !== grid[y * 4 + (3 - x)]) { sym = false; break; }
  }
  if (sym) {
    def *= 1.06; wt *= 0.95;
    bonuses.push({ name: '均整', desc: '左右対称に組まれている。防御 +6%・重量 -5%', good: true });
  }
  const kinds = Object.keys(counts).length;
  if (kinds >= 4) {
    res *= 1.10;
    bonuses.push({ name: '混合鍛造', desc: '4種以上の鉱石を編んだ。魔法防御 +10%', good: true });
  }
  def *= q; res *= q; hp *= q;
  if (q > 1.001) bonuses.push({ name: `鍛冶場 ×${buildCount('forge')}`, desc: `仕上がり +${Math.round((q - 1) * 100)}%`, good: true });

  const spd = clamp(1.25 - wt * 0.005, 0.60, 1.15);
  return {
    def: Math.round(def), res: Math.round(res), hp: Math.round(hp),
    wt: Math.round(wt * 10) / 10, spd: Math.round(spd * 100) / 100,
    filled, counts, main, mainN, purity, bonuses,
    ult: main ? ORES[main].ult : 'whirl',
  };
}

function armorKindName(wt) {
  if (wt < 26) return '軽鎧';
  if (wt < 45) return '胸甲';
  if (wt < 70) return '重鎧';
  return '巨鎧';
}
function autoArmorName(st) {
  if (!st.main) return '未完成の鎧';
  const base = `${ORES[st.main].name}の${armorKindName(st.wt)}`;
  if (st.purity) return `${st.purity.name}の${armorKindName(st.wt)}`;
  return base;
}

/** 装備中の鎧（なければ素の状態） */
function equippedArmor() {
  if (!G.equipped) return null;
  return G.armors.find((a) => a.id === G.equipped) || null;
}
/** 装飾の効果を合算 */
function decorEffects(armor) {
  const eff = {};
  if (!armor) return eff;
  const slots = rankInfo().decor;
  (armor.decors || []).slice(0, slots).forEach((d) => {
    const D = DECORS[d];
    if (!D) return;
    for (const k in D.eff) eff[k] = (eff[k] || 0) + D.eff[k];
  });
  return eff;
}

/** 戦闘に持ち込むプレイヤーの実力値 */
function playerLoadout() {
  const armor = equippedArmor();
  const st = armor ? armor.stats : { def: 0, res: 0, hp: 0, wt: 0, spd: 1, purity: null, ult: 'whirl', main: null };
  const eff = decorEffects(armor);
  const w = weaponOf();
  const purity = st.purity ? st.purity.ore : null;

  let spd = st.spd * (1 + (eff.spd || 0));
  if (purity === 'mithril') spd *= 1.15;
  if (G.rank >= 5) spd *= 1.08;

  let def = st.def * (1 + (eff.def || 0));
  if (purity === 'steel') def *= 1.12;
  let res = st.res * (1 + (eff.res || 0));
  if (purity === 'orichal') res *= 1.25;

  let atk = w.atk * (1 + (eff.atk || 0)) * (1 + G.drill * 0.0015);
  if (purity === 'void') atk *= 1.18;

  return {
    name: G.lord,
    maxHp: Math.round(120 + st.hp + G.rank * 8),
    def, res, atk,
    spdMul: spd,
    reach: w.reach, swing: w.swing * (1 - (eff.haste || 0)),
    crit: 0.05 + (eff.crit || 0),
    drain: eff.drain || 0,
    thorn: eff.thorn ? 1 : 0,
    regen: eff.regen ? 1 : 0,
    rageMul: 1 + (eff.rage || 0) + (purity === 'moon' ? 0.5 : 0),
    allyMul: 1 + (eff.ally || 0),
    charge: eff.charge ? 1 : 0,
    dodgeMul: purity === 'mithril' ? 1.25 : 1,
    stagger: purity === 'iron' ? 0.4 : 1,
    guardBreakImmune: purity === 'adamant',
    fireBack: purity === 'dragon',
    voidHurt: purity === 'void' ? 1.10 : 1,
    ult: st.ult || 'whirl',
    armorColor: st.main ? ORES[st.main].color : '#7c8390',
    armorEdge: st.main ? ORES[st.main].edge : '#555b66',
    armorName: armor ? armor.name : '布の胴着',
    weaponName: w.name,
  };
}

/* ===================== 資源のやりとり ===================== */
function canPay(cost) {
  for (const k in cost) {
    if (k === 'ap') { if (G.ap < cost[k]) return false; continue; }
    if (ORES[k]) { if (Math.floor(G.ores[k]) < cost[k]) return false; continue; }
    if ((G.res[k] || 0) < cost[k]) return false;
  }
  return true;
}
function pay(cost) {
  for (const k in cost) {
    if (k === 'ap') { G.ap -= cost[k]; continue; }
    if (ORES[k]) { G.ores[k] -= cost[k]; continue; }
    G.res[k] -= cost[k];
  }
}
function costText(cost) {
  const ICON = { gold: '🪙', food: '🌾', wood: '🪵', stone: '🪨', ap: '⏳' };
  return Object.keys(cost).map((k) => {
    const ic = ICON[k] || (ORES[k] ? '⛏️' : '');
    const nm = ORES[k] ? ORES[k].name : '';
    return `${ic}${nm}${cost[k]}`;
  }).join(' ');
}

/* ===================== UI ヘルパー ===================== */
function openPanel(id) { const p = $(id); if (p) { p.classList.remove('hidden'); p.scrollTop = 0; } }
function closePanel(id) { const p = $(id); if (p) p.classList.add('hidden'); }
function closeAllPanels() { $$('.panel').forEach((p) => p.classList.add('hidden')); }

let toastTimer = null;
function toast(msg, kind) {
  const area = $('toast-area');
  if (!area) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.innerHTML = msg;
  area.appendChild(el);
  setTimeout(() => { el.classList.add('out'); }, 1900);
  setTimeout(() => { el.remove(); }, 2400);
}

let confirmCb = null;
function confirmDlg(text, cb, okLabel) {
  $('confirm-text').innerHTML = text;
  $('confirm-yes').textContent = okLabel || '実行する';
  $('confirm-yes').classList.remove('hidden');
  $('confirm-no').textContent = 'やめる';
  confirmCb = cb;
  openPanel('panel-confirm');
}

/* ===================== 音 ===================== */
const Sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type, vol, slide) {
    if (G.muted) return;
    const c = this.ensure();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), c.currentTime + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(vol || 0.08, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  },
  noise(dur, vol, hp) {
    if (G.muted) return;
    const c = this.ensure();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 600;
    const g = c.createGain(); g.gain.value = vol || 0.09;
    s.connect(f); f.connect(g); g.connect(c.destination);
    s.start();
  },
  click() { this.tone(520, 0.05, 'triangle', 0.05); },
  place() { this.tone(360, 0.07, 'square', 0.06, 520); },
  deny() { this.tone(150, 0.13, 'sawtooth', 0.06, 90); },
  build() { this.tone(300, 0.09, 'square', 0.07, 480); setTimeout(() => this.tone(460, 0.10, 'triangle', 0.06), 80); },
  forge() { this.noise(0.14, 0.08, 900); setTimeout(() => this.tone(700, 0.18, 'triangle', 0.07, 1200), 60); },
  slash() { this.noise(0.07, 0.07, 1400); },
  hit() { this.noise(0.09, 0.11, 350); this.tone(140, 0.07, 'square', 0.05, 70); },
  guard() { this.tone(900, 0.06, 'square', 0.05, 1400); },
  ult() { this.tone(200, 0.35, 'sawtooth', 0.10, 900); this.noise(0.3, 0.08, 300); },
  levelup() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'triangle', 0.08), i * 90)); },
  win() { [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'triangle', 0.08), i * 120)); },
  lose() { [400, 330, 260, 180].forEach((f, i) => setTimeout(() => this.tone(f, 0.28, 'sawtooth', 0.07), i * 150)); },
  turn() { this.tone(440, 0.10, 'triangle', 0.06, 660); },
};

/* ===================== 数の表示 ===================== */
const fmt = (v) => Math.floor(v).toLocaleString('ja-JP');
const fmt1 = (v) => (Math.round(v * 10) / 10).toString();
