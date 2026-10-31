// Text helpers shared by the app, the build script and the tests.

// Arabic marks (harakat, Quranic annotation signs) plus RLM: removed to get a
// letter skeleton for comparisons that should ignore mark order/encoding.
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u200F]/g;

export function skeleton(s) {
  return String(s).replace(MARKS, '');
}

export function splitWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

const BASMALA_SKELETON = '\u0628\u0633\u0645 \u0627\u0644\u0644\u0647 \u0627\u0644\u0631\u062D\u0645\u0646 \u0627\u0644\u0631\u062D\u064A\u0645';

// The source text prepends the basmala (4 words) to ayah 1 of every surah but 9.
export function stripBasmala(surah, ayah, text) {
  const words = splitWords(text);
  if (ayah === 1 && surah !== 9 && words.length > 4 &&
      skeleton(words.slice(0, 4).join(' ')) === BASMALA_SKELETON) {
    return { text: words.slice(4).join(' '), stripped: true };
  }
  return { text: words.join(' '), stripped: false };
}

// Split an ayah into display tokens; words whose 1-based index is in `drift`
// (array of [word, qalun, hafs, class]) are flagged.
export function highlightTokens(text, drift = []) {
  const byIndex = new Map(drift.map((d) => [d[0], d]));
  return splitWords(text).map((word, i) => {
    const d = byIndex.get(i + 1);
    return d ? { word, index: i + 1, drift: true, qalun: d[1], hafs: d[2], cls: d[3] }
             : { word, index: i + 1, drift: false };
  });
}

// Reader name for filenames: Latin/Arabic letters and digits only.
export function sanitizeName(name) {
  const s = String(name || '')
    .normalize('NFC')
    .replace(MARKS, '')
    .replace(/[^A-Za-z0-9\u0621-\u063A\u0641-\u064A\u0660-\u0669\u0671-\u06D3\u06F0-\u06F9]/g, '')
    .slice(0, 32);
  return s || 'reader';
}

// The Hafs forms come from the DigitalKhatt script, which uses a few code points
// the KFGQPC Qalun font has no glyph for. For display only, map them to the
// closest code point the font has (the manifest keeps the exact Hafs form).
const HAFS_DISPLAY_MAP = {
  '\u0671': '\u0627', // alef wasla -> alef
  '\u08F0': '\u064B', // open fathatan -> fathatan
  '\u08F1': '\u064C', // open dammatan -> dammatan
  '\u08F2': '\u064D', // open kasratan -> kasratan
  '\u065C': '',       // vowel sign dot below
  '\u06DA': '',       // small high jeem (pause mark)
  '\u06ED': '',       // small low meem (iqlab cue)
};

export function hafsDisplay(s) {
  return String(s).replace(/[\u0671\u08F0-\u08F2\u065C\u06DA\u06ED]/g, (c) => HAFS_DISPLAY_MAP[c]);
}
