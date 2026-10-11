#!/usr/bin/env node
/**
 * Score a film in code: original music bed + synthesized SFX + beats.json on one timeline.
 *
 *   node engine/audio/score.mjs projects/<name> [--beats-only] [--no-mix] [--bpm 120] [--style pulse]
 *
 * Reads   audio/score.json  (optional; defaults below)  and  audio/cues.json  (written from
 *         M.cue() calls by `npm run stills` / `npm run render`).
 * Writes  audio/beats.json  { bpm, offset, beats[], downbeats[], hits[] }
 *         audio/music.wav, audio/sfx.wav, then audio/mix.wav via mix.mjs (unless --no-mix).
 *
 * Workflow: write score.json → `--beats-only` → retime the animation to beats.json via
 * M.loadBeats()/M.beat(n) → stills (refreshes cues) → score again → render.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, projectDir } from '../lib/common.mjs';
import { SR, Bus, SVF, Osc, rng, mtof, reverb, keyRoot, chord } from './dsp.mjs';
import { renderSfx } from './sfx.mjs';
import { mix } from './mix.mjs';

const STYLES = {
  pulse:   ['kick', 'hat', 'bass', 'pad', 'arp'],
  house:   ['kick', 'clap', 'hat', 'ohat', 'bass', 'pad', 'stab'],
  minimal: ['kick', 'hat', 'pad', 'sub'],
  halftime:['kick', 'clap', 'hat16', 'sub', 'pad', 'arp'],
  ambient: ['pad', 'arp', 'sub'],
  none:    [],
};

const a = args();
const dir = projectDir(a._[0]);
const audioDir = path.join(dir, 'audio');
fs.mkdirSync(audioDir, { recursive: true });
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const S = read(path.join(audioDir, 'score.json')) || {};
const cuesFile = read(path.join(audioDir, 'cues.json')) || {};

const bpm = +a.bpm || S.bpm || 120;
const duration = S.duration || cuesFile.comp?.duration || 15;
const style = a.style || S.style || 'pulse';
const offset = S.offset || 0;
const spb = 60 / bpm, bar = spb * 4;
const root = keyRoot(S.key || 'A');
const scale = S.scale || 'minor';
const prog = S.progression || (scale === 'major' ? [1, 5, 6, 4] : [1, 6, 3, 7]);
const drop = S.drop ?? (duration > 8 ? offset + bar * 2 : null);
const outroAt = S.outro ?? (duration - Math.min(bar, duration * 0.15));

// ---- beats.json ----
const beats = [], downbeats = [];
for (let i = 0, t = offset; t < duration + 1e-6; i++, t = offset + i * spb) {
  beats.push(+t.toFixed(4));
  if (i % 4 === 0) downbeats.push(+t.toFixed(4));
}
const cues = [...(S.sfx || []), ...(S.useCues === false ? [] : cuesFile.cues || [])]
  .filter((c) => c.t >= 0 && c.t <= duration + 0.5)
  .sort((x, y) => x.t - y.t);
const hits = cues.map(({ t, type }) => ({ t, type }));
if (drop != null) hits.push({ t: +drop.toFixed(4), type: 'drop' });
const beatsJson = { bpm, offset, duration, barSeconds: bar, beats, downbeats, hits: hits.sort((x, y) => x.t - y.t) };
fs.writeFileSync(path.join(audioDir, 'beats.json'), JSON.stringify(beatsJson, null, 2));
console.log(`✔ beats.json — ${bpm} bpm, ${beats.length} beats, ${downbeats.length} bars, ${hits.length} hits`);
if (a['beats-only']) process.exit(0);

// ---- arrangement ----
const sections = S.sections || (() => {
  const L = STYLES[style] || STYLES.pulse;
  if (!L.length) return [];
  const intro = ['pad', ...(L.includes('arp') ? ['arp'] : []), ...(L.includes('hat') || L.includes('hat16') ? ['hat'] : [])];
  const out = [];
  if (drop && drop > 0.01) out.push({ from: 0, to: drop, layers: intro });
  out.push({ from: drop || 0, to: outroAt, layers: L });
  out.push({ from: outroAt, to: duration, layers: ['pad', 'ring'] });
  return out;
})();
const active = (layer, t) => sections.some((s) => t >= s.from - 1e-6 && t < s.to - 1e-6 && s.layers.includes(layer));

const music = new Bus(duration + 0.01);
const send = new Bus(duration + 0.01);          // reverb send
const r = rng(S.seed || 7);
const chordAt = (t) => {
  const b = Math.floor(Math.max(0, t - offset) / bar);
  return chord(root, scale, prog[b % prog.length], 4);
};
const kicks = [];

// drums + bass on the 16th grid
for (let i = 0; ; i++) {
  const t = offset + i * (spb / 4);
  if (t >= duration) break;
  const step = i % 16, beatInBar = Math.floor(step / 4), onBeat = step % 4 === 0;

  if (active('kick', t)) {
    const halftime = style === 'halftime';
    const hit = halftime ? step === 0 || step === 10 : onBeat;
    if (hit) {
      kicks.push(t);
      const o = new Osc('sine');
      music.voice(t, 0.5, (x) => {
        const v = o.next(46 + 120 * Math.exp(-x * 32)) * Math.exp(-x * 7.5);
        return Math.tanh(v * 1.8) * 0.9 + (r() * 2 - 1) * Math.exp(-x * 320) * 0.15;
      }, { gain: 0.85 });
    }
  }
  if (active('clap', t) && (style === 'halftime' ? step === 8 : beatInBar % 2 === 1 && onBeat)) {
    for (const d of [0, 0.011, 0.022]) {
      const f = new SVF(1300, 1.1);
      music.voice(t + d, d === 0.022 ? 0.25 : 0.012, (x) => (f.run(r() * 2 - 1), f.bp) * Math.exp(-x * (d === 0.022 ? 16 : 120)), { gain: 0.45 });
    }
    send.voice(t, 0.2, (x) => (r() * 2 - 1) * Math.exp(-x * 20), { gain: 0.12 });
  }
  const hatHit = (active('hat', t) && step % 4 === 2) || (active('hat16', t) && (step % 2 === 0 || (step >= 12 && r() > 0.4)));
  if (hatHit) {
    const f = new SVF(8000, 0.7), pan = step % 8 < 4 ? -0.25 : 0.25;
    music.voice(t, 0.05, (x) => (f.run(r() * 2 - 1), f.hp) * Math.exp(-x * 70), { gain: 0.16, pan });
  }
  if (active('ohat', t) && step % 4 === 2) {
    const f = new SVF(7000, 0.7);
    music.voice(t, 0.3, (x) => (f.run(r() * 2 - 1), f.hp) * Math.exp(-x * 11), { gain: 0.1, pan: 0.2 });
  }
  if (active('bass', t) && step % 2 === 0) {
    const n = chordAt(t)[0] - 12;
    const o = new Osc('saw'), o2 = new Osc('square'), f = new SVF(300, 1.2), len = spb * 0.45;
    music.voice(t, len, (x) => {
      f.set(140 + 1100 * Math.exp(-x * 14), 1.4);
      f.run(o.next(mtof(n)) * 0.7 + o2.next(mtof(n - 12)) * 0.3);
      const env = Math.min(1, x / 0.003) * (x > len - 0.02 ? (len - x) / 0.02 : 1);
      return f.lp * env;
    }, { gain: 0.42 });
  }
  if (active('sub', t) && step === 0) {
    const n = chordAt(t)[0] - 24, o = new Osc('sine'), len = bar * 0.95;
    music.voice(t, len, (x) => o.next(mtof(n)) * Math.min(1, x / 0.05) * Math.min(1, (len - x) / 0.2), { gain: 0.4 });
  }
  if (active('arp', t) && (style === 'ambient' ? step % 4 === 0 : step % 2 === 0)) {
    const ch = chordAt(t), seq = [0, 1, 2, 3, 2, 1, 3, 1];
    const n = ch[seq[(i / 2) % seq.length | 0]] + 12;
    const o = new Osc('tri'), o2 = new Osc('square'), f = new SVF(2400, 0.9), pan = (i / 2) % 2 ? 0.45 : -0.45;
    const fn = (x) => (f.run(o.next(mtof(n)) * 0.8 + o2.next(mtof(n) * 2) * 0.12), f.lp) * Math.exp(-x * 13) * Math.min(1, x / 0.002);
    music.voice(t, 0.32, fn, { gain: 0.16, pan });
    const o3 = new Osc('tri');
    send.voice(t, 0.32, (x) => o3.next(mtof(n)) * Math.exp(-x * 13), { gain: 0.1 });
  }
  if (active('stab', t) && (step === 0 || step === 6)) {
    const ch = chordAt(t), oscs = ch.map(() => new Osc('saw')), f = new SVF(1800, 1);
    music.voice(t, 0.25, (x) => {
      f.set(500 + 2600 * Math.exp(-x * 18), 1);
      f.run(oscs.reduce((s, o, k) => s + o.next(mtof(ch[k] + 12)), 0) / ch.length);
      return f.lp * Math.exp(-x * 9);
    }, { gain: 0.2 });
  }
}

// pads per bar (and the final ringing chord)
for (let b = 0; ; b++) {
  const t = offset + b * bar;
  if (t >= duration) break;
  const ring = active('ring', t);
  if (!active('pad', t) && !ring) continue;
  const ch = chordAt(t), len = ring ? duration - t : bar + 0.6, atk = ring ? 0.05 : 0.35;
  ch.forEach((n, k) => {
    [-0.07, 0, 0.07].forEach((det, v) => {
      const o = new Osc('saw', r()), f = new SVF(1200, 0.7);
      const fn = (x) => {
        const env = Math.min(1, x / atk) * Math.min(1, (len - x) / 0.6) * (ring ? Math.exp(-x * 0.6) : 1);
        f.run(o.next(mtof(n + 12 + det)));
        return f.lp * Math.max(0, env);
      };
      music.voice(t, len, fn, { gain: 0.05, pan: (v - 1) * 0.6 });
      if (v === 1) send.voice(t, len, fn, { gain: 0.06 });
    });
  });
}

// riser + impact into the drop
if (drop && drop > 1 && sections.length) {
  renderSfx(music, [{ t: drop, type: 'riser', dur: Math.min(bar, drop), gain: 0.25 }]);
  renderSfx(music, [{ t: drop, type: 'impact', gain: 0.55 }]);
}

// sidechain pump on everything but the kick (approximate: duck after each kick)
if (kicks.length) {
  let k = 0;
  for (let i = 0; i < music.n; i++) {
    const t = i / SR;
    while (k + 1 < kicks.length && kicks[k + 1] <= t) k++;
    const dt = t - kicks[k];
    if (dt >= 0 && dt < spb) {
      const g = 1 - 0.35 * Math.exp(-dt * 9);
      music.L[i] *= g; music.R[i] *= g;
    }
  }
}

music.add(reverb(send, { room: 0.86, damp: 0.3 }), 1);
if (sections.length) music.master(-3).fadeOut(0.04);
music.writeWav(path.join(audioDir, 'music.wav'));

// ---- SFX ----
const sfx = new Bus(duration + 0.01);
renderSfx(sfx, cues);
const sfxSend = reverb(sfx, { room: 0.7, damp: 0.4 });
sfx.add(sfxSend, 0.35);
if (cues.length) sfx.master(-2, 1.05).fadeOut(0.02);
sfx.writeWav(path.join(audioDir, 'sfx.wav'));
console.log(`✔ music.wav (${style}, ${S.key || 'A'} ${scale}, prog ${prog.join('-')}) + sfx.wav (${cues.length} cues)`);

if (!a['no-mix']) await mix(dir, { duration, music: S.gain?.music, sfx: S.gain?.sfx });
