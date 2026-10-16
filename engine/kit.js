/*
 * Motividio kit — deterministic motion primitives built on runtime.js (load after it).
 * Every function is a pure function of t; call them from M.on / M.scene callbacks.
 * Components that make sound register M.cue()s, so the score lines up automatically.
 */
(function () {
  'use strict';
  const M = window.M;
  const K = {};

  /**
   * Cursor that travels a path and clicks.
   *   const cur = K.cursor({ size: 34 });
   *   M.on(t => cur.at(t, [[0.5, 300, 400], [1.2, 900, 520, { click: true }], ...]));
   * Each waypoint: [arriveTime, x, y, { click, hold }]. Clicks cue a 'click' SFX.
   */
  K.cursor = ({ parent, size = 32, color = '#111', stroke = '#fff', travel = 0.55, ease = 'glide' } = {}) => {
    const root = document.createElement('div');
    root.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;z-index:50;pointer-events:none;`;
    root.innerHTML =
      `<div class="ripple" style="position:absolute;left:-${size}px;top:-${size}px;width:${size * 2}px;height:${size * 2}px;border-radius:50%;border:2px solid ${color};opacity:0"></div>` +
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="position:absolute;left:-${size * 0.18}px;top:-${size * 0.08}px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.25))">` +
      `<path d="M4 2.5 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.7 L11.7 14.2 L18 14.2 Z" fill="${color}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    (parent ? M.$(parent) : M.stage()).appendChild(root);
    const ripple = root.firstChild, arrow = root.lastChild;
    let cued = false;
    return {
      el: root,
      at(t, pts) {
        if (!cued) { pts.forEach((p) => p[3] && p[3].click && M.cue(p[0] + 0.02, 'click')); cued = true; }
        // build keyframes: hold at each point, travel `travel`s before arrival
        const kx = [], ky = [];
        pts.forEach(([ta, x, y], i) => {
          if (i > 0) { kx.push([Math.max(ta - travel, pts[i - 1][0] + 0.01), pts[i - 1][1]]); ky.push([Math.max(ta - travel, pts[i - 1][0] + 0.01), pts[i - 1][2]]); }
          kx.push([ta, x, ease]); ky.push([ta, y, ease]);
        });
        const x = M.keys(t, kx), y = M.keys(t, ky);
        let press = 1, rip = 0, ro = 0;
        for (const [ta, , , o] of pts) {
          if (!o || !o.click) continue;
          const d = t - ta;
          if (d > -0.08 && d < 0.18) press = Math.min(press, 1 - 0.18 * Math.sin(M.clamp((d + 0.08) / 0.26) * Math.PI));
          if (d >= 0 && d < 0.5) { rip = M.ease.outCubic(d / 0.5); ro = 1 - rip; }
        }
        root.style.transform = `translate(${x}px,${y}px)`;
        arrow.style.transform = `scale(${press})`;
        ripple.style.opacity = ro * 0.6;
        ripple.style.transform = `scale(${0.3 + rip * 0.9})`;
        root.style.opacity = M.tw(t, pts[0][0] - 0.4, pts[0][0] - 0.1);
      },
    };
  };

  /** typewriter: reveals text at cps chars/sec from t0 with a blinking caret; cues 'key' sounds */
  K.type = (el, t, t0, text, { cps = 22, caret = true, sound = true, every = 2 } = {}) => {
    el = M.$(el);
    if (sound && !el.__cued) {
      for (let i = 0; i < text.length; i += every) if (text[i] !== ' ') M.cue(t0 + i / cps, 'key', { gain: 0.25 });
      el.__cued = true;
    }
    const n = M.clamp(Math.floor((t - t0) * cps), 0, text.length);
    const done = n >= text.length;
    const blink = done ? Math.floor((t - t0 - text.length / cps) * 2.2) % 2 === 0 : true;
    el.textContent = text.slice(0, n);
    if (caret && t >= t0 - 0.3) {
      const c = document.createElement('span');
      c.textContent = '▍';
      c.style.cssText = `opacity:${blink ? 1 : 0};margin-left:1px;font-weight:300`;
      el.appendChild(c);
    }
    return n;
  };

  /** number ticker */
  K.count = (el, t, t0, t1, from, to, { decimals = 0, prefix = '', suffix = '', ease = 'outExpo', sep = ',', ticks = 0, cue = null } = {}) => {
    const v = M.lerp(from, to, M.tw(t, t0, t1, ease));
    let s = v.toFixed(decimals);
    if (sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    M.$(el).textContent = prefix + s + suffix;
    // sound: `ticks` 'tick' cues while it runs (bunched early, like the number), `cue` when it settles
    // (e.g. cue: 'chaching' for a money reveal — map it to a recording in the library or score.json → sounds)
    for (let i = 0; i < ticks; i++) M.cue(t0 + (t1 - t0) * (1 - Math.pow(1 - i / ticks, 0.5)) * 0.85, 'tick', { gain: 0.5 });
    if (cue) M.cue(t1 - 0.05, cue);
    return v;
  };

  /**
   * Caption: one or more lines that come in and leave on their own clocks. Stateless by construction —
   * each line is on textIn until its out-time, then on textOut.
   *   M.on(t => K.caption(['#cap1', '#cap2'], t, 3.2, 6.0));
   */
  K.caption = (lines, t, tIn, tOut, { gap = 0.16, outGap = 0.05, style = 'rise', each = 0.022, dur = 0.5, dist = 50 } = {}) => {
    (Array.isArray(lines) ? lines : [lines]).forEach((sel, k) => {
      const el = M.$(sel);
      const ch = el._kChars || (el._kChars = M.split(el));
      const t1 = tOut + k * outGap;
      if (t < t1) K.textIn(ch, t, tIn + k * gap, { each, dur, style, dist });
      else K.textOut(ch, t, t1, { each: 0.008, dur: 0.24, dist: -dist * 0.7 });
    });
  };

  /**
   * End card: the real logo mark + product name on ONE line at cap height, then a tagline, CTA and store
   * badge. Pass real asset URLs — never a typed stand-in for a logo. Lands with a 'thump'.
   *   const end = K.endCard({ icon: 'assets/icon.svg', name: 'OrderPilot', tagline: 'POs on autopilot',
   *                           badge: 'assets/shopify-app-store-badge.svg', url: 'apps.shopify.com/orderpilot' });
   *   M.on(t => end.at(t, 27.0));
   */
  K.endCard = ({ parent, icon, name, tagline = '', badge = null, url = '', size = 120, color = 'currentColor', font = 'inherit' } = {}) => {
    const u = (M.portrait ? M.W : M.H) / 1080;
    const root = document.createElement('div');
    root.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${36 * u}px;color:${color};font-family:${font};pointer-events:none`;
    root.innerHTML =
      `<div class="k-row" style="display:flex;align-items:center;gap:${size * 0.28 * u}px;line-height:1">` +
        (icon ? `<img class="k-icon" src="${icon}" style="height:${size * u}px;width:auto;display:block">` : '') +
        `<div class="k-name" style="font-size:${size * 0.92 * u}px;font-weight:700;letter-spacing:-0.035em;white-space:nowrap">${name}</div>` +
      `</div>` +
      (tagline ? `<div class="k-tag" style="font-size:${size * 0.34 * u}px;opacity:.8;letter-spacing:-0.01em">${tagline}</div>` : '') +
      `<div class="k-cta" style="display:flex;align-items:center;gap:${28 * u}px">` +
        (badge ? `<img class="k-badge" src="${badge}" style="height:${size * 0.62 * u}px;width:auto;display:block">` : '') +
        (url ? `<div class="k-url" style="font-size:${size * 0.26 * u}px;opacity:.7">${url}</div>` : '') +
      `</div>`;
    M.$(parent || M.stage()).appendChild(root);
    const q = (s) => root.querySelector(s);
    const nameChars = M.split(q('.k-name'));
    const tagChars = tagline ? M.split(q('.k-tag')) : [];
    return {
      el: root,
      at(t, t0) {
        M.cue(t0 + 0.12, 'thump');
        root.style.visibility = t >= t0 ? 'visible' : 'hidden';
        if (icon) {
          const p = M.clamp((t - t0) / 0.6);
          M.set(q('.k-icon'), { o: M.clamp(p * 4), s: 0.6 + 0.4 * M.ease.spring(0.4)(p), r: (1 - M.ease.snap(p)) * -12 });
        }
        K.textIn(nameChars, t, t0 + 0.12, { each: 0.03, dur: 0.5, dist: 40 * u });
        if (tagChars.length) K.textIn(tagChars, t, t0 + 0.55, { each: 0.012, dur: 0.45, style: 'blur' });
        const pc = M.tw(t, t0 + 0.8, t0 + 1.3, 'snap');
        M.set(q('.k-cta'), { o: pc, y: (1 - pc) * 24 * u });
      },
    };
  };

  /** stroke-draw an SVG path/line/circle: p 0..1 */
  K.draw = (el, p) => {
    el = M.$(el);
    const L = el.__len || (el.__len = el.getTotalLength ? el.getTotalLength() : 1000);
    el.style.strokeDasharray = L;
    el.style.strokeDashoffset = L * (1 - p);
  };

  /** animated check mark (svg circle + tick). Returns element; call .at(t, t0). Cues 'chime'. */
  K.check = ({ parent, size = 64, color = '#16a34a', bg = 'transparent' } = {}) => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;width:${size}px;height:${size}px`;
    el.innerHTML = `<svg viewBox="0 0 52 52" width="${size}" height="${size}"><circle cx="26" cy="26" r="23" fill="${bg}" stroke="${color}" stroke-width="3"/>` +
      `<path d="M15 27 l7 7 l15 -16" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (parent) M.$(parent).appendChild(el);
    const [c, tick] = el.querySelectorAll('circle,path');
    let cued = false;
    el.at = (t, t0) => {
      if (!cued) { M.cue(t0 + 0.32, 'chime', { gain: 0.16 }); cued = true; }
      K.draw(c, M.tw(t, t0, t0 + 0.35, 'snap'));
      K.draw(tick, M.tw(t, t0 + 0.22, t0 + 0.5, 'snap'));
      const s = 0.6 + 0.4 * M.ease.spring(0.45)(M.clamp((t - t0) / 0.6));
      M.set(el, { s, o: M.tw(t, t0, t0 + 0.12) });
    };
    return el;
  };

  /**
   * The never-cut container: one element that morphs between UI states.
   *   K.morph(el, t, [[0, {x,y,w,h,radius,bg}], [1.2, {...}, 'glide'], ...])
   * x/y are the element's top-left in stage px. Cues a 'whoosh' at the middle of big moves.
   */
  K.morph = (el, t, keys, { whoosh = true } = {}) => {
    el = M.$(el);
    if (whoosh && !el.__cued) {
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1][1], b = keys[i][1];
        const big = Math.abs((b.w || 0) - (a.w || 0)) + Math.abs((b.h || 0) - (a.h || 0)) + Math.abs((b.x || 0) - (a.x || 0)) + Math.abs((b.y || 0) - (a.y || 0));
        if (big > 200) M.cue((keys[i - 1][0] + keys[i][0]) / 2, 'whoosh', { gain: 0.35 });
      }
      el.__cued = true;
    }
    const v = M.keys(t, keys);
    el.style.position = 'absolute';
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.transform = `translate(${v.x}px,${v.y}px)`;
    if (v.w != null) el.style.width = v.w + 'px';
    if (v.h != null) el.style.height = v.h + 'px';
    if (v.radius != null) el.style.borderRadius = v.radius + 'px';
    if (v.bg != null) el.style.background = v.bg;
    if (v.o != null) el.style.opacity = v.o;
    return v;
  };

  /** content swap behind a short blur: progress of a crossfade between two children */
  K.swap = (outEl, inEl, t, t0, dur = 0.28) => {
    const p = M.tw(t, t0, t0 + dur, 'inOutCubic');
    M.set(outEl, { o: 1 - M.clamp(p * 2), blur: 10 * p, s: 1 - 0.03 * p });
    M.set(inEl, { o: M.clamp(p * 2 - 1), blur: 10 * (1 - p), s: 0.97 + 0.03 * p });
  };

  /**
   * Camera on a "world" container: [[t, {x, y, z, r}], ...]
   * x/y = world point to center on, z = zoom. Gives parallax-free, physically clean moves.
   */
  K.camera = (world, t, keys) => {
    world = M.$(world);
    const v = M.keys(t, keys);
    const z = v.z ?? 1;
    world.style.transformOrigin = '0 0';
    world.style.transform = `translate(${M.W / 2}px,${M.H / 2}px) rotate(${v.r || 0}deg) scale(${z}) translate(${-v.x}px,${-v.y}px)`;
    return v;
  };

  /** per-character text entrance; spans from M.split(). style: 'rise' | 'blur' | 'scale' | 'mask'
   *  Sets every property it touches each frame (stateless), so it pairs safely with textOut. */
  K.textIn = (chars, t, t0, { each = 0.025, dur = 0.5, style = 'rise', dist = 40, ease = 'snap' } = {}) => {
    chars.forEach((c, i) => {
      c._kIn = M.frame;
      const p = M.stagger(t, t0, i, each, dur, ease);
      if (style === 'blur') M.set(c, { o: p, blur: 12 * (1 - p), y: 8 * (1 - p) });
      else if (style === 'scale') M.set(c, { blur: 0, o: M.clamp(p * 3), s: 0.4 + 0.6 * M.ease.spring(0.4)(M.clamp((t - t0 - i * each) / dur)) });
      else if (style === 'mask') { c.parentNode.style.overflow = 'hidden'; c.parentNode.style.verticalAlign = 'bottom'; M.set(c, { o: 1, blur: 0, y: (1 - p) * 1.1 * c.offsetHeight }); }
      else M.set(c, { o: M.clamp(p * 1.6), y: dist * (1 - p), blur: 0 });
    });
  };
  /** Before t0 a char rests fully visible, unless K.textIn already set it this frame — so textOut is
   *  stateless whether it is called alone or after textIn. */
  K.textOut = (chars, t, t0, { each = 0.015, dur = 0.3, dist = -30, ease = 'inCubic' } = {}) => {
    chars.forEach((c, i) => {
      if (t < t0) {
        if (c._kIn !== M.frame) M.set(c, { o: 1, y: 0, blur: 0 });
        return;
      }
      const p = M.stagger(t, t0, i, each, dur, ease);
      M.set(c, { o: 1 - p, y: dist * p, blur: 6 * p });
    });
  };

  /**
   * Film grain overlay — deterministic per frame, pre-baked tiles, cheap.
   *   K.grain({ opacity: 0.06 })  → returns element; M.on(t => g.at(t))
   */
  K.grain = ({ opacity = 0.06, tiles = 8, size = 256, blend = 'overlay' } = {}) => {
    const cvs = [];
    for (let k = 0; k < tiles; k++) {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'), img = g.createImageData(size, size), r = M.rand(99 + k);
      for (let i = 0; i < img.data.length; i += 4) { const v = (r() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      cvs.push(c.toDataURL());
    }
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;z-index:100;pointer-events:none;opacity:${opacity};mix-blend-mode:${blend};background-size:${size}px`;
    M.stage().appendChild(el);
    el.at = (t) => {
      const f = Math.floor(t * 24) % tiles; // grain changes at 24fps like film
      el.style.backgroundImage = `url(${cvs[f]})`;
    };
    return el;
  };

  /** progress bar / loader fill */
  K.progress = (el, t, t0, t1, { ease = 'inOutCubic', to = 1 } = {}) => {
    M.$(el).style.transform = `scaleX(${M.tw(t, t0, t1, ease) * to})`;
    M.$(el).style.transformOrigin = '0 50%';
  };

  /** bar chart grow: bars = elements, values 0..1 */
  K.bars = (bars, t, t0, values, { each = 0.06, dur = 0.6, ease = 'snap' } = {}) => {
    bars.forEach((b, i) => {
      const p = M.stagger(t, t0, i, each, dur, ease);
      b.style.transformOrigin = '50% 100%';
      b.style.transform = `scaleY(${p * values[i]})`;
    });
  };

  window.K = K;
})();
