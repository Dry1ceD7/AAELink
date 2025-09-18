/**
 * AAELink Notifications API Routes
 * Handles push notifications, email notifications, and in-app notifications
 * Version: 1.0.0
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

// Validation schemas
const notificationSchema = z.object({
  type: z.enum(['email', 'push', 'in_app', 'sms']),
  recipient: z.string().email(),
  subject: z.string().min(1).max(200),
  content: z.string().min(1).max(1000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  scheduledAt: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional()
});

const notificationQuerySchema = z.object({
  type: z.enum(['email', 'push', 'in_app', 'sms']).optional(),
  status: z.enum(['pending', 'sent', 'delivered', 'failed']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20)
});

export default async function notificationRoutes(fastify: FastifyInstance) {
  // Send notification
  fastify.post('/send', {
    preHandler: [fastify.authenticate],
    schema: {
      body: notificationSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            sentAt: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const notification = request.body as z.infer<typeof notificationSchema>;
      
      // Create notification record
      const notificationRecord = await fastify.prisma.notification.create({
        data: {
          type: notification.type,
          recipient: notification.recipient,
          subject: notification.subject,
          content: notification.content,
          priority: notification.priority,
          scheduledAt: notification.scheduledAt ? new Date(notification.scheduledAt) : null,
          metadata: notification.metadata,
          status: 'pending',
          userId: (request as any).user.id
        }
      });

      // Process notification based on type
      let result;
      switch (notification.type) {
        case 'email':
          result = await sendEmailNotification(notification);
          break;
        case 'push':
          result = await sendPushNotification(notification);
          break;
        case 'in_app':
          result = await sendInAppNotification(notification);
          break;
        case 'sms':
          result = await sendSMSNotification(notification);
          break;
        default:
          throw new Error('Invalid notification type');
      }

      // Update notification status
      await fastify.prisma.notification.update({
        where: { id: notificationRecord.id },
        data: {
          status: result.success ? 'sent' : 'failed',
          sentAt: result.success ? new Date() : null,
          error: result.error || null
        }
      });

      return {
        id: notificationRecord.id,
        status: result.success ? 'sent' : 'failed',
        sentAt: result.success ? new Date().toISOString() : null
      };
    } catch (error) {
      fastify.log.error(`Failed to send notification: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ error: 'Failed to send notification' });
    }
  });

  // Get notifications
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: notificationQuerySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            notifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  subject: { type: 'string' },
                  content: { type: 'string' },
                  status: { type: 'string' },
                  priority: { type: 'string' },
                  createdAt: { type: 'string' },
                  sentAt: { type: 'string' }
                }
              }
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                limit: { type: 'number' },
                total: { type: 'number' },
                pages: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const query = request.query as z.infer<typeof notificationQuerySchema>;
      const userId = (request as any).user.id;

      const where: any = { userId };
      if (query.type) where.type = query.type;
      if (query.status) where.status = query.status;

      const [notifications, total] = await Promise.all([
        fastify.prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: {
            id: true,
            type: true,
            subject: true,
            content: true,
            status: true,
            priority: true,
            createdAt: true,
            sentAt: true
          }
        }),
        fastify.prisma.notification.count({ where })
      ]);

      return {
        notifications,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit)
        }
      };
    } catch (error) {
      fastify.log.error(`Failed to get notifications: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ error: 'Failed to get notifications' });
    }
  });

  // Get notification by ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            recipient: { type: 'string' },
            subject: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            metadata: { type: 'object' },
            createdAt: { type: 'string' },
            sentAt: { type: 'string' },
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = (request as any).user.id;

      const notification = await fastify.prisma.notification.findFirst({
        where: { id, userId }
      });

      if (!notification) {
        reply.code(404).send({ error: 'Notification not found' });
        return;
      }

      return notification;
    } catch (error) {
      fastify.log.error(`Failed to get notification: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ error: 'Failed to get notification' });
    }
  });

  // Mark notification as read
  fastify.patch('/:id/read', {
    preHandler: [fastify.authenticate],
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = (request as any).user.id;

      await fastify.prisma.notification.updateMany({
        where: { id, userId },
        data: { readAt: new Date() }
      });

      return { success: true };
    } catch (error) {
      fastify.log.error(`Failed to mark notification as read: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ error: 'Failed to mark notification as read' });
    }
  });

  // Delete notification
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = (request as any).user.id;

      await fastify.prisma.notification.deleteMany({
        where: { id, userId }
      });

      return { success: true };
    } catch (error) {
      fastify.log.error(`Failed to delete notification: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ error: 'Failed to delete notification' });
    }
  });

  // Get notification preferences
  fastify.get('/preferences', {
    preHandler: [fastify.authenticate],
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            email: { type: 'boolean' },
            push: { type: 'boolean' },
            inApp: { type: 'boolean' },
            sms: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = (request as any).user.id;

      const preferences = await fastify.prisma.notificationPreferences.findUnique({
        where: { userId }
      });

      return preferences || {
        email: true,
        push: true,
        inApp: true,
        sms: false
      };
    } catch (error) {
      fastify.log.error(`Failed to get notification preferences: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ error: 'Failed to get notification preferences' });
    }
  });

  // Update notification preferences
  const preferencesSchema = z.object({
    email: z.boolean(),
    push: z.boolean(),
    inApp: z.boolean(),
    sms: z.boolean()
  });

  fastify.put('/preferences', {
    preHandler: [fastify.authenticate],
    schema: {
      body: preferencesSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const userId = (request as any).user.id;
      const preferences = request.body as z.infer<typeof preferencesSchema>;

      await fastify.prisma.notificationPreferences.upsert({
        where: { userId },
        update: preferences,
        create: { userId, ...preferences }
      });

      return { success: true };
    } catch (error) {
      fastify.log.error(`Failed to update notification preferences: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ error: 'Failed to update notification preferences' });
    }
  });
}

// Helper functions for sending notifications
async function sendEmailNotification(notification: any): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement email sending logic
  // This would integrate with services like SendGrid, AWS SES, etc.
  return { success: true };
}

async function sendPushNotification(notification: any): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement push notification logic
  // This would integrate with FCM, APNS, etc.
  return { success: true };
}

async function sendInAppNotification(notification: any): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement in-app notification logic
  // This would use WebSocket or Server-Sent Events
  return { success: true };
}

async function sendSMSNotification(notification: any): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement SMS sending logic
  // This would integrate with services like Twilio, AWS SNS, etc.
  return { success: true };
}