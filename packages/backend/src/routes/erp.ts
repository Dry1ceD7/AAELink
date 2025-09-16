import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

const erpRouter = new Hono();

// Get ERP data
erpRouter.get('/data/:entity', (c) => {
  const entity = c.req.param('entity');
  return c.json({
    entity,
    data: [],
    message: 'ERP data retrieved'
  });
});

// Sync ERP data
erpRouter.post('/sync', zValidator('json', z.object({
  entity: z.string(),
  lastSync: z.string().datetime().optional()
})), (c) => {
  const { entity, lastSync } = c.req.valid('json');
  return c.json({
    message: 'ERP sync initiated',
    entity,
    lastSync: new Date().toISOString()
  });
});

// Get ERP status
erpRouter.get('/status', (c) => {
  return c.json({
    status: 'connected',
    lastSync: new Date().toISOString(),
    entities: ['customers', 'products', 'orders', 'inventory']
  });
});

export { erpRouter };
