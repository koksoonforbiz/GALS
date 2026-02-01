import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KcSuggestionService } from './kc-suggestion.service';

@Module({
  imports: [PrismaModule],
  providers: [KcSuggestionService],
  exports: [KcSuggestionService],
})
export class KcModule {}
