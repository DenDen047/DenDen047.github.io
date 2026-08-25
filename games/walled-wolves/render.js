/* =========================================================================
   WALLED WOLVES ― 描画
   街の地面は一度だけオフスクリーンに焼き、家・住民・光だけを毎フレーム描く。
   住民は髪型・服・帽子・体格で描き分け、狼に変わると毛色ごとに姿が変わる。
   ========================================================================= */

/* ---------- 地面レイヤーを焼く ---------- */
function bakeGround(town) {
  const c = document.createElement('canvas');
  c.width = town.w; c.height = town.h;
  const g = c.getContext('2d');
  const { cx, cy, wallT } = town;

  // 土
  g.fillStyle = '#4a4336';
  g.fillRect(0, 0, town.w, town.h);
  const rng = makeRng(9137);
  for (let i = 0; i < 2600; i++) {
    const x = rng() * town.w, y = rng() * town.h;
    g.fillStyle = `rgba(${90 + rng() * 30 | 0},${82 + rng() * 26 | 0},${64 + rng() * 20 | 0},${0.10 + rng() * 0.12})`;
    g.fillRect(x, y, 3 + rng() * 7, 2 + rng() * 5);
  }

  // 広場の石畳
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, town.plaza.rx, town.plaza.ry, 0, 0, 6.284);
  g.clip();
  g.fillStyle = '#6b6558';
  g.fillRect(cx - town.plaza.rx, cy - town.plaza.ry, town.plaza.rx * 2, town.plaza.ry * 2);
  for (let y = cy - town.plaza.ry; y < cy + town.plaza.ry; y += 26) {
    for (let x = cx - town.plaza.rx; x < cx + town.plaza.rx; x += 34) {
      const ox = (Math.round((y - cy) / 26) % 2) * 17;
      g.fillStyle = `rgba(255,255,255,${0.03 + rng() * 0.05})`;
      g.fillRect(x + ox + 1, y + 1, 31, 23);
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1;
      g.strokeRect(x + ox + 1.5, y + 1.5, 31, 23);
    }
  }
  g.restore();

  // 広場から各家への道
  g.strokeStyle = '#645d4e';
  g.lineCap = 'round';
  for (const h of town.houses) {
    g.lineWidth = 30;
    g.beginPath();
    const a = Math.atan2(h.cy - cy, h.cx - cx);
    g.moveTo(cx + Math.cos(a) * (town.plaza.rx * 0.75), cy + Math.sin(a) * (town.plaza.ry * 0.75));
    g.lineTo(h.porch.x, h.porch.y);
    g.stroke();
  }
  // 仕事場への道
  for (const s of town.stations) {
    g.lineWidth = 22;
    g.beginPath();
    const a = Math.atan2(s.cy - cy, s.cx - cx);
    g.moveTo(cx + Math.cos(a) * (town.plaza.rx * 0.8), cy + Math.sin(a) * (town.plaza.ry * 0.8));
    g.lineTo(s.cx, s.cy + s.h * 0.6);
    g.stroke();
  }

  // 畑と水路は地面に焼く
  for (const s of town.stations) {
    if (s.kind === 'field') {
      g.fillStyle = '#5c4a2e';
      g.fillRect(s.x, s.y, s.w, s.h);
      for (let i = 0; i < 7; i++) {
        g.fillStyle = i % 2 ? '#6e5a36' : '#7d6a3c';
        g.fillRect(s.x + 4, s.y + 6 + i * ((s.h - 12) / 7), s.w - 8, 6);
      }
      g.strokeStyle = '#3d3122'; g.lineWidth = 3; g.strokeRect(s.x, s.y, s.w, s.h);
    }
    if (s.kind === 'canal') {
      g.fillStyle = '#2f4a58';
      g.fillRect(s.x, s.y, s.w, s.h);
      g.fillStyle = 'rgba(140,200,220,0.16)';
      for (let i = 0; i < 5; i++) g.fillRect(s.x + 6 + i * 30, s.y + 8, 20, 4);
      g.strokeStyle = '#6b6558'; g.lineWidth = 7; g.strokeRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6);
    }
  }

  // 外壁（内側の面）
  g.fillStyle = '#5b5449';
  g.fillRect(0, 0, town.w, wallT);
  g.fillRect(0, town.h - wallT, town.w, wallT);
  g.fillRect(0, 0, wallT, town.h);
  g.fillRect(town.w - wallT, 0, wallT, town.h);
  // 石積み
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
  for (let y = 0; y < town.h; y += 22) {
    for (let x = 0; x < town.w; x += 40) {
      const onWall = x < wallT || x > town.w - wallT - 40 || y < wallT || y > town.h - wallT - 22;
      if (!onWall) continue;
      const ox = (Math.round(y / 22) % 2) * 20;
      g.strokeRect(x + ox, y, 40, 22);
      g.fillStyle = `rgba(255,255,255,${0.02 + rng() * 0.05})`;
      g.fillRect(x + ox + 1, y + 1, 38, 20);
    }
  }
  // 内側の縁に落ちる影
  const sh = 26;
  const grads = [
    [0, wallT, 0, wallT + sh, 'v'], [town.h, town.h - wallT, 0, 0, 'v2'],
  ];
  void grads;
  let gr = g.createLinearGradient(0, wallT, 0, wallT + sh);
  gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, wallT, town.w, sh);
  gr = g.createLinearGradient(0, town.h - wallT, 0, town.h - wallT - sh);
  gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, town.h - wallT - sh, town.w, sh);
  gr = g.createLinearGradient(wallT, 0, wallT + sh, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(wallT, 0, sh, town.h);
  gr = g.createLinearGradient(town.w - wallT, 0, town.w - wallT - sh, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(town.w - wallT - sh, 0, sh, town.h);

  // 胸壁の凹凸
  g.fillStyle = '#6b6355';
  for (let x = 0; x < town.w; x += 34) {
    g.fillRect(x, 0, 20, 12);
    g.fillRect(x, town.h - 12, 20, 12);
  }
  for (let y = 0; y < town.h; y += 34) {
    g.fillRect(0, y, 12, 20);
    g.fillRect(town.w - 12, y, 12, 20);
  }

  return c;
}

/* =========================================================================
   人物
   ========================================================================= */

/* 体の色を少し暗く／明るく */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}

/* =========================================================================
   人物 ― 2.6頭身のデフォルメ
   頭を大きくとり、髪型・帽子・服・体格で一人ずつ描き分ける。
   p: { x, y, face:'N'|'S'|'E'|'W', walkPhase, moving, look, ghost }
   ========================================================================= */
const HEAD_Y = -33, HEAD_RX = 10, HEAD_RY = 10.6;
const BODY_TOP = -23.5, BODY_BOT = -7;

function drawPerson(ctx, p, t, opts = {}) {
  const c = p.look;
  const s = (c.build || 1) * (opts.scale || 1);
  const face = p.face || 'S';
  const back = face === 'N';
  const side = face === 'E' || face === 'W';
  const flip = face === 'W' ? -1 : 1;
  const moving = p.moving ? 1 : 0;
  const ph = p.walkPhase || 0;
  const bob = Math.sin(ph * 2) * 0.9 * moving;
  const swing = Math.sin(ph) * 4.6 * moving;

  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 1.5, 11.5 * s, 4.4 * s, 0, 0, 6.284);
  ctx.fill();

  if (p.ghost) ctx.globalAlpha = 0.42;
  ctx.scale(s, s);
  ctx.translate(0, -bob);

  const skirt = c.outfit === 'dress' || c.outfit === 'robe';
  const hx = side ? flip * 1.2 : 0;      // 横向きは頭と体をわずかに前へ

  /* ---- 脚 ---- */
  if (!skirt) {
    ctx.fillStyle = c.cloth2;
    ctx.fillRect(-5.4 + swing * 0.55, BODY_BOT - 0.5, 4.6, 6.4);
    ctx.fillRect(0.8 - swing * 0.55, BODY_BOT - 0.5, 4.6, 6.4);
    ctx.fillStyle = '#3a2c1f';
    ctx.fillRect(-5.8 + swing * 0.55, -1.6, 5.6, 2.6);
    ctx.fillRect(0.5 - swing * 0.55, -1.6, 5.6, 2.6);
  } else {
    ctx.fillStyle = '#3a2c1f';
    ctx.fillRect(-4.2, -1.6, 4.2, 2.4);
    ctx.fillRect(0.4, -1.6, 4.2, 2.4);
  }

  /* ---- 後ろ腕（振り上げ側） ---- */
  drawArm(ctx, c, hx - 7.6, -swing, true);

  /* ---- 胴 ---- */
  ctx.save();
  ctx.translate(hx, 0);
  drawTorso(ctx, c, back, side, flip);
  ctx.restore();

  /* ---- 前腕 ---- */
  drawArm(ctx, c, hx + 7.6, swing, false);

  /* ---- 首 ---- */
  ctx.fillStyle = shade(c.skin, -22);
  ctx.fillRect(hx - 2.6, HEAD_Y + 8, 5.2, 4);

  /* ---- 頭 ---- */
  const hy = HEAD_Y;
  ctx.fillStyle = c.skin;
  ctx.beginPath();
  ctx.ellipse(hx, hy, HEAD_RX, HEAD_RY, 0, 0, 6.284);
  ctx.fill();
  // 顔の陰
  ctx.fillStyle = 'rgba(0,0,0,0.09)';
  ctx.beginPath();
  ctx.ellipse(hx - (side ? flip * 3.4 : 4.6), hy + 0.5, 4.4, HEAD_RY - 0.6, 0, 0, 6.284);
  ctx.fill();
  // 横顔の鼻
  if (side) {
    ctx.fillStyle = c.skin;
    ctx.beginPath();
    ctx.moveTo(hx + flip * 9.2, hy - 1.4);
    ctx.lineTo(hx + flip * 12.2, hy + 1.2);
    ctx.lineTo(hx + flip * 8.8, hy + 2.6);
    ctx.closePath(); ctx.fill();
  }

  if (!back) drawFace(ctx, c, hx, hy, side, flip);
  drawHair(ctx, c, hx, hy, back, side, flip);
  drawHat(ctx, c, hx, hy, back, side, flip);

  ctx.restore();

  if (opts.label) drawLabel(ctx, p, opts, s, 56);
}

function drawArm(ctx, c, x, off, behind) {
  const top = BODY_TOP + 2.5;
  ctx.fillStyle = behind ? shade(c.cloth, -26) : c.cloth;
  if (c.outfit === 'armor') ctx.fillStyle = behind ? shade(c.cloth, -6) : shade(c.cloth, 16);
  roundRectPath(ctx, x - 1.9, top + off * 0.35, 3.8, 10.5, 1.8); ctx.fill();
  ctx.fillStyle = behind ? shade(c.skin, -26) : c.skin;
  ctx.beginPath();
  ctx.ellipse(x, top + 11.4 + off * 0.35, 2.2, 2.2, 0, 0, 6.284);
  ctx.fill();
}

function drawTorso(ctx, c, back, side, flip) {
  const T = BODY_TOP, B = BODY_BOT;
  const sw = 7.6;                                 // 肩の半幅
  let bw = 7.0;                                   // 裾の半幅
  if (c.outfit === 'dress') bw = 10.6;
  if (c.outfit === 'robe') bw = 10.0;
  const hem = (c.outfit === 'dress' || c.outfit === 'robe') ? 1.2 : B;

  ctx.fillStyle = c.cloth;
  ctx.beginPath();
  ctx.moveTo(-sw, T + 1.5);
  ctx.quadraticCurveTo(-sw - 0.6, T - 1.2, -sw + 2.2, T - 1.6);
  ctx.lineTo(sw - 2.2, T - 1.6);
  ctx.quadraticCurveTo(sw + 0.6, T - 1.2, sw, T + 1.5);
  ctx.lineTo(bw, hem);
  ctx.lineTo(-bw, hem);
  ctx.closePath();
  ctx.fill();
  // 片側の陰
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.moveTo(-sw, T + 1.5); ctx.lineTo(-sw + 3, T - 1.4);
  ctx.lineTo(-sw + 3, hem); ctx.lineTo(-bw, hem);
  ctx.closePath(); ctx.fill();

  switch (c.outfit) {
    case 'apron':
      ctx.fillStyle = shade(c.cloth, 48);
      ctx.beginPath();
      ctx.moveTo(-4.4, T + 1); ctx.lineTo(4.4, T + 1);
      ctx.lineTo(5.4, hem - 0.4); ctx.lineTo(-5.4, hem - 0.4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.fillRect(-6.4, T + 9.5, 12.8, 1.8);
      break;
    case 'armor':
      ctx.fillStyle = shade(c.cloth, 40);
      roundRectPath(ctx, -sw - 1.6, T - 1.4, 4.6, 5.2, 2); ctx.fill();
      roundRectPath(ctx, sw - 3, T - 1.4, 4.6, 5.2, 2); ctx.fill();
      ctx.fillStyle = shade(c.cloth, 22);
      roundRectPath(ctx, -5.2, T + 3.4, 10.4, 9, 2); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.fillRect(-5.2, T + 6.6, 10.4, 1.6);
      ctx.fillStyle = 'rgba(255,255,255,0.26)';
      ctx.fillRect(-4, T + 4.4, 2, 5.4);
      break;
    case 'coat':
      ctx.fillStyle = shade(c.cloth, -30);
      ctx.fillRect(-0.9, T - 1, 1.8, hem - T + 1);
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.ellipse(0, T + 4, 1.1, 1.1, 0, 0, 6.284); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, T + 8.5, 1.1, 1.1, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = shade(c.cloth, 22);
      ctx.beginPath();
      ctx.moveTo(-4.6, T - 1.4); ctx.lineTo(-1.2, T + 4.2); ctx.lineTo(-6.2, T + 3.4);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4.6, T - 1.4); ctx.lineTo(1.2, T + 4.2); ctx.lineTo(6.2, T + 3.4);
      ctx.closePath(); ctx.fill();
      break;
    case 'robe':
      ctx.fillStyle = c.accent;
      ctx.fillRect(-7.2, T + 9, 14.4, 1.8);
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let i = -2; i <= 2; i++) ctx.fillRect(i * 3.4, T + 11.5, 1, hem - T - 11);
      break;
    case 'dress':
      ctx.fillStyle = shade(c.cloth, 34);
      ctx.beginPath();
      ctx.moveTo(-6.6, T + 8.6); ctx.lineTo(6.6, T + 8.6);
      ctx.lineTo(bw, hem); ctx.lineTo(-bw, hem);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.fillRect(-6.2, T + 7.4, 12.4, 1.6);
      break;
    case 'cloak':
      ctx.fillStyle = shade(c.cloth, -28);
      ctx.beginPath();
      ctx.moveTo(-sw - 1.4, T - 1.6); ctx.lineTo(sw + 1.4, T - 1.6);
      ctx.lineTo(bw + 2.6, hem + 0.6); ctx.lineTo(-bw - 2.6, hem + 0.6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.ellipse(0, T + 0.6, 1.9, 1.9, 0, 0, 6.284); ctx.fill();
      break;
    default:   // tunic
      ctx.fillStyle = c.accent;
      ctx.fillRect(-sw + 0.4, T + 9.6, sw * 2 - 0.8, 2);
      ctx.fillStyle = shade(c.accent, -50);
      ctx.fillRect(-1.4, T + 9.6, 2.8, 2);
      break;
  }
}

function drawFace(ctx, c, hx, hy, side, flip) {
  const ey = hy - 0.8;
  const eye = (x) => {
    ctx.fillStyle = '#fbf7ef';
    ctx.beginPath(); ctx.ellipse(x, ey, 2.5, 2.9, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.ellipse(x + (side ? flip * 0.6 : 0), ey + 0.3, 1.5, 1.8, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.ellipse(x + (side ? flip * 0.6 : 0) - 0.5, ey - 0.5, 0.55, 0.6, 0, 0, 6.284); ctx.fill();
  };
  if (side) { eye(hx + flip * 4.2); }
  else { eye(hx - 4.0); eye(hx + 4.0); }

  // 眉
  ctx.strokeStyle = shade(c.hair, -30);
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  if (side) {
    ctx.beginPath();
    ctx.moveTo(hx + flip * 2.4, ey - 4.2); ctx.lineTo(hx + flip * 6.2, ey - 4.6);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(hx - 6, ey - 4.4); ctx.lineTo(hx - 2.2, ey - 4.8);
    ctx.moveTo(hx + 2.2, ey - 4.8); ctx.lineTo(hx + 6, ey - 4.4);
    ctx.stroke();
  }

  // 口
  ctx.strokeStyle = 'rgba(120,68,58,0.8)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  const mx = side ? hx + flip * 4.4 : hx;
  ctx.moveTo(mx - 1.8, hy + 5.2);
  ctx.quadraticCurveTo(mx, hy + 6.6, mx + 1.8, hy + 5.2);
  ctx.stroke();
}

/* ---------- 髪 ---------- */
function drawHair(ctx, c, hx, hy, back, side, flip) {
  const st = c.hairStyle;
  const H = c.hair, HD = shade(H, -34);
  const RX = HEAD_RX + 0.5, RY = HEAD_RY + 0.4;

  const cap = (bottom) => {          // 頭を上から覆う
    ctx.fillStyle = H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(hx - RX - 4, hy - RY - 14, (RX + 4) * 2, RY + 14 + bottom);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(hx, hy, RX, RY, 0, 0, 6.284);
    ctx.fill();
    ctx.restore();
  };

  if (st === 'bald') {
    ctx.fillStyle = H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(hx - RX - 4, hy - 1, (RX + 4) * 2, RY + 5);
    ctx.clip();
    ctx.beginPath(); ctx.ellipse(hx, hy, RX, RY, 0, 0, 6.284); ctx.fill();
    ctx.restore();
    return;
  }

  if (back) {                        // 後ろ姿は髪で頭がほぼ隠れる
    ctx.fillStyle = H;
    ctx.beginPath(); ctx.ellipse(hx, hy, RX, RY, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = HD;
    ctx.beginPath(); ctx.ellipse(hx, hy + 2, RX * 0.6, RY * 0.5, 0, 0, 6.284); ctx.fill();
  }

  switch (st) {
    case 'short':
      cap(back ? RY : -1.5);
      if (!back) {
        ctx.fillStyle = H;
        ctx.beginPath();
        ctx.moveTo(hx - RX, hy - 1);
        ctx.quadraticCurveTo(hx - 2, hy - 5.6, hx + 3.4, hy - 2.2);
        ctx.quadraticCurveTo(hx + 6, hy - 5.2, hx + RX, hy - 0.6);
        ctx.lineTo(hx + RX, hy - 4); ctx.lineTo(hx - RX, hy - 4);
        ctx.closePath(); ctx.fill();
      }
      break;
    case 'messy':
      cap(back ? RY : -1.8);
      ctx.fillStyle = H;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(hx + i * 3 - 2, hy - RY + 1.4);
        ctx.lineTo(hx + i * 3 + 0.4, hy - RY - 3.6 - Math.abs(i) * 0.4);
        ctx.lineTo(hx + i * 3 + 2.4, hy - RY + 1.6);
        ctx.closePath(); ctx.fill();
      }
      break;
    case 'long': {
      ctx.fillStyle = H;
      ctx.beginPath();
      ctx.moveTo(hx - RX - 1.6, hy - 3);
      ctx.quadraticCurveTo(hx - RX - 2.6, hy + 12, hx - RX + 1.6, hy + 13);
      ctx.lineTo(hx - RX + 4, hy + 12); ctx.lineTo(hx - RX + 2.4, hy - 3);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx + RX + 1.6, hy - 3);
      ctx.quadraticCurveTo(hx + RX + 2.6, hy + 12, hx + RX - 1.6, hy + 13);
      ctx.lineTo(hx + RX - 4, hy + 12); ctx.lineTo(hx + RX - 2.4, hy - 3);
      ctx.closePath(); ctx.fill();
      cap(back ? RY : -0.5);
      break;
    }
    case 'bun':
      ctx.fillStyle = HD;
      ctx.beginPath(); ctx.ellipse(hx + (side ? -flip * 5 : 0), hy - RY - 3.4, 5, 4.4, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = H;
      ctx.beginPath(); ctx.ellipse(hx + (side ? -flip * 5 : 0), hy - RY - 3.8, 4.4, 3.8, 0, 0, 6.284); ctx.fill();
      cap(back ? RY : -2.2);
      break;
    case 'braid': {
      cap(back ? RY : -2);
      const bx = hx + (side ? -flip * 6.4 : -RX - 0.4);
      ctx.fillStyle = H;
      ctx.beginPath();
      ctx.moveTo(bx - 1.6, hy + 1);
      ctx.quadraticCurveTo(bx - 2.6, hy + 12, bx + 0.6, hy + 14.5);
      ctx.lineTo(bx + 3.2, hy + 13); ctx.lineTo(bx + 2.2, hy + 1);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = HD; ctx.lineWidth = 0.9;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(bx - 1.4, hy + 3 + i * 3); ctx.lineTo(bx + 2.4, hy + 4.4 + i * 3);
        ctx.stroke();
      }
      ctx.fillStyle = c.accent;
      ctx.fillRect(bx - 0.6, hy + 13.4, 3.4, 1.8);
      break;
    }
    case 'pony': {
      cap(back ? RY : -2);
      const px = hx + (side ? -flip * 8.6 : (back ? 0 : -RX - 1.2));
      ctx.fillStyle = HD;
      ctx.beginPath();
      ctx.moveTo(px, hy - 4);
      ctx.quadraticCurveTo(px - 4.4, hy + 4, px - 1.6, hy + 11);
      ctx.quadraticCurveTo(px + 2.4, hy + 6, px + 2.6, hy - 3.6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.fillRect(px - 1.4, hy - 4.6, 4, 2);
      break;
    }
    case 'curly': {
      ctx.fillStyle = H;
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.96 + (i / 10) * Math.PI * 1.08;
        ctx.beginPath();
        ctx.ellipse(hx + Math.cos(a) * (RX + 0.6), hy + Math.sin(a) * (RY + 0.4) + 1, 3.6, 3.4, 0, 0, 6.284);
        ctx.fill();
      }
      cap(back ? RY : -2.6);
      ctx.fillStyle = shade(H, 26);
      ctx.beginPath(); ctx.ellipse(hx - 3, hy - RY - 0.4, 3, 2.4, -0.3, 0, 6.284); ctx.fill();
      break;
    }
    default: cap(-1.5); break;
  }
}

/* ---------- 帽子 ---------- */
function drawHat(ctx, c, hx, hy, back, side, flip) {
  const h = c.hat;
  if (!h || h === 'none') return;
  const RX = HEAD_RX + 1;

  if (h === 'cap') {
    ctx.fillStyle = shade(c.cloth2, 18);
    ctx.beginPath();
    ctx.ellipse(hx, hy - 3.4, RX, RX * 0.86, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(hx - RX, hy - 4.2, RX * 2, 2.6);
    if (!back) {
      ctx.fillStyle = shade(c.cloth2, 4);
      const bx = side ? hx + flip * 2 : hx - 5;
      ctx.beginPath();
      ctx.ellipse(bx + (side ? flip * 4 : 5), hy - 2.6, side ? 7 : 6.4, 2, 0, 0, 6.284);
      ctx.fill();
    }
  } else if (h === 'hood') {
    ctx.fillStyle = shade(c.cloth, -20);
    ctx.beginPath();
    ctx.moveTo(hx - RX - 2.6, hy + 8);
    ctx.quadraticCurveTo(hx - RX - 3, hy - RX - 6, hx, hy - RX - 6);
    ctx.quadraticCurveTo(hx + RX + 3, hy - RX - 6, hx + RX + 2.6, hy + 8);
    ctx.lineTo(hx + RX - 2.8, hy + 8);
    ctx.quadraticCurveTo(hx + RX - 1.4, hy - RX + 1.4, hx, hy - RX + 1);
    ctx.quadraticCurveTo(hx - RX + 1.4, hy - RX + 1.4, hx - RX + 2.8, hy + 8);
    ctx.closePath(); ctx.fill();
    if (back) {
      ctx.beginPath(); ctx.ellipse(hx, hy - 0.6, RX + 2.4, RX + 1.6, 0, 0, 6.284); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(hx, hy - RX + 1.4, RX - 1.2, 2.6, 0, 0, 6.284);
    ctx.fill();
  } else if (h === 'helm') {
    ctx.fillStyle = '#a5b2c4';
    ctx.beginPath();
    ctx.ellipse(hx, hy - 1.4, RX + 0.6, RX + 0.2, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(hx - RX - 0.6, hy - 2.2, (RX + 0.6) * 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.beginPath();
    ctx.ellipse(hx - 4, hy - 6.4, 2, 3.4, -0.4, 0, 6.284); ctx.fill();
    if (!back) {
      ctx.fillStyle = '#8b99ad';
      ctx.fillRect(hx + (side ? flip * 3.4 : -1.4), hy - 2.2, 2.8, 7.4);
    }
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(hx - 2, hy - RX - 1);
    ctx.quadraticCurveTo(hx, hy - RX - 8, hx + 2.4, hy - RX - 1);
    ctx.closePath(); ctx.fill();
  } else if (h === 'bandana') {
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.ellipse(hx, hy - 5.6, RX - 0.6, RX * 0.62, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(hx - RX + 0.6, hy - 6.4, (RX - 0.6) * 2, 3);
    ctx.fillStyle = shade(c.accent, -34);
    const kx = side ? hx - flip * (RX - 1) : hx + RX - 1;
    ctx.beginPath();
    ctx.moveTo(kx, hy - 4.6);
    ctx.lineTo(kx + (side ? -flip * 5.4 : 5.4), hy - 0.6);
    ctx.lineTo(kx + (side ? -flip * 1.4 : 1.4), hy - 1.2);
    ctx.closePath(); ctx.fill();
  } else if (h === 'hat') {
    ctx.fillStyle = shade(c.cloth2, 12);
    ctx.beginPath(); ctx.ellipse(hx, hy - 3.6, RX + 5, 3.4, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = shade(c.cloth2, 26);
    roundRectPath(ctx, hx - 6.2, hy - 12, 12.4, 9, 3); ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.fillRect(hx - 6.2, hy - 6.2, 12.4, 2.4);
  } else if (h === 'kerchief') {
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.moveTo(hx - RX, hy - 0.4);
    ctx.quadraticCurveTo(hx, hy - RX - 6.4, hx + RX, hy - 0.4);
    ctx.lineTo(hx + RX - 2, hy + 1.4);
    ctx.lineTo(hx - RX + 2, hy + 1.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(c.accent, -34);
    const kx = side ? hx - flip * 3 : hx - 3;
    ctx.beginPath();
    ctx.moveTo(kx, hy - 0.2);
    ctx.lineTo(kx - 4.6, hy + 6.4);
    ctx.lineTo(kx + 1.4, hy + 1.6);
    ctx.closePath(); ctx.fill();
  } else if (h === 'circlet') {
    ctx.strokeStyle = '#dfd3a8'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(hx, hy - 4.4, RX - 0.6, 2.8, 0, 0, 6.284);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.beginPath(); ctx.ellipse(hx, hy - 6.6, 2.1, 2.1, 0, 0, 6.284); ctx.fill();
  }
}

/* =========================================================================
   人狼 ― 二足で立つ獣。毛色は個体ごとに違う。
   ========================================================================= */
const W_HEAD_Y = -46, W_SHOULDER = -38, W_HIP = -14;

function drawWolf(ctx, p, t, opts = {}) {
  const c = p.look;
  const s = (c.build || 1) * 1.12 * (opts.scale || 1);
  const face = p.face || 'S';
  const back = face === 'N';
  const side = face === 'E' || face === 'W';
  const flip = face === 'W' ? -1 : 1;
  const moving = p.moving ? 1 : 0;
  const ph = p.walkPhase || 0;
  const swing = Math.sin(ph) * 5 * moving;
  const breathe = Math.sin(t * 3) * 0.7;
  const fur = c.fur, furD = c.furDark, furL = shade(fur, 26);

  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(0, 2, 15 * s, 5.4 * s, 0, 0, 6.284); ctx.fill();

  if (p.ghost) ctx.globalAlpha = 0.42;
  ctx.scale(s, s);
  ctx.translate(0, breathe * 0.4);

  /* ---- 尻尾 ---- */
  const tw = Math.sin(t * 5 + ph) * 0.28;
  ctx.save();
  const tx = back ? 0 : (side ? -flip * 8 : -8.5);
  ctx.translate(tx, W_HIP - 1);
  ctx.rotate((side ? flip : 1) * (2.5 + tw));
  ctx.fillStyle = furD;
  ctx.beginPath();
  ctx.moveTo(0, -3.4);
  ctx.quadraticCurveTo(11, -7, 19, -2);
  ctx.quadraticCurveTo(12, 1.6, 0, 3.4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(fur, -4);
  ctx.beginPath();
  ctx.moveTo(13, -4.4); ctx.quadraticCurveTo(18, -3.6, 19, -2);
  ctx.quadraticCurveTo(16, 0, 13, 0.6);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  /* ---- 後ろ脚 ---- */
  ctx.fillStyle = furD;
  wolfLimb(ctx, -6 + swing * 0.5, W_HIP - 1, 6.4, 13, 2.6);
  wolfLimb(ctx, 6 - swing * 0.5, W_HIP - 1, 6.4, 13, 2.6);
  ctx.fillStyle = '#d9cfbc';
  wolfClaws(ctx, -6 + swing * 0.5, 0.2, 2.1, 2.4);
  wolfClaws(ctx, 6 - swing * 0.5, 0.2, 2.1, 2.4);

  /* ---- 胴（肩幅広く、腰が締まる） ---- */
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.moveTo(-12.4, W_SHOULDER + 3);
  ctx.quadraticCurveTo(-14.6, W_SHOULDER + 12, -8.6, W_HIP);
  ctx.lineTo(8.6, W_HIP);
  ctx.quadraticCurveTo(14.6, W_SHOULDER + 12, 12.4, W_SHOULDER + 3);
  ctx.quadraticCurveTo(0, W_SHOULDER - 3.4, -12.4, W_SHOULDER + 3);
  ctx.closePath(); ctx.fill();
  // 背のたてがみ
  ctx.fillStyle = furD;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 3.6 - 2, W_SHOULDER + 1);
    ctx.lineTo(i * 3.6 + 0.2, W_SHOULDER - 6 + Math.abs(i) * 1.4);
    ctx.lineTo(i * 3.6 + 2.4, W_SHOULDER + 1.4);
    ctx.closePath(); ctx.fill();
  }
  if (!back) {
    // 胸のもふもふ
    ctx.fillStyle = furL;
    ctx.beginPath();
    ctx.moveTo(-5.4, W_SHOULDER + 3);
    ctx.quadraticCurveTo(-6.6, W_HIP + 1, 0, W_HIP + 3);
    ctx.quadraticCurveTo(6.6, W_HIP + 1, 5.4, W_SHOULDER + 3);
    ctx.quadraticCurveTo(0, W_SHOULDER + 7, -5.4, W_SHOULDER + 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.beginPath();
    ctx.moveTo(-12.4, W_SHOULDER + 3);
    ctx.quadraticCurveTo(-14.6, W_SHOULDER + 12, -8.6, W_HIP);
    ctx.lineTo(-5, W_HIP); ctx.lineTo(-6.6, W_SHOULDER + 3);
    ctx.closePath(); ctx.fill();
  }

  /* ---- 腕 ---- */
  ctx.fillStyle = furD;
  wolfLimb(ctx, -13.4, W_SHOULDER + 4 - swing * 0.5, 6, 15, 2.8);
  wolfLimb(ctx, 13.4, W_SHOULDER + 4 + swing * 0.5, 6, 15, 2.8);
  ctx.fillStyle = '#f2ebdc';
  wolfClaws(ctx, -13.4, W_SHOULDER + 19 - swing * 0.5, 2.9, 5);
  wolfClaws(ctx, 13.4, W_SHOULDER + 19 + swing * 0.5, 2.9, 5);

  /* ---- 頭 ---- */
  const hy = W_HEAD_Y + breathe;
  const hx = side ? flip * 1.6 : 0;

  // 耳
  const ear = (ex, tipx, tipy) => {
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.moveTo(hx + ex, hy - 4.6);
    ctx.lineTo(hx + tipx, hy + tipy);
    ctx.lineTo(hx + ex * 0.26, hy - 9.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5e343c';
    ctx.beginPath();
    ctx.moveTo(hx + ex * 0.86, hy - 6);
    ctx.lineTo(hx + tipx * 0.86, hy + tipy + 2.6);
    ctx.lineTo(hx + ex * 0.34, hy - 9.6);
    ctx.closePath(); ctx.fill();
  };
  ear(-9.2, -11.6, -18.6);
  ear(9.2, 11.6, -18.6);

  // 頭蓋
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 11, 9.6, 0, 0, 6.284);
  ctx.fill();

  if (back) {
    ctx.fillStyle = furD;
    ctx.beginPath(); ctx.ellipse(hx, hy + 1, 9, 7.6, 0, 0, 6.284); ctx.fill();
  } else if (side) {
    // 横顔 ― 前へ伸びるマズル
    const mx = hx + flip * 8;
    ctx.fillStyle = shade(fur, 12);
    ctx.beginPath();
    ctx.moveTo(hx + flip * 2, hy - 4.4);
    ctx.quadraticCurveTo(mx + flip * 8, hy - 4, mx + flip * 10, hy + 1.6);
    ctx.quadraticCurveTo(mx + flip * 8, hy + 6.6, hx + flip * 1, hy + 7.2);
    ctx.closePath(); ctx.fill();
    // 口の裂け目と牙
    ctx.strokeStyle = '#2a1418'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(hx + flip * 1.4, hy + 4.2);
    ctx.quadraticCurveTo(mx + flip * 5, hy + 4.6, mx + flip * 9.4, hy + 2.6);
    ctx.stroke();
    ctx.fillStyle = '#f6f1e4';
    for (let i = 0; i < 3; i++) {
      const fx = mx + flip * (7.4 - i * 3.4);
      ctx.beginPath();
      ctx.moveTo(fx, hy + 3.6);
      ctx.lineTo(fx + flip * 0.9, hy + 7.6 - i * 0.7);
      ctx.lineTo(fx + flip * 2.1, hy + 3.4);
      ctx.closePath(); ctx.fill();
    }
    // 鼻
    ctx.fillStyle = '#1c1216';
    ctx.beginPath();
    ctx.ellipse(mx + flip * 9.2, hy + 0.6, 2.6, 2.2, flip * 0.3, 0, 6.284);
    ctx.fill();
    // 目
    wolfEye(ctx, hx + flip * 3.2, hy - 2.6, flip, t);
    // 眉間のしわ
    ctx.strokeStyle = furD; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(hx + flip * 1, hy - 6.4); ctx.lineTo(hx + flip * 5, hy - 5.2);
    ctx.stroke();
  } else {
    // 正面 ― 下に突き出すマズル
    ctx.fillStyle = shade(fur, 14);
    ctx.beginPath();
    ctx.moveTo(hx - 6.4, hy + 1.4);
    ctx.quadraticCurveTo(hx - 6.8, hy + 11, hx, hy + 12.6);
    ctx.quadraticCurveTo(hx + 6.8, hy + 11, hx + 6.4, hy + 1.4);
    ctx.closePath(); ctx.fill();
    // 口
    ctx.strokeStyle = '#2a1418'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx - 5.4, hy + 8.4);
    ctx.quadraticCurveTo(hx, hy + 10.4, hx + 5.4, hy + 8.4);
    ctx.stroke();
    // 牙（上下）
    ctx.fillStyle = '#f6f1e4';
    [[-4.2, 1], [-1.6, 0.8], [1.6, 0.8], [4.2, 1]].forEach(([fx, k]) => {
      ctx.beginPath();
      ctx.moveTo(hx + fx - 1.1, hy + 8);
      ctx.lineTo(hx + fx, hy + 8 + 4 * k);
      ctx.lineTo(hx + fx + 1.1, hy + 8);
      ctx.closePath(); ctx.fill();
    });
    // 鼻
    ctx.fillStyle = '#1c1216';
    ctx.beginPath();
    ctx.moveTo(hx - 2.8, hy + 3.4);
    ctx.quadraticCurveTo(hx, hy + 7.4, hx + 2.8, hy + 3.4);
    ctx.quadraticCurveTo(hx, hy + 2.2, hx - 2.8, hy + 3.4);
    ctx.closePath(); ctx.fill();
    // 目
    wolfEye(ctx, hx - 4.8, hy - 2.4, 1, t);
    wolfEye(ctx, hx + 4.8, hy - 2.4, -1, t);
    // 眉間
    ctx.fillStyle = furD;
    ctx.beginPath();
    ctx.moveTo(hx - 1.4, hy - 8.6); ctx.lineTo(hx + 1.4, hy - 8.6);
    ctx.lineTo(hx + 0.8, hy - 1.4); ctx.lineTo(hx - 0.8, hy - 1.4);
    ctx.closePath(); ctx.fill();
  }

  ctx.restore();
  if (opts.label) drawLabel(ctx, p, opts, s, 70);
}

function wolfEye(ctx, x, y, dir, t) {
  const glow = 0.78 + Math.sin(t * 5 + x) * 0.18;
  ctx.save();
  ctx.shadowColor = 'rgba(255,60,54,0.95)';
  ctx.shadowBlur = 9;
  ctx.fillStyle = `rgba(255,${70 + glow * 46 | 0},58,${glow})`;
  ctx.beginPath();
  ctx.moveTo(x - 2.9 * dir, y - 1.4);
  ctx.lineTo(x + 2.7 * dir, y - 0.2);
  ctx.lineTo(x + 2.1 * dir, y + 2.2);
  ctx.lineTo(x - 2.7 * dir, y + 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(70,0,0,0.85)';
  ctx.beginPath();
  ctx.ellipse(x + 0.2 * dir, y + 0.4, 0.8, 1.5, 0, 0, 6.284);
  ctx.fill();
}

function wolfLimb(ctx, x, y, w, h, r) {
  roundRectPath(ctx, x - w / 2, y, w, h, r);
  ctx.fill();
}

function wolfClaws(ctx, x, y, spread, len) {
  const L = len || 4.2;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * spread - 0.9, y);
    ctx.lineTo(x + i * spread, y + L);
    ctx.lineTo(x + i * spread + 1, y);
    ctx.closePath(); ctx.fill();
  }
}

function drawLabel(ctx, p, opts, s, lift) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.font = '600 11px "Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(opts.label).width;
  const y = -lift * s;
  ctx.fillStyle = opts.labelColor ? 'rgba(40,6,10,0.74)' : 'rgba(8,10,16,0.66)';
  roundRect(ctx, -w / 2 - 5, y, w + 10, 15, 5); ctx.fill();
  ctx.fillStyle = opts.labelColor || '#e9eef7';
  ctx.fillText(opts.label, 0, y + 11);
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* =========================================================================
   家と仕事場
   ========================================================================= */
function drawHouseFloor(ctx, h) {
  // 床
  ctx.fillStyle = '#4e4034';
  ctx.fillRect(h.x, h.y, h.w, h.h);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = h.y; y < h.y + h.h; y += 12) ctx.fillRect(h.x, y, h.w, 1);

  // ベッド
  ctx.fillStyle = '#7a5a44';
  roundRect(ctx, h.bed.x, h.bed.y, h.bed.w, h.bed.h, 3); ctx.fill();
  ctx.fillStyle = '#cfc3ac';
  roundRect(ctx, h.bed.x + 3, h.bed.y + 3, h.bed.w - 6, h.bed.h - 8, 2); ctx.fill();
  ctx.fillStyle = '#9db4c8';
  roundRect(ctx, h.bed.x + 3, h.bed.y + h.bed.h - 15, h.bed.w - 6, 11, 2); ctx.fill();

  // 物置（隠れ場所）
  ctx.fillStyle = '#6a5136';
  roundRect(ctx, h.chest.x, h.chest.y, h.chest.w, h.chest.h, 3); ctx.fill();
  ctx.fillStyle = '#8a6c48';
  ctx.fillRect(h.chest.x + 2, h.chest.y + 2, h.chest.w - 4, h.chest.h * 0.45);
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(h.chest.x + h.chest.w / 2 - 2, h.chest.y + h.chest.h * 0.45, 4, 4);

  // 机
  ctx.fillStyle = '#6e5638';
  roundRect(ctx, h.table.x, h.table.y, h.table.w, h.table.h, 2); ctx.fill();
  ctx.fillStyle = '#ffd07a';
  ctx.beginPath(); ctx.ellipse(h.table.x + h.table.w / 2, h.table.y + h.table.h / 2, 3.4, 3.4, 0, 0, 6.284); ctx.fill();
}

function drawHouseShell(ctx, h, opened, t) {
  const sk = h.skin;

  // 壁
  ctx.fillStyle = sk.wall;
  ctx.fillRect(h.x, h.y, h.w, h.h);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(h.x, h.y, h.w, h.h);

  if (opened) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(h.x + 10, h.y + 10, h.w - 20, h.h - 20);
    ctx.clip();
    drawHouseFloor(ctx, h);
    ctx.restore();
  }

  ctx.strokeStyle = sk.trim;
  ctx.lineWidth = 10;
  ctx.strokeRect(h.x + 5, h.y + 5, h.w - 10, h.h - 10);

  if (!opened) drawRoof(ctx, h, sk);

  // 玄関
  const d = h.door;
  ctx.fillStyle = '#3a281a';
  if (h.dir === 'N' || h.dir === 'S') {
    roundRect(ctx, d.x - 17, d.y - 7, 34, 14, 3); ctx.fill();
  } else {
    roundRect(ctx, d.x - 7, d.y - 17, 14, 34, 3); ctx.fill();
  }
  ctx.fillStyle = '#c9a227';
  ctx.beginPath(); ctx.ellipse(d.x, d.y, 2.2, 2.2, 0, 0, 6.284); ctx.fill();

  // 玄関先の番号札
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const sx = h.porch.x, sy = h.porch.y;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, sx - 11, sy - 8, 22, 16, 4); ctx.fill();
  ctx.fillStyle = '#f0e2c0';
  ctx.fillText(String(h.no), sx, sy + 4);
}

/* 切妻屋根。棟を境に片面を明るく、反対の面を暗くして立体に見せる */
function drawRoof(ctx, h, sk) {
  const ov = 6;                                   // 軒の張り出し
  const rx = h.x - ov, ry = h.y - ov;
  const rw = h.w + ov * 2, rh = h.h + ov * 2;
  const horiz = (h.dir === 'N' || h.dir === 'S'); // 棟が水平か

  // 落ちる影
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(rx + 4, ry + 6, rw, rh);

  ctx.fillStyle = sk.roof;
  ctx.fillRect(rx, ry, rw, rh);

  // 二つの面
  if (horiz) {
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(rx, ry, rw, rh / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(rx, ry + rh / 2, rw, rh / 2);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(rx, ry, rw / 2, rh);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(rx + rw / 2, ry, rw / 2, rh);
  }

  // 瓦の筋（棟と平行）
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  if (horiz) {
    for (let y = ry + 7; y < ry + rh - 3; y += 8) ctx.fillRect(rx + 1, y, rw - 2, 2);
  } else {
    for (let x = rx + 7; x < rx + rw - 3; x += 8) ctx.fillRect(x, ry + 1, 2, rh - 2);
  }

  // 棟
  ctx.fillStyle = shade(sk.roof, 46);
  if (horiz) ctx.fillRect(rx, ry + rh / 2 - 3.5, rw, 7);
  else ctx.fillRect(rx + rw / 2 - 3.5, ry, 7, rh);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  if (horiz) { ctx.fillRect(rx, ry + rh / 2 + 3.5, rw, 1.6); }
  else { ctx.fillRect(rx + rw / 2 + 3.5, ry, 1.6, rh); }

  // 軒の縁
  ctx.strokeStyle = shade(sk.roof, -42);
  ctx.lineWidth = 3;
  ctx.strokeRect(rx + 1.5, ry + 1.5, rw - 3, rh - 3);

  // 煙突
  const cx = rx + rw - 24, cy = ry + 9;
  ctx.fillStyle = shade(sk.trim, -14);
  roundRect(ctx, cx, cy, 13, 16, 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(cx + 2, cy + 2, 9, 4);
  ctx.fillStyle = shade(sk.trim, 22);
  ctx.fillRect(cx - 1, cy - 2, 15, 3);
}

function drawStation(ctx, s, t) {
  const { x, y, w, h } = s;
  switch (s.kind) {
    case 'bell': {
      ctx.fillStyle = '#7a6b58'; roundRect(ctx, x, y, w, h, 6); ctx.fill();
      ctx.fillStyle = '#5e5245'; roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 4); ctx.fill();
      ctx.fillStyle = '#c9a227';
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - 16, y + h / 2 + 12);
      ctx.quadraticCurveTo(x + w / 2, y + h / 2 - 22, x + w / 2 + 16, y + h / 2 + 12);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a6a18';
      ctx.fillRect(x + w / 2 - 3, y + h / 2 + 12, 6, 7);
      ctx.fillStyle = '#3a3228';
      ctx.fillRect(x + 4, y + 2, w - 8, 6);
      break;
    }
    case 'well': {
      ctx.fillStyle = '#6b6355'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#1d2a34'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 10, h / 2 - 10, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = 'rgba(120,190,220,0.25)';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2 + Math.sin(t * 2) * 1.5, w / 2 - 15, h / 2 - 15, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#6a4a2c';
      ctx.fillRect(x + 4, y - 22, 6, 26); ctx.fillRect(x + w - 10, y - 22, 6, 26);
      ctx.fillRect(x, y - 26, w, 7);
      break;
    }
    case 'oven': {
      ctx.fillStyle = '#8a7460'; roundRect(ctx, x, y, w, h, 8); ctx.fill();
      ctx.fillStyle = '#2a1a12';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.62, 20, 15, 0, Math.PI, 0); ctx.fill();
      const f = 0.6 + Math.sin(t * 8) * 0.16;
      ctx.fillStyle = `rgba(255,${140 + f * 60 | 0},40,${f})`;
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.62, 13, 9, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#6a5a4a'; ctx.fillRect(x + w - 22, y - 18, 12, 22);
      break;
    }
    case 'forge': {
      ctx.fillStyle = '#5a5148'; roundRect(ctx, x, y, w, h, 5); ctx.fill();
      ctx.fillStyle = '#3a332c'; ctx.fillRect(x + 8, y + h * 0.3, w - 16, h * 0.55);
      const f = 0.55 + Math.sin(t * 11) * 0.25;
      ctx.fillStyle = `rgba(255,${120 + f * 90 | 0},30,${f})`;
      ctx.fillRect(x + 16, y + h * 0.42, w - 32, h * 0.3);
      ctx.fillStyle = '#8a8a92';
      ctx.fillRect(x + w - 30, y + 6, 22, 12);
      ctx.fillStyle = '#4a4a52';
      roundRect(ctx, x + 6, y + 4, 26, 16, 3); ctx.fill();
      break;
    }
    case 'watch': {
      ctx.fillStyle = '#6a6152'; roundRect(ctx, x, y, w, h, 4); ctx.fill();
      ctx.fillStyle = '#544c40'; roundRect(ctx, x + 10, y + 10, w - 20, h - 20, 3); ctx.fill();
      ctx.fillStyle = '#3a3228';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 6 + i * 20, y - 6, 12, 10);
      ctx.fillStyle = '#c9a227';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, 8, 8, 0, 0, 6.284); ctx.fill();
      break;
    }
    case 'store': {
      ctx.fillStyle = '#7a6448'; roundRect(ctx, x, y, w, h, 4); ctx.fill();
      ctx.fillStyle = '#5a4a34'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      ctx.fillStyle = '#9a8258';
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 10 + i * 30, y + 12, 22, h - 24);
      break;
    }
    case 'gate': {
      ctx.fillStyle = '#4a4238'; roundRect(ctx, x, y, w, h, 3); ctx.fill();
      ctx.fillStyle = '#3a2c1e'; ctx.fillRect(x + 8, y + 6, w - 16, h - 12);
      ctx.fillStyle = '#6a5a44';
      for (let i = 0; i < 5; i++) ctx.fillRect(x + 10 + i * ((w - 20) / 5), y + 6, 8, h - 12);
      ctx.fillStyle = '#8a8a92'; ctx.fillRect(x + 10, y + h / 2 - 5, w - 20, 10);
      break;
    }
    case 'shrine': {
      ctx.fillStyle = '#6a6255'; roundRect(ctx, x + 6, y + 14, w - 12, h - 18, 3); ctx.fill();
      ctx.fillStyle = '#57503f';
      ctx.beginPath();
      ctx.moveTo(x, y + 18); ctx.lineTo(x + w / 2, y - 2); ctx.lineTo(x + w, y + 18);
      ctx.closePath(); ctx.fill();
      const f = 0.65 + Math.sin(t * 6.5) * 0.25;
      ctx.fillStyle = `rgba(255,220,120,${f})`;
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.62, 4.5, 6.5, 0, 0, 6.284); ctx.fill();
      break;
    }
    default: break; // field / canal は地面に焼いてある
  }
}

function drawProp(ctx, p, t) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.s, p.s);
  switch (p.kind) {
    case 'tree':
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      ctx.beginPath(); ctx.ellipse(0, 4, 20, 8, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#4a3624'; ctx.fillRect(-5, -14, 10, 18);
      ctx.fillStyle = '#3f5e34';
      ctx.beginPath(); ctx.ellipse(0, -26, 21, 19, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#4d7040';
      ctx.beginPath(); ctx.ellipse(-6, -31, 13, 11, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = 'rgba(160,200,130,0.20)';
      ctx.beginPath(); ctx.ellipse(6, -22 + Math.sin(t * 1.4 + p.rot) * 1.2, 9, 7, 0, 0, 6.284); ctx.fill();
      break;
    case 'bush':
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath(); ctx.ellipse(0, 3, 13, 5, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#3d5c34';
      ctx.beginPath(); ctx.ellipse(0, -4, 14, 10, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#4a6e3d';
      ctx.beginPath(); ctx.ellipse(-4, -7, 8, 6, 0, 0, 6.284); ctx.fill();
      break;
    case 'barrel':
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.beginPath(); ctx.ellipse(0, 3, 12, 5, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#7a5a38'; roundRect(ctx, -10, -18, 20, 21, 4); ctx.fill();
      ctx.fillStyle = '#5a4028'; ctx.fillRect(-10, -13, 20, 3); ctx.fillRect(-10, -4, 20, 3);
      ctx.fillStyle = '#946e44'; ctx.beginPath(); ctx.ellipse(0, -18, 10, 4, 0, 0, 6.284); ctx.fill();
      break;
    case 'crate':
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.beginPath(); ctx.ellipse(0, 3, 13, 5, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#8a6c44'; ctx.fillRect(-12, -18, 24, 21);
      ctx.strokeStyle = '#5c4630'; ctx.lineWidth = 2.4;
      ctx.strokeRect(-12, -18, 24, 21);
      ctx.beginPath(); ctx.moveTo(-12, -18); ctx.lineTo(12, 3); ctx.stroke();
      break;
    case 'cart':
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      ctx.beginPath(); ctx.ellipse(0, 4, 24, 8, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = '#7a5c3a'; ctx.fillRect(-22, -18, 44, 18);
      ctx.fillStyle = '#5c4630'; ctx.fillRect(-22, -18, 44, 4);
      ctx.fillStyle = '#3a2c1e';
      ctx.beginPath(); ctx.ellipse(-13, 0, 7, 7, 0, 0, 6.284); ctx.fill();
      ctx.beginPath(); ctx.ellipse(13, 0, 7, 7, 0, 0, 6.284); ctx.fill();
      break;
    default: break;
  }
  ctx.restore();
}

function drawLamp(ctx, l, t, night) {
  ctx.fillStyle = '#3a3228';
  ctx.fillRect(l.x - 3, l.y - 26, 6, 28);
  ctx.fillStyle = '#5a5044';
  roundRect(ctx, l.x - 8, l.y - 42, 16, 18, 3); ctx.fill();
  const f = 0.6 + Math.sin(t * 7 + l.phase) * 0.22;
  ctx.save();
  ctx.shadowColor = 'rgba(255,190,90,0.9)';
  ctx.shadowBlur = night ? 16 : 6;
  ctx.fillStyle = `rgba(255,${190 + f * 50 | 0},110,${night ? f : f * 0.6})`;
  ctx.beginPath(); ctx.ellipse(l.x, l.y - 33, 5, 6.5, 0, 0, 6.284); ctx.fill();
  ctx.restore();
}

/* ---------- 汎用 ---------- */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
