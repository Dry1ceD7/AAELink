import { cn } from '@/lib/utils'

interface LogoProps {
  size?: number
  withWordmark?: boolean
  className?: string
}

export function Logo({ size = 32, withWordmark = false, className }: LogoProps) {
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 96 96"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="AAELink"
      >
        <path
          d="M12 78 C 28 24, 68 24, 84 78"
          stroke="var(--color-brand-navy)"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M22 78 C 34 38, 62 38, 74 78"
          stroke="var(--color-brand-blue)"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M32 78 C 40 52, 56 52, 64 78"
          stroke="var(--color-brand-sky)"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {withWordmark && (
        <span className="text-lg font-bold tracking-tight text-[color:var(--color-brand-navy)] dark:text-[color:var(--fg)]">
          AAELink
        </span>
      )}
    </div>
  )
}
