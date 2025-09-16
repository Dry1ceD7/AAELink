import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

const searchRouter = new Hono();

// Global search
searchRouter.get('/', zValidator('query', z.object({
  q: z.string().min(1),
  type: z.enum(['all', 'messages', 'files', 'users', 'channels']).optional().default('all'),
  limit: z.string().transform(Number).optional().default(20),
  offset: z.string().transform(Number).optional().default(0)
})), (c) => {
  const { q, type, limit, offset } = c.req.valid('query');

  return c.json({
    query: q,
    type,
    results: [],
    total: 0,
    limit,
    offset,
    hasMore: false
  });
});

// Search messages
searchRouter.get('/messages', zValidator('query', z.object({
  q: z.string().min(1),
  channelId: z.string().optional(),
  userId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.string().transform(Number).optional().default(20)
})), (c) => {
  const params = c.req.valid('query');

  return c.json({
    query: params.q,
    results: [],
    total: 0,
    filters: {
      channelId: params.channelId,
      userId: params.userId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo
    }
  });
});

// Search files
searchRouter.get('/files', zValidator('query', z.object({
  q: z.string().min(1),
  type: z.string().optional(),
  channelId: z.string().optional(),
  limit: z.string().transform(Number).optional().default(20)
})), (c) => {
  const params = c.req.valid('query');

  return c.json({
    query: params.q,
    results: [],
    total: 0,
    filters: {
      type: params.type,
      channelId: params.channelId
    }
  });
});

// Search suggestions
searchRouter.get('/suggestions', zValidator('query', z.object({
  q: z.string().min(1),
  type: z.enum(['users', 'channels', 'hashtags']).optional()
})), (c) => {
  const { q, type } = c.req.valid('query');

  return c.json({
    query: q,
    type,
    suggestions: []
  });
});

export { searchRouter };
