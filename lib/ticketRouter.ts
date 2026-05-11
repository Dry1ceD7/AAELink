import type { Pool } from 'pg'
import type { TicketCategory, TicketPriority } from './slaEngine'

/**
 * Ticket Routing Engine — automated department assignment based on
 * category, keywords, client ID, and workload balancing.
 */

// ── Keyword → Category mapping ──────────────────────────────────────────────

const KEYWORD_RULES: { keywords: string[]; category: TicketCategory }[] = [
  {
    keywords: ['password', 'reset', 'login', 'access', 'vpn', 'computer', 'laptop', 'printer',
               'software', 'install', 'network', 'wifi', 'email setup', 'account locked'],
    category: 'it_support',
  },
  {
    keywords: ['leave', 'vacation', 'pto', 'sick', 'onboarding', 'offboarding', 'benefits',
               'payroll', 'salary', 'promotion', 'transfer', 'resignation'],
    category: 'hr',
  },
  {
    keywords: ['invoice', 'payment', 'reimbursement', 'expense', 'budget', 'purchase order',
               'billing', 'tax', 'receipt', 'refund', 'accounts payable'],
    category: 'finance',
  },
  {
    keywords: ['proposal', 'quote', 'client', 'deal', 'contract', 'renewal', 'upsell',
               'demo', 'trial', 'pricing', 'license', 'subscription'],
    category: 'sales',
  },
  {
    keywords: ['office', 'desk', 'chair', 'room', 'building', 'parking', 'cleaning',
               'maintenance', 'hvac', 'lights', 'facility', 'key card', 'door'],
    category: 'facilities',
  },
  {
    keywords: ['breach', 'phishing', 'malware', 'virus', 'suspicious', 'hack', 'unauthorized',
               'security', 'vulnerability', 'data leak', 'incident', 'compliance'],
    category: 'security',
  },
]

// ── Category → Department code mapping ──────────────────────────────────────

const CATEGORY_DEPT_MAP: Record<string, string> = {
  it_support: 'it',
  hr: 'hr',
  finance: 'finance',
  sales: 'sales',
  facilities: 'operations',
  security: 'it',
  general: 'it', // Default fallback
}

/**
 * Detect category from ticket title and description using keyword matching.
 * Returns the best matching category or 'general' if no match.
 */
export function detectCategory(title: string, description: string): TicketCategory {
  const text = `${title} ${description}`.toLowerCase()

  let bestMatch: TicketCategory = 'general'
  let bestScore = 0

  for (const rule of KEYWORD_RULES) {
    let score = 0
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) {
        score++
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestMatch = rule.category
    }
  }

  return bestMatch
}

/**
 * Auto-detect priority based on keywords in the text.
 */
export function detectPriority(title: string, description: string): TicketPriority | null {
  const text = `${title} ${description}`.toLowerCase()

  const criticalKeywords = ['urgent', 'emergency', 'critical', 'down', 'outage', 'breach', 'data loss', 'production down']
  const highKeywords = ['important', 'high priority', 'asap', 'blocking', 'cannot work', 'broken']

  for (const kw of criticalKeywords) {
    if (text.includes(kw)) return 'critical'
  }
  for (const kw of highKeywords) {
    if (text.includes(kw)) return 'high'
  }

  return null // Let caller decide default
}

/**
 * Find the department ID for a given category within a workspace.
 */
export async function findDepartmentForCategory(
  pool: Pool,
  workspaceId: string,
  category: TicketCategory
): Promise<string | null> {
  const deptCode = CATEGORY_DEPT_MAP[category] || 'it'
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.departments WHERE workspace_id = $1 AND code = $2 LIMIT 1`,
    [workspaceId, deptCode]
  )
  return rows[0]?.id ?? null
}

/**
 * Find the least-loaded agent in a department for workload-based routing.
 *
 * "Least-loaded" = fewest open/in-progress tickets assigned.
 */
export async function findLeastLoadedAgent(
  pool: Pool,
  workspaceId: string,
  departmentId: string
): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string; ticket_count: number }>(`
    SELECT m.user_id,
           COALESCE(
             (SELECT COUNT(*)::int FROM aaelink.tickets t
              WHERE t.assignee_id = m.user_id
                AND t.workspace_id = $1
                AND t.status IN ('open', 'pending', 'in_progress')),
           0) AS ticket_count
    FROM aaelink.workspace_members m
    WHERE m.workspace_id = $1 AND m.department_id = $2
    ORDER BY ticket_count ASC, RANDOM()
    LIMIT 1
  `, [workspaceId, departmentId])

  return rows[0]?.user_id ?? null
}

/**
 * Full auto-routing: detect category → find department → assign least-loaded agent.
 */
export async function autoRouteTicket(
  pool: Pool,
  workspaceId: string,
  title: string,
  description: string,
  explicitCategory?: TicketCategory
): Promise<{
  category: TicketCategory
  departmentId: string | null
  assigneeId: string | null
  autoDetected: boolean
}> {
  const category = explicitCategory || detectCategory(title, description)
  const autoDetected = !explicitCategory

  const departmentId = await findDepartmentForCategory(pool, workspaceId, category)

  let assigneeId: string | null = null
  if (departmentId) {
    assigneeId = await findLeastLoadedAgent(pool, workspaceId, departmentId)
  }

  return { category, departmentId, assigneeId, autoDetected }
}
