import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CaptureModule } from './capture/capture.module.js';
import { GenerationModule } from './generator/generation.module.js';

@Module({
  imports: [CaptureModule, GenerationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
