import * as THREE from 'three';
import { CONFIG, STORAGE, PLAYER_COLORS, VERSION } from './config.js';
import { World } from './world.js';
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
const me = {
  name: localStorage.getItem(STORAGE.NAME) || `ゲスト${Math.floor(Math.random() * 900) + 100}`,
  color: Number(localStorage.getItem(STORAGE.COLOR) ?? Math.floor(Math.random() * PLAYER_COLORS.length)),
};
localStorage.setItem(STORAGE.COLOR, String(me.color));
player.setColor(PLAYER_COLORS[me.color % PLAYER_COLORS.length]);

// ================== 設定: ジャイロ感度 (1〜10倍) ==================
// スライダーで即時反映。onGyro が毎回 CONFIG.GYRO_SENS を読むのでプレイ中でも効く
const gyroSlider = document.getElementById('gyroSens');
const gyroSensVal = document.getElementById('gyroSensVal');
function applyGyroSens(v) {
  const s = Math.min(10, Math.max(1, Math.round(Number(v) || CONFIG.GYRO_SENS)));
  CONFIG.GYRO_SENS = s;
  gyroSlider.value = String(s);
  gyroSensVal.textContent = `×${s}`;
  localStorage.setItem(STORAGE.GYRO, String(s));
}
applyGyroSens(localStorage.getItem(STORAGE.GYRO) ?? CONFIG.GYRO_SENS);
gyroSlider.addEventListener('input', (e) => applyGyroSens(e.target.value));

// ジャイロ左右反転トグル (即時反映・保存)
const gyroInvert = document.getElementById('gyroInvert');
function applyGyroInvert(on) {
  CONFIG.GYRO_INVERT_X = !!on;
  gyroInvert.checked = !!on;
  localStorage.setItem(STORAGE.GYRO_INVERT, on ? '1' : '0');
}
applyGyroInvert(localStorage.getItem(STORAGE.GYRO_INVERT) === '1');
gyroInvert.addEventListener('change', (e) => applyGyroInvert(e.target.checked));

// ジャイロの発動条件モード (常時 / 右半分ホールド / 空中のみ)
const gyroMode = document.getElementById('gyroMode');
function applyGyroMode(m) {
  const v = ['always', 'hold', 'air'].includes(m) ? m : 'hold';
  CONFIG.GYRO_MODE = v;
  gyroMode.value = v;
  localStorage.setItem(STORAGE.GYRO_MODE, v);
}
applyGyroMode(localStorage.getItem(STORAGE.GYRO_MODE) ?? CONFIG.GYRO_MODE);
gyroMode.addEventListener('change', (e) => applyGyroMode(e.target.value));

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
ui.showTitle(false);

// オンライン接続
if (net.available) {
  net.join(me, {
    onPos: (p) => ghosts.receive(p),
    onCount: (n) => {
      ui.el.online.textContent = String(n);
      if (state === 'title') ui.showTitle(true);
    },
    onJoin: (name) => {
      if (state !== 'title' && name) ui.toast(`${String(name).slice(0, 12)} さんが登り始めた`);
    },
    onLeave: (id) => ghosts.remove(id),
  });
}

// ================== 画面遷移 ==================
function startRun() {
  me.name = (ui.el.nameInput.value || me.name).trim().slice(0, 12) || 'ゲスト';
  localStorage.setItem(STORAGE.NAME, me.name);
  sfx.unlock();
  input.enableGyro(); // タップ (ユーザー操作) の流れで呼び、iOS の許可ダイアログを出す
  player.spawn();
  camYaw = Math.PI;
  camPitch = 0.35;
  runStart = performance.now();
  nextMilestone = 50;
  clearMsThisRun = 0;
  resetCombo();
  state = 'play';
  input.enabled = true;
  ui.startGame();
  ui.hideClear();
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
  ui.closeRanking();
  ui.hideClear();
  ui.hideCombo();
  ui.showTitle(net.available);
}
document.getElementById('btnHome').addEventListener('click', () => {
  if (state === 'title') return;
  goHome();
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
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

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

  // スマホのジャイロ: 端末を振った分だけ視点を回す (指ドラッグと同様に自動追従を一時停止)
  const gd = input.takeGyroDelta();
  if (gd.yaw || gd.pitch) {
    camManualT = CONFIG.CAM_MANUAL_HOLD;
    camYaw += gd.yaw;
    camPitch = THREE.MathUtils.clamp(
      camPitch - gd.pitch, CONFIG.CAM_PITCH_MIN, CONFIG.CAM_PITCH_MAX);
  }

  // カメラの自動回り込みは「前へ進んでいる時」だけゆるく効かせる。
  // 横移動でカメラが回ると移動方向 (カメラ基準) が流されて円を描いてしまうため、
  // 横・後ろ入力ではカメラを固定する (最近の3Dゲームのレイジーカメラと同じ挙動)
  camManualT = Math.max(camManualT - dt, 0);
  const moveMag = Math.min(Math.hypot(input.move.x, input.move.y), 1);
  const fwdRatio = Math.max(input.move.y, 0); // スティックの前方向成分 = カメラから離れる移動
  if (camManualT <= 0 && !input.camDragging && moveMag > 0.1 && fwdRatio > 0) {
    const diff = wrapAngle(player.yaw + Math.PI - camYaw);
    camYaw += diff * Math.min(dt * CONFIG.CAM_FOLLOW * fwdRatio, 1);
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
  camTarget.set(player.pos.x, player.pos.y + 1.1, player.pos.z);
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

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const t = Date.now() / 1000; // 動く足場は実時間ベース (全端末でほぼ同期)
  let frozen = false;

  if (state === 'play' || state === 'clear') {
    input.poll();
    input.airborne = !player.grounded; // 'air' モードのジャイロ判定に使う
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
      if (player.standing.move.axis === 'x') player.pos.x += d;
      else player.pos.z += d;
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
        if (ev.impact > 2.5) {
          sfx.land(k);
          fx.burst(player.pos.x, feetY, player.pos.z, {
            count: Math.round(6 + k * 14), color: 0xf0ead8,
            speed: 1 + k * 3, up: 0.8 + k, gravity: 6, life: 0.45 + k * 0.3, spread: 0.3,
          });
        }
        if (ev.impact > 9) {
          fx.shake(0.2 + k * 0.3); // 強い着地は画面も揺れる
          fx.vibrate(15);
        }
        // コンボ: 今までより高い足場に乗れたら加算
        if (ev.topY > comboTopY + 0.3) {
          combo++;
          comboTopY = ev.topY;
          if (combo >= 2) {
            sfx.combo(combo);
            ui.showCombo(combo);
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
      sfx.milestone();
      fx.hitStop(0.12);
      fx.shake(0.35);
      fx.vibrate(30);
      fx.burst(player.pos.x, player.pos.y, player.pos.z, {
        count: 28, color: 0xffd166, speed: 4, up: 2.5,
        gravity: 5, life: 0.9, spread: 0.4,
      });
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
      fx.vibrate([40, 60, 40, 60, 120]);
      const confetti = [0xff6b6b, 0xffd166, 0x8ce99a, 0x74c0fc, 0xb197fc];
      confetti.forEach((c, i) => {
        fx.burst(player.pos.x, player.pos.y + 1 + i * 0.2, player.pos.z, {
          count: 18, color: c, speed: 4.5, up: 5,
          gravity: 4, life: 1.4, spread: 0.6,
        });
      });
      ui.showClear(clearMsThisRun);
      net.submitScore(me.name, Math.max(allTimeBest, world.goalY), bestClearMs);
    }

    const elapsed = state === 'clear' ? clearMsThisRun : performance.now() - runStart;
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
  world.update(t, dt, player.pos.y, renderer, scene);
  fx.update(dt, camera, frozen); // カメラ確定後にシェイクを乗せる
  renderer.render(scene, camera);
  tPrevFrame = t;
}
requestAnimationFrame(frame);

// ?debug 付きで開いた時のみ内部オブジェクトを公開 (動作検証用)
if (location.search.includes('debug')) {
  window.__game = {
    player, world, net,
    get state() { return state; },
    get camYaw() { return camYaw; },
  };
}
