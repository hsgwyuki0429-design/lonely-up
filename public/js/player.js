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

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.standing = null;          // 乗っている足場
    this.coyote = 0;
    this.jumpBuffer = 0;
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

    // --- 乗っている動く足場に運ばれる ---
    if (this.grounded && this.standing && this.standing.move) {
      const d = this.world.offset(this.standing, t) - this.world.offset(this.standing, tPrev);
      if (this.standing.move.axis === 'x') this.pos.x += d;
      else this.pos.z += d;
    }

    // --- 入力 → カメラ基準の移動ベクトル ---
    // 最近の3Dゲーム標準: スティックを倒した方向 (カメラ基準) へ全方向そのまま移動し、
    // キャラクターは進行方向を向くように旋回する。傾け量がそのまま速度になる
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // カメラ前方 (水平)
    const rx = -fz, rz = fx;                                 // カメラ右
    const mx = fx * input.move.y + rx * input.move.x;
    const mz = fz * input.move.y + rz * input.move.x;
    const mag = Math.min(Math.hypot(mx, mz), 1);

    const accel = this.grounded ? C.GROUND_ACCEL : C.AIR_ACCEL;
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
    // 片手モード: スティックを大きく倒して走ったまま足場の端から出たら自動ジャンプ。
    // 片手ではスティックを倒しながらジャンプ操作ができないため、走りジャンプを自動化する。
    // コヨーテ時間内 (端から出た直後) かつ下降開始前のみ。ゆっくり歩けば発動せずそのまま落ちられる
    if (
      CONFIG.ONE_HAND && !this.grounded && this.coyote > 0 &&
      this.vel.y <= 0 && mag > C.ONE_HAND_AUTOJUMP_MAG
    ) {
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
      const b = this.world.aabb(p, t, tmpBox);
      if (!this.aabbOverlap(b)) continue;
      if (this.vel.y <= 0 && prevFeet >= b.maxY - 0.25) {
        // 上面に着地
        this.pos.y = b.maxY + C.PLAYER_HALF_H;
        if (!this.grounded) {
          // 落下速度 = 衝撃の強さ。着地先の上面高さはコンボ判定に使う
          this.events.push({ t: 'land', impact: -this.vel.y, topY: b.maxY });
        }
        if (this.vel.y < -6) this.squash = Math.min(0.28, -this.vel.y * 0.02);
        this.vel.y = 0;
        this.grounded = true;
        this.standing = p;
        landed = true;
      } else if (this.vel.y > 0 && prevFeet <= b.minY) {
        // 下面に頭をぶつけた
        this.pos.y = b.minY - C.PLAYER_HALF_H;
        this.vel.y = 0;
      }
    }

    // --- 水平移動 (軸ごとに解決) ---
    let wallTop = null; // 横からぶつかったブロックの上面 (片手モードの自動ジャンプ判定に使う)
    this.pos.x += this.vel.x * dt;
    for (const p of near) {
      const b = this.world.aabb(p, t, tmpBox);
      if (!this.aabbOverlap(b)) continue;
      if (this.pos.y - C.PLAYER_HALF_H > b.maxY - 0.3) continue; // 上に立っている
      if (this.vel.x > 0) this.pos.x = b.minX - C.PLAYER_R;
      else if (this.vel.x < 0) this.pos.x = b.maxX + C.PLAYER_R;
      this.vel.x = 0;
      wallTop = Math.max(wallTop ?? -Infinity, b.maxY);
    }
    this.pos.z += this.vel.z * dt;
    for (const p of near) {
      const b = this.world.aabb(p, t, tmpBox);
      if (!this.aabbOverlap(b)) continue;
      if (this.pos.y - C.PLAYER_HALF_H > b.maxY - 0.3) continue;
      if (this.vel.z > 0) this.pos.z = b.minZ - CONFIG.PLAYER_R;
      else if (this.vel.z < 0) this.pos.z = b.maxZ + CONFIG.PLAYER_R;
      this.vel.z = 0;
      wallTop = Math.max(wallTop ?? -Infinity, b.maxY);
    }

    // 片手モード: 足場に立ったまま隣のブロックに走り込んで押し付けられたら自動ジャンプ
    // (二つのブロックに触れた状態)。次の足場がすぐ隣にあると端まで行けず、
    // 端の自動ジャンプが発動しないため。ジャンプで届く高さの相手にだけ発動する
    if (
      CONFIG.ONE_HAND && this.grounded && wallTop !== null &&
      mag > C.ONE_HAND_AUTOJUMP_MAG
    ) {
      const rise = wallTop - (this.pos.y - C.PLAYER_HALF_H);
      const jumpH = (C.JUMP_VEL * C.JUMP_VEL) / (2 * C.GRAVITY); // 最大ジャンプ高 ≈ 2.09m
      if (rise > 0.2 && rise < jumpH) this.jumpBuffer = C.JUMP_BUFFER;
    }

    // --- オンラインの他プレイヤーとの当たり判定 ---
    if (ghosts) this.collideGhosts(ghosts);

    // --- 接地の継続チェック (足場の端から出たら落下) ---
    if (this.grounded && !landed) {
      let supported = false;
      const feet = this.pos.y - C.PLAYER_HALF_H;
      for (const p of near) {
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
