import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

const API_BASE_URL = 'http://localhost:3000';
const DEFAULT_FILENAME = 'doppelganger-project.zip';
const FILENAME_PATTERN = /filename="?([^";]+)"?/i;

export interface GeneratedProjectDownload {
  filename: string;
  blob: Blob;
}

@Service()
export class GenerationService {
  private readonly http = inject(HttpClient);

  async generate(url: string): Promise<GeneratedProjectDownload> {
    try {
      const response = await firstValueFrom(
        this.http.post(`${API_BASE_URL}/generate`, { url }, { responseType: 'blob', observe: 'response' }),
      );

      return {
        filename: this.extractFilename(response) ?? DEFAULT_FILENAME,
        blob: response.body ?? new Blob(),
      };
    } catch (err) {
      throw await this.normalizeError(err);
    }
  }

  /**
   * With `responseType: 'blob'`, a failed request's `.error` is itself a
   * Blob (the server's JSON error body, undecoded) rather than the parsed
   * object callers expect — the same shape CaptureService's calls already
   * get. Re-parse it here so the rest of the app only ever has to handle one
   * error shape.
   */
  private async normalizeError(err: unknown): Promise<unknown> {
    if (!(err instanceof HttpErrorResponse) || !(err.error instanceof Blob)) {
      return err;
    }

    let parsedError: unknown = null;
    try {
      parsedError = JSON.parse(await err.error.text());
    } catch {
      parsedError = null;
    }

    return new HttpErrorResponse({
      error: parsedError,
      headers: err.headers,
      status: err.status,
      statusText: err.statusText,
      url: err.url ?? undefined,
    });
  }

  private extractFilename(response: HttpResponse<Blob>): string | null {
    const disposition = response.headers.get('content-disposition');
    if (!disposition) return null;
    return FILENAME_PATTERN.exec(disposition)?.[1] ?? null;
  }
}
