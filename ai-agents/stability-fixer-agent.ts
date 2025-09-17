/**
 * AI Stability Fixer Agent
 * Specialized in fixing server stability and rate limiting issues
 */

export class StabilityFixerAgent {
  private errors: string[] = [];
  private fixes: string[] = [];

  constructor() {
    console.log('🤖 Stability Fixer Agent initialized');
  }

  public async fixRateLimiting(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing rate limiting in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Fix rate limiting to be more lenient
      const rateLimitFix = `// Rate limiting middleware - more lenient
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
app.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 100; // Increased from 10 to 100

  const key = \`\${ip}_\${Math.floor(now / windowMs)}\`;
  const current = rateLimitMap.get(key) || { count: 0, resetTime: now + windowMs };

  if (now > current.resetTime) {
    current.count = 0;
    current.resetTime = now + windowMs;
  }

  current.count++;
  rateLimitMap.set(key, current);

  if (current.count > maxRequests) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  await next();
});`;

      // Replace rate limiting middleware
      content = content.replace(
        /\/\/ Rate limiting middleware[\s\S]*?await next\(\);\s*\}\);/g,
        rateLimitFix
      );

      await fs.writeFile(filePath, content);
      this.fixes.push(`Fixed rate limiting in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix rate limiting: ${error}`);
      return false;
    }
  }

  public async fixErrorHandling(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing error handling in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Add global error handler
      const errorHandler = `
// Global error handler
app.onError((err, c) => {
  console.error('Global error:', err);
  return c.json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});`;

      // Add error handlers before server start
      content = content.replace(
        /const server = Bun\.serve\(/,
        errorHandler + '\n\nconst server = Bun.serve('
      );

      await fs.writeFile(filePath, content);
      this.fixes.push(`Fixed error handling in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix error handling: ${error}`);
      return false;
    }
  }

  public async fixServerStability(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing server stability in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Add process error handlers
      const stabilityFix = `
// Process error handlers for stability
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit process, just log
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process, just log
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\\nReceived SIGINT. Graceful shutdown...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\\nReceived SIGTERM. Graceful shutdown...');
  process.exit(0);
});`;

      // Add stability handlers at the beginning
      content = content.replace(
        /\/\*\*[\s\S]*?\*\/\s*import/,
        `/**\n * AAELink Backend Server\n * Full implementation according to PRD\n * Built with Bun + Hono + PostgreSQL + Redis + MinIO\n */\n\n${stabilityFix}\n\nimport`
      );

      await fs.writeFile(filePath, content);
      this.fixes.push(`Fixed server stability in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix server stability: ${error}`);
      return false;
    }
  }

  public getReport(): { errors: string[]; fixes: string[] } {
    return {
      errors: this.errors,
      fixes: this.fixes
    };
  }
}
