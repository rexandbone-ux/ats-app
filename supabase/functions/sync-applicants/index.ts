import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { readSheetRows } from './gsheet.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NEW_APPLICANT_STAGE = '61881acf-2914-4198-b812-e254fceddb96'

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
function findCol(headers: string[], names: string[]): number {
  const H = headers.map(norm)
  for (const n of names) { const idx = H.indexOf(norm(n)); if (idx !== -1) return idx }
  for (const n of names) { const nn = norm(n); const idx = H.findIndex(h => h.includes(nn) && nn.length >= 4); if (idx !== -1) return idx }
  return -1
}
function splitName(full: string): [string, string] { const p = (full || '').trim().split(/\s+/); if (!p[0]) return ['', '']; if (p.length === 1) return [p[0], '']; return [p[0], p.slice(1).join(' ')] }
function cleanEmail(s: string): string | null { const m = (s || '').match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i); return m ? m[0].toLowerCase() : null }
const phoneKey = (s: string) => { const d = (s || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : '' }
const liKey = (s: string) => ((s || '').toLowerCase().match(/linkedin\.com\/in\/([^/?#\s]+)/) || [])[1]?.replace(/\/$/, '') || ''
const nameKey = (f: string, l: string) => norm(`${f || ''}${l || ''}`)

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const key = url.searchParams.get('key') || req.headers.get('x-sync-secret') || ''
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: secretRow } = await admin.from('app_secrets').select('value').eq('key', 'sync_secret').single()
  if (!secretRow || key !== secretRow.value) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  const { data: djRow } = await admin.from('app_secrets').select('value').eq('key', 'default_job_id').single()
  const DEFAULT_JOB = djRow?.value || null
  const dryRun = url.searchParams.get('dry_run') === '1'

  const onlySource = url.searchParams.get('source_id')
  let q = admin.from('sync_sources').select('*').eq('active', true)
  if (onlySource) q = q.eq('id', onlySource)
  const { data: sources, error: srcErr } = await q
  if (srcErr) return new Response(JSON.stringify({ error: srcErr.message }), { status: 500 })

  // Everything we already have, keyed four ways, so a re-import never creates a second record.
  const emails = new Set<string>(), phones = new Set<string>(), lis = new Set<string>(), names = new Set<string>()
  let from = 0
  while (true) {
    const { data, error } = await admin.from('candidates').select('email,alternate_email,phone,linkedin_url,first_name,last_name').range(from, from + 999)
    if (error || !data || data.length === 0) break
    for (const r of data as any[]) {
      if (r.email) emails.add(String(r.email).toLowerCase().trim())
      if (r.alternate_email) emails.add(String(r.alternate_email).toLowerCase().trim())
      const p = phoneKey(r.phone); if (p) phones.add(p)
      const l = liKey(r.linkedin_url); if (l) lis.add(l)
      const n = nameKey(r.first_name, r.last_name); if (n) names.add(n)
    }
    if (data.length < 1000) break
    from += 1000
  }

  const summary: any[] = []
  for (const src of (sources || [])) {
    const run: any = { source_id: src.id, source_label: src.label, inserted_count: 0, skipped_count: 0, error_count: 0, status: 'running', message: '' }
    const { data: runRow } = dryRun ? { data: null } : await admin.from('sync_runs').insert(run).select('id').single()
    const runId = (runRow as any)?.id
    try {
      const rows = await readSheetRows(admin, src.csv_url)
      if (rows.length < 2) throw new Error('No data rows found')
      const headers = rows[0]
      const cFull = findCol(headers, ['full name', 'name', 'candidate name', 'applicant name', 'applicant'])
      const cFirst = findCol(headers, ['first name', 'firstname', 'given name'])
      const cLast = findCol(headers, ['last name', 'lastname', 'surname', 'family name'])
      const cEmail = findCol(headers, ['email', 'email address', 'e-mail'])
      const cPhone = findCol(headers, ['phone', 'phone number', 'mobile', 'contact number', 'cell'])
      const cTitle = findCol(headers, ['title', 'current title', 'position', 'role', 'applied for', 'job title'])
      const cCity = findCol(headers, ['city', 'location'])
      const cState = findCol(headers, ['state', 'province', 'region'])
      const cLinkedin = findCol(headers, ['linkedin', 'linkedin url'])
      const cResume = findCol(headers, ['resume', 'resume url', 'cv'])
      const cVideo = findCol(headers, ['video', 'video url', 'intro video'])
      const cWhatsapp = findCol(headers, ['whatsapp', 'whats app', 'wa number'])
      const toInsert: any[] = []
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row || row.every(x => !x || !String(x).trim())) continue
        const get = (i: number) => (i >= 0 && i < row.length ? String(row[i] || '').trim() : '')
        const email = cleanEmail(get(cEmail))
        let first = get(cFirst), last = get(cLast)
        if (!first && !last && cFull >= 0) { const [f, l] = splitName(get(cFull)); first = f; last = l }
        const phone = get(cPhone) || get(cWhatsapp)
        if (!email && !first && !last && !phone) continue
        const pk = phoneKey(phone), lk = liKey(get(cLinkedin)), nk = nameKey(first, last)
        // Duplicate if any strong key matches; a row with only a name is a duplicate if that name exists.
        const dup = (email && emails.has(email)) || (pk && phones.has(pk)) || (lk && lis.has(lk)) || (!email && !pk && !lk && nk && names.has(nk))
        if (dup) { run.skipped_count++; continue }
        if (email) emails.add(email); if (pk) phones.add(pk); if (lk) lis.add(lk); if (nk) names.add(nk)
        toInsert.push({ first_name: first || null, last_name: last || null, email, phone: phone || null, whatsapp: get(cWhatsapp) || null, current_title: get(cTitle) || null, city: get(cCity) || null, state: get(cState) || null, linkedin_url: get(cLinkedin) || null, resume_url: get(cResume) || null, video_url: get(cVideo) || null, source: src.source_tag, source_detail: src.label, status: 'new' })
      }
      if (dryRun) { summary.push({ source: src.label, would_insert: toInsert.length, skipped: run.skipped_count }); continue }
      const insertedIds: string[] = []
      for (let b = 0; b < toInsert.length; b += 100) {
        const chunk = toInsert.slice(b, b + 100)
        const { data: ins, error: insErr } = await admin.from('candidates').insert(chunk).select('id')
        if (insErr) { run.error_count += chunk.length; run.message += insErr.message + '; '; continue }
        for (const x of ins || []) insertedIds.push(x.id)
        run.inserted_count += (ins?.length || 0)
      }
      const jobId = src.default_job_id || DEFAULT_JOB
      if (insertedIds.length && jobId) {
        const apps = insertedIds.map(cid => ({ candidate_id: cid, job_id: jobId, stage_id: NEW_APPLICANT_STAGE, status: 'active', source: src.source_tag, applied_via: src.label }))
        for (let b = 0; b < apps.length; b += 100) await admin.from('applications').insert(apps.slice(b, b + 100))
      }
      run.status = 'success'
      run.message = (run.message || '') + `Imported ${run.inserted_count} new, skipped ${run.skipped_count} existing.`
      await admin.from('sync_sources').update({ last_synced_at: new Date().toISOString(), last_status: run.status, total_imported: (src.total_imported || 0) + run.inserted_count }).eq('id', src.id)
    } catch (e: any) {
      run.status = 'error'; run.error_count++; run.message = String(e?.message || e)
      if (!dryRun) await admin.from('sync_sources').update({ last_synced_at: new Date().toISOString(), last_status: 'error' }).eq('id', src.id)
    }
    if (runId) await admin.from('sync_runs').update({ finished_at: new Date().toISOString(), inserted_count: run.inserted_count, skipped_count: run.skipped_count, error_count: run.error_count, status: run.status, message: run.message }).eq('id', runId)
    summary.push({ source: src.label, status: run.status, inserted: run.inserted_count, skipped: run.skipped_count, message: run.message })
  }
  return new Response(JSON.stringify({ ok: true, ran_at: new Date().toISOString(), sources: summary }, null, 2), { headers: { 'Content-Type': 'application/json' } })
})
