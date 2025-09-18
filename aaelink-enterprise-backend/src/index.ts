import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { createServer } from 'http';
import { Redis } from 'ioredis';
import { Server as SocketIOServer } from 'socket.io';
import { logger } from './lib/logger';
import { MinioClient } from './lib/minio';
import { websocketHandler } from './lib/websocket';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { calendarRoutes } from './routes/calendar';
import { chatRoutes } from './routes/chat';
import { erpRoutes } from './routes/erp';
import { fileRoutes } from './routes/files';
import { searchRoutes } from './routes/search';
import { userRoutes } from './routes/users';

// Initialize Prisma
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// Initialize Redis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
});

// Initialize MinIO
const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'aaelink_admin',
  secretKey: process.env.MINIO_SECRET_KEY || 'aaelink_minio_2024',
});

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    } : undefined,
  },
  trustProxy: true,
});

// Create HTTP server for Socket.IO
const httpServer = createServer();
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Register plugins
async function registerPlugins() {
  // CORS
  await fastify.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Security
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis,
  });

  // JWT
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'aaelink_jwt_secret_2024',
    sign: {
      expiresIn: '24h',
    },
  });

  // WebSocket
  await fastify.register(websocket);

  // Swagger documentation
  await fastify.register(swagger, {
    swagger: {
      info: {
        title: 'AAELink Enterprise API',
        description: 'Advanced ID Asia Engineering Co.,Ltd - Enterprise Workspace API',
        version: '1.2.0',
      },
      host: process.env.API_HOST || 'localhost:3000',
      schemes: ['http', 'https'],
      consumes: ['application/json'],
      produces: ['application/json'],
      securityDefinitions: {
        bearerAuth: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'full',
      deepLinking: false,
    },
    uiHooks: {
      onRequest: function (request, reply, next) {
        next();
      },
      preHandler: function (request, reply, next) {
        next();
      },
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (swaggerObject, request, reply) => {
      return swaggerObject;
    },
    transformSpecificationClone: true,
  });
}

// Register routes
async function registerRoutes() {
  // Health check
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.2.0',
      environment: process.env.NODE_ENV || 'development',
    };
  });

  // API routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(chatRoutes, { prefix: '/api/chat' });
  await fastify.register(calendarRoutes, { prefix: '/api/calendar' });
  await fastify.register(fileRoutes, { prefix: '/api/files' });
  await fastify.register(searchRoutes, { prefix: '/api/search' });
  await fastify.register(userRoutes, { prefix: '/api/users' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });
  await fastify.register(erpRoutes, { prefix: '/api/erp' });

  // WebSocket handler
  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, websocketHandler);
  });
}

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error);

  if (error.validation) {
    reply.status(400).send({
      success: false,
      message: 'Validation error',
      errors: error.validation,
    });
    return;
  }

  reply.status(500).send({
    success: false,
    message: 'Internal server error',
  });
});

// Graceful shutdown
async function gracefulShutdown() {
  logger.info('Starting graceful shutdown...');

  try {
    await fastify.close();
    await prisma.$disconnect();
    await redis.quit();
    await minio.disconnect();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
async function start() {
  try {
    await registerPlugins();
    await registerRoutes();

    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });

    logger.info(`🚀 AAELink Enterprise Backend v1.2.0`);
    logger.info(`📡 Server running on http://${host}:${port}`);
    logger.info(`📚 API Documentation: http://${host}:${port}/docs`);
    logger.info(`🔗 WebSocket: ws://${host}:${port}/ws`);
    logger.info(`🏢 Advanced ID Asia Engineering Co.,Ltd`);

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Initialize database and start server
async function initialize() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connected');

    // Test MinIO connection
    await minio.healthCheck();
    logger.info('✅ MinIO connected');

    // Start server
    await start();

  } catch (error) {
    logger.error('Initialization failed:', error);
    process.exit(1);
  }
}

// Make services available globally
declare global {
  var prisma: PrismaClient;
  var redis: Redis;
  var minio: MinioClient;
  var io: SocketIOServer;
}

global.prisma = prisma;
global.redis = redis;
global.minio = minio;
global.io = io;

// Start the application
initialize();
