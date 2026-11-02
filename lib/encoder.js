// Runs processTake in a worker when possible; falls back to the main thread
// (after letting the browser paint the «جارٍ الحفظ…» state).
import { processTake } from './wav.js';

let worker = null;
let workerBroken = false;
let seq = 0;
let lastPath = null; // 'worker' | 'main' (for the smoke test / debugging)

export const encoderPath = () => lastPath;
const pending = new Map();

function getWorker() {
  if (worker || workerBroken || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./encode-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      lastPath = 'worker';
      if (ev.data.error) p.reject(new Error(ev.data.error)); else p.resolve(ev.data);
    };
    worker.onerror = (ev) => {
      // e.g. no module-worker support: finish the waiting takes on the main thread
      ev.preventDefault?.();
      workerBroken = true;
      worker.terminate();
      worker = null;
      for (const [, p] of pending) p.fallback();
      pending.clear();
    };
  } catch (e) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

async function onMainThread(samples, sampleRate) {
  lastPath = 'main';
  await nextFrame();
  return processTake(samples, sampleRate);
}

export function encodeTake(samples, sampleRate) {
  const w = getWorker();
  if (!w) return onMainThread(samples, sampleRate);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const copy = samples.slice(); // keep our copy usable for the fallback
    pending.set(id, { resolve, reject, fallback: () => onMainThread(samples, sampleRate).then(resolve, reject) });
    w.postMessage({ id, samples: copy, sampleRate }, [copy.buffer]);
  });
}
