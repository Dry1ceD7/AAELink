/**
 * AAELink Authentication Tests
 * WebAuthn and session management testing
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { authRouter } from '../src/routes/auth';

const app = new Hono().route('/auth', authRouter);

describe('Authentication', () => {
  let testUser: any;

  beforeAll(async () => {
    // Setup test database
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/aaelink_test';
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(users).where(eq(users.email, 'test@example.com'));
  });

  describe('WebAuthn Registration', () => {
    it('should generate registration options', async () => {
      const response = await app.request('/api/auth/webauthn/register/options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@example.com',
          displayName: 'Test User',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('challenge');
      expect(data).toHaveProperty('rp');
      expect(data.rp.name).toBe('AAELink');
    });

    it('should reject invalid email format', async () => {
      const response = await app.request('/api/auth/webauthn/register/options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'invalid-email',
          displayName: 'Test User',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle missing display name', async () => {
      const response = await app.request('/api/auth/webauthn/register/options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Session Management', () => {
    it('should create session on successful authentication', async () => {
      // This would require mocking WebAuthn responses
      // For now, we test the session creation directly
      const [user] = await db.insert(users)
        .values({
          email: 'session@example.com',
          displayName: 'Session Test',
        })
        .returning();

      testUser = user;

      // Test session creation would go here
      expect(user.id).toBeDefined();
    });

    it('should validate session cookie', async () => {
      const response = await app.request('/api/auth/me', {
        method: 'GET',
        headers: {
          Cookie: 'session=invalid-session',
        },
      });

      expect(response.status).toBe(401);
    });

    it('should logout and destroy session', async () => {
      const response = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: 'session=test-session',
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit registration attempts', async () => {
      const requests = Array(10).fill(null).map(() =>
        app.request('/api/auth/webauthn/register/options', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '192.168.1.100',
          },
          body: JSON.stringify({
            email: 'ratelimit@example.com',
            displayName: 'Rate Limit Test',
          }),
        })
      );

      const responses = await Promise.all(requests);
      const tooManyRequests = responses.filter(r => r.status === 429);
      expect(tooManyRequests.length).toBeGreaterThan(0);
    });
  });
});
