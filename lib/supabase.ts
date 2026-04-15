import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nwknnsbiroppdaraxmxp.supabase.co'
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53a25uc2Jpcm9wcGRhcmF4bXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3MTg4MjQsImV4cCI6MjA1OTI5NDgyNH0.J-BY1LGNBYI86uj2yrrWfBMpUCXpig1U7RgD6s9R2DA'

export const supabase = createClient(url, key)
