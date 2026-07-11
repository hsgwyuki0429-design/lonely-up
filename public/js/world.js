import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mulberry32 } from './rng.js';
import { generateTower } from './tower.js';

// 高度帯ごとの雰囲気 (空・霧・足場の色)
const ZONES = [
  { h: 0,   sky: 0x8ec9f0, fog: 0xcfe8f8, plat: [0x7dc46b, 0x8ed07c, 0x5fae52], accent: 0x3f7d36 },
  { h: 90,  sky: 0x6fa8e0, fog: 0xb4d4ee, plat: [0xb9a08b, 0xa78f7a, 0xc4b096], accent: 0x76614f },
  { h: 180, sky: 0xf2986b, fog: 0xf6c49c, plat: [0xe8e8f2, 0xd4d8e6, 0xf4f4fa], accent: 0x9fb7d8 },
  { h: 260, sky: 0x161d42, fog: 0x28305e, plat: [0x8f7ff0, 0x7a6ae0, 0xa090ff], accent: 0xffd166 },
];

const BUCKET = 6; // 縦方向の衝突判定バケットサイズ (m)

function zonePair(h) {
  let i = 0;
  while (i < ZONES.length - 1 && h >= ZONES[i + 1].h) i++;
  const a = ZONES[i];
  const b = ZONES[Math.min(i + 1, ZONES.length - 1)];
  const span = Math.max(b.h - a.h, 1);
  const t = a === b ? 0 : THREE.MathUtils.clamp((h - a.h) / span, 0, 1);
  return { a, b, t };
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.platforms = [];
    this.buckets = new Map();
    this.movingMeshes = [];
    this.goalY = 0;
    this.time = 0;

    this._skyColor = new THREE.Color();
    this._fogColor = new THREE.Color();
    this._ca = new THREE.Color();
    this._cb = new THREE.Color();

    this.generate();
    this.buildMeshes();
    this.buildSky();
  }

  // ================== 塔の生成 (tower.js の純粋関数を利用) ==================
  generate() {
    const { platforms, goalY } = generateTower(CONFIG.SEED);
    this.platforms = platforms;
    this.goalY = goalY;

    // 衝突判定バケット
    for (const p of this.platforms) {
      const lo = Math.floor((p.y - p.hy - 2) / BUCKET);
      const hi = Math.floor((p.y + p.hy + 2) / BUCKET);
      for (let b = lo; b <= hi; b++) {
        if (!this.buckets.has(b)) this.buckets.set(b, []);
        this.buckets.get(b).push(p);
      }
    }
  }

  // y 近辺の足場を列挙 (衝突・接地判定用)
  nearby(yMin, yMax, out) {
    out.length = 0;
    const lo = Math.floor(yMin / BUCKET);
    const hi = Math.floor(yMax / BUCKET);
    for (let b = lo; b <= hi; b++) {
      const arr = this.buckets.get(b);
      if (arr) for (const p of arr) if (!out.includes(p)) out.push(p);
    }
    return out;
  }

  // 動く足場の現在の水平オフセット
  offset(p, t) {
    if (!p.move) return 0;
    return Math.sin(t * p.move.speed + p.move.phase) * p.move.amp;
  }

  aabb(p, t, out) {
    let ox = 0, oz = 0;
    if (p.move) {
      const o = this.offset(p, t);
      if (p.move.axis === 'x') ox = o; else oz = o;
    }
    out.minX = p.x + ox - p.hx; out.maxX = p.x + ox + p.hx;
    out.minY = p.y - p.hy;      out.maxY = p.y + p.hy;
    out.minZ = p.z + oz - p.hz; out.maxZ = p.z + oz + p.hz;
    return out;
  }

  // ================== 見た目 ==================
  buildMeshes() {
    const statics = this.platforms.filter((p) => !p.move);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    const inst = new THREE.InstancedMesh(geo, mat, statics.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const color = new THREE.Color();
    const crand = mulberry32(CONFIG.SEED ^ 0x9e3779b9);

    statics.forEach((p, i) => {
      v.set(p.x, p.y, p.z);
      s.set(p.hx * 2, p.hy * 2, p.hz * 2);
      inst.setMatrixAt(i, m.compose(v, q, s));
      const { a } = zonePair(Math.max(p.y, 0));
      if (p.kind === 'goal') color.setHex(0xffd166);
      else if (p.kind === 'rest') color.setHex(a.accent);
      else {
        color.setHex(a.plat[Math.floor(crand() * a.plat.length)]);
        color.offsetHSL(0, 0, (crand() - 0.5) * 0.06);
      }
      inst.setColorAt(i, color);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);

    // 動く足場は個別メッシュ
    for (const p of this.platforms) {
      if (!p.move) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2),
        new THREE.MeshLambertMaterial({ color: 0x66d9e8 })
      );
      mesh.position.set(p.x, p.y, p.z);
      this.scene.add(mesh);
      this.movingMeshes.push({ p, mesh });
    }

    // 休憩所の目印リング & ゴール演出
    for (const p of this.platforms) {
      if (p.kind === 'rest') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.2, 0.07, 8, 24),
          new THREE.MeshBasicMaterial({ color: 0xffd166 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(p.x, p.y + p.hy + 0.05, p.z);
        this.scene.add(ring);
      } else if (p.kind === 'goal') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(2.6, 0.12, 10, 40),
          new THREE.MeshBasicMaterial({ color: 0xffe08a })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(p.x, p.y + p.hy + 0.3, p.z);
        this.scene.add(ring);
        this.goalRing = ring;

        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(1.2, 1.6, 60, 16, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0xffe08a, transparent: true, opacity: 0.16,
            side: THREE.DoubleSide, depthWrite: false,
          })
        );
        beam.position.set(p.x, p.y + 30, p.z);
        this.scene.add(beam);
      }
    }
  }

  buildSky() {
    // 星 (高高度でフェードイン)
    const starCount = 700;
    const pos = new Float32Array(starCount * 3);
    const srand = mulberry32(CONFIG.SEED ^ 0x1234567);
    for (let i = 0; i < starCount; i++) {
      const u = srand() * 2 - 1;
      const a = srand() * Math.PI * 2;
      const r = 380;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(a);
      pos[i * 3 + 1] = Math.abs(r * u) + 40;
      pos[i * 3 + 2] = r * s * Math.sin(a);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffffff, size: 1.6, sizeAttenuation: false,
        transparent: true, opacity: 0, depthWrite: false,
      })
    );
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // 雲 (スプライト)
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = 128;
    const ctx = cvs.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cvs);
    this.clouds = [];
    const crand = mulberry32(CONFIG.SEED ^ 0xabcdef);
    for (let i = 0; i < 22; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.5, depthWrite: false,
      }));
      const ang = crand() * Math.PI * 2;
      const rad = 26 + crand() * 42;
      sp.position.set(Math.cos(ang) * rad, 8 + crand() * (CONFIG.GOAL_HEIGHT - 20), Math.sin(ang) * rad);
      const sc = 11 + crand() * 13;
      sp.scale.set(sc, sc * 0.55, 1);
      sp.userData.speed = (crand() - 0.5) * 0.012;
      sp.userData.ang = ang;
      sp.userData.rad = rad;
      this.scene.add(sp);
      this.clouds.push(sp);
    }

    this.scene.fog = new THREE.Fog(0xcfe8f8, 35, 150);
  }

  // 足元の影用: プレイヤー真下の足場の上面 y を返す
  groundTopBelow(x, z, y, t, tmpBox) {
    let best = null;
    const list = this.nearby(y - 10, y + 0.5, this._groundList || (this._groundList = []));
    for (const p of list) {
      const b = this.aabb(p, t, tmpBox);
      if (x > b.minX - 0.1 && x < b.maxX + 0.1 && z > b.minZ - 0.1 && z < b.maxZ + 0.1) {
        if (b.maxY <= y + 0.05 && (best === null || b.maxY > best)) best = b.maxY;
      }
    }
    return best;
  }

  update(t, dt, playerY, renderer, scene) {
    this.time = t;
    for (const { p, mesh } of this.movingMeshes) {
      const o = this.offset(p, t);
      mesh.position.set(
        p.x + (p.move.axis === 'x' ? o : 0),
        p.y,
        p.z + (p.move.axis === 'z' ? o : 0)
      );
    }
    if (this.goalRing) this.goalRing.rotation.z = t * 0.6;

    // 高度に応じた空の色
    const { a, b, t: k } = zonePair(playerY);
    this._skyColor.copy(this._ca.setHex(a.sky)).lerp(this._cb.setHex(b.sky), k);
    this._fogColor.copy(this._ca.setHex(a.fog)).lerp(this._cb.setHex(b.fog), k);
    scene.background = this._skyColor;
    scene.fog.color.copy(this._fogColor);
    this.stars.material.opacity = THREE.MathUtils.clamp((playerY - 200) / 80, 0, 1);

    for (const c of this.clouds) {
      c.userData.ang += c.userData.speed * dt;
      c.position.x = Math.cos(c.userData.ang) * c.userData.rad;
      c.position.z = Math.sin(c.userData.ang) * c.userData.rad;
    }
  }
}
