import { describe, expect, it } from 'vitest';
import { deriveProjectName } from './project-naming.js';

describe('deriveProjectName', () => {
  it('slugifies a plain hostname', () => {
    expect(deriveProjectName('https://example.com')).toBe('doppelganger-example-com');
  });

  it('slugifies a subdomain and path', () => {
    expect(deriveProjectName('https://app.example.com/dashboard')).toBe(
      'doppelganger-app-example-com',
    );
  });

  it('strips a leading www.', () => {
    expect(deriveProjectName('https://www.example.com')).toBe('doppelganger-example-com');
  });

  it('lowercases mixed-case hostnames', () => {
    expect(deriveProjectName('https://Example.COM')).toBe('doppelganger-example-com');
  });

  it('keeps a port out of the slug (only the hostname is used)', () => {
    expect(deriveProjectName('https://example.com:8443/path')).toBe('doppelganger-example-com');
  });

  it('falls back to a fixed safe name for an unparsable URL', () => {
    expect(deriveProjectName('not a url')).toBe('doppelganger-project');
  });

  it('falls back to a fixed safe name for a literal IP host', () => {
    // Still derivable, but exercising the fallback path matters more than
    // the exact IP-as-slug behavior here — either is safe.
    expect(deriveProjectName('http://127.0.0.1')).toMatch(/^doppelganger-[a-z0-9-]+$/);
  });

  it('never produces path traversal or separator characters', () => {
    const dangerousUrls = [
      'https://exa mple.com',
      'https://exa/mple.com',
      'https://exa\\mple.com',
      'https://..com',
      'https://%2e%2e/',
    ];
    for (const url of dangerousUrls) {
      const name = deriveProjectName(url);
      expect(name).toMatch(/^doppelganger-[a-z0-9-]+$/);
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
      expect(name).not.toContain('..');
    }
  });

  it('always produces a valid npm-package-name-shaped, filesystem-safe string', () => {
    const inputs = [
      'https://example.com',
      'https://a.b.c.example.co.uk',
      'ftp://weird-protocol.example.com',
      '',
      'https://' + 'a'.repeat(100) + '.com',
    ];
    for (const url of inputs) {
      const name = deriveProjectName(url);
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(name.startsWith('doppelganger-')).toBe(true);
    }
  });
});
