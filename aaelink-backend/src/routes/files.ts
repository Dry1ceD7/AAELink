import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { minio, prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const getUploadUrlSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().min(1)
})

const deleteFileSchema = z.object({
  fileId: z.string()
})

export default async function fileRoutes(fastify: FastifyInstance) {
  // Get upload URL for direct client upload
  fastify.post('/upload-url', {
    preHandler: [fastify.authenticate],
    schema: {
      body: getUploadUrlSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { filename, mimeType, size } = request.body as z.infer<typeof getUploadUrlSchema>

      // Generate unique filename
      const timestamp = Date.now()
      const uniqueFilename = `${userId}/${timestamp}-${filename}`

      // Generate presigned upload URL
      const { uploadUrl, downloadUrl } = await minio.generateUploadUrl(
        uniqueFilename,
        mimeType,
        3600 // 1 hour
      )

      // Create file record in database
      const file = await prisma.file.create({
        data: {
          filename: uniqueFilename,
          originalName: filename,
          mimeType,
          size,
          url: downloadUrl,
          bucket: 'aaelink-files',
          key: uniqueFilename,
          uploadedBy: userId,
          virusScanStatus: 'PENDING'
        }
      })

      return {
        fileId: file.id,
        uploadUrl,
        downloadUrl,
        expiresIn: 3600
      }
    } catch (error) {
      logger.error('Get upload URL error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Confirm file upload completion
  fastify.post('/confirm-upload', {
    preHandler: [fastify.authenticate],
    schema: {
      body: z.object({
        fileId: z.string(),
        etag: z.string().optional()
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { fileId, etag } = request.body as { fileId: string; etag?: string }

      // Update file record
      const file = await prisma.file.update({
        where: {
          id: fileId,
          uploadedBy: userId
        },
        data: {
          etag,
          virusScanStatus: 'SCANNING'
        }
      })

      // TODO: Trigger virus scan
      // For now, mark as clean
      await prisma.file.update({
        where: { id: fileId },
        data: { virusScanStatus: 'CLEAN' }
      })

      return { success: true, file }
    } catch (error) {
      logger.error('Confirm upload error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get file info
  fastify.get('/:fileId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { fileId } = request.params as { fileId: string }
      const userId = request.user.userId

      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          OR: [
            { uploadedBy: userId },
            { message: { senderId: userId } },
            { message: { receiverId: userId } },
            { message: { group: { members: { some: { userId } } } } }
          ]
        },
        include: {
          uploader: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          }
        }
      })

      if (!file) {
        return reply.code(404).send({ error: 'File not found' })
      }

      // Generate fresh download URL
      const downloadUrl = await minio.getFileUrl(file.filename, 3600)

      return {
        ...file,
        url: downloadUrl
      }
    } catch (error) {
      logger.error('Get file error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Delete file
  fastify.delete('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: deleteFileSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { fileId } = request.body as z.infer<typeof deleteFileSchema>

      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          uploadedBy: userId
        }
      })

      if (!file) {
        return reply.code(404).send({ error: 'File not found' })
      }

      // Delete from MinIO
      await minio.deleteFile(file.filename)

      // Delete from database
      await prisma.file.delete({
        where: { id: fileId }
      })

      return { success: true }
    } catch (error) {
      logger.error('Delete file error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get user's files
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: z.object({
        limit: z.coerce.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        type: z.string().optional()
      })
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const { limit, cursor, type } = request.query as {
        limit: number
        cursor?: string
        type?: string
      }

      const where: any = {
        OR: [
          { uploadedBy: userId },
          { message: { senderId: userId } },
          { message: { receiverId: userId } },
          { message: { group: { members: { some: { userId } } } } }
        ]
      }

      if (type) {
        where.mimeType = { startsWith: type }
      }

      if (cursor) {
        where.id = { lt: cursor }
      }

      const files = await prisma.file.findMany({
        where,
        include: {
          uploader: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          },
          message: {
            select: {
              id: true,
              content: true,
              group: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      })

      return { files }
    } catch (error) {
      logger.error('Get files error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Generate thumbnail for image/video
  fastify.post('/:fileId/thumbnail', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { fileId } = request.params as { fileId: string }
      const userId = request.user.userId

      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          OR: [
            { uploadedBy: userId },
            { message: { senderId: userId } },
            { message: { receiverId: userId } },
            { message: { group: { members: { some: { userId } } } } }
          ]
        }
      })

      if (!file) {
        return reply.code(404).send({ error: 'File not found' })
      }

      // Check if file is image or video
      if (!file.mimeType.startsWith('image/') && !file.mimeType.startsWith('video/')) {
        return reply.code(400).send({ error: 'File type does not support thumbnails' })
      }

      // TODO: Generate thumbnail using sharp or ffmpeg
      // For now, return the original URL
      const thumbnailUrl = await minio.getFileUrl(file.filename, 3600)

      // Update file record with thumbnail URL
      await prisma.file.update({
        where: { id: fileId },
        data: { thumbnailUrl }
      })

      return { thumbnailUrl }
    } catch (error) {
      logger.error('Generate thumbnail error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get file download URL
  fastify.get('/:fileId/download', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { fileId } = request.params as { fileId: string }
      const userId = request.user.userId

      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          OR: [
            { uploadedBy: userId },
            { message: { senderId: userId } },
            { message: { receiverId: userId } },
            { message: { group: { members: { some: { userId } } } } }
          ]
        }
      })

      if (!file) {
        return reply.code(404).send({ error: 'File not found' })
      }

      // Generate download URL
      const downloadUrl = await minio.getFileUrl(file.filename, 3600)

      return { downloadUrl }
    } catch (error) {
      logger.error('Get download URL error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })
}
