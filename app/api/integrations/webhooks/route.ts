import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { randomUUID, randomBytes } from 'crypto'

export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspace_id')
  
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })
  }

  try {
    const { rows: webhooks } = await pool.query(
      `SELECT w.*, c.name as channel_name, a.name as app_name
       FROM aaelink.incoming_webhooks w
       JOIN aaelink.channels c ON w.channel_id = c.id
       LEFT JOIN aaelink.apps a ON w.app_id = a.id
       WHERE w.workspace_id = $1
       ORDER BY w.created_at DESC`,
      [workspaceId]
    )
    return NextResponse.json({ webhooks })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { workspace_id, app_id, channel_id, name } = body

    if (!workspace_id || !channel_id || !name) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    const id = randomUUID()
    // Generate a secure secret token for the webhook URL
    const secret_token = randomBytes(24).toString('hex')

    await pool.query(
      `INSERT INTO aaelink.incoming_webhooks 
       (id, workspace_id, app_id, channel_id, name, secret_token, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, workspace_id, app_id || null, channel_id, name, secret_token, userId, Date.now()]
    )

    return NextResponse.json({ success: true, id, secret_token })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
