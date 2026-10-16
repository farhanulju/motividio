#!/usr/bin/env node
/**
 * The studio's recorded sound library: library/library.json (committed) indexes recorded SFX and music
 * files kept in library/sfx and library/music (local only — gitignored, licenses don't allow redistribution).
 *
 *   node engine/library.mjs list                         # types, variants, music; flags missing files
 *   node engine/library.mjs scan                         # measure peak time / duration / loudness of every entry
 *   node engine/library.mjs add <file> --type whoosh [--gain 0.5] [--peak 0.4] [--source mixkit.co --license "..."]
 *   node engine/library.mjs add <file> --music [--title "..." --bpm 120 --mood calm,warm]
 *
 * score.json with "sound": "recorded" maps every M.cue(t, type) to a recorded variant of that type
 * (aligned so the file's peak lands on the cue), and plays "music": { file, segments } as an edit of a
 * recorded track. Entries: { file, gain, peak, from, dur, fadeIn, fadeOut, source, license }.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, args, die } from './lib/common.mjs';

export const LIB = path.join(ROOT, 'library');
const MANIFEST = path.join(LIB, 'library.json');
/** cue types that stay synthesized even in recorded mode (the user accepts synth only for these) */
export const SYNTH_OK = new Set(['turn', 'cube']);

export function loadLibrary(file = MANIFEST) {
  if (!fs.existsSync(file)) return { version: 1, sfx: {}, music: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const save = (lib) => fs.writeFileSync(MANIFEST, JSON.stringify(lib, null, 2) + '\n');

/** "library:sfx/x.mp3" → library path; anything else is relative to the project's audio/ dir */
export function resolveFile(ref, audioDir) {
  if (ref.startsWith('library:')) return path.join(LIB, ref.slice(8));
  return path.isAbsolute(ref) ? ref : path.join(audioDir, ref);
}

/** deterministic variant choice: same cue time → same file, neighbouring cues → different files */
export function pickVariant(variants, t) {
  if (!variants?.length) return null;
  const h = crypto.createHash('sha1').update(String(Math.round(t * 1000))).digest();
  return variants[h.readUInt32BE(0) % variants.length];
}

/**
 * Turn synth-typed cues into recorded `sample` cues.
 * overrides: score.json → sounds { type: entry } (files relative to audio/ or "library:…").
 * Returns { cues, dropped: { type: count } } — types with no recording (and not SYNTH_OK) are dropped, loudly.
 */
export function recordedCues(cues, { lib = loadLibrary(), overrides = {}, audioDir }) {
  const out = [], dropped = {};
  for (const c of cues) {
    if (c.type === 'sample' || SYNTH_OK.has(c.type)) { out.push(c); continue; }
    const o = overrides[c.type];
    const entry = o ? { ...o, file: resolveFile(o.file, audioDir) } : (() => {
      const v = pickVariant(lib.sfx?.[c.type], c.t);
      return v && { ...v, file: path.join(LIB, v.file) };
    })();
    if (!entry || !fs.existsSync(entry.file)) { dropped[c.type] = (dropped[c.type] || 0) + 1; continue; }
    const { peak = 0, gain = 1, source, license, lufs, variants, ...rest } = entry;
    const { type, gain: cg, ...opts } = c;
    out.push({ ...rest, ...opts, t: Math.max(0, c.t - peak), type: 'sample', duck: false, gain: (cg ?? 1) * gain, tag: type });
  }
  return { cues: out, dropped };
}

/** score.json → music: { file, segments: [{ t, from, dur, gain, fadeIn, fadeOut }] } (or one segment: { file, from, gain }) */
export function musicCues(music, duration, audioDir) {
  const file = resolveFile(music.file, audioDir);
  if (!fs.existsSync(file)) throw new Error(`music file missing: ${file}`);
  const segs = music.segments?.length ? music.segments
    : [{ t: 0, from: music.from || 0, dur: duration, gain: music.gain ?? 1, fadeIn: music.fadeIn ?? 0.05, fadeOut: music.fadeOut ?? 1 }];
  return segs.map((s) => ({ type: 'sample', file, t: s.t || 0, from: s.from || 0, dur: s.dur ?? duration - (s.t || 0), gain: s.gain ?? 1, fadeIn: s.fadeIn ?? 0.05, fadeOut: s.fadeOut ?? 0.3 }));
}

/** decode to mono 48k float and find the loudest point in the first 4s (the transient a cue should land on) */
function measure(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  let max = 0, at = 0;
  for (let i = 0, n = Math.min(f.length, 48000 * 4); i < n; i++) if (Math.abs(f[i]) > max) { max = Math.abs(f[i]); at = i; }
  const lr = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...(lr.stderr || '').matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return { peak: +(at / 48000).toFixed(3), length: +(f.length / 48000).toFixed(3), lufs: m ? +m[1] : null };
}

function list() {
  const lib = loadLibrary();
  let missing = 0;
  console.log('SFX types (cue type → recorded variants):');
  for (const [type, vs] of Object.entries(lib.sfx || {}).sort()) {
    const miss = vs.filter((v) => !fs.existsSync(path.join(LIB, v.file)));
    missing += miss.length;
    console.log(`  ${type.padEnd(12)} ${vs.length} variant(s)${miss.length ? `  ✖ ${miss.length} file(s) missing` : ''}`);
  }
  console.log(`  synthesized on purpose: ${[...SYNTH_OK].join(', ')}`);
  console.log('Music:');
  for (const m of lib.music || []) {
    const ok = fs.existsSync(path.join(LIB, m.file));
    if (!ok) missing++;
    console.log(`  ${ok ? ' ' : '✖'} library:${m.file} — ${m.title || ''}${m.bpm ? ` · ${m.bpm} bpm` : ''}${m.mood ? ` · ${m.mood.join(', ')}` : ''}`);
  }
  if (missing) console.log(`\n${missing} file(s) listed but not on this machine — the library media is local-only; copy it in or re-download from the listed source.`);
}

function scan() {
  const lib = loadLibrary();
  let n = 0;
  for (const vs of Object.values(lib.sfx || {})) for (const v of vs) {
    const f = path.join(LIB, v.file);
    if (!fs.existsSync(f)) continue;
    const m = measure(f);
    if (v.peak === undefined) v.peak = +(m.peak - (v.from || 0)).toFixed(3);
    v.length = m.length; v.lufs = m.lufs; n++;
  }
  for (const v of lib.music || []) {
    const f = path.join(LIB, v.file);
    if (!fs.existsSync(f)) continue;
    const m = measure(f);
    v.length = m.length; v.lufs = m.lufs; n++;
  }
  save(lib);
  console.log(`✔ measured ${n} file(s) → library/library.json`);
}

function add(file, a) {
  if (!fs.existsSync(file)) die(`no such file: ${file}`);
  const lib = loadLibrary();
  const sub = a.music ? 'music' : path.join('sfx', a.type || die('pass --type <cue type> or --music'));
  fs.mkdirSync(path.join(LIB, sub), { recursive: true });
  const rel = path.join(sub, path.basename(file)).split(path.sep).join('/');
  fs.copyFileSync(file, path.join(LIB, rel));
  const m = measure(path.join(LIB, rel));
  const meta = { source: a.source || '', license: a.license || '' };
  if (a.music) {
    lib.music = (lib.music || []).filter((x) => x.file !== rel);
    lib.music.push({ file: rel, title: a.title || path.parse(file).name, bpm: a.bpm ? +a.bpm : undefined, mood: a.mood ? String(a.mood).split(',') : undefined, length: m.length, lufs: m.lufs, ...meta });
  } else {
    const vs = (lib.sfx[a.type] ||= []).filter((x) => x.file !== rel);
    vs.push({ file: rel, gain: a.gain ? +a.gain : 0.5, peak: a.peak !== undefined ? +a.peak : m.peak, length: m.length, lufs: m.lufs, ...meta });
    lib.sfx[a.type] = vs;
  }
  save(lib);
  console.log(`✔ library:${rel} added${a.music ? ' (music)' : ` as '${a.type}' (peak ${m.peak}s)`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  const cmd = a._[0];
  if (cmd === 'list') list();
  else if (cmd === 'scan') scan();
  else if (cmd === 'add') add(a._[1] || die('usage: library add <file> --type <t> | --music'), a);
  else die('usage: node engine/library.mjs list | scan | add <file> --type <t> | --music');
}
