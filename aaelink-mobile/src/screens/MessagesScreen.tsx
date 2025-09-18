/**
 * Messages Screen for AAELink Mobile
 * Version: 1.2.0
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useOffline } from '../context/OfflineContext';
import { useTheme } from '../context/ThemeContext';
import { MessagesScreenProps } from '../types/navigation';

interface Message {
  id: string;
  content: string;
  sender: string;
  timestamp: Date;
  isOwn: boolean;
}

interface Channel {
  id: string;
  name: string;
  type: 'general' | 'project' | 'private';
  unreadCount: number;
  lastMessage?: Message;
}

export default function MessagesScreen({ navigation }: MessagesScreenProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { theme } = useTheme();
  const { syncData, getOfflineData } = useOffline();

  useEffect(() => {
    loadChannels();
  }, []);

  useEffect(() => {
    if (selectedChannel) {
      loadMessages(selectedChannel);
    }
  }, [selectedChannel]);

  const loadChannels = async () => {
    // Mock data - replace with real API calls
    setChannels([
      {
        id: '1',
        name: 'General',
        type: 'general',
        unreadCount: 3,
        lastMessage: {
          id: '1',
          content: 'Hello everyone!',
          sender: 'John Doe',
          timestamp: new Date(),
          isOwn: false,
        },
      },
      {
        id: '2',
        name: 'Project Alpha',
        type: 'project',
        unreadCount: 0,
        lastMessage: {
          id: '2',
          content: 'Meeting at 3 PM',
          sender: 'Jane Smith',
          timestamp: new Date(Date.now() - 3600000),
          isOwn: true,
        },
      },
      {
        id: '3',
        name: 'Private Chat',
        type: 'private',
        unreadCount: 1,
        lastMessage: {
          id: '3',
          content: 'Can you review this?',
          sender: 'Mike Johnson',
          timestamp: new Date(Date.now() - 7200000),
          isOwn: false,
        },
      },
    ]);
  };

  const loadMessages = async (channelId: string) => {
    setIsLoading(true);

    try {
      // Load from offline storage first
      const offlineMessages = await getOfflineData('message');
      const channelMessages = offlineMessages.filter((msg: any) => msg.channelId === channelId);

      // Mock additional messages
      const mockMessages: Message[] = [
        {
          id: '1',
          content: 'Hello everyone!',
          sender: 'John Doe',
          timestamp: new Date(),
          isOwn: false,
        },
        {
          id: '2',
          content: 'Hi John!',
          sender: 'You',
          timestamp: new Date(Date.now() - 300000),
          isOwn: true,
        },
        {
          id: '3',
          content: 'How is everyone doing?',
          sender: 'Jane Smith',
          timestamp: new Date(Date.now() - 600000),
          isOwn: false,
        },
      ];

      setMessages([...channelMessages, ...mockMessages]);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedChannel) return;

    const message: Message = {
      id: Date.now().toString(),
      content: newMessage.trim(),
      sender: 'You',
      timestamp: new Date(),
      isOwn: true,
    };

    // Add to local state
    setMessages(prev => [...prev, message]);

    // Sync to offline storage
    await syncData('message', {
      ...message,
      channelId: selectedChannel,
    });

    setNewMessage('');
  };

  const renderChannel = ({ item }: { item: Channel }) => (
    <TouchableOpacity
      style={[
        styles.channelItem,
        selectedChannel === item.id && styles.selectedChannel,
      ]}
      onPress={() => setSelectedChannel(item.id)}
    >
      <View style={styles.channelInfo}>
        <Text style={styles.channelName}>{item.name}</Text>
        {item.lastMessage && (
          <Text style={styles.lastMessage} numberOfLines={1}>
            {item.lastMessage.content}
          </Text>
        )}
      </View>
      {item.unreadCount > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadText}>{item.unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[
      styles.messageContainer,
      item.isOwn ? styles.ownMessage : styles.otherMessage,
    ]}>
      <Text style={styles.messageContent}>{item.content}</Text>
      <Text style={styles.messageTime}>
        {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginLeft: 12,
    },
    content: {
      flex: 1,
      flexDirection: 'row',
    },
    channelsList: {
      width: 200,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
    },
    channelItem: {
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    selectedChannel: {
      backgroundColor: theme.colors.primary + '20',
    },
    channelInfo: {
      flex: 1,
    },
    channelName: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 4,
    },
    lastMessage: {
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
    unreadBadge: {
      position: 'absolute',
      right: 16,
      top: 16,
      backgroundColor: theme.colors.primary,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    unreadText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: 'bold',
    },
    messagesContainer: {
      flex: 1,
    },
    messagesList: {
      flex: 1,
      padding: 16,
    },
    messageContainer: {
      marginBottom: 12,
      maxWidth: '80%',
    },
    ownMessage: {
      alignSelf: 'flex-end',
      backgroundColor: theme.colors.primary,
      borderRadius: 16,
      borderBottomRightRadius: 4,
      padding: 12,
    },
    otherMessage: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      borderBottomLeftRadius: 4,
      padding: 12,
    },
    messageContent: {
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: 4,
    },
    ownMessageContent: {
      color: '#ffffff',
    },
    messageTime: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    ownMessageTime: {
      color: '#ffffff80',
    },
    inputContainer: {
      flexDirection: 'row',
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    textInput: {
      flex: 1,
      backgroundColor: theme.colors.surface,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.colors.text,
      marginRight: 12,
    },
    sendButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: 20,
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
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

  if (!selectedChannel) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="chatbubbles" size={24} color={theme.colors.primary} />
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <View style={styles.content}>
          <FlatList
            data={channels}
            renderItem={renderChannel}
            keyExtractor={(item) => item.id}
            style={styles.channelsList}
          />
          <View style={styles.emptyState}>
            <Ionicons name="chatbubble-outline" size={64} color={theme.colors.textSecondary} />
            <Text style={styles.emptyText}>
              Select a channel to start messaging
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setSelectedChannel(null)}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {channels.find(c => c.id === selectedChannel)?.name}
        </Text>
      </View>

      <View style={styles.content}>
        <FlatList
          data={channels}
          renderItem={renderChannel}
          keyExtractor={(item) => item.id}
          style={styles.channelsList}
        />

        <View style={styles.messagesContainer}>
          <FlatList
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            style={styles.messagesList}
            inverted
          />

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="Type a message..."
              placeholderTextColor={theme.colors.textSecondary}
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
            />
            <TouchableOpacity
              style={styles.sendButton}
              onPress={sendMessage}
              disabled={!newMessage.trim()}
            >
              <Ionicons name="send" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
