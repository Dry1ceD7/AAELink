import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

// Create database instance
const sqlite = new Database(':memory:'); // Use in-memory for demo
export const db = drizzle(sqlite, { schema });

// Initialize database
export async function initializeDatabase() {
  try {
    console.log('Database initialized successfully');
    return db;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

export { schema };
