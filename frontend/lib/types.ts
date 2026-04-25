export type Role = 'it_admin' | 'it_employee' | 'employee' | string

export interface User {
  id: string
  email: string
  display_name: string
  preferred_locale: string
  is_active: boolean
  roles?: Role[]
  avatar_url?: string | null
  department_id?: string | null
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  access_expires_at: string
  refresh_expires_at: string
}

export interface AuthResponse {
  user: User
  tokens: TokenPair
}

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'pending_employee'
  | 'resolved'
  | 'closed'
  | 'cancelled'

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Ticket {
  id: string
  number: number
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  category_id?: string | null
  created_by: string
  assigned_to?: string | null
  department_id?: string | null
  resolved_at?: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
}

export interface Comment {
  id: string
  ticket_id: string
  user_id: string
  content: string
  is_internal: boolean
  created_at: string
}

export interface AdminUser {
  id: string
  email: string
  display_name: string
  preferred_locale: string
  is_active: boolean
  roles: Role[]
  department_id?: string | null
  avatar_url?: string | null
  created_at: string
  updated_at: string
}

export interface AdminUsersList {
  users: AdminUser[]
  count: number
}

export interface Department {
  id: string
  slug: string
  name: Record<string, string>
  is_it_dept: boolean
  created_at: string
  updated_at: string
}

export interface DepartmentsList {
  departments: Department[]
  count: number
}

export interface Permission {
  id: string
  resource: string
  action: string
  description?: string
}

export interface PermissionsList {
  permissions: Permission[]
  count: number
}

export interface RoleDefinition {
  id: string
  name: string
  display_name: Record<string, string>
  description?: string
  is_system: boolean
  created_at: string
  permissions: Permission[]
}

export interface RolesList {
  roles: RoleDefinition[]
  count: number
}

export interface MediaFile {
  id: string
  ticket_id: string
  filename: string
  mime_type: string
  file_size: number
  kind: string
  uploaded_by: string
  uploaded_at: string
  url?: string
}

export interface SupportRequest {
  id: string
  requester: string
  subject: string
  message?: string
  status: 'queued' | 'open' | 'closed' | string
  created_at: string
  last_message_at?: string | null
}

export interface SupportRequestsList {
  requests: SupportRequest[]
  count: number
}

export interface DocumentRecord {
  id: string
  owner_id: string
  filename: string
  mime_type: string
  file_size: number
  storage_key: string
  status: string
  version: number
  created_at: string
  updated_at: string
}

export interface DocumentsList {
  documents: DocumentRecord[]
  count: number
}

export interface DocumentOperation {
  id: string
  document_id: string
  operation: string
  status: string
  parameters: Record<string, unknown>
  created_by: string
  created_at: string
}
