'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Archive,
    Calendar,
    Download,
    Eye,
    File,
    FileText,
    Image,
    Music,
    Search,
    Trash2,
    User,
    Video
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface FileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
  channelId: string;
  messageId?: string;
}

interface FileListProps {
  channelId: string;
  files?: FileItem[];
}

export function FileList({ channelId, files = [] }: FileListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>(files);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Mock data for demonstration
  const mockFiles: FileItem[] = [
    {
      id: '1',
      name: 'project-presentation.pdf',
      size: 2048576,
      type: 'application/pdf',
      url: '/files/project-presentation.pdf',
      uploadedBy: 'John Doe',
      uploadedAt: '2024-09-18T10:30:00Z',
      channelId: 'general',
      messageId: 'msg-1'
    },
    {
      id: '2',
      name: 'team-photo.jpg',
      size: 1024000,
      type: 'image/jpeg',
      url: '/files/team-photo.jpg',
      uploadedBy: 'Jane Smith',
      uploadedAt: '2024-09-18T09:15:00Z',
      channelId: 'general',
      messageId: 'msg-2'
    },
    {
      id: '3',
      name: 'meeting-recording.mp4',
      size: 52428800,
      type: 'video/mp4',
      url: '/files/meeting-recording.mp4',
      uploadedBy: 'Mike Johnson',
      uploadedAt: '2024-09-17T14:20:00Z',
      channelId: 'general',
      messageId: 'msg-3'
    },
    {
      id: '4',
      name: 'code-snippets.zip',
      size: 512000,
      type: 'application/zip',
      url: '/files/code-snippets.zip',
      uploadedBy: 'Sarah Wilson',
      uploadedAt: '2024-09-17T11:45:00Z',
      channelId: 'engineering',
      messageId: 'msg-4'
    }
  ];

  useEffect(() => {
    setFilteredFiles(mockFiles);
  }, []);

  useEffect(() => {
    let filtered = mockFiles.filter(file =>
      file.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      file.uploadedBy.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sort files
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'date':
          comparison = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    setFilteredFiles(filtered);
  }, [searchTerm, sortBy, sortOrder]);

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <Image className="w-5 h-5 text-blue-500" />;
    if (type.startsWith('video/')) return <Video className="w-5 h-5 text-purple-500" />;
    if (type.startsWith('audio/')) return <Music className="w-5 h-5 text-green-500" />;
    if (type.includes('zip') || type.includes('rar')) return <Archive className="w-5 h-5 text-orange-500" />;
    if (type.includes('pdf')) return <FileText className="w-5 h-5 text-red-500" />;
    return <File className="w-5 h-5 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return date.toLocaleDateString();
  };

  const handleDownload = (file: FileItem) => {
    // In a real app, this would trigger a download
    console.log('Downloading file:', file.name);
  };

  const handlePreview = (file: FileItem) => {
    // In a real app, this would open a preview modal
    console.log('Previewing file:', file.name);
  };

  const handleDelete = (file: FileItem) => {
    // In a real app, this would delete the file
    console.log('Deleting file:', file.name);
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search files..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center space-x-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'size' | 'date')}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800"
          >
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="date">Date</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </Button>
        </div>
      </div>

      {/* File List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Files ({filteredFiles.length})</span>
            <Badge variant="outline" className="text-xs">
              {channelId}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredFiles.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <File className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No files found</p>
            </div>
          ) : (
            filteredFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex-shrink-0">
                  {getFileIcon(file.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {file.name}
                  </p>
                  <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <span className="flex items-center space-x-1">
                      <User className="w-3 h-3" />
                      <span>{file.uploadedBy}</span>
                    </span>
                    <span>•</span>
                    <span className="flex items-center space-x-1">
                      <Calendar className="w-3 h-3" />
                      <span>{formatDate(file.uploadedAt)}</span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePreview(file)}
                    className="h-8 w-8 p-0"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(file)}
                    className="h-8 w-8 p-0"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(file)}
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
