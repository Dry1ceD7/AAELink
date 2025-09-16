/**
 * Security Middleware
 * Applies security best practices like CORS, CSP, and secure headers.
 */

import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

const isProduction = process.env.NODE_ENV === 'production';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * CORS Configuration
 */
export const corsMiddleware = () => {
  return cors({
    origin: isProduction ? frontendUrl : '*',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 600,
  });
};

/**
 * Secure Headers Configuration (powered by Helmet)
 */
export const secureHeadersMiddleware = () => {
  return secureHeaders({
    // Content Security Policy (CSP)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", `ws://localhost:8080`, `wss://${process.env.DOMAIN}`],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // HTTP Strict Transport Security (HSTS)
    strictTransportSecurity: isProduction ? 'max-age=31536000; includeSubDomains; preload' : undefined,
    // X-Content-Type-Options
    xContentTypeOptions: 'nosniff',
    // X-DNS-Prefetch-Control
    xDnsPrefetchControl: 'off',
    // X-Download-Options
    xDownloadOptions: 'noopen',
    // X-Frame-Options
    xFrameOptions: 'SAMEORIGIN',
    // X-Permitted-Cross-Domain-Policies
    xPermittedCrossDomainPolicies: 'none',
    // X-XSS-Protection
    xXssProtection: '1; mode=block',
    // Referrer-Policy
    referrerPolicy: 'strict-origin-when-cross-origin',
    // Permissions-Policy
    permissionsPolicy: {
      camera: [],
      'display-capture': [],
      fullscreen: ['self'],
      geolocation: [],
      microphone: [],
      'payment': [],
      'web-share': [],
    },
    // Cross-Origin-Embedder-Policy
    crossOriginEmbedderPolicy: 'require-corp',
    // Cross-Origin-Opener-Policy
    crossOriginOpenerPolicy: 'same-origin',
    // Cross-Origin-Resource-Policy
    crossOriginResourcePolicy: 'same-origin',
  });
};
