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

// カラールーレットのテーマ。落下のたびに塔全体をこのいずれかの配色へ塗り替える。
// 毎回まっさらな見た目になり、「次はどの色？」という新奇性がドーパミンを生む。
const THEMES = [
  { jp: 'フォレスト', plat: [0x7dc46b, 0x8ed07c, 0x5fae52], accent: 0x3f7d36 },
  { jp: 'キャンディ', plat: [0xff8fc7, 0xffa9d4, 0xf46fb0], accent: 0xc74e8f },
  { jp: 'オーシャン', plat: [0x4ec5e0, 0x6fd6ea, 0x37a8cf], accent: 0x2b7fa0 },
  { jp: 'サンセット', plat: [0xff9f43, 0xffb86b, 0xff7b54], accent: 0xd85f3a },
  { jp: 'グレープ', plat: [0xb197fc, 0xc3adff, 0x9b7bf0], accent: 0x7256c9 },
  { jp: 'ゴールド', plat: [0xffd166, 0xffe08a, 0xf5b942], accent: 0xc99a2e },
  { jp: 'ミント', plat: [0x63e6be, 0x8ff0d4, 0x38d9a9], accent: 0x1fa885 },
  { jp: 'ラヴァ', plat: [0xff6b6b, 0xff8f8f, 0xe64545], accent: 0xb52d2d },
  { jp: 'レインボー', rainbow: true, accent: 0xffffff },
];

// 「5回に1回」着地した土台を染める当たり色 (ネオン系で目立たせる)
export const JACKPOT_COLORS = [
  0xff4d6d, 0xffd23f, 0x4dd4ff, 0x9d4dff, 0x3ddc84, 0xff7ac4, 0xff9f1c,
];

// チェックポイント番号などを空中に出す文字スプライト (縁取り付きで遠くからも読める)
function makeCpSprite(text) {
  const cvs = document.createElement('canvas');
  const font = '900 44px sans-serif';
  let c = cvs.getContext('2d');
  c.font = font;
  const w = Math.ceil(c.measureText(text).width) + 30;
  cvs.width = w;
  cvs.height = 64;
  c = cvs.getContext('2d');
  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 8;
  c.strokeStyle = 'rgba(10,16,32,0.85)';
  c.strokeText(text, w / 2, 34);
  c.fillStyle = '#ffd166';
  c.fillText(text, w / 2, 34);
  const tex = new THREE.CanvasTexture(cvs);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  const h = 0.85;
  sp.scale.set(h * (w / 64), h, 1);
  return sp;
}

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
    const { platforms, goalY, cpCount } = generateTower(CONFIG.SEED);
    this.platforms = platforms;
    this.goalY = goalY;
    this.cpCount = cpCount; // チェックポイント総数 (CP2/6 のような進捗表示に使う)

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

  // 動く足場の現在のオフセット。x/z は正弦で往復、y は「最下点=静止位置」から上へ昇降する。
  offset(p, t) {
    if (!p.move) return 0;
    const m = p.move;
    if (m.axis === 'y') return (1 - Math.cos(t * m.speed + m.phase)) * m.amp; // 0〜2·amp (上方向のみ)
    return Math.sin(t * m.speed + m.phase) * m.amp;
  }

  aabb(p, t, out) {
    let ox = 0, oy = 0, oz = 0;
    if (p.move) {
      const o = this.offset(p, t);
      if (p.move.axis === 'x') ox = o;
      else if (p.move.axis === 'z') oz = o;
      else oy = o;
    }
    out.minX = p.x + ox - p.hx; out.maxX = p.x + ox + p.hx;
    out.minY = p.y + oy - p.hy; out.maxY = p.y + oy + p.hy;
    out.minZ = p.z + oz - p.hz; out.maxZ = p.z + oz + p.hz;
    return out;
  }

  // その足場が今「実体として存在する」か (崩れて消えた / 位相で消えている間は false)。
  // 衝突・接地判定は必ずこれを通し、消えている足場はすり抜ける。
  isSolid(p, t) {
    if (p.gone) return false;                     // crumble: 崩れて消滅中
    if (p.kind === 'phase') return this.phaseSolid(p, t);
    return true;
  }

  // 位相足場が「出ている」タイミングか
  phaseSolid(p, t) {
    const c = p.phaseCfg;
    if (!c) return true;
    const f = ((t / c.period + c.offset) % 1 + 1) % 1;
    return f < c.onFrac;
  }

  // ================== 見た目 ==================
  // 個別メッシュで描く足場か (テーマ着色の対象外。色/挙動そのものが手がかりになる)
  static _isDynamicMesh(p) {
    return !!p.move || p.kind === 'crumble' || p.kind === 'phase' ||
      p.kind === 'bounce' || p.kind === 'ice' || p.kind === 'conveyor';
  }

  buildMeshes() {
    const statics = this.platforms.filter((p) => !World._isDynamicMesh(p));
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    const inst = new THREE.InstancedMesh(geo, mat, statics.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const crand = mulberry32(CONFIG.SEED ^ 0x9e3779b9);

    // 位置と、テーマ着色に使う乱数だけをここで確定させる (色は applyTheme が決める)
    statics.forEach((p, i) => {
      v.set(p.x, p.y, p.z);
      s.set(p.hx * 2, p.hy * 2, p.hz * 2);
      inst.setMatrixAt(i, m.compose(v, q, s));
      p.instIndex = i;      // 個別の足場を後から塗り替えるための添字
      p.rollA = crand();    // パレット内のどの色か
      p.rollB = crand();    // 明度の個体差
    });
    inst.instanceMatrix.needsUpdate = true;
    this.staticInst = inst;
    this.staticList = statics;
    this.scene.add(inst);

    // 特殊な足場は個別メッシュ (テーマ着色の対象外)。色そのものが種類の手がかり:
    //   水色=横に動く / 青=上下に動く / 橙=踏むと崩れる / 紫=時間で消える /
    //   白青=氷 (滑る) / 鉄色+黄矢印=ベルトコンベア
    this.crumbleList = [];
    this.phaseList = [];
    this.beltList = [];
    for (const p of this.platforms) {
      if (!World._isDynamicMesh(p)) continue;
      let color = 0x66d9e8;
      if (p.move) color = p.move.axis === 'y' ? 0x4dabf7 : 0x66d9e8;
      else if (p.kind === 'crumble') color = 0xffa94d;
      else if (p.kind === 'phase') color = 0xb197fc;
      else if (p.kind === 'bounce') color = 0x69db7c; // バネの緑 (踏むと大きく跳ねる合図)
      else if (p.kind === 'ice') color = 0xdff4ff;    // 白青の氷 (ツルツル滑る合図)
      else if (p.kind === 'conveyor') color = 0x4a5679; // 鉄色のベルト (矢印の向きに流される)
      const mat = new THREE.MeshLambertMaterial({ color });
      if (p.kind === 'phase') mat.transparent = true; // 明滅・出現/消滅の演出に使う
      if (p.kind === 'ice') mat.emissive = new THREE.Color(0x1b4d66); // 氷の内側の光沢感
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2), mat);
      p.colorHex = color; // 破片エフェクトの色
      p.meshRef = mesh;
      mesh.position.set(p.x, p.y, p.z);
      this.scene.add(mesh);
      if (p.move) this.movingMeshes.push({ p, mesh });
      else if (p.kind === 'crumble') this.crumbleList.push(p);
      else if (p.kind === 'phase') this.phaseList.push(p);

      // ベルトコンベア: 流れる方向を指す黄色の三角形を上面でスクロールさせる
      if (p.kind === 'conveyor' && p.belt) {
        const sp = Math.hypot(p.belt.x, p.belt.z) || 1;
        const dirx = p.belt.x / sp, dirz = p.belt.z / sp;
        const L = Math.max((Math.abs(dirx) > 0.5 ? p.hx : p.hz) * 2 - 0.5, 0.8); // ベルト軸方向の可動長
        const marks = [];
        for (let i = 0; i < 3; i++) {
          const mk = new THREE.Mesh(
            new THREE.CircleGeometry(0.24, 3), // 3角形 = 矢印
            new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide })
          );
          mk.rotation.x = -Math.PI / 2;
          mk.rotation.z = Math.atan2(-dirz, dirx); // 頂点がベルトの流れる向きを指す
          this.scene.add(mk);
          marks.push(mk);
        }
        this.beltList.push({ p, marks, dirx, dirz, L, speed: sp });
      }
    }

    this.applyTheme(0); // 初期テーマ (フォレスト) で全足場を着色

    // 休憩所の目印リング & バウンド台のバネリング & ゴール演出
    for (const p of this.platforms) {
      if (p.kind === 'bounce') {
        // バネを示す緑のリング (上面に浮かせる)。踏めば大きく跳ねる合図。
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(p.hx * 0.7, 0.09, 8, 22),
          new THREE.MeshBasicMaterial({ color: 0xb2f2bb })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(p.x, p.y + p.hy + 0.06, p.z);
        this.scene.add(ring);
      } else if (p.kind === 'rest') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.2, 0.07, 8, 24),
          new THREE.MeshBasicMaterial({ color: 0xffd166 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(p.x, p.y + p.hy + 0.05, p.z);
        this.scene.add(ring);
        // チェックポイント番号の看板 (区間タイム計測の目印)
        if (p.cp) {
          const sp = makeCpSprite(`🚩CP${p.cp}`);
          sp.position.set(p.x, p.y + p.hy + 1.7, p.z);
          this.scene.add(sp);
        }
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

  // ================== カラールーレット (足場の着色) ==================
  get themeCount() {
    return THEMES.length;
  }

  themeName(idx) {
    return THEMES[((idx % THEMES.length) + THEMES.length) % THEMES.length].jp;
  }

  // 足場1枚の色をテーマから決める
  _colorFor(p, theme, out) {
    if (p.kind === 'goal') return out.setHex(0xffd166); // ゴールは常に金
    if (p.kind === 'pillar') {
      // 螺旋階段の柱: テーマの締め色を暗くした石柱 (ランドマークとして目立たせる)
      if (theme.rainbow) return out.setHex(0x8f98ad);
      out.setHex(theme.accent);
      out.offsetHSL(0, -0.1, -0.1);
      return out;
    }
    if (theme.rainbow) {
      if (p.kind === 'rest') return out.setHex(0xffffff);
      return out.setHSL(((p.instIndex ?? 0) * 0.11) % 1, 0.62, 0.62); // 段ごとに虹色
    }
    if (p.kind === 'rest') return out.setHex(theme.accent);
    out.setHex(theme.plat[Math.floor((p.rollA ?? 0) * theme.plat.length)]);
    out.offsetHSL(0, 0, ((p.rollB ?? 0.5) - 0.5) * 0.06);
    return out;
  }

  // 塔全体を指定テーマへ塗り替える (静止足場のみ。動く足場は水色のまま)
  applyTheme(idx) {
    idx = ((idx % THEMES.length) + THEMES.length) % THEMES.length;
    this.themeIndex = idx;
    const theme = THEMES[idx];
    const inst = this.staticInst;
    const c = this._ca;
    for (const p of this.staticList) {
      this._colorFor(p, theme, c);
      inst.setColorAt(p.instIndex, c);
      p.colorHex = c.getHex();
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return theme;
  }

  // 足場1枚だけを指定色へ (「5回に1回」の当たり演出用)。着色は永続する
  recolorOne(p, hex) {
    if (!p) return;
    p.colorHex = hex;
    this._ca.setHex(hex);
    if (p.meshRef) { // 個別メッシュ (動く/崩れる/位相) はマテリアルを直接染める
      p.meshRef.material.color.copy(this._ca);
      return;
    }
    if (p.instIndex != null && this.staticInst) {
      this.staticInst.setColorAt(p.instIndex, this._ca);
      if (this.staticInst.instanceColor) this.staticInst.instanceColor.needsUpdate = true;
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

    // 空気中を漂う細かな光の粒 (アンビエント・モート)。塔全体を包み、
    // ゆっくり回転させることで登っている間ずっと空間が「生きている」感じを出す。
    const moteCount = 160;
    const mpos = new Float32Array(moteCount * 3);
    const mrand = mulberry32(CONFIG.SEED ^ 0x5eed99);
    for (let i = 0; i < moteCount; i++) {
      const ang = mrand() * Math.PI * 2;
      const rad = 5 + mrand() * 20;
      mpos[i * 3] = Math.cos(ang) * rad;
      mpos[i * 3 + 1] = mrand() * (CONFIG.GOAL_HEIGHT + 20);
      mpos[i * 3 + 2] = Math.sin(ang) * rad;
    }
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
    this.motes = new THREE.Points(mgeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.09, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);

    this.scene.fog = new THREE.Fog(0xcfe8f8, 35, 150);
  }

  // 足元の影用: プレイヤー真下の足場の上面 y を返す
  groundTopBelow(x, z, y, t, tmpBox) {
    let best = null;
    const list = this.nearby(y - 10, y + 0.5, this._groundList || (this._groundList = []));
    for (const p of list) {
      if (!this.isSolid(p, t)) continue;
      const b = this.aabb(p, t, tmpBox);
      if (x > b.minX - 0.1 && x < b.maxX + 0.1 && z > b.minZ - 0.1 && z < b.maxZ + 0.1) {
        if (b.maxY <= y + 0.05 && (best === null || b.maxY > best)) best = b.maxY;
      }
    }
    return best;
  }

  update(t, dt, player, renderer, scene) {
    this.time = t;
    const playerY = player.pos.y;
    for (const { p, mesh } of this.movingMeshes) {
      const o = this.offset(p, t);
      mesh.position.set(
        p.x + (p.move.axis === 'x' ? o : 0),
        p.y + (p.move.axis === 'y' ? o : 0),
        p.z + (p.move.axis === 'z' ? o : 0)
      );
    }
    this._updateCrumble(dt, player);
    this._updatePhase(t);
    if (this.goalRing) this.goalRing.rotation.z = t * 0.6;

    // ベルトコンベア: 矢印を流れの向きへスクロール (物理の搬送と同じ速度)
    for (const b of this.beltList) {
      const n = b.marks.length;
      for (let i = 0; i < n; i++) {
        const u = (((t * b.speed) / b.L + i / n) % 1 + 1) % 1;
        const s = (u - 0.5) * b.L;
        b.marks[i].position.set(
          b.p.x + b.dirx * s,
          b.p.y + b.p.hy + 0.04,
          b.p.z + b.dirz * s
        );
      }
    }

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

    // 漂う光の粒: 塔をゆっくり回して空間に流れを与える
    if (this.motes) this.motes.rotation.y = t * 0.03;
  }

  // 崩れる足場: プレイヤーが乗ると CRUMBLE_DELAY 秒後に消え、CRUMBLE_RESPAWN 秒後に復活。
  // 消えるまでは小刻みに震わせて「もう落ちる」と伝える。
  _updateCrumble(dt, player) {
    const CRUMBLE_DELAY = 0.8;    // 踏んでから崩れるまで
    const CRUMBLE_RESPAWN = 2.6;  // 消えてから復活するまで
    for (const p of this.crumbleList) {
      const mesh = p.meshRef;
      if (p.gone) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          p.gone = false;
          p.triggered = false;
          mesh.visible = true;
          mesh.position.set(p.x, p.y, p.z);
        }
        continue;
      }
      if (!p.triggered && player.grounded && player.standing === p) {
        p.triggered = true;
        p.crumbleT = CRUMBLE_DELAY;
      }
      if (p.triggered) {
        p.crumbleT -= dt;
        const k = 1 - Math.max(p.crumbleT, 0) / CRUMBLE_DELAY; // 0→1 で揺れが激しく
        mesh.position.set(
          p.x + (Math.random() - 0.5) * 0.08 * k,
          p.y + (Math.random() - 0.5) * 0.08 * k,
          p.z + (Math.random() - 0.5) * 0.08 * k
        );
        if (p.crumbleT <= 0) {
          p.gone = true;
          p.respawnT = CRUMBLE_RESPAWN;
          mesh.visible = false;
        }
      }
    }
  }

  // 位相足場: 出ている間だけ実体化。消える直前に明滅させて予告する。
  _updatePhase(t) {
    for (const p of this.phaseList) {
      const c = p.phaseCfg;
      const f = ((t / c.period + c.offset) % 1 + 1) % 1;
      const mesh = p.meshRef;
      if (f < c.onFrac) {
        mesh.visible = true;
        const rem = (c.onFrac - f) * c.period; // 消えるまでの残り秒
        mesh.material.opacity = rem < 0.6 ? 0.35 + 0.65 * Math.abs(Math.sin(t * 18)) : 1;
      } else {
        mesh.visible = false;
      }
    }
  }
}
