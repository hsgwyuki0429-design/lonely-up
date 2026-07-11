import { CONFIG } from './config.js';
import { mulberry32 } from './rng.js';

// 塔の生成 (純粋関数)。THREE に依存しないので Node からも検証できる。
// platform: { x, y, z, hx, hy, hz, move, kind }
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ジャンプ物理から水平到達距離を計算:
// 高さ dyTop の足場上面を下降しながら通過する時刻 × 移動速度
function reachAt(dyTop) {
  const v = CONFIG.JUMP_VEL, g = CONFIG.GRAVITY;
  const disc = v * v - 2 * g * dyTop;
  if (disc <= 0) return 0;
  return CONFIG.MOVE_SPEED * ((v + Math.sqrt(disc)) / g);
}

export function generateTower(seed = CONFIG.SEED) {
  const rand = mulberry32(seed);
  const platforms = [];

  platforms.push({ x: 0, y: -0.5, z: 0, hx: 7, hy: 0.5, hz: 7, move: null, kind: 'base' });

  let theta = rand() * Math.PI * 2;
  let prev = { x: 0, z: 0, r: 5.5, amp: 0, top: 0 };
  let lastRestY = 0;

  while (prev.top < CONFIG.GOAL_HEIGHT - 4) {
    // 足場「上面」同士の高低差 (最大でもジャンプ高 2.09m 未満)
    const dyTop = 0.9 + rand() * 0.85;

    let kind = 'box';
    let move = null;
    let hx = 1.1 + rand() * 0.9;
    let hz = 1.1 + rand() * 0.9;
    let hy = 0.3;
    const roll = rand();
    const y = prev.top + dyTop; // ここでは仮に上面高度として扱い、後で中心に直す

    if (y - lastRestY > 42) {
      kind = 'rest';
      hx = hz = 2.7;
      hy = 0.45;
      lastRestY = y;
    } else if (roll < 0.13 && y > 25) {
      kind = 'move';
      hx = hz = 1.15;
      move = {
        axis: rand() < 0.5 ? 'x' : 'z',
        amp: 1.5 + rand() * 1.4,
        speed: 0.6 + rand() * 0.7,
        phase: rand() * Math.PI * 2,
      };
    } else if (roll < 0.3 && y > 12) {
      kind = 'beam';
    } else if (roll < 0.52) {
      kind = 'small';
      hx = hz = 0.75 + rand() * 0.45;
    }

    // らせん状に上へ
    theta += 0.25 + rand() * 0.55;
    const radius = clamp(8 + Math.sin(theta * 0.6) * 4 + (rand() - 0.5) * 3, 4, 14);
    let nx = Math.cos(theta) * radius;
    let nz = Math.sin(theta) * radius;

    if (kind === 'beam') {
      if (Math.abs(nx - prev.x) > Math.abs(nz - prev.z)) { hx = 2.4; hz = 0.42; }
      else { hx = 0.42; hz = 2.4; }
    }

    // 必ず届く距離に補正: ジャンプ物理の到達距離から安全マージンを引いた値を上限に。
    // 動く足場は自分と直前の振幅ぶんも詰める (位相がズレていても届くように)
    const rNew = Math.min(hx, hz);
    let maxGap = reachAt(dyTop) - 0.55;
    if (move) maxGap -= move.amp;
    maxGap = Math.max(maxGap - prev.amp, 0.9);
    const dx = nx - prev.x;
    const dz = nz - prev.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const edge = dist - rNew - prev.r;
    if (edge > maxGap * 0.95 || edge < 0.4) {
      const want = prev.r + rNew + maxGap * (0.45 + rand() * 0.5);
      nx = prev.x + (dx / dist) * want;
      nz = prev.z + (dz / dist) * want;
    }

    const top = prev.top + dyTop;
    platforms.push({ x: nx, y: top - hy, z: nz, hx, hy, hz, move, kind });
    prev = { x: nx, z: nz, r: rNew, amp: move ? move.amp : 0, top };
  }

  // ゴール台 (上面が prev.top + 1.5 になるように配置)
  const goalTop = prev.top + 1.5;
  const goalY = goalTop - 0.5;
  const gd = 0.001 + Math.hypot(prev.x, prev.z);
  const gx = prev.x + (prev.x / gd) * (prev.r + 3.4 + 1.6);
  const gz = prev.z + (prev.z / gd) * (prev.r + 3.4 + 1.6);
  platforms.push({ x: gx, y: goalY, z: gz, hx: 3.4, hy: 0.5, hz: 3.4, move: null, kind: 'goal' });

  return { platforms, goalY };
}
