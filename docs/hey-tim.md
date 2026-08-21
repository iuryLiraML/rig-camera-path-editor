# Hey Tim — here's Rig, and I want your brain on it

Tim — this is the dump I wish someone had handed me. Informal, long, and honest about what actually works vs what is a leftover. I like how you think (creative *and* technical), so I'm not asking you to rubber-stamp a plan. I'm asking you to look at the product, the architecture, and three messy problems, then tell me how *you* would shape them.

I'm fully open to throwing parts of this away. If a better mental model shows up, we follow that.

Repo (public client): [github.com/iuryliraml/rig-camera-path-editor](https://github.com/iuryliraml/rig-camera-path-editor). There's also a private cloud backend (`rig-cloud`) that this checkout talks to when env vars are set. This folder is the editor people actually use.

---

## What this app even is

**Rig** is a Spline-inspired web editor for people who are *not* 3D animation professionals.

The job: import a `.glb` (or drop a still and lift it into clay), draw or generate a camera path, tune the move with sliders and simple keyframes, and export an MP4 that generative-video models can restyle. Clay / depth / outline / normals passes exist specifically as ControlNet-style references.

Target user is closer to a director or a brand person than a Maya TD. That's why the UI is slider-first, why the Director chat exists, and why we keep a clay grayscale look instead of a PBR playground.

Version in `package.json` is **0.7.0**. The README still says 0.5.0 in places — treat the code as source of truth, not the README.

Stack, boring but useful:

- React 19 + TypeScript + Vite 7
- three.js via `@react-three/fiber` + drei
- zustand stores
- Tailwind v4
- IndexedDB for projects, localStorage for a few settings
- Optional Vercel Edge `/api` proxies for Anthropic / Kimi / fal
- Optional private cloud API for Google login + project sync

Core product is **100% client-side**. No backend required to edit, play, or export. Cloud login, vault keys, and project sync are an overlay.

---

## How to run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build    # tsc --noEmit && vite build
```

Node `>= 22.12`. Port **5173 is strict** — if it's busy, Vite dies instead of hopping to 5174 (OAuth/CORS origin is pinned).

AI keys are opt-in:

- BYOK in Settings (localStorage) — Anthropic or Kimi
- Site keys in `.env.local`: `ANTHROPIC_API_KEY`, `KIMI_API_KEY`, `FAL_KEY` — **never** `VITE_`-prefix those, they would ship in the public bundle
- Cloud login needs `VITE_CLOUD_API_BASE` + `VITE_GOOGLE_CLIENT_ID` (and the private backend)

---

## The product in one picture

```
Projects home
    └── open a project ──► Editor
                              ├── Build      place objects, clay scene
                              ├── Compose    camera, timeline, sequence of shots
                              └── Visualize  “generate a reference from a prompt”
                                              (chrome-stripped; Director still there)

Everything autosaves into one project blob in IndexedDB.
Optional: that blob also syncs to the cloud when you're signed in.
```

There is **one 3D scene per project**. “Shots” are camera-rig snapshots against that same scene, not separate worlds. The Projects cards say “N scenes” — that's marketing copy for saved shots. More on that later; it's one of the things I want you to unpick.

---

## Architecture (the useful version)

No React Router. `App.tsx` looks at `appView` and mounts either the Projects home or the editor. Inside the editor, `workspaceMode` is `build | compose | visualize`. Chrome is a flag matrix in `src/lib/workspaceChrome.ts`.

### Boot

`src/main.tsx`:

1. Pick runtime: default clay editor, or `?runtime=gs` for a PlayCanvas Gaussian-splat spike (`src/stage/` — **not** the shipped product)
2. Ask `/api/agent-config` which site keys exist
3. Bootstrap cloud auth
4. `bootProjects()` — load IndexedDB, maybe hydrate from cloud, migrate old scenes
5. Mount `<App />`

### Stores (zustand)

| Store | Owns | Lives where |
| --- | --- | --- |
| `useEditorStore` | tool, selection, play/export UI, workspace mode, compose dock | memory |
| `useRigStore` | duration, ease, loop, look-at, FOV/roll, camera keys, noise, playhead `t` | inside the project blob |
| `usePathStore` | motion paths (camera path is just one of them) | project blob |
| `useSceneStore` | 3D objects, shades, pose keys, follow-path | object buffers in IDB; light settings in `localStorage` (`rig-scene-settings`) |
| `useProjectStore` | name, shots, skills, guidelines, workflow, director chat, folder | IDB `projects` |
| `useCameraOptionsStore` | named camera alternatives for the same scene | project blob |
| `useLayoutStore` | Blender-style viewport panes | memory (session) |
| `useAgentStore` | provider, keys, models, chat, vision mode | keys in `localStorage` (`rig-agent-settings`); chat also copied onto the project |
| `useCloudAuthStore` | Google/dev token, session, vault credential ids | token in `localStorage` (`rig-cloud-access-token`) |
| `useBatchStore` | local camera-batch progress | memory |
| `useSaveStatusStore` | saved / saving / dirty chip | memory, on purpose, so status writes don't retrigger autosave |

### Persistence

IndexedDB database `rig-db` v4:

- `projects` — one `ProjectRecord` per project
- `model-buffers` — raw GLB `ArrayBuffer`s (keyed by object/buffer id; shared until swept)
- `folders` — local folders on the Projects home

A project record is roughly: meta + workflow + guidelines + custom skills + saved shots + director chat/lessons + `sceneMeta` + camera `rig` + `paths` + camera options.

Autosave is ~800ms debounce. Ctrl+S flushes. Hide / unload flushes. If you're signed into cloud, the same write goes up with `If-Match`; a 409 pops “this was saved on another device” (Reload / Overwrite).

Active project id sits in `localStorage` as `rig-active-project`.

**Important isolation fact:** local IDB is **one database per browser origin**. It is not keyed by user. Sign-out wipes the whole DB. Two Google accounts on the same laptop without signing out would share (or clobber) local projects. That's the first problem I want you on.

### Animation has a hard rule

The cinema camera is a **pure function of `t`**. Preview, scrubbing, and offline MP4 must agree. Anything that carries state from the previous frame will look fine in play and wrong in export.

That's why `src/lib/cameraOrientation.ts` re-derives the camera basis every frame instead of propagating an up vector. `evaluateCinemaPose(t, path, channels)` is the one true pose function. Object motion is the same idea: follow-path wins over pose keys wins over the static transform.

If we ever “improve” camera skills by adding clever frame-to-frame smoothing, we will break export. Skills have to emit *data* (path, keys, noise clip), not a runtime behavior.

### Export

- MP4 H.264 at 30fps via WebCodecs + `mp4-muxer`, frame-by-frame, exact export resolution
- Multi-pass: clay / depth / outline / normals as separate files from the same deterministic render
- Single frame PNG at the playhead
- Camera-rig JSON (versioned)

WebM realtime fallback if WebCodecs isn't there.

### Cloud vs this repo

This public repo is what Vercel builds. The private backend is *not* here. Client talks to it through `src/lib/cloud/client.ts` when `VITE_CLOUD_API_BASE` is set (`isTeamCloudApp()`).

Same-origin `/api` in *this* repo is only:

- `GET /api/agent-config` — booleans, which site keys exist
- `/api/anthropic/*` — allowlisted proxy
- `/api/kimi/*` — allowlisted proxy
- `/api/fal/proxy` — fal.ai host allowlist

Google Identity Services button is `src/ui/GoogleSignInButton.tsx`. If `VITE_GOOGLE_CLIENT_ID` is missing, the button renders **nothing** (so the paste-a-dev-token path still works).

### Folders on disk (if you want to wander)

```
src/app/          shell, workspace resolution
src/state/        zustand
src/ui/           all the DOM chrome
src/viewport/     R3F canvas, path editor, cinema camera, render passes
src/lib/          domain: curves, keys, persist, export, agent, fal, cloud
src/lib/agent/    Director LLM, tools, skills, judges, intake prompts
src/stage/        GS splat spike — ignore unless you're curious
api/              Vercel Edge + Vite-dev agent proxies
```

---

## What's actually working

This is the “you can sit down and use it” list. Not aspirational.

### Projects home

- Create / rename / delete projects
- Folders (local): create, rename, move projects in
- Cards with thumbnail + “N scenes” (those are saved shots)
- Open a project into the editor
- Autosave + dirty/saved chip
- Cloud: list/hydrate/sync when signed in; conflict dialog
- Google sign-in *path* is real code against `/v1/session` — it works when the private backend + client id are configured. Without that, you're a local IndexedDB user and login looks dead

### Build (place the world)

- Import multiple `.glb` / `.gltf` (drag-and-drop or picker), normalized, floor-snapped
- Parametric primitives: box / sphere / cylinder / cone / plane / torus (rounded clay)
- Per-object grayscale shade (auto-cycled + slider) — **objects are differentiated by grayscale only**, don't start painting lights
- Select, rename, duplicate (rig-safe clone), delete
- Transform gizmo W/E/R, XYZ panel
- Background color, grid
- Heavy-model warning (>1.5M tris), import spinner
- Outliner / left tree, add drawer
- Photo → clay people (SAM 3D Body via fal) and photo → prop (`generate_prop`)
- Remesh / retopo queue for dense meshes

### Compose (camera and time)

- Pen tool: click = corner, click-drag = Bézier, click first point to close
- 1-click path presets from the scene AABB: Orbit, Half Arc, Flyover, Push In
- Curves slider (Catmull-Rom → Bézier rounding), path height, per-point height
- 3D gizmo on anchors *and* Bézier handles
- Multiple named motion paths; objects can follow a path (align-to-tangent, offset, height, bank, loops)
- Cinema camera: arc-length speed, look-at target (draggable) or motion direction, FOV, roll
- Free / static camera authoring (look through it, WASD fly) with pose keys
- Camera noise clip (handheld / rumble / shake) — not fake XYZ jitter
- Named camera options (alternatives you can switch)
- Timeline: ruler, scrub, playhead, per-object tracks, Spline-like diamonds
- Independent Position / Rotation / Scale channels; graph editor for curves
- Camera progress keys (“at second X be at Y% of the path”)
- Object pose keys, Spin 360° preset, quaternion slerp
- Embedded GLB clips synced to the timeline
- Duration, smoothness, loop
- Sequence strip: save current as a shot, reorder, play animatic
- Camera view PiP (draggable/resizable), framing guides
- Format: 16:9 / 1:1 / 9:16 × 720p / 1080p / custom W×H
- Play mode (fullscreen through the cinema camera)
- Multi-pane viewport (Blender-style split: Editor / Camera / Front / Top / Right)

### Visualize

- Mode exists in the switcher: “Generate a reference from a prompt”
- Editing gizmos turn off
- Director dock stays
- There is **no** extra generate rail (`visualizeRail` is always `false`). So Visualize is currently “quiet canvas + Director”, not a finished workspace

### Director (the AI)

Live chat in the right dock. One voice. It compiles a shot in phases (plan → objects if needed → camera → code judge → optional vision judge → auto-play).

Providers that are actually wired: **Anthropic** and **Kimi**. README still mentions OpenRouter and z.ai — those were removed.

Every turn it gets a scene JSON snapshot. Optionally a viewport still (or a photo you attached). Tools can:

- load a skill
- start / switch camera options
- measure a subject
- instantiate a camera atom (`orbit | arc | flyover | dolly | crane | pan | tilt | zoom`)
- apply a preset, set a custom path, path params, camera keys, look-at, noise, lens, output format
- save shot, play preview, set playhead
- pose objects, add/update/remove pose keys, spin, follow-path, create object paths, add primitives
- lift people from a still, generate a prop via fal

Built-in cinematography skills (name + long recipe body):

| Skill | Feel |
| --- | --- |
| `shot-grammar` | ECU…ELS, angles, atoms → tools, fill % for the judge |
| `packshot` | slow orbits, hero 3/4, holds, flat-lay, loops |
| `commercial-beauty` | soft beauty ads — **never auto-picked** today |
| `cinema-basics` | establishing, push/pull, tracking, crane, OTS |
| `drone` | flyover, dive, chase/strafe FPV |
| `handheld` | noise clip, not XYZ shake |
| `orbit-reveal` | behind/low → sweep → hero hold |
| `dolly-push` | straight push / pull-back / creep |
| `photo-lift` | still → people or prop |
| `set-blocking` | clay walls/floors/props, feet at y=0 |

Custom skills are per-project (`name`, `description`, `body`). Skills manager in the Director. Project guidelines (Settings textarea, or leftover from intake) get appended to the system prompt. Failed framing retries can leave “lessons” on the project (last 12, prompt uses ≤8).

There is a deterministic **code judge** (subject fill % vs requested scale) and an optional **vision judge** (three stills at t=0 / 0.5 / 1). Max ~2 judge cycles. Object phase ≤8 turns, camera ≤12 — cramped for ambitious asks.

### Export / render passes

- Global view modes: Clay / Depth / Outline / Normals
- Viewport, PiP, play, and export all follow the mode
- Helpers hide in technical modes
- MP4 + PNG + multi-pass as above

### Comfort

- Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
- Shortcuts: V select, P pen, W/E/R gizmo, F frame, Space play, Esc, Del, Ctrl+D
- First-run onboarding
- Shortcuts overlay

---

## What's half-built, orphaned, or lying in the README

I want you to see the scar tissue, not discover it three days in.

**Intake / Director interview / PRD / shot list.** There is a whole workflow model in `src/lib/projectWorkflow.ts`: foundation → brief (PDF/DOCX/text) → interview → brief review → asset intake → subject confirmation → guidelines → PRD → planned shot list → editor. The step UIs exist. `ProjectIntakeWorkspace.tsx` exists. **App never mounts it.** `resolveWorkspace` literally says project setup is retired; `intake` and `board` both dump you into the editor. The data can still sit on a project. The wizard is unreachable.

**Board view.** `BoardView.tsx` is a full storyboard. Sequence strip in Compose is what shipped. `setAppView('board')` redirects to Compose + sequence dock. README still talks about an Editor | Board switcher.

**Batch generate panel.** `BatchGeneratePanel.tsx` + `useBatchStore` + `runLocalBatch` can turn a *planned* shot list into presets + saved shots. The panel is never mounted. Batch also does **not** go through the Director / skills / judge — it maps profiles (`packshot`, `reveal-orbit`, `dolly`, `fpv-drone`, `custom`) onto dumb presets. Those profile ids don't even match skill ids (`orbit-reveal`, `drone`, …).

**Force-skill chips.** Store has `forcedSkill`. README says chips let you force a skill. Nothing in the UI calls `setForcedSkill`.

**`commercial-beauty` skill.** Written, listed, never selected by `skillNameForPlan`.

**Visualize workspace.** Switcher exists; generate rail does not.

**Gaussian splat runtime.** `src/stage/`, `?runtime=gs`. Spike.

**OpenRouter / z.ai.** Dead. Docs stale.

**Cloud delete.** Client can create/list/patch projects. No cloud DELETE. Local delete is IDB only.

**Folders.** Local only. Cloud project list merges local `folderId`. They will drift.

**Collaboration / mobile.** Explicitly out of scope, and I still don't want a Figma-multiplayer science project unless you convince me otherwise.

**Undo of object add/remove.** In-memory graveyard, cap 40.

**Hydrated Director chat.** Restores text. Tool calls and images don't come back as a real agent transcript.

**Two “guidelines” fields.** Project guidelines feed the chat. Agent-store `guidelines` is still persisted from an older Settings design and ignored.

**Two kinds of “shot”, zero scenes.**

1. Editor `Shot`: `{ id, name, order, rig, format, duration, thumbnail }` — a camera snapshot. Loading it restores the *rig*, not a different 3D scene.
2. Intake `PlannedShot`: `{ id, order, name, profile, durationSeconds, intent, framingNotes, constraints }` — a wishlist. Materialize creates a *new* editor shot with a new id. No foreign key.

There is no Scene entity. One project = one object graph. The word “scene” on the home cards is a saved shot.

---

## Three things I actually want help with

These are the ask. Features above are context so you don't propose something we already quietly built, or something the architecture will fight.

### 1. User profiles, login, and keeping projects separate

Today:

- Local: whoever opens `localhost:5173` (or the Vercel origin) owns **all** IndexedDB projects. One pile.
- Cloud: Google ID token → `/v1/session` → `userId` + `tenantId`. Server scopes the project list. Sign-out **wipes local IDB** so the next person doesn't inherit your GLBs. Brutal, but that's the isolation we have.
- Agent API keys: BYOK in localStorage (machine-global), or vaulted per signed-in user on the cloud.
- No first-class Profile object on the client. No family-computer / agency-desk story. No “I'm on a shared iMac, switch to my stuff without nuking the last person's local cache unless we mean to.”

What I need from you is not “add a login button” — the button exists. I need a *model*:

- What is a user, a tenant, a device, a local cache?
- How do we keep Project A of person 1 from ever leaking into person 2's home, including GLB buffers and shot thumbnails?
- What's the story when cloud is down? Offline-first editor is a feature, not a bug.
- How do we treat BYOK keys vs studio-vault keys vs site keys on Vercel?
- Is Google the only identity, or do we want email magic-link / a dumb local profile (name + pin) for people who will never get a cloud account?
- Guest vs signed-in: do guests even get persistence, or is local-only a first-class “this browser is the account”?

Constraints I care about:

- No secrets in `VITE_*`
- Don't make the public Vercel build require a backend to *edit*
- Don't invent collaboration (two cursors, CRDT) unless you really believe that's the product
- Sign-out currently `idbClear()`s everything — that's a loaded gun, maybe correct, maybe not

I'm not married to the current cloud session shape. If “profile” should live above “project” in a way the IDB schema doesn't support, say so.

### 2. Organize projects, and scenes, by shot

This is the product-structure problem. Right now the hierarchy is accidentally flat:

```
Folder? (local)
  └── Project
        ├── one 3D scene (objects + buffers)
        ├── camera rig + paths + camera options
        ├── Shot[]          ← saved camera takes (UI sometimes calls these “scenes”)
        └── workflow.shotList.PlannedShot[]   ← leftover intake wishlist
```

What I actually want in my head, as a director:

- A **project** is a job / client / film.
- Inside it, **scenes** are places (the kitchen, the pack on a seamless, the street).
- Inside a scene, **shots** are camera takes (hero orbit, CU label, drone arrive).
- A shot has a camera, a duration, maybe its own format, a thumbnail, and later a generated video.
- I should be able to play an animatic *across* shots, and also dive into one shot and sculpt it.

That's not what we built. We built “one scene graph, many camera snapshots.” Cheap, and it made the first version ship. It starts to hurt the moment you want two locations, or a still life and a person walk, without duplicating the whole project.

Questions I want you to chew on:

- Do we promote “scene” to a real entity (own objects, own buffers, own environment), with shots hanging off it?
- Or do we keep one stage and treat shots as cameras + optional object visibility / layout variants (Unreal sequencer / Blender scene collection energy)?
- How does the Sequence strip evolve — is it the spine of the product?
- What happens to camera options vs shots vs planned shots? Three lists is too many.
- Intake wanted to generate a shot list *before* you enter the editor. We retired the wizard but the instinct might still be right. Would you bring it back, fold it into Director, or kill it?
- Thumbnails, animatic, export-all-shots, “this shot is the one we sent to Kling / Runway” — where do those live?

Please don't just add a nested folder tree in the left panel. I want a structure people can *think* in.

### 3. Make the AI camera agents actually good

The Director is the most interesting unfinished thing in the app. It already has a compiler, tools, a code judge, vision, and a skill file format that's basically “markdown recipes the model should follow.”

What's weak, from watching it:

- **Plan parsing is regex.** `parseShotPlanFromText` guesses scale / move / intent from keywords. Easy to mis-tag, and then the wrong skill gets injected.
- **Skills vs atoms vs custom paths.** Recipes for `orbit-reveal` want a 3-act `set_camera_path`. The compiler prefers `instantiate_atom` and *hides* `set_camera_path` unless `move_kind === 'custom'`. So the nicest skills fight the tool gate.
- **`commercial-beauty` never auto-loads.** Force-skill UI was never wired.
- **Budgets are tight.** Complex “three options, then pick” asks run out of turns.
- **Batch ≠ Director.** The planned-shot batch path is a preset lookup. If we ever resurrect it, it should probably call the same compiler (or we admit batch is a cheap preview and stop pretending it's direction).
- **Profile vocabulary drifted.** Intake `reveal-orbit` / `fpv-drone` vs skills `orbit-reveal` / `drone`.
- **Visualize** is labeled like a generate product and doesn't have a generate UI.
- Skills are static markdown. No eval loop that says “this recipe produced a judge fail, rewrite the recipe.” Lessons exist, but they're leftover sentences from framing retries, not a skill library that gets better.

What I'd love you to invent / argue:

- What's the right *unit* of camera intelligence? A skill file? A typed shot graph? A small library of guaranteed-good atoms plus a model that only fills parameters? A real cinematographer agent that authors Bézier paths and we stop pretending presets are language?
- How do we keep the “animation is `f(t)`” rule while letting the agent be expressive (holds, ease, noise, multi-act reveals)?
- Should skills be user-editable forever, or do we ship a locked grammar and let custom skills be the escape hatch?
- How does Director relate to Visualize, to Sequence, to “generate 8 camera options for this pack”?
- Do we still want the interview → guidelines → PRD → shot list pipeline feeding the agent, or is that a graveyard we should delete so it stops confusing us?
- Eval: golden shots already exist (`goldenShots.test.ts`). How would you grow that into something that makes skills trustworthy?

I care more about a sharp model than about adding three more markdown recipes.

---

## Hard rules (please don't “fix” these on the way)

- **English in the product.** UI, comments, docs. We can talk however; the app stays English.
- **Grayscale clay.** Don't introduce colored materials or fancy lights unless we explicitly decide the aesthetic changed.
- **Pose is `f(t)`.** Preview == export. No hidden frame state.
- **User project data is sacred.** If you test destructive stuff, use throwaway cameras/paths, or snapshot `useRigStore.exportJSON()` first.
- **No secrets in the repo or in `VITE_*`.**
- Two remotes if you get that far: public `origin` (`master`, what Vercel builds) vs private `rig-cloud`. Don't push private-backend branches to the public remote.

---

## How I'd love you to work this

Read this, poke the app, ignore my implied solutions if they're dumb.

Then write back (a note, a sketch, a crazy Figma, a sequence diagram on a napkin — whatever you actually use) covering:

1. **Identity + isolation** — the object model and the user-facing story
2. **Project / scene / shot** — the object model and how Compose/Sequence should feel
3. **Director / skills** — what to keep, what to kill, what the agent is *for*

If those three collapse into one idea (e.g. “a shot is the account of record, and the agent only ever authors shots inside a scene”), even better. I would rather one coherent world than three bolted features.

I'm not looking for estimates. I'm looking for taste.

Thanks for taking this on. I trust your eye.

— Iury

---

## Appendix: files worth opening first

| If you're thinking about… | Start here |
| --- | --- |
| Boot + workspaces | `src/main.tsx`, `src/app/App.tsx`, `src/app/resolveWorkspace.ts`, `src/lib/workspaceChrome.ts` |
| Project blob / autosave | `src/lib/projects.ts`, `src/lib/idb.ts`, `src/state/useProjectStore.ts` |
| Auth / cloud | `src/state/useCloudAuthStore.ts`, `src/ui/GoogleSignInButton.tsx`, `src/lib/cloud/` |
| Shots / sequence | `src/ui/SequenceStrip.tsx`, `src/state/useProjectStore.ts` (the `Shot` type) |
| Retired intake | `src/lib/projectWorkflow.ts`, `src/ui/ProjectIntakeWorkspace.tsx` |
| Camera pose | `src/lib/evaluateCinemaPose.ts`, `src/lib/cameraOrientation.ts` |
| Director | `src/ui/DirectorDock.tsx`, `src/lib/agent/shotCompiler.ts`, `src/lib/agent/tools.ts`, `src/lib/agent/systemPrompt.ts` |
| Skills | `src/lib/agent/skills/index.ts`, `src/ui/SkillsManager.tsx` |
| Export | `src/lib/recorder.ts` |
| Agent proxies | `api/_lib/agentApi.ts` |
