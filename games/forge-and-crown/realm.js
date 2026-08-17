/* =========================================================================
   FORGE & CROWN ― 戦略画面
   領地マップ / 城づくり / 内政コマンド / 月送り / 敵勢力の行動
   ========================================================================= */

const Realm = {
  cv: null, ctx: null, w: 0, h: 0, dpr: 1,
  hover: null, nodes: [], nodeById: {},
  raf: 0, t: 0,

  init() {
    this.cv = $('map');
    this.ctx = this.cv.getContext('2d');
    window.addEventListener('resize', () => this.resize());
    this.cv.addEventListener('pointerdown', (e) => this.onPointer(e, true));
    this.cv.addEventListener('pointermove', (e) => this.onPointer(e, false));
    this.cv.addEventListener('pointerleave', () => { this.hover = null; });
  },

  show() {
    $('screen-realm').classList.remove('hidden');
    this.resize();
    this.refreshHUD();
    if (!this.raf) this.loop();
  },
  hide() {
    $('screen-realm').classList.add('hidden');
    cancelAnimationFrame(this.raf); this.raf = 0;
  },

  resize() {
    const wrap = $('map-scroll');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    // 狭い画面では地図を最低幅で描き、横スクロールで見てもらう
    this.w = Math.max(680, r.width);
    this.h = Math.max(440, r.height);
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
    this.cv.style.width = this.w + 'px';
    this.cv.style.height = this.h + 'px';
    this.layout();
  },

  layout() {
    const pad = 42;
    const w = this.w - pad * 2, h = this.h - pad * 2;
    this.nodes = REGIONS.map((r) => ({ id: r.id, x: pad + r.x * w, y: pad + r.y * h, r: r.capital ? 24 : 20 }));
    this.nodeById = {};
    this.nodes.forEach((n) => { this.nodeById[n.id] = n; });
  },

  onPointer(e, click) {
    const rect = this.cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let hit = null;
    this.nodes.forEach((n) => { if (dist(x, y, n.x, n.y) <= n.r + 8) hit = n.id; });
    this.hover = hit;
    if (click && hit) { Sfx.click(); openRegionPanel(hit); }
  },

  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    this.t += 1 / 60;
    this.draw();
  },

  draw() {
    const c = this.ctx;
    if (!c) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.w, H = this.h;

    // 羊皮紙の下地
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#e5d6b4'); g.addColorStop(0.5, '#dccaa4'); g.addColorStop(1, '#cdb98e');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // 地形の色むら
    c.save();
    const rng = mulberry32(4242);
    for (let i = 0; i < 90; i++) {
      const x = rng() * W, y = rng() * H, r = 24 + rng() * 90;
      c.globalAlpha = 0.05 + rng() * 0.05;
      c.fillStyle = rng() > 0.5 ? '#8a7a52' : '#b9a878';
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();

    // 海（右下と左上の縁）
    c.save();
    c.globalAlpha = 0.35; c.fillStyle = '#6f97a8';
    c.beginPath(); c.moveTo(W, 0); c.lineTo(W, H * 0.16); c.quadraticCurveTo(W * 0.9, H * 0.05, W * 0.86, 0); c.fill();
    c.beginPath(); c.moveTo(0, H); c.lineTo(W * 0.1, H); c.quadraticCurveTo(0, H * 0.9, 0, H * 0.86); c.fill();
    c.restore();

    // 街道
    c.save();
    c.lineCap = 'round';
    ROADS.forEach(([a, b]) => {
      const na = this.nodeById[a], nb = this.nodeById[b];
      if (!na || !nb) return;
      const oa = G.regions[a].owner, ob = G.regions[b].owner;
      const link = oa === 'player' || ob === 'player';
      c.strokeStyle = link ? 'rgba(60,90,140,0.55)' : 'rgba(90,70,45,0.35)';
      c.lineWidth = link ? 3 : 2;
      c.setLineDash(link ? [] : [7, 5]);
      c.beginPath(); c.moveTo(na.x, na.y); c.lineTo(nb.x, nb.y); c.stroke();
    });
    c.setLineDash([]);
    c.restore();

    // 領地
    this.nodes.forEach((n) => {
      const R = REGION_BY_ID[n.id], st = G.regions[n.id];
      const F = FACTIONS[st.owner];
      const mine = st.owner === 'player';
      const front = isFrontier(n.id);
      const hov = this.hover === n.id;
      const pulse = front ? 1 + Math.sin(this.t * 3) * 0.06 : 1;
      const rad = n.r * (hov ? 1.14 : 1) * pulse;

      // 影
      c.fillStyle = 'rgba(50,35,20,0.28)';
      c.beginPath(); c.ellipse(n.x, n.y + rad * 0.75, rad * 0.9, rad * 0.32, 0, 0, Math.PI * 2); c.fill();

      // 本体
      const gg = c.createRadialGradient(n.x - rad * 0.3, n.y - rad * 0.4, rad * 0.2, n.x, n.y, rad);
      gg.addColorStop(0, shade(F.color, 0.35));
      gg.addColorStop(1, shade(F.color, -0.28));
      c.fillStyle = gg;
      c.beginPath(); c.arc(n.x, n.y, rad, 0, Math.PI * 2); c.fill();

      c.lineWidth = mine ? 3.5 : 2;
      c.strokeStyle = mine ? '#ffe9a8' : 'rgba(35,25,15,0.6)';
      c.stroke();

      if (front) {
        c.save();
        c.strokeStyle = 'rgba(255,120,90,' + (0.45 + Math.sin(this.t * 3) * 0.25) + ')';
        c.lineWidth = 2;
        c.beginPath(); c.arc(n.x, n.y, rad + 6, 0, Math.PI * 2); c.stroke();
        c.restore();
      }

      // 紋章
      c.font = `${Math.round(rad * 0.95)}px system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(R.capital ? '👑' : F.crest, n.x, n.y + 1);

      // 名前
      c.font = 'bold 12px system-ui, sans-serif';
      c.textBaseline = 'top';
      const label = R.name;
      const tw = c.measureText(label).width;
      c.fillStyle = 'rgba(28,20,12,0.78)';
      roundRect(c, n.x - tw / 2 - 6, n.y + rad + 4, tw + 12, 17, 5);
      c.fill();
      c.fillStyle = mine ? '#bfe4ff' : '#f0e4cc';
      c.fillText(label, n.x, n.y + rad + 6);

      // 兵数
      c.font = 'bold 11px system-ui, sans-serif';
      const tt = `⚔${Math.round(st.troops)}`;
      const tw2 = c.measureText(tt).width;
      c.fillStyle = 'rgba(28,20,12,0.68)';
      roundRect(c, n.x - tw2 / 2 - 5, n.y + rad + 23, tw2 + 10, 15, 4);
      c.fill();
      c.fillStyle = '#ffd9a0';
      c.fillText(tt, n.x, n.y + rad + 24);
    });

    // 方位
    c.save();
    c.globalAlpha = 0.5;
    c.font = 'bold 13px serif'; c.fillStyle = '#5a4526';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.beginPath(); c.arc(W - 34, 34, 18, 0, Math.PI * 2); c.strokeStyle = '#5a4526'; c.lineWidth = 1.5; c.stroke();
    c.fillText('北', W - 34, 22); c.fillText('◆', W - 34, 38);
    c.restore();
  },

  refreshHUD() {
    const ri = rankInfo();
    $('tb-rank').textContent = ri.name;
    $('tb-lord').textContent = G.lord;
    $('tb-date').textContent = `${G.year}年 ${G.month}月`;
    const s = seasonOf(G.month);
    $('tb-season').textContent = s.name;
    $('tb-season').style.color = s.color;
    $('tb-ap').innerHTML = `行動力 ${'⏳'.repeat(G.ap) || '―'}`;
    $('tb-valor').textContent = `戦功 ${fmt(G.valor)}`;
    const nx = nextRank();
    $('tb-valor').title = nx ? `次の昇進まで ${fmt(nx.valor - G.valor)}` : '最高位';

    const r = G.res;
    $('tb-res').innerHTML = [
      `<span class="res"><i>🪙</i>${fmt(r.gold)}</span>`,
      `<span class="res"><i>🌾</i>${fmt(r.food)}</span>`,
      `<span class="res"><i>🪵</i>${fmt(r.wood)}</span>`,
      `<span class="res"><i>🪨</i>${fmt(r.stone)}</span>`,
      `<span class="res"><i>⚔️</i>${fmt(G.troops)}<small>/${troopCap()}</small></span>`,
      `<span class="res"><i>❤️</i>${fmt(G.loyalty)}</span>`,
    ].join('');
  },
};

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ===================== 領地パネル ===================== */
let currentRegion = null;

function openRegionPanel(id) {
  currentRegion = id;
  const R = REGION_BY_ID[id], st = G.regions[id], F = FACTIONS[st.owner];
  $('rg-name').innerHTML = `${F.crest} ${esc(R.name)} <small class="fac" style="color:${F.color}">${esc(F.name)}</small>`;

  const veins = Object.keys(R.veins).map((k) => `<span class="ore-chip" style="--c:${ORES[k].color}">${ORES[k].name} ×${R.veins[k]}</span>`).join('');
  const yields = `🪙${R.yield.gold} 🌾${R.yield.food} 🪵${R.yield.wood} 🪨${R.yield.stone}`;
  const adj = NEIGHBORS[id].map((n) => {
    const o = G.regions[n].owner;
    return `<span class="adj" style="--c:${FACTIONS[o].color}">${REGION_BY_ID[n].name}</span>`;
  }).join('');

  $('rg-body').innerHTML = `
    <p class="rg-desc">${esc(R.desc)}</p>
    <div class="rg-grid">
      <div class="rg-cell"><b>守備兵</b><span>⚔️ ${Math.round(st.troops)}</span></div>
      <div class="rg-cell"><b>地形</b><span>${TERRAIN[R.terr] ? TERRAIN[R.terr].name : R.terr}</span></div>
      <div class="rg-cell"><b>防備</b><span>🛡️ ${R.def}</span></div>
      <div class="rg-cell"><b>毎月の産出</b><span>${yields}</span></div>
    </div>
    <div class="rg-sub"><b>鉱脈</b> ${veins || '<span class="dim">なし</span>'}</div>
    <div class="rg-sub"><b>隣接</b> ${adj}</div>
  `;

  const foot = $('rg-foot');
  if (st.owner === 'player') {
    foot.innerHTML = `<span class="hint">あなたの領地です。${id === 'ashford' ? '本城が置かれています。' : ''}</span>`;
  } else if (isFrontier(id)) {
    foot.innerHTML = `<span class="hint">自領に接しています。出陣できます。</span>
      <button class="big-btn danger" id="btn-attack">⚔️ 出陣する</button>`;
    $('btn-attack').onclick = () => { closePanel('panel-region'); openBrief(id); };
  } else {
    foot.innerHTML = `<span class="hint dim">自領と接していないため、まだ攻め込めません。</span>`;
  }
  openPanel('panel-region');
}

/* ===================== 出陣前 ===================== */
let briefTarget = null;
function openBrief(id) {
  briefTarget = id;
  const R = REGION_BY_ID[id], st = G.regions[id], F = FACTIONS[st.owner];
  const lo = playerLoadout();
  const ri = rankInfo();
  const myTroops = Math.min(ri.troops, G.troops);
  const enemyCount = enemyCountFor(id);
  const armor = equippedArmor();
  const slots = ri.decor;
  const decorHtml = armor && armor.decors.length
    ? armor.decors.slice(0, slots).map((d) => `<span class="d-chip">${DECORS[d].icon}${DECORS[d].name}</span>`).join('')
    : '<span class="dim">なし</span>';

  $('brief-body').innerHTML = `
    <h2>⚔️ ${esc(R.name)} へ出陣</h2>
    <p class="dim">${esc(F.name)}　守備兵 ${Math.round(st.troops)}　防備 ${R.def}</p>
    <div class="brief-cols">
      <div class="bc">
        <h3>あなた</h3>
        <div class="kv"><span>階級</span><b>${ri.name}</b></div>
        <div class="kv"><span>体力</span><b>${lo.maxHp}</b></div>
        <div class="kv"><span>物理防御</span><b>${Math.round(lo.def)}</b></div>
        <div class="kv"><span>魔法防御</span><b>${Math.round(lo.res)}</b></div>
        <div class="kv"><span>攻撃力</span><b>${Math.round(lo.atk)}</b></div>
        <div class="kv"><span>身のこなし</span><b>×${lo.spdMul.toFixed(2)}</b></div>
        <div class="kv"><span>鎧</span><b>${esc(lo.armorName)}</b></div>
        <div class="kv"><span>武器</span><b>${esc(lo.weaponName)}</b></div>
        <div class="kv"><span>必殺技</span><b>${ULTIMATES[lo.ult].icon} ${ULTIMATES[lo.ult].name}</b></div>
        <div class="kv"><span>装飾</span><b>${decorHtml}</b></div>
      </div>
      <div class="bc">
        <h3>戦場</h3>
        <div class="kv"><span>率いる兵</span><b>${myTroops} 人</b></div>
        <div class="kv"><span>兵の練度</span><b>${G.drill}</b></div>
        <div class="kv"><span>敵の数</span><b>およそ ${enemyCount} 体</b></div>
        <div class="kv"><span>敵の指揮官</span><b>${CAPTAINS[st.owner].name}</b></div>
        <p class="note">指揮官を討てば勝ちです。あなたが倒れると敗走します。</p>
        ${!armor ? '<p class="warn">鎧を着ていません。鍛冶場で打ってから行くことを強くすすめます。</p>' : ''}
        ${myTroops === 0 ? '<p class="warn">階級が低く、まだ兵を率いられません。単騎で挑むことになります。</p>' : ''}
      </div>
    </div>`;
  openPanel('panel-brief');
}

function enemyCountFor(id) {
  const st = G.regions[id];
  return clamp(Math.round(4 + st.troops * 0.28), 5, 26);
}

/* ===================== 城づくり ===================== */
let selectedBuild = null;
let selectedTile = -1;

function openCastle() {
  selectedBuild = null; selectedTile = -1;
  renderCastle();
  openPanel('panel-castle');
}

function renderCastle() {
  const grid = $('castle-grid');
  grid.innerHTML = '';
  for (let i = 0; i < CN * CN; i++) {
    const el = document.createElement('button');
    const terr = G.castle.terr[i], bid = G.castle.build[i];
    const unlocked = tileUnlocked(i);
    el.className = 'ct' + (unlocked ? '' : ' locked') + (i === KEEP_IDX ? ' keep' : '') + (selectedTile === i ? ' sel' : '');
    el.style.setProperty('--t1', TERRAIN[terr].color);
    el.style.setProperty('--t2', TERRAIN[terr].color2);
    if (bid) {
      const y = tileYield(i);
      const fit = terrainMul(bid, terr);
      const mark = fit >= 1.5 ? '◎' : fit >= 1.15 ? '○' : fit < 1 ? '×' : '';
      el.innerHTML = `<span class="ct-ico">${BUILDINGS[bid].icon}</span><span class="ct-fit ${fit >= 1.15 ? 'good' : fit < 1 ? 'bad' : ''}">${mark}</span>`;
      el.title = BUILDINGS[bid].name;
    } else if (unlocked) {
      el.innerHTML = `<span class="ct-terr">${terrIcon(terr)}</span>`;
    } else {
      el.innerHTML = `<span class="ct-lock">🔒</span>`;
    }
    el.onclick = () => onCastleTile(i);
    grid.appendChild(el);
  }
  grid.style.setProperty('--n', CN);

  $('castle-plot').textContent = `敷地 ${plotRadius() * 2 + 1}×${plotRadius() * 2 + 1}`;
  $('castle-def').textContent = `防衛力 ${castleDefense()}`;

  $('castle-legend').innerHTML = Object.values(TERRAIN)
    .map((t) => `<span class="lg"><i style="background:${t.color}"></i>${terrIcon(t.id)} ${t.name}</span>`).join('');

  // 建てるものリスト
  const list = $('build-list');
  list.innerHTML = '';
  BUILD_IDS.forEach((id) => {
    const B = BUILDINGS[id];
    const locked = B.rank && G.rank < B.rank;
    const ok = !locked && canPay({ ...B.cost, ap: 1 });
    const el = document.createElement('button');
    el.className = 'bitem' + (selectedBuild === id ? ' sel' : '') + (ok ? '' : ' dim');
    el.innerHTML = `<span class="bi-ico">${B.icon}</span>
      <span class="bi-body"><b>${B.name}</b><small>${costText(B.cost)} ⏳1</small></span>
      ${locked ? `<span class="bi-lock">${RANKS[B.rank - 1].name}〜</span>` : ''}`;
    el.onclick = () => {
      if (locked) { Sfx.deny(); toast(`${RANKS[B.rank - 1].name} にならないと建てられません`, 'bad'); return; }
      selectedBuild = selectedBuild === id ? null : id;
      Sfx.click();
      renderCastle();
      showBuildInfo(id);
    };
    list.appendChild(el);
  });

  if (selectedTile >= 0) showTileInfo(selectedTile);
  else if (selectedBuild) showBuildInfo(selectedBuild);
  else showCastleSummary();

  $('castle-hint').textContent = selectedBuild
    ? `「${BUILDINGS[selectedBuild].name}」を置くマスをタップしてください`
    : '建物を選んでから、敷地のマスをタップします。';
}

function terrIcon(t) {
  return { plain: '🌱', hill: '⛰', wood: '🌲', rock: '🪨', water: '🌊' }[t] || '';
}

function onCastleTile(i) {
  if (!tileUnlocked(i)) { Sfx.deny(); toast('階級が上がると敷地が広がります', 'bad'); return; }
  if (i === KEEP_IDX) { selectedTile = i; selectedBuild = null; renderCastle(); return; }

  if (selectedBuild) {
    const B = BUILDINGS[selectedBuild];
    if (G.castle.build[i]) { Sfx.deny(); toast('すでに建物があります。先に取り壊してください', 'bad'); return; }
    if (!canPay({ ...B.cost, ap: 1 })) { Sfx.deny(); toast('資源か行動力が足りません', 'bad'); return; }
    pay({ ...B.cost, ap: 1 });
    G.castle.build[i] = selectedBuild;
    Sfx.build();
    toast(`${B.icon} ${B.name} を建てた`, 'good');
    pushLog('🏗️', `城内に ${B.name} を建てた。`);
    onBuildComplete(selectedBuild);
    selectedTile = i;
    Save.save();
    Realm.refreshHUD();
    renderCastle();
    return;
  }
  selectedTile = i;
  renderCastle();
}

/** 建物を建てたときの副産物 */
function onBuildComplete(id) {
  if (id === 'chapel' && buildCount('chapel') === 1) {
    G.decorStock.saint = (G.decorStock.saint || 0) + 1;
    toast('装飾「✨ 聖印」を授かった', 'good');
  }
  if (id === 'mageTower' && buildCount('mageTower') === 1) {
    G.decorStock.star = (G.decorStock.star || 0) + 1;
    toast('装飾「⭐ 星辰の宝珠」を手に入れた', 'good');
  }
  if (id === 'barracks' && buildCount('barracks') === 1) {
    G.decorStock.banner = (G.decorStock.banner || 0) + 1;
    toast('装飾「🚩 軍旗」を受け取った', 'good');
  }
}

function showBuildInfo(id) {
  const B = BUILDINGS[id];
  const y = B.yield && Object.keys(B.yield).length
    ? Object.keys(B.yield).map((k) => `${yieldLabel(k)} +${B.yield[k]}`).join(' / ')
    : '―';
  $('castle-info').innerHTML = `
    <h4>${B.icon} ${B.name}</h4>
    <p>${esc(B.desc)}</p>
    <div class="kv"><span>費用</span><b>${costText(B.cost)} ⏳1</b></div>
    <div class="kv"><span>基本の産出</span><b>${y}</b></div>
    <div class="kv"><span>相性◎</span><b>${B.best.map((t) => TERRAIN[t].name).join('・') || '―'}</b></div>
    <div class="kv"><span>相性×</span><b>${B.bad.map((t) => TERRAIN[t].name).join('・') || '―'}</b></div>`;
}

function showTileInfo(i) {
  const bid = G.castle.build[i], terr = G.castle.terr[i];
  const x = i % CN, y = (i / CN) | 0;
  if (!bid) {
    $('castle-info').innerHTML = `<h4>${terrIcon(terr)} ${TERRAIN[terr].name}（${x + 1},${y + 1}）</h4>
      <p class="dim">空き地です。左の一覧から建物を選んで置けます。</p>`;
    return;
  }
  const B = BUILDINGS[bid];
  const ty = tileYield(i);
  const fit = terrainMul(bid, terr);
  const yTxt = ty && Object.keys(ty).length
    ? Object.keys(ty).map((k) => `${yieldLabel(k)} +${fmt1(ty[k])}`).join(' / ') : '―';
  $('castle-info').innerHTML = `
    <h4>${B.icon} ${B.name}<small>（${x + 1},${y + 1}／${TERRAIN[terr].name}）</small></h4>
    <p>${esc(B.desc)}</p>
    <div class="kv"><span>地形相性</span><b class="${fit >= 1.15 ? 'good' : fit < 1 ? 'bad' : ''}">×${fit.toFixed(2)}</b></div>
    <div class="kv"><span>実際の産出</span><b>${yTxt}</b></div>
    ${bid === 'keep' ? '' : `<button class="ghost-btn small" id="btn-demolish">取り壊す（石材が半分もどる）</button>`}`;
  const d = $('btn-demolish');
  if (d) d.onclick = () => {
    confirmDlg(`${B.name} を取り壊しますか？`, () => {
      G.res.stone += Math.floor((B.cost.stone || 0) / 2);
      G.res.wood += Math.floor((B.cost.wood || 0) / 2);
      G.castle.build[i] = null;
      Sfx.place();
      Save.save(); Realm.refreshHUD(); renderCastle();
    });
  };
}

function showCastleSummary() {
  const cy = castleYield();
  const rows = ['gold', 'food', 'wood', 'stone', 'loyalty', 'ore']
    .filter((k) => cy[k] > 0)
    .map((k) => `<div class="kv"><span>${yieldLabel(k)}</span><b>+${fmt1(cy[k])}</b></div>`).join('');
  $('castle-info').innerHTML = `
    <h4>城の様子</h4>
    <p class="dim">建物ごとの毎月の産出です。マスをタップすると詳しく見られます。</p>
    ${rows || '<p class="dim">まだ何も建っていません。</p>'}
    <div class="kv"><span>兵の上限</span><b>${troopCap()}</b></div>
    <div class="kv"><span>鎧の仕上がり</span><b>×${forgeQuality().toFixed(2)}</b></div>`;
}

function yieldLabel(k) {
  return { gold: '🪙金貨', food: '🌾食料', wood: '🪵木材', stone: '🪨石材', loyalty: '❤️民心', ore: '⛏️鉱石' }[k] || k;
}

/* ===================== 内政コマンド ===================== */
const AFFAIRS = [
  {
    id: 'recruit', icon: '🪖', name: '徴兵', cost: { ap: 1, gold: 60, food: 40 },
    desc: '村々から兵を募る。兵舎があるほど多く集まる。',
    run() {
      const n = 3 + buildCount('barracks') * 2 + Math.floor(G.loyalty / 25);
      const add = Math.min(n, troopCap() - G.troops);
      if (add <= 0) { toast('兵舎が足りず、これ以上は養えません', 'bad'); return false; }
      G.troops += add; G.loyalty -= 2;
      toast(`兵が ${add} 人 集まった`, 'good');
      return true;
    },
  },
  {
    id: 'drill', icon: '🎯', name: '訓練', cost: { ap: 1, gold: 40, food: 20 },
    desc: '兵を鍛える。練度は戦場での味方の強さになる。',
    run() {
      const cap = 60 + G.rank * 4 + buildCount('yard') * 10;
      if (G.drill >= cap) { toast(`これ以上は鍛えられません（上限 ${cap}）`, 'bad'); return false; }
      const up = 6 + buildCount('yard') * 4;
      G.drill = Math.min(cap, G.drill + up);
      toast(`兵の練度が ${G.drill} になった`, 'good');
      return true;
    },
  },
  {
    id: 'mine', icon: '⛏️', name: '採掘', cost: { ap: 1, gold: 30 },
    desc: '坑道に人を入れて鉱石を掘る。鉱山があるほど多い。',
    run() {
      const pts = 4 + buildCount('mine') * 2.5;
      const got = oreIncome(pts);
      const ks = Object.keys(got);
      if (!ks.length) { toast('掘れる鉱脈がありません', 'bad'); return false; }
      ks.forEach((k) => { G.ores[k] += got[k]; });
      toast('⛏️ ' + ks.map((k) => `${ORES[k].name} +${fmt1(got[k])}`).join(' / '), 'good');
      return true;
    },
  },
  {
    id: 'reclaim', icon: '🌱', name: '開墾', cost: { ap: 1, gold: 50, wood: 15 },
    desc: '荒れ地を畑に変える。すべての農場の実りが少し増える。',
    run() {
      G.res.food += 40 + buildCount('farm') * 12;
      G.loyalty += 3;
      toast('畑を広げた。食料が増えた', 'good');
      return true;
    },
  },
  {
    id: 'patrol', icon: '🐎', name: '巡察', cost: { ap: 1, gold: 25 },
    desc: '領内を見回る。民心が上がり、盗賊も減る。',
    run() { G.loyalty = Math.min(100, G.loyalty + 9); toast('民の顔が明るくなった', 'good'); return true; },
  },
  {
    id: 'tax', icon: '💰', name: '徴税', cost: { ap: 1 },
    desc: '臨時の税を集める。金貨は増えるが民心が下がる。',
    run() {
      const g = Math.round(60 + ownedRegions().length * 22 + G.loyalty * 0.6);
      G.res.gold += g; G.loyalty -= 10;
      toast(`🪙 ${g} を集めた（民心 -10）`, 'good');
      return true;
    },
  },
  {
    id: 'trade', icon: '🏪', name: '交易', cost: { ap: 1 }, needs: 'market',
    desc: '市場で資源を売り買いする。市場が必要。',
    run() { openTrade(); return false; },
  },
];

function openAffairs() {
  renderAffairs();
  openPanel('panel-affairs');
}

function renderAffairs() {
  $('aff-ap').innerHTML = `行動力 ${'⏳'.repeat(G.ap) || '0'}`;
  const list = $('affairs-list');
  list.innerHTML = '';
  AFFAIRS.forEach((a) => {
    const needOk = !a.needs || buildCount(a.needs) > 0;
    const ok = needOk && canPay(a.cost);
    const el = document.createElement('button');
    el.className = 'aitem' + (ok ? '' : ' dim');
    el.innerHTML = `<span class="ai-ico">${a.icon}</span>
      <span class="ai-body"><b>${a.name}</b><small>${esc(a.desc)}</small></span>
      <span class="ai-cost">${costText(a.cost)}</span>`;
    el.onclick = () => {
      if (!needOk) { Sfx.deny(); toast(`${BUILDINGS[a.needs].name} が必要です`, 'bad'); return; }
      if (!canPay(a.cost)) { Sfx.deny(); toast('資源か行動力が足りません', 'bad'); return; }
      const spent = a.run();
      if (spent) { pay(a.cost); Sfx.build(); }
      G.loyalty = clamp(G.loyalty, 0, 100);
      Save.save(); Realm.refreshHUD(); renderAffairs();
    };
    list.appendChild(el);
  });

  // 来月の見込み
  const cy = castleYield(), ri = regionIncome();
  const pay0 = rankInfo().pay;
  const s = seasonOf(G.month + 1 > 12 ? 1 : G.month + 1);
  const food = Math.round((cy.food + ri.food) * s.food) - foodUpkeep();
  const gold = Math.round(cy.gold + ri.gold + pay0 - G.troops * 3);
  const rows = [
    ['🪙 金貨', gold, `産出 ${Math.round(cy.gold + ri.gold)} ＋ 俸給 ${pay0} － 兵の給金 ${G.troops * 3}`],
    ['🌾 食料', food, `収穫 ${Math.round((cy.food + ri.food) * s.food)}（${s.name}×${s.food}） － 兵糧 ${foodUpkeep()}`],
    ['🪵 木材', Math.round(cy.wood + ri.wood), ''],
    ['🪨 石材', Math.round(cy.stone + ri.stone), ''],
    ['❤️ 民心', Math.round(cy.loyalty) - (G.res.food < foodUpkeep() ? 8 : 0), ''],
    ['⛏️ 鉱石', Math.round((cy.ore + 1) * 10) / 10, '鉱脈の構成にしたがって配分'],
  ];
  $('income-table').innerHTML = rows.map(([k, v, note]) =>
    `<div class="inc"><span>${k}</span><b class="${v < 0 ? 'bad' : 'good'}">${v >= 0 ? '+' : ''}${v}</b><small>${note}</small></div>`).join('');
}

const TRADES = [
  { give: { gold: 80 }, get: { wood: 45 }, label: '木材を買う' },
  { give: { gold: 80 }, get: { stone: 35 }, label: '石材を買う' },
  { give: { gold: 120 }, get: { food: 90 }, label: '食料を買う' },
  { give: { gold: 150 }, get: { ore: 'iron', n: 6 }, label: '鉄を買う' },
  { give: { food: 100 }, get: { gold: 130 }, label: '食料を売る' },
  { give: { wood: 80 }, get: { gold: 110 }, label: '木材を売る' },
];

function openTrade() {
  const mk = buildCount('market');
  const bonus = 1 + mk * 0.12;
  const html = TRADES.map((t, i) => {
    const giveTxt = Object.keys(t.give).map((k) => `${yieldLabel(k)} ${t.give[k]}`).join(' ');
    const n = t.get.ore ? Math.round(t.get.n * bonus) : null;
    const getTxt = t.get.ore ? `${ORES[t.get.ore].name} ${n}`
      : Object.keys(t.get).map((k) => `${yieldLabel(k)} ${Math.round(t.get[k] * bonus)}`).join(' ');
    const ok = canPay(t.give);
    return `<button class="trade ${ok ? '' : 'dim'}" data-i="${i}">
      <span class="t-give">${giveTxt}</span><span class="t-arrow">→</span><span class="t-get">${getTxt}</span></button>`;
  }).join('');
  confirmDlgHtml(`<h3>🏪 交易（市場 ×${mk}／取引 +${Math.round(mk * 12)}%）</h3><div class="trade-list">${html}</div>
    <p class="dim">1回の取引で行動力を1つ使います。</p>`);
  $$('#confirm-text .trade').forEach((btn) => {
    btn.onclick = () => {
      const t = TRADES[+btn.dataset.i];
      if (!canPay(t.give) || G.ap < 1) { Sfx.deny(); toast('資源か行動力が足りません', 'bad'); return; }
      pay(t.give); G.ap -= 1;
      if (t.get.ore) G.ores[t.get.ore] += Math.round(t.get.n * bonus);
      else for (const k in t.get) G.res[k] += Math.round(t.get[k] * bonus);
      Sfx.build();
      toast('取引が成立した', 'good');
      Save.save(); Realm.refreshHUD(); closePanel('panel-confirm'); renderAffairs();
    };
  });
}

/** ボタンなしの情報ダイアログ */
function confirmDlgHtml(html) {
  $('confirm-text').innerHTML = html;
  $('confirm-yes').classList.add('hidden');
  $('confirm-no').textContent = 'とじる';
  confirmCb = null;
  openPanel('panel-confirm');
}

/* ===================== 身上書 ===================== */
function openStatus() {
  const ri = rankInfo(), nx = nextRank();
  const lo = playerLoadout();
  const prog = nx ? clamp((G.valor - ri.valor) / (nx.valor - ri.valor), 0, 1) : 1;
  const owned = ownedRegions().length;
  $('status-body').innerHTML = `
    <div class="st-head">
      <div class="st-crest">${['🪶', '🗡️', '🎗️', '🏅', '🐴', '🛡️', '⚜️', '👑', '🦅', '👑'][G.rank - 1]}</div>
      <div>
        <div class="st-rank">${ri.name}<small>${ri.en}</small></div>
        <div class="st-name">${esc(G.lord)}</div>
      </div>
    </div>
    <div class="valor-bar"><i style="width:${prog * 100}%"></i>
      <span>戦功 ${fmt(G.valor)}${nx ? ` / ${fmt(nx.valor)}` : '（最高位）'}</span></div>
    ${nx ? `<p class="dim">次は <b>${nx.name}</b>。${esc(nx.unlock)}</p>` : '<p class="dim">これ以上の位はない。</p>'}
    <div class="st-grid">
      <div class="kv"><span>率いられる兵</span><b>${ri.troops} 人</b></div>
      <div class="kv"><span>装飾スロット</span><b>${ri.decor} / 3</b></div>
      <div class="kv"><span>城の敷地</span><b>${ri.plot * 2 + 1}×${ri.plot * 2 + 1}</b></div>
      <div class="kv"><span>毎月の俸給</span><b>🪙 ${ri.pay}</b></div>
      <div class="kv"><span>支給武器</span><b>${esc(lo.weaponName)}（攻撃 ${weaponOf().atk}）</b></div>
      <div class="kv"><span>領地</span><b>${owned} / ${REGIONS.length}</b></div>
    </div>
    <h3>戦歴</h3>
    <div class="st-grid">
      <div class="kv"><span>出陣</span><b>${G.stats.battles}</b></div>
      <div class="kv"><span>勝利</span><b>${G.stats.wins}</b></div>
      <div class="kv"><span>敗走</span><b>${G.stats.losses}</b></div>
      <div class="kv"><span>討ち取った敵</span><b>${G.stats.kills}</b></div>
      <div class="kv"><span>討った指揮官</span><b>${G.stats.captains}</b></div>
      <div class="kv"><span>打った鎧</span><b>${G.stats.forged}</b></div>
    </div>
    <h3>階級表</h3>
    ${rankTableHtml()}`;
  openPanel('panel-status');
}

function rankTableHtml() {
  return `<div class="rank-table">` + RANKS.map((r) => `
    <div class="rk ${r.n === G.rank ? 'now' : ''} ${r.n < G.rank ? 'done' : ''}">
      <span class="rk-n">${r.n}</span>
      <span class="rk-name">${r.name}<small>${r.en}</small></span>
      <span class="rk-need">戦功 ${fmt(r.valor)}</span>
      <span class="rk-troop">兵 ${r.troops}</span>
      <span class="rk-decor">装飾 ${r.decor}</span>
    </div>`).join('') + `</div>`;
}

/* ===================== 月送り ===================== */
function endTurn() {
  const report = { news: [], gains: {}, invasion: null };
  const s = seasonOf(G.month);
  const cy = castleYield(), ri2 = regionIncome();
  const ri = rankInfo();

  // 収入
  const gold = Math.round(cy.gold + ri2.gold + ri.pay - G.troops * 3);
  const food = Math.round((cy.food + ri2.food) * s.food) - foodUpkeep();
  const wood = Math.round(cy.wood + ri2.wood);
  const stone = Math.round(cy.stone + ri2.stone);
  G.res.gold = Math.max(0, G.res.gold + gold);
  G.res.food += food;
  G.res.wood += wood;
  G.res.stone += stone;
  report.gains = { gold, food, wood, stone };

  // 鉱石
  const got = oreIncome(cy.ore + 1);
  Object.keys(got).forEach((k) => { G.ores[k] += got[k]; });
  report.ores = got;

  // 製錬所
  const sm = buildCount('smelter');
  if (sm > 0 && G.ores.iron >= 3 * sm) {
    G.ores.iron -= 3 * sm; G.ores.steel += 2 * sm;
    report.news.push(`製錬所が 鉄${3 * sm} を 鋼${2 * sm} に鍛え直した。`);
  }
  const mt = buildCount('mageTower');
  if (mt > 0) { G.ores.moon += mt; report.news.push(`魔法塔が 月銀${mt} を精製した。`); }

  // 飢えと民心
  G.loyalty += Math.round(cy.loyalty);
  if (G.res.food < 0) {
    const lost = Math.min(G.troops, Math.ceil(-G.res.food / 12));
    G.res.food = 0;
    G.troops = Math.max(0, G.troops - lost);
    G.loyalty -= 12;
    report.news.push(`兵糧が尽き、兵が ${lost} 人 減った。`);
  }
  G.loyalty = clamp(G.loyalty, 0, 100);

  // 領地の守備兵はゆっくり回復
  ownedRegions().forEach((r) => {
    const st = G.regions[r.id];
    st.troops = Math.min(r.troops * 1.3, st.troops + 1 + G.loyalty * 0.02);
  });

  // 出来事
  const pool = EVENTS.filter((e) => !e.when || e.when(G));
  if (Math.random() < 0.55 && pool.length) {
    let total = pool.reduce((a, e) => a + e.w, 0), roll = Math.random() * total, ev = pool[0];
    for (const e of pool) { roll -= e.w; if (roll <= 0) { ev = e; break; } }
    ev.apply(G);
    G.loyalty = clamp(G.loyalty, 0, 100);
    report.event = ev;
    pushLog(ev.icon, `${ev.name}：${ev.text}`);
  }

  // 敵の行動
  enemyTurn(report);

  // 日付
  G.month++;
  if (G.month > 12) { G.month = 1; G.year++; }
  G.turn++; G.stats.turns++;
  G.ap = 3;

  Save.save();
  return report;
}

function enemyTurn(report) {
  // 守備兵の補充
  REGIONS.forEach((r) => {
    const st = G.regions[r.id];
    if (st.owner !== 'player') st.troops = Math.min(r.troops * 1.7, st.troops + Math.max(1, r.troops * 0.07));
  });

  ['valcrest', 'greyfell', 'obsidia', 'neutral'].forEach((f) => {
    const mine = REGIONS.filter((r) => G.regions[r.id].owner === f);
    if (!mine.length) return;
    if (f === 'neutral') return;            // 独立勢力は攻めてこない
    if (Math.random() > 0.38) return;

    const cands = [];
    mine.forEach((r) => NEIGHBORS[r.id].forEach((n) => {
      if (G.regions[n].owner !== f) cands.push({ from: r.id, to: n });
    }));
    if (!cands.length) return;
    // 弱い相手から狙う。プレイヤー領は少し敬遠する
    const weight = (x) => G.regions[x.to].troops * (G.regions[x.to].owner === 'player' ? 1.5 : 1);
    cands.sort((a, b) => weight(a) - weight(b));
    const c = cands[Math.min(cands.length - 1, randInt(0, 1))];
    const force = Math.round(G.regions[c.from].troops * 0.75);
    const target = G.regions[c.to];

    if (target.owner === 'player') {
      if (!report.invasion) report.invasion = { from: c.from, to: c.to, faction: f, force };
      return;
    }
    if (force > target.troops * 0.95) {
      G.regions[c.from].troops -= force;
      target.owner = f;
      target.troops = Math.round(force * 0.65);
      report.news.push(`${FACTIONS[f].name} が ${REGION_BY_ID[c.to].name} を攻め落とした。`);
    } else {
      G.regions[c.from].troops = Math.round(G.regions[c.from].troops * 0.82);
      target.troops = Math.round(target.troops * 0.85);
      report.news.push(`${FACTIONS[f].name} が ${REGION_BY_ID[c.to].name} を攻めたが、撃退された。`);
    }
  });
}

/** 籠城で自動的に決着をつける */
function autoDefend(inv) {
  const R = REGION_BY_ID[inv.to];
  const st = G.regions[inv.to];
  const home = inv.to === 'ashford';
  const power = st.troops * (1 + G.drill / 100) * 1.9 + R.def + (home ? castleDefense() : 0);
  const enemy = inv.force * (1 + Math.random() * 0.3);
  const win = power >= enemy;
  if (win) {
    st.troops = Math.max(1, Math.round(st.troops * 0.75));
    G.troops = Math.max(0, G.troops - randInt(0, 2));
    G.valor += 20;
    pushLog('🛡️', `${R.name} に籠城し、${FACTIONS[inv.faction].name} を退けた。`);
  } else {
    st.owner = inv.faction;
    st.troops = Math.round(inv.force * 0.5);
    G.troops = Math.max(0, G.troops - randInt(2, 5));
    G.loyalty -= 10;
    pushLog('💔', `${R.name} を ${FACTIONS[inv.faction].name} に奪われた。`);
  }
  G.loyalty = clamp(G.loyalty, 0, 100);
  checkPromotion();
  Save.save();
  return win;
}

/* ===================== 制圧・敗北の処理 ===================== */
function captureRegion(id) {
  const st = G.regions[id];
  const R = REGION_BY_ID[id];
  st.owner = 'player';
  st.troops = Math.max(3, Math.round(Math.min(rankInfo().troops, G.troops) * 0.7));
  pushLog('🚩', `${R.name} を制圧した。`);
  // 戦利品
  const loot = { gold: Math.round(60 + R.yield.gold * 3), food: Math.round(R.yield.food * 2) };
  G.res.gold += loot.gold; G.res.food += loot.food;
  Object.keys(R.veins).forEach((k) => { G.ores[k] += R.veins[k]; });
  const gotDecor = Math.random() < 0.45 ? pick(DECOR_IDS) : null;
  if (gotDecor) G.decorStock[gotDecor] = (G.decorStock[gotDecor] || 0) + 1;
  if (ownedRegions().length === REGIONS.length) G.won = true;
  Save.save();
  return { loot, gotDecor };
}
