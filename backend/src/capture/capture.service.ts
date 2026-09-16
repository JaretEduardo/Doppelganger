import {
  BadGatewayException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { chromium } from 'playwright';
import { CaptureResult } from './interfaces/capture-result.interface.js';

const VIEWPORT = { width: 1440, height: 900 };
const NAVIGATION_TIMEOUT_MS = 30_000;

@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  async capture(url: string): Promise<CaptureResult> {
    const browser = await chromium.launch();

    try {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();

      await page.goto(url, {
        waitUntil: 'load',
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      const title = await page.title();
      const elements = await page.evaluate(
        () => document.querySelectorAll('*').length,
      );
      const screenshotBuffer = await page.screenshot({ fullPage: true });

      return {
        url,
        title,
        viewport: VIEWPORT,
        elements,
        screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
      };
    } catch (error) {
      this.logger.error(`Failed to capture ${url}`, error);
      throw new BadGatewayException(
        `Could not load the requested URL: ${this.firstErrorLine(error)}`,
      );
    } finally {
      await browser.close();
    }
  }

  private firstErrorLine(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n')[0].trim();
  }
}
