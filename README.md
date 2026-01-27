# Adaptive Tutoring System

Monorepo for the Adaptive Intelligent Tutoring System.

## Structure

```
├── apps/
│   ├── api/          # NestJS orchestrator API (REST + WebSocket)
│   ├── web/          # React + Vite + TypeScript frontend
│   └── worker/       # FastAPI Python async grading worker
├── packages/
│   ├── shared/       # Zod schemas + TypeScript types
│   └── config/       # Shared ESLint + Prettier configs
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js >= 20
- pnpm (`corepack enable` or install via https://pnpm.io)
- Docker & Docker Compose
- Python 3.12+ (for worker local dev)

## Getting Started

```bash
# Install all dependencies
pnpm install

# Start web + api concurrently (local dev, no Docker)
pnpm dev

# Start worker separately (requires Python venv)
cd apps/worker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Docker (all services)

```bash
# Start everything (Postgres, Redis, API, Web, Worker)
pnpm docker:up

# Stop everything
pnpm docker:down
```

## Health Endpoints

| Service | URL                              |
| ------- | -------------------------------- |
| Web     | http://localhost:5173/health     |
| API     | http://localhost:3000/api/health |
| Worker  | http://localhost:8000/health     |

## Scripts

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `pnpm dev`          | Start web + api in dev mode (TurboRepo) |
| `pnpm build`        | Build all packages                      |
| `pnpm lint`         | Lint all packages                       |
| `pnpm typecheck`    | Type-check all packages                 |
| `pnpm format`       | Format all files with Prettier          |
| `pnpm format:check` | Check formatting                        |
| `pnpm docker:up`    | Start all services via Docker Compose   |
| `pnpm docker:down`  | Stop Docker Compose services            |

## Tech Stack

- **Web**: React 18, Vite, TypeScript, React Router
- **API**: NestJS, TypeScript, Zod
- **Worker**: FastAPI, Python 3.12, Pydantic
- **Infra**: PostgreSQL 16, Redis 7, Docker Compose
- **Tooling**: pnpm workspaces, TurboRepo, ESLint, Prettier, Husky
