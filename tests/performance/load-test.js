/**
 * AAELink Load Testing
 * Performance testing with k6
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';

// Custom metrics
const messageLatency = new Trend('message_latency');
const wsConnections = new Rate('ws_connection_success');
const apiErrors = new Rate('api_errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp up to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '5m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'],  // 95% of requests under 400ms
    http_req_failed: ['rate<0.05'],    // Error rate under 5%
    ws_connection_success: ['rate>0.95'], // 95% WebSocket success
    message_latency: ['p(95)<150'],    // 95% message latency under 150ms
  },
};

const BASE_URL = 'http://localhost:8080';
const WS_URL = 'ws://localhost:8080/ws';

// Helper function to authenticate
function authenticate() {
  const loginRes = http.post(`${BASE_URL}/api/auth/webauthn/authenticate/options`, {
    email: `user${__VU}@example.com`,
  });

  check(loginRes, {
    'login status is 200': (r) => r.status === 200,
  });

  return loginRes.cookies;
}

// API Load Test
export function apiLoadTest() {
  const cookies = authenticate();

  // Test message creation
  const startTime = Date.now();
  const messageRes = http.post(
    `${BASE_URL}/api/messages`,
    JSON.stringify({
      conversationId: 'test-conversation',
      body: `Test message from user ${__VU} at ${Date.now()}`,
      tempId: `temp-${__VU}-${Date.now()}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies,
      },
    }
  );

  const latency = Date.now() - startTime;
  messageLatency.add(latency);

  check(messageRes, {
    'message created': (r) => r.status === 200,
    'has message id': (r) => JSON.parse(r.body).message?.id !== undefined,
    'latency under 150ms': () => latency < 150,
  });

  apiErrors.add(messageRes.status !== 200);

  // Test message retrieval
  const getRes = http.get(
    `${BASE_URL}/api/messages?conversationId=test-conversation&limit=20`,
    { headers: { Cookie: cookies } }
  );

  check(getRes, {
    'messages retrieved': (r) => r.status === 200,
    'has messages array': (r) => Array.isArray(JSON.parse(r.body).messages),
  });

  // Test file presign
  const fileRes = http.post(
    `${BASE_URL}/api/files/presign`,
    JSON.stringify({
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024 * 1024, // 1MB
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies,
      },
    }
  );

  check(fileRes, {
    'presign URL generated': (r) => r.status === 200,
    'has upload URL': (r) => JSON.parse(r.body).uploadUrl !== undefined,
  });

  sleep(1);
}

// WebSocket Load Test
export function websocketTest() {
  const cookies = authenticate();

  const res = ws.connect(WS_URL, { headers: { Cookie: cookies } }, function (socket) {
    socket.on('open', () => {
      wsConnections.add(true);

      // Send ping
      socket.send(JSON.stringify({ type: 'ping' }));

      // Subscribe to channel
      socket.send(JSON.stringify({
        type: 'subscribe',
        channel: 'test-channel',
      }));

      // Simulate typing
      socket.send(JSON.stringify({
        type: 'typing:start',
        channel: 'test-channel',
      }));

      // Send messages periodically
      socket.setInterval(() => {
        const message = {
          type: 'message:send',
          channel: 'test-channel',
          data: {
            body: `WebSocket message from user ${__VU}`,
            tempId: `ws-${__VU}-${Date.now()}`,
          },
        };
        socket.send(JSON.stringify(message));
      }, 5000);
    });

    socket.on('message', (data) => {
      const message = JSON.parse(data);

      check(message, {
        'valid message format': () => message.type !== undefined,
      });

      if (message.type === 'pong') {
        check(message, {
          'pong has timestamp': () => message.timestamp !== undefined,
        });
      }

      if (message.type === 'message:ack') {
        const latency = Date.now() - parseInt(message.tempId?.split('-')[2] || '0');
        messageLatency.add(latency);
      }
    });

    socket.on('error', (e) => {
      wsConnections.add(false);
      console.error('WebSocket error:', e);
    });

    socket.on('close', () => {
      wsConnections.add(false);
    });

    // Keep connection for 30 seconds
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });

  check(res, {
    'WebSocket connected': (r) => r && r.status === 101,
  });
}

// Combined scenario
export default function () {
  const scenario = Math.random();

  if (scenario < 0.7) {
    // 70% API load
    apiLoadTest();
  } else {
    // 30% WebSocket load
    websocketTest();
  }
}

// Teardown function
export function teardown(data) {
  console.log('Test completed');
  console.log(`Message latency p95: ${messageLatency.p(95)}ms`);
  console.log(`WebSocket success rate: ${wsConnections.rate * 100}%`);
  console.log(`API error rate: ${apiErrors.rate * 100}%`);
}
