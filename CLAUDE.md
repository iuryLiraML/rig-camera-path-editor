# Rig — 3D camera path editor

A Spline-inspired web app for drawing camera paths in 3D and exporting MP4
reference animations for generative AI. React 19 + TypeScript + three.js
(@react-three/fiber) + zustand + Tailwind v4, built with Vite 7.

**Read `docs/STATUS.md` first** — it says what shipped, what is broken, and what
is next. `docs/PROJECT-OVERVIEW.md` is the orientation document: what the product
is, how the screens connect, the feature inventory and the architecture, with every
claim marked shipped / spec / open. `docs/HANDOFF.md` is the team-facing architecture document (note its
version header: it can lag behind the code). `docs/BACKLOG.md` is the live bug
and gap list. `CONTEXT.md` is the domain glossary.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues at `iuryLiraML/rig-cloud`; every `gh`
command must pass `--repo iuryLiraML/rig-cloud`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical labels: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, and `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository: read root `CONTEXT.md` and relevant ADRs
under `docs/adr/`. See `docs/agents/domain.md`.

## Commands

```bash
npm run dev          # dev server on :5173 — use the preview/browser tools, never Bash
npm test             # vitest, all specs
npm run build:web    # tsc --noEmit && vite build  (what the public repo/Vercel runs)
npm run build        # web + the Node backend (needs server/tsconfig.json)
```

## Hard rules

- **All UI text, comments, docs and deliverables are in English.** The
  conversation with the user is usually Portuguese; the product never is.
- **Two remotes, and they are not interchangeable.**
  `rig-cloud` (private) holds everything, branch `cloud-wip` -> `main`.
  `origin` (public, `rig-camera-path-editor`, branch `master`) is what **Vercel
  builds**, and it carries the client app only. Never push `cloud-wip` to
  `origin` — see the publish procedure in `docs/STATUS.md`.
- **No secrets in the repo, ever**, and remember `VITE_*` values are inlined
  into the public bundle, so a secret there is a published secret.
- **Objects default to grayscale derived from Shade.** Users may explicitly set
  a per-asset clay color; it applies to Solid and Wireframe while Look preserves
  source textures. Do not make incidental light, environment, or global material
  changes.
- **The animation must be a pure function of `t`.** The MP4 exporter renders
  frame by frame offline and scrubbing jumps around, so anything that carries
  state from the previous frame makes the preview disagree with the export. This
  is why `lib/cameraOrientation.ts` re-derives the camera basis every frame
  instead of propagating an up vector.
- **Verify in the browser yourself.** The preview tools drive the dev server —
  read the DOM, measure geometry, screenshot. Do not ask the user to check.
- **Test data belongs to the user.** Their project (cameras, paths, shots) is
  real work. Create your own throwaway cameras/paths to test destructive
  actions; if you must touch theirs, snapshot `useRigStore.exportJSON()` first
  and confirm the restore worked.

## Testing notes

- vitest 4: `environmentMatchGlobs` is gone. A spec that needs a DOM starts with
  the docblock `// @vitest-environment jsdom`.
- No jest-dom, so no `toHaveTextContent` — assert on `.textContent`.
- jsdom has no `ResizeObserver` and no `Element.prototype.scrollTo`; shim or
  avoid them. UI code that measures itself should read the window instead (see
  `ui/viewportInsets.ts` for why).
- For a geometry or animation bug, prefer a numeric test over a screenshot: the
  strongest one is refining the sampling and asserting the step shrinks (a
  discontinuity does not) — `lib/cameraOrientation.test.ts` is the template.
