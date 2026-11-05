// Cálculo del presupuesto. Sin dependencias de Three.js ni del DOM.
import { poolMetrics } from './pool-math.js';

const r2 = (v) => Math.round(v * 100) / 100;
const byId = (list, id) => list.find((x) => x.id === id) || list[0];

export function ledCount(metrics, catalog) {
  const e = catalog.extras.leds;
  return Math.max(e.min, Math.ceil(metrics.surfaceArea / e.areaPerUnit));
}

// cfg: { shape, length, width, depth, liner, coping, extras: { stairs, leds, shower } }
export function computeQuote(cfg, catalog) {
  const m = poolMetrics(cfg, catalog.copingWidth);
  const shape = byId(catalog.shapes, cfg.shape);
  const liner = byId(catalog.liners, cfg.liner);
  const coping = byId(catalog.copings, cfg.coping);
  const lab = catalog.labour;
  const lines = [];
  // El total sale de la cantidad ya redondeada, para que cantidad × precio coincida con lo que se muestra.
  const add = (group, label, qty, unit, unitPrice) => { const q = r2(qty); lines.push({ group, label, qty: q, unit, unitPrice, total: r2(q * unitPrice) }); };

  const linerQty = m.linerNet * catalog.wasteFactor;
  add('Materiales', `Lámina ${liner.name} (incluye ${Math.round((catalog.wasteFactor - 1) * 100)} % de merma)`, linerQty, 'm²', liner.pricePerM2);
  add('Materiales', `Coronación ${coping.name}`, m.copingMl, 'ml', coping.pricePerMl);
  if (shape.fixedPrice) add('Materiales', shape.fixedLabel, 1, 'ud', shape.fixedPrice);

  const ex = cfg.extras || {};
  if (ex.stairs && cfg.shape !== 'playa') add('Extras', catalog.extras.stairs.name, 1, 'ud', catalog.extras.stairs.price);
  if (ex.leds) add('Extras', catalog.extras.leds.name, ledCount(m, catalog), 'ud', catalog.extras.leds.unitPrice);
  if (ex.shower) add('Extras', catalog.extras.shower.name, 1, 'ud', catalog.extras.shower.price);

  const labourBase = [
    ['Excavación y retirada de tierras', m.excavationM3, 'm³', lab.excavationPerM3],
    ['Instalación de lámina', m.linerNet, 'm²', lab.linerInstallPerM2],
    ['Colocación de coronación', m.copingMl, 'ml', lab.copingInstallPerMl],
    ['Replanteo, montaje y puesta en marcha', 1, 'ud', lab.baseFixed],
  ];
  let labourSubtotal = 0;
  labourBase.forEach(([label, q, u, p]) => { add('Mano de obra estimada', label, q, u, p); labourSubtotal += lines[lines.length - 1].total; });
  if (shape.labourFactor > 1) {
    const pct = Math.round((shape.labourFactor - 1) * 100);
    lines.push({ group: 'Mano de obra estimada', label: `Recargo por forma ${shape.name} (+${pct} %)`, qty: 1, unit: 'ud', unitPrice: r2(labourSubtotal * (shape.labourFactor - 1)), total: r2(labourSubtotal * (shape.labourFactor - 1)) });
  }

  const sum = (g) => r2(lines.filter((l) => l.group === g).reduce((a, l) => a + l.total, 0));
  const subtotals = { materials: sum('Materiales'), extras: sum('Extras'), labour: sum('Mano de obra estimada') };
  const subtotal = r2(subtotals.materials + subtotals.extras + subtotals.labour);
  const vat = r2(subtotal * catalog.vat);
  return { metrics: m, lines, subtotals, subtotal, vat, vatRate: catalog.vat, total: r2(subtotal + vat), currency: catalog.currency };
}
