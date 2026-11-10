/**
 * Sound for the birthday room.
 * Phones only allow audio after a tap, so `unlock()` is called from the
 * intro button. The song itself is played later (when she reaches C306)
 * through the same, already-unlocked AudioContext — no second tap needed.
 */
export class BirthdaySong {
  constructor({ src, loop = false }) {
    this.src = src;
    this.loop = loop;
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.startedAt = 0;
    this.playing = false;
    this.usingSynth = false;
    this.duration = 0;
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === "suspended") this.ctx.resume();
    // play one silent sample: required on iOS to fully unlock
    const b = this.ctx.createBuffer(1, 1, 22050);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start(0);
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    this.bus = this.ctx.createGain(); // the song's own volume, so it can fade without touching other sounds
    this.bus.connect(this.master);
    this._preload();
  }

  async _preload() {
    try {
      const res = await fetch(this.src);
      if (!res.ok) throw new Error(res.status);
      const data = await res.arrayBuffer();
      this.buffer = await new Promise((ok, fail) =>
        this.ctx.decodeAudioData(data, ok, fail)
      );
      this.duration = this.buffer.duration;
    } catch {
      this.buffer = null; // fall back to the music box
    }
  }

  get time() {
    return this.playing ? this.ctx.currentTime - this.startedAt : 0;
  }

  /** Play from the start, or from `offset` seconds in. */
  play(offset = 0, fadeIn = 0) {
    if (!this.ctx) this.unlock();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.stop();
    this.paused = null;
    const now = this.ctx.currentTime;
    const g = this.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(fadeIn ? 0 : 1, now);
    if (fadeIn) g.linearRampToValueAtTime(1, now + fadeIn);
    this.startedAt = now + 0.05 - offset; // keeps `time` (and the lyrics) in step after a resume
    this.playing = true;
    if (this.buffer) {
      this.usingSynth = false;
      const s = this.ctx.createBufferSource();
      s.buffer = this.buffer;
      s.loop = this.loop;
      s.connect(this.bus);
      s.start(now + 0.05, offset % this.buffer.duration);
      s.onended = () => { if (this.source === s) this.playing = false; };
      this.source = s;
    } else {
      this.usingSynth = true;
      this.duration = this._musicBox(this.startedAt, offset);
      this._synthTimer = setTimeout(() => (this.playing = false), (this.duration - offset + 1) * 1000);
    }
  }

  /** Fade out and remember where it was (for stepping into another world). */
  pause(fade = 0.6) {
    if (!this.playing) { this.paused = null; return; }
    const offset = this.time;
    const now = this.ctx.currentTime;
    const g = this.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    clearTimeout(this._synthTimer);
    this.playing = false;
    this.paused = { offset };
    const src = this.source, voices = this._voices;
    this.source = null;
    this._voices = [];
    setTimeout(() => {
      try { src?.stop(); } catch {}
      voices?.forEach((v) => { try { v.stop(); } catch {} });
    }, fade * 1000 + 50);
  }

  /** Continue from where `pause()` left off (does nothing if it wasn't playing). */
  resume(fade = 0.8) {
    if (!this.paused) return;
    this.play(this.paused.offset, fade);
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch {}
      this.source = null;
    }
    if (this._voices) {
      this._voices.forEach((v) => { try { v.stop(); } catch {} });
    }
    this._voices = [];
    clearTimeout(this._synthTimer);
    this.playing = false;
  }

  /** "Happy Birthday" melody (public domain) as a warm music box. Returns duration. */
  _musicBox(t0, offset = 0) {
    const ctx = this.ctx;
    const bpm = 96;
    const beat = 60 / bpm;
    const N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, Bb4: 466.16, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99 };
    // [note, beats]   key of F, 3/4
    const melody = [
      ["C4", 0.75], ["C4", 0.25], ["D4", 1], ["C4", 1], ["F4", 1], ["E4", 2],
      ["C4", 0.75], ["C4", 0.25], ["D4", 1], ["C4", 1], ["G4", 1], ["F4", 2],
      ["C4", 0.75], ["C4", 0.25], ["C5", 1], ["A4", 1], ["F4", 1], ["E4", 1], ["D4", 2.5],
      ["Bb4", 0.75], ["Bb4", 0.25], ["A4", 1], ["F4", 1], ["G4", 1], ["F4", 3],
    ];
    // gentle chords on the downbeats (F, C, C7, F, F, Bb, F C F)
    const chords = [
      [0, ["F4", "A4", "C5"]], [3, ["E4", "G4", "C5"]], [6, ["E4", "G4", "Bb4"]], [9, ["F4", "A4", "C5"]],
      [12, ["F4", "A4", "C5"]], [15, ["F4", "Bb4", "D5"]], [19.5, ["F4", "A4", "C5"]], [21.5, ["E4", "G4", "Bb4"]], [22.5, ["F4", "A4", "C5"]],
    ];
    this._voices = [];
    const startAt = t0 + offset - 0.01; // when resuming, skip notes that already played
    const bell = (freq, when, dur, vol) => {
      if (when < startAt) return;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(vol, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
      g.connect(this.bus);
      [[1, 1], [2, 0.32], [3, 0.12], [4.2, 0.06]].forEach(([mult, amp]) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq * mult;
        og.gain.value = amp;
        o.connect(og).connect(g);
        o.start(when);
        o.stop(when + dur + 0.05);
        this._voices.push(o);
      });
    };
    let t = t0 + 0.3;
    const pickup = 1; // two pickup notes before beat 1
    for (const [n, b] of melody) {
      bell(N[n] * 2, t, Math.max(1.2, b * beat * 2.2), 0.22); // octave up = music box
      t += b * beat;
    }
    for (const [at, notes] of chords) {
      notes.forEach((n) => bell(N[n], t0 + 0.3 + (at + pickup) * beat, 2.8, 0.05));
    }
    return t - t0 + 1.5;
  }

  /** Little sparkle sound when a clue is collected (`n` = 1, 2, 3 rises in pitch). */
  chime(n = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.02;
    const base = [523.25, 587.33, 659.25][Math.min(2, n - 1)] || 523.25;
    [1, 1.25, 1.5, 2].forEach((m, i) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.13, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + i * 0.08 + 1.1);
      g.connect(this.master);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = base * m * 2;
      o.connect(g);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 1.2);
    });
  }
}

/**
 * Background music for a scene (e.g. the street). Plays `src` on a loop if the file
 * exists; otherwise a synthesized placeholder: a dark drone, a heartbeat, a ticking
 * clock and the odd whoosh, which reads as suspense.
 * Uses the song's AudioContext, so it's already unlocked by the first tap.
 */
export class SceneMusic {
  constructor(song, src) {
    this.song = song;
    this.src = src;
    this.buffer = null;
    this.playing = false;
    this._loaded = null;
  }

  _load() {
    if (!this._loaded) {
      this._loaded = (async () => {
        if (!this.src) return;
        try {
          const res = await fetch(this.src);
          if (!res.ok) throw new Error(res.status);
          const data = await res.arrayBuffer();
          this.buffer = await new Promise((ok, fail) => this.song.ctx.decodeAudioData(data, ok, fail));
        } catch {
          this.buffer = null; // use the synth placeholder
        }
      })();
    }
    return this._loaded;
  }

  async start(fade = 1.5) {
    const ctx = this.song.ctx;
    if (!ctx || this.playing) return;
    this.playing = true;
    await this._load();
    if (!this.playing) return; // stopped while loading
    const now = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(1, now + fade);
    this.out.connect(this.song.master);
    this.nodes = [];
    this.timers = [];
    if (this.buffer) {
      const s = ctx.createBufferSource();
      s.buffer = this.buffer;
      s.loop = true;
      s.connect(this.out);
      s.start();
      this.nodes.push(s);
    } else {
      this._suspense();
    }
  }

  /** 0 = calm … 1 = it's right behind you: faster heartbeat (and a rising whine, unless `whine` is false). */
  setIntensity(k, whine = true) {
    if (!this.playing || !this.out) return;
    k = Math.max(0, Math.min(1, k));
    this.beat = 1.05 - 0.6 * k * k;
    if (this.prox) this.prox.gain.setTargetAtTime(whine ? 0.09 * Math.pow(k, 2.5) : 0, this.song.ctx.currentTime, 0.2);
  }

  stop(fade = 0.8) {
    if (!this.playing) return;
    this.playing = false;
    const ctx = this.song.ctx;
    const out = this.out, nodes = this.nodes || [], timers = this.timers || [];
    timers.forEach((t) => clearInterval(t) || clearTimeout(t));
    if (!out) return;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => {
      nodes.forEach((n) => { try { n.stop(); } catch {} });
      out.disconnect();
    }, fade * 1000 + 100);
  }

  // ── the placeholder: built from oscillators and noise, nothing to download ──
  _suspense() {
    const ctx = this.song.ctx, out = this.out, nodes = this.nodes;
    const osc = (type, freq, dest, gain = 1, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(dest);
      o.start();
      nodes.push(o);
      return { o, g };
    };

    // 1. dark drone: D and the tritone above it, through a slowly breathing low-pass filter
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    lp.Q.value = 7;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.085;
    lp.connect(droneGain).connect(out);
    osc("sawtooth", 73.42, lp, 1);
    osc("sawtooth", 73.42, lp, 0.8, 9);
    osc("sawtooth", 103.83, lp, 0.45, -6);
    const lfo = osc("sine", 0.07, lp.frequency, 140);
    osc("sine", 36.71, out, 0.11); // sub rumble

    // 6. proximity whine: silent until something gets close (see setIntensity)
    this.prox = ctx.createGain();
    this.prox.gain.value = 0;
    const pf = ctx.createBiquadFilter();
    pf.type = "bandpass";
    pf.frequency.value = 900;
    pf.Q.value = 4;
    pf.connect(this.prox).connect(out);
    osc("sawtooth", 440, pf, 0.6);
    osc("sawtooth", 466.16, pf, 0.6);
    osc("square", 55, pf, 0.4);

    // 2. high tension: two notes a semitone apart, trembling, fading in slowly
    const hi = ctx.createGain();
    hi.gain.setValueAtTime(0, ctx.currentTime);
    hi.gain.linearRampToValueAtTime(0.014, ctx.currentTime + 10);
    const trem = ctx.createGain();
    trem.gain.value = 1;
    hi.connect(trem).connect(out);
    osc("sine", 1174.66, hi);
    osc("sine", 1244.51, hi);
    osc("sine", 5.5, trem.gain, 0.6); // tremolo

    // short noise buffer, reused for ticks and whooshes
    const noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    // 3. heartbeat: lub-dub
    const thump = (t, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(72, t);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.18);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    };
    // 4. clock ticking (it's a clock-themed hunt after all): tick… tock…
    let tock = false;
    const tick = (t) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = tock ? 2200 : 3200;
      bp.Q.value = 12;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      s.connect(bp).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + 0.05);
      tock = !tock;
    };
    // 5. an occasional whoosh + low boom
    const whoosh = (t) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.45);
      s.connect(bp).connect(g).connect(out);
      s.start(t);
      s.stop(t + 1.5);
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.setValueAtTime(55, t + 1.3);
      o.frequency.exponentialRampToValueAtTime(28, t + 2.8);
      og.gain.setValueAtTime(0, t + 1.3);
      og.gain.linearRampToValueAtTime(0.35, t + 1.33);
      og.gain.exponentialRampToValueAtTime(0.001, t + 3);
      o.connect(og).connect(out);
      o.start(t + 1.3);
      o.stop(t + 3.1);
    };

    // schedule with a little look-ahead so timing stays steady
    this.beat = 1.05; // seconds per heartbeat (setIntensity speeds it up)
    let next = ctx.currentTime + 0.6, nextTick = ctx.currentTime + 0.3;
    const pump = () => {
      const horizon = ctx.currentTime + 0.4;
      while (next < horizon) { thump(next, 0.5); thump(next + 0.24, 0.32); next += this.beat; }
      while (nextTick < horizon) { tick(nextTick); nextTick += 0.5; }
    };
    pump();
    this.timers.push(setInterval(pump, 100));
    const scheduleWhoosh = () => {
      this.timers.push(setTimeout(() => {
        if (!this.playing) return;
        whoosh(ctx.currentTime + 0.05);
        scheduleWhoosh();
      }, 9000 + Math.random() * 7000));
    };
    scheduleWhoosh();
    void lfo;
  }
}

/** The jumpscare: a burst of screeching static, then dead silence. Returns its length (s). */
export function playCrash(song) {
  const ctx = song.ctx;
  if (!ctx) return 0;
  const t = ctx.currentTime + 0.01, len = 1.3;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.9, t);
  out.gain.setValueAtTime(0.9, t + len - 0.02);
  out.gain.linearRampToValueAtTime(0, t + len); // cut, not a fade: it "dies"
  out.connect(ctx.destination);
  const noise = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (i % 1600 < 900 ? 1 : 0.3); // stutter
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const ng = ctx.createGain();
  ng.gain.value = 0.55;
  s.connect(ng).connect(out);
  s.start(t);
  // screech: two clashing squares sliding up
  for (const [f0, f1] of [[600, 2400], [637, 2550]]) {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = ctx.createGain();
    g.gain.value = 0.18;
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len);
  }
  // and a hit underneath
  const k = ctx.createOscillator();
  k.frequency.setValueAtTime(120, t);
  k.frequency.exponentialRampToValueAtTime(30, t + 0.5);
  const kg = ctx.createGain();
  kg.gain.setValueAtTime(1, t);
  kg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  k.connect(kg).connect(out);
  k.start(t);
  k.stop(t + 0.7);
  return len;
}

/**
 * A looping sound that comes from something in the world (the street chaser's voice).
 * `set(volume, pan)` is called every frame: louder as it gets closer, panned left/right
 * towards where it is.
 */
export class LoopSound {
  constructor(song, src, { reverb = 0 } = {}) {
    this.song = song;
    this.src = src;
    this.reverb = reverb; // 0 = dry … 1 = mostly echo
    this.playing = false;
    this._loaded = null;
  }

  _load() {
    this._loaded ??= (async () => {
      try {
        const res = await fetch(this.src);
        if (!res.ok) throw new Error(res.status);
        const data = await res.arrayBuffer();
        this.buffer = await new Promise((ok, fail) => this.song.ctx.decodeAudioData(data, ok, fail));
      } catch (err) {
        console.warn("couldn't load", this.src, err);
        this.buffer = null;
      }
    })();
    return this._loaded;
  }

  async start() {
    const ctx = this.song.ctx;
    if (!ctx || this.playing) return;
    this.playing = true;
    await this._load();
    if (!this.playing || !this.buffer) return;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.source.connect(this.gain);
    const outNode = this.pan || this.song.master;
    if (this.pan) this.pan.connect(this.song.master);
    if (this.reverb > 0) {
      // dry voice + a long dark reverb + a faint ghostly echo: it sounds like it's
      // coming from somewhere much bigger than the street
      const r = this.reverb;
      const dry = ctx.createGain();
      dry.gain.value = 1 - 0.55 * r;
      this.gain.connect(dry).connect(outNode);
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 4.2, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 1.6 * r;
      this.gain.connect(conv).connect(wet).connect(outNode);
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.37;
      const fb = ctx.createGain();
      fb.gain.value = 0.38 * r;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1400;
      this.gain.connect(delay).connect(tone).connect(fb).connect(delay);
      const echo = ctx.createGain();
      echo.gain.value = 0.45 * r;
      tone.connect(echo).connect(outNode);
    } else {
      this.gain.connect(outNode);
    }
    this.source.start();
  }

  set(volume, pan = 0) {
    if (!this.gain) return;
    const t = this.song.ctx.currentTime;
    this.gain.gain.setTargetAtTime(volume, t, 0.15);
    this.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.15);
  }

  stop(fade = 0.4) {
    if (!this.playing) return;
    this.playing = false;
    const { source, gain } = this;
    this.source = this.gain = null;
    if (!source) return;
    const t = this.song.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
    setTimeout(() => { try { source.stop(); } catch {} }, fade * 1000 + 50);
  }
}

/** A synthetic room tail: stereo noise that dies away, darker as it decays (cave-like). */
function impulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const pre = Math.floor(rate * 0.035); // 35 ms pre-delay before the room answers
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const k = 0.95 - 0.75 * t; // more smoothing (darker) as it fades
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}
