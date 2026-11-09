import type { AccessibilityProps } from '@nandomo/core';
// View primitive · <View> → gtk4::Box (vertical orientation by default).
// Pure declarative factory: returns a SpecNode, render() walks the tree.
import type { SpecNode } from './types.js';

export interface ViewProps extends AccessibilityProps {
  objectName?: string;
  children?: unknown;
  class?: string;
  style?: Record<string, string>;
  /** Orientation for the underlying gtk4::Box. Defaults to vertical. */
  orientation?: 'vertical' | 'horizontal';
  /** Pass-through to gtk4::Box::set_spacing. */
  spacing?: number;
}

export function View(props: ViewProps = {}): SpecNode {
  return {
    __spec: true,
    kind: 'View',
    props: { ...props },
  };
}