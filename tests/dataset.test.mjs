import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ayahOrder, audioFileName, exportBaseName, buildManifest, buildExport, MAX_WORDS } from '../lib/dataset.js';
import { splitWords } from '../lib/text.js';
import { readZip } from '../lib/zip.js';
import { encodeWav, decodeWav, floatToInt16, measureLevels } from '../lib/wav.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/quran.json', import.meta.url)));
const words = (id) => splitWords(data.ayahs[id - 1][2]).length;

test('qalun order: drift ayahs first, then the rest; none over 40 words; no repeats', () => {
  const o = ayahOrder(data, 'Ahmad', 'qalun');
  assert.equal(new Set(o).size, o.length);
  assert.ok(o.every((id) => words(id) <= MAX_WORDS));
  const eligible = data.ayahs.filter(([, , t]) => splitWords(t).length <= MAX_WORDS).length;
  assert.equal(o.length, eligible);
  const nDrift = o.filter((id) => data.drift[id]).length;
  assert.equal(nDrift, 1130);
  assert.ok(o.slice(0, nDrift).every((id) => data.drift[id]));
  assert.ok(o.slice(nDrift).every((id) => !data.drift[id]));
});

test('order is deterministic per name and differs between names', () => {
  assert.deepEqual(ayahOrder(data, 'Ahmad', 'qalun'), ayahOrder(data, 'Ahmad', 'qalun'));
  assert.deepEqual(ayahOrder(data, 'Ahmad!', 'qalun'), ayahOrder(data, 'ahmad', 'qalun'));
  assert.notDeepEqual(ayahOrder(data, 'Ahmad', 'qalun').slice(0, 20), ayahOrder(data, 'Bilal', 'qalun').slice(0, 20));
  const head = ayahOrder(data, 'Ahmad', 'qalun').slice(0, 50);
  assert.notDeepEqual(head, head.slice().sort((a, b) => a - b), 'not shuffled');
});

test('hafs drill order contains only ayahs with drift words', () => {
  const o = ayahOrder(data, 'Ahmad', 'hafs');
  assert.equal(o.length, 1130);
  assert.ok(o.every((id) => data.drift[id]));
});

test('file names', () => {
  assert.equal(audioFileName({ name: 'Abu Ali', surah: 2, ayah: 5, mode: 'hafs', take: 1 }), 'AbuAli_002_005_hafs_1.wav');
  assert.equal(audioFileName({ name: 'علي', surah: 114, ayah: 6, mode: 'qalun', take: 2 }), 'علي_114_006_qalun_2.wav');
  assert.equal(exportBaseName('Abu Ali', new Date(2026, 9, 31, 9, 5)), 'AbuAli_20261031-0905');
});

function fakeRec(id, mode, take = 1) {
  const [s, a, text] = data.ayahs[id - 1];
  const f32 = Float32Array.from({ length: 1600 }, (_, i) => 0.3 * Math.sin(i / 3));
  return {
    id: id * 10 + take, surah: s, ayah: a, ayah_id: id, mode, take, text,
    drift: data.drift[id] || [],
    file: audioFileName({ name: 'Abu Ali', surah: s, ayah: a, mode, take }),
    duration_s: 0.1, sample_rate: 16000, input_sample_rate: 48000,
    recorded_at: '2026-10-31T10:00:00.000Z', levels: measureLevels(f32),
    wav: encodeWav(floatToInt16(f32), 16000),
  };
}

test('manifest shape (hafs drill lists targeted drift words with loc)', () => {
  const id = data.ayahs.findIndex(([s, a]) => s === 1 && a === 3) + 1;
  const m = buildManifest({
    profile: { name: 'Abu Ali', age_range: '30-44', gender: null, mode: 'hafs' },
    recordings: [fakeRec(id, 'hafs')], userAgent: 'UA', capture: { context_sample_rate: 48000 },
    exportedAt: new Date('2026-10-31T10:00:00Z'),
  });
  assert.equal(m.app_version, '1.0.0');
  assert.deepEqual(m.reader, { name: 'AbuAli', age_range: '30-44', gender: null });
  assert.equal(m.mode, 'hafs');
  assert.equal(m.user_agent, 'UA');
  assert.deepEqual(m.capture, { context_sample_rate: 48000 });
  const f = m.files[0];
  assert.deepEqual(Object.keys(f).sort(), ['ayah', 'ayah_id', 'clipped_fraction', 'drift_words', 'duration_s', 'file',
    'input_sample_rate', 'mode', 'peak', 'peak_dbfs', 'recorded_at', 'rms', 'rms_dbfs', 'sample_rate', 'surah', 'take', 'text'].sort());
  assert.equal(f.file, 'audio/AbuAli_001_003_hafs_1.wav');
  assert.deepEqual([f.surah, f.ayah, f.ayah_id, f.sample_rate], [1, 3, 3, 16000]);
  assert.deepEqual(f.drift_words, [{ loc: '1:3:1', qalun: 'مَلِكِ', hafs: 'مَٰلِكِ', class: 'long_vowel' }]);
  const q = buildManifest({ profile: { name: 'x', mode: 'qalun' }, recordings: [fakeRec(id, 'qalun')] });
  assert.deepEqual(q.files[0].drift_words, []);
  assert.equal(q.reader.age_range, null);
  const mixed = buildManifest({ profile: { name: 'x', mode: 'qalun' }, recordings: [fakeRec(id, 'qalun'), fakeRec(id, 'hafs')] });
  assert.equal(mixed.mode, 'mixed');
});

test('buildExport ZIP layout: <name>_<date>/manifest.json + audio/*.wav, manifest consistent', () => {
  const recs = [fakeRec(3, 'qalun'), fakeRec(1, 'qalun'), fakeRec(1, 'qalun', 2)];
  const when = new Date(2026, 9, 31, 9, 5);
  const { zipName, bytes } = buildExport({ profile: { name: 'Abu Ali', mode: 'qalun' }, recordings: recs, userAgent: 'UA', when });
  assert.equal(zipName, 'AbuAli_20261031-0905.zip');
  const entries = readZip(bytes);
  assert.deepEqual(entries.map((e) => e.name), [
    'AbuAli_20261031-0905/manifest.json',
    'AbuAli_20261031-0905/audio/AbuAli_001_001_qalun_1.wav',
    'AbuAli_20261031-0905/audio/AbuAli_001_001_qalun_2.wav',
    'AbuAli_20261031-0905/audio/AbuAli_001_003_qalun_1.wav',
  ]);
  const m = JSON.parse(new TextDecoder().decode(entries[0].data));
  assert.equal(m.files.length, 3);
  for (const f of m.files) {
    const e = entries.find((x) => x.name === `AbuAli_20261031-0905/${f.file}`);
    const w = decodeWav(e.data);
    assert.equal(w.sampleRate, 16000);
    assert.equal(w.samples.length / 16000, f.duration_s);
  }
});
