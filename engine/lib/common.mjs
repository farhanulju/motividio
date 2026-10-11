// Shared helpers for engine scripts: static server, page loading, arg parsing, ffmpeg.
import http from 'node:http';
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

/** open a composition in render mode and wait until it is ready; returns { page, comp } */
export async function openComp(browser, base, { format, fps, scale = 1, probe } = {}) {
  const q = new URLSearchParams({ render: '1' });
  if (format) q.set('format', format);
  if (fps) q.set('fps', fps);
  // probe to learn the comp size first, then open at that exact viewport
  let size = probe;
  if (!size) {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    attachConsole(p);
    await p.goto(`${base}?${q}`, { waitUntil: 'load' });
    size = await p.evaluate(() => window.__ready);
    await p.close();
  }
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: +scale });
  attachConsole(page);
  await page.goto(`${base}?${q}`, { waitUntil: 'load' });
  const comp = await page.evaluate(() => window.__ready);
  return { page, comp };
}

function attachConsole(page) {
  page.on('pageerror', (e) => console.error('  [page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('  [console]', m.text()); });
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
