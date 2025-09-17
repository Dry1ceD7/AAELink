import { FastifyInstance } from 'fastify'
import { prisma } from '../index.js'

export default async function marketplaceRoutes(fastify: FastifyInstance) {
  // Get themes
  fastify.get('/themes', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const themes = await prisma.theme.findMany({
        where: { isActive: true },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })

      return { themes }
    } catch (error) {
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get stickers
  fastify.get('/stickers', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const stickers = await prisma.sticker.findMany({
        where: { isActive: true },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })

      return { stickers }
    } catch (error) {
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
