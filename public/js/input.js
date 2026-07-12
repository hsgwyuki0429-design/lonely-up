// タッチ操作: 画面左半分 = バーチャルジョイスティック / 右半分 = カメラドラッグ
// 片手モード (CONFIG.ONE_HAND): 画面全体がスティック / 短いタップ = ジャンプ / 2本目のタッチも即ジャンプ
// PC: WASD・矢印キー + Space、C で会釈、マウスドラッグでカメラ
import { sfx } from './audio.js';
import { CONFIG } from './config.js';

export class Input {
  constructor(canvas) {
    this.move = { x: 0, y: 0 };
    this.camDelta = { x: 0, y: 0 };
    this._jump = false;
    this._bow = false;
    this.enabled = false;

    this.joyEl = document.getElementById('joy');
    this.knobEl = document.getElementById('joyKnob');
    this.jumpBtn = document.getElementById('btnJump');
    this.bowBtn = document.getElementById('btnBow');

    this._joyId = null;
    this._camId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._camLast = { x: 0, y: 0 };
    this._keys = new Set();
    this.JOY_R = 48;

    // 片手モードのタップ判定用 (押した時刻・位置と、そこからの最大移動距離)
    this._joyStart = { t: 0, x: 0, y: 0 };
    this._joyMaxDist = 0;
    this._joyShown = false; // 片手モードではドラッグと確定するまでスティックを表示しない (タップ時のちらつき防止)
    this.TAP_MS = 250;      // これより短いタッチはタップ (=ジャンプ) 候補
    this.TAP_SLOP = 12;     // タッチ開始からこの距離 (px) 以上動いたらドラッグ扱い

    // ジャイロ (端末の向き) でカメラを動かす。感度は CONFIG.GYRO_SENS 倍。
    // 端末の姿勢をワールド座標系に変換し、その視線ヨー/ピッチの差分をカメラへ渡す
    this.gyroDelta = { yaw: 0, pitch: 0 };
    this.airborne = false; // 自機が空中にいるか (main が毎フレーム更新。'air' モードで参照)
    this.gyroPitchOffset = 0; // 'peek' モードの上下オフセット (絶対角ベース。ドリフトしない)
    this._peekNeutral = null; // 'peek' の基準となる端末ピッチ (握り方に合わせて開始時に取得)
    this._gyroOn = false;
    this._gyroHasPrev = false;
    this._gyroYaw = 0;
    this._gyroPitch = 0;

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));

    this.jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.enabled) {
        this._jump = true;
        sfx.tap(); // 押した瞬間に鳴らして操作の即時性を出す
      }
    });

    this.bowBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.enabled) {
        this._bow = true;
        sfx.tap();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === 'Space' && this.enabled) {
        this._jump = true;
        e.preventDefault();
      }
      if (e.code === 'KeyC' && this.enabled) this._bow = true;
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));

    // ダブルタップ拡大などのブラウザ既定動作を抑止
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onDown(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const isTouch = e.pointerType === 'touch';
    if (isTouch && CONFIG.ONE_HAND) {
      // 片手モード: 最初のタッチは画面のどこでもスティック。2本目のタッチは即ジャンプ
      if (this._joyId === null) {
        this.startJoy(e, false);
      } else {
        this._jump = true;
        sfx.tap();
      }
      return;
    }
    if (isTouch && e.clientX < window.innerWidth / 2 && this._joyId === null) {
      this.startJoy(e, true);
    } else if (this._camId === null) {
      this._camId = e.pointerId;
      this._camLast = { x: e.clientX, y: e.clientY };
    }
  }

  // スティック操作の開始。show=false ならドラッグと確定するまで表示を遅らせる
  startJoy(e, show) {
    this._joyId = e.pointerId;
    this._joyOrigin = { x: e.clientX, y: e.clientY };
    this._joyStart = { t: performance.now(), x: e.clientX, y: e.clientY };
    this._joyMaxDist = 0;
    this._joyShown = show;
    this.joyEl.style.left = `${e.clientX - 60}px`;
    this.joyEl.style.top = `${e.clientY - 60}px`;
    this.joyEl.style.display = show ? 'block' : 'none';
    this.setKnob(0, 0);
  }

  onMove(e) {
    if (e.pointerId === this._joyId) {
      this._joyMaxDist = Math.max(
        this._joyMaxDist,
        Math.hypot(e.clientX - this._joyStart.x, e.clientY - this._joyStart.y)
      );
      if (!this._joyShown && this._joyMaxDist > this.TAP_SLOP) {
        // タップではなくドラッグと確定 → ここで初めてスティックを表示
        this._joyShown = true;
        this.joyEl.style.display = 'block';
      }
      let dx = e.clientX - this._joyOrigin.x;
      let dy = e.clientY - this._joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > this.JOY_R) {
        // フローティングスティック: 指が可動域を超えたら基部が指を追いかける。
        // 引き返した瞬間に入力方向が反転するので、切り返しの反応が速い
        const over = (len - this.JOY_R) / len;
        this._joyOrigin.x += dx * over;
        this._joyOrigin.y += dy * over;
        this.joyEl.style.left = `${this._joyOrigin.x - 60}px`;
        this.joyEl.style.top = `${this._joyOrigin.y - 60}px`;
        dx = (dx / len) * this.JOY_R;
        dy = (dy / len) * this.JOY_R;
      }
      // デッドゾーン: 遊びの内側は 0、外側は 0〜1 に再スケール (傾け量 = 速度)
      const m = Math.hypot(dx, dy) / this.JOY_R;
      const dz = CONFIG.STICK_DEADZONE;
      const scaled = m <= dz ? 0 : (m - dz) / (1 - dz);
      this.move.x = m > 0 ? (dx / (m * this.JOY_R)) * scaled : 0;
      this.move.y = m > 0 ? (-dy / (m * this.JOY_R)) * scaled : 0; // 画面上方向 = 前進
      this.setKnob(dx, dy);
    } else if (e.pointerId === this._camId) {
      this.camDelta.x += e.clientX - this._camLast.x;
      this.camDelta.y += e.clientY - this._camLast.y;
      this._camLast = { x: e.clientX, y: e.clientY };
    }
  }

  onUp(e) {
    if (e.pointerId === this._joyId) {
      // 片手モード: 動かさず素早く離した = タップ → ジャンプ
      if (
        CONFIG.ONE_HAND &&
        performance.now() - this._joyStart.t < this.TAP_MS &&
        this._joyMaxDist < this.TAP_SLOP
      ) {
        this._jump = true;
        sfx.tap();
      }
      this._joyId = null;
      this.move.x = 0;
      this.move.y = 0;
      this.joyEl.style.display = 'none';
    } else if (e.pointerId === this._camId) {
      this._camId = null;
    }
  }

  setKnob(dx, dy) {
    this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // 毎フレーム呼ぶ: キーボード入力をジョイスティック値に合成
  poll() {
    if (this._joyId === null) {
      let kx = 0, ky = 0;
      if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) ky += 1;
      if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) ky -= 1;
      if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) kx -= 1;
      if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) kx += 1;
      if (kx || ky) {
        const l = Math.hypot(kx, ky);
        this.move.x = kx / l;
        this.move.y = ky / l;
      } else {
        this.move.x = 0;
        this.move.y = 0;
      }
    }
  }

  consumeJump() {
    const j = this._jump;
    this._jump = false;
    return j;
  }

  consumeBow() {
    const b = this._bow;
    this._bow = false;
    return b;
  }

  // カメラを手動ドラッグ中か (自動追従の抑止に使う)
  get camDragging() {
    return this._camId !== null;
  }

  // カメラ回転量を取り出してリセット
  takeCamDelta() {
    const d = { x: this.camDelta.x, y: this.camDelta.y };
    this.camDelta.x = 0;
    this.camDelta.y = 0;
    return d;
  }

  // ジャイロによるカメラ回転量を取り出してリセット
  takeGyroDelta() {
    const d = { yaw: this.gyroDelta.yaw, pitch: this.gyroDelta.pitch };
    this.gyroDelta.yaw = 0;
    this.gyroDelta.pitch = 0;
    return d;
  }

  get gyroReady() { return this._gyroOn; }

  // 'peek' の基準をリセット (モード切替時・ラン開始時に握り直しを再取得)
  resetPeek() {
    this._peekNeutral = null;
    this.gyroPitchOffset = 0;
  }

  // ジャイロを有効化。iOS 13+ は要許可 (ユーザー操作＝ゲーム開始のタップから呼ぶこと)。
  // 非対応端末・不許可でも例外を投げず false を返すだけ
  enableGyro() {
    if (this._gyroOn) return Promise.resolve(true);
    const start = () => {
      window.addEventListener('deviceorientation', (e) => this.onGyro(e));
      this._gyroOn = true;
    };
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return Promise.resolve(false);
    if (typeof DOE.requestPermission === 'function') {
      return DOE.requestPermission()
        .then((r) => { if (r === 'granted') { start(); return true; } return false; })
        .catch(() => false);
    }
    start();
    return Promise.resolve(true);
  }

  onGyro(e) {
    if (!this.enabled || e.alpha == null) return;
    const DEG = Math.PI / 180;
    const a = e.alpha * DEG, b = e.beta * DEG, g = e.gamma * DEG;
    const cA = Math.cos(a), sA = Math.sin(a);
    const cB = Math.cos(b), sB = Math.sin(b);
    const cG = Math.cos(g), sG = Math.sin(g);
    // 端末→ワールドの回転 (W3C: R = Rz(alpha)·Rx(beta)·Ry(gamma))。
    // 画面の裏側 (端末 -z) が向くワールド方向 = カメラの視線とみなす。
    // ワールド座標で扱うので端末を縦横どちら向きに持っても破綻しない
    const fx = -(cG * sA * sB + cA * sG);
    const fy = -(sA * sG - cA * cG * sB);
    const fz = -(cB * cG); // ワールド上向き成分
    const yaw = Math.atan2(fx, fy);
    const pitch = Math.atan2(fz, Math.hypot(fx, fy));

    // 'peek' モード: 端末の上下の傾きを「絶対角」でカメラピッチのオフセットに変換する。
    // 相対的に積算しないのでドリフトせず、端末を基準の握りに戻せば視点も正面へ戻る。
    // 左右 (ヨー) は触らず、上下の覗き見だけを担当する。相対モードの基準管理より前に処理する。
    if (CONFIG.GYRO_MODE === 'peek') {
      if (this._peekNeutral === null) this._peekNeutral = pitch; // 最初のサンプル＝基準の握り
      this.gyroPitchOffset = -(pitch - this._peekNeutral) * CONFIG.GYRO_PEEK_GAIN;
      return;
    }

    if (!this._gyroHasPrev) {
      this._gyroYaw = yaw;
      this._gyroPitch = pitch;
      this._gyroHasPrev = true;
      return;
    }
    let dy = yaw - this._gyroYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    else if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - this._gyroPitch;
    this._gyroYaw = yaw;
    this._gyroPitch = pitch;

    // ジャイロの発動条件 (タイトルで選択)。基準 (prev) は上で常に更新済みなので、
    // どのモードでも「発動した瞬間に視点が飛ぶ」ことはない。
    //   always: 常時
    //   hold  : 画面右半分を押している間 (ジャンプ/会釈ボタンは別要素で camId を作らず除外される)
    //   air   : 自機が空中にいる間
    const mode = CONFIG.GYRO_MODE;
    const active = mode === 'always' ? true
      : mode === 'air' ? this.airborne
      : this._camId !== null;
    if (!active) return;

    // 微小な手ブレは無視 (静止中に自動追従カメラを止めてしまわないように)
    const dz = CONFIG.GYRO_DEADZONE;
    if (Math.abs(dy) < dz && Math.abs(dp) < dz) return;
    // 横 (ヨー): 感度スライダー (GYRO_SENS) を適用。左右反転トグルで符号を切替。
    // 縦 (ピッチ): 向きはそのまま、感度は常に1倍で固定 (スライダー非対応)。
    const sx = CONFIG.GYRO_INVERT_X ? -1 : 1;
    this.gyroDelta.yaw += sx * dy * CONFIG.GYRO_SENS;
    this.gyroDelta.pitch += dp;
  }
}
