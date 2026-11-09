import type { AccessibilityProps } from '@nandomo/core';
// Text primitive · <Text> → gtk4::Label.
// Accepts either a literal string (`value` or `children`) or a
// `() => string` for reactive text.
import type { SpecNode } from './types.js';

export interface TextProps extends AccessibilityProps {
  objectName?: string;
  value?: string | (() => string);
  children?: unknown;
  class?: string;
  style?: Record<string, string>;
}

export function Text(props: TextProps = {}): SpecNode {
  return {
    __spec: true,
    kind: 'Text',
    props: { ...props },
  };
}