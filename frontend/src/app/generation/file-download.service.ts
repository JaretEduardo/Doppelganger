import { Service } from '@angular/core';

/**
 * Wraps the browser-download side effect (object URL + a clicked anchor) in
 * an injectable so components never touch those APIs directly — tests can
 * override this service with a plain spy instead of mocking
 * URL.createObjectURL/anchor clicks.
 */
@Service()
export class FileDownloadService {
  download(blob: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
