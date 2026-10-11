# Brand kit — Arena by CubeNation

> Source: https://arena.cubenationshop.com (landing captured 2026-10-11) + repo `C:\Code\CubeNation Workspace\cubenation-arena`
> (PRODUCT.md, README.md, tailwind.config.js, client/src/index.css, components). Room/timer/desk/stream UIs are login-free
> but not public pages — rebuild them from the React source rather than capturing production rooms.

## Product in one breath
- What it is: realtime speedcubing battle rooms — "Google Meet for cube battles". A serious csTimer-style timer with video, live solve state, chat and server-scored head-to-head matches in one room.
- Who it's for: competition hosts running streamed 1v1s (host officiates, two cubers battle, a streamer broadcasts with OBS); also casual practice with friends. Most users on mobile networks in Bangladesh.
- The one thing: video built into the timer and the battle state — not a call beside a separate timer.
- Proof points (verbatim/README): host desk with invite links per seat; same scramble per game (WCA-quality, server-dealt); first to N games takes a set, first to N sets takes the match; 15s inspection (+2 after 15s · DNF after 17s); scramble check before each game; stream kit — every broadcast piece is its own transparent OBS browser source (camera, timer, name, score, stats, scramble, status, games, bar, full); export results (CSV, copy as table/text, JSON); no account needed (guest-first, claim later); "a network problem never decides a match: the host does"; HD 720p or data saver 320p cameras.

## Logo
- No logo file: the mark is typographic — **ARENA** (bold, `tracking-wide`) + " by CubeNation" (regular, slate-400). Page title: "Arena by CubeNation".
- Eyebrow lockup on landing: "ARENA BY CUBENATION · BETA" in cyan, uppercase, wide tracking (~.3em).
- Motion films may pair the wordmark with a 3x3 sticker grid in brand colors (used in arena-showreel) — a film device, not an official logo.

## Palette (tailwind.config.js)
| Token | Hex | Role |
|---|---|---|
| ink | #0e1116 | app background (body #0e1417) |
| panel | #171c24 | cards, panels |
| line | #262e3a | borders, dividers |
| cube | #00d1ff | primary: buttons, focus, running timer, links |
| ready | #4edea3 | ready-to-start (hold complete), wins ("arena-win" glow) |
| inspect | #ffb044 | inspection countdown, set/game eyebrow labels |
| accent | #ff6b6b | +2 / danger end of inspection |
| input bg | #090f12 | inputs |
| btn bg | #1a2123 | secondary buttons (hover #242b2e) |
| primary text on cyan | #001f28 | |
| text | slate-100 #f1f5f9 · slate-300 #cbd5e1 · slate-400 #94a3b8 | |

## Typography
- UI: `ui-sans-serif` system stack (renders as Segoe UI on Windows). Overlay "sans" option uses **Inter** — use Inter for rebuilds.
- Mono / times: **JetBrains Mono**, tabular-nums.
- Display in films: Inter Tight 700–800, tight tracking (not in the product; fits it).

## UI kit (from components)
- Radii: buttons `rounded` (4px), cards `rounded-lg`/`rounded-2xl` (8–16px), toggle pill.
- Buttons: `.btn` border line, bg #1a2123, text-sm; `.btn-primary` cyan bg, #001f28 semibold text.
- Badges: border line, text-xs slate-400, px-2.
- Header: h-12, border-b line, "ARENA by CubeNation" left; in a room: room name, code badge (mono), Share, Stream, viewers (eye + count), center amber "Set 1 · Game 1 (First to N sets)" uppercase tracking .18em 9px.
- Timer pad states (TimerWidget.jsx): idle slate-100 "Hold until green, release to start" · holding slate-400 "keep holding…" · ready text-ready "0.00" "release to start" · running text-cube "press to stop" · inspecting amber countdown "Inspecting — +2 after 15s · DNF after 17s" (amber-300 ≤7, accent ≤2 / +2) · reported: won text-cube, lost slate-400, "<name> won game N".
- Live states in tiles: "solving…", "Inspection".
- Win glow: green text-shadow / inset 3px green box pulse (0.9s ×5).

## Voice & tone
- Direct, familiar to cubers, no implementation jargon. Competitive but friendly.
- Taglines (verbatim): "Race friends face-to-face." · "Practice together. Battle live." · "Practice together or run a friendly 1v1 battle on the same 3×3 scramble—with video, live timer states, and a saved match record."
- Words: room, seat, host, streamer, scramble, inspection, set, game, match, solve. Never: "users", "sessions", "WebRTC".

## Do / Don't
- Do: show the timer state colors, the host desk and the stream kit — they're the differentiators. Keep it legible for small Android screens in social cuts.
- Don't: invent rankings/leaderboards/team battles (not shipped — "Team battles and ranked play come after the core match loop is proven"), invent user counts, or show real users' names.

## VO
- Fish Audio voice used: "Energetic Male" `802e3bc2b27e49c2995d23ef70e6ac89` (young, crisp announcer) — model s2.1-pro-free. Worked well for hype walkthroughs.
