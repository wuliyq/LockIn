/**
 * ElevenLabsSTT — Real-time speech-to-text using ElevenLabs Scribe v2
 *
 * Works in any modern browser (Chrome, Edge, Firefox, Safari).
 * No external dependencies required.
 *
 * Usage:
 *   import { ElevenLabsSTT } from './stt.js';
 *
 *   const stt = new ElevenLabsSTT({
 *     getToken: async () => {
 *       const response = await fetch('http://localhost:3001/api/stt-token', {
 *         method: 'POST',
 *       });
 *       const { token } = await response.json();
 *       return token;
 *     },
 *     onTranscript: ({ committed, partial, fullText }) => { ... },
 *     onStatusChange: (status, detail) => { ... },
 *     onVolume: (0..1) => { ... },
 *     onFlush: ({ flushedText, segmentIndex, timestamp }) => { ... },
 *     onError: (err) => { ... },
 *     autoFlushMs: 120000,   // ms — default 2 minutes. 0 = disabled.
 *   });
 *
 *   await stt.start();
 *   await stt.stop();
 *   stt.flush();  // manual flush
 */
export class ElevenLabsSTT {
  constructor(options = {}) {
    // Config
    this.getToken        = options.getToken        || null;
    this.deviceId        = options.deviceId        || '';
    this.modelId         = options.modelId         || 'scribe_v2_realtime';
    this.commitStrategy  = options.commitStrategy  || 'vad';
    this.autoFlushMs     = (typeof options.autoFlushMs === 'number')
                             ? options.autoFlushMs : 120_000; // 2 min default

    // Callbacks
    this.onTranscript   = options.onTranscript   || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onVolume       = options.onVolume       || (() => {});
    this.onFlush        = options.onFlush        || (() => {});
    this.onError        = options.onError        || (() => {});

    // Runtime state
    this.isRecording         = false;
    this.status              = 'idle';
    this.committedTranscript = '';
    this.partialTranscript   = '';
    this.segmentIndex        = 1;
    this.sessionId           = null;

    // Timers
    this._flushTimer     = null;
    this._lastFlushAt    = null;

    // Audio/WS resources
    this._ws            = null;
    this._mediaStream   = null;
    this._audioContext  = null;
    this._processor     = null;
    this._muteGain      = null;
  }

  // ─── Static helpers ────────────────────────────────────────────────────────

  /**
   * Returns a list of available microphone devices.
   * Will prompt for mic permission if labels are hidden.
   */
  static async getAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('MediaDevices API not supported in this browser.');
    }
    // Temporary stream so device labels are populated
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch { /* user may have denied — continue anyway */ }

    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter(d => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Start recording. Fetches a token, opens the WebSocket, then starts the mic.
   */
  async start(opts = {}) {
    if (this.isRecording) { console.warn('ElevenLabsSTT: already recording'); return; }

    if (opts.getToken) this.getToken = opts.getToken;
    if (opts.deviceId !== undefined) this.deviceId = opts.deviceId;
    if (typeof opts.autoFlushMs === 'number') this.autoFlushMs = opts.autoFlushMs;

    if (!this.getToken) {
      const e = new Error('A function that fetches a temporary transcription token is required.');
      this._emitError(e); throw e;
    }

    try {
      this._setStatus('connecting', 'Getting connection token…');
      const token = await this.getToken();
      if (!token) throw new Error('No transcription token was returned.');

      this._setStatus('connecting', 'Opening WebSocket…');
      await this._openWebSocket(token);

      this._setStatus('connecting', 'Starting microphone…');
      await this._startMic();

      this.isRecording  = true;
      this.segmentIndex = 1;
      this._lastFlushAt = Date.now();
      this._startFlushTimer();
      this._setStatus('recording', 'Recording');
    } catch (err) {
      this._cleanup();
      this._setStatus('error', err.message);
      this._emitError(err);
      throw err;
    }
  }

  /**
   * Stop recording. Sends a final commit to ElevenLabs, waits for the last
   * transcript, then tears down all resources.
   * Returns the full transcript text collected this session.
   */
  async stop() {
    this._stopFlushTimer();
    if (!this.isRecording && this.status === 'idle') return this.getFullTranscript();

    this.isRecording = false;

    // Ask ElevenLabs to finalize whatever is buffered
    try {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: '',
          sample_rate: 16000,
          commit: true,
        }));
      }
    } catch { /* ignore */ }

    // Short wait for the final committed_transcript to arrive
    await new Promise(r => setTimeout(r, 350));

    this._cleanup();
    this._setStatus('stopped', 'Stopped');
    return this.getFullTranscript();
  }

  /**
   * Flush: save the current transcript, reset the buffer, keep recording.
   * Called automatically every `autoFlushMs` while recording.
   * Can also be called manually.
   */
  flush() {
    const flushedText    = this.getFullTranscript();
    const segmentIndex   = this.segmentIndex;

    // Reset buffer
    this.committedTranscript = '';
    this.partialTranscript   = '';
    this.segmentIndex       += 1;
    this._lastFlushAt        = Date.now();

    // Notify listeners
    this.onFlush({ flushedText, segmentIndex, timestamp: Date.now() });
    this._emitTranscript(true); // tell onTranscript the buffer is now empty

    return flushedText;
  }

  /** Manually change the auto-flush interval. Pass 0 to disable. */
  setAutoFlushMs(ms) {
    this.autoFlushMs = Math.max(0, Number(ms) || 0);
    this._lastFlushAt = Date.now();
    if (this.isRecording) this._startFlushTimer();
  }

  /** Milliseconds until the next automatic flush, or null if disabled. */
  msUntilFlush() {
    if (!this.isRecording || !this.autoFlushMs || !this._lastFlushAt) return null;
    return Math.max(0, this.autoFlushMs - (Date.now() - this._lastFlushAt));
  }

  /** The combined committed + partial text currently in the buffer. */
  getFullTranscript() {
    const c = this.committedTranscript.trim();
    const p = this.partialTranscript.trim();
    if (c && p) return `${c} ${p}`;
    return c || p;
  }

  /** Clears the buffer without triggering onFlush. */
  clearTranscript() {
    this.committedTranscript = '';
    this.partialTranscript   = '';
    this._lastFlushAt        = Date.now();
    this._emitTranscript(false);
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _setStatus(s, detail = '') {
    this.status = s;
    this.onStatusChange(s, detail);
  }

  _emitError(err) {
    this.onError(err instanceof Error ? err : new Error(String(err)));
  }

  _emitTranscript(isCommitted) {
    this.onTranscript({
      fullText:  this.getFullTranscript(),
      committed: this.committedTranscript.trim(),
      partial:   this.partialTranscript.trim(),
      isCommitted,
    });
  }

  _startFlushTimer() {
    this._stopFlushTimer();
    if (this.autoFlushMs > 0) {
      this._flushTimer = setInterval(() => {
        if (this.isRecording) this.flush();
      }, this.autoFlushMs);
    }
  }

  _stopFlushTimer() {
    if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
  }

  /** Open WebSocket and wait until session_started is received. */
  _openWebSocket(token) {
    return new Promise((resolve, reject) => {
      const url = [
        'wss://api.elevenlabs.io/v1/speech-to-text/realtime',
        `?model_id=${encodeURIComponent(this.modelId)}`,
        `&audio_format=pcm_16000`,
        `&commit_strategy=${encodeURIComponent(this.commitStrategy)}`,
        `&token=${encodeURIComponent(token)}`,
      ].join('');

      const ws  = new WebSocket(url);
      this._ws  = ws;
      let ready = false;

      ws.onopen = () => { /* wait for session_started */ };

      ws.onmessage = ({ data }) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        this._handleMessage(msg);

        if (msg.message_type === 'session_started') {
          this.sessionId = msg.session_id;
          if (!ready) { ready = true; resolve(); }
        }
      };

      ws.onerror = () => {
        const e = new Error('WebSocket error.');
        if (!ready) reject(e); else this._emitError(e);
      };

      ws.onclose = ({ code, reason }) => {
        if (!ready) {
          reject(new Error(`WebSocket closed before session started (code ${code})`));
        } else if (this.isRecording) {
          this._setStatus('stopped', 'Connection lost');
          this._cleanup();
        }
      };
    });
  }

  _handleMessage(msg) {
    switch (msg.message_type) {
      case 'session_started':
        break; // handled in _openWebSocket

      case 'partial_transcript':
        this.partialTranscript = msg.text || '';
        this._emitTranscript(false);
        break;

      case 'committed_transcript': {
        const text = (msg.text || '').trim();
        if (text) {
          this.committedTranscript = this.committedTranscript
            ? `${this.committedTranscript.trim()} ${text}`
            : text;
        }
        this.partialTranscript = '';
        this._emitTranscript(true);
        break;
      }

      case 'auth_error':
      case 'quota_exceeded':
      case 'error': {
        const detail = msg.error || msg.message || 'Unknown error.';
        this._emitError(new Error(`[${msg.message_type}] ${detail}`));
        this.stop();
        break;
      }

      default: break; // keepalives, warnings, etc.
    }
  }

  /** Capture mic audio, downsample to 16 kHz, and stream PCM to ElevenLabs. */
  async _startMic() {
    const constraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (this.deviceId) constraints.deviceId = { exact: this.deviceId };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    this._mediaStream = stream;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this._audioContext = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    const source    = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    this._processor = processor;

    // Silent gain node prevents mic audio from playing through speakers
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this._muteGain  = mute;

    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);

    const inputRate = ctx.sampleRate;

    processor.onaudioprocess = (e) => {
      if (!this.isRecording || this._ws?.readyState !== WebSocket.OPEN) return;

      const raw = e.inputBuffer.getChannelData(0);

      // Volume meter
      let ss = 0;
      for (let i = 0; i < raw.length; i++) ss += raw[i] * raw[i];
      this.onVolume(Math.min(1, Math.sqrt(ss / raw.length) * 5));

      // Downsample → 16-bit PCM → Base64 → send
      const pcm16  = this._floatToPCM16(this._downsample(raw, inputRate, 16000));
      const b64    = this._toBase64(pcm16);

      this._ws.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: b64,
        commit: false,
        sample_rate: 16000,
      }));
    };
  }

  _downsample(buf, fromRate, toRate) {
    if (fromRate === toRate) return buf;
    const ratio  = fromRate / toRate;
    const outLen = Math.round(buf.length / ratio);
    const out    = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = Math.floor(i * ratio);
      const e = Math.floor((i + 1) * ratio);
      let sum = 0, n = 0;
      for (let j = s; j < e && j < buf.length; j++) { sum += buf[j]; n++; }
      out[i] = n ? sum / n : (buf[s] || 0);
    }
    return out;
  }

  _floatToPCM16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i]  = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  _toBase64(i16) {
    const bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  _cleanup() {
    this.isRecording = false;
    this._stopFlushTimer();

    if (this._processor) {
      this._processor.onaudioprocess = null;
      try { this._processor.disconnect(); } catch {}
      this._processor = null;
    }
    if (this._muteGain) {
      try { this._muteGain.disconnect(); } catch {}
      this._muteGain = null;
    }
    if (this._audioContext) {
      try { this._audioContext.close(); } catch {}
      this._audioContext = null;
    }
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      this._mediaStream = null;
    }
    if (this._ws) {
      try {
        if (this._ws.readyState === WebSocket.OPEN ||
            this._ws.readyState === WebSocket.CONNECTING) {
          this._ws.close();
        }
      } catch {}
      this._ws = null;
    }
    this.onVolume(0);
  }
}

// Expose on window for plain <script> usage (no bundler)
if (typeof window !== 'undefined') {
  window.ElevenLabsSTT = ElevenLabsSTT;
}
