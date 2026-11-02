// PCM helpers: resampling, levels, 16-bit mono WAV encoding/decoding.
// Pure JS so they run the same in the browser and in Node tests.

export const TARGET_RATE = 16000;

// Windowed-sinc (Blackman) resampler with an anti-aliasing low-pass at
// 0.95 x the lower Nyquist. Input/Output: Float32Array.
// The kernel only depends on the output sample's phase between input samples;
// for the usual rates (48000, 44100, 22050 -> 16000) there are few phases, so
// the kernels are computed once per phase instead of once per output sample
// (that per-sample trig made «إيقاف» take seconds on phones).
const MAX_PHASES = 4000;
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

export function resample(input, inRate, outRate = TARGET_RATE, halfTaps = 16) {
  if (inRate === outRate) return Float32Array.from(input);
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  const fc = Math.min(1, outRate / inRate) * 0.95; // cutoff relative to input Nyquist
  const half = Math.ceil(halfTaps / fc);            // kernel half-width in input samples
  const tap = (x) => {
    const u = fc * x;
    const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
    const w = 0.42 + 0.5 * Math.cos(Math.PI * x / half) + 0.08 * Math.cos(2 * Math.PI * x / half);
    return fc * sinc * w;
  };
  const intRates = Number.isInteger(inRate) && Number.isInteger(outRate);
  const g = intRates ? gcd(inRate, outRate) : 0;
  const phases = intRates ? outRate / g : Infinity;
  const last = input.length - 1;
  if (phases <= MAX_PHASES) {
    // Polyphase: output n sits at input position center + p / phases.
    const inStep = inRate / g;
    const width = 2 * half;                         // taps k = center - half + 1 .. center + half
    const kernels = new Float64Array(phases * width);
    for (let p = 0; p < phases; p++) {
      const frac = p / phases;
      for (let j = 0; j < width; j++) kernels[p * width + j] = tap(frac + half - 1 - j);
    }
    for (let n = 0; n < outLen; n++) {
      const num = n * inStep;                       // exact integer
      const center = Math.floor(num / phases);
      const p = num - center * phases;
      const base = center - half + 1;
      const k0 = Math.max(0, base);
      const k1 = Math.min(last, center + half);
      const ko = p * width - base;
      let acc = 0;
      let wsum = 0;
      for (let k = k0; k <= k1; k++) {
        const h = kernels[ko + k];
        acc += input[k] * h;
        wsum += h;
      }
      out[n] = wsum !== 0 ? acc / wsum : 0;         // unity DC gain, also at the edges
    }
    return out;
  }
  for (let n = 0; n < outLen; n++) {
    const t = n * ratio;
    const center = Math.floor(t);
    let acc = 0;
    let wsum = 0;
    const k0 = Math.max(0, center - half + 1);
    const k1 = Math.min(last, center + half);
    for (let k = k0; k <= k1; k++) {
      const h = tap(t - k);
      acc += input[k] * h;
      wsum += h;
    }
    out[n] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}

export function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = Math.round(s < 0 ? s * 32768 : s * 32767);
  }
  return out;
}

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : -120);

export function measureLevels(f32) {
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < f32.length; i++) {
    const a = Math.abs(f32[i]);
    if (a > peak) peak = a;
    if (a >= 0.99) clipped++;
    sum += f32[i] * f32[i];
  }
  const rms = f32.length ? Math.sqrt(sum / f32.length) : 0;
  return {
    peak: Math.round(peak * 10000) / 10000,
    rms: Math.round(rms * 10000) / 10000,
    peak_dbfs: round2(db(peak)),
    rms_dbfs: round2(db(rms)),
    clipped_fraction: f32.length ? Math.round((clipped / f32.length) * 1e6) / 1e6 : 0,
  };
}

// Takes shorter than this, or with no sound at all, are not saved.
export const MIN_TAKE_SECONDS = 0.8;
export const SILENT_PEAK_DBFS = -45;

// Verdict used by the UI after a take: 'ok' | 'quiet' | 'clipped' | 'empty' | 'silent'.
// 'empty' and 'silent' takes are discarded.
export function qualityVerdict(levels, durationS) {
  if (!(durationS >= MIN_TAKE_SECONDS)) return 'empty';
  if (levels.peak_dbfs < SILENT_PEAK_DBFS) return 'silent';
  if (levels.clipped_fraction > 0.001) return 'clipped';
  if (levels.peak_dbfs < -30 || levels.rms_dbfs < -50) return 'quiet';
  return 'ok';
}

export function encodeWav(int16, sampleRate = TARGET_RATE) {
  const dataBytes = int16.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);              // PCM
  v.setUint16(22, 1, true);              // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);              // block align
  v.setUint16(34, 16, true);             // bits per sample
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  new Int16Array(buf, 44).set(int16);    // little-endian on every supported platform
  return buf;
}

// Minimal parser for the WAVs this app writes (and for tests).
export function decodeWav(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let o = 12;
  let fmt = null;
  while (o + 8 <= u8.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true),
              sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data before fmt');
      const n = Math.floor(size / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(o + 8 + 2 * i, true);
      return { ...fmt, samples };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

// Everything that happens to a take after «إيقاف»: resample to 16 kHz, measure,
// judge, encode. Runs in lib/encode-worker.js (or on the main thread as a fallback).
// Returns { verdict, duration, levels, wav } where wav is null for discarded takes.
export function processTake(samples, sampleRate) {
  const pcm = resample(samples, sampleRate, TARGET_RATE);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
  const duration = pcm.length / TARGET_RATE;
  // levels of the saved 16 kHz file; clipping is judged on the raw microphone input
  const levels = { ...measureLevels(pcm), clipped_fraction: measureLevels(samples).clipped_fraction };
  const verdict = qualityVerdict(levels, duration);
  const keep = verdict !== 'empty' && verdict !== 'silent';
  return { verdict, duration, levels, wav: keep ? encodeWav(floatToInt16(pcm), TARGET_RATE) : null };
}
