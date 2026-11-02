// Dataset logic: ayah order, file names, manifest, export bundle.
import { sanitizeName, splitWords } from './text.js';
import { buildZip } from './zip.js';

export const APP_VERSION = '1.1.0';
export const MODES = ['qalun', 'hafs'];
export const MAX_WORDS = 40;

// FNV-1a 32-bit -> seed; mulberry32 PRNG.
export function hashString(s) {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(s)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Ayah ids (1-based) in recording order for a reader.
// qalun: ayahs with Qalun/Hafs drift words first, then all other ayahs.
// hafs:  only ayahs with drift words (the drill needs a target word).
// Both groups are shuffled with a seed derived from the reader name, and
// ayahs longer than MAX_WORDS words are left out.
export function ayahOrder(data, name, mode) {
  const rand = rng(hashString(sanitizeName(name).toLowerCase()));
  const drift = [];
  const rest = [];
  data.ayahs.forEach(([, , text], i) => {
    const id = i + 1;
    if (splitWords(text).length > MAX_WORDS) return;
    (data.drift[id] ? drift : rest).push(id);
  });
  const first = shuffle(drift, rand);
  return mode === 'hafs' ? first : first.concat(shuffle(rest, rand));
}

const pad3 = (n) => String(n).padStart(3, '0');

export function audioFileName({ name, surah, ayah, mode, take }) {
  return `${sanitizeName(name)}_${pad3(surah)}_${pad3(ayah)}_${mode}_${take}.wav`;
}

export function exportBaseName(name, when = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const d = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}`;
  return `${sanitizeName(name)}_${d}`;
}

// One ayah (in one mode) can have several takes. The kept one is the take the
// reader chose (chosen: true), else the last one (highest take number).
// Returns a Set of the kept recordings' ids (falls back to file name when no id).
const keyOf = (r) => (r.id ?? r.file);
export function keptKeys(recordings) {
  const best = new Map();
  for (const r of recordings) {
    const g = `${r.ayah_id}|${r.mode}`;
    const b = best.get(g);
    const better = !b
      || (!!r.chosen !== !!b.chosen ? !!r.chosen : (r.take - b.take || (r.id ?? 0) - (b.id ?? 0)) > 0);
    if (better) best.set(g, r);
  }
  return new Set([...best.values()].map(keyOf));
}

export function isKept(rec, kept) { return kept.has(keyOf(rec)); }

// Next take number for an ayah: one more than the highest so far.
export function nextTake(recordings, ayahId, mode) {
  return recordings.reduce((m, r) => (r.ayah_id === ayahId && r.mode === mode ? Math.max(m, r.take) : m), 0) + 1;
}

// recordings: stored records (see app.js saveTake) without the audio bytes needed.
export function buildManifest({ profile, recordings, userAgent, capture, exportedAt = new Date() }) {
  const kept = keptKeys(recordings);
  return {
    app: 'qalun-recorder',
    app_version: APP_VERSION,
    format: 1,
    exported_at: exportedAt.toISOString(),
    reader: {
      name: sanitizeName(profile.name),
      age_range: profile.age_range || null,
      gender: profile.gender || null,
    },
    mode: (() => {
      const m = [...new Set(recordings.map((r) => r.mode))];
      return m.length === 1 ? m[0] : m.length === 0 ? profile.mode : 'mixed';
    })(),
    user_agent: userAgent || null,
    capture: capture || null,
    audio_format: { container: 'wav', codec: 'pcm_s16le', sample_rate: 16000, channels: 1 },
    // kept: the take to use for its ayah+mode (the reader's choice, else the last take);
    // other takes of the same ayah are extra attempts.
    files: recordings.map((r) => ({
      file: `audio/${r.file}`,
      surah: r.surah,
      ayah: r.ayah,
      ayah_id: r.ayah_id,
      mode: r.mode,
      take: r.take,
      kept: isKept(r, kept),
      text: r.text,
      drift_words: r.mode === 'hafs'
        ? r.drift.map(([w, qalun, hafs, cls]) => ({ loc: `${r.surah}:${r.ayah}:${w}`, qalun, hafs, class: cls }))
        : [],
      duration_s: r.duration_s,
      sample_rate: r.sample_rate,
      recorded_at: r.recorded_at,
      peak: r.levels.peak,
      rms: r.levels.rms,
      peak_dbfs: r.levels.peak_dbfs,
      rms_dbfs: r.levels.rms_dbfs,
      clipped_fraction: r.levels.clipped_fraction,
      input_sample_rate: r.input_sample_rate,
    })),
  };
}

// Returns { zipName, bytes } for the export ZIP.
export function buildExport({ profile, recordings, userAgent, capture, when = new Date() }) {
  const base = exportBaseName(profile.name, when);
  const sorted = recordings.slice().sort((a, b) => a.ayah_id - b.ayah_id || a.take - b.take);
  const manifest = buildManifest({ profile, recordings: sorted, userAgent, capture, exportedAt: when });
  const files = [{ name: `${base}/manifest.json`, data: JSON.stringify(manifest, null, 2) }];
  for (const r of sorted) files.push({ name: `${base}/audio/${r.file}`, data: r.wav });
  return { zipName: `${base}.zip`, bytes: buildZip(files, when), manifest };
}
