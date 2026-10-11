#!/usr/bin/env node
/**
 * Capture a brand's real assets from its website: screenshots, logo candidates, colors, fonts.
 *
 *   node engine/capture.mjs <url> --brand <slug> [--pages /,/pricing,/features] [--width 1440] [--mobile]
 *
 * Writes brands/<slug>/
 *   screens/<page>.png        viewport @2x       screens/<page>-full.png  full page @1x
 *   screens/<page>-m.png      mobile viewport (with --mobile)
 *   logos/…                   favicon, apple-touch-icon, og:image, inline/header SVG + <img> logos
 *   extracted.json            title, description, top colors (bg/text/accent), fonts, headings, CTAs
 * Then write brands/<slug>/brand.md from templates/brand.md — verify colors/fonts by eye.
 * Prefer real product UI screenshots (login-free pages, docs, press kit) over marketing art.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, ROOT, die, launch } from './lib/common.mjs';

const a = args();
const url = a._[0] || die('usage: node engine/capture.mjs <url> --brand <slug>');
const slug = a.brand || new URL(url).hostname.replace(/^www\./, '').split('.')[0];
const dir = path.join(ROOT, 'brands', slug);
for (const d of ['screens', 'logos']) fs.mkdirSync(path.join(dir, d), { recursive: true });
// Git Bash on Windows rewrites a leading "/" into "C:/Program Files/Git/" — undo that.
const unmangle = (p) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:\/.*?Git\/?/i, '/');
const pages = String(a.pages || '/').split(',').map((p) => unmangle(p.trim())).filter(Boolean).map((p) => (p.startsWith('/') ? p : '/' + p));
const width = +a.width || 1440;

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
const page = await ctx.newPage();
const extracted = { url, pages: {} };

const settle = async () => {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // reveal lazy content
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
};

for (const p of pages) {
  const target = new URL(p, url).href;
  const name = (p === '/' ? 'home' : p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')) || 'page';
  console.log(`→ ${target}`);
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) { console.warn(`  ✖ ${e.message}`); continue; }
  await settle();
  await page.screenshot({ path: path.join(dir, 'screens', `${name}.png`) });
  await page.screenshot({ path: path.join(dir, 'screens', `${name}-full.png`), fullPage: true, scale: 'css' }).catch(() => {});

  const info = await page.evaluate(() => {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
    const count = new Map();
    const bump = (k, w) => k && !/rgba\(0, 0, 0, 0\)|transparent/.test(k) && count.set(k, (count.get(k) || 0) + w);
    const fonts = new Map();
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el), area = Math.min(r.width * r.height, 2e6);
      bump('bg ' + cs.backgroundColor, area);
      if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        bump('text ' + cs.color, r.width * 10);
        const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        fonts.set(fam, (fonts.get(fam) || 0) + 1);
      }
      if (el.matches('a,button,[role=button]')) bump('accent ' + cs.backgroundColor, 5e4);
    }
    const top = (prefix, n) => [...count].filter(([k]) => k.startsWith(prefix)).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k]) => k.slice(prefix.length + 1));
    const logoImgs = [...document.querySelectorAll('header img, nav img, a[href="/"] img, img[alt*="logo" i], img[src*="logo" i], img[class*="logo" i]')]
      .map((i) => abs(i.currentSrc || i.src)).filter(Boolean);
    const logoSvgs = [...document.querySelectorAll('header svg, nav svg, a[href="/"] svg, svg[class*="logo" i], [class*="logo" i] svg')]
      .filter((s) => s.getBoundingClientRect().width > 40).slice(0, 4).map((s) => s.outerHTML);
    const icons = [...document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]')].map((l) => abs(l.href)).filter(Boolean);
    const og = document.querySelector('meta[property="og:image"]')?.content;
    const h = (s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 8);
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      colors: { backgrounds: top('bg', 6), text: top('text', 5), accents: top('accent', 5) },
      fonts: [...fonts].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([f]) => f),
      fontLinks: [...document.querySelectorAll('link[href*="fonts"]')].map((l) => l.href),
      headings: { h1: h('h1'), h2: h('h2') },
      ctas: h('a[class*="button" i], button, a[class*="btn" i]').slice(0, 8),
      logos: { imgs: [...new Set(logoImgs)].slice(0, 6), svgs: logoSvgs, icons: [...new Set(icons)], og: og ? abs(og) : null },
    };
  });
  extracted.pages[name] = info;

  if (a.mobile) {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
    await m.goto(target, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await m.waitForTimeout(800);
    await m.screenshot({ path: path.join(dir, 'screens', `${name}-m.png`) });
    await m.close();
  }
}

// download logo candidates
const home = Object.values(extracted.pages)[0];
let k = 0;
if (home) {
  home.logos.svgs.forEach((svg, i) => fs.writeFileSync(path.join(dir, 'logos', `inline-${i + 1}.svg`), svg));
  for (const u of [...home.logos.imgs, ...home.logos.icons, home.logos.og].filter(Boolean)) {
    try {
      const r = await ctx.request.get(u, { timeout: 15000 });
      if (!r.ok()) continue;
      const ct = r.headers()['content-type'] || '';
      const ext = ct.includes('svg') ? 'svg' : ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('icon') ? 'ico' : ct.includes('jpeg') ? 'jpg' : path.extname(new URL(u).pathname).slice(1) || 'bin';
      fs.writeFileSync(path.join(dir, 'logos', `logo-${++k}.${ext}`), await r.body());
    } catch {}
  }
}
fs.writeFileSync(path.join(dir, 'extracted.json'), JSON.stringify(extracted, null, 2));
await browser.close();
console.log(`✔ brands/${slug}: ${pages.length} page(s), ${k + (home?.logos.svgs.length || 0)} logo candidates`);
console.log('  next: inspect screens/ + logos/, then write brand.md from templates/brand.md');
