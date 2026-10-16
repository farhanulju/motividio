// Synthesized UI / motion sound effects. Each fn(bus, cue, rand) writes into a Bus.
// cue: { t, type, dur?, gain?, pan?, pitch? }  — t is the moment the sound "lands".
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SR, SVF, Osc, rng } from './dsp.mjs';

// decoded audio files (mp3/wav/…) as stereo Float32 at SR, cached per path
const SAMPLES = new Map();
function loadSample(file) {
  if (SAMPLES.has(file)) return SAMPLES.get(file);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout.length) throw new Error(`cannot decode ${file}`);
  const buf = Buffer.from(r.stdout); // own, aligned copy
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const n = f.length / 2, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  const smp = { L, R, n };
  SAMPLES.set(file, smp);
  return smp;
}

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
  /**
   * play an audio file (voice reaction, foley recording). cue: { file, gain, pan, rate (pitch/speed),
   * from (s into file), dur (max s), fadeIn, fadeOut, lp (Hz, muffle), hp (Hz, thin/phone) }
   */
  sample(bus, c) {
    const file = path.isAbsolute(c.file) ? c.file : path.join(c.baseDir || '.', c.file);
    if (!fs.existsSync(file)) { console.warn(`  ⚠ sample missing: ${file}`); return; }
    const s = loadSample(file), rate = c.rate || 1, from = (c.from || 0) * SR;
    const len = Math.min(c.dur ?? Infinity, (s.n - from) / SR / rate);
    const fi = c.fadeIn || 0.004, fo = c.fadeOut || 0.03;
    const fl = [new SVF(c.lp || 20000, 0.7), new SVF(c.lp || 20000, 0.7)], fh = [new SVF(c.hp || 20, 0.7), new SVF(c.hp || 20, 0.7)];
    const g = c.gain ?? 1, pan = c.pan ?? 0, a = ((pan + 1) * Math.PI) / 4, gl = Math.cos(a) * Math.SQRT2, gr = Math.sin(a) * Math.SQRT2;
    bus.voice2(c.t, len, (x) => {
      const pos = from + x * SR * rate, i = Math.floor(pos), fr = pos - i;
      if (i + 1 >= s.n) return [0, 0];
      let l = s.L[i] + (s.L[i + 1] - s.L[i]) * fr, r = s.R[i] + (s.R[i + 1] - s.R[i]) * fr;
      if (c.lp) { l = fl[0].run(l).lp; r = fl[1].run(r).lp; }
      if (c.hp) { l = fh[0].run(l).hp; r = fh[1].run(r).hp; }
      const env = Math.min(1, x / fi) * Math.min(1, Math.max(0, (len - x) / fo));
      return [l * env * gl * g, r * env * gr * g];
    });
  },
  /** one cube layer turn. style: 'thock' (magnetic speedcube) | 'crunchy' (cheap store cube) | 'loose' */
  turn(bus, c, r) {
    const st = c.style || 'thock', p = (c.pitch || 1) * (0.9 + r() * 0.2), g = (c.gain ?? 0.35) * (0.75 + r() * 0.5), pan = c.pan ?? (r() - 0.5) * 0.3;
    if (st === 'crunchy') {
      for (let k = 0; k < 5; k++) noiseBurst(bus, c.t + k * (0.006 + r() * 0.01), 0.02, { bp: (1400 + r() * 2200) * p, q: 2, decay: 260, gain: g * (0.5 + r() * 0.5), pan }, r);
      bus.voice(c.t + 0.045, 0.03, (x) => sin(PI2 * 260 * p * x) * exp(-x * 140), { gain: g * 0.6, pan });
    } else {
      noiseBurst(bus, c.t, 0.03, { bp: (st === 'loose' ? 2600 : 1900) * p, q: 1.3, decay: st === 'loose' ? 220 : 160, gain: g, pan }, r);
      bus.voice(c.t, 0.035, (x) => sin(PI2 * 210 * p * x) * exp(-x * 110), { gain: g * (st === 'thock' ? 0.9 : 0.4), pan });
      noiseBurst(bus, c.t + 0.012, 0.012, { hp: 5000, decay: 500, gain: g * 0.25, pan }, r);
    }
  },
  /** a burst of turns: { t, dur, tps, style, gain } — the sound of a solve */
  cube(bus, c, r) {
    const dur = c.dur || 1, tps = c.tps || 8;
    for (let t = 0; t < dur;) {
      SFX.turn(bus, { t: c.t + t, style: c.style, gain: c.gain ?? 0.3, pitch: c.pitch }, r);
      t += (1 / tps) * (0.55 + r() * 0.9) * (r() < 0.08 ? 2.2 : 1); // human rhythm: bursts and pauses
    }
  },
  /** cheap cube locking up then a piece popping out and clattering */
  popcube(bus, c, r) {
    noiseBurst(bus, c.t, 0.05, { bp: 900, q: 0.8, decay: 70, gain: (c.gain ?? 0.5) * 0.8 }, r);
    bus.voice(c.t, 0.04, (x) => (r() * 2 - 1) * exp(-x * 160), { gain: (c.gain ?? 0.5) * 0.7 });
    [0.22, 0.36, 0.45, 0.51, 0.55].forEach((d, k) => noiseBurst(bus, c.t + d, 0.025, { bp: 2800 + r() * 1500, q: 2, decay: 220, gain: (c.gain ?? 0.5) * 0.5 * Math.pow(0.7, k), pan: 0.3 + k * 0.1 }, r));
  },
  /** stackmat / hands slapping a table */
  slam(bus, c, r) {
    const osc = new Osc('sine');
    bus.voice(c.t, 0.25, (x) => osc.next(70 + 90 * exp(-x * 30)) * exp(-x * 16), { gain: (c.gain ?? 0.6) });
    noiseBurst(bus, c.t, 0.08, { lp: 1800, decay: 45, gain: (c.gain ?? 0.6) * 0.6 }, r);
  },
  /** old button phone key beep */
  beep(bus, c) {
    const f = 1320 * (c.pitch || 1), osc = new Osc('square'), flt = new SVF(2600, 0.7), d = c.dur || 0.09;
    bus.voice(c.t, d, (x) => (flt.run(osc.next(f)), flt.lp) * Math.min(1, x / 0.003) * Math.min(1, (d - x) / 0.01), { gain: c.gain ?? 0.12, pan: c.pan ?? 0 });
  },
  heartbeat(bus, c) {
    for (const [d, gg] of [[0, 1], [0.16, 0.7]]) {
      const osc = new Osc('sine');
      bus.voice(c.t + d, 0.25, (x) => osc.next(48 + 30 * exp(-x * 25)) * exp(-x * 18) * Math.min(1, x / 0.005), { gain: (c.gain ?? 0.7) * gg });
    }
  },
  /** applause: { t, dur, density (claps/s), gain } — swells in and decays */
  applause(bus, c, r) {
    const dur = c.dur || 2.5, dens = c.density || 70;
    const n = Math.floor(dur * dens);
    for (let k = 0; k < n; k++) {
      const x = r() * dur, env = Math.min(1, x / 0.25) * Math.pow(1 - x / dur, 0.8);
      noiseBurst(bus, c.t + x, 0.03, { bp: 900 + r() * 1800, q: 0.9, decay: 140 + r() * 80, gain: (c.gain ?? 0.25) * env * (0.4 + r() * 0.6), pan: (r() - 0.5) * 1.6 }, r);
    }
  },
  /** VHS / tape rewind: warbling squeal + hiss over [t, t+dur] */
  rewind(bus, c, r) {
    const dur = c.dur || 1.2, o = new Osc('tri'), o2 = new Osc('sine'), f = new SVF(3000, 2);
    bus.voice(c.t, dur, (x) => {
      const p = x / dur, w = 1800 + 2400 * p + 400 * sin(PI2 * 9 * x);
      f.set(2500 + 3000 * p, 2); f.run(r() * 2 - 1);
      const env = Math.min(1, x / 0.08) * Math.min(1, (dur - x) / 0.08);
      return (o.next(w) * 0.25 + o2.next(w * 1.5) * 0.12 + f.bp * 0.5) * env;
    }, { gain: c.gain ?? 0.22 });
  },
  /** paper rustle / pages / notes flying */
  paper(bus, c, r) {
    const dur = c.dur || 0.4, f = new SVF(3200, 0.8);
    let am = 0;
    bus.voice(c.t, dur, (x) => { if (r() < 0.004) am = 0.4 + r() * 0.6; am *= 0.9992; f.run(r() * 2 - 1); return f.bp * am * Math.min(1, (dur - x) / 0.05); }, { gain: c.gain ?? 0.4, pan: c.pan ?? 0 });
  },
  /** coaster chain-lift clack (metallic) */
  clack(bus, c, r) {
    noiseBurst(bus, c.t, 0.03, { bp: 2400, q: 3, decay: 180, gain: c.gain ?? 0.3 }, r);
    bus.voice(c.t, 0.08, (x) => sin(PI2 * 620 * x) * exp(-x * 60), { gain: (c.gain ?? 0.3) * 0.5 });
  },
  /** camera shutter / flashbulb */
  shutter(bus, c, r) {
    noiseBurst(bus, c.t, 0.02, { hp: 3000, decay: 300, gain: c.gain ?? 0.3, pan: c.pan ?? 0 }, r);
    noiseBurst(bus, c.t + 0.06, 0.03, { bp: 1800, q: 1.5, decay: 200, gain: (c.gain ?? 0.3) * 0.8, pan: c.pan ?? 0 }, r);
  },
  /** crowd murmur bed: { t, dur, gain } */
  crowd(bus, c, r) {
    const dur = c.dur || 2, fs_ = [new SVF(450, 3), new SVF(1100, 3), new SVF(2300, 3)];
    let a1 = 0.5, a2 = 0.5;
    bus.voice2(c.t, dur, (x) => {
      if (r() < 0.002) a1 = r();
      if (r() < 0.002) a2 = r();
      const n = r() * 2 - 1;
      fs_.forEach((f) => f.run(n));
      const env = Math.min(1, x / 0.4) * Math.min(1, (dur - x) / 0.5);
      return [(fs_[0].bp * a1 + fs_[1].bp * 0.6) * env, (fs_[1].bp * a2 + fs_[2].bp * 0.4) * env];
    }, c.gain ?? 0.25);
  },
  /** rain bed */
  rain(bus, c, r) {
    const dur = c.dur || 3, f = new SVF(5000, 0.5);
    bus.voice2(c.t, dur, (x) => {
      f.run(r() * 2 - 1);
      const drop = r() < 0.003 ? (r() * 2 - 1) * 2 : 0;
      const env = Math.min(1, x / 0.6) * Math.min(1, (dur - x) / 0.8);
      return [(f.lp * 0.6 + drop * 0.3) * env, (f.lp * 0.6 - drop * 0.3) * env];
    }, c.gain ?? 0.18);
  },
  /** jet passing overhead */
  plane(bus, c, r) {
    const dur = c.dur || 3, f = new SVF(400, 0.7);
    bus.voice2(c.t, dur, (x) => {
      const p = x / dur, sh = Math.pow(sin(Math.PI * p), 2);
      f.set(300 + 2500 * sh, 0.7);
      f.run(r() * 2 - 1);
      const pan = -0.8 + 1.6 * p, a = ((pan + 1) * Math.PI) / 4;
      return [f.lp * sh * Math.cos(a), f.lp * sh * Math.sin(a)];
    }, c.gain ?? 0.45);
  },
  /** marker on a wall / whiteboard squeak */
  marker(bus, c, r) {
    const dur = c.dur || 0.35, o = new Osc('sine'), f = new SVF(2000, 4);
    bus.voice(c.t, dur, (x) => { f.run((r() * 2 - 1) * 0.6 + o.next(1900 + 300 * sin(PI2 * 7 * x)) * 0.3); return f.bp * Math.min(1, x / 0.02) * Math.min(1, (dur - x) / 0.03); }, { gain: c.gain ?? 0.18, pan: c.pan ?? 0 });
  },
  /** pencil scratching on paper */
  pencil(bus, c, r) {
    const dur = c.dur || 0.5, f = new SVF(4500, 1);
    bus.voice(c.t, dur, (x) => { f.run(r() * 2 - 1); return f.bp * (0.4 + 0.6 * Math.abs(sin(PI2 * 6 * x))) * Math.min(1, (dur - x) / 0.04); }, { gain: c.gain ?? 0.2, pan: c.pan ?? 0 });
  },
  /** soft object set down (cube on shelf / table) */
  thunk(bus, c, r) {
    const osc = new Osc('sine');
    bus.voice(c.t, 0.15, (x) => osc.next(180 * (c.pitch || 1)) * exp(-x * 40), { gain: c.gain ?? 0.3 });
    noiseBurst(bus, c.t, 0.04, { bp: 1200, q: 1, decay: 90, gain: (c.gain ?? 0.3) * 0.5 }, r);
  },
  /** medal / trophy clink */
  clink(bus, c) {
    const f = 2800 * (c.pitch || 1);
    bus.voice(c.t, 0.6, (x) => (sin(PI2 * f * x) + 0.6 * sin(PI2 * f * 2.76 * x) + 0.3 * sin(PI2 * f * 5.4 * x)) * exp(-x * 9), { gain: c.gain ?? 0.1, pan: c.pan ?? 0 });
  },
  /** dhol stroke: { t, hand: 'dha' (bass) | 'ta' (treble) } */
  dhol(bus, c, r) {
    const osc = new Osc('sine');
    if (c.hand === 'ta') {
      bus.voice(c.t, 0.12, (x) => osc.next(420) * exp(-x * 35), { gain: (c.gain ?? 0.35) * 0.7, pan: 0.2 });
      noiseBurst(bus, c.t, 0.05, { bp: 2500, q: 1, decay: 90, gain: (c.gain ?? 0.35) * 0.5, pan: 0.2 }, r);
    } else {
      bus.voice(c.t, 0.5, (x) => osc.next(65 + 70 * exp(-x * 18)) * exp(-x * 7), { gain: c.gain ?? 0.5, pan: -0.15 });
    }
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

/** render all cues into a bus. opts.baseDir resolves relative `file` paths of sample cues. */
export function renderSfx(bus, cues, opts = {}) {
  cues.forEach((c, i) => {
    const fn = SFX[c.type];
    if (!fn) { console.warn(`  ⚠ unknown sfx type "${c.type}" at ${c.t}s — skipped (known: ${Object.keys(SFX).join(', ')})`); return; }
    fn(bus, c.type === 'sample' ? { ...c, baseDir: opts.baseDir } : c, rng(1000 + i * 7919));
  });
  return bus;
}
