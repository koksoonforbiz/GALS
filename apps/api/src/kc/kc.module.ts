import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KcSuggestionService } from './kc-suggestion.service';
import { KcCrudService } from './kc-crud.service';
import { KcController } from './kc.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KcController],
  providers: [KcSuggestionService, KcCrudService],
  exports: [KcSuggestionService, KcCrudService],
})
export class KcModule {}
