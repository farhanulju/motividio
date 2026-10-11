// Synthesized UI / motion sound effects. Each fn(bus, cue, rand) writes into a Bus.
// cue: { t, type, dur?, gain?, pan?, pitch? }  — t is the moment the sound "lands".
import { SR, SVF, Osc, rng } from './dsp.mjs';

const exp = Math.exp, sin = Math.sin, PI2 = Math.PI * 2;

function noiseBurst(bus, t, len, { hp = 0, lp = 0, bp = 0, q = 0.8, decay = 40, gain = 0.4, pan = 0 }, r) {
  const f = new SVF(bp || lp || hp || 1000, q);
  bus.voice(t, len, (x) => {
    const n = r() * 2 - 1;
    f.run(n);
    const v = bp ? f.bp : lp ? f.lp : hp ? f.hp : n;
    return v * exp(-x * decay);
  }, { gain, pan });
}

export const SFX = {
  /** crisp UI click (cursor press) */
  click(bus, c, r) {
    const p = c.pitch || 1;
    bus.voice(c.t, 0.04, (x) => sin(PI2 * 2600 * p * x) * exp(-x * 260) * 0.5, { gain: c.gain ?? 0.35, pan: c.pan ?? 0 });
    noiseBurst(bus, c.t, 0.02, { hp: 4000, decay: 500, gain: (c.gain ?? 0.35) * 0.8, pan: c.pan ?? 0 }, r);
  },
  /** softer keyboard tap — randomized so typing never sounds looped */
  key(bus, c, r) {
    const p = 0.85 + r() * 0.3;
    noiseBurst(bus, c.t, 0.035, { bp: 2400 * p, q: 1.5, decay: 220, gain: c.gain ?? 0.35, pan: (r() - 0.5) * 0.3 }, r);
    bus.voice(c.t, 0.02, (x) => sin(PI2 * 180 * p * x) * exp(-x * 300), { gain: (c.gain ?? 0.35) * 0.6 });
  },
  /** tiny tick for counters / ticks / list items */
  tick(bus, c) {
    bus.voice(c.t, 0.015, (x) => sin(PI2 * 4200 * (c.pitch || 1) * x) * exp(-x * 600), { gain: c.gain ?? 0.18, pan: c.pan ?? 0 });
  },
  /** bubbly pop for elements appearing */
  pop(bus, c) {
    const p = c.pitch || 1, osc = new Osc('sine');
    bus.voice(c.t - 0.005, 0.09, (x) => osc.next((380 + 900 * (1 - exp(-x * 60))) * p) * exp(-x * 45) * (x < 0.003 ? x / 0.003 : 1),
      { gain: c.gain ?? 0.4, pan: c.pan ?? 0 });
  },
  /** air whoosh for container morphs, camera pushes, wipes; peaks at cue t */
  whoosh(bus, c, r) {
    const dur = c.dur || 0.55, start = c.t - dur * 0.6;
    const f = new SVF(500, 1.1), f2 = new SVF(500, 0.9);
    const lo = c.lo || 350, hi = c.hi || 3200;
    bus.voice2(start, dur, (x) => {
      const p = x / dur;
      const shape = Math.pow(sin(Math.PI * Math.min(1, p)), 1.6);
      const fc = lo + (hi - lo) * Math.pow(sin(Math.PI * Math.min(1, p * 0.85)), 2);
      f.set(fc, 1.1); f2.set(fc * 1.5, 0.9);
      const n = r() * 2 - 1;
      f.run(n); f2.run(n);
      const v = (f.bp * 0.8 + f2.bp * 0.4) * shape;
      const pan = (c.dir === 'left' ? 1 - 2 * p : -1 + 2 * p) * 0.7;
      const a = ((pan + 1) * Math.PI) / 4;
      return [v * Math.cos(a), v * Math.sin(a)];
    }, (c.gain ?? 0.5) * 1.4);
  },
  /** short swoosh for fast swipes / text slams */
  swoosh(bus, c, r) { SFX.whoosh(bus, { ...c, dur: c.dur || 0.22, lo: 900, hi: 6000, gain: c.gain ?? 0.35 }, r); },
  /** deep thump — logo land, big type slam */
  thump(bus, c, r) {
    const osc = new Osc('sine');
    bus.voice(c.t, 1.2, (x) => osc.next(42 + 70 * exp(-x * 14)) * exp(-x * 3.6), { gain: c.gain ?? 0.9 });
    noiseBurst(bus, c.t, 0.25, { lp: 260, decay: 18, gain: (c.gain ?? 0.9) * 0.5 }, r);
    bus.voice(c.t, 0.01, (x) => (r() * 2 - 1) * exp(-x * 400), { gain: 0.25 });
  },
  /** big hit: thump + crash tail */
  impact(bus, c, r) {
    SFX.thump(bus, { ...c, gain: c.gain ?? 1 }, r);
    noiseBurst(bus, c.t, 1.6, { hp: 2500, decay: 3.2, gain: (c.gain ?? 1) * 0.22 }, r);
  },
  /** bright success chime — checkmarks, "done" states */
  chime(bus, c) {
    const base = 1046.5 * (c.pitch || 1);
    const parts = [[1, 1, 3.2], [2.0, 0.45, 5], [3.01, 0.25, 7], [4.2, 0.12, 9]];
    bus.voice(c.t, 1.4, (x) => parts.reduce((s, [m, a, d]) => s + sin(PI2 * base * m * x) * a * exp(-x * d), 0) * (x < 0.002 ? x / 0.002 : 1),
      { gain: c.gain ?? 0.22, pan: c.pan ?? 0 });
    bus.voice(c.t + 0.09, 1.2, (x) => parts.reduce((s, [m, a, d]) => s + sin(PI2 * base * 1.498 * m * x) * a * exp(-x * d), 0) * (x < 0.002 ? x / 0.002 : 1),
      { gain: (c.gain ?? 0.22) * 0.8, pan: c.pan ?? 0 });
  },
  /** sparkle shimmer — reveals, magic moments */
  shimmer(bus, c, r) {
    const dur = c.dur || 0.6;
    for (let k = 0; k < 9; k++) {
      const f = 2200 + r() * 3200, t = c.t + (k / 9) * dur * 0.8;
      bus.voice(t, 0.25, (x) => sin(PI2 * f * x) * exp(-x * 18), { gain: (c.gain ?? 0.12), pan: (r() - 0.5) * 1.4 });
    }
  },
  /** rising tension into the cue time (riser occupies [t - dur, t]) */
  riser(bus, c, r) {
    const dur = c.dur || 2, start = c.t - dur;
    const f = new SVF(400, 2), osc = new Osc('saw'), osc2 = new Osc('saw', 0.3);
    bus.voice(start, dur, (x) => {
      const p = x / dur;
      f.set(300 + 7000 * p * p, 2);
      f.run(r() * 2 - 1);
      const tone = (osc.next(110 + 880 * p * p) + osc2.next(111.5 + 885 * p * p)) * 0.15;
      return (f.bp * 0.9 + tone * 0.5) * p * p;
    }, { gain: c.gain ?? 0.35 });
  },
  /** digital glitch stutter */
  glitch(bus, c, r) {
    const n = 5 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const t = c.t + k * (0.018 + r() * 0.02), f = 200 + r() * 2400, osc = new Osc('square');
      bus.voice(t, 0.016, () => Math.round(osc.next(f) * 4) / 4, { gain: (c.gain ?? 0.18), pan: (r() - 0.5) * 1.2 });
    }
  },
  /** short notification ding (toast, message) */
  ding(bus, c) {
    const f = 1568 * (c.pitch || 1);
    bus.voice(c.t, 0.8, (x) => (sin(PI2 * f * x) + 0.3 * sin(PI2 * f * 2.01 * x)) * exp(-x * 6) * (x < 0.002 ? x / 0.002 : 1), { gain: c.gain ?? 0.2, pan: c.pan ?? 0 });
  },
  /** soft woody tap for toggles / switches */
  toggle(bus, c, r) {
    bus.voice(c.t, 0.06, (x) => sin(PI2 * (900 - 300 * x * 10) * x) * exp(-x * 90), { gain: c.gain ?? 0.3, pan: c.pan ?? 0 });
    noiseBurst(bus, c.t, 0.015, { bp: 5000, decay: 400, gain: 0.12 }, r);
  },
  /** reverse-swell into t (pairs well with a cut) */
  suck(bus, c, r) {
    const dur = c.dur || 0.5, start = c.t - dur, f = new SVF(800, 0.8);
    bus.voice(start, dur, (x) => {
      const p = x / dur;
      f.set(400 + 4000 * p, 0.8);
      f.run(r() * 2 - 1);
      return f.bp * Math.pow(p, 3);
    }, { gain: c.gain ?? 0.5 });
  },
};

/** render all cues into a bus */
export function renderSfx(bus, cues) {
  cues.forEach((c, i) => {
    const fn = SFX[c.type];
    if (!fn) { console.warn(`  ⚠ unknown sfx type "${c.type}" at ${c.t}s — skipped (known: ${Object.keys(SFX).join(', ')})`); return; }
    fn(bus, c, rng(1000 + i * 7919));
  });
  return bus;
}
