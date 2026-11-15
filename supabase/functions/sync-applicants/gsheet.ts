// Reads a Google Sheet tab. Uses a Google service account (app_secrets.google_service_account, JSON key)
// when present, so the sheet can stay private and just be shared with the service account's email.
// Falls back to the public CSV export link.
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let s = ''; for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function saToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`)))
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${b64url(sig)}` }) })
  const j = await res.json()
  if (!j.access_token) throw new Error('Google service account sign-in failed: ' + (j.error_description || j.error || res.status))
  return j.access_token
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let i = 0; let q = false
  while (i < text.length) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue } q = false; i++; continue } field += c; i++; continue }
    if (c === '"') { q = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}
export async function readSheetRows(admin: any, csvUrl: string): Promise<string[][]> {
  const id = (csvUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1]
  const gid = (csvUrl.match(/[?&#]gid=(\d+)/) || [])[1] || '0'
  const { data: saRow } = await admin.from('app_secrets').select('value').eq('key', 'google_service_account').maybeSingle()
  if (id && saRow?.value) {
    const sa = typeof saRow.value === 'string' ? JSON.parse(saRow.value) : saRow.value
    const tok = await saToken(sa)
    const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${tok}` } })).json()
    if (meta.error) throw new Error(`Sheet not shared with ${sa.client_email} (${meta.error.status}). Share the sheet with that address as Viewer.`)
    const tab = (meta.sheets || []).find((s: any) => String(s.properties.sheetId) === gid) || (meta.sheets || [])[0]
    const vals = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab.properties.title}'`)}?valueRenderOption=FORMATTED_VALUE`, { headers: { Authorization: `Bearer ${tok}` } })).json()
    if (vals.error) throw new Error('Sheets API: ' + vals.error.message)
    return (vals.values || []).map((r: any[]) => r.map(x => String(x ?? '')))
  }
  const res = await fetch(csvUrl, { redirect: 'follow' })
  const body = await res.text()
  if (!res.ok || body.trim().startsWith('<!DOCTYPE') || body.trim().startsWith('<html')) throw new Error(`Source not readable (HTTP ${res.status}). Add a Google service account key in Settings and share the sheet with it, or share the sheet as link Viewer.`)
  return parseCSV(body)
}
