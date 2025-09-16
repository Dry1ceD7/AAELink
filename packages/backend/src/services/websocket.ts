/**
 * AAELink WebSocket Service
 * Real-time messaging with presence and typing indicators
 * BMAD Method: High-performance real-time communication
 */

import { parse } from 'cookie';
import { and, eq } from 'drizzle-orm';
import { Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from '../db';
import { channelMembers, messageReads, readCursors } from '../db/schema';
import { redis } from './redis';
import { validateSession } from './session';

// Types
interface WSClient {
  id: string;
  userId: string;
  ws: WebSocket;
  channels: Set<string>;
  deviceId: string;
  isAlive: boolean;
}

interface WSMessage {
  type: string;
  channel?: string;
  data: any;
  tempId?: string;
  timestamp?: number;
}

// Store connected clients
const clients = new Map<string, WSClient>();
const userConnections = new Map<string, Set<string>>(); // userId -> Set of client IDs

/**
 * Initialize WebSocket server
 */
export async function initializeWebSocket(server: Server): Promise<WebSocketServer> {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024
    }
  });

  // Handle new connections
  wss.on('connection', async (ws, req) => {
    let clientId: string | null = null;

    try {
      // Authenticate via session cookie
      const cookies = parse(req.headers.cookie || '');
      const sessionId = cookies.session;

      if (!sessionId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        ws.close(1008, 'Authentication required');
        return;
      }

      // Validate session
      const session = await validateSession(sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
        ws.close(1008, 'Invalid session');
        return;
      }

      // Create client ID
      clientId = `${session.userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Get user's channels
      const userChannels = await db.select({ channelId: channelMembers.channelId })
        .from(channelMembers)
        .where(eq(channelMembers.userId, session.userId));

      // Create client object
      const client: WSClient = {
        id: clientId,
        userId: session.userId,
        ws,
        channels: new Set(userChannels.map(c => c.channelId)),
        deviceId: session.deviceId || 'unknown',
        isAlive: true
      };

      // Store client
      clients.set(clientId, client);

      // Track user connections
      if (!userConnections.has(session.userId)) {
        userConnections.set(session.userId, new Set());
      }
      userConnections.get(session.userId)!.add(clientId);

      // Send connection success
      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        userId: session.userId,
        channels: Array.from(client.channels)
      }));

      // Broadcast presence to user's channels
      await broadcastPresence(session.userId, Array.from(client.channels), true);

      // Set up heartbeat
      ws.on('pong', () => {
        client.isAlive = true;
      });

      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          await handleMessage(client, message);
        } catch (error) {
          console.error('WebSocket message error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format'
          }));
        }
      });

      // Handle disconnection
      ws.on('close', async () => {
        await handleDisconnect(clientId, session.userId);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

    } catch (error) {
      console.error('WebSocket connection error:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Connection failed' }));
      ws.close(1011, 'Server error');
    }
  });

  // Start heartbeat interval
  const heartbeatInterval = setInterval(() => {
    clients.forEach((client) => {
      if (!client.isAlive) {
        client.ws.terminate();
        handleDisconnect(client.id, client.userId);
        return;
      }
      client.isAlive = false;
      client.ws.ping();
    });
  }, 30000); // 30 seconds

  // Cleanup on server shutdown
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clients.clear();
    userConnections.clear();
  });

  return wss;
}

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(client: WSClient, message: WSMessage) {
  switch (message.type) {
    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    case 'subscribe':
      await handleSubscribe(client, message.channel!);
      break;

    case 'unsubscribe':
      await handleUnsubscribe(client, message.channel!);
      break;

    case 'typing:start':
      await handleTypingStart(client, message.channel!);
      break;

    case 'typing:stop':
      await handleTypingStop(client, message.channel!);
      break;

    case 'message:ack':
      await handleMessageAck(client, message.data);
      break;

    case 'cursor:update':
      await handleCursorUpdate(client, message.data);
      break;

    case 'presence:update':
      await handlePresenceUpdate(client, message.data);
      break;

    default:
      client.ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${message.type}`
      }));
  }
}

/**
 * Handle channel subscription
 */
async function handleSubscribe(client: WSClient, channelId: string) {
  // Check if user has access to channel
  const membership = await db.select()
    .from(channelMembers)
    .where(and(
      eq(channelMembers.userId, client.userId),
      eq(channelMembers.channelId, channelId)
    ))
    .limit(1);

  if (membership.length === 0) {
    client.ws.send(JSON.stringify({
      type: 'error',
      message: 'Access denied to channel'
    }));
    return;
  }

  // Add channel to client's subscriptions
  client.channels.add(channelId);

  // Send subscription confirmation
  client.ws.send(JSON.stringify({
    type: 'subscribed',
    channel: channelId
  }));

  // Send current presence list for channel
  const presenceKey = `presence:${channelId}`;
  const presence = await redis.smembers(presenceKey);

  if (presence.length > 0) {
    client.ws.send(JSON.stringify({
      type: 'presence:list',
      channel: channelId,
      users: presence
    }));
  }
}

/**
 * Handle channel unsubscription
 */
async function handleUnsubscribe(client: WSClient, channelId: string) {
  client.channels.delete(channelId);

  client.ws.send(JSON.stringify({
    type: 'unsubscribed',
    channel: channelId
  }));
}

/**
 * Handle typing start
 */
async function handleTypingStart(client: WSClient, channelId: string) {
  if (!client.channels.has(channelId)) {
    return;
  }

  // Store typing state in Redis with 5-second TTL
  const typingKey = `typing:${channelId}:${client.userId}`;
  await redis.setex(typingKey, 5, '1');

  // Broadcast to channel members
  broadcast(channelId, {
    type: 'typing:start',
    channel: channelId,
    userId: client.userId
  }, client.userId);
}

/**
 * Handle typing stop
 */
async function handleTypingStop(client: WSClient, channelId: string) {
  if (!client.channels.has(channelId)) {
    return;
  }

  // Remove typing state from Redis
  const typingKey = `typing:${channelId}:${client.userId}`;
  await redis.del(typingKey);

  // Broadcast to channel members
  broadcast(channelId, {
    type: 'typing:stop',
    channel: channelId,
    userId: client.userId
  }, client.userId);
}

/**
 * Handle message acknowledgment
 */
async function handleMessageAck(client: WSClient, data: any) {
  const { messageId, conversationId, tempId } = data;

  // Store read status
  await db.insert(messageReads)
    .values({
      userId: client.userId,
      messageId,
      readAt: new Date()
    })
    .onConflictDoNothing();

  // Update read cursor
  await db.insert(readCursors)
    .values({
      userId: client.userId,
      deviceId: client.deviceId,
      conversationId,
      lastReadMessageId: messageId,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [readCursors.userId, readCursors.deviceId, readCursors.conversationId],
      set: {
        lastReadMessageId: messageId,
        updatedAt: new Date()
      }
    });

  // Send ACK confirmation
  client.ws.send(JSON.stringify({
    type: 'message:ack:confirmed',
    messageId,
    tempId
  }));

  // Broadcast read status to conversation members
  // (Implementation depends on conversation member lookup)
}

/**
 * Handle read cursor update
 */
async function handleCursorUpdate(client: WSClient, data: any) {
  const { conversationId, messageId } = data;

  // Update cursor in database
  await db.insert(readCursors)
    .values({
      userId: client.userId,
      deviceId: client.deviceId,
      conversationId,
      lastReadMessageId: messageId,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [readCursors.userId, readCursors.deviceId, readCursors.conversationId],
      set: {
        lastReadMessageId: messageId,
        updatedAt: new Date()
      }
    });

  // Broadcast cursor update
  broadcast(`conversation:${conversationId}`, {
    type: 'cursor:updated',
    conversationId,
    userId: client.userId,
    messageId
  }, client.userId);
}

/**
 * Handle presence update
 */
async function handlePresenceUpdate(client: WSClient, data: any) {
  const { status } = data; // 'online', 'away', 'busy', 'offline'

  // Update presence in Redis
  const presenceData = JSON.stringify({
    userId: client.userId,
    status,
    timestamp: Date.now()
  });

  // Store with 5-minute TTL
  await redis.setex(`user:presence:${client.userId}`, 300, presenceData);

  // Broadcast to user's channels
  await broadcastPresence(client.userId, Array.from(client.channels), status !== 'offline');
}

/**
 * Handle client disconnection
 */
async function handleDisconnect(clientId: string, userId: string) {
  const client = clients.get(clientId);
  if (!client) return;

  // Remove client
  clients.delete(clientId);

  // Remove from user connections
  const connections = userConnections.get(userId);
  if (connections) {
    connections.delete(clientId);

    // If no more connections for this user, broadcast offline presence
    if (connections.size === 0) {
      userConnections.delete(userId);
      await broadcastPresence(userId, Array.from(client.channels), false);

      // Clear typing indicators
      for (const channelId of client.channels) {
        const typingKey = `typing:${channelId}:${userId}`;
        await redis.del(typingKey);

        broadcast(channelId, {
          type: 'typing:stop',
          channel: channelId,
          userId
        });
      }
    }
  }
}

/**
 * Broadcast message to channel members
 */
export function broadcast(channel: string, message: any, excludeUserId?: string) {
  const messageStr = JSON.stringify(message);

  clients.forEach((client) => {
    // Check if client is subscribed to channel and not excluded
    if (client.channels.has(channel) && client.userId !== excludeUserId) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    }
  });
}

/**
 * Broadcast to specific user
 */
export function sendToUser(userId: string, message: any) {
  const connections = userConnections.get(userId);
  if (!connections) return;

  const messageStr = JSON.stringify(message);

  connections.forEach((clientId) => {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

/**
 * Broadcast presence update
 */
async function broadcastPresence(userId: string, channels: string[], isOnline: boolean) {
  for (const channelId of channels) {
    const presenceKey = `presence:${channelId}`;

    if (isOnline) {
      await redis.sadd(presenceKey, userId);
    } else {
      await redis.srem(presenceKey, userId);
    }

    broadcast(channelId, {
      type: isOnline ? 'presence:online' : 'presence:offline',
      channel: channelId,
      userId
    });
  }
}

/**
 * Get online users for a channel
 */
export async function getChannelPresence(channelId: string): Promise<string[]> {
  const presenceKey = `presence:${channelId}`;
  return await redis.smembers(presenceKey);
}

/**
 * Check if user is online
 */
export function isUserOnline(userId: string): boolean {
  return userConnections.has(userId);
}
