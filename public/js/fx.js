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
        size: 0.19, vertexColors: true, transparent: true,
        opacity: 0.95, depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.flashEl = document.getElementById('flash');
    this._flashTimer = 0;
    this.glowEl = document.getElementById('glow');
    this._glowTimer = 0;
    this._c = new THREE.Color();

    this._initShockwaves(scene);
    this._initTrail(scene);
  }

  // ---- 衝撃波リング ----
  // 着地・マイルストーン・当たりの瞬間に地面へ広がる光の輪。1発の重みを増幅する。
  _initShockwaves(scene) {
    const RINGS = 10;
    this.rings = [];
    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 40),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, r0: 0.5, r1: 4, up: false });
    }
    this._ringCursor = 0;
  }

  // 水平に広がる輪 (up=true で縦向き=噴き上がる輪)
  shockwave(x, y, z, { color = 0xffffff, r0 = 0.5, r1 = 4, life = 0.5, up = false } = {}) {
    const r = this.rings[this._ringCursor];
    this._ringCursor = (this._ringCursor + 1) % this.rings.length;
    r.mesh.position.set(x, y, z);
    r.mesh.rotation.x = up ? 0 : -Math.PI / 2;
    r.mesh.material.color.setHex(color);
    r.life = r.maxLife = life;
    r.r0 = r0; r.r1 = r1;
    r.mesh.visible = true;
  }

  // ---- コメット・トレイル ----
  // プレイヤーの残像。直近の軌跡を尾のように引きずり、勢いを可視化する。
  _initTrail(scene) {
    const N = 22;
    this.trailN = N;
    this._trailPos = new Float32Array(N * 3);
    this._trailCol = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this._trailPos[i * 3 + 1] = HIDDEN_Y;
    const geo = new THREE.BufferGeometry();
    this._trailPosAttr = new THREE.BufferAttribute(this._trailPos, 3);
    this._trailColAttr = new THREE.BufferAttribute(this._trailCol, 3);
    geo.setAttribute('position', this._trailPosAttr);
    geo.setAttribute('color', this._trailColAttr);
    this.trail = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.34, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this._trailColor = new THREE.Color(0xffffff);
    this._trailReady = false;
  }

  setTrailColor(hex) {
    this._trailColor.setHex(hex);
  }

  // 毎フレーム: 先頭をプレイヤーへ、後続を前のノードへ遅れて追従させる (ラグチェーン)。
  // 尾に向かって暗く=薄くしていく (加算合成なので暗色ほど透明に見える)。
  updateTrail(x, y, z) {
    const N = this.trailN, P = this._trailPos, C = this._trailCol;
    if (!this._trailReady) { // 初期化: 全ノードを現在地へ畳む (スポーン時の走査線防止)
      for (let i = 0; i < N; i++) { P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; }
      this._trailReady = true;
    }
    P[0] = x; P[1] = y; P[2] = z;
    for (let i = 1; i < N; i++) {
      const j = i * 3, k = (i - 1) * 3;
      P[j] += (P[k] - P[j]) * 0.5;
      P[j + 1] += (P[k + 1] - P[j + 1]) * 0.5;
      P[j + 2] += (P[k + 2] - P[j + 2]) * 0.5;
      const f = 1 - i / N; // 尾へ向かってフェード
      C[j] = this._trailColor.r * f;
      C[j + 1] = this._trailColor.g * f;
      C[j + 2] = this._trailColor.b * f;
    }
    C[0] = this._trailColor.r; C[1] = this._trailColor.g; C[2] = this._trailColor.b;
    this._trailPosAttr.needsUpdate = true;
    this._trailColAttr.needsUpdate = true;
  }

  hideTrail() {
    this._trailReady = false;
    for (let i = 0; i < this.trailN; i++) this._trailPos[i * 3 + 1] = HIDDEN_Y;
    this._trailPosAttr.needsUpdate = true;
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

  // ---- 環境光 (アンビエントグロウ) ----
  // 画面の縁からその色の光がぼわっと差し込み、ゆっくり引く。エフェクトの「まぶしさ」を
  // マス目の外へ滲ませ、ゲーム空間全体のエネルギー量を伝える。color は 0xRRGGBB。
  glow(color, intensity = 0.5) {
    if (!this.glowEl) return;
    this._c.setHex(color);
    const r = Math.round(this._c.r * 255);
    const g = Math.round(this._c.g * 255);
    const b = Math.round(this._c.b * 255);
    const a = Math.min(intensity, 1);
    this.glowEl.style.background =
      `radial-gradient(ellipse at 50% 46%, rgba(${r},${g},${b},0) 42%, ` +
      `rgba(${r},${g},${b},${(a * 0.55).toFixed(3)}) 78%, rgba(${r},${g},${b},${a.toFixed(3)}) 100%)`;
    this.glowEl.classList.add('show');
    clearTimeout(this._glowTimer);
    this._glowTimer = setTimeout(() => this.glowEl.classList.remove('show'), 60);
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

      // 衝撃波リング: 広がりながら細く・薄くなって消える
      for (const r of this.rings) {
        if (r.life <= 0) continue;
        r.life -= dt;
        if (r.life <= 0) { r.mesh.visible = false; continue; }
        const p = 1 - r.life / r.maxLife;       // 0→1
        const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - p, 2)); // 勢いよく出て減速
        r.mesh.scale.setScalar(rad);
        r.mesh.material.opacity = 0.75 * (1 - p) * (1 - p);
      }
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
