import { Body, Controller, Post, Res, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { GenerateRequestDto } from './dto/generate-request.dto.js';
import { GenerationService } from './generation.service.js';

@Controller()
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  @Post('generate')
  async generate(
    @Body() { url }: GenerateRequestDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<StreamableFile> {
    const { filename, buffer } = await this.generationService.generateZip(url);

    res.header('Content-Type', 'application/zip');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);

    return new StreamableFile(buffer);
  }
}
