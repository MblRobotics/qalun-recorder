// Microphone capture of raw PCM (no echo cancellation / noise suppression / AGC).

export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
};

export class Recorder {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.chunks = [];
    this.recording = false;
    this.onChunk = null;
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }

  get settings() {
    const t = this.stream && this.stream.getAudioTracks()[0];
    return t && t.getSettings ? t.getSettings() : {};
  }

  // Must be called from a user gesture (iOS needs the AudioContext resumed there).
  async init() {
    if (this.ctx && this.stream && this.stream.active) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const e = new Error('getUserMedia unavailable');
      e.name = 'NotSupportedError';
      throw e;
    }
    this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const sink = this.ctx.createGain();
    sink.gain.value = 0; // keep the graph pulled without playing the mic back
    sink.connect(this.ctx.destination);
    const handle = (f32) => {
      if (!this.recording) return;
      this.chunks.push(f32);
      if (this.onChunk) this.onChunk(f32);
    };
    try {
      await this.ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'capture-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
      });
      this.node.port.onmessage = (ev) => handle(ev.data);
    } catch (e) {
      // Older browsers: ScriptProcessorNode fallback.
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (ev) => handle(new Float32Array(ev.inputBuffer.getChannelData(0)));
    }
    src.connect(this.node);
    this.node.connect(sink);
  }

  start(onChunk) {
    this.chunks = [];
    this.onChunk = onChunk || null;
    this.recording = true;
  }

  // Returns { samples: Float32Array, sampleRate }.
  stop() {
    this.recording = false;
    this.onChunk = null;
    const n = this.chunks.reduce((s, c) => s + c.length, 0);
    const samples = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) { samples.set(c, o); o += c.length; }
    this.chunks = [];
    return { samples, sampleRate: this.sampleRate };
  }
}
