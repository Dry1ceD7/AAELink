// Test WebSocket connection
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3002/ws?userId=test123');

ws.on('open', function open() {
  console.log('✅ WebSocket connected successfully');

  // Send a test message
  ws.send(JSON.stringify({
    type: 'join',
    userId: 'test123',
    channelId: 'general'
  }));
});

ws.on('message', function message(data) {
  console.log('📨 Received:', data.toString());
});

ws.on('error', function error(err) {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', function close() {
  console.log('🔌 WebSocket disconnected');
});

// Close after 5 seconds
setTimeout(() => {
  ws.close();
  process.exit(0);
}, 5000);
