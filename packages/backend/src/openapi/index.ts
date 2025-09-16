import { swaggerUI } from '@hono/swagger-ui';
import { Hono } from 'hono';

// OpenAPI documentation app
const openapiApp = new Hono();

// Swagger UI route
openapiApp.get('/docs', swaggerUI({
  url: '/api-docs.json',
  title: 'AAELink API Documentation'
}));

// OpenAPI JSON route
openapiApp.get('/api-docs.json', (c) => {
  return c.json({
    openapi: '3.0.0',
    info: {
      title: 'AAELink API',
      version: '2.0.0',
      description: 'Enterprise workspace platform API'
    },
    servers: [
      {
        url: 'http://localhost:8080',
        description: 'Development server'
      }
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            '200': {
              description: 'Service is healthy'
            }
          }
        }
      }
    }
  });
});

export { openapiApp };
