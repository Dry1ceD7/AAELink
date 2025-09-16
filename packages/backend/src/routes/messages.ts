import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const messagesRouter = new Hono();

// Get messages for a channel
messagesRouter.get('/:channelId', zValidator('query', z.object({
  limit: z.string().transform(Number).optional().default(50),
  before: z.string().optional(),
  after: z.string().optional()
})), (c) => {
  const channelId = c.req.param('channelId');
  const { limit, before, after } = c.req.valid('query');
  
  return c.json({ 
    messages: [],
    channelId,
    limit,
    hasMore: false
  });
});

// Create message
messagesRouter.post('/', zValidator('json', z.object({
  channelId: z.string(),
  content: z.string().min(1),
  type: z.enum(['text', 'file', 'image', 'system']).default('text'),
  replyTo: z.string().optional(),
  attachments: z.array(z.string()).optional()
})), (c) => {
  const message = c.req.valid('json');
  
  return c.json({ 
    message: {
      ...message,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
});

// Update message
messagesRouter.put('/:id', zValidator('json', z.object({
  content: z.string().min(1)
})), (c) => {
  const id = c.req.param('id');
  const { content } = c.req.valid('json');
  
  return c.json({ 
    message: 'Message updated',
    id,
    content,
    updatedAt: new Date().toISOString()
  });
});

// Delete message
messagesRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ 
    message: 'Message deleted',
    id
  });
});

// React to message
messagesRouter.post('/:id/react', zValidator('json', z.object({
  emoji: z.string().min(1)
})), (c) => {
  const id = c.req.param('id');
  const { emoji } = c.req.valid('json');
  
  return c.json({ 
    message: 'Reaction added',
    id,
    emoji
  });
});

export { messagesRouter };