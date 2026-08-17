/* =========================================================================
   GACHA STRIKERS ― 起動・画面遷移・試合結果
   ========================================================================= */

const R = { canvas: null, ctx: null, w: 960, h: 600, dpr: 1 };

const Main = {
  screen: 'title',      // title | garden | match
  last: 0,
  isTouch: false,

  init() {
    R.canvas = $('game');
    R.ctx = R.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));

    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    Input.init();
    this.bindUI();
    TeamUI.initEvents();

    if (Save.load()) $('btn-continue').classList.remove('hidden');
    $('club-name').textContent = G.clubName;

    requestAnimationFrame((t) => { this.last = t; this.loop(t); });
  },

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = R.canvas.clientWidth || window.innerWidth;
    const h = R.canvas.clientHeight || window.innerHeight;
    R.dpr = dpr; R.w = w; R.h = h;
    R.canvas.width = Math.round(w * dpr);
    R.canvas.height = Math.round(h * dpr);
    R.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  /* ---------- 画面 ---------- */
  gotoGarden(fromMatch) {
    UI.hideAll();
    UI.wipe(() => {
      this.screen = 'garden';
      $('screen-title').classList.add('hidden');
      $('match-hud').classList.add('hidden');
      $('garden-hud').classList.remove('hidden');
      Match.M = null;
      autoLineup();
      Garden.init();
      Garden.syncNpcs();
      updateWallet();
      this.updateTouchUI();
      Sound.playBgm('garden');
      Save.save();
    });
  },

  startMatch(stage) {
    UI.hideAll();
    UI.wipe(() => {
      this.screen = 'match';
      $('garden-hud').classList.add('hidden');
      $('match-hud').classList.remove('hidden');
      $('interact-prompt').classList.add('hidden');
      Garden.near = null;
      Match.start(stage);
      this.updateTouchUI();
    });
  },

  updateTouchUI() {
    const t = $('touch');
    if (!this.isTouch || this.screen === 'title') { t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    const inMatch = this.screen === 'match';
    $('touch-btns').classList.toggle('hidden', !inMatch);
    $('t-e').classList.toggle('hidden', inMatch);
  },

  /* ---------- ループ ---------- */
  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000) || 0;
    this.last = now;
    const ctx = R.ctx;

    if (Input.pressed('menu')) {
      if (UI.anyOpen()) UI.hideTop();
      else if (this.screen === 'match') UI.show('panel-menu');
      else if (this.screen === 'garden') UI.show('panel-menu');
    }

    if (this.screen === 'garden') {
      if (!UI.anyOpen() && $('gacha-stage').classList.contains('hidden')) Garden.update(dt);
      ctx.clearRect(0, 0, R.w, R.h);
      Garden.draw(ctx);
    } else if (this.screen === 'match') {
      const paused = UI.anyOpen();
      if (!paused && Match.M && Match.M.phase !== 'end') Match.update(dt);
      ctx.clearRect(0, 0, R.w, R.h);
      Match.draw(ctx);
    } else {
      ctx.clearRect(0, 0, R.w, R.h);
    }

    Input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  },

  /* ---------- ハーフタイム ---------- */
  showHalftime() {
    const M = Match.M;
    const you = M.score.home, them = M.score.away;
    const verdict = you > them ? 'リードして折り返す。この形を続けよう。'
      : you < them ? 'ビハインド。前に人数をかけて取り返す。'
      : '互角。ここからが勝負。';
    $('half-body').innerHTML = `
      <div class="hb-score">${you} - ${them}</div>
      <div class="hb-names">${M.home.name}　vs　${M.away.name}</div>
      <p>${verdict}</p>
      <p style="font-size:12px;color:#91a6c0">後半はコートチェンジ。攻める向きが入れ替わります。</p>`;
    UI.show('panel-half');
  },

  /* ---------- 試合終了 ---------- */
  finishMatch() {
    const M = Match.M;
    if (M.resultShown) return;
    M.resultShown = true;
    Sound.stopBgm();
    const stage = M.stage;
    const gf = M.score.home, ga = M.score.away;
    const win = gf > ga, draw = gf === ga;

    let tickets = win ? stage.tickets : draw ? Math.max(1, Math.floor(stage.tickets / 3)) : 0;
    let firstBonus = 0;
    if (win && !G.cleared[stage.id]) firstBonus = stage.first;
    G.tickets += tickets + firstBonus;

    if (win) {
      const rec = G.cleared[stage.id] || { wins: 0 };
      rec.wins++;
      G.cleared[stage.id] = rec;
    }
    G.stats.matches++;
    if (win) G.stats.wins++; else if (draw) G.stats.draws++; else G.stats.losses++;
    G.stats.gf += gf; G.stats.ga += ga;

    // 経験値
    const expBase = GROWTH.matchExp(stage, win);
    const levelUps = [];
    M.players.filter((p) => p.team.key === M.userTeam && p.rec).forEach((p) => {
      const gain = Math.round(expBase + p.goals * 22 + p.actions * 1.4);
      const before = p.rec.lv;
      const ups = grantExp(p.rec, gain);
      if (ups > 0) levelUps.push({ char: p.char, from: before, to: p.rec.lv });
    });

    // MVP
    const mine = M.players.filter((p) => p.team.key === M.userTeam);
    const mvp = mine.slice().sort((a, b) => (b.goals * 12 + b.actions) - (a.goals * 12 + a.actions))[0];

    Save.save();
    updateWallet();

    const verdict = win ? 'WIN' : draw ? 'DRAW' : 'LOSE';
    const vclass = win ? 'win' : draw ? 'draw' : 'lose';
    const scorers = M.events.map((e) =>
      `<div class="scorer-row">${e.minute}' <b style="color:${e.team === 'home' ? '#ffd23f' : '#ff5f7e'}">${e.name}</b>
       ${e.superShot ? '<span style="color:#35e0ff">必殺シュート</span>' : ''}（${e.team === 'home' ? M.home.name : M.away.name}）</div>`).join('');

    $('result-body').innerHTML = `
      <div class="result-hero">
        <div class="rh-verdict ${vclass}">${verdict}</div>
        <div class="rh-score">${gf} - ${ga}</div>
        <div class="rh-teams">${M.home.name}　vs　${M.away.name}</div>
      </div>
      ${mvp ? `<div class="mvp-box"><div class="mvp-av" id="mvp-av"></div>
        <div><div class="mvp-lab">MAN OF THE MATCH</div>
        <div class="mvp-name">${mvp.name}</div>
        <div class="mvp-line">${mvp.goals} ゴール ／ ${mvp.tackles} 奪取 ／ ${mvp.passes} パス</div></div></div>` : ''}
      <div class="reward-row">
        <div class="reward-chip"><div class="rc-lab">獲得チケット</div><div class="rc-val">🎟️ ${tickets}</div></div>
        ${firstBonus ? `<div class="reward-chip bonus"><div class="rc-lab">初回クリア</div><div class="rc-val">🎟️ +${firstBonus}</div></div>` : ''}
        <div class="reward-chip"><div class="rc-lab">経験値</div><div class="rc-val" style="color:#35e0ff">+${expBase}</div></div>
        <div class="reward-chip"><div class="rc-lab">所持チケット</div><div class="rc-val">🎟️ ${G.tickets}</div></div>
      </div>
      ${levelUps.length ? `<div class="result-list"><h4>レベルアップ</h4>
        ${levelUps.map((l) => `<div class="lvup-row">${l.char.name}　Lv${l.from} <span class="arrow">→</span> <b>Lv${l.to}</b></div>`).join('')}</div>` : ''}
      ${scorers ? `<div class="result-list"><h4>ゴール</h4>${scorers}</div>` : '<div class="result-list"><h4>ゴール</h4><div class="scorer-row">両チーム無得点</div></div>'}
      ${win && firstBonus && stage.id < STAGES.length ? `<div class="result-list"><div class="scorer-row" style="color:#3ddc97">次のステージが解放されました。</div></div>` : ''}`;

    if (mvp) $('mvp-av').appendChild(portraitCanvas(mvp.char, 52, 52, { plain: true }));
    Sound.sfx(win ? 'rare5' : draw ? 'rare3' : 'error');
    UI.show('panel-result');
  },

  /* ---------- UI 配線 ---------- */
  bindUI() {
    $('btn-newgame').onclick = () => {
      Sound.resume();
      const go = () => { newGame(); this.gotoGarden(); UI.toast('チケット5枚でスタート！ ガチャショップへ', 'good'); };
      if (Save.exists()) UI.confirm('いまのセーブデータを消して最初から始めます。よろしいですか？', go);
      else go();
    };
    $('btn-continue').onclick = () => { Sound.resume(); this.gotoGarden(); };
    $('btn-title-help').onclick = () => UI.show('panel-help');

    $$('[data-close]').forEach((b) => { b.onclick = () => UI.hide(b.dataset.close); });

    $('btn-help').onclick = () => UI.show('panel-help');
    $('btn-mute').onclick = () => {
      Sound.setMuted(!G.muted);
      $('btn-mute').textContent = G.muted ? '🔇' : '🔊';
      Save.save();
    };
    $('btn-match-menu').onclick = () => UI.show('panel-menu');
    $('btn-menu-help').onclick = () => UI.show('panel-help');
    $('btn-menu-abandon').onclick = () => {
      UI.confirm('この試合を放棄して庭にもどります。報酬はもらえません。', () => {
        UI.hide('panel-menu');
        Sound.stopBgm();
        this.gotoGarden();
      });
    };
    $('btn-menu-reset').onclick = () => {
      UI.confirm('セーブデータをすべて消します。集めた選手も戻せません。よろしいですか？', () => {
        Save.wipe();
        location.reload();
      });
    };

    // ガチャ
    $('btn-pull1').onclick = () => GachaUI.pull(1);
    $('btn-pull10').onclick = () => GachaUI.pull(10);
    $('gacha-skip').onclick = () => GachaUI.reveal();
    $('gacha-fx').onclick = () => { if (!GachaUI.revealed) GachaUI.reveal(); };
    $('gacha-done').onclick = () => GachaUI.close();

    // ブリーフィング
    $('btn-brief-back').onclick = () => UI.hide('panel-brief');
    $('btn-brief-team').onclick = () => TeamUI.open();
    $('btn-kickoff').onclick = () => {
      if (!lineupComplete()) {
        UI.confirm('編成に空きがあります。人数が足りない状態で試合を始めますか？', () => this.startMatch(BriefUI.stage));
        return;
      }
      this.startMatch(BriefUI.stage);
    };

    // ハーフタイム・結果
    $('btn-half-go').onclick = () => {
      UI.hide('panel-half');
      Match.setupKickoff(Match.M.score.home >= Match.M.score.away ? 'away' : 'home');
    };
    $('btn-result-garden').onclick = () => { UI.hide('panel-result'); this.gotoGarden(true); };
    $('btn-result-retry').onclick = () => {
      const stage = Match.M.stage;
      UI.hide('panel-result');
      UI.wipe(() => { Match.start(stage); });
    };

    // パネルの背景クリックで閉じる
    $$('.panel').forEach((p) => {
      p.addEventListener('mousedown', (ev) => {
        if (ev.target === p && p.id !== 'panel-confirm' && p.id !== 'panel-result' && p.id !== 'panel-half') UI.hide(p.id);
      });
    });
  },
};

function grantExp(rec, amount) {
  rec.exp += amount;
  let ups = 0;
  let guard = 0;
  while (rec.lv < maxLevel(rec) && rec.exp >= expToNext(rec.lv) && guard++ < 60) {
    rec.exp -= expToNext(rec.lv);
    rec.lv++; ups++;
  }
  if (rec.lv >= maxLevel(rec)) rec.exp = 0;
  return ups;
}

window.addEventListener('load', () => Main.init());
