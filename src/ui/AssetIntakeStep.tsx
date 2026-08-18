import { useState } from 'react'
import { idbGet, STORES } from '../lib/idb'
import { uploadCloudAsset } from '../lib/cloud/client'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import {
  completeAssetIntake,
  registerSceneAsset,
  type AssetIntakeErrors,
} from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { importIntakeSceneAsset, SCENE_ASSET_ACCEPT } from '../lib/sceneAssets'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useProjectStore } from '../state/useProjectStore'

export function AssetIntakeStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const projectId = useProjectStore((state) => state.projectId)
  const cloudStatus = useCloudAuthStore((state) => state.status)
  const accessToken = useCloudAuthStore((state) => state.accessToken)
  const [primaryAssetId, setPrimaryAssetId] = useState(
    workflow.sceneAssets.primaryAssetId ?? workflow.sceneAssets.assets[0]?.id ?? '',
  )
  const [errors, setErrors] = useState<AssetIntakeErrors>({})
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const persistWorkflow = async (next: ReturnType<typeof useProjectStore.getState>['workflow']) => {
    const previous = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(next)
    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      throw new Error('Scene assets could not be saved.')
    }
  }

  const handleImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    setImportError(null)
    setErrors({})

    try {
      let asset = await importIntakeSceneAsset(file)
      if (!asset) {
        // the loader reports failures through a toast that only exists in the
        // editor shell, so surface it here or the click looks like a no-op
        setImportError('Could not read this file — use a self-contained .glb.')
        return
      }

      if (cloudStatus === 'signed-in' && accessToken) {
        await syncActiveProjectToCloud().catch(() => undefined)
        const record = await idbGet<{ cloudProjectId?: string }>(STORES.projects, projectId)
        if (record?.cloudProjectId) {
          const cloudAssetId = await uploadCloudAsset(
            accessToken,
            record.cloudProjectId,
            file,
            asset.sha256,
            asset.contentType,
          )
          asset = { ...asset, cloudAssetId }
        }
      }

      const next = registerSceneAsset(useProjectStore.getState().workflow, asset)
      await persistWorkflow(next)
      setPrimaryAssetId(asset.id)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Model import failed')
    } finally {
      setImporting(false)
    }
  }

  const saveDraft = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await saveActiveProject()
    } catch {
      setSaveError('Draft could not be saved locally.')
    } finally {
      setSaving(false)
    }
  }

  const continueToSubjectConfirmation = async () => {
    const result = completeAssetIntake(useProjectStore.getState().workflow, primaryAssetId)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setSaveError(null)
    try {
      await persistWorkflow(result.workflow)
    } catch {
      setSaveError('Primary asset selection could not be saved.')
    }
  }

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-16">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Project setup · Step 5
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Import scene assets</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
            Upload the hero 3D model before the shot list is generated. The model is parsed locally,
            normalized to the scene floor, and optionally mirrored to private cloud storage.
          </p>
        </div>

        <div className="mt-10 space-y-7">
          <div>
            <label htmlFor="scene-asset-file" className="block text-sm font-medium text-ink">
              3D model
            </label>
            <p className="mt-1 text-xs leading-5 text-ink-dim">Supported formats: GLB and GLTF.</p>
            <input
              id="scene-asset-file"
              type="file"
              accept={SCENE_ASSET_ACCEPT}
              disabled={importing}
              onChange={(event) => void handleImport(event.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm text-ink file:mr-4 file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-xs file:font-medium file:text-ink hover:file:bg-panel-3"
            />
            {importing && (
              <p role="status" className="mt-2 text-xs text-ink-dim">
                Importing and normalising the model…
              </p>
            )}
            {importError && (
              <p role="alert" className="mt-2 text-xs text-red-400">
                {importError}
              </p>
            )}
          </div>

          {workflow.sceneAssets.assets.length > 0 ? (
            <div>
              <h2 className="text-sm font-medium text-ink">Imported assets</h2>
              <ul className="mt-3 space-y-2">
                {workflow.sceneAssets.assets.map((asset) => (
                  <li
                    key={asset.id}
                    className="rounded-lg border border-line bg-panel px-3 py-3 text-sm text-ink"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="primary-asset"
                        checked={primaryAssetId === asset.id}
                        onChange={() => setPrimaryAssetId(asset.id)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">{asset.fileName}</span>
                        <span className="mt-1 block text-xs text-ink-dim">
                          {(asset.byteSize / 1024).toFixed(1)} KB
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {errors.primaryAssetId && (
                <p role="alert" className="mt-2 text-xs text-red-400">
                  {errors.primaryAssetId}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-line/80 bg-panel px-3 py-2 text-xs text-ink-dim">
              No models imported yet. Import a GLB or GLTF to use as the hero subject.
            </p>
          )}
          {errors.assets && (
            <p role="alert" className="text-xs text-red-400">
              {errors.assets}
            </p>
          )}

          {cloudStatus === 'signed-in' ? (
            <p className="rounded-lg border border-line/80 bg-panel px-3 py-2 text-xs text-ink-dim">
              Cloud account connected. Imported models upload privately when the project exists in
              your cloud workspace.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <button
              type="button"
              disabled={saving || importing}
              onClick={() => void saveDraft()}
              className="rounded-lg border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-panel-2 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              disabled={importing || workflow.sceneAssets.assets.length === 0}
              onClick={() => void continueToSubjectConfirmation()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Continue to subject confirmation
            </button>
          </div>
          {saveError && (
            <p role="alert" className="text-sm text-red-400">
              {saveError}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
