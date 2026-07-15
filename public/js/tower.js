import { CONFIG } from './config.js';
import { mulberry32 } from './rng.js';

// 塔の生成 (純粋関数)。THREE に依存しないので Node からも検証できる。
// platform: { x, y, z, hx, hy, hz, move, kind, seg }
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ジャンプ物理から水平到達距離を計算:
// 初速 vel で打ち上がり、上面が dyTop 高い足場を下降しながら通過する時刻 × 移動速度。
// vel は通常ジャンプ (JUMP_VEL) だけでなく、バウンドブロックの打ち上げ初速 (BOUNCE_VEL) も渡せる。
// dyTop は負 (下の足場へ降りる) も扱える。届かない高さなら 0 を返す。
function reachWith(vel, dyTop) {
  const g = CONFIG.GRAVITY;
  const disc = vel * vel - 2 * g * dyTop;
  if (disc <= 0) return 0;
  return CONFIG.MOVE_SPEED * ((vel + Math.sqrt(disc)) / g);
}
// 通常ジャンプでの到達距離 (後方互換の別名)
function reachAt(dyTop) {
  return reachWith(CONFIG.JUMP_VEL, dyTop);
}

export function generateTower(seed = CONFIG.SEED) {
  const rand = mulberry32(seed);
  const platforms = [];

  platforms.push({ x: 0, y: -0.5, z: 0, hx: 7, hy: 0.5, hz: 7, move: null, kind: 'base' });

  let theta = rand() * Math.PI * 2;
  let prev = { x: 0, z: 0, r: 5.5, amp: 0, top: 0, launch: CONFIG.JUMP_VEL };
  let lastRestY = 0;

  // ================== セグメント (set-piece) プランナ ==================
  // 単調な螺旋の代わりに、性格の違う「区間」をつないで人間が設計したような緩急を作る。
  //   flow       … 大きめの静止足場が一定リズムで並ぶ助走ゾーン。前進するだけで気持ちよく登れる
  //   elevator   … 上下に動くブロックが続く区間 (タイミングを合わせて渡る)
  //   zigzag     … 内外に振られながら登る weave 区間
  //   crumbleRun … 踏むと崩れる足場が連続 (立ち止まれない疾走区間)
  //   phaseGate  … 出たり消えたりする足場が連続 (点滅のリズムを読む)
  //   narrowBridge… めっちゃ細い一本道 (踏み外さないよう慎重に渡るタイトロープ)
  //   bounceRoute… 高台から下方へ離れた1枚のバウンドブロックへ降り、跳ね返って遠くの台へ (脳汁ルート)
  //   chasm      … ギリギリ届く大ジャンプ。着地は広い安全パッドなので「攻めれば必ず届く」快感
  //   spiral     … 従来どおりの多彩なランダム螺旋
  // どれも到達距離はジャンプ物理から逆算して必ず届く範囲に収める (運ではなく技術で越える)。
  // 難所のあとには必ず flow を挟み、「緊張 → 緩和」のリズム (脳汁) を生む。
  let seg = { type: 'flow', left: 5, i: 0 }; // 序盤は安心して登れる助走路から
  let needBreather = false;            // 直前が難所なら次は flow を差し込む
  let zzToggle = false;                // zigzag の内外トグル

  function pickSegment(hf) {
    if (needBreather) {
      needBreather = false;
      return { type: 'flow', left: 3 + Math.floor(rand() * 4), i: 0 }; // 助走 3〜6 枚
    }
    needBreather = true;
    const pool = ['spiral', 'spiral'];
    if (hf > 0.03) pool.push('elevator', 'elevator');
    if (hf > 0.06) pool.push('bounceRoute'); // バウンド set-piece は早めから解禁
    if (hf > 0.08) pool.push('narrowBridge');
    if (hf > 0.10) pool.push('zigzag');
    if (hf > 0.13) pool.push('chasm');
    if (hf > 0.20) pool.push('bounceRoute'); // 中盤以降は名物ルートとして再登場させる
    if (hf > 0.16) pool.push('crumbleRun');
    if (hf > 0.24) pool.push('phaseGate');
    const type = pool[Math.floor(rand() * pool.length)];
    const s = { type, left: 4 + Math.floor(rand() * 4), i: 0 };
    if (type === 'spiral' || type === 'crumbleRun') s.left = 3 + Math.floor(rand() * 3);
    if (type === 'bounceRoute') s.left = 2;                       // バウンド台 → 着地パッドの2枚1組
    if (type === 'narrowBridge') s.left = 5 + Math.floor(rand() * 4);
    if (type === 'chasm') s.left = 2 + Math.floor(rand() * 2);
    if (type === 'elevator') { s.speed = 0.6 + rand() * 0.35; s.phase = rand() * Math.PI * 2; }
    return s;
  }

  while (prev.top < CONFIG.GOAL_HEIGHT - 4) {
    if (seg.left <= 0) seg = pickSegment(clamp(prev.top / CONFIG.GOAL_HEIGHT, 0, 1));
    seg.left--;
    const segType = seg.type;
    const stepIdx = seg.i++;                     // このセグメント内での通し番号 (0 始まり)
    const prevLaunch = prev.launch || CONFIG.JUMP_VEL; // 直前の足場から飛び出す初速 (バウンド台なら大きい)

    // 段差 (上面同士の高低差, ジャンプ高 2.09m 未満)。セグメントごとに上書きする。
    let dyTop = 0.9 + rand() * 0.85;

    let kind = 'box';
    let move = null;
    let phaseCfg = null;
    let hx = 1.1 + rand() * 0.9;
    let hz = 1.1 + rand() * 0.9;
    let hy = 0.3;
    let dTheta = 0.25 + rand() * 0.55;                              // theta の進み (螺旋の巻き)
    let radius = clamp(8 + Math.sin(theta * 0.6) * 4 + (rand() - 0.5) * 3, 4, 14);
    let gapFrac = 0.45 + rand() * 0.5;                              // 到達距離に対する間隔の割合
    let forceSpacing = false;                                      // true: 常に一定間隔へ整える
    let keepSize = false;                                          // true: 高所でも縮小しない (細道の幅・安全パッドを保つ)

    const y = prev.top + dyTop; // 仮の上面高度 (後で中心へ直す)
    // 高度係数 (0 = 地上, 1 = ゴール)。上へ行くほど足場を小さく・動きを速くする
    const hFactor = clamp(y / CONFIG.GOAL_HEIGHT, 0, 1);

    if (y - lastRestY > 42) {
      // 休憩所は距離で強制割り込み (どのセグメントでも共通のチェックポイント)
      kind = 'rest';
      hx = hz = 2.7;
      hy = 0.45;
      lastRestY = y;
      seg.left = 0; // 休憩したら次は新しいセグメントへ
    } else if (segType === 'flow') {
      // 助走ゾーン: 大きめの静止足場を均一なリズムで並べる。緩やかなカーブを描き、
      // 前進し続けるだけで自動ジャンプが連鎖して気持ちよく登れる。
      dyTop = 0.8 + rand() * 0.35;
      hx = hz = 1.5;
      dTheta = 0.17 + rand() * 0.05;
      radius = 9 + Math.sin(theta * 0.55) * 3;
      gapFrac = 0.5;
      forceSpacing = true;
    } else if (segType === 'elevator') {
      // 上下に動くブロックが続く区間。区間内で速度をそろえ、位相を少しずつずらして
      // 「波」のように昇降させる。振幅は控えめ (従来の単発エレベーターより易しい)。
      kind = 'move';
      hx = hz = 1.2;
      const speedBoost = 1 + 1.0 * hFactor;
      move = {
        axis: 'y',
        amp: 0.35 + rand() * 0.2,
        speed: (seg.speed || 0.8) * speedBoost,
        phase: (seg.phase || 0) + platforms.length * 0.5,
      };
      dTheta = 0.24 + rand() * 0.14;
      radius = 9 + Math.sin(theta * 0.5) * 2.6;
      gapFrac = 0.5;
      forceSpacing = true;
    } else if (segType === 'zigzag') {
      // 内外に weave: 半径を内周/外周へ交互に振り、左右に揺さぶられながら登る。
      zzToggle = !zzToggle;
      hx = hz = 1.25;
      dTheta = 0.3 + rand() * 0.12;
      radius = zzToggle ? 6.5 : 12;
      gapFrac = 0.55;
      forceSpacing = true;
    } else if (segType === 'narrowBridge') {
      // めっちゃ細い一本道。長くて薄いビームを重ねて連続した細道にする。
      // 幅 ≈ 0.9m (プレイヤー直径 0.72m) なので、踏み外さないよう中央を通る技術が要る。
      // ほぼ直進 (dTheta 小) させ、半径をセグメント内で固定して「まっすぐな細道」に見せる。
      dyTop = 0.55 + rand() * 0.3;
      if (seg.bridgeR == null) seg.bridgeR = clamp(7 + Math.sin(theta * 0.5) * 3, 5, 12);
      kind = 'narrow';        // ビーム状 (向きは後で進行方向に合わせる)
      hy = 0.3;
      dTheta = 0.1 + rand() * 0.04;
      radius = seg.bridgeR;
      gapFrac = 0.28;         // 間隔を詰め、重なって連続した細道になるように
      forceSpacing = true;
      keepSize = true;        // 高所でも幅を保つ (縮むと人が通れなくなる)
    } else if (segType === 'bounceRoute') {
      // 脳汁ルート: 高台から「下方へ離れた1枚のバウンドブロック」へ降り、跳ね返って遠くの台へ。
      if (stepIdx === 0) {
        // (1) 高台から離れて下にある単独のバウンドブロック。降下ぶん到達距離が伸びるので遠くに置ける。
        kind = 'bounce';
        hx = hz = 1.2;                 // しっかり着地できる大きさ
        seg.baseTop = prev.top;        // 跳ね返って戻ってくる基準の高さを覚えておく
        seg.drop = 1.8 + rand() * 1.4; // 高台より 1.8〜3.2m 下
        dyTop = -seg.drop;
        dTheta = 0.55 + rand() * 0.4;  // 横へ大きく振って「離れた」位置へ
        gapFrac = 0.62;
        forceSpacing = true;
        keepSize = true;
      } else {
        // (2) バウンドで届く遠く高くの着地パッド。BOUNCE_VEL の跳躍高 (≈5.1m) 内に必ず収める。
        kind = 'box';
        hx = hz = 1.55;                // 広めの安全パッド
        const up = 0.6 + rand() * 1.4; // 高台より上へ
        dyTop = Math.min(seg.drop + up, 4.3); // バウンド到達高の余裕を残す上限
        dTheta = 0.34 + rand() * 0.3;
        gapFrac = 0.6;
        forceSpacing = true;
        keepSize = true;
      }
    } else if (segType === 'chasm') {
      // ギリギリ届く大ジャンプ。着地は広い安全パッドなので、思い切り助走すれば必ず届く。
      dyTop = 0.7 + rand() * 0.5;
      hx = hz = 1.55;                  // 大きく取って着地を許容 (踏み外し前提にしない)
      dTheta = 0.24 + rand() * 0.14;
      radius = clamp(8 + Math.sin(theta * 0.5) * 4, 5, 13);
      gapFrac = 0.9;                   // 到達距離の 9 割 = 明確に「大きい」が必ず届く
      forceSpacing = true;
      keepSize = true;                 // 着地パッドは広いまま (大ジャンプの受け皿)
    } else if (segType === 'crumbleRun' && y > 24) {
      // 踏むと崩れる足場が連続。立ち止まれないので前へ前へと駆け抜ける疾走区間。
      kind = 'crumble';
      hx = hz = 1.05;
      dTheta = 0.26 + rand() * 0.16;
      gapFrac = 0.5;
      forceSpacing = true;
    } else if (segType === 'phaseGate' && y > 44) {
      // 出たり消えたりする足場が連続。点滅のリズムを読んで渡る。
      kind = 'phase';
      hx = hz = 1.1;
      phaseCfg = {
        period: 2.6 + rand() * 1.4,
        onFrac: 0.6 + rand() * 0.12,
        offset: rand(),
      };
      dTheta = 0.26 + rand() * 0.16;
      gapFrac = 0.52;
      forceSpacing = true;
    } else {
      // spiral: 従来どおりの多彩なランダム (動く/崩れる/位相/ビーム/小)。
      // crumbleRun/phaseGate が高度制限に引っかかった時もここへフォールバックする。
      const roll = rand();
      if (roll < 0.17 && y > 8) {
        // 動く足場: 序盤 (8m〜) から登場。低所では振幅・速度を控えめに。
        const ease = clamp((y - 8) / 40, 0, 1);
        const speedBoost = 1 + 1.3 * hFactor; // 高所ほど速い
        kind = 'move';
        hx = hz = 1.15;
        if (y > 30 && rand() < 0.4) {
          move = {
            axis: 'y',
            amp: 0.4 + rand() * 0.35,
            speed: (0.7 + rand() * 0.5) * speedBoost,
            phase: rand() * Math.PI * 2,
          };
        } else {
          move = {
            axis: rand() < 0.5 ? 'x' : 'z',
            amp: 1.1 + rand() * (0.8 + 0.6 * ease),
            speed: (0.5 + rand() * 0.45) * speedBoost,
            phase: rand() * Math.PI * 2,
          };
        }
      } else if (roll < 0.27 && y > 24) {
        kind = 'crumble';
        hx = hz = 1.0;
      } else if (roll < 0.35 && y > 44) {
        kind = 'phase';
        hx = hz = 1.05;
        phaseCfg = {
          period: 2.6 + rand() * 1.8,
          onFrac: 0.55 + rand() * 0.15,
          offset: rand(),
        };
      } else if (roll < 0.5 && y > 5) {
        kind = 'beam';
      } else if (roll < 0.66) {
        kind = 'small';
        hx = hz = 0.75 + rand() * 0.45;
      }
    }

    // らせん状に上へ
    theta += dTheta;
    let nx = Math.cos(theta) * radius;
    let nz = Math.sin(theta) * radius;

    if (kind === 'beam') {
      if (Math.abs(nx - prev.x) > Math.abs(nz - prev.z)) { hx = 2.4; hz = 0.42; }
      else { hx = 0.42; hz = 2.4; }
    } else if (kind === 'narrow') {
      // 細道: 進行方向に長く (2.0m) / 直交方向に細く (幅 0.9m)。連続した一本道に見せる。
      if (Math.abs(nx - prev.x) > Math.abs(nz - prev.z)) { hx = 2.0; hz = 0.45; }
      else { hx = 0.45; hz = 2.0; }
    }

    // 高所ほど平均的な足場の面積を小さくする (rest / goal / base / 縮小除外は対象外)。
    // 到達距離の補正より前に縮めるので、小さくなった分だけ足場の間隔も詰まる。
    if (kind !== 'rest' && !keepSize) {
      const sizeScale = 1 - 0.42 * hFactor; // ゴール付近で約 0.58 倍
      hx *= sizeScale;
      hz *= sizeScale;
    }

    // 必ず届く距離に補正: ジャンプ物理の到達距離から安全マージンを引いた値を上限に。
    // 横に動く足場は自分と直前の振幅ぶんも詰める (位相がズレていても届くように)。
    // 上下に動く足場は最下点 (= 静止足場と同じ高さ) が届くので水平方向の補正は不要。
    // set-piece 区間 (forceSpacing) では自然な間隔でも常に整え、リズムを一定に保つ。
    const rNew = Math.min(hx, hz);
    // 直前の足場から飛び出す初速で届く距離。バウンド台から跳ぶ段は BOUNCE_VEL で大きく伸びる。
    let maxGap = reachWith(prevLaunch, dyTop) - 0.55;
    if (move && move.axis !== 'y') maxGap -= move.amp;
    maxGap = Math.max(maxGap - prev.amp, 0.9);
    const dx = nx - prev.x;
    const dz = nz - prev.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const edge = dist - rNew - prev.r;
    if (forceSpacing || edge > maxGap * 0.95 || edge < 0.4) {
      const frac = forceSpacing ? gapFrac : 0.45 + rand() * 0.5;
      const want = prev.r + rNew + maxGap * frac;
      nx = prev.x + (dx / dist) * want;
      nz = prev.z + (dz / dist) * want;
    }

    // 動く足場の可動域が「下の足場に立つプレイヤーの体」を薙ぎ払わないように補正。
    // 掃引後の箱が立ち位置に重なると、側面の押し出しがプレイヤーを足場から
    // 突き落としてしまう (細いビームでは即落下)。すき間が保てる軸を選び、
    // それでも足りなければ振幅を絞る。絞りきれなければ静止足場にする。
    if (move && move.axis !== 'y') {
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
    const jumpH = (prevLaunch * prevLaunch) / (2 * CONFIG.GRAVITY); // 直前の足場からの跳躍高
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

    platforms.push({ x: nx, y: top - hy, z: nz, hx, hy, hz, move, kind, phaseCfg, seg: segType });
    // 次の段の到達距離計算用: この足場から飛び出す初速 (バウンド台なら BOUNCE_VEL)。
    const launch = kind === 'bounce' ? CONFIG.BOUNCE_VEL : CONFIG.JUMP_VEL;
    prev = { x: nx, z: nz, r: rNew, amp: (move && move.axis !== 'y') ? move.amp : 0, top, launch };
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
