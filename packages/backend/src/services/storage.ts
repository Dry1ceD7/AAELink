/**
 * AAELink Storage Service
 * MinIO S3-compatible object storage
 * BMAD Method: Secure file management with presigned URLs
 */

import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import * as Minio from 'minio';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { files } from '../db/schema';

// MinIO client instance
let minioClient: Minio.Client;

// Bucket names
const BUCKETS = {
  uploads: 'aaelink-uploads',
  avatars: 'aaelink-avatars',
  attachments: 'aaelink-attachments',
  thumbnails: 'aaelink-thumbnails',
  exports: 'aaelink-exports',
  quarantine: 'aaelink-quarantine', // For virus scanning
};

// File type restrictions
const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  'text/plain',
  'text/csv',
  'text/markdown',
  // Archives
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  // Audio
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  // Video
  'video/mp4',
  'video/webm',
  'video/ogg',
];

// Dangerous file extensions to block
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
  '.app', '.deb', '.rpm', '.dmg', '.pkg', '.msi', '.dll', '.so'
];

// File size limits by type (in bytes)
const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,        // 10 MB
  document: 50 * 1024 * 1024,     // 50 MB
  video: 500 * 1024 * 1024,       // 500 MB
  default: 100 * 1024 * 1024,     // 100 MB
};

/**
 * Initialize MinIO connection and create buckets
 */
export async function initializeMinIO(): Promise<void> {
  try {
    // Create MinIO client
    minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });

    // Create buckets if they don't exist
    for (const [key, bucketName] of Object.entries(BUCKETS)) {
      const exists = await minioClient.bucketExists(bucketName);

      if (!exists) {
        await minioClient.makeBucket(bucketName, 'us-east-1');
        console.log(`Created bucket: ${bucketName}`);

        // Set bucket policies
        await setBucketPolicy(bucketName, key as keyof typeof BUCKETS);
      }
    }

    // Set up lifecycle rules for temporary files
    await setupLifecycleRules();

    console.log('MinIO initialized successfully');
  } catch (error) {
    console.error('Failed to initialize MinIO:', error);
    throw error;
  }
}

/**
 * Set bucket policy based on bucket type
 */
async function setBucketPolicy(bucketName: string, bucketType: keyof typeof BUCKETS) {
  let policy: any;

  switch (bucketType) {
    case 'avatars':
    case 'thumbnails':
      // Public read for avatars and thumbnails
      policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      };
      break;

    case 'quarantine':
      // No public access for quarantine
      policy = {
        Version: '2012-10-17',
        Statement: [],
      };
      break;

    default:
      // Private buckets - access only via presigned URLs
      return;
  }

  await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
}

/**
 * Set up lifecycle rules for automatic cleanup
 */
async function setupLifecycleRules() {
  // Clean up exports after 7 days
  const exportLifecycle = {
    Rule: [
      {
        ID: 'delete-old-exports',
        Status: 'Enabled',
        Expiration: {
          Days: 7,
        },
      },
    ],
  };

  // Clean up quarantine after 30 days
  const quarantineLifecycle = {
    Rule: [
      {
        ID: 'delete-quarantined-files',
        Status: 'Enabled',
        Expiration: {
          Days: 30,
        },
      },
    ],
  };

  try {
    await minioClient.setBucketLifecycle(BUCKETS.exports, exportLifecycle);
    await minioClient.setBucketLifecycle(BUCKETS.quarantine, quarantineLifecycle);
  } catch (error) {
    console.error('Failed to set lifecycle rules:', error);
  }
}

/**
 * Generate presigned URL for file upload
 */
export async function generateUploadUrl(params: {
  fileName: string;
  contentType: string;
  size: number;
  userId: string;
  channelId?: string;
}): Promise<{
  uploadUrl: string;
  objectName: string;
  fileId: string;
}> {
  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(params.contentType)) {
    throw new Error(`File type not allowed: ${params.contentType}`);
  }

  // Check file extension
  const extension = params.fileName.substring(params.fileName.lastIndexOf('.')).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(extension)) {
    throw new Error(`File extension not allowed: ${extension}`);
  }

  // Check file size
  const fileType = getFileType(params.contentType);
  const sizeLimit = SIZE_LIMITS[fileType] || SIZE_LIMITS.default;

  if (params.size > sizeLimit) {
    throw new Error(`File too large. Maximum size: ${sizeLimit / 1024 / 1024}MB`);
  }

  // Generate unique object name
  const timestamp = Date.now();
  const randomId = nanoid(12);
  const safeName = params.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const objectName = `${timestamp}-${randomId}-${safeName}`;

  // Determine bucket based on file type
  const bucket = params.channelId ? BUCKETS.attachments : BUCKETS.uploads;

  // Generate presigned PUT URL (expires in 1 hour)
  const uploadUrl = await minioClient.presignedPutObject(
    bucket,
    objectName,
    60 * 60 // 1 hour
  );

  // Create file record in database
  const fileId = nanoid();
  await db.insert(files).values({
    id: fileId,
    objectName,
    contentType: params.contentType,
    size: params.size,
    uploaderId: params.userId,
    channelId: params.channelId,
    metadata: {
      originalName: params.fileName,
      bucket,
    },
    createdAt: new Date(),
  });

  return {
    uploadUrl,
    objectName,
    fileId,
  };
}

/**
 * Generate presigned URL for file download
 */
export async function generateDownloadUrl(params: {
  fileId: string;
  userId: string;
}): Promise<{
  downloadUrl: string;
  fileName: string;
  contentType: string;
}> {
  // Get file record
  const [file] = await db.select()
    .from(files)
    .where(eq(files.id, params.fileId))
    .limit(1);

  if (!file) {
    throw new Error('File not found');
  }

  // Check if file is deleted
  if (file.deletedAt) {
    throw new Error('File has been deleted');
  }

  // TODO: Add access control checks based on channel membership

  const metadata = file.metadata as any;
  const bucket = metadata?.bucket || BUCKETS.uploads;

  // Generate presigned GET URL (expires in 6 hours)
  const downloadUrl = await minioClient.presignedGetObject(
    bucket,
    file.objectName,
    6 * 60 * 60 // 6 hours
  );

  return {
    downloadUrl,
    fileName: metadata?.originalName || file.objectName,
    contentType: file.contentType,
  };
}

/**
 * Upload file directly (for server-side uploads)
 */
export async function uploadFile(params: {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  userId: string;
  channelId?: string;
}): Promise<{
  fileId: string;
  objectName: string;
  url?: string;
}> {
  // Validate file
  const extension = params.fileName.substring(params.fileName.lastIndexOf('.')).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(extension)) {
    throw new Error(`File extension not allowed: ${extension}`);
  }

  // Check size
  const fileType = getFileType(params.contentType);
  const sizeLimit = SIZE_LIMITS[fileType] || SIZE_LIMITS.default;

  if (params.buffer.length > sizeLimit) {
    throw new Error(`File too large. Maximum size: ${sizeLimit / 1024 / 1024}MB`);
  }

  // Generate object name
  const timestamp = Date.now();
  const randomId = nanoid(12);
  const safeName = params.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const objectName = `${timestamp}-${randomId}-${safeName}`;

  // Determine bucket
  const bucket = params.channelId ? BUCKETS.attachments : BUCKETS.uploads;

  // Calculate checksum
  const checksum = crypto
    .createHash('sha256')
    .update(params.buffer)
    .digest('hex');

  // Upload to MinIO
  await minioClient.putObject(
    bucket,
    objectName,
    params.buffer,
    params.buffer.length,
    {
      'Content-Type': params.contentType,
      'x-amz-meta-uploader': params.userId,
      'x-amz-meta-checksum': checksum,
    }
  );

  // Create file record
  const fileId = nanoid();
  await db.insert(files).values({
    id: fileId,
    objectName,
    contentType: params.contentType,
    size: params.buffer.length,
    checksum,
    uploaderId: params.userId,
    channelId: params.channelId,
    metadata: {
      originalName: params.fileName,
      bucket,
    },
    createdAt: new Date(),
  });

  // For public buckets, return direct URL
  let url: string | undefined;
  if (bucket === BUCKETS.avatars || bucket === BUCKETS.thumbnails) {
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
    const port = process.env.MINIO_PORT || '9000';
    url = `${protocol}://${endpoint}:${port}/${bucket}/${objectName}`;
  }

  return {
    fileId,
    objectName,
    url,
  };
}

/**
 * Delete file
 */
export async function deleteFile(fileId: string, userId: string): Promise<void> {
  // Get file record
  const [file] = await db.select()
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);

  if (!file) {
    throw new Error('File not found');
  }

  // Check ownership or admin rights
  if (file.uploaderId !== userId) {
    // TODO: Check if user is admin
    throw new Error('Unauthorized to delete this file');
  }

  const metadata = file.metadata as any;
  const bucket = metadata?.bucket || BUCKETS.uploads;

  // Delete from MinIO
  await minioClient.removeObject(bucket, file.objectName);

  // Soft delete in database
  await db.update(files)
    .set({ deletedAt: new Date() })
    .where(eq(files.id, fileId));
}

/**
 * Move file to quarantine (for virus scanning)
 */
export async function quarantineFile(fileId: string, reason: string): Promise<void> {
  const [file] = await db.select()
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);

  if (!file) {
    throw new Error('File not found');
  }

  const metadata = file.metadata as any;
  const sourceBucket = metadata?.bucket || BUCKETS.uploads;

  // Copy to quarantine bucket
  await minioClient.copyObject(
    BUCKETS.quarantine,
    file.objectName,
    `/${sourceBucket}/${file.objectName}`
  );

  // Delete from original bucket
  await minioClient.removeObject(sourceBucket, file.objectName);

  // Update database
  await db.update(files)
    .set({
      virusScanStatus: 'quarantined',
      metadata: {
        ...metadata,
        originalBucket: sourceBucket,
        quarantineReason: reason,
        quarantinedAt: new Date().toISOString(),
      },
    })
    .where(eq(files.id, fileId));
}

/**
 * Get file statistics for a user or channel
 */
export async function getStorageStats(params: {
  userId?: string;
  channelId?: string;
}): Promise<{
  totalFiles: number;
  totalSize: number;
  fileTypes: Record<string, number>;
}> {
  const conditions = [];

  if (params.userId) {
    conditions.push(eq(files.uploaderId, params.userId));
  }

  if (params.channelId) {
    conditions.push(eq(files.channelId, params.channelId));
  }

  const result = await db.select()
    .from(files)
    .where(conditions.length > 0 ? conditions[0] : undefined);

  const stats = {
    totalFiles: result.length,
    totalSize: result.reduce((sum, file) => sum + file.size, 0),
    fileTypes: {} as Record<string, number>,
  };

  // Count by file type
  result.forEach((file) => {
    const type = getFileType(file.contentType);
    stats.fileTypes[type] = (stats.fileTypes[type] || 0) + 1;
  });

  return stats;
}

/**
 * Helper function to determine file type category
 */
function getFileType(contentType: string): 'image' | 'document' | 'video' | 'audio' | 'other' {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  if (
    contentType.includes('pdf') ||
    contentType.includes('document') ||
    contentType.includes('sheet') ||
    contentType.includes('presentation') ||
    contentType.includes('text')
  ) {
    return 'document';
  }
  return 'other';
}

/**
 * Generate thumbnail for image
 */
export async function generateThumbnail(fileId: string): Promise<string> {
  // This would integrate with an image processing service
  // For now, return a placeholder
  return `/api/files/${fileId}/thumbnail`;
}

export { minioClient };
