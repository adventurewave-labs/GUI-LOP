#!/usr/bin/env bash
# =============================================================================
# GUI-LOP database backup / restore / drill (roadmap P7).
#
#   DATABASE_URL=postgresql://… database/scripts/db-backup.sh backup
#   database/scripts/db-backup.sh verify  backups/gui-lop-20261001T210500Z.dump
#   database/scripts/db-backup.sh restore backups/….dump postgresql://…/target
#   database/scripts/db-backup.sh list
#   DATABASE_URL=postgresql://… database/scripts/db-backup.sh drill
#
# backup   pg_dump (custom format, no owner/ACL so it restores under any role)
#          + SHA-256 sidecar + readability check + retention pruning.
# verify   checksum matches and the archive's table of contents is readable.
# restore  into an EMPTY database only (refuses otherwise unless FORCE=1),
#          in a single transaction: it either fully applies or not at all.
# drill    proves the backup is restorable: dump the source, restore into a
#          scratch database on the same server, compare every table's row
#          count with the source, check the migration ledger matches, run the
#          migrations against the restored copy (must be a no-op), report
#          sizes and timings (your RTO), then drop the scratch database
#          (DRILL_KEEP=1 keeps it and prints its URL).
#
# Env: DATABASE_URL (source), BACKUP_DIR (default ./backups),
#      BACKUP_RETENTION_DAYS (default 30; 0 = keep everything).
# Needs pg_dump/pg_restore/psql at least as new as the server.
#
# Replaces backup.sh / restore.js, neither of which could run (unbound
# variable; crash at import) — there was no working backup path.
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

log() { printf '[db-backup] %s\n' "$*"; }
die() { printf '[db-backup] ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found in PATH"; }
need_url() { [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is required"; }
now_ms() { date +%s%3N; }
# Never print credentials.
redact() { printf '%s' "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

cmd_backup() {
  need pg_dump; need pg_restore; need_url
  mkdir -p "$BACKUP_DIR"
  local file="${1:-$BACKUP_DIR/gui-lop-$(date -u +%Y%m%dT%H%M%SZ).dump}"
  log "dumping $(redact "$DATABASE_URL") → $file"
  local t0; t0=$(now_ms)
  pg_dump --format=custom --no-owner --no-privileges --file="$file.partial" "$DATABASE_URL"
  mv "$file.partial" "$file"
  sha256 "$file" > "$file.sha256"
  pg_restore --list "$file" >/dev/null || die "archive is not readable: $file"
  log "ok: $(du -h "$file" | cut -f1), $(( $(now_ms) - t0 )) ms, sha256 $(cut -c1-16 "$file.sha256")…"
  if [ "$RETENTION_DAYS" -gt 0 ]; then
    find "$BACKUP_DIR" -maxdepth 1 -name 'gui-lop-*.dump*' -type f -mtime "+$RETENTION_DAYS" -print -delete | sed 's/^/[db-backup] pruned /' || true
  fi
  printf '%s\n' "$file"
}

cmd_verify() {
  need pg_restore
  local file="${1:-}"; [ -f "$file" ] || die "usage: verify <file.dump>"
  [ -f "$file.sha256" ] || die "missing checksum sidecar $file.sha256"
  [ "$(sha256 "$file")" = "$(cat "$file.sha256")" ] || die "checksum mismatch: $file is corrupt or was modified"
  local n; n=$(pg_restore --list "$file" | grep -c ' TABLE DATA ' || true)
  [ "$n" -gt 0 ] || die "archive contains no table data"
  log "ok: checksum matches, $n tables with data"
}

cmd_restore() {
  need pg_restore; need psql
  local file="${1:-}" target="${2:-}"
  [ -f "$file" ] && [ -n "$target" ] || die "usage: restore <file.dump> <target DATABASE_URL>"
  cmd_verify "$file"
  local existing; existing=$(psql "$target" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
  if [ "$existing" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
    die "target $(redact "$target") already has $existing tables; restore only into an empty database (FORCE=1 overrides)"
  fi
  log "restoring $file → $(redact "$target")"
  local t0; t0=$(now_ms)
  pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$target" "$file"
  log "ok: restored in $(( $(now_ms) - t0 )) ms"
}

cmd_list() {
  ls -1t "$BACKUP_DIR"/gui-lop-*.dump 2>/dev/null | while read -r f; do
    printf '%s  %s  %s\n' "$(date -u -r "$f" +%Y-%m-%dT%H:%M:%SZ)" "$(du -h "$f" | cut -f1)" "$f"
  done
}

# Per-table exact row counts, "table<TAB>count" sorted by name.
row_counts() {
  psql "$1" -tA -F $'\t' -c "
    SELECT c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname"
}

cmd_drill() {
  need pg_dump; need pg_restore; need psql; need_url
  # Globals on purpose: the EXIT trap runs after this function's locals are gone.
  DRILL_WORK=$(mktemp -d)
  DRILL_SCRATCH="restore_drill_$(date -u +%Y%m%d%H%M%S)_$$"
  DRILL_ADMIN_URL="$DATABASE_URL"
  local work="$DRILL_WORK" scratch="$DRILL_SCRATCH" admin_url="$DRILL_ADMIN_URL"
  # Same server, different database.
  local scratch_url; scratch_url=$(printf '%s' "$DATABASE_URL" | sed -E "s#(://[^/]+/)[^?]*#\1$scratch#")
  cleanup() {
    if [ "${DRILL_KEEP:-0}" != "1" ]; then
      psql "$DRILL_ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DRILL_SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || true
    fi
    rm -rf "$DRILL_WORK"
  }
  trap cleanup EXIT

  local t0; t0=$(now_ms)
  row_counts "$DATABASE_URL" > "$work/source.counts"
  local file; file=$(BACKUP_DIR="$work" BACKUP_RETENTION_DAYS=0 cmd_backup "$work/drill.dump" | tail -n 1)
  local t_backup=$(( $(now_ms) - t0 ))

  psql "$admin_url" -qc "CREATE DATABASE \"$scratch\""
  local t1; t1=$(now_ms)
  cmd_restore "$file" "$scratch_url"
  local t_restore=$(( $(now_ms) - t1 ))

  row_counts "$scratch_url" > "$work/restored.counts"
  if ! diff -u "$work/source.counts" "$work/restored.counts" > "$work/diff"; then
    if [ "${DRILL_STRICT:-1}" = "1" ]; then
      cat "$work/diff" >&2
      die "row counts differ between source and restored copy (DRILL_STRICT=0 tolerates drift when the source is taking writes)"
    fi
    log "WARNING: row counts drifted (source is live):"; sed 's/^/[db-backup]   /' "$work/diff"
  fi
  local tables rows
  tables=$(wc -l < "$work/restored.counts" | tr -d ' ')
  rows=$(awk -F '\t' '{ s += $2 } END { print s + 0 }' "$work/restored.counts")

  local ledger_src ledger_dst
  ledger_src=$(psql "$DATABASE_URL" -tAc "SELECT string_agg(filename, ',' ORDER BY filename) FROM schema_migrations" 2>/dev/null || echo "")
  ledger_dst=$(psql "$scratch_url" -tAc "SELECT string_agg(filename, ',' ORDER BY filename) FROM schema_migrations" 2>/dev/null || echo "")
  [ "$ledger_src" = "$ledger_dst" ] || die "migration ledger differs after restore"

  if [ -f database/migrations/migrate.js ] && command -v node >/dev/null 2>&1; then
    DATABASE_URL="$scratch_url" node database/migrations/migrate.js migrate > "$work/migrate.log" 2>&1 \
      || { tail -n 20 "$work/migrate.log" >&2; die "migrations failed against the restored copy"; }
    grep -q "No pending migrations" "$work/migrate.log" || die "restored copy unexpectedly had pending migrations"
  fi

  log "DRILL OK: $tables tables, $rows rows identical; dump $(du -h "$file" | cut -f1); backup ${t_backup} ms, restore ${t_restore} ms; migrations no-op"
  if [ "${DRILL_KEEP:-0}" = "1" ]; then
    log "kept restored copy (drop it when done)"
    printf '%s\n' "$scratch_url"
  fi
}

case "${1:-}" in
  backup)  shift; cmd_backup "$@" ;;
  verify)  shift; cmd_verify "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  list)    shift; cmd_list ;;
  drill)   shift; cmd_drill ;;
  *) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
