import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaptureResult } from './capture-result';

const API_BASE_URL = 'http://localhost:3000';

@Service()
export class CaptureService {
  private readonly http = inject(HttpClient);

  capture(url: string): Promise<CaptureResult> {
    return firstValueFrom(
      this.http.post<CaptureResult>(`${API_BASE_URL}/capture`, { url }),
    );
  }
}
