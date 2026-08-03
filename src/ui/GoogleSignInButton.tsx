import { useEffect, useRef, useState } from 'react'

/**
 * Renders Google's official "Sign in with Google" button (Google Identity
 * Services) and hands the resulting ID token to the caller, which sends it to
 * the cloud API as a bearer token (the API verifies it against Google's JWKS).
 *
 * The OAuth client id is public by design and comes from VITE_GOOGLE_CLIENT_ID.
 * When it is not configured the component renders nothing, so the dev-token
 * flow keeps working unchanged.
 */

interface GoogleCredentialResponse {
  credential?: string
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string
        callback: (response: GoogleCredentialResponse) => void
        auto_select?: boolean
        use_fedcm_for_prompt?: boolean
      }) => void
      renderButton: (
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon'
          theme?: 'outline' | 'filled_blue' | 'filled_black'
          size?: 'small' | 'medium' | 'large'
          text?: 'signin_with' | 'signup_with' | 'continue_with'
          shape?: 'rectangular' | 'pill'
          logo_alignment?: 'left' | 'center'
        },
      ) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentityApi
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client'
let loader: Promise<void> | null = null

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  loader ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google sign-in failed to load')))
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in failed to load'))
    document.head.appendChild(script)
  })
  return loader
}

export function GoogleSignInButton({
  onCredential,
}: {
  onCredential: (idToken: string) => void
}) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    void loadGoogleIdentity()
      .then(() => {
        const host = hostRef.current
        const api = window.google?.accounts.id
        if (cancelled || !host || !api) return
        api.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) onCredential(response.credential)
          },
        })
        host.replaceChildren()
        api.renderButton(host, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
        })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Google sign-in unavailable')
        }
      })

    return () => {
      cancelled = true
    }
  }, [clientId, onCredential])

  if (!clientId) return null

  return (
    <div className="flex flex-col gap-1">
      <div ref={hostRef} />
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
