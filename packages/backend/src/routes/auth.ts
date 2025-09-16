/**
 * AAELink Authentication Routes
 * Simplified Authentication Implementation
 * BMAD Method: Security-first authentication
 */

import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { users } from '../db/schema';
import { auditEvents } from '../middleware/audit';
import { createSession, deleteSession } from '../services/session';
import { hashPassword, verifyPassword } from '../utils/crypto';

const authRouter = new Hono();

// Input validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  displayName: z.string().min(3, 'Display name must be at least 3 characters long'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Registration endpoint
authRouter.post(
  '/register',
  zValidator('json', registerSchema),
  async (c) => {
    const { email, password, displayName } = c.req.valid('json');

    try {
      // Check if user exists
      const existingUser = await db.select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser.length > 0) {
        return c.json({ error: 'User already exists' }, 400);
      }

      // Create new user
      const [newUser] = await db.insert(users)
        .values({
          id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email,
          displayName,
          password: await hashPassword(password),
        })
        .returning();

      // Create session
      const session = await createSession(newUser.id, {
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      });

      // Set session cookie
      c.cookie('session', session.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });

      // Log successful registration
      auditEvents.register(c, newUser.id, email, true, 'Registration successful');

      return c.json({
        ok: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          displayName: newUser.displayName,
          role: newUser.role,
        },
      });
    } catch (error) {
      console.error('Registration error:', error);
      auditEvents.register(c, '', email, false, error.message);
      return c.json({ error: 'Registration failed' }, 500);
    }
  }
);

// Login endpoint
authRouter.post(
  '/login',
  zValidator('json', loginSchema),
  async (c) => {
    const { email, password } = c.req.valid('json');

    try {
      // Get user
      const [user] = await db.select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user || !user.password) {
        auditEvents.login(c, '', email, false, 'User not found');
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.password);
      if (!isValidPassword) {
        auditEvents.login(c, user.id, email, false, 'Invalid password');
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      // Create session
      const session = await createSession(user.id, {
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      });

      // Set session cookie
      c.cookie('session', session.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });

      // Log successful login
      auditEvents.login(c, user.id, email, true, 'Login successful');

      return c.json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          locale: user.locale,
          theme: user.theme,
          seniorMode: user.seniorMode,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      auditEvents.login(c, '', email, false, error.message);
      return c.json({ error: 'Login failed' }, 500);
    }
  }
);

// Logout endpoint
authRouter.post('/logout', async (c) => {
  const sessionId = c.req.cookie('session');

  if (sessionId) {
    await deleteSession(sessionId);

    // Clear session cookie
    c.cookie('session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
  }

  return c.json({ ok: true });
});

// Get current user
authRouter.get('/me', async (c) => {
  const sessionId = c.req.cookie('session');
  
  if (!sessionId) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  try {
    const { getSession } = await import('../services/session');
    const session = await getSession(sessionId);
    
    if (!session) {
      return c.json({ error: 'Session expired' }, 401);
    }

    const [user] = await db.select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      locale: user.locale,
      theme: user.theme,
      seniorMode: user.seniorMode,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

export { authRouter };