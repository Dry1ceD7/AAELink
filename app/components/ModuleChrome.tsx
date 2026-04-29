'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { buildHomePathForTeam, readRememberedWorkspaceTeam } from '@/lib/workspaceNav'

export function ModuleChrome({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  const [team, setTeam] = useState('')

  useEffect(() => {
    setTeam(readRememberedWorkspaceTeam())
  }, [])

  const homeHref = team ? buildHomePathForTeam(team) : '/home'

  return (
    <header className="module-chrome">
      <div className="module-chrome-left">
        <Link className="module-back" href={homeHref}>
          Back
        </Link>
        <div className="module-chrome-titles">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="module-chrome-actions">{actions}</div> : null}
    </header>
  )
}
