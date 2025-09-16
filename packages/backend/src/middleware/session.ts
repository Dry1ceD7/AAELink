/**
 * Session Middleware
 * Secure session management with Redis
 */

import { eq } from 'drizzle-orm';
import { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { users } from '../db/schema';
import { redis } from '../services/redis';

export interface Session {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: number;
  expiresAt: number;
}

// Extend Hono context
declare module 'hono' {
  interface ContextVariableMap {
    session?: Session;
    user?: any;
  }
}

const SESSION_COOKIE_NAME = '__Host-session';
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Create a new session
 */
export async function createSession(userId: string): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = Date.now() + SESSION_DURATION;

  // Get user data
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  const session: Session = {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: Date.now(),
    expiresAt,
  };

  // Store in Redis with expiration
  await redis.setex(
    `session:${sessionId}`,
    Math.floor(SESSION_DURATION / 1000),
    JSON.stringify(session)
  );

  // Track active sessions for user
  await redis.sadd(`user_sessions:${userId}`, sessionId);
  await redis.expire(`user_sessions:${userId}`, Math.floor(SESSION_DURATION / 1000));

  return sessionId;
}

/**
 * Validate session
 */
export async function validateSession(sessionId: string): Promise<Session | null> {
  if (!sessionId) return null;

  try {
    const sessionData = await redis.get(`session:${sessionId}`);
    if (!sessionData) return null;

    const session: Session = JSON.parse(sessionData);

    // Check expiration
    if (session.expiresAt < Date.now()) {
      await deleteSession(sessionId);
      return null;
    }

    return session;
  } catch (error) {
    console.error('Session validation error:', error);
    return null;
  }
}

/**
 * Delete session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    // Get session to find userId
    const sessionData = await redis.get(`session:${sessionId}`);
    if (sessionData) {
      const session: Session = JSON.parse(sessionData);
      await redis.srem(`user_sessions:${session.userId}`, sessionId);
    }

    // Delete session
    await redis.del(`session:${sessionId}`);
  } catch (error) {
    console.error('Session deletion error:', error);
  }
}

/**
 * Delete all sessions for a user
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  try {
    const sessionIds = await redis.smembers(`user_sessions:${userId}`);

    if (sessionIds.length > 0) {
      // Delete all sessions
      const pipeline = redis.pipeline();
      sessionIds.forEach(sessionId => {
        pipeline.del(`session:${sessionId}`);
      });
      await pipeline.exec();
    }

    // Delete user sessions set
    await redis.del(`user_sessions:${userId}`);
  } catch (error) {
    console.error('User sessions deletion error:', error);
  }
}

/**
 * Generate secure session ID
 */
function generateSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Session middleware
 */
export const sessionMiddleware = () => {
  return createMiddleware(async (c: Context, next: Next) => {
    const sessionId = getCookie(c, SESSION_COOKIE_NAME);

    if (sessionId) {
      const session = await validateSession(sessionId);
      if (session) {
        c.set('session', session);

        // Optionally load full user data
        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);

          if (user) {
            c.set('user', user);
          }
        } catch (error) {
          console.error('Failed to load user:', error);
        }
      }
    }

    await next();
  });
};

/**
 * Require authentication middleware
 */
export const requireAuth = () => {
  return createMiddleware(async (c: Context, next: Next) => {
    const session = c.get('session');

    if (!session) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    await next();
  });
};

/**
 * Require specific role middleware
 */
export const requireRole = (roles: string | string[]) => {
  return createMiddleware(async (c: Context, next: Next) => {
    const session = c.get('session');

    if (!session) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    if (!allowedRoles.includes(session.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    await next();
  });
};

/**
 * Set session cookie
 */
export function setSessionCookie(c: Context, sessionId: string): void {
  const isProduction = process.env.NODE_ENV === 'production';

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Lax',
    maxAge: Math.floor(SESSION_DURATION / 1000),
    path: '/',
  });
}

/**
 * Clear session cookie
 */
export function clearSessionCookie(c: Context): void {
  setCookie(c, SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 0,
    path: '/',
  });
}

// Helper functions (simplified implementations)
function getCookie(c: Context, name: string): string | undefined {
  const cookieHeader = c.req.header('Cookie');
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  return cookies[name];
}

function setCookie(c: Context, name: string, value: string, options: any): void {
  let cookieString = `${name}=${value}`;

  if (options.maxAge) cookieString += `; Max-Age=${options.maxAge}`;
  if (options.path) cookieString += `; Path=${options.path}`;
  if (options.httpOnly) cookieString += '; HttpOnly';
  if (options.secure) cookieString += '; Secure';
  if (options.sameSite) cookieString += `; SameSite=${options.sameSite}`;

  c.header('Set-Cookie', cookieString);
}
