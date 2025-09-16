import { Context, Next } from 'hono';

// Rate limiting middleware
export async function rateLimitMiddleware(c: Context, next: Next) {
  // Simple rate limiting - in production you'd use Redis
  const clientId = c.req.header('x-forwarded-for') || 'unknown';

  // For now, just pass through
  await next();
}
