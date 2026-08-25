/* =========================================================================
   NOCLIP ― 描画
   キャラクターとツルハシは手続き描画。ゲーム画面とスキン画面で同じ関数を使う。
   ========================================================================= */

/* -------------------------------------------------------------------------
   キャラクター
   ang    : 向き（ラジアン、0 = 右）
   t      : 経過秒。歩行のゆれと煙の動きに使う
   ------------------------------------------------------------------------- */
function drawCharacter(ctx, look, x, y, s, ang, t, o = {}) {
  const walk = o.walk || 0;               // 0..1 歩行の強さ
  const bob = Math.sin(t * 11) * 1.2 * walk * s;
  const fx = Math.cos(ang), fy = Math.sin(ang);
  const hx = fx * 3.0 * s, hy = fy * 3.0 * s;   // 頭の位置（少し前）
  const hr = 8.0 * s;                            // 頭の半径

  ctx.save();
  ctx.translate(x, y + bob);

  // 影
  if (o.shadow !== false) {
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 10 * s, 13 * s, 5.5 * s, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* --- 胴体（肩を向きに合わせて回す） --- */
  ctx.save();
  ctx.rotate(ang + Math.PI / 2);
  const bw = 19 * s, bh = 13 * s;
  const grad = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
  grad.addColorStop(0, look.coatDark); grad.addColorStop(0.5, look.coat); grad.addColorStop(1, look.coatDark);
  ctx.fillStyle = grad;
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 5 * s); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.1 * s; ctx.stroke();
  ctx.strokeStyle = look.trim; ctx.lineWidth = 1.3 * s; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(-bw / 2 + 2 * s, -bh / 2 + 3 * s); ctx.lineTo(bw / 2 - 2 * s, -bh / 2 + 3 * s); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  /* --- 腕 --- */
  const armSw = Math.sin(t * 11) * 0.35 * walk;
  for (const side of [-1, 1]) {
    const a = ang + side * (0.95 + armSw * side);
    ctx.strokeStyle = look.coatDark; ctx.lineWidth = 3.8 * s; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 6.5 * s, Math.sin(a) * 6.5 * s);
    ctx.lineTo(Math.cos(a) * 11 * s, Math.sin(a) * 11 * s);
    ctx.stroke();
  }

  /* --- 帽子は頭より先に描く。こうすると顔に一切かぶらない --- */
  drawHat(ctx, look, hx, hy, hr, ang, s);

  /* --- 頭 --- */
  if (look.head === 'pumpkin') { drawPumpkinHead(ctx, look, hx, hy, hr, ang, t); }
  else if (look.head === 'blank') {
    ctx.fillStyle = look.skin;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2 * s; ctx.stroke();
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
    ctx.fillStyle = look.eye; ctx.shadowColor = look.eyeGlow || look.eye; ctx.shadowBlur = 9 * s;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(hr * 0.14, side * hr * 0.36, hr * 0.13, hr * 0.30, 0, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.restore();
  } else {
    const g = ctx.createRadialGradient(hx + fx * hr * 0.3, hy + fy * hr * 0.3, hr * 0.15, hx, hy, hr);
    g.addColorStop(0, look.skin); g.addColorStop(1, shade(look.skin, -0.28));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.1 * s; ctx.stroke();
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
    ctx.fillStyle = look.eye;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(hr * 0.12, side * hr * 0.34, hr * 0.13, hr * 0.19, 0, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.42)'; ctx.lineWidth = hr * 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hr * 0.56, -hr * 0.18); ctx.lineTo(hr * 0.56, hr * 0.18); ctx.stroke();
    ctx.restore();
  }

  /* --- 口から出る煙（ジャック・オ・ランタン） --- */
  if (look.smoke) {
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const p = ((t * 0.5 + i * 0.166) % 1);
      const d = hr * (0.75 + p * 2.8);
      const wob = Math.sin(t * 2.4 + i * 2.1) * 4 * s * p;
      const px = hx + fx * d - fy * wob;
      const py = hy + fy * d + fx * wob;
      ctx.globalAlpha = 0.45 * (1 - p);
      ctx.fillStyle = look.smoke;
      ctx.beginPath(); ctx.arc(px, py, (1.8 + p * 5.6) * s, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}

/** 16進色を明暗に振る。頭の陰影に使う */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => clamp(Math.round(c + 255 * k), 0, 255);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawPumpkinHead(ctx, look, hx, hy, hr, ang, t) {
  const fx = Math.cos(ang), fy = Math.sin(ang);
  // 果肉
  const g = ctx.createRadialGradient(hx + fx * hr * 0.3, hy + fy * hr * 0.3, hr * 0.15, hx, hy, hr);
  g.addColorStop(0, '#ffbe5e'); g.addColorStop(0.65, look.skin); g.addColorStop(1, '#b8540a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();

  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(ang);
  // 縦の溝（顔の左右に走る筋）
  ctx.strokeStyle = 'rgba(150,70,8,0.5)'; ctx.lineWidth = hr * 0.09;
  for (const ry of [hr * 0.32, hr * 0.66]) {
    ctx.beginPath(); ctx.ellipse(0, 0, hr * 0.96, ry, 0, 0, TAU); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = hr * 0.10;
  ctx.beginPath(); ctx.arc(0, 0, hr - hr * 0.05, 0, TAU); ctx.stroke();

  // 彫った顔：目は下向きの三角、口はぎざぎざの帯
  ctx.shadowColor = look.eyeGlow || '#7dff4a'; ctx.shadowBlur = hr * 0.9;
  ctx.fillStyle = look.eye;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-hr * 0.34, side * hr * 0.22);
    ctx.lineTo(hr * 0.16, side * hr * 0.58);
    ctx.lineTo(hr * 0.16, side * hr * 0.14);
    ctx.closePath(); ctx.fill();
  }
  // 口（前寄りに横一文字のぎざぎざ）
  const mx = hr * 0.40, mw = hr * 0.26, half = hr * 0.56;
  ctx.beginPath();
  ctx.moveTo(mx, -half);
  for (let i = 0; i <= 8; i++) {
    const yy = -half + (i / 8) * half * 2;
    ctx.lineTo(mx + (i % 2 ? mw : mw * 0.28), yy);
  }
  ctx.lineTo(mx, half);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  // 内側のちらつき
  ctx.globalAlpha = 0.22 + Math.sin(t * 7) * 0.10;
  ctx.fillStyle = '#eaffd6';
  ctx.beginPath(); ctx.ellipse(hr * 0.30, 0, hr * 0.26, hr * 0.40, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

/**
 * 帽子。drawCharacter が「頭より前」に呼ぶので、顔にかぶる部分は頭で隠れる。
 * ローカル座標では +x が向いている方向、-x が後頭部。
 */
function drawHat(ctx, look, hx, hy, hr, ang, s) {
  if (!look.hat || look.hat === 'none') { return; }
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(ang);

  if (look.hat === 'helmet') {
    ctx.fillStyle = look.hatDark;                       // つば
    ctx.beginPath(); ctx.ellipse(-hr * 0.16, 0, hr * 1.10, hr * 1.06, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = look.hatColor;                      // ドーム
    ctx.beginPath(); ctx.ellipse(-hr * 0.40, 0, hr * 0.96, hr * 0.94, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = look.hatDark; ctx.lineWidth = hr * 0.12;
    ctx.beginPath(); ctx.moveTo(-hr * 1.3, 0); ctx.lineTo(hr * 0.4, 0); ctx.stroke();
  } else if (look.hat === 'hood') {
    ctx.fillStyle = look.hatDark;
    ctx.beginPath(); ctx.ellipse(-hr * 0.30, 0, hr * 1.34, hr * 1.24, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = look.hatColor;
    ctx.beginPath(); ctx.ellipse(-hr * 0.44, 0, hr * 1.20, hr * 1.10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = look.hatDark;                       // 目深にかぶった影
    ctx.beginPath(); ctx.ellipse(-hr * 0.10, 0, hr * 1.02, hr * 1.02, 0, 0, TAU); ctx.fill();
  } else if (look.hat === 'top') {
    ctx.fillStyle = look.hatDark;                       // つば
    ctx.beginPath(); ctx.ellipse(-hr * 0.34, 0, hr * 1.32, hr * 1.20, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = look.hatColor;                      // クラウン
    ctx.beginPath(); ctx.ellipse(-hr * 1.20, 0, hr * 0.92, hr * 0.80, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = look.trim; ctx.lineWidth = hr * 0.14; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(-hr * 1.20, 0, hr * 0.94, hr * 0.82, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (look.hat === 'witch') {
    ctx.fillStyle = look.hatDark;                       // 大きなつば
    ctx.beginPath(); ctx.ellipse(-hr * 0.34, 0, hr * 1.56, hr * 1.40, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = look.hatColor;
    ctx.beginPath(); ctx.ellipse(-hr * 0.38, 0, hr * 1.40, hr * 1.24, 0, 0, TAU); ctx.fill();
    // 後ろに倒れた円錐
    const cg = ctx.createLinearGradient(0, -hr, 0, hr);
    cg.addColorStop(0, look.hatDark); cg.addColorStop(0.45, look.hatColor); cg.addColorStop(1, look.hatDark);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(-hr * 0.45, -hr * 0.98);
    ctx.quadraticCurveTo(-hr * 2.0, -hr * 0.80, -hr * 3.0, -hr * 0.06);
    ctx.quadraticCurveTo(-hr * 2.0, hr * 0.80, -hr * 0.45, hr * 0.98);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = hr * 0.08; ctx.stroke();
    // 光るバンド
    ctx.strokeStyle = look.hatBand || '#7dff4a';
    ctx.lineWidth = hr * 0.17; ctx.lineCap = 'round';
    ctx.shadowColor = look.hatBand || '#7dff4a'; ctx.shadowBlur = hr * 0.7;
    ctx.beginPath();
    ctx.moveTo(-hr * 1.02, -hr * 0.82); ctx.quadraticCurveTo(-hr * 1.42, 0, -hr * 1.02, hr * 0.82);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

/* -------------------------------------------------------------------------
   ツルハシ
   ------------------------------------------------------------------------- */
function drawPick(ctx, pick, x, y, s, ang, t, swingP = -1) {
  ctx.save();
  ctx.translate(x, y);
  // 振りの弧：-0.9 rad から +0.7 rad へ
  const sw = swingP >= 0 ? lerp(-0.95, 0.75, Math.pow(swingP, 0.55)) : 0;
  ctx.rotate(ang + sw);

  const L = 26 * s;
  // 柄
  ctx.strokeStyle = pick.haft; ctx.lineWidth = 3.2 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3 * s, 0); ctx.lineTo(L, 0); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.1 * s;
  ctx.beginPath(); ctx.moveTo(-3 * s, 1.1 * s); ctx.lineTo(L, 1.1 * s); ctx.stroke();

  // 頭（片刃＋片つち）
  ctx.translate(L, 0);
  const g = ctx.createLinearGradient(0, -9 * s, 0, 9 * s);
  g.addColorStop(0, pick.head); g.addColorStop(1, pick.headDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-2.6 * s, -3.2 * s);
  ctx.quadraticCurveTo(4 * s, -9 * s, 12 * s, -11 * s);
  ctx.quadraticCurveTo(6 * s, -5 * s, 4 * s, -1.4 * s);
  ctx.lineTo(4 * s, 1.4 * s);
  ctx.quadraticCurveTo(6 * s, 5 * s, 11 * s, 9.5 * s);
  ctx.quadraticCurveTo(3.5 * s, 8 * s, -2.6 * s, 3.2 * s);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.9 * s; ctx.stroke();

  // 特殊：ジャック・オ・ピックの残り火
  if (pick.ember) {
    for (let i = 0; i < 4; i++) {
      const p = ((t * 0.9 + i * 0.25) % 1);
      ctx.globalAlpha = 0.55 * (1 - p);
      ctx.fillStyle = pick.spark;
      ctx.beginPath(); ctx.arc(7 * s, -2 * s - p * 12 * s, (1.4 + p * 2.6) * s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (pick.lightRange) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = pick.spark; ctx.shadowColor = pick.spark; ctx.shadowBlur = 10 * s;
    ctx.beginPath(); ctx.arc(2 * s, 0, 2.4 * s, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* =========================================================================
   本編の描画
   ========================================================================= */
const R = {
  canvas: null, ctx: null, dark: null, dctx: null,
  w: 0, h: 0, dpr: 1, zoom: 1.3, camX: 0, camY: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dark = document.createElement('canvas');
    this.dctx = this.dark.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  },

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(240, this.canvas.clientHeight || window.innerHeight);
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.dark.width = this.canvas.width;
    this.dark.height = this.canvas.height;
    this.w = this.canvas.width; this.h = this.canvas.height;
    this.zoom = clamp(this.h / (14.2 * TILE), 0.8, 2.6);
  },

  worldFromScreen(sx, sy) {
    return { x: (sx - this.w / 2) / this.zoom + this.camX, y: (sy - this.h / 2) / this.zoom + this.camY };
  },

  /* ---------- メイン ---------- */
  draw(st) {
    const ctx = this.ctx;
    const pal = st.stage.pal;

    // カメラ
    this.camX = lerp(this.camX, st.p.x, 0.16);
    this.camY = lerp(this.camY, st.p.y, 0.16);
    const shake = st.shake > 0 ? st.shake : 0;
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pal.fog;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    const half = { x: this.w / 2 / this.zoom + TILE, y: this.h / 2 / this.zoom + TILE };
    const x0 = Math.max(0, Math.floor((this.camX - half.x) / TILE));
    const x1 = Math.min(st.W - 1, Math.ceil((this.camX + half.x) / TILE));
    const y0 = Math.max(0, Math.floor((this.camY - half.y) / TILE));
    const y1 = Math.min(st.H - 1, Math.ceil((this.camY + half.y) / TILE));

    this.drawFloor(st, pal, x0, y0, x1, y1);
    this.drawProps(st, pal);
    this.drawWalls(st, pal, x0, y0, x1, y1);
    this.drawEnts(st);
    this.drawPlayer(st);
    this.drawParticles(st);

    ctx.restore();

    this.drawLight(st, pal);

    ctx.save();
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);
    this.drawOverlay(st);
    ctx.restore();
  },

  /* ---------- 床 ---------- */
  drawFloor(st, pal, x0, y0, x1, y1) {
    const ctx = this.ctx;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = st.tiles[y * st.W + x];
        if (t === T.WALL || t === T.VOID) { continue; }
        const px = x * TILE, py = y * TILE;
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        ctx.fillStyle = ((x + y) & 1) ? pal.floor : pal.floor2;
        ctx.fillRect(px, py, TILE, TILE);
        if ((h & 7) === 0) {
          ctx.globalAlpha = 0.16; ctx.fillStyle = pal.ink;
          ctx.beginPath();
          ctx.ellipse(px + TILE * 0.5, py + TILE * 0.5, TILE * 0.34, TILE * 0.26, (h % 7), 0, TAU);
          ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.globalAlpha = 0.10; ctx.strokeStyle = pal.ink; ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        ctx.globalAlpha = 1;
        if (t === T.RUBBLE) {
          ctx.fillStyle = pal.crack; ctx.globalAlpha = 0.75;
          for (let i = 0; i < 5; i++) {
            const hh = (h >> (i * 3)) & 31;
            ctx.beginPath();
            ctx.arc(px + 6 + (hh % 28), py + 6 + ((hh * 7) % 28), 2 + (hh % 3), 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
    }
  },

  /* ---------- 壁・扉・支柱 ---------- */
  drawWalls(st, pal, x0, y0, x1, y1) {
    const ctx = this.ctx;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * st.W + x;
        const t = st.tiles[i];
        if (!SOLID.has(t)) { continue; }
        const px = x * TILE, py = y * TILE;

        if (t === T.WALL || t === T.DECO) {
          ctx.fillStyle = t === T.DECO ? pal.crack : pal.wall;
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = pal.wallTop;
          ctx.fillRect(px, py, TILE, 6);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(px, py + TILE - 5, TILE, 5);
          if (t === T.DECO) {
            ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2;
            ctx.strokeRect(px + 5.5, py + 5.5, TILE - 11, TILE - 11);
          }
        } else if (t === T.CRACK) {
          const hp = st.hp[i], max = BREAKABLE[T.CRACK];
          ctx.fillStyle = pal.crack;
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = pal.wallTop; ctx.globalAlpha = 0.5;
          ctx.fillRect(px, py, TILE, 5); ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
          const seed = ((x * 374761393) ^ (y * 668265263)) >>> 0;
          const n = 3 + (max - hp) * 3;
          for (let k = 0; k < n; k++) {
            const s1 = (seed >> (k % 8)) & 31, s2 = (seed >> ((k + 3) % 8)) & 31;
            ctx.beginPath();
            ctx.moveTo(px + 4 + s1, py + 4 + s2);
            ctx.lineTo(px + 4 + ((s2 * 3) % 32), py + 4 + ((s1 * 5) % 32));
            ctx.stroke();
          }
          if (hp < max) {
            ctx.globalAlpha = 0.30 * (1 - hp / max) + 0.12;
            ctx.fillStyle = '#000'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
            ctx.globalAlpha = 1;
          }
        } else if (t === T.DOOR) {
          const hp = st.hp[i], max = BREAKABLE[T.DOOR];
          ctx.fillStyle = '#5a3a22'; ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = '#754d2d'; ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
          ctx.strokeStyle = '#3a2312'; ctx.lineWidth = 2;
          ctx.strokeRect(px + 7.5, py + 7.5, TILE - 15, TILE - 15);
          ctx.fillStyle = '#cfa63e';
          ctx.beginPath(); ctx.arc(px + TILE - 11, py + TILE / 2, 3.2, 0, TAU); ctx.fill();
          ctx.fillStyle = '#8b6a1e';
          ctx.fillRect(px + TILE - 15, py + TILE / 2 - 7, 8, 14);
          ctx.fillStyle = '#e8c85a';
          ctx.fillRect(px + TILE - 13, py + TILE / 2 - 5, 4, 10);
          if (hp < max) {
            ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 2;
            for (let k = 0; k < (max - hp) * 2; k++) {
              ctx.beginPath();
              ctx.moveTo(px + 6 + k * 5, py + 6);
              ctx.lineTo(px + 12 + ((k * 7) % 22), py + TILE - 6);
              ctx.stroke();
            }
          }
        } else if (t === T.PILLAR) {
          const hp = st.hp[i], max = BREAKABLE[T.PILLAR];
          ctx.fillStyle = '#3b3244';
          ctx.fillRect(px - 6, py - 26, TILE + 12, TILE + 26);
          const g = ctx.createLinearGradient(px - 6, 0, px + TILE + 6, 0);
          g.addColorStop(0, '#2b2432'); g.addColorStop(0.45, '#6a5c78'); g.addColorStop(1, '#2b2432');
          ctx.fillStyle = g;
          ctx.fillRect(px - 4, py - 24, TILE + 8, TILE + 22);
          ctx.fillStyle = '#8a7a99';
          ctx.fillRect(px - 8, py - 30, TILE + 16, 8);
          ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2.4;
          for (let k = 0; k < (max - hp); k++) {
            ctx.beginPath();
            ctx.moveTo(px + 2 + k * 4, py - 20 + ((k * 11) % 40));
            ctx.lineTo(px + TILE - 4 - ((k * 7) % 20), py - 4 + ((k * 13) % 30));
            ctx.stroke();
          }
          ctx.fillStyle = '#c7a3ff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`${hp}`, px + TILE / 2, py - 33);
        }
      }
    }
  },

  /* ---------- 宝箱・鍵・出口・ランプ ---------- */
  drawProps(st, pal) {
    const ctx = this.ctx;
    const t = st.time;

    for (const l of st.lamps) {
      const px = l.x * TILE + TILE / 2, py = l.y * TILE + TILE / 2;
      const on = !l.dead && (Math.sin(t * 3 + l.ph) > -0.7 || st.stage.lamps.flicker < 0.4);
      ctx.globalAlpha = on ? 0.9 : 0.15;
      ctx.fillStyle = on ? st.stage.lamps.color : '#3a3a3a';
      ctx.fillRect(px - 13, py - 4, 26, 8);
      ctx.globalAlpha = 1;
    }

    // 出口
    const ex = st.exit.x * TILE, ey = st.exit.y * TILE;
    const open = st.keysGot >= st.keysTotal;
    ctx.fillStyle = open ? '#123' : '#210';
    ctx.fillRect(ex, ey, TILE, TILE);
    ctx.strokeStyle = open ? '#3ef29a' : '#ff5a4a';
    ctx.lineWidth = 3;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14 + Math.sin(t * 4) * 6;
    ctx.strokeRect(ex + 4, ey + 4, TILE - 8, TILE - 8);
    ctx.shadowBlur = 0;
    ctx.fillStyle = open ? '#3ef29a' : '#ff5a4a';
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(open ? 'EXIT' : 'LOCK', ex + TILE / 2, ey + TILE / 2 + 3.5);

    for (const c of st.chests) {
      const px = c.x * TILE + TILE / 2, py = c.y * TILE + TILE / 2;
      if (c.open) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#3a2c1c';
        roundRect(ctx, px - 13, py - 8, 26, 16, 3); ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = '#000'; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(px, py + 9, 13, 5, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      const dmg = 1 - c.hp / 2;
      ctx.fillStyle = c.loot === 'big' || c.loot === 'key' ? '#8a5a1e' : '#6a4a26';
      roundRect(ctx, px - 14, py - 11, 28, 21, 3); ctx.fill();
      ctx.fillStyle = c.loot === 'big' || c.loot === 'key' ? '#c08a30' : '#8a6a3c';
      roundRect(ctx, px - 14, py - 13, 28, 10, 4); ctx.fill();
      ctx.fillStyle = '#e0c060';
      ctx.fillRect(px - 3, py - 6, 6, 9);
      ctx.strokeStyle = '#2a1c0c'; ctx.lineWidth = 1.6;
      roundRect(ctx, px - 14, py - 13, 28, 23, 3); ctx.stroke();
      if (dmg > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px - 10, py - 8); ctx.lineTo(px + 6, py + 7); ctx.stroke();
      }
    }

    for (const k of st.keys) {
      if (k.got) { continue; }
      const px = k.x * TILE + TILE / 2, py = k.y * TILE + TILE / 2 + Math.sin(t * 3 + k.x) * 3;
      ctx.save();
      ctx.shadowColor = '#ffd75e'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath(); ctx.arc(px - 4, py, 5, 0, TAU); ctx.fill();
      ctx.fillRect(px - 1, py - 1.6, 12, 3.2);
      ctx.fillRect(px + 7, py, 3, 5);
      ctx.fillStyle = '#0e0c05';
      ctx.beginPath(); ctx.arc(px - 4, py, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
    }

    for (const it of st.items) {
      const px = it.x, py = it.y + Math.sin(t * 4 + px) * 2.5;
      ctx.save();
      const col = it.type === 'heal' ? '#ff5a6e' : it.type === 'battery' ? '#5ec8ff' : '#ffb14a';
      ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.fillStyle = col;
      if (it.type === 'candy') {
        ctx.beginPath(); ctx.ellipse(px, py, 6, 4.5, 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.6;
        ctx.fillRect(px - 5, py - 1, 10, 1.6);
      } else if (it.type === 'battery') {
        roundRect(ctx, px - 5, py - 8, 10, 16, 2); ctx.fill();
        ctx.fillStyle = '#0a1520'; ctx.fillRect(px - 3, py - 4, 6, 8);
      } else {
        roundRect(ctx, px - 8, py - 6, 16, 12, 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(px - 1.6, py - 4, 3.2, 8); ctx.fillRect(px - 5, py - 1.6, 10, 3.2);
      }
      ctx.restore();
    }
  },

  /* ---------- 実体 ---------- */
  drawEnts(st) {
    const ctx = this.ctx;
    const t = st.time;
    for (const e of st.ents) {
      if (e.dead) { continue; }
      const d = ENTS[e.type];
      ctx.save();
      ctx.translate(e.x, e.y);

      ctx.globalAlpha = 0.4; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, d.radius * 0.6, d.radius * 0.9, d.radius * 0.4, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;

      const hurt = e.hurtT > 0;
      if (e.type === 'smiler') { this.drawSmiler(ctx, e, d, t, hurt); }
      else if (e.type === 'hound') { this.drawHound(ctx, e, d, t, hurt); }
      else if (e.type === 'crawler') { this.drawCrawler(ctx, e, d, t, hurt); }
      else if (e.type === 'partygoer') { this.drawPartygoer(ctx, e, d, t, hurt); }
      else if (e.type === 'skinstealer') { this.drawStealer(ctx, e, d, t, hurt, st); }
      else if (e.type === 'silence') { this.drawSilence(ctx, e, d, t); }

      // 怯み
      if (e.fearT > 0) {
        ctx.globalAlpha = 0.5 + Math.sin(t * 18) * 0.2;
        ctx.strokeStyle = '#7dff4a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, d.radius + 6, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // 体力
      if (e.hp < d.hp && d.hp < 9999) {
        const w = d.radius * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-w / 2, -d.radius - 12, w, 4);
        ctx.fillStyle = '#ff5a6e'; ctx.fillRect(-w / 2, -d.radius - 12, w * (e.hp / d.hp), 4);
      }
      ctx.restore();
    }
  },

  drawSmiler(ctx, e, d, t, hurt) {
    const lit = e.litT > 0;
    ctx.globalAlpha = lit ? 0.95 : 0.55;
    ctx.fillStyle = hurt ? '#fff' : d.body;
    ctx.beginPath(); ctx.arc(0, 0, d.radius, 0, TAU); ctx.fill();
    if (lit) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(20,22,28,0.9)';
      ctx.beginPath(); ctx.ellipse(0, 8, d.radius * 0.8, d.radius * 0.5, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 笑顔
    ctx.fillStyle = d.glow;
    ctx.shadowColor = d.glow; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(-9, -1);
    for (let i = 0; i <= 8; i++) {
      const p = i / 8;
      ctx.lineTo(-9 + p * 18, -1 + Math.sin(p * Math.PI) * 7 + (i % 2 ? 0 : 2.4));
    }
    ctx.lineTo(9, -1);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // 目
    ctx.fillStyle = d.glow;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 5, -7, 1.6, 0, TAU); ctx.fill(); }
  },

  drawHound(ctx, e, d, t, hurt) {
    ctx.rotate(e.ang);
    const gait = Math.sin(t * 16 + e.seed) * 3;
    ctx.fillStyle = hurt ? '#fff' : d.body;
    ctx.beginPath(); ctx.ellipse(0, 0, d.radius * 1.25, d.radius * 0.72, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a1610'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-4, s * 6); ctx.lineTo(-9, s * (11 + gait * s)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, s * 6); ctx.lineTo(12, s * (11 - gait * s)); ctx.stroke();
    }
    ctx.fillStyle = hurt ? '#fff' : '#38201a';
    ctx.beginPath(); ctx.ellipse(13, 0, 8, 6.5, 0, 0, TAU); ctx.fill();
    // 口
    ctx.fillStyle = d.glow; ctx.shadowColor = d.glow; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(14, -4); ctx.lineTo(22, -1.5); ctx.lineTo(22, 1.5); ctx.lineTo(14, 4);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) { ctx.fillRect(15 + i * 2, -3.5 + (i % 2) * 5, 1.2, 2.6); }
  },

  drawCrawler(ctx, e, d, t, hurt) {
    ctx.rotate(e.ang);
    ctx.fillStyle = hurt ? '#fff' : d.body;
    ctx.beginPath(); ctx.ellipse(0, 0, d.radius * 1.1, d.radius * 0.6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = d.body; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = Math.sin(t * 12 + i * 1.7 + e.seed) * 0.5;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-6 + i * 6, s * 4);
        ctx.lineTo(-8 + i * 6 + Math.cos(a) * 6, s * (10 + Math.sin(a) * 4));
        ctx.stroke();
      }
    }
    ctx.fillStyle = d.glow; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.ellipse(9, 0, 4, 3, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  },

  drawPartygoer(ctx, e, d, t, hurt) {
    const bob = Math.sin(t * 9 + e.seed) * 2;
    ctx.translate(0, bob);
    ctx.fillStyle = hurt ? '#fff' : d.body;
    ctx.beginPath(); ctx.arc(0, 0, d.radius, 0, TAU); ctx.fill();
    ctx.fillStyle = d.glow;
    ctx.beginPath();
    ctx.moveTo(-7, -d.radius + 1); ctx.lineTo(0, -d.radius - 9); ctx.lineTo(7, -d.radius + 1);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#150a10';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 4, -1, 2, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 5, 3.4, 0, Math.PI); ctx.fill();
  },

  drawStealer(ctx, e, d, t, hurt, st) {
    // プレイヤーのスキンの色を借りる
    const look = Object.assign({}, st.look, {
      coat: e.close ? d.body : st.look.coat,
      coatDark: e.close ? '#8a7566' : st.look.coatDark,
      skin: e.close ? '#cbb6a2' : st.look.skin,
      eye: e.close ? '#ff3b3b' : st.look.eye,
      eyeGlow: e.close ? '#ff3b3b' : st.look.eyeGlow,
      smoke: null,
    });
    ctx.save();
    if (hurt) { ctx.globalAlpha = 0.7; }
    drawCharacter(ctx, look, 0, 0, 1.15, e.ang, t, { walk: 1, shadow: false });
    if (e.close) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        const a = e.ang + (i - 2) * 0.28;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  drawSilence(ctx, e, d, t) {
    const r = d.radius;
    ctx.globalAlpha = 0.92;
    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.5);
    g.addColorStop(0, '#000'); g.addColorStop(0.75, d.body); g.addColorStop(1, 'rgba(10,12,16,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    // ゆらめく輪郭
    ctx.strokeStyle = d.glow; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * TAU;
      const rr = r * (1 + Math.sin(a * 5 + t * 3) * 0.09);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    // 目
    ctx.fillStyle = d.glow; ctx.shadowColor = d.glow; ctx.shadowBlur = 20;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(s * 9, -6, 3, 6.5, 0, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
  },

  /* ---------- プレイヤー ---------- */
  drawPlayer(st) {
    const ctx = this.ctx, p = st.p;
    if (p.dead) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(0.5); ctx.globalAlpha = 0.7;
      drawCharacter(ctx, st.look, 0, 0, 1.05, p.ang, st.time, { walk: 0 });
      ctx.restore();
      return;
    }
    const inv = p.invT > 0 && Math.floor(st.time * 20) % 2 === 0;
    ctx.save();
    if (inv) { ctx.globalAlpha = 0.45; }
    const swingP = p.swingT > 0 ? 1 - p.swingT / p.swingDur : -1;
    // 後ろ手のツルハシは体より先に描く
    drawCharacter(ctx, st.look, p.x, p.y, 1.15, p.ang, st.time, { walk: p.moving ? 1 : 0 });
    const hx = p.x + Math.cos(p.ang + 0.9) * 9, hy = p.y + Math.sin(p.ang + 0.9) * 9;
    drawPick(ctx, st.pick, hx, hy, 0.95, p.ang, st.time, swingP);
    ctx.restore();
  },

  /* ---------- 粒子 ---------- */
  drawParticles(st) {
    const ctx = this.ctx;
    for (const q of st.parts) {
      const life = q.t / q.max;
      ctx.globalAlpha = clamp(life, 0, 1) * (q.a ?? 1);
      ctx.fillStyle = q.c;
      if (q.kind === 'smoke') {
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1.6 - life * 0.6), 0, TAU); ctx.fill();
      } else if (q.kind === 'chip') {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillRect(-q.r, -q.r * 0.6, q.r * 2, q.r * 1.2);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r * life, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },

  /* ---------- 光 ---------- */
  drawLight(st, pal) {
    const d = this.dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.fillStyle = pal.fog;
    d.globalAlpha = 1;
    d.fillRect(0, 0, this.w, this.h);

    d.save();
    d.translate(this.w / 2, this.h / 2);
    d.scale(this.zoom, this.zoom);
    d.translate(-this.camX, -this.camY);
    d.globalCompositeOperation = 'destination-out';

    const p = st.p;

    // 足元のわずかな視界
    this.punch(d, st, p.x, p.y, 0, TAU, 84, 1.0, true);

    // 懐中電灯
    if (p.light && p.bat > 0) {
      const range = 330 + (st.pick.lightRange || 0);
      const fov = 0.62 + (st.pick.lightFov || 0);
      this.punch(d, st, p.x, p.y, p.ang, fov, range, 1.0, true);
    }

    // 天井灯（近いものだけ）
    let lit = 0;
    for (const l of st.lamps) {
      if (l.dead || lit >= 14) { continue; }
      const lx = l.x * TILE + TILE / 2, ly = l.y * TILE + TILE / 2;
      if (dist2(lx, ly, this.camX, this.camY) > 560 * 560) { continue; }
      lit++;
      const flick = st.stage.lamps.flicker;
      const on = Math.sin(st.time * 3 + l.ph) > -0.7 || flick < 0.4;
      if (!on) { continue; }
      const jitter = 1 - Math.random() * flick * 0.25;
      this.punch(d, st, lx, ly, 0, TAU, 170 * jitter, 0.82, false);
    }

    d.restore();

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.dark, 0, 0);

    // 光の帯（加算）
    if (p.light && p.bat > 0) {
      const c = this.ctx;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.translate(this.w / 2, this.h / 2); c.scale(this.zoom, this.zoom); c.translate(-this.camX, -this.camY);
      const range = 330 + (st.pick.lightRange || 0);
      const g = c.createRadialGradient(p.x, p.y, 10, p.x, p.y, range);
      g.addColorStop(0, 'rgba(255,246,214,0.20)');
      g.addColorStop(0.5, 'rgba(255,240,200,0.07)');
      g.addColorStop(1, 'rgba(255,240,200,0)');
      c.fillStyle = g;
      const fov = 0.62 + (st.pick.lightFov || 0);
      c.beginPath(); c.moveTo(p.x, p.y);
      c.arc(p.x, p.y, range, p.ang - fov, p.ang + fov); c.closePath(); c.fill();
      c.restore();
    }
  },

  /**
   * 視界のくり抜き。壁でぶつかるまでレイを飛ばして多角形にする。
   * mark = true のとき通過タイルを踏破済みとして記録する（ミニマップ用）。
   */
  punch(d, st, ox, oy, ang, fov, range, strength, mark) {
    const full = fov >= Math.PI * 1.9;
    const rays = full ? 56 : Math.max(28, Math.floor(range / 6));
    const step = 7;
    const pts = [];
    for (let i = 0; i <= rays; i++) {
      const a = full ? (i / rays) * TAU : ang - fov + (i / rays) * fov * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      let dd = 0;
      while (dd < range) {
        dd += step;
        const tx = ((ox + cx * dd) / TILE) | 0, ty = ((oy + cy * dd) / TILE) | 0;
        if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) { break; }
        const ti = ty * st.W + tx;
        if (mark) { st.seen[ti] = 1; }
        if (OPAQUE.has(st.tiles[ti])) { dd = Math.min(range, dd + step * 3.6); break; }   // 壁の手前面まで照らす
      }
      pts.push([ox + cx * Math.min(dd, range), oy + cy * Math.min(dd, range)]);
    }

    const g = d.createRadialGradient(ox, oy, range * 0.12, ox, oy, range);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.70, `rgba(0,0,0,${strength * 0.88})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = g;
    d.beginPath();
    if (!full) { d.moveTo(ox, oy); }
    for (let i = 0; i < pts.length; i++) {
      if (i === 0 && full) { d.moveTo(pts[i][0], pts[i][1]); } else { d.lineTo(pts[i][0], pts[i][1]); }
    }
    d.closePath(); d.fill();
  },

  /* ---------- 光の上に重ねるもの ---------- */
  drawOverlay(st) {
    const ctx = this.ctx, t = st.time;

    // 音の輪
    for (const n of st.noiseRings) {
      const p = n.t / n.max;
      ctx.globalAlpha = (1 - p) * 0.35;
      ctx.strokeStyle = n.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * p, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // エモートの吹き出し
    for (const b of st.bubbles) {
      const p = 1 - b.t / b.max;
      const y = b.y - 34 - p * 26;
      ctx.save();
      ctx.globalAlpha = clamp(b.t / 0.4, 0, 1);
      ctx.font = '26px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(10,10,14,0.72)';
      roundRect(ctx, b.x - 22, y - 20, 44, 40, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillText(b.emoji, b.x, y + 1);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 支柱（ボス面の目標）は暗闇の上からでも位置が分かるようにする
    for (const q of st.pillars) {
      if (st.tiles[q.y * st.W + q.x] !== T.PILLAR) { continue; }
      const px = q.x * TILE + TILE / 2, py = q.y * TILE + TILE / 2;
      const pulse = 0.45 + Math.sin(t * 2.4 + q.x) * 0.18;
      const g = ctx.createRadialGradient(px, py, 6, px, py, 92);
      g.addColorStop(0, `rgba(176,122,216,${pulse * 0.9})`);
      g.addColorStop(1, 'rgba(176,122,216,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, 92, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(199,163,255,${pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 26 + Math.sin(t * 2.4 + q.x) * 4, 0, TAU); ctx.stroke();
    }

    // 破壊対象のねらい表示
    if (st.aim) {
      const px = st.aim.x * TILE, py = st.aim.y * TILE;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 22;
      ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
      ctx.setLineDash([]);
      if (st.aim.hp) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(px + 4, py - 9, TILE - 8, 5);
        ctx.fillStyle = '#ffd75e';
        ctx.fillRect(px + 4, py - 9, (TILE - 8) * (st.aim.hp / st.aim.max), 5);
      }
    }
  },

  /* ---------- ミニマップ ---------- */
  minimap(cv, st) {
    const c = cv.getContext('2d');
    const S = cv.width;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(6,6,8,0.88)';
    c.fillRect(0, 0, S, S);
    const span = 34;                                   // 表示するタイル数
    const px = st.p.x / TILE, py = st.p.y / TILE;
    const k = S / span;
    const ox = px - span / 2, oy = py - span / 2;
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const tx = Math.floor(ox + x), ty = Math.floor(oy + y);
        if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) { continue; }
        const i = ty * st.W + tx;
        if (!st.seen[i]) { continue; }
        const t = st.tiles[i];
        let col = null;
        if (t === T.WALL || t === T.DECO) { col = '#4a4636'; }
        else if (t === T.CRACK) { col = '#8a7a34'; }
        else if (t === T.DOOR) { col = '#a5652a'; }
        else if (t === T.PILLAR) { col = '#a07ad8'; }
        else if (t === T.EXIT) { col = st.keysGot >= st.keysTotal ? '#3ef29a' : '#ff5a4a'; }
        else if (passWalk(t)) { col = '#1e2028'; }
        if (col) { c.fillStyle = col; c.fillRect((tx - ox) * k, (ty - oy) * k, k + 0.6, k + 0.6); }
      }
    }
    for (const q of st.pillars) {
      if (st.tiles[q.y * st.W + q.x] !== T.PILLAR) { continue; }
      c.fillStyle = '#c7a3ff';
      c.fillRect((q.x - ox) * k - 1.5, (q.y - oy) * k - 1.5, k + 3, k + 3);
    }
    for (const kk of st.keys) {
      if (kk.got || !st.seen[kk.y * st.W + kk.x]) { continue; }
      c.fillStyle = '#ffd75e';
      c.fillRect((kk.x - ox) * k - 1, (kk.y - oy) * k - 1, k + 2, k + 2);
    }
    // 自分
    c.fillStyle = '#7dff4a';
    c.beginPath(); c.arc(S / 2, S / 2, 3.2, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(125,255,74,0.6)'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(S / 2, S / 2);
    c.lineTo(S / 2 + Math.cos(st.p.ang) * 10, S / 2 + Math.sin(st.p.ang) * 10);
    c.stroke();
    c.strokeStyle = 'rgba(227,201,106,0.35)'; c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, S - 1, S - 1);
  },
};
