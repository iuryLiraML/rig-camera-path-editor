import type { SamImageVersion } from './models'

let falKey = ''
let samImageVersion: SamImageVersion = '3.1'
let abortSignal: AbortSignal | undefined

export function syncFalSettings(key: string, version: SamImageVersion) {
  falKey = key
  samImageVersion = version
}

export function setFalAbortSignal(signal?: AbortSignal) {
  abortSignal = signal
}

export function readFalAbortSignal(): AbortSignal | undefined {
  return abortSignal
}

export function readFalSettings(): { falKey: string; samImageVersion: SamImageVersion } {
  return { falKey, samImageVersion }
}
