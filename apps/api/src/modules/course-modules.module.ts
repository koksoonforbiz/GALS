import { Module } from '@nestjs/common';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';
import { ItemsController, ItemActionsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  controllers: [ModulesController, ItemsController, ItemActionsController],
  providers: [ModulesService, ItemsService],
  exports: [ModulesService, ItemsService],
})
export class CourseModulesModule {}
