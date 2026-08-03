import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { App } from './app/App'
import { useEditorStore } from './state/useEditorStore'
import { useSceneStore } from './state/useSceneStore'
import { useRigStore } from './state/useRigStore'
import { usePathStore } from './state/usePathStore'
import { useLayoutStore } from './state/useLayoutStore'
import { useProjectStore } from './state/useProjectStore'
import { useAgentStore } from './state/useAgentStore'
import { initHistory } from './lib/history'
import { generateRacingDroneCameras } from './lib/cameraBatch/generateRacingDroneCameras'
import { bootProjects } from './lib/projects'
import { useCloudAuthStore } from './state/useCloudAuthStore'

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

// load (or migrate into) the active project, then start tracking undo history
void bootProjects()
  .then(() => useCloudAuthStore.getState().bootstrap())
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
