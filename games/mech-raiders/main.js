/* =========================================================================
   MECH RAIDERS ― 画面遷移とゲームループ
   ========================================================================= */
'use strict';

(function () {
const C = window.MRCore, D = window.MRData;
const { el, clamp, fmtTime } = C;

const SCREENS = ['title', 'slot', 'settings', 'hangar', 'sector', 'howto', 'result', 'pause'];
const DEMO_BG = ['title', 'slot', 'settings', 'howto'];

class Game {
  constructor() {
    this.canvas = el('game');
    this.audio = new C.Audio2();
    this.input = new C.Input(this.canvas);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    C.Save.migrate();
    this.save = null;
    this.hangar = null;
    this.numPlayers = 1;
    this.screen = null;
    this.field = null;
    this.paused = false;
    this.lastT = 0;
    this.currentSector = null;
    this.slotMode = 'continue';

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

  /* ================= 画面 ================= */
  go(name) {
    for (const s of SCREENS) {
      const node = el('screen-' + s);
      if (node) node.classList.toggle('hidden', s !== name);
    }
    const prev = this.screen;
    this.screen = name;
    if (prev === 'hangar' && name !== 'hangar' && this.hangar) this.hangar.hide();
    el('hud').classList.add('hidden');

    const wantDemo = DEMO_BG.indexOf(name) >= 0;
    document.body.classList.toggle('demo', wantDemo);
    if (wantDemo) this.startDemo(); else this.stopDemo();
    this.audio.setScene('menu');

    if (name === 'hangar') { this.ensureHangar(); this.hangar.show(); }
    if (name === 'sector') this.renderSectors();
    if (name === 'slot') this.renderSlots();
    if (name === 'settings') this.renderSettings();
  }
  goPlay() {
    for (const s of SCREENS) { const n = el('screen-' + s); if (n) n.classList.add('hidden'); }
    document.body.classList.remove('demo');
    this.screen = 'play';
    el('hud').classList.remove('hidden');
  }

  ensureHangar() {
    if (!this.hangar) this.hangar = new window.MRHangar.Hangar(this);
    this.hangar.save = this.save;
  }

  /* ================= UI 配線 ================= */
  bindUI() {
    const tap = (id, fn) => { const n = el(id); if (n) n.addEventListener('click', fn); };

    tap('btn-newgame', () => { this.audio.ensure(); this.audio.sfx('uiBig'); this.slotMode = 'new'; this.go('slot'); });
    tap('btn-continue', () => { this.audio.ensure(); this.audio.sfx('uiBig'); this.slotMode = 'continue'; this.go('slot'); });
    tap('btn-settings', () => { this.audio.ensure(); this.go('settings'); });
    tap('btn-howto', () => { this.audio.ensure(); this.go('howto'); });
    for (const b of document.querySelectorAll('[data-back="title"]')) b.addEventListener('click', () => this.go('title'));

    tap('btn-mute', () => {
      this.audio.ensure();
      this.audio.update({ muted: !this.audio.set.muted });
      this.refreshMuteLabel();
      this.renderSettings();
    });
    this.refreshMuteLabel();

    tap('btn-hangar-back', () => this.go('title'));
    tap('btn-tosector', () => { this.audio.sfx('uiBig'); this.go('sector'); });
    tap('btn-sector-back', () => this.go('hangar'));
    tap('btn-training', () => { this.audio.sfx('uiBig'); this.startMission(D.TRAINING); });

    tap('btn-resume', () => this.setPause(false));
    tap('btn-restart', () => { this.setPause(false); this.startMission(this.currentSector); });
    tap('btn-abort', () => { this.setPause(false); this.field = null; this.go('hangar'); });

    tap('btn-again', () => this.startMission(this.currentSector));
    tap('btn-tohangar', () => this.go('hangar'));
    tap('btn-tosectors', () => this.go('sector'));

    tap('btn-set-slots', () => { this.slotMode = 'continue'; this.go('slot'); });
    tap('btn-set-erase', () => {
      if (!this.save) return;
      if (!confirm(`スロット ${C.Save.slot} のデータを消す。よいか？`)) return;
      C.Save.erase(C.Save.slot);
      this.save = null;
      if (this.hangar) this.hangar.save = null;
      this.go('title');
    });

    /* 人数切替 */
    const pl = el('hg-players');
    if (pl) pl.addEventListener('click', (e) => {
      const b = e.target.closest('.pbtn'); if (!b) return;
      this.numPlayers = Number(b.dataset.n);
      for (const x of pl.querySelectorAll('.pbtn')) x.classList.toggle('on', x === b);
      this.audio.sfx('ui');
      if (this.hangar) this.hangar.show();
    });

    /* 設定のスライダとトグル */
    const slider = (id, key) => {
      const n = el(id); if (!n) return;
      n.addEventListener('input', () => {
        this.audio.ensure();
        const v = Number(n.value) / 100;
        this.audio.update({ [key]: v });
        el(id + '-v').textContent = n.value;
      });
    };
    slider('set-master', 'master');
    slider('set-sfx', 'sfx');
    slider('set-bgm', 'bgm');
    const seg = (id, key, invert) => {
      const n = el(id); if (!n) return;
      n.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        this.audio.ensure();
        this.audio.update({ [key]: b.dataset.v === '1' });
        this.audio.sfx('ui');
        this.renderSettings();
        this.refreshMuteLabel();
      });
    };
    seg('seg-bgm', 'bgmOn');
    seg('seg-mute', 'muted');

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.screen === 'play') { e.preventDefault(); this.setPause(!this.paused); }
    });
    /* 最初のクリック/キーで音を起こす（ブラウザの制限） */
    const wake = () => { this.audio.ensure(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  refreshMuteLabel() {
    const n = el('btn-mute');
    if (n) n.textContent = this.audio.set.muted ? '🔇 音 OFF' : '🔊 音 ON';
  }

  /* ================= セーブスロット ================= */
  renderSlots() {
    const isNew = this.slotMode === 'new';
    el('slot-title').textContent = isNew ? 'ニューゲーム ― 保存先を選ぶ' : '続きから ― データを選ぶ';
    el('slot-lead').textContent = isNew
      ? '新しく始める枠を選ぶ。使用中の枠を選ぶと、そのデータは上書きされる。'
      : '続きから遊ぶデータを選ぶ。データがない枠は「はじめる」で新規作成できる。';

    const box = el('slot-list');
    box.innerHTML = C.Save.list().map(({ i, info }) => {
      const fmt = (t) => {
        if (!t) return '―';
        const d = new Date(t);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      const hhmm = (s) => `${Math.floor(s / 3600)}時間${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}分`;
      if (!info) {
        return `<div class="slot-card pick" data-slot="${i}" data-act="new">
          <div class="slot-no">0${i}</div>
          <div class="slot-name">スロット ${i}</div>
          <div class="slot-sub">EMPTY</div>
          <p class="slot-empty">データなし。ここから新しく始める。</p>
          <div class="slot-acts"><span class="btn btn-main">はじめる</span></div>
        </div>`;
      }
      return `<div class="slot-card ${isNew ? '' : 'pick'}" data-slot="${i}" data-act="${isNew ? 'over' : 'load'}">
        <div class="slot-no">0${i}</div>
        <div class="slot-name">スロット ${i}</div>
        <div class="slot-sub">${fmt(info.updated)}</div>
        <div class="slot-rows">
          <div><span>制圧セクター</span><b>${info.cleared} / ${D.SECTORS.length}</b></div>
          <div><span>累計撃破</span><b>${info.kills}</b></div>
          <div><span>所持</span><b>⬢ ${info.scrap.toLocaleString()}　◆ ${info.tickets}</b></div>
          <div><span>プレイ時間</span><b>${hhmm(info.playtime)}</b></div>
        </div>
        <div class="slot-acts">
          ${isNew
            ? `<button class="btn btn-main" data-act="over" data-slot="${i}">上書きして始める</button>`
            : `<button class="btn btn-main" data-act="load" data-slot="${i}">続きから</button>`}
          <button class="btn btn-ghost" data-act="del" data-slot="${i}">消す</button>
        </div>
      </div>`;
    }).join('');

    if (!box._bound) {
      box._bound = true;
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        const i = Number(btn.dataset.slot);
        if (act === 'del') {
          e.stopPropagation();
          if (!confirm(`スロット ${i} のデータを消す。よいか？`)) return;
          C.Save.erase(i); this.audio.sfx('ui'); this.renderSlots(); return;
        }
        if (act === 'over') {
          if (!confirm(`スロット ${i} を上書きして新しく始める。よいか？`)) return;
          this.openSlot(C.Save.create(i)); return;
        }
        if (act === 'new') { this.openSlot(C.Save.create(i)); return; }
        if (act === 'load') { this.openSlot(C.Save.open(i)); return; }
      });
    }
  }
  openSlot(data) {
    this.save = data;
    if (this.hangar) { this.hangar.save = data; this.hangar.pid = 1; this.hangar.tab = 'loadout'; }
    this.audio.sfx('uiBig');
    this.go('hangar');
  }

  /* ================= 設定 ================= */
  renderSettings() {
    const s = this.audio.set;
    const put = (id, v) => { const n = el(id); if (n) { n.value = Math.round(v * 100); el(id + '-v').textContent = Math.round(v * 100); } };
    put('set-master', s.master); put('set-sfx', s.sfx); put('set-bgm', s.bgm);
    const seg = (id, on) => {
      const n = el(id); if (!n) return;
      for (const b of n.querySelectorAll('button')) b.classList.toggle('on', (b.dataset.v === '1') === !!on);
    };
    seg('seg-bgm', s.bgmOn);
    seg('seg-mute', s.muted);
    const info = el('set-slotinfo');
    if (info) {
      info.textContent = this.save
        ? `いま開いているのはスロット ${C.Save.slot}。制圧 ${Object.keys(this.save.cleared).length} / ${D.SECTORS.length} セクター、⬢ ${this.save.scrap.toLocaleString()}、◆ ${this.save.tickets}。`
        : 'まだデータを開いていない。タイトルから「ニューゲーム」か「続きから」を選ぶ。';
    }
    const er = el('btn-set-erase');
    if (er) er.disabled = !this.save;
  }

  /* ================= デモ映像 ================= */
  startDemo() {
    if (this.field && this.field.demo) return;
    if (this.field && !this.field.demo) return;   // 戦闘中はデモを出さない
    const sector = D.SECTORS[Math.floor(Math.random() * 3)];
    const demoSave = C.defaultSave();
    const frames = D.FRAMES.map((f) => f.id);
    const weps = D.WEAPONS.map((w) => w.id);
    const cores = D.CORES.map((c) => c.id);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const fid = pick(frames);
    demoSave.frames[fid] = { lv: 8, lb: 2, n: 1 };
    const mainW = pick(weps), subW = pick(weps);
    demoSave.weapons[mainW] = { lv: 8, lb: 2, n: 1 };
    demoSave.weapons[subW] = { lv: 8, lb: 2, n: 1 };
    const co = pick(cores);
    demoSave.cores[co] = { lv: 5, lb: 1, n: 1 };
    demoSave.loadout[1] = { frame: fid, main: mainW, sub: subW, core: co };
    this.resize();
    this.field = new window.MRBattle.Field({
      canvas: this.canvas, input: this.input, audio: this.audio,
      save: demoSave, sector, numPlayers: 1, dpr: this.dpr, demo: true,
      onEnd: () => {}, onHud: () => {},
    });
    this.demoT = 0;
  }
  stopDemo() { if (this.field && this.field.demo) this.field = null; }

  /* ================= セクター ================= */
  unlocked(i) {
    if (i === 0) return true;
    return !!this.save.cleared[D.SECTORS[i - 1].id];
  }
  renderSectors() {
    if (!this.save) return this.go('title');
    const box = el('sector-list');
    box.innerHTML = D.SECTORS.map((s, i) => {
      const open = this.unlocked(i);
      const cl = this.save.cleared[s.id];
      const tags = s.objectives.map((o) =>
        ({ kill_all: '殲滅', towers: `通信塔 ${s.towers}`, crates: `コンテナ ${s.crates}`, commander: '指揮官機' }[o] || o));
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
        this.audio.ensure(); this.audio.sfx('uiBig');
        this.startMission(D.getSector(c.dataset.sector));
      });
    }
  }

  /* ================= 出撃 ================= */
  startMission(sector) {
    if (!this.save) return this.go('title');
    this.audio.ensure();
    this.currentSector = sector;
    this.field = null;
    this.resize();
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
    this.audio.setScene('battle');
    this.goPlay();
  }

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
      const order = { S: 4, A: 3, B: 2, C: 1 };
      const prev = this.save.cleared[s.id];
      if (!prev) this.save.cleared[s.id] = { best: res.time, rank: res.rank };
      else {
        if (res.time < prev.best) prev.best = res.time;
        if (order[res.rank] > order[prev.rank]) prev.rank = res.rank;
      }
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

  /* ================= HUD ================= */
  updateHud(f) {
    el('hud-sector').textContent = `${f.sector.name} ― ${f.sector.sub}`;
    el('hud-time').textContent = fmtTime(f.time);
    el('hud-scrap').textContent = f.training ? '練習' : f.reward.scrap.toLocaleString();
    const kh = el('keyhint');
    const faded = f.time > 18;
    if (kh._faded !== faded) { kh._faded = faded; kh.classList.toggle('faded', faded); }

    const ul = el('hud-objectives');
    let html;
    if (f.training) {
      const st = f.trainStats;
      html = [
        `<li class="stat">与ダメージ合計 ${Math.round(st.dmg).toLocaleString()}</li>`,
        `<li class="stat">現在 DPS ${Math.round(st.dps).toLocaleString()}（最高 ${Math.round(st.peak).toLocaleString()}）</li>`,
        `<li class="stat">撃破 ${st.kills}</li>`,
        `<li class="stat">Esc → 撤退で格納庫へ戻る</li>`,
      ].join('');
    } else {
      const preDone = f.objectives.filter((o) => o.id !== 'boss').every((o) => o.done >= o.need);
      html = f.objectives.map((o) => {
        const label = D.OBJ_LABEL[o.id] ? D.OBJ_LABEL[o.id](Math.min(o.done, o.need), o.need) : o.id;
        const cls = o.done >= o.need ? 'done' : (o.id === 'boss' && !preDone) ? 'lock' : '';
        return `<li class="${cls}">${label}</li>`;
      }).join('');
    }
    if (ul._html !== html) { ul.innerHTML = html; ul._html = html; }

    const bb = el('boss-bar');
    if (f.boss && !f.boss.dead) {
      bb.classList.remove('hidden');
      this.audio.setScene('boss');
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
      node.querySelector('.rfill').style.transform =
        `scaleX(${1 - clamp(m.rollCd / Math.max(0.01, m.lo.rollCd), 0, 1)})`;
    }
  }

  /* ================= ループ ================= */
  loop(t) {
    requestAnimationFrame((n) => this.loop(n));
    const dt = clamp((t - this.lastT) / 1000 || 0, 0, 0.05);
    this.lastT = t;
    const f = this.field;
    if (f && !this.paused) { f.update(dt); if (this.field === f) f.draw(); }
    else if (f && this.paused) f.draw();
    /* プレイ時間を貯めて、たまに書き出す */
    if (this.save && this.screen === 'play') {
      this.save.playtime += dt;
      this._ptAcc = (this._ptAcc || 0) + dt;
      if (this._ptAcc > 20) { this._ptAcc = 0; C.Save.save(); }
    }
    this.input.endFrame();
  }
}

window.addEventListener('DOMContentLoaded', () => { window.GAME = new Game(); });
})();
