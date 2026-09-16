import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CaptureModule } from './capture/capture.module.js';

@Module({
  imports: [CaptureModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
