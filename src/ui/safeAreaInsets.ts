import { useEffect, useState } from 'react'

export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export const ZERO_SAFE_AREA: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * Read the device safe-area insets (notch, rounded corners, home indicator).
 * `env(safe-area-inset-*)` is only exposed to CSS, so we set them as padding on a
 * throwaway fixed probe and read the resolved pixels back. Non-zero only when the
 * viewport meta carries `viewport-fit=cover` on a device that reserves space; on
 * a desktop browser every edge reads 0, which keeps the existing layout math
 * unchanged.
 */
function readSafeArea(): SafeAreaInsets {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return ZERO_SAFE_AREA
  }
  const probe = document.createElement('div')
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top)',
    'padding-right:env(safe-area-inset-right)',
    'padding-bottom:env(safe-area-inset-bottom)',
    'padding-left:env(safe-area-inset-left)',
  ].join(';')
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const px = (value: string) => {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : 0
  }
  const insets: SafeAreaInsets = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  }
  probe.remove()
  return insets
}

const same = (a: SafeAreaInsets, b: SafeAreaInsets) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left

/** Reactive safe-area insets; re-reads on resize and orientation change. */
export function useSafeAreaInsets(): SafeAreaInsets {
  const [insets, setInsets] = useState<SafeAreaInsets>(() => readSafeArea())
  useEffect(() => {
    const update = () => setInsets((prev) => {
      const next = readSafeArea()
      return same(prev, next) ? prev : next
    })
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])
  return insets
}
