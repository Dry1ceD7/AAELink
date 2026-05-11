'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Video, VideoOff, MonitorUp, Circle, Smile, MessageSquare, PhoneOff, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

/* ── Huddle Panel — Real-time audio/video calls ──────────────────── */

interface HuddleParticipant {
  id: string
  name: string
  initials: string
  muted: boolean
  videoOn: boolean
  screenSharing: boolean
  speaking: boolean
}

interface CallRoom {
  id: string
  type: string
  status: string
  participants?: Array<{ user_id: string; username: string; joined_at: number; muted?: boolean; video_on?: boolean }>
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export default function HuddlePanel({ onClose, channelName, channelId }: { onClose: () => void; channelName?: string; channelId?: string }) {
  const [participants, setParticipants] = useState<HuddleParticipant[]>([])
  const [roomId, setRoomId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOn, setIsVideoOn] = useState(true)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [chatMessages, setChatMessages] = useState<{ author: string; text: string; time: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load or create the huddle room
  const init = useCallback(async () => {
    setLoading(true)
    try {
      // Check for existing active rooms
      const res = await apiFetch('/api/calls/rooms')
      if (res.ok) {
        const data = await res.json() as { rooms?: CallRoom[] }
        const activeRoom = (data.rooms || []).find(r =>
          r.status === 'active' && r.type === 'huddle'
        )

        if (activeRoom) {
          setRoomId(activeRoom.id)
          setParticipants(
            (activeRoom.participants || []).map(p => ({
              id: p.user_id,
              name: p.username,
              initials: getInitials(p.username),
              muted: p.muted ?? false,
              videoOn: p.video_on ?? true,
              screenSharing: false,
              speaking: false,
            }))
          )
        } else {
          // Create a new huddle room
          const createRes = await apiFetch('/api/calls/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'huddle',
              channel_id: channelId,
            }),
          })
          if (createRes.ok) {
            const room = await createRes.json() as { room?: CallRoom }
            if (room.room) {
              setRoomId(room.room.id)
              // Start with self as the only participant
              setParticipants([{
                id: 'self',
                name: 'You',
                initials: 'YO',
                muted: false,
                videoOn: true,
                screenSharing: false,
                speaking: true,
              }])
            }
          }
        }
      }
    } catch {
      // Fallback: show self only
      setParticipants([{
        id: 'self', name: 'You', initials: 'YO',
        muted: false, videoOn: true, screenSharing: false, speaking: true,
      }])
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    void init()
    // Start elapsed timer
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [init])

  const leaveCall = async () => {
    if (roomId) {
      await apiFetch('/api/calls/rooms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId, action: 'leave' }),
      }).catch(() => {})
    }
    onClose()
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
    setParticipants(prev => prev.map(p => p.id === 'self' ? { ...p, muted: !isMuted } : p))
  }
  const toggleVideo = () => {
    setIsVideoOn(!isVideoOn)
    setParticipants(prev => prev.map(p => p.id === 'self' ? { ...p, videoOn: !isVideoOn } : p))
  }

  const sendChat = () => {
    if (!chatInput.trim()) return
    setChatMessages(prev => [...prev, { author: 'You', text: chatInput.trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
    setChatInput('')
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const elapsedStr = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  const controls: { Icon: typeof Mic; label: string; action: () => void; active: boolean }[] = [
    { Icon: isMuted ? MicOff : Mic, label: isMuted ? 'Unmute' : 'Mute', action: toggleMute, active: !isMuted },
    { Icon: isVideoOn ? Video : VideoOff, label: isVideoOn ? 'Stop Video' : 'Start Video', action: toggleVideo, active: isVideoOn },
    { Icon: MonitorUp, label: isScreenSharing ? 'Stop Share' : 'Share Screen', action: () => setIsScreenSharing(!isScreenSharing), active: isScreenSharing },
    { Icon: Circle, label: isRecording ? 'Stop Recording' : 'Record', action: () => setIsRecording(!isRecording), active: isRecording },
    { Icon: Smile, label: 'Reactions', action: () => {}, active: false },
  ]

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a2e', color: '#e0e0e0', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} className="spin" style={{ opacity: 0.5 }} />
        <p style={{ marginTop: 12, fontSize: 13, opacity: 0.5 }}>Connecting to huddle…</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a2e', color: '#e0e0e0' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2bac76' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>Huddle{channelName ? ` in ${channelName}` : ''}</h3>
            <span style={{ fontSize: 12, opacity: 0.6 }}>{participants.length} participant{participants.length !== 1 ? 's' : ''} · {elapsedStr}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isRecording && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#e01e5a30', color: '#e01e5a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Circle size={8} fill="#e01e5a" /> REC</span>}
          <button onClick={() => setShowChat(!showChat)} style={{ background: showChat ? '#4361EE' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
            <MessageSquare size={14} />
          </button>
          <button onClick={() => void leaveCall()} style={{ background: '#e01e5a', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <PhoneOff size={14} /> Leave
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: 16, display: 'grid', gridTemplateColumns: participants.length <= 2 ? '1fr' : '1fr 1fr', gap: 12, overflow: 'auto' }}>
          {participants.map(p => (
            <div key={p.id} style={{
              borderRadius: 16, overflow: 'hidden', position: 'relative', minHeight: 180,
              background: p.videoOn ? 'linear-gradient(135deg, #16213e, #0f3460)' : 'linear-gradient(135deg, #1a1a2e, #16213e)',
              border: p.speaking ? '2px solid #2bac76' : '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border 200ms',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: p.videoOn ? 'linear-gradient(135deg, #4361EE, #4CC9F0)' : 'rgba(255,255,255,0.1)',
                  display: 'grid', placeItems: 'center', margin: '0 auto 8px',
                  fontSize: 20, fontWeight: 700, color: '#fff',
                }}>
                  {p.initials}
                </div>
                <div style={{ fontSize: 13, color: '#fff' }}>{p.name}</div>
              </div>
              <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 4 }}>
                {p.muted && <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.5)', color: '#e01e5a', display: 'flex', alignItems: 'center' }}><MicOff size={12} /></span>}
                {p.screenSharing && <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.5)', color: '#2bac76', display: 'flex', alignItems: 'center' }}><MonitorUp size={12} /></span>}
              </div>
              <div style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 12, fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: 4 }}>
                {p.name}
              </div>
            </div>
          ))}
        </div>

        {showChat && (
          <div style={{ width: 280, borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 600, fontSize: 13 }}>Huddle Chat</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
              {chatMessages.length === 0 && <div style={{ textAlign: 'center', padding: 20, opacity: 0.3, fontSize: 12 }}>No messages yet</div>}
              {chatMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ color: '#fff' }}>{m.author}</strong>
                    <span style={{ fontSize: 10, opacity: 0.4 }}>{m.time}</span>
                  </div>
                  <p style={{ margin: '2px 0 0', opacity: 0.8, lineHeight: 1.4 }}>{m.text}</p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder="Type a message…"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#e0e0e0', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'center', gap: 12 }}>
        {controls.map(ctrl => (
          <button key={ctrl.label} onClick={ctrl.action} title={ctrl.label} style={{
            width: 48, height: 48, borderRadius: 14, border: 'none', cursor: 'pointer',
            background: ctrl.active ? 'rgba(67,97,238,0.3)' : 'rgba(255,255,255,0.08)',
            color: '#fff', transition: 'background 200ms', display: 'grid', placeItems: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(67,97,238,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.background = ctrl.active ? 'rgba(67,97,238,0.3)' : 'rgba(255,255,255,0.08)')}
          ><ctrl.Icon size={20} /></button>
        ))}
      </div>
    </div>
  )
}
