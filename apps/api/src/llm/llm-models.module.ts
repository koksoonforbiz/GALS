import { Module } from '@nestjs/common';
import { LlmModelsController } from './llm-models.controller';

/**
 * Surfaces the read-only model registry (`model-registry.ts`) over HTTP
 * for the teacher Settings UI. No services — the registry is pure data,
 * so the controller imports the accessor functions directly.
 *
 * Wired into `app.module.ts` alongside other teacher-facing modules.
 */
@Module({
  controllers: [LlmModelsController],
})
export class LlmModelsModule {}
