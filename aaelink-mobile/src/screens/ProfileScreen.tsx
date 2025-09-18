/**
 * Profile Screen for AAELink Mobile
 * Version: 1.2.0
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { useTheme } from '../context/ThemeContext';
import { ProfileScreenProps } from '../types/navigation';

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const [isEditing, setIsEditing] = useState(false);

  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const { isOnline, lastSync, pendingSync, clearOfflineData } = useOffline();

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            navigation.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });
          },
        },
      ]
    );
  };

  const handleClearData = async () => {
    Alert.alert(
      'Clear Offline Data',
      'This will remove all offline data. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearOfflineData();
            Alert.alert('Success', 'Offline data cleared');
          },
        },
      ]
    );
  };

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
      alignItems: 'center',
    },
    avatar: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: theme.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    name: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 8,
    },
    email: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    role: {
      fontSize: 14,
      color: theme.colors.primary,
      fontWeight: '600',
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 16,
    },
    infoCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    infoIcon: {
      marginRight: 12,
    },
    infoContent: {
      flex: 1,
    },
    infoLabel: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 2,
    },
    infoValue: {
      fontSize: 16,
      color: theme.colors.text,
      fontWeight: '500',
    },
    actionButton: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: 'row',
      alignItems: 'center',
    },
    actionIcon: {
      marginRight: 12,
    },
    actionText: {
      fontSize: 16,
      color: theme.colors.text,
      fontWeight: '500',
    },
    logoutButton: {
      backgroundColor: theme.colors.error,
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoutText: {
      fontSize: 16,
      color: '#ffffff',
      fontWeight: '600',
    },
  });

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={50} color="#ffffff" />
        </View>
        <Text style={styles.name}>{user?.name || 'User'}</Text>
        <Text style={styles.email}>{user?.email || 'user@example.com'}</Text>
        <Text style={styles.role}>{user?.role?.toUpperCase() || 'USER'}</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Information</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons
                name="mail"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.infoIcon}
              />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{user?.email || 'user@example.com'}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons
                name="shield-checkmark"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.infoIcon}
              />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Role</Text>
                <Text style={styles.infoValue}>{user?.role?.toUpperCase() || 'USER'}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons
                name="time"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.infoIcon}
              />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Last Login</Text>
                <Text style={styles.infoValue}>
                  {user?.lastLogin ? user.lastLogin.toLocaleDateString() : 'Unknown'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection Status</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons
                name={isOnline ? 'wifi' : 'wifi-off'}
                size={20}
                color={isOnline ? theme.colors.success : theme.colors.error}
                style={styles.infoIcon}
              />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Status</Text>
                <Text style={styles.infoValue}>
                  {isOnline ? 'Online' : 'Offline'}
                </Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons
                name="sync"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.infoIcon}
              />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Last Sync</Text>
                <Text style={styles.infoValue}>{formatLastSync()}</Text>
              </View>
            </View>

            {pendingSync > 0 && (
              <View style={styles.infoRow}>
                <Ionicons
                  name="time"
                  size={20}
                  color={theme.colors.warning}
                  style={styles.infoIcon}
                />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Pending Sync</Text>
                  <Text style={styles.infoValue}>{pendingSync} items</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>

          <TouchableOpacity style={styles.actionButton}>
            <Ionicons
              name="settings"
              size={20}
              color={theme.colors.textSecondary}
              style={styles.actionIcon}
            />
            <Text style={styles.actionText}>Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <Ionicons
              name="help-circle"
              size={20}
              color={theme.colors.textSecondary}
              style={styles.actionIcon}
            />
            <Text style={styles.actionText}>Help & Support</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleClearData}>
            <Ionicons
              name="trash"
              size={20}
              color={theme.colors.warning}
              style={styles.actionIcon}
            />
            <Text style={styles.actionText}>Clear Offline Data</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out" size={20} color="#ffffff" style={styles.actionIcon} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
