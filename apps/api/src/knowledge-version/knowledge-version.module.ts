import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { KnowledgeVersionService } from './knowledge-version.service';
import { KnowledgeVersionController } from './knowledge-version.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KnowledgeVersionController],
  providers: [KnowledgeVersionService],
  exports: [KnowledgeVersionService],
})
export class KnowledgeVersionModule {}
