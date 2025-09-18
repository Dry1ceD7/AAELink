import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';

// Input validation schemas
const fileUploadSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  fileSize: z.number().min(1, 'File size must be greater than 0').max(100 * 1024 * 1024, 'File size too large (max 100MB)'),
  fileType: z.string().min(1, 'File type is required'),
});

const fileDownloadSchema = z.object({
  fileId: z.string().min(1, 'File ID is required'),
});

export async function fileRoutes(fastify: FastifyInstance) {
  // Upload file
  fastify.post('/upload', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          success: false,
          message: 'No file uploaded',
        });
      }

      const buffer = await data.toBuffer();
      const fileName = data.filename;
      const contentType = data.mimetype;

      // Validate file data
      const validationResult = fileUploadSchema.safeParse({
        fileName,
        fileSize: buffer.length,
        fileType: contentType,
      });

      if (!validationResult.success) {
        return reply.status(400).send({
          success: false,
          message: 'File validation failed',
          errors: validationResult.error.errors,
        });
      }

      // In production, upload to MinIO
      const fileId = `file_${Date.now()}_${fileName}`;

      logger.info(`File uploaded: ${fileName} (${buffer.length} bytes)`);

      return reply.send({
        success: true,
        file: {
          id: fileId,
          name: fileName,
          size: buffer.length,
          type: contentType,
          url: `/api/files/${fileId}`,
        },
      });

    } catch (error) {
      logger.error('File upload error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Failed to upload file',
      });
    }
  });

  // Get file
  fastify.get('/:fileId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { fileId } = request.params as { fileId: string };

      // Validate file ID
      const validationResult = fileDownloadSchema.safeParse({ fileId });

      if (!validationResult.success) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid file ID',
          errors: validationResult.error.errors,
        });
      }

      // In production, get file from MinIO
      logger.info(`File requested: ${fileId}`);

      return reply.send({
        success: true,
        message: 'File endpoint - implementation pending',
        fileId,
      });

    } catch (error) {
      logger.error('Get file error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Failed to get file',
      });
    }
  });
}
