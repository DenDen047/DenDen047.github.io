/* =========================================================================
   STEEL SERPENT ― エンティティ
   弾 / 近接判定 / 拾い物 / 破壊物 / プレイヤー / 敵 / ボス
   ========================================================================= */

/* ===================== 基本クラス ===================== */
class Actor {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0; this.face = 1;
    this.onGround = false; this.dead = false; this.hp = 1; this.maxHp = 1;
    this.flash = 0;
  }
  get box() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }
  get feet() { return this.y + this.h / 2; }
  get cx() { return this.x; }
  get cy() { return this.y; }

  /* 地形との当たり（X→Yの順に解決） */
  moveAndCollide(dt, gravity = 1900, opts = {}) {
    if (!opts.noGravity) this.vy = Math.min(this.vy + gravity * dt, 1500);
    const solids = GAME.solids;
    /* X */
    this.x += this.vx * dt;
    for (const s of solids) {
      if (s.oneway) continue;
      const b = this.box;
      if (!rectsOverlap(b, s)) continue;
      if (this.vx > 0) this.x = s.x - this.w / 2 - 0.01;
      else if (this.vx < 0) this.x = s.x + s.w + this.w / 2 + 0.01;
      this.vx = 0;
    }
    /* Y */
    const prevFeet = this.feet;
    this.y += this.vy * dt;
    this.onGround = false;
    for (const s of solids) {
      const b = this.box;
      if (!rectsOverlap(b, s)) continue;
      if (s.oneway) {
        if (this.vy < 0 || opts.dropThrough) continue;
        if (prevFeet > s.y + 6) continue;
      }
      if (this.vy > 0) { this.y = s.y - this.h / 2 - 0.01; this.vy = 0; this.onGround = true; }
      else if (this.vy < 0) { this.y = s.y + s.h + this.h / 2 + 0.01; this.vy = 0; }
    }
    this.x = clamp(this.x, this.w / 2, GAME.level.w - this.w / 2);
    if (this.y > GAME.level.h + 300) this.onFall && this.onFall();
  }
}

/* ===================== 弾 ===================== */
class Bullet {
  constructor(o) {
    Object.assign(this, {
      x: 0, y: 0, vx: 0, vy: 0, dmg: 10, owner: 'enemy', pierce: 0, life: 2.2, t: 0,
      color: '#ffe6a3', w: 7, rocket: false, tranq: false, splash: 0, grazed: false, hitList: null, bounce: 0,
    }, o);
    this.px = this.x; this.py = this.y;
    this.hitList = [];
  }
  update(dt) {
    this.t += dt;
    if (this.t > this.life) return false;
    this.px = this.x; this.py = this.y;
    if (this.rocket) { this.vy += 120 * dt; FX.smoke(this.x, this.y, 1, '#9aa5ad', 12, 7); }
    this.x += this.vx * dt; this.y += this.vy * dt;

    /* 地形 */
    for (const s of GAME.solids) {
      if (s.oneway) continue;
      if (segRect(this.px, this.py, this.x, this.y, s)) {
        if (this.bounce > 0 && !this.rocket) { this.doBounce(s); return true; }
        if (this.rocket || this.splash) GAME.explode(this.x, this.y, 120, this.dmg, this.owner);
        else { FX.spark(this.x, this.y, 5, '#ffd27a', 180, 0.25); Audio.ric(); }
        return false;
      }
    }
    /* 破壊物 */
    for (const p of GAME.props) {
      if (p.dead) continue;
      if (segRect(this.px, this.py, this.x, this.y, p.box)) {
        p.damage(this.dmg, this.owner);
        if (this.rocket || this.splash) { GAME.explode(this.x, this.y, 120, this.dmg, this.owner); return false; }
        FX.spark(this.x, this.y, 5, '#c9a06a', 160, 0.25);
        if (this.pierce-- <= 0) return false;
      }
    }
    /* アクター */
    const targets = this.owner === 'player' ? GAME.enemies : [GAME.player];
    for (const a of targets) {
      if (!a || a.dead || this.hitList.includes(a)) continue;
      if (a.sleeping && this.tranq) continue;
      const b = a.box;
      if (!segRect(this.px, this.py, this.x, this.y, b)) continue;

      if (a === GAME.player) {
        if (a.iFrames > 0) {
          if (!this.grazed) { this.grazed = true; a.perfectDodge(this.src || null); }
          continue;                                   /* 無敵中はすり抜ける */
        }
        if (a.rushing) continue;
      } else if (a.shield && this.owner === 'player' && !this.rocket) {
        /* 盾は正面からの銃弾を弾く */
        const fromFront = sign(this.vx) === -a.face;
        if (fromFront && this.py < a.y + 8) {
          FX.spark(this.x, this.y, 6, '#cfe0ee', 220, 0.28); Audio.ric();
          a.shieldHp -= this.dmg;
          if (a.shieldHp <= 0) { a.shield = false; FX.text(a.x, a.y - 40, '盾破壊', '#cfe0ee', 13); }
          return false;
        }
      }
      this.hitList.push(a);
      if (this.rocket || this.splash) { GAME.explode(this.x, this.y, 130, this.dmg, this.owner); return false; }
      const head = this.py < a.y - a.h * 0.24;
      if (this.owner === 'player' && GAME.player) GAME.player.stats.hits++;
      a.damage(this.dmg * (head ? 1.9 : 1), this.owner, { head, tranq: this.tranq, dir: sign(this.vx), x: this.x, y: this.y });
      if (this.pierce-- <= 0) return false;
    }
    return true;
  }
  /* 壁で跳ね返る（レヴォルヴァーの跳弾） */
  doBounce(s) {
    this.bounce--;
    const horiz = segRect(this.px, this.py, this.x, this.py, s);
    if (horiz) { this.vx *= -1; this.x = this.px; } else { this.vy *= -1; this.y = this.py; }
    this.hitList.length = 0;
    FX.spark(this.x, this.y, 6, '#ffe6a3', 220, 0.3);
    FX.ring(this.x, this.y, 'rgba(255,230,163,.8)', 2, 22, 0.2, 2);
    Audio.ric();
  }

  draw(ctx) {
    ctx.save();
    if (this.rocket) {
      ctx.translate(this.x, this.y); ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.fillStyle = '#c9ccd0'; ctx.fillRect(-9, -3, 18, 6);
      ctx.fillStyle = '#ff7a3c'; ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-20, 0); ctx.lineTo(-9, 3); ctx.fill();
    } else {
      const a = Math.atan2(this.vy, this.vx);
      const len = this.tranq ? 8 : this.w + Math.hypot(this.vx, this.vy) * 0.012;
      ctx.translate(this.x, this.y); ctx.rotate(a);
      const g = ctx.createLinearGradient(-len, 0, 4, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, this.color);
      ctx.strokeStyle = g; ctx.lineWidth = this.tranq ? 2.4 : 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(2, 0, 1.6, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
}

/* ===================== 近接の当たり判定 ===================== */
class Hitbox {
  constructor(o) {
    Object.assign(this, { x: 0, y: 0, w: 40, h: 40, dmg: 10, owner: 'enemy', life: 0.12, t: 0, hitList: [], src: null }, o);
    this.hitList = [];
  }
  update(dt) {
    this.t += dt;
    if (this.t > this.life) return false;
    const box = { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
    const targets = this.owner === 'player' ? GAME.enemies : [GAME.player];
    for (const a of targets) {
      if (!a || a.dead || this.hitList.includes(a)) continue;
      if (!rectsOverlap(box, a.box)) continue;
      if (a === GAME.player) {
        if (a.iFrames > 0) { if (!this.grazed) { this.grazed = true; a.perfectDodge(this.src); } continue; }
        if (a.rushing) continue;
      }
      this.hitList.push(a);
      a.damage(this.dmg, this.owner, { dir: sign(a.x - this.x), x: this.x, y: this.y, melee: true });
    }
    return true;
  }
  draw() { /* 見た目はエフェクト側で表現する */ }
}

/* ===================== 拾い物 ===================== */
const ITEM_DEF = {
  ration: { name: 'レーション', color: '#7dff9b', icon: '🍱' },
  ammo:   { name: '弾薬箱',     color: '#ffb43c', icon: '📦' },
  armor:  { name: '防弾ベスト', color: '#6ec8ff', icon: '🛡' },
  box:    { name: '段ボール箱', color: '#c99a5b', icon: '📦' },
};
class Pickup {
  constructor(kind, x, y, wid) {
    this.kind = kind; this.wid = wid || null;
    this.x = x; this.y = y - 16; this.w = 26; this.h = 26; this.t = rand(6);
    this.taken = false; this.vy = 0;
  }
  get box() { return { x: this.x - 14, y: this.y - 14, w: 28, h: 28 }; }
  update(dt) {
    this.t += dt;
    this.vy = Math.min(this.vy + 1400 * dt, 900);
    this.y += this.vy * dt;
    for (const s of GAME.solids) {
      const b = this.box;
      if (rectsOverlap(b, s) && this.vy > 0) { this.y = s.y - 14; this.vy = 0; }
    }
    const p = GAME.player;
    if (p && !p.dead && rectsOverlap(this.box, p.box)) { this.apply(p); return false; }
    return true;
  }
  apply(p) {
    Audio.pickup();
    if (this.wid) {
      const got = p.giveWeapon(this.wid);
      FX.text(this.x, this.y - 22, got ? WEAPONS[this.wid].name + ' 入手' : WEAPONS[this.wid].short + ' 弾薬', '#ffd27a', 13);
      GAME.toast(got ? WEAPONS[this.wid].name + ' を入手' : '弾薬補給', '#ffd27a');
      return;
    }
    switch (this.kind) {
      case 'ration': p.rations = Math.min(9, p.rations + 1); FX.text(this.x, this.y - 22, 'レーション', '#7dff9b', 13); break;
      case 'ammo': p.giveAmmo(); FX.text(this.x, this.y - 22, '弾薬補給', '#ffb43c', 13); break;
      case 'armor': p.armor = Math.min(60, p.armor + 40); FX.text(this.x, this.y - 22, '防弾ベスト', '#6ec8ff', 13); break;
      case 'box': p.hasBox = true; FX.text(this.x, this.y - 22, '段ボール箱 ［C］', '#c99a5b', 13); GAME.toast('段ボール箱を入手 ［C］で被る', '#c99a5b'); break;
    }
  }
  draw(ctx) {
    const bob = Math.sin(this.t * 3) * 3;
    ctx.save(); ctx.translate(this.x, this.y + bob);
    const c = this.wid ? '#ffd27a' : ITEM_DEF[this.kind].color;
    ctx.globalAlpha = 0.25; ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(0, 0, 18 + Math.sin(this.t * 4) * 2, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#101820'; ctx.strokeStyle = c; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.rect(-11, -11, 22, 22); ctx.fill(); ctx.stroke();
    ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.wid ? WEAPONS[this.wid].icon : ITEM_DEF[this.kind].icon, 0, 1);
    ctx.restore();
  }
}

/* ===================== 破壊物（ドラム缶・木箱） ===================== */
class Prop {
  constructor(kind, x, y) {
    this.kind = kind; this.x = x;
    this.w = kind === 'barrel' ? 28 : 42; this.h = kind === 'barrel' ? 42 : 40;
    this.y = y - this.h / 2;
    this.hp = kind === 'barrel' ? 30 : 55; this.dead = false; this.t = rand(6);
  }
  get box() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }
  damage(d) {
    this.hp -= d;
    FX.spark(this.x, this.y - 8, 4, this.kind === 'barrel' ? '#ffb43c' : '#c9a06a', 150, 0.25);
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      if (this.kind === 'barrel') GAME.explode(this.x, this.y, 130, 65, 'player');
      else { FX.dust(this.x, this.y + 16, 8, '#a08055'); FX.spark(this.x, this.y, 12, '#c9a06a', 260, 0.5); Audio.hit(); }
    }
  }
  draw(ctx) {
    if (this.dead) return;
    ctx.save(); ctx.translate(this.x, this.y);
    if (this.kind === 'barrel') {
      ctx.fillStyle = '#7a4a22'; ctx.fillRect(-14, -21, 28, 42);
      ctx.fillStyle = '#8f5a2a'; ctx.fillRect(-14, -21, 6, 42);
      ctx.fillStyle = '#c9302c'; ctx.fillRect(-14, -8, 28, 6); ctx.fillRect(-14, 4, 28, 4);
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.strokeRect(-14, -21, 28, 42);
    } else {
      ctx.fillStyle = '#8a6a41'; ctx.fillRect(-21, -20, 42, 40);
      ctx.strokeStyle = '#5d4527'; ctx.lineWidth = 2;
      ctx.strokeRect(-21, -20, 42, 40);
      ctx.beginPath(); ctx.moveTo(-21, -20); ctx.lineTo(21, 20); ctx.moveTo(21, -20); ctx.lineTo(-21, 20); ctx.stroke();
    }
    ctx.restore();
  }
}

/* =========================================================================
   プレイヤー ― コードネーム「スネーク」
   ========================================================================= */
const P_W = 22, P_H = 46, P_CROUCH_H = 32, P_ROLL_H = 26;

class Player extends Actor {
  constructor(x, y) {
    super(x, y, P_W, P_H);
    const d = GAME.diff;
    this.maxHp = d.hp; this.hp = d.hp; this.armor = 0;
    this.state = 'idle';
    this.aimAng = 0; this.face = 1;
    this.walkPhase = 0; this.t = 0;
    this.coyote = 0; this.jumpBuf = 0; this.airDodge = false;
    this.crouching = false; this.onLadder = false;

    /* 武器 */
    this.weapons = {};
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      this.weapons[id] = { owned: id === 'knife' || id === 'm9', mag: w.mag, reserve: w.reserve };
    }
    for (const id of (GAME.carryWeapons || [])) if (this.weapons[id]) this.weapons[id].owned = true;
    this.cur = 'm9';
    this.fireT = 0; this.reloadT = 0; this.recoil = 0;

    /* 回避とラッシュ */
    this.dodgeT = 0; this.dodgeCd = 0; this.iFrames = 0; this.perfectCd = 0;
    this.rushStock = 0; this.rush = null; this.rushCombo = 0;
    this.focus = 100; this.maxFocus = 100;

    /* その他 */
    this.rations = 2; this.hasBox = false; this.boxOn = false;
    this.invT = 0; this.hurtT = 0; this.deadT = 0;
    this.meleeT = 0; this.cqcT = 0;
    this.noiseTimer = 0; this.lastLoudNoise = 0;
    this.stats = { kills: 0, stealth: 0, perfect: 0, maxCombo: 0, dmgTaken: 0, alerts: 0, shots: 0, hits: 0 };
  }

  get rushing() { return !!this.rush; }
  get weapon() { return WEAPONS[this.cur]; }
  get ammo() { return this.weapons[this.cur]; }

  setHeight(h) {
    if (this.h === h) return;
    const f = this.feet; this.h = h; this.y = f - h / 2;
  }

  /* ---------- 入力 ---------- */
  readInput() {
    const I = Input;
    const t = I.usingTouch;
    let mx = 0;
    if (t) { mx = Math.abs(I.touch.mx) > 0.28 ? sign(I.touch.mx) : 0; }
    else mx = (I.down('KeyD', 'ArrowRight') ? 1 : 0) - (I.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const up = t ? I.touch.my < -0.55 : I.down('KeyW', 'ArrowUp');
    const dn = t ? I.touch.my > 0.55 : I.down('KeyS', 'ArrowDown');
    return {
      mx, up, dn,
      jump: t ? I.tPressed('jump') : (I.pressed('Space') || I.pressed('KeyW') || I.pressed('ArrowUp')),
      jumpHeld: t ? I.tDown('jump') : I.down('Space', 'KeyW', 'ArrowUp'),
      fire: t ? I.tDown('fire') : (I.mouse.down || I.down('KeyJ')),
      fireTap: t ? I.tPressed('fire') : (I.pressed('Fire') || I.pressed('KeyJ')),
      dodge: t ? I.tPressed('dodge') : (I.pressed('ShiftLeft', 'ShiftRight', 'Dodge')),
      rush: t ? I.tPressed('rush') : I.pressed('KeyF'),
      melee: I.pressed('KeyQ'),
      reload: t ? I.tPressed('reload') : I.pressed('KeyR'),
      swap: t ? I.tPressed('swap') : false,
      ration: I.pressed('KeyG'),
      box: I.pressed('KeyC'),
    };
  }

  /* ---------- 更新 ---------- */
  update(dt) {
    this.t += dt;
    if (this.dead) { this.deadT += dt; this.moveAndCollide(dt); return; }

    const inp = this.readInput();
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.perfectCd = Math.max(0, this.perfectCd - dt);
    this.iFrames = Math.max(0, this.iFrames - dt);
    this.invT = Math.max(0, this.invT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.fireT = Math.max(0, this.fireT - dt);
    this.meleeT = Math.max(0, this.meleeT - dt);
    this.recoil = Math.max(0, this.recoil - dt * 12);
    this.flash = Math.max(0, this.flash - dt * 6);

    /* 集中ゲージ（スローの燃料） */
    if (Screen.slow < 1 || this.rushing) {
      this.focus = Math.max(0, this.focus - 34 * dt);
      if (this.focus <= 0 && !this.rushing) { Screen.slow = 1; Screen.slowT = 0; }
    } else this.focus = Math.min(this.maxFocus, this.focus + 22 * dt);
    Screen.vignette = clamp(1 - this.hp / this.maxHp, 0, 1) * 0.55;

    /* 照準 */
    this.updateAim();

    /* ラッシュ中は専用処理 */
    if (this.rush) { this.updateRush(dt); return; }

    /* CQC演出中 */
    if (this.cqcT > 0) {
      this.cqcT -= dt; this.vx = 0;
      this.moveAndCollide(dt);
      return;
    }

    /* 回復・道具 */
    if (inp.ration && this.rations > 0 && this.hp < this.maxHp) {
      this.rations--; this.hp = Math.min(this.maxHp, this.hp + 45);
      Audio.pickup(); FX.text(this.x, this.y - 40, '+45', '#7dff9b', 16); GAME.toast('レーション使用', '#7dff9b');
    }
    if (inp.box && this.hasBox) {
      this.boxOn = !this.boxOn;
      GAME.toast(this.boxOn ? '段ボール箱を被った' : '段ボール箱を外した', '#c99a5b');
      Audio.hit();
    }

    /* 武器切替 */
    this.handleWeaponSwitch(inp);

    /* リロード */
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    } else if (inp.reload) this.startReload();

    /* 回避 */
    if (inp.dodge) this.startDodge(inp);

    /* ラッシュ / CQC */
    if (inp.rush) this.pressRush();

    /* ナイフ */
    if (inp.melee && this.meleeT <= 0) this.knifeAttack();

    /* 射撃 */
    const w = this.weapon;
    if (this.dodgeT <= 0 && this.reloadT <= 0 && (w.auto ? inp.fire : inp.fireTap) && this.fireT <= 0) this.fire();

    /* 状態ごとの移動 */
    if (this.dodgeT > 0) this.updateDodge(dt);
    else this.updateMove(dt, inp);

    /* 足音（犬などが反応する） */
    this.noiseTimer -= dt;
    if (this.onGround && Math.abs(this.vx) > 180 && this.noiseTimer <= 0 && !this.crouching) {
      this.noiseTimer = 0.4; GAME.makeNoise(this.x, this.y, 150, false);
    }
  }

  updateAim() {
    if (Input.usingTouch) {
      const e = GAME.nearestEnemy(this.x, this.y, 620, true);
      if (e) this.aimAng = Math.atan2(e.y - (this.y - 6), e.x - this.x);
      else this.aimAng = this.face > 0 ? 0 : Math.PI;
    } else {
      const m = GAME.mouseWorld();
      Input.mouse.wx = m.x; Input.mouse.wy = m.y;
      this.aimAng = Math.atan2(m.y - (this.y - 6), m.x - this.x);
    }
    if (this.dodgeT <= 0 && this.cqcT <= 0) this.face = Math.cos(this.aimAng) >= 0 ? 1 : -1;
  }

  updateMove(dt, inp) {
    /* はしご */
    const lad = GAME.ladderAt(this.box);
    if (lad && (inp.up || inp.dn) && !this.onLadder) this.onLadder = true;
    if (this.onLadder) {
      if (!lad) this.onLadder = false;
      else {
        this.crouching = false; this.setHeight(P_H);
        this.vy = (inp.up ? -175 : 0) + (inp.dn ? 175 : 0);
        this.vx = inp.mx * 70;
        this.x = lerp(this.x, lad.x + lad.w / 2, 1 - Math.pow(0.02, dt));
        this.state = 'ladder';
        this.moveAndCollide(dt, 0, { noGravity: true, dropThrough: true });
        this.walkPhase += Math.abs(this.vy) * dt * 0.03;
        if (inp.jump) { this.onLadder = false; this.vy = -520; Audio.jump(); }
        return;
      }
    }

    /* しゃがみ */
    const wantCrouch = inp.dn && this.onGround;
    if (wantCrouch !== this.crouching) {
      if (!wantCrouch && GAME.blockedAbove(this)) { /* 天井があるので立てない */ }
      else { this.crouching = wantCrouch; this.setHeight(wantCrouch ? P_CROUCH_H : P_H); }
    }

    const maxSp = this.crouching ? 112 : (this.boxOn ? 130 : 252);
    const acc = this.onGround ? 2100 : 1250;
    if (inp.mx !== 0) this.vx = approach(this.vx, inp.mx * maxSp, acc * dt);
    else this.vx = approach(this.vx, 0, (this.onGround ? 2600 : 700) * dt);

    /* ジャンプ */
    this.coyote = this.onGround ? 0.11 : Math.max(0, this.coyote - dt);
    if (inp.jump) this.jumpBuf = 0.13; else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    if (this.jumpBuf > 0 && this.coyote > 0 && !this.crouching) {
      /* 下入力＋ジャンプで一方通行の床をすり抜ける */
      if (inp.dn && GAME.onOneway(this)) { this.y += 8; this.vy = 60; }
      else { this.vy = -672; Audio.jump(); FX.dust(this.x, this.feet, 4); }
      this.jumpBuf = 0; this.coyote = 0;
    }
    if (!inp.jumpHeld && this.vy < -200) this.vy += 1500 * dt;   /* 可変ジャンプ */

    const wasAir = !this.onGround;
    this.moveAndCollide(dt, 1900, { dropThrough: inp.dn && !this.onGround });
    if (this.onGround) {
      this.airDodge = false;
      if (wasAir && this.vy === 0) { Audio.land(); FX.dust(this.x, this.feet, 5); }
    }

    this.walkPhase += Math.abs(this.vx) * dt * 0.032;
    if (!this.onGround) this.state = this.vy < 0 ? 'jump' : 'fall';
    else if (this.crouching) this.state = 'crouch';
    else this.state = Math.abs(this.vx) > 16 ? 'run' : 'idle';
  }

  /* ---------- 回避（ドッジ） ---------- */
  startDodge(inp) {
    if (this.dodgeCd > 0 || this.dodgeT > 0 || this.onLadder) return;
    if (!this.onGround && this.airDodge) return;
    if (!this.onGround) this.airDodge = true;
    const dir = inp.mx !== 0 ? inp.mx : this.face;
    this.dodgeT = 0.42;
    this.iFrames = 0.30 * GAME.diff.dodgeWin;
    this.dodgeDir = dir;
    this.vx = dir * 470;
    if (!this.onGround) this.vy = Math.min(this.vy, -60);
    this.crouching = false; this.setHeight(P_ROLL_H);
    this.boxOn = false;
    this.state = 'dodge';
    Audio.dodge();
    FX.dust(this.x, this.feet, 7, '#9fb3bf');
    FX.ring(this.x, this.y, 'rgba(160,220,255,.7)', 8, 46, 0.28, 2);
  }

  updateDodge(dt) {
    this.dodgeT -= dt;
    this.vx = approach(this.vx, this.dodgeDir * 150, 700 * dt);
    this.moveAndCollide(dt, 1900);
    FX.trail(this.x, this.y, 'rgba(150,200,230,.35)', 7, 0.18);
    if (this.dodgeT <= 0) {
      this.dodgeCd = 0.34;
      this.setHeight(P_H);
      if (GAME.blockedAbove(this)) { this.setHeight(P_CROUCH_H); this.crouching = true; }
      this.state = 'idle';
    }
  }

  /* 無敵中に攻撃をすり抜けたときに呼ばれる */
  perfectDodge(src) {
    if (this.perfectCd > 0) return;
    this.perfectCd = 0.2;
    this.stats.perfect++;
    this.rushStock = Math.min(3, this.rushStock + 1);
    this.iFrames = Math.max(this.iFrames, 0.14);
    if (this.focus > 12) Screen.slowmo(0.3, 0.85);
    Screen.flash('#cfe9ff', 0.3);
    Screen.stop(0.05);
    Cam.kick(5);
    Audio.perfect();
    FX.ring(this.x, this.y, '#cfe9ff', 10, 110, 0.42, 4);
    FX.ring(this.x, this.y, '#ffffff', 6, 60, 0.3, 2);
    FX.text(this.x, this.y - 52, 'PERFECT!', '#cfe9ff', 20, 0.85);
    FX.spark(this.x, this.y, 14, '#cfe9ff', 300, 0.5);
    if (src && !src.dead) { src.marked = 6.5; FX.text(src.x, src.y - 44, '◆', '#ffb43c', 22, 0.8, -20); }
    GAME.toast('PERFECT DODGE ― RUSH +1', '#cfe9ff');
  }

  /* ---------- ラッシュ ---------- */
  pressRush() {
    /* 気付いていない敵が目の前にいれば、まずCQC（静粛制圧） */
    const cq = GAME.cqcTarget(this);
    if (cq) { this.doCQC(cq); return; }
    if (this.rushStock <= 0) {
      FX.text(this.x, this.y - 46, 'RUSH なし', '#7d8f99', 12, 0.6);
      Audio.empty(); return;
    }
    const tgt = GAME.rushTarget(this, 400);
    if (!tgt) { FX.text(this.x, this.y - 46, '対象が遠い', '#7d8f99', 12, 0.6); Audio.empty(); return; }
    this.startRush(tgt);
  }

  startRush(target) {
    this.rush = { target, phase: 'dash', t: 0, hit: 0, links: 1, side: sign(this.x - target.x) || 1 };
    this.rushCombo = 0;
    this.dodgeT = 0; this.setHeight(P_H); this.crouching = false; this.boxOn = false;
    this.state = 'rush';
    this.vx = 0; this.vy = 0;
    Audio.rushStart();
    Screen.flash('#ffffff', 0.42);
    Screen.slowmo(0.26, 0.5);
    Cam.tzoom = 1.22;
    FX.ring(this.x, this.y, '#ffb43c', 12, 150, 0.5, 5);
    GAME.toast('RUSH ― ダガーナイフ', '#ffb43c');
  }

  updateRush(dt) {
    const R = this.rush;
    R.t += dt;
    const tg = R.target;
    if (!tg || tg.dead === true && R.phase === 'dash') { this.endRush(); return; }

    if (R.phase === 'dash') {
      const dx = tg.x + R.side * 34 - this.x, dy = (tg.y + 4) - this.y;
      const k = Math.min(1, R.t / 0.15);
      this.x += dx * (1 - Math.pow(0.001, dt)) * 1.0;
      this.y += dy * (1 - Math.pow(0.001, dt)) * 1.0;
      this.face = -R.side;
      FX.trail(this.x, this.y, 'rgba(255,200,110,.5)', 9, 0.2);
      if (R.t >= 0.16 || (Math.abs(dx) < 6 && Math.abs(dy) < 6)) {
        R.phase = 'slash'; R.t = 0; R.hit = 0;
        this.rushStock--;
      }
      return;
    }

    if (R.phase === 'slash') {
      const times = [0.02, 0.15, 0.28];
      while (R.hit < times.length && R.t >= times[R.hit]) {
        this.rushHit(tg, R.hit === times.length - 1);
        R.hit++;
      }
      if (R.t >= 0.44) {
        this.rushCombo += 3;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, this.rushCombo);
        const next = (this.rushStock > 0) ? GAME.rushTarget(this, 460, tg) : null;
        if (next) {
          R.target = next; R.side = sign(this.x - next.x) || 1; R.phase = 'dash'; R.t = 0; R.links++;
          Audio.slash();
          FX.text(this.x, this.y - 60, 'CHAIN ' + R.links, '#ffb43c', 17, 0.6);
        } else { R.phase = 'outro'; R.t = 0; }
      }
      return;
    }

    /* 締め */
    this.vy += 1400 * dt;
    this.moveAndCollide(dt);
    if (R.t >= 0.34) this.endRush();
  }

  rushHit(tg, last) {
    const ang = rand(0.9, -0.9) + (this.face > 0 ? 0 : Math.PI);
    const dmg = (last ? 74 : 34) * GAME.diff.dmgOut;
    FX.slashArc(tg.x + rand(14, -14), tg.y + rand(14, -14), ang, last ? 130 : 92, '#ffffff', last ? 0.3 : 0.2);
    FX.blood(tg.x, tg.y + rand(10, -10), last ? 14 : 7, this.face > 0 ? 0.3 : Math.PI - 0.3);
    FX.spark(tg.x, tg.y, last ? 12 : 5, '#fff2c4', 280, 0.3);
    Audio.slash();
    Screen.stop(last ? 0.075 : 0.045);
    Cam.kick(last ? 8 : 4);
    if (last) { Screen.flash('#fff', 0.3); FX.ring(tg.x, tg.y, '#ffffff', 8, 100, 0.32, 3); Audio.stab(); }
    if (!tg.dead) tg.damage(dmg, 'player', { rush: true, dir: -this.face, x: tg.x, y: tg.y });
  }

  endRush() {
    const combo = this.rushCombo;
    this.rush = null; this.state = 'idle';
    Cam.tzoom = 1;
    Screen.slow = 1; Screen.slowT = 0;
    Audio.rushEnd();
    if (combo > 0) {
      FX.text(this.x, this.y - 66, 'RUSH ×' + combo, '#ffb43c', 26, 1.1, -40);
      GAME.toast('RUSH ×' + combo, '#ffb43c');
    }
    this.iFrames = Math.max(this.iFrames, 0.2);
  }

  /* ---------- CQC・ナイフ ---------- */
  doCQC(e) {
    this.cqcT = 0.42;
    this.face = sign(e.x - this.x) || this.face;
    this.x = e.x - this.face * 26;
    e.cqcKill(this);
    this.stats.stealth++; this.stats.kills++;
    Audio.stab();
    Screen.stop(0.06); Cam.kick(3);
    FX.slashArc(e.x, e.y, this.face > 0 ? -0.5 : Math.PI + 0.5, 80, '#ffffff', 0.24);
    FX.blood(e.x, e.y, 8, this.face > 0 ? 0.2 : Math.PI - 0.2);
    FX.text(e.x, e.y - 48, 'CQC 制圧', '#7dff9b', 15);
    GAME.makeNoise(this.x, this.y, 90, false);
  }

  knifeAttack() {
    this.meleeT = 0.3;
    const w = WEAPONS.knife;
    const ax = this.x + Math.cos(this.aimAng) * 30, ay = this.y - 4 + Math.sin(this.aimAng) * 22;
    GAME.hitboxes.push(new Hitbox({ x: ax, y: ay, w: 52, h: 46, dmg: w.dmg * GAME.diff.dmgOut, owner: 'player', life: 0.1, src: this }));
    FX.slashArc(ax, ay, this.aimAng + rand(0.5, -0.5), 78, '#dff6ff', 0.18);
    Audio.slash();
    GAME.makeNoise(this.x, this.y, 110, false);
  }

  /* ---------- 銃 ---------- */
  handleWeaponSwitch(inp) {
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];
    for (let i = 0; i < idx.length; i++) {
      if (Input.pressed(idx[i])) this.selectWeapon(WEAPON_ORDER[i]);
    }
    if (Input.wheel !== 0 || inp.swap) {
      const owned = WEAPON_ORDER.filter((id) => this.weapons[id].owned);
      let i = owned.indexOf(this.cur);
      i = (i + (Input.wheel > 0 ? 1 : owned.length - 1) + owned.length) % owned.length;
      if (inp.swap) i = (owned.indexOf(this.cur) + 1) % owned.length;
      this.selectWeapon(owned[i]);
    }
  }
  selectWeapon(id) {
    if (!id || !this.weapons[id] || !this.weapons[id].owned || this.cur === id) return;
    this.cur = id; this.reloadT = 0; this.fireT = Math.max(this.fireT, 0.15);
    Audio.blip();
    Cam.tzoom = WEAPONS[id].zoom || 1;
    GAME.updateHUD();
  }
  giveWeapon(id) {
    const a = this.weapons[id];
    const first = !a.owned;
    a.owned = true;
    if (first) { a.mag = WEAPONS[id].mag; a.reserve = WEAPONS[id].reserve; this.selectWeapon(id); }
    else a.reserve = Math.min(WEAPONS[id].reserve * 1.5, a.reserve + WEAPONS[id].mag * 2);
    GAME.updateHUD();
    return first;
  }
  giveAmmo() {
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id], a = this.weapons[id];
      if (!a.owned || w.melee) continue;
      a.reserve = Math.min(Math.round(w.reserve * 1.4), a.reserve + Math.ceil(w.mag * 1.6));
    }
    GAME.updateHUD();
  }
  startReload() {
    const w = this.weapon, a = this.ammo;
    if (w.melee || this.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return;
    this.reloadT = w.reload; Audio.reload();
  }
  finishReload() {
    const w = this.weapon, a = this.ammo;
    const need = Math.min(w.mag - a.mag, a.reserve);
    a.mag += need; a.reserve -= need;
    GAME.updateHUD();
  }

  fire() {
    const w = this.weapon, a = this.ammo;
    if (w.melee) { if (this.meleeT <= 0) this.knifeAttack(); return; }
    if (a.mag <= 0) { Audio.empty(); this.startReload(); return; }
    a.mag--; this.fireT = w.rate; this.stats.shots++;
    this.boxOn = false;

    const bx = this.x + Math.cos(this.aimAng) * 20;
    const by = this.y - 6 + Math.sin(this.aimAng) * 16;
    const n = w.pellets || 1;
    for (let i = 0; i < n; i++) {
      const sp = (w.spread || 0) * (this.crouching ? 0.55 : 1) * (n > 1 ? 1 : (1 + this.recoil * 0.3));
      const ang = this.aimAng + rand(sp, -sp);
      GAME.bullets.push(new Bullet({
        x: bx, y: by,
        vx: Math.cos(ang) * w.speed * rand(1.06, 0.94), vy: Math.sin(ang) * w.speed * rand(1.06, 0.94),
        dmg: w.dmg * GAME.diff.dmgOut, owner: 'player', pierce: w.pierce || 0,
        rocket: !!w.rocket, splash: w.splash || 0, tranq: !!w.tranq, src: this,
        color: w.tranq ? '#9fe0ff' : (w.rocket ? '#ffd27a' : '#fff0c0'),
        life: w.range ? w.range / w.speed : 2.4,
      }));
    }
    /* 反動と演出 */
    this.recoil = Math.min(2.4, this.recoil + (w.kick || 2) * 0.22);
    Cam.kick((w.kick || 2) * 0.55);
    this.vx -= Math.cos(this.aimAng) * (w.kick || 2) * 5;
    FX.spark(bx, by, w.silent ? 2 : 5, '#ffe6a3', 200, 0.14);
    FX.ring(bx, by, w.silent ? 'rgba(255,230,163,.4)' : 'rgba(255,220,140,.85)', 2, w.silent ? 12 : 26, 0.12, 2);
    if (!w.silent) FX.smoke(bx, by, 2, '#c9ccd0', 26, 6);
    FX.shell(this.x, this.y - 8, this.face);
    Audio.shot(w.sound);
    GAME.makeNoise(this.x, this.y, w.silent ? 60 : 620, !w.silent);
    GAME.updateHUD();
  }

  /* ---------- 被弾 ---------- */
  damage(d, from, info = {}) {
    if (this.dead || this.iFrames > 0 || this.rushing || this.invT > 0) return;
    let dmg = d * GAME.diff.dmgIn;
    if (this.armor > 0) { const abs = Math.min(this.armor, dmg * 0.6); this.armor -= abs; dmg -= abs; }
    this.hp -= dmg;
    this.stats.dmgTaken += dmg;
    this.invT = 0.45; this.hurtT = 0.3; this.flash = 1;
    this.boxOn = false;
    Cam.kick(5); Screen.flash('#ff3b47', 0.24); Screen.stop(0.035);
    Audio.hit();
    FX.blood(this.x, this.y, 6, info.dir > 0 ? 0.4 : Math.PI - 0.4);
    FX.text(this.x, this.y - 44, '-' + Math.round(dmg), '#ff6b73', 15, 0.7);
    Screen.vignette = clamp(1 - this.hp / this.maxHp, 0, 1) * 0.55;
    GAME.updateHUD();
    if (this.hp <= 0) this.die(from);
  }
  die() {
    this.dead = true; this.state = 'dead'; this.vy = -260; this.vx = -this.face * 60;
    Audio.dead(); Screen.flash('#500', 0.5); Cam.kick(12);
    FX.blood(this.x, this.y, 20, 0);
    GAME.onPlayerDeath();
  }
  onFall() { if (!this.dead) { this.hp = 0; this.die(); } }

  /* ---------- 描画 ---------- */
  draw(ctx) {
    if (this.invT > 0 && Math.floor(this.t * 30) % 2 === 0 && !this.dead) return;

    ctx.save();
    ctx.translate(this.x, this.feet);

    if (this.boxOn) { this.drawBox(ctx); ctx.restore(); return; }

    if (this.state === 'dodge') {
      /* 前転：体を丸めて回転させる */
      const k = 1 - this.dodgeT / 0.42;
      ctx.translate(0, -13);
      ctx.rotate(this.dodgeDir * k * Math.PI * 2);
      ctx.scale(this.dodgeDir >= 0 ? 1 : -1, 1);
      drawSnakeCurled(ctx);
      ctx.restore();
      /* 無敵中の残光 */
      if (this.iFrames > 0) {
        ctx.save(); ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.x, this.y, 20, 0, 7); ctx.stroke();
        ctx.restore();
      }
      return;
    }

    if (this.dead) {
      ctx.translate(0, -8); ctx.rotate((this.face > 0 ? 1 : -1) * Math.PI / 2 * Math.min(1, this.deadT * 2.5));
      ctx.scale(this.face, 1);
      drawSnakeBody(ctx, { pose: 'dead', t: this.t });
      ctx.restore(); return;
    }

    ctx.scale(this.face, 1);
    const aim = this.face > 0 ? this.aimAng : Math.PI - this.aimAng;
    drawSnakeBody(ctx, {
      pose: this.state, t: this.t, walk: this.walkPhase, aim,
      weapon: this.rushing || this.meleeT > 0 || this.cqcT > 0 ? 'knife' : this.cur,
      recoil: this.recoil, crouch: this.crouching, hurt: this.hurtT,
      rush: this.rushing, vy: this.vy,
    });
    ctx.restore();

    /* ラッシュ中のオーラ */
    if (this.rushing) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(this.t * 30) * 0.1;
      ctx.strokeStyle = '#ffb43c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, 26, 34, 0, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  drawBox(ctx) {
    ctx.fillStyle = '#a97c46'; ctx.strokeStyle = '#6f4d24'; ctx.lineWidth = 2;
    ctx.fillRect(-22, -48, 44, 48); ctx.strokeRect(-22, -48, 44, 48);
    ctx.beginPath(); ctx.moveTo(-22, -34); ctx.lineTo(22, -34); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('FRAGILE', 0, -20); ctx.fillText('この面を上に', 0, -8);
  }
}

/* =========================================================================
   スネークの描画（バンダナ＋マレットヘア＋スニーキングスーツ）
   原点は足元、+X が向いている方向
   ========================================================================= */
const SN = {
  suit: '#2f3a45', suitL: '#43525f', suitD: '#1b232a',
  skin: '#d7a377', skinD: '#a97b53',
  hair: '#5b4229', band: '#3f5136', bandD: '#2c3926',
  strap: '#171c21', pouch: '#4a4136', boot: '#12161a', metal: '#9aa7b4',
};

/* 被弾の閃光：四角で塗りつぶすと形が消えるので、放射状のにじみで表現する */
function hitFlash(ctx, amount, w, h, cy) {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = Math.max(w, h) * 0.62;
  const g = ctx.createRadialGradient(0, cy, 1, 0, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,' + (amount * 0.55) + ')');
  g.addColorStop(0.55, 'rgba(255,220,190,' + (amount * 0.22) + ')');
  g.addColorStop(1, 'rgba(255,180,140,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, cy, r, 0, 7); ctx.fill();
  ctx.restore();
}

function limb(ctx, x0, y0, x1, y1, w, col) {
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function drawGunShape(ctx, id, ang, hx, hy) {
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
  const m = SN.metal;
  switch (id) {
    case 'knife':
      ctx.fillStyle = '#20262c'; ctx.fillRect(-5, -2, 8, 4);
      ctx.fillStyle = '#dfeaf2';
      ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(20, -1.6); ctx.lineTo(24, 0); ctx.lineTo(20, 2); ctx.lineTo(3, 3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9fb3c2'; ctx.lineWidth = 0.7; ctx.stroke();
      break;
    case 'm9':
      ctx.fillStyle = '#23292f'; ctx.fillRect(-3, -3, 14, 5);
      ctx.fillRect(-3, 1, 4, 7);
      ctx.fillStyle = '#3b444c'; ctx.fillRect(11, -2, 10, 3);   /* サプレッサー */
      break;
    case 'tranq':
      ctx.fillStyle = '#2b333a'; ctx.fillRect(-3, -3, 13, 5); ctx.fillRect(-3, 1, 4, 7);
      ctx.fillStyle = '#5d6c78'; ctx.fillRect(10, -2.5, 11, 4);
      break;
    case 'ar':
      ctx.fillStyle = '#242a30'; ctx.fillRect(-8, -3, 30, 5);
      ctx.fillRect(-2, 1, 4, 8); ctx.fillStyle = '#3a444c'; ctx.fillRect(6, -6, 4, 3);
      ctx.fillStyle = '#1a1f24'; ctx.fillRect(-11, -2, 5, 6);
      break;
    case 'sg':
      ctx.fillStyle = '#3a2d22'; ctx.fillRect(-10, -2, 12, 5);
      ctx.fillStyle = '#262c31'; ctx.fillRect(2, -3.5, 24, 5);
      ctx.fillStyle = '#4a555e'; ctx.fillRect(6, 1, 12, 3);
      break;
    case 'sniper':
      ctx.fillStyle = '#232a2e'; ctx.fillRect(-12, -3, 44, 5);
      ctx.fillRect(-2, 1, 4, 8);
      ctx.fillStyle = '#111'; ctx.fillRect(2, -8, 14, 4);
      ctx.fillStyle = m; ctx.fillRect(30, -1.5, 6, 2);
      break;
    case 'rl':
      ctx.fillStyle = '#3b4a3a'; ctx.fillRect(-14, -5, 42, 10);
      ctx.fillStyle = '#26301f'; ctx.fillRect(28, -6, 6, 12);
      ctx.fillStyle = '#1a1f24'; ctx.fillRect(-2, 4, 5, 7);
      break;
  }
  ctx.restore();
}

function drawSnakeBody(ctx, o) {
  const t = o.t || 0;
  const crouch = o.pose === 'crouch' || o.crouch;
  const hipY = crouch ? -15 : -22;
  const shoulderY = crouch ? -30 : -37;
  const headY = crouch ? -38 : -45;
  const walk = o.walk || 0;
  const aim = o.aim === undefined ? 0 : o.aim;
  const breathe = Math.sin(t * 2.2) * 0.6;

  /* --- 影 --- */
  ctx.save();
  ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 4, 0, 0, 7); ctx.fill();
  ctx.restore();

  if (o.pose === 'dead') {
    ctx.fillStyle = SN.suit; ctx.fillRect(-20, -14, 40, 14);
    ctx.fillStyle = SN.skin; ctx.beginPath(); ctx.arc(-22, -8, 7, 0, 7); ctx.fill();
    ctx.fillStyle = SN.band; ctx.fillRect(-29, -12, 15, 4);
    return;
  }

  /* --- 脚 --- */
  const air = o.pose === 'jump' || o.pose === 'fall';
  let l1, l2;                                        /* 各脚の膝・足位置 */
  if (air) {
    const k = clamp((o.vy || 0) / 500, -1, 1);
    l1 = { kx: 5, ky: hipY + 12, fx: 9, fy: hipY + 20 - k * 4 };
    l2 = { kx: -5, ky: hipY + 13, fx: -10, fy: hipY + 24 + k * 3 };
  } else if (o.pose === 'run') {
    const s = Math.sin(walk), c = Math.cos(walk);
    l1 = { kx: s * 9, ky: hipY + 11 - Math.abs(c) * 2, fx: s * 15, fy: -Math.max(0, c) * 8 };
    l2 = { kx: -s * 9, ky: hipY + 11 - Math.abs(c) * 2, fx: -s * 15, fy: -Math.max(0, -c) * 8 };
  } else if (crouch) {
    l1 = { kx: 10, ky: hipY + 7, fx: 6, fy: 0 };
    l2 = { kx: -7, ky: hipY + 8, fx: -8, fy: 0 };
  } else {
    l1 = { kx: 4, ky: hipY + 11, fx: 5, fy: 0 };
    l2 = { kx: -4, ky: hipY + 11, fx: -5, fy: 0 };
  }
  /* 奥の脚 */
  limb(ctx, -2, hipY, l2.kx, l2.ky, 8, SN.suitD);
  limb(ctx, l2.kx, l2.ky, l2.fx, l2.fy, 7, SN.suitD);
  ctx.fillStyle = '#0d1114'; ctx.fillRect(l2.fx - 6, l2.fy - 4, 12, 4);
  /* 手前の脚 */
  limb(ctx, 2, hipY, l1.kx, l1.ky, 9, SN.suit);
  limb(ctx, l1.kx, l1.ky, l1.fx, l1.fy, 8, SN.suit);
  ctx.fillStyle = SN.boot; ctx.fillRect(l1.fx - 7, l1.fy - 5, 14, 5);
  /* 膝当て */
  ctx.fillStyle = SN.suitL; ctx.beginPath(); ctx.arc(l1.kx, l1.ky, 3.4, 0, 7); ctx.fill();

  /* --- 胴 --- */
  const lean = crouch ? 3 : (o.pose === 'run' ? 2 : 0);
  ctx.save();
  ctx.translate(0, 0);
  ctx.fillStyle = SN.suit;
  ctx.beginPath();
  ctx.moveTo(-8, hipY + 2);
  ctx.lineTo(-9 + lean, shoulderY + breathe);
  ctx.lineTo(9 + lean, shoulderY + breathe);
  ctx.lineTo(8, hipY + 2);
  ctx.closePath(); ctx.fill();
  /* 胸のハイライト */
  ctx.fillStyle = SN.suitL;
  ctx.beginPath();
  ctx.moveTo(2, hipY + 1); ctx.lineTo(3 + lean, shoulderY + 2); ctx.lineTo(9 + lean, shoulderY + 1); ctx.lineTo(8, hipY + 1);
  ctx.closePath(); ctx.fill();
  /* ハーネスとポーチ */
  ctx.strokeStyle = SN.strap; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-8, hipY - 2); ctx.lineTo(7 + lean, shoulderY + 4); ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-8, hipY - 6); ctx.lineTo(8, hipY - 6); ctx.stroke();
  ctx.fillStyle = SN.pouch;
  ctx.fillRect(-9, hipY - 6, 6, 7); ctx.fillRect(3, hipY - 5, 6, 6);
  ctx.fillStyle = SN.suitD; ctx.fillRect(-11, hipY - 3, 3, 8);   /* 腰の鞘 */
  ctx.restore();

  /* --- 後ろの腕（銃を支える／ナイフのとき腰だめ） --- */
  const shX = 2 + lean, shY = shoulderY + 3;
  const gunLen = o.weapon === 'knife' ? 12 : 20;
  const hx = shX + Math.cos(aim) * gunLen - (o.recoil || 0) * 1.4;
  const hy = shY + Math.sin(aim) * gunLen;
  limb(ctx, shX - 5, shY + 1, (shX + hx) / 2 - 3, (shY + hy) / 2 + 4, 6, SN.suitD);
  limb(ctx, (shX + hx) / 2 - 3, (shY + hy) / 2 + 4, hx - 3, hy + 1, 5.5, SN.suitD);

  /* --- 頭 --- */
  ctx.save();
  ctx.translate(0, 0);
  const headTilt = clamp(Math.sin(aim) * 0.35, -0.4, 0.4);
  ctx.translate(1 + lean, headY);
  ctx.rotate(headTilt);
  /* マレットヘア（後ろ髪） */
  ctx.fillStyle = SN.hair;
  ctx.beginPath();
  ctx.moveTo(-2, -6); ctx.quadraticCurveTo(-12, -4, -11, 4);
  ctx.quadraticCurveTo(-10, 11, -5, 9); ctx.quadraticCurveTo(-4, 2, -1, 0);
  ctx.closePath(); ctx.fill();
  /* 顔 */
  ctx.fillStyle = SN.skin;
  ctx.beginPath(); ctx.ellipse(0, 0, 7, 7.6, 0, 0, 7); ctx.fill();
  /* 顎の無精ひげ */
  ctx.fillStyle = 'rgba(60,45,32,.45)';
  ctx.beginPath(); ctx.ellipse(1.5, 4, 5, 3.4, 0, 0, 7); ctx.fill();
  /* 目 */
  ctx.fillStyle = '#f2f6f8'; ctx.beginPath(); ctx.ellipse(3.6, -1, 2.5, 1.9, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#1b2630'; ctx.beginPath(); ctx.arc(4.4, -1, 1.15, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(40,30,20,.8)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(1.4, -3.6); ctx.lineTo(6.2, -2.9); ctx.stroke();
  /* バンダナ */
  ctx.fillStyle = SN.band;
  ctx.beginPath();
  ctx.moveTo(-7.4, -5.4); ctx.quadraticCurveTo(0, -10.4, 7.2, -4.6);
  ctx.lineTo(7.2, -2.4); ctx.quadraticCurveTo(0, -7.6, -7.4, -2.6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = SN.bandD; ctx.fillRect(-7.4, -4.4, 4, 2.2);
  /* バンダナの尾（風になびく） */
  const fl = Math.sin(t * 7) * 3, fl2 = Math.sin(t * 7 + 1) * 3;
  ctx.strokeStyle = SN.band; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, -4); ctx.quadraticCurveTo(-14, -2 + fl, -20, 2 + fl * 1.6); ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-6, -2); ctx.quadraticCurveTo(-13, 2 + fl2, -18, 7 + fl2 * 1.4); ctx.stroke();
  ctx.restore();

  /* --- 武器と前腕 --- */
  drawGunShape(ctx, o.weapon || 'm9', aim, hx, hy);
  limb(ctx, shX, shY, (shX + hx) / 2 + 1, (shY + hy) / 2 - 1, 6.5, SN.suit);
  limb(ctx, (shX + hx) / 2 + 1, (shY + hy) / 2 - 1, hx, hy, 6, SN.suit);
  ctx.fillStyle = SN.strap; ctx.beginPath(); ctx.arc(hx, hy, 3, 0, 7); ctx.fill();

  /* 被弾フラッシュ */
  if (o.hurt > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, headY / 2, 2, 0, headY / 2, 34);
    g.addColorStop(0, 'rgba(255,90,99,' + Math.min(0.55, o.hurt * 1.5) + ')');
    g.addColorStop(1, 'rgba(255,90,99,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, headY / 2, 34, 0, 7); ctx.fill();
    ctx.restore();
  }
}

/* 前転中の丸まった体 */
function drawSnakeCurled(ctx) {
  ctx.fillStyle = SN.suit;
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill();
  ctx.fillStyle = SN.suitL;
  ctx.beginPath(); ctx.arc(3, -3, 8, 0, 7); ctx.fill();
  ctx.fillStyle = SN.boot; ctx.fillRect(-13, 1, 9, 6);
  ctx.fillStyle = SN.skin; ctx.beginPath(); ctx.arc(7, 4, 5, 0, 7); ctx.fill();
  ctx.fillStyle = SN.band; ctx.fillRect(3, -1, 9, 3);
  ctx.strokeStyle = SN.band; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(4, 0); ctx.quadraticCurveTo(-4, 6, -12, 8); ctx.stroke();
}

/* =========================================================================
   敵
   ========================================================================= */
class Enemy extends Actor {
  constructor(type, x, y, patrol, face) {
    const d = ENEMIES[type];
    super(x, y - d.h / 2, d.w, d.h);
    this.type = type; this.def = d;
    this.maxHp = d.hp; this.hp = d.hp;
    this.face = face || 1;
    this.patrol = patrol; this.patrolDir = this.face;
    this.state = 'patrol';
    this.alertMeter = 0; this.marked = 0;
    this.shootT = rand(1.4, 0.5); this.burst = 0; this.burstT = 0; this.charge = 0;
    this.lastSeen = null; this.searchT = 0; this.idleT = rand(2, 0.5);
    this.walkPhase = rand(6);
    this.tranqT = 0; this.sleeping = false; this.sleepT = 0;
    this.shieldHp = d.shield ? 120 : 0; this.shield = !!d.shield;
    this.stunT = 0; this.deadT = 0; this.t = rand(9);
    this.meleeCd = 0; this.windup = 0;
    this.hoverBase = this.y;
    this.spotIcon = 0;
  }

  get eye() { return { x: this.x + this.face * 5, y: this.y - this.h * 0.28 }; }

  /* ---------- 知覚 ---------- */
  canSee(p) {
    if (this.sleeping || this.dead || !p || p.dead) return false;
    const e = this.eye;
    const dx = p.x - e.x, dy = (p.y - 4) - e.y;
    const d = Math.hypot(dx, dy);
    let range = this.def.sight * GAME.diff.sight;
    if (this.state === 'combat' || GAME.alertLevel === 2) range *= 1.3;
    if (p.crouching) range *= 0.72;
    if (p.boxOn) range = Math.min(range, 52);
    if (d > range) return false;
    const ang = Math.atan2(dy, dx);
    const facing = this.face > 0 ? 0 : Math.PI;
    if (Math.abs(angDiff(ang, facing)) > this.def.fov) return false;
    return GAME.lineOfSight(e.x, e.y, p.x, p.y - 4);
  }

  hear(x, y, r, loud) {
    if (this.dead || this.sleeping) return;
    const d = dist(this.x, this.y, x, y);
    if (d > r) return;
    if (this.state === 'combat') return;
    this.lastSeen = { x, y };
    this.state = 'search'; this.searchT = loud ? 7 : 3.5;
    this.face = sign(x - this.x) || this.face;
  }

  spot() {
    this.state = 'combat';
    this.spotIcon = 1.1;
    this.shootT = rand(0.55, 0.25) * GAME.diff.enemyRate;
    Audio.alert();
    GAME.raiseAlert(this);
    FX.text(this.x, this.y - this.h / 2 - 18, '!', '#ff4d55', 26, 0.9, -30);
  }

  /* ---------- 更新 ---------- */
  update(dt) {
    this.t += dt;
    this.marked = Math.max(0, this.marked - dt);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.spotIcon = Math.max(0, this.spotIcon - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);

    if (this.dead) {
      this.deadT += dt;
      if (!this.def.flying) this.moveAndCollide(dt);
      return;
    }
    if (this.tranqT > 0) {
      this.tranqT -= dt; this.vx *= 0.9;
      if (this.tranqT <= 0) this.fallAsleep();
      if (!this.def.flying) this.moveAndCollide(dt); else this.vy = 0;
      return;
    }
    if (this.sleeping) {
      this.sleepT -= dt;
      if (this.sleepT <= 0) { this.sleeping = false; this.state = 'search'; this.searchT = 4; }
      if (!this.def.flying) { this.vx = 0; this.moveAndCollide(dt); }
      return;
    }
    if (this.stunT > 0) { this.stunT -= dt; this.vx *= 0.86; this.moveAndCollide(dt); return; }

    const p = GAME.player;
    const sees = this.canSee(p);
    if (sees) {
      this.lastSeen = { x: p.x, y: p.y };
      if (this.state !== 'combat') {
        const d = dist(this.x, this.y, p.x, p.y);
        this.alertMeter += dt * (2.4 - clamp(d / this.def.sight, 0, 1) * 1.5) * (GAME.alertLevel > 0 ? 1.8 : 1);
        if (this.alertMeter >= 1) this.spot();
        else if (this.alertMeter > 0.3 && this.state === 'patrol') { this.state = 'suspect'; this.searchT = 2.4; }
      } else this.searchT = 5;
    } else {
      this.alertMeter = Math.max(0, this.alertMeter - dt * 0.55);
      if (this.state === 'combat') {
        this.searchT -= dt;
        if (this.searchT <= 0) { this.state = 'search'; this.searchT = 6; }
      }
    }

    switch (this.state) {
      case 'patrol': this.doPatrol(dt); break;
      case 'suspect': this.doSuspect(dt, sees); break;
      case 'search': this.doSearch(dt); break;
      case 'combat': this.doCombat(dt, p, sees); break;
    }

    if (this.def.flying) {
      this.vy = approach(this.vy, this.targetVy || 0, 700 * dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.x = clamp(this.x, this.w / 2, GAME.level.w - this.w / 2);
      for (const s of GAME.solids) { if (s.oneway) continue; const b = this.box; if (rectsOverlap(b, s)) { this.y = s.y + s.h + this.h / 2 + 1; this.vy = 40; } }
    } else {
      this.moveAndCollide(dt);
      /* 段差の前ではジャンプする */
      if (this.onGround && Math.abs(this.vx) < 6 && this.wantMove) {
        if (this.jumpCd === undefined || this.jumpCd <= 0) { this.vy = -520; this.jumpCd = 1.2; }
      }
      if (this.jumpCd > 0) this.jumpCd -= dt;
    }
    this.walkPhase += Math.abs(this.vx) * dt * 0.05;
  }

  doPatrol(dt) {
    this.wantMove = false;
    if (!this.patrol) { this.vx = approach(this.vx, 0, 600 * dt); return; }
    this.idleT -= dt;
    if (this.idleT > 0 && this.idleT < 1.2) { this.vx = approach(this.vx, 0, 600 * dt); return; }
    const [a, b] = this.patrol;
    if (this.x <= a) { this.patrolDir = 1; this.idleT = rand(3.4, 1.4); }
    if (this.x >= b) { this.patrolDir = -1; this.idleT = rand(3.4, 1.4); }
    this.face = this.patrolDir;
    this.vx = approach(this.vx, this.patrolDir * this.def.speed * 0.55, 500 * dt);
    this.wantMove = true;
    if (this.def.flying) this.targetVy = Math.sin(this.t * 1.4) * 30;
  }

  doSuspect(dt, sees) {
    this.wantMove = false;
    this.vx = approach(this.vx, 0, 700 * dt);
    this.searchT -= dt;
    if (this.lastSeen) this.face = sign(this.lastSeen.x - this.x) || this.face;
    if (this.searchT <= 0 && !sees) { this.state = 'patrol'; this.alertMeter = 0; }
  }

  doSearch(dt) {
    this.searchT -= dt;
    this.wantMove = true;
    const tgt = this.lastSeen;
    if (tgt) {
      const dx = tgt.x - this.x;
      if (Math.abs(dx) > 24) { this.face = sign(dx); this.vx = approach(this.vx, sign(dx) * this.def.speed * 0.8, 700 * dt); }
      else { this.vx = approach(this.vx, 0, 700 * dt); this.face = Math.sin(this.searchT * 2.2) > 0 ? 1 : -1; }
      if (this.def.flying) this.targetVy = clamp((tgt.y - this.def.hover - this.y) * 2, -140, 140);
    }
    if (this.searchT <= 0) { this.state = 'patrol'; this.alertMeter = 0; this.lastSeen = null; }
  }

  doCombat(dt, p, sees) {
    const d = this.def;
    const dx = p.x - this.x, dy = p.y - this.y;
    const distXY = Math.hypot(dx, dy);
    this.face = sign(dx) || this.face;
    this.wantMove = true;

    if (d.flying) {
      const want = (p.y - d.hover) + Math.sin(this.t * 1.8) * 26;
      this.targetVy = clamp((want - this.y) * 2.4, -190, 190);
      const keep = 220;
      this.vx = approach(this.vx, clamp(dx - sign(dx) * keep, -1, 1) * d.speed, 400 * dt);
    } else if (d.melee) {
      /* 犬などの近接タイプ */
      if (this.windup > 0) {
        this.windup -= dt; this.vx = approach(this.vx, 0, 900 * dt);
        if (this.windup <= 0) {
          this.vx = this.face * 420;
          GAME.hitboxes.push(new Hitbox({ x: this.x + this.face * 26, y: this.y, w: 46, h: 30, dmg: d.melee.dmg, owner: 'enemy', life: 0.16, src: this }));
          Audio.hit();
        }
      } else if (distXY < 130 && this.meleeCd <= 0) {
        this.windup = d.melee.wind; this.meleeCd = d.melee.cd;
      } else {
        this.vx = approach(this.vx, sign(dx) * d.speed, 900 * dt);
      }
    } else {
      const keep = d.keepDist;
      if (distXY > keep + 70) this.vx = approach(this.vx, sign(dx) * d.speed, 700 * dt);
      else if (distXY < keep - 50) this.vx = approach(this.vx, -sign(dx) * d.speed * 0.8, 700 * dt);
      else this.vx = approach(this.vx, Math.sin(this.t * 1.6) * d.speed * 0.4, 500 * dt);
    }

    if (!d.gun) return;
    /* 射撃 */
    if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) { this.shoot(p); this.burst--; this.burstT = d.gun.gap || 0.1; }
      return;
    }
    this.shootT -= dt;
    if (this.shootT <= 0 && sees && distXY < d.sight * 1.2) {
      if (d.gun.charge && this.charge <= 0) { this.charge = d.gun.charge; }
      if (d.gun.charge) {
        this.charge -= dt;
        if (this.charge <= 0) { this.burst = d.gun.burst; this.burstT = 0; this.shootT = d.gun.cd * GAME.diff.enemyRate; }
      } else {
        this.burst = d.gun.burst; this.burstT = 0; this.shootT = d.gun.cd * GAME.diff.enemyRate;
      }
    }
  }

  shoot(p) {
    const g = this.def.gun;
    const ex = this.x + this.face * 14, ey = this.y - this.h * 0.16;
    /* 少しだけ未来位置を狙う */
    const lead = 0.16;
    const tx = p.x + p.vx * lead, ty = p.y - 6 + p.vy * lead * 0.4;
    const base = Math.atan2(ty - ey, tx - ex);
    const n = g.pellets || 1;
    for (let i = 0; i < n; i++) {
      const ang = base + rand(g.spread, -g.spread);
      GAME.bullets.push(new Bullet({
        x: ex, y: ey, vx: Math.cos(ang) * g.speed, vy: Math.sin(ang) * g.speed,
        dmg: g.dmg, owner: 'enemy', color: '#ff9a6b', src: this,
        life: g.range ? g.range / g.speed : 2.4,
      }));
    }
    FX.spark(ex, ey, 3, '#ffcf8a', 160, 0.12);
    FX.ring(ex, ey, 'rgba(255,190,120,.8)', 2, 18, 0.1, 2);
    Audio.shot(g.sound);
    Cam.kick(0.6);
  }

  /* ---------- 被弾 ---------- */
  damage(d, from, info = {}) {
    if (this.dead) return;
    if (info.tranq) {
      if (info.head || this.tranqT > 0) { this.fallAsleep(); return; }
      this.tranqT = 1.3;
      FX.text(this.x, this.y - this.h / 2 - 12, 'zzz…', '#9fe0ff', 13);
      this.state = 'combat'; this.lastSeen = { x: GAME.player.x, y: GAME.player.y };
      return;
    }
    let dmg = d;
    if (this.def.armor && !info.rush) dmg *= (1 - this.def.armor);
    this.hp -= dmg;
    this.flash = 1;
    this.vx += (info.dir || 0) * 40;
    if (!info.rush) FX.blood(info.x || this.x, info.y || this.y, info.head ? 9 : 5, info.dir > 0 ? 0.3 : Math.PI - 0.3);
    if (info.head) FX.text(this.x, this.y - this.h / 2 - 14, 'HEAD', '#ffd27a', 13, 0.6);
    Audio.hit();
    if (this.state !== 'combat' && !this.sleeping) {
      this.state = 'combat'; this.spotIcon = 1;
      this.lastSeen = { x: GAME.player.x, y: GAME.player.y };
      GAME.raiseAlert(this);
    }
    this.sleeping = false;
    if (this.hp <= 0) this.kill(info);
  }

  fallAsleep() {
    if (this.dead || this.sleeping) return;
    this.sleeping = true; this.sleepT = 32; this.tranqT = 0; this.vx = 0;
    this.state = 'sleep'; this.alertMeter = 0;
    GAME.player.stats.stealth++;
    FX.text(this.x, this.y - this.h / 2 - 16, '昏倒', '#9fe0ff', 15);
    GAME.onEnemyNeutralized(this, true);
  }

  cqcKill() {
    this.dead = true; this.state = 'dead'; this.vy = -120; this.vx = 0;
    GAME.onEnemyNeutralized(this, true);
  }

  kill(info) {
    this.dead = true; this.state = 'dead';
    this.vy = -180; this.vx = (info.dir || 0) * 90;
    GAME.player.stats.kills++;
    FX.blood(this.x, this.y, 12, 0);
    FX.text(this.x, this.y - this.h / 2 - 20, '+' + this.def.score, '#ffd27a', 13, 0.8);
    GAME.score += this.def.score;
    GAME.onEnemyNeutralized(this, false);
    if (Math.random() < 0.22) GAME.pickups.push(new Pickup('ammo', this.x, this.feet));
    else if (Math.random() < 0.1) GAME.pickups.push(new Pickup('ration', this.x, this.feet));
  }

  /* ---------- 描画 ---------- */
  drawVision(ctx) {
    if (this.dead || this.sleeping || this.state === 'combat') return;
    const e = this.eye;
    const range = this.def.sight * GAME.diff.sight * 0.92;
    const facing = this.face > 0 ? 0 : Math.PI;
    const half = this.def.fov;
    ctx.save();
    const g = ctx.createRadialGradient(e.x, e.y, 10, e.x, e.y, range);
    const warm = this.state === 'search' || this.state === 'suspect';
    g.addColorStop(0, warm ? 'rgba(255,180,60,.20)' : 'rgba(120,200,255,.13)');
    g.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(e.x, e.y);
    ctx.arc(e.x, e.y, range, facing - half, facing + half); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  draw(ctx) {
    const d = this.def;
    ctx.save();
    ctx.translate(this.x, this.feet);

    if (this.dead) {
      ctx.rotate((this.face > 0 ? 1 : -1) * Math.PI / 2 * Math.min(1, this.deadT * 3));
      ctx.globalAlpha = clamp(1.6 - this.deadT * 0.06, 0.35, 1);
    }
    ctx.scale(this.face, 1);

    if (d.quadruped) drawDog(ctx, this);
    else if (d.flying && this.type === 'drone') drawDrone(ctx, this);
    else drawTrooper(ctx, this);
    ctx.restore();

    if (this.dead) return;

    /* 頭上の情報 */
    const topY = this.y - this.h / 2 - 12;
    if (this.sleeping) {
      ctx.save(); ctx.fillStyle = '#9fe0ff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('z z z', this.x, topY - 4 + Math.sin(this.t * 2) * 2); ctx.restore();
      return;
    }
    if (this.spotIcon > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, this.spotIcon * 2);
      ctx.fillStyle = '#ff4d55'; ctx.font = '900 26px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('!', this.x, topY - 8 - (1.1 - this.spotIcon) * 14);
      ctx.restore();
    } else if (this.alertMeter > 0.05 && this.state !== 'combat') {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(this.x - 14, topY - 5, 28, 4);
      ctx.fillStyle = this.alertMeter > 0.6 ? '#ff4d55' : '#ffb43c';
      ctx.fillRect(this.x - 14, topY - 5, 28 * clamp(this.alertMeter, 0, 1), 4);
      ctx.restore();
    }
    /* HPバー */
    if (this.hp < this.maxHp) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(this.x - 16, topY + 2, 32, 3.4);
      ctx.fillStyle = '#e05a4a'; ctx.fillRect(this.x - 16, topY + 2, 32 * clamp(this.hp / this.maxHp, 0, 1), 3.4);
      ctx.restore();
    }
    /* ラッシュの刻印 */
    if (this.marked > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(this.t * 12) * 0.35;
      ctx.fillStyle = '#ffb43c'; ctx.font = '900 17px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('◆', this.x, topY - 6);
      ctx.strokeStyle = 'rgba(255,180,60,.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.h * 0.75, 0, 7); ctx.stroke();
      ctx.restore();
    }
    /* 狙撃兵のレーザー */
    if (d.laser && this.state === 'combat' && this.charge > 0) {
      const e = this.eye, p = GAME.player;
      ctx.save(); ctx.globalAlpha = 0.55 + Math.sin(this.t * 40) * 0.3;
      ctx.strokeStyle = '#ff4d55'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(p.x, p.y - 6); ctx.stroke();
      ctx.restore();
    }
  }
}

/* ---------- 兵士の描画 ---------- */
function drawTrooper(ctx, e) {
  const d = e.def, t = e.t;
  const dead = e.dead, sleep = e.sleeping;
  const hipY = -d.h * 0.45, shY = -d.h * 0.76, headY = -d.h * 0.92;
  const walking = Math.abs(e.vx) > 12 && !dead && !sleep;
  const s = walking ? Math.sin(e.walkPhase) : 0;
  const c = walking ? Math.cos(e.walkPhase) : 0;

  ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 0, d.w * 0.55, 3.4, 0, 0, 7); ctx.fill(); ctx.restore();

  /* 脚 */
  limb(ctx, -1, hipY, -s * 7, hipY + 10, 6.5, shade(d.color, -0.3));
  limb(ctx, -s * 7, hipY + 10, -s * 12, -Math.max(0, -c) * 6, 6, shade(d.color, -0.3));
  limb(ctx, 1, hipY, s * 7, hipY + 10, 7, d.color);
  limb(ctx, s * 7, hipY + 10, s * 12, -Math.max(0, c) * 6, 6.5, d.color);
  ctx.fillStyle = '#12161a';
  ctx.fillRect(s * 12 - 5, -Math.max(0, c) * 6 - 4, 11, 4);

  /* 胴 */
  ctx.fillStyle = d.color;
  ctx.beginPath();
  ctx.moveTo(-d.w * 0.34, hipY + 2); ctx.lineTo(-d.w * 0.36, shY); ctx.lineTo(d.w * 0.36, shY); ctx.lineTo(d.w * 0.34, hipY + 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(d.color, 0.18);
  ctx.fillRect(0, shY, d.w * 0.36, hipY + 2 - shY);
  /* ベスト */
  ctx.fillStyle = shade(d.color, -0.35);
  ctx.fillRect(-d.w * 0.3, shY + 3, d.w * 0.6, 9);
  ctx.fillStyle = d.accent;
  ctx.fillRect(-d.w * 0.3, shY + 4, 4, 7);
  if (d.armor) { ctx.fillStyle = '#8f9aa4'; ctx.fillRect(-d.w * 0.28, shY + 5, d.w * 0.56, 5); }

  /* 頭 */
  const nod = sleep ? 6 : 0;
  ctx.save(); ctx.translate(2, headY + nod);
  if (sleep) ctx.rotate(0.5);
  ctx.fillStyle = SN.skin; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
  ctx.fillStyle = shade(d.color, -0.25);
  ctx.beginPath(); ctx.arc(0, -1.4, 6.6, Math.PI, 0); ctx.fill();
  ctx.fillRect(-6.6, -1.6, 13.2, 2.4);
  if (e.type === 'sniperE') { ctx.fillStyle = '#63d0a0'; ctx.fillRect(1, -1.5, 6, 3); }
  else if (e.type === 'heavy') { ctx.fillStyle = '#2a3038'; ctx.fillRect(-1, -2, 8, 4.4); }
  else { ctx.fillStyle = '#12181d'; ctx.fillRect(1.5, -1.6, 5, 3); }
  ctx.restore();

  /* 腕と銃 */
  if (!dead && !sleep) {
    const aimAng = e.state === 'combat' && GAME.player ? Math.atan2((GAME.player.y - 6) - (e.y - d.h * 0.16), Math.abs(GAME.player.x - e.x)) : 0;
    const a = clamp(aimAng, -0.9, 0.9);
    const hx = Math.cos(a) * 17, hy = shY + 5 + Math.sin(a) * 15;
    limb(ctx, 0, shY + 5, hx * 0.6, (shY + 5 + hy) / 2, 5.5, shade(d.color, -0.2));
    limb(ctx, hx * 0.6, (shY + 5 + hy) / 2, hx, hy, 5, d.color);
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(a);
    if (d.melee) { /* 近接タイプは武器なし */ }
    else if (e.type === 'sniperE') { ctx.fillStyle = '#232a2e'; ctx.fillRect(-10, -2.6, 36, 4.4); ctx.fillStyle = '#111'; ctx.fillRect(0, -6, 11, 3.4); }
    else if (e.type === 'shotgunner') { ctx.fillStyle = '#3a2d22'; ctx.fillRect(-8, -2, 10, 4.4); ctx.fillStyle = '#262c31'; ctx.fillRect(2, -3, 20, 4.4); }
    else if (e.type === 'heavy') { ctx.fillStyle = '#2b3138'; ctx.fillRect(-8, -4, 32, 8); ctx.fillStyle = '#555f68'; ctx.fillRect(20, -3, 10, 6); }
    else { ctx.fillStyle = '#242a30'; ctx.fillRect(-7, -2.6, 26, 4.4); ctx.fillRect(-1, 1.4, 3.4, 6); }
    ctx.restore();
    if (e.burst > 0 || e.charge > 0) {
      ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = '#ffcf8a';
      ctx.beginPath(); ctx.arc(hx + Math.cos(a) * 22, hy + Math.sin(a) * 22, e.charge > 0 ? 2 : 4, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  /* 盾 */
  if (e.shield && !dead) {
    ctx.fillStyle = 'rgba(160,180,200,.85)';
    ctx.fillRect(d.w * 0.36, shY - 4, 7, d.h * 0.6);
    ctx.fillStyle = 'rgba(90,110,130,.9)';
    ctx.fillRect(d.w * 0.36, shY - 4, 7, 5);
    ctx.fillStyle = '#111'; ctx.fillRect(d.w * 0.36 + 1, shY + 4, 5, 6);
  }

  /* ジェットパック */
  if (e.type === 'jetpack') {
    ctx.fillStyle = '#2b3138'; ctx.fillRect(-d.w * 0.5, shY + 2, 7, 16);
    ctx.fillStyle = '#ffb43c'; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.moveTo(-d.w * 0.5 + 1, shY + 18); ctx.lineTo(-d.w * 0.5 + 6, shY + 18);
    ctx.lineTo(-d.w * 0.5 + 3.5, shY + 18 + rand(16, 8)); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  hitFlash(ctx, e.flash, d.w * 1.4, d.h, -d.h * 0.5);
}

function drawDog(ctx, e) {
  const d = e.def;
  const s = Math.sin(e.walkPhase * 1.6), c = Math.cos(e.walkPhase * 1.6);
  ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 0, 18, 3.4, 0, 0, 7); ctx.fill(); ctx.restore();
  limb(ctx, -10, -14, -12 + s * 6, -7, 4, shade(d.color, -0.3));
  limb(ctx, -12 + s * 6, -7, -12 + s * 9, 0, 3.6, shade(d.color, -0.3));
  limb(ctx, 9, -14, 10 - s * 6, -7, 4, shade(d.color, -0.3));
  limb(ctx, 10 - s * 6, -7, 10 - s * 9, 0, 3.6, shade(d.color, -0.3));
  ctx.fillStyle = d.color;
  ctx.beginPath(); ctx.ellipse(0, -16, 17, 9, 0, 0, 7); ctx.fill();
  limb(ctx, -10, -14, -13 - s * 5, -7, 4.6, d.color);
  limb(ctx, -13 - s * 5, -7, -13 - s * 8, 0, 4, d.color);
  limb(ctx, 9, -14, 12 + s * 5, -7, 4.6, d.color);
  limb(ctx, 12 + s * 5, -7, 12 + s * 8, 0, 4, d.color);
  /* 尻尾 */
  ctx.strokeStyle = d.color; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-16, -18); ctx.quadraticCurveTo(-24, -24 + c * 4, -27, -16 + c * 5); ctx.stroke();
  /* 頭 */
  ctx.fillStyle = shade(d.color, 0.1);
  ctx.beginPath(); ctx.ellipse(17, -21, 9, 7, -0.15, 0, 7); ctx.fill();
  ctx.fillStyle = shade(d.color, -0.2);
  ctx.beginPath(); ctx.moveTo(22, -22); ctx.lineTo(31, -19); ctx.lineTo(22, -16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = d.accent;
  ctx.beginPath(); ctx.moveTo(12, -27); ctx.lineTo(16, -34); ctx.lineTo(19, -26); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffcf5a'; ctx.beginPath(); ctx.arc(20, -22.5, 1.5, 0, 7); ctx.fill();
  if (e.windup > 0) { ctx.fillStyle = '#fff'; ctx.fillRect(24, -19.5, 6, 2); }
  hitFlash(ctx, e.flash, 46, 34, -16);
}

function drawDrone(ctx, e) {
  const d = e.def, t = e.t;
  ctx.save(); ctx.translate(0, -11);
  ctx.fillStyle = d.color;
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = shade(d.color, 0.25); ctx.fillRect(-17, -3, 34, 2.6);
  const bl = Math.sin(t * 40) * 9;
  ctx.strokeStyle = 'rgba(200,220,235,.45)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-17 - bl, -4); ctx.lineTo(-17 + bl, -4); ctx.moveTo(17 - bl, -4); ctx.lineTo(17 + bl, -4); ctx.stroke();
  ctx.fillStyle = d.accent;
  ctx.beginPath(); ctx.arc(6, 2, 3, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.35 + Math.sin(t * 8) * 0.2;
  ctx.beginPath(); ctx.arc(6, 2, 6, 0, 7); ctx.fill();
  ctx.restore();
  hitFlash(ctx, e.flash, 40, 26, -11);
}

/* =========================================================================
   ボス
   ========================================================================= */
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

class Boss extends Actor {
  constructor(type, x, y) {
    const d = BOSSES[type];
    super(x, y, d.w, d.h);
    this.type = type; this.def = d; this.bd = d;
    this.maxHp = d.hp; this.hp = d.hp;
    this.phase = 1; this.state = 'intro'; this.stateT = 0;
    this.face = -1; this.t = 0; this.marked = 0; this.flash = 0;
    this.attackCd = 1.6; this.atkIdx = 0; this.vuln = 0; this.stunT = 0;
    this.walkPhase = 0; this.beam = null; this.called = false;
    this.deadT = 0; this.noCQC = true; this.sleeping = false; this.shield = false;
    this.hover = d.flying ? 220 : 0;
    this.exhaustCount = 0; this.cockpit = 0;
  }

  get isVulnerable() { return this.vuln > 0 || this.stunT > 0 || this.cockpit > 0; }

  damage(d, from, info = {}) {
    if (this.dead || this.state === 'intro') return;
    let dmg = d;
    if (this.bd.machine && this.cockpit <= 0) dmg *= 0.28;
    if (this.isVulnerable) dmg *= 1.7;
    this.hp -= dmg;
    this.flash = 1;
    if (!info.rush) FX.blood(info.x || this.x, info.y || this.y, this.bd.machine ? 0 : 5, 0);
    if (this.bd.machine) FX.spark(info.x || this.x, info.y || this.y, 6, '#ffd27a', 220, 0.3);
    Audio.hit();
    if (this.isVulnerable) FX.text(this.x, this.y - this.h / 2 - 10, '弱点!', '#ffd27a', 14, 0.5);
    const ph = this.bd.phases;
    const want = ph - Math.floor(clamp(this.hp / this.maxHp, 0, 0.999) * ph);
    if (want > this.phase) this.enterPhase(want);
    if (this.hp <= 0) this.kill();
  }

  enterPhase(n) {
    this.phase = n;
    this.state = 'roar'; this.stateT = 0; this.beam = null;
    Screen.flash('#ff6a4a', 0.4); Cam.kick(14); Audio.bossRoar();
    FX.ring(this.x, this.y, '#ff6a4a', 20, 320, 0.7, 6);
    GAME.toast('PHASE ' + n, '#ff4d55');
  }

  kill() {
    this.dead = true; this.state = 'dead';
    GAME.score += this.bd.score;
    GAME.player.stats.kills++;
    Screen.flash('#fff', 0.8); Cam.kick(20); Audio.explode();
    GAME.onBossDefeated(this);
  }

  update(dt) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.marked = Math.max(0, this.marked - dt);
    this.vuln = Math.max(0, this.vuln - dt);
    this.cockpit = Math.max(0, this.cockpit - dt);
    this.stateT += dt;

    if (this.dead) {
      this.deadT += dt;
      if (this.deadT < 2.4 && Math.random() < 0.3) {
        const ex = this.x + rand(this.w / 2, -this.w / 2), ey = this.y + rand(this.h / 2, -this.h / 2);
        FX.spark(ex, ey, 8, '#ffb43c', 260, 0.5); FX.smoke(ex, ey, 3, '#5c646a', 40, 16);
        if (Math.random() < 0.4) { Audio.explode(); Cam.kick(6); }
      }
      if (!this.bd.flying) { this.vy += 1400 * dt; this.moveAndCollide(dt); }
      return;
    }

    if (this.state === 'intro') {
      this.vx = 0;
      if (this.stateT > 1.2) { this.state = 'idle'; this.stateT = 0; }
      if (!this.bd.flying) this.moveAndCollide(dt);
      return;
    }
    if (this.state === 'roar') {
      this.vx = 0;
      if (this.stateT > 1.0) { this.state = 'idle'; this.stateT = 0; this.attackCd = 0.4; }
      if (!this.bd.flying) this.moveAndCollide(dt);
      return;
    }
    if (this.stunT > 0) {
      this.stunT -= dt; this.vx *= 0.9;
      if (Math.random() < 0.2) FX.spark(this.x + rand(20, -20), this.y - 20, 2, '#ffd27a', 120, 0.3);
      if (!this.bd.flying) this.moveAndCollide(dt);
      return;
    }

    switch (this.type) {
      case 'shark': this.brainShark(dt); break;
      case 'harpy': this.brainHarpy(dt); break;
      case 'revolver': this.brainRevolver(dt); break;
      case 'vulture': this.brainVulture(dt); break;
    }

    if (!this.bd.flying) this.moveAndCollide(dt);
    else { this.x += this.vx * dt; this.y += this.vy * dt; }
    this.x = clamp(this.x, GAME.arenaX0 + this.w / 2, GAME.arenaX1 - this.w / 2);
    this.walkPhase += Math.abs(this.vx) * dt * 0.04;
  }

  faceP(p) { this.face = sign(p.x - this.x) || this.face; }
  telegraph(color = '#ff4d55') {
    if (Math.random() < 0.5) FX.spark(this.x + rand(this.w / 2, -this.w / 2), this.y - this.h / 2, 1, color, 90, 0.3);
  }

  /* ---------------- シャーク ---------------- */
  brainShark(dt) {
    const p = GAME.player;
    const dx = p.x - this.x, ad = Math.abs(dx);
    if (this.state === 'idle') {
      this.faceP(p);
      this.vx = approach(this.vx, clamp(dx, -1, 1) * (ad > 200 ? 110 : 0), 500 * dt);
      this.attackCd -= dt;
      if (this.attackCd <= 0) {
        const pool = this.phase >= 2 ? ['blast', 'charge', 'grenade', 'spin'] : ['blast', 'charge', 'grenade'];
        if (this.phase >= 2 && !this.called) { this.called = true; this.state = 'call'; this.stateT = 0; return; }
        this.state = pool[this.atkIdx++ % pool.length]; this.stateT = 0; this.shots = 0;
      }
      return;
    }
    if (this.state === 'call') {
      this.vx = 0; this.telegraph('#ffb43c');
      if (this.stateT > 0.9) {
        for (let i = 0; i < 2; i++) GAME.spawnReinforcement('smg', this.x - this.face * (120 + i * 60), this.y - 120);
        GAME.toast('シャークが増援を呼んだ', '#ff4d55');
        this.state = 'idle'; this.attackCd = 1.5;
      }
      return;
    }
    if (this.state === 'blast') {
      this.vx = approach(this.vx, 0, 900 * dt); this.faceP(p); this.telegraph();
      if (this.stateT > 0.55) {
        const volley = Math.floor((this.stateT - 0.55) / 0.24);
        if (volley > this.shots - 1 && this.shots < 3) {
          this.shots++;
          const base = Math.atan2(p.y - 8 - (this.y - 10), p.x - this.x);
          for (let i = 0; i < 7; i++) {
            const a = base + rand(0.3, -0.3);
            GAME.bullets.push(new Bullet({ x: this.x + this.face * 26, y: this.y - 10, vx: Math.cos(a) * 660, vy: Math.sin(a) * 660, dmg: 9, owner: 'enemy', color: '#ff9a6b', src: this, life: 0.8 }));
          }
          Audio.shot('shotgun'); Cam.kick(3);
          FX.spark(this.x + this.face * 30, this.y - 10, 8, '#ffcf8a', 300, 0.25);
        }
        if (this.shots >= 3 && this.stateT > 1.5) { this.state = 'idle'; this.attackCd = rand(1.5, 0.9) * GAME.diff.enemyRate; this.vuln = 0.7; }
      }
      return;
    }
    if (this.state === 'charge') {
      if (this.stateT < 0.65) {
        this.vx = approach(this.vx, -this.face * 60, 700 * dt);
        this.faceP(p); this.telegraph('#ffb43c');
        if (this.stateT < 0.05) { FX.text(this.x, this.y - this.h / 2 - 16, '突進!', '#ffb43c', 18); Audio.caution(); }
      } else {
        this.vx = this.face * 660;
        FX.dust(this.x, this.feet, 2, '#8c959c');
        GAME.hitboxes.push(new Hitbox({ x: this.x + this.face * 20, y: this.y, w: this.w, h: this.h, dmg: 21, owner: 'enemy', life: 0.05, src: this }));
        const hitWall = Math.abs(this.vx) < 30 || this.x <= GAME.arenaX0 + this.w / 2 + 4 || this.x >= GAME.arenaX1 - this.w / 2 - 4;
        if (hitWall && this.stateT > 0.8) {
          this.stunT = 2.1; this.state = 'idle'; this.attackCd = 0.8;
          Cam.kick(14); Screen.flash('#fff', 0.3); Audio.explode();
          FX.dust(this.x, this.feet, 14, '#a2acb3');
          FX.text(this.x, this.y - this.h / 2 - 20, '隙!', '#ffd27a', 20);
        }
        if (this.stateT > 1.9) { this.state = 'idle'; this.attackCd = rand(1.4, 0.8) * GAME.diff.enemyRate; this.vuln = 0.6; }
      }
      return;
    }
    if (this.state === 'grenade') {
      this.vx = approach(this.vx, 0, 900 * dt); this.faceP(p); this.telegraph('#ffb43c');
      if (this.stateT > 0.5 && this.shots < 2 && this.stateT > 0.5 + this.shots * 0.32) {
        this.shots++;
        const dxp = p.x - this.x;
        GAME.bullets.push(new Bullet({
          x: this.x + this.face * 20, y: this.y - 26,
          vx: dxp * 0.9 + rand(60, -60), vy: -320, dmg: 34, owner: 'enemy',
          rocket: true, splash: 110, color: '#ffb43c', src: this, life: 2.6,
        }));
        Audio.shot('launcher');
      }
      if (this.stateT > 1.4) { this.state = 'idle'; this.attackCd = rand(1.6, 1.0) * GAME.diff.enemyRate; }
      return;
    }
    if (this.state === 'spin') {
      this.vx = 0; this.telegraph('#ff4d55');
      if (this.stateT > 0.6 && this.shots < 3 && this.stateT > 0.6 + this.shots * 0.36) {
        this.shots++;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + this.shots * 0.22;
          GAME.bullets.push(new Bullet({ x: this.x, y: this.y - 10, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, dmg: 11, owner: 'enemy', color: '#ff7a6b', src: this, life: 2.4 }));
        }
        Audio.shot('rifle'); Cam.kick(4);
      }
      if (this.stateT > 1.9) { this.state = 'idle'; this.attackCd = rand(1.5, 0.9); this.vuln = 0.8; }
      return;
    }
  }

  /* ---------------- ハーピー ---------------- */
  brainHarpy(dt) {
    const p = GAME.player;
    if (this.state === 'idle') {
      const want = p.y - 210 + Math.sin(this.t * 1.6) * 30;
      this.vy = clamp((want - this.y) * 2.4, -230, 230);
      this.vx = approach(this.vx, clamp(p.x - this.x - sign(p.x - this.x) * 190, -1, 1) * 190, 400 * dt);
      this.faceP(p);
      this.attackCd -= dt;
      if (this.attackCd <= 0) {
        if (this.exhaustCount >= 3) { this.exhaustCount = 0; this.state = 'exhaust'; this.stateT = 0; return; }
        const pool = this.phase >= 2 ? ['snipe', 'dive', 'mines', 'sweep'] : ['snipe', 'dive', 'mines'];
        this.state = pool[this.atkIdx++ % pool.length]; this.stateT = 0; this.shots = 0;
        this.exhaustCount++;
      }
      return;
    }
    if (this.state === 'snipe') {
      this.vx *= 0.9; this.vy = clamp((p.y - 230 - this.y) * 2, -120, 120);
      this.faceP(p);
      this.aimLine = { x: p.x, y: p.y - 6 };
      if (this.stateT > 0.85 && this.shots === 0) {
        this.shots = 1;
        const a = Math.atan2(this.aimLine.y - this.y, this.aimLine.x - this.x);
        GAME.bullets.push(new Bullet({ x: this.x, y: this.y, vx: Math.cos(a) * 1600, vy: Math.sin(a) * 1600, dmg: 26, owner: 'enemy', color: '#7de0ff', src: this, life: 1.4 }));
        Audio.shot('sniper'); Cam.kick(4);
      }
      if (this.stateT > 1.2) { this.aimLine = null; this.state = 'idle'; this.attackCd = rand(1.2, 0.7) * GAME.diff.enemyRate; }
      return;
    }
    if (this.state === 'dive') {
      if (this.stateT < 0.5) {
        this.vx *= 0.86; this.vy = -60; this.faceP(p); this.telegraph('#7de0ff');
        this.diveTo = { x: p.x, y: p.y };
        if (this.stateT < 0.05) { FX.text(this.x, this.y - 40, '急降下!', '#7de0ff', 17); Audio.caution(); }
      } else if (this.stateT < 1.15) {
        const a = Math.atan2(this.diveTo.y - this.y, this.diveTo.x - this.x);
        this.vx = Math.cos(a) * 760; this.vy = Math.sin(a) * 760;
        FX.trail(this.x, this.y, 'rgba(125,224,255,.45)', 8, 0.22);
        GAME.hitboxes.push(new Hitbox({ x: this.x, y: this.y, w: 44, h: 52, dmg: 18, owner: 'enemy', life: 0.05, src: this }));
      } else {
        this.vx *= 0.9; this.vy = -140;
        if (this.stateT > 1.7) { this.state = 'idle'; this.attackCd = rand(1.1, 0.6) * GAME.diff.enemyRate; }
      }
      return;
    }
    if (this.state === 'mines') {
      this.vy = clamp((p.y - 260 - this.y) * 2, -160, 160);
      this.vx = approach(this.vx, sign(p.x - this.x) * 260, 500 * dt);
      if (this.shots < 4 && this.stateT > 0.25 + this.shots * 0.24) {
        this.shots++;
        GAME.bullets.push(new Bullet({ x: this.x, y: this.y + 18, vx: this.vx * 0.4, vy: 60, dmg: 28, owner: 'enemy', rocket: true, splash: 100, color: '#ffb43c', src: this, life: 3 }));
        Audio.blip();
      }
      if (this.stateT > 1.5) { this.state = 'idle'; this.attackCd = rand(1.2, 0.7) * GAME.diff.enemyRate; }
      return;
    }
    if (this.state === 'sweep') {
      this.vy = clamp((p.y - 250 - this.y) * 2, -150, 150);
      this.vx = approach(this.vx, this.face * -180, 400 * dt);
      if (this.stateT > 0.4 && this.shots < 16 && this.stateT > 0.4 + this.shots * 0.055) {
        this.shots++;
        const a = Math.atan2(p.y - this.y, p.x - this.x) + rand(0.34, -0.34);
        GAME.bullets.push(new Bullet({ x: this.x, y: this.y, vx: Math.cos(a) * 620, vy: Math.sin(a) * 620, dmg: 8, owner: 'enemy', color: '#7de0ff', src: this, life: 2 }));
        Audio.shot('rifle');
      }
      if (this.stateT > 1.7) { this.state = 'idle'; this.attackCd = rand(1.1, 0.6); }
      return;
    }
    if (this.state === 'exhaust') {
      /* 息切れ：着地して大きな隙をさらす */
      this.vx *= 0.9; this.vy = 340;
      this.vuln = 0.3;
      for (const s of GAME.solids) {
        if (s.oneway) continue;
        if (rectsOverlap(this.box, s) && this.vy > 0) { this.y = s.y - this.h / 2 - 1; this.vy = 0; }
      }
      if (this.stateT < 0.1) { FX.text(this.x, this.y - 44, '息切れ', '#ffd27a', 18); }
      FX.smoke(this.x - this.face * 10, this.y + 10, 1, '#8f9aa2', 20, 8);
      if (this.stateT > 2.3) { this.state = 'idle'; this.attackCd = 0.5; }
      return;
    }
  }

  /* ---------------- レヴォルヴァー ---------------- */
  brainRevolver(dt) {
    const p = GAME.player;
    const dx = p.x - this.x;
    if (this.state === 'idle') {
      this.faceP(p);
      this.vx = approach(this.vx, clamp(dx - sign(dx) * 240, -1, 1) * 150, 600 * dt);
      this.attackCd -= dt;
      if (this.attackCd <= 0) {
        const pool = this.phase >= 2 ? ['quickdraw', 'ricochet', 'blink', 'fan'] : ['quickdraw', 'ricochet', 'blink'];
        this.state = pool[this.atkIdx++ % pool.length]; this.stateT = 0; this.shots = 0;
      }
      return;
    }
    if (this.state === 'quickdraw') {
      this.vx *= 0.85; this.faceP(p); this.telegraph('#ffd27a');
      if (this.stateT > 0.45 && this.shots < 6 && this.stateT > 0.45 + this.shots * 0.09) {
        this.shots++;
        const a = Math.atan2(p.y - 6 - (this.y - 8), p.x - this.x) + rand(0.07, -0.07);
        GAME.bullets.push(new Bullet({ x: this.x + this.face * 18, y: this.y - 8, vx: Math.cos(a) * 1050, vy: Math.sin(a) * 1050, dmg: 12, owner: 'enemy', color: '#ffd27a', src: this, life: 1.6 }));
        Audio.shot('rifle'); Cam.kick(1.6);
      }
      if (this.stateT > 1.3) {
        this.state = 'reload'; this.stateT = 0;
      }
      return;
    }
    if (this.state === 'reload') {
      this.vx *= 0.9; this.vuln = 0.3;
      if (this.stateT < 0.1) FX.text(this.x, this.y - this.h / 2 - 14, '装填', '#ffd27a', 15);
      if (Math.random() < 0.2) FX.spark(this.x, this.y - 8, 1, '#ffd27a', 90, 0.4);
      if (this.stateT > 1.5) { this.state = 'idle'; this.attackCd = rand(0.9, 0.4) * GAME.diff.enemyRate; }
      return;
    }
    if (this.state === 'ricochet') {
      this.vx *= 0.85; this.faceP(p); this.telegraph('#ffd27a');
      if (this.stateT > 0.5 && this.shots < 3 && this.stateT > 0.5 + this.shots * 0.2) {
        this.shots++;
        const a = Math.atan2(p.y - this.y, p.x - this.x) + rand(0.5, -0.5) + (this.shots - 2) * 0.2;
        GAME.bullets.push(new Bullet({
          x: this.x + this.face * 18, y: this.y - 8, vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
          dmg: 14, owner: 'enemy', color: '#ffe6a3', src: this, life: 4, bounce: 4,
        }));
        Audio.shot('rifle');
      }
      if (this.stateT > 1.4) { this.state = 'idle'; this.attackCd = rand(1.2, 0.7) * GAME.diff.enemyRate; }
      return;
    }
    if (this.state === 'fan') {
      this.vx = 0; this.telegraph('#ff4d55');
      if (this.stateT > 0.55 && this.shots === 0) {
        this.shots = 1;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          GAME.bullets.push(new Bullet({ x: this.x, y: this.y - 8, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480, dmg: 11, owner: 'enemy', color: '#ffe6a3', src: this, life: 3.5, bounce: 2 }));
        }
        Audio.shot('shotgun'); Cam.kick(5);
      }
      if (this.stateT > 1.3) { this.state = 'reload'; this.stateT = 0; }
      return;
    }
    if (this.state === 'blink') {
      if (this.stateT < 0.28) { this.vx *= 0.8; this.telegraph('#cfe9ff'); }
      else if (this.blinked !== this.atkIdx) {
        this.blinked = this.atkIdx;
        FX.smoke(this.x, this.y, 8, '#c9d4dc', 60, 16);
        FX.ring(this.x, this.y, '#cfe9ff', 6, 70, 0.3, 3);
        this.x = clamp(p.x - sign(dx) * 150, GAME.arenaX0 + 40, GAME.arenaX1 - 40);
        this.y = p.y - 4;
        FX.smoke(this.x, this.y, 8, '#c9d4dc', 60, 16);
        Audio.dodge();
        this.faceP(p);
      }
      if (this.stateT > 0.6) { this.state = 'quickdraw'; this.stateT = 0; this.shots = 0; }
      return;
    }
  }

  /* ---------------- ヴァルチャー（二足歩行戦車） ---------------- */
  brainVulture(dt) {
    const p = GAME.player;
    const dx = p.x - this.x;
    if (this.beam) {
      this.beam.t += dt;
      const b = this.beam;
      if (b.t < b.warn) {
        b.ang = lerp(b.ang, Math.atan2(p.y - (this.y - 20), p.x - this.x), 1 - Math.pow(0.02, dt));
      } else if (b.t < b.warn + b.dur) {
        b.ang += b.dir * 0.9 * dt;
        const ex = this.x + Math.cos(b.ang) * 900, ey = (this.y - 20) + Math.sin(b.ang) * 900;
        if (distToSeg(p.x, p.y, this.x, this.y - 20, ex, ey) < 16) {
          if (p.iFrames > 0) { if (!b.grazed) { b.grazed = true; p.perfectDodge(this); } }
          else if (!p.rushing) p.damage(26 * dt * 12, 'enemy', { dir: sign(p.x - this.x) });
        }
        if (Math.random() < 0.5) FX.spark(this.x + Math.cos(b.ang) * rand(900, 100), (this.y - 20) + Math.sin(b.ang) * rand(900, 100), 1, '#ff6a4a', 60, 0.3);
      } else this.beam = null;
    }

    if (this.state === 'idle') {
      this.faceP(p);
      const sp = this.phase >= 3 ? 105 : 66;
      this.vx = approach(this.vx, Math.abs(dx) > 220 ? sign(dx) * sp : 0, 300 * dt);
      if (this.onGround && Math.abs(this.vx) > 10 && Math.random() < 3 * dt) { Cam.kick(2); FX.dust(this.x, this.feet, 5, '#8c959c'); }
      this.attackCd -= dt;
      if (this.attackCd <= 0) {
        const pool = this.phase >= 3 ? ['missiles', 'stomp', 'laser', 'barrage'] : (this.phase >= 2 ? ['missiles', 'stomp', 'laser'] : ['missiles', 'stomp']);
        this.state = pool[this.atkIdx++ % pool.length]; this.stateT = 0; this.shots = 0;
      }
      return;
    }
    if (this.state === 'missiles' || this.state === 'barrage') {
      const n = this.state === 'barrage' ? 8 : 4;
      this.vx *= 0.9; this.faceP(p); this.telegraph('#ff4d55');
      if (this.stateT > 0.6 && this.shots < n && this.stateT > 0.6 + this.shots * 0.16) {
        this.shots++;
        const a = -1.35 + rand(0.5, -0.5);
        GAME.bullets.push(new Bullet({
          x: this.x + this.face * 30, y: this.y - 44,
          vx: Math.cos(a) * 420 + sign(dx) * 160, vy: Math.sin(a) * 420,
          dmg: 28, owner: 'enemy', rocket: true, splash: 110, color: '#ffb43c', src: this, life: 3.4,
        }));
        Audio.shot('launcher'); Cam.kick(2);
      }
      if (this.stateT > 0.7 + n * 0.16 + 0.4) { this.state = 'idle'; this.attackCd = rand(1.4, 0.8) * GAME.diff.enemyRate; }
      return;
    }
    if (this.state === 'laser') {
      this.vx *= 0.9;
      if (this.stateT < 0.05) {
        this.beam = { t: 0, warn: 0.95, dur: 1.5, ang: Math.atan2(p.y - this.y, p.x - this.x), dir: sign(p.x - this.x) || 1, grazed: false };
        FX.text(this.x, this.y - this.h / 2 - 18, 'レーザー照射', '#ff4d55', 17);
        Audio.caution();
      }
      if (this.stateT > 2.6) { this.state = 'idle'; this.attackCd = rand(1.5, 0.9) * GAME.diff.enemyRate; }
      return;
    }
    if (this.state === 'stomp') {
      if (this.stateT < 0.55) {
        this.vx *= 0.85; this.faceP(p); this.telegraph('#ffb43c');
        if (this.stateT < 0.05) { FX.text(this.x, this.y - this.h / 2 - 18, '踏みつけ!', '#ffb43c', 18); Audio.caution(); }
      } else if (this.stateT < 0.9) {
        this.vy = -520; this.onGround = false;
      } else {
        this.vy = Math.max(this.vy, 900);
        if (this.onGround && !this.stomped) {
          this.stomped = true;
          Cam.kick(20); Screen.flash('#fff', 0.34); Audio.explode();
          FX.dust(this.x, this.feet, 22, '#a2acb3');
          FX.ring(this.x, this.feet, '#ffd27a', 20, 260, 0.5, 6);
          for (const s of [-1, 1]) {
            for (let i = 0; i < 3; i++) {
              GAME.bullets.push(new Bullet({ x: this.x, y: this.feet - 12 - i * 4, vx: s * (330 + i * 90), vy: -40 - i * 20, dmg: 16, owner: 'enemy', color: '#ffd27a', src: this, life: 2 }));
            }
          }
          this.cockpit = 4.0;
          FX.text(this.x, this.y - this.h / 2 - 24, 'コックピット露出!', '#ffd27a', 18, 1.2);
        }
        if (this.stateT > 1.9) { this.stomped = false; this.state = 'idle'; this.attackCd = rand(1.3, 0.7) * GAME.diff.enemyRate; }
      }
      return;
    }
  }

  /* ---------- 描画 ---------- */
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.feet);
    if (this.dead && !this.bd.machine) ctx.rotate((this.face > 0 ? 1 : -1) * Math.PI / 2 * Math.min(1, this.deadT * 2));
    ctx.scale(this.face, 1);
    switch (this.type) {
      case 'shark': drawShark(ctx, this); break;
      case 'harpy': drawHarpy(ctx, this); break;
      case 'revolver': drawRevolver(ctx, this); break;
      case 'vulture': drawVulture(ctx, this); break;
    }
    ctx.restore();

    /* レーザー */
    if (this.beam) {
      const b = this.beam;
      const ox = this.x, oy = this.y - 20;
      const ex = ox + Math.cos(b.ang) * 1100, ey = oy + Math.sin(b.ang) * 1100;
      ctx.save();
      if (b.t < b.warn) {
        ctx.globalAlpha = 0.5 + Math.sin(b.t * 40) * 0.3;
        ctx.strokeStyle = '#ff4d55'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,90,80,.55)'; ctx.lineWidth = 26;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.restore();
    }
    /* 狙撃線 */
    if (this.aimLine) {
      ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(this.t * 40) * 0.3;
      ctx.strokeStyle = '#7de0ff'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.aimLine.x, this.aimLine.y); ctx.stroke();
      ctx.restore();
    }
    if (this.marked > 0 && !this.dead) {
      ctx.save(); ctx.globalAlpha = 0.6 + Math.sin(this.t * 12) * 0.3;
      ctx.fillStyle = '#ffb43c'; ctx.font = '900 20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('◆', this.x, this.y - this.h / 2 - 14);
      ctx.restore();
    }
  }
}

/* ---------- ボスの見た目 ---------- */
function bossFlash(ctx, b, w, h) {
  hitFlash(ctx, b.flash, w, h, -h * 0.5);
}

function drawShark(ctx, b) {
  const t = b.t, s = Math.sin(b.walkPhase);
  ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 6, 0, 0, 7); ctx.fill(); ctx.restore();
  const lean = b.state === 'charge' && b.stateT > 0.65 ? 6 : 0;
  /* 脚 */
  limb(ctx, -4, -30, -8 - s * 8, -16, 11, '#39432f');
  limb(ctx, -8 - s * 8, -16, -10 - s * 11, 0, 10, '#39432f');
  limb(ctx, 5, -30, 8 + s * 8, -16, 12, '#4a5741');
  limb(ctx, 8 + s * 8, -16, 10 + s * 11, 0, 11, '#4a5741');
  ctx.fillStyle = '#161a12'; ctx.fillRect(4 + s * 11, -6, 16, 6); ctx.fillRect(-18 - s * 11, -6, 16, 6);
  /* 胴 */
  ctx.fillStyle = b.def.color;
  ctx.beginPath();
  ctx.moveTo(-19, -28); ctx.lineTo(-23 + lean, -62); ctx.lineTo(23 + lean, -62); ctx.lineTo(19, -28);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5d6b57'; ctx.fillRect(0, -62, 23, 34);
  /* 装甲板 */
  ctx.fillStyle = '#2e3628'; ctx.fillRect(-21, -58, 42, 14);
  ctx.fillStyle = b.def.accent; ctx.fillRect(-21, -58, 6, 14);
  ctx.fillStyle = '#6d7a85'; ctx.fillRect(-24 + lean, -64, 16, 9); ctx.fillRect(10 + lean, -64, 16, 9);
  /* 頭 */
  ctx.save(); ctx.translate(4 + lean, -70);
  ctx.fillStyle = SN.skin; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#3a3229'; ctx.beginPath(); ctx.arc(0, 3, 8, 0, Math.PI); ctx.fill();   /* ひげ */
  ctx.fillStyle = '#2a3129'; ctx.fillRect(-9, -6, 18, 5);
  ctx.fillStyle = b.def.accent; ctx.fillRect(-9, -6, 18, 2);
  ctx.fillStyle = '#ff5f4a'; ctx.beginPath(); ctx.arc(4, -1.5, 1.8, 0, 7); ctx.fill();
  ctx.restore();
  /* 大型ショットガン */
  const raise = b.state === 'blast' ? -0.35 : 0.15;
  ctx.save(); ctx.translate(16, -48); ctx.rotate(raise);
  ctx.fillStyle = '#2b2118'; ctx.fillRect(-14, -4, 18, 9);
  ctx.fillStyle = '#3a434b'; ctx.fillRect(4, -5, 34, 10);
  ctx.fillStyle = '#5f6a73'; ctx.fillRect(34, -6, 8, 12);
  ctx.restore();
  if (b.stunT > 0) {
    ctx.save(); ctx.fillStyle = '#ffd27a'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) ctx.fillText('★', Math.sin(t * 6 + i * 2) * 14, -84 - i * 2);
    ctx.restore();
  }
  bossFlash(ctx, b, 60, 80);
}

function drawHarpy(ctx, b) {
  const t = b.t;
  ctx.save();
  /* ジェットの炎 */
  const thr = b.state === 'dive' ? 26 : 14;
  ctx.globalAlpha = 0.85; ctx.fillStyle = '#7de0ff';
  ctx.beginPath(); ctx.moveTo(-12, -18); ctx.lineTo(-4, -18); ctx.lineTo(-8, -18 + rand(thr, thr * 0.4)); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(-10, -18); ctx.lineTo(-6, -18); ctx.lineTo(-8, -18 + rand(thr * 0.5, 4)); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  /* 翼のような安定翼 */
  ctx.fillStyle = '#2b3542';
  ctx.beginPath(); ctx.moveTo(-8, -40); ctx.lineTo(-30, -50 + Math.sin(t * 6) * 3); ctx.lineTo(-8, -30); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(8, -40); ctx.lineTo(26, -52 + Math.sin(t * 6 + 1) * 3); ctx.lineTo(8, -30); ctx.closePath(); ctx.fill();
  ctx.restore();
  /* 脚 */
  limb(ctx, -2, -26, -5, -14, 5, '#333c4a');
  limb(ctx, -5, -14, -7, -2, 4.6, '#333c4a');
  limb(ctx, 3, -26, 6, -14, 5.4, b.def.color);
  limb(ctx, 6, -14, 8, -2, 5, b.def.color);
  /* 胴 */
  ctx.fillStyle = b.def.color;
  ctx.beginPath(); ctx.moveTo(-8, -24); ctx.lineTo(-9, -44); ctx.lineTo(9, -44); ctx.lineTo(8, -24); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#54607a'; ctx.fillRect(0, -44, 9, 20);
  ctx.fillStyle = '#232a35'; ctx.fillRect(-9, -42, 18, 7);
  /* ジェットパック */
  ctx.fillStyle = '#232a35'; ctx.fillRect(-14, -42, 8, 24);
  ctx.fillStyle = b.def.accent; ctx.fillRect(-14, -38, 8, 3);
  /* 頭 */
  ctx.save(); ctx.translate(2, -50);
  ctx.fillStyle = SN.skin; ctx.beginPath(); ctx.arc(0, 0, 6.6, 0, 7); ctx.fill();
  ctx.fillStyle = '#2b3542'; ctx.beginPath(); ctx.arc(0, -1, 7.2, Math.PI, 0); ctx.fill();
  ctx.fillStyle = b.def.accent; ctx.globalAlpha = 0.85; ctx.fillRect(-2, -2.5, 9, 4);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#8b6a3f';                              /* 後ろで束ねた髪 */
  ctx.beginPath(); ctx.moveTo(-5, -3); ctx.quadraticCurveTo(-16, 2 + Math.sin(t * 5) * 2, -13, 12); ctx.quadraticCurveTo(-6, 6, -4, 1); ctx.closePath(); ctx.fill();
  ctx.restore();
  /* 銃 */
  ctx.save(); ctx.translate(10, -36); ctx.rotate(b.state === 'snipe' ? -0.1 : 0.35);
  ctx.fillStyle = '#232a2e'; ctx.fillRect(-8, -2.6, 34, 5);
  ctx.fillStyle = '#111'; ctx.fillRect(2, -6, 12, 3.4);
  ctx.restore();
  bossFlash(ctx, b, 40, 56);
}

function drawRevolver(ctx, b) {
  const t = b.t, s = Math.sin(b.walkPhase);
  ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 0, 17, 4, 0, 0, 7); ctx.fill(); ctx.restore();
  limb(ctx, -2, -24, -5 - s * 6, -12, 6.5, '#3b3129');
  limb(ctx, -5 - s * 6, -12, -7 - s * 9, 0, 6, '#3b3129');
  limb(ctx, 2, -24, 5 + s * 6, -12, 7, b.def.color);
  limb(ctx, 5 + s * 6, -12, 7 + s * 9, 0, 6.5, b.def.color);
  ctx.fillStyle = '#191512'; ctx.fillRect(2 + s * 9, -5, 12, 5);
  /* ロングコート */
  ctx.fillStyle = '#3d332a';
  ctx.beginPath();
  ctx.moveTo(-12, -40); ctx.lineTo(-15, -6 + Math.sin(t * 3) * 2); ctx.lineTo(-4, -10);
  ctx.lineTo(4, -10); ctx.lineTo(14, -6 + Math.sin(t * 3 + 1) * 2); ctx.lineTo(12, -40);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = b.def.color;
  ctx.beginPath(); ctx.moveTo(-9, -24); ctx.lineTo(-10, -42); ctx.lineTo(10, -42); ctx.lineTo(9, -24); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5d4f42'; ctx.fillRect(0, -42, 10, 18);
  ctx.fillStyle = '#241d17'; ctx.fillRect(-10, -30, 20, 4);
  /* 頭とハット */
  ctx.save(); ctx.translate(2, -49);
  ctx.fillStyle = SN.skin; ctx.beginPath(); ctx.arc(0, 0, 6.4, 0, 7); ctx.fill();
  ctx.fillStyle = '#c8bda9'; ctx.beginPath(); ctx.moveTo(-6, 2); ctx.quadraticCurveTo(-12, 6, -8, 12); ctx.quadraticCurveTo(-3, 6, -2, 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2f2820';
  ctx.beginPath(); ctx.ellipse(0, -4, 15, 3.2, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-7, -4); ctx.lineTo(-5, -13); ctx.lineTo(6, -13); ctx.lineTo(7.5, -4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = b.def.accent; ctx.beginPath(); ctx.arc(4, -1, 1.5, 0, 7); ctx.fill();
  ctx.restore();
  /* リボルバー */
  const a = b.state === 'quickdraw' || b.state === 'fan' ? -0.15 : 0.5;
  ctx.save(); ctx.translate(12, -34); ctx.rotate(a);
  ctx.fillStyle = '#1f242a'; ctx.fillRect(-4, -2.4, 20, 4.4);
  ctx.fillStyle = '#3c4650'; ctx.beginPath(); ctx.arc(1, 0, 4, 0, 7); ctx.fill();
  ctx.fillStyle = '#5a3d22'; ctx.fillRect(-6, 1, 5, 8);
  ctx.restore();
  bossFlash(ctx, b, 36, 58);
}

function drawVulture(ctx, b) {
  const t = b.t, s = Math.sin(b.walkPhase * 0.8);
  ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 0, 60, 9, 0, 0, 7); ctx.fill(); ctx.restore();
  const col = b.def.color, dark = shade(col, -0.35), lite = shade(col, 0.2);
  /* 逆関節の脚 */
  const legs = [{ o: -22, p: s }, { o: 22, p: -s }];
  for (const L of legs) {
    const hipX = L.o, hipY = -66;
    const kneeX = L.o + 26 + L.p * 12, kneeY = -40;
    const ankX = L.o + 6 + L.p * 20, ankY = -14;
    const footX = L.o + L.p * 22;
    limb(ctx, hipX, hipY, kneeX, kneeY, 21, L.o < 0 ? dark : col);
    limb(ctx, kneeX, kneeY, ankX, ankY, 17, L.o < 0 ? dark : col);
    ctx.fillStyle = L.o < 0 ? dark : lite;
    ctx.beginPath(); ctx.arc(kneeX, kneeY, 11, 0, 7); ctx.fill();
    ctx.fillStyle = L.o < 0 ? dark : lite;
    ctx.fillRect(footX - 16, -8, 34, 8);
    ctx.fillStyle = '#1b2026'; ctx.fillRect(footX - 18, -4, 40, 4);
  }
  /* 本体 */
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-46, -60); ctx.lineTo(-52, -104); ctx.lineTo(40, -116); ctx.lineTo(52, -80); ctx.lineTo(30, -56);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = lite;
  ctx.beginPath(); ctx.moveTo(6, -58); ctx.lineTo(10, -114); ctx.lineTo(40, -116); ctx.lineTo(52, -80); ctx.lineTo(30, -56); ctx.closePath(); ctx.fill();
  /* ミサイルポッド */
  ctx.fillStyle = dark; ctx.fillRect(-52, -112, 30, 20);
  ctx.fillStyle = '#20262c';
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { ctx.beginPath(); ctx.arc(-46 + i * 9, -107 + j * 9, 3, 0, 7); ctx.fill(); }
  /* コックピット（弱点） */
  const open = b.cockpit > 0;
  ctx.save(); ctx.translate(26, -92);
  ctx.fillStyle = open ? '#ffd27a' : '#1a2430';
  ctx.beginPath(); ctx.moveTo(-14, 8); ctx.lineTo(-10, -10); ctx.lineTo(14, -12); ctx.lineTo(16, 8); ctx.closePath(); ctx.fill();
  if (open) {
    ctx.globalAlpha = 0.5 + Math.sin(t * 16) * 0.35; ctx.fillStyle = '#ff6a4a';
    ctx.beginPath(); ctx.moveTo(-14, 8); ctx.lineTo(-10, -10); ctx.lineTo(14, -12); ctx.lineTo(16, 8); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  } else {
    ctx.strokeStyle = '#6f8090'; ctx.lineWidth = 1.6; ctx.stroke();
  }
  ctx.restore();
  /* 頭部センサー */
  ctx.save(); ctx.translate(40, -110);
  ctx.fillStyle = dark; ctx.fillRect(-12, -12, 26, 16);
  ctx.fillStyle = b.def.accent;
  ctx.globalAlpha = 0.6 + Math.sin(t * 8) * 0.3;
  ctx.fillRect(-6, -8, 18, 5);
  ctx.restore();
  ctx.fillStyle = b.def.accent; ctx.globalAlpha = 0.5 + Math.sin(t * 5) * 0.3;
  ctx.fillRect(-40, -74, 8, 4); ctx.globalAlpha = 1;
  bossFlash(ctx, b, 130, 130);
}
