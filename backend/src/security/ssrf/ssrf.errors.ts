/** The URL's protocol isn't http/https (or the URL couldn't be parsed at all). */
export class InvalidUrlProtocolError extends Error {}

/** The hostname couldn't be resolved via DNS. */
export class DnsResolutionError extends Error {}

/** The URL (or one of its redirect targets) resolves to a blocked destination. */
export class SsrfBlockedError extends Error {}
