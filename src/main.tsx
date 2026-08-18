import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { App } from './app/App'
import { GsRuntimeApp } from './stage/GsRuntimeApp'
import { useEditorStore } from './state/useEditorStore'
import { useSceneStore } from './state/useSceneStore'
import { useRigStore } from './state/useRigStore'
import { usePathStore } from './state/usePathStore'
import { useLayoutStore } from './state/useLayoutStore'
import { useProjectStore } from './state/useProjectStore'
import { useAgentStore } from './state/useAgentStore'
import { initHistory } from './lib/history'
import { loadServerKeys } from './lib/agent/serverKeys'
import { generateRacingDroneCameras } from './lib/cameraBatch/generateRacingDroneCameras'
import { bootProjects } from './lib/projects'
import { useCloudAuthStore } from './state/useCloudAuthStore'

/**
 * The R3F clay editor is the default again: it is the shipped product (it is what
 * Vercel serves) and the one being adjusted right now. The GS StageHost spike
 * stays one query away at `?runtime=gs` — nothing about it was removed.
 */
function resolveRuntime(): 'gs' | 'clay' {
  const param = new URLSearchParams(window.location.search).get('runtime')
  if (param === 'gs') return 'gs'
  if (param === 'clay') return 'clay'
  return 'clay'
}

function maybeGenerateRacingDroneCamerasFromQuery() {
  if (!import.meta.env.DEV) return
  const params = new URLSearchParams(window.location.search)
  if (params.get('genRacingDrone') !== '1') return
  const names = generateRacingDroneCameras(10, 10)
  console.info('[racing-drone] generated', names)
  params.delete('genRacingDrone')
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', next)
}

const runtime = resolveRuntime()

if (runtime === 'clay') {
  // Which vendors have a shared site key on this deployment (booleans only).
  void loadServerKeys().then((keys) => useAgentStore.getState().setServerKeys(keys))

  // Cloud session first so bootProjects can stay cloud-first when signed in.
  void useCloudAuthStore
    .getState()
    .bootstrap()
    .then(() => bootProjects())
    .then(initHistory)
    .then(maybeGenerateRacingDroneCamerasFromQuery)
    .catch((error) => {
      console.error('Project storage failed to initialize', error)
      useProjectStore.getState().setBooted(true)
      useSceneStore.getState().showNotice('Project storage is unavailable — changes may not be saved')
    })

  if (import.meta.env.DEV) {
    // exposed for debugging / automated verification only (app's real instances)
    Object.assign(window, {
      __stores: {
        editor: useEditorStore,
        scene: useSceneStore,
        rig: useRigStore,
        path: usePathStore,
        layout: useLayoutStore,
        project: useProjectStore,
        agent: useAgentStore,
      },
      __generateRacingDroneCameras: generateRacingDroneCameras,
    })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GsRuntimeApp />
    </StrictMode>,
  )
}
