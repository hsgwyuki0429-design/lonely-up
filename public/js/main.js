import * as THREE from 'three';
import { CONFIG, STORAGE, PLAYER_COLORS, VERSION, DEFAULT_STAMPS } from './config.js';
import { World, JACKPOT_COLORS } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Ghosts } from './ghosts.js';
import { Net } from './net.js';
import { UI } from './ui.js';
import { sfx } from './audio.js';
import { FX } from './fx.js';

// ================== セットアップ ==================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: window.devicePixelRatio < 1.5,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAM_FOV, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556688, 1.0));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
sun.position.set(30, 60, 20);
scene.add(sun);

const world = new World(scene);
const player = new Player(scene, world);
const input = new Input(canvas);
const ghosts = new Ghosts(scene);
const net = new Net();
const ui = new UI();
const fx = new FX(scene);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ================== プレイヤー情報 ==================
// 名前は必須。ゲスト名の自動割り当てはせず、最初に自分で入力してもらう。
const me = {
  name: (localStorage.getItem(STORAGE.NAME) || '').trim(),
  color: Number(localStorage.getItem(STORAGE.COLOR) ?? Math.floor(Math.random() * PLAYER_COLORS.length)),
};
localStorage.setItem(STORAGE.COLOR, String(me.color));
player.setColor(PLAYER_COLORS[me.color % PLAYER_COLORS.length]);

// 名前が入るまで「のぼる」を押せなくする
const btnStartEl = document.getElementById('btnStart');
function validateName() {
  const ok = ui.el.nameInput.value.trim().length >= 1;
  btnStartEl.disabled = !ok;
  return ok;
}

// プレイヤーカラー番号 → CSS 色文字列 (コメントの名前色に使う)
const colorHex = (idx) => {
  const n = PLAYER_COLORS.length;
  return '#' + PLAYER_COLORS[(((idx | 0) % n) + n) % n].toString(16).padStart(6, '0');
};

// 「下寄り表示」トグル (即時反映・保存)。自機を画面下1/3あたりに置き、上を広く見せる
const lowCam = document.getElementById('lowCam');
function applyLowCam(on) {
  CONFIG.CAM_LOW_SUBJECT = !!on;
  lowCam.checked = !!on;
  localStorage.setItem(STORAGE.LOW_CAM, on ? '1' : '0');
}
applyLowCam(localStorage.getItem(STORAGE.LOW_CAM) === '1');
lowCam.addEventListener('change', (e) => applyLowCam(e.target.checked));

// バージョン表示 (デプロイ反映の目視確認用)
document.getElementById('appVer').textContent = `v${VERSION}`;

let allTimeBest = Number(localStorage.getItem(STORAGE.BEST) || 0);
let bestClearMs = localStorage.getItem(STORAGE.CLEAR_MS)
  ? Number(localStorage.getItem(STORAGE.CLEAR_MS))
  : null;

// ================== ゲーム状態 ==================
let state = 'title'; // title | play | clear
let runStart = 0;
let clearMsThisRun = 0;
let nextMilestone = 50;

// コンボ: 前回より高い足場に連続で乗れた回数。落ちたらリセット。
let combo = 0;
let comboTopY = 0;

function resetCombo() {
  combo = 0;
  comboTopY = 0;
  ui.hideCombo();
}

ui.el.nameInput.value = me.name;
ui.el.nameInput.addEventListener('input', validateName);
validateName();
ui.showTitle(false);

// オンライン接続。ここで例外が出てもゲーム本体 (スタート等) が死なないよう握りつぶす
if (net.available) {
  try {
    net.join(me, {
      onPos: (p) => ghosts.receive(p),
      onCount: (n) => {
        ui.el.online.textContent = String(n);
        if (state === 'title') ui.showTitle(true);
        ui.setOnlineCount(n);
        if (ui.onlineOpen) refreshOnline();
      },
      onJoin: (name) => {
        if (state !== 'title' && name) ui.toast(`${String(name).slice(0, 12)} さんが登り始めた`);
      },
      onLeave: (id) => ghosts.remove(id),
      onChat: (p) => {
        // 他プレイヤーのコメント: 左のフィード + そのキャラの頭上に吹き出し
        ui.addChat(p.n, p.t, colorHex(p.c));
        ghosts.say(p.i, p.t);
      },
    });
  } catch (err) {
    console.warn('[net] join failed', err);
  }
}

// ================== 画面遷移 ==================
function startRun() {
  const nm = (ui.el.nameInput.value || '').trim().slice(0, 12);
  if (!nm) { ui.el.nameInput.focus(); validateName(); return; } // 名前は必須
  me.name = nm;
  localStorage.setItem(STORAGE.NAME, me.name);
  net.updateIdentity(me); // presence の名前を最新に (オンライン一覧へ反映)
  sfx.unlock();
  player.spawn();
  camYaw = Math.PI;
  camPitch = 0.35;
  camPullT = 0;
  runStart = performance.now();
  nextMilestone = 50;
  clearMsThisRun = 0;
  resetCombo();
  state = 'play';
  input.enabled = true;
  ui.startGame();
  ui.hideClear();
  ui.toast('ドラッグで移動 / タップでジャンプ');
}

document.getElementById('btnStart').addEventListener('click', startRun);
document.getElementById('btnRestart').addEventListener('click', () => {
  if (state === 'title') return;
  player.spawnKeepBest();
  runStart = performance.now();
  nextMilestone = 50;
  resetCombo();
  state = 'play';
  ui.hideClear();
  ui.toast('スタートに戻った');
});
// ホーム (タイトル) に戻る
function goHome() {
  if (allTimeBest > 0) { // 途中でも自己ベストは保存・送信してから戻る
    localStorage.setItem(STORAGE.BEST, String(allTimeBest));
    net.submitScore(me.name, allTimeBest, bestClearMs);
  }
  state = 'title';
  input.enabled = false;
  net.selfY = 0; // タイトルでは待機中 (高さ0)
  setStampEdit(false);
  ui.closeChat();
  closeOnline();
  ui.closeRanking();
  ui.hideClear();
  ui.hideCombo();
  ui.showTitle(net.available);
}
document.getElementById('btnHome').addEventListener('click', () => {
  if (state === 'title') return;
  goHome();
});

// ================== オンラインの人の一覧 (名前・現在の高さ・バージョン) ==================
// バージョン文字列の比較 (a > b か)。"3.10" も正しく比較できるよう桁ごとに数値比較する。
function verGt(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
let onlineTimer = null;
function refreshOnline() {
  const raw = net.onlineList();
  let latest = VERSION;
  for (const r of raw) if (verGt(r.v, latest)) latest = r.v; // 全員の中で一番新しい版
  let anyOutdated = false;
  const rows = raw.map((r) => {
    const outdated = verGt(latest, r.v);
    if (outdated) anyOutdated = true;
    return { name: r.name, colorHex: colorHex(r.color), height: r.y, v: r.v, outdated, isMe: r.isMe };
  });
  ui.renderOnline(rows, latest, anyOutdated);
}
function openOnline() {
  ui.openOnline();
  refreshOnline();
  clearInterval(onlineTimer);
  onlineTimer = setInterval(refreshOnline, 1000); // 高さは動くのでライブ更新
}
function closeOnline() {
  ui.closeOnline();
  clearInterval(onlineTimer);
  onlineTimer = null;
}
document.getElementById('btnOnline').addEventListener('click', openOnline);
document.getElementById('btnOnlineClose').addEventListener('click', closeOnline);
document.getElementById('netStatus').addEventListener('click', openOnline); // タイトルからも開ける

// ================== コメント (チャット) ==================
// コメントを送信 (自由入力・スタンプ共通の実処理)
function postComment(text) {
  const t = String(text).trim().slice(0, 40);
  if (!t) return;
  net.sendChat(me, t);                           // 全員へ送信
  ui.addChat(me.name, t, colorHex(me.color), true); // 自分のフィード
  player.say(t);                                 // 自機の頭上に吹き出し
}
function sendChatInput() {
  const text = ui.el.chatInput.value;
  ui.el.chatInput.value = '';
  ui.closeChat();
  postComment(text);
}

// ---- スタンプ (定型文): 6個を保存し、押すだけで送れる。編集して保存できる ----
let stamps = loadStamps();
let stampsEditing = false;
const stampsBox = ui.el.chatStamps;
const btnStampEdit = document.getElementById('btnStampEdit');

function loadStamps() {
  try {
    const raw = localStorage.getItem(STORAGE.STAMPS);
    const a = raw && JSON.parse(raw);
    if (Array.isArray(a) && a.length) {
      // 常に6枠に整える (足りなければ既定で補完)
      return Array.from({ length: 6 }, (_, i) =>
        String(a[i] ?? DEFAULT_STAMPS[i] ?? '').slice(0, 40));
    }
  } catch { /* 壊れていたら既定へ */ }
  return DEFAULT_STAMPS.slice();
}
function saveStamps() {
  localStorage.setItem(STORAGE.STAMPS, JSON.stringify(stamps));
}
function renderStamps() {
  stampsBox.innerHTML = '';
  stampsBox.classList.toggle('editing', stampsEditing);
  stamps.forEach((s, i) => {
    if (stampsEditing) {
      const inp = document.createElement('input');
      inp.className = 'stamp';
      inp.type = 'text';
      inp.maxLength = 40;
      inp.value = s;
      inp.placeholder = `スタンプ${i + 1}`;
      inp.addEventListener('input', () => { stamps[i] = inp.value; });
      stampsBox.appendChild(inp);
    } else {
      const b = document.createElement('button');
      b.className = 'stamp';
      b.textContent = s || `（空${i + 1}）`;
      b.addEventListener('click', () => { ui.closeChat(); postComment(s); });
      stampsBox.appendChild(b);
    }
  });
}
function setStampEdit(on) {
  if (stampsEditing === on) return;
  stampsEditing = on;
  if (!on) { // 編集終了 → 整形して保存
    stamps = stamps.map((s) => String(s).trim().slice(0, 40));
    saveStamps();
  }
  btnStampEdit.textContent = on ? '完了' : '編集';
  renderStamps();
}
btnStampEdit.addEventListener('click', () => setStampEdit(!stampsEditing));
renderStamps();

document.getElementById('btnChat').addEventListener('click', () => {
  if (state === 'title') return;
  if (ui.chatOpen) { setStampEdit(false); ui.closeChat(); }
  else ui.openChat();
});
document.getElementById('chatSend').addEventListener('click', sendChatInput);
ui.el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendChatInput(); }
  else if (e.key === 'Escape') { e.preventDefault(); ui.closeChat(); }
});
document.getElementById('btnClearRestart').addEventListener('click', () => {
  player.spawnKeepBest();
  runStart = performance.now();
  nextMilestone = 50;
  resetCombo();
  state = 'play';
  ui.hideClear();
});

async function openRanking() {
  ui.openRanking();
  const rows = await net.fetchTop(50);
  if (rows) {
    ui.renderRanking(rows, net.cid, false);
  } else {
    // オフライン: 自分の記録のみ表示
    ui.renderRanking(
      allTimeBest > 0
        ? [{ client_id: net.cid, name: me.name, best_height: allTimeBest, clear_ms: bestClearMs }]
        : [],
      net.cid,
      true
    );
  }
}
document.getElementById('btnRank').addEventListener('click', openRanking);
document.getElementById('btnClearRank').addEventListener('click', () => {
  ui.hideClear();
  openRanking();
});
document.getElementById('btnRankClose').addEventListener('click', () => {
  ui.closeRanking();
  if (state === 'clear') ui.showClear(clearMsThisRun);
});

// タブ非表示時にベストを保存・送信
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && allTimeBest > 0) {
    localStorage.setItem(STORAGE.BEST, String(allTimeBest));
    net.submitScore(me.name, allTimeBest, bestClearMs);
  }
});

// ================== カメラ ==================
let camYaw = Math.PI;
let camPitch = 0.35;
let camManualT = 0;      // 手動カメラ操作の余韻 (この間は自動追従しない)
let camPullYaw = 0;      // 着地時に「次の足場」の方向へ視点を引っ張る目標ヨー
let camPullT = 0;        // 引っ張りの残り時間 (秒)
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

// 着地した足場の「次の足場」(生成順 = 登頂ルート順) の方向へ視点を向ける。
// カメラを操作する指がないので、どこへ行けばいいかをカメラが教えてくれるようにする
function pullCamToNext() {
  const i = world.platforms.indexOf(player.standing);
  const next = i >= 0 ? world.platforms[i + 1] : null;
  if (!next) return;
  const t = Date.now() / 1000;
  const o = world.offset(next, t);
  const nx = next.x + (next.move?.axis === 'x' ? o : 0) - player.pos.x;
  const nz = next.z + (next.move?.axis === 'z' ? o : 0) - player.pos.z;
  if (Math.hypot(nx, nz) < 0.5) return; // ほぼ真上なら向きは変えない
  camPullYaw = Math.atan2(-nx, -nz); // カメラが自機の背後に回り、視線が次の足場を向くヨー
  camPullT = CONFIG.ONE_HAND_PULL_TIME;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function updateCamera(dt) {
  if (state === 'title') {
    // タイトル: 塔を見上げながらゆっくり周回
    camera.position.set(Math.sin(camYaw) * 17, 9, Math.cos(camYaw) * 17);
    camera.lookAt(0, 13, 0);
    return;
  }
  const d = input.takeCamDelta();
  if (d.x || d.y) camManualT = CONFIG.CAM_MANUAL_HOLD;
  camYaw -= d.x * 0.0055;
  camPitch = THREE.MathUtils.clamp(
    camPitch + d.y * 0.005, CONFIG.CAM_PITCH_MIN, CONFIG.CAM_PITCH_MAX);

  // 着地直後は「次の足場」の方向へ視点をなめらかに引っ張る。
  // 手動でカメラを操作したら即中断する (プレイヤーの意思を優先)
  if (camPullT > 0) {
    if (d.x || d.y || input.camDragging) {
      camPullT = 0;
    } else {
      camPullT -= dt;
      const diff = wrapAngle(camPullYaw - camYaw);
      camYaw += diff * Math.min(dt * CONFIG.ONE_HAND_PULL, 1);
    }
  }

  // カメラの自動回り込みは「前へ進んでいる時」だけゆるく効かせる。
  // 横移動でカメラが回ると移動方向 (カメラ基準) が流されて円を描いてしまうため、
  // 横・後ろ入力ではカメラを固定する (最近の3Dゲームのレイジーカメラと同じ挙動)
  camManualT = Math.max(camManualT - dt, 0);
  const moveMag = Math.min(Math.hypot(input.move.x, input.move.y), 1);
  const fwdRatio = Math.max(input.move.y, 0); // スティックの前方向成分 = カメラから離れる移動
  // カメラを回す指がないので、横移動でもゆるく背後へ回り込ませる
  const follow = Math.max(fwdRatio, moveMag * CONFIG.ONE_HAND_FOLLOW);
  if (camPullT <= 0 && camManualT <= 0 && !input.camDragging && moveMag > 0.1 && follow > 0) {
    const diff = wrapAngle(player.yaw + Math.PI - camYaw);
    camYaw += diff * Math.min(dt * CONFIG.CAM_FOLLOW * follow, 1);
  }

  const dist = CONFIG.CAM_DIST;
  const ch = Math.cos(camPitch) * dist;
  camPos.set(
    player.pos.x + Math.sin(camYaw) * ch,
    player.pos.y + Math.sin(camPitch) * dist + 1.2,
    player.pos.z + Math.cos(camYaw) * ch
  );
  const k = 1 - Math.exp(-dt * 8);
  camera.position.lerp(camPos, k);
  // 「下寄り表示」版: 視点を上へずらしてカメラを上に向け、自機を画面下1/3あたりに置く。
  // 上方向 (これから登る先) が広く見える。
  const lookUp = CONFIG.CAM_LOW_SUBJECT ? CONFIG.CAM_LOW_LOOKUP : 0;
  camTarget.set(player.pos.x, player.pos.y + 1.1 + lookUp, player.pos.z);
  camera.lookAt(camTarget);
}
camera.position.set(0, 4, 10);
camera.lookAt(0, 1, 0);

// ================== メインループ ==================
const FIXED = 1 / 60;
let acc = 0;
let last = performance.now();
let tPrevFrame = Date.now() / 1000;

// コンボ数に応じたピッチ倍率 (音が上がっていく = 気持ちいい)
const comboRate = () => 1 + Math.min(combo, 12) * 0.04;
// 環境光・シェイク用のコンボ色 (UI.comboColor と対応: 黄 → 橙 → 赤熱)
const comboGlowHex = (n) => (n >= 9 ? 0xff5b5b : n >= 5 ? 0xff9f43 : 0xffd166);

// 着地の通算回数。着地するたびに土台の色が変わり、5回に1回は特大の当たり演出
let landCount = 0;
const _landColor = new THREE.Color(); // 毎回の塗り替え色 (使い回し)

// ---- カラールーレット: 落下のたびに塔全体の配色をスロットのように切り替える ----
let rouletteBusy = false;
function spinColorRoulette() {
  if (rouletteBusy) return;
  rouletteBusy = true;
  const N = world.themeCount;
  const final = (world.themeIndex + 1 + Math.floor(Math.random() * (N - 1))) % N; // 直前と必ず変える
  // だんだん間隔が延びる = スロットが減速して止まる感覚
  const steps = [0, 70, 140, 215, 300, 400, 520, 670, 850];
  steps.forEach((ms, i) => {
    setTimeout(() => {
      const last = i === steps.length - 1;
      world.applyTheme(last ? final : Math.floor(Math.random() * N));
      if (last) {
        sfx.rouletteStop();
        fx.glow(0xffe08a, 0.7);
        fx.flash('rgba(255,255,255,0.16)', 90);
        ui.floatReward(world.themeName(final), '#ffe08a', true);
        rouletteBusy = false;
      } else {
        sfx.rouletteTick();
        fx.glow(world.staticList[0]?.colorHex ?? 0xffffff, 0.28);
      }
    }, ms);
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const t = Date.now() / 1000; // 動く足場は実時間ベース (全端末でほぼ同期)
  let frozen = false;

  if (state === 'play' || state === 'clear') {
    input.poll();
    frozen = fx.tickFreeze(dt);
    if (!frozen) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED && steps < 4) {
        player.update(FIXED, input, camYaw, t, t - FIXED, ghosts);
        acc -= FIXED;
        steps++;
      }
    } else if (player.grounded && player.standing?.move) {
      // ヒットストップ中も動く足場には運ばれる (置き去りで落ちるのを防ぐ)
      const d = world.offset(player.standing, t) - world.offset(player.standing, tPrevFrame);
      const ax = player.standing.move.axis;
      if (ax === 'x') player.pos.x += d;
      else if (ax === 'z') player.pos.z += d;
      else player.pos.y += d;
      player.mesh.position.copy(player.pos);
    }

    // イベント処理 (アクションへの即時フィードバック)
    const feetY = player.pos.y - CONFIG.PLAYER_HALF_H;
    for (const ev of player.events) {
      if (ev.t === 'jump') {
        sfx.jump(comboRate());
        fx.burst(player.pos.x, feetY, player.pos.z, {
          count: 7, color: 0xffffff, speed: 1.6, up: 0.6,
          gravity: 3, life: 0.35, spread: 0.25,
        });
      } else if (ev.t === 'land') {
        const k = THREE.MathUtils.clamp(ev.impact / 16, 0, 1);
        if (ev.impact > 2.5) sfx.land(k);
        // 着地の手応えはシェイクで表現 (強い着地ほど大きく揺れ、特大は一瞬反転する)
        if (ev.impact > 9) {
          fx.shake(0.2 + k * 0.35);
          fx.vibrate(15);
          if (ev.impact > 12) fx.invert(70);
        }
        // 着地したら次の足場の方向へ視点を引っ張る
        pullCamToNext();
        // コンボ: 今までより高い足場に乗れたら加算
        if (ev.topY > comboTopY + 0.3) {
          combo++;
          comboTopY = ev.topY;
          if (combo >= 2) {
            sfx.combo(combo);          // 聴覚の階段
            ui.showCombo(combo);       // 過熱するカウンター + 飛び出す報酬ポップ
            // 質量感のある破片: 乗った足場の色でチャンクを四方に飛ばす。
            // コンボが伸びるほど数・勢いが増し、重力で落ちていく余韻を残す。
            const chunkColor = player.standing?.colorHex ?? 0xffd166;
            fx.burst(player.pos.x, feetY, player.pos.z, {
              count: Math.min(6 + combo * 2, 26), color: chunkColor,
              speed: 2 + combo * 0.18, up: 1.5, gravity: 9,
              life: 0.6 + Math.min(combo, 10) * 0.02, spread: 0.38,
            });
            // 環境光 + コンボに比例したシェイク & 振動 (画面全体の共鳴)
            fx.glow(comboGlowHex(combo), Math.min(0.22 + combo * 0.05, 0.7));
            fx.shake(Math.min(0.1 + combo * 0.03, 0.4));
            fx.vibrate(Math.min(8 + combo * 2, 28));
          }
        }
        // 着地するたびに、乗った土台を新しい色へ塗り替える。染まった土台が
        // 軌跡として残り、登るほど自分だけのカラフルな塔になる (変化 = ドーパミン)。
        landCount++;
        if (player.standing) {
          if (landCount % 5 === 0) {
            // 5回に1回は特大の「当たり」演出 (ネオン色 + キラッ + ✨ポップ)
            const jackpot = JACKPOT_COLORS[Math.floor(Math.random() * JACKPOT_COLORS.length)];
            world.recolorOne(player.standing, jackpot);
            sfx.sparkle();
            fx.burst(player.pos.x, feetY, player.pos.z, {
              count: 22, color: jackpot, speed: 3.2, up: 2.2,
              gravity: 7, life: 0.8, spread: 0.4,
            });
            fx.glow(jackpot, 0.55);
            fx.shake(0.28);
            fx.invert(90);
            fx.vibrate(18);
            ui.floatReward('✨', `#${jackpot.toString(16).padStart(6, '0')}`);
          } else {
            // 毎回: ランダムな鮮やか色へ。小さな同色バースト + ほのかな環境光で彩る
            _landColor.setHSL(Math.random(), 0.72, 0.58);
            const hex = _landColor.getHex();
            world.recolorOne(player.standing, hex);
            fx.burst(player.pos.x, feetY, player.pos.z, {
              count: 8, color: hex, speed: 1.8, up: 1.2,
              gravity: 7, life: 0.5, spread: 0.3,
            });
            fx.glow(hex, 0.22);
          }
        }
      } else if (ev.t === 'bounce') {
        // 他プレイヤーの頭を踏んで跳ねた
        sfx.jump(1.35);
        fx.burst(player.pos.x, feetY, player.pos.z, {
          count: 10, color: 0xffe08a, speed: 2, up: 1.2,
          gravity: 4, life: 0.4, spread: 0.3,
        });
        fx.vibrate(12);
      } else if (ev.t === 'bow') {
        sfx.tap();
      } else if (ev.t === 'fell') {
        sfx.fall();
        ui.toast('落ちた……');
        fx.shake(0.65);
        fx.flash('rgba(255, 60, 60, 0.32)', 220);
        fx.vibrate([60, 40, 60]);
        resetCombo();
        // 落下のたびに塔全体の配色をルーレットで一新 (失敗を「新しい塔」の楽しみに変える)
        spinColorRoulette();
      }
    }
    player.events.length = 0;

    const height = player.maxY;
    if (height > allTimeBest) {
      allTimeBest = height;
      localStorage.setItem(STORAGE.BEST, String(allTimeBest));
    }

    // マイルストーン (ヒットストップで「タメ」を作り、金色の火花を散らす)
    if (player.pos.y >= nextMilestone && state === 'play') {
      ui.toast(`${nextMilestone}m 到達!`);
      ui.floatReward(`${nextMilestone}m`, '#ffd166', true); // 大きくバウンドする報酬ポップ
      sfx.milestone();
      fx.hitStop(0.12);
      fx.shake(0.35);
      fx.glow(0xffe08a, 0.75); // 金色の環境光でリッチさを底上げ
      fx.vibrate(30);
      fx.burst(player.pos.x, player.pos.y, player.pos.z, {
        count: 28, color: 0xffd166, speed: 4, up: 2.5,
        gravity: 5, life: 0.9, spread: 0.4,
      });
      fx.invert(110); // マイルストーンは画面反転で強調
      ui.popHeight();
      nextMilestone += 50;
    }

    // クリア判定
    if (
      state === 'play' &&
      player.grounded &&
      player.standing?.kind === 'goal'
    ) {
      state = 'clear';
      clearMsThisRun = Math.round(performance.now() - runStart);
      if (bestClearMs === null || clearMsThisRun < bestClearMs) {
        bestClearMs = clearMsThisRun;
        localStorage.setItem(STORAGE.CLEAR_MS, String(bestClearMs));
      }
      sfx.clear();
      // 登頂の瞬間: 長めのヒットストップ + 紙吹雪
      fx.hitStop(0.28);
      fx.shake(0.5);
      fx.glow(0xffe08a, 0.85);
      fx.vibrate([40, 60, 40, 60, 120]);
      const confetti = [0xff6b6b, 0xffd166, 0x8ce99a, 0x74c0fc, 0xb197fc];
      confetti.forEach((c, i) => {
        fx.burst(player.pos.x, player.pos.y + 1 + i * 0.2, player.pos.z, {
          count: 18, color: c, speed: 4.5, up: 5,
          gravity: 4, life: 1.4, spread: 0.6,
        });
      });
      // 登頂は画面反転を数回たたみかけて派手に締める
      [0, 160, 320].forEach((ms) => setTimeout(() => fx.invert(120), ms));
      ui.showClear(clearMsThisRun);
      net.submitScore(me.name, Math.max(allTimeBest, world.goalY), bestClearMs);
    }

    const elapsed = state === 'clear' ? clearMsThisRun : performance.now() - runStart;
    net.selfY = player.pos.y - CONFIG.PLAYER_HALF_H; // オンライン一覧に出す自分の現在の高さ
    ui.updateHud(
      player.pos.y - CONFIG.PLAYER_HALF_H,
      allTimeBest,
      Math.max(elapsed, 0),
      net.online
    );

    net.sendPos(me, player.pos, player.yaw, player.bowing);
    net.maybeSyncScore(me.name, allTimeBest, bestClearMs);
  } else {
    // タイトル画面: ゆっくり周回するカメラ
    camYaw += dt * 0.1;
  }

  updateCamera(dt);
  ghosts.tick(dt);
  world.update(t, dt, player, renderer, scene);
  fx.update(dt, camera, frozen); // カメラ確定後にシェイクを乗せる
  renderer.render(scene, camera);
  tPrevFrame = t;
}
requestAnimationFrame(frame);

// ?debug 付きで開いた時のみ内部オブジェクトを公開 (動作検証用)
if (location.search.includes('debug')) {
  window.__game = {
    player, world, net, camera, THREE, ui, fx, sfx, ghosts,
    get state() { return state; },
    get camYaw() { return camYaw; },
    get combo() { return combo; },
  };
}
