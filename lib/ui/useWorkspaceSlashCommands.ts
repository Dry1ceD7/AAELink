/**
 * `useWorkspaceSlashCommands` — fetches workspace-scoped custom slash commands
 * from `GET /api/slash-commands?workspace_id=...` and exposes the *custom* ones
 * for inclusion in the Composer autocomplete.
 *
 * Built-ins from the API are dropped on the client side because they overlap
 * with the local registries in `lib/slashCommands.ts` and `lib/composerSlash.ts`
 * (which know how to actually execute the command without an extra HTTP round
 * trip). Only commands marked `is_builtin: false` are returned.
 *
 * Caching: a single in-memory `Map<workspaceId, Promise<...>>` so multiple
 * Composer mounts in the same session share one fetch.
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'

export interface WorkspaceSlashCommand {
  name: string
  description: string
  usage: string
}

interface ApiCommand {
  id?: string
  name?: string
  description?: string
  usage?: string
  is_builtin?: boolean
}

interface ApiResponse {
  commands?: ApiCommand[]
}

const cache = new Map<string, Promise<WorkspaceSlashCommand[]>>()

export function _resetWorkspaceSlashCommandsCache(): void {
  cache.clear()
}

/**
 * Filter a raw API response down to non-built-in commands with the shape the
 * Composer autocomplete consumes.
 */
export function selectCustomCommands(payload: ApiResponse | null): WorkspaceSlashCommand[] {
  if (!payload || !Array.isArray(payload.commands)) return []
  return payload.commands
    .filter((c): c is ApiCommand & { name: string } =>
      typeof c?.name === 'string' && c.name.length > 0 && c.is_builtin !== true
    )
    .map(c => ({
      name: c.name,
      description: typeof c.description === 'string' && c.description.length > 0
        ? c.description
        : `Custom command /${c.name}`,
      usage: typeof c.usage === 'string' && c.usage.length > 0 ? c.usage : `/${c.name}`,
    }))
}

async function fetchOnce(workspaceId: string): Promise<WorkspaceSlashCommand[]> {
  if (!workspaceId) return []
  try {
    const res = await apiFetch(`/api/slash-commands?workspace_id=${encodeURIComponent(workspaceId)}`)
    if (!res.ok) return []
    const payload = (await res.json()) as ApiResponse
    return selectCustomCommands(payload)
  } catch {
    return []
  }
}

/**
 * React hook. Returns the list of custom slash commands for the active
 * workspace, or an empty array while loading / on error. Cached across mounts.
 */
export function useWorkspaceSlashCommands(workspaceId: string | undefined): WorkspaceSlashCommand[] {
  const [list, setList] = useState<WorkspaceSlashCommand[]>([])

  useEffect(() => {
    if (!workspaceId) {
      setList([])
      return
    }
    const ws = workspaceId
    let cancelled = false
    let promise = cache.get(ws)
    if (!promise) {
      promise = fetchOnce(ws)
      cache.set(ws, promise)
    }
    promise.then(value => {
      if (!cancelled) setList(value)
    })
    return () => { cancelled = true }
  }, [workspaceId])

  return list
}
