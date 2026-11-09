#!/bin/sh
# Container entrypoint. Roles: api | worker | scheduler | migrate | <any command>
set -eu

role="${1:-api}"
case "$role" in
  api)
    echo "[entrypoint] applying database migrations"
    alembic upgrade head
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers \
      --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-*}" --workers "${API_WORKERS:-2}" --timeout-graceful-shutdown 20
    ;;
  worker)
    exec celery -A app.workers.celery_app worker --loglevel="${LOG_LEVEL:-INFO}" \
      --concurrency="${WORKER_CONCURRENCY:-2}" --hostname="worker@%h"
    ;;
  scheduler)
    exec celery -A app.workers.celery_app beat --loglevel="${LOG_LEVEL:-INFO}" --schedule=/tmp/celerybeat-schedule
    ;;
  migrate)
    exec alembic upgrade head
    ;;
  *)
    exec "$@"
    ;;
esac
