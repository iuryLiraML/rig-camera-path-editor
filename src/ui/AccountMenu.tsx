import { useEffect, useRef, useState } from 'react'
import { beginSignOut } from '../lib/projects'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import {
  CHROME_MENU,
  CHROME_MENU_ITEM,
  CHROME_MENU_ITEM_DANGER,
  CHROME_MENU_SEP,
} from './chromeMenu'
import { PersonIcon } from './icons'
import { useSiteSession } from './useSiteSession'
import { navigateToSiteAuth } from '../lib/siteSession'

function initials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || ''
  if (!source) return ''
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function AccountMenu() {
  const status = useCloudAuthStore((s) => s.status)
  const session = useCloudAuthStore((s) => s.session)
  const site = useSiteSession()
  const cloudSignedIn = status === 'signed-in' && Boolean(session)
  const signedIn = cloudSignedIn || Boolean(site.session?.email)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const displayName = session?.name || session?.email || session?.userId || site.session?.email || 'Account'
  const letters = initials(session?.name, session?.email ?? site.session?.email)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const openSettings = () => {
    setOpen(false)
    useEditorStore.getState().setShowSettings(true)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        title="Account"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full ${
          open ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        {session?.picture ? (
          <img
            src={session.picture}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : signedIn && letters ? (
          <span className="text-[10px] font-medium text-ink">{letters}</span>
        ) : (
          <PersonIcon size={14} />
        )}
      </button>
      {open && (
        <div className={`${CHROME_MENU} absolute right-0 top-full mt-1.5`} role="menu">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel-2 text-ink-dim">
              {session?.picture ? (
                <img
                  src={session.picture}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : signedIn && letters ? (
                <span className="text-[11px] font-medium text-ink">{letters}</span>
              ) : (
                <PersonIcon size={16} />
              )}
            </div>
            <div className="min-w-0">
              {signedIn ? (
                <>
                  <div className="truncate text-[12px] font-medium text-ink">{displayName}</div>
                  {session?.email && session.email !== displayName ? (
                    <div className="truncate text-[10px] text-ink-dim">{session.email}</div>
                  ) : null}
                </>
              ) : (
                <div className="text-[12px] text-ink-dim">Not signed in</div>
              )}
            </div>
          </div>
          <div className={CHROME_MENU_SEP} />
          <button type="button" role="menuitem" className={CHROME_MENU_ITEM} onClick={openSettings}>
            Settings
          </button>
          {signedIn ? (
            <button
              type="button"
              role="menuitem"
              className={CHROME_MENU_ITEM_DANGER}
              onClick={() => {
                setOpen(false)
                if (cloudSignedIn) void beginSignOut()
                else void navigateToSiteAuth('logout')
                  .catch(() => useEditorStore.getState().setShowSettings(true))
              }}
            >
              Sign out
            </button>
          ) : (
            <button type="button" role="menuitem" className={CHROME_MENU_ITEM} onClick={() => {
              if (!site.session?.loginConfigured) { openSettings(); return }
              void navigateToSiteAuth('login')
                .catch(() => useEditorStore.getState().setShowSettings(true))
            }}>
              Sign in
            </button>
          )}
        </div>
      )}
    </div>
  )
}
