/**
 * AAELink Message Routes
 * Real-time messaging with optimistic updates
 * BMAD Method: High-performance message handling
 */

import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db';
import {
    channelMembers,
    conversations,
    messageReads,
    messages,
    readCursors,
    users
} from '../db/schema';
import { broadcast } from '../services/websocket';

const messagesRouter = new Hono();

// Validation schemas
const CreateMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(10000),
  replyToMessageId: z.string().uuid().optional(),
  tempId: z.string().optional(),
  metadata: z.object({
    mentions: z.array(z.string()).optional(),
    attachments: z.array(z.string()).optional(),
  }).optional(),
});

const UpdateMessageSchema = z.object({
  body: z.string().min(1).max(10000),
});

const GetMessagesSchema = z.object({
  conversationId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).default(50),
  beforeId: z.string().uuid().optional(),
  afterId: z.string().uuid().optional(),
});

/**
 * GET /api/messages
 * Get messages for a conversation with pagination
 */
messagesRouter.get('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Parse query parameters
    const query = c.req.query();
    const params = GetMessagesSchema.parse(query);

    // Check if user has access to conversation
    const conversation = await db.select()
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);

    if (conversation.length === 0) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // For channel conversations, check membership
    if (conversation[0].channelId) {
      const membership = await db.select()
        .from(channelMembers)
        .where(and(
          eq(channelMembers.userId, user.id),
          eq(channelMembers.channelId, conversation[0].channelId)
        ))
        .limit(1);

      if (membership.length === 0) {
        return c.json({ error: 'Access denied' }, 403);
      }
    }

    // Build query conditions
    const conditions = [
      eq(messages.conversationId, params.conversationId),
      sql`${messages.deletedAt} IS NULL`
    ];

    if (params.beforeId) {
      // Get the timestamp of the reference message
      const [refMessage] = await db.select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, params.beforeId))
        .limit(1);

      if (refMessage) {
        conditions.push(lt(messages.createdAt, refMessage.createdAt));
      }
    }

    // Fetch messages with sender information
    const result = await db.select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      senderName: users.displayName,
      senderAvatar: users.avatarUrl,
      body: messages.body,
      replyToMessageId: messages.replyToMessageId,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
    })
    .from(messages)
    .leftJoin(users, eq(messages.senderId, users.id))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(params.limit);

    // Get read status for messages
    const messageIds = result.map(m => m.id);
    const readStatuses = await db.select({
      messageId: messageReads.messageId,
      readAt: messageReads.readAt
    })
    .from(messageReads)
    .where(and(
      eq(messageReads.userId, user.id),
      inArray(messageReads.messageId, messageIds)
    ));

    const readMap = new Map(readStatuses.map(r => [r.messageId, r.readAt]));

    // Format response
    const formattedMessages = result.map(msg => ({
      ...msg,
      isRead: readMap.has(msg.id),
      readAt: readMap.get(msg.id),
    }));

    // Get user's read cursor for this conversation
    const [cursor] = await db.select()
      .from(readCursors)
      .where(and(
        eq(readCursors.userId, user.id),
        eq(readCursors.conversationId, params.conversationId)
      ))
      .limit(1);

    return c.json({
      messages: formattedMessages.reverse(), // Return in chronological order
      hasMore: result.length === params.limit,
      cursor: cursor?.lastReadMessageId,
    });

  } catch (error) {
    console.error('Get messages error:', error);
    return c.json({ error: 'Failed to fetch messages' }, 500);
  }
});

/**
 * POST /api/messages
 * Create a new message with optimistic updates
 */
messagesRouter.post('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const data = CreateMessageSchema.parse(body);

    // Verify access to conversation
    const [conversation] = await db.select()
      .from(conversations)
      .where(eq(conversations.id, data.conversationId))
      .limit(1);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Check channel membership if needed
    if (conversation.channelId) {
      const [membership] = await db.select()
        .from(channelMembers)
        .where(and(
          eq(channelMembers.userId, user.id),
          eq(channelMembers.channelId, conversation.channelId)
        ))
        .limit(1);

      if (!membership) {
        return c.json({ error: 'Not a member of this channel' }, 403);
      }
    }

    // Create message
    const messageId = nanoid();
    const [newMessage] = await db.insert(messages)
      .values({
        id: messageId,
        conversationId: data.conversationId,
        senderId: user.id,
        body: data.body,
        replyToMessageId: data.replyToMessageId,
        metadata: data.metadata as any,
        createdAt: new Date(),
      })
      .returning();

    // Format message with sender info
    const formattedMessage = {
      ...newMessage,
      senderName: user.displayName,
      senderAvatar: user.avatarUrl,
      tempId: data.tempId,
    };

    // Broadcast to channel/conversation members via WebSocket
    const broadcastMessage = {
      type: 'message:created',
      conversationId: data.conversationId,
      channelId: conversation.channelId,
      message: formattedMessage,
      tempId: data.tempId,
    };

    if (conversation.channelId) {
      broadcast(conversation.channelId, broadcastMessage, user.id);
    } else {
      // For direct messages, broadcast to conversation participants
      broadcast(`conversation:${data.conversationId}`, broadcastMessage, user.id);
    }

    // Process mentions if any
    if (data.metadata?.mentions && data.metadata.mentions.length > 0) {
      // Send notifications to mentioned users
      // (Implementation depends on notification service)
    }

    return c.json({
      message: formattedMessage,
      tempId: data.tempId,
    });

  } catch (error) {
    console.error('Create message error:', error);
    return c.json({ error: 'Failed to create message' }, 500);
  }
});

/**
 * PATCH /api/messages/:id
 * Edit a message
 */
messagesRouter.patch('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('id');
    const body = await c.req.json();
    const data = UpdateMessageSchema.parse(body);

    // Get the message
    const [message] = await db.select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    // Check if user is the sender
    if (message.senderId !== user.id) {
      return c.json({ error: 'Cannot edit message from another user' }, 403);
    }

    // Check if message is too old to edit (24 hours)
    const messageAge = Date.now() - message.createdAt.getTime();
    const maxEditTime = 24 * 60 * 60 * 1000; // 24 hours

    if (messageAge > maxEditTime) {
      return c.json({ error: 'Message is too old to edit' }, 403);
    }

    // Store edit history in metadata
    const editHistory = (message.metadata as any)?.editHistory || [];
    editHistory.push({
      body: message.body,
      editedAt: new Date().toISOString(),
    });

    // Update message
    const [updatedMessage] = await db.update(messages)
      .set({
        body: data.body,
        editedAt: new Date(),
        metadata: {
          ...(message.metadata as any || {}),
          editHistory,
        },
      })
      .where(eq(messages.id, messageId))
      .returning();

    // Get conversation for broadcasting
    const [conversation] = await db.select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId))
      .limit(1);

    // Broadcast update
    const broadcastMessage = {
      type: 'message:updated',
      conversationId: message.conversationId,
      channelId: conversation?.channelId,
      message: {
        ...updatedMessage,
        senderName: user.displayName,
        senderAvatar: user.avatarUrl,
      },
    };

    if (conversation?.channelId) {
      broadcast(conversation.channelId, broadcastMessage);
    } else {
      broadcast(`conversation:${message.conversationId}`, broadcastMessage);
    }

    return c.json({ message: updatedMessage });

  } catch (error) {
    console.error('Update message error:', error);
    return c.json({ error: 'Failed to update message' }, 500);
  }
});

/**
 * DELETE /api/messages/:id
 * Soft delete a message
 */
messagesRouter.delete('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('id');

    // Get the message
    const [message] = await db.select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    // Check permissions (sender or channel admin can delete)
    let canDelete = message.senderId === user.id;

    if (!canDelete && message.conversationId) {
      const [conversation] = await db.select()
        .from(conversations)
        .where(eq(conversations.id, message.conversationId))
        .limit(1);

      if (conversation?.channelId) {
        const [membership] = await db.select()
          .from(channelMembers)
          .where(and(
            eq(channelMembers.userId, user.id),
            eq(channelMembers.channelId, conversation.channelId)
          ))
          .limit(1);

        canDelete = membership?.role === 'admin' || membership?.role === 'moderator';
      }
    }

    if (!canDelete) {
      return c.json({ error: 'Cannot delete this message' }, 403);
    }

    // Soft delete
    await db.update(messages)
      .set({ deletedAt: new Date() })
      .where(eq(messages.id, messageId));

    // Get conversation for broadcasting
    const [conversation] = await db.select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId))
      .limit(1);

    // Broadcast deletion
    const broadcastMessage = {
      type: 'message:deleted',
      conversationId: message.conversationId,
      channelId: conversation?.channelId,
      messageId,
      deletedBy: user.id,
    };

    if (conversation?.channelId) {
      broadcast(conversation.channelId, broadcastMessage);
    } else {
      broadcast(`conversation:${message.conversationId}`, broadcastMessage);
    }

    return c.json({ success: true });

  } catch (error) {
    console.error('Delete message error:', error);
    return c.json({ error: 'Failed to delete message' }, 500);
  }
});

/**
 * POST /api/messages/:id/react
 * Add or remove a reaction to a message
 */
messagesRouter.post('/:id/react', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const messageId = c.req.param('id');
    const { emoji, action } = await c.req.json();

    if (!emoji || !['add', 'remove'].includes(action)) {
      return c.json({ error: 'Invalid request' }, 400);
    }

    // Get the message
    const [message] = await db.select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    // Update reactions in metadata
    const metadata = (message.metadata as any) || {};
    const reactions = metadata.reactions || {};

    if (action === 'add') {
      if (!reactions[emoji]) {
        reactions[emoji] = [];
      }
      if (!reactions[emoji].includes(user.id)) {
        reactions[emoji].push(user.id);
      }
    } else {
      if (reactions[emoji]) {
        reactions[emoji] = reactions[emoji].filter((id: string) => id !== user.id);
        if (reactions[emoji].length === 0) {
          delete reactions[emoji];
        }
      }
    }

    // Update message
    await db.update(messages)
      .set({
        metadata: {
          ...metadata,
          reactions,
        },
      })
      .where(eq(messages.id, messageId));

    // Get conversation for broadcasting
    const [conversation] = await db.select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId))
      .limit(1);

    // Broadcast reaction update
    const broadcastMessage = {
      type: 'message:reaction',
      conversationId: message.conversationId,
      channelId: conversation?.channelId,
      messageId,
      emoji,
      action,
      userId: user.id,
    };

    if (conversation?.channelId) {
      broadcast(conversation.channelId, broadcastMessage);
    } else {
      broadcast(`conversation:${message.conversationId}`, broadcastMessage);
    }

    return c.json({ success: true, reactions });

  } catch (error) {
    console.error('React to message error:', error);
    return c.json({ error: 'Failed to react to message' }, 500);
  }
});

/**
 * GET /api/messages/unread
 * Get unread message counts per conversation
 */
messagesRouter.get('/unread', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get user's conversations
    const userConversations = await db.select({
      conversationId: conversations.id,
      channelId: conversations.channelId,
    })
    .from(conversations)
    .leftJoin(channelMembers, eq(conversations.channelId, channelMembers.channelId))
    .where(eq(channelMembers.userId, user.id));

    // Get unread counts for each conversation
    const unreadCounts = await Promise.all(
      userConversations.map(async (conv) => {
        // Get user's last read message
        const [cursor] = await db.select()
          .from(readCursors)
          .where(and(
            eq(readCursors.userId, user.id),
            eq(readCursors.conversationId, conv.conversationId)
          ))
          .limit(1);

        // Count unread messages
        const conditions = [
          eq(messages.conversationId, conv.conversationId),
          sql`${messages.deletedAt} IS NULL`,
        ];

        if (cursor?.lastReadMessageId) {
          const [lastReadMessage] = await db.select({ createdAt: messages.createdAt })
            .from(messages)
            .where(eq(messages.id, cursor.lastReadMessageId))
            .limit(1);

          if (lastReadMessage) {
            conditions.push(sql`${messages.createdAt} > ${lastReadMessage.createdAt}`);
          }
        }

        const [result] = await db.select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(and(...conditions));

        return {
          conversationId: conv.conversationId,
          channelId: conv.channelId,
          unreadCount: result?.count || 0,
        };
      })
    );

    return c.json({ unreadCounts });

  } catch (error) {
    console.error('Get unread counts error:', error);
    return c.json({ error: 'Failed to get unread counts' }, 500);
  }
});

export { messagesRouter };
