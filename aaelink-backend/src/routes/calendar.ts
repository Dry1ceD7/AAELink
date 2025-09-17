import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'

export default async function calendarRoutes(fastify: FastifyInstance) {
  // Get calendar events
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { start, end } = request.query as { start?: string; end?: string }

      const events = await prisma.calendarEvent.findMany({
        where: {
          OR: [
            { createdBy: userId },
            { attendees: { has: userId } }
          ],
          ...(start && end ? {
            startTime: { gte: new Date(start) },
            endTime: { lte: new Date(end) }
          } : {})
        },
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
        orderBy: { startTime: 'asc' }
      })

      return { events }
    } catch (error) {
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Create calendar event
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        startTime: z.string().datetime(),
        endTime: z.string().datetime(),
        location: z.string().optional(),
        attendees: z.array(z.string()).default([])
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const eventData = request.body as any

      const event = await prisma.calendarEvent.create({
        data: {
          ...eventData,
          startTime: new Date(eventData.startTime),
          endTime: new Date(eventData.endTime),
          createdBy: userId,
          attendees: [...eventData.attendees, userId]
        }
      })

      return { event }
    } catch (error) {
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
