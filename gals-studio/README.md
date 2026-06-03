# GALS Studio

An **offline, single-machine** research app for **replaying** instrumented
student learning sessions and **coding / labeling** affect, executive-function
events, and behavior, plus reliability + analysis. It imports portable session
**bundles** produced by `tools/gals-export` — no live DB, no cloud, no auth.

## Layout

```
gals-studio/
├── packages/shared/        bundle spec + zod validators, codebook, analysis algos (tested)
├── apps/studio-server/     Fastify + Prisma (SQLite): import, media, replay/coding/analysis APIs
├── apps/studio-web/        React + Vite + Tailwind: Library, Replay, Coding, Analysis, Codebook
└── apps/desktop/           Electron launcher (double-click, runs migrations, serves the app)
```

## Quick start

```bash
npm install
npm run db:migrate                 # create studio.db under STUDIO_DATA_DIR (~/.gals-studio)
npm run dev                        # server :5174 + web :5173
# import bundles via the Library UI, or:
npm -w @gals-studio/server run import -- '/path/to/bundles/*.zip'
```

`npm test` runs the shared analysis unit tests + the server import/coding/
analysis tests. See `docs/RESEARCHER_GUIDE.md` and `docs/OPERATOR_GUIDE.md`.

## Hard constraints honored

- **Offline / local-first** — everything on `localhost`, no telemetry.
- **Portable bundles are the contract** — after import the source DB is
  irrelevant.
- **Durable labels** — importing never modifies `Coder` / `Annotation` /
  `CodebookVersion` / `ReliabilityRun`; one-click coding backup/restore.
- **Reproducible analysis** — every κ/PABAK/α, dwell, PDT, allocation number is
  a pure, unit-tested function and exportable to CSV (and `studio-analyze`).
