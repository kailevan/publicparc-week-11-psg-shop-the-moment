# Shop the Moment — Week 11 (PUBLIC parc)

*What if watching the match was interactive?*

A web prototype reimagining the 2025 UEFA Champions League final stream (PSG vs Inter Milan) as a shoppable moment.

At ~10s into Désiré Doué's goal celebration clip, a soft veil locks onto him while the rest of the frame dims. A vertical stack of three product pills (PSG home shirt, shorts, and pink Mercurial boots) slides in on the left, with a "D.DOUÉ" broadcast caption and a "BUY NOW AND SAVE 10%" button complete with a countdown timer. After 6 seconds the entire UI gracefully exits — buy button first, then the pills bottom-up — and the veil lifts.

## Stack

Plain HTML / CSS / JS. No framework, no build step.

- `index.html` — experience
- `editor.html` — keyframe editor for tracking Doué across the clip
- `js/utils.js` — `interpolateBox()` shared engine (from Week 3 Runway Tracker)
- `js/data.js` — Doué keyframes (5.184s → 17.277s, 23 frames, 1 camera-cut jump)
- `js/products.js` — the three pill items
- `js/players.js` — *(legacy, unused this week)*
- `js/experience.js` — render loop, veil, pills, caption, buy button, layout
- `js/editor.js` — keyframe editor
- `css/experience.css` — pill stack, caption, buy button, countdown bar
- `assets/video/psg_goal.mp4` — the source clip (PSG-Inter CL final, 47s)
- `assets/products/*.webp` — turntable thumbnails (animated WebP, alpha)
- `assets/products/*_360.{mov,mp4}` — source turntables (Kling 3.0)
- `assets/ui/psg-logo.png` + `buy-underline.png` — Figma-sourced assets

## Run

```
python3 -m http.server 8100
```

Then open `http://localhost:8100/index.html` (or your LAN IP for phone testing).
