/**
 * OpenAPI Documentation Generator
 * Generates API documentation using @hono/zod-openapi
 */

import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';

// Import schemas
import { ErrorSchema, UserSchema } from '../db/schema.openapi';
import {
    AuthErrorSchema
} from '../routes/auth.openapi';

// Initialize OpenAPI Hono app
const app = new OpenAPIHono();

// OpenAPI metadata
app.openapi(
  '/doc',
  {
    info: {
      title: 'AAELink API Documentation',
      description: 'Comprehensive API documentation for the AAELink platform, providing a complete workspace solution with real-time messaging, file sharing, calendar, ERP integration, and more.',
      version: '1.0.0',
      contact: {
        name: 'AAELink Support',
        email: 'support@aaelink.com',
        url: 'https://aaelink.com/support',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:8080',
        description: 'Development Server',
      },
      {
        url: 'https://api.aaelink.com',
        description: 'Production Server',
      },
    ],
    tags: [
      { name: 'Auth', description: 'User authentication and session management' },
      { name: 'Users', description: 'User profile and settings' },
      { name: 'Messages', description: 'Real-time messaging' },
      { name: 'Files', description: 'File storage and sharing' },
      { name: 'Calendar', description: 'Events and scheduling' },
      { name: 'ERP', description: 'ERP integration' },
      { name: 'Admin', description: 'Administrative functions' },
    ],
    externalDocs: {
      description: 'Find out more about AAELink',
      url: 'https://aaelink.com',
    },
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-session',
          description: 'Session cookie for authentication',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Bearer token for API access (e.g., for external integrations)',
        },
      },
      schemas: {
        User: UserSchema,
        Error: ErrorSchema,
        AuthError: AuthErrorSchema,
      },
    },
    security: [
      {
        cookieAuth: [],
      },
    ],
  },
  (c) => {
    return c.json({
      message: 'Welcome to the AAELink API documentation!',
      docsUrl: '/doc/ui',
    });
  }
);

// Swagger UI
app.get(
  '/doc/ui',
  swaggerUI({
    url: '/doc',
  })
);

// Register routes
import { authRoutes } from '../routes/auth.openapi';
// import { userRoutes } from '../routes/users.openapi';
// import { messageRoutes } from '../routes/messages.openapi';
// import { fileRoutes } from '../routes/files.openapi';
// import { calendarRoutes } from '../routes/calendar.openapi';
// import { erpRoutes } from '../routes/erp.openapi';
// import { adminRoutes } from '../routes/admin.openapi';

app.route('/auth', authRoutes);
// app.route('/users', userRoutes);
// app.route('/messages', messageRoutes);
// app.route('/files', fileRoutes);
// app.route('/calendar', calendarRoutes);
// app.route('/erp', erpRoutes);
// app.route('/admin', adminRoutes);

export { app as openapiApp };
