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

export interface CapturedStyles {
  display: string;
  position: string;
  width: string;
  height: string;
  minWidth: string;
  minHeight: string;
  maxWidth: string;
  maxHeight: string;
  margin: string;
  padding: string;
  color: string;
  background: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  textDecoration: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
  opacity: string;
  overflow: string;
  flexDirection: string;
  flexWrap: string;
  alignItems: string;
  justifyContent: string;
  gap: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  transform: string;
  zIndex: string;
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
