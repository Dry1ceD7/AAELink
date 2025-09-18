import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';

// Input validation schemas
const createEventSchema = z.object({
  title: z.string().min(1, 'Event title is required').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
  startTime: z.string().datetime('Invalid start time format'),
  endTime: z.string().datetime('Invalid end time format'),
  location: z.string().max(200, 'Location too long').optional(),
  attendees: z.array(z.string().email('Invalid email format')).optional(),
  isRecurring: z.boolean().default(false),
  recurrencePattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
  meetingRoomId: z.string().optional(),
});

const updateEventSchema = createEventSchema.partial().extend({
  id: z.string().min(1, 'Event ID is required'),
});

const deleteEventSchema = z.object({
  id: z.string().min(1, 'Event ID is required'),
});

const getEventsSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

export async function calendarRoutes(fastify: FastifyInstance) {
  // Create event
  fastify.post('/events', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const eventData = createEventSchema.parse(request.body);
      const payload = request.user as any;

      // Validate time range
      const startTime = new Date(eventData.startTime);
      const endTime = new Date(eventData.endTime);

      if (startTime >= endTime) {
        return reply.status(400).send({
          success: false,
          message: 'End time must be after start time',
        });
      }

      // Check for conflicts
      // In production, check against existing events
      const hasConflict = false; // Mock conflict check

      if (hasConflict) {
        return reply.status(409).send({
          success: false,
          message: 'Event conflicts with existing event',
        });
      }

      // Create event
      const event = {
        id: `event_${Date.now()}`,
        ...eventData,
        creatorId: payload.userId,
        creatorName: payload.username,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'scheduled',
      };

      logger.info(`Event created: ${event.title} by ${payload.username}`);

      return reply.send({
        success: true,
        event,
      });

    } catch (error) {
      logger.error('Create event error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Failed to create event',
      });
    }
  });

  // Get events
  fastify.get('/events', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const queryParams = request.query as any;
      const { startDate, endDate, limit, offset } = getEventsSchema.parse(queryParams);

      // Mock events - replace with database query
      const events = [
        {
          id: 'event_1',
          title: 'Team Meeting',
          description: 'Weekly team standup',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
          location: 'Conference Room A',
          attendees: ['admin@aae.co.th', 'user1@aae.co.th'],
          creatorId: 'admin',
          creatorName: 'Admin User',
          status: 'scheduled',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'event_2',
          title: 'Project Review',
          description: 'Monthly project review meeting',
          startTime: new Date(Date.now() + 86400000).toISOString(),
          endTime: new Date(Date.now() + 86400000 + 7200000).toISOString(),
          location: 'Conference Room B',
          attendees: ['admin@aae.co.th'],
          creatorId: 'admin',
          creatorName: 'Admin User',
          status: 'scheduled',
          createdAt: new Date().toISOString(),
        },
      ];

      // Filter by date range if provided
      let filteredEvents = events;
      if (startDate) {
        const start = new Date(startDate);
        filteredEvents = filteredEvents.filter(event => new Date(event.startTime) >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        filteredEvents = filteredEvents.filter(event => new Date(event.startTime) <= end);
      }

      // Apply pagination
      const paginatedEvents = filteredEvents.slice(offset, offset + limit);

      return reply.send({
        success: true,
        events: paginatedEvents,
        pagination: {
          total: filteredEvents.length,
          limit,
          offset,
          hasMore: offset + limit < filteredEvents.length,
        },
      });

    } catch (error) {
      logger.error('Get events error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Failed to get events',
      });
    }
  });

  // Update event
  fastify.put('/events/:id', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const updateData = updateEventSchema.parse({ id, ...request.body });
      const payload = request.user as any;

      // Check if event exists and user has permission
      // In production, check database
      const eventExists = true; // Mock check
      const hasPermission = true; // Mock permission check

      if (!eventExists) {
        return reply.status(404).send({
          success: false,
          message: 'Event not found',
        });
      }

      if (!hasPermission) {
        return reply.status(403).send({
          success: false,
          message: 'Permission denied',
        });
      }

      // Update event
      const updatedEvent = {
        id,
        ...updateData,
        updatedAt: new Date().toISOString(),
        updatedBy: payload.userId,
      };

      logger.info(`Event updated: ${id} by ${payload.username}`);

      return reply.send({
        success: true,
        event: updatedEvent,
      });

    } catch (error) {
      logger.error('Update event error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Failed to update event',
      });
    }
  });

  // Delete event
  fastify.delete('/events/:id', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const payload = request.user as any;

      // Check if event exists and user has permission
      // In production, check database
      const eventExists = true; // Mock check
      const hasPermission = true; // Mock permission check

      if (!eventExists) {
        return reply.status(404).send({
          success: false,
          message: 'Event not found',
        });
      }

      if (!hasPermission) {
        return reply.status(403).send({
          success: false,
          message: 'Permission denied',
        });
      }

      // Delete event
      logger.info(`Event deleted: ${id} by ${payload.username}`);

      return reply.send({
        success: true,
        message: 'Event deleted successfully',
      });

    } catch (error) {
      logger.error('Delete event error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to delete event',
      });
    }
  });

  // Get meeting rooms
  fastify.get('/meeting-rooms', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Mock meeting rooms - replace with database query
      const meetingRooms = [
        {
          id: 'room_1',
          name: 'Conference Room A',
          capacity: 10,
          location: 'Floor 1',
          amenities: ['Projector', 'Whiteboard', 'Video Conference'],
          isAvailable: true,
        },
        {
          id: 'room_2',
          name: 'Conference Room B',
          capacity: 20,
          location: 'Floor 2',
          amenities: ['Projector', 'Whiteboard', 'Video Conference', 'Catering'],
          isAvailable: false,
        },
        {
          id: 'room_3',
          name: 'Small Meeting Room',
          capacity: 4,
          location: 'Floor 1',
          amenities: ['Whiteboard'],
          isAvailable: true,
        },
      ];

      return reply.send({
        success: true,
        meetingRooms,
      });

    } catch (error) {
      logger.error('Get meeting rooms error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get meeting rooms',
      });
    }
  });

  // Book meeting room
  fastify.post('/meeting-rooms/:roomId/book', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { roomId } = request.params as { roomId: string };
      const { startTime, endTime, eventId } = request.body as { startTime: string; endTime: string; eventId: string };
      const payload = request.user as any;

      // Check if room is available
      // In production, check database for conflicts
      const isAvailable = true; // Mock availability check

      if (!isAvailable) {
        return reply.status(409).send({
          success: false,
          message: 'Meeting room is not available for the requested time',
        });
      }

      // Book room
      const booking = {
        id: `booking_${Date.now()}`,
        roomId,
        eventId,
        startTime,
        endTime,
        bookedBy: payload.userId,
        bookedAt: new Date().toISOString(),
      };

      logger.info(`Meeting room booked: ${roomId} by ${payload.username}`);

      return reply.send({
        success: true,
        booking,
      });

    } catch (error) {
      logger.error('Book meeting room error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to book meeting room',
      });
    }
  });
}
