#!/usr/bin/env node
/**
 * Fish Audio TTS via REST API — fallback when the Fish Audio MCP isn't connected.
 * Needs FISH_API_KEY in the environment or in .env at the repo root
 * (create one at https://fish.audio → API keys; the user enters it, never Claude).
 *
 *   node engine/audio/tts-fish.mjs projects/<name>          # reads audio/vo-script.json
 *   node engine/audio/tts-fish.mjs projects/<name> --only 03,06   # regenerate just those lines
 *   node engine/audio/tts-fish.mjs --text "Hello" --out hello.mp3 [--voice <reference_id>]
 *
 * vo-script.json:
 *   { "voice": "<reference_id or omit for default>", "model": "s2.1-pro-free", "speed": 1,
 *     "lines": [ { "id": "01", "t": 0.4, "text": "[excited] Meet the shared workspace..." } ] }
 * Writes audio/vo/<id>.mp3 and audio/vo.json (with measured durations) for mix.mjs.
 * Delivery tags in [brackets] are performed, not spoken: [excited] [whispering] [laughing] [calm].
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { args, ROOT, die, ffprobeDuration } from '../lib/common.mjs';

/** spoken phrases [[start, end], ...] (seconds within the file) — cut picture on these onsets */
export function phrases(file, dur) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-40dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf8' });
  const ev = [...(r.stderr || '').matchAll(/silence_(start|end): ([\d.]+)/g)].map((m) => [m[1], +m[2]]);
  const out = []; let s = 0;
  for (const [k, v] of ev) { if (k === 'start') { if (v - s > 0.05) out.push([+s.toFixed(3), +v.toFixed(3)]); } else s = v; }
  if (dur - s > 0.15 && (!ev.length || ev[ev.length - 1][0] === 'end')) out.push([+s.toFixed(3), +dur.toFixed(3)]);
  return out;
}

// load .env (KEY=VALUE lines) without overriding real environment variables
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const m of fs.readFileSync(envFile, 'utf8').matchAll(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?/gm)) {
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
const DEFAULT_MODEL = process.env.FISH_MODEL || 's2.1-pro-free';

function apiKey() {
  if (process.env.FISH_API_KEY) return process.env.FISH_API_KEY;
  die('FISH_API_KEY not set. Add it to .env (see .env.example) — or use the Fish Audio MCP instead.');
}

async function tts({ text, voice, model = DEFAULT_MODEL, speed = 1, out }) {
  const body = { text, format: 'mp3', mp3_bitrate: 192, sample_rate: 44100, latency: 'normal', normalize: true,
    prosody: { speed, volume: 0, normalize_loudness: true } };
  if (voice) body.reference_id = voice;
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', model },
    body: JSON.stringify(body),
  });
  if (!res.ok) die(`Fish Audio ${res.status}: ${await res.text()}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

const a = args();
if (a.text) {
  const out = path.resolve(a.out || 'vo.mp3');
  await tts({ text: a.text, voice: a.voice, model: a.model, speed: +a.speed || 1, out });
  console.log(`✔ ${out} (${ffprobeDuration(out).toFixed(2)}s)`);
} else {
  const dir = path.resolve(a._[0] || die('pass a project or --text'));
  const A = path.join(dir, 'audio');
  const scriptFile = path.join(A, 'vo-script.json');
  if (!fs.existsSync(scriptFile)) die(`missing ${scriptFile}`);
  const S = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
  const vo = [];
  // --only 03,06 → regenerate just those lines; keep the others' audio + measurements from vo.json
  const only = a.only ? String(a.only).split(',') : null;
  const prev = only && fs.existsSync(path.join(A, 'vo.json')) ? JSON.parse(fs.readFileSync(path.join(A, 'vo.json'), 'utf8')) : [];
  for (const [k, line] of S.lines.entries()) {
    const id = line.id || String(k + 1).padStart(2, '0');
    const file = `vo/${id}.mp3`;
    const old = prev.find((l) => l.id === id);
    if (only && !only.includes(id) && old) { vo.push({ ...old, t: line.t ?? 0, text: line.text }); continue; }
    await tts({ text: line.text, voice: line.voice || S.voice, model: S.model, speed: line.speed || S.speed || 1, out: path.join(A, file) });
    const dur = ffprobeDuration(path.join(A, file));
    const ph = phrases(path.join(A, file), dur);
    vo.push({ id, file, t: line.t ?? 0, dur: +dur.toFixed(3), text: line.text, phrases: ph });
    console.log(`✔ ${file}  t=${line.t ?? 0}s  ${dur.toFixed(2)}s  phrases@ ${ph.map((p) => p[0]).join(', ')}  “${line.text.slice(0, 60)}”`);
  }
  vo.forEach((l, i) => {
    const next = vo[i + 1];
    if (next && l.t + l.dur > next.t) console.warn(`  ⚠ line ${l.id} ends at ${(l.t + l.dur).toFixed(2)}s, overlapping ${next.id} at ${next.t}s — retime picture/lines`);
  });
  fs.writeFileSync(path.join(A, 'vo.json'), JSON.stringify(vo, null, 2));
  console.log('✔ audio/vo.json — run `npm run mix -- <project>` (or `npm run score`) to rebuild mix.wav');
}
