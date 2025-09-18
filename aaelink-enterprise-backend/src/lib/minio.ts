import { Client as MinioClient } from 'minio';
import { logger } from './logger';

export class MinioClient {
  private client: MinioClient;
  private bucketName: string;

  constructor(config: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
  }) {
    this.client = new MinioClient({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.bucketName = process.env.MINIO_BUCKET || 'aaelink-files';
  }

  async initialize() {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        await this.client.makeBucket(this.bucketName, 'us-east-1');
        logger.info(`Created MinIO bucket: ${this.bucketName}`);
      }
      logger.info(`MinIO connected to bucket: ${this.bucketName}`);
    } catch (error) {
      logger.error('Failed to initialize MinIO:', error);
      throw error;
    }
  }

  async healthCheck() {
    try {
      await this.client.bucketExists(this.bucketName);
      return true;
    } catch (error) {
      logger.error('MinIO health check failed:', error);
      return false;
    }
  }

  async uploadFile(fileName: string, fileBuffer: Buffer, contentType: string) {
    try {
      const objectName = `uploads/${Date.now()}-${fileName}`;
      await this.client.putObject(this.bucketName, objectName, fileBuffer, {
        'Content-Type': contentType,
      });
      return objectName;
    } catch (error) {
      logger.error('Failed to upload file:', error);
      throw error;
    }
  }

  async getFileUrl(objectName: string, expiry: number = 3600) {
    try {
      return await this.client.presignedGetObject(this.bucketName, objectName, expiry);
    } catch (error) {
      logger.error('Failed to get file URL:', error);
      throw error;
    }
  }

  async deleteFile(objectName: string) {
    try {
      await this.client.removeObject(this.bucketName, objectName);
    } catch (error) {
      logger.error('Failed to delete file:', error);
      throw error;
    }
  }

  async disconnect() {
    // MinIO client doesn't have a disconnect method
    logger.info('MinIO client disconnected');
  }
}
