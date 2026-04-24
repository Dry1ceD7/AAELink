'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

interface AvatarProps {
  src?: string | null
  name?: string | null
  email?: string | null
  size?: number
  className?: string
}

function initialsFor(name?: string | null, email?: string | null): string {
  const source = (name && name.trim()) || (email && email.trim()) || '?'
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '')
  const out = letters.join('')
  return out || '?'
}

export function Avatar({
  src,
  name,
  email,
  size = 40,
  className,
}: AvatarProps) {
  const initials = useMemo(() => initialsFor(name, email), [name, email])
  const [errored, setErrored] = useState(false)
  const usable = src && !errored

  const dimension = `${size}px`

  if (usable) {
    return (
      <span
        className={cn(
          'relative inline-flex shrink-0 overflow-hidden rounded-full bg-[color:var(--surface)]',
          className,
        )}
        style={{ width: dimension, height: dimension }}
      >
        <Image
          src={src!}
          alt={name ?? email ?? 'Avatar'}
          width={size}
          height={size}
          unoptimized
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      </span>
    )
  }

  // Fallback: initials on the brand accent.
  const fontSize = Math.max(11, Math.round(size * 0.4))
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] font-semibold text-white',
        className,
      )}
      style={{ width: dimension, height: dimension, fontSize }}
      aria-hidden
    >
      {initials}
    </span>
  )
}
