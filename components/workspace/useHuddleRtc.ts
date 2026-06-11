'use client'

/**
 * useHuddleRtc — React binding for the framework-agnostic HuddleRtcClient.
 *
 * Wires the pure mesh client (lib/calls/rtcClient.ts) to real browser effects:
 *   - getUserMedia for the local stream (audio always; video for huddles)
 *   - RTCPeerConnection for each mesh peer
 *   - apiFetch-backed signaling (/api/calls/ice, /api/calls/:roomId/signals)
 *   - /api/auth/me for the local user id
 *   - /api/collab/workspace-members for resolving user_id → display name
 *
 * The hook OWNS the local MediaStream — it stops the tracks on unmount. The
 * client never stops them (see HuddleRtcClient.stop). Find-or-create of the room
 * lives here too: an existing huddle is joined via PUT action=join (so signaling
 * does not 403); a freshly created room is auto-joined server-side (a redundant
 * join is now idempotent via migration 032).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { HuddleRtcClient } from '@/lib/calls/rtcClient'
import type { RoomParticipant } from '@/lib/calls/signaling'
import type { AppUser } from '@/components/chat/ChatMessage'
import { displayName } from '@/components/chat/ChatMessage'

export interface HuddleTile {
  id: string
  name: string
  initials: string
  muted: boolean
  videoOn: boolean
  screenSharing: boolean
  isSelf: boolean
  stream: MediaStream | null
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

interface UseHuddleRtcOptions {
  channelId?: string
  workspaceId?: string
}

export interface UseHuddleRtcResult {
  loading: boolean
  tiles: HuddleTile[]
  localStream: MediaStream | null
  mediaError: string | null
  isMuted: boolean
  isVideoOn: boolean
  isScreenSharing: boolean
  toggleMute: () => Promise<void>
  toggleVideo: () => Promise<void>
  toggleScreenShare: () => Promise<void>
  leave: () => Promise<void>
}

export function useHuddleRtc({ channelId, workspaceId }: UseHuddleRtcOptions): UseHuddleRtcResult {
  const [loading, setLoading] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOn, setIsVideoOn] = useState(true)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream | null>>({})
  const [nameMap, setNameMap] = useState<Record<string, string>>({})
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  const clientRef = useRef<HuddleRtcClient | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null)
  const roomIdRef = useRef<string | null>(null)
  const selfIdRef = useRef<string>('')
  // Monotonic token: only the latest effect run is allowed to assign clientRef /
  // start the loop. Guards against a superseded run (dependency change or React
  // StrictMode double-mount) starting a second client against the same room.
  const initTokenRef = useRef(0)

  // ── Find-or-create room + start the mesh ─────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []
    const token = ++initTokenRef.current
    const isStale = () => cancelled || initTokenRef.current !== token

    void (async () => {
      setLoading(true)
      try {
        // Resolve self id.
        const meRes = await apiFetch('/api/auth/me')
        const me = meRes.ok ? ((await meRes.json()) as { user?: { id?: string } }).user : undefined
        const selfId = me?.id || ''
        selfIdRef.current = selfId

        // Resolve display names (best-effort; falls back to user_id).
        if (workspaceId) {
          try {
            const mRes = await apiFetch(`/api/collab/workspace-members?workspace_id=${encodeURIComponent(workspaceId)}`)
            if (mRes.ok) {
              const data = (await mRes.json()) as { users?: AppUser[] }
              const map: Record<string, string> = {}
              for (const u of data.users ?? []) map[u.id] = displayName(u)
              if (!cancelled) setNameMap(map)
            }
          } catch { /* names are non-critical */ }
        }

        // Find an existing active huddle, else create one (creator auto-joined).
        let roomId: string | null = null
        const listRes = await apiFetch('/api/calls/rooms')
        if (listRes.ok) {
          const data = (await listRes.json()) as { rooms?: Array<{ id: string; call_type: string; status: string; channel_id?: string }> }
          const existing = (data.rooms || []).find(r =>
            r.status === 'active' && r.call_type === 'huddle' && (!channelId || r.channel_id === channelId)
          )
          if (existing) roomId = existing.id
        }

        if (!roomId) {
          const createRes = await apiFetch('/api/calls/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ call_type: 'huddle', channel_id: channelId }),
          })
          if (createRes.ok) {
            const data = (await createRes.json()) as { room?: { id: string; already_exists?: boolean } }
            if (data.room) roomId = data.room.id
          }
        }

        if (!roomId || isStale()) { setLoading(false); return }
        roomIdRef.current = roomId

        // Join the room so signaling does not 403 (idempotent for the creator).
        await apiFetch('/api/calls/rooms', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', room_id: roomId }),
        }).catch(() => {})
        if (isStale()) { setLoading(false); return }

        // Acquire local media. Degrade gracefully on permission denial. Skip the
        // request entirely if this run was already superseded (avoids a second
        // camera prompt / flicker on a fast re-run or StrictMode double-mount).
        let stream: MediaStream | null = null
        if (!isStale()) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
          } catch (err) {
            if (!isStale()) setMediaError(err instanceof Error ? err.message : 'media_unavailable')
          }
        }
        if (isStale()) { stream?.getTracks().forEach(t => t.stop()); setLoading(false); return }
        if (stream) {
          localStreamRef.current = stream
          cameraTrackRef.current = stream.getVideoTracks()[0] ?? null
          setLocalStream(stream)
        }

        // Build + start the mesh client with real browser deps.
        const client = new HuddleRtcClient({
          selfId,
          roomId,
          createPeerConnection: (config) => new RTCPeerConnection(config),
          api: {
            fetchIce: async () => {
              const r = await apiFetch('/api/calls/ice')
              if (!r.ok) return { ice_servers: [] }
              const d = (await r.json()) as { ice_servers?: RTCIceServer[] }
              return { ice_servers: d.ice_servers ?? [] }
            },
            poll: async (after) => {
              const r = await apiFetch(`/api/calls/${roomId}/signals?after=${after}`)
              if (!r.ok) return { signals: [], cursor: after, participants: [] }
              return (await r.json()) as { signals: never[]; cursor: number; participants: RoomParticipant[] }
            },
            send: async (toUser, kind, payload) => {
              await apiFetch(`/api/calls/${roomId}/signals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_user: toUser, kind, payload }),
              })
            },
          },
          callbacks: {
            onRemoteStream: (peerId, s) => {
              if (isStale()) return
              setRemoteStreams(prev => ({ ...prev, [peerId]: s }))
            },
            onParticipants: (parts) => { if (!isStale()) setParticipants(parts) },
          },
        })
        // A superseded run must not assign clientRef or start a competing loop.
        if (isStale()) { void client.stop(); setLoading(false); return }
        clientRef.current = client
        cleanups.push(() => { void client.stop() })
        await client.start(stream)
      } finally {
        if (!isStale()) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      for (const c of cleanups) c()
      // The hook owns the local stream — stop its tracks on unmount.
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
    }
  }, [channelId, workspaceId])

  // ── Controls ─────────────────────────────────────────────────────────────
  const toggleMute = useCallback(async () => {
    const next = !isMuted
    setIsMuted(next)
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
    const roomId = roomIdRef.current
    if (roomId) {
      await apiFetch('/api/calls/rooms', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_mute', room_id: roomId }),
      }).catch(() => {})
    }
  }, [isMuted])

  const toggleVideo = useCallback(async () => {
    const next = !isVideoOn
    setIsVideoOn(next)
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = next })
    const roomId = roomIdRef.current
    if (roomId) {
      await apiFetch('/api/calls/rooms', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_video', room_id: roomId }),
      }).catch(() => {})
    }
  }, [isVideoOn])

  const toggleScreenShare = useCallback(async () => {
    const client = clientRef.current
    const roomId = roomIdRef.current
    if (!client) return
    if (!isScreenSharing) {
      let display: MediaStream
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true })
      } catch { return }
      const screenTrack = display.getVideoTracks()[0]
      if (!screenTrack) return
      await client.replaceVideoTrack(screenTrack)
      setIsScreenSharing(true)
      if (roomId) {
        await apiFetch('/api/calls/rooms', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'toggle_screen_share', room_id: roomId }),
        }).catch(() => {})
      }
      // When the user stops sharing from the browser UI, revert to the camera.
      screenTrack.onended = () => {
        const cam = cameraTrackRef.current
        void client.replaceVideoTrack(cam)
        setIsScreenSharing(false)
        if (roomId) {
          void apiFetch('/api/calls/rooms', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'toggle_screen_share', room_id: roomId }),
          }).catch(() => {})
        }
      }
    } else {
      await client.replaceVideoTrack(cameraTrackRef.current)
      setIsScreenSharing(false)
      if (roomId) {
        await apiFetch('/api/calls/rooms', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'toggle_screen_share', room_id: roomId }),
        }).catch(() => {})
      }
    }
  }, [isScreenSharing])

  const leave = useCallback(async () => {
    const client = clientRef.current
    const roomId = roomIdRef.current
    if (client) await client.stop()
    if (roomId) {
      await apiFetch('/api/calls/rooms', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave', room_id: roomId }),
      }).catch(() => {})
    }
  }, [])

  // ── Derive tiles from poll participants + streams ────────────────────────
  const selfId = selfIdRef.current
  const tiles: HuddleTile[] = participants.map(p => {
    const isSelf = p.user_id === selfId
    const name = isSelf ? 'You' : (nameMap[p.user_id] || p.user_id)
    return {
      id: p.user_id,
      name,
      initials: getInitials(name),
      muted: isSelf ? isMuted : p.muted,
      videoOn: isSelf ? isVideoOn : p.video_on,
      screenSharing: isSelf ? isScreenSharing : p.screen_sharing,
      isSelf,
      stream: isSelf ? localStream : (remoteStreams[p.user_id] ?? null),
    }
  })

  return {
    loading,
    tiles,
    localStream,
    mediaError,
    isMuted,
    isVideoOn,
    isScreenSharing,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    leave,
  }
}
