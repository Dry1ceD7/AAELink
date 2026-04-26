import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
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
