import { SocketStream } from '@fastify/websocket';
import { logger } from './logger';

export async function websocketHandler(connection: SocketStream, req: any) {
  const socket = connection.socket;
  
  logger.info(`WebSocket connection established: ${req.socket.remoteAddress}`);

  socket.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      logger.info('WebSocket message received:', data);
      
      // Echo back the message for now
      socket.send(JSON.stringify({
        type: 'echo',
        data: data,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      logger.error('WebSocket message error:', error);
      socket.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
      }));
    }
  });

  socket.on('close', () => {
    logger.info(`WebSocket connection closed: ${req.socket.remoteAddress}`);
  });

  socket.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });

  // Send welcome message
  socket.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to AAELink Enterprise WebSocket',
    timestamp: new Date().toISOString(),
  }));
}
