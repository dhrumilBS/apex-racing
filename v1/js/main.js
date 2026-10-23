(() => {
  'use strict';

  const GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';
  const SCROLL_TRIGGER_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js';
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';
  const KNOWN_HASHES = new Set(['overview', 'velocity', 'aero', 'power', 'tyres', 'geometry']);
  const TYRE_MODES = Object.freeze({
    arc: Object.freeze({ name: 'Arc', grip: 100, warmup: 'Rapid · 1–2 laps', range: 'Short · 12-lap concept stint', pattern: 'triangle', summary: 'Maximum initial response; highest thermal load.' }),
    vector: Object.freeze({ name: 'Vector', grip: 88, warmup: 'Progressive · 2–3 laps', range: 'Medium · 24-lap concept stint', pattern: 'line', summary: 'Balanced response and thermal stability.' }),
    endure: Object.freeze({ name: 'Endure', grip: 76, warmup: 'Measured · 3–4 laps', range: 'Long · 38-lap concept stint', pattern: 'dot', summary: 'Lower peak response; longest stable operating range.' })
  });
  const POSES = Object.freeze({
    hero: Object.freeze({ camera: [0, 1.5, 8.5], target: [0, .35, 0], car: [0, 0, 0], rotation: [0, -.2, 0] }),
    launch: Object.freeze({ camera: [-1.8, .9, 7.2], target: [.3, .25, 0], car: [-.4, 0, 0], rotation: [0, -.08, 0] }),
    vmax: Object.freeze({ camera: [.8, .65, 6.4], target: [.8, .2, 0], car: [.5, 0, 0], rotation: [0, .05, 0] }),
    aero: Object.freeze({ camera: [-3.2, 2.4, 5.8], target: [0, .25, 0], car: [0, 0, 0], rotation: [.08, -.55, 0] })
  });

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    reducedMotion: motionQuery.matches,
    enhancementGeneration: 0,
    destroyed: false,
    gsap: null,
    ScrollTrigger: null,
    THREE: null,
    gsapMedia: null,
    storyTimelines: [],
    renderer: null,
    scene: null,
    camera: null,
    car: null,
    tunnel: null,
    frameId: 0,
    lastFrame: 0,
    wheelRate: 0,
    wheels: [],
    sceneReady: false,
    sceneObserver: null,
    sceneResizeHandler: null,
    sceneVisibilityHandler: null,
    scenePointerHandler: null,
    contextCanvas: null,
    contextLostHandler: null,
    contextRestoredHandler: null,
    visibleStageSections: new Set(),
    webglFailedPermanently: false,
    contextLossCount: 0,
    rebuildAttempted: false,
    menuOpen: false,
    menuClose: null,
    finishIntro: null,
    replayCleanup: null,
    replayTweens: [],
    scriptPose: clonePose(POSES.hero),
    pointer: { x: 0, y: 0 },
    resources: { geometries: new Set(), materials: new Set() },
    cleanups: []
  };
  const logged = new Set();
  const scriptPromises = new Map();

  function clonePose(pose) {
    return { camera: [...pose.camera], target: [...pose.target], car: [...pose.car], rotation: [...pose.rotation] };
  }

  function logOnce(key, level, message, error) {
    if (logged.has(key)) return;
    logged.add(key);
    const method = console[level] || console.warn;
    if (error) method.call(console, message, error);
    else method.call(console, message);
  }

  function validTuple(value) {
    return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  }

  function validPose(pose) {
    return pose && validTuple(pose.camera) && validTuple(pose.target) && validTuple(pose.car) && validTuple(pose.rotation);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function generationIsCurrent(generation) {
    return generation === state.enhancementGeneration && !state.reducedMotion && !state.destroyed;
  }

  function formatNumber(value, decimals = 0) {
    if (!Number.isFinite(value)) return '';
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function setFinalValues() {
    document.querySelectorAll('[data-counter]').forEach((element) => {
      const end = Number(element.dataset.end);
      const decimals = Number(element.dataset.decimals || 0);
      if (Number.isFinite(end) && Number.isInteger(decimals) && decimals >= 0) {
        element.textContent = formatNumber(end, decimals);
        element.setAttribute('aria-label', `${formatNumber(end, decimals)} final value`);
      }
    });
    const speed = document.getElementById('speed-value');
    const gear = document.getElementById('gear-value');
    const downforce = document.getElementById('downforce-value');
    if (speed) speed.textContent = '355';
    if (gear) gear.textContent = '8';
    if (downforce) downforce.textContent = '1,700';
    document.querySelectorAll('[data-phase]').forEach((item) => item.classList.toggle('is-active', item.dataset.phase === 'vmax'));
    document.querySelectorAll('[data-aero-callout]').forEach((item) => item.classList.toggle('is-active', ['diffuser', 'balance'].includes(item.dataset.aeroCallout)));
    const aeroPhase = document.getElementById('aero-phase');
    if (aeroPhase) aeroPhase.textContent = 'Diffuser / balance';
    ['telemetry-progress', 'deployment-trace'].forEach((id) => {
      const path = document.getElementById(id);
      if (path) { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; }
    });
    document.querySelectorAll('[data-airflow]').forEach((path) => { path.style.strokeDashoffset = '0'; });
  }

  function initHeaderMeasurement() {
    const header = document.getElementById('site-header');
    if (!header) return false;
    let frame = 0;
    const measure = () => {
      frame = 0;
      try {
        const height = Math.round(header.getBoundingClientRect().height);
        if (Number.isFinite(height) && height > 0) document.documentElement.style.setProperty('--header-height', `${height}px`);
      } catch (error) {
        logOnce('header-measure', 'warn', '[ORYNTH] Header measurement failed; using the CSS default.', error);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    let observer = null;
    if ('ResizeObserver' in window) {
      try {
        observer = new ResizeObserver(schedule);
        observer.observe(header);
      } catch (_) {
        observer = null;
      }
    }
    if (!observer) window.addEventListener('resize', schedule, { passive: true });
    measure();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', schedule);
    };
  }

  function initProgress() {
    const bar = document.getElementById('scroll-progress');
    if (!bar) return false;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      bar.style.transform = `scaleX(${progress})`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }

  function decodeKnownHash(hash) {
    if (!hash || hash.charAt(0) !== '#') return null;
    try {
      const id = decodeURIComponent(hash.slice(1));
      return KNOWN_HASHES.has(id) ? id : null;
    } catch (_) {
      return null;
    }
  }

  function focusAndScroll(target, behavior) {
    if (!target) return;
    const hadTabindex = target.hasAttribute('tabindex');
    if (!hadTabindex) target.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
    target.scrollIntoView({ behavior, block: 'start' });
    if (!hadTabindex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }

  function initHashNavigation() {
    const handler = (event) => {
      const anchor = event.target.closest('a[href^="#"]');
      if (!anchor || anchor.id === 'replay') return;
      const id = decodeKnownHash(anchor.hash);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      if (state.menuOpen && state.menuClose) state.menuClose({ restoreFocus: false });
      history.pushState(null, '', `#${id}`);
      focusAndScroll(target, state.reducedMotion ? 'auto' : 'smooth');
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }

  function initMenu() {
    const toggle = document.getElementById('menu-toggle');
    const nav = document.getElementById('primary-nav');
    if (!toggle || !nav) {
      logOnce('menu-hooks', 'error', '[ORYNTH] Navigation enhancement is unavailable; native navigation remains visible.');
      return false;
    }
    const links = Array.from(nav.querySelectorAll('a[href]'));
    if (!links.length) return false;
    let previousFocus = null;
    let scrollY = 0;

    const unlockBody = () => {
      const body = document.body;
      const restore = Number(body.dataset.lockScroll || scrollY);
      body.style.position = '';
      body.style.top = '';
      body.style.right = '';
      body.style.left = '';
      body.style.width = '';
      delete body.dataset.lockScroll;
      window.scrollTo(0, Number.isFinite(restore) ? restore : 0);
    };

    const close = ({ restoreFocus = true } = {}) => {
      if (!state.menuOpen) return;
      state.menuOpen = false;
      document.body.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
      unlockBody();
      if (restoreFocus && document.contains(toggle)) toggle.focus();
      previousFocus = null;
    };

    const open = () => {
      if (state.menuOpen || window.matchMedia('(min-width: 768px)').matches) return;
      previousFocus = document.activeElement;
      scrollY = window.scrollY;
      document.body.dataset.lockScroll = String(scrollY);
      Object.assign(document.body.style, { position: 'fixed', top: `-${scrollY}px`, right: '0', left: '0', width: '100%' });
      state.menuOpen = true;
      document.body.classList.add('menu-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close navigation');
      links[0].focus();
    };

    const onToggle = () => state.menuOpen ? close() : open();
    const onKey = (event) => {
      if (event.key === 'Escape' && state.menuOpen) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !state.menuOpen) return;
      const focusable = [toggle, ...links];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onLink = () => { if (state.menuOpen) close({ restoreFocus: false }); };
    const onResize = () => { if (window.matchMedia('(min-width: 768px)').matches) close({ restoreFocus: false }); };

    try {
      toggle.addEventListener('click', onToggle);
      document.addEventListener('keydown', onKey);
      links.forEach((link) => link.addEventListener('click', onLink));
      window.addEventListener('resize', onResize, { passive: true });
      state.menuClose = close;
      document.body.classList.add('menu-enhanced');
      toggle.hidden = false;
    } catch (error) {
      toggle.hidden = true;
      document.body.classList.remove('menu-enhanced', 'menu-open');
      logOnce('menu-setup', 'error', '[ORYNTH] Navigation enhancement failed; native navigation remains visible.', error);
      return false;
    }

    return () => {
      close({ restoreFocus: false });
      toggle.removeEventListener('click', onToggle);
      document.removeEventListener('keydown', onKey);
      links.forEach((link) => link.removeEventListener('click', onLink));
      window.removeEventListener('resize', onResize);
      toggle.hidden = true;
      document.body.classList.remove('menu-enhanced');
      state.menuClose = null;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }

  function initCompoundControls() {
    const controls = document.getElementById('compound-controls');
    const meter = document.getElementById('grip-meter');
    const value = document.getElementById('grip-value');
    const fill = document.getElementById('meter-fill');
    const warmup = document.getElementById('compound-warmup');
    const range = document.getElementById('compound-range');
    const summary = document.getElementById('compound-summary');
    const table = document.querySelector('.compound-comparison');
    const buttons = controls ? Array.from(controls.querySelectorAll('button[data-compound]')) : [];
    const targets = [controls, meter, value, fill, warmup, range, summary, table];
    const validModes = Object.isFrozen(TYRE_MODES) && Object.values(TYRE_MODES).every((mode) => Object.isFrozen(mode) && Number.isFinite(mode.grip));
    if (targets.some((target) => !target) || buttons.length !== 3 || !validModes || buttons.some((button) => !Object.prototype.hasOwnProperty.call(TYRE_MODES, button.dataset.compound))) {
      if (controls) controls.hidden = true;
      logOnce('compound-hooks', 'warn', '[ORYNTH] Tyre mode enhancement is unavailable; the complete comparison remains visible.');
      return false;
    }

    let activeKey = 'arc';
    const activate = (key) => {
      if (!Object.prototype.hasOwnProperty.call(TYRE_MODES, key)) return;
      const mode = TYRE_MODES[key];
      if (![value, fill, warmup, range, summary, meter].every((target) => target && target.isConnected)) return;
      activeKey = key;
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.compound === key)));
      value.textContent = String(mode.grip);
      fill.style.setProperty('--meter-value', `${mode.grip}%`);
      meter.classList.remove('pattern-triangle', 'pattern-line', 'pattern-dot');
      meter.classList.add(`pattern-${mode.pattern}`);
      meter.setAttribute('aria-valuenow', String(mode.grip));
      meter.setAttribute('aria-valuetext', `${mode.name}, ${mode.grip} out of 100`);
      warmup.textContent = mode.warmup;
      range.textContent = mode.range;
      summary.textContent = mode.summary;
    };
    const handlers = new Map();
    try {
      buttons.forEach((button) => {
        const handler = () => activate(button.dataset.compound);
        handlers.set(button, handler);
        button.addEventListener('click', handler);
      });
      activate(activeKey);
      controls.hidden = false;
    } catch (error) {
      handlers.forEach((handler, button) => button.removeEventListener('click', handler));
      controls.hidden = true;
      logOnce('compound-setup', 'warn', '[ORYNTH] Tyre mode enhancement failed; the complete comparison remains visible.', error);
      return false;
    }
    return () => {
      handlers.forEach((handler, button) => button.removeEventListener('click', handler));
      controls.hidden = true;
    };
  }

  function disposeReplayWork() {
    if (state.replayCleanup) {
      try { state.replayCleanup(); } catch (_) {}
      state.replayCleanup = null;
    }
    state.replayTweens.splice(0).forEach((tween) => { try { tween.kill(); } catch (_) {} });
  }

  function initReplay() {
    const replay = document.getElementById('replay');
    const overview = document.getElementById('overview');
    const velocity = document.getElementById('velocity');
    const replayable = Array.from(document.querySelectorAll('[data-replayable]'));
    if (!replay || !overview || !velocity || !replayable.length) return false;

    const runCounters = () => {
      if (state.reducedMotion) { setFinalValues(); return; }
      if (document.body.classList.contains('scroll-enhanced')) return;
      replayable.forEach((element) => {
        const start = Number(element.dataset.start);
        const end = Number(element.dataset.end);
        const decimals = Number(element.dataset.decimals || 0);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
        const model = { value: start };
        if (state.gsap && typeof state.gsap.to === 'function') {
          const tween = state.gsap.to(model, { value: end, duration: 1.15, ease: 'power2.out', overwrite: true, onUpdate: () => { element.textContent = formatNumber(model.value, decimals); } });
          state.replayTweens.push(tween);
        } else {
          element.textContent = formatNumber(end, decimals);
        }
      });
    };
    const armVelocity = () => {
      if (state.reducedMotion) { setFinalValues(); return; }
      if (!('IntersectionObserver' in window)) { runCounters(); return; }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          state.replayCleanup = null;
          runCounters();
        }
      }, { threshold: .15 });
      observer.observe(velocity);
      state.replayCleanup = () => observer.disconnect();
    };
    const armAfterOverview = () => {
      if (state.reducedMotion) return;
      if (!('IntersectionObserver' in window)) {
        let frame = 0;
        const deadline = performance.now() + 2200;
        const check = (time) => {
          const rect = overview.getBoundingClientRect();
          const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0;
          if ((rect.top <= header + 2 && rect.bottom > header) || time >= deadline) {
            frame = 0;
            state.replayCleanup = null;
            armVelocity();
            return;
          }
          frame = requestAnimationFrame(check);
        };
        frame = requestAnimationFrame(check);
        state.replayCleanup = () => { if (frame) cancelAnimationFrame(frame); };
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          state.replayCleanup = null;
          armVelocity();
        }
      }, { threshold: .15 });
      observer.observe(overview);
      state.replayCleanup = () => observer.disconnect();
    };
    const handler = (event) => {
      event.preventDefault();
      disposeReplayWork();
      if (!state.reducedMotion) {
        replayable.forEach((element) => {
          const start = Number(element.dataset.start);
          if (Number.isFinite(start)) element.textContent = formatNumber(start, Number(element.dataset.decimals || 0));
        });
      } else {
        setFinalValues();
      }
      history.pushState(null, '', '#overview');
      focusAndScroll(overview, state.reducedMotion ? 'auto' : 'smooth');
      if (!state.reducedMotion) armAfterOverview();
    };
    replay.addEventListener('click', handler);
    return () => { disposeReplayWork(); replay.removeEventListener('click', handler); };
  }

  function initIntro() {
    const intro = document.getElementById('intro');
    if (!intro || state.reducedMotion) return false;
    let finished = false;
    let timer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('keydown', onKeyboardNavigation, true);
      document.removeEventListener('focusin', onFocusTransfer, true);
      intro.hidden = true;
      intro.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('intro-enhanced');
      if (state.finishIntro === finish) state.finishIntro = null;
    };
    const onKeyboardNavigation = () => finish();
    const onFocusTransfer = (event) => {
      if (event.target !== document.body && event.target !== document.documentElement && !intro.contains(event.target)) finish();
    };
    state.finishIntro = finish;
    timer = window.setTimeout(finish, 2200);
    document.addEventListener('keydown', onKeyboardNavigation, true);
    document.addEventListener('focusin', onFocusTransfer, true);
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body && activeElement !== document.documentElement && !intro.contains(activeElement)) {
      finish();
      return finish;
    }
    intro.hidden = false;
    intro.setAttribute('aria-hidden', 'false');
    document.body.classList.add('intro-enhanced');
    return finish;
  }

  function loadScript(url, expectedGlobal, timeout = 2500) {
    if (scriptPromises.has(url)) return scriptPromises.get(url);
    const promise = new Promise((resolve, reject) => {
      const existing = window[expectedGlobal];
      if (existing) { resolve(existing); return; }
      const script = document.createElement('script');
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        const value = window[expectedGlobal];
        if (!error && value) resolve(value);
        else {
          script.remove();
          scriptPromises.delete(url);
          reject(error || new Error(`${expectedGlobal} API mismatch`));
        }
      };
      const timer = window.setTimeout(() => finish(new Error(`Timed out loading ${expectedGlobal}`)), timeout);
      script.src = url;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => finish(null);
      script.onerror = () => finish(new Error(`Failed to load ${expectedGlobal}`));
      document.head.appendChild(script);
    });
    scriptPromises.set(url, promise);
    return promise;
  }

  function importThree(timeout = 3000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('Timed out loading Three.js')); }
      }, timeout);
      import(THREE_URL).then((module) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(module);
      }).catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function canUseWebGL() {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch (_) {
      return false;
    }
  }

  function validateThree(THREE) {
    const names = ['Scene', 'WebGLRenderer', 'PerspectiveCamera', 'Group', 'BoxGeometry', 'CapsuleGeometry', 'CylinderGeometry', 'TorusGeometry', 'SphereGeometry', 'BufferGeometry', 'BufferAttribute', 'MeshStandardMaterial', 'Mesh', 'PointsMaterial', 'Points', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'Vector3'];
    return THREE && names.every((name) => typeof THREE[name] === 'function');
  }

  function interpolateTuple(a, b, progress) {
    return a.map((value, index) => value + (b[index] - value) * progress);
  }

  function interpolatePose(a, b, progress) {
    const p = clamp(progress, 0, 1);
    return {
      camera: interpolateTuple(a.camera, b.camera, p),
      target: interpolateTuple(a.target, b.target, p),
      car: interpolateTuple(a.car, b.car, p),
      rotation: interpolateTuple(a.rotation, b.rotation, p)
    };
  }

  function applyScriptPose() {
    if (!state.car || !state.camera || !state.THREE) return;
    const pose = state.scriptPose;
    if (!validPose(pose)) return;
    state.car.position.set(...pose.car);
    state.car.rotation.set(
      pose.rotation[0] + state.pointer.y * .04,
      pose.rotation[1] + state.pointer.x * .08,
      pose.rotation[2]
    );
    state.camera.position.set(...pose.camera);
    state.camera.lookAt(new state.THREE.Vector3(...pose.target));
  }

  function disposeSceneObjects() {
    state.resources.geometries.forEach((geometry) => { try { geometry.dispose(); } catch (_) {} });
    state.resources.materials.forEach((material) => { try { material.dispose(); } catch (_) {} });
    state.resources.geometries.clear();
    state.resources.materials.clear();
    state.scene = null;
    state.camera = null;
    state.car = null;
    state.tunnel = null;
    state.wheels = [];
  }

  function stopRenderLoop() {
    if (state.frameId) cancelAnimationFrame(state.frameId);
    state.frameId = 0;
    state.lastFrame = 0;
  }

  function shouldRender() {
    return state.sceneReady && !state.reducedMotion && !state.destroyed && !state.webglFailedPermanently && !document.hidden && state.visibleStageSections.size > 0;
  }

  function renderFrame(time) {
    state.frameId = 0;
    if (!shouldRender()) return;
    try {
      const delta = state.lastFrame ? Math.min((time - state.lastFrame) / 1000, .05) : 0;
      state.lastFrame = time;
      applyScriptPose();
      state.wheels.forEach((wheel) => { wheel.rotation.z -= state.wheelRate * delta; });
      if (state.tunnel) {
        state.tunnel.position.z += delta * 1.8;
        if (state.tunnel.position.z > 4) state.tunnel.position.z = -4;
      }
      state.renderer.render(state.scene, state.camera);
    } catch (error) {
      disableWebGL(error, { category: 'frame' });
      return;
    }
    state.frameId = requestAnimationFrame(renderFrame);
  }

  function syncRenderLoop() {
    if (shouldRender()) {
      if (!state.frameId) state.frameId = requestAnimationFrame(renderFrame);
    } else stopRenderLoop();
  }

  function removeSceneInfrastructure({ removeContext = true } = {}) {
    stopRenderLoop();
    if (state.sceneObserver) state.sceneObserver.disconnect();
    state.sceneObserver = null;
    if (state.sceneResizeHandler) window.removeEventListener('resize', state.sceneResizeHandler);
    if (state.sceneVisibilityHandler) document.removeEventListener('visibilitychange', state.sceneVisibilityHandler);
    if (state.scenePointerHandler) window.removeEventListener('pointermove', state.scenePointerHandler);
    state.sceneResizeHandler = null;
    state.sceneVisibilityHandler = null;
    state.scenePointerHandler = null;
    if (removeContext && state.contextCanvas) {
      state.contextCanvas.removeEventListener('webglcontextlost', state.contextLostHandler);
      state.contextCanvas.removeEventListener('webglcontextrestored', state.contextRestoredHandler);
      state.contextCanvas = null;
      state.contextLostHandler = null;
      state.contextRestoredHandler = null;
    }
    state.visibleStageSections.clear();
  }

  function destroyScene({ permanent = false } = {}) {
    state.sceneReady = false;
    document.body.classList.remove('webgl-ready');
    removeSceneInfrastructure();
    disposeSceneObjects();
    if (state.renderer) {
      const canvas = state.renderer.domElement;
      try { state.renderer.dispose(); } catch (_) {}
      if (canvas && canvas.parentNode) canvas.remove();
    }
    state.renderer = null;
    state.THREE = null;
    if (permanent) state.webglFailedPermanently = true;
  }

  function disableWebGL(error, { awaitingRestore = false, category = 'webgl' } = {}) {
    state.sceneReady = false;
    document.body.classList.remove('webgl-ready');
    stopRenderLoop();
    if (awaitingRestore) {
      logOnce('webgl-loss', 'warn', '[ORYNTH] WebGL context was lost; the authored vehicle view has returned.', error);
      return;
    }
    logOnce(`webgl-${category}`, category === 'capability' ? 'warn' : 'error', '[ORYNTH] The procedural vehicle is unavailable; the authored vehicle view remains active.', error);
    destroyScene({ permanent: true });
  }

  function updateRendererSize() {
    const stage = document.getElementById('webgl-stage');
    if (!stage || !state.renderer || !state.camera) return;
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const dpr = Math.min(window.devicePixelRatio || 1, width < 768 ? 1.25 : 1.5);
    state.renderer.setPixelRatio(dpr);
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
  }

  function constructCar(THREE) {
    const group = new THREE.Group();
    const geometries = state.resources.geometries;
    const materials = state.resources.materials;
    const material = (options) => {
      const value = new THREE.MeshStandardMaterial(options);
      materials.add(value);
      return value;
    };
    const carbon = material({ color: 0x0c0d10, metalness: .45, roughness: .5 });
    const graphite = material({ color: 0x24272d, metalness: .7, roughness: .35 });
    const red = material({ color: 0xff3347, metalness: .45, roughness: .3 });
    const rubber = material({ color: 0x050506, metalness: .05, roughness: .9 });
    const yellow = material({ color: 0xffd21f, metalness: .2, roughness: .5 });
    const aluminum = material({ color: 0xa7aeb8, metalness: .8, roughness: .25 });
    const emissive = material({ color: 0xff3347, emissive: 0xff1028, emissiveIntensity: 1.2, roughness: .35 });
    const makeGeometry = (geometry) => { geometries.add(geometry); return geometry; };
    const mesh = (geometry, mat, position, scale = [1, 1, 1], rotation = [0, 0, 0], parent = group) => {
      const item = new THREE.Mesh(geometry, mat);
      item.position.set(...position);
      item.scale.set(...scale);
      item.rotation.set(...rotation);
      parent.add(item);
      return item;
    };

    const capsule = makeGeometry(new THREE.CapsuleGeometry(.42, 2.2, 6, 14));
    const capsuleSmall = makeGeometry(new THREE.CapsuleGeometry(.2, 1.4, 5, 12));
    const box = makeGeometry(new THREE.BoxGeometry(1, 1, 1));
    const wheelGeometry = makeGeometry(new THREE.CylinderGeometry(.58, .58, .34, 24, 1));
    const rimGeometry = makeGeometry(new THREE.CylinderGeometry(.34, .34, .36, 20, 1));
    const ringGeometry = makeGeometry(new THREE.TorusGeometry(.47, .025, 6, 30));
    const haloGeometry = makeGeometry(new THREE.TorusGeometry(.37, .035, 8, 24, Math.PI * 1.6));
    const helmetGeometry = makeGeometry(new THREE.SphereGeometry(.2, 16, 10));

    mesh(capsule, red, [-.25, .43, 0], [1.2, 1, 1], [0, 0, Math.PI / 2]);
    mesh(capsuleSmall, red, [1.25, .35, 0], [1.35, .75, .7], [0, 0, Math.PI / 2]);
    mesh(capsuleSmall, carbon, [-1.3, .42, 0], [1.1, 1.15, 1.25], [0, 0, Math.PI / 2]);
    mesh(box, carbon, [0, .16, 0], [3.4, .08, 1.34]);
    mesh(box, red, [-.45, .3, .73], [1.35, .26, .26]);
    mesh(box, red, [-.45, .3, -.73], [1.35, .26, .26]);
    mesh(box, graphite, [2.15, .25, 0], [.72, .07, 1.72]);
    mesh(box, graphite, [2.1, .33, 0], [.08, .35, .08]);
    mesh(box, graphite, [-2.05, .62, 0], [.66, .08, 1.85]);
    mesh(box, graphite, [-2.05, .42, .72], [.08, .42, .08]);
    mesh(box, graphite, [-2.05, .42, -.72], [.08, .42, .08]);
    mesh(box, emissive, [-2.42, .48, 0], [.08, .11, .45]);
    mesh(helmetGeometry, yellow, [-.43, .82, 0]);
    mesh(haloGeometry, aluminum, [-.43, .8, 0], [1, 1, 1], [Math.PI / 2, .3, 0]);
    mesh(box, aluminum, [-.72, .66, .29], [.04, .6, .04], [0, 0, -.28]);
    mesh(box, aluminum, [-.72, .66, -.29], [.04, .6, .04], [0, 0, -.28]);

    [[-1.52, .5, .98], [-1.52, .5, -.98], [1.52, .46, .92], [1.52, .46, -.92]].forEach((position) => {
      const wheel = new THREE.Group();
      wheel.position.set(...position);
      group.add(wheel);
      mesh(wheelGeometry, rubber, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0], wheel);
      mesh(rimGeometry, graphite, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0], wheel);
      mesh(ringGeometry, yellow, [0, 0, position[2] > 0 ? .18 : -.18], [1, 1, 1], [0, 0, 0], wheel);
      state.wheels.push(wheel);
    });
    return group;
  }

  function buildSceneResources(THREE, renderer) {
    disposeSceneObjects();
    state.THREE = THREE;
    const scene = new THREE.Scene();
    const stage = document.getElementById('webgl-stage');
    const rect = stage.getBoundingClientRect();
    const camera = new THREE.PerspectiveCamera(32, Math.max(1, rect.width) / Math.max(1, rect.height), .1, 100);
    const car = constructCar(THREE);
    scene.add(car);
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x09090d, 2.2));
    const directional = new THREE.DirectionalLight(0xff3347, 3.5);
    directional.position.set(3, 5, 4);
    scene.add(directional);
    const pointA = new THREE.PointLight(0xffd21f, 12, 10);
    pointA.position.set(-2, 1, 3);
    scene.add(pointA);
    const pointB = new THREE.PointLight(0x5878ff, 7, 9);
    pointB.position.set(2, 2, -3);
    scene.add(pointB);

    const pointCount = window.innerWidth < 768 ? 80 : 220;
    const pointGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(pointCount * 3);
    let seed = 7021;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let index = 0; index < pointCount; index += 1) {
      positions[index * 3] = (random() - .5) * 18;
      positions[index * 3 + 1] = (random() - .5) * 9;
      positions[index * 3 + 2] = (random() - .5) * 18;
    }
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointMaterial = new THREE.PointsMaterial({ color: 0x59616d, size: .025, transparent: true, opacity: .65 });
    state.resources.geometries.add(pointGeometry);
    state.resources.materials.add(pointMaterial);
    const tunnel = new THREE.Points(pointGeometry, pointMaterial);
    scene.add(tunnel);
    state.scene = scene;
    state.camera = camera;
    state.car = car;
    state.tunnel = tunnel;
    state.renderer = renderer;
    state.scriptPose = clonePose(POSES.hero);
    updateRendererSize();
    applyScriptPose();
  }

  function installSceneInfrastructure(generation) {
    const sections = ['overview', 'intent', 'velocity', 'aero'].map((id) => document.getElementById(id)).filter(Boolean);
    if ('IntersectionObserver' in window) {
      state.sceneObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!sections.includes(entry.target)) return;
          if (entry.isIntersecting) state.visibleStageSections.add(entry.target);
          else state.visibleStageSections.delete(entry.target);
        });
        syncRenderLoop();
      }, { threshold: .05 });
      sections.forEach((section) => state.sceneObserver.observe(section));
    } else sections.forEach((section) => state.visibleStageSections.add(section));
    state.sceneVisibilityHandler = syncRenderLoop;
    document.addEventListener('visibilitychange', state.sceneVisibilityHandler);
    let resizeFrame = 0;
    let settleTimer = 0;
    state.sceneResizeHandler = () => {
      if (!resizeFrame) resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (generationIsCurrent(generation)) updateRendererSize();
      });
      clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (generationIsCurrent(generation) && state.ScrollTrigger) state.ScrollTrigger.refresh();
      }, 150);
    };
    window.addEventListener('resize', state.sceneResizeHandler, { passive: true });
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (finePointer.matches) {
      state.scenePointerHandler = (event) => {
        const x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        const y = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          state.pointer.x += (clamp(x, -1, 1) - state.pointer.x) * .15;
          state.pointer.y += (clamp(y, -1, 1) - state.pointer.y) * .15;
        }
      };
      window.addEventListener('pointermove', state.scenePointerHandler, { passive: true });
    }
  }

  function attachContextHandlers(canvas, generation) {
    state.contextCanvas = canvas;
    state.contextLostHandler = (event) => {
      if (event.target !== state.contextCanvas || !generationIsCurrent(generation)) return;
      event.preventDefault();
      state.contextLossCount += 1;
      if (state.contextLossCount === 1 && !state.rebuildAttempted) {
        disableWebGL(new Error('WebGL context lost'), { awaitingRestore: true });
      } else {
        disableWebGL(new Error('WebGL context lost a second time'), { category: 'context-loss' });
      }
    };
    state.contextRestoredHandler = () => {
      if (!generationIsCurrent(generation) || state.rebuildAttempted || state.contextLossCount !== 1 || !state.renderer || !state.THREE) return;
      state.rebuildAttempted = true;
      try {
        buildSceneResources(state.THREE, state.renderer);
        state.renderer.compile(state.scene, state.camera);
        state.renderer.render(state.scene, state.camera);
        state.sceneReady = true;
        document.body.classList.add('webgl-ready');
        syncRenderLoop();
      } catch (error) {
        disableWebGL(error, { category: 'restore' });
      }
    };
    canvas.addEventListener('webglcontextlost', state.contextLostHandler, false);
    canvas.addEventListener('webglcontextrestored', state.contextRestoredHandler, false);
  }

  async function initThree(generation) {
    if (state.webglFailedPermanently) return false;
    if (!canUseWebGL()) {
      state.webglFailedPermanently = true;
      logOnce('webgl-capability', 'warn', '[ORYNTH] WebGL is unavailable; the authored vehicle view remains active.');
      return false;
    }
    const stage = document.getElementById('webgl-stage');
    if (!stage || !Object.values(POSES).every(validPose)) {
      disableWebGL(new Error('Invalid scene hooks or pose configuration'), { category: 'pose' });
      return false;
    }
    try {
      const THREE = await importThree();
      if (!generationIsCurrent(generation)) return false;
      if (!validateThree(THREE)) throw new Error('Three.js API mismatch');
      state.THREE = THREE;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
      renderer.shadowMap.enabled = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      stage.replaceChildren(renderer.domElement);
      state.renderer = renderer;
      attachContextHandlers(renderer.domElement, generation);
      buildSceneResources(THREE, renderer);
      renderer.compile(state.scene, state.camera);
      renderer.render(state.scene, state.camera);
      if (!generationIsCurrent(generation)) { destroyScene({ permanent: false }); return false; }
      installSceneInfrastructure(generation);
      state.sceneReady = true;
      document.body.classList.add('webgl-ready');
      syncRenderLoop();
      return true;
    } catch (error) {
      if (generationIsCurrent(generation)) disableWebGL(error, { category: 'initialization' });
      return false;
    }
  }

  function velocityGear(progress) {
    if (progress >= .78) return 8;
    if (progress >= .68) return 7;
    if (progress >= .58) return 6;
    if (progress >= .48) return 5;
    if (progress >= .38) return 4;
    if (progress >= .22) return 3;
    if (progress >= .1) return 2;
    return 1;
  }

  function updateVelocity(progress) {
    const p = clamp(progress, 0, 1);
    let speed;
    if (p <= .3) speed = 120 * (p / .3);
    else if (p <= .72) speed = 120 + 180 * ((p - .3) / .42);
    else speed = 300 + 55 * ((p - .72) / .28);
    const speedElement = document.getElementById('speed-value');
    const gearElement = document.getElementById('gear-value');
    if (speedElement) speedElement.textContent = formatNumber(speed);
    if (gearElement) gearElement.textContent = String(velocityGear(p));
    const telemetry = document.getElementById('telemetry-progress');
    if (telemetry) {
      const amount = p <= .3 ? p : p <= .72 ? .3 + ((p - .3) / .42) * .48 : .78 + ((p - .72) / .28) * .22;
      telemetry.style.strokeDasharray = '100';
      telemetry.style.strokeDashoffset = String(100 - amount * 100);
    }
    const deployment = document.getElementById('deployment-trace');
    if (deployment) {
      const amount = clamp((p - .36) / .26, 0, 1);
      deployment.style.strokeDasharray = '100';
      deployment.style.strokeDashoffset = String(100 - amount * 100);
    }
    const phase = p < .3 ? 'launch' : p < .72 ? 'deployment' : 'vmax';
    document.querySelectorAll('[data-phase]').forEach((item) => item.classList.toggle('is-active', item.dataset.phase === phase));
    document.querySelectorAll('.metric-strip [data-replayable]').forEach((element) => {
      const end = Number(element.dataset.end);
      const decimals = Number(element.dataset.decimals || 0);
      if (Number.isFinite(end)) element.textContent = formatNumber(end * clamp(p / .3, 0, 1), decimals);
    });
    if (p <= .3) state.scriptPose = interpolatePose(POSES.hero, POSES.launch, p / .3);
    else state.scriptPose = interpolatePose(POSES.launch, POSES.vmax, clamp((p - .3) / .42, 0, 1));
    state.wheelRate = p <= .3 ? 45 * (p / .3) : p <= .72 ? 45 + 60 * ((p - .3) / .42) : 105 + 20 * ((p - .72) / .28);
  }

  function updateAero(progress) {
    const p = clamp(progress, 0, 1);
    let downforce;
    if (p <= .2) downforce = 340 * (p / .2);
    else if (p <= .4) downforce = 340 + 420 * ((p - .2) / .2);
    else if (p <= .68) downforce = 760 + 520 * ((p - .4) / .28);
    else downforce = 1280 + 420 * ((p - .68) / .32);
    const value = document.getElementById('downforce-value');
    if (value) value.textContent = formatNumber(downforce);
    document.querySelectorAll('[data-airflow]').forEach((path) => {
      path.style.strokeDasharray = '100';
      path.style.strokeDashoffset = String(100 - p * 100);
    });
    let callouts = [];
    let label = 'Overview';
    if (p >= .2 && p < .4) { callouts = ['front']; label = 'Front wing'; }
    else if (p >= .4 && p < .68) { callouts = ['floor']; label = 'Floor / sidepod'; }
    else if (p >= .68) { callouts = ['diffuser', 'balance']; label = 'Diffuser / balance'; }
    document.querySelectorAll('[data-aero-callout]').forEach((item) => item.classList.toggle('is-active', callouts.includes(item.dataset.aeroCallout)));
    const phase = document.getElementById('aero-phase');
    if (phase) phase.textContent = label;
    if (p <= .2) state.scriptPose = interpolatePose(POSES.vmax, POSES.aero, p / .2);
    else if (p < .4) {
      state.scriptPose = clonePose(POSES.aero);
      state.scriptPose.target = interpolateTuple(POSES.aero.target, [.35, .2, 0], (p - .2) / .2);
    } else if (p < .68) {
      state.scriptPose = clonePose(POSES.aero);
      state.scriptPose.camera = interpolateTuple(POSES.aero.camera, [-2.75, 2.1, 5.35], (p - .4) / .28);
      state.scriptPose.target = interpolateTuple([.35, .2, 0], [0, .1, 0], (p - .4) / .28);
    } else {
      state.scriptPose = clonePose(POSES.aero);
    }
    const bars = document.querySelectorAll('.balance-bars i');
    const reveal = clamp((p - .76) / .16, 0, 1);
    bars.forEach((bar) => { bar.style.transform = `scaleX(${reveal})`; bar.style.transformOrigin = 'left'; });
  }

  function clearAnimationStyles() {
    document.body.classList.remove('scroll-enhanced');
    document.querySelectorAll('[data-reveal]').forEach((element) => { element.style.opacity = ''; element.style.transform = ''; });
    document.querySelectorAll('.velocity-stage, .aero-stage').forEach((element) => { element.style.cssText = ''; });
    document.querySelectorAll('.balance-bars i').forEach((element) => { element.style.transform = ''; });
    setFinalValues();
  }

  function teardownGSAP() {
    document.body.classList.remove('scroll-enhanced');
    if (state.gsapMedia) {
      try { state.gsapMedia.revert(); } catch (_) {}
      state.gsapMedia = null;
    }
    state.storyTimelines.forEach((timeline) => { try { timeline.kill(); } catch (_) {} });
    state.storyTimelines = [];
    clearAnimationStyles();
    state.gsap = null;
    state.ScrollTrigger = null;
  }

  async function initGSAP(generation) {
    try {
      const gsap = await loadScript(GSAP_URL, 'gsap');
      if (!generationIsCurrent(generation)) return false;
      if (!gsap || typeof gsap.to !== 'function' || typeof gsap.timeline !== 'function' || typeof gsap.matchMedia !== 'function') throw new Error('GSAP API mismatch');
      const ScrollTrigger = await loadScript(SCROLL_TRIGGER_URL, 'ScrollTrigger');
      if (!generationIsCurrent(generation)) return false;
      if (!ScrollTrigger || typeof ScrollTrigger.create !== 'function' || typeof ScrollTrigger.refresh !== 'function') throw new Error('ScrollTrigger API mismatch');
      gsap.registerPlugin(ScrollTrigger);
      state.gsap = gsap;
      state.ScrollTrigger = ScrollTrigger;
      const media = gsap.matchMedia();
      state.gsapMedia = media;

      media.add('(prefers-reduced-motion: no-preference)', () => {
        const revealTweens = [];
        document.querySelectorAll('[data-reveal]').forEach((element) => {
          const tween = gsap.fromTo(element, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .65, ease: 'power2.out', scrollTrigger: { trigger: element, start: 'top 88%', once: true } });
          revealTweens.push(tween);
        });
        return () => revealTweens.forEach((tween) => tween.kill());
      });

      media.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        const velocityWrapper = document.querySelector('.velocity-story');
        const velocityStage = document.querySelector('.velocity-stage');
        const aeroWrapper = document.querySelector('.aero-story');
        const aeroStage = document.querySelector('.aero-stage');
        if (![velocityWrapper, velocityStage, aeroWrapper, aeroStage].every(Boolean)) return () => clearAnimationStyles();
        const timelines = [];
        try {
          const velocityState = { progress: 0 };
          const aeroState = { progress: 0 };
          const velocityTimeline = gsap.timeline({ scrollTrigger: { trigger: velocityWrapper, start: 'top top', end: () => `+=${Math.max(1, velocityWrapper.offsetHeight - velocityStage.offsetHeight)}`, pin: velocityStage, pinSpacing: false, scrub: .6, anticipatePin: 1, invalidateOnRefresh: true } });
          velocityTimeline.to(velocityState, { progress: 1, duration: 1, ease: 'none', onUpdate: () => updateVelocity(velocityState.progress) });
          timelines.push(velocityTimeline);
          const aeroTimeline = gsap.timeline({ scrollTrigger: { trigger: aeroWrapper, start: 'top top', end: () => `+=${Math.max(1, aeroWrapper.offsetHeight - aeroStage.offsetHeight)}`, pin: aeroStage, pinSpacing: false, scrub: .6, anticipatePin: 1, invalidateOnRefresh: true } });
          aeroTimeline.to(aeroState, { progress: 1, duration: 1, ease: 'none', onUpdate: () => updateAero(aeroState.progress) });
          timelines.push(aeroTimeline);
          state.storyTimelines = timelines;
          document.body.classList.add('scroll-enhanced');
          ScrollTrigger.refresh();
        } catch (error) {
          document.body.classList.remove('scroll-enhanced');
          timelines.forEach((timeline) => timeline.kill());
          clearAnimationStyles();
          logOnce('story-setup', 'warn', '[ORYNTH] Desktop scroll stories are unavailable; the complete static story remains visible.', error);
        }
        return () => {
          document.body.classList.remove('scroll-enhanced');
          timelines.forEach((timeline) => timeline.kill());
          state.storyTimelines = [];
          clearAnimationStyles();
        };
      });
      return true;
    } catch (error) {
      if (generationIsCurrent(generation)) {
        teardownGSAP();
        logOnce('gsap-load', 'warn', '[ORYNTH] Motion libraries are unavailable; the complete static story remains visible.', error);
      }
      return false;
    }
  }

  function teardownEnhancements() {
    if (state.finishIntro) state.finishIntro();
    if (state.menuOpen && state.menuClose) state.menuClose({ restoreFocus: false });
    disposeReplayWork();
    teardownGSAP();
    destroyScene({ permanent: false });
    state.pointer.x = 0;
    state.pointer.y = 0;
    setFinalValues();
  }

  function startEnhancements({ showIntro = false } = {}) {
    if (state.reducedMotion || state.destroyed) return;
    const generation = ++state.enhancementGeneration;
    const finishIntro = showIntro ? initIntro() : null;
    const gsapPromise = initGSAP(generation);
    const threePromise = initThree(generation);
    Promise.allSettled([gsapPromise, threePromise]).then(() => {
      if (generation === state.enhancementGeneration && finishIntro) finishIntro();
    });
  }

  function onMotionChange(event) {
    const reduce = Boolean(event.matches);
    if (reduce === state.reducedMotion) return;
    state.reducedMotion = reduce;
    state.enhancementGeneration += 1;
    if (reduce) {
      document.documentElement.classList.add('reduced-motion');
      teardownEnhancements();
    } else {
      document.documentElement.classList.remove('reduced-motion');
      setFinalValues();
      startEnhancements({ showIntro: false });
    }
  }

  function initialize() {
    try {
      if (state.reducedMotion) document.documentElement.classList.add('reduced-motion');
      const baselineInitializers = [initHeaderMeasurement, initProgress, initHashNavigation, initMenu, initCompoundControls, initReplay];
      baselineInitializers.forEach((initializer) => {
        try {
          const cleanup = initializer();
          if (typeof cleanup === 'function') state.cleanups.push(cleanup);
        } catch (error) {
          logOnce(`baseline-${initializer.name}`, 'error', `[ORYNTH] ${initializer.name} failed; static content remains available.`, error);
        }
      });
      const motionListener = onMotionChange;
      if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', motionListener);
      else motionQuery.addListener(motionListener);
      state.cleanups.push(() => {
        if (typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', motionListener);
        else motionQuery.removeListener(motionListener);
      });
      setFinalValues();
      if (!state.reducedMotion) startEnhancements({ showIntro: true });
    } catch (error) {
      state.enhancementGeneration += 1;
      teardownEnhancements();
      document.body.classList.remove('intro-enhanced', 'menu-open');
      logOnce('top-level', 'error', '[ORYNTH] Enhancement initialization failed.', error);
    }
  }

  function destroyApplication() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.enhancementGeneration += 1;
    teardownEnhancements();
    state.cleanups.splice(0).reverse().forEach((cleanup) => { try { cleanup(); } catch (_) {} });
  }

  window.addEventListener('pagehide', destroyApplication, { once: true });
  initialize();
})();
