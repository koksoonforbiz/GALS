# Adaptive Tutoring System

Monorepo for the Adaptive Intelligent Tutoring System — an AI-powered platform for creating courses, administering assessments (text + drawing), auto-grading via answer keys, and tracking student mastery using Knowledge Component (KC) models.

## Structure

```
├── apps/
│   ├── api/          # NestJS orchestrator API (REST + WebSocket)
│   ├── web/          # React + Vite + TypeScript frontend
│   └── worker/       # FastAPI Python async grading worker
├── packages/
│   ├── shared/       # Zod schemas + TypeScript types
│   └── config/       # Shared ESLint + Prettier configs
├── e2e/              # Playwright end-to-end tests
├── .github/workflows # CI pipeline (lint, typecheck, test, build)
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## Prerequisites

- **Node.js** >= 20 (recommend using `nvm` or `fnm`)
- **pnpm** (`corepack enable` or install via https://pnpm.io) — version 10.x
- **Docker** & **Docker Compose** v2+
- **Python 3.12+** (for worker local dev only)

## Full Local Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd adaptive-tutoring-system
pnpm install
```

### 2. Start infrastructure services

This starts PostgreSQL, Redis, MinIO (S3-compatible blob storage), and Adminer:

```bash
pnpm infra:up
```

### 3. Configure environment

```bash
# Copy the example env file
cp .env.example .env

# The defaults work with the Docker infrastructure above.
# For production, update JWT_SECRET and database credentials.
```

**Required environment variables:**

| Variable                    | Description                            | Default                                             |
| --------------------------- | -------------------------------------- | --------------------------------------------------- |
| `DATABASE_URL`              | PostgreSQL connection string           | `postgresql://ats_user:ats_password@localhost:5432/ats_db` |
| `REDIS_URL`                 | Redis connection string                | `redis://localhost:6379`                            |
| `JWT_SECRET`                | JWT signing secret (min 16 chars)      | *(must be set)*                                     |
| `BLOB_STORAGE_ENDPOINT`     | MinIO/S3 endpoint                      | `http://localhost:9000`                             |
| `BLOB_STORAGE_BUCKET`       | Blob storage bucket name               | `ats-blobs`                                         |
| `BLOB_STORAGE_ACCESS_KEY`   | MinIO/S3 access key                    | `minioadmin`                                        |
| `BLOB_STORAGE_SECRET_KEY`   | MinIO/S3 secret key                    | `minioadmin`                                        |

### 4. Run database migrations

```bash
pnpm db:migrate
```

### 5. Start development servers

```bash
# Start API (port 3000) + Web (port 5173) concurrently via TurboRepo
pnpm dev
```

To also run the Python grading worker:

```bash
cd apps/worker
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 6. Seed test data (optional)

```bash
curl -X POST http://localhost:3000/api/dev/seed
```

This creates a teacher, student, course, topic, question, assessment, and an in-progress attempt.

## Docker Development (all-in-one)

Start the entire stack (API, Web, Worker, Postgres, Redis, MinIO) with a single command:

```bash
pnpm docker:up        # Start all services (foreground)
pnpm docker:up -d     # Start all services (detached)
pnpm docker:down      # Stop all services
```

## Running Tests

### API Integration Tests

Requires infrastructure services running (`pnpm infra:up`).

```bash
# Create the test database (one-time)
PGPASSWORD=ats_password psql -h localhost -U ats_user -d ats_db \
  -c "CREATE DATABASE ats_db_test;" 2>/dev/null || true

# Run migrations on test DB
DATABASE_URL=postgresql://ats_user:ats_password@localhost:5432/ats_db_test \
  pnpm --filter @ats/api prisma:migrate:deploy

# Run tests
pnpm --filter @ats/api test
```

### E2E Tests (Playwright)

Requires the full stack running via Docker:

```bash
# Install Playwright browsers (one-time)
npx playwright install --with-deps chromium

# Start the full stack
pnpm docker:up -d

# Wait for services to be healthy, then run tests
pnpm test:e2e
```

### All Tests

```bash
pnpm test              # Run all unit/integration tests via TurboRepo
pnpm test:e2e          # Run Playwright E2E tests
```

## Health Endpoints

| Service | URL                              |
| ------- | -------------------------------- |
| Web     | http://localhost:5173/health     |
| API     | http://localhost:3000/api/health |
| Worker  | http://localhost:8000/health     |

## Scripts

| Command              | Description                                  |
| -------------------- | -------------------------------------------- |
| `pnpm dev`           | Start web + api in dev mode (TurboRepo)      |
| `pnpm build`         | Build all packages                           |
| `pnpm lint`          | Lint all packages                            |
| `pnpm typecheck`     | Type-check all packages                      |
| `pnpm test`          | Run all unit/integration tests               |
| `pnpm test:e2e`      | Run Playwright E2E tests                     |
| `pnpm format`        | Format all files with Prettier               |
| `pnpm format:check`  | Check formatting                             |
| `pnpm docker:up`     | Start all services via Docker Compose        |
| `pnpm docker:down`   | Stop Docker Compose services                 |
| `pnpm infra:up`      | Start infrastructure only (DB, Redis, MinIO) |
| `pnpm infra:down`    | Stop infrastructure services                 |
| `pnpm db:migrate`    | Run Prisma migrations (dev)                  |
| `pnpm db:reset`      | Reset database and re-run migrations         |
| `pnpm db:studio`     | Open Prisma Studio (DB browser)              |

## CI Pipeline

GitHub Actions runs on every push to `main`/`milestone-*` branches and on pull requests:

1. **Lint & Typecheck** — ESLint + TypeScript compiler checks
2. **API Integration Tests** — Jest + supertest against real Postgres/Redis/MinIO
3. **E2E Tests** — Playwright against the full Docker Compose stack
4. **Build** — Verify all packages compile successfully

## Tech Stack

- **Web**: React 18, Vite, TypeScript, Tailwind CSS, React Router, Socket.IO client
- **API**: NestJS, TypeScript, Prisma, Zod, JWT auth, WebSocket (Socket.IO), rate limiting
- **Worker**: FastAPI, Python 3.12, psycopg2, polling-based event loop
- **Database**: PostgreSQL 16, Redis 7
- **Storage**: MinIO (S3-compatible)
- **Testing**: Jest, Supertest (API), Playwright (E2E)
- **Tooling**: pnpm workspaces, TurboRepo, ESLint, Prettier, Husky, GitHub Actions

## Troubleshooting

### "Cannot connect to database" / `ECONNREFUSED`

- Ensure infrastructure is running: `pnpm infra:up`
- Check your `.env` file has the correct `DATABASE_URL`
- Verify Postgres is accessible: `psql -h localhost -U ats_user -d ats_db`

### "Prisma migration failed"

- Reset the database: `pnpm db:reset`
- If using Docker, ensure the database container is healthy: `docker compose ps`

### "Port already in use"

- Check for running containers: `docker ps`
- Kill processes on the port: `lsof -ti:3000 | xargs kill -9` (replace 3000 with the port)

### "Redis connection refused"

- Ensure Redis is running: `pnpm infra:up`
- Verify connectivity: `redis-cli ping` should return `PONG`

### "MinIO health check fails"

- MinIO can take 10-15 seconds to start; wait and retry
- Check port conflicts on 9000/9001

### "Playwright tests fail"

- Ensure the full stack is running: `pnpm docker:up -d`
- Wait for health checks: `curl http://localhost:3000/api/health`
- Install browsers: `npx playwright install --with-deps chromium`
- View the HTML report: `npx playwright show-report`

### "JWT_SECRET must be at least 16 characters"

- Update your `.env` file: the JWT secret minimum was increased from 8 to 16 characters
- Docker Compose uses `dev-secret-change-in-production` (27 chars) by default

### "pnpm: command not found" in pre-commit hooks

- Enable corepack: `corepack enable`
- Or install pnpm globally: `npm install -g pnpm`

### Environment validation errors on startup

- The API validates all environment variables at startup using Zod
- Check the error messages — they include hints for each missing/invalid variable
- Copy `.env.example` to `.env` and fill in all required values
