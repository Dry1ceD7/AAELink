/**
 * File Storage Service
 * Handles file uploads, downloads, and management using MinIO (S3-compatible)
 */

import * as Minio from 'minio';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

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
  private minioClient: Minio.Client;
  private bucket: string;
  private isInitialized = false;

  constructor(config: FileStorageConfig) {
    this.bucket = config.bucket;

    this.minioClient = new Minio.Client({
      endPoint: config.endpoint.replace('http://', '').replace('https://', ''),
      port: config.endpoint.includes('https://') ? 443 : 9000,
      useSSL: config.endpoint.includes('https://'),
      accessKey: config.accessKey,
      secretKey: config.secretKey
    });
  }

  public async initialize(): Promise<void> {
    try {
      // Check if bucket exists, create if not
      const bucketExists = await this.minioClient.bucketExists(this.bucket);
      if (!bucketExists) {
        await this.minioClient.makeBucket(this.bucket, 'us-east-1');
      }
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize MinIO:', error);
      throw error;
    }
  }

  public async uploadFile(
    file: Buffer,
    originalName: string,
    mimeType: string,
    userId: string
  ): Promise<FileUploadResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const id = nanoid();
    const hash = crypto.createHash('sha256').update(file).digest('hex');
    const path = `files/${userId}/${id}/${originalName}`;

    try {
      await this.minioClient.putObject(this.bucket, path, file, file.length, {
        'Content-Type': mimeType,
        'x-amz-meta-user-id': userId,
        'x-amz-meta-original-name': originalName,
        'x-amz-meta-hash': hash
      });

      const url = await this.getPresignedUrl(path);

      return {
        id,
        name: originalName,
        originalName,
        mimeType,
        size: file.length,
        path,
        url,
        hash,
        userId,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('File upload error:', error);
      throw new Error('Failed to upload file');
    }
  }

  public async getPresignedUrl(path: string, expiresIn: number = 3600): Promise<string> {
    try {
      return await this.minioClient.presignedGetObject(this.bucket, path, expiresIn);
    } catch (error) {
      console.error('Presigned URL error:', error);
      throw new Error('Failed to generate presigned URL');
    }
  }

  public async deleteFile(path: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucket, path);
    } catch (error) {
      console.error('File deletion error:', error);
      throw new Error('Failed to delete file');
    }
  }

  public async listFiles(userId?: string, limit: number = 100): Promise<FileUploadResult[]> {
    try {
      const objects = await this.minioClient.listObjectsV2(this.bucket, `files/${userId || ''}`, true);
      const files: FileUploadResult[] = [];
      let count = 0;

      for await (const obj of objects) {
        if (count >= limit) break;
        
        if (obj.name && obj.lastModified) {
          const url = await this.getPresignedUrl(obj.name);
          files.push({
            id: obj.name.split('/')[2] || nanoid(),
            name: obj.name.split('/').pop() || 'unknown',
            originalName: obj.name.split('/').pop() || 'unknown',
            mimeType: 'application/octet-stream',
            size: obj.size || 0,
            path: obj.name,
            url,
            hash: '',
            userId: obj.name.split('/')[1] || 'unknown',
            createdAt: obj.lastModified.toISOString()
          });
          count++;
        }
      }

      return files;
    } catch (error) {
      console.error('List files error:', error);
      throw new Error('Failed to list files');
    }
  }
}

class MockFileStorageService {
  private files = new Map<string, FileUploadResult>();

  public async initialize(): Promise<void> {
    // Mock initialization
  }

  public async uploadFile(
    file: Buffer,
    originalName: string,
    mimeType: string,
    userId: string
  ): Promise<FileUploadResult> {
    const id = nanoid();
    const hash = crypto.createHash('sha256').update(file).digest('hex');
    const path = `files/${userId}/${id}/${originalName}`;

    const result: FileUploadResult = {
      id,
      name: originalName,
      originalName,
      mimeType,
      size: file.length,
      path,
      url: `http://localhost:3002/api/files/${id}`,
      hash,
      userId,
      createdAt: new Date().toISOString()
    };

    this.files.set(id, result);
    return result;
  }

  public async getPresignedUrl(path: string, expiresIn: number = 3600): Promise<string> {
    const id = path.split('/')[2];
    const file = this.files.get(id);
    return file?.url || `http://localhost:3002/api/files/${id}`;
  }

  public async deleteFile(path: string): Promise<void> {
    const id = path.split('/')[2];
    this.files.delete(id);
  }

  public async listFiles(userId?: string, limit: number = 100): Promise<FileUploadResult[]> {
    const files = Array.from(this.files.values());
    return userId 
      ? files.filter(f => f.userId === userId).slice(0, limit)
      : files.slice(0, limit);
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