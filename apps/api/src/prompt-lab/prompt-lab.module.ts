import { Module } from '@nestjs/common';
import { RagModule } from '../rag';
import { GovernanceModule } from '../governance/governance.module';
import { PromptLabController } from './prompt-lab.controller';
import { PromptLabService } from './prompt-lab.service';

@Module({
  // RagModule provides LlmService — the shared LLM funnel. No new provider.
  imports: [RagModule, GovernanceModule],
  controllers: [PromptLabController],
  providers: [PromptLabService],
})
export class PromptLabModule {}
