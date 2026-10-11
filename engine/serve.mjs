#!/usr/bin/env node
/**
 * Live preview server (repo root). Open the printed URL in any browser:
 * space = play/pause, ←/→ = frame step (shift = 1s), click the bar to scrub,
 * ?format=9x16 to switch aspect, ?t=4.2 to jump, ?autoplay to start playing.
 *
 *   node engine/serve.mjs [projects/<name>] [--port 4321]
 */
import fs from 'node:fs';
import path from 'node:path';
import { serve, args, ROOT, urlPath } from './lib/common.mjs';

const a = args();
const port = +a.port || 4321;
const server = await serve(port);
const p = server.address().port;
console.log(`Motividio preview server on port ${p}`);
if (a._[0]) {
  const dir = fs.existsSync(path.resolve(a._[0])) ? path.resolve(a._[0]) : path.join(ROOT, 'projects', a._[0]);
  console.log(`  project → http://127.0.0.1:${p}${urlPath(dir)}`);
} else {
  const projects = fs.existsSync(path.join(ROOT, 'projects')) ? fs.readdirSync(path.join(ROOT, 'projects')) : [];
  for (const n of projects) if (fs.existsSync(path.join(ROOT, 'projects', n, 'index.html'))) console.log(`  ${n} → http://127.0.0.1:${p}/projects/${n}/`);
}
console.log('Ctrl+C to stop.');
