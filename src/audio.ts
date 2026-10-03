export type Sound =
  | "merge"
  | "bounce"
  | "damage"
  | "jump"
  | "land"
  | "finish"
  | "fall"
  | "checkpoint"
  | "click";
export class GameAudio {
  enabled = true;
  volume = 0.65;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private rolling: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  async enable(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      try {
        this.setup();
        await this.context!.resume();
      } catch {
        this.enabled = false;
      }
    }
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.enabled ? this.volume : 0,
        this.context.currentTime,
        0.025,
      );
    return this.enabled;
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.enabled ? this.volume : 0,
        this.context.currentTime,
        0.03,
      );
  }
  private setup() {
    if (this.context) return;
    const ctx = (this.context = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
      samples = buffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < samples.length; i++) {
      smooth = (smooth + Math.random() * 2 - 1) * 0.48;
      samples[i] = smooth;
    }
    this.noise = buffer;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 230;
    this.rolling = ctx.createGain();
    this.rolling.gain.value = 0;
    source.connect(this.filter);
    this.filter.connect(this.rolling);
    this.rolling.connect(this.master);
    source.start();
  }
  update(speed: number, grounded: boolean, running: boolean) {
    if (!this.context || !this.rolling || !this.filter) return;
    const now = this.context.currentTime;
    this.rolling.gain.setTargetAtTime(
      running && grounded ? Math.min(0.065, speed * 0.006) : 0,
      now,
      0.08,
    );
    this.filter.frequency.setTargetAtTime(150 + speed * 32, now, 0.1);
  }
  private tone(
    frequency: number,
    endFrequency: number,
    offset: number,
    duration: number,
    gain: number,
    type: OscillatorType = "sine",
  ) {
    const ctx = this.context!,
      time = ctx.currentTime + offset,
      osc = ctx.createOscillator(),
      envelope = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(30, endFrequency),
      time + duration,
    );
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(gain, time + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(envelope);
    envelope.connect(this.master!);
    osc.start(time);
    osc.stop(time + duration + 0.01);
    osc.onended = () => {
      osc.disconnect();
      envelope.disconnect();
    };
  }
  private burst(duration: number, frequency: number, gain: number) {
    const ctx = this.context!,
      source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      envelope = ctx.createGain();
    source.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.value = frequency;
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + duration,
    );
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master!);
    source.start();
    source.stop(ctx.currentTime + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
  }
  play(kind: Sound, rank = 4) {
    if (!this.enabled || !this.context || this.context.state !== "running")
      return;
    if (kind === "merge") {
      const base = 330 * 2 ** ((rank % 12) / 12);
      this.tone(base, base * 1.01, 0, 0.18, 0.13);
      this.tone(base * 1.5, base * 1.5, 0.07, 0.22, 0.075);
      this.tone(base * 2, base * 2, 0.12, 0.25, 0.045);
    } else if (kind === "finish" || kind === "checkpoint") {
      [523, 659, 784, 1047]
        .slice(0, kind === "finish" ? 4 : 3)
        .forEach((f, i) => this.tone(f, f, i * 0.11, 0.4, 0.095));
    } else if (kind === "damage") {
      this.tone(180, 55, 0, 0.23, 0.14, "triangle");
      this.burst(0.14, 700, 0.2);
    } else if (kind === "bounce") {
      this.tone(310, 85, 0, 0.22, 0.1, "triangle");
    } else if (kind === "jump") {
      this.tone(260, 780, 0, 0.3, 0.09);
      this.burst(0.25, 1900, 0.055);
    } else if (kind === "land") {
      this.tone(100, 42, 0, 0.15, 0.11, "triangle");
      this.burst(0.11, 450, 0.15);
    } else if (kind === "fall") {
      this.burst(0.65, 1700, 0.24);
      [200, 160, 100].forEach((f, i) =>
        this.tone(f, f * 0.7, i * 0.1, 0.25, 0.075),
      );
    } else this.tone(600, 450, 0, 0.09, 0.045);
  }
}
