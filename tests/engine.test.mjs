// Node-side engine pieces: arg parsing, versioned outputs, input hashing, the learning loop,
// the recorded sound library and the WAV level meter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { args, nextVersion, hashTree, brief } from '../engine/lib/common.mjs';
import { critiqueScores, reward, analyse, ACTIVATE_AT } from '../engine/learn.mjs';
import { pickVariant, recordedCues, musicCues, SYNTH_OK } from '../engine/library.mjs';
import { readWav, rmsDb } from '../engine/audio/mix.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'motividio-test-'));

test('args: flags, values and positionals', () => {
  assert.deepEqual(args(['projects/x', '--fast', '--from', '2', '--format', 'all']), { _: ['projects/x'], fast: true, from: '2', format: 'all' });
});

test('nextVersion never returns an existing file', () => {
  const d = tmp();
  const f = path.join(d, 'film.mp4');
  assert.equal(nextVersion(f), f);
  fs.writeFileSync(f, '');
  assert.equal(nextVersion(f), path.join(d, 'film-v2.mp4'));
  fs.writeFileSync(path.join(d, 'film-v2.mp4'), '');
  assert.equal(nextVersion(f), path.join(d, 'film-v3.mp4'));
});

test('hashTree: ignores out/ and notes; media: false ignores audio renders', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'audio'));
  fs.mkdirSync(path.join(d, 'out'));
  fs.writeFileSync(path.join(d, 'index.html'), '<b>a</b>');
  fs.writeFileSync(path.join(d, 'audio', 'mix.wav'), 'x');
  const h0 = hashTree(d), v0 = hashTree(d, { media: false });
  fs.writeFileSync(path.join(d, 'out', 'film.mp4'), 'render');
  fs.writeFileSync(path.join(d, 'critique-1.md'), 'notes');
  assert.equal(hashTree(d), h0);
  fs.writeFileSync(path.join(d, 'audio', 'mix.wav'), 'y');
  assert.notEqual(hashTree(d), h0);
  assert.equal(hashTree(d, { media: false }), v0);
  fs.writeFileSync(path.join(d, 'index.html'), '<b>b</b>');
  assert.notEqual(hashTree(d, { media: false }), v0);
});

test('brief strips Playwright prefixes and long stacks', () => {
  const e = new Error('page.evaluate: Error: at 1.5s (frame 45): boom\n    at a (x.js:1)\n    at b (y.js:2)');
  assert.equal(brief(e), 'at 1.5s (frame 45): boom\n    at a (x.js:1)');
});

test('critiqueScores: first number per axis = round 1, last = final, across files', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'critique-1.md'), '| Axis | Score |\n|---|---|\n| Hook — first 1.5s | 6 | x |\n| Sound | 7 | y |\n');
  fs.writeFileSync(path.join(d, 'critique-2.md'), '| Axis | R1 | R2 |\n|---|---|---|\n| Hook | 7 | 9 | z |\n| **Sound** | 8/10 | ok |\n');
  const s = critiqueScores(d);
  assert.deepEqual(s.first, { hook: 6, sound: 7 });
  assert.deepEqual(s.final, { hook: 9, sound: 8 });
  assert.equal(s.rounds, 2);
});

test('reward weighs the user verdict as much as the whole critique', () => {
  const base = { scores: { final: { hook: 8, sound: 8 } }, rounds: 2, user: { revisions: 0 }, mistakes: [] };
  const acc = reward({ ...base, user: { verdict: 'accepted', revisions: 0 } });
  const rej = reward({ ...base, user: { verdict: 'rejected', revisions: 0 } });
  assert.ok(acc > 8 && rej < 6, `${acc} / ${rej}`);
  const userCaught = reward({ ...base, user: { verdict: 'accepted', revisions: 2 }, mistakes: [{ caught: 'user' }] });
  assert.ok(userCaught < acc);
});

test('analyse: shrunk technique advantage and activation threshold', () => {
  const eps = Array.from({ length: 20 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`, genre: 'ad', techniques: i % 2 ? ['good'] : ['meh'],
    reward: i % 2 ? 9 : 6, mistakes: [], scores: {},
  }));
  const A = analyse(eps);
  assert.equal(A.active, eps.length >= ACTIVATE_AT);
  const good = A.tech.find((x) => x.t === 'good'), meh = A.tech.find((x) => x.t === 'meh');
  assert.ok(good.adv > 0 && meh.adv < 0);
  assert.ok(good.adv < 9 - A.baseline, 'shrinkage keeps small samples modest');
});

test('pickVariant is deterministic', () => {
  const vs = ['a', 'b', 'c'];
  assert.equal(pickVariant(vs, 1.234), pickVariant(vs, 1.234));
  assert.equal(pickVariant([], 1), null);
});

test('recordedCues: maps to recordings aligned on their peak; synth-only types pass; unknown types drop', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'w.mp3'), 'x');
  const lib = { sfx: {}, music: [] };
  const overrides = { whoosh: { file: 'w.mp3', peak: 0.3, gain: 0.5 } };
  const { cues, dropped } = recordedCues([
    { t: 1, type: 'whoosh', gain: 0.8 },
    { t: 2, type: 'turn' },
    { t: 3, type: 'nope' },
    { t: 4, type: 'sample', file: 'vox/a.mp3' },
  ], { lib, overrides, audioDir: d });
  const w = cues.find((c) => c.tag === 'whoosh');
  assert.equal(w.type, 'sample');
  close(w.t, 0.7);
  close(w.gain, 0.4);
  assert.equal(w.duck, false);
  assert.ok(SYNTH_OK.has('turn') && cues.some((c) => c.type === 'turn'));
  assert.ok(cues.some((c) => c.file === 'vox/a.mp3'));
  assert.deepEqual(dropped, { nope: 1 });
});

test('musicCues: one segment by default, explicit segments kept', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'm.mp3'), 'x');
  const one = musicCues({ file: 'm.mp3', from: 8 }, 30, d);
  assert.equal(one.length, 1);
  assert.equal(one[0].from, 8);
  assert.equal(one[0].dur, 30);
  const two = musicCues({ file: 'm.mp3', segments: [{ t: 0, from: 8, dur: 23 }, { t: 23, from: 89, dur: 7 }] }, 30, d);
  assert.equal(two.length, 2);
  assert.throws(() => musicCues({ file: 'missing.mp3' }, 30, d), /missing/);
});

test('readWav + rmsDb: a full-scale square wave reads ~0 dB, silence very low', () => {
  const d = tmp(), f = path.join(d, 't.wav'), sr = 48000, n = sr; // 1s stereo
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n / 2; i++) { const v = (i >> 6) & 1 ? 32767 : -32767; b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); }
  fs.writeFileSync(f, b);
  const w = readWav(f);
  assert.equal(w.channels, 2);
  assert.ok(Math.abs(rmsDb(w, 0, 0.5)) < 0.1);
  assert.ok(rmsDb(w, 0.5, 1) < -100);
});

function close(a, b, eps = 1e-6) { assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`); }
