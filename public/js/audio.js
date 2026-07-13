// アセット不要の軽量効果音 (WebAudio シンセ)
// 「気持ちいい音」のために各SEは複数の周波数帯 (低音 + 高音 + ノイズ) を重ねる。
class Sfx {
  constructor() {
    this.ctx = null;
    this._noiseBuf = null;
  }

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running';
  }

  blip(freq, dur, type = 'square', vol = 0.08, slide = 0) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(freq + slide, 30), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  // バンドパスを通したノイズ (土煙の「ザッ」、衝撃の「ズシャ」用)
  noise(dur, vol = 0.05, freq = 800, q = 1.2) {
    if (!this.ok) return;
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }

  // ボタンを押した瞬間の極小クリック (操作の即時確認用)
  tap() {
    this.blip(1300, 0.035, 'sine', 0.03);
  }

  // rate: コンボで上がるピッチ倍率
  jump(rate = 1) {
    this.blip(300 * rate, 0.16, 'square', 0.05, 250 * rate); // メインの「ピョッ」
    this.blip(680 * rate, 0.09, 'sine', 0.028, 260 * rate);  // 高音レイヤー
  }

  // k: 落下速度に応じた 0〜1 の強さ
  land(k = 0.5) {
    this.blip(120, 0.1, 'triangle', 0.05 + 0.05 * k, -50); // 低音の「ズドッ」
    this.noise(0.07, 0.02 + 0.05 * k, 500 + 700 * k);      // 土煙の「ザッ」
    if (k > 0.6) this.blip(60, 0.14, 'sine', 0.09, -20);   // 強打時はさらに重低音
  }

  // コンボが続くほど音程が「階段状」に上がる (聴覚の階段)。
  // 半音ずつではなくメジャー・ペンタトニック (ド・レ・ミ・ソ・ラ) で駆け上がるので、
  // どこで途切れても濁らず、「次はもっと高い音が鳴る」という報酬予測を生む。
  combo(n) {
    const PENTA = [0, 2, 4, 7, 9];               // メジャー・ペンタの半音間隔
    const idx = Math.max(n - 1, 0);
    const semis = PENTA[idx % 5] + 12 * Math.floor(idx / 5); // 段ごとに1オクターブ上へ
    const f = 523.25 * Math.pow(2, semis / 12);  // C5 起点
    const bell = f > 1600 ? 'triangle' : 'sine'; // 高域は明るいベル系に
    this.blip(f, 0.13, bell, 0.06, f * 0.04);    // 主音 (わずかに上へスライド = きらめき)
    this.blip(f * 1.5, 0.09, 'sine', 0.022);     // 完全5度上の共鳴レイヤー
    this.blip(f * 2, 0.06, 'sine', 0.014);       // オクターブ上でさらに華やかに
    if (n >= 5) this.noise(0.05, 0.012 + Math.min(n, 20) * 0.001, 5000, 2); // 高コンボのキラッ
  }

  fall() {
    this.blip(300, 0.5, 'sawtooth', 0.055, -260); // 落ちていく「ヒュー」
    this.blip(70, 0.35, 'sine', 0.1, -30);        // 鈍い「ドン」
    this.noise(0.25, 0.05, 300, 0.8);
  }

  milestone() {
    this.blip(660, 0.12, 'sine', 0.08);
    this.noise(0.12, 0.025, 3000, 2); // キラッとした高域
    setTimeout(() => {
      this.blip(880, 0.18, 'sine', 0.08);
      this.blip(1760, 0.12, 'sine', 0.025);
    }, 110);
  }

  clear() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => {
        this.blip(f, 0.25, 'sine', 0.09);
        this.blip(f * 2, 0.18, 'sine', 0.03); // オクターブ上を重ねて華やかに
      }, i * 140));
  }
}

export const sfx = new Sfx();
