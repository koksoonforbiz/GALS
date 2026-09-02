import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth';
import {
  listChatModels,
  listEmbeddingModels,
  isSelectable,
  type ChatModelSpec,
  type EmbeddingModelSpec,
  type LlmProvider,
} from './model-registry';

/**
 * Read-only registry projection for the teacher Settings UI.
 *
 * Stage 2 (`LLM_20260602/stage2_settings_and_model_lists.md`) makes
 * `model-registry.ts` the single source of truth for selectable models.
 * Previously both `AiSettingsPage.tsx` and `DialogueCourseSettingsForm.tsx`
 * shipped their own hard-coded `<option>` lists — they now consume this
 * endpoint instead.
 *
 * Only `isSelectable` specs are surfaced: a model with `retiresOn` in the
 * past (today: `gemini-2.0-flash`) is filtered out so it can't be picked
 * as a new selection. Models marked merely `deprecated: true` are still
 * returned — the frontend renders a "legacy" badge — so teachers with an
 * existing legacy configuration can read their current choice without it
 * vanishing from the dropdown.
 */
@Controller('llm/models')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LlmModelsController {
  @Get()
  @Roles('teacher', 'admin')
  listModels(@Query('provider') provider?: string): {
    chat: ChatModelSpec[];
    embedding: EmbeddingModelSpec[];
  } {
    let providerFilter: LlmProvider | undefined;
    if (provider !== undefined && provider !== '') {
      if (provider !== 'openai' && provider !== 'gemini' && provider !== 'bedrock') {
        throw new BadRequestException(
          `Unknown provider "${provider}". Expected one of: openai, gemini, bedrock.`,
        );
      }
      providerFilter = provider;
    }

    return {
      chat: listChatModels(providerFilter).filter((m) => isSelectable(m.id)),
      embedding: listEmbeddingModels(providerFilter).filter((m) => isSelectable(m.id)),
    };
  }
}
