import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { mattermostMe } from '@/lib/mattermost'

export async function GET() {
  try {
    const token = (await cookies()).get('MMTOKEN')?.value
    if (!token) throw new Error('missing')
    return NextResponse.json({ user: await mattermostMe(token) })
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
}
