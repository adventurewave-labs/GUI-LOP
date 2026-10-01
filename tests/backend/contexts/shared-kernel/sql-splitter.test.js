/**
 * sql-splitter.test.js — the lexer shared by migrate.js and the contract
 * applier. Every case here is a way the old `.split(';')` broke.
 */
import { splitSqlStatements, requiresNoTransaction, expandPsqlMetaCommands } from '../../../../database/utils/sql-splitter.js';

describe('splitSqlStatements', () => {
  test('basic split, trailing statement without semicolon', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  test('semicolons inside strings, escaped quotes and E-strings', () => {
    const sql = "COMMENT ON COLUMN t.c IS 'a; b; it''s'; INSERT INTO x VALUES (E'\\';'); SELECT 3;";
    expect(splitSqlStatements(sql)).toEqual([
      "COMMENT ON COLUMN t.c IS 'a; b; it''s'",
      "INSERT INTO x VALUES (E'\\';')",
      'SELECT 3',
    ]);
  });

  test('quoted identifiers', () => {
    expect(splitSqlStatements('CREATE TABLE "a;b" (id int); SELECT 1')).toEqual(['CREATE TABLE "a;b" (id int)', 'SELECT 1']);
  });

  test('dollar-quoted PL/pgSQL bodies, tagged and untagged; $1 params untouched', () => {
    const sql = [
      'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;',
      'DO $body$ BEGIN PERFORM 1; END $body$;',
      'SELECT $1::int;',
    ].join('\n');
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain('RETURN 1; END;');
    expect(out[1]).toContain('PERFORM 1;');
    expect(out[2]).toBe('SELECT $1::int');
  });

  test('comments: semicolons inside ignored; comment-led statements kept (old runner dropped them)', () => {
    const sql = [
      '-- header; with semicolon',
      'CREATE TABLE a (id int); /* block ; /* nested ; */ still */',
      '-- only a comment;',
      'SELECT 1;',
    ].join('\n');
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('-- header; with semicolon\nCREATE TABLE a (id int)');
    expect(out[1]).toMatch(/SELECT 1$/);
  });

  test('comment-only input yields nothing', () => {
    expect(splitSqlStatements('-- nothing here;\n/* nor ; here */')).toEqual([]);
  });
});

describe('requiresNoTransaction', () => {
  test('detects CONCURRENTLY and database-level commands', () => {
    expect(requiresNoTransaction(['CREATE INDEX CONCURRENTLY i ON t(c)'])).toBe(true);
    expect(requiresNoTransaction(['-- c\nVACUUM ANALYZE t'])).toBe(true);
    expect(requiresNoTransaction(['CREATE INDEX i ON t(c)'])).toBe(false);
  });
});

describe('expandPsqlMetaCommands', () => {
  const files = { '/repo/a.sql': 'SELECT 1;\n\\i b.sql\n', '/repo/b.sql': '\\echo hi\nSELECT 2;' };
  const readFile = async (p) => files[p];

  test('inlines \\i includes and drops other meta-commands', async () => {
    const out = await expandPsqlMetaCommands('\\timing on\n\\i a.sql', { baseDir: '/repo', readFile });
    expect(out).toBe('SELECT 1;\nSELECT 2;\n');
  });

  test('rejects includes escaping baseDir, and cycles', async () => {
    await expect(expandPsqlMetaCommands('\\i ../etc/passwd', { baseDir: '/repo', readFile })).rejects.toThrow(/escapes/);
    const cyc = { '/repo/x.sql': '\\i x.sql' };
    await expect(
      expandPsqlMetaCommands('\\i x.sql', { baseDir: '/repo', readFile: async (p) => cyc[p] }),
    ).rejects.toThrow(/cycle/);
  });
});

describe('real migration chain', () => {
  test('every migration splits without leaving psql meta-commands behind', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../../../..');
    const dir = path.join(root, 'database/migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      const sql = await expandPsqlMetaCommands(readFileSync(path.join(dir, f), 'utf8'), { baseDir: root });
      const stmts = splitSqlStatements(sql);
      expect(stmts.length).toBeGreaterThan(0);
      for (const s of stmts) expect(s).not.toMatch(/^\s*\\/m);
    }
  });
});
