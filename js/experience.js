/**
 * experience.js — Shop the Moment.
 *
 * Plays the PSG goal clip. At SPOTLIGHT_START a soft radial spotlight locks
 * onto Doué (tracked box from the editor, interpolated each frame) while the
 * rest of the frame dims to ~40%, and three product pills rise from the bottom.
 * Playback freezes on the last celebration frame at FREEZE_AT.
 */

(function () {
  'use strict';

  // ── Tunables (easy to dial in) ───────────────────────
  const STORAGE_KEY = 'shop-moment-data';
  const SPOTLIGHT_START = 6.0;   // seconds — sequence kicks off (veil first, then pills/caption/buy)
  const SPOTLIGHT_END = 15.4;    // seconds — moment ends right as the countdown bar drains
  const DIM_ALPHA = 0.6;         // max darkness of the veil (~scene at 40%)
  const GROW = 4.5;              // how far the veil spreads outward × Doué's box half-width
  const MIN_R_VH = 0.28;         // floor on veil radius as a fraction of the smaller screen side
  const ASPECT_CAP = 2.4;        // cap vertical/horizontal so the oval never becomes a vertical streak
  const PAD = 1.2;               // clear pocket hugs his box with a little margin
  const STOPS = 16;              // gradient stops — more = smoother veil

  let video, stage, dim, pillsWrap, caption, buy;
  let doue = null;
  let lastBox = null;
  let revealed = false;
  let spotDone = false;

  // ── Data ─────────────────────────────────────────────
  function loadLooks() {
    let data = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    let looks = (data && data.looks && data.looks.length) ? data.looks
              : (App.lookData && App.lookData.looks) ? App.lookData.looks : [];
    doue = looks.find(l => l.id === 'p-doue') || looks[0] || null;
  }

  // ── Video rect (object-fit: contain) ─────────────────
  function videoRect() {
    const r = stage.getBoundingClientRect();
    const va = (video.videoWidth / video.videoHeight) || (16 / 9);
    const ca = r.width / r.height;
    let w, h, x, y;
    if (ca > va) { h = r.height; w = h * va; x = (r.width - w) / 2; y = 0; }
    else { w = r.width; h = w / va; x = 0; y = (r.height - h) / 2; }
    return { x, y, width: w, height: h };
  }

  // ── Pills + caption ──────────────────────────────────
  function setCaption(name) {
    if (caption) caption.textContent = 'D.DOUÉ ' + (name || '');
  }

  function buildPills() {
    pillsWrap.innerHTML = '';
    const prods = App.products || [];
    for (const p of prods) {
      const el = document.createElement('div');
      el.className = 'pill';
      el.dataset.productId = p.id;
      // turntable video if provided — needs muted+playsinline for iOS autoplay,
      // and we still call play() explicitly because iOS often refuses the first
      // implicit autoplay attempt. Fall back to the still product PNG.
      const srcs = p.videos || (p.video ? [{ src: p.video }] : null);
      if (srcs) {
        const v = document.createElement('video');
        v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
        v.preload = 'auto';
        v.setAttribute('muted', '');             // attribute form for older iOS
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        v.setAttribute('disableremoteplayback', '');
        if (p.img) v.poster = p.img;
        for (const s of srcs) {
          const src = document.createElement('source');
          src.src = s.src; if (s.type) src.type = s.type;
          v.appendChild(src);
        }
        const kick = () => v.play().catch(() => {});
        v.addEventListener('loadedmetadata', kick);
        v.addEventListener('canplay', kick);
        // also kick on the first stage interaction (iOS sometimes needs a gesture)
        document.addEventListener('click', kick, { once: false, capture: true });
        el.appendChild(v);
      } else {
        el.innerHTML = '<img src="' + p.img + '" alt="' + (p.name || '') + '">';
      }
      // caption follows the focused pill; defaults to the first product
      const focus = () => setCaption(p.name);
      el.addEventListener('pointerenter', focus);
      el.addEventListener('touchstart', focus, { passive: true });
      pillsWrap.appendChild(el);
    }
    if (prods.length) setCaption(prods[0].name);
  }

  // Pin the pill stack + caption to the video's left edge and scale them
  // to the contained video, matching the Figma frame's ratios.
  function layoutPills() {
    const v = videoRect();
    const ph = v.height * 0.1937;   // 72.875 / 376.25
    const pw = v.height * 0.1808;   // 68.017 / 376.25
    const gap = v.height * 0.00797; // 3 / 376.25
    const rad = pw * 0.0874;        // 5.942 / 68.017
    pillsWrap.style.left = (v.x + v.width * 0.0344) + 'px'; // 23 / 668.89
    pillsWrap.style.top  = (v.y + v.height * 0.202) + 'px'; // 76 / 376.25
    pillsWrap.style.setProperty('--pill-w', pw + 'px');
    pillsWrap.style.setProperty('--pill-h', ph + 'px');
    pillsWrap.style.setProperty('--pill-gap', gap + 'px');
    pillsWrap.style.setProperty('--pill-rad', rad + 'px');
    if (caption) {
      caption.style.left = (v.x + v.width * 0.0373) + 'px';  // ~25 / 668.89
      caption.style.top  = (v.y + v.height * 0.822) + 'px';  // 309.51 / 376.25
      caption.style.setProperty('--cap-fs', (v.height * 0.0239) + 'px'); // 9 / 376.25
    }
    if (buy) {
      buy.style.left = (v.x + v.width * 0.0239) + 'px';    // Frame 29: 16 / 668.89
      buy.style.top  = (v.y + v.height * 0.885) + 'px';    // 333 / 376.25
      buy.style.width = (v.width * 0.3334) + 'px';         // 223 / 668.89
      buy.style.height = (v.height * 0.10631) + 'px';      // 40 / 376.25
      buy.style.fontSize = (v.height * 0.03987) + 'px';    // 15 / 376.25
    }
  }

  // ── Spotlight ────────────────────────────────────────
  // smootherstep — zero slope at both ends, so the veil has no visible seam
  function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  // build an eased multi-stop ramp: clear pocket → smoothly to full dim
  function veilStops(coreFrac) {
    let s = '';
    for (let i = 0; i <= STOPS; i++) {
      const p = i / STOPS;
      let a;
      if (p <= coreFrac) a = 0;
      else a = DIM_ALPHA * smootherstep((p - coreFrac) / (1 - coreFrac));
      s += 'rgba(0,0,0,' + a.toFixed(3) + ') ' + (p * 100).toFixed(2) + '%';
      if (i < STOPS) s += ', ';
    }
    return s;
  }

  function paintSpotlight(box, v) {
    let cx, cy, halfW, halfH;
    if (box) {
      const left = v.x + box.x1 * v.width;
      const top = v.y + box.y1 * v.height;
      const w = (box.x2 - box.x1) * v.width;
      const h = (box.y2 - box.y1) * v.height;
      cx = left + w / 2;
      cy = top + h / 2;
      halfW = w / 2;
      halfH = h / 2;
    } else {
      // no track yet — fall back to a centred oval so the effect still reads
      cx = v.x + v.width * 0.5;
      cy = v.y + v.height * 0.55;
      halfW = v.height * 0.16;
      halfH = v.height * 0.30;
    }

    // oval matches Doué's silhouette (taller than wide), capped so it never streaks
    let aspect = halfH / halfW;
    aspect = Math.max(1.2, Math.min(aspect, ASPECT_CAP));

    const minSide = Math.min(window.innerWidth, window.innerHeight);
    let rx = Math.max(halfW * GROW, minSide * MIN_R_VH);
    let ry = rx * aspect;

    // clear pocket (alpha 0) sized to hug his body; rest eases out to full dim
    const coreFrac = Math.min(0.6, (halfW * PAD) / rx);

    dim.style.background =
      'radial-gradient(ellipse ' + rx.toFixed(1) + 'px ' + ry.toFixed(1) + 'px at ' +
      cx.toFixed(1) + 'px ' + cy.toFixed(1) + 'px, ' + veilStops(coreFrac) + ')';
  }

  // ── Render loop ──────────────────────────────────────
  function render() {
    const t = video.currentTime;

    if (!revealed && t >= SPOTLIGHT_START) {
      revealed = true;
      dim.classList.add('is-on');
      pillsWrap.querySelectorAll('.pill').forEach(p => p.classList.add('is-in'));
      if (caption) caption.classList.add('is-in');
      if (buy) buy.classList.add('is-in');
    }

    // timer hits zero → orchestrated exit: BUY button first, then pills
    // exit bottom→top (reverse of how they came in), caption fades with them, veil last.
    if (revealed && !spotDone && t >= SPOTLIGHT_END) {
      spotDone = true;
      if (buy) buy.classList.remove('is-in');                          // buy wipes back right→left
      setTimeout(() => {
        if (caption) caption.classList.remove('is-in');                // caption fades w/ first pill
        const pillEls = pillsWrap.querySelectorAll('.pill');
        [2, 1, 0].forEach((idx, i) => {                                // bottom → middle → top
          setTimeout(() => pillEls[idx] && pillEls[idx].classList.remove('is-in'), i * 150);
        });
      }, 350);
      setTimeout(() => dim.classList.remove('is-on'), 1100);            // veil after all pills are out
    }

    if (revealed && !spotDone) {
      let box = doue ? App.utils.interpolateBox(doue.keyframes, t) : null;
      // Before Doué's first keyframe (e.g. veil starts at 6s but track at 9.1s),
      // anchor the veil at his first known position instead of falling back to centre.
      if (!box && doue && doue.keyframes && doue.keyframes.length && t < doue.keyframes[0].time) {
        const k = doue.keyframes[0];
        box = { x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2 };
      }
      if (box) lastBox = box;
      paintSpotlight(box || lastBox, videoRect());
    }

    requestAnimationFrame(render);
  }

  // ── Fullscreen ───────────────────────────────────────
  const ICON_EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const ICON_COMPRESS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

  function setupFullscreen() {
    const btn = document.getElementById('fs-btn');
    if (!btn) return;
    const sync = () => { btn.innerHTML = fsElement() ? ICON_COMPRESS : ICON_EXPAND; };
    sync();
    const pageFs = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = document.documentElement;
      if (pageFs) {
        if (!fsElement()) (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
        else (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
      }
    });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    video = document.getElementById('match-video');
    stage = document.getElementById('stage');
    dim = document.getElementById('dim');
    pillsWrap = document.getElementById('pills');
    caption = document.getElementById('caption');
    buy = document.getElementById('buy');

    loadLooks();
    buildPills();
    layoutPills();
    setupFullscreen();

    // Keep the overlay pinned + scaled to the video at any size — incl.
    // fullscreen, which doesn't reliably fire 'resize' everywhere.
    if (window.ResizeObserver) {
      new ResizeObserver(layoutPills).observe(stage);
    } else {
      window.addEventListener('resize', layoutPills);
    }
    document.addEventListener('fullscreenchange', layoutPills);
    document.addEventListener('webkitfullscreenchange', layoutPills);
    video.addEventListener('loadedmetadata', layoutPills);

    // pill + buy taps are parked for later — don't let them toggle playback
    pillsWrap.addEventListener('click', (e) => e.stopPropagation());
    if (buy) buy.addEventListener('click', (e) => e.stopPropagation());

    const soundBtn = document.getElementById('sound-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        soundBtn.textContent = video.muted ? '🔇' : '🔊';
        if (!video.muted) video.play().catch(() => {});
      });
    }

    // tap empty space = replay the whole moment from the top (re-record takes)
    stage.addEventListener('click', () => {
      revealed = false; spotDone = false;
      dim.classList.remove('is-on');
      dim.style.background = '';
      pillsWrap.querySelectorAll('.pill').forEach(p => p.classList.remove('is-in'));
      if (caption) caption.classList.remove('is-in');
      if (buy) buy.classList.remove('is-in');
      video.currentTime = 0;
      video.play().catch(() => {});
    });

    video.play().catch(() => {});
    requestAnimationFrame(render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
