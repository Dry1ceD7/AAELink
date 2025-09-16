/**
 * Load Testing Script for AAELink
 * Tests API endpoints under various load conditions
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('error_rate');
const responseTime = new Trend('response_time');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 }, // Ramp up to 10 users
    { duration: '5m', target: 10 }, // Stay at 10 users
    { duration: '2m', target: 20 }, // Ramp up to 20 users
    { duration: '5m', target: 20 }, // Stay at 20 users
    { duration: '2m', target: 50 }, // Ramp up to 50 users
    { duration: '5m', target: 50 }, // Stay at 50 users
    { duration: '2m', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests must complete below 2s
    http_req_failed: ['rate<0.1'],     // Error rate must be below 10%
    error_rate: ['rate<0.05'],         // Custom error rate below 5%
  },
};

const BASE_URL = 'http://localhost:3001';

// Test data
const testUsers = [
  { email: 'admin@aae.co.th', password: '12345678' },
  { email: 'user1@aae.co.th', password: 'password123' },
  { email: 'user2@aae.co.th', password: 'password123' },
];

export function setup() {
  console.log('Starting load test setup...');
  
  // Health check
  const healthResponse = http.get(`${BASE_URL}/health`);
  check(healthResponse, {
    'health check passed': (r) => r.status === 200,
  });

  return { baseUrl: BASE_URL };
}

export default function(data) {
  const { baseUrl } = data;
  
  // Test different endpoints with different probabilities
  const endpointTests = [
    { weight: 30, test: () => testHealthCheck(baseUrl) },
    { weight: 25, test: () => testLogin(baseUrl) },
    { weight: 20, test: () => testCalendar(baseUrl) },
    { weight: 15, test: () => testSearch(baseUrl) },
    { weight: 10, test: () => testAdmin(baseUrl) },
  ];

  // Select test based on weight
  const random = Math.random() * 100;
  let cumulativeWeight = 0;
  
  for (const { weight, test } of endpointTests) {
    cumulativeWeight += weight;
    if (random <= cumulativeWeight) {
      test();
      break;
    }
  }

  sleep(1);
}

function testHealthCheck(baseUrl) {
  const response = http.get(`${baseUrl}/health`);
  
  const success = check(response, {
    'health check status is 200': (r) => r.status === 200,
    'health check response time < 500ms': (r) => r.timings.duration < 500,
    'health check has correct content': (r) => r.json('status') === 'healthy',
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
}

function testLogin(baseUrl) {
  const user = testUsers[Math.floor(Math.random() * testUsers.length)];
  
  const payload = JSON.stringify({
    email: user.email,
    password: user.password,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(`${baseUrl}/api/auth/login`, payload, params);
  
  const success = check(response, {
    'login status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'login response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
}

function testCalendar(baseUrl) {
  const response = http.get(`${baseUrl}/api/calendar/events`);
  
  const success = check(response, {
    'calendar status is 200': (r) => r.status === 200,
    'calendar response time < 2000ms': (r) => r.timings.duration < 2000,
    'calendar has events array': (r) => Array.isArray(r.json('events')),
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
}

function testSearch(baseUrl) {
  const searchQueries = ['test', 'meeting', 'project', 'user', 'admin'];
  const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
  
  const response = http.get(`${baseUrl}/api/search?q=${query}&type=all`);
  
  const success = check(response, {
    'search status is 200': (r) => r.status === 200,
    'search response time < 1500ms': (r) => r.timings.duration < 1500,
    'search has results': (r) => r.json('results') !== undefined,
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
}

function testAdmin(baseUrl) {
  const response = http.get(`${baseUrl}/api/admin/stats`);
  
  const success = check(response, {
    'admin status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'admin response time < 2000ms': (r) => r.timings.duration < 2000,
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
}

export function teardown(data) {
  console.log('Load test completed');
  
  // Final health check
  const healthResponse = http.get(`${data.baseUrl}/health`);
  check(healthResponse, {
    'final health check passed': (r) => r.status === 200,
  });
}
