import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { mattermostCreateTeam, mattermostTeams } from '@/lib/mattermost'
import { slugifyMattermostName } from '@/lib/slug'

export async function GET() {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    if (!token) throw new Error('missing')
    return NextResponse.json({ teams: await mattermostTeams(token) })
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
}

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    if (!token) throw new Error('missing')
    const body = (await req.json()) as { display_name?: string; name?: string }
    const display_name = String(body.display_name || '').trim()
    if (!display_name) return NextResponse.json({ error: 'display_name_required' }, { status: 400 })
    const name = slugifyMattermostName(String(body.name || display_name), 'workspace')
    const team = await mattermostCreateTeam(token, name, display_name)
    return NextResponse.json({ team })
  } catch {
    return NextResponse.json({ error: 'team_create_failed' }, { status: 400 })
  }
}
