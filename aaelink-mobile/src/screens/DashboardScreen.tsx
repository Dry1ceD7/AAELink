/**
 * Dashboard Screen for AAELink Mobile
 * Version: 1.2.0
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    Dimensions,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { useTheme } from '../context/ThemeContext';
import { DashboardScreenProps } from '../types/navigation';

const { width } = Dimensions.get('window');

interface QuickAction {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
}

interface StatCard {
  title: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

export default function DashboardScreen({ navigation }: DashboardScreenProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<StatCard[]>([]);

  const { user } = useAuth();
  const { theme } = useTheme();
  const { isOnline, lastSync, pendingSync, forceSync } = useOffline();

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    // Mock data - replace with real API calls
    setStats([
      {
        title: 'Messages',
        value: '24',
        icon: 'chatbubbles',
        color: theme.colors.primary,
      },
      {
        title: 'Events',
        value: '8',
        icon: 'calendar',
        color: theme.colors.success,
      },
      {
        title: 'Files',
        value: '156',
        icon: 'folder',
        color: theme.colors.warning,
      },
      {
        title: 'Users',
        value: '12',
        icon: 'people',
        color: theme.colors.info,
      },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    await forceSync();
    setRefreshing(false);
  };

  const quickActions: QuickAction[] = [
    {
      id: '1',
      title: 'New Message',
      icon: 'add-circle',
      color: theme.colors.primary,
      onPress: () => navigation.navigate('Messages'),
    },
    {
      id: '2',
      title: 'Schedule Event',
      icon: 'calendar',
      color: theme.colors.success,
      onPress: () => navigation.navigate('Calendar'),
    },
    {
      id: '3',
      title: 'Upload File',
      icon: 'cloud-upload',
      color: theme.colors.warning,
      onPress: () => navigation.navigate('Files'),
    },
    {
      id: '4',
      title: 'View Profile',
      icon: 'person',
      color: theme.colors.info,
      onPress: () => navigation.navigate('Profile'),
    },
  ];

  const formatLastSync = () => {
    if (!lastSync) return 'Never';

    const now = new Date();
    const diff = now.getTime() - lastSync.getTime();
    const minutes = Math.floor(diff / (1000 * 60));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      paddingTop: 60,
      paddingHorizontal: 24,
      paddingBottom: 24,
    },
    greeting: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: theme.colors.textSecondary,
    },
    statusBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 16,
      padding: 12,
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    statusItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    statusText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginLeft: 4,
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 16,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    statCard: {
      width: (width - 72) / 2,
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    statHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    statIcon: {
      marginRight: 8,
    },
    statTitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontWeight: '500',
    },
    statValue: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    actionsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    actionCard: {
      width: (width - 72) / 2,
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
    },
    actionIcon: {
      marginBottom: 8,
    },
    actionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
      textAlign: 'center',
    },
    recentActivity: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    activityItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    activityIcon: {
      marginRight: 12,
    },
    activityContent: {
      flex: 1,
    },
    activityTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
    },
    activitySubtitle: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
  });

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>
            Welcome back, {user?.name || 'User'}!
          </Text>
          <Text style={styles.subtitle}>
            Here's what's happening today
          </Text>

          <View style={styles.statusBar}>
            <View style={styles.statusItem}>
              <Ionicons
                name={isOnline ? 'wifi' : 'wifi-off'}
                size={16}
                color={isOnline ? theme.colors.success : theme.colors.error}
              />
              <Text style={styles.statusText}>
                {isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>

            <View style={styles.statusItem}>
              <Ionicons name="sync" size={16} color={theme.colors.textSecondary} />
              <Text style={styles.statusText}>
                Last sync: {formatLastSync()}
              </Text>
            </View>

            {pendingSync > 0 && (
              <View style={styles.statusItem}>
                <Ionicons name="time" size={16} color={theme.colors.warning} />
                <Text style={styles.statusText}>
                  {pendingSync} pending
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Stats</Text>
          <View style={styles.statsGrid}>
            {stats.map((stat, index) => (
              <View key={index} style={styles.statCard}>
                <View style={styles.statHeader}>
                  <Ionicons
                    name={stat.icon}
                    size={20}
                    color={stat.color}
                    style={styles.statIcon}
                  />
                  <Text style={styles.statTitle}>{stat.title}</Text>
                </View>
                <Text style={styles.statValue}>{stat.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            {quickActions.map((action) => (
              <TouchableOpacity
                key={action.id}
                style={styles.actionCard}
                onPress={action.onPress}
              >
                <Ionicons
                  name={action.icon}
                  size={32}
                  color={action.color}
                  style={styles.actionIcon}
                />
                <Text style={styles.actionTitle}>{action.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <View style={styles.recentActivity}>
            <View style={styles.activityItem}>
              <Ionicons
                name="chatbubble"
                size={20}
                color={theme.colors.primary}
                style={styles.activityIcon}
              />
              <View style={styles.activityContent}>
                <Text style={styles.activityTitle}>New message in General</Text>
                <Text style={styles.activitySubtitle}>2 minutes ago</Text>
              </View>
            </View>

            <View style={styles.activityItem}>
              <Ionicons
                name="calendar"
                size={20}
                color={theme.colors.success}
                style={styles.activityIcon}
              />
              <View style={styles.activityContent}>
                <Text style={styles.activityTitle}>Team meeting scheduled</Text>
                <Text style={styles.activitySubtitle}>1 hour ago</Text>
              </View>
            </View>

            <View style={styles.activityItem}>
              <Ionicons
                name="document"
                size={20}
                color={theme.colors.warning}
                style={styles.activityIcon}
              />
              <View style={styles.activityContent}>
                <Text style={styles.activityTitle}>File uploaded: report.pdf</Text>
                <Text style={styles.activitySubtitle}>3 hours ago</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
