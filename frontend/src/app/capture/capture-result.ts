import type { CapturedPage } from './captured-page';

export interface CaptureViewport {
  width: number;
  height: number;
}

export interface CaptureResult {
  url: string;
  title: string;
  viewport: CaptureViewport;
  elements: number;
  screenshot: string;
  ir: CapturedPage;
}
