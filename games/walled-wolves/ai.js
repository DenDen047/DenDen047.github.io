/* =========================================================================
   WALLED WOLVES ― 住民AI
   歩いて仕事をこなし、夜に見たものを覚えていて、会議で疑いを口にする。
   狼だけは仕事のふりをして、仲間をかばい、別の誰かへ票を誘導する。
   ========================================================================= */

const SPEED_WALK = 92;
const SPEED_WOLF = 118;

/* ---------- 住民ひとりぶんの状態 ---------- */
function makeActor(idx, look, house, isPlayer) {
  return {
    idx, look, house, isPlayer,
    name: look.name,
    role: 'villager',
    alive: true, ghost: false,
    x: house.porch.x, y: house.porch.y,
    face: 'S', walkPhase: 0, moving: false,
    wolfForm: false,
    speed: SPEED_WALK,
    path: [], job: null, jobT: 0,
    chores: [], choreDone: 0,
    hiding: false, sleeping: false,
    inHouse: null,
    // 記憶
    suspicion: {},          // idx -> 疑い度
    seenOutAtNight: {},     // idx -> 夜に外で見た回数
    seerResults: {},        // idx -> 'wolf' | 'human'（占い師のみ）
    claimedRole: null,      // 会議で名乗った役職
    saidThisMeeting: false,
    voteTarget: -1,
    lastSpoke: '',
    trustSeer: {},          // idx -> 占いCOへの信用
    deathNight: -1,
    bodyFound: false,
    bodyX: 0, bodyY: 0,
  };
}

/* ---------- 移動 ---------- */
function moveActor(a, town, dt) {
  if (!a.path.length) { a.moving = false; a.stuck = 0; a.wpTime = 0; return; }

  // ひとつの通過点にいつまでも手間取るなら見切って次へ進む
  a.wpTime = (a.wpTime || 0) + dt;
  if (a.wpTime > 6.5) { nextWaypoint(a); return; }

  const tgt = a.path[0];
  let dx = tgt.x - a.x, dy = tgt.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 7) { nextWaypoint(a); a.moving = a.path.length > 0; return; }
  dx /= d; dy /= d;
  const sp = a.speed * dt;
  const px = a.x, py = a.y;
  stepWithCollision(a, dx * sp, dy * sp, town);
  a.moving = true;
  a.walkPhase += dt * 11;
  if (Math.abs(dx) > Math.abs(dy)) a.face = dx > 0 ? 'E' : 'W';
  else a.face = dy > 0 ? 'S' : 'N';

  // 建物の角で詰まったら、進行方向の真横へ迂回点を差し込んで回り込む
  const moved = Math.hypot(a.x - px, a.y - py);
  if (moved < sp * 0.4) {
    a.stuck = (a.stuck || 0) + dt;
    if (a.stuck > 0.45) {
      a.stuck = 0;
      a.detours = (a.detours || 0) + 1;
      if (a.detours > 3 || a.path.length > 7) {
        // 迂回を重ねても抜けられない。この移動そのものを諦める
        a.path = []; a.stuck = 0; a.wpTime = 0; a.detours = 0; a.moving = false;
        return;
      } else {
        // 建物の角を回り込む。壁の中に置いても意味がないので空いている側を選ぶ
        a.detourSide = -(a.detourSide || 1);
        let placed = false;
        for (const side of [a.detourSide, -a.detourSide]) {
          const k = 74 * side;
          const nx = a.x - dy * k, ny = a.y + dx * k;
          if (!hitsSolid(nx, ny, 12, town)) {
            a.path.unshift({ x: nx, y: ny });
            a.detourSide = side; placed = true; break;
          }
        }
        if (!placed) nextWaypoint(a);
      }
    }
  } else {
    a.stuck = 0;
  }
}

function nextWaypoint(a) {
  a.path.shift();
  a.stuck = 0; a.wpTime = 0; a.detours = 0;
  a.moving = a.path.length > 0;
}

function stepWithCollision(a, mx, my, town) {
  const R = 9;
  let nx = a.x + mx;
  if (!hitsSolid(nx, a.y, R, town)) a.x = nx;
  let ny = a.y + my;
  if (!hitsSolid(a.x, ny, R, town)) a.y = ny;
}

function hitsSolid(x, y, r, town) {
  for (const s of town.solids) {
    if (x + r > s.x && x - r < s.x + s.w && y + r > s.y && y - r < s.y + s.h) return true;
  }
  return false;
}

/* 広場の縁の一点。街の道はすべて広場から放射状に伸びているので、
   いったん広場へ出てから向かえば、家や仕事場の裏で行き詰まらない */
function ringPoint(town, x, y) {
  const ang = Math.atan2(y - town.cy, x - town.cx);
  return {
    x: town.cx + Math.cos(ang) * town.plaza.rx * 0.86,
    y: town.cy + Math.sin(ang) * town.plaza.ry * 0.86,
  };
}

function inPlaza(town, x, y) {
  const dx = (x - town.cx) / town.plaza.rx, dy = (y - town.cy) / town.plaza.ry;
  return dx * dx + dy * dy <= 1;
}

/* 目的地までの経路を引く。必要なら広場を経由する */
function pathTo(a, town, dest, tail) {
  const p = [];
  if (!inPlaza(town, a.x, a.y)) p.push(ringPoint(town, a.x, a.y));
  const rb = ringPoint(town, dest.x, dest.y);
  const from = p.length ? p[0] : a;
  if (Math.hypot(rb.x - from.x, rb.y - from.y) > 46) p.push(rb);
  p.push(dest);
  a.path = tail ? p.concat(tail) : p;
  a.detours = 0;
}

/* 家へ向かう。AI は玄関先まで歩き、着いたら中へ入ったものとして扱う。
   狭い戸口で延々と足踏みさせないための割り切り（プレイヤーは実際に歩く） */
function pathToHouse(a, town, h, dest) {
  pathTo(a, town, { x: h.porch.x, y: h.porch.y });
  a.enterHouse = h;
  a.enterDest = dest || h.center;
}

/* =========================================================================
   昼の行動
   ========================================================================= */
function dayThink(a, G) {
  if (!a.alive || a.isPlayer) return;
  if (a.job) {
    a.jobT -= G.dt;
    if (a.jobT <= 0) {
      // 村人陣営だけが実際に仕事を進める。狼は同じ場所で同じ時間ふりをする
      if (a.role !== 'wolf' && a.chores.length) {
        const c = a.chores.find(c => !c.done && c.station === a.job.key);
        if (c) { c.done = true; a.choreDone++; G.choreDone++; }
      }
      a.job = null;
    }
    return;
  }
  if (a.path.length) return;

  // 次の行き先を決める
  const r = G.rng();
  if (r < 0.86) {
    const remain = a.chores.filter(c => !c.done);
    const key = remain.length
      ? remain[Math.floor(G.rng() * remain.length)].station
      : CHORES[Math.floor(G.rng() * CHORES.length)].id;
    const st = G.town.stations.find(s => s.key === key);
    if (st) {
      pathTo(a, G.town, { x: st.cx + (G.rng() - 0.5) * 30, y: st.cy + st.h * 0.62 });
      a.pendingJob = st;
      return;
    }
  }
  // 広場をうろつく
  const ang = G.rng() * 6.284, rr = G.rng();
  pathTo(a, G.town, {
    x: G.town.cx + Math.cos(ang) * G.town.plaza.rx * 0.8 * rr,
    y: G.town.cy + Math.sin(ang) * G.town.plaza.ry * 0.8 * rr,
  });
  a.pendingJob = null;
}

function dayArrive(a, G) {
  if (a.pendingJob) {
    const def = CHORES.find(c => c.id === a.pendingJob.key);
    a.job = { key: a.pendingJob.key, station: a.pendingJob };
    a.jobT = def ? def.secs : 3;
    a.pendingJob = null;
  }
}

/* =========================================================================
   夜の行動
   ========================================================================= */
function nightPlan(a, G) {
  a.hiding = false; a.sleeping = false; a.nightDone = false;
  a.nightTarget = null;
  a.readyHunt = false; a.hunted = false;
  a.enterHouse = null; a.enterDest = null;
  if (!a.alive) { a.path = []; return; }
  if (a.isPlayer) { a.path = []; return; }

  const others = G.actors.filter(o => o.alive && o !== a);

  if (a.role === 'wolf') {
    // 仲間以外から、いちばん怖い相手（占い師を名乗った者）か疑いの薄い相手を狙う
    const prey = others.filter(o => o.role !== 'wolf');
    if (!prey.length) { a.path = []; return; }
    let best = prey[0], bestScore = -1e9;
    for (const o of prey) {
      let sc = G.rng() * 26;
      if (o.claimedRole === 'seer') sc += 34;
      if (o.claimedRole === 'knight') sc += 22;
      if (o.idx === a.lastPrey) sc -= 70;      // 昨夜しくじった家には戻らない
      sc -= (a.suspicion[o.idx] || 0) * 0.4;   // 疑われてる人は吊れるので後回し
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    a.nightTarget = best;
    a.lastPrey = best.idx;
    a.wolfForm = true;
    a.speed = SPEED_WOLF;
    pathToHouse(a, G.town, best.house, best.house.bedC);
    a.nightAction = 'hunt';
  } else if (a.role === 'seer') {
    const unknown = others.filter(o => a.seerResults[o.idx] === undefined);
    const pool = unknown.length ? unknown : others;
    let best = pool[0], bestScore = -1e9;
    for (const o of pool) {
      const sc = (a.suspicion[o.idx] || 0) + G.rng() * 18;
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    a.nightTarget = best;
    // 窓の外まで行って覗く
    pathTo(a, G.town, { x: best.house.porch.x + 26, y: best.house.porch.y - 8 });
    a.nightAction = 'peek';
  } else if (a.role === 'knight') {
    let best = others[0], bestScore = -1e9;
    for (const o of others) {
      let sc = G.rng() * 34;
      if (o.claimedRole === 'seer') sc += 70;
      if (o.idx === a.lastGuard) sc -= 26;    // 同じ家ばかり守らない
      sc -= (a.suspicion[o.idx] || 0) * 0.8;
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    a.nightTarget = best;
    pathTo(a, G.town, { x: best.house.porch.x, y: best.house.porch.y });
    a.nightAction = 'guard';
  } else {
    const t = TRAITS[a.look.trait];
    const hide = !a.hidBurned && G.rng() < t.hide * 0.6;
    const dest = hide ? a.house.chestC : a.house.bedC;
    pathToHouse(a, G.town, a.house, dest);
    a.nightAction = hide ? 'hide' : 'sleep';
  }
}

function nightArrive(a, G) {
  if (a.nightDone) return;
  a.nightDone = true;
  if (a.enterHouse) {
    a.x = a.enterDest.x; a.y = a.enterDest.y;
    a.inHouse = a.enterHouse;
    a.enterHouse = null;
  }
  switch (a.nightAction) {
    case 'hide': a.hiding = true; break;
    case 'sleep': a.sleeping = true; break;
    case 'guard': /* 玄関先で立ち番 */ break;
    case 'peek': {
      const t = a.nightTarget;
      if (t && t.alive) {
        a.seerResults[t.idx] = t.role === 'wolf' ? 'wolf' : 'human';
        if (t.role === 'wolf') a.suspicion[t.idx] = (a.suspicion[t.idx] || 0) + 120;
        else a.suspicion[t.idx] = (a.suspicion[t.idx] || 0) - 90;
      }
      break;
    }
    case 'hunt': {
      // 家に潜り込んだだけ。街が寝静まるまで牙は使わない
      a.readyHunt = true;
      break;
    }
    default: break;
  }
}

/* =========================================================================
   目撃（夜、外を歩いている者を見る）
   ========================================================================= */
function noticeAtNight(G) {
  const alive = G.actors.filter(a => a.alive);
  for (const a of alive) {
    if (a.sleeping || a.hiding) continue;
    if (a.isPlayer) continue;
    for (const o of alive) {
      if (o === a || o.sleeping || o.hiding) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d > 190) continue;
      if (!hasLineOfSight(a, o, G.town)) continue;
      a.seenOutAtNight[o.idx] = (a.seenOutAtNight[o.idx] || 0) + G.dt;
      if (a.role === 'wolf' && o.role === 'wolf') continue;   // 狼同士は互いを売らない
      if (o.wolfForm) {
        a.sawWolf = a.sawWolf || {};
        a.sawWolf[o.idx] = (a.sawWolf[o.idx] || 0) + G.dt;
        a.suspicion[o.idx] = (a.suspicion[o.idx] || 0) + G.dt * 78;
      } else {
        a.suspicion[o.idx] = (a.suspicion[o.idx] || 0) + G.dt * 6;
      }
    }
  }
}

function hasLineOfSight(a, b, town) {
  const steps = 9;
  for (let i = 1; i < steps; i++) {
    const x = a.x + (b.x - a.x) * (i / steps);
    const y = a.y + (b.y - a.y) * (i / steps);
    for (const s of town.solids) {
      if (s.kind === 'prop') continue;
      if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h) return false;
    }
  }
  return true;
}

/* =========================================================================
   会議 ― 発言
   ========================================================================= */
const TONE = {
  bold:    (s) => s.replace(/。$/, 'に決まってる。'),
  loud:    (s) => s + '　みんな聞いてくれ！',
  timid:   (s) => s.replace(/。$/, '……かもしれない。'),
  quiet:   (s) => '……' + s,
  logical: (s) => s,
  calm:    (s) => s,
  kind:    (s) => s,
  sly:     (s) => s,
};

function nameOf(G, idx) {
  const a = G.actors[idx];
  return a ? a.name : '誰か';
}

function makeSpeech(a, G) {
  const others = G.actors.filter(o => o.alive && o !== a);
  if (!others.length) return null;
  const t = TRAITS[a.look.trait];
  const roll = G.rng();

  // 占い師は結果が出たら名乗る
  if (a.role === 'seer') {
    const found = Object.keys(a.seerResults).find(k => a.seerResults[k] === 'wolf' && G.actors[k].alive);
    if (found !== undefined && a.claimedRole !== 'seer') {
      a.claimedRole = 'seer';
      return { text: `私は占い師だ。昨夜${nameOf(G, +found)}の家を覗いた。あれは人だった姿じゃない。人狼だ。`, target: +found, kind: 'seer_co' };
    }
    if (a.claimedRole === 'seer') {
      const last = a.lastPeek;
      a.reported = a.reported || {};
      if (last !== undefined && !a.reported[last] && a.seerResults[last] !== undefined) {
        a.reported[last] = true;
        const r = a.seerResults[last];
        return {
          text: `昨夜は${nameOf(G, last)}を見た。${r === 'wolf' ? '人狼だった。今日はここに票を集めてくれ。' : '人だった。この人は白だ。'}`,
          target: last, kind: 'seer_result',
        };
      }
    }
  }

  // 騎士は終盤に名乗る
  if (a.role === 'knight' && a.claimedRole !== 'knight' && G.day >= 3 && roll < 0.4) {
    a.claimedRole = 'knight';
    const g = a.lastGuard !== undefined ? nameOf(G, a.lastGuard) : '';
    return { text: `私は騎士だ。昨夜は${g || 'ある家'}の前に立っていた。疑うなら私の代わりに誰が守る。`, target: -1, kind: 'knight_co' };
  }

  // 狼は占い師を騙るか、他人へ票を流す
  if (a.role === 'wolf') {
    const seerClaimed = G.actors.find(o => o.alive && o.claimedRole === 'seer' && o.role !== 'wolf');
    if (seerClaimed && a.claimedRole !== 'seer' && roll < 0.34 && G.day >= 2) {
      a.claimedRole = 'seer';
      const fake = others.filter(o => o.role !== 'wolf' && o !== seerClaimed);
      const v = fake.length ? fake[Math.floor(G.rng() * fake.length)] : seerClaimed;
      a.fakeResult = v.idx;
      return { text: `待て、私も占い師だ。${seerClaimed.name}は偽物だ。私が見たのは${v.name}―― こいつが人狼だ。`, target: v.idx, kind: 'fake_seer' };
    }
    const prey = others.filter(o => o.role !== 'wolf');
    if (prey.length) {
      const v = prey.reduce((b, o) =>
        ((G.pressure[o.idx] || 0) + G.rng() * 12) > ((G.pressure[b.idx] || 0) + 6) ? o : b, prey[0]);
      const lines = [
        `${v.name}、昨日から様子がおかしい。ずっと人の顔色をうかがっている。`,
        `${v.name}の話は筋が通らない。私は${v.name}に入れる。`,
        `${v.name}が夜、家の外にいるのを見た気がする。見間違いならいい。`,
      ];
      return { text: TONE[a.look.trait](lines[Math.floor(G.rng() * lines.length)]), target: v.idx, kind: 'accuse' };
    }
  }

  // 獣を見たという証言は真っ先に出る
  const beast = Object.keys(a.sawWolf || {}).filter(k => (a.sawWolf[k] > 0.7) && G.actors[k].alive);
  if (beast.length && a.role !== 'wolf') {
    const v = +beast[Math.floor(G.rng() * beast.length)];
    if (!a.toldBeast || !a.toldBeast[v]) {
      a.toldBeast = a.toldBeast || {};
      a.toldBeast[v] = true;
      G.beastCalled = G.beastCalled || {};
      const n = nameOf(G, v);
      const first = [
        `昨夜、獣を見た。四つ足でも犬でもない、立って歩く獣だった。${n}のいるはずの場所から出てきた。`,
        `${n}の家の前で、赤い目が二つ光った。あれは人の顔じゃない。`,
        `言うぞ。私は昨夜、${n}が獣に変わるところを見てしまった。`,
      ];
      const echo = [
        `${n}のことなら、私も見た。あの影は人のものじゃない。`,
        `私も同じものを見た。${n}だ。間違いない。`,
        `やはりか。私も昨夜、${n}の方角で毛だらけの背中を見ている。`,
      ];
      const pool = G.beastCalled[v] ? echo : first;
      G.beastCalled[v] = true;
      return { text: pool[Math.floor(G.rng() * pool.length)], target: v, kind: 'beast' };
    }
  }

  // 目撃報告
  const seen = Object.keys(a.seenOutAtNight)
    .filter(k => a.seenOutAtNight[k] > 1.2 && G.actors[k].alive);
  if (seen.length && roll < 0.45 * t.talk) {
    const v = +seen[Math.floor(G.rng() * seen.length)];
    return { text: TONE[a.look.trait](`昨夜、${nameOf(G, v)}が外を歩いていた。家にいなかったのは確かだ。`), target: v, kind: 'witness' };
  }

  // いちばん疑っている相手を名指し
  let top = null, topV = -1e9;
  for (const o of others) {
    const v = (a.suspicion[o.idx] || 0) + G.rng() * 14 * t.suspicion;
    if (v > topV) { topV = v; top = o; }
  }
  if (top && topV > 12 && roll < 0.8 * t.talk) {
    const lines = [
      `${top.name}が怪しい。昼のあいだ、仕事場でほとんど見かけなかった。`,
      `私は${top.name}を疑っている。理由は言えないが、目つきが人のそれじゃない。`,
      `${top.name}、昨日の言い訳を覚えているか。私は覚えている。`,
      `${top.name}に票を入れる。外れたら明日、私が責任を取る。`,
      `${top.name}は誰の話にも乗るだけで、自分からは何も言わない。それが不気味だ。`,
      `${top.name}の手を見た。爪の間に土でないものが入っていた。`,
      `昨日${top.name}が守ると言った相手が死んだ。おかしいと思わないか。`,
      `${top.name}、鐘が鳴ったとき、おまえだけ息が上がっていた。どこから走ってきた。`,
    ];
    return { text: TONE[a.look.trait](lines[Math.floor(G.rng() * lines.length)]), target: top.idx, kind: 'accuse' };
  }

  // 同調・弁明・沈黙
  if (G.lastAccused >= 0 && G.actors[G.lastAccused].alive && roll < t.follow * 0.5) {
    return { text: TONE[a.look.trait](`${nameOf(G, G.lastAccused)}の件、私も同じことを感じていた。`), target: G.lastAccused, kind: 'agree' };
  }
  const alibi = a.chores.filter(c => c.done).slice(-1)[0];
  const place = alibi ? (CHORES.find(c => c.id === alibi.station)?.name || '街の仕事') : '街のどこか';
  const quietLines = [
    `私は昨日、${place}をしていた。ほかに言うことはない。`,
    `決めつけるのは早い。誰かが死んでからでは遅いが、間違えればもっと早い。`,
    `壁の外へ出された者が人だったら、それは私たちが殺したことになる。`,
    `${place}。それが私の昨日のすべてだ。疑うなら勝手にしろ。`,
    `……`,
  ];
  if (t.talk < 0.6 && roll < 0.5) return { text: '……', target: -1, kind: 'silent' };
  return { text: TONE[a.look.trait](quietLines[Math.floor(G.rng() * quietLines.length)]), target: -1, kind: 'defend' };
}

/* ---------- 投票 ---------- */
function castVote(a, G) {
  const others = G.actors.filter(o => o.alive && o !== a);
  if (!others.length) return -1;
  const t = TRAITS[a.look.trait];

  if (a.role === 'wolf') {
    const prey = others.filter(o => o.role !== 'wolf');
    if (!prey.length) return others[0].idx;
    // 場の空気に乗って、村人陣営でいちばん票が集まりそうな相手へ
    let best = prey[0], bv = -1e9;
    for (const o of prey) {
      const v = (G.pressure[o.idx] || 0) * 1.6 + G.rng() * 16
        + (o.claimedRole === 'seer' ? 40 : 0);
      if (v > bv) { bv = v; best = o; }
    }
    return best.idx;
  }

  // 自分で見た黒は何より優先する
  if (a.role === 'seer') {
    const mine = Object.keys(a.seerResults)
      .filter(k => a.seerResults[k] === 'wolf' && G.actors[k].alive && +k !== a.idx);
    if (mine.length) return +mine[0];
  }
  // 場に出ている「黒」の宣言に乗る
  const seerCall = G.publicSeerCall;
  if (seerCall && seerCall.wolf && seerCall.targetIdx !== a.idx) {
    const tgt = G.actors[seerCall.targetIdx];
    if (tgt && tgt.alive && G.rng() < 0.92) return tgt.idx;
  }

  let best = others[0], bv = -1e9;
  for (const o of others) {
    const v = (a.suspicion[o.idx] || 0) * t.suspicion
      + (G.pressure[o.idx] || 0) * t.follow * 2.2
      + G.rng() * 12;
    if (v > bv) { bv = v; best = o; }
  }
  return best.idx;
}
