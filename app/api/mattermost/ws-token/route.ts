import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const token = (await cookies()).get('MMTOKEN')?.value
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({
    token,
    websocket_url: process.env.MATTERMOST_WS_URL || 'ws://localhost:8065/api/v4/websocket'
  })
}
