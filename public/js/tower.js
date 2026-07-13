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
    } else if (roll < 0.16 && y > 8) {
      // 動く足場: 序盤 (8m〜) から登場。低所では振幅・速度を控えめに
      const ease = clamp((y - 8) / 40, 0, 1);
      kind = 'move';
      hx = hz = 1.15;
      move = {
        axis: rand() < 0.5 ? 'x' : 'z',
        amp: 1.1 + rand() * (0.8 + 0.6 * ease),
        speed: 0.5 + rand() * (0.4 + 0.3 * ease),
        phase: rand() * Math.PI * 2,
      };
    } else if (roll < 0.34 && y > 5) {
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

    // 動く足場の可動域が「下の足場に立つプレイヤーの体」を薙ぎ払わないように補正。
    // 掃引後の箱が立ち位置に重なると、側面の押し出しがプレイヤーを足場から
    // 突き落としてしまう (細いビームでは即落下)。すき間が保てる軸を選び、
    // それでも足りなければ振幅を絞る。絞りきれなければ静止足場にする。
    if (move) {
      const CLEAR = CONFIG.PLAYER_R * 2 + 0.25;      // プレイヤーの直径 + 余裕
      const BODY_H = CONFIG.PLAYER_HALF_H * 2 + 0.1; // 立っている人の体の高さ
      const bottom = y - hy * 2;
      let ampX = move.amp, ampZ = move.amp; // 各軸で許される振幅
      for (let i = Math.max(platforms.length - 5, 0); i < platforms.length; i++) {
        const q = platforms[i];
        const qTop = q.y + q.hy;
        if (qTop >= y || qTop + BODY_H <= bottom) continue; // 体と高さが重ならない
        const sepX = Math.abs(nx - q.x) - (hx + q.hx);
        const sepZ = Math.abs(nz - q.z) - (hz + q.hz);
        if (sepZ < CLEAR) ampX = Math.min(ampX, sepX - CLEAR); // x往復は x のすき間で守る
        if (sepX < CLEAR) ampZ = Math.min(ampZ, sepZ - CLEAR); // z往復は z のすき間で守る
      }
      const amp = Math.max(ampX, ampZ);
      if (amp < 0.55) {
        move = null;
        kind = 'box';
      } else {
        if (ampX !== ampZ) move.axis = ampX > ampZ ? 'x' : 'z';
        move.amp = Math.min(move.amp, amp);
      }
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
