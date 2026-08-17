/* =========================================================================
   FORGE & CROWN ― 鍛冶（4×4パズル）と武具庫
   ========================================================================= */

const Forge = {
  grid: new Array(16).fill(null),   // 各マスの鉱石ID
  pieces: [],                       // 置いた履歴 { ore, cells:[idx] }
  ore: 'iron',
  shape: 'p1',
  rot: 0,
  ghost: [],
};

/** 形を回転させたセル配列（左上に寄せて正規化） */
function shapeCells(shapeId, rot) {
  let cells = SHAPE_BY_ID[shapeId].cells.map((c) => [c[0], c[1]]);
  for (let i = 0; i < (rot % 4 + 4) % 4; i++) cells = cells.map(([x, y]) => [-y, x]);
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}
function shapeSize(cells) {
  return [Math.max(...cells.map((c) => c[0])) + 1, Math.max(...cells.map((c) => c[1])) + 1];
}

function openForge() {
  Forge.grid = new Array(16).fill(null);
  Forge.pieces = [];
  Forge.rot = 0;
  Forge.ghost = [];
  // 在庫のある鉱石を初期選択にする
  const stocked = ORE_IDS.filter((o) => Math.floor(G.ores[o]) > 0);
  Forge.ore = stocked[0] || 'iron';
  renderForge();
  openPanel('panel-forge');
  if (buildCount('forge') === 0) {
    toast('城に「⚒️ 鍛冶場」を建てないと鎧は打てません', 'bad');
  }
}

function renderForge() {
  $('forge-quality').textContent = `仕上がり ×${forgeQuality().toFixed(2)}`;

  // ① 鉱石
  const ol = $('ore-list');
  ol.innerHTML = '';
  ORE_IDS.forEach((id) => {
    const O = ORES[id], n = Math.floor(G.ores[id]);
    const el = document.createElement('button');
    el.className = 'oitem' + (Forge.ore === id ? ' sel' : '') + (n <= 0 ? ' empty' : '');
    el.style.setProperty('--c', O.color);
    el.style.setProperty('--e', O.edge);
    el.innerHTML = `<span class="o-swatch"></span>
      <span class="o-body"><b>${O.name}</b><small>防${O.def} 魔${O.res} 重${O.wt}</small></span>
      <span class="o-n">${n}</span>`;
    el.onclick = () => { Forge.ore = id; Sfx.click(); renderForge(); };
    ol.appendChild(el);
  });

  // ② 形
  const sl = $('shape-list');
  sl.innerHTML = '';
  SHAPES.forEach((s) => {
    const cells = shapeCells(s.id, Forge.shape === s.id ? Forge.rot : 0);
    const [w, h] = shapeSize(cells);
    const need = s.cells.length;
    const have = Math.floor(G.ores[Forge.ore]) >= need;
    const el = document.createElement('button');
    el.className = 'sitem' + (Forge.shape === s.id ? ' sel' : '') + (have ? '' : ' dim');
    let mini = `<span class="s-mini" style="--w:${w};--h:${h}">`;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const on = cells.some((c) => c[0] === x && c[1] === y);
      mini += `<i class="${on ? 'on' : ''}" style="--c:${ORES[Forge.ore].color}"></i>`;
    }
    mini += '</span>';
    el.innerHTML = `${mini}<span class="s-body"><b>${s.name}</b><small>${need}マス</small></span>`;
    el.onclick = () => {
      if (Forge.shape === s.id) Forge.rot = (Forge.rot + 1) % 4;
      else { Forge.shape = s.id; Forge.rot = 0; }
      Sfx.click();
      renderForge();
    };
    sl.appendChild(el);
  });

  // ③ 盤面
  $('row-labels').innerHTML = ARMOR_ROWS.map((r) =>
    `<span class="rl" title="${r.hint}">${r.name}<small>防×${r.defMul.toFixed(2)} 重×${r.wtMul.toFixed(2)}</small></span>`).join('');

  const g = $('forge-grid');
  g.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const el = document.createElement('button');
    const ore = Forge.grid[i];
    el.className = 'fc' + (ore ? ' filled' : '') + (Forge.ghost.includes(i) ? ' ghost' : '');
    if (ore) {
      el.style.setProperty('--c', ORES[ore].color);
      el.style.setProperty('--e', ORES[ore].edge);
      el.innerHTML = `<span class="fc-t">${ORES[ore].short}</span>`;
    } else if (Forge.ghost.includes(i)) {
      el.style.setProperty('--c', ORES[Forge.ore].color);
      el.style.setProperty('--e', ORES[Forge.ore].edge);
    }
    el.onpointerenter = () => { setGhost(i); };
    el.onclick = () => tryPlace(i);
    g.appendChild(el);
  }

  renderPreview();

  const filled = Forge.grid.filter(Boolean).length;
  $('forge-msg').innerHTML = filled === 16
    ? '<b class="good">16マス完成。「完品」ボーナスがつきます。</b>'
    : `残り <b>${16 - filled}</b> マス`;
  $('btn-forge-go').disabled = filled === 0;
}

function setGhost(anchor) {
  const cells = shapeCells(Forge.shape, Forge.rot);
  const ax = anchor % 4, ay = (anchor / 4) | 0;
  const idx = [];
  let ok = true;
  cells.forEach(([x, y]) => {
    const gx = ax + x, gy = ay + y;
    if (gx > 3 || gy > 3) { ok = false; return; }
    const i = gy * 4 + gx;
    if (Forge.grid[i]) ok = false;
    idx.push(i);
  });
  Forge.ghost = ok ? idx : [];
  $$('#forge-grid .fc').forEach((el, i) => {
    el.classList.toggle('ghost', Forge.ghost.includes(i));
    if (Forge.ghost.includes(i)) {
      el.style.setProperty('--c', ORES[Forge.ore].color);
      el.style.setProperty('--e', ORES[Forge.ore].edge);
    }
  });
}

function tryPlace(anchor) {
  const cells = shapeCells(Forge.shape, Forge.rot);
  const ax = anchor % 4, ay = (anchor / 4) | 0;
  const idx = [];
  for (const [x, y] of cells) {
    const gx = ax + x, gy = ay + y;
    if (gx > 3 || gy > 3) { Sfx.deny(); toast('枠からはみ出します', 'bad'); return; }
    const i = gy * 4 + gx;
    if (Forge.grid[i]) { Sfx.deny(); toast('すでに埋まっているマスがあります', 'bad'); return; }
    idx.push(i);
  }
  const need = idx.length;
  if (Math.floor(G.ores[Forge.ore]) < need) {
    Sfx.deny(); toast(`${ORES[Forge.ore].name} が ${need} 必要です`, 'bad'); return;
  }
  G.ores[Forge.ore] -= need;
  idx.forEach((i) => { Forge.grid[i] = Forge.ore; });
  Forge.pieces.push({ ore: Forge.ore, cells: idx });
  Forge.ghost = [];
  Sfx.place();
  renderForge();
  Realm.refreshHUD();
}

function undoPiece() {
  const p = Forge.pieces.pop();
  if (!p) { Sfx.deny(); return; }
  p.cells.forEach((i) => { Forge.grid[i] = null; });
  G.ores[p.ore] += p.cells.length;
  Sfx.click();
  renderForge();
  Realm.refreshHUD();
}
function clearForge() {
  while (Forge.pieces.length) {
    const p = Forge.pieces.pop();
    p.cells.forEach((i) => { Forge.grid[i] = null; });
    G.ores[p.ore] += p.cells.length;
  }
  Sfx.click();
  renderForge();
  Realm.refreshHUD();
}

function renderPreview() {
  const st = computeArmor(Forge.grid, forgeQuality());
  const cur = equippedArmor();
  const cmp = (a, b) => {
    if (!cur) return '';
    const d = Math.round(a - b);
    if (d === 0) return '';
    return `<i class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</i>`;
  };
  const U = ULTIMATES[st.ult];
  $('forge-preview').innerHTML = `
    <div class="pv-name">${st.filled ? esc(autoArmorName(st)) : '<span class="dim">まだ何も置いていません</span>'}</div>
    <div class="pv-stats">
      <div class="kv"><span>物理防御</span><b>${st.def} ${cmp(st.def, cur ? cur.stats.def : 0)}</b></div>
      <div class="kv"><span>魔法防御</span><b>${st.res} ${cmp(st.res, cur ? cur.stats.res : 0)}</b></div>
      <div class="kv"><span>耐久（HP+）</span><b>${st.hp} ${cmp(st.hp, cur ? cur.stats.hp : 0)}</b></div>
      <div class="kv"><span>重量</span><b>${st.wt}</b></div>
      <div class="kv"><span>身のこなし</span><b class="${st.spd >= 1 ? 'good' : st.spd < 0.85 ? 'bad' : ''}">×${st.spd.toFixed(2)}</b></div>
    </div>
    <div class="pv-ult" style="--c:${U.color}">
      <span class="u-ico">${U.icon}</span>
      <span class="u-body"><b>${U.name}</b><small>${esc(U.desc)}</small></span>
    </div>
    <div class="pv-bonus">
      ${st.bonuses.length ? st.bonuses.map((b) =>
        `<div class="bn ${b.bad ? 'bad' : 'good'}"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')
        : '<div class="dim">ボーナスなし</div>'}
    </div>`;
}

function doForge() {
  if (buildCount('forge') === 0) { Sfx.deny(); toast('先に城へ「鍛冶場」を建ててください', 'bad'); return; }
  const filled = Forge.grid.filter(Boolean).length;
  if (!filled) { Sfx.deny(); return; }
  const finish = () => {
    const st = computeArmor(Forge.grid, forgeQuality());
    const armor = {
      id: G.nextArmorId++,
      name: autoArmorName(st),
      grid: Forge.grid.slice(),
      stats: st,
      decors: [],
      turn: G.turn,
    };
    G.armors.push(armor);
    G.stats.forged++;
    if (!G.equipped) G.equipped = armor.id;
    Forge.grid = new Array(16).fill(null);
    Forge.pieces = [];
    Sfx.forge();
    pushLog('⚒️', `鎧「${armor.name}」を打ち上げた。`);
    Save.save();
    closePanel('panel-forge');
    Realm.refreshHUD();
    openArmory(armor.id);
    toast(`⚒️ ${armor.name} が仕上がった`, 'good');
  };
  if (filled < 16) {
    confirmDlg(`まだ ${16 - filled} マス空いています。<br>このまま鍛造すると守りに穴が残ります。よろしいですか？`,
      finish, 'このまま打つ');
  } else finish();
}

/* ===================== 武具庫 ===================== */
let armorySel = null;

function openArmory(selId) {
  armorySel = selId || G.equipped || (G.armors.length ? G.armors[G.armors.length - 1].id : null);
  renderArmory();
  openPanel('panel-armory');
}

function renderArmory() {
  const slots = rankInfo().decor;
  $('decor-slots').textContent = `装飾スロット ${slots} / 3`;

  const list = $('armor-list');
  list.innerHTML = '';
  if (!G.armors.length) {
    list.innerHTML = '<p class="dim pad">まだ鎧がありません。鍛冶場で打ちましょう。</p>';
  }
  G.armors.slice().reverse().forEach((a) => {
    const el = document.createElement('button');
    el.className = 'aritem' + (armorySel === a.id ? ' sel' : '') + (G.equipped === a.id ? ' eq' : '');
    el.innerHTML = `${miniGridHtml(a.grid)}
      <span class="ar-body"><b>${esc(a.name)}</b>
        <small>防${a.stats.def} 魔${a.stats.res} 体+${a.stats.hp} 速×${a.stats.spd.toFixed(2)}</small>
        <span class="ar-decors">${a.decors.slice(0, slots).map((d) => DECORS[d].icon).join('') || ''}</span></span>
      ${G.equipped === a.id ? '<span class="ar-eq">装備中</span>' : ''}`;
    el.onclick = () => { armorySel = a.id; Sfx.click(); renderArmory(); };
    list.appendChild(el);
  });

  const a = G.armors.find((x) => x.id === armorySel);
  const det = $('armor-detail');
  if (!a) {
    det.innerHTML = '<p class="dim pad">左の一覧から鎧を選んでください。</p>';
    return;
  }
  const st = a.stats;
  const U = ULTIMATES[st.ult];
  const eff = decorEffects(a);
  const slotHtml = [0, 1, 2].map((i) => {
    if (i >= slots) return `<div class="dslot locked">🔒<small>階級</small></div>`;
    const d = a.decors[i];
    if (!d) return `<div class="dslot empty" data-slot="${i}">＋<small>空き</small></div>`;
    return `<div class="dslot" data-slot="${i}"><span class="di">${DECORS[d].icon}</span>
      <b>${DECORS[d].name}</b><small>${DECORS[d].desc}</small><em class="rm">外す</em></div>`;
  }).join('');

  const stockKeys = Object.keys(G.decorStock).filter((k) => G.decorStock[k] > 0);
  const stockHtml = stockKeys.length
    ? stockKeys.map((k) => `<button class="dstock" data-add="${k}">
        <span class="di">${DECORS[k].icon}</span><b>${DECORS[k].name}</b>
        <small>${DECORS[k].desc}</small><em>×${G.decorStock[k]}</em></button>`).join('')
    : '<p class="dim">手持ちの装飾はありません。遺跡の発掘、礼拝堂や魔法塔の建設、領地の制圧で手に入ります。</p>';

  det.innerHTML = `
    <div class="ad-head">
      ${bigGridHtml(a.grid)}
      <div class="ad-title">
        <input id="armor-name" class="name-input" value="${esc(a.name)}" maxlength="16">
        <div class="ad-stats">
          <div class="kv"><span>物理防御</span><b>${st.def}</b></div>
          <div class="kv"><span>魔法防御</span><b>${st.res}</b></div>
          <div class="kv"><span>耐久（HP+）</span><b>${st.hp}</b></div>
          <div class="kv"><span>重量</span><b>${st.wt}</b></div>
          <div class="kv"><span>身のこなし</span><b class="${st.spd >= 1 ? 'good' : st.spd < 0.85 ? 'bad' : ''}">×${st.spd.toFixed(2)}</b></div>
        </div>
      </div>
    </div>
    <div class="pv-ult" style="--c:${U.color}">
      <span class="u-ico">${U.icon}</span>
      <span class="u-body"><b>必殺技：${U.name}</b><small>${esc(U.desc)}</small></span>
    </div>
    <div class="pv-bonus">${st.bonuses.map((b) =>
      `<div class="bn ${b.bad ? 'bad' : 'good'}"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}</div>

    <h3>装飾（最大3つ）</h3>
    <div class="dslots">${slotHtml}</div>
    <div class="decor-stock">${stockHtml}</div>
    ${Object.keys(eff).length ? `<p class="dim">装飾の合計効果：${Object.keys(eff).map((k) => decorEffLabel(k, eff[k])).join('・')}</p>` : ''}

    <div class="ad-btns">
      ${G.equipped === a.id ? '<span class="chip good">これを装備しています</span>'
        : `<button class="big-btn primary" id="btn-equip">この鎧を装備する</button>`}
      <button class="ghost-btn small" id="btn-scrap">解体する（鉱石が半分もどる）</button>
    </div>`;

  $('armor-name').onchange = (e) => {
    a.name = e.target.value.slice(0, 16) || autoArmorName(st);
    Save.save(); renderArmory();
  };
  const eq = $('btn-equip');
  if (eq) eq.onclick = () => {
    G.equipped = a.id; Sfx.build(); toast(`${a.name} を身につけた`, 'good');
    Save.save(); renderArmory();
  };
  $('btn-scrap').onclick = () => {
    confirmDlg(`「${esc(a.name)}」を解体しますか？<br>使った鉱石の半分がもどります。`, () => {
      const counts = a.stats.counts;
      Object.keys(counts).forEach((k) => { G.ores[k] += Math.floor(counts[k] / 2); });
      G.armors = G.armors.filter((x) => x.id !== a.id);
      if (G.equipped === a.id) G.equipped = G.armors.length ? G.armors[G.armors.length - 1].id : null;
      armorySel = G.equipped;
      Sfx.place(); Save.save(); Realm.refreshHUD(); renderArmory();
    });
  };
  $$('#armor-detail .dslot[data-slot]').forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.slot;
      if (a.decors[i]) {
        const d = a.decors[i];
        a.decors.splice(i, 1);
        G.decorStock[d] = (G.decorStock[d] || 0) + 1;
        Sfx.click(); Save.save(); renderArmory();
      }
    };
  });
  $$('#armor-detail .dstock').forEach((el) => {
    el.onclick = () => {
      const k = el.dataset.add;
      if (a.decors.length >= slots) { Sfx.deny(); toast(`いまの階級では装飾は ${slots} つまでです`, 'bad'); return; }
      if (a.decors.includes(k)) { Sfx.deny(); toast('同じ装飾は1つまでです', 'bad'); return; }
      a.decors.push(k);
      G.decorStock[k]--;
      if (G.decorStock[k] <= 0) delete G.decorStock[k];
      Sfx.place(); Save.save(); renderArmory();
    };
  });
}

function decorEffLabel(k, v) {
  const M = {
    atk: '攻撃', spd: '速度', def: '物防', res: '魔防', crit: '会心', drain: '吸収',
    rage: '闘気', ally: '味方', haste: '振り速', regen: '自動回復', thorn: '反撃', charge: '突進',
  };
  const pct = ['atk', 'spd', 'def', 'res', 'crit', 'drain', 'rage', 'ally', 'haste'].includes(k);
  return `${M[k] || k}${pct ? ` +${Math.round(v * 100)}%` : ''}`;
}

function miniGridHtml(grid) {
  return '<span class="mini-grid">' + grid.map((o) =>
    `<i style="background:${o ? ORES[o].color : 'rgba(255,255,255,.06)'}"></i>`).join('') + '</span>';
}
function bigGridHtml(grid) {
  let html = '<div class="big-wrap"><div class="big-rows">'
    + ARMOR_ROWS.map((r) => `<span>${r.name}</span>`).join('') + '</div><div class="big-grid">';
  for (let i = 0; i < 16; i++) {
    const o = grid[i];
    html += `<span class="bg-c${o ? '' : ' hole'}" style="${o ? `--c:${ORES[o].color};--e:${ORES[o].edge}` : ''}">${o ? ORES[o].short : ''}</span>`;
  }
  html += '</div></div>';
  return html;
}
