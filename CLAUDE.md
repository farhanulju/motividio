# Motividio — a motion studio made in code

This repo turns a prompt into a finished video: launch films, ads, product walkthroughs, showreels,
explainers. Claude is the **director, animator, sound designer and render engineer**. Opus writes
code; the engine turns code into frames, frames into MP4.

**Route (default):** zero-dependency HTML composition → deterministic `__seek(t)` → headless Chromium
screenshots each frame → ffmpeg → MP4 with a code-synthesized score + Fish Audio voice. Other routes
(HyperFrames / Remotion, generated plates + code composite, cutting supplied footage) only when the brief says so.

## When the user asks for a video
Use the **`make-video`** skill (`.claude/skills/make-video/SKILL.md`). It runs the full pipeline:
intake → brand kit → reference grammar → director's brief → beat grid gate → build → stills →
score → critique loop → render → deliver → learn. Sub-skills: `brand-kit`, `reference-style`,
`voiceover`, `score-to-beat`, `critique-loop`.

Before starting any film, read: `studio/learnings.md` (taste memory) and, if a brand is named,
`brands/<slug>/brand.md` (brand memory). If that brand file exists, reuse it — don't re-research.

## The rules (always in force)
@studio/motion-rules.md

## Where things live
| Path | What |
|---|---|
| `engine/runtime.js` | in-page timeline: `M.comp/scene/on/tw/keys/stagger/ease/split/set/cue/beat/video/rand` |
| `engine/kit.js` | motion primitives: `K.cursor/type/count/draw/check/morph/swap/camera/textIn/textOut/grain/progress/bars` |
| `engine/*.mjs` | CLI tools (below) |
| `engine/audio/` | `score.mjs` (music+SFX+beats), `sfx.mjs` (SFX library), `mix.mjs` (ducking + −14 LUFS), `tts-fish.mjs` (Fish Audio REST, s2.1-pro-free) |
| `studio/` | motion-rules, playbooks (genres), spec-list (component timings), prompt-library, learnings |
| `templates/` | director-brief, shotlist (beat grid), style-guide, brand, critique, project starter |
| `brands/<slug>/` | brand memory: brand.md, screens/, logos/, extracted.json, characters/ |
| `references/<slug>/` | reference videos: source.mp4, frames/, sheet-*.jpg, cuts.json, style-guide.md |
| `projects/<slug>/` | one film: brief.md, shotlist.md, index.html, assets/, audio/, critique-n.md, out/ |

## Commands (`npm run <x> -- <args>`)
| Command | Does |
|---|---|
| `new <slug> [--brand b --duration 15 --formats 16x9,9x16]` | scaffold a project |
| `preview [projects/<slug>]` | live player at http://127.0.0.1:4321/projects/<slug>/ (space, ←/→, scrub, `?format=9x16`) — for the user's own browser |
| `stills projects/<slug> [--every 0.5 \| --at 1,2.5 \| --scenes] [--format 9x16]` | PNG stills + `contact.png`; also refreshes `audio/cues.json`. **Read these images to review.** |
| `render projects/<slug> [--format all] [--fast] [--from a --to b] [--workers 4]` | final MP4(s) in `out/` (muxes `audio/mix.wav` if present) |
| `score projects/<slug> [--beats-only]` | `beats.json`, `music.wav`, `sfx.wav`, `mix.wav` |
| `mix projects/<slug>` | re-mix after VO changes |
| `tts projects/<slug>` | Fish Audio REST from `audio/vo-script.json` (needs `FISH_API_KEY` in .env) |
| `ref <url\|file> --name <slug>` | download + frames + contact sheets + cut detection for a reference |
| `capture <url> --brand <slug> [--pages /,/pricing] [--mobile]` | brand screenshots, logos, colors, fonts |
| `doctor` | toolchain check |

## Voice — Fish Audio
- Alternative: the **Fish Audio MCP** (`fish-audio`, registered in `.mcp.json`, OAuth). Tools search voices, generate speech, clone voices, transcribe. It returns audio URLs — download them with `curl -L -o projects/<p>/audio/vo/<id>.mp3 <url>` and write `audio/vo.json`.
- **REST route is configured and verified**: `npm run tts -- projects/<p>` reads `FISH_API_KEY` + `FISH_MODEL` from `.env`. Always use model **`s2.1-pro-free`** (free dev tier — the user's choice). Use this whenever the MCP tools aren't live.
- Delivery tags in brackets are performed, not spoken: `[excited] [calm] [whispering] [laughing]`.
- Image/video generation via Fish MCP costs credits: always show the user the quote and get a yes first.
- Never type API keys or passwords anywhere; the user puts keys in `.env` themselves.

## Working agreements
- Show the user the brief summary and the beat grid before animation code, unless they say "just go" / "one shot it".
- Always review with your own eyes (Read the contact sheet PNGs) before claiming a render is good.
- Long jobs: render with `--fast` while iterating; final render without it.
- After every delivered film, append to `studio/learnings.md`; update `brands/<slug>/brand.md` with anything learned about the brand.
- Report honestly: final scores, known weak spots, and file paths of every deliverable.
