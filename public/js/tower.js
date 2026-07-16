import { CONFIG } from './config.js';
import { mulberry32 } from './rng.js';

// 塔の生成 (純粋関数)。THREE に依存しないので Node からも検証できる。
// platform: { x, y, z, hx, hy, hz, move, kind, phaseCfg, belt, cp, seg }
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

// 区間内でジャンプ間隔に「息づかい」を付けるリズムパターン (gapFrac に乗算)。
// 全部同じ間隔で並ぶ単調さを消し、「短・短・長」のような人間的な譜面にする。
// シードから決定的に選ぶので全員同じコース (運要素にはならない)。
const RHYTHMS = [
  [1, 1, 1],
  [0.85, 1, 1.3],
  [1.25, 0.7],
  [0.9, 0.9, 1.35],
];

export function generateTower(seed = CONFIG.SEED) {
  const rand = mulberry32(seed);
  const platforms = [];
  const obstacles = []; // 螺旋階段の柱など、以降ずっとめり込みを避けるべき大型構造物

  platforms.push({ x: 0, y: -0.5, z: 0, hx: 7, hy: 0.5, hz: 7, move: null, kind: 'base' });

  let theta = rand() * Math.PI * 2;
  let prev = { x: 0, z: 0, r: 5.5, amp: 0, top: 0, launch: CONFIG.JUMP_VEL };
  let lastRestY = 0;
  let cpCount = 0;       // チェックポイント (休憩所) の通し番号 (区間タイム計測用)
  let prevKind = 'base'; // 直前の足場の種類 (崩れ足場→点滅足場の理不尽コンボ回避に使う)

  // ================== セグメント (set-piece) プランナ ==================
  // 単調な螺旋の代わりに、性格の違う「区間」をつないで人間が設計したような緩急を作る。
  //   flow        … 助走ゾーン。サブスタイル (広場/飛び石/滑走路) で毎回顔つきが変わる
  //   elevator    … 上下に動くブロックが続く区間 (タイミングを合わせて渡る)
  //   zigzag      … 内外に振られながら登る weave 区間
  //   crumbleRun  … 踏むと崩れる足場が連続 (立ち止まれない疾走区間)
  //   phaseGate   … 出たり消えたりする足場が波状に点滅 (リズムを読んで渡る)
  //   narrowBridge… めっちゃ細い一本道 (踏み外さないよう慎重に渡るタイトロープ)
  //   bounceRoute … 高台から下のバウンドブロックへ降り、跳ね返って遠くの台へ (脳汁ルート)
  //   chasm       … ギリギリ届く大ジャンプ。着地は広い安全パッド
  //   spiralStairs… 中央柱のまわりを巻き上がる螺旋階段。てっぺんの柱上がゴール (ランドマーク)
  //   hairpin     … つづら折り。まっすぐ登って 180° 折り返す山道スイッチバック
  //   dropRoute   … わざと下るルート。下った分の滞空を使いギリギリ届く大ジャンプで帰還
  //   iceRink     … 氷の足場。加減速が利かずツルツル滑る (勢いの管理が問われる)
  //   conveyorBridge … ベルトコンベア橋。逆走ベルトや横流しベルトに逆らって渡る
  //   gauntlet    … 激ムズの試練の間。小さい足場 + 大ジャンプ + 点滅/可動のミックス
  //   spiral      … 従来どおりの多彩なランダム螺旋
  // どれも到達距離はジャンプ物理から逆算して必ず届く範囲に収める (運ではなく技術で越える)。
  // 難所のあとには必ず flow を挟み、「緊張 → 緩和」のリズム (脳汁) を生む。
  let seg = { type: 'flow', left: 5, i: 0, total: 5, style: 0 }; // 序盤は安心して登れる助走路から
  let needBreather = false;            // 直前が難所なら次は flow を差し込む
  let zzToggle = false;                // zigzag の内外トグル
  let lastSpecial = '';                // 同じ名物区間が連続しないように覚えておく
  let gauntletCount = 0;               // 試練の間の出現回数 (最大2、終盤に最低1を保証)

  function pickSegment(hf) {
    // 明示座標で組んだ区間 (螺旋階段・つづら折り) の後は、らせん角を現在位置に合わせ直す
    if (seg.resync) {
      const a = Math.atan2(prev.z, prev.x);
      if (Number.isFinite(a)) theta = a;
    }
    if (needBreather) {
      needBreather = false;
      return {
        type: 'flow',
        left: 2 + Math.floor(rand() * 4), // 助走 2〜5 枚 (難所の密度を保つため短め)
        i: 0,
        style: Math.floor(rand() * 3),    // 0=広場 / 1=飛び石 / 2=滑走路
        rhythm: RHYTHMS[Math.floor(rand() * RHYTHMS.length)],
      };
    }
    needBreather = true;
    const pool = ['spiral'];
    if (hf > 0.02 && hf < 0.9) pool.push('spiralStairs'); // 終盤は柱が塔の頂上を突き抜けるので出さない
    if (hf > 0.03) pool.push('elevator');
    if (hf > 0.05) pool.push('hairpin');
    if (hf > 0.06) pool.push('bounceRoute');
    if (hf > 0.08) pool.push('narrowBridge');
    if (hf > 0.10) pool.push('zigzag', 'dropRoute');
    if (hf > 0.12) pool.push('iceRink');
    if (hf > 0.13) pool.push('chasm');
    if (hf > 0.15) pool.push('conveyorBridge');
    if (hf > 0.16) pool.push('crumbleRun');
    if (hf > 0.20 && hf < 0.9) pool.push('spiralStairs');
    if (hf > 0.20) pool.push('bounceRoute');
    if (hf > 0.24) pool.push('phaseGate');
    if (hf > 0.30) pool.push('iceRink', 'conveyorBridge', 'chasm');
    if (hf > 0.55 && gauntletCount < 2) pool.push('gauntlet');
    let type = pool[Math.floor(rand() * pool.length)];
    if (type === lastSpecial) type = pool[Math.floor(rand() * pool.length)]; // 連続を避けて1回引き直す
    if (hf > 0.72 && gauntletCount === 0) type = 'gauntlet'; // 終盤に一度は「試練の間」を必ず出す
    lastSpecial = type;

    const s = { type, left: 4 + Math.floor(rand() * 4), i: 0 };
    if (type === 'spiral' || type === 'crumbleRun') s.left = 3 + Math.floor(rand() * 3);
    if (type === 'bounceRoute') { s.left = 2; s.resync = true; }  // バウンド台 → 着地パッドの2枚1組
    if (type === 'narrowBridge') s.left = 5 + Math.floor(rand() * 4);
    if (type === 'chasm') s.left = 2 + Math.floor(rand() * 2);
    if (type === 'elevator') {
      s.speed = 0.6 + rand() * 0.35;
      s.phase = rand() * Math.PI * 2;
      s.rhythm = RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
    }
    if (type === 'zigzag') s.rhythm = RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
    if (type === 'phaseGate') {
      // 区間内で周期をそろえ、位相を少しずつずらす = 「波」が順に走る。リズムが読める実力ゲー。
      // 隣どうしの出現の重なり (onFrac - 波のずれ 0.22) は最低でも約 1.2 秒あり、
      // 前の足場が消える間際に乗ってしまっても、即跳べば必ず次に間に合う。
      s.period = 2.8 + rand() * 0.8;
      s.onFrac = 0.66 + rand() * 0.08;
      s.offset0 = rand();
    }
    if (type === 'spiralStairs') {
      s.left = 8 + Math.floor(rand() * 4);               // 段数 (最後の1枚は柱のてっぺんのフタ)
      s.R = 2.55 + rand() * 0.35;                        // 柱からの段の距離
      s.dphi = (0.55 + rand() * 0.2) * (rand() < 0.5 ? -1 : 1); // 右巻き/左巻き
      s.resync = true;
      // 階段の円柱領域 (段の外縁 + 余裕) が既存の足場と重ならない方角を探して中心を確定する。
      // 重なると「頭上に段がかぶさって立てない足場」ができてしまう。さらに、直近の
      // 足場どうしの跳躍経路にも近づけない (柱が通り道を塞ぐと登り直せない)。
      // 探索は進行方向の前方 ±103° に限る (真後ろに置くと来た道を壊す)。
      const capTop = prev.top + s.left * 0.62;
      const gap0 = Math.min(reachAt(0.65) - 0.9, 2.6);
      const D = prev.r + 0.85 + gap0 + s.R;              // prev から中心までの距離
      const tx = Math.cos(theta + 0.4) * 9, tz = Math.sin(theta + 0.4) * 9;
      const ang0 = Math.atan2(tz - prev.z, tx - prev.x);
      const routeRecent = platforms.filter((q) => q.kind !== 'pillar').slice(-7);
      let found = false;
      for (let k = 0; k < 9 && !found; k++) {
        const ang = ang0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45;
        const cx = prev.x + Math.cos(ang) * D;
        const cz = prev.z + Math.sin(ang) * D;
        let ok = true;
        for (const q of platforms) {
          const qTop = q.y + q.hy, qBot = q.y - q.hy;
          if (qTop < prev.top - 4 || qBot > capTop + 3.6) continue; // 縦に無関係な足場
          const ddx = Math.max(Math.abs(cx - q.x) - q.hx, 0);
          const ddz = Math.max(Math.abs(cz - q.z) - q.hz, 0);
          if (Math.hypot(ddx, ddz) < s.R + 1.5) { ok = false; break; }
        }
        // 直近の跳躍経路 (足場どうしを結ぶ線分) からも階段の外縁ぶん離す
        for (let j = 1; ok && j < routeRecent.length; j++) {
          const a = routeRecent[j - 1], b = routeRecent[j];
          const dx = b.x - a.x, dz = b.z - a.z;
          const L2 = dx * dx + dz * dz || 1e-9;
          const u = clamp(((cx - a.x) * dx + (cz - a.z) * dz) / L2, 0, 1);
          if (Math.hypot(cx - (a.x + dx * u), cz - (a.z + dz * u)) < s.R + 1.4) ok = false;
        }
        if (ok) { s.cx = cx; s.cz = cz; found = true; }
      }
      if (!found) {
        return { type: 'zigzag', left: 4 + Math.floor(rand() * 4), i: 0, rhythm: RHYTHMS[Math.floor(rand() * RHYTHMS.length)] };
      }
    }
    if (type === 'hairpin') {
      s.spl = 3 + Math.floor(rand() * 2);                // 片道の段数
      s.left = s.spl * 2 + 2;                            // 往路 + 折り返し2枚 + 復路
      s.turnSign = rand() < 0.5 ? -1 : 1;
      s.resync = true;
    }
    if (type === 'dropRoute') s.left = 3;                // 下り2枚 + 帰還の大ジャンプ1枚
    if (type === 'iceRink') {
      s.left = 4 + Math.floor(rand() * 3);
      s.rhythm = RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
    }
    if (type === 'conveyorBridge') {
      s.left = 4 + Math.floor(rand() * 3);
      s.beltMode = rand() < 0.6 ? 'back' : 'side';       // 逆走ベルト or 横流しベルト
      // 逆走は進みが遅くなるだけなので速め、横流しは縁から落とされるので控えめに
      s.beltSpeed = s.beltMode === 'side'
        ? 1.1 + rand() * 0.3 + hf * 0.4
        : 1.4 + rand() * 0.5 + hf * 0.8;
      s.sideSign = rand() < 0.5 ? -1 : 1;
    }
    if (type === 'gauntlet') { s.left = 6; s.offset0 = rand(); gauntletCount++; }
    s.total = s.left;
    return s;
  }

  while (prev.top < CONFIG.GOAL_HEIGHT - 4 && platforms.length < 1200) {
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
    let belt = null;                                               // ベルトコンベアの搬送ベクトル (m/s)
    let cpIdx = null;                                              // チェックポイント番号 (rest のみ)
    let hx = 1.1 + rand() * 0.9;
    let hz = 1.1 + rand() * 0.9;
    let hy = 0.3;
    let dTheta = 0.25 + rand() * 0.55;                              // theta の進み (螺旋の巻き)
    let radius = clamp(8 + Math.sin(theta * 0.6) * 4 + (rand() - 0.5) * 3, 4, 14);
    let gapFrac = 0.45 + rand() * 0.5;                              // 到達距離に対する間隔の割合
    let forceSpacing = false;                                      // true: 常に一定間隔へ整える
    let keepSize = false;                                          // true: 高所でも縮小しない (細道の幅・安全パッドを保つ)
    let noCorrect = false;                                         // true: 位置補正しない (螺旋階段など厳密な形を保つ)
    let explicit = null;                                           // {x,z} 明示的なターゲット座標 (螺旋階段・つづら折り)

    const y = prev.top + dyTop; // 仮の上面高度 (後で中心へ直す)
    // 高度係数 (0 = 地上, 1 = ゴール)。上へ行くほど足場を小さく・動きを速くする
    const hFactor = clamp(y / CONFIG.GOAL_HEIGHT, 0, 1);

    if (y - lastRestY > 42 && segType !== 'spiralStairs') {
      // 休憩所は距離で強制割り込み (どのセグメントでも共通のチェックポイント)。
      // 螺旋階段の途中にだけは挟まない (円形の並びが壊れるので、階段が終わった直後に置かれる)
      kind = 'rest';
      hx = hz = 2.7;
      hy = 0.45;
      dyTop = 0.7 + rand() * 0.4; // 休憩所 (チェックポイント) への最後の一歩は必ず易しく
      forceSpacing = true;
      gapFrac = 0.55;             // 間隔も常識的な距離に整える (直前が点滅足場でも確実に届く)
      lastRestY = y;
      cpIdx = ++cpCount; // チェックポイント番号 (通過タイムの区間計測に使う)
      seg.left = 0; // 休憩したら次は新しいセグメントへ
    } else if (segType === 'flow') {
      // 助走ゾーン: 静止足場が心地よいリズムで並ぶ。サブスタイルで毎回景色を変える。
      dTheta = 0.17 + rand() * 0.06;
      radius = 9 + Math.sin(theta * 0.55) * 3;
      forceSpacing = true;
      if (seg.style === 1) {
        // 飛び石: 小さめの足場を細かく踏んでいく
        dyTop = 0.7 + rand() * 0.3;
        hx = hz = 1.0;
        gapFrac = 0.42;
      } else if (seg.style === 2) {
        // 滑走路: 低い段差 + 長めのジャンプで滑空するように進む
        dyTop = 0.35 + rand() * 0.25;
        hx = hz = 1.35;
        hy = 0.5;
        gapFrac = 0.68;
      } else {
        // 広場: 大きめの静止足場が一定リズムで並ぶ
        dyTop = 0.8 + rand() * 0.35;
        hx = hz = 1.5;
        gapFrac = 0.5;
      }
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
        seg.fromX = prev.x;            // 高台の位置 (跳ね先を進入方向に揃えるのに使う)
        seg.fromZ = prev.z;
        seg.drop = 1.8 + rand() * 1.4; // 高台より 1.8〜3.2m 下
        dyTop = -seg.drop;
        dTheta = 0.55 + rand() * 0.4;  // 横へ大きく振って「離れた」位置へ
        gapFrac = 0.62;
        forceSpacing = true;
        keepSize = true;
      } else {
        // (2) バウンドで届く遠く高くの着地パッド。BOUNCE_VEL の跳躍高 (≈5.1m) 内に必ず収める。
        // 位置は進入方向 (高台 → バウンド台) の延長線上に置く: 走ってきた勢いが
        // そのまま横速度として乗るので、大きく曲がる跳ね先より確実に届く。
        kind = 'box';
        hx = hz = 1.7;                 // 広めの安全パッド
        const up = 0.6 + rand() * 1.4; // 高台より上へ
        dyTop = Math.min(seg.drop + up, 3.9); // バウンド到達高 (≈5.1m) に余裕を残す上限
        let ax = prev.x - seg.fromX, az = prev.z - seg.fromZ;
        const al = Math.hypot(ax, az) || 1;
        ax /= al; az /= al;
        const wob = (rand() - 0.5) * 0.5; // ±0.25rad だけ揺らして単調さを消す
        const ca = Math.cos(wob), sa = Math.sin(wob);
        explicit = { x: prev.x + (ax * ca - az * sa) * 4, z: prev.z + (ax * sa + az * ca) * 4 };
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
      gapFrac = 0.88 + rand() * 0.05;  // 到達距離の 9 割前後 = 明確に「ギリギリ」だが必ず届く
      forceSpacing = true;
      keepSize = true;                 // 着地パッドは広いまま (大ジャンプの受け皿)
    } else if (segType === 'spiralStairs') {
      // 螺旋階段: 中央に太い柱を立て、そのまわりを小さな段が巻き上がる。
      // 最後は柱のてっぺんのフタ (見晴らし台) に乗って終わる、塔の中のランドマーク。
      // 中心 (seg.cx, seg.cz) は pickSegment で既存の足場と重ならない位置を確認済み。
      if (stepIdx === 0) {
        seg.phi = Math.atan2(prev.z - seg.cz, prev.x - seg.cx); // 中心から見て入口側の角度
        const capTop = prev.top + seg.total * 0.62;   // フタの上面高さ (段ごとに 0.62m 上がる)
        const pillarBot = prev.top - 6;
        const pillarTop = capTop - 0.9;               // フタの底面にぴったり接する
        const pillar = {
          x: seg.cx, y: (pillarTop + pillarBot) / 2, z: seg.cz,
          hx: 0.72, hy: (pillarTop - pillarBot) / 2, hz: 0.72,
          move: null, kind: 'pillar', seg: 'spiralStairs',
        };
        platforms.push(pillar);
        obstacles.push(pillar); // 以降の足場は柱にめり込まないようにする
      }
      dyTop = 0.62;
      keepSize = true;
      noCorrect = true; // 円形の並びを崩さない (段差・間隔とも物理到達内に固定済み)
      if (stepIdx === seg.total - 1) {
        // 柱のてっぺんのフタ (見晴らし台)
        hx = hz = 1.05;
        hy = 0.45;
        explicit = { x: seg.cx, z: seg.cz };
      } else {
        hx = hz = 0.85;
        if (stepIdx > 0) seg.phi += seg.dphi; // 最初の1段は入口側に置く
        explicit = { x: seg.cx + Math.cos(seg.phi) * seg.R, z: seg.cz + Math.sin(seg.phi) * seg.R };
      }
    } else if (segType === 'hairpin') {
      // つづら折り: まっすぐ登って 90°+90° で折り返し、来た道の横を逆向きに登る山道。
      if (stepIdx === 0) {
        const tx = Math.cos(theta + 0.5) * radius;
        const tz = Math.sin(theta + 0.5) * radius;
        seg.phi = Math.atan2(tz - prev.z, tx - prev.x);
      }
      const turn = stepIdx === seg.spl || stepIdx === seg.spl + 1;
      if (turn) {
        seg.phi += seg.turnSign * Math.PI / 2; // 折り返しの踊り場 (2枚で180°)
        hx = hz = 1.5;
        dyTop = 0.9;
        gapFrac = 0.5;
      } else {
        hx = hz = 1.0;
        dyTop = 1.0;
        gapFrac = 0.55;
      }
      keepSize = true;
      forceSpacing = true;
      explicit = { x: prev.x + Math.cos(seg.phi) * 4, z: prev.z + Math.sin(seg.phi) * 4 };
    } else if (segType === 'dropRoute') {
      // わざと下るルート: 2段下ってから、下った分の滞空時間で「ギリギリ届く」大ジャンプで帰還。
      keepSize = true;
      forceSpacing = true;
      if (stepIdx < 2) {
        hx = hz = 1.3;
        dyTop = -(1.4 + rand() * 0.6); // 一段ずつ下りながら外へ離れる
        dTheta = 0.3 + rand() * 0.15;
        gapFrac = 0.55;
      } else {
        hx = hz = 1.7;                 // 帰還先は広い安全パッド
        dyTop = -0.2;                  // わずかに下 = 滞空最大 → 大ジャンプが成立する
        dTheta = 0.22 + rand() * 0.1;
        gapFrac = 0.92;                // ギリギリ届く快感 (物理到達の 92%)
      }
    } else if (segType === 'iceRink' && y > 20) {
      // 氷の回廊: 長い氷の足場。加減速が利かないので勢いの管理 (早めのブレーキ) が問われる。
      kind = 'ice';
      hx = 1.5 + rand() * 0.5;
      hz = 1.5 + rand() * 0.5;
      dyTop = 0.65 + rand() * 0.3;
      dTheta = 0.26 + rand() * 0.1;
      gapFrac = 0.5;
      forceSpacing = true;
      keepSize = true;
    } else if (segType === 'conveyorBridge' && y > 20) {
      // ベルトコンベア橋: 逆走ベルト (進むほど押し戻される) or 横流しベルト (縁へ流される)。
      kind = 'conveyor';
      dyTop = 0.5 + rand() * 0.25;
      dTheta = 0.12 + rand() * 0.05;
      if (seg.bridgeR == null) seg.bridgeR = clamp(7 + Math.sin(theta * 0.5) * 3, 5, 12);
      radius = seg.bridgeR;
      gapFrac = 0.34;
      forceSpacing = true;
      keepSize = true;
    } else if (segType === 'gauntlet' && y > 44) {
      // 試練の間: 小さい足場 + 高い段差 + 大きめの間隔 + 点滅/可動のミックス。
      // 全て物理到達内 & リズム固定なので、腕さえあれば必ず抜けられる実力ゲーの最難関。
      keepSize = true;
      forceSpacing = true;
      hx = hz = stepIdx === 0 ? 0.95 : 0.72; // 入口の1枚だけ少し広い (覚悟を決める踊り場)
      dyTop = 1.1 + rand() * 0.3;
      dTheta = 0.3 + rand() * 0.2;
      gapFrac = 0.8;
      const pat = stepIdx % 3;
      if (pat === 1) {
        kind = 'phase';
        phaseCfg = { period: 3.0, onFrac: 0.66, offset: ((seg.offset0 - stepIdx * 0.28) % 1 + 1) % 1 };
      } else if (pat === 2) {
        kind = 'move';
        move = {
          axis: rand() < 0.5 ? 'x' : 'z',
          amp: 0.9 + rand() * 0.4,
          speed: 1.2 + rand() * 0.4,
          phase: rand() * Math.PI * 2,
        };
      }
    } else if (segType === 'crumbleRun' && y > 24) {
      // 踏むと崩れる足場が連続。立ち止まれないので前へ前へと駆け抜ける疾走区間。
      // 走り続ける区間なので段差は低め・大きさは高所でも維持する (縮小＋点滅は理不尽)。
      kind = 'crumble';
      hx = hz = 0.95;
      dyTop = 0.7 + rand() * 0.4;
      dTheta = 0.26 + rand() * 0.16;
      gapFrac = 0.5;
      forceSpacing = true;
      keepSize = true;
    } else if (segType === 'phaseGate' && y > 44) {
      // 出たり消えたりする足場が連続。区間内で周期が同じ + 位相が順にずれる「波」なので、
      // 点滅のリズムを読めば流れるように渡れる (実力で安定攻略できる)。
      // 波は進行方向に走らせる (offset を引く) — 「いま乗っている足場が出ている間に
      // 次の足場が必ず現れる」ことが保証され、理不尽な待ちぼうけ落下が起きない。
      kind = 'phase';
      hx = hz = 0.95;
      dyTop = 0.7 + rand() * 0.4; // タイミング勝負の区間なので段差は控えめに
      phaseCfg = {
        period: seg.period || 3.0,
        onFrac: seg.onFrac || 0.66,
        offset: (((seg.offset0 || 0) - stepIdx * 0.22) % 1 + 1) % 1,
      };
      dTheta = 0.26 + rand() * 0.16;
      gapFrac = 0.52;
      forceSpacing = true;
      keepSize = true; // 高所でも縮小しない (点滅 + 極小は理不尽になる)
    } else {
      // spiral: 従来どおりの多彩なランダム (動く/崩れる/位相/ビーム/小)。
      // 高度制限に引っかかった特殊セグメントもここへフォールバックする。
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
      } else if (roll < 0.27 && y > 24 && prevKind !== 'phase') {
        // 崩れ足場。直前が点滅足場なら出さない (乗るタイミングを待つ場所が無くなるため)
        kind = 'crumble';
        hx = hz = 1.0;
      } else if (roll < 0.35 && y > 44 && prevKind !== 'crumble') {
        // 点滅足場。直前が崩れ足場なら出さない (待っている間に崩れて詰むため)
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

    // リズムパターン: 区間内でジャンプ間隔を「短・短・長」のように揺らす (単調さ対策)。
    // flow (助走ゾーン) の「長」は 0.82 まで — 本気の大ジャンプは chasm の役目。
    if (seg.rhythm && forceSpacing) {
      const cap = segType === 'flow' ? 0.82 : 0.93;
      gapFrac = clamp(gapFrac * seg.rhythm[stepIdx % seg.rhythm.length], 0.2, cap);
    }
    if (kind === 'ice') gapFrac = Math.min(gapFrac, 0.66); // 氷は助走が鈍るぶん間隔を絞る

    // らせん状に上へ (螺旋階段・つづら折りは明示座標)
    let nx, nz;
    if (explicit) {
      nx = explicit.x;
      nz = explicit.z;
    } else {
      theta += dTheta;
      nx = Math.cos(theta) * radius;
      nz = Math.sin(theta) * radius;
    }

    if (kind === 'beam') {
      if (Math.abs(nx - prev.x) > Math.abs(nz - prev.z)) { hx = 2.4; hz = 0.42; }
      else { hx = 0.42; hz = 2.4; }
    } else if (kind === 'narrow') {
      // 細道: 進行方向に長く (2.0m) / 直交方向に細く (幅 0.9m)。連続した一本道に見せる。
      if (Math.abs(nx - prev.x) > Math.abs(nz - prev.z)) { hx = 2.0; hz = 0.45; }
      else { hx = 0.45; hz = 2.0; }
    } else if (kind === 'conveyor') {
      // ベルト: 進行方向に長い台。ベルトの向きは位置確定後に決める。
      if (Math.abs(nx - prev.x) > Math.abs(nz - prev.z)) { hx = 2.1; hz = 1.0; }
      else { hx = 1.0; hz = 2.1; }
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
    if (!noCorrect && (forceSpacing || edge > maxGap * 0.95 || edge < 0.4)) {
      const frac = forceSpacing ? Math.min(gapFrac, 0.93) : 0.45 + rand() * 0.5;
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
      for (let i = 1; i < platforms.length; i++) {
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

    // 細道・ベルトの連結の整形。上のピースが下のピースに覆いかぶさると、下に立つ
    // プレイヤーが押し出し処理で細い側へはじき出されて落ちる罠になるため、
    //   同じ向き   → 横ズレを揃え「端と端を突き合わせた階段」にする (重ならない)。
    //                進む向きはチェーンで一貫させる (反転すると2つ前の真上に積み重なる)
    //   直交コーナー→ 重なりが消えるまで新しいピースを長軸方向へずらす
    // このあとの頭上ふさぎ検査 (blockedAt) より前に行い、整形後の位置を検査に通す。
    if ((kind === 'narrow' || kind === 'conveyor') && platforms.length) {
      const q = platforms[platforms.length - 1];
      if (q.kind === kind) {
        const qAxis = q.hx > q.hz ? 'x' : 'z';
        const nAxis = hx > hz ? 'x' : 'z';
        if (qAxis === nAxis) {
          if (seg.chainAxis !== nAxis || seg.chainSign == null) {
            seg.chainAxis = nAxis;
            seg.chainSign = nAxis === 'x' ? Math.sign(nx - q.x || 1) : Math.sign(nz - q.z || 1);
          }
          if (nAxis === 'x' && Math.abs(nz - q.z) < 2.2) {
            nz = q.z;
            nx = q.x + seg.chainSign * (hx + q.hx + 0.15);
          } else if (nAxis === 'z' && Math.abs(nx - q.x) < 2.2) {
            nx = q.x;
            nz = q.z + seg.chainSign * (hz + q.hz + 0.15);
          }
        } else {
          seg.chainAxis = nAxis;
          seg.chainSign = nAxis === 'x' ? Math.sign(nx - q.x || 1) : Math.sign(nz - q.z || 1);
          const overX = (hx + q.hx) - Math.abs(nx - q.x);
          const overZ = (hz + q.hz) - Math.abs(nz - q.z);
          if (overX > 0 && overZ > 0) {
            if (nAxis === 'x') nx += seg.chainSign * (overX + 0.15);
            else nz += seg.chainSign * (overZ + 0.15);
          }
        }
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
    // 下りの着地台は頭上の張り出しを完全に避ける (降下ジャンプの弧を邪魔されないように)
    const avoidOverhang = dyTop < -0.5;
    // ジャンプ頂点で頭のてっぺんが届く高さ = 立ち位置から ジャンプ高 + 体の全高。
    const headReach = jumpH + CONFIG.PLAYER_HALF_H * 2;
    const BODY = CONFIG.PLAYER_HALF_H * 2 + 0.15; // 立っている体がすっぽり入るのに要る縦の空き

    const blockedAt = (tx, tz) => {
      // 螺旋階段の柱などの大型構造物には絶対にめり込ませない
      // (てっぺんに「ぴったり乗る」フタは許容: newBot ≥ 柱の上面)
      for (const q of obstacles) {
        const qTop = q.y + q.hy;
        const qBot = q.y - q.hy;
        if (top > qBot && newBot < qTop - 0.01) {
          const overX = (hx + q.hx + PR) - Math.abs(tx - q.x);
          const overZ = (hz + q.hz + PR) - Math.abs(tz - q.z);
          if (overX > 0 && overZ > 0) return true;
        }
      }
      // 直近だけでなく全足場を検査する (らせんが一周して戻ると、17枚前の跳躍経路の
      // 真上に来ることがある)。高さが無関係な足場は先頭の条件で即座に除外される。
      for (let k = platforms.length - 1; k >= 1; k--) {
        const q = platforms[k];
        if (q.kind === 'pillar') continue; // 柱は obstacles 側で別途検査済み
        const qTop = q.y + q.hy;
        const qBot = q.y - q.hy;
        if (qTop < newBot - headReach - 0.2 || qBot > Math.max(top, prev.top) + headReach + 0.2) continue; // 縦に無関係
        // (a) この足場が q の打ち上げ経路にフタをしていないか (q は下の足場に限る)。
        //     経路のサンプリングは通常ジャンプの最大到達距離ぶん (≈5.4m) 取る。
        //     短いと chasm (大跳躍) の中盤にフタが置かれて空中で頭をぶつける。
        if (top > qTop && newBot < qTop + headReach) {
          const nxt = platforms[k + 1] || prev;
          let cx = nxt.x - q.x, cz = nxt.z - q.z;
          const cl = Math.hypot(cx, cz) || 1e-6; cx /= cl; cz /= cl;
          const start = Math.min(q.hx, q.hz);
          for (let s = 0; s <= 5.4; s += 0.3) {
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
        // (d) この足場への跳躍経路 (prev → ここ) の上に、既存の q のフタが無いか。
        //     (a) の鏡像: らせんが一周して戻り「古い足場の下に新しい経路が通る」形を防ぐ。
        //     q の底面が跳び出し口より上・頭の届く高さより下にある時だけ経路を走査する。
        if (qBot > prev.top + 0.2 && qBot < prev.top + headReach) {
          let cx = tx - prev.x, cz = tz - prev.z;
          const cl = Math.hypot(cx, cz) || 1e-6;
          cx /= cl; cz /= cl;
          const sEnd = Math.max(cl - rNew - 0.1, prev.r);
          for (let s = prev.r; s <= sEnd; s += 0.35) {
            const px = prev.x + cx * s, pz = prev.z + cz * s;
            if (px > q.x - q.hx - PR && px < q.x + q.hx + PR && pz > q.z - q.hz - PR && pz < q.z + q.hz + PR) return true;
          }
        }
        // (c) 逆に、既存の q がこの足場を頭上から覆っていないか。ほぼ全面を覆われると
        //     跳び出す場所が無くなる。下りの着地台 (dropRoute・バウンド台) は、張り出しの
        //     下に置くと「降りようとした自動ジャンプの弧が張り出しに乗ってしまう」ので、
        //     部分的な重なりも許さない。
        if (top < qBot && qBot - top < headReach) {
          const overX2 = (hx + q.hx + PR) - Math.abs(tx - q.x);
          const overZ2 = (hz + q.hz + PR) - Math.abs(tz - q.z);
          if (overX2 > 0 && overZ2 > 0) {
            if (avoidOverhang) return true;
            const coverX = q.hx >= hx + Math.abs(tx - q.x) - 0.2;
            const coverZ = q.hz >= hz + Math.abs(tz - q.z) - 0.2;
            if (coverX && coverZ) return true;
          }
        }
      }
      return false;
    };

    if (!noCorrect && blockedAt(nx, nz)) {
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

    // ベルトコンベアの搬送ベクトル (最終位置が確定してから進行方向を基準に決める)
    if (kind === 'conveyor') {
      const sp = seg.beltSpeed || 1.5;
      const along = hx > hz ? 'x' : 'z'; // 台の長軸
      const tdx = nx - prev.x, tdz = nz - prev.z;
      if (seg.beltMode === 'side') {
        // 横流しベルト: 進行と直交する向きへ流される (踏ん張って中央を維持する)
        belt = along === 'x' ? { x: 0, z: seg.sideSign * sp } : { x: seg.sideSign * sp, z: 0 };
      } else {
        // 逆走ベルト: 進行方向と逆向きに流れる (登りエスカレーターの逆走)
        belt = along === 'x'
          ? { x: -Math.sign(tdx || 1) * sp, z: 0 }
          : { x: 0, z: -Math.sign(tdz || 1) * sp };
      }
    }

    platforms.push({
      x: nx, y: top - hy, z: nz, hx, hy, hz,
      move, kind, phaseCfg, belt,
      cp: cpIdx ?? undefined,
      seg: segType,
    });
    prevKind = kind;
    // 次の段の到達距離計算用: この足場から飛び出す初速 (バウンド台なら BOUNCE_VEL)。
    const launch = kind === 'bounce' ? CONFIG.BOUNCE_VEL : CONFIG.JUMP_VEL;
    prev = { x: nx, z: nz, r: rNew, amp: (move && move.axis !== 'y') ? move.amp : 0, top, launch };
  }

  // ゴール台 (上面が prev.top + 1.5 になるように配置)。
  // 6.8m 四方と大きいので、最終盤の足場や跳躍経路の真上にかぶせると
  // ゴール裏面に頭をぶつけて最後の一跳びが失敗する。かぶらない方角を探して置く。
  const goalTop = prev.top + 1.5;
  const goalY = goalTop - 0.5;
  const goalBot = goalY - 0.5;
  const gJumpH = (CONFIG.JUMP_VEL * CONFIG.JUMP_VEL) / (2 * CONFIG.GRAVITY);
  const gHeadR = gJumpH + CONFIG.PLAYER_HALF_H * 2;
  const GPR = CONFIG.PLAYER_R;
  const recent = platforms.filter((p) => p.kind !== 'pillar').slice(-10);
  const want = prev.r + 3.4 + 1.6;
  const ang0 = Math.atan2(prev.z, prev.x); // 基本は従来どおり塔の外向き
  let gx = prev.x + Math.cos(ang0) * want;
  let gz = prev.z + Math.sin(ang0) * want;
  for (let k = 0; k < 15; k++) {
    const ang = ang0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.4;
    const tx = prev.x + Math.cos(ang) * want;
    const tz = prev.z + Math.sin(ang) * want;
    let ok = true;
    for (let j = 0; j < recent.length && ok; j++) {
      const q = recent[j];
      if (j === recent.length - 1) continue; // prev 自身は want の距離で必ず離れている
      const qTop = q.y + q.hy;
      if (qTop < goalBot - gHeadR || qTop > goalTop) continue; // 高さが無関係
      // 足場そのものの真上を避ける
      if (Math.abs(tx - q.x) < 3.4 + q.hx + GPR && Math.abs(tz - q.z) < 3.4 + q.hz + GPR) ok = false;
      // 次の足場への跳躍経路の真上も避ける
      const n = recent[j + 1];
      for (let u = 0.15; ok && u <= 0.85; u += 0.175) {
        const px = q.x + (n.x - q.x) * u, pz = q.z + (n.z - q.z) * u;
        if (Math.abs(tx - px) < 3.4 + GPR && Math.abs(tz - pz) < 3.4 + GPR) ok = false;
      }
    }
    if (ok) { gx = tx; gz = tz; break; }
  }
  platforms.push({ x: gx, y: goalY, z: gz, hx: 3.4, hy: 0.5, hz: 3.4, move: null, kind: 'goal' });

  return { platforms, goalY, cpCount };
}
