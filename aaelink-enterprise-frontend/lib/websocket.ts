/**
 * AAELink Enterprise WebSocket Service
 * Real-time communication with backend
 * Version: 1.2.0
 */

import { io, Socket } from 'socket.io-client';

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: number;
  id: string;
}

export interface WebSocketEventHandlers {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  onMessage?: (message: WebSocketMessage) => void;
  typing?: (data: { userId: string; isTyping: boolean; channelId: string }) => void;
  presence?: (data: { userId: string; status: 'online' | 'away' | 'busy' | 'offline' }) => void;
  new_message?: (message: any) => void;
  message_update?: (message: any) => void;
  message_delete?: (messageId: string) => void;
  file_upload?: (file: any) => void;
  user_join?: (user: any) => void;
  user_leave?: (userId: string) => void;
  channel_update?: (channel: any) => void;
  notification?: (notification: any) => void;
}

class WebSocketService {
  private socket: Socket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private eventHandlers: WebSocketEventHandlers = {};
  private messageQueue: WebSocketMessage[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (typeof window === 'undefined') return;

    // Handle page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseHeartbeat();
      } else {
        this.resumeHeartbeat();
      }
    });

    // Handle online/offline events
    window.addEventListener('online', () => {
      this.connect();
    });

    window.addEventListener('offline', () => {
      this.disconnect();
    });
  }

  connect(url?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }

      const wsUrl = url || process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';
      
      this.socket = io(wsUrl, {
        transports: ['websocket', 'polling'],
        upgrade: true,
        rememberUpgrade: true,
        timeout: 20000,
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        reconnectionDelayMax: 5000,
      });

      this.socket.on('connect', () => {
        console.log('[WebSocket] Connected to server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.processMessageQueue();
        this.eventHandlers.onConnect?.();
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[WebSocket] Disconnected from server:', reason);
        this.isConnected = false;
        this.stopHeartbeat();
        this.eventHandlers.onDisconnect?.(reason);
      });

      this.socket.on('connect_error', (error) => {
        console.error('[WebSocket] Connection error:', error);
        this.eventHandlers.onError?.(error);
        reject(error);
      });

      this.socket.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
        this.eventHandlers.onError?.(error);
      });

      // Message handlers
      this.socket.on('message', (data) => {
        this.handleMessage(data);
      });

      this.socket.on('typing', (data) => {
        this.eventHandlers.typing?.(data);
      });

      this.socket.on('presence', (data) => {
        this.eventHandlers.presence?.(data);
      });

      this.socket.on('new_message', (message) => {
        this.eventHandlers.new_message?.(message);
      });

      this.socket.on('message_update', (message) => {
        this.eventHandlers.message_update?.(message);
      });

      this.socket.on('message_delete', (messageId) => {
        this.eventHandlers.message_delete?.(messageId);
      });

      this.socket.on('file_upload', (file) => {
        this.eventHandlers.file_upload?.(file);
      });

      this.socket.on('user_join', (user) => {
        this.eventHandlers.user_join?.(user);
      });

      this.socket.on('user_leave', (userId) => {
        this.eventHandlers.user_leave?.(userId);
      });

      this.socket.on('channel_update', (channel) => {
        this.eventHandlers.channel_update?.(channel);
      });

      this.socket.on('notification', (notification) => {
        this.eventHandlers.notification?.(notification);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.stopHeartbeat();
  }

  private handleMessage(data: any): void {
    const message: WebSocketMessage = {
      type: data.type || 'message',
      data: data.data || data,
      timestamp: data.timestamp || Date.now(),
      id: data.id || this.generateId(),
    };

    this.eventHandlers.onMessage?.(message);
  }

  // Message sending methods
  sendMessage(type: string, data: any): void {
    const message: WebSocketMessage = {
      type,
      data,
      timestamp: Date.now(),
      id: this.generateId(),
    };

    if (this.isConnected && this.socket) {
      this.socket.emit('message', message);
    } else {
      // Queue message for later sending
      this.messageQueue.push(message);
    }
  }

  sendTyping(channelId: string, isTyping: boolean): void {
    this.sendMessage('typing', { channelId, isTyping });
  }

  sendPresence(status: 'online' | 'away' | 'busy' | 'offline'): void {
    this.sendMessage('presence', { status });
  }

  joinChannel(channelId: string): void {
    this.sendMessage('join_channel', { channelId });
  }

  leaveChannel(channelId: string): void {
    this.sendMessage('leave_channel', { channelId });
  }

  // Event handler management
  on(event: keyof WebSocketEventHandlers, handler: any): void {
    this.eventHandlers[event] = handler;
  }

  off(event: keyof WebSocketEventHandlers): void {
    delete this.eventHandlers[event];
  }

  // Heartbeat management
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.socket) {
        this.socket.emit('ping');
      }
    }, 30000); // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private pauseHeartbeat(): void {
    this.stopHeartbeat();
  }

  private resumeHeartbeat(): void {
    if (this.isConnected) {
      this.startHeartbeat();
    }
  }

  // Message queue management
  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) return;

    console.log(`[WebSocket] Processing ${this.messageQueue.length} queued messages`);
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.socket) {
        this.socket.emit('message', message);
      }
    }
  }

  // Utility methods
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public API
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  // Reconnection management
  private handleReconnection(): void {
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      console.log(`[WebSocket] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('[WebSocket] Max reconnection attempts reached');
    }
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    isConnected: boolean;
    reconnectAttempts: number;
    queuedMessages: number;
  }> {
    return {
      status: this.isConnected ? 'healthy' : 'unhealthy',
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.messageQueue.length,
    };
  }

  // Cleanup
  destroy(): void {
    this.disconnect();
    this.eventHandlers = {};
    this.messageQueue = [];
  }
}

// Export singleton instance
export const webSocketService = new WebSocketService();
export default webSocketService;
