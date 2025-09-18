import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { erp4AllService } from '../services/erp4all';

// ERP API Schemas
const employeeQuerySchema = z.object({
  page: z.string().optional().transform(val => val ? parseInt(val) : 1),
  limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
  department: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

const projectQuerySchema = z.object({
  page: z.string().optional().transform(val => val ? parseInt(val) : 1),
  limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
  status: z.string().optional(),
  managerId: z.string().optional(),
  search: z.string().optional(),
});

const timesheetQuerySchema = z.object({
  page: z.string().optional().transform(val => val ? parseInt(val) : 1),
  limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
  employeeId: z.string().optional(),
  projectId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
});

const reportQuerySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

export async function erpRoutes(fastify: FastifyInstance) {
  // Health Check
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await erp4AllService.healthCheck();
      return reply.status(result.success ? 200 : 500).send(result);
    } catch (error) {
      logger.error('ERP health check error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Health check failed'
      });
    }
  });

  // Employee Management
  fastify.get('/employees', {
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
      const query = employeeQuerySchema.parse(request.query);
      const result = await erp4AllService.getEmployees(query);

      return reply.status(result.success ? 200 : 400).send(result);
    } catch (error) {
      logger.error('Get employees error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch employees'
      });
    }
  });

  // Timesheet Management
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
      const query = timesheetQuerySchema.parse(request.query);
      const result = await erp4AllService.getTimesheets(query);

      return reply.status(result.success ? 200 : 400).send(result);
    } catch (error) {
      logger.error('Get timesheets error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch timesheets'
      });
    }
  });

  fastify.post('/timesheets', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    },
    schema: {
      body: z.object({
        employeeId: z.string(),
        projectId: z.string(),
        date: z.string(),
        hours: z.number().min(0).max(24),
        description: z.string().optional(),
      })
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const timesheetData = request.body as any;
      const result = await erp4AllService.createTimesheet(timesheetData);

      return reply.status(result.success ? 201 : 400).send(result);
    } catch (error) {
      logger.error('Create timesheet error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to create timesheet'
      });
    }
  });

  // Project Management
  fastify.get('/projects', {
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
      const query = projectQuerySchema.parse(request.query);
      const result = await erp4AllService.getProjects(query);

      return reply.status(result.success ? 200 : 400).send(result);
    } catch (error) {
      logger.error('Get projects error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch projects'
      });
    }
  });

  // Data Synchronization
  fastify.post('/sync/employees', {
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
      const result = await erp4AllService.syncEmployees();
      return reply.status(result.success ? 200 : 400).send(result);
    } catch (error) {
      logger.error('Sync employees error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to sync employees'
      });
    }
  });

  fastify.post('/sync/projects', {
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
      const result = await erp4AllService.syncProjects();
      return reply.status(result.success ? 200 : 400).send(result);
    } catch (error) {
      logger.error('Sync projects error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to sync projects'
      });
    }
  });

  fastify.post('/sync/timesheets', {
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
      const result = await erp4AllService.syncTimesheets();
      return reply.status(result.success ? 200 : 400).send(result);
    } catch (error) {
      logger.error('Sync timesheets error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to sync timesheets'
      });
    }
  });
}
