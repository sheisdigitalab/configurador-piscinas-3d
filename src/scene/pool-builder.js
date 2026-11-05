// Construye la piscina (vaso, escaleras, coronación, agua, focos, ducha). Lo comparten la vista 3D libre y la vista sobre foto.
import * as THREE from 'three';
import { poolOutline, poolFeatures, offsetPoly, poolMetrics } from '../core/pool-math.js';
import { ledCount } from '../core/quote.js';
import { copingMaps, linerMaps, waterMaps, causticsTexture } from './textures.js';

export const WATER_DROP = 0.12; // el agua queda 12 cm por debajo del borde

// Malla con UV y color por vértice (RGB o RGBA)
export class MeshBuilder {
  constructor() { this.p = []; this.uv = []; this.c = []; this.idx = []; this.cn = 3; }
  v(x, y, z, u = 0, w = 0, col = [1, 1, 1]) {
    this.p.push(x, y, z); this.uv.push(u, w); this.cn = col.length; this.c.push(...col); return this.p.length / 3 - 1;
  }
  tri(a, b, c, want) {
    const P = this.p, A = new THREE.Vector3(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), B = new THREE.Vector3(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), C = new THREE.Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
    const n = B.sub(A).cross(C.sub(A));
    if (n.dot(want) < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  quad(a, b, c, d, want) { this.tri(a, b, c, want); this.tri(a, c, d, want); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, this.cn));
    g.setIndex(this.idx); g.computeVertexNormals(); return g;
  }
}

export function toShape(pts) { const s = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return s; }
export function toPath(pts) { const s = new THREE.Path(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return s; }

export function disposeTree(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  while (g.children.length) g.remove(g.children[0]);
}

// Cajas y cilindros con UV en unidades de textura (metros / size) para que el relieve conserve la escala real.
function boxUV(w, h, d, size) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / size, uv.getY(k) * dims[f][1] / size); }
  return g;
}
function cylUV(r, h, size, seg = 48) {
  const g = new THREE.CylinderGeometry(r, r, h, seg), uv = g.attributes.uv, side = (seg + 1) * 2;
  for (let i = 0; i < uv.count; i++) {
    if (i < side) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r / size, uv.getY(i) * h / size); else uv.setXY(i, uv.getX(i) * 2 * r / size, uv.getY(i) * 2 * r / size);
  }
  return g;
}

/**
 * Devuelve { group, pts, water, volume, caustics, ledLights, ledDiscs, shower, applyLook(look), tick(t) }.
 * look = { led: 0..1 (potencia de los focos), brightness: 0..1 (luz del volumen de agua), caustics: 0..1 }
 */
export function buildPool(cfg, catalog) {
  const copW = catalog.copingWidth, D = cfg.depth, L = cfg.length, W = cfg.width;
  const pts = poolOutline(cfg), F = poolFeatures(cfg), n = pts.length, up = new THREE.Vector3(0, 1, 0);
  const liner = catalog.liners.find((x) => x.id === cfg.liner) || catalog.liners[0];
  const coping = catalog.copings.find((x) => x.id === cfg.coping) || catalog.copings[0];
  const lc = new THREE.Color(liner.hex), G = new THREE.Group(), out = { group: G, pts, ledLights: [], ledDiscs: [] };
  const lm = linerMaps(), S = lm.size;
  const mul = (c, f) => [c.r * f, c.g * f, c.b * f];

  // ── Vaso: solo caras interiores. Banda de sombra bajo la coronación y degradado hacia el fondo
  const mb = new MeshBuilder(); let cum = 0;
  const rows = [[0, mul(lc, 0.6)], [-0.2, mul(lc, 1.0)], [-D, mul(lc, 0.5)]];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]), want = new THREE.Vector3(-(b[1] - a[1]), 0, b[0] - a[0]);
    const idx = rows.map(([y, col]) => [mb.v(a[0], y, a[1], cum / S, -y / S, col), mb.v(b[0], y, b[1], (cum + len) / S, -y / S, col)]);
    for (let r = 0; r < rows.length - 1; r++) mb.quad(idx[r][0], idx[r][1], idx[r + 1][1], idx[r + 1][0], want);
    cum += len;
  }
  const floorCol = mul(lc, 0.5), ring = pts.map(([x, z]) => mb.v(x, -D, z, x / S, z / S, floorCol));
  THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []).forEach(([a, b, c]) => mb.tri(ring[a], ring[b], ring[c], up));
  const shell = new THREE.Mesh(mb.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, map: lm.map, normalMap: lm.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: liner.roughness, envMapIntensity: 0.5 }));
  shell.receiveShadow = true; G.add(shell);

  // ── Playa, escalera romana y escalera de esquina (mismo material que el vaso)
  const solid = new THREE.MeshStandardMaterial({ color: lc.clone().multiplyScalar(1.1), map: lm.map, normalMap: lm.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: liner.roughness });
  const place = (geo, x, y, z) => { const m = new THREE.Mesh(geo, solid); m.position.set(x, y, z); m.receiveShadow = true; G.add(m); };
  if (F.shelf) { const h = D + F.shelf.top - 0.01; place(boxUV(F.shelf.length, h, W - 0.02, S), (F.shelf.x0 + F.shelf.x1) / 2 - 0.005, F.shelf.top - h / 2, 0); }
  if (F.roman) F.roman.radii.forEach((r, k) => { const top = F.roman.tops[k], h = D + top - 0.01; place(cylUV(r, h, S), F.roman.cx, top - h / 2, F.roman.cz); });
  if (F.corner) F.corner.steps.forEach((s) => { const h = D + s.top - 0.01; place(boxUV(s.length, h, F.corner.width, S), F.corner.x + s.length / 2 + 0.005, s.top - h / 2, F.corner.z + F.corner.width / 2 + 0.01); });

  // ── Coronación (baldosa real): franja plana con canto exterior y labio hacia el agua
  const cm = copingMaps(coping.texture), outer = offsetPoly(pts, copW), inner = offsetPoly(pts, -0.03), H = 0.04, cb = new MeshBuilder(), CS = cm.size; let cu = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, oa = outer[i], ob = outer[j], ia = inner[i], ib = inner[j], len = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]);
    const u0 = cu / CS, u1 = (cu + len) / CS, vv = (copW + 0.03) / CS;
    cb.quad(cb.v(ia[0], H, ia[1], u0, 0), cb.v(oa[0], H, oa[1], u0, vv), cb.v(ob[0], H, ob[1], u1, vv), cb.v(ib[0], H, ib[1], u1, 0), up);
    const outN = new THREE.Vector3(ob[1] - oa[1], 0, -(ob[0] - oa[0]));
    cb.quad(cb.v(oa[0], H, oa[1], u0, 0), cb.v(ob[0], H, ob[1], u1, 0), cb.v(ob[0], 0, ob[1], u1, H / CS), cb.v(oa[0], 0, oa[1], u0, H / CS), outN);
    cb.quad(cb.v(ia[0], H, ia[1], u0, 0), cb.v(ib[0], H, ib[1], u1, 0), cb.v(ib[0], -0.06, ib[1], u1, (H + 0.06) / CS), cb.v(ia[0], -0.06, ia[1], u0, (H + 0.06) / CS), outN.clone().negate());
    cu += len;
  }
  const cmesh = new THREE.Mesh(cb.geometry(), new THREE.MeshStandardMaterial({ map: cm.map, normalMap: cm.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.85, envMapIntensity: 0.4 }));
  cmesh.castShadow = cmesh.receiveShadow = true; G.add(cmesh);

  // ── Volumen de agua: oscurece las paredes y el fondo con la profundidad (alfa 0 en la superficie → 0,55 abajo)
  const deep = new THREE.Color(liner.hex).lerp(new THREE.Color('#06324a'), 0.62), dc = [deep.r, deep.g, deep.b];
  const vb = new MeshBuilder(); let cv = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]), want = new THREE.Vector3(-(b[1] - a[1]), 0, b[0] - a[0]);
    const t0 = vb.v(a[0], -WATER_DROP, a[1], 0, 0, [...dc, 0]), t1 = vb.v(b[0], -WATER_DROP, b[1], 0, 0, [...dc, 0]), b1 = vb.v(b[0], -D, b[1], 0, 0, [...dc, 0.62]), b0 = vb.v(a[0], -D, a[1], 0, 0, [...dc, 0.62]);
    vb.quad(t0, t1, b1, b0, want); cv += len;
  }
  const vr = pts.map(([x, z]) => vb.v(x, -D + 0.002, z, 0, 0, [...dc, 0.62]));
  THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []).forEach(([a, b, c]) => vb.tri(vr[a], vr[b], vr[c], up));
  const volume = new THREE.Mesh(vb.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  volume.renderOrder = 1; G.add(volume); out.volume = volume;

  // ── Cáusticas animadas sobre el fondo
  const cmap = causticsTexture(), cc = new MeshBuilder(), cring = pts.map(([x, z]) => cc.v(x, -D + 0.006, z, x / 2.6, z / 2.6));
  THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []).forEach(([a, b, c]) => cc.tri(cring[a], cring[b], cring[c], up));
  const caustics = new THREE.Mesh(cc.geometry(), new THREE.MeshBasicMaterial({ map: cmap, color: 0xbfefff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  caustics.renderOrder = 1; G.add(caustics); out.caustics = caustics;

  // ── Superficie del agua con normales reales y movimiento suave
  const wm = waterMaps(); wm.normalMap.repeat.set(1 / wm.size, 1 / wm.size);
  const tint = lc.clone().multiplyScalar(0.5).lerp(new THREE.Color('#06425e'), 0.35); // agua más profunda que la lámina: oscurece en vez de aclarar
  const water = new THREE.Mesh(new THREE.ShapeGeometry(toShape(offsetPoly(pts, -0.02))),
    new THREE.MeshPhysicalMaterial({ color: tint, transparent: true, opacity: 0.42, roughness: 0.12, metalness: 0, envMapIntensity: 0.6, normalMap: wm.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), emissive: tint, emissiveIntensity: 0, depthWrite: false, clearcoat: 0.25, clearcoatRoughness: 0.12 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -WATER_DROP; water.renderOrder = 2; G.add(water); out.water = water; out.waterMaps = wm;

  // ── Focos LED en la pared del fondo
  if (cfg.extras.leds) {
    const count = ledCount(poolMetrics(cfg, copW), catalog), x0 = -L / 2 + 0.9, x1 = L / 2 - 0.9;
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? 0 : x0 + ((x1 - x0) * i) / (count - 1);
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaeeaff, emissiveIntensity: 0 }));
      d.position.set(x, -D * 0.55, -W / 2 + 0.012); G.add(d); out.ledDiscs.push(d);
    }
    const nl = Math.min(4, count);
    for (let i = 0; i < nl; i++) {
      const x = nl === 1 ? 0 : x0 + ((x1 - x0) * i) / (nl - 1), pl = new THREE.PointLight(0x9fe8ff, 0, 8, 1.4); pl.position.set(x, -D * 0.55, -W / 2 + 0.35); G.add(pl); out.ledLights.push(pl);
    }
  }

  // ── Ducha exterior
  if (cfg.extras.shower) {
    const sg = new THREE.Group(), chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 0.85, roughness: 0.25 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 12), chrome); pole.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 20), chrome); head.position.set(0.12, 2.2, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), chrome); arm.rotation.z = Math.PI / 2; arm.position.set(0.05, 2.2, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0x777b7d, roughness: 0.7 })); base.position.y = 0.03;
    [pole, head, arm, base].forEach((m) => { m.castShadow = true; sg.add(m); });
    sg.position.set(-L / 2 + 0.9, 0.012, W / 2 + copW + 1.1); G.add(sg); out.shower = sg;
  }

  out.applyLook = ({ led = 0, brightness = 1, caustics: cau = 1, glow = 0 } = {}) => {
    const on = cfg.extras.leds;
    out.ledLights.forEach((l) => { l.intensity = on ? 4 * led : 0; });
    out.ledDiscs.forEach((d) => { d.material.emissiveIntensity = on ? 0.4 + 2.2 * led : 0; });
    water.material.emissiveIntensity = on && led > 0 ? 0.55 * led : glow;
    volume.material.color.setScalar(brightness);
    caustics.material.opacity = 0.2 * cau * (on && led > 0 ? 1.6 : 1);
  };
  out.tick = (t) => { wm.normalMap.offset.set(t * 0.012, t * 0.008); cmap.offset.set(t * 0.018, -t * 0.012); };
  return out;
}
