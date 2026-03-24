# TEST STAGE 0 — Environment Setup & Pre-Flight Checks

## Your Role

You are a test assistant for the **Adaptive Tutoring System (ATS)**. Your job in this stage is to verify that all infrastructure is running correctly before any feature tests begin. Work through every check below in order. After each check, report the result as **PASS**, **FAIL**, or **WARN** with a one-line reason.

Do not proceed to Stage 1 until every check in this file is PASS or WARN (with the warn reason documented).

---

## System Under Test

| Component | Expected Location |
|-----------|------------------|
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| MinIO | `localhost:9000` (API) / `localhost:9001` (Console) |
| NestJS API | `localhost:3000` (or whatever port `apps/api` is configured on) |
| React Frontend | `localhost:5173` (Vite default) |
| py-feat worker | Running as a Docker container or Python process |

---

## Check S0-1: Start All Infrastructure Services

Run the following and confirm each service is healthy:

```bash
docker-compose up -d postgres redis minio
docker-compose ps
```

**Expected:**
- All three containers show status `Up` or `healthy`
- No container shows `Exited` or `Restarting`

**Action if FAIL:** Check `docker-compose logs postgres`, `docker-compose logs redis`, `docker-compose logs minio` for errors. Fix before proceeding.

---

## Check S0-2: Run Database Migrations

```bash
cd apps/api
pnpm prisma migrate deploy
# or in dev:
pnpm prisma migrate dev
```

**Expected:**
- Output ends with: `All migrations have been applied` or `Database schema is up to date`
- No `ERROR` lines in output

**Verify the new biometric tables exist:**
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'RecordingConfig', 'RecordingSegment',
  'PupilSizeConfig', 'PupilSizeLog',
  'WebgazerConfig', 'WebgazerLog', 'WebgazerCalibrationEvent',
  'PyfeatConfig', 'PyfeatJob', 'PyfeatAuResult'
);
```
**Expected:** 10 rows returned (all 10 table names present).

---

## Check S0-3: Seed Test Accounts

```bash
cd apps/api
pnpm prisma db seed
```

If a seed script does not exist, create the test accounts manually via the API or Admin UI:

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Teacher | teacher@test.com | Test1234! | Must have `role = 'teacher'` |
| Student | student@test.com | Test1234! | Must have `role = 'student'` |

**Verify in DB:**
```sql
SELECT id, email, role FROM "User"
WHERE email IN ('teacher@test.com', 'student@test.com');
```
**Expected:** 2 rows, one with `role = 'teacher'`, one with `role = 'student'`. Note the `id` values — they will be used as `{TEACHER_ID}` and `{STUDENT_ID}` throughout all test stages.

---

## Check S0-4: Create Test Course and Enroll Student

Using the Teacher account (via the UI or API), create a course:

```
Name: Biometrics Test Course
Status: Published (or at minimum visible to students)
```

Then enroll `student@test.com` in this course.

**Verify in DB:**
```sql
SELECT c.id AS "courseId", c.name, e."userId"
FROM "Course" c
JOIN "Enrollment" e ON e."courseId" = c.id
WHERE c.name = 'Biometrics Test Course';
```
**Expected:** 1 row with `courseId` populated. **Copy this value** — it will be used as `{COURSE_ID}` in all subsequent test stages.

---

## Check S0-5: NestJS API Health

```bash
curl http://localhost:3000/health
```

**Expected:**
- HTTP 200 response
- Body: `{ "status": "ok" }` (or similar)

Also confirm the new biometric endpoints are registered:
```bash
curl -X GET http://localhost:3000/recording/config/test \
  -H "Authorization: Bearer {TEACHER_JWT}"
```
**Expected:** HTTP 401 (unauthorized, not 404). A 404 would mean the route is not registered.

To get a JWT:
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teacher@test.com","password":"Test1234!"}'
```
Copy the returned token as `{TEACHER_JWT}`.

Also get a student token:
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@test.com","password":"Test1234!"}'
```
Copy as `{STUDENT_JWT}`.

---

## Check S0-6: MinIO Bucket

Open MinIO console at `http://localhost:9001` (default credentials: `minioadmin` / `minioadmin`).

Confirm the bucket `ats-data` exists. If not, create it:
```bash
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/ats-data
```

**Verify the bucket is accessible:**
```bash
mc ls local/ats-data
```
**Expected:** Command succeeds (bucket may be empty — that is fine).

**Set CORS policy** (required for direct browser-to-MinIO PUT uploads):
```bash
mc anonymous set-json - local/ats-data << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": ["*"]},
    "Action": ["s3:PutObject", "s3:GetObject"],
    "Resource": ["arn:aws:s3:::ats-data/*"]
  }]
}
EOF
```
**Expected:** `Access permission for 'local/ats-data' is set to 'none'` or similar success message.

---

## Check S0-7: Redis Connectivity

```bash
redis-cli ping
# Expected: PONG

redis-cli llen pyfeat:jobs
# Expected: 0 (empty queue at start)
```

Also confirm the NestJS API can reach Redis. Look for this in the API startup logs:
```
[RedisModule] Connected to Redis at localhost:6379
```

---

## Check S0-8: py-feat Worker

Start the worker if not already running:
```bash
# Docker:
docker-compose up -d pyfeat-worker
docker-compose logs -f pyfeat-worker

# Or directly (with virtualenv activated):
cd apps/pyfeat-worker
python main.py
```

**Expected log output on startup:**
```
py-feat worker started. Polling Redis queue: pyfeat:jobs
Detector loaded: retinaface + xgb
```

**Verify it is waiting for jobs (no crash loop):**
```bash
docker-compose ps pyfeat-worker
# Expected: status = 'Up'
```

If the worker fails to start due to missing model files, run the pre-download step:
```bash
docker-compose run pyfeat-worker python -c "from feat import Detector; Detector(face_model='retinaface', au_model='xgb')"
```

---

## Check S0-9: Frontend Loads

Open `http://localhost:5173` in Chrome or Edge (required for WebGazer — Firefox will fail WebGazer tests).

**Verify:**
- Login page renders without a blank screen or console errors
- Log in as `teacher@test.com` — Dashboard loads
- Navigate to the course → `CourseBuilderPage` → confirm a **Biometrics** tab is present in the tab list
- Log out, log in as `student@test.com` — Student Dashboard loads
- Navigate to "Biometrics Test Course"

---

## Check S0-10: ActivityLog Enum Contains Biometric Actions

```sql
-- If using a PostgreSQL ENUM type for action:
SELECT enum_range(NULL::"ActivityLogAction");

-- If using a plain string column, check a known new value is accepted:
INSERT INTO "ActivityLog" ("id", "sessionId", "studentId", "action", "createdAt")
VALUES (gen_random_uuid(), 'test-session', '{STUDENT_ID}', 'RECORDING_STARTED', NOW());

-- Then clean up:
DELETE FROM "ActivityLog" WHERE "action" = 'RECORDING_STARTED' AND "sessionId" = 'test-session';
```

**Expected:** INSERT succeeds without a constraint violation.

---

## Pre-Flight Sign-Off

Before handing off to Stage 1, confirm all checks:

| Check | ID | Status | Notes |
|-------|----|--------|-------|
| Infrastructure services up | S0-1 | | |
| DB migrations applied, 10 tables present | S0-2 | | |
| Test accounts seeded | S0-3 | | |
| Test course created + student enrolled | S0-4 | | |
| API health + biometric routes registered | S0-5 | | |
| MinIO bucket + CORS ready | S0-6 | | |
| Redis reachable + queue empty | S0-7 | | |
| py-feat worker running | S0-8 | | |
| Frontend loads in Chrome/Edge | S0-9 | | |
| ActivityLog enum has biometric actions | S0-10 | | |

**Collected values for subsequent stages:**
```
COURSE_ID   = _______________
STUDENT_ID  = _______________
TEACHER_ID  = _______________
TEACHER_JWT = _______________
STUDENT_JWT = _______________
API_BASE    = http://localhost:3000
WEB_BASE    = http://localhost:5173
```

Pass these values to every subsequent test stage prompt.

---

## If Any Check Fails

Do not proceed to Stage 1. Diagnose using these commands:

```bash
# API logs
cd apps/api && pnpm dev 2>&1 | tail -50

# DB connection test
cd apps/api && pnpm prisma db pull

# Redis test from API container
docker-compose exec api redis-cli -h redis ping

# MinIO test
mc ls local/ats-data

# py-feat worker crash reason
docker-compose logs pyfeat-worker | tail -30
```

Fix all issues before starting Stage 1.
