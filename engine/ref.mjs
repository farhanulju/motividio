#!/usr/bin/env node
/**
 * Break a reference video into analyzable parts so its *grammar* can be studied.
 *
 *   node engine/ref.mjs <url-or-local-file> --name <slug> [--every 0.5]
 *
 * Writes references/<slug>/
 *   source.mp4         downloaded (yt-dlp: X/Twitter, YouTube, Vimeo, …) or copied
 *   frames/f0001.jpg   one frame every --every seconds (default 0.5s)
 *   sheet-01.jpg …     4x4 contact sheets of those frames (read these to study the style)
 *   cuts.json          detected hard cuts → shot lengths
 *   meta.json          duration, fps, resolution, audio presence, mean shot length
 * Then write references/<slug>/style-guide.md from templates/style-guide.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { args, ROOT, die, run, hasBin } from './lib/common.mjs';

const a = args();
const src = a._[0] || die('usage: node engine/ref.mjs <url-or-file> --name <slug>');
const slug = a.name || die('--name <slug> required');
const every = +a.every || 0.5;
const dir = path.join(ROOT, 'references', slug);
fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
const video = path.join(dir, 'source.mp4');

if (/^https?:\/\//.test(src)) {
  if (!hasBin('yt-dlp') && spawnSync('yt-dlp', ['--version']).status !== 0) die('yt-dlp not found (winget install yt-dlp.yt-dlp)');
  if (!fs.existsSync(video)) {
    console.log('↓ downloading reference…');
    await run('yt-dlp', ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4',
      '--no-playlist', '-o', video, src]);
  }
} else {
  if (!fs.existsSync(src)) die(`file not found: ${src}`);
  fs.copyFileSync(path.resolve(src), video);
}

const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', video], { encoding: 'utf8' }).stdout);
const vs = probe.streams.find((s) => s.codec_type === 'video');
const [fn, fd] = (vs.avg_frame_rate || '30/1').split('/').map(Number);
const duration = +probe.format.duration;

// frames every N seconds
for (const f of fs.readdirSync(path.join(dir, 'frames'))) fs.rmSync(path.join(dir, 'frames', f));
await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=1/${every},scale='min(960,iw)':-2`, '-q:v', '3', path.join(dir, 'frames', 'f%04d.jpg')]);
const frames = fs.readdirSync(path.join(dir, 'frames')).filter((f) => f.endsWith('.jpg')).sort();

// contact sheets, 16 frames each
for (const f of fs.readdirSync(dir)) if (/^sheet-\d+\.jpg$/.test(f)) fs.rmSync(path.join(dir, f));
for (let s = 0; s * 16 < frames.length; s++) {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-start_number', String(s * 16 + 1), '-i', path.join(dir, 'frames', 'f%04d.jpg'),
    '-frames:v', '1', '-vf', 'scale=480:-2,tile=4x4:padding=4:margin=4:color=0x111111', '-q:v', '3',
    path.join(dir, `sheet-${String(s + 1).padStart(2, '0')}.jpg`)]);
}

// hard-cut detection
const sc = spawnSync('ffmpeg', ['-hide_banner', '-i', video, '-vf', "select='gt(scene,0.32)',showinfo", '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const cuts = [...(sc.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map((m) => +(+m[1]).toFixed(3));
const bounds = [0, ...cuts, duration];
const shots = bounds.slice(1).map((e, i) => +(e - bounds[i]).toFixed(3)).filter((d) => d > 0.04);
fs.writeFileSync(path.join(dir, 'cuts.json'), JSON.stringify({ cuts, shots }, null, 2));

const meta = {
  source: src, duration: +duration.toFixed(3), fps: +(fn / (fd || 1)).toFixed(3),
  width: vs.width, height: vs.height, aspect: `${vs.width}:${vs.height}`,
  audio: probe.streams.some((s) => s.codec_type === 'audio'),
  frameEvery: every, frames: frames.length, sheets: Math.ceil(frames.length / 16),
  shots: shots.length, meanShot: shots.length ? +(shots.reduce((x, y) => x + y, 0) / shots.length).toFixed(2) : duration,
};
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`✔ references/${slug}: ${meta.duration}s ${meta.width}x${meta.height} @${meta.fps}fps, ${frames.length} frames, ${meta.sheets} sheets, ${shots.length} shots (mean ${meta.meanShot}s)`);
console.log('  next: read the sheet-*.jpg files and write style-guide.md (template: templates/style-guide.md)');
if (meta.audio) console.log('  tip: ffmpeg -i source.mp4 -vn audio.wav  → study the sound design / tempo too');
