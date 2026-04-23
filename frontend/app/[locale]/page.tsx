import { useTranslations } from 'next-intl'

export default function HomePage() {
  const t = useTranslations('app')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="flex flex-col items-center gap-6 text-center">
        <svg
          width="96"
          height="96"
          viewBox="0 0 96 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="AAELink"
        >
          <path
            d="M12 78 C 28 24, 68 24, 84 78"
            stroke="#0a2342"
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M22 78 C 34 38, 62 38, 74 78"
            stroke="#1e63b3"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M32 78 C 40 52, 56 52, 64 78"
            stroke="#5cb8e4"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        <div>
          <h1 className="text-5xl font-bold tracking-tight text-[color:var(--color-brand-navy)]">
            {t('name')}
          </h1>
          <p className="mt-3 text-lg text-[color:var(--muted)]">
            {t('tagline')}
          </p>
        </div>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-1.5 text-sm text-[color:var(--muted)]">
          <span className="h-2 w-2 rounded-full bg-[color:var(--color-brand-blue)]"></span>
          Layer 1 — Infrastructure online
        </div>
      </div>
    </main>
  )
}
