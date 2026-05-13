import { clamp } from "./util";

type BeatListener = (beat: number, downbeat: boolean) => void;

export const CLICK_VOICES = ["tick", "wood", "rim", "cowbell", "beep"] as const;
export type ClickVoice = (typeof CLICK_VOICES)[number];

export type MetronomeOptions = {
  bpm: number;
  beatsPerBar: number;
  volume: number;
  voice: ClickVoice;
};

export class Metronome {
  private ctx: AudioContext | null = null;
  private bpm = 100;
  private beatsPerBar = 4;
  private volume = 0.55;
  private voice: ClickVoice = "tick";
  private running = false;
  private nextNoteTime = 0;
  private beatCounter = 0;
  private timerId: number | null = null;
  private readonly lookaheadMs = 25;
  private readonly scheduleAheadSec = 0.12;
  private listeners = new Set<BeatListener>();
  private pending: { beat: number; time: number }[] = [];
  private noiseBuffer: AudioBuffer | null = null;

  setOptions(opts: Partial<MetronomeOptions>) {
    if (opts.bpm !== undefined) this.bpm = clamp(opts.bpm, 20, 300);
    if (opts.beatsPerBar !== undefined)
      this.beatsPerBar = clamp(Math.round(opts.beatsPerBar), 1, 12);
    if (opts.volume !== undefined) this.volume = clamp(opts.volume, 0, 1);
    if (opts.voice !== undefined) this.voice = opts.voice;
  }

  onBeat(fn: BeatListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  isRunning() {
    return this.running;
  }

  async ensureContext() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.noiseBuffer) this.noiseBuffer = makeNoise(this.ctx);
  }

  async audition() {
    await this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    this.scheduleClick(t, true);
    this.scheduleClick(t + 0.18, false);
  }

  async start() {
    if (this.running) return;
    await this.ensureContext();
    if (!this.ctx) return;
    this.running = true;
    this.beatCounter = 0;
    this.pending = [];
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.tick();
    this.timerId = window.setInterval(() => this.tick(), this.lookaheadMs);
  }

  stop() {
    this.running = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.pending = [];
  }

  private tick() {
    if (!this.ctx || !this.running) return;
    const now = this.ctx.currentTime;
    while (this.nextNoteTime < now + this.scheduleAheadSec) {
      const beatInBar = this.beatCounter % this.beatsPerBar;
      const isDownbeat = beatInBar === 0;
      this.scheduleClick(this.nextNoteTime, isDownbeat);
      this.pending.push({ beat: beatInBar, time: this.nextNoteTime });
      this.advance();
    }
    while (this.pending.length && this.pending[0].time <= now) {
      const item = this.pending.shift()!;
      const downbeat = item.beat === 0;
      this.listeners.forEach((fn) => fn(item.beat, downbeat));
    }
  }

  private advance() {
    this.nextNoteTime += 60 / this.bpm;
    this.beatCounter++;
  }

  private scheduleClick(time: number, accent: boolean) {
    if (!this.ctx) return;
    const v = this.volume * (accent ? 1 : 0.7);
    switch (this.voice) {
      case "tick":
        this.voiceTick(time, accent, v);
        break;
      case "wood":
        this.voiceWood(time, accent, v);
        break;
      case "rim":
        this.voiceRim(time, accent, v);
        break;
      case "cowbell":
        this.voiceCowbell(time, accent, v);
        break;
      case "beep":
        this.voiceBeep(time, accent, v);
        break;
    }
  }

  private voiceTick(time: number, accent: boolean, v: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = accent ? 1480 : 920;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(v * 0.9, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  private voiceWood(time: number, accent: boolean, v: number) {
    const ctx = this.ctx!;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = accent ? 1800 : 1300;
    bp.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(v * 0.9, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    noise.connect(bp).connect(gain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.08);
    // body resonance — quick sine for pitch
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = accent ? 880 : 660;
    og.gain.setValueAtTime(0.0001, time);
    og.gain.exponentialRampToValueAtTime(v * 0.4, time + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(og).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  private voiceRim(time: number, accent: boolean, v: number) {
    const ctx = this.ctx!;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = accent ? 3200 : 2400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(v * 0.6, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    noise.connect(hp).connect(gain).connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.05);
    // click body
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(accent ? 2200 : 1600, time);
    osc.frequency.exponentialRampToValueAtTime(800, time + 0.02);
    og.gain.setValueAtTime(0.0001, time);
    og.gain.exponentialRampToValueAtTime(v * 0.5, time + 0.001);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    osc.connect(og).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.04);
  }

  private voiceCowbell(time: number, accent: boolean, v: number) {
    const ctx = this.ctx!;
    const f1 = accent ? 845 : 560;
    const f2 = f1 * 1.5;
    const make = (freq: number, vol: number) => {
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      og.gain.setValueAtTime(0.0001, time);
      og.gain.exponentialRampToValueAtTime(vol, time + 0.002);
      og.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      osc.connect(og).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.2);
    };
    const bp = ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 500;
    bp.connect(ctx.destination);
    make(f1, v * 0.5);
    make(f2, v * 0.4);
  }

  private voiceBeep(time: number, accent: boolean, v: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 2200 : 1760;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(v * 0.4, time + 0.002);
    gain.gain.setValueAtTime(v * 0.4, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
