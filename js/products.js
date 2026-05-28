/**
 * products.js — the three products revealed at the spotlight moment.
 *
 * Each product carries the data its PDP card needs:
 *   name      → product title + "D.DOUÉ" caption prefix
 *   img       → rotating turntable thumbnail (animated WebP w/ alpha)
 *   priceWas  → real PSG/Nike retail (€)
 *   price     → after the BUY-NOW 10% off
 *   sizes     → tap-able size chips inside the PDP
 *   defaultSize → pre-selected on open so ATC is one-tap
 */

window.App = window.App || {};

const APPAREL = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const BOOTS   = ['39', '40', '41', '42', '43', '44', '45', '46'];

App.products = [
  { id: 'shirt',  name: 'PSG Home Stadium Shirt 2026/27',
    img: 'assets/products/shirt.webp',
    priceWas: 90,  price: 81,  sizes: APPAREL, defaultSize: 'M' },
  { id: 'shorts', name: 'PSG Home Stadium Shorts 2026/27',
    img: 'assets/products/shorts.webp',
    priceWas: 55,  price: 49,  sizes: APPAREL, defaultSize: 'M' },
  { id: 'boots',  name: 'Nike Mercurial Superfly 10 Elite',
    img: 'assets/products/boots.webp',
    priceWas: 280, price: 252, sizes: BOOTS,   defaultSize: '42' }
];
