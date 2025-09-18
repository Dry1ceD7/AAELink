import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../index.js'
import { logger } from '../lib/logger.js'

const uploadFileSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  messageId: z.string().optional()
})

export default async function fileRoutes(fastify: FastifyInstance) {
  // Upload file
  fastify.post('/upload', {
    preHandler: [fastify.authenticate],
    schema: {
      body: uploadFileSchema
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.userId
      const fileData = request.body as z.infer<typeof uploadFileSchema>

      // Generate unique filename
      const timestamp = Date.now()
      const uniqueFilename = `${timestamp}-${fileData.filename}`

      // Upload to MinIO
      const { url, etag } = await fastify.minio.uploadFile(
        Buffer.from(''), // Empty buffer for now
        uniqueFilename,
        fileData.mimeType
      )

      // Save file record to database
      const file = await prisma.file.create({
        data: {
          filename: uniqueFilename,
          originalName: fileData.filename,
          mimeType: fileData.mimeType,
          size: fileData.size,
          url,
          bucket: 'aaelink-files',
          key: uniqueFilename,
          etag,
          uploadedBy: userId,
          messageId: fileData.messageId || null
        }
      })

      return { file }
    } catch (error) {
      logger.error('Upload file error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Get file
  fastify.get('/:fileId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { fileId } = request.params as { fileId: string }
      const userId = request.user.userId

      const file = await prisma.file.findUnique({
        where: { id: fileId }
      })

      if (!file) {
        return reply.code(404).send({ error: 'File not found' })
      }

      // Check permissions
      if (file.uploadedBy !== userId) {
        return reply.code(403).send({ error: 'Not authorized to access this file' })
      }

      return { file }
    } catch (error) {
      logger.error('Get file error:', error)
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // Delete file
  fastify.delete('/:fileId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { fileId } = request.params as { fileId: string }
      const userId = request.user.userId

      const file = await prisma.file.findUnique({
        where: { id: fileId }
      })

      if (!file) {
        return reply.code(404).send({ error: 'File not found' })
      }

      // Check permissions
      if (file.uploadedBy !== userId) {
        return reply.code(403).send({ error: 'Not authorized to delete this file' })
      }

      // Delete from MinIO
      await fastify.minio.deleteFile(file.filename)

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
}