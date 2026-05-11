'use client'

import { type ReactNode, useCallback, useRef, useState } from 'react'

export type AriaLivePriority = 'polite' | 'assertive'

export interface UseAriaLiveResult {
  announce: (message: string, priority?: AriaLivePriority) => void
  ariaLiveRegions: ReactNode
}

export function useAriaLive(): UseAriaLiveResult {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  const tick = useRef(0)

  const announce = useCallback(
    (message: string, priority: AriaLivePriority = 'polite') => {
      tick.current = (tick.current + 1) % 4
      const stamped = `${message}${' '.repeat(tick.current)}`
      if (priority === 'assertive') setAssertive(stamped)
      else setPolite(stamped)
    },
    []
  )

  const ariaLiveRegions: ReactNode = (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true" role="status">
        {polite}
      </div>
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true" role="alert">
        {assertive}
      </div>
    </>
  )

  return { announce, ariaLiveRegions }
}
