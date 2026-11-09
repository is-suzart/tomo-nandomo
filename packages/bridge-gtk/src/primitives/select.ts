import type { AccessibilityProps } from '@nandomo/core';
// Select primitive · <Select> → gtk4::ComboBoxText.
//
// A dropdown whose options are {value, label} pairs. The `value` prop is
// the option value, and `onChange` receives the value of the option the
// user picked.
import type { SpecNode } from './types.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends AccessibilityProps {
  objectName?: string;
  options?: readonly SelectOption[];
  /** The selected option value. */
  value?: string | (() => string);
  onChange?: (value: string) => void;
  cssClasses?: string | (() => string);
}

export function Select(props: SelectProps = {}): SpecNode {
  return {
    __spec: true,
    kind: 'Select',
    props: { ...props },
  };
}
