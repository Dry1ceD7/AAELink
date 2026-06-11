'use client'

import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Video, VideoOff, MonitorUp, Circle, Smile, MessageSquare, PhoneOff, Loader2 } from 'lucide-react'
import { useHuddleRtc, type HuddleTile } from './useHuddleRtc'

/* ── Huddle Panel — Real-time audio/video calls (WebRTC mesh) ──────── */

/** Remote/self video element that binds a MediaStream via srcObject. */
function HuddleVideo({ stream, muted }: { stream: MediaStream | null; muted: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.srcObject !== stream) el.srcObject = stream
  }, [stream])
  if (!stream) return null
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className="huddle-tile-video"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}

export default function HuddlePanel({
  onClose, channelName, channelId, workspaceId,
}: { onClose: () => void; channelName?: string; channelId?: string; workspaceId?: string }) {
  const {
    loading, tiles, mediaError,
    isMuted, isVideoOn, isScreenSharing,
    toggleMute, toggleVideo, toggleScreenShare, leave,
  } = useHuddleRtc({ channelId, workspaceId })

  const [isRecording, setIsRecording] = useState(false)
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false)
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string }[]>([])
  const [showChat, setShowChat] = useState(false)
  const [chatMessages, setChatMessages] = useState<{ author: string; text: string; time: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const leaveCall = async () => {
    await leave()
    onClose()
  }

  const sendChat = () => {
    if (!chatInput.trim()) return
    setChatMessages(prev => [...prev, { author: 'You', text: chatInput.trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
    setChatInput('')
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const elapsedStr = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  const REACTION_EMOJIS = ['👏', '🎉', '❤️', '😂', '👍', '🙏', '🔥', '💯']
  function fireReaction(emoji: string) {
    const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setFloatingReactions(prev => [...prev, { id, emoji }])
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id))
    }, 2500)
    setReactionPickerOpen(false)
  }

  const controls: { Icon: typeof Mic; label: string; action: () => void; active: boolean }[] = [
    { Icon: isMuted ? MicOff : Mic, label: isMuted ? 'Unmute' : 'Mute', action: () => void toggleMute(), active: !isMuted },
    { Icon: isVideoOn ? Video : VideoOff, label: isVideoOn ? 'Stop Video' : 'Start Video', action: () => void toggleVideo(), active: isVideoOn },
    { Icon: MonitorUp, label: isScreenSharing ? 'Stop Share' : 'Share Screen', action: () => void toggleScreenShare(), active: isScreenSharing },
    { Icon: Circle, label: isRecording ? 'Stop Recording' : 'Record', action: () => setIsRecording(!isRecording), active: isRecording },
    { Icon: Smile, label: 'Reactions', action: () => setReactionPickerOpen(v => !v), active: reactionPickerOpen },
  ]

  if (loading) {
    return (
      <div className="huddle-panel huddle-panel--loading">
        <Loader2 size={32} className="spin" style={{ opacity: 0.5 }} />
        <p>Connecting to huddle…</p>
      </div>
    )
  }

  const renderTile = (p: HuddleTile) => (
    <div key={p.id} className={`huddle-tile${!p.videoOn ? ' huddle-tile--no-video' : ''}`}>
      {p.videoOn && p.stream && <HuddleVideo stream={p.stream} muted={p.isSelf} />}
      <div className="huddle-tile-center">
        <div className={`huddle-avatar${!p.videoOn ? ' huddle-avatar--no-video' : ''}`}>
          {p.initials}
        </div>
        <div className="huddle-tile-name">{p.name}</div>
      </div>
      <div className="huddle-tile-badges">
        {p.muted && <span className="huddle-tile-badge huddle-tile-badge--muted"><MicOff size={12} /></span>}
        {p.screenSharing && <span className="huddle-tile-badge huddle-tile-badge--screen"><MonitorUp size={12} /></span>}
      </div>
      <div className="huddle-tile-label">{p.name}</div>
    </div>
  )

  return (
    <div className="huddle-panel">
      <div className="huddle-header">
        <div className="huddle-header-info">
          <div className="huddle-header-dot" />
          <div>
            <h3>Huddle{channelName ? ` in ${channelName}` : ''}</h3>
            <span className="huddle-header-meta">{tiles.length} participant{tiles.length !== 1 ? 's' : ''} · {elapsedStr}</span>
          </div>
        </div>
        <div className="huddle-header-actions">
          {isRecording && <span className="huddle-rec-badge"><Circle size={8} fill="#e01e5a" /> REC</span>}
          <button
            className={`huddle-chat-toggle${showChat ? ' huddle-chat-toggle--active' : ''}`}
            onClick={() => setShowChat(!showChat)}
            aria-label="Toggle huddle chat"
          >
            <MessageSquare size={14} />
          </button>
          <button className="huddle-leave-btn" onClick={() => void leaveCall()}>
            <PhoneOff size={14} /> Leave
          </button>
        </div>
      </div>

      {mediaError && (
        <div className="huddle-media-notice" role="status" style={{
          padding: '8px 16px', fontSize: 13, color: '#f6c177',
          background: 'rgba(246, 193, 119, 0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          Camera/microphone unavailable — you joined in listen-only mode.
        </div>
      )}

      <div className="huddle-body">
        <div className={`huddle-grid ${tiles.length <= 2 ? 'huddle-grid--few' : 'huddle-grid--many'}`}>
          {tiles.map(renderTile)}
        </div>

        {showChat && (
          <div className="huddle-chat">
            <div className="huddle-chat-header">Huddle Chat</div>
            <div className="huddle-chat-body">
              {chatMessages.length === 0 && <div className="huddle-chat-empty">No messages yet</div>}
              {chatMessages.map((m, i) => (
                <div key={i} className="huddle-chat-msg">
                  <div className="huddle-chat-msg-header">
                    <strong className="huddle-chat-msg-author">{m.author}</strong>
                    <span className="huddle-chat-msg-time">{m.time}</span>
                  </div>
                  <p className="huddle-chat-msg-text">{m.text}</p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="huddle-chat-input-wrap">
              <input
                className="huddle-chat-input"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder="Type a message…"
              />
            </div>
          </div>
        )}
      </div>

      <div className="huddle-controls" style={{ position: 'relative' }}>
        {controls.map(ctrl => (
          <button
            key={ctrl.label}
            onClick={ctrl.action}
            title={ctrl.label}
            aria-label={ctrl.label}
            className={`huddle-control-btn${ctrl.active ? ' huddle-control-btn--active' : ''}`}
          >
            <ctrl.Icon size={20} />
          </button>
        ))}

        {/* Reaction picker — shown above the control bar */}
        {reactionPickerOpen && (
          <div
            role="menu"
            aria-label="Send a reaction"
            style={{
              position: 'absolute', bottom: '100%', right: 16, marginBottom: 8,
              background: 'rgba(20, 22, 26, 0.92)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: '8px 10px', display: 'flex', gap: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', zIndex: 20,
            }}
          >
            {REACTION_EMOJIS.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => fireReaction(em)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 22, padding: 4, lineHeight: 1,
                  borderRadius: 6, transition: 'background 100ms',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                aria-label={`Send ${em} reaction`}
              >
                {em}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Floating reactions — animated overlay */}
      {floatingReactions.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            overflow: 'hidden', zIndex: 19,
          }}
        >
          {floatingReactions.map((r, i) => (
            <span
              key={r.id}
              style={{
                position: 'absolute',
                left: `${15 + (i % 6) * 12}%`,
                bottom: 80,
                fontSize: 36,
                animation: 'huddleFloatUp 2.5s ease-out forwards',
              }}
            >
              {r.emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
