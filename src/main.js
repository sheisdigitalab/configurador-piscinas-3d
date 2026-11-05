import { BRAND } from './config.js';
import { clampConfig } from './core/pool-math.js';
import { computeQuote } from './core/quote.js';
import { PoolScene } from './scene/pool-scene.js';
import { copingTexture } from './scene/textures.js';
import { buildQuotePdf, eur, num, specRows } from './export/pdf.js';

const $ = (s) => document.querySelector(s);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c)));
  return e;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }

const SHAPE_ICONS = {
  rect: '<svg viewBox="0 0 52 34" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="46" height="22" rx="4"/></svg>',
  ele: '<svg viewBox="0 0 52 34" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8a3 3 0 0 1 3-3h38a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H33v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/></svg>',
  playa: '<svg viewBox="0 0 52 34" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="46" height="22" rx="4"/><path d="M3 11a6 6 0 0 1 0 12M3 8a9 9 0 0 1 0 18" stroke-width="1.5"/><path d="M38 6v22" stroke-width="1.5" stroke-dasharray="3 3"/></svg>',
};
const AMBIENTS = [['day', 'Día'], ['dusk', 'Atardecer'], ['night', 'Noche']];

async function start() {
  $('#brandName').textContent = BRAND.name; $('#brandTag').textContent = BRAND.tagline;
  const catalog = await (await fetch('data/catalog.json')).json();
  const L = catalog.limits;
  const state = {
    shape: 'rect', length: L.length.default, width: L.width.default, depth: L.depth.default,
    liner: catalog.liners[0].id, coping: catalog.copings[0].id, extras: { stairs: false, leds: false, shower: false }, ambient: 'day',
  };

  const viewport = $('#viewport'), scene = new PoolScene($('#gl'), catalog);
  const fit = () => scene.resize(Math.max(50, viewport.clientWidth), Math.max(50, viewport.clientHeight));
  new ResizeObserver(fit).observe(viewport); fit();
  window.__app = { state, scene, catalog };

  /* ───── Forma ───── */
  const shapeBtns = {};
  catalog.shapes.forEach((s) => {
    const b = h('button', { class: 'opt', type: 'button', title: s.hint, 'aria-pressed': 'false', onclick: () => { state.shape = s.id; refresh(); } }, h('span', { html: SHAPE_ICONS[s.id] }), s.name);
    shapeBtns[s.id] = b; $('#shapes').append(b);
  });

  /* ───── Medidas: slider + campo numérico sincronizados ───── */
  const sizeCtl = {};
  [['length', 'Largo'], ['width', 'Ancho'], ['depth', 'Profundidad']].forEach(([key, label]) => {
    const lim = L[key], range = h('input', { type: 'range', min: lim.min, max: lim.max, step: lim.step, 'aria-label': label });
    const input = h('input', { type: 'number', min: lim.min, max: lim.max, step: lim.step, inputmode: 'decimal', 'aria-label': `${label} en metros` });
    const set = (v) => { state[key] = Math.min(lim.max, Math.max(lim.min, Math.round(v * 10) / 10)); refresh(); };
    range.addEventListener('input', () => set(parseFloat(range.value)));
    input.addEventListener('change', () => { const v = parseFloat(String(input.value).replace(',', '.')); set(Number.isFinite(v) ? v : lim.default); });
    sizeCtl[key] = { range, input };
    $('#sizes').append(h('div', { class: 'size' }, h('div', { class: 'row' }, h('span', {}, label), h('span', { class: 'num' }, input, 'm')), range));
  });

  /* ───── Revestimiento y coronación ───── */
  const linerBtns = {}, copBtns = {};
  catalog.liners.forEach((l) => {
    const chip = h('span', { class: 'chip' }); chip.style.background = l.hex;
    const b = h('button', { class: 'sw', type: 'button', 'aria-pressed': 'false', onclick: () => { state.liner = l.id; refresh(); } }, chip, h('span', { class: 't' }, l.name, h('small', {}, `${l.pricePerM2} €/m²`)));
    linerBtns[l.id] = b; $('#liners').append(b);
  });
  const preview = (kind) => { const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').drawImage(copingTexture(kind).image, 0, 0, 96, 96); return c.toDataURL('image/jpeg', 0.7); };
  catalog.copings.forEach((c) => {
    const chip = h('span', { class: 'chip' }); chip.style.backgroundImage = `url(${preview(c.texture)})`;
    const b = h('button', { class: 'sw', type: 'button', 'aria-pressed': 'false', onclick: () => { state.coping = c.id; refresh(); } }, chip, h('span', { class: 't' }, c.name, h('small', {}, `${c.pricePerMl} €/ml`)));
    copBtns[c.id] = b; $('#copings').append(b);
  });

  /* ───── Extras ───── */
  const exCtl = {};
  [['stairs', catalog.extras.stairs.name, () => `${catalog.extras.stairs.price} € · peldaños en una esquina`], ['leds', catalog.extras.leds.name, () => `${catalog.extras.leds.unitPrice} € por foco · se ven de noche`], ['shower', catalog.extras.shower.name, () => `${catalog.extras.shower.price} €`]].forEach(([key, name, sub]) => {
    const input = h('input', { type: 'checkbox' }), small = h('small', {}, sub());
    input.addEventListener('change', () => { state.extras[key] = input.checked; refresh(); });
    const row = h('label', { class: 'switch' }, h('span', { class: 't' }, name, small), input, h('span', { class: 'tog' }));
    exCtl[key] = { input, row, small, sub }; $('#extras').append(row);
  });

  /* ───── Ambiente ───── */
  const ambBtns = {};
  AMBIENTS.forEach(([id, label]) => { const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { state.ambient = id; scene.setAmbient(id); sync(); } }, label); ambBtns[id] = b; $('#ambient').append(b); });

  /* ───── Sincronización de la interfaz y la escena ───── */
  let quote = null, pending = false;
  function config() {
    const c = clampConfig(state, L);
    return { shape: c.shape, length: c.length, width: c.width, depth: c.depth, liner: c.liner, coping: c.coping, extras: { ...c.extras } };
  }
  function sync() {
    Object.entries(shapeBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.shape)));
    Object.entries(linerBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.liner)));
    Object.entries(copBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.coping)));
    Object.entries(ambBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.ambient)));
    ['length', 'width', 'depth'].forEach((k) => {
      if (document.activeElement !== sizeCtl[k].input) sizeCtl[k].input.value = state[k].toFixed(1);
      sizeCtl[k].range.value = state[k];
    });
    const roman = state.shape === 'playa';
    exCtl.stairs.input.checked = roman ? false : state.extras.stairs; exCtl.stairs.input.disabled = roman;
    exCtl.stairs.row.classList.toggle('off', roman);
    exCtl.stairs.small.textContent = roman ? 'Ya incluida en esta forma (escalera romana)' : exCtl.stairs.sub();
    exCtl.leds.input.checked = state.extras.leds; exCtl.shower.input.checked = state.extras.shower;
  }
  function renderQuote() {
    quote = computeQuote(config(), catalog); const m = quote.metrics;
    $('#qTotal').textContent = eur(quote.total);
    $('#qVat').textContent = `IVA ${Math.round(quote.vatRate * 100)} % incluido`;
    $('#qMetrics').innerHTML = `Lámina ${num(m.linerNet * catalog.wasteFactor, 1)} m²<br>Coronación ${num(m.copingMl, 1)} ml<br>Agua ${num(m.waterM3, 1)} m³`;
    const box = $('#qBreakdown'); box.innerHTML = ''; let g = '';
    quote.lines.forEach((l) => {
      if (l.group !== g) { g = l.group; box.append(h('div', { class: 'bd-group' }, g)); }
      box.append(h('div', { class: 'bd-row' }, h('span', {}, l.label), h('span', {}, eur(l.total))));
    });
    box.append(h('div', { class: 'bd-group' }, 'Totales'), h('div', { class: 'bd-row' }, h('span', {}, 'Subtotal'), h('span', {}, eur(quote.subtotal))), h('div', { class: 'bd-row' }, h('span', {}, `IVA ${Math.round(quote.vatRate * 100)} %`), h('span', {}, eur(quote.vat))));
  }
  function refresh() {
    sync(); renderQuote();
    if (!pending) { pending = true; setTimeout(() => { pending = false; scene.update(config()); }, 0); } // agrupa varios cambios seguidos en una sola reconstrucción
  }
  refresh(); scene.setAmbient(state.ambient);
  setTimeout(() => $('#loading').classList.add('hide'), 400);
  setTimeout(() => $('#hint').classList.add('hide'), 9000);
  $('#gl').addEventListener('pointerdown', () => $('#hint').classList.add('hide'), { once: true });

  /* ───── Imagen, presupuesto y PDF ───── */
  const stamp = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '');
  $('#btnImage').addEventListener('click', () => {
    const a = h('a', { href: scene.snapshot('image/jpeg', 0.93), download: `piscina-${stamp()}.jpg` });
    document.body.append(a); a.click(); a.remove(); toast('Imagen descargada');
  });

  const dlg = $('#dlg'); let current = null;
  $('#btnQuote').addEventListener('click', () => {
    const date = new Date(), cfg = config(), q = computeQuote(cfg, catalog);
    current = { cfg, quote: q, date, ref: `P-${stamp(date)}-${String(Math.floor(Math.random() * 900) + 100)}`, image: scene.snapshot('image/jpeg', 0.9) };
    $('#dlgImg').src = current.image;
    $('#dlgMeta').textContent = `${current.ref} · ${date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const specs = $('#dlgSpecs'); specs.innerHTML = '';
    specRows(cfg, q, catalog).forEach(([k, v]) => specs.append(h('dt', {}, k), h('dd', {}, v)));
    const t = $('#dlgTable'); t.innerHTML = '';
    t.append(h('thead', {}, h('tr', {}, h('th', {}, 'Concepto'), h('th', {}, 'Cantidad'), h('th', {}, 'Precio'), h('th', {}, 'Importe'))));
    const tb = h('tbody'); let g = '';
    q.lines.forEach((l) => {
      if (l.group !== g) { g = l.group; tb.append(h('tr', { class: 'grp' }, h('td', { colspan: '4' }, g))); }
      tb.append(h('tr', {}, h('td', {}, l.label), h('td', {}, `${num(l.qty)} ${l.unit}`), h('td', {}, eur(l.unitPrice)), h('td', {}, eur(l.total))));
    });
    t.append(tb);
    $('#dlgTotals').innerHTML = '';
    $('#dlgTotals').append(h('div', {}, h('span', {}, 'Subtotal'), h('span', {}, eur(q.subtotal))), h('div', {}, h('span', {}, `IVA (${Math.round(q.vatRate * 100)} %)`), h('span', {}, eur(q.vat))), h('div', { class: 'grand' }, h('span', {}, 'Total'), h('span', {}, eur(q.total))));
    dlg.showModal();
  });
  const close = () => dlg.close();
  $('#dlgClose').addEventListener('click', close); $('#dlgClose2').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  $('#btnPdf').addEventListener('click', () => {
    if (!current || !window.jspdf) { toast('No se pudo generar el PDF'); return; }
    const doc = buildQuotePdf(window.jspdf.jsPDF, { brand: BRAND, imageDataUrl: current.image, imageRatio: scene.canvas.clientHeight / scene.canvas.clientWidth, cfg: current.cfg, quote: current.quote, catalog, date: current.date, ref: current.ref });
    doc.save(`presupuesto-${current.ref}.pdf`); toast('PDF descargado');
  });
}

start().catch((e) => { console.error(e); const l = document.getElementById('loading'); if (l) l.textContent = 'No se pudo cargar el configurador: ' + e.message; });
