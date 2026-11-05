import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { offsetPoly } from '../core/pool-math.js';
import { grassTexture, pavingTexture, GRASS_METERS, PAVING_METERS } from './textures.js';
import { buildPool, toShape, toPath, disposeTree } from './pool-builder.js';

const PATIO_MARGIN = 2.4; // pavimento alrededor de la coronación

const AMBIENTS = {
  day: {
    sunElev: 38, sunAz: 150, sky: { turbidity: 3, rayleigh: 1.1, mie: 0.005, g: 0.8 }, exposure: 0.5,
    light: { color: 0xfff1da, intensity: 3.1, shadows: true, elev: 38, az: 150 },
    hemi: { sky: 0xbfdcff, ground: 0x6b7a4a, intensity: 0.95 }, fog: [0xcfe3f2, 0.0085], leds: 0, stars: 0, grassTint: 1,
  },
  dusk: {
    sunElev: 3, sunAz: 245, sky: { turbidity: 7, rayleigh: 3, mie: 0.02, g: 0.92 }, exposure: 0.45,
    light: { color: 0xff9a55, intensity: 2.4, shadows: true, elev: 9, az: 245 },
    hemi: { sky: 0x9a86a8, ground: 0x4a4430, intensity: 0.5 }, fog: [0xd39d7c, 0.011], leds: 0.35, stars: 0, grassTint: 0.85,
  },
  night: {
    sunElev: -8, sunAz: 200, sky: { turbidity: 2, rayleigh: 0.2, mie: 0.002, g: 0.7 }, exposure: 0.55,
    light: { color: 0x8fa8ff, intensity: 0.9, shadows: false, elev: 45, az: 200 },
    hemi: { sky: 0x2a3f6e, ground: 0x0b1017, intensity: 0.8 }, fog: [0x0b1428, 0.012], leds: 1, stars: 1, grassTint: 0.55,
  },
};

function flatMesh(shape, material, y) { const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), material); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; return m; }
function rectShape(x0, z0, x1, z1) { const s = new THREE.Shape(); s.moveTo(x0, -z0); s.lineTo(x1, -z0); s.lineTo(x1, -z1); s.lineTo(x0, -z1); s.closePath(); return s; }

export class PoolScene {
  constructor(canvas, catalog) {
    this.catalog = catalog; this.canvas = canvas; this.cfg = null; this.ambient = 'day'; this.ledLights = [];
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 1500);
    this.camera.position.set(11.5, 3.4, 14);

    const c = (this.controls = new OrbitControls(this.camera, canvas));
    c.target.set(0, 0.5, 0); c.enableDamping = true; c.dampingFactor = 0.08; c.enablePan = false;
    c.minDistance = 4.5; c.maxDistance = 34; c.minPolarAngle = 0.12; c.maxPolarAngle = 1.46; // nunca baja del suelo
    c.update();

    this.sky = new Sky(); this.sky.scale.setScalar(900); this.scene.add(this.sky);
    this.envSky = new Sky(); this.envSky.scale.setScalar(900); this.envScene = new THREE.Scene(); this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.stars = this.makeStars(); this.scene.add(this.stars);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445522, 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    Object.assign(this.sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
    this.scene.add(this.sun, this.sun.target);

    this.scene.fog = new THREE.FogExp2(0xcfe3f2, 0.0085);
    this.buildStatic();
    this.poolGroup = new THREE.Group(); this.scene.add(this.poolGroup);
    this.setAmbient('day');
    this.t0 = performance.now();
    this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
  }

  makeStars() {
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.9 + 0.1, th = u * Math.PI * 2, ph = Math.acos(v), R = 700;
      pos[i * 3] = R * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = R * Math.cos(ph); pos[i * 3 + 2] = R * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  }

  // Elementos que no dependen de la piscina: árboles y seto del fondo
  buildStatic() {
    this.staticGroup = new THREE.Group(); this.scene.add(this.staticGroup);
    const leaf = (r, col, x, y, z) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshStandardMaterial({ color: col, flatShading: true, roughness: 1 })); m.position.set(x, y, z); m.castShadow = true; return m; };
    const tree = (x, z, s) => {
      const g = new THREE.Group(), trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 2.2 * s, 8), new THREE.MeshStandardMaterial({ color: 0x6a5240, roughness: 1 }));
      trunk.position.y = 1.1 * s; trunk.castShadow = true; g.add(trunk);
      g.add(leaf(1.5 * s, 0x4f7f3a, 0, 3.1 * s, 0), leaf(1.1 * s, 0x5d8f45, 0.9 * s, 2.5 * s, 0.3 * s), leaf(1.0 * s, 0x436f31, -0.8 * s, 2.6 * s, -0.4 * s));
      g.position.set(x, 0, z); return g;
    };
    [[-17, -15, 1.3], [16, -17, 1.5], [-22, 4, 1.2], [21, 9, 1.4], [-12, -22, 1.1], [8, -24, 1.2]].forEach(([x, z, s]) => this.staticGroup.add(tree(x, z, s)));
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(46, 1.5, 1.0), new THREE.MeshStandardMaterial({ color: 0x3f6b30, flatShading: true, roughness: 1 }));
    hedge.position.set(0, 0.75, -17); hedge.castShadow = hedge.receiveShadow = true; this.staticGroup.add(hedge);
    this.grass = new THREE.MeshStandardMaterial({ map: grassTexture().clone(), roughness: 1 });
    this.grass.map.repeat.set(1 / GRASS_METERS, 1 / GRASS_METERS); this.grass.map.needsUpdate = true;
  }

  setAmbient(name) {
    const a = AMBIENTS[name] || AMBIENTS.day; this.ambient = name;
    const u = this.sky.material.uniforms, ue = this.envSky.material.uniforms;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - THREE.MathUtils.degToRad(a.sunElev), THREE.MathUtils.degToRad(a.sunAz));
    [u, ue].forEach((x) => { x.turbidity.value = a.sky.turbidity; x.rayleigh.value = a.sky.rayleigh; x.mieCoefficient.value = a.sky.mie; x.mieDirectionalG.value = a.sky.g; x.sunPosition.value.copy(sunDir); });
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene); this.scene.environment = this.envRT.texture;
    this.renderer.toneMappingExposure = a.exposure;
    const L = a.light, ld = new THREE.Vector3().setFromSphericalCoords(30, Math.PI / 2 - THREE.MathUtils.degToRad(L.elev), THREE.MathUtils.degToRad(L.az));
    this.sun.color.setHex(L.color); this.sun.intensity = L.intensity; this.sun.position.copy(ld); this.sun.castShadow = L.shadows;
    this.hemi.color.setHex(a.hemi.sky); this.hemi.groundColor.setHex(a.hemi.ground); this.hemi.intensity = a.hemi.intensity;
    this.scene.fog.color.setHex(a.fog[0]); this.scene.fog.density = a.fog[1];
    this.stars.material.opacity = a.stars;
    this.grass.color.setScalar(a.grassTint);
    this.applyLeds();
  }

  applyLeds() {
    const a = AMBIENTS[this.ambient];
    if (this.pool) this.pool.applyLook({ led: a.leds, brightness: { day: 1, dusk: 0.62, night: 0.28 }[this.ambient], caustics: this.ambient === 'night' ? 0.3 : 1, glow: this.ambient === 'night' ? 0.03 : 0 });
  }

  update(cfg) {
    this.cfg = cfg; const cat = this.catalog, copW = cat.copingWidth, L = cfg.length, W = cfg.width;
    disposeTree(this.poolGroup);
    const G = this.poolGroup, pool = buildPool(cfg, cat), pts = pool.pts;
    this.pool = pool; this.water = pool.water; G.add(pool.group);

    // Césped con el hueco del vaso y patio de pavimento alrededor de la coronación
    const big = rectShape(-250, -250, 250, 250); big.holes.push(toPath(pts));
    G.add(flatMesh(big, this.grass, 0));
    const pav = pavingTexture().clone(); pav.repeat.set(1 / PAVING_METERS, 1 / PAVING_METERS); pav.needsUpdate = true;
    const patio = rectShape(-L / 2 - PATIO_MARGIN - copW, -W / 2 - PATIO_MARGIN - copW, L / 2 + PATIO_MARGIN + copW, W / 2 + PATIO_MARGIN + copW);
    patio.holes.push(toPath(offsetPoly(pts, copW - 0.01)));
    G.add(flatMesh(patio, new THREE.MeshStandardMaterial({ map: pav, roughness: 0.9 }), 0.012));

    // Dos tumbonas en el patio del fondo
    const lounger = (x, z) => {
      const g = new THREE.Group(), frame = new THREE.MeshStandardMaterial({ color: 0xd5d8d9, metalness: 0.3, roughness: 0.5 }), cush = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.95 });
      const add = (geo, m, px, py, pz, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.castShadow = true; parent.add(o); return o; };
      add(new THREE.BoxGeometry(0.66, 0.04, 1.9), frame, 0, 0.28, 0); add(new THREE.BoxGeometry(0.62, 0.08, 1.15), cush, 0, 0.34, 0.38);
      const back = new THREE.Group(); back.position.set(0, 0.36, -0.2); back.rotation.x = 0.95; g.add(back); add(new THREE.BoxGeometry(0.62, 0.08, 0.8), cush, 0, 0, -0.4, back);
      for (const sx of [-0.3, 0.3]) for (const sz of [-0.9, 0.9]) add(new THREE.BoxGeometry(0.04, 0.26, 0.04), frame, sx, 0.13, sz);
      g.position.set(x, 0.012, z); g.rotation.y = Math.PI / 2; return g;
    };
    const zb = -(W / 2 + copW + 0.95); G.add(lounger(-L / 4, zb), lounger(L / 4 - 0.4, zb));
    this.applyLeds();
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  snapshot(type = 'image/jpeg', q = 0.92) { this.renderer.render(this.scene, this.camera); return this.canvas.toDataURL(type, q); }

  loop(now) {
    if (this.visible !== false) {
      this.controls.update();
      if (this.pool) this.pool.tick((now - this.t0) / 1000);
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame(this.loop);
  }
}
