/**
 * Audit Middleware
 * Track user actions and security events
 */

import { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { auditLogs } from '../db/schema';
import { nanoid } from 'nanoid';

export interface AuditEvent {
  userId?: string;
  sessionId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

/**
 * Log audit event
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: nanoid(),
      userId: event.userId,
      sessionId: event.sessionId,
      action: event.action,
      resource: event.resource,
      resourceId: event.resourceId,
      details: event.details,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      success: event.success,
      errorMessage: event.errorMessage,
      createdAt: new Date(),
    });
  } catch (error) {
    // Don't throw on audit log failure - just log it
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Extract client info from request
 */
function getClientInfo(c: Context) {
  const forwarded = c.req.header('X-Forwarded-For');
  const ipAddress = forwarded ? 
    forwarded.split(',')[0].trim() : 
    c.req.header('X-Real-IP') || 
    'unknown';
  
  const userAgent = c.req.header('User-Agent') || 'unknown';
  
  return { ipAddress, userAgent };
}

/**
 * Audit middleware
 */
export const auditMiddleware = () => {
  return createMiddleware(async (c: Context, next: Next) => {
    const startTime = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const { ipAddress, userAgent } = getClientInfo(c);
    
    // Skip audit for health checks and static assets
    if (
      path === '/health' ||
      path.startsWith('/static') ||
      path.startsWith('/assets') ||
      method === 'OPTIONS'
    ) {
      await next();
      return;
    }
    
    let success = true;
    let errorMessage: string | undefined;
    
    try {
      await next();
      
      // Check if response indicates failure
      const status = c.res.status;
      success = status < 400;
      
      if (!success) {
        try {
          const response = await c.res.clone().json();
          errorMessage = response.error || `HTTP ${status}`;
        } catch {
          errorMessage = `HTTP ${status}`;
        }
      }
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw error; // Re-throw to maintain normal error handling
    } finally {
      // Log significant actions
      const session = c.get('session');
      const shouldLog = shouldLogAction(method, path, success);
      
      if (shouldLog) {
        const event: AuditEvent = {
          userId: session?.userId,
          sessionId: extractSessionId(c),
          action: getActionName(method, path),
          resource: getResourceName(path),
          resourceId: getResourceId(path),
          details: {
            method,
            path,
            duration: Date.now() - startTime,
            status: c.res.status,
          },
          ipAddress,
          userAgent,
          success,
          errorMessage,
        };
        
        // Don't await to avoid slowing down response
        logAuditEvent(event).catch(console.error);
      }
    }
  });
};

/**
 * Determine if action should be logged
 */
function shouldLogAction(method: string, path: string, success: boolean): boolean {
  // Always log authentication events
  if (path.includes('/auth/')) return true;
  
  // Always log failures
  if (!success) return true;
  
  // Log state-changing operations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
  
  // Log sensitive read operations
  if (method === 'GET' && (
    path.includes('/admin/') ||
    path.includes('/users/') ||
    path.includes('/sensitive/')
  )) return true;
  
  return false;
}

/**
 * Generate action name from method and path
 */
function getActionName(method: string, path: string): string {
  // Authentication actions
  if (path.includes('/auth/login')) return 'auth.login';
  if (path.includes('/auth/logout')) return 'auth.logout';
  if (path.includes('/auth/register')) return 'auth.register';
  
  // Message actions
  if (path.includes('/messages')) {
    switch (method) {
      case 'POST': return 'message.create';
      case 'PUT':
      case 'PATCH': return 'message.update';
      case 'DELETE': return 'message.delete';
      case 'GET': return 'message.read';
    }
  }
  
  // File actions
  if (path.includes('/files')) {
    if (path.includes('/upload')) return 'file.upload';
    if (path.includes('/download')) return 'file.download';
    switch (method) {
      case 'POST': return 'file.create';
      case 'DELETE': return 'file.delete';
      case 'GET': return 'file.access';
    }
  }
  
  // Admin actions
  if (path.includes('/admin/')) {
    return `admin.${method.toLowerCase()}`;
  }
  
  // Generic action
  return `${method.toLowerCase()}.${getResourceName(path)}`;
}

/**
 * Extract resource name from path
 */
function getResourceName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  
  // Remove 'api' prefix if present
  if (segments[0] === 'api') segments.shift();
  
  // Return first segment as resource type
  return segments[0] || 'unknown';
}

/**
 * Extract resource ID from path
 */
function getResourceId(path: string): string | undefined {
  const segments = path.split('/').filter(Boolean);
  
  // Look for UUID-like patterns or numeric IDs
  for (const segment of segments) {
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
      /^\d+$/.test(segment) ||
      /^[a-zA-Z0-9_-]{10,}$/.test(segment)
    ) {
      return segment;
    }
  }
  
  return undefined;
}

/**
 * Extract session ID from request
 */
function extractSessionId(c: Context): string | undefined {
  const cookieHeader = c.req.header('Cookie');
  if (!cookieHeader) return undefined;
  
  const sessionMatch = cookieHeader.match(/__Host-session=([^;]+)/);
  return sessionMatch ? sessionMatch[1] : undefined;
}

/**
 * Log specific audit events
 */
export const auditEvents = {
  login: async (c: Context, userId: string, success: boolean, errorMessage?: string) => {
    const { ipAddress, userAgent } = getClientInfo(c);
    await logAuditEvent({
      userId,
      action: 'auth.login',
      ipAddress,
      userAgent,
      success,
      errorMessage,
    });
  },
  
  logout: async (c: Context, userId: string) => {
    const { ipAddress, userAgent } = getClientInfo(c);
    await logAuditEvent({
      userId,
      action: 'auth.logout',
      ipAddress,
      userAgent,
      success: true,
    });
  },
  
  register: async (c: Context, userId: string, email: string, success: boolean, errorMessage?: string) => {
    const { ipAddress, userAgent } = getClientInfo(c);
    await logAuditEvent({
      userId,
      action: 'auth.register',
      details: { email },
      ipAddress,
      userAgent,
      success,
      errorMessage,
    });
  },
  
  passwordChange: async (c: Context, userId: string, success: boolean) => {
    const { ipAddress, userAgent } = getClientInfo(c);
    await logAuditEvent({
      userId,
      action: 'auth.password_change',
      ipAddress,
      userAgent,
      success,
    });
  },
  
  permissionDenied: async (c: Context, action: string, resource?: string) => {
    const session = c.get('session');
    const { ipAddress, userAgent } = getClientInfo(c);
    await logAuditEvent({
      userId: session?.userId,
      action: 'security.permission_denied',
      resource,
      details: { attemptedAction: action },
      ipAddress,
      userAgent,
      success: false,
      errorMessage: 'Permission denied',
    });
  },
  
  dataExport: async (c: Context, userId: string, dataType: string, recordCount: number) => {
    const { ipAddress, userAgent } = getClientInfo(c);
    await logAuditEvent({
      userId,
      action: 'data.export',
      resource: dataType,
      details: { recordCount },
      ipAddress,
      userAgent,
      success: true,
    });
  },
  
  configChange: async (c: Context, userId: string, setting: string, oldValue: any, newValue: any) => {
    const { ipAddress, userAgent } = getClientInfo(c);
    await logAuditEvent({
      userId,
      action: 'config.change',
      resource: 'settings',
      resourceId: setting,
      details: { oldValue, newValue },
      ipAddress,
      userAgent,
      success: true,
    });
  },
};
