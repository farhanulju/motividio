#!/usr/bin/env node
/**
 * Delivery QA: check the final renders of a project before they go out.
 *
 *   node engine/qa.mjs projects/<name> [--file out/x.mp4] [--no-safe] [--allow-errors]
 *
 * Picks the newest final render per format in out/ (or --file), then checks:
 *   errors    resolution / fps / duration vs the comp · H.264 + yuv420p · audio present when audio/mix.wav exists
 *   warnings  loudness (−14 ±1 LUFS, true peak ≤ −1 dBTP) · dead holds (frozen > 0.8s outside the final 3.5s)
 *             · black gaps (> 0.25s) · VO under 6 dB over the bed (audio/levels.json) · stale render (the comp
 *             changed since) · text outside the safe area for its format (social UI covers the edges of 9x16)
 * Exit code 1 when any error is found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serve, args, projectDir, urlPath, launch, openComp, brief, hashTree } from './lib/common.mjs';

const a = args();
const dir = projectDir(a._[0]);
const name = path.basename(dir);
const outDir = path.join(dir, 'out');

/** safe box per format, as fractions of width/height: [left, top, right, bottom] margins */
const SAFE = { '16x9': [0.03, 0.03, 0.03, 0.03], '9x16': [0.06, 0.12, 0.06, 0.2], '1x1': [0.06, 0.06, 0.06, 0.1], '4x5': [0.06, 0.06, 0.06, 0.1] };

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}${urlPath(dir)}`;
const browser = await launch();
let errorsN = 0, warningsN = 0;
try {
  await main();
} catch (e) {
  console.error('✖ ' + brief(e));
  errorsN++;
}
await browser.close().catch(() => {});
server.close();
console.log(errorsN ? `\n✖ QA failed: ${errorsN} error(s), ${warningsN} warning(s)` : `\n✔ QA passed${warningsN ? ` with ${warningsN} warning(s)` : ''}`);
process.exit(errorsN ? 1 : 0);

async function main() {
  const first = await openComp(browser, base, { allowErrors: !!a['allow-errors'] });
  const formats = first.comp.formats;
  await first.page.close();
  const visual = hashTree(dir, { media: false });

  const files = a.file ? [path.resolve(dir, a.file)] : latestFinals();
  if (!files.length) throw new Error(`no final renders in ${path.relative(process.cwd(), outDir)} — run npm run render first`);
  const seen = new Set();
  for (const file of files) {
    const man = readJson(file.replace(/\.mp4$/i, '.json'));
    const pr = probe(file);
    const format = man?.format || formats.find((f) => sizeOf(f, first.comp).join('x') === `${pr.width}x${pr.height}`) || '16x9';
    seen.add(format);
    const { page, comp } = await openComp(browser, base, { format, allowErrors: !!a['allow-errors'] });
    await page.close();
    console.log(`\n▶ ${path.relative(process.cwd(), file)} [${format}]`);
    const E = (m) => { errorsN++; console.log(`  ✖ ${m}`); };
    const W = (m) => { warningsN++; console.log(`  ⚠ ${m}`); };
    const ok = (m) => console.log(`  ✔ ${m}`);

    // container + stream
    if (pr.width !== comp.width || pr.height !== comp.height) E(`resolution ${pr.width}x${pr.height}, comp is ${comp.width}x${comp.height}`); else ok(`${pr.width}x${pr.height}`);
    if (Math.abs(pr.fps - comp.fps) > 0.01) E(`${pr.fps} fps, comp is ${comp.fps}`); else ok(`${pr.fps} fps`);
    if (Math.abs(pr.duration - comp.duration) > 1.5 / comp.fps) E(`duration ${pr.duration}s, comp is ${comp.duration}s`); else ok(`duration ${pr.duration}s`);
    if (pr.vcodec !== 'h264' || pr.pix !== 'yuv420p') E(`video ${pr.vcodec}/${pr.pix} — deliver H.264 yuv420p`); else ok('H.264 yuv420p');
    const mixFile = path.join(dir, 'audio', 'mix.wav');
    if (!pr.acodec && fs.existsSync(mixFile)) E('no audio track, but audio/mix.wav exists');
    if (man && man.inputs?.visual && man.inputs.visual !== visual) W('stale: the composition changed since this render');

    // sound
    if (pr.acodec) {
      const L = man?.loudness || loudness(file);
      if (L) {
        if (Math.abs(L.lufs + 14) > 1) W(`loudness ${L.lufs} LUFS (target −14)`); else ok(`loudness ${L.lufs} LUFS`);
        if (L.truePeak > -1) W(`true peak ${L.truePeak} dBTP (keep ≤ −1)`);
      }
      const lv = readJson(path.join(dir, 'audio', 'levels.json'));
      if (lv?.worst != null) (lv.worst < lv.target ? W : ok)(`VO ≥ ${lv.worst} dB over the bed (target ${lv.target})`);
    }

    // picture: dead holds + black gaps
    const holds = detect(file, 'freezedetect=n=-60dB:d=0.8', 'freeze').filter(([s]) => s < pr.duration - 3.5);
    for (const [s, e] of holds) W(`dead hold ${s.toFixed(2)}–${e.toFixed(2)}s (nothing moves for ${(e - s).toFixed(1)}s)`);
    const blacks = detect(file, 'blackdetect=d=0.25:pix_th=0.06', 'black').filter(([s]) => s > 0.05);
    for (const [s, e] of blacks) W(`black ${s.toFixed(2)}–${e.toFixed(2)}s`);
    if (!holds.length && !blacks.length) ok('no dead holds or black gaps');

    if (!a['no-safe']) await safeAreas(format, comp, W, ok);
  }
  for (const f of formats) if (!seen.has(f) && !a.file) { warningsN++; console.log(`\n⚠ no final render for format ${f}`); }
}

function latestFinals() {
  if (!fs.existsSync(outDir)) return [];
  const byFormat = new Map();
  for (const f of fs.readdirSync(outDir).filter((x) => x.endsWith('.mp4'))) {
    const file = path.join(outDir, f);
    const man = readJson(file.replace(/\.mp4$/i, '.json'));
    const key = man?.format || f.replace(/-v\d+\.mp4$|\.mp4$/, '');
    const when = man ? Date.parse(man.renderedAt) : fs.statSync(file).mtimeMs;
    if (!byFormat.has(key) || byFormat.get(key).when < when) byFormat.set(key, { file, when });
  }
  return [...byFormat.values()].map((x) => x.file);
}

/** text elements that sit inside the frame but outside the safe box, sampled every 0.25s */
async function safeAreas(format, comp, W, ok) {
  const [l, t, r, b] = SAFE[format] || SAFE['16x9'];
  const box = { x0: comp.width * l, y0: comp.height * t, x1: comp.width * (1 - r), y1: comp.height * (1 - b) };
  const { page } = await openComp(browser, base, { format, allowErrors: true, probe: comp });
  const hits = new Map();
  for (let s = 0; s < comp.duration; s += 0.25) {
    await page.evaluate((x) => window.__seek(x), s);
    const found = await page.evaluate(({ box, W, H }) => {
      const out = [];
      const stage = document.getElementById('stage');
      const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        let o = 1;
        for (let e = el; e && e !== stage.parentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity;
        if (o < 0.15) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rc of range.getClientRects()) {
          if (rc.width < 2 || rc.height < 2) continue;
          // text crossing the frame edge is a deliberate crop; only flag text fully in frame but outside the safe box
          const inFrame = rc.left >= 0 && rc.top >= 0 && rc.right <= W && rc.bottom <= H;
          const inSafe = rc.left >= box.x0 && rc.top >= box.y0 && rc.right <= box.x1 && rc.bottom <= box.y1;
          if (inFrame && !inSafe) {
            // key by element position in the tree, so a ticking timecode counts once
            let key = '', e = el;
            while (e && e !== stage) { key = `${e.tagName}${[...e.parentElement.children].indexOf(e)}/${key}`; e = e.parentElement; }
            out.push({ key, text: n.textContent.trim().slice(0, 40) });
            break;
          }
        }
      }
      return out;
    }, { box, W: comp.width, H: comp.height });
    for (const h of found) if (!hits.has(h.key)) hits.set(h.key, { text: h.text, t: s });
  }
  await page.close();
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (!hits.size) ok(`text inside the ${format} safe area (margins L${pct(l)} T${pct(t)} R${pct(r)} B${pct(b)})`);
  if (hits.size) {
    const list = [...hits.values()];
    W(`${list.length} text element(s) outside the ${format} safe area (margins L${pct(l)} T${pct(t)} R${pct(r)} B${pct(b)}):` +
      list.slice(0, 6).map((h) => `
      ${h.t.toFixed(2)}s "${h.text}"`).join('') + (list.length > 6 ? `
      … +${list.length - 6} more in out/qa-${format}.json` : ''));
    fs.writeFileSync(path.join(outDir, `qa-${format}.json`), JSON.stringify({ format, margins: { l, t, r, b }, outside: list }, null, 2));
  }
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout || '{}');
  const v = j.streams?.find((s) => s.codec_type === 'video') || {}, au = j.streams?.find((s) => s.codec_type === 'audio');
  const [n, d] = (v.r_frame_rate || '0/1').split('/').map(Number);
  return { width: v.width, height: v.height, fps: +(n / d).toFixed(3), vcodec: v.codec_name, pix: v.pix_fmt, acodec: au?.codec_name || null, duration: +(+j.format?.duration || 0).toFixed(3) };
}

function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const last = (re) => { const m = [...(r.stderr || '').matchAll(re)]; return m.length ? +m[m.length - 1][1] : null; };
  const lufs = last(/I:\s+(-?[\d.]+) LUFS/g);
  return lufs === null ? null : { lufs, truePeak: last(/Peak:\s+(-?[\d.]+) dBFS/g) };
}

/** run a detect filter and pair its *_start / *_end log lines into [start, end] spans */
function detect(file, filter, word) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:v', '-vf', filter, '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr || '';
  const starts = [...log.matchAll(new RegExp(`${word}_start:\\s*([\\d.]+)`, 'g'))].map((m) => +m[1]);
  const ends = [...log.matchAll(new RegExp(`${word}_end:\\s*([\\d.]+)`, 'g'))].map((m) => +m[1]);
  const dur = probe(file).duration;
  return starts.map((s, i) => [s, ends[i] ?? dur]);
}

function sizeOf(format, comp) {
  return { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] }[format] || [comp.width, comp.height];
}
function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
