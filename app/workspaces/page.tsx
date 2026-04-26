'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Team {
  id: string
  display_name: string
  name: string
}

export default function WorkspacesPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])

  useEffect(() => {
    fetch('/api/mattermost/teams')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setTeams(data.teams ?? []))
      .catch(() => router.replace('/login'))
  }, [router])

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#1a1d21' }}>
      <section className="slack-card" style={{ width: 520, padding: 32 }}>
        <h1 style={{ marginTop: 0 }}>Choose workspace</h1>
        {teams.length === 0 ? (
          <button className="slack-button" onClick={() => router.push('/onboarding')}>
            Create first workspace
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {teams.map(team => (
              <button
                key={team.id}
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('aaelink_last_team', team.id)
                  }
                  router.push(`/home?team=${encodeURIComponent(team.id)}`)
                }}
                style={{ textAlign: 'left', padding: 14, borderRadius: 10, border: '1px solid #ddd', background: '#fff' }}
              >
                <strong>{team.display_name}</strong>
                <div style={{ color: '#616061' }}>{team.name}</div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
