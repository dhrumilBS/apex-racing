/* ==========================================================================
   APEX — Rosso Study
   Three.js (real GLB + HDRI) · GSAP + ScrollTrigger + SplitText · Lenis
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const { gsap, ScrollTrigger, SplitText, Lenis } = window;
gsap.registerPlugin(ScrollTrigger, SplitText);

const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const isSmall = () => innerWidth < 900;

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const easeInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const DEG = Math.PI / 180;
const ENV_BASE_ROTATION = 1.1; // keeps the studio softbox off the windscreen in the hero shot
const ENV_PEAK = 4.5;          // HDR radiance clamp — keep below the bloom threshold
const BLOOM_THRESHOLD = 5;

/* --------------------------------------------------------------------------
   Smooth scroll
   -------------------------------------------------------------------------- */

const lenis = reducedMotion ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
if (lenis) {
  lenis.stop();
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

$$('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const target = $(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { duration: 2.4, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else target.scrollIntoView();
  });
});

/* --------------------------------------------------------------------------
   Camera poses — orbit coordinates around a target.
   az: degrees around Y (180 = in front of the nose, 90 = right side, 0 = rear)
   shift / shiftY: screen-space offset of the subject (fraction of viewport)
   -------------------------------------------------------------------------- */

const P = (o) => ({ tgt: [0, 0.55, 0], fov: 30, shift: 0, shiftY: 0, speed: 0, glow: 0, ...o });

const POSES = {
  intro:      P({ az: 205, dist: 13, y: 0.6, fov: 24 }),
  hero:       P({ az: 138, dist: 8.6, y: 1.05, fov: 28, shiftY: -0.12 }),
  side:       P({ az: 90, dist: 7.6, y: 0.8, fov: 28, shift: 0.2 }),
  top:        P({ az: 62, dist: 3.2, y: 8.2, tgt: [0, 0, 0.1], fov: 34, shift: -0.2 }),
  topEnd:     P({ az: 18, dist: 3.6, y: 8.6, tgt: [0, 0, 0.1], fov: 34, shift: -0.2 }),
  wheel:      P({ az: 122, dist: 2.7, y: 0.62, tgt: [0.82, 0.4, -1.15], fov: 30, shift: -0.26 }),
  rear:       P({ az: 30, dist: 4.4, y: 1.15, tgt: [0.15, 0.62, 1.7], fov: 32, shift: -0.24, glow: 1 }),
  chase:      P({ az: -18, dist: 6.6, y: 0.62, fov: 36, speed: 0.25, glow: 1 }),
  chaseFast:  P({ az: -42, dist: 5.6, y: 0.42, fov: 46, speed: 1, glow: 1 }),
  frontLow:   P({ az: -128, dist: 5.4, y: 0.3, fov: 44, speed: 1, glow: 1 }),
  studio:     P({ az: -218, dist: 8, y: 1.9, fov: 28, shift: -0.2, tgt: [0, 0.45, 0] }),
  studioEnd:  P({ az: -238, dist: 7.4, y: 1.5, fov: 28, shift: -0.2, tgt: [0, 0.45, 0] }),
  orbit0:     P({ az: -238, dist: 7.6, y: 1.5, fov: 28, shiftY: 0.12 }),
  orbit1:     P({ az: -598, dist: 7.6, y: 1.5, fov: 28, shiftY: 0.12 }),
  headOn:     P({ az: -540, dist: 9.5, y: 0.7, tgt: [0, 0.6, 0], fov: 24, shiftY: 0.16, glow: 1 }),
  headOnEnd:  P({ az: -540, dist: 7.2, y: 0.55, tgt: [0, 0.6, 0], fov: 24, shiftY: 0.2, glow: 1 })
};
const RIG_KEYS = ['az', 'dist', 'y', 'fov', 'shift', 'shiftY', 'speed', 'glow'];

function makeRig(p) {
  return { az: p.az, dist: p.dist, y: p.y, fov: p.fov, shift: p.shift, shiftY: p.shiftY, speed: p.speed, glow: p.glow, tx: p.tgt[0], ty: p.tgt[1], tz: p.tgt[2] };
}
function mixPose(a, b, t, out) {
  for (const k of RIG_KEYS) out[k] = lerp(a[k], b[k], t);
  out.tx = lerp(a.tgt[0], b.tgt[0], t);
  out.ty = lerp(a.tgt[1], b.tgt[1], t);
  out.tz = lerp(a.tgt[2], b.tgt[2], t);
  return out;
}

/* --------------------------------------------------------------------------
   Renderer / scene
   -------------------------------------------------------------------------- */

const canvas = $('.webgl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  console.warn('WebGL unavailable', err);
}

const scene = new THREE.Scene();
const BG = new THREE.Color(0x060608);
scene.background = BG;
scene.fog = new THREE.Fog(0x060608, 10, 26);
scene.environmentIntensity = 1.25; // compensates for the clamped HDR peaks

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 120);
const carRoot = new THREE.Group();
scene.add(carRoot);

let composer, bloomPass, floorOverlay, streaks, reflector;
const wheels = [];
const glowMaterials = [];
let bodyMaterial, rimMaterial;

const state = {
  ready: false,
  intro: 0,
  lights: 0,
  exposure: 0,
  dampLambda: 1.1,
  pointer: { x: 0, y: 0, sx: 0, sy: 0 },
  drag: 0,
  dragTarget: 0,
  hotspotAlpha: 0,
  detailProgress: 0,
  perfProgress: 0,
  travel: 0,
  time: 0
};

const target = makeRig(POSES.intro);
const rig = makeRig(POSES.intro);

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, isSmall() ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  buildFloor();
  buildStreaks();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // High threshold: only emissive light signatures and hot speculars bloom
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.55, BLOOM_THRESHOLD);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

function buildFloor() {
  if (!isSmall()) {
    reflector = new Reflector(new THREE.PlaneGeometry(80, 80), {
      textureWidth: Math.round(innerWidth * 0.6),
      textureHeight: Math.round(innerHeight * 0.6),
      color: 0x5c5c5c,
      clipBias: 0.003
    });
    reflector.rotation.x = -Math.PI / 2;
    scene.add(reflector);
  }

  floorOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0x060608) },
        uOffset: { value: 0 },
        uGrid: { value: 0.55 },
        uMinAlpha: { value: reflector ? 0.84 : 1 }
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uOffset;
        uniform float uGrid;
        uniform float uMinAlpha;
        varying vec3 vWorld;
        void main() {
          float d = length(vWorld.xz);
          float a = mix(uMinAlpha, 1.0, smoothstep(2.0, 13.0, d));
          vec2 g = vec2(vWorld.x, vWorld.z + uOffset) * 0.5;
          vec2 gl = abs(fract(g - 0.5) - 0.5) / fwidth(g);
          float line = 1.0 - min(min(gl.x, gl.y), 1.0);
          float fade = 1.0 - smoothstep(1.5, 16.0, d);
          vec3 col = uColor + vec3(line * 0.09 * fade * uGrid);
          col += vec3(0.035) * (1.0 - smoothstep(0.0, 6.0, d));
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    })
  );
  floorOverlay.rotation.x = -Math.PI / 2;
  floorOverlay.position.y = 0.002;
  floorOverlay.renderOrder = 1;
  scene.add(floorOverlay);
}

function buildStreaks() {
  const count = isSmall() ? 70 : 160;
  const geo = new THREE.PlaneGeometry(0.018, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.4, 2.4, 2.6),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true
  });
  streaks = new THREE.InstancedMesh(geo, mat, count);
  streaks.userData.items = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    // Two bands only — floor reflections and a ceiling light tunnel — so no
    // streak ever crosses the camera at eye level.
    const side = Math.random() < 0.5 ? -1 : 1;
    const ceiling = Math.random() < 0.35;
    const item = {
      x: side * (ceiling ? 0.5 + Math.random() * 5 : 1.8 + Math.random() * 7),
      y: ceiling ? 3.2 + Math.random() * 1.6 : 0.012 + Math.random() * 0.02,
      z: (Math.random() - 0.5) * 60,
      len: 1.5 + Math.random() * 5,
      v: 0.7 + Math.random() * 0.6
    };
    streaks.userData.items.push(item);
    m.makeScale(1, 1, item.len).setPosition(item.x, item.y, item.z);
    streaks.setMatrixAt(i, m);
  }
  streaks.frustumCulled = false;
  scene.add(streaks);
}

/* --------------------------------------------------------------------------
   Loading — real byte progress drives the preloader counter
   -------------------------------------------------------------------------- */

const loadProgress = { glb: 0, hdr: 0, shown: 0 };
const loaderNum = $('.loader__num');
const loaderBar = $('.loader__bar i');
const loaderStatus = $('.loader__status');

function setProgress() {
  const p = loadProgress.glb * 0.75 + loadProgress.hdr * 0.25;
  gsap.to(loadProgress, {
    shown: p,
    duration: 0.6,
    ease: 'power2.out',
    overwrite: true,
    onUpdate() {
      loaderNum.textContent = String(Math.round(loadProgress.shown * 100)).padStart(3, '0');
      loaderBar.style.transform = `scaleX(${loadProgress.shown})`;
    }
  });
}

function loadEnvironment() {
  return new Promise((resolve) => {
    if (!renderer) return resolve();
    const pmrem = new THREE.PMREMGenerator(renderer);
    new RGBELoader().setDataType(THREE.FloatType).load(
      'assets/hdr/studio.hdr',
      (tex) => {
        // Clamp the softboxes: reflections stay crisp, but only true light
        // sources (emissive LEDs, streaks) are bright enough to bloom.
        const data = tex.image.data;
        for (let i = 0; i < data.length; i++) if (data[i] > ENV_PEAK) data[i] = ENV_PEAK;
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
        pmrem.dispose();
        loadProgress.hdr = 1;
        setProgress();
        resolve();
      },
      (e) => { if (e.total) { loadProgress.hdr = e.loaded / e.total; setProgress(); } },
      () => resolve()
    );
  });
}

function loadCar() {
  return new Promise((resolve) => {
    if (!renderer) return resolve();
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    loader.load(
      'assets/models/ferrari.glb',
      (gltf) => {
        loaderStatus.textContent = 'Compiling materials';
        setupCar(gltf.scene.children[0]);
        loadProgress.glb = 1;
        setProgress();
        resolve();
      },
      (e) => { if (e.total) { loadProgress.glb = e.loaded / e.total; setProgress(); } },
      (err) => { console.warn('Model failed to load', err); resolve(); }
    );
  });
}

function setupCar(model) {
  bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xb3000c, metalness: 0.62, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.02
  });
  rimMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.22 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1
  });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x0d0d10, metalness: 0.7, roughness: 0.38 });
  const leatherMaterial = new THREE.MeshStandardMaterial({ color: 0x16120f, metalness: 0, roughness: 0.62 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x121215, metalness: 1, roughness: 0.3 });

  model.getObjectByName('body').material = bodyMaterial;
  ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl'].forEach((n) => { model.getObjectByName(n).material = rimMaterial; });
  model.getObjectByName('trim').material = trimMaterial;
  model.getObjectByName('glass').material = glassMaterial;
  // GLTFLoader de-duplicates names (centre, centre_1, …) and a node can be a
  // Mesh or a Group of primitives — so match the family and paint every mesh.
  const paintAll = (name, mat) => {
    const family = new RegExp(`^${name}(_\\d+)?$`);
    model.traverse((o) => {
      if (family.test(o.name)) o.traverse((m) => { if (m.isMesh) m.material = mat; });
    });
  };
  paintAll('leather', leatherMaterial);
  paintAll('centre', capMaterial); // de-badge the wheel caps
  paintAll('plastic_gray', new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.1, roughness: 0.7 }));
  paintAll('carbon_fibre', new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.5, roughness: 0.35 }));
  // the model's material names are swapped: "interior_dark" is the light-grey arch liners + floor
  paintAll('interior_dark', new THREE.MeshStandardMaterial({ color: 0x09090b, metalness: 0, roughness: 0.85 }));
  paintAll('wheel', new THREE.MeshStandardMaterial({ color: 0x1b1b1f, metalness: 1, roughness: 0.32 })); // rim barrel
  paintAll('brake', new THREE.MeshStandardMaterial({ color: 0x3a3a3f, metalness: 1, roughness: 0.45 }));
  paintAll('tire', new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.88 }));
  paintAll('interior_light', new THREE.MeshStandardMaterial({ color: 0x0f0f11, metalness: 0.2, roughness: 0.6 })); // grilles + cabin tub
  const shields = model.getObjectByName('yellow_trim'); // fender shields
  if (shields) shields.visible = false;

  // Emissive light signatures (bloom picks them up)
  const glow = (name, color, intensity) => {
    const obj = model.getObjectByName(name);
    if (!obj) return;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.emissive = new THREE.Color(color);
      o.material.emissiveIntensity = 0;
      o.material.userData.maxGlow = intensity;
      glowMaterials.push(o.material);
    });
  };
  glow('leds', 0xffffff, 18);
  glow('lights', 0xdfe8ff, 1.4);
  glow('lights_red', 0xff1a10, 14);
  glow('steering_red_lights', 0xff1a10, 3);

  ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].forEach((n) => wheels.push(model.getObjectByName(n)));

  // Baked ambient occlusion contact shadow
  const ao = new THREE.TextureLoader().load('assets/models/ferrari_ao.png');
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
    new THREE.MeshBasicMaterial({ map: ao, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  shadow.renderOrder = 2;
  model.add(shadow);

  carRoot.add(model);
  renderer.compile(scene, camera);
  state.ready = true;
}

/* --------------------------------------------------------------------------
   Scroll keyframes → camera rig
   -------------------------------------------------------------------------- */

let keys = [];
let hScrollST;

function docY(el, at) {
  const r = el.getBoundingClientRect();
  const top = r.top + scrollY;
  if (at === 'start') return top;
  if (at === 'center') return top + r.height / 2 - innerHeight / 2;
  return top + r.height - innerHeight; // 'end'
}

function computeKeys() {
  const sec = (id) => document.getElementById(id);
  const silhouette = sec('form').nextElementSibling;
  const maxY = ScrollTrigger.maxScroll(window);
  keys = [
    { y: 0, pose: POSES.hero },
    { y: docY(sec('form'), 'center'), pose: POSES.side },
    { y: docY(silhouette, 'start') + innerHeight * 0.2, pose: POSES.top },
    { y: docY(silhouette, 'end'), pose: POSES.topEnd },
    { y: docY(sec('detail'), 'start') + innerHeight * 0.1, pose: POSES.wheel },
    { y: docY(sec('detail'), 'center'), pose: POSES.wheel },
    { y: docY(sec('detail'), 'end'), pose: POSES.rear },
    { y: docY(sec('performance'), 'start'), pose: POSES.chase },
    { y: docY(sec('performance'), 'center') - innerHeight * 0.3, pose: POSES.chaseFast },
    { y: docY(sec('performance'), 'end'), pose: POSES.frontLow },
    { y: docY(sec('atelier'), 'start') + innerHeight * 0.4, pose: POSES.studio },
    { y: docY(sec('atelier'), 'end'), pose: POSES.studioEnd },
    { y: hScrollST ? hScrollST.start : docY(sec('chapters'), 'start'), pose: POSES.orbit0 },
    { y: hScrollST ? hScrollST.end : docY(sec('chapters'), 'end'), pose: POSES.orbit1 },
    { y: docY(sec('finale'), 'center'), pose: POSES.headOn },
    { y: maxY, pose: POSES.headOnEnd }
  ];
  // guarantee monotonic order
  for (let i = 1; i < keys.length; i++) keys[i].y = Math.max(keys[i].y, keys[i - 1].y + 1);
}

function poseFromScroll(y, out) {
  if (!keys.length) return mixPose(POSES.hero, POSES.hero, 0, out);
  if (y <= keys[0].y) return mixPose(keys[0].pose, keys[0].pose, 0, out);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (y <= b.y) return mixPose(a.pose, b.pose, easeInOut((y - a.y) / (b.y - a.y)), out);
  }
  const last = keys[keys.length - 1].pose;
  return mixPose(last, last, 0, out);
}

function fitDistance() {
  // Push the camera back on narrow / portrait viewports so the car always fits.
  const aspect = innerWidth / innerHeight;
  return clamp(1.45 / aspect, 1, 2.3);
}

/* --------------------------------------------------------------------------
   Render loop
   -------------------------------------------------------------------------- */

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const hotspotEls = $$('.hotspot');
const HOTSPOTS = [
  { pos: new THREE.Vector3(0.98, 0.4, -1.15), win: [0.05, 0.55] },
  { pos: new THREE.Vector3(1.0, 0.62, 0.55), win: [0.05, 0.5] },
  { pos: new THREE.Vector3(0.98, 0.4, 1.5), win: [0.5, 0.98] },
  { pos: new THREE.Vector3(0.0, 0.42, 2.18), win: [0.55, 0.98] }
];
const hudKmh = $('.hud__kmh');
const hudLine = $('.hud__line i');

function tick(time, deltaMs) {
  if (!renderer) return;
  const dt = Math.min(deltaMs / 1000, 0.05);
  state.time += dt;

  // 1. Where the scroll wants the camera
  if (state.intro >= 1) poseFromScroll(scrollY, target);

  // 2. Critically damped follow — gives everything weight
  const L = state.dampLambda;
  for (const k of [...RIG_KEYS, 'tx', 'ty', 'tz']) rig[k] = damp(rig[k], target[k], L, dt);

  state.pointer.sx = damp(state.pointer.sx, state.pointer.x, 3, dt);
  state.pointer.sy = damp(state.pointer.sy, state.pointer.y, 3, dt);
  state.drag = damp(state.drag, state.dragTarget, 6, dt);

  // 3. Camera placement
  const small = isSmall();
  const dist = rig.dist * fitDistance();
  const az = (rig.az + state.pointer.sx * 4) * DEG;
  const shake = rig.speed * 0.012;
  camera.position.set(
    rig.tx + Math.sin(az) * dist + Math.sin(state.time * 37) * shake,
    rig.y + state.pointer.sy * 0.25 + Math.sin(state.time * 53) * shake,
    rig.tz + Math.cos(az) * dist
  );
  camera.lookAt(rig.tx, rig.ty, rig.tz);
  camera.fov = rig.fov;
  const w = innerWidth, h = innerHeight;
  // view offset: +shift moves the subject right, +shiftY moves it up
  camera.setViewOffset(w, h, small ? 0 : -rig.shift * w, rig.shiftY * h * (small ? 0.5 : 1), w, h);
  camera.updateProjectionMatrix();

  carRoot.rotation.y = state.drag;

  // 4. Motion: wheels, floor, streaks
  const speed = rig.speed;
  state.travel += dt * (speed * 34);
  wheels.forEach((wh) => { if (wh) wh.rotation.x -= dt * speed * 60; });
  if (floorOverlay) floorOverlay.material.uniforms.uOffset.value = state.travel;

  if (streaks) {
    streaks.material.opacity = clamp((speed - 0.15) * 1.25) * 0.85;
    streaks.visible = streaks.material.opacity > 0.01;
    if (streaks.visible) {
      streaks.userData.items.forEach((it, i) => {
        it.z += dt * speed * 70 * it.v;
        if (it.z > 30) it.z -= 60;
        tmpM.makeScale(1, 1, it.len * (0.4 + speed)).setPosition(it.x, it.y, it.z);
        streaks.setMatrixAt(i, tmpM);
      });
      streaks.instanceMatrix.needsUpdate = true;
    }
  }

  // 5. Lights, reflections, exposure
  const glowLevel = state.lights * (0.35 + rig.glow * 0.65);
  glowMaterials.forEach((m) => { m.emissiveIntensity = m.userData.maxGlow * glowLevel; });
  scene.environmentRotation.y = ENV_BASE_ROTATION + scrollY * 0.00022 + state.travel * 0.002;
  renderer.toneMappingExposure = state.exposure;
  if (bloomPass) bloomPass.strength = 0.3 + speed * 0.3;

  // 6. Hotspots — 3D anchors projected to the screen
  if (state.ready) {
    carRoot.updateMatrixWorld();
    HOTSPOTS.forEach((hs, i) => {
      const el = hotspotEls[i];
      const p = state.detailProgress;
      const win = clamp((p - hs.win[0]) / 0.08) * clamp((hs.win[1] - p) / 0.08);
      const a = win * state.hotspotAlpha;
      if (a < 0.01) { el.style.opacity = 0; return; }
      tmpV.copy(hs.pos).applyMatrix4(carRoot.matrixWorld).project(camera);
      if (tmpV.z > 1) { el.style.opacity = 0; return; }
      el.style.opacity = a;
      el.style.transform = `translate3d(${(tmpV.x * 0.5 + 0.5) * w}px, ${(-tmpV.y * 0.5 + 0.5) * h}px, 0)`;
    });
  }

  // 7. HUD
  const maxY = ScrollTrigger.maxScroll(window) || 1;
  hudLine.style.transform = `scaleX(${scrollY / maxY})`;
  const vel = lenis ? Math.abs(lenis.velocity) : 0;
  const kmh = Math.min(325, Math.round(speed * 325 + vel * 4));
  hudKmh.textContent = String(kmh).padStart(3, '0');

  composer.render(dt);
}

function onResize() {
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, isSmall() ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
}
addEventListener('resize', onResize);

/* --------------------------------------------------------------------------
   GSAP choreography
   -------------------------------------------------------------------------- */

function formatNumber(v, decimals) {
  return decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US');
}

function buildScrollAnimations() {
  // Section headlines — masked line reveals
  $$('.split-lines').forEach((el) => {
    SplitText.create(el, {
      type: 'lines', mask: 'lines', autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, {
        yPercent: 110, rotate: 2, duration: 1.3, ease: 'expo.out', stagger: 0.1,
        scrollTrigger: { trigger: el, start: 'top 82%', toggleActions: 'play none none reverse' }
      })
    });
  });

  $$('.split-body').forEach((el) => {
    SplitText.create(el, {
      type: 'lines', mask: 'lines', autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, {
        yPercent: 100, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.06, delay: 0.15,
        scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' }
      })
    });
  });

  $$('.eyebrow').forEach((el) => {
    gsap.from(el, {
      opacity: 0, x: -24, duration: 1, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none reverse' }
    });
  });

  // Spec counters
  $$('.specs [data-count], .stat__value[data-count]').forEach((el) => {
    if (el.closest('.performance')) return; // scrubbed below
    const end = parseFloat(el.dataset.count);
    const decimals = +el.dataset.decimals || 0;
    const o = { v: 0 };
    gsap.to(o, {
      v: end, duration: 2, ease: 'expo.out',
      onUpdate: () => { el.textContent = formatNumber(o.v, decimals); },
      scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reset' }
    });
  });

  $$('.specs > div, .detail-list li').forEach((el, i) => {
    gsap.from(el, {
      opacity: 0, y: 30, duration: 1, ease: 'expo.out', delay: (i % 3) * 0.08,
      scrollTrigger: { trigger: el, start: 'top 92%', toggleActions: 'play none none reverse' }
    });
  });

  // Detail — drives the projected hotspots
  ScrollTrigger.create({
    trigger: '#detail',
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => { state.detailProgress = self.progress; },
    onToggle: (self) => gsap.to(state, { hotspotAlpha: self.isActive ? 1 : 0, duration: 0.6 })
  });

  // Performance — one scrubbed timeline: title, rev bar, counters
  const perfStats = $$('.performance .stat__value');
  const perfTitle = $('.performance__title');
  const perfSplit = SplitText.create(perfTitle, { type: 'words,chars' });
  const perf = gsap.timeline({
    scrollTrigger: { trigger: '.performance', start: 'top top', end: 'bottom bottom', scrub: 0.8 }
  });
  perf
    .from(perfSplit.chars, { yPercent: 120, stagger: 0.04, duration: 0.5, ease: 'power3.out' }, 0)
    .from('.performance .eyebrow', { opacity: 0, duration: 0.3 }, 0)
    .from('.stats .stat', { opacity: 0, y: 40, stagger: 0.06, duration: 0.4 }, 0.15)
    .to('.rev__bar i', { scaleX: 0.42, duration: 0.5, ease: 'power2.in' }, 0.2)
    .to('.rev__bar i', { scaleX: 0.3, duration: 0.06 })
    .to('.rev__bar i', { scaleX: 0.78, duration: 0.5, ease: 'power2.in' })
    .to('.rev__bar i', { scaleX: 0.62, duration: 0.06 })
    .to('.rev__bar i', { scaleX: 1, duration: 0.6, ease: 'power2.in' })
    .to(perfSplit.chars, { letterSpacing: '0.02em', duration: 1.2, ease: 'none' }, 0.4)
    .to({}, { duration: 0.3 });
  const perfCounters = perfStats.map((el) => ({ el, end: parseFloat(el.dataset.count), decimals: +el.dataset.decimals || 0, o: { v: 0 } }));
  perfCounters.forEach((c, i) => {
    perf.to(c.o, {
      v: c.end, duration: 1.1, ease: 'power2.out',
      onUpdate: () => { c.el.textContent = formatNumber(c.o.v, c.decimals); }
    }, 0.2 + i * 0.05);
  });

  // Marquee — infinite loop whose speed and direction react to scroll velocity
  const marqueeTrack = $('.marquee__track');
  const marquee = gsap.to(marqueeTrack, { xPercent: -50, duration: 22, ease: 'none', repeat: -1 });
  let marqueeDir = 1;
  ScrollTrigger.create({
    trigger: '.marquee',
    start: 'top bottom',
    end: 'bottom top',
    onUpdate: (self) => {
      marqueeDir = self.direction;
      const v = clamp(Math.abs(self.getVelocity()) / 300, 1, 8);
      gsap.to(marquee, { timeScale: v * marqueeDir, duration: 0.2, overwrite: true });
      gsap.to(marquee, { timeScale: marqueeDir, duration: 1.4, delay: 0.2, ease: 'power2.out' });
      gsap.to(marqueeTrack, { skewX: clamp(self.getVelocity() / -250, -12, 12), duration: 0.4, overwrite: 'auto' });
    }
  });

  // Atelier panel
  gsap.from('.atelier__panel', {
    opacity: 0, y: 80, scale: 0.96, duration: 1.4, ease: 'expo.out',
    scrollTrigger: { trigger: '.atelier__panel', start: 'top 85%', toggleActions: 'play none none reverse' }
  });

  // Horizontal anatomy chapters
  const track = $('.hscroll__track');
  const hTween = gsap.to(track, {
    x: () => -(track.scrollWidth - innerWidth),
    ease: 'none',
    scrollTrigger: {
      trigger: '#chapters',
      pin: true,
      scrub: 1,
      start: 'top top',
      end: () => '+=' + (track.scrollWidth - innerWidth) * 1.2,
      invalidateOnRefresh: true
    }
  });
  hScrollST = hTween.scrollTrigger;
  $$('.panel').forEach((panel) => {
    gsap.from(panel.children, {
      opacity: 0, y: 50, stagger: 0.08, duration: 1, ease: 'expo.out',
      scrollTrigger: { trigger: panel, containerAnimation: hTween, start: 'left 85%', toggleActions: 'play none none reverse' }
    });
  });

  // Finale
  const finaleSplit = SplitText.create('.finale__title', { type: 'words,chars' });
  gsap.from(finaleSplit.chars, {
    yPercent: 120, rotate: 8, stagger: 0.035, duration: 1.4, ease: 'expo.out',
    scrollTrigger: { trigger: '.finale__title', start: 'top 85%', toggleActions: 'play none none reverse' }
  });
  gsap.from('.finale .body, .finale__actions', {
    opacity: 0, y: 30, stagger: 0.12, duration: 1.2, ease: 'expo.out',
    scrollTrigger: { trigger: '.finale__actions', start: 'top 95%', toggleActions: 'play none none reverse' }
  });

  // Footer wordmark parallax
  gsap.from('.footer__big', {
    yPercent: 40, opacity: 0.2, ease: 'none',
    scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true }
  });

  // Hero fades out as you leave it
  gsap.to('.hero__title', {
    yPercent: -30, opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
  });
  gsap.to('.hero__top, .hero__bottom', {
    opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: '20% top', end: '60% top', scrub: true }
  });

  // HUD — chapter index
  const chapters = [...new Set($$('[data-chapter]').map((s) => s.dataset.chapter))];
  const hudIndex = $('.hud__index');
  const hudName = $('.hud__name');
  $$('[data-chapter]').forEach((sec) => {
    // a pinned section's spacer carries its real scroll length
    const spacer = sec.parentElement.classList.contains('pin-spacer') ? sec.parentElement : sec;
    ScrollTrigger.create({
      trigger: spacer,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => {
        if (!self.isActive) return;
        const name = sec.dataset.chapter;
        hudIndex.textContent = String(chapters.indexOf(name) + 1).padStart(2, '0');
        if (hudName.textContent !== name) {
          gsap.fromTo(hudName, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.6, ease: 'expo.out' });
          hudName.textContent = name;
        }
      }
    });
  });

  ScrollTrigger.addEventListener('refresh', computeKeys);
  ScrollTrigger.refresh();
}

/* --------------------------------------------------------------------------
   Configurator
   -------------------------------------------------------------------------- */

function buildConfigurator() {
  $$('.swatches').forEach((group) => {
    const nameEl = $('.swatch-name', group);
    $$('.swatch', group).forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.classList.contains('is-active'));
      btn.addEventListener('click', () => {
        $$('.swatch', group).forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');

        gsap.fromTo(nameEl, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'expo.out' });
        nameEl.textContent = btn.dataset.name;

        const mat = group.dataset.target === 'body' ? bodyMaterial : rimMaterial;
        if (!mat) return;
        const c = new THREE.Color(btn.dataset.color);
        gsap.to(mat.color, { r: c.r, g: c.g, b: c.b, duration: 1.2, ease: 'power2.inOut' });

        // A small "re-light" beat so the change feels physical
        gsap.timeline()
          .to(state, { exposure: 1.25, duration: 0.25, ease: 'power2.out' })
          .to(state, { exposure: 0.95, duration: 1.1, ease: 'power2.inOut' });
        gsap.to(state, { dragTarget: state.dragTarget + Math.PI * 0.25, duration: 1.6, ease: 'expo.inOut' });
      });
    });
  });

  // Drag-to-rotate in the atelier
  const atelier = $('#atelier');
  let dragging = false, lastX = 0;
  atelier.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.atelier__panel')) return;
    dragging = true;
    lastX = e.clientX;
    atelier.setPointerCapture(e.pointerId);
  });
  atelier.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    state.dragTarget += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });
  const end = () => { dragging = false; };
  atelier.addEventListener('pointerup', end);
  atelier.addEventListener('pointercancel', end);
  atelier.style.touchAction = 'pan-y';

  ScrollTrigger.create({
    trigger: '#atelier',
    start: 'top bottom',
    end: 'bottom top',
    onLeave: () => gsap.to(state, { dragTarget: Math.round(state.dragTarget / (Math.PI * 2)) * Math.PI * 2, duration: 1.5 }),
    onLeaveBack: () => gsap.to(state, { dragTarget: Math.round(state.dragTarget / (Math.PI * 2)) * Math.PI * 2, duration: 1.5 })
  });
}

/* --------------------------------------------------------------------------
   Cursor + magnetic UI
   -------------------------------------------------------------------------- */

function buildCursor() {
  addEventListener('pointermove', (e) => {
    state.pointer.x = (e.clientX / innerWidth) * 2 - 1;
    state.pointer.y = -((e.clientY / innerHeight) * 2 - 1);
  });

  if (!finePointer) return;
  document.body.classList.add('has-cursor');
  const cursor = $('.cursor');
  const dot = $('.cursor__dot');
  const ring = $('.cursor__ring');
  const label = $('.cursor__label');
  const dx = gsap.quickTo(dot, 'x', { duration: 0.1 });
  const dy = gsap.quickTo(dot, 'y', { duration: 0.1 });
  const rx = gsap.quickTo(ring, 'x', { duration: 0.5, ease: 'power3.out' });
  const ry = gsap.quickTo(ring, 'y', { duration: 0.5, ease: 'power3.out' });
  addEventListener('pointermove', (e) => { dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY); });

  document.addEventListener('pointerover', (e) => {
    const labelled = e.target.closest('[data-cursor]');
    const interactive = e.target.closest('a, button');
    const drag = e.target.closest('#atelier') && !e.target.closest('.atelier__panel');
    cursor.classList.toggle('is-label', !!labelled);
    cursor.classList.toggle('is-hover', !!interactive && !labelled);
    cursor.classList.toggle('is-drag', !!drag && !interactive);
    label.textContent = labelled ? labelled.dataset.cursor : drag ? 'Drag' : '';
  });

  $$('[data-magnetic]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.35);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.35);
    });
    el.addEventListener('pointerleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 1.2, ease: 'elastic.out(1, 0.35)' });
    });
  });
}

/* --------------------------------------------------------------------------
   Intro sequence
   -------------------------------------------------------------------------- */

function playIntro() {
  const heroSplit = SplitText.create('.hero__word', { type: 'chars' });
  const tl = gsap.timeline({
    onComplete: () => {
      document.documentElement.classList.remove('is-loading');
      lenis?.start();
      gsap.to(state, { dampLambda: 3.2, duration: 2 });
    }
  });

  tl.to('.loader__count, .loader__bar, .loader__top, .loader__bottom', { opacity: 0, y: -30, duration: 0.6, ease: 'power3.in', stagger: 0.05 })
    .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 1.2, ease: 'expo.inOut' }, '-=0.2')
    .set('.loader', { display: 'none' })
    // lights on — exposure ramps while the camera flies in from the dark
    .call(() => { state.intro = 1; Object.assign(target, makeRig(POSES.hero)); }, null, '-=0.9')
    .to(state, { exposure: 0.95, duration: 2.6, ease: 'power2.inOut' }, '-=0.9')
    .from(heroSplit.chars, { yPercent: 105, duration: 1.6, ease: 'expo.out', stagger: 0.07 }, '-=2.0')
    .from('.reveal-fade', { opacity: 0, y: 20, duration: 1.2, ease: 'expo.out', stagger: 0.08 }, '-=1.2')
    .from('.nav, .hud', { opacity: 0, duration: 1 }, '<');

  // headlight flicker as it "wakes up"
  gsap.timeline({ delay: 1.2 })
    .set(state, { lights: 0.6 }).to(state, { lights: 0, duration: 0.08 })
    .to(state, { lights: 1, duration: 0.05, delay: 0.12 }).to(state, { lights: 0.2, duration: 0.06 })
    .to(state, { lights: 1, duration: 0.4 });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function boot() {
  buildCursor();
  if (renderer) gsap.ticker.add((t, d) => tick(t, d));

  await Promise.all([loadEnvironment(), loadCar(), document.fonts.ready]);
  loaderStatus.textContent = 'Ready';
  gsap.to(loadProgress, {
    shown: 1, duration: 0.5,
    onUpdate() {
      loaderNum.textContent = String(Math.round(loadProgress.shown * 100)).padStart(3, '0');
      loaderBar.style.transform = `scaleX(${loadProgress.shown})`;
    }
  });

  buildScrollAnimations();
  buildConfigurator();

  if (!renderer) {
    canvas.style.background = 'radial-gradient(60% 50% at 50% 55%, #3a0508, #060608)';
  }

  if (reducedMotion) {
    gsap.set('.loader', { display: 'none' });
    document.documentElement.classList.remove('is-loading');
    state.intro = 1;
    state.lights = 1;
    state.exposure = 0.95;
    state.dampLambda = 8;
    return;
  }
  gsap.delayedCall(0.6, playIntro);
}

boot();
