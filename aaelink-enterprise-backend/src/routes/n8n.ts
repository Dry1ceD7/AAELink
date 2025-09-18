import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { n8nService } from '../services/n8n-automation';

const workflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  active: z.boolean().default(true),
  nodes: z.array(z.any()),
  connections: z.any(),
  settings: z.any().optional()
});

const executionSchema = z.object({
  workflowId: z.string(),
  data: z.any().optional()
});

export async function n8nRoutes(fastify: FastifyInstance) {
  // Get all workflows
  fastify.get('/workflows', async (request, reply) => {
    try {
      const workflows = await n8nService.getWorkflows();
      return { success: true, data: workflows };
    } catch (error) {
      fastify.log.error('Error fetching workflows:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch workflows' 
      });
    }
  });

  // Get specific workflow
  fastify.get('/workflows/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const workflow = await n8nService.getWorkflow(id);
      return { success: true, data: workflow };
    } catch (error) {
      fastify.log.error('Error fetching workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch workflow' 
      });
    }
  });

  // Create new workflow
  fastify.post('/workflows', {
    schema: {
      body: workflowSchema
    }
  }, async (request, reply) => {
    try {
      const workflowData = request.body as any;
      const workflow = await n8nService.createWorkflow(workflowData);
      return { success: true, data: workflow };
    } catch (error) {
      fastify.log.error('Error creating workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to create workflow' 
      });
    }
  });

  // Update workflow
  fastify.put('/workflows/:id', {
    schema: {
      body: workflowSchema.partial()
    }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const workflowData = request.body as any;
      const workflow = await n8nService.updateWorkflow(id, workflowData);
      return { success: true, data: workflow };
    } catch (error) {
      fastify.log.error('Error updating workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to update workflow' 
      });
    }
  });

  // Delete workflow
  fastify.delete('/workflows/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await n8nService.deleteWorkflow(id);
      return { success: true, message: 'Workflow deleted successfully' };
    } catch (error) {
      fastify.log.error('Error deleting workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to delete workflow' 
      });
    }
  });

  // Activate workflow
  fastify.post('/workflows/:id/activate', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await n8nService.activateWorkflow(id);
      return { success: true, message: 'Workflow activated successfully' };
    } catch (error) {
      fastify.log.error('Error activating workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to activate workflow' 
      });
    }
  });

  // Deactivate workflow
  fastify.post('/workflows/:id/deactivate', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await n8nService.deactivateWorkflow(id);
      return { success: true, message: 'Workflow deactivated successfully' };
    } catch (error) {
      fastify.log.error('Error deactivating workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to deactivate workflow' 
      });
    }
  });

  // Get executions
  fastify.get('/executions', async (request, reply) => {
    try {
      const { workflowId, limit } = request.query as { 
        workflowId?: string; 
        limit?: string 
      };
      const executions = await n8nService.getExecutions(
        workflowId, 
        limit ? parseInt(limit) : 20
      );
      return { success: true, data: executions };
    } catch (error) {
      fastify.log.error('Error fetching executions:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch executions' 
      });
    }
  });

  // Get specific execution
  fastify.get('/executions/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const execution = await n8nService.getExecution(id);
      return { success: true, data: execution };
    } catch (error) {
      fastify.log.error('Error fetching execution:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch execution' 
      });
    }
  });

  // Execute workflow
  fastify.post('/workflows/:id/execute', {
    schema: {
      body: executionSchema.omit({ workflowId: true })
    }
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { data } = request.body as any;
      const execution = await n8nService.executeWorkflow(id, data);
      return { success: true, data: execution };
    } catch (error) {
      fastify.log.error('Error executing workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to execute workflow' 
      });
    }
  });

  // Stop execution
  fastify.post('/executions/:id/stop', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await n8nService.stopExecution(id);
      return { success: true, message: 'Execution stopped successfully' };
    } catch (error) {
      fastify.log.error('Error stopping execution:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to stop execution' 
      });
    }
  });

  // Test N8N connection
  fastify.get('/test-connection', async (request, reply) => {
    try {
      const isConnected = await n8nService.testConnection();
      return { 
        success: true, 
        connected: isConnected,
        message: isConnected ? 'N8N connection successful' : 'N8N connection failed'
      };
    } catch (error) {
      fastify.log.error('Error testing N8N connection:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to test N8N connection' 
      });
    }
  });

  // Get workflow statistics
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await n8nService.getWorkflowStats();
      return { success: true, data: stats };
    } catch (error) {
      fastify.log.error('Error fetching workflow stats:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch workflow stats' 
      });
    }
  });

  // Create pre-built workflows
  fastify.post('/workflows/create-user-provisioning', async (request, reply) => {
    try {
      const workflow = await n8nService.createUserProvisioningWorkflow();
      return { success: true, data: workflow };
    } catch (error) {
      fastify.log.error('Error creating user provisioning workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to create user provisioning workflow' 
      });
    }
  });

  fastify.post('/workflows/create-erp-sync', async (request, reply) => {
    try {
      const workflow = await n8nService.createERPSyncWorkflow();
      return { success: true, data: workflow };
    } catch (error) {
      fastify.log.error('Error creating ERP sync workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to create ERP sync workflow' 
      });
    }
  });

  fastify.post('/workflows/create-notification', async (request, reply) => {
    try {
      const workflow = await n8nService.createNotificationWorkflow();
      return { success: true, data: workflow };
    } catch (error) {
      fastify.log.error('Error creating notification workflow:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to create notification workflow' 
      });
    }
  });

  // Webhook endpoints for workflow triggers
  fastify.post('/webhooks/user-created', async (request, reply) => {
    try {
      const userData = request.body as any;
      fastify.log.info('User created webhook triggered:', userData);
      
      // This would trigger the user provisioning workflow
      // In a real implementation, you'd call the N8N webhook URL
      
      return { success: true, message: 'User creation webhook received' };
    } catch (error) {
      fastify.log.error('Error processing user created webhook:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to process user created webhook' 
      });
    }
  });

  fastify.post('/webhooks/notification', async (request, reply) => {
    try {
      const notificationData = request.body as any;
      fastify.log.info('Notification webhook triggered:', notificationData);
      
      // This would trigger the notification workflow
      // In a real implementation, you'd call the N8N webhook URL
      
      return { success: true, message: 'Notification webhook received' };
    } catch (error) {
      fastify.log.error('Error processing notification webhook:', error);
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to process notification webhook' 
      });
    }
  });
}
