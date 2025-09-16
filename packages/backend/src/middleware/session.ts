import { Context, Next } from 'hono';

// Session management middleware
export async function sessionMiddleware(c: Context, next: Next) {
  try {
    // Simple session handling - in production you'd use Redis
    const sessionId = c.req.header('x-session-id') || 'anonymous';

    // Set session info in context
    c.set('sessionId', sessionId);
    c.set('userId', 'user-123'); // Mock user ID

    await next();
  } catch (error) {
    console.error('Session middleware error:', error);
    await next();
  }
}
