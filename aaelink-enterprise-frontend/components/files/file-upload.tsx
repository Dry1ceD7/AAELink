'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
    AlertCircle,
    Archive,
    CheckCircle,
    File,
    FileText,
    Image,
    Music,
    Upload,
    Video,
    X
} from 'lucide-react';
import { useRef, useState } from 'react';

interface FileUploadProps {
  channelId: string;
  onUploadComplete?: (file: any) => void;
  maxSize?: number; // in MB
  allowedTypes?: string[];
}

interface FileItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

export function FileUpload({
  channelId,
  onUploadComplete,
  maxSize = 50,
  allowedTypes = ['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/*', 'application/zip']
}: FileUploadProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <Image className="w-4 h-4" />;
    if (file.type.startsWith('video/')) return <Video className="w-4 h-4" />;
    if (file.type.startsWith('audio/')) return <Music className="w-4 h-4" />;
    if (file.type.includes('zip') || file.type.includes('rar')) return <Archive className="w-4 h-4" />;
    if (file.type.includes('pdf')) return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > maxSize * 1024 * 1024) {
      return `File size must be less than ${maxSize}MB`;
    }

    // Check file type
    const isValidType = allowedTypes.some(type => {
      if (type.endsWith('/*')) {
        return file.type.startsWith(type.slice(0, -1));
      }
      return file.type === type;
    });

    if (!isValidType) {
      return `File type ${file.type} is not allowed`;
    }

    return null;
  };

  const handleFiles = (fileList: FileList) => {
    const newFiles: FileItem[] = [];

    Array.from(fileList).forEach(file => {
      const error = validateFile(file);
      const fileItem: FileItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        file,
        progress: 0,
        status: error ? 'error' : 'pending',
        error
      };
      newFiles.push(fileItem);
    });

    setFiles(prev => [...prev, ...newFiles]);

    // Auto-upload valid files
    newFiles.forEach(fileItem => {
      if (fileItem.status === 'pending') {
        uploadFile(fileItem);
      }
    });
  };

  const uploadFile = async (fileItem: FileItem) => {
    setFiles(prev => prev.map(f =>
      f.id === fileItem.id ? { ...f, status: 'uploading' } : f
    ));

    try {
      const formData = new FormData();
      formData.append('file', fileItem.file);
      formData.append('channelId', channelId);

      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

      setFiles(prev => prev.map(f =>
        f.id === fileItem.id
          ? { ...f, status: 'completed', progress: 100 }
          : f
      ));

      onUploadComplete?.(result.data);
    } catch (error) {
      setFiles(prev => prev.map(f =>
        f.id === fileItem.id
          ? {
              ...f,
              status: 'error',
              error: error instanceof Error ? error.message : 'Upload failed'
            }
          : f
      ));
    }
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const fileList = e.dataTransfer.files;
    if (fileList.length > 0) {
      handleFiles(fileList);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      handleFiles(fileList);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
          isDragOver
            ? "border-aae-blue-500 bg-aae-blue-50 dark:bg-aae-blue-900/20"
            : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Drag and drop files here, or click to select
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Max size: {maxSize}MB • Supported: Images, Videos, Audio, PDF, Text, Archives
        </p>
        <Button
          onClick={openFileDialog}
          variant="outline"
          size="sm"
          className="mt-2"
        >
          Choose Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={allowedTypes.join(',')}
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* File List */}
      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Uploading Files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {files.map((fileItem) => (
              <div key={fileItem.id} className="flex items-center space-x-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                <div className="flex-shrink-0">
                  {getFileIcon(fileItem.file)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {fileItem.file.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatFileSize(fileItem.file.size)}
                  </p>
                  {fileItem.status === 'uploading' && (
                    <Progress value={fileItem.progress} className="mt-1 h-1" />
                  )}
                  {fileItem.status === 'error' && fileItem.error && (
                    <p className="text-xs text-red-500 mt-1">{fileItem.error}</p>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  {fileItem.status === 'completed' && (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                  {fileItem.status === 'error' && (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  )}
                  <Badge
                    variant={fileItem.status === 'completed' ? 'default' :
                            fileItem.status === 'error' ? 'destructive' : 'secondary'}
                    className="text-xs"
                  >
                    {fileItem.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(fileItem.id)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
