import bcrypt from 'bcryptjs'
import { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { z } from 'zod'
import { prisma } from '../index.js'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'

const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1)
})

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(8)
})

const passkeyRegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  passkeyId: z.string(),
  passkeyData: z.object({})
})

export default async function authRoutes(fastify: FastifyInstance) {
  // Login with username/email and password
  fastify.post('/login', {
    schema: {
      body: loginSchema
    }
  }, async (request, reply) => {
    try {
      const { usernameOrEmail, password } = request.body as z.infer<typeof loginSchema>

      // Find user by username or email
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: usernameOrEmail },
            { email: usernameOrEmail }
          ],
          isActive: true
        }
      })

      if (!user || !user.passwordHash) {
        return reply.code(401).send({ error: 'Invalid credentials' })
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash)
      if (!isValidPassword) {
        return reply.code(401).send({ error: 'Invalid credentials' })
      }

      // Update last seen
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeen: new Date() }
      })

      // Generate JWT token
      const token = await new SignJWT({
        userId: user.id,
        email: user.email,
        role: user.role
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(new TextEncoder().encode(env.JWT_SECRET))

      // Set secure HTTP-only cookie
      reply.setCookie('auth-token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      })

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar,
          role: user.role
        },
        token
      }
    } catch (error) {
      logger.error('Login error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Register new user
  fastify.post('/register', {
    schema: {
      body: registerSchema
    }
  }, async (request, reply) => {
    try {
      const { email, username, firstName, lastName, password } = request.body as z.infer<typeof registerSchema>

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email },
            { username }
          ]
        }
      })

      if (existingUser) {
        return reply.code(409).send({ error: 'User already exists' })
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12)

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          username,
          firstName,
          lastName,
          passwordHash,
          role: 'USER'
        }
      })

      // Generate JWT token
      const token = await new SignJWT({
        userId: user.id,
        email: user.email,
        role: user.role
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(new TextEncoder().encode(env.JWT_SECRET))

      // Set secure HTTP-only cookie
      reply.setCookie('auth-token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      })

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar,
          role: user.role
        },
        token
      }
    } catch (error) {
      logger.error('Registration error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Passkey registration
  fastify.post('/passkey/register', {
    schema: {
      body: passkeyRegisterSchema
    }
  }, async (request, reply) => {
    try {
      const { email, username, firstName, lastName, passkeyId, passkeyData } = request.body as z.infer<typeof passkeyRegisterSchema>

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email },
            { username }
          ]
        }
      })

      if (existingUser) {
        return reply.code(409).send({ error: 'User already exists' })
      }

      // Create user with passkey
      const user = await prisma.user.create({
        data: {
          email,
          username,
          firstName,
          lastName,
          passkeyId,
          passkeyData,
          role: 'USER'
        }
      })

      // Generate JWT token
      const token = await new SignJWT({
        userId: user.id,
        email: user.email,
        role: user.role
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(new TextEncoder().encode(env.JWT_SECRET))

      // Set secure HTTP-only cookie
      reply.setCookie('auth-token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      })

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar,
          role: user.role
        },
        token
      }
    } catch (error) {
      logger.error('Passkey registration error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Passkey login
  fastify.post('/passkey/login', {
    schema: {
      body: z.object({
        passkeyId: z.string()
      })
    }
  }, async (request, reply) => {
    try {
      const { passkeyId } = request.body as { passkeyId: string }

      // Find user by passkey ID
      const user = await prisma.user.findUnique({
        where: {
          passkeyId,
          isActive: true
        }
      })

      if (!user) {
        return reply.code(401).send({ error: 'Invalid passkey' })
      }

      // Update last seen
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeen: new Date() }
      })

      // Generate JWT token
      const token = await new SignJWT({
        userId: user.id,
        email: user.email,
        role: user.role
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(new TextEncoder().encode(env.JWT_SECRET))

      // Set secure HTTP-only cookie
      reply.setCookie('auth-token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      })

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar,
          role: user.role
        },
        token
      }
    } catch (error) {
      logger.error('Passkey login error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Logout
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('auth-token')
    return { message: 'Logged out successfully' }
  })

  // Get current user
  fastify.get('/me', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          role: true,
          lastSeen: true,
          createdAt: true
        }
      })

      if (!user) {
        return reply.code(404).send({ error: 'User not found' })
      }

      return { user }
    } catch (error) {
      logger.error('Get user error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
