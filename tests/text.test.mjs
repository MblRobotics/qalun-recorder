import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripBasmala, highlightTokens, sanitizeName, splitWords, skeleton } from '../lib/text.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/quran.json', import.meta.url)));
const BASMALA = 'بِسْمِ اِ۬للَّهِ اِ۬لرَّحْمَٰنِ اِ۬لرَّحِيمِ';

test('stripBasmala removes the 4 basmala words from ayah 1 (not surah 9, not other ayahs)', () => {
  assert.deepEqual(stripBasmala(2, 1, `${BASMALA} أَلَٓمِّٓۖ`), { text: 'أَلَٓمِّٓۖ', stripped: true });
  // the source orders shadda/fatha differently; still recognised by skeleton
  const src = 'بِسْمِ اِ۬للَّهِ اِ۬لرَّحْمَٰنِ اِ۬لرَّحِيمِ اِ۬لْحَمْدُ لِلهِ';
  assert.equal(stripBasmala(1, 1, src).text, 'اِ۬لْحَمْدُ لِلهِ');
  assert.equal(stripBasmala(9, 1, `${BASMALA} بَرَآءَةٞ`).stripped, false);
  assert.equal(stripBasmala(27, 30, `إِنَّهُۥ مِن سُلَيْمَٰنَ وَإِنَّهُۥ ${BASMALA}`).stripped, false);
  assert.equal(stripBasmala(2, 2, `${BASMALA} ذَٰلِكَ`).stripped, false);
});

test('built data: 6214 ayahs, no ayah 1 starts with the basmala, mushaf order', () => {
  assert.equal(data.ayahs.length, 6214);
  assert.deepEqual(data.ayahs[0].slice(0, 2), [1, 1]);
  assert.deepEqual(data.ayahs[6213].slice(0, 2), [114, 6]);
  for (const [s, a, t] of data.ayahs) {
    if (a === 1) assert.ok(!/^بِ+ّ?سْمِ/.test(t) && !t.startsWith('بِسْمِ') && !t.startsWith('بِّسْمِ'), `${s}:${a}`);
  }
  assert.equal(skeleton(data.ayahs[0][2]), 'الحمد لله رب العلمين');
  assert.equal(data.surahs.length, 114);
  assert.equal(data.surahs.reduce((n, s) => n + s[2], 0), 6214);
});

test('highlightTokens flags the drift words at their 1-based index', () => {
  // 1:3 is «مَلِكِ يَوْمِ اِ۬لدِّينِ»; word 1 is read «مَٰلِكِ» by Hafs
  const id = data.ayahs.findIndex(([s, a]) => s === 1 && a === 3) + 1;
  const drift = data.drift[id];
  assert.deepEqual(drift, [[1, 'مَلِكِ', 'مَٰلِكِ', 'long_vowel']]);
  const toks = highlightTokens(data.ayahs[id - 1][2], drift);
  assert.equal(toks.length, 3);
  assert.deepEqual(toks.filter((t) => t.drift).map((t) => [t.index, t.word, t.hafs]), [[1, 'مَلِكِ', 'مَٰلِكِ']]);
  assert.ok(toks.slice(1).every((t) => !t.drift));
});

test('every drift entry points at a word that exists in its ayah', () => {
  let n = 0;
  for (const [id, rows] of Object.entries(data.drift)) {
    const words = splitWords(data.ayahs[id - 1][2]);
    const t = highlightTokens(data.ayahs[id - 1][2], rows);
    assert.equal(t.filter((x) => x.drift).length, new Set(rows.map((r) => r[0])).size);
    for (const [w, qalun, hafs, cls] of rows) {
      assert.ok(w >= 1 && w <= words.length, `${id}:${w}`);
      assert.ok(qalun && hafs, `${id}:${w}`);
      assert.ok(['consonant', 'hamza', 'long_vowel', 'vowel'].includes(cls));
      n++;
    }
  }
  assert.equal(n, 1467);
});

test('sanitizeName keeps Latin/Arabic letters and digits only', () => {
  assert.equal(sanitizeName('Abu Muhammad_1!'), 'AbuMuhammad1');
  assert.equal(sanitizeName('أبو محمّدٍ ٣'), 'أبومحمد٣');
  assert.equal(sanitizeName('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizeName('   '), 'reader');
  assert.equal(sanitizeName('😀'), 'reader');
  assert.equal(sanitizeName('a'.repeat(50)).length, 32);
});

test('hafsDisplay maps code points missing from the Qalun font, data keeps the exact form', async () => {
  const { hafsDisplay } = await import('../lib/text.js');
  const missing = /[ٱࣰ-ࣲٜۭۚ]/;
  let mapped = 0;
  for (const rows of Object.values(data.drift)) {
    for (const r of rows) {
      const shown = r[4] || r[2];
      assert.ok(!missing.test(shown), shown);
      assert.equal(hafsDisplay(r[2]), shown);
      if (r[4]) { mapped++; assert.ok(missing.test(r[2])); }
    }
  }
  assert.ok(mapped > 0);
  assert.equal(hafsDisplay('ٱلْ'), 'الْ');
});
