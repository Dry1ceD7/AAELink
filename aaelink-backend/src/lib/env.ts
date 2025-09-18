import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgresql://aaelink:aaelink@localhost:5432/aaelink'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('your-super-secret-jwt-key-that-is-at-least-32-characters-long'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // MinIO/S3 Configuration
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
  MINIO_ACCESS_KEY: z.string().default('aaelink_admin'),
  MINIO_SECRET_KEY: z.string().default('aaelink_minio_2024'),
  MINIO_BUCKET: z.string().default('aaelink-files'),

  // External APIs
  GOOGLE_CALENDAR_CLIENT_ID: z.string().optional(),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional(),
  OUTLOOK_CLIENT_ID: z.string().optional(),
  OUTLOOK_CLIENT_SECRET: z.string().optional(),

  // Security
  ENCRYPTION_KEY: z.string().default('your-super-secret-encryption-key-that-is-at-least-32-characters-long'),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000), // 1 minute
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  // WebRTC
  TURN_SERVER_URL: z.string().optional(),
  TURN_SERVER_USERNAME: z.string().optional(),
  TURN_SERVER_CREDENTIAL: z.string().optional(),
})

export const env = envSchema.parse(process.env)
