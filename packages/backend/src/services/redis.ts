/**
 * Redis Service
 * Centralized Redis connection and utilities
 */

import Redis from 'ioredis';
import { Cluster } from 'ioredis';

// Redis connection instance
export let redis: Redis | Cluster;

// Redis configuration
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  connectTimeout: 10000,
  commandTimeout: 5000,
  lazyConnect: true,
};

// Cluster configuration (for production)
const CLUSTER_NODES = process.env.REDIS_CLUSTER_NODES?.split(',') || [];

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<void> {
  try {
    if (CLUSTER_NODES.length > 0) {
      // Use Redis Cluster
      console.log('🔄 Connecting to Redis Cluster...');
      redis = new Cluster(
        CLUSTER_NODES.map(node => {
          const [host, port] = node.split(':');
          return { host, port: parseInt(port) };
        }),
        {
          redisOptions: {
            password: process.env.REDIS_PASSWORD,
            maxRetriesPerRequest: 3,
            connectTimeout: 10000,
          },
          clusterRetryDelayOnFailover: 100,
          maxRedirections: 16,
        }
      );
    } else {
      // Use single Redis instance
      console.log('🔄 Connecting to Redis...');
      redis = new Redis(REDIS_CONFIG);
    }

    // Connection event handlers
    redis.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redis.on('ready', () => {
      console.log('✅ Redis ready');
    });

    redis.on('error', (error) => {
      console.error('❌ Redis error:', error);
    });

    redis.on('close', () => {
      console.log('⚠️ Redis connection closed');
    });

    redis.on('reconnecting', (delay) => {
      console.log(`🔄 Redis reconnecting in ${delay}ms...`);
    });

    // Test connection
    await redis.ping();
    console.log('✅ Redis connection established');

  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    throw error;
  }
}

/**
 * Redis utility functions
 */
export const redisUtils = {
  /**
   * Set with expiration (TTL)
   */
  async setex(key: string, seconds: number, value: string): Promise<void> {
    await redis.setex(key, seconds, value);
  },

  /**
   * Get and delete (atomic operation)
   */
  async getdel(key: string): Promise<string | null> {
    const pipeline = redis.pipeline();
    pipeline.get(key);
    pipeline.del(key);
    const results = await pipeline.exec();
    return results?.[0]?.[1] as string | null;
  },

  /**
   * Set if not exists with TTL
   */
  async setnx(key: string, value: string, ttl?: number): Promise<boolean> {
    if (ttl) {
      const result = await redis.set(key, value, 'EX', ttl, 'NX');
      return result === 'OK';
    } else {
      const result = await redis.setnx(key, value);
      return result === 1;
    }
  },

  /**
   * Increment with expiration
   */
  async incrWithExpire(key: string, ttl: number): Promise<number> {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttl);
    const results = await pipeline.exec();
    return results?.[0]?.[1] as number;
  },

  /**
   * Distributed lock with auto-expiry
   */
  async acquireLock(key: string, ttl: number, value?: string): Promise<string | null> {
    const lockValue = value || `${Date.now()}-${Math.random()}`;
    const result = await redis.set(`lock:${key}`, lockValue, 'EX', ttl, 'NX');
    return result === 'OK' ? lockValue : null;
  },

  /**
   * Release distributed lock
   */
  async releaseLock(key: string, value: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await redis.eval(script, 1, `lock:${key}`, value);
    return result === 1;
  },

  /**
   * Add to set with expiration on the set
   */
  async saddWithExpire(key: string, member: string, ttl: number): Promise<void> {
    const pipeline = redis.pipeline();
    pipeline.sadd(key, member);
    pipeline.expire(key, ttl);
    await pipeline.exec();
  },

  /**
   * Publish message to channel
   */
  async publish(channel: string, message: string): Promise<number> {
    return redis.publish(channel, message);
  },

  /**
   * Subscribe to channels
   */
  async subscribe(channels: string[], callback: (channel: string, message: string) => void): Promise<void> {
    const subscriber = redis.duplicate();
    subscriber.on('message', callback);
    await subscriber.subscribe(...channels);
  },

  /**
   * Rate limiting with sliding window
   */
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.expire(key, Math.ceil(windowMs / 1000));
    
    const results = await pipeline.exec();
    const currentCount = (results?.[1]?.[1] as number) || 0;
    
    const allowed = currentCount < limit;
    const remaining = Math.max(0, limit - currentCount - 1);
    const resetTime = now + windowMs;
    
    return { allowed, remaining, resetTime };
  },

  /**
   * Cache with automatic serialization
   */
  async cacheSet(key: string, data: any, ttl: number): Promise<void> {
    const serialized = JSON.stringify(data);
    await redis.setex(key, ttl, serialized);
  },

  /**
   * Cache get with automatic deserialization
   */
  async cacheGet<T>(key: string): Promise<T | null> {
    const cached = await redis.get(key);
    if (!cached) return null;
    
    try {
      return JSON.parse(cached) as T;
    } catch (error) {
      console.error('Failed to parse cached data:', error);
      return null;
    }
  },

  /**
   * Cache delete
   */
  async cacheDel(key: string): Promise<void> {
    await redis.del(key);
  },

  /**
   * Session storage
   */
  session: {
    async set(sessionId: string, data: any, ttl: number): Promise<void> {
      await redisUtils.cacheSet(`session:${sessionId}`, data, ttl);
    },

    async get<T>(sessionId: string): Promise<T | null> {
      return redisUtils.cacheGet<T>(`session:${sessionId}`);
    },

    async delete(sessionId: string): Promise<void> {
      await redisUtils.cacheDel(`session:${sessionId}`);
    },

    async refresh(sessionId: string, ttl: number): Promise<void> {
      await redis.expire(`session:${sessionId}`, ttl);
    },
  },

  /**
   * Queue operations
   */
  queue: {
    async push(queueName: string, item: any): Promise<void> {
      const serialized = JSON.stringify(item);
      await redis.lpush(`queue:${queueName}`, serialized);
    },

    async pop<T>(queueName: string, timeout = 0): Promise<T | null> {
      const result = timeout > 0
        ? await redis.brpop(`queue:${queueName}`, timeout)
        : await redis.rpop(`queue:${queueName}`);
      
      if (!result) return null;
      
      const data = Array.isArray(result) ? result[1] : result;
      try {
        return JSON.parse(data) as T;
      } catch (error) {
        console.error('Failed to parse queue item:', error);
        return null;
      }
    },

    async length(queueName: string): Promise<number> {
      return redis.llen(`queue:${queueName}`);
    },

    async clear(queueName: string): Promise<void> {
      await redis.del(`queue:${queueName}`);
    },
  },

  /**
   * Health check
   */
  async health(): Promise<{ status: 'healthy' | 'unhealthy'; latency: number; memory: any }> {
    try {
      const start = Date.now();
      await redis.ping();
      const latency = Date.now() - start;
      
      const info = await redis.info('memory');
      const memoryInfo = info.split('\r\n').reduce((acc, line) => {
        const [key, value] = line.split(':');
        if (key && value) acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
      
      return {
        status: 'healthy',
        latency,
        memory: {
          used: memoryInfo.used_memory_human,
          peak: memoryInfo.used_memory_peak_human,
          rss: memoryInfo.used_memory_rss_human,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: -1,
        memory: null,
      };
    }
  },
};

/**
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
    console.log('✅ Redis connection closed gracefully');
  } catch (error) {
    console.error('❌ Error closing Redis connection:', error);
  }
}

// Export redis instance for direct use
export { redis as default };

// Auto-initialize if this module is imported
if (!redis) {
  initializeRedis().catch(console.error);
}
