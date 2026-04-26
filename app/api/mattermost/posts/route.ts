import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { mattermostCreatePost, mattermostPosts } from '@/lib/mattermost'

export async function GET(req: Request) {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    const channelId = new URL(req.url).searchParams.get('channel_id')
    if (!token || !channelId) throw new Error('missing')
    return NextResponse.json(await mattermostPosts(token, channelId))
  } catch {
    return NextResponse.json({ error: 'posts_failed' }, { status: 400 })
  }
}

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    if (!token) throw new Error('missing')
    const { channel_id, message, root_id } = await req.json()
    return NextResponse.json(await mattermostCreatePost(token, channel_id, message, root_id))
  } catch {
    return NextResponse.json({ error: 'post_failed' }, { status: 400 })
  }
}
