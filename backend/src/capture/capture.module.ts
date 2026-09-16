import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module.js';
import { CaptureController } from './capture.controller.js';
import { CaptureService } from './capture.service.js';

@Module({
  imports: [SecurityModule],
  controllers: [CaptureController],
  providers: [CaptureService],
  exports: [CaptureService],
})
export class CaptureModule {}
