#!/usr/bin/env node
/**
 * Stateless check: a frame must look the same no matter which frame was rendered before it.
 * Parallel workers, resume and scrubbing all seek out of order, so a value left behind by another
 * frame (a fade that never resets, an overlay that leaks into later shots) ships as a glitch.
 *
 *   node engine/verify.mjs projects/<name> [--format 9x16] [--samples 30] [--seed 1] [--allow-errors]
 *
 * Pass A seeks the sample times in order on one page. Pass B, on a fresh page, visits them shuffled
 * and jumps to a random other time before each one. Every sample must match pixel for pixel
 * (PSNR ≥ 50 dB counts as rendering noise, reported as a warning). Samples = an even spread plus
 * the first/last frames of every scene, where leaks show up. Mismatches are saved to out/verify/
 * as A/B/diff PNGs; exit code 1 when any fail. Cue lists from both passes must match too.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { serve, args, projectDir, urlPath, launch, openComp, brief, capture } from './lib/common.mjs';

const a = args();
const dir = projectDir(a._[0]);
const allowErrors = !!a['allow-errors'];
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}${urlPath(dir)}`;
const browser = await launch();
let failed = false;

try {
  await main();
} catch (e) {
  console.error('✖ ' + brief(e));
  failed = true;
}
await browser.close().catch(() => {});
server.close();
process.exit(failed ? 1 : 0);

async function main() {
  const A = await openComp(browser, base, { format: a.format, allowErrors });
  const { comp } = A;
  const fps = comp.fps, last = Math.round(comp.duration * fps) - 1;
  const scenes = await A.page.evaluate(() => (window.__scenes ? window.__scenes() : []));

  // sample frames: even spread + every scene's first, second and last frame
  const n = +a.samples || 30;
  const frames = new Set();
  for (let i = 0; i < n; i++) frames.add(Math.round((i / Math.max(1, n - 1)) * last));
  for (const s of scenes) {
    const f0 = Math.round(s.start * fps), f1 = Math.round(s.end * fps) - 1;
    for (const f of [f0, f0 + 1, f1]) if (f >= 0 && f <= last) frames.add(f);
  }
  const list = [...frames].sort((x, y) => x - y);
  const rand = mulberry(+a.seed || 1);

  console.log(`▶ verify ${path.basename(dir)} [${comp.format}] — ${list.length} frames, in order vs shuffled with random detours`);
  const shotA = new Map();
  for (const f of list) shotA.set(f, await shoot(A, f, fps));

  const B = await openComp(browser, base, { format: a.format, probe: comp, allowErrors });
  const order = list.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const results = [];
  for (const f of order) {
    const detour = Math.floor(rand() * (last + 1));
    await shoot(B, detour, fps);
    const b = await shoot(B, f, fps);
    const sa = shotA.get(f);
    if (sa.hash === b.hash) continue;
    results.push({ frame: f, t: +(f / fps).toFixed(3), detour: +(detour / fps).toFixed(3), a: sa.buf, b: b.buf });
  }

  // cues: the sweep must collect the same list whichever frame the page was on
  const [cuesA, cuesB] = await Promise.all([A.page, B.page].map((p) => p.evaluate(() => JSON.stringify(window.__cues ? window.__cues() : []))));
  const outDir = path.join(dir, 'out', a.format ? `verify-${a.format}` : 'verify');
  fs.rmSync(outDir, { recursive: true, force: true });

  let errorsN = 0, noiseN = 0;
  if (results.length) fs.mkdirSync(outDir, { recursive: true });
  for (const r of results) {
    const stem = path.join(outDir, `t${r.t.toFixed(3).padStart(7, '0')}`);
    fs.writeFileSync(`${stem}-a.png`, r.a);
    fs.writeFileSync(`${stem}-b.png`, r.b);
    r.psnr = psnr(`${stem}-a.png`, `${stem}-b.png`, `${stem}-diff.png`);
    const noise = r.psnr !== null && r.psnr >= 50;
    if (noise) noiseN++; else errorsN++;
    const label = noise ? '⚠ noise' : '✖ differs';
    console.log(`  ${label} at ${r.t}s (frame ${r.frame}) — reached after a jump from ${r.detour}s; PSNR ${r.psnr ?? '?'} dB`);
    delete r.a; delete r.b;
  }
  const cuesOk = cuesA === cuesB;
  if (!cuesOk) console.log('  ✖ the cue list differs between passes — a M.cue() depends on which frame ran before');
  if (results.length || !cuesOk) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ format: comp.format, frames: list.length, mismatches: results, cuesMatch: cuesOk }, null, 2));
  }
  if (errorsN || !cuesOk) {
    failed = true;
    console.log(`✖ ${errorsN} frame(s) depend on render order — compare the A/B/diff PNGs in ${path.relative(process.cwd(), outDir)}`);
    console.log('  Usual cause: a property set by one scene/function and not reset by the code that runs at this time.');
  } else {
    console.log(`✔ stateless: ${list.length} frames identical in any order${noiseN ? ` (${noiseN} with sub-visible noise)` : ''}; cues match`);
  }
}

async function shoot({ page, errors }, f, fps) {
  await page.evaluate((t) => window.__seek(t), f / fps);
  if (errors.length && !allowErrors) throw new Error(`script error at ${(f / fps).toFixed(3)}s (frame ${f}): ${errors[0].detail}`);
  const buf = await capture(page);
  return { buf, hash: crypto.createHash('sha1').update(buf).digest('hex') };
}

/** PSNR of two PNGs via ffmpeg, also writing an amplified difference image; null if unmeasurable */
function psnr(fa, fb, diff) {
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', fa, '-i', fb, '-filter_complex',
    '[0:v]format=rgb24[x];[1:v]format=rgb24[y];[x][y]blend=all_mode=difference,curves=all=0/0 0.05/1 1/1', '-frames:v', '1', diff]);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', fa, '-i', fb, '-filter_complex', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:(inf|[\d.]+)/.exec(r.stderr || '');
  return m ? (m[1] === 'inf' ? 99 : +(+m[1]).toFixed(1)) : null;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), s | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
