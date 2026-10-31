import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildZip, readZip, crc32 } from '../lib/zip.js';

test('crc32 known value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round-trips and keeps UTF-8 names', () => {
  const files = [
    { name: 'a/manifest.json', data: '{"x":1}' },
    { name: 'a/audio/علي_001.wav', data: new Uint8Array([1, 2, 3]) },
  ];
  const out = readZip(buildZip(files));
  assert.deepEqual(out.map((f) => f.name), files.map((f) => f.name));
  assert.deepEqual(Array.from(out[1].data), [1, 2, 3]);
});

test('zip is readable by an independent implementation (python zipfile)', (t) => {
  const py = process.env.PYTHON || 'python';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-'));
  const p = path.join(dir, 't.zip');
  fs.writeFileSync(p, buildZip([{ name: 'x/ملف.txt', data: 'hello' }]));
  const code = [
    'import sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    'n = z.namelist()[0]',
    'sys.stdout.buffer.write((n + "\\n" + z.read(n).decode()).encode("utf-8"))',
  ].join('\n');
  let out;
  try {
    out = execFileSync(py, ['-c', code, p], { encoding: 'utf8' });
  } catch (e) {
    t.skip(`python not available: ${String(e.message).split('\n')[0]}`);
    return;
  }
  assert.deepEqual(out.trim().split(/\r?\n/), ['x/ملف.txt', 'hello']);
});
