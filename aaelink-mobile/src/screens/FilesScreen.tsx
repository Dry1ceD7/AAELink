/**
 * Files Screen for AAELink Mobile
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
import { FilesScreenProps } from '../types/navigation';

interface File {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadDate: Date;
  uploader: string;
  isShared: boolean;
}

export default function FilesScreen({ navigation }: FilesScreenProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');

  const { theme } = useTheme();
  const { syncData, getOfflineData } = useOffline();

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      // Load from offline storage
      const offlineFiles = await getOfflineData('file');

      // Mock additional files
      const mockFiles: File[] = [
        {
          id: '1',
          name: 'Project_Report.pdf',
          size: 2048576, // 2MB
          type: 'pdf',
          uploadDate: new Date(Date.now() - 3600000),
          uploader: 'John Doe',
          isShared: true,
        },
        {
          id: '2',
          name: 'Meeting_Notes.docx',
          size: 512000, // 512KB
          type: 'docx',
          uploadDate: new Date(Date.now() - 7200000),
          uploader: 'Jane Smith',
          isShared: false,
        },
        {
          id: '3',
          name: 'Presentation.pptx',
          size: 5242880, // 5MB
          type: 'pptx',
          uploadDate: new Date(Date.now() - 86400000),
          uploader: 'Mike Johnson',
          isShared: true,
        },
      ];

      setFiles([...offlineFiles, ...mockFiles]);
    } catch (error) {
      console.error('Failed to load files:', error);
    }
  };

  const uploadFile = () => {
    Alert.alert(
      'Upload File',
      'This feature will be implemented in the next version',
      [{ text: 'OK' }]
    );
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return 'document-text';
      case 'docx':
      case 'doc':
        return 'document';
      case 'pptx':
      case 'ppt':
        return 'easel';
      case 'xlsx':
      case 'xls':
        return 'grid';
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return 'image';
      default:
        return 'document-outline';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderFile = ({ item }: { item: File }) => (
    <TouchableOpacity style={styles.fileCard}>
      <View style={styles.fileHeader}>
        <Ionicons
          name={getFileIcon(item.type)}
          size={24}
          color={theme.colors.primary}
        />
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.fileDetails}>
            {formatFileSize(item.size)} • {item.uploader} • {item.uploadDate.toLocaleDateString()}
          </Text>
        </View>
        {item.isShared && (
          <Ionicons name="share" size={16} color={theme.colors.success} />
        )}
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
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    viewModeButton: {
      marginRight: 12,
      padding: 8,
    },
    uploadButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: 20,
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      flex: 1,
      padding: 16,
    },
    fileCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    fileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    fileInfo: {
      flex: 1,
      marginLeft: 12,
    },
    fileName: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 4,
    },
    fileDetails: {
      fontSize: 14,
      color: theme.colors.textSecondary,
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
        <Text style={styles.headerTitle}>Files</Text>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.viewModeButton}
            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          >
            <Ionicons
              name={viewMode === 'list' ? 'grid' : 'list'}
              size={24}
              color={theme.colors.text}
            />
          </TouchableOpacity>

          <TouchableOpacity style={styles.uploadButton} onPress={uploadFile}>
            <Ionicons name="cloud-upload" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        {files.length > 0 ? (
          <FlatList
            data={files}
            renderItem={renderFile}
            keyExtractor={(item) => item.id}
          />
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="folder-outline" size={64} color={theme.colors.textSecondary} />
            <Text style={styles.emptyText}>
              No files uploaded yet
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
