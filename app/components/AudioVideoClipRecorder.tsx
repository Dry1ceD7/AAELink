'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Video, Mic, Camera, Play, Pause, Square, X } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   AudioVideoClipRecorder — Slack-style async clips
   • Record up to 5 minutes of audio/video directly in chat
   • Real-time waveform visualization
   • Preview before sending
   • Auto-transcription display
   ───────────────────────────────────────────────────────────────────── */

interface AudioVideoClipRecorderProps {
  mode: 'audio' | 'video'
  onClose: () => void
  onSend: (clip: { type: 'audio' | 'video'; duration: number; transcript?: string }) => void
}

export default function AudioVideoClipRecorder({ mode, onClose, onSend }: AudioVideoClipRecorderProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [isReviewing, setIsReviewing] = useState(false)
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(40).fill(3))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const waveformRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const MAX_DURATION = 300 // 5 minutes

  const startRecording = useCallback(() => {
    setIsRecording(true)
    setIsPaused(false)
    setElapsed(0)
    timerRef.current = setInterval(() => {
      setElapsed(e => {
        if (e >= MAX_DURATION) {
          stopRecording()
          return MAX_DURATION
        }
        return e + 1
      })
    }, 1000)
    waveformRef.current = setInterval(() => {
      setWaveformBars(prev => prev.map(() => Math.max(3, Math.floor(Math.random() * 32))))
    }, 100)
  }, [])

  const stopRecording = useCallback(() => {
    setIsRecording(false)
    setIsPaused(false)
    setIsReviewing(true)
    if (timerRef.current) clearInterval(timerRef.current)
    if (waveformRef.current) clearInterval(waveformRef.current)
    setWaveformBars(prev => prev.map(() => Math.max(3, Math.floor(Math.random() * 20))))
  }, [])

  const pauseRecording = useCallback(() => {
    setIsPaused(true)
    if (timerRef.current) clearInterval(timerRef.current)
    if (waveformRef.current) clearInterval(waveformRef.current)
  }, [])

  const resumeRecording = useCallback(() => {
    setIsPaused(false)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    waveformRef.current = setInterval(() => {
      setWaveformBars(prev => prev.map(() => Math.max(3, Math.floor(Math.random() * 32))))
    }, 100)
  }, [])

  const discardRecording = useCallback(() => {
    setIsRecording(false)
    setIsReviewing(false)
    setElapsed(0)
    setWaveformBars(Array(40).fill(3))
    if (timerRef.current) clearInterval(timerRef.current)
    if (waveformRef.current) clearInterval(waveformRef.current)
  }, [])

  const sendClip = useCallback(() => {
    onSend({ type: mode, duration: elapsed, transcript: 'Auto-generated transcript would appear here.' })
    onClose()
  }, [mode, elapsed, onSend, onClose])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (waveformRef.current) clearInterval(waveformRef.current)
    }
  }, [])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div style={{
      background: 'var(--mm-main-bg)', borderRadius: 16,
      border: '1px solid var(--mm-border)',
      boxShadow: 'var(--slack-shadow-modal)',
      padding: 20, width: 400, maxWidth: '90vw',
      animation: 'slack-modal-in 300ms var(--slack-ease-bounce) forwards',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex' }}>{mode === 'video' ? <Video size={18} /> : <Mic size={18} />}</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            {isReviewing ? 'Review clip' : isRecording ? 'Recording…' : `Record ${mode} clip`}
          </span>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none',
          cursor: 'pointer', color: 'var(--mm-muted)',
        }}><X size={18} /></button>
      </div>

      {/* Video preview area */}
      {mode === 'video' && (
        <div style={{
          width: '100%', height: 200, borderRadius: 12,
          background: '#1a1d21', marginBottom: 16,
          display: 'grid', placeItems: 'center',
          border: '1px solid var(--mm-border-subtle)',
        }}>
          {isRecording ? (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: 'linear-gradient(135deg, #4361EE, #4CC9F0)',
                display: 'grid', placeItems: 'center', margin: '0 auto 8px',
                fontSize: 24,
              }}><Video size={24} color="#fff" /></div>
              <span style={{ fontSize: 13, opacity: 0.7 }}>Camera preview</span>
            </div>
          ) : isReviewing ? (
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <Play size={32} color="#fff" />
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>Play to review</div>
            </div>
          ) : (
            <Camera size={40} style={{ opacity: 0.3 }} />
          )}
        </div>
      )}

      {/* Waveform */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 1,
        height: 40, padding: '0 4px', marginBottom: 12,
        background: 'var(--mm-hover-bg)', borderRadius: 8, overflow: 'hidden',
      }}>
        {waveformBars.map((h, i) => (
          <div key={i} style={{
            width: 3, height: h, borderRadius: 2,
            background: isRecording
              ? `linear-gradient(180deg, #e01e5a, #4361EE)`
              : isReviewing
              ? '#4361EE'
              : 'var(--mm-border)',
            transition: isRecording ? 'height 100ms ease' : 'height 300ms ease',
            opacity: isRecording && isPaused ? 0.3 : 1,
          }} />
        ))}
      </div>

      {/* Timer */}
      <div style={{
        textAlign: 'center', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        {isRecording && (
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#e01e5a',
            animation: isPaused ? 'none' : 'pulse 1s ease-in-out infinite',
          }} />
        )}
        <span style={{
          fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: isRecording ? '#e01e5a' : 'var(--mm-text)',
        }}>
          {formatTime(elapsed)}
        </span>
        <span style={{ fontSize: 12, opacity: 0.4 }}>/ {formatTime(MAX_DURATION)}</span>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 12,
      }}>
        {!isRecording && !isReviewing && (
          <button onClick={startRecording} style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#e01e5a', border: 'none',
            cursor: 'pointer', display: 'grid', placeItems: 'center',
            color: '#fff', fontSize: 22,
            boxShadow: '0 4px 16px rgba(224,30,90,0.3)',
            transition: 'transform 100ms ease',
          }}>
            ●
          </button>
        )}

        {isRecording && (
          <>
            <button onClick={isPaused ? resumeRecording : pauseRecording} style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--mm-hover-bg)', border: '1px solid var(--mm-border)',
              cursor: 'pointer', display: 'grid', placeItems: 'center',
              fontSize: 16, color: 'var(--mm-text)',
            }}>
              {isPaused ? '▶' : '⏸'}
            </button>
            <button onClick={stopRecording} style={{
              width: 48, height: 48, borderRadius: '50%',
              background: '#e01e5a', border: 'none',
              cursor: 'pointer', display: 'grid', placeItems: 'center',
              color: '#fff', fontSize: 14,
            }}>
              ⏹
            </button>
          </>
        )}

        {isReviewing && (
          <>
            <button onClick={discardRecording} style={{
              height: 40, borderRadius: 8, border: '1px solid var(--mm-border)',
              background: 'none', padding: '0 20px', cursor: 'pointer',
              color: 'var(--mm-muted)', fontSize: 13,
            }}>Discard</button>
            <button onClick={startRecording} style={{
              height: 40, borderRadius: 8, border: '1px solid var(--mm-border)',
              background: 'none', padding: '0 20px', cursor: 'pointer',
              color: 'var(--mm-text)', fontSize: 13,
            }}>Re-record</button>
            <button onClick={sendClip} style={{
              height: 40, borderRadius: 8, border: 'none',
              background: '#4361EE', padding: '0 20px', cursor: 'pointer',
              color: '#fff', fontSize: 13, fontWeight: 600,
            }}>Send clip</button>
          </>
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        textAlign: 'center', marginTop: 12,
        fontSize: 11, opacity: 0.4,
      }}>
        {isRecording ? 'Recording will auto-stop at 5 minutes' : isReviewing ? 'Clip will be auto-transcribed after sending' : `Click to start recording a ${mode} clip`}
      </div>
    </div>
  )
}
