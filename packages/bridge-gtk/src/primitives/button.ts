import type { AccessibilityProps } from '@nandomo/core';
// Button primitive · <Button> → gtk4::Button.
// `label` becomes the button's text via set_label. `onTap`/`onClick`
// connect to the `clicked` signal at render time.
import type { SpecNode } from './types.js';

export interface ButtonProps extends AccessibilityProps {
  objectName?: string;
  label?: string;
  onTap?: (...args: unknown[]) => void;
  onClick?: (...args: unknown[]) => void;
  disabled?: boolean | (() => boolean);
  variant?: 'primary' | 'secondary' | 'ghost';
  children?: unknown;
}

export function Button(props: ButtonProps = {}): SpecNode {
  return {
    __spec: true,
    kind: 'Button',
    props: { ...props },
  };
}