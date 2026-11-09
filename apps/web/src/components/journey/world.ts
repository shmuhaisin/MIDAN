/**
 * THE WORLD OF MIDAN — a stylized 3D Saudi city, rendered with three.js.
 *
 * Everything is generated in code: no downloaded models. The architectural vocabulary is Najdi (mud-brick blocks,
 * stepped merlons, triangular openings) meeting modern Riyadh (green-glass towers with gold fins), with landmarks that
 * echo the official MIDAN logo: an arch-topped tower, a pyramid tower with its sphere, a needle tower, a water tower,
 * a road that sweeps through the city, and a monumental doorway at the end of the journey.
 *
 * The page drives the world with one number, the journey position `s` (0 = arrival … 4 = destination). The car's place
 * on the road and the camera are pure functions of it, so the picture is always exactly where the scroll is.
 */
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Material,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  Scene,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type WorldOptions = { rtl: boolean; dark: boolean; quality: 'high' | 'low'; humaidanUrl: string };
export type World = {
  setPosition(s: number): void;
  setTheme(dark: boolean): void;
  setRtl(rtl: boolean): void;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): void;
};

/* ---------- Palette: the brand colours, lit for day and dusk ---------- */

const BRAND = { deep: '#0b3d2e', green: '#1f7a4d', mint: '#a7e3c2', ivory: '#f7f4e9', gold: '#d4af37' };

const THEMES = {
  light: {
    sky: ['#d9c69a', '#efdfba', '#e9e2c8'],
    fog: '#e6d6b2',
    fogNear: 60,
    fogFar: 330,
    ground: '#cfb281',
    plaza: '#e8dbbd',
    grass: '#7fb08c',
    road: '#2f3532',
    hemiSky: '#f6e7c6',
    hemiGround: '#8c6f45',
    hemi: 0.62,
    sun: '#ffcf8a',
    sunI: 4.2,
    sunDir: new Vector3(-0.62, 0.48, 0.62),
    windows: 0,
    lamps: 0,
    exposure: 0.92,
    figure: '#fff6e8',
    sunSprite: '#ffe3a1',
  },
  dark: {
    sky: ['#02100b', '#082a1f', '#164735'],
    fog: '#0b261c',
    fogNear: 55,
    fogFar: 300,
    ground: '#3a3a2c',
    plaza: '#4a4836',
    grass: '#24523a',
    road: '#171d1a',
    hemiSky: '#3f7a62',
    hemiGround: '#120f0a',
    hemi: 0.55,
    sun: '#cfe6ff',
    sunI: 0.75,
    sunDir: new Vector3(0.5, 0.75, 0.35),
    windows: 1.7,
    lamps: 3.2,
    exposure: 1.1,
    figure: '#c9d4cc',
    sunSprite: '#d4af37',
  },
};

/* ---------- Small helpers ---------- */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
const dummy = new Object3D();

function gradientTexture(stops: string[], width = 4, height = 512) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, height);
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function radialTexture(inner: string, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function mullionTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#9fb3aa';
  for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 1.5, 64);
  g.fillStyle = '#c7d3cd';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 1);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(2, 6);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A stepped Najdi merlon, 1 wide, 1 tall, 0.35 deep, standing on y=0. */
function merlonGeometry() {
  const s = new Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(-0.5, 0.32);
  s.lineTo(-0.28, 0.32);
  s.lineTo(-0.28, 0.62);
  s.lineTo(0, 1);
  s.lineTo(0.28, 0.62);
  s.lineTo(0.28, 0.32);
  s.lineTo(0.5, 0.32);
  s.lineTo(0.5, 0);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false });
  g.translate(0, 0, -0.175);
  return g;
}

function triangleGeometry() {
  const s = new Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0, 0.9);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
  g.translate(0, 0, -0.06);
  return g;
}

function archGeometry() {
  const s = new Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(-0.5, 0.62);
  s.absarc(0, 0.62, 0.5, Math.PI, 0, true);
  s.lineTo(0.5, 0);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -0.06);
  return g;
}

/** A palm frond, bent down at the tip, along +x from the crown. */
function frondGeometry() {
  const g = new PlaneGeometry(3.6, 0.85, 8, 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 1.8;
    const z = pos.getZ(i);
    const taper = 1 - x / 3.8;
    pos.setX(i, x);
    pos.setZ(i, z * Math.max(0.1, taper) * (0.6 + 0.4 * Math.sin((x / 3.6) * Math.PI)));
    pos.setY(i, -0.07 * x * x + 0.25 * x);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------- The world ---------- */

export function createWorld(canvas: HTMLCanvasElement, options: WorldOptions): World {
  const { quality } = options;
  const high = quality === 'high';
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.4));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.55;

  const camera = new PerspectiveCamera(40, 1, 0.5, 900);
  const world = new Group();
  scene.add(world);

  const disposables: { dispose(): void }[] = [envTexture, pmrem];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  /* --- Materials --- */
  const mat = {
    ground: track(new MeshStandardMaterial({ color: THEMES.light.ground, roughness: 1 })),
    plaza: track(new MeshStandardMaterial({ color: THEMES.light.plaza, roughness: 0.92 })),
    grass: track(new MeshStandardMaterial({ color: THEMES.light.grass, roughness: 1 })),
    road: track(new MeshStandardMaterial({ color: THEMES.light.road, roughness: 0.82 })),
    walk: track(new MeshStandardMaterial({ color: '#e2d2ad', roughness: 0.95 })),
    mud: track(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 })),
    trim: track(new MeshStandardMaterial({ color: '#a8824f', roughness: 0.9 })),
    opening: track(new MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.8, emissive: new Color('#ffc66b'), emissiveIntensity: 0 })),
    doorGlow: track(new MeshStandardMaterial({ color: '#f3c16a', emissive: new Color('#f1b94f'), emissiveIntensity: 0.7, roughness: 0.6 })),
    glass: track(new MeshPhysicalMaterial({ color: '#2a7a5c', map: track(mullionTexture()), metalness: 0.55, roughness: 0.12, clearcoat: 0.6, envMapIntensity: 1.4, emissive: new Color(BRAND.mint), emissiveIntensity: 0 })),
    gold: track(new MeshStandardMaterial({ color: BRAND.gold, metalness: 1, roughness: 0.28, emissive: new Color(BRAND.gold), emissiveIntensity: 0.06 })),
    goldGlow: track(new MeshStandardMaterial({ color: BRAND.gold, metalness: 0.6, roughness: 0.3, emissive: new Color(BRAND.gold), emissiveIntensity: 0.35 })),
    green: track(new MeshStandardMaterial({ color: BRAND.green, metalness: 0.2, roughness: 0.4 })),
    deep: track(new MeshStandardMaterial({ color: BRAND.deep, metalness: 0.25, roughness: 0.45 })),
    mintGlass: track(new MeshPhysicalMaterial({ color: BRAND.mint, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.72, emissive: new Color(BRAND.mint), emissiveIntensity: 0.25 })),
    water: track(new MeshPhysicalMaterial({ color: '#5fae96', metalness: 0.1, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6 })),
    frond: track(new MeshStandardMaterial({ color: '#3f7a4c', roughness: 0.85, side: DoubleSide })),
    trunk: track(new MeshStandardMaterial({ color: '#8a6a45', roughness: 1 })),
    pole: track(new MeshStandardMaterial({ color: '#28302c', metalness: 0.6, roughness: 0.4 })),
    lamp: track(new MeshStandardMaterial({ color: '#2d332f', metalness: 0.5, roughness: 0.4, emissive: new Color('#ffdc9a'), emissiveIntensity: 0 })),
    lantern: track(new MeshStandardMaterial({ color: BRAND.gold, metalness: 0.7, roughness: 0.3, emissive: new Color('#f3c56a'), emissiveIntensity: 0.4 })),
    awning: [track(new MeshStandardMaterial({ color: BRAND.mint, roughness: 0.9, side: DoubleSide })), track(new MeshStandardMaterial({ color: BRAND.gold, roughness: 0.9, side: DoubleSide })), track(new MeshStandardMaterial({ color: BRAND.green, roughness: 0.9, side: DoubleSide }))],
    line: track(new MeshStandardMaterial({ color: '#f7efd6', roughness: 0.7, emissive: new Color(BRAND.gold), emissiveIntensity: 0.12 })),
  };

  const geo = {
    box: track(new BoxGeometry(1, 1, 1)),
    merlon: track(merlonGeometry()),
    tri: track(triangleGeometry()),
    arch: track(archGeometry()),
    frond: track(frondGeometry()),
    trunk: track(new CylinderGeometry(0.16, 0.26, 1, 7, 4)),
    pole: track(new CylinderGeometry(0.06, 0.09, 1, 6)),
  };

  /* --- Instanced collections, filled while the city is laid out --- */
  type Batch = { geometry: BufferGeometry; material: Material; matrices: Matrix4[]; colors?: Color[]; shadow?: boolean; receive?: boolean };
  const batches: Record<string, Batch> = {};
  const batch = (name: string, geometry: BufferGeometry, material: Material, shadow = true, receive = true) =>
    (batches[name] ??= { geometry, material, matrices: [], shadow, receive });
  const put = (name: string, m: Matrix4, color?: Color) => {
    const b = batches[name];
    b.matrices.push(m.clone());
    if (color) (b.colors ??= []).push(color);
  };
  const place = (pos: Vector3, scale: Vector3, rotY = 0, rotX = 0, rotZ = 0) => {
    dummy.position.copy(pos);
    dummy.scale.copy(scale);
    dummy.rotation.set(rotX, rotY, rotZ);
    dummy.updateMatrix();
    return dummy.matrix;
  };

  batch('mud', geo.box, mat.mud);
  batch('trim', geo.box, mat.trim);
  batch('merlon', geo.merlon, mat.mud);
  batch('opening', geo.tri, mat.opening, false);
  batch('door', geo.box, mat.opening, false);
  batch('arch', geo.arch, mat.doorGlow, false);
  batch('glass', geo.box, mat.glass);
  batch('glassCyl', track(new CylinderGeometry(0.5, 0.5, 1, 14)), mat.glass);
  batch('glassTaper', track(new CylinderGeometry(0.36, 0.5, 1, 4, 1).rotateY(Math.PI / 4)), mat.glass);
  batch('gold', geo.box, mat.gold);
  batch('trunk', geo.trunk, mat.trunk);
  batch('frond', geo.frond, mat.frond);
  batch('pole', geo.pole, mat.pole, false);
  batch('lamp', geo.box, mat.lamp, false);
  batch('lantern', track(new SphereGeometry(0.5, 12, 8)), mat.lantern, false);
  batch('dash', geo.box, mat.line, false);

  const sand = ['#d6b07a', '#cba16a', '#dfc08e', '#c4955c', '#e6cfa3', '#d2a978'].map((c) => new Color(c));
  const random = rng(20261108);

  /* --- The road: the logo's sweep, through the city --- */
  const curve = new CatmullRomCurve3(
    [
      [-90, 34], [-62, 28], [-36, 16], [-10, 4], [18, -6], [46, -8], [74, 0], [102, 8], [130, 2], [156, -10], [182, -14], [212, -10], [240, -4],
    ].map(([x, z]) => new Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.5,
  );
  const SAMPLES = 700;
  const roadPts = curve.getSpacedPoints(SAMPLES);
  const frameAt = (t: number) => {
    const p = curve.getPointAt(MathUtils.clamp(t, 0, 1));
    const tan = curve.getTangentAt(MathUtils.clamp(t, 0, 1));
    const n = new Vector3(-tan.z, 0, tan.x).normalize(); // +n is the right-hand (south) side
    return { p, tan, n, yaw: Math.atan2(-tan.z, tan.x) };
  };
  const distToRoad = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < roadPts.length; i += 3) {
      const dx = roadPts[i].x - x;
      const dz = roadPts[i].z - z;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
  };

  function ribbon(inner: number, outer: number, y: number, material: Material, receive = true) {
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const { p, n } = frameAt(t);
      for (const off of [inner, outer]) {
        positions.push(p.x + n.x * off, y, p.z + n.z * off);
        uvs.push(off === inner ? 0 : 1, t * 60);
      }
      if (i < SAMPLES) {
        const a = i * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = track(new BufferGeometry());
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex(index);
    g.computeVertexNormals();
    const m = new Mesh(g, material);
    m.receiveShadow = receive;
    world.add(m);
    return m;
  }

  // Ground, road, pavements, gold edges.
  const ground = new Mesh(track(new PlaneGeometry(1400, 1400)), mat.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);
  ribbon(-4.6, 4.6, 0.04, mat.road);
  ribbon(4.6, 7.2, 0.09, mat.walk);
  ribbon(-7.2, -4.6, 0.09, mat.walk);
  ribbon(4.25, 4.45, 0.05, mat.goldGlow, false);
  ribbon(-4.45, -4.25, 0.05, mat.goldGlow, false);
  for (let d = 0; d < 1; d += 1 / 120) {
    const { p, yaw } = frameAt(d);
    put('dash', place(new Vector3(p.x, 0.06, p.z), new Vector3(2.4, 0.02, 0.16), yaw));
  }

  /* --- Building blocks --- */

  /** A Najdi block: mud-brick body, a darker plinth band, merlons around the parapet, triangular openings and a door. */
  function najdi(x: number, z: number, w: number, d: number, h: number, yaw: number, color?: Color) {
    const c = color ?? sand[Math.floor(random() * sand.length)];
    const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const at = (lx: number, ly: number, lz: number) => new Vector3(lx, ly, lz).applyQuaternion(rot).add(new Vector3(x, 0, z));
    put('mud', place(at(0, h / 2, 0), new Vector3(w, h, d), yaw), c);
    put('trim', place(at(0, h - 0.25, 0), new Vector3(w + 0.12, 0.3, d + 0.12), yaw));
    const size = 0.9;
    const edges: [number, number, number, number, number][] = [
      [0, d / 2, w, 0, 0], [0, -d / 2, w, 0, Math.PI], [w / 2, 0, d, 1, -Math.PI / 2], [-w / 2, 0, d, 1, Math.PI / 2],
    ];
    for (const [ex, ez, len, axis, face] of edges) {
      const count = Math.max(2, Math.floor(len / 1.3));
      for (let i = 0; i < count; i++) {
        const o = -len / 2 + (len / count) * (i + 0.5);
        const pos = axis === 0 ? at(o, h, ez * 0.98) : at(ex * 0.98, h, o);
        put('merlon', place(pos, new Vector3(size, size, 1), yaw + face), c);
      }
    }
    // Openings on the two long faces, a row near the top and doors at street level.
    for (const sideZ of [d / 2 + 0.03, -d / 2 - 0.03]) {
      const face = sideZ > 0 ? 0 : Math.PI;
      const count = Math.max(1, Math.floor(w / 2.4));
      for (let i = 0; i < count; i++) {
        const o = -w / 2 + (w / count) * (i + 0.5);
        if (h > 4) put('opening', place(at(o, h * 0.68, sideZ), new Vector3(0.7, 0.75, 1), yaw + face));
        if (h > 7.5) put('opening', place(at(o, h * 0.4, sideZ), new Vector3(0.55, 0.6, 1), yaw + face));
      }
      if (random() > 0.35) put('door', place(at((random() - 0.5) * w * 0.6, 0.95, sideZ), new Vector3(0.95, 1.9, 0.1), yaw));
    }
  }

  /** A Najdi storey standing at height y: used to build stepped towers tier by tier. */
  function storey(x: number, z: number, w: number, d: number, y: number, h: number, yaw: number, color: Color) {
    const before = batches.mud.matrices.length;
    const beforeM = batches.merlon.matrices.length;
    const beforeT = batches.trim.matrices.length;
    const beforeO = batches.opening.matrices.length;
    const beforeD = batches.door.matrices.length;
    najdi(x, z, w, d, h, yaw, color);
    const lift = new Matrix4().makeTranslation(0, y, 0);
    for (const [name, from] of [['mud', before], ['merlon', beforeM], ['trim', beforeT], ['opening', beforeO]] as const) {
      const list = batches[name].matrices;
      for (let i = from; i < list.length; i++) list[i].premultiply(lift);
    }
    // Upper storeys have no street doors.
    if (y > 0) batches.door.matrices.length = beforeD;
  }

  /** A green-glass tower: sand podium, shaft, a setback, gold crown and fins. Three families of form. */
  function tower(x: number, z: number, w: number, d: number, h: number, yaw: number) {
    const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const at = (lx: number, ly: number, lz: number) => new Vector3(lx, ly, lz).applyQuaternion(rot).add(new Vector3(x, 0, z));
    const tint = () => new Color().setHSL(0.41 + random() * 0.05, 0.3 + random() * 0.15, 0.3 + random() * 0.12);
    const kind = random();
    const podium = 4 + random() * 3;
    put('mud', place(at(0, podium / 2, 0), new Vector3(w + 2.4, podium, d + 2.4), yaw), sand[Math.floor(random() * sand.length)]);
    put('trim', place(at(0, podium + 0.15, 0), new Vector3(w + 2.6, 0.3, d + 2.6), yaw));
    const shaft = h - podium;
    if (kind < 0.33) {
      // A round tower with a slimmer top drum.
      put('glassCyl', place(at(0, podium + shaft * 0.36, 0), new Vector3(w, shaft * 0.72, w), yaw), tint());
      put('glassCyl', place(at(0, podium + shaft * 0.86, 0), new Vector3(w * 0.72, shaft * 0.28, w * 0.72), yaw), tint());
      put('gold', place(at(0, h + 0.2, 0), new Vector3(w * 0.5, 0.4, w * 0.5), yaw));
    } else if (kind < 0.6) {
      // A tapering tower.
      put('glassTaper', place(at(0, podium + shaft / 2, 0), new Vector3(w * 1.2, shaft, d * 1.2), yaw), tint());
      put('gold', place(at(0, h + 2, 0), new Vector3(0.2, 4, 0.2), yaw));
    } else {
      // A slab with a setback and gold fins.
      const lower = shaft * (0.55 + random() * 0.2);
      put('glass', place(at(0, podium + lower / 2, 0), new Vector3(w, lower, d), yaw), tint());
      put('glass', place(at(0, podium + lower + (shaft - lower) / 2, 0), new Vector3(w * 0.7, shaft - lower, d * 0.7), yaw), tint());
      put('gold', place(at(0, podium + lower + 0.15, 0), new Vector3(w + 0.2, 0.3, d + 0.2), yaw));
      for (const fx of [-w / 2, w / 2]) put('gold', place(at(fx, podium + lower / 2, d / 2 + 0.05), new Vector3(0.14, lower, 0.14), yaw));
      put('gold', place(at(0, h + 0.3, 0), new Vector3(w * 0.6, 0.6, d * 0.6), yaw));
    }
  }

  function palm(x: number, z: number, h = 6 + random() * 3) {
    // Never in a camera's way.
    if (cameraZones.some((r) => (r.x - x) ** 2 + (r.z - z) ** 2 < r.r * r.r)) return;
    const lean = (random() - 0.5) * 0.18;
    put('trunk', place(new Vector3(x, h / 2, z), new Vector3(1, h, 1), 0, lean, lean * 0.5));
    const top = new Vector3(x + Math.sin(lean * 0.5) * h * 0.5, h, z - Math.sin(lean) * h * 0.5);
    const spin = random() * Math.PI;
    for (let i = 0; i < 8; i++) {
      put('frond', place(top, new Vector3(0.9 + random() * 0.25, 1, 1), spin + (i / 8) * Math.PI * 2, 0, -0.15 + random() * 0.25));
    }
  }

  /* --- Destinations --- */
  const STOPS = [0.045, 0.27, 0.5, 0.72, 0.955];
  const stop = STOPS.map((t) => frameAt(t));
  const reserved: { x: number; z: number; r: number }[] = [];
  const cameraZones: { x: number; z: number; r: number }[] = [];
  const reserve = (p: Vector3, r: number) => reserved.push({ x: p.x, z: p.z, r });

  /*
   * Camera keyframes, one per scene, in the road's own frame at that stop: f = forward along the road, r = to the
   * right-hand side, u = up. Positions and sightlines are kept clear of buildings.
   */
  type Key = { pos: [number, number, number]; look: [number, number, number]; fov: number };
  const KEYS: Key[] = [
    { pos: [-10, 6.4, 3.6], look: [9, -4, 3.4], fov: 46 }, // 01 arrival: the car in the foreground, the city ahead
    { pos: [11, 2.2, 2.3], look: [-1, 0, 1.25], fov: 38 }, // 02 discovery: on the road, the car coming through the souq
    { pos: [10, -6.4, 2.6], look: [-2, 8, 6.5], fov: 50 }, // 03 skills: low from the kerb, the towers behind the car
    { pos: [40, 1.8, 3], look: [0, 0, 14], fov: 52 }, // 04 interviews: looking back under the skybridge
    { pos: [-42, 19, 16], look: [7, -3, 12], fov: 46 }, // 05 destination: the wide reveal of the gateway
  ];
  const inFrame = (k: number, [f, r, u]: [number, number, number]) =>
    stop[k].p.clone().addScaledVector(stop[k].tan, f).addScaledVector(stop[k].n, r).setY(u);
  /** On portrait screens the camera stands further back, horizontally, with a wider lens. */
  const PORTRAIT_PULL = 1.25;
  const portraitOf = (pos: Vector3, look: Vector3) => new Vector3(look.x + (pos.x - look.x) * PORTRAIT_PULL, pos.y, look.z + (pos.z - look.z) * PORTRAIT_PULL);
  KEYS.forEach((key, k) => {
    const wide = inFrame(k, key.pos);
    const tall = portraitOf(wide, inFrame(k, key.look));
    for (const cam of [wide, tall]) {
      cameraZones.push({ x: cam.x, z: cam.z, r: 7 }, ...[0.3, 0.6].map((a) => { const m = cam.clone().lerp(stop[k].p, a); return { x: m.x, z: m.z, r: 4 }; }));
      reserve(cam, 9);
      // The line from the camera to the car stays open.
      for (const a of [0.25, 0.5, 0.75]) reserve(cam.clone().lerp(stop[k].p, a), 5);
    }
  });

  // Lamps along both sides.
  for (let d = 0.01; d < 1; d += 1 / 46) {
    const { p, n, yaw } = frameAt(d);
    for (const side of [-1, 1]) {
      const base = p.clone().addScaledVector(n, side * 6.6);
      if (reserved.some((r) => (r.x - base.x) ** 2 + (r.z - base.z) ** 2 < 36)) continue;
      put('pole', place(new Vector3(base.x, 2.6, base.z), new Vector3(1, 5.2, 1)));
      put('lamp', place(new Vector3(base.x - n.x * side * 0.45, 5.2, base.z - n.z * side * 0.45), new Vector3(0.3, 0.12, 0.95), yaw));
    }
  }

  // 01 Arrival: a fountain plaza (the logo's fountain), ringed by palms.
  {
    const { p, n } = stop[0];
    const c = p.clone().addScaledVector(n, 17);
    reserve(c, 19);
    const plaza = new Mesh(track(new CircleGeometry(15, 48)), mat.plaza);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(c.x, 0.07, c.z);
    plaza.receiveShadow = true;
    world.add(plaza);
    const rim = new Mesh(track(new CylinderGeometry(7, 7.2, 0.7, 48)), mat.trim);
    rim.position.set(c.x, 0.35, c.z);
    rim.receiveShadow = rim.castShadow = true;
    world.add(rim);
    const water = new Mesh(track(new CircleGeometry(6.6, 48)), mat.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(c.x, 0.62, c.z);
    world.add(water);
    const jet = new Mesh(track(new CylinderGeometry(0.15, 1.2, 7, 24, 1, true)), track(new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false })));
    jet.position.set(c.x, 4, c.z);
    world.add(jet);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      palm(c.x + Math.cos(a) * 11.5, c.z + Math.sin(a) * 11.5, 7 + random() * 2);
    }
    // A low wall with merlons behind the plaza.
    najdi(c.x + n.x * 17, c.z + n.z * 17, 30, 2, 2.6, stop[0].yaw);
  }

  // 02 Discovery: an arcaded souq along the road, doorways glowing, awnings on the other side.
  {
    const { p, n, tan, yaw } = stop[1];
    const north = p.clone().addScaledVector(n, -13);
    reserve(north, 26);
    reserve(p.clone().addScaledVector(n, 13), 20);
    najdi(north.x, north.z, 44, 8, 10, yaw, sand[4]);
    for (let i = 0; i < 12; i++) {
      const o = -19.5 + i * 3.55;
      const front = north.clone().addScaledVector(tan, o).addScaledVector(n, 4.06);
      put('arch', place(new Vector3(front.x, 0, front.z), new Vector3(2.2, 4.2, 1), yaw));
      put('gold', place(new Vector3(front.x, 6.4, front.z), new Vector3(0.6, 0.6, 0.12), yaw + Math.PI / 4, 0, 0));
    }
    // A taller corner tower with a stepped crown.
    const corner = north.clone().addScaledVector(tan, 24);
    najdi(corner.x, corner.z, 7, 7, 15, yaw, sand[0]);
    // Market stalls with brand-coloured awnings on the south side.
    for (let i = 0; i < 7; i++) {
      const base = p.clone().addScaledVector(n, 11).addScaledVector(tan, -15 + i * 5);
      najdi(base.x, base.z, 4, 4, 3.6, yaw, sand[(i + 2) % sand.length]);
      const aw = new Mesh(geo.box, mat.awning[i % 3]);
      aw.scale.set(4.2, 0.08, 2.4);
      aw.position.set(base.x - n.x * 2.9, 2.9, base.z - n.z * 2.9);
      aw.rotation.set(0, yaw, 0);
      aw.rotateX(0.32);
      aw.castShadow = true;
      world.add(aw);
    }
    // Lanterns strung across the road.
    for (let i = 0; i < 5; i++) {
      const at = p.clone().addScaledVector(tan, -12 + i * 6);
      for (let k = -3; k <= 3; k++) put('lantern', place(at.clone().addScaledVector(n, k * 1.8).setY(7.4 - Math.abs(k) * 0.12), new Vector3(0.6, 0.8, 0.6)));
    }
  }

  // 03 Skills and assessment: stepped towers and a hall with a giant triangular window.
  {
    const { p, n, tan, yaw } = stop[2];
    const south = p.clone().addScaledVector(n, 18);
    reserve(south, 30);
    for (const [o, tiers, w] of [[-14, 5, 11], [2, 6, 13], [16, 4, 10]] as const) {
      const base = south.clone().addScaledVector(tan, o).addScaledVector(n, 6);
      let y = 0;
      for (let k = 0; k < tiers; k++) {
        const s = w * (1 - k * 0.14);
        const h = 4.2;
        storey(base.x, base.z, s, s, y, h, yaw, sand[(k + 1) % sand.length]);
        put('glass', place(new Vector3(base.x, y + h * 0.42, base.z), new Vector3(s * 0.7, 1.1, s * 1.012), yaw), new Color(BRAND.mint));
        y += h;
      }
      put('gold', place(new Vector3(base.x, y + 2, base.z), new Vector3(0.25, 4, 0.25), yaw));
    }
    // The assessment hall faces the road.
    const hall = p.clone().addScaledVector(n, 13).addScaledVector(tan, 30);
    reserve(hall, 16);
    put('mud', place(new Vector3(hall.x, 6, hall.z), new Vector3(20, 12, 12), yaw), sand[4]);
    const triShape = new Shape();
    triShape.moveTo(-6, 0);
    triShape.lineTo(6, 0);
    triShape.lineTo(0, 10);
    triShape.closePath();
    const tri = new Mesh(track(new ExtrudeGeometry(triShape, { depth: 0.4, bevelEnabled: false })), mat.mintGlass);
    tri.position.copy(hall.clone().addScaledVector(n, -6.1)).setY(0.6);
    tri.rotation.y = yaw + Math.PI;
    world.add(tri);
    const roof = new Mesh(geo.box, mat.gold);
    roof.scale.set(24, 0.5, 15);
    roof.position.set(hall.x, 12.4, hall.z);
    roof.rotation.y = yaw;
    roof.castShadow = true;
    world.add(roof);
  }

  // 04 Interviews: twin towers joined by a skybridge over the road.
  {
    const { p, n, tan, yaw } = stop[3];
    const a = p.clone().addScaledVector(n, -15).addScaledVector(tan, 6);
    const b = p.clone().addScaledVector(n, 15).addScaledVector(tan, 6);
    reserve(a, 14);
    reserve(b, 14);
    tower(a.x, a.z, 9, 9, 40, yaw);
    tower(b.x, b.z, 9, 9, 40, yaw);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    const bridge = new Mesh(geo.box, mat.glass);
    bridge.scale.set(4.5, 3.4, len);
    bridge.position.set(mid.x, 25, mid.z);
    bridge.rotation.y = yaw;
    bridge.castShadow = true;
    world.add(bridge);
    for (const y of [23.2, 26.8]) {
      const rail = new Mesh(geo.box, mat.gold);
      rail.scale.set(4.7, 0.25, len);
      rail.position.set(mid.x, y, mid.z);
      rail.rotation.y = yaw;
      world.add(rail);
    }
    // Courtyard gardens at the towers' feet.
    for (const c of [a, b]) {
      const lawn = new Mesh(track(new CircleGeometry(9, 32)), mat.grass);
      lawn.rotation.x = -Math.PI / 2;
      lawn.position.set(c.x, 0.08, c.z);
      lawn.receiveShadow = true;
      world.add(lawn);
      for (let i = 0; i < 5; i++) palm(c.x + (random() - 0.5) * 14, c.z + (random() - 0.5) * 14, 6);
    }
  }

  // 05 Destination: the MIDAN gateway, the doorway at the heart of the logo, wrapped in its sweeping ribbons.
  const gateCentre = stop[4].p.clone();
  {
    const { p, n, tan, yaw } = stop[4];
    reserve(p, 34);
    const shape = new Shape();
    shape.moveTo(-11, 0);
    shape.lineTo(-11, 26);
    shape.lineTo(11, 26);
    shape.lineTo(11, 0);
    shape.lineTo(7, 0);
    shape.lineTo(7, 22);
    shape.lineTo(-7, 22);
    shape.lineTo(-7, 0);
    shape.closePath();
    const gate = new Mesh(track(new ExtrudeGeometry(shape, { depth: 5, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 2 })), mat.deep);
    gate.position.copy(p.clone().addScaledVector(tan, 2.5));
    gate.rotation.y = yaw + Math.PI / 2;
    gate.castShadow = gate.receiveShadow = true;
    world.add(gate);
    const inner = new Mesh(track(new ExtrudeGeometry((() => {
      const s = new Shape();
      s.moveTo(-7, 0); s.lineTo(-7, 22); s.lineTo(7, 22); s.lineTo(7, 0); s.lineTo(6.5, 0); s.lineTo(6.5, 21.5); s.lineTo(-6.5, 21.5); s.lineTo(-6.5, 0); s.closePath();
      return s;
    })(), { depth: 5.4, bevelEnabled: false })), mat.goldGlow);
    inner.position.copy(gate.position).addScaledVector(tan, -0.2);
    inner.rotation.copy(gate.rotation);
    world.add(inner);
    // Merlons along the lintel.
    for (let i = 0; i < 14; i++) {
      const o = -10 + (20 / 13) * i;
      const pos = p.clone().addScaledVector(n, o).addScaledVector(tan, 5);
      put('merlon', place(new Vector3(pos.x, 26.3, pos.z), new Vector3(1.3, 1.3, 14), yaw + Math.PI / 2), new Color(BRAND.deep));
    }
    // The ribbons: gold and green arcs sweeping around the gateway.
    // Flat bands, as in the logo: a thin rectangle swept along each arc.
    const ribbons: [number, number, number, Material, number][] = [
      [30, 1.1, 0.16, mat.goldGlow, 0], [35, 2.4, 0.22, mat.green, 0.5], [40, 0.8, 0.12, mat.goldGlow, 1.1],
    ];
    for (const [r, band, tilt, material, phase] of ribbons) {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const a = phase + Math.PI * 0.15 + (i / 64) * Math.PI * 1.25;
        pts.push(new Vector3(Math.cos(a) * r, 2 + Math.sin(a * 1.5 + phase) * 6 + i * tilt * 0.6, Math.sin(a) * r * 0.62));
      }
      const section = new Shape();
      section.moveTo(-0.07, -band / 2);
      section.lineTo(0.07, -band / 2);
      section.lineTo(0.07, band / 2);
      section.lineTo(-0.07, band / 2);
      section.closePath();
      const tube = new Mesh(track(new ExtrudeGeometry(section, { steps: 200, bevelEnabled: false, extrudePath: new CatmullRomCurve3(pts) })), material);
      tube.position.copy(p);
      tube.rotation.y = yaw;
      tube.castShadow = true;
      world.add(tube);
    }
    // An avenue of palms on the far side, so the final shot sees the car arrive.
    for (let i = 0; i < 6; i++) {
      for (const side of [-1]) {
        const at = p.clone().addScaledVector(tan, -10 - i * 7).addScaledVector(n, side * 9);
        palm(at.x, at.z, 8 + random() * 2);
      }
    }
  }

  /* --- Landmarks on the skyline, after the logo --- */
  {
    // An arch-topped tower: two horns around a parabolic opening.
    const s = new Shape();
    s.moveTo(-9, 0);
    s.lineTo(-6.5, 58);
    s.quadraticCurveTo(-6, 66, -5, 72);
    s.quadraticCurveTo(0, 52, 5, 72);
    s.quadraticCurveTo(6, 66, 6.5, 58);
    s.lineTo(9, 0);
    s.closePath();
    const arch = new Mesh(track(new ExtrudeGeometry(s, { depth: 9, bevelEnabled: true, bevelSize: 0.4, bevelThickness: 0.4, bevelSegments: 2, curveSegments: 24 })), mat.glass);
    arch.position.set(96, 0, -96);
    arch.rotation.y = -0.25;
    arch.castShadow = true;
    world.add(arch);
    const bridge = new Mesh(geo.box, mat.gold);
    bridge.scale.set(9, 1.4, 9.6);
    bridge.position.set(0, 66.5, 4.5);
    arch.add(bridge);
    reserve(new Vector3(100, 0, -92), 16);

    // A pyramid tower with its golden sphere.
    const pyr = new Mesh(track(new ConeGeometry(10, 64, 4, 1)), mat.glass);
    pyr.position.set(40, 32, -104);
    pyr.rotation.y = Math.PI / 4;
    pyr.castShadow = true;
    world.add(pyr);
    const ball = new Mesh(track(new SphereGeometry(3.4, 32, 16)), mat.gold);
    ball.position.set(40, 44, -101.5);
    world.add(ball);
    const spire = new Mesh(geo.pole, mat.gold);
    spire.scale.set(1.6, 12, 1.6);
    spire.position.set(40, 69, -104);
    world.add(spire);
    reserve(new Vector3(40, 0, -104), 14);

    // A needle tower.
    const needle = new Mesh(track(new CylinderGeometry(0.6, 5.5, 92, 6)), mat.glass);
    needle.position.set(158, 46, -112);
    needle.castShadow = true;
    world.add(needle);
    const needleTip = new Mesh(geo.pole, mat.gold);
    needleTip.scale.set(1.5, 18, 1.5);
    needleTip.position.set(158, 100, -112);
    world.add(needleTip);
    reserve(new Vector3(158, 0, -112), 10);

    // A water tower.
    const profile = [
      [0, 0], [2.2, 0], [1.6, 1], [1.4, 26], [7, 30], [10.5, 33], [9, 36], [5, 38.5], [0.5, 40], [0, 40],
    ].map(([x, y]) => new Vector2(x, y));
    const water = new Mesh(track(new LatheGeometry(profile, 36)), mat.trim);
    water.position.set(-12, 0, -78);
    water.castShadow = true;
    world.add(water);
    const waterTip = new Mesh(geo.pole, mat.gold);
    waterTip.scale.set(1.2, 6, 1.2);
    waterTip.position.set(-12, 43, -78);
    world.add(waterTip);
    reserve(new Vector3(-12, 0, -78), 12);
  }

  /* --- The city around the road --- */
  {
    const density = high ? 1 : 0.6;
    const isReserved = (x: number, z: number) => reserved.some((r) => (r.x - x) ** 2 + (r.z - z) ** 2 < r.r * r.r);
    for (let x = -150; x <= 300; x += 12) {
      for (let z = -170; z <= 110; z += 12) {
        if (random() > density) continue;
        const jx = x + (random() - 0.5) * 6;
        const jz = z + (random() - 0.5) * 6;
        const d = distToRoad(jx, jz);
        if (d < 15 || isReserved(jx, jz)) continue;
        // Align with the nearest stretch of road, for a city that follows its street.
        let nearest = 0;
        let best = Infinity;
        for (let i = 0; i < roadPts.length; i += 10) {
          const dd = (roadPts[i].x - jx) ** 2 + (roadPts[i].z - jz) ** 2;
          if (dd < best) {
            best = dd;
            nearest = i;
          }
        }
        const yaw = frameAt(nearest / SAMPLES).yaw + (random() > 0.85 ? Math.PI / 2 : 0);
        const downtown = jz < -50 && jx > -30 && jx < 200;
        if (downtown && random() > 0.35) {
          tower(jx, jz, 6 + random() * 4, 6 + random() * 4, 22 + random() * (jz < -85 ? 46 : 26), yaw);
        } else {
          const w = 5 + random() * 6;
          const dd = 5 + random() * 5;
          najdi(jx, jz, w, dd, 3.5 + random() * (d < 30 ? 6 : 9), yaw);
          if (random() > 0.7) najdi(jx + (random() - 0.5) * 3, jz + (random() - 0.5) * 3, w * 0.5, dd * 0.5, 9 + random() * 5, yaw);
        }
        if (random() > 0.72) palm(jx + 6, jz + 4);
      }
    }
    // An avenue of palms along the road.
    for (let d = 0.02; d < 0.94; d += 1 / 70) {
      const { p, n } = frameAt(d);
      const side = Math.round(d * 70) % 2 ? 1 : -1;
      const at = p.clone().addScaledVector(n, side * 8.6);
      if (!isReserved(at.x, at.z)) palm(at.x, at.z, 6.5 + random() * 2);
    }
  }

  /* --- Turn batches into instanced meshes --- */
  for (const b of Object.values(batches)) {
    if (!b.matrices.length) continue;
    const mesh = new InstancedMesh(b.geometry, b.material, b.matrices.length);
    b.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (b.colors && b.colors.length === b.matrices.length) b.colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = Boolean(b.shadow);
    mesh.receiveShadow = Boolean(b.receive);
    mesh.computeBoundingSphere();
    world.add(mesh);
    disposables.push(mesh);
  }

  /* --- The MIDAN car: an open grand tourer, deep green with a gold beltline --- */
  const car = new Group();
  const paint = track(new MeshPhysicalMaterial({ color: '#17654a', metalness: 0.62, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.6 }));
  const leather = track(new MeshStandardMaterial({ color: '#c8b28a', roughness: 0.7 }));
  const darkTrim = track(new MeshStandardMaterial({ color: '#0d1512', roughness: 0.5, metalness: 0.4 }));
  const tyre = track(new MeshStandardMaterial({ color: '#151917', roughness: 0.92 }));
  const glassMat = track(new MeshPhysicalMaterial({ color: '#cfe9dc', metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.28, envMapIntensity: 2 }));
  const headlight = track(new MeshStandardMaterial({ color: BRAND.mint, emissive: new Color(BRAND.mint), emissiveIntensity: 1.6 }));
  const taillight = track(new MeshStandardMaterial({ color: '#e7a33e', emissive: new Color('#e98d2a'), emissiveIntensity: 1.2 }));
  {
    // Side profile, x forward, y up. The cockpit is a dip in the profile; door panels close the sides.
    const s = new Shape();
    s.moveTo(-2.3, 0.3);
    s.quadraticCurveTo(-2.42, 0.55, -2.25, 0.84);
    s.lineTo(-1.0, 0.9);
    s.quadraticCurveTo(-0.92, 0.88, -0.9, 0.62);
    s.lineTo(0.32, 0.62);
    s.quadraticCurveTo(0.42, 0.9, 0.55, 0.92);
    s.quadraticCurveTo(1.6, 0.86, 2.05, 0.76);
    s.quadraticCurveTo(2.42, 0.66, 2.4, 0.42);
    s.lineTo(2.32, 0.3);
    s.lineTo(1.86, 0.3);
    s.absarc(1.42, 0.36, 0.44, 0, Math.PI, false);
    s.lineTo(-0.98, 0.3);
    s.absarc(-1.42, 0.36, 0.44, 0, Math.PI, false);
    s.closePath();
    const body = new Mesh(track(new ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelSize: 0.14, bevelThickness: 0.14, bevelSegments: 5, curveSegments: 18 })), paint);
    body.position.z = -0.81;
    body.castShadow = body.receiveShadow = true;
    car.add(body);
    // Door panels.
    const door = new Shape();
    door.moveTo(-0.92, 0.3);
    door.lineTo(-0.92, 0.9);
    door.lineTo(0.42, 0.9);
    door.lineTo(0.38, 0.3);
    door.closePath();
    for (const z of [-0.95, 0.83]) {
      const d = new Mesh(track(new ExtrudeGeometry(door, { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 })), paint);
      d.position.z = z;
      d.castShadow = true;
      car.add(d);
    }
    // Gold beltline along both flanks.
    for (const z of [-0.97, 0.97]) {
      const belt = new Mesh(geo.box, mat.gold);
      belt.scale.set(4.5, 0.06, 0.05);
      belt.position.set(0.05, 0.78, z > 0 ? 0.985 : -0.985);
      car.add(belt);
    }
    // One central seat: a single-seat speedster, so the driver is seen from either side.
    {
      const seat = new Mesh(geo.box, leather);
      seat.scale.set(0.66, 0.2, 0.7);
      seat.position.set(-0.45, 0.66, 0);
      car.add(seat);
      const back = new Mesh(geo.box, leather);
      back.scale.set(0.16, 0.5, 0.66);
      back.position.set(-0.82, 0.92, 0);
      back.rotation.z = 0.18;
      car.add(back);
    }
    const dash = new Mesh(geo.box, darkTrim);
    dash.scale.set(0.3, 0.16, 1.6);
    dash.position.set(0.28, 0.86, 0);
    car.add(dash);
    const shield = new Mesh(track(new PlaneGeometry(1.7, 0.52)), glassMat);
    shield.position.set(0.42, 1.12, 0);
    shield.rotation.set(0, Math.PI / 2, 0);
    shield.rotateX(-0.95);
    car.add(shield);
    const frame = new Mesh(geo.box, mat.gold);
    frame.scale.set(0.04, 0.04, 1.72);
    frame.position.set(0.26, 1.36, 0);
    car.add(frame);
    // Lights.
    for (const z of [-0.6, 0.6]) {
      const hl = new Mesh(geo.box, headlight);
      hl.scale.set(0.08, 0.06, 0.5);
      hl.position.set(2.4, 0.6, z);
      car.add(hl);
      const wrap = new Mesh(geo.box, headlight);
      wrap.scale.set(0.42, 0.05, 0.05);
      wrap.position.set(2.18, 0.64, z > 0 ? 0.95 : -0.95);
      car.add(wrap);
    }
    const tl = new Mesh(geo.box, taillight);
    tl.scale.set(0.05, 0.05, 1.6);
    tl.position.set(-2.38, 0.66, 0);
    car.add(tl);
    // Fender flares: sculpted arches over each wheel.
    const flare = track(new TorusGeometry(0.5, 0.1, 10, 28, Math.PI));
    for (const x of [1.42, -1.42]) {
      for (const z of [-0.93, 0.93]) {
        const f = new Mesh(flare, paint);
        f.position.set(x, 0.36, z);
        f.castShadow = true;
        car.add(f);
      }
    }
    // Speedster humps behind the seats: the car's signature silhouette.
    const hump = track(new SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2));
    for (const z of [-0.5, 0.5]) {
      const h = new Mesh(hump, paint);
      h.scale.set(2.1, 0.9, 1);
      h.position.set(-1.45, 0.88, z);
      h.castShadow = true;
      car.add(h);
    }
    // A dark sill for visual weight, and a grille with gold bars.
    for (const z of [-0.97, 0.97]) {
      const sill = new Mesh(geo.box, darkTrim);
      sill.scale.set(1.6, 0.09, 0.06);
      sill.position.set(0, 0.34, z);
      car.add(sill);
    }
    const grille = new Mesh(geo.box, darkTrim);
    grille.scale.set(0.08, 0.2, 0.9);
    grille.position.set(2.43, 0.44, 0);
    car.add(grille);
    for (const y of [0.4, 0.47]) {
      const bar = new Mesh(geo.box, mat.gold);
      bar.scale.set(0.09, 0.025, 0.86);
      bar.position.set(2.44, y, 0);
      car.add(bar);
    }
    // A gold MIDAN mark on the bonnet: the Najdi triangle.
    const mark = new Mesh(geo.tri, mat.gold);
    mark.scale.set(0.24, 0.24, 0.3);
    mark.position.set(1.7, 0.93, 0);
    mark.rotation.set(-Math.PI / 2 + 0.12, 0, Math.PI / 2);
    car.add(mark);
  }
  const wheels: Group[] = [];
  {
    const tyreGeo = track(new CylinderGeometry(0.37, 0.37, 0.3, 32));
    tyreGeo.rotateX(Math.PI / 2);
    const rimGeo = track(new CylinderGeometry(0.25, 0.25, 0.32, 24));
    rimGeo.rotateX(Math.PI / 2);
    const spokeGeo = track(mergeGeometries([0, 1, 2, 3, 4].map((i) => {
      const g = new BoxGeometry(0.42, 0.06, 0.05);
      g.rotateZ((i / 5) * Math.PI);
      return g;
    })));
    for (const [x, z] of [[1.42, 0.86], [1.42, -0.86], [-1.42, 0.86], [-1.42, -0.86]]) {
      const w = new Group();
      w.position.set(x, 0.37, z);
      const t = new Mesh(tyreGeo, tyre);
      t.castShadow = true;
      const rim = new Mesh(rimGeo, darkTrim);
      const spokes = new Mesh(spokeGeo, mat.gold);
      spokes.position.z = z > 0 ? 0.13 : -0.13;
      w.add(t, rim, spokes);
      car.add(w);
      wheels.push(w);
    }
  }
  // A soft contact shadow, so the car always sits on the road.
  const blobTex = track(radialTexture('rgba(0,0,0,0.55)'));
  const blob = new Mesh(track(new PlaneGeometry(6.2, 3.2)), track(new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.1;
  car.add(blob);
  // A closed underbody between the wheels: the driver's whole figure stands in the cockpit, and nothing of it shows
  // through the gap under the car.
  {
    const floor = new Mesh(geo.box, darkTrim);
    floor.scale.set(3.3, 0.3, 1.5);
    floor.position.set(0, 0.16, 0);
    car.add(floor);
  }
  world.add(car);

  // Humaidan in the cockpit: the original artwork, whole and uncropped (docs/product/humaidan-assets-readme.txt), at its
  // own proportions (1086 x 1448). The figure stands upright in the open car; the car's body and floor hide what a car
  // would hide, so only his top shows above the door line, as before, without cutting the image.
  const figureMat = track(new MeshBasicMaterial({ color: THEMES.light.figure, transparent: false, alphaTest: 0.5, side: DoubleSide }));
  const FIGURE_W = 1.64;
  const FIGURE_H = FIGURE_W * (1448 / 1086);
  const figureGeo = track(new PlaneGeometry(FIGURE_W, FIGURE_H));
  const figure = new Mesh(figureGeo, figureMat);
  scene.add(figure);
  let figureTex: Texture | null = null;
  new TextureLoader().load(options.humaidanUrl, (tex) => {
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    figureTex = tex;
    figureMat.map = tex;
    figureMat.needsUpdate = true;
    dirty = true;
    renderNow();
  });
  // The figure's centre, in the car's frame: the same point of the image as before sits at the door line (y 0.54).
  const seat = new Vector3(-0.5, 0.54 - 0.45 * FIGURE_H + FIGURE_H / 2, 0);

  /* --- Light and atmosphere --- */
  const hemi = new HemisphereLight(THEMES.light.hemiSky, THEMES.light.hemiGround, THEMES.light.hemi);
  scene.add(hemi);
  const sun = new DirectionalLight(THEMES.light.sun, THEMES.light.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunSprite = new Sprite(track(new SpriteMaterial({ map: track(radialTexture('rgba(255,236,190,1)')), blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true })));
  sunSprite.scale.set(120, 120, 1);
  scene.add(sunSprite);
  scene.fog = new Fog(THEMES.light.fog, THEMES.light.fogNear, THEMES.light.fogFar);

  let skyTex: Texture | null = null;
  function applyTheme(dark: boolean) {
    const th = dark ? THEMES.dark : THEMES.light;
    skyTex?.dispose();
    skyTex = gradientTexture(th.sky);
    scene.background = skyTex;
    (scene.fog as Fog).color.set(th.fog);
    (scene.fog as Fog).near = th.fogNear;
    (scene.fog as Fog).far = th.fogFar;
    mat.ground.color.set(th.ground);
    mat.plaza.color.set(th.plaza);
    mat.grass.color.set(th.grass);
    mat.road.color.set(th.road);
    hemi.color.set(th.hemiSky);
    hemi.groundColor.set(th.hemiGround);
    hemi.intensity = th.hemi;
    sun.color.set(th.sun);
    sun.intensity = th.sunI;
    sunDir.copy(th.sunDir).normalize();
    mat.opening.emissiveIntensity = th.windows;
    mat.glass.emissiveIntensity = dark ? 0.12 : 0;
    mat.lamp.emissiveIntensity = th.lamps;
    mat.lantern.emissiveIntensity = dark ? 2.2 : 0.4;
    mat.doorGlow.emissiveIntensity = dark ? 1.6 : 0.6;
    figureMat.color.set(th.figure);
    (sunSprite.material as SpriteMaterial).color.set(th.sunSprite);
    (sunSprite.material as SpriteMaterial).opacity = dark ? 0.45 : 0.9;
    scene.environmentIntensity = dark ? 0.3 : 0.4;
    renderer.toneMappingExposure = th.exposure;
    dirty = true;
  }
  const sunDir = new Vector3();

  /* --- Camera choreography: one keyframe per scene, relative to where the car stops --- */
  const keyAt = (k: number) => ({ pos: inFrame(k, KEYS[k].pos), look: inFrame(k, KEYS[k].look), fov: KEYS[k].fov });

  let rtl = options.rtl;
  let s = 0;
  let width = 1;
  let height = 1;
  let dirty = true;
  const camPos = new Vector3();
  const camLook = new Vector3();
  const tmp = new Vector3();

  function update() {
    const k = Math.min(3, Math.floor(s));
    const f = smoother(MathUtils.clamp(s - k, 0, 1));
    const last = s >= 4;
    // The car: its place on the road and its heading.
    const t = last ? STOPS[4] : MathUtils.lerp(STOPS[k], STOPS[k + 1], f);
    const fr = frameAt(t);
    car.position.copy(fr.p);
    car.rotation.y = fr.yaw;
    world.updateMatrixWorld(true);
    const travelled = t * curve.getLength();
    for (const w of wheels) w.rotation.z = -travelled / 0.37;
    // The camera between this scene's keyframe and the next.
    const a = keyAt(k);
    const b = keyAt(Math.min(4, k + 1));
    const ff = last ? 1 : f;
    camPos.lerpVectors(a.pos, b.pos, ff);
    camLook.lerpVectors(a.look, b.look, ff);
    // While travelling, lift the camera a little so the move reads as one continuous shot.
    const lift = Math.sin(ff * Math.PI) * (k === 0 || k === 3 ? 4 : 2.5);
    camPos.y += lift;
    const fov = MathUtils.lerp(a.fov, b.fov, ff);
    const portrait = width / height < 0.85;
    if (portrait) {
      // Pull back horizontally only: a shot that looks up must never sink below the street.
      camPos.copy(portraitOf(camPos, camLook));
    }
    camPos.y = Math.max(camPos.y, 1.3);
    const mirror = rtl ? -1 : 1;
    camera.position.set(camPos.x * mirror, camPos.y, camPos.z);
    camera.fov = portrait ? fov + 16 : fov;
    camera.lookAt(camLook.x * mirror, camLook.y, camLook.z);
    // Frame the subject away from the copy: to the end side on wide screens, lower on phones.
    const shiftX = portrait ? 0 : width * 0.14 * (rtl ? 1 : -1);
    const shiftY = portrait ? -height * 0.17 : height * 0.06;
    camera.setViewOffset(width, height, shiftX, shiftY, width, height);
    camera.updateProjectionMatrix();
    // Humaidan, seated, turned to the camera.
    const seatWorld = car.localToWorld(seat.clone());
    figure.position.copy(seatWorld);
    figure.rotation.set(0, Math.atan2(camera.position.x - seatWorld.x, camera.position.z - seatWorld.z), 0);
    // The sun follows the focus, so shadows stay sharp where the eye is.
    const focus = tmp.set(camLook.x * mirror, 0, camLook.z);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(new Vector3(sunDir.x * mirror, sunDir.y, sunDir.z), 200);
    sun.target.updateMatrixWorld();
    // The visible sun disc sits low behind the destination.
    const sunAt = gateCentre.clone().addScaledVector(stop[4].tan, 200).addScaledVector(stop[4].n, -30).setY(34);
    sunSprite.position.set(sunAt.x * mirror, sunAt.y, sunAt.z);
  }

  function setRtl(next: boolean) {
    rtl = next;
    world.scale.x = rtl ? -1 : 1;
    dirty = true;
  }

  function renderNow() {
    if (!dirty) return;
    update();
    renderer.render(scene, camera);
    dirty = false;
  }

  applyTheme(options.dark);
  setRtl(options.rtl);

  return {
    setPosition(next) {
      if (Math.abs(next - s) < 1e-5) return;
      s = MathUtils.clamp(next, 0, 4);
      dirty = true;
    },
    setTheme(dark) {
      applyTheme(dark);
    },
    setRtl,
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      dirty = true;
    },
    render: renderNow,
    dispose() {
      skyTex?.dispose();
      figureTex?.dispose();
      for (const d of disposables) d.dispose();
      scene.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
