import { FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../lib/logger';

export async function adminRoutes(fastify: any) {
  // Admin dashboard stats
  fastify.get('/stats', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
        const payload = request.user as any;

        if (payload.role !== 'admin') {
          return reply.status(403).send({
            success: false,
            message: 'Admin access required',
          });
        }
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Mock admin stats - replace with real data
      const stats = {
        totalUsers: 200,
        activeUsers: 45,
        totalMessages: 15420,
        totalFiles: 892,
        systemHealth: 'healthy',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      };

      return reply.send({
        success: true,
        stats,
      });

    } catch (error) {
      logger.error('Get admin stats error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get admin stats',
      });
    }
  });

  // System health check
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.2.0',
        environment: process.env.NODE_ENV || 'development',
      };

      return reply.send({
        success: true,
        health,
      });

    } catch (error) {
      logger.error('Health check error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Health check failed',
      });
    }
  });
}
