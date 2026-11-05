# Configurador de piscinas

Prototipo web: coloca una piscina sobre la foto del jardín (o míralo en 3D libre), con presupuesto en vivo, imagen y PDF.

## Cómo funciona la foto

1. El usuario sube o hace una foto y marca las 4 esquinas del suelo donde irá la piscina.
2. `src/core/perspective.js` calcula la homografía, estima la focal y resuelve la pose de la cámara (con ajuste por mínimos cuadrados). No hay controles manuales de horizonte ni de ángulo.
3. Three.js dibuja la piscina hundida con esa cámara: un suelo invisible con hueco oculta lo que queda bajo el terreno y recibe las sombras.
4. Cambiar las medidas no mueve la cámara: la piscina crece sobre el suelo de la foto.
5. Un pincel permite marcar objetos que deben quedar por delante de la piscina.
Todo es estático y no carga nada de terceros (Three.js, jsPDF y la fuente están en local).

## Estructura

- `src/core/`: lógica sin dependencias (geometría, medidas, presupuesto y calibración de perspectiva). Reutilizable en la futura app móvil.
- `src/scene/`: escenas Three.js (`photo-scene.js` sobre foto, `pool-scene.js` vista 3D libre) y el constructor común de la piscina.
- `src/export/pdf.js`: PDF del presupuesto.
- `data/catalog.json`: acabados, coronaciones, extras y precios de ejemplo.
- `src/config.js`: nombre de la marca provisional.
- `samples/` y `textures/`: fotos y texturas CC0 (ver sus `CREDITS.md`).
- `tests/`: pruebas del núcleo (`npm test`).

## Ejecutar en local

```
python -m http.server 5185
```

y abrir http://localhost:5185/ (hace falta servidor por el `fetch` del catálogo y los módulos ES).

## Terceros

Three.js r160 (MIT), jsPDF 2.5.1 (MIT), Manrope (SIL OFL 1.1), texturas y fotos CC0. Nombres y precios del catálogo: ficticios.
