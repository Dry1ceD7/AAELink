/**
 * Notification sound utility.
 *
 * Plays a notification sound when messages arrive, controllable
 * via localStorage preferences. Uses the Web Audio API so we
 * don't need to ship an external audio file.
 */

const PREF_KEY = 'aaelink-notification-sound'
const PREF_VOLUME_KEY = 'aaelink-notification-volume'

export type NotifSoundPref = 'default' | 'subtle' | 'none'

/** Read the saved preference (defaults to 'default'). */
export function getNotifSoundPref(): NotifSoundPref {
  if (typeof window === 'undefined') return 'default'
  const v = localStorage.getItem(PREF_KEY)
  if (v === 'subtle' || v === 'none') return v
  return 'default'
}

/** Save the preference. */
export function setNotifSoundPref(pref: NotifSoundPref) {
  localStorage.setItem(PREF_KEY, pref)
}

/** Get volume 0–1. */
export function getNotifVolume(): number {
  if (typeof window === 'undefined') return 0.5
  const v = parseFloat(localStorage.getItem(PREF_VOLUME_KEY) || '0.5')
  return isNaN(v) ? 0.5 : Math.max(0, Math.min(1, v))
}

/** Set volume 0–1. */
export function setNotifVolume(vol: number) {
  localStorage.setItem(PREF_VOLUME_KEY, String(Math.max(0, Math.min(1, vol))))
}

/** Play a short notification beep via Web Audio API. */
export function playNotificationSound(): void {
  const pref = getNotifSoundPref()
  if (pref === 'none') return

  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const vol = getNotifVolume()
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(vol * (pref === 'subtle' ? 0.15 : 0.35), ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (pref === 'subtle' ? 0.15 : 0.3))
    gain.connect(ctx.destination)

    const osc = ctx.createOscillator()
    osc.type = pref === 'subtle' ? 'sine' : 'triangle'
    osc.frequency.setValueAtTime(pref === 'subtle' ? 880 : 660, ctx.currentTime)
    if (pref === 'default') {
      // Two-tone chime
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
    }
    osc.connect(gain)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + (pref === 'subtle' ? 0.15 : 0.3))

    osc.onended = () => {
      gain.disconnect()
      ctx.close()
    }
  } catch {
    // AudioContext not available or blocked — silently ignore
  }
}
