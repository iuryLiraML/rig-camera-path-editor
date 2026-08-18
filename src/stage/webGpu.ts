/** WebGPU availability for the GS StageHost gate. */

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.gpu !== 'undefined'
}

export async function requestWebGpuAdapter(): Promise<GPUAdapter | null> {
  if (!isWebGpuAvailable()) return null
  try {
    return (await navigator.gpu.requestAdapter()) ?? null
  } catch {
    return null
  }
}
