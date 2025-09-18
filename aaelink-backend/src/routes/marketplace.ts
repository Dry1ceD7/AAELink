import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const createThemeSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  previewUrl: z.string().url(),
  price: z.number().min(0),
  category: z.string().min(1)
})

const createStickerSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().min(1),
  imageUrl: z.string().url(),
  category: z.string().min(1),
  price: z.number().min(0)
})

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
      logger.error('Get themes error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Create theme
  fastify.post('/themes', {
    preHandler: [fastify.authenticate],
    schema: {
      body: createThemeSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const themeData = request.body as z.infer<typeof createThemeSchema>

      const theme = await prisma.theme.create({
        data: {
          ...themeData,
          createdBy: userId
        }
      })

      return { theme }
    } catch (error) {
      logger.error('Create theme error:', error)
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
      logger.error('Get stickers error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Create sticker
  fastify.post('/stickers', {
    preHandler: [fastify.authenticate],
    schema: {
      body: createStickerSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const stickerData = request.body as z.infer<typeof createStickerSchema>

      const sticker = await prisma.sticker.create({
        data: {
          ...stickerData,
          createdBy: userId
        }
      })

      return { sticker }
    } catch (error) {
      logger.error('Create sticker error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get user's marketplace items
  fastify.get('/my-items', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.userId

      const [themes, stickers] = await Promise.all([
        prisma.theme.findMany({
          where: { createdBy: userId },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.sticker.findMany({
          where: { createdBy: userId },
          orderBy: { createdAt: 'desc' }
        })
      ])

      return { themes, stickers }
    } catch (error) {
      logger.error('Get user items error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}