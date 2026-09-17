import type { CaptureViewport } from './capture-result';

export interface CapturedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/**
 * Every enumerable computed CSS property Chromium reported for an element,
 * keyed by its real kebab-case CSS name (e.g. "background-color",
 * "grid-column-start", "--brand-color") rather than a hand-picked allowlist.
 */
export type CapturedStyles = Record<string, string>;

export interface CapturedPseudoElement {
  kind: 'before' | 'after' | 'marker';
  styles: CapturedStyles;
}

export type CapturedAssetKind = 'img' | 'source' | 'background-image' | 'svg';

export interface CapturedAsset {
  kind: CapturedAssetKind;
  url: string;
  nodeId: string;
  srcset?: string;
}

export interface CapturedTextNode {
  kind: 'text';
  id: string;
  text: string;
}

export interface CapturedElementNode {
  kind: 'element';
  id: string;
  tag: string;
  attributes: Record<string, string>;
  rect: CapturedRect;
  styles: CapturedStyles;
  pseudoElements?: CapturedPseudoElement[];
  children: CapturedNode[];
}

export type CapturedNode = CapturedElementNode | CapturedTextNode;

export interface CapturedPage {
  url: string;
  title: string;
  viewport: CaptureViewport;
  root: CapturedElementNode | null;
  assets: CapturedAsset[];
  nodeCount: number;
}
