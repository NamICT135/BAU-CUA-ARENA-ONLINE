import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');

// Load shared settings first, then allow an optional test-only file to
// override them when the database test runner sets NODE_ENV=test.
dotenv.config({ path: resolve(projectRoot, '.env') });
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: resolve(projectRoot, '.env.test'), override: true });
}

const { Pool } = pg;

// Hỗ trợ cả DATABASE_URL (production) lẫn biến riêng lẻ (local dev)
function buildConfig() {
  const isTest = process.env.NODE_ENV === 'test';
  const connectionString = isTest
    ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL;
  if (connectionString) return { connectionString };

  const database = isTest
    ? process.env.DB_NAME_TEST || 'bau_cua_test'
    : process.env.DB_NAME_DEV || 'bau_cua_dev';
  const password = process.env.DB_PASSWORD || '';

  const port = Number(process.env.DB_PORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PostgreSQL configuration is invalid: DB_PORT must be an integer from 1 to 65535.');
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port,
    user: process.env.DB_USER || 'postgres',
    password,
    database,
  };
}

function assertDatabaseConfigured() {
  const isTest = process.env.NODE_ENV === 'test';
  const connectionString = isTest
    ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL;
  if (!connectionString && !process.env.DB_PASSWORD) {
    const target = isTest ? '.env.test or .env' : '.env';
    throw new Error(
      `PostgreSQL configuration is incomplete: set DB_PASSWORD in ${target}, ` +
      `or provide ${isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'}.`
    );
  }
}

export const pool = new Pool({
  ...buildConfig(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: process.env.NODE_ENV === 'test',
});

pool.on('error', (err) => {
  console.error('[DB Pool Error]: Unexpected error on idle client', err);
});

export async function query(text, params) {
  assertDatabaseConfigured();
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.DEBUG_SQL === 'true') {
    console.log('[Executed Query]', { text, duration, rows: res.rowCount });
  }
  return res;
}

export async function getClient() {
  assertDatabaseConfigured();
  const client = await pool.connect();
  return client;
}

export async function checkConnection() {
  try {
    assertDatabaseConfigured();
    const res = await pool.query('SELECT NOW() as now, current_database() as db');
    return { ok: true, now: res.rows[0].now, database: res.rows[0].db };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function closePool() {
  await pool.end();
}
