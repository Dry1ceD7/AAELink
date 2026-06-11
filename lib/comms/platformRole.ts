/** Built-in platform roles for internal IT and leadership. */
export type PlatformRole = '' | 'super_admin' | 'it_admin' | 'it_employee' | 'employee'

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === 'super_admin'
}

export function isItAdmin(role: string | null | undefined): boolean {
  return role === 'it_admin'
}

/** Can open the organization admin dashboard (user management, access requests). */
export function isPlatformAdmin(role: string | null | undefined): boolean {
  return isSuperAdmin(role) || isItAdmin(role)
}
