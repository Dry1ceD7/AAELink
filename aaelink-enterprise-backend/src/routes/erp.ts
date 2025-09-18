import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../lib/logger';

export async function erpRoutes(fastify: FastifyInstance) {
  // Get inventory
  fastify.get('/inventory', {
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
      // Mock inventory data - replace with ERP4All integration
      const inventory = [
        { id: '1', name: 'Laptop Dell XPS 13', quantity: 25, price: 1299.99, category: 'Electronics' },
        { id: '2', name: 'Office Chair', quantity: 50, price: 299.99, category: 'Furniture' },
        { id: '3', name: 'Monitor 27"', quantity: 30, price: 399.99, category: 'Electronics' },
      ];

      return reply.send({
        success: true,
        inventory,
      });

    } catch (error) {
      logger.error('Get inventory error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get inventory',
      });
    }
  });

  // Get orders
  fastify.get('/orders', {
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
      // Mock orders data - replace with ERP4All integration
      const orders = [
        { id: '1', customer: 'ABC Corp', amount: 2500.00, status: 'pending', date: '2024-01-15' },
        { id: '2', customer: 'XYZ Ltd', amount: 1800.00, status: 'completed', date: '2024-01-14' },
        { id: '3', customer: 'DEF Inc', amount: 3200.00, status: 'processing', date: '2024-01-13' },
      ];

      return reply.send({
        success: true,
        orders,
      });

    } catch (error) {
      logger.error('Get orders error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get orders',
      });
    }
  });

  // Get timesheets
  fastify.get('/timesheets', {
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
      
      // Mock timesheets data - replace with ERP4All integration
      const timesheets = [
        { id: '1', userId: payload.userId, date: '2024-01-15', hours: 8.0, project: 'AAELink Development' },
        { id: '2', userId: payload.userId, date: '2024-01-14', hours: 7.5, project: 'AAELink Development' },
        { id: '3', userId: payload.userId, date: '2024-01-13', hours: 8.0, project: 'AAELink Development' },
      ];

      return reply.send({
        success: true,
        timesheets,
      });

    } catch (error) {
      logger.error('Get timesheets error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get timesheets',
      });
    }
  });
}
