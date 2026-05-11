/**
 * Template Engine — resolves Mustache-style {{placeholders}} in document content
 * using client profile data and custom variable maps.
 *
 * Supports:
 * - {{client.name}}, {{client.address_line1}}, etc.
 * - {{date}}, {{date.short}}, {{date.iso}}, {{date:YYYY-MM-DD:field}}
 * - {{custom.field_name}}
 * - Nested property access via dot notation
 * - {{#if key}}...{{/if}} conditional blocks
 * - {{#each key}}...{{/each}} loop blocks
 * - {{upper:field}}, {{lower:field}}, {{title:field}} transforms
 * - {{currency:field}}, {{currency_thb:field}}, {{number:field}} number transforms
 * - Batch find & replace across text content
 */

export interface TemplateContext {
  client?: {
    name?: string
    code?: string
    logo_url?: string
    address_line1?: string
    address_line2?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
    phone?: string
    email?: string
    website?: string
    legal_boilerplate?: string
    tax_id?: string
    [key: string]: unknown
  }
  user?: {
    username?: string
    first_name?: string
    last_name?: string
    email?: string
    job_title?: string
    phone?: string
  }
  ticket?: {
    id?: string
    title?: string
    status?: string
    priority?: string
    category?: string
  }
  custom?: Record<string, string | number | boolean>
  [key: string]: unknown
}

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g

// ── Transform helpers ───────────────────────────────────────────────────────

const TRANSFORM_NAMES = ['upper', 'lower', 'title', 'trim', 'currency', 'currency_thb', 'number'] as const

function applyTransform(transform: string, value: string): string {
  switch (transform.toLowerCase()) {
    case 'upper': return value.toUpperCase()
    case 'lower': return value.toLowerCase()
    case 'title': return value.replace(/\b\w/g, c => c.toUpperCase())
    case 'trim': return value.trim()
    case 'currency': {
      const num = parseFloat(value)
      return isNaN(num) ? value : num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    }
    case 'currency_thb': {
      const num = parseFloat(value)
      return isNaN(num) ? value : num.toLocaleString('th-TH', { style: 'currency', currency: 'THB' })
    }
    case 'number': {
      const num = parseFloat(value)
      return isNaN(num) ? value : num.toLocaleString('en-US')
    }
    default: return value
  }
}

function formatDate(value: string, format: string): string {
  try {
    const d = new Date(value)
    if (isNaN(d.getTime())) return value
    const pad = (n: number) => String(n).padStart(2, '0')
    const replacements: Record<string, string> = {
      'YYYY': String(d.getFullYear()),
      'YY': String(d.getFullYear()).slice(-2),
      'MM': pad(d.getMonth() + 1),
      'DD': pad(d.getDate()),
      'HH': pad(d.getHours()),
      'mm': pad(d.getMinutes()),
      'ss': pad(d.getSeconds()),
    }
    let result = format
    for (const [token, replacement] of Object.entries(replacements)) {
      result = result.replace(new RegExp(token, 'g'), replacement)
    }
    return result
  } catch {
    return value
  }
}

/**
 * Resolve a dot-separated path against the context object.
 * E.g., "client.name" → context.client.name
 */
function resolvePath(ctx: Record<string, unknown>, path: string): string {
  const parts = path.trim().split('.')
  let current: unknown = ctx

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[part]
  }

  if (current == null) return ''
  return String(current)
}

/** Built-in date variables. */
function getDateVars(): Record<string, string> {
  const now = new Date()
  return {
    'date': now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    'date.short': now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    'date.iso': now.toISOString().slice(0, 10),
    'date.year': String(now.getFullYear()),
    'date.month': now.toLocaleDateString('en-US', { month: 'long' }),
    'date.day': String(now.getDate()),
    'time': now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    'timestamp': String(Date.now()),
  }
}

// ── Block processors ────────────────────────────────────────────────────────

/** Process {{#if key}}...{{/if}} conditional blocks. */
function processConditionals(text: string, ctx: Record<string, unknown>): string {
  return text.replace(
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, key: string, body: string) => {
      const value = resolvePath(ctx, key.trim())
      const truthy = value !== '' && value !== 'false' && value !== '0' && value !== 'undefined' && value !== 'null'
      return truthy ? body : ''
    }
  )
}

/** Process {{#each key}}...{{/each}} loop blocks. */
function processLoops(text: string, ctx: Record<string, unknown>): string {
  return text.replace(
    /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key: string, body: string) => {
      const rawValue = resolvePath(ctx, key.trim())
      if (!rawValue) return ''

      let items: unknown[]
      try {
        items = JSON.parse(rawValue)
        if (!Array.isArray(items)) return ''
      } catch {
        return ''
      }

      return items.map((item, index) => {
        let rendered = body
        rendered = rendered.replace(/\{\{this\}\}/g, String(item))
        rendered = rendered.replace(/\{\{@index\}\}/g, String(index))
        rendered = rendered.replace(/\{\{@number\}\}/g, String(index + 1))

        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>
          rendered = rendered.replace(/\{\{([^#/}][^}]*)\}\}/g, (_m, expr: string) => {
            const val = obj[expr.trim()]
            return val !== undefined && val !== null ? String(val) : `{{${expr}}}`
          })
        }

        return rendered
      }).join('')
    }
  )
}

// ── Main resolver ───────────────────────────────────────────────────────────

/**
 * Replace all {{placeholder}} tokens in text with values from context.
 * Now supports conditionals, loops, transforms, and date formatting.
 */
export function resolveTemplate(text: string, context: TemplateContext): string {
  const dateVars = getDateVars()
  const flatContext: Record<string, unknown> = {
    ...context,
    ...dateVars,
  }

  // 1. Process conditional blocks
  let result = processConditionals(text, flatContext)

  // 2. Process loop blocks
  result = processLoops(result, flatContext)

  // 3. Process variable replacements (with transforms and date formatting)
  result = result.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const trimmed = key.trim()

    // Direct date variables
    if (dateVars[trimmed] !== undefined) return dateVars[trimmed]

    // Date formatting: {{date:YYYY-MM-DD:field_name}}
    if (trimmed.startsWith('date:')) {
      const parts = trimmed.split(':')
      if (parts.length >= 3) {
        const format = parts[1]
        const fieldKey = parts.slice(2).join(':')
        const value = resolvePath(flatContext, fieldKey)
        return value ? formatDate(value, format) : `{{${trimmed}}}`
      }
      // date:FORMAT — use current date
      if (parts.length === 2) {
        return formatDate(new Date().toISOString(), parts[1])
      }
    }

    // Transforms: {{upper:field_name}}, {{currency:field_name}}
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      const transform = trimmed.slice(0, colonIdx)
      const fieldKey = trimmed.slice(colonIdx + 1)
      if ((TRANSFORM_NAMES as readonly string[]).includes(transform.toLowerCase())) {
        const value = resolvePath(flatContext, fieldKey)
        return value ? applyTransform(transform, value) : `{{${trimmed}}}`
      }
    }

    // Resolve from context using dot notation
    return resolvePath(flatContext, trimmed) || `{{${trimmed}}}`
  })

  return result
}

/**
 * Extract all {{placeholder}} keys from a template string.
 */
export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>()
  let match: RegExpExecArray | null
  const re = new RegExp(PLACEHOLDER_RE.source, 'g')
  while ((match = re.exec(text)) !== null) {
    const key = match[1].trim()
    // Skip block markers
    if (key.startsWith('#') || key.startsWith('/')) continue

    // For transforms/date, extract the field key
    if (key.startsWith('date:')) {
      const parts = key.split(':')
      if (parts.length >= 3) found.add(parts.slice(2).join(':'))
      continue
    }
    const colonIdx = key.indexOf(':')
    if (colonIdx > 0) {
      const transform = key.slice(0, colonIdx)
      if ((TRANSFORM_NAMES as readonly string[]).includes(transform.toLowerCase())) {
        found.add(key.slice(colonIdx + 1))
        continue
      }
    }

    found.add(key)
  }
  return Array.from(found)
}

/**
 * Build a full client address string from profile fields.
 */
export function buildFullAddress(client: TemplateContext['client']): string {
  if (!client) return ''
  const parts = [
    client.address_line1,
    client.address_line2,
    [client.city, client.state].filter(Boolean).join(', '),
    client.postal_code,
    client.country,
  ].filter(Boolean)
  return parts.join('\n')
}

// ── Batch Find & Replace ────────────────────────────────────────────────────

export interface FindReplaceRule {
  find: string
  replace: string
  case_sensitive?: boolean
  whole_word?: boolean
}

/**
 * Apply multiple find & replace rules to text content.
 * Format-preserving: only replaces exact matches without touching surrounding content.
 */
export function batchFindReplace(text: string, rules: FindReplaceRule[]): string {
  let result = text

  for (const rule of rules) {
    if (!rule.find) continue

    // Escape special regex chars in the search string
    const escaped = rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Build regex
    let pattern: string
    if (rule.whole_word) {
      pattern = `\\b${escaped}\\b`
    } else {
      pattern = escaped
    }

    const flags = rule.case_sensitive ? 'g' : 'gi'
    const re = new RegExp(pattern, flags)
    result = result.replace(re, rule.replace)
  }

  return result
}

/**
 * Build a TemplateContext from a client profile database row.
 */
export function contextFromClientProfile(profile: Record<string, unknown>): TemplateContext {
  return {
    client: {
      name: String(profile.name || ''),
      code: String(profile.code || ''),
      logo_url: String(profile.logo_url || ''),
      address_line1: String(profile.address_line1 || ''),
      address_line2: String(profile.address_line2 || ''),
      city: String(profile.city || ''),
      state: String(profile.state || ''),
      postal_code: String(profile.postal_code || ''),
      country: String(profile.country || ''),
      phone: String(profile.phone || ''),
      email: String(profile.email || ''),
      website: String(profile.website || ''),
      legal_boilerplate: String(profile.legal_boilerplate || ''),
      tax_id: String(profile.tax_id || ''),
      ...(typeof profile.metadata === 'object' && profile.metadata !== null ? (profile.metadata as Record<string, unknown>) : {}),
    },
    // Flat client_ prefixed fields for convenience
    client_name: String(profile.name || ''),
    client_code: String(profile.code || ''),
    client_email: String(profile.email || ''),
    client_phone: String(profile.phone || ''),
    client_tax_id: String(profile.tax_id || ''),
    client_website: String(profile.website || ''),
    client_address: [
      profile.address_line1, profile.address_line2, profile.city,
      profile.state, profile.postal_code, profile.country,
    ].filter(Boolean).join(', '),
  }
}

/**
 * Validate that all required placeholders in a template have values in the context.
 * Returns an array of missing placeholder keys.
 */
export function validatePlaceholders(
  placeholders: string[],
  context: TemplateContext,
  required?: string[]
): string[] {
  const dateVars = getDateVars()
  const flatContext: Record<string, unknown> = { ...context, ...dateVars }
  const checkList = required || placeholders

  return checkList.filter(key => {
    if (dateVars[key] !== undefined) return false
    const val = resolvePath(flatContext, key)
    return !val
  })
}
