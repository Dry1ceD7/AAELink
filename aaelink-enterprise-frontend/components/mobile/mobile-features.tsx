'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Battery,
    Bell,
    Camera,
    Download,
    Eye,
    EyeOff,
    Lock,
    MapPin,
    Mic,
    QrCode,
    Settings,
    Shield,
    Signal,
    Smartphone,
    Wifi
} from 'lucide-react';
import { useState } from 'react';

interface MobileFeaturesProps {
  channelId: string;
}

export function MobileFeatures({ channelId }: MobileFeaturesProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(85);
  const [signalStrength, setSignalStrength] = useState(4);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const mobileFeatures = [
    {
      id: 'offline-sync',
      name: 'Offline Sync',
      description: 'Access your data even without internet connection',
      icon: Wifi,
      status: 'enabled',
      action: () => console.log('Offline sync toggled')
    },
    {
      id: 'push-notifications',
      name: 'Push Notifications',
      description: 'Get instant notifications for important updates',
      icon: Bell,
      status: notificationsEnabled ? 'enabled' : 'disabled',
      action: () => setNotificationsEnabled(!notificationsEnabled)
    },
    {
      id: 'location-tracking',
      name: 'Location Tracking',
      description: 'Track team locations for field work',
      icon: MapPin,
      status: locationEnabled ? 'enabled' : 'disabled',
      action: () => setLocationEnabled(!locationEnabled)
    },
    {
      id: 'camera-integration',
      name: 'Camera Integration',
      description: 'Take photos and scan documents on the go',
      icon: Camera,
      status: cameraEnabled ? 'enabled' : 'disabled',
      action: () => setCameraEnabled(!cameraEnabled)
    },
    {
      id: 'voice-commands',
      name: 'Voice Commands',
      description: 'Control the app with voice commands',
      icon: Mic,
      status: micEnabled ? 'enabled' : 'disabled',
      action: () => setMicEnabled(!micEnabled)
    },
    {
      id: 'biometric-auth',
      name: 'Biometric Authentication',
      description: 'Secure login with fingerprint or face ID',
      icon: Shield,
      status: 'enabled',
      action: () => console.log('Biometric auth toggled')
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'enabled':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'disabled':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const getSignalBars = (strength: number) => {
    const bars = [];
    for (let i = 0; i < 5; i++) {
      bars.push(
        <div
          key={i}
          className={`w-1 h-${i < strength ? '4' : '2'} bg-${i < strength ? 'green' : 'gray'}-500 rounded-sm`}
        />
      );
    }
    return bars;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Mobile Features
          </h2>
          <Badge variant="outline" className="text-xs">
            {channelId}
          </Badge>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Download App
          </Button>
          <Button variant="outline" size="sm">
            <QrCode className="w-4 h-4 mr-2" />
            QR Code
          </Button>
        </div>
      </div>

      {/* Mobile Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Mobile Device Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  Device Connected
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {isConnected ? 'Online' : 'Offline'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <Battery className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  Battery Level
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {batteryLevel}%
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center">
                <Signal className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  Signal Strength
                </p>
                <div className="flex space-x-1">
                  {getSignalBars(signalStrength)}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile Features */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Available Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mobileFeatures.map(feature => (
              <div
                key={feature.id}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                    <feature.icon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {feature.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {feature.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge className={getStatusColor(feature.status)}>
                    {feature.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={feature.action}
                    className="h-8 w-8 p-0"
                  >
                    {feature.status === 'enabled' ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* App Download */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Download Mobile App</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Smartphone className="w-12 h-12 text-gray-600 dark:text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              AAELink Mobile
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Access your workspace on the go with our mobile app
            </p>
            <div className="flex justify-center space-x-4">
              <Button>
                <Download className="w-4 h-4 mr-2" />
                Download for iOS
              </Button>
              <Button variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Download for Android
              </Button>
            </div>
            <div className="mt-4">
              <Button variant="ghost" size="sm">
                <QrCode className="w-4 h-4 mr-2" />
                Show QR Code
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Mobile Security</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Lock className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    App Lock
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Require authentication to open the app
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-2" />
                Configure
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Shield className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Data Encryption
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    All data is encrypted on the device
                  </p>
                </div>
              </div>
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                Enabled
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Eye className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Privacy Mode
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Hide sensitive information in notifications
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-2" />
                Configure
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
