# APEX — Rosso Study

A cinematic, scroll-driven showcase of a real-time 3D supercar. A physically based car model sits in an HDRI studio on a mirror floor. As you scroll, the camera moves through seven chapters: hero, form, detail, performance, a paint/wheel configurator, a horizontal anatomy reel, and the finale.

**Live:** https://dhrumilbs.github.io/apex-racing/

## Stack

There is no build step. Everything loads from a CDN using pinned versions:

| Library | Version | Used for |
| --- | --- | --- |
| [Three.js](https://threejs.org) | 0.170.0 | GLB car, HDRI environment, reflector floor, bloom post-processing |
| [GSAP](https://gsap.com) + ScrollTrigger + SplitText | 3.13.0 | Text reveals, pinned sections, scrubbed timelines, counters |
| [Lenis](https://lenis.darkroom.engineering) | 1.3.11 | Smooth scrolling synced to ScrollTrigger |

## Run locally

Any static server works. With XAMPP's PHP:

```powershell
& 'D:\xampp\php\php.exe' -S 127.0.0.1:8080 -t .
```

Then open http://127.0.0.1:8080/. Opening `index.html` straight from disk will not work, because the ES modules and GLB loading need HTTP.

## Structure

```
index.html            markup for every chapter + import map
css/styles.css        design tokens, layout, cursor, HUD, responsive rules
js/main.js            renderer, camera rig, GSAP choreography, configurator
assets/models/        ferrari.glb (Draco) + ferrari_ao.png contact shadow
assets/hdr/studio.hdr studio lighting environment
v1/                   the previous procedural/SVG version, kept for reference
```

## Credits

- 3D model: "Ferrari 458 Italia" by vicent091036, as distributed with the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf).
- HDRI: [Studio Small 09](https://polyhaven.com/a/studio_small_09) by Poly Haven (CC0).

This is an unofficial design showcase. It is not affiliated with or endorsed by any manufacturer, and all trademarks belong to their owners.
