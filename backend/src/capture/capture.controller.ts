import { Body, Controller, Post } from '@nestjs/common';
import { CaptureRequestDto } from './dto/capture-request.dto.js';
import { CaptureService } from './capture.service.js';
import { CaptureResult } from './interfaces/capture-result.interface.js';

@Controller('capture')
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Post()
  capture(@Body() { url }: CaptureRequestDto): Promise<CaptureResult> {
    return this.captureService.capture(url);
  }
}
