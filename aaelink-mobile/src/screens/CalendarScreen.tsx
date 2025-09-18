/**
 * Calendar Screen for AAELink Mobile
 * Version: 1.2.0
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useOffline } from '../context/OfflineContext';
import { useTheme } from '../context/ThemeContext';
import { CalendarScreenProps } from '../types/navigation';

interface Event {
  id: string;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  attendees: string[];
  type: 'meeting' | 'deadline' | 'reminder' | 'holiday';
}

export default function CalendarScreen({ navigation }: CalendarScreenProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');

  const { theme } = useTheme();
  const { syncData, getOfflineData } = useOffline();

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      // Load from offline storage
      const offlineEvents = await getOfflineData('event');

      // Mock additional events
      const mockEvents: Event[] = [
        {
          id: '1',
          title: 'Team Meeting',
          description: 'Weekly team standup',
          startDate: new Date(Date.now() + 3600000),
          endDate: new Date(Date.now() + 7200000),
          location: 'Conference Room A',
          attendees: ['John Doe', 'Jane Smith', 'Mike Johnson'],
          type: 'meeting',
        },
        {
          id: '2',
          title: 'Project Deadline',
          description: 'Submit final report',
          startDate: new Date(Date.now() + 86400000),
          endDate: new Date(Date.now() + 86400000),
          attendees: ['You'],
          type: 'deadline',
        },
        {
          id: '3',
          title: 'Client Call',
          description: 'Discuss requirements',
          startDate: new Date(Date.now() + 172800000),
          endDate: new Date(Date.now() + 180000000),
          location: 'Online',
          attendees: ['You', 'Client'],
          type: 'meeting',
        },
      ];

      setEvents([...offlineEvents, ...mockEvents]);
    } catch (error) {
      console.error('Failed to load events:', error);
    }
  };

  const createEvent = async () => {
    Alert.alert(
      'Create Event',
      'This feature will be implemented in the next version',
      [{ text: 'OK' }]
    );
  };

  const getEventTypeIcon = (type: Event['type']) => {
    switch (type) {
      case 'meeting':
        return 'people';
      case 'deadline':
        return 'flag';
      case 'reminder':
        return 'alarm';
      case 'holiday':
        return 'gift';
      default:
        return 'calendar';
    }
  };

  const getEventTypeColor = (type: Event['type']) => {
    switch (type) {
      case 'meeting':
        return theme.colors.primary;
      case 'deadline':
        return theme.colors.error;
      case 'reminder':
        return theme.colors.warning;
      case 'holiday':
        return theme.colors.success;
      default:
        return theme.colors.textSecondary;
    }
  };

  const renderEvent = ({ item }: { item: Event }) => (
    <TouchableOpacity style={styles.eventCard}>
      <View style={styles.eventHeader}>
        <Ionicons
          name={getEventTypeIcon(item.type)}
          size={20}
          color={getEventTypeColor(item.type)}
        />
        <Text style={styles.eventTitle}>{item.title}</Text>
      </View>

      <Text style={styles.eventDescription}>{item.description}</Text>

      <View style={styles.eventDetails}>
        <View style={styles.eventDetail}>
          <Ionicons name="time" size={16} color={theme.colors.textSecondary} />
          <Text style={styles.eventDetailText}>
            {item.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        {item.location && (
          <View style={styles.eventDetail}>
            <Ionicons name="location" size={16} color={theme.colors.textSecondary} />
            <Text style={styles.eventDetailText}>{item.location}</Text>
          </View>
        )}

        <View style={styles.eventDetail}>
          <Ionicons name="people" size={16} color={theme.colors.textSecondary} />
          <Text style={styles.eventDetailText}>
            {item.attendees.length} attendees
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    viewModeContainer: {
      flexDirection: 'row',
      backgroundColor: theme.colors.surface,
      borderRadius: 8,
      padding: 2,
    },
    viewModeButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    activeViewMode: {
      backgroundColor: theme.colors.primary,
    },
    viewModeText: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    activeViewModeText: {
      color: '#ffffff',
    },
    content: {
      flex: 1,
      padding: 16,
    },
    dateHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    dateText: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    addButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: 20,
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    eventsList: {
      flex: 1,
    },
    eventCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    eventHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    eventTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginLeft: 8,
    },
    eventDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 12,
    },
    eventDetails: {
      gap: 8,
    },
    eventDetail: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    eventDetailText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginLeft: 8,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
    },
    emptyText: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 16,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Calendar</Text>

        <View style={styles.viewModeContainer}>
          <TouchableOpacity
            style={[
              styles.viewModeButton,
              viewMode === 'day' && styles.activeViewMode,
            ]}
            onPress={() => setViewMode('day')}
          >
            <Text
              style={[
                styles.viewModeText,
                viewMode === 'day' && styles.activeViewModeText,
              ]}
            >
              Day
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewModeButton,
              viewMode === 'week' && styles.activeViewMode,
            ]}
            onPress={() => setViewMode('week')}
          >
            <Text
              style={[
                styles.viewModeText,
                viewMode === 'week' && styles.activeViewModeText,
              ]}
            >
              Week
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewModeButton,
              viewMode === 'month' && styles.activeViewMode,
            ]}
            onPress={() => setViewMode('month')}
          >
            <Text
              style={[
                styles.viewModeText,
                viewMode === 'month' && styles.activeViewModeText,
              ]}
            >
              Month
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.dateHeader}>
          <Text style={styles.dateText}>
            {selectedDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </Text>

          <TouchableOpacity style={styles.addButton} onPress={createEvent}>
            <Ionicons name="add" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {events.length > 0 ? (
          <FlatList
            data={events}
            renderItem={renderEvent}
            keyExtractor={(item) => item.id}
            style={styles.eventsList}
          />
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={64} color={theme.colors.textSecondary} />
            <Text style={styles.emptyText}>
              No events scheduled for this day
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
