import * as THREE from 'three';
import { buildAvatar } from './player.js';
import { CONFIG, PLAYER_COLORS } from './config.js';

// 名前ラベル (Sprite)
function makeLabel(name) {
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d');
  ctx.font = '700 28px sans-serif';
  const w = Math.min(Math.ceil(ctx.measureText(name).width) + 28, 320);
  cvs.width = w;
  cvs.height = 44;
  const c2 = cvs.getContext('2d');
  c2.fillStyle = 'rgba(10,16,32,0.7)';
  c2.beginPath();
  if (c2.roundRect) c2.roundRect(0, 0, w, 44, 22);
  else c2.rect(0, 0, w, 44);
  c2.fill();
  c2.font = '700 28px sans-serif';
  c2.fillStyle = '#fff';
  c2.textAlign = 'center';
  c2.textBaseline = 'middle';
  c2.fillText(name, w / 2, 24);
  const tex = new THREE.CanvasTexture(cvs);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(w / 44 * 0.5, 0.5, 1);
  sp.position.y = 1.35;
  return sp;
}

// オンラインの他プレイヤー表示 (受信した位置へ補間移動)
export class Ghosts {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // id -> {group, target, yaw, last}
  }

  receive(p) {
    // p: {i,n,c,x,y,z,ry,b}  (b=1 なら会釈中)
    if (typeof p?.i !== 'string' || typeof p.x !== 'number') return;
    let g = this.map.get(p.i);
    if (!g) {
      if (this.map.size >= CONFIG.MAX_GHOSTS) return;
      const color = PLAYER_COLORS[(p.c | 0) % PLAYER_COLORS.length];
      const group = buildAvatar(color);
      const name = String(p.n || '???').slice(0, 12);
      group.add(makeLabel(name));
      group.traverse((o) => {
        if (o.material && 'transparent' in o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.75;
        }
      });
      this.scene.add(group);
      g = {
        group, target: new THREE.Vector3(p.x, p.y, p.z),
        yaw: p.ry || 0, last: 0, bowT: 0, lastBow: false,
      };
      group.position.copy(g.target);
      this.map.set(p.i, g);
    }
    g.target.set(p.x, p.y, p.z);
    g.yaw = p.ry || 0;
    // 会釈フラグの立ち上がりでおじぎモーションを再生
    if (p.b && !g.lastBow) g.bowT = CONFIG.BOW_TIME;
    g.lastBow = !!p.b;
    g.last = performance.now();
  }

  remove(id) {
    const g = this.map.get(id);
    if (!g) return;
    this.scene.remove(g.group);
    this.map.delete(id);
  }

  tick(dt) {
    const now = performance.now();
    const k = 1 - Math.exp(-dt * 10);
    for (const [id, g] of this.map) {
      if (now - g.last > 8000) {
        this.remove(id);
        continue;
      }
      g.group.position.lerp(g.target, k);
      let d = g.yaw - g.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      g.group.rotation.y += d * k;

      // 会釈モーション (自機と同じカーブ)
      g.bowT = Math.max(g.bowT - dt, 0);
      let tilt = 0;
      if (g.bowT > 0) {
        const p = 1 - g.bowT / CONFIG.BOW_TIME;
        tilt = Math.sin(Math.min(p * 1.15, 1) * Math.PI) * 0.7;
      }
      g.group.rotation.x = tilt;
    }
  }

  get count() {
    return this.map.size;
  }
}
