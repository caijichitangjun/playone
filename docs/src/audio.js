/**
 * 音效：用 WebAudio 现场合成，不依赖任何音频文件（体积为 0，也免去资源打包）。
 * iOS 要求音频必须由用户手势解锁，所以 AudioContext 在第一次交互时才创建。
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
    this.lastAt = Object.create(null);
    this._unlocked = false;
  }

  /** 必须在用户手势回调里调用一次 */
  unlock() {
    if (this._unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);

      // 预生成一段白噪声，供爆炸/受击复用
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this._unlocked = true;
    } catch {
      this.enabled = false;
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  /** 同名音效限流，避免一堆塔同时开火时声音糊成一团 */
  _throttle(key, ms) {
    if (!this.enabled || !this.ctx) return false;
    const now = this.ctx.currentTime * 1000;
    if (this.lastAt[key] && now - this.lastAt[key] < ms) return false;
    this.lastAt[key] = now;
    return true;
  }

  _tone({ freq = 440, freqTo = null, type = 'square', dur = 0.12, gain = 0.15, delay = 0 }) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.25, gain = 0.2, freq = 900, q = 1, delay = 0, type = 'lowpass' }) {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t0 + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---------- 具体音效 ----------
  shoot(kind) {
    if (!this._throttle('shoot' + kind, 45)) return;
    switch (kind) {
      case 'arrow':
        this._tone({ freq: 900, freqTo: 1500, type: 'triangle', dur: 0.06, gain: 0.06 });
        break;
      case 'cannon':
        this._tone({ freq: 180, freqTo: 70, type: 'square', dur: 0.14, gain: 0.1 });
        this._noise({ dur: 0.16, gain: 0.1, freq: 700 });
        break;
      case 'frost':
        this._tone({ freq: 1400, freqTo: 2100, type: 'sine', dur: 0.09, gain: 0.05 });
        break;
      case 'poison':
        this._tone({ freq: 320, freqTo: 180, type: 'sawtooth', dur: 0.1, gain: 0.055 });
        break;
      default:
        this._tone({ freq: 700, freqTo: 500, type: 'square', dur: 0.06, gain: 0.05 });
    }
  }

  zap() {
    if (!this._throttle('zap', 60)) return;
    this._tone({ freq: 2200, freqTo: 600, type: 'sawtooth', dur: 0.11, gain: 0.07 });
    this._noise({ dur: 0.1, gain: 0.06, freq: 4000, type: 'highpass' });
  }

  explode() {
    if (!this._throttle('explode', 70)) return;
    this._noise({ dur: 0.34, gain: 0.2, freq: 1100 });
    this._tone({ freq: 120, freqTo: 45, type: 'square', dur: 0.24, gain: 0.12 });
  }

  hit() {
    if (!this._throttle('hit', 60)) return;
    this._tone({ freq: 420, freqTo: 240, type: 'triangle', dur: 0.05, gain: 0.05 });
  }

  die() {
    if (!this._throttle('die', 50)) return;
    this._tone({ freq: 260, freqTo: 90, type: 'triangle', dur: 0.14, gain: 0.07 });
  }

  build() {
    if (!this._throttle('build', 80)) return;
    this._tone({ freq: 420, type: 'square', dur: 0.07, gain: 0.09 });
    this._tone({ freq: 700, type: 'square', dur: 0.1, gain: 0.08, delay: 0.07 });
  }

  upgrade() {
    if (!this._throttle('upgrade', 100)) return;
    [523, 659, 880].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.12, gain: 0.09, delay: i * 0.07 })
    );
  }

  sell() {
    if (!this._throttle('sell', 100)) return;
    this._tone({ freq: 500, freqTo: 300, type: 'sine', dur: 0.14, gain: 0.08 });
  }

  deny() {
    if (!this._throttle('deny', 200)) return;
    this._tone({ freq: 200, freqTo: 130, type: 'square', dur: 0.13, gain: 0.09 });
  }

  click() {
    if (!this._throttle('click', 40)) return;
    this._tone({ freq: 620, type: 'sine', dur: 0.04, gain: 0.06 });
  }

  waveStart() {
    this._tone({ freq: 330, type: 'triangle', dur: 0.16, gain: 0.11 });
    this._tone({ freq: 494, type: 'triangle', dur: 0.2, gain: 0.1, delay: 0.14 });
  }

  waveClear() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.14, gain: 0.09, delay: i * 0.08 })
    );
  }

  leak() {
    if (!this._throttle('leak', 150)) return;
    this._tone({ freq: 260, freqTo: 80, type: 'sawtooth', dur: 0.4, gain: 0.16 });
    this._noise({ dur: 0.3, gain: 0.12, freq: 500 });
  }

  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.1, delay: i * 0.13 })
    );
  }

  lose() {
    [392, 330, 262, 196].forEach((f, i) =>
      this._tone({ freq: f, type: 'sawtooth', dur: 0.35, gain: 0.1, delay: i * 0.17 })
    );
  }
}
