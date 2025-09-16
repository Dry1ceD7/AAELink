/**
 * OpenAPI Schemas for Database Models
 * Defines Zod schemas for generating OpenAPI documentation.
 */

import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { channels, files, messages, organizations, users } from '../schema';

// Base Schemas
export const UserSchema = createSelectSchema(users, {
  // Exclude sensitive fields
  password: z.undefined(),
  emailVerificationToken: z.undefined(),
  passwordResetToken: z.undefined(),
}).openapi('User', {
  description: 'A user object representing a platform user.',
  example: {
    id: 'user_123',
    email: 'user@example.com',
    displayName: 'John Doe',
    role: 'member',
    organizationId: 'org_123',
    isEmailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
});

export const OrganizationSchema = createSelectSchema(organizations).openapi('Organization', {
  description: 'An organization or workspace within the platform.',
});

export const ChannelSchema = createSelectSchema(channels).openapi('Channel', {
  description: 'A communication channel within an organization.',
});

export const MessageSchema = createSelectSchema(messages).openapi('Message', {
  description: 'A message within a channel.',
});

export const FileSchema = createSelectSchema(files).openapi('File', {
  description: 'A file uploaded to the platform.',
});

// Common Schemas
export const ErrorSchema = z.object({
  error: z.string().openapi({
    description: 'A short error message.',
    example: 'Internal server error',
  }),
  traceId: z.string().optional().openapi({
    description: 'A unique identifier for tracing the request.',
    example: 'trace_123',
  }),
  details: z.any().optional().openapi({
    description: 'Additional error details.',
  }),
}).openapi('Error', {
  description: 'Standard error response.',
});

export const SuccessSchema = z.object({
  success: z.boolean().openapi({
    description: 'Indicates if the operation was successful.',
    example: true,
  }),
  message: z.string().optional().openapi({
    description: 'A success message.',
    example: 'Operation completed successfully.',
  }),
}).openapi('Success', {
  description: 'Standard success response.',
});

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number().int().positive().openapi({
      description: 'The current page number.',
      example: 1,
    }),
    limit: z.number().int().positive().openapi({
      description: 'The number of items per page.',
      example: 25,
    }),
    total: z.number().int().openapi({
      description: 'The total number of items.',
      example: 100,
    }),
    hasNextPage: z.boolean().openapi({
      description: 'Indicates if there is a next page.',
      example: true,
    }),
  }).openapi('PaginatedResponse');

// Query Parameter Schemas
export const PaginationQuerySchema = z.object({
  page: z.string().optional().default('1').openapi({
    description: 'Page number for pagination.',
    example: '1',
  }),
  limit: z.string().optional().default('25').openapi({
    description: 'Number of items per page.',
    example: '25',
  }),
});
