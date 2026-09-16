import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormField, pattern, required, submit, form } from '@angular/forms/signals';
import { CaptureResult } from './capture/capture-result';
import { CaptureService } from './capture/capture.service';

@Component({
  selector: 'app-root',
  imports: [FormField],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly captureService = inject(CaptureService);

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
