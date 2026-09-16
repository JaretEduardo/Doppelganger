import { Module } from '@nestjs/common';
import { CaptureModule } from '../capture/capture.module.js';
import { GenerationController } from './generation.controller.js';
import { GenerationService } from './generation.service.js';

@Module({
  imports: [CaptureModule],
  controllers: [GenerationController],
  providers: [GenerationService],
})
export class GenerationModule {}
