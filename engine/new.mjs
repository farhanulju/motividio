#!/usr/bin/env node
/**
 * Scaffold a new film: node engine/new.mjs <slug> [--brand <slug>] [--duration 15] [--formats 16x9,9x16]
 * Creates projects/<slug>/ with brief.md, shotlist.md, index.html, audio/score.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, ROOT, die } from './lib/common.mjs';

const a = args();
const slug = a._[0] || die('usage: node engine/new.mjs <slug>');
const dir = path.join(ROOT, 'projects', slug);
if (fs.existsSync(dir)) die(`projects/${slug} already exists`);
const T = path.join(ROOT, 'templates', 'project');
const vars = {
  SLUG: slug,
  BRAND: a.brand || '',
  DURATION: a.duration || 15,
  FORMATS: JSON.stringify(String(a.formats || '16x9').split(',')),
  DATE: new Date().toISOString().slice(0, 10),
};
const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
const copy = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copy(s, d);
    else fs.writeFileSync(d, fill(fs.readFileSync(s, 'utf8')));
  }
};
copy(T, dir);
for (const f of ['brief.md', 'shotlist.md']) {
  const src = path.join(ROOT, 'templates', f === 'brief.md' ? 'director-brief.md' : 'shotlist.md');
  fs.writeFileSync(path.join(dir, f), fill(fs.readFileSync(src, 'utf8')));
}
fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
console.log(`✔ projects/${slug} created — fill brief.md, then shotlist.md (beat grid), then index.html`);
