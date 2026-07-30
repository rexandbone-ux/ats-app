import { createClient } from '@supabase/supabase-js'
import { AppError, errorMessage } from '@/lib/errors'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nwknnsbiroppdaraxmxp.supabase.co'
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53a25uc2Jpcm9wcGRhcmF4bXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3MTg4MjQsImV4cCI6MjA1OTI5NDgyNH0.J-BY1LGNBYI86uj2yrrWfBMpUCXpig1U7RgD6s9R2DA'

// Disable the cross-tab navigator LockManager. A zombie/closed tab can hold the
// auth lock forever, which makes every other tab hang on getSession() ("Loading...").
// This no-op lock runs the callback immediately, eliminating the deadlock.
const noLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn()

export const SUPABASE_URL = url
export const SUPABASE_ANON_KEY = key

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: noLock,
  },
})

/**
 * Calls an edge function and throws on failure. Functions signal problems two
 * ways — a transport/HTTP error, or a 200 response carrying `{ error }` — and
 * both were easy to miss at call sites.
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  let data: unknown
  try {
    const res = await supabase.functions.invoke(name, { body })
    if (res.error) throw new AppError(name, res.error.message, { cause: res.error })
    data = res.data
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError(name, errorMessage(e), { cause: e })
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) {
    throw new AppError(name, String((data as { error: unknown }).error))
  }
  return data as T
}
