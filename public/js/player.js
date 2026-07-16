import * as THREE from 'three';
import { CONFIG } from './config.js';

const tmpBox = {};

// 自機・ゴースト共通のアバター (オリジナルデザインの小型ロボ)
export function buildAvatar(colorHex) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ'; // ヨー (向き) の後にピッチ → お辞儀が常に「前傾」になる
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.36, 0.62, 6, 14),
    new THREE.MeshLambertMaterial({ color: colorHex })
  );
  body.position.y = 0.0;
  g.add(body);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b2138 });
  for (const sx of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat);
    eye.position.set(sx, 0.28, 0.3);
    g.add(eye);
  }

  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6),
    new THREE.MeshLambertMaterial({ color: 0xdddddd })
  );
  antenna.position.y = 0.78;
  g.add(antenna);
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe08a })
  );
  tip.position.y = 0.95;
  g.add(tip);
  return g;
}

// キャラの頭上に出す吹き出し (Sprite)。text をコメントとして描く。
// center を下端 (0.5, 0) にして position.y の高さから上へ伸びるようにする。
export function makeBubble(text) {
  const str = String(text).slice(0, 24);
  const cvs = document.createElement('canvas');
  const m = cvs.getContext('2d');
  const font = '600 30px sans-serif';
  m.font = font;
  const tw = Math.min(Math.ceil(m.measureText(str).width), 360);
  const padX = 26, tail = 16;
  const w = tw + padX * 2;
  const bodyH = 58;
  cvs.width = w;
  cvs.height = bodyH + tail;
  const c = cvs.getContext('2d');
  c.font = font;
  const rr = (x, y, ww, hh, r) => {
    if (c.roundRect) { c.beginPath(); c.roundRect(x, y, ww, hh, r); }
    else { c.beginPath(); c.rect(x, y, ww, hh); }
  };
  c.fillStyle = 'rgba(255,255,255,0.96)';
  rr(2, 2, w - 4, bodyH - 4, 18);
  c.fill();
  c.beginPath(); // 下向きのしっぽ
  c.moveTo(w / 2 - 11, bodyH - 5);
  c.lineTo(w / 2 + 11, bodyH - 5);
  c.lineTo(w / 2, bodyH + tail - 4);
  c.closePath();
  c.fill();
  c.fillStyle = '#12203a';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(str, w / 2, (bodyH - 4) / 2 + 2);

  const tex = new THREE.CanvasTexture(cvs);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, depthWrite: false, depthTest: false, transparent: true,
  }));
  const scaleH = 0.6;
  sp.scale.set(scaleH * (cvs.width / cvs.height), scaleH, 1);
  sp.center.set(0.5, 0);
  sp.position.y = 1.85;
  sp.renderOrder = 999;
  return sp;
}

// 吹き出し Sprite を破棄 (テクスチャ/マテリアルも解放)
export function disposeBubble(sp) {
  if (!sp) return;
  sp.material.map?.dispose();
  sp.material.dispose();
}

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.scene = scene;
    this.bubble = null;       // 頭上の吹き出し (コメント)
    this.bubbleT = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.standing = null;          // 乗っている足場
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.runT = 0;                 // 直近でスティックを倒して走っていた残り猶予 (端の自動ジャンプ用)
    this.yaw = 0;
    this.squash = 0;               // 着地の潰れ演出
    this.bowT = 0;                 // 会釈 (おじぎ) の残り時間
    this.maxY = 0;
    this.events = [];              // 1フレーム分の演出イベント (main が消費)

    this.mesh = buildAvatar(0xff9f43);
    scene.add(this.mesh);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    this._near = [];
    this.spawn();
  }

  setColor(hex) {
    this.mesh.children[0].material.color.setHex(hex);
  }

  // 頭上にコメントの吹き出しを出す (数秒で自動的に消える)
  say(text) {
    if (this.bubble) { this.scene.remove(this.bubble); disposeBubble(this.bubble); }
    this.bubble = makeBubble(text);
    this.scene.add(this.bubble);
    this.bubbleT = 5;
  }

  spawn() {
    this.pos.set(0, CONFIG.PLAYER_HALF_H + 0.1, 0);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.standing = null;
    this.bowT = 0;
    this.maxY = 0;
    // this.events はここでは消さない (落下→リスポーン時に 'fell' が消えるため)
  }

  get bowing() {
    return this.bowT > 0;
  }

  aabbOverlap(b) {
    const r = CONFIG.PLAYER_R, h = CONFIG.PLAYER_HALF_H;
    return (
      this.pos.x + r > b.minX && this.pos.x - r < b.maxX &&
      this.pos.y + h > b.minY && this.pos.y - h < b.maxY &&
      this.pos.z + r > b.minZ && this.pos.z - r < b.maxZ
    );
  }

  update(dt, input, camYaw, t, tPrev, ghosts = null) {
    const C = CONFIG;
    const near = this.world.nearby(this.pos.y - 4, this.pos.y + 4, this._near);

    // --- 会釈 (おじぎ): 地上でボタンを押すと数瞬おじぎする ---
    this.bowT = Math.max(this.bowT - dt, 0);
    if (input.consumeBow() && this.grounded && this.bowT <= 0) {
      this.bowT = C.BOW_TIME;
      this.events.push({ t: 'bow' });
    }

    // --- 乗っている動く足場に運ばれる (横移動 or 上下のエレベーター) ---
    if (this.grounded && this.standing && this.standing.move) {
      const d = this.world.offset(this.standing, t) - this.world.offset(this.standing, tPrev);
      const ax = this.standing.move.axis;
      if (ax === 'x') this.pos.x += d;
      else if (ax === 'z') this.pos.z += d;
      else this.pos.y += d; // 上下に動く足場に乗せて運ぶ
    }

    // --- ベルトコンベアの上では流される (逆走・横流しに踏ん張って抵抗する) ---
    // 位置だけを動かし速度は変えないので、飛び出した後のジャンプ到達距離には影響しない。
    if (this.grounded && this.standing && this.standing.belt) {
      this.pos.x += this.standing.belt.x * dt;
      this.pos.z += this.standing.belt.z * dt;
    }

    // --- 入力 → カメラ基準の移動ベクトル ---
    // 最近の3Dゲーム標準: スティックを倒した方向 (カメラ基準) へ全方向そのまま移動し、
    // キャラクターは進行方向を向くように旋回する。傾け量がそのまま速度になる
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // カメラ前方 (水平)
    const rx = -fz, rz = fx;                                 // カメラ右
    const mx = fx * input.move.y + rx * input.move.x;
    const mz = fz * input.move.y + rz * input.move.x;
    const mag = Math.min(Math.hypot(mx, mz), 1);

    // 氷ブロックの上では加減速が大きく鈍り、勢いを殺せずツルツル滑る (早めの操作が要る)
    const onIce = this.grounded && this.standing?.kind === 'ice';
    const accel = this.grounded ? (onIce ? C.ICE_ACCEL : C.GROUND_ACCEL) : C.AIR_ACCEL;
    const speed = C.MOVE_SPEED * (this.bowT > 0 ? 0.25 : 1); // おじぎ中はゆっくり
    const tx = mag > 0.001 ? (mx / Math.hypot(mx, mz)) * speed * mag : 0;
    const tz = mag > 0.001 ? (mz / Math.hypot(mx, mz)) * speed * mag : 0;
    this.vel.x += THREE.MathUtils.clamp(tx - this.vel.x, -accel * dt, accel * dt);
    this.vel.z += THREE.MathUtils.clamp(tz - this.vel.z, -accel * dt, accel * dt);
    if (mag > 0.001) {
      const wantYaw = Math.atan2(mx, mz);
      let d = wantYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(dt * 12, 1);
    }

    // --- ジャンプ (コヨーテタイム + 先行入力) ---
    this.coyote = this.grounded ? C.COYOTE_TIME : Math.max(this.coyote - dt, 0);
    this.jumpBuffer = Math.max(this.jumpBuffer - dt, 0);
    if (input.consumeJump()) this.jumpBuffer = C.JUMP_BUFFER;
    // 直近でスティックを倒して動いていたか。倒している間は満タン、離しても少しの間だけ残る。
    // 「端でジャンプしようとスティックを離した瞬間に足場から出た」ときの空振りを防ぐための猶予。
    // しきい値は低め (デッドゾーン超え＝動く意思あり)。ゆっくり歩いて端から出ても空振りしない。
    if (mag > C.ONE_HAND_AUTOJUMP_ARM) this.runT = C.ONE_HAND_AUTOJUMP_GRACE;
    else this.runT = Math.max(this.runT - dt, 0);

    // 走ったまま足場の端から出たら自動ジャンプ (片手ではスティックを倒しながら
    // ジャンプできないため走りジャンプを自動化)。コヨーテ時間内かつ下降開始前のみ。
    // 直近まで走っていれば (runT>0)、端でスティックを離した直後に飛び出しても空振りしない。
    // 止まって/ゆっくり歩いて端に立つだけなら発動せず、そのまま下の足場へ降りられる。
    if (!this.grounded && this.coyote > 0 && this.vel.y <= 0 && this.runT > 0) {
      this.jumpBuffer = C.JUMP_BUFFER;
    }
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = C.JUMP_VEL;
      this.grounded = false;
      this.standing = null;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.bowT = 0; // ジャンプでおじぎ解除
      this.squash = -0.18;
      this.events.push({ t: 'jump' });
    }

    // --- 重力・縦移動 ---
    this.vel.y -= C.GRAVITY * dt;
    this.vel.y = Math.max(this.vel.y, -30);
    const prevFeet = this.pos.y - C.PLAYER_HALF_H;
    this.pos.y += this.vel.y * dt;

    let landed = false;
    for (const p of near) {
      if (!this.world.isSolid(p, t)) continue; // 消えている足場はすり抜ける
      const b = this.world.aabb(p, t, tmpBox);
      if (!this.aabbOverlap(b)) continue;
      if (this.vel.y <= 0 && prevFeet >= b.maxY - 0.25) {
        // 上面に着地
        this.pos.y = b.maxY + C.PLAYER_HALF_H;
        if (p.kind === 'bounce') {
          // バウンドブロック: 着地せず、大きな初速で跳ね返る (通常ジャンプの約2.4倍の高さ)。
          this.vel.y = C.BOUNCE_VEL;
          this.grounded = false;
          this.standing = null;
          this.coyote = 0;
          this.jumpBuffer = 0;
          this.squash = 0.34; // ぐっと潰れてから弾ける
          this.events.push({ t: 'bounce', big: true, topY: b.maxY, plat: p });
          continue; // この足場では通常の着地/頭ぶつけ判定を行わない
        }
        if (!this.grounded) {
          // 落下速度 = 衝撃の強さ。着地先の上面高さはコンボ判定に使う
          this.events.push({ t: 'land', impact: -this.vel.y, topY: b.maxY });
        }
        if (this.vel.y < -6) this.squash = Math.min(0.28, -this.vel.y * 0.02);
        this.vel.y = 0;
        this.grounded = true;
        this.standing = p;
        landed = true;
      } else if (this.vel.y > 0 && prevFeet + C.PLAYER_HALF_H * 2 <= b.minY) {
        // 下面に頭をぶつけた (直前フレームで「頭」が下面より下にあった時だけ)。
        // 足元で判定すると、横に並んだブロックに体が重なった状態でジャンプした瞬間
        // 「頭ぶつけ」と誤判定され、体高ぶん下へスナップ → 足場を突き抜けて落下する
        this.pos.y = b.minY - C.PLAYER_HALF_H;
        this.vel.y = 0;
        this.ceilT = 0.5; // 頭上がふさがっている間はよじ登り補助を止める (真上で振動しない)
      }
    }

    // --- 水平移動 (X・Z を同時に進めてから最小移動量 (MTV) で押し出す) ---
    // 軸を別々に解決すると、足場の「角」をかすめたとき (片軸はごく浅く、もう片軸は深い)
    // 深い方の軸で大きく弾かれてワープして見える。各足場について X/Z 4辺のうち
    // 押し出し量が最小の辺だけを解決すれば、常に最短距離で押し戻すのでワープしない。
    // 速度の符号ではなく貫入量で向きを決めるので、動く足場 (水色) が横から入り込んでも安定。
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    let wallTop = null; // 横からぶつかったブロックの上面 (自動ジャンプ判定に使う)
    let wallAuto = false; // 動く足場が絡む壁接触 → 入力が無くても自動ジャンプで退避
    let wallNx = 0, wallNz = 0; // 最後に触れた壁の内向き法線 (よじ登り補助の向き)
    for (const p of near) {
      if (!this.world.isSolid(p, t)) continue; // 消えている足場はすり抜ける
      const b = this.world.aabb(p, t, tmpBox);
      if (!this.aabbOverlap(b)) continue;
      if (this.pos.y - C.PLAYER_HALF_H > b.maxY - 0.3) continue; // 上に立っている
      const penL = (this.pos.x + C.PLAYER_R) - b.minX; // -X側 (左辺) へ抜ける距離
      const penR = b.maxX - (this.pos.x - C.PLAYER_R); // +X側 (右辺) へ抜ける距離
      const penN = (this.pos.z + C.PLAYER_R) - b.minZ; // -Z側 (手前) へ抜ける距離
      const penF = b.maxZ - (this.pos.z - C.PLAYER_R); // +Z側 (奥) へ抜ける距離
      const bestX = Math.min(penL, penR);
      const bestZ = Math.min(penN, penF);
      // 1フレームで押し出す最大距離。通常の壁は 0.1m 程度で足りる。これを超える深い
      // めり込み (空中で角や裏面をかすめた等) は一気に飛ばさず少しずつ戻す = 瞬間移動を防ぐ。
      const MAX_PUSH = 0.3;
      if (bestX <= bestZ) {
        const target = penL < penR ? b.minX - C.PLAYER_R : b.maxX + C.PLAYER_R;
        this.pos.x += THREE.MathUtils.clamp(target - this.pos.x, -MAX_PUSH, MAX_PUSH);
        this.vel.x = 0;
        wallNx = penL < penR ? 1 : -1; // ブロックは +x / -x 側にある
        wallNz = 0;
      } else {
        const target = penN < penF ? b.minZ - C.PLAYER_R : b.maxZ + C.PLAYER_R;
        this.pos.z += THREE.MathUtils.clamp(target - this.pos.z, -MAX_PUSH, MAX_PUSH);
        this.vel.z = 0;
        wallNz = penN < penF ? 1 : -1;
        wallNx = 0;
      }
      wallTop = Math.max(wallTop ?? -Infinity, b.maxY);
      // 動く足場に横から押されている / 動く足場に乗ったまま壁に運ばれている。
      // 押し出しで足場から突き落とされる前に、入力が無くても自動ジャンプで上に乗せる
      if (p.move || (this.standing && this.standing.move)) wallAuto = true;
    }

    // 足場に立ったまま隣のブロックに走り込んで押し付けられたら自動ジャンプ
    // (二つのブロックに触れた状態)。次の足場がすぐ隣にあると端まで行けず、
    // 端の自動ジャンプが発動しないため。ジャンプで届く高さの相手にだけ発動する
    if (
      this.grounded && wallTop !== null &&
      (mag > C.ONE_HAND_AUTOJUMP_MAG || wallAuto)
    ) {
      const rise = wallTop - (this.pos.y - C.PLAYER_HALF_H);
      const jumpH = (C.JUMP_VEL * C.JUMP_VEL) / (2 * C.GRAVITY); // 最大ジャンプ高 ≈ 2.09m
      if (rise > 0.2 && rise < jumpH) this.jumpBuffer = C.JUMP_BUFFER;
    }

    // 空中のよじ登り補助 (マントル): ジャンプの上昇が僅かに足りず目標の側面に
    // 当たったとき、上面が足のすぐ上 (0.75m 以内) なら縁に手をかけて乗り上げる。
    // 「あと数センチで届いたのに側面に当たって真下に落ちる」理不尽感を消す。
    // スティックを壁に向かって押し込んでいる時だけ発動する (壁の横を通過するだけの
    // ジャンプを邪魔しない)。上昇と一緒に壁の内向きへ少し引き上げ、縁の外での
    // ホバリングを防ぐ。壁接触が前提の補助なので水平到達距離は伸びない (公平)。
    this.mantleCd = Math.max((this.mantleCd || 0) - dt, 0);
    this.ceilT = Math.max((this.ceilT || 0) - dt, 0);
    if (this.grounded) this.mantleN = 0; // 接地したら連続発動カウントを回復
    if (!this.grounded && wallTop !== null && mag > 0.3 && this.ceilT <= 0) {
      const ml = Math.hypot(mx, mz) || 1;
      const intoWall = (mx * wallNx + mz * wallNz) / ml; // スティックの壁向き成分
      const rise = wallTop - (this.pos.y - C.PLAYER_HALF_H);
      // 連続発動は45回 (約0.75秒) まで。狭い隙間に挟まった時に永遠に壁で
      // 跳ね続けないよう、上限に達したら一度あきらめて落ちる (接地で回復)。
      if (intoWall > 0.4 && rise > 0 && rise < 0.75 && (this.mantleN || 0) < 45) {
        const need = Math.sqrt(2 * C.GRAVITY * (rise + 0.3)); // 縁より少し上まで届く上昇速度
        if (this.vel.y < need) {
          this.vel.y = need;
          this.vel.x += wallNx * 1.5; // 縁の内側へ引き上げる (押し出しで消えるのは接触中だけ)
          this.vel.z += wallNz * 1.5;
          this.mantleN = (this.mantleN || 0) + 1;
          if (this.mantleCd <= 0) {
            this.mantleCd = 0.35;
            this.events.push({ t: 'mantle' });
          }
        }
      }
    }

    // --- オンラインの他プレイヤーとの当たり判定 ---
    if (ghosts) this.collideGhosts(ghosts);

    // --- 接地の継続チェック (足場の端から出たら落下) ---
    if (this.grounded && !landed) {
      let supported = false;
      const feet = this.pos.y - C.PLAYER_HALF_H;
      for (const p of near) {
        if (!this.world.isSolid(p, t)) continue; // 消えている足場では支えられない
        const b = this.world.aabb(p, t, tmpBox);
        if (
          this.pos.x + C.PLAYER_R > b.minX && this.pos.x - C.PLAYER_R < b.maxX &&
          this.pos.z + C.PLAYER_R > b.minZ && this.pos.z - C.PLAYER_R < b.maxZ &&
          Math.abs(feet - b.maxY) < 0.12 && this.vel.y <= 0.01
        ) {
          supported = true;
          this.standing = p;
          this.pos.y = b.maxY + C.PLAYER_HALF_H;
          break;
        }
      }
      if (!supported) {
        this.grounded = false;
        this.standing = null;
      }
    }

    // --- 奈落 ---
    if (this.pos.y < C.KILL_Y) {
      this.events.push({ t: 'fell' });
      this.spawnKeepBest();
    }

    this.maxY = Math.max(this.maxY, this.pos.y - C.PLAYER_HALF_H - 0.1);

    // --- 見た目 (Squash & Stretch) ---
    this.squash *= Math.pow(0.001, dt); // 減衰
    let squash = this.squash;
    if (!this.grounded) {
      // 空中では速度に応じて縦に伸びる (負の squash = ストレッチ)
      squash -= THREE.MathUtils.clamp(Math.abs(this.vel.y) * 0.016, 0, 0.18);
    }
    // 会釈: 足元を支点に前へ倒れる (下げて→戻すの1モーション)
    let tilt = 0;
    if (this.bowT > 0) {
      const p = 1 - this.bowT / C.BOW_TIME;
      tilt = Math.sin(Math.min(p * 1.15, 1) * Math.PI) * 0.75;
      squash += tilt * 0.1;
    }
    this.mesh.position.copy(this.pos);
    if (tilt > 0) {
      // 体の中心を「足元から前傾した位置」へ移す = 足を残して上体だけ倒す
      const hh = C.PLAYER_HALF_H;
      this.mesh.position.x += Math.sin(this.yaw) * Math.sin(tilt) * hh;
      this.mesh.position.z += Math.cos(this.yaw) * Math.sin(tilt) * hh;
      this.mesh.position.y -= (1 - Math.cos(tilt)) * hh;
    }
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = tilt;
    this.mesh.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);

    const gy = this.world.groundTopBelow(this.pos.x, this.pos.z, this.pos.y - C.PLAYER_HALF_H + 0.1, t, tmpBox);
    if (gy !== null && this.pos.y - gy < 9) {
      this.shadow.visible = true;
      this.shadow.position.set(this.pos.x, gy + 0.02, this.pos.z);
      const fall = THREE.MathUtils.clamp(1 - (this.pos.y - C.PLAYER_HALF_H - gy) / 9, 0.2, 1);
      this.shadow.material.opacity = 0.32 * fall;
      this.shadow.scale.setScalar(0.6 + 0.4 * fall);
    } else {
      this.shadow.visible = false;
    }

    // 頭上の吹き出しを追従させ、寿命が尽きたら消す
    if (this.bubble) {
      this.bubble.position.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.scene.remove(this.bubble);
        disposeBubble(this.bubble);
        this.bubble = null;
      }
    }
  }

  // オンラインの他プレイヤーと衝突: 横からはすり抜けずに押し出され、
  // 上から落ちると頭を踏んで小さく跳ねる
  collideGhosts(ghosts) {
    const C = CONFIG;
    const rr = C.PLAYER_R * 2;
    const hh = C.PLAYER_HALF_H;
    for (const g of ghosts.map.values()) {
      const gp = g.group.position;
      if (Math.abs(this.pos.y - gp.y) > hh * 2) continue;
      const dx = this.pos.x - gp.x;
      const dz = this.pos.z - gp.z;
      const dist = Math.hypot(dx, dz);
      if (dist > rr) continue;
      if (this.vel.y < -1 && this.pos.y - hh > gp.y + hh * 0.4) {
        // 頭の上に着地 → 踏み台ジャンプ
        this.pos.y = gp.y + hh * 2 + 0.01;
        this.vel.y = C.JUMP_VEL * 0.8;
        this.grounded = false;
        this.standing = null;
        this.events.push({ t: 'bounce' });
      } else {
        const nx = dist > 0.001 ? dx / dist : Math.sin(this.yaw);
        const nz = dist > 0.001 ? dz / dist : Math.cos(this.yaw);
        this.pos.x = gp.x + nx * rr;
        this.pos.z = gp.z + nz * rr;
        // 相手に向かう速度成分だけ打ち消す
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= vn * nx;
          this.vel.z -= vn * nz;
        }
      }
    }
  }

  spawnKeepBest() {
    const keep = this.maxY;
    this.spawn();
    this.maxY = keep;
  }
}
