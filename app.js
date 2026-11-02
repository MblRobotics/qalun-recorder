import { highlightTokens, sanitizeName } from './lib/text.js';
import { TARGET_RATE, MIN_TAKE_SECONDS } from './lib/wav.js';
import { encodeTake, encoderPath } from './lib/encoder.js';
import { ayahOrder, audioFileName, buildExport, keptKeys, isKept, nextTake, APP_VERSION } from './lib/dataset.js';
import { store } from './lib/store.js';
import { Recorder } from './lib/recorder.js';

const $ = (id) => document.getElementById(id);
const MAX_SECONDS = 90;
const TAP_CALM_MS = 600;
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ar = (n) => String(n).replace(/[0-9]/g, (d) => AR_DIGITS[d]);

const state = {
  data: null,
  profile: null,
  order: [],
  pos: 0,
  current: null,      // stored recording for the shown ayah (or null)
  recordings: [],     // metadata of all stored recordings (no audio bytes)
  recorder: new Recorder(),
  busy: false,        // starting or saving a take: the record button ignores taps
  calmUntil: 0,       // extra taps right after a save must not land on the buttons that moved up
  recStart: 0,
  timer: null,
  lowSince: 0,
  clippedLive: false,
  audio: null,
  wakeLock: null,
  pendingAfterMic: null,
};

// ---------- screens ----------
function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
  window.scrollTo(0, 0);
}

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function openHelp() {
  const d = $('help');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

// ---------- data ----------
async function loadData() {
  const res = await fetch('data/quran.json');
  if (!res.ok) throw new Error(`data ${res.status}`);
  return res.json();
}

const progressKey = (p) => `progress:${sanitizeName(p.name).toLowerCase()}|${p.mode}`;

async function refreshRecordings() {
  state.recordings = (await store.allRecordings()).sort((x, y) => x.id - y.id);
  const kept = keptRecordings();
  const n = kept.length;
  const mins = kept.reduce((s, r) => s + r.duration_s, 0) / 60;
  $('stat-count').textContent = ar(n);
  $('stat-min').textContent = ar(mins.toFixed(1)).replace('.', '٫');
}

// ---------- setup ----------
function fillSetup(p) {
  if (!p) return;
  $('in-name').value = p.display_name || p.name || '';
  $('in-age').value = p.age_range || '';
  $('in-gender').value = p.gender || '';
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === p.mode;
}

async function onSetupSubmit(ev) {
  ev.preventDefault();
  const display = $('in-name').value.trim();
  if (!display) { $('in-name').focus(); return; }
  const mode = document.querySelector('input[name=mode]:checked').value;
  const profile = {
    display_name: display,
    name: sanitizeName(display),
    age_range: $('in-age').value || null,
    gender: $('in-gender').value || null,
    mode,
  };
  state.profile = profile;
  await store.setMeta('profile', profile);
  store.persist();
  if (state.recorder.ctx) await enterRecording();
  else showMicIntro();
}

function showMicIntro() {
  $('mic-error').hidden = true;
  show('mic');
}

// ---------- microphone ----------
async function ensureMic() {
  const r = state.recorder;
  if (r.ctx && r.ctx.state === 'running' && r.stream && r.stream.active) return true; // start without delay
  try {
    await state.recorder.init();
    await store.setMeta('capture', {
      context_sample_rate: state.recorder.sampleRate,
      track_settings: state.recorder.settings,
    });
    return true;
  } catch (e) {
    showMicError(e);
    return false;
  }
}

function showMicError(e) {
  const el = $('mic-error');
  let msg;
  if (!window.isSecureContext) {
    msg = 'يجب فتح الصفحة عبر رابط https.';
  } else if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
    msg = 'لم يُسمح باستخدام الميكروفون. افتح إعدادات المتصفح ← أذونات الموقع ← الميكروفون، واختر «سماح»، ثم أعد تحميل الصفحة.';
  } else if (e && e.name === 'NotFoundError') {
    msg = 'لم نجد ميكروفونًا في هذا الجهاز.';
  } else if (e && e.name === 'NotSupportedError') {
    msg = 'هذا المتصفح لا يدعم التسجيل. افتح الرابط في Chrome أو Safari (وليس من داخل واتساب أو فيسبوك).';
  } else {
    msg = `تعذّر تشغيل الميكروفون (${e && e.name ? e.name : e}). أغلق التطبيقات الأخرى التي تستعمل الميكروفون وحاول مرة أخرى.`;
  }
  el.textContent = msg;
  el.hidden = false;
  show('mic');
}

// ---------- recording screen ----------
async function enterRecording() {
  const p = state.profile;
  state.order = ayahOrder(state.data, p.name, p.mode);
  state.pos = Math.min((await store.getMeta(progressKey(p))) || 0, Math.max(0, state.order.length - 1));
  await refreshRecordings();
  const badge = $('mode-badge');
  badge.textContent = p.mode === 'hafs' ? 'تمرين حفص: اقرأ الكلمة الملوّنة برواية حفص' : 'أقرأ بقالون';
  badge.className = `badge ${p.mode}`;
  renderAyah();
  show('record');
  if (!(await store.getMeta('helpSeen'))) {
    await store.setMeta('helpSeen', true);
    openHelp();
  }
}

function currentAyahId() { return state.order[state.pos]; }

function renderAyah() {
  const id = currentAyahId();
  const [s, a, text] = state.data.ayahs[id - 1];
  const surah = state.data.surahs[s - 1];
  $('surah-name').textContent = `سورة ${surah[1]}`;
  $('ayah-ref').textContent = `السورة ${ar(s)} · الآية ${ar(a)}`;
  const drift = state.profile.mode === 'hafs' ? (state.data.drift[id] || []) : [];
  const box = $('ayah');
  box.textContent = '';
  highlightTokens(text, drift).forEach((t, i) => {
    if (i) box.append(' ');
    const span = document.createElement('span');
    span.className = t.drift ? 'w drift' : 'w';
    span.textContent = t.word;
    box.append(span);
  });
  const hint = $('hafs-hint');
  hint.textContent = '';
  if (drift.length) {
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = 'اقرأ برواية حفص:';
    hint.append(lbl);
    for (const [, qalun, hafs, , shown] of drift) {
      const row = document.createElement('div');
      row.className = 'pair';
      const say = document.createElement('span'); say.className = 'say'; say.textContent = 'قل';
      const h = document.createElement('span'); h.className = 'q quran'; h.textContent = shown || hafs;
      const not = document.createElement('span'); not.className = 'not'; not.textContent = 'بدل';
      const q = document.createElement('span'); q.className = 'q quran'; q.textContent = qalun;
      row.append(say, h, not, q);
      hint.append(row);
    }
  }
  hint.hidden = !drift.length;
  state.current = latestTake(id);
  setMeter(0);
  setStatus(state.current ? 'تم تسجيل هذه الآية.' : '');
  updateButtons();
}

// The take of each ayah that counts (the reader's choice, else the last one).
function keptRecordings() {
  const kept = keptKeys(state.recordings);
  return state.recordings.filter((r) => isKept(r, kept));
}

function latestTake(id) {
  const takes = state.recordings.filter((r) => r.ayah_id === id && r.mode === state.profile.mode);
  if (!takes.length) return null;
  const kept = keptKeys(takes);
  return takes.find((r) => isKept(r, kept));
}

function updateButtons() {
  const busy = state.busy;
  const rec = state.recorder.recording || busy;
  const has = !!state.current;
  const b = $('btn-record');
  b.classList.toggle('on', state.recorder.recording);
  b.classList.toggle('busy', busy);
  b.disabled = busy;
  b.setAttribute('aria-busy', busy ? 'true' : 'false');
  b.querySelector('.lbl').textContent = busy && !state.recorder.recording
    ? 'جارٍ الحفظ…' : state.recorder.recording ? 'إيقاف' : 'سجّل';
  b.hidden = has && !rec;
  $('btn-play').disabled = rec || !has;
  $('btn-redo').disabled = rec || !has;
  $('btn-next').disabled = rec || !has;
  $('btn-skip').disabled = rec;
  $('btn-skip').hidden = has;
  for (const el of document.querySelectorAll('.foot .btn')) el.disabled = rec;
}

function setMeter(level) {
  // level: linear peak 0..1, shown on a dB scale from -60 to 0 dBFS
  const dbv = level > 0 ? 20 * Math.log10(level) : -60;
  const pct = Math.max(0, Math.min(100, ((dbv + 60) / 60) * 100));
  const bar = $('meter-bar');
  bar.style.width = `${pct}%`;
  bar.classList.toggle('hot', level >= 0.99);
  bar.classList.toggle('low', state.recorder.recording && dbv < -40);
}

async function startRecording() {
  if (state.busy || state.recorder.recording) return;
  state.busy = true; // a second tap while the microphone starts must not start twice
  let ok = false;
  try { ok = await ensureMic(); } finally { state.busy = false; }
  if (!ok || state.recorder.recording) return;
  show('record');
  stopPlayback();
  state.lowSince = performance.now();
  state.clippedLive = false;
  state.recStart = performance.now();
  state.recorder.start((chunk) => {
    let peak = 0;
    for (let i = 0; i < chunk.length; i++) { const v = Math.abs(chunk[i]); if (v > peak) peak = v; }
    setMeter(peak);
    const now = performance.now();
    if (peak >= 0.99) state.clippedLive = true;
    if (peak > 0.03) state.lowSince = now; // about -30 dBFS
    const secs = (now - state.recStart) / 1000;
    if (state.clippedLive) setStatus('الصوت عالٍ جدًا: أبعِد الهاتف قليلاً.', 'bad');
    else if (now - state.lowSince > 2000) setStatus('الصوت منخفض: اقترب من الهاتف أو ارفع صوتك.', 'warn');
    else setStatus(`جارٍ التسجيل… ${ar(Math.floor(secs))} ث`, 'good');
    if (secs >= MAX_SECONDS) stopRecording();
  });
  try { state.wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { /* optional */ }
  updateButtons();
}

async function stopRecording() {
  // Only the first «إيقاف» counts: while the take is being saved the button is
  // disabled and further taps (or the timer / page-hide) are ignored.
  if (!state.recorder.recording || state.busy) return;
  state.busy = true;
  const { samples, sampleRate } = state.recorder.stop();
  try { state.wakeLock?.release(); } catch (e) { /* ignore */ }
  state.wakeLock = null;
  setMeter(0);
  setStatus('جارٍ الحفظ…');
  updateButtons();
  try {
    await saveTake(samples, sampleRate);
  } finally {
    state.busy = false;
    state.calmUntil = performance.now() + TAP_CALM_MS;
    updateButtons();
  }
}

// True while a tap should be ignored: a take is starting/saving, or one was just saved
// (the record button disappears and «أعد التسجيل» moves under the reader's finger).
function tapBlocked() {
  return state.busy || performance.now() < state.calmUntil;
}

async function saveTake(samples, sampleRate) {
  if (samples.length < MIN_TAKE_SECONDS * sampleRate) {
    setStatus('التسجيل قصير جدًا فلم يُحفظ. اضغط «سجّل» واقرأ الآية كاملة.', 'warn');
    return;
  }
  let res;
  try {
    res = await encodeTake(samples, sampleRate);
  } catch (e) {
    setStatus(`تعذّر تجهيز التسجيل (${e && e.message}). حاول مرة أخرى.`, 'bad');
    return;
  }
  const { verdict, duration, levels, wav } = res;
  if (verdict === 'empty') {
    setStatus('التسجيل قصير جدًا فلم يُحفظ. اضغط «سجّل» واقرأ الآية كاملة.', 'warn');
    return;
  }
  if (verdict === 'silent') {
    setStatus('لم يُسمع صوت في التسجيل فلم يُحفظ. تأكّد أن الميكروفون يعمل واقترب من الهاتف، ثم اضغط «سجّل».', 'warn');
    return;
  }
  const id = currentAyahId();
  const [s, a, text] = state.data.ayahs[id - 1];
  const mode = state.profile.mode;
  const take = nextTake(state.recordings, id, mode);
  const rec = {
    reader: state.profile.name,
    surah: s, ayah: a, ayah_id: id, mode, take, text,
    drift: state.data.drift[id] || [],
    file: audioFileName({ name: state.profile.name, surah: s, ayah: a, mode, take }),
    duration_s: Math.round(duration * 1000) / 1000,
    sample_rate: TARGET_RATE,
    input_sample_rate: sampleRate,
    recorded_at: new Date().toISOString(),
    levels,
    wav,
  };
  try {
    rec.id = await store.addRecording(rec);
  } catch (e) {
    setStatus(`تعذّر الحفظ في الهاتف: ${e && e.name}. قد تكون الذاكرة ممتلئة.`, 'bad');
    return;
  }
  await refreshRecordings();
  state.current = latestTake(id);
  const msg = {
    ok: ['حُفظ التسجيل. استمع إليه إن شئت، ثم اضغط «التالي».', 'good'],
    quiet: ['الصوت منخفض جدًا. يُفضَّل أن تعيد التسجيل وأنت أقرب إلى الهاتف.', 'warn'],
    clipped: ['الصوت عالٍ ومشوَّش. يُفضَّل أن تعيد التسجيل والهاتف أبعد قليلاً.', 'bad'],
  }[verdict];
  setStatus(msg[0], msg[1]);
}

async function onRecordButton() {
  if (tapBlocked()) return;
  if (state.recorder.recording) await stopRecording();
  else await startRecording();
}

function stopPlayback() {
  if (state.audio) {
    state.audio.pause();
    URL.revokeObjectURL(state.audio.src);
    state.audio = null;
  }
}

async function onPlay() {
  if (!state.current || tapBlocked()) return;
  stopPlayback();
  const wav = await store.getAudio(state.current.id);
  if (!wav) return;
  state.audio = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
  state.audio.play().catch(() => setStatus('تعذّر تشغيل الصوت.', 'bad'));
}

async function onRedo() {
  if (!state.current || tapBlocked() || state.recorder.recording) return;
  stopPlayback();
  await store.deleteRecording(state.current.id);
  await refreshRecordings();
  state.current = null;
  await startRecording();
}

async function advance() {
  if (tapBlocked() || state.recorder.recording) return;
  stopPlayback();
  if (state.pos >= state.order.length - 1) {
    setStatus('وصلت إلى آخر آية في القائمة. جزاك الله خيرًا! أرسل تسجيلاتك.', 'good');
    return;
  }
  state.pos += 1;
  await store.setMeta(progressKey(state.profile), state.pos);
  renderAyah();
  window.scrollTo(0, 0);
}

// ---------- export ----------
async function enterExport() {
  stopPlayback();
  await refreshRecordings();
  const kept = keptRecordings();
  const n = kept.length;
  const mins = kept.reduce((s, r) => s + r.duration_s, 0) / 60;
  $('export-summary').textContent = n
    ? `لديك ${ar(n)} تسجيلًا (${ar(mins.toFixed(1)).replace('.', '٫')} دقيقة).`
    : 'لا توجد تسجيلات بعد.';
  let canShareZip = false;
  try {
    canShareZip = !!(navigator.share && navigator.canShare &&
      navigator.canShare({ files: [new File(['x'], 'x.zip', { type: 'application/zip' })] }));
  } catch (e) { canShareZip = false; }
  $('btn-share').hidden = !canShareZip;
  $('btn-share').disabled = true;
  $('btn-download').disabled = true;
  $('export-confirm').hidden = true;
  setExportStatus(canShareZip ? '' : 'اضغط «تنزيل الملف»، ثم أرسله من مجلد التنزيلات (في واتساب: إرفاق ← مستند).');
  show('export');
  state.exportFile = null;
  if (!n) return;
  // Build the ZIP now, so the share call happens directly in the tap (browsers require it).
  state.exportFile = await makeExportFile();
  $('btn-share').disabled = false;
  $('btn-download').disabled = false;
}

async function makeExportFile() {
  const all = await store.allWithAudio();
  const capture = (await store.getMeta('capture')) || null;
  const { zipName, bytes } = buildExport({
    profile: state.profile, recordings: all, userAgent: navigator.userAgent, capture,
  });
  state.pendingExportIds = all.map((r) => r.id);
  return new File([bytes], zipName, { type: 'application/zip' });
}

function setExportStatus(text, kind = '') {
  const el = $('export-status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function onShare() {
  const file = state.exportFile;
  if (!file) return;
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    setExportStatus('هذا المتصفح لا يسمح بمشاركة ملف ZIP مباشرة. استعمل «تنزيل الملف» ثم أرسله من مجلد التنزيلات (في واتساب: إرفاق ← مستند).', 'warn');
    return;
  }
  try {
    await navigator.share({ files: [file], title: file.name });
    setExportStatus('');
    $('export-confirm').hidden = false;
  } catch (e) {
    if (e && e.name === 'AbortError') setExportStatus('أُلغيت المشاركة.');
    else setExportStatus(`تعذّرت المشاركة (${e && e.name}). جرّب «تنزيل الملف».`, 'bad');
  }
}

function onDownload() {
  const file = state.exportFile;
  if (!file) return;
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  setExportStatus(`نُزِّل الملف ⁦${file.name}⁩. تجده في مجلد التنزيلات؛ أرسله كمستند.`, 'good');
  $('export-confirm').hidden = false;
}

async function onConfirmExport(ok) {
  $('export-confirm').hidden = true;
  if (!ok) { setExportStatus('لم يُحذف شيء. يمكنك المحاولة مرة أخرى.'); return; }
  await store.setMeta('exported', { ids: state.pendingExportIds || [], at: new Date().toISOString() });
  setExportStatus('شكرًا لك! يمكنك متابعة التسجيل أو بدء جلسة جديدة.', 'good');
}

async function onNewSession() {
  const exported = new Set(((await store.getMeta('exported')) || {}).ids || []);
  const all = await store.allRecordings();
  const missing = all.filter((r) => !exported.has(r.id));
  if (missing.length) {
    setExportStatus(`لم تُرسَل ${ar(missing.length)} تسجيلات بعد. أرسل الملف أولاً ثم أكّد بـ«نعم، تم».`, 'bad');
    return;
  }
  if (!confirm('ستُحذف التسجيلات المُرسلة من هذا الهاتف. متابعة؟')) return;
  await store.clearRecordings();
  await store.setMeta('exported', { ids: [], at: null });
  await refreshRecordings();
  fillSetup(state.profile);
  show('setup');
}

// ---------- boot ----------
function wire() {
  $('setup-form').addEventListener('submit', onSetupSubmit);
  $('btn-record').addEventListener('click', onRecordButton);
  $('btn-play').addEventListener('click', onPlay);
  $('btn-redo').addEventListener('click', onRedo);
  $('btn-next').addEventListener('click', advance);
  $('btn-skip').addEventListener('click', advance);
  $('btn-mic').addEventListener('click', async () => {
    $('mic-error').hidden = true;
    if (await ensureMic()) await enterRecording();
  });
  $('btn-share').addEventListener('click', onShare);
  $('btn-download').addEventListener('click', onDownload);
  $('btn-confirm-yes').addEventListener('click', () => onConfirmExport(true));
  $('btn-confirm-no').addEventListener('click', () => onConfirmExport(false));
  $('btn-new-session').addEventListener('click', onNewSession);
  document.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-action]')?.dataset.action;
    if (!act) return;
    if (act === 'help') openHelp();
    else if (act === 'export') enterExport();
    else if (act === 'settings') { stopPlayback(); fillSetup(state.profile); show('setup'); }
    else if (act === 'back') enterRecording();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.recorder.recording) stopRecording();
  });
}

async function boot() {
  wire();
  try {
    state.data = await loadData();
  } catch (e) {
    document.body.textContent = 'تعذّر تحميل نص المصحف. تحقّق من الاتصال وأعد تحميل الصفحة.';
    return;
  }
  state.profile = (await store.getMeta('profile')) || null;
  await refreshRecordings();
  if (state.profile) {
    fillSetup(state.profile);
    showMicIntro(); // one tap: needed anyway to start audio on iOS
  } else {
    show('setup');
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__qalunRecorder = { state, APP_VERSION, encoderPath }; // for the smoke test / debugging
}

boot();
