import type {
  AdminUser,
  AdminUsersList,
  AuthResponse,
  Comment,
  Department,
  DepartmentsList,
  DocumentOperation,
  DocumentRecord,
  DocumentsList,
  MediaFile,
  PermissionsList,
  Role,
  RoleDefinition,
  RolesList,
  SupportRequest,
  SupportRequestsList,
  Ticket,
  TicketPriority,
  TicketStatus,
  User,
} from './types'
import { executeWithRlm } from './rlm'

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

  const res = await executeWithRlm(
    () => fetch(path, { ...opts, headers }),
    { operation: path },
  )

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
  updateMe: (data: {
    display_name?: string
    preferred_locale?: string
    avatar_url?: string | null
  }) => {
    const body: Record<string, unknown> = {}
    if (data.display_name !== undefined) body.display_name = data.display_name
    if (data.preferred_locale !== undefined)
      body.preferred_locale = data.preferred_locale
    if (data.avatar_url === null) body.clear_avatar = true
    else if (data.avatar_url !== undefined) body.avatar_url = data.avatar_url
    return request<User>('/api/v1/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },
  changePassword: (current_password: string, new_password: string) =>
    request<void>('/api/v1/auth/me/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
  refresh: (refresh_token: string) =>
    request<AuthResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token }),
      auth: false,
    }),
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

export const adminApi = {
  listUsers: () => request<AdminUsersList>('/api/v1/admin/users'),
  createUser: (data: {
    email: string
    password: string
    display_name: string
    locale?: string
    roles?: Role[]
    is_active?: boolean
    department_id?: string | null
  }) => {
    const body: Record<string, unknown> = { ...data }
    if (data.department_id == null || data.department_id === '') {
      delete body.department_id
    }
    return request<AdminUser>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },
  updateUser: (
    id: string,
    data: Partial<{
      email: string
      display_name: string
      preferred_locale: string
      department_id: string | null
    }>,
  ) => {
    const body: Record<string, unknown> = {}
    if (data.email !== undefined) body.email = data.email
    if (data.display_name !== undefined) body.display_name = data.display_name
    if (data.preferred_locale !== undefined)
      body.preferred_locale = data.preferred_locale
    if (data.department_id === null) body.clear_department = true
    else if (data.department_id !== undefined)
      body.department_id = data.department_id
    return request<AdminUser>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },
  updatePassword: (id: string, password: string) =>
    request<void>(`/api/v1/admin/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    }),
  updateRoles: (id: string, roles: Role[]) =>
    request<AdminUser>(`/api/v1/admin/users/${id}/roles`, {
      method: 'PATCH',
      body: JSON.stringify({ roles }),
    }),
  setActive: (id: string, is_active: boolean) =>
    request<AdminUser>(`/api/v1/admin/users/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active }),
    }),
  deleteUser: (id: string) =>
    request<void>(`/api/v1/admin/users/${id}`, { method: 'DELETE' }),
  listDepartments: () =>
    request<DepartmentsList>('/api/v1/admin/departments'),
  createDepartment: (data: {
    slug: string
    name: Record<string, string>
    is_it_dept?: boolean
  }) =>
    request<Department>('/api/v1/admin/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateDepartment: (
    id: string,
    data: Partial<{ slug: string; name: Record<string, string>; is_it_dept: boolean }>,
  ) =>
    request<Department>(`/api/v1/admin/departments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteDepartment: (id: string) =>
    request<void>(`/api/v1/admin/departments/${id}`, { method: 'DELETE' }),

  listRoles: () => request<RolesList>('/api/v1/admin/roles'),
  listPermissions: () => request<PermissionsList>('/api/v1/admin/permissions'),
  createRole: (data: {
    name: string
    display_name: Record<string, string>
    description?: string
    permission_ids?: string[]
  }) =>
    request<RoleDefinition>('/api/v1/admin/roles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRole: (
    id: string,
    data: Partial<{
      display_name: Record<string, string>
      description: string
      permission_ids: string[]
    }>,
  ) =>
    request<RoleDefinition>(`/api/v1/admin/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteRole: (id: string) =>
    request<void>(`/api/v1/admin/roles/${id}`, { method: 'DELETE' }),
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
  uploadAvatar: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ url: string; content_type: string; size: number }>(
      '/api/media/profile/avatar',
      { method: 'POST', body: fd },
    )
  },
  publicAvatarUrl: (userId: string, version?: string | number) => {
    const v = version == null ? '' : `?v=${encodeURIComponent(String(version))}`
    return `/api/media/public/avatar/${userId}${v}`
  },
}

export const supportApi = {
  createEmergency: (data: {
    requester: string
    subject: string
    message: string
  }) =>
    request<SupportRequest>('/api/v1/support/emergency', {
      method: 'POST',
      body: JSON.stringify(data),
      auth: false,
    }),
  listRequests: () => request<SupportRequestsList>('/api/v1/support/requests'),
}

export const documentsApi = {
  list: () => request<DocumentsList>('/api/v1/documents'),
  register: (data: {
    filename: string
    mime_type: 'application/pdf'
    file_size: number
    storage_key: string
  }) =>
    request<DocumentRecord>('/api/v1/documents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  queueOperation: (
    id: string,
    data: { operation: string; parameters?: Record<string, unknown> },
  ) =>
    request<DocumentOperation>(`/api/v1/documents/${id}/operations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
