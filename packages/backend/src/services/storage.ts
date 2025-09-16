/**
 * File Storage Service
 * Handles file uploads, downloads, and management using MinIO (S3-compatible)
 */

import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

interface FileUploadResult {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string;
  hash: string;
  userId: string;
  createdAt: string;
}

interface FileStorageConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
}

class FileStorageService {
  private s3Client: S3Client;
  private bucket: string;
  private isInitialized = false;

  constructor(config: FileStorageConfig) {
    this.bucket = config.bucket;

    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  public async initialize(): Promise<void> {
    try {
      // Test connection by listing objects
      await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1
      }));

      this.isInitialized = true;
      console.log('File storage service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize file storage service:', error);
      throw error;
    }
  }

  public async uploadFile(
    file: Buffer | Uint8Array | string,
    fileName: string,
    mimeType: string,
    userId: string,
    metadata?: Record<string, string>
  ): Promise<FileUploadResult> {
    if (!this.isInitialized) {
      throw new Error('File storage service not initialized');
    }

    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const filePath = `uploads/${userId}/${fileId}`;
    const fileHash = await this.generateHash(file);

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
        Body: file,
        ContentType: mimeType,
        Metadata: {
          userId,
          originalName: fileName,
          fileId,
          hash: fileHash,
          ...metadata
        }
      });

      await this.s3Client.send(command);

      // Generate presigned URL for immediate access
      const url = await this.getFileUrl(filePath);

      return {
        id: fileId,
        name: fileName,
        originalName: fileName,
        mimeType,
        size: Buffer.isBuffer(file) ? file.length : new TextEncoder().encode(file).length,
        path: filePath,
        url,
        hash: fileHash,
        userId,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Failed to upload file:', error);
      throw error;
    }
  }

  public async getFileUrl(filePath: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: filePath
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      console.error('Failed to generate file URL:', error);
      throw error;
    }
  }

  public async deleteFile(filePath: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: filePath
      });

      await this.s3Client.send(command);
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw error;
    }
  }

  public async listUserFiles(userId: string, limit: number = 100): Promise<FileUploadResult[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `uploads/${userId}/`,
        MaxKeys: limit
      });

      const response = await this.s3Client.send(command);

      if (!response.Contents) {
        return [];
      }

      const files: FileUploadResult[] = [];

      for (const object of response.Contents) {
        if (object.Key) {
          const url = await this.getFileUrl(object.Key);

          files.push({
            id: object.Key.split('/').pop() || '',
            name: object.Key.split('/').pop() || '',
            originalName: object.Metadata?.originalName || '',
            mimeType: object.Metadata?.mimetype || 'application/octet-stream',
            size: object.Size || 0,
            path: object.Key,
            url,
            hash: object.Metadata?.hash || '',
            userId,
            createdAt: object.LastModified?.toISOString() || new Date().toISOString()
          });
        }
      }

      return files;
    } catch (error) {
      console.error('Failed to list user files:', error);
      throw error;
    }
  }

  private async generateHash(data: Buffer | Uint8Array | string): Promise<string> {
    const crypto = await import('crypto');
    const buffer = Buffer.isBuffer(data) ? data : new TextEncoder().encode(data);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  public isReady(): boolean {
    return this.isInitialized;
  }
}

// Mock implementation for development
class MockFileStorageService {
  private files = new Map<string, FileUploadResult>();

  public async initialize(): Promise<void> {
    console.log('Mock file storage service initialized');
  }

  public async uploadFile(
    file: Buffer | Uint8Array | string,
    fileName: string,
    mimeType: string,
    userId: string,
    metadata?: Record<string, string>
  ): Promise<FileUploadResult> {
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const filePath = `uploads/${userId}/${fileId}`;

    const result: FileUploadResult = {
      id: fileId,
      name: fileName,
      originalName: fileName,
      mimeType,
      size: Buffer.isBuffer(file) ? file.length : new TextEncoder().encode(file).length,
      path: filePath,
      url: `http://localhost:3001/api/files/${fileId}`,
      hash: `hash_${fileId}`,
      userId,
      createdAt: new Date().toISOString()
    };

    this.files.set(fileId, result);
    return result;
  }

  public async getFileUrl(filePath: string): Promise<string> {
    const fileId = filePath.split('/').pop();
    const file = this.files.get(fileId || '');
    return file?.url || '';
  }

  public async deleteFile(filePath: string): Promise<void> {
    const fileId = filePath.split('/').pop();
    this.files.delete(fileId || '');
  }

  public async listUserFiles(userId: string): Promise<FileUploadResult[]> {
    return Array.from(this.files.values()).filter(file => file.userId === userId);
  }

  public isReady(): boolean {
    return true;
  }
}

// Export appropriate implementation based on environment
const isProduction = process.env.NODE_ENV === 'production';
const storageConfig = {
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  bucket: process.env.MINIO_BUCKET || 'aaelink-files',
  region: process.env.MINIO_REGION || 'us-east-1'
};

export const fileStorage = isProduction
  ? new FileStorageService(storageConfig)
  : new MockFileStorageService();

export { FileStorageService, MockFileStorageService };
export type { FileStorageConfig, FileUploadResult };
