'use client'

import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { type TabOrientation, tabListKeyAction } from './tabListKeyHandler'

export interface TabItem {
  id: string
  label: ReactNode
  disabled?: boolean
}

export interface TabListProps {
  tabs: TabItem[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
  orientation?: TabOrientation
  idPrefix?: string
  className?: string
  tabClassName?: (active: boolean, tab: TabItem) => string | undefined
}

export function TabList({
  tabs,
  value,
  onChange,
  ariaLabel,
  orientation = 'horizontal',
  idPrefix = 'aae-tab',
  className,
  tabClassName,
}: TabListProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const currentIndex = Math.max(0, tabs.findIndex(t => t.id === value))

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const action = tabListKeyAction(e.key, currentIndex, tabs.length, orientation)
    if (!action) return
    e.preventDefault()
    const next = tabs[action.nextIndex]
    if (!next || next.disabled) return
    onChange(next.id)
    tabRefs.current[action.nextIndex]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={className}
    >
      {tabs.map((t, i) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            ref={el => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            aria-disabled={t.disabled || undefined}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            className={tabClassName ? tabClassName(active, t) : undefined}
            onClick={() => !t.disabled && onChange(t.id)}
            onKeyDown={onKeyDown}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelProps {
  tabId: string
  activeId: string
  idPrefix?: string
  children: ReactNode
  className?: string
}

export function TabPanel({ tabId, activeId, idPrefix = 'aae-tab', children, className }: TabPanelProps) {
  const active = tabId === activeId
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tabId}`}
      aria-labelledby={`${idPrefix}-tab-${tabId}`}
      hidden={!active}
      className={className}
    >
      {active ? children : null}
    </div>
  )
}
