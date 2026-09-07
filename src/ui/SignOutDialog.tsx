import {
  backupUnsyncedProject,
  discardUnsyncedProject,
  uploadUnsyncedProject,
} from '../lib/projects'
import { useCloudAuthStore } from '../state/useCloudAuthStore'

export function SignOutDialog() {
  const pending = useCloudAuthStore((s) => s.pendingSignOut)
  if (!pending || pending.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="panel w-[min(92vw,420px)] p-5">
        <h2 className="text-sm font-semibold text-ink">Unsynced projects on this machine</h2>
        <p className="mt-2 text-xs leading-5 text-ink-dim">
          Each copy below has not reached the cloud. Choose Upload now, Download JSON, or Discard
          per project. There is no default — signing out still wipes the local cache.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {pending.map((project) => (
            <li key={project.id} className="rounded-lg border border-line bg-panel-2 p-3">
              <div className="text-xs font-medium text-ink">{project.name}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-line bg-panel-3 px-2 py-1 text-[11px] text-ink hover:bg-panel"
                  onClick={() => {
                    void uploadUnsyncedProject(project.id).catch((error) => console.error(error))
                  }}
                >
                  Upload now
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line bg-panel-3 px-2 py-1 text-[11px] text-ink hover:bg-panel"
                  onClick={() => {
                    void backupUnsyncedProject(project.id).catch((error) => console.error(error))
                  }}
                >
                  Download JSON
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line bg-panel-3 px-2 py-1 text-[11px] text-ink hover:bg-panel"
                  onClick={() => {
                    void discardUnsyncedProject(project.id).catch((error) => console.error(error))
                  }}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-4 rounded-lg px-3 py-1.5 text-xs text-ink-dim hover:text-ink"
          onClick={() => useCloudAuthStore.getState().setPendingSignOut(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
