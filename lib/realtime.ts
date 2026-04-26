'use client'

export interface ChatPost {
  id: string
  channel_id: string
  user_id: string
  message: string
  create_at: number
  pending?: boolean
}

type Listener = (post: ChatPost) => void

let socket: WebSocket | null = null
const listeners = new Set<Listener>()
let seq = 1
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

async function openSocket() {
  if (typeof window === 'undefined') return
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return
  }

  const res = await fetch('/api/mattermost/ws-token')
  if (!res.ok) return
  const { token, websocket_url } = await res.json()

  socket = new WebSocket(websocket_url)
  socket.onopen = () => {
    socket?.send(
      JSON.stringify({
        seq: seq++,
        action: 'authentication_challenge',
        data: { token }
      })
    )
  }
  socket.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (msg.event === 'posted' && msg.data?.post) {
      const post = JSON.parse(msg.data.post) as ChatPost
      listeners.forEach(fn => fn(post))
    }
  }
  socket.onclose = () => {
    socket = null
    if (listeners.size === 0) return
    clearReconnect()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void openSocket()
    }, 1500)
  }
}

export async function connectMattermost(onPost: Listener) {
  listeners.add(onPost)
  await openSocket()
}

export function disconnectMattermost(onPost: Listener) {
  listeners.delete(onPost)
  if (listeners.size === 0) {
    clearReconnect()
    socket?.close()
    socket = null
  }
}
