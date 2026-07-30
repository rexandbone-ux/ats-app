import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — set them in .env.local (see .env.example).')

// Disable the cross-tab navigator LockManager. A zombie/closed tab can hold the
// auth lock forever, which makes every other tab hang on getSession() ("Loading...").
// This no-op lock runs the callback immediately, eliminating the deadlock.
const noLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn()

export const SUPABASE_URL = url
export const SUPABASE_ANON_KEY = key
export const FUNCTIONS_URL = `${url.replace(/\/$/, '')}/functions/v1`

/**
 * Escapes a value interpolated into a PostgREST filter string (`or`, `ilike`).
 * Commas, parentheses and quotes would otherwise let a search term inject
 * extra filter conditions; `%` and `*` are ilike wildcards.
 */
export function escapeFilterValue(value: string): string {
  return value.replace(/[,()"'\\%*]/g, ' ').trim()
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: noLock,
  },
})
