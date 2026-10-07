import { Module } from '@nestjs/common';
import { TextConsentController } from './text-consent.controller';
import { TextConsentService } from './text-consent.service';

/** Prompting-course governance (plan Phase 6.2): text-capture consent. */
@Module({
  controllers: [TextConsentController],
  providers: [TextConsentService],
  exports: [TextConsentService],
})
export class GovernanceModule {}
