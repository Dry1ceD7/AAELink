import { Context, Next } from 'hono';

// Audit logging middleware
export async function auditMiddleware(c: Context, next: Next) {
  const start = Date.now();

  // Log the request
  console.log(`[AUDIT] ${c.req.method} ${c.req.url} - ${new Date().toISOString()}`);

  await next();

  const duration = Date.now() - start;
  console.log(`[AUDIT] ${c.req.method} ${c.req.url} - ${c.res.status} - ${duration}ms`);
}

// Audit events helper
export const auditEvents = {
  register: (c: Context, userId: string, email: string, success: boolean, details: string) => {
    console.log(`[AUDIT] Registration attempt - User: ${userId}, Email: ${email}, Success: ${success}, Details: ${details}`);
  },
  login: (c: Context, userId: string, email: string, success: boolean, details: string) => {
    console.log(`[AUDIT] Login attempt - User: ${userId}, Email: ${email}, Success: ${success}, Details: ${details}`);
  },
  logout: (c: Context, userId: string) => {
    console.log(`[AUDIT] Logout - User: ${userId}`);
  }
};
