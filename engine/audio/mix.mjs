#!/usr/bin/env node
/**
 * Mix music + SFX + voice-over into audio/mix.wav (what render.mjs muxes).
 *
 *   node engine/audio/mix.mjs projects/<name> [--lufs -14] [--music 0.8] [--sfx 1] [--vo 1] [--no-sfx-duck] [--report]
 *
 * - Music ducks hard under the voice (and vocal effects); SFX duck lightly under the voice, so a click or
 *   chime never masks a word.
 * - Two-pass loudness: pass 1 measures, pass 2 normalizes linearly to −14 LUFS / −1.5 dBTP (no pumping).
 * - Level check: every VO phrase is measured against everything else (the bed). Result in
 *   audio/levels.json; a phrase under 6 dB above the bed is flagged (--report prints every phrase).
 *
 * Voice-over: audio/vo.json = [{ "file": "vo/01.mp3", "t": 0.6, "gain": 1, "phrases": [[s, e], …] }, ...]
 *             (written by tts-fish.mjs, or by hand after downloading Fish Audio MCP output)
 *         or: a single audio/vo.mp3 | vo.wav placed at t = 0 (--vo-at <sec> to offset).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { args, projectDir, ffprobeDuration } from '../lib/common.mjs';

export const LEVEL_TARGET = 6; // dB the voice must sit above the bed, per phrase

export async function mix(dir, o = {}) {
  const A = path.join(dir, 'audio');
  const f = (n) => path.join(A, n);
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';

  let duration = o.duration;
  if (!duration) {
    const cues = fs.existsSync(f('cues.json')) ? JSON.parse(fs.readFileSync(f('cues.json'), 'utf8')) : {};
    duration = cues.comp?.duration || (fs.existsSync(f('music.wav')) ? ffprobeDuration(f('music.wav')) : 0);
  }

  // voice-over lines
  let vo = [];
  if (fs.existsSync(f('vo.json'))) vo = JSON.parse(fs.readFileSync(f('vo.json'), 'utf8'));
  else for (const n of ['vo.wav', 'vo.mp3']) if (fs.existsSync(f(n))) { vo = [{ file: n, t: +o.voAt || 0 }]; break; }
  vo = vo.filter((l) => fs.existsSync(path.join(A, l.file)));

  const has = { mus: fs.existsSync(f('music.wav')), sfx: fs.existsSync(f('sfx.wav')), vfx: fs.existsSync(f('voxfx.wav')), vo: vo.length > 0 };
  has.bed = has.mus || has.sfx || has.vfx;
  if (!has.bed && !has.vo) { console.log('  (no audio stems found — skipped mix)'); return null; }
  const duckSfx = has.vo && has.sfx && o.sfxDuck !== false;

  /** the filter graph up to the pre-master sum; stems = also split out the bed and the voice */
  const build = (stems) => {
    const ins = [], c = [];
    const input = (file) => { ins.push('-i', file); return ins.length / 2 - 1; };
    if (has.mus) c.push(`[${input(f('music.wav'))}:a]${fmt},volume=${o.music ?? 0.8}[mus]`);
    if (has.sfx) c.push(`[${input(f('sfx.wav'))}:a]${fmt},volume=${o.sfx ?? 1}[sfx]`);
    if (has.vfx) c.push(`[${input(f('voxfx.wav'))}:a]${fmt},volume=${o.voxfx ?? 1},asplit=2[vfxK][vfx]`);
    if (has.vo) {
      const labels = vo.map((l, k) => {
        const ms = Math.max(0, Math.round((l.t || 0) * 1000));
        c.push(`[${input(path.join(A, l.file))}:a]${fmt},adelay=${ms}|${ms},volume=${(l.gain ?? 1) * (o.vo ?? 1)}[v${k}]`);
        return `[v${k}]`;
      });
      const outs = ['voF', 'voM', ...(duckSfx ? ['voS'] : []), ...(stems && has.bed ? ['voT'] : [])];
      c.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,asplit=${outs.length}${outs.map((x) => `[${x}]`).join('')}`);
    }
    const bed = [];
    if (has.mus) {
      // music ducks hard under the voice (+ vocal effects)
      const key = has.vo && has.vfx ? '[voM][vfxK]amix=inputs=2:normalize=0[keyM]' : has.vo ? '[voM]anull[keyM]' : has.vfx ? '[vfxK]anull[keyM]' : null;
      if (key) { c.push(key, '[mus][keyM]sidechaincompress=threshold=0.02:ratio=8:attack=12:release=350[md]'); bed.push('[md]'); }
      else bed.push('[mus]');
    } else {
      if (has.vo) c.push('[voM]anullsink');
      if (has.vfx) c.push('[vfxK]anullsink');
    }
    if (has.sfx) {
      // sfx duck lightly: hits keep their punch between words but never mask one
      if (duckSfx) { c.push('[sfx][voS]sidechaincompress=threshold=0.03:ratio=4:attack=5:release=220[sd]'); bed.push('[sd]'); }
      else bed.push('[sfx]');
    }
    if (has.vfx) bed.push('[vfx]');
    let pre;
    if (bed.length) {
      c.push(`${bed.join('')}amix=inputs=${bed.length}:normalize=0${stems && has.vo ? ',asplit=2[bedF][bedT]' : '[bedF]'}`);
      pre = has.vo ? '[bedF][voF]amix=inputs=2:normalize=0' : '[bedF]anull';
    } else pre = '[voF]anull';
    return { ins, graph: c.join(';'), pre };
  };

  const lufs = o.lufs ?? -14;
  // loudnorm shifts timestamps by its look-ahead, so `-t` would cut ~90ms short:
  // pad first, re-stamp by sample index, then trim to an exact sample count.
  const trim = duration ? `,asetpts=N/SR/TB,atrim=end_sample=${Math.round(duration * 48000)}` : '';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motividio-mix-'));
  try {
    // pass 1: measure loudness, and write the bed + voice stems for the level check
    const stems = has.vo && has.bed;
    const g1 = build(stems);
    const r1 = ffmpeg([...g1.ins, '-filter_complex', `${g1.graph};${g1.pre},apad=pad_dur=0.5,loudnorm=I=${lufs}:TP=-1.5:LRA=11:print_format=json${trim}[out]`,
      '-map', '[out]', '-f', 'null', '-',
      ...(stems ? ['-map', '[bedT]', '-c:a', 'pcm_s16le', path.join(tmp, 'bed.wav'), '-map', '[voT]', '-c:a', 'pcm_s16le', path.join(tmp, 'vo.wav')] : [])]);
    const m = JSON.parse(r1.stderr.slice(r1.stderr.lastIndexOf('{'), r1.stderr.lastIndexOf('}') + 1));

    // pass 2: linear normalization with the measured values (no dynamic pumping)
    const g2 = build(false);
    const ln = `loudnorm=I=${lufs}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    const out = f('mix.wav');
    ffmpeg(['-y', ...g2.ins, '-filter_complex', `${g2.graph};${g2.pre},apad=pad_dur=0.5,${ln},aresample=48000${trim}[out]`,
      '-map', '[out]', '-ac', '2', '-ar', '48000', out]);

    const lv = stems ? levels(vo, A, path.join(tmp, 'bed.wav'), path.join(tmp, 'vo.wav'), f('levels.json'), o.report) : null;
    if (!stems) fs.rmSync(f('levels.json'), { force: true });
    console.log(`✔ mix.wav — ${[has.mus && 'music', has.sfx && 'sfx', has.vfx && 'vocal fx', has.vo && `${vo.length} VO line(s)`].filter(Boolean).join(' + ')}` +
      `${has.vo && has.bed ? `, ${duckSfx ? 'music + sfx' : 'music'} ducked under VO` : ''}, ${lufs} LUFS (two-pass)` +
      (lv?.worst != null ? `, VO ≥ ${lv.worst} dB over the bed` : ''));
    if (lv && lv.low.length) {
      console.warn(`  ⚠ ${lv.low.length} VO phrase(s) under ${LEVEL_TARGET} dB above the bed — lower music/sfx there or raise the VO (\`npm run levels -- ${path.relative(process.cwd(), dir)}\` prints the table)`);
    }
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function ffmpeg(argv) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${(r.stderr || '').split('\n').slice(-8).join('\n')}`);
  return r;
}

/** read a 16-bit PCM WAV as interleaved floats */
export function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, ch = 2, sr = 48000;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); sr = b.readUInt32LE(p + 12); }
    if (id === 'data') {
      const end = Math.min(b.length, p + 8 + size), n = (end - p - 8) >> 1, s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return { samples: s, channels: ch, sampleRate: sr };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${file}`);
}

export function rmsDb(w, t0, t1) {
  const a = Math.max(0, Math.floor(t0 * w.sampleRate) * w.channels), b = Math.min(w.samples.length, Math.floor(t1 * w.sampleRate) * w.channels);
  let s = 0;
  for (let i = a; i < b; i++) s += w.samples[i] * w.samples[i];
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-12);
}

/** voice vs bed per phrase → levels.json */
function levels(vo, audioDir, bedFile, voFile, outFile, report) {
  const bed = readWav(bedFile), voice = readWav(voFile);
  const rows = [];
  for (const l of vo) {
    const ph = l.phrases?.length ? l.phrases : [[0, l.dur || ffprobeDuration(path.join(audioDir, l.file))]];
    for (const [s, e] of ph) {
      const from = (l.t || 0) + s, to = (l.t || 0) + e;
      if (to - from < 0.05) continue;
      const v = rmsDb(voice, from, to), bd = rmsDb(bed, from, to);
      rows.push({ id: l.id ?? l.file, from: +from.toFixed(2), to: +to.toFixed(2), vo: +v.toFixed(1), bed: +bd.toFixed(1), diff: +(v - bd).toFixed(1) });
    }
  }
  const worst = rows.length ? Math.min(...rows.map((r) => r.diff)) : null;
  const low = rows.filter((r) => r.diff < LEVEL_TARGET);
  fs.writeFileSync(outFile, JSON.stringify({ target: LEVEL_TARGET, worst, phrases: rows }, null, 2));
  if (report) {
    console.log('  line   from–to          vo dB   bed dB   diff');
    for (const r of rows) console.log(`  ${String(r.id).padEnd(5)} ${r.from.toFixed(2).padStart(6)}–${r.to.toFixed(2).padEnd(7)} ${r.vo.toFixed(1).padStart(7)} ${r.bed.toFixed(1).padStart(8)} ${r.diff.toFixed(1).padStart(6)}${r.diff < LEVEL_TARGET ? '  ✖' : ''}`);
  }
  return { worst, low };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  await mix(projectDir(a._[0]), { lufs: a.lufs && +a.lufs, music: a.music, sfx: a.sfx, vo: a.vo, voxfx: a.voxfx, voAt: a['vo-at'], sfxDuck: !a['no-sfx-duck'], report: !!a.report });
}
