import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { CaptureService } from '../capture/capture.service.js';
import type { CapturedPage } from '../capture/ir/captured-page.interface.js';
import { generateAngularProject } from './angular/angular-generator.js';
import { deriveProjectName } from './project-naming.js';
import { zipFiles } from './zip/zip-builder.js';

export interface GeneratedZip {
  filename: string;
  buffer: Buffer;
}

const TEMP_DIR_PREFIX = 'doppelganger-';

/**
 * Orchestrates URL -> Angular project -> ZIP. Deliberately thin: capture
 * stays entirely CaptureService's job (including URL/SSRF validation —
 * nothing is duplicated here), Angular scaffolding stays entirely
 * AngularGenerator's job, and this service's only real responsibility is
 * wiring the two together through a temporary directory that is always
 * cleaned up, success or failure.
 */
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(private readonly captureService: CaptureService) {}

  async generateZip(url: string): Promise<GeneratedZip> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));

    try {
      // CaptureService already validates the URL (protocol, SSRF/DNS) and
      // throws client-appropriate exceptions of its own — those propagate
      // as-is, untouched, from here.
      const captureResult = await this.captureService.capture(url);

      const projectName = deriveProjectName(url);
      const projectDir = path.join(tempRoot, 'project');

      const project = await this.generateProjectOrThrow(captureResult.ir, projectDir, projectName);
      const buffer = await this.zipProjectOrThrow(projectDir, project.files, projectName);

      return { filename: `${projectName}.zip`, buffer };
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch((cleanupError: unknown) => {
        this.logger.error(`Failed to clean up temporary directory ${tempRoot}`, cleanupError);
      });
    }
  }

  private async generateProjectOrThrow(
    ir: CapturedPage,
    projectDir: string,
    projectName: string,
  ): Promise<{ files: string[] }> {
    try {
      return await generateAngularProject(ir, projectDir, { projectName });
    } catch (error) {
      this.logger.error(`Failed to generate the Angular project for "${projectName}"`, error);
      throw new InternalServerErrorException('Failed to generate the Angular project.');
    }
  }

  private async zipProjectOrThrow(
    projectDir: string,
    files: string[],
    projectName: string,
  ): Promise<Buffer> {
    try {
      return await zipFiles(projectDir, files, projectName);
    } catch (error) {
      this.logger.error(`Failed to create the ZIP archive for "${projectName}"`, error);
      throw new InternalServerErrorException('Failed to create the project archive.');
    }
  }
}
