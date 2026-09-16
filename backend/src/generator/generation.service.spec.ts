import { promises as fs } from 'node:fs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureResult } from '../capture/interfaces/capture-result.interface.js';
import type { CaptureService } from '../capture/capture.service.js';
import { GenerationService } from './generation.service.js';

function fakeCaptureResult(url: string): CaptureResult {
  return {
    url,
    title: 'Example Domain',
    viewport: { width: 1440, height: 900 },
    elements: 1,
    screenshot: 'data:image/png;base64,',
    ir: {
      url,
      title: 'Example Domain',
      viewport: { width: 1440, height: 900 },
      assets: [],
      nodeCount: 1,
      root: {
        kind: 'element',
        id: 'n0',
        tag: 'body',
        attributes: {},
        rect: { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
        styles: {} as never,
        children: [],
      },
    },
  };
}

function makeCaptureService(capture: CaptureService['capture']): CaptureService {
  return { capture } as unknown as CaptureService;
}

describe('GenerationService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces a ZIP with the expected Angular project structure', async () => {
    const captureService = makeCaptureService(vi.fn().mockResolvedValue(fakeCaptureResult('https://example.com')));
    const service = new GenerationService(captureService);

    const { filename, buffer } = await service.generateZip('https://example.com');

    expect(filename).toBe('doppelganger-example-com.zip');

    const zip = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(zip.files).sort();

    expect(entryNames).toEqual(
      [
        'package.json',
        'angular.json',
        'tsconfig.json',
        'tsconfig.app.json',
        'src/index.html',
        'src/main.ts',
        'src/styles.scss',
        'src/app/app.ts',
        'src/app/app.html',
        'src/app/app.scss',
      ]
        .map((file) => `doppelganger-example-com/${file}`)
        .sort(),
    );
  });

  it('never includes node_modules in the produced ZIP', async () => {
    const captureService = makeCaptureService(vi.fn().mockResolvedValue(fakeCaptureResult('https://example.com')));
    const service = new GenerationService(captureService);

    const { buffer } = await service.generateZip('https://example.com');
    const zip = await JSZip.loadAsync(buffer);

    expect(Object.keys(zip.files).some((name) => name.includes('node_modules'))).toBe(false);
    expect(Object.keys(zip.files).some((name) => name.includes('dist/'))).toBe(false);
  });

  it('cleans up its temporary directory after a successful generation', async () => {
    const rmSpy = vi.spyOn(fs, 'rm');
    const captureService = makeCaptureService(vi.fn().mockResolvedValue(fakeCaptureResult('https://example.com')));
    const service = new GenerationService(captureService);

    await service.generateZip('https://example.com');

    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringContaining('doppelganger-'),
      expect.objectContaining({ recursive: true, force: true }),
    );
    const cleanedPath = rmSpy.mock.calls[0]?.[0] as string;
    await expect(fs.stat(cleanedPath)).rejects.toThrow();
  });

  it('cleans up its temporary directory even when capture fails', async () => {
    const rmSpy = vi.spyOn(fs, 'rm');
    const captureService = makeCaptureService(
      vi.fn().mockRejectedValue(new Error('capture blew up')),
    );
    const service = new GenerationService(captureService);

    await expect(service.generateZip('https://example.com')).rejects.toThrow('capture blew up');

    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringContaining('doppelganger-'),
      expect.objectContaining({ recursive: true, force: true }),
    );
    const cleanedPath = rmSpy.mock.calls[0]?.[0] as string;
    await expect(fs.stat(cleanedPath)).rejects.toThrow();
  });

  it('propagates CaptureService errors (e.g. SSRF/validation) untouched', async () => {
    class FakeBadRequest extends Error {}
    const captureService = makeCaptureService(vi.fn().mockRejectedValue(new FakeBadRequest('blocked')));
    const service = new GenerationService(captureService);

    await expect(service.generateZip('https://example.com')).rejects.toBeInstanceOf(FakeBadRequest);
  });

  it('derives the project/ZIP name deterministically from the URL', async () => {
    const captureService = makeCaptureService(
      vi.fn().mockImplementation((url: string) => Promise.resolve(fakeCaptureResult(url))),
    );
    const service = new GenerationService(captureService);

    const first = await service.generateZip('https://app.example.com/dashboard');
    expect(first.filename).toBe('doppelganger-app-example-com.zip');
  });
});
