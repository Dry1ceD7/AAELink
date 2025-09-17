import { Client as MinioClient } from 'minio'
import { env } from './env.js'
import { logger } from './logger.js'

export class MinioClient {
  private client: MinioClient

  constructor() {
    this.client = new MinioClient({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY
    })

    this.initializeBucket()
  }

  private async initializeBucket() {
    try {
      const exists = await this.client.bucketExists(env.MINIO_BUCKET)
      if (!exists) {
        await this.client.makeBucket(env.MINIO_BUCKET, 'us-east-1')
        logger.info(`Created bucket: ${env.MINIO_BUCKET}`)
      }
    } catch (error) {
      logger.error('Failed to initialize MinIO bucket:', error)
    }
  }

  async uploadFile(
    file: Buffer,
    filename: string,
    mimeType: string
  ): Promise<{ url: string; etag: string }> {
    try {
      const etag = await this.client.putObject(
        env.MINIO_BUCKET,
        filename,
        file,
        file.length,
        {
          'Content-Type': mimeType
        }
      )

      const url = await this.client.presignedGetObject(env.MINIO_BUCKET, filename, 24 * 60 * 60) // 24 hours

      return { url, etag }
    } catch (error) {
      logger.error('Failed to upload file:', error)
      throw new Error('File upload failed')
    }
  }

  async deleteFile(filename: string): Promise<void> {
    try {
      await this.client.removeObject(env.MINIO_BUCKET, filename)
    } catch (error) {
      logger.error('Failed to delete file:', error)
      throw new Error('File deletion failed')
    }
  }

  async getFileUrl(filename: string, expiresIn: number = 3600): Promise<string> {
    try {
      return await this.client.presignedGetObject(env.MINIO_BUCKET, filename, expiresIn)
    } catch (error) {
      logger.error('Failed to generate file URL:', error)
      throw new Error('Failed to generate file URL')
    }
  }

  async generateUploadUrl(
    filename: string,
    mimeType: string,
    expiresIn: number = 3600
  ): Promise<{ uploadUrl: string; downloadUrl: string }> {
    try {
      const uploadUrl = await this.client.presignedPutObject(
        env.MINIO_BUCKET,
        filename,
        expiresIn,
        {
          'Content-Type': mimeType
        }
      )

      const downloadUrl = await this.client.presignedGetObject(
        env.MINIO_BUCKET,
        filename,
        expiresIn
      )

      return { uploadUrl, downloadUrl }
    } catch (error) {
      logger.error('Failed to generate upload URL:', error)
      throw new Error('Failed to generate upload URL')
    }
  }
}
