---
name: reference-style
description: Extract the visual grammar (palette, type, shot lengths, transitions, camera, texture, text entrances/exits, sound) of a reference video into a reusable style guide, without copying its content. Use when the user shares a reference video/post (X, YouTube, whatships.com, a local file) or says "in the style of".
---

# reference-style — take the grammar, never the content

1. `npm run ref -- <url-or-file> --name <slug> --every 0.5`
   (yt-dlp handles x.com, youtube, vimeo. If a download fails, ask the user to save the file and pass the path.)
2. Read `references/<slug>/meta.json` and `cuts.json` (shot count, mean shot length, rhythm).
3. Read **every** `sheet-*.jpg` (16 frames each, 0.5s apart, left→right, top→bottom). For fast moments, Read individual `frames/f####.jpg`.
4. If audio exists: `ffmpeg -i references/<slug>/source.mp4 -vn -ac 1 -ar 22050 references/<slug>/audio.wav`; estimate tempo from cut spacing and note the SFX vocabulary.
5. Write `references/<slug>/style-guide.md` from `templates/style-guide.md`. Be measurable: hex values, % of frame height for type, seconds for shots, ease names, stagger ms.
6. End with **Do / Don't for our version** — what we take (grammar) and what we must not (their logos, characters, copy, exact layouts).
7. In the project's brief §3 and §6, cite the style guide and override only what the brand demands (brand colors beat reference colors; keep the reference's rhythm and transitions).

Reference videos found on whatships.com, X, Dribbble and Behance are inspiration only — downloaded files stay in `references/` and are never published.
