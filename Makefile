.PHONY: help init-env up down logs ps build restart backup restore reset-password migrate \
        dev-backend dev-frontend test test-backend test-frontend lint lint-backend lint-frontend e2e

COMPOSE ?= docker compose

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

init-env: ## Create .env with random secrets
	./scripts/init-env.sh

up: ## Build and start the stack
	$(COMPOSE) up --build -d

down: ## Stop the stack (data volumes are kept)
	$(COMPOSE) down

restart: ## Restart application services
	$(COMPOSE) restart backend worker scheduler frontend

build: ## Build images
	$(COMPOSE) build

logs: ## Follow logs
	$(COMPOSE) logs -f --tail=100

ps: ## Service status
	$(COMPOSE) ps

migrate: ## Apply database migrations
	$(COMPOSE) run --rm backend migrate

backup: ## Back up database + files to ./backups
	./scripts/backup.sh

restore: ## Restore: make restore DIR=backups/jobpilot-<timestamp>
	./scripts/restore.sh $(DIR)

seed-demo: ## DEMO_MODE only: make seed-demo EMAIL=demo@example.com PASSWORD=...
	$(COMPOSE) exec backend python -m app.cli seed-demo $(EMAIL) $(PASSWORD)

reset-password: ## Print a password-reset link: make reset-password EMAIL=you@example.com
	$(COMPOSE) exec backend python -m app.cli reset-password $(EMAIL)

dev-backend: ## Run the API locally (SQLite, eager tasks, demo mode)
	cd backend && mkdir -p ../data/dev && DATA_DIR=../data/dev DATABASE_URL=sqlite:///../data/dev/dev.db \
	  ENVIRONMENT=development DEMO_MODE=true CELERY_EAGER=true INTERNAL_BASE_URL=http://127.0.0.1:8000 \
	  PUBLIC_BASE_URL=http://localhost:5173 uv run sh -c "alembic upgrade head && uvicorn app.main:app --reload --port 8000"

dev-frontend: ## Run the Vite dev server (proxies /api to :8000)
	cd frontend && npm run dev

test: test-backend test-frontend ## Run all unit/integration tests

test-backend:
	cd backend && uv run pytest -q

test-frontend:
	cd frontend && npm test

lint: lint-backend lint-frontend ## Lint everything

lint-backend:
	cd backend && uv run ruff check app tests

lint-frontend:
	cd frontend && npm run lint && npm run typecheck

e2e: ## Run browser end-to-end tests against the running stack (DEMO_MODE=true)
	cd e2e && npm ci && npx playwright test
