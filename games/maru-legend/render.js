/* =========================================================================
   マルの伝説 ― 描画
   地形・神殿の部屋・キャラクター（どれも丸3つだけ）・HUD・会話ウィンドウ
   ========================================================================= */

const FONT = '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif';
const OUT = '#1d1b26';   // 輪郭線の色

const PAL = {
  grass: '#8ccf5e', grassTuft: '#6fb447',
  path: '#e9d39a', pathDot: '#cdb57c',
  tree: '#2f8a4a', treeHi: '#55b86a',
  bush: '#4fae4a', bushHi: '#86d870',
  rock: '#a19ea8', rockHi: '#d0cdd6',
  mount: '#b5793f', mountHi: '#d29659', mountDark: '#7d4d26',
  water: '#3f9de2', waterHi: '#a6dcff', foam: '#d9f2ff',
  castle: '#6c6684', castleHi: '#8b85a5', castleDark: '#4a4560',
  forestTemple: '#7f9a6b', forestTempleHi: '#a3bd8c', forestTempleDark: '#566d48',
  rockTemple: '#a8794e', rockTempleHi: '#c9996b', rockTempleDark: '#734d2c',
  wood: '#a0683a', woodDark: '#6e4423',
};

const THEMES = {
  cave:   { floor: '#3b2e27', floor2: '#33271f', wall: '#5b4537', wallHi: '#7a5d49', wallDark: '#2e221b', block: '#7a6a5c' },
  forest: { floor: '#4f7049', floor2: '#466441', wall: '#2f5236', wallHi: '#4f8053', wallDark: '#1b3321', block: '#7c9a6d' },
  rock:   { floor: '#6e5743', floor2: '#644e3b', wall: '#7a4f2e', wallHi: '#a56f44', wallDark: '#47291a', block: '#a48a70' },
  castle: { floor: '#3f3654', floor2: '#382f4b', wall: '#2b2442', wallHi: '#51457a', wallDark: '#161126', block: '#6d6190' },
};

/** タイル座標から決まる 0〜1 の乱数（毎フレーム同じ模様にするため）。 */
function hash2(c, r, s = 0) {
  let h = (c * 374761393 + r * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function circ(ctx, x, y, r, fill, lw = 2, stroke = OUT) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.05, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x - s * 0.1, y + s * 0.75, x, y + s * 0.95);
  ctx.bezierCurveTo(x + s * 0.1, y + s * 0.75, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.05, x, y, x, y + s * 0.35);
  ctx.closePath();
}

const Render = {
  /* ===================== 全体 ===================== */
  draw(ctx) {
    const G = Game;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (!G.room) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HUD_H, RW, RH);
    ctx.clip();
    ctx.translate(0, HUD_H);
    if (G.shake > 0) ctx.translate(rand(-3, 3), rand(-3, 3));

    if (G.mode === 'scroll') {
      const tr = G.trans;
      const k = Math.min(1, tr.t / tr.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const ox = -tr.dx * RW * e, oy = -tr.dy * RH * e;
      this.room(ctx, tr.from, ox, oy);
      this.room(ctx, tr.to, ox + tr.dx * RW, oy + tr.dy * RH);
      const px = lerp(tr.pFrom.x - tr.dx * RW, tr.pTo.x, e) + ox + tr.dx * RW;
      const py = lerp(tr.pFrom.y - tr.dy * RH, tr.pTo.y, e) + oy + tr.dy * RH;
      this.hero(ctx, G.player, px, py);
    } else {
      this.room(ctx, G.room, 0, 0);
      this.entities(ctx);
    }

    if (G.mode === 'warp') {
      const tr = G.trans;
      const k = tr.t / tr.dur;
      ctx.fillStyle = `rgba(0,0,0,${clamp(k < 0.5 ? k * 2.2 : (1 - k) * 2.2, 0, 1)})`;
      ctx.fillRect(0, 0, RW, RH);
    }
    if (G.mode === 'dead') {
      ctx.fillStyle = `rgba(120,0,20,${Math.min(0.55, G.player.deadT * 0.4)})`;
      ctx.fillRect(0, 0, RW, RH);
    }
    this.bossBar(ctx);
    ctx.restore();

    if (G.mode !== 'title') this.hud(ctx);
    if (G.toastMsg && G.mode !== 'title') this.toast(ctx);
    if (G.dialog) this.dialog(ctx);
  },

  /* ===================== 部屋 ===================== */
  room(ctx, room, ox, oy) {
    ctx.save();
    ctx.translate(ox, oy);
    if (room.kind === 'field') this.field(ctx, room);
    else this.interior(ctx, room);
    ctx.restore();
  },

  field(ctx, room) {
    const g = room.grid;
    const t = Game.t;
    // 1回目: 地面
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) this.ground(ctx, g, c, r, t);
    // 2回目: 木や岩など地面の上に立つ物
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) this.feature(ctx, room, c, r, t);
  },

  ground(ctx, g, c, r, t) {
    const ch = g[r][c];
    const x = c * TS, y = r * TS;
    const at = (cc, rr) => (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS ? null : g[rr][cc]);
    switch (ch) {
      case ':': {
        ctx.fillStyle = PAL.path;
        ctx.fillRect(x - 0.4, y - 0.4, TS + 0.8, TS + 0.8);   // 拡大率が半端でも継ぎ目が出ないよう少し重ねる
        ctx.fillStyle = PAL.pathDot;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x + 4 + hash2(c, r, i) * 24, y + 4 + hash2(c, r, i + 9) * 24, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'W':
      case '=': {
        ctx.fillStyle = PAL.water;
        ctx.fillRect(x - 0.4, y - 0.4, TS + 0.8, TS + 0.8);
        ctx.strokeStyle = PAL.waterHi;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 2; i++) {
          const wx = x + 6 + hash2(c, r, i) * 14 + Math.sin(t * 1.6 + c + i) * 3;
          const wy = y + 9 + i * 13;
          ctx.beginPath();
          ctx.arc(wx, wy, 5, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        }
        const above = at(c, r - 1);
        if (above && above !== 'W' && above !== '=') {
          ctx.fillStyle = PAL.foam;
          ctx.fillRect(x - 0.4, y, TS + 0.8, 3);
        }
        break;
      }
      case 'M': case 'X': case 'C': this.mountain(ctx, g, c, r, ch); break;
      case 'H': case 'G': this.bricks(ctx, x, y, c, r, PAL.castle, PAL.castleHi, PAL.castleDark); break;
      case 'Y': this.bricks(ctx, x, y, c, r, PAL.forestTemple, PAL.forestTempleHi, PAL.forestTempleDark); break;
      case 'Q': this.bricks(ctx, x, y, c, r, PAL.rockTemple, PAL.rockTempleHi, PAL.rockTempleDark); break;
      case 'D': {
        let k = c;
        while (k >= 0 && g[r][k] === 'D') k--;
        const wall = k >= 0 ? g[r][k] : 'Y';
        if (wall === 'Q') this.bricks(ctx, x, y, c, r, PAL.rockTemple, PAL.rockTempleHi, PAL.rockTempleDark);
        else this.bricks(ctx, x, y, c, r, PAL.forestTemple, PAL.forestTempleHi, PAL.forestTempleDark);
        break;
      }
      default: {
        ctx.fillStyle = PAL.grass;
        ctx.fillRect(x - 0.4, y - 0.4, TS + 0.8, TS + 0.8);
        ctx.strokeStyle = PAL.grassTuft;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 2; i++) {
          const gx = x + 5 + hash2(c, r, i + 3) * 20, gy = y + 8 + hash2(c, r, i + 7) * 18;
          ctx.beginPath();
          ctx.moveTo(gx - 3, gy - 3);
          ctx.lineTo(gx, gy);
          ctx.lineTo(gx + 3, gy - 3);
          ctx.stroke();
        }
      }
    }
  },

  mountain(ctx, g, c, r, ch) {
    const x = c * TS, y = r * TS;
    const isM = (cc, rr) => {
      if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS) return true;
      const k = g[rr][cc];
      return k === 'M' || k === 'X' || k === 'C';
    };
    ctx.fillStyle = PAL.mount;
    ctx.fillRect(x - 0.4, y - 0.4, TS + 0.8, TS + 0.8);
    ctx.fillStyle = PAL.mountHi;
    for (let i = 0; i < 2; i++) {
      rrect(ctx, x + 3 + hash2(c, r, i) * 16, y + 3 + hash2(c, r, i + 4) * 16, 10, 7, 3);
      ctx.fill();
    }
    if (!isM(c, r + 1)) {
      ctx.fillStyle = PAL.mountDark;
      ctx.fillRect(x - 0.4, y + TS - 7, TS + 0.8, 7);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x - 0.4, y + TS, TS + 0.8, 4);
    }
    if (!isM(c, r - 1)) {
      ctx.fillStyle = PAL.mountHi;
      ctx.fillRect(x - 0.4, y, TS + 0.8, 3);
    }
  },

  bricks(ctx, x, y, c, r, base, hi, dark) {
    ctx.fillStyle = base;
    ctx.fillRect(x - 0.4, y - 0.4, TS + 0.8, TS + 0.8);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let row = 0; row < 4; row++) {
      const yy = y + row * 8;
      ctx.moveTo(x, yy + 0.5);
      ctx.lineTo(x + TS, yy + 0.5);
      const off = (row + r) % 2 ? 0 : 8;
      for (let xx = x + off; xx < x + TS; xx += 16) { ctx.moveTo(xx + 0.5, yy); ctx.lineTo(xx + 0.5, yy + 8); }
    }
    ctx.stroke();
    ctx.fillStyle = hi;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x + 2, y + 2, 5, 2);
    ctx.globalAlpha = 1;
  },

  feature(ctx, room, c, r, t) {
    const g = room.grid;
    const ch = g[r][c];
    const x = c * TS, y = r * TS;
    const cx = x + TS / 2, cy = y + TS / 2;
    switch (ch) {
      case 'T':
        circ(ctx, cx, cy - 1, 15.5, PAL.tree);
        circ(ctx, cx - 5, cy - 6, 6.5, PAL.treeHi, 0);
        break;
      case 'B':
        circ(ctx, cx - 6, cy + 3, 7.5, PAL.bush);
        circ(ctx, cx + 6, cy + 3, 7.5, PAL.bush);
        circ(ctx, cx, cy - 4, 8, PAL.bush);
        circ(ctx, cx - 2, cy - 7, 3, PAL.bushHi, 0);
        break;
      case 'R':
        circ(ctx, cx, cy + 1, 13, PAL.rock);
        circ(ctx, cx - 4, cy - 4, 5, PAL.rockHi, 0);
        break;
      case ',': {
        const cols = ['#fff7f0', '#ffe066', '#ff9ec7'];
        for (let i = 0; i < 3; i++) {
          const fx = x + 6 + hash2(c, r, i + 11) * 20, fy = y + 6 + hash2(c, r, i + 21) * 20;
          circ(ctx, fx, fy, 2.6, cols[(i + c) % 3], 1, '#5d8a3a');
        }
        break;
      }
      case '=':
        ctx.fillStyle = PAL.wood;
        ctx.fillRect(x, y + 4, TS, TS - 8);
        ctx.strokeStyle = PAL.woodDark;
        ctx.lineWidth = 1.5;
        for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 8, y + 4); ctx.lineTo(x + i * 8, y + TS - 4); ctx.stroke(); }
        ctx.fillStyle = PAL.woodDark;
        ctx.fillRect(x, y + 3, TS, 3);
        ctx.fillRect(x, y + TS - 6, TS, 3);
        break;
      case 'C':
        ctx.fillStyle = '#120c0a';
        ctx.beginPath();
        ctx.moveTo(x + 5, y + TS);
        ctx.lineTo(x + 5, y + 16);
        ctx.arc(cx, y + 16, 11, Math.PI, 0);
        ctx.lineTo(x + 27, y + TS);
        ctx.closePath();
        ctx.fill();
        break;
      case 'X':
        ctx.strokeStyle = PAL.mountDark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 2, y + 4); ctx.lineTo(cx + 3, y + 11); ctx.lineTo(cx - 3, y + 17); ctx.lineTo(cx + 2, y + 25);
        ctx.moveTo(cx + 3, y + 11); ctx.lineTo(cx + 10, y + 14);
        ctx.moveTo(cx - 3, y + 17); ctx.lineTo(cx - 10, y + 20);
        ctx.stroke();
        break;
      case 'D':
        if (g[r][c + 1] === 'D') {
          ctx.fillStyle = '#0d0a10';
          ctx.beginPath();
          ctx.moveTo(x + 8, y + TS);
          ctx.lineTo(x + 8, y + 14);
          ctx.arc(x + TS, y + 14, 24, Math.PI, 0);
          ctx.lineTo(x + TS * 2 - 8, y + TS);
          ctx.closePath();
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.stroke();
        }
        break;
      case 'G':
        if (g[r][c + 1] === 'G') {
          const open = Game.gateOpen();
          ctx.fillStyle = open ? '#0d0a10' : '#3b2a2a';
          ctx.beginPath();
          ctx.moveTo(x + 6, y + TS);
          ctx.lineTo(x + 6, y + 12);
          ctx.arc(x + TS, y + 12, 26, Math.PI, 0);
          ctx.lineTo(x + TS * 2 - 6, y + TS);
          ctx.closePath();
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = OUT;
          ctx.stroke();
          if (!open) {
            ctx.strokeStyle = '#1b1414';
            ctx.lineWidth = 3;
            for (let i = 1; i < 5; i++) {
              ctx.beginPath(); ctx.moveTo(x + 6 + i * 10.4, y + 2); ctx.lineTo(x + 6 + i * 10.4, y + TS); ctx.stroke();
            }
            circ(ctx, x + TS, y + 20, 5, '#e6c45a', 1.5);
          }
        }
        break;
      case 's':
        ctx.fillStyle = PAL.woodDark;
        ctx.fillRect(cx - 2, cy, 4, 13);
        rrect(ctx, x + 5, y + 6, 22, 14, 3);
        ctx.fillStyle = PAL.wood;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = OUT;
        ctx.stroke();
        ctx.strokeStyle = PAL.woodDark;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x + 9, y + 11); ctx.lineTo(x + 23, y + 11); ctx.moveTo(x + 9, y + 15); ctx.lineTo(x + 20, y + 15); ctx.stroke();
        break;
      case 'g':
        rrect(ctx, x + 7, y + 5, 18, 23, 8);
        ctx.fillStyle = '#9b98a8';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = OUT;
        ctx.stroke();
        ctx.strokeStyle = '#6e6b7a';
        ctx.beginPath(); ctx.moveTo(cx, y + 10); ctx.lineTo(cx, y + 20); ctx.moveTo(cx - 4, y + 14); ctx.lineTo(cx + 4, y + 14); ctx.stroke();
        break;
      case 'S': this.statue(ctx, cx, cy, Game.areaId === 'ow' && room.key === '1,0' && Game.S && Game.S.orbs >= 2); break;
      default: break;
    }
  },

  statue(ctx, cx, cy, glow) {
    rrect(ctx, cx - 11, cy - 2, 22, 15, 3);
    ctx.fillStyle = '#8f8c99';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    circ(ctx, cx, cy - 6, 8, glow ? '#ffe9a0' : '#b3b0bd');
    if (glow) circ(ctx, cx, cy - 6, 12 + Math.sin(Game.t * 4) * 1.5, 'rgba(255,233,160,0.25)', 0);
  },

  interior(ctx, room) {
    const th = THEMES[room.theme];
    const g = room.grid;
    const t = Game.t;
    // 壁と床
    ctx.fillStyle = th.wall;
    ctx.fillRect(0, 0, RW, RH);
    ctx.strokeStyle = th.wallDark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let yy = 0; yy < RH; yy += 10) {
      ctx.moveTo(0, yy + 0.5); ctx.lineTo(RW, yy + 0.5);
      const off = (yy / 10) % 2 ? 0 : 10;
      for (let xx = off; xx < RW; xx += 20) { ctx.moveTo(xx + 0.5, yy); ctx.lineTo(xx + 0.5, yy + 10); }
    }
    ctx.stroke();
    ctx.fillStyle = th.floor;
    ctx.fillRect(TS, TS, RW - TS * 2, RH - TS * 2);
    ctx.fillStyle = th.floor2;
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if ((r + c) % 2) ctx.fillRect(c * TS + 2, r * TS + 2, TS - 4, TS - 4);
      }
    }
    // 壁の内側の影
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(TS, TS, RW - TS * 2, 6);
    ctx.fillRect(TS, TS, 5, RH - TS * 2);
    ctx.fillStyle = th.wallHi;
    ctx.fillRect(TS - 3, TS - 3, RW - TS * 2 + 6, 3);
    ctx.fillRect(TS - 3, TS - 3, 3, RH - TS * 2 + 6);
    ctx.fillRect(RW - TS, TS - 3, 3, RH - TS * 2 + 6);
    ctx.fillRect(TS - 3, RH - TS, RW - TS * 2 + 6, 3);

    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) this.cell(ctx, room, th, c, r, t);
    for (const side of ['n', 's', 'e', 'w']) {
      const [c, r] = DOOR_CELLS[side][0];
      const ch = g[r][c];
      if ('dLKZxe'.includes(ch)) this.door(ctx, room, th, side, ch);
    }
    if (room.kind === 'cave') this.door(ctx, room, th, 's', 'e');
  },

  cell(ctx, room, th, c, r, t) {
    const g = room.grid;
    const ch = g[r][c];
    const x = c * TS, y = r * TS;
    const cx = x + TS / 2, cy = y + TS / 2;
    const pit = (cc, rr) => g[rr] && (g[rr][cc] === '~' || g[rr][cc] === 'o');
    switch (ch) {
      case '~':
      case 'o': {
        ctx.fillStyle = '#07060b';
        ctx.fillRect(x - 0.4, y - 0.4, TS + 0.8, TS + 0.8);
        if (!pit(c, r - 1)) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x, y, TS, 8);
          ctx.fillStyle = th.wallDark;
          ctx.fillRect(x, y, TS, 4);
        }
        if (ch === 'o') {
          const on = room.evDone || Game.flag(`ev:${room.areaId}:${room.key}`);
          rrect(ctx, x + 3, y + 5, 26, 24, 5);
          ctx.fillStyle = th.block;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = OUT;
          ctx.stroke();
          const col = on ? '#ffa14a' : '#55d8ff';
          const pulse = on ? 0 : Math.sin(t * 4) * 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 11 - pulse); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx, cy + 9); ctx.lineTo(cx - 8, cy);
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillRect(cx - 3, cy - 6, 3, 4);
        }
        break;
      }
      case 'b':
      case 'P':
        this.block(ctx, x, y, th.block, ch === 'P');
        break;
      case 'S':
        this.statue(ctx, cx, cy, false);
        break;
      case 't':
      case 'f': {
        if (ch === 't') {
          rrect(ctx, cx - 9, cy - 2, 18, 13, 3);
          ctx.fillStyle = '#4a4050';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = OUT;
          ctx.stroke();
        } else {
          ctx.strokeStyle = '#5a3a22';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(cx - 9, cy + 9); ctx.lineTo(cx + 9, cy + 4); ctx.moveTo(cx - 9, cy + 4); ctx.lineTo(cx + 9, cy + 9); ctx.stroke();
        }
        const f = Math.sin(t * 12 + c * 3) * 1.5;
        ctx.fillStyle = '#ff7a2a';
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy + 1);
        ctx.quadraticCurveTo(cx - 6, cy - 10, cx + f, cy - 15 - f);
        ctx.quadraticCurveTo(cx + 6, cy - 10, cx + 7, cy + 1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath();
        ctx.moveTo(cx - 3.5, cy + 1);
        ctx.quadraticCurveTo(cx - 3, cy - 5, cx + f * 0.5, cy - 8);
        ctx.quadraticCurveTo(cx + 3, cy - 5, cx + 3.5, cy + 1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,170,80,0.12)';
        ctx.beginPath(); ctx.arc(cx, cy - 4, 26, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'h':
      case 'j':
        this.chest(ctx, x, y, ch === 'j');
        break;
      default: break;
    }
  },

  block(ctx, x, y, col, mark) {
    ctx.fillStyle = col;
    ctx.fillRect(x + 1, y + 1, TS - 2, TS - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 1, y + 1, TS - 2, 4);
    ctx.fillRect(x + 1, y + 1, 4, TS - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 1, y + TS - 5, TS - 2, 4);
    ctx.fillRect(x + TS - 5, y + 1, 4, TS - 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUT;
    ctx.strokeRect(x + 1, y + 1, TS - 2, TS - 2);
    if (mark) {
      ctx.beginPath();
      ctx.arc(x + TS / 2, y + TS / 2, 6.5, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    }
  },

  chest(ctx, x, y, open) {
    const cx = x + TS / 2;
    if (open) {
      rrect(ctx, x + 4, y + 4, 24, 9, 3);
      ctx.fillStyle = '#7a4a22';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = OUT;
      ctx.stroke();
    }
    rrect(ctx, x + 4, y + 11, 24, 17, 3);
    ctx.fillStyle = '#b06a2c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    if (open) {
      ctx.fillStyle = '#2a1608';
      ctx.fillRect(x + 7, y + 12, 18, 5);
    } else {
      rrect(ctx, x + 4, y + 7, 24, 9, 3);
      ctx.fillStyle = '#c47a36';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(cx - 3, y + 12, 6, 7);
      ctx.strokeRect(cx - 3, y + 12, 6, 7);
    }
  },

  door(ctx, room, th, side, ch) {
    const cells = DOOR_CELLS[side];
    const [c0, r0] = cells[0];
    const horiz = side === 'n' || side === 's';
    const x = c0 * TS, y = r0 * TS;
    const w = horiz ? TS * 2 : TS, h = TS;
    ctx.save();
    if (ch === 'x') {
      // ひびの入った壁（爆弾で開く）
      ctx.strokeStyle = th.wallDark;
      ctx.lineWidth = 2.5;
      const mx = x + w / 2, my = y + h / 2;
      ctx.beginPath();
      ctx.moveTo(mx - 9, my - 11); ctx.lineTo(mx - 2, my - 3); ctx.lineTo(mx - 7, my + 4); ctx.lineTo(mx + 1, my + 12);
      ctx.moveTo(mx - 2, my - 3); ctx.lineTo(mx + 8, my - 7);
      ctx.moveTo(mx - 7, my + 4); ctx.lineTo(mx + 7, my + 6);
      ctx.stroke();
      ctx.restore();
      return;
    }
    // 通路（外へ向かって暗くなる）
    let grad;
    if (side === 'n') grad = ctx.createLinearGradient(0, y + h, 0, y);
    else if (side === 's') grad = ctx.createLinearGradient(0, y, 0, y + h);
    else if (side === 'w') grad = ctx.createLinearGradient(x + w, 0, x, 0);
    else grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, th.floor);
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    if (horiz) ctx.fillRect(x + 6, y, w - 12, h);
    else ctx.fillRect(x, y + 4, w, h - 8);
    // 柱
    ctx.fillStyle = th.wallHi;
    if (horiz) { ctx.fillRect(x, y, 6, h); ctx.fillRect(x + w - 6, y, 6, h); }
    else { ctx.fillRect(x, y, w, 4); ctx.fillRect(x, y + h - 4, w, 4); }

    const inner = horiz ? { x: x + 6, y, w: w - 12, h } : { x, y: y + 4, w, h: h - 8 };
    if (ch === 'L' || ch === 'K') {
      ctx.fillStyle = ch === 'K' ? '#5a1f3a' : '#7a4a22';
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.strokeRect(inner.x + 1, inner.y + 1, inner.w - 2, inner.h - 2);
      const mx = inner.x + inner.w / 2, my = inner.y + inner.h / 2;
      if (ch === 'K') {
        circ(ctx, mx, my, 9, '#ffcf4a');
        circ(ctx, mx, my, 3.5, '#c0392b', 1.5);
      } else {
        circ(ctx, mx, my - 3, 4, '#1a1010', 0);
        ctx.fillStyle = '#1a1010';
        ctx.beginPath(); ctx.moveTo(mx - 3, my + 7); ctx.lineTo(mx + 3, my + 7); ctx.lineTo(mx, my - 2); ctx.closePath(); ctx.fill();
      }
    } else if (ch === 'Z') {
      ctx.fillStyle = '#5c5a66';
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      ctx.strokeStyle = '#2a2933';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (horiz) for (let i = 1; i < 6; i++) { const xx = inner.x + (inner.w * i) / 6; ctx.moveTo(xx, inner.y); ctx.lineTo(xx, inner.y + inner.h); }
      else for (let i = 1; i < 4; i++) { const yy = inner.y + (inner.h * i) / 4; ctx.moveTo(inner.x, yy); ctx.lineTo(inner.x + inner.w, yy); }
      ctx.stroke();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.strokeRect(inner.x + 1, inner.y + 1, inner.w - 2, inner.h - 2);
    }
    ctx.restore();
  },

  /* ===================== 動く物 ===================== */
  entities(ctx) {
    const G = Game;
    const p = G.player;
    // 床に落ちている物
    for (const pk of G.pickups) if (!pk.carried) this.pickup(ctx, pk);
    for (const s of G.shop) this.shopItem(ctx, s);
    // ボスの着地予告
    for (const e of G.enemies) {
      if (e.type === 'kingslime' && e.state === 'jump') {
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -G.t * 30;
        ctx.strokeStyle = 'rgba(255,80,80,0.75)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(e.jx1, e.jy1 + 6, e.r + 4, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
    for (const q of G.projs) if (q.t === 'bomb') this.proj(ctx, q);
    for (const f of G.fx) if (f.t === 'block') this.block(ctx, f.x - TS / 2, f.y - TS / 2, THEMES[G.room.theme].block, true);
    for (const f of G.fx) if (f.t === 'ring') this.fx(ctx, f);

    // 人・敵・勇者を奥から順に
    const list = [];
    G.npcs.forEach((n) => list.push({ y: n.y, draw: () => this.npc(ctx, n) }));
    G.enemies.forEach((e) => list.push({ y: e.y + (e.boss ? 20 : 0), draw: () => this.enemy(ctx, e) }));
    list.push({ y: p.y, draw: () => this.hero(ctx, p, p.x, p.y) });
    list.sort((a, b) => a.y - b.y).forEach((o) => o.draw());

    for (const q of G.projs) if (q.t !== 'bomb') this.proj(ctx, q);
    for (const pk of G.pickups) if (pk.carried) this.pickup(ctx, pk);
    for (const f of G.fx) if (f.t !== 'block' && f.t !== 'ring') this.fx(ctx, f);
  },

  /* 勇者マル: 緑の体・はだ色の頭・帽子の先 の丸3つ */
  hero(ctx, p, x, y) {
    const G = Game;
    let dir = p.dir;
    let alpha = 1;
    if (G.mode === 'dead') {
      const k = p.deadT;
      if (k < 1.0) dir = DIR_NAMES[[1, 3, 0, 2][Math.floor(k * 12) % 4]];
      else dir = 'down';
      alpha = k < 1.2 ? 1 : Math.max(0.35, 1 - (k - 1.2));
    } else if (p.inv > 0 && Math.floor(p.inv * 18) % 2 === 0) alpha = 0.35;
    const hold = G.itemget && (G.mode === 'itemget' || G.mode === 'dialog');
    if (hold) dir = 'down';

    const d = DIRS[dir];
    const moving = p.moving && (G.mode === 'play' || G.mode === 'scroll') && p.state === 'walk';
    const bob = moving ? Math.abs(Math.sin(p.walk)) * 1.8 : 0;
    const sway = moving ? Math.sin(p.walk) * 1.6 : 0;
    const lean = p.state === 'swing' || p.state === 'spin' ? 2 : 0;
    const bx = x + d.x * lean, by = y + 3 + d.y * lean;
    const hx = x + d.x * 3 + d.x * lean, hy = y - 9 - bob + d.y * lean + (dir === 'down' ? 1 : 0);
    // 帽子の先: 前を向けば頭の後ろに、後ろを向けば頭のてっぺんにかぶさって見える
    let tx, ty;
    if (dir === 'down') { tx = hx + sway; ty = hy - 10; }
    else if (dir === 'up') { tx = hx + sway * 0.6; ty = hy - 6; }
    else { tx = hx - d.x * 10; ty = hy - 3 + sway * 0.6; }

    ctx.save();
    ctx.globalAlpha = alpha;
    const swordBehind = dir === 'up';
    if (swordBehind) this.heroSword(ctx, p, x, y);
    const body = () => circ(ctx, bx, by, 11, '#3cb44b');
    const head = () => circ(ctx, hx, hy, 8.5, dir === 'up' ? '#f2bf52' : '#ffd2a6');   // 後ろ向きは金髪の後ろ頭
    const tip = () => circ(ctx, tx, ty, 5, '#24823a');
    if (dir === 'up') { body(); head(); tip(); }
    else { tip(); body(); head(); }
    if (!swordBehind) this.heroSword(ctx, p, x, y);
    if (hold) this.itemIcon(ctx, G.itemget.item, x, y - 34, 1.15);
    ctx.restore();
  },

  heroSword(ctx, p, x, y) {
    const G = Game;
    if (G.mode !== 'play' && G.mode !== 'dialog') return;
    const ox = x, oy = y - 2;
    if (p.state === 'swing' || p.state === 'spin') {
      const len = p.state === 'spin' ? 36 : 30;
      const a1 = p.angle;
      const a0 = p.state === 'spin' ? a1 - Math.min(Math.PI * 1.6, p.swingT / SPIN_DUR * Math.PI * 2) : DIR_ANGLE[p.dir] - 1.6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ox, oy, len, a0, a1);
      ctx.arc(ox, oy, 12, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = p.state === 'spin' ? 'rgba(160,230,255,0.45)' : 'rgba(255,255,255,0.4)';
      ctx.fill();
      ctx.restore();
      this.sword(ctx, ox, oy, a1, len);
    } else if (p.state === 'charge') {
      const full = p.charge >= CHARGE_FULL;
      const a = DIR_ANGLE[p.dir];
      this.sword(ctx, ox, oy, a, 26, full && Math.floor(G.t * 16) % 2 === 0);
      if (full) {
        const tx = ox + Math.cos(a) * 26, ty = oy + Math.sin(a) * 26;
        ctx.fillStyle = 'rgba(255,255,200,0.9)';
        ctx.beginPath(); ctx.arc(tx, ty, 3 + Math.sin(G.t * 20) * 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  },

  sword(ctx, ox, oy, a, len, glow) {
    const cx = Math.cos(a), cy = Math.sin(a);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 6.5;
    ctx.beginPath(); ctx.moveTo(ox + cx * 9, oy + cy * 9); ctx.lineTo(ox + cx * len, oy + cy * len); ctx.stroke();
    ctx.strokeStyle = glow ? '#fffbd0' : '#e4f1ff';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = '#e0a93a';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(ox + cx * 10 - cy * 5, oy + cy * 10 + cx * 5);
    ctx.lineTo(ox + cx * 10 + cy * 5, oy + cy * 10 - cx * 5);
    ctx.stroke();
    ctx.restore();
  },

  enemy(ctx, e) {
    const G = Game;
    if (e.spawnT > 0) {
      const k = 1 - e.spawnT / 0.7;
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = G.t * 6 + (i * Math.PI) / 2;
        const rr = 14 * (1 - k * 0.6);
        ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, 2.5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const white = e.flash > 0 && Math.floor(e.flash * 30) % 2 === 0;
    const stunned = e.stun > 0;
    const col = (c) => (white ? '#ffffff' : stunned && Math.floor(G.t * 8) % 2 ? '#bfe8ff' : c);
    const d = DIRS[e.dir];
    ctx.save();
    ctx.globalAlpha = e.alpha == null ? 1 : e.alpha;
    if (e.dying != null && Math.floor(e.dying * 20) % 2 === 0) ctx.globalAlpha *= 0.5;
    switch (e.type) {
      case 'slime': case 'slime_b': case 'slime_r': case 'mini': {
        const tint = { green: '#6fd65a', blue: '#5aa8f0', red: '#f0645a' }[e.tint];
        const r = e.r;
        const y = e.y - e.hop;
        circ(ctx, e.x, y, r, col(tint));
        const er = e.small ? 1.9 : 2.4;
        circ(ctx, e.x - r * 0.38 + d.x * 2.5, y - 1 + d.y * 2, er, OUT, 0);
        circ(ctx, e.x + r * 0.38 + d.x * 2.5, y - 1 + d.y * 2, er, OUT, 0);
        break;
      }
      case 'kingslime': {
        const y = e.y - e.z;
        const squash = e.state === 'idle' ? Math.sin(G.t * 6) * 1.2 : 0;
        circ(ctx, e.x, y, e.r + squash, col('#5ccf4a'), 3);
        circ(ctx, e.x - 12 + d.x * 4, y - 6 + d.y * 3, 6, OUT, 0);
        circ(ctx, e.x + 12 + d.x * 4, y - 6 + d.y * 3, 6, OUT, 0);
        break;
      }
      case 'octo': case 'octo_b': {
        const tint = e.tint === 'blue' ? '#4f7fe6' : '#e85a4c';
        const dark = e.tint === 'blue' ? '#3a5fb0' : '#b8402f';
        const aiming = e.state === 'aim';
        const sx = e.x + d.x * (aiming ? 12 : 10), sy = e.y + d.y * (aiming ? 12 : 10) - 1;
        const snout = () => circ(ctx, sx, sy, aiming ? 5.2 : 4.5, col(dark));
        if (e.dir === 'up') snout();
        circ(ctx, e.x, e.y, e.r, col(tint));
        if (e.dir !== 'up') snout();
        circ(ctx, e.x + d.x * 3, e.y - 4 + d.y * 2, 3.6, '#ffffff', 1.8);
        break;
      }
      case 'bat': {
        const resting = e.state === 'rest';
        const flap = resting ? 0 : Math.sin(e.anim * 26);
        const wx = resting ? 6 : 8 + flap * 2, wy = resting ? 1 : -2 - flap * 3;
        circ(ctx, e.x - wx, e.y + wy, resting ? 5 : 6.5, col('#8a68b8'));
        circ(ctx, e.x + wx, e.y + wy, resting ? 5 : 6.5, col('#8a68b8'));
        circ(ctx, e.x, e.y, 5.5, col('#3c2a52'));
        break;
      }
      case 'knight': case 'knight_r': {
        const red = e.tint === 'red';
        const bodyC = red ? '#c25248' : '#5f80bd', headC = red ? '#8a3333' : '#3e5a8c';
        const shield = () => circ(ctx, e.x + d.x * 11, e.y + d.y * 8 - 1, 7, col('#f0c95a'), 2.2);
        if (e.dir === 'up') shield();
        circ(ctx, e.x, e.y + 2, e.r, col(bodyC));
        circ(ctx, e.x + d.x * 2, e.y - 9 + d.y * 1, 7.5, col(headC));
        if (e.dir !== 'up') shield();
        break;
      }
      case 'dodongo': {
        const gulp = e.state === 'gulp';
        const parts = [
          { x: e.x - d.x * 22, y: e.y - d.y * 22, r: 10, c: '#8f6b3c' },
          { x: e.x, y: e.y, r: 20, c: '#b08850' },
          { x: e.x + d.x * 22, y: e.y + d.y * 22, r: gulp ? 16 + Math.sin(G.t * 30) * 1.5 : 14, c: '#cf9f62' },
        ];
        parts.sort((a, b) => a.y - b.y).forEach((pt) => circ(ctx, pt.x, pt.y, pt.r, col(pt.c), 2.5));
        break;
      }
      case 'mao': {
        const bob = Math.sin((e.bob || 0) * 2.4) * 2.5;
        const down = e.stun > 0 ? 6 : 0;
        circ(ctx, e.x, e.y + 4 + bob + down, 20, col('#6a1f3a'), 2.5);
        circ(ctx, e.x, e.y - 3 + bob + down, 14, col('#4b2a7b'), 2.5);
        circ(ctx, e.x, e.y - 18 + bob + down * 1.5, 10, col('#e3dcf0'), 2.5);
        if (e.state === 'cast') {
          const k = 1 - Math.max(0, e.t) / 0.85;
          ctx.globalAlpha *= 0.85;
          circ(ctx, e.x, e.y - 34, 3 + k * 7, '#c9a8ff', 0);
        }
        break;
      }
      default: break;
    }
    ctx.restore();
    if (stunned && e.dying == null) {
      const top = e.type === 'mao' ? e.y - 34 : e.type === 'dodongo' ? e.y - 26 : e.y - e.r - 8;
      ctx.fillStyle = '#ffe14a';
      for (let i = 0; i < 3; i++) {
        const a = G.t * 5 + (i * Math.PI * 2) / 3;
        ctx.fillRect(e.x + Math.cos(a) * 10 - 1.5, top + Math.sin(a) * 3 - 1.5, 3, 3);
      }
    }
  },

  npc(ctx, n) {
    const t = n.anim;
    switch (n.t) {
      case 'oldman':
        circ(ctx, n.x, n.y + 3, 11, '#c0392b');
        circ(ctx, n.x, n.y - 9, 8, '#ffd2a6');
        circ(ctx, n.x, n.y - 3, 6, '#f4f4f4');
        break;
      case 'merchant':
        circ(ctx, n.x, n.y + 3, 11, '#2f6db5');
        circ(ctx, n.x, n.y - 9, 8, '#ffd2a6');
        circ(ctx, n.x, n.y - 17, 7, '#8a5a2b');
        break;
      case 'fairy': {
        const bob = Math.sin(t * 2.5) * 4;
        const flap = Math.sin(t * 22) * 1.5;
        ctx.save();
        ctx.globalAlpha = 0.85;
        circ(ctx, n.x - 7 - flap, n.y - 13 + bob, 6.5, '#c8f0ff', 1.5);
        circ(ctx, n.x + 7 + flap, n.y - 13 + bob, 6.5, '#c8f0ff', 1.5);
        ctx.restore();
        circ(ctx, n.x, n.y - 9 + bob, 5.5, '#ff8fc8', 1.8);
        ctx.fillStyle = 'rgba(255,190,230,0.18)';
        ctx.beginPath(); ctx.arc(n.x, n.y - 9 + bob, 22, 0, Math.PI * 2); ctx.fill();
        break;
      }
      default: break;
    }
  },

  /* ===================== 飛び道具・落とし物・演出 ===================== */
  proj(ctx, q) {
    const G = Game;
    switch (q.t) {
      case 'rock':
        circ(ctx, q.x, q.y, q.r, '#b9b4c2');
        break;
      case 'fire':
        circ(ctx, q.x, q.y, q.r + 1, '#ff6a2a', 0);
        circ(ctx, q.x, q.y, q.r * 0.5, '#ffe27a', 0);
        break;
      case 'beam': {
        const a = DIR_ANGLE[q.dir];
        ctx.save();
        ctx.globalAlpha = 0.9;
        this.sword(ctx, q.x - Math.cos(a) * 18, q.y - Math.sin(a) * 18, a, 30, Math.floor(G.t * 20) % 2 === 0);
        ctx.restore();
        break;
      }
      case 'boomer': {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.spin);
        ctx.lineCap = 'round';
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(0, 2); ctx.lineTo(8, -6); ctx.stroke();
        ctx.strokeStyle = '#d9913d';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'bomb': {
        const blink = q.fuse < 0.6 && Math.floor(q.fuse * 16) % 2 === 0;
        const s = 1 + (q.fuse < 0.6 ? (0.6 - q.fuse) * 0.3 : 0);
        circ(ctx, q.x, q.y, 9 * s, blink ? '#e8423a' : '#2b3550');
        circ(ctx, q.x - 3, q.y - 3, 2.5, 'rgba(255,255,255,0.6)', 0);
        ctx.strokeStyle = '#c8a46a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q.x + 4, q.y - 8); ctx.quadraticCurveTo(q.x + 8, q.y - 14, q.x + 12, q.y - 12); ctx.stroke();
        circ(ctx, q.x + 12, q.y - 12, 2 + Math.random() * 1.5, '#ffd24a', 0);
        break;
      }
      case 'morb': {
        const mine = q.owner === 'player';
        const glow = ctx.createRadialGradient(q.x, q.y, 1, q.x, q.y, q.r + 7);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(0.4, mine ? '#9ff0ff' : '#c49bff');
        glow.addColorStop(1, 'rgba(120,60,200,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 7, 0, Math.PI * 2); ctx.fill();
        break;
      }
      default: break;
    }
  },

  pickup(ctx, pk) {
    if (pk.life < 2.5 && Math.floor(pk.life * 10) % 2 === 0) return;
    const bob = pk.flag ? Math.sin(pk.anim * 3) * 2 : 0;
    this.itemIcon(ctx, pk.t, pk.x, pk.y - pk.z + bob, 1);
  },

  shopItem(ctx, s) {
    if (s.sold) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `bold 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('売り切れ', s.x, s.y + 4);
      return;
    }
    this.itemIcon(ctx, s.item === 'potion' ? 'heart' : s.item, s.x, s.y - 4, 1.1);
    ctx.font = `bold 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(`${s.price}`, s.x + 5, s.y + 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${s.price}`, s.x + 5, s.y + 24);
    this.itemIcon(ctx, 'gem', s.x - 12, s.y + 20, 0.6);
  },

  /** 品物のアイコン。HUD・落とし物・入手演出で共通に使う。 */
  itemIcon(ctx, t, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUT;
    switch (t) {
      case 'gem': case 'gem5': {
        ctx.beginPath();
        ctx.moveTo(0, -9); ctx.lineTo(6, -2); ctx.lineTo(0, 9); ctx.lineTo(-6, -2);
        ctx.closePath();
        ctx.fillStyle = t === 'gem5' ? '#4fa8ff' : '#42d67a';
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.moveTo(-1, -6); ctx.lineTo(2, -2); ctx.lineTo(-1, 1); ctx.closePath(); ctx.fill();
        break;
      }
      case 'heart': case 'potion':
        heartPath(ctx, 0, -7, 15);
        ctx.fillStyle = '#ff4a5e';
        ctx.fill();
        ctx.stroke();
        break;
      case 'heartc':
        heartPath(ctx, 0, -10, 21);
        ctx.fillStyle = '#ff4a5e';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffd24a';
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = OUT;
        ctx.stroke();
        break;
      case 'bombs': case 'bombbag':
        circ(ctx, 0, 1, 8, '#2b3550');
        circ(ctx, -3, -2, 2.2, 'rgba(255,255,255,0.6)', 0);
        ctx.strokeStyle = '#c8a46a';
        ctx.beginPath(); ctx.moveTo(4, -6); ctx.quadraticCurveTo(7, -11, 10, -9); ctx.stroke();
        if (t === 'bombbag') { ctx.fillStyle = '#ffd24a'; ctx.font = `bold 9px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('×8', 8, 12); }
        break;
      case 'key': case 'bigkey': {
        const big = t === 'bigkey';
        const k = big ? 1.3 : 1;
        ctx.scale(k, k);
        ctx.fillStyle = '#ffcf3a';
        ctx.fillRect(-1.5, -2, 3, 11);
        ctx.strokeRect(-1.5, -2, 3, 11);
        ctx.fillRect(1.5, 4, 3, 2.5);
        ctx.fillRect(1.5, 7, 4, 2);
        circ(ctx, 0, -5.5, 4.5, '#ffcf3a');
        circ(ctx, 0, -5.5, 1.6, big ? '#e8423a' : OUT, 0);
        break;
      }
      case 'boomerang':
        ctx.lineCap = 'round';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(0, 4); ctx.lineTo(8, -4); ctx.stroke();
        ctx.strokeStyle = '#d9913d';
        ctx.lineWidth = 4;
        ctx.stroke();
        break;
      case 'sword':
        ctx.restore();
        ctx.save();
        this.sword(ctx, x - 1, y + 12 * s, -Math.PI / 2, 26 * s);
        break;
      case 'orb': {
        const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 16);
        glow.addColorStop(0, 'rgba(255,255,230,0.9)');
        glow.addColorStop(1, 'rgba(255,230,140,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
        circ(ctx, 0, 0, 8, '#fff2b0');
        circ(ctx, -2.5, -2.5, 2.5, '#ffffff', 0);
        break;
      }
      case 'gems100':
        this.itemIcon(ctx, 'gem5', -5, 0, 1);
        this.itemIcon(ctx, 'gem5', 5, 0, 1);
        break;
      default: break;
    }
    ctx.restore();
  },

  fx(ctx, f) {
    const k = 1 - Math.max(0, f.life) / f.max;
    switch (f.t) {
      case 'p':
        ctx.globalAlpha = Math.min(1, (f.life / f.max) * 1.5);
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case 'poof':
        ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const rr = 6 + k * 14;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, 5 * (1 - k) + 1, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      case 'boom': {
        const R = (f.small ? 18 : 40) * (0.4 + k * 0.8);
        ctx.globalAlpha = 1 - k * 0.8;
        ctx.fillStyle = '#ff8a3c';
        ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath(); ctx.arc(f.x, f.y, R * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(f.x, f.y, R * 0.25 * (1 - k), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'ring':
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#e8f7d0';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(f.x, f.y, lerp(f.r0, f.r1, k), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      default: break;
    }
  },

  /* ===================== HUD ===================== */
  hud(ctx) {
    const G = Game, S = G.S;
    ctx.fillStyle = '#12121a';
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.fillStyle = '#2a2a3a';
    ctx.fillRect(0, HUD_H - 2, VIEW_W, 2);

    this.minimap(ctx, 10, 10, 100, 44);

    // ジェム・鍵・爆弾
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const row = (iy, icon, text, on = true) => {
      ctx.globalAlpha = on ? 1 : 0.25;
      this.itemIcon(ctx, icon, 128, iy, 0.75);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, 140, iy + 1);
      ctx.globalAlpha = 1;
    };
    row(17, 'gem', `×${String(S.gems).padStart(3, '0')}`);
    const inDungeon = G.room && G.room.kind === 'dungeon';
    row(33, 'key', `×${inDungeon ? S.keys[G.areaId] || 0 : 0}`, inDungeon);
    if (inDungeon && S.bigkey[G.areaId]) this.itemIcon(ctx, 'bigkey', 178, 33, 0.6);
    row(49, 'bombs', `×${String(S.bombs).padStart(2, '0')}`, S.items.bombbag);

    // B と A の枠
    const t = Input.isTouch;
    this.slot(ctx, 204, 8, t ? 'B' : 'X', S.bItem);
    this.slot(ctx, 252, 8, t ? 'A' : 'Z', S.items.sword ? 'sword' : null);

    // ライフ
    ctx.fillStyle = '#ff5a6e';
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('ー ライフ ー', 308, 14);
    for (let i = 0; i < S.maxHp / 2; i++) {
      const hx = 316 + (i % 8) * 17, hy = 24 + Math.floor(i / 8) * 17;
      const fill = clamp(S.hp - i * 2, 0, 2);
      heartPath(ctx, hx, hy, 14);
      ctx.fillStyle = '#3a2a33';
      ctx.fill();
      if (fill > 0) {
        ctx.save();
        heartPath(ctx, hx, hy, 14);
        ctx.clip();
        ctx.fillStyle = '#ff4a5e';
        ctx.fillRect(hx - 8, hy - 2, fill === 2 ? 16 : 8, 18);
        ctx.restore();
      }
      heartPath(ctx, hx, hy, 14);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
    // 宝珠（三つの丸）
    for (let i = 0; i < 3; i++) {
      const ox = 466 + i * 14, oy = 14;
      if (i < S.orbs) {
        circ(ctx, ox, oy, 5, '#fff2b0', 1.5, '#000');
      } else {
        ctx.beginPath(); ctx.arc(ox, oy, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#555570'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    ctx.textBaseline = 'alphabetic';
  },

  slot(ctx, x, y, label, item) {
    rrect(ctx, x, y, 40, 48, 6);
    ctx.fillStyle = '#1d1d2a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4a4a66';
    ctx.stroke();
    ctx.fillStyle = '#9da0c0';
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + 20, y + 9);
    if (item) this.itemIcon(ctx, item, x + 20, y + 28, 1);
  },

  minimap(ctx, x, y, w, h) {
    const G = Game, S = G.S;
    ctx.fillStyle = '#1d1d2a';
    ctx.fillRect(x, y, w, h);
    let areaId = G.areaId;
    let cur = G.roomKey;
    if (G.room.kind === 'cave') { areaId = 'ow'; cur = S.ret ? S.ret.room : '1,2'; }
    const A = AREAS[areaId];
    const cw = Math.min(w / A.w, h / A.h);
    const ox = x + (w - cw * A.w) / 2, oy = y + (h - cw * A.h) / 2;
    const ch = A.kind === 'field' ? h / A.h : cw;
    const cww = A.kind === 'field' ? w / A.w : cw;
    const oxx = A.kind === 'field' ? x : ox, oyy = A.kind === 'field' ? y : oy;
    for (const key of Object.keys(A.rooms)) {
      const [cx, cy] = key.split(',').map(Number);
      const seen = S.flags[`v:${areaId}:${key}`];
      ctx.fillStyle = seen ? (A.kind === 'field' ? '#3f7a3a' : '#5a5a86') : '#2a2a3a';
      ctx.fillRect(oxx + cx * cww + 1, oyy + cy * ch + 1, cww - 2, ch - 2);
      if (key === cur && Math.floor(G.t * 3) % 2 === 0) {
        ctx.fillStyle = '#7dff8a';
        ctx.fillRect(oxx + cx * cww + cww / 2 - 3, oyy + cy * ch + ch / 2 - 3, 6, 6);
      }
    }
  },

  bossBar(ctx) {
    const b = Game.enemies.find((e) => e.boss && e.dying == null);
    if (!b || Game.mode === 'scroll') return;
    const w = 220, x = (RW - w) / 2, y = RH - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    rrect(ctx, x - 6, y - 16, w + 12, 30, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(b.name, RW / 2, y - 4);
    ctx.fillStyle = '#3a1a22';
    ctx.fillRect(x, y + 1, w, 7);
    ctx.fillStyle = '#ff4a5e';
    ctx.fillRect(x, y + 1, (w * Math.max(0, b.hp)) / b.maxHp, 7);
  },

  toast(ctx) {
    const m = Game.toastMsg;
    ctx.save();
    ctx.globalAlpha = Math.min(1, m.t * 3);
    ctx.font = `bold 14px ${FONT}`;
    ctx.textAlign = 'center';
    const w = ctx.measureText(m.text).width + 28;
    rrect(ctx, (RW - w) / 2, HUD_H + 10, w, 28, 14);
    ctx.fillStyle = 'rgba(10,10,20,0.85)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(m.text, RW / 2, HUD_H + 29);
    ctx.restore();
  },

  /** 幅に収まるよう折り返す。nl は元の文に改行があった行（1文字ぶん数える）。 */
  wrap(ctx, text, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push({ s: line, nl: false }); line = ''; }
        line += ch;
      }
      out.push({ s: line, nl: true });
    }
    return out;
  },

  dialog(ctx) {
    const d = Game.dialog;
    const p = Game.player;
    const h = 96;
    const top = p.y > RH * 0.55;
    const x = 16, y = top ? HUD_H + 12 : VIEW_H - h - 12, w = VIEW_W - 32;
    rrect(ctx, x, y, w, h, 10);
    ctx.fillStyle = 'rgba(8,8,16,0.94)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f2f2ff';
    ctx.stroke();
    ctx.font = `bold 17px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    const lines = this.wrap(ctx, d.pages[d.i], w - 40);
    let left = Math.floor(d.shown);
    lines.forEach((ln, i) => {
      if (left <= 0) return;
      ctx.fillText(ln.s.slice(0, left), x + 20, y + 32 + i * 26);
      left -= ln.s.length + (ln.nl ? 1 : 0);
    });
    if (d.shown >= d.pages[d.i].length && Math.floor(Game.t * 3) % 2 === 0) {
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.moveTo(x + w - 26, y + h - 20); ctx.lineTo(x + w - 16, y + h - 20); ctx.lineTo(x + w - 21, y + h - 13);
      ctx.closePath();
      ctx.fill();
    }
  },
};
