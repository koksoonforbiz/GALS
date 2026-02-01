import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KcSuggestionService } from './kc-suggestion.service';
import { KcCrudService } from './kc-crud.service';
import { KcNormalizationService } from './kc-normalization.service';
import { KcGraphService } from './kc-graph.service';
import { KcController } from './kc.controller';
import { KcGraphController } from './kc-graph.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KcController, KcGraphController],
  providers: [KcSuggestionService, KcCrudService, KcNormalizationService, KcGraphService],
  exports: [KcSuggestionService, KcCrudService, KcNormalizationService, KcGraphService],
})
export class KcModule {}
