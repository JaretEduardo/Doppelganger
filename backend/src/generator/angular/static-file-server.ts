import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Minimal static file server (Node built-ins only — no new dependency) for
 * serving a built Angular app's `dist/.../browser` output locally so
 * Playwright can open it over http:// instead of file://. A real HTTP origin
 * avoids `<base href>` and ES module relative-fetch edge cases that
 * file:// can hit, matching how the app would actually be served in
 * production.
 */
export function serveStaticDir(rootDir: string): Promise<StaticServer> {
  const resolvedRoot = path.resolve(rootDir);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void (async () => {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const requestedPath = path.join(resolvedRoot, urlPath === '/' ? 'index.html' : urlPath);

        if (!requestedPath.startsWith(resolvedRoot)) {
          res.writeHead(403);
          res.end();
          return;
        }

        try {
          const data = await fs.readFile(requestedPath);
          const contentType = MIME_TYPES[path.extname(requestedPath)] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
      })();
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Failed to determine static server address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
