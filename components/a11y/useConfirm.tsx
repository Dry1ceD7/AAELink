'use client'

import { type ReactNode, useCallback, useRef, useState } from 'react'
import { ConfirmDialog } from '@/app/home/ConfirmDialog'

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface UseConfirmResult {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
}

interface ResolverState extends ConfirmOptions {
  open: boolean
}

/**
 * Drop-in replacement for window.confirm() that resolves via a styled,
 * focus-trapped, ARIA-correct ConfirmDialog instead of the unstyled
 * native modal. Returns a Promise<boolean>.
 *
 * Usage:
 *   const { confirm, confirmDialog } = useConfirm()
 *   if (!(await confirm({ title: 'Delete', message: 'Sure?', danger: true }))) return
 *   // ...mount {confirmDialog} once in the component tree.
 */
export function useConfirm(): UseConfirmResult {
  const [state, setState] = useState<ResolverState>({
    open: false,
    title: '',
    message: '',
  })
  const resolverRef = useRef<((result: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve
      setState({ open: true, ...opts })
    })
  }, [])

  const close = useCallback((result: boolean) => {
    setState(s => ({ ...s, open: false }))
    const resolver = resolverRef.current
    resolverRef.current = null
    resolver?.(result)
  }, [])

  const confirmDialog = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  )

  return { confirm, confirmDialog }
}
