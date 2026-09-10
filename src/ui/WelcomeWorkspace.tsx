import { useCallback, useState } from 'react'
import { isTeamCloudApp } from '../lib/cloud/client'
import { markPublicEntered } from '../lib/publicEntered'
import { goHome } from '../lib/projects'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { GoogleSignInButton } from './GoogleSignInButton'

export function WelcomeWorkspace() {
  const cloudError = useCloudAuthStore((state) => state.error)
  const cloudStatus = useCloudAuthStore((state) => state.status)
  const [error, setError] = useState<string | null>(null)
  const allowSkip = !isTeamCloudApp()

  const onGoogleCredential = useCallback((idToken: string) => {
    void (async () => {
      setError(null)
      await useCloudAuthStore.getState().setAccessToken(idToken)
      const auth = useCloudAuthStore.getState()
      if (auth.status === 'error' || auth.status !== 'signed-in') {
        setError(auth.error ?? 'Google sign-in failed')
        return
      }
      markPublicEntered()
      const { bootProjects } = await import('../lib/projects')
      await bootProjects()
      await goHome()
    })()
  }, [])

  return (
    <main className="flex h-full select-text items-center justify-center bg-[#0f0f11] px-6 text-ink selection:bg-accent/30">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-dim">Rig</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Welcome to Rig</h1>
        <p className="mt-2 text-sm leading-6 text-ink-dim">
          Sign in with Google to open Home. Account is the only door.
        </p>
        <div className="mt-6">
          <GoogleSignInButton
            onCredential={onGoogleCredential}
            text="continue_with"
            fallbackLabel="Continue with Google"
          />
        </div>
        {(error || cloudError) && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error ?? cloudError}
          </p>
        )}
        {cloudStatus === 'checking' ? <p className="mt-4 text-xs text-ink-dim">Signing in…</p> : null}
        <p className="mt-6 text-xs leading-5 text-ink-dim">
          By continuing you agree to the{' '}
          <a
            className="text-ink underline decoration-ink-dim underline-offset-2 hover:decoration-ink"
            href="/legal/terms.html"
            target="_blank"
            rel="noreferrer"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            className="text-ink underline decoration-ink-dim underline-offset-2 hover:decoration-ink"
            href="/legal/privacy.html"
            target="_blank"
            rel="noreferrer"
          >
            Privacy Policy
          </a>
          .
        </p>
        {allowSkip ? (
          <button
            type="button"
            className="mt-6 text-sm text-ink-dim underline decoration-ink-dim underline-offset-2 hover:text-ink"
            onClick={() => {
              markPublicEntered()
              void goHome()
            }}
          >
          Skip
        </button>
      ) : null}
      </div>
    </main>
  )
}
