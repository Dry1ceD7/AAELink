/**
 * D11 Profiles — org-level custom profile fields.
 *
 * An org admin defines custom profile fields (e.g. "Pronouns", "Desk", "Start
 * date"); members fill in values. Field definitions live per org; a value is one
 * row per (field, user). Reading a user's profile returns every org field with
 * the user's value (or '' when unset), so the shape is stable for the UI.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export type ProfileFieldType = 'text' | 'textarea' | 'select' | 'link' | 'date'
export const PROFILE_FIELD_TYPES: ProfileFieldType[] = ['text', 'textarea', 'select', 'link', 'date']

export function isProfileFieldType(v: string): v is ProfileFieldType {
  return (PROFILE_FIELD_TYPES as string[]).includes(v)
}

/** Normalize a field key: lowercase snake-ish identifier. */
export function normalizeFieldKey(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export interface ProfileField {
  id: string
  field_key: string
  label: string
  field_type: ProfileFieldType
  options: string[]
  position: number
}

export type DefineFieldResult =
  | { ok: true; field: ProfileField }
  | { ok: false; code: 'invalid_key' | 'invalid_type' | 'invalid_label' | 'duplicate_key' }

/** Define (or update by key) a custom profile field for an org. */
export async function defineField(
  pool: Pool,
  orgId: string,
  input: { key: string; label: string; type?: string; options?: string[]; position?: number }
): Promise<DefineFieldResult> {
  const key = normalizeFieldKey(input.key)
  if (!key) return { ok: false, code: 'invalid_key' }
  const label = String(input.label || '').trim()
  if (!label) return { ok: false, code: 'invalid_label' }
  const type = input.type ?? 'text'
  if (!isProfileFieldType(type)) return { ok: false, code: 'invalid_type' }
  const options = Array.isArray(input.options) ? input.options.map(String) : []
  const position = Number.isFinite(input.position) ? Number(input.position) : 0

  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.org_profile_fields WHERE org_id = $1 AND field_key = $2`,
    [orgId, key]
  )
  const id = existing[0]?.id ?? randomUUID()
  await pool.query(
    `INSERT INTO aaelink.org_profile_fields (id, org_id, field_key, label, field_type, options, position, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (org_id, field_key)
       DO UPDATE SET label = $4, field_type = $5, options = $6, position = $7`,
    [id, orgId, key, label, type, JSON.stringify(options), position, Date.now()]
  )
  return { ok: true, field: { id, field_key: key, label, field_type: type, options, position } }
}

/** Remove a field (and all its values via cascade). False when absent. */
export async function removeField(pool: Pool, orgId: string, fieldId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.org_profile_fields WHERE org_id = $1 AND id = $2`,
    [orgId, fieldId]
  )
  return (rowCount ?? 0) > 0
}

/** List an org's field definitions, by position then label. */
export async function listFields(pool: Pool, orgId: string): Promise<ProfileField[]> {
  const { rows } = await pool.query<{
    id: string; field_key: string; label: string; field_type: ProfileFieldType; options: string[]; position: number
  }>(
    `SELECT id, field_key, label, field_type, options, position
       FROM aaelink.org_profile_fields
      WHERE org_id = $1
      ORDER BY position ASC, label ASC`,
    [orgId]
  )
  return rows
}

export type SetValueResult =
  | { ok: true; fieldId: string; value: string }
  | { ok: false; code: 'field_not_found' | 'invalid_option' }

/**
 * Set a user's value for a field. For a 'select' field the value must be one of
 * the field's options (empty clears it).
 */
export async function setUserValue(
  pool: Pool,
  orgId: string,
  userId: string,
  fieldId: string,
  value: string
): Promise<SetValueResult> {
  const { rows } = await pool.query<{ field_type: ProfileFieldType; options: string[] }>(
    `SELECT field_type, options FROM aaelink.org_profile_fields WHERE id = $1 AND org_id = $2`,
    [fieldId, orgId]
  )
  const field = rows[0]
  if (!field) return { ok: false, code: 'field_not_found' }
  const v = String(value ?? '')
  if (field.field_type === 'select' && v !== '' && !field.options.includes(v)) {
    return { ok: false, code: 'invalid_option' }
  }

  await pool.query(
    `INSERT INTO aaelink.user_profile_values (field_id, user_id, value, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (field_id, user_id) DO UPDATE SET value = $3, updated_at = $4`,
    [fieldId, userId, v, Date.now()]
  )
  return { ok: true, fieldId, value: v }
}

export interface ProfileEntry {
  field_id: string
  field_key: string
  label: string
  field_type: ProfileFieldType
  options: string[]
  value: string
}

/** A user's custom profile: every org field with the user's value ('' when unset). */
export async function getUserProfile(pool: Pool, orgId: string, userId: string): Promise<ProfileEntry[]> {
  const { rows } = await pool.query<{
    field_id: string; field_key: string; label: string; field_type: ProfileFieldType
    options: string[]; value: string | null
  }>(
    `SELECT f.id AS field_id, f.field_key, f.label, f.field_type, f.options,
            v.value
       FROM aaelink.org_profile_fields f
       LEFT JOIN aaelink.user_profile_values v ON v.field_id = f.id AND v.user_id = $2
      WHERE f.org_id = $1
      ORDER BY f.position ASC, f.label ASC`,
    [orgId, userId]
  )
  return rows.map(r => ({
    field_id: r.field_id,
    field_key: r.field_key,
    label: r.label,
    field_type: r.field_type,
    options: r.options,
    value: r.value ?? '',
  }))
}
