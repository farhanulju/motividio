#!/usr/bin/env node
// End-to-end smoke test on projects/_demo: stills → verify → a 1s draft render, checked with ffprobe.
// Needs ffmpeg + Playwright Chromium (and network for the demo's Google Fonts).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const step = (label, argv) => {
  process.stdout.write(`▶ ${label}… `);
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.log('✖');
    console.error(r.stdout + r.stderr);
    process.exit(1);
  }
  console.log('✔');
  return r.stdout;
};

step('stills', ['engine/stills.mjs', 'projects/_demo', '--at', '0.5,2.5']);
step('verify', ['engine/verify.mjs', 'projects/_demo', '--samples', '8']);
step('draft render (1s)', ['engine/render.mjs', 'projects/_demo', '--fast', '--to', '1', '--no-audio', '--workers', '2']);

const out = path.join(ROOT, 'projects', '_demo', 'out', 'draft', '_demo.mp4');
const p = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'csv=p=0', out], { encoding: 'utf8' });
const [w, h, frames] = p.stdout.trim().split(',').map(Number);
if (w !== 1920 || h !== 1080 || frames !== 60) {
  console.error(`✖ draft is ${w}x${h} with ${frames} frames, expected 1920x1080 with 60`);
  process.exit(1);
}
console.log(`✔ smoke passed — ${path.relative(ROOT, out)} ${w}x${h}, ${frames} frames`);
