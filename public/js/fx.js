import * as THREE from 'three';

// 「ジュース」演出をまとめて管理する。
//  - スクリーンシェイク: trauma 方式 (衝撃を加算し、2乗した値で揺らして減衰)
//  - ヒットストップ: 決定的な瞬間にゲーム進行を一瞬だけ止めてタメを作る
//  - パーティクル: 着地の土煙・ジャンプの砂・マイルストーンの火花・クリアの紙吹雪
//  - 画面フラッシュ: 落下時の赤など
//  - バイブレーション: 対応端末のみ

const MAX = 320;
const HIDDEN_Y = -9999;

export class FX {
  constructor(scene) {
    this.trauma = 0;
    this.freeze = 0;

    // パーティクルは単一の Points に固定プール (描画コール1回)
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = HIDDEN_Y;
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.17, vertexColors: true, transparent: true,
        opacity: 0.95, depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.flashEl = document.getElementById('flash');
    this._flashTimer = 0;
    this._c = new THREE.Color();
  }

  // ---- スクリーンシェイク ----
  shake(amount) {
    this.trauma = Math.min(this.trauma + amount, 1);
  }

  // ---- ヒットストップ ----
  hitStop(sec) {
    this.freeze = Math.max(this.freeze, sec);
  }

  // 毎フレーム呼ぶ。ヒットストップ中なら true (物理更新をスキップする)
  tickFreeze(dt) {
    if (this.freeze <= 0) return false;
    this.freeze -= dt;
    return true;
  }

  // ---- パーティクル ----
  burst(x, y, z, {
    count = 12, color = 0xffffff, speed = 3, up = 1.5,
    gravity = 8, life = 0.6, spread = 0.15,
  } = {}) {
    this._c.setHex(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      this.pos[i * 3] = x + Math.cos(a) * spread * r;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.3) * spread;
      this.pos[i * 3 + 2] = z + Math.sin(a) * spread * r;
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = up * (0.4 + Math.random() * 0.9);
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.grav[i] = gravity;
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      const l = 0.85 + Math.random() * 0.3; // 明度に個体差を付ける
      this.col[i * 3] = Math.min(this._c.r * l, 1);
      this.col[i * 3 + 1] = Math.min(this._c.g * l, 1);
      this.col[i * 3 + 2] = Math.min(this._c.b * l, 1);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  // ---- 画面フラッシュ ----
  flash(color, ms = 140) {
    this.flashEl.style.background = color;
    this.flashEl.classList.add('show');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => this.flashEl.classList.remove('show'), ms);
  }

  // ---- バイブレーション ----
  vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // 非対応端末は無視
    }
  }

  // 毎フレーム: パーティクル更新 + カメラシェイク適用。
  // カメラの lookAt 確定後・render 直前に呼ぶこと。
  update(dt, camera, frozen = false) {
    if (!frozen) {
      // ヒットストップ中はパーティクルも止めて「時が止まった」感を出す
      let active = false;
      for (let i = 0; i < MAX; i++) {
        if (this.life[i] <= 0) continue;
        active = true;
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this.pos[i * 3 + 1] = HIDDEN_Y;
          continue;
        }
        this.vel[i * 3 + 1] -= this.grav[i] * dt;
        const damp = Math.pow(0.25, dt);
        this.vel[i * 3] *= damp;
        this.vel[i * 3 + 2] *= damp;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
      if (active) this.posAttr.needsUpdate = true;
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(this.trauma - dt * 2.4, 0);
      const s = this.trauma * this.trauma;
      camera.position.x += (Math.random() * 2 - 1) * 0.3 * s;
      camera.position.y += (Math.random() * 2 - 1) * 0.3 * s;
      camera.rotation.z += (Math.random() * 2 - 1) * 0.035 * s;
    }
  }
}
