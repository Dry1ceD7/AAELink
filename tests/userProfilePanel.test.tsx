/**
 * UserProfilePanel — RHS profile pane.
 *
 * Spec: docs/superpowers/specs/2026-05-15-user-profile-panel-design.md
 * Plan: docs/superpowers/plans/2026-05-15-user-profile-panel.md
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/api/apiClient', () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      user: {
        id: 'u1', username: 'alice', email: 'alice@aae.local',
        display_name: 'Alice Adams', platform_role: 'member',
        avatar_url: '', status: 'active', created_at: 1700000000000,
      },
      profile: {
        'profile.about': 'Engineer building AAELink.',
        'profile.title': 'Senior Engineer',
        'profile.pronouns': 'she/her',
      },
      custom_status: null,
      department_name: 'Engineering',
    }),
  })),
}))

import { apiFetch } from '@/lib/api/apiClient'
import { UserProfilePanel } from '@/components/user/UserProfilePanel'

describe('UserProfilePanel', () => {
  let onClose: ReturnType<typeof vi.fn>
  let onMessage: ReturnType<typeof vi.fn>
  let onHuddle: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(apiFetch).mockClear()
    onClose = vi.fn()
    onMessage = vi.fn()
    onHuddle = vi.fn()
  })

  afterEach(() => cleanup())

  // Helper makes the props object with the void-returning signatures the
  // component expects. `vi.fn()` is broader than `(uid: string) => void` in
  // strict mode, so we cast through unknown at the boundary.
  const props = (userId: string | null) => ({
    userId,
    presenceStatus: 'online',
    onClose: onClose as unknown as () => void,
    onMessage: onMessage as unknown as (uid: string) => void,
    onHuddle: onHuddle as unknown as (uid: string) => void,
  })

  it('renders nothing when userId is null', () => {
    const { container } = render(React.createElement(UserProfilePanel, props(null)))
    expect(container.firstChild).toBeNull()
  })

  it('shows loading state while fetching', () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('renders the name once fetched', async () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    await waitFor(() => expect(screen.getByText('Alice Adams')).toBeTruthy())
  })

  it('Esc key calls onClose', async () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('X button calls onClose', async () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByLabelText(/close/i))
    expect(onClose).toHaveBeenCalled()
  })

  it('Message button calls onMessage with userId', async () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByRole('button', { name: /^message$/i }))
    expect(onMessage).toHaveBeenCalledWith('u1')
  })

  it('Huddle button calls onHuddle with userId', async () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    await waitFor(() => screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByRole('button', { name: /^huddle$/i }))
    expect(onHuddle).toHaveBeenCalledWith('u1')
  })

  it('"View full profile" button is disabled when no callback provided', async () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    await waitFor(() => screen.getByText('Alice Adams'))
    const btn = screen.getByRole('button', { name: /view full profile/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows error state with retry on fetch failure', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false, status: 500,
      json: async () => ({ error: 'internal_server_error' }),
    } as unknown as Response)
    render(React.createElement(UserProfilePanel, props('u_err')))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('renders the department from the API response', async () => {
    render(React.createElement(UserProfilePanel, props('u1')))
    await waitFor(() => expect(screen.getByText('Engineering')).toBeTruthy())
  })
})
