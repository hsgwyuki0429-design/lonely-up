// アセット不要の軽量効果音 (WebAudio シンセ)
class Sfx {
  constructor() {
    this.ctx = null;
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

  blip(freq, dur, type = 'square', vol = 0.08, slide = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
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

  jump() { this.blip(320, 0.18, 'square', 0.06, 260); }
  land() { this.blip(140, 0.12, 'triangle', 0.09, -60); }
  fall() { this.blip(400, 0.5, 'sawtooth', 0.06, -320); }
  milestone() {
    this.blip(660, 0.12, 'sine', 0.08);
    setTimeout(() => this.blip(880, 0.18, 'sine', 0.08), 110);
  }
  clear() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.25, 'sine', 0.09), i * 140));
  }
}

export const sfx = new Sfx();
