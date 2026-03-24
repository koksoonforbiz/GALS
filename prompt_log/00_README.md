# Logging System Build Prompts

This folder contains sequential prompts for Claude Code to build the complete
student interaction logging system for the affective tutoring capstone.

## Execution Order

Run these prompts **in order**. Each prompt depends on the previous one.

| File | Task | Dependencies |
|------|------|--------------|
| `01_database_schema.md` | Prisma schema for all new tables | None — run first |
| `02_api_routes.md` | NestJS API endpoints for batch ingest | Requires 01 |
| `03_interaction_hook.md` | `useInteractionLogger` React hook | Requires 02 |
| `04_error_boundary.md` | React ErrorBoundary with logging | Requires 02 |
| `05_python_sync_pipeline.md` | Python multimodal sync pipeline | Requires 01 |
| `06_teacher_dashboard.md` | Session timeline viewer UI | Requires 01, 02 |
| `07_derived_analytics.md` | Derived metrics computation jobs | Requires 01, 02 |
| `08_data_export_backup.md` | Parquet/CSV auto-export & backup | Requires all above |

## How to Use

Ask Claude Code:
> "Please read the folder `prompt_log` and execute the prompts in order,
> starting with `01_database_schema.md`. Complete each one fully before
> moving to the next."

## ✅ Verified Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend framework** | Vite + React 18 (SPA, not Next.js) |
| **Frontend routing** | React Router v6 |
| **Frontend styling** | Tailwind CSS v4 — no shadcn/ui; uses Lucide icons + custom components |
| **ORM** | Prisma 6.19 with PostgreSQL |
| **Backend framework** | NestJS (not a Next.js API layer) |
| **Auth** | NestJS JWT (`@nestjs/jwt` + `passport-jwt`) — JWT guards on protected routes |
| **Object storage** | MinIO via AWS S3 SDK (`@aws-sdk/client-s3`) |
| **Python runtime** | Python 3.10+, `pandas`, `psycopg2-binary`, `redis`, `minio` SDK |
| **Python — NOT used** | ~~sqlalchemy~~, ~~pyarrow~~ — do not install or import these |

## Key Corrections vs Common Assumptions

1. **Vite + React 18 SPA** — no Next.js conventions, no `app/` directory,
   no server components, no `route.ts` files. All frontend code is in `src/`.
   API calls go over HTTP to the NestJS backend.

2. **NestJS backend** — all API endpoints are NestJS controllers + services.
   Use `@Controller()`, `@Post()`, `@Get()`, `@Body()`, `@UseGuards(JwtAuthGuard)`.
   Do not create `route.ts` or `pages/api/` files.

3. **No shadcn/ui** — build UI from scratch with Tailwind CSS v4 utility classes.
   Use `lucide-react` for icons. No `cn()` utility unless already present in the codebase.

4. **Python: psycopg2-binary, not sqlalchemy** — connect to PostgreSQL directly with
   `psycopg2`. Use `pandas.read_sql(query, conn)` with a psycopg2 connection object.
   Use the `minio` Python SDK (not boto3) for MinIO uploads.
   Do not use `pyarrow` — use `fastparquet` if Parquet is needed, or fall back to CSV.
