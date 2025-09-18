import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
  members: z.array(z.string()).min(1)
})

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().optional()
})

export default async function groupRoutes(fastify: FastifyInstance) {
  // Create group
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: createGroupSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const groupData = request.body as z.infer<typeof createGroupSchema>

      // Create group
      const group = await prisma.group.create({
        data: {
          name: groupData.name,
          description: groupData.description || null,
          isPrivate: groupData.isPrivate,
          createdBy: userId,
          members: {
            create: [
              { userId, role: 'ADMIN' },
              ...groupData.members.map(memberId => ({
                userId: memberId,
                role: 'MEMBER' as const
              }))
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

      // Emit real-time event
      groupData.members.forEach(memberId => {
        fastify.io.to(`user:${memberId}`).emit('group_created', group)
      })

      return { group }
    } catch (error) {
      logger.error('Create group error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

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
              members: true,
              messages: true
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      })

      return { groups }
    } catch (error) {
      logger.error('Get groups error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get group by ID
  fastify.get('/:groupId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { groupId } = request.params as { groupId: string }
      const userId = request.user.userId

      // Check if user is member
      const membership = await prisma.groupMember.findFirst({
        where: {
          userId,
          groupId
        }
      })

      if (!membership) {
        return reply.code(403).send({ error: 'Not a member of this group' })
      }

      const group = await prisma.group.findUnique({
        where: { id: groupId },
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
              members: true,
              messages: true
            }
          }
        }
      })

      if (!group) {
        return reply.code(404).send({ error: 'Group not found' })
      }

      return { group }
    } catch (error) {
      logger.error('Get group error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Update group
  fastify.put('/:groupId', {
    preHandler: [fastify.authenticate],
    schema: {
      body: updateGroupSchema
    }
  }, async (request, reply) => {
    try {
      const { groupId } = request.params as { groupId: string }
      const userId = request.user.userId
      const updateData = request.body as z.infer<typeof updateGroupSchema>

      // Check if user is admin
      const membership = await prisma.groupMember.findFirst({
        where: {
          userId,
          groupId,
          role: 'ADMIN'
        }
      })

      if (!membership) {
        return reply.code(403).send({ error: 'Not authorized to update this group' })
      }

      const updatePayload: any = {}
      if (updateData.name !== undefined) updatePayload.name = updateData.name
      if (updateData.description !== undefined) updatePayload.description = updateData.description || null
      if (updateData.isPrivate !== undefined) updatePayload.isPrivate = updateData.isPrivate

      const group = await prisma.group.update({
        where: { id: groupId },
        data: updatePayload,
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

      // Emit real-time event
      fastify.io.to(`room:${groupId}`).emit('group_updated', group)

      return { group }
    } catch (error) {
      logger.error('Update group error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Add member to group
  fastify.post('/:groupId/members', {
    preHandler: [fastify.authenticate],
    schema: {
      body: z.object({
        userId: z.string()
      })
    }
  }, async (request, reply) => {
    try {
      const { groupId } = request.params as { groupId: string }
      const currentUserId = request.user.userId
      const { userId } = request.body as { userId: string }

      // Check if current user is admin
      const membership = await prisma.groupMember.findFirst({
        where: {
          userId: currentUserId,
          groupId,
          role: 'ADMIN'
        }
      })

      if (!membership) {
        return reply.code(403).send({ error: 'Not authorized to add members' })
      }

      // Add member
      await prisma.groupMember.create({
        data: {
          groupId,
          userId,
          role: 'MEMBER'
        }
      })

      // Emit real-time event
      fastify.io.to(`user:${userId}`).emit('added_to_group', { groupId })
      fastify.io.to(`room:${groupId}`).emit('member_added', { groupId, userId })

      return { success: true }
    } catch (error) {
      logger.error('Add member error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Remove member from group
  fastify.delete('/:groupId/members/:userId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { groupId, userId } = request.params as { groupId: string; userId: string }
      const currentUserId = request.user.userId

      // Check if current user is admin or removing themselves
      if (userId !== currentUserId) {
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId: currentUserId,
            groupId,
            role: 'ADMIN'
          }
        })

        if (!membership) {
          return reply.code(403).send({ error: 'Not authorized to remove members' })
        }
      }

      // Remove member
      await prisma.groupMember.deleteMany({
        where: {
          groupId,
          userId
        }
      })

      // Emit real-time event
      fastify.io.to(`user:${userId}`).emit('removed_from_group', { groupId })
      fastify.io.to(`room:${groupId}`).emit('member_removed', { groupId, userId })

      return { success: true }
    } catch (error) {
      logger.error('Remove member error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}