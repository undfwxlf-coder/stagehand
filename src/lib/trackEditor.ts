import { PitchShifter } from "soundtouchjs";

export interface EQBand {
  type: BiquadFilterType;
  frequency: number;
  gain: number;
  q: number;
}

export const DEFAULT_EQ: EQBand[] = [
  { type: "lowshelf", frequency: 120, gain: 0, q: 0.7 },
  { type: "peaking", frequency: 500, gain: 0, q: 1.0 },
  { type: "peaking", frequency: 2500, gain: 0, q: 1.0 },
  { type: "highshelf", frequency: 8000, gain: 0, q: 0.7 },
];

// Per-band drag range — prevents bands from overlapping into nonsense.
export const EQ_FREQ_RANGES: [number, number][] = [
  [20, 250],
  [120, 1200],
  [800, 6000],
  [3000, 18000],
];

export interface EQBandSettings {
  frequency: number;
  gain: number;
}

export interface EditorSettings {
  speed: number; // 0.5 .. 2.0
  pitchSemitones: number; // -12 .. +12
  eqBands: EQBandSettings[];
  eqBypass: boolean;
  delayWet: number; // 0..1
  delayTimeSec: number; // 0..1
  delayFeedback: number; // 0..0.9
  reverbWet: number; // 0..1
}

export const DEFAULT_SETTINGS: EditorSettings = {
  speed: 1,
  pitchSemitones: 0,
  eqBands: DEFAULT_EQ.map((b) => ({ frequency: b.frequency, gain: b.gain })),
  eqBypass: false,
  delayWet: 0,
  delayTimeSec: 0.35,
  delayFeedback: 0.35,
  reverbWet: 0,
};

interface ShifterLike {
  tempo: number;
  pitchSemitones: number;
  percentagePlayed: number;
  duration: number;
  formattedDuration: string;
  formattedTimePlayed: string;
  on: (evt: string, cb: (data: { timePlayed: number; percentagePlayed: number }) => void) => void;
  connect: (node: AudioNode) => void;
  disconnect: () => void;
}

export class TrackEditor {
  ctx: AudioContext;
  buffer: AudioBuffer;
  shifter: ShifterLike | null = null;
  eqNodes: BiquadFilterNode[] = [];
  dryGain: GainNode;
  delay: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
  masterGain: GainNode;
  settings: EditorSettings = { ...DEFAULT_SETTINGS };
  onProgress: ((seconds: number, percent: number) => void) | null = null;
  isPlaying = false;
  private _seekPositionSec = 0;

  constructor(ctx: AudioContext, buffer: AudioBuffer) {
    this.ctx = ctx;
    this.buffer = buffer;

    // EQ chain
    this.eqNodes = DEFAULT_EQ.map((b) => {
      const n = ctx.createBiquadFilter();
      n.type = b.type;
      n.frequency.value = b.frequency;
      n.Q.value = b.q;
      n.gain.value = b.gain;
      return n;
    });
    for (let i = 0; i < this.eqNodes.length - 1; i++) {
      this.eqNodes[i].connect(this.eqNodes[i + 1]);
    }

    // Effects buses
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = this.settings.delayTimeSec;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = this.settings.delayFeedback;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = this.settings.delayWet;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = synthesizeReverbIR(ctx, 2.2, 2.5);
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = this.settings.reverbWet;

    // Wire dry + wet to master
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1;
    this.dryGain.connect(this.masterGain);
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.masterGain);
    this.reverb.connect(this.reverbWet);
    this.reverbWet.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // EQ tail splits into dry + wet inputs
    const eqOut = this.eqNodes[this.eqNodes.length - 1];
    eqOut.connect(this.dryGain);
    eqOut.connect(this.delay);
    eqOut.connect(this.reverb);
  }

  private _newShifter(): ShifterLike {
    const s = new (PitchShifter as unknown as new (
      ctx: AudioContext,
      buf: AudioBuffer,
      bufferSize: number
    ) => ShifterLike)(this.ctx, this.buffer, 1024);
    s.tempo = this.settings.speed;
    s.pitchSemitones = this.settings.pitchSemitones;
    s.on("play", (data) => {
      this._seekPositionSec = data.timePlayed;
      if (this.onProgress) this.onProgress(data.timePlayed, data.percentagePlayed);
    });
    s.connect(this.eqNodes[0]);
    return s;
  }

  async play() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.shifter) this.shifter = this._newShifter();
    this.isPlaying = true;
  }

  pause() {
    // soundtouchjs PitchShifter does not expose stop; disconnect to halt audio.
    if (this.shifter) {
      this.shifter.disconnect();
      this.shifter = null;
    }
    this.isPlaying = false;
  }

  seek(seconds: number) {
    const wasPlaying = this.isPlaying;
    if (this.shifter) {
      this.shifter.disconnect();
      this.shifter = null;
    }
    this._seekPositionSec = Math.max(0, Math.min(seconds, this.buffer.duration));
    if (wasPlaying) {
      // Re-create the shifter and skip ahead by replaying from offset using AudioBuffer copy.
      // soundtouchjs doesn't support seeking; we approximate by slicing the buffer.
      const sliced = sliceBuffer(this.ctx, this.buffer, this._seekPositionSec);
      const originalBuffer = this.buffer;
      this.buffer = sliced;
      this.shifter = this._newShifter();
      this.buffer = originalBuffer;
      this.isPlaying = true;
    } else if (this.onProgress) {
      this.onProgress(this._seekPositionSec, this._seekPositionSec / this.buffer.duration);
    }
  }

  get currentTimeSec() {
    return this._seekPositionSec;
  }

  get durationSec() {
    return this.buffer.duration;
  }

  setSpeed(v: number) {
    this.settings.speed = clamp(v, 0.5, 2);
    if (this.shifter) this.shifter.tempo = this.settings.speed;
  }

  setPitch(semitones: number) {
    this.settings.pitchSemitones = clamp(semitones, -12, 12);
    if (this.shifter) this.shifter.pitchSemitones = this.settings.pitchSemitones;
  }

  setEQBand(bandIdx: number, patch: Partial<EQBandSettings>) {
    const band = this.settings.eqBands[bandIdx];
    if (!band) return;
    if (patch.frequency !== undefined) band.frequency = patch.frequency;
    if (patch.gain !== undefined) band.gain = clamp(patch.gain, -18, 18);
    const node = this.eqNodes[bandIdx];
    if (!node) return;
    if (patch.frequency !== undefined) node.frequency.value = band.frequency;
    if (patch.gain !== undefined && !this.settings.eqBypass) node.gain.value = band.gain;
  }

  setEQBypass(bypass: boolean) {
    this.settings.eqBypass = bypass;
    this.eqNodes.forEach((node, i) => {
      const target = bypass ? 0 : this.settings.eqBands[i]?.gain ?? 0;
      node.gain.value = target;
    });
  }

  setDelayWet(v: number) {
    this.settings.delayWet = clamp(v, 0, 1);
    this.delayWet.gain.value = this.settings.delayWet;
  }

  setDelayFeedback(v: number) {
    this.settings.delayFeedback = clamp(v, 0, 0.9);
    this.delayFeedback.gain.value = this.settings.delayFeedback;
  }

  setDelayTime(sec: number) {
    this.settings.delayTimeSec = clamp(sec, 0.01, 1);
    this.delay.delayTime.value = this.settings.delayTimeSec;
  }

  setReverbWet(v: number) {
    this.settings.reverbWet = clamp(v, 0, 1);
    this.reverbWet.gain.value = this.settings.reverbWet;
  }

  destroy() {
    if (this.shifter) {
      this.shifter.disconnect();
      this.shifter = null;
    }
    try {
      this.masterGain.disconnect();
    } catch {
      /* noop */
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function sliceBuffer(ctx: AudioContext, src: AudioBuffer, fromSec: number): AudioBuffer {
  const startFrame = Math.floor(fromSec * src.sampleRate);
  const length = Math.max(1, src.length - startFrame);
  const out = ctx.createBuffer(src.numberOfChannels, length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch);
    const s = src.getChannelData(ch);
    for (let i = 0; i < length; i++) dst[i] = s[startFrame + i] ?? 0;
  }
  return out;
}

function synthesizeReverbIR(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * durationSec);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export async function loadAudioBufferFromUrl(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio fetch failed: HTTP ${res.status}`);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}
