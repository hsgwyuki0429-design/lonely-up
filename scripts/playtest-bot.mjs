// 自動プレイボット: 実際の Player 物理 (player.js) をそのまま使い、
// スタートからゴールまで全足場を順番に踏破できるかを機械的に実証する。
// 幾何チェック (validate-tower.mjs) より強い「人間の操作で本当に通れる」保証になる。
//
//   node scripts/playtest-bot.mjs          … 本番シード + 周辺9シードを踏破テスト
//   node scripts/playtest-bot.mjs 12345    … 指定シードのみ
//
// ボットの操作は実プレイヤーと同じ入力系のみ:
//   スティック (全力で次の足場へ) + 端の自動ジャンプ。点滅足場は「出ている時間が
// 充分残っている波」を待ってから跳ぶ (人間がリズムを読むのと同じ)。
// 崩れ足場は最初の1回は必ず実体があるため簡略化して常に実体として扱う。
import { CONFIG } from '../public/js/config.js';
import { generateTower } from '../public/js/tower.js';
import { Player } from '../public/js/player.js';

// world.js の衝突まわりだけを再現した軽量スタブ (THREE のシーンや描画は不要)
class SimWorld {
  constructor(platforms) {
    this.platforms = platforms;
  }
  nearby(yMin, yMax, out) {
    out.length = 0;
    for (const p of this.platforms) {
      if (p.y + p.hy >= yMin - 2 && p.y - p.hy <= yMax + 2) out.push(p);
    }
    return out;
  }
  offset(p, t) {
    if (!p.move) return 0;
    const m = p.move;
    if (m.axis === 'y') return (1 - Math.cos(t * m.speed + m.phase)) * m.amp;
    return Math.sin(t * m.speed + m.phase) * m.amp;
  }
  aabb(p, t, out) {
    let ox = 0, oy = 0, oz = 0;
    if (p.move) {
      const o = this.offset(p, t);
      if (p.move.axis === 'x') ox = o;
      else if (p.move.axis === 'z') oz = o;
      else oy = o;
    }
    out.minX = p.x + ox - p.hx; out.maxX = p.x + ox + p.hx;
    out.minY = p.y + oy - p.hy; out.maxY = p.y + oy + p.hy;
    out.minZ = p.z + oz - p.hz; out.maxZ = p.z + oz + p.hz;
    return out;
  }
  phaseInfo(p, t) {
    const c = p.phaseCfg;
    if (!c) return { solid: true, rem: Infinity };
    const f = ((t / c.period + c.offset) % 1 + 1) % 1;
    return { solid: f < c.onFrac, rem: f < c.onFrac ? (c.onFrac - f) * c.period : 0 };
  }
  isSolid(p, t) {
    if (p.kind === 'phase') return this.phaseInfo(p, t).solid;
    return true;
  }
  groundTopBelow() {
    return null; // 影の描画用なのでシミュレーションでは不要
  }
}

const sceneStub = { add() {}, remove() {} };

function playthrough(seed, verbose = false) {
  const { platforms } = generateTower(seed);
  const world = new SimWorld(platforms);
  const player = new Player(sceneStub, world);
  const route = platforms.filter((p) => p.kind !== 'pillar');

  const input = {
    move: { x: 0, y: 0 },
    consumeJump: () => false,
    consumeBow: () => false,
  };

  const DT = 1 / 60;
  let t = 1000; // 実時間相当 (動く足場の位相)
  const fails = [];

  const teleportTo = (p) => {
    // 点滅足場に乗せ直す時は「窓が開いた直後」まで時間を送る (人間ならリズムを見て立て直す)
    if (p.kind === 'phase') {
      const c = p.phaseCfg;
      const f = ((t / c.period + c.offset) % 1 + 1) % 1;
      if (f > 0.02) t += (1 - f) * c.period + 0.01;
    }
    const o = world.offset(p, t);
    player.pos.set(
      p.x + (p.move?.axis === 'x' ? o : 0),
      p.y + (p.move?.axis === 'y' ? o : 0) + p.hy + CONFIG.PLAYER_HALF_H + 0.05,
      p.z + (p.move?.axis === 'z' ? o : 0)
    );
    player.vel.set(0, 0, 0);
    player.runT = 0; // 走り猶予をリセット (足場が消えた瞬間の勝手な自動ジャンプを防ぐ)
    player.events.length = 0;
  };

  teleportTo(route[1]); // base の次から開始
  let i = 2;            // いま目指している足場の添字
  const attemptsByHop = new Map(); // ホップごとの失敗回数 (後戻りリトライでリセットされないように)
  let hopTime = 0;

  while (i < route.length) {
    const target = route[i];
    const from = route[i - 1];

    // 目標の点滅足場は「波の頭 (出た直後)」で跳ぶ / 昇降ブロックは低い位相を待つ。
    // 足元も点滅足場で消えかけている時は、残り時間が中途半端でも即跳ぶ (人間と同じ判断)。
    let hold = false;
    if (player.grounded) {
      if (target.kind === 'phase') {
        const w = world.phaseInfo(target, t);
        const c = target.phaseCfg;
        const onTime = c.period * c.onFrac;
        const fresh = w.solid && w.rem > onTime - 0.35;   // 出現した直後の波の頭
        const plenty = w.solid && w.rem >= 1.5;           // 助走+滞空しても余裕がある
        const st = player.standing;
        const standRem = st && st.kind === 'phase' ? world.phaseInfo(st, t).rem : Infinity;
        const urgent = standRem < 1.2 && w.solid && w.rem > 1.0; // 足元が消える前に跳ぶ
        if (!(fresh || plenty || urgent)) hold = true;
      }
      if (target.move?.axis === 'y' && world.offset(target, t) > 0.45) hold = true;
    }

    if (hold) {
      input.move.x = 0;
      input.move.y = 0;
    } else {
      const o = world.offset(target, t);
      // リトライごとに狙い位置を目標の中でずらす (人間がラインを変えて再挑戦するのと同じ)
      const n = attemptsByHop.get(i) || 0;
      const j = n === 0 ? 0 : (n === 1 ? 0.55 : -0.55);
      const tx = target.x + (target.move?.axis === 'x' ? o : 0) + j * target.hx;
      const tz = target.z + (target.move?.axis === 'z' ? o : 0) - j * target.hz;
      const dx = tx - player.pos.x;
      const dz = tz - player.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      // camYaw=0 のとき move.x → +x / move.y → -z (player.js の座標変換に合わせる)
      input.move.x = dx / l;
      input.move.y = -dz / l;
    }

    player.update(DT, input, 0, t, t - DT, null);
    t += DT;
    hopTime += DT;

    const fell = player.events.some((e) => e.t === 'fell');
    // バウンド台は着地せず即跳ね返る (standing にならない) ので、跳ねた瞬間を到達扱いにする
    let bounced = -1;
    for (const e of player.events) {
      if (e.t === 'bounce' && e.big && e.plat) {
        bounced = Math.max(bounced, route.indexOf(e.plat));
      }
    }
    player.events.length = 0;

    if (bounced >= i) {
      i = bounced + 1; // 次の目標 = 跳ね返り先の着地パッド (空中で照準を切り替える)
      hopTime = 0;
      continue;
    }

    if (player.grounded && player.standing) {
      const si = route.indexOf(player.standing);
      if (si >= i) {
        // 目標 (またはその先) に到達
        i = si + 1;
        hopTime = 0;
        continue;
      }
    }

    if (fell || hopTime > 15) {
      hopTime = 0;
      const n = (attemptsByHop.get(i) || 0) + 1;
      attemptsByHop.set(i, n);
      if (n >= 3) {
        const dy = (target.y + target.hy) - (from.y + from.hy);
        const dist = Math.hypot(target.x - from.x, target.z - from.z);
        fails.push(
          `#${i} ${from.kind}(${from.seg}) → ${target.kind}(${target.seg}) に3回失敗` +
          ` [${fell ? '落下' : '時間切れ'} dist ${dist.toFixed(2)} dy ${dy.toFixed(2)}` +
          ` from(${from.x.toFixed(1)},${(from.y + from.hy).toFixed(1)},${from.z.toFixed(1)})h(${from.hx.toFixed(2)},${from.hz.toFixed(2)})` +
          ` to(${target.x.toFixed(1)},${(target.y + target.hy).toFixed(1)},${target.z.toFixed(1)})h(${target.hx.toFixed(2)},${target.hz.toFixed(2)})` +
          ` player(${player.pos.x.toFixed(1)},${player.pos.y.toFixed(1)},${player.pos.z.toFixed(1)})]`
        );
        i++;              // 記録して先へ進む (残りの区間もテストする)
        teleportTo(route[i - 1]);
      } else {
        // 直前の足場からリトライ。ただしバウンド台の上には立てないので、その手前から
        let k = i - 1;
        while (k > 1 && route[k].kind === 'bounce') k--;
        teleportTo(route[k]);
        i = k + 1;
      }
    }
  }

  if (verbose) {
    console.log(`seed=${seed}: ${route.length - 1} ホップを踏破 (シミュレーション ${Math.round(t - 1000)} 秒相当)`);
  }
  return fails;
}

const arg = process.argv[2];
const seeds = arg ? [Number(arg)] : [CONFIG.SEED, ...Array.from({ length: 9 }, (_, k) => CONFIG.SEED + k + 1)];
let ng = 0;
for (const s of seeds) {
  const fails = playthrough(s, true);
  if (fails.length) {
    ng++;
    console.error(`seed=${s}: 踏破できないホップ ${fails.length} 件`);
    for (const f of fails) console.error('  ' + f);
  }
}
if (ng) {
  console.error(`\n${ng}/${seeds.length} シードで踏破失敗`);
  process.exit(1);
}
console.log(`OK: ${seeds.length} シードすべてスタート→ゴールまで実物理で踏破できました`);
