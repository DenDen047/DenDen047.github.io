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
  const SCORE_GOAL = 30;          // 先取キル数
  const RESPAWN_MS = 3200;
  const SOLDIER_R = 14;
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

  const WEAPONS = [
    { key: "pistol",  name: "ハンドガン",       dmg: 22, interval: 230, mag: 12, reload: 900,  spread: 0.045, pellets: 1, auto: false, speed: 1000, range: 560,  len: 13, kick: 2.2, snd: "pistol" },
    { key: "smg",     name: "サブマシンガン",   dmg: 13, interval: 72,  mag: 30, reload: 1450, spread: 0.105, pellets: 1, auto: true,  speed: 1050, range: 520,  len: 12, kick: 1.4, snd: "smg" },
    { key: "rifle",   name: "アサルトライフル", dmg: 26, interval: 128, mag: 30, reload: 1650, spread: 0.05,  pellets: 1, auto: true,  speed: 1320, range: 780,  len: 18, kick: 2.0, snd: "rifle" },
    { key: "shotgun", name: "ショットガン",     dmg: 11, interval: 680, mag: 6,  reload: 2150, spread: 0.34,  pellets: 8, auto: false, speed: 940,  range: 360,  len: 16, kick: 5.5, snd: "shotgun" },
    { key: "sniper",  name: "スナイパー",       dmg: 96, interval: 1120, mag: 5, reload: 2350, spread: 0.006, pellets: 1, auto: false, speed: 2200, range: 1250, len: 26, kick: 6.0, pierce: 2, snd: "sniper" },
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
    hpFill: document.getElementById("hp-fill"),
    hpText: document.getElementById("hp-text"),
    lvText: document.getElementById("lv-text"),
    xpFill: document.getElementById("xp-fill"),
    wName: document.getElementById("weapon-name"),
    ammo: document.getElementById("ammo-text"),
    killfeed: document.getElementById("killfeed"),
    levelup: document.getElementById("levelup"),
    menu: document.getElementById("menu"),
    menuMain: document.getElementById("menu-main"),
    menuOnline: document.getElementById("menu-online"),
    menuHint: document.getElementById("menu-hint"),
    help: document.getElementById("help"),
    result: document.getElementById("result"),
    resultTitle: document.getElementById("result-title"),
    resultStats: document.getElementById("result-stats"),
    nameInput: document.getElementById("name-input"),
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
    return {
      unlock() { ensure(); if (actx && actx.state === "suspended") actx.resume(); },
      shot, boom, hurt, levelup,
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

  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === "r" || e.key === "R") localInput.reloadEdge = true;
    if (e.key >= "1" && e.key <= "5") localInput.weaponWanted = parseInt(e.key, 10) - 1;
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
  document.getElementById("t-swap").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const me = localSoldier();
    if (me) localInput.weaponWanted = (me.weapon + 1) % WEAPONS.length;
  });

  // ローカルプレイヤーの入力(SP=自分のsoldierに適用 / client=送信)
  const localInput = { mvx: 0, mvy: 0, aimx: 1, aimy: 0, shoot: false, dash: false, reloadEdge: false, weaponWanted: -1, aimAngle: 0 };

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

  function emptyState() {
    return {
      soldiers: [],
      bullets: [],
      particles: [],
      pickups: [],
      obstacles: [],
      score: [0, 0],
      goal: SCORE_GOAL,
      running: false,
      over: false,
      localId: 0,
      nextId: 1,
      killfeed: [],
    };
  }

  function localSoldier() {
    if (!G) return null;
    return G.soldiers.find((s) => s.id === G.localId) || null;
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
      obs.push({ x, y, w, h, type: t, hp: Infinity });
    }
    // 爆発バレル
    for (let i = 0; i < 9; i++) {
      const x = rand(200, WORLD_W - 220), y = rand(200, WORLD_H - 220);
      obs.push({ x, y, w: 30, h: 30, type: "barrel", hp: 30, r: 16 });
    }
    return obs;
  }

  function teamSpawn(team) {
    // ally: 左下, enemy: 右上
    if (team === TEAM_ALLY) return { x: rand(70, 320), y: rand(WORLD_H - 320, WORLD_H - 70) };
    return { x: rand(WORLD_W - 320, WORLD_W - 70), y: rand(70, 320) };
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
      level: 1, xp: 0, dmgMul: 1,
      speed: opt.isHuman ? 188 : rand(150, 172),
      weapon: opt.weapon != null ? opt.weapon : WKEY.rifle,
      ammo: WEAPONS[opt.weapon != null ? opt.weapon : WKEY.rifle].mag,
      reloading: false, reloadUntil: 0, lastShot: 0,
      kills: 0, deaths: 0,
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
    G.localId = me.id;
    G.soldiers.push(me);
    const used = new Set([me.name]);
    function botName() { let n; do { n = pick(BOT_NAMES); } while (used.has(n) && used.size < BOT_NAMES.length); used.add(n); return n; }
    function botWeapon() {
      if (Math.random() < D.sniperChance) return WKEY.sniper;
      return pick([WKEY.rifle, WKEY.rifle, WKEY.smg, WKEY.shotgun, WKEY.pistol]);
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
    x = tx;
    let ty = ny;
    for (const o of G.obstacles) {
      if (circleRect(x, ty, SOLDIER_R, o.x, o.y, o.w, o.h)) { ty = y; break; }
    }
    y = ty;
    s.x = clamp(x, SOLDIER_R, WORLD_W - SOLDIER_R);
    s.y = clamp(y, SOLDIER_R, WORLD_H - SOLDIER_R);
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
    if (s.dead || s.reloading) return;
    const w = WEAPONS[s.weapon];
    if (t - s.lastShot < w.interval) return;
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

  function startReload(s, t) {
    if (s.reloading) return;
    const w = WEAPONS[s.weapon];
    if (s.ammo >= w.mag) return;
    s.reloading = true;
    s.reloadUntil = t + w.reload;
  }

  function damageSoldier(target, dmg, attacker) {
    if (target.dead) return;
    target.hp -= dmg;
    target.hitFlash = 1;
    if (target.id === G.localId) { Audio.hurt(); shake = Math.min(12, shake + 3); }
    if (target.hp <= 0) killSoldier(target, attacker);
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
    if (attacker && attacker.team !== target.team && attacker.id !== target.id) {
      attacker.kills++;
      G.score[attacker.team]++;
      gainXp(attacker, target.isHuman ? 2 : 1);
      addKillfeed(attacker, target);
      if (G.score[attacker.team] >= G.goal) endMatch(attacker.team);
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
    s.ammo = WEAPONS[s.weapon].mag; s.reloading = false;
    s.ai.targetId = -1; s.ai.think = 0;
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
      if (dd < R) damageSoldier(s, (1 - dd / R) * 90, null);
    }
    // 連鎖
    for (const o2 of G.obstacles) {
      if (o2.type === "barrel" && o2.hp > 0 && o2 !== o) {
        if (dist2(o2.x, o2.y, cx, cy) < R * R) o2.hp = 0.0001;
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
      // ターゲット選定: 視認できる最寄りの敵
      let best = -1, bestD = Infinity, bestVisible = false;
      for (const e of G.soldiers) {
        if (e.dead || e.team === s.team) continue;
        const d2 = dist2(s.x, s.y, e.x, e.y);
        const vis = lineClear(s.x, s.y, e.x, e.y);
        const sight = vis ? 740 * 740 : 0;
        if (vis && d2 < sight && d2 < bestD) { bestD = d2; best = e.id; bestVisible = true; }
      }
      if (best >= 0) { a.targetId = best; a.lastSeen = t; }
      else if (t - a.lastSeen > 1400) a.targetId = -1;

      // ターゲット無し → 戦線中央 + ランダムへ前進
      if (a.targetId < 0) {
        a.wx = clamp(WORLD_W / 2 + rand(-420, 420), 80, WORLD_W - 80);
        a.wy = clamp(WORLD_H / 2 + rand(-420, 420), 80, WORLD_H - 80);
      }
      if (t > a.strafeUntil) { a.strafe = Math.random() < 0.5 ? 1 : -1; a.strafeUntil = t + rand(500, 1100); }
    }

    const w = WEAPONS[s.weapon];
    const target = a.targetId >= 0 ? G.soldiers.find((x) => x.id === a.targetId) : null;
    let mvx = 0, mvy = 0;
    let desiredAim = s.aimAngle;

    if (target && !target.dead) {
      const dx = target.x - s.x, dy = target.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      desiredAim = Math.atan2(dy, dx);
      const pref = w.range * 0.62;
      // 距離維持 + ストレイフ
      let radial = 0;
      if (d > pref * 1.15) radial = 1;
      else if (d < pref * 0.6) radial = -1;
      const perpx = -dy / d, perpy = dx / d;
      mvx = (dx / d) * radial + perpx * a.strafe * 0.8;
      mvy = (dy / d) * radial + perpy * a.strafe * 0.8;
      // 射撃判定
      const vis = lineClear(s.x, s.y, target.x, target.y);
      const aimGap = Math.abs(((desiredAim - s.aimAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (vis && d < w.range && aimGap < 0.22 && Math.random() < D.fireChance) {
        // エイムにブレを加える
        const err = (Math.random() - 0.5) * D.aimErr * 2;
        const sav = s.aimAngle;
        s.aimAngle = desiredAim + err;
        tryShoot(s, t);
        s.aimAngle = sav;
      }
      if (s.ammo <= 0) startReload(s, t);
    } else {
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
    const m = Math.hypot(mvx, mvy);
    s.moving = m > 0.05;
    if (m > 1) { mvx /= m; mvy /= m; }
    const sp = s.speed * (dash ? 1.55 : 1) * (s.id === G.localId ? 1 : 1);
    const nx = s.x + mvx * sp * dt;
    const ny = s.y + mvy * sp * dt;
    resolveMovement(s, nx, ny);
    if (s.moving) s.legPhase += dt * 12;
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
    // 武器変更
    if (inp.weaponWanted != null && inp.weaponWanted >= 0 && inp.weaponWanted !== s.weapon) {
      if (s.allWeapons || s.weapon === inp.weaponWanted) {
        s.weapon = inp.weaponWanted;
        s.ammo = Math.min(s.ammo, WEAPONS[s.weapon].mag);
        if (s.ammo <= 0) s.ammo = WEAPONS[s.weapon].mag;
        s.reloading = false;
      }
      inp.weaponWanted = -1;
    }
    s.aimAngle = inp.aimAngle != null ? inp.aimAngle : Math.atan2(inp.aimy, inp.aimx);
    if (inp.reloadEdge) { startReload(s, t); inp.reloadEdge = false; }
    if (inp.shoot) tryShoot(s, t);
    applyMove(s, inp.mvx, inp.mvy, dtGlobal, inp.dash);
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
      if (b.traveled > b.range || b.x < 0 || b.y < 0 || b.x > WORLD_W || b.y > WORLD_H) dead = true;
      if (!dead) {
        // 障害物
        for (const o of G.obstacles) {
          if (b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y && b.y <= o.y + o.h) {
            if (o.type === "barrel") { o.hp -= b.dmg; }
            addParticle(b.x, b.y, { kind: "spark", vx: -b.vx * 0.05 + rand(-30, 30), vy: -b.vy * 0.05 + rand(-30, 30), life: 160, size: 2.4 });
            dead = true; break;
          }
        }
      }
      if (!dead) {
        // 兵士
        for (const s of G.soldiers) {
          if (s.dead || s.team === b.team || s.id === b.owner) continue;
          if (dist2(b.x, b.y, s.x, s.y) < (SOLDIER_R + 2) * (SOLDIER_R + 2)) {
            const attacker = G.soldiers.find((x) => x.id === b.owner) || null;
            damageSoldier(s, b.dmg, attacker);
            for (let k = 0; k < 5; k++) {
              const a = Math.atan2(b.vy, b.vx) + rand(-0.7, 0.7);
              addParticle(b.x, b.y, { kind: "blood", vx: Math.cos(a) * rand(40, 160), vy: Math.sin(a) * rand(40, 160), life: rand(250, 550), size: rand(1.5, 3.5) });
            }
            if (b.pierce > 0) { b.pierce--; b.dmg *= 0.7; }
            else { dead = true; }
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
    // 影 → 兵士 → 弾 → パーティクル
    drawStains();
    drawObstaclesBack();
    for (const s of G.soldiers) if (!s.dead) drawSoldierShadow(s);
    drawParticlesUnder();
    for (const s of G.soldiers) if (!s.dead) drawSoldier(s);
    drawBullets();
    drawParticlesOver();
    drawNameTags();

    ctx.restore();

    if (shake > 0) shake = Math.max(0, shake - 0.6);
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
    // 銃
    const w = WEAPONS[s.weapon];
    ctx.fillStyle = "#23231f";
    ctx.fillRect(SOLDIER_R - 4 - recoilBack, -3, w.len, 5);
    if (w.key === "sniper") ctx.fillRect(SOLDIER_R + 2 - recoilBack, -5, 8, 3);
    // 手
    ctx.fillStyle = "#caa06b";
    ctx.beginPath(); ctx.arc(SOLDIER_R - 2 - recoilBack, 2, 3.4, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(SOLDIER_R + w.len * 0.55 - recoilBack, 1, 3.2, 0, 6.283); ctx.fill();
    // 頭(ヘルメット)
    ctx.fillStyle = c.a;
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.arc(2, 0, 8.5, -0.9, 0.9); ctx.fill();
    // マズルフラッシュ
    if (now() - s.muzzle < 55) {
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
      }
    }
  }

  function drawNameTags() {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const s of G.soldiers) {
      if (s.dead) continue;
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
  }

  function drawMinimap() {
    const mw = mini.width, mh = mini.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "rgba(20,26,14,0.85)";
    mctx.fillRect(0, 0, mw, mh);
    const sx = mw / WORLD_W, sy = mh / WORLD_H;
    // 障害物
    mctx.fillStyle = "rgba(255,255,255,0.22)";
    for (const o of G.obstacles) {
      if (o.type === "wall") mctx.fillRect(o.x * sx, o.y * sy, Math.max(1, o.w * sx), Math.max(1, o.h * sy));
    }
    // 兵士
    for (const s of G.soldiers) {
      if (s.dead) continue;
      mctx.fillStyle = s.id === G.localId ? "#ffd23f" : (s.team === TEAM_ALLY ? "#4ea3ff" : "#ff5a4e");
      const r = s.id === G.localId ? 3 : 2;
      mctx.beginPath(); mctx.arc(s.x * sx, s.y * sy, r, 0, 6.283); mctx.fill();
    }
  }

  // ============================================================
  //  HUD
  // ============================================================
  let lastFeedLen = -1;
  function updateHUD() {
    const me = localSoldier();
    el.scoreAlly.textContent = G.score[TEAM_ALLY];
    el.scoreEnemy.textContent = G.score[TEAM_ENEMY];
    if (me) {
      const ratio = clamp(me.hp / me.maxHp, 0, 1);
      el.hpFill.style.width = (ratio * 100) + "%";
      el.hpFill.style.background = ratio > 0.5 ? "linear-gradient(90deg,#46d36a,#8cf06a)" : ratio > 0.25 ? "linear-gradient(90deg,#e3b341,#f0d36a)" : "linear-gradient(90deg,#e3413f,#ff7a6a)";
      el.hpText.textContent = me.dead ? "復活中" : Math.max(0, Math.ceil(me.hp));
      el.lvText.textContent = me.level;
      el.xpFill.style.width = clamp(me.xp / (me.level * 3), 0, 1) * 100 + "%";
      const w = WEAPONS[me.weapon];
      el.wName.textContent = w.name;
      el.ammo.textContent = (me.reloading ? "リロード" : me.ammo) + " / " + w.mag;
      el.ammo.classList.toggle("low", !me.reloading && me.ammo <= Math.ceil(w.mag * 0.25));
    }
    // キルフィード
    if (G.killfeed.length !== lastFeedLen) {
      lastFeedLen = G.killfeed.length;
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
        if (inputAcc >= 1 / INPUT_HZ) { inputAcc = 0; Net.sendInput(localInput); localInput.reloadEdge = false; localInput.weaponWanted = -1; }
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
    // 弾はローカルで前進(見た目)
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.traveled += Math.hypot(b.vx, b.vy) * dt;
      if (b.traveled > b.range) G.bullets.splice(i, 1);
    }
    updateParticles(dt);
  }

  // ============================================================
  //  マッチ制御
  // ============================================================
  function startSoloMatch() {
    mode = "sp";
    G = emptyState();
    G.obstacles = genMap();
    G.goal = SCORE_GOAL;
    spawnTeams();
    el.scoreGoal.textContent = G.goal;
    resize();
    hideOverlays();
    G.running = true;
    G.over = false;
  }

  function endMatch(winnerTeam) {
    if (G.over) return;
    G.over = true;
    G.running = false;
    const me = localSoldier();
    const win = winnerTeam === TEAM_ALLY;
    el.resultTitle.textContent = win ? "勝利！ 🎖" : "敗北…";
    el.resultTitle.style.color = win ? "#8cf06a" : "#ff7a6a";
    const allyK = G.soldiers.filter(s => s.team === TEAM_ALLY).reduce((a, s) => a + s.kills, 0);
    const rows = [
      ["結果", win ? "WIN" : "LOSE"],
      ["スコア", `味方 ${G.score[TEAM_ALLY]} ― ${G.score[TEAM_ENEMY]} 敵`],
      ["あなたのキル", me ? me.kills : 0],
      ["あなたのデス", me ? me.deaths : 0],
      ["最終レベル", me ? me.level : 1],
    ];
    el.resultStats.innerHTML = rows.map(r => `<div class="row"><span>${r[0]}</span><b>${esc(String(r[1]))}</b></div>`).join("");
    el.result.classList.remove("hidden");
    if (mode === "host") Net.broadcastEnd(winnerTeam);
  }

  function hideOverlays() {
    el.menu.classList.add("hidden");
    el.help.classList.add("hidden");
    el.result.classList.add("hidden");
    if (isTouch) el.touch.classList.remove("hidden");
  }

  // ============================================================
  //  ネットコード (PeerJS, ホスト権威)
  // ============================================================
  const Net = (() => {
    let peer = null, conns = [], hostConn = null;
    const clientInputs = {}; // peerId -> input
    let roomCode = "";

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
      G.goal = SCORE_GOAL;
      spawnTeams();
      el.scoreGoal.textContent = G.goal;
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
          clientInputs[conn.peer] = { mvx: 0, mvy: 0, aimAngle: 0, shoot: false, dash: false, weaponWanted: -1, reloadEdge: false };
        }
        conn.send({ t: "init", obstacles: G.obstacles, goal: G.goal, slotId: slot ? slot.id : -1, you: { team: slot ? slot.team : 1 } });
        showRoomBanner();
      });
      conn.on("data", (d) => {
        if (d.t === "hello") {
          const s = G.soldiers.find((x) => x.controller === conn.peer);
          if (s && d.name) s.name = String(d.name).slice(0, 12);
        } else if (d.t === "input") {
          clientInputs[conn.peer] = d.i;
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
          hostConn.send({ t: "hello", name: playerName });
          netMsg("接続しました。開始を待っています…", false, true);
        });
        hostConn.on("data", (d) => onHostData(d));
        hostConn.on("close", () => netMsg("ホストとの接続が切れました", true));
        hostConn.on("error", () => netMsg("接続エラー", true));
        setTimeout(() => { if (!G || !G.running) netMsg("ホストが見つかりません。コードを確認してください", true); }, 8000);
      });
      peer.on("error", (e) => netMsg("ルームが見つかりません (" + e.type + ")", true));
    }

    function onHostData(d) {
      if (d.t === "init") {
        G = emptyState();
        G.obstacles = d.obstacles.map((o) => ({ ...o, hp: o.hp == null ? Infinity : o.hp }));
        G.goal = d.goal;
        G.localId = d.slotId;
        el.scoreGoal.textContent = G.goal;
        resize();
        hideOverlays();
        G.running = true; G.over = false;
      } else if (d.t === "snap") {
        applySnapshot(d);
      } else if (d.t === "end") {
        clientEnd(d.w);
      }
    }

    function applySnapshot(d) {
      if (!G) return;
      G.score = d.sc;
      // 兵士
      const seen = new Set();
      for (const ns of d.s) {
        seen.add(ns.id);
        let s = G.soldiers.find((x) => x.id === ns.id);
        if (!s) {
          s = { id: ns.id, legPhase: 0, muzzle: 0, hitFlash: 0, recoil: 0 };
          G.soldiers.push(s);
        }
        s.team = ns.tm; s.name = ns.n; s.level = ns.lv;
        s.hp = ns.hp; s.maxHp = ns.mh; s.dead = ns.d ? true : false;
        s.weapon = ns.w; s.aimAngle = ns.a;
        s.moving = ns.mv ? true : false;
        if (ns.fl) s.muzzle = now();
        s.rx = ns.x; s.ry = ns.y;
        if (s.x == null) { s.x = ns.x; s.y = ns.y; }
      }
      G.soldiers = G.soldiers.filter((s) => seen.has(s.id));
      // 弾(置き換え)
      G.bullets = d.b.map((b) => ({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, range: 9999, traveled: 0,
        col: b.sn ? "#bfe6ff" : "#ffe49a", len: b.sn ? 24 : 16,
      }));
      // キルフィード
      if (d.kf) {
        G.killfeed = d.kf;
      }
    }

    function clientEnd(w) {
      G.over = true; G.running = false;
      const win = w === TEAM_ALLY ? (localSoldier() && localSoldier().team === TEAM_ALLY) : (localSoldier() && localSoldier().team === TEAM_ENEMY);
      const youWin = localSoldier() ? localSoldier().team === w : false;
      el.resultTitle.textContent = youWin ? "勝利！ 🎖" : "敗北…";
      el.resultTitle.style.color = youWin ? "#8cf06a" : "#ff7a6a";
      const me = localSoldier();
      el.resultStats.innerHTML = `<div class="row"><span>スコア</span><b>味方 ${G.score[0]} ― ${G.score[1]} 敵</b></div>` +
        (me ? `<div class="row"><span>あなたのキル</span><b>${me.kills || 0}</b></div>` : "");
      el.result.classList.remove("hidden");
    }

    function broadcastSnapshot() {
      if (conns.length === 0) return;
      const s = G.soldiers.map((o) => ({
        id: o.id, tm: o.team, n: o.name, lv: o.level,
        x: Math.round(o.x), y: Math.round(o.y), a: +o.aimAngle.toFixed(2),
        hp: Math.round(o.hp), mh: o.maxHp, d: o.dead ? 1 : 0, w: o.weapon,
        mv: o.moving ? 1 : 0, fl: (now() - o.muzzle < 60) ? 1 : 0,
      }));
      const b = G.bullets.map((x) => ({ x: Math.round(x.x), y: Math.round(x.y), vx: Math.round(x.vx), vy: Math.round(x.vy), sn: x.len > 20 ? 1 : 0 }));
      const payload = { t: "snap", sc: G.score, s, b, kf: G.killfeed };
      for (const c of conns) { try { c.send(payload); } catch (e) {} }
    }

    function broadcastEnd(w) {
      for (const c of conns) { try { c.send({ t: "end", w }); } catch (e) {} }
    }

    function sendInput(inp) {
      if (!hostConn || hostConn.open !== true) return;
      try {
        hostConn.send({ t: "input", i: { mvx: inp.mvx, mvy: inp.mvy, aimAngle: inp.aimAngle, shoot: inp.shoot, dash: inp.dash, weaponWanted: inp.weaponWanted, reloadEdge: inp.reloadEdge } });
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
    }

    return { host, join, broadcastSnapshot, broadcastEnd, sendInput, shutdown, clientInputs, get code() { return roomCode; } };
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
    // 名前の保存
    const saved = localStorage.getItem("wz-name");
    if (saved) el.nameInput.value = saved;
    playerName = el.nameInput.value.trim() || "Soldier";
    el.nameInput.addEventListener("input", () => {
      playerName = el.nameInput.value.trim() || "Soldier";
      localStorage.setItem("wz-name", playerName);
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

    // ヘルプ
    document.getElementById("btn-help").addEventListener("click", () => el.help.classList.remove("hidden"));
    document.getElementById("btn-help-close").addEventListener("click", () => el.help.classList.add("hidden"));

    // メニュー / 結果
    document.getElementById("btn-menu").addEventListener("click", openMenu);
    document.getElementById("btn-again").addEventListener("click", () => {
      if (mode === "client") { openMenu(); return; }
      Net.shutdown();
      startSoloMatch();
    });
    document.getElementById("btn-tomenu").addEventListener("click", openMenu);

    // ミュート
    el.btnMute.addEventListener("click", () => {
      const m = Audio.toggle();
      el.btnMute.textContent = m ? "🔇" : "🔊";
    });

    el.menuHint.textContent = isTouch ? "スマホ: 左で移動・右で照準＆射撃" : "PC: WASDで移動・マウスで照準・クリックで射撃";
  }

  function openMenu() {
    if (G) { G.running = false; }
    Net.shutdown();
    el.result.classList.add("hidden");
    el.help.classList.add("hidden");
    el.touch.classList.add("hidden");
    el.menuOnline.classList.add("hidden");
    el.menuMain.classList.remove("hidden");
    el.menu.classList.remove("hidden");
    const b = document.getElementById("net-banner"); if (b) b.style.display = "none";
  }

  // 起動
  resize();
  setupMenu();
})();
