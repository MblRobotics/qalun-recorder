// Headless browser smoke test with a fake microphone.
//   npm run smoke            (uses the installed Google Chrome via playwright-core)
//   SMOKE_URL=https://... npm run smoke   (test a deployed copy instead of a local server)
// Writes screenshots and the exported ZIP to tests/smoke/out/.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from '../../scripts/serve.mjs';
import { readZip } from '../../lib/zip.js';
import { decodeWav } from '../../lib/wav.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });

let server = null;
let url = process.env.SMOKE_URL;
if (!url) {
  server = await serve(8765);
  url = 'http://127.0.0.1:8765/';
}

const browser = await chromium.launch({
  channel: process.env.SMOKE_CHANNEL || 'chrome',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar', acceptDownloads: true,
  permissions: ['microphone'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const external = [];
page.on('request', (r) => { if (!r.url().startsWith(new URL(url).origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });

const step = (s) => console.log(`- ${s}`);
const count = () => page.evaluate(() => window.__qalunRecorder.state.recordings.length);

async function recordTake(ms = 2500) {
  await page.click('#btn-record');
  await page.waitForTimeout(ms);
  await page.click('#btn-record');
  await page.waitForFunction(() => !document.getElementById('btn-next').disabled, null, { timeout: 15000 });
}

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  step('setup screen');
  await page.waitForSelector('#screen-setup:not([hidden])');
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  await page.fill('#in-name', 'Smoke تجربة');
  await page.selectOption('#in-age', '30-44');
  await page.screenshot({ path: path.join(out, '1-setup.png') });
  await page.click('#setup-form button[type=submit]');

  step('microphone explainer');
  await page.waitForSelector('#screen-mic:not([hidden])');
  await page.click('#btn-mic');
  await page.waitForSelector('#screen-record:not([hidden])');
  step('help opens once on first visit');
  await page.waitForSelector('#help[open]');
  await page.screenshot({ path: path.join(out, '2a-help.png') });
  await page.click('#help button');
  assert.equal(await page.isVisible('#help'), false);

  step('font + ayah rendering');
  await page.evaluate(() => document.fonts.ready);
  const fontOk = await page.evaluate(() => document.fonts.check('32px "KFGQPC Qalun"', 'مَلِكِ'));
  assert.ok(fontOk, 'Qalun font not loaded');
  const ayahText = await page.textContent('#ayah');
  assert.ok(ayahText.trim().length > 0);
  const settings = await page.evaluate(() => window.__qalunRecorder.state.recorder.settings);
  console.log('  track settings:', JSON.stringify(settings));
  await page.screenshot({ path: path.join(out, '2-record-qalun.png') });

  step('record two ayahs in qalun mode');
  const first = await page.evaluate(() => window.__qalunRecorder.state.order[0]);
  await recordTake();
  assert.equal(await count(), 1);
  const st = await page.textContent('#status');
  console.log('  status after take:', st);
  await page.screenshot({ path: path.join(out, '3-after-take.png') });
  step('re-record replaces the take');
  await page.click('#btn-redo');
  await page.waitForTimeout(1500);
  await page.click('#btn-record');
  await page.waitForFunction(() => !document.getElementById('btn-next').disabled);
  assert.equal(await count(), 1);
  await page.click('#btn-next');
  step('skip one, record the next');
  await page.click('#btn-skip');
  await recordTake(2000);
  assert.equal(await count(), 2);
  const recs = await page.evaluate(() => window.__qalunRecorder.state.recordings);
  assert.equal(recs[0].ayah_id, first);
  assert.equal(recs[0].take, 1);

  step('reload keeps recordings and position');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-mic:not([hidden])');
  await page.click('#btn-mic');
  await page.waitForSelector('#screen-record:not([hidden])');
  assert.equal(await count(), 2);
  assert.equal(await page.evaluate(() => window.__qalunRecorder.state.pos), 2);
  assert.equal(await page.textContent('#stat-count'), '٢');

  step('hafs drill mode shows highlighted words and the Hafs form');
  await page.click('[data-action=settings] >> visible=true');
  await page.check('input[name=mode][value=hafs]');
  await page.click('#setup-form button[type=submit]');
  await page.waitForSelector('#screen-record:not([hidden])');
  const nDrift = await page.locator('#ayah .w.drift').count();
  assert.ok(nDrift >= 1, 'no highlighted drift word');
  assert.ok(await page.isVisible('#hafs-hint'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, '4-record-hafs.png') });
  await recordTake(2000);
  assert.equal(await count(), 3);

  step('new session refused before export');
  await page.click('[data-action=export] >> visible=true');
  await page.waitForSelector('#screen-export:not([hidden])');
  await page.waitForFunction(() => !document.getElementById('btn-download').disabled);
  await page.click('#btn-new-session');
  await page.waitForFunction(() => /لم تُرسَل/.test(document.getElementById('export-status').textContent));
  assert.equal(await count(), 3);

  step('export ZIP (download path)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
  const zipPath = path.join(out, dl.suggestedFilename());
  await dl.saveAs(zipPath);
  await page.screenshot({ path: path.join(out, '5-export.png') });
  const entries = readZip(new Uint8Array(fs.readFileSync(zipPath)));
  const base = dl.suggestedFilename().replace(/\.zip$/, '');
  assert.match(base, /^Smokeتجربة_\d{8}-\d{4}$/);
  const manifest = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === `${base}/manifest.json`).data));
  assert.equal(manifest.files.length, 3);
  assert.equal(manifest.reader.age_range, '30-44');
  assert.equal(manifest.mode, 'mixed');
  assert.equal(manifest.capture.track_settings.echoCancellation, false);
  for (const f of manifest.files) {
    const e = entries.find((x) => x.name === `${base}/${f.file}`);
    assert.ok(e, `missing ${f.file}`);
    const w = decodeWav(e.data);
    assert.deepEqual([w.sampleRate, w.channels, w.bits], [16000, 1, 16]);
    assert.ok(Math.abs(w.samples.length / 16000 - f.duration_s) < 0.002);
    assert.ok(f.duration_s > 1, `duration ${f.duration_s}`);
    assert.ok(f.peak > 0.01, `silent take, peak ${f.peak}`);
    console.log(`  ${f.file}: ${f.duration_s}s peak ${f.peak_dbfs} dBFS rms ${f.rms_dbfs} dBFS in ${f.input_sample_rate} Hz`);
  }
  const hafs = manifest.files.find((f) => f.mode === 'hafs');
  assert.ok(hafs.drift_words.length >= 1 && hafs.drift_words[0].loc.startsWith(`${hafs.surah}:${hafs.ayah}:`));

  step('confirm export, then new session clears');
  await page.click('#btn-confirm-yes');
  page.once('dialog', (d) => d.accept());
  await page.click('#btn-new-session');
  await page.waitForSelector('#screen-setup:not([hidden])');
  assert.equal(await count(), 0);

  assert.deepEqual(external, [], `external requests: ${external.join(', ')}`);
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log(`SMOKE OK: ${zipPath}`);
} finally {
  await browser.close();
  if (server) server.close();
}
