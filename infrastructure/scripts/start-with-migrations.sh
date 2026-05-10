#!/bin/sh
# -----------------------------------------------------------------------------
# start-with-migrations.sh
#
# Used as the docker-compose `app` command. Runs database migrations against
# DATABASE_URL (if set) and then execs the DDD bootstrap server. If DATABASE_URL
# is empty/unset we skip migrations because bootstrap falls back to its
# in-memory adapters.
#
# In Kubernetes, migrations are applied by the pre-install/pre-upgrade Helm
# Job (see infrastructure/helm/gui-lop/templates/migration-job.yaml). The
# pod itself just runs the bootstrap entry point, so this script is only
# wired up via the compose `command:` override.
# -----------------------------------------------------------------------------
set -eu

if [ -n "${DATABASE_URL:-}" ]; then
  echo "[start-with-migrations] DATABASE_URL set; running migrations..."
  node database/migrations/migrate.js migrate
  echo "[start-with-migrations] Migrations applied."
else
  echo "[start-with-migrations] DATABASE_URL empty; skipping migrations (in-memory mode)."
fi

echo "[start-with-migrations] Launching DDD bootstrap server..."
exec node src/backend/bootstrap/index.js
