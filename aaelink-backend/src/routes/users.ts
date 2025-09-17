import { FastifyInstance } from 'fastify'
import { prisma } from '../index.js'

export default async function userRoutes(fastify: FastifyInstance) {
  // Get all users
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const users = await prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          lastSeen: true,
          role: true
        },
        orderBy: { username: 'asc' }
      })

      return { users }
    } catch (error) {
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
          lastSeen: true,
          role: true,
          createdAt: true
        }
      })

      if (!user) {
        return reply.code(404).send({ error: 'User not found' })
      }

      return { user }
    } catch (error) {
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
