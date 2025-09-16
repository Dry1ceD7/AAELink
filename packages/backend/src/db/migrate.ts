/**
 * Database Migration Runner
 * Run Drizzle migrations and seed data
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { nanoid } from 'nanoid';
import postgres from 'postgres';
import { hashPassword } from '../utils/crypto';
import { db } from './index';
import * as schema from './schema';
import { channelMembers, channels, organizations, users } from './schema';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://aaelink:aaelink_dev@localhost:5432/aaelink_db';

/**
 * Run database migrations
 */
export async function runMigrations() {
  console.log('🔄 Running database migrations...');

  try {
    const migrationClient = postgres(DATABASE_URL, { max: 1 });
    const migrationDb = drizzle(migrationClient, { schema });

    await migrate(migrationDb, {
      migrationsFolder: './drizzle',
      migrationsTable: 'drizzle_migrations',
    });

    await migrationClient.end();
    console.log('✅ Database migrations completed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Seed database with initial data
 */
export async function seedDatabase() {
  console.log('🌱 Seeding database...');

  try {
    // Check if already seeded
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log('📦 Database already seeded, skipping...');
      return;
    }

    // Create system organization
    const [systemOrg] = await db.insert(organizations).values({
      id: nanoid(),
      name: 'AAELink System',
      domain: 'system.aaelink.com',
      plan: 'enterprise',
      settings: {
        features: {
          maxUsers: -1, // unlimited
          maxStorage: -1, // unlimited
          advancedSecurity: true,
          customBranding: true,
        },
      },
    }).returning();

    console.log('✅ Created system organization');

    // Create admin user
    const adminPassword = await hashPassword('admin123!');
    const [adminUser] = await db.insert(users).values({
      id: nanoid(),
      email: 'admin@aaelink.com',
      displayName: 'System Administrator',
      role: 'sysadmin',
      organizationId: systemOrg.id,
      isEmailVerified: true,
      settings: {
        notifications: {
          email: true,
          desktop: true,
          mobile: true,
        },
        theme: 'system',
        language: 'en',
      },
    }).returning();

    console.log('✅ Created admin user');

    // Create default channels
    const defaultChannels = [
      {
        id: nanoid(),
        name: 'general',
        type: 'channel' as const,
        description: 'General discussion for the organization',
        organizationId: systemOrg.id,
        isPublic: true,
        settings: {
          allowThreads: true,
          allowReactions: true,
          allowFileUploads: true,
        },
      },
      {
        id: nanoid(),
        name: 'announcements',
        type: 'channel' as const,
        description: 'Important announcements and updates',
        organizationId: systemOrg.id,
        isPublic: true,
        settings: {
          allowThreads: false,
          allowReactions: true,
          allowFileUploads: false,
        },
      },
      {
        id: nanoid(),
        name: 'random',
        type: 'channel' as const,
        description: 'Random discussions and off-topic conversations',
        organizationId: systemOrg.id,
        isPublic: true,
        settings: {
          allowThreads: true,
          allowReactions: true,
          allowFileUploads: true,
        },
      },
    ];

    const createdChannels = await db.insert(channels).values(defaultChannels).returning();
    console.log('✅ Created default channels');

    // Add admin to all channels
    const channelMemberships = createdChannels.map(channel => ({
      id: nanoid(),
      channelId: channel.id,
      userId: adminUser.id,
      role: 'admin' as const,
      joinedAt: new Date(),
    }));

    await db.insert(channelMembers).values(channelMemberships);
    console.log('✅ Added admin to channels');

    // Create demo users (for development)
    if (process.env.NODE_ENV === 'development') {
      const demoUsers = [
        {
          id: nanoid(),
          email: 'user1@example.com',
          displayName: 'Alice Johnson',
          role: 'member' as const,
          organizationId: systemOrg.id,
          isEmailVerified: true,
        },
        {
          id: nanoid(),
          email: 'user2@example.com',
          displayName: 'Bob Smith',
          role: 'member' as const,
          organizationId: systemOrg.id,
          isEmailVerified: true,
        },
        {
          id: nanoid(),
          email: 'manager@example.com',
          displayName: 'Carol Manager',
          role: 'dept_admin' as const,
          organizationId: systemOrg.id,
          isEmailVerified: true,
        },
      ];

      const createdDemoUsers = await db.insert(users).values(demoUsers).returning();
      console.log('✅ Created demo users');

      // Add demo users to general channel
      const generalChannel = createdChannels.find(c => c.name === 'general');
      if (generalChannel) {
        const demoMemberships = createdDemoUsers.map(user => ({
          id: nanoid(),
          channelId: generalChannel.id,
          userId: user.id,
          role: 'member' as const,
          joinedAt: new Date(),
        }));

        await db.insert(channelMembers).values(demoMemberships);
        console.log('✅ Added demo users to general channel');
      }
    }

    console.log('🎉 Database seeding completed');
    console.log('\n📝 Default credentials:');
    console.log('   Email: admin@aaelink.com');
    console.log('   Password: admin123!');
    console.log('\n⚠️  Please change the default password after first login!');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}

/**
 * Reset database (development only)
 */
export async function resetDatabase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot reset database in production');
  }

  console.log('🔄 Resetting database...');

  try {
    // Drop all tables in reverse order of dependencies
    const client = postgres(DATABASE_URL, { max: 1 });

    const dropTables = [
      'audit_logs',
      'erp_cache',
      'tasks',
      'events',
      'files',
      'read_cursors',
      'message_reads',
      'messages',
      'conversations',
      'channel_members',
      'channels',
      'teams',
      'passkeys',
      'users',
      'organizations',
      'drizzle_migrations',
    ];

    for (const table of dropTables) {
      await client.unsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      console.log(`   Dropped table: ${table}`);
    }

    await client.end();
    console.log('✅ Database reset completed');

    // Re-run migrations and seed
    await runMigrations();
    await seedDatabase();

  } catch (error) {
    console.error('❌ Reset failed:', error);
    throw error;
  }
}

/**
 * Check database health
 */
export async function checkDatabaseHealth() {
  try {
    await db.execute('SELECT 1');
    console.log('✅ Database connection healthy');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  try {
    const stats = await db.execute(`
      SELECT
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows
      FROM pg_stat_user_tables
      ORDER BY live_rows DESC
    `);

    return stats.rows;
  } catch (error) {
    console.error('Failed to get database stats:', error);
    return [];
  }
}

// CLI interface
if (import.meta.main) {
  const command = process.argv[2];

  switch (command) {
    case 'migrate':
      await runMigrations();
      break;

    case 'seed':
      await seedDatabase();
      break;

    case 'reset':
      await resetDatabase();
      break;

    case 'health':
      const healthy = await checkDatabaseHealth();
      process.exit(healthy ? 0 : 1);
      break;

    case 'stats':
      const stats = await getDatabaseStats();
      console.table(stats);
      break;

    default:
      console.log('Usage: bun run db/migrate.ts [migrate|seed|reset|health|stats]');
      process.exit(1);
  }

  process.exit(0);
}
