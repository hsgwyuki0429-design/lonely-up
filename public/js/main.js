import * as THREE from 'three';
import { CONFIG, STORAGE, PLAYER_COLORS } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Ghosts } from './ghosts.js';
import { Net } from './net.js';
import { UI } from './ui.js';
import { sfx } from './audio.js';

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
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

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

let allTimeBest = Number(localStorage.getItem(STORAGE.BEST) || 0);
let bestClearMs = localStorage.getItem(STORAGE.CLEAR_MS)
  ? Number(localStorage.getItem(STORAGE.CLEAR_MS))
  : null;

// ================== ゲーム状態 ==================
let state = 'title'; // title | play | clear
let runStart = 0;
let clearMsThisRun = 0;
let nextMilestone = 50;

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
  player.spawn();
  camYaw = Math.PI;
  camPitch = 0.35;
  runStart = performance.now();
  nextMilestone = 50;
  clearMsThisRun = 0;
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
  state = 'play';
  ui.hideClear();
  ui.toast('スタートに戻った');
});
document.getElementById('btnClearRestart').addEventListener('click', () => {
  player.spawnKeepBest();
  runStart = performance.now();
  nextMilestone = 50;
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
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

function updateCamera(dt) {
  if (state === 'title') {
    // タイトル: 塔を見上げながらゆっくり周回
    camera.position.set(Math.sin(camYaw) * 17, 9, Math.cos(camYaw) * 17);
    camera.lookAt(0, 13, 0);
    return;
  }
  const d = input.takeCamDelta();
  camYaw -= d.x * 0.0055;
  camPitch = THREE.MathUtils.clamp(
    camPitch + d.y * 0.005, CONFIG.CAM_PITCH_MIN, CONFIG.CAM_PITCH_MAX);

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

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const t = Date.now() / 1000; // 動く足場は実時間ベース (全端末でほぼ同期)

  if (state === 'play' || state === 'clear') {
    input.poll();
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 4) {
      player.update(FIXED, input, camYaw, t, t - FIXED);
      acc -= FIXED;
      steps++;
    }

    // イベント処理
    for (const ev of player.events) {
      if (ev === 'jump') sfx.jump();
      else if (ev === 'land') sfx.land();
      else if (ev === 'fell') {
        sfx.fall();
        ui.toast('落ちた……');
      }
    }
    player.events.length = 0;

    const height = player.maxY;
    if (height > allTimeBest) {
      allTimeBest = height;
      localStorage.setItem(STORAGE.BEST, String(allTimeBest));
    }

    // マイルストーン
    if (player.pos.y >= nextMilestone && state === 'play') {
      ui.toast(`${nextMilestone}m 到達!`);
      sfx.milestone();
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

    net.sendPos(me, player.pos, player.yaw);
    net.maybeSyncScore(me.name, allTimeBest, bestClearMs);
  } else {
    // タイトル画面: ゆっくり周回するカメラ
    camYaw += dt * 0.1;
  }

  updateCamera(dt);
  ghosts.tick(dt);
  world.update(t, dt, player.pos.y, renderer, scene);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ?debug 付きで開いた時のみ内部オブジェクトを公開 (動作検証用)
if (location.search.includes('debug')) {
  window.__game = { player, world, net, get state() { return state; } };
}
