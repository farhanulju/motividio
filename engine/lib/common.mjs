// Shared helpers for engine scripts: static server, page loading, arg parsing, ffmpeg.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

/** Minimal static server rooted at the repo, with Range support (needed for <video> seeking). */
export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404).end('not found'); return; }
    const stat = fs.statSync(p);
    const type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? +range[1] : 0;
      const end = range[2] ? +range[2] : stat.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(p, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      fs.createReadStream(p).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** parse `--key value` / `--flag` args; positional args in _ */
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) out[k] = true;
      else { out[k] = n; i++; }
    } else out._.push(a);
  }
  return out;
}

/** resolve a project argument: "demo", "projects/demo", or an absolute path */
export function projectDir(arg) {
  if (!arg) die('usage: pass a project, e.g. projects/my-video');
  const cands = [path.resolve(arg), path.join(ROOT, 'projects', arg)];
  const dir = cands.find((d) => fs.existsSync(path.join(d, 'index.html')));
  if (!dir) die(`no index.html found for project "${arg}"`);
  return dir;
}

export const urlPath = (dir) => '/' + path.relative(ROOT, dir).split(path.sep).join('/') + '/';

/** an error for humans: drop Playwright's "page.evaluate:" prefix and all but the first stack line */
export function brief(e) {
  const lines = String(e?.message ?? e).replace(/^\w+\.\w+: (Error: )?/, '').split(/\r?\n/);
  const stack = lines.filter((l) => /^\s+at /.test(l));
  return [...lines.filter((l) => !/^\s+at /.test(l)), ...stack.slice(0, 1)].join('\n');
}

export function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

export async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    die('playwright not installed — run: npm install && npx playwright install chromium');
  }
  return chromium.launch({ args: ['--disable-web-security', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none'] });
}

/** A composition that can't render correctly: missing assets/fonts, page errors. Message lists every problem. */
export class CompError extends Error {
  constructor(problems) {
    super(`composition has ${problems.length} problem(s) — fix them, or pass --allow-errors to render anyway:\n` +
      problems.map((p) => `    · [${p.kind}] ${p.detail}`).join('\n'));
    this.problems = problems;
  }
}

/**
 * Open a composition in render mode and wait until it is ready; returns { page, comp, errors }.
 * Fails loud: missing images/fonts/stylesheets, rejected M.wait() tasks, page errors, console errors and
 * failed asset requests throw a CompError unless allowErrors. `errors` stays live — callers check it
 * after each frame, because a script error mid-render must stop the render too.
 */
export async function openComp(browser, base, { format, fps, scale = 1, probe, allowErrors = false } = {}) {
  const q = new URLSearchParams({ render: '1' });
  if (format) q.set('format', format);
  if (fps) q.set('fps', fps);
  // the stage is a fixed-size absolute box in render mode, so one load is enough:
  // open at the probe size (or a guess), learn the comp size, then resize the viewport in place.
  const guess = probe || { width: 1920, height: 1080 };
  const page = await browser.newPage({ viewport: { width: guess.width, height: guess.height }, deviceScaleFactor: +scale });
  const errors = watchErrors(page);
  page.setDefaultTimeout(600000);
  await page.goto(`${base}?${q}`, { waitUntil: 'load', timeout: 600000 });
  const comp = await page.evaluate(() => window.__ready);
  if (comp.width !== guess.width || comp.height !== guess.height) await page.setViewportSize({ width: comp.width, height: comp.height });
  const ignored = (p) => (comp.ignore || []).some((s) => p.detail.includes(s));
  const problems = dedupe([...(comp.problems || []), ...errors]).filter((p) => !ignored(p));
  if (comp.ignore?.length) { // keep ignoring them while frames render, too
    const push = errors.push.bind(errors);
    errors.push = (...ps) => push(...ps.filter((p) => !ignored(p)));
  }
  if (problems.length && !allowErrors) { await page.close(); throw new CompError(problems); }
  if (problems.length && !probe) console.warn(`  ⚠ --allow-errors: ignoring ${problems.length} problem(s)`);
  errors.length = 0; // from here on, errors = what happened while seeking
  return { page, comp, errors };
}

/** one line per problem: a failed request already named by a runtime problem, or a repeat, is dropped */
function dedupe(problems) {
  const named = problems.filter((p) => p.kind !== 'request' && p.kind !== 'page error').map((p) => p.detail).join(' | ');
  const keys = new Set();
  return problems.filter((p) => {
    const url = p.kind === 'request' ? p.detail.split(' ')[1] : null;
    if ((url && named.includes(url)) || (p.kind === 'page error' && named.includes(p.detail))) return false;
    const k = url || `${p.kind}|${p.detail}`;
    if (keys.has(k)) return false;
    keys.add(k);
    return true;
  });
}

/**
 * Screenshot the page through CDP with optimizeForSpeed: same decoded pixels as page.screenshot(),
 * ~1.7× faster (cheaper PNG compression). type 'png' | 'jpeg' (quality 0–100).
 */
const cdpSessions = new WeakMap();
export async function capture(page, { type = 'png', quality = 92 } = {}) {
  let cdp = cdpSessions.get(page);
  if (!cdp) { cdp = await page.context().newCDPSession(page); cdpSessions.set(page, cdp); }
  const r = await cdp.send('Page.captureScreenshot', { format: type, ...(type === 'jpeg' ? { quality } : {}), optimizeForSpeed: true, captureBeyondViewport: false });
  return Buffer.from(r.data, 'base64');
}

const ASSET_TYPES = new Set(['image', 'font', 'stylesheet', 'script', 'media']);
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => { errors.push({ kind: 'page error', detail: e.message }); console.error('  [page error]', e.message); });
  // "Failed to load resource" duplicates the response check below, and also fires for optional fetches
  page.on('console', (m) => {
    if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push({ kind: 'console', detail: m.text() });
  });
  // fetch/xhr failures are left to the page (M.loadBeats falls back on purpose); asset loads must succeed
  page.on('requestfailed', (r) => {
    if (ASSET_TYPES.has(r.resourceType())) errors.push({ kind: 'request', detail: `${r.resourceType()} ${r.url()} — ${r.failure()?.errorText}` });
  });
  page.on('response', (r) => {
    const req = r.request();
    if (r.status() >= 400 && ASSET_TYPES.has(req.resourceType()) && !/favicon\.ico$/.test(r.url())) {
      errors.push({ kind: 'request', detail: `${req.resourceType()} ${r.url()} — HTTP ${r.status()}` });
    }
  });
  return errors;
}

/**
 * sha256 of a project's inputs (everything but out/ and work/) — identifies "the same film" for resume + manifests.
 * media: false leaves out audio/*.wav|mp3… so re-mixing doesn't invalidate rendered video chunks
 * (beats.json / vo.json still count: comps read them for timing).
 */
export function hashTree(dir, { skip = ['out', 'work', 'node_modules', '.git'], media = true } = {}) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.includes(e.name) && !e.name.startsWith('.')) walk(p); continue; }
      if (/\.md$|^learn\.json$|^cues\.json$/.test(e.name)) continue; // notes and generated cue dumps don't change frames
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (!media && /^audio\/.*\.(wav|mp3|ogg|m4a|flac|aac)$/i.test(rel)) continue;
      const st = fs.statSync(p);
      h.update(rel);
      // hash content; huge files (3D models, source footage) by size + mtime to keep it fast
      if (st.size > 64 * 1024 * 1024) h.update(`${st.size}:${st.mtimeMs}`);
      else h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

/** sha256 of the in-page engine (what decides how frames look) */
export function engineHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['runtime.js', 'kit.js', 'cube.js']) {
    const p = path.join(ROOT, 'engine', f);
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
  return h.digest('hex');
}

export function gitInfo() {
  const g = (...argv) => spawnSync('git', ['-C', ROOT, ...argv], { encoding: 'utf8' }).stdout?.trim() || null;
  return { commit: g('rev-parse', 'HEAD'), engineDirty: !!g('status', '--porcelain', '--', 'engine') };
}

/** next free path: file.mp4, then file-v2.mp4, file-v3.mp4 … (delivered renders are never overwritten) */
export function nextVersion(file) {
  if (!fs.existsSync(file)) return file;
  const { dir, name, ext } = path.parse(file);
  for (let v = 2; ; v++) {
    const f = path.join(dir, `${name}-v${v}${ext}`);
    if (!fs.existsSync(f)) return f;
  }
}

export function hasBin(bin) {
  const r = spawnSync(bin, ['-version'], { stdio: 'ignore', shell: false });
  return r.status === 0;
}

export function run(bin, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, argv, { stdio: opts.stdio || ['ignore', 'inherit', 'inherit'], ...opts });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}`))));
  });
}

export function ffprobeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return parseFloat(r.stdout) || 0;
}

/** write the composition's declared sound cues to audio/cues.json */
export async function dumpCues(page, dir) {
  const cues = await page.evaluate(() => (window.__cues ? window.__cues() : []));
  const scenes = await page.evaluate(() => (window.__scenes ? window.__scenes() : []));
  const comp = await page.evaluate(() => window.__comp);
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', 'cues.json'), JSON.stringify({ comp, cues, scenes }, null, 2));
  return { comp, cues, scenes };
}
