import { WebSocketServer } from 'ws';

// WebSocket server setup
export async function initializeWebSocket(server: any) {
  try {
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      console.log('WebSocket client connected');

      ws.on('message', (message) => {
        console.log('WebSocket message received:', message.toString());
        // Echo back for now
        ws.send(JSON.stringify({
          type: 'echo',
          data: message.toString(),
          timestamp: new Date().toISOString()
        }));
      });

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
      });
    });

    console.log('WebSocket server initialized');
    return wss;
  } catch (error) {
    console.error('Failed to initialize WebSocket server:', error);
    throw error;
  }
}
