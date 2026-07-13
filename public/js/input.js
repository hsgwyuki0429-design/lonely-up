// 操作は片手モードのみ。
// タッチ: 画面のどこでもドラッグ = 移動 / 短いタップ = ジャンプ / 2本目のタッチも即ジャンプ
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
    this.bowBtn = document.getElementById('btnBow');

    this._joyId = null;
    this._camId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._camLast = { x: 0, y: 0 };
    this._keys = new Set();
    this.JOY_R = 48;

    // タップ判定用 (押した時刻・位置と、そこからの最大移動距離)
    this._joyStart = { t: 0, x: 0, y: 0 };
    this._joyMaxDist = 0;
    this._joyShown = false; // ドラッグと確定するまでスティックを表示しない (タップ時のちらつき防止)
    this.TAP_MS = 300;      // これより短いタッチはタップ (=ジャンプ) 候補
    this.TAP_SLOP = 16;     // タッチ開始からこの距離 (px) 以上動いたらドラッグ扱い

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));

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
    if (e.pointerType === 'touch') {
      // 最初のタッチは画面のどこでもスティック。2本目のタッチは即ジャンプ
      if (this._joyId === null) {
        this.startJoy(e, false);
      } else {
        this._jump = true;
        sfx.tap();
      }
    } else if (this._camId === null) {
      // マウス (PC): ドラッグでカメラ
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
      // 動かさず素早く離した = タップ → ジャンプ
      if (
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
}
