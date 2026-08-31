import { useEffect, useState } from 'react'
import { primitiveThumbUrl } from '../lib/primitiveThumb'
import type { PrimitiveKind } from '../lib/primitiveGeometry'
import type { FigureSex } from '../lib/dummyCharacter'

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

/** Clay silhouettes so Female / Male do not look like empty primitive slots. */
export function FigurePreview({ sex }: { sex: FigureSex }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-full w-full"
      data-primitive-preview={sex}
      aria-hidden
    >
      {sex === 'female' ? (
        <>
          <ellipse cx="32" cy="14" rx="6.2" ry="6.6" fill="#d4d4d4" />
          <path
            d="M21 26c1.4-4.2 5.4-6.2 11-6.2s9.6 2 11 6.2c1.2 3.6 2.4 10.4 1.2 15.2-.6 2.4-2.6 3.6-5.2 3.6h-14c-2.6 0-4.6-1.2-5.2-3.6-1.2-4.8 0-11.6 1.2-15.2Z"
            fill="#c4c4c4"
          />
          <path d="M24.2 44.2 27 58h3.4l1.6-13.8h.4L33.8 58h3.4l2.8-13.8" fill="#9a9a9a" />
          <path d="M21.4 28.5c-3.2 1-5.8 3.4-6.6 6.2l2.2 1c.6-2 2.4-3.8 4.8-4.6Z" fill="#b0b0b0" />
          <path d="M42.6 28.5c3.2 1 5.8 3.4 6.6 6.2l-2.2 1c-.6-2-2.4-3.8-4.8-4.6Z" fill="#b0b0b0" />
        </>
      ) : (
        <>
          <circle cx="32" cy="14.2" r="6.4" fill="#d2d2d2" />
          <path
            d="M18.8 26.4c1.8-3.8 6.2-5.8 13.2-5.8s11.4 2 13.2 5.8c1.6 3.4 3.2 10.6 1.8 15.4-.7 2.4-2.8 3.6-5.6 3.6H22.6c-2.8 0-4.9-1.2-5.6-3.6-1.4-4.8.2-12 1.8-15.4Z"
            fill="#b8b8b8"
          />
          <path d="M23.6 44.4 25.8 58h3.6l1.8-13.6h1.6L34.6 58h3.6l2.2-13.6" fill="#8e8e8e" />
          <path d="M19.2 28.2c-3.8.8-7 3.4-8 6.4l2.4.8c.7-2.2 3-4 5.8-4.6Z" fill="#a4a4a4" />
          <path d="M44.8 28.2c3.8.8 7 3.4 8 6.4l-2.4.8c-.7-2.2-3-4-5.8-4.6Z" fill="#a4a4a4" />
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
