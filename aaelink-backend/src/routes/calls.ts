import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const createCallSchema = z.object({
  type: z.enum(['VIDEO', 'AUDIO', 'SCREEN_SHARE']).default('VIDEO'),
  participants: z.array(z.string()).min(1)
})

export default async function callRoutes(fastify: FastifyInstance) {
  // Create call
  fastify.post('/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: createCallSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const callData = request.body as z.infer<typeof createCallSchema>

      // Create call
      const call = await prisma.call.create({
        data: {
          type: callData.type,
          participants: {
            create: callData.participants.map(participantId => ({
              userId: participantId
            }))
          }
        },
        include: {
          participants: {
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
      callData.participants.forEach(participantId => {
        fastify.io.to(`user:${participantId}`).emit('call_created', call)
      })

      return { call }
    } catch (error) {
      logger.error('Create call error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Join call
  fastify.post('/:callId/join', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { callId } = request.params as { callId: string }
      const userId = request.user.userId

      // Check if call exists
      const call = await prisma.call.findUnique({
        where: { id: callId }
      })

      if (!call) {
        return reply.code(404).send({ error: 'Call not found' })
      }

      // Add participant
      await prisma.callParticipant.create({
        data: {
          callId,
          userId
        }
      })

      // Emit real-time event
      fastify.io.to(`call:${callId}`).emit('user_joined', {
        callId,
        userId
      })

      return { success: true }
    } catch (error) {
      logger.error('Join call error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Leave call
  fastify.post('/:callId/leave', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { callId } = request.params as { callId: string }
      const userId = request.user.userId

      // Remove participant
      await prisma.callParticipant.updateMany({
        where: {
          callId,
          userId,
          leftAt: null
        },
        data: {
          leftAt: new Date()
        }
      })

      // Emit real-time event
      fastify.io.to(`call:${callId}`).emit('user_left', {
        callId,
        userId
      })

      return { success: true }
    } catch (error) {
      logger.error('Leave call error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // End call
  fastify.post('/:callId/end', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { callId } = request.params as { callId: string }
      const userId = request.user.userId

      // Check if user is participant
      const participant = await prisma.callParticipant.findFirst({
        where: {
          callId,
          userId,
          leftAt: null
        }
      })

      if (!participant) {
        return reply.code(403).send({ error: 'Not a participant in this call' })
      }

      // End call
      await prisma.call.update({
        where: { id: callId },
        data: {
          status: 'ENDED',
          endedAt: new Date()
        }
      })

      // Emit real-time event
      fastify.io.to(`call:${callId}`).emit('call_ended', {
        callId,
        endedBy: userId
      })

      return { success: true }
    } catch (error) {
      logger.error('End call error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}