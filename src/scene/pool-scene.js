import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { poolOutline, poolFeatures, offsetPoly, poolMetrics } from '../core/pool-math.js';
import { ledCount } from '../core/quote.js';
import { grassTexture, pavingTexture, copingTexture, linerTexture, waterNormal, GRASS_METERS, PAVING_METERS, COPING_METERS } from './textures.js';

const WATER_DROP = 0.12; // el agua queda 12 cm por debajo del borde
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

// Constructor mínimo de mallas con atributos de color y UV
class MeshBuilder {
  constructor() { this.p = []; this.uv = []; this.c = []; this.idx = []; }
  v(x, y, z, u = 0, w = 0, col = [1, 1, 1]) { this.p.push(x, y, z); this.uv.push(u, w); this.c.push(col[0], col[1], col[2]); return this.p.length / 3 - 1; }
  tri(a, b, c, want) {
    const P = this.p, A = new THREE.Vector3(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), B = new THREE.Vector3(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), C = new THREE.Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
    const n = B.sub(A).cross(C.sub(A));
    if (n.dot(want) < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  quad(a, b, c, d, want) { this.tri(a, b, c, want); this.tri(a, c, d, want); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx); g.computeVertexNormals(); return g;
  }
}

// Shape de Three a partir de puntos [x,z]. Se rota -90° en X, así que z se invierte.
function toShape(pts) { const s = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return s; }
function toPath(pts) { const s = new THREE.Path(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return s; }
function flatMesh(shape, material, y) { const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), material); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; return m; }
function rectShape(x0, z0, x1, z1) { const s = new THREE.Shape(); s.moveTo(x0, -z0); s.lineTo(x1, -z0); s.lineTo(x1, -z1); s.lineTo(x0, -z1); s.closePath(); return s; }

function disposeTree(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  while (g.children.length) g.remove(g.children[0]);
}

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
    const a = AMBIENTS[this.ambient], on = this.cfg && this.cfg.extras.leds;
    this.ledLights.forEach((l) => { l.intensity = on ? 4 * a.leds : 0; });
    if (this.water) {
      const lit = on && a.leds > 0;
      this.water.material.emissiveIntensity = lit ? 0.55 * a.leds : this.ambient === 'night' ? 0.03 : 0;
    }
    if (this.ledDiscs) this.ledDiscs.forEach((d) => { d.material.emissiveIntensity = on ? 0.4 + 2.2 * a.leds : 0; });
  }

  update(cfg) {
    this.cfg = cfg; const cat = this.catalog, copW = cat.copingWidth;
    disposeTree(this.poolGroup); this.ledLights = []; this.ledDiscs = [];
    const G = this.poolGroup, pts = poolOutline(cfg), F = poolFeatures(cfg), D = cfg.depth, L = cfg.length, W = cfg.width;
    const liner = cat.liners.find((x) => x.id === cfg.liner) || cat.liners[0];
    const coping = cat.copings.find((x) => x.id === cfg.coping) || cat.copings[0];
    const lc = new THREE.Color(liner.hex), up = new THREE.Vector3(0, 1, 0);
    const lmap = linerTexture().clone(); lmap.needsUpdate = true;

    // Césped con el hueco del vaso
    const big = rectShape(-250, -250, 250, 250); big.holes.push(toPath(pts));
    G.add(flatMesh(big, this.grass, 0));

    // Patio de pavimento alrededor de la coronación (con hueco hasta el borde de la coronación)
    const pav = pavingTexture().clone(); pav.repeat.set(1 / PAVING_METERS, 1 / PAVING_METERS); pav.needsUpdate = true;
    const patio = rectShape(-L / 2 - PATIO_MARGIN - copW, -W / 2 - PATIO_MARGIN - copW, L / 2 + PATIO_MARGIN + copW, W / 2 + PATIO_MARGIN + copW);
    patio.holes.push(toPath(offsetPoly(pts, copW - 0.01)));
    G.add(flatMesh(patio, new THREE.MeshStandardMaterial({ map: pav, roughness: 0.9 }), 0.012));

    // Vaso: solo caras interiores (paredes hacia dentro y fondo)
    const top = [lc.r * 1.05, lc.g * 1.05, lc.b * 1.05], bot = [lc.r * 0.5, lc.g * 0.5, lc.b * 0.5];
    const mb = new MeshBuilder(); let cum = 0; const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const i0 = mb.v(a[0], 0, a[1], cum, 0, top), i1 = mb.v(b[0], 0, b[1], cum + len, 0, top), i2 = mb.v(b[0], -D, b[1], cum + len, D, bot), i3 = mb.v(a[0], -D, a[1], cum, D, bot);
      mb.quad(i0, i1, i2, i3, new THREE.Vector3(-(b[1] - a[1]), 0, b[0] - a[0])); cum += len;
    }
    const ring = pts.map(([x, z]) => mb.v(x, -D, z, x, z, bot));
    THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []).forEach(([a, b, c]) => mb.tri(ring[a], ring[b], ring[c], up));
    const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: lmap, roughness: liner.roughness, envMapIntensity: 0.6 });
    const shell = new THREE.Mesh(mb.geometry(), shellMat); shell.receiveShadow = true; G.add(shell);

    // Playa, escalera romana y escalera de esquina
    const solid = new THREE.MeshStandardMaterial({ color: lc.clone().multiplyScalar(1.12), map: lmap, roughness: liner.roughness });
    const block = (geo, x, y, z) => { const m = new THREE.Mesh(geo, solid); m.position.set(x, y, z); m.receiveShadow = true; G.add(m); return m; };
    if (F.shelf) {
      const h = D + F.shelf.top - 0.01;
      block(new THREE.BoxGeometry(F.shelf.length, h, W - 0.02), (F.shelf.x0 + F.shelf.x1) / 2 - 0.005, F.shelf.top - h / 2, 0);
    }
    if (F.roman) F.roman.radii.forEach((r, k) => {
      const top = F.roman.tops[k], h = D + top - 0.01;
      block(new THREE.CylinderGeometry(r, r, h, 48), F.roman.cx, top - h / 2, F.roman.cz);
    });
    if (F.corner) F.corner.steps.forEach((s) => {
      const h = D + s.top - 0.01;
      block(new THREE.BoxGeometry(s.length, h, F.corner.width), F.corner.x + s.length / 2 + 0.005, s.top - h / 2, F.corner.z + F.corner.width / 2 + 0.01);
    });

    // Coronación: franja plana con borde frontal y labio hacia el agua
    const cmap = copingTexture(coping.texture).clone(); cmap.needsUpdate = true;
    const outer = offsetPoly(pts, copW), inner = offsetPoly(pts, -0.03), H = 0.04, cb = new MeshBuilder(); let cu = 0; const S = COPING_METERS;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, oa = outer[i], ob = outer[j], ia = inner[i], ib = inner[j], len = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]);
      const u0 = cu / S, u1 = (cu + len) / S, vv = (copW + 0.03) / S;
      cb.quad(cb.v(ia[0], H, ia[1], u0, 0), cb.v(oa[0], H, oa[1], u0, vv), cb.v(ob[0], H, ob[1], u1, vv), cb.v(ib[0], H, ib[1], u1, 0), up);
      const out = new THREE.Vector3(ob[1] - oa[1], 0, -(ob[0] - oa[0]));
      cb.quad(cb.v(oa[0], H, oa[1], u0, 0), cb.v(ob[0], H, ob[1], u1, 0), cb.v(ob[0], 0, ob[1], u1, H / S), cb.v(oa[0], 0, oa[1], u0, H / S), out);
      cb.quad(cb.v(ia[0], H, ia[1], u0, 0), cb.v(ib[0], H, ib[1], u1, 0), cb.v(ib[0], -0.06, ib[1], u1, (H + 0.06) / S), cb.v(ia[0], -0.06, ia[1], u0, (H + 0.06) / S), out.clone().negate());
      cu += len;
    }
    const cmesh = new THREE.Mesh(cb.geometry(), new THREE.MeshStandardMaterial({ map: cmap, roughness: 0.85, envMapIntensity: 0.4 }));
    cmesh.castShadow = cmesh.receiveShadow = true; G.add(cmesh);

    // Agua: 12 cm por debajo del borde, semitransparente, con normal map en movimiento
    const nm = waterNormal().clone(); nm.repeat.set(0.35, 0.35); nm.needsUpdate = true;
    const tint = lc.clone().lerp(new THREE.Color('#7fd8ea'), 0.6);
    const water = new THREE.Mesh(new THREE.ShapeGeometry(toShape(offsetPoly(pts, -0.02))),
      new THREE.MeshPhysicalMaterial({ color: tint, transparent: true, opacity: 0.66, roughness: 0.16, metalness: 0, envMapIntensity: 1.3, normalMap: nm, normalScale: new THREE.Vector2(0.25, 0.25), emissive: tint, emissiveIntensity: 0, depthWrite: false, clearcoat: 0.3 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -WATER_DROP; water.renderOrder = 2; G.add(water); this.water = water;

    // Focos LED en la pared del fondo
    if (cfg.extras.leds) {
      const count = ledCount(poolMetrics(cfg, copW), cat), x0 = -L / 2 + 0.9, x1 = L / 2 - 0.9;
      for (let i = 0; i < count; i++) {
        const x = count === 1 ? 0 : x0 + ((x1 - x0) * i) / (count - 1);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaeeaff, emissiveIntensity: 0 }));
        disc.position.set(x, -D * 0.55, -W / 2 + 0.012); G.add(disc); this.ledDiscs.push(disc);
      }
      const nLights = Math.min(4, count);
      for (let i = 0; i < nLights; i++) {
        const x = nLights === 1 ? 0 : x0 + ((x1 - x0) * i) / (nLights - 1);
        const pl = new THREE.PointLight(0x9fe8ff, 0, 8, 1.4); pl.position.set(x, -D * 0.55, -W / 2 + 0.35); G.add(pl); this.ledLights.push(pl);
      }
    }

    // Ducha exterior
    if (cfg.extras.shower) {
      const sg = new THREE.Group(), chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 0.85, roughness: 0.25 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 12), chrome); pole.position.y = 1.1;
      const headM = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 20), chrome); headM.position.set(0.12, 2.2, 0);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), chrome); arm.rotation.z = Math.PI / 2; arm.position.set(0.05, 2.2, 0);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0x777b7d, roughness: 0.7 })); base.position.y = 0.03;
      [pole, headM, arm, base].forEach((m) => { m.castShadow = true; sg.add(m); });
      sg.position.set(-L / 2 + 0.9, 0.012, W / 2 + copW + 1.1); G.add(sg);
    }

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
    this.controls.update();
    if (this.water) { const m = this.water.material.normalMap, t = (now - this.t0) / 1000; m.offset.set(t * 0.012, t * 0.008); }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }
}
