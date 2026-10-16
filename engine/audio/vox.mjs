#!/usr/bin/env node
/**
 * Human vocal effects (gasps, laughs, shouts, one-word reactions, crowd layers) — not narration.
 * Generates each line with Fish Audio (REST, tts-fish.mjs) into audio/vox/<id>.mp3, trims the
 * leading/trailing silence, and writes audio/vox.json with measured durations.
 * Place them on the timeline from the comp as sample cues:  M.cue(t, 'sample', { file: 'vox/gasp.mp3', gain: 0.8 })
 * (they go into sfx.wav, so music is NOT ducked under them — unlike vo.json).
 *
 *   node engine/audio/vox.mjs projects/<name> [--only id1,id2] [--force]
 *
 * audio/vox-script.json:
 *   { "model": "s2.1-pro-free", "lines": [ { "id": "gasp", "voice": "<reference_id>", "text": "[gasp] Whoa!", "speed": 1 } ] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { args, projectDir, ROOT, die, ffprobeDuration } from '../lib/common.mjs';

const a = args();
const dir = projectDir(a._[0]);
const A = path.join(dir, 'audio');
const S = JSON.parse(fs.readFileSync(path.join(A, 'vox-script.json'), 'utf8'));
const only = a.only ? new Set(String(a.only).split(',')) : null;
fs.mkdirSync(path.join(A, 'vox'), { recursive: true });
const manifestFile = path.join(A, 'vox.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};

for (const line of S.lines) {
  if (only && !only.has(line.id)) continue;
  const raw = path.join(A, 'vox', `${line.id}.raw.mp3`);
  const out = path.join(A, 'vox', `${line.id}.mp3`);
  if (fs.existsSync(out) && !a.force && !only) { console.log(`· ${line.id} exists`); continue; }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'engine/audio/tts-fish.mjs'), '--text', line.text,
    '--out', raw, ...(line.voice ? ['--voice', line.voice] : []), '--speed', String(line.speed || 1),
    ...(S.model ? ['--model', S.model] : [])], { encoding: 'utf8' });
  if (!fs.existsSync(raw)) die(`✖ ${line.id}: ${r.stdout}${r.stderr}`);
  // trim silence at both ends so the cue time = the sound's onset
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse',
    '-ar', '48000', out]);
  fs.rmSync(raw, { force: true });
  const dur = ffprobeDuration(out);
  manifest[line.id] = { file: `vox/${line.id}.mp3`, dur: +dur.toFixed(3), text: line.text, voice: line.voice };
  console.log(`✔ vox/${line.id}.mp3  ${dur.toFixed(2)}s  “${line.text}”`);
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log('✔ audio/vox.json');
