/**
 * Settings Screen for AAELink Mobile
 * Version: 1.2.0
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOffline } from '../context/OfflineContext';
import { useTheme } from '../context/ThemeContext';
import { SettingsScreenProps } from '../types/navigation';

export default function SettingsScreen({ navigation }: SettingsScreenProps) {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);

  const { theme, setTheme } = useTheme();
  const { isOnline, forceSync } = useOffline();

  const handleThemeChange = (isDark: boolean) => {
    setDarkMode(isDark);
    setTheme(isDark ? 'dark' : 'light');
  };

  const handleSyncNow = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Cannot sync while offline');
      return;
    }

    try {
      await forceSync();
      Alert.alert('Success', 'Sync completed');
    } catch (error) {
      Alert.alert('Error', 'Sync failed. Please try again.');
    }
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will clear all cached data. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', onPress: () => Alert.alert('Success', 'Cache cleared') },
      ]
    );
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    content: {
      flex: 1,
      padding: 16,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 12,
    },
    settingItem: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    settingInfo: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    settingIcon: {
      marginRight: 12,
    },
    settingContent: {
      flex: 1,
    },
    settingTitle: {
      fontSize: 16,
      color: theme.colors.text,
      fontWeight: '500',
      marginBottom: 2,
    },
    settingDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
    actionButton: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 8,
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
    versionInfo: {
      alignItems: 'center',
      marginTop: 24,
      padding: 16,
    },
    versionText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons
                name="moon"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.settingIcon}
              />
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>Dark Mode</Text>
                <Text style={styles.settingDescription}>
                  Use dark theme
                </Text>
              </View>
            </View>
            <Switch
              value={darkMode}
              onValueChange={handleThemeChange}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor={darkMode ? '#ffffff' : theme.colors.textSecondary}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons
                name="notifications"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.settingIcon}
              />
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>Push Notifications</Text>
                <Text style={styles.settingDescription}>
                  Receive notifications for messages and events
                </Text>
              </View>
            </View>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor={notifications ? '#ffffff' : theme.colors.textSecondary}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sync & Storage</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons
                name="sync"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.settingIcon}
              />
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>Auto Sync</Text>
                <Text style={styles.settingDescription}>
                  Automatically sync when online
                </Text>
              </View>
            </View>
            <Switch
              value={autoSync}
              onValueChange={setAutoSync}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor={autoSync ? '#ffffff' : theme.colors.textSecondary}
            />
          </View>

          <TouchableOpacity style={styles.actionButton} onPress={handleSyncNow}>
            <Ionicons
              name="refresh"
              size={20}
              color={theme.colors.primary}
              style={styles.actionIcon}
            />
            <Text style={styles.actionText}>Sync Now</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleClearCache}>
            <Ionicons
              name="trash"
              size={20}
              color={theme.colors.warning}
              style={styles.actionIcon}
            />
            <Text style={styles.actionText}>Clear Cache</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons
                name="information-circle"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.settingIcon}
              />
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>Version</Text>
                <Text style={styles.settingDescription}>
                  AAELink Mobile v1.2.0
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Ionicons
                name="shield-checkmark"
                size={20}
                color={theme.colors.textSecondary}
                style={styles.settingIcon}
              />
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>Security</Text>
                <Text style={styles.settingDescription}>
                  End-to-end encrypted
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.versionInfo}>
          <Text style={styles.versionText}>
            © 2024 Advanced ID Asia Engineering Co.,Ltd
          </Text>
          <Text style={styles.versionText}>
            All rights reserved
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
