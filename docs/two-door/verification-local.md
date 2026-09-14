# Two-Door — Local verification (Phase 6)

Two layers: a **scripted** pass you run from a terminal, and the **§F click-through** you run in a browser. Record the result of each row in the last column and keep this file as the evidence that the split is ready for the L40 runbook (`runbook-l40.md`).

Bring-up (see `deploy/README.md`): hosts entries → `deploy/scripts/mkcert-local.sh` → `cp deploy/.env.twodoor.local.example deploy/.env.twodoor.local` → `./deploy/scripts/twodoor.sh local up -d --build` → `./deploy/scripts/twodoor.sh local exec api pnpm run seed:twodoor` (prints the credentials used below).

> Docker was not reachable from the session that produced this file, so every row below is **unrun** until you run it. Nothing here was marked PASS by assumption.

## A. Scripted layer

| #   | Command                                                                                                                                              | Expect                                                                                                                                                                                                                                                                                                                                           | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| A1  | `pnpm build:two-door && pnpm check:two-door`                                                                                                         | both builds succeed; `OK — no private-door strings`; `OK — nginx allowlist and DoorGuard agree on every route`                                                                                                                                                                                                                                   |        |
| A2  | `pnpm --filter @ats/web lint:boundaries`                                                                                                             | `no dependency violations found`                                                                                                                                                                                                                                                                                                                 |        |
| A3  | `./deploy/scripts/twodoor.sh local ps`                                                                                                               | `nginx`, `api`, `postgres`, `redis`, `minio` healthy; **no** `web` service; only `nginx` has `PORTS` (127.0.0.1:8443/9443/8080)                                                                                                                                                                                                                  |        |
| A4  | `node deploy/scripts/verify-twodoor.mjs`                                                                                                             | every unauthenticated check `PASS` (shells, headers, allowlist 404s, method limits, register 404, spoofed header, `/s3/` reaches MinIO, sockets refused without a token)                                                                                                                                                                         |        |
| A5  | `STUDENT_LOGIN=twodoor-student STUDENT_PASSWORD=… TEACHER_EMAIL=twodoor-teacher@gals.test TEACHER_PASSWORD=… node deploy/scripts/verify-twodoor.mjs` | all authenticated checks `PASS`: student token cannot open a teacher route on the public door; export route → 403 for a student; `download-url` is `/s3/…` and the PDF fetch returns `%PDF`; `/dialogue` socket accepted for the student, `/text-mining` refused; teacher `/text-mining` accepted on the private door, refused on the public one |        |
| A6  | `./deploy/scripts/twodoor.sh local exec api wget -qS --header 'X-GALS-Door: public' -O /dev/null http://localhost:3000/api/health`                   | `HTTP/1.1 404` — DoorGuard refuses a private route even when asked directly with the public header (the layer behind nginx)                                                                                                                                                                                                                      |        |
| A7  | `./deploy/scripts/twodoor.sh local exec api wget -qS -O /dev/null http://localhost:3000/api/health`                                                  | `HTTP/1.1 200` — no header = private = today's behaviour                                                                                                                                                                                                                                                                                         |        |
| A8  | `./deploy/scripts/twodoor.sh local logs nginx \| grep -c 'X-GALS'` (optional)                                                                        | nothing — the header is set by nginx, not logged; sanity only                                                                                                                                                                                                                                                                                    |        |

## B. §F click-through (browser, mkcert CA trusted, hosts entries in place)

### B1 — Student door `https://student.gals.test:8443`

| #    | Step                                                                                     | Expect                                                                                                                                                                                                            | Result |
| ---- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| B1.1 | Open the door                                                                            | login page; **no** "Don't have an account? Register" link                                                                                                                                                         |        |
| B1.2 | Sign in as `twodoor-student`                                                             | permission gate → `/student` dashboard; sidebar shows student items only                                                                                                                                          |        |
| B1.3 | My Courses → "Two-Door Smoke Course" → Module 1 → "Course reading (PDF)"                 | the generated PDF renders ("GALS two-door smoke test…"); devtools Network shows `GET /api/items/…/download-url` then `GET /s3/ats-blobs/course-materials/…` **on the same origin**, 200                           |        |
| B1.4 | Dialogue mode on the course (if the course is switched to DIALOGUE by the teacher in B3) | messages stream; devtools WS tab shows one `/socket.io/` connection to `student.gals.test:8443` (namespace `/dialogue`), no connection to `localhost:3000`                                                        |        |
| B1.5 | Start an assessment attempt and submit                                                   | `grade_completed` toast/refresh arrives over the default-namespace socket                                                                                                                                         |        |
| B1.6 | Webcam consent + recording on a course with recording enabled                            | `recording_segments` rows appear (`twodoor.sh local exec postgres psql …`) / objects appear in MinIO; uploads go to `/s3/…` on the same origin. Analysis results are expected **absent** locally (no GPU workers) |        |
| B1.7 | devtools Network, whole session                                                          | no request to `localhost:3000`, `minio`, `api`, or any non-`student.gals.test` host; no 404 storm                                                                                                                 |        |
| B1.8 | Sign out                                                                                 | back to login; permission-gate flag cleared                                                                                                                                                                       |        |

### B2 — Student door, negative

| #    | Step                                                                                                    | Expect                                                                                                                                                 | Result |
| ---- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| B2.1 | Sign in as `twodoor-teacher@gals.test` on the student door                                              | `/wrong-door`: "This sign-in is for students. Staff should use the staff portal." + **Sign out** only; no redirect loop, no link to the admin hostname |        |
| B2.2 | While signed in as the teacher, type `/teacher` and `/dashboard/sessions/x/timeline` in the address bar | catch-all → `/login` → back to `/wrong-door` (never a blank admin shell)                                                                               |        |
| B2.3 | As the student, type `/teacher/courses`                                                                 | catch-all → `/login` → `/student` (own dashboard)                                                                                                      |        |
| B2.4 | Type `/register` and `/health`                                                                          | catch-all → `/login`; no registration form, no health page                                                                                             |        |
| B2.5 | devtools → Sources, search the loaded JS for `/teacher/` and `user-management`                          | 0 hits                                                                                                                                                 |        |
| B2.6 | `curl -k https://student.gals.test:8443/api/user-management/users`                                      | `404`                                                                                                                                                  |        |

### B3 — Teacher door `https://admin.gals.test:9443`

| #    | Step                                                                  | Expect                                                                                    | Result |
| ---- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| B3.1 | Open the door                                                         | login page **with** the Register link                                                     |        |
| B3.2 | Sign in as the teacher                                                | `/teacher` dashboard; teacher sidebar                                                     |        |
| B3.3 | Courses → "Two-Door Smoke Course" → builder                           | modules/items load; the PDF item shows its filename; PDF preview works (same `/s3/` path) |        |
| B3.4 | Users → user management; Bulk Provision page                          | both load (private-only API prefixes work on this door)                                   |        |
| B3.5 | Student Logs → open the seeded student's session from B1 → Replay tab | snapshots/timeline data load                                                              |        |
| B3.6 | Student text-mining page for that student                             | dashboard loads (HTTP); no WS errors in the console                                       |        |
| B3.7 | Sign in as the **student** on the admin door                          | `/student` works here too (the admin build carries both trees, by decision)               |        |
| B3.8 | `/health`                                                             | health page renders and `GET /api/health` is 200                                          |        |

### B4 — Teacher door from the wrong side

| #    | Step                                                                   | Expect                                                                                                                 | Result |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| B4.1 | `curl -k -H 'Host: admin.gals.test' https://127.0.0.1:8443/api/health` | `404` — the public **port** never serves private routes regardless of Host                                             |        |
| B4.2 | `./deploy/scripts/twodoor.sh local ps nginx` / `docker port`           | `9443` is bound to `127.0.0.1` only (from another machine on the LAN, `https://<laptop-ip>:9443` must fail to connect) |        |

### B5 — Dev unchanged

| #    | Step                                                                            | Expect                                                                                   | Result |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| B5.1 | `./deploy/scripts/twodoor.sh local down` then plain `docker compose up --build` | Vite on `http://localhost:5173` with HMR; API on `:3000`; everything as before the split |        |
| B5.2 | Edit a student page while B5.1 runs                                             | HMR reloads it (polling watch still in `vite.config.shared.ts`)                          |        |

## C. Sign-off

All of A and B passing = ready for `runbook-l40.md`. Anything failing: fix, re-run the affected rows, and note the commit that fixed it here.

| Date | Who | A   | B1  | B2  | B3  | B4  | B5  | Notes |
| ---- | --- | --- | --- | --- | --- | --- | --- | ----- |
|      |     |     |     |     |     |     |     |       |
