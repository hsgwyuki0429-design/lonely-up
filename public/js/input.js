// タッチ操作: 画面左半分 = バーチャルジョイスティック / 右半分 = カメラドラッグ
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
    if (isTouch && e.clientX < window.innerWidth / 2 && this._joyId === null) {
      this._joyId = e.pointerId;
      this._joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyEl.style.display = 'block';
      this.joyEl.style.left = `${e.clientX - 60}px`;
      this.joyEl.style.top = `${e.clientY - 60}px`;
      this.setKnob(0, 0);
    } else if (this._camId === null) {
      this._camId = e.pointerId;
      this._camLast = { x: e.clientX, y: e.clientY };
    }
  }

  onMove(e) {
    if (e.pointerId === this._joyId) {
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
