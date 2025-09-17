import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'

export default async function groupRoutes(fastify: FastifyInstance) {
  // Get user's groups
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.userId

      const groups = await prisma.group.findMany({
        where: {
          members: {
            some: { userId }
          }
        },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  avatar: true
                }
              }
            }
          },
          _count: {
            select: {
              messages: true,
              members: true
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      })

      return { groups }
    } catch (error) {
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Create group
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        isPrivate: z.boolean().default(false),
        memberIds: z.array(z.string()).min(1)
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { name, description, isPrivate, memberIds } = request.body as any

      const group = await prisma.group.create({
        data: {
          name,
          description,
          isPrivate,
          createdBy: userId,
          members: {
            create: [
              { userId, role: 'ADMIN' },
              ...memberIds.map((id: string) => ({ userId: id, role: 'MEMBER' }))
            ]
          }
        },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  avatar: true
                }
              }
            }
          }
        }
      })

      return { group }
    } catch (error) {
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
