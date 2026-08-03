import { useMemo, useState } from 'react'
import {
  approveSubjects,
  buildSubjectProposal,
  updateSubjectProposal,
} from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { useProjectStore } from '../state/useProjectStore'

export function SubjectConfirmationStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const assets = workflow.sceneAssets.assets
  const initialProposal =
    workflow.subjects.proposal ??
    (workflow.sceneAssets.primaryAssetId
      ? buildSubjectProposal(
          workflow,
          assets.find((asset) => asset.id === workflow.sceneAssets.primaryAssetId) ?? assets[0],
        )
      : null)

  const [objectName, setObjectName] = useState(initialProposal?.objectName ?? '')
  const [focusSummary, setFocusSummary] = useState(initialProposal?.focusSummary ?? '')
  const [sceneObjectId, setSceneObjectId] = useState(initialProposal?.sceneObjectId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.sceneObjectId === sceneObjectId) ?? assets[0] ?? null,
    [assets, sceneObjectId],
  )

  const selectAsset = (assetId: string) => {
    const asset = assets.find((entry) => entry.id === assetId)
    if (!asset) return
    const proposal = buildSubjectProposal(workflow, asset)
    setSceneObjectId(proposal.sceneObjectId)
    setObjectName(proposal.objectName)
    setFocusSummary(proposal.focusSummary)
  }

  const approveSubject = async () => {
    if (!sceneObjectId || !objectName.trim() || !focusSummary.trim()) {
      setError('Subject name and focus summary are required.')
      return
    }

    setSaving(true)
    setError(null)
    const previous = useProjectStore.getState().workflow
    const updated = updateSubjectProposal(previous, {
      sceneObjectId,
      objectName,
      focusSummary,
    })
    const approved = approveSubjects(updated)
    useProjectStore.getState().setWorkflow(approved)

    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      setError('Subject confirmation could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-16">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Project setup · Step 6
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
            Confirm subject and focus
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
            The director proposes the hero subject from your imported model. Confirm or edit the
            focus before guidelines and the shot list are generated.
          </p>
        </div>

        <div className="mt-10 space-y-7">
          {assets.length > 1 && (
            <div>
              <label htmlFor="subject-asset" className="block text-sm font-medium text-ink">
                Primary asset
              </label>
              <select
                id="subject-asset"
                value={selectedAsset?.id ?? ''}
                onChange={(event) => selectAsset(event.target.value)}
                className="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              >
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.fileName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="subject-name" className="block text-sm font-medium text-ink">
              Subject name
            </label>
            <input
              id="subject-name"
              value={objectName}
              onChange={(event) => setObjectName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label htmlFor="subject-focus" className="block text-sm font-medium text-ink">
              Focus summary
            </label>
            <p className="mt-1 text-xs leading-5 text-ink-dim">
              This becomes the production subject anchor for guidelines, PRD, and shot planning.
            </p>
            <textarea
              id="subject-focus"
              rows={8}
              value={focusSummary}
              onChange={(event) => setFocusSummary(event.target.value)}
              className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 text-sm leading-6 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          {selectedAsset && (
            <p className="rounded-lg border border-line/80 bg-panel px-3 py-2 text-xs text-ink-dim">
              Linked scene object: <span className="font-mono text-ink">{selectedAsset.sceneObjectId}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-4 border-t border-line pt-6">
            <button
              type="button"
              disabled={saving}
              onClick={() => void approveSubject()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Approve subject and continue'}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
