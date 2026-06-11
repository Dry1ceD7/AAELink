import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPool } from '../lib/infra/db'

function applyEnvFile(p: string) {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[t.slice(0, i).trim()] = v
  }
}

applyEnvFile(resolve(process.cwd(), '.env'))
applyEnvFile(resolve(process.cwd(), '.env.local'))

;(async () => {
  const p = getPool()
  if (!p) { console.log('NO POOL'); process.exit(1) }
  const r = await p.query('SELECT current_database() AS db, current_user AS u, inet_server_addr() AS host, inet_server_port() AS port;')
  console.log('connected to:', r.rows[0])
  const t = await p.query("SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_name='webhook_deliveries' ORDER BY 1,2,3;")
  console.log('webhook_deliveries columns visible to this connection:')
  console.table(t.rows)
  process.exit(0)
})().catch((e) => { console.error('ERR', e?.message || e); process.exit(2) })
