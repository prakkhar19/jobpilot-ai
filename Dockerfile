# syntax=docker/dockerfile:1.7
# Multi-stage build for all JobPilot AI images. Targets: backend, worker, frontend.

ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

# ---------------------------------------------------------------- python dependencies
FROM ${PYTHON_IMAGE} AS python-deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY backend/requirements.lock .
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --require-hashes -r requirements.lock

# ---------------------------------------------------------------- backend (API + scheduler)
FROM ${PYTHON_IMAGE} AS backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH" \
    DATA_DIR=/data PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN groupadd --system --gid 10001 jobpilot \
 && useradd --system --uid 10001 --gid jobpilot --home-dir /app --shell /usr/sbin/nologin jobpilot \
 && mkdir -p /data /app && chown jobpilot:jobpilot /data
COPY --from=python-deps /opt/venv /opt/venv
WORKDIR /app
COPY --chown=jobpilot:jobpilot backend/app ./app
COPY --chown=jobpilot:jobpilot backend/migrations ./migrations
COPY --chown=jobpilot:jobpilot backend/alembic.ini ./alembic.ini
COPY --chown=jobpilot:jobpilot docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh
USER jobpilot
VOLUME ["/data"]
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["api"]

# ---------------------------------------------------------------- worker (adds headless Chromium)
FROM backend AS worker
USER root
RUN playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /var/lib/apt/lists/*
USER jobpilot
CMD ["worker"]

# ---------------------------------------------------------------- frontend build
FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------- frontend (nginx, non-root)
FROM ${NGINX_IMAGE} AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /src/dist /usr/share/nginx/html
EXPOSE 8080
