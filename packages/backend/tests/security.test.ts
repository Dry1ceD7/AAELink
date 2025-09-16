/**
 * Security Service Unit Tests
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { securityService } from '../src/services/security';

describe('SecurityService', () => {
  beforeEach(() => {
    // Reset service state before each test
    (securityService as any).auditLogs = [];
    (securityService as any).securityEvents = [];
    (securityService as any).failedLoginAttempts.clear();
  });

  describe('Password Validation', () => {
    it('should validate strong passwords', async () => {
      const result = await securityService.validatePassword('StrongPass123!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject weak passwords', async () => {
      const result = await securityService.validatePassword('weak');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should require minimum length', async () => {
      const result = await securityService.validatePassword('Short1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should require uppercase letters', async () => {
      const result = await securityService.validatePassword('lowercase123!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should require lowercase letters', async () => {
      const result = await securityService.validatePassword('UPPERCASE123!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    it('should require numbers', async () => {
      const result = await securityService.validatePassword('NoNumbers!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should require special characters', async () => {
      const result = await securityService.validatePassword('NoSpecial123');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });
  });

  describe('File Upload Validation', () => {
    it('should allow valid file types', async () => {
      const file = {
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf'
      };
      const result = await securityService.validateFileUpload(file);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid file types', async () => {
      const file = {
        name: 'test.exe',
        size: 1024,
        type: 'application/x-msdownload'
      };
      const result = await securityService.validateFileUpload(file);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject files that are too large', async () => {
      const file = {
        name: 'large.pdf',
        size: 20 * 1024 * 1024, // 20MB
        type: 'application/pdf'
      };
      const result = await securityService.validateFileUpload(file);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('File size 20971520 exceeds maximum allowed size of 10485760 bytes');
    });

    it('should reject dangerous file extensions', async () => {
      const file = {
        name: 'malware.exe',
        size: 1024,
        type: 'application/x-msdownload'
      };
      const result = await securityService.validateFileUpload(file);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('File extension .exe is not allowed for security reasons');
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests within rate limit', async () => {
      const result = await securityService.checkRateLimit('127.0.0.1', '/api/test');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it('should track multiple requests', async () => {
      await securityService.checkRateLimit('127.0.0.1', '/api/test');
      await securityService.checkRateLimit('127.0.0.1', '/api/test');
      const result = await securityService.checkRateLimit('127.0.0.1', '/api/test');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(97);
    });
  });

  describe('IP Whitelist', () => {
    it('should allow whitelisted IPs', async () => {
      const result = await securityService.checkIPWhitelist('127.0.0.1');
      expect(result).toBe(true);
    });

    it('should reject non-whitelisted IPs', async () => {
      const result = await securityService.checkIPWhitelist('192.168.1.100');
      expect(result).toBe(false);
    });
  });

  describe('Failed Login Tracking', () => {
    it('should track failed login attempts', async () => {
      await securityService.trackFailedLogin('127.0.0.1', 'user1');
      await securityService.trackFailedLogin('127.0.0.1', 'user1');
      
      const events = await securityService.getSecurityEvents({ type: 'login_attempt' });
      expect(events).toHaveLength(2);
      expect(events[0].severity).toBe('medium');
    });

    it('should escalate severity for multiple failed attempts', async () => {
      // Simulate 6 failed attempts
      for (let i = 0; i < 6; i++) {
        await securityService.trackFailedLogin('127.0.0.1', 'user1');
      }
      
      const events = await securityService.getSecurityEvents({ type: 'login_attempt' });
      const highSeverityEvents = events.filter(e => e.severity === 'high');
      expect(highSeverityEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Audit Logging', () => {
    it('should log audit events', async () => {
      await securityService.logAuditEvent({
        userId: 'user1',
        action: 'login',
        resource: '/api/auth/login',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        success: true,
        severity: 'low'
      });

      const logs = await securityService.getAuditLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('login');
      expect(logs[0].success).toBe(true);
    });

    it('should filter audit logs by user', async () => {
      await securityService.logAuditEvent({
        userId: 'user1',
        action: 'login',
        resource: '/api/auth/login',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        success: true,
        severity: 'low'
      });

      await securityService.logAuditEvent({
        userId: 'user2',
        action: 'login',
        resource: '/api/auth/login',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        success: true,
        severity: 'low'
      });

      const user1Logs = await securityService.getAuditLogs({ userId: 'user1' });
      expect(user1Logs).toHaveLength(1);
      expect(user1Logs[0].userId).toBe('user1');
    });
  });

  describe('Security Stats', () => {
    it('should return security statistics', async () => {
      await securityService.logAuditEvent({
        userId: 'user1',
        action: 'login',
        resource: '/api/auth/login',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        success: true,
        severity: 'low'
      });

      await securityService.logSecurityEvent({
        type: 'login_attempt',
        severity: 'critical',
        userId: 'user1',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        details: {}
      });

      const stats = await securityService.getSecurityStats();
      expect(stats.totalAuditLogs).toBe(1);
      expect(stats.totalSecurityEvents).toBe(1);
      expect(stats.criticalEvents).toBe(1);
      expect(stats.activePolicies).toBeGreaterThan(0);
    });
  });

  describe('Password Hashing', () => {
    it('should hash passwords consistently', async () => {
      const password = 'testpassword123';
      const hash1 = await securityService.hashPassword(password);
      const hash2 = await securityService.hashPassword(password);
      expect(hash1).toBe(hash2);
    });

    it('should verify correct passwords', async () => {
      const password = 'testpassword123';
      const hash = await securityService.hashPassword(password);
      const isValid = await securityService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect passwords', async () => {
      const password = 'testpassword123';
      const wrongPassword = 'wrongpassword';
      const hash = await securityService.hashPassword(password);
      const isValid = await securityService.verifyPassword(wrongPassword, hash);
      expect(isValid).toBe(false);
    });
  });
});
