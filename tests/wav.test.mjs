import test from 'node:test';
import assert from 'node:assert/strict';
import { resample, floatToInt16, encodeWav, decodeWav, measureLevels, qualityVerdict } from '../lib/wav.js';

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
  assert.equal(measureLevels(new Float32Array(10)).rms_dbfs, -120);
});
