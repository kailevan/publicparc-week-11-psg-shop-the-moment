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
  const SPOTLIGHT_START = 4.25;  // seconds — sequence kicks off (veil first, then pills/caption/buy)
  const SPOTLIGHT_END = 11.65;   // seconds — moment ends right as the countdown bar drains (4s hold)
  const DIM_ALPHA = 0.6;         // max darkness of the veil (~scene at 40%)
  const GROW = 4.5;              // how far the veil spreads outward × Doué's box half-width
  const MIN_R_VH = 0.28;         // floor on veil radius as a fraction of the smaller screen side
  const ASPECT_CAP = 2.4;        // cap vertical/horizontal so the oval never becomes a vertical streak
  const PAD = 1.2;               // clear pocket hugs his box with a little margin
  const STOPS = 16;              // gradient stops — more = smoother veil

  let video, stage, dim, pillsWrap, caption, buy, cart, cartCount, drawer, drawerItems;
  let pdpCard, pdpImg, pdpName, pdpPriceWas, pdpPriceNow, pdpStage;
  let canvasNormal, canvasXray, ctxNormal, ctxXray, drawRafId;
  let doue = null;
  let lastBox = null;
  let revealed = false;
  let spotDone = false;

  // ── Shop state ───────────────────────────────────────
  let pdpOpen = false;              // is the PDP card visible
  let currentPdpId = null;          // product id currently shown in PDP
  const selectedSize = {};          // { productId: 'M' } — chip user picked
  const cartItems = [];             // [{ productId, size }] in order added
  let pauseStart = null;            // video.currentTime when PDP opened
  let totalPaused = 0;              // accumulated paused seconds (defers SPOTLIGHT_END)
  let revealTimers = [];            // setTimeout IDs for scheduled .is-in adds

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

  // ── Video rect (contained 16:9 area inside the stage) ─
  // The <video> source is doubled-width (32:9), but each canvas renders one
  // 16:9 HALF, so videoRect always uses 16:9 aspect regardless of the source.
  function videoRect() {
    const r = stage.getBoundingClientRect();
    const va = 16 / 9;
    const ca = r.width / r.height;
    let w, h, x, y;
    if (ca > va) { h = r.height; w = h * va; x = (r.width - w) / 2; y = 0; }
    else { w = r.width; h = w / va; x = 0; y = (r.height - h) / 2; }
    return { x, y, width: w, height: h };
  }

  // ── Double-video canvas pipeline (Week 3 pattern) ────
  // Two canvases draw left + right halves of the source video each frame.
  // The xray (right) canvas fades in via CSS opacity to create the highlight.
  function startDrawLoop() {
    if (!canvasNormal || !canvasXray || !ctxNormal || !ctxXray) return;
    function draw() {
      if (video.readyState >= 2 && video.videoWidth) {
        const halfW = video.videoWidth / 2;
        const h = video.videoHeight;
        // Set internal canvas dims once (idempotent — only resizes on first run)
        if (canvasNormal.width !== halfW) { canvasNormal.width = halfW; canvasNormal.height = h; }
        if (canvasXray.width   !== halfW) { canvasXray.width   = halfW; canvasXray.height   = h; }
        ctxNormal.drawImage(video, 0,     0, halfW, h, 0, 0, halfW, h);
        ctxXray.drawImage(  video, halfW, 0, halfW, h, 0, 0, halfW, h);
      }
      drawRafId = requestAnimationFrame(draw);
    }
    cancelAnimationFrame(drawRafId);
    drawRafId = requestAnimationFrame(draw);
  }

  function layoutCanvases() {
    if (!canvasNormal || !canvasXray) return;
    const v = videoRect();
    for (const c of [canvasNormal, canvasXray]) {
      c.style.left = v.x + 'px';
      c.style.top  = v.y + 'px';
      c.style.width  = v.width + 'px';
      c.style.height = v.height + 'px';
    }
  }

  // ── Pills + caption ──────────────────────────────────
  function setCaption(name) {
    if (caption) caption.textContent = 'D.DOUÉ ' + (name || '');
  }

  function buildPills() {
    pillsWrap.innerHTML = '';
    const prods = App.products || [];
    for (const p of prods) {
      selectedSize[p.id] = p.defaultSize || (p.sizes && p.sizes[0]) || null;
      const el = document.createElement('div');
      el.className = 'pill';
      el.dataset.productId = p.id;
      // Mini-thumb visual = rotating turntable video if available, else PNG.
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
        document.addEventListener('click', kick, { once: false, capture: true });
        el.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = p.img;
        img.alt = p.name || '';
        el.appendChild(img);
      }
      // Caption follows hover/touch focus; defaults to first product.
      const focus = () => setCaption(p.name);
      el.addEventListener('pointerenter', focus);
      el.addEventListener('touchstart', focus, { passive: true });
      // Pill tap → open / swap the standalone PDP card on the right.
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPillTap(p.id, el);
      });
      pillsWrap.appendChild(el);
    }
    if (prods.length) setCaption(prods[0].name);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ── Reveal scheduling ────────────────────────────────
  // Adding .is-in to each element at its REAL scheduled time (instead of all
  // at once with CSS transition-delay / animation-delay) avoids the brief
  // pre-delay flash some browsers show while resolving long delays.
  function scheduleReveal() {
    clearRevealTimers();
    const pillEls = pillsWrap.querySelectorAll('.pill');
    const schedule = (delayMs, fn) => revealTimers.push(setTimeout(fn, delayMs));
    // Xray (dimmed-around-Doué) fades in first, briefly before the popups,
    // so the moment "lights up" before any UI shows up.
    schedule(300,  () => canvasXray && canvasXray.classList.add('is-on'));
    schedule(1700, () => pillEls[0] && pillEls[0].classList.add('is-in')); // top pill
    schedule(1850, () => pillEls[1] && pillEls[1].classList.add('is-in')); // middle
    schedule(2000, () => pillEls[2] && pillEls[2].classList.add('is-in')); // bottom
    schedule(2450, () => caption && caption.classList.add('is-in'));
    schedule(2850, () => buy && buy.classList.add('is-in'));              // internal stagger handled by .buy CSS
    // Cart icon is NOT scheduled here — it only appears after the user adds
    // an item via ATC (handled in closePdp when cartItems is non-empty).
  }
  function clearRevealTimers() {
    revealTimers.forEach(t => clearTimeout(t));
    revealTimers = [];
  }

  // ── PDP card open / close / swap ────────────────────
  function onPillTap(productId, pillEl) {
    if (!pdpOpen) return openPdp(productId, pillEl);
    if (productId !== currentPdpId) return swapPdp(productId, pillEl);
    // tapping the currently-selected pill is a no-op (close only via outside-tap / ATC)
  }

  function openPdp(productId, pillEl) {
    populatePdp(productId);
    pillsWrap.classList.add('is-shopping');
    setSelectedPill(pillEl);
    if (caption) caption.classList.add('is-hidden');
    if (buy) buy.classList.add('is-paused');
    pauseStart = video.currentTime;            // defer the SPOTLIGHT_END check
    pdpCard.classList.add('is-open');
    pdpCard.setAttribute('aria-hidden', 'false');
    pdpOpen = true;
    currentPdpId = productId;
  }

  function closePdp() {
    if (!pdpOpen) return;
    pdpCard.classList.remove('is-open');
    pdpCard.setAttribute('aria-hidden', 'true');
    pillsWrap.classList.remove('is-shopping');
    pillsWrap.querySelectorAll('.pill').forEach(p => p.classList.remove('is-selected'));
    if (caption) caption.classList.remove('is-hidden');
    if (buy) buy.classList.remove('is-paused');
    // Cart slides in (from the right) AFTER the PDP starts sliding out,
    // but only if the user actually added something. Stays for subsequent
    // shopping until SPOTLIGHT_END / replay.
    if (cart && cartItems.length > 0 && !cart.classList.contains('is-in')) {
      setTimeout(() => cart.classList.add('is-in'), 250);
    }
    if (pauseStart !== null) {
      totalPaused += Math.max(0, video.currentTime - pauseStart);
      pauseStart = null;
    }
    pdpOpen = false;
    currentPdpId = null;
    // After the slide-out finishes, reset the chip / picked state for a clean next open
    setTimeout(() => {
      if (pdpStage) {
        pdpStage.classList.remove('is-picked');
        pdpStage.querySelectorAll('.size-chip').forEach(c => c.classList.remove('is-selected'));
      }
    }, 450);
  }

  function swapPdp(productId, pillEl) {
    if (productId === currentPdpId) return;
    // Flip the highlighted pill IMMEDIATELY so the dim/un-dim reads as
    // instant feedback to the tap — don't wait for the swap-fade timeout.
    setSelectedPill(pillEl);
    pdpCard.classList.add('is-swapping');
    setTimeout(() => {
      populatePdp(productId);
      pdpCard.classList.remove('is-swapping');
      currentPdpId = productId;
    }, 150);
  }

  function setSelectedPill(pillEl) {
    pillsWrap.querySelectorAll('.pill').forEach(p => p.classList.remove('is-selected'));
    if (pillEl) pillEl.classList.add('is-selected');
  }

  // Rebuild the card's content for a given product. Card stays in the DOM;
  // only its inner text/image/chips swap.
  function populatePdp(productId) {
    const p = (App.products || []).find(x => x.id === productId);
    if (!p) return;
    pdpCard.dataset.productId = productId;
    if (pdpImg) { pdpImg.src = p.img; pdpImg.alt = p.name || ''; }
    if (pdpName) pdpName.textContent = p.name;
    if (pdpPriceWas) pdpPriceWas.textContent = p.priceWas ? ('€' + p.priceWas) : '';
    if (pdpPriceNow) pdpPriceNow.textContent = '€' + p.price;
    if (!pdpStage) return;
    pdpStage.classList.remove('is-picked');
    pdpStage.innerHTML =
      (p.sizes || []).map(s =>
        '<button type="button" class="size-chip" data-size="' + s + '">' + s + '</button>'
      ).join('') +
      '<button type="button" class="pdp-atc">ADD TO CART</button>';
    // wire chip clicks
    pdpStage.querySelectorAll('.size-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pdpStage.classList.contains('is-picked') && chip.classList.contains('is-selected')) {
          pdpStage.classList.remove('is-picked');
          return;
        }
        pdpStage.querySelectorAll('.size-chip').forEach(c => c.classList.remove('is-selected'));
        chip.classList.add('is-selected');
        selectedSize[p.id] = chip.dataset.size;
        pdpStage.classList.add('is-picked');
      });
    });
    // wire ATC click
    const atc = pdpStage.querySelector('.pdp-atc');
    if (atc) atc.addEventListener('click', (e) => {
      e.stopPropagation();
      if (atc.classList.contains('is-added')) return;
      atc.classList.add('is-added');
      atc.textContent = 'ADDED ✓';
      addToCart(p.id, selectedSize[p.id]);
      setTimeout(() => closePdp(), 600);
    });
  }

  // ── Cart ────────────────────────────────────────────
  function addToCart(productId, size) {
    cartItems.push({ productId, size });
    renderCart();
    if (cart) {
      cart.classList.add('has-items', 'bump');
      setTimeout(() => cart.classList.remove('bump'), 480);
    }
  }
  function renderCart() {
    if (cartCount) cartCount.textContent = cartItems.length;
    if (!drawerItems) return;
    if (!cartItems.length) {
      drawerItems.innerHTML = '<div class="drawer-empty">Empty</div>';
      return;
    }
    const byId = id => (App.products || []).find(p => p.id === id);
    drawerItems.innerHTML = cartItems.map(it => {
      const p = byId(it.productId); if (!p) return '';
      return '<div class="drawer-item">' +
        '<img class="drawer-item-img" src="' + p.img + '" alt="">' +
        '<div class="drawer-item-text">' +
          '<div class="drawer-item-name">' + escapeHtml(p.name) + '</div>' +
          '<div class="drawer-item-meta">Size ' + it.size + ' · €' + p.price + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  function toggleDrawer(force) {
    if (!drawer) return;
    const open = force !== undefined ? force : !drawer.classList.contains('is-open');
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  // Pin the pill stack + caption to the video's left edge and scale them
  // to the contained video, matching the Figma frame's ratios.
  function layoutPills() {
    layoutCanvases();
    const v = videoRect();
    const ph = v.height * 0.1937;   // 72.875 / 376.25
    const pw = v.height * 0.1808;   // 68.017 / 376.25
    const gap = v.height * 0.00797; // 3 / 376.25
    const rad = pw * 0.0874;        // 5.942 / 68.017
    pillsWrap.style.left = (v.x + v.width * 0.0344) + 'px'; // 23 / 668.89
    pillsWrap.style.top  = (v.y + v.height * 0.202) + 'px'; // 76 / 376.25
    pillsWrap.style.width = pw + 'px';                       // container hugs the column
    pillsWrap.style.height = (3 * ph + 2 * gap) + 'px';
    pillsWrap.style.setProperty('--pill-w', pw + 'px');
    pillsWrap.style.setProperty('--pill-h', ph + 'px');
    pillsWrap.style.setProperty('--pill-gap', gap + 'px');
    pillsWrap.style.setProperty('--pill-rad', rad + 'px');
    // Position each pill absolutely so a tapped pill stays in place
    // and only changes its top/height/width when expanding (no jump-to-top).
    const pillEls = pillsWrap.querySelectorAll('.pill');
    pillEls.forEach((p, i) => {
      // only set the BASE top — .pill.is-expanded overrides via CSS
      if (!p.classList.contains('is-expanded')) {
        p.style.top = (i * (ph + gap)) + 'px';
      }
      p.dataset.baseTop = (i * (ph + gap));
    });
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
    // PDP card geometry — matches Figma frame 48 (1:1 ratio).
    // Card is tall (78% of video height, top at 15.6%), product image overflows
    // the card horizontally by ~16% per side (image 132% × card width).
    const pdpH = v.height * 0.782;                           // Figma 943 / 1206
    const pdpW = v.width  * 0.305;                           // Figma 653 / 2144
    pillsWrap.style.setProperty('--pdp-w', pdpW + 'px');
    pillsWrap.style.setProperty('--pdp-h', pdpH + 'px');
    // Caps are still useful for the mini-thumb image inside the pill (capped at
    // ~50% of the card-equiv area). For the PDP card image, CSS uses explicit
    // 132% / 58% values that scale beyond the card.
    pillsWrap.style.setProperty('--img-max-h', (pdpH * 0.5) + 'px');
    pillsWrap.style.setProperty('--img-max-w', (pdpW * 0.85) + 'px');
    // 1em inside the card ≈ 12px on phone (scales w/ video height) — drives all PDP text
    pillsWrap.style.setProperty('font-size', (v.height * 0.031) + 'px');
    // Cart icon: right-aligned, just above the PDP top edge (which sits at 0.156 of videoH).
    // Bumped a bit lower (cart bottom at 0.18 of videoH).
    if (cart) {
      const cs = v.height * 0.085;
      cart.style.setProperty('--cart-size', cs + 'px');
      cart.style.left = (v.x + v.width - cs - v.width * 0.0239) + 'px';
      cart.style.top  = (v.y + v.height * 0.23 - cs) + 'px';
      cart.style.fontSize = (v.height * 0.05) + 'px';
    }
    // PDP card: tall, hugs the right edge — Figma frame 48 positions (1:1).
    if (pdpCard) {
      pdpCard.style.width  = pdpW + 'px';
      pdpCard.style.height = pdpH + 'px';
      pdpCard.style.top    = (v.y + v.height * 0.156) + 'px';   // Figma 188 / 1206
      pdpCard.style.left   = (v.x + v.width - pdpW - v.width * 0.035) + 'px';
      pdpCard.style.fontSize = (v.height * 0.031) + 'px';
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
      scheduleReveal();
      // Veil/spotlight gradient removed — Doué stays in the live frame, not dimmed.
    }

    // timer hits zero (minus any paused-shopping time) → orchestrated exit:
    // BUY button + cart first, then pills bottom→top, caption with them, veil last.
    // If a PDP is open, the check defers (pauseStart frozen, totalPaused not yet banked).
    const elapsed = (pauseStart !== null) ? (pauseStart - totalPaused) : (t - totalPaused);
    if (revealed && !spotDone && elapsed >= SPOTLIGHT_END) {
      spotDone = true;
      if (pdpOpen) closePdp();                                         // slide PDP out with the moment
      if (buy) buy.classList.remove('is-in');                          // buy wipes back right→left
      if (cart) cart.classList.remove('is-in');                        // cart slides back down
      if (canvasXray) canvasXray.classList.remove('is-on');            // xray fades back to normal
      setTimeout(() => {
        if (caption) caption.classList.remove('is-in');                // caption fades w/ first pill
        const pillEls = pillsWrap.querySelectorAll('.pill');
        [2, 1, 0].forEach((idx, i) => {                                // bottom → middle → top
          setTimeout(() => pillEls[idx] && pillEls[idx].classList.remove('is-in'), i * 150);
        });
      }, 350);
      // Veil removed — no dim layer to fade out at the end.
    }

    requestAnimationFrame(render);
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    video = document.getElementById('match-video');
    stage = document.getElementById('stage');
    dim = document.getElementById('dim');
    pillsWrap = document.getElementById('pills');
    caption = document.getElementById('caption');
    buy = document.getElementById('buy');
    cart = document.getElementById('cart');
    cartCount = document.getElementById('cart-count');
    drawer = document.getElementById('cart-drawer');
    drawerItems = document.getElementById('drawer-items');
    pdpCard = document.getElementById('pdp-card');
    pdpImg = document.getElementById('pdp-img');
    pdpName = document.getElementById('pdp-name');
    pdpPriceWas = document.getElementById('pdp-price-was');
    pdpPriceNow = document.getElementById('pdp-price-now');
    pdpStage = document.getElementById('pdp-stage');
    canvasNormal = document.getElementById('canvas-normal');
    canvasXray   = document.getElementById('canvas-xray');
    if (canvasNormal) ctxNormal = canvasNormal.getContext('2d');
    if (canvasXray)   ctxXray   = canvasXray.getContext('2d');
    layoutCanvases();
    if (video.readyState >= 1) startDrawLoop();
    else video.addEventListener('loadedmetadata', startDrawLoop, { once: true });
    // Stop card-internal taps from bubbling to the stage (which would close it)
    if (pdpCard) pdpCard.addEventListener('click', (e) => e.stopPropagation());

    loadLooks();
    buildPills();
    renderCart();
    layoutPills();

    // Cart icon → toggle drawer (don't bubble to stage)
    if (cart) cart.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDrawer();
    });
    if (drawer) drawer.addEventListener('click', (e) => e.stopPropagation());
    const checkout = drawer && drawer.querySelector('.drawer-checkout');
    if (checkout) checkout.addEventListener('click', (e) => {
      e.stopPropagation();
      // visual-only checkout per spec — flash the button
      checkout.textContent = 'THANK YOU ✓';
      setTimeout(() => { checkout.textContent = 'CHECKOUT'; toggleDrawer(false); }, 900);
    });

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

    // Sound on by default: try to unmute right away; if iOS blocks it (autoplay
    // policy), unmute on the very first user gesture and never re-mute.
    video.volume = 1;
    const tryUnmute = () => {
      if (!video.muted) return;
      video.muted = false;
      video.play().catch(() => { video.muted = true; });
    };
    tryUnmute();
    const armUnmute = () => {
      tryUnmute();
      if (!video.muted) {
        document.removeEventListener('click', armUnmute, true);
        document.removeEventListener('touchstart', armUnmute, true);
      }
    };
    document.addEventListener('click', armUnmute, true);
    document.addEventListener('touchstart', armUnmute, true);

    // tap empty space:
    //   1) if cart drawer is open → close it
    //   2) else if a PDP is expanded → close it (spec: tap outside the card)
    //   3) else → replay the whole moment from the top
    stage.addEventListener('click', () => {
      if (drawer && drawer.classList.contains('is-open')) { toggleDrawer(false); return; }
      if (pdpOpen) { closePdp(); return; }
      revealed = false; spotDone = false;
      clearRevealTimers();                                             // cancel any queued .is-in adds
      pauseStart = null; totalPaused = 0;                              // reset shop-pause offset
      pdpOpen = false; currentPdpId = null;                            // safety reset
      cartItems.length = 0; renderCart();                              // empty cart for a fresh take
      if (cart) cart.classList.remove('has-items', 'is-in');
      if (pdpCard) pdpCard.classList.remove('is-open', 'is-swapping');
      if (canvasXray) canvasXray.classList.remove('is-on');
      pillsWrap.classList.remove('is-shopping');
      pillsWrap.querySelectorAll('.pill').forEach(p => { p.classList.remove('is-in'); p.classList.remove('is-selected'); });
      if (caption) { caption.classList.remove('is-in'); caption.classList.remove('is-hidden'); }
      if (buy) { buy.classList.remove('is-in'); buy.classList.remove('is-paused'); }
      video.currentTime = 0;
      video.play().catch(() => {});
    });

    video.play().catch(() => {});
    requestAnimationFrame(render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
