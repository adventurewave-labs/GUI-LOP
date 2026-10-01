/**
 * sql-splitter — split a SQL script into individual statements, correctly.
 *
 * node-postgres sends one query at a time and has no notion of psql's
 * client-side parsing, so migration runners must split scripts themselves.
 * A naive `.split(';')` breaks on semicolons inside:
 *
 *   - string literals              'a;b'   'it''s'   E'\';'
 *   - quoted identifiers           "weird;name"
 *   - dollar-quoted bodies         $$ … $$   $fn$ … $fn$   (PL/pgSQL)
 *   - comments                     -- …;      /* … ; … *\/  (nestable)
 *
 * This is a small lexer that tracks those states and only splits on a
 * top-level `;`. Comments are preserved inside statements (Postgres accepts
 * them) but comment-only fragments are dropped. Shared by the production
 * migration runner and the contract-test applier so both execute exactly
 * the same statements.
 *
 * @param {string} sql
 * @returns {string[]} non-empty statements without the trailing `;`
 */
export function splitSqlStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  let hasCode = false; // buf contains something other than whitespace/comments

  const push = () => {
    const s = buf.trim();
    if (s && hasCode) out.push(s);
    buf = '';
    hasCode = false;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */ (Postgres allows nesting)
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 2; continue; }
        j += 1;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }

    // 'string' — with '' escapes, and backslash escapes for E'' strings
    if (ch === "'") {
      const isEscapeString = /[eE]$/.test(buf) && !/[A-Za-z0-9_][eE]$/.test(buf);
      let j = i + 1;
      while (j < n) {
        if (isEscapeString && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      buf += sql.slice(i, j + 1);
      hasCode = true;
      i = j + 1;
      continue;
    }

    // "quoted identifier" — with "" escapes
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j += 1;
      }
      buf += sql.slice(i, j + 1);
      hasCode = true;
      i = j + 1;
      continue;
    }

    // $tag$ … $tag$ dollar quoting (tag may be empty). A `$` preceded by an
    // identifier char is a positional parameter / part of a name, not a quote.
    if (ch === '$' && !/[A-Za-z0-9_]$/.test(buf)) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const stop = close === -1 ? n : close + tag.length;
        buf += sql.slice(i, stop);
        hasCode = true;
        i = stop;
        continue;
      }
    }

    if (ch === ';') {
      push();
      i += 1;
      continue;
    }

    if (!/\s/.test(ch)) hasCode = true;
    buf += ch;
    i += 1;
  }
  push();
  return out;
}

/**
 * True if any statement must run outside a transaction block.
 * (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE` on older PG,
 * `VACUUM`, `CREATE DATABASE`, …)
 */
export function requiresNoTransaction(statements) {
  return statements.some((s) =>
    /\bCONCURRENTLY\b/i.test(s) ||
    /^\s*(VACUUM|CREATE\s+DATABASE|DROP\s+DATABASE|REINDEX\s+DATABASE)\b/i.test(s.replace(/^(\s*--[^\n]*\n)+/, '')),
  );
}

/**
 * Expand psql client-side meta-commands so a script written for `psql -f`
 * can run through node-postgres: `\i <path>` (and `\ir`) are inlined
 * recursively (paths relative to `baseDir`); every other backslash
 * meta-command line is dropped. Include cycles are rejected.
 *
 * @param {string} raw
 * @param {{ baseDir: string, readFile?: (p: string) => Promise<string>, _seen?: Set<string> }} opts
 */
export async function expandPsqlMetaCommands(raw, { baseDir, readFile, _seen = new Set() }) {
  const { readFile: fsRead } = await import('node:fs/promises');
  const { resolve, relative, isAbsolute } = await import('node:path');
  const read = readFile ?? ((p) => fsRead(p, 'utf8'));
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const inc = /^\s*\\ir?\s+(.+?)\s*;?\s*$/.exec(line);
    if (inc) {
      const target = resolve(baseDir, inc[1].replace(/^['"]|['"]$/g, ''));
      const rel = relative(baseDir, target);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`psql include escapes base directory: ${inc[1]}`);
      }
      if (_seen.has(target)) throw new Error(`psql include cycle: ${inc[1]}`);
      const nested = new Set(_seen).add(target);
      out.push(await expandPsqlMetaCommands(await read(target), { baseDir, readFile, _seen: nested }));
      continue;
    }
    if (/^\s*\\\S/.test(line)) continue; // other psql meta-command
    out.push(line);
  }
  return out.join('\n');
}
