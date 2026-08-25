/* =========================================================================
   MECH RAIDERS ― 描画
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData, F = window.MRField, B = window.MRBattle;
const { TAU, clamp, lerp, dist, angTo, angDiff, deg, rnd, roundRect } = C;
const Field = B.Field;

/* ---------------------------------------------------------------- 部品 */
function shadow(ctx, x, y, rx, ry, a) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath(); ctx.ellipse(x, y + ry * 0.35, rx, ry, 0, 0, TAU); ctx.fill();
}
function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = clamp(Math.round(r * k), 0, 255); g = clamp(Math.round(g * k), 0, 255); b = clamp(Math.round(b * k), 0, 255);
  return `rgb(${r},${g},${b})`;
}

/* 汎用の二足ロボ。脚は進行方向、上体は照準方向を向く */
function drawRobot(ctx, o, col, opt) {
  opt = opt || {};
  const R = o.r;
  const flash = o.hitFlash || 0;
  ctx.save();
  ctx.translate(o.x, o.y + (o.dropY || 0));

  /* ---- 脚 ---- */
  ctx.save();
  ctx.rotate(o.ang);
  const swing = Math.sin(o.walkPhase || 0) * R * 0.44;
  for (const s of [-1, 1]) {
    const off = s > 0 ? swing : -swing;
    ctx.save();
    ctx.translate(off * 0.55, s * R * 0.80);
    /* 太腿 */
    ctx.fillStyle = shade(col.body, 0.52);
    roundRect(ctx, -R * 0.62, -R * 0.28, R * 1.00, R * 0.56, R * 0.16); ctx.fill();
    ctx.strokeStyle = shade(col.body, 0.34); ctx.lineWidth = Math.max(1, R * 0.06); ctx.stroke();
    /* 脛と足 */
    ctx.fillStyle = shade(col.body, 0.86);
    roundRect(ctx, R * 0.04, -R * 0.24, R * 0.62, R * 0.48, R * 0.12); ctx.fill();
    ctx.fillStyle = shade(col.trim, 0.62);
    roundRect(ctx, R * 0.52, -R * 0.17, R * 0.28, R * 0.34, R * 0.08); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  /* ---- 上体 ---- */
  ctx.save();
  ctx.rotate(o.aim != null ? o.aim : o.ang);
  const rec = (o.recoil || 0) * R * 0.16;
  ctx.translate(-rec, 0);

  /* 背部スラスタ */
  ctx.fillStyle = shade(col.body, 0.5);
  roundRect(ctx, -R * 0.92, -R * 0.52, R * 0.42, R * 1.04, R * 0.14); ctx.fill();
  if (o.thrust) {
    const g = ctx.createLinearGradient(-R * 0.9, 0, -R * 2.0, 0);
    g.addColorStop(0, col.accent); g.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = g;
    poly(ctx, [[-R * 0.9, -R * 0.34], [-R * (1.5 + rnd(0.4)), 0], [-R * 0.9, R * 0.34]]); ctx.fill();
  }

  /* 肩ポッド */
  for (const s of [-1, 1]) {
    ctx.fillStyle = shade(col.body, 0.72);
    roundRect(ctx, -R * 0.40, s * R * 0.66 - R * 0.30, R * 0.84, R * 0.60, R * 0.16); ctx.fill();
    ctx.strokeStyle = shade(col.body, 0.40); ctx.lineWidth = Math.max(1, R * 0.06); ctx.stroke();
    ctx.fillStyle = col.trim;
    ctx.fillRect(-R * 0.12, s * R * 0.66 - R * 0.08, R * 0.46, R * 0.16);
  }

  /* 胴 */
  ctx.fillStyle = col.body;
  poly(ctx, [
    [R * 0.78, 0], [R * 0.44, -R * 0.46], [-R * 0.40, -R * 0.50],
    [-R * 0.62, 0], [-R * 0.40, R * 0.50], [R * 0.44, R * 0.46],
  ]);
  ctx.fill();
  ctx.strokeStyle = shade(col.body, 0.34); ctx.lineWidth = Math.max(1.2, R * 0.10); ctx.stroke();
  /* 胸部の意匠 */
  ctx.fillStyle = shade(col.body, 1.30);
  poly(ctx, [[R * 0.54, 0], [R * 0.20, -R * 0.28], [-R * 0.16, -R * 0.26], [-R * 0.26, 0], [-R * 0.16, R * 0.26], [R * 0.20, R * 0.28]]);
  ctx.fill();
  ctx.fillStyle = col.trim;
  ctx.fillRect(-R * 0.04, -R * 0.13, R * 0.30, R * 0.26);

  /* 主武装 */
  const bl = opt.barrel != null ? opt.barrel : R * 1.15;
  ctx.fillStyle = shade(col.body, 0.46);
  roundRect(ctx, R * 0.24, -R * 0.76, bl, R * 0.30, R * 0.08); ctx.fill();
  ctx.strokeStyle = shade(col.body, 0.30); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = shade(col.trim, 0.85);
  ctx.fillRect(R * 0.24 + bl - R * 0.22, -R * 0.80, R * 0.20, R * 0.22);
  if (opt.twin) {
    ctx.fillStyle = shade(col.body, 0.46);
    roundRect(ctx, R * 0.24, R * 0.46, bl * 0.80, R * 0.28, R * 0.08); ctx.fill();
    ctx.strokeStyle = shade(col.body, 0.30); ctx.stroke();
  }

  /* 頭部センサ */
  ctx.fillStyle = shade(col.body, 1.12);
  ctx.beginPath(); ctx.arc(R * 0.10, 0, R * 0.26, 0, TAU); ctx.fill();
  ctx.strokeStyle = shade(col.body, 0.45); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = col.accent;
  ctx.beginPath(); ctx.arc(R * 0.22, 0, R * 0.11, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.arc(R * 0.22, 0, R * 0.22, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  /* 発砲炎 */
  if (o.muzzle > 0.05) {
    const m = o.muzzle;
    ctx.globalAlpha = m;
    ctx.fillStyle = '#fff3c4';
    poly(ctx, [[R * 0.24 + bl, -R * 0.78], [R * 0.24 + bl + R * (0.6 + m * 0.9), -R * 0.61], [R * 0.24 + bl, -R * 0.44]]);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  /* 被弾フラッシュ */
  if (flash > 0.02) {
    ctx.globalAlpha = flash * 0.30;
    ctx.fillStyle = '#ffe8e8';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, TAU); ctx.fill();
    ctx.globalAlpha = Math.min(1, flash * 0.85);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.10, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- 敵 */
function drawEnemy(ctx, e) {
  const col = { body: e.def.body, trim: e.def.trim, accent: e.state === 'engage' ? '#ff6a6a' : e.state === 'search' ? '#ffcf4a' : '#9fe0a0' };
  const R = e.r;
  shadow(ctx, e.x, e.y, R * (e.flying ? 0.6 : 0.95), R * (e.flying ? 0.32 : 0.5), e.flying ? 0.18 : 0.32);

  if (e.def.id === 'drone') {
    ctx.save(); ctx.translate(e.x, e.y - 6); ctx.rotate(e.ang);
    const t = performance.now() * 0.03;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.fillStyle = shade(col.body, 0.7);
      ctx.beginPath(); ctx.arc(sx * R * 0.75, sy * R * 0.75, R * 0.30, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(180,240,240,${0.30 + 0.2 * Math.sin(t + sx * sy)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(sx * R * 0.75, sy * R * 0.75, R * 0.55, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = col.body;
    poly(ctx, [[R * 0.9, 0], [-R * 0.3, -R * 0.6], [-R * 0.6, 0], [-R * 0.3, R * 0.6]]); ctx.fill();
    ctx.fillStyle = col.accent;
    ctx.beginPath(); ctx.arc(R * 0.3, 0, R * 0.20, 0, TAU); ctx.fill();
    if (e.hitFlash > 0.02) { ctx.globalAlpha = e.hitFlash * 0.35; ctx.fillStyle = '#ffe8e8'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
    return;
  }

  const opt = {};
  if (e.def.ai === 'sniper') opt.barrel = R * 2.1;
  if (e.def.id === 'heavy') { opt.twin = true; opt.barrel = R * 1.0; }
  if (e.def.ai === 'artillery') opt.barrel = R * 0.75;
  drawRobot(ctx, e, col, opt);

  ctx.save(); ctx.translate(e.x, e.y);
  if (e.def.frontShield) {
    /* 盾機の前面プレート */
    ctx.save(); ctx.rotate(e.ang);
    ctx.fillStyle = 'rgba(226,210,154,0.9)';
    ctx.beginPath(); ctx.arc(0, 0, R * 1.30, -deg(58), deg(58)); ctx.arc(0, 0, R * 1.06, deg(58), -deg(58), true); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }
  if (e.def.ai === 'mender') {
    ctx.strokeStyle = '#9fe8b8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.18, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#9fe8b8';
    ctx.fillRect(-2, -R * 1.5, 4, 10); ctx.fillRect(-5, -R * 1.5 + 3, 10, 4);
  }
  if (e.def.ai === 'bomber') {
    const bl = e.fuse >= 0 ? (Math.sin(performance.now() * 0.03) * 0.5 + 0.5) : 0.35;
    ctx.fillStyle = `rgba(255,90,70,${0.35 + bl * 0.6})`;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.55 + bl * 4, 0, TAU); ctx.fill();
  }
  if (e.def.id === 'arcbot') {
    const t = performance.now() * 0.004;
    ctx.strokeStyle = `rgba(168,192,255,${0.35 + 0.3 * Math.sin(t * 3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.05 + Math.sin(t * 2) * 2, 0, TAU); ctx.stroke();
  }
  if (e.commander) {
    ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffcf4a'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('指揮官機', 0, -R * 1.9);
    ctx.textAlign = 'left';
  }
  if (e.stun > 0) {
    for (let i = 0; i < 3; i++) {
      const a = performance.now() * 0.008 + i * 2.1;
      ctx.fillStyle = '#c58cff';
      ctx.beginPath(); ctx.arc(Math.cos(a) * R * 1.3, Math.sin(a) * R * 0.5 - R * 1.4, 2.4, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();

  /* 体力バー（傷ついている時だけ） */
  if (e.hp < e.maxHp - 0.5) {
    const w = R * 2.2, h = 3.4;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(e.x - w / 2, e.y - R - 13, w, h);
    ctx.fillStyle = e.commander ? '#ffcf4a' : '#ff6a6a';
    ctx.fillRect(e.x - w / 2, e.y - R - 13, w * clamp(e.hp / e.maxHp, 0, 1), h);
  }
  /* 索敵状態 */
  if (e.state === 'search') {
    ctx.fillStyle = '#ffcf4a'; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('?', e.x, e.y - R - 18); ctx.textAlign = 'left';
  }
}

/* ---------------------------------------------------------------- ボス */
function drawBoss(ctx, b) {
  const def = b.def, R = b.r;
  const dy = b.dropY || 0;
  shadow(ctx, b.x, b.y, R * 1.05, R * 0.55, 0.36);
  ctx.save();
  ctx.translate(b.x, b.y + dy);
  ctx.rotate(b.ang);

  const col = { body: def.body, trim: def.trim, accent: '#ff6a4a' };

  if (def.id === 'vesper') {
    ctx.fillStyle = col.body;
    poly(ctx, [[R * 1.4, 0], [R * 0.1, -R * 1.15], [-R * 0.9, -R * 0.5], [-R * 0.65, 0], [-R * 0.9, R * 0.5], [R * 0.1, R * 1.15]]);
    ctx.fill();
    ctx.fillStyle = shade(col.trim, 0.9);
    poly(ctx, [[R * 0.9, 0], [R * 0.1, -R * 0.55], [-R * 0.4, 0], [R * 0.1, R * 0.55]]); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#7ad8ff';
      ctx.beginPath(); ctx.ellipse(-R * 0.75, s * R * 0.42, R * 0.22, R * 0.14, 0, 0, TAU); ctx.fill();
    }
  } else if (def.id === 'nova') {
    const t = performance.now() * 0.001;
    ctx.fillStyle = col.body;
    poly(ctx, [[R * 1.1, 0], [0, -R * 1.1], [-R * 1.1, 0], [0, R * 1.1]]); ctx.fill();
    ctx.fillStyle = shade(col.trim, 1.0);
    poly(ctx, [[R * 0.55, 0], [0, -R * 0.55], [-R * 0.55, 0], [0, R * 0.55]]); ctx.fill();
    ctx.strokeStyle = 'rgba(154,212,255,0.7)'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(t * (i + 1) * 0.9);
      ctx.beginPath(); ctx.ellipse(0, 0, R * (1.25 + i * 0.16), R * 0.4, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  } else {
    /* 装甲塊タイプ（ゴライアス / キマイラ / オメガ） */
    /* 履帯・脚部ブロック */
    for (const s of [-1, 1]) {
      ctx.fillStyle = shade(col.body, 0.42);
      roundRect(ctx, -R * 0.85, s * R * 0.72 - R * 0.26, R * 1.7, R * 0.52, R * 0.12); ctx.fill();
      ctx.strokeStyle = shade(col.body, 0.26); ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = shade(col.body, 0.60);
      for (let i = -3; i <= 3; i++) ctx.fillRect(i * R * 0.24 - R * 0.06, s * R * 0.72 - R * 0.22, R * 0.10, R * 0.44);
    }
    /* 車体 */
    ctx.fillStyle = col.body;
    poly(ctx, [[R * 1.02, R * 0.24], [R * 0.86, -R * 0.38], [R * 0.22, -R * 0.88],
               [-R * 0.62, -R * 0.76], [-R * 0.90, 0], [-R * 0.62, R * 0.76], [R * 0.22, R * 0.88]]);
    ctx.fill();
    ctx.strokeStyle = shade(col.body, 0.30); ctx.lineWidth = 3.5; ctx.stroke();
    /* 上部装甲 */
    ctx.fillStyle = shade(col.body, 1.26);
    poly(ctx, [[R * 0.66, 0], [R * 0.18, -R * 0.48], [-R * 0.38, -R * 0.38], [-R * 0.50, 0], [-R * 0.38, R * 0.38], [R * 0.18, R * 0.48]]);
    ctx.fill();
    ctx.strokeStyle = shade(col.body, 0.42); ctx.lineWidth = 2; ctx.stroke();
    /* パネル線 */
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-R * 0.34, -R * 0.34); ctx.lineTo(R * 0.30, -R * 0.34);
    ctx.moveTo(-R * 0.34, R * 0.34); ctx.lineTo(R * 0.30, R * 0.34);
    ctx.stroke();
    /* 主砲（二連） */
    for (const s of [-1, 1]) {
      ctx.fillStyle = shade(col.body, 0.40);
      roundRect(ctx, R * 0.40, s * R * 0.24 - R * 0.13, R * 1.14, R * 0.26, R * 0.07); ctx.fill();
      ctx.strokeStyle = shade(col.body, 0.24); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = col.trim;
      ctx.fillRect(R * 1.40, s * R * 0.24 - R * 0.10, R * 0.16, R * 0.20);
    }
    /* 司令部と単眼 */
    ctx.fillStyle = shade(col.trim, 0.72);
    ctx.beginPath(); ctx.arc(R * 0.02, 0, R * 0.28, 0, TAU); ctx.fill();
    ctx.strokeStyle = shade(col.body, 0.30); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ff4a28';
    ctx.beginPath(); ctx.arc(R * 0.10, 0, R * 0.13, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.arc(R * 0.10, 0, R * 0.30, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }

  if (b.hitFlash > 0.02) {
    ctx.globalAlpha = b.hitFlash * 0.26; ctx.fillStyle = '#ffe8e8';
    ctx.beginPath(); ctx.arc(0, 0, R * 1.0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.restore();

  /* 部位 */
  for (const p of b.parts) {
    const px = p.wx != null ? p.wx : b.x + p.ox, py = (p.wy != null ? p.wy : b.y + p.oy) + dy;
    if (!p.alive) {
      ctx.fillStyle = 'rgba(40,34,34,0.85)';
      ctx.beginPath(); ctx.arc(px, py, p.r * 0.8, 0, TAU); ctx.fill();
      continue;
    }
    ctx.fillStyle = shade(def.trim, 0.7);
    ctx.beginPath(); ctx.arc(px, py, p.r, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(def.body, 1.1);
    ctx.beginPath(); ctx.arc(px, py, p.r * 0.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, p.r + 3, 0, TAU); ctx.stroke();
    const w = p.r * 1.7;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px - w / 2, py - p.r - 10, w, 3);
    ctx.fillStyle = 'rgba(255,207,74,0.85)'; ctx.fillRect(px - w / 2, py - p.r - 10, w * clamp(p.hp / p.maxHp, 0, 1), 3);
  }
}

window.MRRender = { drawRobot, drawEnemy, drawBoss, shade, shadow, poly };

/* ---------------------------------------------------------------- Field */
Object.assign(Field.prototype, {

draw() {
  const ctx = this.ctx, cv = this.canvas;
  const z = this.cam.zoom || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = this.world.theme.floor;
  ctx.fillRect(0, 0, cv.width, cv.height);

  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-Math.round(this.cam.x + this.cam.ox), -Math.round(this.cam.y + this.cam.oy));
  const view = { x: this.cam.x - 60, y: this.cam.y - 60, w: cv.width / z + 120, h: cv.height / z + 120 };

  this.drawFloor(ctx, view);
  this.drawHazards(ctx);
  this.drawMarkers(ctx);
  this.drawPickups(ctx);
  this.drawSorted(ctx, view);
  this.drawBeams(ctx);
  this.drawBullets(ctx);
  this.parts.draw(ctx);
  this.drawLockUI(ctx);
  this.ft.draw(ctx);
  ctx.restore();

  this.drawOverlay(ctx, cv);
},

drawFloor(ctx, view) {
  const th = this.world.theme;
  ctx.fillStyle = th.floor;
  ctx.fillRect(view.x, view.y, view.w, view.h);
  /* 汚し */
  ctx.fillStyle = th.floor2;
  for (const d of this.world.decos) {
    if (d.x < view.x - d.r || d.x > view.x + view.w + d.r || d.y < view.y - d.r || d.y > view.y + view.h + d.r) continue;
    ctx.globalAlpha = d.a * 6;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  /* 格子 */
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
  const g = 110;
  const x0 = Math.floor(view.x / g) * g, x1 = view.x + view.w;
  const y0 = Math.floor(view.y / g) * g, y1 = view.y + view.h;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += g) { ctx.moveTo(x, view.y); ctx.lineTo(x, view.y + view.h); }
  for (let y = y0; y <= y1; y += g) { ctx.moveTo(view.x, y); ctx.lineTo(view.x + view.w, y); }
  ctx.stroke();
},

/* 壁とアクタを奥行き順に描く */
drawSorted(ctx, view) {
  const list = [];
  for (const w of this.world.walls) {
    if (w.x > view.x + view.w || w.x + w.w < view.x || w.y > view.y + view.h || w.y + w.h < view.y) continue;
    list.push({ sy: w.y + w.h, kind: 'wall', o: w });
  }
  for (const o of this.objects) if (!o.dead) list.push({ sy: o.y, kind: 'obj', o });
  for (const e of this.enemies) if (!e.dead && e.x > view.x - 60 && e.x < view.x + view.w + 60 && e.y > view.y - 60 && e.y < view.y + view.h + 60) list.push({ sy: e.y, kind: 'enemy', o: e });
  for (const ph of this.phantoms) list.push({ sy: ph.y, kind: 'phantom', o: ph });
  for (const p of this.players) if (!p.dead) list.push({ sy: p.y, kind: 'player', o: p });
  if (this.boss && !this.boss.dead) list.push({ sy: this.boss.y, kind: 'boss', o: this.boss });
  if (this.bossSite && !this.boss && this.sector.boss) list.push({ sy: this.bossSite.y, kind: 'site', o: this.bossSite });
  list.sort((a, b) => a.sy - b.sy);

  for (const it of list) {
    switch (it.kind) {
      case 'wall': this.drawWall(ctx, it.o); break;
      case 'obj': this.drawObject(ctx, it.o); break;
      case 'enemy': drawEnemy(ctx, it.o); break;
      case 'boss': drawBoss(ctx, it.o); break;
      case 'phantom': this.drawPhantom(ctx, it.o); break;
      case 'player': this.drawPlayer(ctx, it.o); break;
      case 'site': this.drawBossSite(ctx, it.o); break;
      default: break;
    }
  }
},

drawWall(ctx, w) {
  const th = this.world.theme;
  const h = w.low ? 7 : w.tall ? 20 : 13;
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(w.x + 5, w.y + 6, w.w, w.h);
  ctx.fillStyle = shade(th.wall, 0.72);
  ctx.fillRect(w.x, w.y, w.w, w.h);
  ctx.fillStyle = th.wallTop;
  ctx.fillRect(w.x, w.y - h, w.w, w.h);
  ctx.strokeStyle = shade(th.wallTop, 1.22); ctx.lineWidth = 1.2;
  ctx.strokeRect(w.x + 0.5, w.y - h + 0.5, w.w - 1, w.h - 1);
  if (w.low) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    if (w.w > w.h) for (let x = w.x + 22; x < w.x + w.w; x += 22) { ctx.moveTo(x, w.y - h + 3); ctx.lineTo(x, w.y - h + w.h - 3); }
    else for (let y = w.y + 22; y < w.y + w.h; y += 22) { ctx.moveTo(w.x + 3, y - h); ctx.lineTo(w.x + w.w - 3, y - h); }
    ctx.stroke();
  } else if (w.w > 60 && w.h > 60) {
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(w.x + 8, w.y - h + 8, w.w - 16, w.h - 16);
  }
},

drawObject(ctx, o) {
  if (o.kind === 'tower') {
    shadow(ctx, o.x, o.y, o.r * 1.1, o.r * 0.55, 0.34);
    ctx.save(); ctx.translate(o.x, o.y);
    ctx.fillStyle = '#3d4a58';
    ctx.beginPath(); ctx.arc(0, 0, o.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#59697c';
    ctx.beginPath(); ctx.arc(0, -8, o.r * 0.72, 0, TAU); ctx.fill();
    ctx.save(); ctx.rotate(o.ang);
    ctx.strokeStyle = '#8fd4ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-o.r * 1.15, 0); ctx.lineTo(o.r * 1.15, 0); ctx.stroke();
    ctx.fillStyle = '#8fd4ff';
    ctx.beginPath(); ctx.arc(o.r * 1.15, 0, 4, 0, TAU); ctx.fill();
    ctx.restore();
    const pulse = 0.4 + 0.4 * Math.sin(performance.now() * 0.005);
    ctx.strokeStyle = `rgba(143,212,255,${pulse * 0.6})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, o.r + 8 + pulse * 8, 0, TAU); ctx.stroke();
    if (o.hitFlash > 0.02) { ctx.globalAlpha = o.hitFlash * 0.4; ctx.fillStyle = '#ffe8e8'; ctx.beginPath(); ctx.arc(0, 0, o.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
    const w = o.r * 2.4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(o.x - w / 2, o.y - o.r - 18, w, 5);
    ctx.fillStyle = '#8fd4ff'; ctx.fillRect(o.x - w / 2, o.y - o.r - 18, w * clamp(o.hp / o.maxHp, 0, 1), 5);
    ctx.fillStyle = '#8fd4ff'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('通信塔', o.x, o.y - o.r - 24); ctx.textAlign = 'left';
  } else if (o.kind === 'crate') {
    shadow(ctx, o.x, o.y, o.r, o.r * 0.5, 0.32);
    ctx.save(); ctx.translate(o.x, o.y - 6);
    ctx.fillStyle = '#4a5a3c';
    roundRect(ctx, -o.r, -o.r * 0.72, o.r * 2, o.r * 1.44, 4); ctx.fill();
    ctx.fillStyle = '#6d8154';
    roundRect(ctx, -o.r + 4, -o.r * 0.72 + 4, o.r * 2 - 8, o.r * 1.44 - 8, 3); ctx.fill();
    ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-o.r, 0); ctx.lineTo(o.r, 0); ctx.stroke();
    ctx.restore();
    const pulse = 0.4 + 0.4 * Math.sin(performance.now() * 0.004);
    ctx.strokeStyle = `rgba(140,255,180,${0.35 + pulse * 0.4})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 12, 0, TAU); ctx.stroke();
    if (o.cap > 0) {
      ctx.strokeStyle = '#8dffb0'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 18, -Math.PI / 2, -Math.PI / 2 + TAU * (o.cap / o.need)); ctx.stroke();
    }
    ctx.fillStyle = '#8dffb0'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('補給コンテナ', o.x, o.y - o.r - 20); ctx.textAlign = 'left';
  }
},

drawBossSite(ctx, s) {
  const done = this.objectives.filter((o) => o.id !== 'boss').every((o) => o.done >= o.need);
  const t = performance.now() * 0.003;
  ctx.save();
  ctx.strokeStyle = done ? `rgba(255,90,60,${0.5 + 0.3 * Math.sin(t * 2)})` : 'rgba(160,160,170,0.28)';
  ctx.lineWidth = 3; ctx.setLineDash([16, 12]); ctx.lineDashOffset = -t * 26;
  ctx.beginPath(); ctx.arc(s.x, s.y, 110, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = done ? '#ff8a6a' : 'rgba(190,190,200,0.5)';
  ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(done ? '敵ボス機 降下地点' : '封鎖中 ― 目標を先に片付けろ', s.x, s.y - 122);
  ctx.textAlign = 'left';
  ctx.restore();
},

drawPlayer(ctx, m) {
  const col = { body: m.lo.frame.body, trim: m.lo.frame.trim, accent: m.lo.frame.accent };
  shadow(ctx, m.x, m.y, m.r * 1.0, m.r * 0.5, 0.34);

  if (m.down) {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang + 0.5);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = shade(col.body, 0.5);
    roundRect(ctx, -m.r, -m.r * 0.6, m.r * 2, m.r * 1.2, 6); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    const w = 42;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(m.x - w / 2, m.y - 34, w, 5);
    ctx.fillStyle = '#8dffb0'; ctx.fillRect(m.x - w / 2, m.y - 34, w * clamp(m.reviveT / 2.4, 0, 1), 5);
    ctx.fillStyle = '#ff9a9a'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`P${m.pid} 行動不能 ${Math.ceil(m.downT)}`, m.x, m.y - 42); ctx.textAlign = 'left';
    return;
  }

  /* 無敵・シールド */
  if (m.shieldT > 0) {
    const a = 0.28 + 0.16 * Math.sin(performance.now() * 0.012);
    ctx.fillStyle = `rgba(255,180,90,${a})`;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 2.1, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,140,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 2.1, 0, TAU); ctx.stroke();
  }
  if (m.iframe > 0 || m.rollT > 0) {
    ctx.strokeStyle = 'rgba(180,230,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 1.35, 0, TAU); ctx.stroke();
  }
  const camo = m.has('optic_camo') && m.noHitT > 3;
  if (camo) ctx.globalAlpha = 0.55;
  drawRobot(ctx, m, col, { thrust: m.rollT > 0, twin: m.lo.weapons.length > 1 });
  ctx.globalAlpha = 1;

  /* プレイヤー識別リング */
  ctx.strokeStyle = m.pid === 1 ? 'rgba(120,190,255,0.75)' : 'rgba(255,170,90,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 1.55, deg(200), deg(340)); ctx.stroke();
  ctx.fillStyle = m.pid === 1 ? '#78beff' : '#ffaa5a';
  ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`P${m.pid}`, m.x, m.y - m.r * 1.72);
  ctx.textAlign = 'left';
},

drawPhantom(ctx, ph) {
  ctx.save();
  ctx.globalAlpha = 0.45;
  const col = { body: '#2f4a58', trim: '#5fffe0', accent: '#5fffe0' };
  drawRobot(ctx, { x: ph.x, y: ph.y, ang: ph.ang, aim: ph.ang, r: ph.owner.r, walkPhase: ph.walkPhase, muzzle: 0, recoil: 0 }, col, {});
  ctx.restore();
},

drawBullets(ctx) {
  for (const b of this.bullets) {
    const len = clamp(b.speed * 0.022, 6, 26);
    const dx = Math.cos(b.ang), dy = Math.sin(b.ang);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.size;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.32;
    ctx.beginPath(); ctx.moveTo(b.x - dx * len * 1.9, b.y - dy * len * 1.9); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(b.x - dx * len, b.y - dy * len); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 0.42, 0, TAU); ctx.fill();
  }
  ctx.lineCap = 'butt';
},

drawBeams(ctx) {
  for (const bm of this.beams) {
    if (bm.zig) {
      const seg = 7;
      ctx.strokeStyle = bm.color; ctx.lineWidth = bm.w;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1);
      for (let i = 1; i <= seg; i++) {
        const t = i / seg;
        const nx = lerp(bm.x1, bm.x2, t) + (i < seg ? rnd(-9, 9) : 0);
        const ny = lerp(bm.y1, bm.y2, t) + (i < seg ? rnd(-9, 9) : 0);
        ctx.lineTo(nx, ny);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      continue;
    }
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.24; ctx.strokeStyle = bm.color; ctx.lineWidth = bm.w * 3.2;
    ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = bm.w;
    ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, bm.w * 0.34);
    ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
    ctx.lineCap = 'butt';
  }
},

drawHazards(ctx) {
  for (const h of this.hazards) {
    const a = clamp(h.t / h.max, 0, 1);
    const g = ctx.createRadialGradient(h.x, h.y, h.r * 0.2, h.x, h.y, h.r);
    if (h.kind === 'fire') { g.addColorStop(0, `rgba(255,150,60,${0.34 * a})`); g.addColorStop(1, 'rgba(255,90,30,0)'); }
    else { g.addColorStop(0, `rgba(180,120,255,${0.30 * a})`); g.addColorStop(1, 'rgba(150,90,255,0)'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = h.kind === 'fire' ? `rgba(255,170,80,${0.4 * a})` : `rgba(197,140,255,${0.4 * a})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
  }
},

drawMarkers(ctx) {
  for (const m of this.markers) {
    const p = 1 - m.t / m.max;
    const col = m.team === 'ally' ? '124,243,255' : '255,90,70';
    ctx.strokeStyle = `rgba(${col},${0.35 + p * 0.55})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = `rgba(${col},${0.10 + p * 0.18})`;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * p, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${col},0.8)`;
    ctx.beginPath();
    ctx.moveTo(m.x - m.r * 0.5, m.y); ctx.lineTo(m.x + m.r * 0.5, m.y);
    ctx.moveTo(m.x, m.y - m.r * 0.5); ctx.lineTo(m.x, m.y + m.r * 0.5);
    ctx.stroke();
  }
},

drawPickups(ctx) {
  const t = performance.now() * 0.005;
  for (const p of this.pickups) {
    const bob = Math.sin(t + p.x * 0.05) * 2;
    if (p.kind === 'scrap') {
      ctx.fillStyle = '#ffd166';
      ctx.save(); ctx.translate(p.x, p.y + bob); ctx.rotate(t * 0.6);
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(p.x, p.y + bob, 8, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    } else {
      const c = p.kind === 'repair' ? '#8dffb0' : '#9fd4ff';
      ctx.fillStyle = 'rgba(20,26,32,0.9)';
      roundRect(ctx, p.x - 10, p.y - 10 + bob, 20, 20, 4); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 2;
      roundRect(ctx, p.x - 10, p.y - 10 + bob, 20, 20, 4); ctx.stroke();
      ctx.fillStyle = c;
      if (p.kind === 'repair') { ctx.fillRect(p.x - 2, p.y - 6 + bob, 4, 12); ctx.fillRect(p.x - 6, p.y - 2 + bob, 12, 4); }
      else { ctx.fillRect(p.x - 5, p.y - 5 + bob, 3, 10); ctx.fillRect(p.x - 1, p.y - 5 + bob, 3, 10); ctx.fillRect(p.x + 3, p.y - 5 + bob, 3, 10); }
    }
  }
},

drawLockUI(ctx) {
  for (const m of this.players) {
    if (m.dead || m.down) continue;
    if (m.lock && !m.lock.dead) {
      const l = m.lock, t = performance.now() * 0.004;
      const r = l.r + 12 + Math.sin(t * 2) * 2;
      ctx.strokeStyle = m.pid === 1 ? 'rgba(120,200,255,0.9)' : 'rgba(255,180,100,0.9)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a0 = i * (TAU / 4) + t * 0.5;
        ctx.beginPath(); ctx.arc(l.x, l.y, r, a0, a0 + 0.55); ctx.stroke();
      }
    }
    /* 照準線 */
    if (m.pid === 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.aimX, m.aimY); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(m.aimX, m.aimY, 9, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m.aimX - 15, m.aimY); ctx.lineTo(m.aimX - 5, m.aimY);
      ctx.moveTo(m.aimX + 5, m.aimY); ctx.lineTo(m.aimX + 15, m.aimY);
      ctx.moveTo(m.aimX, m.aimY - 15); ctx.lineTo(m.aimX, m.aimY - 5);
      ctx.moveTo(m.aimX, m.aimY + 5); ctx.lineTo(m.aimX, m.aimY + 15);
      ctx.stroke();
    }
  }
},

/* ---------------- 画面固定のUI ---------------- */
drawOverlay(ctx, cv) {
  const dpr = this.dpr || 1;
  ctx.save();
  ctx.scale(dpr, dpr);
  const W = cv.width / dpr, H = cv.height / dpr;
  /* 画面外の重要目標を矢印で示す */
  this.drawOffscreen(ctx, W, H);
  this.drawMinimap(ctx, W, H);

  /* バナー */
  if (this.bannerT > 0 && this.banner) {
    const a = clamp(this.bannerT / 0.6, 0, 1) * clamp((3.2 - this.bannerT) / 0.3, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = '800 34px "Segoe UI", system-ui, sans-serif';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(this.banner, W / 2, H * 0.24);
    const grad = ctx.createLinearGradient(0, H * 0.2, 0, H * 0.28);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#8fd4ff');
    ctx.fillStyle = grad;
    ctx.fillText(this.banner, W / 2, H * 0.24);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  /* トースト */
  if (this.toastT > 0 && this.toast) {
    const a = clamp(this.toastT / 0.5, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    const tw = ctx.measureText(this.toast).width;
    ctx.fillStyle = 'rgba(8,12,18,0.78)';
    roundRect(ctx, W / 2 - tw / 2 - 16, H - 152, tw + 32, 30, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(143,212,255,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#dff0ff'; ctx.textAlign = 'center';
    ctx.fillText(this.toast, W / 2, H - 132);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  ctx.restore();
},

drawOffscreen(ctx, W, H) {
  const z = (this.cam.zoom || 1) / (this.dpr || 1);
  const marks = [];
  for (const o of this.objects) if (!o.dead) marks.push({ x: o.x, y: o.y, c: o.kind === 'tower' ? '#8fd4ff' : '#8dffb0' });
  if (this.boss && !this.boss.dead) marks.push({ x: this.boss.x, y: this.boss.y, c: '#ff6a4a', big: true });
  else if (this.bossSite && this.sector.boss && this.objectives.filter((o) => o.id !== 'boss').every((o) => o.done >= o.need)) marks.push({ x: this.bossSite.x, y: this.bossSite.y, c: '#ff6a4a', big: true });
  for (const p of this.players) if (p.down) marks.push({ x: p.x, y: p.y, c: '#ff9a9a' });

  for (const m of marks) {
    const sx = (m.x - this.cam.x) * z, sy = (m.y - this.cam.y) * z;
    if (sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40) continue;
    const cx = W / 2, cy = H / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const rx = W / 2 - 46, ry = H / 2 - 46;
    const k = Math.min(Math.abs(rx / Math.cos(a)), Math.abs(ry / Math.sin(a)));
    const px = cx + Math.cos(a) * k, py = cy + Math.sin(a) * k;
    ctx.save(); ctx.translate(px, py); ctx.rotate(a);
    ctx.fillStyle = m.c;
    ctx.globalAlpha = 0.9;
    poly(ctx, [[m.big ? 16 : 11, 0], [-8, -8], [-4, 0], [-8, 8]]); ctx.fill();
    ctx.restore();
  }
},

drawMinimap(ctx, W, H) {
  const S = 168, PAD = 14;
  const x0 = W - S - PAD, y0 = H - S - PAD;
  const k = S / this.world.w;
  ctx.save();
  ctx.fillStyle = 'rgba(6,10,15,0.80)';
  roundRect(ctx, x0 - 4, y0 - 4, S + 8, S + 8, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(143,212,255,0.30)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); roundRect(ctx, x0, y0, S, S, 5); ctx.clip();
  ctx.fillStyle = 'rgba(20,28,38,0.9)'; ctx.fillRect(x0, y0, S, S);
  ctx.fillStyle = 'rgba(120,150,180,0.30)';
  for (const w of this.world.walls) ctx.fillRect(x0 + w.x * k, y0 + w.y * k, Math.max(1, w.w * k), Math.max(1, w.h * k));

  /* 目標 */
  for (const o of this.objects) {
    if (o.dead) continue;
    ctx.fillStyle = o.kind === 'tower' ? '#8fd4ff' : '#8dffb0';
    ctx.beginPath(); ctx.arc(x0 + o.x * k, y0 + o.y * k, 3.4, 0, TAU); ctx.fill();
  }
  /* レーダー圏内の敵 */
  const RAD = 640;
  for (const e of this.enemies) {
    if (e.dead) continue;
    let seen = false;
    for (const p of this.players) if (!p.dead && dist(p.x, p.y, e.x, e.y) < RAD) seen = true;
    if (!seen) continue;
    ctx.fillStyle = e.commander ? '#ffcf4a' : e.state === 'engage' ? '#ff6a6a' : '#c07070';
    ctx.beginPath(); ctx.arc(x0 + e.x * k, y0 + e.y * k, e.commander ? 3.6 : 2.2, 0, TAU); ctx.fill();
  }
  if (this.boss && !this.boss.dead) {
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath(); ctx.arc(x0 + this.boss.x * k, y0 + this.boss.y * k, 6, 0, TAU); ctx.fill();
  } else if (this.bossSite && this.sector.boss) {
    ctx.strokeStyle = 'rgba(255,90,60,0.6)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x0 + this.bossSite.x * k, y0 + this.bossSite.y * k, 6, 0, TAU); ctx.stroke();
  }
  /* 自機 */
  for (const p of this.players) {
    if (p.dead) continue;
    ctx.fillStyle = p.pid === 1 ? '#78beff' : '#ffaa5a';
    ctx.save(); ctx.translate(x0 + p.x * k, y0 + p.y * k); ctx.rotate(p.ang);
    poly(ctx, [[5, 0], [-3.5, -3.5], [-3.5, 3.5]]); ctx.fill();
    ctx.restore();
  }
  /* 表示範囲 */
  const z = this.cam.zoom || 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
  ctx.strokeRect(x0 + this.cam.x * k, y0 + this.cam.y * k, (this.canvas.width / z) * k, (this.canvas.height / z) * k);
  ctx.restore();
},

});
})();
