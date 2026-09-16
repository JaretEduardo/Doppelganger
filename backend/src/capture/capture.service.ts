import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Browser, chromium } from 'playwright';
import { CaptureResult } from './interfaces/capture-result.interface.js';
import { extractCapturedPage } from './ir/dom-extractor.browser.js';
import { IGNORED_TAGS } from './ir/ignored-tags.js';
import { SsrfGuardService } from '../security/ssrf/ssrf-guard.service.js';
import {
  DnsResolutionError,
  InvalidUrlProtocolError,
  SsrfBlockedError,
} from '../security/ssrf/ssrf.errors.js';

const VIEWPORT = { width: 1440, height: 900 };
const NAVIGATION_TIMEOUT_MS = 30_000;

type GuardError = SsrfBlockedError | InvalidUrlProtocolError | DnsResolutionError;

function isGuardError(error: unknown): error is GuardError {
  return (
    error instanceof SsrfBlockedError ||
    error instanceof InvalidUrlProtocolError ||
    error instanceof DnsResolutionError
  );
}

@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  constructor(private readonly ssrfGuard: SsrfGuardService) {}

  async capture(url: string): Promise<CaptureResult> {
    let browser: Browser | undefined;

    try {
      // Fail fast before even launching a browser for the common case.
      await this.ssrfGuard.assertSafeUrl(url);

      browser = await chromium.launch();
      const context = await browser.newContext({ viewport: VIEWPORT });

      // A public URL can still redirect Chromium to a private/internal
      // destination, so every navigation request (the initial load and any
      // subsequent redirect hop) is re-validated as it happens, not just the
      // URL the caller originally supplied.
      let blockedError: GuardError | null = null;
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (!request.isNavigationRequest()) {
          await route.continue();
          return;
        }
        try {
          await this.ssrfGuard.assertSafeUrl(request.url());
          await route.continue();
        } catch (error) {
          blockedError = isGuardError(error)
            ? error
            : new SsrfBlockedError('This destination is not allowed.');
          await route.abort('blockedbyclient');
        }
      });

      const page = await context.newPage();

      try {
        await page.goto(url, {
          waitUntil: 'load',
          timeout: NAVIGATION_TIMEOUT_MS,
        });
      } catch (navigationError) {
        // The route handler's abort() is what actually failed the
        // navigation; surface *why* instead of Playwright's generic
        // "net::ERR_BLOCKED_BY_CLIENT" message.
        throw blockedError ?? navigationError;
      }

      const title = await page.title();
      const extraction = await page.evaluate(extractCapturedPage, IGNORED_TAGS);
      const screenshotBuffer = await page.screenshot({ fullPage: true });

      return {
        url,
        title,
        viewport: VIEWPORT,
        elements: extraction.totalElementCount,
        screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
        ir: {
          url,
          title,
          viewport: VIEWPORT,
          root: extraction.root,
          assets: extraction.assets,
          nodeCount: extraction.nodeCount,
        },
      };
    } catch (error) {
      if (isGuardError(error)) {
        this.logger.warn(`Blocked capture request for ${url}: ${error.message}`);
        throw new BadRequestException(error.message);
      }

      this.logger.error(`Failed to capture ${url}`, error);
      throw new BadGatewayException(
        `Could not load the requested URL: ${this.firstErrorLine(error)}`,
      );
    } finally {
      await browser?.close();
    }
  }

  private firstErrorLine(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n')[0].trim();
  }
}
