// Calibración de cámara a partir de 4 puntos del suelo que forman un rectángulo de medidas conocidas.
// Sin dependencias (reutilizable en la app móvil). Convenciones:
//  - Mundo: x a la derecha, y arriba, z hacia la cámara. El suelo es y = 0.
//  - Imagen: píxeles (u, v) con v hacia abajo; el punto principal es el centro de la imagen.
//  - Cámara "CV": x derecha, y abajo, z hacia delante (la de OpenCV).

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => scale(a, 1 / norm(a));

function solveLinear(A, b) { // eliminación gaussiana con pivote parcial
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

function normalizer(pts) { // Hartley: centra y escala para que la distancia media sea √2
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const d = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length || 1, s = Math.SQRT2 / d;
  return { s, cx, cy, T: [[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]] };
}
const mul3 = (A, B) => A.map((_, i) => B[0].map((__, j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));
const inv3 = (m) => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]].map((r) => r.map((v) => v / det));
};

// H (3×3) con [u v 1]ᵀ ∝ H [X Z 1]ᵀ, a partir de 4 correspondencias plano → imagen.
export function solveHomography(plane, image) {
  const ns = normalizer(plane), nd = normalizer(image), A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const x = (plane[i][0] - ns.cx) * ns.s, y = (plane[i][1] - ns.cy) * ns.s, u = (image[i][0] - nd.cx) * nd.s, v = (image[i][1] - nd.cy) * nd.s;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b); if (!h) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]], Ti = inv3(nd.T);
  return Ti ? mul3(Ti, mul3(Hn, ns.T)) : null;
}

export function applyH(H, x, y) { const w = H[2][0] * x + H[2][1] * y + H[2][2]; return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w]; }

// Distancia focal (en píxeles) deducida de que los dos ejes del rectángulo son perpendiculares y de igual escala.
export function estimateFocal(H, cx, cy) {
  const C = mul3([[1, 0, -cx], [0, 1, -cy], [0, 0, 1]], H), h1 = [C[0][0], C[1][0], C[2][0]], h2 = [C[0][1], C[1][1], C[2][1]];
  const out = [], den1 = h1[2] * h2[2], den2 = h2[2] ** 2 - h1[2] ** 2;
  const s1 = (h1[2] * h2[2]) !== 0 ? -(h1[0] * h2[0] + h1[1] * h2[1]) / den1 : NaN;
  const s2 = den2 !== 0 ? ((h1[0] ** 2 + h1[1] ** 2) - (h2[0] ** 2 + h2[1] ** 2)) / den2 : NaN;
  const ref = Math.hypot(h1[0], h1[1], h2[0], h2[1]) ** 2 || 1;
  // se descartan las estimaciones mal condicionadas (casi sin perspectiva)
  if (Number.isFinite(s1) && s1 > 0 && Math.abs(den1) * ref > 1e-9 * ref * ref) out.push(Math.sqrt(s1));
  if (Number.isFinite(s2) && s2 > 0 && Math.abs(den2) * ref > 1e-9 * ref * ref) out.push(Math.sqrt(s2));
  return out;
}

// Pose de la cámara (suelo y = 0) a partir de H y la focal. Devuelve R (columnas = ejes del mundo en la cámara CV), t y el centro C.
export function poseFromHomography(H, f, cx, cy) {
  const Ki = [[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]], M = mul3(Ki, H);
  const m1 = [M[0][0], M[1][0], M[2][0]], m2 = [M[0][1], M[1][1], M[2][1]], m3 = [M[0][2], M[1][2], M[2][2]];
  let lam = 2 / (norm(m1) + norm(m2));
  let r1 = scale(m1, lam), r2 = scale(m2, lam), t = scale(m3, lam);
  if (t[2] < 0) { r1 = scale(r1, -1); r2 = scale(r2, -1); t = scale(t, -1); } // el plano debe quedar delante de la cámara
  const rx = unit(r1), rz = unit(sub(r2, scale(rx, dot(r2, rx)))), ry = cross(rz, rx);
  const R = [[rx[0], ry[0], rz[0]], [rx[1], ry[1], rz[1]], [rx[2], ry[2], rz[2]]];
  const C = scale([dot(rx, t), dot(ry, t), dot(rz, t)], -1);
  return { R, t, C, f, cx, cy };
}

export function project(pose, p) {
  const { R, t, f, cx, cy } = pose;
  const x = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0], y = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1], z = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2];
  return [cx + (f * x) / z, cy + (f * y) / z, z];
}

// Ordena 4 puntos como [fondo-izq, fondo-der, cerca-der, cerca-izq] (en la imagen, v crece hacia abajo).
export function orderCorners(pts) {
  const s = [...pts].sort((a, b) => a[1] - b[1]), far = s.slice(0, 2).sort((a, b) => a[0] - b[0]), near = s.slice(2).sort((a, b) => a[0] - b[0]);
  return [far[0], far[1], near[1], near[0]];
}

export function isConvexQuad(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) return false; if (sign && Math.sign(z) !== sign) return false; sign = Math.sign(z);
  }
  return true;
}


// Refina pose y focal minimizando el error de reproyección de las 4 esquinas (Levenberg–Marquardt, jacobiano numérico).
function rodrigues(r) {
  const th = Math.hypot(r[0], r[1], r[2]); if (th < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const k = [r[0] / th, r[1] / th, r[2] / th], c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [[c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s], [k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s], [k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v]];
}
function refinePose(pose0, world, img, cx, cy, fMin, fMax) {
  const R0 = pose0.R, build = (p) => { const dR = rodrigues([p[0], p[1], p[2]]), R = mul3(dR, R0), t = [pose0.t[0] + p[3], pose0.t[1] + p[4], pose0.t[2] + p[5]], f = pose0.f * Math.exp(p[6]); return { R, t, f, cx, cy }; };
  const resid = (p) => { const ps = build(p); const o = []; world.forEach((w, i) => { const q = project(ps, [w[0], 0, w[1]]); o.push(q[0] - img[i][0], q[1] - img[i][1]); }); return o; };
  const cost = (r) => r.reduce((a, v) => a + v * v, 0);
  let p = [0, 0, 0, 0, 0, 0, 0], r = resid(p), c = cost(r), lam = 1e-2;
  for (let it = 0; it < 60; it++) {
    const J = p.map((_, j) => { const q = [...p]; const e = j < 3 ? 1e-6 : j < 6 ? 1e-5 : 1e-6; q[j] += e; return resid(q).map((v, i) => (v - r[i]) / e); }); // J[j][i]
    const A = p.map((_, a) => p.map((__, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0))), g = p.map((_, a) => -J[a].reduce((s, v, i) => s + v * r[i], 0));
    const Ad = A.map((row, i) => row.map((v, j) => v + (i === j ? lam * (v + 1e-9) : 0))), d = solveLinear(Ad, g); if (!d) break;
    const q = p.map((v, i) => v + d[i]), rq = resid(q), cq = cost(rq), pq = build(q);
    if (cq < c && pq.f >= fMin && pq.f <= fMax) { p = q; r = rq; c = cq; lam = Math.max(lam / 3, 1e-9); if (Math.sqrt(c) < 1e-4) break; } else { lam *= 4; if (lam > 1e9) break; }
  }
  const pose = build(p), Rt = pose.R, C = scale([dot([Rt[0][0], Rt[1][0], Rt[2][0]], pose.t), dot([Rt[0][1], Rt[1][1], Rt[2][1]], pose.t), dot([Rt[0][2], Rt[1][2], Rt[2][2]], pose.t)], -1);
  return { ...pose, C };
}

// FOV por defecto de un móvil (~66° en el lado largo): f ≈ 0,77 × lado largo.
export const defaultFocal = (w, h) => 0.77 * Math.max(w, h);

/**
 * Calibra la cámara. points: 4 puntos de imagen (cualquier orden); halfX/halfZ: semidimensiones reales (m) del rectángulo.
 * Devuelve { ok, pose, corners, focalSource, error } o { ok:false, reason }.
 */
export function calibrate(points, halfX, halfZ, width, height) {
  if (!points || points.length !== 4) return { ok: false, reason: 'Hacen falta 4 puntos.' };
  const img = orderCorners(points);
  if (!isConvexQuad(img)) return { ok: false, reason: 'Los puntos deben formar un cuadrilátero sin cruzarse.' };
  const world = [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]];
  const H = solveHomography(world, img); if (!H) return { ok: false, reason: 'No se pudo calcular la perspectiva con esos puntos.' };
  const cx = width / 2, cy = height / 2, M = Math.max(width, height), fd = defaultFocal(width, height);
  const reproj = (pose) => Math.max(...world.map((w, i) => { const p = project(pose, [w[0], 0, w[1]]); return Math.hypot(p[0] - img[i][0], p[1] - img[i][1]); }));
  // La focal se elige como la que mejor reproduce las 4 esquinas dentro de un rango razonable de móvil/cámara (≈30°–95° de campo),
  // con un pequeño sesgo hacia la focal típica. Los puntos de fuga dan además un candidato (más preciso si los puntos son buenos).
  const lo = 0.5 * M, hi = 1.8 * M, cands = [fd, ...estimateFocal(H, cx, cy).filter((f) => f >= lo && f <= hi)];
  for (let i = 0; i <= 140; i++) cands.push(lo * Math.pow(hi / lo, i / 140));
  let best = null;
  for (const f of cands) {
    const pose = poseFromHomography(H, f, cx, cy); if (!(pose.C[1] > 0)) continue;
    const err = reproj(pose), score = err + 4 * Math.abs(Math.log(f / fd));
    if (!best || score < best.score) best = { f, pose, err, score };
  }
  if (!best) return { ok: false, reason: 'La cámara quedaría bajo el suelo: revisa el orden de los puntos.' };
  let pose = best.pose, err = best.err;
  try { const rp = refinePose(best.pose, world, img, cx, cy, lo, hi), e2 = reproj(rp); if (rp.C[1] > 0 && e2 < err) { pose = rp; err = e2; } } catch (e) { /* se mantiene la pose sin refinar */ }
  const focalSource = Math.abs(pose.f - fd) < 1e-6 ? 'por defecto' : 'ajustada';
  return { ok: true, pose, corners: img, world, focalSource, error: err, H };
}
