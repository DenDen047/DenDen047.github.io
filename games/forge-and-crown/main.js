/* =========================================================================
   FORGE & CROWN ― 画面のつなぎ
   ========================================================================= */

let pendingInvasion = null;

function wipe(cb) {
  const w = $('wipe');
  w.classList.add('on');
  setTimeout(() => { cb && cb(); w.classList.remove('on'); }, 260);
}

/* ===================== 起動 ===================== */
function boot() {
  Realm.init();
  Battle.init();

  $('help-ranks').innerHTML = rankTableHtml();

  $('btn-newgame').onclick = () => {
    Sfx.ensure(); Sfx.click();
    if (Save.exists()) {
      confirmDlg('いまのセーブデータを消して、新しく始めますか？', () => { closePanel('panel-confirm'); askName(); });
    } else askName();
  };
  $('btn-continue').onclick = () => {
    Sfx.ensure(); Sfx.click();
    if (Save.load()) { wipe(() => { $('screen-title').classList.add('hidden'); Realm.show(); }); }
    else toast('セーブデータを読み込めませんでした', 'bad');
  };
  $('btn-title-help').onclick = () => { Sfx.click(); openPanel('panel-help'); };

  $('btn-name-cancel').onclick = () => closePanel('panel-name');
  $('btn-name-ok').onclick = () => {
    const n = $('input-lord').value.trim() || 'アルド';
    closePanel('panel-name');
    newGame(n);
    wipe(() => { $('screen-title').classList.add('hidden'); Realm.show(); openPanel('panel-help'); });
  };
  $('input-lord').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-name-ok').click(); });

  // コマンドバー
  $$('.cmd').forEach((b) => {
    b.onclick = () => {
      Sfx.click();
      const c = b.dataset.cmd;
      if (c === 'castle') openCastle();
      else if (c === 'forge') openForge();
      else if (c === 'armory') openArmory();
      else if (c === 'affairs') openAffairs();
      else if (c === 'status') openStatus();
      else if (c === 'endturn') doEndTurn();
    };
  });

  $('btn-realm-help').onclick = () => { Sfx.click(); openPanel('panel-help'); };
  $('btn-realm-menu').onclick = () => { Sfx.click(); openMenu(false); };
  $('btn-battle-menu').onclick = () => { Sfx.click(); openMenu(true); };
  $('btn-mute').onclick = () => {
    G.muted = !G.muted;
    $('btn-mute').textContent = G.muted ? '🔇' : '🔊';
    Save.save();
  };

  // 閉じるボタン
  $$('[data-close]').forEach((b) => { b.onclick = () => { Sfx.click(); closePanel(b.dataset.close); }; });

  // 確認ダイアログ
  $('confirm-no').onclick = () => { closePanel('panel-confirm'); confirmCb = null; };
  $('confirm-yes').onclick = () => {
    const cb = confirmCb; confirmCb = null;
    closePanel('panel-confirm');
    if (cb) cb();
  };

  // 鍛冶
  $('btn-rotate').onclick = () => { Forge.rot = (Forge.rot + 1) % 4; Sfx.click(); renderForge(); };
  $('btn-undo').onclick = () => undoPiece();
  $('btn-clear').onclick = () => clearForge();
  $('btn-forge-go').onclick = () => doForge();
  window.addEventListener('keydown', (e) => {
    if ($('panel-forge').classList.contains('hidden')) return;
    if (e.code === 'KeyR') { Forge.rot = (Forge.rot + 1) % 4; Sfx.click(); renderForge(); }
    if (e.code === 'KeyZ') undoPiece();
  });

  // 出陣
  $('btn-brief-back').onclick = () => { Sfx.click(); closePanel('panel-brief'); };
  $('btn-brief-armory').onclick = () => { Sfx.click(); openArmory(); };
  $('btn-brief-go').onclick = () => launchAttack();

  // ターン結果
  $('btn-turn-ok').onclick = () => {
    closePanel('panel-turn');
    if (pendingInvasion) { const inv = pendingInvasion; pendingInvasion = null; askDefense(inv); }
    else { Realm.refreshHUD(); checkVictory(); }
  };

  // 戦闘結果
  $('btn-result-ok').onclick = () => {
    closePanel('panel-result');
    wipe(() => { Realm.show(); Realm.refreshHUD(); checkVictory(); });
  };

  // メニュー
  $('btn-menu-help').onclick = () => { closePanel('panel-menu'); openPanel('panel-help'); };
  $('btn-menu-log').onclick = () => { closePanel('panel-menu'); openLog(); };
  $('btn-menu-title').onclick = () => {
    confirmDlg('タイトルにもどりますか？（進行は保存されています）', () => {
      Save.save();
      Battle.quit(); Realm.hide(); closeAllPanels();
      $('screen-title').classList.remove('hidden');
      refreshTitle();
    });
  };
  $('btn-menu-retreat').onclick = () => {
    confirmDlg('戦いを捨てて退きますか？<br>兵を失い、戦功も得られません。', () => {
      closePanel('panel-menu');
      Battle.finish(false);
    });
  };
  $('btn-menu-reset').onclick = () => {
    confirmDlg('セーブデータを完全に消しますか？<br>この操作は取り消せません。', () => {
      Save.wipe();
      location.reload();
    });
  };

  refreshTitle();
}

function refreshTitle() {
  $('btn-continue').classList.toggle('hidden', !Save.exists());
  $('btn-mute').textContent = G.muted ? '🔇' : '🔊';
}

function askName() {
  $('input-lord').value = 'アルド';
  openPanel('panel-name');
  setTimeout(() => $('input-lord').select(), 60);
}

function openMenu(inBattle) {
  $('btn-menu-retreat').classList.toggle('hidden', !inBattle);
  openPanel('panel-menu');
}

function openLog() {
  $('log-body').innerHTML = G.logs.length
    ? G.logs.map((l) => `<div class="logrow"><span class="lg-i">${l.icon}</span>
        <span class="lg-t">${esc(l.text)}</span><span class="lg-n">${l.turn}か月目</span></div>`).join('')
    : '<p class="dim">まだ何もありません。</p>';
  openPanel('panel-log');
}

/* ===================== 出陣 ===================== */
function launchAttack() {
  if (G.ap < 1) { Sfx.deny(); toast('行動力がありません。月を送ってください', 'bad'); return; }
  if (G.res.food < 30) { Sfx.deny(); toast('兵糧（食料30）が足りません', 'bad'); return; }
  G.ap = 0;
  G.res.food -= 30;
  G.stats.battles++;
  Save.save();
  closePanel('panel-brief');
  const id = briefTarget;
  wipe(() => { Realm.hide(); Battle.start(id, 'attack'); });
}

function askDefense(inv) {
  const R = REGION_BY_ID[inv.to], F = FACTIONS[inv.faction];
  const home = inv.to === 'ashford';
  $('confirm-text').innerHTML = `
    <h3>⚔️ ${esc(F.name)} が ${esc(R.name)} に攻め込んできた！</h3>
    <p>敵勢 およそ <b>${inv.force}</b>　／　守備兵 <b>${Math.round(G.regions[inv.to].troops)}</b>
    ${home ? `　／　城の防衛力 <b>${castleDefense()}</b>` : ''}</p>
    <p class="dim">自ら迎え撃てば戦功が入りますが、負ければ領地を失います。籠城すれば守備兵と防備だけで自動的に決着します。</p>`;
  $('confirm-yes').textContent = '⚔️ 自ら迎え撃つ';
  $('confirm-yes').classList.remove('hidden');
  $('confirm-no').textContent = '🏰 籠城する';
  confirmCb = () => {
    wipe(() => { Realm.hide(); Battle.start(inv.to, 'defend', inv); });
  };
  $('confirm-no').onclick = () => {
    closePanel('panel-confirm');
    confirmCb = null;
    const win = autoDefend(inv);
    toast(win ? '籠城して敵を退けた' : `${REGION_BY_ID[inv.to].name} を奪われた`, win ? 'good' : 'bad');
    $('confirm-no').onclick = () => { closePanel('panel-confirm'); confirmCb = null; };
    Realm.refreshHUD();
    checkVictory();
  };
  openPanel('panel-confirm');
}

/* ===================== 戦闘結果 ===================== */
function showBattleResult(r) {
  Battle.quit();
  const R = REGION_BY_ID[r.regionId];
  const before = G.rank;
  let lines = [];
  let capture = null;

  G.troops = Math.max(0, G.troops - r.alliesLost);
  G.valor += r.valor;

  if (r.win) {
    G.stats.wins++;
    G.stats.kills += r.kills;
    G.stats.captains++;
    if (r.mode === 'attack') {
      capture = captureRegion(r.regionId);
      lines.push(`🚩 <b>${R.name}</b> を制圧した`);
      lines.push(`🪙 戦利品 金貨 ${capture.loot.gold}／🌾 食料 ${capture.loot.food}`);
      lines.push(`⛏️ ${R.name} の鉱脈から鉱石を接収した`);
      if (capture.gotDecor) lines.push(`${DECORS[capture.gotDecor].icon} 装飾「${DECORS[capture.gotDecor].name}」を手に入れた`);
    } else {
      const st = G.regions[r.regionId];
      st.troops = Math.max(1, Math.round(st.troops * 0.85));
      lines.push(`🛡️ <b>${R.name}</b> を守り抜いた`);
      G.loyalty = clamp(G.loyalty + 8, 0, 100);
      pushLog('🛡️', `${R.name} に攻め寄せた敵を、自ら迎え撃って退けた。`);
    }
  } else {
    G.stats.losses++;
    G.stats.kills += r.kills;
    const lost = randInt(1, 3);
    G.troops = Math.max(0, G.troops - lost);
    G.loyalty = clamp(G.loyalty - 6, 0, 100);
    if (r.mode === 'defend') {
      const st = G.regions[r.regionId];
      st.owner = pendingFaction || 'neutral';
      st.troops = 8;
      lines.push(`💔 <b>${R.name}</b> を奪われた`);
      pushLog('💔', `${R.name} を守りきれなかった。`);
    } else {
      lines.push(`🏳️ ${R.name} からの敗走`);
      pushLog('🏳️', `${R.name} への攻撃に失敗し、退却した。`);
    }
    lines.push(`兵を ${r.alliesLost + lost} 人 失った`);
  }

  const ups = checkPromotion();
  if (ups.length) {
    ups.forEach((u) => {
      lines.push(`🎖️ <b>${u.name}</b> に昇進！　${u.unlock}`);
    });
    setTimeout(() => Sfx.levelup(), 400);
  }
  Save.save();

  const ri = rankInfo();
  $('result-body').innerHTML = `
    <h2 class="${r.win ? 'win' : 'lose'}">${r.win ? '勝　利' : '敗　走'}</h2>
    <p class="dim">${esc(R.name)}　${r.mode === 'defend' ? '防衛戦' : '攻略戦'}</p>
    <div class="res-grid">
      <div class="kv"><span>討ち取った数</span><b>${r.kills}</b></div>
      <div class="kv"><span>味方の戦果</span><b>${r.allyKills}</b></div>
      <div class="kv"><span>残り体力</span><b>${r.hpLeft} / ${r.maxHp}</b></div>
      <div class="kv"><span>失った兵</span><b>${r.alliesLost} / ${r.alliesTotal}</b></div>
      <div class="kv"><span>得た戦功</span><b class="good">+${r.valor}</b></div>
      <div class="kv"><span>累計戦功</span><b>${fmt(G.valor)}（${ri.name}）</b></div>
    </div>
    <ul class="res-lines">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    ${before !== G.rank ? '<p class="promo">率いられる兵と装飾スロットを確かめましょう（身上書）。</p>' : ''}`;
  openPanel('panel-result');
}
let pendingFaction = null;

/* ===================== 月送り ===================== */
function doEndTurn() {
  if (G.ap > 0) {
    confirmDlg(`まだ行動力が ${G.ap} 残っています。月を送りますか？`, () => runEndTurn(), '月を送る');
  } else runEndTurn();
}

function runEndTurn() {
  const report = endTurn();
  Sfx.turn();
  pendingInvasion = report.invasion || null;
  if (pendingInvasion) pendingFaction = pendingInvasion.faction;

  const s = seasonOf(G.month);
  const g = report.gains;
  const oreRows = Object.keys(report.ores || {}).filter((k) => report.ores[k] >= 0.05)
    .map((k) => `<span class="ore-chip" style="--c:${ORES[k].color}">${ORES[k].name} +${fmt1(report.ores[k])}</span>`).join('');

  $('turn-title').innerHTML = `${G.year}年 ${G.month}月　<small style="color:${s.color}">${s.name}・${s.note}</small>`;
  $('turn-body').innerHTML = `
    <div class="turn-res">
      ${[['🪙 金貨', g.gold], ['🌾 食料', g.food], ['🪵 木材', g.wood], ['🪨 石材', g.stone]]
        .map(([k, v]) => `<div class="tr"><span>${k}</span><b class="${v < 0 ? 'bad' : 'good'}">${v >= 0 ? '+' : ''}${v}</b></div>`).join('')}
    </div>
    ${oreRows ? `<div class="turn-ore"><b>⛏️ 鉱石</b> ${oreRows}</div>` : ''}
    ${report.event ? `<div class="turn-event"><span class="te-i">${report.event.icon}</span>
      <span><b>${report.event.name}</b><small>${esc(report.event.text)}</small></span></div>` : ''}
    ${report.news.length ? `<ul class="turn-news">${report.news.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${pendingInvasion ? `<div class="turn-alarm">⚔️ ${FACTIONS[pendingInvasion.faction].name} が
      ${REGION_BY_ID[pendingInvasion.to].name} に迫っている！</div>` : ''}
    <div class="turn-foot">
      <span>兵 ${G.troops} / ${troopCap()}</span>
      <span>民心 ${G.loyalty}</span>
      <span>練度 ${G.drill}</span>
      <span>領地 ${ownedRegions().length} / ${REGIONS.length}</span>
    </div>`;
  Realm.refreshHUD();
  openPanel('panel-turn');
}

/* ===================== 決着 ===================== */
function checkVictory() {
  if (ownedRegions().length === 0) { showDefeat(); return; }
  if (!G.won) return;
  const ri = rankInfo();
  $('confirm-text').innerHTML = `
    <h3>👑 大陸統一</h3>
    <p>${esc(G.lord)}（${ri.name}）は、16すべての領地を手中に収めた。<br>
    エルデンマルクに、ようやく一つの王冠が戻った。</p>
    <div class="res-grid">
      <div class="kv"><span>かかった月数</span><b>${G.turn}</b></div>
      <div class="kv"><span>累計戦功</span><b>${fmt(G.valor)}</b></div>
      <div class="kv"><span>討ち取った敵</span><b>${G.stats.kills}</b></div>
      <div class="kv"><span>打った鎧</span><b>${G.stats.forged}</b></div>
    </div>`;
  $('confirm-yes').classList.add('hidden');
  $('confirm-no').textContent = 'とじる';
  confirmCb = null;
  openPanel('panel-confirm');
  Sfx.win();
  G.won = false;   // 一度だけ表示する
  Save.save();
}

function showDefeat() {
  const ri = rankInfo();
  $('confirm-text').innerHTML = `
    <h3>🏳️ 落 城</h3>
    <p>${esc(G.lord)}（${ri.name}）は、ついにすべての領地を失った。<br>
    エルデンマルクの片隅で、その名は忘れられていく。</p>
    <div class="res-grid">
      <div class="kv"><span>もちこたえた月数</span><b>${G.turn}</b></div>
      <div class="kv"><span>累計戦功</span><b>${fmt(G.valor)}</b></div>
    </div>
    <p class="dim">はじめからやり直しますか？</p>`;
  $('confirm-yes').textContent = 'はじめからやり直す';
  $('confirm-yes').classList.remove('hidden');
  $('confirm-no').textContent = 'とじる';
  confirmCb = () => { Save.wipe(); location.reload(); };
  openPanel('panel-confirm');
  Sfx.lose();
}

window.addEventListener('DOMContentLoaded', boot);
