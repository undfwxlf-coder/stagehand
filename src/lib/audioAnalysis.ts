import FFT from "fft.js";
import { analyze as analyzeBpm } from "web-audio-beat-detector";

export interface DetectedAudio {
  bpm: number | null;
  key: string | null;
  keyConfidence: number | null;
}

const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export async function decodeAudio(file: File): Promise<AudioBuffer> {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await file.arrayBuffer();
    // `decodeAudioData` detaches the input buffer. We don't reuse it, so we
    // skip the previous defensive `buf.slice(0)` copy that doubled allocation
    // on every upload — a 500 MB WAV is enough to OOM mobile Safari.
    return await ctx.decodeAudioData(buf);
  } finally {
    ctx.close();
  }
}

export function peaksFromBuffer(buffer: AudioBuffer, buckets = 1024): number[] {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = new Array(buckets).fill(0);
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const start = b * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    for (let i = start; i < end; i++) {
      const v = Math.abs(channel[i]);
      if (v > max) max = v;
    }
    peaks[b] = +max.toFixed(4);
  }
  return peaks;
}

export async function detectBpm(buffer: AudioBuffer): Promise<number | null> {
  // Run analysis on multiple segments of the song and median-combine. This
  // smooths out half-/double-time errors common with single-pass detectors.
  const totalSec = buffer.duration;
  const windowSec = 30;
  const sr = buffer.sampleRate;

  const positions: number[] =
    totalSec < windowSec
      ? [0]
      : totalSec < windowSec * 3
      ? [Math.max(0, (totalSec - windowSec) / 2)]
      : [0, (totalSec - windowSec) / 2, totalSec - windowSec];

  const candidates: number[] = [];
  for (const startSec of positions) {
    try {
      const slice = sliceBuffer(buffer, startSec * sr, windowSec * sr);
      const raw = await analyzeBpm(slice);
      const folded = foldBpm(raw);
      if (folded != null) candidates.push(folded);
    } catch (e) {
      console.warn("[detect] bpm slice failed", e);
    }
  }

  if (candidates.length === 0) return null;

  // Cluster nearby values (within ±2 BPM) and pick the largest cluster's median.
  candidates.sort((a, b) => a - b);
  let bestCluster: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const cluster = [candidates[i]];
    for (let j = i + 1; j < candidates.length; j++) {
      if (candidates[j] - candidates[i] <= 4) cluster.push(candidates[j]);
      else break;
    }
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }
  const median = bestCluster[Math.floor(bestCluster.length / 2)];
  console.log("[detect] bpm candidates", candidates, "→", median);
  return median;
}

function foldBpm(bpm: number): number | null {
  if (!isFinite(bpm) || bpm <= 0) return null;
  let out = bpm;
  while (out > 180) out /= 2;
  while (out < 60) out *= 2;
  return Math.round(out * 10) / 10;
}

function sliceBuffer(buffer: AudioBuffer, startSample: number, lengthSamples: number): AudioBuffer {
  const len = Math.max(1, Math.min(buffer.length - Math.floor(startSample), Math.floor(lengthSamples)));
  const start = Math.max(0, Math.floor(startSample));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, len, buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, len, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < len; i++) dst[i] = src[start + i];
  }
  return out;
}

export function detectKey(buffer: AudioBuffer): { key: string; confidence: number } | null {
  try {
    const samples = mixToMono(buffer);
    const sampleRate = buffer.sampleRate;

    // Analyze at most 60s from the middle of the song to keep this fast.
    const maxSec = 60;
    const wantSamples = Math.min(samples.length, Math.floor(maxSec * sampleRate));
    const startSample = Math.max(0, Math.floor((samples.length - wantSamples) / 2));

    const frameSize = 4096;
    const hopSize = 2048;
    const fft = new FFT(frameSize);
    const out = fft.createComplexArray();
    const windowed = new Float64Array(frameSize);
    const hann = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
    }

    const chroma = new Array<number>(12).fill(0);
    const limit = startSample + wantSamples - frameSize;

    for (let s = startSample; s <= limit; s += hopSize) {
      let energy = 0;
      for (let i = 0; i < frameSize; i++) {
        const v = samples[s + i] * hann[i];
        windowed[i] = v;
        energy += v * v;
      }
      if (energy < 1e-5) continue; // skip silent frames

      fft.realTransform(out, windowed as unknown as number[]);
      fft.completeSpectrum(out);

      // Compute frame chromagram first; only add to running total if it has
      // enough harmonic structure (i.e., not just broadband noise/percussion).
      const frameChroma = new Array<number>(12).fill(0);
      let frameTotal = 0;
      for (let bin = 1; bin < frameSize / 2; bin++) {
        const re = out[2 * bin];
        const im = out[2 * bin + 1];
        const mag = Math.sqrt(re * re + im * im);
        if (mag === 0) continue;
        const freq = (bin * sampleRate) / frameSize;
        if (freq < 65 || freq > 2000) continue; // C2 (~65 Hz) to ~B6
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        const pc = ((midi % 12) + 12) % 12;
        frameChroma[pc] += mag;
        frameTotal += mag;
      }
      if (frameTotal === 0) continue;

      // Reject frames whose chroma is too flat (likely percussion / cymbals).
      // Compute a simple peakedness metric: max bin / sum.
      const maxBin = Math.max(...frameChroma);
      if (maxBin / frameTotal < 0.14) continue;

      for (let i = 0; i < 12; i++) chroma[i] += frameChroma[i];
    }

    const total = chroma.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const normChroma = chroma.map((c) => c / total);

    const all: { key: string; score: number }[] = [];
    for (let root = 0; root < 12; root++) {
      const rotMaj = new Array(12);
      const rotMin = new Array(12);
      for (let i = 0; i < 12; i++) {
        rotMaj[i] = KRUMHANSL_MAJOR[(i - root + 12) % 12];
        rotMin[i] = KRUMHANSL_MINOR[(i - root + 12) % 12];
      }
      all.push({ key: PITCH_NAMES[root], score: pearson(normChroma, rotMaj) });
      all.push({ key: PITCH_NAMES[root] + "m", score: pearson(normChroma, rotMin) });
    }
    all.sort((a, b) => b.score - a.score);
    const best = all[0];
    const second = all[1];
    const confidence = Math.max(0, best.score - second.score);
    console.log(
      "[detect] key →",
      best.key,
      "(score",
      best.score.toFixed(3) + ", margin " + confidence.toFixed(3) + ")",
      "next:",
      second.key,
      second.score.toFixed(3),
      "chroma:",
      normChroma.map((c, i) => `${PITCH_NAMES[i]}:${(c * 100).toFixed(1)}`).join(" ")
    );
    return { key: best.key, confidence };
  } catch (e) {
    console.warn("[detect] key failed", e);
    return null;
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const len = buffer.length;
  const out = new Float32Array(len);
  const n = buffer.numberOfChannels;
  for (let ch = 0; ch < n; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  for (let i = 0; i < len; i++) out[i] /= n;
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}
