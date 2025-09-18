export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
  userId: string;
  channelId?: string;
  messageId?: string;
}

export interface NotificationSettings {
  desktop: boolean;
  sound: boolean;
  email: boolean;
  push: boolean;
  mentions: boolean;
  directMessages: boolean;
  channelMessages: boolean;
  voiceCalls: boolean;
  videoCalls: boolean;
  fileShares: boolean;
  calendarEvents: boolean;
  systemUpdates: boolean;
}

export class NotificationService {
  private notifications: Notification[] = [];
  private settings: NotificationSettings;
  private listeners: ((notifications: Notification[]) => void)[] = [];

  constructor() {
    this.settings = this.getDefaultSettings();
    this.loadNotifications();
    this.requestPermission();
  }

  private getDefaultSettings(): NotificationSettings {
    return {
      desktop: true,
      sound: true,
      email: false,
      push: true,
      mentions: true,
      directMessages: true,
      channelMessages: false,
      voiceCalls: true,
      videoCalls: true,
      fileShares: false,
      calendarEvents: true,
      systemUpdates: true
    };
  }

  private async requestPermission(): Promise<void> {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  private loadNotifications(): void {
    const stored = localStorage.getItem('aaelink-notifications');
    if (stored) {
      this.notifications = JSON.parse(stored).map((n: any) => ({
        ...n,
        timestamp: new Date(n.timestamp)
      }));
    }
  }

  private saveNotifications(): void {
    localStorage.setItem('aaelink-notifications', JSON.stringify(this.notifications));
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.notifications]));
  }

  // Public methods
  addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): string {
    const id = crypto.randomUUID();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
      read: false
    };

    this.notifications.unshift(newNotification);

    // Keep only last 100 notifications
    if (this.notifications.length > 100) {
      this.notifications = this.notifications.slice(0, 100);
    }

    this.saveNotifications();
    this.notifyListeners();
    this.showDesktopNotification(newNotification);
    this.playNotificationSound();

    return id;
  }

  markAsRead(notificationId: string): void {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      this.saveNotifications();
      this.notifyListeners();
    }
  }

  markAllAsRead(): void {
    this.notifications.forEach(n => n.read = true);
    this.saveNotifications();
    this.notifyListeners();
  }

  deleteNotification(notificationId: string): void {
    this.notifications = this.notifications.filter(n => n.id !== notificationId);
    this.saveNotifications();
    this.notifyListeners();
  }

  clearAllNotifications(): void {
    this.notifications = [];
    this.saveNotifications();
    this.notifyListeners();
  }

  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  getNotificationsByType(type: Notification['type']): Notification[] {
    return this.notifications.filter(n => n.type === type);
  }

  getNotificationsByChannel(channelId: string): Notification[] {
    return this.notifications.filter(n => n.channelId === channelId);
  }

  // Settings
  updateSettings(newSettings: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    localStorage.setItem('aaelink-notification-settings', JSON.stringify(this.settings));
  }

  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  // Event listeners
  subscribe(listener: (notifications: Notification[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Desktop notifications
  private showDesktopNotification(notification: Notification): void {
    if (!this.settings.desktop || Notification.permission !== 'granted') {
      return;
    }

    const desktopNotification = new Notification(notification.title, {
      body: notification.message,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: notification.id,
      requireInteraction: notification.type === 'error' || notification.type === 'warning'
    });

    desktopNotification.onclick = () => {
      window.focus();
      if (notification.actionUrl) {
        window.location.href = notification.actionUrl;
      }
      this.markAsRead(notification.id);
      desktopNotification.close();
    };

    // Auto-close after 5 seconds for non-critical notifications
    if (notification.type !== 'error' && notification.type !== 'warning') {
      setTimeout(() => {
        desktopNotification.close();
      }, 5000);
    }
  }

  // Sound notifications
  private playNotificationSound(): void {
    if (!this.settings.sound) return;

    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.5;
    audio.play().catch(console.error);
  }

  // Push notifications (Service Worker)
  async sendPushNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): Promise<void> {
    if (!this.settings.push || !('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(notification.title, {
        body: notification.message,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        data: notification
      });
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }

  // Email notifications (would integrate with backend)
  async sendEmailNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): Promise<void> {
    if (!this.settings.email) return;

    try {
      await fetch('/api/notifications/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(notification)
      });
    } catch (error) {
      console.error('Error sending email notification:', error);
    }
  }

  // Smart notification filtering
  shouldShowNotification(type: string, channelId?: string, userId?: string): boolean {
    switch (type) {
      case 'mention':
        return this.settings.mentions;
      case 'directMessage':
        return this.settings.directMessages;
      case 'channelMessage':
        return this.settings.channelMessages;
      case 'voiceCall':
        return this.settings.voiceCalls;
      case 'videoCall':
        return this.settings.videoCalls;
      case 'fileShare':
        return this.settings.fileShares;
      case 'calendarEvent':
        return this.settings.calendarEvents;
      case 'systemUpdate':
        return this.settings.systemUpdates;
      default:
        return true;
    }
  }
}

// Singleton instance
export const notificationService = new NotificationService();

// Utility functions
export const createNotification = (
  title: string,
  message: string,
  type: Notification['type'] = 'info',
  options: Partial<Notification> = {}
): Notification => ({
  id: crypto.randomUUID(),
  title,
  message,
  type,
  timestamp: new Date(),
  read: false,
  userId: '',
  ...options
});

export const notificationTypes = {
  MENTION: 'mention',
  DIRECT_MESSAGE: 'directMessage',
  CHANNEL_MESSAGE: 'channelMessage',
  VOICE_CALL: 'voiceCall',
  VIDEO_CALL: 'videoCall',
  FILE_SHARE: 'fileShare',
  CALENDAR_EVENT: 'calendarEvent',
  SYSTEM_UPDATE: 'systemUpdate'
} as const;
