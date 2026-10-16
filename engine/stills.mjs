#!/usr/bin/env node
/**
 * Grab stills for review without a full render — the feedback loop's eyes.
 *
 *   node engine/stills.mjs projects/<name> [--every 0.5] [--at 1.2,3,4.5] [--scenes]
 *        [--format 9x16] [--cols 6] [--width 480] [--allow-errors]
 *
 * Writes out/stills/t<sec>.png plus out/stills/contact.png: a grid where every tile is labelled with its
 * time and scene, so a tile can be matched to a moment without counting. The previous run moves to
 * out/stills-prev/ (before/after for the critique loop).
 * --scenes grabs the midpoint and last frame of every registered scene.
 * Also refreshes audio/cues.json from the composition's M.cue() calls.
 * Refuses to run when the comp has missing assets/fonts or page errors (--allow-errors overrides).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, serve, args, projectDir, urlPath, launch, openComp, dumpCues, brief, capture } from './lib/common.mjs';

const a = args();
const dir = projectDir(a._[0]);
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}${urlPath(dir)}`;
const browser = await launch();
const bail = async (e) => {
  console.error('✖ ' + brief(e));
  await browser.close().catch(() => {});
  server.close();
  process.exit(1);
};
const { page, comp, errors } = await openComp(browser, base, { format: a.format, allowErrors: !!a['allow-errors'] }).catch(bail);
const { scenes } = await dumpCues(page, dir).catch(bail);

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
const prev = `${out}-prev`;
fs.rmSync(prev, { recursive: true, force: true });
if (fs.existsSync(out)) fs.renameSync(out, prev);
fs.mkdirSync(out, { recursive: true });
const files = [];
try {
  for (const t of times) {
    await page.evaluate((x) => window.__seek(x), t);
    if (errors.length && !a['allow-errors']) throw new Error(`page error while seeking to ${t}s: ${errors[0].detail}`);
    const f = path.join(out, `t${t.toFixed(2).padStart(6, '0')}.png`);
    fs.writeFileSync(f, await capture(page));
    files.push({ f, t });
  }
  await page.close();
  await contactSheet(files);
} catch (e) { await bail(e); }
await browser.close();
server.close();
console.log(`✔ ${files.length} stills → ${path.relative(process.cwd(), out)}${fs.existsSync(prev) ? `  (previous run in ${path.basename(prev)}/)` : ''}`);
console.log(`  contact sheet: ${path.relative(process.cwd(), path.join(out, 'contact.png'))}  (labelled with time + scene)`);

/** lay the stills out in the browser (no font files needed by ffmpeg) and screenshot the grid */
async function contactSheet(list) {
  const cols = Math.min(+a.cols || 6, list.length);
  const w = +a.width || 480;
  const h = Math.round((w * comp.height) / comp.width);
  const sceneAt = (t) => scenes.filter((s) => t >= s.start && t < s.end).map((s) => s.name).join(' + ');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tiles = list.map(({ f, t }) => {
    const src = `${origin}/${path.relative(ROOT, f).split(path.sep).join('/')}`;
    return `<figure><img src="${src}"><figcaption><b>${t.toFixed(2)}s</b>${sceneAt(t) ? ` · ${esc(sceneAt(t))}` : ''}</figcaption></figure>`;
  }).join('');
  const sheet = await browser.newPage({ viewport: { width: cols * (w + 6) + 6, height: 200 } });
  await sheet.setContent(`<!doctype html><style>
    body{margin:0;background:#202024;font:600 15px/1.2 ui-monospace,Consolas,monospace;color:#e8e6e1}
    main{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;padding:6px}
    figure{margin:0;position:relative;width:${w}px;height:${h}px;background:#000}
    img{width:100%;height:100%;object-fit:contain;display:block}
    figcaption{position:absolute;left:6px;top:6px;padding:3px 7px;border-radius:4px;background:rgba(0,0,0,.72);max-width:${w - 24}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    b{color:#ffb547}
  </style><main>${tiles}</main>`, { waitUntil: 'load' });
  await sheet.screenshot({ path: path.join(out, 'contact.png'), fullPage: true });
  await sheet.close();
}
