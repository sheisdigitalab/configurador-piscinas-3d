// Piscina dibujada sobre una foto. La cámara sale de la calibración con los 4 puntos (core/perspective.js).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildPool, toPath, disposeTree } from './pool-builder.js';

export const PHOTO_AMBIENTS = {
  day: { filter: 'none', sun: 0xfff1da, sunI: 2.6, hemiI: 1.25, elev: 48, sky: { t: 3, r: 1.1, m: 0.005, g: 0.8, sunElev: 40 }, shadow: 0.38, led: 0, bright: 1, caustics: 1 },
  dusk: { filter: 'sepia(.28) saturate(1.12) brightness(.8) hue-rotate(-12deg)', sun: 0xff9a55, sunI: 2.2, hemiI: 0.7, elev: 11, sky: { t: 7, r: 3, m: 0.02, g: 0.92, sunElev: 4 }, shadow: 0.45, led: 0.35, bright: 0.62, caustics: 0.7 },
  night: { filter: 'brightness(.3) saturate(.65) contrast(1.05) hue-rotate(8deg)', sun: 0x8fa8ff, sunI: 0.5, hemiI: 0.55, elev: 50, sky: { t: 2, r: 0.2, m: 0.002, g: 0.7, sunElev: -8 }, shadow: 0.12, led: 1, bright: 0.28, caustics: 0.3 },
};

export class PhotoScene {
  constructor(canvas, catalog) {
    this.canvas = canvas; this.catalog = catalog; this.cfg = null; this.ambient = 'day'; this.sunAz = 215; this.lightScale = 1; this.stats = { lum: 0.4, color: new THREE.Color(1, 1, 1) };
    this.size = [1600, 1200]; this.pose = null;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }));
    r.setClearColor(0x000000, 0); r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9;
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.05, 2000);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x6b6a58, 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.envSky = new Sky(); this.envSky.scale.setScalar(900); this.envScene = new THREE.Scene(); this.envScene.add(this.envSky); this.pmrem = new THREE.PMREMGenerator(r);
    this.poolGroup = new THREE.Group(); this.scene.add(this.poolGroup);
    this.t0 = performance.now(); this.visible = true;
    this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
    this.setAmbient('day');
  }

  // Ajusta la cámara virtual a la calibración. size = tamaño de la foto en píxeles.
  setPose(pose, size) {
    this.size = size; this.pose = pose; const [w, h] = size, { R, C, f } = pose;
    this.camera.aspect = w / h; this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / 2 / f)); this.camera.updateProjectionMatrix();
    // ejes de la cámara de Three (x derecha, y arriba, z atrás) expresados en el mundo: filas de R con y,z invertidos
    const X = new THREE.Vector3(...R[0]), Y = new THREE.Vector3(...R[1]).negate(), Z = new THREE.Vector3(...R[2]).negate();
    this.camera.matrixWorld.makeBasis(X, Y, Z).setPosition(C[0], C[1], C[2]);
    this.camera.matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.camera.scale); this.camera.updateMatrixWorld(true);
  }

  // Luz estimada de la foto: luminosidad media (0..1) y color medio normalizado
  setPhotoStats(lum, rgb) { this.stats = { lum, color: new THREE.Color(rgb[0], rgb[1], rgb[2]) }; this.applyLight(); }
  setSunAzimuth(deg) { this.sunAz = deg; this.applyLight(); }
  setLightScale(v) { this.lightScale = v; this.applyLight(); }

  setAmbient(name) {
    this.ambient = name; const a = PHOTO_AMBIENTS[name], u = this.envSky.material.uniforms;
    const sd = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - THREE.MathUtils.degToRad(a.sky.sunElev), THREE.MathUtils.degToRad(this.sunAz));
    u.turbidity.value = a.sky.t; u.rayleigh.value = a.sky.r; u.mieCoefficient.value = a.sky.m; u.mieDirectionalG.value = a.sky.g; u.sunPosition.value.copy(sd);
    if (this.envRT) this.envRT.dispose(); this.envRT = this.pmrem.fromScene(this.envScene); this.scene.environment = this.envRT.texture;
    this.applyLight(); this.applyLook();
  }

  applyLight() {
    const a = PHOTO_AMBIENTS[this.ambient], lin = Math.pow(this.stats.lum, 2.2), k = (0.55 + 1.6 * lin) * this.lightScale;
    this.hemi.color.set(0xffffff).lerp(this.stats.color, 0.45); this.hemi.groundColor.set(0x6b6a58).lerp(this.stats.color, 0.4); this.hemi.intensity = a.hemiI * k;
    this.sun.color.setHex(a.sun); this.sun.intensity = a.sunI * k;
    const dir = new THREE.Vector3().setFromSphericalCoords(40, Math.PI / 2 - THREE.MathUtils.degToRad(a.elev), THREE.MathUtils.degToRad(this.sunAz));
    this.sun.position.copy(dir); this.sun.castShadow = this.ambient !== 'night';
    if (this.shadowPlane) this.shadowPlane.material.opacity = a.shadow;
  }
  applyLook() { const a = PHOTO_AMBIENTS[this.ambient]; if (this.pool) this.pool.applyLook({ led: a.led, brightness: a.bright, caustics: a.caustics, glow: this.ambient === 'night' ? 0.03 : 0 }); }

  update(cfg) {
    this.cfg = cfg; disposeTree(this.poolGroup);
    const pool = buildPool(cfg, this.catalog); this.pool = pool; this.poolGroup.add(pool.group);
    const R = 300, big = new THREE.Shape(); big.moveTo(-R, -R); big.lineTo(R, -R); big.lineTo(R, R); big.lineTo(-R, R); big.closePath(); big.holes.push(toPath(pool.pts));
    // 1) suelo invisible que solo escribe profundidad: oculta lo que quede por debajo del terreno fuera del hueco
    const mask = new THREE.Mesh(new THREE.ShapeGeometry(big), new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
    mask.rotation.x = -Math.PI / 2; mask.position.y = -0.001; mask.renderOrder = -1; this.poolGroup.add(mask);
    // 2) receptor de sombras sobre el suelo de la foto
    const sp = new THREE.Mesh(new THREE.ShapeGeometry(big), new THREE.ShadowMaterial({ opacity: PHOTO_AMBIENTS[this.ambient].shadow }));
    sp.rotation.x = -Math.PI / 2; sp.position.y = 0.003; sp.receiveShadow = true; sp.renderOrder = 3; this.poolGroup.add(sp); this.shadowPlane = sp;
    const ext = Math.max(cfg.length, cfg.width) + 10, sc = this.sun.shadow.camera;
    Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 }); sc.updateProjectionMatrix();
    this.applyLook();
  }

  resize(w, h) { this.renderer.setSize(w, h, false); }

  // Dibuja a otra resolución (para exportar) y devuelve una copia en un canvas 2D
  renderAt(width) {
    const [pw, ph] = this.size, w = Math.round(width), h = Math.round((width * ph) / pw);
    const prevPR = this.renderer.getPixelRatio(), prev = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setPixelRatio(1); this.renderer.setSize(w, h, false); this.renderer.render(this.scene, this.camera);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(this.canvas, 0, 0);
    this.renderer.setPixelRatio(prevPR); this.renderer.setSize(prev.x, prev.y, false); this.renderer.render(this.scene, this.camera);
    return c;
  }

  // Proyecta un punto del suelo a píxeles de la foto (para colocar los tiradores)
  projectGround(x, z) {
    const v = new THREE.Vector3(x, 0, z).project(this.camera), [w, h] = this.size; return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
  }

  loop(now) {
    if (this.visible && this.pose) { if (this.pool) this.pool.tick((now - this.t0) / 1000); this.renderer.render(this.scene, this.camera); }
    requestAnimationFrame(this.loop);
  }
}
