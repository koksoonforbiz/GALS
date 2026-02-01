import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KcSuggestionService } from './kc-suggestion.service';
import { KcCrudService } from './kc-crud.service';
import { KcNormalizationService } from './kc-normalization.service';
import { KcController } from './kc.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KcController],
  providers: [KcSuggestionService, KcCrudService, KcNormalizationService],
  exports: [KcSuggestionService, KcCrudService, KcNormalizationService],
})
export class KcModule {}
