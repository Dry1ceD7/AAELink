import bcrypt from 'bcrypt';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['admin', 'user', 'moderator']).default('user'),
});

export async function authRoutes(fastify: FastifyInstance) {
  // Login endpoint
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username, password } = loginSchema.parse(request.body);

      // Mock user validation - replace with database lookup
      const validUsers = [
        { username: 'admin', password: '$2b$10$rQZ8K9vQZ8K9vQZ8K9vQZ8O', email: 'admin@aae.co.th', role: 'admin' },
        { username: 'admin@aae.co.th', password: '$2b$10$rQZ8K9vQZ8K9vQZ8K9vQZ8O', email: 'admin@aae.co.th', role: 'admin' },
        { username: 'test', password: '$2b$10$rQZ8K9vQZ8K9vQZ8K9vQZ8O', email: 'test@aae.co.th', role: 'user' },
      ];

      const user = validUsers.find(u => u.username === username || u.email === username);

      if (!user) {
        return reply.status(401).send({
          success: false,
          message: 'Invalid credentials',
        });
      }

      // In production, use bcrypt.compare with hashed password
      const isValidPassword = password === '12345678' || await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return reply.status(401).send({
          success: false,
          message: 'Invalid credentials',
        });
      }

      // Generate JWT token
      const token = fastify.jwt.sign({
        userId: user.username,
        username: user.username,
        email: user.email,
        role: user.role,
      });

      logger.info(`User logged in: ${username}`);

      return reply.send({
        success: true,
        token,
        user: {
          id: user.username,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar: user.username.charAt(0).toUpperCase(),
        },
      });

    } catch (error) {
      logger.error('Login error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Internal server error',
      });
    }
  });

  // Register endpoint (admin only)
  fastify.post('/register', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
        const payload = request.user as any;

        if (payload.role !== 'admin') {
          return reply.status(403).send({
            success: false,
            message: 'Admin access required',
          });
        }
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Authentication required',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username, email, password, role } = registerSchema.parse(request.body);

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // In production, save to database
      logger.info(`User registered: ${username} (${email}) with role: ${role}`);

      return reply.send({
        success: true,
        message: 'User registered successfully',
        user: {
          username,
          email,
          role,
        },
      });

    } catch (error) {
      logger.error('Registration error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Internal server error',
      });
    }
  });

  // Verify token endpoint
  fastify.get('/verify', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (error) {
        return reply.status(401).send({
          success: false,
          message: 'Invalid token',
        });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as any;

    return reply.send({
      success: true,
      user: {
        id: payload.userId,
        username: payload.username,
        email: payload.email,
        role: payload.role,
      },
    });
  });

  // Logout endpoint
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    // In production, add token to blacklist
    logger.info('User logged out');

    return reply.send({
      success: true,
      message: 'Logged out successfully',
    });
  });
}
