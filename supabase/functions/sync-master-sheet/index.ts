import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { readSheetRows } from "./gsheet.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Content-Type': 'application/json',
}
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: cors })

/* ---------------- CSV + text helpers ---------------- */
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += ch
    } else {
      if (ch === '"') q = true
      else if (ch === ',') { row.push(cur); cur = '' }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else if (ch === '\r') { /* skip */ }
      else cur += ch
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const T = (s: string | undefined) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim())

function findCol(headers: string[], names: string[]): number {
  const h = headers.map(norm)
  for (const n of names) {
    const k = norm(n)
    const i = h.indexOf(k)
    if (i >= 0) return i
  }
  for (const n of names) {
    const k = norm(n)
    if (k.length < 4) continue
    for (let i = 0; i < h.length; i++) if (h[i] && h[i].includes(k)) return i
  }
  return -1
}
function splitName(full: string): [string, string] {
  const p = T(full).replace(/\t/g, ' ').split(' ').filter(Boolean)
  if (!p.length) return ['', '']
  if (p.length === 1) return [p[0], '']
  return [p.slice(0, -1).join(' '), p[p.length - 1]]
}
function cleanEmail(s: string): string | null {
  const m = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.exec(s || '')
  return m ? m[0].toLowerCase() : null
}
function cleanUrl(s: string): string | null {
  const v = T(s)
  if (!v) return null
  const m = /https?:\/\/[^\s,]+/i.exec(v)
  return m ? m[0] : null
}
function toInt(s: string): number | null {
  const v = T(s)
  if (!v) return null
  const m = /-?\d+(\.\d+)?/.exec(v.replace(/,/g, ''))
  if (!m) return null
  const n = Math.round(Number(m[0]))
  return Number.isFinite(n) ? n : null
}
function toNum(s: string): number | null {
  const v = T(s)
  if (!v) return null
  const m = /-?\d+(\.\d+)?/.exec(v.replace(/,/g, ''))
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}
function parseRate(s: string): { min: number; max: number; period: string } | null {
  const t = T(s).toLowerCase().replace(/,/g, '')
  if (!t) return null
  const k = /(\d+(?:\.\d+)?)\s*k/.exec(t)
  if (k) { const v = Number(k[1]) * 1000; return { min: v, max: v, period: 'year' } }
  const nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n) && n > 0)
  if (!nums.length) return null
  const min = Math.min(...nums), max = Math.max(...nums)
  return { min, max, period: max >= 1000 ? 'year' : 'hour' }
}

/* ---------------- status vocab -> enums ---------------- */
const CAND_STATUS: Record<string, string> = {
  rejected: 'rejected', rejectedbyadam: 'rejected', rejectedbytheclient: 'rejected',
  notqualified: 'rejected', terminated: 'rejected', disqualified: 'rejected',
  blacklisted: 'blacklisted',
  shortlisted: 'screening', forreview: 'screening', maybe: 'screening', reprofile: 'screening',
  testtask: 'screening', testtaskcompleted: 'screening', forassessment: 'screening',
  forinitialinterview: 'interviewing', clientcall: 'interviewing', forclientcall: 'interviewing',
  for2ndinterview: 'interviewing', for2ndinterviewwithadam: 'interviewing',
  donewithadam: 'interviewing', for3rdinterview: 'interviewing', pending: 'new',
  forpooling: 'on_bench', pooling: 'on_bench', pooled: 'on_bench',
  hired: 'placed', placed: 'placed', goodtohire: 'offered',
  withdrew: 'withdrawn', withdrawn: 'withdrawn', candidatewithrawn: 'withdrawn',
  candidatewithdrawn: 'withdrawn', noshow: 'withdrawn', declined: 'withdrawn',
}
const mapCandStatus = (s: string) => CAND_STATUS[norm(s)] || null

const CLIENT_STATUS: Record<string, string> = { '': 'active', onhold: 'on_hold', hold: 'on_hold', closed: 'churned', churned: 'churned', prospect: 'prospect', active: 'active' }
const JOB_STATUS: Record<string, string> = { '': 'open', onhold: 'on_hold', hold: 'on_hold', closed: 'closed', filled: 'filled', open: 'open', draft: 'draft' }

/* ---------------- concurrency pool ---------------- */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { await fn(items[idx]) } catch (_e) { /* counted by caller */ }
    }
  })
  await Promise.all(workers)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const started = new Date().toISOString()
  try {
    const url = new URL(req.url)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    /* auth: shared sync secret, same gate as sync-applicants */
    const key = url.searchParams.get('key') || req.headers.get('x-sync-secret') || ''
    const { data: secretRow } = await admin.from('app_secrets').select('value').eq('key', 'sync_secret').single()
    if (!secretRow || key !== secretRow.value) return ok({ error: 'unauthorized' })

    const dry = url.searchParams.get('dry') === '1'
    const onlyTab = url.searchParams.get('tab') || ''

    /* ---- config ---- */
    const tq = admin.from('sheet_sync_tabs').select('*').eq('active', true).order('sort_order')
    const { data: tabs, error: tabsErr } = await tq
    if (tabsErr) return ok({ error: 'config read failed: ' + tabsErr.message })
    const useTabs = (tabs || []).filter((t: any) => !onlyTab || norm(t.label) === norm(onlyTab))
    if (!useTabs.length) return ok({ error: 'no active tabs configured' })

    /* ---- reference data ---- */
    async function fetchAll(table: string, cols: string) {
      const out: any[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from(table).select(cols).range(from, from + 999)
        if (error) throw new Error(`${table}: ${error.message}`)
        out.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      return out
    }

    const candidates = await fetchAll('candidates', 'id,first_name,last_name,email,status')
    const stages = await fetchAll('pipeline_stages', 'id,name,sort_order')
    const profiles = await fetchAll('profiles', 'id,first_name,email,role')
    const clients = await fetchAll('clients', 'id,company_name,status,billing_email,notes,custom_fields')
    const jobs = await fetchAll('jobs', 'id,title,client_id,status,salary_min,salary_max,salary_period,custom_fields')
    const applications = await fetchAll('applications', 'id,candidate_id,job_id,stage_id')

    const byEmail = new Map<string, string>()
    const byName = new Map<string, string[]>()
    for (const c of candidates) {
      const e = (c.email || '').toLowerCase().trim()
      if (e && !byEmail.has(e)) byEmail.set(e, c.id)
      const n = norm(`${c.first_name || ''}${c.last_name || ''}`)
      if (n) { const a = byName.get(n) || []; a.push(c.id); byName.set(n, a) }
    }
    const stageOrder = new Map<string, number>(stages.map((s: any) => [s.id, s.sort_order ?? 0]))
    const appsByCand = new Map<string, any[]>()
    for (const a of applications) { const l = appsByCand.get(a.candidate_id) || []; l.push(a); appsByCand.set(a.candidate_id, l) }
    const recruiterByName = new Map<string, string>()
    for (const p of profiles) {
      const n = norm(p.first_name || (p.email || '').split('@')[0])
      if (n) recruiterByName.set(n, p.id)
    }
    const clientByName = new Map<string, any>(clients.map((c: any) => [norm(c.company_name), c]))
    /* client_aliases maps alternate sheet spellings onto the canonical client row
       so the daily sync does not recreate near-duplicates (e.g. CALMED -> cal med medical) */
    const aliases = await fetchAll('client_aliases', 'alias,client_id')
    const clientById = new Map<string, any>(clients.map((c: any) => [c.id, c]))
    for (const a of aliases) {
      const target = clientById.get(a.client_id)
      const k = norm(a.alias)
      if (target && k && !clientByName.has(k)) clientByName.set(k, target)
    }
    const jobKey = (clientId: string | null, title: string) => `${clientId || 'none'}|${norm(title)}`
    const jobByKey = new Map<string, any>(jobs.map((j: any) => [jobKey(j.client_id, j.title), j]))
    const jobByTitle = new Map<string, any[]>()
    for (const j of jobs) { const k = norm(j.title); const a = jobByTitle.get(k) || []; a.push(j); jobByTitle.set(k, a) }

    const resolveCandidate = (email: string | null, name: string): { id: string | null; why: string } => {
      if (email && byEmail.has(email)) return { id: byEmail.get(email)!, why: 'email' }
      const n = norm(name)
      if (!n) return { id: null, why: 'noname' }
      const hits = byName.get(n) || []
      if (hits.length === 1) return { id: hits[0], why: 'name' }
      if (hits.length > 1) return { id: null, why: 'ambiguous' }
      return { id: null, why: 'nomatch' }
    }

    /* ---- per-tab work ---- */
    const results: any[] = []

    for (const tab of useTabs) {
      const t0 = Date.now()
      const res: any = { tab: tab.label, kind: tab.kind, rows: 0, updated: 0, inserted: 0, skipped: 0, errors: 0, notes: [] as string[] }
      try {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${tab.sheet_id}/export?format=csv&gid=${tab.gid}`
        const grid = await readSheetRows(admin, csvUrl)
        const hIdx = Math.max(0, (tab.header_row || 1) - 1)
        const headers = (grid[hIdx] || []).map((h) => T(h))
        const rows = grid.slice(hIdx + 1).filter((rw) => rw.some((c) => T(c) !== ''))
        res.rows = rows.length

        /* ============ CLIENTS TAB ============ */
        if (tab.kind === 'clients') {
          const cName = findCol(headers, ['Clients', 'Client'])
          const cEmail = findCol(headers, ['Email'])
          const cStatus = findCol(headers, ['Status'])
          const cPos = findCol(headers, ['Position'])
          const cRate = findCol(headers, ['Rate'])
          const cFor = findCol(headers, ['for who'])
          if (cName < 0) throw new Error('Clients tab: no "Clients" column found')

          // forward-fill the client name down the rows, then aggregate a client-level status
          let lastName = ''
          const filled: { company: string; rw: string[] }[] = []
          for (const rw of rows) {
            const raw = T(rw[cName])
            if (raw) lastName = raw
            if (lastName) filled.push({ company: lastName, rw })
            else res.skipped++
          }
          const rank: Record<string, number> = { active: 3, on_hold: 2, prospect: 1, churned: 0 }
          const bestStatus = new Map<string, string>()
          for (const f of filled) {
            const s = CLIENT_STATUS[norm(cStatus >= 0 ? T(f.rw[cStatus]) : '')] || 'active'
            const k = norm(f.company)
            if (!bestStatus.has(k) || rank[s] > rank[bestStatus.get(k)!]) bestStatus.set(k, s)
          }

          const seenJobIds = new Set<string>()
          for (const f of filled) {
            const company = f.company
            const rw = f.rw
            const email = cEmail >= 0 ? cleanEmail(rw[cEmail]) : null
            const sRaw = cStatus >= 0 ? T(rw[cStatus]) : ''
            const cStat = bestStatus.get(norm(company)) || 'active'
            const jStat = JOB_STATUS[norm(sRaw)] || 'open'
            const position = cPos >= 0 ? T(rw[cPos]) : ''
            const rate = cRate >= 0 ? T(rw[cRate]) : ''
            const forWho = cFor >= 0 ? T(rw[cFor]) : ''

            /* client upsert */
            let client = clientByName.get(norm(company))
            if (!client) {
              if (dry) { res.inserted++; client = { id: null, company_name: company } }
              else {
                const { data, error } = await admin.from('clients')
                  .insert({ company_name: company, status: cStat, billing_email: email, notes: forWho || null })
                  .select('id,company_name,status,billing_email,notes,custom_fields').single()
                if (error) { res.errors++; res.notes.push(`client insert ${company}: ${error.message}`); continue }
                client = data; res.inserted++
              }
              if (client) clientByName.set(norm(company), client)
            } else if (!dry) {
              const patch: any = {}
              if (client.status !== cStat) patch.status = cStat
              if (email && !client.billing_email) patch.billing_email = email
              if (forWho && !T(client.notes)) patch.notes = forWho
              if (Object.keys(patch).length) {
                const { error } = await admin.from('clients').update(patch).eq('id', client.id)
                if (error) { res.errors++; res.notes.push(`client update ${company}: ${error.message}`) }
                else { Object.assign(client, patch); res.updated++ }
              }
            }
            if (!position || !client?.id) continue

            /* job upsert under this client */
            const rr = parseRate(rate)
            const sheetExtra: any = {}
            headers.forEach((h, i) => { const v = T(rw[i]); if (v && /candidate|resume|loom|rec/i.test(h)) sheetExtra[h] = v })
            const k = jobKey(client.id, position)
            let job = jobByKey.get(k)
            if (job?.id) seenJobIds.add(job.id)
            if (!job) {
              // avoid creating a second job for a title that already exists unattached
              const orphan = (jobByTitle.get(norm(position)) || []).find((j: any) => !j.client_id)
              if (orphan && !dry) {
                const patch: any = { client_id: client.id, status: jStat }
                if (rr) { patch.salary_min = rr.min; patch.salary_max = rr.max; patch.salary_period = rr.period; patch.currency = 'USD' }
                const { error } = await admin.from('jobs').update(patch).eq('id', orphan.id)
                if (error) { res.errors++; res.notes.push(`job adopt ${position}: ${error.message}`) }
                else { Object.assign(orphan, patch); jobByKey.set(k, orphan); seenJobIds.add(orphan.id); res.updated++ }
                continue
              }
              if (dry) { res.inserted++; continue }
              const ins: any = {
                title: position, client_id: client.id, status: jStat, currency: 'USD',
                custom_fields: Object.keys(sheetExtra).length ? { sheet: sheetExtra } : null,
                description: `Imported from master sheet (Clients tab). Client: ${company}${forWho ? ` - for ${forWho}` : ''}${rate ? ` - rate ${rate}` : ''}`,
              }
              if (rr) { ins.salary_min = rr.min; ins.salary_max = rr.max; ins.salary_period = rr.period }
              const { data, error } = await admin.from('jobs').insert(ins)
                .select('id,title,client_id,status,salary_min,salary_max,salary_period,custom_fields').single()
              if (error) { res.errors++; res.notes.push(`job insert ${position}: ${error.message}`); continue }
              job = data; jobByKey.set(k, job)
              seenJobIds.add(job.id)
              const a = jobByTitle.get(norm(position)) || []; a.push(job); jobByTitle.set(norm(position), a)
              res.inserted++
            } else if (!dry) {
              const patch: any = {}
              if (job.status !== jStat) patch.status = jStat
              if (rr && (Number(job.salary_min) !== rr.min || Number(job.salary_max) !== rr.max)) {
                patch.salary_min = rr.min; patch.salary_max = rr.max; patch.salary_period = rr.period
              }
              if (Object.keys(sheetExtra).length) {
                const merged = { ...(job.custom_fields || {}), sheet: { ...((job.custom_fields || {}).sheet || {}), ...sheetExtra } }
                if (JSON.stringify(merged) !== JSON.stringify(job.custom_fields || {})) patch.custom_fields = merged
              }
              if (Object.keys(patch).length) {
                const { error } = await admin.from('jobs').update(patch).eq('id', job.id)
                if (error) { res.errors++; res.notes.push(`job update ${position}: ${error.message}`) }
                else { Object.assign(job, patch); res.updated++ }
              }
            }
          }
          /* reconcile: the Clients tab is the source of truth for what is open.
             Any job still 'open' that was not listed on the tab goes on_hold (never deleted, never closed),
             except the catch-all 'General Applicant Pool'. Only runs on a clean, non-empty read. */
          if (!dry && res.errors === 0 && filled.length > 0) {
            const stale = jobs.filter((j: any) => j.status === 'open' && !seenJobIds.has(j.id) && norm(j.title) !== 'generalapplicantpool')
            let held = 0
            for (const j of stale) {
              const cf = { ...(j.custom_fields || {}), sheet_reconciled: { at: new Date().toISOString(), reason: 'not on Clients tab', previous_status: 'open' } }
              const { error } = await admin.from('jobs').update({ status: 'on_hold', custom_fields: cf }).eq('id', j.id)
              if (error) { res.errors++; res.notes.push(`job hold ${j.title}: ${error.message}`) }
              else { j.status = 'on_hold'; held++ }
            }
            res.held = held
            if (held) res.notes.push(`${held} open job(s) not on Clients tab -> on_hold`)
          }
        }

        /* ============ CANDIDATE-BEARING TABS ============ */
        else {
          const kind = tab.kind // applicants | stage | apollo
          const cName = findCol(headers, ["Applicant's Name", 'NAME', 'Name', 'Full Name'])
          const cEmail = findCol(headers, ['Email Address', 'EMAIL', 'Email'])
          const cStatus = findCol(headers, ['Status'])
          const cPos = findCol(headers, ['Position', 'POSITION'])
          const cNotes = findCol(headers, kind === 'stage'
            ? ['Adams notes', 'Notes what you like', 'Notes', "ADAM'S ASSESMENT", 'ADAM’S ASSESMENT']
            : ['Notes'])
          const cResume = findCol(headers, ['Resume Link', 'RESUME', 'Resume'])
          const cPortfolio = findCol(headers, ['Portfolio', 'LINK: Portfolio'])
          const cVoice = findCol(headers, ['Voice or Video Recording', 'Voice Recording', 'RECORDING LINK', 'Recording'])
          const cLoom = findCol(headers, ['1ST INTERVIEW RECORDING', 'Loom Rec 1'])
          const cRate = findCol(headers, ['What is the minimum hourly rate you would accept?', 'put lowest rate they will take', 'Rate', 'RATE'])
          const cEng = findCol(headers, ['English Rate', 'ENGLISH RATE', 'English'])
          const cAdam = findCol(headers, ["Adam's Rate", 'Adam rating'])
          const cRecRating = findCol(headers, ['Recruiters Rating'])
          const cWhats = findCol(headers, ['WhatsApp Number', 'WhatsApp'])
          const cPhone = kind === 'apollo' ? findCol(headers, ['NUMBER', 'Phone']) : -1
          const cRecruiter = findCol(headers, ['Recruiter', 'RECRUITER'])
          const cHands = findCol(headers, ['Do you have hands-on experience relevant to the role you are applying for?', 'hands-on experience'])
          const cInterviewNotes = findCol(headers, ['Interview Notes'])
          const cPooling = findCol(headers, ['Pooling'])
          const cOutreach = findCol(headers, ['pilots4'])
          const cContact2 = findCol(headers, ['2nd Contact'])
          const cLocation = findCol(headers, ['Location'])
          const cDate = findCol(headers, ['Date'])
          const cTime = findCol(headers, ['Time'])
          if (cName < 0) throw new Error(`${tab.label}: no name column found in [${headers.slice(0, 20).join(' | ')}]`)

          // forward-fill group columns - only for tabs that use merged/grouped rows (3rd Interview)
          const ffCols = tab.forward_fill
            ? [cStatus, cPos, cDate, findCol(headers, ['Client'])].filter((i) => i >= 0)
            : []
          const carried: Record<number, string> = {}

          type Job = { candId: string; patch: any; stageJobTitle: string; status: string | null }
          const work: Job[] = []
          type NewCand = { email: string; name: string; patch: any; position: string }
          const inserts: NewCand[] = []
          const queuedEmails = new Set<string>()

          for (const rw of rows) {
            for (const ci of ffCols) { const v = T(rw[ci]); if (v) carried[ci] = v; }
            const nameRaw = T(rw[cName]).replace(/\t/g, ' ')
            const email = cEmail >= 0 ? cleanEmail(rw[cEmail] || '') : null
            if (!nameRaw && !email) { res.skipped++; continue }
            const m = resolveCandidate(email, nameRaw)
            let isNew = false
            if (!m.id) {
              // insert brand-new people only when the tab allows it AND we have an email
              // (email is the dedupe key - never insert a name-only row)
              const canInsert = tab.insert_missing && !!email && !!nameRaw && m.why !== 'ambiguous'
              if (!canInsert) {
                res.skipped++
                if (m.why === 'ambiguous' && res.notes.length < 12) res.notes.push(`ambiguous name: ${nameRaw}`)
                continue
              }
              if (queuedEmails.has(email!)) { res.skipped++; continue }
              isNew = true
            }

            const patch: any = {}
            const set = (k: string, v: any) => { if (v !== null && v !== undefined && v !== '') patch[k] = v }

            const statusRaw = cStatus >= 0 ? (T(rw[cStatus]) || carried[cStatus] || '') : ''
            const mapped = statusRaw ? mapCandStatus(statusRaw) : null
            if (mapped) set('status', mapped)

            if (cResume >= 0) set('resume_url', cleanUrl(rw[cResume]))
            if (cPortfolio >= 0) set('portfolio_url', cleanUrl(rw[cPortfolio]))
            if (cVoice >= 0) set('voice_recording_url', cleanUrl(rw[cVoice]))
            if (cLoom >= 0) set('video_url', cleanUrl(rw[cLoom]))
            if (cRate >= 0) set('min_hourly_rate', T(rw[cRate]))
            if (cEng >= 0) set('english_rate', toInt(rw[cEng]))
            if (cAdam >= 0) set('adam_rating', toNum(rw[cAdam]))
            if (cRecRating >= 0) set('roe_rating', toNum(rw[cRecRating]))
            if (cWhats >= 0) set('whatsapp', T(rw[cWhats]))
            if (cPhone >= 0) set('phone', T(rw[cPhone]))
            if (cHands >= 0) set('hands_on_experience', T(rw[cHands]))
            if (cInterviewNotes >= 0) set('interview_notes', T(rw[cInterviewNotes]))
            if (cPooling >= 0) set('pooling', T(rw[cPooling]))
            if (cNotes >= 0) set('notes', T(rw[cNotes]).slice(0, 4000))
            if (cLocation >= 0) set('state', T(rw[cLocation]))
            if (cRecruiter >= 0) {
              const rid = recruiterByName.get(norm(T(rw[cRecruiter])))
              if (rid) set('owner_id', rid)
            }
            if (kind === 'apollo') {
              if (cOutreach >= 0) set('outreach_status', T(rw[cOutreach]))
              const extra = [cContact2 >= 0 ? T(rw[cContact2]) : '', cNotes >= 0 ? T(rw[cNotes]) : ''].filter(Boolean).join(' | ')
              if (extra) patch.notes = extra.slice(0, 4000)
            }
            if (kind === 'stage' && cDate >= 0) {
              const d = [T(rw[cDate]) || carried[cDate] || '', cTime >= 0 ? T(rw[cTime]) : ''].filter(Boolean).join(' ')
              if (d) set('second_interview', d)
            }
            const posVal = cPos >= 0 ? (T(rw[cPos]) || carried[cPos] || '') : ''
            if (isNew) {
              queuedEmails.add(email!)
              inserts.push({ email: email!, name: nameRaw, patch, position: posVal })
              continue
            }
            if (!Object.keys(patch).length) { res.skipped++; continue }
            work.push({ candId: m.id!, patch, stageJobTitle: posVal, status: mapped })
          }

          if (dry) { res.updated = work.length; res.inserted = inserts.length }
          else {
            /* insert brand-new candidates first so later tabs can match them */
            const insRows = inserts.map((n) => {
              const [fn, ln] = splitName(n.name)
              const row: any = {
                ...n.patch,
                first_name: (fn || n.name).slice(0, 80) || 'Unknown',
                last_name: (ln || '-').slice(0, 80),
                email: n.email,
                source: kind === 'apollo' ? 'apollo' : 'master_sheet',
                source_detail: `sheet:${tab.label}`,
              }
              if (n.position && !row.current_title) row.current_title = n.position.slice(0, 200)
              if (!row.status) row.status = 'new'
              return row
            })
            for (let i = 0; i < insRows.length; i += 100) {
              const chunk = insRows.slice(i, i + 100)
              const { data, error } = await admin.from('candidates').insert(chunk).select('id,email,first_name,last_name')
              if (error) {
                res.errors++
                if (res.notes.length < 12) res.notes.push(`insert chunk ${i}: ${error.message}`)
                continue
              }
              for (const c of data || []) {
                res.inserted++
                if (c.email) byEmail.set(String(c.email).toLowerCase(), c.id)
                const nk = norm(`${c.first_name || ''}${c.last_name || ''}`)
                if (nk) { const a = byName.get(nk) || []; a.push(c.id); byName.set(nk, a) }
              }
            }

            await pool(work, 8, async (w) => {
              const { error } = await admin.from('candidates').update(w.patch).eq('id', w.candId)
              if (error) { res.errors++; if (res.notes.length < 12) res.notes.push(`cand ${w.candId}: ${error.message}`) }
              else res.updated++
            })

            /* stage advancement for stage tabs */
            if (tab.kind === 'stage' && tab.stage_id) {
              const target = stageOrder.get(tab.stage_id) ?? 0
              const moves = work.filter((w) => {
                const apps = appsByCand.get(w.candId) || []
                return apps.some((a) => (stageOrder.get(a.stage_id) ?? -1) < target)
              })
              let advanced = 0
              await pool(moves, 8, async (w) => {
                const apps = (appsByCand.get(w.candId) || []).filter((a) => (stageOrder.get(a.stage_id) ?? -1) < target)
                for (const a of apps) {
                  const { error } = await admin.from('applications').update({ stage_id: tab.stage_id }).eq('id', a.id)
                  if (!error) { a.stage_id = tab.stage_id; advanced++ }
                }
              })
              res.advanced = advanced
            }
          }
        }

        res.status = res.errors ? 'partial' : 'success'
      } catch (e) {
        res.status = 'error'
        res.error = String((e as Error).message || e)
      }
      res.ms = Date.now() - t0
      results.push(res)

      if (!dry) {
        await admin.from('sync_runs').insert({
          source_label: `sheet:${tab.label}`,
          started_at: started,
          finished_at: new Date().toISOString(),
          inserted_count: res.inserted || 0,
          skipped_count: res.skipped || 0,
          error_count: res.errors || 0,
          status: res.status,
          message: (res.error ? res.error + ' ' : '') + `rows=${res.rows} updated=${res.updated}${res.advanced ? ` advanced=${res.advanced}` : ''}${res.held ? ` held=${res.held}` : ''}` + (res.notes?.length ? ` - ${res.notes.slice(0, 4).join('; ')}` : ''),
        })
        await admin.from('sheet_sync_tabs').update({
          last_synced_at: new Date().toISOString(),
          last_status: res.status,
          last_message: (res.error || `rows=${res.rows} updated=${res.updated} inserted=${res.inserted} skipped=${res.skipped}`).slice(0, 500),
          updated_count: res.updated || 0,
          inserted_count: res.inserted || 0,
        }).eq('id', tab.id)
      }
    }

    return ok({
      ok: true, dry, started, finished: new Date().toISOString(),
      totals: {
        updated: results.reduce((a, r) => a + (r.updated || 0), 0),
        inserted: results.reduce((a, r) => a + (r.inserted || 0), 0),
        skipped: results.reduce((a, r) => a + (r.skipped || 0), 0),
        errors: results.reduce((a, r) => a + (r.errors || 0), 0),
      },
      tabs: results,
    })
  } catch (e) {
    return ok({ error: String((e as Error).message || e) })
  }
})
