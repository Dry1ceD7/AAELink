import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { mattermostChannels, mattermostCreateChannel } from '@/lib/mattermost'
import { slugifyMattermostName } from '@/lib/slug'

export async function GET(req: Request) {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    const teamId = new URL(req.url).searchParams.get('team_id')
    if (!token || !teamId) throw new Error('missing')
    return NextResponse.json({ channels: await mattermostChannels(token, teamId) })
  } catch {
    return NextResponse.json({ error: 'channels_failed' }, { status: 400 })
  }
}

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    if (!token) throw new Error('missing')
    const body = (await req.json()) as { team_id?: string; display_name?: string; name?: string; type?: 'O' | 'P' }
    const team_id = String(body.team_id || '').trim()
    const display_name = String(body.display_name || '').trim()
    if (!team_id || !display_name) {
      return NextResponse.json({ error: 'team_id_and_display_name_required' }, { status: 400 })
    }
    const name = slugifyMattermostName(String(body.name || display_name), 'channel')
    const type = body.type === 'P' ? 'P' : 'O'
    const channel = await mattermostCreateChannel(token, team_id, name, display_name, type)
    return NextResponse.json({ channel })
  } catch {
    return NextResponse.json({ error: 'channel_create_failed' }, { status: 400 })
  }
}
