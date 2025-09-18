import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const searchSchema = z.object({
  query: z.string().min(1),
  type: z.enum(['messages', 'files', 'users', 'all']).default('all'),
  limit: z.coerce.number().min(1).max(100).default(20)
})

export default async function searchRoutes(fastify: FastifyInstance) {
  // Search
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: searchSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { query, type, limit } = request.query as z.infer<typeof searchSchema>

      const results: any = {
        messages: [],
        files: [],
        users: []
      }

      // Search messages
      if (type === 'messages' || type === 'all') {
        const messages = await prisma.message.findMany({
          where: {
            AND: [
              {
                OR: [
                  { senderId: userId },
                  { receiverId: userId },
                  {
                    group: {
                      members: {
                        some: { userId }
                      }
                    }
                  }
                ]
              },
              {
                content: {
                  contains: query,
                  mode: 'insensitive'
                }
              },
              { isDeleted: false }
            ]
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatar: true
              }
            },
            group: {
              select: {
                id: true,
                name: true
              }
            }
          },
          take: limit
        })

        results.messages = messages
      }

      // Search files
      if (type === 'files' || type === 'all') {
        const files = await prisma.file.findMany({
          where: {
            AND: [
              { uploadedBy: userId },
              {
                OR: [
                  { originalName: { contains: query, mode: 'insensitive' } },
                  { filename: { contains: query, mode: 'insensitive' } }
                ]
              }
            ]
          },
          take: limit
        })

        results.files = files
      }

      // Search users
      if (type === 'users' || type === 'all') {
        const users = await prisma.user.findMany({
          where: {
            AND: [
              { id: { not: userId } },
              { isActive: true },
              {
                OR: [
                  { username: { contains: query, mode: 'insensitive' } },
                  { firstName: { contains: query, mode: 'insensitive' } },
                  { lastName: { contains: query, mode: 'insensitive' } },
                  { email: { contains: query, mode: 'insensitive' } }
                ]
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
          take: limit
        })

        results.users = users
      }

      // Save search history
      await prisma.searchHistory.create({
        data: {
          userId,
          query,
          results: results
        }
      })

      return { results }
    } catch (error) {
      logger.error('Search error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get search history
  fastify.get('/history', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.userId

      const history = await prisma.searchHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20
      })

      return { history }
    } catch (error) {
      logger.error('Get search history error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}