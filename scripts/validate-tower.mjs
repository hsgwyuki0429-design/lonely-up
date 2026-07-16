// コース検証スクリプト: 生成された塔が「人間の操作で必ず通れる」ことを
// ジャンプ物理から機械的に確認する (tower.js は THREE 非依存なので Node で走る)。
//
//   node scripts/validate-tower.mjs            … 本番シード + 周辺50シードを検証
//   node scripts/validate-tower.mjs 12345      … 指定シードのみ詳細表示
//
// チェック内容 (ルート上の連続する足場ペアすべて):
//   1. 段差がジャンプ高 (バウンド台からは跳ね上げ高) を超えていない
//   2. 水平ギャップが到達距離の安全マージン内 (可動足場は振幅の最悪ケースを加味)
//   3. 崩れ足場 → 点滅足場の理不尽コンボが無い
//   4. ゴールまで到達している / 足場数が異常でない
import { CONFIG } from '../public/js/config.js';
import { generateTower } from '../public/js/tower.js';

function reachWith(vel, dyTop) {
  const g = CONFIG.GRAVITY;
  const disc = vel * vel - 2 * g * dyTop;
  if (disc <= 0) return 0;
  return CONFIG.MOVE_SPEED * ((vel + Math.sqrt(disc)) / g);
}

function validate(seed, verbose = false) {
  const { platforms, goalY, cpCount } = generateTower(seed);
  const route = platforms.filter((p) => p.kind !== 'pillar'); // 柱は装飾 (ルート外)
  const errors = [];
  const segCounts = {};

  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    segCounts[b.seg || b.kind] = (segCounts[b.seg || b.kind] || 0) + 1;
    const launch = a.kind === 'bounce' ? CONFIG.BOUNCE_VEL : CONFIG.JUMP_VEL;
    const jumpH = (launch * launch) / (2 * CONFIG.GRAVITY);
    const dyTop = (b.y + b.hy) - (a.y + a.hy);

    // 1. 段差 (上下に動く足場は最下点 = 静止位置に乗れるので静止基準で判定できる)
    if (dyTop > jumpH - 0.12) {
      errors.push(`#${i} ${a.kind}->${b.kind} (${a.seg}->${b.seg}) 段差 ${dyTop.toFixed(2)}m > 跳躍高 ${jumpH.toFixed(2)}m`);
    }

    // 2. 水平ギャップ (最悪ケース: 両者の横振幅ぶん遠ざかる, 足場の半径は短辺で見る)
    const ampA = a.move && a.move.axis !== 'y' ? a.move.amp : 0;
    const ampB = b.move && b.move.axis !== 'y' ? b.move.amp : 0;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const edge = dist - Math.min(a.hx, a.hz) - Math.min(b.hx, b.hz) + ampA + ampB;
    const reach = reachWith(launch, Math.max(dyTop, -8)) - 0.3;
    if (edge > reach) {
      errors.push(`#${i} ${a.seg}->${b.seg} ギャップ ${edge.toFixed(2)}m > 到達 ${reach.toFixed(2)}m (dy ${dyTop.toFixed(2)})`);
    }

    // 3. 崩れ→点滅 (崩れ足場の上では点滅の「オン」を待てず詰みうる)
    if (a.kind === 'crumble' && b.kind === 'phase') {
      errors.push(`#${i} 崩れ足場の直後に点滅足場 (待機不能)`);
    }
  }

  // 4. 全体の妥当性
  const goal = route[route.length - 1];
  if (goal.kind !== 'goal') errors.push('最後の足場が goal でない (生成が途中で打ち切られた)');
  if (goal.y + goal.hy < CONFIG.GOAL_HEIGHT - 6) errors.push(`ゴールが低すぎる: ${(goal.y + goal.hy).toFixed(1)}m`);
  if (route.length > 1100) errors.push(`足場が異常に多い: ${route.length}`);
  if (cpCount < 4) errors.push(`チェックポイントが少なすぎる: ${cpCount}`);

  if (verbose) {
    console.log(`seed=${seed}: 足場 ${platforms.length} 枚 / CP ${cpCount} 個 / goalY ${goalY.toFixed(1)}`);
    console.log('  セグメント内訳:', Object.entries(segCounts).map(([k, v]) => `${k}:${v}`).join(' '));
  }
  return errors;
}

const arg = process.argv[2];
if (arg) {
  const errs = validate(Number(arg), true);
  if (errs.length) {
    console.error(`NG (${errs.length} 件):`);
    for (const e of errs) console.error('  ' + e);
    process.exit(1);
  }
  console.log('OK: 全ペアが到達可能です');
} else {
  // 本番シード + 周辺シードを一括検証 (生成ロジックの頑健性チェック)
  const seeds = [CONFIG.SEED];
  for (let i = 1; i <= 50; i++) seeds.push(CONFIG.SEED + i);
  let ng = 0;
  for (const s of seeds) {
    const errs = validate(s, s === CONFIG.SEED);
    if (errs.length) {
      ng++;
      console.error(`seed=${s}: NG (${errs.length} 件)`);
      for (const e of errs) console.error('  ' + e);
    }
  }
  if (ng) {
    console.error(`\n${ng}/${seeds.length} シードで問題あり`);
    process.exit(1);
  }
  console.log(`OK: ${seeds.length} シードすべてで全ペア到達可能・詰みコンボなし`);
}
