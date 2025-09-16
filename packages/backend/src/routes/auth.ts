/**
 * AAELink Authentication Routes
 * WebAuthn (Passkeys) Implementation
 * BMAD Method: Security-first authentication
 */

import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type VerifiedAuthenticationResponse,
    type VerifiedRegistrationResponse
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { auditLogs, passkeys, users } from '../db/schema';
import { redis } from '../services/redis';
import { createSession, deleteSession } from '../services/session';

const authRouter = new Hono();

// Environment configuration
const RP_NAME = process.env.RP_NAME || 'AAELink';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000';

// Validation schemas
const RegisterOptionsSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
});

const RegisterVerifySchema = z.object({
  email: z.string().email(),
  displayName: z.string(),
  response: z.any(), // WebAuthn response object
});

const AuthOptionsSchema = z.object({
  email: z.string().email(),
});

const AuthVerifySchema = z.object({
  email: z.string().email(),
  response: z.any(), // WebAuthn response object
});

/**
 * POST /api/auth/webauthn/register/options
 * Generate registration options for WebAuthn
 */
authRouter.post('/webauthn/register/options', async (c) => {
  try {
    const body = await c.req.json();
    const { email, displayName } = RegisterOptionsSchema.parse(body);

    // Check if user exists
    const existingUser = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let user;
    if (existingUser.length === 0) {
      // Create new user
      const [newUser] = await db.insert(users)
        .values({
          email,
          displayName,
        })
        .returning();
      user = newUser;
    } else {
      user = existingUser[0];
    }

    // Get existing passkeys for exclude list
    const existingPasskeys = await db.select()
      .from(passkeys)
      .where(eq(passkeys.userId, user.id));

    // Generate registration options
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: user.id,
      userName: email,
      userDisplayName: displayName,
      attestationType: 'direct',
      excludeCredentials: existingPasskeys.map(key => ({
        id: Buffer.from(key.credId, 'base64'),
        type: 'public-key',
        transports: key.transports as any,
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        requireResidentKey: true,
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    // Store challenge in Redis with 5-minute TTL
    const challengeKey = `webauthn:register:${user.id}`;
    await redis.setex(challengeKey, 300, options.challenge);

    return c.json(options);
  } catch (error) {
    console.error('Registration options error:', error);
    return c.json({ error: 'Failed to generate registration options' }, 500);
  }
});

/**
 * POST /api/auth/webauthn/register/verify
 * Verify registration response and create passkey
 */
authRouter.post('/webauthn/register/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { email, response } = RegisterVerifySchema.parse(body);

    // Get user
    const [user] = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get challenge from Redis
    const challengeKey = `webauthn:register:${user.id}`;
    const expectedChallenge = await redis.get(challengeKey);

    if (!expectedChallenge) {
      return c.json({ error: 'Challenge expired or not found' }, 400);
    }

    // Verify registration
    const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      // Log failed attempt
      await db.insert(auditLogs).values({
        eventType: 'auth_failure',
        userId: user.id,
        targetType: 'passkey_registration',
        details: { reason: 'verification_failed' },
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
        traceId: c.get('traceId'),
      });

      return c.json({ error: 'Registration verification failed' }, 400);
    }

    const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;

    // Store passkey
    await db.insert(passkeys).values({
      userId: user.id,
      credId: Buffer.from(credentialID).toString('base64'),
      publicKey: Buffer.from(credentialPublicKey).toString('base64'),
      signCount: counter,
      transports: response.response.transports,
    });

    // Clear challenge
    await redis.del(challengeKey);

    // Create session
    const session = await createSession(user.id, {
      deviceId: response.id,
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
    await db.insert(auditLogs).values({
      eventType: 'auth_success',
      userId: user.id,
      targetType: 'passkey_registration',
      details: { credentialId: credentialID },
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
      traceId: c.get('traceId'),
    });

    return c.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    });
  } catch (error) {
    console.error('Registration verify error:', error);
    return c.json({ error: 'Registration verification failed' }, 500);
  }
});

/**
 * POST /api/auth/webauthn/authenticate/options
 * Generate authentication options
 */
authRouter.post('/webauthn/authenticate/options', async (c) => {
  try {
    const body = await c.req.json();
    const { email } = AuthOptionsSchema.parse(body);

    // Get user and their passkeys
    const [user] = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      // Don't reveal if user exists
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const userPasskeys = await db.select()
      .from(passkeys)
      .where(eq(passkeys.userId, user.id));

    if (userPasskeys.length === 0) {
      return c.json({ error: 'No passkeys registered' }, 400);
    }

    // Generate authentication options
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: userPasskeys.map(key => ({
        id: Buffer.from(key.credId, 'base64'),
        type: 'public-key',
        transports: key.transports as any,
      })),
      userVerification: 'required',
    });

    // Store challenge in Redis with 5-minute TTL
    const challengeKey = `webauthn:auth:${user.id}`;
    await redis.setex(challengeKey, 300, options.challenge);

    return c.json(options);
  } catch (error) {
    console.error('Authentication options error:', error);
    return c.json({ error: 'Failed to generate authentication options' }, 500);
  }
});

/**
 * POST /api/auth/webauthn/authenticate/verify
 * Verify authentication response
 */
authRouter.post('/webauthn/authenticate/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { email, response } = AuthVerifySchema.parse(body);

    // Get user
    const [user] = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Get challenge from Redis
    const challengeKey = `webauthn:auth:${user.id}`;
    const expectedChallenge = await redis.get(challengeKey);

    if (!expectedChallenge) {
      return c.json({ error: 'Challenge expired or not found' }, 400);
    }

    // Get the passkey used
    const credId = Buffer.from(response.rawId, 'base64').toString('base64');
    const [passkey] = await db.select()
      .from(passkeys)
      .where(eq(passkeys.credId, credId))
      .limit(1);

    if (!passkey) {
      return c.json({ error: 'Passkey not found' }, 401);
    }

    // Verify authentication
    const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialPublicKey: Buffer.from(passkey.publicKey, 'base64'),
        credentialID: Buffer.from(passkey.credId, 'base64'),
        counter: passkey.signCount,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      // Log failed attempt
      await db.insert(auditLogs).values({
        eventType: 'auth_failure',
        userId: user.id,
        targetType: 'passkey_authentication',
        details: { reason: 'verification_failed' },
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
        traceId: c.get('traceId'),
      });

      return c.json({ error: 'Authentication failed' }, 401);
    }

    // Update sign count
    await db.update(passkeys)
      .set({ signCount: verification.authenticationInfo.newCounter })
      .where(eq(passkeys.credId, credId));

    // Clear challenge
    await redis.del(challengeKey);

    // Create session
    const session = await createSession(user.id, {
      deviceId: response.id,
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

    // Log successful authentication
    await db.insert(auditLogs).values({
      eventType: 'auth_success',
      userId: user.id,
      targetType: 'passkey_authentication',
      details: { credentialId: credId },
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
      traceId: c.get('traceId'),
    });

    return c.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        locale: user.locale,
        theme: user.theme,
        seniorMode: user.seniorMode,
      },
    });
  } catch (error) {
    console.error('Authentication verify error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
});

/**
 * POST /api/auth/logout
 * Logout and destroy session
 */
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

/**
 * GET /api/auth/me
 * Get current user info
 */
authRouter.get('/me', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  return c.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    theme: user.theme,
    seniorMode: user.seniorMode,
    department: user.department,
    role: user.role,
  });
});

export { authRouter };
