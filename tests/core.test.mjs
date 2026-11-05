import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { poolOutline, polygonArea, perimeter, offsetPoly, poolMetrics, poolFeatures, clampConfig } from '../src/core/pool-math.js';
import { computeQuote, ledCount } from '../src/core/quote.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url)));
const base = { shape: 'rect', length: 8, width: 4, depth: 1.5, liner: 'bruma', coping: 'piedra-clara', extras: { stairs: false, leds: false, shower: false } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('rectangular: área y perímetro cercanos a los analíticos', () => {
  const pts = poolOutline(base);
  near(polygonArea(pts), 8 * 4, 0.1, 'área');       // 32 menos esquinas redondeadas
  near(perimeter(pts), 2 * (8 + 4), 0.5, 'perímetro'); // 24 menos esquinas
});
test('en L: área = rectángulo menos la muesca', () => {
  const pts = poolOutline({ ...base, shape: 'ele' });
  near(polygonArea(pts), 8 * 4 - 3.2 * 2, 0.3, 'área L'); // 25.6
});
test('lámina: fondo + paredes', () => {
  const m = poolMetrics(base);
  near(m.linerNet, 32 + 24 * 1.5, 1.5, 'lámina bruta'); // 68 m²
  near(m.copingMl, 22.4 + 2 * Math.PI * (0.2 + 0.175), 0.1, 'coronación'); // tramos rectos + arcos de radio 0,375
});
test('offset conserva el número de puntos y crece el área', () => {
  const pts = poolOutline(base), out = offsetPoly(pts, 0.35);
  assert.equal(out.length, pts.length);
  near(polygonArea(out), (8 + 0.7) * (4 + 0.7), 0.4, 'área exterior');
});
test('presupuesto: totales coherentes', () => {
  const q = computeQuote(base, catalog);
  const suma = q.lines.reduce((a, l) => a + l.total, 0);
  near(suma, q.subtotal, 0.05, 'suma de líneas');
  near(q.total, q.subtotal * 1.21, 0.02, 'IVA 21 %');
  for (const l of q.lines) near(l.total, l.qty * l.unitPrice, 0.02, l.label);
});
test('extras suman y los focos escalan con el área', () => {
  const a = computeQuote(base, catalog), b = computeQuote({ ...base, extras: { stairs: true, leds: true, shower: true } }, catalog);
  const n = ledCount(b.metrics, catalog);
  assert.equal(n, Math.ceil(b.metrics.surfaceArea / 10));
  near(b.subtotals.extras, 780 + n * 145 + 320, 0.01, 'extras');
  assert.ok(b.total > a.total);
});
test('playa: precio fijo, recargo y sin escalera de esquina duplicada', () => {
  const q = computeQuote({ ...base, shape: 'playa', extras: { stairs: true, leds: false, shower: false } }, catalog);
  assert.ok(q.lines.some((l) => /playa y escalera romana/i.test(l.label)));
  assert.ok(q.lines.some((l) => /Recargo por forma/.test(l.label)));
  assert.equal(q.subtotals.extras, 0);
  const f = poolFeatures({ ...base, shape: 'playa', extras: { stairs: true } });
  assert.ok(f.shelf && f.roman && !f.corner);
});
test('más profundidad cuesta más; límites se respetan', () => {
  assert.ok(computeQuote({ ...base, depth: 2.2 }, catalog).total > computeQuote(base, catalog).total);
  const c = clampConfig({ ...base, length: 99, width: -1, depth: NaN }, catalog.limits);
  assert.deepEqual([c.length, c.width, c.depth], [15, 2, 1.5]);
});
test('los 6 acabados y 3 coronaciones existen y no mencionan marcas', () => {
  assert.equal(catalog.liners.length, 6); assert.equal(catalog.copings.length, 3);
  assert.ok(!/renolit|alkorplan/i.test(JSON.stringify(catalog)));
});
