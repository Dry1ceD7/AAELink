/**
 * AAELink Backend Server
 * Built with Bun + Hono for high performance
 * BMAD Method: Core backend orchestration
 */

import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { logger } from 'hono/logger';
import { createServer } from 'http';

// Import routers
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { calendarRouter } from './routes/calendar';
import { erpRouter } from './routes/erp';
import { filesRouter } from './routes/files';
import { messagesRouter } from './routes/messages';
import { searchRouter } from './routes/search';

// Import OpenAPI documentation
import { openapiApp } from './openapi';

// Import middleware
import { auditMiddleware } from './middleware/audit';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { sessionMiddleware } from './middleware/session';
import { corsMiddleware, secureHeadersMiddleware } from './middleware/security';

// Import services
import { initializeDatabase } from './db';
import { initializeObservability } from './services/observability';
import { initializeRedis } from './services/redis';
import { initializeMinIO } from './services/storage';
import { initializeWebSocket } from './services/websocket';

// Environment configuration
const PORT = parseInt(process.env.PORT || '8080');
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize Hono app
const app = new Hono();

// Middleware
app.use(logger()); // Request logger
app.use(compress()); // Gzip compression
app.use(corsMiddleware()); // CORS for frontend
app.use(secureHeadersMiddleware()); // Security headers
app.use(csrf()); // CSRF protection
app.use(sessionMiddleware()); // Session management
app.use(rateLimitMiddleware); // Rate limiting

// Audit logging for mutations
app.use('/api/*', auditMiddleware);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
});

// API routes
app.route('/api/auth', authRouter);
app.route('/api/messages', messagesRouter);
app.route('/api/files', filesRouter);
app.route('/api/search', searchRouter);
app.route('/api/calendar', calendarRouter);
app.route('/api/erp', erpRouter);
app.route('/api/admin', adminRouter);

// OpenAPI Documentation
app.route('/', openapiApp);

// Root route
app.get('/', (c) => {
  return c.json({ message: 'AAELink Backend API' });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);

  // Don't leak internal errors in production
  if (NODE_ENV === 'production') {
    return c.json({
      error: 'Internal server error',
      traceId: c.get('traceId'),
    }, 500);
  }

  return c.json({
    error: err.message,
    stack: err.stack,
    traceId: c.get('traceId'),
  }, 500);
});

// Initialize services
async function startServer() {
  try {
    console.log('🚀 Starting AAELink Backend...');

    // Initialize database
    await initializeDatabase();
    console.log('✅ Database connected');

    // Initialize Redis
    await initializeRedis();
    console.log('✅ Redis connected');

    // Initialize MinIO
    await initializeMinIO();
    console.log('✅ MinIO connected');

    // Initialize observability
    await initializeObservability();
    console.log('✅ Observability initialized');

    // Create HTTP server for both API and WebSocket
    const server = createServer(app.fetch);

    // Initialize WebSocket server
    const wss = await initializeWebSocket(server);
    console.log('✅ WebSocket server initialized');

    // Start listening
    server.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════╗
║     AAELink Backend Server Running     ║
╠════════════════════════════════════════╣
║   Environment: ${NODE_ENV.padEnd(24)}║
║   Port: ${PORT.toString().padEnd(31)}║
║   API: http://localhost:${PORT}/api      ║
║   WebSocket: ws://localhost:${PORT}      ║
║   Health: http://localhost:${PORT}/health║
╚════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully...');
      server.close();
      wss.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
