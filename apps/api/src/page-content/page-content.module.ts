import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { PageContentService } from './page-content.service';
import { PageContentController } from './page-content.controller';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [PageContentController],
  providers: [PageContentService],
  exports: [PageContentService],
})
export class PageContentModule {}
