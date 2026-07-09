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
import { bootProjects } from './lib/projects'

// load (or migrate into) the active project, then start tracking undo history
void bootProjects().then(initHistory)

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
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
