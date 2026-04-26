import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { mattermostUsersByIds } from '@/lib/mattermost'

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    if (!token) throw new Error('missing')
    const { ids } = (await req.json()) as { ids?: string[] }
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ users: [] })
    }
    const users = await mattermostUsersByIds(token, ids.slice(0, 200))
    return NextResponse.json({ users })
  } catch {
    return NextResponse.json({ error: 'users_failed' }, { status: 400 })
  }
}
