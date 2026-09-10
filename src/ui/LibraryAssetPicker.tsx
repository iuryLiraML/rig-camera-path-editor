import { useRef } from 'react'
import { importLibraryAsset } from '../lib/library'

export function useLibraryAssetPicker(label = 'Import assets', collectionId: string | null = null) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept=".ply,.splat,.glb,.gltf,.obj"
      className="hidden"
      aria-label={label}
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void importLibraryAsset(file, collectionId)
      }}
    />
  )
  return { input, open: () => ref.current?.click() }
}
