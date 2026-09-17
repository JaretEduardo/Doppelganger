import type {
  CapturedAsset,
  CapturedElementNode,
  CapturedNode,
  CapturedPseudoElement,
  CapturedStyles,
} from './captured-page.interface.js';

/**
 * Everything below runs inside the browser via `page.evaluate()`. It must be
 * fully self-contained: no imports of runtime code, no closures over Node.js
 * values. Only type-only imports are allowed since those are erased at compile
 * time. `extractCapturedPage` is what gets passed to `page.evaluate`; the rest
 * are nested helpers kept out of one giant function body for readability.
 */

export interface BrowserExtractionResult {
  root: CapturedElementNode | null;
  assets: CapturedAsset[];
  nodeCount: number;
  totalElementCount: number;
}

export function extractCapturedPage(ignoredTags: readonly string[]): BrowserExtractionResult {
  // Declared inside the function on purpose: page.evaluate() only serializes
  // this function's own source text, so a module-level constant would be
  // undefined once it runs in the browser (see STYLE_PROPERTIES's old
  // comment in git history for the same lesson learned in Milestone 2).
  const PSEUDO_SELECTORS = ['::before', '::after', '::marker'] as const;

  const ignoredTagNames = new Set(ignoredTags.map((tag) => tag.toUpperCase()));
  const assets: CapturedAsset[] = [];
  let nextId = 0;

  function createNodeId(): string {
    const id = `n${nextId}`;
    nextId += 1;
    return id;
  }

  function isIgnored(element: Element): boolean {
    return ignoredTagNames.has(element.tagName);
  }

  function toAbsoluteUrl(rawUrl: string): string {
    try {
      return new URL(rawUrl, document.baseURI).href;
    } catch {
      return rawUrl;
    }
  }

  /**
   * Rewrites every `url(...)` reference in a computed style value to an
   * absolute URL. In practice Chromium already resolves `<url>`-typed
   * computed values (background-image, mask-image, list-style-image,
   * content, cursor, border-image-source...) against the document's base
   * URL on its own — verified empirically, not assumed — but this makes
   * that guarantee explicit and independently testable rather than relying
   * on it silently, and it's cheap: most values don't contain "url(" at all.
   */
  function normalizeCssUrls(value: string): string {
    if (!value.includes('url(')) return value;
    return value.replace(/url\((['"]?)(.*?)\1\)/g, (match, quote: string, rawUrl: string) => {
      if (!rawUrl) return match;
      return `url(${quote}${toAbsoluteUrl(rawUrl)}${quote})`;
    });
  }

  /**
   * Captures every enumerable computed CSS property for `computed`, keyed by
   * its real (kebab-case) CSS name — including custom properties (`--foo`).
   * No manual allowlist: `CSSStyleDeclaration`'s indexed enumeration already
   * covers true longhands (including modern layout properties like
   * grid-column-start, flex-grow, align-self, aspect-ratio, logical
   * properties, and inherited custom properties) — shorthands like `margin`
   * or `grid-column` aren't themselves enumerable, but every shorthand
   * decomposes losslessly into the longhands backing it, so nothing is
   * actually missing from the rendered result.
   *
   * No property-level denylist: unlike HTML attributes (raw source markup,
   * where `isSafeAttribute`/`sanitizeAttributeValue` genuinely defend
   * against on* handlers and javascript: URLs), computed style *values* are
   * entirely browser-serialized — there is no equivalent injection surface
   * to filter here, and modern browsers don't execute `url(javascript:...)`
   * in CSS contexts. Reviewed for Milestone 5; no property was found to need
   * excluding.
   */
  function readStyles(computed: CSSStyleDeclaration): CapturedStyles {
    const styles: Record<string, string> = {};
    for (let i = 0; i < computed.length; i++) {
      const property = computed.item(i);
      const value = computed.getPropertyValue(property);
      if (value) styles[property] = normalizeCssUrls(value);
    }
    return styles;
  }

  /**
   * `content: normal` is the initial value for `::marker` (meaning "use the
   * browser's default bullet/number", which the `list-style*` properties
   * already reproduce) — not "no marker". For `::before`/`::after`,
   * `content: none` is what "nothing generated" looks like; `content: ""`
   * (empty string) is a real, common, meaningful value (icon-only pseudo
   * elements styled purely via background/border) and must NOT be treated
   * as absent.
   */
  function isMeaningfulPseudoContent(pseudo: (typeof PSEUDO_SELECTORS)[number], content: string): boolean {
    return pseudo === '::marker' ? content !== 'normal' : content !== 'none';
  }

  function readPseudoElements(element: Element): CapturedPseudoElement[] | undefined {
    const results: CapturedPseudoElement[] = [];

    for (const pseudo of PSEUDO_SELECTORS) {
      const computed = window.getComputedStyle(element, pseudo);
      if (!isMeaningfulPseudoContent(pseudo, computed.content)) continue;

      results.push({
        kind: pseudo === '::before' ? 'before' : pseudo === '::after' ? 'after' : 'marker',
        styles: readStyles(computed),
      });
    }

    return results.length > 0 ? results : undefined;
  }

  function getAttributes(element: Element): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) {
      attributes[attribute.name] = attribute.value;
    }
    return attributes;
  }

  function firstFromSrcset(srcset: string): string | null {
    const firstCandidate = srcset.split(',')[0]?.trim();
    if (!firstCandidate) return null;
    return firstCandidate.split(/\s+/)[0] ?? null;
  }

  function isSvgUrl(url: string): boolean {
    return /\.svg(\?.*)?(#.*)?$/i.test(url);
  }

  function collectBackgroundImageAssets(nodeId: string, computed: CSSStyleDeclaration): void {
    const backgroundImage = computed.backgroundImage;
    if (!backgroundImage || backgroundImage === 'none') return;

    const urlPattern = /url\((['"]?)(.*?)\1\)/g;
    let match: RegExpExecArray | null;
    while ((match = urlPattern.exec(backgroundImage)) !== null) {
      const url = match[2];
      if (url) {
        assets.push({ kind: 'background-image', url, nodeId });
      }
    }
  }

  function collectElementAssets(nodeId: string, element: Element): void {
    const tag = element.tagName.toLowerCase();

    if (tag === 'img') {
      const src = element.getAttribute('src');
      const srcset = element.getAttribute('srcset');
      const url = src ?? (srcset ? firstFromSrcset(srcset) : null);
      if (url) {
        assets.push({ kind: 'img', url, nodeId, ...(srcset ? { srcset } : {}) });
      }
      return;
    }

    if (tag === 'source') {
      const src = element.getAttribute('src');
      const srcset = element.getAttribute('srcset');
      const url = src ?? (srcset ? firstFromSrcset(srcset) : null);
      if (url) {
        assets.push({ kind: 'source', url, nodeId, ...(srcset ? { srcset } : {}) });
      }
      return;
    }

    if (tag === 'object') {
      const data = element.getAttribute('data');
      if (data && isSvgUrl(data)) {
        assets.push({ kind: 'svg', url: data, nodeId });
      }
      return;
    }

    if (tag === 'embed') {
      const src = element.getAttribute('src');
      if (src && isSvgUrl(src)) {
        assets.push({ kind: 'svg', url: src, nodeId });
      }
      return;
    }

    if (tag === 'use') {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      if (href && !href.startsWith('#')) {
        const [url] = href.split('#');
        if (url) {
          assets.push({ kind: 'svg', url, nodeId });
        }
      }
    }
  }

  /**
   * Builds the ordered list of element/text children for `parent`, preserving
   * exact DOM order (e.g. `Text("Hello ") Element(strong) Text(", hi.")`).
   *
   * Whitespace-only text nodes are collapsed to a single space and dropped
   * only when they sit at the very start or end of `parent`'s child list
   * (typically source-formatting indentation); elsewhere a lone space is kept
   * since it can be the only thing separating two inline siblings.
   */
  function buildChildren(parent: Element): CapturedNode[] {
    const rawChildNodes = Array.from(parent.childNodes);
    const children: CapturedNode[] = [];

    rawChildNodes.forEach((child, index) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const collapsed = (child.textContent ?? '').replace(/\s+/g, ' ');
        const isWhitespaceOnly = collapsed.trim().length === 0;

        if (isWhitespaceOnly) {
          const isAtEdge = index === 0 || index === rawChildNodes.length - 1;
          if (isAtEdge || collapsed.length === 0) return;
          children.push({ kind: 'text', id: createNodeId(), text: ' ' });
          return;
        }

        children.push({ kind: 'text', id: createNodeId(), text: collapsed });
        return;
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (isIgnored(element)) return;
        children.push(buildElementNode(element));
      }
    });

    return children;
  }

  function buildElementNode(element: Element): CapturedElementNode {
    const id = createNodeId();
    const computed = window.getComputedStyle(element);

    collectElementAssets(id, element);
    collectBackgroundImageAssets(id, computed);

    const rect = element.getBoundingClientRect();
    const pseudoElements = readPseudoElements(element);

    return {
      kind: 'element',
      id,
      tag: element.tagName.toLowerCase(),
      attributes: getAttributes(element),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      },
      styles: readStyles(computed),
      ...(pseudoElements ? { pseudoElements } : {}),
      children: buildChildren(element),
    };
  }

  const bodyElement = document.body;
  const root = bodyElement && !isIgnored(bodyElement) ? buildElementNode(bodyElement) : null;

  return {
    root,
    assets,
    nodeCount: nextId,
    totalElementCount: document.querySelectorAll('*').length,
  };
}
