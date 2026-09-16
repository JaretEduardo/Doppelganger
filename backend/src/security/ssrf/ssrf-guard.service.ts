import net from 'node:net';
import * as dns from 'node:dns/promises';
import { Injectable, Logger } from '@nestjs/common';
import { isPrivateOrReservedIp } from './ip-classification.js';
import { DnsResolutionError, InvalidUrlProtocolError, SsrfBlockedError } from './ssrf.errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Comma-separated exact hostnames allowed to skip the private-IP check. */
const ALLOWLIST_ENV_VAR = 'DOPPELGANGER_ALLOW_HOSTS';

/**
 * Guards against server-side request forgery: rejects any URL whose
 * protocol isn't http(s), and — crucially — resolves the hostname via DNS
 * and rejects it if *any* resolved address is loopback/private/link-local.
 * Checking the literal hostname string alone isn't enough (a hostname can
 * resolve to an internal address, and callers are expected to re-run this
 * check against each navigation/redirect target, not just the original URL).
 *
 * Local/fixture testing escape hatch: set DOPPELGANGER_ALLOW_HOSTS to a
 * comma-separated list of *exact* hostnames (e.g. "localhost") to let those
 * specific hosts skip the private-IP check. Unset by default — production
 * configuration is unaffected unless someone deliberately opts a host in.
 */
@Injectable()
export class SsrfGuardService {
  private readonly logger = new Logger(SsrfGuardService.name);

  async assertSafeUrl(rawUrl: string): Promise<void> {
    const parsed = this.parseUrl(rawUrl);

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      throw new InvalidUrlProtocolError(
        `Protocol "${parsed.protocol}" is not allowed. Only http and https are permitted.`,
      );
    }

    // WHATWG URL keeps brackets around an IPv6 literal in `.hostname`
    // (e.g. "[::1]"), which net.isIP()/dns.lookup() don't understand.
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (this.isExplicitlyAllowedTestHost(hostname)) {
      this.logger.warn(`Skipping private-IP check for explicitly allowed test host "${hostname}"`);
      return;
    }

    if (net.isIP(hostname)) {
      if (isPrivateOrReservedIp(hostname)) {
        throw new SsrfBlockedError('This destination is not allowed.');
      }
      return;
    }

    const addresses = await this.resolveHostname(hostname);
    for (const address of addresses) {
      if (isPrivateOrReservedIp(address)) {
        throw new SsrfBlockedError('This destination is not allowed.');
      }
    }
  }

  private parseUrl(rawUrl: string): URL {
    try {
      return new URL(rawUrl);
    } catch {
      throw new InvalidUrlProtocolError('The URL could not be parsed.');
    }
  }

  private async resolveHostname(hostname: string): Promise<string[]> {
    let records: { address: string }[];
    try {
      records = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new DnsResolutionError(`Could not resolve hostname "${hostname}".`);
    }

    if (records.length === 0) {
      throw new DnsResolutionError(`Could not resolve hostname "${hostname}".`);
    }

    return records.map((record) => record.address);
  }

  private isExplicitlyAllowedTestHost(hostname: string): boolean {
    const allowlist = (process.env[ALLOWLIST_ENV_VAR] ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return allowlist.includes(hostname);
  }
}
