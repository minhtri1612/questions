/*
 * Original sound effects synthesised with the Web Audio API — no audio files,
 * so nothing to load and nothing copyrighted.
 */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;

  function ac() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** One enveloped oscillator note. */
  function tone(freq, start, dur, { type = 'sine', gain = 0.3, attack = 0.01, slideTo = null } = {}) {
    const c = ac();
    if (!c || muted) return;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(start, dur, gain = 0.15) {
    const c = ac();
    if (!c || muted) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const g = c.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(filter).connect(g).connect(master);
    src.start(c.currentTime + start);
  }

  const Sound = {
    unlock: () => ac(),
    setMuted(m) {
      muted = !!m;
    },
    isMuted: () => muted,

    tick(urgent) {
      if (urgent) {
        tone(1320, 0, 0.09, { type: 'square', gain: 0.12 });
      } else {
        tone(880, 0, 0.05, { type: 'triangle', gain: 0.1 });
      }
    },
    flip() {
      noise(0, 0.25, 0.12);
      tone(520, 0, 0.25, { type: 'sine', gain: 0.08, slideTo: 1040 });
    },
    correct() {
      [659.25, 830.61, 987.77, 1318.51].forEach((f, i) =>
        tone(f, i * 0.09, 0.45, { type: 'triangle', gain: 0.22 })
      );
      tone(1318.51, 0.36, 0.7, { type: 'sine', gain: 0.12 });
    },
    wrong() {
      tone(220, 0, 0.28, { type: 'sawtooth', gain: 0.14 });
      tone(164.81, 0.25, 0.55, { type: 'sawtooth', gain: 0.14, slideTo: 130 });
    },
    buzzer() {
      tone(150, 0, 0.9, { type: 'square', gain: 0.18 });
      tone(153, 0, 0.9, { type: 'sawtooth', gain: 0.12 });
    },
    reveal() {
      tone(392, 0, 0.18, { type: 'triangle', gain: 0.15 });
      tone(587.33, 0.08, 0.3, { type: 'triangle', gain: 0.15 });
    },
    /** An image piece opening: soft whoosh + rising shimmer. */
    open() {
      noise(0, 0.5, 0.1);
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.05 + i * 0.07, 0.4, { type: 'sine', gain: 0.1 }));
    },
    /** Contestant buzzes in for the keyword. */
    bell() {
      [0, 0.16].forEach((t) => {
        tone(1318.51, t, 0.6, { type: 'sine', gain: 0.25 });
        tone(1975.53, t, 0.45, { type: 'sine', gain: 0.12 });
      });
    },
    /** One keyword letter landing. */
    pop() {
      tone(660, 0, 0.08, { type: 'triangle', gain: 0.12, slideTo: 990 });
    },
    fanfare() {
      const notes = [
        [523.25, 0, 0.18], [523.25, 0.2, 0.18], [523.25, 0.4, 0.18],
        [659.25, 0.6, 0.5], [587.33, 1.1, 0.18], [659.25, 1.3, 0.18], [783.99, 1.5, 1.2],
      ];
      notes.forEach(([f, t, d]) => {
        tone(f, t, d, { type: 'sawtooth', gain: 0.1 });
        tone(f * 2, t, d, { type: 'triangle', gain: 0.08 });
      });
      [261.63, 329.63, 392].forEach((f) => tone(f, 1.5, 1.4, { type: 'triangle', gain: 0.1 }));
    },
  };

  root.Sound = Sound;
})(window);
