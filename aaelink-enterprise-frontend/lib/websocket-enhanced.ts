/**
 * AAELink Enterprise Enhanced WebSocket Service
 * Real-time communication with advanced features
 * Version: 1.2.0
 */

'use client';

import { io, Socket } from 'socket.io-client';

interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: string;
  id?: string;
}

interface WebSocketConfig {
  url: string;
  options?: {
    auth?: {
      token?: string;
    };
    transports?: string[];
    timeout?: number;
    reconnection?: boolean;
    reconnectionAttempts?: number;
    reconnectionDelay?: number;
  };
}

class EnhancedWebSocketService {
  private socket: Socket | null = null;
  private config: WebSocketConfig;
  private listeners: { [event: string]: ((data: any) => void)[] } = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;

  constructor(config: WebSocketConfig) {
    this.config = config;
  }

  connect(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket && this.socket.connected) {
        resolve();
        return;
      }

      const options = {
        ...this.config.options,
        auth: {
          ...this.config.options?.auth,
          token: token || this.config.options?.auth?.token,
        },
      };

      this.socket = io(this.config.url, options);

      this.socket.on('connect', () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connect');
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('WebSocket disconnected:', reason);
        this.isConnected = false;
        this.emit('disconnect', reason);
      });

      this.socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        this.emit('error', error);
        reject(error);
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('WebSocket reconnected after', attemptNumber, 'attempts');
        this.isConnected = true;
        this.emit('reconnect', attemptNumber);
      });

      this.socket.on('reconnect_error', (error) => {
        console.error('WebSocket reconnection error:', error);
        this.emit('reconnect_error', error);
      });

      this.socket.on('reconnect_failed', () => {
        console.error('WebSocket reconnection failed');
        this.emit('reconnect_failed');
      });

      // Set up message handling
      this.socket.onAny((event, ...args) => {
        this.emit(event, ...args);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  sendMessage(type: string, payload: any): void {
    if (this.socket && this.socket.connected) {
      const message: WebSocketMessage = {
        type,
        payload,
        timestamp: new Date().toISOString(),
        id: Math.random().toString(36).substr(2, 9),
      };
      this.socket.emit('message', message);
    } else {
      console.warn('WebSocket not connected. Message not sent:', type, payload);
    }
  }

  joinChannel(channelId: string): void {
    this.sendMessage('channel:join', { channelId });
  }

  leaveChannel(channelId: string): void {
    this.sendMessage('channel:leave', { channelId });
  }

  sendChannelMessage(channelId: string, content: string, type: string = 'text'): void {
    this.sendMessage('message:send', { channelId, content, type });
  }

  startTyping(channelId: string): void {
    this.sendMessage('typing:start', { channelId });
  }

  stopTyping(channelId: string): void {
    this.sendMessage('typing:stop', { channelId });
  }

  on(event: string, listener: (data: any) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  off(event: string, listener: (data: any) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(l => l !== listener);
    }
  }

  private emit(event: string, ...args: any[]): void {
    if (this.listeners[event]) {
      this.listeners[event].forEach(listener => listener(...args));
    }
  }

  get connected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }

  get socketId(): string | undefined {
    return this.socket?.id;
  }
}

// Create singleton instance
export const websocketService = new EnhancedWebSocketService({
  url: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001',
  options: {
    transports: ['websocket', 'polling'],
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  },
});

export default websocketService;
