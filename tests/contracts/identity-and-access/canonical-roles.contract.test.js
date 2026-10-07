/**
 * Migration 015 + PgRoleRepository (roadmap P4): a bare `db:migrate` yields
 * roles the app understands, legacy-vocabulary rows are repaired, operator
 * customisations survive, and one malformed entry can't 500 authorisation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { PgRoleRepository } from '../../../src/backend/contexts/identity-and-access/infrastructure/persistence/pg-role-repository.js';

const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/015_canonical_role_permissions.sql'), 'utf8');

describeIfDocker('canonical role permissions (migration 015)', () => {
  let pg; let roles;
  beforeAll(async () => {
    pg = await startPostgres({ applyAnalytics: false });
    roles = new PgRoleRepository(pg.pool);
  }, 90_000);
  afterAll(async () => { if (pg) await pg.cleanup(); });
  const perms = async (name) => (await roles.findByName(name)).permissions.map((p) => p.value ?? String(p));

  test('fresh migrate: user can read/create/respond, viewer can read, admin is implicit', async () => {
    expect(await perms('user')).toEqual(['workflow:read', 'workflow:create', 'workflow:respond']);
    expect(await perms('viewer')).toEqual(['workflow:read']);
    expect(await perms('admin')).toEqual([]);
  });

  test('legacy "read/write/execute" rows are repaired; valid customisations are kept; re-run is idempotent', async () => {
    await pg.pool.query(`UPDATE roles SET permissions = '["read", "write", "execute"]' WHERE name = 'user'`);
    await pg.pool.query(`UPDATE roles SET permissions = '["workflow:read", "template:publish"]' WHERE name = 'viewer'`);
    await pg.pool.query(MIGRATION);
    await pg.pool.query(MIGRATION);
    expect(await perms('user')).toEqual(['workflow:read', 'workflow:create', 'workflow:respond']);
    expect(await perms('viewer')).toEqual(['workflow:read', 'template:publish']);
  });

  test('a malformed entry is skipped instead of failing every authorisation check', async () => {
    await pg.pool.query(`UPDATE roles SET permissions = '["workflow:read", "read"]' WHERE name = 'viewer'`);
    expect(await perms('viewer')).toEqual(['workflow:read']);
  });
});
