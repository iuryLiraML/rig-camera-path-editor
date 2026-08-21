# AGENTS.md

## Cursor Cloud specific instructions

Rig is a **100% client-side** 3D camera-path editor (React 19 + TypeScript +
three.js/@react-three/fiber + zustand + Tailwind v4, built with Vite 7). There
is **no backend to run** for the core product. Standard commands live in
`README.md` and `CLAUDE.md`; the notes below only cover non-obvious caveats.

### Services

| Service | Command | Notes |
| --- | --- | --- |
| Vite dev server (the whole app) | `npm run dev` | Serves the editor on `http://localhost:5173`. This is the only service needed to exercise the product end to end. |

Run it in a persistent (tmux-backed) terminal, not a one-shot background
process. The dev server is the only long-running process; the update script
installs deps but must not start it.

### Non-obvious caveats

- **This checkout is the public, client-only repo.** `CLAUDE.md` references
  `docs/STATUS.md`, `docs/PROJECT-OVERVIEW.md`, `docs/HANDOFF.md`,
  `CONTEXT.md`, `docs/BACKLOG.md`, a private `rig-cloud` backend, and a
  `server/tsconfig.json` — **none of those exist here**. Don't waste time
  looking for them. `npm run build` and `npm run build:web` are identical in
  this repo (both run `tsc --noEmit && vite build`).
- **Lint = type-check.** There is no ESLint config and no `lint` script. The
  type-check gate is `tsc --noEmit`, which runs as the first half of
  `npm run build`. Use `npm run build` to catch type errors.
- **Tests:** `npm test` (vitest run, jsdom). All specs pass out of the box
  (~85 files / ~494 tests). A spec that needs a DOM opts in with the docblock
  `// @vitest-environment jsdom` (see the "Testing notes" in `CLAUDE.md`).
- **Dev server port is strict.** `vite.config.ts` sets `strictPort: true` and
  reads `PORT`; a busy 5173 is a hard error rather than silently moving to
  5174 (the origin is pinned for OAuth/CORS). HMR uses filesystem **polling**
  (`usePolling: true`), which is intentional.
- **The `/api` proxy target (`127.0.0.1:8787`) and the agent proxy are
  optional.** They only matter for the BYOK AI "Director" assistant and fal.ai
  features. Core editing/animation/export works with no keys and no backend;
  unhandled `/api/*` calls simply fail without the (absent) cloud backend.
- **AI/cloud keys are opt-in.** Server-side keys go in `.env.local`
  (`ANTHROPIC_API_KEY`, `KIMI_API_KEY`, `FAL_KEY`) and must **never** be
  `VITE_`-prefixed (that would inline them into the public bundle). The
  assistant is also BYOK via Settings (localStorage), so no env keys are
  required for setup.
- **Verify in the browser.** For UI/geometry/animation work, drive the dev
  server and inspect the DOM/screenshots yourself rather than asking the user.
