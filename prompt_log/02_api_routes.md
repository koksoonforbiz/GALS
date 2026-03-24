# Prompt 02 — NestJS API Endpoints for Batch Log Ingest

## Stack Context

- **Backend**: NestJS with Prisma 6.19
- **Auth**: JWT via `@nestjs/jwt` + `passport-jwt` — all endpoints must be protected
  with `@UseGuards(JwtAuthGuard)`
- **No Next.js** — do not create `route.ts` or `pages/api/` files
- Follow the existing NestJS module/controller/service pattern already in the codebase

## Existing Pattern to Follow

Look at how existing log endpoints are implemented (e.g., pupil size or webgazer logging).
Match the same structure: a NestJS module, a controller with route handlers, and a service
that calls Prisma. Extend or mirror that pattern exactly.

---

## Task

Create a `LogsModule` (or extend the existing one) that handles all new interaction
log types. The module should contain:

- `logs.controller.ts` — route handlers
- `logs.service.ts` — Prisma calls
- `logs.module.ts` — NestJS module definition
- `dto/` folder — DTOs for each endpoint

---

## Endpoints

### Batch Insert Endpoints

These accept a batch of events and bulk-insert them. All are `POST`.

| Route | Table | Body |
|-------|-------|------|
| `POST /logs/cursor` | `cursor_logs` | `{ sessionId, userId, events: CursorEventDto[] }` |
| `POST /logs/clicks` | `click_logs` | `{ sessionId, userId, events: ClickEventDto[] }` |
| `POST /logs/scroll` | `scroll_logs` | `{ sessionId, userId, events: ScrollEventDto[] }` |
| `POST /logs/keystrokes` | `keystroke_logs` | `{ sessionId, userId, events: KeystrokeEventDto[] }` |
| `POST /logs/visibility` | `visibility_logs` | `{ sessionId, userId, events: VisibilityEventDto[] }` |
| `POST /logs/clipboard` | `clipboard_logs` | `{ sessionId, userId, events: ClipboardEventDto[] }` |

Each batch handler must:
- Validate `sessionId` and `userId` are present — throw `BadRequestException` if missing
- Use `prisma.[table].createMany({ data: events, skipDuplicates: true })`
- Return `{ success: true, count: N }`
- Catch errors and throw `InternalServerErrorException` with message

### Single-Row Endpoints

| Route | Table | Body |
|-------|-------|------|
| `POST /logs/viewport` | `viewport_logs` | `ViewportLogDto` |
| `POST /logs/performance` | `performance_logs` | `PerformanceLogDto` |
| `POST /logs/errors` | `error_logs` | `ErrorLogDto` |

Each single-row handler must:
- Validate required fields — throw `BadRequestException` if missing
- Use `prisma.[table].create({ data: dto })`
- Return `{ success: true, id: record.id }`

### Sync Anchor Endpoint

`POST /logs/sync-anchor`

Body DTO:
```typescript
class SyncAnchorDto {
  sessionId: string;
  userId: string;
  wallClockMs: number;
  monotonicMs: number;
  timezone: string;
  userAgent: string;
}
```

Handler must:
- Record `serverReceiveMs = Date.now()` on the server (never trust client value)
- Upsert: `prisma.session_sync_anchors.upsert({ where: { sessionId }, update: {...}, create: {...} })`
- Return `{ success: true, serverReceiveMs }`

---

## DTOs

Create DTOs in `src/logs/dto/`. Use `class-validator` decorators matching the
existing patterns in the codebase. Example for cursor:

```typescript
// create-cursor-batch.dto.ts
export class CursorEventDto {
  @IsNumber() x: number;
  @IsNumber() y: number;
  @IsString() pageUrl: string;
  @IsOptional() @IsString() elementTarget?: string;
  @IsNumber() timestamp: number;
  @IsOptional() @IsString() batchId?: string;
}

export class CreateCursorBatchDto {
  @IsString() sessionId: string;
  @IsString() userId: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CursorEventDto)
  events: CursorEventDto[];
}
```

Create equivalent DTOs for all other batch and single-row endpoints.

---

## Auth Guard

All routes must use the JWT guard already configured in the project:

```typescript
@UseGuards(JwtAuthGuard)
@Controller('logs')
export class LogsController { ... }
```

Apply `@UseGuards(JwtAuthGuard)` at the controller level so all routes inherit it.

---

## Module Registration

Register `LogsModule` in the root `AppModule` imports array.
If a `LogsModule` already exists, extend it rather than creating a duplicate.
