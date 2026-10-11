#!/usr/bin/env node
/**
 * Deterministic frame-by-frame render: headless Chromium -> PNG frames -> ffmpeg -> MP4.
 *
 *   node engine/render.mjs projects/<name> [--format 16x9|9x16|1x1|4x5|all] [--fps 60]
 *        [--workers 4] [--from 0] [--to <sec>] [--crf 16] [--scale 1] [--fast] [--no-audio]
 *        [--audio path.wav] [--out file.mp4]
 *
 * Each worker owns a contiguous frame range and pipes it into its own ffmpeg, producing a
 * segment; segments are concatenated losslessly, then audio/mix.wav (if present) is muxed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { serve, args, projectDir, urlPath, launch, openComp, run, die, hasBin, dumpCues } from './lib/common.mjs';

const a = args();
const dir = projectDir(a._[0]);
const name = path.basename(dir);
if (!hasBin('ffmpeg')) die('ffmpeg not found on PATH');

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}${urlPath(dir)}`;
const browser = await launch();

// discover formats
const { page: probePage, comp: first } = await openComp(browser, base, { format: a.format !== 'all' ? a.format : undefined, fps: a.fps });
const formats = a.format === 'all' ? first.formats : [first.format];
await dumpCues(probePage, dir);
await probePage.close();

const outDir = path.join(dir, 'out');
fs.mkdirSync(outDir, { recursive: true });
const results = [];

for (const format of formats) {
  const t0 = Date.now();
  const { page, comp } = await openComp(browser, base, { format, fps: a.fps, scale: a.scale });
  await page.close();
  const fps = comp.fps;
  const from = Math.max(0, Math.round((+a.from || 0) * fps));
  const to = Math.min(Math.round(comp.duration * fps), a.to ? Math.round(+a.to * fps) : Infinity);
  const total = to - from;
  if (total <= 0) die('empty frame range');
  const workers = Math.max(1, Math.min(+a.workers || 4, Math.ceil(total / 30)));
  const per = Math.ceil(total / workers);
  const tmp = path.join(outDir, `.seg-${format}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  console.log(`▶ ${name} [${format}] ${comp.width * (+a.scale || 1)}x${comp.height * (+a.scale || 1)} @${fps}fps — ${total} frames, ${workers} workers`);
  let done = 0;
  const tick = () => {
    done++;
    if (done % 15 === 0 || done === total) process.stdout.write(`\r  ${done}/${total} frames  ${((done / total) * 100).toFixed(0)}%   `);
  };

  const segs = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const s = from + w * per, e = Math.min(to, s + per);
    if (s >= e) return;
    const seg = path.join(tmp, `seg${String(w).padStart(2, '0')}.mp4`);
    segs[w] = seg;
    const { page: pg } = await openComp(browser, base, { format, fps: a.fps, scale: a.scale, probe: comp });
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', a.fast ? 'veryfast' : 'slow', '-crf', String(a.crf || 16),
      '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-r', String(fps), seg,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg segment failed')))));
    for (let f = s; f < e; f++) {
      await pg.evaluate((t) => window.__seek(t), f / fps);
      const buf = await pg.screenshot({ type: a.fast ? 'jpeg' : 'png', quality: a.fast ? 92 : undefined, animations: 'allow', caret: 'hide' });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      tick();
    }
    ff.stdin.end();
    await closed;
    await pg.close();
  }));
  process.stdout.write('\n');

  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, segs.filter(Boolean).map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
  const silent = path.join(tmp, 'video.mp4');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);

  const suffix = formats.length > 1 || format !== '16x9' ? `-${format}` : '';
  const out = a.out && formats.length === 1 ? path.resolve(a.out) : path.join(outDir, `${name}${suffix}.mp4`);
  const audio = a.audio ? path.resolve(a.audio) : path.join(dir, 'audio', 'mix.wav');
  if (!a['no-audio'] && fs.existsSync(audio)) {
    const ss = from / fps;
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-ss', String(ss), '-i', audio,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
      '-t', String(total / fps), '-movflags', '+faststart', out]);
    console.log(`  ♪ muxed ${path.relative(dir, audio)}`);
  } else {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✔ ${path.relative(process.cwd(), out)}  (${secs}s)`);
  results.push(out);
}

await browser.close();
server.close();
