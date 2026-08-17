/* =========================================================================
   GACHA STRIKERS ― 庭（クラブハウス）と、そこから開くUI
   ========================================================================= */

const Garden = {
  W: 1560, H: 1040,
  player: { x: 780, y: 800, vx: 0, vy: 0, dir: -Math.PI / 2, walk: 0, speed: 3.0 },
  cam: { x: 0, y: 0 },
  facilities: [],
  props: [],
  npcs: [],
  petals: [],
  near: null,
  t: 0,
  ready: false,

  init() {
    if (this.ready) { this.syncNpcs(); return; }
    this.ready = true;

    this.facilities = [
      {
        id: 'stadium', style: 'stadium', label: 'スタジアム', icon: '⚽',
        sub: 'ステージに挑戦', x: 640, y: 150, w: 300, h: 170,
        door: { x: 790, y: 330 }, color: '#3a6ea8', roof: '#22456b',
        action: () => StageUI.open(),
      },
      {
        id: 'gacha', style: 'shop', label: 'ガチャショップ', icon: '🎰',
        sub: 'チケットで選手を引く', x: 190, y: 380, w: 250, h: 160,
        door: { x: 315, y: 550 }, color: '#8a4fd0', roof: '#4a2280',
        action: () => GachaUI.open(),
      },
      {
        id: 'team', style: 'tent', label: '編成テント', icon: '📋',
        sub: 'フォーメーションを組む', x: 1130, y: 400, w: 250, h: 155,
        door: { x: 1255, y: 565 }, color: '#2f9c6a', roof: '#1a6b47',
        action: () => TeamUI.open(),
      },
      {
        id: 'trophy', style: 'hall', label: 'トロフィールーム', icon: '🏆',
        sub: '図鑑と戦績', x: 1080, y: 790, w: 230, h: 140,
        door: { x: 1195, y: 940 }, color: '#b8862f', roof: '#7a5312',
        action: () => DexUI.open(),
      },
    ];

    // 地形の飾りを固定シードで生成する（毎回同じ庭になる）
    const rnd = mulberry32(20260817);
    this.props = [];
    for (let i = 0; i < 46; i++) {
      const x = 60 + rnd() * (this.W - 120);
      const y = 90 + rnd() * (this.H - 150);
      if (this.overlapsBuilding(x, y, 90)) continue;
      if (Math.abs(x - 780) < 130 && y > 560) continue; // 中央の広場は空けておく
      const kind = rnd() < 0.42 ? 'tree' : rnd() < 0.6 ? 'bush' : rnd() < 0.8 ? 'flower' : 'stone';
      this.props.push({ kind, x, y, s: 0.8 + rnd() * 0.5, hue: rnd() });
    }
    this.props.push({ kind: 'fountain', x: 780, y: 660, s: 1, hue: 0 });
    this.props.sort((a, b) => a.y - b.y);

    for (let i = 0; i < 26; i++) {
      this.petals.push({ x: rnd() * this.W, y: rnd() * this.H, s: 0.6 + rnd() * 0.8, ph: rnd() * 6.28 });
    }

    if (G.gardenPos) { this.player.x = G.gardenPos.x; this.player.y = G.gardenPos.y; }
    this.syncNpcs();
  },

  overlapsBuilding(x, y, pad) {
    return this.facilities.some((f) => x > f.x - pad && x < f.x + f.w + pad && y > f.y - pad && y < f.y + f.h + pad + 40);
  },

  /** 編成中の選手を庭に立たせる */
  syncNpcs() {
    const cap = this.captainId();
    const ids = G.lineup.filter((id) => id && CHAR_BY_ID[id] && id !== cap);
    const spots = [
      { x: 560, y: 720 }, { x: 640, y: 800 }, { x: 900, y: 780 },
      { x: 980, y: 700 }, { x: 700, y: 880 }, { x: 860, y: 880 },
    ];
    this.npcs = ids.map((id, i) => {
      const old = this.npcs.find((n) => n.id === id);
      const s = spots[i % spots.length];
      return old || {
        id, char: CHAR_BY_ID[id],
        x: s.x, y: s.y, hx: s.x, hy: s.y,
        vx: 0, vy: 0, dir: 0, walk: 0,
        wait: rand(3, 0.5),
      };
    });
  },

  /* ---------- 更新 ---------- */
  update(dt) {
    this.t += dt;
    const p = this.player;
    const ax = Input.axis();
    const sp = p.speed * dt * 60;
    p.vx = lerp(p.vx, ax.x * sp, 0.35);
    p.vy = lerp(p.vy, ax.y * sp, 0.35);
    p.x = clamp(p.x + p.vx, 40, this.W - 40);
    p.y = clamp(p.y + p.vy, 110, this.H - 40);

    // 建物にはめり込まない
    this.facilities.forEach((f) => {
      if (p.x > f.x - 18 && p.x < f.x + f.w + 18 && p.y > f.y + 40 && p.y < f.y + f.h + 14) {
        const cx = f.x + f.w / 2, cy = f.y + f.h / 2 + 20;
        if (Math.abs(p.x - cx) / (f.w / 2) > Math.abs(p.y - cy) / (f.h / 2)) {
          p.x = p.x < cx ? f.x - 18 : f.x + f.w + 18;
        } else {
          p.y = p.y < cy ? f.y + 38 : f.y + f.h + 14;
        }
      }
    });

    const moving = Math.hypot(p.vx, p.vy) > 0.4;
    if (moving) { p.walk += dt * 11; p.dir = Math.atan2(p.vy, p.vx); }
    else p.walk = 0;

    // NPC はゆるく歩き回る
    this.npcs.forEach((n) => {
      n.wait -= dt;
      if (n.wait <= 0) {
        n.wait = rand(4.5, 1.5);
        const a = rand(Math.PI * 2), r = rand(70, 10);
        n.tx = clamp(n.hx + Math.cos(a) * r, 60, this.W - 60);
        n.ty = clamp(n.hy + Math.sin(a) * r, 140, this.H - 60);
      }
      if (n.tx != null) {
        const d = dist(n.x, n.y, n.tx, n.ty);
        if (d > 4) {
          const s = 1.1 * dt * 60;
          n.vx = (n.tx - n.x) / d * s; n.vy = (n.ty - n.y) / d * s;
          n.x += n.vx; n.y += n.vy; n.walk += dt * 8; n.dir = Math.atan2(n.vy, n.vx);
        } else { n.walk = 0; n.vx = n.vy = 0; }
      }
    });

    // カメラ
    const vw = R.w, vh = R.h;
    const tx = clamp(p.x - vw / 2, 0, Math.max(0, this.W - vw));
    const ty = clamp(p.y - vh / 2, 0, Math.max(0, this.H - vh));
    this.cam.x = lerp(this.cam.x, tx, 0.12);
    this.cam.y = lerp(this.cam.y, ty, 0.12);

    // 施設の判定
    let near = null, best = 96 * 96;
    this.facilities.forEach((f) => {
      const d = dist2(p.x, p.y, f.door.x, f.door.y);
      if (d < best) { best = d; near = f; }
    });
    if (near !== this.near) {
      this.near = near;
      const el = $('interact-prompt');
      if (near) {
        el.classList.remove('hidden');
        el.querySelector('.txt').textContent = `${near.icon} ${near.label}`;
        el.onclick = () => this.enter();
      } else el.classList.add('hidden');
    }
    if (near && (Input.pressed('e') || Input.pressed('d'))) this.enter();
  },

  enter() {
    if (!this.near || UI.anyOpen()) return;
    Sound.sfx('door');
    G.gardenPos = { x: this.player.x, y: this.player.y };
    Save.save();
    this.near.action();
  },

  /* ---------- 描画 ---------- */
  draw(ctx) {
    const cam = this.cam;
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

    // 芝
    ctx.fillStyle = '#2f6b34';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let y = 0; y < this.H; y += 76) ctx.fillRect(0, y, this.W, 38);
    // 芝の濃淡
    const rnd = mulberry32(7);
    ctx.fillStyle = 'rgba(20,60,26,.28)';
    for (let i = 0; i < 90; i++) {
      const x = rnd() * this.W, y = rnd() * this.H, r = 30 + rnd() * 90;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }

    // 小道
    this.drawPath(ctx);

    // 外柵
    ctx.strokeStyle = '#6b5233'; ctx.lineWidth = 8;
    ctx.strokeRect(16, 76, this.W - 32, this.H - 96);
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2;
    ctx.strokeRect(16, 76, this.W - 32, this.H - 96);

    // 建物と飾りを奥から順に
    const drawables = [];
    this.facilities.forEach((f) => drawables.push({ y: f.y + f.h, draw: () => this.drawBuilding(ctx, f) }));
    this.props.forEach((p) => drawables.push({ y: p.y, draw: () => this.drawProp(ctx, p) }));
    this.npcs.forEach((n) => drawables.push({ y: n.y, draw: () => this.drawPerson(ctx, n.x, n.y, n.char, n.dir, n.walk, false) }));
    const cap = this.captainChar();
    drawables.push({ y: this.player.y, draw: () => this.drawPerson(ctx, this.player.x, this.player.y, cap, this.player.dir, this.player.walk, true) });
    drawables.sort((a, b) => a.y - b.y);
    drawables.forEach((d) => d.draw());

    // 花びら
    ctx.fillStyle = 'rgba(255,225,240,.55)';
    this.petals.forEach((p) => {
      const x = p.x + Math.sin(this.t * 0.6 + p.ph) * 26;
      const y = (p.y + this.t * 16 * p.s) % this.H;
      ctx.beginPath(); ctx.ellipse(x, y, 3.4 * p.s, 2 * p.s, this.t + p.ph, 0, Math.PI * 2); ctx.fill();
    });

    ctx.restore();

    // 画面全体の色味
    const vg = ctx.createRadialGradient(R.w / 2, R.h / 2, R.h * 0.32, R.w / 2, R.h / 2, R.h * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(2,6,12,.46)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, R.w, R.h);
    ctx.fillStyle = 'rgba(255,208,140,.05)'; ctx.fillRect(0, 0, R.w, R.h);
  },

  /** キャプテン＝編成の中で一番強いフィールドプレイヤー */
  captainId() {
    const ids = G.lineup.filter((x) => x && CHAR_BY_ID[x]);
    const field = ids.filter((x) => CHAR_BY_ID[x].pos !== 'GK');
    const pool = field.length ? field : ids.length ? ids : Object.keys(G.owned);
    let best = pool[0], bestR = -1;
    pool.forEach((id) => {
      const r = charRating(G.owned[id], CHAR_BY_ID[id]);
      if (r > bestR) { bestR = r; best = id; }
    });
    return best;
  },
  captainChar() { return CHAR_BY_ID[this.captainId()] || CHARACTERS[0]; },

  drawPath(ctx) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const routes = [
      [[780, 940], [780, 660], [790, 360]],
      [[780, 700], [520, 640], [330, 570]],
      [[780, 700], [1040, 640], [1250, 585]],
      [[1250, 620], [1230, 780], [1195, 950]],
    ];
    routes.forEach((r) => {
      ctx.strokeStyle = '#9a7d52'; ctx.lineWidth = 40;
      ctx.beginPath(); ctx.moveTo(r[0][0], r[0][1]);
      for (let i = 1; i < r.length; i++) ctx.lineTo(r[i][0], r[i][1]);
      ctx.stroke();
      ctx.strokeStyle = '#b39566'; ctx.lineWidth = 32;
      ctx.stroke();
    });
  },

  drawProp(ctx, p) {
    const { x, y, s } = p;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.26)';
    if (p.kind === 'tree') {
      ctx.beginPath(); ctx.ellipse(0, 4, 26 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b4a28'; ctx.fillRect(-5 * s, -26 * s, 10 * s, 30 * s);
      const g = ctx.createRadialGradient(-8 * s, -52 * s, 4, 0, -44 * s, 40 * s);
      g.addColorStop(0, '#6fbf4a'); g.addColorStop(1, '#2e6b2c');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -46 * s, 32 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-20 * s, -32 * s, 20 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(20 * s, -34 * s, 21 * s, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'bush') {
      ctx.beginPath(); ctx.ellipse(0, 3, 20 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f8a3a';
      [[-10, 0, 13], [8, -2, 14], [0, -10, 13]].forEach((b) => {
        ctx.beginPath(); ctx.arc(b[0] * s, b[1] * s, b[2] * s, 0, Math.PI * 2); ctx.fill();
      });
    } else if (p.kind === 'flower') {
      const cols = ['#ff7ea8', '#ffd23f', '#9fd8ff', '#ffffff'];
      for (let i = 0; i < 5; i++) {
        const a = i * 1.9 + p.hue * 6;
        const fx = Math.cos(a) * 12 * s, fy = Math.sin(a) * 7 * s;
        ctx.fillStyle = cols[Math.floor(p.hue * 4) % 4];
        ctx.beginPath(); ctx.arc(fx, fy, 3.4 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffe36a';
        ctx.beginPath(); ctx.arc(fx, fy, 1.3 * s, 0, Math.PI * 2); ctx.fill();
      }
    } else if (p.kind === 'stone') {
      ctx.beginPath(); ctx.ellipse(0, 2, 14 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8d9298';
      ctx.beginPath(); ctx.ellipse(0, -3, 12 * s, 9 * s, 0.3, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'fountain') {
      ctx.beginPath(); ctx.ellipse(0, 10, 74, 30, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b9b2a4';
      ctx.beginPath(); ctx.ellipse(0, 0, 72, 30, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f7fb5';
      ctx.beginPath(); ctx.ellipse(0, 0, 60, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      for (let i = 0; i < 3; i++) {
        const rr = ((this.t * 22 + i * 20) % 58);
        ctx.globalAlpha = 0.4 * (1 - rr / 58);
        ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#cfd8dd';
      ctx.fillRect(-7, -34, 14, 34);
      ctx.beginPath(); ctx.arc(0, -38, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(190,230,255,.75)';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + this.t;
        const rr = 12 + (this.t * 40 + i * 7) % 26;
        ctx.beginPath(); ctx.arc(Math.cos(a) * rr, -34 + Math.sin(a) * rr * 0.4 + rr * 0.5, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  },

  drawBuilding(ctx, f) {
    const { x, y, w, h } = f;
    ctx.save();
    // 影
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h + 8, w * 0.56, 18, 0, 0, Math.PI * 2); ctx.fill();

    // 本体
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, shade(f.color, 0.18)); g.addColorStop(1, shade(f.color, -0.3));
    ctx.fillStyle = g;
    ctx.fillRect(x, y + 34, w, h - 34);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(x, y + h - 12, w, 12);

    // 屋根
    ctx.fillStyle = f.roof;
    if (f.style === 'tent') {
      ctx.beginPath();
      ctx.moveTo(x - 16, y + 44); ctx.lineTo(x + w / 2, y - 16); ctx.lineTo(x + w + 16, y + 44);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y - 16);
        ctx.lineTo(x - 16 + (w + 32) * (i / 5), y + 44);
        ctx.lineTo(x - 16 + (w + 32) * ((i + 0.5) / 5), y + 44);
        ctx.closePath(); if (i % 2 === 0) ctx.fill();
      }
    } else if (f.style === 'stadium') {
      ctx.fillRect(x - 18, y + 6, w + 36, 34);
      ctx.fillStyle = shade(f.roof, 0.25);
      ctx.fillRect(x - 18, y + 6, w + 36, 8);
      // 照明塔
      [x - 6, x + w + 6].forEach((lx) => {
        ctx.fillStyle = '#8a97a6'; ctx.fillRect(lx - 4, y - 68, 8, 74);
        ctx.fillStyle = '#e9f2ff'; ctx.fillRect(lx - 18, y - 84, 36, 18);
        ctx.fillStyle = 'rgba(255,250,210,.28)';
        ctx.beginPath(); ctx.moveTo(lx - 18, y - 68); ctx.lineTo(lx + 18, y - 68);
        ctx.lineTo(lx + 60, y + 90); ctx.lineTo(lx - 60, y + 90); ctx.closePath(); ctx.fill();
      });
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 14, y + 40); ctx.lineTo(x + 18, y + 2); ctx.lineTo(x + w - 18, y + 2); ctx.lineTo(x + w + 14, y + 40);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(x - 14, y + 34, w + 28, 6);
    }

    // 窓
    ctx.fillStyle = 'rgba(255,240,190,.75)';
    const wn = Math.max(2, Math.floor(w / 90));
    for (let i = 0; i < wn; i++) {
      const wx = x + 22 + i * ((w - 44) / wn);
      ctx.fillRect(wx, y + 56, 30, 24);
    }

    // 扉
    const dx = f.door.x - 24, dy = y + h - 46;
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(dx, dy, 48, 46);
    ctx.fillStyle = 'rgba(255,220,140,.35)'; ctx.fillRect(dx + 4, dy + 4, 40, 38);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(dx + 40, dy + 26, 3, 0, Math.PI * 2); ctx.fill();

    // 看板
    const sx = x + w / 2, sy = y + 40;
    ctx.fillStyle = 'rgba(8,12,18,.82)';
    const label = `${f.icon} ${f.label}`;
    ctx.font = '900 17px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 26;
    ctx.beginPath(); ctx.roundRect(sx - tw / 2, sy - 2, tw, 28, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, sy + 13);

    // 近づいたら光る
    if (this.near === f) {
      ctx.strokeStyle = 'rgba(255,215,110,.9)'; ctx.lineWidth = 3;
      ctx.setLineDash([9, 7]); ctx.lineDashOffset = -this.t * 26;
      ctx.strokeRect(x - 6, y + 28, w + 12, h - 22);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,215,110,.9)';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText(f.sub, sx, y + h + 26);
    }
    ctx.restore();
  },

  /** 庭にいる人（真上から見た簡易スプライト） */
  drawPerson(ctx, x, y, char, dir, walk, isPlayer) {
    const el = ELEMENTS[char.elem];
    const bob = Math.sin(walk) * 2.2;
    const kit = isPlayer ? '#ffd23f' : '#e9f0fa';
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(0, 2, 11, 5, 0, 0, Math.PI * 2); ctx.fill();

    // 足
    ctx.fillStyle = '#2a3444';
    const lo = Math.sin(walk) * 4;
    ctx.fillRect(-6, -8 + lo * 0.3, 4.5, 9);
    ctx.fillRect(2, -8 - lo * 0.3, 4.5, 9);
    // 胴
    ctx.fillStyle = kit;
    ctx.beginPath(); ctx.roundRect(-8.5, -22 + bob, 17, 16, 5); ctx.fill();
    ctx.fillStyle = rgba(el.color, 0.85);
    ctx.fillRect(-8.5, -14 + bob, 17, 3);
    // 頭
    ctx.fillStyle = char.look.skin;
    ctx.beginPath(); ctx.arc(0, -27 + bob, 8, 0, Math.PI * 2); ctx.fill();
    // 髪（上から見えるぶんだけ）
    ctx.fillStyle = char.look.hair;
    ctx.beginPath(); ctx.arc(0, -28.5 + bob, 8.2, Math.PI * 0.05, Math.PI * 0.95, true); ctx.fill();
    if (char.look.style === 'spike') {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 3, -34 + bob); ctx.lineTo(i * 3 + 1.6, -39 + bob); ctx.lineTo(i * 3 + 3.2, -34 + bob);
        ctx.fill();
      }
    } else if (char.look.style === 'long' || char.look.style === 'ponytail' || char.look.style === 'braid') {
      ctx.beginPath(); ctx.ellipse(0, -24 + bob, 8.6, 7, 0, 0, Math.PI); ctx.fill();
    }
    // 向き
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath();
    ctx.arc(Math.cos(dir) * 6, -27 + bob + Math.sin(dir) * 3, 1.8, 0, Math.PI * 2); ctx.fill();

    // 名前
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(4,8,14,.7)';
    const tw = ctx.measureText(char.name).width + 10;
    ctx.beginPath(); ctx.roundRect(-tw / 2, -50 + bob, tw, 15, 5); ctx.fill();
    ctx.fillStyle = isPlayer ? '#ffd23f' : '#dfe9f7';
    ctx.fillText(char.name, 0, -37 + bob);

    if (isPlayer) {
      ctx.fillStyle = 'rgba(255,210,63,.9)';
      const t = Math.sin(this.t * 4) * 2;
      ctx.beginPath();
      ctx.moveTo(0, -56 + t + bob); ctx.lineTo(-6, -66 + t + bob); ctx.lineTo(6, -66 + t + bob);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },
};

/* =========================================================================
   ガチャ
   ========================================================================= */
const GachaUI = {
  fxRaf: null, fxT: 0, particles: [], topRarity: 2, results: [], revealed: false,

  open() {
    this.refresh();
    UI.show('panel-gacha');
  },
  refresh() {
    updateWallet();
    $('pity-left').textContent = Math.max(0, GACHA.pity - G.pity);
    const counts = { 2: 0, 3: 0, 4: 0, 5: 0 };
    Object.keys(G.owned).forEach((id) => { counts[CHAR_BY_ID[id].rarity]++; });
    const totals = { 2: 0, 3: 0, 4: 0, 5: 0 };
    CHARACTERS.forEach((c) => totals[c.rarity]++);
    $('rate-table').innerHTML = [5, 4, 3, 2].map((r) => {
      const R_ = RARITY[r];
      return `<div class="rate-cell"><div class="rc-star" style="color:${R_.color}">${'★'.repeat(r)}</div>
        <div class="rc-rate" style="color:${R_.color}">${(R_.rate * 100).toFixed(0)}%</div>
        <div class="rc-cnt">${counts[r]} / ${totals[r]} 人</div></div>`;
    }).join('');
    $('btn-pull1').disabled = G.tickets < GACHA.single.cost;
    $('btn-pull10').disabled = G.tickets < GACHA.multi.cost;
  },

  rollRarity(forceMin) {
    if (forceMin === 5) return 5;
    const r = Math.random();
    let acc = 0;
    for (const star of [5, 4, 3, 2]) {
      acc += RARITY[star].rate;
      if (r < acc) return forceMin && star < forceMin ? forceMin : star;
    }
    return forceMin || 2;
  },
  rollChar(star) {
    const pool = CHARACTERS.filter((c) => c.rarity === star);
    return pick(pool);
  },

  pull(n) {
    const cost = n === 1 ? GACHA.single.cost : GACHA.multi.cost;
    if (G.tickets < cost) { Sound.sfx('error'); UI.toast('チケットが足りません', 'bad'); return; }
    G.tickets -= cost;
    const out = [];
    for (let i = 0; i < n; i++) {
      G.pulls++; G.pity++;
      let forceMin = null;
      if (G.pity >= GACHA.pity) forceMin = 5;
      // 10連の最後は★4以上を保証する
      if (n === 10 && i === 9 && !out.some((o) => o.char.rarity >= 4)) forceMin = Math.max(4, forceMin || 0);
      const star = this.rollRarity(forceMin);
      if (star === 5) G.pity = 0;
      const char = this.rollChar(star);
      const res = addChar(char.id);
      out.push({ char, ...res });
    }
    Save.save();
    this.results = out;
    this.topRarity = Math.max(...out.map((o) => o.char.rarity));
    this.show();
  },

  show() {
    UI.hide('panel-gacha');
    $('gacha-results').innerHTML = '';
    $('gacha-results').className = 'gacha-results' + (this.results.length === 1 ? ' single' : '');
    $('gacha-done').classList.add('hidden');
    $('gacha-skip').classList.remove('hidden');
    $('gacha-stage').classList.remove('hidden');
    this.revealed = false;
    this.fxT = 0;
    this.particles = [];
    const col = RARITY[this.topRarity].color;
    for (let i = 0; i < 190; i++) {
      const a = rand(Math.PI * 2), d = rand(1, 0.2);
      this.particles.push({ a, d, sp: rand(1.5, 0.5), size: rand(3.4, 1), col });
    }
    Sound.sfx('gachaRoll');
    this.startFx();
    this.revealTimer = setTimeout(() => this.reveal(), 1500);
  },

  startFx() {
    const cv = $('gacha-fx');
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = () => { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; };
    fit();
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.fxT += dt;
      if (cv.clientWidth * dpr !== cv.width) fit();
      const w = cv.width / dpr, h = cv.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const col = RARITY[this.topRarity].color;

      // 回転する光条
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(this.fxT * 0.25);
      ctx.globalAlpha = this.revealed ? 0.16 : 0.32;
      for (let i = 0; i < 16; i++) {
        ctx.rotate(Math.PI * 2 / 16);
        ctx.fillStyle = rgba(col, 0.5);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, -h * 0.03); ctx.lineTo(w, h * 0.03); ctx.fill();
      }
      ctx.restore();

      if (!this.revealed) {
        // 集まる粒子 → 爆発
        const t = Math.min(1, this.fxT / 1.4);
        this.particles.forEach((p) => {
          const rr = (1 - easeOut(t)) * p.d * Math.max(w, h) * 0.65 + 12;
          const x = cx + Math.cos(p.a + this.fxT * p.sp) * rr;
          const y = cy + Math.sin(p.a + this.fxT * p.sp) * rr * 0.8;
          ctx.fillStyle = p.col; ctx.globalAlpha = 0.85;
          ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + easeIn(t) * 340);
        glow.addColorStop(0, rgba(col, 0.95)); glow.addColorStop(0.4, rgba(col, 0.35)); glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
      }
      this.fxRaf = requestAnimationFrame(loop);
    };
    this.fxRaf = requestAnimationFrame(loop);
  },

  reveal() {
    if (this.revealed) return;
    this.revealed = true;
    clearTimeout(this.revealTimer);
    $('gacha-skip').classList.add('hidden');
    const box = $('gacha-results');
    box.innerHTML = '';
    const single = this.results.length === 1;
    this.results.forEach((res, i) => {
      const c = res.char;
      const card = document.createElement('div');
      card.className = `card r${c.rarity}`;
      card.style.animationDelay = `${i * 0.09}s`;
      const cw = single ? 240 : 168, chh = single ? 300 : 210;
      const cv = portraitCanvas(c, cw, chh, {});
      card.appendChild(cv);
      const badge = res.isNew ? '<span class="c-new">NEW</span>'
        : res.broke ? '<span class="c-dupe">凸+1</span>'
        : `<span class="c-dupe">🎟️+${res.refund}</span>`;
      const foot = document.createElement('div');
      foot.className = 'c-foot';
      foot.innerHTML = `<div class="c-name">${c.name}</div>
        <div class="c-meta"><span style="color:${POSITIONS[c.pos].color}">${c.pos}</span>
        <span>${ELEMENTS[c.elem].name}</span><span>${ELEMENTS[c.elem].icon}</span></div>`;
      card.appendChild(foot);
      card.insertAdjacentHTML('beforeend', `<span class="c-stars" style="color:${RARITY[c.rarity].color}">${'★'.repeat(c.rarity)}</span>${badge}`);
      card.onclick = () => CharUI.open(c.id);
      box.appendChild(card);
      setTimeout(() => {
        if (c.rarity >= 5) Sound.sfx('rare5');
        else if (c.rarity === 4) Sound.sfx('rare4');
        else Sound.sfx('rare3');
      }, i * 90);
    });
    $('gacha-done').classList.remove('hidden');
    updateWallet();
  },

  close() {
    cancelAnimationFrame(this.fxRaf);
    clearTimeout(this.revealTimer);
    $('gacha-stage').classList.add('hidden');
    Garden.syncNpcs();
    autoLineup();
    Save.save();
    this.refresh();
    UI.show('panel-gacha');
  },
};

/* =========================================================================
   編成
   ========================================================================= */
const TeamUI = {
  selectedSlot: null, filter: 'ALL', sort: 'rating',

  open() { this.render(); UI.show('panel-team'); },

  render() {
    const fm = FORMATION_BY_ID[G.formation];
    const sel = $('formation-select');
    if (!sel.options.length) {
      sel.innerHTML = FORMATIONS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
      sel.onchange = () => {
        G.formation = sel.value;
        this.selectedSlot = null;
        autoLineup();
        Save.save(); this.render(); Garden.syncNpcs();
      };
    }
    sel.value = G.formation;
    $('formation-bonus').textContent = fm.desc + '（' + fm.bonus.label + '）';
    $('team-rating').textContent = teamRating();
    this.renderPitch();
    this.renderChem();
    this.renderRoster();
  },

  renderPitch() {
    const fm = FORMATION_BY_ID[G.formation];
    const pitch = $('mini-pitch');
    pitch.innerHTML = '<div class="mp-mid"></div><div class="mp-circle"></div>';
    fm.slots.forEach((slot, i) => {
      // ミニピッチは縦向き（下が自陣）
      const left = slot.y * 100;
      const top = (1 - slot.x) * 100;
      const id = G.lineup[i];
      const char = id ? CHAR_BY_ID[id] : null;
      const d = document.createElement('div');
      d.className = 'slot' + (char ? '' : ' empty') + (this.selectedSlot === i ? ' selected' : '');
      if (char && posFitFactor(char.pos, slot.role) < 0.95) d.classList.add('warn');
      d.style.left = `${clamp(left, 8, 92)}%`;
      d.style.top = `${clamp(top, 7, 93)}%`;
      const av = document.createElement('div');
      av.className = 's-av';
      if (char) av.appendChild(portraitCanvas(char, 44, 44, { plain: true }));
      else av.textContent = slot.role;
      d.appendChild(av);
      const nm = document.createElement('div');
      nm.className = 's-name';
      nm.textContent = char ? char.name : '空き';
      d.appendChild(nm);
      d.insertAdjacentHTML('beforeend', `<span class="s-role" style="color:${POSITIONS[slot.role].color}">${slot.role}</span>`);
      d.onclick = () => {
        if (this.selectedSlot === i) this.selectedSlot = null;
        else this.selectedSlot = i;
        Sound.sfx('ui');
        this.render();
        $('team-hint').textContent = this.selectedSlot != null
          ? `${fm.slots[this.selectedSlot].role} に入れる選手を右から選んでください（もう一度スロットを押すと解除）`
          : 'スロットを選んでから選手を選ぶと配置できます。';
      };
      pitch.appendChild(d);
    });
  },

  renderChem() {
    const chem = chemistryOf(G.lineup);
    const fm = FORMATION_BY_ID[G.formation];
    const box = $('chem-box');
    const tags = [`<span class="chem-tag" style="border-color:rgba(255,207,77,.6);color:#ffcf4d">隊形 ${fm.bonus.label}</span>`];
    Object.keys(chem.count).sort((a, b) => chem.count[b] - chem.count[a]).forEach((e) => {
      const el = ELEMENTS[e];
      const b = chem.bonus[e];
      tags.push(`<span class="chem-tag ${b ? 'on' : ''}" style="${b ? `background:${el.color};` : `color:${el.color};`}">
        ${el.icon} ${el.name}${chem.count[e]}${b ? ` +${Math.round(b * 100)}%` : ''}</span>`);
    });
    const empty = G.lineup.filter((x) => !x).length;
    if (empty) tags.push(`<span class="chem-tag" style="color:#ff5f7e">空きスロット ${empty}</span>`);
    box.innerHTML = tags.join('');
  },

  renderRoster() {
    const list = $('roster-list');
    const fm = FORMATION_BY_ID[G.formation];
    const slotRole = this.selectedSlot != null ? fm.slots[this.selectedSlot].role : null;
    let ids = Object.keys(G.owned);
    if (this.filter !== 'ALL') ids = ids.filter((id) => CHAR_BY_ID[id].pos === this.filter);
    const rate = (id) => charRating(G.owned[id], CHAR_BY_ID[id], slotRole || CHAR_BY_ID[id].pos);
    ids.sort((a, b) => {
      const ca = CHAR_BY_ID[a], cb = CHAR_BY_ID[b];
      if (this.sort === 'rarity') return cb.rarity - ca.rarity || rate(b) - rate(a);
      if (this.sort === 'level') return G.owned[b].lv - G.owned[a].lv || rate(b) - rate(a);
      if (this.sort === 'pos') return POS_ORDER[ca.pos] - POS_ORDER[cb.pos] || rate(b) - rate(a);
      return rate(b) - rate(a);
    });
    $('roster-count').textContent = Object.keys(G.owned).length;
    list.innerHTML = '';
    ids.forEach((id) => {
      const c = CHAR_BY_ID[id], rec = G.owned[id];
      const inTeam = G.lineup.indexOf(id);
      const d = document.createElement('div');
      d.className = 'r-card' + (inTeam >= 0 ? ' in-team' : '');
      const av = document.createElement('div');
      av.className = 'rc-av';
      av.appendChild(portraitCanvas(c, 38, 38, { plain: true }));
      d.appendChild(av);
      const info = document.createElement('div');
      info.className = 'rc-info';
      info.innerHTML = `<div class="rc-name">${c.name}</div>
        <div class="rc-line">
          <span class="rc-pos" style="background:${POSITIONS[c.pos].color}">${c.pos}</span>
          <span class="rc-stars" style="color:${RARITY[c.rarity].color}">${'★'.repeat(c.rarity)}</span>
          <span style="color:${ELEMENTS[c.elem].color}">${ELEMENTS[c.elem].icon}</span>
          <span>Lv${rec.lv}${rec.breaks ? ` +${rec.breaks}` : ''}</span>
        </div>`;
      d.appendChild(info);
      d.insertAdjacentHTML('beforeend', `<div class="rc-rate">${rate(id)}</div>`);
      d.onclick = () => {
        if (this.selectedSlot == null) { CharUI.open(id); return; }
        const cur = G.lineup.indexOf(id);
        const prev = G.lineup[this.selectedSlot];
        if (cur >= 0) G.lineup[cur] = prev;   // 入れ替え
        G.lineup[this.selectedSlot] = id;
        Sound.sfx('coin');
        this.selectedSlot = null;
        Save.save(); this.render(); Garden.syncNpcs();
        $('team-hint').textContent = `${c.name} を配置しました。`;
      };
      list.appendChild(d);
    });
    if (!ids.length) list.innerHTML = '<p style="color:#91a6c0;font-size:13px">該当する選手がいません。</p>';
  },

  initEvents() {
    $$('.fbtn').forEach((b) => {
      b.onclick = () => {
        $$('.fbtn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.filter = b.dataset.filter;
        this.renderRoster();
      };
    });
    $('roster-sort').onchange = (e) => { this.sort = e.target.value; this.renderRoster(); };
    $('btn-auto-team').onclick = () => {
      autoLineup(true);
      Sound.sfx('levelup');
      Save.save(); this.render(); Garden.syncNpcs();
      $('team-hint').textContent = '所持選手から自動で組みました。';
    };
  },
};

/* =========================================================================
   選手詳細
   ========================================================================= */
const CharUI = {
  open(id) {
    const c = CHAR_BY_ID[id];
    const rec = G.owned[id];
    const box = $('char-detail');
    const el = ELEMENTS[c.elem];
    const rar = RARITY[c.rarity];
    const st = rec ? baseStats(rec, c) : c.base;
    const maxLv = rec ? maxLevel(rec) : GROWTH.maxLevelBase;
    const need = rec ? expToNext(rec.lv) : 0;
    const statRow = (k, lab) => {
      const v = Math.round(st[k]);
      return `<div class="stat-row"><span>${lab}</span>
        <div class="bar"><i style="width:${clamp(v, 0, 120) / 1.2}%;background:linear-gradient(90deg,${el.color},${shade(el.color, 0.4)})"></i></div>
        <b>${v}</b></div>`;
    };
    const hb = c.hissatsu ? `
      <div class="hissatsu-box">
        <div class="hb-head">
          <span class="hb-name" style="color:${el.color}">${c.hissatsu.name}</span>
          <span class="hb-type">${HISSATSU_LABEL[c.hissatsu.type]}</span>
          <span class="hb-cost">SP ${c.hissatsu.cost}</span>
        </div>
        <p>${c.hissatsu.desc}</p>
      </div>` : '<div class="hissatsu-box"><p style="color:#91a6c0;margin:0">必殺技を持っていません。</p></div>';

    box.innerHTML = `
      <div class="cd-top">
        <div class="cd-portrait" id="cd-portrait"></div>
        <div class="cd-meta">
          <div class="cd-stars" style="color:${rar.color}">${'★'.repeat(c.rarity)}<span style="color:#4a5a6e">${'★'.repeat(5 - c.rarity)}</span>
            <span style="font-size:11px;color:${rar.color};margin-left:6px">${rar.label}</span></div>
          <h3 class="cd-name">${c.name}</h3>
          <div class="cd-kana">${c.kana}　No.${c.no}</div>
          <div class="cd-badges">
            <span class="cd-badge" style="background:${POSITIONS[c.pos].color};color:#04121c">${c.pos} ${POSITIONS[c.pos].full}</span>
            <span class="cd-badge" style="background:${el.color};color:#141018">${el.icon} ${el.name}属性</span>
            ${rec && rec.breaks ? `<span class="cd-badge" style="background:#ffcf4d;color:#2a1a00">限界突破 +${rec.breaks}</span>` : ''}
          </div>
          <div class="cd-bio">${c.bio}</div>
        </div>
      </div>
      <div class="cd-body">
        ${rec ? `<div class="cd-lv">
          <span class="lv">Lv ${rec.lv}<span style="font-size:12px;color:#91a6c0"> / ${maxLv}</span></span>
          <span class="exp-bar"><i style="width:${rec.lv >= maxLv ? 100 : (rec.exp / need) * 100}%"></i></span>
          <span class="exp-txt">${rec.lv >= maxLv ? '上限（ガチャの被りで解放）' : `次まで ${need - rec.exp}`}</span>
        </div>` : '<p style="color:#91a6c0;font-size:12px;margin:0 0 10px">まだ所持していません。</p>'}
        <div class="stat-rows">
          ${statRow('sho', 'シュート')}${statRow('pas', 'パス')}${statRow('dri', 'ドリブル')}
          ${statRow('def', '守備')}${statRow('spd', 'スピード')}${statRow('cat', 'キャッチ')}
        </div>
        ${hb}
      </div>`;
    $('cd-portrait').appendChild(portraitCanvas(c, 128, 160, {}));
    UI.show('panel-char');
  },
};
const HISSATSU_LABEL = { shoot: 'シュート技', dribble: 'ドリブル技', block: 'ブロック技', catch: 'キャッチ技' };

/* =========================================================================
   ステージ選択
   ========================================================================= */
function stageUnlocked(id) { return id === 1 || !!G.cleared[id - 1]; }

const StageUI = {
  open() { this.render(); UI.show('panel-stage'); },
  render() {
    updateWallet();
    const list = $('stage-list');
    list.innerHTML = '';
    const chapters = { 1: '第1章　ルーキーリーグ', 2: '第2章　チャレンジャーカップ', 3: '第3章　ワールドファイナル' };
    let cur = 0;
    STAGES.forEach((s) => {
      if (s.chapter !== cur) {
        cur = s.chapter;
        list.insertAdjacentHTML('beforeend', `<div class="chapter-head">${chapters[cur]}</div>`);
      }
      const unlocked = stageUnlocked(s.id);
      const rec = G.cleared[s.id];
      const d = document.createElement('div');
      d.className = 'stage-card' + (unlocked ? '' : ' locked') + (s.boss ? ' boss' : '');
      d.innerHTML = `
        <div class="sc-flag" style="background:linear-gradient(150deg,${s.colors.main},${s.colors.sub})">${unlocked ? (s.boss ? '👑' : ELEMENTS[s.elem].icon) : '🔒'}</div>
        <div class="sc-info">
          <div class="sc-title">${unlocked ? s.name : '？？？'}
            ${rec ? '<span class="sc-clear">クリア</span>' : ''}
            <span class="sc-diff">${'★'.repeat(s.diff)}</span></div>
          <div class="sc-sub">${s.sub}${rec ? `　勝利 ${rec.wins}回` : ''}</div>
        </div>
        <div class="sc-reward">
          <div class="rw">🎟️ ${s.tickets}</div>
          <div class="rw-sub">${rec ? '勝利ごと' : `初回 +${s.first}`}</div>
        </div>`;
      if (unlocked) d.onclick = () => BriefUI.open(s);
      else d.onclick = () => { Sound.sfx('error'); UI.toast('前のステージに勝つと解放されます', 'bad'); };
      list.appendChild(d);
    });
  },
};

/* =========================================================================
   試合前ブリーフィング
   ========================================================================= */
const BriefUI = {
  stage: null,
  open(stage) {
    this.stage = stage;
    const squad = buildSquad();
    const enemy = buildEnemySquad(stage);
    const myRating = teamRating();
    const enRating = Math.round(enemy.reduce((s, p) => s + p.rating, 0) / enemy.length);
    const missing = G.lineup.filter((x) => !x).length;
    const chem = chemistryOf(G.lineup);
    $('brief-body').innerHTML = `
      <div class="brief-hero">
        <h2>${stage.name}</h2>
        <div class="bh-sub">${stage.sub}　${'★'.repeat(stage.diff)}</div>
        <p class="bh-intro">${stage.intro}</p>
      </div>
      <div class="vs-row">
        <div class="vs-side">
          <h4>あなたのチーム</h4>
          <div class="vs-team">${G.clubName}</div>
          <div class="vs-rating">${myRating}</div>
          <ul>${squad.filter(Boolean).slice(0, 6).map((p) => `<li>${p.slot.role} ${p.char.name}（${p.rating}）</li>`).join('')}</ul>
          ${chem.tags.length ? `<ul style="color:#3ddc97">${chem.tags.map((t) => `<li>${ELEMENTS[t.elem].name}属性 ${t.n}人 +${Math.round(t.bonus * 100)}%</li>`).join('')}</ul>` : ''}
          ${missing ? `<ul style="color:#ff5f7e"><li>空きスロットが ${missing} あります</li></ul>` : ''}
        </div>
        <div class="vs-mid">VS</div>
        <div class="vs-side enemy">
          <h4>相手チーム</h4>
          <div class="vs-team">${stage.name}</div>
          <div class="vs-rating">${enRating}</div>
          <ul>${enemy.map((p) => `<li>${p.role} ${p.name}${p.hissatsu ? `　<span style="color:#ffcf4d">${p.hissatsu.name}</span>` : ''}</li>`).join('')}</ul>
        </div>
      </div>
      <div style="padding:0 20px 12px;font-size:12px;color:#91a6c0">
        勝利報酬 🎟️ ${stage.tickets}${G.cleared[stage.id] ? '' : `　初回クリア報酬 🎟️ +${stage.first}`}　／　引き分けでも 🎟️ ${Math.max(1, Math.floor(stage.tickets / 3))}
      </div>`;
    $('btn-kickoff').disabled = squad.filter(Boolean).length === 0;
    UI.show('panel-brief');
  },
};

/* =========================================================================
   図鑑・戦績
   ========================================================================= */
const DexUI = {
  open() { this.render(); UI.show('panel-dex'); },
  render() {
    const ownedN = Object.keys(G.owned).length;
    $('dex-rate').textContent = `${Math.round(ownedN / CHARACTERS.length * 100)}%`;
    const s = G.stats;
    $('record-strip').innerHTML = `
      <div class="rec-chip"><div class="rc-lab">戦績</div><div class="rc-val">${s.wins}<span style="font-size:13px;color:#91a6c0">勝</span> ${s.draws}<span style="font-size:13px;color:#91a6c0">分</span> ${s.losses}<span style="font-size:13px;color:#91a6c0">敗</span></div></div>
      <div class="rec-chip"><div class="rc-lab">得点 / 失点</div><div class="rc-val">${s.gf} / ${s.ga}</div></div>
      <div class="rec-chip"><div class="rc-lab">必殺ゴール</div><div class="rc-val" style="color:#ffcf4d">${s.hissatsuGoals}</div></div>
      <div class="rec-chip"><div class="rc-lab">ガチャ回数</div><div class="rc-val" style="color:#c58bff">${G.pulls}</div></div>
      <div class="rec-chip"><div class="rc-lab">選手</div><div class="rc-val" style="color:#35e0ff">${ownedN} / ${CHARACTERS.length}</div></div>`;

    const grid = $('dex-grid');
    grid.innerHTML = '';
    [...CHARACTERS].sort((a, b) => b.rarity - a.rarity || POS_ORDER[a.pos] - POS_ORDER[b.pos]).forEach((c) => {
      const owned = !!G.owned[c.id];
      const d = document.createElement('div');
      d.className = 'dex-cell' + (owned ? '' : ' locked');
      const cv = portraitCanvas(c, 112, 123, { plain: !owned });
      cv.style.height = 'auto';   // 名前欄のぶんの高さを残す
      d.appendChild(cv);
      d.insertAdjacentHTML('beforeend',
        `<div class="dc-name">${owned ? c.name : '？？？'}</div>
         <span class="dc-stars" style="color:${RARITY[c.rarity].color}">${'★'.repeat(c.rarity)}</span>`);
      d.onclick = () => { if (owned) CharUI.open(c.id); else { Sound.sfx('error'); UI.toast('まだ発見していない選手です', 'bad'); } };
      grid.appendChild(d);
    });
  },
};
