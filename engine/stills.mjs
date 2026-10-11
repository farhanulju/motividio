#!/usr/bin/env node
/**
 * Grab stills for review without a full render — the feedback loop's eyes.
 *
 *   node engine/stills.mjs projects/<name> [--every 0.5] [--at 1.2,3,4.5] [--scenes]
 *        [--format 9x16] [--cols 6] [--width 480]
 *
 * Writes out/stills/t<sec>.png plus out/stills/contact.png (a labelled grid of all stills).
 * --scenes grabs the midpoint and last frame of every registered scene.
 * Also refreshes audio/cues.json from the composition's M.cue() calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serve, args, projectDir, urlPath, launch, openComp, run, dumpCues } from './lib/common.mjs';

const a = args();
const dir = projectDir(a._[0]);
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}${urlPath(dir)}`;
const browser = await launch();
const { page, comp } = await openComp(browser, base, { format: a.format });
const { scenes } = await dumpCues(page, dir);

let times;
if (a.at) times = String(a.at).split(',').map(Number);
else if (a.scenes && scenes.length) {
  times = scenes.flatMap((s) => [(s.start + s.end) / 2, Math.max(s.start, s.end - 1 / comp.fps)]);
} else {
  const every = +a.every || 0.5;
  times = [];
  for (let t = 0; t < comp.duration; t += every) times.push(+t.toFixed(3));
}

const out = path.join(dir, 'out', a.format ? `stills-${a.format}` : 'stills');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = [];
for (const t of times) {
  await page.evaluate((x) => window.__seek(x), t);
  const f = path.join(out, `t${t.toFixed(2).padStart(6, '0')}.png`);
  await page.screenshot({ path: f, animations: 'allow' });
  files.push({ f, t });
}
await browser.close();
server.close();

// contact sheet with timestamps burned in
const cols = Math.min(+a.cols || 6, files.length);
const w = +a.width || 480;
const list = path.join(out, 'list.txt');
fs.writeFileSync(list, files.map(({ f }) => `file '${f.replace(/\\/g, '/')}'\nduration 1`).join('\n'));
const rows = Math.ceil(files.length / cols);
try {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `scale=${w}:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x202024`,
    '-frames:v', '1', path.join(out, 'contact.png')]);
} catch (e) {
  console.error('contact sheet failed:', e.message);
}
fs.rmSync(list, { force: true });
console.log(`✔ ${files.length} stills → ${path.relative(process.cwd(), out)}`);
console.log(`  contact sheet: ${path.relative(process.cwd(), path.join(out, 'contact.png'))}  (${cols} cols, left→right, top→bottom: ${times.map((t) => t.toFixed(2)).join(', ')})`);
