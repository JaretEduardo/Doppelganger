import { Module } from '@nestjs/common';
import { SsrfGuardService } from './ssrf/ssrf-guard.service.js';

@Module({
  providers: [SsrfGuardService],
  exports: [SsrfGuardService],
})
export class SecurityModule {}
