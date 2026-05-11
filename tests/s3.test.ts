/**
 * AAELink — S3 Configuration Tests
 */
import { describe, it, expect } from 'vitest'
import { getBucket, getS3Client } from '@/lib/s3'

describe('S3 — getBucket', () => {
  it('returns default bucket when env not set', () => {
    const orig = process.env.S3_BUCKET
    delete process.env.S3_BUCKET
    expect(getBucket()).toBe('aaelink-documents')
    process.env.S3_BUCKET = orig
  })

  it('returns custom bucket from env', () => {
    const orig = process.env.S3_BUCKET
    process.env.S3_BUCKET = 'custom-bucket'
    expect(getBucket()).toBe('custom-bucket')
    process.env.S3_BUCKET = orig
  })
})

describe('S3 — getS3Client', () => {
  it('returns null when S3_ENDPOINT not set', () => {
    const orig = process.env.S3_ENDPOINT
    delete process.env.S3_ENDPOINT
    const c = getS3Client()
    expect(c).toBeNull()
    process.env.S3_ENDPOINT = orig
  })
})
