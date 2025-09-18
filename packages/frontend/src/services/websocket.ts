/**
 * WebSocket Client for Real-time Communication
 * Handles connection, reconnection, and message broadcasting
 */

interface WebSocketMessage {
  type: 'message' | 'typing' | 'presence' | 'reaction' | 'read' | 'joined' | 'left';
  channelId: string;
  userId: string;
  data: any;
  timestamp: string;
}

interface WebSocketCallbacks {
  onMessage?: (message: any) => void;
  onTyping?: (userId: string, channelId: string, isTyping: boolean) => void;
  onPresence?: (userId: string, channelId: string, action: string) => void;
  onReaction?: (messageId: string, emoji: string, userId: string) => void;
  onRead?: (messageId: string, userId: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private callbacks: WebSocketCallbacks = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private userId: string | null = null;
  private channels = new Set<string>();

  constructor(private url: string) {}

  public connect(userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
        resolve();
        return;
      }

      this.isConnecting = true;
      this.userId = userId;

      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.callbacks.onConnected?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket disconnected:', event.code, event.reason);
          this.isConnecting = false;
          this.callbacks.onDisconnected?.();

          if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.isConnecting = false;
          this.callbacks.onError?.(error instanceof Error ? error : new Error('WebSocket error'));
          reject(error);
        };

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.channels.clear();
  }

  public joinChannel(channelId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    this.channels.add(channelId);
    this.send({
      type: 'join',
      channelId,
      userId: this.userId!,
      data: {}
    });
  }

  public leaveChannel(channelId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.channels.delete(channelId);
    this.send({
      type: 'leave',
      channelId,
      userId: this.userId!,
      data: {}
    });
  }

  public sendMessage(channelId: string, content: string, type: string = 'text'): void {
    this.send({
      type: 'message',
      channelId,
      userId: this.userId!,
      data: { content, type }
    });
  }

  public sendTyping(channelId: string, isTyping: boolean): void {
    this.send({
      type: 'typing',
      channelId,
      userId: this.userId!,
      data: { isTyping }
    });
  }

  public sendReaction(messageId: string, emoji: string, channelId: string): void {
    this.send({
      type: 'reaction',
      channelId,
      userId: this.userId!,
      data: { messageId, emoji }
    });
  }

  public markAsRead(messageId: string, channelId: string): void {
    this.send({
      type: 'read',
      channelId,
      userId: this.userId!,
      data: { messageId }
    });
  }

  public setCallbacks(callbacks: WebSocketCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected');
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'message':
        this.callbacks.onMessage?.(message.data);
        break;
      case 'typing':
        this.callbacks.onTyping?.(message.userId, message.channelId, message.data.isTyping);
        break;
      case 'presence':
        this.callbacks.onPresence?.(message.userId, message.channelId, message.data.action);
        break;
      case 'reaction':
        this.callbacks.onReaction?.(message.data.messageId, message.data.emoji, message.userId);
        break;
      case 'read':
        this.callbacks.onRead?.(message.data.messageId, message.userId);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (this.userId) {
        this.connect(this.userId).catch(console.error);
      }
    }, delay);
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public getConnectedChannels(): string[] {
    return Array.from(this.channels);
  }
}

// Create singleton instance
const wsService = new WebSocketService('ws://localhost:3002/ws');

export { wsService as WebSocketService };
export type { WebSocketCallbacks, WebSocketMessage };

