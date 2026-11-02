// Module worker: turns a raw take into a 16 kHz WAV off the main thread,
// so the page stays responsive after «إيقاف».
import { processTake } from './wav.js';

self.onmessage = (ev) => {
  const { id, samples, sampleRate } = ev.data;
  try {
    const r = processTake(samples, sampleRate);
    self.postMessage({ id, ...r }, r.wav ? [r.wav] : []);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
};
