#!/usr/bin/env node
// Builds data/quran.json from the ertak Qalun data files.
//
//   node scripts/build-data.mjs [path/to/scripts/data/qaloun]
//
// Output (one JSON file, served gzip-compressed by GitHub Pages):
//   { version, surahs: [[id, nameArabic, ayahCount], ...],
//     ayahs: [[surah, ayah, text], ...]            // index + 1 = ayah_id (1..6214)
//     drift: { "<ayah_id>": [[word, qalun, hafs, class, hafs_display?], ...] } }
// hafs_display is present only when the exact Hafs form needs code points the
// Qalun font lacks (see lib/text.js hafsDisplay).
// The basmala that the source prepends to ayah 1 of every surah except 9 is
// stripped here, so word indexes match the farsh table's "s:a:w" locations.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { stripBasmala, splitWords, skeleton, hafsDisplay } from '../lib/text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = 'C:/Users/Mahmoud/Documents/ertak-wt/qalun-finetune/scripts/data/qaloun';
const src = process.argv[2] || DEFAULT_SRC;
const out = path.join(here, '..', 'data', 'quran.json');
const DRIFT_CLASSES = new Set(['consonant', 'hamza', 'long_vowel', 'vowel']);

const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(src, 'ayah_text.json.gz'))));
const surahs = JSON.parse(fs.readFileSync(path.join(src, 'surahs.json'), 'utf8'));
const farsh = JSON.parse(fs.readFileSync(path.join(src, 'farsh.hafs.json'), 'utf8'));

if (raw.length !== 6214) throw new Error(`expected 6214 ayahs, got ${raw.length}`);
const ayahs = [];
const idOf = new Map();
let stripped = 0;
raw.forEach((x, i) => {
  if (i > 0) {
    const p = raw[i - 1];
    if (!(x.s > p.s || (x.s === p.s && x.a === p.a + 1))) throw new Error(`order break at ${x.s}:${x.a}`);
  }
  const r = stripBasmala(x.s, x.a, x.t);
  if (r.stripped) stripped++;
  ayahs.push([x.s, x.a, r.text]);
  idOf.set(`${x.s}:${x.a}`, i + 1);
});
if (stripped !== 113) throw new Error(`expected 113 basmalas stripped, got ${stripped}`);

const drift = {};
let kept = 0;
for (const row of farsh.rows) {
  if (!DRIFT_CLASSES.has(row.class)) continue;
  const [s, a, w] = row.loc.split(':').map(Number);
  const id = idOf.get(`${s}:${a}`);
  const word = splitWords(ayahs[id - 1][2])[w - 1];
  if (!word || skeleton(word) !== skeleton(row.qalun)) {
    throw new Error(`farsh ${row.loc}: word "${word}" != "${row.qalun}"`);
  }
  const shown = hafsDisplay(row.hafs);
  (drift[id] ||= []).push(shown === row.hafs ? [w, row.qalun, row.hafs, row.class] : [w, row.qalun, row.hafs, row.class, shown]);
  kept++;
}

const data = {
  version: 1,
  source: 'KFGQPC Qalun text (ertak scripts/data/qaloun); drift table farsh.hafs.json',
  surahs: surahs.map((s) => [s.id, s.nameArabic, s.ayahCount]),
  ayahs,
  drift,
};
fs.writeFileSync(out, JSON.stringify(data));
const size = fs.statSync(out).size;
const gz = zlib.gzipSync(fs.readFileSync(out)).length;
console.log(`wrote ${out}: ${ayahs.length} ayahs, ${kept} drift words in ${Object.keys(drift).length} ayahs, ${size} B (${gz} B gzip)`);
