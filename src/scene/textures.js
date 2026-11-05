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

/* ───────── Texturas reales (CC0, Poly Haven) y normal de agua ───────── */
// `size` = metros que cubre la imagen (dimensions de info.json). Las UV de la malla se dan ya en "unidades de textura".
export const REAL = {
  'stone-light': { size: 4.0, normal: true },
  'stone-grey': { size: 1.825, normal: true },
  wood: { size: 2.0, normal: true },
  liner: { size: 1.8, normal: true },
};
export const WATER_NORMAL_METERS = 3.2;
const real = {}; // se rellena en loadRealTextures()

function prep(t, srgb) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
}

// Convierte la foto del relieve de la lámina en un mapa de luminosidad casi neutro (el color lo pone el acabado elegido).
function linerLuminance(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d');
  x.drawImage(img, 0, 0); const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const mean = sum / (d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2], v = Math.max(0, Math.min(255, 232 + (l - mean) * 0.9));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  x.putImageData(im, 0, 0); return c;
}

export async function loadRealTextures(base = 'textures/') {
  const loader = new THREE.TextureLoader();
  const load = (f) => loader.loadAsync(base + f);
  const jobs = Object.keys(REAL).map(async (k) => {
    try {
      const [d, n] = await Promise.all([load(k + '_diff.jpg'), load(k + '_nor.jpg')]);
      let diff = d;
      if (k === 'stone-light') { // la piedra original es muy anaranjada: se desatura para que parezca piedra caliza clara
        const c = document.createElement('canvas'); c.width = d.image.width; c.height = d.image.height; const x = c.getContext('2d'); x.filter = 'saturate(0.38) brightness(1.08) contrast(0.92)'; x.drawImage(d.image, 0, 0); diff = new THREE.CanvasTexture(c);
      }
      real[k] = { map: prep(k === 'liner' ? new THREE.CanvasTexture(linerLuminance(d.image)) : diff, true), normalMap: prep(n, false) };
      if (k === 'liner') real[k].map.colorSpace = THREE.SRGBColorSpace;
    } catch (e) { console.warn('Textura no disponible, se usa la procedural:', k, e); }
  });
  jobs.push(load('water_nor.jpg').then((t) => { real.water = prep(t, false); }).catch((e) => console.warn('Normal de agua no disponible', e)));
  await Promise.all(jobs);
  return real;
}

// Siempre devuelven { map, normalMap?, size }, con la textura real si se cargó y la procedural si no.
export function copingMaps(kind) { return real[kind] ? { ...real[kind], size: REAL[kind].size } : { map: copingTexture(kind), normalMap: null, size: COPING_METERS }; }
export function linerMaps() { return real.liner ? { ...real.liner, size: REAL.liner.size } : { map: linerTexture(), normalMap: null, size: 2 }; }
export function waterMaps() { return { normalMap: real.water || waterNormal(), size: real.water ? WATER_NORMAL_METERS : 4 }; }

// Cáusticas: celdas de Voronoi con bordes brillantes, repetibles.
export function causticsTexture() {
  return once('caustics', () => {
    const S = 256, [c, x] = canvas(S, S), r = rng(21), pts = Array.from({ length: 22 }, () => [r() * S, r() * S]);
    const img = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      let d1 = 1e9, d2 = 1e9;
      for (const p of pts) for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { const d = Math.hypot(i - p[0] - ox, j - p[1] - oy); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      const edge = Math.max(0, 1 - (d2 - d1) / 9), v = Math.pow(edge, 2.2) * 255, k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0); return toTex(c);
  });
}
