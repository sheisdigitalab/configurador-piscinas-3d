import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, project, orderCorners, solveHomography, applyH, isConvexQuad } from '../src/core/perspective.js';

const W = 1600, H = 1200;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
// Cámara de referencia: centro C mirando a "target"; devuelve una pose con la misma forma que la calibrada.
function camera(C, target, f) {
  const fw = unit(target.map((v, i) => v - C[i])), right = unit(cross(fw, [0, 1, 0])), down = cross(fw, right);
  const R = [right, down, fw], t = R.map((r) => -(r[0] * C[0] + r[1] * C[1] + r[2] * C[2]));
  return { R, t, f, cx: W / 2, cy: H / 2, C };
}
const rect = (hx, hz) => [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
const shot = (cam, hx, hz) => rect(hx, hz).map(([x, z]) => project(cam, [x, 0, z]).slice(0, 2));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('recupera focal, centro de cámara y reproyección sin ruido', () => {
  const cam = camera([1.5, 3.2, 9], [0, 0, 0], 1250), pts = shot(cam, 4.35, 2.35);
  const r = calibrate(pts, 4.35, 2.35, W, H);
  assert.ok(r.ok, r.reason); assert.notEqual(r.focalSource, 'por defecto');
  near(r.pose.f, 1250, 12, 'focal'); // ±1 %
  r.pose.C.forEach((v, i) => near(v, cam.C[i], 0.05, 'centro ' + i));
  assert.ok(r.error < 1e-3, 'error de reproyección ' + r.error);
});
test('con ruido de 1,5 px el error de reproyección sigue siendo pequeño', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const cam = camera([-2, 2.8, 8], [0.5, 0, 0], 1100), pts = shot(cam, 4.35, 2.35).map(([u, v]) => [u + rnd() * 3, v + rnd() * 3]);
  const r = calibrate(pts, 4.35, 2.35, W, H); assert.ok(r.ok, r.reason);
  assert.ok(r.error < 6, 'error ' + r.error);
  // un punto cualquiera del suelo dentro del rectángulo debe caer cerca de donde lo proyecta la cámara real
  const q = project(r.pose, [1, 0, 0.5]), qt = project(cam, [1, 0, 0.5]); assert.ok(Math.hypot(q[0] - qt[0], q[1] - qt[1]) < 15, 'punto interior desviado');
});
test('el orden de los puntos no importa', () => {
  const cam = camera([0, 3, 9], [0, 0, 0], 1200), pts = shot(cam, 4, 2);
  const shuffled = [pts[2], pts[0], pts[3], pts[1]];
  const a = calibrate(pts, 4, 2, W, H), b = calibrate(shuffled, 4, 2, W, H);
  assert.ok(a.ok && b.ok); near(a.pose.f, b.pose.f, 1e-6, 'focal');
  assert.deepEqual(orderCorners(shuffled), orderCorners(pts));
});
test('sin perspectiva apreciable usa la focal por defecto y sigue calibrando', () => {
  const cam = camera([0, 40, 0.0001], [0, 0, 0], 1200), pts = shot(cam, 4, 2);
  const r = calibrate(pts, 4, 2, W, H); assert.ok(r.ok, r.reason);
  assert.equal(r.focalSource, 'por defecto'); assert.ok(r.pose.C[1] > 0);
});
test('al cambiar las medidas con la cámara fija, la proyección coincide con la de una cámara real', () => {
  const cam = camera([1, 3, 10], [0, 0, 0], 1300), r = calibrate(shot(cam, 4.35, 2.35), 4.35, 2.35, W, H);
  const big = project(r.pose, [6, 0, 3.5]), ref = project(cam, [6, 0, 3.5]);
  assert.ok(Math.hypot(big[0] - ref[0], big[1] - ref[1]) < 1, 'esquina ampliada desviada');
});
test('cuadriláteros inválidos se rechazan', () => {
  assert.equal(calibrate([[0, 0], [1, 1], [2, 2]], 1, 1, W, H).ok, false);
  assert.equal(isConvexQuad([[0, 0], [10, 10], [10, 0], [0, 10]]), false);
  assert.equal(calibrate([[100, 100], [101, 100], [102, 100], [103, 100]], 1, 1, W, H).ok, false);
});
test('homografía exacta en 4 puntos', () => {
  const plane = rect(2, 1), img = [[100, 200], [500, 180], [560, 400], [60, 420]], Hm = solveHomography(plane, img);
  plane.forEach((p, i) => { const q = applyH(Hm, p[0], p[1]); near(q[0], img[i][0], 1e-6, 'u'); near(q[1], img[i][1], 1e-6, 'v'); });
});
