# Rig — 3D Camera Path Editor

A Spline-inspired web editor for people who are **not** 3D animation professionals:
import a `.glb`, draw (or one-click generate) a camera path, tune everything with
sliders and simple keyframes, and export a ready-to-post MP4.

Built with Vite + React 19 + TypeScript, three.js (@react-three/fiber + drei),
zustand and Tailwind CSS v4. 100% client-side — no backend.

## Run

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check + production build in dist/
```

> Note: this folder lives on a drive where native file-watching is unreliable, so
> `vite.config.ts` uses polling for HMR.

## Features (v0.5.0)

### Scene
- Multiple `.glb`/`.gltf` objects (drag & drop or Import, multi-file), normalized and
  floor-snapped; built-in sample shape
- **Parametric primitives**: the `+` toolbar menu adds Box / Sphere / Cylinder / Cone /
  Plane / Torus (rounded-corner clay). A per-kind **Shape** panel edits dimensions,
  corner and segments with live sliders; primitives serialize as a light descriptor
  (no IndexedDB), rebuild on load, and are fully undoable
- Clay aesthetic with **per-object grayscale shades** (auto-cycled + Shade slider)
- Select / rename / duplicate (rig-safe clone) / delete objects; hover & selection feedback
- Transform gizmo (W/E/R modes), XYZ panel, background color, grid toggle
- **Scene persistence**: GLB buffers in IndexedDB + metadata in localStorage — a page
  reload restores the whole scene; import spinner and heavy-model (>1.5M tris) warning

### Camera path
- Pen tool: click = corner, click-drag = Bézier handles, click first anchor to close
- 1-click presets from the scene bounding box: Orbit, Half Arc, Flyover, Push In
- Slider-first controls: Curves (auto Catmull-Rom→Bézier rounding), path Height,
  per-point Height; manual handle editing (mirrored/broken) for advanced users
- Double-click on the curve inserts an anchor mid-path
- **3D transform gizmo** on the selected anchor (translate X/Y/Z) for precise placement,
  including height — no longer limited to the ground plane; click a Bézier handle to give
  it its own gizmo. Handle In/Out also have numeric XYZ fields in the panel

### Motion paths & path-follow (v0.5)
- **Multiple named paths**: the camera path is just one path in a shared collection
  (`usePathStore`); add more via Toolbar `+` → *Path (draw)* or the Follow-path dropdown.
  A **Paths** group in the left tree selects which path the pen/gizmos edit; inactive
  paths draw as faint lines
- **Attach objects to paths**: an object’s *Follow path* section rides it along any path —
  align-to-tangent (points forward), start offset, height, bank and loops. Follow drives
  the transform during playback and scrubbing, wins over pose keyframes, is undoable and
  persists with the project (e.g. attach a car and it drives the route)

### Multi-pane viewport (Blender-style, v0.5)
- **Split the viewport** into tiled panes: footer *Split* buttons, then drag any pane’s
  corner grip inward to split again (drag direction picks the axis), drag dividers to
  resize, drag a divider to the edge (or ×) to join back
- One pane is the interactive **Editor** (orbit/select/gizmos); the others are look-only
  fixed views — **Camera / Front / Top / Right** — chosen per pane
- Single-pane mode is identical to the classic editor; play mode and exports are
  untouched (always full-frame through the cinema camera)

### Camera view PiP (v0.5)
- The floating *Camera view* window is **draggable** (grab the title bar) and
  **resizable** (bottom-left grip), clamped to the window — it auto-hides while the
  viewport is split

### Animation (no pro-style keyframe walls)
- Shared docked timeline (Spline-like): ruler, scrub, playhead badge, per-object tracks,
  draggable diamonds (retime), double-click to delete, `+` to add at the playhead
- **Camera keyframes**: pin "at second X be at Y% of the path" (implicit endpoints)
- **Object pose keyframes**: pose with the gizmo, save keyframe; Spin 360° preset;
  quaternion-slerp interpolation; embedded GLB animation clips play synced to the timeline
- Duration + Smoothness sliders, loop toggle

### Camera & preview
- Cinema camera follows the path with constant speed (arc-length), look-at target
  (draggable) or motion direction, FOV and Roll
- **Camera view PiP** with framing guides for the output format
- **Format settings** (Camera › Format and Export menu, kept in sync):
  16:9 / 1:1 / 9:16 × 720p / 1080p / **Custom W×H**
- Play mode (fullscreen through the cinema camera, Esc exits)

### Render passes (ControlNet references)
- Global view modes: **Clay / Depth / Outline / Normals** — chips next to the projection
  toggle; viewport, camera PiP, play mode and exports all follow the mode
- Depth = linear view-space depth with a window that tracks the camera around the scene;
  Outline = Sobel over a normal+depth buffer (black lineart on white, grazing-angle safe);
  Normals = view-space normal colors
- Editor helpers (grid, gizmos, path) hide automatically in technical modes

### Export
- **MP4 (H.264)** rendered offline frame-by-frame at 30 fps via WebCodecs + mp4-muxer —
  deterministic and smooth at the exact chosen resolution (canvas container resize);
  progress overlay, Esc cancels; WebM realtime fallback without WebCodecs
- **Multi-pass**: checkboxes in the Export menu — one click produces matched files per
  pass (`camera-animation_depth.mp4`, `_outline.mp4`, …) from the same deterministic render
- **Single frame**: exports the current playhead as PNG per selected pass
  (`frame-2.4s_outline.png`) for image-model restyling
- Camera rig JSON export/import (versioned, backward compatible)

### AI assistant (BYOK)
- Design inspector + Director chat split in the right panel — a Claude agent drives the editor from chat
  (presets, custom paths, keyframes, look-at, lens, object poses, primitives, save shot,
  output format)
- Sees a scene JSON + viewport screenshot every turn
- **Camera skills**: built-in recipes (drone, packshot, orbit-reveal, dolly-push) plus
  your own — a Skills manager lets you author custom camera-move skills (name +
  description + recipe) per project; the agent lists and loads them on demand, and chips
  let you force one. Project guidelines feed the agent too.
- Multi-provider (BYOK): **Anthropic**, **OpenRouter**, or **z.ai** (GLM models, e.g.
  glm-5.2). Pick the provider, key and model in Settings; a screenshot toggle sends the
  viewport to vision models. Keys stored locally (localStorage)

### Projects, shots & board
- Everything lives inside a project (scene, rig, shots, guidelines, camera skills) in
  IndexedDB; project switcher/name in the left panel; v0.1 scenes auto-migrate
- Save shot snapshots the current camera move (rig + format + thumbnail); Editor | Board
  switcher opens a storyboard of shot cards (drag to reorder, Play animatic)

### Editor comfort
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) over paths, keyframes, transforms,
  colors and object add/remove
- Shortcuts: V select · P pen · W/E/R gizmo · F frame · Space play · Esc ·
  Del (anchor/object) · Ctrl+D duplicate
- Quick views (Front/Top/Right), live zoom % (click to frame), New project menu
- Click the PiP to look through the cinema camera while editing
- First-run onboarding card; autosave of rig + scene settings

## Known limitations / backlog
- Undo of object add/remove relies on an in-memory graveyard (capped at 40 objects)
- Deliberately out of scope: states/events, collaboration, mobile
