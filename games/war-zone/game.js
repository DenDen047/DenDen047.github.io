/* WARZONE 2D ― 戦場
 * 見下ろし型(トップダウン)の2D戦争シューター + ライトRPG。
 * ソロ戦(CPU)と、PeerJS による P2P オンライン対戦(ホスト権威)に対応。
 * ゲーム状態はフレーム毎に破壊的更新する(ゲームループの定石)。CLAUDE.md の不変則は
 * UI/データ層の話で、ここではパフォーマンス優先のミュータブル更新を採用する。
 */
(function () {
  "use strict";

  // ============================================================
  //  定数
  // ============================================================
  const WORLD_W = 2600, WORLD_H = 1800;
  const TEAM_SIZE = 4;            // 1チームあたりの人数 (4v4)
  const BASE_MAX_HP = 2400;
  const BASE_CORE_R = 72;
  const WIN_REWARD = 300;
  const RESPAWN_MS = 3200;
  const SOLDIER_R = 14;
  const DOG_R = 11;
  const DOG_RESPAWN_MS = 7000;
  const TANK_R = 34;
  const TANK_RESPAWN_MS = 9000;
  const GRENADE_FUSE_MS = 1500;
  const GRENADE_RADIUS = 145;
  const AUTO_HEAL_DELAY_MS = 5000;
  const AUTO_HEAL_PER_SEC = 5;
  const MEDKIT_HEAL = 45;
  const BASE_HEAL_PER_SEC = 12;
  const BASE_REPAIR_PER_SEC = 7;
  const PLAYER_VISION_R = 350;
  const TANK_VISION_R = 465;
  const MAX_BULLETS = 600;
  const MAX_PARTICLES = 800;
  const SNAP_HZ = 20;             // ホストの状態送信レート
  const INPUT_HZ = 30;            // クライアントの入力送信レート

  const TEAM_ALLY = 0, TEAM_ENEMY = 1;
  const COL = {
    allyUniform: "#2f5fa6", allyAccent: "#7fb0ff",
    enemyUniform: "#9e3528", enemyAccent: "#ff8a6a",
    youUniform: "#7a6420", youAccent: "#ffd23f",
  };

  const BOT_NAMES = [
    "Cobra", "Viper", "Ghost", "Hawk", "Raptor", "Bishop", "Reaper", "Onyx",
    "Falcon", "Wolf", "Striker", "Ranger", "Nomad", "Echo", "Zero", "Blaze",
    "Saber", "Frost", "Joker", "Maverick", "Titan", "Specter", "Diesel", "Kilo",
  ];
  const ENEMY_ARMY_NAMES = ["レッド・コブラ軍", "アイアン・ウルフ軍", "クリムゾン軍団", "ブラック・ホーク軍"];

  const SHOP_ITEMS = [
    { key: "health", icon: "❤", name: "強化体力", desc: "最大HP +10", max: 5, baseCost: 120, step: 80 },
    { key: "armor", icon: "🦺", name: "強化装甲", desc: "鎧耐久 +15", max: 5, baseCost: 120, step: 85 },
    { key: "shield", icon: "🛡", name: "強化シールド", desc: "盾耐久 +20", max: 5, baseCost: 130, step: 90 },
    { key: "damage", icon: "🎯", name: "武器改修", desc: "武器ダメージ +5%", max: 5, baseCost: 180, step: 110 },
    { key: "grenade", icon: "💣", name: "弾薬ポーチ", desc: "グレネード所持数 +1", max: 3, baseCost: 220, step: 160 },
  ];

  const WEAPONS = [
    { key: "pistol",  name: "ハンドガン",       dmg: 22, interval: 230, mag: 12, reload: 900,  spread: 0.045, pellets: 1, auto: false, speed: 1000, range: 560,  len: 13, kick: 2.2, snd: "pistol" },
    { key: "smg",     name: "サブマシンガン",   dmg: 13, interval: 72,  mag: 30, reload: 1450, spread: 0.105, pellets: 1, auto: true,  speed: 1050, range: 520,  len: 12, kick: 1.4, snd: "smg" },
    { key: "rifle",   name: "アサルトライフル", dmg: 26, interval: 128, mag: 30, reload: 1650, spread: 0.05,  pellets: 1, auto: true,  speed: 1320, range: 780,  len: 18, kick: 2.0, snd: "rifle" },
    { key: "shotgun", name: "ショットガン",     dmg: 11, interval: 680, mag: 6,  reload: 2150, spread: 0.34,  pellets: 8, auto: false, speed: 940,  range: 360,  len: 16, kick: 5.5, snd: "shotgun" },
    { key: "sniper",  name: "スナイパー",       dmg: 96, interval: 1120, mag: 5, reload: 2350, spread: 0.006, pellets: 1, auto: false, speed: 2200, range: 1250, len: 26, kick: 6.0, pierce: 2, snd: "sniper" },
    { key: "knife",   name: "コンバットナイフ", dmg: 58, interval: 430, mag: 1, reload: 0, spread: 0, pellets: 1, auto: false, speed: 0, range: 68, len: 15, kick: 3.0, melee: true, snd: "melee" },
  ];
  const WKEY = {}; WEAPONS.forEach((w, i) => (WKEY[w.key] = i));

  const DIFF = {
    easy:   { aimErr: 0.17, react: 430, fireChance: 0.68, hpMul: 0.85, dmgMul: 0.85, sniperChance: 0.05 },
    normal: { aimErr: 0.09, react: 280, fireChance: 0.85, hpMul: 1.0,  dmgMul: 1.0,  sniperChance: 0.12 },
    hard:   { aimErr: 0.045, react: 170, fireChance: 0.95, hpMul: 1.18, dmgMul: 1.15, sniperChance: 0.2 },
  };

  // ============================================================
  //  ユーティリティ
  // ============================================================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const now = () => performance.now();
  const angLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  function makeBases() {
    return [
      { kind: "base", team: TEAM_ALLY, x: 220, y: WORLD_H - 220, r: 185, heading: -Math.PI / 4, hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, hitFlash: 0 },
      { kind: "base", team: TEAM_ENEMY, x: WORLD_W - 220, y: 220, r: 185, heading: Math.PI * 3 / 4, hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, hitFlash: 0 },
    ];
  }

  // ============================================================
  //  DOM
  // ============================================================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mini = document.getElementById("minimap");
  const mctx = mini.getContext("2d");
  const el = {
    scoreAlly: document.getElementById("score-ally"),
    scoreEnemy: document.getElementById("score-enemy"),
    scoreGoal: document.getElementById("score-goal"),
    baseAllyHp: document.getElementById("base-ally-hp"),
    baseEnemyHp: document.getElementById("base-enemy-hp"),
    baseAllyFill: document.getElementById("base-ally-fill"),
    baseEnemyFill: document.getElementById("base-enemy-fill"),
    hpFill: document.getElementById("hp-fill"),
    hpText: document.getElementById("hp-text"),
    recovery: document.getElementById("recovery-text"),
    lvText: document.getElementById("lv-text"),
    xpFill: document.getElementById("xp-fill"),
    wName: document.getElementById("weapon-name"),
    ammo: document.getElementById("ammo-text"),
    grenade: document.getElementById("grenade-text"),
    armorFill: document.getElementById("armor-fill"),
    armorText: document.getElementById("armor-text"),
    shieldFill: document.getElementById("shield-fill"),
    shieldText: document.getElementById("shield-text"),
    shieldState: document.getElementById("shield-state"),
    vehicleHint: document.getElementById("vehicle-hint"),
    armyAlly: document.getElementById("army-ally-name"),
    armyEnemy: document.getElementById("army-enemy-name"),
    killfeed: document.getElementById("killfeed"),
    levelup: document.getElementById("levelup"),
    menu: document.getElementById("menu"),
    menuMain: document.getElementById("menu-main"),
    menuOnline: document.getElementById("menu-online"),
    menuHint: document.getElementById("menu-hint"),
    pause: document.getElementById("pause"),
    help: document.getElementById("help"),
    result: document.getElementById("result"),
    resultTitle: document.getElementById("result-title"),
    resultStats: document.getElementById("result-stats"),
    rewardSummary: document.getElementById("reward-summary"),
    shopItems: document.getElementById("shop-items"),
    shopMoney: document.getElementById("shop-money"),
    shopMessage: document.getElementById("shop-message"),
    menuMoney: document.getElementById("menu-money"),
    nameInput: document.getElementById("name-input"),
    armyInput: document.getElementById("army-input"),
    netStatus: document.getElementById("net-status"),
    joinCode: document.getElementById("join-code"),
    touch: document.getElementById("touch"),
    btnMute: document.getElementById("btn-mute"),
  };

  // ============================================================
  //  オーディオ (WebAudio)
  // ============================================================
  const Audio = (() => {
    let actx = null, muted = false, master = null;
    function ensure() {
      if (actx) return;
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        master = actx.createGain();
        master.gain.value = 0.5;
        master.connect(actx.destination);
      } catch (e) { actx = null; }
    }
    function noise(dur) {
      const n = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, n, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      return src;
    }
    function shot(kind) {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const g = actx.createGain();
      g.connect(master);
      const lp = actx.createBiquadFilter();
      lp.type = "lowpass";
      const src = noise(0.16);
      src.connect(lp); lp.connect(g);
      let vol = 0.5, cut = 2200, dur = 0.1;
      if (kind === "pistol") { vol = 0.42; cut = 1800; dur = 0.09; }
      else if (kind === "smg") { vol = 0.3; cut = 2600; dur = 0.06; }
      else if (kind === "rifle") { vol = 0.45; cut = 2400; dur = 0.09; }
      else if (kind === "shotgun") { vol = 0.6; cut = 1400; dur = 0.18; }
      else if (kind === "sniper") { vol = 0.7; cut = 1100; dur = 0.22; }
      lp.frequency.setValueAtTime(cut, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.3), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.start(t); src.stop(t + dur + 0.02);
    }
    function boom() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const g = actx.createGain(); g.connect(master);
      const lp = actx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(80, t + 0.5);
      const src = noise(0.6); src.connect(lp); lp.connect(g);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      src.start(t); src.stop(t + 0.6);
    }
    function hurt() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
    }
    function levelup() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const s = t + i * 0.07;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.22, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
        o.connect(g); g.connect(master); o.start(s); o.stop(s + 0.2);
      });
    }
    function heal() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      [660, 880].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine"; o.frequency.value = f;
        const s = t + i * 0.08;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.16, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
        o.connect(g); g.connect(master); o.start(s); o.stop(s + 0.18);
      });
    }
    function melee() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const src = noise(0.1), hp = actx.createBiquadFilter(), g = actx.createGain();
      hp.type = "highpass"; hp.frequency.value = 700;
      src.connect(hp); hp.connect(g); g.connect(master);
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.start(t); src.stop(t + 0.1);
    }
    function footstep(strength) {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(82, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
      g.gain.setValueAtTime(0.08 * clamp(strength, 0.25, 1), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.11);
    }
    function parry() {
      if (!actx || muted) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(720, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.13);
      g.gain.setValueAtTime(0.24, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
    }
    return {
      unlock() { ensure(); if (actx && actx.state === "suspended") actx.resume(); },
      shot, boom, hurt, levelup, heal, melee, footstep, parry,
      toggle() { muted = !muted; return muted; },
      get muted() { return muted; },
    };
  })();

  // ============================================================
  //  入力
  // ============================================================
  const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, over: false };
  const stickMove = { x: 0, y: 0, active: false };
  const stickAim = { x: 0, y: 0, active: false };
  let touchShield = false;

  window.addEventListener("keydown", (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === "r" || e.key === "R") localInput.reloadEdge = true;
    if (!e.repeat && (e.key === "g" || e.key === "G")) localInput.grenadeEdge = true;
    if (!e.repeat && (e.key === "e" || e.key === "E")) localInput.interactEdge = true;
    if (!e.repeat && (e.key === "q" || e.key === "Q")) localInput.parryEdge = true;
    if (e.key >= "1" && e.key <= "6") localInput.weaponWanted = parseInt(e.key, 10) - 1;
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.over = true;
  });
  canvas.addEventListener("mouseleave", () => (mouse.over = false));
  canvas.addEventListener("mousedown", (e) => { if (e.button === 0) { mouse.down = true; Audio.unlock(); } });
  window.addEventListener("mouseup", (e) => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    if (!G || !G.running) return;
    e.preventDefault();
    const me = localSoldier();
    if (!me) return;
    let w = me.weapon + (e.deltaY > 0 ? 1 : -1);
    w = (w + WEAPONS.length) % WEAPONS.length;
    localInput.weaponWanted = w;
  }, { passive: false });

  // タッチ用スティック
  function bindStick(elm, target) {
    const knob = elm.querySelector(".knob");
    let id = null, cx = 0, cy = 0;
    const R = 52;
    function set(dx, dy) {
      const m = Math.hypot(dx, dy);
      const k = m > R ? R / m : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      target.x = clamp(dx / R, -1, 1);
      target.y = clamp(dy / R, -1, 1);
      target.active = true;
    }
    function reset() {
      knob.style.transform = "translate(0,0)";
      target.x = 0; target.y = 0; target.active = false; id = null;
    }
    elm.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      Audio.unlock();
      id = e.pointerId;
      const r = elm.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      elm.setPointerCapture(id);
      set(e.clientX - cx, e.clientY - cy);
    });
    elm.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      set(e.clientX - cx, e.clientY - cy);
    });
    const up = (e) => { if (e.pointerId === id) reset(); };
    elm.addEventListener("pointerup", up);
    elm.addEventListener("pointercancel", up);
  }
  bindStick(document.getElementById("stick-move"), stickMove);
  bindStick(document.getElementById("stick-aim"), stickAim);
  document.getElementById("t-reload").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.reloadEdge = true; });
  document.getElementById("t-grenade").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.grenadeEdge = true; });
  document.getElementById("t-tank").addEventListener("pointerdown", (e) => { e.preventDefault(); localInput.interactEdge = true; });
  const touchShieldBtn = document.getElementById("t-shield");
  touchShieldBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!touchShield) localInput.parryEdge = true;
    touchShield = true; touchShieldBtn.classList.add("active");
    try { touchShieldBtn.setPointerCapture(e.pointerId); } catch (err) {}
  });
  const releaseTouchShield = () => { touchShield = false; touchShieldBtn.classList.remove("active"); };
  touchShieldBtn.addEventListener("pointerup", releaseTouchShield);
  touchShieldBtn.addEventListener("pointercancel", releaseTouchShield);
  document.getElementById("t-swap").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const me = localSoldier();
    if (me) localInput.weaponWanted = (me.weapon + 1) % WEAPONS.length;
  });

  // ローカルプレイヤーの入力(SP=自分のsoldierに適用 / client=送信)
  const localInput = {
    mvx: 0, mvy: 0, aimx: 1, aimy: 0, shoot: false, dash: false,
    reloadEdge: false, grenadeEdge: false, interactEdge: false, parryEdge: false,
    weaponWanted: -1, aimAngle: 0, shield: false,
  };

  function gatherLocalInput() {
    let mvx = 0, mvy = 0;
    if (keys["w"] || keys["arrowup"]) mvy -= 1;
    if (keys["s"] || keys["arrowdown"]) mvy += 1;
    if (keys["a"] || keys["arrowleft"]) mvx -= 1;
    if (keys["d"] || keys["arrowright"]) mvx += 1;
    if (stickMove.active) { mvx = stickMove.x; mvy = stickMove.y; }
    const mm = Math.hypot(mvx, mvy);
    if (mm > 1) { mvx /= mm; mvy /= mm; }
    localInput.mvx = mvx; localInput.mvy = mvy;
    localInput.dash = !!keys["shift"] || (stickMove.active && mm > 0.92);
    localInput.shield = !!keys["q"] || touchShield;

    let shoot = false;
    const me = localSoldier();
    if (stickAim.active) {
      const am = Math.hypot(stickAim.x, stickAim.y);
      if (am > 0.25) {
        localInput.aimAngle = Math.atan2(stickAim.y, stickAim.x);
        shoot = true;
      }
    } else if (me && mouse.over) {
      const sx = me.x - camX, sy = me.y - camY;
      localInput.aimAngle = Math.atan2(mouse.y - sy, mouse.x - sx);
      shoot = mouse.down;
    } else if (me) {
      // フォールバック: 移動方向を向く
      if (mm > 0.05) localInput.aimAngle = Math.atan2(mvy, mvx);
    }
    localInput.aimx = Math.cos(localInput.aimAngle);
    localInput.aimy = Math.sin(localInput.aimAngle);
    localInput.shoot = shoot;
  }

  // ============================================================
  //  ゲーム状態
  // ============================================================
  let G = null;
  let camX = 0, camY = 0;
  let shake = 0;
  let mode = "sp";          // 'sp' | 'host' | 'client'
  let difficulty = "normal";
  let playerName = "Soldier";
  let armyName = "ブルー・フェニックス軍";
  let matchPaused = false;
  let pauseStartedAt = 0;
  let helpOrigin = "menu";
  let money = 0;
  let shopLevels = Object.fromEntries(SHOP_ITEMS.map((item) => [item.key, 0]));

  function emptyState() {
    return {
      soldiers: [],
      dogs: [],
      bullets: [],
      grenades: [],
      tanks: [],
      particles: [],
      pickups: [],
      obstacles: [],
      bases: makeBases(),
      score: [0, 0],
      goal: BASE_MAX_HP,
      running: false,
      over: false,
      localId: 0,
      nextId: 1,
      killfeed: [],
      soundPings: [],
      armyNames: [armyName, pick(ENEMY_ARMY_NAMES)],
      rewardClaimed: false,
    };
  }

  function localSoldier() {
    if (!G) return null;
    return G.soldiers.find((s) => s.id === G.localId) || null;
  }

  function sanitizeShopLevels(value) {
    const levels = {};
    for (const item of SHOP_ITEMS) {
      const raw = value && Number(value[item.key]);
      levels[item.key] = Number.isFinite(raw) ? clamp(Math.floor(raw), 0, item.max) : 0;
    }
    return levels;
  }

  function loadProgress() {
    const savedMoney = Number(localStorage.getItem("wz-money"));
    money = Number.isFinite(savedMoney) ? Math.max(0, Math.floor(savedMoney)) : 0;
    try {
      shopLevels = sanitizeShopLevels(JSON.parse(localStorage.getItem("wz-shop") || "{}"));
    } catch (e) {
      shopLevels = sanitizeShopLevels({});
    }
  }

  function saveProgress() {
    localStorage.setItem("wz-money", String(money));
    localStorage.setItem("wz-shop", JSON.stringify(shopLevels));
    if (el.menuMoney) el.menuMoney.textContent = money;
  }

  function applyShopUpgrades(s, levels) {
    if (!s || s.shopApplied) return;
    const lv = sanitizeShopLevels(levels);
    s.maxHp += lv.health * 10;
    s.hp = s.maxHp;
    s.maxArmor += lv.armor * 15;
    s.armor = s.maxArmor;
    s.maxShield += lv.shield * 20;
    s.shield = s.maxShield;
    s.dmgMul *= 1 + lv.damage * 0.05;
    s.maxGrenades = 3 + lv.grenade;
    s.grenades = s.maxGrenades;
    s.shopApplied = true;
  }

  function shopCost(item, level) {
    return item.baseCost + item.step * level;
  }

  function renderShop(message = "", isError = false) {
    el.shopMoney.textContent = money;
    if (el.menuMoney) el.menuMoney.textContent = money;
    el.shopItems.innerHTML = SHOP_ITEMS.map((item) => {
      const level = shopLevels[item.key] || 0;
      const maxed = level >= item.max;
      const cost = maxed ? 0 : shopCost(item, level);
      return `<article class="shop-item"><span class="shop-icon">${item.icon}</span>` +
        `<span class="shop-info"><b>${esc(item.name)} Lv.${level}/${item.max}</b><span>${esc(item.desc)}</span></span>` +
        `<button class="shop-buy" data-shop-buy="${item.key}"${maxed ? " disabled" : ""}>${maxed ? "強化済" : `${cost} G`}</button></article>`;
    }).join("");
    el.shopMessage.textContent = message;
    el.shopMessage.classList.toggle("err", isError);
  }

  function buyShopItem(key) {
    const item = SHOP_ITEMS.find((entry) => entry.key === key);
    if (!item) return;
    const level = shopLevels[item.key] || 0;
    if (level >= item.max) {
      renderShop("この装備は最大まで強化済みです。", true);
      return;
    }
    const cost = shopCost(item, level);
    if (money < cost) {
      renderShop(`所持金が足りません（あと ${cost - money} G）。`, true);
      return;
    }
    money -= cost;
    shopLevels[item.key] = level + 1;
    saveProgress();
    renderShop(`${item.name}をLv.${level + 1}へ強化しました。`);
  }

  // ---- マップ生成 ----
  function genMap() {
    const obs = [];
    // 外周の壁
    const wt = 26;
    obs.push({ x: 0, y: 0, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: WORLD_H - wt, w: WORLD_W, h: wt, type: "wall", hp: Infinity });
    obs.push({ x: 0, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });
    obs.push({ x: WORLD_W - wt, y: 0, w: wt, h: WORLD_H, type: "wall", hp: Infinity });

    // 中央〜全体に建物ブロック / 土嚢 / コンテナ
    const blocks = 13;
    for (let i = 0; i < blocks; i++) {
      const w = rand(80, 240), h = rand(70, 200);
      const x = rand(160, WORLD_W - 160 - w);
      const y = rand(160, WORLD_H - 160 - h);
      // スポーン地点を塞がない
      if (x < 360 && y > WORLD_H - 460) continue;
      if (x > WORLD_W - 560 && y < 460) continue;
      obs.push({ x, y, w, h, type: "wall", hp: Infinity });
    }
    // 散在カバー(コンテナ/土嚢/岩)
    const covers = 26;
    for (let i = 0; i < covers; i++) {
      const t = pick(["crate", "crate", "sandbag", "rock"]);
      const w = t === "sandbag" ? rand(70, 120) : rand(34, 60);
      const h = t === "sandbag" ? rand(26, 36) : rand(34, 60);
      const x = rand(120, WORLD_W - 120 - w);
      const y = rand(120, WORLD_H - 120 - h);
      if (G.bases.some((base) => dist2(x + w / 2, y + h / 2, base.x, base.y) < (base.r + 55) ** 2)) continue;
      obs.push({ x, y, w, h, type: t, hp: Infinity });
    }
    // 爆発バレル
    for (let i = 0; i < 9; i++) {
      const x = rand(200, WORLD_W - 220), y = rand(200, WORLD_H - 220);
      if (G.bases.some((base) => dist2(x, y, base.x, base.y) < (base.r + 60) ** 2)) continue;
      obs.push({ x, y, w: 30, h: 30, type: "barrel", hp: 30, r: 16 });
    }
    return obs;
  }

  function teamSpawn(team) {
    const base = G && G.bases ? G.bases[team] : makeBases()[team];
    const a = base.heading + rand(-0.85, 0.85), d = rand(55, 135);
    return {
      x: clamp(base.x + Math.cos(a) * d, 55, WORLD_W - 55),
      y: clamp(base.y + Math.sin(a) * d, 55, WORLD_H - 55),
    };
  }

  function makeSoldier(opt) {
    const team = opt.team;
    const sp = teamSpawn(team);
    return {
      id: opt.id,
      team,
      name: opt.name,
      isHuman: !!opt.isHuman,
      controller: opt.controller || "cpu", // 'cpu' | 'local' | peerId
      x: sp.x, y: sp.y, vx: 0, vy: 0,
      angle: team === TEAM_ALLY ? -Math.PI / 4 : (Math.PI * 3) / 4,
      aimAngle: 0,
      hp: 100, maxHp: 100, dead: false, respawnAt: 0,
      lastDamagedAt: -99999,
      armor: 100, maxArmor: 100, shield: 160, maxShield: 160, shieldRaised: false,
      parryUntil: 0, parryCooldownUntil: 0, stunnedUntil: 0,
      level: 1, xp: 0, dmgMul: 1,
      speed: opt.isHuman ? 188 : rand(150, 172),
      weapon: opt.weapon != null ? opt.weapon : WKEY.rifle,
      ammo: WEAPONS[opt.weapon != null ? opt.weapon : WKEY.rifle].mag,
      reloading: false, reloadUntil: 0, lastShot: 0,
      kills: 0, deaths: 0,
      grenades: 3, maxGrenades: 3, lastGrenade: -99999, vehicleId: -1,
      lastBaseSupplyAt: -99999,
      lastFootstepAt: -99999, noiseRadius: 0, heardUntil: 0,
      hitFlash: 0, recoil: 0, legPhase: Math.random() * 6.28, moving: false, muzzle: 0,
      ai: { think: 0, targetId: -1, strafe: 1, strafeUntil: 0, lastSeen: 0, lostAt: 0, wx: sp.x, wy: sp.y, fireUntil: 0 },
      // ネット補間用
      rx: sp.x, ry: sp.y,
    };
  }

  function spawnTeams() {
    const D = DIFF[difficulty];
    let id = G.nextId;
    const allyBots = [], enemyBots = [];
    // ローカルプレイヤー (ally)
    const me = makeSoldier({ id: id++, team: TEAM_ALLY, name: playerName || "あなた", isHuman: true, controller: "local", weapon: WKEY.rifle });
    me.allWeapons = true; // プレイヤーは全武器所持
    applyShopUpgrades(me, shopLevels);
    G.localId = me.id;
    G.soldiers.push(me);
    const used = new Set([me.name]);
    function botName() { let n; do { n = pick(BOT_NAMES); } while (used.has(n) && used.size < BOT_NAMES.length); used.add(n); return n; }
    function botWeapon() {
      if (Math.random() < D.sniperChance) return WKEY.sniper;
      return pick([WKEY.rifle, WKEY.rifle, WKEY.smg, WKEY.shotgun, WKEY.pistol, WKEY.knife]);
    }
    for (let i = 0; i < TEAM_SIZE - 1; i++) {
      const b = makeSoldier({ id: id++, team: TEAM_ALLY, name: botName(), weapon: botWeapon() });
      b.maxHp = Math.round(100 * D.hpMul * 0.95); b.hp = b.maxHp; b.dmgMul = D.dmgMul * 0.9;
      G.soldiers.push(b);
    }
    for (let i = 0; i < TEAM_SIZE; i++) {
      const b = makeSoldier({ id: id++, team: TEAM_ENEMY, name: botName(), weapon: botWeapon() });
      b.maxHp = Math.round(100 * D.hpMul); b.hp = b.maxHp; b.dmgMul = D.dmgMul;
      G.soldiers.push(b);
    }
    G.nextId = id;
  }

  function spawnDogs() {
    const dogNames = ["Rex", "Fang"];
    G.dogs = [TEAM_ALLY, TEAM_ENEMY].map((team, id) => {
      const handler = G.soldiers.find((s) => s.team === team && (team === TEAM_ENEMY || s.id === G.localId)) ||
        G.soldiers.find((s) => s.team === team);
      let x = handler ? handler.x + rand(-45, 45) : teamSpawn(team).x;
      let y = handler ? handler.y + rand(-45, 45) : teamSpawn(team).y;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!G.obstacles.some((o) => circleRect(x, y, DOG_R + 3, o.x, o.y, o.w, o.h))) break;
        const sp = teamSpawn(team); x = sp.x; y = sp.y;
      }
      return {
        kind: "dog", id, team, name: dogNames[id], handlerId: handler ? handler.id : -1,
        x, y, rx: x, ry: y, spawnX: x, spawnY: y, angle: team === TEAM_ALLY ? -0.7 : 2.4,
        hp: 90, maxHp: 90, dead: false, respawnAt: 0, speed: 242,
        damage: 30, lastAttack: -99999, biteAt: 0, kills: 0, stunnedUntil: 0,
      };
    });
  }

  function findTankSpawn(team) {
    const base = team === TEAM_ALLY
      ? { x: 260, y: WORLD_H - 250 }
      : { x: WORLD_W - 260, y: 250 };
    for (let i = 0; i < 50; i++) {
      const x = clamp(base.x + rand(-150, 150), 70, WORLD_W - 70);
      const y = clamp(base.y + rand(-150, 150), 70, WORLD_H - 70);
      if (!G.obstacles.some((o) => circleRect(x, y, TANK_R + 8, o.x, o.y, o.w, o.h))) return { x, y };
    }
    return base;
  }

  function spawnTanks() {
    G.tanks = [TEAM_ALLY, TEAM_ENEMY].map((team, id) => {
      const sp = findTankSpawn(team);
      return {
        kind: "tank", id, team, name: team === TEAM_ALLY ? "味方戦車" : "敵戦車",
        x: sp.x, y: sp.y, rx: sp.x, ry: sp.y, spawnX: sp.x, spawnY: sp.y,
        angle: team === TEAM_ALLY ? -Math.PI / 4 : Math.PI * 3 / 4,
        turretAngle: team === TEAM_ALLY ? -Math.PI / 4 : Math.PI * 3 / 4,
        hp: 420, maxHp: 420, dead: false, respawnAt: 0, driverId: -1,
        speed: 105, lastShot: -99999, muzzle: 0, kills: 0,
        ai: { think: 0, targetId: -1 },
      };
    });
  }

  function spawnMedkits() {
    G.pickups = [];
    const kinds = [
      "medkit", "medkit", "medkit", "medkit", "medkit", "medkit", "medkit", "medkit",
      "armor", "armor", "armor", "armor", "armor", "armor",
      "shield", "shield", "shield", "shield",
    ];
    for (let id = 0; id < kinds.length; id++) {
      let placed = null;
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = rand(90, WORLD_W - 90), y = rand(90, WORLD_H - 90);
        const blocked = G.obstacles.some((o) => circleRect(x, y, 18, o.x, o.y, o.w, o.h)) ||
          G.tanks.some((tank) => dist2(x, y, tank.x, tank.y) < (TANK_R + 28) ** 2);
        const crowded = G.pickups.some((p) => dist2(x, y, p.x, p.y) < 130 ** 2);
        if (!blocked && !crowded) { placed = { x, y }; break; }
      }
      if (!placed) continue;
      G.pickups.push({ id, kind: kinds[id], x: placed.x, y: placed.y, active: true, respawnAt: 0, phase: Math.random() * Math.PI * 2 });
    }
  }

  // ============================================================
  //  当たり判定
  // ============================================================
  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function resolveMovement(s, nx, ny) {
    // 軸分離で押し戻し
    let x = s.x, y = s.y;
    // X
    let tx = nx;
    for (const o of G.obstacles) {
      if (circleRect(tx, y, SOLDIER_R, o.x, o.y, o.w, o.h)) { tx = x; break; }
    }
    for (const tank of G.tanks) {
      if (!tank.dead && tank.id !== s.vehicleId && dist2(tx, y, tank.x, tank.y) < (TANK_R + SOLDIER_R) ** 2) { tx = x; break; }
    }
    x = tx;
    let ty = ny;
    for (const o of G.obstacles) {
      if (circleRect(x, ty, SOLDIER_R, o.x, o.y, o.w, o.h)) { ty = y; break; }
    }
    for (const tank of G.tanks) {
      if (!tank.dead && tank.id !== s.vehicleId && dist2(x, ty, tank.x, tank.y) < (TANK_R + SOLDIER_R) ** 2) { ty = y; break; }
    }
    y = ty;
    s.x = clamp(x, SOLDIER_R, WORLD_W - SOLDIER_R);
    s.y = clamp(y, SOLDIER_R, WORLD_H - SOLDIER_R);
  }

  function resolveTankMovement(tank, nx, ny) {
    let x = tank.x, y = tank.y;
    let tx = clamp(nx, TANK_R, WORLD_W - TANK_R);
    if (G.obstacles.some((o) => circleRect(tx, y, TANK_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((o) => o !== tank && !o.dead && dist2(tx, y, o.x, o.y) < (TANK_R * 2 + 4) ** 2)) tx = x;
    x = tx;
    let ty = clamp(ny, TANK_R, WORLD_H - TANK_R);
    if (G.obstacles.some((o) => circleRect(x, ty, TANK_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((o) => o !== tank && !o.dead && dist2(x, ty, o.x, o.y) < (TANK_R * 2 + 4) ** 2)) ty = y;
    tank.x = x; tank.y = ty;
  }

  function resolveDogMovement(dog, nx, ny) {
    let x = dog.x, y = dog.y;
    let tx = clamp(nx, DOG_R, WORLD_W - DOG_R);
    if (G.obstacles.some((o) => circleRect(tx, y, DOG_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((tank) => !tank.dead && dist2(tx, y, tank.x, tank.y) < (TANK_R + DOG_R) ** 2)) tx = x;
    x = tx;
    let ty = clamp(ny, DOG_R, WORLD_H - DOG_R);
    if (G.obstacles.some((o) => circleRect(x, ty, DOG_R, o.x, o.y, o.w, o.h)) ||
        G.tanks.some((tank) => !tank.dead && dist2(x, ty, tank.x, tank.y) < (TANK_R + DOG_R) ** 2)) ty = y;
    dog.x = x; dog.y = ty;
  }

  // 視線が遮蔽物で遮られていないか
  function lineClear(ax, ay, bx, by) {
    for (const o of G.obstacles) {
      if (o.type === "barrel") continue;
      if (segRect(ax, ay, bx, by, o.x, o.y, o.w, o.h)) return false;
    }
    return true;
  }
  function segRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    // いずれかの辺と交差 or 始点が内部
    if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return true;
    return (
      segSeg(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
      segSeg(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) ||
      segSeg(x1, y1, x2, y2, rx + rw, ry + rh, rx, ry + rh) ||
      segSeg(x1, y1, x2, y2, rx, ry + rh, rx, ry)
    );
  }
  function segSeg(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (d === 0) return false;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  // ============================================================
  //  射撃 / ダメージ
  // ============================================================
  function tryShoot(s, t) {
    if (s.dead || s.reloading || s.shieldRaised || t < s.stunnedUntil) return;
    const w = WEAPONS[s.weapon];
    if (t - s.lastShot < w.interval) return;
    if (w.melee) { tryMelee(s, t, w); return; }
    if (s.ammo <= 0) { startReload(s, t); return; }
    s.lastShot = t;
    s.ammo--;
    s.recoil = Math.min(8, s.recoil + w.kick);
    s.muzzle = t;
    const mx = s.x + Math.cos(s.aimAngle) * (SOLDIER_R + 14);
    const my = s.y + Math.sin(s.aimAngle) * (SOLDIER_R + 14);
    for (let p = 0; p < w.pellets; p++) {
      const a = s.aimAngle + (Math.random() - 0.5) * w.spread * 2;
      if (G.bullets.length < MAX_BULLETS) {
        G.bullets.push({
          x: mx, y: my,
          vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
          dmg: w.dmg * s.dmgMul, team: s.team, owner: s.id,
          range: w.range, traveled: 0, pierce: w.pierce || 0,
          col: w.key === "sniper" ? "#bfe6ff" : "#ffe49a",
          len: w.len,
        });
      }
    }
    // マズルフラッシュ & 薬莢
    addParticle(mx, my, { kind: "flash", life: 60, size: w.key === "shotgun" ? 16 : 11, a: s.aimAngle });
    const ca = s.aimAngle + Math.PI / 2 + rand(-0.3, 0.3);
    addParticle(s.x, s.y, { kind: "casing", vx: Math.cos(ca) * rand(40, 90), vy: Math.sin(ca) * rand(40, 90), life: 600, size: 2.2 });
    shake = Math.min(9, shake + (s.id === G.localId ? w.kick * 0.5 : 0));
    if (s.id === G.localId || dist2(s.x, s.y, camX + viewW() / 2, camY + viewH() / 2) < 700 * 700) Audio.shot(w.snd);
  }

  function tryMelee(s, t, w) {
    s.lastShot = t;
    s.muzzle = t;
    s.recoil = Math.min(8, s.recoil + w.kick);
    let target = null, best = Infinity;
    for (const enemy of G.soldiers) {
      if (enemy.dead || enemy.vehicleId >= 0 || enemy.team === s.team) continue;
      const d2v = dist2(s.x, s.y, enemy.x, enemy.y);
      if (d2v > w.range ** 2 || d2v >= best || !lineClear(s.x, s.y, enemy.x, enemy.y)) continue;
      const a = Math.atan2(enemy.y - s.y, enemy.x - s.x);
      const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gap < 0.82) { target = enemy; best = d2v; }
    }
    for (const dog of G.dogs) {
      if (dog.dead || dog.team === s.team) continue;
      const d2v = dist2(s.x, s.y, dog.x, dog.y);
      if (d2v > w.range ** 2 || d2v >= best || !lineClear(s.x, s.y, dog.x, dog.y)) continue;
      const a = Math.atan2(dog.y - s.y, dog.x - s.x);
      const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gap < 0.82) { target = dog; best = d2v; }
    }
    for (const tank of G.tanks) {
      if (tank.dead || tank.team === s.team) continue;
      const d2v = dist2(s.x, s.y, tank.x, tank.y);
      if (d2v > (w.range + TANK_R) ** 2 || d2v >= best || !lineClear(s.x, s.y, tank.x, tank.y)) continue;
      const a = Math.atan2(tank.y - s.y, tank.x - s.x);
      const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (gap < 0.82) { target = tank; best = d2v; }
    }
    const enemyBase = G.bases[1 - s.team];
    if (enemyBase && enemyBase.hp > 0) {
      const d2v = dist2(s.x, s.y, enemyBase.x, enemyBase.y);
      if (d2v < (w.range + BASE_CORE_R) ** 2 && d2v < best && lineClear(s.x, s.y, enemyBase.x, enemyBase.y)) {
        const a = Math.atan2(enemyBase.y - s.y, enemyBase.x - s.x);
        const gap = Math.abs(((a - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (gap < 0.82) { target = enemyBase; best = d2v; }
      }
    }
    const sx = s.x + Math.cos(s.aimAngle) * 28, sy = s.y + Math.sin(s.aimAngle) * 28;
    addParticle(sx, sy, { kind: "slash", life: 150, size: 30, a: s.aimAngle });
    if (target) {
      if (target.kind === "base") {
        damageBase(target, w.dmg * s.dmgMul * 0.75, s, s.team);
        addParticle(sx, sy, { kind: "spark", vx: rand(-70, 70), vy: rand(-70, 70), life: 180, size: 3 });
      } else if (target.kind === "tank") {
        damageTank(target, 16 * s.dmgMul, s);
        addParticle(target.x, target.y, { kind: "spark", vx: rand(-70, 70), vy: rand(-70, 70), life: 180, size: 3 });
      } else if (target.kind === "dog") {
        damageDog(target, w.dmg * s.dmgMul, s);
        addParticle(target.x, target.y, { kind: "dust", vx: rand(-80, 80), vy: rand(-80, 80), life: 300, size: 3 });
      } else {
        const result = damageSoldier(target, w.dmg * s.dmgMul, s, { x: s.x, y: s.y, type: "melee" });
        if (result !== "parried") {
          for (let i = 0; i < 6; i++) {
            addParticle(target.x, target.y, { kind: "blood", vx: rand(-110, 110), vy: rand(-110, 110), life: rand(220, 420), size: rand(1.5, 3.5) });
          }
        }
      }
    }
    if (s.id === G.localId || dist2(s.x, s.y, camX + viewW() / 2, camY + viewH() / 2) < 550 ** 2) Audio.melee();
  }

  function tryTankShoot(tank, t) {
    if (tank.dead || t - tank.lastShot < 1450) return;
    tank.lastShot = t;
    tank.muzzle = t;
    const a = tank.turretAngle;
    const mx = tank.x + Math.cos(a) * 48;
    const my = tank.y + Math.sin(a) * 48;
    const driver = G.soldiers.find((s) => s.id === tank.driverId) || null;
    G.bullets.push({
      kind: "shell", x: mx, y: my,
      vx: Math.cos(a) * 720, vy: Math.sin(a) * 720,
      dmg: 125, team: tank.team, owner: driver ? driver.id : -1, tankOwner: tank.id,
      range: 900, traveled: 0, pierce: 0, col: "#ffcf62", len: 12,
    });
    addParticle(mx, my, { kind: "flash", life: 100, size: 20, a });
    if (driver && driver.id === G.localId) shake = Math.min(14, shake + 8);
    if (dist2(tank.x, tank.y, camX + viewW() / 2, camY + viewH() / 2) < 850 * 850) Audio.shot("sniper");
  }

  function tryThrowGrenade(s, t, angle) {
    if (s.dead || s.vehicleId >= 0 || s.shieldRaised || t < s.stunnedUntil || s.grenades <= 0 || t - s.lastGrenade < 650) return;
    s.grenades--;
    s.lastGrenade = t;
    const a = angle == null ? s.aimAngle : angle;
    G.grenades.push({
      x: s.x + Math.cos(a) * 20, y: s.y + Math.sin(a) * 20,
      vx: Math.cos(a) * 410, vy: Math.sin(a) * 410,
      team: s.team, owner: s.id, fuseAt: t + GRENADE_FUSE_MS,
      bornAt: t, rotation: 0,
    });
  }

  function startReload(s, t) {
    if (s.reloading || s.shieldRaised || t < s.stunnedUntil) return;
    const w = WEAPONS[s.weapon];
    if (w.melee) return;
    if (s.ammo >= w.mag) return;
    s.reloading = true;
    s.reloadUntil = t + w.reload;
  }

  function performParry(target, attacker, hit) {
    target.parryUntil = 0;
    target.parryCooldownUntil = Math.max(target.parryCooldownUntil, now() + 850);
    const px = target.x + Math.cos(target.aimAngle) * 22;
    const py = target.y + Math.sin(target.aimAngle) * 22;
    addParticle(px, py, { kind: "parry", life: 260, size: 27, a: target.aimAngle });
    Audio.parry();
    if (target.id === G.localId) { shake = Math.min(11, shake + 5); banner("PARRY!  攻撃を弾き返した"); }
    if (hit.type === "melee" && attacker && attacker.kind !== "tank") {
      attacker.stunnedUntil = now() + 650;
      addParticle(attacker.x, attacker.y - 18, { kind: "stun", life: 650, size: 12, a: 0 });
      const a = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      if (attacker.kind === "dog") {
        resolveDogMovement(attacker, attacker.x + Math.cos(a) * 34, attacker.y + Math.sin(a) * 34);
        attacker.moving = false;
      } else {
        resolveMovement(attacker, attacker.x + Math.cos(a) * 28, attacker.y + Math.sin(a) * 28);
        attacker.shieldRaised = false;
        attacker.recoil = Math.max(attacker.recoil, 6);
      }
    }
  }

  function damageSoldier(target, dmg, attacker, hit) {
    if (target.dead) return;
    if (!hit) hit = attacker ? { x: attacker.x, y: attacker.y, type: "bullet" } : null;
    if (hit && !hit.bypassEquipment) {
      if (target.shieldRaised && target.shield > 0) {
        const incoming = Math.atan2(hit.y - target.y, hit.x - target.x);
        const gap = Math.abs(((incoming - target.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (gap < 1.05) {
          if (target.parryUntil > 0 && now() <= target.parryUntil) {
            performParry(target, attacker, hit);
            return "parried";
          }
          const rate = hit.type === "explosion" ? 0.55 : hit.type === "melee" ? 0.78 : 0.9;
          const blocked = Math.min(target.shield, dmg * rate);
          target.shield -= blocked; dmg -= blocked;
          addParticle(target.x + Math.cos(target.aimAngle) * 20, target.y + Math.sin(target.aimAngle) * 20, {
            kind: "shieldHit", life: 190, size: 20, a: target.aimAngle,
          });
          if (target.shield <= 0) { target.shield = 0; target.shieldRaised = false; }
        }
      }
      if (target.armor > 0 && dmg > 0) {
        const rate = hit.type === "explosion" ? 0.34 : hit.type === "melee" ? 0.24 : 0.46;
        const absorbed = Math.min(target.armor, dmg * rate);
        target.armor -= absorbed; dmg -= absorbed;
        if (absorbed > 0) addParticle(target.x, target.y, { kind: "armorHit", life: 160, size: 15, a: 0 });
      }
    }
    if (dmg <= 0.01) { target.hitFlash = Math.max(target.hitFlash, 0.25); return "blocked"; }
    target.hp -= dmg;
    target.lastDamagedAt = now();
    target.hitFlash = 1;
    if (target.id === G.localId) { Audio.hurt(); shake = Math.min(12, shake + 3); }
    if (target.hp <= 0) killSoldier(target, attacker);
    return "hit";
  }

  function damageTank(target, dmg, attacker) {
    if (target.dead || (attacker && attacker.team === target.team)) return;
    target.hp -= dmg;
    if (target.hp <= 0) destroyTank(target, attacker);
  }

  function damageDog(target, dmg, attacker) {
    if (target.dead || (attacker && attacker.team === target.team)) return;
    target.hp -= dmg;
    target.hitFlash = 1;
    if (target.hp <= 0) destroyDog(target, attacker);
  }

  function damageBase(base, dmg, attacker, sourceTeam) {
    if (!base || G.over || base.hp <= 0) return;
    const team = sourceTeam == null && attacker ? attacker.team : sourceTeam;
    if (team !== TEAM_ALLY && team !== TEAM_ENEMY) return;
    if (team === base.team) return;
    base.hp = Math.max(0, base.hp - Math.max(0, dmg));
    base.hitFlash = 1;
    addParticle(base.x + rand(-42, 42), base.y + rand(-35, 35), {
      kind: "spark", vx: rand(-110, 110), vy: rand(-130, 40), life: rand(180, 360), size: rand(2, 5),
    });
    const stamp = now();
    if (base.team === localSoldier()?.team && stamp - (base.lastWarningAt || -99999) > 2200) {
      base.lastWarningAt = stamp;
      banner("警告：味方基地が攻撃されています！");
    }
    if (base.hp <= 0) destroyBase(base, team);
  }

  function destroyBase(base, winnerTeam) {
    if (G.over) return;
    base.hp = 0;
    Audio.boom();
    shake = Math.min(24, shake + 18);
    createExplosionFx(base.x, base.y, 70);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      createExplosionFx(base.x + Math.cos(a) * 55, base.y + Math.sin(a) * 42, 18);
    }
    endMatch(winnerTeam);
  }

  function destroyDog(dog, attacker) {
    if (dog.dead) return;
    dog.dead = true; dog.hp = 0; dog.respawnAt = now() + DOG_RESPAWN_MS;
    for (let i = 0; i < 10; i++) {
      addParticle(dog.x, dog.y, { kind: "dust", vx: rand(-90, 90), vy: rand(-90, 90), life: rand(300, 650), size: rand(2, 5) });
    }
    if (attacker && attacker.team !== dog.team) {
      if (!attacker.kind) gainXp(attacker, 1);
      addKillfeed(attacker, { name: `軍用犬 ${dog.name}`, team: dog.team });
    }
  }

  function destroyTank(tank, attacker) {
    if (tank.dead) return;
    tank.dead = true;
    tank.hp = 0;
    tank.respawnAt = now() + TANK_RESPAWN_MS;
    Audio.boom();
    shake = Math.min(18, shake + 12);
    createExplosionFx(tank.x, tank.y, 38);
    addParticle(tank.x, tank.y, { kind: "stain", life: 12000, size: 34 });
    const driver = G.soldiers.find((s) => s.id === tank.driverId);
    tank.driverId = -1;
    if (driver) {
      driver.vehicleId = -1;
      driver.x = tank.x; driver.y = tank.y;
      damageSoldier(driver, driver.maxHp * 2, attacker, { bypassEquipment: true });
    }
    if (attacker && attacker.team !== tank.team) {
      if (attacker.kind !== "tank") gainXp(attacker, 2);
      addKillfeed(attacker, { name: tank.name, team: tank.team });
    }
  }

  function killSoldier(target, attacker) {
    target.dead = true;
    target.hp = 0;
    target.deaths++;
    target.respawnAt = now() + RESPAWN_MS;
    // 血しぶき
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(30, 220);
      addParticle(target.x, target.y, { kind: "blood", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(400, 900), size: rand(2, 5) });
    }
    addParticle(target.x, target.y, { kind: "stain", life: 9000, size: rand(16, 24) });
    if (attacker && attacker.team !== target.team && (attacker.kind || attacker.id !== target.id)) {
      attacker.kills++;
      G.score[attacker.team]++;
      if (!attacker.kind) gainXp(attacker, target.isHuman ? 2 : 1);
      addKillfeed(attacker, target);
    } else {
      addKillfeed(null, target);
    }
  }

  function gainXp(s, amount) {
    s.xp += amount;
    let need = s.level * 3;
    while (s.xp >= need && s.level < 20) {
      s.xp -= need;
      s.level++;
      s.maxHp += 12;
      s.hp = s.maxHp;
      s.armor = s.maxArmor;
      s.shield = s.maxShield;
      s.dmgMul += 0.07;
      s.speed += 2;
      need = s.level * 3;
      if (s.id === G.localId) {
        Audio.levelup();
        showLevelup(s.level);
      }
    }
  }

  function respawn(s) {
    const sp = teamSpawn(s.team);
    s.x = sp.x; s.y = sp.y; s.rx = sp.x; s.ry = sp.y;
    s.hp = s.maxHp; s.dead = false; s.vx = 0; s.vy = 0;
    s.lastDamagedAt = -99999;
    s.armor = s.maxArmor; s.shield = s.maxShield; s.shieldRaised = false;
    s.parryUntil = 0; s.parryCooldownUntil = 0; s.stunnedUntil = 0;
    s.ammo = WEAPONS[s.weapon].mag; s.reloading = false;
    s.grenades = s.maxGrenades || 3; s.vehicleId = -1;
    s.ai.targetId = -1; s.ai.think = 0;
  }

  function respawnTank(tank) {
    tank.x = tank.spawnX; tank.y = tank.spawnY; tank.rx = tank.x; tank.ry = tank.y;
    tank.hp = tank.maxHp; tank.dead = false; tank.driverId = -1;
    tank.angle = tank.team === TEAM_ALLY ? -Math.PI / 4 : Math.PI * 3 / 4;
    tank.turretAngle = tank.angle; tank.ai.targetId = -1; tank.ai.think = 0;
  }

  function respawnDog(dog) {
    const base = G.bases[dog.team];
    dog.x = base.x + Math.cos(base.heading) * 75;
    dog.y = base.y + Math.sin(base.heading) * 75;
    dog.rx = dog.x; dog.ry = dog.y; dog.hp = dog.maxHp; dog.dead = false;
    dog.angle = base.heading; dog.lastAttack = -99999; dog.hitFlash = 0;
    dog.stunnedUntil = 0;
  }

  function addKillfeed(killer, victim) {
    G.killfeed.push({ killer: killer ? killer.name : null, killerTeam: killer ? killer.team : -1, victim: victim.name, victimTeam: victim.team, t: now() });
    if (G.killfeed.length > 6) G.killfeed.shift();
  }

  function explodeBarrel(o) {
    Audio.boom();
    shake = Math.min(16, shake + 10);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(60, 360);
      addParticle(o.x + o.w / 2, o.y + o.h / 2, { kind: i % 3 === 0 ? "spark" : "smoke", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(300, 900), size: rand(4, 12) });
    }
    addParticle(o.x + o.w / 2, o.y + o.h / 2, { kind: "boom", life: 260, size: 8 });
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, R = 120;
    for (const s of G.soldiers) {
      if (s.dead) continue;
      const dd = Math.sqrt(dist2(s.x, s.y, cx, cy));
      if (dd < R) damageSoldier(s, (1 - dd / R) * 90, null, { x: cx, y: cy, type: "explosion" });
    }
    // 連鎖
    for (const o2 of G.obstacles) {
      if (o2.type === "barrel" && o2.hp > 0 && o2 !== o) {
        if (dist2(o2.x, o2.y, cx, cy) < R * R) o2.hp = 0.0001;
      }
    }
  }

  function createExplosionFx(x, y, amount) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(70, 390);
      addParticle(x, y, {
        kind: i % 4 === 0 ? "spark" : "smoke",
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(320, 1000), size: rand(4, 13),
      });
    }
    addParticle(x, y, { kind: "boom", life: 280, size: 8 });
  }

  function projectileAttacker(b) {
    if (b.owner >= 0) return G.soldiers.find((s) => s.id === b.owner) || null;
    if (b.tankOwner != null) return G.tanks.find((tank) => tank.id === b.tankOwner) || null;
    return null;
  }

  function explodeProjectile(b) {
    Audio.boom();
    createExplosionFx(b.x, b.y, 28);
    const attacker = projectileAttacker(b);
    const radius = 118;
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || s.team === b.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, b.x, b.y));
      if (d < radius) damageSoldier(s, b.dmg * (1 - d / radius * 0.62), attacker, { x: b.x, y: b.y, type: "explosion" });
    }
    for (const dog of G.dogs) {
      if (dog.dead || dog.team === b.team) continue;
      const d = Math.sqrt(dist2(dog.x, dog.y, b.x, b.y));
      if (d < radius) damageDog(dog, b.dmg * (1 - d / radius * 0.62), attacker);
    }
    for (const tank of G.tanks) {
      if (tank.dead || tank.team === b.team) continue;
      const d = Math.sqrt(dist2(tank.x, tank.y, b.x, b.y));
      if (d < radius + TANK_R) damageTank(tank, b.dmg * 0.85 * (1 - clamp(d / (radius + TANK_R), 0, 0.8)), attacker);
    }
    for (const base of G.bases) {
      if (base.team === b.team || base.hp <= 0) continue;
      const d = Math.sqrt(dist2(base.x, base.y, b.x, b.y));
      if (d < radius + BASE_CORE_R) {
        damageBase(base, b.dmg * 0.9 * (1 - clamp(d / (radius + BASE_CORE_R), 0, 0.78)), attacker, b.team);
      }
    }
    for (const o of G.obstacles) {
      if (o.type === "barrel" && dist2(o.x + o.w / 2, o.y + o.h / 2, b.x, b.y) < radius * radius) o.hp = 0;
    }
  }

  function explodeGrenade(g) {
    Audio.boom();
    shake = Math.min(15, shake + 7);
    createExplosionFx(g.x, g.y, 32);
    const attacker = G.soldiers.find((s) => s.id === g.owner) || null;
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || s.team === g.team) continue;
      const d = Math.sqrt(dist2(s.x, s.y, g.x, g.y));
      if (d < GRENADE_RADIUS) damageSoldier(s, 130 * (1 - d / GRENADE_RADIUS * 0.72), attacker, { x: g.x, y: g.y, type: "explosion" });
    }
    for (const dog of G.dogs) {
      if (dog.dead || dog.team === g.team) continue;
      const d = Math.sqrt(dist2(dog.x, dog.y, g.x, g.y));
      if (d < GRENADE_RADIUS) damageDog(dog, 130 * (1 - d / GRENADE_RADIUS * 0.72), attacker);
    }
    for (const tank of G.tanks) {
      if (tank.dead || tank.team === g.team) continue;
      const d = Math.sqrt(dist2(tank.x, tank.y, g.x, g.y));
      if (d < GRENADE_RADIUS + TANK_R) damageTank(tank, 95 * (1 - clamp(d / (GRENADE_RADIUS + TANK_R), 0, 0.8)), attacker);
    }
    for (const base of G.bases) {
      if (base.team === g.team || base.hp <= 0) continue;
      const d = Math.sqrt(dist2(base.x, base.y, g.x, g.y));
      if (d < GRENADE_RADIUS + BASE_CORE_R) {
        damageBase(base, 115 * (1 - clamp(d / (GRENADE_RADIUS + BASE_CORE_R), 0, 0.78)), attacker, g.team);
      }
    }
    for (const o of G.obstacles) {
      if (o.type === "barrel" && dist2(o.x + o.w / 2, o.y + o.h / 2, g.x, g.y) < GRENADE_RADIUS ** 2) o.hp = 0;
    }
  }

  function updateGrenades(dt, t) {
    for (let i = G.grenades.length - 1; i >= 0; i--) {
      const g = G.grenades[i];
      if (t >= g.fuseAt) {
        explodeGrenade(g);
        G.grenades.splice(i, 1);
        continue;
      }
      const ox = g.x, oy = g.y;
      g.x += g.vx * dt;
      if (G.obstacles.some((o) => circleRect(g.x, g.y, 5, o.x, o.y, o.w, o.h))) { g.x = ox; g.vx *= -0.5; }
      g.y += g.vy * dt;
      if (G.obstacles.some((o) => circleRect(g.x, g.y, 5, o.x, o.y, o.w, o.h))) { g.y = oy; g.vy *= -0.5; }
      const drag = Math.pow(0.2, dt);
      g.vx *= drag; g.vy *= drag; g.rotation += Math.hypot(g.vx, g.vy) * dt * 0.08;
    }
  }

  function updateHealthRecovery(dt, t) {
    for (const s of G.soldiers) {
      if (s.dead || s.hp >= s.maxHp || t - s.lastDamagedAt < AUTO_HEAL_DELAY_MS) continue;
      s.hp = Math.min(s.maxHp, s.hp + AUTO_HEAL_PER_SEC * dt);
    }
  }

  function updateMedkits(t) {
    for (const kit of G.pickups) {
      if (!kit.active) {
        if (t >= kit.respawnAt) kit.active = true;
        else continue;
      }
      for (const s of G.soldiers) {
        if (s.dead || s.vehicleId >= 0) continue;
        const needed = kit.kind === "medkit" ? s.maxHp - s.hp : kit.kind === "armor" ? s.maxArmor - s.armor : s.maxShield - s.shield;
        if (needed < 1) continue;
        if (dist2(s.x, s.y, kit.x, kit.y) > 28 ** 2) continue;
        const amount = Math.min(kit.kind === "medkit" ? MEDKIT_HEAL : kit.kind === "armor" ? 55 : 80, needed);
        if (kit.kind === "medkit") s.hp += amount;
        else if (kit.kind === "armor") s.armor += amount;
        else s.shield += amount;
        kit.active = false;
        kit.respawnAt = t + (kit.kind === "medkit" ? 15000 : 18000);
        for (let i = 0; i < 9; i++) {
          addParticle(kit.x + rand(-10, 10), kit.y + rand(-8, 8), {
            kind: kit.kind === "medkit" ? "heal" : "equip", vx: rand(-18, 18), vy: rand(-55, -20),
            life: rand(450, 850), size: rand(3, 6), a: kit.kind === "armor" ? 0 : 1,
          });
        }
        if (s.id === G.localId) {
          Audio.heal();
          const label = kit.kind === "medkit" ? `救急キット +${Math.ceil(amount)} HP` : kit.kind === "armor" ? `防弾鎧 +${Math.ceil(amount)}` : `盾耐久 +${Math.ceil(amount)}`;
          banner(label);
        }
        break;
      }
    }
  }

  // ============================================================
  //  パーティクル
  // ============================================================
  function addParticle(x, y, opt) {
    if (G.particles.length >= MAX_PARTICLES && opt.kind !== "boom") return;
    G.particles.push({
      x, y, vx: opt.vx || 0, vy: opt.vy || 0,
      life: opt.life, maxLife: opt.life, size: opt.size || 3,
      kind: opt.kind, a: opt.a || 0,
    });
  }

  function updateParticles(dt) {
    const ps = G.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt * 1000;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      if (p.kind === "stain" || p.kind === "flash" || p.kind === "boom") continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const fr = p.kind === "casing" ? 0.86 : 0.9;
      p.vx *= Math.pow(fr, dt * 60); p.vy *= Math.pow(fr, dt * 60);
    }
  }

  // ============================================================
  //  AI
  // ============================================================
  function updateAI(s, t, dt) {
    const a = s.ai;
    const D = DIFF[difficulty];
    if (t > a.think) {
      a.think = t + rand(120, 240);
      // 視界は短いが、走る敵の足音なら遮蔽物越しでも察知する
      let best = -1, bestD = Infinity;
      for (const e of G.soldiers) {
        if (e.dead || e.team === s.team) continue;
        const d2 = dist2(s.x, s.y, e.x, e.y);
        const vis = lineClear(s.x, s.y, e.x, e.y);
        const seen = vis && d2 < 420 ** 2;
        const heard = e.moving && d2 < (e.noiseRadius || 390) ** 2;
        if ((seen || heard) && d2 < bestD) { bestD = d2; best = e.id; }
      }
      if (best >= 0) { a.targetId = best; a.lastSeen = t; }
      else if (t - a.lastSeen > 1400) a.targetId = -1;

      // ターゲット無し → 敵基地へ進軍
      if (a.targetId < 0) {
        const objective = G.bases[1 - s.team];
        a.wx = objective.x + rand(-45, 45);
        a.wy = objective.y + rand(-45, 45);
      }
      if (t > a.strafeUntil) { a.strafe = Math.random() < 0.5 ? 1 : -1; a.strafeUntil = t + rand(500, 1100); }
    }

    const w = WEAPONS[s.weapon];
    const soldierTarget = a.targetId >= 0 ? G.soldiers.find((x) => x.id === a.targetId) : null;
    const baseTarget = G.bases[1 - s.team];
    const target = soldierTarget && !soldierTarget.dead ? soldierTarget : (baseTarget && baseTarget.hp > 0 ? baseTarget : null);
    const targetIsBase = !!target && target.kind === "base";
    let mvx = 0, mvy = 0;
    let desiredAim = s.aimAngle;

    if (target) {
      const dx = target.x - s.x, dy = target.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      desiredAim = Math.atan2(dy, dx);
      const pref = targetIsBase ? Math.max(BASE_CORE_R + 38, w.range * 0.62) : w.range * 0.62;
      // 距離維持 + ストレイフ
      let radial = 0;
      if (d > pref * 1.15) radial = 1;
      else if (!targetIsBase && d < pref * 0.6) radial = -1;
      const perpx = -dy / d, perpy = dx / d;
      const strafePower = targetIsBase ? 0.18 : 0.8;
      mvx = (dx / d) * radial + perpx * a.strafe * strafePower;
      mvy = (dy / d) * radial + perpy * a.strafe * strafePower;
      // 射撃判定
      const vis = lineClear(s.x, s.y, target.x, target.y);
      const wantsShield = !targetIsBase && s.shield > 0 && vis && d < 430 && t >= s.stunnedUntil && (Math.floor(t / 950) % 4 === 0);
      if (wantsShield && !s.shieldRaised && t >= s.parryCooldownUntil) {
        s.parryUntil = t + 220; s.parryCooldownUntil = t + 1000;
      }
      s.shieldRaised = wantsShield;
      const aimGap = Math.abs(((desiredAim - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (vis && d < w.range + (targetIsBase ? BASE_CORE_R : 0) && aimGap < 0.22 && Math.random() < D.fireChance) {
        // エイムにブレを加える
        const err = (Math.random() - 0.5) * D.aimErr * 2;
        const sav = s.aimAngle;
        s.aimAngle = desiredAim + err;
        tryShoot(s, t);
        s.aimAngle = sav;
      }
      if (vis && d > 130 && d < 430 + (targetIsBase ? BASE_CORE_R : 0) && s.grenades > 0 && t - s.lastGrenade > 6500 && Math.random() < 0.008) {
        tryThrowGrenade(s, t, desiredAim);
      }
      if (s.ammo <= 0) startReload(s, t);
    } else {
      s.shieldRaised = false;
      const dx = a.wx - s.x, dy = a.wy - s.y;
      const d = Math.hypot(dx, dy) || 1;
      mvx = dx / d; mvy = dy / d;
      if (d < 60) { mvx = 0; mvy = 0; }
      if (Math.hypot(mvx, mvy) > 0.05) desiredAim = Math.atan2(mvy, mvx);
    }

    // 障害物回避(前方に壁があれば横へ)
    const probe = 40;
    const px = s.x + mvx * probe, py = s.y + mvy * probe;
    for (const o of G.obstacles) {
      if (circleRect(px, py, SOLDIER_R + 4, o.x, o.y, o.w, o.h)) {
        const tmp = mvx; mvx = -mvy * a.strafe; mvy = tmp * a.strafe;
        break;
      }
    }

    s.aimAngle = angLerp(s.aimAngle, desiredAim, clamp(dt * 9, 0, 1));
    applyMove(s, mvx, mvy, dt, false);
  }

  function applyMove(s, mvx, mvy, dt, dash) {
    if (now() < s.stunnedUntil) { s.moving = false; s.noiseRadius = 0; return; }
    const m = Math.hypot(mvx, mvy);
    s.moving = m > 0.05;
    s.noiseRadius = s.moving ? (dash ? 680 : 430) : 0;
    if (m > 1) { mvx /= m; mvy /= m; }
    const sp = s.speed * (dash ? 1.55 : 1) * (s.shieldRaised ? 0.62 : 1);
    const nx = s.x + mvx * sp * dt;
    const ny = s.y + mvy * sp * dt;
    resolveMovement(s, nx, ny);
    if (s.moving) s.legPhase += dt * 12;
  }

  function enterOrExitTank(s) {
    if (s.vehicleId >= 0) {
      const tank = G.tanks.find((x) => x.id === s.vehicleId);
      if (tank) {
        tank.driverId = -1;
        const candidates = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
        let placed = false;
        for (const offset of candidates) {
          const a = tank.angle + offset;
          const x = tank.x + Math.cos(a) * (TANK_R + SOLDIER_R + 8);
          const y = tank.y + Math.sin(a) * (TANK_R + SOLDIER_R + 8);
          const blocked = G.obstacles.some((o) => circleRect(x, y, SOLDIER_R, o.x, o.y, o.w, o.h)) ||
            G.tanks.some((o) => o !== tank && !o.dead && dist2(x, y, o.x, o.y) < (TANK_R + SOLDIER_R) ** 2);
          if (!blocked) { s.x = x; s.y = y; placed = true; break; }
        }
        if (!placed) { s.x = tank.x; s.y = tank.y; }
      }
      s.vehicleId = -1;
      return;
    }
    let nearest = null, best = 78 * 78;
    for (const tank of G.tanks) {
      if (tank.dead || tank.team !== s.team || tank.driverId >= 0) continue;
      const d = dist2(s.x, s.y, tank.x, tank.y);
      if (d < best) { best = d; nearest = tank; }
    }
    if (nearest) {
      nearest.driverId = s.id;
      s.vehicleId = nearest.id;
      s.x = nearest.x; s.y = nearest.y; s.moving = false;
    }
  }

  function applyTankInput(tank, s, inp, t) {
    s.shieldRaised = false;
    tank.turretAngle = inp.aimAngle != null ? inp.aimAngle : tank.turretAngle;
    const m = Math.hypot(inp.mvx, inp.mvy);
    if (m > 0.05) {
      const moveAngle = Math.atan2(inp.mvy, inp.mvx);
      tank.angle = angLerp(tank.angle, moveAngle, clamp(dtGlobal * 4.5, 0, 1));
      resolveTankMovement(tank, tank.x + inp.mvx * tank.speed * dtGlobal, tank.y + inp.mvy * tank.speed * dtGlobal);
    }
    if (inp.shoot) tryTankShoot(tank, t);
    inp.reloadEdge = false;
    inp.grenadeEdge = false;
    inp.parryEdge = false;
    inp.weaponWanted = -1;
    s.x = tank.x; s.y = tank.y; s.aimAngle = tank.turretAngle; s.moving = m > 0.05;
  }

  function updateTanks(dt, t) {
    for (const tank of G.tanks) {
      if (tank.dead) {
        if (t >= tank.respawnAt) respawnTank(tank);
        continue;
      }
      const driver = G.soldiers.find((s) => s.id === tank.driverId && !s.dead);
      if (driver) {
        driver.x = tank.x; driver.y = tank.y; driver.aimAngle = tank.turretAngle;
        continue;
      }
      if (tank.driverId >= 0) tank.driverId = -1;

      const enemyBase = G.bases[1 - tank.team];
      let target = enemyBase && enemyBase.hp > 0 ? enemyBase : null;
      let best = target ? dist2(tank.x, tank.y, target.x, target.y) : Infinity;
      for (const s of G.soldiers) {
        if (s.dead || s.vehicleId >= 0 || s.team === tank.team) continue;
        const d = dist2(tank.x, tank.y, s.x, s.y);
        if (d < best) { best = d; target = s; }
      }
      for (const dog of G.dogs) {
        if (dog.dead || dog.team === tank.team) continue;
        const d = dist2(tank.x, tank.y, dog.x, dog.y);
        if (d < best) { best = d; target = dog; }
      }
      for (const other of G.tanks) {
        if (other.dead || other.team === tank.team) continue;
        const d = dist2(tank.x, tank.y, other.x, other.y);
        if (d < best) { best = d; target = other; }
      }
      if (!target) continue;
      const dx = target.x - tank.x, dy = target.y - tank.y;
      const d = Math.hypot(dx, dy) || 1;
      const aim = Math.atan2(dy, dx);
      tank.turretAngle = angLerp(tank.turretAngle, aim, clamp(dt * 2.7, 0, 1));
      if (d > (target.kind === "base" ? 420 : 360)) {
        tank.angle = angLerp(tank.angle, aim, clamp(dt * 2.2, 0, 1));
        resolveTankMovement(tank, tank.x + Math.cos(tank.angle) * tank.speed * 0.7 * dt, tank.y + Math.sin(tank.angle) * tank.speed * 0.7 * dt);
      }
      const aimGap = Math.abs(((aim - tank.turretAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (d < 880 + (target.kind === "base" ? BASE_CORE_R : 0) && aimGap < 0.09 && lineClear(tank.x, tank.y, target.x, target.y)) tryTankShoot(tank, t);
    }
  }

  function updateDogs(dt, t) {
    for (const dog of G.dogs) {
      if (dog.dead) {
        if (t >= dog.respawnAt) respawnDog(dog);
        continue;
      }
      if (dog.hitFlash > 0) dog.hitFlash = Math.max(0, dog.hitFlash - dt * 5);
      if (t < dog.stunnedUntil) { dog.moving = false; continue; }
      let handler = G.soldiers.find((s) => s.id === dog.handlerId && !s.dead);
      if (!handler) {
        handler = G.soldiers.find((s) => s.team === dog.team && !s.dead) || null;
        if (handler) dog.handlerId = handler.id;
      }

      let target = null, best = Infinity;
      for (const enemy of G.soldiers) {
        if (enemy.dead || enemy.vehicleId >= 0 || enemy.team === dog.team) continue;
        const d2v = dist2(dog.x, dog.y, enemy.x, enemy.y);
        const seen = d2v < 430 ** 2 && lineClear(dog.x, dog.y, enemy.x, enemy.y);
        const heard = enemy.moving && d2v < ((enemy.noiseRadius || 390) + 130) ** 2;
        if ((seen || heard) && d2v < best) { best = d2v; target = enemy; }
      }
      for (const enemyDog of G.dogs) {
        if (enemyDog === dog || enemyDog.dead || enemyDog.team === dog.team) continue;
        const d2v = dist2(dog.x, dog.y, enemyDog.x, enemyDog.y);
        if (d2v < 330 ** 2 && d2v < best && lineClear(dog.x, dog.y, enemyDog.x, enemyDog.y)) { best = d2v; target = enemyDog; }
      }
      const enemyBase = G.bases[1 - dog.team];
      if (!target && enemyBase && enemyBase.hp > 0 &&
          (dist2(dog.x, dog.y, enemyBase.x, enemyBase.y) < 390 ** 2 ||
           (handler && dist2(handler.x, handler.y, enemyBase.x, enemyBase.y) < 430 ** 2))) {
        target = enemyBase;
      }

      let dx = 0, dy = 0, desired = dog.angle;
      if (target) {
        dx = target.x - dog.x; dy = target.y - dog.y;
        const d = Math.hypot(dx, dy) || 1;
        desired = Math.atan2(dy, dx);
        const targetR = target.kind === "base" ? BASE_CORE_R : target.kind === "dog" ? DOG_R : SOLDIER_R;
        if (d > DOG_R + targetR + 7) { dx /= d; dy /= d; }
        else {
          dx = 0; dy = 0;
          if (t - dog.lastAttack >= 650) {
            dog.lastAttack = t; dog.biteAt = t;
            if (target.kind === "base") {
              damageBase(target, dog.damage * 0.55, dog, dog.team);
              addParticle(target.x + rand(-35, 35), target.y + rand(-30, 30), { kind: "spark", life: 170, size: 3, a: desired });
            } else if (target.kind === "dog") {
              damageDog(target, dog.damage, dog);
              addParticle(target.x, target.y, { kind: "bite", life: 170, size: 18, a: desired });
            } else {
              const result = damageSoldier(target, dog.damage, dog, { x: dog.x, y: dog.y, type: "melee" });
              if (result !== "parried") addParticle(target.x, target.y, { kind: "bite", life: 170, size: 18, a: desired });
            }
          }
        }
      } else if (handler) {
        dx = handler.x - dog.x; dy = handler.y - dog.y;
        const d = Math.hypot(dx, dy) || 1;
        desired = Math.atan2(dy, dx);
        if (d > 72) { dx /= d; dy /= d; } else { dx = 0; dy = 0; }
      }

      dog.angle = angLerp(dog.angle, desired, clamp(dt * 9, 0, 1));
      dog.moving = Math.hypot(dx, dy) > 0.05;
      if (dog.moving) {
        const ox = dog.x, oy = dog.y;
        resolveDogMovement(dog, dog.x + dx * dog.speed * dt, dog.y + dy * dog.speed * dt);
        if (dog.x === ox && dog.y === oy) {
          resolveDogMovement(dog, dog.x - dy * dog.speed * dt, dog.y + dx * dog.speed * dt);
        }
      }
    }
  }

  function inFriendlyBase(entity) {
    const base = G.bases[entity.team];
    return !!base && dist2(entity.x, entity.y, base.x, base.y) < base.r ** 2;
  }

  function updateBases(dt, t) {
    for (const base of G.bases) {
      if (base.hitFlash > 0) base.hitFlash = Math.max(0, base.hitFlash - dt * 4.5);
    }
    for (const s of G.soldiers) {
      if (s.dead || !inFriendlyBase(s)) continue;
      if (s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + BASE_HEAL_PER_SEC * dt);
      if (s.armor < s.maxArmor) s.armor = Math.min(s.maxArmor, s.armor + 18 * dt);
      if (s.shield < s.maxShield) s.shield = Math.min(s.maxShield, s.shield + 24 * dt);
      const w = WEAPONS[s.weapon];
      const maxGrenades = s.maxGrenades || 3;
      const needsSupply = (!w.melee && s.ammo < w.mag) || s.grenades < maxGrenades;
      if (needsSupply && t - s.lastBaseSupplyAt >= 3000) {
        if (!w.melee) s.ammo = w.mag;
        s.grenades = maxGrenades; s.reloading = false; s.lastBaseSupplyAt = t;
        if (s.id === G.localId) { Audio.heal(); banner("基地で弾薬・グレネードを補給"); }
      }
    }
    for (const dog of G.dogs) {
      if (!dog.dead && inFriendlyBase(dog) && dog.hp < dog.maxHp) dog.hp = Math.min(dog.maxHp, dog.hp + BASE_HEAL_PER_SEC * dt);
    }
    for (const tank of G.tanks) {
      if (!tank.dead && inFriendlyBase(tank) && tank.hp < tank.maxHp) tank.hp = Math.min(tank.maxHp, tank.hp + BASE_REPAIR_PER_SEC * dt);
    }
  }

  let lastFootstepAudioAt = 0;
  function updateFootsteps(dt, t) {
    for (let i = G.soundPings.length - 1; i >= 0; i--) {
      const ping = G.soundPings[i];
      ping.life -= dt * 1000;
      if (ping.life <= 0) G.soundPings.splice(i, 1);
    }
    const me = localSoldier();
    if (!me || me.dead) return;
    for (const enemy of G.soldiers) {
      if (enemy.dead || enemy.vehicleId >= 0 || enemy.team === me.team || !enemy.moving) continue;
      const loud = enemy.noiseRadius || 430;
      const interval = loud > 500 ? 280 : 440;
      if (t - (enemy.lastFootstepAt || -99999) < interval) continue;
      enemy.lastFootstepAt = t;
      const d2v = dist2(me.x, me.y, enemy.x, enemy.y);
      if (d2v > loud ** 2) continue;
      enemy.heardUntil = t + 1050;
      G.soundPings.push({ x: enemy.x, y: enemy.y, team: enemy.team, life: 1050, maxLife: 1050, loud });
      if (G.soundPings.length > 20) G.soundPings.shift();
      if (t - lastFootstepAudioAt > 170) {
        lastFootstepAudioAt = t;
        Audio.footstep(1 - Math.sqrt(d2v) / loud * 0.7);
      }
    }
  }

  // ============================================================
  //  シミュレーション (host / sp)
  // ============================================================
  function simulate(dt, t) {
    // ローカルプレイヤー入力反映
    const me = localSoldier();
    if (me && !me.dead) {
      applyLocalToSoldier(me, localInput, t);
    }
    // 各クライアントの入力反映 (host)
    if (mode === "host") {
      for (const s of G.soldiers) {
        if (s.controller && s.controller !== "cpu" && s.controller !== "local" && !s.dead) {
          const inp = Net.clientInputs[s.controller];
          if (inp) applyLocalToSoldier(s, inp, t);
        }
      }
    }
    // AI
    for (const s of G.soldiers) {
      if (s.dead) continue;
      const human = s.controller === "local" || (s.controller && s.controller !== "cpu");
      if (!human) updateAI(s, t, dt);
    }
    updateTanks(dt, t);
    updateDogs(dt, t);
    updateFootsteps(dt, t);
    // リロード完了
    for (const s of G.soldiers) {
      if (s.reloading && t >= s.reloadUntil) {
        s.reloading = false;
        s.ammo = WEAPONS[s.weapon].mag;
      }
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 4);
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 26);
      if (s.dead && t >= s.respawnAt) respawn(s);
    }
    // 弾
    updateBullets(dt);
    updateGrenades(dt, t);
    updateHealthRecovery(dt, t);
    updateMedkits(t);
    updateBases(dt, t);
    // バレル爆発処理
    for (let i = G.obstacles.length - 1; i >= 0; i--) {
      const o = G.obstacles[i];
      if (o.type === "barrel" && o.hp <= 0) {
        explodeBarrel(o);
        G.obstacles.splice(i, 1);
      }
    }
    updateParticles(dt);
  }

  function applyLocalToSoldier(s, inp, t) {
    if (inp.interactEdge) { enterOrExitTank(s); inp.interactEdge = false; }
    if (s.vehicleId >= 0) {
      const tank = G.tanks.find((x) => x.id === s.vehicleId && !x.dead);
      if (tank) { applyTankInput(tank, s, inp, t); return; }
      s.vehicleId = -1;
    }
    if (inp.parryEdge) {
      if (s.shield > 0 && t >= s.parryCooldownUntil && t >= s.stunnedUntil) {
        s.parryUntil = t + 240;
        s.parryCooldownUntil = t + 950;
      }
      inp.parryEdge = false;
    }
    s.shieldRaised = !!inp.shield && s.shield > 0 && t >= s.stunnedUntil;
    if (s.shieldRaised) s.reloading = false;
    // 武器変更
    if (inp.weaponWanted != null && inp.weaponWanted >= 0 && inp.weaponWanted !== s.weapon) {
      if (s.allWeapons || s.weapon === inp.weaponWanted) {
        const oldWeapon = WEAPONS[s.weapon];
        s.weapon = inp.weaponWanted;
        const newWeapon = WEAPONS[s.weapon];
        if (newWeapon.melee) s.ammo = 1;
        else if (oldWeapon.melee) s.ammo = newWeapon.mag;
        else s.ammo = Math.min(s.ammo, newWeapon.mag);
        if (s.ammo <= 0) s.ammo = WEAPONS[s.weapon].mag;
        s.reloading = false;
      }
      inp.weaponWanted = -1;
    }
    s.aimAngle = inp.aimAngle != null ? inp.aimAngle : Math.atan2(inp.aimy, inp.aimx);
    if (inp.reloadEdge) { startReload(s, t); inp.reloadEdge = false; }
    if (inp.grenadeEdge) { tryThrowGrenade(s, t); inp.grenadeEdge = false; }
    if (inp.shoot) tryShoot(s, t);
    applyMove(s, inp.mvx, inp.mvy, dtGlobal, inp.dash && !s.shieldRaised);
  }

  let dtGlobal = 0;

  function updateBullets(dt) {
    const bs = G.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      const stepX = b.vx * dt, stepY = b.vy * dt;
      b.x += stepX; b.y += stepY;
      b.traveled += Math.hypot(stepX, stepY);
      let dead = false;
      if (b.traveled > b.range || b.x < 0 || b.y < 0 || b.x > WORLD_W || b.y > WORLD_H) {
        if (b.kind === "shell" && b.x >= 0 && b.y >= 0 && b.x <= WORLD_W && b.y <= WORLD_H) explodeProjectile(b);
        dead = true;
      }
      if (!dead) {
        // 障害物
        for (const o of G.obstacles) {
          if (b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y && b.y <= o.y + o.h) {
            if (o.type === "barrel") { o.hp -= b.dmg; }
            if (b.kind === "shell") explodeProjectile(b);
            else addParticle(b.x, b.y, { kind: "spark", vx: -b.vx * 0.05 + rand(-30, 30), vy: -b.vy * 0.05 + rand(-30, 30), life: 160, size: 2.4 });
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 敵基地の司令区画
        for (const base of G.bases) {
          if (base.team === b.team || base.hp <= 0) continue;
          if (dist2(b.x, b.y, base.x, base.y) < BASE_CORE_R ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageBase(base, b.dmg * 0.72, attacker, b.team);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-90, 90), vy: rand(-90, 90), life: 220, size: 3.2 });
            }
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        // 戦車
        for (const tank of G.tanks) {
          if (tank.dead || tank.team === b.team) continue;
          if (dist2(b.x, b.y, tank.x, tank.y) < (TANK_R + 4) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageTank(tank, b.dmg * 0.55, attacker);
              addParticle(b.x, b.y, { kind: "spark", vx: rand(-80, 80), vy: rand(-80, 80), life: 220, size: 3.2 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 軍用犬
        for (const dog of G.dogs) {
          if (dog.dead || dog.team === b.team) continue;
          if (dist2(b.x, b.y, dog.x, dog.y) < (DOG_R + 3) ** 2) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") explodeProjectile(b);
            else {
              damageDog(dog, b.dmg, attacker);
              addParticle(b.x, b.y, { kind: "dust", vx: rand(-80, 80), vy: rand(-80, 80), life: 230, size: 3 });
            }
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 兵士
        for (const s of G.soldiers) {
          if (s.dead || s.vehicleId >= 0 || s.team === b.team || s.id === b.owner) continue;
          if (dist2(b.x, b.y, s.x, s.y) < (SOLDIER_R + 2) * (SOLDIER_R + 2)) {
            const attacker = projectileAttacker(b);
            if (b.kind === "shell") {
              explodeProjectile(b);
            } else {
              const result = damageSoldier(s, b.dmg, attacker, { x: b.x - b.vx * 0.04, y: b.y - b.vy * 0.04, type: "bullet" });
              if (result === "parried") {
                b.vx *= -1; b.vy *= -1; b.team = s.team; b.owner = s.id; b.tankOwner = null;
                b.dmg *= 0.85; b.pierce = 0; b.traveled = 0; b.range = Math.min(b.range, 760);
                b.x += b.vx * 0.018; b.y += b.vy * 0.018;
              } else {
                for (let k = 0; k < 5; k++) {
                  const a = Math.atan2(b.vy, b.vx) + rand(-0.7, 0.7);
                  addParticle(b.x, b.y, { kind: "blood", vx: Math.cos(a) * rand(40, 160), vy: Math.sin(a) * rand(40, 160), life: rand(250, 550), size: rand(1.5, 3.5) });
                }
                if (b.pierce > 0) { b.pierce--; b.dmg *= 0.7; }
                else { dead = true; }
              }
            }
            if (b.kind === "shell") dead = true;
            break;
          }
        }
      }
      if (dead) bs.splice(i, 1);
    }
  }

  // ============================================================
  //  レンダリング
  // ============================================================
  let dpr = 1;
  function viewW() { return canvas.clientWidth; }
  function viewH() { return canvas.clientHeight; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  window.addEventListener("resize", resize);

  function updateCamera() {
    const me = localSoldier();
    let tx, ty;
    if (me) { tx = me.x - viewW() / 2; ty = me.y - viewH() / 2; }
    else { tx = WORLD_W / 2 - viewW() / 2; ty = WORLD_H / 2 - viewH() / 2; }
    camX = clamp(tx, 0, Math.max(0, WORLD_W - viewW()));
    camY = clamp(ty, 0, Math.max(0, WORLD_H - viewH()));
  }

  function render() {
    const vw = viewW(), vh = viewH();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 背景
    ctx.fillStyle = "#3a4a26";
    ctx.fillRect(0, 0, vw, vh);

    let sx = 0, sy = 0;
    if (shake > 0.2) { sx = rand(-shake, shake); sy = rand(-shake, shake); }
    ctx.save();
    ctx.translate(-camX + sx, -camY + sy);

    drawGround(vw, vh);
    drawBases();
    // 影 → 車両 → 兵士 → 投擲物/弾 → パーティクル
    drawStains();
    drawObstaclesBack();
    drawPickups();
    for (const tank of G.tanks) if (!tank.dead && isEntityVisible(tank)) drawTankShadow(tank);
    for (const dog of G.dogs) if (!dog.dead && isEntityVisible(dog)) drawDogShadow(dog);
    for (const s of G.soldiers) if (!s.dead && s.vehicleId < 0 && isEntityVisible(s)) drawSoldierShadow(s);
    drawParticlesUnder();
    for (const tank of G.tanks) if (!tank.dead && isEntityVisible(tank)) drawTank(tank);
    for (const dog of G.dogs) if (!dog.dead && isEntityVisible(dog)) drawDog(dog);
    for (const s of G.soldiers) if (!s.dead && s.vehicleId < 0 && isEntityVisible(s)) drawSoldier(s);
    drawGrenades();
    drawBullets();
    drawParticlesOver();
    drawFootstepPings();
    drawNameTags();

    ctx.restore();

    if (shake > 0) shake = Math.max(0, shake - 0.6);
    drawVisionMask(vw, vh);
    drawFootstepIndicators(vw, vh);
    drawMinimap();
    updateHUD();
  }

  function drawGround(vw, vh) {
    // タイル状の地面テクスチャ(カメラ範囲のみ)
    const TS = 64;
    const x0 = Math.floor(camX / TS) * TS, y0 = Math.floor(camY / TS) * TS;
    for (let x = x0; x < camX + vw + TS; x += TS) {
      for (let y = y0; y < camY + vh + TS; y += TS) {
        const k = ((x / TS) * 7 + (y / TS) * 13) % 5;
        ctx.fillStyle = k < 2 ? "#3c4d28" : k < 4 ? "#41522b" : "#374524";
        ctx.fillRect(x, y, TS, TS);
      }
    }
    // スポーンゾーンの色付け
    ctx.fillStyle = "rgba(78,163,255,0.06)";
    ctx.fillRect(0, WORLD_H - 380, 400, 380);
    ctx.fillStyle = "rgba(255,90,78,0.06)";
    ctx.fillRect(WORLD_W - 400, 0, 400, 380);
  }

  function drawBases() {
    for (const base of G.bases) {
      const ally = base.team === TEAM_ALLY;
      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.fillStyle = ally ? "rgba(55,115,155,0.22)" : "rgba(150,65,48,0.22)";
      ctx.strokeStyle = ally ? "rgba(105,190,235,0.62)" : "rgba(245,110,82,0.62)";
      ctx.lineWidth = 4; ctx.setLineDash([15, 10]);
      ctx.beginPath(); ctx.arc(0, 0, base.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      // 司令区画と補給パッド
      ctx.rotate(base.heading);
      ctx.fillStyle = base.hitFlash > 0 ? "#fff0bd" : ally ? "#385b64" : "#70423a";
      ctx.fillRect(-72, -48, 110, 96);
      ctx.fillStyle = base.hitFlash > 0 ? "#ffc26f" : ally ? "#527c82" : "#925648";
      ctx.beginPath(); ctx.moveTo(-78, -53); ctx.lineTo(44, -53); ctx.lineTo(58, 0); ctx.lineTo(44, 53); ctx.lineTo(-78, 53); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = "rgba(15,20,14,0.7)"; ctx.fillRect(-58, -19, 34, 38);
      ctx.restore();

      // 軍旗
      ctx.strokeStyle = "#d5d2b0"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(base.x + 55, base.y - 18); ctx.lineTo(base.x + 55, base.y - 88); ctx.stroke();
      ctx.fillStyle = ally ? "#4ea3ff" : "#ff5a4e";
      ctx.beginPath(); ctx.moveTo(base.x + 57, base.y - 86); ctx.lineTo(base.x + 112, base.y - 73); ctx.lineTo(base.x + 57, base.y - 56); ctx.closePath(); ctx.fill();
      ctx.font = "bold 14px -apple-system, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.75)";
      const label = `${G.armyNames[base.team]} 基地`;
      ctx.strokeText(label, base.x, base.y + base.r - 18); ctx.fillStyle = ally ? "#bfe4ff" : "#ffd0c8"; ctx.fillText(label, base.x, base.y + base.r - 18);
      const bw = 164, bh = 9, by = base.y + base.r - 4;
      const ratio = clamp(base.hp / base.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.72)"; ctx.fillRect(base.x - bw / 2 - 2, by - 2, bw + 4, bh + 4);
      ctx.fillStyle = ally ? "#4ea3ff" : "#ff5a4e"; ctx.fillRect(base.x - bw / 2, by, bw * ratio, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.strokeRect(base.x - bw / 2, by, bw, bh);
      ctx.font = "bold 9px -apple-system, sans-serif"; ctx.fillStyle = "#fff";
      ctx.fillText(`${Math.ceil(base.hp)} / ${base.maxHp}`, base.x, by + 5);
    }
  }

  function currentVisionRadius() {
    const me = localSoldier();
    const shortSide = Math.min(viewW(), viewH());
    if (me && me.vehicleId >= 0) return Math.min(TANK_VISION_R, Math.max(300, shortSide * 0.78));
    return Math.min(PLAYER_VISION_R, Math.max(210, shortSide * 0.6));
  }

  function isEntityVisible(entity) {
    const me = localSoldier();
    if (!me || entity.team === me.team) return true;
    const bonus = entity.kind === "tank" ? 65 : 0;
    const r = currentVisionRadius() + bonus;
    return dist2(me.x, me.y, entity.x, entity.y) < r ** 2 && lineClear(me.x, me.y, entity.x, entity.y);
  }

  function drawStains() {
    for (const p of G.particles) {
      if (p.kind !== "stain") continue;
      const a = clamp(p.life / p.maxLife, 0, 1) * 0.5;
      ctx.fillStyle = `rgba(110,12,12,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.283);
      ctx.fill();
    }
  }

  function drawObstaclesBack() {
    for (const o of G.obstacles) drawObstacle(o);
  }

  function drawPickups() {
    const t = now() * 0.003;
    for (const kit of G.pickups) {
      if (!kit.active) continue;
      const bob = Math.sin(t + kit.phase) * 2;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(kit.x + 2, kit.y + 8, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(kit.x, kit.y + bob);
      if (kit.kind === "medkit") {
        ctx.fillStyle = "#d9ead9"; ctx.strokeStyle = "#2b6638"; ctx.lineWidth = 2;
        ctx.fillRect(-14, -11, 28, 22); ctx.strokeRect(-14, -11, 28, 22);
        ctx.fillStyle = "#39a957"; ctx.fillRect(-3, -8, 6, 16); ctx.fillRect(-8, -3, 16, 6);
      } else if (kit.kind === "armor") {
        ctx.fillStyle = "#376fa6"; ctx.strokeStyle = "#a8d4ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-3, -8); ctx.lineTo(3, -8); ctx.lineTo(12, -12);
        ctx.lineTo(14, 9); ctx.lineTo(5, 13); ctx.lineTo(-5, 13); ctx.lineTo(-14, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(-2, -7, 4, 17);
      } else {
        ctx.fillStyle = "#45bfc4"; ctx.strokeStyle = "#c9fff8"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(13, -8); ctx.lineTo(10, 8); ctx.quadraticCurveTo(0, 17, -10, 8); ctx.lineTo(-13, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillRect(-2, -9, 4, 17);
      }
      ctx.restore();
    }
  }

  function drawObstacle(o) {
    if (o.type === "wall") {
      ctx.fillStyle = "#4a4640";
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(o.x, o.y + o.h - 6, o.w, 6);
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    } else if (o.type === "crate") {
      ctx.fillStyle = "#8a5a2b"; ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "#5e3c1c"; ctx.lineWidth = 3;
      ctx.strokeRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4);
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y + o.h);
      ctx.moveTo(o.x + o.w, o.y); ctx.lineTo(o.x, o.y + o.h); ctx.stroke();
    } else if (o.type === "sandbag") {
      ctx.fillStyle = "#6f6a44";
      const n = Math.max(2, Math.round(o.w / 24));
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 ? "#7a754d" : "#67623f";
        ctx.beginPath();
        ctx.ellipse(o.x + (i + 0.5) * (o.w / n), o.y + o.h / 2, o.w / n / 2 + 1, o.h / 2, 0, 0, 6.283);
        ctx.fill();
      }
    } else if (o.type === "rock") {
      ctx.fillStyle = "#6b6f72";
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h * 0.62, o.w / 2.4, o.h / 3, 0, 0, 6.283);
      ctx.fill();
    } else if (o.type === "barrel") {
      ctx.fillStyle = "#b03a2e";
      ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, (o.r || 15), 0, 6.283); ctx.fill();
      ctx.strokeStyle = "#2c2c2c"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, (o.r || 15) - 4, 0, 6.283); ctx.stroke();
      ctx.fillStyle = "#ffd23f"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("⚠", o.x + o.w / 2, o.y + o.h / 2 + 1);
    }
  }

  function teamColors(s) {
    if (s.id === G.localId) return { u: COL.youUniform, a: COL.youAccent };
    if (s.team === TEAM_ALLY) return { u: COL.allyUniform, a: COL.allyAccent };
    return { u: COL.enemyUniform, a: COL.enemyAccent };
  }

  function drawSoldierShadow(s) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(s.x + 3, s.y + 5, SOLDIER_R + 3, SOLDIER_R - 1, 0, 0, 6.283);
    ctx.fill();
  }

  function drawDogShadow(dog) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(dog.x + 3, dog.y + 5, 18, 9, dog.angle, 0, Math.PI * 2); ctx.fill();
  }

  function drawDog(dog) {
    const harness = dog.team === TEAM_ALLY ? "#4f9ed7" : "#d85445";
    const fur = dog.team === TEAM_ALLY ? "#554536" : "#49362f";
    const bite = now() - dog.biteAt < 170;
    ctx.save();
    ctx.translate(dog.x, dog.y); ctx.rotate(dog.angle);
    // 尾と脚
    ctx.strokeStyle = fur; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(-24, -8, -27, -2); ctx.stroke();
    ctx.fillStyle = "#302a25";
    const stride = dog.moving ? Math.sin(now() * 0.018) * 4 : 0;
    ctx.fillRect(-9 + stride, -10, 5, 9); ctx.fillRect(5 - stride, -10, 5, 9);
    ctx.fillRect(-9 - stride, 2, 5, 9); ctx.fillRect(5 + stride, 2, 5, 9);
    // 胴体とハーネス
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(-1, 0, 17, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = harness; ctx.fillRect(-5, -10, 8, 20);
    ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("K9", -1, 0);
    // 頭・耳・口
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(15, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2c2420";
    ctx.beginPath(); ctx.moveTo(10, -6); ctx.lineTo(8, -15); ctx.lineTo(17, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(8, 15); ctx.lineTo(17, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = bite ? "#d9d7c8" : "#241d19";
    ctx.beginPath(); ctx.ellipse(23, 0, bite ? 8 : 5, bite ? 5 : 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e8d7b9"; ctx.beginPath(); ctx.arc(17, -3, 1.4, 0, Math.PI * 2); ctx.fill();
    if (dog.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${dog.hitFlash * 0.65})`;
      ctx.beginPath(); ctx.ellipse(0, 0, 23, 14, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawTankShadow(tank) {
    ctx.save();
    ctx.translate(tank.x + 5, tank.y + 8);
    ctx.rotate(tank.angle);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fillRect(-37, -27, 74, 54);
    ctx.restore();
  }

  function drawTank(tank) {
    const ally = tank.team === TEAM_ALLY;
    const body = ally ? "#365c66" : "#713e35";
    const light = ally ? "#588a91" : "#9a5b48";
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);
    // キャタピラ
    ctx.fillStyle = "#242720";
    ctx.fillRect(-38, -29, 76, 14);
    ctx.fillRect(-38, 15, 76, 14);
    ctx.strokeStyle = "#55594b"; ctx.lineWidth = 2;
    for (let x = -31; x <= 31; x += 14) {
      ctx.beginPath(); ctx.moveTo(x, -28); ctx.lineTo(x, -16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, 28); ctx.stroke();
    }
    // 車体
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-31, -20); ctx.lineTo(25, -20); ctx.lineTo(35, -12);
    ctx.lineTo(35, 12); ctx.lineTo(25, 20); ctx.lineTo(-31, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = light; ctx.fillRect(-25, -15, 28, 30);
    ctx.restore();

    // 砲塔は照準方向へ独立回転
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.turretAngle);
    ctx.fillStyle = "#262820";
    ctx.fillRect(4, -5, 51, 10);
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(1, 0, 22, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(1, 0, 12, 0, Math.PI * 2); ctx.fill();
    if (now() - tank.muzzle < 90) {
      ctx.fillStyle = "rgba(255,220,120,0.96)";
      ctx.beginPath(); ctx.moveTo(53, 0); ctx.lineTo(70, -9); ctx.lineTo(79, 0); ctx.lineTo(70, 9); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawSoldier(s) {
    const c = teamColors(s);
    const a = s.aimAngle;
    ctx.save();
    ctx.translate(s.x, s.y);
    // 脚 (歩行)
    const legSwing = s.moving ? Math.sin(s.legPhase) * 5 : 0;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = "#2a2a22";
    ctx.fillRect(-4, -10 - legSwing * 0.3, 9, 6);
    ctx.fillRect(-4, 4 + legSwing * 0.3, 9, 6);
    ctx.restore();
    // 胴 (照準方向に回転)
    ctx.rotate(a);
    const recoilBack = s.recoil * 0.6;
    // 胴体(ベスト)
    ctx.fillStyle = c.u;
    ctx.beginPath();
    ctx.ellipse(-recoilBack, 0, SOLDIER_R - 1, SOLDIER_R + 1, 0, 0, 6.283);
    ctx.fill();
    // ベスト中央ライン
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-recoilBack - 2, -SOLDIER_R, 4, SOLDIER_R * 2);
    // 防弾鎧プレート
    if (s.armor > 0) {
      const ar = clamp(s.armor / s.maxArmor, 0, 1);
      ctx.fillStyle = `rgba(126,165,194,${0.35 + ar * 0.45})`;
      ctx.fillRect(-10 - recoilBack, -12, 13, 8); ctx.fillRect(-10 - recoilBack, 4, 13, 8);
      ctx.strokeStyle = "rgba(220,238,248,0.42)"; ctx.lineWidth = 1; ctx.strokeRect(-10 - recoilBack, -12, 13, 24);
    }
    // 武器
    const w = WEAPONS[s.weapon];
    if (s.shieldRaised && s.shield > 0) {
      const sr = clamp(s.shield / s.maxShield, 0, 1);
      const parrying = s.parryUntil > 0 && now() <= s.parryUntil;
      ctx.fillStyle = parrying ? "rgba(255,226,112,0.94)" : `rgba(58,139,154,${0.72 + sr * 0.18})`;
      ctx.strokeStyle = parrying ? "#fff8bd" : "#b8f3ed"; ctx.lineWidth = parrying ? 5 : 2.5;
      ctx.beginPath(); ctx.moveTo(16, -19); ctx.quadraticCurveTo(28, -16, 29, 0); ctx.quadraticCurveTo(28, 16, 16, 19);
      ctx.lineTo(12, 12); ctx.lineTo(12, -12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(220,255,250,0.42)"; ctx.fillRect(17, -11, 7, 8);
      ctx.fillStyle = "#caa06b"; ctx.beginPath(); ctx.arc(12, -8, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, 8, 3.4, 0, Math.PI * 2); ctx.fill();
    } else if (w.melee) {
      const attackAge = now() - s.muzzle;
      const swing = attackAge < 180 ? -0.95 + (attackAge / 180) * 1.9 : 0;
      ctx.save();
      ctx.translate(SOLDIER_R - 4 - recoilBack, 0); ctx.rotate(swing);
      ctx.fillStyle = "#5b3a22"; ctx.fillRect(-2, -3, 9, 6);
      ctx.fillStyle = "#dfe5e7";
      ctx.beginPath(); ctx.moveTo(7, -4); ctx.lineTo(25, 0); ctx.lineTo(7, 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#727b7e"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#caa06b"; ctx.beginPath(); ctx.arc(1, 1, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = "#23231f";
      ctx.fillRect(SOLDIER_R - 4 - recoilBack, -3, w.len, 5);
      if (w.key === "sniper") ctx.fillRect(SOLDIER_R + 2 - recoilBack, -5, 8, 3);
      // 手
      ctx.fillStyle = "#caa06b";
      ctx.beginPath(); ctx.arc(SOLDIER_R - 2 - recoilBack, 2, 3.4, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(SOLDIER_R + w.len * 0.55 - recoilBack, 1, 3.2, 0, 6.283); ctx.fill();
    }
    // 頭(ヘルメット)
    ctx.fillStyle = c.a;
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.arc(2, 0, 8.5, -0.9, 0.9); ctx.fill();
    // マズルフラッシュ
    if (!s.shieldRaised && !w.melee && now() - s.muzzle < 55) {
      const ml = SOLDIER_R + w.len - recoilBack;
      ctx.fillStyle = "rgba(255,220,120,0.95)";
      ctx.beginPath();
      ctx.moveTo(ml, 0);
      ctx.lineTo(ml + 13, -6);
      ctx.lineTo(ml + 20, 0);
      ctx.lineTo(ml + 13, 6);
      ctx.closePath(); ctx.fill();
    }
    // 被弾フラッシュ
    if (s.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${s.hitFlash * 0.6})`;
      ctx.beginPath(); ctx.arc(0, 0, SOLDIER_R + 2, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  function drawBullets() {
    ctx.lineCap = "round";
    for (const b of G.bullets) {
      if (b.kind === "shell") {
        ctx.fillStyle = "#ffb83e";
        ctx.strokeStyle = "rgba(255,238,170,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        continue;
      }
      const m = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / m, uy = b.vy / m;
      const len = b.len;
      ctx.strokeStyle = b.col;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * len, b.y - uy * len);
      ctx.stroke();
    }
  }

  function drawGrenades() {
    const t = now();
    for (const g of G.grenades) {
      const progress = clamp((t - g.bornAt) / GRENADE_FUSE_MS, 0, 1);
      const lift = Math.sin(progress * Math.PI) * 18;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(g.x + 2, g.y + 3, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(g.x, g.y - lift); ctx.rotate(g.rotation);
      ctx.fillStyle = Math.floor((g.fuseAt - t) / 140) % 2 === 0 ? "#d9e56a" : "#3e4b2e";
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b7a159"; ctx.fillRect(-2, -9, 4, 5);
      ctx.restore();
    }
  }

  function drawParticlesUnder() {
    for (const p of G.particles) {
      if (p.kind === "casing") {
        ctx.fillStyle = "#d8b24a";
        ctx.fillRect(p.x - 1, p.y - 1, 2.4, 2.4);
      }
    }
  }

  function drawParticlesOver() {
    for (const p of G.particles) {
      const lr = clamp(p.life / p.maxLife, 0, 1);
      if (p.kind === "blood") {
        ctx.fillStyle = `rgba(150,15,15,${lr})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
      } else if (p.kind === "spark") {
        ctx.fillStyle = `rgba(255,${180 + Math.random() * 60 | 0},80,${lr})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === "smoke") {
        ctx.fillStyle = `rgba(60,60,60,${lr * 0.5})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - lr), 0, 6.283); ctx.fill();
      } else if (p.kind === "flash") {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = `rgba(255,225,140,${lr})`;
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 6.283); ctx.fill();
        ctx.restore();
      } else if (p.kind === "boom") {
        ctx.fillStyle = `rgba(255,${(120 + lr * 120) | 0},40,${lr})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, (1 - lr) * 110 + 10, 0, 6.283); ctx.fill();
      } else if (p.kind === "slash") {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(235,245,255,${lr})`; ctx.lineWidth = 4 * lr + 1;
        ctx.beginPath(); ctx.arc(0, 0, p.size, -0.95, 0.95); ctx.stroke();
        ctx.restore();
      } else if (p.kind === "heal") {
        ctx.fillStyle = `rgba(115,245,145,${lr})`;
        ctx.fillRect(p.x - 1.5, p.y - p.size / 2, 3, p.size);
        ctx.fillRect(p.x - p.size / 2, p.y - 1.5, p.size, 3);
      } else if (p.kind === "dust") {
        ctx.fillStyle = `rgba(145,120,88,${lr * 0.7})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.5 - lr * 0.4), 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "bite") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(255,235,205,${lr})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, p.size, -0.7, 0.7); ctx.stroke(); ctx.restore();
      } else if (p.kind === "shieldHit") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(145,255,246,${lr})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1.35 - lr * 0.35), -1.05, 1.05); ctx.stroke(); ctx.restore();
      } else if (p.kind === "armorHit") {
        ctx.strokeStyle = `rgba(145,195,235,${lr})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x - p.size * lr, p.y); ctx.lineTo(p.x + p.size * lr, p.y); ctx.stroke();
      } else if (p.kind === "equip") {
        ctx.fillStyle = p.a > 0.5 ? `rgba(105,245,235,${lr})` : `rgba(105,175,245,${lr})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === "parry") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = `rgba(255,241,145,${lr})`; ctx.lineWidth = 6 * lr + 1;
        ctx.beginPath(); ctx.arc(0, 0, p.size * (1.7 - lr * 0.7), -1.2, 1.2); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,220,${lr})`;
        for (let i = -1; i <= 1; i++) ctx.fillRect(8 + (1 - lr) * 18, i * 10 - 2, 10, 4);
        ctx.restore();
      } else if (p.kind === "stun") {
        ctx.fillStyle = `rgba(255,225,90,${lr})`;
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3 + (1 - lr) * 4;
          ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * p.size, p.y + Math.sin(a) * 4, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  function drawFootstepPings() {
    for (const ping of G.soundPings) {
      const lr = clamp(ping.life / ping.maxLife, 0, 1);
      const radius = 12 + (1 - lr) * 54;
      ctx.strokeStyle = `rgba(255,184,74,${lr * 0.9})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ping.x, ping.y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,210,120,${lr})`;
      ctx.beginPath(); ctx.ellipse(ping.x - 4, ping.y - 2, 3, 6, -0.35, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ping.x + 5, ping.y + 3, 3, 6, -0.35, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawVisionMask(vw, vh) {
    const me = localSoldier();
    if (!me) return;
    const px = me.x - camX, py = me.y - camY;
    const radius = me.dead ? 115 : currentVisionRadius();
    ctx.save();
    ctx.fillStyle = "rgba(3,6,2,0.83)";
    ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.arc(px, py, radius, 0, Math.PI * 2, true); ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(3,6,2,0.32)"; ctx.lineWidth = 76;
    ctx.beginPath(); ctx.arc(px, py, Math.max(30, radius - 38), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawFootstepIndicators(vw, vh) {
    const me = localSoldier();
    if (!me || me.dead) return;
    const px = me.x - camX, py = me.y - camY;
    const sight = currentVisionRadius();
    for (const ping of G.soundPings) {
      const dx = ping.x - me.x, dy = ping.y - me.y, d = Math.hypot(dx, dy) || 1;
      if (d < sight * 0.82) continue;
      const r = Math.min(sight - 28, Math.min(vw, vh) * 0.42);
      const x = clamp(px + dx / d * r, 24, vw - 24);
      const y = clamp(py + dy / d * r, 50, vh - 24);
      const lr = clamp(ping.life / ping.maxLife, 0, 1);
      ctx.fillStyle = `rgba(255,171,55,${0.45 + lr * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#241704"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", x, y + 1);
    }
  }

  function drawNameTags() {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || !isEntityVisible(s)) continue;
      const c = teamColors(s);
      const tx = s.x, ty = s.y - SOLDIER_R - 16;
      // HPバー
      const bw = 38, bh = 4;
      const ratio = clamp(s.hp / s.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, bh + 2);
      ctx.fillStyle = s.team === TEAM_ALLY ? "#46d36a" : "#ff5a4e";
      ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, bh);
      // 名前 + Lv
      ctx.font = "bold 12px -apple-system, sans-serif";
      const label = (s.id === G.localId ? "▼ " : "") + s.name + " " + "Lv" + s.level;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = s.id === G.localId ? COL.youAccent : (s.team === TEAM_ALLY ? "#cfe2ff" : "#ffd0c8");
      ctx.fillText(label, tx, ty);
    }
    for (const dog of G.dogs) {
      if (dog.dead || !isEntityVisible(dog)) continue;
      const tx = dog.x, ty = dog.y - DOG_R - 14;
      const bw = 31, ratio = clamp(dog.hp / dog.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.58)"; ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, 6);
      ctx.fillStyle = dog.team === TEAM_ALLY ? "#55c879" : "#ee6a55"; ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, 4);
      ctx.font = "bold 10px -apple-system, sans-serif";
      const label = `K9 ${dog.name}`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = dog.team === TEAM_ALLY ? "#d7ecff" : "#ffd5cb"; ctx.fillText(label, tx, ty);
    }
    for (const tank of G.tanks) {
      if (tank.dead || !isEntityVisible(tank)) continue;
      const driver = G.soldiers.find((s) => s.id === tank.driverId);
      const tx = tank.x, ty = tank.y - TANK_R - 18;
      const bw = 58, ratio = clamp(tank.hp / tank.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(tx - bw / 2 - 1, ty + 3, bw + 2, 7);
      ctx.fillStyle = tank.team === TEAM_ALLY ? "#65c2d0" : "#ef745e"; ctx.fillRect(tx - bw / 2, ty + 4, bw * ratio, 5);
      ctx.font = "bold 12px -apple-system, sans-serif";
      const label = driver ? `▣ ${driver.name}の戦車` : `▣ ${tank.name}`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.82)"; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = tank.team === TEAM_ALLY ? "#bfeeff" : "#ffd0c8"; ctx.fillText(label, tx, ty);
    }
  }

  function drawMinimap() {
    const mw = mini.width, mh = mini.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "rgba(20,26,14,0.85)";
    mctx.fillRect(0, 0, mw, mh);
    const sx = mw / WORLD_W, sy = mh / WORLD_H;
    for (const base of G.bases) {
      mctx.strokeStyle = base.team === TEAM_ALLY ? "rgba(78,163,255,0.8)" : "rgba(255,90,78,0.8)";
      mctx.lineWidth = 1.5; mctx.strokeRect(base.x * sx - 5, base.y * sy - 5, 10, 10);
    }
    // 障害物
    mctx.fillStyle = "rgba(255,255,255,0.22)";
    for (const o of G.obstacles) {
      if (o.type === "wall") mctx.fillRect(o.x * sx, o.y * sy, Math.max(1, o.w * sx), Math.max(1, o.h * sy));
    }
    for (const kit of G.pickups) {
      if (!kit.active) continue;
      mctx.fillStyle = kit.kind === "medkit" ? "#62df7a" : kit.kind === "armor" ? "#65aaf0" : "#74e9e2";
      mctx.fillRect(kit.x * sx - 1, kit.y * sy - 1, 2, 2);
    }
    // 兵士
    for (const s of G.soldiers) {
      if (s.dead || s.vehicleId >= 0 || !isEntityVisible(s)) continue;
      mctx.fillStyle = s.id === G.localId ? "#ffd23f" : (s.team === TEAM_ALLY ? "#4ea3ff" : "#ff5a4e");
      const r = s.id === G.localId ? 3 : 2;
      mctx.beginPath(); mctx.arc(s.x * sx, s.y * sy, r, 0, 6.283); mctx.fill();
    }
    for (const dog of G.dogs) {
      if (dog.dead || !isEntityVisible(dog)) continue;
      mctx.fillStyle = dog.team === TEAM_ALLY ? "#8ed7ff" : "#ff9c78";
      mctx.beginPath(); mctx.arc(dog.x * sx, dog.y * sy, 1.7, 0, Math.PI * 2); mctx.fill();
    }
    for (const tank of G.tanks) {
      if (tank.dead || !isEntityVisible(tank)) continue;
      mctx.fillStyle = tank.driverId === G.localId ? "#ffd23f" : (tank.team === TEAM_ALLY ? "#65c2d0" : "#ff745f");
      mctx.fillRect(tank.x * sx - 3, tank.y * sy - 3, 6, 6);
    }
    mctx.strokeStyle = "#ffb84a"; mctx.lineWidth = 1;
    for (const ping of G.soundPings) {
      const r = 1 + (1 - ping.life / ping.maxLife) * 4;
      mctx.beginPath(); mctx.arc(ping.x * sx, ping.y * sy, r, 0, Math.PI * 2); mctx.stroke();
    }
  }

  // ============================================================
  //  HUD
  // ============================================================
  let lastFeedKey = "";
  function updateHUD() {
    const me = localSoldier();
    el.scoreAlly.textContent = G.score[TEAM_ALLY];
    el.scoreEnemy.textContent = G.score[TEAM_ENEMY];
    el.armyAlly.textContent = G.armyNames[TEAM_ALLY];
    el.armyEnemy.textContent = G.armyNames[TEAM_ENEMY];
    const allyBase = G.bases[TEAM_ALLY], enemyBase = G.bases[TEAM_ENEMY];
    if (allyBase && enemyBase) {
      el.baseAllyHp.textContent = Math.ceil(allyBase.hp);
      el.baseEnemyHp.textContent = Math.ceil(enemyBase.hp);
      el.baseAllyFill.style.transform = `scaleX(${clamp(allyBase.hp / allyBase.maxHp, 0, 1)})`;
      el.baseEnemyFill.style.transform = `scaleX(${clamp(enemyBase.hp / enemyBase.maxHp, 0, 1)})`;
    }
    if (me) {
      const tank = me.vehicleId >= 0 ? G.tanks.find((x) => x.id === me.vehicleId && !x.dead) : null;
      const active = tank || me;
      const ratio = clamp(active.hp / active.maxHp, 0, 1);
      el.hpFill.style.width = (ratio * 100) + "%";
      el.hpFill.style.background = ratio > 0.5 ? "linear-gradient(90deg,#46d36a,#8cf06a)" : ratio > 0.25 ? "linear-gradient(90deg,#e3b341,#f0d36a)" : "linear-gradient(90deg,#e3413f,#ff7a6a)";
      el.hpText.textContent = me.dead ? "復活中" : Math.max(0, Math.ceil(active.hp));
      const armorRatio = clamp((me.armor || 0) / (me.maxArmor || 100), 0, 1);
      const shieldRatio = clamp((me.shield || 0) / (me.maxShield || 160), 0, 1);
      el.armorFill.style.transform = `scaleX(${armorRatio})`;
      el.shieldFill.style.transform = `scaleX(${shieldRatio})`;
      el.armorText.textContent = Math.ceil(me.armor || 0);
      el.shieldText.textContent = Math.ceil(me.shield || 0);
      if (me.dead) el.shieldState.textContent = "装備を再支給中";
      else if (tank) el.shieldState.textContent = "装備は車内に保管";
      else if (me.shield <= 0) el.shieldState.textContent = "盾破損・基地で修理";
      else if (me.parryUntil > 0 && now() <= me.parryUntil) el.shieldState.textContent = "PARRY受付中！";
      else if (me.shieldRaised) el.shieldState.textContent = "盾展開中・正面防御";
      else if (now() < me.parryCooldownUntil) el.shieldState.textContent = `パリィ再使用 ${((me.parryCooldownUntil - now()) / 1000).toFixed(1)}秒`;
      else el.shieldState.textContent = isTouch ? "「盾」を攻撃直前に押してパリィ" : "Qを攻撃直前に押してパリィ";
      el.shieldState.classList.toggle("raised", !!me.shieldRaised || (me.parryUntil > 0 && now() <= me.parryUntil));
      const sinceHit = now() - (me.lastDamagedAt == null ? -99999 : me.lastDamagedAt);
      if (me.dead) {
        el.recovery.textContent = "";
        el.recovery.classList.remove("waiting");
      } else if (tank) {
        el.recovery.textContent = "戦車装甲";
        el.recovery.classList.remove("waiting");
      } else if (inFriendlyBase(me) && me.hp < me.maxHp - 0.05) {
        el.recovery.textContent = `基地で回復中 +${BASE_HEAL_PER_SEC}/秒`;
        el.recovery.classList.remove("waiting");
      } else if (me.hp >= me.maxHp - 0.05) {
        el.recovery.textContent = inFriendlyBase(me) ? "基地：弾薬・グレネード補給" : "体力最大";
        el.recovery.classList.remove("waiting");
      } else if (sinceHit < AUTO_HEAL_DELAY_MS) {
        el.recovery.textContent = `自動回復まで ${Math.ceil((AUTO_HEAL_DELAY_MS - sinceHit) / 1000)}秒`;
        el.recovery.classList.add("waiting");
      } else {
        el.recovery.textContent = `自動回復中 +${AUTO_HEAL_PER_SEC}/秒`;
        el.recovery.classList.remove("waiting");
      }
      el.lvText.textContent = me.level;
      el.xpFill.style.width = clamp(me.xp / (me.level * 3), 0, 1) * 100 + "%";
      if (tank) {
        const ready = now() - tank.lastShot >= 1450;
        el.wName.textContent = "戦車・120mm主砲";
        el.ammo.textContent = ready ? "READY" : "装填中";
        el.ammo.classList.toggle("low", !ready);
        el.grenade.textContent = "💣 車内では使用不可";
      } else {
        const w = WEAPONS[me.weapon];
        el.wName.textContent = w.name;
        el.ammo.textContent = w.melee ? "近接 / ∞" : (me.reloading ? "リロード" : me.ammo) + " / " + w.mag;
        el.ammo.classList.toggle("low", !w.melee && !me.reloading && me.ammo <= Math.ceil(w.mag * 0.25));
        el.grenade.textContent = `💣 グレネード × ${me.grenades == null ? 0 : me.grenades}`;
      }

      let hint = "";
      if (!me.dead && tank) hint = isTouch ? "「戦車」で降りる" : "E：戦車から降りる";
      else if (!me.dead) {
        const nearby = G.tanks.some((x) => !x.dead && x.team === me.team && x.driverId < 0 && dist2(me.x, me.y, x.x, x.y) < 78 ** 2);
        if (nearby) hint = isTouch ? "「戦車」で乗り込む" : "E：戦車に乗る";
      }
      el.vehicleHint.textContent = hint;
      el.vehicleHint.classList.toggle("hidden", !hint);
    } else {
      el.vehicleHint.classList.add("hidden");
    }
    // キルフィード
    const feedKey = G.killfeed.map((f) => `${f.t}:${f.killer || ""}:${f.victim}`).join("|");
    if (feedKey !== lastFeedKey) {
      lastFeedKey = feedKey;
      el.killfeed.innerHTML = "";
      for (const f of G.killfeed) {
        const div = document.createElement("div");
        div.className = "kf-item";
        const kc = f.killerTeam === TEAM_ALLY ? "#9fc7ff" : "#ffb0a6";
        const vc = f.victimTeam === TEAM_ALLY ? "#9fc7ff" : "#ffb0a6";
        if (f.killer) {
          div.innerHTML = `<span class="kf-killer" style="color:${kc}">${esc(f.killer)}</span> ▸ <span class="kf-victim" style="color:${vc}">${esc(f.victim)}</span>`;
        } else {
          div.innerHTML = `<span class="kf-victim" style="color:${vc}">${esc(f.victim)}</span> 戦死`;
        }
        el.killfeed.appendChild(div);
      }
    }
  }
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function showLevelup(lv) {
    el.levelup.textContent = "LEVEL UP!  Lv" + lv;
    el.levelup.classList.remove("hidden");
    el.levelup.style.animation = "none";
    void el.levelup.offsetWidth;
    el.levelup.style.animation = "";
    clearTimeout(showLevelup._t);
    showLevelup._t = setTimeout(() => el.levelup.classList.add("hidden"), 1400);
  }

  // ============================================================
  //  ゲームループ
  // ============================================================
  let lastT = 0, snapAcc = 0, inputAcc = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastT) lastT = ts;
    let dt = (ts - lastT) / 1000;
    lastT = ts;
    if (dt > 0.05) dt = 0.05;
    dtGlobal = dt;

    if (G && G.running) {
      const t = now();
      gatherLocalInput();

      if (mode === "client") {
        // 入力送信のみ。状態は受信を反映
        inputAcc += dt;
        if (inputAcc >= 1 / INPUT_HZ) {
          inputAcc = 0;
          Net.sendInput(localInput);
          localInput.reloadEdge = false; localInput.grenadeEdge = false; localInput.interactEdge = false; localInput.parryEdge = false;
          localInput.weaponWanted = -1;
        }
        interpClient(dt);
      } else {
        simulate(dt, t);
        if (mode === "host") {
          snapAcc += dt;
          if (snapAcc >= 1 / SNAP_HZ) { snapAcc = 0; Net.broadcastSnapshot(); }
        }
      }
      updateCamera();
      render();
    }
  }
  requestAnimationFrame(loop);

  // クライアント: 受信状態へ滑らかに補間
  function interpClient(dt) {
    for (const s of G.soldiers) {
      s.x = lerp(s.x, s.rx, clamp(dt * 14, 0, 1));
      s.y = lerp(s.y, s.ry, clamp(dt * 14, 0, 1));
      if (s.moving) s.legPhase += dt * 12;
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 4);
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 26);
    }
    for (const tank of G.tanks) {
      tank.x = lerp(tank.x, tank.rx, clamp(dt * 11, 0, 1));
      tank.y = lerp(tank.y, tank.ry, clamp(dt * 11, 0, 1));
    }
    for (const dog of G.dogs) {
      dog.x = lerp(dog.x, dog.rx, clamp(dt * 14, 0, 1));
      dog.y = lerp(dog.y, dog.ry, clamp(dt * 14, 0, 1));
    }
    // 弾はローカルで前進(見た目)
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.traveled += Math.hypot(b.vx, b.vy) * dt;
      if (b.traveled > b.range) G.bullets.splice(i, 1);
    }
    for (const g of G.grenades) {
      g.x += g.vx * dt; g.y += g.vy * dt;
      g.rotation += Math.hypot(g.vx, g.vy) * dt * 0.08;
    }
    updateFootsteps(dt, now());
    updateParticles(dt);
  }

  // ============================================================
  //  マッチ制御
  // ============================================================
  function startSoloMatch() {
    mode = "sp";
    G = emptyState();
    G.obstacles = genMap();
    G.goal = BASE_MAX_HP;
    spawnTeams();
    spawnDogs();
    spawnTanks();
    spawnMedkits();
    el.scoreGoal.textContent = "敵基地を破壊";
    resize();
    hideOverlays();
    G.running = true;
    G.over = false;
  }

  function endMatch(winnerTeam) {
    if (G.over) return;
    G.over = true;
    G.running = false;
    showMatchResult(winnerTeam);
    if (mode === "host") Net.broadcastEnd(winnerTeam);
  }

  function showMatchResult(winnerTeam) {
    const me = localSoldier();
    const win = !!me && winnerTeam === me.team;
    let reward = 0;
    if (!G.rewardClaimed) {
      G.rewardClaimed = true;
      if (win) {
        reward = WIN_REWARD;
        money += reward;
        saveProgress();
      }
    }
    el.resultTitle.textContent = win ? "勝利！ 🎖" : "敗北…";
    el.resultTitle.style.color = win ? "#8cf06a" : "#ff7a6a";
    el.rewardSummary.textContent = win ? `勝利報酬 +${reward || WIN_REWARD} G` : `勝利すると ${WIN_REWARD} G 獲得できます`;
    el.rewardSummary.classList.toggle("win", win);
    const winnerName = G.armyNames[winnerTeam] || "勝利軍";
    const rows = [
      ["結果", win ? "WIN" : "LOSE"],
      ["陥落した基地", G.armyNames[1 - winnerTeam]],
      ["勝利軍", winnerName],
      ["撃破数", `${G.armyNames[TEAM_ALLY]} ${G.score[TEAM_ALLY]} ― ${G.score[TEAM_ENEMY]} ${G.armyNames[TEAM_ENEMY]}`],
      ["あなたのキル", me ? me.kills : 0],
      ["あなたのデス", me ? me.deaths : 0],
      ["最終レベル", me ? me.level : 1],
    ];
    el.resultStats.innerHTML = rows.map(r => `<div class="row"><span>${r[0]}</span><b>${esc(String(r[1]))}</b></div>`).join("");
    renderShop();
    el.touch.classList.add("hidden");
    el.result.classList.remove("hidden");
  }

  function hideOverlays() {
    el.menu.classList.add("hidden");
    el.pause.classList.add("hidden");
    el.help.classList.add("hidden");
    el.result.classList.add("hidden");
    matchPaused = false;
    pauseStartedAt = 0;
    helpOrigin = "menu";
    if (isTouch) el.touch.classList.remove("hidden");
  }

  function isMatchActive() {
    return !!(G && !G.over && (G.running || matchPaused));
  }

  function clearGameInput() {
    for (const key of Object.keys(keys)) keys[key] = false;
    mouse.down = false;
    stickMove.x = 0; stickMove.y = 0; stickMove.active = false;
    stickAim.x = 0; stickAim.y = 0; stickAim.active = false;
    document.querySelectorAll(".stick .knob").forEach((knob) => { knob.style.transform = "translate(0,0)"; });
    releaseTouchShield();
    localInput.mvx = 0; localInput.mvy = 0; localInput.shoot = false; localInput.dash = false;
    localInput.reloadEdge = false; localInput.grenadeEdge = false; localInput.interactEdge = false; localInput.parryEdge = false;
    localInput.weaponWanted = -1; localInput.shield = false;
  }

  // performance.now() を基準にした期限も、停止時間ぶん後ろへずらす。
  function shiftGameTimers(delta) {
    if (!G || delta <= 0) return;
    const shift = (obj, fields) => {
      if (!obj) return;
      for (const field of fields) {
        if (Number.isFinite(obj[field])) obj[field] += delta;
      }
    };

    for (const s of G.soldiers) {
      shift(s, ["respawnAt", "lastDamagedAt", "parryUntil", "parryCooldownUntil", "stunnedUntil", "reloadUntil", "lastShot", "lastGrenade", "lastBaseSupplyAt", "lastFootstepAt", "heardUntil", "muzzle"]);
      shift(s.ai, ["think", "strafeUntil", "lastSeen", "lostAt", "fireUntil"]);
    }
    for (const dog of G.dogs) shift(dog, ["respawnAt", "lastAttack", "biteAt", "stunnedUntil"]);
    for (const tank of G.tanks) {
      shift(tank, ["respawnAt", "lastShot", "muzzle"]);
      shift(tank.ai, ["think"]);
    }
    for (const grenade of G.grenades) shift(grenade, ["fuseAt", "bornAt"]);
    for (const pickup of G.pickups) shift(pickup, ["respawnAt"]);
    for (const base of G.bases) shift(base, ["lastWarningAt"]);
    for (const item of G.killfeed) shift(item, ["t"]);
  }

  function applyPausedState(paused) {
    if (!G || G.over) return false;
    paused = !!paused;
    if (matchPaused === paused) {
      G.running = !paused;
      return false;
    }

    const stamp = now();
    if (paused) {
      pauseStartedAt = stamp;
      clearGameInput();
      G.running = false;
    } else {
      shiftGameTimers(Math.max(0, stamp - pauseStartedAt));
      pauseStartedAt = 0;
      G.running = true;
    }
    matchPaused = paused;
    return true;
  }

  function setMatchPaused(paused, sync = true) {
    const changed = applyPausedState(paused);
    if (changed && sync) Net.setPause(!!paused);
    return changed;
  }

  function restoreTouchControls() {
    if (isTouch && el.menu.classList.contains("hidden") && el.help.classList.contains("hidden") &&
        el.pause.classList.contains("hidden") && el.result.classList.contains("hidden")) {
      el.touch.classList.remove("hidden");
    }
  }

  function openPauseMenu() {
    if (!isMatchActive()) return;
    setMatchPaused(true);
    el.pause.classList.remove("hidden");
    el.touch.classList.add("hidden");
  }

  function resumeMatch() {
    if (!G || G.over) return;
    el.pause.classList.add("hidden");
    setMatchPaused(false);
    restoreTouchControls();
  }

  function openHelp(origin) {
    helpOrigin = origin;
    if (origin === "game" && isMatchActive()) setMatchPaused(true);
    el.help.classList.remove("hidden");
    el.touch.classList.add("hidden");
  }

  function closeHelp() {
    const origin = helpOrigin;
    el.help.classList.add("hidden");
    helpOrigin = "menu";
    if (origin === "game") {
      el.pause.classList.add("hidden");
      setMatchPaused(false);
    }
    restoreTouchControls();
  }

  function applyNetworkPause(paused) {
    if (!G || G.over) return;
    applyPausedState(paused);
    if (paused) {
      if (el.help.classList.contains("hidden") && el.menu.classList.contains("hidden") && el.result.classList.contains("hidden")) {
        el.pause.classList.remove("hidden");
      }
      el.touch.classList.add("hidden");
    } else {
      el.pause.classList.add("hidden");
      restoreTouchControls();
    }
  }

  // ============================================================
  //  ネットコード (PeerJS, ホスト権威)
  // ============================================================
  const Net = (() => {
    let peer = null, conns = [], hostConn = null;
    const clientInputs = {}; // peerId -> input
    let roomCode = "";
    let pauseOwner = null;

    function loadPeerJS() {
      return new Promise((resolve, reject) => {
        if (window.Peer) return resolve();
        const s = document.createElement("script");
        s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("PeerJS の読み込みに失敗しました(オフライン?)"));
        document.head.appendChild(s);
        setTimeout(() => { if (!window.Peer) reject(new Error("接続がタイムアウトしました")); }, 9000);
      });
    }

    function genCode() {
      const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let r = ""; for (let i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)];
      return r;
    }

    async function host() {
      netMsg("PeerJS を読み込み中…");
      await loadPeerJS();
      roomCode = genCode();
      peer = new window.Peer("wz-" + roomCode, { debug: 0 });
      peer.on("open", () => {
        // ホストとしてマッチ開始(SP相当 + 後から参加可能)
        mode = "host";
        startHostMatch();
        netMsg("");
        showRoomBanner();
      });
      peer.on("connection", (conn) => onClientConnect(conn));
      peer.on("error", (e) => netMsg("エラー: " + e.type, true));
    }

    function startHostMatch() {
      G = emptyState();
      G.obstacles = genMap();
      G.goal = BASE_MAX_HP;
      spawnTeams();
      spawnDogs();
      spawnTanks();
      spawnMedkits();
      el.scoreGoal.textContent = "敵基地を破壊";
      resize();
      hideOverlays();
      G.running = true; G.over = false;
    }

    function onClientConnect(conn) {
      conn.on("open", () => {
        conns.push(conn);
        // ボットを1体クライアントに割り当て(チームバランス: 人数の少ない方=敵側優先で対戦に)
        const slot = pickSlotForClient();
        if (slot) {
          slot.controller = conn.peer;
          slot.isHuman = true;
          slot.allWeapons = true;
          slot.name = "Player";
          clientInputs[conn.peer] = {
            mvx: 0, mvy: 0, aimAngle: 0, shoot: false, dash: false,
            weaponWanted: -1, reloadEdge: false, grenadeEdge: false, interactEdge: false, parryEdge: false, shield: false,
          };
        }
        conn.send({
          t: "init", obstacles: G.obstacles, goal: G.goal, slotId: slot ? slot.id : -1,
          armyNames: G.armyNames, you: { team: slot ? slot.team : 1 }, paused: matchPaused,
        });
        showRoomBanner();
      });
      conn.on("data", (d) => {
        if (d.t === "hello") {
          const s = G.soldiers.find((x) => x.controller === conn.peer);
          if (s && d.name) s.name = String(d.name).slice(0, 12);
          if (s) applyShopUpgrades(s, d.upgrades || {});
          if (s && s.team === TEAM_ENEMY && d.army) G.armyNames[TEAM_ENEMY] = String(d.army).slice(0, 16);
        } else if (d.t === "input") {
          clientInputs[conn.peer] = d.i;
        } else if (d.t === "pause") {
          pauseOwner = d.p ? conn.peer : null;
          applyNetworkPause(!!d.p);
          broadcastPause(!!d.p);
        }
      });
      conn.on("close", () => onClientGone(conn));
      conn.on("error", () => onClientGone(conn));
    }

    function onClientGone(conn) {
      conns = conns.filter((c) => c !== conn);
      const s = G && G.soldiers.find((x) => x.controller === conn.peer);
      if (s) { s.controller = "cpu"; s.isHuman = false; s.name = pick(BOT_NAMES); }
      delete clientInputs[conn.peer];
      if (pauseOwner === conn.peer) {
        pauseOwner = null;
        applyNetworkPause(false);
        broadcastPause(false);
      }
    }

    function pickSlotForClient() {
      // 各チームの人間の数を数え、少ない方のボットへ割り当て(2人なら 1v1 + bots)
      const humans = [0, 0];
      for (const s of G.soldiers) if (s.controller !== "cpu") humans[s.team]++;
      const targetTeam = humans[TEAM_ENEMY] <= humans[TEAM_ALLY] ? TEAM_ENEMY : TEAM_ALLY;
      return G.soldiers.find((s) => s.team === targetTeam && s.controller === "cpu") ||
             G.soldiers.find((s) => s.controller === "cpu");
    }

    async function join(code) {
      netMsg("PeerJS を読み込み中…");
      await loadPeerJS();
      mode = "client";
      peer = new window.Peer({ debug: 0 });
      peer.on("open", () => {
        netMsg("ホストへ接続中…");
        hostConn = peer.connect("wz-" + code.toUpperCase(), { reliable: false });
        hostConn.on("open", () => {
          hostConn.send({ t: "hello", name: playerName, army: armyName, upgrades: shopLevels });
          netMsg("接続しました。開始を待っています…", false, true);
        });
        hostConn.on("data", (d) => onHostData(d));
        hostConn.on("close", () => netMsg("ホストとの接続が切れました", true));
        hostConn.on("error", () => netMsg("接続エラー", true));
        setTimeout(() => {
          if (!G || !hostConn || hostConn.open !== true) netMsg("ホストが見つかりません。コードを確認してください", true);
        }, 8000);
      });
      peer.on("error", (e) => netMsg("ルームが見つかりません (" + e.type + ")", true));
    }

    function onHostData(d) {
      if (d.t === "init") {
        G = emptyState();
        G.obstacles = d.obstacles.map((o) => ({ ...o, hp: o.hp == null ? Infinity : o.hp }));
        G.goal = d.goal;
        G.localId = d.slotId;
        G.armyNames = d.armyNames || G.armyNames;
        el.scoreGoal.textContent = "敵基地を破壊";
        resize();
        hideOverlays();
        G.running = true; G.over = false;
        if (d.paused) applyNetworkPause(true);
      } else if (d.t === "snap") {
        applySnapshot(d);
      } else if (d.t === "pause") {
        applyNetworkPause(!!d.p);
      } else if (d.t === "end") {
        clientEnd(d.w);
      }
    }

    function applySnapshot(d) {
      if (!G) return;
      G.score = d.sc;
      if (d.an) G.armyNames = d.an;
      for (const nb of (d.bs || [])) {
        const base = G.bases[nb.tm];
        if (!base) continue;
        base.hp = nb.hp; base.maxHp = nb.mh || BASE_MAX_HP; base.hitFlash = nb.hf || 0;
      }
      // 兵士
      const seen = new Set();
      for (const ns of d.s) {
        seen.add(ns.id);
        let s = G.soldiers.find((x) => x.id === ns.id);
        if (!s) {
          s = { id: ns.id, legPhase: 0, muzzle: 0, hitFlash: 0, recoil: 0, lastFootstepAt: -99999, heardUntil: 0 };
          G.soldiers.push(s);
        }
        s.team = ns.tm; s.name = ns.n; s.level = ns.lv;
        s.hp = ns.hp; s.maxHp = ns.mh; s.dead = ns.d ? true : false;
        s.weapon = ns.w; s.aimAngle = ns.a;
        s.xp = ns.xp; s.ammo = ns.am; s.reloading = ns.rl ? true : false;
        s.grenades = ns.gr; s.maxGrenades = ns.mg || 3; s.vehicleId = ns.v == null ? -1 : ns.v;
        s.armor = ns.ar; s.maxArmor = ns.ma; s.shield = ns.sh; s.maxShield = ns.ms; s.shieldRaised = !!ns.sr;
        s.parryUntil = now() + (ns.pr || 0); s.parryCooldownUntil = now() + (ns.pc || 0); s.stunnedUntil = now() + (ns.st || 0);
        s.lastDamagedAt = now() - (AUTO_HEAL_DELAY_MS - (ns.rh || 0));
        s.kills = ns.ki || 0; s.deaths = ns.de || 0;
        s.moving = ns.mv ? true : false; s.noiseRadius = ns.nr || 0;
        if (ns.fl) s.muzzle = now();
        s.rx = ns.x; s.ry = ns.y;
        if (s.x == null) { s.x = ns.x; s.y = ns.y; }
      }
      G.soldiers = G.soldiers.filter((s) => seen.has(s.id));
      // 軍用犬
      const dogSeen = new Set();
      for (const nd of (d.dg || [])) {
        dogSeen.add(nd.id);
        let dog = G.dogs.find((x) => x.id === nd.id);
        if (!dog) {
          dog = { kind: "dog", id: nd.id, x: nd.x, y: nd.y, rx: nd.x, ry: nd.y, biteAt: 0, hitFlash: 0 };
          G.dogs.push(dog);
        }
        dog.team = nd.tm; dog.name = nd.n; dog.hp = nd.hp; dog.maxHp = nd.mh;
        dog.dead = !!nd.d; dog.angle = nd.a; dog.moving = !!nd.mv; dog.rx = nd.x; dog.ry = nd.y;
        if (nd.bt) dog.biteAt = now();
      }
      G.dogs = G.dogs.filter((dog) => dogSeen.has(dog.id));
      // 戦車
      const tankSeen = new Set();
      for (const nt of (d.tn || [])) {
        tankSeen.add(nt.id);
        let tank = G.tanks.find((x) => x.id === nt.id);
        if (!tank) {
          tank = { kind: "tank", id: nt.id, x: nt.x, y: nt.y, rx: nt.x, ry: nt.y, kills: 0 };
          G.tanks.push(tank);
        }
        tank.team = nt.tm; tank.name = nt.n; tank.hp = nt.hp; tank.maxHp = nt.mh;
        tank.dead = !!nt.d; tank.angle = nt.a; tank.turretAngle = nt.ta; tank.driverId = nt.dr;
        tank.rx = nt.x; tank.ry = nt.y;
        tank.lastShot = now() - (1450 - (nt.cd || 0));
        if (nt.fl) tank.muzzle = now();
      }
      G.tanks = G.tanks.filter((tank) => tankSeen.has(tank.id));
      // 弾(置き換え)
      G.bullets = d.b.map((b) => ({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, range: 9999, traveled: 0,
        kind: b.sh ? "shell" : "bullet", col: b.sn ? "#bfe6ff" : "#ffe49a", len: b.sn ? 24 : 16,
      }));
      const nt = now();
      G.grenades = (d.g || []).map((g) => ({
        x: g.x, y: g.y, vx: g.vx, vy: g.vy, rotation: g.ro,
        fuseAt: nt + g.rem, bornAt: nt - g.age,
      }));
      G.pickups = (d.p || []).map((p) => ({
        id: p.id, kind: p.k || "medkit", x: p.x, y: p.y, active: !!p.ac,
        respawnAt: nt + (p.rem || 0), phase: p.id * 1.7,
      }));
      // キルフィード
      if (d.kf) {
        G.killfeed = d.kf;
      }
    }

    function clientEnd(w) {
      if (!G || G.over) return;
      G.over = true; G.running = false;
      showMatchResult(w);
    }

    function broadcastSnapshot() {
      if (conns.length === 0) return;
      const stamp = now();
      const s = G.soldiers.map((o) => ({
        id: o.id, tm: o.team, n: o.name, lv: o.level,
        x: Math.round(o.x), y: Math.round(o.y), a: +o.aimAngle.toFixed(2),
        hp: Math.round(o.hp), mh: o.maxHp, d: o.dead ? 1 : 0, w: o.weapon,
        xp: o.xp, am: o.ammo, rl: o.reloading ? 1 : 0, gr: o.grenades, mg: o.maxGrenades || 3, v: o.vehicleId,
        ar: Math.round(o.armor), ma: o.maxArmor, sh: Math.round(o.shield), ms: o.maxShield, sr: o.shieldRaised ? 1 : 0,
        pr: Math.max(0, o.parryUntil - stamp), pc: Math.max(0, o.parryCooldownUntil - stamp), st: Math.max(0, o.stunnedUntil - stamp),
        rh: Math.max(0, AUTO_HEAL_DELAY_MS - (stamp - o.lastDamagedAt)),
        ki: o.kills, de: o.deaths, mv: o.moving ? 1 : 0, nr: o.noiseRadius || 0,
        fl: (stamp - o.muzzle < (WEAPONS[o.weapon].melee ? 190 : 60)) ? 1 : 0,
      }));
      const dg = G.dogs.map((dog) => ({
        id: dog.id, tm: dog.team, n: dog.name, x: Math.round(dog.x), y: Math.round(dog.y),
        a: +dog.angle.toFixed(2), hp: Math.round(dog.hp), mh: dog.maxHp, d: dog.dead ? 1 : 0,
        mv: dog.moving ? 1 : 0, bt: stamp - dog.biteAt < 180 ? 1 : 0,
      }));
      const tn = G.tanks.map((tank) => ({
        id: tank.id, tm: tank.team, n: tank.name, x: Math.round(tank.x), y: Math.round(tank.y),
        a: +tank.angle.toFixed(2), ta: +tank.turretAngle.toFixed(2), hp: Math.round(tank.hp), mh: tank.maxHp,
        d: tank.dead ? 1 : 0, dr: tank.driverId, cd: Math.max(0, 1450 - (stamp - tank.lastShot)), fl: stamp - tank.muzzle < 90 ? 1 : 0,
      }));
      const b = G.bullets.map((x) => ({
        x: Math.round(x.x), y: Math.round(x.y), vx: Math.round(x.vx), vy: Math.round(x.vy),
        sn: x.len > 20 ? 1 : 0, sh: x.kind === "shell" ? 1 : 0,
      }));
      const g = G.grenades.map((x) => ({
        x: Math.round(x.x), y: Math.round(x.y), vx: Math.round(x.vx), vy: Math.round(x.vy), ro: +x.rotation.toFixed(2),
        rem: Math.max(0, x.fuseAt - stamp), age: Math.max(0, stamp - x.bornAt),
      }));
      const p = G.pickups.map((kit) => ({
        id: kit.id, k: kit.kind, x: Math.round(kit.x), y: Math.round(kit.y), ac: kit.active ? 1 : 0,
        rem: kit.active ? 0 : Math.max(0, kit.respawnAt - stamp),
      }));
      const bs = G.bases.map((base) => ({ tm: base.team, hp: Math.round(base.hp), mh: base.maxHp, hf: +base.hitFlash.toFixed(2) }));
      const payload = { t: "snap", sc: G.score, an: G.armyNames, bs, s, dg, tn, b, g, p, kf: G.killfeed };
      for (const c of conns) { try { c.send(payload); } catch (e) {} }
    }

    function broadcastEnd(w) {
      for (const c of conns) { try { c.send({ t: "end", w }); } catch (e) {} }
    }

    function broadcastPause(paused) {
      for (const c of conns) { try { c.send({ t: "pause", p: paused ? 1 : 0 }); } catch (e) {} }
    }

    function setPause(paused) {
      if (mode === "host") {
        pauseOwner = paused ? "host" : null;
        broadcastPause(paused);
      } else if (mode === "client" && hostConn && hostConn.open === true) {
        try { hostConn.send({ t: "pause", p: paused ? 1 : 0 }); } catch (e) {}
      }
    }

    function sendInput(inp) {
      if (!hostConn || hostConn.open !== true) return;
      try {
        hostConn.send({
          t: "input",
          i: {
            mvx: inp.mvx, mvy: inp.mvy, aimAngle: inp.aimAngle, shoot: inp.shoot, dash: inp.dash,
            weaponWanted: inp.weaponWanted, reloadEdge: inp.reloadEdge,
            grenadeEdge: inp.grenadeEdge, interactEdge: inp.interactEdge,
            parryEdge: inp.parryEdge, shield: inp.shield,
          },
        });
      } catch (e) {}
    }

    function showRoomBanner() {
      const humanCount = G ? G.soldiers.filter((s) => s.controller !== "cpu").length : 1;
      el.menuHint && (el.menuHint.textContent = "");
      // 画面内バナー(キルフィードの下に流用)
      banner(`ルームコード: ${roomCode}　参加者 ${humanCount}人　(共有して対戦)`);
    }

    function shutdown() {
      try { conns.forEach((c) => c.close()); } catch (e) {}
      try { hostConn && hostConn.close(); } catch (e) {}
      try { peer && peer.destroy(); } catch (e) {}
      peer = null; conns = []; hostConn = null;
      pauseOwner = null;
    }

    return { host, join, broadcastSnapshot, broadcastEnd, sendInput, setPause, shutdown, clientInputs, get code() { return roomCode; } };
  })();

  let bannerTimer = null;
  function banner(text) {
    let b = document.getElementById("net-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "net-banner";
      b.style.cssText = "position:absolute;top:120px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);color:#ffd23f;font-weight:800;font-size:13px;padding:6px 14px;border-radius:8px;z-index:8;pointer-events:none;";
      document.getElementById("stage-wrap").appendChild(b);
    }
    b.textContent = text;
    b.style.display = "block";
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.style.display = "none"; }, 6000);
  }

  function netMsg(text, err, ok) {
    el.netStatus.textContent = text;
    el.netStatus.className = "net-status" + (err ? " err" : ok ? " ok" : "");
  }

  // ============================================================
  //  メニュー / UI 配線
  // ============================================================
  function setupMenu() {
    loadProgress();
    el.menuMoney.textContent = money;

    // 名前の保存
    const saved = localStorage.getItem("wz-name");
    if (saved) el.nameInput.value = saved;
    playerName = el.nameInput.value.trim() || "Soldier";
    el.nameInput.addEventListener("input", () => {
      playerName = el.nameInput.value.trim() || "Soldier";
      localStorage.setItem("wz-name", playerName);
    });

    const savedArmy = localStorage.getItem("wz-army");
    if (savedArmy) el.armyInput.value = savedArmy;
    else el.armyInput.value = armyName;
    armyName = el.armyInput.value.trim() || "ブルー・フェニックス軍";
    el.armyInput.addEventListener("input", () => {
      armyName = el.armyInput.value.trim() || "ブルー・フェニックス軍";
      localStorage.setItem("wz-army", armyName);
    });

    // 難易度
    document.querySelectorAll("#diff-seg button").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#diff-seg button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        difficulty = b.dataset.diff;
      });
    });

    document.getElementById("btn-solo").addEventListener("click", () => { Audio.unlock(); Net.shutdown(); startSoloMatch(); });
    document.getElementById("btn-online").addEventListener("click", () => {
      el.menuMain.classList.add("hidden");
      el.menuOnline.classList.remove("hidden");
      netMsg("");
    });
    document.getElementById("btn-back").addEventListener("click", () => {
      el.menuOnline.classList.add("hidden");
      el.menuMain.classList.remove("hidden");
    });
    document.getElementById("btn-host").addEventListener("click", async () => {
      Audio.unlock();
      try { await Net.host(); } catch (e) { netMsg(e.message, true); }
    });
    document.getElementById("btn-join").addEventListener("click", async () => {
      Audio.unlock();
      const code = (el.joinCode.value || "").trim();
      if (code.length < 3) { netMsg("ルームコードを入力してください", true); return; }
      try { await Net.join(code); } catch (e) { netMsg(e.message, true); }
    });

    // 操作方法 (対戦中に開いた場合はゲームを停止)
    document.getElementById("btn-controls").addEventListener("click", () => openHelp("menu"));
    document.getElementById("btn-help").addEventListener("click", () => openHelp(isMatchActive() ? "game" : "menu"));
    document.getElementById("btn-help-close").addEventListener("click", closeHelp);

    // 一時停止 / メニュー / 結果
    document.getElementById("btn-menu").addEventListener("click", openPauseMenu);
    document.getElementById("btn-resume").addEventListener("click", resumeMatch);
    document.getElementById("btn-pause-help").addEventListener("click", () => openHelp("pause"));
    document.getElementById("btn-pause-quit").addEventListener("click", () => {
      setMatchPaused(false);
      openMenu();
    });
    document.getElementById("btn-again").addEventListener("click", () => {
      if (mode === "client") { openMenu(); return; }
      Net.shutdown();
      startSoloMatch();
    });
    document.getElementById("btn-tomenu").addEventListener("click", openMenu);
    el.shopItems.addEventListener("click", (e) => {
      const button = e.target.closest && e.target.closest("[data-shop-buy]");
      if (button && !button.disabled) buyShopItem(button.dataset.shopBuy);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.repeat) return;
      if (!el.help.classList.contains("hidden")) closeHelp();
      else if (!el.pause.classList.contains("hidden")) resumeMatch();
      else if (isMatchActive()) openPauseMenu();
      else return;
      e.preventDefault();
    });

    // ミュート
    el.btnMute.addEventListener("click", () => {
      const m = Audio.toggle();
      el.btnMute.textContent = m ? "🔇" : "🔊";
    });

    el.menuHint.textContent = isTouch
      ? "スマホ: 左で移動・右で照準＆射撃・専用ボタンでグレネード/戦車"
      : "PC: WASDで移動・マウスで射撃・Gでグレネード・Eで戦車";
  }

  function openMenu() {
    if (G) { G.running = false; }
    matchPaused = false;
    pauseStartedAt = 0;
    helpOrigin = "menu";
    clearGameInput();
    Net.shutdown();
    el.result.classList.add("hidden");
    el.pause.classList.add("hidden");
    el.help.classList.add("hidden");
    el.touch.classList.add("hidden");
    el.menuOnline.classList.add("hidden");
    el.menuMain.classList.remove("hidden");
    el.menu.classList.remove("hidden");
    el.vehicleHint.classList.add("hidden");
    const b = document.getElementById("net-banner"); if (b) b.style.display = "none";
  }

  // 起動
  resize();
  setupMenu();
})();
