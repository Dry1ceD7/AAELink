import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';

// Input validation schemas
const searchSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(500, 'Search query too long'),
  type: z.enum(['all', 'messages', 'files', 'users', 'channels']).default('all'),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

const advancedSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  filters: z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    author: z.string().optional(),
    channel: z.string().optional(),
    fileType: z.string().optional(),
  }).optional(),
  sortBy: z.enum(['relevance', 'date', 'author']).default('relevance'),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export async function searchRoutes(fastify: FastifyInstance) {
  // Basic search
  fastify.get('/search', {
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
      const queryParams = request.query as any;
      const { query, type, limit, offset } = searchSchema.parse(queryParams);

      // Mock search results - replace with Elasticsearch integration
      const searchResults = {
        messages: [
          {
            id: '1',
            content: `Found message containing "${query}"`,
            channelId: 'general',
            channelName: 'general',
            authorId: 'admin',
            authorName: 'Admin User',
            timestamp: new Date().toISOString(),
            relevanceScore: 0.95,
          },
          {
            id: '2',
            content: `Another message with "${query}" keyword`,
            channelId: 'development',
            channelName: 'development',
            authorId: 'user1',
            authorName: 'John Doe',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            relevanceScore: 0.87,
          },
        ],
        files: [
          {
            id: 'file_1',
            name: `document_${query}.pdf`,
            type: 'application/pdf',
            size: 1024000,
            channelId: 'general',
            authorId: 'admin',
            authorName: 'Admin User',
            timestamp: new Date().toISOString(),
            relevanceScore: 0.92,
          },
        ],
        users: [
          {
            id: 'user_1',
            name: 'John Doe',
            email: 'john@aae.co.th',
            status: 'online',
            relevanceScore: 0.78,
          },
        ],
        channels: [
          {
            id: 'channel_1',
            name: 'general',
            type: 'text',
            memberCount: 45,
            relevanceScore: 0.85,
          },
        ],
      };

      // Filter results based on type
      let results = [];
      if (type === 'all') {
        results = [
          ...searchResults.messages.map(item => ({ ...item, resultType: 'message' })),
          ...searchResults.files.map(item => ({ ...item, resultType: 'file' })),
          ...searchResults.users.map(item => ({ ...item, resultType: 'user' })),
          ...searchResults.channels.map(item => ({ ...item, resultType: 'channel' })),
        ];
      } else {
        results = searchResults[type as keyof typeof searchResults].map(item => ({
          ...item,
          resultType: type,
        }));
      }

      // Sort by relevance score
      results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

      // Apply pagination
      const paginatedResults = results.slice(offset, offset + limit);

      logger.info(`Search performed: "${query}" (type: ${type}, results: ${paginatedResults.length})`);

      return reply.send({
        success: true,
        query,
        type,
        results: paginatedResults,
        pagination: {
          total: results.length,
          limit,
          offset,
          hasMore: offset + limit < results.length,
        },
      });

    } catch (error) {
      logger.error('Search error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Search failed',
      });
    }
  });

  // Advanced search
  fastify.post('/search/advanced', {
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
      const { query, filters, sortBy, limit, offset } = advancedSearchSchema.parse(request.body);

      // Mock advanced search results - replace with Elasticsearch integration
      const searchResults = [
        {
          id: '1',
          content: `Advanced search result for "${query}"`,
          channelId: 'general',
          channelName: 'general',
          authorId: 'admin',
          authorName: 'Admin User',
          timestamp: new Date().toISOString(),
          relevanceScore: 0.95,
          resultType: 'message',
        },
      ];

      // Apply filters
      let filteredResults = searchResults;
      if (filters) {
        if (filters.dateFrom) {
          const dateFrom = new Date(filters.dateFrom);
          filteredResults = filteredResults.filter(item =>
            new Date(item.timestamp) >= dateFrom
          );
        }
        if (filters.dateTo) {
          const dateTo = new Date(filters.dateTo);
          filteredResults = filteredResults.filter(item =>
            new Date(item.timestamp) <= dateTo
          );
        }
        if (filters.author) {
          filteredResults = filteredResults.filter(item =>
            item.authorId === filters.author || item.authorName?.includes(filters.author)
          );
        }
        if (filters.channel) {
          filteredResults = filteredResults.filter(item =>
            item.channelId === filters.channel || item.channelName?.includes(filters.channel)
          );
        }
      }

      // Sort results
      if (sortBy === 'date') {
        filteredResults.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      } else if (sortBy === 'author') {
        filteredResults.sort((a, b) => (a.authorName || '').localeCompare(b.authorName || ''));
      } else {
        // relevance
        filteredResults.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      }

      // Apply pagination
      const paginatedResults = filteredResults.slice(offset, offset + limit);

      logger.info(`Advanced search performed: "${query}" (filters: ${JSON.stringify(filters)}, results: ${paginatedResults.length})`);

      return reply.send({
        success: true,
        query,
        filters,
        sortBy,
        results: paginatedResults,
        pagination: {
          total: filteredResults.length,
          limit,
          offset,
          hasMore: offset + limit < filteredResults.length,
        },
      });

    } catch (error) {
      logger.error('Advanced search error:', error);

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        message: 'Advanced search failed',
      });
    }
  });

  // Search suggestions
  fastify.get('/search/suggestions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { q } = request.query as { q?: string };

      if (!q || q.length < 2) {
        return reply.send({
          success: true,
          suggestions: [],
        });
      }

      // Mock suggestions - replace with real implementation
      const suggestions = [
        `@${q} user`,
        `#${q} channel`,
        `${q} file`,
        `${q} message`,
      ].filter(suggestion => suggestion.toLowerCase().includes(q.toLowerCase()));

      return reply.send({
        success: true,
        suggestions,
      });

    } catch (error) {
      logger.error('Search suggestions error:', error);
      return reply.status(500).send({
        success: false,
        message: 'Failed to get search suggestions',
      });
    }
  });
}
