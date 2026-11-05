import { BRAND } from './config.js';
import { clampConfig } from './core/pool-math.js';
import { computeQuote } from './core/quote.js';
import { calibrate } from './core/perspective.js';
import { PoolScene } from './scene/pool-scene.js';
import { PhotoScene, PHOTO_AMBIENTS } from './scene/photo-scene.js';
import { copingTexture, loadRealTextures } from './scene/textures.js';
import { buildQuotePdf, eur, num, specRows } from './export/pdf.js';
import { SAMPLES } from './samples.js';

const $ = (s) => document.querySelector(s);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c)));
  return e;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }

const SHAPE_ICONS = {
  rect: '<svg viewBox="0 0 52 34" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="46" height="22" rx="4"/></svg>',
  ele: '<svg viewBox="0 0 52 34" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8a3 3 0 0 1 3-3h38a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H33v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/></svg>',
  playa: '<svg viewBox="0 0 52 34" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="46" height="22" rx="4"/><path d="M3 11a6 6 0 0 1 0 12M3 8a9 9 0 0 1 0 18" stroke-width="1.5"/><path d="M38 6v22" stroke-width="1.5" stroke-dasharray="3 3"/></svg>',
};
const AMBIENTS = [['day', 'Día'], ['dusk', 'Atardecer'], ['night', 'Noche']];
const MAX_PHOTO = 1800; // lado largo máximo con el que se trabaja

async function start() {
  performance.mark('inicio');
  $('#brandName').textContent = BRAND.name; $('#brandTag').textContent = BRAND.tagline;
  const catalog = await (await fetch('data/catalog.json')).json();
  await loadRealTextures(); performance.mark('texturas');
  const L = catalog.limits, copW = catalog.copingWidth;
  const state = {
    mode: 'photo', shape: 'rect', length: L.length.default, width: L.width.default, depth: L.depth.default,
    liner: catalog.liners[0].id, coping: catalog.copings[0].id, extras: { stairs: false, leds: false, shower: false }, ambient: 'day', rotate: false,
  };
  const viewport = $('#viewport'), app = $('#app');
  const photoScene = new PhotoScene($('#glp'), catalog);
  performance.mark('escena-foto');
  let orbit = null; // la vista 3D libre se crea la primera vez que se abre (ahorra arranque)
  const ensureOrbit = () => { if (!orbit) { orbit = new PoolScene($('#gl'), catalog); orbit.setAmbient(state.ambient); orbit.resize(Math.max(50, viewport.clientWidth), Math.max(50, viewport.clientHeight)); } return orbit; };
  window.__app = { state, photoScene, catalog, get orbit() { return orbit; } };

  /* ════════ Panel: forma, medidas, acabados, extras, ambiente ════════ */
  const shapeBtns = {};
  catalog.shapes.forEach((s) => {
    const b = h('button', { class: 'opt', type: 'button', title: s.hint, 'aria-pressed': 'false', onclick: () => { state.shape = s.id; refresh(); } }, h('span', { html: SHAPE_ICONS[s.id] }), s.name);
    shapeBtns[s.id] = b; $('#shapes').append(b);
  });
  const sizeCtl = {};
  [['length', 'Largo'], ['width', 'Ancho'], ['depth', 'Profundidad']].forEach(([key, label]) => {
    const lim = L[key], range = h('input', { type: 'range', min: lim.min, max: lim.max, step: lim.step, 'aria-label': label });
    const input = h('input', { type: 'number', min: lim.min, max: lim.max, step: lim.step, inputmode: 'decimal', 'aria-label': `${label} en metros` });
    const set = (v) => { state[key] = clamp(Math.round(v * 10) / 10, lim.min, lim.max); refresh(); };
    range.addEventListener('input', () => set(parseFloat(range.value)));
    input.addEventListener('change', () => { const v = parseFloat(String(input.value).replace(',', '.')); set(Number.isFinite(v) ? v : lim.default); });
    sizeCtl[key] = { range, input };
    $('#sizes').append(h('div', { class: 'size' }, h('div', { class: 'row' }, h('span', {}, label), h('span', { class: 'num' }, input, 'm')), range));
  });
  const linerBtns = {}, copBtns = {};
  catalog.liners.forEach((l) => {
    const chip = h('span', { class: 'chip-sw' }); chip.style.background = l.hex;
    const b = h('button', { class: 'sw', type: 'button', 'aria-pressed': 'false', onclick: () => { state.liner = l.id; refresh(); } }, chip, h('span', { class: 't' }, l.name, h('small', {}, `${l.pricePerM2} €/m²`)));
    linerBtns[l.id] = b; $('#liners').append(b);
  });
  const preview = (kind) => { const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').drawImage(copingTexture(kind).image, 0, 0, 96, 96); return c.toDataURL('image/jpeg', 0.7); };
  catalog.copings.forEach((c) => {
    const chip = h('span', { class: 'chip-sw' }); chip.style.backgroundImage = `url(${preview(c.texture)})`;
    const b = h('button', { class: 'sw', type: 'button', 'aria-pressed': 'false', onclick: () => { state.coping = c.id; refresh(); } }, chip, h('span', { class: 't' }, c.name, h('small', {}, `${c.pricePerMl} €/ml`)));
    copBtns[c.id] = b; $('#copings').append(b);
  });
  const exCtl = {};
  [['stairs', catalog.extras.stairs.name, () => `${catalog.extras.stairs.price} € · peldaños en una esquina`], ['leds', catalog.extras.leds.name, () => `${catalog.extras.leds.unitPrice} € por foco · se ven de noche`], ['shower', catalog.extras.shower.name, () => `${catalog.extras.shower.price} €`]].forEach(([key, name, sub]) => {
    const input = h('input', { type: 'checkbox' }), small = h('small', {}, sub());
    input.addEventListener('change', () => { state.extras[key] = input.checked; refresh(); });
    const row = h('label', { class: 'switch' }, h('span', { class: 't' }, name, small), input, h('span', { class: 'tog' }));
    exCtl[key] = { input, row, small, sub }; $('#extras').append(row);
  });
  const ambBtns = {};
  AMBIENTS.forEach(([id, label]) => { const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { state.ambient = id; if (orbit) orbit.setAmbient(id); photoScene.setAmbient(id); applyFilter(); sync(); } }, label); ambBtns[id] = b; $('#ambient').append(b); });

  /* ════════ Foto: carga, puntos, calibración, pincel ════════ */
  const stage = $('#stage'), photoEl = $('#photo'), fg = $('#fg'), fgx = fg.getContext('2d'), svg = $('#overlay'), quadEl = $('#quad'), chip = $('#chip');
  const P = { canvas: null, w: 1600, h: 1200, points: [], calib: null, tool: 'points', brush: 40, mask: document.createElement('canvas'), url: null };
  const maskx = P.mask.getContext('2d'), NS = 'http://www.w3.org/2000/svg';
  const circles = [0, 1, 2, 3].map((i) => {
    const g = document.createElementNS(NS, 'g'), c = document.createElementNS(NS, 'circle'), t = document.createElementNS(NS, 'text');
    c.setAttribute('r', 15); c.setAttribute('class', 'pt'); c.dataset.i = i; t.setAttribute('class', 'ptn'); t.textContent = i + 1; g.append(c, t); svg.append(g); g.style.display = 'none';
    c.addEventListener('pointerdown', (e) => startDrag(e, i)); c.addEventListener('pointermove', (e) => moveDrag(e, i)); c.addEventListener('pointerup', endDrag); c.addEventListener('pointercancel', endDrag);
    return { g, c, t };
  });
  let stageW = 800, stageH = 600;

  function fitStage() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (orbit) orbit.resize(Math.max(50, vw), Math.max(50, vh));
    const pad = vw < 700 ? 6 : 16, ar = P.w / P.h; let w = vw - pad * 2, hh = w / ar; if (hh > vh - pad * 2) { hh = vh - pad * 2; w = hh * ar; }
    stageW = Math.max(50, Math.floor(w)); stageH = Math.max(50, Math.floor(hh));
    stage.style.width = stageW + 'px'; stage.style.height = stageH + 'px'; svg.setAttribute('viewBox', `0 0 ${stageW} ${stageH}`);
    photoScene.resize(stageW, stageH); renderOverlay();
  }
  new ResizeObserver(fitStage).observe(viewport);
  const toStage = ([u, v]) => [(u * stageW) / P.w, (v * stageH) / P.h];

  function setChip(text, kind = '') { chip.textContent = text; chip.className = 'chip ' + kind; chip.style.display = text ? '' : 'none'; }
  function renderOverlay() {
    const pts = P.points.map(toStage), calibrated = !!P.calib;
    circles.forEach((o, i) => { o.g.style.display = pts[i] ? '' : 'none'; if (pts[i]) { o.c.setAttribute('cx', pts[i][0]); o.c.setAttribute('cy', pts[i][1]); o.t.setAttribute('x', pts[i][0]); o.t.setAttribute('y', pts[i][1] + 4); } });
    let poly = '';
    if (pts.length === 4 && calibrated) poly = P.calib.corners.map(toStage).map((p) => p.join(',')).join(' ');
    else if (pts.length > 1) poly = pts.map((p) => p.join(',')).join(' ');
    quadEl.setAttribute('points', poly); quadEl.classList.toggle('open', pts.length < 4);
    svg.classList.toggle('inert', P.tool !== 'points');
    if (P.tool === 'paint') setChip('Pinta lo que debe quedar delante de la piscina', 'info');
    else if (P.tool === 'erase') setChip('Borra las zonas pintadas', 'info');
    else if (P.points.length < 4) setChip(`Toca la esquina ${P.points.length + 1} de 4 del suelo donde irá la piscina`, 'info');
    else if (!calibrated) setChip('Los puntos no forman un suelo válido: arrástralos', 'warn');
    else setChip('');
  }

  function footprintHalf() { const fx = (state.length + 2 * copW) / 2, fz = (state.width + 2 * copW) / 2; return state.rotate ? [fz, fx] : [fx, fz]; }
  function applyLightStats() {
    if (!P.canvas || P.points.length < 1) return;
    const xs = P.points.map((p) => p[0]), ys = P.points.map((p) => p[1]), x0 = clamp(Math.min(...xs) - P.w * 0.1, 0, P.w - 8), y0 = clamp(Math.min(...ys) - P.h * 0.1, 0, P.h - 8), x1 = clamp(Math.max(...xs) + P.w * 0.1, x0 + 8, P.w), y1 = clamp(Math.max(...ys) + P.h * 0.1, y0 + 8, P.h);
    const c = document.createElement('canvas'); c.width = 24; c.height = 24; const x = c.getContext('2d'); x.drawImage(P.canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; r /= n * 255; g /= n * 255; b /= n * 255;
    const m = Math.max(r, g, b, 0.01); photoScene.setPhotoStats(0.2126 * r + 0.7152 * g + 0.0722 * b, [r / m, g / m, b / m]);
  }
  function recalibrate() {
    if (P.points.length !== 4) { P.calib = null; photoScene.poolGroup.visible = false; return false; }
    const [hx, hz] = footprintHalf(), r = calibrate(P.points, hx, hz, P.w, P.h);
    if (!r.ok) { P.calib = null; photoScene.poolGroup.visible = false; setChip(r.reason, 'warn'); return false; }
    P.calib = r; photoScene.setPose(r.pose, [P.w, P.h]); photoScene.poolGroup.visible = true; photoScene.pose = r.pose; return true;
  }
  // Tras cambiar medidas con la cámara fija, los tiradores se recolocan sobre las esquinas reales de la piscina
  function syncPointsFromPose() {
    if (!P.calib) return; const [hx, hz] = footprintHalf();
    P.points = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => photoScene.projectGround(x, z));
    P.calib.corners = P.points.map((p) => [...p]); renderOverlay();
  }

  function canvasPoint(e) { const r = stage.getBoundingClientRect(); return [clamp(((e.clientX - r.left) / r.width) * P.w, 0, P.w), clamp(((e.clientY - r.top) / r.height) * P.h, 0, P.h)]; }
  let drag = null;
  function startDrag(e, i) { if (P.tool !== 'points') return; e.stopPropagation(); e.preventDefault(); drag = i; try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* sin captura el arrastre sigue funcionando dentro del círculo */ } }
  function moveDrag(e, i) { if (drag !== i) return; P.points[i] = canvasPoint(e); recalibrate(); applyLightStats(); renderOverlay(); }
  function endDrag() { if (drag === null) return; drag = null; syncPointsFromPose(); } // al soltar, los tiradores se pegan a las esquinas reales de la piscina

  // Pincel de primer plano: la máscara se pinta en el canvas `mask` y `fg` muestra la foto solo donde hay máscara
  function refreshFg(x, y, w, hh) {
    x = clamp(Math.floor(x), 0, P.w); y = clamp(Math.floor(y), 0, P.h); w = Math.min(Math.ceil(w) + 2, P.w - x); hh = Math.min(Math.ceil(hh) + 2, P.h - y); if (w <= 0 || hh <= 0) return;
    fgx.save(); fgx.clearRect(x, y, w, hh); fgx.drawImage(P.canvas, x, y, w, hh, x, y, w, hh); fgx.globalCompositeOperation = 'destination-in'; fgx.drawImage(P.mask, x, y, w, hh, x, y, w, hh); fgx.restore();
  }
  function dab([x, y], erase) {
    const r = (P.brush * P.w) / stageW, g = maskx.createRadialGradient(x, y, r * 0.4, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    maskx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; maskx.fillStyle = g; maskx.beginPath(); maskx.arc(x, y, r, 0, 7); maskx.fill(); refreshFg(x - r, y - r, 2 * r, 2 * r);
  }
  let brushing = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!P.canvas) return;
    if (P.tool !== 'points') { brushing = { last: canvasPoint(e), erase: P.tool === 'erase' }; try { stage.setPointerCapture(e.pointerId); } catch (_) {} dab(brushing.last, brushing.erase); return; }
    if (P.points.length < 4) {
      P.points.push(canvasPoint(e));
      if (P.points.length === 4) { if (recalibrate()) { applyLightStats(); syncPointsFromPose(); } } else photoScene.poolGroup.visible = false;
      renderOverlay();
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!brushing) return; const p = canvasPoint(e), a = brushing.last, step = Math.max(2, ((P.brush * P.w) / stageW) / 3), dist = Math.hypot(p[0] - a[0], p[1] - a[1]), n = Math.max(1, Math.ceil(dist / step));
    for (let k = 1; k <= n; k++) dab([a[0] + ((p[0] - a[0]) * k) / n, a[1] + ((p[1] - a[1]) * k) / n], brushing.erase); brushing.last = p;
  });
  const endBrush = () => { brushing = null; }; stage.addEventListener('pointerup', endBrush); stage.addEventListener('pointercancel', endBrush);

  function resetMask() { maskx.clearRect(0, 0, P.w, P.h); fgx.clearRect(0, 0, P.w, P.h); }
  function setTool(t) { P.tool = t; document.querySelectorAll('#tools button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t))); stage.classList.toggle('painting', t !== 'points'); renderOverlay(); }
  document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#rBrush').addEventListener('input', (e) => { P.brush = +e.target.value; $('#oBrush').textContent = P.brush + ' px'; });
  $('#btnClearMask').addEventListener('click', () => { resetMask(); toast('Zonas pintadas quitadas'); });

  function applyFilter() { const f = PHOTO_AMBIENTS[state.ambient].filter; photoEl.style.filter = f; fg.style.filter = f; }

  async function loadPhoto(source, quad, rotate = false) {
    try {
      const url = typeof source === 'string' ? source : URL.createObjectURL(source), img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('imagen no válida')); img.src = url; });
      const s = Math.min(1, MAX_PHOTO / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      performance.mark('img-decodificada'); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); if (typeof source !== 'string') URL.revokeObjectURL(url);
      P.canvas = c; P.w = c.width; P.h = c.height; P.mask.width = fg.width = P.w; P.mask.height = fg.height = P.h; resetMask();
      if (P.url) URL.revokeObjectURL(P.url); P.url = await new Promise((res) => c.toBlob((b) => res(URL.createObjectURL(b)), 'image/jpeg', 0.92)); performance.mark('blob'); photoEl.src = P.url;
      P.points = quad ? quad.map(([fx, fy]) => [fx * P.w, fy * P.h]) : []; P.calib = null; state.rotate = !!rotate; $('#chkRotate').checked = state.rotate;
      photoScene.poolGroup.visible = false; setTool('points'); fitStage();
      performance.mark('antes-calib');
      if (P.points.length === 4) { applyLightStats(); if (recalibrate()) { performance.mark('calibrado'); photoScene.update(sceneConfig()); performance.mark('piscina-construida'); applyRotation(); syncPointsFromPose(); } }
      renderOverlay();
    } catch (err) { console.error(err); toast('No se pudo abrir la imagen'); }
  }
  function applyRotation() { photoScene.poolGroup.rotation.y = state.rotate ? Math.PI / 2 : 0; }

  SAMPLES.forEach((s, i) => {
    const b = h('button', { type: 'button', class: 'sample', 'aria-label': s.name, title: s.name, 'aria-pressed': 'false', onclick: async () => { document.querySelectorAll('.sample').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); await loadPhoto(s.src, s.quad, s.rotate); } }, h('span', {}, s.name));
    b.style.backgroundImage = `url(${s.src})`; $('#samples').append(b);
  });
  const onFile = (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!f.type.startsWith('image/')) { toast('Elige una imagen'); return; } document.querySelectorAll('.sample').forEach((x) => x.setAttribute('aria-pressed', 'false')); loadPhoto(f); };
  $('#fileCam').addEventListener('change', onFile); $('#fileGal').addEventListener('change', onFile);
  $('#btnRemark').addEventListener('click', () => { P.points = []; P.calib = null; photoScene.poolGroup.visible = false; setTool('points'); renderOverlay(); });
  $('#chkRotate').addEventListener('change', (e) => { state.rotate = e.target.checked; applyRotation(); if (P.calib) syncPointsFromPose(); }); // gira sobre su sitio con la cámara fija
  $('#rSun').addEventListener('input', (e) => { $('#oSun').textContent = e.target.value + '°'; photoScene.setSunAzimuth(+e.target.value); });
  $('#rLight').addEventListener('input', (e) => { $('#oLight').textContent = e.target.value + ' %'; photoScene.setLightScale(+e.target.value / 100); });

  /* ════════ Sincronización ════════ */
  let quote = null, pending = false;
  function config() { const c = clampConfig(state, L); return { shape: c.shape, length: c.length, width: c.width, depth: c.depth, liner: c.liner, coping: c.coping, extras: { ...c.extras } }; }
  const sceneConfig = config;
  function sync() {
    Object.entries(shapeBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.shape)));
    Object.entries(linerBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.liner)));
    Object.entries(copBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.coping)));
    Object.entries(ambBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === state.ambient)));
    ['length', 'width', 'depth'].forEach((k) => { if (document.activeElement !== sizeCtl[k].input) sizeCtl[k].input.value = state[k].toFixed(1); sizeCtl[k].range.value = state[k]; });
    const roman = state.shape === 'playa';
    exCtl.stairs.input.checked = roman ? false : state.extras.stairs; exCtl.stairs.input.disabled = roman; exCtl.stairs.row.classList.toggle('off', roman);
    exCtl.stairs.small.textContent = roman ? 'Ya incluida en esta forma (escalera romana)' : exCtl.stairs.sub();
    exCtl.leds.input.checked = state.extras.leds; exCtl.shower.input.checked = state.extras.shower;
  }
  function renderQuote() {
    quote = computeQuote(config(), catalog); const m = quote.metrics;
    $('#qTotal').textContent = eur(quote.total); $('#qVat').textContent = `IVA ${Math.round(quote.vatRate * 100)} % incluido`;
    $('#qMetrics').innerHTML = `Lámina ${num(m.linerNet * catalog.wasteFactor, 1)} m²<br>Coronación ${num(m.copingMl, 1)} ml<br>Agua ${num(m.waterM3, 1)} m³`;
    const box = $('#qBreakdown'); box.innerHTML = ''; let g = '';
    quote.lines.forEach((l) => { if (l.group !== g) { g = l.group; box.append(h('div', { class: 'bd-group' }, g)); } box.append(h('div', { class: 'bd-row' }, h('span', {}, l.label), h('span', {}, eur(l.total)))); });
    box.append(h('div', { class: 'bd-group' }, 'Totales'), h('div', { class: 'bd-row' }, h('span', {}, 'Subtotal'), h('span', {}, eur(quote.subtotal))), h('div', { class: 'bd-row' }, h('span', {}, `IVA ${Math.round(quote.vatRate * 100)} %`), h('span', {}, eur(quote.vat))));
  }
  function updateScenes() {
    if (state.mode === 'photo') { photoScene.update(sceneConfig()); applyRotation(); if (P.calib) syncPointsFromPose(); } else ensureOrbit().update(config());
  }
  function refresh() { sync(); renderQuote(); if (!pending) { pending = true; setTimeout(() => { pending = false; updateScenes(); }, 0); } }

  function setMode(m) {
    state.mode = m; app.dataset.mode = m; if (m === 'orbit') ensureOrbit(); if (orbit) orbit.visible = m === 'orbit'; photoScene.visible = m === 'photo';
    document.querySelectorAll('#modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    fitStage(); updateScenes();
  }
  document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ════════ Imagen, presupuesto y PDF ════════ */
  const stamp = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '');
  function composite(width) {
    if (state.mode === 'orbit') { const c = document.createElement('canvas'), src = ensureOrbit().snapshot('image/png'); return new Promise((res) => { const im = new Image(); im.onload = () => { c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); res(c); }; im.src = src; }); }
    const w = Math.min(width, P.w), hh = Math.round((w * P.h) / P.w), c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'), f = PHOTO_AMBIENTS[state.ambient].filter;
    x.filter = f === 'none' ? 'none' : f; x.drawImage(P.canvas, 0, 0, w, hh); x.filter = 'none';
    if (photoScene.pose && photoScene.poolGroup.visible) x.drawImage(photoScene.renderAt(w), 0, 0, w, hh);
    x.filter = f === 'none' ? 'none' : f; x.drawImage(fg, 0, 0, w, hh); x.filter = 'none';
    return Promise.resolve(c);
  }
  $('#btnImage').addEventListener('click', async () => {
    if (state.mode === 'photo' && !photoScene.poolGroup.visible) { toast('Marca primero las 4 esquinas del suelo'); return; }
    const c = await composite(2400), a = h('a', { href: c.toDataURL('image/jpeg', 0.93), download: `piscina-${stamp()}.jpg` });
    document.body.append(a); a.click(); a.remove(); toast('Imagen descargada');
  });
  const dlg = $('#dlg'); let current = null;
  $('#btnQuote').addEventListener('click', async () => {
    if (state.mode === 'photo' && !photoScene.poolGroup.visible) { toast('Marca primero las 4 esquinas del suelo'); return; }
    const date = new Date(), cfg = config(), q = computeQuote(cfg, catalog), c = await composite(1800);
    current = { cfg, quote: q, date, ref: `P-${stamp(date)}-${String(Math.floor(Math.random() * 900) + 100)}`, image: c.toDataURL('image/jpeg', 0.9), ratio: c.height / c.width };
    $('#dlgImg').src = current.image; $('#dlgMeta').textContent = `${current.ref} · ${date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const specs = $('#dlgSpecs'); specs.innerHTML = ''; specRows(cfg, q, catalog).forEach(([k, v]) => specs.append(h('dt', {}, k), h('dd', {}, v)));
    const t = $('#dlgTable'); t.innerHTML = '';
    t.append(h('thead', {}, h('tr', {}, h('th', {}, 'Concepto'), h('th', {}, 'Cantidad'), h('th', {}, 'Precio'), h('th', {}, 'Importe'))));
    const tb = h('tbody'); let g = '';
    q.lines.forEach((l) => { if (l.group !== g) { g = l.group; tb.append(h('tr', { class: 'grp' }, h('td', { colspan: '4' }, g))); } tb.append(h('tr', {}, h('td', {}, l.label), h('td', {}, `${num(l.qty)} ${l.unit}`), h('td', {}, eur(l.unitPrice)), h('td', {}, eur(l.total)))); });
    t.append(tb);
    $('#dlgTotals').innerHTML = ''; $('#dlgTotals').append(h('div', {}, h('span', {}, 'Subtotal'), h('span', {}, eur(q.subtotal))), h('div', {}, h('span', {}, `IVA (${Math.round(q.vatRate * 100)} %)`), h('span', {}, eur(q.vat))), h('div', { class: 'grand' }, h('span', {}, 'Total'), h('span', {}, eur(q.total))));
    dlg.showModal();
  });
  const close = () => dlg.close(); $('#dlgClose').addEventListener('click', close); $('#dlgClose2').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  $('#btnPdf').addEventListener('click', () => {
    if (!current || !window.jspdf) { toast('No se pudo generar el PDF'); return; }
    const doc = buildQuotePdf(window.jspdf.jsPDF, { brand: BRAND, imageDataUrl: current.image, imageRatio: current.ratio, cfg: current.cfg, quote: current.quote, catalog, date: current.date, ref: current.ref });
    doc.save(`presupuesto-${current.ref}.pdf`); toast('PDF descargado');
  });

  window.__app.composite = composite; window.__app.P = P; window.__app.recalibrate = recalibrate;

  /* ════════ Arranque ════════ */
  sync(); renderQuote(); applyFilter();
  setMode('photo');
  await loadPhoto(SAMPLES[0].src, SAMPLES[0].quad, SAMPLES[0].rotate); document.querySelector('.sample').setAttribute('aria-pressed', 'true');
  performance.mark('foto'); performance.mark('listo'); setTimeout(() => $('#loading').classList.add('hide'), 300);
}

start().catch((e) => { console.error(e); const l = document.getElementById('loading'); if (l) l.textContent = 'No se pudo cargar el configurador: ' + e.message; });
