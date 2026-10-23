# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

APEX — Rosso Study is a single-page, scroll-driven 3D car showcase. It is static HTML, CSS and JS with **no build step, no package.json and no framework**. All libraries come from jsDelivr with pinned versions (Three.js 0.170.0 via the import map in `index.html`; GSAP 3.13.0 with ScrollTrigger and SplitText; Lenis 1.3.11 as classic scripts). Keep those versions pinned exactly when you edit.

It deploys to **GitHub Pages from the root of `main`** (https://dhrumilbs.github.io/apex-racing/). Pushing to `main` publishes. Because the site lives under `/apex-racing/`, every asset path must stay **relative** (`assets/...`, not `/assets/...`).

## Run locally

```powershell
& 'D:\xampp\php\php.exe' -S 127.0.0.1:8080 -t .
```

Open http://127.0.0.1:8080/. `file://` will not work (ES modules + GLB fetch).

## Files

- `index.html`: every chapter's markup. Sections carry `data-chapter` (HUD label). `[data-magnetic]` gives magnetic hover, `[data-cursor]` gives a cursor label, `[data-count]` / `[data-decimals]` drive counters, and `.split-lines`, `.split-body` and `.split-chars` drive SplitText reveals.
- `css/styles.css`: tokens in `:root` (`--accent`, `--f-display` = Archivo variable with `wdth` axis, `--f-mono` = JetBrains Mono). Mobile breakpoint is `900px`.
- `js/main.js`: one ES module, organised in banner-commented sections (smooth scroll → poses → renderer → loading → scroll keyframes → render loop → GSAP → configurator → cursor → intro → boot).
- `assets/models/ferrari.glb` is Draco-compressed (the decoder loads from the CDN). `ferrari_ao.png` is the baked contact shadow.
- `assets/hdr/studio.hdr`: Poly Haven studio HDRI, CC0.
- `v1/`: the previous procedural/SVG version, kept for reference. Don't edit it unless asked.
- `.agents/` is gitignored. It holds a local browser profile from an earlier tool and must never be committed.

## How the 3D choreography works

- **One fixed canvas** sits behind the DOM (`.webgl`, z-index 0). Sections are transparent, so the car shows through.
- **Camera poses** live in `POSES` as orbit coordinates around a target: `az` (degrees around Y; 180 = facing the nose, 90 = right side, 0 = rear), `dist`, `y`, `tgt`, `fov`, plus `shift`/`shiftY` (subject offset as a fraction of the viewport, applied through `camera.setViewOffset`; +shift = right, +shiftY = up), `speed` (wheels, streaks, floor scroll) and `glow` (light emissive level).
- **`computeKeys()`** maps poses to document scroll positions (section start, center or end, or a pinned ScrollTrigger's start and end). It reruns on every ScrollTrigger `refresh`. `poseFromScroll()` eases between neighbouring keys, and the render loop damps `rig` toward that target. Never tween the camera directly. To change the choreography, add or edit a pose and a key.
- `az` is interpolated linearly with no wrapping, so poses are chosen to be monotonic. The orbit chapter goes -238 → -598 on purpose. Keep neighbouring values close so the camera never swings through the car.
- The car's **front faces -Z**. Wheel nodes are `wheel_fl/fr/rl/rr` and spin on `rotation.x`.
- Hotspots (`.hotspot`) are 3D points in `HOTSPOTS` projected to screen each frame. They're visible only inside `#detail`, each within its own progress window.

## Model gotchas (read before touching materials)

- GLTFLoader **de-duplicates names** (`centre`, `centre_1`, …), so use the `paintAll(name, material)` helper inside `setupCar`, not `getObjectByName`, for anything that repeats per wheel.
- The source material names are misleading. **`interior_dark` is the light-grey wheel-arch liners and floor**, and `interior_light` is the grilles and cabin tub. To identify an unknown part, temporarily paint candidates with bright `MeshBasicMaterial` colours and take a screenshot.
- Badged parts are toned down on purpose: `yellow_trim` (fender shields) is hidden and `centre` (wheel caps) is painted dark. Keep the site unbranded: no manufacturer names in copy, and paint names stay generic.

## Lighting / bloom gotcha

The HDRI is loaded as float data and **clamped to `ENV_PEAK`** before PMREM, and `BLOOM_THRESHOLD` sits just above it. That split is deliberate. Only emissive parts (LEDs, tail-lights, speed streaks) should bloom, never paint reflections. If you raise `ENV_PEAK` past the threshold, big white flares come back on the hood and windscreen.

## Verifying changes

There are no tests. Verify visually by serving the site and screenshotting it in headless Chrome with `puppeteer-core` (install it in a scratch directory, never in this repo; Chrome is at `C:/Program Files/Google/Chrome/Application/chrome.exe`, launch with `--use-angle=d3d11 --ignore-gpu-blocklist`). Wait until `.loader` has `display: none`, then `window.scrollTo` each chapter and wait about 3.5 s for the camera damping to settle before capturing. Check 1440×900 and 390×844, and watch the console for errors.

## Conventions

- Match the existing style: 2-space indent, single quotes, `$` / `$$` query helpers, banner comments between sections, sparse inline comments that explain *why*.
- Animate with GSAP, not CSS transitions, for anything scroll-linked. CSS transitions are fine for hover states.
- Respect `prefers-reduced-motion`: Lenis and the intro are skipped and the camera settles instantly.
- Keep credits in the footer and README accurate if assets change.
