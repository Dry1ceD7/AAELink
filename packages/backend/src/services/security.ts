/**
 * Security Service
 * Handles audit logging, security policies, and compliance
 */

import { createHash, randomBytes } from 'crypto';

interface AuditLog {
  id: string;
  timestamp: string;
  userId?: string;
  action: string;
  resource: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  details?: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  rules: SecurityRule[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SecurityRule {
  id: string;
  type: 'rate_limit' | 'ip_whitelist' | 'password_policy' | 'session_timeout' | 'file_upload';
  condition: string;
  action: 'allow' | 'deny' | 'warn' | 'log';
  parameters: Record<string, any>;
}

interface SecurityEvent {
  id: string;
  type: 'login_attempt' | 'file_upload' | 'api_access' | 'data_export' | 'admin_action';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, any>;
  timestamp: string;
  resolved: boolean;
}

class SecurityService {
  private auditLogs: AuditLog[] = [];
  private securityEvents: SecurityEvent[] = [];
  private securityPolicies: SecurityPolicy[] = [];
  private ipWhitelist: Set<string> = new Set();
  private failedLoginAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();
  private sessionTimeouts: Map<string, number> = new Map();

  constructor() {
    this.initializeDefaultPolicies();
    this.initializeWhitelist();
  }

  private initializeDefaultPolicies() {
    this.securityPolicies = [
      {
        id: 'policy_1',
        name: 'Password Policy',
        description: 'Enforce strong password requirements',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rules: [
          {
            id: 'rule_1',
            type: 'password_policy',
            condition: 'password_strength',
            action: 'deny',
            parameters: {
              minLength: 8,
              requireUppercase: true,
              requireLowercase: true,
              requireNumbers: true,
              requireSpecialChars: true
            }
          }
        ]
      },
      {
        id: 'policy_2',
        name: 'Rate Limiting',
        description: 'Prevent abuse with rate limiting',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rules: [
          {
            id: 'rule_2',
            type: 'rate_limit',
            condition: 'api_requests',
            action: 'deny',
            parameters: {
              maxRequests: 100,
              windowMs: 900000 // 15 minutes
            }
          }
        ]
      },
      {
        id: 'policy_3',
        name: 'File Upload Security',
        description: 'Secure file upload policies',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rules: [
          {
            id: 'rule_3',
            type: 'file_upload',
            condition: 'file_type_validation',
            action: 'deny',
            parameters: {
              allowedTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'],
              maxSize: 10485760 // 10MB
            }
          }
        ]
      }
    ];
  }

  private initializeWhitelist() {
    // Add localhost and common development IPs
    this.ipWhitelist.add('127.0.0.1');
    this.ipWhitelist.add('::1');
    this.ipWhitelist.add('localhost');
  }

  public async logAuditEvent(event: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> {
    const auditLog: AuditLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...event
    };

    this.auditLogs.push(auditLog);
    
    // Keep only last 10000 logs in memory
    if (this.auditLogs.length > 10000) {
      this.auditLogs = this.auditLogs.slice(-10000);
    }

    console.log(`[AUDIT] ${event.action} by ${event.userId || 'anonymous'} - ${event.success ? 'SUCCESS' : 'FAILED'}`);
  }

  public async logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp' | 'resolved'>): Promise<void> {
    const securityEvent: SecurityEvent = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      resolved: false,
      ...event
    };

    this.securityEvents.push(securityEvent);

    // Keep only last 5000 events in memory
    if (this.securityEvents.length > 5000) {
      this.securityEvents = this.securityEvents.slice(-5000);
    }

    console.log(`[SECURITY] ${event.type} - ${event.severity.toUpperCase()} - ${event.userId || 'anonymous'}`);
  }

  public async validatePassword(password: string): Promise<{ valid: boolean; errors: string[] }> {
    const policy = this.securityPolicies.find(p => p.name === 'Password Policy');
    if (!policy || !policy.enabled) {
      return { valid: true, errors: [] };
    }

    const rule = policy.rules.find(r => r.type === 'password_policy');
    if (!rule) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];
    const params = rule.parameters;

    if (password.length < params.minLength) {
      errors.push(`Password must be at least ${params.minLength} characters long`);
    }

    if (params.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (params.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (params.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (params.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return { valid: errors.length === 0, errors };
  }

  public async validateFileUpload(file: { name: string; size: number; type: string }): Promise<{ valid: boolean; errors: string[] }> {
    const policy = this.securityPolicies.find(p => p.name === 'File Upload Security');
    if (!policy || !policy.enabled) {
      return { valid: true, errors: [] };
    }

    const rule = policy.rules.find(r => r.type === 'file_upload');
    if (!rule) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];
    const params = rule.parameters;

    if (!params.allowedTypes.includes(file.type)) {
      errors.push(`File type ${file.type} is not allowed`);
    }

    if (file.size > params.maxSize) {
      errors.push(`File size ${file.size} exceeds maximum allowed size of ${params.maxSize} bytes`);
    }

    // Check for potentially dangerous file extensions
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (dangerousExtensions.includes(fileExtension)) {
      errors.push(`File extension ${fileExtension} is not allowed for security reasons`);
    }

    return { valid: errors.length === 0, errors };
  }

  public async checkRateLimit(ipAddress: string, endpoint: string): Promise<{ allowed: boolean; remaining: number }> {
    const policy = this.securityPolicies.find(p => p.name === 'Rate Limiting');
    if (!policy || !policy.enabled) {
      return { allowed: true, remaining: 100 };
    }

    const rule = policy.rules.find(r => r.type === 'rate_limit');
    if (!rule) {
      return { allowed: true, remaining: 100 };
    }

    const params = rule.parameters;
    const key = `${ipAddress}:${endpoint}`;
    const now = Date.now();
    const windowMs = params.windowMs;
    const maxRequests = params.maxRequests;

    // This is a simplified rate limiting - in production, use Redis or similar
    const current = this.failedLoginAttempts.get(key);
    
    if (!current || now > current.lastAttempt + windowMs) {
      this.failedLoginAttempts.set(key, { count: 1, lastAttempt: now });
      return { allowed: true, remaining: maxRequests - 1 };
    } else if (current.count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    } else {
      current.count++;
      return { allowed: true, remaining: maxRequests - current.count };
    }
  }

  public async checkIPWhitelist(ipAddress: string): Promise<boolean> {
    return this.ipWhitelist.has(ipAddress);
  }

  public async trackFailedLogin(ipAddress: string, userId?: string): Promise<void> {
    const key = ipAddress;
    const current = this.failedLoginAttempts.get(key);
    const now = Date.now();

    if (!current) {
      this.failedLoginAttempts.set(key, { count: 1, lastAttempt: now });
    } else {
      current.count++;
      current.lastAttempt = now;
    }

    // Log security event for failed login
    await this.logSecurityEvent({
      type: 'login_attempt',
      severity: current && current.count > 5 ? 'high' : 'medium',
      userId,
      ipAddress,
      userAgent: 'unknown',
      details: {
        attemptCount: current ? current.count : 1,
        isBlocked: current && current.count > 10
      }
    });
  }

  public async getAuditLogs(filter?: {
    userId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<AuditLog[]> {
    let logs = [...this.auditLogs];

    if (filter) {
      if (filter.userId) {
        logs = logs.filter(log => log.userId === filter.userId);
      }
      if (filter.action) {
        logs = logs.filter(log => log.action === filter.action);
      }
      if (filter.startDate) {
        logs = logs.filter(log => log.timestamp >= filter.startDate!);
      }
      if (filter.endDate) {
        logs = logs.filter(log => log.timestamp <= filter.endDate!);
      }
    }

    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter?.limit) {
      logs = logs.slice(0, filter.limit);
    }

    return logs;
  }

  public async getSecurityEvents(filter?: {
    type?: string;
    severity?: string;
    resolved?: boolean;
    limit?: number;
  }): Promise<SecurityEvent[]> {
    let events = [...this.securityEvents];

    if (filter) {
      if (filter.type) {
        events = events.filter(event => event.type === filter.type);
      }
      if (filter.severity) {
        events = events.filter(event => event.severity === filter.severity);
      }
      if (filter.resolved !== undefined) {
        events = events.filter(event => event.resolved === filter.resolved);
      }
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter?.limit) {
      events = events.slice(0, filter.limit);
    }

    return events;
  }

  public async generateCSRFToken(): Promise<string> {
    return randomBytes(32).toString('hex');
  }

  public async validateCSRFToken(token: string, sessionToken: string): Promise<boolean> {
    // In production, use proper CSRF token validation
    return token === sessionToken;
  }

  public async hashPassword(password: string): Promise<string> {
    return createHash('sha256').update(password).digest('hex');
  }

  public async verifyPassword(password: string, hash: string): Promise<boolean> {
    const hashedPassword = await this.hashPassword(password);
    return hashedPassword === hash;
  }

  public async getSecurityStats(): Promise<{
    totalAuditLogs: number;
    totalSecurityEvents: number;
    failedLoginAttempts: number;
    activePolicies: number;
    criticalEvents: number;
  }> {
    const now = Date.now();
    const last24Hours = now - (24 * 60 * 60 * 1000);

    return {
      totalAuditLogs: this.auditLogs.length,
      totalSecurityEvents: this.securityEvents.length,
      failedLoginAttempts: Array.from(this.failedLoginAttempts.values())
        .filter(attempt => attempt.lastAttempt > last24Hours)
        .reduce((sum, attempt) => sum + attempt.count, 0),
      activePolicies: this.securityPolicies.filter(p => p.enabled).length,
      criticalEvents: this.securityEvents.filter(e => e.severity === 'critical' && !e.resolved).length
    };
  }

  private generateId(): string {
    return randomBytes(16).toString('hex');
  }
}

// Create singleton instance
export const securityService = new SecurityService();
export { SecurityService };
export type { AuditLog, SecurityPolicy, SecurityRule, SecurityEvent };
