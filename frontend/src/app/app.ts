import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormField, pattern, required, submit, form } from '@angular/forms/signals';
import { CaptureResult } from './capture/capture-result';
import { CaptureService } from './capture/capture.service';
import { FileDownloadService } from './generation/file-download.service';
import { GenerationService } from './generation/generation.service';

@Component({
  selector: 'app-root',
  imports: [FormField],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly captureService = inject(CaptureService);
  private readonly generationService = inject(GenerationService);
  private readonly fileDownload = inject(FileDownloadService);

  protected readonly model = signal({ url: '' });
  protected readonly urlForm = form(this.model, (path) => {
    required(path.url, { message: 'Enter a URL to analyze' });
    pattern(path.url, /^https?:\/\//i, {
      message: 'URL must start with http:// or https://',
    });
  });

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<CaptureResult | null>(null);

  protected readonly generating = signal(false);
  protected readonly generateError = signal<string | null>(null);

  protected readonly busy = computed(() => this.loading() || this.generating());

  protected onSubmit(event: Event): void {
    event.preventDefault();

    void submit(this.urlForm, async () => {
      this.loading.set(true);
      this.error.set(null);
      this.result.set(null);

      try {
        const captured = await this.captureService.capture(
          this.urlForm().value().url,
        );
        this.result.set(captured);
      } catch (err) {
        this.error.set(this.toErrorMessage(err));
      } finally {
        this.loading.set(false);
      }

      return undefined;
    });
  }

  protected onGenerate(): Promise<boolean> {
    return submit(this.urlForm, async () => {
      this.generating.set(true);
      this.generateError.set(null);

      try {
        const { filename, blob } = await this.generationService.generate(
          this.urlForm().value().url,
        );
        this.fileDownload.download(blob, filename);
      } catch (err) {
        this.generateError.set(this.toErrorMessage(err));
      } finally {
        this.generating.set(false);
      }

      return undefined;
    });
  }

  private toErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string | string[] } | null;
      if (Array.isArray(body?.message)) {
        return body.message.join(', ');
      }
      if (typeof body?.message === 'string') {
        return body.message;
      }
      if (err.status === 0) {
        return 'Could not reach the backend server.';
      }
      return `Request failed with status ${err.status}.`;
    }
    return 'Something went wrong while analyzing the URL.';
  }
}
