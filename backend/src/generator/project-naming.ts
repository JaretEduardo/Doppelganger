const FALLBACK_SLUG = 'project';
const PROJECT_NAME_PREFIX = 'doppelganger-';

/** Lowercase alphanumeric + single hyphens, 1-63 chars, no leading/trailing hyphen. */
const VALID_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Turns a URL's hostname into a filesystem/npm-package-safe slug —
 * "https://app.example.com/dashboard" -> "app-example-com". Never returns
 * anything containing "/", "\", "..", or characters outside [a-z0-9-], so
 * it's always safe to use directly as a single path segment. Falls back to
 * a fixed, harmless slug rather than ever using unsanitized user input as a
 * filesystem path.
 */
function slugifyHostname(url: string): string {
  let hostname: string;
  try {
    ({ hostname } = new URL(url));
  } catch {
    return FALLBACK_SLUG;
  }

  const slug = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return VALID_SLUG.test(slug) ? slug : FALLBACK_SLUG;
}

/**
 * Deterministic, safe project name for a generated Angular project — e.g.
 * "doppelganger-example-com". Always starts with the fixed prefix, so the
 * worst case (an unrecognizable hostname) still yields a valid,
 * unsurprising name ("doppelganger-project") instead of leaking or
 * mis-happening on raw input.
 */
export function deriveProjectName(url: string): string {
  return `${PROJECT_NAME_PREFIX}${slugifyHostname(url)}`;
}
