/* =========================================================================
   MECH RAIDERS ― 画面遷移とゲームループ
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData;
const { el, show, hide, clamp, fmtTime } = C;

class Game {
  constructor() {
    this.canvas = el('game');
    this.save = C.Save.load();
    this.audio = new C.Audio2();
    this.audio.setMuted(!!this.save.muted);
    this.input = new C.Input(this.canvas);
    this.numPlayers = 1;
    this.screen = null;
    this.field = null;
    this.paused = false;
    this.lastT = 0;
    this.raf = null;
    this.currentSector = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.hangar = new window.MRHangar.Hangar(this);
    this.bindUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.go('title');
    this.loop(performance.now());
  }

  resize() {
    const cv = this.canvas;
    const w = cv.clientWidth || window.innerWidth;
    const h = cv.clientHeight || window.innerHeight;
    cv.width = Math.round(w * this.dpr);
    cv.height = Math.round(h * this.dpr);
    if (this.field) this.field.dpr = this.dpr;
  }

  /* ---------------- 画面 ---------------- */
  go(name) {
    const screens = ['title', 'hangar', 'sector', 'howto', 'result', 'pause'];
    for (const s of screens) {
      const node = el('screen-' + s);
      if (node) node.classList.toggle('hidden', s !== name);
    }
    const prev = this.screen;
    this.screen = name;
    if (prev === 'hangar' && name !== 'hangar') this.hangar.hide();
    el('hud').classList.add('hidden');
    if (name === 'hangar') this.hangar.show();
    if (name === 'sector') this.renderSectors();
  }
  goPlay() {
    for (const s of ['title', 'hangar', 'sector', 'howto', 'result', 'pause']) {
      const node = el('screen-' + s); if (node) node.classList.add('hidden');
    }
    this.screen = 'play';
    el('hud').classList.remove('hidden');
  }

  bindUI() {
    el('btn-solo').addEventListener('click', () => { this.audio.ensure(); this.numPlayers = 1; this.audio.sfx('uiBig'); this.go('hangar'); });
    el('btn-duo').addEventListener('click', () => { this.audio.ensure(); this.numPlayers = 2; this.audio.sfx('uiBig'); this.go('hangar'); });
    el('btn-howto').addEventListener('click', () => { this.audio.ensure(); this.go('howto'); });
    for (const b of document.querySelectorAll('[data-back="title"]')) b.addEventListener('click', () => this.go('title'));
    el('btn-hangar-back').addEventListener('click', () => this.go('title'));
    el('btn-tosector').addEventListener('click', () => { this.audio.sfx('uiBig'); this.go('sector'); });
    el('btn-sector-back').addEventListener('click', () => this.go('hangar'));

    el('btn-mute').addEventListener('click', () => {
      this.save.muted = !this.save.muted;
      this.audio.setMuted(this.save.muted);
      el('btn-mute').textContent = this.save.muted ? '🔇 音 OFF' : '🔊 音 ON';
      C.Save.save();
    });
    el('btn-mute').textContent = this.save.muted ? '🔇 音 OFF' : '🔊 音 ON';

    el('btn-reset').addEventListener('click', () => {
      if (!confirm('保存データ（所持装備・改造・クリア記録）をすべて消す。よいか？')) return;
      this.save = C.Save.reset();
      this.hangar.save = this.save;
      location.reload();
    });

    el('btn-resume').addEventListener('click', () => this.setPause(false));
    el('btn-restart').addEventListener('click', () => { this.setPause(false); this.startMission(this.currentSector); });
    el('btn-abort').addEventListener('click', () => { this.setPause(false); this.stopMission(); this.go('hangar'); });

    el('btn-again').addEventListener('click', () => this.startMission(this.currentSector));
    el('btn-tohangar').addEventListener('click', () => this.go('hangar'));
    el('btn-tosectors').addEventListener('click', () => this.go('sector'));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.screen === 'play') { e.preventDefault(); this.setPause(!this.paused); }
    });
  }

  /* ---------------- セクター ---------------- */
  unlocked(i) {
    if (i === 0) return true;
    const prev = D.SECTORS[i - 1];
    return !!this.save.cleared[prev.id];
  }
  renderSectors() {
    const box = el('sector-list');
    box.innerHTML = D.SECTORS.map((s, i) => {
      const open = this.unlocked(i);
      const cl = this.save.cleared[s.id];
      const tags = [];
      for (const o of s.objectives) {
        tags.push({ kill_all: '殲滅', towers: `通信塔 ${s.towers}`, crates: `コンテナ ${s.crates}`, commander: '指揮官機' }[o] || o);
      }
      const bossName = s.boss ? D.BOSSES[s.boss].name : null;
      return `<button class="sector-card ${open ? '' : 'locked'}" data-sector="${s.id}" ${open ? '' : 'disabled'}>
        <div class="sc-no">${String(s.no).padStart(2, '0')}</div>
        <div class="sc-name">${open ? s.name : '？？？'}</div>
        <div class="sc-sub">${open ? s.sub : 'LOCKED'}</div>
        <div class="sc-brief">${open ? s.brief : '前のセクターを制圧すると解放される。'}</div>
        <div class="sc-tags">
          ${tags.map((t) => `<span class="sc-tag">${t}</span>`).join('')}
          ${bossName ? `<span class="sc-tag boss">BOSS ${open ? bossName : '？？？'}</span>` : ''}
        </div>
        <div class="sc-foot">
          <span>推奨 Lv.${s.lv}・敵 ${s.count} 機　◆${s.tickets}　⬢${s.scrapBonus}</span>
          <span class="sc-rank rank-${cl ? cl.rank : ''}">${cl ? cl.rank : ''}</span>
        </div>
      </button>`;
    }).join('');
    if (!box._bound) {
      box._bound = true;
      box.addEventListener('click', (e) => {
        const c = e.target.closest('.sector-card'); if (!c || c.disabled) return;
        const s = D.getSector(c.dataset.sector);
        this.audio.ensure(); this.audio.sfx('uiBig');
        this.startMission(s);
      });
    }
  }

  /* ---------------- 出撃 ---------------- */
  startMission(sector) {
    this.currentSector = sector;
    this.resize();
    this.stopMission();
    this.field = new window.MRBattle.Field({
      canvas: this.canvas, input: this.input, audio: this.audio,
      save: this.save, sector, numPlayers: this.numPlayers, dpr: this.dpr,
      onEnd: (res) => this.onMissionEnd(res),
      onHud: (f) => this.updateHud(f),
    });
    this.paused = false;
    el('pstat-2').classList.toggle('hidden', this.numPlayers < 2);
    el('pstat-2').classList.add('p2side');
    el('boss-bar').classList.add('hidden');
    el('keyhint').innerHTML = this.numPlayers < 2
      ? '<span><kbd>WASD</kbd> 移動</span><span><kbd>マウス</kbd> 照準・射撃</span><span><kbd>Space</kbd> ローリング</span><span><kbd>Q</kbd> 必殺</span><span><kbd>E</kbd> 武器切替</span><span><kbd>Tab</kbd> ロック</span><span><kbd>Esc</kbd> 中断</span>'
      : '<span>P1 <kbd>WASD</kbd>+<kbd>マウス</kbd> / <kbd>Space</kbd>ローリング / <kbd>Q</kbd>必殺 / <kbd>E</kbd>切替</span><span>P2 <kbd>↑↓←→</kbd> / <kbd>RShift</kbd>射撃 / <kbd>/</kbd>ローリング / <kbd>,</kbd>必殺 / <kbd>M</kbd>切替 / <kbd>N</kbd>ロック</span>';
    this.goPlay();
  }
  stopMission() { this.field = null; }

  setPause(p) {
    if (!this.field) return;
    this.paused = p;
    el('screen-pause').classList.toggle('hidden', !p);
    if (p) el('pause-sector').textContent = `${this.currentSector.name} ― ${this.currentSector.sub}`;
    this.audio.sfx('ui');
  }

  onMissionEnd(res) {
    const s = this.currentSector;
    this.save.scrap += res.scrap;
    this.save.tickets += res.tickets;
    this.save.totalKills += res.kills;
    if (res.cleared) {
      const prev = this.save.cleared[s.id];
      const order = { S: 4, A: 3, B: 2, C: 1 };
      if (!prev || res.time < prev.best) {
        this.save.cleared[s.id] = {
          best: res.time,
          rank: !prev || order[res.rank] > order[prev.rank] ? res.rank : prev.rank,
        };
      } else if (order[res.rank] > order[prev.rank]) prev.rank = res.rank;
    }
    C.Save.save();

    el('result-rank').textContent = res.cleared ? res.rank : '―';
    el('result-rank').className = 'rank rank-' + (res.cleared ? res.rank : 'C');
    el('result-title').textContent = res.cleared ? '作戦成功' : '作戦失敗';
    el('result-sector').textContent = `${s.name} ― ${s.sub}`;
    el('result-time').textContent = fmtTime(res.time);
    el('result-kills').textContent = res.kills;
    el('result-scrap').textContent = '⬢ ' + res.scrap.toLocaleString();
    el('result-ticket').textContent = '◆ ' + res.tickets;
    el('result-players').innerHTML = res.players.map((p) =>
      `<div class="rp"><b>P${p.pid}　${p.frame}</b>撃破 ${p.kills} 機／与ダメージ ${p.dmg.toLocaleString()}</div>`).join('');
    this.field = null;
    this.go('result');
  }

  /* ---------------- HUD ---------------- */
  updateHud(f) {
    el('hud-sector').textContent = `${f.sector.name} ― ${f.sector.sub}`;
    el('hud-time').textContent = fmtTime(f.time);
    el('hud-scrap').textContent = f.reward.scrap.toLocaleString();
    const kh = el('keyhint');
    const faded = f.time > 18;
    if (kh._faded !== faded) { kh._faded = faded; kh.classList.toggle('faded', faded); }

    const ul = el('hud-objectives');
    const preDone = f.objectives.filter((o) => o.id !== 'boss').every((o) => o.done >= o.need);
    const html = f.objectives.map((o) => {
      const label = D.OBJ_LABEL[o.id] ? D.OBJ_LABEL[o.id](Math.min(o.done, o.need), o.need) : o.id;
      const cls = o.done >= o.need ? 'done' : (o.id === 'boss' && !preDone) ? 'lock' : '';
      return `<li class="${cls}">${label}</li>`;
    }).join('');
    if (ul._html !== html) { ul.innerHTML = html; ul._html = html; }

    /* ボスバー */
    const bb = el('boss-bar');
    if (f.boss && !f.boss.dead) {
      bb.classList.remove('hidden');
      if (bb._name !== f.boss.def.name) {
        bb._name = f.boss.def.name;
        el('bb-name').textContent = `${f.boss.def.name}　${f.boss.def.title}`;
        el('bb-parts').innerHTML = f.boss.parts.map(() => '<div class="bb-part"><i style="width:100%"></i></div>').join('');
      }
      const k = clamp(f.boss.hp / f.boss.maxHp, 0, 1);
      el('bb-fill').style.transform = `scaleX(${k})`;
      el('bb-ghost').style.transform = `scaleX(${k})`;
      el('bb-phase').textContent = `第${f.boss.phase}形態`;
      const nodes = el('bb-parts').children;
      f.boss.parts.forEach((p, i) => {
        const n = nodes[i]; if (!n) return;
        n.classList.toggle('dead', !p.alive);
        n.firstChild.style.width = `${clamp(p.hp / p.maxHp, 0, 1) * 100}%`;
      });
    } else bb.classList.add('hidden');

    /* プレイヤー */
    for (let i = 0; i < 2; i++) {
      const node = el('pstat-' + (i + 1));
      const m = f.players[i];
      if (!m) { node.classList.add('hidden'); continue; }
      node.classList.remove('hidden');
      const hp = node.querySelector('.bar.hp');
      const sp = node.querySelector('.bar.sp');
      const k = clamp(m.hp / m.maxHp, 0, 1);
      hp.classList.toggle('low', k < 0.34);
      hp.querySelector('.fill').style.transform = `scaleX(${k})`;
      hp.querySelector('.btxt').textContent = `${Math.max(0, Math.ceil(m.hp))} / ${Math.round(m.maxHp)}`;
      const sk = clamp(m.sp / m.spMax, 0, 1);
      sp.classList.toggle('full', sk >= 1);
      sp.querySelector('.fill').style.transform = `scaleX(${sk})`;
      sp.querySelector('.btxt').textContent = sk >= 1
        ? `必殺 READY ― ${D.SPECIALS[m.lo.special].name}`
        : `必殺 ${Math.floor(sk * 100)}%`;
      const fr = node.querySelector('.ps-frame');
      if (fr.textContent !== m.lo.frame.name) fr.textContent = m.lo.frame.name;
      const w = m.weapon;
      node.querySelector('.wname').textContent = w ? w.name : '―';
      const am = node.querySelector('.wammo');
      if (!w) am.textContent = '';
      else if (w.reloading > 0) { am.textContent = '再装填…'; am.classList.add('reload'); }
      else { am.classList.remove('reload'); am.textContent = w.mag > 0 ? `${Math.max(0, Math.ceil(w.ammo))} / ${w.mag}` : '∞'; }
      const rf = node.querySelector('.rfill');
      rf.style.transform = `scaleX(${1 - clamp(m.rollCd / Math.max(0.01, m.lo.rollCd), 0, 1)})`;
    }
  }

  /* ---------------- ループ ---------------- */
  loop(t) {
    this.raf = requestAnimationFrame((n) => this.loop(n));
    const dt = clamp((t - this.lastT) / 1000 || 0, 0, 0.05);
    this.lastT = t;
    const f = this.field;
    if (f && !this.paused) { f.update(dt); if (this.field === f) f.draw(); }
    else if (f && this.paused) f.draw();
    this.input.endFrame();
  }
}

window.addEventListener('DOMContentLoaded', () => { window.GAME = new Game(); });
})();
