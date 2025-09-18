import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  type: z.enum(['TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'CALL', 'SYSTEM']).default('TEXT'),
  receiverId: z.string().optional(),
  groupId: z.string().optional(),
  threadId: z.string().optional(),
  parentId: z.string().optional(),
  encryptedContent: z.string().optional(),
  encryptionKey: z.string().optional()
})

const getMessagesSchema = z.object({
  groupId: z.string().optional(),
  receiverId: z.string().optional(),
  threadId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional()
})

const reactToMessageSchema = z.object({
  messageId: z.string(),
  emoji: z.string().min(1).max(10)
})

const markAsReadSchema = z.object({
  messageId: z.string()
})

export default async function messageRoutes(fastify: FastifyInstance) {
  // Send a message
  fastify.post('/send', {
    preHandler: [fastify.authenticate],
    schema: {
      body: sendMessageSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const messageData = request.body as z.infer<typeof sendMessageSchema>

      // Validate that either receiverId or groupId is provided
      if (!messageData.receiverId && !messageData.groupId) {
        return reply.code(400).send({ error: 'Either receiverId or groupId is required' })
      }

      // Check if user has permission to send to group
      if (messageData.groupId) {
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId,
            groupId: messageData.groupId
          }
        })

        if (!membership) {
          return reply.code(403).send({ error: 'Not a member of this group' })
        }
      }

      // Create message
      const message = await prisma.message.create({
        data: {
          content: messageData.content,
          type: messageData.type,
          senderId: userId,
          receiverId: messageData.receiverId || null,
          groupId: messageData.groupId || null,
          threadId: messageData.threadId || null,
          parentId: messageData.parentId || null,
          encryptedContent: messageData.encryptedContent || null,
          encryptionKey: messageData.encryptionKey || null
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
          },
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true
                }
              }
            }
          },
          attachments: true
        }
      })

      // Emit real-time event
      if (messageData.groupId) {
        fastify.io.to(`room:${messageData.groupId}`).emit('new_message', message)
      } else if (messageData.receiverId) {
        fastify.io.to(`user:${messageData.receiverId}`).emit('new_message', message)
        fastify.io.to(`user:${userId}`).emit('new_message', message)
      }

      return { message }
    } catch (error) {
      logger.error('Send message error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get messages
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: getMessagesSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { groupId, receiverId, threadId, limit, cursor } = request.query as z.infer<typeof getMessagesSchema>

      // Validate that either receiverId or groupId is provided
      if (!receiverId && !groupId) {
        return reply.code(400).send({ error: 'Either receiverId or groupId is required' })
      }

      // Check permissions
      if (groupId) {
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId,
            groupId
          }
        })

        if (!membership) {
          return reply.code(403).send({ error: 'Not a member of this group' })
        }
      }

      // Build where clause
      const where: any = {
        isDeleted: false
      }

      if (groupId) {
        where.groupId = groupId
      } else if (receiverId) {
        where.OR = [
          { senderId: userId, receiverId },
          { senderId: receiverId, receiverId: userId }
        ]
      }

      if (threadId) {
        where.threadId = threadId
      }

      if (cursor) {
        where.id = { lt: cursor }
      }

      // Get messages
      const messages = await prisma.message.findMany({
        where,
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
          },
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true
                }
              }
            }
          },
          attachments: true,
          readReceipts: {
            where: { userId },
            select: { readAt: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      })

      return { messages: messages.reverse() }
    } catch (error) {
      logger.error('Get messages error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // React to message
  fastify.post('/react', {
    preHandler: [fastify.authenticate],
    schema: {
      body: reactToMessageSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { messageId, emoji } = request.body as z.infer<typeof reactToMessageSchema>

      // Check if message exists
      const message = await prisma.message.findUnique({
        where: { id: messageId }
      })

      if (!message) {
        return reply.code(404).send({ error: 'Message not found' })
      }

      // Check permissions
      if (message.groupId) {
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId,
            groupId: message.groupId
          }
        })

        if (!membership) {
          return reply.code(403).send({ error: 'Not a member of this group' })
        }
      } else if (message.receiverId && message.senderId !== userId && message.receiverId !== userId) {
        return reply.code(403).send({ error: 'Not authorized to react to this message' })
      }

      // Toggle reaction
      const existingReaction = await prisma.reaction.findUnique({
        where: {
          userId_messageId_emoji: {
            userId,
            messageId,
            emoji
          }
        }
      })

      if (existingReaction) {
        // Remove reaction
        await prisma.reaction.delete({
          where: {
            userId_messageId_emoji: {
              userId,
              messageId,
              emoji
            }
          }
        })
      } else {
        // Add reaction
        await prisma.reaction.create({
          data: {
            userId,
            messageId,
            emoji
          }
        })
      }

      // Emit real-time event
      if (message.groupId) {
        fastify.io.to(`room:${message.groupId}`).emit('message_reaction', {
          messageId,
          userId,
          emoji,
          action: existingReaction ? 'remove' : 'add'
        })
      } else {
        const targetUserId = message.senderId === userId ? message.receiverId : message.senderId
        if (targetUserId) {
          fastify.io.to(`user:${targetUserId}`).emit('message_reaction', {
            messageId,
            userId,
            emoji,
            action: existingReaction ? 'remove' : 'add'
          })
        }
      }

      return { success: true }
    } catch (error) {
      logger.error('React to message error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Mark message as read
  fastify.post('/read', {
    preHandler: [fastify.authenticate],
    schema: {
      body: markAsReadSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { messageId } = request.body as z.infer<typeof markAsReadSchema>

      // Check if message exists
      const message = await prisma.message.findUnique({
        where: { id: messageId }
      })

      if (!message) {
        return reply.code(404).send({ error: 'Message not found' })
      }

      // Check permissions
      if (message.senderId === userId) {
        return reply.code(400).send({ error: 'Cannot mark own message as read' })
      }

      if (message.groupId) {
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId,
            groupId: message.groupId
          }
        })

        if (!membership) {
          return reply.code(403).send({ error: 'Not a member of this group' })
        }
      } else if (message.receiverId !== userId) {
        return reply.code(403).send({ error: 'Not authorized to mark this message as read' })
      }

      // Create or update read receipt
      await prisma.readReceipt.upsert({
        where: {
          userId_messageId: {
            userId,
            messageId
          }
        },
        update: {
          readAt: new Date()
        },
        create: {
          userId,
          messageId,
          readAt: new Date()
        }
      })

      // Emit real-time event
      if (message.groupId) {
        fastify.io.to(`room:${message.groupId}`).emit('message_read', {
          messageId,
          userId,
          readAt: new Date()
        })
      } else {
        fastify.io.to(`user:${message.senderId}`).emit('message_read', {
          messageId,
          userId,
          readAt: new Date()
        })
      }

      return { success: true }
    } catch (error) {
      logger.error('Mark message as read error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get typing status
  fastify.get('/typing/:roomId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { roomId } = request.params as { roomId: string }
      const userId = request.user.userId

      // Check if user has permission to see typing status
      if (roomId.startsWith('group:')) {
        const groupId = roomId.replace('group:', '')
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId,
            groupId
          }
        })

        if (!membership) {
          return reply.code(403).send({ error: 'Not a member of this group' })
        }
      }

      // Get typing users from Redis
      const typingUsers = await fastify.redis.smembers(`typing:${roomId}`)

      return { typingUsers }
    } catch (error) {
      logger.error('Get typing status error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Set typing status
  fastify.post('/typing', {
    preHandler: [fastify.authenticate],
    schema: {
      body: z.object({
        roomId: z.string(),
        isTyping: z.boolean()
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { roomId, isTyping } = request.body as { roomId: string; isTyping: boolean }

      // Check permissions
      if (roomId.startsWith('group:')) {
        const groupId = roomId.replace('group:', '')
        const membership = await prisma.groupMember.findFirst({
          where: {
            userId,
            groupId
          }
        })

        if (!membership) {
          return reply.code(403).send({ error: 'Not a member of this group' })
        }
      }

      if (isTyping) {
        await fastify.redis.sadd(`typing:${roomId}`, userId)
        await fastify.redis.expire(`typing:${roomId}`, 10) // 10 seconds
      } else {
        await fastify.redis.srem(`typing:${roomId}`, userId)
      }

      // Emit real-time event
      fastify.io.to(`room:${roomId}`).emit('typing', {
        userId,
        isTyping
      })

      return { success: true }
    } catch (error) {
      logger.error('Set typing status error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
