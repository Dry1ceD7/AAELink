import { PrismaClient } from '@prisma/client'
import { Redis } from 'ioredis'
import { Server as SocketIOServer } from 'socket.io'
import { MinioClient } from '../lib/minio.js'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
    redis: Redis
    minio: MinioClient
    io: SocketIOServer
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      userId: string
      email: string
      role: string
    }
    user: {
      userId: string
      email: string
      role: string
    }
  }
}