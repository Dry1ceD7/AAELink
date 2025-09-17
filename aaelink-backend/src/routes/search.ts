import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const searchSchema = z.object({
  query: z.string().min(1).max(100),
  type: z.enum(['all', 'messages', 'files', 'users']).default('all'),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional()
})

export default async function searchRoutes(fastify: FastifyInstance) {
  // Global search
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: searchSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { query, type, limit, cursor } = request.query as z.infer<typeof searchSchema>

      const results: any = {
        messages: [],
        files: [],
        users: [],
        total: 0
      }

      // Search messages
      if (type === 'all' || type === 'messages') {
        const messageWhere: any = {
          AND: [
            {
              OR: [
                { content: { contains: query, mode: 'insensitive' } },
                { sender: { username: { contains: query, mode: 'insensitive' } } },
                { sender: { firstName: { contains: query, mode: 'insensitive' } } },
                { sender: { lastName: { contains: query, mode: 'insensitive' } } }
              ]
            },
            {
              OR: [
                { senderId: userId },
                { receiverId: userId },
                { group: { members: { some: { userId } } } }
              ]
            }
          ]
        }

        if (cursor) {
          messageWhere.id = { lt: cursor }
        }

        const messages = await prisma.message.findMany({
          where: messageWhere,
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
            receiver: {
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
                name: true,
                avatar: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: limit
        })

        results.messages = messages
      }

      // Search files
      if (type === 'all' || type === 'files') {
        const fileWhere: any = {
          AND: [
            {
              OR: [
                { originalName: { contains: query, mode: 'insensitive' } },
                { uploader: { username: { contains: query, mode: 'insensitive' } } }
              ]
            },
            {
              OR: [
                { uploadedBy: userId },
                { message: { senderId: userId } },
                { message: { receiverId: userId } },
                { message: { group: { members: { some: { userId } } } } }
              ]
            }
          ]
        }

        if (cursor) {
          fileWhere.id = { lt: cursor }
        }

        const files = await prisma.file.findMany({
          where: fileWhere,
          include: {
            uploader: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatar: true
              }
            },
            message: {
              select: {
                id: true,
                content: true,
                group: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: limit
        })

        results.files = files
      }

      // Search users
      if (type === 'all' || type === 'users') {
        const userWhere: any = {
          AND: [
            {
              OR: [
                { username: { contains: query, mode: 'insensitive' } },
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } }
              ]
            },
            { isActive: true },
            { id: { not: userId } }
          ]
        }

        if (cursor) {
          userWhere.id = { lt: cursor }
        }

        const users = await prisma.user.findMany({
          where: userWhere,
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            lastSeen: true
          },
          orderBy: { username: 'asc' },
          take: limit
        })

        results.users = users
      }

      // Calculate total
      results.total = results.messages.length + results.files.length + results.users.length

      // Save search history
      await prisma.searchHistory.create({
        data: {
          userId,
          query,
          results: {
            messages: results.messages.length,
            files: results.files.length,
            users: results.users.length
          }
        }
      })

      return results
    } catch (error) {
      logger.error('Search error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get search suggestions
  fastify.get('/suggestions', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: z.object({
        query: z.string().min(1).max(50)
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { query } = request.query as { query: string }

      const suggestions = []

      // Get recent search history
      const recentSearches = await prisma.searchHistory.findMany({
        where: {
          userId,
          query: { contains: query, mode: 'insensitive' }
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        distinct: ['query']
      })

      suggestions.push(...recentSearches.map(s => s.query))

      // Get user suggestions
      const userSuggestions = await prisma.user.findMany({
        where: {
          AND: [
            {
              OR: [
                { username: { contains: query, mode: 'insensitive' } },
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } }
              ]
            },
            { isActive: true },
            { id: { not: userId } }
          ]
        },
        select: { username: true, firstName: true, lastName: true },
        take: 5
      })

      suggestions.push(...userSuggestions.map(u => `@${u.username}`))

      return { suggestions: [...new Set(suggestions)].slice(0, 10) }
    } catch (error) {
      logger.error('Get search suggestions error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get search history
  fastify.get('/history', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: z.object({
        limit: z.coerce.number().min(1).max(50).default(20)
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { limit } = request.query as { limit: number }

      const history = await prisma.searchHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        distinct: ['query']
      })

      return { history }
    } catch (error) {
      logger.error('Get search history error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
