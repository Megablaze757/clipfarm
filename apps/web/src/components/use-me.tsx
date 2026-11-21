'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useSession } from './use-session'

export interface Me { user_id: string; email: string; tenant_id: string; role: string; plan: { id: string; label: string }; is_admin: boolean; guest: boolean }

/**
 * Who the Worker says you are — including is_admin. Only used to SHOW things
 * (the Admin link); every admin action is checked again on the Worker.
 */
export function useMe(): Me | null {
  const session = useSession()
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => {
    if (!session) { setMe(null); return }
    api.get<Me>('/v1/me').then(setMe).catch(() => setMe(null))
  }, [session])
  return me
}
