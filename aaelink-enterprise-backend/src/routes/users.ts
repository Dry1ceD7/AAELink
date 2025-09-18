import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../lib/logger';

export async function userRoutes(fastify: FastifyInstance) {
  // Get user profile
  fastify.get('/profile', {
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
      const payload = request.user as any;
      
      // Mock user profile - replace with database query
      const profile = {
        id: payload.userId,
        username: payload.username,
        email: payload.email,
        role: payload.role,
        avatar: payload.username.charAt(0).toUpperCase(),
        status: 'online',
        lastSeen: new Date().toISOString(),
      };

      return reply.send({
        success: true,
        profile,
      });

    } catch (error) {
      logger.error('Get profile error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get profile',
      });
    }
  });

  // Get online users
  fastify.get('/online', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Mock online users - replace with real-time data
      const onlineUsers = [
        { id: '1', name: 'John Doe', status: 'online', avatar: 'JD' },
        { id: '2', name: 'Alice Smith', status: 'away', avatar: 'AS' },
        { id: '3', name: 'Mike Johnson', status: 'online', avatar: 'MJ' },
        { id: '4', name: 'Sarah Wilson', status: 'busy', avatar: 'SW' },
      ];

      return reply.send({
        success: true,
        users: onlineUsers,
      });

    } catch (error) {
      logger.error('Get online users error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get online users',
      });
    }
  });
}
