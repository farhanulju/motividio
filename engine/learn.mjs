#!/usr/bin/env node
/**
 * The studio's learning loop. Every finished film is an episode with a reward; the studio's policy
 * (studio/policy.md) is re-derived from all episodes after each one.
 *
 *   node engine/learn.mjs record projects/<slug>   # learn.json + critique-*.md → studio/ledger.jsonl,
 *                                                   # a studio/learnings.md log line, then distill
 *   node engine/learn.mjs distill                   # rebuild studio/policy.md from the ledger
 *   node engine/learn.mjs stats                     # print the summary without writing anything
 *
 * Reward (0–10) = 0.4 · final critique mean + 0.4 · user verdict + 0.2 · efficiency
 * (missing user verdict → critique 0.7 / efficiency 0.3). The self-score is biased, so the user's verdict
 * carries as much weight as all nine axes together.
 *
 * Below ACTIVATE_AT episodes the policy is "observing": it reports stats and turns recurring mistakes into
 * a preflight checklist. From ACTIVATE_AT on it is "active": technique advantages (reward with the technique
 * vs the baseline, shrunk toward 0 for small samples) become prefer/avoid lists that make-video follows,
 * one under-tested technique per film is explored, and strong signals are proposed as rule promotions.
 * This is a contextual bandit over the studio's own rules and choices — the model's weights don't change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, ROOT, die, projectDir } from './lib/common.mjs';

export const ACTIVATE_AT = 100;
const LEDGER = path.join(ROOT, 'studio', 'ledger.jsonl');
const POLICY = path.join(ROOT, 'studio', 'policy.md');
const LEARNINGS = path.join(ROOT, 'studio', 'learnings.md');
const AXES = ['hook', 'art', 'brand', 'motion', 'rhythm', 'depth', 'clarity', 'sound', 'ending'];
const VERDICT = { accepted: 10, 'accepted-with-changes': 7, revised: 4, rejected: 0 };
const SHRINK = 5;        // pseudo-episodes at the baseline: a technique needs evidence to move
const MIN_N = 5;         // episodes before a technique can be preferred/avoided
const EDGE = 0.5;        // advantage (reward points) that counts as a real signal
const RECUR = 3;         // mistake tag seen this often → preflight checklist

const r1 = (x) => Math.round(x * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const slugTag = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Pull axis scores out of every critique-<n>.md: first number seen per axis = first round, last = final. */
export function critiqueScores(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^critique-\d+\.md$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const first = {}, final = {};
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const axis = AXES.find((k) => cells[0]?.toLowerCase().replace(/\*/g, '').startsWith(k));
      if (!axis) continue;
      const nums = cells.slice(1).filter((c) => /^[\d.\s→>\-/]+$/.test(c) && /\d/.test(c))
        .flatMap((c) => c.replace(/\/\s*10/g, '').match(/\d+(\.\d+)?/g).map(Number)).filter((n) => n <= 10);
      if (!nums.length) continue;
      if (first[axis] === undefined) first[axis] = nums[0];
      final[axis] = nums[nums.length - 1];
    }
  }
  return { first, final, rounds: files.length };
}

export function reward(ep) {
  const critique = mean(Object.values(ep.scores?.final || {}));
  const v = VERDICT[ep.user?.verdict];
  const userCaught = (ep.mistakes || []).filter((m) => m.caught === 'user').length;
  const efficiency = clamp(10 - 2 * (ep.user?.revisions || 0) - Math.max(0, (ep.rounds || 0) - 2) - userCaught, 0, 10);
  // no critique and no verdict = no quality signal: efficiency alone would score an unknown film 10/10
  if (Number.isNaN(critique) && v === undefined) return null;
  const parts = [];
  if (!Number.isNaN(critique)) parts.push([critique, v === undefined ? 0.7 : 0.4]);
  if (v !== undefined) parts.push([v, Number.isNaN(critique) ? 0.7 : 0.4]);
  parts.push([efficiency, 0.2 + (parts.length === 1 ? 0.1 : 0)]);
  const w = parts.reduce((s, [, k]) => s + k, 0);
  return r1(parts.reduce((s, [x, k]) => s + x * k, 0) / w);
}

function readLedger() {
  if (!fs.existsSync(LEDGER)) return [];
  return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** record projects/<slug> (reads its learn.json), or record path/to/learn.json (a version, or a film made outside the repo; "dir" points at its project for critiques) */
function record(arg) {
  let lf, dir;
  if (/\.json$/i.test(arg)) { lf = path.resolve(arg); }
  else { dir = projectDir(arg); lf = path.join(dir, 'learn.json'); }
  if (!fs.existsSync(lf)) die(`missing ${path.relative(ROOT, lf)} — copy templates/project/learn.json and fill it in`);
  const L = JSON.parse(fs.readFileSync(lf, 'utf8'));
  if (!dir && L.dir) dir = projectDir(L.dir);
  const parsed = dir ? critiqueScores(dir) : { first: {}, final: {}, rounds: 0 };
  const scores = L.scores || { first: parsed.first, final: parsed.final };
  if (!L.learning?.trim()) die('learn.json → "learning" is empty: write the one-line lesson before recording');
  if (!L.user?.verdict) console.warn('⚠ learn.json → user.verdict is empty; reward uses the self-critique only');
  if (!Object.keys(scores.final || {}).length) console.warn('⚠ no critique scores found (critique-<n>.md or learn.json → scores)');

  const ep = {
    project: L.project || path.basename(dir || path.dirname(lf)), version: L.version || 'v1',
    date: L.date || new Date().toISOString().slice(0, 10),
    genre: slugTag(L.genre || 'unknown'), route: slugTag(L.route || 'html'),
    duration: L.duration, formats: L.formats,
    techniques: [...new Set((L.techniques || []).map(slugTag).filter(Boolean))],
    rounds: L.rounds || parsed.rounds, scores,
    user: { verdict: L.user?.verdict || '', revisions: L.user?.revisions || 0, feedback: L.user?.feedback || [] },
    mistakes: (L.mistakes || []).map((m) => ({ ...m, tag: slugTag(m.tag || 'other') })),
    repoChanges: L.repoChanges || [], learning: L.learning.trim(),
    ...(L.backfilled ? { backfilled: true } : {}),
  };
  ep.reward = reward(ep);

  const eps = readLedger().filter((e) => !(e.project === ep.project && e.version === ep.version));
  eps.push(ep);
  eps.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(LEDGER, eps.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`✔ episode ${eps.length}: ${ep.project} ${ep.version} · reward ${ep.reward ?? '— (no critique or verdict)'}${ep.reward != null ? '/10' : ''} → studio/ledger.jsonl`);

  // the human-readable log line in learnings.md (newest first, once per project version)
  const md = fs.readFileSync(LEARNINGS, 'utf8');
  const tag = `${ep.date} · ${ep.project}${ep.version !== 'v1' ? ' ' + ep.version : ''} ·`;
  if (!ep.backfilled && !md.includes(`- ${tag}`)) { // backfilled episodes are already in the log
    fs.writeFileSync(LEARNINGS, md.replace(/^## Log\s*\n/m, (h) => `${h}- ${tag} ${ep.learning}\n`));
    console.log('✔ log line added to studio/learnings.md');
  }
  distill(eps);
}

export function analyse(eps) {
  const n = eps.length;
  const all = eps;
  eps = eps.filter((e) => e.reward != null); // unscored episodes still count for mistakes, not for rewards
  const baseline = mean(eps.map((e) => e.reward));
  const techs = {};
  for (const e of eps) for (const t of e.techniques) (techs[t] ||= []).push(e.reward);
  const tech = Object.entries(techs).map(([t, rs]) => ({
    t, n: rs.length, mean: r1(mean(rs)),
    adv: r1((rs.reduce((s, x) => s + x, 0) + SHRINK * baseline) / (rs.length + SHRINK) - baseline),
  })).sort((a, b) => b.adv - a.adv);

  const mist = {};
  for (const e of all) for (const m of e.mistakes) {
    const k = (mist[m.tag] ||= { tag: m.tag, count: 0, user: 0, last: null, fix: '' });
    k.count++; if (m.caught === 'user') k.user++;
    if (!k.last || e.date >= k.last) { k.last = e.date; k.fix = m.fix || k.fix; k.what = m.what; }
  }
  const mistakes = Object.values(mist).sort((a, b) => b.count + b.user - (a.count + a.user));

  const axis = AXES.map((a) => ({
    a, first: r1(mean(all.map((e) => e.scores?.first?.[a]).filter((x) => x !== undefined))),
    final: r1(mean(all.map((e) => e.scores?.final?.[a]).filter((x) => x !== undefined))),
  })).filter((x) => !Number.isNaN(x.first)).sort((x, y) => x.first - y.first);

  const genres = {};
  for (const e of eps) if (!genres[e.genre] || e.reward > genres[e.genre].reward) genres[e.genre] = e;
  const last = eps.slice(-10), prev = eps.slice(-20, -10);
  return {
    n, active: n >= ACTIVATE_AT, baseline: r1(baseline), tech, mistakes, axis, genres,
    trend: { last: r1(mean(last.map((e) => e.reward))), prev: r1(mean(prev.map((e) => e.reward))) },
  };
}

function distill(eps = readLedger()) {
  const A = analyse(eps);
  const prefer = A.tech.filter((x) => x.n >= MIN_N && x.adv >= EDGE);
  const avoid = A.tech.filter((x) => x.n >= MIN_N && x.adv <= -EDGE).reverse();
  const explore = A.tech.filter((x) => x.n < MIN_N).sort((a, b) => a.n - b.n || b.adv - a.adv);
  const pick = explore.length ? explore[A.n % explore.length] : null;
  const checklist = A.mistakes.filter((m) => m.count >= RECUR || m.user >= 2);
  const promote = [
    ...A.tech.filter((x) => x.n >= 2 * MIN_N && x.adv >= 2 * EDGE).map((x) => `technique \`${x.t}\` (+${x.adv} over ${x.n} films) → a "Do instead" line in studio/motion-rules.md`),
    ...A.mistakes.filter((m) => m.count >= 5).map((m) => `mistake \`${m.tag}\` (${m.count}×) → an automated check in the engine (stills/render/score), not just a rule`),
  ];
  const nan = (x) => (Number.isNaN(x) ? '–' : x);
  const L = [];
  L.push('# Studio policy — derived from studio/ledger.jsonl', '');
  L.push('> Generated by `npm run learn -- distill` (runs after every `learn record`). Do not hand-edit; change the ledger or the code.', '');
  L.push(`**Mode: ${A.active ? 'ACTIVE' : 'OBSERVING'}** — ${A.n} episode${A.n === 1 ? '' : 's'} recorded${A.active ? '' : `, self-tuning activates at ${ACTIVATE_AT} (${ACTIVATE_AT - A.n} to go)`}.`);
  L.push(`Baseline reward ${nan(A.baseline)}/10 · last 10 films ${nan(A.trend.last)} vs previous 10 ${nan(A.trend.prev)}.`, '');
  L.push('## Preflight checklist (always applies)', '');
  L.push('Recurring mistakes. Check each one before the first full render.', '');
  if (checklist.length) for (const m of checklist) L.push(`- [ ] **${m.tag}** — ${m.count}× (${m.user} caught by the user), last ${m.last}: ${m.what || ''} → ${m.fix || 'no fix recorded'}`);
  else L.push(`- (none yet: a mistake tag joins this list after ${RECUR} occurrences, or 2 caught by the user)`);
  L.push('', '## Weakest axes at round 1 → design for these from the start', '');
  if (A.axis.length) for (const x of A.axis.slice(0, 3)) L.push(`- ${x.a}: ${x.first} at round 1 → ${x.final} final`);
  else L.push('- (no critique scores yet)');
  L.push('', `## Technique policy ${A.active ? '(in force)' : '(not in force until active — shown for information)'}`, '');
  L.push(`Advantage = reward with the technique minus the baseline, shrunk toward 0 by ${SHRINK} pseudo-episodes. Prefer/avoid needs n ≥ ${MIN_N} and |advantage| ≥ ${EDGE}.`, '');
  L.push('**Prefer:** ' + (prefer.length ? prefer.map((x) => `\`${x.t}\` +${x.adv} (n ${x.n})`).join(' · ') : '–'));
  L.push('', '**Avoid:** ' + (avoid.length ? avoid.map((x) => `\`${x.t}\` ${x.adv} (n ${x.n})`).join(' · ') : '–'));
  L.push('', `**Explore next film:** ${pick ? `\`${pick.t}\` (tried ${pick.n}×) — use it once where it fits the brief, so the policy keeps learning` : '–'}`);
  if (explore.length > 1) L.push('', `Under-tested: ${explore.slice(0, 12).map((x) => `\`${x.t}\` (${x.n})`).join(' · ')}`);
  L.push('', '## Best episode per genre (open these projects as a starting point)', '');
  const g = Object.values(A.genres);
  if (g.length) for (const e of g) L.push(`- ${e.genre}: ${e.project} ${e.version} — reward ${e.reward}`);
  else L.push('- –');
  L.push('', `## Promotion candidates ${A.active ? '(apply in the Learn step, then record them under repoChanges)' : '(review only)'}`, '');
  L.push(...(promote.length ? promote.map((p) => `- ${p}`) : ['- –']));
  fs.writeFileSync(POLICY, L.join('\n') + '\n');
  console.log(`✔ studio/policy.md — ${A.active ? 'ACTIVE' : 'observing'}, ${A.n}/${ACTIVATE_AT} episodes, ${checklist.length} checklist item(s)`);
}

function stats() {
  const eps = readLedger();
  if (!eps.length) return console.log('ledger is empty — finish a film and run `npm run learn -- record projects/<slug>`');
  const A = analyse(eps);
  console.log(`${A.n}/${ACTIVATE_AT} episodes · ${A.active ? 'ACTIVE' : 'observing'} · baseline ${A.baseline} · trend ${A.trend.prev} → ${A.trend.last}`);
  console.log('top techniques:', A.tech.slice(0, 5).map((x) => `${x.t} ${x.adv >= 0 ? '+' : ''}${x.adv} (n${x.n})`).join(', ') || '–');
  console.log('top mistakes:  ', A.mistakes.slice(0, 5).map((m) => `${m.tag} ×${m.count}`).join(', ') || '–');
  console.log('weakest axes:  ', A.axis.slice(0, 3).map((x) => `${x.a} ${x.first}→${x.final}`).join(', ') || '–');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  const cmd = a._[0];
  if (cmd === 'record') record(a._[1] || die('usage: learn record projects/<slug> | path/to/learn.json'));
  else if (cmd === 'distill') distill();
  else if (cmd === 'stats') stats();
  else die('usage: node engine/learn.mjs record projects/<slug> | path/to/learn.json | distill | stats');
}
