import * as dns from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DnsResolutionError, InvalidUrlProtocolError, SsrfBlockedError } from './ssrf.errors.js';
import { SsrfGuardService } from './ssrf-guard.service.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('SsrfGuardService', () => {
  let guard: SsrfGuardService;
  const originalAllowHosts = process.env['DOPPELGANGER_ALLOW_HOSTS'];

  beforeEach(() => {
    guard = new SsrfGuardService();
    vi.mocked(dns.lookup).mockReset();
    delete process.env['DOPPELGANGER_ALLOW_HOSTS'];
  });

  afterEach(() => {
    if (originalAllowHosts === undefined) {
      delete process.env['DOPPELGANGER_ALLOW_HOSTS'];
    } else {
      process.env['DOPPELGANGER_ALLOW_HOSTS'] = originalAllowHosts;
    }
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/', 'data:text/html,hi', "javascript:alert(1)", 'chrome://settings', 'about:blank'])(
    'rejects disallowed protocol: %s',
    async (url) => {
      await expect(guard.assertSafeUrl(url)).rejects.toBeInstanceOf(InvalidUrlProtocolError);
      expect(dns.lookup).not.toHaveBeenCalled();
    },
  );

  it('rejects a URL that fails to parse', async () => {
    await expect(guard.assertSafeUrl('not a url')).rejects.toBeInstanceOf(InvalidUrlProtocolError);
  });

  it('blocks a literal private IPv4 address without needing DNS', async () => {
    await expect(guard.assertSafeUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(guard.assertSafeUrl('http://192.168.1.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(guard.assertSafeUrl('http://10.0.0.5/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(guard.assertSafeUrl('http://169.254.169.254/')).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('blocks a literal IPv6 loopback/private address without needing DNS', async () => {
    await expect(guard.assertSafeUrl('http://[::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(guard.assertSafeUrl('http://[fc00::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('blocks a hostname that resolves to a private IPv4 address', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '10.1.2.3', family: 4 }] as never);
    await expect(guard.assertSafeUrl('http://internal.example/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('blocks a hostname that resolves to a private IPv6 address', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: 'fe80::1', family: 6 }] as never);
    await expect(guard.assertSafeUrl('http://internal.example/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('blocks a hostname that resolves to a mix of public and private addresses', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as never);
    await expect(guard.assertSafeUrl('http://sneaky.example/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('allows a public host resolving to public addresses', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(guard.assertSafeUrl('https://example.com/')).resolves.toBeUndefined();
  });

  it('surfaces a DNS lookup failure as DnsResolutionError', async () => {
    vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));
    await expect(guard.assertSafeUrl('https://does-not-exist.invalid/')).rejects.toBeInstanceOf(
      DnsResolutionError,
    );
  });

  it('treats an empty DNS answer as a resolution failure', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([] as never);
    await expect(guard.assertSafeUrl('https://no-records.example/')).rejects.toBeInstanceOf(
      DnsResolutionError,
    );
  });

  it('lets an explicitly allow-listed test host skip the private-IP check', async () => {
    process.env['DOPPELGANGER_ALLOW_HOSTS'] = 'localhost, fixtures.local';
    await expect(guard.assertSafeUrl('http://localhost:4321/fixture.html')).resolves.toBeUndefined();
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('does not allow-list a host that was not explicitly named', async () => {
    process.env['DOPPELGANGER_ALLOW_HOSTS'] = 'fixtures.local';
    await expect(guard.assertSafeUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
