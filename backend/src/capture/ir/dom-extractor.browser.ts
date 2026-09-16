import type { CapturedAsset, CapturedNode, CapturedStyles } from './captured-page.interface.js';

/**
 * Everything below runs inside the browser via `page.evaluate()`. It must be
 * fully self-contained: no imports of runtime code, no closures over Node.js
 * values. Only type-only imports are allowed since those are erased at compile
 * time. `extractCapturedPage` is what gets passed to `page.evaluate`; the rest
 * are nested helpers kept out of one giant function body for readability.
 */

export interface BrowserExtractionResult {
  root: CapturedNode | null;
  assets: CapturedAsset[];
  nodeCount: number;
  totalElementCount: number;
}

export function extractCapturedPage(ignoredTags: readonly string[]): BrowserExtractionResult {
  // Declared inside the function on purpose: page.evaluate() only serializes
  // this function's own source text, so a module-level constant would be
  // undefined once it runs in the browser.
  const STYLE_PROPERTIES = [
    'display',
    'position',
    'width',
    'height',
    'minWidth',
    'minHeight',
    'maxWidth',
    'maxHeight',
    'margin',
    'padding',
    'color',
    'background',
    'backgroundColor',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textDecoration',
    'border',
    'borderRadius',
    'boxShadow',
    'opacity',
    'overflow',
    'flexDirection',
    'flexWrap',
    'alignItems',
    'justifyContent',
    'gap',
    'gridTemplateColumns',
    'gridTemplateRows',
    'transform',
    'zIndex',
  ] as const satisfies readonly (keyof CapturedStyles)[];

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

  function readStyles(computed: CSSStyleDeclaration): CapturedStyles {
    const styles = {} as Record<(typeof STYLE_PROPERTIES)[number], string>;
    for (const property of STYLE_PROPERTIES) {
      // CSSStyleDeclaration's camelCase properties aren't index-signature typed,
      // so read them through a loosely typed view instead of one branch per key.
      styles[property] = (computed as unknown as Record<string, string>)[property];
    }
    return styles;
  }

  function getDirectText(element: Element): string | null {
    let text = '';
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
      }
    }
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return collapsed.length > 0 ? collapsed : null;
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

  function buildNode(element: Element): CapturedNode {
    const id = createNodeId();
    const computed = window.getComputedStyle(element);

    collectElementAssets(id, element);
    collectBackgroundImageAssets(id, computed);

    const children: CapturedNode[] = [];
    for (const child of Array.from(element.children)) {
      if (isIgnored(child)) continue;
      children.push(buildNode(child));
    }

    const rect = element.getBoundingClientRect();

    return {
      id,
      tag: element.tagName.toLowerCase(),
      text: getDirectText(element),
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
      children,
    };
  }

  const bodyElement = document.body;
  const root = bodyElement && !isIgnored(bodyElement) ? buildNode(bodyElement) : null;

  return {
    root,
    assets,
    nodeCount: nextId,
    totalElementCount: document.querySelectorAll('*').length,
  };
}
