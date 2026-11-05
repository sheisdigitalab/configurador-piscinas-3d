import * as THREE from 'three';

// Texturas procedurales (sin imágenes externas). Generador con semilla para que siempre salgan iguales.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function toTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function grain(ctx, w, h, amt, rand) {
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rand() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(im, 0, 0);
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v * f)) | 0;
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const cache = {};
const once = (k, fn) => cache[k] || (cache[k] = fn());

// Cada textura cubre `meters` metros por lado: se usa para fijar el repeat.
export const GRASS_METERS = 4;
export const PAVING_METERS = 1.2;
export const COPING_METERS = 0.7;

export function grassTexture() {
  return once('grass', () => {
    const [c, x] = canvas(512, 512), r = rng(7);
    x.fillStyle = '#5d8f3c'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5200; i++) {
      const px = r() * 512, py = r() * 512, l = 4 + r() * 9, a = (r() - 0.5) * 0.8;
      x.strokeStyle = shade(['#6da148', '#4f8033', '#79ad4f', '#568a37'][(r() * 4) | 0], 0.92 + r() * 0.2);
      x.lineWidth = 1 + r(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.sin(a) * l, py - Math.cos(a) * l); x.stroke();
    }
    grain(x, 512, 512, 14, r);
    return toTex(c);
  });
}

export function pavingTexture() {
  return once('paving', () => {
    const [c, x] = canvas(512, 512), r = rng(11);
    x.fillStyle = '#b9b1a2'; x.fillRect(0, 0, 512, 512);
    const n = 2, ts = 512 / n, g = 3;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = shade('#dcd5c7', 0.94 + r() * 0.1); x.fillRect(i * ts + g, j * ts + g, ts - 2 * g, ts - 2 * g); }
    grain(x, 512, 512, 16, r);
    return toTex(c);
  });
}

// Coronación: 2×2 piezas de 35 cm (0,7 m por lado). La franja mide 35 cm, así que ve una pieza de ancho.
export function copingTexture(kind) {
  return once('coping-' + kind, () => {
    const [c, x] = canvas(512, 512), r = rng(kind.length * 31);
    if (kind === 'wood') {
      x.fillStyle = '#4a3320'; x.fillRect(0, 0, 512, 512);
      const rows = 4, ph = 512 / rows;
      for (let i = 0; i < rows; i++) {
        let px = -r() * 200;
        while (px < 512) {
          const len = 200 + r() * 180;
          x.fillStyle = shade('#a8763f', 0.82 + r() * 0.3); x.fillRect(px + 2, i * ph + 2, len - 4, ph - 4);
          x.strokeStyle = 'rgba(60,35,12,.25)'; x.lineWidth = 1;
          for (let k = 0; k < 6; k++) { const gy = i * ph + 8 + r() * (ph - 16); x.beginPath(); x.moveTo(px + 4, gy); x.lineTo(px + len - 4, gy + (r() - 0.5) * 4); x.stroke(); }
          px += len;
        }
      }
      grain(x, 512, 512, 12, r);
    } else {
      const base = kind === 'stone-grey' ? '#8a8e90' : '#dcd3c2', grout = kind === 'stone-grey' ? '#6b6f71' : '#b8ad99';
      x.fillStyle = grout; x.fillRect(0, 0, 512, 512);
      const n = 2, ts = 512 / n, g = 4;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = shade(base, 0.93 + r() * 0.12); x.fillRect(i * ts + g, j * ts + g, ts - 2 * g, ts - 2 * g); }
      grain(x, 512, 512, 22, r);
    }
    return toTex(c);
  });
}

// Relieve suave de la lámina (se multiplica por el color del acabado).
export function linerTexture() {
  return once('liner', () => {
    const [c, x] = canvas(256, 256), r = rng(3);
    x.fillStyle = '#ececec'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      const px = r() * 256, py = r() * 256, rad = 20 + r() * 50, g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},.06)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    grain(x, 256, 256, 8, r);
    return toTex(c);
  });
}

// Mapa de normales del agua: suma de ondas senoidales, repetible.
export function waterNormal() {
  return once('water', () => {
    const S = 256, [c, x] = canvas(S, S), img = x.createImageData(S, S);
    const h = (u, v) => Math.sin(u * 6.2832 * 3 + Math.sin(v * 6.2832 * 2) * 1.4) * 0.5 + Math.sin(v * 6.2832 * 4 - u * 6.2832 * 2) * 0.35 + Math.sin((u + v) * 6.2832 * 5) * 0.2;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const u = i / S, v = j / S, e = 1 / S;
      const dx = h(u + e, v) - h(u - e, v), dy = h(u, v + e) - h(u, v - e);
      const nx = -dx * 3, ny = -dy * 3, nz = 1, l = Math.hypot(nx, ny, nz);
      const k = (j * S + i) * 4;
      img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return toTex(c, false);
  });
}
