/* =========================================================================
   MECH RAIDERS ― 格納庫（編成 / 改造 / ガチャ / 図鑑）
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData, R = window.MRRender;
const { clamp, el, TAU } = C;

/* ---------------- 所持データの操作 ---------------- */
const BUCKET = { frame: 'frames', weapon: 'weapons', core: 'cores' };

function kindOf(id) {
  if (D.getFrame(id)) return 'frame';
  if (D.getWeapon(id)) return 'weapon';
  if (D.getCore(id)) return 'core';
  return null;
}
function defOf(id) {
  return D.getFrame(id) || D.getWeapon(id) || D.getCore(id) || null;
}
function rec(save, id) {
  const k = kindOf(id); if (!k) return null;
  return save[BUCKET[k]][id] || null;
}
function owned(save, id) { return !!rec(save, id); }
function maxLv(r) { return 10 + (r ? r.lb : 0) * 2; }
function upCost(def, lv) {
  const base = { N: 40, R: 70, SR: 130, SSR: 240 }[def.rarity] || 60;
  return Math.round(base * (1 + (lv - 1) * 0.55));
}
function grant(save, id) {
  const k = kindOf(id); if (!k) return { dup: false };
  const b = save[BUCKET[k]];
  if (b[id]) {
    b[id].n = (b[id].n || 1) + 1;
    const before = b[id].lb || 0;
    b[id].lb = Math.min(4, before + 1);
    const capped = b[id].lb === before;
    if (capped) save.scrap += (D.RARITY[defOf(id).rarity] || D.RARITY.N).scrap;
    return { dup: true, lb: b[id].lb, capped };
  }
  b[id] = { lv: 1, lb: 0, n: 1 };
  return { dup: false };
}

/* ---------------- ガチャ ---------------- */
const GACHA_POOL = () => {
  const out = { N: [], R: [], SR: [], SSR: [] };
  for (const w of D.WEAPONS) out[w.rarity].push(w.id);
  for (const f of D.FRAMES) out[f.rarity].push(f.id);
  for (const c of D.CORES) out[c.rarity].push(c.id);
  return out;
};
const POOL = GACHA_POOL();

function rollRarity(save) {
  if (save.pity >= 29) { save.pity = 0; return 'SSR'; }
  const r = Math.random() * 100;
  let rar;
  if (r < 3) rar = 'SSR';
  else if (r < 15) rar = 'SR';
  else if (r < 45) rar = 'R';
  else rar = 'N';
  if (rar === 'SSR') save.pity = 0; else save.pity++;
  return rar;
}
function pullOne(save, minRarity) {
  let rar = rollRarity(save);
  if (minRarity === 'SR' && (rar === 'N' || rar === 'R')) rar = 'SR';
  const list = POOL[rar];
  const id = list[Math.floor(Math.random() * list.length)];
  const res = grant(save, id);
  save.seen[id] = true;
  return { id, rarity: rar, def: defOf(id), kind: kindOf(id), dup: res.dup, lb: res.lb, capped: res.capped };
}

/* =========================================================================
   Hangar UI
   ========================================================================= */
class Hangar {
  constructor(app) {
    this.app = app;                 // main.js の Game
    this.save = app.save;
    this.pid = 1;
    this.tab = 'loadout';
    this.previewT = 0;
    this.bind();
  }

  bind() {
    el('hg-pselect').addEventListener('click', (e) => {
      const b = e.target.closest('.pbtn'); if (!b) return;
      this.pid = Number(b.dataset.p);
      for (const x of el('hg-pselect').querySelectorAll('.pbtn')) x.classList.toggle('on', x === b);
      this.app.audio.sfx('ui');
      this.render();
    });
    for (const t of document.querySelectorAll('.hg-tabs .tab')) {
      t.addEventListener('click', () => {
        this.tab = t.dataset.tab;
        for (const x of document.querySelectorAll('.hg-tabs .tab')) x.classList.toggle('on', x === t);
        for (const p of document.querySelectorAll('.hg-pane')) p.classList.add('hidden');
        el('pane-' + this.tab).classList.remove('hidden');
        this.app.audio.sfx('ui');
        this.render();
      });
    }
    el('btn-pull1').addEventListener('click', () => this.pull(1));
    el('btn-pull10').addEventListener('click', () => this.pull(10));
    el('btn-buyticket').addEventListener('click', () => {
      if (this.save.scrap < 300) return;
      this.save.scrap -= 300; this.save.tickets += 1;
      C.Save.save(); this.app.audio.sfx('uiBig'); this.render();
    });
    el('btn-gacha-close').addEventListener('click', () => {
      el('gacha-overlay').classList.add('hidden');
      this.app.audio.sfx('ui');
      this.render();
    });
  }

  show() {
    el('hg-pselect').classList.toggle('hidden', this.app.numPlayers < 2);
    if (this.app.numPlayers < 2) this.pid = 1;
    this.render();
    this.startPreview();
  }
  hide() { this.stopPreview(); }

  /* ---------------- 全体描画 ---------------- */
  render() {
    const s = this.save;
    el('w-scrap').textContent = s.scrap.toLocaleString();
    el('w-ticket').textContent = s.tickets;
    el('pity-count').textContent = s.pity;
    el('btn-pull1').disabled = s.tickets < 1;
    el('btn-pull10').disabled = s.tickets < 10;
    el('btn-buyticket').disabled = s.scrap < 300;
    if (this.tab === 'loadout') this.renderLoadout();
    else if (this.tab === 'upgrade') this.renderUpgrade();
    else if (this.tab === 'codex') this.renderCodex();
  }

  lo() { return this.save.loadout[this.pid]; }

  renderLoadout() {
    const lo = this.lo();
    const frame = D.getFrame(lo.frame) || D.FRAMES[0];
    const fRec = rec(this.save, frame.id) || { lv: 1, lb: 0 };

    el('lo-frame-name').textContent = frame.name;
    el('lo-frame-cls').textContent = `${frame.cls} ／ Lv.${fRec.lv}`;

    /* 実効値 */
    const built = window.MRField.buildLoadout(this.pid, this.save);
    const bars = [
      ['耐久', built.maxHp, 400, String(Math.round(built.maxHp))],
      ['機動', built.speed, 240, String(Math.round(built.speed))],
      ['装甲', built.dr * 100, 45, `${Math.round(built.dr * 100)}%`],
      ['回避', (1.4 - built.rollCd) / 1.0 * 100, 100, `${built.rollCd.toFixed(2)}秒`],
    ];
    el('lo-stats').innerHTML = bars.map(([n, v, mx, txt]) =>
      `<div class="strow"><span>${n}</span><div class="sttrack"><div class="stfill" style="width:${clamp(v / mx * 100, 4, 100)}%"></div></div><b>${txt}</b></div>`
    ).join('');

    const sp = D.SPECIALS[frame.special];
    el('lo-special-name').textContent = sp.name;
    el('lo-special-line').textContent = sp.line;

    const traits = [...built.traits];
    el('lo-traits').innerHTML = traits.map((t) => {
      const T = D.TRAITS[t]; if (!T) return '';
      return `<div class="trait"><b>${T.name}</b><span>${T.line}</span></div>`;
    }).join('');

    /* 一覧 */
    el('list-frames').innerHTML = D.FRAMES.map((f) => this.cardFrame(f, lo.frame === f.id)).join('');
    const weps = D.WEAPONS.filter((w) => owned(this.save, w.id));
    el('list-main').innerHTML = weps.map((w) => this.cardWeapon(w, lo.main === w.id)).join('') || this.emptyNote();
    el('list-sub').innerHTML =
      `<button class="card card-empty ${!lo.sub ? 'on' : ''}" data-slot="sub" data-id=""><div class="c-name">なし</div><div class="c-stat">副武装を持たない</div></button>` +
      weps.map((w) => this.cardWeapon(w, lo.sub === w.id, 'sub')).join('');
    el('list-cores').innerHTML = D.CORES.filter((c) => owned(this.save, c.id)).map((c) => this.cardCore(c, lo.core === c.id)).join('') || this.emptyNote();

    /* クリック割り当て */
    for (const box of ['list-frames', 'list-main', 'list-sub', 'list-cores']) {
      const node = el(box);
      if (node._bound) continue;
      node._bound = true;
      node.addEventListener('click', (e) => {
        const c = e.target.closest('.card'); if (!c || c.disabled) return;
        const slot = c.dataset.slot, id = c.dataset.id;
        const cur = this.lo();
        if (slot === 'main' && cur.sub === id) cur.sub = cur.main;   // 入れ替え
        if (slot === 'sub' && cur.main === id) return;
        cur[slot] = id || null;
        C.Save.save();
        this.app.audio.sfx('ui');
        this.render();
      });
    }
  }

  emptyNote() { return `<div class="c-stat" style="padding:8px 2px">まだ持っていない。ガチャで引く。</div>`; }

  cardFrame(f, on) {
    const r = rec(this.save, f.id);
    const has = !!r;
    return `<button class="card r${f.rarity} ${on ? 'on' : ''} ${has ? '' : 'card-empty'}" data-slot="frame" data-id="${f.id}" ${has ? '' : 'disabled'}>
      <div class="c-name">${f.name}</div>
      <div class="c-meta"><span class="c-rar r${f.rarity}">${f.rarity}</span>
        <span class="c-lv">${has ? `Lv.${r.lv}${r.lb ? ' ★' + r.lb : ''}` : '未所持'}</span></div>
      <div class="c-stat">${f.cls}・耐久 ${f.hp}／機動 ${f.speed}<br>必殺: ${D.SPECIALS[f.special].name}</div>
    </button>`;
  }
  cardWeapon(w, on, slot) {
    const r = rec(this.save, w.id);
    const E = D.ELEMENTS[w.el];
    const dps = w.kind === 'beam' || w.kind === 'flame'
      ? Math.round(w.dmg * 28)
      : Math.round(w.dmg * (w.pellets || 1) * (w.volley || 1) * w.rpm / 60);
    return `<button class="card r${w.rarity} ${on ? 'on' : ''}" data-slot="${slot || 'main'}" data-id="${w.id}">
      <div class="c-name">${w.name}</div>
      <div class="c-meta"><span class="c-rar r${w.rarity}">${w.rarity}</span>
        <span class="c-el" style="color:${E.color};background:${E.color}1f">${E.icon} ${E.name}</span>
        <span class="c-lv">Lv.${r ? r.lv : 1}${r && r.lb ? ' ★' + r.lb : ''}</span></div>
      <div class="c-stat">毎秒 約${dps}／射程 ${w.range || w.arc ? (w.range || 100) : '―'}${w.splash ? '・爆風' : ''}</div>
    </button>`;
  }
  cardCore(c, on) {
    const r = rec(this.save, c.id);
    const names = c.traits.map((t) => D.TRAITS[t].name).join('・');
    return `<button class="card r${c.rarity} ${on ? 'on' : ''}" data-slot="core" data-id="${c.id}">
      <div class="c-name">${c.name}</div>
      <div class="c-meta"><span class="c-rar r${c.rarity}">${c.rarity}</span><span class="c-lv">Lv.${r ? r.lv : 1}</span></div>
      <div class="c-stat">${names}</div>
    </button>`;
  }

  /* ---------------- 改造 ---------------- */
  renderUpgrade() {
    const s = this.save;
    const items = [];
    for (const k of ['frames', 'weapons', 'cores']) {
      for (const id in s[k]) {
        const def = defOf(id); if (!def) continue;
        items.push({ id, def, rec: s[k][id], kind: k });
      }
    }
    const order = { SSR: 0, SR: 1, R: 2, N: 3 };
    items.sort((a, b) => (order[a.def.rarity] - order[b.def.rarity]) || a.def.name.localeCompare(b.def.name));

    el('up-grid').innerHTML = items.map((it) => {
      const mx = maxLv(it.rec);
      const cap = it.rec.lv >= mx;
      const cost = upCost(it.def, it.rec.lv);
      const afford = s.scrap >= cost;
      const pips = [0, 1, 2, 3].map((i) => `<i class="${i < (it.rec.lb || 0) ? 'on' : ''}"></i>`).join('');
      const gain = it.kind === 'weapons' ? '威力 +6.2%' : it.kind === 'frames' ? '耐久 +5.5%' : '効果安定';
      return `<div class="upcard r${it.def.rarity}">
        <div class="up-top">
          <span class="up-name">${it.def.name}</span>
          <span class="up-lv">Lv.${it.rec.lv}<small style="color:var(--ink-mute)"> / ${mx}</small></span>
        </div>
        <div class="up-bar"><i style="width:${it.rec.lv / mx * 100}%"></i></div>
        <div class="up-row">
          <span class="up-info">限界突破<span class="lb-pips">${pips}</span><br>${cap ? '上限。重複を引くと伸びる' : `1 段階で ${gain}`}</span>
          <button class="up-btn" data-up="${it.id}" ${cap || !afford ? 'disabled' : ''}>
            ${cap ? '上限' : `⬢ ${cost}`}
          </button>
        </div>
      </div>`;
    }).join('');

    const grid = el('up-grid');
    if (!grid._bound) {
      grid._bound = true;
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('[data-up]'); if (!b || b.disabled) return;
        const id = b.dataset.up, r = rec(this.save, id), def = defOf(id);
        const cost = upCost(def, r.lv);
        if (this.save.scrap < cost || r.lv >= maxLv(r)) return;
        this.save.scrap -= cost; r.lv++;
        C.Save.save();
        this.app.audio.sfx('uiBig');
        this.render();
      });
    }
  }

  /* ---------------- 図鑑 ---------------- */
  renderCodex() {
    const els = ['KIN', 'THR', 'ENE', 'EMP'];
    const arm = ['FRAME', 'ARMOR', 'SHIELD', 'COMP'];
    let h = '<table class="afftab"><thead><tr><th></th>';
    for (const a of arm) h += `<th>${D.ARMORS[a].name}</th>`;
    h += '</tr></thead><tbody>';
    for (const e of els) {
      h += `<tr><th style="color:${D.ELEMENTS[e].color}">${D.ELEMENTS[e].icon} ${D.ELEMENTS[e].name}</th>`;
      for (const a of arm) {
        const v = D.affinityOf(e, a);
        const cls = v >= 1.2 ? 'aff-good' : v <= 0.85 ? 'aff-bad' : '';
        h += `<td class="${cls}">×${v.toFixed(2)}</td>`;
      }
      h += '</tr>';
    }
    h += '</tbody></table>';
    el('aff-table').innerHTML = h;

    const notes = {
      scout: '軽く速い。真っ直ぐ突っ込んでくる。', gunner: '距離を保って三点射。遮蔽で切る。',
      shielder: '正面の盾でほぼ無効化。側面か背後を取る。', mortar: '遠くから曲射。着弾円が出たら退く。',
      drone: '群れて旋回する小型。まとめて薙ぐ。', sniper: '赤い線が伸びたら 1.4 秒後に着弾する。',
      mender: '味方を回復する。最優先で潰す。', bomber: '接近して自爆。近づかせない。',
      heavy: '硬くて火力も高い。熱属性が効く。', arcbot: '電磁弾で動きを止めてくる。',
    };
    el('enemy-list').innerHTML = Object.values(D.ENEMIES).map((e) =>
      `<div class="enemy-row">
        <span class="e-dot" style="background:${e.body};border:1px solid ${e.trim}"></span>
        <span class="e-name">${e.name}</span>
        <span class="e-armor">${D.ARMORS[e.armor].name}</span>
        <span class="e-note">${notes[e.id] || ''}</span>
      </div>`).join('');
  }

  /* ---------------- ガチャ ---------------- */
  pull(n) {
    const s = this.save;
    if (s.tickets < n) return;
    s.tickets -= n;
    this.app.audio.sfx('gacha');
    const results = [];
    for (let i = 0; i < n; i++) results.push(pullOne(s, null));
    if (n === 10 && !results.some((r) => r.rarity === 'SR' || r.rarity === 'SSR')) {
      results[results.length - 1] = pullOne(s, 'SR');
    }
    C.Save.save();
    this.showGacha(results);
  }

  showGacha(results) {
    const box = el('go-cards');
    box.innerHTML = '';
    el('gacha-overlay').classList.remove('hidden');
    const kindLabel = { frame: '機体', weapon: '武装', core: 'コア' };
    results.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = `gcard r${r.rarity}`;
      d.style.animationDelay = `${i * 0.09}s`;
      d.innerHTML = `<div class="gc-rar r${r.rarity}">${r.rarity}</div>
        <div class="gc-name">${r.def.name}</div>
        <div class="gc-kind">${kindLabel[r.kind]}</div>
        ${r.dup
          ? `<div class="gc-dup">${r.capped ? '突破上限 → スクラップに変換' : `限界突破 ★${r.lb}`}</div>`
          : `<div class="gc-new">NEW</div>`}`;
      box.appendChild(d);
      setTimeout(() => this.app.audio.sfx('reveal', r.rarity), i * 90);
    });
  }

  /* ---------------- 機体プレビュー ---------------- */
  startPreview() {
    const cv = el('mech-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const tick = () => {
      if (!this.app.screen || this.app.screen !== 'hangar') { this.raf = null; return; }
      this.previewT += 0.016;
      const lo = this.lo();
      const f = D.getFrame(lo.frame) || D.FRAMES[0];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      /* 台座 */
      ctx.save();
      ctx.translate(cv.width / 2, cv.height / 2 + 6);
      ctx.strokeStyle = 'rgba(79,195,255,0.18)'; ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 34 * i, 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(79,195,255,0.30)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 10]); ctx.lineDashOffset = -this.previewT * 22;
      ctx.beginPath(); ctx.arc(0, 0, 104, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      const a = this.previewT * 0.5;
      R.shadow(ctx, cv.width / 2, cv.height / 2 + 44, 52, 15, 0.35);
      R.drawRobot(ctx, {
        x: cv.width / 2, y: cv.height / 2, r: 50,
        ang: a, aim: a + Math.sin(this.previewT * 0.7) * 0.22,
        walkPhase: this.previewT * 2.0, muzzle: 0, recoil: 0, hitFlash: 0, thrust: false,
      }, { body: f.body, trim: f.trim, accent: f.accent }, { twin: !!lo.sub });
      this.raf = requestAnimationFrame(tick);
    };
    if (!this.raf) this.raf = requestAnimationFrame(tick);
  }
  stopPreview() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; } }
}

window.MRHangar = { Hangar, grant, owned, rec, maxLv, upCost, defOf, kindOf };
})();
