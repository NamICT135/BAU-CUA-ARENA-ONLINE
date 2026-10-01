#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testEnvironment = { ...process.env, NODE_ENV: 'test' };

dotenv.config({ path: join(projectRoot, '.env'), processEnv: testEnvironment });
dotenv.config({
  path: join(projectRoot, '.env.test'),
  processEnv: testEnvironment,
  override: true,
});

function databaseName(environment) {
  const connectionString = environment.TEST_DATABASE_URL || environment.DATABASE_URL;
  if (!connectionString) return environment.DB_NAME_TEST || 'bau_cua_test';
  try {
    return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL is not a valid PostgreSQL URL.');
  }
}

function validateTestConfiguration(environment) {
  const name = databaseName(environment);
  if (!/(^|[_-])test($|[_-])/i.test(name)) {
    throw new Error(
      `Refusing to run database tests against "${name}". ` +
      'Use DB_NAME_TEST or a test connection URL whose database name contains "test".'
    );
  }

  const connectionString = environment.TEST_DATABASE_URL || environment.DATABASE_URL;
  if (!connectionString && !environment.DB_PASSWORD) {
    throw new Error(
      'PostgreSQL test configuration is missing. Copy .env.example to .env, ' +
      'set DB_PASSWORD, and create the bau_cua_test database; alternatively set TEST_DATABASE_URL.'
    );
  }
}

function runNode(args, environment) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function testFiles(directory) {
  const entries = await readdir(join(projectRoot, directory), { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => relative(projectRoot, join(projectRoot, directory, entry.name)))
    .sort();
}

validateTestConfiguration(testEnvironment);

// A clean or partially initialized test database is brought to the current
// schema before executing the database suites.
runNode(['scripts/db-migrate.js'], testEnvironment);

const files = [
  ...await testFiles('tests/db'),
  ...await testFiles('tests/repositories'),
  ...await testFiles('tests/services'),
];

runNode(['--test', '--test-concurrency=1', ...files], testEnvironment);
