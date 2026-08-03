import { useMemo, useState } from 'react'
import {
  BRIEF_SOURCE_ACCEPT,
  parseBriefFile,
  sha256HexFromBlob,
} from '../lib/brief/parseBrief'
import { idbGet, STORES } from '../lib/idb'
import { uploadCloudAsset } from '../lib/cloud/client'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import {
  completeBriefSource,
  type BriefSourceErrors,
} from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useProjectStore } from '../state/useProjectStore'

export function BriefSourceStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const projectId = useProjectStore((state) => state.projectId)
  const cloudStatus = useCloudAuthStore((state) => state.status)
  const accessToken = useCloudAuthStore((state) => state.accessToken)
  const [fileName, setFileName] = useState(workflow.briefSource.fileName ?? '')
  const [extractedText, setExtractedText] = useState(workflow.briefSource.extractedText)
  const [sha256, setSha256] = useState<string | null>(workflow.briefSource.sha256)
  const [contentType, setContentType] = useState(workflow.briefSource.contentType)
  const [errors, setErrors] = useState<BriefSourceErrors>({})
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  const preview = useMemo(() => {
    const text = extractedText.trim()
    if (!text) return ''
    return text.length > 1_200 ? `${text.slice(0, 1_200)}…` : text
  }, [extractedText])

  const handleFile = async (file: File | null) => {
    if (!file) return
    setParsing(true)
    setParseError(null)
    setErrors({})
    try {
      const parsed = await parseBriefFile(file)
      setUploadFile(file)
      setFileName(parsed.fileName)
      setContentType(parsed.contentType)
      setExtractedText(parsed.extractedText)
      setSha256(parsed.sha256)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Brief could not be parsed')
    } finally {
      setParsing(false)
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

  const continueToInterview = async () => {
    const result = completeBriefSource(workflow, {
      fileName: fileName || null,
      contentType,
      extractedText,
      sha256,
    })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    setSaveError(null)
    const previousWorkflow = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(result.workflow)

    try {
      let cloudAssetId: string | null = workflow.briefSource.cloudAssetId
      if (!cloudAssetId && cloudStatus === 'signed-in' && accessToken && uploadFile) {
        await syncActiveProjectToCloud().catch(() => undefined)
        const record = await idbGet<{ cloudProjectId?: string }>(STORES.projects, projectId)
        const cloudProjectId = record?.cloudProjectId
        if (cloudProjectId) {
          const digest = sha256 ?? (await sha256HexFromBlob(uploadFile))
          cloudAssetId = await uploadCloudAsset(accessToken, cloudProjectId, uploadFile, digest)
        }
      }

      if (cloudAssetId) {
        const withAsset = completeBriefSource(result.workflow, {
          fileName: fileName || null,
          contentType,
          extractedText,
          sha256,
          cloudAssetId,
        })
        if (withAsset.ok) useProjectStore.getState().setWorkflow(withAsset.workflow)
      }

      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previousWorkflow)
      setSaveError('Brief source could not be saved, so the workflow did not advance.')
    }
  }

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-16">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Project setup · Step 2
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Add the client brief</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
              Upload the source brief or paste extracted text. Parsing happens locally in this browser
              before anything is sent to the director interview.
            </p>
          </div>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim">
            Draft
          </span>
        </div>

        <form
          className="mt-10 space-y-7"
          onSubmit={(event) => {
            event.preventDefault()
            void continueToInterview()
          }}
        >
          <div>
            <label htmlFor="brief-file" className="block text-sm font-medium text-ink">
              Brief file
            </label>
            <p className="mt-1 text-xs leading-5 text-ink-dim">
              Supported formats: PDF, DOCX, TXT, Markdown.
            </p>
            <input
              id="brief-file"
              type="file"
              accept={BRIEF_SOURCE_ACCEPT}
              disabled={parsing}
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm text-ink file:mr-4 file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-xs file:font-medium file:text-ink hover:file:bg-panel-3"
            />
            {fileName && (
              <p className="mt-2 text-xs text-ink-dim">
                Parsed from <span className="text-ink">{fileName}</span>
                {sha256 && <span className="ml-2 font-mono text-[10px]">sha256:{sha256.slice(0, 12)}…</span>}
              </p>
            )}
            {parseError && (
              <p role="alert" className="mt-2 text-xs text-red-400">
                {parseError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="brief-text" className="block text-sm font-medium text-ink">
              Extracted brief text
            </label>
            <p className="mt-1 text-xs leading-5 text-ink-dim">
              You can edit the extracted text before the interview starts.
            </p>
            <textarea
              id="brief-text"
              rows={12}
              value={extractedText}
              aria-invalid={Boolean(errors.extractedText)}
              aria-describedby={errors.extractedText ? 'brief-text-error' : undefined}
              onChange={(event) => {
                setExtractedText(event.target.value)
                if (errors.extractedText) setErrors({})
              }}
              className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 text-sm leading-6 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {errors.extractedText && (
              <p id="brief-text-error" role="alert" className="mt-1.5 text-xs text-red-400">
                {errors.extractedText}
              </p>
            )}
            {preview && (
              <p className="mt-2 text-xs text-ink-dim">
                Preview length: {extractedText.trim().length.toLocaleString()} characters
              </p>
            )}
          </div>

          {cloudStatus === 'signed-in' ? (
            <p className="rounded-lg border border-line/80 bg-panel px-3 py-2 text-xs text-ink-dim">
              Cloud account connected. The original brief file will upload privately when this project
              already exists in your cloud workspace.
            </p>
          ) : (
            <p className="rounded-lg border border-line/80 bg-panel px-3 py-2 text-xs text-ink-dim">
              Local-only mode. Connect a cloud account from Projects to sync drafts and upload brief
              files to private storage.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <button
              type="button"
              disabled={saving || parsing}
              onClick={() => void saveDraft()}
              className="rounded-lg border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-panel-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="submit"
              disabled={parsing}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f11]"
            >
              Save and start interview
            </button>
          </div>
          {saveError && (
            <p role="alert" className="text-sm text-red-400">
              {saveError}
            </p>
          )}
        </form>
      </div>
    </main>
  )
}
