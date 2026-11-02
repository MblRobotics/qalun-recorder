import test from 'node:test';
import assert from 'node:assert/strict';
import { resample, floatToInt16, encodeWav, decodeWav, measureLevels, qualityVerdict, processTake, MIN_TAKE_SECONDS } from '../lib/wav.js';

const sine = (freq, rate, secs, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * secs) }, (_, i) => amp * Math.sin(2 * Math.PI * freq * i / rate));

// Amplitude of one frequency component (single-bin DFT) over the middle 80 % of the signal.
function toneAmp(x, freq, rate) {
  const a = Math.floor(x.length * 0.1);
  const b = Math.floor(x.length * 0.9);
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    re += x[i] * Math.cos(2 * Math.PI * freq * i / rate);
    im += x[i] * Math.sin(2 * Math.PI * freq * i / rate);
  }
  return 2 * Math.hypot(re, im) / (b - a);
}

for (const inRate of [48000, 44100, 22050, 16000]) {
  test(`resample ${inRate} -> 16000 keeps a 1 kHz tone (length, frequency, amplitude)`, () => {
    const out = resample(sine(1000, inRate, 1), inRate, 16000);
    assert.ok(Math.abs(out.length - 16000) <= 1, `length ${out.length}`);
    assert.ok(Math.abs(toneAmp(out, 1000, 16000) - 0.5) < 0.01, `amp ${toneAmp(out, 1000, 16000)}`);
    assert.ok(toneAmp(out, 1100, 16000) < 0.01, 'energy leaked to 1.1 kHz');
  });
}

test('resample keeps 6 kHz (below Nyquist) and removes 12 kHz (would alias to 4 kHz)', () => {
  const out6 = resample(sine(6000, 48000, 1, 0.4), 48000, 16000);
  const out12 = resample(sine(12000, 48000, 1, 0.4), 48000, 16000);
  assert.ok(toneAmp(out6, 6000, 16000) > 0.35, `6 kHz amp ${toneAmp(out6, 6000, 16000)}`);
  assert.ok(toneAmp(out12, 4000, 16000) < 0.004, `alias amp ${toneAmp(out12, 4000, 16000)}`);
});

test('floatToInt16 clamps and scales', () => {
  assert.deepEqual(Array.from(floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))),
    [0, 32767, -32768, 32767, -32768, 16384]);
});

test('encodeWav writes a 16 kHz mono 16-bit PCM WAV that round-trips', () => {
  const pcm = floatToInt16(sine(440, 16000, 0.25));
  const buf = encodeWav(pcm, 16000);
  const u8 = new Uint8Array(buf);
  const v = new DataView(buf);
  assert.equal(String.fromCharCode(...u8.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint32(4, true), buf.byteLength - 8);
  assert.equal(String.fromCharCode(...u8.slice(8, 16)), 'WAVEfmt ');
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000);
  assert.equal(v.getUint16(32, true), 2);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), pcm.length * 2);
  const d = decodeWav(buf);
  assert.equal(d.sampleRate, 16000);
  assert.equal(d.channels, 1);
  assert.equal(d.bits, 16);
  assert.deepEqual(Array.from(d.samples), Array.from(pcm));
});

test('measureLevels and qualityVerdict', () => {
  const l = measureLevels(sine(1000, 16000, 1, 0.5));
  assert.ok(Math.abs(l.peak - 0.5) < 1e-3);
  assert.ok(Math.abs(l.rms - 0.5 / Math.SQRT2) < 1e-3);
  assert.ok(Math.abs(l.peak_dbfs - -6.02) < 0.05);
  assert.equal(qualityVerdict(l, 1), 'ok');
  assert.equal(qualityVerdict(measureLevels(sine(1000, 16000, 1, 0.01)), 1), 'quiet');
  const clipped = sine(1000, 16000, 1, 1.5).map((x) => Math.max(-1, Math.min(1, x)));
  assert.equal(qualityVerdict(measureLevels(clipped), 1), 'clipped');
  assert.equal(qualityVerdict(l, 0.2), 'empty');
  assert.equal(qualityVerdict(l, 0.79), 'empty');
  assert.equal(qualityVerdict(l, MIN_TAKE_SECONDS), 'ok');
  assert.equal(qualityVerdict(measureLevels(sine(1000, 16000, 1, 0.003)), 1), 'silent');
  assert.equal(qualityVerdict(measureLevels(new Float32Array(16000)), 1), 'silent');
  assert.equal(measureLevels(new Float32Array(10)).rms_dbfs, -120);
});

// The straightforward per-sample kernel (the resampler before the polyphase cache).
function resampleReference(input, inRate, outRate, halfTaps = 16) {
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  const fc = Math.min(1, outRate / inRate) * 0.95;
  const half = Math.ceil(halfTaps / fc);
  for (let n = 0; n < out.length; n++) {
    const t = n * ratio;
    const center = Math.floor(t);
    let acc = 0;
    let wsum = 0;
    for (let k = Math.max(0, center - half + 1); k <= Math.min(input.length - 1, center + half); k++) {
      const x = t - k;
      const u = fc * x;
      const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * x / half) + 0.08 * Math.cos(2 * Math.PI * x / half);
      acc += input[k] * fc * sinc * w;
      wsum += fc * sinc * w;
    }
    out[n] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}

for (const inRate of [48000, 44100, 22050, 47999]) {
  test(`polyphase resample ${inRate} matches the per-sample reference`, () => {
    const x = Float32Array.from({ length: Math.round(inRate * 0.3) }, (_, i) => 0.4 * Math.sin(i / 7) + 0.2 * Math.sin(i / 2.3));
    const a = resample(x, inRate, 16000);
    const b = resampleReference(x, inRate, 16000);
    assert.equal(a.length, b.length);
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    assert.ok(maxDiff < 1e-5, `max diff ${maxDiff}`);
  });
}

test('resample of 30 s at 48 kHz is fast (stop must not freeze the phone)', () => {
  const x = sine(300, 48000, 30, 0.3);
  const t0 = performance.now();
  const out = resample(x, 48000, 16000);
  const ms = performance.now() - t0;
  assert.equal(out.length, 480000);
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
});

test('processTake: keeps a real take as a 16 kHz WAV, drops short or silent takes', () => {
  const ok = processTake(sine(500, 48000, 2, 0.3), 48000);
  assert.equal(ok.verdict, 'ok');
  assert.ok(Math.abs(ok.duration - 2) < 1e-3);
  const w = decodeWav(ok.wav);
  assert.deepEqual([w.sampleRate, w.channels, w.samples.length], [16000, 1, 32000]);
  const short = processTake(sine(500, 48000, 0.5, 0.3), 48000);
  assert.deepEqual([short.verdict, short.wav], ['empty', null]);
  const silent = processTake(new Float32Array(48000 * 2), 48000);
  assert.deepEqual([silent.verdict, silent.wav], ['silent', null]);
});
