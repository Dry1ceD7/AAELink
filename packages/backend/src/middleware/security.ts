import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

// CORS middleware
export function corsMiddleware() {
  return cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  });
}

// Security headers middleware
export function secureHeadersMiddleware() {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  });
}