/**
 * OpenAPI Schemas for Authentication Routes
 * Defines Zod schemas for login, registration, and other auth endpoints.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ErrorSchema, SuccessSchema, UserSchema } from '../db/schema.openapi';

// Schemas
export const RegisterRequestSchema = z.object({
  email: z.string().email().openapi({
    description: 'User email address for registration.',
    example: 'newuser@example.com',
  }),
  password: z.string().min(8).openapi({
    description: 'User password (at least 8 characters).',
    example: 'strongpassword123',
  }),
  displayName: z.string().min(3).openapi({
    description: 'User display name.',
    example: 'New User',
  }),
}).openapi('RegisterRequest');

export const RegisterResponseSchema = z.object({
  user: UserSchema,
}).openapi('RegisterResponse');

export const LoginRequestSchema = z.object({
  email: z.string().email().openapi({
    description: 'User email address for login.',
    example: 'user@example.com',
  }),
  password: z.string().openapi({
    description: 'User password.',
    example: 'password123',
  }),
}).openapi('LoginRequest');

export const LoginResponseSchema = z.object({
  user: UserSchema,
  token: z.string().openapi({
    description: 'Session token (sent via secure, httpOnly cookie).',
  }),
}).openapi('LoginResponse');

export const AuthErrorSchema = ErrorSchema.extend({
  error: z.string().openapi({
    example: 'Invalid credentials',
  }),
}).openapi('AuthError');

// Routes
const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  summary: 'Register a new user',
  description: 'Creates a new user account and organization.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: RegisterRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'User registered successfully',
      content: {
        'application/json': {
          schema: RegisterResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: 'User already exists',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  summary: 'Log in a user',
  description: 'Authenticates a user and returns a session.',
  tags: ['Auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: LoginResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid credentials',
      content: {
        'application/json': {
          schema: AuthErrorSchema,
        },
      },
    },
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  summary: 'Log out a user',
  description: 'Invalidates the current user session.',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Logout successful',
      content: {
        'application/json': {
          schema: SuccessSchema,
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
  security: [
    {
      cookieAuth: [],
    },
  ],
});

const getSessionRoute = createRoute({
  method: 'get',
  path: '/session',
  summary: 'Get current session',
  description: 'Returns the current authenticated user session.',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Session found',
      content: {
        'application/json': {
          schema: UserSchema,
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
  security: [
    {
      cookieAuth: [],
    },
  ],
});


// Export all routes for the auth router
export const authRoutes = new OpenAPIHono()
  .openapi(registerRoute, (c) => {
    // Mock implementation
    return c.json({ user: UserSchema.parse({}) }, 201);
  })
  .openapi(loginRoute, (c) => {
    // Mock implementation
    return c.json({ user: UserSchema.parse({}), token: 'mock-token' });
  })
  .openapi(logoutRoute, (c) => {
    // Mock implementation
    return c.json({ success: true });
  })
  .openapi(getSessionRoute, (c) => {
    // Mock implementation
    return c.json(UserSchema.parse({}));
  });
