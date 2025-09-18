import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { PrismaClient } from '@prisma/client'
import Fastify from 'fastify'
import { createServer } from 'http'
import Redis from 'ioredis'
import { Server as SocketIOServer } from 'socket.io'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { MinioClient } from './lib/minio.js'

// Import route modules
import authRoutes from './routes/auth.js'
import calendarRoutes from './routes/calendar.js'
import callRoutes from './routes/calls.js'
import fileRoutes from './routes/files.js'
import groupRoutes from './routes/groups.js'
import marketplaceRoutes from './routes/marketplace.js'
import messageRoutes from './routes/messages.js'
import searchRoutes from './routes/search.js'
import userRoutes from './routes/users.js'

// Initialize services
export const prisma = new PrismaClient()
export const redis = new Redis(env.REDIS_URL)
export const minio = new MinioClient()

// Create Fastify instance
const fastify = Fastify({
  trustProxy: true,
  logger: true
})

// Create HTTP server
const server = createServer()
const io = new SocketIOServer(server, {
  cors: {
    origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// Register plugins
await fastify.register(cors, {
  origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id']
})

await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  }
})

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
})

await fastify.register(websocket)

await fastify.register(cookie, {
  secret: env.JWT_SECRET
})

await fastify.register(jwt, {
  secret: env.JWT_SECRET
})

// Add services to Fastify instance
fastify.decorate('prisma', prisma)
fastify.decorate('redis', redis)
fastify.decorate('minio', minio)
fastify.decorate('io', io)

// Add authentication decorator
fastify.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.send(err)
  }
})

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' })
await fastify.register(messageRoutes, { prefix: '/api/messages' })
await fastify.register(fileRoutes, { prefix: '/api/files' })
await fastify.register(callRoutes, { prefix: '/api/calls' })
await fastify.register(searchRoutes, { prefix: '/api/search' })
await fastify.register(userRoutes, { prefix: '/api/users' })
await fastify.register(groupRoutes, { prefix: '/api/groups' })
await fastify.register(calendarRoutes, { prefix: '/api/calendar' })
await fastify.register(marketplaceRoutes, { prefix: '/api/marketplace' })

// Health check endpoints
fastify.get('/api/healthz', async (request, reply) => {
  return { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  }
})

fastify.get('/api/readyz', async (request, reply) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`

    // Check Redis connection
    await redis.ping()

    return { status: 'ready', timestamp: new Date().toISOString() }
  } catch (error) {
    reply.code(503)
    return { status: 'not ready', error: error instanceof Error ? error.message : String(error) }
  }
})

// WebSocket connection handling
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    const socket = connection.socket
    const userId = req.headers['x-user-id'] as string

    if (!userId) {
      socket.close(1008, 'Unauthorized')
      return
    }

    // Store user ID on socket for room management
    (socket as any).userId = userId

    // Handle incoming messages
    socket.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString())

        switch (data.type) {
          case 'typing':
            io.to(`room:${data.roomId}`).emit('typing', {
              userId,
              isTyping: data.isTyping
            })
            break

          case 'presence':
            await redis.setex(`presence:${userId}`, 30, 'online')
            io.emit('presence', {
              userId,
              status: 'online'
            })
            break

          case 'join_room':
            // Use Socket.IO for room management
            io.sockets.sockets.forEach((s: any) => {
              if (s.userId === userId) {
                s.join(`room:${data.roomId}`)
              }
            })
            break

          case 'leave_room':
            // Use Socket.IO for room management
            io.sockets.sockets.forEach((s: any) => {
              if (s.userId === userId) {
                s.leave(`room:${data.roomId}`)
              }
            })
            break
        }
      } catch (error) {
        logger.error('WebSocket message error:', error)
      }
    })

    // Handle disconnect
    socket.on('close', async () => {
      await redis.del(`presence:${userId}`)
      io.emit('presence', {
        userId,
        status: 'offline'
      })
    })
  })
})

// Error handling
fastify.setErrorHandler((error, request, reply) => {
  logger.error(error)

  if (error.validation) {
    reply.code(400).send({
      error: 'Validation Error',
      details: error.validation
    })
    return
  }

  reply.code(500).send({
    error: 'Internal Server Error',
    message: env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  })
})

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`)

  try {
    await fastify.close()
    await prisma.$disconnect()
    await redis.quit()
    server.close()
    process.exit(0)
  } catch (error) {
    logger.error('Error during shutdown:', error)
    process.exit(1)
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Start server
const start = async () => {
  try {
    // Start Fastify server
    const address = await fastify.listen({
      port: env.PORT,
      host: '0.0.0.0'
    })

    logger.info(`AAELink Backend server listening at ${address}`)
    logger.info(`Health check: http://localhost:${env.PORT}/api/healthz`)
    logger.info(`WebSocket: ws://localhost:${env.PORT}/ws`)
  } catch (err) {
    logger.error('Error starting server:', err)
    process.exit(1)
  }
}

start()
