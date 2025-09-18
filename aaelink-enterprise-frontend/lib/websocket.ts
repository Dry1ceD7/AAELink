'use client';

class WebSocketService {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private eventListeners: Map<string, Function[]> = new Map();

  connect(token?: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('Connected to WebSocket server');
      this.reconnectAttempts = 0;
    };

    this.socket.onclose = (event) => {
      console.log('Disconnected from WebSocket server:', event.code, event.reason);
      this.handleReconnect();
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.handleReconnect();
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit(data.type, data.payload);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      setTimeout(() => {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.connect();
      }, delay);
    }
  }

  private emit(event: string, data: any) {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => listener(data));
  }

  // Event listeners
  on(event: string, callback: Function) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function) {
    const listeners = this.eventListeners.get(event) || [];
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  // Message events
  onMessage(callback: (message: any) => void) {
    this.on('message', callback);
  }

  onMessageUpdate(callback: (message: any) => void) {
    this.on('message:update', callback);
  }

  onMessageDelete(callback: (messageId: string) => void) {
    this.on('message:delete', callback);
  }

  // Channel events
  onChannelJoin(callback: (channel: any) => void) {
    this.on('channel:join', callback);
  }

  onChannelLeave(callback: (channel: any) => void) {
    this.on('channel:leave', callback);
  }

  onChannelUpdate(callback: (channel: any) => void) {
    this.on('channel:update', callback);
  }

  // User events
  onUserJoin(callback: (user: any) => void) {
    this.on('user:join', callback);
  }

  onUserLeave(callback: (user: any) => void) {
    this.on('user:leave', callback);
  }

  onUserStatusUpdate(callback: (user: any) => void) {
    this.on('user:status', callback);
  }

  // Typing indicators
  onTypingStart(callback: (data: { channelId: string; user: any }) => void) {
    this.on('typing:start', callback);
  }

  onTypingStop(callback: (data: { channelId: string; user: any }) => void) {
    this.on('typing:stop', callback);
  }

  // Emit events
  send(type: string, data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload: data }));
    }
  }

  joinChannel(channelId: string) {
    this.send('channel:join', { channelId });
  }

  leaveChannel(channelId: string) {
    this.send('channel:leave', { channelId });
  }

  sendMessage(channelId: string, content: string, type: string = 'text') {
    this.send('message:send', {
      channelId,
      content,
      type,
    });
  }

  updateMessage(messageId: string, content: string) {
    this.send('message:update', {
      messageId,
      content,
    });
  }

  deleteMessage(messageId: string) {
    this.send('message:delete', { messageId });
  }

  startTyping(channelId: string) {
    this.send('typing:start', { channelId });
  }

  stopTyping(channelId: string) {
    this.send('typing:stop', { channelId });
  }

  // File sharing
  uploadFile(channelId: string, file: File, onProgress?: (progress: number) => void) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('channelId', channelId);

    return fetch('/api/files/upload', {
      method: 'POST',
      body: formData,
    });
  }

  // Voice/Video calls
  initiateCall(channelId: string, type: 'voice' | 'video') {
    this.send('call:initiate', { channelId, type });
  }

  joinCall(callId: string) {
    this.send('call:join', { callId });
  }

  leaveCall(callId: string) {
    this.send('call:leave', { callId });
  }

  onCallInitiated(callback: (call: any) => void) {
    this.on('call:initiated', callback);
  }

  onCallJoined(callback: (call: any) => void) {
    this.on('call:joined', callback);
  }

  onCallLeft(callback: (call: any) => void) {
    this.on('call:left', callback);
  }

  // Notifications
  onNotification(callback: (notification: any) => void) {
    this.on('notification', callback);
  }

  // Disconnect
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  // Getters
  get isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get socketId() {
    return this.socket ? 'ws-connection' : null;
  }
}

export const websocketService = new WebSocketService();
