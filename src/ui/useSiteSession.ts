import { useEffect, useState } from 'react'
import { fetchSiteSession, type SiteSession } from '../lib/siteSession'

export function useSiteSession() {
  const [session, setSession] = useState<SiteSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void fetchSiteSession().then((value) => {
      if (active) setSession(value)
    }).catch((cause: Error) => {
      if (active) setError(cause.message)
    })
    return () => { active = false }
  }, [])
  return { session, error }
}
