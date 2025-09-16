import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

const adminRouter = new Hono();

// Admin health check
adminRouter.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'admin',
    timestamp: new Date().toISOString()
  });
});

// Get system stats
adminRouter.get('/stats', (c) => {
  return c.json({
    users: 0,
    organizations: 0,
    channels: 0,
    messages: 0,
    files: 0,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// User management
adminRouter.get('/users', (c) => {
  return c.json({ users: [] });
});

adminRouter.post('/users', zValidator('json', z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: z.enum(['user', 'org_admin', 'sysadmin']).default('user')
})), (c) => {
  const { email, displayName, role } = c.req.valid('json');

  return c.json({
    message: 'User created',
    user: { email, displayName, role }
  });
});

// Organization management
adminRouter.get('/organizations', (c) => {
  return c.json({ organizations: [] });
});

adminRouter.post('/organizations', zValidator('json', z.object({
  name: z.string().min(1),
  description: z.string().optional()
})), (c) => {
  const { name, description } = c.req.valid('json');

  return c.json({
    message: 'Organization created',
    organization: { name, description }
  });
});

export { adminRouter };
