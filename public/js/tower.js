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
    const newBot = top - hy * 2;

    // 頭上クリアランス確保: この足場が「登れない行き止まり」を作らないよう位置を微調整する。
    // らせんが内側へ巻き込むと、i+2 段目が i 段目の跳び出し口の真上に来て、そこから上へ
    // 跳ぶと頭をぶつけて失速し次の足場へ届かなくなる。また、直前の足場のすぐ真上に
    // 覆いかぶさると (体が入る隙間が無く) その足場に立てなくなる。どちらも避けたい。
    // 直前の足場を中心にこの足場を「回して」逃がす。半径 (＝到達距離) は変えないので、
    // 直前の足場から届く保証を保ったまま、じゃまな真上を外せる。
    const jumpH = (CONFIG.JUMP_VEL * CONFIG.JUMP_VEL) / (2 * CONFIG.GRAVITY);
    const PR = CONFIG.PLAYER_R;
    // ジャンプ頂点で頭のてっぺんが届く高さ = 立ち位置から ジャンプ高 + 体の全高。
    const headReach = jumpH + CONFIG.PLAYER_HALF_H * 2;
    const BODY = CONFIG.PLAYER_HALF_H * 2 + 0.15; // 立っている体がすっぽり入るのに要る縦の空き

    const blockedAt = (tx, tz) => {
      for (let k = platforms.length - 1; k >= Math.max(platforms.length - 5, 0); k--) {
        const q = platforms[k];
        const qTop = q.y + q.hy;
        const qBot = q.y - q.hy;
        // (a) この足場が q の打ち上げ経路にフタをしていないか (q は下の足場に限る)
        if (top > qTop && newBot < qTop + headReach) {
          const nxt = platforms[k + 1] || prev;
          let cx = nxt.x - q.x, cz = nxt.z - q.z;
          const cl = Math.hypot(cx, cz) || 1e-6; cx /= cl; cz /= cl;
          const start = Math.min(q.hx, q.hz);
          for (let s = 0; s <= 2.4; s += 0.3) {
            const px = q.x + cx * (start + s), pz = q.z + cz * (start + s);
            if (px > tx - hx - PR && px < tx + hx + PR && pz > tz - hz - PR && pz < tz + hz + PR) return true;
          }
        }
        // (b) この足場が q の真上/真下に覆いかぶさって、体が入る隙間を潰していないか。
        //     直前の足場 (prev) は「乗ってから跳ぶ相手」なので端の重なりは許容 (除外)。
        if (k !== platforms.length - 1) {
          const overX = (hx + q.hx + PR) - Math.abs(tx - q.x);
          const overZ = (hz + q.hz + PR) - Math.abs(tz - q.z);
          if (overX > 0 && overZ > 0) {
            const clr = top > qTop ? newBot - qTop : qBot - top; // 上下どちらの隙間か
            if (clr < BODY) return true;
          }
        }
      }
      return false;
    };

    if (blockedAt(nx, nz)) {
      const ox = nx - prev.x, oz = nz - prev.z;
      const baseAng = Math.atan2(oz, ox);
      const baseDist = Math.hypot(ox, oz) || 0.001;
      let done = false;
      for (let step = 1; step <= 26 && !done; step++) {
        for (const sgn of [1, -1]) {
          const ang = baseAng + sgn * step * 0.12; // 直前の足場を軸に回す (到達距離は不変)
          const tx = prev.x + Math.cos(ang) * baseDist;
          const tz = prev.z + Math.sin(ang) * baseDist;
          if (!blockedAt(tx, tz)) { nx = tx; nz = tz; done = true; break; }
        }
      }
    }

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
