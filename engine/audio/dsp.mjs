// Tiny DSP toolkit for the synthesized score + SFX. Pure JS, deterministic.
import fs from 'node:fs';

export const SR = 48000;

export class Bus {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
  }
  /** render fn(tLocal, i) -> mono sample into [t0, t0+len) with pan -1..1 and gain */
  voice(t0, len, fn, { pan = 0, gain = 1 } = {}) {
    const s0 = Math.max(0, Math.round(t0 * SR));
    const s1 = Math.min(this.n, Math.round((t0 + len) * SR));
    const a = ((pan + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * gain * Math.SQRT2, gr = Math.sin(a) * gain * Math.SQRT2;
    const skip = s0 - Math.round(t0 * SR);
    for (let i = s0, k = skip; i < s1; i++, k++) {
      const v = fn(k / SR, k);
      this.L[i] += v * gl;
      this.R[i] += v * gr;
    }
  }
  /** stereo voice: fn returns [l, r] */
  voice2(t0, len, fn, gain = 1) {
    const s0 = Math.max(0, Math.round(t0 * SR));
    const s1 = Math.min(this.n, Math.round((t0 + len) * SR));
    const skip = s0 - Math.round(t0 * SR);
    for (let i = s0, k = skip; i < s1; i++, k++) {
      const [l, r] = fn(k / SR, k);
      this.L[i] += l * gain;
      this.R[i] += r * gain;
    }
  }
  add(other, gain = 1) {
    for (let i = 0; i < this.n; i++) { this.L[i] += other.L[i] * gain; this.R[i] += other.R[i] * gain; }
    return this;
  }
  peak() {
    let p = 0;
    for (let i = 0; i < this.n; i++) p = Math.max(p, Math.abs(this.L[i]), Math.abs(this.R[i]));
    return p;
  }
  /** soft saturation then normalize to target peak (dBFS) */
  master(targetDb = -1, drive = 1.2) {
    for (let i = 0; i < this.n; i++) {
      this.L[i] = Math.tanh(this.L[i] * drive) / Math.tanh(drive);
      this.R[i] = Math.tanh(this.R[i] * drive) / Math.tanh(drive);
    }
    const p = this.peak();
    if (p > 0) {
      const g = Math.pow(10, targetDb / 20) / p;
      for (let i = 0; i < this.n; i++) { this.L[i] *= g; this.R[i] *= g; }
    }
    return this;
  }
  fadeOut(sec = 0.05) {
    const m = Math.round(sec * SR);
    for (let k = 0; k < m; k++) {
      const g = k / m, i = this.n - 1 - k;
      if (i < 0) break;
      this.L[i] *= g; this.R[i] *= g;
    }
    return this;
  }
  writeWav(file) {
    const n = this.n, buf = Buffer.alloc(44 + n * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
    for (let i = 0, o = 44; i < n; i++, o += 4) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.L[i])) * 32767), o);
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.R[i])) * 32767), o + 2);
    }
    fs.writeFileSync(file, buf);
  }
}

/** Zavalishin TPT state-variable filter — stable at any cutoff */
export class SVF {
  constructor(fc = 1000, q = 0.707) { this.ic1 = 0; this.ic2 = 0; this.set(fc, q); }
  set(fc, q = this.q) {
    this.q = q;
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 10), SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }
  run(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = v0 - this.k * v1 - v2;
    return this;
  }
}

/** seeded PRNG (mulberry32) */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const polyblep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};

/** band-limited oscillator with running phase */
export class Osc {
  constructor(type = 'saw', phase = 0) { this.type = type; this.ph = phase; }
  next(freq) {
    const dt = freq / SR;
    this.ph += dt;
    if (this.ph >= 1) this.ph -= 1;
    const p = this.ph;
    switch (this.type) {
      case 'sine': return Math.sin(2 * Math.PI * p);
      case 'tri': return 1 - 4 * Math.abs(p - 0.5);
      case 'square': {
        let v = p < 0.5 ? 1 : -1;
        v += polyblep(p, dt);
        v -= polyblep((p + 0.5) % 1, dt);
        return v;
      }
      default: return 2 * p - 1 - polyblep(p, dt);
    }
  }
}

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** simple stereo Schroeder/Freeverb-style reverb, processes a whole bus into a new bus */
export function reverb(src, { room = 0.84, damp = 0.25, wet = 1 } = {}) {
  const out = new Bus(src.n / SR);
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * scale));
  const aps = [556, 441, 341, 225].map((d) => Math.round(d * scale));
  const chan = (input, output, spread) => {
    const cbuf = combs.map((d) => ({ b: new Float32Array(d + spread), i: 0, f: 0 }));
    const abuf = aps.map((d) => ({ b: new Float32Array(d + spread), i: 0 }));
    for (let n = 0; n < input.length; n++) {
      const x = input[n] * 0.015;
      let y = 0;
      for (const c of cbuf) {
        const o = c.b[c.i];
        c.f = o * (1 - damp) + c.f * damp;
        c.b[c.i] = x + c.f * room;
        c.i = (c.i + 1) % c.b.length;
        y += o;
      }
      for (const a of abuf) {
        const o = a.b[a.i];
        a.b[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.b.length;
        y = o - y;
      }
      output[n] = y * wet;
    }
  };
  const mono = new Float32Array(src.n);
  for (let i = 0; i < src.n; i++) mono[i] = (src.L[i] + src.R[i]) * 0.5;
  chan(mono, out.L, 0);
  chan(mono, out.R, 23);
  return out;
}

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export const keyRoot = (k = 'A') => 48 + (NOTE[k] ?? 9); // octave-3 root midi

/** midi notes of a scale-degree chord (degree 1-based), size 3 or 4 */
export function chord(root, scale, degree, size = 4) {
  const sc = SCALES[scale] || SCALES.minor;
  const notes = [];
  for (let j = 0; j < size; j++) {
    const k = degree - 1 + j * 2;
    notes.push(root + 12 * Math.floor(k / 7) + sc[k % 7]);
  }
  return notes;
}
