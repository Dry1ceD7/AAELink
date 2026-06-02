/** Stored UI density; read early on client so layout matches before React paint. */
export const UI_DENSITY_KEY = 'aaelink_ui_density'

export type UiDensity = 'comfortable' | 'compact'

export function readUiDensity(): UiDensity {
  if (typeof window === 'undefined') return 'comfortable'
  try {
    const v = window.localStorage.getItem(UI_DENSITY_KEY)
    if (v === 'compact' || v === 'comfortable') return v
  } catch {
    /* ignore */
  }
  return 'comfortable'
}

export function applyUiDensity(density?: UiDensity): void {
  if (typeof document === 'undefined') return
  const v = density ?? readUiDensity()
  if (v === 'compact') document.documentElement.setAttribute('data-mm-density', 'compact')
  else document.documentElement.removeAttribute('data-mm-density')
}

export function persistUiDensity(d: UiDensity): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UI_DENSITY_KEY, d)
  } catch {
    /* ignore */
  }
  applyUiDensity(d)
}
