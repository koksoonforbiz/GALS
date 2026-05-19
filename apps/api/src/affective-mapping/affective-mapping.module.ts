import { Module } from '@nestjs/common';
import { AffectiveMappingController } from './affective-mapping.controller';
import { AffectiveMappingService } from './affective-mapping.service';
import { MappingEngineService } from './mapping-engine.service';

@Module({
  controllers: [AffectiveMappingController],
  providers: [AffectiveMappingService, MappingEngineService],
  exports: [AffectiveMappingService, MappingEngineService],
})
export class AffectiveMappingModule {}
