import { create } from 'zustand'
import {
  runLocalCameraBatch,
  type CameraBatchProgress,
} from '../lib/cameraBatch/runLocalBatch'
import type { PlannedShot } from '../lib/projectWorkflow'
import { enqueueCloudCameraBatch } from '../lib/cloud/client'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { useCloudAuthStore } from './useCloudAuthStore'
import { idbGet, STORES } from '../lib/idb'
import { useProjectStore } from './useProjectStore'

interface BatchState {
  progress: CameraBatchProgress | null
  running: boolean
  startLocalBatch: (shots: PlannedShot[]) => Promise<void>
  cancel: () => void
  clear: () => void
}

let abortController: AbortController | null = null

export const useBatchStore = create<BatchState>((set, get) => ({
  progress: null,
  running: false,

  async startLocalBatch(shots) {
    if (get().running) return
    abortController?.abort()
    abortController = new AbortController()
    set({ running: true, progress: null })

    let cloudJobRunId: string | null = null
    const accessToken = useCloudAuthStore.getState().accessToken
    const cloudStatus = useCloudAuthStore.getState().status
    const workflow = useProjectStore.getState().workflow
    const projectId = useProjectStore.getState().projectId
    const credentialId = useCloudAuthStore.getState().credentialIds.anthropic
      ?? useCloudAuthStore.getState().credentialIds.kimi
      ?? null

    if (cloudStatus === 'signed-in' && accessToken && credentialId && workflow.shotList.artifactId) {
      try {
        await syncActiveProjectToCloud()
        const record = await idbGet<{ cloudProjectId?: string }>(STORES.projects, projectId)
        if (record?.cloudProjectId) {
          const reservation = await enqueueCloudCameraBatch(accessToken, {
            projectId: record.cloudProjectId,
            shotListRevisionId: workflow.shotList.artifactId,
            credentialId,
            idempotencyKey: `camera-batch:${record.cloudProjectId}:${workflow.shotList.revision}`,
          })
          cloudJobRunId = reservation.jobRunId
        }
      } catch (error) {
        console.warn('Cloud batch enqueue skipped', error)
      }
    }

    try {
      const progress = await runLocalCameraBatch(shots, {
        signal: abortController.signal,
        cloudJobRunId,
        onProgress: (next) => set({ progress: next }),
      })
      set({ progress, running: false })
    } catch (error) {
      set({
        running: false,
        progress: {
          status: 'failed',
          cloudJobRunId,
          currentIndex: 0,
          total: shots.length,
          shots: [],
          error: error instanceof Error ? error.message : 'Batch failed',
        },
      })
    } finally {
      abortController = null
    }
  },

  cancel() {
    abortController?.abort()
  },

  clear() {
    if (get().running) return
    set({ progress: null })
  },
}))
