# Prompt 01 — Database Schema: New Raw Log Tables + Sync Infrastructure

## Stack Context

- **ORM**: Prisma 6.19 with PostgreSQL
- **Backend**: NestJS (schema changes are consumed by NestJS services via Prisma Client)
- **No Next.js** — do not create any Next.js files

## Existing Tables (already in schema.prisma)

`activity_logs`, `student_sessions`, `session_summaries`, `pupil_size_logs`,
`webgazer_logs`, `pyfeat_au_results`, `recording_segments`, `dialogue_messages`,
`llm_usage_logs`, `learning_interventions`, `spaced_repetition_cards`,
`attempts`, `user_mastery`

All existing tables use:

- `BigInt` for Unix millisecond timestamps
- `String` UUID for `sessionId` and `userId`
- PostgreSQL via Prisma

## Task

Add the following new models to `schema.prisma`. Follow the exact naming and
field conventions already used in the existing schema.

---

### RAW INTERACTION TABLES

```prisma
model cursor_logs {
  id            String   @id @default(cuid())
  sessionId     String
  userId        String
  x             Int
  y             Int
  pageUrl       String
  elementTarget String?
  timestamp     BigInt
  batchId       String?

  @@index([sessionId, timestamp])
}

model click_logs {
  id              String  @id @default(cuid())
  sessionId       String
  userId          String
  x               Int
  y               Int
  pageUrl         String
  elementSelector String
  elementText     String?
  timestamp       BigInt

  @@index([sessionId, timestamp])
}

model scroll_logs {
  id             String @id @default(cuid())
  sessionId      String
  userId         String
  scrollY        Int
  scrollPercent  Float
  pageUrl        String
  timestamp      BigInt

  @@index([sessionId, timestamp])
}

model keystroke_logs {
  id               String  @id @default(cuid())
  sessionId        String
  userId           String
  fieldId          String
  keystrokeCount   Int
  pauseDurationMs  Int
  typingSpeedWPM   Float?
  timestamp        BigInt

  @@index([sessionId, timestamp])
}

model visibility_logs {
  id               String  @id @default(cuid())
  sessionId        String
  userId           String
  visibleState     String
  pageUrl          String
  timestamp        BigInt
  hiddenDurationMs Int?

  @@index([sessionId, timestamp])
}

model clipboard_logs {
  id            String  @id @default(cuid())
  sessionId     String
  userId        String
  action        String
  textLength    Int
  sourceElement String?
  pageUrl       String
  timestamp     BigInt

  @@index([sessionId, timestamp])
}

model viewport_logs {
  id          String @id @default(cuid())
  sessionId   String
  userId      String
  width       Int
  height      Int
  orientation String
  timestamp   BigInt

  @@index([sessionId, timestamp])
}

model performance_logs {
  id                   String  @id @default(cuid())
  sessionId            String
  userId               String
  pageUrl              String
  pageLoadMs           Int?
  apiLatencyMs         Int?
  resourceTimingsJson  Json?
  timestamp            BigInt

  @@index([sessionId, timestamp])
}

model error_logs {
  id            String  @id @default(cuid())
  sessionId     String
  userId        String
  errorMessage  String
  stack         String?
  componentName String?
  pageUrl       String
  timestamp     BigInt
  errorType     String?

  @@index([sessionId, timestamp])
}
```

---

### SYNC INFRASTRUCTURE TABLES

```prisma
model session_sync_anchors {
  id               String   @id @default(cuid())
  sessionId        String   @unique
  userId           String
  wallClockMs      BigInt
  monotonicMs      BigInt
  serverReceiveMs  BigInt
  timezone         String
  userAgent        String
  createdAt        DateTime @default(now())

  session          student_sessions @relation(fields: [sessionId], references: [id])
}

model modality_offsets {
  id           String  @id @default(cuid())
  sessionId    String
  modality     String
  offsetMs     Int
  estimatedAt  BigInt
  method       String
  notes        String?

  @@index([sessionId, modality])
}
```

---

### DERIVED ANALYTICS TABLES

```prisma
model derived_engagement {
  id                  String   @id @default(cuid())
  sessionId           String
  userId              String
  windowStartMs       BigInt
  windowEndMs         BigInt
  clickRate           Float
  scrollActivity      Float
  cursorMovement      Float
  tabVisibleFraction  Float
  engagementScore     Float
  computedAt          DateTime @default(now())

  @@unique([sessionId, windowStartMs])
  @@index([sessionId])
}

model derived_cognitive_load {
  id                 String   @id @default(cuid())
  sessionId          String
  userId             String
  windowStartMs      BigInt
  windowEndMs        BigInt
  avgPupilDiameter   Float
  pupilDilation      Float
  avgGazeEntropy     Float
  avgAU04            Float
  avgAU07            Float
  cognitiveLoadIndex Float
  computedAt         DateTime @default(now())

  @@unique([sessionId, windowStartMs])
  @@index([sessionId])
}

model derived_emotion_timeline {
  id            String   @id @default(cuid())
  sessionId     String
  frameId       String?
  windowStartMs BigInt
  emotion       String
  confidence    Float
  auEvidence    Json
  computedAt    DateTime @default(now())

  @@index([sessionId, windowStartMs])
}

model derived_learning_velocity {
  id            String   @id @default(cuid())
  sessionId     String
  userId        String
  kcId          String
  masteryStart  Float
  masteryEnd    Float
  masteryDelta  Float
  attemptsCount Int
  durationMs    BigInt
  velocityScore Float
  computedAt    DateTime @default(now())

  @@index([sessionId, kcId])
}

model derived_at_risk_flags {
  id         String   @id @default(cuid())
  sessionId  String
  userId     String
  flaggedAt  BigInt
  riskLevel  String
  reasons    Json
  computedAt DateTime @default(now())

  @@index([sessionId])
}

model aligned_frames {
  id               String   @id @default(cuid())
  sessionId        String
  frameId          String
  frameTMs         BigInt
  tRel             BigInt
  segmentId        String?
  pupilDiameter    Float?
  gazeX            Float?
  gazeY            Float?
  gazeConfidence   Float?
  au01             Float?
  au02             Float?
  au04             Float?
  au05             Float?
  au06             Float?
  au07             Float?
  au09             Float?
  au10             Float?
  au12             Float?
  au14             Float?
  au15             Float?
  au17             Float?
  au20             Float?
  au23             Float?
  au24             Float?
  au25             Float?
  au26             Float?
  au28             Float?
  faceConf         Float?
  cursorX          Int?
  cursorY          Int?
  scrollPercent    Float?
  interventionType String?
  activityAction   String?
  attemptScore     Float?
  isTabVisible     Boolean  @default(true)
  computedAt       DateTime @default(now())

  @@unique([sessionId, frameId])
  @@index([sessionId, frameTMs])
}
```

---

## Migration Instructions

1. Add all models above to `schema.prisma`
2. Add the `session_sync_anchors` relation field to the existing `student_sessions` model:
   ```prisma
   syncAnchor session_sync_anchors?
   ```
3. Run:
   ```bash
   npx prisma migrate dev --name add_interaction_sync_derived_logs
   npx prisma generate
   ```
4. Confirm migration succeeds before proceeding to Prompt 02
