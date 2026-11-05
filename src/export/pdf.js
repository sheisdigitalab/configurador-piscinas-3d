// Genera el PDF del presupuesto. Recibe la clase jsPDF por parámetro para poder probarlo en Node.
export const eur = (v) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v);
export const num = (v, d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

export const SHAPE_NAMES = { rect: 'Rectangular', ele: 'En L', playa: 'Rectangular con playa y escalera romana' };

export function specRows(cfg, quote, catalog) {
  const liner = catalog.liners.find((l) => l.id === cfg.liner) || catalog.liners[0];
  const coping = catalog.copings.find((c) => c.id === cfg.coping) || catalog.copings[0];
  const m = quote.metrics, ex = cfg.extras, extras = [];
  if (ex.stairs && cfg.shape !== 'playa') extras.push(catalog.extras.stairs.name);
  if (ex.leds) extras.push(catalog.extras.leds.name);
  if (ex.shower) extras.push(catalog.extras.shower.name);
  return [
    ['Forma', SHAPE_NAMES[cfg.shape] || cfg.shape],
    ['Medidas', `${num(cfg.length, 1)} × ${num(cfg.width, 1)} m, ${num(cfg.depth, 1)} m de profundidad`],
    ['Superficie del vaso', `${num(m.surfaceArea)} m²`],
    ['Volumen de agua', `${num(m.waterM3, 1)} m³`],
    ['Revestimiento', liner.name],
    ['Coronación', coping.name],
    ['Extras', extras.length ? extras.join(', ') : 'Ninguno'],
  ];
}

export function buildQuotePdf(JsPDF, { brand, imageDataUrl, imageRatio = 0.6, cfg, quote, catalog, date = new Date(), ref = 'P-0000' }) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, W = 210, usable = W - 2 * M;
  const hex = (brand.accent || '#0b7a85').replace('#', ''), rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let y = 0;

  doc.setFillColor(...rgb); doc.rect(0, 0, W, 22, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(brand.name, M, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Presupuesto ${ref}`, W - M, 10, { align: 'right' });
  doc.text(date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }), W - M, 16, { align: 'right' });
  y = 32;

  doc.setTextColor(20, 34, 38); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Presupuesto estimado de piscina', M, y); y += 7;

  if (imageDataUrl) {
    const h = Math.min(usable * imageRatio, 62), w = h / imageRatio; // conserva la proporción y deja sitio a los totales
    doc.addImage(imageDataUrl, 'JPEG', M + (usable - w) / 2, y, w, h); y += h + 6;
  }

  doc.setFontSize(10);
  specRows(cfg, quote, catalog).forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold'); doc.text(k, M, y);
    doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(String(v), usable - 48), M + 48, y);
    y += 5.2;
  });
  y += 3;

  const header = () => {
    doc.setFillColor(238, 243, 244); doc.rect(M, y - 4.5, usable, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(20, 34, 38);
    doc.text('Concepto', M + 2, y); doc.text('Cantidad', M + 112, y, { align: 'right' }); doc.text('Precio', M + 142, y, { align: 'right' }); doc.text('Importe', M + usable - 2, y, { align: 'right' });
    y += 6;
  };
  header();
  let group = '';
  quote.lines.forEach((l) => {
    if (y > 268) { doc.addPage(); y = 20; header(); }
    if (l.group !== group) {
      group = l.group; doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...rgb); doc.text(group, M + 2, y); y += 5;
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(20, 34, 38);
    const label = doc.splitTextToSize(l.label, 88);
    doc.text(label, M + 2, y);
    doc.text(`${num(l.qty)} ${l.unit}`, M + 112, y, { align: 'right' });
    doc.text(eur(l.unitPrice), M + 142, y, { align: 'right' });
    doc.text(eur(l.total), M + usable - 2, y, { align: 'right' });
    y += 4.6 * label.length + 0.8;
  });

  if (y > 262) { doc.addPage(); y = 20; }
  y += 3; doc.setDrawColor(200, 210, 212); doc.line(M + 100, y - 2, M + usable, y - 2);
  const row = (k, v, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 12 : 10);
    doc.text(k, M + 100, y + 3); doc.text(v, M + usable - 2, y + 3, { align: 'right' }); y += bold ? 8 : 6;
  };
  row('Subtotal', eur(quote.subtotal));
  row(`IVA (${Math.round(quote.vatRate * 100)} %)`, eur(quote.vat));
  row('Total', eur(quote.total), true);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 105, 110);
  doc.text(doc.splitTextToSize('Presupuesto orientativo con precios de ejemplo. Las cantidades son estimaciones a partir del diseño 3D y pueden variar tras la visita técnica y el replanteo en obra. Validez: 30 días.', usable), M, 285);
  return doc;
}
