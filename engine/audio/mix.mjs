#!/usr/bin/env node
/**
 * Mix music + SFX + voice-over into audio/mix.wav (what render.mjs muxes).
 * Music ducks under the voice via sidechain compression; output is loudness-normalized.
 *
 *   node engine/audio/mix.mjs projects/<name> [--lufs -14] [--music 0.8] [--sfx 1] [--vo 1]
 *
 * Voice-over: audio/vo.json = [{ "file": "vo/01.mp3", "t": 0.6, "gain": 1 }, ...]
 *             (written by tts-fish.mjs, or by hand after downloading Fish Audio MCP output)
 *         or: a single audio/vo.mp3 | vo.wav placed at t = 0 (--vo-at <sec> to offset).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, projectDir, run, ffprobeDuration } from '../lib/common.mjs';

export async function mix(dir, o = {}) {
  const A = path.join(dir, 'audio');
  const f = (n) => path.join(A, n);
  const inputs = [], chains = [], mixIn = [];
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
  const add = (file) => { inputs.push('-i', file); return inputs.length / 2 - 1; };

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

  if (fs.existsSync(f('music.wav'))) {
    const i = add(f('music.wav'));
    chains.push(`[${i}:a]${fmt},volume=${o.music ?? 0.8}[mus]`);
  }
  if (fs.existsSync(f('sfx.wav'))) {
    const i = add(f('sfx.wav'));
    chains.push(`[${i}:a]${fmt},volume=${o.sfx ?? 1}[sfx]`);
    mixIn.push('[sfx]');
  }
  if (vo.length) {
    const labels = vo.map((l, k) => {
      const i = add(path.join(A, l.file));
      const ms = Math.max(0, Math.round((l.t || 0) * 1000));
      chains.push(`[${i}:a]${fmt},adelay=${ms}|${ms},volume=${(l.gain ?? 1) * (o.vo ?? 1)}[v${k}]`);
      return `[v${k}]`;
    });
    chains.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,asplit=2[vo1][vo2]`);
    if (chains.some((c) => c.endsWith('[mus]'))) {
      chains.push('[mus][vo1]sidechaincompress=threshold=0.025:ratio=6:attack=15:release=400[mduck]');
      mixIn.unshift('[mduck]');
    } else chains.push('[vo1]anullsink');
    mixIn.push('[vo2]');
  } else if (chains.some((c) => c.endsWith('[mus]'))) mixIn.unshift('[mus]');

  if (!mixIn.length) { console.log('  (no audio stems found — skipped mix)'); return null; }
  const lufs = o.lufs ?? -14;
  // loudnorm shifts timestamps by its look-ahead, so `-t` would cut ~90ms short:
  // pad first, re-stamp by sample index, then trim to an exact sample count.
  const trim = duration ? `,asetpts=N/SR/TB,atrim=end_sample=${Math.round(duration * 48000)}` : '';
  chains.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0,apad=pad_dur=0.5,loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000${trim}[out]`);
  const out = f('mix.wav');
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', chains.join(';'),
    '-map', '[out]', '-ac', '2', '-ar', '48000', out]);
  console.log(`✔ mix.wav — ${mixIn.length} stems${vo.length ? `, ${vo.length} VO line(s) with ducking` : ''}, ${lufs} LUFS`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  await mix(projectDir(a._[0]), { lufs: a.lufs && +a.lufs, music: a.music, sfx: a.sfx, vo: a.vo, voAt: a['vo-at'] });
}
