import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KnowledgeVersionModule } from '../knowledge-version';
import { KcSuggestionService } from './kc-suggestion.service';
import { KcCrudService } from './kc-crud.service';
import { KcNormalizationService } from './kc-normalization.service';
import { KcGraphService } from './kc-graph.service';
import { KcMappingService } from './kc-mapping.service';
import { KcController } from './kc.controller';
import { KcGraphController } from './kc-graph.controller';
import { KcMappingController } from './kc-mapping.controller';

@Module({
  imports: [PrismaModule, KnowledgeVersionModule],
  controllers: [KcController, KcGraphController, KcMappingController],
  providers: [
    KcSuggestionService,
    KcCrudService,
    KcNormalizationService,
    KcGraphService,
    KcMappingService,
  ],
  exports: [
    KcSuggestionService,
    KcCrudService,
    KcNormalizationService,
    KcGraphService,
    KcMappingService,
  ],
})
export class KcModule {}
