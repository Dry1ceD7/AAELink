# Multi-stage build for production
FROM oven/bun:1.0.0-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Production stage
FROM oven/bun:1.0.0-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S bun -u 1001

# Copy built application
COPY --from=builder --chown=bun:nodejs /app/dist ./dist
COPY --from=builder --chown=bun:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=bun:nodejs /app/package.json ./

# Create necessary directories
RUN mkdir -p /app/logs && chown bun:nodejs /app/logs

# Switch to non-root user
USER bun

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the application
CMD ["bun", "run", "dist/index.js"]