import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';

// Input validation schemas
const messageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(2000, 'Message too long'),
  channelId: z.string().min(1, 'Channel ID is required'),
  type: z.enum(['text', 'file', 'image', 'voice']).default('text'),
});

const channelSchema = z.object({
  name: z.string().min(1, 'Channel name is required').max(50, 'Channel name too long'),
  type: z.enum(['text', 'voice']).default('text'),
});


export async function chatRoutes(fastify: FastifyInstance) {
  // Get messages for a channel
  fastify.get('/messages/:channelId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { channelId } = request.params as { channelId: string };

      // Mock messages - replace with database query
      const messages = [
        {
          id: '1',
          content: 'Welcome to AAELink Enterprise!',
          channelId,
          authorId: 'admin',
          authorName: 'Admin User',
          timestamp: new Date().toISOString(),
          type: 'text',
        },
        {
          id: '2',
          content: 'This is a secure workspace for AAE employees.',
          channelId,
          authorId: 'admin',
          authorName: 'Admin User',
          timestamp: new Date(Date.now() - 60000).toISOString(),
          type: 'text',
        },
      ];

      return reply.send({
        success: true,
        messages,
      });

    } catch (error) {
      logger.error('Get messages error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch messages',
      });
    }
  });

  // Send a message
  fastify.post('/messages', {
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
      const { content, channelId, type } = messageSchema.parse(request.body);
      const payload = request.user as any;

      // In production, save to database
      const message = {
        id: Date.now().toString(),
        content,
        channelId,
        authorId: payload.userId,
        authorName: payload.username,
        timestamp: new Date().toISOString(),
        type,
      };

      logger.info(`Message sent by ${payload.username} in channel ${channelId}`);

      // Broadcast to WebSocket clients
      if (global.io) {
        global.io.emit('message', message);
      }

      return reply.send({
        success: true,
        message,
      });

    } catch (error) {
      logger.error('Send message error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Failed to send message',
      });
    }
  });

  // Get channels
  fastify.get('/channels', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Mock channels - replace with database query
      const channels = [
        { id: 'general', name: 'general', type: 'text', unread: 0 },
        { id: 'announcements', name: 'announcements', type: 'text', unread: 3 },
        { id: 'development', name: 'development', type: 'text', unread: 0 },
        { id: 'design', name: 'design', type: 'text', unread: 1 },
        { id: 'marketing', name: 'marketing', type: 'text', unread: 0 },
      ];

      return reply.send({
        success: true,
        channels,
      });

    } catch (error) {
      logger.error('Get channels error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch channels',
      });
    }
  });
}
