# Configurador de piscinas 3D

Prototipo web de escritorio: piscina en 3D (Three.js), presupuesto en vivo, imagen y PDF.
Todo es estático y no carga nada de terceros (Three.js, jsPDF y la fuente están en local).

## Estructura

- `src/core/`: lógica sin dependencias (geometría, medidas y presupuesto). Reutilizable en la futura app móvil.
- `src/scene/`: escena Three.js (sólo aquí se usa Three).
- `src/export/pdf.js`: PDF del presupuesto.
- `data/catalog.json`: acabados, coronaciones, extras y precios de ejemplo.
- `src/config.js`: nombre de la marca provisional.
- `tests/`: pruebas del núcleo (`npm test`).

## Ejecutar en local

```
python -m http.server 5185
```

y abrir http://localhost:5185/ (hace falta servidor por el `fetch` del catálogo y los módulos ES).

## Terceros

Three.js r160 (MIT), jsPDF 2.5.1 (MIT), Manrope (SIL OFL 1.1). Nombres y precios del catálogo: ficticios.
