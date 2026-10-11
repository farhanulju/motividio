#!/usr/bin/env node
// Check the toolchain: node, ffmpeg, ffprobe, yt-dlp, Playwright Chromium, Fish Audio config.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/common.mjs';

const ok = (b, label, hint = '') => console.log(`${b ? '✔' : '✖'} ${label}${!b && hint ? `  → ${hint}` : ''}`);
const ver = (bin, flag = '-version') => {
  const r = spawnSync(bin, [flag], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || r.stderr).split('\n')[0].trim() : null;
};

console.log(`Motividio doctor — ${ROOT}\n`);
ok(true, `node ${process.version}`);
const ff = ver('ffmpeg'); ok(!!ff, ff || 'ffmpeg', 'winget install Gyan.FFmpeg');
const fp = ver('ffprobe'); ok(!!fp, fp ? 'ffprobe' : 'ffprobe', 'comes with ffmpeg');
const yt = ver('yt-dlp', '--version'); ok(!!yt, `yt-dlp ${yt || ''}`, 'winget install yt-dlp.yt-dlp (only for reference downloads)');
let pw = false;
try {
  const { chromium } = await import('playwright');
  const b = await chromium.launch(); await b.close(); pw = true;
} catch {}
ok(pw, 'playwright chromium', 'npm install && npx playwright install chromium');
const mcp = fs.existsSync(path.join(ROOT, '.mcp.json')) && fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8').includes('fish');
ok(mcp, 'Fish Audio MCP registered in .mcp.json', 'see README → Voice');
const env = fs.existsSync(path.join(ROOT, '.env')) && /FISH_API_KEY\s*=\s*\S+/.test(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'));
ok(env || !!process.env.FISH_API_KEY, 'FISH_API_KEY (REST fallback, optional)', 'copy .env.example → .env and paste your key');
