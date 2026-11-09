import type { AccessibilityProps } from '@nandomo/core';
// Container primitive · <Container> → gtk4::Box (vertical).
// Semantic alias of View but reserved for layout containers (parity
// with bridge-web / bridge-qml). Both kinds map to the same Rust widget.
import type { SpecNode } from './types.js';

export interface ContainerProps extends AccessibilityProps {
  objectName?: string;
  children?: unknown;
  class?: string;
  style?: Record<string, string>;
  orientation?: 'vertical' | 'horizontal';
  spacing?: number;
}

export function Container(props: ContainerProps = {}): SpecNode {
  return {
    __spec: true,
    kind: 'Container',
    props: { ...props },
  };
}