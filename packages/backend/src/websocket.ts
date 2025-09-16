/**
 * WebSocket Server for Real-time Communication
 * Handles channels, presence, typing indicators, and message broadcasting
 */

import { IncomingMessage } from 'http';
import { Server } from 'ws';

interface WebSocketClient {
  ws: any;
  userId: string;
  channels: Set<string>;
  lastSeen: Date;
}

interface Message {
  type: 'message' | 'typing' | 'presence' | 'reaction' | 'read';
  channelId: string;
  userId: string;
  data: any;
  timestamp: string;
}

class WebSocketManager {
  private clients = new Map<string, WebSocketClient>();
  private channels = new Map<string, Set<string>>(); // channelId -> Set of userIds

  constructor(server: any) {
    const wss = new Server({ server });

    wss.on('connection', (ws: any, req: IncomingMessage) => {
      console.log('WebSocket client connected');

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error: Error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnect(ws);
      });
    });

    console.log('WebSocket server initialized');
  }

  private handleMessage(ws: any, message: Message) {
    switch (message.type) {
      case 'join':
        this.handleJoin(ws, message);
        break;
      case 'leave':
        this.handleLeave(ws, message);
        break;
      case 'message':
        this.handleNewMessage(ws, message);
        break;
      case 'typing':
        this.handleTyping(ws, message);
        break;
      case 'presence':
        this.handlePresence(ws, message);
        break;
      case 'reaction':
        this.handleReaction(ws, message);
        break;
      case 'read':
        this.handleRead(ws, message);
        break;
      default:
        ws.send(JSON.stringify({ error: 'Unknown message type' }));
    }
  }

  private handleJoin(ws: any, message: any) {
    const { userId, channelId } = message;

    // Store client info
    if (!this.clients.has(userId)) {
      this.clients.set(userId, {
        ws,
        userId,
        channels: new Set(),
        lastSeen: new Date()
      });
    }

    const client = this.clients.get(userId)!;
    client.channels.add(channelId);
    client.lastSeen = new Date();

    // Add user to channel
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, new Set());
    }
    this.channels.get(channelId)!.add(userId);

    // Notify others in channel
    this.broadcastToChannel(channelId, {
      type: 'presence',
      channelId,
      userId,
      data: { action: 'joined', timestamp: new Date().toISOString() }
    }, userId);

    // Send confirmation
    ws.send(JSON.stringify({
      type: 'joined',
      channelId,
      success: true
    }));
  }

  private handleLeave(ws: any, message: any) {
    const { userId, channelId } = message;

    const client = this.clients.get(userId);
    if (client) {
      client.channels.delete(channelId);
    }

    // Remove user from channel
    const channelUsers = this.channels.get(channelId);
    if (channelUsers) {
      channelUsers.delete(userId);
    }

    // Notify others in channel
    this.broadcastToChannel(channelId, {
      type: 'presence',
      channelId,
      userId,
      data: { action: 'left', timestamp: new Date().toISOString() }
    }, userId);
  }

  private handleNewMessage(ws: any, message: Message) {
    const { channelId, userId, data } = message;

    // Broadcast to all users in channel
    this.broadcastToChannel(channelId, {
      type: 'message',
      channelId,
      userId,
      data,
      timestamp: new Date().toISOString()
    });
  }

  private handleTyping(ws: any, message: Message) {
    const { channelId, userId, data } = message;

    // Broadcast typing indicator to others in channel
    this.broadcastToChannel(channelId, {
      type: 'typing',
      channelId,
      userId,
      data,
      timestamp: new Date().toISOString()
    }, userId);
  }

  private handlePresence(ws: any, message: Message) {
    const { channelId, userId, data } = message;

    // Update client last seen
    const client = this.clients.get(userId);
    if (client) {
      client.lastSeen = new Date();
    }

    // Broadcast presence update
    this.broadcastToChannel(channelId, {
      type: 'presence',
      channelId,
      userId,
      data,
      timestamp: new Date().toISOString()
    }, userId);
  }

  private handleReaction(ws: any, message: Message) {
    const { channelId, userId, data } = message;

    // Broadcast reaction to channel
    this.broadcastToChannel(channelId, {
      type: 'reaction',
      channelId,
      userId,
      data,
      timestamp: new Date().toISOString()
    });
  }

  private handleRead(ws: any, message: Message) {
    const { channelId, userId, data } = message;

    // Broadcast read status to channel
    this.broadcastToChannel(channelId, {
      type: 'read',
      channelId,
      userId,
      data,
      timestamp: new Date().toISOString()
    }, userId);
  }

  private handleDisconnect(ws: any) {
    // Find and remove client
    for (const [userId, client] of this.clients.entries()) {
      if (client.ws === ws) {
        // Notify all channels user was in
        for (const channelId of client.channels) {
          this.broadcastToChannel(channelId, {
            type: 'presence',
            channelId,
            userId,
            data: { action: 'disconnected', timestamp: new Date().toISOString() }
          }, userId);
        }

        this.clients.delete(userId);
        break;
      }
    }
  }

  private broadcastToChannel(channelId: string, message: any, excludeUserId?: string) {
    const channelUsers = this.channels.get(channelId);
    if (!channelUsers) return;

    for (const userId of channelUsers) {
      if (excludeUserId && userId === excludeUserId) continue;

      const client = this.clients.get(userId);
      if (client && client.ws.readyState === 1) { // WebSocket.OPEN
        try {
          client.ws.send(JSON.stringify(message));
        } catch (error) {
          console.error('Failed to send message to client:', error);
          // Remove disconnected client
          this.clients.delete(userId);
          channelUsers.delete(userId);
        }
      }
    }
  }

  // Public methods for server integration
  public broadcastMessage(channelId: string, message: any) {
    this.broadcastToChannel(channelId, {
      type: 'message',
      channelId,
      userId: 'system',
      data: message,
      timestamp: new Date().toISOString()
    });
  }

  public getChannelUsers(channelId: string): string[] {
    const channelUsers = this.channels.get(channelId);
    return channelUsers ? Array.from(channelUsers) : [];
  }

  public getConnectedUsers(): string[] {
    return Array.from(this.clients.keys());
  }
}

export { WebSocketManager };
