import type {
  AuthResponse,
  Comment,
  MediaFile,
  Ticket,
  TicketPriority,
  TicketStatus,
  User,
} from './types'

const ACCESS_KEY = 'aae_access_token'
const REFRESH_KEY = 'aae_refresh_token'
const USER_KEY = 'aae_user'

export const tokenStorage = {
  getAccess(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(ACCESS_KEY)
  },
  getRefresh(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh: string) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ACCESS_KEY, access)
    window.localStorage.setItem(REFRESH_KEY, refresh)
  },
  setUser(u: User) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(USER_KEY, JSON.stringify(u))
  },
  getUser(): User | null {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as User
    } catch {
      return null
    }
  },
  clear() {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(ACCESS_KEY)
    window.localStorage.removeItem(REFRESH_KEY)
    window.localStorage.removeItem(USER_KEY)
  },
}

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type RequestOptions = RequestInit & { auth?: boolean; raw?: boolean }

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  }

  if (!(opts.body instanceof FormData) && opts.body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
  }

  if (opts.auth !== false) {
    const token = tokenStorage.getAccess()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(path, { ...opts, headers })

  if (!res.ok) {
    let code: string | undefined
    let msg = `HTTP ${res.status}`
    try {
      const j = await res.json()
      code = j.error || j.code
      msg = j.message || j.error || msg
    } catch {
      // ignore
    }
    if (res.status === 401) {
      tokenStorage.clear()
    }
    throw new ApiError(msg, res.status, code)
  }

  if (opts.raw) return (res as unknown) as T
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

export const authApi = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      auth: false,
    }),
  register: (email: string, password: string, display_name: string, locale = 'en') =>
    request<User>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name, locale }),
      auth: false,
    }),
  me: () => request<User>('/api/v1/auth/me', { method: 'GET' }),
  logout: (refresh_token: string) =>
    request<void>('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token }),
    }),
}

export const ticketsApi = {
  list: (params: { status?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.status) q.set('status', params.status)
    if (params.limit) q.set('limit', String(params.limit))
    if (params.offset) q.set('offset', String(params.offset))
    const suffix = q.toString() ? `?${q}` : ''
    return request<Ticket[]>(`/api/v1/tickets${suffix}`)
  },
  get: (id: string) => request<Ticket>(`/api/v1/tickets/${id}`),
  create: (data: {
    title: string
    description: string
    priority?: TicketPriority
  }) =>
    request<Ticket>('/api/v1/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateStatus: (id: string, status: TicketStatus) =>
    request<Ticket>(`/api/v1/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  assign: (id: string, assignee_id: string) =>
    request<Ticket>(`/api/v1/tickets/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assignee_id }),
    }),
  comments: (id: string) => request<Comment[]>(`/api/v1/tickets/${id}/comments`),
  addComment: (id: string, content: string, is_internal = false) =>
    request<Comment>(`/api/v1/tickets/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, is_internal }),
    }),
}

export const mediaApi = {
  list: (ticketId: string) =>
    request<{ files: MediaFile[]; count: number }>(
      `/api/media/tickets/${ticketId}/files`
    ),
  upload: (ticketId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<MediaFile>(`/api/media/tickets/${ticketId}/files`, {
      method: 'POST',
      body: fd,
    })
  },
  presign: (fileId: string) =>
    request<{ url: string; expires_in: number; filename: string; mime_type: string }>(
      `/api/media/files/${fileId}/url`
    ),
}
