/**
 * Data migration: rewrite teachers stuck on retired LLM model ids to the
 * registry's recommended default for their provider.
 *
 * Why this is a script, not a SQL migration:
 *   - It is data movement only (no schema change).
 *   - The "retired" list and the "new default" both live in
 *     `apps/api/src/llm/model-registry.ts`, which is TypeScript. Keeping
 *     this script in TypeScript means a single source of truth — when the
 *     registry retires another model, this script rewrites that one too
 *     without anyone having to copy/paste model ids into raw SQL.
 *   - Prisma migrations are reserved for schema changes per house style
 *     (see `apps/api/prisma/migrations/` history — all schema, never
 *     plain UPDATE-on-existing-data).
 *
 * Idempotency:
 *   - The script targets ONLY rows whose `llmModel` (or `llmEmbeddingModel`)
 *     is currently non-selectable per `isSelectable()`. After the first
 *     run, those rows hold the provider's selectable default; a second
 *     run finds zero matches and is a no-op.
 *   - Runs in a single transaction per teacher. Re-running after a
 *     partial failure is safe.
 *   - Logs a per-row summary so the operator can spot-check what moved.
 *
 * How to run (NOT auto-invoked):
 *   pnpm --filter @ats/api exec tsx prisma/scripts/migrate_retired_llm_models.ts
 *   or                              ts-node prisma/scripts/migrate_retired_llm_models.ts
 *
 * Stage 2 of the LLM upgrade (LLM_20260602/). Stage 1 introduced the
 * registry; Stage 2 (this script + the read-time guard in
 * `LlmService.getUserApiKey`) closes the dead-default gap for
 * `gemini-2.0-flash`.
 */

import { PrismaClient } from '@prisma/client';
import {
  isSelectable,
  defaultChatModel,
  defaultEmbeddingModel,
  type LlmProvider,
} from '../../src/llm/model-registry';

const prisma = new PrismaClient();

function coerceProvider(raw: string | null): LlmProvider | null {
  if (raw === 'openai' || raw === 'gemini') return raw;
  return null;
}

interface RewriteSummary {
  chatRewrites: number;
  embeddingRewrites: number;
  skippedNoProvider: number;
  examined: number;
}

async function run(): Promise<RewriteSummary> {
  const summary: RewriteSummary = {
    chatRewrites: 0,
    embeddingRewrites: 0,
    skippedNoProvider: 0,
    examined: 0,
  };

  // Only teachers/admins can have an LLM configuration in this codebase
  // (LlmService.saveApiKey is guarded by @Roles('teacher','admin')) but
  // we read every user with a provider set rather than join on role to
  // stay tolerant of historical data.
  const users = await prisma.user.findMany({
    where: {
      OR: [{ llmProvider: { not: null } }, { llmModel: { not: null } }],
    },
    select: {
      id: true,
      email: true,
      llmProvider: true,
      llmModel: true,
      llmEmbeddingModel: true,
    },
  });

  for (const user of users) {
    summary.examined += 1;
    const provider = coerceProvider(user.llmProvider);
    if (!provider) {
      summary.skippedNoProvider += 1;
      console.log(
        `[skip] user ${user.id} (${user.email}) has no valid provider (${user.llmProvider ?? 'null'})`,
      );
      continue;
    }

    const updates: { llmModel?: string; llmEmbeddingModel?: string } = {};

    if (user.llmModel && !isSelectable(user.llmModel)) {
      const replacement = defaultChatModel(provider).id;
      console.log(
        `[chat]  user ${user.id} (${user.email}) "${user.llmModel}" is retired → "${replacement}"`,
      );
      updates.llmModel = replacement;
    }

    if (user.llmEmbeddingModel && !isSelectable(user.llmEmbeddingModel)) {
      const replacement = defaultEmbeddingModel(provider).id;
      console.log(
        `[embed] user ${user.id} (${user.email}) "${user.llmEmbeddingModel}" is retired → "${replacement}"`,
      );
      updates.llmEmbeddingModel = replacement;
    }

    if (Object.keys(updates).length === 0) continue;

    await prisma.user.update({ where: { id: user.id }, data: updates });
    if (updates.llmModel) summary.chatRewrites += 1;
    if (updates.llmEmbeddingModel) summary.embeddingRewrites += 1;
  }

  return summary;
}

run()
  .then((summary) => {
    console.log('');
    console.log('─── migrate_retired_llm_models — summary ───');
    console.log(`  users examined        : ${summary.examined}`);
    console.log(`  skipped (no provider) : ${summary.skippedNoProvider}`);
    console.log(`  chat model rewrites   : ${summary.chatRewrites}`);
    console.log(`  embedding rewrites    : ${summary.embeddingRewrites}`);
    console.log('');
    console.log(
      summary.chatRewrites + summary.embeddingRewrites === 0
        ? 'No rows changed — re-running this script is a no-op.'
        : 'Done. Re-running this script now will be a no-op (idempotent).',
    );
  })
  .catch((err) => {
    console.error('migrate_retired_llm_models FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
