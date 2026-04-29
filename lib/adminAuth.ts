import type { Pool } from 'pg'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin, type PlatformRole } from '@/lib/platformRole'

export type AdminSession = { userId: string; platformRole: PlatformRole }

export async function getAdminSession(pool: Pool | null): Promise<AdminSession | null> {
  if (!pool) return null
  const uid = await readSessionUserId()
  if (!uid) return null
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  const role = (rows[0]?.platform_role ?? '') as PlatformRole
  if (!isPlatformAdmin(role)) return null
  return { userId: uid, platformRole: role }
}
