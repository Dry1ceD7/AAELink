import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const createEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().optional(),
  attendees: z.array(z.string()).min(1)
})

export default async function calendarRoutes(fastify: FastifyInstance) {
  // Create calendar event
  fastify.post('/events', {
    preHandler: [fastify.authenticate],
    schema: {
      body: createEventSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const eventData = request.body as z.infer<typeof createEventSchema>

      const event = await prisma.calendarEvent.create({
        data: {
          title: eventData.title,
          description: eventData.description || null,
          startTime: new Date(eventData.startTime),
          endTime: new Date(eventData.endTime),
          location: eventData.location || null,
          attendees: eventData.attendees,
          createdBy: userId
        }
      })

      // Emit real-time event
      eventData.attendees.forEach(attendeeId => {
        fastify.io.to(`user:${attendeeId}`).emit('calendar_event_created', event)
      })

      return { event }
    } catch (error) {
      logger.error('Create calendar event error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get user's calendar events
  fastify.get('/events', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.userId

      const events = await prisma.calendarEvent.findMany({
        where: {
          OR: [
            { createdBy: userId },
            {
              attendees: {
                array_contains: [userId]
              }
            }
          ]
        },
        orderBy: { startTime: 'asc' }
      })

      return { events }
    } catch (error) {
      logger.error('Get calendar events error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get calendar event by ID
  fastify.get('/events/:eventId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { eventId } = request.params as { eventId: string }
      const userId = request.user.userId

      const event = await prisma.calendarEvent.findFirst({
        where: {
          id: eventId,
          OR: [
            { createdBy: userId },
            {
              attendees: {
                array_contains: [userId]
              }
            }
          ]
        }
      })

      if (!event) {
        return reply.code(404).send({ error: 'Event not found' })
      }

      return { event }
    } catch (error) {
      logger.error('Get calendar event error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Update calendar event
  fastify.put('/events/:eventId', {
    preHandler: [fastify.authenticate],
    schema: {
      body: createEventSchema.partial()
    }
  }, async (request, reply) => {
    try {
      const { eventId } = request.params as { eventId: string }
      const userId = request.user.userId
      const updateData = request.body as Partial<z.infer<typeof createEventSchema>>

      // Check if user is creator
      const event = await prisma.calendarEvent.findFirst({
        where: {
          id: eventId,
          createdBy: userId
        }
      })

      if (!event) {
        return reply.code(404).send({ error: 'Event not found or not authorized' })
      }

      const updatePayload: any = {}
      if (updateData.title !== undefined) updatePayload.title = updateData.title
      if (updateData.description !== undefined) updatePayload.description = updateData.description || null
      if (updateData.location !== undefined) updatePayload.location = updateData.location || null
      if (updateData.attendees !== undefined) updatePayload.attendees = updateData.attendees
      if (updateData.startTime !== undefined) updatePayload.startTime = new Date(updateData.startTime)
      if (updateData.endTime !== undefined) updatePayload.endTime = new Date(updateData.endTime)

      const updatedEvent = await prisma.calendarEvent.update({
        where: { id: eventId },
        data: updatePayload
      })

      // Emit real-time event
      fastify.io.to(`user:${userId}`).emit('calendar_event_updated', updatedEvent)

      return { event: updatedEvent }
    } catch (error) {
      logger.error('Update calendar event error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Delete calendar event
  fastify.delete('/events/:eventId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { eventId } = request.params as { eventId: string }
      const userId = request.user.userId

      // Check if user is creator
      const event = await prisma.calendarEvent.findFirst({
        where: {
          id: eventId,
          createdBy: userId
        }
      })

      if (!event) {
        return reply.code(404).send({ error: 'Event not found or not authorized' })
      }

      await prisma.calendarEvent.delete({
        where: { id: eventId }
      })

      // Emit real-time event
      fastify.io.to(`user:${userId}`).emit('calendar_event_deleted', { eventId })

      return { success: true }
    } catch (error) {
      logger.error('Delete calendar event error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}