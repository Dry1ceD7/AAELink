import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const calendarRouter = new Hono();

// Get events
calendarRouter.get('/events', (c) => {
  return c.json({ events: [] });
});

// Create event
calendarRouter.post('/events', zValidator('json', z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional()
})), (c) => {
  const event = c.req.valid('json');
  return c.json({ 
    message: 'Event created',
    event: { ...event, id: Date.now().toString() }
  });
});

// Update event
calendarRouter.put('/events/:id', zValidator('json', z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional()
})), (c) => {
  const id = c.req.param('id');
  const updates = c.req.valid('json');
  return c.json({ 
    message: 'Event updated',
    event: { id, ...updates }
  });
});

// Delete event
calendarRouter.delete('/events/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ 
    message: 'Event deleted',
    id
  });
});

export { calendarRouter };
