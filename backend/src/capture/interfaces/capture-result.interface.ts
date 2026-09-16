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
}
