'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { 
  Bell, 
  BellOff, 
  Settings, 
  Check, 
  X, 
  Trash2,
  Volume2,
  VolumeX,
  Mail,
  Smartphone
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { notificationService, Notification, NotificationSettings } from '@/lib/notifications';
import { formatDistanceToNow } from 'date-fns';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [settings, setSettings] = useState<NotificationSettings>(notificationService.getSettings());
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    const unsubscribe = notificationService.subscribe(setNotifications);
    setNotifications(notificationService.getNotifications());
    setSettings(notificationService.getSettings());
    
    return unsubscribe;
  }, []);

  const handleMarkAsRead = (notificationId: string) => {
    notificationService.markAsRead(notificationId);
  };

  const handleMarkAllAsRead = () => {
    notificationService.markAllAsRead();
  };

  const handleDeleteNotification = (notificationId: string) => {
    notificationService.deleteNotification(notificationId);
  };

  const handleClearAll = () => {
    notificationService.clearAllNotifications();
  };

  const handleSettingChange = (key: keyof NotificationSettings, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    notificationService.updateSettings(newSettings);
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return 'ℹ️';
    }
  };

  const getNotificationColor = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return 'text-green-600';
      case 'warning':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-blue-600';
    }
  };

  const filteredNotifications = notifications.filter(notification => {
    switch (activeTab) {
      case 'unread':
        return !notification.read;
      case 'mentions':
        return notification.title.toLowerCase().includes('mention');
      case 'direct':
        return notification.title.toLowerCase().includes('direct message');
      case 'system':
        return notification.type === 'info' && !notification.channelId;
      default:
        return true;
    }
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Bell className="w-5 h-5" />
              <CardTitle>Notifications</CardTitle>
              {unreadCount > 0 && (
                <Badge variant="destructive">{unreadCount}</Badge>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                onClick={handleMarkAllAsRead}
                variant="outline"
                size="sm"
                disabled={unreadCount === 0}
              >
                <Check className="w-4 h-4 mr-1" />
                Mark all read
              </Button>
              <Button
                onClick={handleClearAll}
                variant="outline"
                size="sm"
                disabled={notifications.length === 0}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear all
              </Button>
              <Button onClick={onClose} variant="ghost" size="icon">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start rounded-none border-b">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">
                Unread {unreadCount > 0 && `(${unreadCount})`}
              </TabsTrigger>
              <TabsTrigger value="mentions">Mentions</TabsTrigger>
              <TabsTrigger value="direct">Direct</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="p-6">
              <div className="space-y-6">
                <h3 className="text-lg font-semibold">Notification Settings</h3>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Bell className="w-4 h-4" />
                      <span>Desktop Notifications</span>
                    </div>
                    <Switch
                      checked={settings.desktop}
                      onCheckedChange={(checked) => handleSettingChange('desktop', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Volume2 className="w-4 h-4" />
                      <span>Sound Notifications</span>
                    </div>
                    <Switch
                      checked={settings.sound}
                      onCheckedChange={(checked) => handleSettingChange('sound', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Mail className="w-4 h-4" />
                      <span>Email Notifications</span>
                    </div>
                    <Switch
                      checked={settings.email}
                      onCheckedChange={(checked) => handleSettingChange('email', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Smartphone className="w-4 h-4" />
                      <span>Push Notifications</span>
                    </div>
                    <Switch
                      checked={settings.push}
                      onCheckedChange={(checked) => handleSettingChange('push', checked)}
                    />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3">Notification Types</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span>Mentions</span>
                      <Switch
                        checked={settings.mentions}
                        onCheckedChange={(checked) => handleSettingChange('mentions', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Direct Messages</span>
                      <Switch
                        checked={settings.directMessages}
                        onCheckedChange={(checked) => handleSettingChange('directMessages', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Channel Messages</span>
                      <Switch
                        checked={settings.channelMessages}
                        onCheckedChange={(checked) => handleSettingChange('channelMessages', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Voice Calls</span>
                      <Switch
                        checked={settings.voiceCalls}
                        onCheckedChange={(checked) => handleSettingChange('voiceCalls', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Video Calls</span>
                      <Switch
                        checked={settings.videoCalls}
                        onCheckedChange={(checked) => handleSettingChange('videoCalls', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>File Shares</span>
                      <Switch
                        checked={settings.fileShares}
                        onCheckedChange={(checked) => handleSettingChange('fileShares', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Calendar Events</span>
                      <Switch
                        checked={settings.calendarEvents}
                        onCheckedChange={(checked) => handleSettingChange('calendarEvents', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>System Updates</span>
                      <Switch
                        checked={settings.systemUpdates}
                        onCheckedChange={(checked) => handleSettingChange('systemUpdates', checked)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="all" className="p-0">
              <div className="max-h-96 overflow-y-auto">
                {filteredNotifications.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    No notifications
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={cn(
                          "p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors",
                          !notification.read && "bg-blue-50 dark:bg-blue-900/20"
                        )}
                      >
                        <div className="flex items-start space-x-3">
                          <div className="text-lg">
                            {getNotificationIcon(notification.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <h4 className={cn(
                                "font-medium text-sm",
                                getNotificationColor(notification.type)
                              )}>
                                {notification.title}
                              </h4>
                              {!notification.read && (
                                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {notification.message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                            </p>
                          </div>
                          <div className="flex items-center space-x-1">
                            {!notification.read && (
                              <Button
                                onClick={() => handleMarkAsRead(notification.id)}
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2"
                              >
                                <Check className="w-3 h-3" />
                              </Button>
                            )}
                            <Button
                              onClick={() => handleDeleteNotification(notification.id)}
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-red-500"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {['unread', 'mentions', 'direct', 'system'].map((tab) => (
              <TabsContent key={tab} value={tab} className="p-0">
                <div className="max-h-96 overflow-y-auto">
                  {filteredNotifications.length === 0 ? (
                    <div className="p-6 text-center text-muted-foreground">
                      No {tab} notifications
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredNotifications.map((notification) => (
                        <div
                          key={notification.id}
                          className={cn(
                            "p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors",
                            !notification.read && "bg-blue-50 dark:bg-blue-900/20"
                          )}
                        >
                          <div className="flex items-start space-x-3">
                            <div className="text-lg">
                              {getNotificationIcon(notification.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <h4 className={cn(
                                  "font-medium text-sm",
                                  getNotificationColor(notification.type)
                                )}>
                                  {notification.title}
                                </h4>
                                {!notification.read && (
                                  <div className="w-2 h-2 bg-blue-500 rounded-full" />
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {notification.message}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                              </p>
                            </div>
                            <div className="flex items-center space-x-1">
                              {!notification.read && (
                                <Button
                                  onClick={() => handleMarkAsRead(notification.id)}
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                >
                                  <Check className="w-3 h-3" />
                                </Button>
                              )}
                              <Button
                                onClick={() => handleDeleteNotification(notification.id)}
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-red-500"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
