import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { FileDownloadService } from './generation/file-download.service';

describe('App', () => {
  let httpMock: HttpTestingController;
  let downloadSpy: { download: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    downloadSpy = { download: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FileDownloadService, useValue: downloadSpy },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function createApp() {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    return { fixture, app };
  }

  function setUrl(app: App, url: string): void {
    (app as unknown as { model: { set(value: { url: string }): void } }).model.set({ url });
  }

  it('should create the app', () => {
    const { app } = createApp();
    expect(app).toBeTruthy();
  });

  it('should render the URL input and Analyze button', async () => {
    const { fixture } = createApp();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#url-input')).toBeTruthy();
    expect(compiled.querySelector('button[type="submit"]')?.textContent).toContain('Analyze');
  });

  it('renders a "Generate Angular Project" button that does not submit the form', async () => {
    const { fixture } = createApp();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(compiled.querySelectorAll('button'));
    const generateButton = buttons.find((button) =>
      button.textContent?.includes('Generate Angular Project'),
    );

    expect(generateButton).toBeTruthy();
    expect(generateButton?.getAttribute('type')).toBe('button');
  });

  it('does not call POST /generate when the URL is invalid', async () => {
    const { app, fixture } = createApp();
    await fixture.whenStable();

    app['onGenerate']();
    await fixture.whenStable();

    httpMock.expectNone('http://localhost:3000/generate');
  });

  it('shows a loading state and disables both buttons while generating', async () => {
    const { app, fixture } = createApp();
    setUrl(app, 'https://example.com');
    await fixture.whenStable();

    const done = app['onGenerate']();

    expect(app['generating']()).toBe(true);
    expect(app['busy']()).toBe(true);

    const compiled = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const buttons = Array.from(compiled.querySelectorAll('button'));
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(compiled.textContent).toContain('Generating Angular project…');

    httpMock.expectOne('http://localhost:3000/generate').flush(new Blob(['zip bytes']));
    await done;
  });

  it('POSTs the URL, downloads the ZIP using the Content-Disposition filename, and clears loading', async () => {
    const { app, fixture } = createApp();
    setUrl(app, 'https://example.com');
    await fixture.whenStable();

    const done = app['onGenerate']();

    const req = httpMock.expectOne('http://localhost:3000/generate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ url: 'https://example.com' });
    expect(req.request.responseType).toBe('blob');

    const zipBlob = new Blob(['zip bytes'], { type: 'application/zip' });
    req.flush(zipBlob, {
      headers: { 'Content-Disposition': 'attachment; filename="doppelganger-example-com.zip"' },
    });
    await done;

    expect(downloadSpy.download).toHaveBeenCalledTimes(1);
    expect(downloadSpy.download).toHaveBeenCalledWith(zipBlob, 'doppelganger-example-com.zip');
    expect(app['generating']()).toBe(false);
    expect(app['generateError']()).toBeNull();
  });

  it('falls back to a default filename when Content-Disposition is missing', async () => {
    const { app, fixture } = createApp();
    setUrl(app, 'https://example.com');
    await fixture.whenStable();

    const done = app['onGenerate']();

    const zipBlob = new Blob(['zip bytes']);
    httpMock.expectOne('http://localhost:3000/generate').flush(zipBlob);
    await done;

    expect(downloadSpy.download).toHaveBeenCalledWith(zipBlob, 'doppelganger-project.zip');
  });

  it('shows a readable error message and does not download when /generate fails', async () => {
    const { app, fixture } = createApp();
    setUrl(app, 'https://example.com');
    await fixture.whenStable();

    const done = app['onGenerate']();

    // With responseType: 'blob', a failed request's body arrives as a Blob
    // too — GenerationService re-parses it, so this exercises that path.
    const errorBlob = new Blob([JSON.stringify({ message: 'This destination is not allowed.' })], {
      type: 'application/json',
    });
    httpMock
      .expectOne('http://localhost:3000/generate')
      .flush(errorBlob, { status: 400, statusText: 'Bad Request' });
    await done;

    expect(downloadSpy.download).not.toHaveBeenCalled();
    expect(app['generating']()).toBe(false);
    expect(app['generateError']()).toContain('not allowed');
  });
});
