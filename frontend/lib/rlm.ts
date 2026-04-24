type RetryCategory = 'network' | 'http' | 'unknown'

export interface RlmPolicy {
  enabled: boolean
  maxDepth: number
  baseDelayMs: number
  maxDelayMs: number
  retryableHttpStatuses: number[]
}

export interface RlmDecision {
  depth: number
  retry: boolean
  reason: string
  delayMs: number
  category: RetryCategory
}

export interface RlmOptions {
  operation: string
}

const DEFAULT_POLICY: RlmPolicy = {
  enabled: true,
  maxDepth: 3,
  baseDelayMs: 120,
  maxDelayMs: 1500,
  retryableHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function jitteredDelay(base: number, depth: number, maxDelayMs: number): number {
  const exponential = Math.min(base * 2 ** depth, maxDelayMs)
  const jitter = Math.floor(Math.random() * Math.max(10, exponential * 0.2))
  return Math.min(exponential + jitter, maxDelayMs)
}

function statusFromError(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const maybeStatus = (err as { status?: unknown }).status
  if (typeof maybeStatus !== 'number') return null
  return maybeStatus
}

function classifyError(err: unknown): RetryCategory {
  const status = statusFromError(err)
  if (typeof status === 'number') return 'http'
  if (err instanceof TypeError) return 'network'
  return 'unknown'
}

function shouldRetry(
  err: unknown,
  depth: number,
  policy: RlmPolicy,
): RlmDecision {
  if (!policy.enabled) {
    return {
      depth,
      retry: false,
      reason: 'disabled',
      delayMs: 0,
      category: 'unknown',
    }
  }

  if (depth >= policy.maxDepth) {
    return {
      depth,
      retry: false,
      reason: 'max-depth-reached',
      delayMs: 0,
      category: classifyError(err),
    }
  }

  const category = classifyError(err)
  const status = statusFromError(err)

  if (category === 'network') {
    return {
      depth,
      retry: true,
      reason: 'network-error',
      delayMs: jitteredDelay(policy.baseDelayMs, depth, policy.maxDelayMs),
      category,
    }
  }

  if (typeof status === 'number' && policy.retryableHttpStatuses.includes(status)) {
    return {
      depth,
      retry: true,
      reason: `retryable-http-${status}`,
      delayMs: jitteredDelay(policy.baseDelayMs, depth, policy.maxDelayMs),
      category,
    }
  }

  return {
    depth,
    retry: false,
    reason: status ? `non-retryable-http-${status}` : 'non-retryable-error',
    delayMs: 0,
    category,
  }
}

export async function executeWithRlm<T>(
  fn: () => Promise<T>,
  options: RlmOptions,
  policy: Partial<RlmPolicy> = {},
): Promise<T> {
  const effective: RlmPolicy = { ...DEFAULT_POLICY, ...policy }
  const trace: RlmDecision[] = []

  const run = async (depth: number): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      const decision = shouldRetry(err, depth, effective)
      trace.push(decision)
      if (!decision.retry) {
        if (err && typeof err === 'object') {
          ; (err as { rlmTrace?: RlmDecision[] }).rlmTrace = trace
            ; (err as { rlmOperation?: string }).rlmOperation = options.operation
        }
        throw err
      }
      await wait(decision.delayMs)
      return run(depth + 1)
    }
  }

  return run(0)
}
