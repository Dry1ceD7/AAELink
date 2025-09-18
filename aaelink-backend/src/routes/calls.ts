import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const createCallSchema = z.object({
  type: z.enum(['VIDEO', 'AUDIO', 'SCREEN_SHARE']).default('VIDEO'),
  participants: z.array(z.string()).min(1)
})

const joinCallSchema = z.object({
  callId: z.string()
})

const endCallSchema = z.object({
  callId: z.string()
})

export default async function callRoutes(fastify: FastifyInstance) {
  // Create a new call
  fastify.post('/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: createCallSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { type, participants } = request.body as z.infer<typeof createCallSchema>

      // Add creator to participants
      const allParticipants = [...participants, userId]

      // Create call
      const call = await prisma.call.create({
        data: {
          type,
          status: 'INITIATED',
          participants: {
            create: allParticipants.map(participantId => ({
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

      // Emit real-time event to all participants
      allParticipants.forEach(participantId => {
        fastify.io.to(`user:${participantId}`).emit('call_created', call)
      })

      return { call }
    } catch (error) {
      logger.error('Create call error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Join a call
  fastify.post('/join', {
    preHandler: [fastify.authenticate],
    schema: {
      body: joinCallSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { callId } = request.body as z.infer<typeof joinCallSchema>

      // Check if call exists and user is a participant
      const call = await prisma.call.findFirst({
        where: {
          id: callId,
          participants: {
            some: { userId }
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

      if (!call) {
        return reply.code(404).send({ error: 'Call not found or not authorized' })
      }

      // Update call status if needed
      if (call.status === 'INITIATED') {
        await prisma.call.update({
          where: { id: callId },
          data: { status: 'RINGING' }
        })
      }

      // Emit real-time event
      call.participants.forEach((participant: any) => {
        fastify.io.to(`user:${participant.userId}`).emit('user_joined_call', {
          callId,
          user: participant.user
        })
      })

      return { call }
    } catch (error) {
      logger.error('Join call error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // End a call
  fastify.post('/end', {
    preHandler: [fastify.authenticate],
    schema: {
      body: endCallSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { callId } = request.body as z.infer<typeof endCallSchema>

      // Check if call exists and user is a participant
      const call = await prisma.call.findFirst({
        where: {
          id: callId,
          participants: {
            some: { userId }
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

      if (!call) {
        return reply.code(404).send({ error: 'Call not found or not authorized' })
      }

      // Calculate duration
      const duration = Math.floor((Date.now() - call.startedAt.getTime()) / 1000)

      // Update call
      await prisma.call.update({
        where: { id: callId },
        data: {
          status: 'ENDED',
          endedAt: new Date(),
          duration
        }
      })

      // Emit real-time event
      call.participants.forEach((participant: any) => {
        fastify.io.to(`user:${participant.userId}`).emit('call_ended', {
          callId,
          duration,
          endedBy: userId
        })
      })

      return { success: true, duration }
    } catch (error) {
      logger.error('End call error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get call history
  fastify.get('/history', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: z.object({
        limit: z.coerce.number().min(1).max(100).default(50),
        cursor: z.string().optional()
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { limit, cursor } = request.query as { limit: number; cursor?: string }

      const where: any = {
        participants: {
          some: { userId }
        }
      }

      if (cursor) {
        where.id = { lt: cursor }
      }

      const calls = await prisma.call.findMany({
        where,
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
        },
        orderBy: { startedAt: 'desc' },
        take: limit
      })

      return { calls }
    } catch (error) {
      logger.error('Get call history error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get WebRTC configuration
  fastify.get('/webrtc-config', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      // TODO: Return TURN server configuration
      const config = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      }

      return { config }
    } catch (error) {
      logger.error('Get WebRTC config error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
