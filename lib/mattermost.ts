const MATTERMOST_URL = process.env.MATTERMOST_URL || 'http://localhost:8065'

export interface MMUser {
  id: string
  username: string
  email: string
  first_name?: string
  last_name?: string
  nickname?: string
}

export interface MMTeam {
  id: string
  name: string
  display_name: string
}

export interface MMPost {
  id: string
  channel_id: string
  user_id: string
  message: string
  create_at: number
  update_at: number
  root_id?: string
  pending?: boolean
}

export interface MMChannel {
  id: string
  team_id: string
  name: string
  display_name: string
  type: string
}

export async function mattermostLogin(login_id: string, password: string) {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id, password }),
    cache: 'no-store'
  })
  const token = res.headers.get('token')
  const body = await res.json().catch(() => null)
  if (!res.ok || !token) {
    throw new Error(body?.message || 'login_failed')
  }
  return { token, user: body as MMUser }
}

export async function mattermostMe(token: string) {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('unauthorized')
  return (await res.json()) as MMUser
}

export async function mattermostTeams(token: string) {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/users/me/teams`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('teams_failed')
  return (await res.json()) as MMTeam[]
}

export async function mattermostChannels(token: string, teamId: string) {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/users/me/teams/${teamId}/channels`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('channels_failed')
  return (await res.json()) as MMChannel[]
}

export async function mattermostPosts(token: string, channelId: string) {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/channels/${channelId}/posts`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('posts_failed')
  return await res.json()
}

export async function mattermostCreatePost(token: string, channel_id: string, message: string, root_id = '') {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel_id, message, root_id }),
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('post_failed')
  return (await res.json()) as MMPost
}

export async function mattermostUsersByIds(token: string, ids: string[]) {
  if (ids.length === 0) return [] as MMUser[]
  const res = await fetch(`${MATTERMOST_URL}/api/v4/users/ids`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(ids),
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('users_failed')
  return (await res.json()) as MMUser[]
}

export async function mattermostTeamUsers(token: string, teamId: string, page = 0, perPage = 30) {
  const q = new URLSearchParams({
    in_team: teamId,
    page: String(page),
    per_page: String(perPage)
  })
  const res = await fetch(`${MATTERMOST_URL}/api/v4/users?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('team_users_failed')
  return (await res.json()) as MMUser[]
}

export async function mattermostCreateTeam(token: string, name: string, display_name: string) {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/teams`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, display_name, type: 'O' }),
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('team_create_failed')
  return (await res.json()) as MMTeam
}

export async function mattermostCreateChannel(
  token: string,
  team_id: string,
  name: string,
  display_name: string,
  type: 'O' | 'P' = 'O'
) {
  const res = await fetch(`${MATTERMOST_URL}/api/v4/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ team_id, name, display_name, type }),
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('channel_create_failed')
  return (await res.json()) as MMChannel
}
