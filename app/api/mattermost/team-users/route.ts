import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { mattermostTeamUsers } from '@/lib/mattermost'

export async function GET(req: Request) {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    const teamId = new URL(req.url).searchParams.get('team_id')
    if (!token || !teamId) throw new Error('missing')
    const users = await mattermostTeamUsers(token, teamId)
    return NextResponse.json({ users })
  } catch {
    return NextResponse.json({ error: 'team_users_failed' }, { status: 400 })
  }
}
