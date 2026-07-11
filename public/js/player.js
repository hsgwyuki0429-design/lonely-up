import * as THREE from 'three';
import { CONFIG } from './config.js';

const tmpBox = {};

// 自機・ゴースト共通のアバター (オリジナルデザインの小型ロボ)
export function buildAvatar(colorHex) {
  const g = new THREE.Group();
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
    this.maxY = 0;

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
    this.maxY = 0;
    this.events = [];
  }

  aabbOverlap(b) {
    const r = CONFIG.PLAYER_R, h = CONFIG.PLAYER_HALF_H;
    return (
      this.pos.x + r > b.minX && this.pos.x - r < b.maxX &&
      this.pos.y + h > b.minY && this.pos.y - h < b.maxY &&
      this.pos.z + r > b.minZ && this.pos.z - r < b.maxZ
    );
  }

  update(dt, input, camYaw, t, tPrev) {
    const C = CONFIG;
    const near = this.world.nearby(this.pos.y - 4, this.pos.y + 4, this._near);
    this.events.length = 0;

    // --- 乗っている動く足場に運ばれる ---
    if (this.grounded && this.standing && this.standing.move) {
      const d = this.world.offset(this.standing, t) - this.world.offset(this.standing, tPrev);
      if (this.standing.move.axis === 'x') this.pos.x += d;
      else this.pos.z += d;
    }

    // --- 入力 → カメラ基準の移動ベクトル ---
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // カメラ前方 (水平)
    const rx = -fz, rz = fx;                                 // カメラ右
    const mx = fx * input.move.y + rx * input.move.x;
    const mz = fz * input.move.y + rz * input.move.x;
    const mag = Math.min(Math.hypot(mx, mz), 1);
    const accel = this.grounded ? C.GROUND_ACCEL : C.AIR_ACCEL;
    const tx = mag > 0.001 ? (mx / Math.hypot(mx, mz)) * C.MOVE_SPEED * mag : 0;
    const tz = mag > 0.001 ? (mz / Math.hypot(mx, mz)) * C.MOVE_SPEED * mag : 0;
    this.vel.x += THREE.MathUtils.clamp(tx - this.vel.x, -accel * dt, accel * dt);
    this.vel.z += THREE.MathUtils.clamp(tz - this.vel.z, -accel * dt, accel * dt);
    if (mag > 0.05) {
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
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = C.JUMP_VEL;
      this.grounded = false;
      this.standing = null;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.squash = -0.18;
      this.events.push('jump');
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
        if (!this.grounded && this.vel.y < -6) this.events.push('land');
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
    this.pos.x += this.vel.x * dt;
    for (const p of near) {
      const b = this.world.aabb(p, t, tmpBox);
      if (!this.aabbOverlap(b)) continue;
      if (this.pos.y - C.PLAYER_HALF_H > b.maxY - 0.3) continue; // 上に立っている
      if (this.vel.x > 0) this.pos.x = b.minX - C.PLAYER_R;
      else if (this.vel.x < 0) this.pos.x = b.maxX + C.PLAYER_R;
      this.vel.x = 0;
    }
    this.pos.z += this.vel.z * dt;
    for (const p of near) {
      const b = this.world.aabb(p, t, tmpBox);
      if (!this.aabbOverlap(b)) continue;
      if (this.pos.y - C.PLAYER_HALF_H > b.maxY - 0.3) continue;
      if (this.vel.z > 0) this.pos.z = b.minZ - CONFIG.PLAYER_R;
      else if (this.vel.z < 0) this.pos.z = b.maxZ + CONFIG.PLAYER_R;
      this.vel.z = 0;
    }

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
      this.events.push('fell');
      this.spawnKeepBest();
    }

    this.maxY = Math.max(this.maxY, this.pos.y - C.PLAYER_HALF_H - 0.1);

    // --- 見た目 ---
    this.squash *= Math.pow(0.001, dt); // 減衰
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    const sy = 1 - this.squash;
    this.mesh.scale.set(1 + this.squash * 0.6, sy, 1 + this.squash * 0.6);

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

  spawnKeepBest() {
    const keep = this.maxY;
    this.spawn();
    this.maxY = keep;
  }
}
