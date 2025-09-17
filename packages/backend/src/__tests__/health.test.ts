import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

describe('Health Check', () => {
  let server: any;

  beforeAll(async () => {
    // Start the server for testing
    const { default: app } = await import('../index');
    server = Bun.serve({
      fetch: app.fetch,
      port: 3003, // Use different port for testing
    });
  });

  afterAll(() => {
    server?.stop();
  });

  it('should return healthy status', async () => {
    const response = await fetch('http://localhost:3003/health');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
  });

  it('should return 404 for non-existent endpoint', async () => {
    const response = await fetch('http://localhost:3003/nonexistent');
    expect(response.status).toBe(404);
  });
});
