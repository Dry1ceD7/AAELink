import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
import Fastify from 'fastify'

// Load environment variables
dotenv.config()

const prisma = new PrismaClient()
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  }
})

// Register plugins
async function registerPlugins() {
  // CORS
  await fastify.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  })

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
  })

  // Rate limiting
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  })

  // JWT
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'your-secret-key'
  })

  // Multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB
    }
  })

  // WebSocket
  await fastify.register(websocket)
}

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  }
})

// API routes
fastify.register(async function (fastify) {
  // Auth routes
  fastify.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string }

    // Mock authentication - replace with real implementation
    if (username === 'admin' || username === 'admin@aae.co.th') {
      if (password === '12345678') {
        const token = fastify.jwt.sign({
          userId: '1',
          username: 'admin',
          role: 'admin'
        })

        return {
          success: true,
          token,
          user: {
            id: '1',
            username: 'admin',
            email: 'admin@aae.co.th',
            role: 'admin'
          }
        }
      }
    }

    reply.code(401)
    return { success: false, message: 'Invalid credentials' }
  })

  // User routes
  fastify.get('/api/users/me', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify()
      } catch (err) {
        reply.send(err)
      }
    }
  }, async (request, reply) => {
    const user = request.user as { userId: string; username: string; role: string }
    return {
      id: user.userId,
      username: user.username,
      role: user.role
    }
  })

  // Messages routes
  fastify.get('/api/messages/:channelId', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify()
      } catch (err) {
        reply.send(err)
      }
    }
  }, async (request, reply) => {
    const { channelId } = request.params as { channelId: string }

    // Mock messages - replace with database query
    const messages = [
      {
        id: '1',
        channelId,
        userId: '1',
        content: "Hey, how's the project going?",
        timestamp: new Date(Date.now() - 2 * 60 * 1000),
        reactions: [
          { emoji: '👍', count: 2, users: ['2', '3'] },
          { emoji: '❤️', count: 1, users: ['2'] }
        ],
        isOwn: false
      },
      {
        id: '2',
        channelId,
        userId: '2',
        content: 'Can we schedule a meeting for tomorrow?',
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        reactions: [
          { emoji: '👍', count: 1, users: ['1'] }
        ],
        isOwn: true
      }
    ]

    return { messages }
  })

  // File upload route
  fastify.post('/api/files/upload', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify()
      } catch (err) {
        reply.send(err)
      }
    }
  }, async (request, reply) => {
    const data = await request.file()

    if (!data) {
      reply.code(400)
      return { success: false, message: 'No file uploaded' }
    }

    // Mock file upload - replace with real implementation
    const fileId = Date.now().toString()

    return {
      success: true,
      fileId,
      filename: data.filename,
      size: data.file.bytesRead,
      url: `/files/${fileId}`
    }
  })
}, { prefix: '/api' })

// WebSocket connection
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    fastify.log.info('WebSocket connection established')

    connection.socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString())
        fastify.log.info('Received message:', data)

        // Echo back the message
        connection.socket.send(JSON.stringify({
          type: 'echo',
          data: data,
          timestamp: new Date().toISOString()
        }))
      } catch (error) {
        fastify.log.error('Error parsing message:', error)
      }
    })

    connection.socket.on('close', () => {
      fastify.log.info('WebSocket connection closed')
    })
  })
})

// Start server
async function start() {
  try {
    await registerPlugins()

    const port = parseInt(process.env.PORT || '3001')
    const host = process.env.HOST || '0.0.0.0'

    await fastify.listen({ port, host })

    fastify.log.info(`🚀 AAELink Backend Server running on http://${host}:${port}`)
    fastify.log.info(`📊 Health check: http://${host}:${port}/health`)
    fastify.log.info(`🔌 WebSocket: ws://${host}:${port}/ws`)

  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  fastify.log.info('Shutting down server...')
  await fastify.close()
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  fastify.log.info('Shutting down server...')
  await fastify.close()
  await prisma.$disconnect()
  process.exit(0)
})

start()
