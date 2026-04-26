import { NextResponse } from 'next/server'
import { mattermostLogin } from '@/lib/mattermost'

export async function POST(req: Request) {
  try {
    const { login_id, password } = await req.json()
    const session = await mattermostLogin(login_id, password)
    const res = NextResponse.json({ user: session.user })
    res.cookies.set('MMTOKEN', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    })
    return res
  } catch {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }
}
