export type SfxName =
  | "rocket" | "mg" | "mine" | "bomb" | "explosion" | "bigExplosion" | "pickup" | "hit" | "shield"
  | "boost" | "collision" | "land" | "beep" | "go" | "victory" | "defeat" | "click" | "kill"
  | "crate" | "empty" | "respawn" | "hurt" | "mineArm";

class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private vols = { master: 0.8, music: 0.5, sfx: 0.9 };
  // engine
  private eng: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private skid: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  // music
  private musicTimer: number | null = null;
  private nextStep = 0;
  private step = 0;
  private musicOn = false;
  private lastSfx: Record<string, number> = {};

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.applyVolumes();
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.vols = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.master || !this.musicGain || !this.sfxGain) return;
    this.master.gain.value = this.vols.master;
    this.musicGain.gain.value = this.vols.music * 0.55;
    this.sfxGain.gain.value = this.vols.sfx;
  }

  suspend() {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }
  resume() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0, dest?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest ?? this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, delay = 0, q = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  sfx(name: SfxName, vol = 1) {
    if (!this.ctx || vol <= 0.02) return;
    const now = this.ctx.currentTime;
    // rate-limit spammy sounds
    const minGap = name === "mg" ? 0.045 : name === "hit" ? 0.04 : name === "crate" ? 0.05 : 0;
    if (minGap) {
      if (now - (this.lastSfx[name] ?? 0) < minGap) return;
      this.lastSfx[name] = now;
    }
    const v = Math.min(1, vol);
    switch (name) {
      case "rocket":
        this.noise(0.5, "bandpass", 2200, 300, 0.5 * v, 0, 0.8);
        this.tone(220, 70, 0.35, "sawtooth", 0.22 * v);
        break;
      case "mg":
        this.tone(900 + Math.random() * 200, 260, 0.06, "square", 0.12 * v);
        this.noise(0.04, "highpass", 3000, 1500, 0.12 * v);
        break;
      case "mine":
        this.tone(300, 120, 0.15, "triangle", 0.3 * v);
        this.tone(900, 900, 0.05, "square", 0.1 * v, 0.1);
        break;
      case "mineArm":
        this.tone(1400, 1400, 0.06, "square", 0.08 * v);
        break;
      case "bomb":
        this.tone(160, 520, 0.4, "triangle", 0.3 * v);
        this.noise(0.15, "bandpass", 1500, 800, 0.2 * v);
        break;
      case "explosion":
        this.noise(0.8, "lowpass", 2400, 120, 0.9 * v);
        this.tone(110, 28, 0.6, "sine", 0.7 * v);
        break;
      case "bigExplosion":
        this.noise(1.3, "lowpass", 3000, 80, 1.0 * v);
        this.tone(90, 22, 1.0, "sine", 0.9 * v);
        this.tone(200, 40, 0.5, "sawtooth", 0.2 * v);
        break;
      case "pickup":
        [660, 880, 1320].forEach((f, i) => this.tone(f, f * 1.02, 0.12, "triangle", 0.22 * v, i * 0.055));
        break;
      case "hit":
        this.tone(500, 140, 0.07, "square", 0.16 * v);
        this.noise(0.05, "highpass", 2500, 2500, 0.1 * v);
        break;
      case "hurt":
        this.tone(180, 60, 0.25, "sawtooth", 0.3 * v);
        this.noise(0.2, "lowpass", 1500, 200, 0.4 * v);
        break;
      case "shield":
        this.tone(300, 1200, 0.4, "sine", 0.3 * v);
        this.tone(450, 1800, 0.4, "triangle", 0.12 * v);
        break;
      case "boost":
        this.noise(0.7, "bandpass", 400, 3000, 0.45 * v, 0, 1.5);
        this.tone(120, 500, 0.5, "sawtooth", 0.18 * v);
        break;
      case "collision":
        this.noise(0.18, "lowpass", 900, 150, 0.7 * v);
        this.tone(140, 50, 0.15, "square", 0.25 * v);
        break;
      case "land":
        this.noise(0.2, "lowpass", 500, 90, 0.6 * v);
        this.tone(90, 40, 0.18, "sine", 0.5 * v);
        break;
      case "crate":
        this.noise(0.25, "bandpass", 1200, 300, 0.5 * v, 0, 0.7);
        this.tone(200, 90, 0.1, "square", 0.12 * v);
        break;
      case "beep":
        this.tone(660, 660, 0.18, "square", 0.25 * v);
        break;
      case "go":
        this.tone(1320, 1320, 0.45, "square", 0.28 * v);
        this.tone(660, 660, 0.45, "triangle", 0.22 * v);
        break;
      case "click":
        this.tone(800, 600, 0.05, "square", 0.12 * v);
        break;
      case "empty":
        this.tone(200, 150, 0.06, "square", 0.1 * v);
        break;
      case "respawn":
        this.tone(200, 900, 0.35, "sine", 0.3 * v);
        this.tone(400, 1400, 0.3, "triangle", 0.12 * v, 0.05);
        break;
      case "kill":
        this.tone(880, 880, 0.08, "square", 0.22 * v);
        this.tone(1320, 1320, 0.14, "square", 0.22 * v, 0.08);
        break;
      case "victory":
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => {
          this.tone(f, f, 0.22, "square", 0.18 * v, i * 0.14);
          this.tone(f / 2, f / 2, 0.22, "triangle", 0.2 * v, i * 0.14);
        });
        break;
      case "defeat":
        [440, 392, 349, 262].forEach((f, i) => this.tone(f, f * 0.97, 0.3, "sawtooth", 0.15 * v, i * 0.2));
        break;
    }
  }

  // ---- engine loop ----
  startEngine() {
    const ctx = this.ctx;
    if (!ctx || this.eng || !this.sfxGain) return;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = "sawtooth";
    o2.type = "square";
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    o1.start();
    o2.start();
    this.eng = { o1, o2, f, g };
    if (this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2200;
      bp.Q.value = 2;
      const sg = ctx.createGain();
      sg.gain.value = 0;
      src.connect(bp);
      bp.connect(sg);
      sg.connect(this.sfxGain);
      src.start();
      this.skid = { src, g: sg };
    }
  }

  setEngine(ratio: number, boosting: boolean, skid: number, active: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.eng) return;
    const t = ctx.currentTime;
    const r = Math.max(0, Math.min(1.4, ratio));
    const base = 52 + r * 95 + (boosting ? 35 : 0);
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(base * 0.502, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(380 + r * 1500 + (boosting ? 500 : 0), t, 0.05);
    this.eng.g.gain.setTargetAtTime(active ? 0.055 + r * 0.05 : 0, t, 0.08);
    if (this.skid) this.skid.g.gain.setTargetAtTime(active ? skid * 0.1 : 0, t, 0.05);
  }

  stopEngine() {
    if (this.eng) {
      try {
        this.eng.o1.stop();
        this.eng.o2.stop();
      } catch { /* already stopped */ }
      this.eng = null;
    }
    if (this.skid) {
      try {
        this.skid.src.stop();
      } catch { /* already stopped */ }
      this.skid = null;
    }
  }

  // ---- music ----
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 40);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    const bpm = 132;
    const stepDur = 60 / bpm / 4;
    while (this.nextStep < ctx.currentTime + 0.18) {
      this.playStep(this.step, this.nextStep);
      this.nextStep += stepDur;
      this.step++;
    }
  }

  private mNote(freq: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number) {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(100, cutoff * 0.3), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private mNoise(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private playStep(step: number, t: number) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 8;
    const roots = [55, 55, 43.65, 43.65, 65.41, 65.41, 49, 49]; // A1 F1 C2 G1
    const chords: number[][] = [
      [1, 1.189, 1.498], [1, 1.189, 1.498], [1, 1.26, 1.498], [1, 1.26, 1.498],
      [1, 1.189, 1.498], [1, 1.189, 1.498], [1, 1.26, 1.498], [1, 1.189, 1.5],
    ];
    const root = roots[bar];
    // kick
    if (s % 4 === 0) {
      const ctx = this.ctx!;
      if (this.musicGain) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g);
        g.connect(this.musicGain);
        o.start(t);
        o.stop(t + 0.2);
      }
    }
    if (s === 4 || s === 12) this.mNoise(t, 0.12, "bandpass", 1800, 0.35);
    if (s % 2 === 1) this.mNoise(t, 0.04, "highpass", 7000, 0.12);
    // bass off-beat pulse
    if (s % 4 === 2 || s === 15) this.mNote(root * 2, t, 0.16, "sawtooth", 0.28, 900);
    if (s % 4 === 0) this.mNote(root, t, 0.2, "sawtooth", 0.3, 600);
    // arp
    const arpPattern = [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0, 1];
    const ch = chords[bar];
    const note = root * 8 * ch[arpPattern[s]];
    this.mNote(note, t, 0.12, "square", 0.075, 2600);
    // lead on bars 4-7
    if (bar >= 4 && (s === 0 || s === 6 || s === 10)) this.mNote(root * 16 * ch[(s / 2) % 3 | 0], t, 0.3, "triangle", 0.12, 3500);
  }
}

export const audio = new AudioEngine();
