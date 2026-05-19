import { Module } from '@nestjs/common';
import { Openface3Controller } from './openface3.controller';
import { Openface3Service } from './openface3.service';

@Module({
  controllers: [Openface3Controller],
  providers: [Openface3Service],
  exports: [Openface3Service],
})
export class Openface3Module {}
