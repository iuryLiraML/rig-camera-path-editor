import { useEffect, useState } from 'react'
import { primitiveThumbUrl } from '../lib/primitiveThumb'
import type { PrimitiveKind } from '../lib/primitiveGeometry'

/** Immediate shape so tiles never share a cube placeholder while WebGL thumbs load. */
function Fallback({ kind }: { kind: PrimitiveKind }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-full w-full"
      data-primitive-preview={kind}
      aria-hidden
    >
      {kind === 'box' && (
        <>
          <path d="M32 10 52 20.5v23L32 54 12 43.5v-23Z" fill="#8d8d8d" />
          <path d="M32 10 52 20.5 32 31 12 20.5Z" fill="#d2d2d2" />
          <path d="M32 31 52 20.5v23L32 54Z" fill="#b4b4b4" />
          <path d="M32 31 12 20.5v23L32 54Z" fill="#7a7a7a" />
        </>
      )}
      {kind === 'sphere' && (
        <>
          <defs>
            <radialGradient id="prim-sphere" cx="38%" cy="32%" r="62%">
              <stop offset="0%" stopColor="#e8e8e8" />
              <stop offset="55%" stopColor="#b0b0b0" />
              <stop offset="100%" stopColor="#6e6e6e" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="33" r="18" fill="url(#prim-sphere)" />
        </>
      )}
      {kind === 'cylinder' && (
        <>
          <path d="M16 22v20c0 6.6 7.2 12 16 12s16-5.4 16-12V22" fill="#8f8f8f" />
          <ellipse cx="32" cy="42" rx="16" ry="12" fill="#7a7a7a" />
          <ellipse cx="32" cy="22" rx="16" ry="12" fill="#d0d0d0" />
        </>
      )}
      {kind === 'cone' && (
        <>
          <path d="M32 10 50 44c0 6.2-8 11-18 11s-18-4.8-18-11Z" fill="#9a9a9a" />
          <ellipse cx="32" cy="44" rx="18" ry="11" fill="#747474" />
          <path d="M32 10 50 44c-1 4-9 8-18 8V10Z" fill="#c8c8c8" />
        </>
      )}
      {kind === 'plane' && (
        <>
          <path d="M10 36 32 24l22 12-22 12Z" fill="#b8b8b8" />
          <path d="M10 36v4l22 12V48Z" fill="#6e6e6e" />
          <path d="M54 36v4L32 52V48Z" fill="#8a8a8a" />
        </>
      )}
      {kind === 'torus' && (
        <>
          <ellipse cx="32" cy="34" rx="20" ry="13" fill="#8a8a8a" />
          <ellipse cx="32" cy="31" rx="20" ry="13" fill="#c6c6c6" />
          <ellipse cx="32" cy="31" rx="10" ry="6.5" fill="#1a1a1a" fillOpacity="0.55" />
          <ellipse cx="32" cy="30.2" rx="8.2" ry="5.2" fill="#2a2a2a" fillOpacity="0.35" />
        </>
      )}
    </svg>
  )
}

export function PrimitivePreview({ kind }: { kind: PrimitiveKind }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    setSrc(primitiveThumbUrl(kind))
  }, [kind])

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="relative h-full w-full">
        <Fallback kind={kind} />
        {src && (
          <img
            src={src}
            alt=""
            data-primitive-preview={kind}
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
      </div>
    </div>
  )
}
