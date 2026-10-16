#!/usr/bin/env node
/**
 * Deterministic frame-by-frame render: headless Chromium -> frames -> ffmpeg -> MP4.
 *
 *   node engine/render.mjs projects/<name> [--format 16x9|9x16|1x1|4x5|all] [--fps 60]
 *        [--workers 4] [--from 0] [--to <sec>] [--crf 16] [--scale 1] [--fast] [--no-audio]
 *        [--audio path.wav] [--out file.mp4] [--overwrite] [--fresh] [--chunk 2] [--allow-errors]
 *
 * Frames render in chunks (--chunk seconds, default 2) that N workers pull from a queue. Each chunk
 * is its own H.264 file, written as .part and renamed when complete, then all chunks are joined
 * losslessly and audio/mix.wav (if present) is muxed.
 *   - Resume: an interrupted or crashed render picks up from its finished chunks when re-run with
 *     the same inputs and settings. Changed inputs start over automatically; --fresh forces it.
 *   - Retry: a crashed page is reopened and its chunk retried (3 tries). A script error stops the
 *     render with the frame time — retrying deterministic code can't fix it.
 *   - Fail loud: missing images/fonts/stylesheets or page errors stop the render (--allow-errors overrides).
 *
 * Outputs — a delivered file is never overwritten:
 *   final  out/<name>[-<format>].mp4, else the next free -v2, -v3 … (--overwrite replaces)
 *   draft  out/draft/<name>[-<format>].mp4 for --fast or a --from/--to range (replaced freely)
 * Each output gets a .json manifest beside it: input hashes, settings, git commit, tool versions,
 * ffprobe of the result and its loudness.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  ROOT, serve, args, projectDir, urlPath, launch, openComp, run, die, hasBin, dumpCues,
  hashTree, engineHash, gitInfo, nextVersion, brief, capture,
} from './lib/common.mjs';

const a = args();
const dir = projectDir(a._[0]);
const name = path.basename(dir);
if (!hasBin('ffmpeg')) die('ffmpeg not found on PATH');
const allowErrors = !!a['allow-errors'];
const rel = (p) => path.relative(process.cwd(), p);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const children = new Set();
let browser, server, stopping = false;

async function shutdown() {
  stopping = true;
  for (const c of children) c.kill('SIGKILL');
  if (browser) await browser.close().catch(() => {});
  if (server) server.close();
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) return;
    console.error('\n✖ interrupted — finished chunks are kept; run the same command again to resume');
    await shutdown();
    process.exit(130);
  });
}

try {
  await main();
  await shutdown();
} catch (e) {
  console.error(`\n✖ ${brief(e)}`);
  if (e.resumable) console.error('  finished chunks are kept — run the same command again to resume');
  await shutdown();
  process.exit(1);
}

async function main() {
  server = await serve();
  const base = `http://127.0.0.1:${server.address().port}${urlPath(dir)}`;
  browser = await launch();

  // discover formats; refresh cues; refuse a broken comp before any work is done
  const first = await openComp(browser, base, { format: a.format !== 'all' ? a.format : undefined, fps: a.fps, allowErrors });
  const formats = a.format === 'all' ? first.comp.formats : [first.comp.format];
  await dumpCues(first.page, dir);
  await first.page.close();

  const inputs = { visual: hashTree(dir, { media: false }), engine: engineHash() };
  for (const format of formats) await renderFormat(format, base, inputs, formats.length);
}

async function renderFormat(format, base, inputs, nFormats) {
  const t0 = Date.now();
  const { page, comp } = await openComp(browser, base, { format, fps: a.fps, scale: a.scale, allowErrors });
  await page.close();
  const fps = comp.fps, scale = +a.scale || 1;
  const all = Math.round(comp.duration * fps);
  const from = Math.max(0, Math.round((+a.from || 0) * fps));
  const to = Math.min(all, a.to ? Math.round(+a.to * fps) : Infinity);
  const total = to - from;
  if (total <= 0) throw new Error('empty frame range');
  const draft = !!a.fast || from > 0 || to < all;

  // decide the output path first, so a refusal costs nothing
  const outDir = path.join(dir, 'out');
  const suffix = nFormats > 1 || format !== '16x9' ? `-${format}` : '';
  let out;
  if (a.out && nFormats === 1) {
    out = path.resolve(a.out);
    if (fs.existsSync(out) && !a.overwrite) throw new Error(`${a.out} exists — pass --overwrite to replace it, or choose another --out`);
  } else if (draft) out = path.join(outDir, 'draft', `${name}${suffix}.mp4`);
  else {
    const f = path.join(outDir, `${name}${suffix}.mp4`);
    out = a.overwrite ? f : nextVersion(f);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const chunkFrames = Math.max(1, Math.round((+a.chunk || 2) * fps));
  const settings = {
    format, fps, scale, from, to, chunkFrames, crf: +(a.crf || 16),
    preset: a.fast ? 'veryfast' : 'slow', frames: a.fast ? 'jpeg-92' : 'png',
  };

  // job dir: finished chunks survive a crash; job.json says which inputs + settings they belong to
  const key = sha(JSON.stringify({ ...inputs, settings }));
  const job = path.join(outDir, `.render-${format}${a.fast ? '-fast' : ''}`);
  const jobFile = path.join(job, 'job.json');
  const lock = path.join(job, 'lock');
  if (fs.existsSync(lock)) {
    const pid = +fs.readFileSync(lock, 'utf8');
    if (pid !== process.pid && alive(pid)) throw new Error(`another render of ${name} [${format}] is running (pid ${pid}) — wait for it, or stop it first`);
  }
  const prior =fs.existsSync(jobFile) ? JSON.parse(fs.readFileSync(jobFile, 'utf8')) : null;
  if (!prior || prior.key !== key || a.fresh) {
    if (prior && prior.key !== key && !a.fresh) console.log('  inputs or settings changed since the unfinished render — starting fresh');
    fs.rmSync(job, { recursive: true, force: true });
    fs.mkdirSync(job, { recursive: true });
    fs.writeFileSync(jobFile, JSON.stringify({ key, settings, started: new Date().toISOString() }, null, 2));
  }
  fs.writeFileSync(lock, String(process.pid));
  const pad = (n) => String(n).padStart(7, '0');
  const chunks = [];
  for (let s = from; s < to; s += chunkFrames) {
    const e = Math.min(to, s + chunkFrames);
    chunks.push({ s, e, file: path.join(job, `f${pad(s)}-${pad(e)}.mp4`) });
  }
  const queue = chunks.filter((c) => !fs.existsSync(c.file));
  let done = total - queue.reduce((n, c) => n + c.e - c.s, 0);
  const workers = Math.max(1, Math.min(+a.workers || 4, queue.length));

  console.log(`▶ ${name} [${format}] ${comp.width * scale}x${comp.height * scale} @${fps}fps — ${total} frames, ` +
    `${chunks.length} chunks, ${workers} workers → ${rel(out)}${draft ? ' (draft)' : ''}`);
  if (done) console.log(`  resuming: ${chunks.length - queue.length}/${chunks.length} chunks already rendered`);
  const prog = (n) => {
    done += n;
    if (n > 0 && (done % 15 === 0 || done === total)) process.stdout.write(`\r  ${done}/${total} frames  ${((done / total) * 100).toFixed(0)}%   `);
  };

  await Promise.all(Array.from({ length: workers }, () => worker(queue, base, format, comp, fps, settings, prog)));
  process.stdout.write('\n');

  // join chunks losslessly, then mux audio
  const list = path.join(job, 'list.txt');
  fs.writeFileSync(list, chunks.map((c) => `file '${c.file.replace(/\\/g, '/')}'`).join('\n'));
  const silent = path.join(job, 'video.mp4');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);

  const audio = a.audio ? path.resolve(a.audio) : path.join(dir, 'audio', 'mix.wav');
  const withAudio = !a['no-audio'] && fs.existsSync(audio);
  const tmpOut = path.join(job, 'out.mp4'); // written whole, then moved: a half-written deliverable never exists
  if (withAudio) {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-ss', String(from / fps), '-i', audio,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
      '-t', String(total / fps), '-movflags', '+faststart', tmpOut]);
  } else {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-c', 'copy', '-movflags', '+faststart', tmpOut]);
  }
  fs.rmSync(out, { force: true });
  fs.renameSync(tmpOut, out);

  const probe = ffprobe(out);
  const loudness = withAudio ? measureLoudness(out) : null;
  const warnings = [];
  if (probe.video?.frames && probe.video.frames !== total) warnings.push(`output has ${probe.video.frames} frames, expected ${total}`);
  if (loudness && Math.abs(loudness.lufs - -14) > 1) warnings.push(`loudness ${loudness.lufs} LUFS (target −14)`);
  if (loudness && loudness.truePeak > -1) warnings.push(`true peak ${loudness.truePeak} dBTP (keep ≤ −1)`);
  const levelsFile = path.join(dir, 'audio', 'levels.json');
  const levels = withAudio && !a.audio && fs.existsSync(levelsFile) ? JSON.parse(fs.readFileSync(levelsFile, 'utf8')) : null;
  if (levels?.worst != null && levels.worst < levels.target) warnings.push(`VO only ${levels.worst} dB over the bed in its quietest phrase (target ≥ ${levels.target}) — see audio/levels.json`);

  const secs = +((Date.now() - t0) / 1000).toFixed(1);
  const manifest = {
    file: path.relative(ROOT, out).split(path.sep).join('/'), project: name, format, draft,
    renderedAt: new Date().toISOString(), seconds: secs,
    comp: { width: comp.width, height: comp.height, fps, duration: comp.duration },
    range: { from: from / fps, to: to / fps, frames: total },
    settings: { ...settings, workers },
    inputs: { ...inputs, audio: withAudio ? { file: path.relative(dir, audio).split(path.sep).join('/'), sha256: sha(fs.readFileSync(audio)) } : null },
    git: gitInfo(),
    versions: { node: process.version, chromium: browser.version(), ffmpeg: ffmpegVersion(), playwright: playwrightVersion() },
    output: probe, loudness, voLevels: levels ? { worst: levels.worst, target: levels.target } : null, warnings,
  };
  fs.writeFileSync(out.replace(/\.mp4$/i, '') + '.json', JSON.stringify(manifest, null, 2));
  fs.rmSync(job, { recursive: true, force: true });

  console.log(`✔ ${rel(out)}  (${secs}s${withAudio ? `, ♪ ${path.relative(dir, audio)}` : ''}${loudness ? `, ${loudness.lufs} LUFS` : ''}) + manifest`);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
}

/** one browser page rendering chunks from the shared queue; reopens a crashed page and retries */
async function worker(queue, base, format, comp, fps, settings, prog) {
  let pg = null, errors = null;
  try {
    while (queue.length && !stopping) {
      const chunk = queue.shift();
      for (let attempt = 1; ; attempt++) {
        try {
          if (!pg) ({ page: pg, errors } = await openComp(browser, base, { format, fps: a.fps, scale: a.scale, probe: comp, allowErrors }));
          await renderChunk(pg, errors, chunk, fps, settings, prog);
          break;
        } catch (e) {
          const retryable = !e.fatal && !e.problems && /closed|crash|Timeout|ffmpeg|EPIPE/i.test(e.message);
          if (stopping || !retryable || attempt >= 3) { e.resumable = true; stopping = true; throw e; }
          console.error(`\n  ⚠ frames ${chunk.s}–${chunk.e} failed (${e.message.split('\n')[0]}) — reopening the page, retry ${attempt}/2`);
          await pg?.close().catch(() => {});
          pg = null;
        }
      }
    }
  } finally {
    await pg?.close().catch(() => {});
  }
}

async function renderChunk(pg, errors, { s, e, file }, fps, settings, prog) {
  const part = file.replace(/\.mp4$/, '.part');
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', settings.preset, '-crf', String(settings.crf),
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(fps), '-f', 'mp4', part,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  children.add(ff);
  const closed = new Promise((res, rej) => {
    ff.on('error', rej);
    ff.on('close', (c) => { children.delete(ff); c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)); });
  });
  closed.catch(() => {});
  ff.stdin.on('error', () => {}); // EPIPE when ffmpeg dies — surfaced through `closed`
  let n = 0, f = s;
  try {
    for (; f < e; f++) {
      if (stopping) throw Object.assign(new Error('stopped'), { fatal: true });
      await pg.evaluate((t) => window.__seek(t), f / fps);
      if (errors.length && !allowErrors) throw Object.assign(new Error(errors[0].detail), { fatal: true });
      const buf = await capture(pg, { type: settings.frames === 'png' ? 'png' : 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), closed]);
      n++;
      prog(1);
    }
    ff.stdin.end();
    await closed;
    fs.renameSync(part, file);
  } catch (err) {
    prog(-n);
    ff.kill('SIGKILL');
    fs.rmSync(part, { force: true });
    // a crash is retried; anything else is the comp's own error — say exactly where it happened
    if (err.message !== 'stopped' && !/closed|crash|Timeout|ffmpeg|EPIPE/i.test(err.message)) {
      err.message = `script error at ${(f / fps).toFixed(3)}s (frame ${f}): ${err.message}`;
      err.fatal = true;
    }
    throw err;
  }
}

function ffprobe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels:format=duration,size',
    '-of', 'json', file], { encoding: 'utf8' });
  try {
    const j = JSON.parse(r.stdout);
    const v = j.streams.find((s) => s.codec_type === 'video');
    const au = j.streams.find((s) => s.codec_type === 'audio');
    const [num, den] = (v?.r_frame_rate || '0/1').split('/').map(Number);
    return {
      duration: +(+j.format.duration).toFixed(3), bytes: +j.format.size,
      video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: +(num / den).toFixed(3), frames: +v.nb_frames || null } : null,
      audio: au ? { codec: au.codec_name, sampleRate: +au.sample_rate, channels: au.channels } : null,
    };
  } catch { return { error: 'ffprobe failed' }; }
}

function measureLoudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const last = (re) => { const m = [...(r.stderr || '').matchAll(re)]; return m.length ? +m[m.length - 1][1] : null; };
  const lufs = last(/I:\s+(-?[\d.]+) LUFS/g), truePeak = last(/Peak:\s+(-?[\d.]+) dBFS/g);
  return lufs === null ? null : { lufs, truePeak };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function ffmpegVersion() {
  return (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout || '').split(/\r?\n/)[0].replace(/ Copyright.*/, '').trim() || null;
}
function playwrightVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'playwright', 'package.json'), 'utf8')).version; } catch { return null; }
}
