/**
 * products.js — the three products revealed at the spotlight moment.
 *
 * Image-only pills, stacked top→bottom on the left (tap behaviour parked).
 * `name` feeds the broadcast caption — prefixed with "D.DOUÉ" at render.
 */

window.App = window.App || {};

App.products = [
  { id: 'shirt',  name: 'PSG Home Stadium Shirt 2026/27',  img: 'assets/products/shirt.webp' },
  /* shorts turntable = animated WebP with alpha — renders as a plain <img>
     so iOS doesn't refuse autoplay and no codec quirks like HEVC alpha. */
  { id: 'shorts', name: 'PSG Home Stadium Shorts 2026/27', img: 'assets/products/shorts.webp' },
  { id: 'boots',  name: 'Match Boots',                     img: 'assets/products/boots.webp' }
];
