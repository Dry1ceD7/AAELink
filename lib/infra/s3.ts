import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'

let client: S3Client | null = null

export function getS3Client(): S3Client | null {
  const endpoint = process.env.S3_ENDPOINT?.trim()
  if (!endpoint) return null
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION?.trim() || 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY?.trim() || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY?.trim() || 'minioadmin'
      }
    })
  }
  return client
}

export function getBucket(): string {
  return process.env.S3_BUCKET?.trim() || 'aaelink-documents'
}

export async function ensureBucket(s3: S3Client, bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  }
}

export async function putObjectBytes(params: {
  s3: S3Client
  bucket: string
  key: string
  body: Buffer
  contentType: string
}) {
  await ensureBucket(params.s3, params.bucket)
  await params.s3.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType
    })
  )
}

export async function getObjectBytes(s3: S3Client, bucket: string, key: string): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const bytes = await out.Body?.transformToByteArray()
  if (!bytes) throw new Error('empty_object')
  return Buffer.from(bytes)
}

export async function deleteObject(s3: S3Client, bucket: string, key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

// ── Multipart upload primitives (Slack files.getUploadURLExternal parity) ──
//
// The two-phase / resumable upload session (lib/files/uploadSessions.ts) maps
// each session to one S3 multipart upload: CreateMultipartUpload at session
// create, UploadPart per chunk (recording the returned ETag), then either
// CompleteMultipartUpload (with the recorded ETags, ordered by part number) or
// AbortMultipartUpload on abort/expiry. All built on the existing
// @aws-sdk/client-s3 dependency — no new top-level dep.

/** A completed part for CompleteMultipartUpload — partNumber is 1-based. */
export interface UploadedPart {
  partNumber: number
  etag: string
}

/** Begin a multipart upload; returns the S3 UploadId to thread through parts. */
export async function createMultipartUpload(params: {
  s3: S3Client
  bucket: string
  key: string
  contentType: string
}): Promise<string> {
  await ensureBucket(params.s3, params.bucket)
  const out = await params.s3.send(
    new CreateMultipartUploadCommand({
      Bucket: params.bucket,
      Key: params.key,
      ContentType: params.contentType,
    })
  )
  if (!out.UploadId) throw new Error('s3_create_multipart_no_upload_id')
  return out.UploadId
}

/** Upload one part; returns its ETag (required at complete). */
export async function uploadPart(params: {
  s3: S3Client
  bucket: string
  key: string
  uploadId: string
  partNumber: number
  body: Buffer
}): Promise<string> {
  const out = await params.s3.send(
    new UploadPartCommand({
      Bucket: params.bucket,
      Key: params.key,
      UploadId: params.uploadId,
      PartNumber: params.partNumber,
      Body: params.body,
    })
  )
  if (!out.ETag) throw new Error('s3_upload_part_no_etag')
  return out.ETag
}

/** Finalize a multipart upload from the recorded parts (sorted by partNumber). */
export async function completeMultipartUpload(params: {
  s3: S3Client
  bucket: string
  key: string
  uploadId: string
  parts: UploadedPart[]
}): Promise<void> {
  const ordered = [...params.parts].sort((a, b) => a.partNumber - b.partNumber)
  await params.s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: params.bucket,
      Key: params.key,
      UploadId: params.uploadId,
      MultipartUpload: {
        Parts: ordered.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    })
  )
}

/** Abort a multipart upload, freeing the staged parts. Best-effort caller-side. */
export async function abortMultipartUpload(params: {
  s3: S3Client
  bucket: string
  key: string
  uploadId: string
}): Promise<void> {
  await params.s3.send(
    new AbortMultipartUploadCommand({
      Bucket: params.bucket,
      Key: params.key,
      UploadId: params.uploadId,
    })
  )
}

/**
 * HEAD a completed object; returns its byte size (ContentLength) or null when the
 * object is missing / the SDK does not report a length. Used as a post-complete
 * backstop on the S3 multipart path (mirrors the local fsp.stat size check).
 */
export async function headObjectSize(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<number | null> {
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return typeof out.ContentLength === 'number' ? out.ContentLength : null
  } catch {
    return null
  }
}
