/**
 * AAELink Messages Tests
 * Real-time messaging and WebSocket testing
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { WebSocket } from 'ws';
import { db } from '../src/db';
import { conversations, messages, users } from '../src/db/schema';
import { messagesRouter } from '../src/routes/messages';

const app = new Hono().route('/messages', messagesRouter);

describe('Messages API', () => {
  let testUser: any;
  let testConversation: any;
  let authCookie: string;

  beforeAll(async () => {
    // Create test user
    const [user] = await db.insert(users)
      .values({
        email: 'message-test@example.com',
        displayName: 'Message Test User',
      })
      .returning();
    testUser = user;

    // Create test conversation
    const [conversation] = await db.insert(conversations)
      .values({
        type: 'channel',
        channelId: 'test-channel-id',
      })
      .returning();
    testConversation = conversation;

    // Mock authentication
    authCookie = 'session=test-session-id';
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(messages).where(eq(messages.conversationId, testConversation.id));
    await db.delete(conversations).where(eq(conversations.id, testConversation.id));
    await db.delete(users).where(eq(users.id, testUser.id));
  });

  describe('Message Creation', () => {
    it('should create a new message', async () => {
      const response = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          conversationId: testConversation.id,
          body: 'Test message content',
          tempId: 'temp-123',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toBeDefined();
      expect(data.message.body).toBe('Test message content');
      expect(data.tempId).toBe('temp-123');
    });

    it('should validate message body length', async () => {
      const longMessage = 'a'.repeat(10001);
      const response = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          conversationId: testConversation.id,
          body: longMessage,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle reply to message', async () => {
      // Create original message
      const [originalMessage] = await db.insert(messages)
        .values({
          conversationId: testConversation.id,
          senderId: testUser.id,
          body: 'Original message',
        })
        .returning();

      const response = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          conversationId: testConversation.id,
          body: 'Reply message',
          replyToMessageId: originalMessage.id,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message.replyToMessageId).toBe(originalMessage.id);
    });
  });

  describe('Message Retrieval', () => {
    beforeAll(async () => {
      // Create test messages
      const testMessages = Array(25).fill(null).map((_, i) => ({
        conversationId: testConversation.id,
        senderId: testUser.id,
        body: `Test message ${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));

      await db.insert(messages).values(testMessages);
    });

    it('should retrieve messages with pagination', async () => {
      const response = await app.request(
        `/api/messages?conversationId=${testConversation.id}&limit=10`,
        {
          method: 'GET',
          headers: {
            Cookie: authCookie,
          },
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.messages).toHaveLength(10);
      expect(data.hasMore).toBe(true);
    });

    it('should retrieve messages before a specific message', async () => {
      const [referenceMessage] = await db.select()
        .from(messages)
        .where(eq(messages.conversationId, testConversation.id))
        .limit(1);

      const response = await app.request(
        `/api/messages?conversationId=${testConversation.id}&beforeId=${referenceMessage.id}&limit=5`,
        {
          method: 'GET',
          headers: {
            Cookie: authCookie,
          },
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.messages.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Message Updates', () => {
    it('should edit a message', async () => {
      const [message] = await db.insert(messages)
        .values({
          conversationId: testConversation.id,
          senderId: testUser.id,
          body: 'Original text',
        })
        .returning();

      const response = await app.request(`/api/messages/${message.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          body: 'Edited text',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message.body).toBe('Edited text');
      expect(data.message.editedAt).toBeDefined();
    });

    it('should prevent editing messages from other users', async () => {
      const [otherUser] = await db.insert(users)
        .values({
          email: 'other@example.com',
          displayName: 'Other User',
        })
        .returning();

      const [message] = await db.insert(messages)
        .values({
          conversationId: testConversation.id,
          senderId: otherUser.id,
          body: 'Other user message',
        })
        .returning();

      const response = await app.request(`/api/messages/${message.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          body: 'Trying to edit',
        }),
      });

      expect(response.status).toBe(403);

      // Cleanup
      await db.delete(users).where(eq(users.id, otherUser.id));
    });

    it('should soft delete a message', async () => {
      const [message] = await db.insert(messages)
        .values({
          conversationId: testConversation.id,
          senderId: testUser.id,
          body: 'To be deleted',
        })
        .returning();

      const response = await app.request(`/api/messages/${message.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);

      // Verify soft delete
      const [deletedMessage] = await db.select()
        .from(messages)
        .where(eq(messages.id, message.id));

      expect(deletedMessage.deletedAt).toBeDefined();
    });
  });

  describe('Message Reactions', () => {
    it('should add a reaction to a message', async () => {
      const [message] = await db.insert(messages)
        .values({
          conversationId: testConversation.id,
          senderId: testUser.id,
          body: 'React to this',
        })
        .returning();

      const response = await app.request(`/api/messages/${message.id}/react`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          emoji: '👍',
          action: 'add',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.reactions['👍']).toContain(testUser.id);
    });

    it('should remove a reaction from a message', async () => {
      const [message] = await db.insert(messages)
        .values({
          conversationId: testConversation.id,
          senderId: testUser.id,
          body: 'Remove reaction',
          metadata: {
            reactions: {
              '👍': [testUser.id],
            },
          },
        })
        .returning();

      const response = await app.request(`/api/messages/${message.id}/react`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({
          emoji: '👍',
          action: 'remove',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.reactions['👍']).toBeUndefined();
    });
  });

  describe('Unread Messages', () => {
    it('should get unread message counts', async () => {
      const response = await app.request('/api/messages/unread', {
        method: 'GET',
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.unreadCounts).toBeDefined();
      expect(Array.isArray(data.unreadCounts)).toBe(true);
    });
  });
});

describe('WebSocket Real-time', () => {
  let ws: WebSocket;

  beforeAll(() => {
    ws = new WebSocket('ws://localhost:8080/ws', {
      headers: {
        Cookie: 'session=test-session',
      },
    });
  });

  afterAll(() => {
    ws.close();
  });

  it('should connect to WebSocket', (done) => {
    ws.on('open', () => {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      done();
    });
  });

  it('should receive connection confirmation', (done) => {
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'connected') {
        expect(message.clientId).toBeDefined();
        expect(message.userId).toBeDefined();
        done();
      }
    });
  });

  it('should handle ping/pong', (done) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'pong') {
        expect(message.timestamp).toBeDefined();
        done();
      }
    });
  });
});
