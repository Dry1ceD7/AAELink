import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  avatar: z.string().url().optional()
})

export default async function userRoutes(fastify: FastifyInstance) {
  // Get user profile
  fastify.get('/profile', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.userId

      const user = await prisma.user.findUnique({
        where: { id: userId },
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
      logger.error('Get profile error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Update user profile
  fastify.put('/profile', {
    preHandler: [fastify.authenticate],
    schema: {
      body: updateProfileSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const updateData = request.body as z.infer<typeof updateProfileSchema>

      const updatePayload: any = {}
      if (updateData.firstName !== undefined) updatePayload.firstName = updateData.firstName
      if (updateData.lastName !== undefined) updatePayload.lastName = updateData.lastName
      if (updateData.avatar !== undefined) updatePayload.avatar = updateData.avatar || null

      const user = await prisma.user.update({
        where: { id: userId },
        data: updatePayload,
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

      return { user }
    } catch (error) {
      logger.error('Update profile error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get user by ID
  fastify.get('/:userId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          lastSeen: true
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

  // Get online users
  fastify.get('/online', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.userId

      // Get users who were active in the last 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

      const onlineUsers = await prisma.user.findMany({
        where: {
          AND: [
            { id: { not: userId } },
            { isActive: true },
            {
              lastSeen: {
                gte: fiveMinutesAgo
              }
            }
          ]
        },
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          lastSeen: true
        },
        orderBy: { lastSeen: 'desc' }
      })

      return { users: onlineUsers }
    } catch (error) {
      logger.error('Get online users error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}