// Geometría y medidas de la piscina. Sin dependencias: se reutiliza en la app móvil.
// Los puntos son [x, z] en metros, ordenados en sentido antihorario (x a la derecha, z hacia arriba).

export function roundPoly(P, r, seg = 6) {
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
    let d1 = [a[0] - b[0], a[1] - b[1]], d2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    d1 = [d1[0] / l1, d1[1] / l1]; d2 = [d2[0] / l2, d2[1] / l2];
    const k = Math.min(r, l1 / 2, l2 / 2);
    const p1 = [b[0] + d1[0] * k, b[1] + d1[1] * k], p2 = [b[0] + d2[0] * k, b[1] + d2[1] * k];
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, u = 1 - t;
      out.push([u * u * p1[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
  }
  return out;
}

// Desplaza cada vértice hacia fuera (t > 0) o hacia dentro (t < 0) conservando el número de puntos.
export function offsetPoly(P, t) {
  const n = P.length;
  return P.map((b, i) => {
    const a = P[(i + n - 1) % n], c = P[(i + 1) % n];
    const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const e1 = norm([b[0] - a[0], b[1] - a[1]]), e2 = norm([c[0] - b[0], c[1] - b[1]]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    let m = [n1[0] + n2[0], n1[1] + n2[1]];
    m = Math.hypot(...m) > 1e-6 ? norm(m) : n2;
    const cos = Math.max(0.5, m[0] * n2[0] + m[1] * n2[1]);
    return [b[0] + (m[0] * t) / cos, b[1] + (m[1] * t) / cos];
  });
}

export function polygonArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

export function perimeter(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return s;
}

export function clampConfig(cfg, limits) {
  const c = (v, l) => Math.min(l.max, Math.max(l.min, Number.isFinite(v) ? v : l.default));
  return { ...cfg, length: c(cfg.length, limits.length), width: c(cfg.width, limits.width), depth: c(cfg.depth, limits.depth) };
}

// Contorno del vaso en la superficie.
export function poolOutline(cfg) {
  const L = cfg.length, W = cfg.width;
  if (cfg.shape === 'ele') {
    const nL = L * 0.4, nW = W * 0.5; // muesca (esquina delantera derecha)
    return roundPoly([[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2 - nW], [L / 2 - nL, W / 2 - nW], [L / 2 - nL, W / 2], [-L / 2, W / 2]], 0.25);
  }
  return roundPoly([[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]], 0.2);
}

// Elementos interiores: playa, escalera romana y escalera de esquina.
export function poolFeatures(cfg) {
  const L = cfg.length, W = cfg.width, D = cfg.depth;
  const stepsFor = () => Math.max(1, Math.min(3, Math.floor((D - 0.3) / 0.3)));
  const f = { shelf: null, roman: null, corner: null };
  if (cfg.shape === 'playa') {
    const sL = Math.min(2.4, L * 0.28);
    f.shelf = { x0: L / 2 - sL, x1: L / 2, top: -0.35, length: sL };
    const n = stepsFor(), rmax = W / 2 - 0.2, radii = [], tops = [];
    for (let k = 0; k < n; k++) { radii.push(Math.min(rmax, 0.6 + 0.38 * k)); tops.push(-0.3 * (k + 1)); }
    f.roman = { cx: -L / 2, cz: 0, radii, tops };
  } else if (cfg.extras && cfg.extras.stairs) {
    const n = stepsFor(), steps = [];
    for (let k = 0; k < n; k++) steps.push({ length: 0.3 * (k + 1), top: -0.3 * (k + 1) });
    f.corner = { x: -L / 2, z: -W / 2, width: 1.2, steps };
  }
  return f;
}

// Medidas derivadas. La superficie de lámina es una estimación de patrón de corte (±5 %).
export function poolMetrics(cfg, copingWidth = 0.35) {
  const D = cfg.depth, pts = poolOutline(cfg), F = poolFeatures(cfg);
  const area = polygonArea(pts), per = perimeter(pts);
  const floor = area;
  let walls = per * D, extra = 0;
  if (F.shelf) walls -= 2 * F.shelf.length * (D - 0.35);
  if (F.roman) {
    const R = F.roman.radii;
    R.forEach((r) => { extra += Math.PI * r * 0.3; });
    walls -= 2 * R[R.length - 1] * (D - 0.3) * 0.5;
  }
  if (F.corner) F.corner.steps.forEach(() => { extra += F.corner.width * 0.3; });
  const linerNet = floor + walls + extra;
  const copingMl = perimeter(offsetPoly(pts, copingWidth / 2));
  const excavationM3 = (area + per * 0.6) * (D + 0.2);
  const waterM3 = area * (D - 0.12) * 0.97;
  return {
    surfaceArea: round(area), perimeter: round(per), floorArea: round(floor), wallArea: round(walls), extraArea: round(extra),
    linerNet: round(linerNet), copingMl: round(copingMl), excavationM3: round(excavationM3), waterM3: round(waterM3),
  };
}

function round(v) { return Math.round(v * 100) / 100; }
