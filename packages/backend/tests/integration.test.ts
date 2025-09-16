/**
 * Integration Tests
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

const BASE_URL = 'http://localhost:3001';

describe('API Integration Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('AAELink Backend');
    });
  });

  describe('Authentication Flow', () => {
    it('should handle login with valid credentials', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'admin@aae.co.th',
          password: '12345678'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe('admin@aae.co.th');
    });

    it('should reject login with invalid credentials', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'admin@aae.co.th',
          password: 'wrongpassword'
        })
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle session validation', async () => {
      // First login to get session
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'admin@aae.co.th',
          password: '12345678'
        })
      });

      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers.get('set-cookie');
      expect(cookies).toBeDefined();

      // Check session
      const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
        headers: {
          'Cookie': cookies || ''
        }
      });

      expect(sessionResponse.status).toBe(200);
      const sessionData = await sessionResponse.json();
      expect(sessionData.user).toBeDefined();
    });
  });

  describe('Calendar API', () => {
    it('should fetch calendar events', async () => {
      const response = await fetch(`${BASE_URL}/api/calendar/events`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
    });

    it('should create a new event', async () => {
      const eventData = {
        title: 'Test Event',
        description: 'Test Description',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 3600000).toISOString(),
        allDay: false,
        location: 'Test Location'
      };

      const response = await fetch(`${BASE_URL}/api/calendar/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventData)
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.event).toBeDefined();
      expect(data.event.title).toBe('Test Event');
    });

    it('should fetch upcoming events', async () => {
      const response = await fetch(`${BASE_URL}/api/calendar/upcoming?days=7`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
    });
  });

  describe('Search API', () => {
    it('should perform search queries', async () => {
      const response = await fetch(`${BASE_URL}/api/search?q=test&type=all`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.results).toBeDefined();
      expect(data.query).toBe('test');
      expect(Array.isArray(data.results)).toBe(true);
    });

    it('should handle empty search queries', async () => {
      const response = await fetch(`${BASE_URL}/api/search?q=&type=all`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.results).toHaveLength(0);
      expect(data.total).toBe(0);
    });
  });

  describe('ERP Integration API', () => {
    it('should return ERP status', async () => {
      const response = await fetch(`${BASE_URL}/api/erp/status`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBeDefined();
      expect(data.integrations).toBeDefined();
      expect(Array.isArray(data.integrations)).toBe(true);
    });

    it('should handle user sync', async () => {
      const response = await fetch(`${BASE_URL}/api/erp/sync/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBeDefined();
    });

    it('should handle data sync', async () => {
      const response = await fetch(`${BASE_URL}/api/erp/sync/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dataType: 'projects' })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBeDefined();
    });
  });

  describe('File Upload API', () => {
    it('should handle file upload', async () => {
      const formData = new FormData();
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
      formData.append('file', file);

      const response = await fetch(`${BASE_URL}/api/files/upload`, {
        method: 'POST',
        body: formData
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.file).toBeDefined();
      expect(data.file.name).toBe('test.txt');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = [];

      // Make multiple requests quickly
      for (let i = 0; i < 105; i++) {
        requests.push(fetch(`${BASE_URL}/api/auth/session`));
      }

      const responses = await Promise.all(requests);
      const rateLimitedResponses = responses.filter(r => r.status === 429);

      // Should have some rate limited responses
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${BASE_URL}/health`, {
        method: 'OPTIONS'
      });

      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
      expect(response.headers.get('access-control-allow-methods')).toBeDefined();
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await fetch(`${BASE_URL}/health`);

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBeDefined();
      expect(response.headers.get('referrer-policy')).toBeDefined();
    });
  });
});
